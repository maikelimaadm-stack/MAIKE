/**
 * Curvas de Ganho de Peso da fazenda (D-PROD-189), tabela física
 * "CADCURVAGANHO" — PostgreSQL real.
 *
 * Cadastro novo, sem vínculo com nenhum outro: nome em MAIÚSCULAS e único por
 * fazenda (tamanho conferido depois das maiúsculas), três GMD obrigatórios de
 * -2 a 3 kg/dia com no máximo 3 casas, gravados como decimal exato, isolamento
 * por tenant e por fazenda, exclusão física com auditoria, permissão pela
 * própria tela `pec-curvas-ganho` (leitura incluída), CHECK e RLS no banco e a
 * fazenda com curva não sai (409 `EMPRESA_COM_VINCULOS` + FK Restrict).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

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

const CAMPOS_PUBLICOS = [
  'ativo', 'created_date', 'empresa_id', 'gmd_aguas', 'gmd_seca', 'gmd_transicao', 'id', 'nome', 'observacoes', 'updated_date',
];

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });

const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
const linha = (tela, a) => ({ modulo_id: 'manejo', tela_id: tela, ...acoes(false), ...a });

/** Tenant administrador com duas fazendas. */
const cenario = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e1 = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', nome: `Fazenda 1 ${c}` } });
  const e2 = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 2, apelido: 'E2', nome: `Fazenda 2 ${c}` } });
  const { corpo } = await autenticarNoApp(app, adm.credenciais);
  assert.ok(corpo.token, 'login');
  return { token: corpo.token, clienteId: c, e1, e2, adm };
};

/** Conta comum do mesmo tenant com as linhas de permissão dadas. */
const contaCom = async (cen, permissoes_telas) => {
  const senha = cen.adm.credenciais.senha;
  const hash = (await prisma().usuario.findUnique({ where: { id: cen.adm.usuario.id } })).senha_hash;
  const login = `op-${randomUUID().slice(0, 8)}`;
  await prisma().usuario.create({ data: { cliente_id: cen.clienteId, nome: 'Op', login, senha_hash: hash, papel_tenant: 'usuario' } });
  await prisma().permissao.create({ data: { cliente_id: cen.clienteId, user_email: login, user_nome: 'Op', modulos_permitidos: ['manejo'], permissoes_telas } });
  const { corpo } = await autenticarNoApp(app, { login, senha });
  assert.ok(corpo.token, 'login da conta comum');
  return corpo.token;
};

const base = (empresaId, extra = {}) => ({
  empresa_id: empresaId,
  nome: 'recria pasto',
  gmd_aguas: 0.65,
  gmd_transicao: 0.4,
  gmd_seca: 0.2,
  ...extra,
});

const criar = (token, payload) => req('POST', '/curvas-ganho', token, payload);
const comEmpresa = (url, empresaId) => `${url}?empresa_id=${encodeURIComponent(empresaId)}`;

