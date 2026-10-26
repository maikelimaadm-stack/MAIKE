/**
 * Preferências de coluna Base1 no `localStorage` — paridade com `normalizeListPreferences`
 * (CONTROLE-DE-ESTOQUE / `packages/shared/src/preferences.ts`, decisões 355–356).
 *
 * Chave unificada: `{storageKey}_prefs` (JSON versionado).
 * Chaves legadas (`_largura`, `_ordem`, `_visiveis`, `_congeladas`, `_autofit`) são lidas na migração
 * e regravadas ao persistir para compatibilidade com builds anteriores.
 */

export const CADASTRO_B1_COLUMN_PREFS_VERSION = 1;

const MIN_COL_WIDTH = 40;
const MAX_COL_WIDTH = 1200;
const MAX_FROZEN = 30;

/**
 * @param {unknown} raw
 * @param {string[]} knownIds
 */
function normalizeIdList(raw, knownIds) {
  const known = new Set(knownIds);
  if (!Array.isArray(raw)) return undefined;
  const out = [];
  for (const x of raw) {
    if (typeof x !== "string" || !x || !known.has(x) || out.includes(x)) continue;
    out.push(x);
    if (out.length >= 200) break;
  }
  return out.length ? out : undefined;
}

/**
 * @param {Record<string, number>} defaults
 * @param {unknown} raw
 * @param {string[]} knownIds
 */
export function normalizeColumnWidths(defaults, raw, knownIds) {
  const known = new Set(knownIds);
  const out = { ...defaults };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!known.has(k) || typeof v !== "number" || !Number.isFinite(v)) continue;
    const w = Math.round(v);
    if (w >= MIN_COL_WIDTH && w <= MAX_COL_WIDTH) out[k] = w;
  }
  return out;
}

/**
 * @param {string[]} knownIds ordem canônica das colunas
 * @param {unknown} raw
 */
export function normalizeColumnOrder(knownIds, raw) {
  const ordered = normalizeIdList(raw, knownIds);
  if (!ordered?.length) return [...knownIds];
  const rest = knownIds.filter((id) => !ordered.includes(id));
  return [...ordered, ...rest];
}

/**
 * @param {string[]} defaultVisible
 * @param {unknown} raw
 * @param {string[]} knownIds
 */
export function normalizeVisibleColumns(defaultVisible, raw, knownIds) {
  const vis = normalizeIdList(raw, knownIds);
  if (vis?.length) return vis;
  const def = normalizeIdList(defaultVisible, knownIds);
  return def?.length ? def : knownIds;
}

/**
 * @param {unknown} raw
 * @param {number} columnCount
 */
export function normalizeFrozenCount(raw, columnCount) {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_FROZEN, columnCount, Math.round(n));
}

/**
 * @param {unknown} raw
 * @param {string[]} knownIds
 */
export function normalizeAutoFitKeys(raw, knownIds) {
  const list = normalizeIdList(raw, knownIds);
  return new Set(list ?? []);
}

function readJson(key) {
  try {
    const s = localStorage.getItem(key);
    if (!s) return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * @param {string} storageKey
 * @param {Array<{ id: string; width?: number; default?: boolean }>} dataCols
 */
export function loadCadastroBase1ColumnPrefs(storageKey, dataCols) {
  const knownIds = dataCols.map((c) => c.id);
  const defaults = Object.fromEntries(dataCols.map((c) => [c.id, c.width || 160]));
  const defaultVisible = dataCols.filter((c) => c.default !== false).map((c) => c.id);

  const unified = readJson(`${storageKey}_prefs`);
  if (unified && typeof unified === "object" && unified.version === CADASTRO_B1_COLUMN_PREFS_VERSION) {
    const cols = unified.columns && typeof unified.columns === "object" ? unified.columns : {};
    return {
      columnWidths: normalizeColumnWidths(defaults, cols.widths, knownIds),
      colunasOrdem: normalizeColumnOrder(knownIds, cols.order),
      colunasVisiveis: normalizeVisibleColumns(defaultVisible, cols.visible, knownIds),
      frozenCount: normalizeFrozenCount(cols.frozen, knownIds.length),
      autoFitKeys: normalizeAutoFitKeys(unified.autoFit, knownIds),
    };
  }

  const legacyWidths = readJson(`${storageKey}_largura`);
  const legacyOrder = readJson(`${storageKey}_ordem`);
  const legacyVisible = readJson(`${storageKey}_visiveis`);
  const legacyFrozen = localStorage.getItem(`${storageKey}_congeladas`);
  const legacyAutoFit = readJson(`${storageKey}_autofit`);

  return {
    columnWidths: normalizeColumnWidths(defaults, legacyWidths, knownIds),
    colunasOrdem: normalizeColumnOrder(knownIds, legacyOrder),
    colunasVisiveis: normalizeVisibleColumns(defaultVisible, legacyVisible, knownIds),
    frozenCount: normalizeFrozenCount(legacyFrozen, knownIds.length),
    autoFitKeys: normalizeAutoFitKeys(legacyAutoFit, knownIds),
  };
}

/**
 * @param {string} storageKey
 * @param {{
 *   columnWidths: Record<string, number>;
 *   colunasOrdem: string[];
 *   colunasVisiveis: string[];
 *   frozenCount: number;
 *   autoFitKeys: Set<string>;
 * }} state
 */
export function persistCadastroBase1ColumnPrefs(storageKey, state) {
  const { columnWidths, colunasOrdem, colunasVisiveis, frozenCount, autoFitKeys } = state;
  const autoFitArr = [...autoFitKeys];

  const unified = {
    version: CADASTRO_B1_COLUMN_PREFS_VERSION,
    columns: {
      widths: columnWidths,
      order: colunasOrdem,
      visible: colunasVisiveis,
      frozen: frozenCount,
    },
    autoFit: autoFitArr,
  };
  localStorage.setItem(`${storageKey}_prefs`, JSON.stringify(unified));

  localStorage.setItem(`${storageKey}_largura`, JSON.stringify(columnWidths));
  localStorage.setItem(`${storageKey}_ordem`, JSON.stringify(colunasOrdem));
  localStorage.setItem(`${storageKey}_visiveis`, JSON.stringify(colunasVisiveis));
  localStorage.setItem(`${storageKey}_congeladas`, String(frozenCount));
  localStorage.setItem(`${storageKey}_autofit`, JSON.stringify(autoFitArr));
}
