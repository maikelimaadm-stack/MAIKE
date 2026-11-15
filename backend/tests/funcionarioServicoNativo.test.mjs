/**
 * Cadastros de Funcionário e Serviço da fazenda (D-PROD-203, Fatia 4 do
 * Lançamento de Atividades; contrato `MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md` §2)
 * — PostgreSQL real.
 *
 * Prova: CRUD com número da sequência do tenant, nome em MAIÚSCULAS, decimais
 * como texto, inativar/reativar (idempotente, auditado), SEM DELETE, isolamento
 * por tenant e por fazenda (404 sem oráculo), validações (tipo, custos
 * negativos ou numéricos, unidade inativa ou de outro cliente, centro de outra
 * fazenda ou inativo), a unidade de medida usada por serviço não sai (409
 * `UNIDADE_MEDIDA_DELETE_BLOCKED` vinculo `servico`) e a permissão pela própria
 * tela (`sup-funcionarios`, `sup-servicos`), leitura incluída.
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

const CAMPOS_FUNCIONARIO = [
  'ativo', 'cargo', 'created_date', 'custo_diaria', 'custo_hora', 'empresa_id', 'id', 'nome', 'numero', 'tipo', 'updated_date',
];
const CAMPOS_SERVICO = [
  'ativo', 'centro_custo_padrao', 'centro_custo_padrao_id', 'created_date', 'empresa_id', 'id', 'nome', 'numero',
  'unidade_medida', 'unidade_medida_id', 'updated_date', 'valor_referencia',
];

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const comEmpresa = (url, empresaId, extra = '') => `${url}?empresa_id=${encodeURIComponent(empresaId)}${extra}`;

const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
const linha = (tela, a) => ({ modulo_id: 'suporte-mapa', tela_id: tela, ...acoes(false), ...a });

let seqUnidade = 0;
const unidade = (clienteId, sigla, ativo = true) => {
  seqUnidade += 1;
  return prisma().unidadeMedida.create({
    data: { cliente_id: clienteId, numero_unidade: `U${seqUnidade}`, sigla, descricao: `UNIDADE ${sigla}`, ativo },
  });
};
let seqCentro = 0;
const centro = (clienteId, empresaId, nome, ativo = true) => {
  seqCentro += 1;
  return prisma().centroCusto.create({ data: { cliente_id: clienteId, empresa_id: empresaId, numero: `C${seqCentro}`, nome, ativo } });
};

/** Tenant administrador com duas fazendas, uma unidade e um centro em cada fazenda. */
const cenario = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e1 = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', nome: `Fazenda 1 ${c}` } });
  const e2 = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 2, apelido: 'E2', nome: `Fazenda 2 ${c}` } });
  const ha = await unidade(c, 'HA');
  const cc1 = await centro(c, e1.id, 'LAVOURA');
  const cc2 = await centro(c, e2.id, 'PASTAGEM');
  const { corpo } = await autenticarNoApp(app, adm.credenciais);
  assert.ok(corpo.token, 'login');
  return { token: corpo.token, clienteId: c, e1, e2, ha, cc1, cc2, adm };
};

/** Conta comum do mesmo tenant com as linhas de permissão dadas. */
const contaCom = async (cen, permissoes_telas, modulos = ['suporte-mapa']) => {
  const senha = cen.adm.credenciais.senha;
  const hash = (await prisma().usuario.findUnique({ where: { id: cen.adm.usuario.id } })).senha_hash;
  const login = `op-${randomUUID().slice(0, 8)}`;
  await prisma().usuario.create({ data: { cliente_id: cen.clienteId, nome: 'Op', login, senha_hash: hash, papel_tenant: 'usuario' } });
  await prisma().permissao.create({ data: { cliente_id: cen.clienteId, user_email: login, user_nome: 'Op', modulos_permitidos: modulos, permissoes_telas } });
  const { corpo } = await autenticarNoApp(app, { login, senha });
  assert.ok(corpo.token, 'login da conta comum');
  return corpo.token;
};

const funcionario = (empresaId, extra = {}) => ({ empresa_id: empresaId, nome: 'joão da silva', tipo: 'DIARISTA', ...extra });
const servico = (empresaId, unidadeId, extra = {}) => ({ empresa_id: empresaId, nome: 'aplicação aérea', unidade_medida_id: unidadeId, ...extra });
const criarF = (token, payload) => req('POST', '/funcionarios', token, payload);
const criarS = (token, payload) => req('POST', '/servicos', token, payload);

