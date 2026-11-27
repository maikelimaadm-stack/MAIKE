/*
 * GUIA DE EDIÇÃO — LOTES DESENHADOS PELO MAPA (D-PROD-349): posição do ícone (OFFSET_LOTE_PX / OFFSET_LOTE_COM_NOME_PX),
 * identificador (DIAMETRO_IDENT_PX, DESLOC_IDENT_PX), piscar do alerta (PISCAR_MS, OPACIDADE_PISCAR) e arrastar (ARRASTO_MIN_PX).
 * A figura vem do código (src/assets/icones/lotes, D-PROD-191); a letra da contagem é FONTE_CONTAGEM_PX (contagemLote.js).
 * Índice completo: docs/design/GUIA-MAPA-E-ICONES.md
 */
/**
 * Lotes do Mapa Geral desenhados pelo PRÓPRIO mapa (D-PROD-349, "mapa leve", etapa 2).
 *
 * Antes cada pasto com gado era um marcador HTML; com 200 pastos o navegador recalculava o estilo de centenas de
 * elementos a cada quadro do arrastar. Agora cada lote é um ponto numa fonte GeoJSON e uma camada `symbol` pinta a
 * imagem dele. A imagem é a MESMA figura de antes (SVG do motor do ícone) com a contagem já escrita dentro, montada
 * num canvas no devicePixelRatio — o estilo sem internet não tem fonte de letras (glyphs), então nada de `text-field`.
 *
 *  - imagem do lote: chave = desenho + contagem; a mesma chave nunca é desenhada de novo (cache do módulo);
 *  - identificador (a bolinha do canto): imagem própria numa segunda camada, que é a que pisca no alerta;
 *  - clique, arrastar e cursor: eventos da camada (`ligarInteracaoLotes`); durante o arrasto, uma cópia HTML
 *    temporária segue o dedo e o ícone da camada some até soltar.
 */
import { CONTAGEM_TOPO_PCT, LARGURA_MARCADOR_PX } from "@/assets/icones/lotes";
import { FONTE_CONTAGEM_PX, formatarContagem } from "./contagemLote.js";
import { iconeSemAchatar } from "./iconeSemAchatar.js";

export const LOTES_SOURCE_ID = "mg-lotes";
export const LOTES_LAYER_ID = "mg-lotes";
export const LOTES_IDENT_LAYER_ID = "mg-lotes-ident";

/** Centro do ícone do lote em relação ao ponto do pasto, sem nome embaixo (px; a ponta fica no mesmo lugar, D-PROD-89). */
export const OFFSET_LOTE_PX = /** @type {[number, number]} */ ([0, -26]);
/** Com o nome embaixo: par ícone + nome centrado no ponto, alturas constantes (D-PROD-128). */
export const OFFSET_LOTE_COM_NOME_PX = /** @type {[number, number]} */ ([0, -14]);
/** Centro do identificador em relação ao centro do ícone: canto de cima à direita (D-PROD-125). */
export const DESLOC_IDENT_PX = /** @type {[number, number]} */ ([22, -24]);
/** Bolinha do identificador: 13 px, borda branca de 1 px, sigla de 6 px. */
export const DIAMETRO_IDENT_PX = 13;
/** Folga em volta da bolinha para a sombra (0 1px 3px) caber na imagem. */
const FOLGA_IDENT_PX = 4;
/** Alerta: o identificador alterna entre opaco e esta opacidade a cada PISCAR_MS. */
export const PISCAR_MS = 550;
export const OPACIDADE_PISCAR = 0.2;
/** Abaixo disto (px) o toque no lote é clique; a partir disto, arrasto. */
export const ARRASTO_MIN_PX = 4;
/** Tamanho do ícone antes de a figura carregar (a moldura do motor: 44 × 42). */
export const TAMANHO_PADRAO_LOTE = Object.freeze({ w: LARGURA_MARCADOR_PX, h: 42 });

const FONTE_FAMILIA = "Inter, Arial, sans-serif";
/** Gradiente do identificador "MISTO" (metade preto, metade branco). */
export const COR_IDENT_MISTO = "linear-gradient(90deg, #000000 50%, #ffffff 50%)";

/**
 * @typedef {{ cor: string, sigla: string, nome: string }} Identificador
 * @typedef {{ width: number, height: number, data: Uint8Array | Uint8ClampedArray }} Pixels
 * @typedef {{ imagem: Pixels, pixelRatio: number, w: number, h: number }} Raster
 *   `w`/`h`: tamanho na tela (px CSS); `imagem`: pixels em `w × pixelRatio`.
 * @typedef {{ chave: string, gerar: () => Promise<Raster | null> }} PedidoImagem
 */

// ─── Dados (puros) ──────────────────────────────────────────────────────────

/**
 * Identificadores dos lotes de um pasto (D-PROD-125): nenhum, um, ou "MISTO" quando há mais de um diferente.
 * @param {any[]} lotesNaArea
 * @returns {Identificador[]}
 */
export function identificadoresDoLote(lotesNaArea) {
  const unicos = [
    ...new Map(
      (lotesNaArea || [])
        .filter((l) => l.identificador_cor || l.identificador_sigla || l.identificador_nome)
        .map((l) => {
          const cor = l.identificador_cor || "#64748b";
          const sigla = l.identificador_sigla || l.identificador_nome || "";
          const nome = l.identificador_nome || sigla;
          return [`${cor}_${sigla}_${nome}`, { cor, sigla, nome }];
        })
    ).values(),
  ];
  return unicos.length <= 1 ? unicos : [{ cor: COR_IDENT_MISTO, nome: "MISTO", sigla: "" }];
}

