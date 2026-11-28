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
export const ESCALA_NOME_FIXO = 0.85;
/** O nível dos nomes de tamanho fixo: os três do MapLibre e "nenhum" (todos somem juntos). */
/** @typedef {NivelNome | "nenhum"} NivelFixo */
/** Distância mínima entre um nome e outro nome ou ícone (px), a mesma do `escolherModoRotulos`. */
export const FOLGA_NOME_PX = 2;
/** O nome pode passar do pasto na tela até isto (px), como no MapLibre. */
const SOBRA_NA_AREA_PX = 6;
/** Pasto menor do que isto na tela (px, o lado menor) já é um pontinho: conta como problema para o nível. */
export const LADO_MINIMO_PASTO_PX = 12;
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
export const ZOOM_MINIMO_NOMES = 11;
/**
 * Na sigla (o último nível antes de sumir), até esta parte dos nomes pode sair para os outros continuarem: de longe, os
 * nomes dos pastos pequenos saem primeiro e os dos grandes ficam, como os rótulos do Google. Acima disto, todos somem.
 */
export const TOLERANCIA_NA_SIGLA = 0.5;
/** Com mais nomes do que isto, só os pastos perto da tela (uma tela para cada lado) entram na conta e no mapa. */
export const NOMES_SEM_RECORTE = 300;
/**
 * Folga a mais (px) para SUBIR de nível. Zero (D-PROD-382, pedido do proprietário): o nome + hectares aparece e some no
 * MESMO zoom, indo ou voltando — com folga, era preciso afastar mais do que se tinha aproximado.
 */
export const FOLGA_PARA_SUBIR_PX = 0;
/**
 * O nome só é puxado para fora de um ícone até isto (px) e até esta parte do lado menor do pasto na tela: mais do que
 * isso ele ficava longe do meio do pasto ("descentralizado"); sem lugar perto, ele não aparece.
 */
// Zero (pedido do proprietário): o nome NÃO procura lugar ao lado; fica no lugar dele ou, com um ícone em cima, não aparece.
export const DESLOC_MAXIMO_PX = 0;
export const DESLOC_MAXIMO_DO_PASTO = 0.35;

