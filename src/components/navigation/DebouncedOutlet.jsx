import React, { useLayoutEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { queryClientInstance } from "@/lib/query-client";

/** Atraso curto para não montar páginas intermediárias em cliques rápidos no menu. */
export const NAV_ROUTE_SETTLE_MS = 48;

/**
 * Desmonta a rota atual assim que o pathname muda; remonta só após a navegação
 * estabilizar. Cancela queries em flight para não competir com a próxima tela.
 */
export default function DebouncedOutlet() {
  const location = useLocation();
  const targetRef = useRef(location);
  const [renderLocation, setRenderLocation] = useState(location);
  const timerRef = useRef(null);

  useLayoutEffect(() => {
    targetRef.current = location;

    queryClientInstance.cancelQueries({
      predicate: (query) => query.state.fetchStatus === "fetching",
    });

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      setRenderLocation(targetRef.current);
      timerRef.current = null;
    }, NAV_ROUTE_SETTLE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [location.pathname, location.search, location.hash]);

  const settled =
    renderLocation.pathname === location.pathname &&
    renderLocation.search === location.search &&
    renderLocation.hash === location.hash;

  if (!settled) {
    return (
      <div
        className="relative h-full min-h-0 overflow-hidden"
        data-nav-pending=""
        aria-busy="true"
      />
    );
  }

  return <Outlet />;
}
