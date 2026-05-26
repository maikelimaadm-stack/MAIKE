import { exportRowsToXlsx } from "@/components/common/xlsxExportUtils";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const buildTableHtml = ({ columns = [], rows = [], totalRows = [], title = "Cadastro de Lotes" }) => {
  const totalWidth = columns.reduce((sum, column) => sum + Number(column.width || 120), 0);
  const pageWidthMm = 281;
  const pxToMmRatio = pageWidthMm / Math.max(totalWidth, 1);

  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 landscape; margin: 8mm; }
    body { font-family: Calibri, Arial, sans-serif; color: #111827; margin: 0; }
    h1 { font-size: 14px; margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #d1d5db; padding: 3px 4px; font-size: 10px; white-space: normal; overflow-wrap: anywhere; word-break: break-word; vertical-align: top; }
    th { background: #f3f4f6; font-weight: 700; }
    .total-row td { background: #e5e7eb; font-weight: 700; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <table>
    <colgroup>${columns.map((column) => `<col style="width:${Math.max(8, Number(column.width || 120) * pxToMmRatio).toFixed(2)}mm" />`).join("")}</colgroup>
    <thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}${totalRows.map((row) => `<tr class="total-row">${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>
</body>
</html>`;
};

const getColumnWidth = (columns, rows, totalRows, index) => {
  const values = [columns[index]?.label, ...rows.map((row) => row[index]), ...totalRows.map((row) => row[index])];
  const maxLength = values.reduce((max, value) => Math.max(max, String(value ?? "").length), 0);
  return Math.min(260, Math.max(70, maxLength * 7 + 18));
};

const buildExcelXml = ({ columns = [], rows = [], totalRows = [], title = "Cadastro de Lotes" }) => `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Font ss:FontName="Calibri" ss:Size="10"/>
    </Style>
    <Style ss:ID="Title"><Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1"/></Style>
    <Style ss:ID="Header"><Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1"/><Interior ss:Color="#F3F4F6" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
    <Style ss:ID="Cell"><Font ss:FontName="Calibri" ss:Size="10"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
    <Style ss:ID="Total"><Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1"/><Interior ss:Color="#E5E7EB" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  </Styles>
  <Worksheet ss:Name="${escapeHtml(title).slice(0, 31)}">
    <Table>
      ${columns.map((_, index) => `<Column ss:Width="${getColumnWidth(columns, rows, totalRows, index)}"/>`).join("")}
      <Row><Cell ss:MergeAcross="${Math.max(columns.length - 1, 0)}" ss:StyleID="Title"><Data ss:Type="String">${escapeHtml(title)}</Data></Cell></Row>
      <Row>${columns.map((column) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeHtml(column.label)}</Data></Cell>`).join("")}</Row>
      ${rows.map((row) => `<Row>${row.map((cell) => `<Cell ss:StyleID="Cell"><Data ss:Type="String">${escapeHtml(cell)}</Data></Cell>`).join("")}</Row>`).join("")}
      ${totalRows.map((row) => `<Row>${row.map((cell) => `<Cell ss:StyleID="Total"><Data ss:Type="String">${escapeHtml(cell)}</Data></Cell>`).join("")}</Row>`).join("")}
    </Table>
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><Selected/></WorksheetOptions>
  </Worksheet>
</Workbook>`;

export function printVisibleLotesTable(data) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(buildTableHtml(data));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

export function exportVisibleLotesTableToExcel({ columns = [], rows = [], totalRows = [], title = "Cadastro de Lotes" }) {
  exportRowsToXlsx({
    columns,
    rows,
    totalRows,
    title,
    fileName: "cadastro_lotes"
  });
}