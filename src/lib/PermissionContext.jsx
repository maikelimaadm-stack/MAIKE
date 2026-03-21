import React, { createContext, useContext, useMemo } from "react";
import { getPagePermissions, hasPageAction } from "@/lib/permissions";

const PermissionContext = createContext({
  permissionGroup: null,
  isAdmin: false,
  canAccess: () => true,
  getActions: () => ({})
});

export function PermissionProvider({ permissionGroup, isAdmin, children }) {
  const value = useMemo(() => ({
    permissionGroup,
    isAdmin,
    canAccess: (pageUrl, action = "visualizar") => hasPageAction(permissionGroup, pageUrl, action, isAdmin),
    getActions: (pageUrl) => getPagePermissions(permissionGroup, pageUrl, isAdmin)
  }), [permissionGroup, isAdmin]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePagePermission(pageUrl) {
  const context = useContext(PermissionContext);
  const actions = context.getActions(pageUrl);

  return {
    actions,
    canVisualizar: context.canAccess(pageUrl, "visualizar"),
    canCriar: context.canAccess(pageUrl, "criar"),
    canEditar: context.canAccess(pageUrl, "editar"),
    canExcluir: context.canAccess(pageUrl, "excluir"),
    canImportar: context.canAccess(pageUrl, "importar"),
    canExportar: context.canAccess(pageUrl, "exportar")
  };
}

export function ActionGuard({ pageUrl, action = "visualizar", children, fallback = null }) {
  const context = useContext(PermissionContext);
  if (!context.canAccess(pageUrl, action)) return fallback;
  return children;
}