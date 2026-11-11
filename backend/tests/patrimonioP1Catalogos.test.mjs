/**
 * D-PROD-157 / D-PROD-162 / D-PROD-163 — Patrimônio: CATÁLOGOS do tenant
 * (famílias, tipos e o catálogo padrão). PostgreSQL real, HTTP autenticado,
 * prova por persistência. D-PROD-162: perfis de medição e combustíveis saíram
 * (rotas 404); famílias e tipos têm as guardas da tela de Bens; `codigo`
 * opcional. D-PROD-163: o CADASTRO de família saiu (POST/PATCH → 404; só
 * leitura); 6 famílias padrão (com OUTROS); tipo por "Tipo de bem" (natureza).
 * A garantia automática, o DELETE de tipo e o bem sem `familia_id` estão em
 * `patrimonioSimplifica02.test.mjs`.
 *
 *  K1. Instalador explícito do catálogo padrão (6 famílias, 13 tipos):
 *      idempotente (2ª chamada cria 0), isolado por tenant, corrida instala uma
 *      vez, conflitos do A9 sem alterar nada e sem P2002 abortar; só
 *      administrador real ou `is_admin`.
 *  K2. Famílias: só leitura (lista keyset, filtros, busca literal, detalhe,
 *      404 cruzado sem oráculo); POST/PATCH/DELETE → 404.
 *  K3. Tipos: família (compatibilidade) inexistente/inativa/de outro tenant
 *      recusada; `perfis` → 400; familia_id/código/natureza imutáveis; nome
 *      único no tipo de bem; corridas de nome; curingas literais.
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
const PADRAO = Object.freeze({ familias: 6, tipos: 13 });
const INEXISTENTE = 'cl0inexistente000000000000';
const instalar = (tok, corpo = {}) => req('POST', '/patrimonio-catalogo-padrao', tok, corpo);
const todos = async (tok, base) => (await ok(req('GET', `${base}?limit=100`, tok))).items;
const porCodigo = (itens, fn) => Object.fromEntries(itens.map((i) => [i.codigo, fn(i)]));
const conflitosOrdenados = (r) => r.conflitos.map((x) => `${x.recurso}:${x.codigo}:${x.motivo}`).sort();

/** Família/tipo MANUAL direto no banco (D-PROD-163: o cadastro de família saiu da API; dado antigo de produção). */
const familiaNoBanco = (c, dados) => prisma().familiaPatrimonial.create({ data: { cliente_id: c, ...dados } });
const tipoNoBanco = (c, dados) => prisma().tipoPatrimonial.create({ data: { cliente_id: c, ...dados } });

