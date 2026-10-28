// JournalTier — JCR·SCImago 에서 받은 CSV 를 이 브라우저 안에서만 읽어 저널 순위를 한 표로 보여 준다.
import { loadTables, link, importFile, importSummary } from "./core/loader.js";
import { best, categoryLines, displayCategory, displayTitle, editions, inJCR, otherCategories, rankIn, rankText, shortNumber, topOf, topText } from "./core/model.js";
import { categoryEditions, editionNote, effectiveHidden, hidingEditions, mainEditions, reranked, settingEdition } from "./core/ranking.js";
import * as tagOps from "./core/tags.js";
import { TAG_COLORS, TAG_COLOR_NAMES, allHave, dims, isHidden, tagByID, tagStoreFrom, tagsOf } from "./core/tags.js";
import { START_DEFAULT, prunedTokens, resolveToken, shortcutIndex, shortcutKey, tokenFor } from "./core/views.js";
import { SearchIndex, searchQuery, orderedSearchHits } from "./core/search.js";
import { SubcategoryRanks } from "./core/subcategories.js";
import { hangulToQWERTY } from "./core/hangul.js";
import { unzip, isCSVEntry } from "./core/unzip.js";
import * as store from "./storage.js";
import { VirtualTable } from "./ui/table.js";
import { compareHTML, detailHTML } from "./ui/panels.js";
import { exportColumns, printHTML, xlsxFor } from "./ui/export.js";
import { badge, download, esc, fmt3, hideMenu, narrow, showMenu, today } from "./ui/util.js";

const APP = "JournalTier";
/// 계산 값·책임 안내(첫 화면·설정)
const CALCULATED = "ESCI 제외 순위·상위 %·SJR 분류 순위는 이 앱이 계산한 참고용 값입니다. 공식 값은 JCR·SCImago 에서 확인하세요.";
const AS_IS = "이 앱은 있는 그대로 제공되며, 값의 정확성이나 그 사용 결과에 책임지지 않습니다.";
/// JCR 자료 이용 안내(첫 화면·설정)
const CAUTION = "JCR 자료는 Clarivate 의 저작물입니다. 자기 기관의 구독으로 각자 받아 개인 연구용으로만 쓰고, 받은 CSV 를 남에게 나눠 주거나 인터넷에 올리지 마세요. 내보낸 표(Excel·PDF)에도 JCR 값이 들어 있으니 연구·업무용으로만 쓰세요.";
const DEFAULTS = { includeESCI: true, hiddenEditions: [], includeNonJCR: false, dividers: "1, 5, 25, 50, 75", showDividers: true, hiddenCategories: [], columns: null, appearance: "auto", startView: START_DEFAULT, shortcuts: ["", "", ""], hiddenTags: [] };

/// 표의 열(차례는 사용자가 바꾼다)
const COLUMNS = {
  sjrCategoryRank: { title: "SJR 분류 순위", sortKey: "sjrCategoryRankSort", width: 92, min: 70, max: 260,
    help: "SCImago 그 분류 전체에서 SJR 순위(여러 개 골랐으면 가장 좋은 분류)" },
  rank: { title: "순위", sortKey: "topSort", width: 64, min: 56, max: 120 },
  journal: { title: "저널", sortKey: "title", width: 280, min: 200, max: 1000, grow: true },
  jif: { title: "JIF", sortKey: "jifSort", width: 50, min: 40, max: 100, align: "right" },
  category: { title: "가장 좋은 분야", sortKey: "categorySort", width: 170, min: 120, max: 600 },
  edition: { title: "색인", sortKey: "editionSort", width: 58, min: 36, max: 140 },
  quartile: { title: "분위", sortKey: "quartileSort", width: 46, min: 34, max: 80 },
  top: { title: "상위", sortKey: "topSort", width: 58, min: 50, max: 110, align: "right" },
  sjr: { title: "SJR", sortKey: "sjrSort", width: 100, min: 70, max: 180 },
};
const COLUMN_ORDER = ["rank", "journal", "jif", "category", "edition", "quartile", "top", "sjr"];

const S = {
  files: new Map(),
  settings: { ...DEFAULTS },
  favorites: [],
  aliases: "",
  savedViews: [],
  tags: tagStoreFrom(null), // { tags, journals } — core/tags.js
  base: null, // CSV 를 읽은 것(무겁다)
  library: null, // 즐겨찾기·별칭을 맞춘 것
  journals: [], // 보이는 저널(ESCI 를 빼면 다시 매긴 것). library.journals 와 차례·개수가 같다
  withoutESCI: null,
  editions: new Map(), // 분야 → 색인(SCIE·SSCI·AHCI·ESCI)
  index: null,
  indexByID: new Map(),
  categoryCounts: new Map(),
  scope: { kind: "jcr" },
  sub: new Set(),
  subcategories: [],
  query: "",
  sort: { key: "topSort", ascending: true },
  byRelevance: true,
  rows: [],
  selection: new Set(),
  anchor: null,
  compareOrder: [],
  compareColors: new Map(),
  notice: null,
  noticeDetail: null,
  noticeOpen: false,
  loading: true,
  error: null,
  showDetail: true,
  pane: "lists",
  picking: false,
  editCategories: false,
  showHidden: false,
  pendingScroll: null,
  homepages: null, // ISSN → 저널 홈페이지(homepages.json)
};

const $ = (id) => document.getElementById(id);
let table;
let storageError = null;

// MARK: 시작

async function start() {
  table = new VirtualTable($("table"), {
    cell, card, divider: dividerHTML, rowClass,
    onSelect: selectRow,
    onStar: (id) => toggleFavorite(new Set([id])),
    onContext: rowMenu,
    onSort: (col) => {
      if (!col.sortKey) return;
      S.sort = S.sort.key === col.sortKey ? { key: col.sortKey, ascending: !S.sort.ascending } : { key: col.sortKey, ascending: true };
      S.byRelevance = false;
      updateRows();
    },
    onColumns: saveColumns,
    onHeaderContext: headerMenu,
  });
  bindUI();
  render();
  // 저널 홈페이지 목록은 커서(2MB 남짓) 기다리지 않고, 받으면 자세히만 다시 그린다
  fetch("homepages.json").then((r) => (r.ok ? r.json() : null)).then((m) => { if (m) { S.homepages = m; renderInspector(); } }).catch(() => {});
  try {
    const [files, settings, favorites, aliases, savedViews, tags] = await Promise.all([
      store.readFiles(), store.getValue("settings"), store.getValue("favorites"), store.getValue("aliases"), store.getValue("savedViews"), store.getValue("tags")]);
    S.files = files;
    S.settings = { ...DEFAULTS, ...(settings ?? {}) };
    S.favorites = favorites ?? [];
    S.aliases = aliases ?? "";
    S.savedViews = savedViews ?? [];
    S.tags = tagStoreFrom(tags);
    applyTheme();
  } catch (e) {
    storageError = "이 브라우저에 저장할 수 없습니다(개인 정보 보호 창이면 일반 창에서 열어 주세요). " + (e?.message ?? "");
  }
  await reload();
  openToken(S.settings.startView); // 처음 열 때 보기(한 번만)
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
}

/// CSV 를 다시 읽는다(넣거나 지운 뒤)
async function reload() {
  S.loading = true;
  render();
  await new Promise((r) => setTimeout(r, 30)); // 읽는 중 표시를 먼저 그린다
  try {
    S.base = loadTables(S.files);
    S.error = [storageError, ...S.base.warnings].filter(Boolean).join("\n") || null;
    relink();
    // JCR 없이 SCImago 만 넣었으면 SCImago 저널을 보여 준다(안 그러면 목록이 빈다)
    if (!S.library.jcrCategories.length && S.library.journals.length && !S.settings.includeNonJCR) setSetting("includeNonJCR", true, false);
  } catch (e) {
    S.error = "자료를 읽지 못했습니다: " + (e?.message ?? e);
  }
  S.loading = false;
  pruneTokens();
  applyEdition();
}

// MARK: 처음 열 때 보기·바로가기 1·2·3 (core/views.js 의 token)

/// Windows 앱(Tauri) 안이면 바로가기가 Ctrl+숫자(브라우저는 Ctrl·⌘+숫자가 탭 바꾸기라 Alt+숫자)
const inTauri = !!(window.__TAURI_INTERNALS__ || window.__TAURI__);

/// token 이 가리키는 곳으로. 없거나 지금 못 보는 곳(지운 태그·뺀 색인의 분야)이면 JCR 저널. show: 좁은 화면이면 표로 넘어간다
function openToken(token, show = false) {
  const r = resolveToken(token, { tags: S.tags.tags, views: S.savedViews, categories: S.library?.jcrCategories ?? [],
    shows: (c) => showsEdition(S.editions.get(c) ?? "") });
  if (show && narrow()) S.pane = "table";
  if (r?.view) openView(r.view);
  else setScope(r?.scope ?? { kind: "jcr" });
}

function openView(v) {
  S.scope = { kind: "category", name: v.category };
  S.sub = new Set();
  updateSubcategories();
  S.sub = new Set(v.subcategories);
  updateRows();
}

/// 지운 태그·저장한 보기(자료가 있으면 자료에 없는 분야도)를 가리키는 처음 보기·바로가기를 비우고 저장
function pruneTokens() {
  const next = prunedTokens(S.settings, { tagIDs: S.tags.tags.map((t) => t.id), viewIDs: S.savedViews.map((v) => v.id),
    categories: S.library?.jcrCategories ?? [] });
  if (!next.changed) return;
  S.settings.startView = next.startView;
  setSetting("shortcuts", next.shortcuts);
}

/// 이 token 에 걸린 바로가기 키("Alt+1"), 없으면 ""
function shortcutHint(token) {
  const i = token ? S.settings.shortcuts.indexOf(token) : -1;
  return i < 0 ? "" : shortcutKey(i, inTauri);
}

/// 즐겨찾기·별칭을 다시 맞춘다(가볍다)
function relink() {
  S.library = link(S.base, { favorites: S.favorites, aliases: S.aliases });
  S.index = new SearchIndex(S.library.journals);
  S.indexByID = new Map(S.library.journals.map((j, i) => [j.id, i]));
  S.withoutESCI = null;
  S.editions = categoryEditions(S.library.journals);
}

