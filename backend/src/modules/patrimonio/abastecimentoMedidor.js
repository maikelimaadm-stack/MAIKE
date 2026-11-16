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
 * D-PROD-202 (Fatia 3 do Lançamento de Atividades): a série passa a ter
 * também as linhas de MÁQUINA (`AtividadeApontamentoMaquina`) CONFIRMADAS, com
 * leitura (`sem_medidor = false`), de apontamentos CONFIRMADOS, do MESMO tipo
 * de medidor. A linha é um trecho do medidor num dia (`data_operacional` do
 * apontamento): como ponto ANTERIOR (e como piso/vigente) vale a
 * `leitura_final`; como ponto POSTERIOR vale a `leitura_inicial` (a série é
 * monotônica: inicial <= final no mesmo dia). Nada é gravado no bem; cancelar
 * a linha (ou o apontamento) tira a leitura dela da série. Sem linhas, tudo é
 * idêntico ao comportamento anterior.
 *
 * D-PROD-210: os abastecimentos das DUAS origens (ESTOQUE e EXTERNO, o posto
 * de estrada) entram na série — o filtro é o status e o tipo do medidor, nunca
 * o local de estoque: o combustível do posto também entra no tanque do bem.
 *
 * Ponto = `{ leitura: string(4), data: 'AAAA-MM-DD', origem: 'CADASTRO'|'ABASTECIMENTO'|'ATIVIDADE',
 *   abastecimento_id: string|null, numero: string|null }`; o ponto de uma linha
 * de máquina traz também `linha_maquina_id` e `apontamento_id`.
 */

import { dec } from '../financeiro/decimalFinanceiro.js';
import { comoData, diaDe } from './patrimonioComum.js';

export const ORIGEM_LEITURA_ABASTECIMENTO = 'ABASTECIMENTO';
/** D-PROD-202 — ponto vindo de uma linha de máquina do Lançamento de Atividades. */
export const ORIGEM_LEITURA_ATIVIDADE = 'ATIVIDADE';
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

// ─── D-PROD-202: linhas de máquina do Lançamento de Atividades ─────────────

/**
 * Ponto de uma linha de máquina: `campo` = `leitura_final` (anterior, piso) ou
 * `leitura_inicial` (posterior). A data é a do apontamento.
 * @param {any} r linha de `AtividadeApontamentoMaquina` com `apontamento.data_operacional`
 * @param {'leitura_inicial'|'leitura_final'} campo
 */
const pontoDaLinhaMaquina = (r, campo) =>
  r
    ? {
        leitura: dec(r[campo]).toFixed(CASAS_LEITURA),
        data: diaDe(r.apontamento.data_operacional),
        origem: ORIGEM_LEITURA_ATIVIDADE,
        abastecimento_id: null,
        numero: null,
        linha_maquina_id: r.id,
        apontamento_id: r.apontamento_id,
      }
    : null;

const SELECAO_LINHA = Object.freeze({
  id: true, apontamento_id: true, leitura_inicial: true, leitura_final: true, apontamento: { select: { data_operacional: true } },
});

/**
 * Linhas de máquina CONFIRMADAS, com leitura, de apontamento CONFIRMADO, do
 * MESMO tipo de medidor (`excetoLinhaId` tira uma linha da conta).
 * @param {string} clienteId @param {string} bemId @param {string} medidorTipo @param {string|null} excetoLinhaId
 * @param {Record<string, unknown>} [dataDoApontamento]  filtro de `data_operacional`
 */
const ondeLinhasComLeitura = (clienteId, bemId, medidorTipo, excetoLinhaId, dataDoApontamento) => ({
  cliente_id: clienteId,
  bem_id: bemId,
  status: 'CONFIRMADO',
  medidor_tipo: medidorTipo,
  sem_medidor: false,
  apontamento: { status: 'CONFIRMADO', ...(dataDoApontamento ? { data_operacional: dataDoApontamento } : {}) },
  ...(excetoLinhaId ? { NOT: { id: excetoLinhaId } } : {}),
});

/** Ordem "maior leitura final" (desempate: data, criação e id, decrescentes). */
const MAIOR_FINAL = Object.freeze([{ leitura_final: 'desc' }, { apontamento: { data_operacional: 'desc' } }, { createdAt: 'desc' }, { id: 'desc' }]);
/** Ordem "menor leitura inicial" (desempate: data, criação e id, crescentes). */
const MENOR_INICIAL = Object.freeze([{ leitura_inicial: 'asc' }, { apontamento: { data_operacional: 'asc' } }, { createdAt: 'asc' }, { id: 'asc' }]);

