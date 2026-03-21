import { ACTION_OPTIONS, DEFAULT_MOBILE_MENU_ITEMS, PAGE_OPTIONS, createEmptyPermissionsMap, getPageOptionById, getPageOptionByUrl } from "@/lib/navigationConfig";

const asArray = (value) => Array.isArray(value) ? value : [];
const ACTION_IDS = ACTION_OPTIONS.map((item) => item.id);

export const isAdminPermission = (user, roleConfig) => {
  return user?.role === "admin" || roleConfig?.is_admin === true;
};

export const normalizeRolePermissions = (roleConfig) => {
  const base = createEmptyPermissionsMap();
  const current = roleConfig?.permissoes || {};

  Object.entries(current).forEach(([pageId, actions]) => {
    if (!base[pageId]) base[pageId] = {};
    ACTION_IDS.forEach((actionId) => {
      base[pageId][actionId] = actions?.[actionId] === true;
    });
  });

  return base;
};

export const getPagePermissionById = (roleConfig, pageId) => {
  const permissions = normalizeRolePermissions(roleConfig);
  return permissions[pageId] || ACTION_IDS.reduce((acc, actionId) => {
    acc[actionId] = false;
    return acc;
  }, {});
};

export const getPagePermissionByUrl = (roleConfig, pageUrl) => {
  const page = getPageOptionByUrl(pageUrl);
  if (!page) return null;
  return getPagePermissionById(roleConfig, page.id);
};

export const canViewPage = (roleConfig, pageId, isAdmin = false) => {
  if (isAdmin || !roleConfig) return true;
  return getPagePermissionById(roleConfig, pageId).visualizar === true;
};

const filterItem = (item, roleConfig, isAdmin = false) => {
  if (item.submenu?.length) {
    const filteredChildren = item.submenu.map((child) => filterItem(child, roleConfig, isAdmin)).filter(Boolean);
    return filteredChildren.length ? { ...item, submenu: filteredChildren } : null;
  }

  return canViewPage(roleConfig, item.id, isAdmin) ? item : null;
};

export const filterMenuByPermissions = (menuItems, roleConfig, isAdmin = false) => {
  if (isAdmin || !roleConfig) return menuItems;
  return menuItems.map((item) => filterItem(item, roleConfig, isAdmin)).filter(Boolean);
};

export const canAccessPage = (currentPageName, roleConfig, isAdmin = false) => {
  if (!currentPageName || isAdmin || !roleConfig) return true;
  const page = getPageOptionByUrl(currentPageName);
  if (!page) return true;
  return canViewPage(roleConfig, page.id, isAdmin);
};

export const getAllowedMobileMenuItems = (roleConfig, isAdmin = false) => {
  const preferredIds = asArray(roleConfig?.mobile_atalhos);
  const requested = preferredIds.length ? preferredIds : DEFAULT_MOBILE_MENU_ITEMS;
  const allowed = [];

  const tryAdd = (pageId) => {
    const page = getPageOptionById(pageId);
    if (!page) return;
    if (!canViewPage(roleConfig, page.id, isAdmin)) return;
    if (allowed.some((item) => item.id === page.id)) return;
    allowed.push(page);
  };

  requested.forEach(tryAdd);
  PAGE_OPTIONS.forEach((page) => tryAdd(page.id));

  return allowed.slice(0, 4);
};

export const getAccessSummary = (roleConfig) => {
  if (!roleConfig) {
    return { principal: "Acesso Livre", secundario: "Sem grupo" };
  }

  if (roleConfig.is_admin) {
    return { principal: "Administrador", secundario: "Acesso total" };
  }

  const permissions = normalizeRolePermissions(roleConfig);
  const totalPages = Object.values(permissions).filter((page) => page.visualizar).length;
  const totalActions = Object.values(permissions).reduce((sum, page) => {
    return sum + ACTION_IDS.filter((actionId) => page[actionId]).length;
  }, 0);

  return {
    principal: `${totalPages} telas`,
    secundario: `${totalActions} ações`
  };
};

export const hasActionPermission = (roleConfig, pageUrlOrId, actionId, isAdmin = false) => {
  if (isAdmin || !roleConfig) return true;

  const page = getPageOptionByUrl(pageUrlOrId) || getPageOptionById(pageUrlOrId);
  if (!page) return true;

  return getPagePermissionById(roleConfig, page.id)?.[actionId] === true;
};