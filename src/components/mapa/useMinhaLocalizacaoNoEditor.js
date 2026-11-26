import { useEffect, useRef } from "react";
import { maplibregl } from "@/lib/maplibre/lifecycle.js";
import { buildAccuracyCircleCollection } from "@/lib/maplibre/gpsCapture.js";
import { useLocalizacaoNoMapa } from "./useLocalizacaoNoMapa";

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
  const marcadorRef = useRef(/** @type {any} */ (null));
  const posicaoRef = useRef(gps.posicao);
  posicaoRef.current = gps.posicao;

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
      el.style.cssText = "width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 2px rgba(37,99,235,.35);pointer-events:none";
      marcadorRef.current = new maplibregl.Marker({ element: el, anchor: "center" });
    }
    marcadorRef.current.setLngLat([p.lng, p.lat]);
    if (!marcadorRef.current._map) marcadorRef.current.addTo(map);
  };
  const desenharRef = useRef(desenhar);
  desenharRef.current = desenhar;

  useEffect(() => {
    if (mapReady) desenharRef.current();
  }, [mapReady, gps.posicao]);

  useEffect(() => () => {
    marcadorRef.current?.remove?.();
    marcadorRef.current = null;
  }, []);

  return {
    /** A última posição do GPS (ou null). */
    posicao: gps.posicao,
    /** Refaz o círculo depois que o fundo do mapa troca. */
    reaplicar: () => desenharRef.current(),
    /** Pede a posição agora e centraliza nela (devolve a posição pela promessa de `aoResponder`). */
    localizar: gps.localizar,
  };
}
