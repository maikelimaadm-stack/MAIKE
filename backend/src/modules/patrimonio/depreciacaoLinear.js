/**
 * D-PROD-157 — prévia de depreciação LINEAR (função PURA, contrato §6 + A14).
 *
 * É uma SIMULAÇÃO gerencial: não grava nada, não gera lançamento, título,
 * despesa nem movimento de estoque, e não apura valor contábil (o ledger de
 * depreciação é de um slice futuro). Aritmética em `Decimal` de
 * `decimalFinanceiro.js` (nunca float):
 *
 *  - custo_base        = valor_aquisicao + (custo_incorporacao ?? 0)
 *  - valor_residual    = VALOR ? valor_residual : arredondar(custo_base × pct / 100, 2)
 *  - valor_depreciavel = custo_base − valor_residual (≥ 0)
 *  - quota_mensal      = piso(valor_depreciavel / meses, 2) (truncada em centavos)
 *  - ultima_quota      = valor_depreciavel − quota_mensal × (meses − 1): a
 *                        diferença do arredondamento fica na ÚLTIMA quota
 *  - quota_anual       = min(quota_mensal × 12, valor_depreciavel) (informativa;
 *                        com valor depreciável < 1 centavo por mês a quota é
 *                        0.00 e a última absorve tudo)
 *  - taxa_anual_percentual = 1200 / meses, 4 casas
 *  - competências: SEM pró-rata — a primeira é o mês cheio do início
 *    (AAAA-MM) e a última é início + (meses − 1) meses.
 */

import { AppError } from '../../shared/errors/AppError.js';
import { CEM, ZERO, arredondar, casasDecimais, dec, piso } from '../financeiro/decimalFinanceiro.js';
import { ehDiaValido } from './patrimonioComum.js';
import { RESIDUAL_MODOS, VIDA_UTIL_MAXIMA_MESES, VIDA_UTIL_MINIMA_MESES } from './patrimonioDominio.js';

export const CASAS_DINHEIRO = 2;
export const CASAS_TAXA = 4;
export const AVISO_PREVIA = 'Prévia gerencial simulada: não gera lançamento, título, despesa nem movimento de estoque.';

const parametros = (mensagem, field, reason) =>
  new AppError('DEPRECIACAO_PARAMETROS_INVALIDOS', `${mensagem}; nada foi gravado`, { details: { field, reason } });
const residualInvalido = (mensagem, details) =>
  new AppError('DEPRECIACAO_RESIDUAL_INVALIDO', `${mensagem}; nada foi gravado`, { details: { field: 'valor_residual', reason: 'residual_maior_que_custo', ...details } });

/** Decimal não negativo vindo do corpo (string) ou do banco (Decimal). */
const naoNegativo = (valor, field) => {
  if (typeof valor === 'string' && !/^\d+(\.\d+)?$/.test(valor)) throw parametros(`${field} deve ser um número decimal não negativo`, field, 'nao_numerico');
  if (typeof valor === 'string' && casasDecimais(valor) > CASAS_TAXA) throw parametros(`${field} aceita no máximo 4 casas decimais`, field, 'casas');
  let d;
  try {
    d = dec(valor);
  } catch {
    throw parametros(`${field} deve ser um número decimal não negativo`, field, 'nao_numerico');
  }
  if (d.isNegative()) throw parametros(`${field} não pode ser negativo`, field, 'negativo');
  return d;
};

const competencia = (ano, mesIndice) => {
  const total = ano * 12 + mesIndice;
  const a = Math.floor(total / 12);
  const m = total % 12;
  return `${String(a).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}`;
};

/**
 * @param {{
 *   valor_aquisicao: unknown, custo_incorporacao?: unknown, residual_modo: unknown,
 *   valor_residual?: unknown, residual_percentual?: unknown, vida_util_meses: unknown,
 *   data_inicio_depreciacao: unknown,
 * }} entrada  strings (corpo HTTP) ou Decimal/Date do banco
 */
