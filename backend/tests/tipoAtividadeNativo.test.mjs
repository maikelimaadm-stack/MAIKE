/**
 * TipoAtividade nativo (D-PROD-180) — PostgreSQL real.
 *
 * Cadastro novo, irmão do Tipo de Tarefa: nome em MAIÚSCULAS e único por
 * (cliente, grupo), cache do nome do grupo, isolamento por tenant, exclusão
 * física, grupo com tipo vinculado não sai (409 + FK Restrict) e nenhuma chave
 * legada (exige_area/pode_ter_*) é aceita: entidade nova não tem cliente antigo.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

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
  'ativo', 'created_date', 'descricao', 'grupo_atividade_id', 'grupo_atividade_nome',
  'id', 'nome_tipo', 'updated_date',
];

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });

const tenantAutenticado = async (opcoes) => {
  const { cliente, credenciais } = await criarTenant(opcoes);
  const { corpo } = await autenticarNoApp(app, credenciais);
  assert.ok(corpo.token, 'login');
  return { token: corpo.token, clienteId: cliente.id };
};

const criarGrupo = async (token, nome) => {
  const r = await req('POST', '/grupos-atividade', token, { nome_grupo: nome });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

const criarTipo = (token, payload) => req('POST', '/tipos-atividade', token, payload);

describe('D-PROD-180 — TipoAtividade: criação e conflitos', () => {
  test('GET /tipos-atividade sem token → 401', async () => {
    const r = await req('GET', '/tipos-atividade');
    assert.equal(r.statusCode, 401);
  });

  test('POST cria (201): nome em MAIÚSCULAS, cache do nome do grupo, conjunto exato de chaves públicas', async () => {
    const { token, clienteId } = await tenantAutenticado();
    const g = await criarGrupo(token, 'operacional');

    const r = await criarTipo(token, { nome_tipo: 'roçada manual', grupo_atividade_id: g.id, descricao: 'com foice' });
    assert.equal(r.statusCode, 201, r.body);
    const t = r.json();
    assert.deepEqual(Object.keys(t).sort(), CAMPOS_PUBLICOS);
    assert.equal(t.nome_tipo, 'ROÇADA MANUAL');
    assert.equal(t.grupo_atividade_id, g.id);
    assert.equal(t.grupo_atividade_nome, 'OPERACIONAL');
    assert.equal(t.ativo, true, 'ativo por padrão');
    assert.equal(t.descricao, 'com foice');

    const lista = await req('GET', '/tipos-atividade', token);
    assert.equal(lista.statusCode, 200, lista.body);
    assert.equal(lista.json().length, 1);
    assert.deepEqual(Object.keys(lista.json()[0]).sort(), CAMPOS_PUBLICOS);

    const linha = await prisma().tipoAtividade.findUnique({ where: { id: t.id } });
    assert.equal(linha.cliente_id, clienteId, 'tenant vem do auth_context');

    const audit = await prisma().auditLog.findMany({ where: { cliente_id: clienteId, entidade: 'TipoAtividade' } });
    assert.equal(audit.length, 1, 'criação auditada');
  });

  test('nome duplicado no mesmo grupo (caixa diferente) → 409 TIPO_ATIVIDADE_NAME_CONFLICT', async () => {
    const { token } = await tenantAutenticado();
    const g = await criarGrupo(token, 'PASTO');
    assert.equal((await criarTipo(token, { nome_tipo: 'roçada', grupo_atividade_id: g.id })).statusCode, 201);

    const dup = await criarTipo(token, { nome_tipo: 'ROÇADA', grupo_atividade_id: g.id });
    assert.equal(dup.statusCode, 409, dup.body);
    assert.equal(dup.json().code, 'TIPO_ATIVIDADE_NAME_CONFLICT');
    assert.equal(await prisma().tipoAtividade.count(), 1, 'nada gravado');
  });

  test('mesmo nome em outro grupo → 201', async () => {
    const { token } = await tenantAutenticado();
    const g1 = await criarGrupo(token, 'PASTO');
    const g2 = await criarGrupo(token, 'CERCAS');
    assert.equal((await criarTipo(token, { nome_tipo: 'roçada', grupo_atividade_id: g1.id })).statusCode, 201);
    const r = await criarTipo(token, { nome_tipo: 'roçada', grupo_atividade_id: g2.id });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().grupo_atividade_nome, 'CERCAS');
  });

  test('cliente_id no corpo → 400 (additionalProperties)', async () => {
    const { token } = await tenantAutenticado();
    const g = await criarGrupo(token, 'G');
    const r = await criarTipo(token, { nome_tipo: 'X', grupo_atividade_id: g.id, cliente_id: 'outro-tenant' });
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(await prisma().tipoAtividade.count(), 0);
  });

  test('chave legada exige_area → 400 no POST e no PATCH (sem tolerância de legado)', async () => {
    const { token } = await tenantAutenticado();
    const g = await criarGrupo(token, 'G');
    const r = await criarTipo(token, { nome_tipo: 'X', grupo_atividade_id: g.id, exige_area: true });
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(await prisma().tipoAtividade.count(), 0);

    const ok = await criarTipo(token, { nome_tipo: 'X', grupo_atividade_id: g.id });
    assert.equal(ok.statusCode, 201, ok.body);
    for (const chave of ['exige_area', 'pode_ter_produto', 'pode_ter_maquina', 'pode_ter_implemento']) {
      const p = await req('PATCH', `/tipos-atividade/${ok.json().id}`, token, { [chave]: true });
      assert.equal(p.statusCode, 400, `${chave}: ${p.body}`);
    }
  });

  test('grupo inexistente → 404 GRUPO_ATIVIDADE_NOT_FOUND', async () => {
    const { token } = await tenantAutenticado();
    const r = await criarTipo(token, { nome_tipo: 'X', grupo_atividade_id: 'grupo-que-nao-existe' });
    assert.equal(r.statusCode, 404, r.body);
    assert.equal(r.json().code, 'GRUPO_ATIVIDADE_NOT_FOUND');
  });
});

describe('D-PROD-180 — TipoAtividade: leitura, edição e exclusão', () => {
  test('GET /tipos-atividade/:id devolve o tipo; id desconhecido → 404 TIPO_ATIVIDADE_NOT_FOUND', async () => {
    const { token } = await tenantAutenticado();
    const g = await criarGrupo(token, 'G');
    const t = (await criarTipo(token, { nome_tipo: 'vacinação', grupo_atividade_id: g.id })).json();

    const r = await req('GET', `/tipos-atividade/${t.id}`, token);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), t);

    const nada = await req('GET', '/tipos-atividade/id-inexistente', token);
    assert.equal(nada.statusCode, 404, nada.body);
    assert.equal(nada.json().code, 'TIPO_ATIVIDADE_NOT_FOUND');
  });

  test('renomear o grupo atualiza o cache; mover o tipo de grupo via PATCH também', async () => {
    const { token } = await tenantAutenticado();
    const g1 = await criarGrupo(token, 'A');
    const g2 = await criarGrupo(token, 'OUTRO');
    const t = (await criarTipo(token, { nome_tipo: 'T1', grupo_atividade_id: g1.id })).json();

    const ren = await req('PATCH', `/grupos-atividade/${g1.id}`, token, { nome_grupo: 'b novo' });
    assert.equal(ren.statusCode, 200, ren.body);
    assert.equal((await req('GET', `/tipos-atividade/${t.id}`, token)).json().grupo_atividade_nome, 'B NOVO');

    const mover = await req('PATCH', `/tipos-atividade/${t.id}`, token, { grupo_atividade_id: g2.id });
    assert.equal(mover.statusCode, 200, mover.body);
    assert.equal(mover.json().grupo_atividade_id, g2.id);
    assert.equal(mover.json().grupo_atividade_nome, 'OUTRO');
    const linha = await prisma().tipoAtividade.findUnique({ where: { id: t.id } });
    assert.equal(linha.grupo_atividade_nome, 'OUTRO');
  });

  test('inativar via PATCH {ativo:false} e reativar', async () => {
    const { token } = await tenantAutenticado();
    const g = await criarGrupo(token, 'G');
    const t = (await criarTipo(token, { nome_tipo: 'X', grupo_atividade_id: g.id })).json();

    const off = await req('PATCH', `/tipos-atividade/${t.id}`, token, { ativo: false });
    assert.equal(off.statusCode, 200, off.body);
    assert.equal(off.json().ativo, false);
    const lista = (await req('GET', '/tipos-atividade', token)).json();
    assert.equal(lista.find((x) => x.id === t.id).ativo, false, 'inativo continua listado');

    const on = await req('PATCH', `/tipos-atividade/${t.id}`, token, { ativo: true });
    assert.equal(on.statusCode, 200, on.body);
    assert.equal(on.json().ativo, true);
  });

  test('DELETE → 204 (exclusão física) e depois 404', async () => {
    const { token, clienteId } = await tenantAutenticado();
    const g = await criarGrupo(token, 'G');
    const t = (await criarTipo(token, { nome_tipo: 'X', grupo_atividade_id: g.id })).json();

    const del = await req('DELETE', `/tipos-atividade/${t.id}`, token);
    assert.equal(del.statusCode, 204, del.body);
    assert.equal(await prisma().tipoAtividade.count({ where: { id: t.id } }), 0, 'exclusão física');

    const de2 = await req('DELETE', `/tipos-atividade/${t.id}`, token);
    assert.equal(de2.statusCode, 404, de2.body);
    assert.equal(de2.json().code, 'TIPO_ATIVIDADE_NOT_FOUND');
    assert.equal((await req('GET', `/tipos-atividade/${t.id}`, token)).statusCode, 404);

    const acoes = (await prisma().auditLog.findMany({ where: { cliente_id: clienteId, entidade: 'TipoAtividade' } })).map((a) => a.acao).sort();
    assert.deepEqual(acoes, ['create', 'delete']);
  });

  test('grupo com tipo vinculado → 409 GRUPO_ATIVIDADE_DELETE_BLOCKED; e a FK no banco é Restrict', async () => {
    const { token, clienteId } = await tenantAutenticado();
    const g = await criarGrupo(token, 'G');
    const t = (await criarTipo(token, { nome_tipo: 'X', grupo_atividade_id: g.id })).json();

    const r = await req('DELETE', `/grupos-atividade/${g.id}`, token);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'GRUPO_ATIVIDADE_DELETE_BLOCKED');
    assert.match(r.json().message, /tipos de atividade/);
    assert.equal(await prisma().grupoAtividade.count({ where: { id: g.id } }), 1);

    await assert.rejects(
      prisma().grupoAtividade.delete({ where: { cliente_id_id: { cliente_id: clienteId, id: g.id } } }),
      (e) => e?.code === 'P2003' || /foreign key/i.test(String(e?.message)),
      'FK Restrict barra o delete direto'
    );
    assert.equal(await prisma().tipoAtividade.count({ where: { id: t.id } }), 1);

    assert.equal((await req('DELETE', `/tipos-atividade/${t.id}`, token)).statusCode, 204);
    assert.equal((await req('DELETE', `/grupos-atividade/${g.id}`, token)).statusCode, 204, 'sem tipo, o grupo sai');
  });
});

describe('D-PROD-180 — TipoAtividade: isolamento por tenant', () => {
  test('tenant B não lista, não lê, não edita, não apaga o tipo de A (404) e não cria no grupo de A', async () => {
    const A = await tenantAutenticado();
    const B = await tenantAutenticado();
    const gA = await criarGrupo(A.token, 'GRUPO A');
    const tA = (await criarTipo(A.token, { nome_tipo: 'X', grupo_atividade_id: gA.id })).json();

    assert.deepEqual((await req('GET', '/tipos-atividade', B.token)).json(), []);

    const get = await req('GET', `/tipos-atividade/${tA.id}`, B.token);
    assert.equal(get.statusCode, 404, get.body);
    assert.equal(get.json().code, 'TIPO_ATIVIDADE_NOT_FOUND');

    const patch = await req('PATCH', `/tipos-atividade/${tA.id}`, B.token, { nome_tipo: 'hack' });
    assert.equal(patch.statusCode, 404, patch.body);
    assert.equal(patch.json().code, 'TIPO_ATIVIDADE_NOT_FOUND');

    const del = await req('DELETE', `/tipos-atividade/${tA.id}`, B.token);
    assert.equal(del.statusCode, 404, del.body);
    assert.equal(del.json().code, 'TIPO_ATIVIDADE_NOT_FOUND');

    const criar = await criarTipo(B.token, { nome_tipo: 'Y', grupo_atividade_id: gA.id });
    assert.equal(criar.statusCode, 404, criar.body);
    assert.equal(criar.json().code, 'GRUPO_ATIVIDADE_NOT_FOUND');

    const gB = await criarGrupo(B.token, 'GRUPO B');
    const tB = (await criarTipo(B.token, { nome_tipo: 'Z', grupo_atividade_id: gB.id })).json();
    const mover = await req('PATCH', `/tipos-atividade/${tB.id}`, B.token, { grupo_atividade_id: gA.id });
    assert.equal(mover.statusCode, 404, mover.body);
    assert.equal(mover.json().code, 'GRUPO_ATIVIDADE_NOT_FOUND');

    const intacto = await prisma().tipoAtividade.findUnique({ where: { id: tA.id } });
    assert.equal(intacto.nome_tipo, 'X');
    assert.equal(intacto.cliente_id, A.clienteId);
    assert.equal(await prisma().tipoAtividade.count({ where: { cliente_id: B.clienteId } }), 1);
  });
});

describe('D-PROD-180 — TipoAtividade: permissão de tela', () => {
  const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
  const linha = (tela, a) => ({ modulo_id: 'suporte-mapa', tela_id: tela, ...acoes(false), visualizar: true, ...a });

  const contaCom = async (permissoes_telas) => {
    const c = await criarTenant({ semPermissao: true });
    await prisma().permissao.create({
      data: { cliente_id: c.cliente.id, user_email: c.credenciais.login, user_nome: 'Op', modulos_permitidos: ['suporte-mapa'], permissoes_telas },
    });
    const { corpo } = await autenticarNoApp(app, c.credenciais);
    assert.ok(corpo.token, 'login');
    const grupo = await prisma().grupoAtividade.create({ data: { cliente_id: c.cliente.id, nome_grupo: 'G' } });
    return { token: corpo.token, clienteId: c.cliente.id, grupo };
  };

  test('usuário comum sem a tela sup-tipos-atividade (só sup-tipos-tarefa) → 403 no POST, nada gravado', async () => {
    const c = await contaCom([linha('sup-tipos-tarefa', { novo: true, salvar: true, editar: true, excluir: true })]);
    const r = await criarTipo(c.token, { nome_tipo: 'X', grupo_atividade_id: c.grupo.id });
    assert.equal(r.statusCode, 403, r.body);
    assert.equal(r.json().code, 'ACAO_NAO_PERMITIDA');
    assert.equal(await prisma().tipoAtividade.count({ where: { cliente_id: c.clienteId } }), 0);
    assert.equal((await req('GET', '/tipos-atividade', c.token)).statusCode, 200, 'leitura só exige autenticação');
  });

  test('controle positivo: "novo" em sup-tipos-atividade cria (201)', async () => {
    const c = await contaCom([linha('sup-tipos-atividade', { novo: true })]);
    const r = await criarTipo(c.token, { nome_tipo: 'X', grupo_atividade_id: c.grupo.id });
    assert.equal(r.statusCode, 201, r.body);
  });
});
