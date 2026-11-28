/*
 * GUIA DE EDIÇÃO — MARCADORES NO MAPA DO GOOGLE DO SITE (D-PROD-369): o que vai em cada marcador sai de
 * src/lib/maplibre/itensDoMapaGeral.js (o mesmo do MapLibre); a imagem, do mesmo desenho e cache (lotesNoMapa.js,
 * pontosNoMapa.js); a posição e a ordem, das constantes daqui (iguais às camadas do MapLibre). A camada que mostra
 * as imagens fica em src/lib/mapaNativo/mapaGoogleWeb.js.
 */
import { useEffect, useMemo, useRef } from "react";

import { itensDaSuplementacao, itensDasTarefas, itensDosLotes, itensDosPontos } from "@/lib/maplibre/itensDoMapaGeral.js";
import { NIVEIS, colocacaoDoNome, montarNomes, nivelDosNomes, nomesFixosNaCamera } from "@/lib/mapaNativo/nomesGoogle.js";
import { avisarFalhaNome, esperarFonteDosNomes, pedidoImagemNome } from "@/lib/maplibre/nomesNoMapa.js";
import {
  DESLOC_IDENT_PX,
  OFFSET_LOTE_COM_NOME_PX,
  OFFSET_LOTE_PX,
  desenharImagemReserva,
  garantirImagens,
  imagemPronta,
  pixelRatioDaTela,
} from "@/lib/maplibre/lotesNoMapa.js";
import { avisarFalhaPonto } from "@/lib/maplibre/pontosNoMapa.js";

/**
 * Ordem dos marcadores (maior por cima), a mesma das camadas do MapLibre e dos z-index de antes:
 * cocho 500 < ponto 800 < lote 1000 (com alerta por cima) < identificador < tarefa 2500 < tarefa Urgente 3000.
 */
export const ORDEM_GOOGLE = Object.freeze({ supl: 500, pontos: 800, lote: 1000, loteComAlerta: 1001, ident: 1002, tarefa: 2500, urgente: 3000, nome: 4000 });
/** Durante o movimento o nível dos nomes é revisto no máximo a cada tanto (ms), só pelos pastos à vista (D-PROD-347). */
export const MS_NIVEL_NO_MOVIMENTO = 120;

/** Os dois conjuntos têm os mesmos ids? @param {Set<string> | null} a @param {Set<string> | null} b */
function mesmoConjunto(a, b) {
  if (!a || !b) return a === b;
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** Imagens já convertidas em URL, por chave e densidade (a conversão é feita uma vez). */
const urls = new Map();
/** Quanto um grupo de pontos espera as figuras antes de sair com a reserva no que faltar (ms), como no MapLibre. */
export const MS_ESPERA_IMAGENS = 250;
/** Passou disso, o cache de URLs recomeça (as imagens em uso são refeitas na próxima publicação). */
const MAX_URLS = 600;

/**
 * Imagem desenhada (pixels) → URL `data:` para o `<img>` do mapa.
 * @param {import('@/lib/maplibre/lotesNoMapa.js').Raster} r @param {string} chave
 * @returns {string | null}
 */
export function urlDaImagem(r, chave) {
  const k = `${chave}@${r.pixelRatio}`;
  const pronta = urls.get(k);
  if (pronta) return pronta;
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = r.imagem.width;
    canvas.height = r.imagem.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(r.imagem.data), r.imagem.width, r.imagem.height), 0, 0);
    const url = canvas.toDataURL("image/png");
    if (urls.size >= MAX_URLS) urls.clear();
    urls.set(k, url);
    return url;
  } catch {
    return null;
  }
}

/**
 * Marcador de uma imagem pronta, ou null se não há imagem.
 * @param {{ id: string, lngLat: [number, number], r: any, chave: string, dx?: number, dy?: number, z: number, titulo?: string, onClick?: () => void, escala?: (zoom: number) => number, ancora?: "centro" | "topo", semToque?: boolean }} p
 * @returns {import('@/lib/mapaNativo/mapaGoogleWeb.js').MarcadorWeb | null}
 */
