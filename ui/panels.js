// 오른쪽(좁은 화면은 다음 화면): 저널 하나 자세히 · 여러 개 비교
import { best, coverageText, displayCategory, displayTitle, docsText, inJCR, rankIn, rankText, topOf, topText } from "../core/model.js";
import { badge, esc, fmt3 } from "./util.js";

const pct = (c) => (c.percentile == null ? -1 : c.percentile);

/// 저널 하나. 분야를 누르면 data-category, 별은 data-star, 태그 메뉴는 data-tagmenu.
/// droppedNote: 고른 색인 때문에 분야가 다 빠졌을 때의 말, tags: 붙은 태그
export function detailHTML(j, { jcrYear, sjrYear, droppedNote, categoryCount, tags = [] }) {
  // 서식에 옮겨 적기 쉽게 크게, 누르면 복사(10-28 사용자). 출판사는 SCImago 표기가 있으면 그쪽(JCR 은 대문자 줄임)
  const publisher = j.sjrPublisher || j.publisher;
  const pubNote = j.publisher && j.publisher.toLowerCase() !== publisher.toLowerCase() ? `JCR 표기: ${j.publisher}` : "";
  const info = [["출판사", publisher, pubNote], ["발행 국가", j.country], ["ISSN", j.issn], ["eISSN", j.eissn]].map(([label, value, note]) =>
    `<div class="info-label muted">${label}</div><div>${value
      ? `<button type="button" class="info-value" data-copy="${esc(value)}" title="눌러서 ${label} 복사">${esc(value)} <span class="info-copy">⧉</span></button>`
      : '<span class="info-value faint">—</span>'}${note ? `<div class="muted small">${esc(note)}</div>` : ""}</div>`).join("");
  const search = `https://www.google.com/search?q=${encodeURIComponent(`"${displayTitle(j)}" journal`)}`;
  const top = best(j);
  let jcr;
  if (inJCR(j)) {
    const lines = [...j.categories].sort((a, b) => pct(b) - pct(a)).map((c) => {
      const isBest = c === top;
      const t = topOf(c);
      return `<button type="button" class="cat-line${isBest ? " best" : ""}" data-category="${esc(c.name)}" title="${esc(displayCategory(c.name))} 전체 목록 보기">
        <span class="cat-name"><span class="mark">${isBest ? "★" : "○"}</span>${esc(displayCategory(c.name))}</span>${badge(c.quartile)}
        <span class="cat-sub">순위 ${esc(rankText(c))}${t != null ? ` · 상위 ${topText(t)}` : ""}${c.percentile != null ? ` · 백분위 ${c.percentile.toFixed(1)}` : ""} · ${esc(c.edition)}</span></button>`;
    }).join("");
    jcr = `<div class="big"><span class="muted">JIF</span> <b class="num">${esc(j.jifText)}</b></div>${lines}
      <p class="note">받아 둔 ${categoryCount}개 분야 안에서의 순위입니다.</p>`;
  } else {
    jcr = `<p class="muted">${esc(droppedNote ?? "받아 둔 JCR 분야에 없는 저널입니다.")}</p>`;
  }
  let sjr;
  if (j.sjrTitle) {
    const docs = docsText(j), cov = coverageText(j);
    sjr = `<div class="big"><span class="muted">SJR</span> <b class="num">${j.sjr == null ? "-" : fmt3(j.sjr)}</b> ${badge(j.sjrQuartile)}
        ${j.hIndex != null ? `<span class="muted push">H ${j.hIndex}</span>` : ""}</div>
      ${docs ? `<div class="muted small">📄 ${esc(docs)}</div>` : ""}
      ${cov ? `<div class="muted small" title="Scopus 에 실린 해(SCImago 'Coverage'). 창간 연도보다 늦을 수 있습니다.">📅 ${esc(cov)}</div>` : ""}
      ${j.sjrCategories.map((c) => `<div class="sjr-cat"><span>${esc(c.name)}</span>${badge(c.quartile)}</div>`).join("")}`;
  } else {
    sjr = '<p class="muted">SCImago 에 없는 저널입니다.</p>';
  }
  return `<div class="detail">
    <div class="detail-title"><h2>${esc(displayTitle(j))}</h2>
      <button type="button" class="star-big${j.isFavorite ? " on" : ""}" data-star="${esc(j.id)}" title="${j.isFavorite ? "즐겨찾기에서 빼기" : "즐겨찾기에 넣기"}">${j.isFavorite ? "★" : "☆"}</button></div>
    ${displayTitle(j) !== j.title ? `<div class="muted small">JCR 표기: ${esc(j.title)}</div>` : ""}
    ${j.abbreviation ? `<div class="muted">${esc(j.abbreviation)}</div>` : ""}
    <div class="tag-chips">${tags.map((t) => `<span class="tag-chip"><span class="tag-dot tc-${esc(t.color)}"></span>${esc(t.name)}</span>`).join("")}
      <button type="button" class="small-btn" data-tagmenu="${esc(j.id)}" title="태그 붙이기·떼기">태그 ▾</button></div>
    <div class="links"><a href="${esc(search)}" target="_blank" rel="noopener noreferrer" title="웹 검색으로 엽니다">웹에서 찾기</a>
      ${j.sjrID ? `<a href="https://www.scimagojr.com/journalsearch.php?q=${encodeURIComponent(j.sjrID)}&amp;tip=sid" target="_blank" rel="noopener noreferrer">SCImago</a>` : ""}</div>
    <section class="box"><h3>저널 정보</h3><div class="info-grid">${info}</div></section>
    <section class="box"><h3>JCR ${esc(jcrYear)}</h3>${jcr}</section>
    <section class="box"><h3>SCImago ${esc(sjrYear)}</h3>${sjr}</section>
  </div>`;
}

