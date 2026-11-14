/**
 * GUIA RÁPIDO — ÍCONE DO LOTE NO MAPA E SUBÍCONE NOS DETALHES (D-PROD-191)
 *
 * O desenho do lote vem do CÓDIGO, pela chave SEXO + FAIXA DE IDADE da Categoria de
 * Manejo (D-PROD-186). Não há upload nem consulta à rede: o ícone aparece offline.
 *
 *   quadradinho.js — a moldura branca (card + ponteira), a geometria do card e o tamanho
 *                    do marcador no mapa;
 *   animais.js     — os 10 animais, as cores de fêmea e macho, a borda e o tamanho por faixa;
 *   mistos.js      — os 4 mistos, a cor de misto, a borda da vaca no misto e a tabela;
 *   index.js       — este arquivo: a cascata que escolhe o desenho e a montagem do SVG.
 *
 * Cores, bordas e tamanhos ficam no topo de cada arquivo. Instruções: README.md.
 *
 * A CASCATA (marcador do mapa, um por pasto):
 *   1 — uma única combinação sexo+faixa: o animal dela, na cor do sexo;
 *   2 — várias faixas do MESMO sexo: um animal só, o da faixa com mais cabeças (empate:
 *       a faixa mais velha), na cor do sexo;
 *   3 — sexos cruzados com misto declarado (TABELA_MISTOS, menor prioridade ganha): o
 *       desenho do misto, em COR_MISTO;
 *   4 — sexos cruzados sem misto declarado: o predominante de cada sexo, os dois no mesmo
 *       card, o mais velho maior, na mesma linha de chão, em COR_MISTO;
 *   5 — último recurso (sexo desconhecido, ou falta faixa para os níveis acima): o
 *       predominante geral por cabeças, em COR_MISTO.
 * SEMPRE sai uma figura: nunca null, nunca vazio.
 *
 * O SUBÍCONE (detalhes e formulários de manejo) NUNCA usa misto: cada linha mostra o
 * animal da categoria dela, na cor do sexo dela.
 */
import {
  FAIXAS_CATEGORIA_OFICIAL,
  FAIXAS_IDADE_CATEGORIA_MANEJO,
  faixaIdadeDaLista,
  sexoOficial,
} from "@/domain/lotes/categoriaOficialDerivada";
import {
  BORDA_MOLDURA_PCT,
  CARD_FRAC,
  FAIXA_CONTAGEM,
  FOLGA_LATERAL,
  FOLGA_TOPO,
  LARGURA_MARCADOR_PX,
  QUADRADINHO_SVG,
} from "./quadradinho";
import { ANIMAIS_SVG, BORDA_PADRAO, COR_FEMEA, COR_MACHO, TAMANHO_POR_FAIXA } from "./animais";
import {
  BORDA_VACA_MISTO,
  COR_MISTO,
  MISTOS_SVG,
  ROTULO_MISTO,
  SOBREPOSICAO_COMPOSICAO,
  TABELA_MISTOS,
  TAMANHO_MISTO,
} from "./mistos";

export { CARD_FRAC, FAIXA_CONTAGEM, FOLGA_LATERAL, FOLGA_TOPO, LARGURA_MARCADOR_PX } from "./quadradinho";
export { BORDA_PADRAO, COR_FEMEA, COR_MACHO, TAMANHO_POR_FAIXA } from "./animais";
export { BORDA_VACA_MISTO, COR_MISTO, ROTULO_MISTO, SOBREPOSICAO_COMPOSICAO, TABELA_MISTOS, TAMANHO_MISTO } from "./mistos";

/**
 * @typedef {'MACHO'|'FEMEA'} Sexo
 * @typedef {{ sexo: Sexo|null, faixa: string|null, cabecas: number }} ChavePosicao
 * @typedef {{ sexo: Sexo, faixa: string, figura: string }} Animal
 * @typedef {{
 *   nivel: 1|2|3|4|5,
 *   cor: string,
 *   animais: Animal[],
 *   misto: string|null,
 *   rotulo: string,
 *   chave: string,
 *   cabecas: number,
 * }} IconeLote
 *   `animais`: nível 1, 2 e 5 → o animal desenhado; nível 3 → a composição do misto;
 *   nível 4 → [o de trás (mais velho), o da frente]. `chave` identifica o desenho.
 */

