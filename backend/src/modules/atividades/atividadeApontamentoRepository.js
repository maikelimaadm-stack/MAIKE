/**
 * D-PROD-200 (Fatia 2 do Lançamento de Atividades) — repositório do
 * APONTAMENTO do dia/turno (`AtividadeApontamento`), filho da atividade
 * (contrato `docs/engineering/MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md`).
 *
 * Adaptador de dados, sem regra: o `cliente_id` vem SEMPRE de quem chama (que
 * o tirou do auth_context), nunca do corpo, da query, dos params, do cabeçalho
 * nem do cookie (R11). Toda leitura do apontamento vai pelo escopo
 * (cliente_id, empresa_id, atividade_id, id): apontamento de outra atividade,
 * de outra fazenda ou de outro tenant dá o mesmo `null` (sem oráculo).
 *
 * A trava da linha da atividade (`travarAtividade`), os totais e a forma da
 * atividade ficam em `atividadeComum.js`, compartilhados com o cabeçalho.
 */

import { INCLUIR_LINHA_PRODUTO, STATUS_APONTAMENTO, USUARIO_RESUMO, comoData } from './atividadeComum.js';
import { INCLUIR_LINHA_MAQUINA } from './atividadeApontamentoMaquinaRepository.js';

/**
 * `include` do apontamento: o resumo ao lado de cada id de usuário da forma
 * pública e, D-PROD-201 (Fatia 3), as linhas de PRODUTO e de MÁQUINA
 * (inclusive as canceladas), em ordem de lançamento.
 */
export const INCLUIR_APONTAMENTO = Object.freeze({
  operador: USUARIO_RESUMO,
  criadoPor: USUARIO_RESUMO,
  canceladoPor: USUARIO_RESUMO,
  produtos: { include: INCLUIR_LINHA_PRODUTO, orderBy: [{ ordem: /** @type {const} */ ('asc') }] },
  maquinas: { include: INCLUIR_LINHA_MAQUINA, orderBy: [{ ordem: /** @type {const} */ ('asc') }] },
});

/**
 * O essencial da atividade para as regras do apontamento: status e período
 * previsto (o alerta `FORA_DO_INTERVALO`). Leia DEPOIS de `travarAtividade`
 * nas escritas. Outra empresa e outro tenant = `null`.
 * @param {any} db  cliente Prisma ou transação
 * @param {string} clienteId @param {string} empresaId @param {string} id
 * @returns {Promise<{ id: string, empresa_id: string, numero: string, status: string, tipo_atividade_id: string, bem_id: string|null,
 *   data_inicio: Date|null, data_prevista_fim: Date|null } | null>}
 */
export const lerAtividadeBase = (db, clienteId, empresaId, id) =>
  db.atividade.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, id },
    // D-PROD-201: número (documento do movimento de estoque), tipo (as flags das linhas), máquina e fazenda.
    select: { id: true, empresa_id: true, numero: true, status: true, tipo_atividade_id: true, bem_id: true, data_inicio: true, data_prevista_fim: true },
  });

/**
 * A fazenda da atividade do tenant (o PATCH do apontamento sem `empresa_id`
 * no corpo). Outro tenant = `null`.
 * @param {any} db @param {string} clienteId @param {string} id
 * @returns {Promise<{ empresa_id: string } | null>}
 */
export const lerEmpresaDaAtividade = (db, clienteId, id) =>
  db.atividade.findFirst({ where: { cliente_id: clienteId, id }, select: { empresa_id: true } });

/**
 * Apontamento DESTA atividade e desta empresa, com os resumos.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} atividadeId @param {string} id
 */
export const buscarApontamento = (db, clienteId, empresaId, atividadeId, id) =>
  db.atividadeApontamento.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, id },
    include: INCLUIR_APONTAMENTO,
  });

/**
 * Todos os apontamentos da atividade (confirmados e cancelados), com os
 * resumos, pelo índice (cliente_id, empresa_id, atividade_id). A ordem da
 * lista (dia desc, turno manhã → tarde → noite → sem turno, sequência) é
 * aplicada pelo serviço: o `orderBy` do Prisma não ordena por uma lista
 * fechada; aqui só fica uma ordem determinística de partida.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 */
export const listarApontamentosDaAtividade = (db, clienteId, empresaId, atividadeId) =>
  db.atividadeApontamento.findMany({
    where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId },
    include: INCLUIR_APONTAMENTO,
    orderBy: [{ data_operacional: 'desc' }, { sequencia: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });

/**
 * Próxima `sequencia` (máx + 1) de (atividade, dia, turno), contando os
 * CONFIRMADO e os CANCELADO: o unique `(cliente_id, atividade_id,
 * data_operacional, turno, sequencia)` vale para os dois, então a sequência
 * de um cancelado nunca é reaproveitada. Turno nulo é um grupo como os outros
 * (`turno IS NULL`; no banco, o unique é NULLS NOT DISTINCT). Chame SOB
 * `travarAtividade`: a trava serializa os lançamentos da atividade.
 * @param {any} tx
 * @param {{ clienteId: string, empresaId: string, atividadeId: string, dia: string, turno: string|null }} grupo
 * @returns {Promise<number>}
 */
export const proximaSequencia = async (tx, { clienteId, empresaId, atividadeId, dia, turno }) => {
  const r = await tx.atividadeApontamento.aggregate({
    where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, data_operacional: comoData(dia), turno: turno ?? null },
    _max: { sequencia: true },
  });
  return (r._max.sequencia ?? 0) + 1;
};

/** @param {any} tx @param {Record<string, unknown>} dados @returns {Promise<{ id: string }>} */
export const inserirApontamento = (tx, dados) => tx.atividadeApontamento.create({ data: dados, select: { id: true } });

/**
 * Usuário do tenant (o operador): só a situação. Outro tenant = `null`.
 * @param {any} tx @param {string} clienteId @param {string} id
 * @returns {Promise<{ ativo: boolean } | null>}
 */
export const lerUsuario = (tx, clienteId, id) => tx.usuario.findFirst({ where: { cliente_id: clienteId, id }, select: { ativo: true } });

/**
 * CONFIRMADO → CANCELADO de TODOS os apontamentos confirmados da atividade,
 * numa instrução, com o mesmo instante, usuário e motivo, e a `versao` de
 * cada um incrementada. Devolve a contagem.
 * @param {any} tx
 * @param {{ clienteId: string, empresaId: string, atividadeId: string, usuarioId: string|null, motivo: string, agora: Date }} pedido
 * @returns {Promise<number>}
 */
export const cancelarConfirmadosDaAtividade = async (tx, { clienteId, empresaId, atividadeId, usuarioId, motivo, agora }) => {
  const r = await tx.atividadeApontamento.updateMany({
    where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, status: STATUS_APONTAMENTO.CONFIRMADO },
    data: {
      status: STATUS_APONTAMENTO.CANCELADO,
      cancelado_em: agora,
      cancelado_por_usuario_id: usuarioId,
      motivo_cancelamento: motivo,
      versao: { increment: 1 },
    },
  });
  return r.count;
};

/**
 * D-PROD-201: ids dos apontamentos CONFIRMADO da atividade (os que o
 * cancelamento da atividade vai cancelar: as linhas deles são estornadas antes).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 * @returns {Promise<string[]>}
 */
export const idsConfirmadosDaAtividade = async (tx, clienteId, empresaId, atividadeId) =>
  (await tx.atividadeApontamento.findMany({
    where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, status: STATUS_APONTAMENTO.CONFIRMADO },
    select: { id: true },
    orderBy: { id: 'asc' },
  })).map((/** @type {{ id: string }} */ r) => r.id);
