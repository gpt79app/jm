// 한글 자판인 채로 친 검색어를 영문 자판 키로 되돌린다(두벌식). "ㅓㅇㄷ" → "jde", "ㅡㅁ소랴ㅜ" → "mathfin"

const initials = ["r", "R", "s", "e", "E", "f", "a", "q", "Q", "t", "T", "d", "w", "W", "c", "z", "x", "v", "g"];
const medials = ["k", "o", "i", "O", "j", "p", "u", "P", "h", "hk", "ho", "hl", "y", "n", "nj", "np", "nl", "b", "m", "ml", "l"];
const finals = ["", "r", "R", "rt", "s", "sw", "sg", "e", "f", "fr", "fa", "fq", "ft", "fx", "fv", "fg", "a", "q", "qt", "t", "T", "d", "w", "c", "z", "x", "v", "g"];
// 호환 자모 ㄱ(U+3131)…ㅣ(U+3163) 순서의 키
const compatibility = ["r", "R", "rt", "s", "sw", "sg", "e", "E", "f", "fr", "fa", "fq", "ft", "fx", "fv", "fg", "a", "q", "Q", "qt", "t", "T", "d", "w", "W", "c", "z", "x", "v", "g",
  "k", "o", "i", "O", "j", "p", "u", "P", "h", "hk", "ho", "hl", "y", "n", "nj", "np", "nl", "b", "m", "ml", "l"];

/// 한글이 섞여 있으면 영문 키로 바꾼 문자열, 아니면 null
export function hangulToQWERTY(s) {
  let out = "";
  let changed = false;
  for (const ch of s) {
    const u = ch.codePointAt(0);
    if (u >= 0xac00 && u <= 0xd7a3) {
      const i = u - 0xac00;
      out += initials[Math.floor(i / 588)] + medials[Math.floor((i % 588) / 28)] + finals[i % 28];
      changed = true;
    } else if (u >= 0x3131 && u <= 0x3163) {
      out += compatibility[u - 0x3131];
      changed = true;
    } else {
      out += ch;
    }
  }
  return changed ? out : null;
}
