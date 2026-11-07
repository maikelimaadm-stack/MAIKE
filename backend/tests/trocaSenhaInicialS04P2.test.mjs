/**
 * MAIKE-SAAS-ADMIN-S04-P2 — troca obrigatória da senha temporária no primeiro acesso.
 *
 * PostgreSQL local descartável e a API Fastify real. A fazenda é criada pelo
 * fluxo real do MAIKE Admin (S03, com MFA). Prova:
 *  - a senha temporária NÃO emite a sessão normal: só um token restrito, de
 *    chave e escopo próprios, que nenhuma API da fazenda aceita;
 *  - a troca é atômica (senha + pendência + época S04-P1 + auditoria), única
 *    em corrida, sem replay, e exige novo login com a senha nova;
 *  - tokens forjados, legados, de época errada, de tenant suspenso ou de conta
 *    inativa são recusados; contas anteriores ao S04-P2 (NULL) entram normalmente.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { zerarLimitadorAdmin } from '../src/modules/adminMaike/adminSessao.js';
import { chaveTrocaSenhaInicial } from '../src/shared/auth/trocaSenhaInicial.js';
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

const NOVA = 'Nova-Senha-Escolhida-9';
const login = (credenciais) => app.inject({ method: 'POST', url: '/auth/login', payload: credenciais });
const bearer = (token) => ({ authorization: `Bearer ${token}` });
const get = (url, token) => app.inject({ method: 'GET', url, headers: bearer(token) });
const trocar = (token, payload) =>
  app.inject({ method: 'POST', url: '/auth/troca-senha-inicial', headers: token ? bearer(token) : {}, payload });
const payloadDe = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
const conta = (id) => prisma().usuario.findUnique({ where: { id } });

/** Fazenda nova pelo fluxo real do MAIKE Admin (S03): devolve login e senha temporária. */
const novaFazenda = async (codigo = 'nova-esperanca', loginAdm = 'maria.esperanca', adminHeaders = null) => {
  const headers = adminHeaders ?? (await criarAdminComSessao(app)).headers;
  const r = await app.inject({
    method: 'POST',
    url: '/admin-maike/clientes',
    headers,
    payload: { nome: 'Fazenda Nova Esperança', codigo, administrador: { nome: 'Maria Gestora', login: loginAdm } },
  });
  assert.equal(r.statusCode, 201, r.body);
  const c = r.json();
  return { adminHeaders: headers, cliente: c.cliente, usuario: c.administrador, credenciais: { login: c.administrador.login, senha: c.senha_temporaria } };
};

/** Token restrito obtido pelo login com a senha temporária. */
const tokenRestrito = async (credenciais) => {
  const r = await login(credenciais);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().troca_senha_obrigatoria, true);
  return r.json().token_troca_senha;
};

/** Trigger temporária que faz o INSERT de auditoria falhar (rollback real). */
const comAuditoriaQuebrada = async (fn) => {
  const db = prisma();
  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION s04p2_falhar() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 's04p2 auditoria falhou'; END $$ LANGUAGE plpgsql`);
  await db.$executeRawUnsafe(`CREATE TRIGGER s04p2_falhar BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION s04p2_falhar()`);
  try {
    return await fn();
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS s04p2_falhar ON "AuditLog"`);
    await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS s04p2_falhar()');
  }
};

/** Rotas normais da fazenda (amostra ampla: dados, módulos, usuários, permissões, mapa, rebanho). */
const ROTAS_DA_FAZENDA = [
  '/auth/contexto',
  '/usuarios',
  '/usuarios/page',
  '/permissoes',
  '/empresas',
  '/setores',
  '/areas-pastagem',
  '/lotes',
  '/produtos',
  '/lancamentos-tarefa',
  '/rebanho/posicoes',
  '/movimentacoes-mapa',
];

