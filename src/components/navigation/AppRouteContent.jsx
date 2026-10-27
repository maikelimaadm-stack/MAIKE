import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { queryClientInstance } from "@/lib/query-client";

/**
 * Conteúdo de rota no AppShell: cancela fetches da rota anterior sem bloquear
 * paint (useEffect, não useLayoutEffect). Mapa Geral monta/desmonta com a rota —
 * instância persistente oculta monopolizava a main thread (RC-MENU-FREEZE-2026-10-27).
 */
export default function AppRouteContent() {
  const location = useLocation();

  useEffect(() => {
    queryClientInstance.cancelQueries({
      predicate: (query) => query.state.fetchStatus === "fetching",
    });
  }, [location.pathname, location.search, location.hash]);

  return <Outlet />;
}
