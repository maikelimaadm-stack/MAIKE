/**
 * Repositório da Leitura de cocho (D-PROD-205), tabela física "LEITURACOCHO".
 * Toda consulta filtra pelo tenant (`cliente_id`) que o serviço tirou do
 * auth_context; nenhuma função recebe tenant de outra origem.
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { opcoesTakeDeFiltros } from '../../shared/http/listQueryLimit.js';

/**
 * Leituras do tenant, da mais recente para a mais antiga (dia da leitura, depois
 * a hora do registro), opcionalmente de uma fazenda e/ou de um cocho.
 * @param {string} clienteId
 * @param {{ empresa_id?: string, ponto_suplementacao_id?: string, limit?: unknown }} filtros
 */
export const listarLeituras = (clienteId, filtros = {}) => {
  const where = { cliente_id: clienteId };
  if (filtros.empresa_id) where.empresa_id = filtros.empresa_id;
  if (filtros.ponto_suplementacao_id) where.ponto_suplementacao_id = filtros.ponto_suplementacao_id;
  return getPrismaClient().leituraCocho.findMany({
    where,
    orderBy: [{ data_leitura: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    ...opcoesTakeDeFiltros(filtros),
  });
};

/**
 * @param {any} tx
 * @param {string} clienteId
 * @param {string} id
 */
export const buscarLeitura = (tx, clienteId, id) =>
  tx.leituraCocho.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id } } });

/**
 * O ponto de suplementação do tenant (qualquer fazenda: o serviço confere a fazenda).
 * @param {any} tx
 * @param {string} clienteId
 * @param {string} id
 */
export const buscarPonto = (tx, clienteId, id) =>
  tx.pontoSuplementacao.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: { id: true, empresa_id: true, categoria_ponto: true, nome_ponto: true },
  });

/**
 * Fuso configurado da fazenda (pode ser nulo: o serviço decide a reserva).
 * @param {any} tx
 * @param {string} clienteId
 * @param {string} empresaId
 */
export const buscarFusoDaEmpresa = (tx, clienteId, empresaId) =>
  tx.empresa.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id: empresaId } }, select: { id: true, fuso_horario: true } });

/**
 * Nome de quem está registrando (a conta do auth_context, no mesmo tenant).
 * @param {any} tx
 * @param {string} clienteId
 * @param {string} usuarioId
 */
export const buscarNomeDoUsuario = (tx, clienteId, usuarioId) =>
  tx.usuario.findFirst({ where: { cliente_id: clienteId, id: usuarioId }, select: { nome: true, login: true } });

/** @param {any} tx @param {Record<string, unknown>} dados */
export const inserirLeitura = (tx, dados) => tx.leituraCocho.create({ data: dados });

/** @param {any} tx @param {string} clienteId @param {string} id */
export const excluirLeituraPorId = (tx, clienteId, id) =>
  tx.leituraCocho.delete({ where: { cliente_id_id: { cliente_id: clienteId, id } } });
