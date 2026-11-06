/**
 * MAIKE-SAAS-ADMIN-S04-P1 — revogação durável das sessões de fazenda.
 *
 * PostgreSQL local descartável. O JWT carrega `cliente_sessao_epoca` e
 * `usuario_sessao_epoca`; `app.autenticar` compara com o banco a cada
 * requisição. Prova: suspender, desativar, trocar senha (própria, por admin ou
 * script) e trocar papel derrubam o token anterior PARA SEMPRE, inclusive
 * depois de reativar; token sem época ou com época malformada = 401; o
 * incremento é atômico com a mudança e com a auditoria (rollback junto);
 * outro tenant e outra conta não são afetados.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { zerarLimitadorAdmin } from '../src/modules/adminMaike/adminSessao.js';
import { redefinirSenhaPorLogin } from '../../scripts/auth/reset-password.mjs';
import { criarApp, criarTenant, limparBanco, encerrar, criarAdminComSessao } from './helpers.mjs';

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
  zerarLimitadorAdmin();
});

const login = (credenciais, extra = {}) => app.inject({ method: 'POST', url: '/auth/login', payload: { ...credenciais, ...extra } });
const tokenDe = async (credenciais, extra) => (await login(credenciais, extra)).json().token;
const contexto = (token) => app.inject({ method: 'GET', url: '/auth/contexto', headers: { authorization: `Bearer ${token}` } });
const statusDe = async (token) => (await contexto(token)).statusCode;
const patchUsuario = (token, id, payload) =>
  app.inject({ method: 'PATCH', url: `/usuarios/${id}`, headers: { authorization: `Bearer ${token}` }, payload });
const payloadDe = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
const epocas = async (t) => ({
  cliente: (await prisma().cliente.findUnique({ where: { id: t.cliente.id } })).sessao_epoca,
  usuario: (await prisma().usuario.findUnique({ where: { id: t.usuario.id } })).sessao_epoca,
});

/** Escrita do MAIKE Admin com If-Match da ficha atual (contrato S03-R2). */
const situacao = async (headers, clienteId, ativo, justificativa = 'teste de revogação S04-P1') => {
  const etag = (await app.inject({ method: 'GET', url: `/admin-maike/clientes/${clienteId}`, headers })).headers.etag;
  return app.inject({
    method: 'POST',
    url: `/admin-maike/clientes/${clienteId}/situacao`,
    headers: { ...headers, 'if-match': etag },
    payload: { ativo, justificativa },
  });
};

/** Trigger temporária que faz o INSERT de auditoria falhar (rollback real). */
const comAuditoriaQuebrada = async (tabela, fn) => {
  const db = prisma();
  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION s04p1_falhar() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 's04p1 auditoria falhou'; END $$ LANGUAGE plpgsql`);
  await db.$executeRawUnsafe(`CREATE TRIGGER s04p1_falhar BEFORE INSERT ON "${tabela}" FOR EACH ROW EXECUTE FUNCTION s04p1_falhar()`);
  try {
    return await fn();
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS s04p1_falhar ON "${tabela}"`);
    await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS s04p1_falhar()');
  }
};

