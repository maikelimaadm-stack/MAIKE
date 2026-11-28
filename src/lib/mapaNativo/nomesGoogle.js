/**
 * Nomes dos pastos no mapa do Google (D-PROD-374, etapa 3), com as mesmas regras do MapLibre (D-PROD-126/129/130/354):
 *
 * - o texto de cada nível: "tudo" (nome + ha + extra), "nome", "sigla" (`linhasDoNivel`);
 * - o nível é o MESMO para todos, escolhido por colisão e por caber no pasto, com os ícones de lote como obstáculos
 *   (`escolherModoRotulos`), no zoom e na tela de agora;
 * - o tamanho segue o zoom (`tamanhoNoZoom`: a letra do zoom × o encaixe no pasto);
 * - sem lote, o nome centrado no ponto do pasto; com lote, o topo do nome 10 px abaixo do ponto
 *   (`DESLOC_NOME_COM_LOTE_PX`), e o lote sobe para `OFFSET_LOTE_COM_NOME_PX`.
 *
 * O zoom aqui é sempre o do MapLibre (o do Google − 1): as contas são as do Mapa Geral.
 */
import { parseVertices } from "@/lib/geografia/coords.js";
import { centroideArea, escolherModoRotulos, pontoEFolga, siglaDaArea, textoHectares } from "@/lib/maplibre/mapaGeralRender.js";
import { caixaDoLote } from "@/lib/maplibre/lotesNoMapa.js";
import { DESLOC_NOME_COM_LOTE_PX, caixaDoNome, chaveImagemNome, linhasDoNivel, medirLinhas, tamanhoNoZoom } from "@/lib/maplibre/nomesNoMapa.js";

/** @typedef {import('@/lib/maplibre/nomesNoMapa.js').NivelNome} NivelNome */
/** @type {NivelNome[]} */
export const NIVEIS = ["tudo", "nome", "sigla"];

/**
 * Nome de um pasto: ponto, folga (encaixe), caixa da área e os três níveis (linhas, chave da imagem, medida).
 * @typedef {{
 *   id: string,
 *   lat: number,
 *   lng: number,
 *   nome: string,
 *   pf: { lat: number, folga: number } | null,
 *   caixa: { oeste: number, sul: number, leste: number, norte: number } | null,
 *   niveis: Record<NivelNome, { linhas: any[], chave: string, medida: { w: number, h: number } }>,
 * }} NomeDoPasto
 */

/**
 * Os nomes dos pastos (texto de cada nível e a geometria). Só depois que a letra está pronta (`esperarFonteDosNomes`).
 * @param {any[]} areas @param {{ extraTextFn?: ((area: any) => string | null) | null, showHectares?: boolean }} opcoes
 * @returns {Map<string, NomeDoPasto>}
 */
export function montarNomes(areas, { extraTextFn = null, showHectares = true } = {}) {
  /** @type {Map<string, NomeDoPasto>} */
  const nomes = new Map();
  for (const area of areas || []) {
    const centro = centroideArea(area);
    if (!centro) continue;
    const ring = parseVertices(area?.coordenadas?.coords);
    let oeste = Infinity, sul = Infinity, leste = -Infinity, norte = -Infinity;
    for (const p of ring) {
      oeste = Math.min(oeste, p.lng);
      leste = Math.max(leste, p.lng);
      sul = Math.min(sul, p.lat);
      norte = Math.max(norte, p.lat);
    }
    const texto = {
      nome: area.nome || "",
      sigla: siglaDaArea(area),
      ha: showHectares ? textoHectares(area) : null,
      extra: (extraTextFn ? extraTextFn(area) : null) || null,
    };
    /** @type {any} */
    const niveis = {};
    for (const nivel of NIVEIS) {
      const linhas = linhasDoNivel(texto, nivel);
      niveis[nivel] = { linhas, chave: chaveImagemNome(linhas), medida: medirLinhas(linhas) };
    }
    const id = String(area.id);
    nomes.set(id, {
      id,
      lat: centro.lat,
      lng: centro.lng,
      nome: texto.nome,
      pf: pontoEFolga(ring),
      caixa: Number.isFinite(oeste) ? { oeste, sul, leste, norte } : null,
      niveis,
    });
  }
  return nomes;
}

/**
 * A caixa do pasto na tela (px): os QUATRO cantos projetados (com o mapa girado, dois cantos opostos podem ficar
 * alinhados e a caixa sairia achatada).
 * @param {{ oeste: number, sul: number, leste: number, norte: number }} b
 * @param {(lat: number, lng: number) => ({ x: number, y: number } | null)} projetar
 * @returns {{ x: number, y: number, w: number, h: number } | null}
 */
