/**
 * PR145-R4 (D-PROD-71) — autoridade de administrador da FAZENDA (tenant).
 *
 * Antes desta rodada, qualquer JWT do tenant podia trocar a senha de outro
 * usuário, criar contas e gravar a própria `Permissao.is_admin = true`; e um
 * `cliente_id` no corpo de PATCH movia registros para outro tenant. PostgreSQL
 * real; fixture de administrador SÓ pelo banco (`papelTenant`).
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp, ORIGEM_ADMIN } from './helpers.mjs';

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

const auth = (t) => ({ authorization: `Bearer ${t}` });
const req = (method, url, token, payload) => app.inject({ method, url, headers: auth(token), payload });
const login = (credenciais) => app.inject({ method: 'POST', url: '/auth/login', payload: credenciais });

/** Fazenda com um administrador (fixture de banco) e um usuário comum criado por ele. */
const fazenda = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tokAdm = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const comumCred = { login: `comum-${adm.cliente.codigo}`, senha: 'senha-do-comum-1' };
  const criado = await req('POST', '/usuarios', tokAdm, { nome: 'Peão', ...comumCred });
  assert.equal(criado.statusCode, 201, criado.body);
  const tokComum = (await autenticarNoApp(app, comumCred)).corpo.token;
  return { adm, tokAdm, comum: { id: criado.json().id, credenciais: comumCred }, tokComum };
};

describe('usuário comum NÃO administra a fazenda', () => {
  test('U-01 comum troca senha de outro usuário → 403, hash intacto, vítima entra com a senha original', async () => {
    const f = await fazenda();
    const hashAntes = (await prisma().usuario.findUnique({ where: { id: f.adm.usuario.id } })).senha_hash;
    const r = await req('PATCH', `/usuarios/${f.adm.usuario.id}`, f.tokComum, { nova_senha: 'injetada-pelo-comum-1' });
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().code, 'TENANT_ADMIN_REQUIRED');
    assert.equal((await prisma().usuario.findUnique({ where: { id: f.adm.usuario.id } })).senha_hash, hashAntes);
    assert.equal((await login(f.adm.credenciais)).statusCode, 200);
    assert.equal((await login({ login: f.adm.credenciais.login, senha: 'injetada-pelo-comum-1' })).statusCode, 401);
    for (const payload of [{ nome: 'Hackeado' }, { ativo: false }]) {
      assert.equal((await req('PATCH', `/usuarios/${f.adm.usuario.id}`, f.tokComum, payload)).statusCode, 403);
    }
    // id inexistente/alheio para o comum também é 403 (sem consulta, nada revelado).
    assert.equal((await req('PATCH', '/usuarios/nao-existe', f.tokComum, { nome: 'x' })).statusCode, 403);
  });

  test('U-02 comum não cria conta nem escreve Permissao (não se autoeleva)', async () => {
    const f = await fazenda();
    const antes = await prisma().usuario.count();
    const c = await req('POST', '/usuarios', f.tokComum, { nome: 'Novo', login: 'novo-x', senha: 'senha-nova-123' });
    assert.equal(c.statusCode, 403);
    assert.equal(await prisma().usuario.count(), antes);

    const auto = await req('POST', '/permissoes', f.tokComum, { user_email: f.comum.credenciais.login, is_admin: true });
    assert.equal(auto.statusCode, 403);
    assert.equal(await prisma().permissao.count(), 0);

    const p = await req('POST', '/permissoes', f.tokAdm, { user_email: f.comum.credenciais.login, is_admin: false });
    assert.equal(p.statusCode, 201);
    const patch = await req('PATCH', `/permissoes/${p.json().id}`, f.tokComum, { is_admin: true });
    assert.equal(patch.statusCode, 403);
    assert.equal((await req('DELETE', `/permissoes/${p.json().id}`, f.tokComum)).statusCode, 403);
    assert.equal((await prisma().permissao.findUnique({ where: { id: p.json().id } })).is_admin, false);
  });

  test('U-03 is_admin=true só na Permissao NÃO é autoridade sem papel server-owned', async () => {
    const t = await criarTenant();
    await prisma().permissao.create({ data: { cliente_id: t.cliente.id, user_email: t.usuario.login, is_admin: true } });
    const tok = (await autenticarNoApp(app, t.credenciais)).corpo.token;
    assert.equal((await req('POST', '/usuarios', tok, { nome: 'X', login: 'x-y', senha: 'senha-nova-123' })).statusCode, 403);
    assert.equal((await req('POST', '/permissoes', tok, { user_email: 'x@y' })).statusCode, 403);
  });

  test('U-04 o papel não é gravável por HTTP (corpo com papel_tenant é recusado)', async () => {
    const f = await fazenda();
    const r1 = await req('POST', '/usuarios', f.tokAdm, { nome: 'X', login: 'x-z', senha: 'senha-nova-123', papel_tenant: 'administrador' });
    assert.equal(r1.statusCode, 400);
    const r2 = await req('PATCH', `/usuarios/${f.comum.id}`, f.tokAdm, { papel_tenant: 'administrador' });
    assert.equal(r2.statusCode, 400);
    const r3 = await req('PATCH', `/usuarios/${f.comum.id}`, f.tokComum, { papel_tenant: 'administrador' });
    assert.equal(r3.statusCode, 400);
    assert.equal((await prisma().usuario.findUnique({ where: { id: f.comum.id } })).papel_tenant, 'usuario');
  });
});

