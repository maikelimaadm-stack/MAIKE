import React from "react";

/** @type {React.Context<boolean>} */
export const PortalComprasSkinContext = React.createContext(false);

export function PortalComprasSkinProvider({ active, children }) {
  return (
    <PortalComprasSkinContext.Provider value={Boolean(active)}>
      {children}
    </PortalComprasSkinContext.Provider>
  );
}

export function usePortalComprasSkin() {
  return React.useContext(PortalComprasSkinContext);
}