/** Sigla que cabe na bolinha (2 letras). @param {Identificador} ident */
const siglaCurta = (ident) => (ident.sigla ? String(ident.sigla).substring(0, 2) : "");

/**
 * Chave da imagem do lote: o desenho do motor + a contagem já formatada. Mesma chave = mesma imagem.
 * @param {string} desenho chave do desenho (`resolverIconeLote(...).chave`)
 * @param {number} totalCabecas
 */
export function chaveImagemLote(desenho, totalCabecas) {
  return `mg-lote|${desenho}|${formatarContagem(totalCabecas)}`;
}

/** Chave da imagem do identificador (cor + sigla). @param {Identificador | null | undefined} ident */
export function chaveImagemIdent(ident) {
  return ident ? `mg-lote-ident|${ident.cor}|${siglaCurta(ident)}` : null;
}

/**
 * @typedef {{
 *   areaId: string,
 *   lngLat: [number, number],
 *   imagem: string,
 *   ident: string | null,
 *   alerta: boolean,
 *   piscar: boolean,
 *   comRotulo: boolean,
 *   nome: string,
 *   cabecas: number,
 *   desenho: string,
 * }} ItemLote
 */

/**
 * Fonte GeoJSON dos lotes. As propriedades servem à camada (imagem, ident, alerta, piscar, comRotulo) e a quem
 * precisa saber o que está no mapa sem olhar pixels (testes, e2e): `cabecas`, `contagem` (texto desenhado) e `desenho`.
 * @param {Iterable<ItemLote>} itens
 * @returns {GeoJSON.FeatureCollection<GeoJSON.Point>}
 */
export function colecaoLotes(itens) {
  /** @type {GeoJSON.Feature<GeoJSON.Point>[]} */
  const features = [];
  for (const it of itens) {
    /** @type {Record<string, any>} */
    const properties = {
      areaId: it.areaId,
      imagem: it.imagem,
      alerta: it.alerta,
      piscar: it.piscar,
      comRotulo: it.comRotulo,
      nome: it.nome,
      cabecas: it.cabecas,
      contagem: formatarContagem(it.cabecas),
      desenho: it.desenho,
    };
    if (it.ident) properties.ident = it.ident;
    features.push({ type: "Feature", id: it.areaId, properties, geometry: { type: "Point", coordinates: it.lngLat } });
  }
  return { type: "FeatureCollection", features };
}

const arrastando = ["boolean", ["feature-state", "arrastando"], false];
/** @param {[number, number]} a @param {[number, number]} b @returns {[number, number]} */
const soma = (a, b) => [a[0] + b[0], a[1] + b[1]];

/**
 * Opacidade do identificador, FIXA na camada: some no arrasto; apagada (OPACIDADE_PISCAR) quando o estado do lote
 * (`feature-state`) diz `piscaApagado`. O piscar só troca esse estado nos lotes com alerta — trocar a pintura da
 * camada refaria a fonte inteira no worker a cada 550 ms.
 */
export const OPACIDADE_IDENT = Object.freeze(["case", arrastando, 0, ["boolean", ["feature-state", "piscaApagado"], false], OPACIDADE_PISCAR, 1]);

/** Imagem reserva do lote (o círculo verde do marcador antigo), quando a imagem do lote não pôde ser desenhada. */
export const IMAGEM_RESERVA = "mg-lote-reserva";

/**
 * Camadas `symbol` dos lotes: o ícone (com a contagem) e, por cima, o identificador. Nunca somem por colisão
 * (allow-overlap + ignore-placement); lote com alerta fica por cima (`symbol-sort-key`).
 * @returns {any[]}
 */
export function camadasLotes() {
  const comum = {
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
    "icon-anchor": "center",
    "symbol-sort-key": ["case", ["boolean", ["get", "alerta"], false], 1, 0],
  };
  const offset = (/** @type {[number, number]} */ desloc) => [
    "case",
    ["boolean", ["get", "comRotulo"], false],
    ["literal", soma(OFFSET_LOTE_COM_NOME_PX, desloc)],
    ["literal", soma(OFFSET_LOTE_PX, desloc)],
  ];
  return [
    {
      id: LOTES_LAYER_ID,
      type: "symbol",
      source: LOTES_SOURCE_ID,
      // sem a imagem do lote (falhou ao desenhar), a reserva: o lote nunca some
      layout: { ...comum, "icon-image": ["coalesce", ["image", ["get", "imagem"]], ["image", IMAGEM_RESERVA]], "icon-offset": offset([0, 0]) },
      paint: { "icon-opacity": ["case", arrastando, 0, 1] },
    },
    {
      id: LOTES_IDENT_LAYER_ID,
      type: "symbol",
      source: LOTES_SOURCE_ID,
      filter: ["has", "ident"],
      layout: { ...comum, "icon-image": ["get", "ident"], "icon-offset": offset(DESLOC_IDENT_PX) },
      paint: { "icon-opacity": OPACIDADE_IDENT },
    },
  ];
}

/**
 * Fonte e camadas dos lotes, idempotente (reaplicável após setStyle). Chamado no fim de `ensureMgLayers`: os lotes
 * ficam acima das áreas, linhas e localização.
 * @param {any} map
 */
