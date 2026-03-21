import { DEFAULT_MOBILE_MENU_ITEMS, PAGE_OPTIONS, getPageOptionByUrl } from "@/lib/navigationConfig";

const asArray = (value) => Array.isArray(value) ? value : [];

export const isAdminPermission = (user, permission) => {
  return user?.role === "admin" || permission?.is_admin === true;
};

export const hasModulePermission = (permission, moduleId) => {
  return asArray(permission?.modulos_permitidos).includes(moduleId);
};

export const hasPagePermission = (permission, pageUrl) => {
  return asArray(permission?.paginas_permitidas).includes(pageUrl);
};

const filterItem = (item, permission) => {
  if (item.submenu?.length) {
    const filteredChildren = item.submenu.filter((child) => hasModulePermission(permission, item.id) || hasPagePermission(permission, child.url));
    if (!filteredChildren.length && !hasModulePermission(permission, item.id)) return null;
    return { ...item, submenu: filteredChildren.length ? filteredChildren : item.submenu };
  }

  if (hasModulePermission(permission, item.id) || hasPagePermission(permission, item.url)) {
    return item;
  }

  return null;
};

export const filterMenuByPermissions = (menuItems, permission, isAdmin = false) => {
  if (isAdmin || !permission) return menuItems;
  return menuItems.map((item) => filterItem(item, permission)).filter(Boolean);
};

export const canAccessPage = (menuItems, currentPageName, permission, isAdmin = false) => {
  if (!currentPageName || isAdmin || !permission) return true;

  const matchedPage = PAGE_OPTIONS.find((page) => page.url === currentPageName);
  if (matchedPage) {
    return hasModulePermission(permission, matchedPage.moduleId) || hasPagePermission(permission, matchedPage.url);
  }

  const topLevelItem = menuItems.find((item) => item.url === currentPageName);
  if (topLevelItem) {
    return hasModulePermission(permission, topLevelItem.id) || hasPagePermission(permission, currentPageName);
  }

  return false;
};

export const getAllowedMobileMenuItems = (permission, isAdmin = false) => {
  const preferred = asArray(permission?.mobile_menu_items);
  const requested = preferred.length ? preferred : DEFAULT_MOBILE_MENU_ITEMS;
  const allowed = [];

  const tryAdd = (url) => {
    const page = getPageOptionByUrl(url);
    if (!page) return;
    if (!isAdmin && permission && !canAccessPage([], url, permission, false)) return;
    if (allowed.some((item) => item.url === page.url)) return;
    allowed.push(page);
  };

  requested.forEach(tryAdd);
  PAGE_OPTIONS.forEach((page) => tryAdd(page.url));

  return allowed.slice(0, 4);
};

export const getAccessSummary = (permission) => {
  if (!permission) {
    return { label: "Total", count: "Livre" };
  }

  if (permission.is_admin) {
    return { label: "Total", count: "Admin" };
  }

  const modules = asArray(permission.modulos_permitidos).length;
  const pages = asArray(permission.paginas_permitidas).length;
  return { label: `${modules} módulos`, count: `${pages} telas` };
};

export const hasActionPermission = (permission, action, isAdmin = false) => {
  if (isAdmin || !permission) return true;
  const actions = asArray(permission?.acoes_permitidas);
  if (!actions.length) return true;
  return actions.includes(action);
};