/**
 * D-PROD-157 / D-PROD-161 — Patrimônio: CATÁLOGOS do tenant (famílias, tipos
 * e o catálogo padrão). PostgreSQL real, HTTP autenticado, prova por
 * persistência. D-PROD-161: perfis de medição e combustíveis saíram (rotas
 * 404); famílias e tipos têm as guardas da tela de Bens; `codigo` opcional.
 *
 *  K1. Catálogo padrão (só famílias e tipos): idempotente (2ª chamada cria 0),
 *      isolado por tenant, corrida instala uma vez, conflitos do A9 sem alterar
 *      nada e sem P2002 abortar; só administrador real ou `is_admin`.
 *  K2. Famílias: CRUD, código normalizado, natureza/código imutáveis (400),
 *      CAS por versão, PATCH sem mudança efetiva, nome único sem diferenciar
 *      maiúsculas, keyset/filtros/busca literal, 404 cruzado sem oráculo,
 *      auditoria sem texto livre.
 *  K3. Tipos: família inexistente/inativa/de outro tenant recusada; `perfis`
 *      → 400; familia_id/código imutáveis; nome único na família.
 *  K4. Código gerado do nome (P-05): sem acentos, MAIÚSCULAS, `_`, até 28 +
 *      sufixo `_2`…`_99` (≤ 32), colisão sob a trava do catálogo; nome repetido
 *      continua 409.
 *  K5. Permissões pelas ações de Bens e opções de seletor.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { TELAS, TELAS_ANTIGAS, corpoErro, erro, http, linha, montarPatrimonio, prisma, tudo } from './patrimonioP1Cenario.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof http>} */
