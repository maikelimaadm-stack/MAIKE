const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const buildTableHtml = ({ columns = [], rows = [], title = "Cadastro de Lotes" }) => `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 landscape; margin: 8mm; }
    body { font-family: Arial, sans-serif; color: #111827; margin: 0; }
    h1 { font-size: 14px; margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #d1d5db; padding: 3px 4px; font-size: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    th { background: #f3f4f6; font-weight: 700; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <table>
    <thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>
</body>
</html>`;

export function printVisibleLotesTable(data) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(buildTableHtml(data));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

export function exportVisibleLotesTableToExcel({ columns = [], rows = [], title = "Cadastro de Lotes" }) {
  const html = buildTableHtml({ columns, rows, title });
  const blob = new Blob(["\ufeff" + html], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `cadastro_lotes_${new Date().toISOString().split("T")[0]}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}