describe('S04-P1 JWT com época', () => {
  test('SP-01 login normal e lembrar=true emitem as épocas atuais; /auth/contexto = 200; TTL preservado', async () => {
    const t = await criarTenant();
    await prisma().cliente.update({ where: { id: t.cliente.id }, data: { sessao_epoca: 3 } });
    await prisma().usuario.update({ where: { id: t.usuario.id }, data: { sessao_epoca: 7 } });
    const normal = await login(t.credenciais);
    const lembrar = await login(t.credenciais, { lembrar: true });
    for (const r of [normal, lembrar]) {
      assert.equal(r.statusCode, 200);
      assert.deepEqual(Object.keys(r.json()).sort(), ['cliente_id', 'token', 'usuario'], 'resposta pública do login inalterada');
      const p = payloadDe(r.json().token);
      assert.equal(p.cliente_sessao_epoca, 3);
      assert.equal(p.usuario_sessao_epoca, 7);
      assert.equal(await statusDe(r.json().token), 200);
    }
    const ttl = (r) => payloadDe(r.json().token).exp - payloadDe(r.json().token).iat;
    assert.equal(ttl(normal), 8 * 3600);
    assert.equal(ttl(lembrar), 30 * 24 * 3600);
  });

  test('SP-03 token legado sem época, época malformada, expirado ou alterado: 401 e nenhum contexto instalado', async () => {
    const t = await criarTenant();
    const base = { cliente_id: t.cliente.id, usuario_id: t.usuario.id, login: t.usuario.login };
    const ok = app.jwt.sign({ ...base, cliente_sessao_epoca: 0, usuario_sessao_epoca: 0 });
    assert.equal(await statusDe(ok), 200, 'controle: épocas corretas assinadas = 200');
    const casos = [
      ['legado sem claims', app.jwt.sign(base)],
      ['só a do cliente', app.jwt.sign({ ...base, cliente_sessao_epoca: 0 })],
      ['string', app.jwt.sign({ ...base, cliente_sessao_epoca: '0', usuario_sessao_epoca: '0' })],
      ['negativa', app.jwt.sign({ ...base, cliente_sessao_epoca: -1, usuario_sessao_epoca: 0 })],
      ['fração', app.jwt.sign({ ...base, cliente_sessao_epoca: 0.5, usuario_sessao_epoca: 0 })],
      ['null', app.jwt.sign({ ...base, cliente_sessao_epoca: null, usuario_sessao_epoca: 0 })],
      ['acima de Int', app.jwt.sign({ ...base, cliente_sessao_epoca: 2147483648, usuario_sessao_epoca: 0 })],
      ['época futura', app.jwt.sign({ ...base, cliente_sessao_epoca: 1, usuario_sessao_epoca: 0 })],
      ['expirado', app.jwt.sign({ ...base, cliente_sessao_epoca: 0, usuario_sessao_epoca: 0 }, { expiresIn: 1 })],
    ];
    await new Promise((r) => setTimeout(r, 1100));
    // Alterado: payload trocado mantendo a assinatura original.
    const [h, , s] = ok.split('.');
    const corpoAlterado = Buffer.from(JSON.stringify({ ...payloadDe(ok), usuario_sessao_epoca: 5 })).toString('base64url');
    casos.push(['assinatura não confere', `${h}.${corpoAlterado}.${s}`]);
    for (const [nome, token] of casos) {
      const r = await contexto(token);
      assert.equal(r.statusCode, 401, nome);
      assert.equal(r.json().code, 'TENANT_CONTEXT_REQUIRED', nome);
    }
  });
});

