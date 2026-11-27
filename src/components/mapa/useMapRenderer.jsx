/*
 * GUIA DE EDIÇÃO — MARCADORES DO MAPA: tamanho (baseSize) de pontos, cochos e tarefas; lotes em syncLotes; rótulos em syncLabels.
 * Lotes desenhados pelo mapa (D-PROD-349): posição, contagem, identificador, piscar e arrastar em src/lib/maplibre/lotesNoMapa.js.
 * Ícone do lote (D-PROD-191): o desenho, a largura (LARGURA_MARCADOR_PX) e a altura do número de cabeças (CONTAGEM_TOPO_PCT) vêm do código, em src/assets/icones/lotes.
 * Índice completo: docs/design/GUIA-MAPA-E-ICONES.md
 */

import { aplicarIndicadorTarefa } from "@/lib/tarefas/marcador";
import { normalizarPrioridadeTarefa } from "@/lib/tarefas/prioridade";
import { useRef, useCallback } from "react";
import { maplibregl, setSourceData } from "@/lib/maplibre/lifecycle.js";
import { parseVertex, parseVertices } from "@/lib/geografia/coords.js";
import { buildAccuracyCircleCollection } from "@/lib/maplibre/gpsCapture.js";
import {
  MG_LAYER_IDS,
  MG_SOURCE_IDS,
  buildMgAreasCollection,
  buildMgLinhasCollection,
  centroideArea,
  descreverMarcadorSuplementacao,
  escalaRotulo,
  escolherModoRotulos,
  pontoEFolga,
  siglaDaArea,
  ensureMgLayers,
  aplicarEstiloPasto,
  fontesRotuloPorZoom,
  iconeSemAchatar,
  resolverIconeLote,
  resolverIconePonto,
  resolverIconeSuplementacao,
  resolverIconeTarefa,
  textoHectares,
} from "@/lib/maplibre/mapaGeralRender.js";
import {
  OFFSET_LOTE_COM_NOME_PX,
  TAMANHO_PADRAO_LOTE,
  caixaDoLote,
  colecaoLotes,
  criarPiscaIdent,
  garantirImagens,
  haLoteNoPonto,
  identificadoresDoLote,
  imagemPronta,
  ligarImagensFaltando,
  ligarInteracaoLotes,
  pedidoImagemIdent,
  pedidoImagemLote,
  pixelRatioDaTela,
  registrarImagens,
} from "@/lib/maplibre/lotesNoMapa.js";

/**
 * Renderizador incremental do Mapa Geral sobre MapLibre (D-PROD-65).
 *
 * Mesmo contrato público do renderer Google anterior (`syncAreas`, `syncLabels`,
 * `syncPontos`, `syncLinhas`, `syncPontosSuplementacao`, `syncLotes`,
 * `syncTarefas`, `syncUserLocation`, `clearAll`), para que `MapaGeral` mantenha
 * filtros, permissões, painéis e ações. Áreas/linhas viram GeoJSON (estilo SSOT
 * com o editor); pontos, cochos, tarefas e nomes continuam DOM, sempre com
 * `textContent` e cleanup explícito.
 *
 * Lotes (D-PROD-349): desenhados pelo próprio mapa — fonte GeoJSON + camadas
 * `symbol` com a imagem da figura e a contagem já escrita (`lotesNoMapa.js`).
 * O ícone vem do código (D-PROD-191): `resolverIconeLote` monta a figura pela
 * Categoria de Manejo de cada posição do pasto e sempre devolve figura; a
 * `chave` do desenho vai na fonte (`desenho`) e na chave da imagem.
 */

/**
 * Par ícone do lote (44 px) + nome embaixo, centrado no ponto da área, com
 * alturas CONSTANTES (D-PROD-128): ícone 44 + 2 de espaço + nome reservado de
 * 26 px (nome + ha) = 72 px → ícone com o centro 14 px acima do ponto e o nome
 * começando 10 px abaixo. Não muda com o nível do rótulo nem com a imagem.
 * O ícone é o `icon-offset` da camada dos lotes quando `comRotulo` (D-PROD-349).
 */
