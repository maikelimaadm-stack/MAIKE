/**
 * Repositório de PontoSuplementacao (P5.4).
 */
import { getPrismaClient } from '../../database/prismaClient.js';

export const listarRegistros = async (clienteId, filtros = {}) => {
  const prisma = getPrismaClient();
  const where = { cliente_id: clienteId };
  if (filtros.empresa_id) where.empresa_id = filtros.empresa_id;
  return prisma.pontoSuplementacao.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
};

export const buscarRegistro = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.pontoSuplementacao.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });
};

export const inserirRegistro = async (tx, dados) => tx.pontoSuplementacao.create({ data: dados });

export const atualizarRegistroPorId = async (tx, clienteId, id, dados) =>
  tx.pontoSuplementacao.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
  });

export const excluirRegistroPorId = async (tx, clienteId, id) =>
  tx.pontoSuplementacao.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });

/** Já existe ponto com este número no tenant? (unique `cliente_id + numero_ponto`) */
export const numeroEmUso = async (tx, clienteId, numeroPonto) =>
  Boolean(
    await tx.pontoSuplementacao.findUnique({
      where: { cliente_id_numero_ponto: { cliente_id: clienteId, numero_ponto: numeroPonto } },
      select: { id: true },
    })
  );

/**
 * Histórico que impede apagar o cocho/depósito (a leitura de cocho cairia em
 * cascata pela FK; lançamentos, movimentações e saldo ficariam órfãos).
 * Devolve os motivos encontrados, na ordem fixa abaixo; vazio = sem histórico.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {{ id: string, local_estoque_id?: string|null, categoria_ponto?: string|null }} ponto
 * @returns {Promise<string[]>}
 */
export const motivosHistoricoPonto = async (tx, clienteId, ponto) => {
  const id = ponto.id;
  const ehDeposito = String(ponto.categoria_ponto ?? '').toUpperCase() === 'DEPOSITO';
  const local = ehDeposito && ponto.local_estoque_id ? ponto.local_estoque_id : null;
  const existe = async (consulta) => Boolean(await consulta);
  const sel = { select: { id: true } };

  /** @type {Array<[string, () => Promise<unknown>]>} */
  const verificacoes = [
    ['leituras_cocho', () => tx.leituraCocho.findFirst({ where: { cliente_id: clienteId, ponto_suplementacao_id: id }, ...sel })],
    [
      'lancamentos_suplementacao',
      () =>
        tx.suplementacaoEvento.findFirst({
          where: {
            cliente_id: clienteId,
            OR: [
              { dados: { path: ['ponto_suplementacao_id'], equals: id } },
              { dados: { path: ['deposito_id'], equals: id } },
            ],
          },
          ...sel,
        }),
    ],
    [
      'movimentacoes_estoque',
      () =>
        tx.movimentacaoEstoque.findFirst({
          where: {
            cliente_id: clienteId,
            OR: [
              { ponto_suplementacao_id: id },
              { deposito_id: id },
              ...(local ? [{ local_estoque_origem: local }, { local_estoque_destino: local }] : []),
            ],
          },
          ...sel,
        }),
    ],
    ['lancamentos_tarefa', () => tx.lancamentoTarefa.findFirst({ where: { cliente_id: clienteId, ponto_suplementacao_id: id }, ...sel })],
  ];
  if (local) {
    verificacoes.push(
      ['saldo_estoque', () => tx.estoqueLoteNota.findFirst({ where: { cliente_id: clienteId, local_estoque_id: local }, ...sel })],
      ['lancamentos_financeiros', () => tx.operacaoFinanceiraItem.findFirst({ where: { cliente_id: clienteId, local_estoque_id: local }, ...sel })],
      // FK RESTRICT no local: abastecimento de bem e produto de atividade também são histórico.
      ['abastecimentos', () => tx.abastecimentoBem.findFirst({ where: { cliente_id: clienteId, local_estoque_id: local }, ...sel })],
      ['atividades', () => tx.atividadeApontamentoProduto.findFirst({ where: { cliente_id: clienteId, local_estoque_id: local }, ...sel })]
    );
  }

  /** @type {string[]} */
  const motivos = [];
  for (const [motivo, consultar] of verificacoes) {
    if (await existe(consultar())) motivos.push(motivo);
  }
  return motivos;
};

/** Cochos que apontam para o depósito `depositoId`. */
export const listarCochosDoDeposito = async (tx, clienteId, depositoId) =>
  tx.pontoSuplementacao.findMany({ where: { cliente_id: clienteId, deposito_origem_id: depositoId } });

/** Outro ponto (além de `id`) ainda usa o local? */
export const outroPontoUsaLocal = async (tx, clienteId, localId, id) =>
  Boolean(
    await tx.pontoSuplementacao.findFirst({
      where: { cliente_id: clienteId, local_estoque_id: localId, id: { not: id } },
      select: { id: true },
    })
  );
