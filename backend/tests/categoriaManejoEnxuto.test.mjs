/**
 * D-PROD-186 — MAIKE-CATEGORIA-MANEJO-ENXUGAR (Fatia C): o contrato de
 * CategoriaManejo fica com nome, sigla, espécie, sexo e faixa de idade.
 * `raca`, `categoria_oficial`, `ganho_peso_anual_kg` e
 * `gmd_janeiro`…`gmd_dezembro` saem da API: cliente antigo que ainda as envia
 * é aceito e as chaves são IGNORADAS (padrão da D-PROD-181).
 *
 * D-PROD-187 — MAIKE-CATEGORIA-MANEJO-CADCATEGORIA (Fatia D): as 15 colunas e
 * o vínculo com o ícone oficial (`catalogo_categoria_visual_id`, emenda do
 * proprietário) foram APAGADOS do banco, e a tabela física passou a se chamar
 * `CADCATEGORIA` (o model continua `CategoriaManejo`, com `@@map`). A chave do
 * ícone entrou na lista das ignoradas. SQL cru usa "CADCATEGORIA".
 *
 * D-PROD-195 — a categoria passa a ter a Curva de Ganho OBRIGATÓRIA e da
 * MESMA fazenda (`curva_ganho_id`, FK composta para CADCURVAGANHO); a resposta
 * traz `curva_ganho_id` e `curva_ganho_nome`. Os testes antigos criam a curva
 * da fazenda (`criarCurvaGanhoDeTeste`) e o `criar` daqui a envia por padrão.
 *
 * PostgreSQL real.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { CHAVES_LEGADAS_IGNORADAS } from '../src/modules/categoriasManejo/categoriaManejoService.js';
import { FAIXAS_IDADE_CATEGORIA_MANEJO } from '../src/modules/movimentacoesMapa/categoriaOficialDerivada.js';
import { colunasGravaveis } from '../src/shared/prisma/colunasGravaveis.js';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp, criarCurvaGanhoDeTeste } from './helpers.mjs';

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

/** D-PROD-195: curva da fazenda 'emp-1' do tenant do teste; `criar` a envia por padrão. */
let curvaPadrao = '';

const tenantComToken = async () => {
  const { cliente, credenciais } = await criarTenant();
  const { corpo } = await autenticarNoApp(app, credenciais);
  const curva = await criarCurvaGanhoDeTeste(prisma(), { clienteId: cliente.id, empresaId: 'emp-1', nome: 'CURVA PADRÃO' });
  curvaPadrao = curva.id;
  return { cliente, token: corpo.token, curva };
};

const CAMPOS_PUBLICOS = [
  'ativo',
  'created_date',
  'curva_ganho_id',
  'curva_ganho_nome',
  'empresa_id',
  'especie',
  'id',
  'idade_maxima_meses',
  'idade_minima_meses',
  'nome',
  // D-PROD-198: peso objetivo (kg), opcional.
  'peso_objetivo_kg',
  'sexo',
  'sigla',
  'updated_date',
].sort();