// ─── Funcionário ────────────────────────────────────────────────────────────

describe('D-PROD-203 — Funcionários: criação, leitura e lista', () => {
  test('sem token → 401', async () => {
    assert.equal((await req('GET', '/funcionarios?empresa_id=x')).statusCode, 401);
    assert.equal((await req('POST', '/funcionarios', undefined, { empresa_id: 'x', nome: 'x', tipo: 'DIARISTA' })).statusCode, 401);
  });

  test('POST cria (201): número da sequência, MAIÚSCULAS, decimais como texto com 4 casas, ativo; GET detalha; tenant da sessão', async () => {
    const { token, clienteId, e1 } = await cenario();
    const r = await criarF(token, funcionario(e1.id, { cargo: 'tratorista', custo_hora: '25.5', custo_diaria: '200' }));
    assert.equal(r.statusCode, 201, r.body);
    const f = r.json();
    assert.deepEqual(Object.keys(f).sort(), CAMPOS_FUNCIONARIO);
    assert.equal(f.nome, 'JOÃO DA SILVA');
    assert.equal(f.cargo, 'TRATORISTA');
    assert.equal(f.tipo, 'DIARISTA');
    assert.equal(f.custo_hora, '25.5000');
    assert.equal(f.custo_diaria, '200.0000');
    assert.equal(f.ativo, true);
    assert.equal(f.empresa_id, e1.id);
    assert.equal(f.numero, '1');
    const segundo = (await criarF(token, funcionario(e1.id, { nome: 'maria', tipo: 'MENSALISTA' }))).json();
    assert.equal(segundo.numero, '2');
    assert.equal(segundo.custo_hora, null);
    assert.equal(segundo.cargo, null);

    const um = await req('GET', comEmpresa(`/funcionarios/${f.id}`, e1.id), token);
    assert.equal(um.statusCode, 200, um.body);
    assert.deepEqual(um.json(), f);
    const banco = await prisma().funcionario.findUnique({ where: { id: f.id } });
    assert.equal(banco.cliente_id, clienteId, 'tenant gravado a partir da sessão');
  });

  test('lista keyset por fazenda, com busca (nome, número, cargo), filtro de situação e paginação', async () => {
    const { token, e1, e2 } = await cenario();
    const a = (await criarF(token, funcionario(e1.id, { nome: 'ana', cargo: 'vaqueiro' }))).json();
    const b = (await criarF(token, funcionario(e1.id, { nome: 'bruno', tipo: 'TAREFEIRO' }))).json();
    const c = (await criarF(token, funcionario(e1.id, { nome: 'carla', tipo: 'MENSALISTA' }))).json();
    await criarF(token, funcionario(e2.id, { nome: 'de outra fazenda' }));
    await req('POST', `/funcionarios/${b.id}/inativar`, token, { empresa_id: e1.id });

    const lista = (await req('GET', comEmpresa('/funcionarios', e1.id), token)).json();
    assert.deepEqual(Object.keys(lista).sort(), ['has_more', 'items', 'limit', 'next_cursor', 'total']);
    assert.equal(lista.total, 3);
    assert.deepEqual(lista.items.map((x) => x.id), [c.id, b.id, a.id], 'mais novo primeiro');

    assert.deepEqual((await req('GET', comEmpresa('/funcionarios', e1.id, '&q=vaque'), token)).json().items.map((x) => x.id), [a.id]);
    assert.deepEqual((await req('GET', comEmpresa('/funcionarios', e1.id, '&q=Carl'), token)).json().items.map((x) => x.id), [c.id]);
    assert.deepEqual((await req('GET', comEmpresa('/funcionarios', e1.id, `&q=${b.numero}`), token)).json().items.map((x) => x.id), [b.id]);
    assert.deepEqual((await req('GET', comEmpresa('/funcionarios', e1.id, '&ativo=false'), token)).json().items.map((x) => x.id), [b.id]);
    assert.equal((await req('GET', comEmpresa('/funcionarios', e1.id, '&ativo=true'), token)).json().total, 2);

    const p1 = (await req('GET', comEmpresa('/funcionarios', e1.id, '&limit=2'), token)).json();
    assert.equal(p1.items.length, 2);
    assert.equal(p1.has_more, true);
    const p2 = (await req('GET', comEmpresa('/funcionarios', e1.id, `&limit=2&cursor=${p1.next_cursor}`), token)).json();
    assert.deepEqual(p2.items.map((x) => x.id), [a.id]);
    assert.equal(p2.has_more, false);
    assert.equal((await req('GET', comEmpresa('/funcionarios', e1.id, '&cursor=lixo'), token)).statusCode, 400);

    assert.equal((await req('GET', comEmpresa('/funcionarios', e2.id), token)).json().total, 1);
  });
});

