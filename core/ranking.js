// 분야별 순위를 JIF 로 다시 매긴다. excludeESCI 면 ESCI 분야 줄을 빼고 SCIE·SSCI 저널끼리만.
// JCR 과 같은 규칙: 같은 JIF 는 같은 순위, 백분위 = (N - 순위 + 0.5) / N × 100, 분위 = 순위/N 이 0.25·0.5·0.75 이하면 Q1·Q2·Q3, 그 밖은 Q4.
// (N 은 그 분야에서 JIF 가 있는 저널 수.) 저널 순서와 개수는 그대로 둔다.

/// 내림차순 values 에서 v 보다 큰 값 수 + 1 (같은 값은 같은 순위)
export function competitionRank(v, descending) {
  let lo = 0, hi = descending.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (descending[mid] > v) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

export function reranked(journals, excludeESCI) {
  const out = journals.map((j) => ({
    ...j,
    categories: excludeESCI ? j.categories.filter((c) => c.edition.toUpperCase() !== "ESCI") : j.categories.map((c) => ({ ...c })),
  }));
  const members = new Map();
  out.forEach((j, index) => {
    if (j.jif == null) return;
    for (const c of j.categories) {
      if (!members.has(c.name)) members.set(c.name, []);
      members.get(c.name).push({ index, jif: j.jif });
    }
  });
  for (const [name, list] of members) {
    const jifs = list.map((m) => m.jif).sort((a, b) => b - a);
    const n = jifs.length;
    for (const m of list) {
      const rank = competitionRank(m.jif, jifs);
      const z = rank / n;
      const quartile = z <= 0.25 ? "Q1" : z <= 0.5 ? "Q2" : z <= 0.75 ? "Q3" : "Q4";
      const percentile = Math.round(((n - rank + 0.5) / n) * 1000) / 10;
      const cats = out[m.index].categories;
      const k = cats.findIndex((c) => c.name === name);
      if (k >= 0) out[m.index].categories[k] = { ...cats[k], rank, total: n, quartile, percentile };
    }
  }
  return out;
}

// 색인 고르기(SCIE·SSCI·AHCI): 분야마다 색인이 하나(ESCI 줄이 섞여 있다)

export const MAIN_EDITIONS = ["SCIE", "SSCI", "AHCI"];

/// 분야 → 색인. ESCI 아닌 줄의 색인, ESCI 줄만 있으면 ESCI
export function categoryEditions(journals) {
  const out = new Map();
  for (const j of journals) for (const c of j.categories) {
    const e = c.edition.toUpperCase();
    if (!out.has(c.name) || (out.get(c.name) === "ESCI" && e !== "ESCI")) out.set(c.name, e);
  }
  return out;
}

/// 자료에 있는 색인(ESCI 빼고), SCIE·SSCI·AHCI 차례
export function mainEditions(editions) {
  const have = new Set(editions.values());
  return MAIN_EDITIONS.filter((e) => have.has(e));
}

/// 고르지 않은 색인(hidden)의 분야를 저널에서 뺀다 — 목록·'가장 좋은 분야' 모두에서.
/// 분야마다 색인이 하나라 남은 분야의 순위는 그대로. 분야가 다 빠진 저널은 ESCI 를 뺐을 때처럼 JCR 밖 저널이 된다
export function hidingEditions(journals, hidden, editions) {
  if (!hidden.length) return journals;
  const set = new Set(hidden);
  return journals.map((j) => ({ ...j, categories: j.categories.filter((c) => !set.has(editions.get(c.name) ?? c.edition.toUpperCase())) }));
}

/// 지금 빼는 색인: 자료에 있는 것만, 다 빼게 되면 하나도 안 뺌
export function effectiveHidden(main, hidden) {
  const out = main.filter((e) => hidden.includes(e));
  return out.length === main.length ? [] : out;
}

/// 색인 하나를 보이거나 뺀 새 hidden. 남는 색인이 없게는 하지 않는다
export function settingEdition(main, hidden, e, shown) {
  if (shown) return hidden.filter((x) => x !== e);
  if (hidden.includes(e) || !main.some((x) => x !== e && !hidden.includes(x))) return hidden;
  return [...hidden, e].sort();
}

/// 제목 아래·내보내기에 붙이는 말: 빼거나 다시 계산한 것이 있을 때만("SCIE만 · ESCI 제외 순위")
export function editionNote(main, hidden, includeESCI) {
  const parts = [];
  if (main.some((e) => hidden.includes(e))) parts.push(main.filter((e) => !hidden.includes(e)).join("·") + "만");
  if (!includeESCI) parts.push("ESCI 제외 순위");
  return parts.join(" · ");
}