export function ensureLotesLayers(map) {
  if (!map.getSource(LOTES_SOURCE_ID)) {
    map.addSource(LOTES_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "areaId" });
  }
  for (const spec of camadasLotes()) if (!map.getLayer(spec.id)) map.addLayer(spec);
}

/**
 * Caixa do ícone na tela (px), para os nomes desviarem dele (D-PROD-126) sem medir elemento nenhum.
 * @param {{ x: number, y: number }} ponto ponto do pasto na tela
 * @param {boolean} comRotulo
 * @param {{ w: number, h: number }} [tamanho]
 */
export function caixaDoLote(ponto, comRotulo, tamanho = TAMANHO_PADRAO_LOTE) {
  const [dx, dy] = comRotulo ? OFFSET_LOTE_COM_NOME_PX : OFFSET_LOTE_PX;
  return { x: ponto.x + dx - tamanho.w / 2, y: ponto.y + dy - tamanho.h / 2, w: tamanho.w, h: tamanho.h };
}

// ─── Imagens (canvas) ───────────────────────────────────────────────────────

/** @type {Map<string, Promise<HTMLImageElement | null>>} */
const figuras = new Map();
/**
 * Figura já pintada no tamanho da tela, uma por desenho e DPR: o SVG é rasterizado uma vez e cada contagem só copia.
 * @type {Map<string, Promise<{ canvas: HTMLCanvasElement | null, w: number, h: number }>>}
 */
const bases = new Map();
/** @type {Map<string, Raster | null>} */
const prontas = new Map();
/** @type {Map<string, Promise<Raster | null>>} */
const pendentes = new Map();
/** Quantas vezes cada imagem já falhou. Depois de MAX_TENTATIVAS_IMAGEM, para de tentar (fica a reserva). */
const falhas = new Map();
/** Um aparelho que sempre bloqueia a leitura do canvas não redesenha 200 lotes a cada sincronização. */
export const MAX_TENTATIVAS_IMAGEM = 3;
/** @type {HTMLCanvasElement | null} */
let tela = null;

/** Esquece as imagens já desenhadas (troca de tela/DPR; testes). */
export function limparCacheImagensLotes() {
  figuras.clear();
  bases.clear();
  reservas.clear();
  avisouFalha = false;
  prontas.clear();
  pendentes.clear();
  falhas.clear();
  tela = null;
}

/** devicePixelRatio da tela (1 a 4). */
export function pixelRatioDaTela() {
  const dpr = typeof window !== "undefined" ? Number(window.devicePixelRatio) : 1;
  return Number.isFinite(dpr) && dpr > 0 ? Math.min(4, Math.max(1, dpr)) : 1;
}

/** @param {string} url @returns {Promise<HTMLImageElement | null>} */
function carregarFigura(url) {
  let p = figuras.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      if (typeof Image === "undefined") return resolve(null);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    figuras.set(url, p);
  }
  return p;
}

/**
 * A figura do motor pintada no tamanho da tela (44 px de largura, altura sem achatar), no DPR.
 * @param {string} iconUrl @param {number} pixelRatio
 */
function baseDaFigura(iconUrl, pixelRatio) {
  const k = `${pixelRatio}|${iconUrl}`;
  let p = bases.get(k);
  if (!p) {
    p = carregarFigura(iconUrl).then((fig) => {
      const { width: w, height: h } = fig
        ? iconeSemAchatar(fig.naturalWidth, fig.naturalHeight, LARGURA_MARCADOR_PX)
        : { width: TAMANHO_PADRAO_LOTE.w, height: TAMANHO_PADRAO_LOTE.h };
      if (!fig || typeof document === "undefined") return { canvas: null, w, h };
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * pixelRatio));
      canvas.height = Math.max(1, Math.round(h * pixelRatio));
      // na CPU, como o canvas de trabalho: copiar entre os dois não passa pela GPU
      const ctx = /** @type {CanvasRenderingContext2D | null} */ (canvas.getContext("2d", { willReadFrequently: true }));
      if (!ctx) return { canvas: null, w, h };
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.drawImage(fig, 0, 0, w, h);
      return { canvas, w, h };
    });
    bases.set(k, p);
  }
  return p;
}

/**
 * Canvas único de trabalho (`willReadFrequently`: a leitura dos pixels não passa pela GPU).
 * @param {number} largura @param {number} altura
 */
function contexto(largura, altura) {
  if (typeof document === "undefined") return null;
  if (!tela) tela = document.createElement("canvas");
  tela.width = largura;
  tela.height = altura;
  const ctx = /** @type {CanvasRenderingContext2D | null} */ (tela.getContext("2d", { willReadFrequently: true }));
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, largura, altura);
  return ctx;
}

/**
 * Linha de base do texto como o CSS põe uma linha de `line-height: 1` centrada em `centroY`:
 * base = centro + (ascendente − descendente) / 2 da fonte. Sem as métricas, "middle" dá o mesmo.
 * @param {CanvasRenderingContext2D} ctx @param {string} texto @param {number} centroY
 */