let H;
before(async () => {
  app = await criarApp();
  await app.ready();
  H = http(app);
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const req = (...a) => H.req(...a);
const ok = (...a) => H.ok(...a);
const ZERO = Object.freeze({ familias: 0, tipos: 0 });
const PADRAO = Object.freeze({ familias: 5, tipos: 13 });
const INEXISTENTE = 'cl0inexistente000000000000';
const instalar = (tok, corpo = {}) => req('POST', '/patrimonio-catalogo-padrao', tok, corpo);
const todos = async (tok, base) => (await ok(req('GET', `${base}?limit=100`, tok))).items;
const porCodigo = (itens, fn) => Object.fromEntries(itens.map((i) => [i.codigo, fn(i)]));
const conflitosOrdenados = (r) => r.conflitos.map((x) => `${x.recurso}:${x.codigo}:${x.motivo}`).sort();

// ─────────────────────────────────────────────────────────────────────────────
describe('K1 — catálogo padrão', () => {
  test('instala 5 famílias e 13 tipos (sem perfis nem combustíveis); 2ª chamada cria 0; outro tenant é independente; corrida instala uma vez', async () => {
    const a = await montarPatrimonio(app, { catalogo: false });
    const b = await montarPatrimonio(app, { catalogo: false });
    const r1 = await ok(instalar(a.token));
    assert.deepEqual(r1, { criados: PADRAO, existentes: ZERO, conflitos: [] });
    const eventos = await prisma().auditLog.count({ where: { cliente_id: a.c, acao: 'create' } });
    assert.equal(eventos, 18, 'um evento de criação por item, na mesma transação');
    assert.deepEqual(
      (await prisma().auditLog.groupBy({ by: ['entidade'], where: { cliente_id: a.c, acao: 'create' }, _count: true })).map((g) => [g.entidade, g._count]).sort(),
      [['FamiliaPatrimonial', 5], ['TipoPatrimonial', 13]],
    );
    const r2 = await ok(instalar(a.token));
    assert.deepEqual(r2, { criados: ZERO, existentes: PADRAO, conflitos: [] }, '2ª chamada não cria nada');
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: a.c, acao: 'create' } }), 18, 'sem auditoria na 2ª');

    // Conteúdo do padrão.
    const familias = porCodigo(await todos(a.token, '/patrimonio-familias'), (f) => [f.natureza, f.vida_util_meses_padrao]);
    assert.deepEqual(familias, {
      BENFEITORIAS: ['BENFEITORIA', 300], EQUIPAMENTOS: ['EQUIPAMENTO', 120], IMPLEMENTOS: ['IMPLEMENTO', 120], MAQUINAS: ['MAQUINA', 120], VEICULOS: ['VEICULO', 60],
    });
    const tipos = porCodigo(await todos(a.token, '/patrimonio-tipos'), (t) => t.familia.codigo);
    assert.deepEqual(tipos, {
      BALANCA: 'EQUIPAMENTOS', BEBEDOURO_FIXO: 'BENFEITORIAS', CAMINHAO: 'VEICULOS', CAMINHONETE: 'VEICULOS', CERCA_ARAME: 'BENFEITORIAS', CERCA_ELETRICA: 'BENFEITORIAS',
      CURRAL: 'BENFEITORIAS', GALPAO: 'BENFEITORIAS', GERADOR: 'EQUIPAMENTOS', RESERVATORIO: 'BENFEITORIAS', ROCADEIRA: 'IMPLEMENTOS', TRATOR_ESTEIRAS: 'MAQUINAS', TRATOR_PNEUS: 'MAQUINAS',
    });
    assert.ok((await todos(a.token, '/patrimonio-tipos')).every((t) => !('perfis' in t)), 'tipo sem perfis na forma pública');
    // Perfis e combustíveis saíram do produto: as rotas não existem.
    for (const url of ['/patrimonio-perfis-medicao', '/patrimonio-combustiveis']) assert.equal((await req('GET', url, a.token)).statusCode, 404, url);

    // Isolado por tenant: B não viu nada de A e instala o seu próprio catálogo.
    assert.equal((await ok(req('GET', '/patrimonio-familias', b.token))).total, 0);
    assert.deepEqual((await ok(instalar(b.token))).criados, PADRAO);
    assert.equal(await prisma().familiaPatrimonial.count({ where: { cliente_id: a.c } }), 5);
    assert.equal(await prisma().familiaPatrimonial.count({ where: { cliente_id: b.c } }), 5);

    // Corrida: duas instalações simultâneas no mesmo tenant → uma cria tudo, a outra 0.
    const d = await montarPatrimonio(app, { catalogo: false });
    const [x, y] = await Promise.all([instalar(d.token), instalar(d.token)]);
    assert.deepEqual([x.statusCode, y.statusCode], [200, 200], `${x.body} ${y.body}`);
    assert.deepEqual([x.json().criados.familias + y.json().criados.familias, x.json().criados.tipos + y.json().criados.tipos], [5, 13]);
    assert.equal(await prisma().tipoPatrimonial.count({ where: { cliente_id: d.c } }), 13);
    // Sem corpo também é aceito (o endpoint não tem parâmetros).
    assert.equal((await req('POST', '/patrimonio-catalogo-padrao', d.token)).statusCode, 200);
  });

  test('A9: código existente com natureza/família divergente, inativo ou nome já usado vira conflito; dependentes pulados; nada alterado; 200 sem P2002', async () => {
    const s = await montarPatrimonio(app, { catalogo: false });
    const t = s.token;
    const post = (url, corpo) => ok(req('POST', url, t, corpo), 201);
    const maq = await post('/patrimonio-familias', { codigo: 'MAQUINAS', nome: 'Minhas máquinas', natureza: 'OUTRO' });
    await post('/patrimonio-familias', { codigo: 'MINHAS_BENF', nome: 'benfeitorias e instalações', natureza: 'BENFEITORIA' });
    const frota = await post('/patrimonio-familias', { codigo: 'FROTA', nome: 'Frota leve', natureza: 'VEICULO' });
    const caminhao = await post('/patrimonio-tipos', { familia_id: frota.id, codigo: 'CAMINHAO', nome: 'Caminhão da frota' });
    const impl = await post('/patrimonio-familias', { codigo: 'IMPLEMENTOS', nome: 'Implementos agrícolas', natureza: 'IMPLEMENTO' });
    await ok(req('PATCH', `/patrimonio-familias/${impl.id}`, t, { versao: 1, ativo: false }));

    const esperadoConflitos = [
      'familias:BENFEITORIAS:nome_em_uso', 'familias:IMPLEMENTOS:inativo', 'familias:MAQUINAS:natureza_divergente',
      'tipos:BEBEDOURO_FIXO:dependencia_em_conflito', 'tipos:CAMINHAO:familia_divergente', 'tipos:CERCA_ARAME:dependencia_em_conflito',
      'tipos:CERCA_ELETRICA:dependencia_em_conflito', 'tipos:CURRAL:dependencia_em_conflito', 'tipos:GALPAO:dependencia_em_conflito',
      'tipos:RESERVATORIO:dependencia_em_conflito', 'tipos:ROCADEIRA:dependencia_em_conflito', 'tipos:TRATOR_ESTEIRAS:dependencia_em_conflito',
      'tipos:TRATOR_PNEUS:dependencia_em_conflito',
    ];
    const r1 = await ok(instalar(t));
    assert.deepEqual(conflitosOrdenados(r1), esperadoConflitos);
    assert.deepEqual(r1.criados, { familias: 2, tipos: 3 });
    assert.deepEqual(r1.existentes, { familias: 0, tipos: 0 });
    // Os itens em conflito ficaram como estavam.
    const p = prisma();
    assert.equal((await p.familiaPatrimonial.findUnique({ where: { id: maq.id } })).natureza, 'OUTRO');
    assert.equal((await p.familiaPatrimonial.findUnique({ where: { id: impl.id } })).ativo, false);
    assert.equal((await p.tipoPatrimonial.findUnique({ where: { id: caminhao.id } })).familia_id, frota.id);
    assert.equal(await p.familiaPatrimonial.count({ where: { cliente_id: s.c, codigo: 'BENFEITORIAS' } }), 0);
    // Idempotente também com conflitos.
    const r2 = await ok(instalar(t));
    assert.deepEqual(conflitosOrdenados(r2), esperadoConflitos);
    assert.deepEqual(r2.criados, ZERO);
    assert.deepEqual(r2.existentes, { familias: 2, tipos: 3 });
  });

  test('A9: nome já usado por TIPO (na mesma família) vira nome_em_uso; o resto instala; 200 sem P2002 abortar a transação', async () => {
    const s = await montarPatrimonio(app, { catalogo: false });
    const t = s.token;
    const post = (url, corpo) => ok(req('POST', url, t, corpo), 201);
    // Família BENFEITORIAS correta (ativa, mesma natureza): conta como existente e os tipos dela são instalados nela.
    const benf = await post('/patrimonio-familias', { codigo: 'BENFEITORIAS', nome: 'Benfeitorias da fazenda', natureza: 'BENFEITORIA' });
    // Nome EXATO do padrão: o unique [cliente_id, familia_id, nome] diferencia maiúsculas, então só o nome exato bateria em P2002.
    const meuGalpao = await post('/patrimonio-tipos', { familia_id: benf.id, codigo: 'MEU_GALPAO', nome: 'Galpão' });
    const antes = JSON.stringify([
      await prisma().tipoPatrimonial.findUnique({ where: { id: meuGalpao.id } }),
      await prisma().familiaPatrimonial.findUnique({ where: { id: benf.id } }),
    ]);

    const r = await ok(instalar(t));
    assert.deepEqual(conflitosOrdenados(r), ['tipos:GALPAO:nome_em_uso']);
    assert.deepEqual(r.criados, { familias: 4, tipos: 12 });
    assert.deepEqual(r.existentes, { familias: 1, tipos: 0 });
    const p = prisma();
    assert.equal(await p.tipoPatrimonial.count({ where: { cliente_id: s.c, codigo: 'GALPAO' } }), 0);
    assert.equal((await p.tipoPatrimonial.findFirst({ where: { cliente_id: s.c, codigo: 'CURRAL' } }))?.familia_id, benf.id, 'tipos do padrão entram na família existente');
    assert.equal(
      JSON.stringify([
        await p.tipoPatrimonial.findUnique({ where: { id: meuGalpao.id } }),
        await p.familiaPatrimonial.findUnique({ where: { id: benf.id } }),
      ]),
      antes,
      'MEU_GALPAO e a família intactos',
    );
    // Idempotente: a 2ª chamada repete os conflitos e não cria nada.
    const r2 = await ok(instalar(t));
    assert.deepEqual(conflitosOrdenados(r2), conflitosOrdenados(r));
    assert.deepEqual(r2.criados, ZERO);
  });

  test('só administrador real ou is_admin; corpo fechado; sem sessão 401', async () => {
    const s = await montarPatrimonio(app, { catalogo: false });
    const todasAsTelas = await s.contaCom(...[...Object.values(TELAS), ...Object.values(TELAS_ANTIGAS)].map(tudo));
    const r = await instalar(todasAsTelas.token);
    assert.deepEqual(erro(r).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    assert.equal(await prisma().familiaPatrimonial.count({ where: { cliente_id: s.c } }), 0);
    const isAdmin = await s.conta({ is_admin: true });
    assert.equal((await instalar(isAdmin.token)).statusCode, 200);
    const adminReal = await s.conta(null, { papel_tenant: 'administrador' });
    assert.equal((await instalar(adminReal.token)).statusCode, 200);
    for (const corpo of [{ cliente_id: s.c }, { qualquer: 1 }]) assert.equal((await instalar(s.token, corpo)).statusCode, 400, JSON.stringify(corpo));
    assert.equal((await instalar(null)).statusCode, 401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('K2 — famílias', () => {
  test('CRUD: código normalizado, imutáveis 400, CAS, PATCH sem mudança, nomes únicos, keyset/filtros/busca, inativar, 404 cruzado, auditoria sem texto livre', async () => {
    const s = await montarPatrimonio(app);
    const outro = await montarPatrimonio(app);
    const t = s.token;
    const f = await ok(req('POST', '/patrimonio-familias', t, {
      codigo: 'galpoes_x', nome: 'Galpões e armazéns', natureza: 'BENFEITORIA', descricao: 'DESCRICAOSENTINELA', ordem: 7, vida_util_meses_padrao: 240,
    }), 201);
    assert.equal(f.codigo, 'GALPOES_X');
    assert.deepEqual(Object.keys(f).sort(), ['ativo', 'codigo', 'created_date', 'descricao', 'id', 'natureza', 'nome', 'ordem', 'updated_date', 'versao', 'vida_util_meses_padrao']);
    assert.deepEqual([f.versao, f.ativo, f.ordem, f.vida_util_meses_padrao], [1, true, 7, 240]);
    assert.deepEqual(await ok(req('GET', `/patrimonio-familias/${f.id}`, t)), f);

    // Listagem: keyset (createdAt desc), total sem o cursor, filtros e busca literal.
    const p1 = await ok(req('GET', '/patrimonio-familias?limit=4', t));
    assert.deepEqual([p1.total, p1.items.length, p1.has_more, p1.items[0].id], [6, 4, true, f.id]);
    const p2 = await ok(req('GET', `/patrimonio-familias?limit=4&cursor=${encodeURIComponent(p1.next_cursor)}`, t));
    assert.deepEqual([p2.total, p2.items.length, p2.has_more], [6, 2, false]);
    assert.equal(new Set([...p1.items, ...p2.items].map((i) => i.id)).size, 6);
    assert.equal((await ok(req('GET', '/patrimonio-familias?natureza=BENFEITORIA', t))).total, 2);
    assert.deepEqual((await ok(req('GET', '/patrimonio-familias?q=galp', t))).items.map((i) => i.id), [f.id]);
    assert.equal((await ok(req('GET', '/patrimonio-familias?q=%25', t))).total, 0, 'q=% é literal');
    assert.deepEqual((await ok(req('GET', '/patrimonio-familias?q=_', t))).items.map((i) => i.id), [f.id], 'q=_ é literal (só o código com sublinhado)');
    assert.equal((await req('GET', '/patrimonio-familias?cursor=lixo', t)).statusCode, 400);

    // PATCH com CAS; sem mudança efetiva não grava, não audita e não incrementa.
    const ed = await ok(req('PATCH', `/patrimonio-familias/${f.id}`, t, { versao: 1, nome: 'Galpões', descricao: null }));
    assert.deepEqual([ed.versao, ed.nome, ed.descricao], [2, 'Galpões', null]);
    const logs = () => prisma().auditLog.count({ where: { cliente_id: s.c, entidade: 'FamiliaPatrimonial', entidade_id: f.id } });
    const antesNoop = await logs();
    assert.equal((await ok(req('PATCH', `/patrimonio-familias/${f.id}`, t, { versao: 2, nome: 'Galpões', descricao: null }))).versao, 2);
    assert.equal(await logs(), antesNoop, 'PATCH sem mudança não audita');
    const conflito = await req('PATCH', `/patrimonio-familias/${f.id}`, t, { versao: 1, nome: 'Outro' });
    assert.deepEqual(erro(conflito).slice(0, 2), [409, 'PATRIMONIO_VERSAO_CONFLITO']);
    assert.deepEqual(conflito.json().details, { versao_atual: 2, versao_informada: 1 });
    for (const corpo of [
      { versao: 2, codigo: 'NOVO' }, { versao: 2, natureza: 'MAQUINA' }, { versao: 2 }, { nome: 'Sem versão' }, { versao: 2, cliente_id: s.c },
      { versao: 2, desconhecido: 1 }, { versao: 2, nome: '<b>x</b>' }, { versao: 2, vida_util_meses_padrao: 0 }, { versao: 2, vida_util_meses_padrao: 1201 },
      { versao: 2, ordem: 10000 }, { versao: 0, nome: 'x' },
    ]) {
      assert.equal((await req('PATCH', `/patrimonio-familias/${f.id}`, t, corpo)).statusCode, 400, JSON.stringify(corpo));
    }
    const gravada = await prisma().familiaPatrimonial.findUnique({ where: { id: f.id } });
    assert.deepEqual([gravada.versao, gravada.nome, gravada.codigo, gravada.natureza], [2, 'Galpões', 'GALPOES_X', 'BENFEITORIA']);

    // Unicidade: código no tenant; nome sem diferenciar maiúsculas; o próprio nome em outra caixa pode.
    assert.deepEqual(erro(await req('POST', '/patrimonio-familias', t, { codigo: 'Galpoes_X', nome: 'Outra', natureza: 'OUTRO' })), [409, 'PATRIMONIO_CODIGO_DUPLICADO', 'codigo', 'codigo_repetido']);
    assert.deepEqual(erro(await req('POST', '/patrimonio-familias', t, { codigo: 'OUTRA', nome: 'GALPÕES', natureza: 'OUTRO' })), [409, 'PATRIMONIO_NOME_DUPLICADO', 'nome', 'nome_repetido']);
    assert.deepEqual(erro(await req('PATCH', `/patrimonio-familias/${f.id}`, t, { versao: 2, nome: 'máquinas' })), [409, 'PATRIMONIO_NOME_DUPLICADO', 'nome', 'nome_repetido']);
    assert.equal((await ok(req('PATCH', `/patrimonio-familias/${f.id}`, t, { versao: 2, nome: 'GALPÕES' }))).versao, 3);
    for (const corpo of [
      { codigo: 'A', nome: 'Curta', natureza: 'OUTRO' }, { codigo: 'com-hifen', nome: 'Hífen', natureza: 'OUTRO' }, { codigo: 'FROTA', nome: 'Frota', natureza: 'FROTA' },
      { codigo: 'SEMNOME', natureza: 'OUTRO' }, { codigo: 'X2', nome: 'X', natureza: 'OUTRO', cliente_id: s.c },
    ]) {
      assert.equal((await req('POST', '/patrimonio-familias', t, corpo)).statusCode, 400, JSON.stringify(corpo));
    }
    // O mesmo código em outro tenant é livre.
    assert.equal((await req('POST', '/patrimonio-familias', outro.token, { codigo: 'GALPOES_X', nome: 'Galpões', natureza: 'BENFEITORIA' })).statusCode, 201);

    // Inativar e reativar (sem DELETE).
    const inat = await ok(req('PATCH', `/patrimonio-familias/${f.id}`, t, { versao: 3, ativo: false }));
    assert.deepEqual([inat.ativo, inat.versao], [false, 4]);
    assert.deepEqual((await ok(req('GET', '/patrimonio-familias?ativo=false', t))).items.map((i) => i.id), [f.id]);
    assert.equal((await req('DELETE', `/patrimonio-familias/${f.id}`, t)).statusCode, 404, 'sem rota de exclusão');
    assert.equal((await ok(req('PATCH', `/patrimonio-familias/${f.id}`, t, { versao: 4, ativo: true }))).ativo, true);

    // 404 cruzado sem oráculo: o corpo é o mesmo de um id inexistente.
    const alheia = await req('GET', `/patrimonio-familias/${f.id}`, outro.token);
    const inexistente = await req('GET', `/patrimonio-familias/${INEXISTENTE}`, outro.token);
    assert.deepEqual(erro(alheia).slice(0, 2), [404, 'FAMILIA_PATRIMONIAL_NAO_ENCONTRADA']);
    assert.deepEqual(corpoErro(alheia), corpoErro(inexistente));
    assert.equal((await req('PATCH', `/patrimonio-familias/${f.id}`, outro.token, { versao: 5, nome: 'Invasão' })).statusCode, 404);
    assert.equal((await prisma().familiaPatrimonial.findUnique({ where: { id: f.id } })).nome, 'GALPÕES');

    // Auditoria: ator, ações e NOMES dos campos; nunca nome/descrição.
    const eventos = await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'FamiliaPatrimonial', entidade_id: f.id }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(eventos.map((e) => e.acao), ['create', 'update', 'update', 'update', 'update']);
    assert.ok(eventos.every((e) => e.usuario_id === s.adm.usuario.id));
    assert.deepEqual([.../** @type {any} */ (eventos[1].dados_novos).campos_alterados].sort(), ['descricao', 'nome']);
    assert.deepEqual(/** @type {any} */ (eventos[3].dados_novos).campos_alterados, ['ativo']);
    const texto = JSON.stringify(eventos.map((e) => [e.dados_anteriores, e.dados_novos]));
    for (const sentinela of ['DESCRICAOSENTINELA', 'Galpões', 'GALPÕES', 'armazéns']) assert.ok(!texto.includes(sentinela), `auditoria com texto livre: ${sentinela}`);
  });

  test('corrida de duas criações com o mesmo código → [201, 409]; uma linha só', async () => {
    const s = await montarPatrimonio(app, { catalogo: false });
    const corpo = (nome) => ({ codigo: 'CORRIDA', nome, natureza: 'OUTRO' });
    const [a, b] = await Promise.all([req('POST', '/patrimonio-familias', s.token, corpo('Um')), req('POST', '/patrimonio-familias', s.token, corpo('Dois'))]);
    assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 409]);
    assert.equal([a, b].find((r) => r.statusCode === 409).json().code, 'PATRIMONIO_CODIGO_DUPLICADO');
    assert.equal(await prisma().familiaPatrimonial.count({ where: { cliente_id: s.c, codigo: 'CORRIDA' } }), 1);
  });

  // A9: o unique do banco diferencia maiúsculas; sob concorrência, só a trava do catálogo barra o nome repetido em outra caixa.
  test('corrida de NOME sem diferenciar maiúsculas (códigos distintos) → [201, 409 PATRIMONIO_NOME_DUPLICADO]: família e tipo (na família); um nome só', async () => {
    const s = await montarPatrimonio(app);
    const p = prisma();
    const casos = [
      ['/patrimonio-familias', (codigo, nome) => ({ codigo, nome, natureza: 'OUTRO' }), ['Galpões', 'GALPÕES'], (nome) => p.familiaPatrimonial.count({ where: { cliente_id: s.c, nome: { equals: nome, mode: 'insensitive' } } })],
      [
        '/patrimonio-tipos', (codigo, nome) => ({ familia_id: s.fam.MAQUINAS, codigo, nome }), ['Grade aradora', 'GRADE ARADORA'],
        (nome) => p.tipoPatrimonial.count({ where: { cliente_id: s.c, familia_id: s.fam.MAQUINAS, nome: { equals: nome, mode: 'insensitive' } } }),
      ],
    ];
    for (const [url, corpo, [nome1, nome2], contar] of casos) {
      const [a, b] = await Promise.all([req('POST', url, s.token, corpo('CORRIDA_N1', nome1)), req('POST', url, s.token, corpo('CORRIDA_N2', nome2))]);
      assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 409], `${url}: ${a.body} ${b.body}`);
      assert.deepEqual(erro([a, b].find((r) => r.statusCode === 409)), [409, 'PATRIMONIO_NOME_DUPLICADO', 'nome', 'nome_repetido'], url);
      assert.equal(await contar(nome1), 1, `${url}: um nome só`);
    }
    // PATCH: duas famílias renomeadas ao mesmo tempo para o mesmo nome em caixas diferentes.
    const post = (codigo, nome) => ok(req('POST', '/patrimonio-familias', s.token, { codigo, nome, natureza: 'OUTRO' }), 201);
    const [x, y] = [await post('REN_X', 'Renomear X'), await post('REN_Y', 'Renomear Y')];
    const [rx, ry] = await Promise.all([
      req('PATCH', `/patrimonio-familias/${x.id}`, s.token, { versao: 1, nome: 'Depósito central' }),
      req('PATCH', `/patrimonio-familias/${y.id}`, s.token, { versao: 1, nome: 'DEPÓSITO CENTRAL' }),
    ]);
    assert.deepEqual([rx.statusCode, ry.statusCode].sort(), [200, 409], `${rx.body} ${ry.body}`);
    assert.equal([rx, ry].find((r) => r.statusCode === 409).json().code, 'PATRIMONIO_NOME_DUPLICADO');
    assert.equal(await p.familiaPatrimonial.count({ where: { cliente_id: s.c, nome: { equals: 'depósito central', mode: 'insensitive' } } }), 1);
  });

  test('nome único: `%`, `_` e `\\` são literais na comparação sem diferenciar maiúsculas (família e tipo)', async () => {
    const s = await montarPatrimonio(app);
    const casos = [
      ['/patrimonio-familias', (codigo, nome) => ({ codigo, nome, natureza: 'OUTRO' })],
      ['/patrimonio-tipos', (codigo, nome) => ({ familia_id: s.fam.MAQUINAS, codigo, nome })],
    ];
    for (const [url, corpo] of casos) {
      const post = (codigo, nome) => req('POST', url, s.token, corpo(codigo, nome));
      const criado = async (codigo, nome, rotulo) => {
        const r = await post(codigo, nome);
        assert.equal(r.statusCode, 201, `${url} ${rotulo}: ${r.body}`);
      };
      await criado('LIKE_1', 'LinhaX1', 'base');
      await criado('LIKE_2', 'Linha_1', "'_' não casa com qualquer caractere");
      await criado('LIKE_3', 'Biodiesel 100% de soja', 'base');
      await criado('LIKE_4', 'Biodiesel%', "'%' não casa com qualquer resto");
      await criado('LIKE_5', 'Linha\\Nova', 'base');
      const repetido = await post('LIKE_6', 'LINHA\\NOVA');
      assert.deepEqual(erro(repetido), [409, 'PATRIMONIO_NOME_DUPLICADO', 'nome', 'nome_repetido'], `${url}: '\\' é literal: ${repetido.body}`);
      // Escapado, o curinga continua comparado sem diferenciar maiúsculas.
      assert.deepEqual(erro(await post('LIKE_7', 'linha_1')), [409, 'PATRIMONIO_NOME_DUPLICADO', 'nome', 'nome_repetido'], `${url}: '_' em outra caixa`);
    }
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('K3 — tipos', () => {
  test('família inexistente, de outro tenant ou inativa recusada; `perfis` → 400; familia_id/código imutáveis; nome único na família; filtro, 404 cruzado e auditoria sem perfis', async () => {
    const s = await montarPatrimonio(app);
    const outro = await montarPatrimonio(app);
    const t = s.token;
    const tipo = (corpo, tok = t) => req('POST', '/patrimonio-tipos', tok, corpo);

    assert.deepEqual(erro(await tipo({ familia_id: INEXISTENTE, codigo: 'NOVO', nome: 'Novo' })), [422, 'BEM_REFERENCIA_INVALIDA', 'familia_id', 'inexistente']);
    assert.deepEqual(erro(await tipo({ familia_id: outro.fam.MAQUINAS, codigo: 'NOVO', nome: 'Novo' })), [422, 'BEM_REFERENCIA_INVALIDA', 'familia_id', 'inexistente']);
    const fam = await ok(req('POST', '/patrimonio-familias', t, { codigo: 'PROVISORIA', nome: 'Provisória', natureza: 'OUTRO' }), 201);
    await ok(req('PATCH', `/patrimonio-familias/${fam.id}`, t, { versao: 1, ativo: false }));
    assert.deepEqual(erro(await tipo({ familia_id: fam.id, codigo: 'NOVO', nome: 'Novo' })), [422, 'BEM_REFERENCIA_INVALIDA', 'familia_id', 'inativo']);
    assert.deepEqual(erro(await tipo({ familia_id: fam.id, nome: 'Novo' })), [422, 'BEM_REFERENCIA_INVALIDA', 'familia_id', 'inativo'], 'sem código: a família é conferida igual');
    assert.equal(await prisma().tipoPatrimonial.count({ where: { cliente_id: s.c, codigo: 'NOVO' } }), 0);

    // D-PROD-161: perfis saíram do contrato.
    for (const corpo of [
      { familia_id: s.fam.BENFEITORIAS, codigo: 'POCILGA', nome: 'Pocilga', perfis: [] },
      { familia_id: s.fam.BENFEITORIAS, nome: 'Pocilga', perfis: [{ perfil_id: INEXISTENTE }] },
    ]) {
      assert.deepEqual(erro(await tipo(corpo)).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], JSON.stringify(corpo));
    }
    const criado = await ok(tipo({ familia_id: s.fam.BENFEITORIAS, codigo: 'pocilga', nome: 'Pocilga', descricao: 'DESCSENTINELA', vida_util_meses_sugerida: 240 }), 201);
    assert.equal(criado.codigo, 'POCILGA');
    assert.equal(criado.familia.codigo, 'BENFEITORIAS');
    assert.deepEqual(Object.keys(criado).sort(), ['ativo', 'codigo', 'created_date', 'descricao', 'familia', 'familia_id', 'id', 'nome', 'updated_date', 'versao', 'vida_util_meses_sugerida']);
    assert.deepEqual(await ok(req('GET', `/patrimonio-tipos/${criado.id}`, t)), criado);
    assert.equal((await req('PATCH', `/patrimonio-tipos/${criado.id}`, t, { versao: 1, perfis: [] })).statusCode, 400, 'PATCH com perfis');

    // familia_id e código imutáveis (400); nome único DENTRO da família.
    for (const corpo of [{ versao: 1, familia_id: s.fam.MAQUINAS }, { versao: 1, codigo: 'OUTRO' }]) {
      assert.equal((await req('PATCH', `/patrimonio-tipos/${criado.id}`, t, corpo)).statusCode, 400, JSON.stringify(corpo));
    }
    assert.deepEqual(erro(await tipo({ familia_id: s.fam.BENFEITORIAS, codigo: 'CURRAL2', nome: 'curral' })), [409, 'PATRIMONIO_NOME_DUPLICADO', 'nome', 'nome_repetido']);
    assert.deepEqual(erro(await tipo({ familia_id: s.fam.BENFEITORIAS, nome: 'CURRAL' })), [409, 'PATRIMONIO_NOME_DUPLICADO', 'nome', 'nome_repetido'], 'sem código: nome repetido continua 409');
    assert.equal((await tipo({ familia_id: s.fam.EQUIPAMENTOS, codigo: 'CURRAL2', nome: 'Curral' })).statusCode, 201, 'o mesmo nome em outra família');
    assert.deepEqual(erro(await tipo({ familia_id: s.fam.EQUIPAMENTOS, codigo: 'curral', nome: 'Outro' })), [409, 'PATRIMONIO_CODIGO_DUPLICADO', 'codigo', 'codigo_repetido']);

    // Edição e inativação; filtro por família; 404 cruzado; auditoria sem perfis nem texto livre.
    const ed = await ok(req('PATCH', `/patrimonio-tipos/${criado.id}`, t, { versao: 1, nome: 'Pocilga coberta', descricao: null }));
    assert.equal(ed.versao, 2);
    assert.equal((await ok(req('PATCH', `/patrimonio-tipos/${criado.id}`, t, { versao: 2, nome: 'Pocilga coberta' }))).versao, 2, 'sem mudança efetiva');
    assert.equal((await ok(req('PATCH', `/patrimonio-tipos/${criado.id}`, t, { versao: 2, ativo: false }))).ativo, false);
    const daFamilia = await ok(req('GET', `/patrimonio-tipos?familia_id=${s.fam.MAQUINAS}`, t));
    assert.deepEqual(daFamilia.items.map((i) => i.codigo).sort(), ['TRATOR_ESTEIRAS', 'TRATOR_PNEUS']);
    assert.deepEqual(erro(await req('GET', `/patrimonio-tipos/${criado.id}`, outro.token)).slice(0, 2), [404, 'TIPO_PATRIMONIAL_NAO_ENCONTRADO']);
    const eventos = await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'TipoPatrimonial', entidade_id: criado.id }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(eventos.map((e) => e.acao), ['create', 'update', 'update']);
    assert.deepEqual(Object.keys(/** @type {any} */ (eventos[0].dados_novos)).sort(), ['ativo', 'codigo', 'familia_id', 'id', 'versao']);
    assert.deepEqual([.../** @type {any} */ (eventos[1].dados_novos).campos_alterados].sort(), ['descricao', 'nome']);
    assert.deepEqual(/** @type {any} */ (eventos[2].dados_novos).campos_alterados, ['ativo']);
    const texto = JSON.stringify(eventos.map((e) => [e.dados_anteriores, e.dados_novos]));
    for (const sentinela of ['DESCSENTINELA', 'Pocilga']) assert.ok(!texto.includes(sentinela), `auditoria com texto livre: ${sentinela}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('K4 — código gerado do nome (P-05)', () => {
  test('sem `codigo`: sem acentos, MAIÚSCULAS, `_`, até 28; colisão → _2, _3; curto → ITEM; nunca passa de 32; tipo e família independentes; nome repetido 409', async () => {
    const s = await montarPatrimonio(app, { catalogo: false });
    const t = s.token;
    const familia = (corpo) => req('POST', '/patrimonio-familias', t, { natureza: 'OUTRO', ...corpo });
    const criada = async (nome) => (await ok(familia({ nome }), 201)).codigo;
    assert.equal(await criada('Galpão de máquinas'), 'GALPAO_DE_MAQUINAS');
    assert.equal(await criada('Galpao de maquinas!'), 'GALPAO_DE_MAQUINAS_2', 'colisão no tenant → _2');
    assert.equal(await criada('  galpão   DE  máquinas  ?? '), 'GALPAO_DE_MAQUINAS_3');
    assert.equal(await criada('Açude & Irrigação'), 'ACUDE_IRRIGACAO');
    assert.equal(await criada('x'), 'ITEM', 'menos de 2 caracteres úteis → ITEM');
    assert.equal(await criada('?!'), 'ITEM_2');
    const longo = await criada('Trator de pneus 4x4 com cabine fechada e ar-condicionado');
    assert.equal(longo, 'TRATOR_DE_PNEUS_4X4_COM_CABI');
    assert.equal(longo.length, 28);
    const longo2 = await criada('Trator de pneus 4x4 com cabine aberta');
    assert.equal(longo2, 'TRATOR_DE_PNEUS_4X4_COM_CABI_2');
    assert.ok(longo2.length <= 32);
    // O radical cortado não termina em `_` (corte em cima de um separador).
    assert.equal(await criada('Abcdefghij abcdefghij abcde fg'), 'ABCDEFGHIJ_ABCDEFGHIJ_ABCDE', 'o 28º caractere era `_`: sai');
    // Código informado continua valendo; e ocupa o lugar do gerado.
    assert.equal((await ok(familia({ codigo: 'curral', nome: 'Curral principal' }), 201)).codigo, 'CURRAL');
    assert.equal(await criada('Curral'), 'CURRAL_2');
    // Nome repetido (sem diferenciar maiúsculas) continua 409, antes de gerar código.
    assert.deepEqual(erro(await familia({ nome: 'GALPÃO DE MÁQUINAS' })), [409, 'PATRIMONIO_NOME_DUPLICADO', 'nome', 'nome_repetido']);
    // Esgotado (radical e _2…_99 ocupados) → 409 PATRIMONIO_CODIGO_DUPLICADO.
    const p = prisma();
    await p.familiaPatrimonial.createMany({
      data: [{ codigo: 'SILO' }, ...Array.from({ length: 98 }, (_, i) => ({ codigo: `SILO_${i + 2}` }))].map((r, i) => ({ cliente_id: s.c, codigo: r.codigo, nome: `Silo ocupado ${i}`, natureza: 'OUTRO' })),
    });
    assert.deepEqual(erro(await familia({ nome: 'Silo' })), [409, 'PATRIMONIO_CODIGO_DUPLICADO', 'codigo', 'codigo_repetido']);
    assert.equal(await p.familiaPatrimonial.count({ where: { cliente_id: s.c, nome: 'Silo' } }), 0, 'nada gravado');
    // Tipo: o código é único no TENANT (não por família).
    const fam = await ok(familia({ nome: 'Máquinas pesadas', natureza: 'MAQUINA' }), 201);
    const outraFam = await ok(familia({ nome: 'Máquinas leves', natureza: 'MAQUINA' }), 201);
    assert.equal((await ok(req('POST', '/patrimonio-tipos', t, { familia_id: fam.id, nome: 'Trator' }), 201)).codigo, 'TRATOR');
    assert.equal((await ok(req('POST', '/patrimonio-tipos', t, { familia_id: outraFam.id, nome: 'Trator' }), 201)).codigo, 'TRATOR_2', 'mesmo nome em outra família, código seguinte');
    // O mesmo radical em outro tenant é livre.
    const outro = await montarPatrimonio(app, { catalogo: false });
    assert.equal((await ok(req('POST', '/patrimonio-familias', outro.token, { nome: 'Galpão de máquinas', natureza: 'OUTRO' }), 201)).codigo, 'GALPAO_DE_MAQUINAS');
  });

  test('corrida: duas criações sem código com nomes que geram o mesmo radical → 201 + 201 com códigos distintos (sob a trava do catálogo)', async () => {
    const s = await montarPatrimonio(app, { catalogo: false });
    const [a, b] = await Promise.all([
      req('POST', '/patrimonio-familias', s.token, { nome: 'Galpão A', natureza: 'OUTRO' }),
      req('POST', '/patrimonio-familias', s.token, { nome: 'Galpao-A', natureza: 'OUTRO' }),
    ]);
    assert.deepEqual([a.statusCode, b.statusCode], [201, 201], `${a.body} ${b.body}`);
    assert.deepEqual([a.json().codigo, b.json().codigo].sort(), ['GALPAO_A', 'GALPAO_A_2']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('K5 — permissões pelas ações de Bens e opções de seletor', () => {
  test('ver = Bens visualizar; criar = Bens novo|salvar|editar; editar = Bens editar|salvar; inativar = Bens inativar; telas antigas 403; sem sessão 401; conta desativada 401', async () => {
    const s = await montarPatrimonio(app);
    const bens = TELAS.bens;
    const soVer = await s.contaCom(linha(bens, { visualizar: true }));
    const soNovo = await s.contaCom(linha(bens, { visualizar: true, novo: true }));
    const soEditar = await s.contaCom(linha(bens, { visualizar: true, editar: true }));
    const soInativar = await s.contaCom(linha(bens, { visualizar: true, inativar: true }));
    const id = s.fam.EQUIPAMENTOS;
    const patch = (conta, corpo) => req('PATCH', `/patrimonio-familias/${id}`, conta.token, corpo);
    const versao = async () => (await prisma().familiaPatrimonial.findUnique({ where: { id } })).versao;

    for (const url of ['/patrimonio-familias', `/patrimonio-familias/${id}`, '/patrimonio-tipos']) assert.equal((await req('GET', url, soVer.token)).statusCode, 200, url);
    assert.deepEqual(erro(await req('POST', '/patrimonio-familias', soVer.token, { nome: 'Negada', natureza: 'OUTRO' })).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    assert.equal((await patch(soVer, { versao: 1, nome: 'Equip.' })).statusCode, 403);
    assert.equal((await req('POST', '/patrimonio-familias', soNovo.token, { nome: 'Pelo novo', natureza: 'OUTRO' })).statusCode, 201);
    assert.equal((await req('POST', '/patrimonio-familias', soEditar.token, { nome: 'Pelo editar', natureza: 'OUTRO' })).statusCode, 201, 'quem edita bem também cria pelo "+"');
    assert.equal((await patch(soNovo, { versao: 1, nome: 'Equip.' })).statusCode, 403, 'novo não edita');
    assert.equal((await patch(soEditar, { versao: 1, ativo: false })).statusCode, 403, 'editar não inativa');
    assert.equal((await patch(soInativar, { versao: 1, nome: 'Equip.', ativo: false })).statusCode, 403, 'inativar sozinho não edita');
    assert.equal(await versao(), 1, 'nada gravado pelas recusas');
    assert.equal((await ok(patch(soEditar, { versao: 1, nome: 'Equipamentos fixos' }))).versao, 2);
    assert.equal((await ok(patch(soInativar, { versao: 2, ativo: false }))).ativo, false);
    const antigas = await s.contaCom(...Object.values(TELAS_ANTIGAS).map(tudo));
    for (const url of ['/patrimonio-familias', '/patrimonio-tipos', '/bens-patrimoniais-opcoes/familias', '/bens-patrimoniais-opcoes/tipos']) {
      assert.equal((await req('GET', url, antigas.token)).statusCode, 403, `telas antigas ${url}`);
      assert.equal((await req('GET', url, null)).statusCode, 401, url);
    }
    const desativado = await s.contaCom(tudo(bens));
    await prisma().usuario.update({ where: { id: desativado.id }, data: { ativo: false } });
    assert.equal((await req('GET', '/patrimonio-familias', desativado.token)).statusCode, 401, 'sessão de conta desativada não vale');
  });

  test('opções de catálogo: só Bens visualizar; só ativos, ordem por nome, keyset, busca, formas fixas (tipo sem perfis), filtro de família, empresa_id opcional, cursor adulterado 400', async () => {
    const s = await montarPatrimonio(app);
    const soVer = await s.contaCom(linha(TELAS.bens, { visualizar: true }));
    const t = soVer.token;
    await ok(req('PATCH', `/patrimonio-familias/${s.fam.EQUIPAMENTOS}`, s.token, { versao: 1, ativo: false }));
    const nomes = [];
    let cursor = null;
    do {
      const r = await ok(req('GET', `/bens-patrimoniais-opcoes/familias?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, t));
      for (const i of r.itens) {
        assert.deepEqual(Object.keys(i).sort(), ['codigo', 'id', 'natureza', 'nome']);
        nomes.push(i.nome);
      }
      cursor = r.next_cursor;
      assert.equal(r.has_more, cursor !== null);
    } while (cursor);
    assert.deepEqual(nomes, ['Benfeitorias e instalações', 'Implementos', 'Máquinas', 'Veículos'], 'ordem por nome; inativa fora');
    const tipos = await ok(req('GET', `/bens-patrimoniais-opcoes/tipos?familia_id=${s.fam.BENFEITORIAS}&empresa_id=${s.e1.id}`, t));
    assert.equal(tipos.itens.length, 6);
    assert.deepEqual(tipos.itens.find((i) => i.codigo === 'CURRAL'), { id: s.tip.CURRAL, codigo: 'CURRAL', nome: 'Curral', familia_id: s.fam.BENFEITORIAS });
    assert.deepEqual((await ok(req('GET', '/bens-patrimoniais-opcoes/tipos?q=trator', t))).itens.map((i) => i.codigo), ['TRATOR_ESTEIRAS', 'TRATOR_PNEUS']);
    assert.equal((await ok(req('GET', '/bens-patrimoniais-opcoes/familias?q=%25', t))).itens.length, 0, 'busca literal');
    assert.equal((await req('GET', '/bens-patrimoniais-opcoes/familias?cursor=bGl4bw', t)).statusCode, 400);
    assert.equal((await req('GET', `/bens-patrimoniais-opcoes/familias?familia_id=${s.fam.MAQUINAS}`, t)).statusCode, 400, 'familia_id só em /tipos');
    assert.equal((await req('GET', '/bens-patrimoniais-opcoes/familias?limit=101', t)).statusCode, 400);
    for (const url of ['/bens-patrimoniais-opcoes/desconhecido', '/bens-patrimoniais-opcoes/perfis-medicao', '/bens-patrimoniais-opcoes/combustiveis']) {
      assert.equal((await req('GET', url, t)).statusCode, 404, url);
    }
    // Só a tela de Abastecimentos (ou só as antigas) não lista o catálogo.
    const doAbastecimento = await s.contaCom(tudo(TELAS.abastecimentos));
    assert.equal((await req('GET', '/bens-patrimoniais-opcoes/familias', doAbastecimento.token)).statusCode, 403);
    // O catálogo é do tenant: nada de outro tenant aparece.
    const outro = await montarPatrimonio(app);
    const doOutro = await ok(req('GET', '/bens-patrimoniais-opcoes/tipos', outro.token));
    assert.ok(doOutro.itens.every((i) => !Object.values(s.tip).includes(i.id)));
    assert.equal(doOutro.itens.length, 13);
  });
});
