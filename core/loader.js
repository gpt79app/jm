// JCR 내보내기 CSV·SCImago CSV 를 읽어 저널 목록을 만든다.
// 자료는 "JCR-<연도>/<파일>.csv", "SCImago-<연도>/<파일>.csv" 이름으로 둔다(가장 최근 연도만 읽는다).
import { csvRows } from "./csv.js";
import { displayCategory, newJournal, normalizedISSN, normalizedName } from "./model.js";

/// Number() 와 달리 빈 칸·글자는 null
function num(s) {
  if (!s || s.trim() !== s) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}
function int(s) {
  return /^[+-]?\d+$/.test(s) ? Number(s) : null;
}
const firstMatch = (s, re) => {
  const m = re.exec(s);
  return m ? m[1] : null;
};

// MARK: JCR 내보내기 CSV

/// JCR 내보내기가 아니면 null
export function parseJCR(text) {
  const rows = csvRows(text, ",");
  const meta = rows[0] && rows[0][0];
  if (!meta || !meta.startsWith("Journal Data Filtered By")) return null;
  const year = num(firstMatch(meta, /Selected JCR Year: (\d{4})/) ?? "");
  const categories = firstMatch(meta, /Selected Categories: (.*?) Selected Editions/) ?? "";
  const h = rows.findIndex((r) => r[0] === "Journal name");
  if (h < 0) return { year, categories, rows: [] };
  const header = rows[h].map((s) => s.trim());
  const col = (name) => header.indexOf(name);
  const jifCol = header.findIndex((s) => /^\d{4} JIF$/.test(s));
  const out = [];
  for (const r of rows.slice(h + 1)) {
    if (r.length < 6 || (r[0] || "").startsWith("By exporting")) continue;
    const v = (i) => (i >= 0 && i < r.length ? r[i].trim() : "");
    const row = {
      title: v(col("Journal name")), abbreviation: v(col("JCR Abbreviation")), publisher: v(col("Publisher")),
      issn: v(col("ISSN")), eissn: v(col("eISSN")), category: v(col("Category")), edition: v(col("Edition")),
      jifText: v(jifCol), quartile: v(col("JIF Quartile")), rankText: v(col("JIF Rank")), percentileText: v(col("JIF Percentile")),
    };
    if (row.title) out.push(row);
  }
  return { year, categories, rows: out };
}

// MARK: SCImago CSV

export function isSCImago(text) {
  const head = text.slice(0, 200);
  return head.includes("Sourceid") && head.includes(";Title;");
}

export function parseSCImago(text) {
  const rows = csvRows(text, ";");
  const header = rows[0];
  if (!header) return [];
  const col = (name) => header.indexOf(name);
  const cTitle = col("Title"), cIssn = col("Issn"), cSJR = col("SJR"), cQ = col("SJR Best Quartile");
  const cH = col("H index"), cCat = col("Categories"), cPub = col("Publisher"), cID = col("Sourceid");
  // 한 해 편수 'Total Docs. (2025)' — 해는 파일마다 다르다
  const cDocs = header.findIndex((s) => /^Total Docs\. \(\d{4}\)$/.test(s));
  const docsYear = cDocs >= 0 ? num(firstMatch(header[cDocs], /\((\d{4})\)/) ?? "") : null;
  const cDocs3 = col("Total Docs. (3years)"), cCov = col("Coverage");
  const out = [];
  for (const r of rows.slice(1)) {
    if (r.length <= 3) continue;
    const v = (i) => (i >= 0 && i < r.length ? r[i] : "");
    const quartile = v(cQ) === "-" ? "" : v(cQ);
    const row = {
      title: v(cTitle),
      issns: v(cIssn).split(",").map(normalizedISSN).filter(Boolean),
      sjr: num(v(cSJR).replaceAll(",", ".")),
      quartile,
      hIndex: int(v(cH)),
      publisher: v(cPub),
      id: v(cID),
      docs: int(v(cDocs)), docsYear, docs3y: int(v(cDocs3)),
      coverage: v(cCov).trim(),
      categories: v(cCat).split("; ").map((item) => item.trim()).filter(Boolean).map((t) => {
        const q = firstMatch(t, /\((Q[1-4])\)$/);
        return q ? { name: t.replace(` (${q})`, ""), quartile: q } : { name: t, quartile: "" };
      }),
    };
    if (row.title) out.push(row);
  }
  return out;
}

// MARK: 자료 읽기

/// 이름이 "<prefix><연도>/…" 인 파일 중 가장 최근 연도의 것들(이름 차례)
function latestYear(paths, prefix) {
  let year = null;
  for (const p of paths) {
    const m = new RegExp(`^${prefix}(\\d+)/`).exec(p);
    if (m && (year == null || Number(m[1]) > year)) year = Number(m[1]);
  }
  if (year == null) return null;
  const files = paths.filter((p) => p.startsWith(`${prefix}${year}/`) && p.toLowerCase().endsWith(".csv")).sort();
  return { year, files };
}