export function caixaDoPastoNaTela(b, projetar) {
  const cantos = [projetar(b.norte, b.oeste), projetar(b.norte, b.leste), projetar(b.sul, b.oeste), projetar(b.sul, b.leste)];
  if (cantos.some((c) => !c)) return null;
  const xs = cantos.map((c) => /** @type {{ x: number }} */ (c).x);
  const ys = cantos.map((c) => /** @type {{ y: number }} */ (c).y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Câmera para a escolha do nível: o zoom do MapLibre, a projeção (ponto → px da tela) e o tamanho da tela.
 * @typedef {{ zoom: number, projetar: (lat: number, lng: number) => ({ x: number, y: number } | null), largura: number, altura: number }} CameraNomes
 */

/**
 * O nível dos nomes nesta câmera, o mesmo para todos (D-PROD-126). `soNaTela`: durante o movimento, decide só pelos
 * pastos à vista (D-PROD-347).
 * @param {Map<string, NomeDoPasto>} nomes
 * @param {CameraNomes} camera
 * @param {Map<string, { lat: number, lng: number, tamanho: { w: number, h: number } }>} lotes os ícones de lote (obstáculos)
 * @param {{ soNaTela?: boolean }} [opcoes]
 * @returns {NivelNome}
 */
export function nivelDosNomes(nomes, camera, lotes, { soNaTela = false } = {}) {
  const { zoom, projetar, largura, altura } = camera;
  /** @type {Set<string> | null} */
  const alvo = soNaTela ? new Set() : null;
  const itens = [];
  for (const [id, n] of nomes) {
    const b = n.caixa;
    if (!b) continue;
    const caixa = caixaDoPastoNaTela(b, projetar);
    const p = projetar(n.lat, n.lng);
    if (!caixa || !p) continue;
    const x0 = caixa.x, x1 = caixa.x + caixa.w;
    const y0 = caixa.y, y1 = caixa.y + caixa.h;
    if (alvo) {
      if (x1 < -largura / 4 || x0 > largura * 1.25 || y1 < -altura / 4 || y0 > altura * 1.25) continue;
      alvo.add(id);
    }
    const comLote = lotes.has(id);
    itens.push({
      id,
      area: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      tudo: caixaDoNome(p, n.niveis.tudo.medida, zoom, comLote),
      nome: caixaDoNome(p, n.niveis.nome.medida, zoom, comLote),
    });
  }
  /** @type {Array<{ x: number, y: number, w: number, h: number, dono: string }>} */
  const obstaculos = [];
  for (const [id, l] of lotes) {
    if (alvo && !alvo.has(id)) continue;
    const p = projetar(l.lat, l.lng);
    if (p) obstaculos.push({ ...caixaDoLote(p, nomes.has(id), l.tamanho), dono: id });
  }
  if (!itens.length) return "tudo";
  return /** @type {NivelNome} */ (escolherModoRotulos(itens, { tudo: obstaculos, nome: obstaculos }));
}

/**
 * Como o nome de um pasto vai no mapa, no nível: a chave da imagem, o tamanho no zoom e a âncora.
 * @param {NomeDoPasto} n @param {NivelNome} nivel @param {boolean} comLote
 */
export function colocacaoDoNome(n, nivel, comLote) {
  const d = n.niveis[nivel];
  return {
    chave: d.chave,
    linhas: d.linhas,
    /** @param {number} zoom zoom do MapLibre */
    escala: (zoom) => tamanhoNoZoom(d.medida, n.pf, zoom),
    ancora: /** @type {"centro" | "topo"} */ (comLote ? "topo" : "centro"),
    dy: comLote ? DESLOC_NOME_COM_LOTE_PX[1] : 0,
  };
}

// ─── Nomes de tamanho fixo no app (D-PROD-379) ───────────────────────────────

/**
 * No app (marcadores do mapa nativo), o nome tem tamanho FIXO na tela, como os rótulos do próprio Google: o mapa
 * nativo não muda o tamanho de um marcador durante o zoom, e refazer os nomes quando o mapa para era a "travadinha".
 * Em vez de encolher, o nome troca de nível (tudo → nome → sigla) e, se ainda não couber, some.
 */
export const ESCALA_NOME_FIXO = 1;
/** Pasto menor que isto na tela (px, no lado menor) não mostra nome: é pequeno demais para ler. */
export const LADO_MINIMO_PASTO_PX = 14;
/** Distância mínima entre um nome e outro nome ou ícone (px). */
export const FOLGA_NOME_PX = 2;

/**
 * Caixa (px da tela) do nome de tamanho fixo: sem lote, centrado no ponto; com lote, o topo 10 px abaixo do ponto.
 * @param {{ x: number, y: number }} p @param {{ w: number, h: number }} medida @param {boolean} comLote
 */
export function caixaDoNomeFixo(p, medida, comLote) {
  const w = medida.w * ESCALA_NOME_FIXO;
  const h = medida.h * ESCALA_NOME_FIXO;
  return { x: p.x - w / 2, y: comLote ? p.y + DESLOC_NOME_COM_LOTE_PX[1] : p.y - h / 2, w, h };
}

/**
 * Um ícone do Mapa Geral como obstáculo dos nomes: ponto, tamanho (px) e deslocamento do centro; `dono` = o pasto
 * dele (o ícone do próprio pasto não conta contra o nome dele).
 * @typedef {{ lat: number, lng: number, w: number, h: number, dx?: number, dy?: number, dono?: string }} IconeObstaculo
 */

/**
 * O nível (o mesmo para todos, D-PROD-126) e QUAIS nomes aparecem, com o tamanho fixo, nesta câmera.
 * - o nível: o primeiro de "tudo", "nome", "sigla" em que quase todos cabem no pasto sem bater (`escolherModoRotulos`);
 * - quais: do maior pasto para o menor, o nome aparece se o pasto não é pequeno demais na tela e o nome não bate em
 *   ícone nenhum nem num nome que já entrou. Assim nenhum nome fica coberto ou cortado por ícone.
 * @param {Map<string, NomeDoPasto>} nomes @param {CameraNomes} camera
 * @param {Map<string, { lat: number, lng: number, tamanho: { w: number, h: number } }>} lotes os ícones de lote
 * @param {IconeObstaculo[]} [icones] os outros ícones (cochos, pontos, tarefas)
 * @returns {{ nivel: NivelNome, visiveis: Set<string> }}
 */
export function nomesFixosNaCamera(nomes, camera, lotes, icones = []) {
  const { projetar } = camera;
  /** @type {Array<{ x: number, y: number, w: number, h: number, dono?: string }>} */
  const obstaculos = [];
  for (const [id, l] of lotes) {
    const p = projetar(l.lat, l.lng);
    if (p) obstaculos.push({ ...caixaDoLote(p, nomes.has(id), l.tamanho), dono: id });
  }
  for (const ic of icones) {
    const p = projetar(ic.lat, ic.lng);
    if (!p) continue;
    obstaculos.push({ x: p.x + (ic.dx || 0) - ic.w / 2, y: p.y + (ic.dy || 0) - ic.h / 2, w: ic.w, h: ic.h, dono: ic.dono });
  }
  const itens = [];
  for (const [id, n] of nomes) {
    const b = n.caixa;
    if (!b) continue;
    const area = caixaDoPastoNaTela(b, projetar);
    const p = projetar(n.lat, n.lng);
    if (!area || !p) continue;
    const comLote = lotes.has(id);
    itens.push({
      id,
      n,
      p,
      area,
      comLote,
      tudo: caixaDoNomeFixo(p, n.niveis.tudo.medida, comLote),
      nome: caixaDoNomeFixo(p, n.niveis.nome.medida, comLote),
    });
  }
  if (!itens.length) return { nivel: "tudo", visiveis: new Set() };
  const nivel = /** @type {NivelNome} */ (escolherModoRotulos(itens, { tudo: obstaculos, nome: obstaculos }));
  const bate = (/** @type {any} */ x, /** @type {any} */ y) =>
    x.x < y.x + y.w + FOLGA_NOME_PX && y.x < x.x + x.w + FOLGA_NOME_PX && x.y < y.y + y.h + FOLGA_NOME_PX && y.y < x.y + x.h + FOLGA_NOME_PX;
  /** @type {Set<string>} */
  const visiveis = new Set();
  /** @type {Array<{ x: number, y: number, w: number, h: number }>} */
  const aceitos = [];
  const porTamanho = [...itens].sort((x, y) => y.area.w * y.area.h - x.area.w * x.area.h);
  for (const it of porTamanho) {
    if (!it.n.niveis[nivel].linhas.length) continue;
    if (Math.min(it.area.w, it.area.h) < LADO_MINIMO_PASTO_PX) continue;
    const caixa = nivel === "tudo" ? it.tudo : nivel === "nome" ? it.nome : caixaDoNomeFixo(it.p, it.n.niveis.sigla.medida, it.comLote);
    if (obstaculos.some((o) => o.dono !== it.id && bate(caixa, o))) continue;
    if (aceitos.some((o) => bate(caixa, o))) continue;
    aceitos.push(caixa);
    visiveis.add(it.id);
  }
  return { nivel, visiveis };
}