/**
 * O maior de dois pontos por (leitura, data); empate total → o primeiro (o do
 * abastecimento, que já era o comportamento sem linhas). Pura.
 * @param {any} a @param {any} b
 */
const maiorPonto = (a, b) => {
  if (!a) return b ?? null;
  if (!b) return a;
  const la = dec(a.leitura);
  const lb = dec(b.leitura);
  if (lb.gt(la)) return b;
  if (la.gt(lb)) return a;
  return b.data > a.data ? b : a;
};

/**
 * O menor de dois pontos por (leitura, data); empate total → o primeiro. Pura.
 * @param {any} a @param {any} b
 */
const menorPonto = (a, b) => {
  if (!a) return b ?? null;
  if (!b) return a;
  const la = dec(a.leitura);
  const lb = dec(b.leitura);
  if (lb.lt(la)) return b;
  if (la.lt(lb)) return a;
  return b.data < a.data ? b : a;
};

/**
 * Maior leitura OPERACIONAL do bem, do MESMO tipo de medidor: a maior entre a
 * de abastecimento CONFIRMADO (desempate: data desc, createdAt desc, id desc)
 * e a `leitura_final` de linha de máquina confirmada (D-PROD-202). Sem
 * contador → null. `excetoId` tira um abastecimento; `excetoLinhaMaquinaId`,
 * uma linha.
 * @param {any} db cliente Prisma ou transação
 * @param {string} clienteId @param {string} bemId @param {string|null} medidorTipo
 * @param {{ excetoId?: string|null, excetoLinhaMaquinaId?: string|null }} [opcoes]
 */
export const pisoOperacional = async (db, clienteId, bemId, medidorTipo, { excetoId = null, excetoLinhaMaquinaId = null } = {}) => {
  if (!ehContador(medidorTipo)) return null;
  const [r, linha] = await Promise.all([
    db.abastecimentoBem.findFirst({
      where: ondeConfirmadosComLeitura(clienteId, bemId, medidorTipo, excetoId),
      orderBy: [{ medidor_leitura: 'desc' }, { data_operacional: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: SELECAO_PONTO,
    }),
    db.atividadeApontamentoMaquina.findFirst({
      where: ondeLinhasComLeitura(clienteId, bemId, /** @type {string} */ (medidorTipo), excetoLinhaMaquinaId),
      orderBy: MAIOR_FINAL,
      select: SELECAO_LINHA,
    }),
  ]);
  return maiorPonto(pontoDoAbastecimento(r), pontoDaLinhaMaquina(linha, 'leitura_final'));
};

/**
 * Vizinhos de `dia` entre os CONFIRMADOS com leitura (abastecimentos e, desde
 * a D-PROD-202, linhas de máquina): anterior = maior leitura com data <= dia
 * (da linha, a final); posterior = menor leitura com data > dia (da linha, a
 * inicial). `excetoLinhaMaquinaId` tira uma linha da conta.
 * @param {any} db @param {string} clienteId @param {string} bemId @param {string} medidorTipo @param {string} dia AAAA-MM-DD
 * @param {{ excetoLinhaMaquinaId?: string|null }} [opcoes]
 * @returns {Promise<{ anterior: any, posterior: any }>}
 */
export const pontosVizinhos = async (db, clienteId, bemId, medidorTipo, dia, { excetoLinhaMaquinaId = null } = {}) => {
  if (!ehContador(medidorTipo)) return { anterior: null, posterior: null };
  const base = ondeConfirmadosComLeitura(clienteId, bemId, medidorTipo, null);
  const [anterior, posterior, linhaAnterior, linhaPosterior] = await Promise.all([
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
    db.atividadeApontamentoMaquina.findFirst({
      where: ondeLinhasComLeitura(clienteId, bemId, medidorTipo, excetoLinhaMaquinaId, { lte: comoData(dia) }),
      orderBy: MAIOR_FINAL,
      select: SELECAO_LINHA,
    }),
    db.atividadeApontamentoMaquina.findFirst({
      where: ondeLinhasComLeitura(clienteId, bemId, medidorTipo, excetoLinhaMaquinaId, { gt: comoData(dia) }),
      orderBy: MENOR_INICIAL,
      select: SELECAO_LINHA,
    }),
  ]);
  return {
    anterior: maiorPonto(pontoDoAbastecimento(anterior), pontoDaLinhaMaquina(linhaAnterior, 'leitura_final')),
    posterior: menorPonto(pontoDoAbastecimento(posterior), pontoDaLinhaMaquina(linhaPosterior, 'leitura_inicial')),
  };
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
    (a.abastecimento_id ?? null) === (b.abastecimento_id ?? null) &&
    (a.linha_maquina_id ?? null) === (b.linha_maquina_id ?? null)
  );
};
