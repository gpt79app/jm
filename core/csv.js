// 따옴표를 아는 단순 CSV 읽기. JCR 내보내기의 `"85.71"%` 처럼 닫는 따옴표 뒤에 붙은 글자도 같은 칸에 넣는다
export function csvRows(text, sep) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const rows = [];
  let row = [];
  let field = "";
  let run = -1; // 아직 field 에 안 붙인 보통 글자들의 시작 위치
  let inQuotes = false;
  let justClosed = false;
  const flush = (i) => {
    if (run >= 0) {
      field += text.slice(run, i);
      run = -1;
    }
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        flush(i);
        inQuotes = false;
        justClosed = true;
      } else if (run < 0) run = i;
      continue;
    }
    if (ch === '"') {
      flush(i);
      if (justClosed) field += '"'; // "" → "
      inQuotes = true;
      justClosed = false;
      continue;
    }
    justClosed = false;
    if (ch === sep) {
      flush(i);
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      flush(i);
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (ch === "\r") {
      flush(i);
    } else if (run < 0) {
      run = i;
    }
  }
  flush(text.length);
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
