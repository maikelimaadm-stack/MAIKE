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
    const a = projetar(b.norte, b.oeste);
    const c = projetar(b.sul, b.leste);
    const p = projetar(n.lat, n.lng);
    if (!a || !c || !p) continue;
    const x0 = Math.min(a.x, c.x), x1 = Math.max(a.x, c.x);
    const y0 = Math.min(a.y, c.y), y1 = Math.max(a.y, c.y);
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
