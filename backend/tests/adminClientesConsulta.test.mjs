/**
 * MAIKE-SAAS-ADMIN-S01 — consulta de clientes pelo MAIKE Admin (somente leitura).
 *
 * PostgreSQL local descartável. Prova:
 *  - só o proprietário com MFA verificado lê; JWT de fazenda (operador,
 *    administrador da fazenda, `Permissao.is_admin`), anônimo, pré-MFA e
 *    cookie revogado/forjado/expirado são recusados;
 *  - projeção mínima: sem `senha_hash`, `papel_tenant`, documentos/contatos de
 *    empresa nem permissões;
 *  - nada mistura dados de outro cliente; paginação keyset estável;
 *  - nenhuma requisição grava (fotografia das tabelas antes/depois).
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { criarSessaoAdmin } from '../src/modules/adminMaike/adminSessao.js';
import { criarProprietarioInicial } from '../src/modules/adminMaike/adminService.js';
import { codificarCursor } from '../src/shared/pagination/keysetCursor.js';
import {
  criarApp,
  criarTenant,
  limparBanco,
  encerrar,
  autenticarNoApp,
  criarAdminComSessao,
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

const get = (url, headers = {}) => app.inject({ method: 'GET', url, headers });
const PROIBIDOS = /senha_hash|papel_tenant|scrypt\$|cpf|cnpj|rg"|inscricao_estadual|telefone|email|endereco|permiss|modulos_permitidos|is_admin|token/i;

/** Dois clientes com usuários e empresas distintos. */
const cenario = async () => {
  const a = await criarTenant({ codigo: 'fazenda-alfa' });
  const b = await criarTenant({ codigo: 'fazenda-beta', papelTenant: 'administrador' });
  await prisma().usuario.create({
    data: { cliente_id: a.cliente.id, nome: 'Peão Alfa', login: 'peao-alfa', senha_hash: 'scrypt$x', ativo: false },
  });
  await prisma().empresa.create({
    data: {
      cliente_id: a.cliente.id,
      numero_empresa: 1,
      apelido: 'Sede Alfa',
      nome: 'Agropecuária Alfa Ltda',
      cpf: '111.111.111-11',
      cnpj: '11.111.111/0001-11',
      email: 'alfa@example.invalid',
      telefone: '(65) 99999-0000',
    },
  });
  await prisma().empresa.create({
    data: { cliente_id: b.cliente.id, numero_empresa: 1, apelido: 'Sede Beta', nome: 'Beta Pecuária' },
  });
  return { a, b };
};

/** Contagem de todas as tabelas que uma leitura poderia alterar. */
const fotografia = async () => {
  const db = prisma();
  const [clientes, usuarios, empresas, permissoes, auditoria, sessoesAdmin, eventosAdmin, admins] = await Promise.all([
    db.cliente.findMany({ orderBy: { id: 'asc' } }),
    db.usuario.findMany({ orderBy: { id: 'asc' } }),
    db.empresa.findMany({ orderBy: { id: 'asc' } }),
    db.permissao.findMany({ orderBy: { id: 'asc' } }),
    db.auditLog.count(),
    db.sessaoAdminMaike.findMany({ orderBy: { id: 'asc' }, select: { id: true, revogada_em: true, mfa_verificado: true, expira_em: true } }),
    db.eventoSegurancaAdminMaike.count(),
    db.adminPrincipalMaike.findMany({ orderBy: { id: 'asc' } }),
  ]);
  return JSON.stringify({ clientes, usuarios, empresas, permissoes, auditoria, sessoesAdmin, eventosAdmin, admins });
};