function baseDoTexto(ctx, texto, centroY) {
  const m = ctx.measureText?.(texto);
  if (m && Number.isFinite(m.fontBoundingBoxAscent) && Number.isFinite(m.fontBoundingBoxDescent)) {
    ctx.textBaseline = "alphabetic";
    return centroY + (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2;
  }
  ctx.textBaseline = "middle";
  return centroY;
}

/** @param {CanvasRenderingContext2D} ctx @param {number} largura @param {number} altura @returns {Pixels | null} */
function lerPixels(ctx, largura, altura) {
  try {
    const d = ctx.getImageData(0, 0, largura, altura);
    return { width: d.width, height: d.height, data: d.data };
  } catch {
    // canvas "sujo" (figura de outra origem): sem pixels, sem imagem
    return null;
  }
}

/**
 * Desenha o ícone do lote: a figura do motor (44 px de largura, altura sem achatar) e a contagem dentro dela, como o
 * marcador HTML fazia — cinza #6b7280, 9,5 px, negrito, centrada na faixa da contagem (CONTAGEM_TOPO_PCT) e com o
 * halo branco do `text-shadow: 0 0 2px rgba(255,255,255,.95), 0 0 3px rgba(255,255,255,.8)`.
 * @param {{ iconUrl: string, texto: string, pixelRatio: number }} p
 * @returns {Promise<Raster | null>}
 */
export async function desenharImagemLote({ iconUrl, texto, pixelRatio }) {
  const base = await baseDaFigura(iconUrl, pixelRatio);
  if (!base.canvas) {
    // A figura não carregou (ou sem canvas): é falha, não uma imagem só com o número. Esquece a figura para a
    // próxima tentativa recarregar, e o lote fica com a reserva (o círculo verde, como o `onerror` do marcador antigo).
    figuras.delete(iconUrl);
    bases.delete(`${pixelRatio}|${iconUrl}`);
    return null;
  }
  const { w, h } = base;
  const largura = Math.max(1, Math.round(w * pixelRatio));
  const altura = Math.max(1, Math.round(h * pixelRatio));
  const ctx = contexto(largura, altura);
  if (!ctx) return null;
  ctx.drawImage(base.canvas, 0, 0);
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.font = `700 ${FONTE_CONTAGEM_PX}px ${FONTE_FAMILIA}`;
  ctx.textAlign = "center";
  const x = w / 2;
  const y = baseDoTexto(ctx, texto, (h * CONTAGEM_TOPO_PCT) / 100);
  // O halo: só a sombra de cada camada do text-shadow (o texto em si sai da tela pelo deslocamento), a de baixo
  // primeiro, como o CSS pinta; depois o texto. Sombra não segue a escala do canvas: raio e deslocamento em px reais.
  const fora = largura + 1000;
  for (const [raio, cor] of /** @type {const} */ ([[3, "rgba(255,255,255,.8)"], [2, "rgba(255,255,255,.95)"]])) {
    ctx.shadowColor = cor;
    ctx.shadowBlur = raio * pixelRatio;
    ctx.shadowOffsetX = fora * pixelRatio;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(texto, x - fora, y);
  }
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.fillStyle = "#6b7280";
  ctx.fillText(texto, x, y);
  const imagem = lerPixels(ctx, largura, altura);
  return imagem ? { imagem, pixelRatio, w, h } : null;
}

/**
 * Desenha o identificador: bolinha de 13 px com a cor (ou metade preto/metade branco no MISTO), borda branca de
 * 1 px, sombra `0 1px 3px rgba(0,0,0,.35)` e a sigla (até 2 letras) branca, 6 px, negrito.
 * @param {{ ident: Identificador, pixelRatio: number }} p
 * @returns {Promise<Raster | null>}
 */
export async function desenharImagemIdent({ ident, pixelRatio }) {
  const lado = DIAMETRO_IDENT_PX + 2 * FOLGA_IDENT_PX;
  const px = Math.max(1, Math.round(lado * pixelRatio));
  const ctx = contexto(px, px);
  if (!ctx) return null;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const c = lado / 2;
  const r = DIAMETRO_IDENT_PX / 2;
  const circulo = (/** @type {number} */ raio) => {
    ctx.beginPath();
    ctx.arc(c, c, raio, 0, Math.PI * 2);
  };
  // sombra (a bolinha é opaca: a sombra só aparece fora dela)
  ctx.shadowColor = "rgba(0,0,0,.35)";
  ctx.shadowBlur = 3 * pixelRatio;
  ctx.shadowOffsetY = 1 * pixelRatio;
  ctx.fillStyle = "#ffffff";
  circulo(r);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.save();
  circulo(r);
  ctx.clip();
  if (ident.cor === COR_IDENT_MISTO) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(c - r, c - r, r, 2 * r);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(c, c - r, r, 2 * r);
  } else {
    ctx.fillStyle = "#64748b";
    ctx.fillStyle = ident.cor;
    ctx.fillRect(c - r, c - r, 2 * r, 2 * r);
  }
  const sigla = siglaCurta(ident);
  if (sigla) {
    ctx.font = `700 6px ${FONTE_FAMILIA}`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(sigla, c, baseDoTexto(ctx, sigla, c));
  }
  ctx.restore();
  // borda branca de 1 px por dentro da bolinha (box-sizing: border-box)
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  circulo(r - 0.5);
  ctx.stroke();
  const imagem = lerPixels(ctx, px, px);
  return imagem ? { imagem, pixelRatio, w: lado, h: lado } : null;
}

/**
 * Pedido da imagem de um lote (chave + como desenhar).
 * @param {{ desenho: string, iconUrl: string, cabecas: number, pixelRatio: number }} p
 * @returns {PedidoImagem}
 */
export function pedidoImagemLote({ desenho, iconUrl, cabecas, pixelRatio }) {
  return { chave: chaveImagemLote(desenho, cabecas), gerar: () => desenharImagemLote({ iconUrl, texto: formatarContagem(cabecas), pixelRatio }) };
}

