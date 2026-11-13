/**
 * Repositório de CategoriaManejo (P5.4).
 */
import { getPrismaClient } from '../../database/prismaClient.js';

/**
 * D-PROD-185 — colunas que o código LÊ de CategoriaManejo. `raca`,
 * `categoria_oficial`, `ganho_peso_anual_kg` e `gmd_janeiro`…`gmd_dezembro`
 * saíram do contrato (Fatia C) e ficam dormentes no banco até o DROP da
 * Fatia D: nenhuma leitura, escrita, resposta ou auditoria as carrega.
 */
const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  nome: true,
  sigla: true,
  especie: true,
  sexo: true,
  idade_minima_meses: true,
  idade_maxima_meses: true,
  catalogo_categoria_visual_id: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
});

export const listarRegistros = async (clienteId, filtros = {}) => {
  const prisma = getPrismaClient();
  const where = { cliente_id: clienteId };
  if (filtros.empresa_id) where.empresa_id = filtros.empresa_id;
  return prisma.categoriaManejo.findMany({
    where,
    select: SELECAO,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
};

export const buscarRegistro = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.categoriaManejo.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

export const inserirRegistro = async (tx, dados) => tx.categoriaManejo.create({ data: dados, select: SELECAO });

export const atualizarRegistroPorId = async (tx, clienteId, id, dados) =>
  tx.categoriaManejo.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });

export const excluirRegistroPorId = async (tx, clienteId, id) =>
  tx.categoriaManejo.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: { id: true },
  });