function marcador({ id, lngLat, r, chave, dx = 0, dy = 0, z, titulo, onClick, escala, ancora, semToque }) {
  if (!r) return null;
  const url = urlDaImagem(r, chave);
  if (!url) return null;
  /** @type {import('@/lib/mapaNativo/mapaGoogleWeb.js').MarcadorWeb} */
  const m = { id, lat: lngLat[1], lng: lngLat[0], url, w: r.w, h: r.h, dx, dy, z, titulo, onClick };
  if (escala) m.escala = escala;
  if (ancora) m.ancora = ancora;
  if (semToque) m.semToque = true;
  return m;
}

/**
 * Lotes, cochos, pontos e tarefas no mapa do Google do SITE (D-PROD-369), com o mesmo contrato do `useMapRenderer`
 * (`syncLotes`, `syncPontos`, `syncPontosSuplementacao`, `syncTarefas`): o `MapaGeral` chama com os mesmos filtros,
 * permissões e cliques. Sem o mapa do Google do site (ainda abrindo, ou o mapa nativo do app, que não tem
 * `definirMarcadores`), não faz nada.
 *
 * D-PROD-374: os nomes dos pastos (`syncLabels`), com o nível revisto a cada câmera (`aoMudarCamera` do mapa).
 * Ainda não: arrastar lote, piscar o identificador do lote com alerta.
 * @param {any} mapa o objeto de `criarMapaGoogleWeb` (ou null)
 */