describe('S04-P2 estado durável e criação S03', () => {
  test('TP-01 a fazenda nova nasce com a troca pendente; contas anteriores (NULL) e false entram normalmente', async () => {
    const f = await novaFazenda();
    assert.equal((await conta(f.usuario.id)).troca_senha_pendente, true);

    const antiga = await criarTenant({ codigo: 'fazenda-antiga', login: 'joao.antigo' });
    assert.equal((await conta(antiga.usuario.id)).troca_senha_pendente, null, 'conta anterior não é marcada');
    for (const valor of [null, false]) {
      await prisma().usuario.update({ where: { id: antiga.usuario.id }, data: { troca_senha_pendente: valor } });
      const r = await login(antiga.credenciais);
      assert.equal(r.statusCode, 200);
      assert.deepEqual(Object.keys(r.json()).sort(), ['cliente_id', 'token', 'usuario'], 'contrato do login normal inalterado');
      assert.equal((await get('/auth/contexto', r.json().token)).statusCode, 200);
    }
  });
});

describe('S04-P2 login limitado', () => {
  test('TP-02 senha temporária: 200 só com o token restrito (sem sessão, sem tenant), no-store, escopo e TTL de 10 min', async () => {
    const f = await novaFazenda();
    const r = await login(f.credenciais);
    assert.equal(r.statusCode, 200, r.body);
    assert.match(String(r.headers['cache-control']), /no-store/);
    assert.deepEqual(Object.keys(r.json()).sort(), ['expira_em_segundos', 'token_troca_senha', 'troca_senha_obrigatoria']);
    assert.equal(r.json().expira_em_segundos, 600);
    const p = payloadDe(r.json().token_troca_senha);
    assert.equal(p.escopo, 'troca_senha_inicial');
    assert.equal(p.exp - p.iat, 600);
    assert.equal(r.body.includes(f.credenciais.senha), false);
    // Senha errada continua genérica (sem revelar que a conta existe e está pendente).
    const errada = await login({ login: f.credenciais.login, senha: 'nao-e-a-senha' });
    assert.equal(errada.statusCode, 401);
    assert.equal(errada.json().code, 'AUTH_INVALID_CREDENTIALS');
  });

  test('TP-03 o token restrito não abre NENHUMA rota da fazenda (401) nem o MAIKE Admin', async () => {
    const f = await novaFazenda();
    const restrito = await tokenRestrito(f.credenciais);
    for (const url of ROTAS_DA_FAZENDA) {
      const r = await get(url, restrito);
      assert.equal(r.statusCode, 401, `${url} ${r.body}`);
      assert.equal(r.json().code, 'TENANT_CONTEXT_REQUIRED', url);
    }
    for (const [method, url, payload] of [
      ['POST', '/usuarios', { nome: 'Peão', login: 'peao.x', senha: 'senha-do-peao-1' }],
      ['PATCH', `/usuarios/${f.usuario.id}`, { nome: 'Outro' }],
      ['POST', '/lotes', { nome: 'x' }],
    ]) {
      const r = await app.inject({ method, url, headers: bearer(restrito), payload });
      assert.equal(r.statusCode, 401, `${method} ${url}`);
    }
    const adm = await app.inject({ method: 'GET', url: '/admin-maike/clientes', headers: bearer(restrito) });
    assert.notEqual(adm.statusCode, 200, 'admin não aceita bearer de fazenda');
    assert.equal((await conta(f.usuario.id)).nome, 'Maria Gestora', 'nada foi alterado');
  });

  test('TP-04 sessão normal forjada (segredo real, épocas certas) para conta pendente: 401; token com escopo no segredo normal: 401', async () => {
    const f = await novaFazenda();
    const base = { cliente_id: f.cliente.id, usuario_id: f.usuario.id, login: f.usuario.login, cliente_sessao_epoca: 0, usuario_sessao_epoca: 0 };
    const forjado = app.jwt.sign(base);
    assert.equal((await get('/auth/contexto', forjado)).statusCode, 401, 'a guarda relê a pendência no banco');
    // Controle: depois da troca, o mesmo formato (com a época nova) é aceito.
    const comEscopo = app.jwt.sign({ ...base, escopo: 'troca_senha_inicial' });
    assert.equal((await get('/auth/contexto', comEscopo)).statusCode, 401);
    const antiga = await criarTenant({ codigo: 'outra', login: 'conta.normal' });
    const normalComEscopo = app.jwt.sign({
      cliente_id: antiga.cliente.id, usuario_id: antiga.usuario.id, login: antiga.usuario.login,
      cliente_sessao_epoca: 0, usuario_sessao_epoca: 0, escopo: 'qualquer',
    });
    assert.equal((await get('/auth/contexto', normalComEscopo)).statusCode, 401, 'qualquer escopo = não é sessão normal');
  });

  test('TP-05 troca com token ausente, normal, forjado, sem escopo, de época errada ou expirado: 401 e nada muda', async () => {
    const f = await novaFazenda();
    const restrito = await tokenRestrito(f.credenciais);
    const p = payloadDe(restrito);
    const chave = chaveTrocaSenhaInicial();
    const antiga = await criarTenant({ codigo: 'outra', login: 'conta.normal' });
    const normal = (await login(antiga.credenciais)).json().token;
    const semTempo = { ...p };
    delete semTempo.iat;
    delete semTempo.exp;
    const casos = [
      ['sem token', null],
      ['token normal de outra conta', normal],
      ['escopo certo no segredo normal', app.jwt.sign(semTempo)],
      ['chave certa sem escopo', app.jwt.sign({ ...semTempo, escopo: undefined }, { key: chave })],
      ['chave certa, escopo errado', app.jwt.sign({ ...semTempo, escopo: 'outro' }, { key: chave })],
      ['época da conta errada', app.jwt.sign({ ...semTempo, usuario_sessao_epoca: 5 }, { key: chave })],
      ['época do cliente errada', app.jwt.sign({ ...semTempo, cliente_sessao_epoca: 2 }, { key: chave })],
      ['época malformada', app.jwt.sign({ ...semTempo, usuario_sessao_epoca: '0' }, { key: chave })],
      ['conta de outro tenant (não pendente)', app.jwt.sign({ ...semTempo, cliente_id: antiga.cliente.id, usuario_id: antiga.usuario.id }, { key: chave })],
      ['expirado', app.jwt.sign({ ...semTempo, iat: 1000, exp: 1600 }, { key: chave })],
      ['alterado', `${restrito.slice(0, -3)}${restrito.slice(-3) === 'AAA' ? 'BBB' : 'AAA'}`],
    ];
    for (const [nome, token] of casos) {
      const r = await trocar(token, { senha_atual: f.credenciais.senha, nova_senha: NOVA });
      assert.equal(r.statusCode, 401, `${nome}: ${r.body}`);
    }
    const depois = await conta(f.usuario.id);
    assert.equal(depois.troca_senha_pendente, true);
    assert.equal(depois.sessao_epoca, null);
    assert.equal((await conta(antiga.usuario.id)).troca_senha_pendente, null, 'conta de outro tenant intacta');
  });
});

