// JCR 분야 안에서 SCImago 세부 분류 여러 개로 좁힐 때의 순위. 고른 분류 중 하나라도 속하면 들어간다(합집합).
// - 세부 순위: 그렇게 좁힌 저널끼리 JIF 순
// - SJR 분류 순위: 분류마다 SCImago 그 분류 전체 SJR 순 — 저널이 속한 고른 분류 중 가장 좋은 것(순위/전체가 작은 것)
// - SJR 분위: 저널이 속한 고른 분류 중 가장 좋은 분위
import { competitionRank } from "./ranking.js";

const qNum = (q) => Number(q.slice(1)) || 9;

export class SubcategoryRanks {
  /// members: 좁힌 저널(이 분야 ∩ 고른 분류), all: 보이는 저널 전부(SCImago 분류 전체 순위용)
  constructor(selected, members, all) {
    this.selected = selected;
    this.subJIFs = members.map((j) => j.jif).filter((v) => v != null).sort((a, b) => b - a);
    const sjrs = new Map();
    for (const j of all) {
      if (j.sjr == null) continue;
      for (const s of new Set(j.sjrCategories.map((c) => c.name))) {
        if (!selected.has(s)) continue;
        if (!sjrs.has(s)) sjrs.set(s, []);
        sjrs.get(s).push(j.sjr);
      }
    }
    for (const v of sjrs.values()) v.sort((a, b) => b - a);
    this.categorySJRs = sjrs;
  }

  /// 고른 분류 중 하나라도 속하는가
  contains(j) {
    return j.sjrCategories.some((c) => this.selected.has(c.name));
  }

  subRank(j) {
    if (j.jif == null || !this.subJIFs.length) return null;
    return { rank: competitionRank(j.jif, this.subJIFs), total: this.subJIFs.length };
  }

  /// 저널이 속한 고른 분류 중 SJR 순위가 가장 좋은 것(순위/전체, 같으면 순위가 작은 것)과 그 분류 이름
  sjrCategoryRank(j) {
    if (j.sjr == null) return null;
    let top = null;
    for (const s of [...new Set(j.sjrCategories.map((c) => c.name))].sort()) {
      if (!this.selected.has(s)) continue;
      const values = this.categorySJRs.get(s);
      if (!values || !values.length) continue;
      const r = { rank: competitionRank(j.sjr, values), total: values.length, category: s };
      if (top) {
        const x = r.rank / r.total, y = top.rank / top.total;
        if (x < y || (x === y && r.rank < top.rank)) top = r;
      } else {
        top = r;
      }
    }
    return top;
  }

  /// 저널이 속한 고른 분류 중 가장 좋은 SJR 분위. 없으면 null
  sjrQuartile(j) {
    let top = null;
    for (const c of j.sjrCategories) {
      if (!this.selected.has(c.name) || !c.quartile) continue;
      if (!top || qNum(c.quartile) < qNum(top)) top = c.quartile;
    }
    return top;
  }
}
