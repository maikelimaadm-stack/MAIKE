import { useRef, useCallback } from "react";
import { maplibregl, setSourceData } from "@/lib/maplibre/lifecycle.js";
import { parseVertex } from "@/lib/geografia/coords.js";
import { buildAccuracyCircleCollection } from "@/lib/maplibre/gpsCapture.js";
import {
  MG_LAYER_IDS,
  MG_SOURCE_IDS,
  buildMgAreasCollection,
  buildMgLinhasCollection,
  centroideArea,
  ensureMgLayers,
  fontesRotuloPorZoom,
  iconeSemAchatar,
  resolverIconeLote,
  resolverIconePonto,
  resolverIconeSuplementacao,
  resolverIconeTarefa,
  textoHectares,
} from "@/lib/maplibre/mapaGeralRender.js";

/**
 * Renderizador incremental do Mapa Geral sobre MapLibre (D-PROD-65).
 *
 * Mesmo contrato público do renderer Google anterior (`syncAreas`, `syncLabels`,
 * `syncPontos`, `syncLinhas`, `syncPontosSuplementacao`, `syncLotes`,
 * `syncTarefas`, `syncUserLocation`, `clearAll`), para que `MapaGeral` mantenha
 * filtros, permissões, painéis e ações. Áreas/linhas viram GeoJSON (estilo SSOT
 * com o editor); marcadores continuam DOM (ícones/URLs/contagem preservados),
 * sempre com `textContent` e cleanup explícito.
 */

const blinkIntervals = new Map();
/** Ícone de lotes acima do centroide (px, independe do zoom). */
const OFFSET_LOTE_PX = /** @type {[number, number]} */ ([0, -30]);

const setBlink = (key, el, shouldBlink, dim = 0.35) => {
  const existing = blinkIntervals.get(key);
  if (!shouldBlink) {
    if (existing) {
      clearInterval(existing);
      blinkIntervals.delete(key);
    }
    if (el) el.style.opacity = "1";
    return;
  }
  if (existing) return;
  let visible = true;
  blinkIntervals.set(
    key,
    setInterval(() => {
      visible = !visible;
      if (el) el.style.opacity = visible ? "1" : String(dim);
    }, 550)
  );
};

const clearBlinks = (prefix = "") => {
  blinkIntervals.forEach((iv, key) => {
    if (!prefix || key.startsWith(prefix)) {
      clearInterval(iv);
      blinkIntervals.delete(key);
    }
  });
};

/** Elemento de marcador: ícone (sem achatar) ou círculo colorido. */
function criarElementoMarcador({ iconUrl, baseSize, cor, titulo, raio = 20, forma = "circulo" }) {
  const el = document.createElement("div");
  el.className = "mg-marker";
  el.style.cssText = "display:flex;align-items:center;justify-content:center;cursor:pointer;";
  if (titulo) el.title = String(titulo);
  const corpo = document.createElement("div");
  corpo.className = "mg-marker-corpo";
  el.appendChild(corpo);
  aplicarCorpo(el, { iconUrl, baseSize, cor, raio, forma });
  return el;
}

function aplicarCorpo(el, { iconUrl, baseSize, cor, raio = 20, forma = "circulo" }) {
  const corpo = /** @type {HTMLDivElement} */ (el.querySelector(".mg-marker-corpo"));
  if (!corpo) return;
  const token = String(Math.random());
  el.dataset.iconToken = token;
  corpo.replaceChildren();
  corpo.style.cssText = "";
  const fallback = () => {
    corpo.replaceChildren();
    if (forma === "pin") {
      corpo.style.cssText = `width:22px;height:30px;background:${cor};clip-path:path('M11 0C5 0 0 5 0 11c0 8 11 19 11 19s11-11 11-19C22 5 17 0 11 0z');border:0;`;
      return;
    }
    const d = raio * 2;
    corpo.style.cssText = `width:${d}px;height:${d}px;border-radius:9999px;background:${cor};border:3px solid #fff;box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,.35);`;
  };
  if (!iconUrl) {
    fallback();
    return;
  }
  const img = document.createElement("img");
  img.alt = "";
  img.draggable = false;
  img.style.cssText = `display:block;width:${baseSize}px;height:${baseSize}px;object-fit:contain;pointer-events:none;`;
  img.onload = () => {
    if (el.dataset.iconToken !== token) return;
    const { width, height } = iconeSemAchatar(img.naturalWidth, img.naturalHeight, baseSize);
    img.style.width = `${width}px`;
    img.style.height = `${height}px`;
  };
  img.onerror = () => {
    if (el.dataset.iconToken !== token) return;
    fallback();
  };
  img.src = iconUrl;
  corpo.appendChild(img);
}

