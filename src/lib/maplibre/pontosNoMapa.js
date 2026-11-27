/*
 * GUIA DE EDIÇÃO — PONTOS DESENHADOS PELO MAPA (D-PROD-352): tamanhos (TAMANHO_SUPL_PX, TAMANHO_PONTO_PX, TAMANHO_TAREFA_PX),
 * círculo de quando não há figura (RAIO_CIRCULO_PX), selo e farol do cocho (SELO_SUPL, FAROL_SUPL, CORES_SELO_SUPLEMENTACAO),
 * indicador da tarefa (INDICADOR_TAREFA) e a ordem das camadas (ORDEM_CLICAVEIS).
 * Índice completo: docs/design/GUIA-MAPA-E-ICONES.md
 */
/**
 * Cochos/depósitos, pontos de referência (bebedouro incluído) e tarefas do Mapa Geral desenhados pelo PRÓPRIO mapa
 * (D-PROD-352, "mapa leve", etapa 3). Mesmo padrão dos lotes (D-PROD-349, `lotesNoMapa.js`):
 *
 *  - cada grupo é uma fonte GeoJSON e uma camada `symbol`; a imagem de cada ponto é montada num canvas no
 *    devicePixelRatio — a figura (sem achatar), ou o círculo da cor quando não há figura, e por cima o selo e o farol
 *    do cocho ou o indicador da tarefa, nas mesmas posições dos marcadores HTML antigos;
 *  - chave da imagem = o que ela desenha: pontos iguais dividem a imagem, e a mesma chave nunca é desenhada de novo
 *    (o cache, a fila em fatias e o limite de tentativas são os dos lotes);
 *  - reserva por ponto (`coalesce`): o círculo da cor com o selo/farol/indicador, desenhado sem figura nenhuma. Vale
 *    quando a figura não carrega ou quando o canvas fica "sujo" (figura de outra origem sem CORS): o ponto nunca some;
 *  - ordem igual ao z-index de antes: cocho < ponto < lote < tarefa < tarefa Urgente (`ORDEM_CLICAVEIS`).
 */
import {
  LOTES_LAYER_ID,
  baseDoTexto,
  carregarFigura,
  contextoDeDesenho,
  esquecerFigura,
  imagemPronta,
  lerPixelsDoCanvas,
  porImagemNoMapa,
} from "./lotesNoMapa.js";
import { iconeSemAchatar } from "./iconeSemAchatar.js";

export const SUPL_SOURCE_ID = "mg-supl";
export const SUPL_LAYER_ID = "mg-supl";
export const PONTOS_SOURCE_ID = "mg-pontos";
export const PONTOS_LAYER_ID = "mg-pontos";
export const TAREFAS_SOURCE_ID = "mg-tarefas";
export const TAREFAS_LAYER_ID = "mg-tarefas";

/**
 * Camadas clicáveis do Mapa Geral, DE CIMA PARA BAIXO. Repete o z-index dos marcadores HTML antigos:
 * tarefa Urgente 3000 > tarefa 2500 > lote com alerta 2000 > lote 1000 > ponto 800 > cocho 500.
 * (Urgente por cima das outras tarefas é o `symbol-sort-key` da camada das tarefas.)
 */
export const ORDEM_CLICAVEIS = Object.freeze([TAREFAS_LAYER_ID, LOTES_LAYER_ID, PONTOS_LAYER_ID, SUPL_LAYER_ID]);
/** As camadas deste arquivo (sem os lotes). */
export const CAMADAS_PONTOS = Object.freeze([TAREFAS_LAYER_ID, PONTOS_LAYER_ID, SUPL_LAYER_ID]);