/**
 * Pedido da imagem de um identificador.
 * @param {Identificador} ident @param {number} pixelRatio
 * @returns {PedidoImagem}
 */
export function pedidoImagemIdent(ident, pixelRatio) {
  return { chave: /** @type {string} */ (chaveImagemIdent(ident)), gerar: () => desenharImagemIdent({ ident, pixelRatio }) };
}

/** @param {string} chave @param {number} pixelRatio */
const chaveCache = (chave, pixelRatio) => `${chave}@${pixelRatio}`;

let avisouFalha = false;
/** Um aviso só por sessão: a imagem do lote não pôde ser desenhada (o mapa mostra a reserva). */
function avisarFalha() {
  if (avisouFalha) return;
  avisouFalha = true;
  console.warn("[mapa] a imagem de um lote não pôde ser desenhada; o lote aparece com o círculo verde até a próxima tentativa.");
}

/** Uma fatia de desenho; passou disso, devolve a vez ao navegador (nada de tarefa longa ao abrir 200 pastos). */
const FATIA_MS = 8;
let fila = /** @type {Promise<unknown>} */ (Promise.resolve());
let inicioFatia = -Infinity;
const agora = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Desenha uma imagem por vez, em fatias de FATIA_MS: entre uma fatia e outra o navegador pinta e atende o toque.
 * @template T @param {() => Promise<T>} fn @returns {Promise<T>}
 */
function naFila(fn) {
  const p = fila.then(async () => {
    if (agora() - inicioFatia > FATIA_MS) {
      await new Promise((r) => setTimeout(r, 0));
      inicioFatia = agora();
    }
    return fn();
  });
  fila = p.catch(() => null);
  return p;
}

/**
 * Garante as imagens pedidas no cache. Devolve `null` se todas já estão prontas (o chamador segue sem esperar) ou a
 * promessa de quando ficarem. Uma chave só é desenhada uma vez, mesmo pedida várias vezes ao mesmo tempo.
 * @param {PedidoImagem[]} pedidos @param {number} pixelRatio
 * @returns {Promise<void> | null}
 */
export function garantirImagens(pedidos, pixelRatio) {
  /** @type {Promise<Raster | null>[]} */
  const esperar = [];
  for (const { chave, gerar } of pedidos) {
    const k = chaveCache(chave, pixelRatio);
    if (prontas.has(k) || (falhas.get(k) || 0) >= MAX_TENTATIVAS_IMAGEM) continue;
    let p = pendentes.get(k);
    if (!p) {
      p = naFila(gerar)
        .catch(() => null)
        .then((r) => {
          pendentes.delete(k);
          // Falhou: não guarda (a próxima sincronização tenta de novo); o lote aparece com a reserva.
          if (r) {
            prontas.set(k, r);
            falhas.delete(k);
          } else {
            falhas.set(k, (falhas.get(k) || 0) + 1);
            avisarFalha();
          }
          return r;
        });
      pendentes.set(k, p);
    }
    esperar.push(p);
  }
  return esperar.length ? Promise.all(esperar).then(() => undefined) : null;
}

/** Imagem pronta (ou null se ainda não ou se falhou). @param {string} chave @param {number} pixelRatio */
export function imagemPronta(chave, pixelRatio) {
  return prontas.get(chaveCache(chave, pixelRatio)) || null;
}

/** @type {Map<number, Raster | null>} */
const reservas = new Map();
/**
 * Imagem reserva: o fallback do marcador antigo — círculo verde #10b981 de raio 19, borda branca de 3 px e a sombra
 * `0 1px 3px rgba(0,0,0,.35)`. Desenhada na hora (não depende de figura).
 * @param {number} pixelRatio
 */
export function desenharImagemReserva(pixelRatio) {
  if (reservas.has(pixelRatio)) return reservas.get(pixelRatio) || null;
  const raio = 19;
  const lado = 2 * raio + 2 * FOLGA_IDENT_PX;
  const px = Math.max(1, Math.round(lado * pixelRatio));
  const ctx = contexto(px, px);
  /** @type {Raster | null} */
  let r = null;
  if (ctx) {
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const c = lado / 2;
    ctx.shadowColor = "rgba(0,0,0,.35)";
    ctx.shadowBlur = 3 * pixelRatio;
    ctx.shadowOffsetY = 1 * pixelRatio;
    ctx.fillStyle = "#10b981";
    ctx.beginPath();
    ctx.arc(c, c, raio, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c, c, raio - 1.5, 0, Math.PI * 2);
    ctx.stroke();
    const imagem = lerPixels(ctx, px, px);
    r = imagem ? { imagem, pixelRatio, w: lado, h: lado } : null;
  }
  // só guarda o que deu certo: falhou, tenta de novo na próxima vez
  if (r) reservas.set(pixelRatio, r);
  return r;
}

/**
 * Imagens de lote que este renderer pôs em cada mapa, com o DPR em que foram desenhadas.
 * @type {WeakMap<object, Map<string, number>>}
 */
const registradas = new WeakMap();
/** @param {any} map */
const registradasDo = (map) => {
  let m = registradas.get(map);
  if (!m) {
    m = new Map();
    registradas.set(map, m);
  }
  return m;
};

/**
 * Põe (ou troca) uma imagem no estilo. Já está com o mesmo DPR: nada. Com outro DPR (a tela mudou): troca.
 * @param {any} map @param {string} chave @param {Raster} r
 */