const palette = ["#2f6fdb", "#e8890c", "#1e9e4a", "#8e44ad", "#d6457a", "#1aa3a3", "#8d6e63", "#5c6bc0"];

/// 여러 저널 비교. journals: 보이는 차례, colors: id → 색 번호
export function compareHTML(journals, colors, { jcrYear, sjrYear }) {
  const color = (j, i) => palette[(colors.get(j.id) ?? i) % palette.length];
  const dot = (j, i) => `<span class="dot" style="background:${color(j, i)}"></span>`;
  const count = new Map();
  for (const j of journals) for (const c of j.categories) count.set(c.name, (count.get(c.name) ?? 0) + 1);
  const categories = [...count.keys()].sort((a, b) => (count.get(a) !== count.get(b) ? count.get(b) - count.get(a) : a < b ? -1 : 1));
  const maxJIF = Math.max(0.0001, ...journals.map((j) => j.jif ?? 0));
  const names = journals.map((j, i) => `<div class="cmp-name" draggable="true" data-move="${esc(j.id)}">
      <button type="button" class="cmp-open" data-open="${esc(j.id)}" title="${esc(displayTitle(j))} 자세히 보기 · 끌어서 순서 바꾸기">${dot(j, i)}${esc(displayTitle(j))}</button>
      <button type="button" class="icon" data-up="${esc(j.id)}" ${i === 0 ? "disabled" : ""} title="위로">▲</button>
      <button type="button" class="icon" data-down="${esc(j.id)}" ${i === journals.length - 1 ? "disabled" : ""} title="아래로">▼</button></div>`).join("");
  const bars = journals.map((j, i) => `<div class="bar-row"><div class="bar"><span style="width:${Math.max(3, ((j.jif ?? 0) / maxJIF) * 100)}%;background:${color(j, i)}"></span></div>
      <span class="num">${esc(j.jifText || "—")}</span></div>`).join("");
  const cats = categories.map((name) => `<section class="box"><h3><button type="button" class="link" data-category="${esc(name)}" title="${esc(displayCategory(name))} 전체 목록 보기">${esc(displayCategory(name))}</button></h3>
      ${journals.map((j, i) => {
        const r = rankIn(j, name);
        const t = r && topOf(r);
        return `<div class="cmp-line">${dot(j, i)}${r ? `<span class="num rank">${esc(rankText(r))}</span>${badge(r.quartile)}<span class="push muted num">${t != null ? `상위 ${topText(t)}` : ""}</span>` : '<span class="faint">이 분야 아님</span>'}</div>`;
      }).join("")}</section>`).join("");
  const sjr = journals.map((j, i) => `<div class="cmp-line">${dot(j, i)}${badge(j.sjrQuartile)}<span class="num">${j.sjr == null ? "—" : fmt3(j.sjr)}</span>
      ${j.hIndex != null ? `<span class="push muted">H ${j.hIndex}</span>` : ""}</div>`).join("");
  return `<div class="detail compare">
    <div class="detail-title"><h2>비교 ${journals.length}개</h2><button type="button" class="small-btn" data-tagmenu title="고른 저널 모두에 태그 붙이기·떼기">태그 ▾</button><button type="button" class="small-btn" data-order>순서 ▾</button></div>
    <div class="cmp-names">${names}</div>
    <section class="box"><h3>JIF (JCR ${esc(jcrYear)})</h3>${bars}</section>
    ${cats}
    <section class="box"><h3>SCImago ${esc(sjrYear)} (가장 좋은 분위·SJR)</h3>${sjr}</section>
  </div>`;
}
