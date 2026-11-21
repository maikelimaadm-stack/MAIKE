/**
 * Regras compartilhadas do cocho (D-PROD-267): campos reservados ao servidor, a trava do
 * cocho e a ordem dos lançamentos ATIVOS. Usadas pelo cancelamento do lançamento e pelos
 * escritores endurecidos (PATCH de fechamento do evento e do lote, POST genérico, comando
 * de lançamento), que tomam a MESMA trava antes de ler ou gravar.
 *
 * Um documento de suplementação com `dados.situacao = 'cancelado'` nunca é apagado
 * (D-PROD-267: nada de exclusão física); ele sai das leituras (GET) e não aceita alteração.
 */
import { AppError } from '../../shared/errors/AppError.js';
import { travarEscopo } from '../gestao/gestaoComum.js';

export const SITUACAO_CANCELADO = 'cancelado';

/**
 * Campos que só o servidor escreve num documento de suplementação. Lista PRÓPRIA (não a de
 * `protecaoOperacional.js`, que inclui `lote_ids`/`linhas` e quebraria os payloads atuais).
 */
export const CAMPOS_RESERVADOS_SUPLEMENTACAO = Object.freeze([
  'situacao',
  'cancelado',
  'cancelamento',
  'reaberto_por_cancelamento',
  'fechado_por_tipo',
  'fechado_por_evento_id',
]);

/**
 * 400 `CAMPO_RESERVADO_CANCELAMENTO` quando o corpo traz campo reservado. Nada é gravado.
 * @param {unknown} entrada
 */
export const rejeitarReservadosDaSuplementacao = (entrada) => {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return;
  const campos = CAMPOS_RESERVADOS_SUPLEMENTACAO.filter((c) => Object.prototype.hasOwnProperty.call(entrada, c));
  if (campos.length) {
    throw new AppError('CAMPO_RESERVADO_CANCELAMENTO', 'situação, cancelamento e origem do fechamento são definidos só pelo servidor', {
      details: { campos },
    });
  }
};

/** @param {unknown} dados */
export const documentoCancelado = (dados) =>
  Boolean(dados && typeof dados === 'object' && /** @type {any} */ (dados).situacao === SITUACAO_CANCELADO);

/** @param {unknown} v */
export const textoOuNulo = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Trava do cocho (advisory, até o fim da transação). MESMA chave em todos os escritores.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} pontoId
 */
export const travarCocho = (tx, clienteId, empresaId, pontoId) => travarEscopo(tx, `supl-ponto:${clienteId}:${empresaId}:${pontoId}`);

/** Dia AAAA-MM-DD do lançamento (texto gravado; ISO com hora vira o dia). @param {unknown} v */
export const diaDoLancamento = (v) => (typeof v === 'string' ? v.slice(0, 10) : v instanceof Date ? v.toISOString().slice(0, 10) : '');

/** Instante numérico do createdAt (Date do banco ou texto). @param {any} r */
const instante = (r) => new Date(r.createdAt).getTime();

/**
 * Ordem dos lançamentos do cocho: (data_lancamento, createdAt, id), crescente.
 * @param {any} a @param {any} b
 */
export const compararLancamentos = (a, b) =>
  diaDoLancamento(a.dados?.data_lancamento).localeCompare(diaDoLancamento(b.dados?.data_lancamento))
  || instante(a) - instante(b)
  || String(a.id).localeCompare(String(b.id));

/**
 * Eventos ATIVOS (não cancelados) de um cocho da empresa, em ordem crescente. Sem trava:
 * quem grava segura a trava do cocho antes.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} pontoId
 * @returns {Promise<any[]>}
 */
export const eventosAtivosDoCocho = async (tx, clienteId, empresaId, pontoId) => {
  const linhas = /** @type {any[]} */ (await tx.$queryRaw`SELECT id, cliente_id, empresa_id, dados, "createdAt", "updatedAt"
    FROM "SuplementacaoEvento"
    WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId}
      AND dados->>'ponto_suplementacao_id' = ${pontoId}
      AND COALESCE(dados->>'situacao', '') <> ${SITUACAO_CANCELADO}`);
  return linhas.sort(compararLancamentos);
};

/**
 * O último lançamento ATIVO do cocho, ou null.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} pontoId
 */
export const ultimoEventoAtivoDoCocho = async (tx, clienteId, empresaId, pontoId) => {
  const ativos = await eventosAtivosDoCocho(tx, clienteId, empresaId, pontoId);
  return ativos.length ? ativos[ativos.length - 1] : null;
};

/**
 * Lê um documento por (cliente, id) com `FOR UPDATE` (a linha fica presa até o fim da transação).
 * @param {any} tx @param {'SuplementacaoEvento'|'SuplementacaoLote'} tabela @param {string} clienteId @param {string} id
 */
export const lerParaAtualizar = async (tx, tabela, clienteId, id) => {
  const linhas = /** @type {any[]} */ (tabela === 'SuplementacaoEvento'
    ? await tx.$queryRaw`SELECT id, cliente_id, empresa_id, dados, "createdAt", "updatedAt" FROM "SuplementacaoEvento" WHERE cliente_id = ${clienteId} AND id = ${id} FOR UPDATE`
    : await tx.$queryRaw`SELECT id, cliente_id, empresa_id, dados, "createdAt", "updatedAt" FROM "SuplementacaoLote" WHERE cliente_id = ${clienteId} AND id = ${id} FOR UPDATE`);
  return linhas[0] ?? null;
};