// MARK: 색인 고르기 — SCIE·SSCI·AHCI 는 그 분야를 빼고, ESCI 는 빼면 순위를 다시 계산

const mainEds = () => mainEditions(S.editions);
/// 지금 빼는 색인(자료에 있는 것만)
const hiddenEds = () => effectiveHidden(mainEds(), S.settings.hiddenEditions);
const showsEdition = (e) => (e === "ESCI" ? S.settings.includeESCI : !hiddenEds().includes(e));
/// 제목 아래·내보내기에 붙이는 말("SCIE만 · ESCI 제외 순위"), 없으면 ""
const edNote = () => editionNote(mainEds(), hiddenEds(), S.settings.includeESCI);

/// ESCI 를 빼면 다시 매긴 것, 그 위에 고르지 않은 색인의 분야를 뺀 것
function visibleJournals() {
  const base = S.settings.includeESCI ? S.library.journals : (S.withoutESCI ??= reranked(S.library.journals, true));
  return hidingEditions(base, hiddenEds(), S.editions);
}

function setEdition(e, shown) {
  if (e === "ESCI") setSetting("includeESCI", shown);
  else setSetting("hiddenEditions", settingEdition(mainEds(), hiddenEds(), e, shown));
  // 보던 분야가 빠졌으면 JCR 저널로
  if (S.scope.kind === "category" && !showsEdition(S.editions.get(S.scope.name) ?? "")) {
    S.scope = { kind: "jcr" };
    S.sub = new Set();
  }
  applyEdition();
}

function applyEdition() {
  if (!S.library) return render();
  S.journals = visibleJournals();
  const counts = new Map();
  for (const j of S.journals) for (const c of j.categories) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  S.categoryCounts = counts;
  updateSubcategories();
  updateRows();
}

function updateSubcategories() {
  if (S.scope.kind !== "category") {
    S.subcategories = [];
    return;
  }
  const counts = new Map();
  for (const j of S.journals) {
    if (!rankIn(j, S.scope.name)) continue;
    for (const s of new Set(j.sjrCategories.map((c) => c.name))) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  S.subcategories = [...counts].map(([name, count]) => ({ name, count }))
    .sort((a, b) => (a.count !== b.count ? b.count - a.count : a.name < b.name ? -1 : 1));
}

// MARK: 표 줄 만들기

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const qNum = (q) => Number((q ?? "").slice(1)) || 9;
const SORTS = {
  topSort: (r) => topOf(r.shown) ?? 1000,
  title: (r) => displayTitle(r.journal),
  jifSort: (r) => r.journal.jif ?? -1,
  categorySort: (r) => (r.shown ? displayCategory(r.shown.name) : null),
  editionSort: (r) => editions(r.journal) || null,
  quartileSort: (r) => qNum(r.shown?.quartile),
  sjrSort: (r) => qNum(r.sjrQuartile),
  sjrCategoryRankSort: (r) => (r.sjrCategoryRank ? r.sjrCategoryRank.rank / r.sjrCategoryRank.total : 2),
};

function comparator({ key, ascending }) {
  const f = SORTS[key] ?? SORTS.topSort;
  return (a, b) => {
    const x = f(a), y = f(b);
    let c;
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1; // 없는 값은 늘 뒤에
    if (typeof x === "string") c = collator.compare(x, y);
    else c = x - y;
    return ascending ? c : -c;
  };
}

function dividerThresholds() {
  const v = S.settings.dividers.split(/[,; ]+/).map(Number).filter((x) => Number.isFinite(x) && x > 0 && x < 100);
  return [...new Set(v)].sort((a, b) => a - b);
}

function makeRows() {
  const { journals, scope, sub } = S;
  const nonJCR = S.settings.includeNonJCR;
  const q = S.query ? searchQuery(S.query) : null;
  // 숨긴 태그: 그 태그 목록·검색 중엔 그대로 보인다
  const hiding = !q && scope.kind !== "tag";
  const candidates = [];
  journals.forEach((j, i) => {
    if (!nonJCR && !inJCR(j)) return;
    if (hiding && isHidden(S.tags, j.id, S.settings.hiddenTags)) return;
    if (scope.kind === "mine") {
      if (j.isFavorite) candidates.push(i);
    } else if (scope.kind === "jcr") {
      candidates.push(i);
    } else if (scope.kind === "tag") {
      if (S.tags.journals[j.id]?.includes(scope.name)) candidates.push(i);
    } else if (rankIn(j, scope.name) && (!sub.size || j.sjrCategories.some((c) => sub.has(c.name)))) {
      candidates.push(i);
    }
  });
  // 세부 분류 순위: SCImago 분류 전체 SJR 순(여러 개면 가장 좋은 분류)
  const ranks = sub.size && scope.kind === "category" ? new SubcategoryRanks(sub, candidates.map((i) => journals[i]), journals) : null;
  const row = (i) => {
    const j = journals[i];
    return {
      id: j.id, journal: j, divider: null,
      shown: scope.kind === "category" ? rankIn(j, scope.name) : best(j),
      sjrQuartile: (ranks && ranks.sjrQuartile(j)) ?? j.sjrQuartile,
      sjrCategoryRank: ranks ? ranks.sjrCategoryRank(j) : null,
      tags: tagsOf(S.tags, j.id),
    };
  };
  if (S.index && q) {
    const rows = orderedSearchHits(S.index.search(q, candidates), journals).map((h) => row(h.index));
    return S.byRelevance ? rows : rows.sort(comparator(S.sort));
  }
  const rows = candidates.map(row).sort(comparator(S.sort));
  const thresholds = S.settings.showDividers ? dividerThresholds() : [];
  return scope.kind === "category" && thresholds.length ? withDividers(rows, thresholds) : rows;
}

/// 분야 목록에 상위 % 경계 줄을 끼운다(JCR 분야 전체의 상위 % 기준). 그 순서로 놓였을 때만
function withDividers(rows, thresholds) {
  const metric = rows.map((r) => topOf(r.shown));
  const values = metric.filter((v) => v != null);
  if (values.length <= 1 || values.some((v, i) => i > 0 && values[i - 1] > v)) return rows;
  const out = [];
  let next = 0, seen = false;
  rows.forEach((r, k) => {
    const m = metric[k];
    if (m != null) {
      while (next < thresholds.length && m > thresholds[next]) {
        if (seen) out.push({ id: `divider-${thresholds[next]}`, divider: thresholds[next] });
        next += 1;
      }
      seen = true;
    }
    out.push(r);
  });
  return out;
}

let rowsTimer = null;
/// 표를 다시 만든다. 검색은 글자를 잠깐 멈췄을 때. sameList: 별표만 바뀐 것(스크롤 그대로)
function updateRows({ debounce = false, sameList = false } = {}) {
  clearTimeout(rowsTimer);
  const go = () => {
    S.rows = S.library ? makeRows() : [];
    const ids = new Set(S.rows.map((r) => r.id));
    if (!sameList) table.setRows(S.rows, { sort: S.byRelevance && S.query ? { key: null } : S.sort });
    else table.setRows(S.rows, { sort: S.byRelevance && S.query ? { key: null } : S.sort, keepScroll: true });
    if (S.pendingScroll && ids.has(S.pendingScroll)) {
      const id = S.pendingScroll;
      S.pendingScroll = null;
      requestAnimationFrame(() => table.scrollTo(id));
    }
    render();
  };
  if (debounce) rowsTimer = setTimeout(go, 150);
  else go();
}

// MARK: 표 칸

function cell(col, r) {
  const j = r.journal;
  switch (col.id) {
    case "sjrCategoryRank": {
      const s = r.sjrCategoryRank;
      return s ? `<span class="num" title="SCImago '${esc(s.category)}' 분류 전체에서 SJR 순위">${s.rank}/${s.total}</span>`
        + (S.sub.size > 1 ? `<span class="muted small ellipsis">${esc(s.category)}</span>` : "") : "";
    }
    case "rank":
      return `<span class="num">${esc(rankText(r.shown))}</span>`;
    case "journal":
      return `<button type="button" class="star${j.isFavorite ? " on" : ""}" data-star title="${j.isFavorite ? "즐겨찾기에서 빼기" : "즐겨찾기에 넣기"}">${j.isFavorite ? "★" : "☆"}</button>`
        + `<span class="ellipsis${tagClass(r)}" title="${esc(titleHelp(r))}">${esc(displayTitle(j))}</span>${tagDots(r)}`;
    case "jif":
      return `<span class="num">${esc(j.jifText)}</span>`;
    case "category": {
      const others = otherCategories(j, r.shown).length;
      return `<span class="ellipsis muted" title="${esc(categoryLines(j).join("\n"))}">${r.shown ? esc(displayCategory(r.shown.name)) : ""}</span>`
        + (others ? `<span class="plus" title="${esc(categoryLines(j).join("\n"))}">+${others}</span>` : "");
    }
    case "edition":
      return `<span class="small muted ellipsis" title="${esc(j.categories.map((c) => `${displayCategory(c.name)}: ${c.edition}`).join("\n"))}">${esc(editions(j))}</span>`;
    case "quartile":
      return badge(r.shown?.quartile);
    case "top": {
      const t = topOf(r.shown);
      return t == null ? "" : `<span class="num">${topText(t)}</span>`;
    }
    case "sjr":
      return `${badge(r.sjrQuartile)}<span class="num muted">${fmt3(j.sjr)}</span>`;
    default:
      return "";
  }
}

/// 좁은 화면의 두 줄짜리 줄
function card(r) {
  const j = r.journal, t = topOf(r.shown);
  const mark = S.picking ? `<span class="pick">${S.selection.has(r.id) ? "✓" : ""}</span>` : "";
  return `<div class="card-top">${mark}<button type="button" class="star${j.isFavorite ? " on" : ""}" data-star>${j.isFavorite ? "★" : "☆"}</button>`
    + `<span class="card-rank num">${esc(rankText(r.shown))}</span><span class="card-title ellipsis${tagClass(r)}">${esc(displayTitle(j))}</span>${tagDots(r)}</div>`
    + `<div class="card-sub"><span class="num">JIF <b>${esc(j.jifText || "—")}</b></span>${badge(r.shown?.quartile)}`
    + `${t != null ? `<span class="num">상위 ${topText(t)}</span>` : ""}<span class="ellipsis muted">${r.shown ? esc(displayCategory(r.shown.name)) : ""}</span>`
    + `<span class="push">${badge(r.sjrQuartile)}<span class="num muted">${fmt3(j.sjr)}</span></span></div>`;
}

/// 태그: 앞 태그가 색이면 이름을 그 색으로(회색은 줄을 흐리게 — rowClass), 붙은 태그마다 점
const tagClass = (r) => (r.tags.length && !dims(r.tags[0]) ? ` tag-name tc-${r.tags[0].color}` : "");
const tagDots = (r) => (r.tags.length ? `<span class="tag-dots">${r.tags.map((t) => `<span class="tag-dot tc-${t.color}"></span>`).join("")}</span>` : "");
const titleHelp = (r) => displayTitle(r.journal) + (r.tags.length ? "\n태그: " + r.tags.map((t) => t.name).join(", ") : "");
const rowClass = (r) => (r.tags?.length && dims(r.tags[0]) ? " dim" : "");

function dividerHTML(r) {
  return `<span class="divider-label" title="이 선 위가 이 목록의 상위 ${shortNumber(r.divider)}% (설정에서 바꿈)">▲ 상위 ${shortNumber(r.divider)}%</span><span class="divider-line"></span>`;
}

// MARK: 열(차례·너비·숨김)

function columnState() {
  const c = S.settings.columns ?? {};
  return { order: c.order ?? COLUMN_ORDER, hidden: c.hidden ?? [], widths: c.widths ?? {} };
}

/// 지금 보이는 열 id 차례. 세부 분류를 고르면 'SJR 분류 순위' 열이 생긴다(차례에 없으면 맨 앞)
function visibleColumnIds() {
  const { order, hidden } = columnState();
  const all = [...order.filter((id) => COLUMNS[id]), ...COLUMN_ORDER.filter((id) => !order.includes(id))];
  if (S.sub.size && !all.includes("sjrCategoryRank")) all.unshift("sjrCategoryRank");
  return all.filter((id) => !hidden.includes(id) && (id !== "sjrCategoryRank" || S.sub.size));
}

function tableColumns() {
  const { widths } = columnState();
  const category = S.scope.kind === "category", sub = S.sub.size > 0;
  return visibleColumnIds().map((id) => {
    const d = COLUMNS[id];
    const title = id === "rank" && sub ? "JCR 순위" : id === "category" && category ? "분야" : d.title;
    return { id, ...d, title, width: widths[id] ?? d.width };
  });
}

function saveColumns(columns) {
  const { order, hidden, widths } = columnState();
  const shown = columns.map((c) => c.id);
  // 안 보이는 열(숨긴 열·세부 분류 열)은 원래 자리 근처에 남긴다
  const rest = order.filter((id) => !shown.includes(id));
  const nextWidths = { ...widths };
  for (const c of columns) nextWidths[c.id] = c.width;
  setSetting("columns", { order: [...shown, ...rest], hidden, widths: nextWidths });
}

function headerMenu(e) {
  const { order, hidden, widths } = columnState();
  const ids = [...new Set([...order, ...COLUMN_ORDER])].filter((id) => COLUMNS[id] && id !== "journal" && id !== "sjrCategoryRank");
  showMenu(e.clientX, e.clientY, [
    ...ids.map((id) => ({
      label: COLUMNS[id].title, checked: !hidden.includes(id),
      action: () => {
        const next = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id];
        setSetting("columns", { order, hidden: next, widths });
        render();
      },
    })),
    "-",
    { label: "열 차례·너비 처음대로", action: () => { setSetting("columns", null); render(); } },
  ]);
}