describe('D-PROD-189 — Curvas de Ganho: criação, leitura e formato público', () => {
  test('GET /curvas-ganho sem token → 401', async () => {
    assert.equal((await req('GET', '/curvas-ganho?empresa_id=x')).statusCode, 401);
  });

  test('POST cria (201): nome e observações em MAIÚSCULAS, GMD como número, decimal exato no banco, chaves exatas; GET lista e detalha', async () => {
    const { token, clienteId, e1 } = await cenario();
    const r = await criar(token, base(e1.id, { observacoes: 'proteinado na seca', gmd_seca: -0.15 }));
    assert.equal(r.statusCode, 201, r.body);
    const c = r.json();
    assert.deepEqual(Object.keys(c).sort(), CAMPOS_PUBLICOS);
    assert.equal(c.nome, 'RECRIA PASTO');
    assert.equal(c.observacoes, 'PROTEINADO NA SECA');
    assert.equal(c.gmd_aguas, 0.65);
    assert.equal(c.gmd_transicao, 0.4);
    assert.equal(c.gmd_seca, -0.15, 'perda de peso na seca é aceita');
    assert.equal(c.ativo, true);
    assert.equal(c.empresa_id, e1.id);

    const banco = await prisma().cadCurvaGanho.findUnique({ where: { id: c.id } });
    assert.equal(banco.cliente_id, clienteId, 'tenant gravado a partir da sessão');
    assert.equal(banco.gmd_aguas.toString(), '0.65', 'decimal exato, sem ruído de ponto flutuante');

    const lista = await req('GET', comEmpresa('/curvas-ganho', e1.id), token);
    assert.equal(lista.statusCode, 200, lista.body);
    assert.equal(lista.json().length, 1);
    assert.deepEqual(Object.keys(lista.json()[0]).sort(), CAMPOS_PUBLICOS);
    const um = await req('GET', comEmpresa(`/curvas-ganho/${c.id}`, e1.id), token);
    assert.equal(um.statusCode, 200, um.body);
    assert.equal(um.json().gmd_seca, -0.15);
  });

  test('lista por fazenda, em ordem de nome; outra fazenda não enxerga; mesmo nome em outra fazenda é aceito e na mesma → 409', async () => {
    const { token, e1, e2 } = await cenario();
    assert.equal((await criar(token, base(e1.id, { nome: 'engorda' }))).statusCode, 201);
    assert.equal((await criar(token, base(e1.id, { nome: 'cria' }))).statusCode, 201);
    assert.deepEqual((await req('GET', comEmpresa('/curvas-ganho', e1.id), token)).json().map((x) => x.nome), ['CRIA', 'ENGORDA']);
    assert.equal((await req('GET', comEmpresa('/curvas-ganho', e2.id), token)).json().length, 0);
    assert.equal((await criar(token, base(e2.id, { nome: 'cria' }))).statusCode, 201, 'outra fazenda');
    const dup = await criar(token, base(e1.id, { nome: 'CRIA' }));
    assert.equal(dup.statusCode, 409, dup.body);
    assert.equal(dup.json().code, 'CURVA_GANHO_NAME_CONFLICT');
  });
});

describe('D-PROD-189 — Curvas de Ganho: validação do corpo', () => {
  test('obrigatórios na criação: empresa_id, nome e os três GMD → 400; chave fora do schema (cliente_id, categoria) → 400', async () => {
    const { token, clienteId, e1 } = await cenario();
    for (const campo of ['empresa_id', 'nome', 'gmd_aguas', 'gmd_transicao', 'gmd_seca']) {
      const corpo = base(e1.id);
      delete corpo[campo];
      assert.equal((await criar(token, corpo)).statusCode, 400, campo);
    }
    for (const extra of [{ cliente_id: clienteId }, { categoria_manejo_id: 'x' }, { gmd_janeiro: 0.5 }]) {
      assert.equal((await criar(token, base(e1.id, extra))).statusCode, 400, JSON.stringify(extra));
    }
    assert.equal(await prisma().cadCurvaGanho.count(), 0);
  });

  test('GMD: fora de -2..3, mais de 3 casas ou não número → 400 com o motivo; extremos e 3 casas aceitos', async () => {
    const { token, e1 } = await cenario();
    const ruins = [
      [{ gmd_aguas: 3.001 }, null],
      [{ gmd_seca: -2.5 }, null],
      [{ gmd_transicao: 0.4567 }, 'gmd_casas_decimais'],
      [{ gmd_aguas: 'muito' }, 'gmd_invalido'],
      [{ gmd_aguas: null }, 'gmd_invalido'],
      [{ gmd_aguas: '0.5' }, 'gmd_invalido'],
      [{ gmd_seca: true }, 'gmd_invalido'],
    ];
    for (const [extra, motivo] of ruins) {
      const r = await criar(token, base(e1.id, extra));
      assert.equal(r.statusCode, 400, `${JSON.stringify(extra)}: ${r.body}`);
      if (motivo) assert.equal(r.json().reason, motivo);
    }
    assert.equal(await prisma().cadCurvaGanho.count(), 0);
    const ok = await criar(token, base(e1.id, { gmd_aguas: 3, gmd_transicao: 0.125, gmd_seca: -2 }));
    assert.equal(ok.statusCode, 201, ok.body);
    assert.deepEqual([ok.json().gmd_aguas, ok.json().gmd_transicao, ok.json().gmd_seca], [3, 0.125, -2]);
  });

  test('texto que cresce ao virar maiúsculo (ß → SS) e passa da coluna → 400 tamanho_excedido, nunca 500', async () => {
    const { token, e1 } = await cenario();
    const r = await criar(token, base(e1.id, { nome: 'ß'.repeat(61) }));
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().reason, 'tamanho_excedido');
    assert.equal((await criar(token, base(e1.id, { observacoes: 'ß'.repeat(1001) }))).statusCode, 400);
  });

  test('corrida: duas criações simultâneas com o mesmo nome → uma 201 e uma 409, nunca 500', async () => {
    const { token, e1 } = await cenario();
    const [r1, r2] = await Promise.all([criar(token, base(e1.id, { nome: 'X' })), criar(token, base(e1.id, { nome: 'X' }))]);
    assert.deepEqual([r1.statusCode, r2.statusCode].sort(), [201, 409], `${r1.body} | ${r2.body}`);
  });
});