describe('D-PROD-203 — Funcionários: validação do corpo', () => {
  test('chave fora do schema (cliente_id, numero, ativo, salario) → 400 e nada gravado', async () => {
    const { token, clienteId, e1 } = await cenario();
    for (const extra of [{ cliente_id: clienteId }, { numero: '99' }, { ativo: false }, { salario: '1000' }]) {
      const r = await criarF(token, funcionario(e1.id, extra));
      assert.equal(r.statusCode, 400, `${JSON.stringify(extra)} ${r.body}`);
    }
    assert.equal(await prisma().funcionario.count(), 0);
  });

  test('obrigatórios (empresa_id, nome, tipo) e tipo fechado → 400; os três tipos aceitos', async () => {
    const { token, e1 } = await cenario();
    for (const campo of ['empresa_id', 'nome', 'tipo']) {
      const corpo = funcionario(e1.id);
      delete corpo[campo];
      assert.equal((await criarF(token, corpo)).statusCode, 400, campo);
    }
    assert.equal((await criarF(token, funcionario(e1.id, { nome: '   ' }))).statusCode, 400, 'nome em branco');
    for (const tipo of ['diarista', 'EMPREITEIRO', '', 'Mensalista']) {
      assert.equal((await criarF(token, funcionario(e1.id, { tipo }))).statusCode, 400, tipo);
    }
    assert.equal(await prisma().funcionario.count(), 0);
    for (const tipo of ['MENSALISTA', 'DIARISTA', 'TAREFEIRO']) {
      assert.equal((await criarF(token, funcionario(e1.id, { nome: tipo, tipo }))).statusCode, 201, tipo);
    }
  });

  test('custos: negativo, número JSON, formato ou casas demais → 400; zero aceito; null limpa no PATCH', async () => {
    const { token, e1 } = await cenario();
    for (const extra of [{ custo_hora: '-1' }, { custo_diaria: '-0.01' }, { custo_hora: 25 }, { custo_diaria: 1.5 }, { custo_hora: '1,5' }, { custo_hora: '1.12345' }, { custo_hora: '12345678901' }]) {
      const r = await criarF(token, funcionario(e1.id, extra));
      assert.equal(r.statusCode, 400, `${JSON.stringify(extra)} ${r.body}`);
    }
    const numero = await criarF(token, funcionario(e1.id, { custo_hora: 25 }));
    assert.equal(numero.json().reason, 'valor_deve_ser_texto');
    assert.equal(await prisma().funcionario.count(), 0);
    const f = (await criarF(token, funcionario(e1.id, { custo_hora: '0', custo_diaria: '0.0000' }))).json();
    assert.equal(f.custo_hora, '0.0000');
    const limpo = await req('PATCH', `/funcionarios/${f.id}`, token, { empresa_id: e1.id, custo_hora: null });
    assert.equal(limpo.statusCode, 200, limpo.body);
    assert.equal(limpo.json().custo_hora, null);
    assert.equal(limpo.json().custo_diaria, '0.0000');
  });

  test('texto que cresce ao virar maiúsculo e passa da coluna → 400 tamanho_excedido, nunca 500', async () => {
    const { token, e1 } = await cenario();
    const r = await criarF(token, funcionario(e1.id, { cargo: 'ß'.repeat(61) }));
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().reason, 'tamanho_excedido');
    assert.equal((await criarF(token, funcionario(e1.id, { nome: '<b>x</b>' }))).statusCode, 400, 'marcação HTML');
  });
});

