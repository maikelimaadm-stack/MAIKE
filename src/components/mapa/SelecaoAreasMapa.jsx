import React, { useCallback, useEffect, useRef, useState } from "react";
import { listarAreasAtivas, atualizarArea } from "@/services/mapaService";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { X, CheckSquare, Palette, Layers, Flag } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import {
  BASEMAP_IDS,
  CENTRO_PADRAO,
  getSatelliteProvider,
  mensagemSateliteNaoConfigurado,
} from "@/lib/maplibre/basemap.js";
import { createEditorMap, maplibregl, setSourceData } from "@/lib/maplibre/lifecycle.js";
import {
  SELECAO_LAYER_IDS,
  SELECAO_SOURCE_IDS,
  buildColorBatchPayload,
  buildSelecaoAreasCollection,
  ensureSelecaoAreasLayers,
  planRenumeracao,
  summarizeBatchResults,
  syncSelectedIds,
} from "@/lib/maplibre/selecaoAreasMapa.js";

const CORES_DISPONIVEIS = [
  { nome: "Branco", cor: "#f8f9fa" },
  { nome: "Cinza claro", cor: "#d8dee2" },
  { nome: "Preto", cor: "#2c303e" },
  { nome: "Azul escuro", cor: "#0d67ad" },
  { nome: "Azul celeste", cor: "#61aad9" },
  { nome: "Amarelo", cor: "#efcb19" },
  { nome: "Verde claro", cor: "#92ca25" },
  { nome: "Laranja", cor: "#f5a01b" },
  { nome: "Roxo", cor: "#966fe1" },
];

const TIPOS_USO = ["Pastagem", "Agricultura", "Reserva", "APP", "Infraestrutura"];
const APROVEITAMENTO = ["Alta", "Média", "Baixa"];
const TIPOS_CULTURAS = [
  "Brachiaria", "Mombaça", "Tanzânia", "Tifton", "Piatã", "Marandu", "Panicum", "Elefante",
  "Milho", "Soja", "Sorgo", "Arroz", "Trigo", "Cevada", "Cana-de-açúcar", "Algodão",
  "Feijão", "Girassol", "Aveia", "Café", "Eucalipto", "Floresta", "Outros",
];

/**
 * Seleção / lote de áreas — MapLibre M2-B2.
 *
 * API pública (congelada):
 * `<SelecaoAreasMapa onClose selectedIds={[]} selectionMode={false} onConfirmSelection={null} />`
 *
 * @param {{
 *   onClose?: () => void,
 *   selectedIds?: Array<string|number>,
 *   selectionMode?: boolean,
 *   onConfirmSelection?: ((ids: string[]) => void) | null,
 * }} props
 */
