// 저널 한 개와 JCR 분야 순위를 다루는 함수들
//
// 저널: { id, title, abbreviation, publisher, issn, eissn, jif, jifText, categories: [분야 순위],
//         sjrTitle, sjr, sjrQuartile, hIndex, sjrCategories: [{ name, quartile }], sjrID,
//         sjrDocs, sjrDocsYear, sjrDocs3y, coverage, isFavorite, aliases }
// 분야 순위: { name(대문자 그대로), edition, rank, total, quartile, percentile }

export function newJournal(id, title) {
  return {
    id, title, abbreviation: "", publisher: "", issn: "", eissn: "",
    jif: null, jifText: "", categories: [],
    sjrTitle: "", sjr: null, sjrQuartile: "", hIndex: null, sjrCategories: [], sjrID: "",
    sjrDocs: null, sjrDocsYear: null, sjrDocs3y: null, coverage: "",
    isFavorite: false, aliases: [],
  };
}

/// 상위 몇 % = 순위/전체×100 을 소수 첫째 자리까지 올림(4/347 = 1.15… → 1.2). 정수로 계산해 25/100 이 25.1 이 되지 않게
export function topOf(c) {
  if (!c || c.rank == null || c.total == null || c.total <= 0) return null;
  return Math.floor((c.rank * 1000 + c.total - 1) / c.total) / 10;
}

export function rankText(c) {
  return c && c.rank != null && c.total != null ? `${c.rank}/${c.total}` : "";
}

export const inJCR = (j) => j.categories.length > 0;

/// 저널이 들어 있는 색인 전부(분야마다 다를 수 있다. 예: SCIE·SSCI)
export function editions(j) {
  const have = new Set(j.categories.map((c) => c.edition.toUpperCase()));
  return ["SCIE", "SSCI", "AHCI", "ESCI"].filter((e) => have.has(e)).join("·");
}

/// 보이는 이름: JCR 은 대문자 표기가 많아 SCImago 표기가 있으면 그쪽(같은 ISSN 으로 묶인 저널)
export const displayTitle = (j) => j.sjrTitle || j.title;

const pct = (c) => (c.percentile == null ? -1 : c.percentile);

/// 백분위가 가장 높은 분야(같으면 먼저 나온 것)
export function best(j) {
  let out = null;
  for (const c of j.categories) if (!out || pct(c) > pct(out)) out = c;
  return out;
}

export const rankIn = (j, category) => j.categories.find((c) => c.name === category) || null;

/// shown 말고 이 저널이 속한 다른 JCR 분야, 백분위 높은 차례
export function otherCategories(j, shown) {
  return j.categories.filter((c) => c.name !== (shown && shown.name)).sort((a, b) => pct(b) - pct(a));
}

/// 속한 분야 전부 한 줄씩: "Mathematics, Applied — 15/347 · Q1 · 상위 4.4%", 백분위 높은 차례
export function categoryLines(j) {
  return [...j.categories].sort((a, b) => pct(b) - pct(a)).map((c) => {
    const t = topOf(c);
    return [displayCategory(c.name) + " — " + rankText(c), c.quartile, t == null ? "" : `상위 ${t.toFixed(1)}%`]
      .filter((s) => s && s !== " — ").join(" · ");
  });
}

export function coverageStart(j) {
  const m = /(\d{4})/.exec(j.coverage);
  return m ? Number(m[1]) : null;
}

/// "2025년 48편 · 최근 3년 127편(한 해 평균 42편)". 자료가 없으면 null
export function docsText(j) {
  const parts = [];
  if (j.sjrDocs != null) parts.push((j.sjrDocsYear != null ? `${j.sjrDocsYear}년 ` : "한 해 ") + `${j.sjrDocs}편`);
  if (j.sjrDocs3y != null && j.sjrDocs3y > 0) parts.push(`최근 3년 ${j.sjrDocs3y}편(한 해 평균 ${Math.round(j.sjrDocs3y / 3)}편)`);
  return parts.length ? parts.join(" · ") : null;
}

/// "Scopus 수록 1950년부터 (1950-2026)". 창간 연도와 다를 수 있다
export function coverageText(j) {
  const start = coverageStart(j);
  if (start == null) return null;
  return `Scopus 수록 ${start}년부터` + (j.coverage ? ` (${j.coverage})` : "");
}

/// 이름 비교용: 소문자, & → and, 괄호 안 지움, 영문·숫자만 남김
export function normalizedName(s) {
  const t = s.toLowerCase().replaceAll("&", " and ").replace(/\([^)]*\)/g, " ");
  return t.replace(/[^a-z0-9]/g, "");
}

/// ISSN 을 1234-567X 꼴로. 아니면 null
export function normalizedISSN(s) {
  const raw = s.toUpperCase().replace(/[^0-9X]/g, "");
  if (raw.length !== 8 || !/^[0-9]{7}$/.test(raw.slice(0, 7))) return null;
  return raw.slice(0, 4) + "-" + raw.slice(4);
}

/// JCR 분야 이름을 읽기 쉽게(MATHEMATICS, APPLIED → Mathematics, Applied)
export function displayCategory(s) {
  return s.toLowerCase().split(" ").map((w) => (["and", "of", "in"].includes(w) ? w : w.slice(0, 1).toUpperCase() + w.slice(1))).join(" ");
}

export const topText = (top) => `${top.toFixed(1)}%`;

/// 백분위 같은 값의 짧은 표기(1 → "1", 2.5 → "2.5")
export const shortNumber = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));
