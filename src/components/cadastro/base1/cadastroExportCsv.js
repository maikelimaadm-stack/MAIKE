/**
 * Exporta CSV (;) a partir de colunas de cadastro Base1.
 * @param {string} filename
 * @param {Array<{ id: string; label: string }>} columns
 * @param {object[]} rows
 * @param {(item: object, colId: string) => string} getFieldValue
 */
export function exportCadastroCsv(filename, columns, rows, getFieldValue) {
  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const cols = columns.filter((c) => c.id !== "selecao" && c.id !== "acoes");
  const lines = [
    cols.map((c) => esc(c.label)).join(";"),
    ...rows.map((r) => cols.map((c) => esc(getFieldValue(r, c.id))).join(";")),
  ];
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