const MESES = [
  'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** Corpo de cliente antigo: todas as chaves que saíram do contrato (o vínculo do ícone desde a D-PROD-187). */
const LEGADO = Object.freeze({
  raca: 'NELORE',
  categoria_oficial: 'Bezerro',
  ganho_peso_anual_kg: '180.5',
  ...Object.fromEntries(MESES.map((m, i) => [`gmd_${m}`, String(0.4 + i / 100)])),
  catalogo_categoria_visual_id: 'cv-qualquer',
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

/** POST com a curva da fazenda por padrão (D-PROD-195); `criarCru` manda o corpo como está. */
const criarCru = (token, payload) =>
  app.inject({ method: 'POST', url: '/categorias-manejo', headers: auth(token), payload });
const criar = (token, payload) => criarCru(token, { curva_ganho_id: curvaPadrao, ...payload });
const atualizar = (token, id, payload) =>
  app.inject({ method: 'PATCH', url: `/categorias-manejo/${id}`, headers: auth(token), payload });
const listar = (token) => app.inject({ method: 'GET', url: '/categorias-manejo', headers: auth(token) });

/** Linha pelo Prisma Client. */
const linha = (id) => prisma().categoriaManejo.findUnique({ where: { id } });

/** As 14 colunas físicas de CADCATEGORIA, na ordem (D-PROD-187; `curva_ganho_id` desde a D-PROD-195 e `peso_objetivo_kg` desde a D-PROD-198, no fim). */
const COLUNAS_FISICAS = [
  'id', 'cliente_id', 'empresa_id', 'nome', 'sigla', 'especie', 'sexo', 'idade_minima_meses', 'idade_maxima_meses', 'ativo', 'createdAt', 'updatedAt',
  'curva_ganho_id', 'peso_objetivo_kg',
];

/** Colunas físicas da tabela, lidas do catálogo do banco (não do Prisma Client). */
const colunasFisicas = async (tabela) =>
  (await prisma().$queryRawUnsafe(
    `SELECT column_name::text AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    tabela
  )).map((x) => x.c);

const assertSemLegado = (objeto, rotulo) => {
  for (const chave of CHAVES_LEGADAS_IGNORADAS) assert.equal(chave in objeto, false, `${rotulo}: ${chave}`);
};

const esperar400 = (r, reason) => {
  assert.equal(r.statusCode, 400, r.body);
  assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED');
  if (reason) assert.equal(r.json().reason, reason, r.body);
};

describe('CategoriaManejo enxuta (D-PROD-186) e sem o ícone, em CADCATEGORIA (D-PROD-187)', () => {
  test('E-00 a lista legada é fechada: raca, categoria_oficial, ganho_peso_anual_kg, os 12 gmd_* e o vínculo do ícone (D-PROD-187)', () => {
    assert.deepEqual(
      [...CHAVES_LEGADAS_IGNORADAS].sort(),
      ['catalogo_categoria_visual_id', 'categoria_oficial', 'ganho_peso_anual_kg', 'raca', ...MESES.map((m) => `gmd_${m}`)].sort()
    );
    assert.equal(Object.isFrozen(CHAVES_LEGADAS_IGNORADAS), true);
    // Fora do Prisma Client (as colunas não existem mais) — o allowlist do corpo não as conhece.
    const gravaveis = colunasGravaveis('CategoriaManejo');
    for (const chave of CHAVES_LEGADAS_IGNORADAS) assert.equal(gravaveis.has(chave), false, chave);
    assert.deepEqual(
      [...gravaveis].sort(),
      ['ativo', 'curva_ganho_id', 'empresa_id', 'especie', 'idade_maxima_meses', 'idade_minima_meses', 'nome', 'peso_objetivo_kg', 'sexo', 'sigla']
    );
  });

  test('E-00b estrutura (D-PROD-187/D-PROD-195): a tabela física é CADCATEGORIA com as 14 colunas; CategoriaManejo não existe mais; nenhuma das 16 colunas sobrou', async () => {
    assert.deepEqual(await colunasFisicas('CADCATEGORIA'), COLUNAS_FISICAS);
    assert.deepEqual(await colunasFisicas('CategoriaManejo'), []);
    const [{ antiga, nova }] = await prisma().$queryRawUnsafe(
      `SELECT to_regclass('public."CategoriaManejo"') IS NULL AS antiga, to_regclass('public."CADCATEGORIA"') IS NOT NULL AS nova`
    );
    assert.deepEqual({ antiga, nova }, { antiga: true, nova: true });
    for (const chave of CHAVES_LEGADAS_IGNORADAS) assert.ok(!COLUNAS_FISICAS.includes(chave), chave);
    // Nenhuma FK de CADCATEGORIA aponta para o catálogo global (o vínculo do ícone saiu).
    const [{ fks }] = await prisma().$queryRawUnsafe(
      `SELECT count(*)::int AS fks FROM pg_constraint WHERE conrelid = 'public."CADCATEGORIA"'::regclass AND confrelid = 'public."CatalogoCategoriaVisual"'::regclass`
    );
    assert.equal(fks, 0);
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
    assert.deepEqual(Object.keys(await linha(corpo.id)).sort(), [...COLUNAS_FISICAS].sort(), 'a linha só tem as 13 colunas');

    const [evento] = await prisma().auditLog.findMany({ where: { entidade: 'CategoriaManejo', entidade_id: corpo.id } });
    assert.ok(evento, 'create auditado');
    assert.deepEqual(Object.keys(evento.dados_novos).sort(), CAMPOS_PUBLICOS);
    assertSemLegado(evento.dados_novos, 'auditoria');
  });

  test('E-02 PATCH só com chaves legadas → 200 e nenhum efeito na linha', async () => {
    const { token } = await tenantComToken();
    const id = (await criar(token, BASE)).json().id;
    const antes = await linha(id);

    const r = await atualizar(token, id, { raca: 'ANGUS', categoria_oficial: 'Garrote', gmd_maio: '0.9', ganho_peso_anual_kg: null, catalogo_categoria_visual_id: 'cv-x' });
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

    const r = await atualizar(token, id, { nome: 'GARROTE', raca: 'ANGUS', gmd_dezembro: '1.1', catalogo_categoria_visual_id: null });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().nome, 'GARROTE');
    assertSemLegado(r.json(), 'resposta');

    assert.equal((await linha(id)).nome, 'GARROTE');
  });

  test('E-04 lista expõe exatamente os campos públicos, inclusive de linha gravada direto no banco', async () => {
    const { cliente, token } = await tenantComToken();
    await prisma().$executeRaw`INSERT INTO "CADCATEGORIA" (id, cliente_id, empresa_id, nome, curva_ganho_id, "updatedAt") VALUES ('cm-sql', ${cliente.id}, 'emp-1', 'VACA', ${curvaPadrao}, now())`;
    await criar(token, BASE);

    const r = await listar(token);
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().length, 2);
    for (const item of r.json()) {
      assert.deepEqual(Object.keys(item).sort(), CAMPOS_PUBLICOS);
      assertSemLegado(item, 'lista');
    }
  });

  test('E-05 POST e PATCH com o vínculo do ícone (cliente antigo, D-PROD-187): aceitos, a chave é ignorada, nada é validado contra o catálogo, e a auditoria segue com entidade CategoriaManejo', async () => {
    const { token } = await tenantComToken();
    // Id inexistente no catálogo: antes era 422; agora a chave nem é lida.
    const r = await criar(token, { ...BASE, catalogo_categoria_visual_id: 'nao-existe' });
    assert.equal(r.statusCode, 201, r.body);
    assertSemLegado(r.json(), 'resposta');
    const id = r.json().id;
    const p = await atualizar(token, id, { sigla: 'VC', catalogo_categoria_visual_id: 123 });
    assert.equal(p.statusCode, 200, p.body);
    assert.equal(p.json().sigla, 'VC');
    assertSemLegado(p.json(), 'resposta');
    const eventos = await prisma().auditLog.findMany({ where: { entidade: 'CategoriaManejo', entidade_id: id } });
    assert.deepEqual(eventos.map((e) => e.acao).sort(), ['create', 'update']);
    for (const e of eventos) {
      if (e.dados_anteriores) assertSemLegado(e.dados_anteriores, 'auditoria antes');
      assertSemLegado(e.dados_novos, 'auditoria depois');
    }
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
    const criada = await prisma().categoriaManejo.create({ data: { cliente_id: clienteId, empresa_id: 'emp-1', nome: 'INVERTIDA', curva_ganho_id: curvaPadrao } });
    await prisma().$executeRaw`UPDATE "CADCATEGORIA" SET idade_minima_meses = 24, idade_maxima_meses = 12, sexo = 'Misto' WHERE id = ${criada.id}`;
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

describe('D-PROD-195 — Categoria de Manejo com Curva de Ganho obrigatória e da mesma fazenda', () => {
  /** Segunda fazenda do tenant ('emp-2'), com uma curva própria. */
  const segundaFazenda = async (clienteId, nome = 'CURVA DA EMP 2') =>
    criarCurvaGanhoDeTeste(prisma(), { clienteId, empresaId: 'emp-2', nome });

  const esperarCurva400 = (r, reason) => {
    esperar400(r, reason);
    assert.equal(r.json().field, 'curva_ganho_id', r.body);
    assert.equal(r.json().details?.entidade, 'CategoriaManejo', r.body);
  };

  test('C-01 POST sem curva (ausente, null, vazio, só espaços) → 400 curva_obrigatoria; nada gravado', async () => {
    const { token } = await tenantComToken();
    esperarCurva400(await criarCru(token, BASE), 'curva_obrigatoria');
    for (const curva_ganho_id of [null, '', '   ']) esperarCurva400(await criar(token, { ...BASE, curva_ganho_id }), 'curva_obrigatoria');
    assert.equal(await prisma().categoriaManejo.count(), 0);
  });

  test('C-02 curva de outra fazenda do mesmo tenant, de outro tenant, inexistente ou não texto → 400 curva_inexistente (sem oráculo); nada gravado', async () => {
    const { cliente, token } = await tenantComToken();
    const daEmp2 = await segundaFazenda(cliente.id);
    const outro = await criarTenant();
    const deOutroTenant = await criarCurvaGanhoDeTeste(prisma(), { clienteId: outro.cliente.id, empresaId: `emp-${randomUUID().slice(0, 8)}`, nome: 'CURVA PADRÃO' });
    for (const curva_ganho_id of [daEmp2.id, deOutroTenant.id, 'nao-existe', 123, { id: curvaPadrao }]) {
      esperarCurva400(await criar(token, { ...BASE, curva_ganho_id }), 'curva_inexistente');
    }
    // A mesma curva da emp-2 serve para uma categoria da emp-2.
    const r = await criar(token, { ...BASE, empresa_id: 'emp-2', curva_ganho_id: daEmp2.id });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(await prisma().categoriaManejo.count(), 1);
  });

  test('C-03 curva inativa: categoria nova recusa (curva_inativa); a gravada que foi inativada depois é mantida em qualquer PATCH; trocar para outra inativa recusa', async () => {
    const { cliente, token, curva } = await tenantComToken();
    const inativa = await criarCurvaGanhoDeTeste(prisma(), { clienteId: cliente.id, empresaId: 'emp-1', nome: 'INATIVA', ativo: false });
    esperarCurva400(await criar(token, { ...BASE, curva_ganho_id: inativa.id }), 'curva_inativa');
    assert.equal(await prisma().categoriaManejo.count(), 0);

    const id = (await criar(token, BASE)).json().id;
    await prisma().cadCurvaGanho.update({ where: { id: curva.id }, data: { ativo: false } });
    let r = await atualizar(token, id, { nome: 'BEZERRO 2' });
    assert.equal(r.statusCode, 200, r.body);
    r = await atualizar(token, id, { curva_ganho_id: curva.id, sigla: 'B2' });
    assert.equal(r.statusCode, 200, `reenviar a curva gravada (formulário) é manter: ${r.body}`);
    assert.equal(r.json().curva_ganho_id, curva.id);
    esperarCurva400(await atualizar(token, id, { curva_ganho_id: inativa.id }), 'curva_inativa');
    const ativa = await criarCurvaGanhoDeTeste(prisma(), { clienteId: cliente.id, empresaId: 'emp-1', nome: 'ATIVA' });
    r = await atualizar(token, id, { curva_ganho_id: ativa.id });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual([r.json().curva_ganho_id, r.json().curva_ganho_nome], [ativa.id, 'ATIVA']);
    // Voltar para a curva gravada antes, hoje inativa, é TROCAR: recusa.
    esperarCurva400(await atualizar(token, id, { curva_ganho_id: curva.id }), 'curva_inativa');
    assert.equal((await linha(id)).curva_ganho_id, ativa.id);
  });

  test('C-04 PATCH: curva null/vazia → curva_obrigatoria; de outra fazenda → curva_inexistente; nada muda', async () => {
    const { cliente, token } = await tenantComToken();
    const daEmp2 = await segundaFazenda(cliente.id);
    const id = (await criar(token, BASE)).json().id;
    const antes = await linha(id);
    for (const curva_ganho_id of [null, '']) esperarCurva400(await atualizar(token, id, { curva_ganho_id }), 'curva_obrigatoria');
    esperarCurva400(await atualizar(token, id, { curva_ganho_id: daEmp2.id, nome: 'OUTRA' }), 'curva_inexistente');
    assert.deepEqual(await linha(id), antes);
  });

  test('C-05 troca de fazenda: sem curva da fazenda nova → curva_inexistente; com a curva da fazenda nova → 200', async () => {
    const { cliente, token } = await tenantComToken();
    const daEmp2 = await segundaFazenda(cliente.id);
    const id = (await criar(token, BASE)).json().id;
    const antes = await linha(id);
    esperarCurva400(await atualizar(token, id, { empresa_id: 'emp-2' }), 'curva_inexistente');
    esperarCurva400(await atualizar(token, id, { empresa_id: 'emp-2', curva_ganho_id: curvaPadrao }), 'curva_inexistente');
    assert.deepEqual(await linha(id), antes, 'nada muda');
    const r = await atualizar(token, id, { empresa_id: 'emp-2', curva_ganho_id: daEmp2.id });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual([r.json().empresa_id, r.json().curva_ganho_id, r.json().curva_ganho_nome], ['emp-2', daEmp2.id, 'CURVA DA EMP 2']);
    // Fazenda nova com curva inativa: é troca, recusa.
    const inativa = await criarCurvaGanhoDeTeste(prisma(), { clienteId: cliente.id, empresaId: 'emp-1', nome: 'INATIVA', ativo: false });
    esperarCurva400(await atualizar(token, id, { empresa_id: 'emp-1', curva_ganho_id: inativa.id }), 'curva_inativa');
  });

  test('C-06 formato público: POST, PATCH, lista e auditoria trazem curva_ganho_id e curva_ganho_nome; o eco de curva_ganho_nome no corpo é ignorado', async () => {
    const { cliente, token, curva } = await tenantComToken();
    const r = await criar(token, { ...BASE, curva_ganho_nome: 'NOME FORJADO' });
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual([r.json().curva_ganho_id, r.json().curva_ganho_nome], [curva.id, 'CURVA PADRÃO']);
    const outra = await criarCurvaGanhoDeTeste(prisma(), { clienteId: cliente.id, empresaId: 'emp-1', nome: 'RECRIA' });
    const p = await atualizar(token, r.json().id, { ...r.json(), curva_ganho_id: outra.id, curva_ganho_nome: 'NOME FORJADO' });
    assert.equal(p.statusCode, 200, p.body);
    assert.deepEqual([p.json().curva_ganho_id, p.json().curva_ganho_nome], [outra.id, 'RECRIA']);
    const [item] = (await listar(token)).json();
    assert.deepEqual(Object.keys(item).sort(), CAMPOS_PUBLICOS);
    assert.deepEqual([item.curva_ganho_id, item.curva_ganho_nome], [outra.id, 'RECRIA']);
    const eventos = await prisma().auditLog.findMany({ where: { entidade: 'CategoriaManejo', entidade_id: r.json().id }, orderBy: { createdAt: 'asc' } });
    assert.equal(eventos[0].dados_novos.curva_ganho_nome, 'CURVA PADRÃO');
    assert.deepEqual([eventos[1].dados_anteriores.curva_ganho_id, eventos[1].dados_novos.curva_ganho_id], [curva.id, outra.id]);
  });

  test('C-07 banco: curva_ganho_id NOT NULL, FK composta (cliente, fazenda, curva) Restrict e índice; escrita direta com curva de outra fazenda é recusada', async () => {
    const { cliente } = await tenantComToken();
    const daEmp2 = await segundaFazenda(cliente.id);
    const [col] = await prisma().$queryRawUnsafe(
      `SELECT is_nullable::text AS nulo FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CADCATEGORIA' AND column_name = 'curva_ganho_id'`
    );
    assert.equal(col.nulo, 'NO');
    const [fk] = await prisma().$queryRawUnsafe(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'CADCATEGORIA_cliente_id_empresa_id_curva_ganho_id_fkey'`
    );
    assert.match(fk.def, /FOREIGN KEY \(cliente_id, empresa_id, curva_ganho_id\) REFERENCES "CADCURVAGANHO"\(cliente_id, empresa_id, id\) ON UPDATE CASCADE ON DELETE RESTRICT/);
    const [{ n }] = await prisma().$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'CADCATEGORIA_cliente_id_empresa_id_curva_ganho_id_idx'`);
    assert.equal(n, 1);
    await assert.rejects(
      prisma().$executeRaw`INSERT INTO "CADCATEGORIA" (id, cliente_id, empresa_id, nome, curva_ganho_id, "updatedAt") VALUES ('cm-x', ${cliente.id}, 'emp-1', 'X', ${daEmp2.id}, now())`,
      /CADCATEGORIA_cliente_id_empresa_id_curva_ganho_id_fkey|23503/
    );
  });

  test('C-08 opções de curva: só a fazenda pedida, em ordem de nome, só {id, nome, ativo} (inativa marcada); outra fazenda/tenant → 404; sem empresa_id → 400; sem token → 401', async () => {
    const { cliente, token, curva } = await tenantComToken();
    const inativa = await criarCurvaGanhoDeTeste(prisma(), { clienteId: cliente.id, empresaId: 'emp-1', nome: 'ABC INATIVA', ativo: false });
    await segundaFazenda(cliente.id);
    const url = (e) => `/categorias-manejo-opcoes/curvas-ganho?empresa_id=${encodeURIComponent(e)}`;
    const r = await app.inject({ method: 'GET', url: url('emp-1'), headers: auth(token) });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), [
      { id: inativa.id, nome: 'ABC INATIVA', ativo: false },
      { id: curva.id, nome: 'CURVA PADRÃO', ativo: true },
    ]);
    const outro = await criarTenant();
    const empOutro = `emp-${randomUUID().slice(0, 8)}`;
    await criarCurvaGanhoDeTeste(prisma(), { clienteId: outro.cliente.id, empresaId: empOutro });
    for (const e of [empOutro, 'nao-existe']) {
      const x = await app.inject({ method: 'GET', url: url(e), headers: auth(token) });
      assert.equal(x.statusCode, 404, x.body);
      assert.equal(x.json().code, 'EMPRESA_NOT_FOUND');
    }
    assert.equal((await app.inject({ method: 'GET', url: '/categorias-manejo-opcoes/curvas-ganho', headers: auth(token) })).statusCode, 400);
    assert.equal((await app.inject({ method: 'GET', url: `${url('emp-1')}&cliente_id=${cliente.id}`, headers: auth(token) })).statusCode, 400);
    assert.equal((await app.inject({ method: 'GET', url: url('emp-1') })).statusCode, 401);
  });

  test('C-09 opções de curva: permissão de quem cria OU edita categoria (inclui o cadastro rápido do Cadastro de Lotes); só ver a categoria ou só a tela de curvas → 403', async () => {
    const { cliente, credenciais } = await criarTenant({ papelTenant: 'administrador', semPermissao: true });
    await criarCurvaGanhoDeTeste(prisma(), { clienteId: cliente.id, empresaId: 'emp-1', nome: 'CURVA PADRÃO' });
    const hash = (await prisma().usuario.findFirst({ where: { cliente_id: cliente.id } })).senha_hash;
    const login = `op-${randomUUID().slice(0, 8)}`;
    await prisma().usuario.create({ data: { cliente_id: cliente.id, nome: 'Op', login, senha_hash: hash, papel_tenant: 'usuario' } });
    const tokOp = (await autenticarNoApp(app, { login, senha: credenciais.senha })).corpo.token;
    const acoes = (a) => ({ visualizar: false, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...a });
    const permitir = (tela, a) =>
      prisma().permissao.upsert({
        where: { cliente_id_user_email: { cliente_id: cliente.id, user_email: login } },
        create: { cliente_id: cliente.id, user_email: login, user_nome: 'Op', modulos_permitidos: ['manejo'], permissoes_telas: [{ modulo_id: 'manejo', tela_id: tela, ...acoes(a) }] },
        update: { modulos_permitidos: ['manejo'], permissoes_telas: [{ modulo_id: 'manejo', tela_id: tela, ...acoes(a) }] },
      });
    const status = async () => (await app.inject({ method: 'GET', url: '/categorias-manejo-opcoes/curvas-ganho?empresa_id=emp-1', headers: auth(tokOp) })).statusCode;
    assert.equal(await status(), 403, 'sem linha');
    const casos = [
      ['pec-categorias-manejo', { visualizar: true }, 403],
      ['pec-categorias-manejo', { visualizar: true, excluir: true }, 403],
      ['pec-curvas-ganho', { visualizar: true, novo: true, salvar: true, editar: true, excluir: true }, 403],
      ['pec-categorias-manejo', { visualizar: true, novo: true }, 200],
      ['pec-categorias-manejo', { visualizar: true, salvar: true }, 200],
      ['pec-categorias-manejo', { visualizar: true, editar: true }, 200],
      ['pec-lotes', { visualizar: true, novo: true }, 200],
      ['pec-lotes', { visualizar: true, editar: true }, 200],
      ['pec-lotes', { visualizar: true }, 403],
    ];
    for (const [tela, a, esperado] of casos) {
      await permitir(tela, a);
      assert.equal(await status(), esperado, `${tela} ${JSON.stringify(a)}`);
    }
  });
});
