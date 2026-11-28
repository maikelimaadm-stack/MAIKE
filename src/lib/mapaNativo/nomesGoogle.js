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
 *   detalhe: { linhas: any[], chave: string, medida: { w: number, h: number } },
 * }} NomeDoPasto `detalhe` (D-PROD-382): só as linhas abaixo do nome (hectares e a extra), para o app mostrar e tirar
 *   os hectares sem refazer o nome
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
    const linhasDetalhe = niveis.tudo.linhas.filter((/** @type {any} */ l) => l.tipo !== "nome");
    const id = String(area.id);
    nomes.set(id, {
      id,
      lat: centro.lat,
      lng: centro.lng,
      nome: texto.nome,
      pf: pontoEFolga(ring),
      caixa: Number.isFinite(oeste) ? { oeste, sul, leste, norte } : null,
      niveis,
      detalhe: { linhas: linhasDetalhe, chave: chaveImagemNome(linhasDetalhe), medida: medirLinhas(linhasDetalhe) },
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

// ─── Nomes de tamanho fixo no app (D-PROD-379, D-PROD-382) ───────────────────

/**
 * No app (marcadores do mapa nativo), o nome tem tamanho FIXO na tela, como os rótulos do próprio Google: o mapa
 * nativo não muda o tamanho de um marcador durante o zoom, e refazer os nomes quando o mapa para era a "travadinha".
 * Em vez de encolher, todos os nomes trocam de nível JUNTOS (D-PROD-382): nome + hectares → nome → sigla → nenhum.
 */
export const ESCALA_NOME_FIXO = 1;
/** O nível dos nomes de tamanho fixo: os três do MapLibre e "nenhum" (todos somem juntos). */
/** @typedef {NivelNome | "nenhum"} NivelFixo */
/** Distância mínima entre um nome e outro nome ou ícone (px), a mesma do `escolherModoRotulos`. */
export const FOLGA_NOME_PX = 2;
/** O nome pode passar do pasto na tela até isto (px), como no MapLibre. */
const SOBRA_NA_AREA_PX = 6;
/** Uns poucos pastos (10%) com problema não derrubam o mapa inteiro de nível (D-PROD-126). */
const TOLERANCIA = 0.1;

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
 * Abaixo deste zoom (o do MapLibre; no Google, um a mais) nenhum nome aparece: de muito longe os nomes só poluem.
 */
export const ZOOM_MINIMO_NOMES = 12.5;
/** Para SUBIR de nível (mais detalhe) o pasto precisa sobrar esta folga a mais (px): o nível não fica indo e voltando. */
export const FOLGA_PARA_SUBIR_PX = 6;

/**
 * Como ficam os nomes de tamanho fixo nesta câmera (D-PROD-382):
 *  - `nivel`: o MESMO para todos (nunca uns sim e outros não pelo zoom): o primeiro de "tudo", "nome", "sigla" em que
 *    quase todos (90%) cabem no pasto sem ficar em cima de outro nome nem de ícone; se nem a sigla cabe, ou o zoom
 *    está abaixo de `ZOOM_MINIMO_NOMES`, "nenhum": todos somem juntos;
 *  - `desloc`: o nome que cairia em cima de um ícone (lote de outro pasto, cocho, ponto, tarefa) ou de outro nome é
 *    puxado para o lado livre (embaixo, em cima, à direita, à esquerda), sem sair do pasto;
 *  - `ocultos`: o raro nome que não acha lugar livre não aparece (nome em cima de ícone nunca).
 * `atual` (o nível de agora) dá a folga para subir de nível: o nível só sobe com sobra, e não fica trocando.
 * @param {Map<string, NomeDoPasto>} nomes @param {CameraNomes} camera
 * @param {Map<string, { lat: number, lng: number, tamanho: { w: number, h: number } }>} lotes os ícones de lote
 * @param {IconeObstaculo[]} [icones] os outros ícones (cochos, pontos, tarefas)
 * @param {NivelFixo} [atual]
 * @returns {{ nivel: NivelFixo, desloc: Map<string, { dx: number, dy: number }>, ocultos: Set<string> }}
 */
export function nomesFixosNaCamera(nomes, camera, lotes, icones = [], atual) {
  const vazio = (/** @type {NivelFixo} */ nivel) => ({ nivel, desloc: new Map(), ocultos: new Set() });
  if (Number.isFinite(camera?.zoom) && camera.zoom < ZOOM_MINIMO_NOMES) return vazio("nenhum");
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
  /** @type {Array<{ id: string, area: { x: number, y: number, w: number, h: number }, caixas: Record<NivelNome, { x: number, y: number, w: number, h: number } | null> }>} */
  const itens = [];
  for (const [id, n] of nomes) {
    const area = n.caixa ? caixaDoPastoNaTela(n.caixa, projetar) : null;
    const p = projetar(n.lat, n.lng);
    if (!area || !p) continue;
    const comLote = lotes.has(id);
    /** @type {any} */
    const caixas = {};
    for (const nv of NIVEIS) caixas[nv] = n.niveis[nv].linhas.length ? caixaDoNomeFixo(p, n.niveis[nv].medida, comLote) : null;
    itens.push({ id, area, caixas });
  }
  if (!itens.length) return vazio("tudo");
  // o maior pasto escolhe o lugar primeiro
  itens.sort((a, b) => b.area.w * b.area.h - a.area.w * a.area.h);
  const bate = (/** @type {any} */ a, /** @type {any} */ b) =>
    a.x < b.x + b.w + FOLGA_NOME_PX && b.x < a.x + a.w + FOLGA_NOME_PX && a.y < b.y + b.h + FOLGA_NOME_PX && b.y < a.y + a.h + FOLGA_NOME_PX;
  const dentro = (/** @type {any} */ c, /** @type {any} */ area) =>
    c.x >= area.x - SOBRA_NA_AREA_PX && c.y >= area.y - SOBRA_NA_AREA_PX && c.x + c.w <= area.x + area.w + SOBRA_NA_AREA_PX && c.y + c.h <= area.y + area.h + SOBRA_NA_AREA_PX;
  const ordem = NIVEIS.indexOf(/** @type {any} */ (atual));
  /** @param {NivelNome} nv @param {number} folga */
  const arrumar = (nv, folga) => {
    let problemas = 0;
    const desloc = new Map();
    const ocultos = new Set();
    /** @type {any[]} */
    const postos = [];
    for (const it of itens) {
      const c = it.caixas[nv];
      if (!c) continue;
      if (c.w + folga > it.area.w + SOBRA_NA_AREA_PX || c.h + folga > it.area.h + SOBRA_NA_AREA_PX) problemas += 1;
      const livre = (/** @type {any} */ k) => !obstaculos.some((o) => o.dono !== it.id && bate(k, o)) && !postos.some((o) => bate(k, o));
      if (livre(c)) {
        postos.push(c);
        continue;
      }
      // o primeiro lado livre, sem sair do pasto, em volta do que está em cima do nome
      const emCima = [...obstaculos.filter((o) => o.dono !== it.id && bate(c, o)), ...postos.filter((o) => bate(c, o))];
      const g = FOLGA_NOME_PX + 1;
      let achou = null;
      for (const o of emCima) {
        const lados = [
          { dx: 0, dy: o.y + o.h + g - c.y },
          { dx: 0, dy: o.y - g - c.h - c.y },
          { dx: o.x + o.w + g - c.x, dy: 0 },
          { dx: o.x - g - c.w - c.x, dy: 0 },
        ];
        achou = lados.find((d) => {
          const k = { x: c.x + d.dx, y: c.y + d.dy, w: c.w, h: c.h };
          return dentro(k, it.area) && livre(k);
        });
        if (achou) break;
      }
      if (achou) {
        desloc.set(it.id, { dx: Math.round(achou.dx), dy: Math.round(achou.dy) });
        postos.push({ x: c.x + achou.dx, y: c.y + achou.dy, w: c.w, h: c.h });
      } else {
        problemas += 1;
        ocultos.add(it.id);
      }
    }
    return { problemas, desloc, ocultos };
  };
  const limite = Math.floor(itens.length * TOLERANCIA);
  for (let i = 0; i < NIVEIS.length; i += 1) {
    const nv = /** @type {NivelNome} */ (NIVEIS[i]);
    // mais detalhe do que o de agora: só com folga a mais (o nível não fica indo e voltando)
    const r = arrumar(nv, ordem >= 0 && i < ordem ? FOLGA_PARA_SUBIR_PX : 0);
    if (r.problemas <= limite) return { nivel: nv, desloc: r.desloc, ocultos: r.ocultos };
  }
  return vazio("nenhum");
}

/**
 * Só o nível de `nomesFixosNaCamera` (o mesmo para todos, com "nenhum").
 * @param {Map<string, NomeDoPasto>} nomes @param {CameraNomes} camera
 * @param {Map<string, { lat: number, lng: number, tamanho: { w: number, h: number } }>} lotes
 * @param {IconeObstaculo[]} [icones] @param {NivelFixo} [atual]
 * @returns {NivelFixo}
 */
export function nivelDosNomesFixos(nomes, camera, lotes, icones = [], atual) {
  return nomesFixosNaCamera(nomes, camera, lotes, icones, atual).nivel;
}