// ─── Último recurso (nível 5) ───────────────────────────────────────────────

/** Pasto sem nenhum sexo conhecido: um boi adulto, em COR_MISTO. */
export const FIGURA_ULTIMO_RECURSO = "macho-37-mais";
/** Sexo conhecido sem nenhuma faixa: o animal adulto desse sexo, em COR_MISTO. */
export const FAIXA_SEM_IDADE = "Maior que 36 meses";

// ─── Faixas, figuras e categorias ───────────────────────────────────────────

const FAIXAS = FAIXAS_IDADE_CATEGORIA_MANEJO.map((f, ordem) => ({
  rotulo: f.rotulo,
  de: f.idade_minima_meses,
  ate: f.idade_maxima_meses,
  ordem,
  // '0 a 8 meses' → '0-8'; 'Maior que 36 meses' → '37-mais' (nome dos arquivos do proprietário)
  sufixo: f.idade_maxima_meses === null ? `${f.idade_minima_meses}-mais` : `${f.idade_minima_meses}-${f.idade_maxima_meses}`,
}));

/** As 10 figuras de animal (chaves de ANIMAIS_SVG). */
export const FIGURAS_ANIMAIS = Object.freeze(Object.keys(ANIMAIS_SVG));
/** Os 4 mistos (chaves de MISTOS_SVG). */
export const FIGURAS_MISTOS = Object.freeze(Object.keys(MISTOS_SVG));

/** @param {string|null|undefined} rotulo */
const ordemDaFaixa = (rotulo) => FAIXAS.findIndex((f) => f.rotulo === rotulo);

/**
 * Tamanho do animal da faixa (TAMANHO_POR_FAIXA); valor ausente ou inválido vale 1.
 * @param {string|null|undefined} faixa
 */
const tamanhoDaFaixa = (faixa) => {
  const t = Number(TAMANHO_POR_FAIXA[faixa ?? ""]);
  return t > 0 ? t : 1;
};
const tamanhoDoMisto = () => (Number(TAMANHO_MISTO) > 0 ? Number(TAMANHO_MISTO) : 1);

/**
 * Chave do desenho de um sexo + faixa ('FEMEA', '13 a 24 meses' → 'femea-13-24').
 * @param {unknown} sexo @param {unknown} faixa
 * @returns {string|null}
 */
export function figuraDe(sexo, faixa) {
  const s = sexoOficial(sexo);
  const f = FAIXAS.find((item) => item.rotulo === faixa);
  return s && f ? `${s === "FEMEA" ? "femea" : "macho"}-${f.sufixo}` : null;
}

/** @param {string} figura @returns {Animal|null} */
const animalDaFigura = (figura) => {
  for (const sexo of /** @type {Sexo[]} */ (["MACHO", "FEMEA"])) {
    for (const f of FAIXAS) {
      if (figuraDe(sexo, f.rotulo) === figura) return { sexo, faixa: f.rotulo, figura };
    }
  }
  return null;
};

/** Cor do animal pelo sexo (o subícone nunca usa COR_MISTO). @param {Sexo|null|undefined} sexo */
export const corDoSexo = (sexo) => (sexo === "FEMEA" ? COR_FEMEA : COR_MACHO);

const semAcento = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

/** undefined = ausente; NaN = inválido; senão o inteiro (mesma regra do cadastro). */
const mesesDe = (valor) => {
  if (valor === null || valor === undefined || valor === "") return undefined;
  const n = typeof valor === "number" ? valor : typeof valor === "string" && /^\s*\d+\s*$/.test(valor) ? Number(valor) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};

/** A faixa do código que contém esta idade (meses). @param {number} meses */
const faixaPorIdade = (meses) => FAIXAS.find((f) => meses >= f.de && (f.ate === null || meses <= f.ate)) ?? null;

/**
 * Faixa de uma Categoria de Manejo: a da lista quando o par gravado é exato; par fora da
 * lista (registro antigo) → a faixa que contém a idade mínima; sem idade → null.
 * @param {any} categoria
 * @returns {string|null}
 */