// MARK: 고르기·즐겨찾기

function selectRow(id, e) {
  if (narrow() && !S.picking) {
    S.selection = new Set([id]);
    S.anchor = id;
    S.pane = "detail";
  } else if (S.picking || e.metaKey || e.ctrlKey) {
    const next = new Set(S.selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    S.selection = next;
    S.anchor = id;
  } else if (e.shiftKey && S.anchor) {
    const ids = S.rows.filter((r) => r.divider == null).map((r) => r.id);
    const a = ids.indexOf(S.anchor), b = ids.indexOf(id);
    if (a >= 0 && b >= 0) S.selection = new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
  } else {
    S.selection = new Set([id]);
    S.anchor = id;
  }
  syncCompare();
  table.setSelection(S.selection);
  render();
}

/// 고른 저널이 바뀌면 비교 순서를 맞춘다: 남은 저널은 순서 그대로, 새로 고른 것은 JIF 높은 순으로 뒤에
function syncCompare() {
  S.compareOrder = S.compareOrder.filter((id) => S.selection.has(id));
  for (const id of [...S.compareColors.keys()]) if (!S.selection.has(id)) S.compareColors.delete(id);
  const added = S.journals.filter((j) => S.selection.has(j.id) && !S.compareOrder.includes(j.id)).sort((a, b) => (b.jif ?? -1) - (a.jif ?? -1));
  for (const j of added) {
    S.compareOrder.push(j.id);
    const used = new Set(S.compareColors.values());
    let k = 0;
    while (used.has(k)) k += 1;
    S.compareColors.set(j.id, k);
  }
}

function isFavorite(ids) {
  return ids.size > 0 && [...ids].every((id) => S.journals[S.indexByID.get(id)]?.isFavorite);
}

/// 고른 저널이 모두 즐겨찾기면 빼고, 아니면 모두 넣는다
function toggleFavorite(ids) {
  if (!S.library || !ids.size) return;
  const on = !isFavorite(ids);
  const set = new Set(S.favorites);
  for (const id of ids) on ? set.add(id) : set.delete(id);
  S.favorites = [...set];
  store.setValue("favorites", S.favorites);
  const flip = (list) => list && ids.forEach((id) => {
    const i = S.indexByID.get(id);
    if (i != null) list[i] = { ...list[i], isFavorite: on };
  });
  S.library = { ...S.library, journals: [...S.library.journals] };
  flip(S.library.journals);
  if (S.withoutESCI) flip(S.withoutESCI);
  S.journals = visibleJournals();
  updateRows({ sameList: true }); // 별표만 바뀌었으니 스크롤 그대로
}

function rowMenu(id, e) {
  if (!S.selection.has(id)) {
    S.selection = new Set([id]);
    S.anchor = id;
    syncCompare();
    table.setSelection(S.selection);
    render();
  }
  const ids = new Set([...S.selection].filter((x) => !x.startsWith("divider-")));
  const j = S.journals[S.indexByID.get(id)];
  showMenu(e.clientX, e.clientY, [
    { label: isFavorite(ids) ? "즐겨찾기에서 빼기" : "즐겨찾기에 넣기", action: () => toggleFavorite(ids) },
    { label: "저널 이름 복사", action: () => copyText(displayTitle(j)) },
    "-",
    ...tagItems(ids),
  ]);
}

// MARK: 태그

/// 바꾼 태그를 저장하고 표를 다시 그린다(태그 목록을 보고 있으면 줄이 빠지거나 들어온다)
function changeTags(change) {
  change(S.tags);
  store.setValue("tags", S.tags);
  // 지운 태그는 숨김에서도 뺀다
  const kept = S.settings.hiddenTags.filter((id) => tagByID(S.tags, id));
  if (kept.length !== S.settings.hiddenTags.length) setSetting("hiddenTags", kept);
  pruneTokens();
  if (S.scope.kind === "tag" && !tagByID(S.tags, S.scope.name)) return setScope({ kind: "jcr" });
  updateRows({ sameList: S.scope.kind !== "tag" });
}

/// 메뉴의 태그 칸: 고른 저널이 모두 가졌으면 체크 — 누르면 모두 떼고, 아니면 모두 붙인다
function tagItems(ids) {
  return [
    { header: "태그" + (ids.size > 1 ? ` (${ids.size}개)` : "") },
    ...S.tags.tags.map((t) => ({ label: t.name, color: t.color, checked: allHave(S.tags, t.id, ids), disabled: !ids.size,
      action: () => changeTags((st) => tagOps.toggleTag(st, t.id, ids)) })),
    { label: "새 태그 만들어 붙이기…", disabled: !ids.size, action: () => editTag(null, ids) },
  ];
}

/// 고른 저널(또는 ids)의 태그 메뉴를 단추 아래에
function tagMenu(button, ids = new Set([...S.selection].filter((x) => !x.startsWith("divider-")))) {
  const r = button.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, tagItems(ids));
}

/// 왼쪽 태그의 메뉴
function tagOptions(id, x, y) {
  const t = tagByID(S.tags, id);
  if (!t) return;
  const hidden = S.settings.hiddenTags.includes(id);
  showMenu(x, y, [
    { label: "이 태그 저널 숨기기", checked: hidden, action: () => {
      setSetting("hiddenTags", hidden ? S.settings.hiddenTags.filter((x) => x !== id) : [...S.settings.hiddenTags, id]);
      updateRows();
    } },
    "-",
    { label: "이름·색 바꾸기…", action: () => editTag(t) },
    { label: "위로", disabled: S.tags.tags[0] === t, action: () => changeTags((st) => tagOps.moveTag(st, id, -1)) },
    { label: "아래로", disabled: S.tags.tags.at(-1) === t, action: () => changeTags((st) => tagOps.moveTag(st, id, 1)) },
    "-",
    { label: "태그 지우기", action: () => {
      const n = tagCount(id);
      if (n && !confirm(`‘${t.name}’ 태그를 지울까요? 붙어 있는 저널 ${n}개에서도 떨어집니다.`)) return;
      changeTags((st) => tagOps.removeTag(st, id));
    } },
  ]);
}

/// 지금 목록에 보일 수 있는 저널 중 이 태그가 붙은 수
function tagCount(id) {
  let n = 0;
  for (const [jid, list] of Object.entries(S.tags.journals)) {
    if (!list.includes(id)) continue;
    const j = S.journals[S.indexByID.get(jid)];
    if (j && (S.settings.includeNonJCR || inJCR(j))) n += 1;
  }
  return n;
}

