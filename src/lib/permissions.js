import { DEFAULT_MOBILE_SHORTCUT_IDS, DEFAULT_PAGE_ACTIONS, PAGE_OPTIONS, getPageOptionById, getPageOptionByUrl } from "@/lib/navigationConfig";

const fullAccess = {
  visualizar: true,
  criar: true,
  editar: true,
  excluir: true,
  importar: true,
  exportar: true
};

const asObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

export const isAdminPermission = (user, permissionGroup) => {
  return user?.role === "admin" || permissionGroup?.is_admin === true;
};

export const getGroupPermissionsMap = (permissionGroup) => {
  return asObject(permissionGroup?.permissoes);
};

export const getPagePermissions = (permissionGroup, pageUrlOrId, isAdmin = false) => {
  if (isAdmin || !permissionGroup) return fullAccess;

  const page = getPageOptionByUrl(pageUrlOrId) || getPageOptionById(pageUrlOrId);
  if (!page) return fullAccess;

  const stored = getGroupPermissionsMap(permissionGroup)[page.id];
  return { ...DEFAULT_PAGE_ACTIONS, ...asObject(stored) };
};

export const hasPageAction = (permissionGroup, pageUrlOrId, action, isAdmin = false) => {
  const permissions = getPagePermissions(permissionGroup, pageUrlOrId, isAdmin);
  return permissions[action] === true;
};

const filterItem = (item, permissionGroup, isAdmin) => {
  if (item.submenu?.length) {
    const filteredChildren = item.submenu
      .map((child) => filterItem(child, permissionGroup, isAdmin))
      .filter(Boolean);

    if (!filteredChildren.length) return null;
    return { ...item, submenu: filteredChildren };
  }

  if (!item.url) return null;
  return hasPageAction(permissionGroup, item.url, "visualizar", isAdmin) ? item : null;
};

export const filterMenuByPermissions = (menuItems, permissionGroup, isAdmin = false) => {
  if (isAdmin || !permissionGroup) return menuItems;
  return menuItems.map((item) => filterItem(item, permissionGroup, isAdmin)).filter(Boolean);
};

export const canAccessPage = (_menuItems, currentPageName, permissionGroup, isAdmin = false) => {
  if (!currentPageName || isAdmin || !permissionGroup) return true;
  const page = getPageOptionByUrl(currentPageName);
  if (!page) return true;
  return hasPageAction(permissionGroup, page.url, "visualizar", isAdmin);
};

export const getAllowedMobileMenuItems = (permissionGroup, isAdmin = false) => {
  const preferredIds = permissionGroup?.mobile?.atalhos?.length ? permissionGroup.mobile.atalhos : DEFAULT_MOBILE_SHORTCUT_IDS;
  const allowed = [];

  const tryPush = (pageId) => {
    const page = getPageOptionById(pageId);
    if (!page) return;
    if (!hasPageAction(permissionGroup, page.url, "visualizar", isAdmin)) return;
    if (allowed.some((item) => item.id === page.id)) return;
    allowed.push(page);
  };

  preferredIds.forEach(tryPush);
  PAGE_OPTIONS.forEach((page) => tryPush(page.id));

  return allowed.slice(0, 4);
};

export const getAccessSummary = (permissionGroup) => {
  if (!permissionGroup) return { role: "SEM GRUPO", details: "ACESSO LIVRE" };
  if (permissionGroup.is_admin) return { role: permissionGroup.nome?.toUpperCase() || "ADMINISTRADOR", details: "ACESSO TOTAL" };

  const pages = Object.values(getGroupPermissionsMap(permissionGroup)).filter((entry) => entry?.visualizar).length;
  const mobile = permissionGroup?.mobile?.atalhos?.length || DEFAULT_MOBILE_SHORTCUT_IDS.length;

  return {
    role: permissionGroup.nome?.toUpperCase() || "GRUPO",
    details: `${pages} TELAS · ${mobile} ATALHOS`
  };
};