export const simularDepreciacaoLinear = (entrada) => {
  const meses = entrada.vida_util_meses;
  if (!Number.isInteger(meses) || /** @type {number} */ (meses) < VIDA_UTIL_MINIMA_MESES || /** @type {number} */ (meses) > VIDA_UTIL_MAXIMA_MESES) {
    throw new AppError('DEPRECIACAO_VIDA_UTIL_INVALIDA', `a vida útil deve ser de ${VIDA_UTIL_MINIMA_MESES} a ${VIDA_UTIL_MAXIMA_MESES} meses; nada foi gravado`, {
      details: { field: 'vida_util_meses', reason: 'fora_da_faixa', minimo: VIDA_UTIL_MINIMA_MESES, maximo: VIDA_UTIL_MAXIMA_MESES },
    });
  }
  const n = /** @type {number} */ (meses);
  const inicio = entrada.data_inicio_depreciacao instanceof Date ? entrada.data_inicio_depreciacao.toISOString().slice(0, 10) : entrada.data_inicio_depreciacao;
  if (!ehDiaValido(inicio)) {
    throw new AppError('PATRIMONIO_DATA_INVALIDA', 'informe a data de início da depreciação (AAAA-MM-DD); nada foi gravado', {
      details: { field: 'data_inicio_depreciacao', reason: 'data_inexistente' },
    });
  }
  if (entrada.valor_aquisicao === null || entrada.valor_aquisicao === undefined) {
    throw parametros('informe o valor de aquisição para simular a depreciação', 'valor_aquisicao', 'obrigatorio');
  }
  const modo = entrada.residual_modo;
  if (typeof modo !== 'string' || !RESIDUAL_MODOS.includes(modo)) throw parametros('informe o residual por VALOR ou por PERCENTUAL', 'residual_modo', 'obrigatorio');
  const temValor = entrada.valor_residual !== null && entrada.valor_residual !== undefined;
  const temPercentual = entrada.residual_percentual !== null && entrada.residual_percentual !== undefined;
  if (modo === 'VALOR' && (!temValor || temPercentual)) throw parametros('com residual por VALOR informe só o valor residual', 'valor_residual', 'residual_em_uma_forma');
  if (modo === 'PERCENTUAL' && (!temPercentual || temValor)) throw parametros('com residual por PERCENTUAL informe só o percentual', 'residual_percentual', 'residual_em_uma_forma');

  const aquisicao = naoNegativo(entrada.valor_aquisicao, 'valor_aquisicao');
  const incorporacao = entrada.custo_incorporacao === null || entrada.custo_incorporacao === undefined ? ZERO : naoNegativo(entrada.custo_incorporacao, 'custo_incorporacao');
  const custoBase = arredondar(aquisicao.plus(incorporacao), CASAS_DINHEIRO);

  let residual;
  if (modo === 'VALOR') {
    residual = arredondar(naoNegativo(entrada.valor_residual, 'valor_residual'), CASAS_DINHEIRO);
  } else {
    const pct = naoNegativo(entrada.residual_percentual, 'residual_percentual');
    if (pct.gt(CEM)) throw residualInvalido('o percentual residual deve ser de 0 a 100', { field: 'residual_percentual', reason: 'percentual_fora_da_faixa' });
    residual = arredondar(custoBase.times(pct).dividedBy(CEM), CASAS_DINHEIRO);
  }
  if (residual.gt(custoBase)) {
    throw residualInvalido('o valor residual não pode ser maior que o custo do bem', { custo_base: custoBase.toFixed(CASAS_DINHEIRO), valor_residual: residual.toFixed(CASAS_DINHEIRO) });
  }

  const depreciavel = custoBase.minus(residual);
  const quota = piso(depreciavel.dividedBy(n), CASAS_DINHEIRO);
  const ultima = depreciavel.minus(quota.times(n - 1));
  const anualCheia = quota.times(12);
  const anual = anualCheia.gt(depreciavel) ? depreciavel : anualCheia;
  const taxa = arredondar(dec(1200).dividedBy(n), CASAS_TAXA);

  const [ano, mes] = String(inicio).split('-').map(Number);
  return {
    simulada: true,
    contabilizada: false,
    metodo: 'LINEAR',
    custo_base: custoBase.toFixed(CASAS_DINHEIRO),
    valor_residual: residual.toFixed(CASAS_DINHEIRO),
    valor_depreciavel: depreciavel.toFixed(CASAS_DINHEIRO),
    vida_util_meses: n,
    quota_mensal: quota.toFixed(CASAS_DINHEIRO),
    ultima_quota: ultima.toFixed(CASAS_DINHEIRO),
    quota_anual: anual.toFixed(CASAS_DINHEIRO),
    taxa_anual_percentual: taxa.toFixed(CASAS_TAXA),
    primeira_competencia: competencia(ano, mes - 1),
    ultima_competencia: competencia(ano, mes - 1 + n - 1),
    valor_contabil: null,
    depreciacao_acumulada: null,
    aviso: AVISO_PREVIA,
  };
};