/// files: Map(이름 → 글). CSV 만 읽는다(무겁다). 즐겨찾기·별칭은 link 가 붙인다
export function loadTables(files) {
  const lib = { journals: [], jcrYear: null, sjrYear: null, jcrCategories: [], unresolvedNames: [], warnings: [], aliasIDs: new Map() };
  const byID = new Map();
  const order = [];
  const categories = new Set();
  const paths = [...files.keys()];

  // JCR: 분야마다 한 파일. 같은 저널은 ISSN 으로 묶는다
  const jcr = latestYear(paths, "JCR-");
  if (jcr) {
    lib.jcrYear = jcr.year;
    for (const path of jcr.files) {
      const parsed = parseJCR(files.get(path));
      if (!parsed) {
        lib.warnings.push(`JCR 파일이 아님: ${path.split("/").pop()}`);
        continue;
      }
      if (parsed.year != null) lib.jcrYear = parsed.year;
      for (const row of parsed.rows) {
        const id = normalizedISSN(row.issn) ?? normalizedISSN(row.eissn) ?? "name:" + normalizedName(row.title);
        let j = byID.get(id);
        if (!j) {
          order.push(id);
          j = newJournal(id, row.title);
          j.abbreviation = row.abbreviation;
          j.publisher = row.publisher;
          j.issn = normalizedISSN(row.issn) ?? "";
          j.eissn = normalizedISSN(row.eissn) ?? "";
          // 내보내기는 2.0 을 "2" 로 적는다. 저널 페이지처럼 소수 한 자리로 보인다
          // "<0.1" 은 순위 계산에서 맨 아래로 들어가야 해서 0.05 로 둔다(N/A 는 순위 없음)
          const value = num(row.jifText);
          j.jif = value ?? (row.jifText.startsWith("<") ? 0.05 : null);
          j.jifText = value != null ? value.toFixed(1) : row.jifText;
          byID.set(id, j);
        }
        // 600개 제한으로 나눠 받은 파일은 겹치는 줄이 있다
        if (row.category && !j.categories.some((c) => c.name === row.category)) {
          const parts = row.rankText.split("/").map((s) => int(s.trim()));
          const two = parts.length === 2;
          j.categories.push({
            name: row.category, edition: row.edition,
            rank: two ? parts[0] : null, total: two ? parts[1] : null,
            quartile: row.quartile.startsWith("Q") ? row.quartile : "",
            percentile: num(row.percentileText),
          });
          categories.add(row.category);
        }
      }
    }
  }
  lib.jcrCategories = [...categories].sort();

  // SCImago: ISSN 으로 JCR 저널에 붙이고, 나머지는 SCImago 에만 있는 저널로 더한다
  const sjr = latestYear(paths, "SCImago-");
  if (sjr) {
    lib.sjrYear = sjr.year;
    const file = sjr.files[sjr.files.length - 1];
    const text = file ? files.get(file) : null;
    if (text && isSCImago(text)) {
      const idByISSN = new Map();
      for (const id of order) {
        const j = byID.get(id);
        for (const s of [j.issn, j.eissn]) if (s) idByISSN.set(s, id);
      }
      for (const row of parseSCImago(text)) {
        const known = row.issns.map((s) => idByISSN.get(s)).find(Boolean);
        const id = known ?? (row.issns.length ? "sjr:" + row.issns[0] : "sjrname:" + normalizedName(row.title));
        let j = byID.get(id);
        if (!j) {
          order.push(id);
          j = newJournal(id, row.title);
          j.publisher = row.publisher;
          j.issn = row.issns[0] ?? "";
          j.eissn = row.issns[1] ?? "";
          byID.set(id, j);
        }
        if (j.sjrTitle) continue; // 같은 저널이 두 번 나오면 처음 것(순위가 높은 것)
        Object.assign(j, {
          sjrTitle: row.title, sjr: row.sjr, sjrQuartile: row.quartile, hIndex: row.hIndex, sjrCategories: row.categories,
          sjrID: row.id, sjrDocs: row.docs, sjrDocsYear: row.docsYear, sjrDocs3y: row.docs3y, coverage: row.coverage,
        });
        for (const s of row.issns) if (!idByISSN.has(s)) idByISSN.set(s, id);
      }
    } else if (sjr.files.length) {
      lib.warnings.push(`SCImago 파일을 읽지 못함: SCImago-${sjr.year}`);
    }
  }

  lib.journals = order.map((id) => byID.get(id));
  return lib;
}