describe('S04-P1 suspensão do cliente (MAIKE Admin)', () => {
  test('SP-02 mesmo token: 200 → suspender → 401 → reativar → 401; login novo = 200 (RED no S03)', async () => {
    const t = await criarTenant();
    const { headers } = await criarAdminComSessao(app);
    const antigo = await tokenDe(t.credenciais, { lembrar: true });
    assert.equal(await statusDe(antigo), 200);
    assert.equal((await situacao(headers, t.cliente.id, false)).statusCode, 200);
    assert.equal(await statusDe(antigo), 401);
    assert.equal((await situacao(headers, t.cliente.id, true)).statusCode, 200);
    assert.equal(await statusDe(antigo), 401, 'token anterior à suspensão nunca mais vale');
    const novo = await tokenDe(t.credenciais);
    assert.equal(await statusDe(novo), 200, 'login novo após reativar');
    assert.deepEqual(await epocas(t), { cliente: 1, usuario: 0 }, 'suspender +1; reativar preserva');
    const ev = await prisma().eventoSegurancaAdminMaike.findMany({ where: { acao: { in: ['cliente_suspender', 'cliente_reativar'] } }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(ev.map((e) => [e.acao, e.dados.antes.sessao_epoca, e.dados.depois.sessao_epoca]), [
      ['cliente_suspender', 0, 1],
      ['cliente_reativar', 1, 1],
    ]);
    assert.equal(/senha|\$2[aby]\$|eyJ/.test(JSON.stringify(ev)), false, 'auditoria sem segredo nem token');
  });

  test('SP-04 suspender A derruba TODAS as contas de A (sem tocar Usuario.sessao_epoca); B segue intacto', async () => {
    const a = await criarTenant({ codigo: 'fazenda-a' });
    const b = await criarTenant({ codigo: 'fazenda-b' });
    const outraDeA = await prisma().usuario.create({
      data: { cliente_id: a.cliente.id, nome: 'Outra', login: 'outra-a', senha_hash: (await prisma().usuario.findUnique({ where: { id: a.usuario.id } })).senha_hash },
    });
    const { headers } = await criarAdminComSessao(app);
    const tokA = await tokenDe(a.credenciais);
    const tokOutra = await tokenDe({ login: 'outra-a', senha: a.credenciais.senha });
    const tokB = await tokenDe(b.credenciais);
    assert.equal((await situacao(headers, a.cliente.id, false)).statusCode, 200);
    assert.equal(await statusDe(tokA), 401);
    assert.equal(await statusDe(tokOutra), 401);
    assert.equal(await statusDe(tokB), 200, 'outro tenant não é afetado');
    assert.equal((await prisma().usuario.findUnique({ where: { id: outraDeA.id } })).sessao_epoca, 0, 'época individual intocada');
    assert.deepEqual(await epocas(b), { cliente: 0, usuario: 0 });
    assert.equal((await prisma().cliente.findUnique({ where: { id: b.cliente.id } })).ativo, true);
  });

  test('SP-05 precondição 428/409 e corrida não avançam a época; auditoria quebrada desfaz ativo E época', async () => {
    const t = await criarTenant();
    const { headers } = await criarAdminComSessao(app);
    const url = `/admin-maike/clientes/${t.cliente.id}/situacao`;
    const corpo = { ativo: false, justificativa: 'tentativa sem revisão válida' };
    assert.equal((await app.inject({ method: 'POST', url, headers, payload: corpo })).statusCode, 428);
    assert.equal((await app.inject({ method: 'POST', url, headers: { ...headers, 'if-match': `"r1-${'A'.repeat(43)}"` }, payload: corpo })).statusCode, 409);
    assert.deepEqual(await epocas(t), { cliente: 0, usuario: 0 });

    const r = await comAuditoriaQuebrada('EventoSegurancaAdminMaike', () => situacao(headers, t.cliente.id, false));
    assert.equal(r.statusCode >= 500, true, `auditoria falhou → erro interno (${r.statusCode})`);
    const c = await prisma().cliente.findUnique({ where: { id: t.cliente.id } });
    assert.deepEqual([c.ativo, c.sessao_epoca], [true, 0], 'rollback conjunto: nem ativo nem época mudaram');

    // Duas suspensões com a mesma revisão: uma vence, a época sobe exatamente 1.
    const etag = (await app.inject({ method: 'GET', url: `/admin-maike/clientes/${t.cliente.id}`, headers })).headers.etag;
    const rs = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url, headers: { ...headers, 'if-match': etag }, payload: corpo })));
    assert.deepEqual(rs.map((x) => x.statusCode).sort(), [200, 409]);
    assert.equal((await epocas(t)).cliente, 1);
    assert.equal(await prisma().eventoSegurancaAdminMaike.count({ where: { acao: 'cliente_suspender' } }), 1);
  });
});

