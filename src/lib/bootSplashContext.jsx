import React, { createContext, useCallback, useContext, useState } from 'react';

/**
 * Sinaliza quando o Layout terminou o bootstrap (usuário, permissões, empresas).
 * O splash de entrada fica no App — uma instância só — para não remontar ao sair
 * do carregamento de auth.
 */

/** @typedef {{ layoutBootReady: boolean, markLayoutBootReady: () => void, resetLayoutBoot: () => void }} BootSplashContextValue */

/** @type {import('react').Context<BootSplashContextValue|null>} */
const BootSplashContext = createContext(null);

export function BootSplashProvider({ children }) {
  const [layoutBootReady, setLayoutBootReady] = useState(false);
  const markLayoutBootReady = useCallback(() => setLayoutBootReady(true), []);
  const resetLayoutBoot = useCallback(() => setLayoutBootReady(false), []);

  return (
    <BootSplashContext.Provider
      value={{ layoutBootReady, markLayoutBootReady, resetLayoutBoot }}
    >
      {children}
    </BootSplashContext.Provider>
  );
}

/** @returns {BootSplashContextValue} */
export function useBootSplash() {
  const ctx = useContext(BootSplashContext);
  if (!ctx) {
    throw new Error('useBootSplash must be used within BootSplashProvider');
  }
  return ctx;
}