const faixaDaCategoria = (categoria) => {
  if (!categoria) return null;
  const exata = faixaIdadeDaLista(categoria.idade_minima_meses, categoria.idade_maxima_meses);
  if (exata) return exata.rotulo;
  const minima = mesesDe(categoria.idade_minima_meses);
  const maxima = mesesDe(categoria.idade_maxima_meses);
  if (Number.isNaN(minima) || Number.isNaN(maxima)) return null;
  if (minima === undefined && maxima === undefined) return null;
  return faixaPorIdade(minima ?? 0)?.rotulo ?? null;
};

/**
 * Categoria OFICIAL gravada no lote/posição ('Bezerro 0 a 12 meses'): sexo e a primeira
 * faixa do código dentro da faixa oficial (0–12 → '0 a 8 meses'). Serve de reserva
 * quando a Categoria de Manejo não diz a faixa.
 */
const OFICIAIS = FAIXAS_CATEGORIA_OFICIAL.flatMap((f) => [
  { chave: semAcento(f.MACHO), sexo: /** @type {Sexo} */ ("MACHO"), faixa: faixaPorIdade(f.de)?.rotulo ?? null },
  { chave: semAcento(f.FEMEA), sexo: /** @type {Sexo} */ ("FEMEA"), faixa: faixaPorIdade(f.de)?.rotulo ?? null },
]);

/** @param {unknown} texto */
const daCategoriaOficial = (texto) => {
  const chave = semAcento(texto);
  return chave ? OFICIAIS.find((o) => o.chave === chave) ?? null : null;
};

/** @type {WeakMap<object, Map<string, any>>} */
const mapasDeCategorias = new WeakMap();

/**
 * Categorias de Manejo por id (aceita lista ou Map).
 * @param {any[]|Map<string, any>|null|undefined} categoriasManejo
 * @returns {Map<string, any>}
 */
export function mapaDeCategorias(categoriasManejo) {
  if (categoriasManejo instanceof Map) return categoriasManejo;
  if (!Array.isArray(categoriasManejo)) return new Map();
  const pronto = mapasDeCategorias.get(categoriasManejo);
  if (pronto) return pronto;
  const mapa = new Map(categoriasManejo.filter((c) => c && c.id != null).map((c) => [String(c.id), c]));
  mapasDeCategorias.set(categoriasManejo, mapa);
  return mapa;
}

/**
 * Sexo, faixa e cabeças de uma posição do rebanho (ou lote legado).
 * Sexo: o da Categoria de Manejo; senão o da posição (Macho/Fêmea; "Misto" não serve);
 * senão o da categoria oficial gravada. Faixa: a da Categoria de Manejo; senão a da
 * categoria oficial gravada.
 * @param {any} posicao
 * @param {Map<string, any>} [categoriasPorId]
 * @returns {ChavePosicao}
 */
export function chaveDaPosicao(posicao, categoriasPorId = new Map()) {
  const id = posicao?.categoria_manejo_id;
  const categoria = id != null ? categoriasPorId.get(String(id)) ?? null : null;
  const oficial = daCategoriaOficial(posicao?.categoria);
  const sexo = /** @type {Sexo|null} */ (sexoOficial(categoria?.sexo) ?? sexoOficial(posicao?.sexo) ?? oficial?.sexo ?? null);
  const faixa = faixaDaCategoria(categoria) ?? oficial?.faixa ?? null;
  const cabecas = Math.max(0, Math.trunc(Number(posicao?.quantidade_cabecas) || 0));
  return { sexo, faixa, cabecas };
}

// ─── A cascata ──────────────────────────────────────────────────────────────

/**
 * Combinações sexo+faixa presentes, com as cabeças somadas.
 * @param {ChavePosicao[]} itens
 * @returns {Array<{ sexo: Sexo, faixa: string, cabecas: number }>}
 */
const combinacoes = (itens) => {
  /** @type {Map<string, { sexo: Sexo, faixa: string, cabecas: number }>} */
  const porChave = new Map();
  for (const i of itens) {
    if (!i.sexo || !i.faixa) continue;
    const chave = `${i.sexo}|${i.faixa}`;
    const atual = porChave.get(chave) ?? { sexo: i.sexo, faixa: i.faixa, cabecas: 0 };
    atual.cabecas += i.cabecas;
    porChave.set(chave, atual);
  }
  return [...porChave.values()];
};

