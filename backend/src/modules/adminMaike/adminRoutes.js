/**
 * Rotas do MAIKE Admin (D-PROD-70) — `/admin-maike/*`.
 *
 * Nenhuma rota aqui aceita JWT de tenant nem instala `auth_context`. O token
 * de sessão só trafega no cookie `HttpOnly`; o corpo das respostas nunca o
 * carrega (só o CSRF, que sozinho não autentica).
 */

import {
  alterarLoginAdmin,
  alterarSenhaAdmin,
  comoAdminPublico,
  confirmarInscricaoMfa,
  encerrarSessaoAdmin,
  etapaDaSessao,
  iniciarInscricaoMfa,
  listarSessoesAdmin,
  loginAdmin,
  regenerarCodigosAdmin,
  revogarOutrasSessoesAdmin,
  verificarMfaAdmin,
} from './adminService.js';
import {
  consumirTentativa,
  definirCookieAdmin,
  exigirOrigemAdmin,
  exigirSessaoAdmin,
  limparCookieAdmin,
} from './adminSessao.js';
import { csrfDaSessao } from './adminCrypto.js';
import { obterVisaoAdminCatalogo, validarCatalogoAdmin } from '../catalogoGlobal/catalogoAdminVisao.js';
import { obterManifesto } from '../catalogoGlobal/catalogoGlobalService.js';

const PREFIX = '/admin-maike';
const corpo = (properties, required = []) => ({
  body: { type: 'object', additionalProperties: false, required, properties },
});
const TEXTO = (max) => ({ type: 'string', minLength: 1, maxLength: max });
const CODIGO_MFA = { type: 'string', minLength: 6, maxLength: 12 };

/** Limites por IP (por processo); o bloqueio por conta é persistido no banco. */
const LIMITE_LOGIN = { limite: 10, janelaMs: 15 * 60_000 };
const LIMITE_MFA = { limite: 20, janelaMs: 15 * 60_000 };
const LIMITE_CONTA = { limite: 10, janelaMs: 15 * 60_000 };

const ctx = (request) => ({
  ip: request.ip,
  userAgent: request.headers['user-agent'],
  requestId: request.contexto.requestId,
  admin: request.contexto.adminPrincipal,
  sessao: request.contexto.sessaoAdmin,
});

