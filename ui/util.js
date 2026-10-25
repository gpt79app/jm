// 화면에서 같이 쓰는 작은 도구들

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/// 분위 표시(색 알약)
export function badge(q) {
  return q ? `<span class="q q${esc(q.slice(1))}">${esc(q)}</span>` : "";
}

export const fmt3 = (v) => (v == null ? "" : v.toFixed(3));

export const narrow = () => window.matchMedia("(max-width: 760px)").matches;

/// 작은 메뉴(오른쪽 클릭·단추). items: [{ label, action, checked, disabled, color(태그 점) } | { header } | "-"]
export function showMenu(x, y, items) {
  const menu = document.getElementById("menu");
  menu.innerHTML = items.map((it, i) => (it === "-" ? '<div class="menu-sep"></div>' : it.header != null ? `<div class="menu-head">${esc(it.header)}</div>`
    : `<button type="button" data-i="${i}"${it.disabled ? " disabled" : ""}>${it.checked != null ? `<span class="check">${it.checked ? "✓" : ""}</span>` : ""}${it.color ? `<span class="tag-dot tc-${esc(it.color)}"></span>` : ""}${esc(it.label)}</button>`)).join("");
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + "px";
  menu.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + "px";
  menu.onclick = (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    hideMenu();
    items[Number(b.dataset.i)].action();
  };
}

export function hideMenu() {
  const menu = document.getElementById("menu");
  if (menu) menu.hidden = true;
}

/// 파일 받기(브라우저 다운로드)
export function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
