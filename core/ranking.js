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
