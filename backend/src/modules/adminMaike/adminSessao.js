/**
 * Sessão do MAIKE Admin (D-PROD-70): cookie opaco, guarda de rota, Origin/CSRF
 * e limitador de tentativas.
 *
 * - O cookie carrega só o token aleatório; o banco guarda o sha256.
 * - `HttpOnly` + `SameSite=Strict` sempre; `Secure` e prefixo `__Host-` em
 *   produção (HTTPS obrigatório). O admin fala com a API pela MESMA origin
 *   (proxy `/api/native`), então não há cookie de terceiros nem CORS com
 *   credenciais.
 * - Mutação exige `Origin` na allowlist (`ADMIN_ORIGINS`) E o cabeçalho
 *   `x-maike-admin-csrf` igual ao HMAC da sessão.
 * - Esta sessão NUNCA instala `request.contexto.auth` (tenant): é outra
 *   identidade, sem acesso a dados de clientes.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { env, ehProducao } from '../../config/env.js';
import { adminError } from '../../shared/errors/AppError.js';
import {
  csrfDaSessao,
  exigirChaveAdminConfigurada,
  iguaisTempoConstante,
  novoTokenSessao,
  sha256Hex,
} from './adminCrypto.js';

/** Único papel com as prerrogativas do proprietário (catálogo + própria conta). */
export const PAPEL_PROPRIETARIO = 'proprietario';

export const CABECALHO_CSRF = 'x-maike-admin-csrf';
/** Sessão antes do segundo fator: curta e restrita às rotas de MFA. */
export const PRE_MFA_MINUTOS = 10;

const cookieSeguro = () => ehProducao();
export const nomeCookieAdmin = () => (cookieSeguro() ? '__Host-maike_admin' : 'maike_admin');

export const originsAdminPermitidas = () => {
  if (env.adminOrigins.length) return env.adminOrigins;
  return ehProducao() ? [] : ['http://localhost:5174', 'http://127.0.0.1:5174'];
};

/** @param {string|undefined} header */
export const lerCookie = (header, nome) => {
  if (typeof header !== 'string') return null;
  for (const parte of header.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim()) || null;
  }
  return null;
};

/** @param {import('fastify').FastifyReply} reply @param {string} token @param {Date} expiraEm */
export const definirCookieAdmin = (reply, token, expiraEm) => {
  const maxAge = Math.max(0, Math.floor((expiraEm.getTime() - Date.now()) / 1000));
  const partes = [`${nomeCookieAdmin()}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`];
  if (cookieSeguro()) partes.push('Secure');
  reply.header('set-cookie', partes.join('; '));
};

