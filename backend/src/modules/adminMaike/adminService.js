/**
 * Serviço do Administrador Principal MAIKE (D-PROD-70).
 *
 * Fluxo: senha → sessão PRÉ-MFA (10 min, só rotas de MFA) → TOTP ou código de
 * recuperação → sessão VERIFICADA nova (token rotacionado; a pré-sessão é
 * revogada). Sem MFA ativo, a pré-sessão só serve para inscrever o TOTP.
 *
 * Respostas de credencial são genéricas; falhas contam por conta (bloqueio
 * persistido, vale entre instâncias) e por IP (limitador em memória).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { adminError } from '../../shared/errors/AppError.js';
import {
  cifrar,
  decifrar,
  gerarHashSenhaAdmin,
  motivoSenhaFraca,
  normalizarCodigoRecuperacao,
  novoCodigoRecuperacao,
  novoSegredoTotp,
  passoDoCodigoTotp,
  sha256Hex,
  uriOtpauth,
  verificarSenhaAdmin,
} from './adminCrypto.js';
import { criarSessaoAdmin, revogarSessoesAdmin } from './adminSessao.js';

export const MAX_FALHAS_CONTA = 5;
export const BLOQUEIO_MINUTOS = 15;
export const MAX_FALHAS_MFA_SESSAO = 5;
export const TOTAL_CODIGOS_RECUPERACAO = 10;

const FALHA_GENERICA = 'credenciais inválidas';
const LOGIN_RE = /^[a-z0-9][a-z0-9._@-]{2,119}$/;

const prisma = () => getPrismaClient();

/** @param {unknown} login */
export const normalizarLoginAdmin = (login) => (typeof login === 'string' ? login.trim().toLowerCase() : '');

/** @param {unknown} login */
const exigirLoginValido = (login) => {
  const l = normalizarLoginAdmin(login);
  if (!LOGIN_RE.test(l)) {
    throw adminError('ADMIN_ENTRADA_INVALIDA', 'login deve ter 3 a 120 caracteres: letras minúsculas, números, . _ @ -');
  }
  return l;
};

/** @param {unknown} senha */
const exigirSenhaForte = (senha) => {
  const motivo = motivoSenhaFraca(senha);
  if (motivo) throw adminError('ADMIN_ENTRADA_INVALIDA', motivo);
  return /** @type {string} */ (senha);
};

/**
 * @param {{ adminId?: string|null, acao: string, sucesso: boolean, ip?: string|null, requestId: string, dados?: object|null }} e
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} [db]
 */
export const registrarEventoSeguranca = (e, db = prisma()) =>
  db.eventoSegurancaAdminMaike.create({
    data: {
      admin_id: e.adminId ?? null,
      acao: e.acao,
      sucesso: e.sucesso,
      ip: e.ip ? String(e.ip).slice(0, 64) : null,
      request_id: e.requestId,
      dados: e.dados ?? undefined,
    },
  });

/** Visão pública do admin: nunca hash, segredo ou contadores internos. */
export const comoAdminPublico = (admin) => ({
  id: admin.id,
  login: admin.login,
  papel: admin.papel,
  mfa_ativo: admin.mfa_ativo,
});

/** Etapa que a sessão atual permite. */
export const etapaDaSessao = (sessao, admin) =>
  sessao.mfa_verificado ? 'ok' : admin.mfa_ativo ? 'mfa' : 'inscrever_mfa';

// ─── Bootstrap ─────────────────────────────────────────────────────────────

/**
 * Cria o ÚNICO proprietário. Recusa se já existir um (unique em
 * `chave_proprietario`, à prova de corrida). Não define MFA: o primeiro login
 * obriga a inscrição antes de qualquer operação.
 *
 * @param {{ login: unknown, senha: unknown }} entrada
 */