// ─────────────────────────────────────────────────────────────────────────────
describe('K1 — catálogo padrão (instalador explícito)', () => {
  test('instala 6 famílias (com OUTROS) e 13 tipos (sem perfis nem combustíveis); 2ª chamada cria 0; outro tenant é independente; corrida instala uma vez', async () => {
    const a = await montarPatrimonio(app, { catalogo: false });
    const b = await montarPatrimonio(app, { catalogo: false });
    const r1 = await ok(instalar(a.token));
    assert.deepEqual(r1, { criados: PADRAO, existentes: ZERO, conflitos: [] });
    const eventos = await prisma().auditLog.count({ where: { cliente_id: a.c, acao: 'create' } });
    assert.equal(eventos, 19, 'um evento de criação por item, na mesma transação');
    assert.deepEqual(
      (await prisma().auditLog.groupBy({ by: ['entidade'], where: { cliente_id: a.c, acao: 'create' }, _count: true })).map((g) => [g.entidade, g._count]).sort(),
      [['FamiliaPatrimonial', 6], ['TipoPatrimonial', 13]],
    );
    const r2 = await ok(instalar(a.token));
    assert.deepEqual(r2, { criados: ZERO, existentes: PADRAO, conflitos: [] }, '2ª chamada não cria nada');
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: a.c, acao: 'create' } }), 19, 'sem auditoria na 2ª');

    // Conteúdo do padrão.
    const familias = porCodigo(await todos(a.token, '/patrimonio-familias'), (f) => [f.natureza, f.vida_util_meses_padrao]);
    assert.deepEqual(familias, {
      BENFEITORIAS: ['BENFEITORIA', 300], EQUIPAMENTOS: ['EQUIPAMENTO', 120], IMPLEMENTOS: ['IMPLEMENTO', 120], MAQUINAS: ['MAQUINA', 120], OUTROS: ['OUTRO', 120],
      VEICULOS: ['VEICULO', 60],
    });
    const tipos = porCodigo(await todos(a.token, '/patrimonio-tipos'), (t) => t.familia.codigo);
    assert.deepEqual(tipos, {
      BALANCA: 'EQUIPAMENTOS', BEBEDOURO_FIXO: 'BENFEITORIAS', CAMINHAO: 'VEICULOS', CAMINHONETE: 'VEICULOS', CERCA_ARAME: 'BENFEITORIAS', CERCA_ELETRICA: 'BENFEITORIAS',
      CURRAL: 'BENFEITORIAS', GALPAO: 'BENFEITORIAS', GERADOR: 'EQUIPAMENTOS', RESERVATORIO: 'BENFEITORIAS', ROCADEIRA: 'IMPLEMENTOS', TRATOR_ESTEIRAS: 'MAQUINAS', TRATOR_PNEUS: 'MAQUINAS',
    });
    assert.ok((await todos(a.token, '/patrimonio-tipos')).every((t) => !('perfis' in t)), 'tipo sem perfis na forma pública');
    // Perfis e combustíveis saíram do produto: as rotas não existem.
    for (const url of ['/patrimonio-perfis-medicao', '/patrimonio-combustiveis']) assert.equal((await req('GET', url, a.token)).statusCode, 404, url);

    // Isolado por tenant: B não viu nada de A (a leitura de FAMÍLIAS não garante o catálogo) e instala o seu.
    assert.equal((await ok(req('GET', '/patrimonio-familias', b.token))).total, 0);
    assert.deepEqual((await ok(instalar(b.token))).criados, PADRAO);
    assert.equal(await prisma().familiaPatrimonial.count({ where: { cliente_id: a.c } }), 6);
    assert.equal(await prisma().familiaPatrimonial.count({ where: { cliente_id: b.c } }), 6);

    // Corrida: duas instalações simultâneas no mesmo tenant → uma cria tudo, a outra 0.
    const d = await montarPatrimonio(app, { catalogo: false });
    const [x, y] = await Promise.all([instalar(d.token), instalar(d.token)]);
    assert.deepEqual([x.statusCode, y.statusCode], [200, 200], `${x.body} ${y.body}`);
    assert.deepEqual([x.json().criados.familias + y.json().criados.familias, x.json().criados.tipos + y.json().criados.tipos], [6, 13]);
    assert.equal(await prisma().tipoPatrimonial.count({ where: { cliente_id: d.c } }), 13);
    // Sem corpo também é aceito (o endpoint não tem parâmetros).
    assert.equal((await req('POST', '/patrimonio-catalogo-padrao', d.token)).statusCode, 200);
  });

  test('A9: código existente com natureza/família divergente, inativo ou nome já usado vira conflito; dependentes pulados; nada alterado; 200 sem P2002', async () => {
    const s = await montarPatrimonio(app, { catalogo: false });
    const t = s.token;
    // Dados antigos (cadastro manual de família, que saiu da API): direto no banco, sem disparar a garantia.
    const maq = await familiaNoBanco(s.c, { codigo: 'MAQUINAS', nome: 'Minhas máquinas', natureza: 'OUTRO' });
    await familiaNoBanco(s.c, { codigo: 'MINHAS_BENF', nome: 'benfeitorias e instalações', natureza: 'BENFEITORIA' });
    const frota = await familiaNoBanco(s.c, { codigo: 'FROTA', nome: 'Frota leve', natureza: 'VEICULO' });
    const caminhao = await tipoNoBanco(s.c, { familia_id: frota.id, codigo: 'CAMINHAO', nome: 'Caminhão da frota' });
    const impl = await familiaNoBanco(s.c, { codigo: 'IMPLEMENTOS', nome: 'Implementos agrícolas', natureza: 'IMPLEMENTO', ativo: false });

    const esperadoConflitos = [
      'familias:BENFEITORIAS:nome_em_uso', 'familias:IMPLEMENTOS:inativo', 'familias:MAQUINAS:natureza_divergente',
      'tipos:BEBEDOURO_FIXO:dependencia_em_conflito', 'tipos:CAMINHAO:familia_divergente', 'tipos:CERCA_ARAME:dependencia_em_conflito',
      'tipos:CERCA_ELETRICA:dependencia_em_conflito', 'tipos:CURRAL:dependencia_em_conflito', 'tipos:GALPAO:dependencia_em_conflito',
      'tipos:RESERVATORIO:dependencia_em_conflito', 'tipos:ROCADEIRA:dependencia_em_conflito', 'tipos:TRATOR_ESTEIRAS:dependencia_em_conflito',
      'tipos:TRATOR_PNEUS:dependencia_em_conflito',
    ];
    const r1 = await ok(instalar(t));
    assert.deepEqual(conflitosOrdenados(r1), esperadoConflitos);
    assert.deepEqual(r1.criados, { familias: 3, tipos: 3 }, 'VEICULOS, EQUIPAMENTOS, OUTROS; CAMINHONETE, GERADOR, BALANCA');
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
    assert.deepEqual(r2.existentes, { familias: 3, tipos: 3 });
  });

  test('A9: nome já usado por TIPO (na mesma família) vira nome_em_uso; o resto instala; 200 sem P2002 abortar a transação', async () => {
    const s = await montarPatrimonio(app, { catalogo: false });
    const t = s.token;
    // Família BENFEITORIAS correta (ativa, mesma natureza): conta como existente e os tipos dela são instalados nela.
    const benf = await familiaNoBanco(s.c, { codigo: 'BENFEITORIAS', nome: 'Benfeitorias da fazenda', natureza: 'BENFEITORIA' });
    // Nome EXATO do padrão: o unique [cliente_id, familia_id, nome] diferencia maiúsculas, então só o nome exato bateria em P2002.
    const meuGalpao = await tipoNoBanco(s.c, { familia_id: benf.id, codigo: 'MEU_GALPAO', nome: 'Galpão' });
    const antes = JSON.stringify([
      await prisma().tipoPatrimonial.findUnique({ where: { id: meuGalpao.id } }),
      await prisma().familiaPatrimonial.findUnique({ where: { id: benf.id } }),
    ]);

    const r = await ok(instalar(t));
    assert.deepEqual(conflitosOrdenados(r), ['tipos:GALPAO:nome_em_uso']);
    assert.deepEqual(r.criados, { familias: 5, tipos: 12 });
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
describe('K2 — famílias (só leitura)', () => {
  test('lista keyset, filtros, busca literal, detalhe, 404 cruzado sem oráculo; POST/PATCH/DELETE não existem (404) e nada muda', async () => {
    const s = await montarPatrimonio(app);
    const outro = await montarPatrimonio(app);
    const t = s.token;
    const galpoes = await familiaNoBanco(s.c, { codigo: 'GALPOES_X', nome: 'Galpões e armazéns', natureza: 'BENFEITORIA', descricao: 'Antiga', ordem: 7, vida_util_meses_padrao: 240 });
    const f = await ok(req('GET', `/patrimonio-familias/${galpoes.id}`, t));
    assert.deepEqual(Object.keys(f).sort(), ['ativo', 'codigo', 'created_date', 'descricao', 'id', 'natureza', 'nome', 'ordem', 'updated_date', 'versao', 'vida_util_meses_padrao']);
    assert.deepEqual([f.codigo, f.versao, f.ativo, f.ordem, f.vida_util_meses_padrao], ['GALPOES_X', 1, true, 7, 240]);

    // Listagem: keyset (createdAt desc), total sem o cursor, filtros e busca literal.
    const p1 = await ok(req('GET', '/patrimonio-familias?limit=4', t));
    assert.deepEqual([p1.total, p1.items.length, p1.has_more, p1.items[0].id], [7, 4, true, galpoes.id]);
    const p2 = await ok(req('GET', `/patrimonio-familias?limit=4&cursor=${encodeURIComponent(p1.next_cursor)}`, t));
    assert.deepEqual([p2.total, p2.items.length, p2.has_more], [7, 3, false]);
    assert.equal(new Set([...p1.items, ...p2.items].map((i) => i.id)).size, 7);
    assert.equal((await ok(req('GET', '/patrimonio-familias?natureza=BENFEITORIA', t))).total, 2);
    assert.deepEqual((await ok(req('GET', '/patrimonio-familias?q=galp', t))).items.map((i) => i.id), [galpoes.id]);
    assert.equal((await ok(req('GET', '/patrimonio-familias?q=%25', t))).total, 0, 'q=% é literal');
    assert.deepEqual((await ok(req('GET', '/patrimonio-familias?q=_', t))).items.map((i) => i.id), [galpoes.id], 'q=_ é literal (só o código com sublinhado)');
    assert.equal((await req('GET', '/patrimonio-familias?cursor=lixo', t)).statusCode, 400);
    assert.equal((await req('GET', '/patrimonio-familias?natureza=FROTA', t)).statusCode, 400);
    assert.equal((await ok(req('GET', '/patrimonio-familias?ativo=false', t))).total, 0);

    // D-PROD-163: o cadastro de família saiu — nenhuma escrita por HTTP.
    const antes = await prisma().familiaPatrimonial.findMany({ where: { cliente_id: s.c }, orderBy: { id: 'asc' } });
    for (const [metodo, url, corpo] of [
      ['POST', '/patrimonio-familias', { codigo: 'NOVA', nome: 'Nova', natureza: 'OUTRO' }],
      ['PATCH', `/patrimonio-familias/${galpoes.id}`, { versao: 1, nome: 'Renomeada' }],
      ['PATCH', `/patrimonio-familias/${galpoes.id}`, { versao: 1, ativo: false }],
      ['DELETE', `/patrimonio-familias/${galpoes.id}`, undefined],
    ]) {
      assert.equal((await req(metodo, url, t, corpo)).statusCode, 404, `${metodo} ${url}`);
    }
    assert.deepEqual(await prisma().familiaPatrimonial.findMany({ where: { cliente_id: s.c }, orderBy: { id: 'asc' } }), antes, 'nada mudou');

    // 404 cruzado sem oráculo: o corpo é o mesmo de um id inexistente.
    const alheia = await req('GET', `/patrimonio-familias/${galpoes.id}`, outro.token);
    const inexistente = await req('GET', `/patrimonio-familias/${INEXISTENTE}`, outro.token);
    assert.deepEqual(erro(alheia).slice(0, 2), [404, 'FAMILIA_PATRIMONIAL_NAO_ENCONTRADA']);
    assert.deepEqual(corpoErro(alheia), corpoErro(inexistente));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('K3 — tipos', () => {
  test('família (compatibilidade) inexistente, de outro tenant ou inativa recusada; `perfis` → 400; familia_id/código/natureza imutáveis; nome único no tipo de bem; filtro, 404 cruzado e auditoria sem perfis', async () => {
    const s = await montarPatrimonio(app);
    const outro = await montarPatrimonio(app);
    const t = s.token;
    const tipo = (corpo, tok = t) => req('POST', '/patrimonio-tipos', tok, corpo);

    assert.deepEqual(erro(await tipo({ familia_id: INEXISTENTE, codigo: 'NOVO', nome: 'Novo' })), [422, 'BEM_REFERENCIA_INVALIDA', 'familia_id', 'inexistente']);
    assert.deepEqual(erro(await tipo({ familia_id: outro.fam.MAQUINAS, codigo: 'NOVO', nome: 'Novo' })), [422, 'BEM_REFERENCIA_INVALIDA', 'familia_id', 'inexistente']);
    const fam = await familiaNoBanco(s.c, { codigo: 'PROVISORIA', nome: 'Provisória', natureza: 'OUTRO', ativo: false });
    assert.deepEqual(erro(await tipo({ familia_id: fam.id, codigo: 'NOVO', nome: 'Novo' })), [422, 'BEM_REFERENCIA_INVALIDA', 'familia_id', 'inativo']);
    assert.deepEqual(erro(await tipo({ familia_id: fam.id, nome: 'Novo' })), [422, 'BEM_REFERENCIA_INVALIDA', 'familia_id', 'inativo'], 'sem código: a família é conferida igual');
    assert.equal(await prisma().tipoPatrimonial.count({ where: { cliente_id: s.c, codigo: 'NOVO' } }), 0);

    // D-PROD-162: perfis saíram do contrato.
    for (const corpo of [
      { natureza: 'BENFEITORIA', codigo: 'POCILGA', nome: 'Pocilga', perfis: [] },
      { familia_id: s.fam.BENFEITORIAS, nome: 'Pocilga', perfis: [{ perfil_id: INEXISTENTE }] },
    ]) {
      assert.deepEqual(erro(await tipo(corpo)).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], JSON.stringify(corpo));
    }
    const criado = await ok(tipo({ natureza: 'BENFEITORIA', codigo: 'pocilga', nome: 'Pocilga', descricao: 'DESCSENTINELA', vida_util_meses_sugerida: 240 }), 201);
    assert.equal(criado.codigo, 'POCILGA');
    assert.deepEqual([criado.familia.codigo, criado.natureza, criado.bens_em_uso], ['BENFEITORIAS', 'BENFEITORIA', 0]);
    assert.deepEqual(Object.keys(criado).sort(), [
      'ativo', 'bens_em_uso', 'codigo', 'created_date', 'descricao', 'familia', 'familia_id', 'id', 'natureza', 'nome', 'updated_date', 'versao', 'vida_util_meses_sugerida',
    ]);
    assert.deepEqual(await ok(req('GET', `/patrimonio-tipos/${criado.id}`, t)), criado);
    assert.equal((await req('PATCH', `/patrimonio-tipos/${criado.id}`, t, { versao: 1, perfis: [] })).statusCode, 400, 'PATCH com perfis');

    // familia_id, código e natureza imutáveis (400); nome único DENTRO do tipo de bem.
    for (const corpo of [{ versao: 1, familia_id: s.fam.MAQUINAS }, { versao: 1, codigo: 'OUTRO' }, { versao: 1, natureza: 'MAQUINA' }]) {
      assert.equal((await req('PATCH', `/patrimonio-tipos/${criado.id}`, t, corpo)).statusCode, 400, JSON.stringify(corpo));
    }
    assert.deepEqual(erro(await tipo({ natureza: 'BENFEITORIA', codigo: 'CURRAL2', nome: 'curral' })), [409, 'PATRIMONIO_NOME_DUPLICADO', 'nome', 'nome_repetido']);
    assert.deepEqual(erro(await tipo({ familia_id: s.fam.BENFEITORIAS, nome: 'CURRAL' })), [409, 'PATRIMONIO_NOME_DUPLICADO', 'nome', 'nome_repetido'], 'sem código: nome repetido continua 409');
    assert.equal((await tipo({ natureza: 'EQUIPAMENTO', codigo: 'CURRAL2', nome: 'Curral' })).statusCode, 201, 'o mesmo nome em outro tipo de bem');
    assert.deepEqual(erro(await tipo({ natureza: 'EQUIPAMENTO', codigo: 'curral', nome: 'Outro' })), [409, 'PATRIMONIO_CODIGO_DUPLICADO', 'codigo', 'codigo_repetido']);

    // Edição e inativação; filtro por família e por natureza; 404 cruzado; auditoria sem perfis nem texto livre.
    const ed = await ok(req('PATCH', `/patrimonio-tipos/${criado.id}`, t, { versao: 1, nome: 'Pocilga coberta', descricao: null }));
    assert.equal(ed.versao, 2);
    assert.equal((await ok(req('PATCH', `/patrimonio-tipos/${criado.id}`, t, { versao: 2, nome: 'Pocilga coberta' }))).versao, 2, 'sem mudança efetiva');
    assert.equal((await ok(req('PATCH', `/patrimonio-tipos/${criado.id}`, t, { versao: 2, ativo: false }))).ativo, false);
    const daFamilia = await ok(req('GET', `/patrimonio-tipos?familia_id=${s.fam.MAQUINAS}`, t));
    assert.deepEqual(daFamilia.items.map((i) => i.codigo).sort(), ['TRATOR_ESTEIRAS', 'TRATOR_PNEUS']);
    const daNatureza = await ok(req('GET', '/patrimonio-tipos?natureza=EQUIPAMENTO&ativo=true', t));
    assert.deepEqual(daNatureza.items.map((i) => i.codigo).sort(), ['BALANCA', 'CURRAL2', 'GERADOR']);
    assert.deepEqual(erro(await req('GET', `/patrimonio-tipos/${criado.id}`, outro.token)).slice(0, 2), [404, 'TIPO_PATRIMONIAL_NAO_ENCONTRADO']);
    const eventos = await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'TipoPatrimonial', entidade_id: criado.id }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(eventos.map((e) => e.acao), ['create', 'update', 'update']);
    assert.deepEqual(Object.keys(/** @type {any} */ (eventos[0].dados_novos)).sort(), ['ativo', 'codigo', 'familia_id', 'id', 'versao']);
    assert.deepEqual([.../** @type {any} */ (eventos[1].dados_novos).campos_alterados].sort(), ['descricao', 'nome']);
    assert.deepEqual(/** @type {any} */ (eventos[2].dados_novos).campos_alterados, ['ativo']);
    const texto = JSON.stringify(eventos.map((e) => [e.dados_anteriores, e.dados_novos]));
    for (const sentinela of ['DESCSENTINELA', 'Pocilga']) assert.ok(!texto.includes(sentinela), `auditoria com texto livre: ${sentinela}`);
  });

  test('corrida de duas criações com o mesmo código → [201, 409]; uma linha só', async () => {
    const s = await montarPatrimonio(app);
    const corpo = (nome) => ({ natureza: 'OUTRO', codigo: 'CORRIDA', nome });
    const [a, b] = await Promise.all([req('POST', '/patrimonio-tipos', s.token, corpo('Um')), req('POST', '/patrimonio-tipos', s.token, corpo('Dois'))]);
    assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 409]);
    assert.equal([a, b].find((r) => r.statusCode === 409).json().code, 'PATRIMONIO_CODIGO_DUPLICADO');
    assert.equal(await prisma().tipoPatrimonial.count({ where: { cliente_id: s.c, codigo: 'CORRIDA' } }), 1);
  });

  // A9: o unique do banco diferencia maiúsculas; sob concorrência, só a trava do catálogo barra o nome repetido em outra caixa.
  test('corrida de NOME sem diferenciar maiúsculas (códigos distintos) → [201, 409 PATRIMONIO_NOME_DUPLICADO], na criação e no renomear; um nome só no tipo de bem', async () => {
    const s = await montarPatrimonio(app);
    const p = prisma();
    const contar = (nome) => p.tipoPatrimonial.count({ where: { cliente_id: s.c, familia: { natureza: 'MAQUINA' }, nome: { equals: nome, mode: 'insensitive' } } });
    const [a, b] = await Promise.all([
      req('POST', '/patrimonio-tipos', s.token, { natureza: 'MAQUINA', codigo: 'CORRIDA_N1', nome: 'Grade aradora' }),
      req('POST', '/patrimonio-tipos', s.token, { natureza: 'MAQUINA', codigo: 'CORRIDA_N2', nome: 'GRADE ARADORA' }),
    ]);
    assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 409], `${a.body} ${b.body}`);
    assert.deepEqual(erro([a, b].find((r) => r.statusCode === 409)), [409, 'PATRIMONIO_NOME_DUPLICADO', 'nome', 'nome_repetido']);
    assert.equal(await contar('grade aradora'), 1, 'um nome só');
    // PATCH: dois tipos (de famílias diferentes do MESMO tipo de bem) renomeados ao mesmo tempo para o mesmo nome em caixas diferentes.
    const manual = await familiaNoBanco(s.c, { codigo: 'MAQ_ANTIGAS', nome: 'Máquinas antigas', natureza: 'MAQUINA' });
    const x = await ok(req('POST', '/patrimonio-tipos', s.token, { natureza: 'MAQUINA', nome: 'Renomear X' }), 201);
    const y = await ok(req('POST', '/patrimonio-tipos', s.token, { familia_id: manual.id, nome: 'Renomear Y' }), 201);
    const [rx, ry] = await Promise.all([
      req('PATCH', `/patrimonio-tipos/${x.id}`, s.token, { versao: 1, nome: 'Depósito central' }),
      req('PATCH', `/patrimonio-tipos/${y.id}`, s.token, { versao: 1, nome: 'DEPÓSITO CENTRAL' }),
    ]);
    assert.deepEqual([rx.statusCode, ry.statusCode].sort(), [200, 409], `${rx.body} ${ry.body}`);
    assert.equal([rx, ry].find((r) => r.statusCode === 409).json().code, 'PATRIMONIO_NOME_DUPLICADO');
    assert.equal(await contar('depósito central'), 1);
  });

  test('nome único: `%`, `_` e `\\` são literais na comparação sem diferenciar maiúsculas', async () => {
    const s = await montarPatrimonio(app);
    const post = (codigo, nome) => req('POST', '/patrimonio-tipos', s.token, { natureza: 'MAQUINA', codigo, nome });
    const criado = async (codigo, nome, rotulo) => {
      const r = await post(codigo, nome);
      assert.equal(r.statusCode, 201, `${rotulo}: ${r.body}`);
    };
    await criado('LIKE_1', 'LinhaX1', 'base');
    await criado('LIKE_2', 'Linha_1', "'_' não casa com qualquer caractere");
    await criado('LIKE_3', 'Biodiesel 100% de soja', 'base');
    await criado('LIKE_4', 'Biodiesel%', "'%' não casa com qualquer resto");
    await criado('LIKE_5', 'Linha\\Nova', 'base');
    const repetido = await post('LIKE_6', 'LINHA\\NOVA');
    assert.deepEqual(erro(repetido), [409, 'PATRIMONIO_NOME_DUPLICADO', 'nome', 'nome_repetido'], `'\\' é literal: ${repetido.body}`);
    // Escapado, o curinga continua comparado sem diferenciar maiúsculas.
    assert.deepEqual(erro(await post('LIKE_7', 'linha_1')), [409, 'PATRIMONIO_NOME_DUPLICADO', 'nome', 'nome_repetido'], "'_' em outra caixa");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('K4 — código gerado do nome (P-05)', () => {
  test('sem `codigo`: sem acentos, MAIÚSCULAS, `_`, até 28; colisão → _2, _3; curto → ITEM; nunca passa de 32; único no tenant (entre tipos de bem); nome repetido 409', async () => {
    const s = await montarPatrimonio(app, { catalogo: false });
    const t = s.token;
    const tipo = (corpo) => req('POST', '/patrimonio-tipos', t, { natureza: 'OUTRO', ...corpo });
    const criado = async (nome) => (await ok(tipo({ nome }), 201)).codigo;
    assert.equal(await criado('Galpão de máquinas'), 'GALPAO_DE_MAQUINAS');
    assert.equal(await criado('Galpao de maquinas!'), 'GALPAO_DE_MAQUINAS_2', 'colisão no tenant → _2');
    assert.equal(await criado('  galpão   DE  máquinas  ?? '), 'GALPAO_DE_MAQUINAS_3');
    assert.equal(await criado('Açude & Irrigação'), 'ACUDE_IRRIGACAO');
    assert.equal(await criado('x'), 'ITEM', 'menos de 2 caracteres úteis → ITEM');
    assert.equal(await criado('?!'), 'ITEM_2');
    const longo = await criado('Trator de pneus 4x4 com cabine fechada e ar-condicionado');
    assert.equal(longo, 'TRATOR_DE_PNEUS_4X4_COM_CABI');
    assert.equal(longo.length, 28);
    const longo2 = await criado('Trator de pneus 4x4 com cabine aberta');
    assert.equal(longo2, 'TRATOR_DE_PNEUS_4X4_COM_CABI_2');
    assert.ok(longo2.length <= 32);
    // O radical cortado não termina em `_` (corte em cima de um separador).
    assert.equal(await criado('Abcdefghij abcdefghij abcde fg'), 'ABCDEFGHIJ_ABCDEFGHIJ_ABCDE', 'o 28º caractere era `_`: sai');
    // Código informado continua valendo; e ocupa o lugar do gerado.
    assert.equal((await ok(tipo({ codigo: 'baia', nome: 'Baia principal' }), 201)).codigo, 'BAIA');
    assert.equal(await criado('Baia'), 'BAIA_2');
    // Nome repetido (sem diferenciar maiúsculas) continua 409, antes de gerar código.
    assert.deepEqual(erro(await tipo({ nome: 'GALPÃO DE MÁQUINAS' })), [409, 'PATRIMONIO_NOME_DUPLICADO', 'nome', 'nome_repetido']);
    // Esgotado (radical e _2…_99 ocupados) → 409 PATRIMONIO_CODIGO_DUPLICADO.
    const p = prisma();
    const outros = await p.familiaPatrimonial.findFirst({ where: { cliente_id: s.c, codigo: 'OUTROS' } });
    await p.tipoPatrimonial.createMany({
      data: [{ codigo: 'SILO' }, ...Array.from({ length: 98 }, (_, i) => ({ codigo: `SILO_${i + 2}` }))].map((r, i) => ({ cliente_id: s.c, familia_id: outros.id, codigo: r.codigo, nome: `Silo ocupado ${i}` })),
    });
    assert.deepEqual(erro(await tipo({ nome: 'Silo' })), [409, 'PATRIMONIO_CODIGO_DUPLICADO', 'codigo', 'codigo_repetido']);
    assert.equal(await p.tipoPatrimonial.count({ where: { cliente_id: s.c, nome: 'Silo' } }), 0, 'nada gravado');
    // O código é único no TENANT (não por tipo de bem): o mesmo nome em outro tipo de bem ganha o código seguinte.
    assert.equal((await ok(req('POST', '/patrimonio-tipos', t, { natureza: 'MAQUINA', nome: 'Pá carregadeira' }), 201)).codigo, 'PA_CARREGADEIRA');
    assert.equal((await ok(req('POST', '/patrimonio-tipos', t, { natureza: 'VEICULO', nome: 'Pá carregadeira' }), 201)).codigo, 'PA_CARREGADEIRA_2', 'mesmo nome em outro tipo de bem, código seguinte');
    // O mesmo radical em outro tenant é livre.
    const outro = await montarPatrimonio(app, { catalogo: false });
    assert.equal((await ok(req('POST', '/patrimonio-tipos', outro.token, { nome: 'Galpão de máquinas', natureza: 'OUTRO' }), 201)).codigo, 'GALPAO_DE_MAQUINAS');
  });

  test('corrida: duas criações sem código com nomes que geram o mesmo radical → 201 + 201 com códigos distintos (sob a trava do catálogo)', async () => {
    const s = await montarPatrimonio(app);
    const [a, b] = await Promise.all([
      req('POST', '/patrimonio-tipos', s.token, { nome: 'Galpão A', natureza: 'OUTRO' }),
      req('POST', '/patrimonio-tipos', s.token, { nome: 'Galpao-A', natureza: 'OUTRO' }),
    ]);
    assert.deepEqual([a.statusCode, b.statusCode], [201, 201], `${a.body} ${b.body}`);
    assert.deepEqual([a.json().codigo, b.json().codigo].sort(), ['GALPAO_A', 'GALPAO_A_2']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('K5 — permissões pelas ações de Bens e opções de seletor', () => {
  test('ver = Bens visualizar; criar tipo = Bens novo|salvar|editar; renomear = Bens editar|salvar; inativar = Bens inativar; telas antigas 403; sem sessão 401; conta desativada 401', async () => {
    const s = await montarPatrimonio(app);
    const bens = TELAS.bens;
    const soVer = await s.contaCom(linha(bens, { visualizar: true }));
    const soNovo = await s.contaCom(linha(bens, { visualizar: true, novo: true }));
    const soEditar = await s.contaCom(linha(bens, { visualizar: true, editar: true }));
    const soInativar = await s.contaCom(linha(bens, { visualizar: true, inativar: true }));
    const id = s.tip.GERADOR;
    const patch = (conta, corpo) => req('PATCH', `/patrimonio-tipos/${id}`, conta.token, corpo);
    const versao = async () => (await prisma().tipoPatrimonial.findUnique({ where: { id } })).versao;

    for (const url of ['/patrimonio-familias', `/patrimonio-familias/${s.fam.EQUIPAMENTOS}`, '/patrimonio-tipos', `/patrimonio-tipos/${id}`]) {
      assert.equal((await req('GET', url, soVer.token)).statusCode, 200, url);
    }
    assert.deepEqual(erro(await req('POST', '/patrimonio-tipos', soVer.token, { nome: 'Negado', natureza: 'OUTRO' })).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    assert.equal((await patch(soVer, { versao: 1, nome: 'Gerador.' })).statusCode, 403);
    assert.equal((await req('POST', '/patrimonio-tipos', soNovo.token, { nome: 'Pelo novo', natureza: 'OUTRO' })).statusCode, 201);
    assert.equal((await req('POST', '/patrimonio-tipos', soEditar.token, { nome: 'Pelo editar', natureza: 'OUTRO' })).statusCode, 201, 'quem edita bem também cria pelo "+"');
    assert.equal((await patch(soNovo, { versao: 1, nome: 'Gerador.' })).statusCode, 403, 'novo não edita');
    assert.equal((await patch(soEditar, { versao: 1, ativo: false })).statusCode, 403, 'editar não inativa');
    assert.equal((await patch(soInativar, { versao: 1, nome: 'Gerador.', ativo: false })).statusCode, 403, 'inativar sozinho não edita');
    assert.equal(await versao(), 1, 'nada gravado pelas recusas');
    assert.equal((await ok(patch(soEditar, { versao: 1, nome: 'Gerador a diesel' }))).versao, 2);
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

  test('opções de catálogo: só Bens visualizar; só ativos (tipo de família inativa fora), ordem por nome, keyset, busca, formas fixas (tipo com natureza), filtros de família e natureza, empresa_id opcional, cursor adulterado 400', async () => {
    const s = await montarPatrimonio(app);
    const soVer = await s.contaCom(linha(TELAS.bens, { visualizar: true }));
    const t = soVer.token;
    await prisma().familiaPatrimonial.update({ where: { id: s.fam.EQUIPAMENTOS }, data: { ativo: false } });
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
    assert.deepEqual(nomes, ['Benfeitorias e instalações', 'Implementos', 'Máquinas', 'Outros', 'Veículos'], 'ordem por nome; inativa fora');
    const tipos = await ok(req('GET', `/bens-patrimoniais-opcoes/tipos?familia_id=${s.fam.BENFEITORIAS}&empresa_id=${s.e1.id}`, t));
    assert.equal(tipos.itens.length, 6);
    assert.deepEqual(tipos.itens.find((i) => i.codigo === 'CURRAL'), { id: s.tip.CURRAL, codigo: 'CURRAL', nome: 'Curral', familia_id: s.fam.BENFEITORIAS, natureza: 'BENFEITORIA' });
    assert.deepEqual((await ok(req('GET', '/bens-patrimoniais-opcoes/tipos?q=trator', t))).itens.map((i) => i.codigo), ['TRATOR_ESTEIRAS', 'TRATOR_PNEUS']);
    assert.deepEqual((await ok(req('GET', '/bens-patrimoniais-opcoes/tipos?natureza=VEICULO', t))).itens.map((i) => i.codigo).sort(), ['CAMINHAO', 'CAMINHONETE']);
    assert.deepEqual((await ok(req('GET', '/bens-patrimoniais-opcoes/tipos?natureza=EQUIPAMENTO', t))).itens, [], 'família inativa: tipos fora das opções');
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
