export const ACTION_KEYS = ["visualizar", "novo", "salvar", "editar", "excluir", "importar", "exportar"];

export const ACTION_LABELS = {
  visualizar: "visualizar",
  novo: "criar novos registros",
  salvar: "salvar alterações",
  editar: "editar registros",
  excluir: "excluir registros",
  importar: "importar dados",
  exportar: "exportar dados",
  confirmar: "confirmar lançamentos",
  liquidar: "registrar pagamentos e recebimentos",
  estornar_liquidacao: "estornar baixas",
  cancelar: "cancelar lançamentos",
  inativar: "inativar ou reativar registros",
  // D-PROD-200 — Lançamento de Atividades.
  reabrir: "reabrir atividade",
  lancar_apontamento: "lançar apontamento",
  editar_apontamento: "editar apontamento",
  cancelar_apontamento: "cancelar apontamento",
  // D-PROD-257 — Estoque → Entradas.
  entrada: "lançar e excluir entradas de estoque",
};

/**
 * Ações EXTRAS de uma tela (D-PROD-155), gravadas na própria linha da tela em
 * `permissoes_telas` (sem coluna nova: `telaPermite` do servidor testa
 * `linha[acao] === true` para qualquer nome).
 *  - Central de Lançamentos: espelho de `GUARDAS.operacaoFinanceira`;
 *  - Patrimônio e Frota (D-PROD-157/161): `inativar` (inativar e reativar) em
 *    Bens Patrimoniais (vale também para famílias e tipos, que vivem nela) —
 *    espelho de `ACOES_PATRIMONIO_EXTRAS` e da guarda `edicaoPatrimonio`
 *    (backend/src/shared/auth/guardasRotas.js);
 *  - Abastecimentos (D-PROD-159/161): `cancelar` (cancelar/estornar o
 *    abastecimento) — espelho de `ACOES_ABASTECIMENTO_EXTRAS`;
 *  - Lançamento de Atividades (D-PROD-200): `reabrir` (reabrir atividade
 *    concluída) e as ações do apontamento (`lancar_apontamento`, que também
 *    "repete", `editar_apontamento` e `cancelar_apontamento`), na linha da tela
 *    `op-atividades`.
 * As telas antigas (`pat-familias-patrimoniais`, `pat-tipos-patrimoniais`,
 * `pat-perfis-medicao`, `pat-combustiveis`) e a ação `configurar_conversao`
 * saíram (D-PROD-162): linhas já gravadas ficam inertes no JSON.
 */
const ACOES_EXTRAS_PATRIMONIO = Object.freeze(["inativar"]);

export const EXTRA_ACTION_KEYS_BY_PAGE = Object.freeze({
  "ges-lancamentos-financeiros": Object.freeze(["confirmar", "liquidar", "estornar_liquidacao", "cancelar"]),
  "pat-bens-patrimoniais": ACOES_EXTRAS_PATRIMONIO,
  "pat-abastecimentos": Object.freeze(["cancelar"]),
  "op-atividades": Object.freeze(["reabrir", "lancar_apontamento", "editar_apontamento", "cancelar_apontamento"]),
  // D-PROD-257 — Estoque → Entradas: criar/editar observação/excluir entrada manual e saldo de implantação.
  // Espelho de `ACOES_ESTOQUE_EXTRAS`; `ajuste` (inventário) segue reservada e não existe.
  // D-PROD-264: `saida` — saída manual (custo médio) e motivos de saída.
  // D-PROD-266: `ajuste` — ajuste de inventário.
  "sup-estoque": Object.freeze(["entrada", "saida", "ajuste"]),
});

/** @param {string} pageId @returns {readonly string[]} */
export const extraActionKeysOf = (pageId) => EXTRA_ACTION_KEYS_BY_PAGE[pageId] ?? [];

export const normalizePermissionRecord = (permission) => {
  if (!permission) return null;

  return {
    ...permission,
    modulos_permitidos: Array.isArray(permission.modulos_permitidos) ? permission.modulos_permitidos : [],
    permissoes_telas: Array.isArray(permission.permissoes_telas) ? permission.permissoes_telas : [],
    mobile_menu_ids: Array.isArray(permission.mobile_menu_ids) ? permission.mobile_menu_ids : [],
  };
};