export const criarProprietarioInicial = async ({ login, senha }) => {
  const l = exigirLoginValido(login);
  const s = exigirSenhaForte(senha);
  const senha_hash = await gerarHashSenhaAdmin(s);
  try {
    const admin = await prisma().adminPrincipalMaike.create({
      data: { login: l, senha_hash, papel: 'proprietario', chave_proprietario: 'proprietario' },
    });
    await registrarEventoSeguranca({ adminId: admin.id, acao: 'bootstrap', sucesso: true, requestId: 'bootstrap-cli' });
    return comoAdminPublico(admin);
  } catch (erro) {
    if (/** @type {any} */ (erro)?.code === 'P2002') {
      throw adminError('ADMIN_JA_CONFIGURADO', 'o proprietário do MAIKE já foi criado; bootstrap recusado');
    }
    throw erro;
  }
};

// ─── Login e MFA ───────────────────────────────────────────────────────────

/**
 * @param {{ login: unknown, senha: unknown, ip?: string, userAgent?: string, requestId: string }} p
 */
export const loginAdmin = async ({ login, senha, ip, userAgent, requestId }) => {
  const l = normalizarLoginAdmin(login);
  const admin = l ? await prisma().adminPrincipalMaike.findUnique({ where: { login: l } }) : null;
  const bloqueado = Boolean(admin?.bloqueado_ate && admin.bloqueado_ate.getTime() > Date.now());
  // Verifica sempre (mesmo bloqueado ou inexistente) para não vazar estado pelo tempo.
  const senhaOk = await verificarSenhaAdmin(typeof senha === 'string' ? senha : '', admin?.senha_hash);

  if (!admin || !admin.ativo || bloqueado || !senhaOk) {
    if (admin && !bloqueado) await contarFalhaConta(admin.id);
    await registrarEventoSeguranca({
      adminId: admin?.id ?? null,
      acao: 'login',
      sucesso: false,
      ip,
      requestId,
      dados: { motivo: !admin ? 'login_desconhecido' : bloqueado ? 'bloqueado' : 'senha' },
    });
    throw adminError('ADMIN_CREDENCIAIS_INVALIDAS', FALHA_GENERICA);
  }

  const resultado = await prisma().$transaction(async (tx) => {
    await tx.adminPrincipalMaike.update({ where: { id: admin.id }, data: { tentativas_falhas: 0, bloqueado_ate: null } });
    const criada = await criarSessaoAdmin(tx, { adminId: admin.id, mfaVerificado: false, ip, userAgent });
    await registrarEventoSeguranca({ adminId: admin.id, acao: 'login', sucesso: true, ip, requestId }, tx);
    return criada;
  });
  return { ...resultado, admin, etapa: admin.mfa_ativo ? 'mfa' : 'inscrever_mfa' };
};

/** @param {string} adminId */
const contarFalhaConta = async (adminId) => {
  const a = await prisma().adminPrincipalMaike.update({
    where: { id: adminId },
    data: { tentativas_falhas: { increment: 1 } },
  });
  if (a.tentativas_falhas >= MAX_FALHAS_CONTA) {
    await prisma().adminPrincipalMaike.update({
      where: { id: adminId },
      data: { tentativas_falhas: 0, bloqueado_ate: new Date(Date.now() + BLOQUEIO_MINUTOS * 60_000) },
    });
  }
};

/**
 * Consome um código TOTP (rejeita reuso do mesmo passo ou anterior).
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 * @param {{ id: string, mfa_segredo_cifrado: string|null }} admin
 * @param {unknown} codigo
 */
const consumirTotp = async (db, admin, codigo) => {
  if (!admin.mfa_segredo_cifrado) return false;
  const passo = passoDoCodigoTotp(decifrar(admin.mfa_segredo_cifrado), codigo);
  if (passo === null) return false;
  const r = await db.adminPrincipalMaike.updateMany({
    where: { id: admin.id, OR: [{ mfa_ultimo_passo: null }, { mfa_ultimo_passo: { lt: passo } }] },
    data: { mfa_ultimo_passo: passo },
  });
  return r.count === 1;
};