describe('autorização', () => {
  test('CLI-01 anônimo → 401; JWT de operador, de administrador da fazenda e de Permissao.is_admin → 403', async () => {
    const { a, b } = await cenario();
    const alvo = `/admin-maike/clientes/${a.cliente.id}`;
    for (const url of ['/admin-maike/clientes', alvo, `${alvo}/usuarios`, `${alvo}/empresas`]) {
      const anon = await get(url);
      assert.equal(anon.statusCode, 401, url);
      assert.equal(anon.json().code, 'ADMIN_SESSAO_REQUIRED');
    }
    // `a` tem Permissao.is_admin = true (helper); `b` é administrador da fazenda.
    for (const t of [a, b]) {
      const { corpo } = await autenticarNoApp(app, t.credenciais);
      assert.ok(corpo.token, 'login de fazenda funcionou');
      for (const url of ['/admin-maike/clientes', alvo, `${alvo}/usuarios`]) {
        const r = await get(url, { authorization: `Bearer ${corpo.token}` });
        assert.equal(r.statusCode, 403, url);
        assert.equal(r.json().code, 'ADMIN_PRINCIPAL_REQUIRED');
        assert.equal(r.body.includes('fazenda-'), false, 'nenhum dado vaza na recusa');
      }
    }
  });

  test('CLI-02 sessão pré-MFA → 403 MFA; cookie forjado, revogado e expirado → 401', async () => {
    await cenario();
    const admin = await criarProprietarioInicial({ login: 'dono.maike', senha: 'senha-forte-do-dono-1' });
    const pre = await criarSessaoAdmin(prisma(), { adminId: admin.id, mfaVerificado: false });
    const r1 = await get('/admin-maike/clientes', { cookie: `maike_admin=${pre.token}` });
    assert.equal(r1.statusCode, 403);
    assert.equal(r1.json().code, 'ADMIN_MFA_REQUIRED');

    const forjado = await get('/admin-maike/clientes', { cookie: 'maike_admin=nao-e-um-token-valido' });
    assert.equal(forjado.statusCode, 401);

    const revogada = await criarSessaoAdmin(prisma(), { adminId: admin.id, mfaVerificado: true });
    await prisma().sessaoAdminMaike.update({ where: { id: revogada.sessao.id }, data: { revogada_em: new Date() } });
    assert.equal((await get('/admin-maike/clientes', { cookie: `maike_admin=${revogada.token}` })).statusCode, 401);

    const expirada = await criarSessaoAdmin(prisma(), { adminId: admin.id, mfaVerificado: true });
    await prisma().sessaoAdminMaike.update({ where: { id: expirada.sessao.id }, data: { expira_em: new Date(Date.now() - 1000) } });
    assert.equal((await get('/admin-maike/clientes', { cookie: `maike_admin=${expirada.token}` })).statusCode, 401);
  });

  test('CLI-03 não existe exclusão, "entrar como cliente" nem escrita fora do contrato fechado da S03', async () => {
    const { a } = await cenario();
    const { headers } = await criarAdminComSessao(app);
    const alvo = `/admin-maike/clientes/${a.cliente.id}`;
    // S03 criou POST /clientes e PATCH /clientes/:id com contrato fechado: `ativo`
    // não é campo de nenhum deles (suspensão tem rota própria com justificativa).
    for (const [method, url] of [
      ['POST', '/admin-maike/clientes'],
      ['PATCH', alvo],
    ]) {
      const r = await app.inject({ method, url, headers: { ...headers, origin: ORIGEM_ADMIN }, payload: { nome: 'x', ativo: false } });
      assert.equal(r.statusCode, 400, `${method} ${url}`);
    }
    for (const [method, url] of [
      ['PUT', alvo],
      ['DELETE', alvo],
      ['POST', `${alvo}/entrar`],
      ['POST', `${alvo}/ativar`],
      ['POST', `${alvo}/usuarios`],
    ]) {
      const r = await app.inject({ method, url, headers: { ...headers, origin: ORIGEM_ADMIN }, payload: { nome: 'x', ativo: false } });
      assert.equal(r.statusCode, 404, `${method} ${url}`);
    }
    const c = await prisma().cliente.findUnique({ where: { id: a.cliente.id } });
    assert.equal(c.ativo, true);
    assert.equal(c.nome, a.cliente.nome);
  });
});