/// 태그 창: tag 가 있으면 그 태그 고치기, 없으면 새로 만들어 ids 에 붙이기
function editTag(tag, ids = new Set()) {
  const d = $("tag-dialog");
  let color = tag?.color ?? "blue";
  const hint = (c) => (c === "gray" ? "회색: 이 태그가 붙은 줄을 흐리게 보여 줍니다." : "이 태그가 붙은 저널 이름을 이 색으로 보여 줍니다.");
  d.innerHTML = `<form method="dialog" class="settings"><h2>${tag ? "태그 고치기" : ids.size ? `새 태그 — 고른 저널 ${ids.size}개에 붙임` : "새 태그"}</h2>
    <input type="text" id="tag-name" placeholder="이름" value="${esc(tag?.name ?? "")}" autocomplete="off">
    <div class="swatches">${TAG_COLORS.map((c) => `<button type="button" class="swatch tc-${c}${c === color ? " on" : ""}" data-color="${c}" title="${TAG_COLOR_NAMES[c]}" aria-label="${TAG_COLOR_NAMES[c]}"></button>`).join("")}</div>
    <p class="small muted" id="tag-hint">${hint(color)}</p>
    <div class="row end"><button value="cancel" class="small-btn">취소</button><button value="save" class="small-btn primary" id="tag-save">${tag ? "저장" : "만들기"}</button></div></form>`;
  const input = d.querySelector("#tag-name"), save = d.querySelector("#tag-save");
  const sync = () => (save.disabled = !input.value.trim());
  sync();
  input.oninput = sync;
  input.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (input.value.trim()) d.close("save");
    }
  };
  d.querySelector(".swatches").onclick = (e) => {
    const b = e.target.closest("[data-color]");
    if (!b) return;
    color = b.dataset.color;
    d.querySelectorAll(".swatch").forEach((x) => x.classList.toggle("on", x === b));
    d.querySelector("#tag-hint").textContent = hint(color);
  };
  d.onclose = () => {
    const name = input.value.trim();
    if (d.returnValue !== "save" || !name) return;
    if (tag) changeTags((st) => tagOps.editTag(st, tag.id, name, color));
    else changeTags((st) => {
      const t = tagOps.addTag(st, name, color);
      if (ids.size) tagOps.setTag(st, t.id, true, ids);
    });
  };
  d.returnValue = "";
  d.showModal();
  input.focus();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    flash("복사됐습니다", text);
  } catch {
    flash("복사하지 못했습니다", "");
  }
}

let flashTimer;
function flash(title, sub) {
  const el = $("flash");
  el.innerHTML = `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}`;
  el.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (el.hidden = true), 1500);
}

// MARK: 보기 바꾸기

function setScope(scope) {
  S.scope = scope;
  S.sub = new Set();
  updateSubcategories();
  updateRows();
}

/// 자세히·비교에서 분야를 누르면 그 분야 전체 목록으로(보던 저널은 고른 채 그 줄로)
function showCategory(name, keepID) {
  S.query = "";
  $("search").value = "";
  $("search-m").value = "";
  if (keepID) {
    S.selection = new Set([keepID]);
    S.pendingScroll = keepID;
    syncCompare();
    table.setSelection(S.selection);
  }
  if (narrow()) S.pane = "table";
  setScope({ kind: "category", name });
}

function setSetting(key, value, save = true) {
  if (value == null) delete S.settings[key];
  else S.settings[key] = value;
  if (key === "columns" && value == null) S.settings.columns = null;
  if (save) store.setValue("settings", S.settings);
}

function setQuery(value) {
  S.query = value;
  S.byRelevance = true;
  updateRows({ debounce: true });
}

/// 제목 아래·내보내기에 붙이는 말: 지금 표에서 숨긴 태그가 있을 때만('비추천 숨김')
function tagNote() {
  if (S.scope.kind === "tag" || (S.query && searchQuery(S.query))) return "";
  const names = S.tags.tags.filter((t) => S.settings.hiddenTags.includes(t.id)).map((t) => t.name);
  return names.length ? names.join("·") + " 숨김" : "";
}

function scopeTitle() {
  if (S.scope.kind === "mine") return "즐겨찾기";
  if (S.scope.kind === "jcr") return S.settings.includeNonJCR ? "전체 저널(SCImago 포함)" : "JCR 저널";
  if (S.scope.kind === "tag") return tagByID(S.tags, S.scope.name)?.name ?? "태그";
  return displayCategory(S.scope.name);
}

// MARK: 넣기(끌어다 놓기·파일 고르기)

/// items: [{ name, file? , text? }] 또는 File 들
async function importItems(items) {
  const messages = [];
  let added = 0;
  const put = async (name, text) => {
    const r = importFile(name, text, S.files);
    if (r.path) {
      S.files.set(r.path, text);
      await store.putFile(r.path, text);
      added += 1;
    }
    messages.push(r.message);
  };
  S.loading = true;
  render();
  for (const it of items) {
    try {
      if (it.files) {
        // 폴더: 안(하위 폴더 포함)의 CSV 를 하나씩
        const csvs = it.files.filter((f) => isCSVEntry(f.path));
        if (!csvs.length) messages.push(`${it.name}: 안에 CSV 가 없습니다.`);
        for (const f of csvs) await put(f.file.name, await f.file.text());
      } else if (it.name.toLowerCase().endsWith(".zip")) {
        let entries;
        try {
          entries = (await unzip(await it.file.arrayBuffer())).filter((e) => isCSVEntry(e.name));
        } catch {
          messages.push(`${it.name}: zip 을 풀지 못했습니다.`);
          continue;
        }
        if (!entries.length) messages.push(`${it.name}: 안에 CSV 가 없습니다.`);
        const dec = new TextDecoder();
        for (const e of entries) await put(e.name.split("/").pop(), dec.decode(e.data));
      } else {
        await put(it.name, await it.file.text());
      }
    } catch (e) {
      messages.push(`${it.name}: ${e?.message ?? e}`);
    }
  }
  S.notice = importSummary(messages);
  S.noticeDetail = messages.length > 1 ? messages : null;
  S.noticeOpen = false;
  if (added) await reload();
  else {
    S.loading = false;
    render();
  }
}

/// 끌어다 놓은 것 → 파일·폴더 목록
async function droppedItems(dt) {
  const entries = [...dt.items].map((i) => (i.kind === "file" && i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
  if (!entries.some(Boolean)) return [...dt.files].map((file) => ({ name: file.name, file }));
  const out = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.isDirectory) out.push({ name: entry.name, files: await walk(entry, entry.name) });
    else out.push({ name: entry.name, file: await new Promise((res, rej) => entry.file(res, rej)) });
  }
  return out;
}

async function walk(dir, prefix) {
  const reader = dir.createReader();
  const all = [];
  for (;;) {
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    all.push(...batch);
  }
  const out = [];
  for (const e of all) {
    const path = `${prefix}/${e.name}`;
    if (e.isDirectory) out.push(...(await walk(e, path)));
    else out.push({ path, file: await new Promise((res, rej) => e.file(res, rej)) });
  }
  return out;
}

// MARK: 내보내기

