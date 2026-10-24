// 대충 쳐도 찾는 검색.
// - 단어 일부·순서 바뀜: "finance stoch", "stochastic finance"
// - 줄임말: "mathfin", "jcam", "sicon", "mafe" (단어 앞글자들을 이어 붙인 것)
// - 오타 한두 글자: "mathmatical finance"
// - ISSN: "0960-1627", "09601627"
import { hangulToQWERTY } from "./hangul.js";
import { displayTitle, inJCR } from "./model.js";

const stopwords = new Set(["of", "the", "and", "on", "in", "for", "a", "an", "to", "at", "with", "de", "des", "du", "la", "le", "et", "und", "fur", "di", "del", "y", "e"]);
// 악센트를 떼도 안 바뀌는 글자들
const special = { "ø": "o", "ł": "l", "đ": "d", "ı": "i", "ß": "ss" };

/// 소문자 영문·숫자 단어로 쪼갠다(악센트 지움, & → and)
export function searchWords(s) {
  const folded = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[øłđıß]/g, (c) => special[c]).replaceAll("&", " and ");
  return folded.match(/[a-z0-9]+/g) || [];
}

class NameKey {
  constructor(s) {
    this.words = searchWords(s);
    this.stop = this.words.map((w) => stopwords.has(w));
    this.compact = this.words.join("");
    this.firstLetters = new Set(this.words.map((w) => w[0]));
    this.significant = this.stop.filter((x) => !x).length;
    // 줄임말에서 words[0..<k] 를 건너뛸 때·끝에 남길 때 감점 합(20점 단위)
    const skip = [0], tail = [0];
    this.words.forEach((w, i) => {
      const s = this.stop[i];
      const journalWord = w === "journal" || w === "journals";
      skip.push(skip[skip.length - 1] + (s ? 0 : journalWord ? 1 : 3));
      tail.push(tail[tail.length - 1] + (s ? 0 : journalWord ? 1 : 2));
    });
    this.skipBefore = skip;
    this.tailBefore = tail;
  }
}

/// 검색어. 만들 수 없으면(빈 것) null
export function searchQuery(raw) {
  // 한글 자판인 채로 쳤으면 영문 키로 바꿔서 찾는다
  const text = hangulToQWERTY(raw) ?? raw;
  const t = text.replace(/^[ \t]+|[ \t]+$/g, "");
  if (!t) return null;
  const all = searchWords(t);
  // 마지막 단어는 아직 치는 중일 수 있다("journal of de" 의 de) → 불용어라도 남긴다
  const typing = text.length > 0 && !/\s/.test(text[text.length - 1]);
  const sig = all.filter((w, i) => !stopwords.has(w) || (typing && i === all.length - 1));
  const compact = all.join("");
  const digits = [...t.toUpperCase()].filter((c) => (c >= "0" && c <= "9") || c === "X").join("");
  const looksISSN = /^[0-9xX\- ]*$/.test(t) && digits.length >= 4;
  const q = { words: sig.length ? sig : all, compact, issnDigits: looksISSN ? digits : null };
  if (!compact && q.issnDigits == null) return null;
  return q;
}

export class SearchIndex {
  constructor(journals) {
    this.names = journals.map((j) => {
      const seen = new Set();
      const keys = [];
      for (const n of [displayTitle(j), j.title, j.abbreviation, ...j.aliases]) {
        if (!n) continue;
        const k = new NameKey(n);
        if (k.words.length && !seen.has(k.compact)) {
          seen.add(k.compact);
          keys.push(k);
        }
      }
      return keys;
    });
    this.issns = journals.map((j) => [j.issn, j.eissn].filter(Boolean).map((s) => s.toUpperCase().replaceAll("-", "")));
  }

  /// 후보 중 맞는 것과 점수(높을수록 비슷). 점수순
  search(q, candidates) {
    const out = [];
    for (const i of candidates) {
      let top = 0;
      if (q.issnDigits != null) {
        for (const s of this.issns[i]) {
          if (s === q.issnDigits) top = 1000;
          else if (s.startsWith(q.issnDigits)) top = Math.max(top, 650);
        }
      }
      for (const n of this.names[i]) top = Math.max(top, score(q, n));
      if (top >= 380) out.push({ index: i, score: top });
    }
    return out.sort((a, b) => b.score - a.score);
  }
}

