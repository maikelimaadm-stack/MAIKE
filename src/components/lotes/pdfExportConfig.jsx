export const PDF_EXPORT_CONFIG_KEY = "cadastro_lotes_pdf_export_config";

export function getLotesPdfExportConfig() {
  const saved = localStorage.getItem(PDF_EXPORT_CONFIG_KEY);
  if (!saved) return { useConfiguredColumns: false, columnIds: [] };
  try {
    const parsed = JSON.parse(saved);
    return {
      useConfiguredColumns: Boolean(parsed.useConfiguredColumns),
      columnIds: Array.isArray(parsed.columnIds) ? parsed.columnIds : []
    };
  } catch {
    return { useConfiguredColumns: false, columnIds: [] };
  }
}

export function saveLotesPdfExportConfig(config) {
  localStorage.setItem(PDF_EXPORT_CONFIG_KEY, JSON.stringify({
    useConfiguredColumns: Boolean(config.useConfiguredColumns),
    columnIds: Array.isArray(config.columnIds) ? config.columnIds : []
  }));
}