function exportTable(pdf) {
  if (!S.library) return;
  const picked = [...S.selection].filter((id) => !id.startsWith("divider-"));
  const rows = picked.length > 1 ? S.rows.filter((r) => r.divider == null && S.selection.has(r.id)) : S.rows;
  const columns = exportColumns(visibleColumnIds(), { sub: S.sub.size > 0, many: S.sub.size > 1, category: S.scope.kind === "category" });
  // 태그가 붙은 줄이 있으면 맨 뒤에 태그 칸
  if (rows.some((r) => r.tags?.length)) columns.push({ id: "tags", title: "태그", width: 16, value: (r) => ({ text: r.tags.map((t) => t.name).join(", ") }) });
  const title = S.scope.kind === "jcr" ? (S.settings.includeNonJCR ? "전체 저널" : "JCR 저널") : scopeTitle();
  const name = `${APP} - ${title.replaceAll("/", "-")} - ${today()}`;
  if (!pdf) {
    download(name + ".xlsx", xlsxFor(title, columns, rows), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    S.notice = `내보냈습니다: ${name}.xlsx`;
    S.noticeDetail = null;
    return render();
  }
  const subs = S.subcategories.map((s) => s.name).filter((n) => S.sub.has(n));
  const parts = [`${rows.filter((r) => r.divider == null).length}개` + (picked.length > 1 ? "(고른 것)" : "")];
  if (subs.length) parts.push("SCImago 세부 분류: " + subs.join(", "));
  if (S.query) parts.push(`검색 '${S.query}'`);
  if (tagNote()) parts.push(tagNote());
  parts.push(yearsText() + (edNote() ? " · " + edNote() : ""));
  parts.push(today());
  $("print").innerHTML = printHTML(title, parts.join(" · "), columns, rows);
  const old = document.title;
  document.title = name; // 'PDF 로 저장' 의 기본 파일 이름
  addEventListener("afterprint", () => (document.title = old), { once: true });
  window.print();
}

function yearsText() {
  const lib = S.library;
  return [lib?.jcrYear != null && `JCR ${lib.jcrYear}`, lib?.sjrYear != null && `SCImago ${lib.sjrYear}`].filter(Boolean).join(" · ");
}

// MARK: 그리기

function render() {
  const app = $("app");
  const isNarrow = narrow();
  app.dataset.pane = S.pane;
  app.classList.toggle("no-detail", !S.showDetail);
  app.classList.toggle("picking", S.picking);
  table.setCards(isNarrow);
  renderSidebar();
  renderToolbar();
  renderSubbar();
  renderBody();
  renderInspector();
}

const hintLine = (token) => (shortcutHint(token) ? `\n바로가기 ${shortcutHint(token)}` : "");

function renderSidebar() {
  const lib = S.library;
  const js = S.journals;
  const nonJCR = S.settings.includeNonJCR;
  const sel = (scope) => (S.scope.kind === scope.kind && S.scope.name === scope.name ? " active" : "");
  const item = (scope, label, count, icon = "") =>
    `<button type="button" class="side-item${sel(scope)}" data-scope='${esc(JSON.stringify(scope))}'>${icon}<span class="ellipsis" title="${esc((scope.kind === "category" ? scope.name : label) + hintLine(tokenFor(scope)))}">${esc(label)}</span><span class="count">${count}</span></button>`;
  let html = '<div class="side-section"><div class="side-label">보기</div>'
    + item({ kind: "mine" }, "즐겨찾기", js.filter((j) => j.isFavorite && (nonJCR || inJCR(j))).length, '<span class="ico">☆</span>')
    + item({ kind: "jcr" }, nonJCR ? "전체 저널" : "JCR 저널", nonJCR ? js.length : js.filter(inJCR).length, '<span class="ico">▤</span>')
    + "</div>";
  // 태그: 누르면 그 태그가 붙은 저널, ⋯·오른쪽 클릭으로 고치기
  if (lib?.journals.length) {
    html += '<div class="side-section"><div class="side-label">태그</div>' + S.tags.tags.map((t) =>
      `<div class="side-view">${item({ kind: "tag", name: t.id }, t.name + (S.settings.hiddenTags.includes(t.id) ? " (숨김)" : ""), tagCount(t.id), `<span class="ico"><span class="tag-dot tc-${t.color}"></span></span>`)}
        <button type="button" class="icon del" data-tagopts="${esc(t.id)}" title="숨기기·이름·색 바꾸기·차례·지우기">⋯</button></div>`).join("")
      + '<button type="button" class="side-item faint" data-newtag><span class="ico">＋</span><span>새 태그…</span></button></div>';
  }
  if (S.savedViews.length) {
    html += '<div class="side-section"><div class="side-label">저장한 보기</div>' + S.savedViews.map((v) =>
      `<div class="side-view"><button type="button" class="side-item" data-view="${esc(v.id)}" title="${esc(displayCategory(v.category) + "\n" + v.subcategories.join("\n") + hintLine("view:" + v.id))}">
        <span class="ico">🔖</span><span class="two"><span class="ellipsis">${esc(v.name)}</span><span class="small muted ellipsis">${esc(displayCategory(v.category))} · ${v.subcategories.length}개 분류</span></span></button>
        <button type="button" class="icon del" data-delview="${esc(v.id)}" title="지우기">✕</button></div>`).join("") + "</div>";
  }
  // 자료가 없으면(처음) 목록에서도 넣는 법으로 — 좁은 화면은 첫 화면이 이 목록이다
  if (lib && !lib.journals.length && !S.loading) {
    html += `<div class="side-empty"><b>아직 자료가 없습니다</b><p class="small muted">JCR·SCImago 에서 CSV 를 받아 넣으면 됩니다.</p>
      <button type="button" class="small-btn primary" data-help>넣는 법</button><button type="button" class="small-btn" data-pickfiles>파일 고르기…</button></div>`;
  }
  // 고르지 않은 색인의 분야는 목록에서도 뺀다
  const cats = (lib?.jcrCategories ?? []).filter((c) => showsEdition(S.editions.get(c) ?? ""));
  const hidden = new Set(S.settings.hiddenCategories);
  if (cats.length) {
    const edit = S.editCategories;
    html += `<div class="side-section"><div class="side-label">JCR ${esc(lib.jcrYear ?? "")} 분야${edNote() ? " · " + esc(edNote()) : ""}
      <button type="button" class="link small push" data-edit>${edit ? "끝" : "편집"}</button></div>`
      + cats.filter((c) => !hidden.has(c)).map((c) => `<div class="side-cat">${item({ kind: "category", name: c }, displayCategory(c), S.categoryCounts.get(c) ?? 0)}`
        + (edit ? `<button type="button" class="small-btn" data-hide="${esc(c)}">숨기기</button>` : "") + "</div>").join("");
    const hiddenList = cats.filter((c) => hidden.has(c));
    if (hiddenList.length) {
      html += `<details class="side-hidden"${S.showHidden ? " open" : ""}><summary class="side-label">숨긴 분야 ${hiddenList.length}개</summary>`
        + hiddenList.map((c) => `<div class="side-cat faded">${item({ kind: "category", name: c }, displayCategory(c), S.categoryCounts.get(c) ?? 0)}`
          + (edit ? `<button type="button" class="small-btn" data-show="${esc(c)}">보이기</button>` : "") + "</div>").join("") + "</details>";
    }
    html += "</div>";
  }
  $("side-list").innerHTML = html;

  let foot = "";
  if (S.loading) foot += '<div class="spinner" title="읽는 중"></div>';
  if (S.error) foot += `<div class="error">${esc(S.error)}</div>`;
  if (lib?.unresolvedNames.length) {
    foot += `<button type="button" class="link" data-aliases title="${esc(lib.unresolvedNames.join("\n") + "\n\n(즐겨찾기·별칭 이름) 설정의 별칭에 '이름 = 정식 이름 또는 ISSN' 으로 적어 주세요.")}">못 찾은 이름 ${lib.unresolvedNames.length}개</button>`;
  }
  if (S.notice) {
    const detail = S.noticeDetail;
    foot += `<div class="notice" data-notice title="${esc(detail ? detail.join("\n") : S.notice)}">${esc(S.notice)}${detail ? ` <span class="faint">${S.noticeOpen ? "▴" : "▾"}</span>` : ""}</div>`;
    if (detail && S.noticeOpen) foot += `<ul class="notice-list">${detail.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>`;
  }
  foot += `<div class="foot-row"><span class="muted" title="새 자료는 JCR·SCImago 에서 받은 CSV 를 이 창에 끌어다 놓으면 들어갑니다(zip·폴더째도).">${esc(yearsText())}</span>`
    + '<button type="button" class="link small push" data-help>넣는 법</button><button type="button" class="small-btn" data-pickfiles>파일 넣기…</button></div>';
  $("side-foot").innerHTML = foot;
}

function renderToolbar() {
  const count = S.rows.filter((r) => r.divider == null).length;
  const hq = hangulToQWERTY(S.query);
  $("title").textContent = scopeTitle();
  $("subtitle").textContent = S.library?.journals.length
    ? `${count}개` + (edNote() ? " · " + edNote() : "") + (tagNote() ? " · " + tagNote() : "") + (hq ? ` · ‘${hq.toLowerCase()}’ 로 찾음` : "") : "";
  const nonJCR = $("btn-nonjcr"), edition = $("btn-edition");
  nonJCR.classList.toggle("on", S.settings.includeNonJCR);
  nonJCR.title = S.settings.includeNonJCR ? "받아 둔 JCR 분야에 없는(SCImago 에만 있는) 저널도 보이는 중. 누르면 JCR 저널만"
    : "JCR 저널만 보이는 중. 누르면 SCImago 에만 있는 저널도 목록·검색에 넣는다";
  // 색인 단추: 다 보이면 '색인', 아니면 보이는 것(SCIE·ESCI)
  const eds = [...mainEds(), "ESCI"], shownEds = eds.filter(showsEdition);
  edition.textContent = (shownEds.length === eds.length ? "색인" : shownEds.join("·")) + " ▾";
  edition.classList.toggle("on", shownEds.length !== eds.length);
  $("btn-pick").classList.toggle("on", S.picking);
  $("btn-pick").textContent = S.picking ? "끝" : "고르기";
  const picked = [...S.selection].filter((id) => !id.startsWith("divider-")).length;
  const fab = $("btn-compare");
  fab.hidden = !(narrow() && S.picking && picked > 1);
  fab.textContent = `비교 ${picked}개`;
  $("btn-tagsel").hidden = !(narrow() && S.picking && picked > 0);
  // 좁은 화면: 정렬 고르기
  const cols = tableColumns().filter((c) => c.sortKey);
  const keys = [...new Map(cols.map((c) => [c.sortKey, c.title])).entries()];
  $("sortbar").innerHTML = `<label>정렬 <select id="sort-select">${keys.map(([k, t]) => `<option value="${k}"${S.sort.key === k && !(S.byRelevance && S.query) ? " selected" : ""}>${esc(t)}</option>`).join("")}`
    + `${S.byRelevance && S.query ? '<option value="" selected>비슷한 순</option>' : ""}</select></label>`
    + `<button type="button" class="small-btn" data-sortdir>${S.sort.ascending ? "▲ 오름" : "▼ 내림"}</button>`;
}

function renderSubbar() {
  const bar = $("subbar");
  if (S.scope.kind !== "category" || !S.subcategories.length || !S.library?.journals.length) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const chosen = S.subcategories.map((s) => s.name).filter((n) => S.sub.has(n));
  const summary = chosen.length === 0 ? "전체" : chosen.length === 1 ? chosen[0] : `${chosen.length}개 — ${chosen.join(", ")}`;
  bar.innerHTML = `<span class="muted">SCImago 세부 분류</span>
    <button type="button" class="sub-btn" data-subpicker><span class="ellipsis">${esc(summary)}</span> ▾</button>
    ${chosen.length ? '<button type="button" class="link" data-subclear>풀기</button><button type="button" class="link" data-saveview title="이 분야와 고른 세부 분류를 이름 붙여 저장 — 왼쪽 \'저장한 보기\'">보기로 저장…</button>' : ""}
    <span class="faint small push only-wide">SJR 분류 순위 = SCImago 분류 전체 SJR 순(여러 개면 가장 좋은 분류) · JCR 순위·분위·상위 %·구분선 = JCR 분야 전체 기준</span>`;
}

function subPicker(anchor) {
  const pop = $("popover");
  const r = anchor.getBoundingClientRect();
  pop.className = "popover";
  pop.innerHTML = `<div class="pop-head"><span class="small muted">하나라도 속한 저널</span><button type="button" class="link push" data-subclear ${S.sub.size ? "" : "disabled"}>모두 풀기</button></div>
    <div class="pop-list">${S.subcategories.map((s) => `<label class="check-row"><input type="checkbox" data-sub="${esc(s.name)}"${S.sub.has(s.name) ? " checked" : ""}> <span class="ellipsis">${esc(s.name)} (${s.count})</span></label>`).join("")}</div>`;
  pop.hidden = false;
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - 400)) + "px";
  pop.style.top = r.bottom + 6 + "px";
}

