import React, { useCallback, useEffect, useRef, useState } from "react";
import { listarTarefasDaEmpresa, listarIconesDaEmpresa } from "@/services/tarefasMapaService";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MapPin } from "lucide-react";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import { formatHectaresPt, isValidLatLng, parseVertices } from "@/lib/geografia";
import {
  BASEMAP_IDS,
  CENTRO_PADRAO,
  getSatelliteProvider,
  mensagemSateliteNaoConfigurado,
} from "@/lib/maplibre/basemap.js";
import { createEditorMap, maplibregl, setSourceData } from "@/lib/maplibre/lifecycle.js";
import {
  PRIORIDADE_CORES,
  TASK_PICKER_LAYER_IDS,
  TASK_PICKER_SOURCE_IDS,
  buildSelectedPointCollection,
  buildTaskPickerAreasCollection,
  ensureTaskPickerLayers,
  findContainingArea,
  normalizarPrioridade,
  parsePickerCoordinate,
  safeCentroid,
} from "@/lib/maplibre/taskLocationPicker.js";

/**
 * Seletor de local da tarefa — MapLibre M2-B1 (sem Maps JS de terceiros).
 *
 * Contrato com FormularioTarefaMapa:
 * - onSelect(coords, area) com coords `{ lat, lng }` e `area` original ou null
 * - Escape / X / clique fora → só onOpenChange(false), sem onSelect
 * - Uma seleção por sessão aberta
 *
 * Basemap: ruas (OpenFreeMap Liberty). O legado usava satélite proprietário por padrão;
 * satélite MapLibre só com VITE_MAP_SATELLITE_STYLE_URL licenciada — sem botão falso.
 *
 * @param {{
 *   open: boolean,
 *   onOpenChange: (open: boolean) => void,
 *   areas?: object[],
 *   initialCoordinates?: { lat?: number, lng?: number } | null,
 *   onSelect?: (coords: { lat: number, lng: number }, area: object | null) => void,
 * }} props
 */
