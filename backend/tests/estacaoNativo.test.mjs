/**
 * Estações da fazenda (D-PROD-188), tabela física "CADESTACOES" — PostgreSQL real.
 *
 * Cadastro novo, sem vínculo com nenhum outro: nome em MAIÚSCULAS e único por
 * fazenda, tipo fechado (AGUAS | TRANSICAO | SECA), dia civil real, fim >=
 * início, estações ATIVAS da mesma fazenda sem sobreposição (inclusive sob
 * corrida), isolamento por tenant e por fazenda, exclusão física, permissão
 * pela própria tela `pec-estacoes` (leitura incluída), CHECKs e RLS no banco e
 * a fazenda com estação não sai (409 `EMPRESA_COM_VINCULOS` + FK Restrict).
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
  'ativo', 'created_date', 'data_fim', 'data_inicio', 'empresa_id', 'id', 'nome', 'observacoes', 'tipo', 'updated_date',
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
const contaCom = async (cen, permissoes_telas, modulos = ['manejo']) => {
  const senha = cen.adm.credenciais.senha;
  const hash = (await prisma().usuario.findUnique({ where: { id: cen.adm.usuario.id } })).senha_hash;
  const login = `op-${randomUUID().slice(0, 8)}`;
  await prisma().usuario.create({ data: { cliente_id: cen.clienteId, nome: 'Op', login, senha_hash: hash, papel_tenant: 'usuario' } });
  await prisma().permissao.create({ data: { cliente_id: cen.clienteId, user_email: login, user_nome: 'Op', modulos_permitidos: modulos, permissoes_telas } });
  const { corpo } = await autenticarNoApp(app, { login, senha });
  assert.ok(corpo.token, 'login da conta comum');
  return corpo.token;
};

const base = (empresaId, extra = {}) => ({
  empresa_id: empresaId,
  nome: 'águas 2026/2027',
  tipo: 'AGUAS',
  data_inicio: '2026-11-01',
  data_fim: '2027-04-30',
  ...extra,
});

const criar = (token, payload) => req('POST', '/estacoes', token, payload);
const comEmpresa = (url, empresaId) => `${url}?empresa_id=${encodeURIComponent(empresaId)}`;

describe('D-PROD-188 — Estações: criação, leitura e formato público', () => {
  test('GET /estacoes sem token → 401', async () => {
    const r = await req('GET', '/estacoes?empresa_id=x');
    assert.equal(r.statusCode, 401);
  });

  test('POST cria (201): nome e observações em MAIÚSCULAS, datas AAAA-MM-DD, ativo por padrão, chaves exatas; GET lista e detalha', async () => {
    const { token, clienteId, e1 } = await cenario();
    const r = await criar(token, base(e1.id, { observacoes: 'chuva acima da média' }));
    assert.equal(r.statusCode, 201, r.body);
    const e = r.json();
    assert.deepEqual(Object.keys(e).sort(), CAMPOS_PUBLICOS);
    assert.equal(e.nome, 'ÁGUAS 2026/2027');
    assert.equal(e.observacoes, 'CHUVA ACIMA DA MÉDIA');
    assert.equal(e.tipo, 'AGUAS');
    assert.equal(e.data_inicio, '2026-11-01');
    assert.equal(e.data_fim, '2027-04-30');
    assert.equal(e.ativo, true);
    assert.equal(e.empresa_id, e1.id);

    const lista = await req('GET', comEmpresa('/estacoes', e1.id), token);
    assert.equal(lista.statusCode, 200, lista.body);
    assert.equal(lista.json().length, 1);
    assert.deepEqual(Object.keys(lista.json()[0]).sort(), CAMPOS_PUBLICOS);

    const um = await req('GET', comEmpresa(`/estacoes/${e.id}`, e1.id), token);
    assert.equal(um.statusCode, 200, um.body);
    assert.equal(um.json().data_fim, '2027-04-30');

    const linhaBanco = await prisma().cadEstacao.findUnique({ where: { id: e.id } });
    assert.equal(linhaBanco.cliente_id, clienteId, 'tenant gravado a partir da sessão');
  });

  test('a lista vem da fazenda pedida, ordenada pelo início mais recente; outra fazenda não enxerga', async () => {
    const { token, e1, e2 } = await cenario();
    assert.equal((await criar(token, base(e1.id, { nome: 'seca 2026', tipo: 'SECA', data_inicio: '2026-05-01', data_fim: '2026-09-30' }))).statusCode, 201);
    assert.equal((await criar(token, base(e1.id))).statusCode, 201);
    const lista = (await req('GET', comEmpresa('/estacoes', e1.id), token)).json();
    assert.deepEqual(lista.map((x) => x.data_inicio), ['2026-11-01', '2026-05-01']);
    assert.equal((await req('GET', comEmpresa('/estacoes', e2.id), token)).json().length, 0);
    const id = lista[0].id;
    const deOutra = await req('GET', comEmpresa(`/estacoes/${id}`, e2.id), token);
    assert.equal(deOutra.statusCode, 404, deOutra.body);
    assert.equal(deOutra.json().code, 'ESTACAO_NOT_FOUND');
  });

  test('mesmo nome é permitido em fazendas diferentes; na mesma fazenda → 409 ESTACAO_NAME_CONFLICT (sem diferença de maiúsculas)', async () => {
    const { token, e1, e2 } = await cenario();
    assert.equal((await criar(token, base(e1.id))).statusCode, 201);
    assert.equal((await criar(token, base(e2.id))).statusCode, 201, 'outra fazenda');
    const dup = await criar(token, base(e1.id, { nome: 'ÁGUAS 2026/2027', data_inicio: '2028-01-01', data_fim: '2028-02-01' }));
    assert.equal(dup.statusCode, 409, dup.body);
    assert.equal(dup.json().code, 'ESTACAO_NAME_CONFLICT');
  });
});

describe('D-PROD-188 — Estações: validação do corpo', () => {
  test('campos fora do schema (cliente_id, chave extra) → 400 e nada gravado', async () => {
    const { token, clienteId, e1 } = await cenario();
    for (const extra of [{ cliente_id: clienteId }, { curva_id: 'x' }, { lote_id: 'x' }]) {
      const r = await criar(token, base(e1.id, extra));
      assert.equal(r.statusCode, 400, `${JSON.stringify(extra)} ${r.body}`);
    }
    assert.equal(await prisma().cadEstacao.count(), 0);
  });

  test('obrigatórios: empresa_id, nome, tipo, data_inicio, data_fim → 400', async () => {
    const { token, e1 } = await cenario();
    for (const campo of ['empresa_id', 'nome', 'tipo', 'data_inicio', 'data_fim']) {
      const corpo = base(e1.id);
      delete corpo[campo];
      const r = await criar(token, corpo);
      assert.equal(r.statusCode, 400, `${campo}: ${r.body}`);
    }
    assert.equal((await criar(token, base(e1.id, { nome: '   ' }))).statusCode, 400, 'nome em branco');
  });

  test('tipo fora de AGUAS/TRANSICAO/SECA → 400; os três aceitos', async () => {
    const { token, e1 } = await cenario();
    for (const tipo of ['CHUVOSO', 'aguas', 'Seca', '']) {
      assert.equal((await criar(token, base(e1.id, { tipo }))).statusCode, 400, tipo);
    }
    const periodos = [['AGUAS', '2026-11-01', '2027-03-31'], ['TRANSICAO', '2027-04-01', '2027-05-15'], ['SECA', '2027-05-16', '2027-09-30']];
    for (const [tipo, data_inicio, data_fim] of periodos) {
      const r = await criar(token, base(e1.id, { nome: tipo, tipo, data_inicio, data_fim }));
      assert.equal(r.statusCode, 201, `${tipo}: ${r.body}`);
    }
  });

  test('datas: formato, dia inexistente, ano fora da faixa e fim antes do início → 400; fim = início aceito', async () => {
    const { token, e1 } = await cenario();
    const ruins = [
      { data_inicio: '01/11/2026' },
      { data_inicio: '2026-11-01T00:00:00Z' },
      { data_inicio: '2026-02-30' },
      { data_fim: '2027-13-01' },
      { data_inicio: '1899-12-31' },
      { data_fim: '2101-01-01' },
      { data_inicio: '2026-11-02', data_fim: '2026-11-01' },
    ];
    for (const extra of ruins) {
      const r = await criar(token, base(e1.id, extra));
      assert.equal(r.statusCode, 400, `${JSON.stringify(extra)}: ${r.body}`);
    }
    assert.equal(await prisma().cadEstacao.count(), 0);
    const umDia = await criar(token, base(e1.id, { data_inicio: '2026-11-01', data_fim: '2026-11-01' }));
    assert.equal(umDia.statusCode, 201, umDia.body);
    assert.equal(umDia.json().data_fim, '2026-11-01', 'o dia não desloca com o fuso');
  });

  test('observações com marcação HTML ou caractere de controle → 400', async () => {
    const { token, e1 } = await cenario();
    assert.equal((await criar(token, base(e1.id, { observacoes: '<b>x</b>' }))).statusCode, 400);
    assert.equal((await criar(token, base(e1.id, { observacoes: 'a\u0000b' }))).statusCode, 400);
  });
});

describe('D-PROD-188 — Estações: sobreposição de períodos', () => {
  test('ativa que encosta em outra ativa da mesma fazenda → 409 ESTACAO_PERIODO_SOBREPOSTO com a estação em conflito; dia seguinte aceito', async () => {
    const { token, e1, e2 } = await cenario();
    const a = (await criar(token, base(e1.id))).json();
    const casos = [
      ['2027-04-30', '2027-09-30', 'fim de uma = início da outra'],
      ['2026-10-01', '2026-11-01', 'início de uma = fim da outra'],
      ['2026-12-01', '2027-01-31', 'contida'],
      ['2026-01-01', '2028-01-01', 'contém'],
    ];
    for (const [data_inicio, data_fim, rotulo] of casos) {
      const r = await criar(token, base(e1.id, { nome: rotulo, data_inicio, data_fim }));
      assert.equal(r.statusCode, 409, `${rotulo}: ${r.body}`);
      assert.equal(r.json().code, 'ESTACAO_PERIODO_SOBREPOSTO');
      assert.equal(r.json().details.estacao_id, a.id);
    }
    assert.equal((await criar(token, base(e1.id, { nome: 'seca', tipo: 'SECA', data_inicio: '2027-05-01', data_fim: '2027-09-30' }))).statusCode, 201);
    assert.equal((await criar(token, base(e2.id))).statusCode, 201, 'outra fazenda não conflita');
  });

  test('estação inativa não entra na regra; reativar uma que se sobrepõe → 409', async () => {
    const { token, e1 } = await cenario();
    const inativa = (await criar(token, base(e1.id, { nome: 'prevista', ativo: false }))).json();
    assert.equal(inativa.ativo, false);
    const ativa = await criar(token, base(e1.id, { nome: 'real' }));
    assert.equal(ativa.statusCode, 201, 'a inativa não bloqueia');
    const reativar = await req('PATCH', `/estacoes/${inativa.id}`, token, { empresa_id: e1.id, ativo: true });
    assert.equal(reativar.statusCode, 409, reativar.body);
    assert.equal(reativar.json().code, 'ESTACAO_PERIODO_SOBREPOSTO');
    assert.equal((await prisma().cadEstacao.findUnique({ where: { id: inativa.id } })).ativo, false, 'nada mudou');
  });

  test('editar a própria estação não conflita com ela mesma; mover para cima de outra → 409', async () => {
    const { token, e1 } = await cenario();
    const a = (await criar(token, base(e1.id))).json();
    const b = (await criar(token, base(e1.id, { nome: 'seca', tipo: 'SECA', data_inicio: '2027-05-01', data_fim: '2027-09-30' }))).json();
    const estender = await req('PATCH', `/estacoes/${a.id}`, token, { empresa_id: e1.id, data_fim: '2027-04-15' });
    assert.equal(estender.statusCode, 200, estender.body);
    const invadir = await req('PATCH', `/estacoes/${b.id}`, token, { empresa_id: e1.id, data_inicio: '2027-04-15' });
    assert.equal(invadir.statusCode, 409, invadir.body);
  });

  test('corrida: duas criações simultâneas sobrepostas na mesma fazenda → exatamente uma passa', async () => {
    const { token, e1 } = await cenario();
    const [r1, r2] = await Promise.all([
      criar(token, base(e1.id, { nome: 'A' })),
      criar(token, base(e1.id, { nome: 'B', data_inicio: '2027-01-01', data_fim: '2027-06-30' })),
    ]);
    assert.deepEqual([r1.statusCode, r2.statusCode].sort(), [201, 409], `${r1.body} | ${r2.body}`);
    assert.equal(await prisma().cadEstacao.count(), 1);
  });

  test('corrida: duas criações simultâneas com o mesmo nome (períodos distintos) → uma 201 e uma 409 de nome, nunca 500', async () => {
    const { token, e1 } = await cenario();
    const [r1, r2] = await Promise.all([
      criar(token, base(e1.id, { nome: 'X', data_inicio: '2026-01-01', data_fim: '2026-01-31' })),
      criar(token, base(e1.id, { nome: 'X', data_inicio: '2026-03-01', data_fim: '2026-03-31' })),
    ]);
    assert.deepEqual([r1.statusCode, r2.statusCode].sort(), [201, 409], `${r1.body} | ${r2.body}`);
    const perdedor = r1.statusCode === 409 ? r1 : r2;
    assert.equal(perdedor.json().code, 'ESTACAO_NAME_CONFLICT');
  });
});

describe('D-PROD-188 — Estações: edição, exclusão e escopo', () => {
  test('PATCH altera e valida fim >= início contra o valor gravado; sem empresa_id ou só empresa_id → 400', async () => {
    const { token, e1 } = await cenario();
    const a = (await criar(token, base(e1.id))).json();
    const r = await req('PATCH', `/estacoes/${a.id}`, token, { empresa_id: e1.id, nome: 'águas 26/27', tipo: 'TRANSICAO', observacoes: null });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().nome, 'ÁGUAS 26/27');
    assert.equal(r.json().tipo, 'TRANSICAO');
    assert.equal(r.json().observacoes, null);
    const invertido = await req('PATCH', `/estacoes/${a.id}`, token, { empresa_id: e1.id, data_inicio: '2027-05-01' });
    assert.equal(invertido.statusCode, 400, invertido.body);
    assert.equal((await req('PATCH', `/estacoes/${a.id}`, token, { nome: 'Z' })).statusCode, 400, 'sem empresa_id');
    assert.equal((await req('PATCH', `/estacoes/${a.id}`, token, { empresa_id: e1.id })).statusCode, 400, 'nada para alterar');
  });

  test('PATCH pela fazenda errada → 404 e nada muda (a estação não troca de fazenda)', async () => {
    const { token, e1, e2 } = await cenario();
    const a = (await criar(token, base(e1.id))).json();
    const r = await req('PATCH', `/estacoes/${a.id}`, token, { empresa_id: e2.id, nome: 'movida' });
    assert.equal(r.statusCode, 404, r.body);
    const banco = await prisma().cadEstacao.findUnique({ where: { id: a.id } });
    assert.equal(banco.empresa_id, e1.id);
    assert.equal(banco.nome, 'ÁGUAS 2026/2027');
  });

  test('DELETE apaga (204) e some (404); pela fazenda errada → 404; auditoria de create/update/delete', async () => {
    const { token, clienteId, e1, e2 } = await cenario();
    const a = (await criar(token, base(e1.id))).json();
    await req('PATCH', `/estacoes/${a.id}`, token, { empresa_id: e1.id, nome: 'renomeada' });
    assert.equal((await req('DELETE', comEmpresa(`/estacoes/${a.id}`, e2.id), token)).statusCode, 404);
    const r = await req('DELETE', comEmpresa(`/estacoes/${a.id}`, e1.id), token);
    assert.equal(r.statusCode, 204, r.body);
    assert.equal((await req('GET', comEmpresa(`/estacoes/${a.id}`, e1.id), token)).statusCode, 404);
    assert.equal(await prisma().cadEstacao.count(), 0);
    const eventos = await prisma().auditLog.findMany({ where: { cliente_id: clienteId, entidade: 'CadEstacao' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(eventos.map((x) => x.acao), ['create', 'update', 'delete']);
  });

  test('fazenda de outro tenant ou inexistente → 404 EMPRESA_NOT_FOUND; tenant B não vê nem altera estação de A', async () => {
    const A = await cenario();
    const B = await cenario();
    const a = (await criar(A.token, base(A.e1.id))).json();
    const naFazendaDeA = await criar(B.token, base(A.e1.id));
    assert.equal(naFazendaDeA.statusCode, 404, naFazendaDeA.body);
    assert.equal(naFazendaDeA.json().code, 'EMPRESA_NOT_FOUND');
    assert.equal((await req('GET', comEmpresa('/estacoes', A.e1.id), B.token)).statusCode, 404);
    assert.equal((await req('GET', comEmpresa(`/estacoes/${a.id}`, B.e1.id), B.token)).statusCode, 404);
    assert.equal((await req('PATCH', `/estacoes/${a.id}`, B.token, { empresa_id: B.e1.id, nome: 'x' })).statusCode, 404);
    assert.equal((await req('DELETE', comEmpresa(`/estacoes/${a.id}`, B.e1.id), B.token)).statusCode, 404);
    assert.equal((await criar(A.token, base('nao-existe'))).statusCode, 404);
    assert.equal((await prisma().cadEstacao.findUnique({ where: { id: a.id } })).nome, 'ÁGUAS 2026/2027');
  });

  test('excluir a fazenda que tem estação → 409 EMPRESA_COM_VINCULOS (e a FK Restrict segura no banco)', async () => {
    const { token, e1 } = await cenario();
    assert.equal((await criar(token, base(e1.id))).statusCode, 201);
    const r = await req('DELETE', `/empresas/${e1.id}`, token);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'EMPRESA_COM_VINCULOS');
    await assert.rejects(prisma().empresa.delete({ where: { id: e1.id } }));
  });
});

describe('D-PROD-188 — Estações: permissão da tela pec-estacoes', () => {
  test('sem a tela (só pec-lotes) → 403 na leitura e na escrita, nada gravado', async () => {
    const cen = await cenario();
    const token = await contaCom(cen, [linha('pec-lotes', { visualizar: true, novo: true, salvar: true, editar: true, excluir: true })]);
    const ler = await req('GET', comEmpresa('/estacoes', cen.e1.id), token);
    assert.equal(ler.statusCode, 403, ler.body);
    assert.equal(ler.json().code, 'ACAO_NAO_PERMITIDA');
    const gravar = await criar(token, base(cen.e1.id));
    assert.equal(gravar.statusCode, 403, gravar.body);
    assert.equal(await prisma().cadEstacao.count(), 0);
  });

  test('só "visualizar" lê (200) e não cria (403); "novo" cria (201); "excluir" exclui', async () => {
    const cen = await cenario();
    const ver = await contaCom(cen, [linha('pec-estacoes', { visualizar: true })]);
    assert.equal((await req('GET', comEmpresa('/estacoes', cen.e1.id), ver)).statusCode, 200);
    assert.equal((await criar(ver, base(cen.e1.id))).statusCode, 403);
    const novo = await contaCom(cen, [linha('pec-estacoes', { visualizar: true, novo: true })]);
    const criada = await criar(novo, base(cen.e1.id));
    assert.equal(criada.statusCode, 201, criada.body);
    assert.equal((await req('DELETE', comEmpresa(`/estacoes/${criada.json().id}`, cen.e1.id), novo)).statusCode, 403);
    const exc = await contaCom(cen, [linha('pec-estacoes', { visualizar: true, excluir: true })]);
    assert.equal((await req('DELETE', comEmpresa(`/estacoes/${criada.json().id}`, cen.e1.id), exc)).statusCode, 204);
  });
});

describe('D-PROD-188 — CADESTACOES no banco: nome físico, CHECKs e RLS', () => {
  test('a tabela física chama "CADESTACOES", tem RLS ligado e os CHECKs de tipo e período barram escrita direta', async () => {
    const { clienteId, e1 } = await cenario();
    const [tabela] = await prisma().$queryRaw`SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'CADESTACOES' AND relkind = 'r'`;
    assert.ok(tabela, 'tabela "CADESTACOES" existe');
    assert.equal(tabela.relrowsecurity, true, 'RLS ligado');
    const dados = { cliente_id: clienteId, empresa_id: e1.id, nome: 'X', data_inicio: new Date('2026-01-01T00:00:00Z'), data_fim: new Date('2026-01-31T00:00:00Z') };
    await assert.rejects(prisma().cadEstacao.create({ data: { ...dados, tipo: 'CHUVOSO' } }), /CADESTACOES_tipo_check|check constraint/i);
    await assert.rejects(
      prisma().cadEstacao.create({ data: { ...dados, tipo: 'SECA', data_fim: new Date('2025-12-31T00:00:00Z') } }),
      /CADESTACOES_periodo_check|check constraint/i
    );
    assert.equal(await prisma().cadEstacao.count(), 0);
  });
});