/// 색인 고르기(툴바): SCIE·SSCI·AHCI 는 그 분야를 목록·'가장 좋은 분야'에서 빼고, ESCI 는 빼면 남은 저널끼리 순위를 다시 계산
function editionPicker(anchor) {
  const pop = $("popover");
  const r = anchor.getBoundingClientRect();
  const main = mainEds(), hidden = hiddenEds();
  const last = main.filter((e) => !hidden.includes(e)).length === 1;
  pop.className = "popover pop-small";
  pop.innerHTML = `<div class="pop-list">${main.map((e) => {
    const on = !hidden.includes(e);
    return `<label class="check-row"${on && last ? ' title="색인을 하나는 남겨야 합니다"' : ""}><input type="checkbox" data-edition="${e}"${on ? " checked" : ""}${on && last ? " disabled" : ""}> ${e}</label>`;
  }).join("")}
    <label class="check-row"><input type="checkbox" data-edition="ESCI"${S.settings.includeESCI ? " checked" : ""}> ESCI 포함</label></div>
    <p class="small muted pop-note">SCIE·SSCI 를 빼면 그 분야가 목록과 '가장 좋은 분야'에서 빠집니다. ESCI 를 빼면 남은 저널끼리 순위를 다시 계산합니다.</p>`;
  pop.hidden = false;
  const w = pop.offsetWidth;
  pop.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
  pop.style.top = r.bottom + 6 + "px";
}

function renderBody() {
  const empty = $("table-empty"), guide = $("guide");
  const noData = S.library && !S.library.journals.length && !S.loading;
  guide.hidden = !noData;
  if (noData) guide.innerHTML = guideHTML();
  $("table").hidden = noData;
  table.setColumns(tableColumns());
  let msg = "";
  if (S.loading && !S.library) msg = '<p class="muted">자료를 읽는 중…</p>';
  else if (S.library && !noData && !S.rows.length) {
    if (S.scope.kind === "mine" && !S.query) {
      msg = '<p class="muted">즐겨찾기가 비어 있어요.</p><p class="small muted">저널 이름 앞 ☆ 이나 오른쪽 클릭으로 넣습니다.</p><button type="button" data-scope=\'{"kind":"jcr"}\'>JCR 저널 보기</button>';
    } else if (S.query && (!S.settings.includeNonJCR || S.scope.kind !== "jcr")) {
      msg = `<p class="muted">‘${esc(S.query)}’ 이(가) 이 목록에 없습니다.</p><button type="button" data-searchall>SCImago 포함 전체에서 찾기</button>`;
    } else msg = '<p class="muted">저널이 없습니다.</p>';
  }
  empty.hidden = !msg;
  empty.innerHTML = msg;
}

const JCR_URL = "https://jcr.clarivate.com";
const SJR_URL = "https://www.scimagojr.com/journalrank.php";
const anchor = (url, text) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;

/// 자료 넣는 법(첫 화면·'자료 넣기' 창 같이 씀) — 짧게: 받아서 끌어다 놓기
function dataGuideSteps() {
  return `<ol class="simple">
    <li>${anchor(JCR_URL, "JCR")}(분야별)과 ${anchor(SJR_URL, "SCImago")}(전체)에서 CSV 를 내려받습니다.</li>
    <li>받은 파일을 이 창에 끌어다 놓습니다. 휴대폰은 <b>파일 고르기</b>로 넣습니다.</li></ol>`;
}

function dataGuideNotes() {
  return '<p class="caution">⚠︎ JCR 자료는 각자 기관 구독으로 받아 개인 연구용으로만 쓰고, 남에게 나눠 주거나 올리지 마세요.</p>';
}

function guideHTML() {
  return `<div class="guide-box"><h2>자료 넣기</h2>
    ${dataGuideSteps()}
    <div class="row"><button type="button" class="primary" data-pickfiles>파일 고르기…</button></div>
    ${dataGuideNotes()}</div>`;
}

// MARK: 화면 밝기(자동·밝게·어둡게)

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const isDark = () => (S.settings.appearance === "auto" ? darkQuery.matches : S.settings.appearance === "dark");

/// <html data-theme> 와 첫 그리기용 사본(localStorage), 툴바 단추 모양
function applyTheme() {
  const a = S.settings.appearance;
  if (a === "light" || a === "dark") document.documentElement.dataset.theme = a;
  else delete document.documentElement.dataset.theme;
  try {
    if (a === "light" || a === "dark") localStorage.setItem("jm-theme", a);
    else localStorage.removeItem("jm-theme");
  } catch {}
  for (const id of ["btn-theme", "btn-theme-m"]) {
    $(id).textContent = isDark() ? "☀︎" : "☾";
    $(id).title = (isDark() ? "밝게" : "어둡게") + " (설정에서 '자동'으로 되돌림)";
  }
}

function setAppearance(a) {
  setSetting("appearance", a);
  applyTheme();
}

// MARK: 홈 화면에 추가(설정 안)

/// 크롬·엣지가 주는 설치 기회를 잡아 두었다가 설정의 '지금 설치' 로
let installPrompt = null;
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
});

function installHTML() {
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone || /Electron\//.test(navigator.userAgent) || location.hostname === "tauri.localhost" || location.protocol === "tauri:") return '<p class="small muted">지금 앱으로 열려 있습니다.</p>';
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const ways = [
    ["ios", "아이폰·아이패드", "Safari 의 공유 단추(⬆︎) → <b>홈 화면에 추가</b> → <b>추가</b>"],
    ["android", "안드로이드", "Chrome 오른쪽 위 ⋮ → <b>홈 화면에 추가</b>(또는 <b>앱 설치</b>)"],
    ["desktop", "컴퓨터", "Chrome·Edge 는 주소창 오른쪽 설치 아이콘 또는 메뉴 → <b>앱 설치</b>, Mac Safari 는 파일 → <b>Dock 에 추가</b>"],
  ];
  const mine = ios ? "ios" : android ? "android" : "desktop";
  const [, name, how] = ways.find((w) => w[0] === mine);
  return `<p class="small">홈 화면(바탕화면)에 아이콘으로 두고 앱처럼 열 수 있습니다. 한 번 열면 인터넷 없이도 열립니다.</p>
    <p class="small"><b>${name}</b>: ${how}</p>
    ${installPrompt ? '<div class="row"><button type="button" class="small-btn primary" id="set-install">지금 설치</button></div>' : ""}
    <p class="small muted">${ways.filter((w) => w[0] !== mine).map(([, n, h]) => `${n}: ${h}`).join("<br>")}</p>`;
}

/// '자료 넣는 법' 창(언제든)
function openHelp() {
  const d = $("help");
  d.innerHTML = `<form method="dialog" class="settings help">
    <div class="dlg-head"><h2>자료 넣기</h2><button class="icon" value="close" title="닫기">✕</button></div>
    ${dataGuideSteps()}
    <div class="row"><button type="button" class="small-btn primary" data-pickfiles>파일 고르기…</button></div>
    ${dataGuideNotes()}
  </form>`;
  d.querySelectorAll("[data-pickfiles]").forEach((b) => (b.onclick = () => { d.close(); $("file-input").click(); }));
  d.showModal();
}

function renderInspector() {
  const el = $("inspector");
  const chosen = S.journals.filter((j) => S.selection.has(j.id));
  const years = { jcrYear: (S.library?.jcrYear ?? "") + (edNote() ? " · " + edNote() : ""), sjrYear: S.library?.sjrYear ?? "" };
  const back = '<div class="insp-head only-narrow"><button type="button" class="back" data-back>‹ 목록</button></div>';
  if (chosen.length === 1) {
    const j = chosen[0];
    const i = S.indexByID.get(j.id);
    // 고른 색인 때문에 분야가 다 빠진 저널인지(ESCI 를 빼면 순위에서도 빠진다)
    const dropped = !inJCR(j) && inJCR(S.library.journals[i]);
    const droppedNote = !dropped ? null : S.settings.includeESCI || editions(S.library.journals[i]) !== "ESCI"
      ? `지금 고른 색인(${edNote()})에는 이 저널의 분야가 없습니다.` : "ESCI 저널이라 지금(ESCI 제외)은 순위에서 빠져 있습니다.";
    el.innerHTML = back + detailHTML(j, { ...years, droppedNote, categoryCount: S.library.jcrCategories.length, tags: tagsOf(S.tags, j.id),
      homepage: S.homepages?.[j.issn] ?? S.homepages?.[j.eissn] });
  } else if (chosen.length > 1) {
    const byID = new Map(chosen.map((j) => [j.id, j]));
    el.innerHTML = back + compareHTML(S.compareOrder.map((id) => byID.get(id)).filter(Boolean), S.compareColors, { jcrYear: S.library?.jcrYear ?? "", sjrYear: S.library?.sjrYear ?? "" });
  } else {
    el.innerHTML = back + '<div class="insp-empty muted"><p>저널을 고르면 분야별 순위가 나옵니다.</p><p class="small">⌘(Ctrl)-클릭으로 여러 개 고르면 비교합니다.</p></div>';
  }
}

// MARK: 설정 창

