/**
 * UnidadeMedida nativa — PostgreSQL real (P4.5, D-PROD-44).
 *
 * D-PROD-196 (§4 do contrato `MAIKE-TIPO-ATIVIDADE-DEFAULTS-CONTRATO.md`): a
 * unidade usada como unidade de produção de um Tipo de Atividade não sai — a FK
 * RESTRICT nova barra a exclusão física e o P2003 vira 409
 * `UNIDADE_MEDIDA_DELETE_BLOCKED` (não o 403 genérico do errorHandler); o módulo
 * de unidade nunca consulta `TipoAtividade` (lição do hotfix #259).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { escopoDaNumeracao, ENTIDADE_SEQUENCIA } from '../src/modules/unidadesMedida/unidadeMedidaService.js';
import { ESCOPO_TENANT } from '../src/modules/sequencias/entidadeCodigoService.js';
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

const tenantAutenticado = async (opcoes) => {
  const { cliente, credenciais } = await criarTenant(opcoes);
  const { corpo } = await autenticarNoApp(app, credenciais);
  return { token: corpo.token, clienteId: cliente.id };
};

const auth = (token) => ({ authorization: `Bearer ${token}` });

describe('P4.5-UnidadeMedida — sessão e numeração', () => {
  test('BE-P45-01 GET /unidades-medida sem token reprova', async () => {
    const r = await app.inject({ method: 'GET', url: '/unidades-medida' });
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().code, 'TENANT_CONTEXT_REQUIRED');
  });

  test('BE-P45-02 primeira unidade recebe numero_unidade "1"', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'POST',
      url: '/unidades-medida',
      headers: auth(token),
      payload: { sigla: 'kg', descricao: 'Quilograma' },
    });
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().numero_unidade, '1');
    assert.equal(r.json().sigla, 'KG');
    assert.equal(escopoDaNumeracao(), ESCOPO_TENANT);
    assert.equal(ENTIDADE_SEQUENCIA, 'UnidadeMedida');
  });

  test('BE-P45-03 GET /unidades-medida legado devolve array', async () => {
    const { token } = await tenantAutenticado();
    await app.inject({
      method: 'POST',
      url: '/unidades-medida',
      headers: auth(token),
      payload: { sigla: 'KG', descricao: 'Quilograma' },
    });
    const r = await app.inject({
      method: 'GET',
      url: '/unidades-medida',
      headers: auth(token),
    });
    assert.equal(r.statusCode, 200);
    assert.ok(Array.isArray(r.json()));
    assert.equal(r.json().length, 1);
  });
});

describe('P4.5-UnidadeMedida — listagem keyset (MotorBase1)', () => {
  test('BE-P45-04 GET /unidades-medida/page devolve envelope paginado', async () => {
    const { token } = await tenantAutenticado();
    await app.inject({
      method: 'POST',
      url: '/unidades-medida',
      headers: auth(token),
      payload: { sigla: 'UN', descricao: 'Unidade' },
    });
    await app.inject({
      method: 'POST',
      url: '/unidades-medida',
      headers: auth(token),
      payload: { sigla: 'KG', descricao: 'Quilograma' },
    });

    const r = await app.inject({
      method: 'GET',
      url: '/unidades-medida/page?limit=1',
      headers: auth(token),
    });
    assert.equal(r.statusCode, 200);
    const corpo = r.json();
    assert.equal(corpo.items.length, 1);
    assert.equal(corpo.limit, 1);
    assert.equal(corpo.total, 2);
    assert.equal(corpo.has_more, true);
    assert.equal(typeof corpo.next_cursor, 'string');

    const r2 = await app.inject({
      method: 'GET',
      url: `/unidades-medida/page?limit=1&cursor=${encodeURIComponent(corpo.next_cursor)}`,
      headers: auth(token),
    });
    assert.equal(r2.statusCode, 200);
    const corpo2 = r2.json();
    assert.equal(corpo2.items.length, 1);
    assert.notEqual(corpo2.items[0].id, corpo.items[0].id);
    assert.equal(corpo2.has_more, false);
  });

  test('BE-P45-05 busca q filtra sigla/descricao', async () => {
    const { token } = await tenantAutenticado();
    await app.inject({
      method: 'POST',
      url: '/unidades-medida',
      headers: auth(token),
      payload: { sigla: 'KG', descricao: 'QUILOGRAMA' },
    });
    await app.inject({
      method: 'POST',
      url: '/unidades-medida',
      headers: auth(token),
      payload: { sigla: 'UN', descricao: 'UNIDADE' },
    });

    const r = await app.inject({
      method: 'GET',
      url: '/unidades-medida/page?q=qui',
      headers: auth(token),
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().total, 1);
    assert.equal(r.json().items[0].sigla, 'KG');
  });

  test('BE-P45-06 cursor inválido reprova 400', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'GET',
      url: '/unidades-medida/page?cursor=nao-e-cursor',
      headers: auth(token),
    });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED');
  });
});

describe('P4.5-UnidadeMedida — conflitos', () => {
  test('BE-P45-07 sigla duplicada reprova', async () => {
    const { token } = await tenantAutenticado();
    await app.inject({
      method: 'POST',
      url: '/unidades-medida',
      headers: auth(token),
      payload: { sigla: 'UN', descricao: 'Unidade' },
    });
    const r = await app.inject({
      method: 'POST',
      url: '/unidades-medida',
      headers: auth(token),
      payload: { sigla: 'un', descricao: 'Outra' },
    });
    assert.equal(r.statusCode, 409);
    assert.equal(r.json().code, 'UNIDADE_MEDIDA_SIGLA_CONFLICT');
  });
});

describe('D-PROD-196 — exclusão de unidade usada como unidade de produção do Tipo de Atividade', () => {
  const req = (metodo, url, token, payload) =>
    app.inject({ method: metodo, url, headers: auth(token), ...(payload !== undefined ? { payload } : {}) });
  const criarUnidade = async (token, sigla, descricao) => {
    const r = await req('POST', '/unidades-medida', token, { sigla, descricao });
    assert.equal(r.statusCode, 201, r.body);
    return r.json();
  };
  /** Grupo + tipo de atividade (pela API do cadastro) com a unidade de produção dada. */
  const criarTipoCom = async (token, unidadeId, extra = {}) => {
    const g = await req('POST', '/grupos-atividade', token, { nome_grupo: `Lavoura ${randomUUID().slice(0, 8)}` });
    assert.equal(g.statusCode, 201, g.body);
    const t = await req('POST', '/tipos-atividade', token, { nome_tipo: 'Plantio', grupo_atividade_id: g.json().id, unidade_producao_id: unidadeId, ...extra });
    assert.equal(t.statusCode, 201, t.body);
    assert.equal(t.json().unidade_producao_id, unidadeId);
    return t.json();
  };
  const auditoriaDaUnidade = (clienteId, id) =>
    prisma().auditLog.findMany({ where: { cliente_id: clienteId, entidade: 'UnidadeMedida', entidade_id: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

  test('BE-P45-08 unidade sem uso é excluída (204, exclusão física e auditada); a mesma unidade some da lista', async () => {
    const { token, clienteId } = await tenantAutenticado();
    const livre = await criarUnidade(token, 'KG', 'Quilograma');
    const usada = await criarUnidade(token, 'HA', 'Hectare');
    await criarTipoCom(token, usada.id);

    const r = await req('DELETE', `/unidades-medida/${livre.id}`, token);
    assert.equal(r.statusCode, 204, r.body);
    assert.equal(await prisma().unidadeMedida.count({ where: { id: livre.id } }), 0, 'exclusão física');
    assert.deepEqual((await auditoriaDaUnidade(clienteId, livre.id)).map((a) => a.acao).sort(), ['create', 'delete']);
    assert.deepEqual((await req('GET', '/unidades-medida', token)).json().map((u) => u.id), [usada.id]);
  });

  test('BE-P45-09 unidade usada como unidade de produção → 409 UNIDADE_MEDIDA_DELETE_BLOCKED (nunca o 403 genérico); unidade, tipo e auditoria intactos; solto o padrão, sai', async () => {
    const { token, clienteId } = await tenantAutenticado();
    const ha = await criarUnidade(token, 'HA', 'Hectare');
    const tipo = await criarTipoCom(token, ha.id);
    const tipoInativo = await criarTipoCom(token, ha.id, { nome_tipo: 'Colheita', ativo: false });
    const auditAntes = await auditoriaDaUnidade(clienteId, ha.id);
    const tiposAntes = await prisma().tipoAtividade.findMany({ where: { cliente_id: clienteId }, orderBy: { id: 'asc' } });

    const r = await req('DELETE', `/unidades-medida/${ha.id}`, token);
    assert.deepEqual([r.statusCode, r.json().code], [409, 'UNIDADE_MEDIDA_DELETE_BLOCKED'], r.body);
    assert.deepEqual(r.json().details, { vinculo: 'tipo_atividade' }, 'o vínculo que barrou');
    assert.equal(await prisma().unidadeMedida.count({ where: { id: ha.id } }), 1, 'a unidade continua');
    assert.deepEqual(await auditoriaDaUnidade(clienteId, ha.id), auditAntes, 'nenhuma auditoria de exclusão');
    assert.deepEqual(await prisma().tipoAtividade.findMany({ where: { cliente_id: clienteId }, orderBy: { id: 'asc' } }), tiposAntes, 'tipos intactos (linhas completas)');
    const lida = await req('GET', `/tipos-atividade/${tipo.id}`, token);
    assert.equal(lida.json().unidade_producao.id, ha.id, 'o tipo segue apontando a unidade');

    // O tipo ativo solta o padrão: o inativo ainda segura (é a FK, não uma consulta de "tipos ativos").
    const solta = await req('PATCH', `/tipos-atividade/${tipo.id}`, token, { unidade_producao_id: null });
    assert.equal(solta.statusCode, 200, solta.body);
    const ainda = await req('DELETE', `/unidades-medida/${ha.id}`, token);
    assert.deepEqual([ainda.statusCode, ainda.json().code], [409, 'UNIDADE_MEDIDA_DELETE_BLOCKED'], `tipo inativo também segura: ${ainda.body}`);

    const solta2 = await req('PATCH', `/tipos-atividade/${tipoInativo.id}`, token, { unidade_producao_id: null });
    assert.equal(solta2.statusCode, 200, solta2.body);
    const sai = await req('DELETE', `/unidades-medida/${ha.id}`, token);
    assert.equal(sai.statusCode, 204, sai.body);
    assert.equal(await prisma().unidadeMedida.count({ where: { id: ha.id } }), 0);
    assert.deepEqual((await auditoriaDaUnidade(clienteId, ha.id)).map((a) => a.acao).sort(), ['create', 'delete']);
  });

  test('BE-P45-10 (hotfix #259) o módulo de unidade nunca consulta TipoAtividade: a recusa vem só da FK', () => {
    const raiz = new URL('../src/modules/unidadesMedida/', import.meta.url);
    const arquivos = /** @type {string[]} */ (readdirSync(raiz)).filter((f) => /\.(m?js)$/.test(f));
    assert.ok(arquivos.length >= 3, 'varreu o módulo');
    const consulta = /\.tipoAtividade\s*\.|"TipoAtividade"/;
    const fora = arquivos.filter((f) => consulta.test(readFileSync(new URL(f, raiz), 'utf8')));
    assert.deepEqual(fora, [], 'sem SELECT em TipoAtividade (nem pelo Prisma, nem por SQL)');
  });
});
