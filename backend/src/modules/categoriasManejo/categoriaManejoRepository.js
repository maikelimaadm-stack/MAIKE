/**
 * Repositório de CategoriaManejo (P5.4).
 */
import { getPrismaClient } from '../../database/prismaClient.js';

/**
 * D-PROD-186/D-PROD-187 — colunas que o código LÊ de CategoriaManejo (o
 * contrato público mais o tenant). A tabela física é `CADCATEGORIA` desde a
 * D-PROD-187 (`@@map` no schema); `raca`, `categoria_oficial`,
 * `ganho_peso_anual_kg`, `gmd_janeiro`…`gmd_dezembro` e o vínculo com o ícone
 * oficial (`catalogo_categoria_visual_id`) saíram do contrato e do banco. A
 * seleção explícita garante que coluna nova não vaze para a API sem decisão.
 * D-PROD-195: entra `curva_ganho_id` e o `nome` da curva pela relação.
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
  // D-PROD-195: a curva de ganho obrigatória (mesma fazenda) e o nome dela, para a resposta.
  curva_ganho_id: true,
  peso_objetivo_kg: true,
  curvaGanho: { select: { nome: true } },
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
