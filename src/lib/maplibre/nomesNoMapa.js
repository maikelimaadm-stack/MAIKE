/*
 * GUIA DE EDIÇÃO — NOMES DOS PASTOS DESENHADOS PELO MAPA (D-PROD-354): letra e cores (FAMILIA_NOME, COR_NOME, OPACIDADE_HA,
 * COR_EXTRA, ALTURA_LINHA), tamanho por zoom (fontesRotuloPorZoom, escalaRotulo, ZOOMS_NOME), posição com lote
 * (DESLOC_NOME_COM_LOTE_PX) e as camadas (camadasNomes).
 * O nível (nome + ha, só o nome ou a sigla) é escolhido em useMapRenderer.jsx (`arrumarNomes`) com `escolherModoRotulos`.
 * Índice completo: docs/design/GUIA-MAPA-E-ICONES.md
 */
/**
 * Nomes dos pastos do Mapa Geral desenhados pelo PRÓPRIO mapa (D-PROD-354, "mapa leve", etapa 4). Mesmo padrão dos
 * lotes (D-PROD-349, `lotesNoMapa.js`) e dos pontos (D-PROD-353, `pontosNoMapa.js`):
 *
 *  - cada pasto é um ponto numa fonte GeoJSON; duas camadas `symbol` pintam a imagem do nome (uma para o pasto sem
 *    lote, com o nome centrado no ponto; outra para o pasto com lote, com o nome logo abaixo do ícone);
 *  - a imagem é o texto escrito num canvas no devicePixelRatio, na letra MAIOR (12 px) — o estilo sem internet não tem
 *    fonte de letras (glyphs), então nada de `text-field`. Chave = o que ela desenha (as linhas e as cores): pastos
 *    com o mesmo texto dividem a imagem, e a mesma chave nunca é desenhada de novo (cache, fila e limite dos lotes);
 *  - o tamanho no zoom é do próprio mapa: `icon-size` é uma expressão de zoom cujas paradas vêm de cada pasto
 *    (`s8` … `s22` na fonte) = (letra do zoom ÷ 12) × encaixe no pasto. Durante o zoom não roda JavaScript nenhum
 *    para os nomes; o nível (sigla, nome, nome + ha) é revisto sem tocar em elemento nenhum (o tamanho de cada
 *    imagem é conhecido e a posição vem de `map.project`).
 */
import { baseDoTexto, contextoDeDesenho, imagemPronta, lerPixelsDoCanvas, porImagemNoMapa } from "./lotesNoMapa.js";

export const NOMES_SOURCE_ID = "mg-nomes";
/** Pasto sem lote: o nome centrado no ponto. */
export const NOMES_LAYER_ID = "mg-nomes";
/** Pasto com lote: o nome logo abaixo do ícone do lote. */
export const NOMES_LOTE_LAYER_ID = "mg-nomes-lote";

/**
 * Com lote, o topo do nome fica 10 px abaixo do ponto do pasto: o ícone (44 px, centro 14 px acima do ponto) + 2 px de
 * espaço + 26 px reservados ao nome = 72 px, centrados no ponto (D-PROD-128). Em px da tela, não muda com o tamanho
 * do nome (`icon-translate`, que o `icon-size` não escala).
 */
export const DESLOC_NOME_COM_LOTE_PX = /** @type {[number, number]} */ ([0, 10]);

/** A letra do nome, como o rótulo HTML de antes: Inter (sem ela, Arial), branca; desde a D-PROD-379 com contorno escuro fino. */
export const FAMILIA_NOME = "Inter, Arial, sans-serif";
export const COR_NOME = "#ffffff";
/** A linha do "ha" com opacidade .95. */
export const OPACIDADE_HA = 0.95;
/** A linha extra (lotação, situação do pasto…): amarelo claro, peso 600. */
export const COR_EXTRA = "#fef08a";
/** Altura de cada linha = letra × 1,15 (o `line-height` de antes). */
export const ALTURA_LINHA = 1.15;
/** A imagem é desenhada na letra máxima do nome (12 px, D-PROD-129); o mapa reduz por `icon-size`. */
export const FONTE_NOME_MAX_PX = 12;
/** Folga de cada lado da imagem para a suavização das letras não ser cortada (px). */
const FOLGA_LATERAL_PX = 1;
/**
 * D-PROD-379: contorno escuro fino em volta das letras, para o nome ler bem em cima do satélite (campo claro, estrada,
 * nuvem), como os rótulos dos mapas. A imagem ganha esta margem em cada lado para o contorno não ser cortado.
 */
