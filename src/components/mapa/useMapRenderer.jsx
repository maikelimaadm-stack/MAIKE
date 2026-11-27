/*
 * GUIA DE EDIÇÃO — MARCADORES DO MAPA: lotes em syncLotes; cochos, pontos e tarefas em syncPontosSuplementacao, syncPontos e
 * syncTarefas; nomes dos pastos em syncLabels (nível em arrumarNomes).
 * Lotes desenhados pelo mapa (D-PROD-349): posição, contagem, identificador, piscar e arrastar em src/lib/maplibre/lotesNoMapa.js.
 * Cochos, pontos e tarefas desenhados pelo mapa (D-PROD-353): tamanhos, selo, farol, indicador e ordem em src/lib/maplibre/pontosNoMapa.js.
 * Nomes dos pastos desenhados pelo mapa (D-PROD-354): letra, cores, tamanho por zoom e posição em src/lib/maplibre/nomesNoMapa.js.
 * Ícone do lote (D-PROD-191): o desenho, a largura (LARGURA_MARCADOR_PX) e a altura do número de cabeças (CONTAGEM_TOPO_PCT) vêm do código, em src/assets/icones/lotes.
 * Índice completo: docs/design/GUIA-MAPA-E-ICONES.md
 */

import { useRef, useCallback } from "react";
import { maplibregl, setSourceData } from "@/lib/maplibre/lifecycle.js";
import { itensDaSuplementacao, itensDasTarefas, itensDosLotes, itensDosPontos } from "@/lib/maplibre/itensDoMapaGeral.js";
import { parseVertex, parseVertices } from "@/lib/geografia/coords.js";
import { buildAccuracyCircleCollection } from "@/lib/maplibre/gpsCapture.js";
import {
  MG_LAYER_IDS,
  MG_SOURCE_IDS,
  buildMgAreasCollection,
  buildMgLinhasCollection,
  centroideArea,
  escolherModoRotulos,
  pontoEFolga,
  siglaDaArea,
  ensureMgLayers,
  aplicarEstiloPasto,
  textoHectares,
} from "@/lib/maplibre/mapaGeralRender.js";
import {
  TAMANHO_PADRAO_LOTE,
  caixaDoLote,
  colecaoLotes,
  criarPiscaIdent,
  garantirImagens,
  haLoteNoPonto,
  imagemPronta,
  ligarImagensFaltando,
  ligarInteracaoLotes,
  pixelRatioDaTela,
  podarImagens,
  registrarImagens,
} from "@/lib/maplibre/lotesNoMapa.js";
import {
  avisarFalhaNome,
  caixaDoNome,
  chaveImagemNome,
  colecaoNomes,
  ehImagemDeNome,
  esperarFonteDosNomes,
  ligarImagensFaltandoNomes,
  linhasDoNivel,
  medirLinhas,
  pedidoImagemNome,
  registrarImagensNomes,
  tamanhosAcertadosNoZoom,
  tamanhosPorZoom,
} from "@/lib/maplibre/nomesNoMapa.js";
import {
  PONTOS_LAYER_ID,
  PONTOS_SOURCE_ID,
  SUPL_LAYER_ID,
  SUPL_SOURCE_ID,
  TAREFAS_LAYER_ID,
  TAREFAS_SOURCE_ID,
  avisarFalhaPonto,
  colecaoPontos,
  haPontoNoPonto,
  haTarefaNoPonto,
  imagemDoGrupo,
  ligarImagensFaltandoPontos,
  ligarInteracaoPontos,
  registrarImagensPontos,
} from "@/lib/maplibre/pontosNoMapa.js";