function removerMarcador(entry) {
  if (!entry) return;
  try {
    const img = entry.el?.querySelector?.("img");
    if (img) {
      img.onload = null;
      img.onerror = null;
    }
    if (entry.el) entry.el.dataset.iconToken = "";
    entry.cleanup?.();
    entry.marker?.remove();
  } catch {
    /* best-effort */
  }
}

/**
 * @param {import('react').MutableRefObject<import('maplibre-gl').Map | null>} mapInstanceRef
 */
export default function useMapRenderer(mapInstanceRef) {
  /** @type {import('react').MutableRefObject<Map<string, any>>} */
  const markersRef = useRef(new Map());
  const labelsRef = useRef(new Map());
  const popupRef = useRef(/** @type {import('maplibre-gl').Popup | null} */ (null));
  const areasHandlersRef = useRef(/** @type {null | { off: () => void }} */ (null));
  const linhasHandlersRef = useRef(/** @type {null | { off: () => void }} */ (null));
  const areasCallbacksRef = useRef({ onClick: null, onRightClick: null });
  const areasByIdRef = useRef(new Map());
  const linhasByIdRef = useRef(new Map());
  const dataRef = useRef({ areas: null, linhas: null, user: null });
  const labelZoomHandlerRef = useRef(/** @type {null | (() => void)} */ (null));

  const getMap = () => mapInstanceRef.current;

  const ensureLayers = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    ensureMgLayers(map);
    const d = dataRef.current;
    if (d.areas) setSourceData(map, MG_SOURCE_IDS.AREAS, d.areas);
    if (d.linhas) setSourceData(map, MG_SOURCE_IDS.LINHAS, d.linhas);
    if (d.user) setSourceData(map, MG_SOURCE_IDS.USER, d.user);
  }, [mapInstanceRef]);

  const clearAll = useCallback(() => {
    clearBlinks();
    markersRef.current.forEach(removerMarcador);
    markersRef.current.clear();
    labelsRef.current.forEach(removerMarcador);
    labelsRef.current.clear();
    popupRef.current?.remove();
    popupRef.current = null;
    areasHandlersRef.current?.off();
    areasHandlersRef.current = null;
    linhasHandlersRef.current?.off();
    linhasHandlersRef.current = null;
    if (labelZoomHandlerRef.current) {
      try {
        mapInstanceRef.current?.off("zoomend", labelZoomHandlerRef.current);
      } catch {
        /* ignore */
      }
      labelZoomHandlerRef.current = null;
    }
    areasByIdRef.current.clear();
    linhasByIdRef.current.clear();
    dataRef.current = { areas: null, linhas: null, user: null };
  }, [mapInstanceRef]);

  // ─── Áreas (polígonos) ───
  const syncAreas = useCallback((areas, show, onClickArea, onRightClickArea, colorFn) => {
    const map = getMap();
    if (!map) return;
    ensureMgLayers(map);
    areasCallbacksRef.current = { onClick: onClickArea, onRightClick: onRightClickArea };
    const lista = show ? areas : [];
    areasByIdRef.current = new Map(lista.map((a) => [String(a.id), a]));
    const fc = buildMgAreasCollection(lista, colorFn);
    dataRef.current.areas = fc;
    setSourceData(map, MG_SOURCE_IDS.AREAS, fc);

    if (!areasHandlersRef.current) {
      let hoverId = null;
      const setHover = (id) => {
        if (hoverId === id) return;
        try {
          if (hoverId != null) map.setFeatureState({ source: MG_SOURCE_IDS.AREAS, id: hoverId }, { hover: false });
          if (id != null) map.setFeatureState({ source: MG_SOURCE_IDS.AREAS, id }, { hover: true });
        } catch {
          /* ignore */
        }
        hoverId = id;
      };
      const featureArea = (e) => {
        const f = e.features?.[0];
        const id = f?.properties?.id ?? f?.id;
        return id == null ? null : areasByIdRef.current.get(String(id)) || null;
      };
      const onMove = (e) => {
        const f = e.features?.[0];
        setHover(f?.id ?? null);
        map.getCanvas().style.cursor = "pointer";
      };
      const onLeave = () => {
        setHover(null);
        map.getCanvas().style.cursor = "";
      };
      const onClick = (e) => {
        const area = featureArea(e);
        if (!area) return;
        areasCallbacksRef.current.onClick?.(area, { lat: e.lngLat.lat, lng: e.lngLat.lng });
      };
      const onContext = (e) => {
        const area = featureArea(e);
        if (!area) return;
        areasCallbacksRef.current.onRightClick?.(area, { lat: e.lngLat.lat, lng: e.lngLat.lng });
      };
      map.on("mousemove", MG_LAYER_IDS.AREAS_FILL, onMove);
      map.on("mouseleave", MG_LAYER_IDS.AREAS_FILL, onLeave);
      map.on("click", MG_LAYER_IDS.AREAS_FILL, onClick);
      map.on("contextmenu", MG_LAYER_IDS.AREAS_FILL, onContext);
      areasHandlersRef.current = {
        off: () => {
          try {
            map.off("mousemove", MG_LAYER_IDS.AREAS_FILL, onMove);
            map.off("mouseleave", MG_LAYER_IDS.AREAS_FILL, onLeave);
            map.off("click", MG_LAYER_IDS.AREAS_FILL, onClick);
            map.off("contextmenu", MG_LAYER_IDS.AREAS_FILL, onContext);
          } catch {
            /* ignore */
          }
        },
      };
    }
  }, [mapInstanceRef]);

  // ─── Rótulos das áreas (nome + ha + extra) ───
  const syncLabels = useCallback((areas, show, extraTextFn, showHectares = true) => {
    const map = getMap();
    if (!map) return;
    const lista = show ? areas : [];
    const ids = new Set(lista.map((a) => String(a.id)));
    labelsRef.current.forEach((entry, id) => {
      if (!ids.has(id)) {
        removerMarcador(entry);
        labelsRef.current.delete(id);
      }
    });

    const aplicarFonte = (entry) => {
      const f = fontesRotuloPorZoom(map.getZoom());
      entry.titulo.style.fontSize = `${f.nome}px`;
      entry.ha.style.fontSize = `${f.ha}px`;
      entry.extra.style.fontSize = `${f.ha}px`;
    };

    if (!labelZoomHandlerRef.current) {
      const h = () => labelsRef.current.forEach(aplicarFonte);
      labelZoomHandlerRef.current = h;
      map.on("zoomend", h);
    }

    for (const area of lista) {
      const id = String(area.id);
      const centro = centroideArea(area);
      if (!centro) continue;
      const extraText = extraTextFn ? extraTextFn(area) : null;
      const haText = showHectares ? textoHectares(area) : null;
      let entry = labelsRef.current.get(id);
      if (!entry) {
        const el = document.createElement("div");
        el.className = "mg-area-label";
        el.style.cssText =
          "pointer-events:none;color:#fff;text-align:center;white-space:nowrap;line-height:1.15;text-shadow:0 1px 2px rgba(0,0,0,.85),0 0 3px rgba(0,0,0,.6);font-family:Inter,Arial,sans-serif;";
        const titulo = document.createElement("div");
        titulo.style.fontWeight = "700";
        const ha = document.createElement("div");
        ha.style.opacity = "0.95";
        const extra = document.createElement("div");
        extra.style.cssText = "font-weight:600;color:#fef08a;";
        el.append(titulo, ha, extra);
        // Rótulo logo abaixo do centroide; o ícone de lotes fica acima (OFFSET_LOTE_PX):
        // nenhum cobre o outro em qualquer zoom.
        const marker = new maplibregl.Marker({ element: el, anchor: "top", offset: [0, 2] }).setLngLat([centro.lng, centro.lat]).addTo(map);
        entry = { el, marker, titulo, ha, extra };
        labelsRef.current.set(id, entry);
      } else {
        entry.marker.setLngLat([centro.lng, centro.lat]);
      }
      entry.titulo.textContent = area.nome || "";
      entry.ha.textContent = haText || "";
      entry.ha.style.display = haText ? "block" : "none";
      entry.extra.textContent = extraText || "";
      entry.extra.style.display = extraText ? "block" : "none";
      aplicarFonte(entry);
    }
  }, [mapInstanceRef]);

  /**
   * Sincroniza um grupo de marcadores DOM identificado por prefixo.
   * @param {string} prefix
   * @param {Array<any>} itens `{ key, lngLat: [lng, lat], estado, criar(), atualizar(entry), ref? }`
   */
  const syncGrupo = (prefix, itens) => {
    const map = getMap();
    if (!map) return;
    const keys = new Set(itens.map((i) => i.key));
    markersRef.current.forEach((entry, key) => {
      if (key.startsWith(prefix) && !keys.has(key)) {
        clearBlinks(key);
        removerMarcador(entry);
        markersRef.current.delete(key);
      }
    });
    for (const item of itens) {
      let entry = markersRef.current.get(item.key);
      if (!entry) {
        entry = item.criar();
        entry.marker.setLngLat(item.lngLat).addTo(map);
        entry.estado = item.estado;
        markersRef.current.set(item.key, entry);
      } else if (entry.estado !== item.estado) {
        entry.marker.setLngLat(item.lngLat);
        item.atualizar(entry);
        entry.estado = item.estado;
      }
      entry.ultimo = item;
    }
  };

  const abrirPopup = (lngLat, titulo, subtitulo) => {
    const map = getMap();
    if (!map) return;
    popupRef.current?.remove();
    const box = document.createElement("div");
    box.style.padding = "4px 6px";
    const t = document.createElement("strong");
    t.textContent = titulo || "";
    const s = document.createElement("div");
    s.style.color = "#666";
    s.textContent = subtitulo || "";
    box.append(t, s);
    popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "260px" }).setLngLat(lngLat).setDOMContent(box).addTo(map);
  };

  /** Marcador clicável (click não propaga ao mapa). */
  const criarMarcadorClicavel = (spec, onClick, extra = {}) => {
    const el = criarElementoMarcador(spec);
    const handler = (ev) => {
      ev.stopPropagation();
      onClick?.();
    };
    el.addEventListener("click", handler);
    const marker = new maplibregl.Marker({ element: el, anchor: spec.forma === "pin" ? "bottom" : "center", ...extra });
    return { el, marker, cleanup: () => el.removeEventListener("click", handler) };
  };

  // ─── Pontos de referência ───
  const syncPontos = useCallback((pontos, show, iconesConfig, onClickPonto) => {
    const prefix = "ponto_";
    const itens = [];
    if (show) {
      for (const ponto of pontos) {
        const c = parseVertex(ponto.coordenadas);
        if (!c) continue;
        const { iconUrl, cor } = resolverIconePonto(ponto, iconesConfig);
        const key = prefix + ponto.id;
        const estado = JSON.stringify([c.lat, c.lng, ponto.nome, iconUrl, cor]);
        const ref = { ponto };
        itens.push({
          key,
          lngLat: [c.lng, c.lat],
          estado,
          criar: () => {
            const entry = criarMarcadorClicavel({ iconUrl, baseSize: 40, cor, titulo: ponto.nome }, () => {
              const p = markersRef.current.get(key)?.ultimo?.ref?.ponto || ponto;
              if (typeof onClickPonto === "function") onClickPonto(p);
              else abrirPopup([c.lng, c.lat], p.nome, p.tipo);
            });
            entry.marker.getElement().style.zIndex = "800";
            return entry;
          },
          atualizar: (entry) => {
            entry.el.title = String(ponto.nome || "");
            aplicarCorpo(entry.el, { iconUrl, baseSize: 40, cor });
          },
          ref,
        });
      }
    }
    syncGrupo(prefix, itens);
  }, [mapInstanceRef]);

  // ─── Linhas geográficas ───
  const syncLinhas = useCallback((linhas, show) => {
    const map = getMap();
    if (!map) return;
    ensureMgLayers(map);
    const lista = show ? linhas : [];
    linhasByIdRef.current = new Map(lista.map((l) => [String(l.id), l]));
    const fc = buildMgLinhasCollection(lista);
    dataRef.current.linhas = fc;
    setSourceData(map, MG_SOURCE_IDS.LINHAS, fc);
    if (!linhasHandlersRef.current) {
      const onClick = (e) => {
        const f = e.features?.[0];
        const linha = linhasByIdRef.current.get(String(f?.properties?.id ?? f?.id));
        if (!linha) return;
        abrirPopup([e.lngLat.lng, e.lngLat.lat], linha.nome, linha.tipo);
      };
      map.on("click", MG_LAYER_IDS.LINHAS, onClick);
      linhasHandlersRef.current = { off: () => map.off("click", MG_LAYER_IDS.LINHAS, onClick) };
    }
  }, [mapInstanceRef]);

  // ─── Pontos de suplementação (cochos/depósitos) ───
  const syncPontosSuplementacao = useCallback((pontosSupl, show, iconesConfig, onClick) => {
    const prefix = "supl_";
    const itens = [];
    if (show) {
      for (const ponto of pontosSupl) {
        const c = parseVertex(ponto.coordenadas);
        if (!c) continue;
        const { iconUrl, cor, categoria } = resolverIconeSuplementacao(ponto, iconesConfig);
        const key = prefix + ponto.id;
        const ref = { ponto };
        itens.push({
          key,
          lngLat: [c.lng, c.lat],
          estado: JSON.stringify([c.lat, c.lng, ponto.nome_ponto, iconUrl, categoria]),
          criar: () => {
            const entry = criarMarcadorClicavel({ iconUrl, baseSize: 40, cor, titulo: ponto.nome_ponto }, () => {
              const p = markersRef.current.get(key)?.ultimo?.ref?.ponto || ponto;
              onClick?.(p);
            });
            entry.marker.getElement().style.zIndex = "500";
            return entry;
          },
          atualizar: (entry) => {
            entry.el.title = String(ponto.nome_ponto || "");
            aplicarCorpo(entry.el, { iconUrl, baseSize: 40, cor });
          },
          ref,
        });
      }
    }
    syncGrupo(prefix, itens);
  }, [mapInstanceRef]);

  // ─── Lotes (agrupados por área) ───
  const syncLotes = useCallback((lotesFiltrados, areas, show, iconesConfig, onClickLotes, onDragLotes, canDragLotes = true, blinkAlerts = false) => {
    const prefix = "lote_area_";
    const porArea = {};
    if (show) {
      for (const lote of lotesFiltrados) {
        if (!lote.area_atual_id) continue;
        (porArea[lote.area_atual_id] ||= []).push(lote);
      }
    }
    const itens = [];
    for (const [areaId, lotesNaArea] of Object.entries(porArea)) {
      const area = areas.find((a) => a.id === areaId);
      const centro = area ? centroideArea(area) : null;
      if (!centro) continue;
      const totalCabecas = lotesNaArea.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);
      const totalAlertas = lotesNaArea.reduce((s, l) => s + (l.alertas?.length || 0), 0);
      const { iconUrl, categorias } = resolverIconeLote(lotesNaArea, iconesConfig);
      const identificadores = identificadoresDoLote(lotesNaArea);
      const key = prefix + areaId;
      const ref = { lotesNaArea, areas };
      const estado = JSON.stringify([centro.lat, centro.lng, totalCabecas, totalAlertas, area.nome, !!canDragLotes, iconUrl, categorias, identificadores, blinkAlerts]);
      itens.push({
        key,
        lngLat: [centro.lng, centro.lat],
        estado,
        ref,
        criar: () => {
          const entry = criarMarcadorClicavel({ iconUrl, baseSize: 50, cor: "#10b981", titulo: area.nome, raio: 22 }, () => {
            if (entry.arrastou) return;
            onClickLotes?.(markersRef.current.get(key)?.ultimo?.ref?.lotesNaArea || lotesNaArea);
          }, { draggable: !!canDragLotes, offset: OFFSET_LOTE_PX });
          const badge = document.createElement("div");
          badge.className = "mg-lote-count";
          badge.style.cssText =
            // Quantidade de cabeças: cinza escuro, fonte menor e abaixo da figura,
            // com halo claro para ler sobre o ícone (pedido do proprietário, D-PROD-82).
            "position:absolute;left:50%;top:64%;transform:translate(-50%,-50%);color:#374151;font:700 9px Inter,Arial,sans-serif;text-shadow:0 0 2px rgba(255,255,255,.95),0 0 3px rgba(255,255,255,.8);pointer-events:none;";
          const ind = document.createElement("div");
          ind.className = "mg-lote-ident";
          ind.style.cssText = "position:absolute;left:calc(50% + 20px);top:calc(50% - 25px);transform:translate(-50%,-50%);display:flex;pointer-events:none;";
          entry.el.append(badge, ind);
          entry.badge = badge;
          entry.ind = ind;
          entry.arrastou = false;
          entry.marker.on("dragstart", () => {
            entry.arrastou = true;
          });
          entry.marker.on("dragend", () => {
            const ll = entry.marker.getLngLat();
            const r = markersRef.current.get(key)?.ultimo?.ref || ref;
            onDragLotes?.({ lat: ll.lat, lng: ll.lng }, r.lotesNaArea, areaId, r.areas);
            const voltar = markersRef.current.get(key)?.ultimo?.lngLat;
            if (voltar) entry.marker.setLngLat(voltar);
            setTimeout(() => {
              entry.arrastou = false;
            }, 0);
          });
          preencherLote(entry, { totalCabecas, identificadores, totalAlertas, blinkAlerts, key, canDragLotes });
          return entry;
        },
        atualizar: (entry) => {
          entry.el.title = String(area.nome || "");
          aplicarCorpo(entry.el, { iconUrl, baseSize: 50, cor: "#10b981", raio: 22 });
          preencherLote(entry, { totalCabecas, identificadores, totalAlertas, blinkAlerts, key, canDragLotes });
        },
      });
    }
    syncGrupo(prefix, itens);
  }, [mapInstanceRef]);

  // ─── Tarefas ───
  const syncTarefas = useCallback((tarefasMapa, areas, iconesConfig, onClickTarefa) => {
    const prefix = "tarefa_";
    const itens = [];
    for (const t of tarefasMapa) {
      let pos = parseVertex(t.coordenadas);
      if (!pos && t.area_id) {
        const area = areas.find((a) => a.id === t.area_id);
        pos = area ? centroideArea(area) : null;
      }
      if (!pos) continue;
      const { iconUrl, cor } = resolverIconeTarefa(t, iconesConfig);
      const key = prefix + t.id;
      const ref = { tarefa: t };
      const urgente = t.prioridade === "Urgente";
      itens.push({
        key,
        lngLat: [pos.lng, pos.lat],
        estado: JSON.stringify([pos.lat, pos.lng, t.titulo, t.prioridade, iconUrl]),
        ref,
        criar: () => {
          const entry = criarMarcadorClicavel({ iconUrl, baseSize: 28, cor, titulo: t.titulo, forma: iconUrl ? "circulo" : "pin" }, () => {
            onClickTarefa?.(markersRef.current.get(key)?.ultimo?.ref?.tarefa || t);
          });
          entry.marker.getElement().style.zIndex = urgente ? "3000" : "2500";
          return entry;
        },
        atualizar: (entry) => {
          entry.el.title = String(t.titulo || "");
          entry.marker.getElement().style.zIndex = urgente ? "3000" : "2500";
          aplicarCorpo(entry.el, { iconUrl, baseSize: 28, cor, forma: iconUrl ? "circulo" : "pin" });
        },
      });
    }
    syncGrupo(prefix, itens);
  }, [mapInstanceRef]);

  // ─── Localização do usuário ───
  const syncUserLocation = useCallback((userLocation, show) => {
    const map = getMap();
    if (!map) return;
    ensureMgLayers(map);
    const pos = show ? parseVertex(userLocation) : null;
    const fc = pos ? buildAccuracyCircleCollection(pos, 20) : { type: "FeatureCollection", features: [] };
    dataRef.current.user = /** @type {any} */ (fc);
    setSourceData(map, MG_SOURCE_IDS.USER, /** @type {any} */ (fc));
    syncGrupo(
      "user_",
      pos
        ? [
            {
              key: "user_loc",
              lngLat: [pos.lng, pos.lat],
              estado: `${pos.lat},${pos.lng}`,
              criar: () => {
                const el = document.createElement("div");
                el.title = "Sua localização";
                el.style.cssText = "width:24px;height:24px;border-radius:9999px;background:#4285F4;border:3px solid #fff;box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,.4);pointer-events:none;";
                const marker = new maplibregl.Marker({ element: el, anchor: "center" });
                marker.getElement().style.zIndex = "10000";
                return { el, marker };
              },
              atualizar: () => {},
            },
          ]
        : []
    );
  }, [mapInstanceRef]);

  /** Há área de negócio sob o ponto (para o clique geral do mapa não duplicar o da área). */
  const hitArea = useCallback((point) => {
    const map = getMap();
    if (!map || !map.getLayer(MG_LAYER_IDS.AREAS_FILL)) return false;
    try {
      return map.queryRenderedFeatures(point, { layers: [MG_LAYER_IDS.AREAS_FILL] }).length > 0;
    } catch {
      return false;
    }
  }, [mapInstanceRef]);

  return { clearAll, ensureLayers, hitArea, syncAreas, syncLabels, syncPontos, syncLinhas, syncPontosSuplementacao, syncLotes, syncTarefas, syncUserLocation };
}

