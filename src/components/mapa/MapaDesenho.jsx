import React, { useState, useRef, useEffect, useCallback } from "react";
import { listarAreasAtivas, listarPontosAtivos, listarLinhasAtivas, listarIconesDaEmpresa } from "@/services/mapaService";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { X, Target } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle } from
"@/components/ui/sheet";
import FormularioArea from "./FormularioArea";
import FormularioPonto from "./FormularioPonto";
import FormularioLinha from "./FormularioLinha";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import {
  parseVertices,
  parseVertex,
  inspectVertices,
  areaHectares,
  comprimentoMetros,
  formatHectaresPt,
  formatDistanciaPt,
  validatePolygonForSave,
  validateLineForSave,
} from "@/lib/geografia";
import { BASEMAP_IDS, CENTRO_PADRAO } from "@/lib/maplibre/basemap.js";
import {
  createEditorMap,
  ensureBusinessLayers,
  setSourceData,
  syncDivisaWidth,
  maplibregl,
} from "@/lib/maplibre/lifecycle.js";
import {
  MODOS,
  cursorDoModo,
  desenhoAlterado,
  modoInicial,
  podeAdicionarVertice,
  podeEditarVertices,
  podeMoverArea,
  removerVertice,
  segmentosDaRegua,
  transladarPontos,
} from "@/lib/maplibre/editorModos.js";
import { acertoEditor, pintarEdicao, pontaGuiaShift, resolverAlvoDesenho, rumoGraus } from "@/lib/maplibre/editorVisual.js";
import CursorEditorOverlay from "./CursorEditorOverlay";
import { pontoRotuloSeguro, textoHectares } from "@/lib/maplibre/mapaGeralRender.js";
import useBasemap from "./useBasemap";
import BasemapAtribuicao from "./BasemapAtribuicao";
import { SOURCE_IDS, LAYER_IDS } from "@/lib/maplibre/estiloAreas.js";
import {
  buildAreasCollection,
  buildLinhasCollection,
  buildPontosCollection,
  buildGuiaCollection,
} from "@/lib/maplibre/geojsonBuilders.js";
import { findNearestSnap, findNearestSnapDetalhado, isNearFirstVertex } from "@/lib/maplibre/snap.js";
import {
  commitDragTransaction,
  resolvePontoIconUrl,
  hitEditLayers,
} from "@/lib/maplibre/editorInteraction.js";

/**
 * Ponto médio exato da aresta i→i+1 (fecho incluso por módulo).
 * @param {{ lat: number, lng: number }[]} pts
 * @param {number} i
 * @param {{ lat: number, lng: number }} reserva usado se o índice não existir
 */
const meioDaAresta = (pts, i, reserva) => {
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  return a && b ? { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 } : { ...reserva };
};

/** @returns {GeoJSON.FeatureCollection} */
const emptyFc = () => /** @type {GeoJSON.FeatureCollection} */ ({ type: "FeatureCollection", features: [] });