/**
 * A de mais cabeças; empate → a faixa mais velha; empate → macho (determinístico).
 * @template {{ sexo: Sexo, faixa: string, cabecas: number }} T
 * @param {T[]} lista
 * @returns {T|null}
 */
const predominante = (lista) =>
  [...lista].sort(
    (a, b) =>
      b.cabecas - a.cabecas ||
      ordemDaFaixa(b.faixa) - ordemDaFaixa(a.faixa) ||
      (a.sexo === b.sexo ? 0 : a.sexo === "MACHO" ? -1 : 1)
  )[0] ?? null;

/** @param {{ sexo: Sexo, faixa: string }} c @returns {Animal} */
const animalDe = (c) => ({ sexo: c.sexo, faixa: c.faixa, figura: /** @type {string} */ (figuraDe(c.sexo, c.faixa)) });

/**
 * Misto declarado que bate com o pasto (tipo_regra MINIMA: o pasto TEM todas as
 * combinações do misto, podendo ter outras). Menor prioridade ganha; empate → o misto
 * de mais animais; empate → a chave. Outro tipo_regra nunca bate.
 * @param {Array<{ sexo: Sexo, faixa: string }>} combos
 */
const mistoDeclarado = (combos) => {
  const presentes = new Set(combos.map((c) => figuraDe(c.sexo, c.faixa)));
  return (
    TABELA_MISTOS.filter((m) => m.tipo_regra === "MINIMA" && m.composicao.length > 0 && m.composicao.every((f) => presentes.has(f)))
      .slice()
      .sort((a, b) => a.prioridade - b.prioridade || b.composicao.length - a.composicao.length || a.chave.localeCompare(b.chave))[0] ?? null
  );
};

/** @param {Animal} a */
const rotuloAnimal = (a) => `${a.sexo === "FEMEA" ? "Fêmea" : "Macho"} ${a.faixa}`;

/**
 * @param {IconeLote['nivel']} nivel @param {string} cor @param {Animal[]} animais
 * @param {string|null} misto @param {number} cabecas
 * @returns {IconeLote}
 */
const montar = (nivel, cor, animais, misto, cabecas) => ({
  nivel,
  cor,
  animais,
  misto,
  rotulo: misto ? ROTULO_MISTO[misto] ?? misto : animais.map(rotuloAnimal).join(" + "),
  chave: `n${nivel}:${misto ?? animais.map((a) => a.figura).join("+")}`,
  cabecas,
});

/**
 * Nível 5: o predominante geral por cabeças; sem faixa conhecida, o sexo com mais
 * cabeças na faixa adulta; sem sexo nenhum, FIGURA_ULTIMO_RECURSO.
 * @param {ChavePosicao[]} itens
 * @param {Array<{ sexo: Sexo, faixa: string, cabecas: number }>} combos
 * @returns {Animal}
 */
const ultimoRecurso = (itens, combos) => {
  const p = predominante(combos);
  if (p) return animalDe(p);
  const porSexo = combinacoes(itens.filter((i) => i.sexo).map((i) => ({ ...i, faixa: FAIXA_SEM_IDADE })));
  const s = predominante(porSexo);
  return s ? animalDe(s) : /** @type {Animal} */ (animalDaFigura(FIGURA_ULTIMO_RECURSO));
};

/**
 * A cascata do marcador do mapa: escolhe o desenho do pasto pelas posições do rebanho
 * que estão nele. SEMPRE devolve uma figura.
 * @param {any[]|null|undefined} posicoes posições (ou lotes legados) do pasto
 * @param {any[]|Map<string, any>|null} [categoriasManejo] Categorias de Manejo da empresa
 * @returns {IconeLote}
 */