function identificadoresDoLote(lotesNaArea) {
  const unicos = [
    ...new Map(
      lotesNaArea
        .filter((l) => l.identificador_cor || l.identificador_sigla || l.identificador_nome)
        .map((l) => {
          const cor = l.identificador_cor || "#64748b";
          const sigla = l.identificador_sigla || l.identificador_nome || "";
          const nome = l.identificador_nome || sigla;
          return [`${cor}_${sigla}_${nome}`, { cor, sigla, nome }];
        })
    ).values(),
  ];
  return unicos.length <= 1 ? unicos : [{ cor: "linear-gradient(90deg, #000000 50%, #ffffff 50%)", nome: "MISTO", sigla: "" }];
}

function preencherLote(entry, { totalCabecas, identificadores, totalAlertas, blinkAlerts, key, canDragLotes }) {
  entry.badge.textContent = String(totalCabecas);
  entry.ind.replaceChildren(
    ...identificadores.map((i) => {
      const d = document.createElement("div");
      d.title = i.nome || i.sigla || "";
      d.style.cssText =
        "width:15px;height:15px;border-radius:9999px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:700;color:#fff;line-height:1;overflow:hidden;";
      d.style.background = i.cor;
      d.textContent = i.sigla ? String(i.sigla).substring(0, 2) : "";
      return d;
    })
  );
  entry.marker.setDraggable(!!canDragLotes);
  entry.marker.getElement().style.zIndex = totalAlertas > 0 ? "2000" : "1000";
  setBlink(key + "_ind", entry.ind, blinkAlerts && totalAlertas > 0, 0.2);
}
