/**
 * D-PROD-157 / D-PROD-162 — Patrimônio: SEGURANÇA e BANCO. PostgreSQL real,
 * HTTP autenticado, prova por fotografia das linhas. D-PROD-162: sem perfis,
 * medições e combustíveis; tanques com Produtos aceitos (`TanqueBemProduto`);
 * as 7 tabelas da migration `20261110300000_patrimonio_simplifica`.
 *
 *  S1. 2 tenants × 2 fazendas: toda rota recusa o cruzamento com 404 uniforme
 *      (corpo idêntico ao de um id inexistente), sem efeito.
 *  S2. Corpo/query fechados: `cliente_id` (topo, item de lista, bloco), campo
 *      extra, campo imutável → 400; número JSON em decimal → 400
 *      `valor_deve_ser_texto` em TODOS os caminhos do A1, sem efeito.
 *  S3. Permissões por ação nos bens (ver/criar/editar/inativar, A4), sem tela
 *      (só as telas antigas), sem sessão, conta desativada, permissão revogada.
 *  S4. Auditoria por allowlist (sem texto livre) na mesma transação: falha
 *      forçada por gatilho desfaz bem, tanques, Produtos aceitos, sequência e catálogo.
 *  S5. RLS ligado e zero grants públicos nas 7 tabelas.
 *  S6. CHECK/FK/UNIQUE direto no banco (A7: CHECKs NULL-safe).
 *  S7. Cadastros antigos referenciados: parceiro → 409 PARCEIRO_EM_USO (não
 *      403); fazenda com bens → 409 EMPRESA_COM_VINCULOS. Também em corrida
 *      (portão na auditoria): exclusão em voo × escrita do bem e vice-versa
 *      nunca terminam em 403.
 *  S8. Release: runtime novo + schema antigo → P2021 (500 sem detalhe); o
 *      preflight acusa a migration pendente.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { normalizarErro } from '../src/shared/errors/errorHandler.js';
import { COLUNAS_EXIGIDAS, CONSULTAS, TABELAS_PROTEGIDAS, avaliarPreflight } from '../../scripts/deploy/preflightSchemaLib.mjs';
import {
  FUSO, MIGRATION_PATRIMONIO, TABELAS_PATRIMONIO, TELAS, TELAS_ANTIGAS, contagens, corpoCaminhonete, corpoCerca, corpoCurral, corpoErro, corpoGerador, corpoImplemento,
  corpoTrator, erro, fotoPatrimonio, http, linha, montarPatrimonio, prisma, produtoL, tanqueCom, tudo,
} from './patrimonioP1Cenario.mjs';

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
const INEXISTENTE = 'cl0inexistente000000000000';
const REPO = join(import.meta.dirname, '..', '..');
const criarOk = (s, corpo, tok = s.token) => ok(req('POST', '/bens-patrimoniais', tok, corpo), 201);
const sem = (obj, ...chaves) => Object.fromEntries(Object.entries(obj).filter(([k]) => !chaves.includes(k)));
const DEPRECIAVEL = {
  aquisicao: { data_aquisicao: '2026-02-10', data_disponibilidade: '2026-02-20', valor_aquisicao: '200000.00' },
  depreciacao: { depreciavel: true, vida_util_meses: 120, residual_modo: 'VALOR', valor_residual: '50000.00', data_inicio_depreciacao: '2026-03-01' },
};

/** Executa `fn` numa transação que SEMPRE é desfeita (padrão de `dProd122ReleaseFuso.test.mjs`). */
const emTransacaoDesfeita = async (fn) => {
  const SENTINELA = new Error('rollback-intencional');
  let resultado;
  await assert.rejects(
    prisma().$transaction(async (tx) => {
      resultado = await fn(tx);
      throw SENTINELA;
    }),
    (e) => e === SENTINELA
  );
  return resultado;
};

