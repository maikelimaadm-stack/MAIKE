const encoder = new TextEncoder();

const escapeXml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const sanitizeSheetName = (name) => String(name || "Planilha")
  .replace(/[\\/?*[\]:]/g, " ")
  .trim()
  .slice(0, 31) || "Planilha";

const columnLetter = (index) => {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    result = String.fromCharCode(65 + mod) + result;
    value = Math.floor((value - mod) / 26);
  }
  return result;
};

const getCellType = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  return "string";
};

const buildCell = (value, rowIndex, columnIndex, styleId = 1) => {
  const ref = `${columnLetter(columnIndex)}${rowIndex}`;
  if (getCellType(value) === "number") {
    return `<c r="${ref}" s="${styleId}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" s="${styleId}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
};

const getColumnWidth = (columns, rows, totalRows, index) => {
  const values = [columns[index]?.label, ...rows.map((row) => row[index]), ...totalRows.map((row) => row[index])];
  const maxLength = values.reduce((max, value) => Math.max(max, String(value ?? "").length), 0);
  return Math.min(45, Math.max(10, maxLength + 2));
};

const buildWorksheet = ({ columns, rows, totalRows, title }) => {
  const allRows = [
    { values: [title], style: 3 },
    { values: columns.map((column) => column.label), style: 2 },
    ...rows.map((values) => ({ values, style: 1 })),
    ...totalRows.map((values) => ({ values, style: 4 }))
  ];

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${columns.map((_, index) => `<col min="${index + 1}" max="${index + 1}" width="${getColumnWidth(columns, rows, totalRows, index)}" customWidth="1"/>`).join("")}</cols>
  <sheetData>
    ${allRows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.values.map((value, columnIndex) => buildCell(value, rowIndex + 1, columnIndex, row.style)).join("")}</row>`).join("")}
  </sheetData>
  <mergeCells count="1"><mergeCell ref="A1:${columnLetter(Math.max(columns.length - 1, 0))}1"/></mergeCells>
</worksheet>`;
};

const filesForWorkbook = (data) => ({
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(sanitizeSheetName(data.title))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
  "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right><top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`,
  "xl/worksheets/sheet1.xml": buildWorksheet(data)
});

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const push16 = (array, value) => { array.push(value & 0xff, (value >>> 8) & 0xff); };
const push32 = (array, value) => { array.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff); };

const zipFiles = (files) => {
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  Object.entries(files).forEach(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const dataBytes = encoder.encode(content);
    const crc = crc32(dataBytes);
    const local = [];
    push32(local, 0x04034b50); push16(local, 20); push16(local, 0); push16(local, 0); push16(local, dosTime); push16(local, dosDate);
    push32(local, crc); push32(local, dataBytes.length); push32(local, dataBytes.length); push16(local, nameBytes.length); push16(local, 0);
    chunks.push(Uint8Array.from(local), nameBytes, dataBytes);

    const centralHeader = [];
    push32(centralHeader, 0x02014b50); push16(centralHeader, 20); push16(centralHeader, 20); push16(centralHeader, 0); push16(centralHeader, 0); push16(centralHeader, dosTime); push16(centralHeader, dosDate);
    push32(centralHeader, crc); push32(centralHeader, dataBytes.length); push32(centralHeader, dataBytes.length); push16(centralHeader, nameBytes.length); push16(centralHeader, 0); push16(centralHeader, 0); push16(centralHeader, 0); push16(centralHeader, 0); push32(centralHeader, 0); push32(centralHeader, offset);
    central.push(Uint8Array.from(centralHeader), nameBytes);
    offset += local.length + nameBytes.length + dataBytes.length;
  });

  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = [];
  push32(end, 0x06054b50); push16(end, 0); push16(end, 0); push16(end, Object.keys(files).length); push16(end, Object.keys(files).length); push32(end, centralSize); push32(end, offset); push16(end, 0);

  return new Blob([...chunks, ...central, Uint8Array.from(end)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
};

export function exportRowsToXlsx({ columns = [], rows = [], totalRows = [], title = "Planilha", fileName = "exportacao" }) {
  const blob = zipFiles(filesForWorkbook({ columns, rows, totalRows, title }));
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `${fileName}_${new Date().toISOString().split("T")[0]}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}