/** Falha de segundo fator na pré-sessão: conta e, no limite, derruba a sessão. */
const falhaMfa = async ({ sessao, admin, ip, requestId, acao }) => {
  const s = await prisma().sessaoAdminMaike.update({
    where: { id: sessao.id },
    data: { tentativas_mfa: { increment: 1 } },
  });
  if (s.tentativas_mfa >= MAX_FALHAS_MFA_SESSAO) {
    await prisma().sessaoAdminMaike.update({
      where: { id: sessao.id },
      data: { revogada_em: new Date(), motivo_revogacao: 'mfa_tentativas' },
    });
    await contarFalhaConta(admin.id);
  }
  await registrarEventoSeguranca({ adminId: admin.id, acao, sucesso: false, ip, requestId });
  throw adminError('ADMIN_CREDENCIAIS_INVALIDAS', 'código inválido');
};

/** Troca a pré-sessão por uma sessão verificada nova (rotação de token). */
const promoverSessao = (tx, { sessao, admin, ip, userAgent }) =>
  tx.sessaoAdminMaike
    .update({ where: { id: sessao.id }, data: { revogada_em: new Date(), motivo_revogacao: 'mfa_promovida' } })
    .then(() => criarSessaoAdmin(tx, { adminId: admin.id, mfaVerificado: true, ip, userAgent }));

/**
 * @param {{ sessao: any, admin: any, codigo?: unknown, codigoRecuperacao?: unknown, ip?: string, userAgent?: string, requestId: string }} p
 */
export const verificarMfaAdmin = async ({ sessao, admin, codigo, codigoRecuperacao, ip, userAgent, requestId }) => {
  if (!admin.mfa_ativo) throw adminError('ADMIN_MFA_REQUIRED', 'inscreva o segundo fator primeiro');

  if (codigoRecuperacao !== undefined && codigoRecuperacao !== null && codigoRecuperacao !== '') {
    const hash = sha256Hex(normalizarCodigoRecuperacao(codigoRecuperacao));
    const resultado = await prisma().$transaction(async (tx) => {
      const usado = await tx.codigoRecuperacaoAdminMaike.updateMany({
        where: { admin_id: admin.id, codigo_hash: hash, usado_em: null },
        data: { usado_em: new Date() },
      });
      if (usado.count !== 1) return null;
      // Código de recuperação = possível perda do autenticador: derruba todas as outras sessões.
      await revogarSessoesAdmin(tx, admin.id, 'codigo_recuperacao_usado', { excetoId: sessao.id });
      const nova = await promoverSessao(tx, { sessao, admin, ip, userAgent });
      const restantes = await tx.codigoRecuperacaoAdminMaike.count({ where: { admin_id: admin.id, usado_em: null } });
      await registrarEventoSeguranca(
        { adminId: admin.id, acao: 'mfa_recuperacao', sucesso: true, ip, requestId, dados: { restantes } },
        tx
      );
      return { ...nova, restantes };
    });
    if (!resultado) return falhaMfa({ sessao, admin, ip, requestId, acao: 'mfa_recuperacao' });
    return resultado;
  }

  const resultado = await prisma().$transaction(async (tx) => {
    if (!(await consumirTotp(tx, admin, codigo))) return null;
    const nova = await promoverSessao(tx, { sessao, admin, ip, userAgent });
    await registrarEventoSeguranca({ adminId: admin.id, acao: 'mfa', sucesso: true, ip, requestId }, tx);
    return nova;
  });
  if (!resultado) return falhaMfa({ sessao, admin, ip, requestId, acao: 'mfa' });
  return resultado;
};

