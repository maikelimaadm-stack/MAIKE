/**
 * Repositório de Produto (P5.2, D-PROD-48).
 */
import { getPrismaClient } from '../../database/prismaClient.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  numero_produto: true,
  nome_produto: true,
  tipo_uso: true,
  codigo_interno: true,
  codigo_barras: true,
  categoria: true,
  marca: true,
  descricao: true,
  unidade_medida: true,
  preco_custo: true,
  preco_venda: true,
  estoque_atual: true,
  estoque_minimo: true,
  local_estoque: true,
  tipo_consumo: true,
  percentual_consumo_pv: true,
  consumo_minimo_pv: true,
  consumo_maximo_pv: true,
  unidade_principal_estoque: true,
  peso_por_saco_kg: true,
  observacoes: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
});

export const listarProdutos = async (clienteId, filtros = {}) => {
  const prisma = getPrismaClient();
  const where = { cliente_id: clienteId };
  if (filtros.empresa_id) where.empresa_id = filtros.empresa_id;
  if (filtros.ativo !== undefined) where.ativo = filtros.ativo;
  return prisma.produto.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: SELECAO,
  });
};

export const buscarProduto = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.produto.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

export const existeProdutoComNome = async (clienteId, empresaId, nome, ignorarId, tx) => {
  const cliente = tx || getPrismaClient();
  const existente = await cliente.produto.findFirst({
    where: {
      cliente_id: clienteId,
      empresa_id: empresaId,
      nome_produto: nome,
      ...(ignorarId ? { NOT: { id: ignorarId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(existente);
};

export const inserirProduto = async (tx, dados) =>
  tx.produto.create({ data: dados, select: SELECAO });

export const atualizarProdutoPorId = async (tx, clienteId, id, dados) =>
  tx.produto.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });

export const excluirProdutoPorId = async (tx, clienteId, id) =>
  tx.produto.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
