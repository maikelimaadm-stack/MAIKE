/**
 * D-PROD-157 — unidades físicas das medições de benfeitoria (funções PURAS).
 *
 * Conversão só DENTRO da dimensão, por fator EXATO (string → Decimal, nunca
 * float): 1 km = 1000 m, 1 ha = 10000 m², 1 m³ = 1000 L, 1 t = 1000 kg. O
 * valor informado é Decimal(14,4) e o normalizado Decimal(22,4): o produto
 * pelo maior fator (10000) é sempre exato nessa escala. O medidor (h, km,
 * ciclos) é outra coisa e nunca é derivado daqui.
 */

import { AppError } from '../../shared/errors/AppError.js';
import { Dec, ZERO, casasDecimais, dec } from '../financeiro/decimalFinanceiro.js';
import { DIMENSOES, DIMENSOES_INTEIRAS, UNIDADES_FISICAS } from './patrimonioDominio.js';

/** Escala das colunas de medida (Decimal(14,4) e Decimal(22,4)). */
export const CASAS_MEDIDA = 4;
/** Teto do valor informado (Decimal(14,4)). */
export const LIMITE_MEDIDA = new Dec('9999999999.9999');
/** Teto do valor normalizado (Decimal(22,4)). */
export const LIMITE_MEDIDA_NORMALIZADA = new Dec('999999999999999999.9999');

/** @param {string} dimensao @returns {string|null} */
export const unidadeCanonicaDe = (dimensao) => DIMENSOES[dimensao]?.canonica ?? null;

/** @param {string} dimensao @returns {readonly string[]} */
export const unidadesDaDimensao = (dimensao) => DIMENSOES[dimensao]?.unidades ?? [];

/** @param {string} unidade @returns {string|null} */
export const dimensaoDaUnidade = (unidade) => UNIDADES_FISICAS[unidade]?.dimensao ?? null;

/** @param {string} unidade @param {string} dimensao */
export const unidadeDaDimensao = (unidade, dimensao) => dimensaoDaUnidade(unidade) === dimensao;

/** Rótulo pt-BR da unidade ("hectares"); desconhecida → a própria sigla. */
export const rotuloDaUnidade = (unidade) => UNIDADES_FISICAS[unidade]?.rotulo ?? unidade;

const unidadesInvalidas = (mensagem, details) =>
  new AppError('PERFIL_UNIDADES_INVALIDAS', `${mensagem}; nada foi gravado`, { details: { field: 'unidades_permitidas', ...details } });

/**
 * Unidades permitidas de um perfil: subconjunto da dimensão, sem repetição,
 * sempre com a canônica. Devolve na ordem da dimensão (canônica primeiro).
 * Violação → 422 `PERFIL_UNIDADES_INVALIDAS` (reason `vazia`, `fora_da_dimensao`,
 * `repetida` ou `sem_canonica`).
 * @param {string} dimensao
 * @param {unknown} lista
 * @returns {string[]}
 */
export const validarUnidadesPermitidas = (dimensao, lista) => {
  const daDimensao = unidadesDaDimensao(dimensao);
  if (!Array.isArray(lista) || lista.length === 0) throw unidadesInvalidas('informe ao menos uma unidade', { reason: 'vazia' });
  const fora = lista.filter((u) => typeof u !== 'string' || !daDimensao.includes(u));
  if (fora.length) {
    throw unidadesInvalidas(`unidade fora da dimensão ${dimensao}`, { reason: 'fora_da_dimensao', unidades: fora.map(String), permitidas: [...daDimensao] });
  }
  if (new Set(lista).size !== lista.length) throw unidadesInvalidas('unidade repetida', { reason: 'repetida' });
  const canonica = unidadeCanonicaDe(dimensao);
  if (!lista.includes(canonica)) throw unidadesInvalidas(`a unidade canônica (${canonica}) é obrigatória`, { reason: 'sem_canonica', canonica });
  return daDimensao.filter((u) => lista.includes(u));
};