export const CONTORNO_NOME_PX = 3;
export const COR_CONTORNO_NOME = "rgba(0, 0, 0, 0.35)";
export const MARGEM_CONTORNO_PX = 2;
/**
 * Paradas de zoom do `icon-size` (uma por nível; o mapa só interpola entre duas paradas que cobrem o nível do
 * ladrilho, então meia parada não ajudaria). Abaixo de 8 e acima de 22 vale a parada da ponta.
 */
export const ZOOMS_NOME = Object.freeze([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
/** Tamanho do mundo em px no zoom 0 (ladrilho de 512 do MapLibre). */
const MUNDO_PX = 512;

// ─── Regras puras ───────────────────────────────────────────────────────────

/**
 * Fonte do nome do pasto acompanhando o zoom SUAVEMENTE (D-PROD-129): cresce ao
 * aproximar e diminui ao afastar, como os nomes de um mapa, em vez de pular de
 * 10 → 11 → 12 px só no fim do zoom. 10 px até o zoom 13, 12 px a partir do 17
 * (de ¼ em ¼ px); o "ha" fica 1 px menor (mínimo 9).
 * @param {number} zoom
 */
export function fontesRotuloPorZoom(zoom) {
  const z = Number.isFinite(zoom) ? zoom : 0;
  const nome = Math.round(Math.max(10, Math.min(12, 10 + (z - 13) * 0.5)) * 4) / 4;
  return { nome, ha: Math.max(9, nome - 1) };
}

/**
 * Escala do nome do pasto para caber no espaço livre em volta do ponto
 * (D-PROD-130): o texto (w × h px) tem de caber no círculo de raio `raio` px.
 * Encolhe junto com o pasto no zoom; nunca passa do tamanho normal (1) nem fica
 * abaixo de `minimo` (legível).
 * @param {number} w largura do texto (px, sem escala)
 * @param {number} h altura do texto (px, sem escala)
 * @param {number | null | undefined} raio folga do ponto na tela (px)
 * @param {number} [minimo]
 */
export function escalaRotulo(w, h, raio, minimo = 0.6) {
  if (!(w > 0) || !(h > 0) || !(Number(raio) > 0)) return 1;
  const s = (2 * Number(raio) * 0.95) / Math.hypot(w, h);
  return Math.max(minimo, Math.min(1, Math.round(s * 100) / 100));
}

/**
 * @typedef {"nome" | "ha" | "extra"} TipoLinha  `nome` também é a linha da sigla (mesma letra)
 * @typedef {{ tipo: TipoLinha, texto: string }} LinhaNome
 * @typedef {"tudo" | "nome" | "sigla"} NivelNome
 * @typedef {{ w: number, h: number }} Medida  tamanho do texto na letra de 12 px (px CSS, sem a folga lateral)
 */

/**
 * Letra e cor de cada linha (o rótulo HTML de antes): nome 700, "ha" 400 com opacidade .95, extra 600 amarela.
 * O "ha" e a extra são 1 px menores que o nome (mínimo 9).
 * @param {TipoLinha} tipo @param {number} [fonteNome]
 */
export function estiloDaLinha(tipo, fonteNome = FONTE_NOME_MAX_PX) {
  const menor = Math.max(9, fonteNome - 1);
  if (tipo === "ha") return { font: `400 ${menor}px ${FAMILIA_NOME}`, tamanho: menor, cor: COR_NOME, opacidade: OPACIDADE_HA };
  if (tipo === "extra") return { font: `600 ${menor}px ${FAMILIA_NOME}`, tamanho: menor, cor: COR_EXTRA, opacidade: 1 };
  return { font: `700 ${fonteNome}px ${FAMILIA_NOME}`, tamanho: fonteNome, cor: COR_NOME, opacidade: 1 };
}

/**
 * As linhas que cada nível mostra (D-PROD-126): "tudo" = nome + ha + extra; "nome" = só o nome; "sigla" = só a
 * sigla. Linha vazia não entra (no HTML ela não ocupava altura).
 * @param {{ nome: string, sigla: string, ha: string | null, extra: string | null }} t @param {NivelNome} nivel
 * @returns {LinhaNome[]}
 */
export function linhasDoNivel(t, nivel) {
  /** @type {LinhaNome[]} */
  const linhas = nivel === "sigla" ? [{ tipo: "nome", texto: t.sigla }] : [{ tipo: "nome", texto: t.nome }];
  if (nivel === "tudo") {
    if (t.ha) linhas.push({ tipo: "ha", texto: t.ha });
    if (t.extra) linhas.push({ tipo: "extra", texto: t.extra });
  }
  return linhas.filter((l) => String(l.texto ?? "").length > 0);
}

/**
 * Chave da imagem: as linhas desenhadas (tipo + texto) e as cores. Mesma chave = mesma imagem; dois níveis que
 * desenham o mesmo (pasto sem "ha", sigla igual ao nome) dividem a imagem.
 * @param {LinhaNome[]} linhas
 */
export function chaveImagemNome(linhas) {
  return `mg-nome|${COR_NOME}|${OPACIDADE_HA}|${COR_EXTRA}|c${CONTORNO_NOME_PX}|${JSON.stringify(linhas.map((l) => [l.tipo, l.texto]))}`;
}

/** Imagem de nome de pasto? @param {string} chave */
export const ehImagemDeNome = (chave) => String(chave).startsWith("mg-nome|");

/** @type {Map<string, Medida & { larguras: number[], alturas: number[] }>} */
const medidas = new Map();

/**
 * Tamanho do texto (px CSS) na letra de 12 px: largura da linha mais larga e soma das alturas das linhas
 * (letra × 1,15). Sem canvas (teste sem desenho), uma estimativa de 0,6 × letra por caractere.
 * @param {LinhaNome[]} linhas
 * @returns {Medida & { larguras: number[], alturas: number[] }}
 */
export function medirLinhas(linhas) {
  const chave = chaveImagemNome(linhas);
  const pronta = medidas.get(chave);
  if (pronta) return pronta;
  const ctx = contextoDeDesenho(1, 1);
  const larguras = linhas.map((l) => {
    const e = estiloDaLinha(l.tipo);
    if (ctx) {
      ctx.font = e.font;
      const w = Number(ctx.measureText?.(l.texto)?.width);
      if (Number.isFinite(w)) return w;
    }
    return 0.6 * e.tamanho * l.texto.length;
  });
  const alturas = linhas.map((l) => estiloDaLinha(l.tipo).tamanho * ALTURA_LINHA);
  const m = { w: larguras.reduce((a, b) => Math.max(a, b), 0), h: alturas.reduce((a, b) => a + b, 0), larguras, alturas };
  medidas.set(chave, m);
  return m;
}

/**
 * Folga do ponto do nome em px da tela no zoom (D-PROD-130): `folga` é o raio livre em graus de latitude
 * (`pontoEFolga`); na projeção do mapa, 1 grau de latitude vale (512 × 2^zoom ÷ 360) ÷ cos(latitude) px.
 * @param {number} folga @param {number} lat @param {number} zoom
 */
export function raioNaTela(folga, lat, zoom) {
  const c = Math.cos((lat * Math.PI) / 180);
  if (!(folga > 0) || !(c > 0)) return null;
  return (folga * MUNDO_PX * Math.pow(2, zoom)) / 360 / c;
}

/**
 * Tamanho do nome no zoom, em relação à imagem de 12 px: (letra do zoom ÷ 12) × encaixe no pasto — o mesmo que o
 * rótulo HTML fazia a cada quadro (`fr × escalaRotulo(w·fr, h·fr, raio)`, D-PROD-129/130/351). Encaixe nunca
 * abaixo de 60%.
 * @param {Medida} medida @param {{ lat: number, folga: number } | null} pf @param {number} zoom
 */
export function tamanhoNoZoom(medida, pf, zoom) {
  const fr = fontesRotuloPorZoom(zoom).nome / FONTE_NOME_MAX_PX;
  const raio = pf ? raioNaTela(pf.folga, pf.lat, zoom) : null;
  return fr * escalaRotulo(medida.w * fr, medida.h * fr, raio);
}

/**
 * As paradas do `icon-size` de um pasto, para a fonte: `{ s8: …, s9: …, …, s22: … }`, de 1/1000 em 1/1000.
 * @param {Medida} medida @param {{ lat: number, folga: number } | null} pf
 * @returns {Record<string, number>}
 */
export function tamanhosPorZoom(medida, pf) {
  /** @type {Record<string, number>} */
  const s = {};
  for (const z of ZOOMS_NOME) s[`s${z}`] = Math.round(tamanhoNoZoom(medida, pf, z) * 1000) / 1000;
  return s;
}

/**
 * Acerta as duas paradas em volta do zoom de agora para o nome ficar EXATAMENTE do tamanho certo nesse zoom.
 *
 * O mapa só interpola entre duas paradas (os dois níveis inteiros em volta do zoom); a conta de verdade tem o mínimo
 * de 60% e o máximo de 100% no meio, e nenhuma curva de dois pontos a segue dentro do nível (até ≈ 17% de diferença
 * no meio do nível, no pasto cujo nome está chegando ao mínimo ou ao máximo). Por isso, a cada publicação (fim do
 * movimento), as duas paradas em volta do zoom são multiplicadas pelo mesmo fator: parado, o nome tem o tamanho exato;
 * durante o próximo zoom a diferença volta a crescer longe desse ponto e é acertada de novo no fim dele.
 * @param {Record<string, number>} tabela paradas exatas (`tamanhosPorZoom`)
 * @param {Medida} medida @param {{ lat: number, folga: number } | null} pf @param {number} zoom
 * @returns {Record<string, number>}
 */
export function tamanhosAcertadosNoZoom(tabela, medida, pf, zoom) {
  const z0 = Math.floor(zoom);
  const a = tabela[`s${z0}`];
  const b = tabela[`s${z0 + 1}`];
  if (!(a > 0) || !(b > 0)) return tabela;
  const t = zoom - z0;
  const noMapa = a + (b - a) * (Math.pow(2, t) - 1);
  const k = tamanhoNoZoom(medida, pf, zoom) / noMapa;
  if (!Number.isFinite(k) || Math.abs(k - 1) < 0.002) return tabela;
  return { ...tabela, [`s${z0}`]: Math.round(a * k * 1000) / 1000, [`s${z0 + 1}`]: Math.round(b * k * 1000) / 1000 };
}

/**
 * `icon-size` dos nomes: interpolação exponencial de base 2 entre as paradas de cada pasto (entre dois níveis o pasto
 * dobra de tamanho na tela; a letra de 10 → 12 px quase não sente a diferença: menos de 0,5%). Ver
 * `tamanhosAcertadosNoZoom` para o tamanho exato no zoom em que o mapa para.
 * @returns {any[]}
 */
export function expressaoTamanhoNome() {
  return ["interpolate", ["exponential", 2], ["zoom"], ...ZOOMS_NOME.flatMap((z) => [z, ["get", `s${z}`]])];
}

/**
 * Caixa do nome na tela (px do mapa) para a escolha do nível (D-PROD-126), sem medir elemento nenhum: o tamanho do
 * texto na letra do zoom (sem o encaixe, como o rótulo HTML era medido) e a posição da camada — com lote, o topo
 * 10 px abaixo do ponto; sem lote, centrado no ponto.
 * @param {{ x: number, y: number }} ponto ponto do pasto na tela
 * @param {Medida} medida tamanho na letra de 12 px
 * @param {number} zoom
 * @param {boolean} comLote
 */
export function caixaDoNome(ponto, medida, zoom, comLote) {
  const fr = fontesRotuloPorZoom(zoom).nome / FONTE_NOME_MAX_PX;
  const w = medida.w * fr;
  const h = medida.h * fr;
  return { x: ponto.x - w / 2, y: comLote ? ponto.y + DESLOC_NOME_COM_LOTE_PX[1] : ponto.y - h / 2, w, h };
}

// ─── Fonte (dados) e camadas ────────────────────────────────────────────────

/**
 * @typedef {{
 *   id: string,
 *   lngLat: [number, number],
 *   imagem: string,
 *   comLote: boolean,
 *   nivel: NivelNome,
 *   nome: string,
 *   texto: string,
 *   tamanhos: Record<string, number>,
 * }} ItemNome
 */

/**
 * Fonte GeoJSON dos nomes. `imagem`, `comLote` e `s8`…`s22` servem às camadas; `nome`, `nivel` e `texto` (as linhas
 * desenhadas) a quem precisa saber o que está no mapa sem olhar pixels (testes, e2e).
 * @param {Iterable<ItemNome>} itens
 * @returns {GeoJSON.FeatureCollection<GeoJSON.Point>}
 */
export function colecaoNomes(itens) {
  /** @type {GeoJSON.Feature<GeoJSON.Point>[]} */
  const features = [];
  for (const it of itens) {
    features.push({
      type: "Feature",
      id: it.id,
      properties: { id: it.id, imagem: it.imagem, comLote: it.comLote, nivel: it.nivel, nome: it.nome, texto: it.texto, ...it.tamanhos },
      geometry: { type: "Point", coordinates: it.lngLat },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * As duas camadas dos nomes. Nunca somem por colisão do mapa (allow-overlap + ignore-placement): o nível global é
 * quem resolve a bagunça (D-PROD-126). Não recebem clique: o clique no pasto continua sendo da camada das áreas.
 * @returns {any[]}
 */
export function camadasNomes() {
  const layout = {
    "icon-image": ["get", "imagem"],
    "icon-size": expressaoTamanhoNome(),
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
    "icon-rotation-alignment": "viewport",
    "icon-pitch-alignment": "viewport",
  };
  const comLote = ["boolean", ["get", "comLote"], false];
  return [
    { id: NOMES_LAYER_ID, type: "symbol", source: NOMES_SOURCE_ID, filter: ["!", comLote], layout: { ...layout, "icon-anchor": "center" } },
    {
      id: NOMES_LOTE_LAYER_ID,
      type: "symbol",
      source: NOMES_SOURCE_ID,
      filter: comLote,
      // o topo do nome encostado embaixo do ícone; a escala parte do topo (como o `transform-origin: 50% 0` de antes)
      layout: { ...layout, "icon-anchor": "top" },
      paint: { "icon-translate": DESLOC_NOME_COM_LOTE_PX, "icon-translate-anchor": "viewport" },
    },
  ];
}

/**
 * Fonte e camadas dos nomes, idempotente (reaplicável após setStyle). Chamado no FIM de `ensureMgLayers`: os nomes
 * ficam por cima de todas as camadas do Mapa Geral, como o rótulo HTML ficava.
 * @param {any} map
 */
export function ensureNomesLayers(map) {
  if (!map.getSource(NOMES_SOURCE_ID)) {
    map.addSource(NOMES_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
  }
  for (const spec of camadasNomes()) if (!map.getLayer(spec.id)) map.addLayer(spec);
}

// ─── Letra e imagem (canvas) ────────────────────────────────────────────────

/** Quanto se espera a letra Inter antes de desenhar com o que houver (Arial). */
export const MS_LIMITE_FONTE = 3000;
/** @type {Promise<void> | null} */
let esperaFonte = null;
let fontePronta = false;

/**
 * A letra Inter dos nomes (nome 700, "ha" 400, extra 600) carregada antes de medir e desenhar: sem isso a primeira
 * imagem sairia em Arial e ficaria no cache. Sem `document.fonts` (teste) ou sem a Inter, segue na hora com a
 * reserva (Arial), como o navegador fazia no HTML. Devolve null quando já pode desenhar.
 * @returns {Promise<void> | null}
 */
export function esperarFonteDosNomes() {
  if (fontePronta) return null;
  const fonts = typeof document !== "undefined" ? /** @type {any} */ (document).fonts : null;
  if (!fonts || typeof fonts.load !== "function") {
    fontePronta = true;
    return null;
  }
  if (!esperaFonte) {
    const pedidos = (/** @type {TipoLinha[]} */ (["nome", "ha", "extra"])).map((t) => {
      const e = estiloDaLinha(t);
      return Promise.resolve(fonts.load(e.font.replace(FAMILIA_NOME, '"Inter"'))).catch(() => null);
    });
    esperaFonte = Promise.race([Promise.all(pedidos), new Promise((r) => setTimeout(r, MS_LIMITE_FONTE))]).then(() => {
      fontePronta = true;
      // medido antes da letra chegar não vale mais
      medidas.clear();
    });
  }
  return esperaFonte;
}

/** Esquece medidas e a espera da letra (testes). */
export function limparCacheNomes() {
  medidas.clear();
  esperaFonte = null;
  fontePronta = false;
  avisouFalha = false;
}

/**
 * @typedef {import("./lotesNoMapa.js").Raster} Raster
 * @typedef {import("./lotesNoMapa.js").PedidoImagem} PedidoImagem
 */

/**
 * Desenha o nome como o rótulo HTML de antes: linhas centralizadas, uma embaixo da outra, cada uma com altura
 * letra × 1,15 e o texto no meio dela (a linha de base como o CSS a põe); nome branco 700, "ha" branco 400 a 95%,
 * extra #fef08a 600; sem sombra nem contorno. Na letra de 12 px; o mapa reduz pelo `icon-size`.
 * @param {{ linhas: LinhaNome[], pixelRatio: number }} p
 * @returns {Promise<Raster | null>}
 */
export async function desenharImagemNome({ linhas, pixelRatio }) {
  if (!linhas.length) return null;
  const m = medirLinhas(linhas);
  const W = Math.ceil(m.w) + 2 * (FOLGA_LATERAL_PX + MARGEM_CONTORNO_PX);
  const H = Math.max(1, Math.ceil(m.h)) + 2 * MARGEM_CONTORNO_PX;
  const largura = Math.max(1, Math.round(W * pixelRatio));
  const altura = Math.max(1, Math.round(H * pixelRatio));
  const ctx = contextoDeDesenho(largura, altura);
  if (!ctx) return null;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  let topo = MARGEM_CONTORNO_PX;
  linhas.forEach((l, i) => {
    const e = estiloDaLinha(l.tipo);
    ctx.font = e.font;
    const y = baseDoTexto(ctx, l.texto, topo + m.alturas[i] / 2);
    // o contorno por baixo da letra (D-PROD-379): legível no satélite
    ctx.globalAlpha = 1;
    ctx.lineWidth = CONTORNO_NOME_PX;
    ctx.strokeStyle = COR_CONTORNO_NOME;
    ctx.strokeText(l.texto, W / 2, y);
    ctx.fillStyle = e.cor;
    ctx.globalAlpha = e.opacidade;
    ctx.fillText(l.texto, W / 2, y);
    topo += m.alturas[i];
  });
  ctx.globalAlpha = 1;
  const imagem = lerPixelsDoCanvas(ctx, largura, altura);
  return imagem ? { imagem, pixelRatio, w: W, h: H } : null;
}

/**
 * Pedido da imagem de um nome (chave + como desenhar).
 * @param {LinhaNome[]} linhas @param {number} pixelRatio
 * @returns {PedidoImagem}
 */
export function pedidoImagemNome(linhas, pixelRatio) {
  return { chave: chaveImagemNome(linhas), gerar: () => desenharImagemNome({ linhas, pixelRatio }) };
}

let avisouFalha = false;
/** Um aviso só por sessão: o nome de um pasto não pôde ser desenhado (ele não aparece até a próxima tentativa). */
export function avisarFalhaNome() {
  if (avisouFalha) return;
  avisouFalha = true;
  console.warn("[mapa] o nome de um pasto não pôde ser desenhado; ele não aparece até a próxima tentativa.");
}

/**
 * Põe no estilo do mapa as imagens de nome prontas (as que ainda não estão). Depois de um setStyle basta chamar de
 * novo (o `styleimagemissing` de `ligarImagensFaltandoNomes` cobre o resto).
 * @param {any} map @param {Iterable<string>} chaves @param {number} pixelRatio
 */
export function registrarImagensNomes(map, chaves, pixelRatio) {
  if (typeof map?.addImage !== "function") return;
  for (const chave of chaves) {
    const r = imagemPronta(chave, pixelRatio);
    if (r) porImagemNoMapa(map, chave, r);
  }
}

/**
 * Responde ao `styleimagemissing` com as imagens de nome do cache (troca de estilo: satélite ↔ mapa).
 * @param {any} map @param {() => number} pixelRatio @returns {() => void} desliga
 */
export function ligarImagensFaltandoNomes(map, pixelRatio) {
  if (typeof map?.on !== "function") return () => {};
  const h = (/** @type {{ id?: string }} */ e) => {
    const id = String(e?.id || "");
    if (ehImagemDeNome(id)) registrarImagensNomes(map, [id], pixelRatio());
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
