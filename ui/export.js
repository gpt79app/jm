// 지금 표를 Excel·PDF 로: 보이는 줄 차례 그대로(구분선 줄 포함), 보이는 열·차례 그대로. 저널을 둘 이상 골랐으면 고른 것만.
// PDF 는 인쇄 창(→ PDF 로 저장)으로 — A4 가로, 머리줄은 쪽마다
import { displayCategory, displayTitle, editions, otherCategories, rankText, shortNumber, topOf } from "../core/model.js";
import { quartileCell, Style, xlsxData } from "../core/xlsx.js";
import { esc } from "./util.js";

/// 값: { text } · { number, decimals, suffix } · { quartile }
function exportColumn(id, ctx) {
  const { sub, many, category } = ctx;
  switch (id) {
    case "sjrCategoryRank":
      return [{ id, title: "SJR 분류 순위", width: many ? 34 : 12,
        value: (r) => ({ text: r.sjrCategoryRank ? `${r.sjrCategoryRank.rank}/${r.sjrCategoryRank.total}` + (many ? ` ${r.sjrCategoryRank.category}` : "") : "" }) }];
    case "rank":
      return [{ id, title: sub ? "JCR 순위" : "순위", width: 9, value: (r) => ({ text: rankText(r.shown) }) }];
    case "journal":
      return [{ id, title: "저널", width: 48, value: (r) => ({ text: displayTitle(r.journal) }) }];
    case "jif":
      return [{ id, title: "JIF", width: 7, value: (r) => (r.journal.jif != null ? { number: r.journal.jif, decimals: 1 } : { text: r.journal.jifText }) }];
    case "category":
      // 화면은 '분야 +N' 이지만 파일에는 속한 분야를 다 적는다(보이는 분야 먼저, 나머지는 백분위 차례)
      return [{ id, title: category ? "분야" : "가장 좋은 분야", width: 32,
        value: (r) => ({ text: [r.shown, ...otherCategories(r.journal, r.shown)].filter(Boolean).map((c) => displayCategory(c.name)).join(" · ") }) }];
    case "edition":
      return [{ id, title: "색인", width: 9, value: (r) => ({ text: editions(r.journal) }) }];
    case "quartile":
      return [{ id, title: "분위", width: 6, value: (r) => ({ quartile: r.shown?.quartile ?? "" }) }];
    case "top":
      return [{ id, title: "상위", width: 8, value: (r) => { const t = topOf(r.shown); return t != null ? { number: t, decimals: 1, suffix: "%" } : { text: "" }; } }];
    case "sjr":
      // 화면에선 한 칸(분위+값)이지만 파일에선 두 칸(값을 숫자로 쓰게)
      return [{ id, title: "SJR 분위", width: 9, value: (r) => ({ quartile: r.sjrQuartile }) },
        { id, title: "SJR", width: 8, value: (r) => (r.journal.sjr != null ? { number: r.journal.sjr, decimals: 3 } : { text: "" }) }];
    default:
      return [];
  }
}

/// visible: 화면에 보이는 열 id 차례
export function exportColumns(visible, ctx) {
  return visible.flatMap((id) => exportColumn(id, ctx));
}

const dividerLabel = (d) => `▲ 상위 ${shortNumber(d)}%`;

export function xlsxFor(title, columns, rows) {
  const cells = rows.map((r) => {
    if (r.divider != null) return [{ text: dividerLabel(r.divider), style: Style.divider }, ...columns.slice(1).map(() => null)];
    return columns.map((c) => {
      const v = c.value(r);
      if (v.quartile != null) return quartileCell(v.quartile);
      if (v.number != null) {
        const base = v.decimals === 0 ? "0" : "0." + "0".repeat(v.decimals);
        return { number: v.number, format: v.suffix ? `${base}"${v.suffix}"` : base };
      }
      return v.text ? { text: v.text } : null;
    });
  });
  return xlsxData(title, columns.map((c) => ({ title: c.title, width: c.width })), cells);
}

/// 인쇄용 표(HTML)
export function printHTML(title, subtitle, columns, rows) {
  const total = columns.reduce((s, c) => s + c.width, 0) || 1;
  const head = columns.map((c) => `<th style="width:${((c.width / total) * 100).toFixed(2)}%">${esc(c.title)}</th>`).join("");
  const body = rows.map((r) => {
    if (r.divider != null) return `<tr class="p-divider"><td colspan="${columns.length}"><span>${esc(dividerLabel(r.divider))}</span></td></tr>`;
    return "<tr>" + columns.map((c) => {
      const v = c.value(r);
      if (v.quartile != null) return `<td class="pq pq${esc(v.quartile.slice(1))}">${esc(v.quartile)}</td>`;
      if (v.number != null) return `<td class="pn">${v.number.toFixed(v.decimals)}${esc(v.suffix ?? "")}</td>`;
      return `<td${c.id === "rank" || c.id === "sjrCategoryRank" ? ' class="pn-left"' : ""}>${esc(v.text)}</td>`;
    }).join("") + "</tr>";
  }).join("");
  return `<h1>${esc(title)}</h1><p class="p-sub">${esc(subtitle)}</p><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