export function resolverFiguraDoPasto(posicoes, categoriasManejo = null) {
  const porId = mapaDeCategorias(categoriasManejo);
  const todos = (Array.isArray(posicoes) ? posicoes : []).map((p) => chaveDaPosicao(p, porId));
  const cabecas = todos.reduce((t, i) => t + i.cabecas, 0);
  // Posição sem cabeça não conta, a não ser que nenhuma tenha.
  const vivos = todos.filter((i) => i.cabecas > 0);
  const itens = vivos.length ? vivos : todos;
  const combos = combinacoes(itens);
  const sexos = new Set(itens.map((i) => i.sexo));

  if (!sexos.has(null) && sexos.size === 1 && combos.length > 0) {
    const sexo = combos[0].sexo;
    if (combos.length === 1) return montar(1, corDoSexo(sexo), [animalDe(combos[0])], null, cabecas);
    return montar(2, corDoSexo(sexo), [animalDe(/** @type {any} */ (predominante(combos)))], null, cabecas);
  }
  if (!sexos.has(null) && sexos.size === 2) {
    const misto = mistoDeclarado(combos);
    if (misto) {
      const animais = /** @type {Animal[]} */ (misto.composicao.map(animalDaFigura).filter(Boolean));
      return montar(3, COR_MISTO, animais, misto.chave, cabecas);
    }
    const macho = predominante(combos.filter((c) => c.sexo === "MACHO"));
    const femea = predominante(combos.filter((c) => c.sexo === "FEMEA"));
    if (macho && femea) {
      // O mais velho fica atrás (e maior); empate de faixa → o macho atrás.
      const machoAtras = ordemDaFaixa(macho.faixa) >= ordemDaFaixa(femea.faixa);
      const [fundo, frente] = machoAtras ? [macho, femea] : [femea, macho];
      return montar(4, COR_MISTO, [animalDe(fundo), animalDe(frente)], null, cabecas);
    }
  }
  return montar(5, COR_MISTO, [ultimoRecurso(itens, combos)], null, cabecas);
}

/**
 * Subícone de UMA posição (linha dos detalhes): o animal dela, na cor do sexo dela.
 * Sem sexo ou sem faixa conhecidos → null (a tela mostra o quadrado vazio).
 * @param {any} posicao
 * @param {any[]|Map<string, any>|null} [categoriasManejo]
 * @returns {Animal|null}
 */
export function figuraDaPosicao(posicao, categoriasManejo = null) {
  const { sexo, faixa } = chaveDaPosicao(posicao, mapaDeCategorias(categoriasManejo));
  return sexo && faixa ? animalDe({ sexo, faixa }) : null;
}

/**
 * Subícone de um GRUPO de posições (composição por categoria nos detalhes): a
 * combinação com mais cabeças (empate: a faixa mais velha), na cor do sexo dela.
 * Nunca misto. Sem nenhuma combinação conhecida → null.
 * @param {any[]|null|undefined} posicoes
 * @param {any[]|Map<string, any>|null} [categoriasManejo]
 * @returns {Animal|null}
 */
export function figuraDoGrupo(posicoes, categoriasManejo = null) {
  const porId = mapaDeCategorias(categoriasManejo);
  const p = predominante(combinacoes((Array.isArray(posicoes) ? posicoes : []).map((x) => chaveDaPosicao(x, porId))));
  return p ? animalDe(p) : null;
}

// ─── Leitura dos SVGs ───────────────────────────────────────────────────────

/**
 * @typedef {{ largura: number, altura: number, interno: string, paths: Array<{ d: string, vaca: boolean }> }} SvgLido
 */

/** @param {string} texto @param {string} nome @returns {SvgLido} */
const lerSvg = (texto, nome) => {
  const raiz = /^<svg\b[^>]*>/.exec(texto);
  const viewBox = raiz ? /\bviewBox="([^"]+)"/.exec(raiz[0]) : null;
  const caixa = viewBox ? viewBox[1].trim().split(/\s+/).map(Number) : [];
  const fim = texto.lastIndexOf("</svg>");
  const paths = [...texto.matchAll(/<path\b([^>]*)>/g)].map((m) => ({
    d: /\bd="([^"]*)"/.exec(m[1])?.[1] ?? "",
    vaca: /\bdata-vaca="1"/.test(m[1]),
  }));
  if (!raiz || caixa.length !== 4 || caixa.some((n) => !Number.isFinite(n)) || caixa[2] <= 0 || caixa[3] <= 0 || fim < 0 || !paths.length || paths.some((p) => !p.d)) {
    throw new Error(`Ícone de lote inválido: ${nome}`);
  }
  return { largura: caixa[2], altura: caixa[3], interno: texto.slice(raiz[0].length, fim), paths };
};

