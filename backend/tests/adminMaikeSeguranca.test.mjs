/**
 * PR145-R3 (D-PROD-70) — segurança do Administrador Principal MAIKE.
 *
 * PostgreSQL real. TOTP calculado pelo mesmo RFC 6238 do servidor.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { env } from '../src/config/env.js';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { criarSessaoAdmin } from '../src/modules/adminMaike/adminSessao.js';
import { criarProprietarioInicial, MAX_FALHAS_CONTA } from '../src/modules/adminMaike/adminService.js';
import { codigoTotp, gerarHashSenhaAdmin, passoTotpAtual, verificarSenhaAdmin } from '../src/modules/adminMaike/adminCrypto.js';
import {
  criarApp,
  criarTenant,
  limparBanco,
  encerrar,
  autenticarNoApp,
  criarAdminComSessao,
  cookieAdminDe,
  ORIGEM_ADMIN,
} from './helpers.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
const prisma = () => getPrismaClient();

before(async () => {
  app = await criarApp();
  await app.ready();
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const LOGIN = 'dono.maike';
const SENHA = 'senha-forte-do-dono-1';
const base = { origin: ORIGEM_ADMIN };
const post = (url, payload, headers = base) => app.inject({ method: 'POST', url, headers, payload });
const get = (url, headers) => app.inject({ method: 'GET', url, headers });
const login = (l = LOGIN, s = SENHA, headers = base) => post('/admin-maike/auth/login', { login: l, senha: s }, headers);
const preSessao = (r) => ({ ...base, cookie: cookieAdminDe(r), 'x-maike-admin-csrf': r.json().csrf_token });
const proibidosNoCorpo = /senha_hash|mfa_segredo|token_hash|scrypt\$|"token"/;

const tenant = async () => {
  const t = await criarTenant();
  const { corpo } = await autenticarNoApp(app, t.credenciais);
  return { ...t, jwt: corpo.token };
};

describe('bootstrap e senha', () => {
  test('S-01 bootstrap único, hash scrypt versionado, senha fraca recusada', async () => {
    await assert.rejects(criarProprietarioInicial({ login: LOGIN, senha: 'curta' }), (e) => e.code === 'ADMIN_ENTRADA_INVALIDA');
    const admin = await criarProprietarioInicial({ login: 'Dono.Maike', senha: SENHA });
    assert.equal(admin.login, 'dono.maike');
    assert.equal(JSON.stringify(admin).match(proibidosNoCorpo), null);
    const linha = await prisma().adminPrincipalMaike.findUnique({ where: { id: admin.id } });
    assert.match(linha.senha_hash, /^scrypt\$1\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
    assert.equal(linha.senha_hash.includes(SENHA), false);
    assert.equal(await verificarSenhaAdmin(SENHA, linha.senha_hash), true);
    assert.equal(linha.cliente_id, undefined, 'sem tenant');
    await assert.rejects(criarProprietarioInicial({ login: 'outro.dono', senha: SENHA }), (e) => e.code === 'ADMIN_JA_CONFIGURADO');
    // Corrida de bootstrap: só um vence.
    await limparBanco();
    const r = await Promise.allSettled([
      criarProprietarioInicial({ login: 'a.dono', senha: SENHA }),
      criarProprietarioInicial({ login: 'b.dono', senha: SENHA }),
    ]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(await prisma().adminPrincipalMaike.count(), 1);
  });
});

describe('login, cookie e origem', () => {
  test('S-02 login correto abre pré-sessão HttpOnly/SameSite=Strict sem token no corpo; errado é genérico', async () => {
    await criarProprietarioInicial({ login: LOGIN, senha: SENHA });
    const ok = await login();
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().etapa, 'inscrever_mfa');
    const setCookie = String(ok.headers['set-cookie']);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Path=\//);
    assert.equal(ok.body.match(proibidosNoCorpo), null);
    const token = cookieAdminDe(ok).split('=')[1];
    assert.equal(ok.body.includes(token), false, 'token de sessão só no cookie');
    const s = await prisma().sessaoAdminMaike.findFirst();
    assert.notEqual(s.token_hash, token, 'banco guarda só o hash');

    const senhaErrada = await login(LOGIN, 'senha-errada-qualquer');
    const inexistente = await login('nao.existe', SENHA);
    for (const r of [senhaErrada, inexistente]) {
      assert.equal(r.statusCode, 401);
      assert.equal(r.json().code, 'ADMIN_CREDENCIAIS_INVALIDAS');
      assert.equal(r.json().message, 'credenciais inválidas');
      assert.equal(r.headers['set-cookie'], undefined);
    }
    const eventos = await prisma().eventoSegurancaAdminMaike.findMany({ where: { acao: 'login' } });
    assert.deepEqual(eventos.map((e) => e.sucesso).sort(), [false, false, true]);
    assert.equal(JSON.stringify(eventos).includes(SENHA), false);
  });

  test('S-03 login sem Origin ou com Origin estranha é recusado (CSRF de login)', async () => {
    await criarProprietarioInicial({ login: LOGIN, senha: SENHA });
    for (const headers of [{}, { origin: 'https://evil.example' }, { origin: `${ORIGEM_ADMIN}.evil.example` }]) {
      const r = await login(LOGIN, SENHA, headers);
      assert.equal(r.statusCode, 403);
      assert.equal(r.json().code, 'ADMIN_ORIGEM_RECUSADA');
    }
    assert.equal(await prisma().sessaoAdminMaike.count(), 0);
  });

  test('S-04 bloqueio por conta após falhas seguidas e limitador por IP (429)', async () => {
    await criarProprietarioInicial({ login: LOGIN, senha: SENHA });
    for (let i = 0; i < MAX_FALHAS_CONTA; i += 1) assert.equal((await login(LOGIN, 'errada-errada-1')).statusCode, 401);
    const bloqueada = await login();
    assert.equal(bloqueada.statusCode, 401, 'senha certa durante o bloqueio também falha');
    const linha = await prisma().adminPrincipalMaike.findFirst();
    assert.ok(linha.bloqueado_ate > new Date());
    await prisma().adminPrincipalMaike.update({ where: { id: linha.id }, data: { bloqueado_ate: new Date(Date.now() - 1000) } });
    assert.equal((await login()).statusCode, 200, 'expirado o bloqueio, entra');
    // 11ª tentativa do mesmo IP na janela → 429 antes de gastar scrypt.
    for (let i = 0; i < 3; i += 1) await login(LOGIN, 'errada-errada-1');
    const r = await login();
    assert.equal(r.statusCode, 429);
    assert.equal(r.json().code, 'ADMIN_RATE_LIMITED');
  });
});

describe('MFA', () => {
  test('S-05 pré-sessão só serve para MFA; inscrição, replay e tentativas', async () => {
    await criarProprietarioInicial({ login: LOGIN, senha: SENHA });
    const h = preSessao(await login());
    assert.equal((await get('/admin-maike/catalogo', h)).json().code, 'ADMIN_MFA_REQUIRED');
    const escrita = await post('/catalogo-global/admin/tipos', { codigo: 'lote', nome: 'Lote' }, h);
    assert.equal(escrita.statusCode, 403);
    assert.equal(escrita.json().code, 'ADMIN_MFA_REQUIRED');

    const insc = await post('/admin-maike/mfa/inscricao', {}, h);
    assert.equal(insc.statusCode, 200);
    const { segredo, otpauth_uri } = insc.json();
    assert.match(otpauth_uri, /^otpauth:\/\/totp\/MAIKE%20Admin%3Adono\.maike\?secret=[A-Z2-7]+&issuer=MAIKE%20Admin/);
    const linha = await prisma().adminPrincipalMaike.findFirst();
    assert.equal(linha.mfa_segredo_cifrado.includes(segredo), false, 'segredo só cifrado no banco');
    assert.equal((await post('/admin-maike/mfa/confirmar', { codigo: '000000' }, h)).statusCode, 401);

    const passo = passoTotpAtual();
    const conf = await post('/admin-maike/mfa/confirmar', { codigo: codigoTotp(segredo, passo) }, h);
    assert.equal(conf.statusCode, 200);
    assert.equal(conf.json().etapa, 'ok');
    assert.equal(conf.json().codigos_recuperacao.length, 10);
    assert.equal((await get('/admin-maike/sessao', h)).statusCode, 401, 'pré-sessão revogada na promoção');
    const v = { ...base, cookie: cookieAdminDe(conf), 'x-maike-admin-csrf': conf.json().csrf_token };
    assert.equal((await get('/admin-maike/catalogo', v)).statusCode, 200);
    assert.equal(await prisma().codigoRecuperacaoAdminMaike.count(), 10);
    const hashes = (await prisma().codigoRecuperacaoAdminMaike.findMany()).map((c) => c.codigo_hash);
    assert.equal(hashes.some((x) => conf.json().codigos_recuperacao.includes(x)), false, 'só hash');
    assert.equal((await post('/admin-maike/mfa/inscricao', {}, v)).json().code, 'ADMIN_JA_CONFIGURADO');

    // Novo login: o MESMO código (mesmo passo) não serve de novo (replay).
    const h2 = preSessao(await login());
    assert.equal((await post('/admin-maike/auth/mfa', { codigo: codigoTotp(segredo, passo) }, h2)).statusCode, 401);
    // 5 códigos errados derrubam a pré-sessão.
    for (let i = 0; i < 4; i += 1) await post('/admin-maike/auth/mfa', { codigo: '123456' }, h2);
    assert.equal((await get('/admin-maike/sessao', h2)).statusCode, 401);
  });

  test('S-06 código de recuperação: uso único e derruba as demais sessões', async () => {
    const dono = await criarAdminComSessao(app, { login: LOGIN, senha: SENHA });
    const [codigo] = dono.codigosRecuperacao;
    const h = preSessao(await login());
    const r = await post('/admin-maike/auth/mfa', { codigo_recuperacao: codigo.toLowerCase() }, h);
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().codigos_restantes, 9);
    assert.equal((await get('/admin-maike/sessao', dono.headers)).statusCode, 401, 'sessão anterior revogada');
    const h2 = preSessao(await login());
    assert.equal((await post('/admin-maike/auth/mfa', { codigo_recuperacao: codigo }, h2)).statusCode, 401, 'reuso recusado');
  });
});

describe('guarda de sessão', () => {
  test('S-07 CSRF e Origin obrigatórios em mutação; leitura não precisa de CSRF', async () => {
    const { headers } = await criarAdminComSessao(app);
    const { 'x-maike-admin-csrf': csrf, ...semCsrf } = headers;
    assert.equal((await get('/admin-maike/catalogo', semCsrf)).statusCode, 200);
    const casos = [semCsrf, { ...headers, 'x-maike-admin-csrf': `${csrf}x` }, { ...headers, origin: 'https://evil.example' }];
    for (const h of casos) {
      const r = await post('/catalogo-global/admin/tipos', { codigo: 'lote', nome: 'Lote' }, h);
      assert.equal(r.statusCode, 403);
      assert.equal(r.json().code, 'ADMIN_ORIGEM_RECUSADA');
    }
    assert.equal(await prisma().catalogoTipoEntidade.count(), 0);
    assert.equal((await post('/catalogo-global/admin/tipos', { codigo: 'lote', nome: 'Lote' }, headers)).statusCode, 201);
  });

  test('S-08 sessão expirada, ociosa, revogada ou forjada → 401', async () => {
    const { headers } = await criarAdminComSessao(app);
    const forjado = { ...headers, cookie: 'maike_admin=forjado-qualquer' };
    assert.equal((await get('/admin-maike/catalogo', forjado)).statusCode, 401);
    const s = await prisma().sessaoAdminMaike.findFirst({ where: { revogada_em: null } });
    await prisma().sessaoAdminMaike.update({ where: { id: s.id }, data: { ultimo_uso_em: new Date(Date.now() - 31 * 60_000) } });
    assert.equal((await get('/admin-maike/catalogo', headers)).statusCode, 401, 'ociosa');
    await prisma().sessaoAdminMaike.update({
      where: { id: s.id },
      data: { ultimo_uso_em: new Date(), expira_em: new Date(Date.now() - 1000) },
    });
    assert.equal((await get('/admin-maike/catalogo', headers)).statusCode, 401, 'expirada');
    await prisma().sessaoAdminMaike.update({
      where: { id: s.id },
      data: { expira_em: new Date(Date.now() + 3600_000), revogada_em: new Date() },
    });
    assert.equal((await get('/admin-maike/catalogo', headers)).statusCode, 401, 'revogada');
  });

  test('S-09 tenant comum, admin de tenant e operador legado: 403; sem credencial: 401', async () => {
    const comum = await tenant();
    const adminTenant = await tenant();
    await prisma().permissao.create({ data: { cliente_id: adminTenant.cliente.id, user_email: adminTenant.usuario.login, is_admin: true } });
    const operadorLegado = await tenant();
    await prisma().operadorProdutoMaike.create({
      data: { cliente_id: operadorLegado.cliente.id, usuario_id: operadorLegado.usuario.id, ativo: true },
    });
    const rotas = [
      ['POST', '/catalogo-global/admin/tipos', { codigo: 'lote', nome: 'Lote' }],
      ['POST', '/catalogo-global/admin/assets', { mime_type: 'image/png', conteudo_base64: 'AA==' }],
      ['GET', '/admin-maike/catalogo'],
      ['GET', '/admin-maike/catalogo/validacao'],
      ['GET', '/admin-maike/conta/sessoes'],
    ];
    for (const [method, url, payload] of rotas) {
      for (const t of [comum, adminTenant, operadorLegado]) {
        const r = await app.inject({ method, url, headers: { ...base, authorization: `Bearer ${t.jwt}` }, payload });
        assert.equal(r.statusCode, 403, `${method} ${url}`);
        assert.equal(r.json().code, 'ADMIN_PRINCIPAL_REQUIRED');
      }
      const sem = await app.inject({ method, url, headers: base, payload });
      assert.equal(sem.statusCode, 401);
      assert.equal(sem.json().code, 'ADMIN_SESSAO_REQUIRED');
    }
    assert.equal(await prisma().catalogoTipoEntidade.count(), 0);
  });

  test('S-10 sessão do produto não vira auth_context de tenant nem altera dados de tenant', async () => {
    const { headers } = await criarAdminComSessao(app);
    const t = await tenant();
    for (const [method, url, payload] of [
      ['GET', '/usuarios'],
      ['GET', '/lotes'],
      ['GET', '/catalogo-global/icones'],
      ['PATCH', `/usuarios/${t.usuario.id}`, { nova_senha: 'invadida-123456' }],
    ]) {
      const r = await app.inject({ method, url, headers, payload });
      assert.equal(r.statusCode, 401, `${method} ${url}`);
    }
    const u = await prisma().usuario.findUnique({ where: { cliente_id_id: { cliente_id: t.cliente.id, id: t.usuario.id } } });
    const { corpo } = await autenticarNoApp(app, t.credenciais);
    assert.ok(corpo.token, 'senha do usuário do tenant intacta');
    assert.ok(u);
  });
});

describe('conta e segurança', () => {
  test('S-11 trocar senha exige senha atual + TOTP novo e revoga todas as sessões', async () => {
    const dono = await criarAdminComSessao(app, { login: LOGIN, senha: SENHA });
    const nova = 'nova-senha-do-dono-2';
    const r1 = await post('/admin-maike/conta/senha', { senha_atual: 'errada-errada-1', codigo_mfa: await dono.proximoCodigo(), nova_senha: nova }, dono.headers);
    assert.equal(r1.statusCode, 401);
    const r2 = await post('/admin-maike/conta/senha', { senha_atual: SENHA, codigo_mfa: '000000', nova_senha: nova }, dono.headers);
    assert.equal(r2.statusCode, 401);
    const r3 = await post('/admin-maike/conta/senha', { senha_atual: SENHA, codigo_mfa: await dono.proximoCodigo(), nova_senha: SENHA }, dono.headers);
    assert.equal(r3.json().code, 'ADMIN_ENTRADA_INVALIDA', 'nova igual à atual');
    const ok = await post('/admin-maike/conta/senha', { senha_atual: SENHA, codigo_mfa: await dono.proximoCodigo(), nova_senha: nova }, dono.headers);
    assert.equal(ok.statusCode, 200);
    assert.match(String(ok.headers['set-cookie']), /Max-Age=0/);
    assert.equal((await get('/admin-maike/sessao', dono.headers)).statusCode, 401, 'sessão atual revogada');
    assert.equal((await login(LOGIN, SENHA)).statusCode, 401);
    assert.equal((await login(LOGIN, nova)).statusCode, 200);
    const ev = await prisma().eventoSegurancaAdminMaike.findMany({ where: { acao: 'senha_alterada' } });
    assert.deepEqual(ev.map((e) => e.sucesso).sort(), [false, false, true]);
  });

  test('S-12 trocar login: unicidade, revogação e novo login funcionando', async () => {
    const dono = await criarAdminComSessao(app, { login: LOGIN, senha: SENHA });
    await prisma().adminPrincipalMaike.create({ data: { login: 'ja.usado', senha_hash: 'x', papel: 'operador_catalogo' } });
    const dup = await post('/admin-maike/conta/login', { senha_atual: SENHA, codigo_mfa: await dono.proximoCodigo(), novo_login: 'ja.usado' }, dono.headers);
    assert.equal(dup.statusCode, 422);
    assert.equal((await get('/admin-maike/sessao', dono.headers)).statusCode, 200, 'falha não derruba a sessão');
    const ok = await post('/admin-maike/conta/login', { senha_atual: SENHA, codigo_mfa: await dono.proximoCodigo(), novo_login: 'Novo.Dono' }, dono.headers);
    assert.equal(ok.statusCode, 200);
    assert.equal((await get('/admin-maike/sessao', dono.headers)).statusCode, 401);
    assert.equal((await login(LOGIN, SENHA)).statusCode, 401);
    assert.equal((await login('novo.dono', SENHA)).statusCode, 200);
  });

  test('S-13 revogar outras sessões, listar sessões, logout e regerar códigos', async () => {
    const dono = await criarAdminComSessao(app, { login: LOGIN, senha: SENHA });
    const h2 = preSessao(await login());
    const outra = await post('/admin-maike/auth/mfa', { codigo: await dono.proximoCodigo() }, h2);
    const v2 = { ...base, cookie: cookieAdminDe(outra), 'x-maike-admin-csrf': outra.json().csrf_token };
    const lista = (await get('/admin-maike/conta/sessoes', dono.headers)).json();
    assert.equal(lista.length, 2);
    assert.equal(lista.filter((s) => s.atual).length, 1);
    assert.equal(JSON.stringify(lista).match(proibidosNoCorpo), null);
    assert.equal((await post('/admin-maike/conta/sessoes/revogar-outras', {}, dono.headers)).json().revogadas, 1);
    assert.equal((await get('/admin-maike/sessao', v2)).statusCode, 401);

    const cod = await post('/admin-maike/conta/codigos-recuperacao', { senha_atual: SENHA, codigo_mfa: await dono.proximoCodigo() }, dono.headers);
    assert.equal(cod.json().codigos_recuperacao.length, 10);
    assert.notDeepEqual(cod.json().codigos_recuperacao, dono.codigosRecuperacao);

    const out = await post('/admin-maike/auth/logout', {}, dono.headers);
    assert.equal(out.statusCode, 204);
    assert.equal((await get('/admin-maike/sessao', dono.headers)).statusCode, 401);
  });

  test('S-14 auditoria do catálogo registra o administrador principal como ator', async () => {
    const dono = await criarAdminComSessao(app);
    await post('/catalogo-global/admin/tipos', { codigo: 'lote', nome: 'Lote', revisao_esperada: 0 }, dono.headers);
    const [a] = await prisma().auditoriaCatalogoGlobal.findMany();
    assert.equal(a.admin_id, dono.admin.id);
    assert.equal(a.operador_id, null);
  });
});

describe('PR145-R4 — só o papel proprietário; chave obrigatória em produção', () => {
  test('S-15 linha global de OUTRO papel, mesmo com sessão verificada, não tem prerrogativas', async () => {
    await criarAdminComSessao(app);
    const outro = await prisma().adminPrincipalMaike.create({
      data: { login: 'operador.catalogo', papel: 'operador_catalogo', senha_hash: await gerarHashSenhaAdmin(SENHA), mfa_ativo: true },
    });
    assert.equal((await login('operador.catalogo', SENHA)).statusCode, 401, 'não entra pelo login');
    const { token, csrf } = await criarSessaoAdmin(prisma(), { adminId: outro.id, mfaVerificado: true });
    const h = { ...base, cookie: `maike_admin=${token}`, 'x-maike-admin-csrf': csrf };
    for (const [m, u, payload] of [
      ['GET', '/admin-maike/catalogo'],
      ['GET', '/admin-maike/sessao'],
      ['POST', '/catalogo-global/admin/tipos', { codigo: 'lote', nome: 'Lote' }],
      ['POST', '/admin-maike/conta/sessoes/revogar-outras', {}],
    ]) {
      const r = await app.inject({ method: m, url: u, headers: h, payload });
      assert.equal(r.statusCode, 403, `${m} ${u}`);
      assert.equal(r.json().code, 'ADMIN_PRINCIPAL_REQUIRED');
    }
    assert.equal(await prisma().catalogoTipoEntidade.count(), 0);
  });

  test('S-16 produção sem ADMIN_MAIKE_CHAVE (ou inválida) falha FECHADA com 503 sanitizado; ADMIN_ORIGINS vazio recusa', async () => {
    await criarProprietarioInicial({ login: LOGIN, senha: SENHA });
    const original = { nodeEnv: env.nodeEnv, chave: env.adminMaikeChave, origins: env.adminOrigins };
    try {
      env.nodeEnv = 'production';
      for (const chave of [null, 'curta', 'não-base64!!']) {
        env.adminMaikeChave = chave;
        env.adminOrigins = [ORIGEM_ADMIN];
        const r = await login();
        assert.equal(r.statusCode, 503);
        assert.equal(r.json().code, 'ADMIN_INDISPONIVEL');
        assert.equal(r.body.includes('curta') || r.body.includes('base64!!'), false, 'sem valor na resposta');
        assert.equal((await get('/admin-maike/catalogo', base)).statusCode, 503);
      }
      assert.equal(await prisma().sessaoAdminMaike.count(), 0, 'nada de sessão sem chave');
      env.adminMaikeChave = Buffer.alloc(32, 7).toString('base64');
      env.adminOrigins = [];
      const semOrigins = await login();
      assert.equal(semOrigins.statusCode, 403);
      assert.equal(semOrigins.json().code, 'ADMIN_ORIGEM_RECUSADA');
    } finally {
      env.nodeEnv = original.nodeEnv;
      env.adminMaikeChave = original.chave;
      env.adminOrigins = original.origins;
    }
  });
});
