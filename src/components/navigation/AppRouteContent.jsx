import React, { useEffect, useLayoutEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import MapaGeral from "@/pages/MapaGeral";
import { createPageUrl } from "@/utils";
import { queryClientInstance } from "@/lib/query-client";

export const MAPA_GERAL_PATH = createPageUrl("MapaGeral");

/**
 * Conteúdo de rota no AppShell: cancela fetches da rota anterior e mantém o
 * Mapa Geral montado (oculto) após a primeira visita — evita reinit do Google Maps.
 */
export default function AppRouteContent() {
  const location = useLocation();
  const onMapa = location.pathname === MAPA_GERAL_PATH;
  const [mapaPersistenteAtivo, setMapaPersistenteAtivo] = useState(onMapa);

  useEffect(() => {
    if (onMapa) setMapaPersistenteAtivo(true);
  }, [onMapa]);

  useLayoutEffect(() => {
    queryClientInstance.cancelQueries({
      predicate: (query) => query.state.fetchStatus === "fetching",
    });
  }, [location.pathname, location.search, location.hash]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      {mapaPersistenteAtivo && (
        <div
          className={`absolute inset-0 min-h-0 overflow-hidden ${
            onMapa ? "z-10" : "pointer-events-none hidden z-0"
          }`}
          aria-hidden={!onMapa}
          data-persistent-map=""
        >
          <MapaGeral />
        </div>
      )}
      <div
        className={`relative h-full min-h-0 overflow-hidden ${
          onMapa ? "pointer-events-none invisible z-0" : "z-20"
        }`}
        aria-hidden={onMapa}
      >
        <Outlet />
      </div>
    </div>
  );
}
