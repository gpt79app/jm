// 표 하나를 .xlsx 로. 바깥 라이브러리 없이: 시트 XML 몇 장을 압축 없이(stored) zip 으로 묶는다.
// 머리줄 굵게·고정, 열 너비, 숫자는 숫자 칸(정렬·계산되게), 분위는 색 글자, 구분선 줄은 주황.
//
// 칸: { text, style } · { number, format } · null(빈 칸)
// style: 0 보통, 1 머리줄, 2~5 Q1~Q4, 6 구분선, 7 굵게

export const Style = { plain: 0, header: 1, q1: 2, q2: 3, q3: 4, q4: 5, divider: 6, bold: 7 };

/// 분위 글자 → 색 칸
export function quartileCell(q) {
  if (!q) return null;
  const style = { Q1: Style.q1, Q2: Style.q2, Q3: Style.q3 }[q] ?? Style.q4;
  return { text: q, style };
}

const enc = new TextEncoder();

export function escapeXML(s) {
  let out = "";
  for (const ch of s) {
    const u = ch.codePointAt(0);
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === '"') out += "&quot;";
    else if (u < 0x20 && ch !== "\t" && ch !== "\n" && ch !== "\r") continue; // XML 1.0 에 못 넣는 제어 문자
    else out += ch;
  }
  return out;
}

export function columnName(i) {
  let n = i + 1, s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/// 시트 이름: 31자, []:*?/\ 빼기
export function safeSheetName(s) {
  const cleaned = [...s].map((c) => ("[]:*?/\\".includes(c) ? " " : c)).join("").trim();
  return [...(cleaned || "Sheet1")].slice(0, 31).join("");
}

/// columns: [{ title, width }], rows: [[칸]] → Uint8Array
export function xlsxData(name, columns, rows) {
  // 숫자 서식은 쓰인 것만 모아 스타일 번호를 붙인다(고정 스타일 8개 뒤)
  const formats = [];
  for (const row of rows) for (const c of row) if (c && c.number != null && !formats.includes(c.format)) formats.push(c.format);
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXML(safeSheetName(name))}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", styles(formats)],
    ["xl/worksheets/sheet1.xml", sheet(columns, rows, formats)],
  ];
  return zipStored(files.map(([n, s]) => [n, enc.encode(s)]));
}

function styles(formats) {
  const numFmts = formats.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${escapeXML(f)}"/>`).join("");
  // 글꼴: 0 보통, 1 굵게, 2~5 분위 색(굵게), 6 주황 굵게
  const font = (color) => `<font><b/><sz val="11"/>${color ? `<color rgb="${color}"/>` : ""}<name val="Calibri"/></font>`;
  const fonts = ['<font><sz val="11"/><name val="Calibri"/></font>', font(), font("FF1E9E4A"), font("FF2F6FDB"), font("FFE08A00"), font("FFD63B3B"), font("FFE07000")];
  // 채우기: 0·1 은 Excel 이 예약, 2 머리줄 회색, 3 구분선 연주황
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE9E9EC"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFDEBD8"/></patternFill></fill>'];
  const xf = (fontId, fillId, extra = "") => `<xf xfId="0" fontId="${fontId}" fillId="${fillId}" borderId="0" numFmtId="0"${extra}/>`;
  const xfs = [xf(0, 0), xf(1, 2, ' applyFont="1" applyFill="1"'), xf(2, 0, ' applyFont="1"'), xf(3, 0, ' applyFont="1"'),
    xf(4, 0, ' applyFont="1"'), xf(5, 0, ' applyFont="1"'), xf(6, 3, ' applyFont="1" applyFill="1"'), xf(1, 0, ' applyFont="1"'),
    ...formats.map((_, i) => `<xf xfId="0" fontId="0" fillId="0" borderId="0" numFmtId="${164 + i}" applyNumberFormat="1"/>`)];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="${formats.length}">${numFmts}</numFmts><fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

function sheet(columns, rows, formats) {
  const ref = (c, r) => columnName(c) + r;
  const cell = (c, at) => {
    if (!c) return "";
    if (c.number != null) return `<c r="${at}" s="${8 + Math.max(0, formats.indexOf(c.format))}"><v>${c.number}</v></c>`;
    const st = c.style ? ` s="${c.style}"` : "";
    return `<c r="${at}" t="inlineStr"${st}><is><t xml:space="preserve">${escapeXML(c.text)}</t></is></c>`;
  };
  let out = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
  out += "<cols>" + columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join("") + "</cols>";
  out += "<sheetData>";
  out += '<row r="1">' + columns.map((c, i) => cell({ text: c.title, style: Style.header }, ref(i, 1))).join("") + "</row>";
  rows.forEach((row, i) => {
    out += `<row r="${i + 2}">` + row.map((c, k) => cell(c, ref(k, i + 2))).join("") + "</row>";
  });
  out += "</sheetData>";
  if (rows.length) out += `<autoFilter ref="A1:${ref(columns.length - 1, rows.length + 1)}"/>`;
  return out + "</worksheet>";
}

// MARK: zip(압축 없이)

const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/// files: [[이름, Uint8Array]] → zip(Uint8Array). 날짜·시각은 1980-01-01 00:00(DOS 형식) — 내용과 상관없다
export function zipStored(files) {
  const parts = [], central = [];
  let offset = 0;
  const dosTime = 0, dosDate = (0 << 9) | (1 << 5) | 1;
  const header = (sig, fields) => {
    const size = 4 + fields.reduce((s, [, n]) => s + n, 0);
    const buf = new Uint8Array(size);
    const v = new DataView(buf.buffer);
    v.setUint32(0, sig, true);
    let at = 4;
    for (const [value, n] of fields) {
      if (n === 2) v.setUint16(at, value, true);
      else v.setUint32(at, value, true);
      at += n;
    }
    return buf;
  };
  for (const [name, data] of files) {
    const nameData = enc.encode(name);
    const crc = crc32(data);
    const local = header(0x04034b50, [[20, 2], [0x0800, 2], [0, 2], [dosTime, 2], [dosDate, 2], [crc, 4], [data.length, 4], [data.length, 4], [nameData.length, 2], [0, 2]]);
    parts.push(local, nameData, data);
    central.push(header(0x02014b50, [[20, 2], [20, 2], [0x0800, 2], [0, 2], [dosTime, 2], [dosDate, 2], [crc, 4], [data.length, 4], [data.length, 4],
      [nameData.length, 2], [0, 2], [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4]]), nameData);
    offset += local.length + nameData.length + data.length;
  }
  const centralSize = central.reduce((s, b) => s + b.length, 0);
  const end = header(0x06054b50, [[0, 2], [0, 2], [files.length, 2], [files.length, 2], [centralSize, 4], [offset, 4], [0, 2]]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, b) => s + b.length, 0));
  let at = 0;
  for (const b of all) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}
