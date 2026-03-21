export const ACTION_KEYS = ["visualizar", "novo", "salvar", "editar", "excluir", "importar", "exportar"];

export const ACTION_LABELS = {
  visualizar: "visualizar",
  novo: "criar novos registros",
  salvar: "salvar alterações",
  editar: "editar registros",
  excluir: "excluir registros",
  importar: "importar dados",
  exportar: "exportar dados",
};

export const normalizePermissionRecord = (permission) => {
  if (!permission) return null;

  return {
    ...permission,
    modulos_permitidos: Array.isArray(permission.modulos_permitidos) ? permission.modulos_permitidos : [],
    permissoes_telas: Array.isArray(permission.permissoes_telas) ? permission.permissoes_telas : [],
    mobile_menu_ids: Array.isArray(permission.mobile_menu_ids) ? permission.mobile_menu_ids : [],
  };
};

export const getPagePermission = (permission, pageId) => {
  const normalized = normalizePermissionRecord(permission);
  if (!normalized) return null;
  return normalized.permissoes_telas.find((item) => item.tela_id === pageId) || null;
};

export const canAccessModule = (permission, moduleId) => {
  const normalized = normalizePermissionRecord(permission);
  if (!normalized || normalized.is_admin) return true;
  return normalized.modulos_permitidos.includes(moduleId);
};

export const canAccessPage = (permission, pageId, moduleId) => {
  const normalized = normalizePermissionRecord(permission);
  if (!normalized || normalized.is_admin) return true;
  if (!canAccessModule(normalized, moduleId)) return false;
  const pagePermission = getPagePermission(normalized, pageId);
  if (!pagePermission) return true;
  return pagePermission.visualizar !== false;
};

export const canPerformAction = (permission, pageId, moduleId, action) => {
  const normalized = normalizePermissionRecord(permission);
  if (!normalized || normalized.is_admin) return true;
  if (!canAccessPage(normalized, pageId, moduleId)) return false;
  const pagePermission = getPagePermission(normalized, pageId);
  if (!pagePermission) return true;
  return pagePermission[action] !== false;
};

export const createPagePermission = (moduleId, moduleTitle, page) => ({
  modulo_id: moduleId,
  modulo_nome: moduleTitle,
  tela_id: page.id,
  tela_nome: page.title,
  visualizar: true,
  novo: true,
  salvar: true,
  editar: true,
  excluir: true,
  importar: true,
  exportar: true,
});

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