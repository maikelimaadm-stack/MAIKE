/*
 * GUIA DE EDIÇÃO — MARCADORES NO MAPA DO GOOGLE DO SITE (D-PROD-369): o que vai em cada marcador sai de
 * src/lib/maplibre/itensDoMapaGeral.js (o mesmo do MapLibre); a imagem, do mesmo desenho e cache (lotesNoMapa.js,
 * pontosNoMapa.js); a posição e a ordem, das constantes daqui (iguais às camadas do MapLibre). A camada que mostra
 * as imagens fica em src/lib/mapaNativo/mapaGoogleWeb.js.
 */
import { useMemo, useRef } from "react";

import { itensDaSuplementacao, itensDasTarefas, itensDosLotes, itensDosPontos } from "@/lib/maplibre/itensDoMapaGeral.js";
import {
  DESLOC_IDENT_PX,
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
export const ORDEM_GOOGLE = Object.freeze({ supl: 500, pontos: 800, lote: 1000, loteComAlerta: 1001, ident: 1002, tarefa: 2500, urgente: 3000 });

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
 * @param {{ id: string, lngLat: [number, number], r: any, chave: string, dx?: number, dy?: number, z: number, titulo?: string, onClick?: () => void }} p
 * @returns {import('@/lib/mapaNativo/mapaGoogleWeb.js').MarcadorWeb | null}
 */
function marcador({ id, lngLat, r, chave, dx = 0, dy = 0, z, titulo, onClick }) {
  if (!r) return null;
  const url = urlDaImagem(r, chave);
  if (!url) return null;
  return { id, lat: lngLat[1], lng: lngLat[0], url, w: r.w, h: r.h, dx, dy, z, titulo, onClick };
}

/**
 * Lotes, cochos, pontos e tarefas no mapa do Google do SITE (D-PROD-369), com o mesmo contrato do `useMapRenderer`
 * (`syncLotes`, `syncPontos`, `syncPontosSuplementacao`, `syncTarefas`): o `MapaGeral` chama com os mesmos filtros,
 * permissões e cliques. Sem o mapa do Google do site (ainda abrindo, ou o mapa nativo do app, que não tem
 * `definirMarcadores`), não faz nada.
 *
 * Ainda não (próximas etapas): nomes dos pastos, arrastar lote, piscar o identificador do lote com alerta.
 * @param {any} mapa o objeto de `criarMapaGoogleWeb` (ou null)
 */
export default function useMarcadoresGoogle(mapa) {
  const seqRef = useRef(/** @type {Record<string, number>} */ ({}));

  return useMemo(() => {
    const temMarcadores = Boolean(mapa && typeof mapa.definirMarcadores === "function");
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
        mapa.definirMarcadores(grupo, montar().filter(Boolean));
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

    return {
      /** Mesmos argumentos do `useMapRenderer.syncLotes` (arrastar e piscar ficam para depois). */
      syncLotes(lotesFiltrados, areas, show, categoriasManejo, onClickLotes, _onDragLotes, _canDragLotes, blinkAlerts = false) {
        if (!temMarcadores) return Promise.resolve();
        const pr = pixelRatioDaTela();
        const { itens, pedidos } = itensDosLotes({ lotesFiltrados, areas, show, categoriasManejo, blinkAlerts, pixelRatio: pr });
        return publicar("lotes", pedidos, () => {
          const lista = [];
          for (const [areaId, l] of itens) {
            const { item } = l;
            // a imagem que falhou: o círculo verde (a reserva do MapLibre)
            const pronta = imagemPronta(item.imagem, pr);
            const r = pronta || desenharImagemReserva(pr);
            const aoClicar = () => onClickLotes?.(l.lotesNaArea);
            lista.push(
              marcador({
                id: areaId,
                lngLat: item.lngLat,
                r,
                chave: pronta ? item.imagem : "mg-lote-reserva",
                dx: OFFSET_LOTE_PX[0],
                dy: OFFSET_LOTE_PX[1],
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
                  dx: OFFSET_LOTE_PX[0] + DESLOC_IDENT_PX[0],
                  dy: OFFSET_LOTE_PX[1] + DESLOC_IDENT_PX[1],
                  z: ORDEM_GOOGLE.ident,
                  onClick: aoClicar,
                })
              );
            }
          }
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
    };
  }, [mapa]);
}
