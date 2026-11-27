import React, { useEffect, useRef, useState } from "react";
import { GoogleMap } from "@capacitor/google-maps";

import { getGoogleMapsApiKey, getGoogleMapsIosKey } from "@/config/runtimeConfig";
import { lerVisaoSalva } from "@/lib/maplibre/mapaGeralRender.js";
import {
  caixaDosPoligonos,
  chaveDaVistaSalva,
  configDoMapaGoogle,
  ehMapaGoogleNativo,
  poligonosDasAreas,
  tipoDoMapaGoogle,
} from "@/lib/mapaNativo/mapaGoogleNativo.js";

const ID_DO_MAPA = "mk-mapa-geral-google";
const CENTRO_PADRAO = { lat: -15.78, lng: -47.93 };

/**
 * O mapa nativo fica ATRÁS da página (o plugin deixa a WebView transparente): todo elemento entre o mapa e a raiz
 * precisa estar sem fundo, senão ele cobre o mapa. Guarda o fundo de cada um e devolve ao sair.
 * @param {HTMLElement | null} el
 */
function abrirJanelaParaOMapa(el) {
  /** @type {Array<[HTMLElement, string]>} */
  const antes = [];
  for (let n = el?.parentElement; n; n = n.parentElement) {
    antes.push([n, n.style.background]);
    n.style.background = "transparent";
  }
  return () => {
    for (const [n, fundo] of antes) n.style.background = fundo;
  };
}

/**
 * Mapa Geral no Google Maps (D-PROD-366, etapa 1): nativo no app Android/iOS, Maps JavaScript API no site. Satélite do
 * Google, áreas com as cores e o estilo do Mapa Geral, toque na área abre o mesmo detalhe. A vista (centro e zoom)
 * usa a mesma chave do MapLibre.
 *
 * @param {{
 *   areas: any[],
 *   mostrarAreas: boolean,
 *   corDaArea: (area: any) => string,
 *   estiloPasto?: string,
 *   tipoMapa: string,
 *   empresaId?: string | null,
 *   onClickArea?: (area: any) => void,
 *   onFalha?: (erro: unknown) => void,
 * }} props
 */
export default function MapaGoogleNativo({ areas, mostrarAreas, corDaArea, estiloPasto, tipoMapa, empresaId, onClickArea, onFalha }) {
  const elRef = useRef(/** @type {HTMLElement | null} */ (null));
  const mapaRef = useRef(/** @type {GoogleMap | null} */ (null));
  const idsRef = useRef(/** @type {string[]} */ ([]));
  const areasPorIdRef = useRef(new Map());
  const cliqueRef = useRef(onClickArea);
  cliqueRef.current = onClickArea;
  const falhaRef = useRef(onFalha);
  falhaRef.current = onFalha;
  const enquadrouRef = useRef(false);
  const tipoMapaInicialRef = useRef(tipoMapa);
  const [pronto, setPronto] = useState(false);

  // cria o mapa uma vez por fazenda
  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;
    let cancelado = false;
    const nativo = ehMapaGoogleNativo();
    // só o mapa nativo fica atrás da página; no site o mapa é desenhado dentro do próprio elemento
    const fecharJanela = nativo ? abrirJanelaParaOMapa(el) : () => {};
    let vista = null;
    try {
      vista = lerVisaoSalva(localStorage.getItem(chaveDaVistaSalva(empresaId)));
    } catch {
      vista = null;
    }
    enquadrouRef.current = !!vista;
    (async () => {
      try {
        const mapa = await GoogleMap.create({
          id: ID_DO_MAPA,
          element: el,
          // Android lê a chave do AndroidManifest (segredo do build do APK); o iOS e o site recebem aqui.
          apiKey: (nativo ? getGoogleMapsIosKey() : null) || getGoogleMapsApiKey() || "",
          forceCreate: true,
          config: /** @type {any} */ (configDoMapaGoogle({ center: vista?.center || CENTRO_PADRAO, zoom: vista?.zoom ?? 15 }, tipoMapaInicialRef.current)),
        });
        if (cancelado) {
          await mapa.destroy();
          return;
        }
        mapaRef.current = mapa;
        await mapa.setOnPolygonClickListener((e) => {
          const area = areasPorIdRef.current.get(String(e?.tag));
          if (area) cliqueRef.current?.(area);
        });
        await mapa.setOnCameraIdleListener((e) => {
          if (!enquadrouRef.current || !Number.isFinite(e?.latitude)) return;
          try {
            localStorage.setItem(
              chaveDaVistaSalva(empresaId),
              JSON.stringify({ center: { lat: e.latitude, lng: e.longitude }, zoom: e.zoom })
            );
          } catch {
            /* armazenamento indisponível */
          }
        });
        if (!cancelado) setPronto(true);
      } catch (erro) {
        if (!cancelado) falhaRef.current?.(erro);
      }
    })();
    return () => {
      cancelado = true;
      setPronto(false);
      idsRef.current = [];
      const mapa = mapaRef.current;
      mapaRef.current = null;
      fecharJanela();
      mapa?.destroy().catch(() => {});
    };
  }, [empresaId]);

  // satélite ou mapa
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!pronto || !mapa) return;
    mapa.setMapType(/** @type {any} */ (tipoDoMapaGoogle(tipoMapa))).catch(() => {});
  }, [pronto, tipoMapa]);

  // áreas: refeitas quando mudam as áreas, as cores (coloração) ou o estilo dos pastos
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!pronto || !mapa) return undefined;
    let cancelado = false;
    const lista = mostrarAreas ? areas || [] : [];
    areasPorIdRef.current = new Map(lista.map((a) => [String(a.id), a]));
    const poligonos = poligonosDasAreas(lista, corDaArea, estiloPasto);
    (async () => {
      try {
        const velhos = idsRef.current;
        idsRef.current = [];
        if (velhos.length) await mapa.removePolygons(velhos);
        if (cancelado || !poligonos.length) return;
        idsRef.current = await mapa.addPolygons(/** @type {any} */ (poligonos));
        // primeira abertura sem vista salva: enquadra a fazenda
        if (!enquadrouRef.current) {
          const caixa = caixaDosPoligonos(poligonos);
          enquadrouRef.current = true;
          if (caixa) await mapa.fitBounds(/** @type {any} */ (caixa), 40);
        }
      } catch (erro) {
        if (!cancelado) falhaRef.current?.(erro);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [pronto, areas, mostrarAreas, corDaArea, estiloPasto]);

  return (
    <capacitor-google-map
      ref={elRef}
      data-testid="mapa-geral-google"
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
