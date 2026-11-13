/**
 * D-PROD-185 — MAIKE-CATEGORIA-MANEJO-ENXUGAR (Fatia C): o contrato de
 * CategoriaManejo fica com nome, sigla, espécie, sexo, faixa de idade e o
 * vínculo com o ícone do catálogo global. `raca`, `categoria_oficial`,
 * `ganho_peso_anual_kg` e `gmd_janeiro`…`gmd_dezembro` saem da API: cliente
 * antigo que ainda as envia é aceito e as chaves são IGNORADAS (padrão da
 * D-PROD-181). As colunas estão `@ignore` no schema (fora do Prisma Client) e
 * seguem no banco até o DROP da Fatia D — por isso este teste as lê e as
 * semeia por SQL cru.
 *
 * PostgreSQL real.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { CHAVES_LEGADAS_IGNORADAS } from '../src/modules/categoriasManejo/categoriaManejoService.js';
import { colunasGravaveis } from '../src/shared/prisma/colunasGravaveis.js';
import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;

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

const auth = (token) => ({ authorization: `Bearer ${token}` });
const prisma = () => getPrismaClient();

const tenantComToken = async () => {
  const { cliente, credenciais } = await criarTenant();
  const { corpo } = await autenticarNoApp(app, credenciais);
  return { cliente, token: corpo.token };
};

const CAMPOS_PUBLICOS = [
  'ativo',
  'catalogo_categoria_visual_id',
  'created_date',
  'empresa_id',
  'especie',
  'id',
  'idade_maxima_meses',
  'idade_minima_meses',
  'nome',
  'sexo',
  'sigla',
  'updated_date',
].sort();

const MESES = [
  'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** Corpo de cliente antigo: todas as chaves que saíram do contrato. */
const LEGADO = Object.freeze({
  raca: 'NELORE',
  categoria_oficial: 'Bezerro',
  ganho_peso_anual_kg: '180.5',
  ...Object.fromEntries(MESES.map((m, i) => [`gmd_${m}`, String(0.4 + i / 100)])),
});

const BASE = Object.freeze({ empresa_id: 'emp-1', nome: 'BEZERRO DESMAMA', sigla: 'BD', especie: 'Bovinos', sexo: 'Macho' });

const criar = (token, payload) =>
  app.inject({ method: 'POST', url: '/categorias-manejo', headers: auth(token), payload });
const atualizar = (token, id, payload) =>
  app.inject({ method: 'PATCH', url: `/categorias-manejo/${id}`, headers: auth(token), payload });
const listar = (token) => app.inject({ method: 'GET', url: '/categorias-manejo', headers: auth(token) });

/** Linha pelo Prisma Client (sem as colunas `@ignore`). */
const linha = (id) => prisma().categoriaManejo.findUnique({ where: { id } });

/** As 15 colunas dormentes, lidas por SQL cru (o Client não as enxerga). */
const colunasDormentes = async (id) => {
  const lista = CHAVES_LEGADAS_IGNORADAS.map((c) => `"${c}"`).join(', ');
  const [linhaCrua] = await prisma().$queryRawUnsafe(`SELECT ${lista} FROM "CategoriaManejo" WHERE id = $1`, id);
  return linhaCrua;
};

/** Linha "antiga": criada pelo Client e com colunas dormentes preenchidas por SQL. */
const criarLinhaAntiga = async (clienteId, nome) => {
  const criada = await prisma().categoriaManejo.create({ data: { cliente_id: clienteId, empresa_id: 'emp-1', nome } });
  await prisma().$executeRaw`UPDATE "CategoriaManejo" SET raca = 'NELORE', categoria_oficial = ${nome}, gmd_janeiro = 0.5 WHERE id = ${criada.id}`;
  return criada;
};

const assertSemLegado = (objeto, rotulo) => {
  for (const chave of CHAVES_LEGADAS_IGNORADAS) assert.equal(chave in objeto, false, `${rotulo}: ${chave}`);
};

const assertColunasDormentesVazias = async (id) => {
  const crua = await colunasDormentes(id);
  for (const chave of CHAVES_LEGADAS_IGNORADAS) assert.equal(crua[chave], null, `coluna dormente ${chave} gravada`);
};

const esperar400 = (r, reason) => {
  assert.equal(r.statusCode, 400, r.body);
  assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED');
  if (reason) assert.equal(r.json().reason, reason, r.body);
};