export default function SelecaoAreasMapa({
  onClose,
  selectedIds = [],
  selectionMode = false,
  onConfirmSelection = null,
}) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const disposeRef = useRef(null);
  const labelMarkersRef = useRef([]);
  const selecionadosRef = useRef(new Set());
  const userTouchedRef = useRef(false);
  const didFitBoundsRef = useRef(false);
  const confirmedRef = useRef(false);
  const areasRef = useRef(/** @type {object[]} */ ([]));
  const mountedRef = useRef(true);

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(/** @type {string | null} */ (null));
  const [mapEpoch, setMapEpoch] = useState(0);
  const [selectionTick, setSelectionTick] = useState(0);
  const [batchType, setBatchType] = useState(/** @type {string | null} */ (null));
  const [batchValue, setBatchValue] = useState("");
  const [startNumber, setStartNumber] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [satNote] = useState(() => {
    const sat = getSatelliteProvider();
    return sat.configured ? null : mensagemSateliteNaoConfigurado();
  });

  const queryClient = useQueryClient();
  const empresaId = useEmpresaSelecionadaId();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Preselect: sincroniza props sem resetar toggles da sessão
  useEffect(() => {
    const { next, changed } = syncSelectedIds(selecionadosRef.current, selectedIds, {
      userTouched: userTouchedRef.current,
    });
    selecionadosRef.current = next;
    if (changed) setSelectionTick((n) => n + 1);
  }, [selectedIds]);

  const { data: areas = [] } = useQuery({
    queryKey: ["areas", empresaId],
    queryFn: async () => listarAreasAtivas(empresaId),
    enabled: !!empresaId,
  });

  useEffect(() => {
    areasRef.current = areas;
  }, [areas]);

  const clearLabels = useCallback(() => {
    labelMarkersRef.current.forEach((m) => {
      try {
        m.remove();
      } catch {
        /* best-effort */
      }
    });
    labelMarkersRef.current = [];
  }, []);

  const applyFeatureStates = useCallback((map) => {
    if (!map) return;
    for (const area of areasRef.current || []) {
      if (area?.id == null) continue;
      const id = String(area.id);
      try {
        map.setFeatureState(
          { source: SELECAO_SOURCE_IDS.AREAS, id },
          { selected: selecionadosRef.current.has(id) }
        );
      } catch {
        /* ignore missing feature */
      }
    }
  }, []);

  const disposeMap = useCallback(() => {
    clearLabels();
    disposeRef.current?.();
    disposeRef.current = null;
    mapInstanceRef.current = null;
    if (mountedRef.current) setMapReady(false);
  }, [clearLabels]);

  // Mapa MapLibre — uma instância; dispose no unmount / retry
  useEffect(() => {
    let cancelled = false;
    setMapReady(false);
    setMapError(null);
    didFitBoundsRef.current = false;

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
      const map = created.map;

      const onLoad = () => {
        if (cancelled || created.getCancelled() || !mountedRef.current) return;
        try {
          ensureSelecaoAreasLayers(map);
          try {
            map.resize();
          } catch {
            /* ignore */
          }
          setMapReady(true);
        } catch (err) {
          if (mountedRef.current) {
            setMapError(err?.message || "Falha ao preparar camadas");
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

      const resizeTimers = [40, 200, 450].map((ms) =>
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

    const t = window.setTimeout(boot, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      disposeMap();
    };
  }, [mapEpoch, disposeMap]);

  // Clique: toggle seleção (sem double-fire — um handler)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return undefined;

    const onClick = (e) => {
      const feats = map.queryRenderedFeatures(e.point, {
        layers: [SELECAO_LAYER_IDS.AREAS_FILL],
      });
      const rawId = feats[0]?.properties?.id ?? feats[0]?.id;
      if (rawId == null) return;
      const id = String(rawId);
      userTouchedRef.current = true;
      const set = selecionadosRef.current;
      if (set.has(id)) set.delete(id);
      else set.add(id);
      try {
        map.setFeatureState(
          { source: SELECAO_SOURCE_IDS.AREAS, id },
          { selected: set.has(id) }
        );
      } catch {
        /* ignore */
      }
      setSelectionTick((n) => n + 1);
    };

    map.on("click", onClick);
    map.getCanvas().style.cursor = "pointer";
    return () => {
      map.off("click", onClick);
      try {
        map.getCanvas().style.cursor = "";
      } catch {
        /* ignore */
      }
    };
  }, [mapReady]);

  // Redesenho GeoJSON + labels; fitBounds só na 1ª vez
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;

    const fc = buildSelecaoAreasCollection(areas);
    setSourceData(map, SELECAO_SOURCE_IDS.AREAS, fc);

    // feature-state após setData (próximo frame)
    window.requestAnimationFrame(() => applyFeatureStates(map));

    clearLabels();
    for (const f of fc.features) {
      const lat = f.properties?.labelLat;
      const lng = f.properties?.labelLng;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      const el = document.createElement("div");
      el.className =
        "pointer-events-none whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.02em] text-white";
      el.style.textShadow = "0 1px 3px rgba(0,0,0,0.95)";
      el.textContent = String(f.properties?.nome || "ÁREA");
      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([lng, lat])
        .addTo(map);
      labelMarkersRef.current.push(marker);
    }

    if (!didFitBoundsRef.current && fc.features.length > 0) {
      /** @type {[number, number][]} */
      const lngLats = [];
      for (const f of fc.features) {
        const ring = f.geometry?.type === "Polygon" ? f.geometry.coordinates?.[0] : null;
        if (!Array.isArray(ring)) continue;
        for (const pair of ring) {
          if (Array.isArray(pair) && pair.length >= 2) lngLats.push([pair[0], pair[1]]);
        }
      }
      if (lngLats.length > 0) {
        const bounds = lngLats.reduce(
          (b, ll) => b.extend(ll),
          new maplibregl.LngLatBounds(lngLats[0], lngLats[0])
        );
        try {
          map.fitBounds(bounds, { padding: 50, maxZoom: 17, duration: 0 });
          didFitBoundsRef.current = true;
        } catch {
          map.jumpTo({ center: lngLats[0], zoom: 14 });
          didFitBoundsRef.current = true;
        }
      }
    }

    try {
      map.resize();
    } catch {
      /* ignore */
    }
  }, [areas, mapReady, clearLabels, applyFeatureStates]);

  // Reaplica selected state quando tick muda (toggle) sem refit
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    applyFeatureStates(map);
  }, [selectionTick, mapReady, applyFeatureStates]);

  const invalidateAreas = () => {
    queryClient.invalidateQueries({
      predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "areas",
    });
  };

  const aplicarLote = async () => {
    if (batchBusy) return;
    const ids = Array.from(selecionadosRef.current);
    if (ids.length === 0) {
      toast.error("Selecione áreas no mapa");
      return;
    }

    setBatchBusy(true);
    try {
      /** @type {Promise<unknown>[]} */
      const jobs = [];

      if (batchType === "aproveitamento") {
        for (const id of ids) {
          jobs.push(atualizarArea(id, { aproveitamento_classificacao: batchValue }));
        }
      } else if (batchType === "uso") {
        for (const id of ids) {
          jobs.push(atualizarArea(id, { tipo_cultura: batchValue }));
        }
      } else if (batchType === "cultura") {
        for (const id of ids) {
          jobs.push(atualizarArea(id, { tipo_pastagem: batchValue }));
        }
      } else if (batchType === "cor") {
        if (!batchValue) {
          toast.error("Selecione uma cor");
          return;
        }
        for (const id of ids) {
          const area = areasRef.current.find((a) => String(a.id) === String(id));
          if (!area) {
            jobs.push(Promise.reject(new Error(`Área ${id} não encontrada`)));
            continue;
          }
          jobs.push(atualizarArea(id, buildColorBatchPayload(area, batchValue)));
        }
      } else {
        return;
      }

      const results = await Promise.allSettled(jobs);
      const summary = summarizeBatchResults(results);

      if (summary.allOk) {
        toast.success(`Atualizado (${summary.ok})`);
        setBatchType(null);
        setBatchValue("");
        selecionadosRef.current.clear();
        userTouchedRef.current = false;
        setSelectionTick((n) => n + 1);
        invalidateAreas();
      } else if (summary.partial) {
        toast.error(
          `Atualização parcial: ${summary.ok} ok, ${summary.fail} falharam. Seleção preservada.`
        );
        invalidateAreas();
      } else {
        toast.error("Falha ao aplicar alterações");
      }
    } catch {
      toast.error("Falha ao aplicar alterações");
    } finally {
      setBatchBusy(false);
    }
  };

  const aplicarRenumeracao = async () => {
    if (batchBusy) return;
    const ids = Array.from(selecionadosRef.current);
    const start = Number.parseInt(startNumber || "1", 10);
    const planned = planRenumeracao(areasRef.current, ids, start);
    if (!planned.ok) {
      toast.error(planned.reason);
      return;
    }

    setBatchBusy(true);
    try {
      // Fail-fast sequencial — não finge sucesso total
      for (const step of planned.plan) {
        await atualizarArea(step.id, { numero_area: step.numero_area });
      }
      toast.success("Códigos reatribuídos");
      setBatchType(null);
      setStartNumber("");
      selecionadosRef.current.clear();
      userTouchedRef.current = false;
      setSelectionTick((n) => n + 1);
      invalidateAreas();
    } catch {
      toast.error("Falha na renumeração. Verifique conflitos e tente de novo. Seleção preservada.");
      invalidateAreas();
    } finally {
      setBatchBusy(false);
    }
  };

  const handleConfirmSelection = () => {
    if (confirmedRef.current) return;
    const ids = Array.from(selecionadosRef.current);
    if (ids.length === 0) {
      toast.error("Selecione áreas no mapa");
      return;
    }
    confirmedRef.current = true;
    onConfirmSelection?.(ids);
  };

  const retryMap = () => {
    disposeMap();
    setMapError(null);
    setMapEpoch((n) => n + 1);
  };

  const selectedCount = selecionadosRef.current.size;

  return (
    <div className="fixed inset-0 z-50 bg-white">
      <div ref={mapRef} className="absolute inset-0 touch-manipulation" />

      {!mapReady && !mapError && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-10 pointer-events-none">
          <span className="text-sm font-semibold text-slate-700">Carregando mapa…</span>
        </div>
      )}

      {mapError && (
        <div className="absolute inset-x-4 top-1/3 z-30 bg-white rounded-lg shadow-lg p-4 space-y-2 max-w-md mx-auto">
          <p className="text-sm font-semibold text-slate-900">Mapa indisponível</p>
          <p className="text-xs text-slate-600">{mapError}</p>
          {satNote ? <p className="text-[11px] text-slate-500">{satNote}</p> : null}
          <Button type="button" onClick={retryMap} className="w-full h-9 bg-emerald-600 hover:bg-emerald-700">
            Tentar novamente
          </Button>
        </div>
      )}

      <Button
        onClick={onClose}
        variant="secondary"
        size="icon"
        aria-label="Fechar"
        className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 text-secondary-foreground absolute top-1 left-1 z-20 h-7 w-7 rounded-full bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white"
      >
        <X className="w-5 h-5 text-slate-700" />
      </Button>

      {selectionMode ? (
        <div className="absolute top-4 right-4 z-20 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-700 shadow-sm max-w-[min(90vw,18rem)]">
          Clique nas áreas do mapa para vincular ao cocho
          {selectedCount > 0 ? ` · ${selectedCount} selecionada(s)` : ""}
          {satNote ? (
            <div className="mt-1 text-[10px] text-slate-500">
              Basemap: ruas (OpenFreeMap). Legado usava satélite.
            </div>
          ) : null}
        </div>
      ) : (
        <div className="absolute top-4 right-4 z-20 flex flex-col items-end gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs bg-white/90">
                <Layers className="w-3.5 h-3.5 mr-2" /> Ações em Lote
                {selectedCount > 0 ? ` (${selectedCount})` : ""}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setBatchType("aproveitamento");
                  setBatchValue("Alta");
                }}
                className="text-xs"
              >
                <CheckSquare className="w-3.5 h-3.5 mr-2" /> Definir Aproveitamento
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setBatchType("uso");
                  setBatchValue("Pastagem");
                }}
                className="text-xs"
              >
                <Flag className="w-3.5 h-3.5 mr-2" /> Definir Tipo de Uso
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setBatchType("cultura");
                  setBatchValue("Brachiaria");
                }}
                className="text-xs"
              >
                <Flag className="w-3.5 h-3.5 mr-2" /> Definir Tipo de Cultura
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setBatchType("cor");
                  setBatchValue(CORES_DISPONIVEIS[4].cor);
                }}
                className="text-xs"
              >
                <Palette className="w-3.5 h-3.5 mr-2" /> Definir Cor
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setBatchType("renumerar");
                  setStartNumber("1");
                }}
                className="text-xs"
              >
                <Layers className="w-3.5 h-3.5 mr-2" /> Reatribuir Códigos
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {satNote ? (
            <div className="rounded bg-white/90 px-2 py-1 text-[10px] text-slate-500 shadow max-w-[14rem] text-right">
              Ruas (OpenFreeMap). {satNote}
            </div>
          ) : null}
        </div>
      )}

      {selectionMode && (
        <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs bg-white/95" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
            onClick={handleConfirmSelection}
          >
            Usar áreas selecionadas
          </Button>
        </div>
      )}

      <Dialog
        open={!selectionMode && !!batchType}
        onOpenChange={(open) => {
          if (!open) {
            setBatchType(null);
            setBatchValue("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {batchType === "aproveitamento" && "Definir Aproveitamento"}
              {batchType === "uso" && "Definir Tipo de Uso"}
              {batchType === "cultura" && "Definir Tipo de Cultura"}
              {batchType === "cor" && "Definir Cor no Mapa"}
              {batchType === "renumerar" && "Reatribuir Códigos"}
            </DialogTitle>
          </DialogHeader>
          {batchType === "aproveitamento" && (
            <div className="space-y-2">
              <Label className="text-xs">Aproveitamento</Label>
              <Select value={batchValue} onValueChange={setBatchValue}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {APROVEITAMENTO.map((v) => (
                    <SelectItem key={v} value={v} className="text-xs">
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBatchType(null)}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                  onClick={aplicarLote}
                  disabled={batchBusy}
                >
                  Aplicar
                </Button>
              </div>
            </div>
          )}
          {batchType === "uso" && (
            <div className="space-y-2">
              <Label className="text-xs">Tipo de Uso</Label>
              <Select value={batchValue} onValueChange={setBatchValue}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_USO.map((v) => (
                    <SelectItem key={v} value={v} className="text-xs">
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBatchType(null)}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                  onClick={aplicarLote}
                  disabled={batchBusy}
                >
                  Aplicar
                </Button>
              </div>
            </div>
          )}
          {batchType === "cultura" && (
            <div className="space-y-2">
              <Label className="text-xs">Tipo de Cultura</Label>
              <Select value={batchValue} onValueChange={setBatchValue}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_CULTURAS.map((v) => (
                    <SelectItem key={v} value={v} className="text-xs">
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBatchType(null)}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                  onClick={aplicarLote}
                  disabled={batchBusy}
                >
                  Aplicar
                </Button>
              </div>
            </div>
          )}
          {batchType === "cor" && (
            <div className="space-y-3">
              <Label className="text-xs">Cor</Label>
              <div className="grid grid-cols-5 gap-2">
                {CORES_DISPONIVEIS.map((c) => (
                  <button
                    key={c.cor}
                    type="button"
                    onClick={() => setBatchValue(c.cor)}
                    className={`h-8 rounded border ${batchValue === c.cor ? "ring-2 ring-emerald-600" : ""}`}
                    style={{ backgroundColor: c.cor }}
                    title={c.nome}
                    aria-label={c.nome}
                  />
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBatchType(null)}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                  onClick={aplicarLote}
                  disabled={!batchValue || batchBusy}
                >
                  Aplicar
                </Button>
              </div>
            </div>
          )}
          {batchType === "renumerar" && (
            <div className="space-y-2">
              <Label className="text-xs">Iniciar numeração a partir de</Label>
              <Input
                value={startNumber}
                onChange={(e) => setStartNumber(e.target.value.replace(/[^0-9]/g, ""))}
                className="h-8 text-xs"
                placeholder="1"
              />
              <p className="text-[11px] text-slate-500">
                As áreas selecionadas serão ordenadas por Nome (A→Z) e receberão códigos sequenciais.
                Conflitos com códigos existentes abortam sem aplicar.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBatchType(null)}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                  onClick={aplicarRenumeracao}
                  disabled={!startNumber || batchBusy}
                >
                  Aplicar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