/** @param {import('fastify').FastifyReply} reply */
export const limparCookieAdmin = (reply) => {
  const partes = [`${nomeCookieAdmin()}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (cookieSeguro()) partes.push('Secure');
  reply.header('set-cookie', partes.join('; '));
};

/**
 * Cria sessão e devolve o token em claro (só para o cookie desta resposta).
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 * @param {{ adminId: string, mfaVerificado: boolean, ip?: string|null, userAgent?: string|null }} p
 */
export const criarSessaoAdmin = async (db, { adminId, mfaVerificado, ip, userAgent }) => {
  const token = novoTokenSessao();
  const minutos = mfaVerificado ? env.adminSessaoHoras * 60 : PRE_MFA_MINUTOS;
  const sessao = await db.sessaoAdminMaike.create({
    data: {
      admin_id: adminId,
      token_hash: sha256Hex(token),
      mfa_verificado: mfaVerificado,
      expira_em: new Date(Date.now() + minutos * 60_000),
      ip: ip ? String(ip).slice(0, 64) : null,
      user_agent: userAgent ? String(userAgent).slice(0, 255) : null,
    },
  });
  return { token, sessao, csrf: csrfDaSessao(sessao.id) };
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 * @param {string} adminId
 * @param {string} motivo
 * @param {{ excetoId?: string }} [opcoes]
 */
export const revogarSessoesAdmin = (db, adminId, motivo, { excetoId } = {}) =>
  db.sessaoAdminMaike.updateMany({
    where: { admin_id: adminId, revogada_em: null, ...(excetoId ? { id: { not: excetoId } } : {}) },
    data: { revogada_em: new Date(), motivo_revogacao: motivo },
  });

/** @param {import('fastify').FastifyRequest} request */
const exigirOrigemECsrf = (request, sessaoId) => {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !originsAdminPermitidas().includes(origin)) {
    throw adminError('ADMIN_ORIGEM_RECUSADA', 'origem não autorizada para o MAIKE Admin');
  }
  if (sessaoId === null) return;
  const enviado = request.headers[CABECALHO_CSRF];
  if (typeof enviado !== 'string' || !iguaisTempoConstante(enviado, csrfDaSessao(sessaoId))) {
    throw adminError('ADMIN_ORIGEM_RECUSADA', 'token CSRF ausente ou inválido');
  }
};

/** Só a checagem de Origin (login, antes de existir sessão) — e a chave configurada. */
export const exigirOrigemAdmin = (request) => {
  exigirChaveAdminConfigurada();
  exigirOrigemECsrf(request, null);
};

const METODOS_LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Guarda das rotas do MAIKE Admin e das escritas do catálogo global.
 *
 * Sem cookie: 401; com `Authorization` de tenant e sem cookie: 403 (identidade
 * errada, não ausente). Sessão revogada/expirada/ociosa/forjada: 401.
 *
 * @param {{ permitirSemMfa?: boolean }} [opcoes]
 */
export const exigirSessaoAdmin = ({ permitirSemMfa = false } = {}) =>
  async (request) => {
    exigirChaveAdminConfigurada();
    const token = lerCookie(request.headers.cookie, nomeCookieAdmin());
    if (!token) {
      if (request.headers.authorization) {
        throw adminError('ADMIN_PRINCIPAL_REQUIRED', 'acesso exclusivo do administrador principal do MAIKE');
      }
      throw adminError('ADMIN_SESSAO_REQUIRED', 'sessão do MAIKE Admin ausente');
    }
    const db = getPrismaClient();
    const sessao = await db.sessaoAdminMaike.findUnique({
      where: { token_hash: sha256Hex(token) },
      include: { admin: true },
    });
    const agora = Date.now();
    const ociosaMs = env.adminSessaoOciosaMinutos * 60_000;
    const valida =
      sessao &&
      !sessao.revogada_em &&
      sessao.expira_em.getTime() > agora &&
      sessao.admin.ativo &&
      (!sessao.mfa_verificado || sessao.ultimo_uso_em.getTime() + ociosaMs > agora);
    if (!valida) throw adminError('ADMIN_SESSAO_REQUIRED', 'sessão do MAIKE Admin expirada ou revogada');
    // PR145-R4: sessão válida de OUTRO papel global não herda as prerrogativas
    // do proprietário (a tabela admite papéis futuros).
    if (sessao.admin.papel !== PAPEL_PROPRIETARIO) {
      throw adminError('ADMIN_PRINCIPAL_REQUIRED', 'acesso exclusivo do proprietário do MAIKE');
    }
    if (!sessao.mfa_verificado && !permitirSemMfa) {
      throw adminError('ADMIN_MFA_REQUIRED', 'confirme o segundo fator para continuar');
    }
    if (!METODOS_LEITURA.has(request.method)) exigirOrigemECsrf(request, sessao.id);

    if (agora - sessao.ultimo_uso_em.getTime() > 60_000) {
      await db.sessaoAdminMaike.update({ where: { id: sessao.id }, data: { ultimo_uso_em: new Date(agora) } });
    }
    const { admin, ...semAdmin } = sessao;
    request.contexto.adminPrincipal = admin;
    request.contexto.sessaoAdmin = semAdmin;
  };

// ─── Limitador de tentativas (por processo) ────────────────────────────────
// Complementa o bloqueio persistido por conta (`tentativas_falhas`/`bloqueado_ate`),
// que vale entre instâncias. Este barra rajadas por IP antes de gastar scrypt.

const janelas = new Map();

/**
 * @param {string} chave
 * @param {{ limite: number, janelaMs: number }} regra
 */
export const consumirTentativa = (chave, { limite, janelaMs }) => {
  const agora = Date.now();
  const atual = janelas.get(chave);
  if (!atual || atual.inicio + janelaMs <= agora) {
    janelas.set(chave, { inicio: agora, total: 1 });
    return;
  }
  atual.total += 1;
  if (atual.total > limite) {
    throw adminError('ADMIN_RATE_LIMITED', 'tentativas demais; aguarde alguns minutos');
  }
};

/** Só para testes. */
export const zerarLimitadorAdmin = () => janelas.clear();