/** @type {Map<string, SvgLido>} */
const lidos = new Map();
/** @param {string} nome @param {string} texto */
const lido = (nome, texto) => {
  if (!lidos.has(nome)) lidos.set(nome, lerSvg(texto, nome));
  return /** @type {SvgLido} */ (lidos.get(nome));
};
/** @param {string} figura */
const svgDoAnimal = (figura) => (ANIMAIS_SVG[figura] ? lido(figura, ANIMAIS_SVG[figura]) : null);
/** @param {string} misto */
const svgDoMisto = (misto) => (MISTOS_SVG[misto] ? lido(misto, MISTOS_SVG[misto]) : null);

const MOLDURA = lerSvg(QUADRADINHO_SVG, "quadradinho");

// ─── Geometria do marcador (unidades do quadradinho: largura 1000) ─────────

/** Altura do card (sem a ponteira). */
const ALTURA_CARD = MOLDURA.altura * CARD_FRAC;
/** Linha que separa os animais da contagem: nada de animal abaixo dela. */
export const LIMITE_ANIMAIS = ALTURA_CARD * FAIXA_CONTAGEM;
/** Borda (em % da largura do card) → unidades do card. */
const bordaNoCard = (borda) => (borda / 100) * MOLDURA.largura;
/** Contorno branco visível fora do animal (o traço fica atrás do desenho: metade aparece). */
const meiaBorda = (borda) => bordaNoCard(borda) / 2;
/** Linha de chão: os pés ficam aqui, e nem a borda branca entra na faixa da contagem. */
export const LINHA_DE_CHAO = LIMITE_ANIMAIS - meiaBorda(Math.max(BORDA_PADRAO, BORDA_VACA_MISTO));
const ESQUERDA_LIVRE = MOLDURA.largura * FOLGA_LATERAL;
const LARGURA_LIVRE = MOLDURA.largura - 2 * ESQUERDA_LIVRE;
const TOPO_LIVRE = ALTURA_CARD * FOLGA_TOPO;
const ALTURA_LIVRE = LINHA_DE_CHAO - TOPO_LIVRE;

/** Centro da faixa da contagem, em % da altura do marcador (posição do número). */
export const CONTAGEM_TOPO_PCT = Math.round((((LIMITE_ANIMAIS + ALTURA_CARD) / 2) / MOLDURA.altura) * 10000) / 100;

/** @type {number|null} */
let larguraUtil = null;
/**
 * Largura útil do card (a do desenho de tamanho 1.00): a maior em que TODOS os desenhos
 * de um ícone só — os 10 animais no tamanho da faixa e os 4 mistos — cabem na área livre.
 * Assim o tamanho cresce com a faixa (0,70 … 1,00) sem nenhum invadir a contagem.
 */
export function larguraUtilDoCard() {
  if (larguraUtil === null) {
    const desenhos = [
      ...FIGURAS_ANIMAIS.map((f) => ({ svg: /** @type {SvgLido} */ (svgDoAnimal(f)), tamanho: tamanhoDaFaixa(animalDaFigura(f)?.faixa) })),
      ...FIGURAS_MISTOS.map((m) => ({ svg: /** @type {SvgLido} */ (svgDoMisto(m)), tamanho: tamanhoDoMisto() })),
    ];
    larguraUtil = Math.min(
      ...desenhos.flatMap(({ svg, tamanho }) => [LARGURA_LIVRE / tamanho, ALTURA_LIVRE / (tamanho * (svg.altura / svg.largura))])
    );
  }
  return larguraUtil;
}

/**
 * @typedef {{ svg: SvgLido, nome: string, x: number, y: number, escala: number, comVaca: boolean }} Desenho
 *   `escala`: unidades do card por unidade do desenho. `comVaca`: ícone com mais de um
 *   animal (a vaca usa BORDA_VACA_MISTO).
 */

/** @param {SvgLido} svg @param {string} nome @param {number} tamanho @param {boolean} comVaca @returns {Desenho[]} */
const umDesenho = (svg, nome, tamanho, comVaca) => {
  const largura = tamanho * larguraUtilDoCard();
  const escala = largura / svg.largura;
  return [{ svg, nome, escala, x: (MOLDURA.largura - largura) / 2, y: LINHA_DE_CHAO - svg.altura * escala, comVaca }];
};

