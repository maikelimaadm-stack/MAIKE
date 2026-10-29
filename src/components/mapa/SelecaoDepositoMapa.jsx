import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listarPontosSuplementacaoDaEmpresa, listarPontosDaEmpresa } from "@/services/mapaService";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { X, Check } from "lucide-react";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import { parseVertex } from "@/lib/geografia/coords.js";
import {
  BASEMAP_IDS,
  CENTRO_PADRAO,
  getSatelliteProvider,
  mensagemSateliteNaoConfigurado,
} from "@/lib/maplibre/basemap.js";
import { createEditorMap, maplibregl, setSourceData } from "@/lib/maplibre/lifecycle.js";
import {
  DEPOSITO_CORES,
  DEPOSITO_SOURCE_IDS,
  AREA_TOQUE_MIN_PX,
  ICONE_TAMANHO,
  boundsLngLats,
  buildDepositos,
  buildLinhaCollection,
  distanciaCochoDeposito,
  ensureDepositoLayers,
  estadoDeposito,
  formatDistanciaMetros,
  iconSizePreservingAspect,
  mesmoId,
  resolverDepositoSelecionado,
} from "@/lib/maplibre/selecaoDepositoMapa.js";

const CORES_ESTADO = {
  selecionado: DEPOSITO_CORES.SELECIONADO,
  destaque: DEPOSITO_CORES.DESTAQUE,
  normal: DEPOSITO_CORES.DEPOSITO,
};

/**
 * Pinta o marcador de um depósito conforme estado. Sem ícone (ou ícone quebrado)
 * cai no círculo colorido estável; com ícone, preserva aspecto.
 * @param {{ el: HTMLButtonElement, dot: HTMLSpanElement, img: HTMLImageElement | null, natural: { w: number, h: number } | null, broken: boolean }} entry
 * @param {"selecionado" | "destaque" | "normal"} estado
 */
function pintarMarcador(entry, estado) {
  const ativo = estado !== "normal";
  entry.el.dataset.estado = estado;
  entry.el.setAttribute("aria-pressed", estado === "selecionado" ? "true" : "false");
  entry.el.style.zIndex = ativo ? "2" : "1";
  const usarIcone = entry.img && entry.natural && !entry.broken;
  if (usarIcone) {
    const base = ativo ? ICONE_TAMANHO.DESTAQUE : ICONE_TAMANHO.BASE;
    const { width, height } = iconSizePreservingAspect(entry.natural.w, entry.natural.h, base);
    entry.img.style.display = "block";
    entry.img.style.width = `${width}px`;
    entry.img.style.height = `${height}px`;
    entry.img.style.outline = ativo ? `3px solid ${CORES_ESTADO[estado]}` : "none";
    entry.img.style.borderRadius = "4px";
    entry.dot.style.display = "none";
  } else {
    if (entry.img) entry.img.style.display = "none";
    const size = ativo ? 20 : 16;
    entry.dot.style.display = "block";
    entry.dot.style.width = `${size}px`;
    entry.dot.style.height = `${size}px`;
    entry.dot.style.background = CORES_ESTADO[estado];
  }
}