describe('CategoriaManejo enxuta (D-PROD-185)', () => {
  test('E-00 a lista legada é fechada: raca, categoria_oficial, ganho_peso_anual_kg e os 12 gmd_*', () => {
    assert.deepEqual(
      [...CHAVES_LEGADAS_IGNORADAS].sort(),
      ['categoria_oficial', 'ganho_peso_anual_kg', 'raca', ...MESES.map((m) => `gmd_${m}`)].sort()
    );
    assert.equal(Object.isFrozen(CHAVES_LEGADAS_IGNORADAS), true);
    // `@ignore`: fora do Prisma Client — o allowlist do corpo não as conhece.
    const gravaveis = colunasGravaveis('CategoriaManejo');
    for (const chave of CHAVES_LEGADAS_IGNORADAS) assert.equal(gravaveis.has(chave), false, chave);
    assert.deepEqual(
      [...gravaveis].sort(),
      ['ativo', 'catalogo_categoria_visual_id', 'empresa_id', 'especie', 'idade_maxima_meses', 'idade_minima_meses', 'nome', 'sexo', 'sigla']
    );
  });

  test('E-01 POST com chaves legadas → 201; nada delas é gravado, devolvido ou auditado', async () => {
    const { token } = await tenantComToken();
    const r = await criar(token, { ...BASE, ...LEGADO, idade_minima_meses: 8, idade_maxima_meses: 12 });
    assert.equal(r.statusCode, 201, r.body);
    const corpo = r.json();
    assert.deepEqual(Object.keys(corpo).sort(), CAMPOS_PUBLICOS);
    assertSemLegado(corpo, 'resposta');
    assert.equal(corpo.nome, 'BEZERRO DESMAMA');
    assert.equal(corpo.sexo, 'Macho');
    assert.equal(corpo.idade_minima_meses, 8);
    assert.equal(corpo.idade_maxima_meses, 12);

    await assertColunasDormentesVazias(corpo.id);

    const [evento] = await prisma().auditLog.findMany({ where: { entidade: 'CategoriaManejo', entidade_id: corpo.id } });
    assert.ok(evento, 'create auditado');
    assert.deepEqual(Object.keys(evento.dados_novos).sort(), CAMPOS_PUBLICOS);
    assertSemLegado(evento.dados_novos, 'auditoria');
  });

  test('E-02 PATCH só com chaves legadas → 200 e nenhum efeito na linha', async () => {
    const { token } = await tenantComToken();
    const id = (await criar(token, BASE)).json().id;
    const antes = await linha(id);

    const r = await atualizar(token, id, { raca: 'ANGUS', categoria_oficial: 'Garrote', gmd_maio: '0.9', ganho_peso_anual_kg: null });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(Object.keys(r.json()).sort(), CAMPOS_PUBLICOS);
    assertSemLegado(r.json(), 'resposta');
    assert.equal(r.json().nome, 'BEZERRO DESMAMA');

    const depois = await linha(id);
    assert.deepEqual(depois, antes, 'linha intocada (inclusive updatedAt)');

    const eventos = await prisma().auditLog.findMany({
      where: { entidade: 'CategoriaManejo', entidade_id: id, acao: 'update' },
    });
    assert.equal(eventos.length, 1, 'a edição é auditada, como na D-PROD-181');
    assert.deepEqual(eventos[0].dados_novos, eventos[0].dados_anteriores, 'antes = depois');
    assertSemLegado(eventos[0].dados_anteriores, 'auditoria');
  });

  test('E-03 PATCH misto aplica só o campo real', async () => {
    const { token } = await tenantComToken();
    const id = (await criar(token, BASE)).json().id;

    const r = await atualizar(token, id, { nome: 'GARROTE', raca: 'ANGUS', gmd_dezembro: '1.1' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().nome, 'GARROTE');
    assertSemLegado(r.json(), 'resposta');

    assert.equal((await linha(id)).nome, 'GARROTE');
    await assertColunasDormentesVazias(id);
  });

  test('E-04 lista expõe exatamente os campos públicos, mesmo com colunas dormentes preenchidas no banco', async () => {
    const { cliente, token } = await tenantComToken();
    // Linha antiga: colunas dormentes preenchidas direto no banco.
    await criarLinhaAntiga(cliente.id, 'VACA');
    await criar(token, BASE);

    const r = await listar(token);
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().length, 2);
    for (const item of r.json()) {
      assert.deepEqual(Object.keys(item).sort(), CAMPOS_PUBLICOS);
      assertSemLegado(item, 'lista');
    }
  });

  test('E-05 PATCH sobre linha antiga com colunas dormentes: não as devolve nem as audita, e não as apaga', async () => {
    const { cliente, token } = await tenantComToken();
    const antiga = await criarLinhaAntiga(cliente.id, 'VACA');
    const r = await atualizar(token, antiga.id, { sigla: 'VC' });
    assert.equal(r.statusCode, 200, r.body);
    assertSemLegado(r.json(), 'resposta');
    const [evento] = await prisma().auditLog.findMany({ where: { entidade_id: antiga.id, acao: 'update' } });
    assertSemLegado(evento.dados_anteriores, 'auditoria antes');
    assertSemLegado(evento.dados_novos, 'auditoria depois');
    const crua = await colunasDormentes(antiga.id);
    assert.equal(crua.raca, 'NELORE', 'dado dormente fica no banco até a Fatia D');
    assert.equal(crua.categoria_oficial, 'VACA');
  });

  test('E-06 chave desconhecida que não está na lista legada continua 400', async () => {
    const { token } = await tenantComToken();
    esperar400(await criar(token, { ...BASE, gmd_trimestre: '1' }));
    const id = (await criar(token, BASE)).json().id;
    esperar400(await atualizar(token, id, { raca_padrao: 'X' }));
  });

  test('E-07 idade mínima > máxima → 400 (POST e PATCH), nada gravado', async () => {
    const { token } = await tenantComToken();
    const antes = await prisma().categoriaManejo.count();
    esperar400(await criar(token, { ...BASE, idade_minima_meses: 13, idade_maxima_meses: 12 }), 'idade_minima_maior_que_maxima');
    assert.equal(await prisma().categoriaManejo.count(), antes);

    const id = (await criar(token, { ...BASE, idade_minima_meses: 6, idade_maxima_meses: 12 })).json().id;
    // Só um lado enviado: compara com o valor já gravado.
    esperar400(await atualizar(token, id, { idade_minima_meses: 13 }), 'idade_minima_maior_que_maxima');
    esperar400(await atualizar(token, id, { idade_maxima_meses: 5 }), 'idade_minima_maior_que_maxima');
    const gravada = await linha(id);
    assert.equal(gravada.idade_minima_meses, 6);
    assert.equal(gravada.idade_maxima_meses, 12);
  });

  test('E-08 idade mínima ≤ máxima é aceita; texto só com dígitos vira inteiro', async () => {
    const { token } = await tenantComToken();
    let r = await criar(token, { ...BASE, idade_minima_meses: 12, idade_maxima_meses: 12 });
    assert.equal(r.statusCode, 201, r.body);
    r = await criar(token, { ...BASE, idade_minima_meses: '0', idade_maxima_meses: ' 24 ' });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().idade_minima_meses, 0);
    assert.equal(r.json().idade_maxima_meses, 24);

    const id = r.json().id;
    r = await atualizar(token, id, { idade_minima_meses: 24 });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().idade_minima_meses, 24);
  });

  test('E-09 idades nulas, vazias ou ausentes são aceitas; limpar um lado libera o outro', async () => {
    const { token } = await tenantComToken();
    for (const extra of [{}, { idade_minima_meses: null, idade_maxima_meses: null }, { idade_minima_meses: '', idade_maxima_meses: '' }]) {
      const r = await criar(token, { ...BASE, ...extra });
      assert.equal(r.statusCode, 201, r.body);
      assert.equal(r.json().idade_minima_meses, null);
      assert.equal(r.json().idade_maxima_meses, null);
    }
    const id = (await criar(token, { ...BASE, idade_minima_meses: 6, idade_maxima_meses: 12 })).json().id;
    let r = await atualizar(token, id, { idade_maxima_meses: null });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().idade_maxima_meses, null);
    r = await atualizar(token, id, { idade_minima_meses: 40 });
    assert.equal(r.statusCode, 200, r.body, 'sem máxima, qualquer mínima vale');
  });

  test('E-10 idade negativa, fracionária ou não numérica → 400', async () => {
    const { token } = await tenantComToken();
    for (const valor of [-1, 1.5, 'abc', '-3', '1.5', true, {}]) {
      esperar400(await criar(token, { ...BASE, idade_minima_meses: valor }), 'inteiro_nao_negativo');
    }
    esperar400(await criar(token, { ...BASE, idade_maxima_meses: 2 ** 31 }), 'inteiro_nao_negativo');
    assert.equal(await prisma().categoriaManejo.count(), 0);
  });
});
