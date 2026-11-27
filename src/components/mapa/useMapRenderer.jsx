/*
 * GUIA DE EDIÇÃO — MARCADORES DO MAPA: lotes em syncLotes; cochos, pontos e tarefas em syncPontosSuplementacao, syncPontos e
 * syncTarefas; rótulos em syncLabels.
 * Lotes desenhados pelo mapa (D-PROD-349): posição, contagem, identificador, piscar e arrastar em src/lib/maplibre/lotesNoMapa.js.
 * Cochos, pontos e tarefas desenhados pelo mapa (D-PROD-352): tamanhos, selo, farol, indicador e ordem em src/lib/maplibre/pontosNoMapa.js.
 * Ícone do lote (D-PROD-191): o desenho, a largura (LARGURA_MARCADOR_PX) e a altura do número de cabeças (CONTAGEM_TOPO_PCT) vêm do código, em src/assets/icones/lotes.
 * Índice completo: docs/design/GUIA-MAPA-E-ICONES.md
 */

import { indicadorTarefa, tituloDoMarcadorTarefa } from "@/lib/tarefas/marcador";
import { normalizarPrioridadeTarefa } from "@/lib/tarefas/prioridade";
import { urlIconeTarefa } from "@/assets/icones/tarefas";
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
  podarImagens,
  registrarImagens,
} from "@/lib/maplibre/lotesNoMapa.js";
import {
  PONTOS_LAYER_ID,
  PONTOS_SOURCE_ID,
  SUPL_LAYER_ID,
  SUPL_SOURCE_ID,
  TAMANHO_PONTO_PX,
  TAMANHO_SUPL_PX,
  TAMANHO_TAREFA_PX,
  TAREFAS_LAYER_ID,
  TAREFAS_SOURCE_ID,
  avisarFalhaPonto,
  colecaoPontos,
  haPontoNoPonto,
  haTarefaNoPonto,
  imagemDoGrupo,
  ligarImagensFaltandoPontos,
  ligarInteracaoPontos,
  pedidosImagemPonto,
  registrarImagensPontos,
} from "@/lib/maplibre/pontosNoMapa.js";

/**
 * Renderizador incremental do Mapa Geral sobre MapLibre (D-PROD-65).
 *
 * Mesmo contrato público do renderer Google anterior (`syncAreas`, `syncLabels`,
 * `syncPontos`, `syncLinhas`, `syncPontosSuplementacao`, `syncLotes`,
 * `syncTarefas`, `syncUserLocation`, `clearAll`), para que `MapaGeral` mantenha
 * filtros, permissões, painéis e ações. Áreas/linhas viram GeoJSON (estilo SSOT
 * com o editor); os nomes das áreas e a localização continuam DOM, sempre com
 * `textContent` e cleanup explícito.
 *
 * Lotes (D-PROD-349): desenhados pelo próprio mapa — fonte GeoJSON + camadas
 * `symbol` com a imagem da figura e a contagem já escrita (`lotesNoMapa.js`).
 * O ícone vem do código (D-PROD-191): `resolverIconeLote` monta a figura pela
 * Categoria de Manejo de cada posição do pasto e sempre devolve figura; a
 * `chave` do desenho vai na fonte (`desenho`) e na chave da imagem.
 *
 * Cochos/depósitos, pontos de referência (bebedouro incluído) e tarefas (D-PROD-352): também desenhados pelo mapa,
 * cada grupo numa fonte e numa camada `symbol` (`pontosNoMapa.js`): a figura com o selo e o farol do cocho ou o
 * indicador da tarefa já pintados na imagem; o clique chama os mesmos callbacks de antes.
 */

/** Os três grupos de pontos desenhados pelo mapa (D-PROD-352): fonte, camada e prefixo das imagens. */
const GRUPOS_PONTOS = Object.freeze({
  supl: Object.freeze({ fonte: SUPL_SOURCE_ID, camada: SUPL_LAYER_ID, prefixo: "mg-supl" }),
  pontos: Object.freeze({ fonte: PONTOS_SOURCE_ID, camada: PONTOS_LAYER_ID, prefixo: "mg-ponto" }),
  tarefas: Object.freeze({ fonte: TAREFAS_SOURCE_ID, camada: TAREFAS_LAYER_ID, prefixo: "mg-tarefa" }),
});
/** @typedef {keyof typeof GRUPOS_PONTOS} NomeGrupo */
/** @type {Record<string, NomeGrupo>} */
const GRUPO_DA_CAMADA = { [SUPL_LAYER_ID]: "supl", [PONTOS_LAYER_ID]: "pontos", [TAREFAS_LAYER_ID]: "tarefas" };
/** @type {NomeGrupo[]} */
const NOMES_GRUPOS = ["supl", "pontos", "tarefas"];