/**
 * Renderizador incremental do Mapa Geral sobre MapLibre (D-PROD-65).
 *
 * Mesmo contrato público do renderer Google anterior (`syncAreas`, `syncLabels`,
 * `syncPontos`, `syncLinhas`, `syncPontosSuplementacao`, `syncLotes`,
 * `syncTarefas`, `syncUserLocation`, `clearAll`), para que `MapaGeral` mantenha
 * filtros, permissões, painéis e ações. Áreas/linhas viram GeoJSON (estilo SSOT
 * com o editor); só a localização do usuário continua DOM, com cleanup explícito.
 *
 * Lotes (D-PROD-349): desenhados pelo próprio mapa — fonte GeoJSON + camadas
 * `symbol` com a imagem da figura e a contagem já escrita (`lotesNoMapa.js`).
 * O ícone vem do código (D-PROD-191): `resolverIconeLote` monta a figura pela
 * Categoria de Manejo de cada posição do pasto e sempre devolve figura; a
 * `chave` do desenho vai na fonte (`desenho`) e na chave da imagem.
 *
 * Cochos/depósitos, pontos de referência (bebedouro incluído) e tarefas (D-PROD-353): também desenhados pelo mapa,
 * cada grupo numa fonte e numa camada `symbol` (`pontosNoMapa.js`): a figura com o selo e o farol do cocho ou o
 * indicador da tarefa já pintados na imagem; o clique chama os mesmos callbacks de antes.
 *
 * Nomes dos pastos (D-PROD-354): também desenhados pelo mapa — fonte GeoJSON + duas camadas `symbol` (sem lote, o nome
 * centrado no ponto; com lote, logo abaixo do ícone) com a imagem do texto (`nomesNoMapa.js`). O tamanho no zoom é o
 * `icon-size` da camada (paradas por pasto na fonte); o nível (nome + ha, nome, sigla) é escolhido sem tocar em
 * elemento nenhum, no fim do movimento e algumas vezes por segundo durante o zoom.
 */

/** Os três grupos de pontos desenhados pelo mapa (D-PROD-353): fonte, camada e prefixo das imagens. */
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
 * figura remota lenta não segura o grupo (D-PROD-353). */
const MS_ESPERA_IMAGENS = 250;
/** @returns {GrupoPontos} */
const novoGrupo = () => ({ seq: 0, porId: new Map(), emUso: [], publicado: "", args: null, onClick: null });

/*
 * Par ícone do lote (44 px) + nome embaixo, centrado no ponto da área, com alturas CONSTANTES (D-PROD-128): ícone 44 +
 * 2 de espaço + nome reservado de 26 px (nome + ha) = 72 px → ícone com o centro 14 px acima do ponto
 * (`OFFSET_LOTE_COM_NOME_PX`, o `icon-offset` da camada dos lotes quando `comRotulo`, D-PROD-349) e o nome começando
 * 10 px abaixo (`DESLOC_NOME_COM_LOTE_PX`, o `icon-translate` da camada dos nomes com lote, D-PROD-354).
 */

/** @type {import('@/lib/maplibre/nomesNoMapa.js').NivelNome[]} */
const NIVEIS_NOME = ["tudo", "nome", "sigla"];
/**
 * Um nível do nome de um pasto: as linhas, a chave da imagem, a medida na letra de 12 px e as paradas do `icon-size`.
 * @typedef {{ linhas: import('@/lib/maplibre/nomesNoMapa.js').LinhaNome[], chave: string, medida: import('@/lib/maplibre/nomesNoMapa.js').Medida, tamanhos: Record<string, number> | null }} NivelDoNome
 */