/**
 * Nível 4: o mais novo na frente, à esquerda, cobrindo o de trás em
 * SOBREPOSICAO_COMPOSICAO da largura dele; os dois na mesma linha de chão. Se não
 * couber, os dois diminuem juntos (a proporção entre eles fica).
 * @param {Animal} fundo @param {Animal} frente
 * @returns {Desenho[]}
 */
const composicao = (fundo, frente) => {
  const base = larguraUtilDoCard();
  const sF = /** @type {SvgLido} */ (svgDoAnimal(fundo.figura));
  const sN = /** @type {SvgLido} */ (svgDoAnimal(frente.figura));
  const lF = tamanhoDaFaixa(fundo.faixa) * base;
  const lN = tamanhoDaFaixa(frente.faixa) * base;
  const aF = (sF.altura / sF.largura) * lF;
  const aN = (sN.altura / sN.largura) * lN;
  const passo = lN * (1 - SOBREPOSICAO_COMPOSICAO);
  const total = passo + lF;
  const k = Math.min(1, LARGURA_LIVRE / total, ALTURA_LIVRE / Math.max(aF, aN));
  const xFrente = (MOLDURA.largura - total * k) / 2;
  return [
    { svg: sF, nome: fundo.figura, escala: (lF * k) / sF.largura, x: xFrente + passo * k, y: LINHA_DE_CHAO - aF * k, comVaca: true },
    { svg: sN, nome: frente.figura, escala: (lN * k) / sN.largura, x: xFrente, y: LINHA_DE_CHAO - aN * k, comVaca: true },
  ];
};

/**
 * Onde cada desenho do ícone fica no card (para o SVG e para os testes).
 * @param {IconeLote} icone
 * @returns {Desenho[]}
 */
export function desenhosDoMarcador(icone) {
  if (icone.nivel === 3 && icone.misto) {
    const svg = svgDoMisto(icone.misto);
    if (svg) return umDesenho(svg, icone.misto, tamanhoDoMisto(), true);
  }
  if (icone.nivel === 4 && icone.animais.length === 2) return composicao(icone.animais[0], icone.animais[1]);
  const animal = icone.animais[0] ?? /** @type {Animal} */ (animalDaFigura(FIGURA_ULTIMO_RECURSO));
  const svg = svgDoAnimal(animal.figura) ?? /** @type {SvgLido} */ (svgDoAnimal(FIGURA_ULTIMO_RECURSO));
  return umDesenho(svg, animal.figura, tamanhoDaFaixa(animal.faixa), false);
}

/** Número curto e estável no SVG. @param {number} v */
const n = (v) => String(Math.round(v * 10000) / 10000);

/**
 * Traço branco de um desenho, em unidades DO DESENHO: a borda é dada em % da largura
 * do card, e a divisão pela escala do desenho a deixa igual na tela para todos — o
 * bezerro a 70% e o boi a 100% ficam com a mesma grossura.
 * @param {number} borda @param {number} escala
 */
export const tracoNoDesenho = (borda, escala) => bordaNoCard(borda) / escala;

/** @param {Desenho} d */
const grupoDoDesenho = (d) => {
  const caminhos = d.svg.paths
    .map((p) => `<path d="${p.d}" stroke-width="${n(tracoNoDesenho(d.comVaca && p.vaca ? BORDA_VACA_MISTO : BORDA_PADRAO, d.escala))}"${p.vaca ? ' data-vaca="1"' : ""}/>`)
    .join("");
  return `<g data-desenho="${d.nome}" transform="translate(${n(d.x)} ${n(d.y)}) scale(${n(d.escala)})">${caminhos}</g>`;
};

const ATRIBUTOS_TRACO = 'stroke="#ffffff" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke"';

/**
 * SVG do marcador do lote: a moldura do proprietário e o(s) animal(is) na cor do ícone.
 * @param {IconeLote} icone
 * @returns {string}
 */