/**
 * Estado de um grupo: o que está na fonte (por id: o item publicado e o objeto do app, para o clique entregar o mais
 * novo), as imagens em uso, a ordem das chamadas (`seq`), o último conteúdo publicado e os últimos argumentos.
 * @typedef {{ seq: number, porId: Map<string, { item: import('@/lib/maplibre/pontosNoMapa.js').ItemPonto, ref: any }>, emUso: string[], publicado: string, args: any[] | null, onClick: null | ((ref: any, item: import('@/lib/maplibre/pontosNoMapa.js').ItemPonto) => void) }} GrupoPontos
 */
/** Quanto um grupo espera as imagens antes de publicar com a reserva no que faltar (ms): o cache sai na hora, uma
 * figura remota lenta não segura o grupo (D-PROD-352). */
const MS_ESPERA_IMAGENS = 250;
/** @returns {GrupoPontos} */
const novoGrupo = () => ({ seq: 0, porId: new Map(), emUso: [], publicado: "", args: null, onClick: null });

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
  const dataRef = useRef(/** @type {{ areas: any, linhas: any, user: any, lotes: any, supl: any, pontos: any, tarefas: any }} */ ({ areas: null, linhas: null, user: null, lotes: null, supl: null, pontos: null, tarefas: null }));
  const labelZoomHandlerRef = useRef(/** @type {null | (() => void)} */ (null));
  const arrumarRef = useRef(/** @type {null | { handler: () => void, quadro: number }} */ (null));
  /**
   * Lotes no mapa (D-PROD-349), por pasto: o que vai na fonte (`item`), os lotes e as áreas para os callbacks e o
   * tamanho do ícone (obstáculo dos nomes).
   * @type {import('react').MutableRefObject<Map<string, { item: Omit<import('@/lib/maplibre/lotesNoMapa.js').ItemLote, 'comRotulo'>, lotesNaArea: any[], areas: any[], tamanho: { w: number, h: number } }>>}
   */
  const lotesRef = useRef(new Map());
  const lotesCallbacksRef = useRef(/** @type {{ onClickLotes: any, onDragLotes: any, canDragLotes: boolean }} */ ({ onClickLotes: null, onDragLotes: null, canDragLotes: false }));
  const lotesHandlersRef = useRef(/** @type {null | { off: () => void, acabouDeArrastar?: () => boolean }} */ (null));
  const lotesSeqRef = useRef(0);
  const lotesConteudoRef = useRef("");
  const lotesPublicadoRef = useRef("");
  const pixelRatioRef = useRef(pixelRatioDaTela());
  /** Últimos argumentos de `syncLotes`: refeitos quando a densidade da tela muda (outro monitor, zoom do navegador). */
  const lotesArgsRef = useRef(/** @type {null | any[]} */ (null));
  const syncLotesRef = useRef(/** @type {null | ((...a: any[]) => Promise<void>)} */ (null));
  const piscaRef = useRef(/** @type {null | ReturnType<typeof criarPiscaIdent>} */ (null));
  if (!piscaRef.current) piscaRef.current = criarPiscaIdent(() => mapInstanceRef.current);
  /** Cochos, pontos e tarefas desenhados pelo mapa (D-PROD-352): um estado por grupo. */
  const gruposRef = useRef(/** @type {Record<NomeGrupo, GrupoPontos>} */ ({ supl: novoGrupo(), pontos: novoGrupo(), tarefas: novoGrupo() }));
  const pontosHandlersRef = useRef(/** @type {null | { off: () => void }} */ (null));
  /** `resize` (densidade da tela nova): um só ouvinte refaz lotes e pontos. */
  const densidadeRef = useRef(/** @type {null | { off: () => void }} */ (null));
  /** As funções de sincronizar de cada grupo (refeitas quando a densidade da tela muda). */
  const syncGruposRef = useRef(/** @type {Partial<Record<NomeGrupo, (...a: any[]) => Promise<void>>>} */ ({}));

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
    // Estilo novo (satélite ↔ mapa) vem sem as imagens dos lotes e dos pontos: repõe antes dos dados (D-PROD-349/350).
    registrarImagens(map, chavesImagensLotes(), pixelRatioRef.current);
    registrarImagensPontos(map, NOMES_GRUPOS.flatMap((n) => gruposRef.current[n].emUso), pixelRatioRef.current);
    const d = dataRef.current;
    if (d.areas) setSourceData(map, MG_SOURCE_IDS.AREAS, d.areas);
    if (d.linhas) setSourceData(map, MG_SOURCE_IDS.LINHAS, d.linhas);
    if (d.user) setSourceData(map, MG_SOURCE_IDS.USER, d.user);
    if (d.lotes) setSourceData(map, MG_SOURCE_IDS.LOTES, d.lotes);
    for (const n of NOMES_GRUPOS) if (d[n]) setSourceData(map, GRUPOS_PONTOS[n].fonte, d[n]);
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
    // cochos, pontos e tarefas (D-PROD-352): imagens que ainda chegam não publicam mais nada
    pontosHandlersRef.current?.off();
    pontosHandlersRef.current = null;
    densidadeRef.current?.off();
    densidadeRef.current = null;
    for (const n of NOMES_GRUPOS) {
      const g = gruposRef.current[n];
      gruposRef.current[n] = { ...novoGrupo(), seq: g.seq + 1 };
      setSourceData(/** @type {any} */ (mapInstanceRef.current), GRUPOS_PONTOS[n].fonte, { type: "FeatureCollection", features: [] });
    }
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
    dataRef.current = { areas: null, linhas: null, user: null, lotes: null, supl: null, pontos: null, tarefas: null };
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
        // O clique no ícone do lote (D-PROD-349) ou de um cocho, ponto ou tarefa (D-PROD-352) é dele, não da área por baixo.
        if (haLoteNoPonto(map, e.point) || haPontoNoPonto(map, e.point)) return;
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
        if (alvo && !alvo.has(id)) return;
        // D-PROD-351 (revisão Codex): durante o zoom a letra fica no tamanho antigo e o nome aparece ampliado na razão
        // da fonte (`escalarNome`); a colisão mede a caixa como ela aparece, ampliada a partir da mesma origem
        // (topo, com lote embaixo; centro, sem lote). No fim do zoom a letra é a real e a razão é 1.
        const c = caixa(entry.corpo);
        const fr = alvo && entry.fonte0 ? fontesRotuloPorZoom(zoomAgora).nome / entry.fonte0 : 1;
        if (fr === 1) {
          rotulos.set(id, c);
          return;
        }
        const w = c.w * fr, h = c.h * fr;
        const doTopo = entry.base === "";
        rotulos.set(id, { x: c.x - (w - c.w) / 2, y: doTopo ? c.y : c.y - (h - c.h) / 2, w, h });
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
    // D-PROD-351: o `getBoundingClientRect` do canvas antes de qualquer escrita (sem recalcular a página à toa).
    const origem = tela.getBoundingClientRect?.() || { left: 0, top: 0 };
    const zoomAgora = map.getZoom();
    labelsRef.current.forEach((entry, id) => {
      if (alvo && !alvo.has(id)) return;
      entry.el.style.visibility = "hidden"; // mede sem pintar
      // fim do zoom: a letra assume o tamanho real deste zoom (durante o zoom, só ampliação; ver escalarNome)
      if (!alvo) aplicarFonteRotulo(entry, zoomAgora);
    });

    // Ícones de lote são obstáculos dos nomes (D-PROD-126). Desenhados pelo mapa, não há elemento para medir: a caixa
    // é o ponto do pasto na tela + o deslocamento e o tamanho da imagem (D-PROD-349), na mesma origem dos nomes.
    // `dono`: o ícone do lote da própria área não conta contra o nome dela.
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
   * Tamanho real da letra do nome no zoom (D-PROD-129). Só no fim do zoom e ao criar/atualizar o nome; durante o zoom
   * `escalarNome` amplia na razão `fontesRotuloPorZoom(z).nome / fonte0` (D-PROD-351).
   * @param {any} entry @param {number} zoom
   */
  const aplicarFonteRotulo = (entry, zoom) => {
    const f = fontesRotuloPorZoom(zoom);
    if (entry.fonte0 === f.nome) return;
    entry.titulo.style.fontSize = `${f.nome}px`;
    entry.ha.style.fontSize = `${f.ha}px`;
    entry.extra.style.fontSize = `${f.ha}px`;
    entry.fonte0 = f.nome;
  };

  /**
   * Nome do tamanho do pasto (D-PROD-130): a folga do ponto cresce/encolhe com o
   * zoom (×2 por nível); o nome acompanha a cada quadro, para não sobrar para
   * fora do polígono. O ícone do lote não é tocado.
   */
  const escalarNome = (/** @type {any} */ entry, /** @type {number} */ zoom) => {
    if (!entry?.corpo || !entry.tam) return;
    const raio = entry.raio0 ? entry.raio0 * Math.pow(2, zoom - entry.z0) : null;
    // D-PROD-351: durante o zoom a letra não muda de tamanho de verdade (isso refazia o texto de todos os nomes a cada
    // quadro): o nome já pronto é ampliado/reduzido na razão da fonte do D-PROD-129 (`fr`), e só então cabe no pasto.
    const fr = entry.fonte0 ? fontesRotuloPorZoom(zoom).nome / entry.fonte0 : 1;
    const s = fr * escalaRotulo(entry.tam.w * fr, entry.tam.h * fr, raio);
    entry.corpo.style.transform = Math.abs(s - 1) > 0.001 ? `${entry.base || ""} scale(${s})`.trim() : entry.base || "";
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

    const aplicarFonte = (entry) => aplicarFonteRotulo(entry, map.getZoom());

    // D-PROD-129: durante o zoom (cada quadro) a fonte acompanha suave e o
    // nível do nome (sigla/nome/ha) é revisto algumas vezes por segundo — não
    // só no fim —, para o nome não ficar maior que o pasto enquanto ele encolhe.
    if (!labelZoomHandlerRef.current) {
      const h = () => {
        const z = map.getZoom();
        labelsRef.current.forEach((entry) => {
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

  // ─── Cochos, pontos e tarefas desenhados pelo mapa (D-PROD-352) ───

  /** Um só ouvinte de `resize`: densidade da tela nova refaz as imagens dos lotes e dos pontos nela. */
  const ligarDensidade = (/** @type {any} */ map) => {
    if (densidadeRef.current) return;
    const aoRedimensionar = () => {
      const novo = pixelRatioDaTela();
      if (novo === pixelRatioRef.current) return;
      pixelRatioRef.current = novo;
      if (lotesArgsRef.current) syncLotesRef.current?.(...lotesArgsRef.current);
      for (const n of NOMES_GRUPOS) {
        const args = gruposRef.current[n].args;
        if (args) syncGruposRef.current[n]?.(...args);
      }
    };
    map.on("resize", aoRedimensionar);
    densidadeRef.current = {
      off: () => {
        try {
          map.off("resize", aoRedimensionar);
        } catch {
          /* mapa já removido */
        }
      },
    };
  };

  /** Clique, cursor/título e imagens que faltam após troca de estilo dos pontos: ligados uma vez por mapa. */
  const ligarPontos = (/** @type {any} */ map) => {
    if (pontosHandlersRef.current) return;
    const doGrupo = (/** @type {string} */ camada, /** @type {string} */ id) => {
      const nome = GRUPO_DA_CAMADA[camada];
      return nome ? { g: gruposRef.current[nome], it: gruposRef.current[nome].porId.get(id) } : null;
    };
    const interacao = ligarInteracaoPontos(map, {
      aoClicar: (camada, id) => {
        const achado = doGrupo(camada, id);
        if (achado?.it) achado.g.onClick?.(achado.it.ref, achado.it.item);
      },
      titulo: (camada, id) => doGrupo(camada, id)?.it?.item.titulo || "",
      // o clique que vem ao soltar um lote arrastado não abre o ponto onde o dedo parou
      ignorarClique: () => Boolean(/** @type {any} */ (lotesHandlersRef.current)?.acabouDeArrastar?.()),
    });
    const desligarImagens = ligarImagensFaltandoPontos(map, () => pixelRatioRef.current);
    ligarDensidade(map);
    pontosHandlersRef.current = {
      off: () => {
        interacao.off();
        desligarImagens();
      },
    };
  };

  /**
   * Publica um grupo (D-PROD-352). O mapa id → objeto do app é trocado NA HORA (o clique entrega sempre o mais novo,
   * mesmo com imagens ainda por desenhar). Depois:
   *  1. as reservas (círculo da cor, sem rede) são desenhadas;
   *  2. espera as imagens no máximo MS_ESPERA_IMAGENS (as do cache saem na hora) e publica: o que ainda falta aparece
   *     com a reserva — uma figura remota lenta não segura o grupo;
   *  3. quando as imagens que faltavam chegam, publica de novo (a lista do que falta mudou) e o mapa troca a reserva.
   * Devolve a promessa de quando todas as imagens do grupo foram tentadas.
   * @param {NomeGrupo} nome
   * @param {Array<{ item: import('@/lib/maplibre/pontosNoMapa.js').ItemPonto, ref: any, pedidos: { imagem: import('@/lib/maplibre/lotesNoMapa.js').PedidoImagem, reserva: import('@/lib/maplibre/lotesNoMapa.js').PedidoImagem } }>} itens
   */
  const sincronizarGrupo = (nome, itens) => {
    const map = getMap();
    if (!map) return Promise.resolve();
    ensureMgLayers(map);
    ligarPontos(map);
    const g = gruposRef.current[nome];
    g.porId = new Map(itens.map((i) => [i.item.id, i]));
    const { fonte, prefixo } = GRUPOS_PONTOS[nome];
    const pr = pixelRatioRef.current;
    const seq = ++g.seq;
    const imagens = itens.map((i) => i.pedidos.imagem);
    const reservas = itens.map((i) => i.pedidos.reserva);
    const emUso = [...new Set([...imagens, ...reservas].map((p) => p.chave))];
    /** Meia largura/altura do ícone visível da imagem que o mapa vai mostrar (a figura ou a reserva). */
    const caixa = (/** @type {import('@/lib/maplibre/pontosNoMapa.js').ItemPonto} */ it) =>
      /** @type {any} */ (imagemPronta(it.imagem, pr) || imagemPronta(it.reserva, pr))?.corpo || null;
    const aplicar = () => {
      const m = getMap();
      if (seq !== g.seq || !m || gruposRef.current[nome] !== g) return;
      registrarImagensPontos(m, emUso, pr);
      // O que ainda não está pronto (pendente ou falhou) aparece com a reserva. Quando chegar, a lista muda e a fonte
      // é publicada de novo (o mapa só troca a reserva pela imagem ao refazer os dados).
      const faltando = emUso.filter((k) => !imagemPronta(k, pr));
      g.emUso = emUso;
      const fc = colecaoPontos(itens.map((i) => ({ ...i.item, caixa: caixa(i.item) })));
      const conteudo = JSON.stringify([fc.features, faltando]);
      if (conteudo !== g.publicado) {
        g.publicado = conteudo;
        dataRef.current[nome] = fc;
        setSourceData(m, fonte, fc);
      }
      podarImagens(m, new Set(emUso), pr, imagemDoGrupo(prefixo));
    };
    const esperaReservas = garantirImagens(reservas, pr, avisarFalhaPonto);
    const esperaImagens = garantirImagens(imagens, pr, avisarFalhaPonto);
    if (!esperaReservas && !esperaImagens) {
      aplicar();
      return Promise.resolve();
    }
    const prazo = () => new Promise((r) => setTimeout(r, MS_ESPERA_IMAGENS));
    return (esperaReservas || Promise.resolve())
      .then(() => (esperaImagens ? Promise.race([esperaImagens, prazo()]) : null))
      .then(() => {
        aplicar();
        return esperaImagens;
      })
      .then(() => {
        if (esperaImagens) aplicar();
      });
  };

  // ─── Pontos de referência (bebedouro incluído) ───
  const syncPontos = useCallback((pontos, show, iconesConfig, onClickPonto) => {
    const g = gruposRef.current.pontos;
    g.args = [pontos, show, iconesConfig, onClickPonto];
    // Sem callback, o popup de antes (nome e tipo).
    g.onClick = (p, item) => {
      if (typeof onClickPonto === "function") onClickPonto(p);
      else abrirPopup(item.lngLat, p.nome, p.tipo);
    };
    const pr = pixelRatioRef.current;
    const itens = [];
    if (show) {
      for (const ponto of pontos) {
        const c = parseVertex(ponto.coordenadas);
        if (!c) continue;
        const { iconUrl, cor } = resolverIconePonto(ponto, iconesConfig);
        const { imagem, reserva } = pedidosImagemPonto("mg-ponto", { urls: iconUrl ? [iconUrl] : [], base: TAMANHO_PONTO_PX, cor }, pr);
        itens.push({
          item: { id: String(ponto.id), lngLat: /** @type {[number, number]} */ ([c.lng, c.lat]), imagem: imagem.chave, reserva: reserva.chave, titulo: String(ponto.nome || "") },
          ref: ponto,
          pedidos: { imagem, reserva },
        });
      }
    }
    return sincronizarGrupo("pontos", itens);
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
        if (haLoteNoPonto(map, e.point) || haPontoNoPonto(map, e.point)) return;
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
    const g = gruposRef.current.supl;
    g.args = [pontosSupl, show, iconesConfig, onClick];
    g.onClick = (p) => onClick?.(p);
    const pr = pixelRatioRef.current;
    const itens = [];
    if (show) {
      for (const ponto of pontosSupl) {
        const c = parseVertex(ponto.coordenadas);
        if (!c) continue;
        const { iconUrl, cor, categoria } = resolverIconeSuplementacao(ponto, iconesConfig);
        // Nível no marcador (D-PROD-178/205): o texto do SSOT vai no título (fonte; título do canvas no mouse); o selo
        // e o farol, pintados na imagem. Nível, selo ou farol diferentes = imagem diferente no MESMO ponto da fonte.
        const { titulo, selo, farol } = descreverMarcadorSuplementacao(ponto);
        const base = (categoria.includes("COCHO") || categoria.includes("DEPOSITO")) ? TAMANHO_SUPL_PX : TAMANHO_PONTO_PX;
        const { imagem, reserva } = pedidosImagemPonto("mg-supl", { urls: iconUrl ? [iconUrl] : [], base, cor, selo, farol }, pr);
        itens.push({
          item: { id: String(ponto.id), lngLat: /** @type {[number, number]} */ ([c.lng, c.lat]), imagem: imagem.chave, reserva: reserva.chave, titulo },
          ref: ponto,
          pedidos: { imagem, reserva },
        });
      }
    }
    return sincronizarGrupo("supl", itens);
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
    const pr = () => pixelRatioRef.current;
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
      // uma tarefa por cima do lote (D-PROD-352): o toque é da tarefa
      coberto: (ponto) => haTarefaNoPonto(map, ponto),
    });
    const desligarImagens = ligarImagensFaltando(map, pr);
    // A densidade da tela mudou: imagens novas nessa densidade (mesmas chaves; `registrarImagens` troca as do mapa).
    ligarDensidade(map);
    lotesHandlersRef.current = {
      acabouDeArrastar: interacao.acabouDeArrastar,
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
    lotesArgsRef.current = [lotesFiltrados, areas, show, categoriasManejo, onClickLotes, onDragLotes, canDragLotes, blinkAlerts];
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
      const emUso = chavesImagensLotes(novos);
      registrarImagens(m, emUso, pr);
      novos.forEach((l) => {
        const r = imagemPronta(l.item.imagem, pr);
        l.tamanho = r ? { w: r.w, h: r.h } : TAMANHO_PADRAO_LOTE;
      });
      // Imagem que falhou: o lote aparece com a reserva. Quando ela vier numa próxima tentativa, a lista muda e a
      // fonte é publicada de novo (o mapa só troca a reserva pela imagem ao refazer os dados).
      const faltando = emUso.filter((k) => !imagemPronta(k, pr));
      lotesRef.current = novos;
      lotesConteudoRef.current = JSON.stringify([[...novos.values()].map((l) => l.item), faltando]);
      publicarLotes();
      // Depois de publicar: as imagens que nenhum lote usa mais saem do mapa e do cache.
      podarImagens(m, new Set(emUso), pr);
      piscaRef.current?.atualizar([...novos.values()].filter((l) => l.item.piscar).map((l) => l.item.areaId));
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
  syncLotesRef.current = syncLotes;

  // ─── Tarefas ───
  const syncTarefas = useCallback((tarefasMapa, areas, iconesConfig, onClickTarefa, hoje) => {
    const g = gruposRef.current.tarefas;
    g.args = [tarefasMapa, areas, iconesConfig, onClickTarefa, hoje];
    g.onClick = (t) => onClickTarefa?.(t);
    const pr = pixelRatioRef.current;
    const itens = [];
    for (const t of tarefasMapa) {
      let pos = parseVertex(t.coordenadas);
      if (!pos && t.area_id) {
        const area = areas.find((a) => a.id === t.area_id);
        pos = area ? centroideArea(area) : null;
      }
      if (!pos) continue;
      const { iconUrl, cor } = resolverIconeTarefa(t, iconesConfig);
      // Indicador do prazo pintado na imagem; o texto dele (prioridade, situação, prazo) é o título.
      const ind = indicadorTarefa(t, hoje);
      // Ícone enviado pela empresa que não carrega: o modelo local da prioridade (o `onerror` do marcador antigo).
      const { imagem, reserva } = pedidosImagemPonto(
        "mg-tarefa",
        { urls: [iconUrl, urlIconeTarefa(t.prioridade)], base: TAMANHO_TAREFA_PX, cor, indicador: { texto: ind.texto, cor: ind.cor } },
        pr
      );
      itens.push({
        item: {
          id: String(t.id),
          lngLat: /** @type {[number, number]} */ ([pos.lng, pos.lat]),
          imagem: imagem.chave,
          reserva: reserva.chave,
          titulo: tituloDoMarcadorTarefa(t, hoje),
          // Urgente por cima das outras tarefas (z-index 3000 × 2500 de antes)
          urgente: normalizarPrioridadeTarefa(t.prioridade) === "Urgente",
        },
        ref: t,
        pedidos: { imagem, reserva },
      });
    }
    return sincronizarGrupo("tarefas", itens);
  }, [mapInstanceRef]);
  syncGruposRef.current = { supl: syncPontosSuplementacao, pontos: syncPontos, tarefas: syncTarefas };

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

  /** Há ícone de lote sob o ponto (px do mapa)? O toque longo do Mapa Geral não começa em cima de um lote. */
  const hitLote = useCallback((point) => {
    const map = getMap();
    return Boolean(map) && haLoteNoPonto(map, point);
  }, [mapInstanceRef]);

  /**
   * Há cocho, ponto de referência ou tarefa sob o ponto (px do mapa)? O toque longo do Mapa Geral não começa em cima de
   * um deles (D-PROD-352).
   */
  const hitPonto = useCallback((point) => {
    const map = getMap();
    return Boolean(map) && haPontoNoPonto(map, point);
  }, [mapInstanceRef]);

  /** Há área de negócio (ou lote, cocho, ponto ou tarefa em cima dela) sob o ponto (o clique geral do mapa não duplica o da área). */
  const hitArea = useCallback((point) => {
    const map = getMap();
    if (map && (haLoteNoPonto(map, point) || haPontoNoPonto(map, point))) return true;
    if (!map || !map.getLayer(MG_LAYER_IDS.AREAS_FILL)) return false;
    try {
      return map.queryRenderedFeatures(point, { layers: [MG_LAYER_IDS.AREAS_FILL] }).length > 0;
    } catch {
      return false;
    }
  }, [mapInstanceRef]);

  return { clearAll, ensureLayers, hitArea, hitLote, hitPonto, syncAreas, syncLabels, syncPontos, syncLinhas, syncPontosSuplementacao, syncLotes, syncTarefas, syncUserLocation, setEstiloPasto };
}
