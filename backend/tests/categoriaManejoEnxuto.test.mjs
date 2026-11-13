/**
 * D-PROD-186 — MAIKE-CATEGORIA-MANEJO-ENXUGAR (Fatia C): o contrato de
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
import { FAIXAS_IDADE_CATEGORIA_MANEJO } from '../src/modules/movimentacoesMapa/categoriaOficialDerivada.js';
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

/** POST válido: sexo e faixa de idade (uma das cinco fixas) são obrigatórios. */
const BASE = Object.freeze({
  empresa_id: 'emp-1',
  nome: 'BEZERRO DESMAMA',
  sigla: 'BD',
  especie: 'Bovinos',
  sexo: 'Macho',
  idade_minima_meses: 0,
  idade_maxima_meses: 8,
});

/** As cinco faixas fixas (decisão do proprietário, 2026-11-13). */
const FAIXAS = [
  [0, 8],
  [9, 12],
  [13, 24],
  [25, 36],
  [37, null],
];

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

describe('CategoriaManejo enxuta (D-PROD-186)', () => {
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
    const r = await criar(token, { ...BASE, ...LEGADO, idade_minima_meses: 9, idade_maxima_meses: 12 });
    assert.equal(r.statusCode, 201, r.body);
    const corpo = r.json();
    assert.deepEqual(Object.keys(corpo).sort(), CAMPOS_PUBLICOS);
    assertSemLegado(corpo, 'resposta');
    assert.equal(corpo.nome, 'BEZERRO DESMAMA');
    assert.equal(corpo.sexo, 'Macho');
    assert.equal(corpo.idade_minima_meses, 9);
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

  /**
   * Linha "legada" com faixa INVERTIDA (e sexo fora da lista) gravada direto no
   * banco: o cadastro novo nunca a criaria, mas produção pode tê-la.
   */
  const criarLinhaInvertida = async (clienteId) => {
    const criada = await prisma().categoriaManejo.create({ data: { cliente_id: clienteId, empresa_id: 'emp-1', nome: 'INVERTIDA' } });
    await prisma().$executeRaw`UPDATE "CategoriaManejo" SET idade_minima_meses = 24, idade_maxima_meses = 12, sexo = 'Misto' WHERE id = ${criada.id}`;
    return criada;
  };

  test('E-07 a lista fixa tem exatamente as cinco faixas, cada uma dentro de uma faixa oficial', () => {
    assert.deepEqual(
      FAIXAS_IDADE_CATEGORIA_MANEJO.map((f) => [f.rotulo, f.idade_minima_meses, f.idade_maxima_meses]),
      [
        ['0 a 8 meses', 0, 8],
        ['9 a 12 meses', 9, 12],
        ['13 a 24 meses', 13, 24],
        ['25 a 36 meses', 25, 36],
        ['Maior que 36 meses', 37, null],
      ]
    );
    assert.equal(Object.isFrozen(FAIXAS_IDADE_CATEGORIA_MANEJO), true);
  });

  test('E-08 POST: cada uma das cinco faixas → 201 com o par gravado; texto só com dígitos vira inteiro', async () => {
    const { token } = await tenantComToken();
    for (const [minima, maxima] of FAIXAS) {
      const r = await criar(token, { ...BASE, idade_minima_meses: minima, idade_maxima_meses: maxima });
      assert.equal(r.statusCode, 201, r.body);
      assert.deepEqual([r.json().idade_minima_meses, r.json().idade_maxima_meses], [minima, maxima]);
      assert.deepEqual([(await linha(r.json().id)).idade_minima_meses, (await linha(r.json().id)).idade_maxima_meses], [minima, maxima]);
    }
    const r = await criar(token, { ...BASE, idade_minima_meses: ' 13 ', idade_maxima_meses: '24' });
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual([r.json().idade_minima_meses, r.json().idade_maxima_meses], [13, 24]);
    // 37 sem máxima: a máxima ausente conta como null.
    const semMaxima = await criar(token, { ...BASE, idade_minima_meses: 37, idade_maxima_meses: undefined });
    assert.equal(semMaxima.statusCode, 201, semMaxima.body);
    assert.equal(semMaxima.json().idade_maxima_meses, null);
  });

  test('E-09 POST: par fora da lista (10–20, 24–12, 0–12, 37–120, 13–null) ou sem faixa → 400; nada gravado', async () => {
    const { token } = await tenantComToken();
    for (const [minima, maxima] of [[10, 20], [24, 12], [0, 12], [37, 120], [13, null], [null, 8], [0, 9]]) {
      const r = await criar(token, { ...BASE, idade_minima_meses: minima, idade_maxima_meses: maxima });
      esperar400(r, 'faixa_fora_da_lista');
      assert.equal(r.json().field, 'idade_minima_meses');
    }
    for (const extra of [
      { idade_minima_meses: undefined, idade_maxima_meses: undefined },
      { idade_minima_meses: null, idade_maxima_meses: null },
      { idade_minima_meses: '', idade_maxima_meses: '' },
    ]) {
      esperar400(await criar(token, { ...BASE, ...extra }), 'faixa_obrigatoria');
    }
    assert.equal(await prisma().categoriaManejo.count(), 0);
  });

  test('E-10 POST: sem sexo (ausente, null, vazio) → 400 sexo_obrigatorio; outro valor → 400 sexo_invalido; grafia normalizada', async () => {
    const { token } = await tenantComToken();
    const { sexo: _sexo, ...semSexo } = BASE;
    void _sexo;
    for (const corpo of [semSexo, { ...BASE, sexo: null }, { ...BASE, sexo: '  ' }]) {
      const r = await criar(token, corpo);
      esperar400(r, 'sexo_obrigatorio');
      assert.equal(r.json().field, 'sexo');
    }
    for (const sexo of ['Misto', 'M', 1]) esperar400(await criar(token, { ...BASE, sexo }), 'sexo_invalido');
    assert.equal(await prisma().categoriaManejo.count(), 0);
    let r = await criar(token, { ...BASE, sexo: 'MACHO' });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().sexo, 'Macho');
    r = await criar(token, { ...BASE, sexo: 'femea' });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().sexo, 'Fêmea');
  });

  test('E-11 idade negativa, fracionária ou não numérica → 400 inteiro_nao_negativo', async () => {
    const { token } = await tenantComToken();
    for (const valor of [-1, 1.5, 'abc', '-3', '1.5', true, {}]) {
      esperar400(await criar(token, { ...BASE, idade_minima_meses: valor }), 'inteiro_nao_negativo');
    }
    esperar400(await criar(token, { ...BASE, idade_maxima_meses: 2 ** 31 }), 'inteiro_nao_negativo');
    assert.equal(await prisma().categoriaManejo.count(), 0);
  });

  test('E-12 PATCH com um lado só compara com o lado GRAVADO; par efetivo fora da lista → 400 e nada muda', async () => {
    const { token } = await tenantComToken();
    const id = (await criar(token, { ...BASE, idade_minima_meses: 13, idade_maxima_meses: 24 })).json().id;
    // Só a máxima: (13 gravado, 36) não é faixa da lista.
    esperar400(await atualizar(token, id, { idade_maxima_meses: 36 }), 'faixa_fora_da_lista');
    esperar400(await atualizar(token, id, { idade_minima_meses: 25 }), 'faixa_fora_da_lista');
    esperar400(await atualizar(token, id, { idade_maxima_meses: null }), 'faixa_fora_da_lista');
    let gravada = await linha(id);
    assert.deepEqual([gravada.idade_minima_meses, gravada.idade_maxima_meses], [13, 24]);
    // Os dois lados juntos para outra faixa da lista → 200.
    let r = await atualizar(token, id, { idade_minima_meses: 25, idade_maxima_meses: 36 });
    assert.equal(r.statusCode, 200, r.body);
    // Só a máxima, e o par efetivo (25 gravado, 36) é da lista → 200.
    r = await atualizar(token, id, { idade_maxima_meses: 36 });
    assert.equal(r.statusCode, 200, r.body);
    // "Maior que 36": mínima 37 e máxima null.
    r = await atualizar(token, id, { idade_minima_meses: 37, idade_maxima_meses: null });
    assert.equal(r.statusCode, 200, r.body);
    gravada = await linha(id);
    assert.deepEqual([gravada.idade_minima_meses, gravada.idade_maxima_meses], [37, null]);
  });

  test('E-13 PATCH com sexo: só Macho/Fêmea; null ou vazio → 400 sexo_obrigatorio', async () => {
    const { token } = await tenantComToken();
    const id = (await criar(token, BASE)).json().id;
    esperar400(await atualizar(token, id, { sexo: null }), 'sexo_obrigatorio');
    esperar400(await atualizar(token, id, { sexo: '' }), 'sexo_obrigatorio');
    esperar400(await atualizar(token, id, { sexo: 'Misto' }), 'sexo_invalido');
    assert.equal((await linha(id)).sexo, 'Macho');
    const r = await atualizar(token, id, { sexo: 'FÊMEA' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().sexo, 'Fêmea');
  });

  test('E-14 linha legada com idades INVERTIDAS e sexo fora da lista: PATCH sem idade nem sexo NUNCA é recusado', async () => {
    const { cliente, token } = await tenantComToken();
    const invertida = await criarLinhaInvertida(cliente.id);

    let r = await atualizar(token, invertida.id, { ativo: false });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().ativo, false);
    r = await atualizar(token, invertida.id, { nome: 'INVERTIDA 2', sigla: 'IV' });
    assert.equal(r.statusCode, 200, r.body);

    const gravada = await linha(invertida.id);
    assert.deepEqual(
      [gravada.ativo, gravada.nome, gravada.idade_minima_meses, gravada.idade_maxima_meses, gravada.sexo],
      [false, 'INVERTIDA 2', 24, 12, 'Misto'],
      'par e sexo legados ficam como estavam'
    );
  });

  test('E-15 linha legada com idades invertidas: PATCH só com chaves legadas → 200 sem efeito (no-op)', async () => {
    const { cliente, token } = await tenantComToken();
    const invertida = await criarLinhaInvertida(cliente.id);
    const antes = await linha(invertida.id);
    const r = await atualizar(token, invertida.id, { raca: 'ANGUS', categoria_oficial: 'Garrote', gmd_maio: '0.9' });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(await linha(invertida.id), antes, 'linha intocada (inclusive updatedAt)');
    // Mexer na idade de uma linha invertida exige uma faixa da lista: um lado só não basta.
    esperar400(await atualizar(token, invertida.id, { idade_maxima_meses: 36 }), 'faixa_fora_da_lista');
    const corrigida = await atualizar(token, invertida.id, { idade_minima_meses: 13, idade_maxima_meses: 24 });
    assert.equal(corrigida.statusCode, 200, corrigida.body);
  });
});
