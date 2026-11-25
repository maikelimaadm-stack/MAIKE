import React, { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { pagesConfig } from "@/pages.config";
import { createPageUrl } from "@/utils";
import { normalizeAppPathname } from "@/lib/navigation/normalizeAppPathname";

const MapaGeral = pagesConfig.Pages[pagesConfig.mainPage];

/**
 * Conteúdo de rota no AppShell. Não cancela queries globalmente na troca de URL:
 * isso atingia fetches compartilhados sem delimitar a rota anterior (#94).
 *
 * D-PROD-305 — o Mapa Geral fica VIVO depois da primeira abertura: trocar de
 * menu o esconde (`display: none`) em vez de desmontar, e voltar mostra o mapa
 * como estava (sem recriar o mapa, o satélite e as camadas). A #94 tinha tirado
 * o mapa persistente porque, com o Google Maps, o mapa escondido seguia
 * sincronizando tudo e travava a navegação; com o MapLibre, escondido ele fica
 * INERTE (`ativo={false}`): sem GPS, sem redesenho, e se ajusta ao voltar.
 */
export default function AppRouteContent() {
  const { pathname } = useLocation();
  const naMapa = normalizeAppPathname(pathname) === createPageUrl(pagesConfig.mainPage);
  const [mapaAberto, setMapaAberto] = useState(naMapa);

  useEffect(() => {
    if (naMapa) setMapaAberto(true);
  }, [naMapa]);

  return (
    <>
      {mapaAberto || naMapa ? (
        <div data-mapa-vivo={naMapa ? "visivel" : "escondido"} style={{ display: naMapa ? "contents" : "none" }}>
          <MapaGeral ativo={naMapa} />
        </div>
      ) : null}
      {naMapa ? null : <Outlet />}
    </>
  );
}
