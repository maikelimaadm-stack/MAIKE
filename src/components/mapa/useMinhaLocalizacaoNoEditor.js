import { useEffect, useRef } from "react";
import { maplibregl } from "@/lib/maplibre/lifecycle.js";
import { buildAccuracyCircleCollection } from "@/lib/maplibre/gpsCapture.js";
import { useLocalizacaoNoMapa } from "./useLocalizacaoNoMapa";
import { useRumoDoAparelho } from "./useRumoDoAparelho";

/**
 * D-PROD-333 — o ponto azul da localização no mapa do CADASTRO (áreas, pontos e linhas), igual ao Mapa Geral:
 * o mesmo GPS (`useLocalizacaoNoMapa`, alta precisão, o ponto anda junto) e o círculo da precisão real. Antes o
 * cadastro não mostrava onde a pessoa está; o botão só centralizava a tela uma vez.
 *
 * O círculo é uma camada do mapa (refeita quando o fundo troca — `reaplicar`); o ponto é um marcador.
 *
 * @param {{ mapInstanceRef: { current: any }, mapReady: boolean, aoErro?: (m: string) => void }} p
 */
export function useMinhaLocalizacaoNoEditor({ mapInstanceRef, mapReady, aoErro }) {
  const gps = useLocalizacaoNoMapa({ mapInstanceRef, ativo: mapReady, aoErro });
  // D-PROD-362: a seta de para onde o celular aponta (bússola; andando, o rumo do GPS).
  const rumo = useRumoDoAparelho({ ativo: mapReady, posicao: gps.posicao });
  const marcadorRef = useRef(/** @type {any} */ (null));
  const setaRef = useRef(/** @type {HTMLElement|null} */ (null));
  const posicaoRef = useRef(gps.posicao);
  posicaoRef.current = gps.posicao;
  const rumoRef = useRef(rumo);
  rumoRef.current = rumo;

  const FONTE = "mk-eu-precisao";
  const desenhar = () => {
    const map = mapInstanceRef.current;
    if (!map || typeof map.getSource !== "function") return;
    const p = posicaoRef.current;
    const dados = p ? buildAccuracyCircleCollection(p, Math.min(Math.max(Number(p.accuracy) || 20, 3), 500)) : { type: "FeatureCollection", features: [] };
    try {
      const fonte = map.getSource(FONTE);
      if (fonte) fonte.setData(dados);
      else {
        map.addSource(FONTE, { type: "geojson", data: dados });
        map.addLayer({ id: `${FONTE}-fundo`, type: "fill", source: FONTE, paint: { "fill-color": "#2563eb", "fill-opacity": 0.15 } });
        map.addLayer({ id: `${FONTE}-borda`, type: "line", source: FONTE, paint: { "line-color": "#2563eb", "line-opacity": 0.5, "line-width": 1 } });
      }
    } catch {
      /* estilo ainda carregando: o próximo `reaplicar` desenha */
    }
    if (!p) return;
    if (!marcadorRef.current) {
      const el = document.createElement("div");
      el.setAttribute("data-mk-minha-localizacao", "");
      el.style.cssText = "position:relative;width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 2px rgba(37,99,235,.35);pointer-events:none";
      // D-PROD-362: a seta (um triângulo azul acima do ponto), girada pelo rumo; some sem bússola.
      const seta = document.createElement("div");
      seta.setAttribute("data-mk-rumo", "");
      seta.style.cssText = "position:absolute;left:50%;top:50%;width:0;height:0;margin-left:-7px;margin-top:-26px;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:12px solid #2563eb;transform-origin:7px 26px;display:none";
      el.appendChild(seta);
      setaRef.current = seta;
      marcadorRef.current = new maplibregl.Marker({ element: el, anchor: "center" });
    }
    const r = rumoRef.current;
    if (setaRef.current) {
      setaRef.current.style.display = r == null ? "none" : "block";
      if (r != null) setaRef.current.style.transform = `rotate(${r}deg)`;
      setaRef.current.setAttribute("data-mk-rumo", r == null ? "" : String(r));
    }
    marcadorRef.current.setLngLat([p.lng, p.lat]);
    if (!marcadorRef.current._map) marcadorRef.current.addTo(map);
  };
  const desenharRef = useRef(desenhar);
  desenharRef.current = desenhar;

  useEffect(() => {
    if (mapReady) desenharRef.current();
  }, [mapReady, gps.posicao, rumo]);

  useEffect(() => () => {
    marcadorRef.current?.remove?.();
    marcadorRef.current = null;
  }, []);

  return {
    /** A última posição do GPS (ou null). */
    posicao: gps.posicao,
    /** D-PROD-362: para onde o celular aponta (graus do norte) ou null. */
    rumo,
    /** Refaz o círculo depois que o fundo do mapa troca. */
    reaplicar: () => desenharRef.current(),
    /** Pede a posição agora e centraliza nela (devolve a posição pela promessa de `aoResponder`). */
    localizar: gps.localizar,
  };
}
