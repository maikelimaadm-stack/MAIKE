/**
 * D-PROD-156 — Patrimônio P1-01: CATÁLOGOS do tenant (famílias, tipos, perfis
 * de medição, combustíveis e o catálogo padrão). PostgreSQL real, HTTP
 * autenticado, prova por persistência.
 *
 *  K1. Catálogo padrão: idempotente (2ª chamada cria 0), isolado por tenant,
 *      corrida instala uma vez, conflitos do A9 sem alterar nada e sem P2002
 *      abortar; só administrador real ou `is_admin`.
 *  K2. Famílias: CRUD, código normalizado, natureza/código imutáveis (400),
 *      CAS por versão, PATCH sem mudança efetiva, nome único sem diferenciar
 *      maiúsculas, keyset/filtros/busca literal, 404 cruzado sem oráculo,
 *      auditoria sem texto livre.
 *  K3. Tipos: família inexistente/inativa/de outro tenant recusada, perfis só
 *      em benfeitoria, regras dos perfis (limite, repetido, 2 principais,
 *      inexistente, inativo ao acrescentar), troca do principal (A5).
 *  K4. Perfis e combustíveis: unidade canônica derivada, unidades fora da
 *      dimensão, dimensão/finalidade/unidade imutáveis, unidade em uso não sai.
 *  K5. Permissões por ação (ver/criar/editar/inativar) e opções de seletor
 *      (A3: quem só tem a tela Tipos cria tipo com perfis).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { TELAS, corpoCurral, corpoErro, erro, http, linha, montarPatrimonio, prisma, tudo } from './patrimonioP1Cenario.mjs';

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
const ZERO = Object.freeze({ familias: 0, tipos: 0, perfis: 0, combustiveis: 0 });
const PADRAO = Object.freeze({ familias: 5, tipos: 13, perfis: 5, combustiveis: 5 });
const INEXISTENTE = 'cl0inexistente000000000000';
const instalar = (tok, corpo = {}) => req('POST', '/patrimonio-catalogo-padrao', tok, corpo);
const todos = async (tok, base) => (await ok(req('GET', `${base}?limit=100`, tok))).items;
const porCodigo = (itens, fn) => Object.fromEntries(itens.map((i) => [i.codigo, fn(i)]));
const conflitosOrdenados = (r) => r.conflitos.map((x) => `${x.recurso}:${x.codigo}:${x.motivo}`).sort();

// ─────────────────────────────────────────────────────────────────────────────
describe('K1 — catálogo padrão', () => {
  test('instala 5 famílias, 13 tipos, 5 perfis e 5 combustíveis; 2ª chamada cria 0; outro tenant é independente; corrida instala uma vez', async () => {
    const a = await montarPatrimonio(app, { catalogo: false });
    const b = await montarPatrimonio(app, { catalogo: false });
    const r1 = await ok(instalar(a.token));
    assert.deepEqual(r1, { criados: PADRAO, existentes: ZERO, conflitos: [] });
    const eventos = await prisma().auditLog.count({ where: { cliente_id: a.c, acao: 'create' } });
    assert.equal(eventos, 28, 'um evento de criação por item, na mesma transação');
    const r2 = await ok(instalar(a.token));
    assert.deepEqual(r2, { criados: ZERO, existentes: PADRAO, conflitos: [] }, '2ª chamada não cria nada');
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: a.c, acao: 'create' } }), 28, 'sem auditoria na 2ª');

    // Conteúdo do padrão (A9: sem CAPACIDADE_CARGA; GNV em m3; CURRAL com AREA principal).
    const perfis = porCodigo(await todos(a.token, '/patrimonio-perfis-medicao'), (p) => [p.dimensao, p.finalidade, p.unidade_canonica, p.unidades_permitidas]);
    assert.deepEqual(perfis, {
      AREA: ['AREA', 'DIMENSAO', 'm2', ['m2', 'ha']],
      CAPACIDADE_ANIMAL: ['CABECAS', 'CAPACIDADE', 'cab', ['cab']],
      EXTENSAO: ['EXTENSAO', 'DIMENSAO', 'm', ['m', 'km']],
      QUANTIDADE: ['QUANTIDADE', 'DIMENSAO', 'un', ['un']],
      VOLUME: ['VOLUME', 'CAPACIDADE', 'L', ['L', 'm3']],
    });
    const familias = porCodigo(await todos(a.token, '/patrimonio-familias'), (f) => [f.natureza, f.vida_util_meses_padrao]);
    assert.deepEqual(familias, {
      BENFEITORIAS: ['BENFEITORIA', 300], EQUIPAMENTOS: ['EQUIPAMENTO', 120], IMPLEMENTOS: ['IMPLEMENTO', 120], MAQUINAS: ['MAQUINA', 120], VEICULOS: ['VEICULO', 60],
    });
    const combustiveis = porCodigo(await todos(a.token, '/patrimonio-combustiveis'), (c) => c.unidade);
    assert.deepEqual(combustiveis, { DIESEL_S10: 'L', DIESEL_S500: 'L', ETANOL: 'L', GASOLINA: 'L', GNV: 'm3' });
    const tipos = porCodigo(await todos(a.token, '/patrimonio-tipos'), (t) => [t.familia.codigo, t.perfis.map((p) => `${p.perfil.codigo}${p.principal ? '*' : ''}`)]);
    assert.deepEqual(tipos, {
      BALANCA: ['EQUIPAMENTOS', []], BEBEDOURO_FIXO: ['BENFEITORIAS', ['VOLUME*']], CAMINHAO: ['VEICULOS', []], CAMINHONETE: ['VEICULOS', []],
      CERCA_ARAME: ['BENFEITORIAS', ['EXTENSAO*']], CERCA_ELETRICA: ['BENFEITORIAS', ['EXTENSAO*']], CURRAL: ['BENFEITORIAS', ['AREA*', 'CAPACIDADE_ANIMAL']],
      GALPAO: ['BENFEITORIAS', ['AREA*']], GERADOR: ['EQUIPAMENTOS', []], RESERVATORIO: ['BENFEITORIAS', ['VOLUME*']], ROCADEIRA: ['IMPLEMENTOS', []],
      TRATOR_ESTEIRAS: ['MAQUINAS', []], TRATOR_PNEUS: ['MAQUINAS', []],
    });

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

  test('A9: código existente com natureza/dimensão/unidade divergente, inativo ou nome já usado vira conflito; dependentes pulados; nada alterado; 200 sem P2002', async () => {
    const s = await montarPatrimonio(app, { catalogo: false });
    const t = s.token;
    const post = (url, corpo) => ok(req('POST', url, t, corpo), 201);
    const maq = await post('/patrimonio-familias', { codigo: 'MAQUINAS', nome: 'Minhas máquinas', natureza: 'OUTRO' });
    await post('/patrimonio-familias', { codigo: 'MINHAS_BENF', nome: 'benfeitorias e instalações', natureza: 'BENFEITORIA' });
    const frota = await post('/patrimonio-familias', { codigo: 'FROTA', nome: 'Frota leve', natureza: 'VEICULO' });
    const caminhao = await post('/patrimonio-tipos', { familia_id: frota.id, codigo: 'CAMINHAO', nome: 'Caminhão da frota' });
    const impl = await post('/patrimonio-familias', { codigo: 'IMPLEMENTOS', nome: 'Implementos agrícolas', natureza: 'IMPLEMENTO' });
    await ok(req('PATCH', `/patrimonio-familias/${impl.id}`, t, { versao: 1, ativo: false }));
    await post('/patrimonio-perfis-medicao', { codigo: 'EXTENSAO', nome: 'Extensão em área', dimensao: 'AREA', finalidade: 'DIMENSAO', unidades_permitidas: ['m2'] });
    const area = await post('/patrimonio-perfis-medicao', { codigo: 'AREA', nome: 'Área própria', dimensao: 'AREA', finalidade: 'DIMENSAO', unidades_permitidas: ['m2', 'ha'] });
    await ok(req('PATCH', `/patrimonio-perfis-medicao/${area.id}`, t, { versao: 1, ativo: false }));
    const gnv = await post('/patrimonio-combustiveis', { codigo: 'GNV', nome: 'GNV líquido', unidade: 'L' });
    await post('/patrimonio-combustiveis', { codigo: 'X1', nome: 'gasolina' });
    await post('/patrimonio-combustiveis', { codigo: 'ETANOL', nome: 'Etanol hidratado' });

    const esperadoConflitos = [
      'combustiveis:GASOLINA:nome_em_uso', 'combustiveis:GNV:unidade_divergente',
      'familias:BENFEITORIAS:nome_em_uso', 'familias:IMPLEMENTOS:inativo', 'familias:MAQUINAS:natureza_divergente',
      'perfis:AREA:inativo', 'perfis:EXTENSAO:dimensao_divergente',
      'tipos:BEBEDOURO_FIXO:dependencia_em_conflito', 'tipos:CAMINHAO:familia_divergente', 'tipos:CERCA_ARAME:dependencia_em_conflito',
      'tipos:CERCA_ELETRICA:dependencia_em_conflito', 'tipos:CURRAL:dependencia_em_conflito', 'tipos:GALPAO:dependencia_em_conflito',
      'tipos:RESERVATORIO:dependencia_em_conflito', 'tipos:ROCADEIRA:dependencia_em_conflito', 'tipos:TRATOR_ESTEIRAS:dependencia_em_conflito',
      'tipos:TRATOR_PNEUS:dependencia_em_conflito',
    ];
    const r1 = await ok(instalar(t));
    assert.deepEqual(conflitosOrdenados(r1), esperadoConflitos);
    assert.deepEqual(r1.criados, { familias: 2, tipos: 3, perfis: 3, combustiveis: 2 });
    assert.deepEqual(r1.existentes, { familias: 0, tipos: 0, perfis: 0, combustiveis: 1 });
    // Os itens em conflito ficaram como estavam.
    const p = prisma();
    assert.equal((await p.familiaPatrimonial.findUnique({ where: { id: maq.id } })).natureza, 'OUTRO');
    assert.equal((await p.familiaPatrimonial.findUnique({ where: { id: impl.id } })).ativo, false);
    assert.equal((await p.perfilMedicao.findUnique({ where: { id: area.id } })).ativo, false);
    assert.equal((await p.tipoCombustivel.findUnique({ where: { id: gnv.id } })).unidade, 'L');
    assert.equal((await p.tipoPatrimonial.findUnique({ where: { id: caminhao.id } })).familia_id, frota.id);
    assert.equal(await p.familiaPatrimonial.count({ where: { cliente_id: s.c, codigo: 'BENFEITORIAS' } }), 0);
    // Idempotente também com conflitos.
    const r2 = await ok(instalar(t));
    assert.deepEqual(conflitosOrdenados(r2), esperadoConflitos);
    assert.deepEqual(r2.criados, ZERO);
    assert.deepEqual(r2.existentes, { familias: 2, tipos: 3, perfis: 3, combustiveis: 3 });
  });

  test('A9: nome já usado por TIPO (na mesma família) e por PERFIL vira nome_em_uso; dependentes pulados; o resto instala; 200 sem P2002 abortar a transação', async () => {
    const s = await montarPatrimonio(app, { catalogo: false });
    const t = s.token;
    const post = (url, corpo) => ok(req('POST', url, t, corpo), 201);
    // Família BENFEITORIAS correta (ativa, mesma natureza): conta como existente e os tipos dela são instalados nela.
    const benf = await post('/patrimonio-familias', { codigo: 'BENFEITORIAS', nome: 'Benfeitorias da fazenda', natureza: 'BENFEITORIA' });
    // Nome EXATO do padrão: o unique [cliente_id, familia_id, nome] diferencia maiúsculas, então só o nome exato bateria em P2002.
    const meuGalpao = await post('/patrimonio-tipos', { familia_id: benf.id, codigo: 'MEU_GALPAO', nome: 'Galpão' });
    const meuVolume = await post('/patrimonio-perfis-medicao', { codigo: 'MEU_VOLUME', nome: 'Volume', dimensao: 'VOLUME', finalidade: 'CAPACIDADE', unidades_permitidas: ['L'] });
    const antes = JSON.stringify([
      await prisma().tipoPatrimonial.findUnique({ where: { id: meuGalpao.id } }),
      await prisma().perfilMedicao.findUnique({ where: { id: meuVolume.id } }),
      await prisma().familiaPatrimonial.findUnique({ where: { id: benf.id } }),
    ]);

    const r = await ok(instalar(t));
    assert.deepEqual(conflitosOrdenados(r), [
      'perfis:VOLUME:nome_em_uso', 'tipos:BEBEDOURO_FIXO:dependencia_em_conflito', 'tipos:GALPAO:nome_em_uso', 'tipos:RESERVATORIO:dependencia_em_conflito',
    ]);
    assert.deepEqual(r.criados, { familias: 4, tipos: 10, perfis: 4, combustiveis: 5 });
    assert.deepEqual(r.existentes, { familias: 1, tipos: 0, perfis: 0, combustiveis: 0 });
    const p = prisma();
    assert.equal(await p.tipoPatrimonial.count({ where: { cliente_id: s.c, codigo: { in: ['GALPAO', 'RESERVATORIO', 'BEBEDOURO_FIXO'] } } }), 0);
    assert.equal(await p.perfilMedicao.count({ where: { cliente_id: s.c, codigo: 'VOLUME' } }), 0);
    assert.equal((await p.tipoPatrimonial.findFirst({ where: { cliente_id: s.c, codigo: 'CURRAL' } }))?.familia_id, benf.id, 'tipos do padrão entram na família existente');
    assert.equal(
      JSON.stringify([
        await p.tipoPatrimonial.findUnique({ where: { id: meuGalpao.id } }),
        await p.perfilMedicao.findUnique({ where: { id: meuVolume.id } }),
        await p.familiaPatrimonial.findUnique({ where: { id: benf.id } }),
      ]),
      antes,
      'MEU_GALPAO, MEU_VOLUME e a família intactos',
    );
    // Idempotente: a 2ª chamada repete os conflitos e não cria nada.
    const r2 = await ok(instalar(t));
    assert.deepEqual(conflitosOrdenados(r2), conflitosOrdenados(r));
    assert.deepEqual(r2.criados, ZERO);
  });

  test('só administrador real ou is_admin; corpo fechado; sem sessão 401', async () => {
    const s = await montarPatrimonio(app, { catalogo: false });
    const todasAsTelas = await s.contaCom(...Object.values(TELAS).map(tudo));
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
  test('corrida de NOME sem diferenciar maiúsculas (códigos distintos) → [201, 409 PATRIMONIO_NOME_DUPLICADO]: família, tipo (na família), perfil e combustível; um nome só', async () => {
    const s = await montarPatrimonio(app);
    const p = prisma();
    const casos = [
      ['/patrimonio-familias', (codigo, nome) => ({ codigo, nome, natureza: 'OUTRO' }), ['Galpões', 'GALPÕES'], (nome) => p.familiaPatrimonial.count({ where: { cliente_id: s.c, nome: { equals: nome, mode: 'insensitive' } } })],
      [
        '/patrimonio-tipos', (codigo, nome) => ({ familia_id: s.fam.MAQUINAS, codigo, nome }), ['Grade aradora', 'GRADE ARADORA'],
        (nome) => p.tipoPatrimonial.count({ where: { cliente_id: s.c, familia_id: s.fam.MAQUINAS, nome: { equals: nome, mode: 'insensitive' } } }),
      ],
      [
        '/patrimonio-perfis-medicao', (codigo, nome) => ({ codigo, nome, dimensao: 'QUANTIDADE', finalidade: 'DIMENSAO', unidades_permitidas: ['un'] }), ['Mourões', 'MOURÕES'],
        (nome) => p.perfilMedicao.count({ where: { cliente_id: s.c, nome: { equals: nome, mode: 'insensitive' } } }),
      ],
      ['/patrimonio-combustiveis', (codigo, nome) => ({ codigo, nome }), ['Biodiesel B100', 'BIODIESEL B100'], (nome) => p.tipoCombustivel.count({ where: { cliente_id: s.c, nome: { equals: nome, mode: 'insensitive' } } })],
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

  test('nome único: `%`, `_` e `\\` são literais na comparação sem diferenciar maiúsculas (família, tipo, perfil e combustível)', async () => {
    const s = await montarPatrimonio(app);
    const casos = [
      ['/patrimonio-familias', (codigo, nome) => ({ codigo, nome, natureza: 'OUTRO' })],
      ['/patrimonio-tipos', (codigo, nome) => ({ familia_id: s.fam.MAQUINAS, codigo, nome })],
      ['/patrimonio-perfis-medicao', (codigo, nome) => ({ codigo, nome, dimensao: 'QUANTIDADE', finalidade: 'DIMENSAO', unidades_permitidas: ['un'] })],
      ['/patrimonio-combustiveis', (codigo, nome) => ({ codigo, nome })],
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
  test('família inexistente, de outro tenant ou inativa recusada; perfis só em benfeitoria e com as regras; familia_id/código imutáveis; troca do principal (A5)', async () => {
    const s = await montarPatrimonio(app);
    const outro = await montarPatrimonio(app);
    const t = s.token;
    const tipo = (corpo, tok = t) => req('POST', '/patrimonio-tipos', tok, corpo);

    assert.deepEqual(erro(await tipo({ familia_id: INEXISTENTE, codigo: 'NOVO', nome: 'Novo' })), [422, 'BEM_REFERENCIA_INVALIDA', 'familia_id', 'inexistente']);
    assert.deepEqual(erro(await tipo({ familia_id: outro.fam.MAQUINAS, codigo: 'NOVO', nome: 'Novo' })), [422, 'BEM_REFERENCIA_INVALIDA', 'familia_id', 'inexistente']);
    const fam = await ok(req('POST', '/patrimonio-familias', t, { codigo: 'PROVISORIA', nome: 'Provisória', natureza: 'OUTRO' }), 201);
    await ok(req('PATCH', `/patrimonio-familias/${fam.id}`, t, { versao: 1, ativo: false }));
    assert.deepEqual(erro(await tipo({ familia_id: fam.id, codigo: 'NOVO', nome: 'Novo' })), [422, 'BEM_REFERENCIA_INVALIDA', 'familia_id', 'inativo']);
    assert.equal(await prisma().tipoPatrimonial.count({ where: { cliente_id: s.c, codigo: 'NOVO' } }), 0);

    // Perfis só para família BENFEITORIA.
    const naoAplic = await tipo({ familia_id: s.fam.MAQUINAS, codigo: 'PULV', nome: 'Pulverizador', perfis: [{ perfil_id: s.per.AREA }] });
    assert.deepEqual(erro(naoAplic), [422, 'TIPO_PERFIS_NAO_APLICAVEIS', 'perfis', 'natureza_sem_medicoes']);
    // Regras da lista de perfis (TIPO_PERFIS_INVALIDOS com reason).
    const benf = (perfis) => tipo({ familia_id: s.fam.BENFEITORIAS, codigo: 'POCILGA', nome: 'Pocilga', perfis });
    assert.deepEqual(erro(await benf(Array.from({ length: 11 }, () => ({ perfil_id: s.per.AREA })))), [422, 'TIPO_PERFIS_INVALIDOS', 'perfis', 'limite']);
    assert.deepEqual(erro(await benf([{ perfil_id: s.per.AREA }, { perfil_id: s.per.AREA }])), [422, 'TIPO_PERFIS_INVALIDOS', 'perfis', 'duplicado']);
    assert.deepEqual(erro(await benf([{ perfil_id: s.per.AREA, principal: true }, { perfil_id: s.per.EXTENSAO, principal: true }])), [422, 'TIPO_PERFIS_INVALIDOS', 'perfis', 'principal_duplicado']);
    assert.deepEqual(erro(await benf([{ perfil_id: outro.per.AREA }])), [422, 'TIPO_PERFIS_INVALIDOS', 'perfis', 'inexistente']);
    await ok(req('PATCH', `/patrimonio-perfis-medicao/${s.per.QUANTIDADE}`, t, { versao: 1, ativo: false }));
    assert.deepEqual(erro(await benf([{ perfil_id: s.per.QUANTIDADE }])), [422, 'TIPO_PERFIS_INVALIDOS', 'perfis', 'inativo']);

    const criado = await ok(benf([{ perfil_id: s.per.AREA, principal: true }, { perfil_id: s.per.EXTENSAO }]), 201);
    assert.equal(criado.codigo, 'POCILGA');
    assert.equal(criado.familia.codigo, 'BENFEITORIAS');
    assert.deepEqual(criado.perfis.map((p) => [p.perfil.codigo, p.principal]), [['AREA', true], ['EXTENSAO', false]]);
    assert.deepEqual(await ok(req('GET', `/patrimonio-tipos/${criado.id}`, t)), criado);

    // A5: trocar o principal enviando o novo primeiro (sem colidir no unique).
    const troca = await ok(req('PATCH', `/patrimonio-tipos/${criado.id}`, t, { versao: 1, perfis: [{ perfil_id: s.per.EXTENSAO, principal: true }, { perfil_id: s.per.AREA }] }));
    assert.deepEqual(troca.perfis.map((p) => [p.perfil.codigo, p.principal]), [['EXTENSAO', true], ['AREA', false]]);
    assert.equal(troca.versao, 2);
    const vinculos = await prisma().tipoPatrimonialPerfil.findMany({ where: { cliente_id: s.c, tipo_id: criado.id }, orderBy: { ordem: 'asc' } });
    assert.deepEqual(vinculos.map((v) => [v.perfil_id, v.principal]), [[s.per.EXTENSAO, true], [s.per.AREA, null]], 'principal só true ou NULL');
    // Mesma lista na mesma ordem: sem mudança efetiva.
    assert.equal((await ok(req('PATCH', `/patrimonio-tipos/${criado.id}`, t, { versao: 2, perfis: [{ perfil_id: s.per.EXTENSAO, principal: true }, { perfil_id: s.per.AREA }] }))).versao, 2);
    // Perfil já vinculado e depois inativado pode continuar; acrescentar o inativo, não.
    await ok(req('PATCH', `/patrimonio-perfis-medicao/${s.per.EXTENSAO}`, t, { versao: 1, ativo: false }));
    const mantem = await ok(req('PATCH', `/patrimonio-tipos/${criado.id}`, t, { versao: 2, nome: 'Pocilga coberta', perfis: [{ perfil_id: s.per.EXTENSAO, principal: true }, { perfil_id: s.per.AREA }] }));
    assert.deepEqual([mantem.versao, mantem.perfis[0].perfil.ativo], [3, false]);
    assert.deepEqual(erro(await req('PATCH', `/patrimonio-tipos/${criado.id}`, t, { versao: 3, perfis: [{ perfil_id: s.per.EXTENSAO }, { perfil_id: s.per.QUANTIDADE }] })), [422, 'TIPO_PERFIS_INVALIDOS', 'perfis', 'inativo']);
    // Remover todos os perfis é um sync válido.
    assert.deepEqual((await ok(req('PATCH', `/patrimonio-tipos/${criado.id}`, t, { versao: 3, perfis: [] }))).perfis, []);

    // familia_id e código imutáveis (400); nome único DENTRO da família.
    for (const corpo of [{ versao: 4, familia_id: s.fam.MAQUINAS }, { versao: 4, codigo: 'OUTRO' }]) {
      assert.equal((await req('PATCH', `/patrimonio-tipos/${criado.id}`, t, corpo)).statusCode, 400, JSON.stringify(corpo));
    }
    assert.deepEqual(erro(await tipo({ familia_id: s.fam.BENFEITORIAS, codigo: 'CURRAL2', nome: 'curral' })), [409, 'PATRIMONIO_NOME_DUPLICADO', 'nome', 'nome_repetido']);
    assert.equal((await tipo({ familia_id: s.fam.EQUIPAMENTOS, codigo: 'CURRAL2', nome: 'Curral' })).statusCode, 201, 'o mesmo nome em outra família');
    assert.deepEqual(erro(await tipo({ familia_id: s.fam.EQUIPAMENTOS, codigo: 'curral', nome: 'Outro' })), [409, 'PATRIMONIO_CODIGO_DUPLICADO', 'codigo', 'codigo_repetido']);

    // Filtro por família, 404 cruzado e auditoria dos perfis.
    const daFamilia = await ok(req('GET', `/patrimonio-tipos?familia_id=${s.fam.MAQUINAS}`, t));
    assert.deepEqual(daFamilia.items.map((i) => i.codigo).sort(), ['TRATOR_ESTEIRAS', 'TRATOR_PNEUS']);
    assert.deepEqual(erro(await req('GET', `/patrimonio-tipos/${criado.id}`, outro.token)).slice(0, 2), [404, 'TIPO_PATRIMONIAL_NAO_ENCONTRADO']);
    const evento = await prisma().auditLog.findFirst({ where: { cliente_id: s.c, entidade: 'TipoPatrimonial', entidade_id: criado.id, acao: 'update' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(/** @type {any} */ (evento.dados_novos).campos_alterados, ['perfis']);
    assert.deepEqual(/** @type {any} */ (evento.dados_novos).perfis, [`${s.per.EXTENSAO}*`, s.per.AREA]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('K4 — perfis de medição e combustíveis', () => {
  test('perfil: canônica derivada; unidades fora da dimensão/sem canônica/repetidas/vazias → 422; dimensão e finalidade imutáveis; unidade usada por medição não sai (409)', async () => {
    const s = await montarPatrimonio(app);
    const t = s.token;
    const perfil = (corpo) => req('POST', '/patrimonio-perfis-medicao', t, { codigo: 'CARGA', nome: 'Capacidade de carga', dimensao: 'MASSA', finalidade: 'CAPACIDADE', ...corpo });
    assert.deepEqual(erro(await perfil({ unidades_permitidas: ['kg', 'km'] })), [422, 'PERFIL_UNIDADES_INVALIDAS', 'unidades_permitidas', 'fora_da_dimensao']);
    assert.deepEqual(erro(await perfil({ unidades_permitidas: ['t'] })), [422, 'PERFIL_UNIDADES_INVALIDAS', 'unidades_permitidas', 'sem_canonica']);
    assert.deepEqual(erro(await perfil({ unidades_permitidas: ['kg', 'kg'] })), [422, 'PERFIL_UNIDADES_INVALIDAS', 'unidades_permitidas', 'repetida']);
    assert.deepEqual(erro(await perfil({ unidades_permitidas: [] })), [422, 'PERFIL_UNIDADES_INVALIDAS', 'unidades_permitidas', 'vazia']);
    assert.equal((await perfil({ unidades_permitidas: ['kg'], unidade_canonica: 't' })).statusCode, 400, 'a canônica nunca vem do corpo');
    assert.equal((await perfil({ unidades_permitidas: ['kg'], dimensao: 'PESO' })).statusCode, 400);
    const carga = await ok(perfil({ unidades_permitidas: ['t', 'kg'] }), 201);
    assert.deepEqual([carga.unidade_canonica, carga.unidades_permitidas, carga.dimensao, carga.finalidade], ['kg', ['kg', 't'], 'MASSA', 'CAPACIDADE']);
    for (const corpo of [{ versao: 1, dimensao: 'VOLUME' }, { versao: 1, finalidade: 'DIMENSAO' }, { versao: 1, unidade_canonica: 't' }, { versao: 1, codigo: 'X' }]) {
      assert.equal((await req('PATCH', `/patrimonio-perfis-medicao/${carga.id}`, t, corpo)).statusCode, 400, JSON.stringify(corpo));
    }
    // Unidade não usada sai; unidade usada por medição de bem, não.
    assert.deepEqual((await ok(req('PATCH', `/patrimonio-perfis-medicao/${carga.id}`, t, { versao: 1, unidades_permitidas: ['kg'] }))).unidades_permitidas, ['kg']);
    await ok(req('POST', '/bens-patrimoniais', t, corpoCurral(s)), 201);
    const emUso = await req('PATCH', `/patrimonio-perfis-medicao/${s.per.AREA}`, t, { versao: 1, unidades_permitidas: ['m2'] });
    assert.deepEqual(erro(emUso), [409, 'PERFIL_UNIDADE_EM_USO', 'unidades_permitidas', 'unidade_em_uso']);
    assert.deepEqual(emUso.json().details, { unidades: ['ha'] });
    assert.deepEqual((await prisma().perfilMedicao.findUnique({ where: { id: s.per.AREA } })).unidades_permitidas, ['m2', 'ha']);
    assert.deepEqual(erro(await req('GET', `/patrimonio-perfis-medicao/${carga.id}`, (await montarPatrimonio(app, { catalogo: false })).token)).slice(0, 2), [404, 'PERFIL_MEDICAO_NAO_ENCONTRADO']);
  });

  test('combustível: unidade padrão L, m3 aceita, unidade imutável e fora do domínio 400; inativar; 404 cruzado', async () => {
    const s = await montarPatrimonio(app, { catalogo: false });
    const t = s.token;
    const b100 = await ok(req('POST', '/patrimonio-combustiveis', t, { codigo: 'b100', nome: 'Biodiesel B100' }), 201);
    assert.deepEqual([b100.codigo, b100.unidade, b100.versao], ['B100', 'L', 1]);
    assert.equal((await ok(req('POST', '/patrimonio-combustiveis', t, { codigo: 'BIOMETANO', nome: 'Biometano', unidade: 'm3' }), 201)).unidade, 'm3');
    for (const corpo of [{ codigo: 'KG1', nome: 'Kg', unidade: 'kg' }, { codigo: 'M3X', nome: 'M3 maiúsculo', unidade: 'M3' }]) {
      assert.equal((await req('POST', '/patrimonio-combustiveis', t, corpo)).statusCode, 400, JSON.stringify(corpo));
    }
    assert.equal((await req('PATCH', `/patrimonio-combustiveis/${b100.id}`, t, { versao: 1, unidade: 'm3' })).statusCode, 400);
    const inat = await ok(req('PATCH', `/patrimonio-combustiveis/${b100.id}`, t, { versao: 1, ativo: false }));
    assert.deepEqual([inat.ativo, inat.versao, inat.unidade], [false, 2, 'L']);
    const outro = await montarPatrimonio(app, { catalogo: false });
    assert.deepEqual(erro(await req('GET', `/patrimonio-combustiveis/${b100.id}`, outro.token)).slice(0, 2), [404, 'COMBUSTIVEL_NAO_ENCONTRADO']);
    assert.equal((await req('PATCH', `/patrimonio-combustiveis/${b100.id}`, outro.token, { versao: 2, nome: 'X' })).statusCode, 404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('K5 — permissões por ação e opções de seletor', () => {
  test('ver, criar, editar e inativar separados; tela errada 403; sem sessão 401; is_admin e administrador real passam', async () => {
    const s = await montarPatrimonio(app);
    const tela = TELAS.combustiveis;
    const soVer = await s.contaCom(linha(tela, { visualizar: true }));
    const soNovo = await s.contaCom(linha(tela, { visualizar: true, novo: true }));
    const soSalvar = await s.contaCom(linha(tela, { visualizar: true, salvar: true }));
    const soEditar = await s.contaCom(linha(tela, { visualizar: true, editar: true }));
    const soInativar = await s.contaCom(linha(tela, { visualizar: true, inativar: true }));
    const editarInativar = await s.contaCom(linha(tela, { visualizar: true, editar: true, inativar: true }));
    const id = s.comb.GNV;
    const patch = (conta, corpo) => req('PATCH', `/patrimonio-combustiveis/${id}`, conta.token, corpo);
    const versao = async () => (await prisma().tipoCombustivel.findUnique({ where: { id } })).versao;

    assert.equal((await req('GET', '/patrimonio-combustiveis', soVer.token)).statusCode, 200);
    assert.equal((await req('GET', `/patrimonio-combustiveis/${id}`, soVer.token)).statusCode, 200);
    assert.equal((await req('GET', '/patrimonio-familias', soVer.token)).statusCode, 403, 'só a própria tela');
    assert.deepEqual(erro(await req('POST', '/patrimonio-combustiveis', soVer.token, { codigo: 'B100', nome: 'Biodiesel' })).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    assert.equal((await patch(soVer, { versao: 1, nome: 'Gás' })).statusCode, 403);
    assert.equal((await req('POST', '/patrimonio-combustiveis', soNovo.token, { codigo: 'B100', nome: 'Biodiesel' })).statusCode, 201);
    assert.equal((await req('POST', '/patrimonio-combustiveis', soSalvar.token, { codigo: 'B200', nome: 'Biodiesel 2' })).statusCode, 201);
    assert.equal((await patch(soNovo, { versao: 1, nome: 'Gás natural' })).statusCode, 403, 'novo não edita');
    assert.equal((await patch(soEditar, { versao: 1, ativo: false })).statusCode, 403, 'editar não inativa');
    assert.equal((await patch(soInativar, { versao: 1, nome: 'Gás natural', ativo: false })).statusCode, 403, 'inativar sozinho não edita');
    assert.equal((await patch(soInativar, { versao: 1, nome: 'Gás natural' })).statusCode, 403);
    assert.equal(await versao(), 1, 'nada gravado pelas recusas');
    assert.equal((await ok(patch(soEditar, { versao: 1, nome: 'Gás natural' }))).versao, 2);
    assert.equal((await ok(patch(soSalvar, { versao: 2, nome: 'Gás natural veicular' }))).versao, 3, 'salvar edita');
    assert.equal((await ok(patch(soInativar, { versao: 3, ativo: false }))).ativo, false);
    assert.deepEqual(await ok(patch(editarInativar, { versao: 4, nome: 'GNV', ativo: true })).then((r) => [r.nome, r.ativo, r.versao]), ['GNV', true, 5]);
    const isAdmin = await s.conta({ is_admin: true });
    const adminReal = await s.conta(null, { papel_tenant: 'administrador' });
    assert.equal((await ok(patch(isAdmin, { versao: 5, ativo: false }))).versao, 6);
    assert.equal((await ok(patch(adminReal, { versao: 6, ativo: true }))).versao, 7);
    const semTela = await s.contaCom(linha(TELAS.bens, { visualizar: true }));
    for (const url of ['/patrimonio-familias', '/patrimonio-tipos', '/patrimonio-perfis-medicao', '/patrimonio-combustiveis']) {
      assert.equal((await req('GET', url, semTela.token)).statusCode, 403, url);
      assert.equal((await req('GET', url, null)).statusCode, 401, url);
    }
    const desativado = await s.contaCom(tudo(tela));
    await prisma().usuario.update({ where: { id: desativado.id }, data: { ativo: false } });
    assert.equal((await req('GET', '/patrimonio-combustiveis', desativado.token)).statusCode, 401, 'sessão de conta desativada não vale');
  });

  test('A3: só a tela Tipos (visualizar + novo) usa as opções de catálogo e cria tipo com perfis; não vê responsáveis nem bens', async () => {
    const s = await montarPatrimonio(app);
    const soTipos = await s.contaCom(linha(TELAS.tipos, { visualizar: true, novo: true }));
    const t = soTipos.token;
    const familias = await ok(req('GET', '/bens-patrimoniais-opcoes/familias', t));
    const benf = familias.itens.find((f) => f.natureza === 'BENFEITORIA');
    const perfis = await ok(req('GET', '/bens-patrimoniais-opcoes/perfis-medicao', t));
    const area = perfis.itens.find((p) => p.codigo === 'AREA');
    const volume = perfis.itens.find((p) => p.codigo === 'VOLUME');
    assert.equal((await req('GET', `/bens-patrimoniais-opcoes/tipos?familia_id=${benf.id}`, t)).statusCode, 200);
    assert.equal((await req('GET', '/bens-patrimoniais-opcoes/combustiveis', t)).statusCode, 200);
    const criado = await ok(req('POST', '/patrimonio-tipos', t, {
      familia_id: benf.id, codigo: 'SILO', nome: 'Silo', perfis: [{ perfil_id: volume.id, principal: true }, { perfil_id: area.id }],
    }), 201);
    assert.deepEqual(criado.perfis.map((p) => [p.perfil.codigo, p.principal]), [['VOLUME', true], ['AREA', false]]);
    for (const url of [`/bens-patrimoniais-opcoes/responsaveis?empresa_id=${s.e1.id}`, `/bens-patrimoniais-opcoes/parceiros?empresa_id=${s.e1.id}`, `/bens-patrimoniais?empresa_id=${s.e1.id}`, '/patrimonio-familias']) {
      assert.equal((await req('GET', url, t)).statusCode, 403, url);
    }
    assert.equal((await req('PATCH', `/patrimonio-tipos/${criado.id}`, t, { versao: 1, nome: 'Silo graneleiro' })).statusCode, 403, 'sem editar');
    const nenhuma = await s.contaCom(linha(TELAS.combustiveis, { visualizar: true }));
    assert.equal((await req('GET', '/bens-patrimoniais-opcoes/familias', nenhuma.token)).statusCode, 403, 'opções de catálogo: só tela Bens ou Tipos');
  });

  test('opções de catálogo: só ativos, ordem por nome, keyset, busca, formas fixas, filtro de família, empresa_id opcional, cursor adulterado 400', async () => {
    const s = await montarPatrimonio(app);
    const t = s.token;
    await ok(req('PATCH', `/patrimonio-familias/${s.fam.EQUIPAMENTOS}`, t, { versao: 1, ativo: false }));
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
    const curral = tipos.itens.find((i) => i.codigo === 'CURRAL');
    assert.deepEqual(curral, { id: s.tip.CURRAL, codigo: 'CURRAL', nome: 'Curral', familia_id: s.fam.BENFEITORIAS, perfis: [{ perfil_id: s.per.AREA, principal: true }, { perfil_id: s.per.CAPACIDADE_ANIMAL, principal: false }] });
    const perfis = await ok(req('GET', '/bens-patrimoniais-opcoes/perfis-medicao?q=vol', t));
    assert.deepEqual(perfis.itens, [{ id: s.per.VOLUME, codigo: 'VOLUME', nome: 'Volume', dimensao: 'VOLUME', finalidade: 'CAPACIDADE', unidade_canonica: 'L', unidades_permitidas: ['L', 'm3'] }]);
    const comb = await ok(req('GET', '/bens-patrimoniais-opcoes/combustiveis', t));
    // A ordem fina entre maiúsculas e minúsculas é a da collation do banco; o conjunto é fixo.
    assert.deepEqual(comb.itens.map((c) => c.nome).sort(), ['Diesel S10', 'Diesel S500', 'Etanol', 'GNV', 'Gasolina']);
    assert.deepEqual(comb.itens.find((c) => c.codigo === 'GNV'), { id: s.comb.GNV, codigo: 'GNV', nome: 'GNV', unidade: 'm3' });
    assert.deepEqual([comb.has_more, comb.next_cursor], [false, null]);
    assert.equal((await ok(req('GET', '/bens-patrimoniais-opcoes/combustiveis?q=%25', t))).itens.length, 0, 'busca literal');
    assert.equal((await req('GET', '/bens-patrimoniais-opcoes/familias?cursor=bGl4bw', t)).statusCode, 400);
    assert.equal((await req('GET', `/bens-patrimoniais-opcoes/familias?familia_id=${s.fam.MAQUINAS}`, t)).statusCode, 400, 'familia_id só em /tipos');
    assert.equal((await req('GET', '/bens-patrimoniais-opcoes/familias?limit=101', t)).statusCode, 400);
    assert.equal((await req('GET', '/bens-patrimoniais-opcoes/desconhecido', t)).statusCode, 404);
    // O catálogo é do tenant: nada de outro tenant aparece.
    const outro = await montarPatrimonio(app);
    const doOutro = await ok(req('GET', '/bens-patrimoniais-opcoes/tipos', outro.token));
    assert.ok(doOutro.itens.every((i) => !Object.values(s.tip).includes(i.id)));
    assert.equal(doOutro.itens.length, 13);
  });
});