export default function useMarcadoresGoogle(mapa) {
  const seqRef = useRef(/** @type {Record<string, number>} */ ({}));
  // nomes dos pastos (D-PROD-374): os nomes, o nível de agora, a última câmera e os ícones de lote (obstáculos)
  const nomesRef = useRef(/** @type {Map<string, import('@/lib/mapaNativo/nomesGoogle.js').NomeDoPasto>} */ (new Map()));
  const nivelRef = useRef(/** @type {import('@/lib/mapaNativo/nomesGoogle.js').NivelNome} */ ("tudo"));
  const cameraRef = useRef(/** @type {import('@/lib/mapaNativo/nomesGoogle.js').CameraNomes | null} */ (null));
  const lotesInfoRef = useRef(/** @type {Map<string, { lat: number, lng: number, tamanho: { w: number, h: number } }>} */ (new Map()));
  const argsLotesRef = useRef(/** @type {any[] | null} */ (null));
  const seqNomesRef = useRef(0);
  const ultimaRevisaoRef = useRef(0);
  // D-PROD-379 (app): nomes de tamanho fixo; quais aparecem nesta câmera e os ícones que eles não podem cobrir
  const visiveisRef = useRef(/** @type {Set<string> | null} */ (null));
  const iconesRef = useRef(/** @type {Record<string, import('@/lib/mapaNativo/nomesGoogle.js').IconeObstaculo[]>} */ ({}));

  const api = useMemo(() => {
    const temMarcadores = Boolean(mapa && typeof mapa.definirMarcadores === "function");
    // D-PROD-379: no app (marcadores do mapa nativo) o nome tem tamanho fixo e some quando não cabe
    const nomesFixos = Boolean(mapa?.nomesFixos);
    /** Os ícones (menos os de lote, que já vão em `lotesInfoRef`) como obstáculos dos nomes. */
    const iconesObstaculo = () => Object.values(iconesRef.current).flat();
    /** O nível e os nomes visíveis na última câmera (app), ou null sem câmera. */
    const nomesNaUltimaCamera = () => {
      const camera = cameraRef.current;
      if (!camera || !nomesRef.current.size) return null;
      return nomesFixosNaCamera(nomesRef.current, camera, lotesInfoRef.current, iconesObstaculo());
    };
    let revisaoPendente = false;
    /** Os ícones mudaram (app): os nomes visíveis são revistos com a última câmera. */
    const reverNomesFixos = () => {
      if (!nomesFixos || revisaoPendente) return;
      revisaoPendente = true;
      queueMicrotask(() => {
        revisaoPendente = false;
        const r = nomesNaUltimaCamera();
        if (r && (r.nivel !== nivelRef.current || !mesmoConjunto(r.visiveis, visiveisRef.current))) void publicarNomes(r.nivel, r.visiveis);
      });
    };
    const proximo = (/** @type {string} */ grupo) => (seqRef.current[grupo] = (seqRef.current[grupo] || 0) + 1);

    /**
     * Desenha o que falta e publica o grupo; uma chamada mais nova descarta a anterior.
     * @param {string} grupo @param {any[]} pedidos @param {() => any[]} montar @param {() => void} [aoFalhar] @param {any[]} [reservas]
     */
    const publicar = (grupo, pedidos, montar, aoFalhar, reservas = []) => {
      if (!temMarcadores) return Promise.resolve();
      const seq = proximo(grupo);
      const pr = pixelRatioDaTela();
      const aplicar = () => {
        if (seqRef.current[grupo] !== seq) return;
        const lista = montar().filter(Boolean);
        mapa.definirMarcadores(grupo, lista);
        // os ícones que os nomes de tamanho fixo não podem cobrir (os lotes já vão por `lotesInfoRef`)
        if (nomesFixos && grupo !== "nomes" && grupo !== "lotes") {
          iconesRef.current = { ...iconesRef.current, [grupo]: lista.map((m) => ({ lat: m.lat, lng: m.lng, w: m.w, h: m.h, dx: m.dx, dy: m.dy })) };
          reverNomesFixos();
        }
      };
      // Como o `sincronizarGrupo` do MapLibre: as reservas (desenhadas na hora) primeiro; as figuras esperam no máximo
      // MS_ESPERA_IMAGENS. Uma figura remota lenta não segura o grupo: ele sai com a reserva e é publicado de novo quando
      // ela chega.
      const esperaReservas = reservas.length ? garantirImagens(reservas, pr, aoFalhar) : null;
      const esperaImagens = garantirImagens(pedidos, pr, aoFalhar);
      if (!esperaReservas && !esperaImagens) {
        aplicar();
        return Promise.resolve();
      }
      const prazo = () => new Promise((r) => setTimeout(r, MS_ESPERA_IMAGENS));
      return (esperaReservas || Promise.resolve())
        .then(() => (esperaImagens && reservas.length ? Promise.race([esperaImagens, prazo()]) : esperaImagens))
        .then(() => {
          aplicar();
          return reservas.length ? esperaImagens : null;
        })
        .then(() => {
          if (esperaImagens && reservas.length) aplicar();
        });
    };

    /** Cochos, pontos ou tarefas: a figura ou, sem ela, a reserva (o ponto nunca some). */
    const publicarPontos = (/** @type {string} */ grupo, /** @type {import('@/lib/maplibre/itensDoMapaGeral.js').PontoNoMapa[]} */ itens, /** @type {(ref: any, item: any) => number} */ ordem, /** @type {(ref: any) => void} */ aoClicar) => {
      const pr = pixelRatioDaTela();
      return publicar(
        grupo,
        itens.map((i) => i.pedidos.imagem),
        () =>
          itens.map(({ item, ref }) => {
            const pronta = imagemPronta(item.imagem, pr);
            const r = pronta || imagemPronta(item.reserva, pr);
            return marcador({ id: item.id, lngLat: item.lngLat, r, chave: pronta ? item.imagem : item.reserva, z: ordem(ref, item), titulo: item.titulo, onClick: () => aoClicar(ref) });
          }),
        avisarFalhaPonto,
        itens.map((i) => i.pedidos.reserva)
      );
    };

    /**
     * Publica os nomes no nível dado (ou no da última câmera). Os três níveis de cada pasto ficam desenhados, para a
     * troca de nível não esperar desenho.
     * @param {import('@/lib/mapaNativo/nomesGoogle.js').NivelNome} [nivelDado]
     * @param {Set<string> | null} [visiveisDadas] app (D-PROD-379): os nomes que aparecem
     */
    const publicarNomes = (nivelDado, visiveisDadas) => {
      const nomes = nomesRef.current;
      const camera = cameraRef.current;
      /** @type {import('@/lib/mapaNativo/nomesGoogle.js').NivelNome} */
      let nivel;
      /** @type {Set<string> | null} */
      let visiveis = null;
      if (nomesFixos) {
        // app: tamanho fixo; sem câmera ainda, nenhum nome (o mapa avisa a câmera quando para)
        const r = nivelDado ? { nivel: nivelDado, visiveis: visiveisDadas || null } : nomesNaUltimaCamera();
        nivel = r?.nivel ?? nivelRef.current;
        visiveis = r?.visiveis ?? null;
        visiveisRef.current = visiveis;
      } else {
        nivel = nivelDado || (camera && nomes.size ? nivelDosNomes(nomes, camera, lotesInfoRef.current) : nivelRef.current);
      }
      nivelRef.current = nivel;
      const pr = pixelRatioDaTela();
      const pedidos = [];
      for (const n of nomes.values()) for (const nv of NIVEIS) if (n.niveis[nv].linhas.length) pedidos.push(pedidoImagemNome(n.niveis[nv].linhas, pr));
      return publicar(
        "nomes",
        pedidos,
        () =>
          [...nomes.values()].map((n) => {
            if (nomesFixos && !visiveis?.has(n.id)) return null;
            const c = colocacaoDoNome(n, nivel, lotesInfoRef.current.has(n.id));
            if (!c.linhas.length) return null;
            // app: sem `escala` (tamanho fixo na tela, o mapa nativo não refaz o nome no zoom)
            return marcador({ id: n.id, lngLat: [n.lng, n.lat], r: imagemPronta(c.chave, pr), chave: c.chave, dy: c.dy, z: ORDEM_GOOGLE.nome, escala: nomesFixos ? undefined : c.escala, ancora: c.ancora, semToque: true });
          }),
        avisarFalhaNome
      );
    };

    const api = {
      /** Mesmos argumentos do `useMapRenderer.syncLotes` (arrastar e piscar ficam para depois). */
      syncLotes(lotesFiltrados, areas, show, categoriasManejo, onClickLotes, _onDragLotes, _canDragLotes, blinkAlerts = false) {
        if (!temMarcadores) return Promise.resolve();
        argsLotesRef.current = [lotesFiltrados, areas, show, categoriasManejo, onClickLotes, _onDragLotes, _canDragLotes, blinkAlerts];
        const pr = pixelRatioDaTela();
        const { itens, pedidos } = itensDosLotes({ lotesFiltrados, areas, show, categoriasManejo, blinkAlerts, pixelRatio: pr });
        return publicar("lotes", pedidos, () => {
          const lista = [];
          /** @type {Map<string, { lat: number, lng: number, tamanho: { w: number, h: number } }>} */
          const info = new Map();
          for (const [areaId, l] of itens) {
            const { item } = l;
            // a imagem que falhou: o círculo verde (a reserva do MapLibre)
            const pronta = imagemPronta(item.imagem, pr);
            const r = pronta || desenharImagemReserva(pr);
            const aoClicar = () => onClickLotes?.(l.lotesNaArea);
            // pasto com nome: o par ícone + nome (o ícone sobe, D-PROD-128/349)
            const [dx, dy] = nomesRef.current.has(areaId) ? OFFSET_LOTE_COM_NOME_PX : OFFSET_LOTE_PX;
            if (r) info.set(areaId, { lat: item.lngLat[1], lng: item.lngLat[0], tamanho: { w: r.w, h: r.h } });
            lista.push(
              marcador({
                id: areaId,
                lngLat: item.lngLat,
                r,
                chave: pronta ? item.imagem : "mg-lote-reserva",
                dx,
                dy,
                z: item.alerta ? ORDEM_GOOGLE.loteComAlerta : ORDEM_GOOGLE.lote,
                onClick: aoClicar,
              })
            );
            if (item.ident) {
              lista.push(
                marcador({
                  id: `${areaId}|ident`,
                  lngLat: item.lngLat,
                  r: imagemPronta(item.ident, pr),
                  chave: item.ident,
                  dx: dx + DESLOC_IDENT_PX[0],
                  dy: dy + DESLOC_IDENT_PX[1],
                  z: ORDEM_GOOGLE.ident,
                  onClick: aoClicar,
                })
              );
            }
          }
          // quais pastos têm lote mudou: os nomes desses pastos mudam de lugar (embaixo do ícone)
          const mudou = [...info.keys()].sort().join(",") !== [...lotesInfoRef.current.keys()].sort().join(",");
          lotesInfoRef.current = info;
          if (mudou && nomesRef.current.size) queueMicrotask(() => void publicarNomes());
          return lista;
        });
      },
      /** Pontos de referência (bebedouro incluído); sem callback, nada no clique (o popup é do MapLibre). */
      syncPontos(pontos, show, iconesConfig, onClickPonto) {
        if (!temMarcadores) return Promise.resolve();
        const itens = itensDosPontos({ pontos, show, iconesConfig, pixelRatio: pixelRatioDaTela() });
        return publicarPontos("pontos", itens, () => ORDEM_GOOGLE.pontos, (p) => onClickPonto?.(p));
      },
      syncPontosSuplementacao(pontosSupl, show, iconesConfig, onClick) {
        if (!temMarcadores) return Promise.resolve();
        const itens = itensDaSuplementacao({ pontosSupl, show, iconesConfig, pixelRatio: pixelRatioDaTela() });
        return publicarPontos("supl", itens, () => ORDEM_GOOGLE.supl, (p) => onClick?.(p));
      },
      syncTarefas(tarefasMapa, areas, iconesConfig, onClickTarefa, hoje) {
        if (!temMarcadores) return Promise.resolve();
        const itens = itensDasTarefas({ tarefasMapa, areas, iconesConfig, hoje, pixelRatio: pixelRatioDaTela() });
        return publicarPontos("tarefas", itens, (_t, item) => (item.urgente ? ORDEM_GOOGLE.urgente : ORDEM_GOOGLE.tarefa), (t) => onClickTarefa?.(t));
      },
      /**
       * Nomes dos pastos (D-PROD-374), mesmos argumentos do `useMapRenderer.syncLabels`. Espera a letra Inter (como o
       * MapLibre) antes de medir; o nível sai da última câmera.
       */
      syncLabels(areas, show, extraTextFn, showHectares = true) {
        if (!temMarcadores) return Promise.resolve();
        const seq = ++seqNomesRef.current;
        const montar = () => {
          if (seq !== seqNomesRef.current) return Promise.resolve();
          const antes = nomesRef.current;
          nomesRef.current = show ? montarNomes(areas, { extraTextFn, showHectares }) : new Map();
          // quais pastos têm nome mudou: os lotes desses pastos mudam de posição (o par ícone + nome)
          const chaves = (/** @type {Map<string, any>} */ m) => [...m.keys()].sort().join(",");
          if (chaves(antes) !== chaves(nomesRef.current) && argsLotesRef.current) {
            void api.syncLotes(.../** @type {[any, any, any, any, any, any, any, any]} */ (argsLotesRef.current));
          }
          return publicarNomes();
        };
        const espera = esperarFonteDosNomes();
        return espera ? espera.then(montar) : montar();
      },
      /**
       * A câmera mudou (o mapa avisa): durante o movimento o nível é revisto só pelos pastos à vista e no máximo a cada
       * MS_NIVEL_NO_MOVIMENTO; quando o mapa para, por todos. Só publica se o nível mudou (o tamanho no zoom é a
       * `escala` do marcador).
       * @param {import('@/lib/mapaNativo/nomesGoogle.js').CameraNomes & { final?: boolean }} camera
       */
      revisarNomes(camera) {
        cameraRef.current = camera;
        if (!temMarcadores || !nomesRef.current.size) return;
        if (nomesFixos) {
          // app: só quando o mapa para (nada de trabalho no meio do gesto)
          if (!camera.final) return;
          const r = nomesNaUltimaCamera();
          if (r && (r.nivel !== nivelRef.current || !mesmoConjunto(r.visiveis, visiveisRef.current))) void publicarNomes(r.nivel, r.visiveis);
          return;
        }
        const agora = typeof performance !== "undefined" ? performance.now() : Date.now();
        if (!camera.final && agora - ultimaRevisaoRef.current < MS_NIVEL_NO_MOVIMENTO) return;
        ultimaRevisaoRef.current = agora;
        const nivel = nivelDosNomes(nomesRef.current, camera, lotesInfoRef.current, { soNaTela: !camera.final });
        if (nivel !== nivelRef.current) void publicarNomes(nivel);
      },
    };
    return api;
  }, [mapa]);

  // o mapa avisa a câmera (zoom, projeção, tamanho da tela): o nível dos nomes é revisto
  useEffect(() => {
    if (!mapa?.aoMudarCamera) return undefined;
    return mapa.aoMudarCamera((/** @type {any} */ camera) => api.revisarNomes(camera));
  }, [mapa, api]);

  return api;
}
