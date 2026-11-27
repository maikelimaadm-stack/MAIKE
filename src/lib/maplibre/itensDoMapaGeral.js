/**
 * O que vai no Mapa Geral em cada marcador (lote, cocho, ponto, tarefa), sem depender de qual mapa desenha
 * (D-PROD-369). Usado pelo MapLibre (`useMapRenderer`) e pelo mapa do Google do site (`useMarcadoresGoogle`): as duas
 * telas mostram o mesmo marcador, na mesma posição, com a mesma imagem.
 *
 * Cada função devolve os itens (o que o mapa publica, o objeto do app para o clique) e os pedidos de imagem (a chave e
 * como desenhar; o cache e a fila são os de `lotesNoMapa.js`).
 */
import { indicadorTarefa, tituloDoMarcadorTarefa } from "@/lib/tarefas/marcador";
import { normalizarPrioridadeTarefa } from "@/lib/tarefas/prioridade";
import { urlIconeTarefa } from "@/assets/icones/tarefas";
import { parseVertex } from "@/lib/geografia/coords.js";
import {
  centroideArea,
  descreverMarcadorSuplementacao,
  resolverIconeLote,
  resolverIconePonto,
  resolverIconeSuplementacao,
  resolverIconeTarefa,
} from "./mapaGeralRender.js";
import { identificadoresDoLote, pedidoImagemIdent, pedidoImagemLote } from "./lotesNoMapa.js";
import { TAMANHO_PONTO_PX, TAMANHO_SUPL_PX, TAMANHO_TAREFA_PX, pedidosImagemPonto } from "./pontosNoMapa.js";

/**
 * Lote no mapa: um por pasto (os lotes do pasto juntos), no centro da área.
 * @typedef {{
 *   item: { areaId: string, lngLat: [number, number], imagem: string, ident: string | null, alerta: boolean, piscar: boolean, nome: string, cabecas: number, desenho: string },
 *   lotesNaArea: any[],
 *   areas: any[],
 * }} LoteNoMapa
 */

/**
 * Lotes por pasto, com os pedidos das imagens (ícone com a contagem e identificador).
 * @param {{ lotesFiltrados: any[], areas: any[], show: boolean, categoriasManejo: any[], blinkAlerts?: boolean, pixelRatio: number }} p
 * @returns {{ itens: Map<string, LoteNoMapa>, pedidos: import('./lotesNoMapa.js').PedidoImagem[] }}
 */
