import React, { useEffect, useRef, useState } from "react";
import { createEditorMap, maplibregl, setSourceData } from "@/lib/maplibre/lifecycle.js";
import { mensagemFalhaMapa } from "@/lib/maplibre/falhaWebGL";
import { toGeoJsonPolygon } from "@/lib/geografia";

const SOURCE = "importacao-areas";
const FILL = "importacao-areas-fill";
const LINE = "importacao-areas-line";

/**
 * Prévia dos contornos lidos do arquivo (D-PROD-90).
 *
 * Mapa próprio e isolado: não toca no renderer do Mapa Geral nem nas camadas
 * do editor. Uma instância por diálogo, liberada com `map.remove()` ao fechar.
 *
 * @param {{
 *   linhas: { ref: string, nome: string, cor: string, vertices: {lat: number, lng: number}[], selecionada: boolean }[],
 *   foco: string | null,
 *   onFocar: (ref: string) => void,
 * }} props
 */
export default function PreviaImportacaoMapa({ linhas, foco, onFocar }) {
  const containerRef = useRef(null);
  const mapRef = useRef(/** @type {import('maplibre-gl').Map | null} */ (null));
  const linhasRef = useRef(linhas);
  const onFocarRef = useRef(onFocar);
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState(/** @type {string | null} */ (null));

  linhasRef.current = linhas;
  onFocarRef.current = onFocar;

  const colecao = (lista, refFoco) => ({
    type: "FeatureCollection",
    features: lista
      .map((l) => {
        const geometry = toGeoJsonPolygon(l.vertices);
        if (!geometry) return null;
        return {
          type: "Feature",
          geometry,
          properties: { ref: l.ref, cor: l.cor || "#f8f9fa", foco: l.ref === refFoco, selecionada: l.selecionada },
        };
      })
      .filter(Boolean),
  });

  const limites = (lista) => {
    const b = new maplibregl.LngLatBounds();
    let algum = false;
    for (const l of lista) {
      for (const v of l.vertices) {
        b.extend([v.lng, v.lat]);
        algum = true;
      }
    }
    return algum ? b : null;
  };

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let criado;
    try {
      criado = createEditorMap(containerRef.current);
    } catch (e) {
      setErro(mensagemFalhaMapa(e, "Não foi possível abrir a prévia do mapa."));
      return undefined;
    }
    const { map, dispose } = criado;
    mapRef.current = map;
    map.on("error", (ev) => {
      if (/webgl/i.test(String(ev?.error?.message ?? ""))) setErro(mensagemFalhaMapa(ev.error));
    });
    map.on("load", () => {
      map.addSource(SOURCE, { type: "geojson", data: /** @type {any} */ (colecao(linhasRef.current, null)) });
      map.addLayer({
        id: FILL,
        type: "fill",
        source: SOURCE,
        paint: {
          "fill-color": ["get", "cor"],
          "fill-opacity": ["case", ["get", "foco"], 0.55, ["get", "selecionada"], 0.35, 0.12],
        },
      });
      map.addLayer({
        id: LINE,
        type: "line",
        source: SOURCE,
        paint: {
          "line-color": ["case", ["get", "foco"], "#f97316", "#0f172a"],
          "line-width": ["case", ["get", "foco"], 3, 1.5],
        },
      });
      map.on("click", FILL, (ev) => {
        const ref = ev.features?.[0]?.properties?.ref;
        if (ref) onFocarRef.current?.(String(ref));
      });
      const b = limites(linhasRef.current);
      map.resize();
      if (b) map.fitBounds(b, { padding: 32, duration: 0, maxZoom: 17 });
      setPronto(true);
    });
    return () => {
      mapRef.current = null;
      dispose();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!pronto || !map) return;
    setSourceData(map, SOURCE, /** @type {any} */ (colecao(linhas, foco)));
  }, [linhas, foco, pronto]);

  useEffect(() => {
    const map = mapRef.current;
    if (!pronto || !map || !foco) return;
    const linha = linhasRef.current.find((l) => l.ref === foco);
    const b = linha ? limites([linha]) : null;
    if (b) map.fitBounds(b, { padding: 40, duration: 300, maxZoom: 18 });
  }, [foco, pronto]);

  if (erro) {
    return (
      <div className="h-full min-h-[180px] flex items-center justify-center rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
        {erro} A conferência pela tabela continua disponível.
      </div>
    );
  }
  return <div ref={containerRef} data-testid="previa-importacao-mapa" className="h-full min-h-[180px] w-full rounded border border-slate-200" />;
}
