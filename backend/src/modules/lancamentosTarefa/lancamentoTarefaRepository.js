/**
 * Repositório de LancamentoTarefa (P5.3, D-PROD-49).
 */

import { getPrismaClient } from '../../database/prismaClient.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  titulo: true,
  descricao: true,
  tipo: true,
  tipo_tarefa_id: true,
  tipo_tarefa_nome: true,
  grupo_atividade_id: true,
  grupo_atividade_nome: true,
  solicitante: true,
  data_pedido: true,
  setor_nome: true,
  prioridade: true,
  status: true,
  data_prevista: true,
  data_inicio: true,
  data_conclusao: true,
  area_id: true,
  area_nome: true,
  lote_id: true,
  lote_nome: true,
  ponto_suplementacao_id: true,
  coordenadas: true,
  responsavel_id: true,
  responsavel: true,
  responsavel_geral: true,
  observacoes: true,
  observacoes_conclusao: true,
  fotos: true,
  anexos_urls: true,
  createdAt: true,
  updatedAt: true,
});

/** @param {string} clienteId */
export const listarLancamentos = async (clienteId) => {
  const prisma = getPrismaClient();
  return prisma.lancamentoTarefa.findMany({
    where: { cliente_id: clienteId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {string} id
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const buscarLancamento = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.lancamentoTarefa.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {object} dados */
export const inserirLancamento = async (tx, dados) =>
  tx.lancamentoTarefa.create({ data: dados, select: SELECAO });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const atualizarLancamentoPorId = async (tx, clienteId, id, dados) =>
  tx.lancamentoTarefa.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const excluirLancamentoPorId = async (tx, clienteId, id) =>
  tx.lancamentoTarefa.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const propagarNomeTipoTarefa = async (tx, clienteId, tipoId, nomeTipo) =>
  tx.lancamentoTarefa.updateMany({
    where: { cliente_id: clienteId, tipo_tarefa_id: tipoId },
    data: { tipo_tarefa_nome: nomeTipo },
  });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const propagarNomeGrupoAtividade = async (tx, clienteId, grupoId, nomeGrupo) =>
  tx.lancamentoTarefa.updateMany({
    where: { cliente_id: clienteId, grupo_atividade_id: grupoId },
    data: { grupo_atividade_nome: nomeGrupo },
  });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const propagarSetorNome = async (tx, clienteId, nomeAntigo, nomeNovo) =>
  tx.lancamentoTarefa.updateMany({
    where: { cliente_id: clienteId, setor_nome: nomeAntigo },
    data: { setor_nome: nomeNovo },
  });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const contarPorTipoTarefa = async (tx, clienteId, tipoId) =>
  tx.lancamentoTarefa.count({ where: { cliente_id: clienteId, tipo_tarefa_id: tipoId } });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const contarPorGrupoAtividade = async (tx, clienteId, grupoId) =>
  tx.lancamentoTarefa.count({ where: { cliente_id: clienteId, grupo_atividade_id: grupoId } });
