/**
 * Autoridade de ADMINISTRADOR DA FAZENDA (tenant) — PR145-R4, D-PROD-71.
 *
 * Lida do registro REAL e ATIVO em `Usuario.papel_tenant`, no banco, a cada
 * ação privilegiada — nunca do JWT (emitido antes de uma revogação), do body,
 * de cabeçalho ou de `Permissao.is_admin` (linha editável, preferência de
 * menu). Nenhuma rota HTTP grava `papel_tenant`: a atribuição é operacional
 * (`scripts/auth/papel-tenant.mjs`).
 *
 * Não tem relação com o proprietário do produto (`AdminPrincipalMaike`), que
 * não acessa dados de tenant.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { AppError } from '../errors/AppError.js';
import { exigirAuthContext } from './authContext.js';

export const PAPEL_ADMIN_TENANT = 'administrador';

export const tenantAdminRequired = () =>
  new AppError('TENANT_ADMIN_REQUIRED', 'ação restrita ao administrador da fazenda');

/** @param {{ ativo: boolean, papel_tenant: string } | null | undefined} usuario */
export const ehAdminTenantAtivo = (usuario) => Boolean(usuario?.ativo && usuario.papel_tenant === PAPEL_ADMIN_TENANT);

/**
 * O ator da requisição, relido do banco (ativo + papel atuais).
 * @param {{auth: import('./authContext.js').AuthContext}} contexto
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const atorDoTenant = async (contexto, tx) => {
  const auth = exigirAuthContext(contexto?.auth);
  return (tx ?? getPrismaClient()).usuario.findUnique({
    where: { cliente_id_id: { cliente_id: auth.clienteId, id: auth.usuarioId } },
    select: { id: true, ativo: true, papel_tenant: true, login: true, senha_hash: true },
  });
};

/**
 * Exige administrador ATIVO do próprio tenant. Use dentro da transação da
 * mutação, para a revogação concorrente valer.
 * @param {{auth: import('./authContext.js').AuthContext}} contexto
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const exigirAdminTenant = async (contexto, tx) => {
  const ator = await atorDoTenant(contexto, tx);
  if (!ehAdminTenantAtivo(ator)) throw tenantAdminRequired();
  return ator;
};
