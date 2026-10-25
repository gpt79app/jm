// 처음 열 때 보기·바로가기 1·2·3 이 가리키는 곳을 글자 하나(token)로:
// "mine"(즐겨찾기) · "jcr"(JCR 저널) · "cat:<분야 이름 그대로>" · "tag:<태그 id>" · "view:<저장한 보기 id>" · ""(없음)

export const START_DEFAULT = "jcr";
export const SHORTCUT_COUNT = 3;

/// token → { kind: "mine" | "jcr" | "category" | "tag" | "view", name? , id? }. 모르는 꼴이면 null
export function parseToken(token) {
  if (token === "mine" || token === "jcr") return { kind: token };
  const i = typeof token === "string" ? token.indexOf(":") : -1;
  if (i < 0) return null;
  const head = token.slice(0, i), rest = token.slice(i + 1);
  if (!rest) return null;
  if (head === "cat") return { kind: "category", name: rest };
  if (head === "tag") return { kind: "tag", id: rest };
  if (head === "view") return { kind: "view", id: rest };
  return null;
}

/// 보기(scope: { kind, name }) → token. 즐겨찾기·JCR 저널·분야·태그만
export function tokenFor(scope) {
  if (scope.kind === "mine" || scope.kind === "jcr") return scope.kind;
  if (scope.kind === "category") return "cat:" + scope.name;
  if (scope.kind === "tag") return "tag:" + scope.name;
  return "";
}

/// 지워진 곳을 가리키는 값을 비운다(바로가기는 "", 처음 보기는 JCR 저널).
/// ctx: { tagIDs, viewIDs, categories(자료에 있는 분야 — 비었으면 분야는 그대로 둔다) }.
/// 숨긴 분야·뺀 색인의 분야는 자료에 있으니 그대로 둔다
export function prunedTokens({ startView, shortcuts }, ctx) {
  const tags = new Set(ctx.tagIDs), views = new Set(ctx.viewIDs), cats = new Set(ctx.categories);
  const keep = (token) => {
    const t = parseToken(token);
    if (!t) return false;
    if (t.kind === "tag") return tags.has(t.id);
    if (t.kind === "view") return views.has(t.id);
    if (t.kind === "category") return !cats.size || cats.has(t.name);
    return true;
  };
  const list = Array.from({ length: SHORTCUT_COUNT }, (_, i) => shortcuts?.[i] ?? "");
  const next = { startView: keep(startView) ? startView : START_DEFAULT, shortcuts: list.map((s) => (s && keep(s) ? s : "")) };
  next.changed = next.startView !== startView || JSON.stringify(next.shortcuts) !== JSON.stringify(shortcuts);
  return next;
}

/// 열 곳: { scope } 또는 { view }(저장한 보기 객체). 없거나 지금 못 보는 곳이면 null(→ JCR 저널).
/// ctx: { tags: [{id}], views: [{id, category}], categories, shows(분야) → 지금 보이는 색인인지 }
export function resolveToken(token, ctx) {
  const t = parseToken(token);
  if (!t) return null;
  if (t.kind === "mine" || t.kind === "jcr") return { scope: { kind: t.kind } };
  if (t.kind === "tag") return ctx.tags.some((x) => x.id === t.id) ? { scope: { kind: "tag", name: t.id } } : null;
  const ok = (c) => ctx.categories.includes(c) && ctx.shows(c);
  if (t.kind === "category") return ok(t.name) ? { scope: { kind: "category", name: t.name } } : null;
  const v = ctx.views.find((x) => x.id === t.id);
  return v && ok(v.category) ? { view: v } : null;
}

/// 바로가기 n(0부터)에 해당하는 키 이름. Windows 앱(Tauri)은 Ctrl, 브라우저는 Alt(Ctrl·⌘+숫자는 브라우저 탭)
export const shortcutKey = (n, tauri) => `${tauri ? "Ctrl" : "Alt"}+${n + 1}`;

/// 키 누름 → 바로가기 번호(0·1·2) 또는 -1. 숫자는 e.code 로(Mac 의 ⌥+숫자는 e.key 가 특수 문자)
export function shortcutIndex(e, tauri) {
  if (e.isComposing || e.shiftKey || e.metaKey) return -1;
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code ?? "");
  if (!m || Number(m[1]) > SHORTCUT_COUNT) return -1;
  const alt = e.altKey && !e.ctrlKey, ctrl = tauri && e.ctrlKey && !e.altKey;
  return alt || ctrl ? Number(m[1]) - 1 : -1;
}