/**
 * Converte para a unidade canônica da dimensão da unidade (fator exato).
 * Unidade desconhecida → null (quem chama decide o erro).
 * @param {unknown} valor  string decimal, Decimal ou inteiro seguro
 * @param {string} unidade
 * @returns {{ valor_normalizado: string, unidade_canonica: string } | null}
 */
export const converterParaCanonica = (valor, unidade) => {
  const u = UNIDADES_FISICAS[unidade];
  if (!u) return null;
  return {
    valor_normalizado: dec(valor).times(dec(u.fator)).toFixed(CASAS_MEDIDA),
    unidade_canonica: unidadeCanonicaDe(u.dimensao),
  };
};

const valorInvalido = (field, reason, mensagem) =>
  new AppError('MEDICAO_VALOR_INVALIDO', `${mensagem}; nada foi gravado`, { details: { field, reason } });

/**
 * Normaliza UMA medição contra o seu perfil (sem banco):
 *  - unidade fora de `perfil.unidades_permitidas` → 422 `MEDICAO_UNIDADE_INCOMPATIVEL`
 *    (ex.: m2 num perfil de VOLUME);
 *  - valor string decimal > 0, ≤ 9999999999.9999, até 4 casas → senão 422
 *    `MEDICAO_VALOR_INVALIDO` (reason `nao_numerico`, `nao_positivo`, `casas`,
 *    `acima_do_limite`); QUANTIDADE/CABECAS exigem inteiro (`deve_ser_inteiro`).
 * @param {{ dimensao: string, unidades_permitidas: readonly string[] }} perfil
 * @param {unknown} valor
 * @param {unknown} unidade
 * @param {string} [campo]  prefixo do caminho no corpo (ex.: `medicoes[0]`)
 * @returns {{ valor_informado: string, unidade_informada: string, valor_normalizado: string, unidade_canonica: string }}
 */
export const normalizarMedicao = (perfil, valor, unidade, campo = 'medicao') => {
  if (typeof unidade !== 'string' || !perfil.unidades_permitidas.includes(unidade) || !unidadeDaDimensao(unidade, perfil.dimensao)) {
    throw new AppError('MEDICAO_UNIDADE_INCOMPATIVEL', `a unidade ${String(unidade)} não é aceita por este perfil (${perfil.dimensao}); nada foi gravado`, {
      details: { field: `${campo}.unidade`, reason: 'unidade_incompativel', unidades_permitidas: [...perfil.unidades_permitidas] },
    });
  }
  const field = `${campo}.valor`;
  if (typeof valor !== 'string' || !/^\d+(\.\d+)?$/.test(valor)) throw valorInvalido(field, 'nao_numerico', 'o valor da medição deve ser um número decimal positivo');
  if (casasDecimais(valor) > CASAS_MEDIDA) throw valorInvalido(field, 'casas', 'o valor da medição aceita no máximo 4 casas decimais');
  const v = dec(valor);
  if (v.lte(ZERO)) throw valorInvalido(field, 'nao_positivo', 'o valor da medição deve ser maior que zero');
  if (v.gt(LIMITE_MEDIDA)) throw valorInvalido(field, 'acima_do_limite', 'o valor da medição passa do limite aceito');
  if (DIMENSOES_INTEIRAS.includes(perfil.dimensao) && !v.isInteger()) {
    throw valorInvalido(field, 'deve_ser_inteiro', 'esta medição é uma contagem: informe um número inteiro');
  }
  const convertido = /** @type {{ valor_normalizado: string, unidade_canonica: string }} */ (converterParaCanonica(v, unidade));
  if (dec(convertido.valor_normalizado).gt(LIMITE_MEDIDA_NORMALIZADA)) throw valorInvalido(field, 'acima_do_limite', 'o valor convertido passa do limite aceito');
  return { valor_informado: v.toFixed(CASAS_MEDIDA), unidade_informada: unidade, ...convertido };
};