const PAR_LOTE = {
  icone: OFFSET_LOTE_COM_NOME_PX,
  nome: /** @type {[number, number]} */ ([0, 10]),
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

/**
 * Cores do selo do cocho/depósito (D-PROD-178): "?" cinza (nível neutro) e
 * "!" âmbar (depósito acima do limite). Contraste do texto ≥ 4,5:1.
 */
const CORES_SELO_SUPLEMENTACAO = Object.freeze({
  neutro: { fundo: "#6b7280", texto: "#ffffff" },
  excesso: { fundo: "#f59e0b", texto: "#1f2937" },
});

/**
 * Título, `aria-label` e selo do marcador de cocho/depósito. O `aria-label`
 * precisa existir antes do `addTo` (sem ele o MapLibre põe "Map marker"). O
 * selo é decorativo (`aria-hidden`): o que ele diz já está no `aria-label`.
 * Só recria o selo quando o tipo muda.
 * @param {any} entry
 * @param {string} titulo
 * @param {null | { tipo: "neutro" | "excesso", texto: string }} selo
 */
function aplicarTextoESeloSuplementacao(entry, titulo, selo) {
  const el = entry.el;
  el.title = titulo;
  if (titulo) el.setAttribute("aria-label", titulo);
  else el.removeAttribute("aria-label");

  const tipo = selo?.tipo ?? null;
  if ((entry.selo?.dataset?.selo ?? null) === tipo) return;
  entry.selo?.remove();
  entry.selo = null;
  if (!selo) return;
  const cores = CORES_SELO_SUPLEMENTACAO[selo.tipo];
  const s = document.createElement("span");
  s.className = "mg-supl-selo";
  s.dataset.selo = selo.tipo;
  s.setAttribute("aria-hidden", "true");
  s.textContent = selo.texto;
  // Canto de cima à direita do ícone de 36 px, fora do fluxo: não mexe na âncora.
  s.style.cssText =
    `position:absolute;left:calc(50% + 13px);top:calc(50% - 14px);transform:translate(-50%,-50%);width:16px;height:16px;box-sizing:border-box;border-radius:9999px;border:2px solid #fff;background:${cores.fundo};color:${cores.texto};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;font-family:Inter,Arial,sans-serif;line-height:1;box-shadow:0 1px 2px rgba(0,0,0,.35);pointer-events:none;`;
  el.appendChild(s);
  entry.selo = s;
}

/**
 * D-PROD-205 — farol da leitura de cocho: ponto colorido no canto de BAIXO à
 * direita do ícone (o selo do nível fica no de cima). Decorativo (`aria-hidden`):
 * o texto do farol já está no `aria-label`. Só recria quando a cor muda.
 * @param {any} entry
 * @param {null | { cor: string, hex: string }} farol
 */
function aplicarFarolSuplementacao(entry, farol) {
  const cor = farol?.cor ?? null;
  if ((entry.farol?.dataset?.farol ?? null) === cor) return;
  entry.farol?.remove();
  entry.farol = null;
  if (!farol) return;
  const f = document.createElement("span");
  f.className = "mg-supl-farol";
  f.dataset.farol = farol.cor;
  f.setAttribute("aria-hidden", "true");
  f.style.cssText =
    `position:absolute;left:calc(50% + 13px);top:calc(50% + 12px);transform:translate(-50%,-50%);width:12px;height:12px;box-sizing:border-box;border-radius:9999px;border:2px solid #fff;background:${farol.hex};box-shadow:0 1px 2px rgba(0,0,0,.35);pointer-events:none;`;
  entry.el.appendChild(f);
  entry.farol = f;
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
  const dataRef = useRef(/** @type {{ areas: any, linhas: any, user: any, lotes: any }} */ ({ areas: null, linhas: null, user: null, lotes: null }));
  const labelZoomHandlerRef = useRef(/** @type {null | (() => void)} */ (null));
  const arrumarRef = useRef(/** @type {null | { handler: () => void, quadro: number }} */ (null));
  /**
   * Lotes no mapa (D-PROD-349), por pasto: o que vai na fonte (`item`), os lotes e as áreas para os callbacks e o
   * tamanho do ícone (obstáculo dos nomes).
   * @type {import('react').MutableRefObject<Map<string, { item: Omit<import('@/lib/maplibre/lotesNoMapa.js').ItemLote, 'comRotulo'>, lotesNaArea: any[], areas: any[], tamanho: { w: number, h: number } }>>}
   */
  const lotesRef = useRef(new Map());
  const lotesCallbacksRef = useRef(/** @type {{ onClickLotes: any, onDragLotes: any, canDragLotes: boolean }} */ ({ onClickLotes: null, onDragLotes: null, canDragLotes: false }));
  const lotesHandlersRef = useRef(/** @type {null | { off: () => void }} */ (null));
  const lotesSeqRef = useRef(0);
  const lotesConteudoRef = useRef("");
  const lotesPublicadoRef = useRef("");
  const pixelRatioRef = useRef(pixelRatioDaTela());
  const piscaRef = useRef(/** @type {null | ReturnType<typeof criarPiscaIdent>} */ (null));
  if (!piscaRef.current) piscaRef.current = criarPiscaIdent(() => mapInstanceRef.current);

  const estiloPastoRef = useRef("cheio");

  const getMap = () => mapInstanceRef.current;

  /** Estilo dos pastos (D-PROD-132): guardado e reaplicado após troca de basemap. */
  const setEstiloPasto = useCallback((estilo) => {
    estiloPastoRef.current = estilo || "cheio";
    const map = mapInstanceRef.current;
    if (map) aplicarEstiloPasto(map, estiloPastoRef.current);
  }, [mapInstanceRef]);

  /** Chaves das imagens em uso pelos lotes (ícone e identificador). */
  const chavesImagensLotes = (lotes = lotesRef.current) => {
    /** @type {string[]} */
    const chaves = [];
    lotes.forEach((l) => {
      chaves.push(l.item.imagem);
      if (l.item.ident) chaves.push(l.item.ident);
    });
    return chaves;
  };

  const ensureLayers = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    ensureMgLayers(map);
    aplicarEstiloPasto(map, estiloPastoRef.current);
    // Estilo novo (satélite ↔ mapa) vem sem as imagens dos lotes: repõe antes dos dados (D-PROD-349).
    registrarImagens(map, chavesImagensLotes(), pixelRatioRef.current);
    const d = dataRef.current;
    if (d.areas) setSourceData(map, MG_SOURCE_IDS.AREAS, d.areas);
    if (d.linhas) setSourceData(map, MG_SOURCE_IDS.LINHAS, d.linhas);
    if (d.user) setSourceData(map, MG_SOURCE_IDS.USER, d.user);
    if (d.lotes) setSourceData(map, MG_SOURCE_IDS.LOTES, d.lotes);
  }, [mapInstanceRef]);

  const clearAll = useCallback(() => {
    piscaRef.current?.parar();
    lotesHandlersRef.current?.off();
    lotesHandlersRef.current = null;
    lotesSeqRef.current += 1; // imagens que ainda chegam não publicam mais nada
    lotesRef.current = new Map();
    lotesConteudoRef.current = "";
    lotesPublicadoRef.current = "";
    setSourceData(/** @type {any} */ (mapInstanceRef.current), MG_SOURCE_IDS.LOTES, { type: "FeatureCollection", features: [] });
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
        mapInstanceRef.current?.off("zoom", labelZoomHandlerRef.current);
      } catch {
        /* ignore */
      }
      labelZoomHandlerRef.current = null;
    }
    if (arrumarRef.current) {
      try {
        mapInstanceRef.current?.off("moveend", arrumarRef.current.handler);
      } catch {
        /* ignore */
      }
      cancelAnimationFrame(arrumarRef.current.quadro);
      arrumarRef.current = null;
    }
    areasByIdRef.current.clear();
    linhasByIdRef.current.clear();
    dataRef.current = { areas: null, linhas: null, user: null, lotes: null };
  }, [mapInstanceRef]);

  // ─── Áreas (polígonos) ───
  const syncAreas = useCallback((areas, show, onClickArea, onRightClickArea, colorFn) => {
    const map = getMap();
    if (!map) return;
    ensureMgLayers(map);
    aplicarEstiloPasto(map, estiloPastoRef.current);
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
        // O clique no ícone do lote abre os lotes, não a área por baixo (D-PROD-349).
        if (haLoteNoPonto(map, e.point)) return;
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
  /**
   * Sem bagunça de rótulos (D-PROD-126): mede os rótulos e as áreas na tela e
   * põe TODOS no mesmo nível — nome + ha, só o nome, ou só a sigla.
   *
   * D-PROD-347 (mapa leve): `soNaTela` (durante o zoom) mede e mexe só nos rótulos cujo pasto está na tela; os de fora
   * ficam como estavam até o `moveend`, que revê todos. Medir os 200 rótulos a cada revisão travava o zoom.
   * @param {{ soNaTela?: boolean }} [opcoes]
   */
  const arrumarRotulos = (opcoes) => {
    const map = getMap();
    if (!map) return;
    const soNaTela = opcoes?.soNaTela === true;
    // Lote de área sem rótulo (nomes desligados ou área sem nome): volta à
    // posição padrão, sem o espaço do nome embaixo (D-PROD-127). Com rótulo, o
    // par ícone + nome. Vai na fonte dos lotes como `comRotulo` (D-PROD-349).
    publicarLotes();
    if (!labelsRef.current.size) return;
    const caixa = (/** @type {Element} */ el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };

    /**
     * Põe todos os rótulos num nível e já na posição final (D-PROD-127): sem
     * lote, o nome centrado no ponto; com lote, o par ícone (em cima) + nome
     * (embaixo) centrado. A colisão é medida depois disso, no que vai aparecer.
     * @param {"tudo" | "nome" | "sigla"} modo
     */
    const aplicar = (modo) => {
      labelsRef.current.forEach((entry, id) => {
        if (alvo && !alvo.has(id)) return;
        entry.titulo.textContent = modo === "sigla" ? entry.sigla : entry.nome;
        entry.ha.style.display = modo === "tudo" && entry.temHa ? "block" : "none";
        entry.extra.style.display = modo === "tudo" && entry.temExtra ? "block" : "none";
        // Posições FIXAS (D-PROD-128): o par ícone + nome continua centrado no
        // ponto, mas calculado com alturas constantes — nada sobe nem desce ao
        // trocar sigla/nome/ha, no zoom, ao redimensionar ou quando a figura do
        // boi termina de carregar. Sem lote, o nome é centrado por CSS.
        if (lotesRef.current.has(id)) {
          // o ícone já está em PAR_LOTE.icone (`comRotulo` na fonte dos lotes)
          entry.marker.setOffset(PAR_LOTE.nome);
          entry.base = "";
          entry.corpo.style.transformOrigin = "50% 0";
        } else {
          entry.marker.setOffset([0, 0]);
          entry.base = "translateY(-50%)";
          entry.corpo.style.transformOrigin = "50% 50%";
        }
        entry.corpo.style.transform = entry.base; // mede sem escala
      });
    };
    const medir = () => {
      /** @type {Map<string, { x: number, y: number, w: number, h: number }>} */
      const rotulos = new Map();
      labelsRef.current.forEach((entry, id) => {
        if (!alvo || alvo.has(id)) rotulos.set(id, caixa(entry.corpo));
      });
      return { rotulos, obstaculos: obstaculosLotes };
    };

    // caixa de cada área na tela
    /** @type {Map<string, { x: number, y: number, w: number, h: number }>} */
    const areas = new Map();
    const tela = map.getCanvas();
    const larg = tela.clientWidth || tela.width, alt = tela.clientHeight || tela.height;
    /** @type {Set<string> | null} */
    const alvo = soNaTela ? new Set() : null;
    labelsRef.current.forEach((entry, id) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of entry.ring || []) {
        const pt = map.project([p.lng, p.lat]);
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
      if (alvo) {
        // fora da tela (com 1/4 de folga): fica como está até o moveend
        if (!Number.isFinite(minX) || maxX < -larg / 4 || minX > larg * 1.25 || maxY < -alt / 4 || minY > alt * 1.25) return;
        alvo.add(id);
      }
      if (Number.isFinite(minX)) areas.set(id, { x: minX, y: minY, w: maxX - minX, h: maxY - minY });
    });
    labelsRef.current.forEach((entry, id) => {
      if (!alvo || alvo.has(id)) entry.el.style.visibility = "hidden"; // mede sem pintar
    });

    // Ícones de lote são obstáculos dos nomes (D-PROD-126). Desenhados pelo mapa, não há elemento para medir: a caixa
    // é o ponto do pasto na tela + o deslocamento e o tamanho da imagem (D-PROD-349), na mesma origem dos nomes.
    // `dono`: o ícone do lote da própria área não conta contra o nome dela.
    const origem = tela.getBoundingClientRect?.() || { left: 0, top: 0 };
    /** @type {Array<{ x: number, y: number, w: number, h: number, dono: string }>} */
    const obstaculosLotes = [];
    lotesRef.current.forEach((lote, id) => {
      if (alvo && !alvo.has(id)) return;
      const c = caixaDoLote(map.project(lote.item.lngLat), labelsRef.current.has(id), lote.tamanho);
      obstaculosLotes.push({ x: c.x + origem.left, y: c.y + origem.top, w: c.w, h: c.h, dono: id });
    });

    // mede cada nível já na posição final; o nome é medido sozinho (sem o "ha"
    // por perto, que alargaria a caixa)
    aplicar("tudo");
    const comTudo = medir();
    aplicar("nome");
    const soNome = medir();
    const itens = [];
    areas.forEach((area, id) => {
      const tudo = comTudo.rotulos.get(id);
      const nome = soNome.rotulos.get(id);
      if (tudo && nome) itens.push({ id, area, tudo, nome });
    });
    const modo = escolherModoRotulos(itens, { tudo: comTudo.obstaculos, nome: soNome.obstaculos });
    aplicar(modo);
    const zoom = map.getZoom();
    // D-PROD-347: primeiro LER todos (um cálculo de página só), depois ESCREVER todos. Ler e escrever alternados, um
    // nome por vez, recalculava a página inteira a cada nome (centenas de vezes por revisão) e travava o zoom.
    labelsRef.current.forEach((entry, id) => {
      if (alvo && !alvo.has(id)) return;
      // tamanho do texto sem escala e a folga do ponto na tela, neste zoom
      const t = entry.corpo.getBoundingClientRect(); // ainda sem escala (aplicar)
      entry.tam = { w: t.width, h: t.height };
      const pf = entry.pf;
      entry.raio0 = pf ? Math.abs(map.project([pf.lng, pf.lat + pf.folga]).y - map.project([pf.lng, pf.lat]).y) : null;
      entry.z0 = zoom;
    });
    labelsRef.current.forEach((entry, id) => {
      if (alvo && !alvo.has(id)) return;
      escalarNome(entry, zoom);
      entry.el.style.visibility = "visible";
      entry.el.dataset.rotulo = modo;
    });
  };

  /**
   * Nome do tamanho do pasto (D-PROD-130): a folga do ponto cresce/encolhe com o
   * zoom (×2 por nível); o nome acompanha a cada quadro, para não sobrar para
   * fora do polígono. O ícone do lote não é tocado.
   */
  const escalarNome = (/** @type {any} */ entry, /** @type {number} */ zoom) => {
    if (!entry?.corpo || !entry.tam) return;
    const raio = entry.raio0 ? entry.raio0 * Math.pow(2, zoom - entry.z0) : null;
    const s = escalaRotulo(entry.tam.w, entry.tam.h, raio);
    entry.corpo.style.transform = s < 1 ? `${entry.base || ""} scale(${s})`.trim() : entry.base || "";
  };

  /**
   * Revisão do nível durante o zoom (D-PROD-129), no máximo a cada 120 ms e só nos pastos que estão na tela
   * (D-PROD-347); o `moveend` revê todos.
   */
  const ultimoArrumarRef = useRef(0);
  const arrumarDuranteZoom = () => {
    const agora = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (agora - ultimoArrumarRef.current < 120) return;
    ultimoArrumarRef.current = agora;
    arrumarRotulos({ soNaTela: true });
  };

  const agendarArrumar = () => {
    const map = getMap();
    if (!map) return;
    if (!arrumarRef.current) {
      const handler = () => agendarArrumar();
      arrumarRef.current = { handler, quadro: 0 };
      map.on("moveend", handler);
    }
    cancelAnimationFrame(arrumarRef.current.quadro);
    arrumarRef.current.quadro = requestAnimationFrame(() => arrumarRotulos());
  };

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

    // D-PROD-129: durante o zoom (cada quadro) a fonte acompanha suave e o
    // nível do nome (sigla/nome/ha) é revisto algumas vezes por segundo — não
    // só no fim —, para o nome não ficar maior que o pasto enquanto ele encolhe.
    if (!labelZoomHandlerRef.current) {
      const h = () => {
        const z = map.getZoom();
        labelsRef.current.forEach((entry) => {
          aplicarFonte(entry);
          escalarNome(entry, z);
        });
        arrumarDuranteZoom();
      };
      labelZoomHandlerRef.current = h;
      map.on("zoom", h);
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
        el.dataset.area = id;
        el.style.cssText =
          "pointer-events:none;color:#fff;text-align:center;white-space:nowrap;line-height:1.15;font-family:Inter,Arial,sans-serif;";
        const titulo = document.createElement("div");
        titulo.style.fontWeight = "700";
        const ha = document.createElement("div");
        ha.style.opacity = "0.95";
        const extra = document.createElement("div");
        extra.style.cssText = "font-weight:600;color:#fef08a;";
        // `corpo` leva o texto; centralizar sem lote é CSS (D-PROD-128).
        const corpo = document.createElement("div");
        corpo.className = "mg-area-label__corpo";
        corpo.append(titulo, ha, extra);
        el.append(corpo);
        const marker = new maplibregl.Marker({ element: el, anchor: "top", offset: [0, 2] }).setLngLat([centro.lng, centro.lat]).addTo(map);
        entry = { el, corpo, marker, titulo, ha, extra };
        labelsRef.current.set(id, entry);
      } else {
        entry.marker.setLngLat([centro.lng, centro.lat]);
      }
      entry.nome = area.nome || "";
      entry.sigla = siglaDaArea(area);
      entry.titulo.textContent = entry.nome;
      entry.ha.textContent = haText || "";
      entry.ha.style.display = haText ? "block" : "none";
      entry.extra.textContent = extraText || "";
      entry.extra.style.display = extraText ? "block" : "none";
      entry.temHa = Boolean(haText);
      entry.temExtra = Boolean(extraText);
      const chaveRing = JSON.stringify(area?.coordenadas?.coords || null);
      if (entry.chaveRing !== chaveRing) {
        entry.chaveRing = chaveRing;
        entry.ring = parseVertices(area?.coordenadas?.coords);
        entry.pf = pontoEFolga(entry.ring);
      }
      aplicarFonte(entry);
    }
    agendarArrumar();
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
        if (haLoteNoPonto(map, e.point)) return;
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
        // Nível no marcador (D-PROD-178): texto do SSOT no title/aria-label e selo.
        const { titulo, selo, farol } = descreverMarcadorSuplementacao(ponto);
        const baseSize = (categoria.includes("COCHO") || categoria.includes("DEPOSITO")) ? 36 : 40;
        const corpoChave = JSON.stringify([iconUrl, baseSize, cor]);
        const key = prefix + ponto.id;
        const ref = { ponto };
        itens.push({
          key,
          lngLat: [c.lng, c.lat],
          // Título e selo entram no diff: quando o nível muda (virada do dia,
          // lançamento, estoque) o MESMO marcador acompanha.
          estado: JSON.stringify([c.lat, c.lng, iconUrl, categoria, titulo, selo?.tipo ?? null, farol?.cor ?? null]),
          criar: () => {
            const entry = criarMarcadorClicavel({ iconUrl, baseSize, cor, titulo }, () => {
              const p = markersRef.current.get(key)?.ultimo?.ref?.ponto || ponto;
              onClick?.(p);
            });
            entry.marker.getElement().style.zIndex = "500";
            entry.corpoChave = corpoChave;
            aplicarTextoESeloSuplementacao(entry, titulo, selo);
            aplicarFarolSuplementacao(entry, farol);
            return entry;
          },
          atualizar: (entry) => {
            // Só o que mudou: trocar o <img> sem necessidade faz o ícone piscar.
            if (entry.corpoChave !== corpoChave) {
              aplicarCorpo(entry.el, { iconUrl, baseSize, cor });
              entry.corpoChave = corpoChave;
            }
            aplicarTextoESeloSuplementacao(entry, titulo, selo);
            aplicarFarolSuplementacao(entry, farol);
          },
          ref,
        });
      }
    }
    syncGrupo(prefix, itens);
  }, [mapInstanceRef]);

  // ─── Lotes (agrupados por área) — desenhados pelo mapa (D-PROD-349) ───

  /**
   * Publica a fonte dos lotes. `comRotulo` (o pasto tem nome embaixo do ícone) vem dos rótulos: muda o
   * `icon-offset` sem tocar em imagem. Só chama `setData` quando algo mudou (lotes ou quais têm nome).
   */
  const publicarLotes = () => {
    const map = getMap();
    if (!map) return;
    const itens = [];
    let comNome = "";
    lotesRef.current.forEach((l, areaId) => {
      const comRotulo = labelsRef.current.has(areaId);
      if (comRotulo) comNome += `${areaId},`;
      itens.push({ ...l.item, comRotulo });
    });
    const chave = `${lotesConteudoRef.current}|${comNome}`;
    if (chave === lotesPublicadoRef.current) return;
    lotesPublicadoRef.current = chave;
    const fc = colecaoLotes(itens);
    dataRef.current.lotes = fc;
    setSourceData(map, MG_SOURCE_IDS.LOTES, fc);
  };

  /** Clique, arrastar e imagens que faltam após troca de estilo: ligados uma vez por mapa. */
  const ligarLotes = (/** @type {any} */ map) => {
    if (lotesHandlersRef.current) return;
    const pr = pixelRatioRef.current;
    const interacao = ligarInteracaoLotes(map, {
      lote: (areaId) => {
        const l = lotesRef.current.get(areaId);
        if (!l) return null;
        return { areaId, lngLat: l.item.lngLat, comRotulo: labelsRef.current.has(areaId), imagem: l.item.imagem, ident: l.item.ident, nome: l.item.nome };
      },
      podeArrastar: () => lotesCallbacksRef.current.canDragLotes,
      aoClicar: (areaId) => {
        const l = lotesRef.current.get(areaId);
        if (l) lotesCallbacksRef.current.onClickLotes?.(l.lotesNaArea);
      },
      // Como o `dragend` do marcador antigo: posição solta, lotes do pasto, id do pasto e todas as áreas.
      aoSoltar: (lngLat, areaId) => {
        const l = lotesRef.current.get(areaId);
        if (l) lotesCallbacksRef.current.onDragLotes?.(lngLat, l.lotesNaArea, areaId, l.areas);
      },
      criarMarcador: (el, offset) => new maplibregl.Marker({ element: el, anchor: "center", offset }),
      pixelRatio: pr,
    });
    const desligarImagens = ligarImagensFaltando(map, pr);
    lotesHandlersRef.current = {
      off: () => {
        interacao.off();
        desligarImagens();
      },
    };
  };

  // `categoriasManejo`: Categorias de Manejo da empresa (cache do mapa). O ícone
  // do lote sai delas, pelo código (D-PROD-191); não há mais ícone de Lote por upload.
  // Devolve a promessa de quando os lotes estão no mapa (imagens novas são desenhadas antes de publicar).
  const syncLotes = useCallback((lotesFiltrados, areas, show, categoriasManejo, onClickLotes, onDragLotes, canDragLotes = true, blinkAlerts = false) => {
    const map = getMap();
    if (!map) return Promise.resolve();
    ensureMgLayers(map);
    lotesCallbacksRef.current = { onClickLotes, onDragLotes, canDragLotes: !!canDragLotes };
    ligarLotes(map);
    const pr = pixelRatioRef.current;
    const porArea = {};
    if (show) {
      for (const lote of lotesFiltrados) {
        if (!lote.area_atual_id) continue;
        (porArea[lote.area_atual_id] ||= []).push(lote);
      }
    }
    /** @type {Map<string, any>} */
    const novos = new Map();
    /** @type {import('@/lib/maplibre/lotesNoMapa.js').PedidoImagem[]} */
    const pedidos = [];
    for (const [areaId, lotesNaArea] of Object.entries(porArea)) {
      const area = areas.find((a) => a.id === areaId);
      const centro = area ? centroideArea(area) : null;
      if (!centro) continue;
      const totalCabecas = lotesNaArea.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);
      const totalAlertas = lotesNaArea.reduce((s, l) => s + (l.alertas?.length || 0), 0);
      // Sempre há figura (D-PROD-191): `iconUrl` é a data URL do SVG do marcador; `chave` identifica o desenho.
      const { iconUrl, chave } = resolverIconeLote(lotesNaArea, categoriasManejo);
      const imagem = pedidoImagemLote({ desenho: chave, iconUrl, cabecas: totalCabecas, pixelRatio: pr });
      pedidos.push(imagem);
      const ident = identificadoresDoLote(lotesNaArea)[0] || null;
      const pedidoIdent = ident ? pedidoImagemIdent(ident, pr) : null;
      if (pedidoIdent) pedidos.push(pedidoIdent);
      novos.set(String(areaId), {
        item: {
          areaId: String(areaId),
          lngLat: /** @type {[number, number]} */ ([centro.lng, centro.lat]),
          imagem: imagem.chave,
          ident: pedidoIdent?.chave ?? null,
          alerta: totalAlertas > 0,
          // Alerta pisca o identificador (D-PROD-125); sem identificador não há o que piscar.
          piscar: Boolean(blinkAlerts) && totalAlertas > 0 && Boolean(pedidoIdent),
          nome: area.nome || "",
          cabecas: totalCabecas,
          desenho: chave,
        },
        lotesNaArea,
        areas,
      });
    }
    const seq = ++lotesSeqRef.current;
    const aplicar = () => {
      const m = getMap();
      if (seq !== lotesSeqRef.current || !m) return;
      registrarImagens(m, chavesImagensLotes(novos), pr);
      novos.forEach((l) => {
        const r = imagemPronta(l.item.imagem, pr);
        l.tamanho = r ? { w: r.w, h: r.h } : TAMANHO_PADRAO_LOTE;
      });
      lotesRef.current = novos;
      lotesConteudoRef.current = JSON.stringify([...novos.values()].map((l) => l.item));
      publicarLotes();
      piscaRef.current?.atualizar([...novos.values()].some((l) => l.item.piscar));
      // Os ícones de lote são obstáculos para os rótulos (D-PROD-126).
      agendarArrumar();
    };
    const espera = garantirImagens(pedidos, pr);
    if (!espera) {
      aplicar();
      return Promise.resolve();
    }
    return espera.then(aplicar);
  }, [mapInstanceRef]);

  // ─── Tarefas ───
  const syncTarefas = useCallback((tarefasMapa, areas, iconesConfig, onClickTarefa, hoje) => {
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
      const urgente = normalizarPrioridadeTarefa(t.prioridade) === "Urgente";
      itens.push({
        key,
        lngLat: [pos.lng, pos.lat],
        estado: JSON.stringify([pos.lat, pos.lng, t.titulo, t.prioridade, t.status, t.data_prevista, hoje, iconUrl]),
        ref,
        criar: () => {
          const entry = criarMarcadorClicavel({ iconUrl, baseSize: 40, cor, titulo: t.titulo }, () => {
            onClickTarefa?.(markersRef.current.get(key)?.ultimo?.ref?.tarefa || t);
          });
          aplicarIndicadorTarefa(entry.el, t, hoje);
          entry.marker.getElement().style.zIndex = urgente ? "3000" : "2500";
          return entry;
        },
        atualizar: (entry) => {
          entry.el.title = String(t.titulo || "");
          entry.marker.getElement().style.zIndex = urgente ? "3000" : "2500";
          aplicarCorpo(entry.el, { iconUrl, baseSize: 40, cor });
          aplicarIndicadorTarefa(entry.el, t, hoje);
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
    // D-PROD-302: o círculo mostra a precisão REAL da leitura do GPS (antes era fixo em 20 m).
    const precisao = Number(/** @type {any} */ (userLocation)?.accuracy);
    const raio = Number.isFinite(precisao) && precisao > 0 ? Math.min(Math.max(precisao, 3), 500) : 20;
    const fc = pos ? buildAccuracyCircleCollection(pos, raio) : { type: "FeatureCollection", features: [] };
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

  /** Há área de negócio (ou lote em cima dela) sob o ponto (para o clique geral do mapa não duplicar o da área). */
  const hitArea = useCallback((point) => {
    const map = getMap();
    if (map && haLoteNoPonto(map, point)) return true;
    if (!map || !map.getLayer(MG_LAYER_IDS.AREAS_FILL)) return false;
    try {
      return map.queryRenderedFeatures(point, { layers: [MG_LAYER_IDS.AREAS_FILL] }).length > 0;
    } catch {
      return false;
    }
  }, [mapInstanceRef]);

  return { clearAll, ensureLayers, hitArea, syncAreas, syncLabels, syncPontos, syncLinhas, syncPontosSuplementacao, syncLotes, syncTarefas, syncUserLocation, setEstiloPasto };
}