export default function MapaDesenho({ tipoDesenho, usarGPS = false, itemEditando, onSalvar, onCancelar }) {
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(null);
  const [mapEpoch, setMapEpoch] = useState(0);
  const [snappingEnabled, setSnappingEnabled] = useState(true);
  const [modo, setModo] = useState(() => /** @type {string} */ (modoInicial({ tipo: tipoDesenho, editando: !!itemEditando })));
  const [verticeSelecionado, setVerticeSelecionado] = useState(/** @type {number | null} */ (null));
  const [reguaAtiva, setReguaAtiva] = useState(false);
  const [confirmarSaida, setConfirmarSaida] = useState(false);

  const [currentPoints, setCurrentPoints] = useState([]);
  const [currentMarker, setCurrentMarker] = useState(null);
  const [drawingClosed, setDrawingClosed] = useState(false);
  const [undoLen, setUndoLen] = useState(0);
  const [redoLen, setRedoLen] = useState(0);

  const [showFormularioArea, setShowFormularioArea] = useState(usarGPS && tipoDesenho === "area");
  const [showFormularioPonto, setShowFormularioPonto] = useState(usarGPS && tipoDesenho === "ponto");
  const [showFormularioLinha, setShowFormularioLinha] = useState(usarGPS && tipoDesenho === "linha");
  /** Cor escolhida no formulário de área (prévia ao vivo antes de salvar, como a referência). */
  const [corPrevia, setCorPrevia] = useState(/** @type {string | null} */ (null));
  // PRÉVIA (D-PROD-67): com o formulário aberto a geometria fica fechada e visível,
  // mas manipuladores/cursor somem e nenhuma interação do editor fica ativa por trás
  // do Sheet. Os pontos continuam em estado; cancelar devolve a edição como estava.
  const emPrevia = (showFormularioArea && tipoDesenho === "area") || (showFormularioLinha && tipoDesenho === "linha");
  const modoInteracao = emPrevia ? MODOS.NAVEGAR : modo;
  // Cadastro de área ainda aberta: só os pontos médios são alvo (inserir/arrastar
  // o novo vértice); vértices, mover e clique-adiciona seguem como antes (D-PROD-68).
  const meiosNoCadastro = modoInteracao === MODOS.DESENHAR && tipoDesenho === "area" && !drawingClosed && !itemEditando;

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const disposeRef = useRef(null);
  const labelsRef = useRef([]);
  const iconMarkersRef = useRef([]);
  const currentPointsRef = useRef([]);
  const currentMarkerRef = useRef(null);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const snappingRef = useRef(snappingEnabled);
  const drawingClosedRef = useRef(drawingClosed);
  const zoomingRef = useRef(false);
  const zoomTimerRef = useRef(null);
  const hasCenteredRef = useRef(false);
  const dragStateRef = useRef(null);
  const areasRef = useRef([]);
  const linhasRef = useRef([]);
  const pontosRef = useRef([]);
  const iconesConfigRef = useRef([]);
  const styleSwapCancelRef = useRef(null);
  const mountedRef = useRef(true);
  const empresaRef = useRef(null);
  const overlayEpochRef = useRef(0);
  const modoRef = useRef(modo);
  const originalPontosRef = useRef(/** @type {{ lat: number, lng: number }[]} */ ([]));
  const reguaMarkersRef = useRef(/** @type {any[]} */ ([]));
  const verticeSelecionadoRef = useRef(verticeSelecionado);
  verticeSelecionadoRef.current = verticeSelecionado;
  const emPreviaRef = useRef(emPrevia);
  emPreviaRef.current = emPrevia;
  const corPreviaRef = useRef(corPrevia);
  corPreviaRef.current = corPrevia;
  /** Overlay do cursor (cruz/ímã/rumo) — atualizado sem re-render. */
  const cursorRef = useRef(/** @type {{ atualizar: Function, limpar: Function } | null} */ (null));

  const syncHistoryUi = useCallback(() => {
    setUndoLen(undoStackRef.current.length);
    setRedoLen(redoStackRef.current.length);
  }, []);

  useEffect(() => {
    currentPointsRef.current = currentPoints;
  }, [currentPoints]);
  useEffect(() => {
    currentMarkerRef.current = currentMarker;
  }, [currentMarker]);
  useEffect(() => {
    snappingRef.current = snappingEnabled;
  }, [snappingEnabled]);
  useEffect(() => {
    drawingClosedRef.current = drawingClosed;
  }, [drawingClosed]);
  useEffect(() => {
    modoRef.current = modo;
    if (modo !== MODOS.EDITAR) setVerticeSelecionado(null);
    labelsRef.current.forEach((m) => {
      m.getElement().style.visibility = modo === MODOS.NAVEGAR ? "" : "hidden";
    });
  }, [modo]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const queryClient = useQueryClient();
  const empresaSelecionadaId = useEmpresaSelecionadaId();

  const { data: areas = [] } = useQuery({
    queryKey: ["areas", empresaSelecionadaId],
    queryFn: async () => listarAreasAtivas(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
  });

  const { data: pontos = [] } = useQuery({
    queryKey: ["pontos", empresaSelecionadaId],
    queryFn: async () => listarPontosAtivos(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
  });

  const { data: linhas = [] } = useQuery({
    queryKey: ["linhas", empresaSelecionadaId],
    queryFn: async () => listarLinhasAtivas(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["configuracao-icones", empresaSelecionadaId],
    queryFn: async () => listarIconesDaEmpresa(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
  });

  useEffect(() => {
    areasRef.current = areas;
  }, [areas]);
  useEffect(() => {
    linhasRef.current = linhas;
  }, [linhas]);
  useEffect(() => {
    pontosRef.current = pontos;
  }, [pontos]);
  useEffect(() => {
    iconesConfigRef.current = iconesConfig;
  }, [iconesConfig]);

  const clearLabels = useCallback(() => {
    labelsRef.current.forEach((m) => {
      try {
        m.remove();
      } catch {
        /* ignore */
      }
    });
    labelsRef.current = [];
    iconMarkersRef.current.forEach((m) => {
      try {
        m.remove();
      } catch {
        /* ignore */
      }
    });
    iconMarkersRef.current = [];
  }, []);

  /**
   * SSOT de rótulos/HTML markers (R6-01): limpa e reconstrói a partir do snapshot atual.
   * Usado no load e após style.swap — nunca clearLabels() sem rebuild.
   * @param {import('maplibre-gl').Map} map
   * @param {{ areas?: unknown[], pontos?: unknown[], iconesConfig?: unknown[], editingId?: string | null, tipoDesenho?: string | null }} [snap]
   * @returns {unknown[]} pontos sem ícone (para layer circle)
   */
  const rebuildOverlayMarkers = useCallback(
    (map, snap = {}) => {
      if (!map) return [];
      clearLabels();
      const areasSnap = snap.areas ?? areasRef.current ?? [];
      const pontosSnap = snap.pontos ?? pontosRef.current ?? [];
      const iconesSnap = snap.iconesConfig ?? iconesConfigRef.current ?? [];
      const editingId = snap.editingId ?? itemEditando?.id ?? null;
      const tipo = snap.tipoDesenho ?? tipoDesenho;
      const pontosSemIcone = [];

      pontosSnap.forEach((ponto) => {
        const v = parseVertex(ponto.coordenadas);
        if (!v) return;
        const url = resolvePontoIconUrl(ponto, iconesSnap);
        if (url) {
          const img = document.createElement("img");
          img.src = url;
          img.alt = ponto.nome || "";
          img.style.width = "44px";
          img.style.height = "auto";
          img.style.maxHeight = "44px";
          img.style.objectFit = "contain";
          img.style.pointerEvents = "none";
          const marker = new maplibregl.Marker({ element: img, anchor: "center" })
            .setLngLat([v.lng, v.lat])
            .addTo(map);
          iconMarkersRef.current.push(marker);
        } else {
          pontosSemIcone.push(ponto);
        }
      });

      areasSnap.forEach((area) => {
        if (editingId && area.id === editingId && tipo === "area") return;
        const ring = parseVertices(area.coordenadas?.coords);
        if (ring.length < 3) return;
        // Mesmo ponto seguro e mesmo texto (nome + ha) do Mapa Geral (R1).
        const pos = pontoRotuloSeguro(ring);
        if (!pos) return;
        const { lat, lng } = pos;
        const el = document.createElement("div");
        el.className =
          "pointer-events-none whitespace-nowrap text-center text-[11px] font-bold uppercase leading-tight tracking-[0.02em] text-white";
        el.style.textShadow = "0 1px 3px rgba(0,0,0,0.95)";
        const nomeEl = document.createElement("div");
        nomeEl.textContent = area.nome || area.numero_area || "ÁREA";
        el.appendChild(nomeEl);
        const ha = textoHectares(area);
        if (ha) {
          const haEl = document.createElement("div");
          haEl.className = "text-[10px] font-normal normal-case";
          haEl.textContent = ha;
          el.appendChild(haEl);
        }
        // Como na referência (`ocultarRotulos={desenhando}`): rótulo não cobre
        // vértices enquanto desenha/edita; volta no NAVEGAR (D-PROD-66).
        el.style.visibility = modoRef.current === MODOS.NAVEGAR ? "" : "hidden";
        const marker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([lng, lat])
          .addTo(map);
        labelsRef.current.push(marker);
      });

      overlayEpochRef.current += 1;
      return pontosSemIcone;
    },
    [clearLabels, itemEditando, tipoDesenho]
  );

  const cancelarDesenho = useCallback(() => {
    const map = mapInstanceRef.current;
    if (map) {
      setSourceData(map, SOURCE_IDS.DESENHO, emptyFc());
      setSourceData(map, SOURCE_IDS.VERTICES, emptyFc());
      setSourceData(map, SOURCE_IDS.MIDPOINTS, emptyFc());
      setSourceData(map, SOURCE_IDS.GUIA, emptyFc());
    }
    undoStackRef.current = [];
    redoStackRef.current = [];
    syncHistoryUi();
    setCurrentPoints([]);
    setCurrentMarker(null);
    setDrawingClosed(false);
  }, [syncHistoryUi]);

  // Troca de empresa: limpa edição e evita misturar layers (R5-08)
  useEffect(() => {
    const prev = empresaRef.current;
    empresaRef.current = empresaSelecionadaId;
    if (!prev || !empresaSelecionadaId || prev === empresaSelecionadaId) return;
    cancelarDesenho();
    hasCenteredRef.current = false;
    clearLabels();
    const map = mapInstanceRef.current;
    if (map) {
      setSourceData(map, SOURCE_IDS.AREAS, emptyFc());
      setSourceData(map, SOURCE_IDS.LINHAS, emptyFc());
      setSourceData(map, SOURCE_IDS.PONTOS, emptyFc());
    }
  }, [empresaSelecionadaId, cancelarDesenho, clearLabels]);

  const rehydrateAllSources = useCallback(
    (map) => {
      // R1: a guarda é "fontes de negócio existem", não isStyleLoaded() (que fica
      // false enquanto tiles carregam e fazia o sync ser pulado sem retry).
      if (!map || !map.getSource(SOURCE_IDS.DESENHO)) return;
      const editingId = itemEditando?.id || null;
      const pts = currentPointsRef.current;
      const marker = currentMarkerRef.current;
      const canEditVerts = drawingClosedRef.current || !!itemEditando;

      setSourceData(
        map,
        SOURCE_IDS.AREAS,
        buildAreasCollection(areasRef.current, {
          hideFillForId: tipoDesenho === "area" ? editingId : null,
        })
      );
      setSourceData(map, SOURCE_IDS.LINHAS, buildLinhasCollection(linhasRef.current));
      const pontosSemIcone = rebuildOverlayMarkers(map, {
        areas: areasRef.current,
        pontos: pontosRef.current,
        iconesConfig: iconesConfigRef.current,
        editingId,
        tipoDesenho,
      });
      setSourceData(map, SOURCE_IDS.PONTOS, buildPontosCollection(pontosSemIcone));
      pintarEdicao(map, {
        pts,
        marker,
        tipo: tipoDesenho,
        fechado: canEditVerts,
        previa: emPreviaRef.current,
        cor: (emPreviaRef.current && corPreviaRef.current) || itemEditando?.coordenadas?.cor || itemEditando?.cor || null,
        arrastando: !!dragStateRef.current?.moved,
        selecionado: verticeSelecionadoRef.current,
      });
      setSourceData(map, SOURCE_IDS.GUIA, emptyFc());
    },
    [itemEditando, tipoDesenho, rebuildOverlayMarkers]
  );

  // Init MapLibre — depende de mapEpoch para retry limpo (R5-06)
  useEffect(() => {
    if (!mapRef.current) return undefined;
    let cancelled = false;
    setMapError(null);
    setMapReady(false);

    let created;
    try {
      created = createEditorMap(mapRef.current, {
        basemapId: BASEMAP_IDS.RUAS,
        center: CENTRO_PADRAO,
        zoom: 17,
      });
    } catch (err) {
      if (mountedRef.current) {
        setMapError(err?.message || "Falha ao criar mapa (WebGL?)");
        toast.error("Erro ao carregar mapa.");
      }
      return undefined;
    }

    mapInstanceRef.current = created.map;
    disposeRef.current = created.dispose;
    const map = created.map;

    const onLoad = () => {
      if (cancelled || created.getCancelled() || !mountedRef.current) return;
      try {
        ensureBusinessLayers(map);
        syncDivisaWidth(map);
        setMapReady(true);
      } catch (err) {
        if (mountedRef.current) {
          setMapError(err?.message || "Falha ao preparar camadas");
          toast.error("Erro ao preparar o mapa.");
        }
      }
    };

    const onError = (e) => {
      if (cancelled || !mountedRef.current) return;
      const msg = e?.error?.message || e?.message || "Erro de estilo/tiles";
      if (/style|tile|fetch|network|xhr/i.test(String(msg))) {
        setMapError("Falha ao carregar o estilo ou tiles do mapa. Verifique a rede e tente novamente.");
      }
    };

    const onZoom = (e) => {
      syncDivisaWidth(map);
      // Só gesto do usuário (pinça/roda) bloqueia toques; zoom programático
      // (fitBounds inicial) não pode engolir o 1º toque de desenho (R1).
      if (!e?.originalEvent) return;
      zoomingRef.current = true;
      if (zoomTimerRef.current) window.clearTimeout(zoomTimerRef.current);
      zoomTimerRef.current = window.setTimeout(() => {
        zoomingRef.current = false;
      }, 400);
    };

    map.on("load", onLoad);
    map.on("error", onError);
    map.on("zoom", onZoom);

    return () => {
      cancelled = true;
      styleSwapCancelRef.current?.cancel?.();
      styleSwapCancelRef.current = null;
      map.off("load", onLoad);
      map.off("error", onError);
      map.off("zoom", onZoom);
      if (zoomTimerRef.current) {
        window.clearTimeout(zoomTimerRef.current);
        zoomTimerRef.current = null;
      }
      clearLabels();
      disposeRef.current?.();
      disposeRef.current = null;
      mapInstanceRef.current = null;
      if (mountedRef.current) setMapReady(false);
    };
  }, [mapEpoch, clearLabels]);

  // Carregar item em edição — bloquear se geometria legada corrompida (R5-08)
  useEffect(() => {
    if (itemEditando && tipoDesenho === "area" && itemEditando.coordenadas?.coords) {
      const inspected = inspectVertices(itemEditando.coordenadas.coords);
      if (!inspected.ok && inspected.invalidCount > 0) {
        toast.error(
          `Geometria da área tem ${inspected.invalidCount} vértice(s) inválido(s). Corrija antes de sobrescrever.`
        );
        setCurrentPoints(inspected.vertices);
        setDrawingClosed(false);
        return undefined;
      }
      const coords = inspected.vertices;
      originalPontosRef.current = coords.map((p) => ({ ...p }));
      setCurrentPoints(coords);
      setDrawingClosed(coords.length >= 3);
      const t = window.setTimeout(() => {
        const map = mapInstanceRef.current;
        if (!map || coords.length === 0) return;
        const bounds = new maplibregl.LngLatBounds();
        coords.forEach((c) => bounds.extend([c.lng, c.lat]));
        map.fitBounds(bounds, { padding: 80, maxZoom: 18 });
      }, 400);
      return () => window.clearTimeout(t);
    }
    if (itemEditando && tipoDesenho === "linha" && itemEditando.coordenadas?.coords) {
      const inspected = inspectVertices(itemEditando.coordenadas.coords);
      if (!inspected.ok && inspected.invalidCount > 0) {
        toast.error(
          `Geometria da linha tem ${inspected.invalidCount} vértice(s) inválido(s). Corrija antes de sobrescrever.`
        );
      }
      const coords = inspected.vertices;
      originalPontosRef.current = coords.map((p) => ({ ...p }));
      setCurrentPoints(coords);
      const t = window.setTimeout(() => {
        const map = mapInstanceRef.current;
        if (!map || coords.length === 0) return;
        const bounds = new maplibregl.LngLatBounds();
        coords.forEach((c) => bounds.extend([c.lng, c.lat]));
        map.fitBounds(bounds, { padding: 80, maxZoom: 18 });
      }, 400);
      return () => window.clearTimeout(t);
    }
    if (itemEditando && tipoDesenho === "ponto" && itemEditando.coordenadas) {
      const v = parseVertex(itemEditando.coordenadas);
      if (v) {
        setCurrentMarker(v);
        const t = window.setTimeout(() => {
          const map = mapInstanceRef.current;
          if (!map) return;
          map.setCenter([v.lng, v.lat]);
          map.setZoom(18);
        }, 400);
        return () => window.clearTimeout(t);
      }
    }
    return undefined;
  }, [itemEditando, tipoDesenho]);

  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady || itemEditando || hasCenteredRef.current) return;
    if (areas.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    let hasValid = false;
    areas.forEach((area) => {
      parseVertices(area.coordenadas?.coords).forEach((c) => {
        bounds.extend([c.lng, c.lat]);
        hasValid = true;
      });
    });
    if (hasValid) {
      mapInstanceRef.current.fitBounds(bounds, { padding: 20, maxZoom: 18 });
      hasCenteredRef.current = true;
    }
  }, [areas, mapReady, itemEditando]);

  // Sync GeoJSON + labels/ícones (SSOT rebuildOverlayMarkers)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    if (!map.getSource(SOURCE_IDS.AREAS)) return;

    const editingId = itemEditando?.id || null;
    setSourceData(
      map,
      SOURCE_IDS.AREAS,
      buildAreasCollection(areas, { hideFillForId: tipoDesenho === "area" ? editingId : null })
    );
    setSourceData(map, SOURCE_IDS.LINHAS, buildLinhasCollection(linhas));
    const pontosSemIcone = rebuildOverlayMarkers(map, {
      areas,
      pontos,
      iconesConfig,
      editingId,
      tipoDesenho,
    });
    setSourceData(map, SOURCE_IDS.PONTOS, buildPontosCollection(pontosSemIcone));
  }, [areas, pontos, linhas, iconesConfig, mapReady, itemEditando, tipoDesenho, rebuildOverlayMarkers]);

  // Sync desenho atual
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady || !tipoDesenho) return;
    // R1 (causa raiz do polígono invisível): antes a guarda era isStyleLoaded().
    // Com tiles ainda carregando o estilo reporta "não carregado", o efeito saía
    // sem gravar DESENHO e só rodava de novo na próxima mudança de pontos —
    // vértices (outro efeito, sem a guarda) apareciam; preenchimento/contorno não.
    if (!map.getSource(SOURCE_IDS.DESENHO)) return;

    // Rascunho aberto: polilinha sem o lado de fecho + preenchimento sutil (D-PROD-66);
    // prévia do formulário: fechada, na cor escolhida, sem manipuladores (D-PROD-67).
    pintarEdicao(map, {
      pts: currentPoints,
      marker: currentMarker,
      tipo: tipoDesenho,
      fechado: drawingClosed || !!itemEditando,
      previa: emPrevia,
      cor: (emPrevia && corPrevia) || itemEditando?.coordenadas?.cor || itemEditando?.cor || null,
      arrastando: !!dragStateRef.current?.moved,
      selecionado: verticeSelecionado,
    });
  }, [currentPoints, currentMarker, tipoDesenho, drawingClosed, itemEditando, mapReady, emPrevia, corPrevia, verticeSelecionado]);

  // Clique para adicionar pontos — R5-01 (sem map.project inválido)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !tipoDesenho || !mapReady || itemEditando) return undefined;
    if (!podeAdicionarVertice(modoInteracao, drawingClosed)) return undefined;

    const MAX_CLICK_DURATION = 400;
    const MAX_CLICK_DISTANCE = 10;
    const canvas = map.getCanvas();
    let downPos = null;
    let downTime = 0;

    const handleAddPoint = (latLng, mods = {}) => {
      if (!latLng) return;
      if (!podeAdicionarVertice(modoRef.current, drawingClosedRef.current)) return;
      if (zoomingRef.current) return;

      // Mesmo alvo do cursor (fechar → trava 45° → ímã): o ponto cai onde a cruz/anel mostrava.
      const r = resolverAlvoDesenho(map, latLng, {
        pontos: currentPointsRef.current,
        tipo: tipoDesenho,
        shift: mods.shift,
        alt: mods.alt,
        imaLigado: snappingRef.current,
        areas: areasRef.current,
        linhas: linhasRef.current,
      });
      if (r.ima?.tipo === "fechar") {
        setDrawingClosed(true);
        setModo(MODOS.EDITAR);
        toast.success("Área fechada! Arraste os pontos, navegue ou clique Salvar.", { duration: 2000 });
        return;
      }

      const { lat, lng } = r.alvo;
      if (r.ima) toast.success("Encaixado!", { duration: 600 });

      if (tipoDesenho === "ponto") {
        setCurrentMarker({ lat, lng });
        setShowFormularioPonto(true);
      } else if (tipoDesenho === "area" || tipoDesenho === "linha") {
        const newPoint = { lat, lng };
        setCurrentPoints((prev) => {
          undoStackRef.current.push(prev.map((p) => ({ ...p })));
          redoStackRef.current = [];
          syncHistoryUi();
          const updated = [...prev, newPoint];
          return updated;
        });
        toast.success("Ponto adicionado", { duration: 800 });
      }
    };

    const onDown = (ev) => {
      if (ev.pointerType === "touch" && ev.isPrimary === false) return;
      downPos = { x: ev.clientX, y: ev.clientY };
      downTime = Date.now();
    };

    const onUp = (ev) => {
      if (!downPos) return;
      if (ev.pointerType === "touch" && ev.isPrimary === false) return;
      const elapsed = Date.now() - downTime;
      const dx = ev.clientX - downPos.x;
      const dy = ev.clientY - downPos.y;
      const dist = Math.hypot(dx, dy);
      downPos = null;
      if (elapsed > MAX_CLICK_DURATION || dist > MAX_CLICK_DISTANCE) return;
      if (zoomingRef.current) return;
      if (dragStateRef.current) return;

      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const ll = map.unproject([x, y]);
      // Fechar tocando o 1º vértice tem prioridade sobre "toque em vértice não cria ponto".
      const fechaNoPrimeiro =
        tipoDesenho === "area" && isNearFirstVertex(map, { lat: ll.lat, lng: ll.lng }, currentPointsRef.current, 20);
      if (!fechaNoPrimeiro && hitEditLayers(map, x, y, [LAYER_IDS.VERTICES, LAYER_IDS.MIDPOINTS])) return;

      handleAddPoint({ lat: ll.lat, lng: ll.lng }, { shift: !!ev.shiftKey, alt: !!ev.altKey });
    };

    canvas.addEventListener("pointerdown", onDown, { passive: true });
    canvas.addEventListener("pointerup", onUp, { passive: true });

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
    };
  }, [tipoDesenho, mapReady, itemEditando, drawingClosed, syncHistoryUi, modoInteracao]);

  // Cursor do DESENHAR (D-PROD-66): elástico sólido, guia Shift adicional, aresta
  // do ímã (layers MapLibre) + cruz/anel/rumo (overlay DOM, sem re-render).
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return undefined;
    if (!(tipoDesenho === "area" || tipoDesenho === "linha") || itemEditando) return undefined;

    const limpar = () => {
      setSourceData(map, SOURCE_IDS.GUIA, emptyFc());
      cursorRef.current?.limpar();
    };
    if (!podeAdicionarVertice(modoInteracao, drawingClosed)) {
      limpar();
      return undefined;
    }

    let movendo = false;
    let ultimoToque = 0;
    // Toque não tem cursor: o mousemove de compatibilidade que segue o tap não
    // pode deixar cruz/anel/elástico "presos" onde o dedo tocou.
    const onPointerDown = (ev) => {
      if (ev.pointerType && ev.pointerType !== "mouse") {
        ultimoToque = Date.now();
        limpar();
      }
    };
    const onMove = (e) => {
      // Pan/zoom em curso: nada de cursor de inserção (como na referência).
      if (movendo || map.isMoving()) return limpar();
      if (Date.now() - ultimoToque < 800) return limpar();
      if (dragStateRef.current) return limpar(); // arrastando um ponto médio
      const pts = currentPointsRef.current;
      const r = resolverAlvoDesenho(map, { lat: e.lngLat.lat, lng: e.lngLat.lng }, {
        pontos: pts,
        tipo: tipoDesenho,
        shift: !!e.originalEvent?.shiftKey,
        alt: !!e.originalEvent?.altKey,
        imaLigado: snappingRef.current,
        areas: areasRef.current,
        linhas: linhasRef.current,
      });
      const curPx = map.project([r.alvo.lng, r.alvo.lat]);
      const cur = { x: curPx.x, y: curPx.y };
      const last = pts[pts.length - 1] || null;
      let shiftAte = null;
      let rumo = null;
      if (r.travado && last) {
        const lastPx = map.project([last.lng, last.lat]);
        const p = pontaGuiaShift(lastPx, cur);
        const ponta = map.unproject([p.x, p.y]);
        shiftAte = { lat: ponta.lat, lng: ponta.lng };
        rumo = rumoGraus(lastPx, cur);
      }
      setSourceData(
        map,
        SOURCE_IDS.GUIA,
        buildGuiaCollection(last, last ? r.alvo : null, { shiftAte, imaAresta: r.ima?.tipo === "aresta" ? r.ima.aresta : null })
      );
      // Sobre um ponto médio a cruz some (referência: hover esconde a cruzinha).
      const sobreMeio = pts.length >= 2 && !!acertoEditor(map, e.point, { camadas: { vertices: null, meios: LAYER_IDS.MIDPOINTS } });
      cursorRef.current?.atualizar({ cur, ima: r.ima, cruz: !sobreMeio, rumo });
    };

    const onMoveStart = () => {
      movendo = true;
      limpar();
    };
    const onMoveEnd = () => {
      movendo = false;
    };
    const canvas = map.getCanvas();
    map.on("mousemove", onMove);
    map.on("movestart", onMoveStart);
    map.on("moveend", onMoveEnd);
    canvas.addEventListener("mouseleave", limpar);
    canvas.addEventListener("pointerdown", onPointerDown, { passive: true });

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      map.off("mousemove", onMove);
      map.off("movestart", onMoveStart);
      map.off("moveend", onMoveEnd);
      canvas.removeEventListener("mouseleave", limpar);
      limpar();
    };
  }, [mapReady, tipoDesenho, itemEditando, snappingEnabled, drawingClosed, modoInteracao]);

  // EDITAR: hover de vértice/meio com área de acerto maior que o círculo (8px mouse).
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady || !(tipoDesenho === "area" || tipoDesenho === "linha")) return undefined;
    if (!podeEditarVertices(modoInteracao, tipoDesenho) && !meiosNoCadastro) return undefined;
    const canvas = map.getCanvas();
    /** @type {{ source: string, id: string } | null} */
    let atual = null;
    const soltar = () => {
      if (atual) {
        try {
          map.removeFeatureState(atual, atual.source === SOURCE_IDS.VERTICES ? "ativo" : "hover");
        } catch {
          /* fonte recriada (troca de estilo) */
        }
      }
      atual = null;
      canvas.style.cursor = "";
    };
    const onMove = (e) => {
      if (dragStateRef.current) return;
      if (map.isMoving()) return soltar();
      const a = acertoEditor(map, e.point, { camadas: { vertices: meiosNoCadastro ? null : LAYER_IDS.VERTICES, meios: LAYER_IDS.MIDPOINTS } });
      const alvo = a ? { source: a.role === "vertex" ? SOURCE_IDS.VERTICES : SOURCE_IDS.MIDPOINTS, id: a.id } : null;
      if (alvo && atual && alvo.source === atual.source && alvo.id === atual.id) return;
      soltar();
      if (!alvo) return;
      atual = alvo;
      map.setFeatureState(alvo, alvo.source === SOURCE_IDS.VERTICES ? { ativo: true } : { hover: true });
      canvas.style.cursor = a.role === "vertex" ? "move" : "copy";
    };
    map.on("mousemove", onMove);
    canvas.addEventListener("mouseleave", soltar);
    return () => {
      map.off("mousemove", onMove);
      canvas.removeEventListener("mouseleave", soltar);
      soltar();
    };
  }, [mapReady, tipoDesenho, modoInteracao, meiosNoCadastro]);

  // Drag vértices/midpoints — pointer + touch (R5-03, R5-04)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady || !tipoDesenho) return undefined;
    if (!podeEditarVertices(modoInteracao, tipoDesenho) && !meiosNoCadastro) return undefined;
    if (tipoDesenho === "ponto" && !currentMarkerRef.current) return undefined;
    const LIMIAR_ARRASTO_PX = 4;

    const canvas = map.getCanvas();

    const limparVisualArrasto = (st) => {
      setSourceData(map, SOURCE_IDS.GUIA, emptyFc());
      cursorRef.current?.limpar();
      if (st?.ativoId) {
        try {
          map.removeFeatureState({ source: SOURCE_IDS.VERTICES, id: st.ativoId }, "ativo");
        } catch {
          /* fonte recriada */
        }
      }
    };

    const endDrag = (lngLat, { cancel = false } = {}) => {
      const st = dragStateRef.current;
      if (!st) return;
      map.dragPan.enable();
      dragStateRef.current = null;
      limparVisualArrasto(st);

      if (cancel) {
        if (tipoDesenho === "ponto") {
          setCurrentMarker(st.beforeMarker || st.before?.[0] || null);
        } else {
          setCurrentPoints(st.before || []);
        }
        return;
      }

      // Toque sem arrasto em vértice = selecionar (para remover), nunca mover.
      if (!st.moved && st.role === "vertex" && tipoDesenho !== "ponto") {
        setCurrentPoints(st.before || []);
        setVerticeSelecionado(st.index);
        return;
      }
      if (!st.moved && tipoDesenho === "ponto") return;

      // Toque/clique no meio sem arrastar: ponto novo exatamente no meio do lado.
      if (st.role === "midpoint" && (tipoDesenho === "area" || tipoDesenho === "linha")) {
        const insertAfter = st.index;
        const before = st.before || [];
        const after = [...before];
        after.splice(insertAfter + 1, 0, { ...st.meio });
        const tx = commitDragTransaction({
          undo: undoStackRef.current,
          redo: redoStackRef.current,
          before,
          after,
        });
        undoStackRef.current = tx.undo;
        redoStackRef.current = tx.redo;
        syncHistoryUi();
        setCurrentPoints(after);
        if (tx.committed) toast.success("Novo ponto inserido", { duration: 800 });
        return;
      }

      let target = lngLat ? { lat: lngLat.lat, lng: lngLat.lng } : null;
      if (target) {
        const snapped = findNearestSnap(map, target, {
          areas: areasRef.current,
          linhas: linhasRef.current,
          enabled: snappingRef.current && !st.alt,
        });
        if (snapped) {
          target = snapped;
          toast.success("Encaixado!", { duration: 600 });
        }
      }

      if (tipoDesenho === "ponto" && target) {
        const before = st.beforeMarker ? [{ ...st.beforeMarker }] : [];
        const after = [target];
        const tx = commitDragTransaction({
          undo: undoStackRef.current,
          redo: redoStackRef.current,
          before,
          after,
        });
        undoStackRef.current = tx.undo;
        redoStackRef.current = tx.redo;
        syncHistoryUi();
        setCurrentMarker(target);
        return;
      }

      if (st.role === "vertex" && target && tipoDesenho !== "ponto") {
        const before = st.before || [];
        const after = before.map((p) => ({ ...p }));
        if (st.inserido) after.splice(st.index, 0, target);
        else if (after[st.index]) after[st.index] = target;
        const tx = commitDragTransaction({
          undo: undoStackRef.current,
          redo: redoStackRef.current,
          before,
          after,
        });
        undoStackRef.current = tx.undo;
        redoStackRef.current = tx.redo;
        syncHistoryUi();
        setCurrentPoints(after);
        if (tx.committed) toast.success(st.inserido ? "Novo ponto inserido" : `Ponto ${st.index + 1} reposicionado`, { duration: 800 });
      }
    };

    const onPointerDown = (e) => {
      const oe = e.originalEvent;
      if (oe?.touches && oe.touches.length > 1) return; // pinça é do mapa
      // Área de acerto maior que o desenho (mouse 8px, toque 14px) — VIS-04.
      const a = acertoEditor(map, e.point, {
        toque: !!oe?.type?.startsWith("touch"),
        camadas: { vertices: meiosNoCadastro ? null : LAYER_IDS.VERTICES, meios: LAYER_IDS.MIDPOINTS },
      });
      if (!a) return;
      e.preventDefault();
      map.dragPan.disable();
      dragStateRef.current = {
        role: a.role,
        index: a.index,
        // Meio exato da aresta (a geometria renderizada vem quantizada do tile).
        meio: a.role === "midpoint" ? meioDaAresta(currentPointsRef.current, a.index, { lat: a.lat, lng: a.lng }) : null,
        inserido: false,
        ativoId: null,
        before: currentPointsRef.current.map((p) => ({ ...p })),
        beforeMarker: currentMarkerRef.current ? { ...currentMarkerRef.current } : null,
        pointerId: oe?.pointerId,
        downPx: { x: e.point.x, y: e.point.y },
        moved: false,
        alt: !!oe?.altKey,
      };
    };

    const onPointerMove = (e) => {
      const st = dragStateRef.current;
      if (!st) return;
      if (!st.moved) {
        if (Math.hypot(e.point.x - st.downPx.x, e.point.y - st.downPx.y) < LIMIAR_ARRASTO_PX) return;
        st.moved = true;
        // Segurar no meio e arrastar: cria o ponto e passa a arrastá-lo (referência).
        if (st.role === "midpoint" && tipoDesenho !== "ponto") {
          st.role = "vertex";
          st.index += 1;
          st.inserido = true;
        }
        if (st.role === "vertex" && tipoDesenho !== "ponto") {
          st.ativoId = `v-${st.index}`;
          map.setFeatureState({ source: SOURCE_IDS.VERTICES, id: st.ativoId }, { ativo: true });
        }
      }
      st.alt = !!e.originalEvent?.altKey;
      let target = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      const snapped = findNearestSnapDetalhado(map, target, {
        areas: areasRef.current,
        linhas: linhasRef.current,
        enabled: snappingRef.current && !st.alt,
      });
      if (snapped) target = { lat: snapped.lat, lng: snapped.lng };
      // Feedback do ímã também no arrasto: anel + cruz no alvo, aresta destacada.
      const curPx = map.project([target.lng, target.lat]);
      cursorRef.current?.atualizar({ cur: { x: curPx.x, y: curPx.y }, ima: snapped ? { tipo: snapped.tipo } : null, cruz: false });
      setSourceData(map, SOURCE_IDS.GUIA, buildGuiaCollection(null, null, { imaAresta: snapped?.tipo === "aresta" ? snapped.aresta : null }));

      if (tipoDesenho === "ponto") {
        setCurrentMarker(target);
        return;
      }
      if (st.role === "vertex") {
        setCurrentPoints(() => {
          const updated = st.before.map((p) => ({ ...p }));
          if (st.inserido) updated.splice(st.index, 0, target);
          else if (updated[st.index]) updated[st.index] = target;
          return updated;
        });
      }
    };

    const onPointerUp = (e) => {
      if (!dragStateRef.current) return;
      endDrag(e.lngLat, { cancel: false });
    };

    // Soltar FORA do mapa cancela; dentro, quem conclui é o mouseup/touchend do
    // mapa (o pointerup da janela chega antes e cancelava todo arrasto).
    const onWindowPointerUp = (ev) => {
      if (!dragStateRef.current) return;
      const alvo = /** @type {Node | null} */ (ev?.target ?? null);
      if (alvo && (alvo === canvas || canvas.contains(alvo))) return;
      endDrag(null, { cancel: true });
      map.dragPan.enable();
    };

    const onKeyDown = (ev) => {
      if (ev.key === "Escape" && dragStateRef.current) {
        endDrag(null, { cancel: true });
      }
    };

    const onBlur = () => {
      if (dragStateRef.current) endDrag(null, { cancel: true });
    };

    map.on("mousedown", onPointerDown);
    map.on("touchstart", onPointerDown);
    map.on("mousemove", onPointerMove);
    map.on("touchmove", onPointerMove);
    map.on("mouseup", onPointerUp);
    map.on("touchend", onPointerUp);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      map.off("mousedown", onPointerDown);
      map.off("touchstart", onPointerDown);
      map.off("mousemove", onPointerMove);
      map.off("touchmove", onPointerMove);
      map.off("mouseup", onPointerUp);
      map.off("touchend", onPointerUp);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKeyDown);
      map.dragPan.enable();
      limparVisualArrasto(dragStateRef.current);
      dragStateRef.current = null;
      void canvas;
    };
  }, [mapReady, tipoDesenho, drawingClosed, itemEditando, syncHistoryUi, modoInteracao, currentMarker, meiosNoCadastro]);

  // Mover área inteira — só com a mão (MOVER); arrasto no interior translada tudo.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady || !(tipoDesenho === "area" || tipoDesenho === "linha")) return undefined;
    if (modoInteracao !== MODOS.MOVER) return undefined;
    /** @type {null | { inicio: { lat: number, lng: number }, before: { lat: number, lng: number }[], moved: boolean }} */
    let mov = null;
    const camadas = () => [LAYER_IDS.DESENHO_FILL, LAYER_IDS.DESENHO_LINE].filter((id) => map.getLayer(id));
    const onDown = (e) => {
      if (!podeMoverArea(modoRef.current, currentPointsRef.current)) return;
      const tol = 6;
      const hit = map.queryRenderedFeatures(
        [
          [e.point.x - tol, e.point.y - tol],
          [e.point.x + tol, e.point.y + tol],
        ],
        { layers: camadas() }
      );
      if (!hit.length) return;
      e.preventDefault();
      map.dragPan.disable();
      mov = { inicio: { lat: e.lngLat.lat, lng: e.lngLat.lng }, before: currentPointsRef.current.map((p) => ({ ...p })), moved: false };
    };
    const onMove = (e) => {
      if (!mov) return;
      mov.moved = true;
      setCurrentPoints(transladarPontos(mov.before, e.lngLat.lat - mov.inicio.lat, e.lngLat.lng - mov.inicio.lng));
    };
    const onUp = (e) => {
      if (!mov) return;
      const m = mov;
      mov = null;
      map.dragPan.enable();
      if (!m.moved || !e?.lngLat) {
        setCurrentPoints(m.before);
        return;
      }
      const after = transladarPontos(m.before, e.lngLat.lat - m.inicio.lat, e.lngLat.lng - m.inicio.lng);
      const tx = commitDragTransaction({ undo: undoStackRef.current, redo: redoStackRef.current, before: m.before, after });
      undoStackRef.current = tx.undo;
      redoStackRef.current = tx.redo;
      syncHistoryUi();
      setCurrentPoints(after);
    };
    const onCancel = () => {
      if (!mov) return;
      setCurrentPoints(mov.before);
      mov = null;
      map.dragPan.enable();
    };
    map.on("mousedown", onDown);
    map.on("touchstart", onDown);
    map.on("mousemove", onMove);
    map.on("touchmove", onMove);
    map.on("mouseup", onUp);
    map.on("touchend", onUp);
    window.addEventListener("blur", onCancel);
    return () => {
      map.off("mousedown", onDown);
      map.off("touchstart", onDown);
      map.off("mousemove", onMove);
      map.off("touchmove", onMove);
      map.off("mouseup", onUp);
      map.off("touchend", onUp);
      window.removeEventListener("blur", onCancel);
      map.dragPan.enable();
    };
  }, [mapReady, tipoDesenho, modoInteracao, syncHistoryUi]);

  // Vértice selecionado: destaque pintado em `pintarEdicao`; Delete/Backspace remove.

  // Régua: comprimento de cada segmento (DOM markers, textContent).
  useEffect(() => {
    const map = mapInstanceRef.current;
    reguaMarkersRef.current.forEach((m) => m.remove());
    reguaMarkersRef.current = [];
    if (!map || !mapReady || !reguaAtiva || !(tipoDesenho === "area" || tipoDesenho === "linha")) return undefined;
    const fechado = tipoDesenho === "area" && (drawingClosed || !!itemEditando);
    for (const seg of segmentosDaRegua(currentPoints, fechado, (a, b) => comprimentoMetros([a, b]))) {
      const el = document.createElement("div");
      el.className = "pointer-events-none whitespace-nowrap rounded bg-black/70 px-1 text-[10px] font-semibold text-white";
      el.textContent = formatDistanciaPt(seg.metros);
      reguaMarkersRef.current.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([seg.meio.lng, seg.meio.lat]).addTo(map));
    }
    return () => {
      reguaMarkersRef.current.forEach((m) => m.remove());
      reguaMarkersRef.current = [];
    };
  }, [reguaAtiva, currentPoints, drawingClosed, itemEditando, mapReady, tipoDesenho]);

  const removerVerticeSelecionado = useCallback(() => {
    if (verticeSelecionado == null) return;
    const before = currentPointsRef.current.map((p) => ({ ...p }));
    const after = removerVertice(before, verticeSelecionado, tipoDesenho);
    if (!after) {
      toast.error(tipoDesenho === "area" ? "A área precisa de pelo menos 3 pontos." : "A linha precisa de pelo menos 2 pontos.");
      return;
    }
    const tx = commitDragTransaction({ undo: undoStackRef.current, redo: redoStackRef.current, before, after });
    undoStackRef.current = tx.undo;
    redoStackRef.current = tx.redo;
    syncHistoryUi();
    setCurrentPoints(after);
    setVerticeSelecionado(null);
    toast.success("Ponto removido", { duration: 800 });
  }, [verticeSelecionado, tipoDesenho, syncHistoryUi]);

  useEffect(() => {
    // Com o formulário aberto (prévia) as teclas são do formulário, nunca do desenho.
    if (verticeSelecionado == null || emPrevia) return undefined;
    const onKey = (ev) => {
      const alvo = /** @type {HTMLElement | null} */ (ev.target);
      if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
      if (ev.key === "Delete" || ev.key === "Backspace") {
        ev.preventDefault();
        removerVerticeSelecionado();
      } else if (ev.key === "Escape") {
        setVerticeSelecionado(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [verticeSelecionado, removerVerticeSelecionado, emPrevia]);

  const basemapMap = mapReady ? mapInstanceRef.current : null;
  const basemap = useBasemap(basemapMap, {
    reaplicarCamadas: () => {
      const map = mapInstanceRef.current;
      if (!map) return;
      ensureBusinessLayers(map);
      syncDivisaWidth(map);
      rehydrateAllSources(map);
    },
  });

  const trocarBasemap = (id) => basemap.setBasemap(id);

  const temAlteracoes = () => {
    if (tipoDesenho === "ponto") return !!currentMarker && !itemEditando;
    return desenhoAlterado(itemEditando ? originalPontosRef.current : [], currentPoints);
  };

  const sair = () => {
    if (temAlteracoes()) {
      setConfirmarSaida(true);
      return;
    }
    onCancelar?.();
  };

  const finalizarDesenho = () => {
    if (tipoDesenho === "area") {
      // Como `confirmar()` da referência: aberta com ≥3 pontos, o 1º comando só FECHA
      // (aresta último→primeiro, meios e preenchimento de fechada); nada grava e o
      // formulário só abre no comando seguinte, já com a geometria fechada.
      if (!drawingClosed && !itemEditando) {
        if (currentPoints.length < 3) return;
        setDrawingClosed(true);
        setModo(MODOS.EDITAR);
        toast.success("Área fechada! Arraste os pontos, navegue ou clique Salvar.", { duration: 2000 });
        return;
      }
      const check = validatePolygonForSave(currentPoints);
      if (!check.ok) {
        toast.error(check.reason || "Polígono inválido");
        return;
      }
      setShowFormularioArea(true);
    } else if (tipoDesenho === "linha") {
      const check = validateLineForSave(currentPoints);
      if (!check.ok) {
        toast.error(check.reason || "Linha inválida");
        return;
      }
      if (check.cleaned) setCurrentPoints(check.cleaned);
      setShowFormularioLinha(true);
    }
  };

  /**
   * Retry via epoch — NÃO limpar innerHTML antes do cleanup (R6-02).
   * O effect de mapEpoch faz map.remove() + listeners/timers no unmount.
   */
  const retryMap = () => {
    setMapError(null);
    setMapReady(false);
    setMapEpoch((n) => n + 1);
  };

  const crosshair = tipoDesenho && mapReady && podeAdicionarVertice(modoInteracao, drawingClosed) && !itemEditando;
  const cursorModo = mapReady ? cursorDoModo(modoInteracao) : "";
  const desenhaAreaOuLinha = tipoDesenho === "area" || tipoDesenho === "linha";
  const fechadoParaMedir = tipoDesenho === "area" && (drawingClosed || !!itemEditando);
  const botaoModo = (ativo) =>
    `h-11 min-w-[44px] px-2 text-xs font-semibold rounded-md border shadow-sm ${ativo ? "bg-slate-900 text-white border-slate-900 hover:bg-slate-800" : "bg-white text-slate-800 border-slate-300 hover:bg-slate-100"}`;

  return (
    <div className="fixed inset-0 z-50 bg-white">
      <div className="w-full h-full relative">
        <div
          ref={mapRef}
          data-testid="mapa-desenho-maplibre"
          style={{
            height: "100%",
            width: "100%",
            backgroundColor: "#e5e7eb",
            cursor: crosshair ? "crosshair" : cursorModo || "default",
            touchAction: "none",
          }}
          className={crosshair ? "[&_*]:cursor-crosshair" : ""}
        />

        <CursorEditorOverlay ref={cursorRef} />

        <BasemapAtribuicao atribuicao={basemap.atribuicao} status={basemap.status} mensagem={basemap.mensagem} onRetry={basemap.retry} />

        {confirmarSaida && (
          <div role="alertdialog" aria-label="Descartar alterações" className="absolute left-1/2 top-1/3 z-40 w-[min(92vw,360px)] -translate-x-1/2 space-y-3 rounded-lg bg-white p-4 shadow-2xl">
            <p className="text-sm font-semibold text-slate-900">Descartar o desenho não salvo?</p>
            <p className="text-xs text-slate-600">As alterações no mapa ainda não foram salvas.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => setConfirmarSaida(false)}>
                Voltar ao desenho
              </Button>
              <Button type="button" size="sm" className="h-10 bg-red-600 text-white hover:bg-red-700" onClick={() => { setConfirmarSaida(false); onCancelar?.(); }}>
                Descartar
              </Button>
            </div>
          </div>
        )}

        <Button
          onClick={sair}
          aria-label="Fechar editor"
          variant="secondary"
          size="icon"
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 text-secondary-foreground absolute top-1 left-1 z-20 h-7 w-7 rounded-full bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white"
        >
          <X className="w-6 h-6 text-slate-700" />
        </Button>

        <div className="absolute top-4 right-4 z-20 flex items-center gap-1">
          <Button
            variant={basemap.basemapId === BASEMAP_IDS.RUAS ? "default" : "secondary"}
            size="sm"
            aria-pressed={basemap.basemapId === BASEMAP_IDS.RUAS}
            onClick={() => trocarBasemap(BASEMAP_IDS.RUAS)}
            className="w-9 bg-background text-[hsl(var(--foreground))] px-7 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-black active:text-white h-7"
          >
            Mapa
          </Button>
          <Button
            variant={basemap.basemapId === BASEMAP_IDS.SATELITE ? "default" : "secondary"}
            size="sm"
            aria-pressed={basemap.basemapId === BASEMAP_IDS.SATELITE}
            disabled={basemap.status === "carregando"}
            onClick={() => trocarBasemap(BASEMAP_IDS.SATELITE)}
            title="Satélite"
            className="w-9 bg-background text-[hsl(var(--foreground))] px-7 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-black active:text-white h-7"
          >
            Satélite
          </Button>
          <Button
            variant="secondary"
            size="icon"
            onClick={() => {
              if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                  (position) => {
                    const pos = {
                      lat: position.coords.latitude,
                      lng: position.coords.longitude,
                    };
                    if (mapInstanceRef.current) {
                      mapInstanceRef.current.setCenter([pos.lng, pos.lat]);
                      mapInstanceRef.current.setZoom(18);
                      toast.success("Centralizado na sua localização");
                    }
                  },
                  () => toast.error("Erro ao obter localização")
                );
              }
            }}
            className="w-9 bg-background text-[hsl(var(--foreground))] px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-black active:text-white h-7"
            title="Minha localização"
          >
            <Target className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSnappingEnabled(!snappingEnabled)}
            className="w-9 bg-background text-[hsl(var(--foreground))] px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-black active:text-white h-7"
            title={snappingEnabled ? "Ímã ativado (Alt suspende)" : "Ímã desativado"}
            aria-label="Alternar ímã"
            aria-pressed={snappingEnabled}
          >
            <span className="text-base leading-none">🧲</span>
          </Button>
          {desenhaAreaOuLinha && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReguaAtiva((v) => !v)}
              className="w-9 bg-background px-3 text-xs h-7 border border-input shadow-sm"
              title={reguaAtiva ? "Régua ativada" : "Régua desativada"}
              aria-label="Alternar régua"
              aria-pressed={reguaAtiva}
            >
              <span className="text-base leading-none">📏</span>
            </Button>
          )}
        </div>

        {!mapReady && !mapError && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-white px-6 py-4 rounded-lg shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="animate-spin w-6 h-6 border-4 border-emerald-600 border-t-transparent rounded-full" />
              <span className="font-semibold text-slate-700">Carregando mapa...</span>
            </div>
          </div>
        )}

        {mapError && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-white px-6 py-4 rounded-lg shadow-2xl max-w-sm text-center space-y-3">
            <p className="font-semibold text-slate-800">Mapa indisponível</p>
            <p className="text-sm text-slate-600">{mapError}</p>
            <Button size="sm" onClick={retryMap} className="bg-emerald-600 text-white hover:bg-emerald-700">
              Tentar novamente
            </Button>
          </div>
        )}

        {tipoDesenho && mapReady && (
          <>
            {desenhaAreaOuLinha && (
              <div role="toolbar" aria-label="Modo do editor" className="absolute left-1 top-12 z-20 flex flex-col gap-1" style={{ top: "max(3rem, env(safe-area-inset-top))" }}>
                <button type="button" className={botaoModo(modo === MODOS.NAVEGAR)} aria-pressed={modo === MODOS.NAVEGAR} aria-label="Navegar no mapa" title="Navegar: mover e ampliar sem criar pontos" onClick={() => setModo(MODOS.NAVEGAR)}>
                  ✋ Navegar
                </button>
                {!itemEditando && !drawingClosed && (
                  <button type="button" className={botaoModo(modo === MODOS.DESENHAR)} aria-pressed={modo === MODOS.DESENHAR} aria-label="Desenhar pontos" title="Desenhar: toque curto cria ponto (Shift trava 45°)" onClick={() => setModo(MODOS.DESENHAR)}>
                    ✏️ Desenhar
                  </button>
                )}
                <button type="button" className={botaoModo(modo === MODOS.EDITAR)} aria-pressed={modo === MODOS.EDITAR} aria-label="Editar pontos" title="Editar: arraste pontos, toque no meio para inserir, toque num ponto para selecionar" disabled={currentPoints.length === 0} onClick={() => setModo(MODOS.EDITAR)}>
                  ⬚ Editar
                </button>
                <button type="button" className={botaoModo(modo === MODOS.MOVER)} aria-pressed={modo === MODOS.MOVER} aria-label="Mover área inteira" title="Mão: arraste o interior para mover a área inteira" disabled={currentPoints.length === 0} onClick={() => setModo(MODOS.MOVER)}>
                  ✥ Mover
                </button>
              </div>
            )}
            {tipoDesenho === "area" && currentPoints.length >= 3 && (
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
                <div data-testid="medidas-area" className="bg-black/70 text-white px-3 py-1.5 rounded text-sm font-semibold text-center">
                  <div>Área: {formatHectaresPt(areaHectares(currentPoints))} ha</div>
                  {fechadoParaMedir && (
                    <div className="text-[11px] font-normal">Perímetro: {formatDistanciaPt(comprimentoMetros([...currentPoints, currentPoints[0]]))}</div>
                  )}
                </div>
              </div>
            )}
            {tipoDesenho === "linha" && currentPoints.length >= 2 && (
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
                <div className="bg-black/70 text-white px-3 py-1.5 rounded text-sm font-semibold">
                  {formatDistanciaPt(comprimentoMetros(currentPoints))}
                </div>
              </div>
            )}

            <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-20 flex flex-col items-center gap-1">
              {tipoDesenho === "ponto" && !currentMarker && !itemEditando && (
                <div className="bg-black/70 text-white px-4 py-2 rounded-lg text-xs font-semibold">
                  Toque no mapa para marcar
                </div>
              )}
              {(tipoDesenho === "area" || tipoDesenho === "linha") && currentPoints.length === 0 && !itemEditando && (
                <div className="bg-black/70 text-white px-4 py-2 rounded-lg text-xs font-semibold">
                  {tipoDesenho === "area" ? "Toque para desenhar a área" : "Toque para desenhar a linha"}
                </div>
              )}
              {desenhaAreaOuLinha && currentPoints.length > 0 && (
                <div className="bg-black/70 text-white px-4 py-2 rounded-lg text-xs font-semibold">
                  {modo === MODOS.NAVEGAR && "Navegando — o mapa move sem criar pontos"}
                  {modo === MODOS.DESENHAR && "Toque para adicionar pontos"}
                  {modo === MODOS.EDITAR && (verticeSelecionado != null ? `Ponto ${verticeSelecionado + 1} selecionado` : "Arraste os pontos para ajustar")}
                  {modo === MODOS.MOVER && "Arraste o interior para mover a área"}
                </div>
              )}

              <div className="flex items-center gap-1 bg-white/90 backdrop-blur-sm px-2 py-1.5 rounded-full shadow-lg border border-slate-200">
                {(drawingClosed || currentPoints.length > 0) && !itemEditando && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-background text-[hsl(var(--foreground))] px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground h-7"
                    onClick={() => {
                      cancelarDesenho();
                      setModo(MODOS.DESENHAR);
                      toast.success("Desenho reiniciado", { duration: 1000 });
                    }}
                  >
                    Reiniciar
                  </Button>
                )}

                {verticeSelecionado != null && modo === MODOS.EDITAR && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs border-red-300 text-red-700"
                    onClick={removerVerticeSelecionado}
                  >
                    Remover ponto
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-background text-[hsl(var(--foreground))] px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground h-7"
                  onClick={() => {
                    if (undoStackRef.current.length > 0) {
                      setVerticeSelecionado(null);
                      const prevPts = undoStackRef.current.pop();
                      redoStackRef.current.push(currentPoints.map((p) => ({ ...p })));
                      setCurrentPoints(prevPts);
                      syncHistoryUi();
                      toast.success("Desfeito");
                    }
                  }}
                  disabled={undoLen === 0}
                >
                  Desfazer
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="bg-background text-[hsl(var(--foreground))] px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground h-7"
                  onClick={() => {
                    if (redoStackRef.current.length > 0) {
                      setVerticeSelecionado(null);
                      const nextPts = redoStackRef.current.pop();
                      undoStackRef.current.push(currentPoints.map((p) => ({ ...p })));
                      setCurrentPoints(nextPts);
                      syncHistoryUi();
                      toast.success("Refeito");
                    }
                  }}
                  disabled={redoLen === 0}
                >
                  Refazer
                </Button>

                <Button
                  size="sm"
                  className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow rounded-md px-3 h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={
                    !(
                      (tipoDesenho === "area" && (drawingClosed || currentPoints.length >= 3)) ||
                      (tipoDesenho === "linha" && currentPoints.length >= 2) ||
                      (tipoDesenho === "ponto" && !!currentMarker)
                    )
                  }
                  onClick={() => {
                    if (itemEditando) {
                      if (tipoDesenho === "area") {
                        const check = validatePolygonForSave(currentPoints);
                        if (!check.ok) {
                          toast.error(check.reason || "Polígono inválido");
                          return;
                        }
                        setShowFormularioArea(true);
                      } else if (tipoDesenho === "linha") {
                        const check = validateLineForSave(currentPoints);
                        if (!check.ok) {
                          toast.error(check.reason || "Linha inválida");
                          return;
                        }
                        setShowFormularioLinha(true);
                      } else if (tipoDesenho === "ponto") setShowFormularioPonto(true);
                    } else if (tipoDesenho === "ponto") {
                      setShowFormularioPonto(true);
                    } else {
                      finalizarDesenho();
                    }
                  }}
                >
                  {itemEditando || drawingClosed ? "Salvar" : tipoDesenho === "area" ? "Fechar área" : "Terminar"}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <Sheet
        open={showFormularioArea}
        onOpenChange={(aberto) => {
          setShowFormularioArea(aberto);
          if (!aberto) setCorPrevia(null);
        }}
      >
        <SheetContent side="right" className="w-[320px] sm:w-[400px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{itemEditando ? "Editar Área" : "Cadastrar Área"}</SheetTitle>
          </SheetHeader>
          <FormularioArea
            coordenadas={currentPoints}
            usarGPS={usarGPS}
            item={itemEditando}
            onCorChange={setCorPrevia}
            onSave={() => {
              setShowFormularioArea(false);
              setCorPrevia(null);
              cancelarDesenho();
              queryClient.invalidateQueries({ queryKey: ["areas"] });
              onSalvar();
            }}
            onCancel={() => {
              setShowFormularioArea(false);
              setCorPrevia(null);
            }}
          />
        </SheetContent>
      </Sheet>

      <Sheet open={showFormularioPonto} onOpenChange={setShowFormularioPonto}>
        <SheetContent side="right" className="bg-background px-1 py-1 fixed z-50 gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out inset-y-0 right-0 h-full border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm w-[320px] sm:w-[400px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{itemEditando ? "Editar Ponto" : "Cadastrar Ponto"}</SheetTitle>
          </SheetHeader>
          <FormularioPonto
            coordenadas={currentMarker}
            usarGPS={usarGPS}
            item={itemEditando}
            suggestedDepositoId={null}
            onSave={() => {
              setShowFormularioPonto(false);
              cancelarDesenho();
              queryClient.invalidateQueries({
                predicate: (query) =>
                  Array.isArray(query.queryKey) &&
                  ["pontos", "pontos-suplementacao", "mapa-pontos", "mapa-pontos-supl"].includes(query.queryKey[0]),
              });
              window.dispatchEvent(new CustomEvent("atualizar-mapa"));
              onSalvar();
            }}
            onCancel={() => {
              setShowFormularioPonto(false);
              cancelarDesenho();
            }}
          />
        </SheetContent>
      </Sheet>

      <Sheet open={showFormularioLinha} onOpenChange={setShowFormularioLinha}>
        <SheetContent side="right" className="w-[320px] sm:w-[400px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{itemEditando ? "Editar Linha" : "Cadastrar Linha"}</SheetTitle>
          </SheetHeader>
          <FormularioLinha
            coordenadas={currentPoints}
            usarGPS={usarGPS}
            item={itemEditando}
            onSave={() => {
              setShowFormularioLinha(false);
              cancelarDesenho();
              queryClient.invalidateQueries({ queryKey: ["linhas"] });
              onSalvar();
            }}
            onCancel={() => setShowFormularioLinha(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