function openSettings(focusAliases = false) {
  const d = $("settings");
  const s = S.settings;
  const lib = S.library;
  const jcrFiles = [...S.files.keys()].filter((p) => p.startsWith("JCR-")).length;
  const sjrFiles = [...S.files.keys()].filter((p) => p.startsWith("SCImago-")).length;
  d.innerHTML = `<form method="dialog" class="settings">
    <div class="dlg-head"><h2>설정</h2><button class="icon" value="close" title="닫기">✕</button></div>
    <section><h3>분야 목록 구분선</h3>
      <label class="check-row"><input type="checkbox" id="set-showdiv"${s.showDividers ? " checked" : ""}> 상위 % 구분선 보이기</label>
      <input type="text" id="set-dividers" value="${esc(s.dividers)}"${s.showDividers ? "" : " disabled"}>
      <p class="small muted">쉼표로 나눠 적습니다. 예: 1, 5, 25, 50, 75 — 25·50·75 는 JCR Q1·Q2·Q3 경계와 같습니다. 세부 분류로 좁혀도 늘 JCR 분야 전체 기준입니다.</p></section>
    <section><h3>목록</h3>
      <label class="check-row"><input type="checkbox" id="set-nonjcr"${s.includeNonJCR ? " checked" : ""}> SCImago 에만 있는 저널도 보이기</label>
      ${mainEds().map((e) => `<label class="check-row"><input type="checkbox" data-setedition="${e}"> ${e} 분야 보이기</label>`).join("")}
      <label class="check-row"><input type="checkbox" id="set-esci"${s.includeESCI ? " checked" : ""}> ESCI 포함(끄면 SCIE·SSCI 끼리 순위 다시 계산)</label></section>
    <section><h3>시작·바로가기</h3>
      <label class="pick-row">처음 열 때 <select id="set-start">${tokenOptions(s.startView, false)}</select></label>
      ${s.shortcuts.map((t, i) => `<label class="pick-row">바로가기 ${i + 1} <span class="faint">(${shortcutKey(i, inTauri)})</span> <select data-shortcut="${i}">${tokenOptions(t, true)}</select></label>`).join("")}
      <p class="small muted">${inTauri ? "Ctrl(또는 Alt)" : "Alt(Mac 은 ⌥)"}+1·2·3 으로 바로 엽니다. 지운 태그·저장한 보기를 가리키던 칸은 저절로 비워집니다.</p></section>
    <section><h3>별칭</h3>
      <p class="small muted">한 줄에 하나: <code>다른 이름 = 저널 이름 또는 ISSN</code>. 검색에서 그 이름으로도 찾습니다. # 뒤는 설명.</p>
      <textarea id="set-aliases" rows="5" spellcheck="false" placeholder="JDE = Journal of Differential Equations">${esc(S.aliases)}</textarea>
      ${lib?.unresolvedNames.length ? `<p class="small error">못 찾은 이름: ${esc(lib.unresolvedNames.join(", "))}</p>` : ""}
      <button type="button" class="small-btn" id="set-aliases-save">별칭 저장</button></section>
    <section><h3>자료</h3>
      <p class="small">${lib?.jcrYear != null ? `JCR ${lib.jcrYear} · 분야 ${lib.jcrCategories.length}개(CSV ${jcrFiles}개)` : "JCR 없음"} · ${lib?.sjrYear != null ? `SCImago ${lib.sjrYear}(CSV ${sjrFiles}개)` : "SCImago 없음"}</p>
      <p class="small muted">자료·설정·즐겨찾기·태그는 이 브라우저 안에만 저장되고 어디로도 보내지 않습니다. 다른 기기·브라우저에선 다시 넣어야 합니다.</p>
      <div class="row"><button type="button" class="small-btn" data-pickfiles>파일 넣기…</button>
      <button type="button" class="small-btn" id="set-help">자료 넣기</button>
      <button type="button" class="small-btn danger" id="set-clear">자료 모두 지우기</button></div></section>
    <section><h3>화면</h3>
      <div class="row">${[["auto", "자동(기기 따라)"], ["light", "밝게"], ["dark", "어둡게"]].map(([v, t]) =>
        `<label class="check-row"><input type="radio" name="set-appearance" value="${v}"${s.appearance === v ? " checked" : ""}> ${t}</label>`).join("")}</div></section>
    ${inTauri ? `<section><h3>업데이트</h3>
      <p class="small muted">켤 때 저절로 확인하고, 새 버전이 있으면 설치할지 묻습니다.</p>
      <div class="row"><button type="button" class="small-btn" id="set-update">업데이트 확인</button></div></section>`
    : `<section><h3>홈 화면에 추가</h3>
      ${installHTML()}</section>`}
    <section><h3>이용 안내</h3>
      <p class="small caution">${CAUTION}</p>
      <p class="small muted">${CALCULATED}</p>
      <p class="small muted">${AS_IS}</p>
      <p class="small muted">SCImago 자료는 SCImago Journal &amp; Country Rank(scimagojr.com)의 공개 자료입니다. 쓸 때 출처를 밝혀 주세요.</p>
      <p class="small muted">Journal Citation Reports(JCR)는 Clarivate 의 상표입니다. 이 앱은 Clarivate·SCImago 와 관계없습니다.</p></section>
  </form>`;
  d.showModal();
  if (focusAliases) d.querySelector("#set-aliases").focus();
  d.querySelector("#set-showdiv").onchange = (e) => {
    setSetting("showDividers", e.target.checked);
    d.querySelector("#set-dividers").disabled = !e.target.checked;
    updateRows({ sameList: true });
  };
  d.querySelector("#set-dividers").oninput = (e) => {
    setSetting("dividers", e.target.value);
    updateRows({ sameList: true, debounce: true });
  };
  d.querySelector("#set-nonjcr").onchange = (e) => {
    setSetting("includeNonJCR", e.target.checked);
    updateRows();
  };
  d.querySelector("#set-esci").onchange = (e) => setEdition("ESCI", e.target.checked);
  // 색인마다 보이기(남는 색인이 없게는 못 끔)
  const editionBoxes = [...d.querySelectorAll("[data-setedition]")];
  const syncEditions = () => {
    const hidden = hiddenEds(), left = mainEds().filter((e) => !hidden.includes(e)).length;
    for (const b of editionBoxes) {
      b.checked = !hidden.includes(b.dataset.setedition);
      b.disabled = b.checked && left === 1;
    }
  };
  syncEditions();
  for (const b of editionBoxes) b.onchange = () => {
    setEdition(b.dataset.setedition, b.checked);
    syncEditions();
  };
  // Windows 앱(Tauri): 지금 새 버전 확인 — 결과(설치할지·최신·실패)는 앱이 창으로 알린다
  const upd = d.querySelector("#set-update");
  if (upd) upd.onclick = async () => {
    upd.disabled = true;
    upd.textContent = "확인 중…";
    try { await window.__TAURI_INTERNALS__.invoke("check_update_now"); } catch { flash("업데이트를 확인하지 못했습니다", ""); }
    upd.disabled = false;
    upd.textContent = "업데이트 확인";
  };
  d.querySelector("#set-start").onchange = (e) => setSetting("startView", e.target.value);
  d.querySelectorAll("[data-shortcut]").forEach((sel) => (sel.onchange = () => {
    const next = [...S.settings.shortcuts];
    next[Number(sel.dataset.shortcut)] = sel.value;
    setSetting("shortcuts", next);
    render(); // 왼쪽 툴팁의 키
  }));
  d.querySelector("#set-aliases-save").onclick = () => {
    S.aliases = d.querySelector("#set-aliases").value;
    store.setValue("aliases", S.aliases);
    if (S.base) {
      relink();
      applyEdition();
    }
    openSettings();
  };
  d.querySelector("[data-pickfiles]").onclick = () => { d.close(); $("file-input").click(); };
  d.querySelector("#set-help").onclick = () => { d.close(); openHelp(); };
  d.querySelectorAll('input[name="set-appearance"]').forEach((r) => (r.onchange = () => setAppearance(r.value)));
  const install = d.querySelector("#set-install");
  if (install) install.onclick = async () => {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    openSettings();
  };
  d.querySelector("#set-clear").onclick = async () => {
    if (!confirm("넣은 JCR·SCImago 자료를 이 브라우저에서 모두 지울까요? (설정·즐겨찾기·태그는 남습니다)")) return;
    await store.clearFiles();
    S.files = new Map();
    S.selection = new Set();
    d.close();
    await reload();
  };
}

/// 처음 보기·바로가기 고르기 칸: 즐겨찾기·JCR 저널·태그·저장한 보기·JCR 분야(none: '없음' 칸)
function tokenOptions(current, none) {
  const opt = (v, t) => `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(t)}</option>`;
  const group = (label, items) => (items.length ? `<optgroup label="${label}">${items.join("")}</optgroup>` : "");
  return (none ? opt("", "없음") : "") + opt("mine", "즐겨찾기") + opt("jcr", "JCR 저널")
    + group("태그", S.tags.tags.map((t) => opt("tag:" + t.id, t.name)))
    + group("저장한 보기", S.savedViews.map((v) => opt("view:" + v.id, v.name)))
    + group("JCR 분야", (S.library?.jcrCategories ?? []).map((c) => opt("cat:" + c, displayCategory(c))));
}

function askName(defaultName, onSave) {
  const d = $("name-dialog");
  d.innerHTML = `<form method="dialog" class="settings"><h2>보기로 저장</h2>
    <p class="small muted">${esc(displayCategory(S.scope.name ?? ""))} · 세부 분류 ${S.sub.size}개</p>
    <input type="text" id="view-name" value="${esc(defaultName)}">
    <div class="row end"><button value="cancel" class="small-btn">취소</button><button value="save" class="small-btn primary">저장</button></div></form>`;
  d.showModal();
  const input = d.querySelector("#view-name");
  input.select();
  input.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      d.close("save");
    }
  };
  d.onclose = () => {
    if (d.returnValue === "save") onSave(d.querySelector("#view-name").value.trim());
  };
}

// MARK: 이벤트