export function itensDosLotes({ lotesFiltrados, areas, show, categoriasManejo, blinkAlerts = false, pixelRatio }) {
  /** @type {Record<string, any[]>} */
  const porArea = {};
  if (show) {
    for (const lote of lotesFiltrados || []) {
      if (!lote.area_atual_id) continue;
      (porArea[lote.area_atual_id] ||= []).push(lote);
    }
  }
  /** @type {Map<string, LoteNoMapa>} */
  const itens = new Map();
  /** @type {import('./lotesNoMapa.js').PedidoImagem[]} */
  const pedidos = [];
  for (const [areaId, lotesNaArea] of Object.entries(porArea)) {
    const area = (areas || []).find((a) => a.id === areaId);
    const centro = area ? centroideArea(area) : null;
    if (!centro) continue;
    const totalCabecas = lotesNaArea.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);
    const totalAlertas = lotesNaArea.reduce((s, l) => s + (l.alertas?.length || 0), 0);
    // Sempre há figura (D-PROD-191): `iconUrl` é a data URL do SVG do marcador; `chave` identifica o desenho.
    const { iconUrl, chave } = resolverIconeLote(lotesNaArea, categoriasManejo);
    const imagem = pedidoImagemLote({ desenho: chave, iconUrl, cabecas: totalCabecas, pixelRatio });
    pedidos.push(imagem);
    const ident = identificadoresDoLote(lotesNaArea)[0] || null;
    const pedidoIdent = ident ? pedidoImagemIdent(ident, pixelRatio) : null;
    if (pedidoIdent) pedidos.push(pedidoIdent);
    itens.set(String(areaId), {
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
  return { itens, pedidos };
}

/**
 * Ponto desenhado pelo mapa (cocho, ponto de referência ou tarefa): o item publicado, o objeto do app e os pedidos
 * da imagem e da reserva.
 * @typedef {{ item: import('./pontosNoMapa.js').ItemPonto & { urgente?: boolean }, ref: any, pedidos: { imagem: import('./lotesNoMapa.js').PedidoImagem, reserva: import('./lotesNoMapa.js').PedidoImagem } }} PontoNoMapa
 */

/**
 * Pontos de referência (bebedouro incluído).
 * @param {{ pontos: any[], show: boolean, iconesConfig: any[], pixelRatio: number }} p
 * @returns {PontoNoMapa[]}
 */
export function itensDosPontos({ pontos, show, iconesConfig, pixelRatio }) {
  /** @type {PontoNoMapa[]} */
  const itens = [];
  if (!show) return itens;
  for (const ponto of pontos || []) {
    const c = parseVertex(ponto.coordenadas);
    if (!c) continue;
    const { iconUrl, cor } = resolverIconePonto(ponto, iconesConfig);
    const { imagem, reserva } = pedidosImagemPonto("mg-ponto", { urls: iconUrl ? [iconUrl] : [], base: TAMANHO_PONTO_PX, cor }, pixelRatio);
    itens.push({
      item: { id: String(ponto.id), lngLat: /** @type {[number, number]} */ ([c.lng, c.lat]), imagem: imagem.chave, reserva: reserva.chave, titulo: String(ponto.nome || "") },
      ref: ponto,
      pedidos: { imagem, reserva },
    });
  }
  return itens;
}

/**
 * Cochos e depósitos: o nível e o farol pintados na imagem, o texto do SSOT no título (D-PROD-178/205).
 * @param {{ pontosSupl: any[], show: boolean, iconesConfig: any[], pixelRatio: number }} p
 * @returns {PontoNoMapa[]}
 */
export function itensDaSuplementacao({ pontosSupl, show, iconesConfig, pixelRatio }) {
  /** @type {PontoNoMapa[]} */
  const itens = [];
  if (!show) return itens;
  for (const ponto of pontosSupl || []) {
    const c = parseVertex(ponto.coordenadas);
    if (!c) continue;
    const { iconUrl, cor, categoria } = resolverIconeSuplementacao(ponto, iconesConfig);
    // Nível, selo ou farol diferentes = imagem diferente no MESMO ponto.
    const { titulo, selo, farol } = descreverMarcadorSuplementacao(ponto);
    const base = categoria.includes("COCHO") || categoria.includes("DEPOSITO") ? TAMANHO_SUPL_PX : TAMANHO_PONTO_PX;
    const { imagem, reserva } = pedidosImagemPonto("mg-supl", { urls: iconUrl ? [iconUrl] : [], base, cor, selo, farol }, pixelRatio);
    itens.push({
      item: { id: String(ponto.id), lngLat: /** @type {[number, number]} */ ([c.lng, c.lat]), imagem: imagem.chave, reserva: reserva.chave, titulo },
      ref: ponto,
      pedidos: { imagem, reserva },
    });
  }
  return itens;
}

/**
 * Tarefas: no ponto marcado ou, sem ele, no centro da área; o indicador do prazo pintado na imagem.
 * @param {{ tarefasMapa: any[], areas: any[], iconesConfig: any[], hoje: any, pixelRatio: number }} p
 * @returns {PontoNoMapa[]}
 */
export function itensDasTarefas({ tarefasMapa, areas, iconesConfig, hoje, pixelRatio }) {
  /** @type {PontoNoMapa[]} */
  const itens = [];
  for (const t of tarefasMapa || []) {
    let pos = parseVertex(t.coordenadas);
    if (!pos && t.area_id) {
      const area = (areas || []).find((a) => a.id === t.area_id);
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
      pixelRatio
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
  return itens;
}