describe('S04-P1 mudanças sensíveis da conta', () => {
  const fazendaComAdmin = async () => {
    const adm = await criarTenant({ papelTenant: 'administrador' });
    const comum = await prisma().usuario.create({
      data: { cliente_id: adm.cliente.id, nome: 'Peão', login: `peao-${adm.cliente.codigo}`, senha_hash: (await prisma().usuario.findUnique({ where: { id: adm.usuario.id } })).senha_hash },
    });
    const credComum = { login: comum.login, senha: adm.credenciais.senha };
    return { adm, comum, credComum, tokAdm: await tokenDe(adm.credenciais), tokComum: await tokenDe(credComum) };
  };

  test('SP-06 desativar → token antigo 401 → reativar → continua 401; login novo 200; só nome não revoga', async () => {
    const f = await fazendaComAdmin();
    assert.equal((await patchUsuario(f.tokAdm, f.comum.id, { nome: 'Peão Renomeado' })).statusCode, 200);
    assert.equal(await statusDe(f.tokComum), 200, 'editar nome não revoga');
    assert.equal((await patchUsuario(f.tokAdm, f.comum.id, { ativo: false })).statusCode, 200);
    assert.equal(await statusDe(f.tokComum), 401);
    assert.equal((await patchUsuario(f.tokAdm, f.comum.id, { ativo: true })).statusCode, 200);
    assert.equal(await statusDe(f.tokComum), 401, 'token anterior não ressuscita');
    assert.equal(await statusDe(await tokenDe(f.credComum)), 200);
    assert.equal((await prisma().usuario.findUnique({ where: { id: f.comum.id } })).sessao_epoca, 2, 'desativar +1, reativar +1');
    assert.equal(await statusDe(f.tokAdm), 200, 'o administrador que agiu segue com a sessão');
    const logs = await prisma().auditLog.findMany({ where: { entidade: 'Usuario', entidade_id: f.comum.id, acao: 'update' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(logs.map((l) => Boolean(l.dados_novos.sessoes_revogadas)), [false, true, true]);
    assert.equal(JSON.stringify(logs).includes('sessao_epoca'), false, 'época não vaza na saída pública/auditoria');

    // Auditoria quebrada: nem ativo nem época mudam.
    const r = await comAuditoriaQuebrada('AuditLog', () => patchUsuario(f.tokAdm, f.comum.id, { ativo: false }));
    assert.equal(r.statusCode >= 500, true);
    const u = await prisma().usuario.findUnique({ where: { id: f.comum.id } });
    assert.deepEqual([u.ativo, u.sessao_epoca], [true, 2]);
  });

  test('SP-07 senha: própria (encerra o token do pedido), por admin (só o alvo), script de reset; senha antiga não entra', async () => {
    const f = await fazendaComAdmin();
    const outro = await criarTenant();
    const tokOutro = await tokenDe(outro.credenciais);

    // Própria senha: 200, mas o token que pediu morre.
    const tokSegundo = await tokenDe(f.credComum);
    const propria = await patchUsuario(f.tokComum, f.comum.id, { nova_senha: 'propria-nova-1', senha_atual: f.credComum.senha });
    assert.equal(propria.statusCode, 200);
    assert.equal(await statusDe(f.tokComum), 401, 'o próprio token do pedido');
    assert.equal(await statusDe(tokSegundo), 401, 'outra sessão da mesma conta');
    assert.equal((await login(f.credComum)).statusCode, 401, 'senha antiga não entra');
    const tokNovaSenha = await tokenDe({ login: f.comum.login, senha: 'propria-nova-1' });
    assert.equal(await statusDe(tokNovaSenha), 200);

    // Admin troca a senha alheia: só o alvo cai.
    assert.equal((await patchUsuario(f.tokAdm, f.comum.id, { nova_senha: 'definida-pelo-admin-1' })).statusCode, 200);
    assert.equal(await statusDe(tokNovaSenha), 401);
    assert.equal(await statusDe(f.tokAdm), 200, 'admin não perde a própria sessão');
    assert.equal(await statusDe(tokOutro), 200, 'outro tenant segue');

    // Script operacional de reset (núcleo exportado, banco local).
    const tokAntesReset = await tokenDe({ login: f.comum.login, senha: 'definida-pelo-admin-1' });
    await redefinirSenhaPorLogin(prisma(), { login: f.comum.login, novaSenha: 'via-script-reset-1' });
    assert.equal(await statusDe(tokAntesReset), 401);
    assert.equal((await login({ login: f.comum.login, senha: 'definida-pelo-admin-1' })).statusCode, 401);
    assert.equal(await statusDe(await tokenDe({ login: f.comum.login, senha: 'via-script-reset-1' })), 200);
    assert.equal((await prisma().usuario.findUnique({ where: { id: f.comum.id } })).sessao_epoca, 3);
  });

  test('SP-08 papel_tenant via script operacional avança a época e derruba o token anterior', async () => {
    const t = await criarTenant();
    const antigo = await tokenDe(t.credenciais);
    const script = fileURLToPath(new URL('../../scripts/auth/papel-tenant.mjs', import.meta.url));
    const r = spawnSync(process.execPath, [script, '--cliente', t.cliente.codigo, '--login', t.usuario.login, '--papel', 'administrador'], {
      input: 'CONFIRMAR\n',
      encoding: 'utf8',
      env: { ...process.env, PAPEL_TENANT_STDIN: 'sim', NODE_ENV: 'test' },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(await statusDe(antigo), 401);
    const u = await prisma().usuario.findUnique({ where: { id: t.usuario.id } });
    assert.deepEqual([u.papel_tenant, u.sessao_epoca], ['administrador', 1]);
    const [a] = await prisma().auditLog.findMany({ where: { acao: 'papel_tenant' } });
    assert.equal(a.dados_novos.sessoes_revogadas, true);
    assert.equal(await statusDe(await tokenDe(t.credenciais)), 200);
  });

  test('SP-09 trocas concorrentes de senha na mesma conta não perdem incremento (o banco serializa)', async () => {
    const f = await fazendaComAdmin();
    const rs = await Promise.all(['concorrente-a-1', 'concorrente-b-1'].map((s) => patchUsuario(f.tokAdm, f.comum.id, { nova_senha: s })));
    assert.deepEqual(rs.map((x) => x.statusCode), [200, 200]);
    assert.equal((await prisma().usuario.findUnique({ where: { id: f.comum.id } })).sessao_epoca, 2, 'dois incrementos, nenhum perdido');
    assert.equal(await prisma().auditLog.count({ where: { entidade_id: f.comum.id, acao: 'update' } }), 2);
    assert.equal(await statusDe(f.tokComum), 401);
  });
});

describe('S04-P1 contratos preservados', () => {
  test('SP-11 época não é gravável por corpo nem aparece em leitura pública', async () => {
    const adm = await criarTenant({ papelTenant: 'administrador' });
    const tok = await tokenDe(adm.credenciais);
    const r = await patchUsuario(tok, adm.usuario.id, { sessao_epoca: 0 });
    assert.equal(r.statusCode, 400, 'campo fora do contrato fechado');
    assert.equal((await prisma().usuario.findUnique({ where: { id: adm.usuario.id } })).sessao_epoca, 0);
    const lista = await app.inject({ method: 'GET', url: '/usuarios', headers: { authorization: `Bearer ${tok}` } });
    assert.equal(lista.body.includes('sessao_epoca'), false);
    const { headers } = await criarAdminComSessao(app);
    const ficha = await app.inject({ method: 'GET', url: `/admin-maike/clientes/${adm.cliente.id}`, headers });
    assert.equal(ficha.body.includes('sessao_epoca'), false, 'ficha do Admin não expõe a época');
    const forjado = await app.inject({
      method: 'POST',
      url: `/admin-maike/clientes/${adm.cliente.id}/situacao`,
      headers: { ...headers, 'if-match': ficha.headers.etag },
      payload: { ativo: false, justificativa: 'tentando forjar a época', sessao_epoca: 0 },
    });
    assert.equal(forjado.statusCode, 400);
  });

  test('SP-12 tenant só da sessão: cliente_id em corpo/query não vira autoridade; sessão do proprietário não é sessão de fazenda', async () => {
    const a = await criarTenant();
    const b = await criarTenant();
    const tokA = await tokenDe(a.credenciais);
    const ctx = await app.inject({ method: 'GET', url: `/auth/contexto?cliente_id=${b.cliente.id}`, headers: { authorization: `Bearer ${tokA}`, 'x-cliente-id': b.cliente.id } });
    if (ctx.statusCode === 200) assert.equal(ctx.json().cliente_id, a.cliente.id);
    else assert.equal(ctx.statusCode, 400);
    const corpo = await patchUsuario(tokA, a.usuario.id, { nome: 'X Y', cliente_id: b.cliente.id });
    assert.equal(corpo.statusCode, 400);
    const { headers } = await criarAdminComSessao(app);
    assert.equal((await app.inject({ method: 'GET', url: '/auth/contexto', headers })).statusCode, 401, 'cookie do proprietário não abre a fazenda');
  });
});