describe('administrador da fazenda (provisionado pelo caminho confiável)', () => {
  test('U-05 gerencia usuários e permissões do PRÓPRIO tenant; conta nova nasce comum', async () => {
    const f = await fazenda();
    assert.equal((await prisma().usuario.findUnique({ where: { id: f.comum.id } })).papel_tenant, 'usuario');
    const r = await req('PATCH', `/usuarios/${f.comum.id}`, f.tokAdm, { nome: 'Peão Chefe', nova_senha: 'senha-redefinida-1' });
    assert.equal(r.statusCode, 200);
    assert.equal((await login({ login: f.comum.credenciais.login, senha: 'senha-redefinida-1' })).statusCode, 200);
    const p = await req('POST', '/permissoes', f.tokAdm, { user_email: f.comum.credenciais.login, modulos_permitidos: ['mapa'] });
    assert.equal(p.statusCode, 201);
    assert.equal((await req('PATCH', `/permissoes/${p.json().id}`, f.tokAdm, { modulos_permitidos: ['mapa', 'lotes'] })).statusCode, 200);
    assert.equal((await req('DELETE', `/permissoes/${p.json().id}`, f.tokAdm)).statusCode, 204);
    const lista = (await req('GET', '/usuarios', f.tokAdm)).json();
    assert.ok(lista.every((u) => 'papel_tenant' in u));
    const audit = await prisma().auditLog.findMany({ where: { entidade: 'Usuario', entidade_id: f.comum.id } });
    assert.ok(audit.length >= 2);
    assert.equal(JSON.stringify(audit).includes('senha-redefinida-1'), false, 'auditoria sem segredo');
    assert.equal(JSON.stringify(audit).includes('senha_hash'), false);
  });

  test('U-06 não alcança outro tenant (404 sem revelar) nem o MAIKE Admin (403)', async () => {
    const a = await fazenda();
    const b = await fazenda();
    assert.equal((await req('PATCH', `/usuarios/${b.comum.id}`, a.tokAdm, { nova_senha: 'cruzada-123456' })).statusCode, 404);
    const pb = await req('POST', '/permissoes', b.tokAdm, { user_email: 'alguem@b' });
    assert.equal((await req('PATCH', `/permissoes/${pb.json().id}`, a.tokAdm, { is_admin: true })).statusCode, 404);
    assert.equal((await req('DELETE', `/permissoes/${pb.json().id}`, a.tokAdm)).statusCode, 404);
    assert.equal((await login(b.comum.credenciais)).statusCode, 200);
    for (const [m, u] of [['GET', '/admin-maike/catalogo'], ['POST', '/catalogo-global/admin/tipos']]) {
      const r = await app.inject({ method: m, url: u, headers: { ...auth(a.tokAdm), origin: ORIGEM_ADMIN }, payload: m === 'POST' ? { codigo: 'lote', nome: 'Lote' } : undefined });
      assert.equal(r.statusCode, 403, u);
    }
  });

  test('U-07 papel revogado ou conta desativada: JWT antigo perde o poder na hora', async () => {
    const f = await fazenda();
    await prisma().usuario.update({ where: { id: f.adm.usuario.id }, data: { papel_tenant: 'usuario' } });
    assert.equal((await req('POST', '/usuarios', f.tokAdm, { nome: 'X', login: 'x-w', senha: 'senha-nova-123' })).statusCode, 403);
    assert.equal((await req('PATCH', `/usuarios/${f.comum.id}`, f.tokAdm, { nova_senha: 'nova-senha-123' })).statusCode, 403);
    await prisma().usuario.update({ where: { id: f.adm.usuario.id }, data: { papel_tenant: 'administrador', ativo: false } });
    assert.equal((await req('POST', '/permissoes', f.tokAdm, { user_email: 'z@z' })).statusCode, 403);
    const propria = await req('PATCH', `/usuarios/${f.adm.usuario.id}`, f.tokAdm, { nova_senha: 'nova-senha-123', senha_atual: f.adm.credenciais.senha });
    assert.equal(propria.statusCode, 403);
    assert.equal(propria.json().code, 'USUARIO_INATIVO');
  });
});

