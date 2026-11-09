/**
 * D-PROD-154 — aritmética decimal da Central Única de Lançamentos.
 *
 * Dinheiro, quantidade, preço e percentual são `Decimal` ponta a ponta: nunca
 * `Number()`/float em soma, rateio, parcela ou custo. Um construtor PRÓPRIO
 * (`clone`), com precisão 50 e ROUND_HALF_UP — nunca `Decimal.set` global, que
 * mudaria o comportamento do Prisma e de qualquer outro módulo do processo.
 * Com a precisão padrão (20), `7984815747.9459 × 219.522662` arredondado a 2
 * casas dá `…568.61`; o exato é `…568.60` (crítica 0, MÉDIO 5).
 *
 * Entrada e saída HTTP: STRING canônica (`"1234.56"`, ponto decimal, sem milhar).
 */

import { Prisma } from '@prisma/client';

export const Dec = Prisma.Decimal.clone({ precision: 50, rounding: Prisma.Decimal.ROUND_HALF_UP });

export const ZERO = new Dec(0);
export const UM = new Dec(1);
export const CEM = new Dec(100);

/** Teto das colunas de dinheiro Decimal(18,4) das tabelas novas. */
export const LIMITE_DINHEIRO = new Dec('99999999999999.9999');
/** Teto das colunas ANTIGAS de estoque Decimal(14,4) (lote, movimento, estoque_atual). */
export const LIMITE_ESTOQUE = new Dec('9999999999.9999');

/** Escalas fixas da resposta (§5): quantidade 4, preço unitário 6, percentual 6. */
export const CASAS_QUANTIDADE = 4;
export const CASAS_PRECO = 6;
export const CASAS_PERCENTUAL = 6;
export const CASAS_CUSTO = 4;

/**
 * Converte string canônica, Decimal (de qualquer construtor, inclusive o do
 * Prisma) ou inteiro seguro para o `Dec` desta camada. Float não entra: um
 * `number` não inteiro é recusado (nunca deveria chegar aqui).
 * @param {unknown} valor
 * @returns {InstanceType<typeof Dec>}
 */
export const dec = (valor) => {
  // `Decimal.clone` compartilha o protótipo: o `Prisma.Decimal` lido do banco
  // também é `instanceof Dec`, mas carrega o construtor do Prisma (precisão 20)
  // e as contas com ele arredondariam a 20 dígitos (rodada 2, DINHEIRO-1).
  if (valor instanceof Dec) return valor.constructor === Dec ? valor : new Dec(valor.toString());
  if (typeof valor === 'string') return new Dec(valor);
  if (typeof valor === 'number') {
    if (!Number.isSafeInteger(valor)) throw new TypeError('decimalFinanceiro: número não inteiro não é aceito (use string)');
    return new Dec(valor);
  }
  if (valor && typeof valor === 'object' && typeof /** @type {any} */ (valor).toFixed === 'function') {
    return new Dec(/** @type {any} */ (valor).toString());
  }
  throw new TypeError('decimalFinanceiro: valor decimal ausente ou inválido');
};

/** `dec` que aceita nulo/ausente. */
export const decOuNulo = (valor) => (valor === null || valor === undefined ? null : dec(valor));

/** ROUND_HALF_UP na escala. */
export const arredondar = (x, casas) => dec(x).toDecimalPlaces(casas, Dec.ROUND_HALF_UP);

/** Piso na escala (valores não negativos: truncar = piso). */
export const piso = (x, casas) => dec(x).toDecimalPlaces(casas, Dec.ROUND_DOWN);

/** Menor unidade da escala (0,01 para 2 casas; 1 para 0 casas). */
export const unidadeMinima = (casas) => new Dec(1).dividedBy(new Dec(10).pow(casas));

/**
 * Texto canônico na escala exata (`toFixed` com ROUND_HALF_UP do construtor).
 * @param {unknown} x
 * @param {number} casas
 * @returns {string|null}
 */
export const texto = (x, casas) => (x === null || x === undefined ? null : dec(x).toFixed(casas));

/** Casas decimais escritas numa string canônica ("12.340" → 3). */
export const casasDecimais = (s) => {
  const i = String(s).indexOf('.');
  return i < 0 ? 0 : String(s).length - i - 1;
};

/** Valor para gravar no Prisma: string na escala da coluna. */
export const paraBanco = (x, casas) => dec(x).toFixed(casas);

/** Soma de uma lista de decimais. */
export const somar = (lista) => lista.reduce((t, v) => t.plus(dec(v)), ZERO);