/** Lado maior da figura (px): cocho e depósito 36, outras categorias de suplementação 40, ponto 40, tarefa 40. */
export const TAMANHO_SUPL_PX = 36;
export const TAMANHO_PONTO_PX = 40;
export const TAMANHO_TAREFA_PX = 40;
/** Sem figura (ou figura que não carregou): círculo da cor, raio 20, borda branca de 3 px e sombra `0 1px 3px`. */
export const RAIO_CIRCULO_PX = 20;
const BORDA_CIRCULO_PX = 3;
/** Folga em volta do que tem sombra (o círculo, o selo e o farol), para a sombra caber na imagem. */
const FOLGA_SOMBRA_PX = 4;

/** Selo do cocho/depósito (D-PROD-178): centro 13 px à direita e 14 px acima do centro do ícone; 16 px, borda 2 px. */
export const SELO_SUPL = Object.freeze({ dx: 13, dy: -14, diametro: 16, borda: 2, fontePx: 10 });
/** Farol da leitura de cocho (D-PROD-205): centro 13 px à direita e 12 px abaixo do centro do ícone; 12 px, borda 2 px. */
export const FAROL_SUPL = Object.freeze({ dx: 13, dy: 12, diametro: 12, borda: 2 });
/**
 * Indicador da tarefa (`aplicarIndicadorTarefa`): pílula de 22 px de altura e no mínimo 22 de largura, 7 px para fora
 * da direita do ícone e 4 px acima do pé dele; borda branca de 2 px, texto branco 10 px negrito (Arial).
 */
export const INDICADOR_TAREFA = Object.freeze({ direita: -7, baixo: 4, larguraMin: 22, altura: 22, folga: 2, borda: 2, fonte: "700 10px Arial, sans-serif" });

/**
 * Cores do selo do cocho/depósito (D-PROD-178): "?" cinza (nível neutro) e "!" âmbar (depósito acima do limite).
 * Contraste do texto ≥ 4,5:1.
 */
export const CORES_SELO_SUPLEMENTACAO = Object.freeze({
  neutro: Object.freeze({ fundo: "#6b7280", texto: "#ffffff" }),
  excesso: Object.freeze({ fundo: "#f59e0b", texto: "#1f2937" }),
});

const FONTE_SELO = "Inter, Arial, sans-serif";

/**
 * @typedef {import("./lotesNoMapa.js").Raster} Raster
 * @typedef {import("./lotesNoMapa.js").PedidoImagem} PedidoImagem
 * @typedef {null | { tipo: "neutro" | "excesso", texto: string }} Selo
 * @typedef {null | { cor: string, hex: string }} Farol
 * @typedef {null | { texto: string, cor: string }} Indicador
 * @typedef {{ urls: string[], base: number, cor: string, selo?: Selo, farol?: Farol, indicador?: Indicador }} DesenhoPonto
 */

// ─── Chaves ─────────────────────────────────────────────────────────────────