describe('própria conta e tenant no corpo', () => {
  test('U-08 trocar a própria senha exige a senha atual correta', async () => {
    const f = await fazenda();
    const url = `/usuarios/${f.comum.id}`;
    const sem = await req('PATCH', url, f.tokComum, { nova_senha: 'propria-nova-1' });
    assert.equal(sem.statusCode, 403);
    assert.equal(sem.json().code, 'USUARIO_SENHA_ATUAL_INVALIDA');
    assert.equal((await req('PATCH', url, f.tokComum, { nova_senha: 'propria-nova-1', senha_atual: 'errada-errada' })).statusCode, 403);
    assert.equal((await req('PATCH', url, f.tokComum, { nome: 'Peão Renomeado' })).statusCode, 200, 'nome próprio sem senha');
    const ok = await req('PATCH', url, f.tokComum, { nova_senha: 'propria-nova-1', senha_atual: f.comum.credenciais.senha });
    assert.equal(ok.statusCode, 200);
    assert.equal((await login({ login: f.comum.credenciais.login, senha: 'propria-nova-1' })).statusCode, 200);
    const desativar = await req('PATCH', url, f.tokComum, { ativo: false });
    assert.equal(desativar.json().code, 'USUARIO_SELF_DEACTIVATE', 'não se desativa');
  });

  test('U-09 cliente_id no corpo é recusado (não move registro para outro tenant)', async () => {
    const a = await fazenda();
    const b = await fazenda();
    const p = await req('POST', '/permissoes', a.tokAdm, { user_email: 'x@a' });
    const casos = [
      ['PATCH', `/permissoes/${p.json().id}`, { cliente_id: b.adm.cliente.id }],
      ['POST', '/permissoes', { user_email: 'y@a', cliente_id: b.adm.cliente.id }],
      ['POST', '/usuarios', { nome: 'X', login: 'x-q', senha: 'senha-nova-123', cliente_id: b.adm.cliente.id }],
      ['POST', '/categorias-manejo', { empresa_id: 'e', nome: 'C', cliente_id: b.adm.cliente.id }],
    ];
    for (const [m, u, payload] of casos) {
      const r = await req(m, u, a.tokAdm, payload);
      assert.equal(r.statusCode, 400, `${m} ${u}`);
      assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED');
    }
    assert.equal((await prisma().permissao.findUnique({ where: { id: p.json().id } })).cliente_id, a.adm.cliente.id);
    assert.equal(await prisma().permissao.count({ where: { cliente_id: b.adm.cliente.id } }), 0);
  });

  test('U-10 leitura do comum: própria Permissao inteira; das outras só o nome; sem papel dos colegas', async () => {
    const f = await fazenda();
    await req('POST', '/permissoes', f.tokAdm, { user_email: f.comum.credenciais.login, user_nome: 'Peão', modulos_permitidos: ['mapa'] });
    await req('POST', '/permissoes', f.tokAdm, { user_email: f.adm.credenciais.login, user_nome: 'Dono da fazenda', is_admin: true });
    const lista = (await req('GET', '/permissoes', f.tokComum)).json();
    const propria = lista.find((x) => x.user_email === f.comum.credenciais.login);
    const outra = lista.find((x) => x.user_email === f.adm.credenciais.login);
    assert.deepEqual(propria.modulos_permitidos, ['mapa']);
    assert.deepEqual(Object.keys(outra).sort(), ['id', 'user_email', 'user_nome']);
    const usuarios = (await req('GET', '/usuarios', f.tokComum)).json();
    assert.ok(usuarios.length >= 2 && usuarios.every((u) => !('papel_tenant' in u)));
    assert.ok((await req('GET', '/permissoes', f.tokAdm)).json().every((x) => 'is_admin' in x));
  });
});
