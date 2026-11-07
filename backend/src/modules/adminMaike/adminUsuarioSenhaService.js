/**
 * Reemissão segura de senha temporária pelo MAIKE Admin (MAIKE-SAAS-ADMIN-S04-P3
 * PR01, D-PROD-145).
 *
 * O proprietário (sessão verificada com MFA) gera uma NOVA senha temporária para
 * UMA conta ativa de um cliente ativo — por exemplo o primeiro administrador
 * que perdeu a senha inicial. Sem migration: reaproveita `senha_hash`,
 * `troca_senha_pendente` (S04-P2), `sessao_epoca` (S04-P1) e
 * `EventoSegurancaAdminMaike`.
 *
 * Contrato:
 *  - reautenticação de alto risco (senha atual + TOTP novo) ANTES de tocar na
 *    conta (`reautenticarAdmin`, o mesmo das trocas do próprio proprietário);
 *  - a conta é localizada por `id` E `cliente_id` (associação provada na
 *    consulta); conta de outro cliente = "não encontrada", sem oráculo;
 *  - revisão otimista DA CONTA (`revisaoUsuario`, servida na listagem da ficha)
 *    em `If-Match`; diferente da atual = 409, nada gravado;
 *  - a senha é gerada no servidor (CSPRNG do S03) e o hash é o bcrypt do
 *    `authService` (SSOT); o operador nunca escolhe a senha;
 *  - UMA transação: CAS na linha lida (senha nova + `troca_senha_pendente =
 *    true`), época da conta +1 (todas as sessões e o token restrito caem) e o
 *    evento de auditoria. Falha em qualquer passo desfaz tudo;
 *  - a senha volta UMA vez, na resposta (no-store pela rota); nunca em leitura,
 *    auditoria ou log.
 */

import { createHash } from 'node:crypto';

import { getPrismaClient } from '../../database/prismaClient.js';
import { adminError } from '../../shared/errors/AppError.js';
import { epocaDe, filtroEpoca, revogarSessoesUsuario } from '../../shared/auth/sessaoEpoca.js';
import { gerarSenhaHash } from '../auth/authService.js';
import { reautenticarAdmin, registrarEventoSeguranca } from './adminService.js';
import { gerarSenhaTemporaria } from './adminClientesGestaoService.js';

export const ACAO_REEMITIR = 'usuario_senha_reemitir';

/** `"u1-<sha256 base64url>"`: revisão opaca da conta (não carrega hash, senha nem dado de terceiro). */
export const PADRAO_REVISAO_USUARIO = /^"u1-[A-Za-z0-9_-]{43}"$/;

const iso = (d) => (d instanceof Date ? d.toISOString() : null);

/**
 * Revisão da CONTA lida pelo operador. Muda quando muda qualquer coisa que
 * importa para a reemissão: atualização da linha (senha, nome, ativo, papel,
 * pendência — todas passam pelo `updatedAt`), situação, papel, pendência e a
 * época de sessão (incrementada por SQL cru, que não toca `updatedAt`).
 *
 * @param {{ id: string, cliente_id: string, updatedAt: Date, ativo: boolean, papel_tenant: string, troca_senha_pendente: boolean | null, sessao_epoca: number | null }} u
 */
export const revisaoUsuario = (u) =>
  `"u1-${createHash('sha256')
    .update(
      JSON.stringify([
        u.id,
        u.cliente_id,
        iso(u.updatedAt),
        u.ativo === true,
        u.papel_tenant,
        u.troca_senha_pendente === true,
        epocaDe(u.sessao_epoca),
      ])
    )
    .digest('base64url')}"`;

export const SELECT_REVISAO_USUARIO = Object.freeze({
  id: true,
  cliente_id: true,
  updatedAt: true,
  ativo: true,
  papel_tenant: true,
  troca_senha_pendente: true,
  sessao_epoca: true,
});

const naoEncontrado = () => adminError('ADMIN_ENTRADA_INVALIDA', 'usuário não encontrado neste cliente');
const concorrente = () =>
  adminError('ADMIN_USUARIO_EDICAO_CONCORRENTE', 'a conta foi alterada depois que a ficha foi lida; nada foi gravado');

