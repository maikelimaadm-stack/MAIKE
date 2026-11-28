/*
 * GUIA DE EDIÇÃO — MARCADORES NO MAPA DO GOOGLE DO SITE (D-PROD-369): o que vai em cada marcador sai de
 * src/lib/maplibre/itensDoMapaGeral.js (o mesmo do MapLibre); a imagem, do mesmo desenho e cache (lotesNoMapa.js,
 * pontosNoMapa.js); a posição e a ordem, das constantes daqui (iguais às camadas do MapLibre). A camada que mostra
 * as imagens fica em src/lib/mapaNativo/mapaGoogleWeb.js.
 */
import { useEffect, useMemo, useRef } from "react";

import { itensDaSuplementacao, itensDasTarefas, itensDosLotes, itensDosPontos } from "@/lib/maplibre/itensDoMapaGeral.js";
import { NIVEIS, colocacaoDoNome, montarNomes, nivelDosNomes, nomesFixosNaCamera } from "@/lib/mapaNativo/nomesGoogle.js";
import { DESLOC_NOME_COM_LOTE_PX, avisarFalhaNome, esperarFonteDosNomes, pedidoImagemNome } from "@/lib/maplibre/nomesNoMapa.js";
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
/**
 * Assinatura do arranjo dos nomes (nível, deslocamentos, ocultos): publica de novo só quando ela muda.
 * @param {{ nivel: string, desloc: Map<string, { dx: number, dy: number }>, ocultos: Set<string> } | null} a
 */
