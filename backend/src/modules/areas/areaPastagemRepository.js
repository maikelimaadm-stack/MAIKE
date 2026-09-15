/**
 * Repositório de AreaPastagem (P4.2, D-PROD-30).
 *
 * Mesmas duas regras do repositório de Setor, pelos mesmos motivos:
 *
 *  1. **nenhuma consulta sem `cliente_id`.** Não existe `findUnique({where:
 *     {id}})` aqui. Toda leitura e toda escrita usam o unique composto
 *     `[cliente_id, id]`;
 *  2. **o repositório não decide.** Não reserva número, não deriva
 *     `setor_nome`, não audita, não escolhe o que pode ser atualizado.
 *
 * `tx` é parâmetro explícito em toda escrita: a criação participa da MESMA
 * transação da reserva de número, da leitura do setor e da auditoria.
 */

import { getPrismaClient } from '../../database/prismaClient.js';

/**
 * Campos devolvidos ao cliente HTTP.
 *
 * Lista literal, nunca spread do registro: campo novo no model precisa ser
 * publicado de propósito.
 */
const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  setor_id: true,
  setor_nome: true,
  numero_area: true,
  nome: true,
  sigla: true,
  tamanho_hectares: true,
  area_pastejada: true,
  capacidade_maxima: true,
  tipo_pastagem: true,
  aproveitamento_classificacao: true,
  tipo_cultura: true,
  cor: true,
  quantidade_atual: true,
  status_ocupacao: true,
  forragem_kg_ha: true,
  taxa_crescimento_kg_ha_dia: true,
  taxa_aproveitamento: true,
  periodo_estacao: true,
  coordenadas: true,
  observacoes: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * Lista as áreas do tenant.
 *
 * Ordem por `createdAt`, como em Setor e pelo mesmo motivo: `numero_area` é
 * String (legado da Base44), então ordem alfabética colocaria "10" antes de
 * "2". A ordem de criação é a ordem em que os números foram atribuídos.
 *
 * @param {string} clienteId
 */
export const listarAreas = async (clienteId) => {
  const prisma = getPrismaClient();
  return prisma.areaPastagem.findMany({
    where: { cliente_id: clienteId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: SELECAO,
  });
};

/**
 * Busca uma área do tenant. `null` quando não existe **ou** quando pertence a
 * outro cliente — para quem pergunta, os dois casos são o mesmo.
 *
 * @param {string} clienteId
 * @param {string} id
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const buscarArea = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.areaPastagem.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

/**
 * Insere a área. `id` é omitido de propósito — quem o produz é o
 * `@default(cuid())`, nunca o runtime e nunca o cliente HTTP.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {object} dados
 */
export const inserirArea = async (tx, dados) =>
  tx.areaPastagem.create({ data: dados, select: SELECAO });

/**
 * Atualiza a área pelo unique composto.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} id
 * @param {object} dados
 */
export const atualizarAreaPorId = async (tx, clienteId, id, dados) =>
  tx.areaPastagem.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });

/**
 * Propaga o nome novo do setor para as áreas que o citam.
 *
 * É a metade nativa do que `syncEntityReferences` fazia na Base44 — e é melhor
 * que ela em três pontos que importam: roda **dentro** da transação que renomeou
 * o setor, é escopada por `cliente_id`, e não depende de uma varredura que pode
 * falhar depois sem ninguém saber.
 *
 * `updateMany` e não N `update`: o número de áreas de um setor não tem teto, e
 * uma renomeação não deve custar uma ida ao banco por área.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} setorId
 * @param {string} setorNome
 * @returns {Promise<number>} quantas áreas foram atualizadas
 */
export const propagarNomeDoSetor = async (tx, clienteId, setorId, setorNome) => {
  const { count } = await tx.areaPastagem.updateMany({
    where: { cliente_id: clienteId, setor_id: setorId },
    data: { setor_nome: setorNome },
  });
  return count;
};