/** Resumo curto de uma URL (as do cocho são data URLs de vários KB): FNV-1a de 32 bits + tamanho. @param {string} s */
export function resumoDaUrl(s) {
  const t = String(s || "");
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i += 1) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(36)}${t.length.toString(36)}`;
}

/** O que vai em cima da figura, para a chave. @param {DesenhoPonto} d */
const enfeites = (d) => [d.selo?.tipo || "", d.farol?.hex || "", d.indicador ? `${d.indicador.texto}~${d.indicador.cor}` : ""].join("|");

/**
 * Chave da imagem: grupo + figuras + tamanho + cor + enfeites. Mesma chave = mesma imagem.
 * @param {string} grupo "mg-supl" | "mg-ponto" | "mg-tarefa" @param {DesenhoPonto} d
 */
export function chaveImagemPonto(grupo, d) {
  return `${grupo}|${d.urls.map(resumoDaUrl).join("+")}|${d.base}|${d.cor}|${enfeites(d)}`;
}

/** Chave da reserva (círculo da cor + enfeites, sem figura). @param {string} grupo @param {DesenhoPonto} d */
export function chaveReservaPonto(grupo, d) {
  return `${grupo}-res|${d.cor}|${enfeites(d)}`;
}

/** Imagem de ponto, cocho ou tarefa (ou a reserva de um deles)? @param {string} chave */
export const ehImagemDePonto = (chave) => /^mg-(supl|ponto|tarefa)(-res)?\|/.test(String(chave));
/** Predicado da poda de um grupo ("mg-supl", "mg-ponto", "mg-tarefa"). @param {string} grupo */
export const imagemDoGrupo = (grupo) => (/** @type {string} */ chave) => chave.startsWith(`${grupo}|`) || chave.startsWith(`${grupo}-res|`);

// ─── Desenho (canvas) ───────────────────────────────────────────────────────

/** @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y @param {number} r */
function circulo(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

/** Pílula (retângulo de cantos totalmente redondos). @param {CanvasRenderingContext2D} ctx */
function pilula(ctx, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h) {
  const r = Math.min(w, h) / 2;
  ctx.beginPath();
  ctx.arc(x + r, y + h / 2, r, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.arc(x + w - r, y + h / 2, r, -Math.PI / 2, Math.PI / 2);
  ctx.closePath();
}

/** Sombra CSS `0 <dy>px <blur>px <cor>` no canvas (a sombra não segue a escala: px reais). */
function sombra(/** @type {CanvasRenderingContext2D} */ ctx, /** @type {number} */ dy, /** @type {number} */ blur, /** @type {string} */ cor, /** @type {number} */ pr) {
  ctx.shadowColor = cor;
  ctx.shadowBlur = blur * pr;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = dy * pr;
}
const semSombra = (/** @type {CanvasRenderingContext2D} */ ctx) => {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
};

/** Bolinha com borda branca (border-box) e sombra `0 1px 2px rgba(0,0,0,.35)`: o selo e o farol. */
function bolinha(/** @type {CanvasRenderingContext2D} */ ctx, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ diametro, /** @type {number} */ borda, /** @type {string} */ fundo, /** @type {number} */ pr) {
  sombra(ctx, 1, 2, "rgba(0,0,0,.35)", pr);
  ctx.fillStyle = "#ffffff";
  circulo(ctx, x, y, diametro / 2);
  ctx.fill();
  semSombra(ctx);
  ctx.fillStyle = fundo;
  circulo(ctx, x, y, diametro / 2 - borda);
  ctx.fill();
}

/** Largura do indicador da tarefa (CSS: `min-width:22px; padding:0 2px; border:2px`, border-box). */
function larguraIndicador(/** @type {CanvasRenderingContext2D | null} */ ctx, /** @type {string} */ texto) {
  const I = INDICADOR_TAREFA;
  let w = 0;
  if (ctx) {
    ctx.font = I.fonte;
    w = Number(ctx.measureText?.(texto)?.width) || 0;
  }
  return Math.max(I.larguraMin, Math.ceil(w) + 2 * I.folga + 2 * I.borda);
}

/** Primeira figura que carrega (as que falham são esquecidas: a próxima tentativa recarrega). @param {string[]} urls */
async function primeiraFigura(urls) {
  for (const url of urls) {
    const fig = await carregarFigura(url);
    if (fig) return fig;
    esquecerFigura(url);
  }
  return null;
}

/**
 * Monta a imagem de um ponto como o marcador HTML a mostrava: a figura no centro (lado maior = `base`, sem achatar)
 * — ou o círculo da cor quando não há figura —, e por cima o selo e o farol (cocho) ou o indicador (tarefa). A
 * imagem é simétrica em volta do centro do ícone: a âncora `center` da camada cai no mesmo ponto que a do marcador.
 *
 * Com `urls` e nenhuma carregando (ou com o canvas "sujo" por uma figura de outra origem) devolve null: o ponto fica
 * com a reserva. Sem `urls` desenha o círculo (é o normal de um ponto sem ícone cadastrado, não é falha).
 * @param {DesenhoPonto & { pixelRatio: number }} d
 * @returns {Promise<Raster | null>}
 */
export async function desenharImagemPonto(d) {
  const pr = d.pixelRatio;
  const fig = d.urls.length ? await primeiraFigura(d.urls) : null;
  if (d.urls.length && !fig) return null;
  const corpo = fig ? iconeSemAchatar(fig.naturalWidth, fig.naturalHeight, d.base) : { width: 2 * RAIO_CIRCULO_PX, height: 2 * RAIO_CIRCULO_PX };
  const folga = fig ? 0 : FOLGA_SOMBRA_PX;
  let hx = corpo.width / 2 + folga;
  let hy = corpo.height / 2 + folga;
  if (d.selo) {
    hx = Math.max(hx, SELO_SUPL.dx + SELO_SUPL.diametro / 2 + FOLGA_SOMBRA_PX);
    hy = Math.max(hy, -SELO_SUPL.dy + SELO_SUPL.diametro / 2 + FOLGA_SOMBRA_PX);
  }
  if (d.farol) {
    hx = Math.max(hx, FAROL_SUPL.dx + FAROL_SUPL.diametro / 2 + FOLGA_SOMBRA_PX);
    hy = Math.max(hy, FAROL_SUPL.dy + FAROL_SUPL.diametro / 2 + FOLGA_SOMBRA_PX);
  }
  const I = INDICADOR_TAREFA;
  // a largura do indicador depende do texto: mede antes de dimensionar a imagem
  const larguraInd = d.indicador ? larguraIndicador(contextoDeDesenho(1, 1), d.indicador.texto) : 0;
  if (d.indicador) {
    hx = Math.max(hx, corpo.width / 2 - I.direita, larguraInd - corpo.width / 2 + I.direita);
    hy = Math.max(hy, Math.abs(corpo.height / 2 - I.baixo - I.altura), corpo.height / 2 - I.baixo);
  }
  const W = 2 * Math.ceil(hx);
  const H = 2 * Math.ceil(hy);
  const largura = Math.max(1, Math.round(W * pr));
  const altura = Math.max(1, Math.round(H * pr));
  const ctx = contextoDeDesenho(largura, altura);
  if (!ctx) return null;
  ctx.setTransform(pr, 0, 0, pr, 0, 0);
  const cx = W / 2;
  const cy = H / 2;

  if (fig) {
    ctx.drawImage(fig, cx - corpo.width / 2, cy - corpo.height / 2, corpo.width, corpo.height);
  } else {
    // o fallback do marcador antigo: círculo da cor, borda branca de 3 px por dentro, sombra 0 1px 3px rgba(0,0,0,.35)
    sombra(ctx, 1, 3, "rgba(0,0,0,.35)", pr);
    ctx.fillStyle = "#ffffff";
    circulo(ctx, cx, cy, RAIO_CIRCULO_PX);
    ctx.fill();
    semSombra(ctx);
    ctx.fillStyle = d.cor;
    circulo(ctx, cx, cy, RAIO_CIRCULO_PX - BORDA_CIRCULO_PX);
    ctx.fill();
  }

  if (d.selo) {
    const cores = CORES_SELO_SUPLEMENTACAO[d.selo.tipo] || CORES_SELO_SUPLEMENTACAO.neutro;
    const x = cx + SELO_SUPL.dx;
    const y = cy + SELO_SUPL.dy;
    bolinha(ctx, x, y, SELO_SUPL.diametro, SELO_SUPL.borda, cores.fundo, pr);
    ctx.font = `700 ${SELO_SUPL.fontePx}px ${FONTE_SELO}`;
    ctx.textAlign = "center";
    ctx.fillStyle = cores.texto;
    ctx.fillText(d.selo.texto, x, baseDoTexto(ctx, d.selo.texto, y));
  }
  if (d.farol) bolinha(ctx, cx + FAROL_SUPL.dx, cy + FAROL_SUPL.dy, FAROL_SUPL.diametro, FAROL_SUPL.borda, d.farol.hex, pr);
  if (d.indicador) {
    const direita = cx + corpo.width / 2 - I.direita;
    const baixo = cy + corpo.height / 2 - I.baixo;
    const x = direita - larguraInd;
    const y = baixo - I.altura;
    ctx.fillStyle = "#ffffff";
    pilula(ctx, x, y, larguraInd, I.altura);
    ctx.fill();
    ctx.fillStyle = d.indicador.cor;
    pilula(ctx, x + I.borda, y + I.borda, larguraInd - 2 * I.borda, I.altura - 2 * I.borda);
    ctx.fill();
    ctx.font = I.fonte;
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(d.indicador.texto, x + larguraInd / 2, baseDoTexto(ctx, d.indicador.texto, y + I.altura / 2));
  }
  const imagem = lerPixelsDoCanvas(ctx, largura, altura);
  return imagem ? { imagem, pixelRatio: pr, w: W, h: H } : null;
}

/**
 * Pedidos da imagem de um ponto e da reserva dele (círculo da cor com os mesmos enfeites, sem figura).
 * @param {string} grupo "mg-supl" | "mg-ponto" | "mg-tarefa"
 * @param {DesenhoPonto} d @param {number} pixelRatio
 * @returns {{ imagem: PedidoImagem, reserva: PedidoImagem }}
 */
export function pedidosImagemPonto(grupo, d, pixelRatio) {
  const urls = [...new Set(d.urls.filter(Boolean))];
  const desenho = { ...d, urls };
  const reserva = { ...d, urls: [] };
  return {
    imagem: { chave: chaveImagemPonto(grupo, desenho), gerar: () => desenharImagemPonto({ ...desenho, pixelRatio }) },
    reserva: { chave: chaveReservaPonto(grupo, d), gerar: () => desenharImagemPonto({ ...reserva, pixelRatio }) },
  };
}

let avisouFalha = false;
/** Um aviso só por sessão: a figura de um ponto não pôde ser desenhada (o mapa mostra a reserva). */
export function avisarFalhaPonto() {
  if (avisouFalha) return;
  avisouFalha = true;
  console.warn("[mapa] a figura de um ponto, cocho ou tarefa não pôde ser desenhada (não carregou ou é de outra origem); ele aparece com o círculo da cor.");
}
/** Testes: o aviso volta a valer. */
export function limparAvisoPontos() {
  avisouFalha = false;
}

// ─── Fonte e camadas ────────────────────────────────────────────────────────

/**
 * @typedef {{ id: string, lngLat: [number, number], imagem: string, reserva: string, titulo: string, urgente?: boolean }} ItemPonto
 */

/**
 * Fonte GeoJSON de um grupo. `titulo` (o texto que era o `title`/`aria-label` do marcador) fica na fonte: o mapa o
 * mostra como título do canvas no mouse e os testes leem o que está no mapa sem olhar pixels.
 * @param {Iterable<ItemPonto>} itens
 * @returns {GeoJSON.FeatureCollection<GeoJSON.Point>}
 */
export function colecaoPontos(itens) {
  /** @type {GeoJSON.Feature<GeoJSON.Point>[]} */
  const features = [];
  for (const it of itens) {
    /** @type {Record<string, any>} */
    const properties = { id: it.id, imagem: it.imagem, reserva: it.reserva, titulo: it.titulo };
    if (it.urgente !== undefined) properties.urgente = it.urgente;
    features.push({ type: "Feature", id: it.id, properties, geometry: { type: "Point", coordinates: it.lngLat } });
  }
  return { type: "FeatureCollection", features };
}

const layoutComum = () => ({
  // sem a imagem (falhou), a reserva do próprio ponto: nunca some
  "icon-image": ["coalesce", ["image", ["get", "imagem"]], ["image", ["get", "reserva"]]],
  "icon-allow-overlap": true,
  "icon-ignore-placement": true,
  "icon-anchor": "center",
});

/** Camadas que ficam ABAIXO dos lotes (cocho 500 < ponto 800 < lote 1000), de baixo para cima. @returns {any[]} */
export function camadasAbaixoDosLotes() {
  return [
    { id: SUPL_LAYER_ID, type: "symbol", source: SUPL_SOURCE_ID, layout: layoutComum() },
    { id: PONTOS_LAYER_ID, type: "symbol", source: PONTOS_SOURCE_ID, layout: layoutComum() },
  ];
}

/** Camada ACIMA dos lotes: as tarefas (2500), a Urgente por cima das outras (3000). @returns {any[]} */
export function camadasAcimaDosLotes() {
  return [
    {
      id: TAREFAS_LAYER_ID,
      type: "symbol",
      source: TAREFAS_SOURCE_ID,
      layout: { ...layoutComum(), "symbol-sort-key": ["case", ["boolean", ["get", "urgente"], false], 1, 0] },
    },
  ];
}

/** @param {any} map @param {string} id */
const fonte = (map, id) => {
  if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
};

/**
 * Fontes e camadas abaixo dos lotes (cocho e ponto), idempotente. `ensureMgLayers` chama ANTES de criar os lotes;
 * se os lotes já existem (estilo antigo), entram antes deles.
 * @param {any} map
 */
export function ensureCamadasAbaixoDosLotes(map) {
  fonte(map, SUPL_SOURCE_ID);
  fonte(map, PONTOS_SOURCE_ID);
  for (const spec of camadasAbaixoDosLotes()) {
    if (map.getLayer(spec.id)) continue;
    if (map.getLayer(LOTES_LAYER_ID)) map.addLayer(spec, LOTES_LAYER_ID);
    else map.addLayer(spec);
  }
}

/** Fonte e camada acima dos lotes (tarefas), idempotente. `ensureMgLayers` chama DEPOIS dos lotes. @param {any} map */
export function ensureCamadasAcimaDosLotes(map) {
  fonte(map, TAREFAS_SOURCE_ID);
  for (const spec of camadasAcimaDosLotes()) if (!map.getLayer(spec.id)) map.addLayer(spec);
}

/**
 * Põe no estilo do mapa as imagens prontas (as que ainda não estão). Depois de um setStyle basta chamar de novo
 * (o `styleimagemissing` de `ligarImagensFaltandoPontos` cobre o resto).
 * @param {any} map @param {Iterable<string>} chaves @param {number} pixelRatio
 */
export function registrarImagensPontos(map, chaves, pixelRatio) {
  if (typeof map?.addImage !== "function") return;
  for (const chave of chaves) {
    const r = imagemPronta(chave, pixelRatio);
    if (r) porImagemNoMapa(map, chave, r);
  }
}

/**
 * Responde ao `styleimagemissing` com as imagens de ponto do cache (troca de estilo: satélite ↔ mapa).
 * @param {any} map @param {() => number} pixelRatio @returns {() => void} desliga
 */
export function ligarImagensFaltandoPontos(map, pixelRatio) {
  if (typeof map?.on !== "function") return () => {};
  const h = (/** @type {{ id?: string }} */ e) => {
    const id = String(e?.id || "");
    if (ehImagemDePonto(id)) registrarImagensPontos(map, [id], pixelRatio());
  };
  map.on("styleimagemissing", h);
  return () => {
    try {
      map.off("styleimagemissing", h);
    } catch {
      /* mapa já removido */
    }
  };
}

// ─── Toque, clique e "o que está por cima" ──────────────────────────────────

/** @param {{ x: number, y: number } | [number, number]} ponto @returns {[number, number]} */
const xy = (ponto) => (Array.isArray(ponto) ? ponto : [ponto.x, ponto.y]);

/**
 * O ícone clicável de cima no ponto da tela (tarefa, lote, ponto ou cocho, nessa ordem), ou null.
 * Consulta camada por camada, de cima para baixo: o primeiro que tem algo no ponto é o que o dedo tocou.
 * @param {any} map @param {{ x: number, y: number } | [number, number]} ponto
 * @returns {null | { camada: string, feature: any }}
 */
export function iconeNoTopo(map, ponto) {
  try {
    const p = xy(ponto);
    for (const camada of ORDEM_CLICAVEIS) {
      if (!map?.getLayer?.(camada)) continue;
      const [f] = map.queryRenderedFeatures(p, { layers: [camada] });
      if (f) return { camada, feature: f };
    }
  } catch {
    /* mapa sendo removido */
  }
  return null;
}

/**
 * Há cocho, ponto de referência ou tarefa sob o ponto da tela? O clique na área/linha, o `hitArea` e o toque longo
 * do Mapa Geral usam isto (junto com `haLoteNoPonto`) para não agir também por baixo do ícone.
 * @param {any} map @param {{ x: number, y: number } | [number, number]} ponto
 */
export function haPontoNoPonto(map, ponto) {
  try {
    const camadas = CAMADAS_PONTOS.filter((c) => map?.getLayer?.(c));
    return camadas.length > 0 && map.queryRenderedFeatures(xy(ponto), { layers: camadas }).length > 0;
  } catch {
    return false;
  }
}

/** Há tarefa (a camada acima dos lotes) sob o ponto? O lote por baixo dela não abre nem arrasta. @param {any} map */
export function haTarefaNoPonto(map, /** @type {{ x: number, y: number } | [number, number]} */ ponto) {
  try {
    return Boolean(map?.getLayer?.(TAREFAS_LAYER_ID)) && map.queryRenderedFeatures(xy(ponto), { layers: [TAREFAS_LAYER_ID] }).length > 0;
  } catch {
    return false;
  }
}

/**
 * Clique, cursor e título dos pontos, pelos eventos das camadas. Cada camada só age quando é ela a de cima no ponto
 * (`iconeNoTopo`): um ponto embaixo de um lote abre o lote, uma tarefa em cima do lote abre a tarefa.
 * @param {any} map
 * @param {{
 *   aoClicar: (camada: string, id: string) => void,
 *   titulo: (camada: string, id: string) => string,
 *   ignorarClique?: () => boolean,
 * }} opts
 * @returns {{ off: () => void }}
 */
export function ligarInteracaoPontos(map, opts) {
  let tituloPosto = "";
  const canvas = () => map.getCanvas?.();
  const idDe = (/** @type {any} */ f) => {
    const id = f?.properties?.id ?? f?.id;
    return id == null ? null : String(id);
  };
  /** @type {Array<[string, string, (e: any) => void]>} */
  const ligados = [];
  for (const camada of CAMADAS_PONTOS) {
    const aoClicar = (/** @type {any} */ e) => {
      if (opts.ignorarClique?.()) return;
      const topo = e?.point ? iconeNoTopo(map, e.point) : null;
      if (topo && topo.camada !== camada) return;
      const id = idDe(topo?.feature ?? e?.features?.[0]);
      if (id) opts.aoClicar(camada, id);
    };
    const aoEntrar = (/** @type {any} */ e) => {
      const c = canvas();
      if (!c?.style) return;
      const topo = e?.point ? iconeNoTopo(map, e.point) : null;
      if (topo && topo.camada !== camada) return; // quem está por cima cuida
      c.style.cursor = "pointer";
      const id = idDe(topo?.feature ?? e?.features?.[0]);
      tituloPosto = id ? opts.titulo(camada, id) || "" : "";
      if ("title" in c) c.title = tituloPosto;
    };
    const aoSair = () => {
      const c = canvas();
      if (!c?.style) return;
      c.style.cursor = "";
      if ("title" in c && c.title === tituloPosto) c.title = "";
      tituloPosto = "";
    };
    ligados.push(["click", camada, aoClicar], ["mousemove", camada, aoEntrar], ["mouseleave", camada, aoSair]);
  }
  for (const [ev, camada, fn] of ligados) map.on(ev, camada, fn);
  return {
    off: () => {
      for (const [ev, camada, fn] of ligados) {
        try {
          map.off(ev, camada, fn);
        } catch {
          /* mapa já removido */
        }
      }
    },
  };
}
