/**
 * Repositório de Lote (P5.1, D-PROD-47).
 */

import { getPrismaClient } from '../../database/prismaClient.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  numero_lote: true,
  nome: true,
  identificador_nome: true,
  identificador_sigla: true,
  identificador_cor: true,
  quantidade_cabecas: true,
  quantidade_entrada: true,
  categoria: true,
  categoria_entrada: true,
  categoria_manejo_id: true,
  categoria_manejo_nome: true,
  categoria_manejo_entrada_id: true,
  categoria_manejo_entrada_nome: true,
  sexo: true,
  peso_medio_kg: true,
  peso_entrada_kg: true,
  idade_media_meses: true,
  setor_id: true,
  setor_nome: true,
  area_entrada_id: true,
  area_entrada_nome: true,
  area_atual_id: true,
  area_atual_nome: true,
  raca_predominante: true,
  sistema_produtivo: true,
  data_entrada: true,
  motivo_entrada: true,
  origem: true,
  fornecedor_id: true,
  fornecedor_nome: true,
  nota_fiscal: true,
  chave_nfe: true,
  numero_gta: true,
  cidade_origem: true,
  estado_origem: true,
  valor_total_compra: true,
  valor_por_cabeca: true,
  valor_frete: true,
  motivo_ajuste: true,
  motivo_outros: true,
  observacoes: true,
  status: true,
  campos_personalizados: true,
  createdAt: true,
  updatedAt: true,
});

/** @param {string} clienteId */
export const listarLotes = async (clienteId) => {
  const prisma = getPrismaClient();
  return prisma.lote.findMany({
    where: { cliente_id: clienteId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {string} id
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const buscarLote = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.lote.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {object} dados */
export const inserirLote = async (tx, dados) => tx.lote.create({ data: dados, select: SELECAO });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const atualizarLotePorId = async (tx, clienteId, id, dados) =>
  tx.lote.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const excluirLotePorId = async (tx, clienteId, id) =>
  tx.lote.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