function porImagem(map, chave, r) {
  const doMapa = registradasDo(map);
  try {
    const tem = typeof map.hasImage === "function" && map.hasImage(chave);
    if (tem && doMapa.get(chave) === r.pixelRatio) return;
    if (tem) map.removeImage(chave);
    map.addImage(chave, r.imagem, { pixelRatio: r.pixelRatio });
    doMapa.set(chave, r.pixelRatio);
  } catch {
    /* estilo trocando: o styleimagemissing repõe */
  }
}

/** A reserva no mapa (uma vez por estilo). @param {any} map @param {number} pixelRatio */
export function registrarReserva(map, pixelRatio) {
  if (typeof map?.addImage !== "function") return;
  const r = desenharImagemReserva(pixelRatio);
  if (r) porImagem(map, IMAGEM_RESERVA, r);
}

/**
 * Põe as imagens no estilo do mapa (as que ainda não estão). Depois de um setStyle o estilo novo vem sem elas:
 * basta chamar de novo (o `styleimagemissing` de `ligarImagensFaltando` cobre o resto).
 * @param {any} map @param {Iterable<string>} chaves @param {number} pixelRatio
 */
export function registrarImagens(map, chaves, pixelRatio) {
  if (typeof map?.addImage !== "function") return;
  registrarReserva(map, pixelRatio);
  for (const chave of chaves) {
    const r = imagemPronta(chave, pixelRatio);
    if (r) porImagem(map, chave, r);
  }
}

/** Chave de imagem de lote ou de identificador (não a reserva). @param {string} chave */
const ehImagemDeLote = (chave) => chave.startsWith("mg-lote|") || chave.startsWith("mg-lote-ident|");

/**
 * Tira do mapa e do cache as imagens de lote que nenhum lote usa mais (contagem que mudou, lote que saiu) e as de
 * outro DPR. As que ainda estão sendo desenhadas ficam (entram no cache e saem na próxima poda). Sem nenhum lote
 * (camada escondida pelo filtro) não poda: ao mostrar de novo, as imagens já estão prontas.
 * @param {any} map @param {Set<string>} emUso @param {number} pixelRatio
 * @returns {string[]} chaves tiradas do mapa
 */
export function podarImagens(map, emUso, pixelRatio) {
  if (!emUso.size) return [];
  /** @type {string[]} */
  const tiradas = [];
  const doMapa = map ? registradas.get(map) : null;
  doMapa?.forEach((_pr, chave) => {
    if (!ehImagemDeLote(chave) || emUso.has(chave)) return;
    try {
      if (typeof map.hasImage !== "function" || map.hasImage(chave)) map.removeImage?.(chave);
    } catch {
      /* mapa já removido */
    }
    doMapa.delete(chave);
    tiradas.push(chave);
  });
  for (const k of [...prontas.keys()]) {
    const i = k.lastIndexOf("@");
    const chave = k.slice(0, i);
    if (ehImagemDeLote(chave) && (!emUso.has(chave) || Number(k.slice(i + 1)) !== pixelRatio)) prontas.delete(k);
  }
  return tiradas;
}

/**
 * Responde ao `styleimagemissing` com as imagens de lote do cache (troca de estilo: satélite ↔ mapa).
 * @param {any} map @param {() => number} pixelRatio DPR atual
 * @returns {() => void} desliga
 */
export function ligarImagensFaltando(map, pixelRatio) {
  if (typeof map?.on !== "function") return () => {};
  const h = (/** @type {{ id?: string }} */ e) => {
    const id = String(e?.id || "");
    if (id === IMAGEM_RESERVA) registrarReserva(map, pixelRatio());
    else if (id.startsWith("mg-lote")) registrarImagens(map, [id], pixelRatio());
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

/** Data URL de uma imagem pronta (só para a cópia que segue o dedo no arrasto). @param {Raster} r */
function urlDoRaster(r) {
  if (typeof document === "undefined") return null;
  try {
    const c = document.createElement("canvas");
    c.width = r.imagem.width;
    c.height = r.imagem.height;
    const ctx = c.getContext("2d");
    if (!ctx || typeof ImageData === "undefined") return null;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(r.imagem.data), r.imagem.width, r.imagem.height), 0, 0);
    return c.toDataURL();
  } catch {
    return null;
  }
}

// ─── Piscar do alerta ───────────────────────────────────────────────────────

/**
 * Pisca os identificadores com alerta: a cada PISCAR_MS troca o `feature-state` `piscaApagado` SÓ dos lotes que
 * piscam (todos juntos). A pintura da camada não muda (`OPACIDADE_IDENT` é fixa): nada é refeito no worker.
 * @param {() => any} getMap
 */
export function criarPiscaIdent(getMap) {
  /** @type {ReturnType<typeof setInterval> | null} */
  let iv = null;
  let apagado = false;
  /** @type {Set<string>} */
  let ids = new Set();
  const marcar = (/** @type {Iterable<string>} */ lista, /** @type {boolean} */ v) => {
    const map = getMap();
    if (typeof map?.setFeatureState !== "function") return;
    for (const id of lista) {
      try {
        map.setFeatureState({ source: LOTES_SOURCE_ID, id }, { piscaApagado: v });
      } catch {
        /* fonte recriada (troca de estilo): o próximo tique marca de novo */
      }
    }
  };
  const parar = () => {
    if (iv) clearInterval(iv);
    iv = null;
    if (apagado) marcar(ids, false);
    apagado = false;
    ids = new Set();
  };
  return {
    /** @param {Iterable<string>} lista ids (areaId) dos lotes que piscam agora */
    atualizar(lista) {
      const novos = new Set([...lista].map(String));
      if (!novos.size) return parar();
      if (apagado) {
        marcar([...ids].filter((id) => !novos.has(id)), false); // saíram: voltam acesos
        marcar([...novos].filter((id) => !ids.has(id)), true); // entraram: na mesma fase dos outros
      }
      ids = novos;
      if (iv) return;
      iv = setInterval(() => {
        apagado = !apagado;
        marcar(ids, apagado);
      }, PISCAR_MS);
    },
    parar,
    ativo: () => iv !== null,
  };
}