function score(q, n) {
  if (!q.compact) return 0;
  if (q.compact === n.compact) return 1000;
  let top = 0;
  if (q.compact.length >= 3 && n.compact.startsWith(q.compact)) top = 880 + (40 * q.compact.length) / n.compact.length;
  top = Math.max(top, wordScore(q, n));
  if (q.compact.length >= 4 && n.compact.includes(q.compact)) top = Math.max(top, 520 + (100 * q.compact.length) / n.compact.length);
  if (q.words.length === 1 && q.compact.length >= 2 && q.compact.length <= 14 && n.firstLetters.has(q.compact[0])) {
    top = Math.max(top, abbreviationScore(q.compact, n));
  }
  return top;
}

/// 검색 단어마다 이름에서 가장 잘 맞는 단어를 찾는다(앞부분·오타 허용)
function wordScore(q, n) {
  let total = 0, misses = 0, last = -1, inOrder = true;
  const used = new Set();
  for (const w of q.words) {
    let bestM = 0, bestJ = -1;
    for (let j = 0; j < n.words.length; j++) {
      const m = match(w, n.words[j]);
      if (m > bestM) {
        bestM = m;
        bestJ = j;
        if (m === 1) break;
      }
    }
    if (bestM === 0) {
      misses += 1;
      continue;
    }
    total += bestM;
    if (bestJ <= last) inOrder = false;
    last = bestJ;
    if (!n.stop[bestJ]) used.add(bestJ);
  }
  const allowed = q.words.length >= 3 ? 1 : 0;
  if (misses > allowed || total <= 0) return 0;
  const coverage = n.significant > 0 ? used.size / n.significant : 0;
  return 400 + (250 * total) / q.words.length + (inOrder ? 30 : 0) + 60 * coverage - 80 * misses;
}

function match(w, nw) {
  if (w === nw) return 1;
  if (w.length >= 2 && nw.startsWith(w)) return 0.8 + (0.2 * w.length) / nw.length;
  if (nw.length >= 4 && w.startsWith(nw)) return 0.85;
  if (w.length < 4) return 0;
  const maxD = w.length >= 8 ? 2 : 1;
  if (Math.abs(w.length - nw.length) <= maxD && editDistance(w, nw, maxD) <= maxD) return 0.75;
  // 앞부분만 친 데다 오타까지 있는 경우("mathmat")
  if (nw.length > w.length && editDistance(w, nw.slice(0, w.length), 1) <= 1) return 0.6;
  return 0;
}

/// 줄임말: 질의를 이어진 조각으로 나눠 각 조각이 (순서대로 고른) 단어의 앞부분이 되게 한다.
/// 건너뛴 단어 중 불용어가 아닌 것마다 감점
function abbreviationScore(q, n) {
  const L = q.length, W = n.words.length;
  const inf = 1000;
  const memo = new Int32Array((L + 1) * (W + 1)).fill(-1);
  const f = (pos, j) => {
    const key = pos * (W + 1) + j;
    if (memo[key] >= 0) return memo[key];
    let top = inf;
    if (pos === L) {
      top = n.tailBefore[W] - n.tailBefore[j];
    } else {
      for (let k = j; k < W; k++) {
        const skip = n.skipBefore[k] - n.skipBefore[j];
        if (skip >= top || skip > 12) break;
        const word = n.words[k];
        let len = 0;
        while (len < word.length && pos + len < L && word[len] === q[pos + len]) {
          len += 1;
          const rest = f(pos + len, k + 1);
          if (rest < inf) top = Math.min(top, skip + rest);
        }
      }
    }
    memo[key] = top;
    return top;
  };
  const penalty = f(0, 0);
  return penalty <= 12 ? 720 - 20 * penalty : 0;
}

/// 글자 바꿈·넣기·빼기·이웃 맞바꿈 거리. limit 를 넘으면 limit + 1
export function editDistance(a, b, limit) {
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > limit) return limit + 1;
  if (n === 0 || m === 0) return Math.max(n, m);
  let prev2 = new Array(m + 1).fill(0);
  let prev = Array.from({ length: m + 1 }, (_, i) => i);
  let cur = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > limit) return limit + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[m];
}

/// 검색 결과 순서: 점수(즐겨찾기 +200, JCR 저널 +30) → JIF
export function orderedSearchHits(hits, journals) {
  return hits
    .map((h) => {
      const j = journals[h.index];
      return { index: h.index, score: h.score + (j.isFavorite ? 200 : 0) + (inJCR(j) ? 30 : 0) };
    })
    .sort((a, b) => (a.score !== b.score ? b.score - a.score : (journals[b.index].jif ?? -1) - (journals[a.index].jif ?? -1)));
}