/**
 * O nome de um pasto: ponto, folga (D-PROD-130), caixa em graus (oeste/sul/leste/norte) e os três níveis.
 * @typedef {{ lngLat: [number, number], nome: string, pf: { lat: number, lng: number, folga: number } | null, caixa: { oeste: number, sul: number, leste: number, norte: number } | null, niveis: Record<import('@/lib/maplibre/nomesNoMapa.js').NivelNome, NivelDoNome> }} NomeNaArea
 */

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
  /** Nomes dos pastos (D-PROD-354), por área. @type {import('react').MutableRefObject<Map<string, NomeNaArea>>} */
  const nomesRef = useRef(new Map());
  /** Ponto, folga e caixa de cada área, refeitos só quando o contorno muda (o ponto mais de dentro é uma busca). */
  const geoNomesRef = useRef(/** @type {Map<string, { chaveRing: string, centro: { lat: number, lng: number } | null, pf: any, caixa: any }>} */ (new Map()));
  /** Nível publicado (o mesmo para todos), ordem das publicações e o último conteúdo publicado. */
  const nomesEstadoRef = useRef(/** @type {{ nivel: import('@/lib/maplibre/nomesNoMapa.js').NivelNome, seq: number, seqSync: number, publicado: string }} */ ({ nivel: "tudo", seq: 0, seqSync: 0, publicado: "" }));
  const nomesHandlersRef = useRef(/** @type {null | { off: () => void }} */ (null));
  /** Últimos argumentos de `syncLabels`: refeitos quando a densidade da tela muda. */
  const nomesArgsRef = useRef(/** @type {null | any[]} */ (null));
  const syncLabelsRef = useRef(/** @type {null | ((...a: any[]) => void)} */ (null));
  const popupRef = useRef(/** @type {import('maplibre-gl').Popup | null} */ (null));
  const areasHandlersRef = useRef(/** @type {null | { off: () => void }} */ (null));
  const linhasHandlersRef = useRef(/** @type {null | { off: () => void }} */ (null));
  const areasCallbacksRef = useRef({ onClick: null, onRightClick: null });
  const areasByIdRef = useRef(new Map());
  const linhasByIdRef = useRef(new Map());
  const dataRef = useRef(/** @type {{ areas: any, linhas: any, user: any, lotes: any, supl: any, pontos: any, tarefas: any, nomes: any }} */ ({ areas: null, linhas: null, user: null, lotes: null, supl: null, pontos: null, tarefas: null, nomes: null }));
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
  /** Cochos, pontos e tarefas desenhados pelo mapa (D-PROD-353): um estado por grupo. */
  const gruposRef = useRef(/** @type {Record<NomeGrupo, GrupoPontos>} */ ({ supl: novoGrupo(), pontos: novoGrupo(), tarefas: novoGrupo() }));
  const pontosHandlersRef = useRef(/** @type {null | { off: () => void }} */ (null));
  /** `resize` (densidade da tela nova): um só ouvinte refaz lotes, pontos e nomes. */
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
    registrarImagensNomes(map, chavesImagensNomes(), pixelRatioRef.current);
    const d = dataRef.current;
    if (d.areas) setSourceData(map, MG_SOURCE_IDS.AREAS, d.areas);
    if (d.linhas) setSourceData(map, MG_SOURCE_IDS.LINHAS, d.linhas);
    if (d.user) setSourceData(map, MG_SOURCE_IDS.USER, d.user);
    if (d.lotes) setSourceData(map, MG_SOURCE_IDS.LOTES, d.lotes);
    for (const n of NOMES_GRUPOS) if (d[n]) setSourceData(map, GRUPOS_PONTOS[n].fonte, d[n]);
    if (d.nomes) setSourceData(map, MG_SOURCE_IDS.NOMES, d.nomes);
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
    // cochos, pontos e tarefas (D-PROD-353): imagens que ainda chegam não publicam mais nada
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
    // nomes (D-PROD-354): imagens que ainda chegam não publicam mais nada
    nomesHandlersRef.current?.off();
    nomesHandlersRef.current = null;
    nomesRef.current = new Map();
    geoNomesRef.current = new Map();
    nomesArgsRef.current = null;
    {
      const est = nomesEstadoRef.current;
      nomesEstadoRef.current = { nivel: "tudo", seq: est.seq + 1, seqSync: est.seqSync + 1, publicado: "" };
    }
    setSourceData(/** @type {any} */ (mapInstanceRef.current), MG_SOURCE_IDS.NOMES, { type: "FeatureCollection", features: [] });
    popupRef.current?.remove();
    popupRef.current = null;
    areasHandlersRef.current?.off();
    areasHandlersRef.current = null;
    linhasHandlersRef.current?.off();
    linhasHandlersRef.current = null;
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
    dataRef.current = { areas: null, linhas: null, user: null, lotes: null, supl: null, pontos: null, tarefas: null, nomes: null };
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
        // O clique no ícone do lote (D-PROD-349) ou de um cocho, ponto ou tarefa (D-PROD-353) é dele, não da área por baixo.
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

  // ─── Nomes das áreas (nome + ha + extra) — desenhados pelo mapa (D-PROD-354) ───

  /** Todas as chaves de imagem dos nomes de agora, nos três níveis (a poda não tira o nível que não está na tela). */
  const chavesImagensNomes = () => {
    /** @type {string[]} */
    const chaves = [];
    nomesRef.current.forEach((n) => {
      for (const nivel of NIVEIS_NOME) if (n.niveis[nivel].linhas.length) chaves.push(n.niveis[nivel].chave);
    });
    return chaves;
  };

  /**
   * Publica os nomes num nível (o mesmo para todos, D-PROD-126). As imagens do nível são desenhadas antes (as do cache
   * saem na hora); só então a fonte muda, e só se algo mudou. Nada é refeito por quadro: o tamanho no zoom é o
   * `icon-size` da camada.
   * @param {import('@/lib/maplibre/nomesNoMapa.js').NivelNome} nivel
   */
  const publicarNomes = (nivel) => {
    const map = getMap();
    if (!map) return Promise.resolve();
    const est = nomesEstadoRef.current;
    const pr = pixelRatioRef.current;
    const zoom = map.getZoom();
    const seq = ++est.seq;
    /** @type {import('@/lib/maplibre/lotesNoMapa.js').PedidoImagem[]} */
    const pedidos = [];
    /** @type {import('@/lib/maplibre/nomesNoMapa.js').ItemNome[]} */
    const itens = [];
    nomesRef.current.forEach((n, id) => {
      const d = n.niveis[nivel];
      if (!d.linhas.length) return;
      pedidos.push(pedidoImagemNome(d.linhas, pr));
      // as paradas do `icon-size`, com as duas em volta do zoom de agora acertadas para o tamanho exato
      const tamanhos = tamanhosAcertadosNoZoom(tamanhosDoNivel(n, nivel), d.medida, n.pf, zoom);
      itens.push({ id, lngLat: n.lngLat, imagem: d.chave, comLote: lotesRef.current.has(id), nivel, nome: n.nome, texto: d.linhas.map((l) => l.texto).join("\n"), tamanhos });
    });
    const aplicar = () => {
      const m = getMap();
      // `clearAll` troca o objeto de estado: a publicação de antes dele não escreve no mapa novo
      if (seq !== est.seq || nomesEstadoRef.current !== est || !m) return;
      // o que esta publicação põe no mapa também está em uso, mesmo que `montarNomes` já tenha trocado os textos
      // (a próxima arrumação, já agendada, publica os novos e poda estes)
      const emUso = [...new Set([...chavesImagensNomes(), ...itens.map((i) => i.imagem)])];
      registrarImagensNomes(m, emUso, pr);
      est.nivel = nivel;
      // a imagem que falhou não entra (o nome não aparece até a próxima tentativa; não há reserva para um texto)
      const fc = colecaoNomes(itens.filter((i) => imagemPronta(i.imagem, pr)));
      const conteudo = JSON.stringify(fc.features);
      if (conteudo !== est.publicado) {
        est.publicado = conteudo;
        dataRef.current.nomes = fc;
        setSourceData(m, MG_SOURCE_IDS.NOMES, fc);
      }
      podarImagens(m, new Set(emUso), pr, ehImagemDeNome);
    };
    const espera = garantirImagens(pedidos, pr, avisarFalhaNome);
    if (!espera) {
      aplicar();
      return Promise.resolve();
    }
    return espera.then(aplicar);
  };

  /** As paradas do `icon-size` de um pasto num nível (calculadas uma vez por texto e por área). */
  const tamanhosDoNivel = (/** @type {NomeNaArea} */ n, /** @type {import('@/lib/maplibre/nomesNoMapa.js').NivelNome} */ nivel) => {
    const d = n.niveis[nivel];
    if (!d.tamanhos) d.tamanhos = tamanhosPorZoom(d.medida, n.pf);
    return d.tamanhos;
  };

  /**
   * Sem bagunça de nomes (D-PROD-126): todos no MESMO nível — nome + ha, só o nome, ou só a sigla —, escolhido por
   * colisão, com os ícones de lote como obstáculos (o da própria área não conta). Sem tocar em elemento nenhum
   * (D-PROD-354): a caixa de cada nome é o tamanho da imagem na letra do zoom e a posição da camada, a partir de
   * `map.project`; a da área, os cantos dela na tela.
   *
   * `soNaTela` (durante o zoom, D-PROD-129/347): decide só pelos pastos que estão na tela; o `moveend` decide por todos.
   * @param {{ soNaTela?: boolean }} [opcoes]
   */
  const arrumarNomes = (opcoes) => {
    const map = getMap();
    if (!map) return;
    // Lote de área sem nome (nomes desligados): volta à posição padrão, sem o espaço do nome embaixo (D-PROD-127).
    // Com nome, o par ícone + nome. Vai na fonte dos lotes como `comRotulo` (D-PROD-349).
    publicarLotes();
    if (!nomesRef.current.size) {
      publicarNomes(nomesEstadoRef.current.nivel);
      return;
    }
    const soNaTela = opcoes?.soNaTela === true;
    const zoom = map.getZoom();
    const tela = map.getCanvas();
    const larg = tela.clientWidth || tela.width, alt = tela.clientHeight || tela.height;
    /** @type {Set<string> | null} */
    const alvo = soNaTela ? new Set() : null;
    const itens = [];
    nomesRef.current.forEach((n, id) => {
      // caixa da área na tela pelos cantos dela (o mapa não gira: a caixa projetada é a dos cantos)
      const b = n.caixa;
      if (!b) return;
      const cantos = [map.project([b.oeste, b.norte]), map.project([b.leste, b.sul])];
      const x0 = Math.min(cantos[0].x, cantos[1].x), x1 = Math.max(cantos[0].x, cantos[1].x);
      const y0 = Math.min(cantos[0].y, cantos[1].y), y1 = Math.max(cantos[0].y, cantos[1].y);
      if (alvo) {
        // fora da tela (com 1/4 de folga): não pesa na decisão durante o zoom
        if (!Number.isFinite(x0) || x1 < -larg / 4 || x0 > larg * 1.25 || y1 < -alt / 4 || y0 > alt * 1.25) return;
        alvo.add(id);
      }
      const p = map.project(n.lngLat);
      const comLote = lotesRef.current.has(id);
      itens.push({
        id,
        area: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
        tudo: caixaDoNome(p, n.niveis.tudo.medida, zoom, comLote),
        nome: caixaDoNome(p, n.niveis.nome.medida, zoom, comLote),
      });
    });
    // Ícones de lote são obstáculos dos nomes (D-PROD-126): a caixa é o ponto do pasto na tela + o deslocamento e o
    // tamanho da imagem (D-PROD-349). `dono`: o ícone do lote da própria área não conta contra o nome dela.
    /** @type {Array<{ x: number, y: number, w: number, h: number, dono: string }>} */
    const obstaculosLotes = [];
    lotesRef.current.forEach((lote, id) => {
      if (alvo && !alvo.has(id)) return;
      const c = caixaDoLote(map.project(lote.item.lngLat), nomesRef.current.has(id), lote.tamanho);
      obstaculosLotes.push({ ...c, dono: id });
    });
    if (!itens.length) return;
    const nivel = escolherModoRotulos(itens, { tudo: obstaculosLotes, nome: obstaculosLotes });
    // durante o zoom só publica se o nível mudou; no fim do movimento confere tudo (lotes e nomes podem ter mudado)
    if (soNaTela && nivel === nomesEstadoRef.current.nivel) return;
    publicarNomes(nivel);
  };

  /**
   * Revisão do nível durante o zoom (D-PROD-129), no máximo a cada 120 ms e só pelos pastos que estão na tela
   * (D-PROD-347); o `moveend` revê todos. Sem medir elemento, custa poucas contas; o tamanho do nome no zoom não
   * passa por aqui (é o `icon-size` da camada).
   */
  const ultimoArrumarRef = useRef(0);
  const arrumarDuranteZoom = () => {
    const agora = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (agora - ultimoArrumarRef.current < 120) return;
    ultimoArrumarRef.current = agora;
    arrumarNomes({ soNaTela: true });
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
    arrumarRef.current.quadro = requestAnimationFrame(() => arrumarNomes());
  };

  /** Monta os nomes (texto de cada nível, medida, caixa da área) depois que a letra está pronta. */
  const montarNomes = (/** @type {any[]} */ areas, /** @type {boolean} */ show, /** @type {any} */ extraTextFn, /** @type {boolean} */ showHectares) => {
    const map = getMap();
    if (!map) return;
    const lista = show ? areas : [];
    /** @type {Map<string, NomeNaArea>} */
    const novos = new Map();
    for (const area of lista) {
      const id = String(area.id);
      const chaveRing = JSON.stringify(area?.coordenadas?.coords || null);
      let geo = geoNomesRef.current.get(id);
      if (!geo || geo.chaveRing !== chaveRing) {
        const ring = parseVertices(area?.coordenadas?.coords);
        let oeste = Infinity, sul = Infinity, leste = -Infinity, norte = -Infinity;
        for (const p of ring) {
          if (p.lng < oeste) oeste = p.lng;
          if (p.lng > leste) leste = p.lng;
          if (p.lat < sul) sul = p.lat;
          if (p.lat > norte) norte = p.lat;
        }
        geo = { chaveRing, centro: centroideArea(area), pf: pontoEFolga(ring), caixa: Number.isFinite(oeste) ? { oeste, sul, leste, norte } : null };
        geoNomesRef.current.set(id, geo);
      }
      if (!geo.centro) continue;
      const texto = {
        nome: area.nome || "",
        sigla: siglaDaArea(area),
        ha: showHectares ? textoHectares(area) : null,
        extra: (extraTextFn ? extraTextFn(area) : null) || null,
      };
      const anterior = nomesRef.current.get(id);
      /** @type {Record<import('@/lib/maplibre/nomesNoMapa.js').NivelNome, NivelDoNome>} */
      const niveis = /** @type {any} */ ({});
      for (const nivel of NIVEIS_NOME) {
        const linhas = linhasDoNivel(texto, nivel);
        const chave = chaveImagemNome(linhas);
        const velho = anterior?.niveis[nivel];
        // mesmo texto e mesma área: aproveita a medida e as paradas já calculadas
        niveis[nivel] = velho && velho.chave === chave && anterior?.pf === geo.pf ? velho : { linhas, chave, medida: medirLinhas(linhas), tamanhos: null };
      }
      novos.set(id, { lngLat: [geo.centro.lng, geo.centro.lat], nome: texto.nome, pf: geo.pf, caixa: geo.caixa, niveis });
    }
    for (const id of [...geoNomesRef.current.keys()]) if (!novos.has(id)) geoNomesRef.current.delete(id);
    nomesRef.current = novos;
    agendarArrumar();
  };

  const syncLabels = useCallback((areas, show, extraTextFn, showHectares = true) => {
    const map = getMap();
    if (!map) return;
    ensureMgLayers(map);
    nomesArgsRef.current = [areas, show, extraTextFn, showHectares];
    if (!nomesHandlersRef.current) {
      // D-PROD-129: durante o zoom o nível (sigla/nome/ha) é revisto algumas vezes por segundo — não só no fim —, para
      // o nome não ficar maior que o pasto enquanto ele encolhe. O tamanho acompanha sozinho (`icon-size`).
      const h = () => arrumarDuranteZoom();
      map.on("zoom", h);
      const desligarImagens = ligarImagensFaltandoNomes(map, () => pixelRatioRef.current);
      ligarDensidade(map);
      nomesHandlersRef.current = {
        off: () => {
          try {
            map.off("zoom", h);
          } catch {
            /* mapa já removido */
          }
          desligarImagens();
        },
      };
    }
    const seq = ++nomesEstadoRef.current.seqSync;
    // A letra Inter antes de medir e desenhar (sem ela, Arial); depois da primeira vez, segue na hora.
    const espera = esperarFonteDosNomes();
    if (!espera) {
      montarNomes(areas, show, extraTextFn, showHectares);
      return;
    }
    espera.then(() => {
      if (seq === nomesEstadoRef.current.seqSync) montarNomes(areas, show, extraTextFn, showHectares);
    });
  }, [mapInstanceRef]);
  syncLabelsRef.current = syncLabels;

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

  // ─── Cochos, pontos e tarefas desenhados pelo mapa (D-PROD-353) ───

  /** Um só ouvinte de `resize`: densidade da tela nova refaz as imagens dos lotes e dos pontos nela. */
  const ligarDensidade = (/** @type {any} */ map) => {
    if (densidadeRef.current) return;
    const aoRedimensionar = () => {
      const novo = pixelRatioDaTela();
      if (novo === pixelRatioRef.current) return;
      pixelRatioRef.current = novo;
      if (lotesArgsRef.current) syncLotesRef.current?.(...lotesArgsRef.current);
      if (nomesArgsRef.current) syncLabelsRef.current?.(...nomesArgsRef.current);
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
   * Publica um grupo (D-PROD-353). O mapa id → objeto do app é trocado NA HORA (o clique entrega sempre o mais novo,
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
    const itens = itensDosPontos({ pontos, show, iconesConfig, pixelRatio: pixelRatioRef.current });
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
    const itens = itensDaSuplementacao({ pontosSupl, show, iconesConfig, pixelRatio: pixelRatioRef.current });
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
      const comRotulo = nomesRef.current.has(areaId);
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
        return { areaId, lngLat: l.item.lngLat, comRotulo: nomesRef.current.has(areaId), imagem: l.item.imagem, ident: l.item.ident, nome: l.item.nome };
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
      // uma tarefa por cima do lote (D-PROD-353): o toque é da tarefa
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
    // O que vai em cada pasto: o mesmo para o mapa do Google do site (D-PROD-369).
    const { itens, pedidos } = itensDosLotes({ lotesFiltrados, areas, show, categoriasManejo, blinkAlerts, pixelRatio: pr });
    // `tamanho` entra no aplicar (a imagem pronta)
    const novos = /** @type {Map<string, any>} */ (itens);
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
      // Os ícones de lote são obstáculos para os nomes (D-PROD-126).
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
    const itens = itensDasTarefas({ tarefasMapa, areas, iconesConfig, hoje, pixelRatio: pixelRatioRef.current });
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
   * um deles (D-PROD-353).
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