// ─── Clique e arrastar ──────────────────────────────────────────────────────

/**
 * @typedef {{
 *   areaId: string,
 *   lngLat: [number, number],
 *   comRotulo: boolean,
 *   imagem: string,
 *   ident: string | null,
 *   nome: string,
 * }} LoteNaTela
 */

/**
 * Clique, cursor, título e arrastar dos lotes, pelos eventos da camada `mg-lotes`.
 *
 *  - clique: `aoClicar(areaId)`; o clique na área por baixo é ignorado por quem trata a área (`haLoteNoPonto`);
 *  - arrastar (quando `podeArrastar()`): ao pressionar, o mapa não desliza (`preventDefault`); passados
 *    ARRASTO_MIN_PX, uma cópia HTML do ícone (`criarMarcador`, um Marker só durante o arrasto) segue o dedo e o da
 *    camada some; ao soltar, `aoSoltar(lngLat, areaId)`
 *    com o ponto do pasto deslocado do quanto o dedo andou (como o `dragend` do marcador antigo) e o ícone volta.
 *
 * @param {any} map
 * @param {{
 *   lote: (areaId: string) => LoteNaTela | null,
 *   podeArrastar: () => boolean,
 *   aoClicar: (areaId: string) => void,
 *   aoSoltar: (lngLat: { lat: number, lng: number }, areaId: string) => void,
 *   criarMarcador: (el: HTMLElement, offset: [number, number]) => any,
 *   pixelRatio: () => number,
 * }} opts
 * @returns {{ off: () => void, cancelarArrasto: () => void }}
 */