/**
 * `POST /admin-maike/clientes/:id/usuarios/:usuarioId/reemitir-senha`.
 *
 * @param {string} clienteId
 * @param {string} usuarioId
 * @param {{ justificativa: string, senha_admin_atual: string, codigo_mfa: string }} entrada
 * @param {{ admin: { id: string }, ip?: string, requestId: string, revisao: string }} ctx  `revisao` = If-Match já validado na rota
 */
export const reemitirSenhaUsuario = async (clienteId, usuarioId, entrada, ctx) => {
  const justificativa = typeof entrada.justificativa === 'string' ? entrada.justificativa.trim().replace(/\s+/g, ' ') : '';
  if (justificativa.length < 10) {
    throw adminError('ADMIN_ENTRADA_INVALIDA', 'justificativa: informe pelo menos 10 caracteres');
  }

  // Nada acontece com a conta sem a reautenticação (senha atual + TOTP novo).
  await reautenticarAdmin({
    admin: ctx.admin,
    senhaAtual: entrada.senha_admin_atual,
    codigoMfa: entrada.codigo_mfa,
    ip: ctx.ip,
    requestId: ctx.requestId,
    acao: ACAO_REEMITIR,
  });

  const db = getPrismaClient();
  const atual = await db.usuario.findFirst({
    where: { id: usuarioId, cliente_id: clienteId },
    select: { ...SELECT_REVISAO_USUARIO, nome: true, login: true, senha_hash: true, cliente: { select: { ativo: true } } },
  });
  if (!atual) throw naoEncontrado();
  if (!atual.cliente.ativo) throw adminError('ADMIN_ENTRADA_INVALIDA', 'cliente suspenso: reative o cliente antes de reemitir a senha');
  if (!atual.ativo) throw adminError('ADMIN_ENTRADA_INVALIDA', 'usuário inativo: a senha só é reemitida para conta ativa');
  if (revisaoUsuario(atual) !== ctx.revisao) throw concorrente();

  const senha = gerarSenhaTemporaria();
  const senhaHash = await gerarSenhaHash(senha);
  const epocaAntes = epocaDe(atual.sessao_epoca);

  await db
    .$transaction(async (tx) => {
      // CAS: só grava se a linha ainda é a lida (mesma atualização, mesmo hash,
      // mesma época, conta e cliente ativos). Em READ COMMITTED o Postgres
      // espera o lock da linha e reavalia o WHERE: quem perde recebe count 0.
      const r = await tx.usuario.updateMany({
        where: {
          id: usuarioId,
          cliente_id: clienteId,
          ativo: true,
          updatedAt: atual.updatedAt,
          senha_hash: atual.senha_hash,
          ...filtroEpoca(epocaAntes),
          cliente: { ativo: true },
        },
        data: { senha_hash: senhaHash, troca_senha_pendente: true },
      });
      if (r.count !== 1) throw concorrente();
      // S04-P1: todas as sessões da conta (e um token restrito do S04-P2) caem.
      const depois = await revogarSessoesUsuario(tx, clienteId, usuarioId);
      await registrarEventoSeguranca(
        {
          adminId: ctx.admin.id,
          acao: ACAO_REEMITIR,
          sucesso: true,
          ip: ctx.ip,
          requestId: ctx.requestId,
          dados: {
            cliente_id: clienteId,
            usuario: { id: usuarioId, login: atual.login },
            justificativa,
            troca_senha_obrigatoria: true,
            sessoes_revogadas: true,
            sessao_epoca: { antes: epocaAntes, depois },
          },
        },
        tx
      );
      return depois;
    })
    .catch((erro) => {
      // P2034: conflito de escrita/deadlock apontado pelo banco = corrida perdida.
      if (erro?.code === 'P2034') throw concorrente();
      throw erro;
    });

  return {
    senha_temporaria: senha,
    usuario: { id: atual.id, nome: atual.nome, login: atual.login },
    troca_senha_obrigatoria: true,
    sessoes_revogadas: true,
  };
};
