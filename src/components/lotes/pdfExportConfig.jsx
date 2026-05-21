export const PDF_EXPORT_CONFIG_KEY = "cadastro_lotes_pdf_export_config";
export const EXCEL_EXPORT_CONFIG_KEY = "cadastro_lotes_excel_export_config";

const DEFAULT_EXPORT_CONFIG = { useConfiguredColumns: false, columnIds: [] };

function readExportConfig(key) {
  const saved = localStorage.getItem(key);
  if (!saved) return DEFAULT_EXPORT_CONFIG;
  try {
    const parsed = JSON.parse(saved);
    return {
      useConfiguredColumns: Boolean(parsed.useConfiguredColumns),
      columnIds: Array.isArray(parsed.columnIds) ? parsed.columnIds : []
    };
  } catch {
    return DEFAULT_EXPORT_CONFIG;
  }
}

function saveExportConfig(key, config) {
  localStorage.setItem(key, JSON.stringify({
    useConfiguredColumns: Boolean(config.useConfiguredColumns),
    columnIds: Array.isArray(config.columnIds) ? config.columnIds : []
  }));
}

export function getLotesPdfExportConfig() {
  return readExportConfig(PDF_EXPORT_CONFIG_KEY);
}

export function saveLotesPdfExportConfig(config) {
  saveExportConfig(PDF_EXPORT_CONFIG_KEY, config);
}

export function getLotesExcelExportConfig() {
  return readExportConfig(EXCEL_EXPORT_CONFIG_KEY);
}

export function saveLotesExcelExportConfig(config) {
  saveExportConfig(EXCEL_EXPORT_CONFIG_KEY, config);
}