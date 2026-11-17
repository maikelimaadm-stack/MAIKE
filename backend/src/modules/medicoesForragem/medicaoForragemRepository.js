/**
 * Repositório da Medição de Forragem (D-PROD-219), tabela física "MEDICAOFORRAGEM".
 * Toda consulta filtra pelo tenant (`cliente_id`) que o serviço tirou do
 * auth_context; nenhuma função recebe tenant de outra origem.
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { opcoesTakeDeFiltros } from '../../shared/http/listQueryLimit.js';

/**
 * Medições do tenant, da mais recente para a mais antiga (dia, depois a hora do
 * registro), opcionalmente de uma fazenda e/ou de um pasto.
 * @param {string} clienteId
 * @param {{ empresa_id?: string, area_id?: string, limit?: unknown }} filtros
 */
export const listarMedicoes = (clienteId, filtros = {}) => {
  /** @type {Record<string, unknown>} */
  const where = { cliente_id: clienteId };
  if (filtros.empresa_id) where.empresa_id = filtros.empresa_id;
  if (filtros.area_id) where.area_id = filtros.area_id;
  return getPrismaClient().medicaoForragem.findMany({
    where,
    orderBy: [{ data_medicao: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    ...opcoesTakeDeFiltros(filtros),
  });
};

/** @param {any} tx @param {string} clienteId @param {string} id */
export const buscarMedicao = (tx, clienteId, id) =>
  tx.medicaoForragem.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id } } });

/**
 * O pasto do tenant (qualquer fazenda: o serviço confere a fazenda).
 * @param {any} tx @param {string} clienteId @param {string} id
 */
export const buscarArea = (tx, clienteId, id) =>
  tx.areaPastagem.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: { id: true, empresa_id: true, nome: true, tipo_cultura: true, cultura_id: true },
  });

/** A cultura da área (mesma fazenda por construção da FK). @param {any} tx @param {string} clienteId @param {string} id */
export const buscarCultura = (tx, clienteId, id) =>
  tx.cultura.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: { id: true, empresa_id: true, altura_entrada_cm: true, altura_saida_cm: true },
  });

/** @param {any} tx @param {string} clienteId @param {string} empresaId */
export const buscarFusoDaEmpresa = (tx, clienteId, empresaId) =>
  tx.empresa.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id: empresaId } }, select: { id: true, fuso_horario: true } });

/** @param {any} tx @param {string} clienteId @param {string} usuarioId */
export const buscarNomeDoUsuario = (tx, clienteId, usuarioId) =>
  tx.usuario.findFirst({ where: { cliente_id: clienteId, id: usuarioId }, select: { nome: true, login: true } });

/** @param {any} tx @param {Record<string, unknown>} dados */
export const inserirMedicao = (tx, dados) => tx.medicaoForragem.create({ data: dados });

/** @param {any} tx @param {string} clienteId @param {string} id */
export const excluirMedicaoPorId = (tx, clienteId, id) =>
  tx.medicaoForragem.delete({ where: { cliente_id_id: { cliente_id: clienteId, id } } });