/** Gera (ou regera) o segredo TOTP pendente. Só enquanto o MFA não está ativo. */
export const iniciarInscricaoMfa = async ({ admin, ip, requestId }) => {
  if (admin.mfa_ativo) throw adminError('ADMIN_JA_CONFIGURADO', 'o segundo fator já está ativo');
  const segredo = novoSegredoTotp();
  await prisma().adminPrincipalMaike.update({
    where: { id: admin.id },
    data: { mfa_segredo_cifrado: cifrar(segredo), mfa_ultimo_passo: null },
  });
  await registrarEventoSeguranca({ adminId: admin.id, acao: 'mfa_inscricao_iniciada', sucesso: true, ip, requestId });
  return { segredo, otpauth_uri: uriOtpauth(admin.login, segredo) };
};

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} adminId */
const gerarCodigosRecuperacao = async (tx, adminId) => {
  await tx.codigoRecuperacaoAdminMaike.deleteMany({ where: { admin_id: adminId, usado_em: null } });
  const codigos = Array.from({ length: TOTAL_CODIGOS_RECUPERACAO }, () => novoCodigoRecuperacao());
  await tx.codigoRecuperacaoAdminMaike.createMany({
    data: codigos.map((c) => ({ admin_id: adminId, codigo_hash: sha256Hex(normalizarCodigoRecuperacao(c)) })),
  });
  return codigos;
};

/** Confirma o TOTP pendente, ativa o MFA, devolve os códigos de recuperação UMA vez. */
export const confirmarInscricaoMfa = async ({ sessao, admin, codigo, ip, userAgent, requestId }) => {
  if (admin.mfa_ativo) throw adminError('ADMIN_JA_CONFIGURADO', 'o segundo fator já está ativo');
  if (!admin.mfa_segredo_cifrado) throw adminError('ADMIN_ENTRADA_INVALIDA', 'inicie a inscrição do segundo fator');
  const resultado = await prisma().$transaction(async (tx) => {
    if (!(await consumirTotp(tx, admin, codigo))) return null;
    await tx.adminPrincipalMaike.update({ where: { id: admin.id }, data: { mfa_ativo: true } });
    const codigos = await gerarCodigosRecuperacao(tx, admin.id);
    const nova = await promoverSessao(tx, { sessao, admin, ip, userAgent });
    await registrarEventoSeguranca({ adminId: admin.id, acao: 'mfa_ativado', sucesso: true, ip, requestId }, tx);
    return { ...nova, codigos_recuperacao: codigos };
  });
  if (!resultado) return falhaMfa({ sessao, admin, ip, requestId, acao: 'mfa_inscricao' });
  return resultado;
};

// ─── Conta / segurança (sessão verificada + reautenticação) ───────────────

/**
 * Senha atual + TOTP novo (não reutilizável). Falha conta para o bloqueio.
 * @param {{ admin: any, senhaAtual: unknown, codigoMfa: unknown, ip?: string, requestId: string, acao: string }} p
 */
const reautenticar = async ({ admin, senhaAtual, codigoMfa, ip, requestId, acao }) => {
  const atual = await prisma().adminPrincipalMaike.findUnique({ where: { id: admin.id } });
  const okSenha = await verificarSenhaAdmin(typeof senhaAtual === 'string' ? senhaAtual : '', atual?.senha_hash);
  const okMfa = okSenha && atual ? await consumirTotp(prisma(), atual, codigoMfa) : false;
  if (!okSenha || !okMfa) {
    await contarFalhaConta(admin.id);
    await registrarEventoSeguranca({ adminId: admin.id, acao, sucesso: false, ip, requestId, dados: { motivo: 'reautenticacao' } });
    throw adminError('ADMIN_CREDENCIAIS_INVALIDAS', 'senha atual ou código inválido');
  }
  return /** @type {NonNullable<typeof atual>} */ (atual);
};