describe('lista e ficha', () => {
  test('CLI-04 proprietário com MFA lista clientes com contagens corretas e projeção mínima', async () => {
    const { a, b } = await cenario();
    const { headers } = await criarAdminComSessao(app);
    const r = await get('/admin-maike/clientes', headers);
    assert.equal(r.statusCode, 200);
    const corpo = r.json();
    assert.equal(corpo.total, 2);
    assert.equal(corpo.has_more, false);
    assert.equal(corpo.next_cursor, null);
    const porCodigo = Object.fromEntries(corpo.items.map((c) => [c.codigo, c]));
    assert.deepEqual(Object.keys(porCodigo['fazenda-alfa']).sort(), [
      'ativo',
      'codigo',
      'criado_em',
      'empresas_total',
      'id',
      'nome',
      'usuarios_total',
    ]);
    assert.equal(porCodigo['fazenda-alfa'].id, a.cliente.id);
    assert.equal(porCodigo['fazenda-alfa'].usuarios_total, 2);
    assert.equal(porCodigo['fazenda-alfa'].empresas_total, 1);
    assert.equal(porCodigo['fazenda-beta'].id, b.cliente.id);
    assert.equal(porCodigo['fazenda-beta'].usuarios_total, 1);
    assert.equal(r.body.match(PROIBIDOS), null);
  });

  test('CLI-05 busca por nome/código, filtro ativo e lista vazia', async () => {
    await cenario();
    await prisma().cliente.update({ where: { codigo: 'fazenda-beta' }, data: { ativo: false } });
    const { headers } = await criarAdminComSessao(app);
    const busca = (await get('/admin-maike/clientes?q=ALFA', headers)).json();
    assert.deepEqual(busca.items.map((c) => c.codigo), ['fazenda-alfa']);
    assert.equal(busca.total, 1);
    const porNome = (await get(`/admin-maike/clientes?q=${encodeURIComponent('Tenant fazenda-beta')}`, headers)).json();
    assert.deepEqual(porNome.items.map((c) => c.codigo), ['fazenda-beta']);
    const inativos = (await get('/admin-maike/clientes?ativo=false', headers)).json();
    assert.deepEqual(inativos.items.map((c) => c.codigo), ['fazenda-beta']);
    const vazio = (await get('/admin-maike/clientes?q=nao-existe-nada', headers)).json();
    assert.deepEqual(vazio, { items: [], next_cursor: null, has_more: false, total: 0, limit: 25 });
  });

  test('CLI-06 paginação keyset estável: sem repetição nem salto entre páginas', async () => {
    const db = prisma();
    const base = Date.UTC(2026, 0, 1);
    // Dois pares com o MESMO createdAt: o desempate por id não pode pular nem repetir.
    for (let i = 0; i < 7; i++) {
      await db.cliente.create({
        data: { codigo: `pag-${i}`, nome: `Paginado ${i}`, createdAt: new Date(base + Math.floor(i / 2) * 1000) },
      });
    }
    const { headers } = await criarAdminComSessao(app);
    const vistos = [];
    let cursor = null;
    let paginas = 0;
    do {
      const url = `/admin-maike/clientes?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const r = await get(url, headers);
      assert.equal(r.statusCode, 200, r.body);
      const corpo = r.json();
      assert.equal(corpo.total, paginas === 0 ? 7 : null, 'total só na 1ª página');
      vistos.push(...corpo.items.map((c) => c.codigo));
      cursor = corpo.next_cursor;
      paginas += 1;
    } while (cursor && paginas < 10);
    assert.equal(paginas, 3);
    assert.equal(vistos.length, 7);
    assert.equal(new Set(vistos).size, 7);
    const esperado = (await db.cliente.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })).map((c) => c.codigo);
    assert.deepEqual(vistos, esperado);
  });

  test('CLI-07 ficha do cliente: identidade, datas e contagens; não mistura outro cliente', async () => {
    const { a, b } = await cenario();
    const { headers } = await criarAdminComSessao(app);
    const r = await get(`/admin-maike/clientes/${a.cliente.id}`, headers);
    assert.equal(r.statusCode, 200);
    const corpo = r.json();
    assert.deepEqual(Object.keys(corpo.cliente).sort(), ['ativo', 'atualizado_em', 'codigo', 'criado_em', 'id', 'nome']);
    assert.equal(corpo.cliente.codigo, 'fazenda-alfa');
    assert.deepEqual(corpo.contagens, { usuarios: 2, usuarios_ativos: 1, empresas: 1 });
    assert.equal(r.body.match(PROIBIDOS), null);
    assert.equal(r.body.includes(b.cliente.id), false);

    const usuarios = (await get(`/admin-maike/clientes/${a.cliente.id}/usuarios`, headers)).json();
    assert.equal(usuarios.total, 2);
    assert.deepEqual(usuarios.items.map((u) => u.login).sort(), ['operador-fazenda-alfa', 'peao-alfa']);
    // S04-P3: + `revisao` opaca da conta (sem hash, senha, papel ou época crus).
    for (const u of usuarios.items) assert.deepEqual(Object.keys(u).sort(), ['ativo', 'criado_em', 'id', 'login', 'nome', 'revisao']);

    const empresas = await get(`/admin-maike/clientes/${a.cliente.id}/empresas`, headers);
    assert.equal(empresas.statusCode, 200);
    assert.deepEqual(empresas.json().items.map((e) => e.apelido), ['Sede Alfa']);
    for (const e of empresas.json().items) assert.deepEqual(Object.keys(e).sort(), ['apelido', 'criado_em', 'id', 'nome', 'numero_empresa']);
    assert.equal(empresas.body.match(PROIBIDOS), null, 'CPF, CNPJ, e-mail e telefone ficam de fora');

    const daBeta = (await get(`/admin-maike/clientes/${b.cliente.id}/usuarios`, headers)).json();
    assert.deepEqual(daBeta.items.map((u) => u.login), ['operador-fazenda-beta']);
  });

  test('CLI-08 cliente sem usuários nem empresas: ficha e listas vazias', async () => {
    const vazio = await prisma().cliente.create({ data: { codigo: 'sem-ninguem', nome: 'Sem Ninguém' } });
    const { headers } = await criarAdminComSessao(app);
    const ficha = (await get(`/admin-maike/clientes/${vazio.id}`, headers)).json();
    assert.deepEqual(ficha.contagens, { usuarios: 0, usuarios_ativos: 0, empresas: 0 });
    for (const sub of ['usuarios', 'empresas']) {
      const r = (await get(`/admin-maike/clientes/${vazio.id}/${sub}`, headers)).json();
      assert.deepEqual(r, { items: [], next_cursor: null, has_more: false, total: 0, limit: 25 });
    }
  });
});

describe('entradas inválidas', () => {
  test('CLI-09 id inexistente e malformado, cursor adulterado, limite acima do teto e parâmetro extra', async () => {
    const { a } = await cenario();
    const { headers } = await criarAdminComSessao(app);
    for (const url of ['/admin-maike/clientes/cl_nao_existe_000', '/admin-maike/clientes/cl_nao_existe_000/usuarios', '/admin-maike/clientes/cl_nao_existe_000/empresas']) {
      const r = await get(url, headers);
      assert.equal(r.statusCode, 422, url);
      assert.deepEqual(r.json().code, 'ADMIN_ENTRADA_INVALIDA');
      assert.equal(r.json().message, 'cliente não encontrado');
    }
    for (const url of [
      `/admin-maike/clientes/${encodeURIComponent("x' OR 1=1 --")}`,
      `/admin-maike/clientes/${'a'.repeat(65)}`,
      '/admin-maike/clientes?limit=51',
      '/admin-maike/clientes?limit=0',
      '/admin-maike/clientes?ativo=talvez',
      '/admin-maike/clientes?cliente_id=x',
      `/admin-maike/clientes/${a.cliente.id}?debug=1`,
      `/admin-maike/clientes/${a.cliente.id}/usuarios?q=x`,
    ]) {
      const r = await get(url, headers);
      assert.equal(r.statusCode, 400, url);
      assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED', url);
    }
    for (const cursor of ['nao-e-base64-json', Buffer.from('{"t":"ontem","i":"x"}').toString('base64url')]) {
      const r = await get(`/admin-maike/clientes?cursor=${encodeURIComponent(cursor)}`, headers);
      assert.equal(r.statusCode, 422);
      assert.equal(r.json().message, 'cursor inválido');
    }
    // Cursor bem-formado de OUTRO cliente só anda dentro do cliente pedido.
    const outro = codificarCursor({ createdAt: new Date(Date.now() + 60_000), id: 'zzzz' });
    const r = (await get(`/admin-maike/clientes/${a.cliente.id}/usuarios?cursor=${outro}`, headers)).json();
    assert.ok(r.items.every((u) => u.login.endsWith('alfa')));
  });

  test('CLI-10 nenhuma requisição grava: tabelas iguais antes e depois de todas as leituras', async () => {
    const { a } = await cenario();
    const { headers } = await criarAdminComSessao(app);
    const { corpo } = await autenticarNoApp(app, a.credenciais);
    const antes = await fotografia();
    const alvo = `/admin-maike/clientes/${a.cliente.id}`;
    for (const url of [
      '/admin-maike/clientes',
      '/admin-maike/clientes?q=alfa&ativo=true&limit=1',
      alvo,
      `${alvo}/usuarios`,
      `${alvo}/empresas`,
      '/admin-maike/clientes/cl_nao_existe_000',
      '/admin-maike/clientes?limit=999',
    ]) {
      await get(url, headers);
      await get(url);
      await get(url, { authorization: `Bearer ${corpo.token}` });
    }
    // `ultimo_uso_em` da sessão admin pode avançar (guarda pré-existente, no máx.
    // 1×/min) — fica fora da fotografia de propósito.
    assert.equal(await fotografia(), antes);
  });
});