const respostaSessao = (reply, { token, sessao, csrf }, admin, extra = {}) => {
  definirCookieAdmin(reply, token, sessao.expira_em);
  return {
    etapa: etapaDaSessao(sessao, admin),
    admin: comoAdminPublico(admin),
    csrf_token: csrf,
    expira_em: sessao.expira_em.toISOString(),
    ...extra,
  };
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarAdminMaikeRoutes = async (app) => {
  const preMfa = [exigirSessaoAdmin({ permitirSemMfa: true })];
  const verificada = [exigirSessaoAdmin()];

  app.post(
    `${PREFIX}/auth/login`,
    { schema: corpo({ login: TEXTO(120), senha: TEXTO(256) }, ['login', 'senha']) },
    async (request, reply) => {
      exigirOrigemAdmin(request);
      consumirTentativa(`login:${request.ip}`, LIMITE_LOGIN);
      const body = /** @type {{login: string, senha: string}} */ (request.body);
      const r = await loginAdmin({ ...ctx(request), login: body.login, senha: body.senha });
      return respostaSessao(reply, r, r.admin);
    }
  );

  app.post(
    `${PREFIX}/auth/mfa`,
    {
      onRequest: preMfa,
      schema: corpo({ codigo: CODIGO_MFA, codigo_recuperacao: { type: 'string', minLength: 10, maxLength: 16 } }),
    },
    async (request, reply) => {
      consumirTentativa(`mfa:${request.ip}`, LIMITE_MFA);
      const body = /** @type {{codigo?: string, codigo_recuperacao?: string}} */ (request.body ?? {});
      const c = ctx(request);
      const r = await verificarMfaAdmin({ ...c, codigo: body.codigo, codigoRecuperacao: body.codigo_recuperacao });
      return respostaSessao(reply, r, { ...c.admin }, 'restantes' in r ? { codigos_restantes: r.restantes } : {});
    }
  );

  app.post(`${PREFIX}/mfa/inscricao`, { onRequest: preMfa, schema: corpo({}) }, async (request) => {
    consumirTentativa(`mfa:${request.ip}`, LIMITE_MFA);
    return iniciarInscricaoMfa(ctx(request));
  });

  app.post(
    `${PREFIX}/mfa/confirmar`,
    { onRequest: preMfa, schema: corpo({ codigo: CODIGO_MFA }, ['codigo']) },
    async (request, reply) => {
      consumirTentativa(`mfa:${request.ip}`, LIMITE_MFA);
      const c = ctx(request);
      const r = await confirmarInscricaoMfa({ ...c, codigo: /** @type {any} */ (request.body).codigo });
      return respostaSessao(reply, r, { ...c.admin, mfa_ativo: true }, { codigos_recuperacao: r.codigos_recuperacao });
    }
  );

  app.get(`${PREFIX}/sessao`, { onRequest: preMfa }, async (request) => {
    const { admin, sessao } = ctx(request);
    return {
      etapa: etapaDaSessao(sessao, admin),
      admin: comoAdminPublico(admin),
      csrf_token: csrfDaSessao(sessao.id),
      expira_em: sessao.expira_em.toISOString(),
    };
  });

  app.post(`${PREFIX}/auth/logout`, { onRequest: preMfa, schema: corpo({}) }, async (request, reply) => {
    await encerrarSessaoAdmin(ctx(request));
    limparCookieAdmin(reply);
    return reply.status(204).send();
  });

  // ─── Conta e segurança ───────────────────────────────────────────────────

  const reauth = { senha_atual: TEXTO(256), codigo_mfa: CODIGO_MFA };

  app.post(
    `${PREFIX}/conta/senha`,
    { onRequest: verificada, schema: corpo({ ...reauth, nova_senha: TEXTO(256) }, ['senha_atual', 'codigo_mfa', 'nova_senha']) },
    async (request, reply) => {
      consumirTentativa(`conta:${request.ip}`, LIMITE_CONTA);
      const b = /** @type {any} */ (request.body);
      await alterarSenhaAdmin({ ...ctx(request), senhaAtual: b.senha_atual, codigoMfa: b.codigo_mfa, novaSenha: b.nova_senha });
      limparCookieAdmin(reply);
      return { sessoes_revogadas: true };
    }
  );

  app.post(
    `${PREFIX}/conta/login`,
    { onRequest: verificada, schema: corpo({ ...reauth, novo_login: TEXTO(120) }, ['senha_atual', 'codigo_mfa', 'novo_login']) },
    async (request, reply) => {
      consumirTentativa(`conta:${request.ip}`, LIMITE_CONTA);
      const b = /** @type {any} */ (request.body);
      await alterarLoginAdmin({ ...ctx(request), senhaAtual: b.senha_atual, codigoMfa: b.codigo_mfa, novoLogin: b.novo_login });
      limparCookieAdmin(reply);
      return { sessoes_revogadas: true };
    }
  );

  app.post(
    `${PREFIX}/conta/codigos-recuperacao`,
    { onRequest: verificada, schema: corpo(reauth, ['senha_atual', 'codigo_mfa']) },
    async (request) => {
      consumirTentativa(`conta:${request.ip}`, LIMITE_CONTA);
      const b = /** @type {any} */ (request.body);
      return { codigos_recuperacao: await regenerarCodigosAdmin({ ...ctx(request), senhaAtual: b.senha_atual, codigoMfa: b.codigo_mfa }) };
    }
  );

  app.get(`${PREFIX}/conta/sessoes`, { onRequest: verificada }, async (request) => listarSessoesAdmin(ctx(request)));

  app.post(`${PREFIX}/conta/sessoes/revogar-outras`, { onRequest: verificada, schema: corpo({}) }, async (request) => ({
    revogadas: await revogarOutrasSessoesAdmin(ctx(request)),
  }));

  // ─── Catálogo (leitura administrativa completa) ──────────────────────────

  app.get(`${PREFIX}/catalogo`, { onRequest: verificada }, async () => obterVisaoAdminCatalogo());
  // Revisão atual (CAS entre passos de um fluxo com várias escritas).
  app.get(`${PREFIX}/catalogo/revisao`, { onRequest: verificada }, async () => obterManifesto());
  app.get(`${PREFIX}/catalogo/validacao`, { onRequest: verificada }, async () => validarCatalogoAdmin());
};