// ─────────────────────────────────────────────────────────────────────────────
describe('S1 — isolamento entre tenants e entre fazendas (404 uniforme, sem efeito)', () => {
  test('bens, prévia, opções e catálogos recusam o cruzamento sem revelar existência', async () => {
    const a = await montarPatrimonio(app);
    const b = await montarPatrimonio(app);
    const dieselA = await produtoL(a, { nome: 'Diesel S10' });
    const alvo = await criarOk(a, corpoTrator(a, { tanques: [tanqueCom([dieselA.id])] }));
    const naE2 = await criarOk(a, corpoCerca(a, { empresa_id: a.e2.id }));
    await criarOk(b, corpoTrator(b));
    const antes = await fotoPatrimonio([a.c, b.c]);

    /** Mesmo status, código e corpo do id do alvo e de um id inexistente. */
    const igualAoInexistente = async (rotulo, pedido, codigo) => {
      const doAlvo = await pedido(alvo.id);
      const inexistente = await pedido(INEXISTENTE);
      assert.deepEqual(erro(doAlvo).slice(0, 2), [404, codigo], `${rotulo}: ${doAlvo.body}`);
      assert.deepEqual(corpoErro(doAlvo), corpoErro(inexistente), `${rotulo}: corpo idêntico ao de id inexistente`);
    };
    // Outro tenant, com a própria fazenda.
    await igualAoInexistente('GET detalhe (outro tenant)', (id) => req('GET', `/bens-patrimoniais/${id}?empresa_id=${b.e1.id}`, b.token), 'BEM_PATRIMONIAL_NAO_ENCONTRADO');
    await igualAoInexistente('PATCH (outro tenant)', (id) => req('PATCH', `/bens-patrimoniais/${id}`, b.token, { empresa_id: b.e1.id, versao: 1, nome: 'Invasão' }), 'BEM_PATRIMONIAL_NAO_ENCONTRADO');
    // Mesmo tenant, outra fazenda.
    await igualAoInexistente('GET detalhe (outra fazenda)', (id) => req('GET', `/bens-patrimoniais/${id}?empresa_id=${a.e2.id}`, a.token), 'BEM_PATRIMONIAL_NAO_ENCONTRADO');
    await igualAoInexistente('PATCH (outra fazenda)', (id) => req('PATCH', `/bens-patrimoniais/${id}`, a.token, { empresa_id: a.e2.id, versao: 1, ativo: false }), 'BEM_PATRIMONIAL_NAO_ENCONTRADO');
    assert.equal((await req('GET', `/bens-patrimoniais/${naE2.id}?empresa_id=${a.e1.id}`, a.token)).statusCode, 404);

    // Fazenda de outro tenant (ou o id do cliente no lugar da fazenda) em qualquer rota.
    for (const empresa of [a.e1.id, b.c, INEXISTENTE]) {
      const rotas = [
        ['GET', `/bens-patrimoniais?empresa_id=${empresa}`],
        ['GET', `/bens-patrimoniais/${alvo.id}?empresa_id=${empresa}`],
        ['POST', '/bens-patrimoniais', corpoTrator(b, { empresa_id: empresa })],
        ['PATCH', `/bens-patrimoniais/${alvo.id}`, { empresa_id: empresa, versao: 1, nome: 'Invasão' }],
        ['POST', '/bens-patrimoniais-previa-depreciacao', { empresa_id: empresa, valor_aquisicao: '100.00', residual_modo: 'VALOR', valor_residual: '0', vida_util_meses: 12, data_inicio_depreciacao: '2026-01-01' }],
        ...['responsaveis', 'parceiros', 'centros-custo', 'produtos'].map((r) => ['GET', `/bens-patrimoniais-opcoes/${r}?empresa_id=${empresa}`]),
      ];
      const referencia = corpoErro(await req('GET', `/bens-patrimoniais?empresa_id=${INEXISTENTE}`, b.token));
      for (const [metodo, url, corpo] of rotas) {
        const r = await req(metodo, url, b.token, corpo);
        assert.deepEqual(erro(r).slice(0, 2), [404, 'EMPRESA_NOT_FOUND'], `${metodo} ${url}: ${r.body}`);
        assert.deepEqual(corpoErro(r), referencia, `${metodo} ${url}: sem oráculo`);
      }
    }
    // Catálogo de outro tenant: 404 no detalhe/PATCH e 422 "inexistente" como referência (D-PROD-169: família não tem rota).
    for (const [base, id, codigo] of [['/patrimonio-tipos', a.tip.TRATOR_PNEUS, 'TIPO_PATRIMONIAL_NAO_ENCONTRADO']]) {
      assert.deepEqual(erro(await req('GET', `${base}/${id}`, b.token)).slice(0, 2), [404, codigo], base);
      assert.deepEqual(corpoErro(await req('GET', `${base}/${id}`, b.token)), corpoErro(await req('GET', `${base}/${INEXISTENTE}`, b.token)), `${base}: sem oráculo`);
      assert.equal((await req('PATCH', `${base}/${id}`, b.token, { versao: 1, nome: 'Invasão' })).statusCode, 404, base);
    }
    const comFamiliaAlheia = await req('POST', '/bens-patrimoniais', b.token, corpoTrator(b, { familia_id: a.fam.MAQUINAS, tipo_id: a.tip.TRATOR_PNEUS }));
    const comFamiliaInexistente = await req('POST', '/bens-patrimoniais', b.token, corpoTrator(b, { familia_id: INEXISTENTE, tipo_id: a.tip.TRATOR_PNEUS }));
    assert.deepEqual(erro(comFamiliaAlheia), [422, 'BEM_REFERENCIA_INVALIDA', 'familia_id', 'inexistente']);
    assert.deepEqual(corpoErro(comFamiliaAlheia), corpoErro(comFamiliaInexistente));
    // Listas e opções de B não mostram nada de A.
    const listaB = await ok(req('GET', `/bens-patrimoniais?empresa_id=${b.e1.id}&q=TP-02`, b.token));
    assert.ok(listaB.items.every((i) => i.id !== alvo.id));
    const parceirosB = await ok(req('GET', `/bens-patrimoniais-opcoes/parceiros?empresa_id=${b.e1.id}`, b.token));
    assert.ok(parceirosB.itens.every((i) => i.id !== a.parceiro1.id));
    const produtosB = await ok(req('GET', `/bens-patrimoniais-opcoes/produtos?empresa_id=${b.e1.id}`, b.token));
    assert.ok(produtosB.itens.every((i) => i.id !== dieselA.id), 'Produto de outro tenant nunca aparece');
    // Produto de outro tenant num tanque: 422 inexistente, o mesmo de um id que não existe.
    const comProdutoAlheio = await req('POST', '/bens-patrimoniais', b.token, corpoTrator(b, { codigo_frota: null, tanques: [tanqueCom([dieselA.id])] }));
    const comProdutoInexistente = await req('POST', '/bens-patrimoniais', b.token, corpoTrator(b, { codigo_frota: null, tanques: [tanqueCom([INEXISTENTE])] }));
    assert.deepEqual(erro(comProdutoAlheio), [422, 'TANQUE_PRODUTO_INVALIDO', 'tanques[0].produto_ids', 'inexistente']);
    assert.deepEqual(corpoErro(comProdutoAlheio).details?.produto_id, dieselA.id);
    assert.deepEqual({ ...corpoErro(comProdutoAlheio), details: null }, { ...corpoErro(comProdutoInexistente), details: null });
    const responsaveisB = await ok(req('GET', `/bens-patrimoniais-opcoes/responsaveis?empresa_id=${b.e1.id}`, b.token));
    assert.ok(responsaveisB.itens.every((i) => i.id !== a.adm.usuario.id));
    assert.equal(await fotoPatrimonio([a.c, b.c]), antes, 'nenhuma tentativa gravou nada');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S2 — corpo e query fechados; anti-coerção dos decimais (A1)', () => {
  test('cliente_id em qualquer lugar, campo extra, campo imutável e PATCH só de escopo → 400; número JSON em cada caminho decimal → 400 valor_deve_ser_texto; nada gravado', async () => {
    const s = await montarPatrimonio(app);
    const diesel = await produtoL(s, { nome: 'Diesel S10' });
    const t = await criarOk(s, corpoTrator(s, { tanques: [tanqueCom([diesel.id])] }));
    const curral = await criarOk(s, corpoCurral(s));
    const antes = await fotoPatrimonio(s.c);
    const post = (corpo) => req('POST', '/bens-patrimoniais', s.token, corpo);
    const patch = (id, corpo) => req('PATCH', `/bens-patrimoniais/${id}`, s.token, { empresa_id: s.e1.id, versao: 1, ...corpo });
    const tanque = tanqueCom([diesel.id], { identificador: 'T', capacidade_litros: '10' });
    const casos400 = [
      ['POST cliente_id', post(corpoTrator(s, { codigo_frota: null, cliente_id: s.c }))],
      ['POST cliente_id em tanque', post(corpoTrator(s, { codigo_frota: null, tanques: [{ ...tanque, cliente_id: s.c }] }))],
      ['POST medicoes (D-PROD-162)', post(corpoCurral(s, { medicoes: [] }))],
      ['POST combustivel_ids (D-PROD-162)', post(corpoTrator(s, { codigo_frota: null, tanques: [{ ...tanque, combustivel_ids: [] }] }))],
      ['POST cliente_id na aquisição', post(corpoTrator(s, { codigo_frota: null, aquisicao: { cliente_id: s.c } }))],
      ['POST cliente_id no medidor', post(corpoTrator(s, { codigo_frota: null, medidor: { tipo: 'SEM_MEDIDOR', cliente_id: s.c } }))],
      ['POST campo extra', post(corpoTrator(s, { codigo_frota: null, desconhecido: 1 }))],
      ['POST numero', post(corpoTrator(s, { codigo_frota: null, numero: '99' }))],
      // D-PROD-169: `natureza` ("Tipo de bem") entrou no corpo; fora da lista FIXA → 400.
      ['POST natureza fora da lista', post(corpoTrator(s, { codigo_frota: null, natureza: 'FROTA' }))],
      ['POST id', post(corpoTrator(s, { codigo_frota: null, id: INEXISTENTE }))],
      ['POST versao', post(corpoTrator(s, { codigo_frota: null, versao: 1 }))],
      ['POST ativo', post(corpoTrator(s, { codigo_frota: null, ativo: false }))],
      ['POST consumo', post(corpoTrator(s, { codigo_frota: null, consumo: null }))],
      ['POST sem empresa', post(sem(corpoTrator(s, { codigo_frota: null }), 'empresa_id'))],
      // D-PROD-169: sem `familia_id` é o contrato novo (a família vem do tipo); sem TIPO → 400.
      ['POST sem tipo', post(sem(corpoTrator(s, { codigo_frota: null }), 'tipo_id'))],
      ['POST id malformado', post(corpoTrator(s, { codigo_frota: null, familia_id: 'x;drop' }))],
      ['PATCH cliente_id', patch(t.id, { cliente_id: s.c })],
      ['PATCH numero', patch(t.id, { numero: '99' })],
      ['PATCH natureza fora da lista', patch(t.id, { natureza: 'FROTA' })],
      ['PATCH id', patch(t.id, { id: INEXISTENTE })],
      ['PATCH só escopo', patch(t.id, {})],
      ['PATCH sem versão', req('PATCH', `/bens-patrimoniais/${t.id}`, s.token, { empresa_id: s.e1.id, nome: 'X' })],
      ['PATCH sem empresa', req('PATCH', `/bens-patrimoniais/${t.id}`, s.token, { versao: 1, nome: 'X' })],
      ['PATCH versão zero', patch(t.id, { versao: 0, nome: 'X' })],
      ['PATCH campo extra', patch(t.id, { extra: true })],
      ['PATCH medicoes (D-PROD-162)', patch(curral.id, { medicoes: [] })],
      ['PATCH cliente_id em tanque', patch(t.id, { tanques: [{ id: t.tanques[0].id, ...tanque, cliente_id: s.c }] })],
      ['GET detalhe com cliente_id', req('GET', `/bens-patrimoniais/${t.id}?empresa_id=${s.e1.id}&cliente_id=${s.c}`, s.token)],
      ['GET detalhe sem empresa', req('GET', `/bens-patrimoniais/${t.id}`, s.token)],
      ['prévia com cliente_id', req('POST', '/bens-patrimoniais-previa-depreciacao', s.token, { empresa_id: s.e1.id, cliente_id: s.c, valor_aquisicao: '1.00', residual_modo: 'VALOR', valor_residual: '0', vida_util_meses: 1, data_inicio_depreciacao: '2026-01-01' })],
    ];
    for (const [rotulo, pedido] of casos400) {
      const r = await pedido;
      assert.equal(r.statusCode, 400, `${rotulo}: ${r.body}`);
    }

    // A1: decimal presente e não-string (e não null) em CADA caminho → 400 com o caminho.
    const comDecimal = (caminho, valor) => {
      const corpo = /** @type {any} */ (corpoTrator(s, { codigo_frota: null, ...DEPRECIAVEL }));
      const [bloco, chave] = caminho.split('.');
      if (caminho === 'potencia_cv') corpo.potencia_cv = valor;
      else if (bloco === 'tanques[0]') corpo.tanques[0].capacidade_litros = valor;
      else corpo[bloco] = { ...corpo[bloco], [chave]: valor };
      return corpo;
    };
    const caminhosPost = ['potencia_cv', 'medidor.leitura_inicial', 'aquisicao.valor_aquisicao', 'aquisicao.custo_incorporacao', 'depreciacao.valor_residual', 'depreciacao.residual_percentual', 'tanques[0].capacidade_litros'];
    for (const caminho of caminhosPost) {
      for (const valor of [10, 10.5, true, { v: '1' }, ['1']]) {
        const r = await post(comDecimal(caminho, valor));
        assert.deepEqual([r.statusCode, r.json().code, r.json().field, r.json().reason, r.json().details], [400, 'REQUEST_VALIDATION_FAILED', caminho, 'valor_deve_ser_texto', { campo: caminho }], `${caminho}=${JSON.stringify(valor)}`);
      }
    }
    for (const [caminho, corpo] of [
      ['medidor.leitura_atual', { medidor: { tipo: 'HORIMETRO', leitura_atual: 1600, data_leitura: '2027-06-10' } }],
      ['medidor.leitura_inicial', { medidor: { tipo: 'HORIMETRO', leitura_inicial: 1520.5 } }],
      ['potencia_cv', { potencia_cv: 100 }],
      ['tanques[0].capacidade_litros', { tanques: [{ id: t.tanques[0].id, identificador: 'T', capacidade_litros: 200, produto_ids: [diesel.id] }] }],
      ['aquisicao.valor_aquisicao', { aquisicao: { valor_aquisicao: 1 } }],
      ['depreciacao.valor_residual', { depreciacao: { depreciavel: true, valor_residual: 0 } }],
    ]) {
      const r = await patch(t.id, corpo);
      assert.deepEqual([r.statusCode, r.json().reason, r.json().details], [400, 'valor_deve_ser_texto', { campo: caminho }], `PATCH ${caminho}`);
    }
    // null num decimal opcional não é coerção: segue a regra normal (aqui, limpa a potência).
    assert.equal(await fotoPatrimonio(s.c), antes, 'nenhum 400 gravou nada');
    assert.equal((await ok(patch(t.id, { potencia_cv: null }))).potencia_cv, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S3 — permissões por ação nos bens (A4)', () => {
  test('sem tela 403 em toda rota; visualizar só lê e simula; novo|salvar criam; editar|salvar editam; inativar só com a ação extra; combinação exige as duas; sem sessão 401; revogada 403', async () => {
    const s = await montarPatrimonio(app);
    const bens = TELAS.bens;
    const semTela = await s.contaCom(...Object.values(TELAS_ANTIGAS).map(tudo));
    const soVer = await s.contaCom(linha(bens, { visualizar: true }));
    const soNovo = await s.contaCom(linha(bens, { visualizar: true, novo: true }));
    const soSalvar = await s.contaCom(linha(bens, { visualizar: true, salvar: true }));
    const soEditar = await s.contaCom(linha(bens, { visualizar: true, editar: true }));
    const soInativar = await s.contaCom(linha(bens, { visualizar: true, inativar: true }));
    const editarInativar = await s.contaCom(linha(bens, { visualizar: true, editar: true, inativar: true }));
    const excluirExportar = await s.contaCom(linha(bens, { visualizar: true, excluir: true, importar: true, exportar: true }));
    const isAdmin = await s.conta({ is_admin: true });
    const adminReal = await s.conta(null, { papel_tenant: 'administrador' });
    const b = await criarOk(s, corpoImplemento(s));
    const e = s.e1.id;
    const versaoAtual = async () => (await prisma().bemPatrimonial.findUnique({ where: { id: b.id } })).versao;
    const patch = async (conta, corpo) => req('PATCH', `/bens-patrimoniais/${b.id}`, conta.token, { empresa_id: e, versao: await versaoAtual(), ...corpo });
    const previaCorpo = { empresa_id: e, valor_aquisicao: '100.00', residual_modo: 'VALOR', valor_residual: '0', vida_util_meses: 12, data_inicio_depreciacao: '2026-01-01' };
    const leituras = [
      ['GET', `/bens-patrimoniais?empresa_id=${e}`], ['GET', `/bens-patrimoniais/${b.id}?empresa_id=${e}`], ['POST', '/bens-patrimoniais-previa-depreciacao', previaCorpo],
      ...['responsaveis', 'parceiros', 'centros-custo'].map((r) => ['GET', `/bens-patrimoniais-opcoes/${r}?empresa_id=${e}`]),
      ['GET', '/bens-patrimoniais-opcoes/tipos'],
    ];
    const escritas = [['POST', '/bens-patrimoniais', corpoImplemento(s)], ['PATCH', `/bens-patrimoniais/${b.id}`, { empresa_id: e, versao: 1, nome: 'X' }], ['PATCH', `/bens-patrimoniais/${b.id}`, { empresa_id: e, versao: 1, ativo: false }]];
    const antes = await fotoPatrimonio(s.c);
    for (const [metodo, url, corpo] of [...leituras, ...escritas]) {
      const r = await req(metodo, url, semTela.token, corpo);
      assert.deepEqual(erro(r).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA'], `sem tela ${metodo} ${url}`);
      assert.equal((await req(metodo, url, null, corpo)).statusCode, 401, `sem sessão ${metodo} ${url}`);
    }
    for (const [metodo, url, corpo] of leituras) assert.equal((await req(metodo, url, soVer.token, corpo)).statusCode, 200, `visualizar ${metodo} ${url}`);
    for (const conta of [soVer, soEditar, soInativar, excluirExportar]) {
      assert.equal((await req('POST', '/bens-patrimoniais', conta.token, corpoImplemento(s))).statusCode, 403, 'sem novo/salvar não cria');
    }
    for (const conta of [soVer, soNovo, soInativar, excluirExportar]) assert.equal((await patch(conta, { nome: 'Sem editar' })).statusCode, 403, 'sem editar/salvar não edita');
    for (const conta of [soVer, soNovo, soSalvar, soEditar, excluirExportar]) assert.equal((await patch(conta, { ativo: false })).statusCode, 403, 'sem inativar não inativa');
    assert.equal((await patch(soEditar, { nome: 'Com ativo', ativo: true })).statusCode, 403, 'editar sem inativar: ativo no corpo exige inativar');
    assert.equal((await patch(soInativar, { nome: 'Com nome', ativo: false })).statusCode, 403, 'inativar sem editar: outro campo exige editar');
    assert.equal(await fotoPatrimonio(s.c), antes, 'nenhuma recusa gravou nada');

    await ok(req('POST', '/bens-patrimoniais', soNovo.token, corpoImplemento(s, { nome: 'Por novo' })), 201);
    await ok(req('POST', '/bens-patrimoniais', soSalvar.token, corpoImplemento(s, { nome: 'Por salvar' })), 201);
    assert.equal((await ok(patch(soEditar, { nome: 'Por editar' }))).nome, 'Por editar');
    assert.equal((await ok(patch(soSalvar, { nome: 'Por salvar edit' }))).nome, 'Por salvar edit');
    assert.equal((await ok(patch(soInativar, { ativo: false }))).ativo, false, 'só ativo (+ escopo) exige só inativar');
    const ambos = await ok(patch(editarInativar, { nome: 'Reativado', ativo: true }));
    assert.deepEqual([ambos.nome, ambos.ativo], ['Reativado', true]);
    assert.equal((await ok(patch(isAdmin, { ativo: false }))).ativo, false);
    assert.equal((await ok(patch(adminReal, { nome: 'Pelo administrador', ativo: true }))).ativo, true);

    // Conta desativada: a sessão deixa de valer; permissão revogada: a próxima requisição já é negada.
    await prisma().usuario.update({ where: { id: soEditar.id }, data: { ativo: false } });
    assert.equal((await patch(soEditar, { nome: 'Desativado' })).statusCode, 401);
    await prisma().permissao.update({ where: { cliente_id_user_email: { cliente_id: s.c, user_email: soSalvar.login } }, data: { permissoes_telas: [linha(bens, { visualizar: true })] } });
    assert.equal((await patch(soSalvar, { nome: 'Revogado' })).statusCode, 403);
    assert.equal((await prisma().bemPatrimonial.findUnique({ where: { id: b.id } })).nome, 'Pelo administrador');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S4 — auditoria por allowlist na mesma transação', () => {
  test('criação e edição auditadas sem texto livre (nomes, descrições, rótulos, identificadores, documentos, placa, chassi, renavam, nomes de parceiros/centros/responsável)', async () => {
    const s = await montarPatrimonio(app);
    const resp = await s.conta(null);
    const diesel = await produtoL(s, { nome: 'PRODUTOSENTINELA S10', codigo_interno: 'CODPRODSENTINELA' });
    const s500 = await produtoL(s, { nome: 'Diesel S500' });
    const trator = await criarOk(s, corpoTrator(s, {
      nome: 'NOMESENTINELA', marca: 'MARCASENTINELA', modelo: 'MODELOSENTINELA', numero_serie: 'SERIESENTINELA', chassi: '9BWZZZ377VT004251',
      especificacoes: 'ESPECSENTINELA', observacoes: 'OBSSENTINELA', localizacao_descricao: 'LOCALSENTINELA', propriedade: 'TERCEIRO',
      proprietario_parceiro_id: s.parceiro1.id, centro_custo_id: s.centro1.id, area_id: s.area1.id, responsavel_usuario_id: resp.id,
      tanques: [tanqueCom([diesel.id], { identificador: 'TANQUESENTINELA', observacao: 'TANQOBSSENTINELA' })],
      aquisicao: { documento_referencia: 'DOCSENTINELA', fornecedor_parceiro_id: s.parceiro1.id, valor_aquisicao: '1000.00' },
    }));
    const camionete = await criarOk(s, corpoCaminhonete(s, { placa: 'QWE1R23', renavam: '98765432109' }));
    const curral = await criarOk(s, corpoCurral(s, { material: 'MATERIALSENTINELA' }));
    const impl = await criarOk(s, corpoImplemento(s, { compatibilidade: 'COMPATSENTINELA' }));
    const editado = await ok(req('PATCH', `/bens-patrimoniais/${trator.id}`, s.token, {
      empresa_id: s.e1.id, versao: 1, observacoes: 'OBS2SENTINELA', marca: null,
      tanques: [{ id: trator.tanques[0].id, identificador: 'TANQUE2SENTINELA', capacidade_litros: '200', produto_ids: [diesel.id, s500.id] }],
    }));
    assert.equal(editado.versao, 2);

    const eventos = await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'BemPatrimonial' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(eventos.map((e) => [e.acao, e.entidade_id]), [['create', trator.id], ['create', camionete.id], ['create', curral.id], ['create', impl.id], ['update', trator.id]]);
    assert.ok(eventos.every((e) => e.usuario_id === s.adm.usuario.id && e.request_id));
    const ALLOWLIST = [
      'area_id', 'ativo', 'centro_custo_id', 'codigo_frota', 'depreciavel', 'empresa_id', 'familia_id', 'fornecedor_parceiro_id', 'id', 'medidor', 'natureza',
      'numero', 'propriedade', 'proprietario_parceiro_id', 'residual_modo', 'responsavel_usuario_id', 'tanques', 'tipo_id', 'versao', 'vida_util_meses',
    ];
    for (const e of eventos.slice(0, 4)) assert.deepEqual(Object.keys(/** @type {any} */ (e.dados_novos)).sort(), ALLOWLIST);
    const update = /** @type {any} */ (eventos[4]);
    assert.deepEqual(Object.keys(update.dados_anteriores).sort(), ALLOWLIST);
    assert.deepEqual(Object.keys(update.dados_novos).sort(), [...ALLOWLIST, 'campos_alterados'].sort());
    assert.deepEqual([...update.dados_novos.campos_alterados].sort(), ['marca', 'observacoes', 'tanques']);
    assert.deepEqual(update.dados_anteriores.tanques, [{ id: trator.tanques[0].id, ativo: true, capacidade_litros: '180.0000', produto_ids: [diesel.id] }]);
    assert.deepEqual(update.dados_novos.tanques[0].produto_ids, [diesel.id, s500.id].sort());
    assert.equal(update.dados_novos.versao, 2);
    const texto = JSON.stringify(eventos.map((e) => [e.dados_anteriores, e.dados_novos]));
    for (const sentinela of [
      'NOMESENTINELA', 'MARCASENTINELA', 'MODELOSENTINELA', 'SERIESENTINELA', '9BWZZZ377VT004251', 'ESPECSENTINELA', 'OBSSENTINELA', 'OBS2SENTINELA',
      'LOCALSENTINELA', 'TANQUESENTINELA', 'TANQUE2SENTINELA', 'TANQOBSSENTINELA', 'DOCSENTINELA', 'QWE1R23', '98765432109', 'MATERIALSENTINELA',
      'COMPATSENTINELA', 'PRODUTOSENTINELA', 'CODPRODSENTINELA', 'Diesel S500', 'Agropecuária Parceira', 'Máquinas e frota', 'Retiro', resp.nome, resp.login,
    ]) {
      assert.ok(!texto.includes(sentinela), `auditoria com texto livre: ${sentinela}`);
    }
  });

  test('falha forçada na auditoria (gatilho) → 5xx e NADA gravado: bem, tanques e Produtos aceitos, sequência, PATCH com correção do medidor e catálogo; depois a numeração segue contínua', async () => {
    const s = await montarPatrimonio(app);
    const diesel = await produtoL(s, { nome: 'Diesel S10' });
    const arla = await produtoL(s, { nome: 'Arla 32' });
    const curral = await criarOk(s, corpoCurral(s));
    const trator = await criarOk(s, corpoTrator(s, { tanques: [tanqueCom([diesel.id])] }));
    const p = prisma();
    const sequencia = () => p.entidadeCodigoSequencia.findMany({ where: { cliente_id: s.c }, orderBy: { id: 'asc' } });
    const antes = await fotoPatrimonio(s.c);
    const seqAntes = JSON.stringify(await sequencia());
    await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION patrimonio_p1_falha_audit() RETURNS trigger AS $$ BEGIN
      IF NEW.entidade IN ('BemPatrimonial', 'FamiliaPatrimonial', 'TipoPatrimonial') THEN RAISE EXCEPTION 'falha forçada'; END IF;
      RETURN NEW; END $$ LANGUAGE plpgsql`);
    await p.$executeRawUnsafe('CREATE TRIGGER patrimonio_p1_falha_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION patrimonio_p1_falha_audit()');
    try {
      const pedidos = [
        ['POST benfeitoria', req('POST', '/bens-patrimoniais', s.token, corpoCurral(s, { nome: 'Não grava' }))],
        ['POST bem com tanque e Produtos aceitos', req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, { codigo_frota: 'TP-09', tanques: [tanqueCom([diesel.id, arla.id])] }))],
        ['PATCH benfeitoria', req('PATCH', `/bens-patrimoniais/${curral.id}`, s.token, { empresa_id: s.e1.id, versao: 1, nome: 'Não grava' })],
        ['PATCH tanques (aceite retirado e acrescentado)', req('PATCH', `/bens-patrimoniais/${trator.id}`, s.token, {
          empresa_id: s.e1.id, versao: 1, tanques: [{ id: trator.tanques[0].id, identificador: 'Tanque principal', capacidade_litros: '180', produto_ids: [arla.id] }],
        })],
        ['PATCH com correção do medidor (2 eventos)', req('PATCH', `/bens-patrimoniais/${trator.id}`, s.token, { empresa_id: s.e1.id, versao: 1, medidor: { tipo: 'CICLOS', leitura_inicial: '1', data_leitura: '2027-06-01' } })],
        ['POST tipo por natureza (código gerado)', req('POST', '/patrimonio-tipos', s.token, { natureza: 'OUTRO', nome: 'Não grava' })],
        ['POST tipo', req('POST', '/patrimonio-tipos', s.token, { familia_id: s.fam.MAQUINAS, nome: 'Não grava' })],
        ['DELETE tipo (D-PROD-169)', req('DELETE', `/patrimonio-tipos/${s.tip.GALPAO}?versao=1`, s.token)],
        ['PATCH tipo', req('PATCH', `/patrimonio-tipos/${s.tip.CURRAL}`, s.token, { versao: 1, nome: 'Não grava' })],
      ];
      for (const [rotulo, pedido] of pedidos) {
        const r = await pedido;
        assert.ok(r.statusCode >= 500, `${rotulo}: ${r.statusCode} ${r.body}`);
        assert.equal(r.json().message, 'erro interno', `${rotulo}: sem detalhe`);
      }
      // Instalar o padrão num tenant vazio também desfaz tudo (nenhuma das 19 linhas fica); idem a garantia
      // automática da D-PROD-169 (primeira leitura de tipos).
      const vazio = await montarPatrimonio(app, { catalogo: false });
      const vazioAntes = await contagens(vazio.c);
      assert.ok((await req('POST', '/patrimonio-catalogo-padrao', vazio.token, {})).statusCode >= 500);
      assert.equal(await contagens(vazio.c), vazioAntes);
      assert.ok((await req('GET', '/patrimonio-tipos', vazio.token)).statusCode >= 500, 'garantia sem auditoria não grava');
      assert.equal(await contagens(vazio.c), vazioAntes);
    } finally {
      await p.$executeRawUnsafe('DROP TRIGGER IF EXISTS patrimonio_p1_falha_audit ON "AuditLog"');
      await p.$executeRawUnsafe('DROP FUNCTION IF EXISTS patrimonio_p1_falha_audit()');
    }
    assert.equal(await fotoPatrimonio(s.c), antes, 'rollback completo: bem, tanques, Produtos aceitos e catálogo');
    assert.equal(JSON.stringify(await sequencia()), seqAntes, 'a reserva do número também foi desfeita');
    const seguinte = await criarOk(s, corpoGerador(s));
    assert.equal(seguinte.numero, '3', 'numeração do tenant contínua, sem buraco');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S5–S6 — o banco é a última rede', () => {
  test('RLS ligado e zero grants para PUBLIC/anon/authenticated nas 7 tabelas', async () => {
    const p = prisma();
    const rls = /** @type {any[]} */ (await p.$queryRaw`SELECT relname, relrowsecurity FROM pg_class WHERE relkind = 'r' AND relname = ANY(${[...TABELAS_PATRIMONIO]}::text[]) ORDER BY relname`);
    assert.deepEqual(rls.map((r) => r.relname), [...TABELAS_PATRIMONIO].sort());
    assert.ok(rls.every((r) => r.relrowsecurity === true), JSON.stringify(rls));
    const grants = /** @type {any[]} */ (await p.$queryRaw`
      SELECT c.relname, a.grantee::regrole::text AS grantee, a.privilege_type
        FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
       WHERE c.relname = ANY(${[...TABELAS_PATRIMONIO]}::text[])
         AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))`);
    assert.deepEqual(grants, [], 'nenhum privilégio para PUBLIC, anon ou authenticated');
    for (const papel of ['anon', 'authenticated']) {
      const existe = /** @type {any[]} */ (await p.$queryRaw`SELECT 1 FROM pg_roles WHERE rolname = ${papel}`);
      if (!existe.length) continue;
      for (const t of TABELAS_PATRIMONIO) {
        const [r] = /** @type {any[]} */ (await p.$queryRawUnsafe(`SELECT has_table_privilege('${papel}', 'public."${t}"', 'SELECT,INSERT,UPDATE,DELETE') AS pode`));
        assert.equal(r.pode, false, `${papel} em ${t}`);
      }
    }
  });

  test('UPDATE/INSERT/DELETE direto recusado pelos CHECKs (NULL-safe, A7), FKs compostas com o tenant e uniques; nada passa', async () => {
    const s = await montarPatrimonio(app);
    const outro = await montarPatrimonio(app);
    const diesel = await produtoL(s, { nome: 'Diesel S10' });
    const dieselAlheio = await produtoL(outro, { nome: 'Diesel alheio' });
    const trator = await criarOk(s, corpoTrator(s, { tanques: [tanqueCom([diesel.id])] }));
    const tratorAlheio = await criarOk(outro, corpoTrator(outro));
    const dep = await criarOk(s, corpoTrator(s, { codigo_frota: 'TP-03', ...DEPRECIAVEL }));
    const curral = await criarOk(s, corpoCurral(s));
    const tanque = trator.tanques[0];
    const p = prisma();
    const antes = await fotoPatrimonio([s.c, outro.c]);
    const recusa = async (sql, padrao, rotulo) => {
      await assert.rejects(() => p.$executeRawUnsafe(sql), (erroBanco) => {
        const e = /** @type {any} */ (erroBanco);
        assert.match(`${e.message} ${JSON.stringify(e.meta ?? {})}`, padrao, rotulo);
        return true;
      }, rotulo);
    };
    const bem = (id, set, constraint, rotulo) => recusa(`UPDATE "BemPatrimonial" SET ${set} WHERE id = '${id}'`, new RegExp(constraint), rotulo);
    const novoId = () => `x${randomUUID().replace(/-/g, '').slice(0, 24)}`;

    // A7: ramo contador exige TODAS as colunas do medidor (NULL não "passa" o CHECK).
    await bem(trator.id, 'medidor_leitura_atual = NULL', 'BemPatrimonial_medidor_check', 'contador com leitura atual nula');
    await bem(trator.id, 'medidor_leitura_inicial = NULL', 'BemPatrimonial_medidor_check', 'contador com leitura inicial nula');
    await bem(trator.id, 'medidor_data_leitura = NULL', 'BemPatrimonial_medidor_check', 'contador sem data');
    await bem(trator.id, 'medidor_origem = NULL', 'BemPatrimonial_medidor_check', 'contador sem origem');
    await bem(trator.id, "medidor_unidade = 'km'", 'BemPatrimonial_medidor_check', 'horímetro em km');
    await bem(trator.id, 'medidor_leitura_atual = medidor_leitura_inicial - 1', 'BemPatrimonial_medidor_check', 'atual abaixo da inicial');
    await bem(trator.id, "medidor_tipo = 'SEM_MEDIDOR'", 'BemPatrimonial_medidor_check', 'sem medidor com leitura');
    await bem(trator.id, "medidor_origem = 'OUTRA'", 'BemPatrimonial_medidor_origem_check', 'origem fora do domínio');
    await bem(trator.id, 'medidor_tipo = NULL, medidor_unidade = NULL, medidor_leitura_inicial = NULL, medidor_leitura_atual = NULL, medidor_data_leitura = NULL, medidor_origem = NULL', 'BemPatrimonial_medidor_natureza_check', 'máquina sem medidor');
    await bem(curral.id, "medidor_tipo = 'SEM_MEDIDOR'", 'BemPatrimonial_medidor_natureza_check', 'benfeitoria com medidor');
    // A7: ramo depreciável exige os parâmetros NOT NULL.
    await bem(dep.id, 'vida_util_meses = NULL', 'BemPatrimonial_depreciacao_check', 'depreciável com vida nula');
    await bem(dep.id, 'data_inicio_depreciacao = NULL', 'BemPatrimonial_depreciacao_check', 'depreciável sem início');
    await bem(dep.id, 'valor_aquisicao = NULL', 'BemPatrimonial_depreciacao_check', 'depreciável sem valor');
    await bem(dep.id, 'depreciacao_metodo = NULL', 'BemPatrimonial_depreciacao_check', 'depreciável sem método');
    await bem(dep.id, 'residual_modo = NULL', 'BemPatrimonial_depreciacao_check', 'depreciável sem modo do residual');
    await bem(dep.id, "residual_modo = 'PERCENTUAL'", 'BemPatrimonial_depreciacao_check', 'percentual nulo');
    await bem(dep.id, 'valor_residual = valor_aquisicao + 1', 'BemPatrimonial_depreciacao_check', 'residual acima do custo');
    await bem(dep.id, 'vida_util_meses = 1201', 'BemPatrimonial_depreciacao_check', 'vida acima de 1200');
    await bem(dep.id, "propriedade = 'TERCEIRO'", 'BemPatrimonial_depreciacao_check', 'depreciável de terceiro');
    await bem(dep.id, 'depreciavel = false', 'BemPatrimonial_depreciacao_check', 'não depreciável com parâmetros');
    await bem(trator.id, 'depreciavel = true', 'BemPatrimonial_depreciacao_check', 'depreciável sem parâmetros');
    await bem(dep.id, "data_inicio_depreciacao = '2026-02-19'", 'BemPatrimonial_inicio_depreciacao_check', 'início antes da disponibilidade');
    await bem(dep.id, "data_disponibilidade = '2026-02-01'", 'BemPatrimonial_datas_check', 'disponibilidade antes da aquisição');
    // Domínios e formatos.
    await bem(trator.id, "codigo_frota = 'tp-02'", 'BemPatrimonial_codigo_frota_check', 'código de frota fora do padrão');
    await bem(trator.id, "placa = 'ABC-1234'", 'BemPatrimonial_identificacao_check', 'placa com hífen');
    await bem(trator.id, "chassi = '9BWZZZ377VT00425I'", 'BemPatrimonial_identificacao_check', 'chassi com I');
    await bem(trator.id, "placa_uf = 'XX'", 'BemPatrimonial_identificacao_check', 'UF inexistente');
    await bem(trator.id, "renavam = '12345678'", 'BemPatrimonial_identificacao_check', 'renavam curto');
    await bem(trator.id, 'potencia_cv = 0', 'BemPatrimonial_valores_check', 'potência zero');
    await bem(trator.id, 'valor_aquisicao = -1', 'BemPatrimonial_valores_check', 'valor negativo');
    await bem(trator.id, 'ano_fabricacao = 1800', 'BemPatrimonial_anos_check', 'ano fora da faixa');
    // Natureza desconhecida também não casa nenhum ramo da regra do medidor: qualquer dos dois CHECKs barra.
    await bem(trator.id, "natureza = 'FROTA'", 'BemPatrimonial_(natureza|medidor_natureza)_check', 'natureza fora do domínio');
    await bem(trator.id, "propriedade = 'EMPRESTADO'", 'BemPatrimonial_propriedade_check', 'propriedade fora do domínio');
    await bem(trator.id, `proprietario_parceiro_id = '${s.parceiro1.id}'`, 'BemPatrimonial_proprietario_check', 'bem próprio com proprietário');
    await bem(trator.id, 'versao = 0', 'BemPatrimonial_versao_check', 'versão zero');
    // Tanques, Produtos aceitos e catálogos.
    await recusa(`UPDATE "TanqueBem" SET capacidade_litros = 0 WHERE id = '${tanque.id}'`, /TanqueBem_capacidade_check/, 'tanque sem capacidade');
    await recusa(`UPDATE "TanqueBem" SET identificador = '   ' WHERE id = '${tanque.id}'`, /TanqueBem_identificador_check/, 'identificador em branco');
    await recusa(`UPDATE "FamiliaPatrimonial" SET natureza = 'FROTA' WHERE id = '${s.fam.MAQUINAS}'`, /FamiliaPatrimonial_natureza_check/, 'natureza da família fora do domínio');
    await recusa(`UPDATE "FamiliaPatrimonial" SET codigo = 'maq' WHERE id = '${s.fam.MAQUINAS}'`, /FamiliaPatrimonial_codigo_check/, 'código em minúsculas');
    // FKs compostas: tenant e fazenda nos dois lados.
    await recusa(`UPDATE "BemPatrimonial" SET centro_custo_id = '${s.centro2.id}' WHERE id = '${trator.id}'`, /foreign key|centro_custo_id_fkey/i, 'centro de outra fazenda');
    await recusa(`UPDATE "BemPatrimonial" SET empresa_id = '${outro.e1.id}' WHERE id = '${trator.id}'`, /foreign key/i, 'fazenda de outro tenant');
    await recusa(`UPDATE "BemPatrimonial" SET familia_id = '${outro.fam.MAQUINAS}' WHERE id = '${trator.id}'`, /foreign key/i, 'família de outro tenant');
    await recusa(`UPDATE "TipoPatrimonial" SET familia_id = '${outro.fam.MAQUINAS}' WHERE id = '${s.tip.TRATOR_PNEUS}'`, /foreign key/i, 'tipo apontando família de outro tenant');
    await recusa(`INSERT INTO "TanqueBemProduto" (id, cliente_id, tanque_id, produto_id, "updatedAt") VALUES ('${novoId()}', '${s.c}', '${tanque.id}', '${dieselAlheio.id}', now())`, /foreign key/i, 'Produto de outro tenant');
    await recusa(`INSERT INTO "TanqueBemProduto" (id, cliente_id, tanque_id, produto_id, "updatedAt") VALUES ('${novoId()}', '${s.c}', '${tratorAlheio.tanques[0].id}', '${diesel.id}', now())`, /foreign key/i, 'tanque de outro tenant');
    await recusa(`INSERT INTO "TanqueBem" (id, cliente_id, bem_id, identificador, capacidade_litros, "updatedAt") VALUES ('${novoId()}', '${s.c}', '${trator.id}', '${tanque.identificador}', 10, now())`, /23505|duplicate key|unique/i, 'identificador repetido no bem');
    await recusa(`INSERT INTO "TanqueBemProduto" (id, cliente_id, tanque_id, produto_id, "updatedAt") VALUES ('${novoId()}', '${s.c}', '${tanque.id}', '${diesel.id}', now())`, /23505|duplicate key|unique/i, 'Produto aceito repetido no tanque');
    // RESTRICT: nada referenciado some por DELETE direto.
    await recusa(`DELETE FROM "FamiliaPatrimonial" WHERE id = '${s.fam.MAQUINAS}'`, /foreign key/i, 'família usada');
    await recusa(`DELETE FROM "Produto" WHERE id = '${diesel.id}'`, /foreign key/i, 'Produto aceito por tanque');
    await recusa(`DELETE FROM "TanqueBem" WHERE id = '${tanque.id}'`, /foreign key/i, 'tanque com Produto aceito');
    await recusa(`DELETE FROM "BemPatrimonial" WHERE id = '${trator.id}'`, /foreign key/i, 'bem com tanque');
    assert.equal(await fotoPatrimonio([s.c, outro.c]), antes, 'nenhuma escrita direta passou');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S7 — exclusão de cadastros antigos referenciados por bens', () => {
  test('parceiro proprietário ou fornecedor do bem → 409 PARCEIRO_EM_USO com details.bens (nunca 403); livre sai; fazenda com bem → 409 EMPRESA_COM_VINCULOS', async () => {
    const s = await montarPatrimonio(app);
    const p = prisma();
    const fornecedor = await p.fornecedor.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_cadastro: `F-${randomUUID().slice(0, 6)}`, tipo_pessoa: 'Jurídica', nome: 'Revenda de tratores' } });
    const livre = await p.fornecedor.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_cadastro: `L-${randomUUID().slice(0, 6)}`, tipo_pessoa: 'Física', nome: 'Sem vínculo' } });
    await criarOk(s, corpoTrator(s, { propriedade: 'ARRENDADO', proprietario_parceiro_id: s.parceiro1.id, aquisicao: { fornecedor_parceiro_id: fornecedor.id } }));
    await criarOk(s, corpoImplemento(s, { aquisicao: { fornecedor_parceiro_id: fornecedor.id } }));
    const antes = await contagens(s.c);
    const proprietario = await req('DELETE', `/fornecedores/${s.parceiro1.id}`, s.token);
    assert.deepEqual(erro(proprietario).slice(0, 2), [409, 'PARCEIRO_EM_USO'], proprietario.body);
    assert.equal(proprietario.json().details.bens, 1);
    const doFornecedor = await req('DELETE', `/fornecedores/${fornecedor.id}`, s.token);
    assert.deepEqual([doFornecedor.statusCode, doFornecedor.json().code, doFornecedor.json().details.bens], [409, 'PARCEIRO_EM_USO', 2]);
    assert.equal(await contagens(s.c), antes, 'nada apagado');
    assert.equal((await req('DELETE', `/fornecedores/${livre.id}`, s.token)).statusCode, 204);

    // Fazenda só com um bem: o vínculo do Patrimônio entra na contagem (DMMF).
    const e3 = await p.empresa.create({ data: { cliente_id: s.c, numero_empresa: 3, fuso_horario: FUSO, apelido: 'F3', nome: `Fazenda 3 ${randomUUID().slice(0, 4)}` } });
    await criarOk(s, corpoGerador(s, { empresa_id: e3.id }));
    const emp = await req('DELETE', `/empresas/${e3.id}`, s.token);
    assert.deepEqual(erro(emp).slice(0, 2), [409, 'EMPRESA_COM_VINCULOS'], emp.body);
    assert.deepEqual(emp.json().details.vinculos, [{ entidade: 'BemPatrimonial', total: 1 }]);
    assert.ok(await p.empresa.findUnique({ where: { id: e3.id } }), 'fazenda intacta');
    assert.equal(await p.bemPatrimonial.count({ where: { cliente_id: s.c, empresa_id: e3.id } }), 1);
  });

  // ─── corridas: um portão (gatilho na auditoria) segura UMA transação do app
  // depois das escritas e antes do commit; o teste observa as travas no banco.
  // Sem trava na leitura, a FK falhava depois e devolvia o enganoso 403
  // TENANT_SCOPE_VIOLATION; o contrato exige 409/422/404 de negócio.
  /** @type {PrismaClient} */
  let aux;
  before(() => {
    aux = new PrismaClient();
  });
  after(async () => {
    await aux?.$disconnect();
  });
  const PORTAO = 'patrimonio_p1_portao';
  /** Segura o INSERT de auditoria da `entidade` (só deste tenant) até o teste abrir o portão. */
  const instalarPortao = async (clienteId, entidade) => {
    const p = prisma();
    await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${PORTAO}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_advisory_xact_lock_shared(156, 1); RETURN NEW; END $f$`);
    await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "AuditLog"`);
    await p.$executeRawUnsafe(
      `CREATE TRIGGER ${PORTAO} BEFORE INSERT ON "AuditLog" FOR EACH ROW WHEN (NEW.cliente_id = '${clienteId}' AND NEW.entidade = '${entidade}') EXECUTE FUNCTION ${PORTAO}()`
    );
  };
  const removerPortao = () => prisma().$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "AuditLog"`);
  /** pid parado no portão (ou null). */
  const paradoNoPortao = async () => {
    const l = /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = 156 AND objid = 1 AND objsubid = 2 AND NOT granted`);
    return l.length ? l[0].pid : null;
  };
  /** Algum pid esperando uma trava de `pid` (ou null). */
  const alguemEsperando = async (pid) => {
    const l = /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND ${pid}::int = ANY(pg_blocking_pids(pid))`);
    return l.length ? l[0].pid : null;
  };
  /** Espera uma CONDIÇÃO observável (nunca um tempo fixo). */
  const esperar = async (cond, rotulo, ms = 4000) => {
    const limite = Date.now() + ms;
    for (;;) {
      const v = await cond();
      if (v) return v;
      if (Date.now() > limite) throw new Error(`tempo esgotado esperando: ${rotulo}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  /**
   * `primeiro` para no portão (gravou, não confirmou); `segundo` é disparado e
   * espera a trava de `primeiro`; o portão abre. Devolve as duas respostas.
   * @param {string} clienteId @param {string} entidade  auditoria de `primeiro`
   * @param {() => Promise<any>} primeiro @param {() => Promise<any>} segundo
   */
  const emCorrida = async (clienteId, entidade, primeiro, segundo) => {
    await instalarPortao(clienteId, entidade);
    try {
      /** @type {Array<Promise<any>>} */
      const pedidos = [];
      await aux.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(156, 1)`;
          pedidos.push(primeiro());
          const pid = await esperar(paradoNoPortao, `${entidade} parado no portão`);
          pedidos.push(segundo());
          await esperar(() => alguemEsperando(pid), 'o segundo pedido esperando a trava do primeiro');
        },
        { maxWait: 10000, timeout: 30000 }
      );
      return await Promise.all(pedidos);
    } finally {
      await removerPortao();
    }
  };
  const fornecedorNovo = (s, nome) =>
    prisma().fornecedor.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_cadastro: `C-${randomUUID().slice(0, 6)}`, tipo_pessoa: 'Jurídica', nome } });
  const fazendaNova = (s, numero) =>
    prisma().empresa.create({ data: { cliente_id: s.c, numero_empresa: numero, fuso_horario: FUSO, apelido: `F${numero}`, nome: `Fazenda ${numero} ${randomUUID().slice(0, 4)}` } });

  test('corrida parceiro × bem: bem em voo segura o parceiro (DELETE → 409 PARCEIRO_EM_USO); exclusão em voo some com ele (POST do bem → 422 inexistente); nunca 403', async () => {
    const s = await montarPatrimonio(app);
    const p = prisma();
    // (1) O bem gravou o fornecedor e ainda não confirmou; o DELETE chega.
    const f1 = await fornecedorNovo(s, 'Revenda em corrida');
    const [bem, exclusao] = await emCorrida(
      s.c,
      'BemPatrimonial',
      () => req('POST', '/bens-patrimoniais', s.token, corpoImplemento(s, { aquisicao: { fornecedor_parceiro_id: f1.id } })),
      () => req('DELETE', `/fornecedores/${f1.id}`, s.token)
    );
    assert.equal(bem.statusCode, 201, bem.body);
    assert.deepEqual(erro(exclusao).slice(0, 2), [409, 'PARCEIRO_EM_USO'], exclusao.body);
    assert.equal(exclusao.json().details.bens, 1);
    assert.ok(await p.fornecedor.findUnique({ where: { id: f1.id } }), 'parceiro intacto');

    // (2) O DELETE apagou o parceiro e ainda não confirmou; o POST do bem chega com ele.
    const f2 = await fornecedorNovo(s, 'Revenda que sai');
    const bensAntes = () => Promise.all([p.bemPatrimonial.count({ where: { cliente_id: s.c } }), p.auditLog.count({ where: { cliente_id: s.c, entidade: 'BemPatrimonial' } })]);
    const antes = await bensAntes();
    const [saida, recusado] = await emCorrida(
      s.c,
      'Fornecedor',
      () => req('DELETE', `/fornecedores/${f2.id}`, s.token),
      () => req('POST', '/bens-patrimoniais', s.token, corpoImplemento(s, { nome: 'Roçadeira nova', aquisicao: { fornecedor_parceiro_id: f2.id } }))
    );
    assert.equal(saida.statusCode, 204, saida.body);
    assert.deepEqual(erro(recusado), [422, 'BEM_REFERENCIA_INVALIDA', 'aquisicao.fornecedor_parceiro_id', 'inexistente'], recusado.body);
    assert.equal(await p.fornecedor.findUnique({ where: { id: f2.id } }), null);
    assert.deepEqual(await bensAntes(), antes, 'bem recusado: nada gravado (nem auditoria)');
  });

  test('corrida fazenda × bem: exclusão em voo some com a fazenda (POST do bem → 404 EMPRESA_NOT_FOUND); bem em voo segura a fazenda (DELETE → 409 EMPRESA_COM_VINCULOS); nunca 403', async () => {
    const s = await montarPatrimonio(app);
    const p = prisma();
    // (1) O DELETE da fazenda vazia apagou-a e ainda não confirmou; o POST do bem chega nela.
    const e3 = await fazendaNova(s, 3);
    const [saida, recusado] = await emCorrida(
      s.c,
      'Empresa',
      () => req('DELETE', `/empresas/${e3.id}`, s.token),
      () => req('POST', '/bens-patrimoniais', s.token, corpoGerador(s, { empresa_id: e3.id }))
    );
    assert.equal(saida.statusCode, 204, saida.body);
    assert.deepEqual(erro(recusado).slice(0, 2), [404, 'EMPRESA_NOT_FOUND'], recusado.body);
    assert.equal(await p.empresa.findUnique({ where: { id: e3.id } }), null);
    assert.equal(await p.bemPatrimonial.count({ where: { cliente_id: s.c, empresa_id: e3.id } }), 0);

    // (2) O bem gravou na fazenda e ainda não confirmou; o DELETE chega.
    const e4 = await fazendaNova(s, 4);
    const [bem, exclusao] = await emCorrida(
      s.c,
      'BemPatrimonial',
      () => req('POST', '/bens-patrimoniais', s.token, corpoGerador(s, { empresa_id: e4.id })),
      () => req('DELETE', `/empresas/${e4.id}`, s.token)
    );
    assert.equal(bem.statusCode, 201, bem.body);
    assert.deepEqual(erro(exclusao).slice(0, 2), [409, 'EMPRESA_COM_VINCULOS'], exclusao.body);
    assert.deepEqual(exclusao.json().details.vinculos, [{ entidade: 'BemPatrimonial', total: 1 }]);
    assert.ok(await p.empresa.findUnique({ where: { id: e4.id } }), 'fazenda intacta');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S8 — release: runtime novo + schema antigo, e o preflight', () => {
  test('sem as 7 tabelas (DROP numa transação desfeita), o runtime novo falha P2021 no Patrimônio (500 sem detalhe) e o resto segue; o banco volta ao normal', async () => {
    const s = await montarPatrimonio(app);
    const diesel = await produtoL(s, { nome: 'Diesel S10' });
    await criarOk(s, corpoTrator(s, { tanques: [tanqueCom([diesel.id])] }));
    const delegados = ['abastecimentoBem', 'abastecimentoBemConsumoLote', 'bemPatrimonial', 'familiaPatrimonial', 'tanqueBem', 'tanqueBemProduto', 'tipoPatrimonial'];
    assert.deepEqual(delegados.map((d) => d[0].toUpperCase() + d.slice(1)), [...TABELAS_PATRIMONIO], 'um delegado por tabela');
    const r = await emTransacaoDesfeita(async (tx) => {
      // D-PROD-190: o ApontamentoAtividade (migration POSTERIOR) referencia o bem
      // e o implemento; no "schema antigo" ele também não existe. É a ÚNICA
      // tabela de fora que referencia as 7: confere-se pelo catálogo antes de
      // tirá-la, para nada sumir escondido.
      const deFora = /** @type {any[]} */ (
        await tx.$queryRaw`SELECT DISTINCT o.relname FROM pg_constraint k
          JOIN pg_class o ON o.oid = k.conrelid JOIN pg_class d ON d.oid = k.confrelid
          WHERE k.contype = 'f' AND d.relname = ANY(${[...TABELAS_PATRIMONIO]}::text[])
            AND NOT (o.relname = ANY(${[...TABELAS_PATRIMONIO]}::text[]))
          ORDER BY o.relname`
      ).map((x) => x.relname);
      assert.deepEqual(deFora, ['ApontamentoAtividade'], 'só o apontamento (posterior) referencia as 7 tabelas');
      await tx.$executeRawUnsafe('DROP TABLE "ApontamentoAtividade"');
      // As 7 saem juntas, sem CASCADE (nada mais de fora as referencia; nada some escondido).
      await tx.$executeRawUnsafe(`DROP TABLE ${TABELAS_PATRIMONIO.map((t) => `"${t}"`).join(', ')}`);
      /** @type {Record<string, unknown>} */
      const codigos = {};
      /** @type {unknown} */
      let primeiro = null;
      for (const d of delegados) {
        // O erro aborta a transação no PostgreSQL: isola cada leitura num SAVEPOINT.
        await tx.$executeRawUnsafe('SAVEPOINT leitura_runtime_novo');
        const e = await /** @type {any} */ (tx)[d].findMany({ take: 1 }).then(() => null, (x) => x);
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT leitura_runtime_novo');
        codigos[d] = /** @type {any} */ (e)?.code ?? null;
        primeiro ??= e;
      }
      // A contagem de bens da exclusão de parceiro também cai (é por isso que a migration vai antes do código).
      await tx.$executeRawUnsafe('SAVEPOINT exclusao_parceiro');
      const contagemBens = await tx.bemPatrimonial.count({ where: { cliente_id: s.c } }).then(() => null, (x) => x.code);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT exclusao_parceiro');
      const fornecedores = await tx.fornecedor.count({ where: { cliente_id: s.c } });
      const empresas = await tx.empresa.count({ where: { cliente_id: s.c } });
      const produtos = await tx.produto.count({ where: { cliente_id: s.c } });
      return { codigos, primeiro, contagemBens, fornecedores, empresas, produtos };
    });
    assert.deepEqual(r.codigos, Object.fromEntries(delegados.map((d) => [d, 'P2021'])), JSON.stringify(r.codigos));
    assert.equal(r.contagemBens, 'P2021');
    assert.deepEqual([r.fornecedores, r.empresas, r.produtos], [3, 2, 1], 'as tabelas antigas seguem legíveis (o Produto também)');
    const http500 = normalizarErro(r.primeiro);
    assert.deepEqual([http500.code, http500.status], ['INTERNAL_ERROR', 500], 'o cliente vê 500 genérico, sem nome de tabela');
    // Transação desfeita: as 7 tabelas, o bem e o aceite continuam lá.
    assert.equal(await prisma().bemPatrimonial.count({ where: { cliente_id: s.c } }), 1);
    assert.equal(await prisma().tanqueBemProduto.count({ where: { cliente_id: s.c } }), 1);
    const existentes = /** @type {any[]} */ (await prisma().$queryRaw`SELECT relname FROM pg_class WHERE relkind = 'r' AND relname = ANY(${[...TABELAS_PATRIMONIO]}::text[])`);
    assert.equal(existentes.length, 7);
    // As tabelas removidas pela D-PROD-162 não existem mais.
    const removidas = ['ConversaoCombustivelProduto', 'TipoCombustivelProduto', 'TanqueBemCombustivel', 'TipoCombustivel', 'MedicaoBem', 'TipoPatrimonialPerfil', 'PerfilMedicao'];
    assert.deepEqual(/** @type {any[]} */ (await prisma().$queryRaw`SELECT relname FROM pg_class WHERE relkind = 'r' AND relname = ANY(${removidas}::text[])`), []);
  });

  test('preflight: sem a migration no histórico acusa "migrations pendentes" (dados sintéticos e o histórico local numa transação desfeita); iniciada sem concluir → falha registrada', async () => {
    const pastas = readdirSync(join(REPO, 'backend', 'prisma', 'migrations'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name))
      .map((d) => d.name)
      .sort();
    assert.ok(pastas.includes(MIGRATION_PATRIMONIO), 'a migration está no repositório');
    const aplicadas = (nomes) => nomes.map((migration_name) => ({ migration_name, concluida: true, revertida: false }));
    const base = {
      pastas,
      colunas: COLUNAS_EXIGIDAS.map(([table_name, column_name]) => ({ table_name, column_name })),
      tabelas: TABELAS_PROTEGIDAS.map((tabela) => ({ tabela, rls: true })),
      grants: [],
      papeis: null,
    };
    const semPatrimonio = pastas.filter((m) => m !== MIGRATION_PATRIMONIO);

    const pronto = avaliarPreflight({ ...base, migrations: aplicadas(pastas) });
    assert.deepEqual([pronto.ok, pronto.falhas], [true, []]);
    const pendente = avaliarPreflight({ ...base, migrations: aplicadas(semPatrimonio) });
    assert.equal(pendente.ok, false);
    assert.deepEqual(pendente.resumo.pendentes, [MIGRATION_PATRIMONIO]);
    assert.deepEqual(pendente.falhas, [`migrations pendentes (1): ${MIGRATION_PATRIMONIO}`]);
    const comFalha = avaliarPreflight({ ...base, migrations: [...aplicadas(semPatrimonio), { migration_name: MIGRATION_PATRIMONIO, concluida: false, revertida: false }] });
    assert.equal(comFalha.ok, false);
    assert.match(comFalha.falhas.join('\n'), new RegExp(`com falha registrada: ${MIGRATION_PATRIMONIO}`));
    const revertida = avaliarPreflight({ ...base, migrations: [...aplicadas(semPatrimonio), { migration_name: MIGRATION_PATRIMONIO, concluida: true, revertida: true }] });
    assert.deepEqual(revertida.resumo.pendentes, [MIGRATION_PATRIMONIO], 'revertida conta como pendente');

    // O histórico REAL do banco local: aplicado → nada pendente; sem a linha (desfeito) → pendente.
    const real = avaliarPreflight({ ...base, migrations: /** @type {any} */ (await prisma().$queryRawUnsafe(CONSULTAS.migrations)) });
    assert.deepEqual(real.resumo.pendentes, []);
    // D-PROD-162: as colunas exigidas (quantidade/unidade do abastecimento e o Produto aceito) existem no banco real.
    for (const par of [['AbastecimentoBem', 'quantidade'], ['AbastecimentoBem', 'unidade'], ['TanqueBemProduto', 'produto_id']]) {
      assert.ok(COLUNAS_EXIGIDAS.some(([t, c]) => t === par[0] && c === par[1]), `COLUNAS_EXIGIDAS com ${par.join('.')}`);
    }
    const colunasReais = /** @type {any[]} */ (await prisma().$queryRawUnsafe(CONSULTAS.colunas));
    assert.equal(colunasReais.length, COLUNAS_EXIGIDAS.length, 'toda coluna exigida existe no banco migrado');
    const local = await emTransacaoDesfeita(async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM "_prisma_migrations" WHERE migration_name = '${MIGRATION_PATRIMONIO}'`);
      return avaliarPreflight({ ...base, migrations: /** @type {any} */ (await tx.$queryRawUnsafe(CONSULTAS.migrations)) });
    });
    assert.equal(local.ok, false);
    assert.deepEqual(local.resumo.pendentes, [MIGRATION_PATRIMONIO]);
    assert.equal((await prisma().$queryRawUnsafe(`SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '${MIGRATION_PATRIMONIO}'`)).length, 1, 'histórico intacto');
  });
});
