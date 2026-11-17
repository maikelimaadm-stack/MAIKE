/**
 * D-PROD-219 — Medição de Forragem: as contas da medição do pasto, num módulo puro
 * (sem React, sem rede). A tela tem uma cópia com as MESMAS regras
 * (`src/domain/pastagem/medicaoForragem.js`) só para a prévia: quem grava é
 * o serviço, com estas contas.
 *
 * Régua: as leituras em cm (texto pt-BR, "22 26 24,5", separadas por espaço, ";" ou "/")
 * viram a média (1 casa) e a situação, pelas alturas da cultura da área:
 *   abaixo da saída → RAPADO; da saída até antes da entrada → DESCANSO;
 *   da entrada até entrada × 1,2 → PRONTO; acima disso → PASSOU (do ponto).
 *   Sem cultura ou sem as duas alturas → sem situação (só a média).
 * No olho: a situação é escolhida, sem número.
 * Amostra de corte (opcional, só na régua):
 *   matéria verde (kg/ha) = peso verde médio da amostra (g) ÷ quadro (m²) × 10;
 *   matéria seca (%) = peso seco ÷ peso verde × 100 — ou digitada (laboratório);
 *   massa seca (kg MS/ha) = matéria verde × MS% ÷ 100.
 */

export const METODOS = Object.freeze(['REGUA', 'OLHO']);
export const SITUACOES = Object.freeze(['RAPADO', 'DESCANSO', 'PRONTO', 'PASSOU']);
export const ROTULO_SITUACAO = Object.freeze({ RAPADO: 'Rapado', DESCANSO: 'Descanso', PRONTO: 'Pronto', PASSOU: 'Passou do ponto' });
/** Acima de entrada × FATOR_PASSOU o pasto "passou do ponto" (decisão do proprietário: 20%). */
export const FATOR_PASSOU = 1.2;
export const LEITURA_MAXIMA_CM = 500;
export const MAX_LEITURAS = 200;

/** @param {number} v @param {number} casas */
export const arredondar = (v, casas) => {
  const f = 10 ** casas;
  return Math.round((v + Number.EPSILON) * f) / f;
};

/**
 * Número em formato brasileiro ("25,5", "25.5", "1.234,5"). Vazio → null; inválido → NaN.
 * @param {unknown} valor
 * @returns {number|null}
 */
export const numeroPtBR = (valor) => {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : Number.NaN;
  const texto = String(valor).trim();
  if (!texto) return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+([.,]\d+)?$/.test(texto)) return Number.NaN;
  const normalizado = texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : Number.NaN;
};

/**
 * Leituras da régua: lista de números ou texto ("22 26 24,5").
 * @param {unknown} entrada
 * @returns {{ valores: number[], invalidas: string[] }}
 */
export const lerLeituras = (entrada) => {
  const partes = Array.isArray(entrada)
    ? entrada
    : String(entrada ?? '').split(/[\s;/]+/).filter((p) => p !== '');
  const valores = [];
  const invalidas = [];
  for (const parte of partes) {
    const n = numeroPtBR(parte);
    if (n === null) continue;
    if (Number.isNaN(n) || n < 0 || n > LEITURA_MAXIMA_CM) invalidas.push(String(parte));
    else valores.push(arredondar(n, 1));
  }
  return { valores, invalidas };
};

/** @param {number[]} valores @returns {number|null} média com 1 casa */
export const mediaDasLeituras = (valores) =>
  valores.length ? arredondar(valores.reduce((s, v) => s + v, 0) / valores.length, 1) : null;

/**
 * Situação do pasto pela altura média e pelas alturas da cultura.
 * @param {number|null} media
 * @param {number|null|undefined} entrada altura de entrada (cm)
 * @param {number|null|undefined} saida altura de saída (cm)
 * @returns {'RAPADO'|'DESCANSO'|'PRONTO'|'PASSOU'|null}
 */
export const situacaoPelaAltura = (media, entrada, saida) => {
  const e = entrada === null || entrada === undefined ? null : Number(entrada);
  const s = saida === null || saida === undefined ? null : Number(saida);
  if (media === null || media === undefined || !Number.isFinite(media)) return null;
  if (!Number.isFinite(e) || !Number.isFinite(s) || e === null || s === null || e <= 0 || s <= 0) return null;
  if (media < s) return 'RAPADO';
  if (media < e) return 'DESCANSO';
  if (media <= arredondar(e * FATOR_PASSOU, 1)) return 'PRONTO';
  return 'PASSOU';
};

/**
 * Contas da amostra de corte. Sem quadro ou sem peso verde → tudo nulo.
 * O peso seco, quando informado, decide a MS%; senão vale a MS% digitada.
 * @param {{ quadro_m2?: number|null, peso_verde_g?: number|null, peso_seco_g?: number|null, materia_seca_pct?: number|null }} a
 * @returns {{ massa_verde_kg_ha: number|null, materia_seca_pct: number|null, massa_seca_kg_ha: number|null }}
 */
export const calcularAmostra = ({ quadro_m2, peso_verde_g, peso_seco_g, materia_seca_pct } = {}) => {
  const q = Number(quadro_m2);
  const verde = Number(peso_verde_g);
  if (!(q > 0) || !(verde > 0)) return { massa_verde_kg_ha: null, materia_seca_pct: null, massa_seca_kg_ha: null };
  const massaVerde = arredondar((verde / q) * 10, 1);
  const seco = Number(peso_seco_g);
  let pct = null;
  if (peso_seco_g !== null && peso_seco_g !== undefined && seco > 0) pct = arredondar((seco / verde) * 100, 2);
  else if (materia_seca_pct !== null && materia_seca_pct !== undefined && Number(materia_seca_pct) > 0) pct = arredondar(Number(materia_seca_pct), 2);
  const massaSeca = pct === null ? null : arredondar((massaVerde * pct) / 100, 1);
  return { massa_verde_kg_ha: massaVerde, materia_seca_pct: pct, massa_seca_kg_ha: massaSeca };
};

/**
 * Total de matéria seca no pasto inteiro, em toneladas (1 casa) — só na tela.
 * @param {number|null} massaSecaKgHa @param {number|null|undefined} hectares
 */
export const toneladasNoPasto = (massaSecaKgHa, hectares) => {
  const ha = Number(hectares);
  if (massaSecaKgHa === null || massaSecaKgHa === undefined || !(ha > 0)) return null;
  return arredondar((massaSecaKgHa * ha) / 1000, 1);
};