describe('D-PROD-189 — Curvas de Ganho: edição, exclusão e escopo', () => {
  test('PATCH altera só o enviado (um GMD, nome, ativo, observações null); sem empresa_id ou só empresa_id → 400', async () => {
    const { token, e1 } = await cenario();
    const c = (await criar(token, base(e1.id, { observacoes: 'x' }))).json();
    const r = await req('PATCH', `/curvas-ganho/${c.id}`, token, { empresa_id: e1.id, gmd_seca: 0.05, nome: 'recria 2', ativo: false, observacoes: null });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual([r.json().gmd_aguas, r.json().gmd_transicao, r.json().gmd_seca], [0.65, 0.4, 0.05]);
    assert.equal(r.json().nome, 'RECRIA 2');
    assert.equal(r.json().ativo, false);
    assert.equal(r.json().observacoes, null);
    // A coerção padrão do AJV transformaria null em 0: a rota recusa antes.
    const nulo = await req('PATCH', `/curvas-ganho/${c.id}`, token, { empresa_id: e1.id, gmd_seca: null });
    assert.equal(nulo.statusCode, 400, nulo.body);
    assert.equal(nulo.json().reason, 'gmd_invalido');
    assert.equal((await prisma().cadCurvaGanho.findUnique({ where: { id: c.id } })).gmd_seca.toString(), '0.05', 'nada mudou');
    assert.equal((await req('PATCH', `/curvas-ganho/${c.id}`, token, { nome: 'Z' })).statusCode, 400, 'sem empresa_id');
    assert.equal((await req('PATCH', `/curvas-ganho/${c.id}`, token, { empresa_id: e1.id })).statusCode, 400, 'nada para alterar');
  });

  test('PATCH e DELETE pela fazenda errada → 404 e nada muda; DELETE apaga (204); auditoria create/update/delete', async () => {
    const { token, clienteId, e1, e2 } = await cenario();
    const c = (await criar(token, base(e1.id))).json();
    assert.equal((await req('PATCH', `/curvas-ganho/${c.id}`, token, { empresa_id: e2.id, nome: 'movida' })).statusCode, 404);
    assert.equal((await req('DELETE', comEmpresa(`/curvas-ganho/${c.id}`, e2.id), token)).statusCode, 404);
    await req('PATCH', `/curvas-ganho/${c.id}`, token, { empresa_id: e1.id, gmd_aguas: 0.7 });
    assert.equal((await prisma().cadCurvaGanho.findUnique({ where: { id: c.id } })).empresa_id, e1.id);
    const r = await req('DELETE', comEmpresa(`/curvas-ganho/${c.id}`, e1.id), token);
    assert.equal(r.statusCode, 204, r.body);
    assert.equal((await req('GET', comEmpresa(`/curvas-ganho/${c.id}`, e1.id), token)).statusCode, 404);
    const eventos = await prisma().auditLog.findMany({ where: { cliente_id: clienteId, entidade: 'CadCurvaGanho' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(eventos.map((x) => x.acao), ['create', 'update', 'delete']);
  });

  test('fazenda de outro tenant ou inexistente → 404 EMPRESA_NOT_FOUND; tenant B não vê nem altera curva de A', async () => {
    const A = await cenario();
    const B = await cenario();
    const c = (await criar(A.token, base(A.e1.id))).json();
    const naFazendaDeA = await criar(B.token, base(A.e1.id));
    assert.equal(naFazendaDeA.statusCode, 404, naFazendaDeA.body);
    assert.equal(naFazendaDeA.json().code, 'EMPRESA_NOT_FOUND');
    assert.equal((await req('GET', comEmpresa(`/curvas-ganho/${c.id}`, B.e1.id), B.token)).statusCode, 404);
    assert.equal((await req('PATCH', `/curvas-ganho/${c.id}`, B.token, { empresa_id: B.e1.id, nome: 'x' })).statusCode, 404);
    assert.equal((await req('DELETE', comEmpresa(`/curvas-ganho/${c.id}`, B.e1.id), B.token)).statusCode, 404);
    assert.equal((await criar(A.token, base('nao-existe'))).statusCode, 404);
  });

  test('excluir a fazenda que tem curva → 409 EMPRESA_COM_VINCULOS (e a FK Restrict segura no banco)', async () => {
    const { token, e1 } = await cenario();
    assert.equal((await criar(token, base(e1.id))).statusCode, 201);
    const r = await req('DELETE', `/empresas/${e1.id}`, token);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'EMPRESA_COM_VINCULOS');
    await assert.rejects(prisma().empresa.delete({ where: { id: e1.id } }));
  });
});

describe('D-PROD-189 — Curvas de Ganho: permissão da tela pec-curvas-ganho', () => {
  test('sem a tela (só pec-estacoes) → 403 na leitura e na escrita, nada gravado', async () => {
    const cen = await cenario();
    const token = await contaCom(cen, [linha('pec-estacoes', { visualizar: true, novo: true, salvar: true, editar: true, excluir: true })]);
    const ler = await req('GET', comEmpresa('/curvas-ganho', cen.e1.id), token);
    assert.equal(ler.statusCode, 403, ler.body);
    assert.equal(ler.json().code, 'ACAO_NAO_PERMITIDA');
    assert.equal((await criar(token, base(cen.e1.id))).statusCode, 403);
    assert.equal(await prisma().cadCurvaGanho.count(), 0);
  });

  test('só "visualizar" lê (200) e não cria (403); "novo" cria (201) e não exclui; "excluir" exclui', async () => {
    const cen = await cenario();
    const ver = await contaCom(cen, [linha('pec-curvas-ganho', { visualizar: true })]);
    assert.equal((await req('GET', comEmpresa('/curvas-ganho', cen.e1.id), ver)).statusCode, 200);
    assert.equal((await criar(ver, base(cen.e1.id))).statusCode, 403);
    const novo = await contaCom(cen, [linha('pec-curvas-ganho', { visualizar: true, novo: true })]);
    const criada = await criar(novo, base(cen.e1.id));
    assert.equal(criada.statusCode, 201, criada.body);
    assert.equal((await req('DELETE', comEmpresa(`/curvas-ganho/${criada.json().id}`, cen.e1.id), novo)).statusCode, 403);
    const exc = await contaCom(cen, [linha('pec-curvas-ganho', { visualizar: true, excluir: true })]);
    assert.equal((await req('DELETE', comEmpresa(`/curvas-ganho/${criada.json().id}`, cen.e1.id), exc)).statusCode, 204);
  });
});

describe('D-PROD-189 — CADCURVAGANHO no banco: nome físico, CHECK e RLS', () => {
  test('a tabela física chama "CADCURVAGANHO", tem RLS ligado e o CHECK da faixa do GMD barra escrita direta', async () => {
    const { clienteId, e1 } = await cenario();
    const [tabela] = await prisma().$queryRaw`SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'CADCURVAGANHO' AND relkind = 'r'`;
    assert.ok(tabela, 'tabela "CADCURVAGANHO" existe');
    assert.equal(tabela.relrowsecurity, true, 'RLS ligado');
    const dados = { cliente_id: clienteId, empresa_id: e1.id, nome: 'X', gmd_aguas: '0.5', gmd_transicao: '0.5', gmd_seca: '0.5' };
    await assert.rejects(prisma().cadCurvaGanho.create({ data: { ...dados, gmd_seca: '3.5' } }), /CADCURVAGANHO_gmd_check|check constraint/i);
    await assert.rejects(prisma().cadCurvaGanho.create({ data: { ...dados, gmd_aguas: '-2.001' } }), /CADCURVAGANHO_gmd_check|check constraint/i);
    assert.equal(await prisma().cadCurvaGanho.count(), 0);
  });
});