export function svgMarcadorLote(icone) {
  const desenhos = desenhosDoMarcador(icone).map(grupoDoDesenho).join("");
  // O recorte mantém todo o traço para dentro da moldura, sem cortar os cantos
  // nem alterar o espaço dos animais, da contagem ou da ponteira.
  const larguraBorda = Math.max(0, BORDA_MOLDURA_PCT) / 100 * MOLDURA.largura;
  const moldura = MOLDURA.interno
    .replace(/stroke="[^"]*"/g, `stroke="${icone.cor}"`)
    .replace(/stroke-width="[^"]*"/g, `stroke-width="${n(larguraBorda * 2)}"`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MOLDURA.largura} ${MOLDURA.altura}" width="${MOLDURA.largura}" height="${MOLDURA.altura}" data-icone-lote="${icone.chave}"><defs><clipPath id="borda-card-lote">${MOLDURA.interno}</clipPath></defs><g data-moldura-lote="" clip-path="url(#borda-card-lote)">${moldura}</g><g fill="${icone.cor}" ${ATRIBUTOS_TRACO}>${desenhos}</g></svg>`;
}

/** @param {string} svg */
const comoUrl = (svg) => `data:image/svg+xml;base64,${btoa(svg)}`;

/** @type {Map<string, string>} */
const urlsMarcador = new Map();
/**
 * URL (data:) do marcador; montada uma vez por desenho.
 * @param {IconeLote} icone
 */
export function urlMarcadorLote(icone) {
  const chave = `${icone.chave}|${icone.cor}`;
  if (!urlsMarcador.has(chave)) urlsMarcador.set(chave, comoUrl(svgMarcadorLote(icone)));
  return /** @type {string} */ (urlsMarcador.get(chave));
}

// ─── Subícone (sem moldura; nunca misto) ────────────────────────────────────

/**
 * SVG do subícone: o animal sozinho, na cor do sexo. A borda branca tem na tela a
 * mesma grossura do marcador do mapa (BORDA_PADRAO % de LARGURA_MARCADOR_PX), seja
 * qual for o `tamanhoPx` em que a tela mostra o subícone.
 * @param {string|null|undefined} figura chave do animal ('femea-13-24')
 * @param {number} [tamanhoPx] largura em que a tela mostra o subícone
 * @returns {string|null}
 */
export function svgSubiconeLote(figura, tamanhoPx = 32) {
  const animal = figura ? animalDaFigura(figura) : null;
  const svg = animal ? svgDoAnimal(animal.figura) : null;
  if (!animal || !svg) return null;
  const t = Number(tamanhoPx) > 0 ? Number(tamanhoPx) : 32;
  // Grossura do traço na tela, em px (a mesma do mapa), nunca maior que 1/4 do ícone.
  const tracoPx = Math.min((BORDA_PADRAO / 100) * LARGURA_MARCADOR_PX, t / 4);
  // Margem para a borda não ser cortada: metade do traço, em unidades do desenho.
  const margem = (tracoPx * svg.largura) / (2 * (t - tracoPx));
  const caixa = `${n(-margem)} ${n(-margem)} ${n(svg.largura + 2 * margem)} ${n(svg.altura + 2 * margem)}`;
  const caminhos = svg.paths.map((p) => `<path d="${p.d}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${caixa}" width="${n(svg.largura + 2 * margem)}" height="${n(svg.altura + 2 * margem)}" data-figura="${animal.figura}"><g fill="${corDoSexo(animal.sexo)}" stroke-width="${n(2 * margem)}" ${ATRIBUTOS_TRACO}>${caminhos}</g></svg>`;
}

/** @type {Map<string, string>} */
const urlsSubicone = new Map();
/**
 * URL (data:) do subícone, ou null quando a figura não existe.
 * @param {string|null|undefined} figura
 * @param {number} [tamanhoPx]
 * @returns {string|null}
 */
export function urlSubiconeLote(figura, tamanhoPx = 32) {
  if (!figura) return null;
  const chave = `${figura}|${tamanhoPx}`;
  if (!urlsSubicone.has(chave)) {
    const svg = svgSubiconeLote(figura, tamanhoPx);
    if (!svg) return null;
    urlsSubicone.set(chave, comoUrl(svg));
  }
  return /** @type {string} */ (urlsSubicone.get(chave));
}