export default function SelecaoDepositoMapa({ cochoCoords, depositoSelecionadoId, onSelect, onClose }) {
  const empresaSelecionadaId = useEmpresaSelecionadaId();
  const mapRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const mapInstanceRef = useRef(/** @type {import('maplibre-gl').Map | null} */ (null));
  const disposeRef = useRef(/** @type {(() => void) | null} */ (null));
  const markersRef = useRef(/** @type {Map<unknown, any>} */ (new Map()));
  const cochoMarkerRef = useRef(/** @type {import('maplibre-gl').Marker | null} */ (null));
  const didFitRef = useRef(false);
  const mountedRef = useRef(true);
  const onSelectRef = useRef(onSelect);
  const estadoRef = useRef({ selecionadoId: /** @type {unknown} */ (null), destaqueId: /** @type {unknown} */ (null) });
  // Último id emitido por onSelect: dupla ativação rápida no mesmo depósito não reemite.
  const ultimoEmitidoRef = useRef(/** @type {unknown} */ (depositoSelecionadoId ?? null));

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(/** @type {string | null} */ (null));
  const [mapEpoch, setMapEpoch] = useState(0);
  const [hoveredDepositoId, setHoveredDepositoId] = useState(/** @type {unknown} */ (null));
  const [satNote] = useState(() => {
    const sat = getSatelliteProvider();
    return sat.configured ? null : mensagemSateliteNaoConfigurado();
  });

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    ultimoEmitidoRef.current = depositoSelecionadoId ?? null;
  }, [depositoSelecionadoId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // cochoCoords chega como objeto novo a cada render do caller: derivar chave estável.
  const cocho = parseVertex(cochoCoords);
  const cochoKey = cocho ? `${cocho.lat},${cocho.lng}` : "";
  const cochoEstavel = useMemo(() => cocho, [cochoKey]);

  const suplementacaoQuery = useQuery({
    queryKey: ["pontos-suplementacao-mapa-selecao", empresaSelecionadaId],
    queryFn: async () => {
      const all = await listarPontosSuplementacaoDaEmpresa(empresaSelecionadaId);
      return all.filter((ponto) => ponto.empresa_id === empresaSelecionadaId && ponto.status === "Ativo");
    },
    enabled: !!empresaSelecionadaId,
  });

  const referenciaQuery = useQuery({
    queryKey: ["pontos-referencia-mapa-selecao", empresaSelecionadaId],
    queryFn: async () => {
      const all = await listarPontosDaEmpresa(empresaSelecionadaId);
      return all.filter((ponto) => ponto.empresa_id === empresaSelecionadaId && ponto.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const pontosSuplementacao = suplementacaoQuery.data;
  const pontosReferencia = referenciaQuery.data;
  const depositos = useMemo(
    () => buildDepositos(pontosSuplementacao || [], pontosReferencia || [], empresaSelecionadaId),
    [pontosSuplementacao, pontosReferencia, empresaSelecionadaId]
  );

  // Seleção recebida do formulário só conta se existir na lista da empresa atual.
  const depositoSelecionado = resolverDepositoSelecionado(depositos, depositoSelecionadoId);
  const selecionadoEfetivoId = depositoSelecionado ? depositoSelecionado.id : null;
  const destaqueId = hoveredDepositoId ?? selecionadoEfetivoId;
  const depositoEmDestaque = depositos.find((d) => mesmoId(d.id, destaqueId)) || null;
  const distanciaMetros = depositoEmDestaque
    ? distanciaCochoDeposito(cochoEstavel, depositoEmDestaque.coords)
    : null;

  const carregandoDados = suplementacaoQuery.isLoading || referenciaQuery.isLoading;
  const erroDados = suplementacaoQuery.isError || referenciaQuery.isError;

  // Troca de empresa: refaz fit e limpa hover (dados antigos já saem pela queryKey).
  useEffect(() => {
    didFitRef.current = false;
    setHoveredDepositoId(null);
  }, [empresaSelecionadaId]);

  const clearDepositoMarkers = useCallback(() => {
    markersRef.current.forEach((entry) => {
      entry.dead = true;
      if (entry.img) {
        entry.img.onload = null;
        entry.img.onerror = null;
      }
      entry.cleanup?.();
      try {
        entry.marker.remove();
      } catch {
        /* best-effort */
      }
    });
    markersRef.current.clear();
  }, []);

  const disposeMap = useCallback(() => {
    clearDepositoMarkers();
    try {
      cochoMarkerRef.current?.remove();
    } catch {
      /* best-effort */
    }
    cochoMarkerRef.current = null;
    disposeRef.current?.();
    disposeRef.current = null;
    mapInstanceRef.current = null;
    if (mountedRef.current) setMapReady(false);
  }, [clearDepositoMarkers]);

  // Instância única; recriada só por retry (mapEpoch).
  useEffect(() => {
    let cancelled = false;
    setMapReady(false);
    setMapError(null);
    didFitRef.current = false;

    const boot = () => {
      if (cancelled || !mapRef.current || !mountedRef.current) return;
      let created;
      try {
        created = createEditorMap(mapRef.current, {
          basemapId: BASEMAP_IDS.RUAS,
          center: cochoEstavel || CENTRO_PADRAO,
          zoom: 17,
        });
      } catch (err) {
        if (mountedRef.current) setMapError(err?.message || "Falha ao criar mapa (WebGL?)");
        return;
      }
      const map = created.map;
      mapInstanceRef.current = map;

      const onLoad = () => {
        if (cancelled || created.getCancelled() || !mountedRef.current) return;
        try {
          ensureDepositoLayers(map);
          try {
            map.resize();
          } catch {
            /* ignore */
          }
          setMapReady(true);
        } catch (err) {
          if (mountedRef.current) setMapError(err?.message || "Falha ao preparar camadas");
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

      disposeRef.current = () => {
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
    // cochoEstavel só define o centro inicial; mudança posterior não recria o mapa.
  }, [mapEpoch, disposeMap]);

  // Marcador do cocho.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return undefined;
    if (!cochoEstavel) return undefined;
    const el = document.createElement("div");
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", "Cocho");
    el.style.cssText = `width:20px;height:20px;border-radius:9999px;background:${DEPOSITO_CORES.COCHO};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);`;
    const marker = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([cochoEstavel.lng, cochoEstavel.lat])
      .addTo(map);
    cochoMarkerRef.current = marker;
    return () => {
      try {
        marker.remove();
      } catch {
        /* ignore */
      }
      if (cochoMarkerRef.current === marker) cochoMarkerRef.current = null;
    };
  }, [cochoEstavel, mapReady]);

  // Marcadores de depósito: recriados só quando a lista muda.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return undefined;
    clearDepositoMarkers();

    for (const deposito of depositos) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "maike-deposito-marker";
      el.setAttribute("aria-label", `Selecionar depósito ${deposito.nome_ponto || ""}`.trim());
      el.title = String(deposito.nome_ponto || "");
      el.style.cssText =
        `display:flex;align-items:center;justify-content:center;min-width:${AREA_TOQUE_MIN_PX}px;min-height:${AREA_TOQUE_MIN_PX}px;padding:0;background:transparent;border:0;cursor:pointer;touch-action:manipulation;`;
      const dot = document.createElement("span");
      dot.style.cssText = "display:block;border-radius:9999px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);";
      el.appendChild(dot);

      const entry = { id: deposito.id, el, dot, img: null, natural: null, broken: false, dead: false, marker: null, cleanup: null };

      if (deposito.icone_url) {
        const img = document.createElement("img");
        img.alt = "";
        img.draggable = false;
        img.style.display = "none";
        img.style.objectFit = "contain";
        img.onload = () => {
          if (entry.dead) return;
          entry.natural = { w: img.naturalWidth, h: img.naturalHeight };
          const s = estadoRef.current;
          pintarMarcador(entry, estadoDeposito(entry.id, s.selecionadoId, s.destaqueId));
        };
        img.onerror = () => {
          if (entry.dead) return;
          entry.broken = true;
          const s = estadoRef.current;
          pintarMarcador(entry, estadoDeposito(entry.id, s.selecionadoId, s.destaqueId));
        };
        img.src = deposito.icone_url;
        el.appendChild(img);
        entry.img = img;
      }

      const onClick = (ev) => {
        ev.stopPropagation();
        setHoveredDepositoId(deposito.id);
        if (mesmoId(ultimoEmitidoRef.current, deposito.id)) return;
        ultimoEmitidoRef.current = deposito.id;
        onSelectRef.current?.(deposito.id);
      };
      const onEnter = () => setHoveredDepositoId(deposito.id);
      const onLeave = () => setHoveredDepositoId((prev) => (prev === deposito.id ? null : prev));
      el.addEventListener("click", onClick);
      el.addEventListener("mouseenter", onEnter);
      el.addEventListener("mouseleave", onLeave);
      el.addEventListener("focus", onEnter);
      el.addEventListener("blur", onLeave);
      entry.cleanup = () => {
        el.removeEventListener("click", onClick);
        el.removeEventListener("mouseenter", onEnter);
        el.removeEventListener("mouseleave", onLeave);
        el.removeEventListener("focus", onEnter);
        el.removeEventListener("blur", onLeave);
      };

      const s = estadoRef.current;
      pintarMarcador(entry, estadoDeposito(entry.id, s.selecionadoId, s.destaqueId));
      entry.marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([deposito.coords.lng, deposito.coords.lat])
        .addTo(map);
      markersRef.current.set(deposito.id, entry);
    }

    return () => clearDepositoMarkers();
  }, [depositos, mapReady, clearDepositoMarkers]);

  // Restyle sem recriar marcadores.
  useEffect(() => {
    estadoRef.current = { selecionadoId: selecionadoEfetivoId, destaqueId: hoveredDepositoId };
    markersRef.current.forEach((entry) => {
      pintarMarcador(entry, estadoDeposito(entry.id, selecionadoEfetivoId, hoveredDepositoId));
    });
  }, [selecionadoEfetivoId, hoveredDepositoId, depositos, mapReady]);

  // Linha cocho → depósito em destaque.
  const linhaDestinoCoords = depositoEmDestaque?.coords || null;
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    setSourceData(map, DEPOSITO_SOURCE_IDS.LINHA, buildLinhaCollection(cochoEstavel, linhaDestinoCoords));
  }, [cochoEstavel, linhaDestinoCoords, mapReady]);

  // fitBounds uma vez por empresa/instância, quando há dados.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady || didFitRef.current) return;
    if (carregandoDados) return;
    const pts = boundsLngLats(cochoEstavel, depositos);
    if (pts.length === 0) return;
    didFitRef.current = true;
    try {
      if (pts.length === 1) {
        map.jumpTo({ center: pts[0], zoom: 18 });
      } else {
        const bounds = pts.reduce((b, ll) => b.extend(ll), new maplibregl.LngLatBounds(pts[0], pts[0]));
        map.fitBounds(bounds, { padding: 60, maxZoom: 19, duration: 0 });
      }
    } catch {
      /* ignore */
    }
  }, [cochoEstavel, depositos, mapReady, carregandoDados]);

  const retryMap = () => {
    disposeMap();
    setMapError(null);
    setMapEpoch((n) => n + 1);
  };

  const retryDados = () => {
    if (suplementacaoQuery.isError) suplementacaoQuery.refetch();
    if (referenciaQuery.isError) referenciaQuery.refetch();
  };

  return (
    <div className="fixed inset-0 z-50 bg-white">
      <div className="relative h-full w-full">
        <div ref={mapRef} data-testid="deposito-map" className="absolute inset-0 bg-slate-200 touch-manipulation" />

        {!mapReady && !mapError && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 pointer-events-none">
            <span className="text-sm font-semibold text-slate-700">Carregando mapa…</span>
          </div>
        )}

        {mapError && (
          <div role="alert" className="absolute inset-x-4 top-1/3 z-30 mx-auto max-w-md space-y-2 rounded-lg bg-white p-4 shadow-lg">
            <p className="text-sm font-semibold text-slate-900">Mapa indisponível</p>
            <p className="text-xs text-slate-600">{mapError}</p>
            <Button type="button" onClick={retryMap} className="h-9 w-full bg-emerald-600 hover:bg-emerald-700">
              Tentar novamente
            </Button>
          </div>
        )}

        <Button
          onClick={onClose}
          variant="secondary"
          size="icon"
          aria-label="Fechar seleção de depósito"
          className="absolute left-4 z-20 h-12 w-12 rounded-full bg-white/90 shadow-lg backdrop-blur-sm hover:bg-white"
          style={{ top: "max(1rem, env(safe-area-inset-top))" }}
        >
          <X className="h-6 w-6 text-slate-700" />
        </Button>

        <div
          className="absolute right-4 z-20 w-[min(280px,calc(100vw-6rem))] max-h-[50vh] space-y-2 overflow-y-auto rounded-xl border bg-white/95 p-3 shadow-xl backdrop-blur-sm"
          style={{ top: "max(1rem, env(safe-area-inset-top))" }}
        >
          <div>
            <p className="text-xs font-bold uppercase text-slate-900">Selecionar depósito no mapa</p>
            <p className="text-[11px] text-slate-600">Toque em um depósito para vincular ao cocho.</p>
          </div>

          <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
            <div className="flex items-center gap-2 text-slate-700"><span className="h-2 w-2 rounded-full bg-emerald-600" /> Cocho</div>
            <div className="flex items-center gap-2 text-slate-700"><span className="h-2 w-2 rounded-full bg-red-600" /> Depósitos</div>
            <div className="flex items-center gap-2 text-slate-700"><span className="h-2 w-2 rounded-full bg-blue-600" /> Selecionado</div>
          </div>

          {!cochoEstavel && (
            <p className="text-[11px] text-amber-800">Cocho sem coordenada válida — distância indisponível.</p>
          )}

          {carregandoDados && <p className="text-[11px] text-slate-600">Carregando depósitos…</p>}

          {erroDados && (
            <div role="alert" className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">
              <p>Falha ao carregar depósitos.</p>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={retryDados}>
                Tentar novamente
              </Button>
            </div>
          )}

          {!carregandoDados && !erroDados && depositos.length === 0 && (
            <p className="text-[11px] text-slate-600">Nenhum depósito ativo com coordenadas nesta empresa.</p>
          )}

          {depositoSelecionadoId != null && depositoSelecionadoId !== "" && !depositoSelecionado && !carregandoDados && !erroDados && (
            <p data-testid="deposito-obsoleto" className="text-[11px] text-amber-800">
              O depósito vinculado não está disponível nesta empresa. Selecione um depósito no mapa.
            </p>
          )}

          {depositoEmDestaque && (
            <div data-testid="deposito-destaque" className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs">
              <div className="font-semibold text-amber-900">{depositoEmDestaque.nome_ponto}</div>
              {distanciaMetros !== null && (
                <div className="text-amber-800">Distância: {formatDistanciaMetros(distanciaMetros)}</div>
              )}
            </div>
          )}

          {satNote ? <p className="text-[10px] text-slate-500">{satNote}</p> : null}
        </div>

        <div
          className="absolute left-1/2 z-20 -translate-x-1/2 rounded-full border bg-white/95 px-3 py-2 shadow-xl backdrop-blur-sm"
          style={{ bottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Cancelar</Button>
            <Button
              type="button"
              size="sm"
              className="h-8 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
              disabled={!depositoSelecionado || carregandoDados || erroDados}
              onClick={onClose}
            >
              <Check className="mr-1.5 h-3.5 w-3.5" /> Confirmado
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