describe('S04-P2 conclusão da troca', () => {
  test('TP-06 senha temporária errada: 403, nada muda, o token continua servindo e a conta não trava', async () => {
    const f = await novaFazenda();
    const restrito = await tokenRestrito(f.credenciais);
    for (let i = 0; i < 3; i++) {
      const r = await trocar(restrito, { senha_atual: 'nao-e-a-temporaria', nova_senha: NOVA });
      assert.equal(r.statusCode, 403, r.body);
      assert.equal(r.json().code, 'USUARIO_SENHA_ATUAL_INVALIDA');
    }
    const meio = await conta(f.usuario.id);
    assert.equal(meio.troca_senha_pendente, true);
    assert.equal(meio.sessao_epoca, null);
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: f.cliente.id } }), 0);
    const ok = await trocar(restrito, { senha_atual: f.credenciais.senha, nova_senha: NOVA });
    assert.equal(ok.statusCode, 200, ok.body);
  });

  test('TP-07 validação: nova igual à temporária ou ao usuário, curta, campos extras ou faltando: 400 sem efeito', async () => {
    const f = await novaFazenda();
    const restrito = await tokenRestrito(f.credenciais);
    const casos = [
      { senha_atual: f.credenciais.senha, nova_senha: f.credenciais.senha },
      { senha_atual: f.credenciais.senha, nova_senha: f.usuario.login.toUpperCase() },
      { senha_atual: f.credenciais.senha, nova_senha: 'curta' },
      { senha_atual: f.credenciais.senha, nova_senha: NOVA, usuario_id: 'x' },
      { senha_atual: f.credenciais.senha, nova_senha: NOVA, cliente_id: f.cliente.id },
      { senha_atual: f.credenciais.senha, nova_senha: NOVA, papel_tenant: 'administrador' },
      { senha_atual: f.credenciais.senha },
      { nova_senha: NOVA },
    ];
    for (const payload of casos) {
      const r = await trocar(restrito, payload);
      assert.equal(r.statusCode, 400, `${JSON.stringify(Object.keys(payload))}: ${r.body}`);
      assert.equal(r.body.includes(f.credenciais.senha), false, 'resposta não ecoa senha');
    }
    assert.equal((await conta(f.usuario.id)).troca_senha_pendente, true);
  });

  test('TP-08 sucesso: atômico (senha + pendência + época + auditoria), sem sessão; replay 401; temporária 401; nova entra normal', async () => {
    const f = await novaFazenda();
    const antes = await conta(f.usuario.id);
    const restrito = await tokenRestrito(f.credenciais);
    const r = await trocar(restrito, { senha_atual: f.credenciais.senha, nova_senha: NOVA });
    assert.equal(r.statusCode, 200, r.body);
    assert.match(String(r.headers['cache-control']), /no-store/);
    assert.deepEqual(r.json(), { senha_alterada: true, novo_login_obrigatorio: true }, 'não emite sessão');

    const depois = await conta(f.usuario.id);
    assert.equal(depois.troca_senha_pendente, false);
    assert.notEqual(depois.senha_hash, antes.senha_hash);
    assert.equal(depois.sessao_epoca, 1, 'S04-P1: época da conta +1 no mesmo commit');
    const eventos = await prisma().auditLog.findMany({ where: { cliente_id: f.cliente.id, entidade: 'Usuario', entidade_id: f.usuario.id } });
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].usuario_id, f.usuario.id);
    assert.deepEqual(eventos[0].dados_novos, { troca_senha_pendente: false, sessoes_revogadas: true, origem: 'troca_senha_inicial' });
    assert.equal(JSON.stringify(eventos).includes(NOVA), false, 'auditoria sem a senha');
    assert.equal(JSON.stringify(eventos).includes(f.credenciais.senha), false);

    const replay = await trocar(restrito, { senha_atual: NOVA, nova_senha: 'Outra-Senha-Qualquer-1' });
    assert.equal(replay.statusCode, 401, 'o token restrito morreu com a época nova');
    assert.equal((await login(f.credenciais)).statusCode, 401, 'a senha temporária não entra mais');

    const novo = await login({ login: f.credenciais.login, senha: NOVA });
    assert.equal(novo.statusCode, 200);
    assert.deepEqual(Object.keys(novo.json()).sort(), ['cliente_id', 'token', 'usuario']);
    const ctx = await get('/auth/contexto', novo.json().token);
    assert.equal(ctx.statusCode, 200);
    assert.equal(ctx.json().administrador_fazenda, true, 'administrador REAL da fazenda depois da troca');
    const criada = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: bearer(novo.json().token),
      payload: { nome: 'Peão', login: 'peao.esperanca', senha: 'senha-do-peao-1' },
    });
    assert.equal(criada.statusCode, 201, criada.body);
  });

  test('TP-09 corrida com o mesmo token: exatamente uma conclusão grava; a outra 409/401; época +1 uma vez', async () => {
    const f = await novaFazenda();
    const restrito = await tokenRestrito(f.credenciais);
    const respostas = await Promise.all(
      ['Primeira-Senha-Boa-1', 'Segunda-Senha-Boa-2', 'Terceira-Senha-Boa-3'].map((nova_senha) =>
        trocar(restrito, { senha_atual: f.credenciais.senha, nova_senha })
      )
    );
    const status = respostas.map((x) => x.statusCode).sort();
    assert.equal(status.filter((s) => s === 200).length, 1, JSON.stringify(status));
    assert.ok(status.every((s) => s === 200 || s === 409 || s === 401), JSON.stringify(status));
    const vencedora = ['Primeira-Senha-Boa-1', 'Segunda-Senha-Boa-2', 'Terceira-Senha-Boa-3'][respostas.findIndex((x) => x.statusCode === 200)];
    const depois = await conta(f.usuario.id);
    assert.equal(depois.sessao_epoca, 1);
    assert.equal(depois.troca_senha_pendente, false);
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: f.cliente.id } }), 1);
    assert.equal((await login({ login: f.credenciais.login, senha: vencedora })).statusCode, 200, 'vale a senha de quem venceu');
  });

  test('TP-10 falha da auditoria: rollback integral (senha, pendência e época intactas); repetir depois conclui', async () => {
    const f = await novaFazenda();
    const antes = await conta(f.usuario.id);
    const restrito = await tokenRestrito(f.credenciais);
    const r = await comAuditoriaQuebrada(() => trocar(restrito, { senha_atual: f.credenciais.senha, nova_senha: NOVA }));
    assert.ok(r.statusCode >= 500, r.body);
    assert.equal(r.body.includes(NOVA), false);
    const meio = await conta(f.usuario.id);
    assert.equal(meio.senha_hash, antes.senha_hash);
    assert.equal(meio.troca_senha_pendente, true);
    assert.equal(meio.sessao_epoca, null);
    assert.equal((await login({ login: f.credenciais.login, senha: NOVA })).statusCode, 401, 'a senha nova não ficou gravada');
    const ok = await trocar(restrito, { senha_atual: f.credenciais.senha, nova_senha: NOVA });
    assert.equal(ok.statusCode, 200, ok.body);
  });

  test('TP-11 fazenda suspensa ou conta desativada: login temporário 401 e o token restrito já emitido também (S04-P1)', async () => {
    const f = await novaFazenda();
    const restrito = await tokenRestrito(f.credenciais);
    const etag = (await app.inject({ method: 'GET', url: `/admin-maike/clientes/${f.cliente.id}`, headers: f.adminHeaders })).headers.etag;
    const s = await app.inject({
      method: 'POST',
      url: `/admin-maike/clientes/${f.cliente.id}/situacao`,
      headers: { ...f.adminHeaders, 'if-match': etag },
      payload: { ativo: false, justificativa: 'teste de suspensão S04-P2' },
    });
    assert.equal(s.statusCode, 200, s.body);
    assert.equal((await trocar(restrito, { senha_atual: f.credenciais.senha, nova_senha: NOVA })).statusCode, 401);
    assert.equal((await login(f.credenciais)).statusCode, 401);

    const g = await novaFazenda('outra-fazenda', 'jose.outra', f.adminHeaders);
    const restritoG = await tokenRestrito(g.credenciais);
    await prisma().usuario.update({ where: { id: g.usuario.id }, data: { ativo: false } });
    assert.equal((await trocar(restritoG, { senha_atual: g.credenciais.senha, nova_senha: NOVA })).statusCode, 401);
    assert.equal((await conta(g.usuario.id)).troca_senha_pendente, true);
  });

  test('TP-12 a troca comum de senha (PATCH /usuarios) de contas normais não toca na pendência', async () => {
    const t = await criarTenant();
    const token = (await login(t.credenciais)).json().token;
    const r = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${t.usuario.id}`,
      headers: bearer(token),
      payload: { nova_senha: 'Outra-Senha-Comum-1', senha_atual: t.credenciais.senha },
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await conta(t.usuario.id)).troca_senha_pendente, null);
    assert.equal((await login({ login: t.credenciais.login, senha: 'Outra-Senha-Comum-1' })).statusCode, 200);
  });
});