/**
 * Como ficam os nomes de tamanho fixo nesta câmera (D-PROD-382):
 *  - `nivel`: o MESMO para todos (nunca uns sim e outros não pelo zoom): o primeiro de "tudo", "nome", "sigla" em que
 *    quase todos (90%) cabem no pasto sem ficar em cima de outro nome nem de ícone; se nem a sigla cabe, ou o zoom
 *    está abaixo de `ZOOM_MINIMO_NOMES`, "nenhum": todos somem juntos;
 *  - `desloc`: o nome que cairia em cima de um ícone (lote de outro pasto, cocho, ponto, tarefa) ou de outro nome é
 *    puxado para o lado livre (embaixo, em cima, à direita, à esquerda), sem sair do pasto;
 *  - `ocultos`: o nome que não acha lugar livre não aparece (nome em cima de ícone nunca). Na sigla, de longe, os
 *    nomes dos pastos pequenos saem primeiro (até `TOLERANCIA_NA_SIGLA`) e os dos grandes ficam, como no Google.
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
  // muitos nomes: só o que está perto da tela (uma tela para cada lado) entra na conta
  const recorte =
    nomes.size > NOMES_SEM_RECORTE && camera.largura > 0 && camera.altura > 0
      ? { x0: -camera.largura, y0: -camera.altura, x1: 2 * camera.largura, y1: 2 * camera.altura }
      : null;
  const noRecorte = (/** @type {{ x: number, y: number }} */ p) => !recorte || (p.x >= recorte.x0 && p.x <= recorte.x1 && p.y >= recorte.y0 && p.y <= recorte.y1);
  /** @type {Set<string>} */
  const longe = new Set();
  /** @type {Array<{ x: number, y: number, w: number, h: number, dono?: string }>} */
  const obstaculos = [];
  for (const [id, l] of lotes) {
    const p = projetar(l.lat, l.lng);
    if (p && noRecorte(p)) obstaculos.push({ ...caixaDoLote(p, nomes.has(id), l.tamanho), dono: id });
  }
  for (const ic of icones) {
    const p = projetar(ic.lat, ic.lng);
    if (!p || !noRecorte(p)) continue;
    obstaculos.push({ x: p.x + (ic.dx || 0) - ic.w / 2, y: p.y + (ic.dy || 0) - ic.h / 2, w: ic.w, h: ic.h, dono: ic.dono });
  }
  /** @type {Array<{ id: string, area: { x: number, y: number, w: number, h: number }, caixas: Record<NivelNome, { x: number, y: number, w: number, h: number } | null> }>} */
  const itens = [];
  for (const [id, n] of nomes) {
    const area = n.caixa ? caixaDoPastoNaTela(n.caixa, projetar) : null;
    const p = projetar(n.lat, n.lng);
    if (!area || !p) continue;
    // fazenda com muitos pastos: o que está longe da tela fica de fora (entra quando o mapa chega perto)
    if (recorte && (area.x > recorte.x1 || area.x + area.w < recorte.x0 || area.y > recorte.y1 || area.y + area.h < recorte.y0)) {
      longe.add(id);
      continue;
    }
    const comLote = lotes.has(id);
    /** @type {any} */
    const caixas = {};
    for (const nv of NIVEIS) caixas[nv] = n.niveis[nv].linhas.length ? caixaDoNomeFixo(p, n.niveis[nv].medida, comLote) : null;
    itens.push({ id, area, caixas });
  }
  if (!itens.length) return { nivel: "tudo", desloc: new Map(), ocultos: longe };
  // o maior pasto escolhe o lugar primeiro
  itens.sort((a, b) => b.area.w * b.area.h - a.area.w * a.area.h);
  /** @param {any} a @param {any} b @param {number} [extra] folga a mais (para subir de nível) */
  const bate = (a, b, extra = 0) => {
    const f = FOLGA_NOME_PX + extra;
    return a.x < b.x + b.w + f && b.x < a.x + a.w + f && a.y < b.y + b.h + f && b.y < a.y + a.h + f;
  };
  // o nome puxado para o lado continua com o meio dentro do pasto
  const dentro = (/** @type {any} */ c, /** @type {any} */ area) => {
    const mx = c.x + c.w / 2;
    const my = c.y + c.h / 2;
    return mx >= area.x - SOBRA_NA_AREA_PX && mx <= area.x + area.w + SOBRA_NA_AREA_PX && my >= area.y - SOBRA_NA_AREA_PX && my <= area.y + area.h + SOBRA_NA_AREA_PX;
  };
  const ordem = NIVEIS.indexOf(/** @type {any} */ (atual));
  /** @param {NivelNome} nv @param {number} folga @param {boolean} [semMiudos] o pasto que virou um pontinho fica sem nome */
  const arrumar = (nv, folga, semMiudos = false) => {
    let problemas = 0;
    const desloc = new Map();
    const ocultos = new Set(longe);
    /** @type {any[]} */
    const postos = [];
    for (const it of itens) {
      const c = it.caixas[nv];
      if (!c) continue;
      // como os rótulos do Google, o nome pode passar da divisa do pasto (o que o derruba é bater noutro nome ou num
      // ícone); só o pasto que virou um pontinho na tela conta como problema
      if (Math.min(it.area.w, it.area.h) < LADO_MINIMO_PASTO_PX + folga) {
        problemas += 1;
        if (semMiudos) {
          ocultos.add(it.id);
          continue;
        }
      }
      // no lugar dele, o nome fica logo abaixo do lote do próprio pasto (o par ícone + nome); puxado para o lado, o
      // lote do próprio pasto também é obstáculo: o nome nunca fica em cima dele
      const livre = (/** @type {any} */ k, movido = false) =>
        !obstaculos.some((o) => (movido || o.dono !== it.id) && bate(k, o, folga)) && !postos.some((o) => bate(k, o, folga));
      const maximo = DESLOC_MAXIMO_PX;
      if (livre(c)) {
        postos.push(c);
        continue;
      }
      // nome em cima de outro NOME: não se empurra (os nomes iam se espalhando); conta como problema — o nível desce
      // para todos e, na sigla, o do pasto menor sai. Só de ÍCONE o nome desvia.
      if (postos.some((o) => bate(c, o, folga))) {
        problemas += 1;
        ocultos.add(it.id);
        continue;
      }
      const emCima = [...obstaculos.filter((o) => o.dono !== it.id && bate(c, o)), ...postos.filter((o) => bate(c, o))];
      const g = FOLGA_NOME_PX + 1;
      // o MENOR desvio que tira o nome de cima de tudo (embaixo, em cima, à direita ou à esquerda de cada obstáculo):
      // o nome fica o mais perto possível do lugar dele, mesmo que passe da divisa do pasto
      /** @type {{ dx: number, dy: number } | null} */
      let achou = null;
      for (const o of emCima) {
        const lados = [
          { dx: 0, dy: o.y + o.h + g - c.y },
          { dx: 0, dy: o.y - g - c.h - c.y },
          { dx: o.x + o.w + g - c.x, dy: 0 },
          { dx: o.x - g - c.w - c.x, dy: 0 },
        ];
        for (const d of lados) {
          const dist = Math.abs(d.dx) + Math.abs(d.dy);
          if (dist > maximo || (achou && dist >= Math.abs(achou.dx) + Math.abs(achou.dy))) continue;
          if (livre({ x: c.x + d.dx, y: c.y + d.dy, w: c.w, h: c.h }, true)) achou = d;
        }
      }
      if (achou) {
        // em passos de 4 px, sempre para mais longe do obstáculo: o deslocamento muda menos vezes (o nome é refeito menos)
        const passo = (/** @type {number} */ v) => Math.sign(v) * Math.ceil(Math.abs(v) / 4) * 4;
        desloc.set(it.id, { dx: passo(achou.dx), dy: passo(achou.dy) });
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
    // todos juntos (pedido do proprietário): quem tem um ícone em cima aparece assim mesmo; só o que está longe da
    // tela (fazenda com muitos pastos) fica de fora
    if (r.problemas <= limite) return { nivel: nv, desloc: r.desloc, ocultos: new Set(longe) };
  }
  // de longe: a sigla dos pastos maiores fica; a dos pequenos (sem lugar, ou um pontinho na tela) sai
  const r = arrumar("sigla", 0, true);
  if (r.problemas <= Math.floor(itens.length * TOLERANCIA_NA_SIGLA)) return { nivel: "sigla", desloc: r.desloc, ocultos: new Set(longe) };
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