export function assinaturaDoArranjo(a) {
  if (!a) return "";
  const d = [...a.desloc].map(([id, v]) => `${id}:${v.dx},${v.dy}`).sort().join(";");
  return `${a.nivel}|${d}|${[...a.ocultos].sort().join(",")}`;
}

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
  // D-PROD-379/382 (app): nomes de tamanho fixo e os ícones que eles não podem cobrir
  const iconesRef = useRef(/** @type {Record<string, import('@/lib/mapaNativo/nomesGoogle.js').IconeObstaculo[]>} */ ({}));
  // D-PROD-382 (app): o arranjo dos nomes publicado e o último calculado (deslocamentos para fora dos ícones, ocultos)
  const arranjoRef = useRef(/** @type {ReturnType<typeof nomesFixosNaCamera> | null} */ (null));
  const arranjoNovoRef = useRef(/** @type {ReturnType<typeof nomesFixosNaCamera> | null} */ (null));

  const api = useMemo(() => {
    const temMarcadores = Boolean(mapa && typeof mapa.definirMarcadores === "function");
    // D-PROD-379: no app (marcadores do mapa nativo) o nome tem tamanho fixo e some quando não cabe
    const nomesFixos = Boolean(mapa?.nomesFixos);
    /** Os ícones (menos os de lote, que já vão em `lotesInfoRef`) como obstáculos dos nomes. */
    const iconesObstaculo = () => Object.values(iconesRef.current).flat();
    /**
     * Os nomes na última câmera (app): o nível (o mesmo para todos, com "nenhum"), quem é puxado para fora de um
     * ícone e o raro nome sem lugar livre; null sem câmera. Guarda o arranjo para os marcadores.
     */
    const nivelNaUltimaCamera = () => {
      const camera = cameraRef.current;
      if (!camera || !nomesRef.current.size) return null;
      const r = nomesFixosNaCamera(nomesRef.current, camera, lotesInfoRef.current, iconesObstaculo(), nivelRef.current);
      arranjoNovoRef.current = r;
      return r.nivel;
    };
    /** O arranjo calculado mudou em relação ao publicado (nível, deslocamentos ou ocultos)? */
    const arranjoMudou = () => assinaturaDoArranjo(arranjoNovoRef.current) !== assinaturaDoArranjo(arranjoRef.current);
    let revisaoPendente = false;
    /** Os ícones mudaram (app): os nomes visíveis são revistos com a última câmera. */
    const reverNomesFixos = () => {
      if (!nomesFixos || revisaoPendente) return;
      revisaoPendente = true;
      queueMicrotask(() => {
        revisaoPendente = false;
        const nivel = nivelNaUltimaCamera();
        if (nivel && (nivel !== nivelRef.current || arranjoMudou())) void publicarNomes(nivel);
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
     *
     * App (D-PROD-379/382): tamanho fixo; o nível é o mesmo para todos e "nenhum" tira todos juntos. O nome e os
     * hectares são marcadores SEPARADOS: entre "tudo" e "nome" o marcador do nome não muda (só os hectares entram ou
     * saem), então nada pisca nem engasga ao aparecer ou sumir os hectares.
     * @param {any} [nivelDado] o nível (no app, também "nenhum")
     */
    const publicarNomes = (nivelDado) => {
      const nomes = nomesRef.current;
      const camera = cameraRef.current;
      /** @type {any} */
      let nivel;
      if (nomesFixos) {
        // app: sem câmera ainda, nenhum nome (o mapa avisa a câmera quando para)
        nivel = nivelDado || nivelNaUltimaCamera() || "nenhum";
      } else {
        nivel = nivelDado || (camera && nomes.size ? nivelDosNomes(nomes, camera, lotesInfoRef.current) : nivelRef.current);
      }
      nivelRef.current = nivel;
      if (nomesFixos) arranjoRef.current = arranjoNovoRef.current;
      const pr = pixelRatioDaTela();
      const pedidos = [];
      for (const n of nomes.values()) {
        for (const nv of NIVEIS) if (n.niveis[nv].linhas.length) pedidos.push(pedidoImagemNome(n.niveis[nv].linhas, pr));
        if (nomesFixos && n.detalhe?.linhas.length) pedidos.push(pedidoImagemNome(n.detalhe.linhas, pr));
      }
      return publicar(
        "nomes",
        pedidos,
        () => (nomesFixos ? marcadoresDosNomesFixos(nomes, nivel, pr) : [...nomes.values()].map((n) => {
            const c = colocacaoDoNome(n, nivel, lotesInfoRef.current.has(n.id));
            if (!c.linhas.length) return null;
            return marcador({ id: n.id, lngLat: [n.lng, n.lat], r: imagemPronta(c.chave, pr), chave: c.chave, dy: c.dy, z: ORDEM_GOOGLE.nome, escala: c.escala, ancora: c.ancora, semToque: true });
          })),
        avisarFalhaNome
      );
    };

    /**
     * App: os marcadores dos nomes de tamanho fixo no nível. O nome (o mesmo em "tudo" e "nome"; a sigla em "sigla")
     * e, em "tudo", os hectares logo abaixo dele, num marcador à parte (`<id>|ha`).
     * @param {Map<string, any>} nomes @param {any} nivel @param {number} pr
     */
    const marcadoresDosNomesFixos = (nomes, nivel, pr) => {
      if (nivel === "nenhum") return [];
      const arranjo = arranjoRef.current;
      const lista = [];
      for (const n of nomes.values()) {
        // o raro nome sem lugar livre não aparece (em cima de ícone, nunca)
        if (arranjo?.ocultos.has(n.id)) continue;
        const d = nivel === "sigla" ? n.niveis.sigla : n.niveis.nome;
        if (!d.linhas.length) continue;
        const r = imagemPronta(d.chave, pr);
        if (!r) continue;
        const comLote = lotesInfoRef.current.has(n.id);
        // com lote, o topo do nome 10 px abaixo do ponto; sem lote, o nome no meio do ponto
        // o nome que cairia em cima de um ícone vai para o lado livre (o mesmo deslocamento para os hectares)
        const puxa = arranjo?.desloc.get(n.id) || { dx: 0, dy: 0 };
        const dyNome = (comLote ? DESLOC_NOME_COM_LOTE_PX[1] : 0) + puxa.dy;
        lista.push(marcador({ id: n.id, lngLat: [n.lng, n.lat], r, chave: d.chave, dx: puxa.dx, dy: dyNome, z: ORDEM_GOOGLE.nome, ancora: comLote ? "topo" : "centro", semToque: true }));
        if (nivel === "tudo" && n.detalhe?.linhas.length) {
          const rh = imagemPronta(n.detalhe.chave, pr);
          if (rh) {
            const embaixo = comLote ? dyNome + r.h : puxa.dy + r.h / 2;
            lista.push(marcador({ id: `${n.id}|ha`, lngLat: [n.lng, n.lat], r: rh, chave: n.detalhe.chave, dx: puxa.dx, dy: embaixo, z: ORDEM_GOOGLE.nome, ancora: "topo", semToque: true }));
          }
        }
      }
      return lista;
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
          // app: só quando o mapa para (nada de trabalho no meio do gesto); publica só quando o nível muda
          if (!camera.final) return;
          const nivel = nivelNaUltimaCamera();
          if (nivel && (nivel !== nivelRef.current || arranjoMudou())) void publicarNomes(nivel);
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