/** IDs de menu que compartilham a mesma linha em `permissoes_telas` (retrocompat). */
export const PERMISSION_PAGE_ALIASES = {
  "adm-permissoes": "adm-usuarios",
};

export const resolvePermissionPageId = (pageId) => PERMISSION_PAGE_ALIASES[pageId] ?? pageId;

export const getPagePermission = (permission, pageId) => {
  const normalized = normalizePermissionRecord(permission);
  if (!normalized) return null;
  const direct = normalized.permissoes_telas.find((item) => item.tela_id === pageId);
  if (direct) return direct;
  const alias = resolvePermissionPageId(pageId);
  if (alias !== pageId) {
    return normalized.permissoes_telas.find((item) => item.tela_id === alias) || null;
  }
  return null;
};

/*
 * Avaliação FAIL-CLOSED (mesma regra do servidor, `backend/src/shared/auth/autorizacaoTela.js`):
 *  - sem registro → nada (antes: tudo liberado);
 *  - `is_admin` da linha → todas as telas/ações (concessão explícita de menu; não é
 *    o papel de administrador da fazenda — para ele o chamador monta o registro
 *    efetivo com `permissaoEfetiva`);
 *  - senão: módulo concedido E linha da tela com `visualizar === true` E a ação
 *    `=== true`. Tela sem linha → negada (antes: liberada).
 * Isto só decide o que a interface mostra; quem bloqueia de fato é o servidor (403).
 */
export const canAccessModule = (permission, moduleId) => {
  const normalized = normalizePermissionRecord(permission);
  if (!normalized) return false;
  if (normalized.is_admin === true) return true;
  return normalized.modulos_permitidos.includes(moduleId);
};

export const canAccessPage = (permission, pageId, moduleId) => {
  const normalized = normalizePermissionRecord(permission);
  if (!normalized) return false;
  if (normalized.is_admin === true) return true;
  if (!canAccessModule(normalized, moduleId)) return false;
  const pagePermission = getPagePermission(normalized, pageId);
  return pagePermission?.visualizar === true;
};

export const canPerformAction = (permission, pageId, moduleId, action) => {
  const normalized = normalizePermissionRecord(permission);
  if (!normalized) return false;
  if (normalized.is_admin === true) return true;
  if (!canAccessPage(normalized, pageId, moduleId)) return false;
  if (action === "visualizar") return true;
  return getPagePermission(normalized, pageId)?.[action] === true;
};

const createBasePagePermission = (moduleId, moduleTitle, page, defaultValue) => ({
  modulo_id: moduleId,
  modulo_nome: moduleTitle,
  tela_id: page.id,
  tela_nome: page.title,
  visualizar: defaultValue,
  novo: defaultValue,
  salvar: defaultValue,
  editar: defaultValue,
  excluir: defaultValue,
  importar: defaultValue,
  exportar: defaultValue,
  // Linha nova já nasce com as ações extras da tela (restrita = todas desligadas).
  ...Object.fromEntries(extraActionKeysOf(page.id).map((acao) => [acao, defaultValue])),
});

export const createPagePermission = (moduleId, moduleTitle, page) =>
  createBasePagePermission(moduleId, moduleTitle, page, true);

export const createRestrictedPagePermission = (moduleId, moduleTitle, page) =>
  createBasePagePermission(moduleId, moduleTitle, page, false);

export const detectPermissionAction = (text = "") => {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  if (/^(novo|criar|lancar|lançar|adicionar)\b/.test(normalized)) return "novo";
  if (/^(salvar|gravar|confirmar)\b/.test(normalized)) return "salvar";
  if (/^(editar)\b/.test(normalized)) return "editar";
  if (/^(excluir|remover|apagar)\b/.test(normalized)) return "excluir";
  if (/^(importar)\b/.test(normalized)) return "importar";
  if (/^(exportar)\b/.test(normalized)) return "exportar";
  return null;
};