function bindUI() {
  const app = $("app");
  // 버튼들(그려질 때마다 바뀌는 것은 위임)
  app.addEventListener("click", (e) => {
    const t = e.target.closest("button, [data-notice], summary");
    if (!t) return;
    const d = t.dataset;
    if (d.scope) {
      setScope(JSON.parse(d.scope));
      if (narrow()) S.pane = "table";
      render();
    } else if (d.view) {
      const v = S.savedViews.find((x) => x.id === d.view);
      if (!v) return;
      if (narrow()) S.pane = "table";
      openView(v);
    } else if (d.delview) {
      S.savedViews = S.savedViews.filter((x) => x.id !== d.delview);
      store.setValue("savedViews", S.savedViews);
      pruneTokens();
      render();
    } else if (d.edit != null) {
      S.editCategories = !S.editCategories;
      render();
    } else if (d.hide) {
      setSetting("hiddenCategories", [...new Set([...S.settings.hiddenCategories, d.hide])].sort());
      render();
    } else if (d.show) {
      setSetting("hiddenCategories", S.settings.hiddenCategories.filter((c) => c !== d.show));
      render();
    } else if (d.notice != null) {
      if (S.noticeDetail && !S.noticeOpen) S.noticeOpen = true;
      else S.notice = S.noticeDetail = null;
      render();
    } else if (d.aliases != null) {
      openSettings(true);
    } else if (d.pickfiles != null) {
      $("file-input").click();
    } else if (d.help != null) {
      openHelp();
    } else if (d.searchall != null) {
      setSetting("includeNonJCR", true);
      setScope({ kind: "jcr" });
    } else if (d.subpicker != null) {
      e.stopPropagation();
      subPicker(t);
    } else if (d.subclear != null) {
      S.sub = new Set();
      $("popover").hidden = true;
      updateRows();
    } else if (d.saveview != null) {
      const def = S.subcategories.map((s) => s.name).filter((n) => S.sub.has(n)).join(" + ");
      askName(def, (name) => {
        S.savedViews = [...S.savedViews, { id: crypto.randomUUID(), name: name || def, category: S.scope.name, subcategories: [...S.sub].sort(), created: new Date().toISOString() }];
        store.setValue("savedViews", S.savedViews);
        render();
      });
    } else if (d.back != null) {
      S.pane = S.pane === "detail" ? "table" : "lists";
      render();
    } else if (d.copy) {
      copyText(d.copy);
    } else if (d.category) {
      showCategory(d.category, S.selection.size === 1 ? [...S.selection][0] : null);
    } else if (d.star) {
      toggleFavorite(new Set([d.star]));
    } else if (d.open) {
      S.selection = new Set([d.open]);
      S.pendingScroll = d.open;
      syncCompare();
      table.setSelection(S.selection);
      table.scrollTo(d.open);
      render();
    } else if (d.up || d.down) {
      const id = d.up || d.down;
      const from = S.compareOrder.indexOf(id);
      const to = Math.max(0, Math.min(S.compareOrder.length - 1, from + (d.up ? -1 : 1)));
      S.compareOrder.splice(from, 1);
      S.compareOrder.splice(to, 0, id);
      renderInspector();
    } else if (d.order != null) {
      e.stopPropagation();
      const r = t.getBoundingClientRect();
      const reorder = (cmp) => {
        const byID = new Map(S.journals.map((j) => [j.id, j]));
        S.compareOrder.sort((a, b) => cmp(byID.get(a), byID.get(b)));
        renderInspector();
      };
      showMenu(r.left, r.bottom + 4, [
        { label: "JIF 높은 순", action: () => reorder((a, b) => (b.jif ?? -1) - (a.jif ?? -1)) },
        { label: "SJR 높은 순", action: () => reorder((a, b) => (b.sjr ?? -1) - (a.sjr ?? -1)) },
        { label: "이름 순", action: () => reorder((a, b) => collator.compare(displayTitle(a), displayTitle(b))) },
      ]);
    } else if (d.newtag != null) {
      editTag(null);
    } else if (d.tagopts) {
      e.stopPropagation();
      const r = t.getBoundingClientRect();
      tagOptions(d.tagopts, r.left, r.bottom + 4);
    } else if (d.tagmenu != null) {
      e.stopPropagation();
      tagMenu(t, d.tagmenu ? new Set([d.tagmenu]) : undefined);
    } else if (d.sortdir != null) {
      S.sort = { ...S.sort, ascending: !S.sort.ascending };
      S.byRelevance = false;
      updateRows();
    }
  });
  // 숨긴 분야 펼침 기억
  app.addEventListener("toggle", (e) => {
    if (e.target.classList?.contains("side-hidden")) S.showHidden = e.target.open;
  }, true);
  // 분야 오른쪽 클릭: 숨기기·보이기
  $("side-list").addEventListener("contextmenu", (e) => {
    const b = e.target.closest("[data-scope]");
    if (!b) return;
    const scope = JSON.parse(b.dataset.scope);
    if (scope.kind === "tag") {
      e.preventDefault();
      return tagOptions(scope.name, e.clientX, e.clientY);
    }
    if (scope.kind !== "category") return;
    e.preventDefault();
    const hidden = S.settings.hiddenCategories.includes(scope.name);
    showMenu(e.clientX, e.clientY, [{
      label: hidden ? "다시 보이기" : "목록에서 숨기기",
      action: () => {
        setSetting("hiddenCategories", hidden ? S.settings.hiddenCategories.filter((c) => c !== scope.name) : [...S.settings.hiddenCategories, scope.name].sort());
        render();
      },
    }]);
  });
  // 비교 순서: 이름을 끌어 놓기
  let moving = null;
  $("inspector").addEventListener("dragstart", (e) => {
    const n = e.target.closest("[data-move]");
    if (n) moving = n.dataset.move;
  });
  $("inspector").addEventListener("dragover", (e) => {
    if (moving && e.target.closest("[data-move]")) e.preventDefault();
  });
  $("inspector").addEventListener("drop", (e) => {
    const n = e.target.closest("[data-move]");
    if (!moving || !n || n.dataset.move === moving) return;
    e.preventDefault();
    const to = S.compareOrder.indexOf(n.dataset.move);
    S.compareOrder.splice(S.compareOrder.indexOf(moving), 1);
    S.compareOrder.splice(to, 0, moving);
    moving = null;
    renderInspector();
  });
  // 팝오버(세부 분류 체크)
  $("popover").addEventListener("change", (e) => {
    const ed = e.target.dataset.edition;
    if (ed) {
      setEdition(ed, e.target.checked);
      return editionPicker($("btn-edition"));
    }
    const name = e.target.dataset.sub;
    if (name == null) return;
    const next = new Set(S.sub);
    e.target.checked ? next.add(name) : next.delete(name);
    S.sub = next;
    updateRows();
  });
  $("popover").addEventListener("click", (e) => {
    if (e.target.closest("[data-subclear]")) {
      S.sub = new Set();
      $("popover").hidden = true;
      updateRows();
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#popover")) $("popover").hidden = true;
    if (!e.target.closest("#menu")) hideMenu();
  });
  // 툴바
  $("btn-nonjcr").onclick = () => {
    setSetting("includeNonJCR", !S.settings.includeNonJCR);
    updateRows();
  };
  $("btn-edition").onclick = (e) => {
    e.stopPropagation();
    const pop = $("popover");
    if (!pop.hidden && pop.classList.contains("pop-small")) pop.hidden = true;
    else editionPicker(e.currentTarget);
  };
  $("btn-export").onclick = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, [
      { label: "Excel(.xlsx)로 내보내기", action: () => exportTable(false) },
      { label: "PDF 로 내보내기(인쇄 창)", action: () => exportTable(true) },
    ]);
  };
  $("btn-detail").onclick = () => {
    S.showDetail = !S.showDetail;
    render();
  };
  $("btn-settings").onclick = () => openSettings();
  $("btn-help").onclick = () => openHelp();
  // 툴바 단추: 지금과 반대로(자동이었으면 직접 고른 것이 된다)
  for (const id of ["btn-theme", "btn-theme-m"]) $(id).onclick = () => setAppearance(isDark() ? "light" : "dark");
  darkQuery.addEventListener("change", applyTheme);
  $("btn-help-m").onclick = () => openHelp();
  $("btn-settings-m").onclick = () => openSettings();
  $("btn-back").onclick = () => {
    S.pane = "lists";
    render();
  };
  $("btn-pick").onclick = () => {
    S.picking = !S.picking;
    if (!S.picking) S.selection = new Set();
    syncCompare();
    table.setSelection(S.selection);
    table.layout();
    render();
  };
  $("btn-tagsel").onclick = (e) => {
    e.stopPropagation();
    tagMenu(e.currentTarget);
  };
  $("btn-compare").onclick = () => {
    S.pane = "detail";
    render();
  };
  $("sortbar").addEventListener("change", (e) => {
    if (e.target.id !== "sort-select" || !e.target.value) return;
    S.sort = { key: e.target.value, ascending: true };
    S.byRelevance = false;
    updateRows();
  });
  // 검색
  $("search").addEventListener("input", (e) => setQuery(e.target.value));
  $("search-m").addEventListener("input", (e) => {
    $("search").value = e.target.value;
    if (S.scope.kind !== "jcr") setScope({ kind: "jcr" });
    S.pane = "table";
    setQuery(e.target.value);
    render();
    requestAnimationFrame(() => $("search").focus());
  });
  $("search").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.target.value = "";
      setQuery("");
    }
  });
  // 키보드: ⌘F·Ctrl+F·/ 검색, Esc 검색어 지우기, ↑↓ 줄 옮기기
  document.addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]")) return;
    // 바로가기 1·2·3: 브라우저 Alt+숫자, Windows 앱은 Ctrl+숫자도(한글 조합 중이면 안 함)
    const k = shortcutIndex(e, inTauri);
    if (k >= 0) {
      e.preventDefault();
      if (S.settings.shortcuts[k] && S.library) openToken(S.settings.shortcuts[k], true);
      return;
    }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") || (e.key === "/" && !typing)) {
      e.preventDefault();
      const s = narrow() && S.pane === "lists" ? $("search-m") : $("search");
      s.focus();
      s.select();
    } else if (e.key === "Escape" && !typing && S.query) {
      $("search").value = "";
      setQuery("");
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !typing) {
      const ids = S.rows.filter((r) => r.divider == null).map((r) => r.id);
      if (!ids.length) return;
      e.preventDefault();
      const cur = ids.indexOf(S.anchor);
      const next = ids[Math.max(0, Math.min(ids.length - 1, cur < 0 ? 0 : cur + (e.key === "ArrowDown" ? 1 : -1)))];
      S.selection = new Set([next]);
      S.anchor = next;
      syncCompare();
      table.setSelection(S.selection);
      table.scrollTo(next);
      render();
    }
  });
  // 끌어다 놓기
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  document.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    depth += 1;
    $("drop-overlay").hidden = false;
  });
  document.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) $("drop-overlay").hidden = true;
  });
  document.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  document.addEventListener("drop", async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    $("drop-overlay").hidden = true;
    importItems(await droppedItems(e.dataTransfer));
  });
  $("file-input").addEventListener("change", (e) => {
    const files = [...e.target.files].map((file) => ({ name: file.name, file }));
    e.target.value = "";
    if (files.length) importItems(files);
  });
  // 넓이가 바뀌면(폰 돌리기·창 크기) 다시 그린다
  window.matchMedia("(max-width: 760px)").addEventListener("change", () => {
    table.layout();
    render();
  });
}

start();