/// 별칭 글의 줄들: "다른 이름 = 저널 이름 또는 ISSN". # 뒤는 설명
export function readAliases(text) {
  const out = [];
  for (const raw of (text || "").split(/\r?\n/)) {
    const line = (raw.includes("#") ? raw.slice(0, raw.indexOf("#")) : raw).trim();
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const alias = line.slice(0, eq).trim(), target = line.slice(eq + 1).trim();
    if (alias && target) out.push([alias, target]);
  }
  return out;
}

/// 즐겨찾기(저널 id 들)·별칭을 저널에 맞춘다(가볍다). 몇 번 불러도 같은 결과
export function link(base, { favorites = [], aliases = "" } = {}) {
  const lib = { ...base, aliasIDs: new Map() };
  const ids = new Set(), idByName = new Map(), idByISSN = new Map();
  for (const j of lib.journals) {
    ids.add(j.id);
    for (const n of [j.title, j.abbreviation, j.sjrTitle]) {
      if (!n) continue;
      const k = normalizedName(n);
      if (!idByName.has(k)) idByName.set(k, j.id);
    }
    for (const s of [j.issn, j.eissn]) if (s && !idByISSN.has(s)) idByISSN.set(s, j.id);
  }
  const resolve = (target) => {
    if (ids.has(target)) return target;
    const issn = normalizedISSN(target);
    if (issn && target.length <= 9) return idByISSN.get(issn) ?? null;
    return idByName.get(normalizedName(target)) ?? null;
  };
  const unresolved = [];
  const aliasNames = new Map();
  for (const [alias, target] of readAliases(aliases)) {
    const id = resolve(target);
    if (id) {
      lib.aliasIDs.set(normalizedName(alias), id);
      if (!aliasNames.has(id)) aliasNames.set(id, []);
      aliasNames.get(id).push(alias);
    } else unresolved.push(target);
  }
  const fav = new Set();
  for (const target of favorites) {
    const id = resolve(target);
    if (id) fav.add(id);
    else unresolved.push(target);
  }
  lib.journals = lib.journals.map((j) => ({ ...j, isFavorite: fav.has(j.id), aliases: aliasNames.get(j.id) ?? [] }));
  lib.unresolvedNames = [...new Set(unresolved)].sort();
  return lib;
}

// MARK: 새 자료 넣기

/// CSV 하나를 자료에 넣을 이름을 정한다. JCR → JCR-<연도>/JCR<연도>_<분야>.csv, SCImago → SCImago-<연도>/<이름>.
/// 돌려주는 것: { path, message } (path 가 null 이면 넣지 않음 — 이미 있거나 CSV 가 아님)
export function importFile(name, text, files) {
  const parsed = parseJCR(text);
  if (parsed) {
    if (parsed.year == null) return { path: null, message: `${name}: JCR 연도를 찾지 못했습니다.` };
    const category = parsed.categories || name.replace(/\.[^.]*$/, "");
    const base = `JCR${parsed.year}_` + [...category.toUpperCase()].map((c) => (/[\p{L}\p{N}]/u.test(c) ? c : "_")).join("")
      .replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    // 600개 제한으로 같은 분야를 두 번 받은 경우는 _2, _3 … 으로 둔다
    for (let n = 1; ; n++) {
      const path = `JCR-${parsed.year}/${n === 1 ? base : `${base}_${n}`}.csv`;
      const old = files.get(path);
      if (old != null) {
        if (old === text) return { path: null, message: `이미 있음: ${path}` };
        continue;
      }
      return { path, message: `JCR ${parsed.year} · ${displayCategory(category)} ${parsed.rows.length}개 → ${path}` };
    }
  }
  if (isSCImago(text)) {
    const year = Number(firstMatch(name, /(\d{4})/) ?? new Date().getFullYear());
    const path = `SCImago-${year}/${name}`;
    return { path, message: `SCImago ${year} → ${path}` };
  }
  return { path: null, message: `${name}: JCR·SCImago 에서 내려받은 CSV 가 아닙니다.` };
}

/// 넣은 결과 문장들의 한 줄 요약. 하나면 그 문장 그대로
export function importSummary(messages) {
  if (messages.length <= 1) return messages[0] ?? "";
  const jcr = messages.filter((m) => m.startsWith("JCR ")).length;
  const sjr = messages.filter((m) => m.startsWith("SCImago ")).length;
  const same = messages.filter((m) => m.startsWith("이미 있음")).length;
  const failed = messages.length - jcr - sjr - same;
  const added = jcr + sjr;
  const head = added === messages.length ? `${added}개 넣음` : `${messages.length}개 중 ${added}개 넣음`;
  const parts = [jcr && `JCR ${jcr}`, sjr && `SCImago ${sjr}`, same && `이미 있음 ${same}`, failed && `못 넣음 ${failed}`].filter(Boolean);
  return [head, ...parts].join(" · ");
}