export default function TaskLocationPickerDialog({
  open,
  onOpenChange,
  areas = [],
  initialCoordinates,
  onSelect,
}) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const disposeRef = useRef(null);
  const labelMarkersRef = useRef([]);
  const taskMarkersRef = useRef([]);
  const hoverIdRef = useRef(null);
  const handledRef = useRef(false);
  const mountedRef = useRef(true);

  const areasRef = useRef(areas);
  const onSelectRef = useRef(onSelect);
  const onOpenChangeRef = useRef(onOpenChange);
  const initialCoordsRef = useRef(initialCoordinates);

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(/** @type {string | null} */ (null));
  const [mapEpoch, setMapEpoch] = useState(0);
  const [satNote] = useState(() => {
    const sat = getSatelliteProvider();
    return sat.configured ? null : mensagemSateliteNaoConfigurado();
  });

  useEffect(() => {
    areasRef.current = areas;
  }, [areas]);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);
  useEffect(() => {
    initialCoordsRef.current = initialCoordinates;
  }, [initialCoordinates]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const empresaSelecionadaId = useEmpresaSelecionadaId();

  const { data: tarefasPendentes = [] } = useQuery({
    queryKey: ["tarefas-picker-pendentes", empresaSelecionadaId],
    queryFn: async () => {
      const all = await listarTarefasDaEmpresa(empresaSelecionadaId, { order: "-updated_date" });
      return all.filter((t) => t.status === "Pendente" || t.status === "Em Andamento");
    },
    enabled: !!empresaSelecionadaId && open,
    initialData: [],
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["icones-config-picker", empresaSelecionadaId],
    queryFn: async () => listarIconesDaEmpresa(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId && open,
    initialData: [],
  });

  const clearOverlayMarkers = useCallback(() => {
    labelMarkersRef.current.forEach((m) => {
      try {
        m.remove();
      } catch {
        /* best-effort */
      }
    });
    taskMarkersRef.current.forEach((m) => {
      try {
        m.remove();
      } catch {
        /* best-effort */
      }
    });
    labelMarkersRef.current = [];
    taskMarkersRef.current = [];
  }, []);

  const disposeMap = useCallback(() => {
    clearOverlayMarkers();
    if (hoverIdRef.current != null && mapInstanceRef.current) {
      try {
        mapInstanceRef.current.setFeatureState(
          { source: TASK_PICKER_SOURCE_IDS.AREAS, id: hoverIdRef.current },
          { hover: false }
        );
      } catch {
        /* ignore */
      }
      hoverIdRef.current = null;
    }
    disposeRef.current?.();
    disposeRef.current = null;
    mapInstanceRef.current = null;
    if (mountedRef.current) {
      setMapReady(false);
    }
  }, [clearOverlayMarkers]);

  const emitSelect = useCallback((coords, area) => {
    if (handledRef.current) return;
    if (!coords || !isValidLatLng(coords.lat, coords.lng)) return;
    handledRef.current = true;
    const map = mapInstanceRef.current;
    if (map) {
      setSourceData(map, TASK_PICKER_SOURCE_IDS.SELECTED, buildSelectedPointCollection(coords));
    }
    window.setTimeout(() => {
      onSelectRef.current?.(coords, area ?? null);
      onOpenChangeRef.current?.(false);
    }, 150);
  }, []);

  // Lifecycle: criar mapa ao abrir; dispose ao fechar / unmount / retry epoch
  useEffect(() => {
    if (!open) {
      handledRef.current = false;
      disposeMap();
      setMapError(null);
      return undefined;
    }

    handledRef.current = false;
    let cancelled = false;
    setMapReady(false);
    setMapError(null);

    const boot = () => {
      if (cancelled || !mapRef.current || !mountedRef.current) return;

      let created;
      try {
        created = createEditorMap(mapRef.current, {
          basemapId: BASEMAP_IDS.RUAS,
          center: CENTRO_PADRAO,
          zoom: 14,
        });
      } catch (err) {
        if (mountedRef.current) {
          setMapError(err?.message || "Falha ao criar mapa (WebGL?)");
        }
        return;
      }

      mapInstanceRef.current = created.map;
      disposeRef.current = created.dispose;
      const map = created.map;

      const onLoad = () => {
        if (cancelled || created.getCancelled() || !mountedRef.current) return;
        try {
          ensureTaskPickerLayers(map);
          try {
            map.resize();
          } catch {
            /* ignore */
          }
          setMapReady(true);
        } catch (err) {
          if (mountedRef.current) {
            setMapError(err?.message || "Falha ao preparar camadas do seletor");
          }
        }
      };

      const onError = (e) => {
        if (cancelled || !mountedRef.current) return;
        const msg = e?.error?.message || e?.message || "Erro de estilo/tiles";
        if (/style|tile|fetch|network|xhr|401|403|404/i.test(String(msg))) {
          setMapError("Falha ao carregar o estilo ou tiles do mapa. Tente novamente.");
        }
      };

      map.on("load", onLoad);
      map.on("error", onError);

      // Dialog pode montar o container com tamanho 0 — resize após paint
      const resizeTimers = [50, 200, 400].map((ms) =>
        window.setTimeout(() => {
          if (cancelled || !mapInstanceRef.current) return;
          try {
            mapInstanceRef.current.resize();
          } catch {
            /* ignore */
          }
        }, ms)
      );

      disposeRef.current = () => {
        resizeTimers.forEach((id) => window.clearTimeout(id));
        try {
          map.off("load", onLoad);
          map.off("error", onError);
        } catch {
          /* ignore */
        }
        created.dispose();
      };
    };

    // Aguarda o Dialog renderizar o container
    const t = window.setTimeout(boot, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
      disposeMap();
    };
  }, [open, mapEpoch, disposeMap]);

  // Clique + hover nas áreas (uma vez por mapa ready)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!open || !map || !mapReady) return undefined;

    const setHover = (nextId) => {
      if (hoverIdRef.current === nextId) return;
      if (hoverIdRef.current != null) {
        try {
          map.setFeatureState(
            { source: TASK_PICKER_SOURCE_IDS.AREAS, id: hoverIdRef.current },
            { hover: false }
          );
        } catch {
          /* ignore */
        }
      }
      hoverIdRef.current = nextId;
      if (nextId != null) {
        try {
          map.setFeatureState({ source: TASK_PICKER_SOURCE_IDS.AREAS, id: nextId }, { hover: true });
        } catch {
          /* ignore */
        }
      }
    };

    const onMove = (e) => {
      const feats = map.queryRenderedFeatures(e.point, { layers: [TASK_PICKER_LAYER_IDS.AREAS_FILL] });
      const id = feats[0]?.properties?.id ?? feats[0]?.id ?? null;
      setHover(id != null ? String(id) : null);
      map.getCanvas().style.cursor = id != null ? "pointer" : "";
    };

    const onLeave = () => {
      setHover(null);
      map.getCanvas().style.cursor = "";
    };

    const onClick = (e) => {
      if (handledRef.current) return;
      const { lng, lat } = e.lngLat;
      if (!isValidLatLng(lat, lng)) return;
      const coords = { lat, lng };

      const feats = map.queryRenderedFeatures(e.point, { layers: [TASK_PICKER_LAYER_IDS.AREAS_FILL] });
      if (feats[0]?.properties?.id != null) {
        const id = String(feats[0].properties.id);
        const area = (areasRef.current || []).find((a) => String(a.id) === id) || null;
        emitSelect(coords, area);
        return;
      }

      // Fora de fill renderizado ou miss de hit-test: regra de ordem do array
      const area = findContainingArea(coords, areasRef.current || []);
      emitSelect(coords, area);
    };

    map.on("mousemove", onMove);
    map.on("mouseleave", onLeave);
    map.on("click", onClick);

    return () => {
      map.off("mousemove", onMove);
      map.off("mouseleave", onLeave);
      map.off("click", onClick);
      setHover(null);
      try {
        map.getCanvas().style.cursor = "";
      } catch {
        /* ignore */
      }
    };
  }, [open, mapReady, emitSelect]);

  // Redesenho: áreas, labels, tarefas, marcador inicial — inclui late query
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!open || !map || !mapReady) return;

    setSourceData(map, TASK_PICKER_SOURCE_IDS.AREAS, buildTaskPickerAreasCollection(areas));

    clearOverlayMarkers();

    // Labels seguros (textContent — sem innerHTML)
    for (const area of areas || []) {
      const ring = parseVertices(area?.coordenadas?.coords);
      if (ring.length < 3) continue;
      const center = safeCentroid(ring);
      if (!center) continue;

      const wrap = document.createElement("div");
      wrap.style.cssText =
        "color:#fff;text-align:center;white-space:nowrap;text-shadow:1px 1px 3px rgba(0,0,0,.8);pointer-events:none;font-family:system-ui,sans-serif;";
      const title = document.createElement("div");
      title.style.cssText = "font-size:11px;font-weight:700;";
      title.textContent = area.nome || area.numero_area || "";
      wrap.appendChild(title);

      const hectares = Number(area.area_pastejada ?? area.tamanho_hectares);
      if (Number.isFinite(hectares) && hectares > 0) {
        const ha = document.createElement("div");
        ha.style.cssText = "font-size:10px;font-weight:400;opacity:0.95;";
        ha.textContent = `ha ${formatHectaresPt(hectares)}`;
        wrap.appendChild(ha);
      }

      const marker = new maplibregl.Marker({ element: wrap, anchor: "center" })
        .setLngLat([center.lng, center.lat])
        .addTo(map);
      labelMarkersRef.current.push(marker);
    }

    // Marcadores de tarefas pendentes (ícones da empresa — não catálogo global)
    for (const t of tarefasPendentes || []) {
      let position = null;
      const direct = parsePickerCoordinate(t.coordenadas);
      if (direct) {
        position = direct;
      } else if (t.area_id) {
        const area = (areas || []).find((a) => a.id === t.area_id);
        const ring = parseVertices(area?.coordenadas?.coords);
        if (ring.length >= 3) position = safeCentroid(ring);
      }
      if (!position) continue;

      const cor = PRIORIDADE_CORES[t.prioridade] || "#3b82f6";
      const cfg = (iconesConfig || []).find(
        (ic) =>
          ic.tipo_entidade === "Prioridade Tarefa" &&
          normalizarPrioridade(ic.categoria) === normalizarPrioridade(t.prioridade)
      );

      const el = document.createElement("button");
      el.type = "button";
      el.title = t.titulo || "";
      el.setAttribute("aria-label", t.titulo || "Tarefa");
      el.style.cssText =
        "border:0;background:transparent;padding:0;cursor:default;pointer-events:none;width:28px;height:28px;display:flex;align-items:center;justify-content:center;";

      if (cfg?.icone_url) {
        const img = document.createElement("img");
        img.src = String(cfg.icone_url);
        img.alt = "";
        img.width = 28;
        img.height = 28;
        img.draggable = false;
        img.style.cssText = "width:28px;height:28px;object-fit:contain;display:block;";
        el.appendChild(img);
      } else {
        const pin = document.createElement("div");
        pin.style.cssText = [
          "width:14px",
          "height:14px",
          "border-radius:9999px",
          `background:${cor}`,
          "border:2px solid #fff",
          "box-shadow:0 1px 3px rgba(0,0,0,.35)",
        ].join(";");
        el.appendChild(pin);
      }

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([position.lng, position.lat])
        .addTo(map);
      taskMarkersRef.current.push(marker);
    }

    const initial = parsePickerCoordinate(initialCoordsRef.current);
    if (initial) {
      setSourceData(map, TASK_PICKER_SOURCE_IDS.SELECTED, buildSelectedPointCollection(initial));
      map.jumpTo({ center: [initial.lng, initial.lat], zoom: 17 });
    } else {
      setSourceData(map, TASK_PICKER_SOURCE_IDS.SELECTED, buildSelectedPointCollection(null));
      /** @type {[number, number][]} */
      const lngLats = [];
      for (const area of areas || []) {
        for (const v of parseVertices(area?.coordenadas?.coords)) {
          lngLats.push([v.lng, v.lat]);
        }
      }
      if (lngLats.length > 0) {
        const bounds = lngLats.reduce(
          (b, ll) => b.extend(ll),
          new maplibregl.LngLatBounds(lngLats[0], lngLats[0])
        );
        try {
          map.fitBounds(bounds, { padding: 40, maxZoom: 17, duration: 0 });
        } catch {
          map.jumpTo({ center: lngLats[0], zoom: 14 });
        }
      } else {
        map.jumpTo({ center: [CENTRO_PADRAO.lng, CENTRO_PADRAO.lat], zoom: 14 });
      }
    }

    try {
      map.resize();
    } catch {
      /* ignore */
    }
  }, [open, mapReady, areas, tarefasPendentes, iconesConfig, clearOverlayMarkers]);

  const retryMap = () => {
    disposeMap();
    setMapError(null);
    setMapEpoch((n) => n + 1);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] md:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Selecionar local da tarefa</DialogTitle>
          <DialogDescription className="sr-only">Selecione o local no mapa</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span>
              Clique no ponto desejado no mapa para marcar e voltar ao formulário.
              {satNote
                ? ` Basemap: ruas (OpenFreeMap). ${satNote} — o seletor legado usava satélite proprietário.`
                : " Basemap: ruas (OpenFreeMap)."}
            </span>
          </div>
          <div className="relative">
            <div
              ref={mapRef}
              className="h-[55vh] min-h-[240px] w-full rounded-lg border border-slate-200 touch-manipulation"
            />
            {open && !mapReady && !mapError && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/70 rounded-lg">
                <span className="text-sm font-semibold text-slate-700">Carregando mapa…</span>
              </div>
            )}
            {mapError && (
              <div className="absolute inset-x-3 top-1/3 bg-white rounded-lg shadow-lg p-4 space-y-2 z-10">
                <p className="text-sm font-semibold text-slate-900">Mapa indisponível</p>
                <p className="text-xs text-slate-600">{mapError}</p>
                <Button type="button" onClick={retryMap} className="w-full h-9 bg-emerald-600 hover:bg-emerald-700">
                  Tentar novamente
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