/** Troca a senha e revoga TODAS as sessões (inclusive a atual). */
export const alterarSenhaAdmin = async ({ admin, senhaAtual, codigoMfa, novaSenha, ip, requestId }) => {
  const nova = exigirSenhaForte(novaSenha);
  const atual = await reautenticar({ admin, senhaAtual, codigoMfa, ip, requestId, acao: 'senha_alterada' });
  if (await verificarSenhaAdmin(nova, atual.senha_hash)) {
    throw adminError('ADMIN_ENTRADA_INVALIDA', 'a nova senha deve ser diferente da atual');
  }
  const senha_hash = await gerarHashSenhaAdmin(nova);
  await prisma().$transaction(async (tx) => {
    await tx.adminPrincipalMaike.update({ where: { id: admin.id }, data: { senha_hash, senha_alterada_em: new Date() } });
    const r = await revogarSessoesAdmin(tx, admin.id, 'senha_alterada');
    await registrarEventoSeguranca(
      { adminId: admin.id, acao: 'senha_alterada', sucesso: true, ip, requestId, dados: { sessoes_revogadas: r.count } },
      tx
    );
  });
};

/** Troca o login (único) e revoga TODAS as sessões. */
export const alterarLoginAdmin = async ({ admin, senhaAtual, codigoMfa, novoLogin, ip, requestId }) => {
  const l = exigirLoginValido(novoLogin);
  await reautenticar({ admin, senhaAtual, codigoMfa, ip, requestId, acao: 'login_alterado' });
  if (l === admin.login) throw adminError('ADMIN_ENTRADA_INVALIDA', 'o novo login é igual ao atual');
  try {
    await prisma().$transaction(async (tx) => {
      await tx.adminPrincipalMaike.update({ where: { id: admin.id }, data: { login: l } });
      await revogarSessoesAdmin(tx, admin.id, 'login_alterado');
      await registrarEventoSeguranca({ adminId: admin.id, acao: 'login_alterado', sucesso: true, ip, requestId }, tx);
    });
  } catch (erro) {
    if (/** @type {any} */ (erro)?.code === 'P2002') throw adminError('ADMIN_ENTRADA_INVALIDA', 'login indisponível');
    throw erro;
  }
};

/** Regera os códigos de recuperação (invalida os não usados). */
export const regenerarCodigosAdmin = async ({ admin, senhaAtual, codigoMfa, ip, requestId }) => {
  await reautenticar({ admin, senhaAtual, codigoMfa, ip, requestId, acao: 'codigos_regerados' });
  return prisma().$transaction(async (tx) => {
    const codigos = await gerarCodigosRecuperacao(tx, admin.id);
    await registrarEventoSeguranca({ adminId: admin.id, acao: 'codigos_regerados', sucesso: true, ip, requestId }, tx);
    return codigos;
  });
};

export const revogarOutrasSessoesAdmin = async ({ admin, sessao, ip, requestId }) => {
  const r = await revogarSessoesAdmin(prisma(), admin.id, 'revogada_pelo_proprietario', { excetoId: sessao.id });
  await registrarEventoSeguranca({
    adminId: admin.id,
    acao: 'sessoes_revogadas',
    sucesso: true,
    ip,
    requestId,
    dados: { total: r.count },
  });
  return r.count;
};

export const encerrarSessaoAdmin = async ({ admin, sessao, ip, requestId }) => {
  await prisma().sessaoAdminMaike.updateMany({
    where: { id: sessao.id, revogada_em: null },
    data: { revogada_em: new Date(), motivo_revogacao: 'logout' },
  });
  await registrarEventoSeguranca({ adminId: admin.id, acao: 'logout', sucesso: true, ip, requestId });
};

export const listarSessoesAdmin = async ({ admin, sessao }) => {
  const sessoes = await prisma().sessaoAdminMaike.findMany({
    where: { admin_id: admin.id, revogada_em: null, mfa_verificado: true, expira_em: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return sessoes.map((s) => ({
    id: s.id,
    criada_em: s.createdAt.toISOString(),
    ultimo_uso_em: s.ultimo_uso_em.toISOString(),
    expira_em: s.expira_em.toISOString(),
    user_agent: s.user_agent,
    atual: s.id === sessao.id,
  }));
};
