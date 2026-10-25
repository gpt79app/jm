// 태그: 이름·색을 직접 만들어 저널에 붙인다(여러 개 한꺼번에도). 기본은 추천·비추천.
// 표에서 태그가 붙은 저널 이름은 그 색으로, 회색 태그는 줄을 흐리게 보인다.
// 저장 꼴: { tags: [{ id, name, color }], journals: { 저널 id: [태그 id] } } — 함수들은 이 객체를 바로 고친다

/// 고를 수 있는 색(차례대로)
export const TAG_COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "gray"];
export const TAG_COLOR_NAMES = { red: "빨강", orange: "주황", yellow: "노랑", green: "초록", teal: "청록", blue: "파랑", purple: "보라", pink: "분홍", gray: "회색(흐리게)" };

const defaultTags = () => [{ id: "recommend", name: "추천", color: "green" }, { id: "not-recommend", name: "비추천", color: "gray" }];

/// 저장한 값 → 태그 모음. 없거나 못 읽으면 기본(추천·비추천)
export function tagStoreFrom(raw) {
  if (!raw || !Array.isArray(raw.tags)) return { tags: defaultTags(), journals: {} };
  const tags = raw.tags.filter((t) => t && typeof t.id === "string" && typeof t.name === "string")
    .map((t) => ({ id: t.id, name: t.name, color: TAG_COLORS.includes(t.color) ? t.color : "blue" }));
  const journals = {};
  for (const [k, v] of Object.entries(raw.journals ?? {})) if (Array.isArray(v) && v.length) journals[k] = [...v];
  return { tags, journals };
}

/// 회색 태그 = 보기 싫은 것(줄을 흐리게)
export const dims = (t) => t.color === "gray";

export const tagByID = (store, id) => store.tags.find((t) => t.id === id) ?? null;

/// 저널에 붙은 태그(태그 차례대로). 줄 모양은 앞의 것
export function tagsOf(store, journalID) {
  const ids = store.journals[journalID];
  return ids?.length ? store.tags.filter((t) => ids.includes(t.id)) : [];
}

/// 고른 저널이 모두 이 태그를 가졌는지(메뉴의 체크 표시·붙이기/떼기 판단)
export function allHave(store, tagID, ids) {
  const list = [...ids];
  return list.length > 0 && list.every((id) => store.journals[id]?.includes(tagID));
}

export function setTag(store, tagID, on, ids) {
  if (!tagByID(store, tagID)) return;
  for (const id of ids) {
    let list = store.journals[id] ?? [];
    if (on) { if (!list.includes(tagID)) list = [...list, tagID]; } else list = list.filter((x) => x !== tagID);
    if (list.length) store.journals[id] = list;
    else delete store.journals[id];
  }
}

/// 고른 저널이 모두 가졌으면 떼고, 아니면 모두 붙인다
export function toggleTag(store, tagID, ids) {
  setTag(store, tagID, !allHave(store, tagID, ids), ids);
}

/// 새 태그(맨 뒤에). 만든 태그를 돌려준다
export function addTag(store, name, color, id = crypto.randomUUID()) {
  const t = { id, name, color: TAG_COLORS.includes(color) ? color : "blue" };
  store.tags.push(t);
  return t;
}

export function editTag(store, id, name, color) {
  const t = tagByID(store, id);
  if (!t) return;
  if (name) t.name = name;
  if (TAG_COLORS.includes(color)) t.color = color;
}

/// 태그를 지우면 저널에서도 뗀다
export function removeTag(store, id) {
  store.tags = store.tags.filter((t) => t.id !== id);
  for (const [k, v] of Object.entries(store.journals)) {
    const left = v.filter((x) => x !== id);
    if (left.length) store.journals[k] = left;
    else delete store.journals[k];
  }
}

export function moveTag(store, id, by) {
  const i = store.tags.findIndex((t) => t.id === id);
  if (i < 0) return;
  const j = Math.max(0, Math.min(store.tags.length - 1, i + by));
  store.tags.splice(j, 0, ...store.tags.splice(i, 1));
}