export function ligarInteracaoLotes(map, opts) {
  /** @type {null | { areaId: string, toque: boolean, inicio: { x: number, y: number }, origem: { x: number, y: number }, ancora: [number, number], ativo: boolean, marcador: any, lngLat: { lat: number, lng: number } | null }} */
  let arrasto = null;
  const janela = typeof window !== "undefined" ? window : null;
  // Soltou o botão fora do mapa (ou a janela perdeu o foco): o mapa não vê o mouseup, e o arrasto ficaria preso.
  const soltouFora = (/** @type {Event} */ ev) => {
    const caixa = map.getCanvasContainer?.() || map.getContainer?.();
    const alvo = /** @type {any} */ (ev?.target);
    const ehNo = typeof Node !== "undefined" && alvo instanceof Node;
    if (ev?.type === "mouseup" && caixa && ehNo && typeof caixa.contains === "function" && caixa.contains(alvo)) return;
    terminar(false);
  };
  let ignorarClique = false;
  const canvas = () => map.getCanvas?.();
  const areaDe = (/** @type {any} */ e) => {
    const id = e?.features?.[0]?.properties?.areaId ?? e?.features?.[0]?.id;
    return id == null ? null : String(id);
  };
  const estadoArrasto = (/** @type {string} */ areaId, /** @type {boolean} */ v) => {
    try {
      map.setFeatureState({ source: LOTES_SOURCE_ID, id: areaId }, { arrastando: v });
    } catch {
      /* fonte recriada */
    }
  };

  const criarCopia = (/** @type {LoteNaTela} */ lote) => {
    const el = document.createElement("div");
    el.className = "mg-lote-arrastando";
    el.style.cssText = "position:relative;pointer-events:none;";
    const pr = opts.pixelRatio();
    const img = imagemPronta(lote.imagem, pr);
    const url = img ? urlDoRaster(img) : null;
    const t = img ? { w: img.w, h: img.h } : TAMANHO_PADRAO_LOTE;
    el.style.width = `${t.w}px`;
    el.style.height = `${t.h}px`;
    if (url) {
      const i = document.createElement("img");
      i.alt = "";
      i.draggable = false;
      i.src = url;
      i.style.cssText = `display:block;width:${t.w}px;height:${t.h}px;`;
      el.appendChild(i);
    }
    const id = lote.ident ? imagemPronta(lote.ident, pr) : null;
    const urlId = id ? urlDoRaster(id) : null;
    if (id && urlId) {
      const b = document.createElement("img");
      b.alt = "";
      b.src = urlId;
      b.style.cssText = `position:absolute;left:calc(50% + ${DESLOC_IDENT_PX[0]}px);top:calc(50% + ${DESLOC_IDENT_PX[1]}px);transform:translate(-50%,-50%);width:${id.w}px;height:${id.h}px;`;
      el.appendChild(b);
    }
    return opts.criarMarcador(el, lote.comRotulo ? OFFSET_LOTE_COM_NOME_PX : OFFSET_LOTE_PX);
  };

  const terminar = (/** @type {boolean} */ soltar) => {
    const a = arrasto;
    arrasto = null;
    map.off("mousemove", mover);
    map.off("touchmove", mover);
    map.off("mouseup", aoLevantar);
    map.off("touchend", aoLevantar);
    map.off("touchcancel", aoCancelar);
    janela?.removeEventListener("mouseup", soltouFora);
    janela?.removeEventListener("blur", soltouFora);
    if (!a) return;
    if (a.ativo) {
      try {
        a.marcador?.remove();
      } catch {
        /* best-effort */
      }
      estadoArrasto(a.areaId, false);
      const c = canvas();
      if (c?.style) c.style.cursor = "";
      // o clique que o navegador manda depois do arrasto não abre o lote
      ignorarClique = true;
      setTimeout(() => {
        ignorarClique = false;
      }, 0);
      if (soltar && a.lngLat) opts.aoSoltar({ lat: a.lngLat.lat, lng: a.lngLat.lng }, a.areaId);
    }
  };
  const aoLevantar = () => terminar(true);
  const aoCancelar = () => terminar(false);

  const mover = (/** @type {any} */ e) => {
    const a = arrasto;
    if (!a || !e?.point) return;
    if (e.points && e.points.length > 1) return terminar(false); // pinça: é zoom, não arrasto
    // mouse sem botão apertado: o botão foi solto onde o mapa não viu
    if (!a.toque && e.originalEvent && e.originalEvent.buttons === 0) return terminar(false);
    const dx = e.point.x - a.inicio.x;
    const dy = e.point.y - a.inicio.y;
    if (!a.ativo) {
      if (Math.hypot(dx, dy) < ARRASTO_MIN_PX) return;
      const lote = opts.lote(a.areaId);
      if (!lote) return terminar(false);
      a.ativo = true;
      a.ancora = lote.lngLat;
      const o = map.project(lote.lngLat);
      a.origem = { x: o.x, y: o.y };
      a.marcador = criarCopia(lote).setLngLat(lote.lngLat).addTo(map);
      estadoArrasto(a.areaId, true);
      const c = canvas();
      if (c?.style) c.style.cursor = "grabbing";
    }
    const ll = map.unproject([a.origem.x + dx, a.origem.y + dy]);
    a.lngLat = { lat: ll.lat, lng: ll.lng };
    a.marcador?.setLngLat([ll.lng, ll.lat]);
  };

  const aoPressionar = (/** @type {any} */ e) => {
    if (!opts.podeArrastar()) return;
    if (e?.points && e.points.length > 1) return;
    const areaId = areaDe(e);
    if (!areaId || !e?.point) return;
    if (arrasto) terminar(false);
    e.preventDefault?.(); // o mapa não desliza enquanto o lote é arrastado
    const toque = e.type === "touchstart";
    arrasto = { areaId, toque, inicio: { x: e.point.x, y: e.point.y }, origem: { x: 0, y: 0 }, ancora: [0, 0], ativo: false, marcador: null, lngLat: null };
    map.on(toque ? "touchmove" : "mousemove", mover);
    map.on(toque ? "touchend" : "mouseup", aoLevantar);
    if (toque) map.on("touchcancel", aoCancelar);
    else janela?.addEventListener("mouseup", soltouFora);
    janela?.addEventListener("blur", soltouFora);
  };

  const aoClicarCamada = (/** @type {any} */ e) => {
    if (ignorarClique) return;
    const areaId = areaDe(e);
    if (areaId) opts.aoClicar(areaId);
  };
  const aoEntrar = (/** @type {any} */ e) => {
    const c = canvas();
    if (!c?.style) return;
    c.style.cursor = "pointer";
    const lote = opts.lote(areaDe(e) || "");
    if ("title" in c) c.title = lote?.nome || "";
  };
  const aoSair = () => {
    const c = canvas();
    if (!c?.style) return;
    if (!arrasto?.ativo) c.style.cursor = "";
    if ("title" in c) c.title = "";
  };

  map.on("click", LOTES_LAYER_ID, aoClicarCamada);
  map.on("mousedown", LOTES_LAYER_ID, aoPressionar);
  map.on("touchstart", LOTES_LAYER_ID, aoPressionar);
  map.on("mousemove", LOTES_LAYER_ID, aoEntrar);
  map.on("mouseleave", LOTES_LAYER_ID, aoSair);

  return {
    cancelarArrasto: () => terminar(false),
    off: () => {
      terminar(false);
      try {
        map.off("click", LOTES_LAYER_ID, aoClicarCamada);
        map.off("mousedown", LOTES_LAYER_ID, aoPressionar);
        map.off("touchstart", LOTES_LAYER_ID, aoPressionar);
        map.off("mousemove", LOTES_LAYER_ID, aoEntrar);
        map.off("mouseleave", LOTES_LAYER_ID, aoSair);
      } catch {
        /* mapa já removido */
      }
    },
  };
}

/**
 * Há ícone de lote sob o ponto? (Só a camada do ícone: o identificador não é clicável, como no marcador antigo.)
 * Quem trata o clique na área/linha e o toque longo do mapa usam isto para não agir também por baixo do lote.
 * @param {any} map @param {{ x: number, y: number } | [number, number]} ponto
 */
export function haLoteNoPonto(map, ponto) {
  try {
    if (!map?.getLayer?.(LOTES_LAYER_ID)) return false;
    // sempre [x, y]: um objeto `{ x, y }` comum o MapLibre lê como "opções" e consulta a tela inteira
    const xy = Array.isArray(ponto) ? ponto : [ponto.x, ponto.y];
    return map.queryRenderedFeatures(xy, { layers: [LOTES_LAYER_ID] }).length > 0;
  } catch {
    return false;
  }
}
