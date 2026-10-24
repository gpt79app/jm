// 보이는 줄만 그리는 표(3만 줄도 가볍게). 머리줄: 눌러 정렬, 끌어 차례 바꾸기, 오른쪽 끝을 끌어 너비, 오른쪽 클릭으로 열 고르기.
// 줄 내용은 바깥에서 준다(cell·card). 좁은 화면은 머리줄 없이 두 줄짜리 카드
import { esc } from "./util.js";

export class VirtualTable {
  /// opts: { cell(col, row) → html, card(row) → html, divider(row) → html,
  ///         onSelect(id, event), onStar(id), onContext(id, event), onSort(col), onColumns(columns), onHeaderContext(event) }
  constructor(el, opts) {
    this.el = el;
    this.opts = opts;
    this.columns = [];
    this.rows = [];
    this.selection = new Set();
    this.sort = { key: null, ascending: true };
    this.cards = false;
    this.range = [-1, -1];
    el.classList.add("vt");
    el.tabIndex = 0;
    el.innerHTML = '<div class="vt-inner"><div class="vt-head" role="row"></div><div class="vt-rows" role="rowgroup"></div></div>';
    this.inner = el.firstChild;
    this.head = this.inner.children[0];
    this.body = this.inner.children[1];
    el.addEventListener("scroll", () => this.schedule(), { passive: true });
    new ResizeObserver(() => this.schedule()).observe(el);
    this.body.addEventListener("click", (e) => {
      const star = e.target.closest("[data-star]");
      const row = e.target.closest(".vt-row[data-id]");
      if (!row) return;
      if (star) return this.opts.onStar(row.dataset.id);
      this.opts.onSelect(row.dataset.id, e);
    });
    this.body.addEventListener("contextmenu", (e) => {
      const row = e.target.closest(".vt-row[data-id]");
      if (!row) return;
      e.preventDefault();
      this.opts.onContext(row.dataset.id, e);
    });
    this.head.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.opts.onHeaderContext(e);
    });
    this.bindHeader();
  }

  get rowHeight() {
    return this.cards ? 62 : 30;
  }

  setColumns(columns) {
    this.columns = columns;
    this.layout();
  }

  setRows(rows, { sort, keepScroll = false } = {}) {
    this.rows = rows;
    if (sort) this.sort = sort;
    if (!keepScroll) this.el.scrollTop = 0;
    this.layout();
  }

  setSelection(selection) {
    this.selection = selection;
    this.range = [-1, -1];
    this.renderRows();
  }

  setCards(cards) {
    if (this.cards === cards) return;
    this.cards = cards;
    this.layout();
  }

  /// 그 줄을 가운데로
  scrollTo(id) {
    const i = this.rows.findIndex((r) => r.id === id);
    if (i < 0) return;
    const h = this.rowHeight;
    const top = i * h, view = this.el.clientHeight - (this.cards ? 0 : 32);
    if (top < this.el.scrollTop || top + h > this.el.scrollTop + view) this.el.scrollTop = Math.max(0, top - view / 2);
  }

  /// 저널 열(grow)은 남는 폭을 채운다
  template() {
    return this.columns.map((c) => (c.grow ? `minmax(${c.width}px, 1fr)` : `${c.width}px`)).join(" ");
  }

  layout() {
    const total = this.columns.reduce((s, c) => s + c.width, 0);
    this.el.classList.toggle("vt-cards", this.cards);
    this.inner.style.width = this.cards ? "100%" : `max(100%, ${total}px)`;
    this.head.hidden = this.cards;
    this.head.style.gridTemplateColumns = this.template();
    this.head.innerHTML = this.columns.map((c) => {
      const sorted = this.sort.key === c.sortKey && c.sortKey;
      return `<div class="vt-th${c.align === "right" ? " right" : ""}${sorted ? " sorted" : ""}" draggable="true" data-col="${esc(c.id)}" role="columnheader" title="${esc(c.help ?? c.title)}">`
        + `<span class="vt-title">${esc(c.title)}</span>${sorted ? `<span class="vt-arrow">${this.sort.ascending ? "▲" : "▼"}</span>` : ""}`
        + `<span class="vt-resize" data-resize="${esc(c.id)}"></span></div>`;
    }).join("");
    this.body.style.height = `${this.rows.length * this.rowHeight}px`;
    this.range = [-1, -1];
    this.renderRows();
  }

  schedule() {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = null;
      this.renderRows();
    });
  }

  renderRows() {
    const h = this.rowHeight;
    const first = Math.max(0, Math.floor(this.el.scrollTop / h) - 8);
    const last = Math.min(this.rows.length, Math.ceil((this.el.scrollTop + this.el.clientHeight) / h) + 8);
    if (first === this.range[0] && last === this.range[1]) return;
    this.range = [first, last];
    const template = this.template();
    let html = "";
    for (let i = first; i < last; i++) {
      const r = this.rows[i];
      const top = i * h;
      if (r.divider != null) {
        html += `<div class="vt-row vt-divider" style="top:${top}px;height:${h}px">${this.opts.divider(r)}</div>`;
        continue;
      }
      const cls = `vt-row${i % 2 ? " odd" : ""}${this.selection.has(r.id) ? " selected" : ""}`;
      if (this.cards) {
        html += `<div class="${cls}" data-id="${esc(r.id)}" style="top:${top}px;height:${h}px" role="row">${this.opts.card(r)}</div>`;
      } else {
        html += `<div class="${cls}" data-id="${esc(r.id)}" style="top:${top}px;height:${h}px;grid-template-columns:${template}" role="row">`
          + this.columns.map((c) => `<div class="vt-td${c.align === "right" ? " right" : ""}" role="gridcell">${this.opts.cell(c, r)}</div>`).join("") + "</div>";
      }
    }
    this.body.innerHTML = html;
  }

  // 머리줄: 누르기(정렬)·끌기(차례)·오른쪽 끝 끌기(너비)
  bindHeader() {
    let resizing = null;
    let dragging = null;
    this.head.addEventListener("pointerdown", (e) => {
      const handle = e.target.closest("[data-resize]");
      if (!handle) return;
      e.preventDefault();
      e.stopPropagation();
      const col = this.columns.find((c) => c.id === handle.dataset.resize);
      resizing = { col, x: e.clientX, width: col.width };
      handle.setPointerCapture(e.pointerId);
    });
    this.head.addEventListener("pointermove", (e) => {
      if (!resizing) return;
      const { col } = resizing;
      col.width = Math.max(col.min ?? 40, Math.min(col.max ?? 1200, Math.round(resizing.width + e.clientX - resizing.x)));
      const total = this.columns.reduce((s, c) => s + c.width, 0);
      this.inner.style.width = `max(100%, ${total}px)`;
      this.head.style.gridTemplateColumns = this.template();
      for (const row of this.body.children) if (!row.classList.contains("vt-divider")) row.style.gridTemplateColumns = this.template();
    });
    const endResize = () => {
      if (!resizing) return;
      resizing = null;
      this.justResized = true;
      setTimeout(() => (this.justResized = false), 0);
      this.opts.onColumns(this.columns);
    };
    this.head.addEventListener("pointerup", endResize);
    this.head.addEventListener("pointercancel", endResize);
    this.head.addEventListener("click", (e) => {
      if (this.justResized || e.target.closest("[data-resize]")) return;
      const th = e.target.closest(".vt-th");
      if (th) this.opts.onSort(this.columns.find((c) => c.id === th.dataset.col));
    });
    this.head.addEventListener("dragstart", (e) => {
      const th = e.target.closest(".vt-th");
      if (!th || resizing) return e.preventDefault();
      dragging = th.dataset.col;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragging);
    });
    this.head.addEventListener("dragover", (e) => {
      if (!dragging) return;
      e.preventDefault();
      const th = e.target.closest(".vt-th");
      for (const x of this.head.children) x.classList.toggle("drop-target", x === th && x.dataset.col !== dragging);
    });
    this.head.addEventListener("drop", (e) => {
      if (!dragging) return;
      e.preventDefault();
      const th = e.target.closest(".vt-th");
      const from = this.columns.findIndex((c) => c.id === dragging);
      const to = th ? this.columns.findIndex((c) => c.id === th.dataset.col) : -1;
      dragging = null;
      if (from < 0 || to < 0 || from === to) return this.layout();
      const [col] = this.columns.splice(from, 1);
      this.columns.splice(to, 0, col);
      this.layout();
      this.opts.onColumns(this.columns);
    });
    this.head.addEventListener("dragend", () => {
      dragging = null;
      for (const x of this.head.children) x.classList.remove("drop-target");
    });
  }
}