describe('D-PROD-203 — Funcionários: edição, inativar/reativar, sem DELETE e escopo', () => {
  test('PATCH altera e audita; sem mudança não grava; sem empresa_id, só empresa_id ou com ativo → 400', async () => {
    const { token, clienteId, e1 } = await cenario();
    const f = (await criarF(token, funcionario(e1.id))).json();
    const r = await req('PATCH', `/funcionarios/${f.id}`, token, { empresa_id: e1.id, nome: 'joão s.', tipo: 'TAREFEIRO', cargo: 'peão', custo_diaria: '150.25' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().nome, 'JOÃO S.');
    assert.equal(r.json().tipo, 'TAREFEIRO');
    assert.equal(r.json().cargo, 'PEÃO');
    assert.equal(r.json().custo_diaria, '150.2500');
    assert.equal(r.json().numero, f.numero, 'número não muda');
    const igual = await req('PATCH', `/funcionarios/${f.id}`, token, { empresa_id: e1.id, nome: 'JOÃO S.' });
    assert.equal(igual.statusCode, 200);
    assert.equal((await req('PATCH', `/funcionarios/${f.id}`, token, { nome: 'Z' })).statusCode, 400, 'sem empresa_id');
    assert.equal((await req('PATCH', `/funcionarios/${f.id}`, token, { empresa_id: e1.id })).statusCode, 400, 'nada para alterar');
    assert.equal((await req('PATCH', `/funcionarios/${f.id}`, token, { empresa_id: e1.id, ativo: false })).statusCode, 400, 'ativo só pelas rotas próprias');
    const eventos = await prisma().auditLog.findMany({ where: { cliente_id: clienteId, entidade: 'Funcionario' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(eventos.map((x) => x.acao), ['create', 'update']);
  });

  test('inativar e reativar (200, idempotentes, auditados); o inativo continua legível', async () => {
    const { token, clienteId, e1 } = await cenario();
    const f = (await criarF(token, funcionario(e1.id))).json();
    const ina = await req('POST', `/funcionarios/${f.id}/inativar`, token, { empresa_id: e1.id });
    assert.equal(ina.statusCode, 200, ina.body);
    assert.equal(ina.json().ativo, false);
    assert.equal((await req('POST', `/funcionarios/${f.id}/inativar`, token, { empresa_id: e1.id })).json().ativo, false, 'de novo: sem erro');
    assert.equal((await req('GET', comEmpresa(`/funcionarios/${f.id}`, e1.id), token)).json().ativo, false);
    const rea = await req('POST', `/funcionarios/${f.id}/reativar`, token, { empresa_id: e1.id });
    assert.equal(rea.statusCode, 200, rea.body);
    assert.equal(rea.json().ativo, true);
    assert.equal((await req('POST', `/funcionarios/${f.id}/reativar`, token, { empresa_id: e1.id, ativo: true })).statusCode, 400, 'corpo fechado');
    const eventos = await prisma().auditLog.findMany({ where: { cliente_id: clienteId, entidade: 'Funcionario' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(eventos.map((x) => x.acao), ['create', 'update', 'update'], 'a inativação repetida não audita');
  });

  test('sem DELETE: a rota não existe (404) e o funcionário fica', async () => {
    const { token, e1 } = await cenario();
    const f = (await criarF(token, funcionario(e1.id))).json();
    const r = await req('DELETE', comEmpresa(`/funcionarios/${f.id}`, e1.id), token);
    assert.equal(r.statusCode, 404, r.body);
    assert.equal(await prisma().funcionario.count(), 1);
  });

  test('outra fazenda do tenant → 404 FUNCIONARIO_NOT_FOUND em ler, editar, inativar e reativar; nada muda', async () => {
    const { token, e1, e2 } = await cenario();
    const f = (await criarF(token, funcionario(e1.id))).json();
    for (const [m, url, corpo] of [
      ['GET', comEmpresa(`/funcionarios/${f.id}`, e2.id)],
      ['PATCH', `/funcionarios/${f.id}`, { empresa_id: e2.id, nome: 'movido' }],
      ['POST', `/funcionarios/${f.id}/inativar`, { empresa_id: e2.id }],
      ['POST', `/funcionarios/${f.id}/reativar`, { empresa_id: e2.id }],
    ]) {
      const r = await req(m, url, token, corpo);
      assert.equal(r.statusCode, 404, `${m} ${url}: ${r.body}`);
      assert.equal(r.json().code, 'FUNCIONARIO_NOT_FOUND');
    }
    const banco = await prisma().funcionario.findUnique({ where: { id: f.id } });
    assert.equal(banco.empresa_id, e1.id);
    assert.equal(banco.nome, 'JOÃO DA SILVA');
    assert.equal(banco.ativo, true);
  });

  test('outro tenant: fazenda de A → 404 EMPRESA_NOT_FOUND; registro de A pela fazenda de B → 404 (mesma resposta de inexistente)', async () => {
    const A = await cenario();
    const B = await cenario();
    const f = (await criarF(A.token, funcionario(A.e1.id))).json();
    const naFazendaDeA = await criarF(B.token, funcionario(A.e1.id));
    assert.equal(naFazendaDeA.statusCode, 404, naFazendaDeA.body);
    assert.equal(naFazendaDeA.json().code, 'EMPRESA_NOT_FOUND');
    assert.equal((await req('GET', comEmpresa('/funcionarios', A.e1.id), B.token)).statusCode, 404);
    const deA = await req('GET', comEmpresa(`/funcionarios/${f.id}`, B.e1.id), B.token);
    const inexistente = await req('GET', comEmpresa('/funcionarios/nao-existe', B.e1.id), B.token);
    assert.equal(deA.statusCode, 404);
    assert.equal(deA.json().code, inexistente.json().code);
    assert.equal(deA.json().message, inexistente.json().message);
    assert.equal((await req('PATCH', `/funcionarios/${f.id}`, B.token, { empresa_id: B.e1.id, nome: 'x' })).statusCode, 404);
    assert.equal((await req('POST', `/funcionarios/${f.id}/inativar`, B.token, { empresa_id: B.e1.id })).statusCode, 404);
    assert.equal((await prisma().funcionario.findUnique({ where: { id: f.id } })).ativo, true);
  });
});

// ─── Serviço ────────────────────────────────────────────────────────────────

describe('D-PROD-203 — Serviços: criação, leitura e lista', () => {
  test('POST cria (201) com a unidade e o centro resumidos na leitura; número próprio; decimais como texto', async () => {
    const { token, clienteId, e1, ha, cc1 } = await cenario();
    const r = await criarS(token, servico(e1.id, ha.id, { centro_custo_padrao_id: cc1.id, valor_referencia: '85.9' }));
    assert.equal(r.statusCode, 201, r.body);
    const s = r.json();
    assert.deepEqual(Object.keys(s).sort(), CAMPOS_SERVICO);
    assert.equal(s.nome, 'APLICAÇÃO AÉREA');
    assert.equal(s.numero, '1');
    assert.equal(s.valor_referencia, '85.9000');
    assert.deepEqual(s.unidade_medida, { id: ha.id, sigla: 'HA', descricao: 'UNIDADE HA', ativo: true });
    assert.equal(s.centro_custo_padrao_id, cc1.id);
    assert.deepEqual(s.centro_custo_padrao, { id: cc1.id, numero: cc1.numero, nome: 'LAVOURA', ativo: true });
    const sem = (await criarS(token, servico(e1.id, ha.id, { nome: 'frete' }))).json();
    assert.equal(sem.numero, '2');
    assert.equal(sem.centro_custo_padrao, null);
    assert.equal(sem.valor_referencia, null);
    // a numeração do serviço não é a do funcionário
    assert.equal((await criarF(token, funcionario(e1.id))).json().numero, '1');

    const um = await req('GET', comEmpresa(`/servicos/${s.id}`, e1.id), token);
    assert.equal(um.statusCode, 200, um.body);
    assert.deepEqual(um.json(), s);
    const lista = (await req('GET', comEmpresa('/servicos', e1.id), token)).json();
    assert.equal(lista.total, 2);
    assert.deepEqual(lista.items.map((x) => x.id), [sem.id, s.id]);
    assert.equal(lista.items[1].unidade_medida.sigla, 'HA');
    assert.equal((await req('GET', comEmpresa('/servicos', e1.id, '&q=aére'), token)).json().total, 1);
    assert.equal((await prisma().servico.findUnique({ where: { id: s.id } })).cliente_id, clienteId);
  });

  test('obrigatórios (empresa_id, nome, unidade_medida_id), chave fora do schema e valor negativo/numérico → 400', async () => {
    const { token, clienteId, e1, ha } = await cenario();
    for (const campo of ['empresa_id', 'nome', 'unidade_medida_id']) {
      const corpo = servico(e1.id, ha.id);
      delete corpo[campo];
      assert.equal((await criarS(token, corpo)).statusCode, 400, campo);
    }
    for (const extra of [{ cliente_id: clienteId }, { ativo: false }, { unidade: 'HA' }, { valor_referencia: '-1' }, { valor_referencia: 10 }, { unidade_medida_id: null }]) {
      const r = await criarS(token, servico(e1.id, ha.id, extra));
      assert.equal(r.statusCode, 400, `${JSON.stringify(extra)} ${r.body}`);
    }
    assert.equal(await prisma().servico.count(), 0);
  });

  test('unidade inativa, de outro cliente ou inexistente → 422 SERVICO_REFERENCIA_INVALIDA (outro cliente = inexistente)', async () => {
    const A = await cenario();
    const B = await cenario();
    const inativa = await unidade(A.clienteId, 'SC', false);
    const r1 = await criarS(A.token, servico(A.e1.id, inativa.id));
    assert.equal(r1.statusCode, 422, r1.body);
    assert.equal(r1.json().code, 'SERVICO_REFERENCIA_INVALIDA');
    assert.equal(r1.json().field, 'unidade_medida_id');
    assert.equal(r1.json().reason, 'inativo');
    const r2 = await criarS(A.token, servico(A.e1.id, B.ha.id));
    const r3 = await criarS(A.token, servico(A.e1.id, 'nao-existe'));
    for (const r of [r2, r3]) {
      assert.equal(r.statusCode, 422, r.body);
      assert.equal(r.json().reason, 'nao_encontrado');
    }
    assert.equal(r2.json().message, r3.json().message, 'sem oráculo');
    assert.equal(await prisma().servico.count(), 0);
  });

  test('centro de outra fazenda, de outro tenant, inexistente ou inativo → 422; null tira o padrão', async () => {
    const A = await cenario();
    const B = await cenario();
    const inativo = await centro(A.clienteId, A.e1.id, 'VELHO', false);
    const casos = [[A.cc2.id, 'nao_encontrado'], [B.cc1.id, 'nao_encontrado'], ['nao-existe', 'nao_encontrado'], [inativo.id, 'inativo']];
    for (const [id, reason] of casos) {
      const r = await criarS(A.token, servico(A.e1.id, A.ha.id, { centro_custo_padrao_id: id }));
      assert.equal(r.statusCode, 422, `${id}: ${r.body}`);
      assert.equal(r.json().field, 'centro_custo_padrao_id');
      assert.equal(r.json().reason, reason);
    }
    assert.equal(await prisma().servico.count(), 0);
    const s = (await criarS(A.token, servico(A.e1.id, A.ha.id, { centro_custo_padrao_id: A.cc1.id }))).json();
    const tirar = await req('PATCH', `/servicos/${s.id}`, A.token, { empresa_id: A.e1.id, centro_custo_padrao_id: null });
    assert.equal(tirar.statusCode, 200, tirar.body);
    assert.equal(tirar.json().centro_custo_padrao, null);
    const outra = await req('PATCH', `/servicos/${s.id}`, A.token, { empresa_id: A.e1.id, centro_custo_padrao_id: A.cc2.id });
    assert.equal(outra.statusCode, 422, outra.body);
  });

  test('a referência só é conferida quando muda: unidade gravada que ficou inativa não impede editar o nome; trocar por inativa → 422', async () => {
    const { token, clienteId, e1, ha } = await cenario();
    const s = (await criarS(token, servico(e1.id, ha.id, { valor_referencia: '10' }))).json();
    await prisma().unidadeMedida.update({ where: { id: ha.id }, data: { ativo: false } });
    const renomear = await req('PATCH', `/servicos/${s.id}`, token, { empresa_id: e1.id, nome: 'pulverização', unidade_medida_id: ha.id, valor_referencia: '12.5' });
    assert.equal(renomear.statusCode, 200, renomear.body);
    assert.equal(renomear.json().nome, 'PULVERIZAÇÃO');
    assert.equal(renomear.json().valor_referencia, '12.5000');
    const sc = await unidade(clienteId, 'SC', false);
    const trocar = await req('PATCH', `/servicos/${s.id}`, token, { empresa_id: e1.id, unidade_medida_id: sc.id });
    assert.equal(trocar.statusCode, 422, trocar.body);
    assert.equal(trocar.json().reason, 'inativo');
    const kg = await unidade(clienteId, 'KG');
    const ok = await req('PATCH', `/servicos/${s.id}`, token, { empresa_id: e1.id, unidade_medida_id: kg.id });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().unidade_medida.sigla, 'KG');
  });
});

describe('D-PROD-203 — Serviços: inativar/reativar, sem DELETE, escopo e unidade em uso', () => {
  test('inativar e reativar (200, idempotentes); sem DELETE (404, nada apagado)', async () => {
    const { token, e1, ha } = await cenario();
    const s = (await criarS(token, servico(e1.id, ha.id))).json();
    const ina = await req('POST', `/servicos/${s.id}/inativar`, token, { empresa_id: e1.id });
    assert.equal(ina.statusCode, 200, ina.body);
    assert.equal(ina.json().ativo, false);
    assert.equal((await req('GET', comEmpresa('/servicos', e1.id, '&ativo=false'), token)).json().total, 1);
    assert.equal((await req('POST', `/servicos/${s.id}/reativar`, token, { empresa_id: e1.id })).json().ativo, true);
    assert.equal((await req('POST', `/servicos/${s.id}/reativar`, token, { empresa_id: e1.id })).statusCode, 200);
    assert.equal((await req('DELETE', comEmpresa(`/servicos/${s.id}`, e1.id), token)).statusCode, 404);
    assert.equal(await prisma().servico.count(), 1);
  });

  test('outra fazenda → 404 SERVICO_NOT_FOUND; outro tenant → 404; nada muda', async () => {
    const A = await cenario();
    const B = await cenario();
    const s = (await criarS(A.token, servico(A.e1.id, A.ha.id))).json();
    for (const [m, url, corpo] of [
      ['GET', comEmpresa(`/servicos/${s.id}`, A.e2.id)],
      ['PATCH', `/servicos/${s.id}`, { empresa_id: A.e2.id, nome: 'movido' }],
      ['POST', `/servicos/${s.id}/inativar`, { empresa_id: A.e2.id }],
    ]) {
      const r = await req(m, url, A.token, corpo);
      assert.equal(r.statusCode, 404, `${m} ${url}: ${r.body}`);
      assert.equal(r.json().code, 'SERVICO_NOT_FOUND');
    }
    assert.equal((await req('GET', comEmpresa(`/servicos/${s.id}`, B.e1.id), B.token)).statusCode, 404);
    assert.equal((await req('PATCH', `/servicos/${s.id}`, B.token, { empresa_id: B.e1.id, nome: 'x' })).statusCode, 404);
    assert.equal((await criarS(B.token, servico(A.e1.id, B.ha.id))).json().code, 'EMPRESA_NOT_FOUND');
    const banco = await prisma().servico.findUnique({ where: { id: s.id } });
    assert.equal(banco.empresa_id, A.e1.id);
    assert.equal(banco.nome, 'APLICAÇÃO AÉREA');
  });

  test('unidade de medida usada por serviço (mesmo inativo) não é excluída: 409 UNIDADE_MEDIDA_DELETE_BLOCKED vinculo servico; livre sai (204)', async () => {
    const { token, clienteId, e1, ha } = await cenario();
    const s = (await criarS(token, servico(e1.id, ha.id))).json();
    await req('POST', `/servicos/${s.id}/inativar`, token, { empresa_id: e1.id });
    const r = await req('DELETE', `/unidades-medida/${ha.id}`, token);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'UNIDADE_MEDIDA_DELETE_BLOCKED');
    assert.equal(r.json().details.vinculo, 'servico');
    assert.ok(await prisma().unidadeMedida.findUnique({ where: { id: ha.id } }), 'a unidade ficou');
    const livre = await unidade(clienteId, 'LIVRE');
    assert.equal((await req('DELETE', `/unidades-medida/${livre.id}`, token)).statusCode, 204);
  });

  test('a fazenda com funcionário ou serviço não sai (409 EMPRESA_COM_VINCULOS)', async () => {
    const { token, e1, e2, ha } = await cenario();
    assert.equal((await criarF(token, funcionario(e1.id))).statusCode, 201);
    assert.equal((await criarS(token, servico(e2.id, ha.id))).statusCode, 201);
    for (const e of [e1, e2]) {
      const r = await req('DELETE', `/empresas/${e.id}`, token);
      assert.equal(r.statusCode, 409, r.body);
      assert.equal(r.json().code, 'EMPRESA_COM_VINCULOS');
    }
  });
});

describe('D-PROD-203 — Funcionários e Serviços: permissão da própria tela', () => {
  test('sem a tela (só outra) → 403 na leitura e na escrita, nada gravado', async () => {
    const cen = await cenario();
    const token = await contaCom(cen, [linha('sup-unidades', acoes(true))]);
    for (const [url, corpo] of [['/funcionarios', funcionario(cen.e1.id)], ['/servicos', servico(cen.e1.id, cen.ha.id)]]) {
      const ler = await req('GET', comEmpresa(url, cen.e1.id), token);
      assert.equal(ler.statusCode, 403, ler.body);
      assert.equal(ler.json().code, 'ACAO_NAO_PERMITIDA');
      assert.equal((await req('POST', url, token, corpo)).statusCode, 403);
    }
    assert.equal(await prisma().funcionario.count(), 0);
    assert.equal(await prisma().servico.count(), 0);
  });

  test('a tela de funcionários não abre a de serviços (e vice-versa)', async () => {
    const cen = await cenario();
    const soF = await contaCom(cen, [linha('sup-funcionarios', acoes(true))]);
    assert.equal((await req('GET', comEmpresa('/funcionarios', cen.e1.id), soF)).statusCode, 200);
    assert.equal((await req('GET', comEmpresa('/servicos', cen.e1.id), soF)).statusCode, 403);
    const soS = await contaCom(cen, [linha('sup-servicos', acoes(true))]);
    assert.equal((await req('GET', comEmpresa('/servicos', cen.e1.id), soS)).statusCode, 200);
    assert.equal((await req('GET', comEmpresa('/funcionarios', cen.e1.id), soS)).statusCode, 403);
  });

  test('opções do centro padrão: só os ATIVOS da fazenda pedida; quem cria ou edita serviço lê, sem a tela de centros; só visualizar → 403', async () => {
    const cen = await cenario();
    await centro(cen.clienteId, cen.e1.id, 'INATIVO', false);
    const url = comEmpresa('/servicos-opcoes/centros-custo', cen.e1.id);
    const adm = await req('GET', url, cen.token);
    assert.equal(adm.statusCode, 200, adm.body);
    assert.deepEqual(adm.json().itens.map((c) => c.id), [cen.cc1.id]);
    const novo = await contaCom(cen, [linha('sup-servicos', { visualizar: true, novo: true })]);
    assert.equal((await req('GET', url, novo)).statusCode, 200);
    const ver = await contaCom(cen, [linha('sup-servicos', { visualizar: true })]);
    assert.equal((await req('GET', url, ver)).statusCode, 403);
    const B = await cenario();
    assert.equal((await req('GET', url, B.token)).statusCode, 404, 'fazenda de outro tenant');
  });

  test('só "visualizar" lê e não grava; "novo" cria; inativar/reativar e PATCH pedem "editar" (ou "salvar")', async () => {
    const cen = await cenario();
    const ver = await contaCom(cen, [linha('sup-funcionarios', { visualizar: true }), linha('sup-servicos', { visualizar: true })]);
    assert.equal((await req('GET', comEmpresa('/funcionarios', cen.e1.id), ver)).statusCode, 200);
    assert.equal((await req('GET', comEmpresa('/servicos', cen.e1.id), ver)).statusCode, 200);
    assert.equal((await criarF(ver, funcionario(cen.e1.id))).statusCode, 403);
    assert.equal((await criarS(ver, servico(cen.e1.id, cen.ha.id))).statusCode, 403);

    const novo = await contaCom(cen, [linha('sup-funcionarios', { visualizar: true, novo: true }), linha('sup-servicos', { visualizar: true, novo: true })]);
    const f = await criarF(novo, funcionario(cen.e1.id));
    assert.equal(f.statusCode, 201, f.body);
    const s = await criarS(novo, servico(cen.e1.id, cen.ha.id));
    assert.equal(s.statusCode, 201, s.body);
    for (const [base, id] of [['/funcionarios', f.json().id], ['/servicos', s.json().id]]) {
      assert.equal((await req('POST', `${base}/${id}/inativar`, novo, { empresa_id: cen.e1.id })).statusCode, 403);
      assert.equal((await req('PATCH', `${base}/${id}`, novo, { empresa_id: cen.e1.id, nome: 'x' })).statusCode, 403);
    }
    // "excluir" não inativa: não há DELETE e inativar é edição do registro.
    const exc = await contaCom(cen, [linha('sup-funcionarios', { visualizar: true, excluir: true })]);
    assert.equal((await req('POST', `/funcionarios/${f.json().id}/inativar`, exc, { empresa_id: cen.e1.id })).statusCode, 403);
    const editar = await contaCom(cen, [linha('sup-funcionarios', { visualizar: true, editar: true }), linha('sup-servicos', { visualizar: true, salvar: true })]);
    assert.equal((await req('POST', `/funcionarios/${f.json().id}/inativar`, editar, { empresa_id: cen.e1.id })).statusCode, 200);
    assert.equal((await req('POST', `/funcionarios/${f.json().id}/reativar`, editar, { empresa_id: cen.e1.id })).statusCode, 200);
    assert.equal((await req('POST', `/servicos/${s.json().id}/inativar`, editar, { empresa_id: cen.e1.id })).statusCode, 200);
    assert.equal((await req('PATCH', `/servicos/${s.json().id}`, editar, { empresa_id: cen.e1.id, nome: 'novo nome' })).statusCode, 200);
  });
});
