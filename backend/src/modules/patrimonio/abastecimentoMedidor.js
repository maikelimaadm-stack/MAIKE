/**
 * D-PROD-159 (Patrimônio P1-02) — série do medidor operacional do bem.
 *
 * A leitura registrada num abastecimento vive em `AbastecimentoBem`
 * (`medidor_origem = 'ABASTECIMENTO'`); o abastecimento NUNCA grava colunas de
 * `BemPatrimonial`. A série de um medidor é: o ponto do CADASTRO do bem
 * (`medidor_leitura_atual` em `medidor_data_leitura`) + as leituras dos
 * abastecimentos CONFIRMADOS do MESMO tipo de medidor. Este módulo só lê
 * (sem importar serviços): é usado pelo bem (piso do ajuste, X2) e pelo
 * abastecimento (vizinhos da leitura nova, leitura vigente).
 *
 * D-PROD-202 pôs na série as linhas de MÁQUINA do Lançamento de Atividades; D-PROD-383: saíram com as atividades.
 *
 * D-PROD-211: os abastecimentos das DUAS origens (ESTOQUE e EXTERNO, o posto
 * de estrada) entram na série — o filtro é o status e o tipo do medidor, nunca
 * o local de estoque: o combustível do posto também entra no tanque do bem.
 *
 * Ponto = `{ leitura: string(4), data: 'AAAA-MM-DD', origem: 'CADASTRO'|'ABASTECIMENTO',
 *   abastecimento_id: string|null, numero: string|null }`.
 */

import { dec } from '../financeiro/decimalFinanceiro.js';
import { comoData, diaDe } from './patrimonioComum.js';

export const ORIGEM_LEITURA_ABASTECIMENTO = 'ABASTECIMENTO';
export const MEDIDORES_CONTADOR = Object.freeze(['HORIMETRO', 'ODOMETRO', 'CICLOS']);
const CASAS_LEITURA = 4;

/** @param {unknown} tipo */
export const ehContador = (tipo) => typeof tipo === 'string' && MEDIDORES_CONTADOR.includes(tipo);

/**
 * Ponto do cadastro do bem (contador com leitura e data) ou null.
 * @param {any} bem linha de `BemPatrimonial` (medidor_tipo, medidor_leitura_atual, medidor_data_leitura)
 */
export const pontoDoCadastro = (bem) => {
  if (!bem || !ehContador(bem.medidor_tipo)) return null;
  if (bem.medidor_leitura_atual === null || bem.medidor_leitura_atual === undefined || !bem.medidor_data_leitura) return null;
  return {
    leitura: dec(bem.medidor_leitura_atual).toFixed(CASAS_LEITURA),
    data: diaDe(bem.medidor_data_leitura),
    origem: 'CADASTRO',
    abastecimento_id: null,
    numero: null,
  };
};

/** @param {any} r linha de `AbastecimentoBem` (id, numero, medidor_leitura, data_operacional) */
const pontoDoAbastecimento = (r) =>
  r
    ? {
        leitura: dec(r.medidor_leitura).toFixed(CASAS_LEITURA),
        data: diaDe(r.data_operacional),
        origem: ORIGEM_LEITURA_ABASTECIMENTO,
        abastecimento_id: r.id,
        numero: r.numero,
      }
    : null;

const SELECAO_PONTO = Object.freeze({ id: true, numero: true, medidor_leitura: true, data_operacional: true });

/** Filtro comum: abastecimentos CONFIRMADOS com leitura do MESMO tipo de medidor. */
const ondeConfirmadosComLeitura = (clienteId, bemId, medidorTipo, excetoId) => ({
  cliente_id: clienteId,
  bem_id: bemId,
  status: 'CONFIRMADO',
  medidor_tipo: medidorTipo,
  medidor_leitura: { not: null },
  ...(excetoId ? { NOT: { id: excetoId } } : {}),
});

/**
 * Maior leitura OPERACIONAL do bem, do MESMO tipo de medidor: a de abastecimento CONFIRMADO (desempate: data desc,
 * createdAt desc, id desc). Sem contador → null. `excetoId` tira um abastecimento.
 * @param {any} db cliente Prisma ou transação
 * @param {string} clienteId @param {string} bemId @param {string|null} medidorTipo
 * @param {{ excetoId?: string|null }} [opcoes]
 */
export const pisoOperacional = async (db, clienteId, bemId, medidorTipo, { excetoId = null } = {}) => {
  if (!ehContador(medidorTipo)) return null;
  const r = await db.abastecimentoBem.findFirst({
    where: ondeConfirmadosComLeitura(clienteId, bemId, medidorTipo, excetoId),
    orderBy: [{ medidor_leitura: 'desc' }, { data_operacional: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    select: SELECAO_PONTO,
  });
  return pontoDoAbastecimento(r);
};

/**
 * Vizinhos de `dia` entre os abastecimentos CONFIRMADOS com leitura: anterior = maior leitura com data <= dia;
 * posterior = menor leitura com data > dia.
 * @param {any} db @param {string} clienteId @param {string} bemId @param {string} medidorTipo @param {string} dia AAAA-MM-DD
 * @returns {Promise<{ anterior: any, posterior: any }>}
 */
export const pontosVizinhos = async (db, clienteId, bemId, medidorTipo, dia) => {
  if (!ehContador(medidorTipo)) return { anterior: null, posterior: null };
  const base = ondeConfirmadosComLeitura(clienteId, bemId, medidorTipo, null);
  const [anterior, posterior] = await Promise.all([
    db.abastecimentoBem.findFirst({
      where: { ...base, data_operacional: { lte: comoData(dia) } },
      orderBy: [{ medidor_leitura: 'desc' }, { data_operacional: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: SELECAO_PONTO,
    }),
    db.abastecimentoBem.findFirst({
      where: { ...base, data_operacional: { gt: comoData(dia) } },
      orderBy: [{ medidor_leitura: 'asc' }, { data_operacional: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: SELECAO_PONTO,
    }),
  ]);
  return { anterior: pontoDoAbastecimento(anterior), posterior: pontoDoAbastecimento(posterior) };
};

/**
 * Leitura VIGENTE = maior entre cadastro e operacional por (leitura, data);
 * empate total → ABASTECIMENTO. Pura.
 * @param {any} cadastro ponto|null @param {any} operacional ponto|null
 */
export const leituraVigente = (cadastro, operacional) => {
  if (!cadastro) return operacional ?? null;
  if (!operacional) return cadastro;
  const a = dec(cadastro.leitura);
  const b = dec(operacional.leitura);
  if (a.gt(b)) return cadastro;
  if (b.gt(a)) return operacional;
  return cadastro.data > operacional.data ? cadastro : operacional;
};

/** Dois pontos (ou null) são o mesmo ponto da série. Pura. */
export const pontosIguais = (a, b) => {
  if (!a || !b) return a === b || (!a && !b);
  return (
    a.leitura === b.leitura &&
    a.data === b.data &&
    a.origem === b.origem &&
    (a.abastecimento_id ?? null) === (b.abastecimento_id ?? null)
  );
};
