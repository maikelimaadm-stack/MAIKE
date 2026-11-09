/**
 * D-PROD-157 (R2) — Patrimônio P1-01: vínculo COMBUSTÍVEL × PRODUTO por
 * empresa e o contrato de leitura dos produtos ELEGÍVEIS de um bem (para a
 * P1-02). PostgreSQL real e HTTP autenticado (`app.inject`).
 *
 *  V1. Multiempresa: cada fazenda mapeia os SEUS produtos para o mesmo tipo do
 *      tenant; produto de outra fazenda, inativo, inexistente ou de outro tenant
 *      é recusado (422 sem oráculo entre "inexistente" e "outro tenant").
 *  V2. Regras do vínculo: par repetido (ativo/inativo), um produto em dois
 *      tipos, inativar/reativar com CAS e com as mesmas regras do POST, 404
 *      sem oráculo; nada fora do Patrimônio muda (estoque, financeiro, FIFO).
 *  V3. Concorrência: POST duplicado e produto em dois tipos em paralelo →
 *      [201, 409]; exclusão e troca de empresa do produto em corrida com o
 *      vínculo (portão na auditoria) → 409/422 de negócio, nunca 403/500.
 *  V4. Produto (tabela antiga): excluir com vínculo (ativo ou inativo) → 409
 *      PRODUTO_DELETE_BLOCKED; mudar a empresa com vínculo ATIVO → 409
 *      PRODUTO_VINCULADO_COMBUSTIVEL (nada gravado); inativar → permitido.
 *  V5. Elegíveis do bem: tanque × vínculos ATIVOS da empresa do bem × produtos
 *      ATIVOS da mesma empresa (TP-02 diesel S10 não oferece S500; flex só
 *      gasolina e etanol; sem vínculo → vazio, nunca "todos"); sem preço,
 *      saldo nem custo.
 *  V6. Opções de produtos: só ativos da fazenda, busca, keyset, vínculo ativo
 *      indicado.
 *  V7. Permissões (401/403 por ação), corpo/query fechados (cliente_id, extra,
 *      campo imutável → 400).
 *  V8. Banco: CHECK/unique/FK direto; auditoria por allowlist e rollback por
 *      gatilho.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import {
  TELAS, contagemForaDoPatrimonio, corpoCaminhonete, corpoErro, corpoTrator, erro, fotoPatrimonio, http, linha, montarPatrimonio, prisma, tudo,
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

let n = 0;
/** Produto REAL da fazenda (tabela antiga; nada de estoque): unidade padrão KG. */
const produtoNovo = (s, empresa, nome, extra = {}) =>
  prisma().produto.create({
    data: { cliente_id: s.c, empresa_id: empresa.id, numero_produto: `PRD-${(n += 1)}-${randomUUID().slice(0, 6)}`, nome_produto: nome, ...extra },
  });

const urlVinculos = (tipoId, empresaId, extra = '') => `/patrimonio-combustiveis/${tipoId}/produtos?empresa_id=${empresaId}${extra}`;
const vincular = (s, tipoId, empresaId, produtoId, tok = s.token) =>
  req('POST', `/patrimonio-combustiveis/${tipoId}/produtos`, tok, { empresa_id: empresaId, produto_id: produtoId });
const vincularOk = async (s, tipoId, empresaId, produtoId) => ok(vincular(s, tipoId, empresaId, produtoId), 201);
const alterar = (s, vinculoId, corpo, tok = s.token) => req('PATCH', `/patrimonio-combustivel-produtos/${vinculoId}`, tok, corpo);
const elegiveis = (s, bemId, empresaId, extra = '', tok = s.token) => req('GET', `/bens-patrimoniais/${bemId}/produtos-elegiveis?empresa_id=${empresaId}${extra}`, tok);
const opcoes = (s, empresaId, extra = '', tok = s.token) => req('GET', `/patrimonio-combustiveis-opcoes/produtos?empresa_id=${empresaId}${extra}`, tok);
const criarBem = (s, corpo) => ok(req('POST', '/bens-patrimoniais', s.token, corpo), 201);

/** Forma EXATA do item de vínculo. */
const vinculoEsperado = (v, { empresaId, tipoId, produto, ativo = true, versao = 1, coerente = true }) => ({
  id: v.id,
  empresa_id: empresaId,
  tipo_combustivel_id: tipoId,
  ativo,
  versao,
  produto: {
    id: produto.id,
    nome: produto.nome_produto,
    codigo_interno: produto.codigo_interno ?? null,
    unidade_principal_estoque: produto.unidade_principal_estoque,
    ativo: produto.ativo,
    empresa_coerente: coerente,
  },
  created_date: v.created_date,
  updated_date: v.updated_date,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('V1 — multiempresa e multitenant', () => {
  test('mesmo tipo do tenant com produtos diferentes em cada fazenda: cada uma vê só os seus; dois produtos no mesmo tipo; unidade do produto como está (KG); nada fora do Patrimônio muda', async () => {
    const s = await montarPatrimonio(app);
    const granel = await produtoNovo(s, s.e1, 'DIESEL S10 A GRANEL', { codigo_interno: 'D10G' });
    const posto = await produtoNovo(s, s.e1, 'DIESEL S10 POSTO');
    const daB = await produtoNovo(s, s.e2, 'DIESEL S10 FAZENDA B', { unidade_principal_estoque: 'L' });
    const foraAntes = await contagemForaDoPatrimonio(s.c);

    const v1 = await vincularOk(s, s.comb.DIESEL_S10, s.e1.id, granel.id);
    assert.deepEqual(v1, vinculoEsperado(v1, { empresaId: s.e1.id, tipoId: s.comb.DIESEL_S10, produto: granel }));
    assert.equal(v1.produto.unidade_principal_estoque, 'KG', 'unidade de estoque exibida como está: nenhuma conversão L↔KG');
    const v2 = await vincularOk(s, s.comb.DIESEL_S10, s.e1.id, posto.id);
    const v3 = await vincularOk(s, s.comb.DIESEL_S10, s.e2.id, daB.id);
    assert.equal(v3.produto.unidade_principal_estoque, 'L');

    const e1 = await ok(req('GET', urlVinculos(s.comb.DIESEL_S10, s.e1.id), s.token));
    assert.equal(e1.total, 2);
    assert.deepEqual(e1.items.map((i) => i.produto.id).sort(), [granel.id, posto.id].sort());
    assert.ok(e1.items.every((i) => i.empresa_id === s.e1.id && i.produto.empresa_coerente === true));
    assert.deepEqual(e1.items.find((i) => i.id === v2.id), vinculoEsperado(v2, { empresaId: s.e1.id, tipoId: s.comb.DIESEL_S10, produto: posto }));
    const e2 = await ok(req('GET', urlVinculos(s.comb.DIESEL_S10, s.e2.id), s.token));
    assert.deepEqual(e2.items.map((i) => i.id), [v3.id], 'a fazenda B não vê o cadastro da A');
    // Outro tipo do tenant: nada vinculado.
    assert.deepEqual((await ok(req('GET', urlVinculos(s.comb.DIESEL_S500, s.e1.id), s.token))).items, []);

    // Keyset: página de 1 em 1, sem repetir nem perder.
    const p1 = await ok(req('GET', urlVinculos(s.comb.DIESEL_S10, s.e1.id, '&limit=1'), s.token));
    assert.equal(p1.has_more, true);
    const p2 = await ok(req('GET', urlVinculos(s.comb.DIESEL_S10, s.e1.id, `&limit=1&cursor=${encodeURIComponent(p1.next_cursor)}`), s.token));
    assert.equal(p2.has_more, false);
    assert.deepEqual([...p1.items, ...p2.items].map((i) => i.id).sort(), [v1.id, v2.id].sort());

    assert.deepEqual(await contagemForaDoPatrimonio(s.c), foraAntes, 'nenhuma linha de estoque, financeiro, FIFO ou Produto criada/alterada');
    const produtoDepois = await prisma().produto.findUnique({ where: { id: granel.id } });
    assert.equal(JSON.stringify(produtoDepois), JSON.stringify(granel), 'o Produto não é tocado pelo vínculo');
  });

  test('produto de outra fazenda, inativo, inexistente ou de outro tenant → 422 COMBUSTIVEL_PRODUTO_INVALIDO (inexistente ≡ outro tenant, sem oráculo); tipo inativo → 422; tipo e fazenda de outro tenant → 404 uniforme; nada gravado', async () => {
    const s = await montarPatrimonio(app);
    const outro = await montarPatrimonio(app);
    const daA = await produtoNovo(s, s.e1, 'DIESEL DA FAZENDA A');
    const inativo = await produtoNovo(s, s.e1, 'DIESEL ANTIGO', { ativo: false });
    const doOutroTenant = await produtoNovo(outro, outro.e1, 'DIESEL DE OUTRO TENANT');
    const antes = await fotoPatrimonio([s.c, outro.c]);

    assert.deepEqual(erro(await vincular(s, s.comb.DIESEL_S10, s.e2.id, daA.id)), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'outra_empresa'], 'produto da A não vincula na B');
    assert.deepEqual(erro(await vincular(s, s.comb.DIESEL_S10, s.e1.id, inativo.id)), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'inativo']);
    const inexistente = await vincular(s, s.comb.DIESEL_S10, s.e1.id, INEXISTENTE);
    const deOutro = await vincular(s, s.comb.DIESEL_S10, s.e1.id, doOutroTenant.id);
    assert.deepEqual(erro(inexistente), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'inexistente']);
    assert.deepEqual(corpoErro(deOutro), corpoErro(inexistente), 'outro tenant ≡ inexistente (corpo idêntico)');

    // Tipo inativo não recebe vínculo novo.
    await ok(req('PATCH', `/patrimonio-combustiveis/${s.comb.GNV}`, s.token, { versao: 1, ativo: false }));
    const antesTipo = await fotoPatrimonio([s.c, outro.c]);
    assert.deepEqual(erro(await vincular(s, s.comb.GNV, s.e1.id, daA.id)), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'tipo_combustivel_id', 'tipo_inativo']);
    // Tipo de outro tenant ≡ inexistente; fazenda de outro tenant ≡ inexistente.
    const tipoInexistente = await vincular(s, INEXISTENTE, s.e1.id, daA.id);
    assert.deepEqual(erro(tipoInexistente).slice(0, 2), [404, 'COMBUSTIVEL_NAO_ENCONTRADO']);
    assert.deepEqual(corpoErro(await vincular(s, outro.comb.DIESEL_S10, s.e1.id, daA.id)), corpoErro(tipoInexistente));
    assert.deepEqual(corpoErro(await req('GET', urlVinculos(outro.comb.DIESEL_S10, s.e1.id), s.token)), corpoErro(await req('GET', urlVinculos(INEXISTENTE, s.e1.id), s.token)));
    const fazendaInexistente = await vincular(s, s.comb.DIESEL_S10, INEXISTENTE, daA.id);
    assert.deepEqual(erro(fazendaInexistente).slice(0, 2), [404, 'EMPRESA_NOT_FOUND']);
    assert.deepEqual(corpoErro(await vincular(s, s.comb.DIESEL_S10, outro.e1.id, daA.id)), corpoErro(fazendaInexistente));
    assert.deepEqual(corpoErro(await req('GET', urlVinculos(s.comb.DIESEL_S10, outro.e1.id), s.token)), corpoErro(await req('GET', urlVinculos(s.comb.DIESEL_S10, INEXISTENTE), s.token)));

    const depois = await fotoPatrimonio([s.c, outro.c]);
    assert.equal(depois, antesTipo, 'nenhuma recusa gravou nada');
    assert.notEqual(antes, antesTipo, 'só a inativação do GNV gravou');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('V2 — regras do vínculo, CAS e 404 sem oráculo', () => {
  test('par repetido → 409 DUPLICADO (inativo: reason inativo_reative + vinculo_id); produto em dois tipos → 409 EM_OUTRO_TIPO; inativar libera o produto; reativar com conflito → 409; CAS → 409; no-op não grava', async () => {
    const s = await montarPatrimonio(app);
    const prod = await produtoNovo(s, s.e1, 'DIESEL A GRANEL');
    const v = await vincularOk(s, s.comb.DIESEL_S10, s.e1.id, prod.id);

    const dup = await vincular(s, s.comb.DIESEL_S10, s.e1.id, prod.id);
    assert.deepEqual(erro(dup), [409, 'COMBUSTIVEL_PRODUTO_DUPLICADO', 'produto_id', 'ja_vinculado']);
    const outroTipo = await vincular(s, s.comb.DIESEL_S500, s.e1.id, prod.id);
    assert.deepEqual(erro(outroTipo), [409, 'COMBUSTIVEL_PRODUTO_EM_OUTRO_TIPO', 'produto_id', 'vinculado_a_outro_tipo']);
    assert.deepEqual(outroTipo.json().details, { tipo_combustivel_id: s.comb.DIESEL_S10 }, 'um produto não é Diesel S10 e S500 ao mesmo tempo');

    // CAS e no-op.
    const conflito = await alterar(s, v.id, { empresa_id: s.e1.id, versao: 7, ativo: false });
    assert.deepEqual(erro(conflito).slice(0, 2), [409, 'PATRIMONIO_VERSAO_CONFLITO']);
    assert.deepEqual(conflito.json().details, { versao_atual: 1, versao_informada: 7 });
    const auditAntes = await prisma().auditLog.count({ where: { cliente_id: s.c, entidade: 'TipoCombustivelProduto' } });
    const noop = await ok(alterar(s, v.id, { empresa_id: s.e1.id, versao: 1, ativo: true }));
    assert.equal(noop.versao, 1, 'sem mudança efetiva: nada gravado');
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: s.c, entidade: 'TipoCombustivelProduto' } }), auditAntes);

    // Inativar: o histórico fica (rastreável) e o produto fica livre para outro tipo.
    const inativo = await ok(alterar(s, v.id, { empresa_id: s.e1.id, versao: 1, ativo: false }));
    assert.deepEqual(inativo, vinculoEsperado({ ...v, updated_date: inativo.updated_date }, { empresaId: s.e1.id, tipoId: s.comb.DIESEL_S10, produto: prod, ativo: false, versao: 2 }));
    const reuso = await vincular(s, s.comb.DIESEL_S10, s.e1.id, prod.id);
    assert.deepEqual(erro(reuso), [409, 'COMBUSTIVEL_PRODUTO_DUPLICADO', 'produto_id', 'inativo_reative']);
    assert.deepEqual(reuso.json().details, { vinculo_id: v.id }, 'reativa-se o existente, nunca outro par');
    const s500 = await vincularOk(s, s.comb.DIESEL_S500, s.e1.id, prod.id);
    const reativar = await alterar(s, v.id, { empresa_id: s.e1.id, versao: 2, ativo: true });
    assert.deepEqual(erro(reativar), [409, 'COMBUSTIVEL_PRODUTO_EM_OUTRO_TIPO', 'produto_id', 'vinculado_a_outro_tipo']);
    assert.deepEqual(reativar.json().details, { tipo_combustivel_id: s.comb.DIESEL_S500 });
    assert.equal((await prisma().tipoCombustivelProduto.findUnique({ where: { id: v.id } }))?.ativo, false, 'nada gravado');

    // Liberado o S500, o S10 reativa (versão sobe uma vez por PATCH efetivo).
    await ok(alterar(s, s500.id, { empresa_id: s.e1.id, versao: 1, ativo: false }));
    const reativado = await ok(alterar(s, v.id, { empresa_id: s.e1.id, versao: 2, ativo: true }));
    assert.deepEqual([reativado.ativo, reativado.versao], [true, 3]);
    // Dois vínculos INATIVOS do mesmo produto convivem (NULL não colide); só um ativo.
    const linhas = await prisma().tipoCombustivelProduto.findMany({ where: { cliente_id: s.c, produto_id: prod.id }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(linhas.map((l) => [l.tipo_combustivel_id, l.ativo, l.ativo_chave]), [[s.comb.DIESEL_S10, true, true], [s.comb.DIESEL_S500, false, null]]);
    // Filtro por situação na lista.
    assert.deepEqual((await ok(req('GET', urlVinculos(s.comb.DIESEL_S500, s.e1.id, '&ativo=false'), s.token))).items.map((i) => i.id), [s500.id]);
    assert.deepEqual((await ok(req('GET', urlVinculos(s.comb.DIESEL_S500, s.e1.id, '&ativo=true'), s.token))).items, []);
  });

  test('reativar exige tipo ativo, produto ativo e da MESMA fazenda (mesmas regras/códigos do POST); inativar produto é permitido e mantém o vínculo rastreável', async () => {
    const s = await montarPatrimonio(app);
    const prod = await produtoNovo(s, s.e1, 'GASOLINA COMUM');
    const v = await vincularOk(s, s.comb.GASOLINA, s.e1.id, prod.id);
    await ok(alterar(s, v.id, { empresa_id: s.e1.id, versao: 1, ativo: false }));

    // Produto inativo (permitido na tela de Produtos): o vínculo fica, mas não reativa.
    await ok(req('PATCH', `/produtos/${prod.id}`, s.token, { ativo: false }));
    assert.deepEqual(erro(await alterar(s, v.id, { empresa_id: s.e1.id, versao: 2, ativo: true })), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'inativo']);
    const lista = await ok(req('GET', urlVinculos(s.comb.GASOLINA, s.e1.id), s.token));
    assert.deepEqual([lista.items[0].id, lista.items[0].produto.ativo], [v.id, false], 'rastreável');
    await ok(req('PATCH', `/produtos/${prod.id}`, s.token, { ativo: true }));

    // Produto movido de fazenda (vínculo inativo não segura a troca): reativar → outra_empresa; a lista o rotula.
    await ok(req('PATCH', `/produtos/${prod.id}`, s.token, { empresa_id: s.e2.id }));
    assert.deepEqual(erro(await alterar(s, v.id, { empresa_id: s.e1.id, versao: 2, ativo: true })), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'outra_empresa']);
    const movido = await ok(req('GET', urlVinculos(s.comb.GASOLINA, s.e1.id), s.token));
    assert.deepEqual([movido.items[0].id, movido.items[0].produto.empresa_coerente], [v.id, false], 'empresa incoerente: rastreável e nunca elegível');
    await ok(req('PATCH', `/produtos/${prod.id}`, s.token, { empresa_id: s.e1.id }));

    // Tipo inativo não reativa vínculo.
    await ok(req('PATCH', `/patrimonio-combustiveis/${s.comb.GASOLINA}`, s.token, { versao: 1, ativo: false }));
    assert.deepEqual(erro(await alterar(s, v.id, { empresa_id: s.e1.id, versao: 2, ativo: true })), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'tipo_combustivel_id', 'tipo_inativo']);
    assert.equal((await prisma().tipoCombustivelProduto.findUnique({ where: { id: v.id } }))?.versao, 2, 'nenhuma recusa gravou');
  });

  test('PATCH: vínculo de outra fazenda, de outro tenant ou inexistente → o MESMO 404 COMBUSTIVEL_PRODUTO_NAO_ENCONTRADO; nada gravado', async () => {
    const s = await montarPatrimonio(app);
    const outro = await montarPatrimonio(app);
    const prod = await produtoNovo(s, s.e1, 'ETANOL HIDRATADO');
    const prodOutro = await produtoNovo(outro, outro.e1, 'ETANOL OUTRO');
    const v = await vincularOk(s, s.comb.ETANOL, s.e1.id, prod.id);
    const vOutro = await ok(vincular(outro, outro.comb.ETANOL, outro.e1.id, prodOutro.id), 201);
    const antes = await fotoPatrimonio([s.c, outro.c]);
    const corpo = { versao: 1, ativo: false };
    const base = await alterar(s, INEXISTENTE, { empresa_id: s.e1.id, ...corpo });
    assert.deepEqual(erro(base).slice(0, 2), [404, 'COMBUSTIVEL_PRODUTO_NAO_ENCONTRADO']);
    assert.deepEqual(corpoErro(await alterar(s, v.id, { empresa_id: s.e2.id, ...corpo })), corpoErro(base), 'outra fazenda ≡ inexistente');
    assert.deepEqual(corpoErro(await alterar(s, vOutro.id, { empresa_id: s.e1.id, ...corpo })), corpoErro(base), 'outro tenant ≡ inexistente');
    assert.equal(await fotoPatrimonio([s.c, outro.c]), antes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('V3 — concorrência e corridas com o Produto', () => {
  test('POST duplicado em paralelo → [201, 409 DUPLICADO]; produto em dois tipos em paralelo → [201, 409 EM_OUTRO_TIPO]; uma linha', async () => {
    const s = await montarPatrimonio(app);
    const a = await produtoNovo(s, s.e1, 'DIESEL CORRIDA A');
    const b = await produtoNovo(s, s.e1, 'DIESEL CORRIDA B');
    const par = await Promise.all([vincular(s, s.comb.DIESEL_S10, s.e1.id, a.id), vincular(s, s.comb.DIESEL_S10, s.e1.id, a.id)]);
    assert.deepEqual(par.map((r) => r.statusCode).sort(), [201, 409], par.map((r) => r.body).join(' | '));
    assert.equal(par.find((r) => r.statusCode === 409)?.json().code, 'COMBUSTIVEL_PRODUTO_DUPLICADO');
    assert.equal(await prisma().tipoCombustivelProduto.count({ where: { cliente_id: s.c, produto_id: a.id } }), 1);

    const dois = await Promise.all([vincular(s, s.comb.DIESEL_S10, s.e1.id, b.id), vincular(s, s.comb.DIESEL_S500, s.e1.id, b.id)]);
    assert.deepEqual(dois.map((r) => r.statusCode).sort(), [201, 409], dois.map((r) => r.body).join(' | '));
    const perdedor = /** @type {any} */ (dois.find((r) => r.statusCode === 409));
    const vencedor = /** @type {any} */ (dois.find((r) => r.statusCode === 201));
    assert.equal(perdedor.json().code, 'COMBUSTIVEL_PRODUTO_EM_OUTRO_TIPO');
    assert.deepEqual(perdedor.json().details, { tipo_combustivel_id: vencedor.json().tipo_combustivel_id });
    assert.equal(await prisma().tipoCombustivelProduto.count({ where: { cliente_id: s.c, produto_id: b.id, ativo: true } }), 1);
  });

  // ─── corridas com portão (gatilho na auditoria): segura UMA transação depois
  // das escritas e antes do commit; o teste observa as travas no banco.
  /** @type {PrismaClient} */
  let aux;
  before(() => {
    aux = new PrismaClient();
  });
  after(async () => {
    await aux?.$disconnect();
  });
  const PORTAO = 'patrimonio_r2_portao';
  const instalarPortao = async (clienteId, entidade) => {
    const p = prisma();
    await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${PORTAO}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_advisory_xact_lock_shared(157, 1); RETURN NEW; END $f$`);
    await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "AuditLog"`);
    await p.$executeRawUnsafe(
      `CREATE TRIGGER ${PORTAO} BEFORE INSERT ON "AuditLog" FOR EACH ROW WHEN (NEW.cliente_id = '${clienteId}' AND NEW.entidade = '${entidade}') EXECUTE FUNCTION ${PORTAO}()`
    );
  };
  const removerPortao = () => prisma().$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "AuditLog"`);
  const paradoNoPortao = async () => {
    const l = /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = 157 AND objid = 1 AND objsubid = 2 AND NOT granted`);
    return l.length ? l[0].pid : null;
  };
  const alguemEsperando = async (pid) => {
    const l = /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND ${pid}::int = ANY(pg_blocking_pids(pid))`);
    return l.length ? l[0].pid : null;
  };
  const esperar = async (cond, rotulo, ms = 4000) => {
    const limite = Date.now() + ms;
    for (;;) {
      const v = await cond();
      if (v) return v;
      if (Date.now() > limite) throw new Error(`tempo esgotado esperando: ${rotulo}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  /** `primeiro` para no portão (gravou, não confirmou); `segundo` espera a trava dele; o portão abre. */
  const emCorrida = async (clienteId, entidade, primeiro, segundo) => {
    await instalarPortao(clienteId, entidade);
    try {
      /** @type {Array<Promise<any>>} */
      const pedidos = [];
      await aux.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(157, 1)`;
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

  test('corrida exclusão do produto × vínculo: vínculo em voo segura o produto (DELETE → 409 PRODUTO_DELETE_BLOCKED, não 403); exclusão em voo some com ele (POST → 422 inexistente)', async () => {
    const s = await montarPatrimonio(app);
    const p = prisma();
    const p1 = await produtoNovo(s, s.e1, 'DIESEL EM VOO');
    const [vinculo, exclusao] = await emCorrida(
      s.c,
      'TipoCombustivelProduto',
      () => vincular(s, s.comb.DIESEL_S10, s.e1.id, p1.id),
      () => req('DELETE', `/produtos/${p1.id}`, s.token)
    );
    assert.equal(vinculo.statusCode, 201, vinculo.body);
    assert.deepEqual(erro(exclusao).slice(0, 2), [409, 'PRODUTO_DELETE_BLOCKED'], exclusao.body);
    assert.equal(exclusao.json().details.vinculo, 'combustíveis do patrimônio');
    assert.ok(await p.produto.findUnique({ where: { id: p1.id } }), 'produto intacto');

    const p2 = await produtoNovo(s, s.e1, 'DIESEL QUE SAI');
    const [saida, recusado] = await emCorrida(
      s.c,
      'Produto',
      () => req('DELETE', `/produtos/${p2.id}`, s.token),
      () => vincular(s, s.comb.DIESEL_S10, s.e1.id, p2.id)
    );
    assert.equal(saida.statusCode, 204, saida.body);
    assert.deepEqual(erro(recusado), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'inexistente'], recusado.body);
    assert.equal(await p.tipoCombustivelProduto.count({ where: { cliente_id: s.c, produto_id: p2.id } }), 0);
  });

  test('corrida troca de fazenda do produto × vínculo: vínculo em voo → PATCH do produto 409 PRODUTO_VINCULADO_COMBUSTIVEL; troca em voo → POST 422 outra_empresa; nunca vínculo ativo incoerente', async () => {
    const s = await montarPatrimonio(app);
    const p = prisma();
    const p1 = await produtoNovo(s, s.e1, 'GASOLINA EM VOO');
    const [vinculo, troca] = await emCorrida(
      s.c,
      'TipoCombustivelProduto',
      () => vincular(s, s.comb.GASOLINA, s.e1.id, p1.id),
      () => req('PATCH', `/produtos/${p1.id}`, s.token, { empresa_id: s.e2.id })
    );
    assert.equal(vinculo.statusCode, 201, vinculo.body);
    assert.deepEqual(erro(troca).slice(0, 2), [409, 'PRODUTO_VINCULADO_COMBUSTIVEL'], troca.body);
    assert.equal((await p.produto.findUnique({ where: { id: p1.id } }))?.empresa_id, s.e1.id, 'nada gravado');

    const p2 = await produtoNovo(s, s.e1, 'GASOLINA QUE MUDA');
    const [mudou, recusado] = await emCorrida(
      s.c,
      'Produto',
      () => req('PATCH', `/produtos/${p2.id}`, s.token, { empresa_id: s.e2.id }),
      () => vincular(s, s.comb.GASOLINA, s.e1.id, p2.id)
    );
    assert.equal(mudou.statusCode, 200, mudou.body);
    assert.deepEqual(erro(recusado), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'outra_empresa'], recusado.body);
    // Invariante: todo vínculo ATIVO aponta para produto da MESMA fazenda.
    const incoerentes = /** @type {any[]} */ (await p.$queryRaw`
      SELECT v.id FROM "TipoCombustivelProduto" v JOIN "Produto" pr ON pr.cliente_id = v.cliente_id AND pr.id = v.produto_id
       WHERE v.cliente_id = ${s.c} AND v.ativo AND pr.empresa_id <> v.empresa_id`);
    assert.deepEqual(incoerentes, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('V4 — Produto (tabela antiga) com vínculo', () => {
  test('excluir produto com vínculo ativo OU inativo → 409 PRODUTO_DELETE_BLOCKED (não 403); mudar a fazenda com vínculo ATIVO → 409 PRODUTO_VINCULADO_COMBUSTIVEL sem gravar; renomear/inativar segue permitido', async () => {
    const s = await montarPatrimonio(app);
    const p = prisma();
    const prod = await produtoNovo(s, s.e1, 'DIESEL VINCULADO');
    const v = await vincularOk(s, s.comb.DIESEL_S10, s.e1.id, prod.id);
    const antes = await p.produto.findUnique({ where: { id: prod.id } });

    const del = await req('DELETE', `/produtos/${prod.id}`, s.token);
    assert.deepEqual(erro(del).slice(0, 2), [409, 'PRODUTO_DELETE_BLOCKED'], del.body);
    assert.deepEqual(del.json().details, { id: prod.id, vinculo: 'combustíveis do patrimônio', quantidade: 1 });

    const troca = await req('PATCH', `/produtos/${prod.id}`, s.token, { empresa_id: s.e2.id, nome_produto: 'NOME NOVO' });
    assert.deepEqual(erro(troca).slice(0, 2), [409, 'PRODUTO_VINCULADO_COMBUSTIVEL'], troca.body);
    assert.equal(JSON.stringify(await p.produto.findUnique({ where: { id: prod.id } })), JSON.stringify(antes), 'nada gravado (nem o nome)');
    // Mesma fazenda no corpo não é troca.
    assert.equal((await ok(req('PATCH', `/produtos/${prod.id}`, s.token, { empresa_id: s.e1.id, nome_produto: 'DIESEL RENOMEADO' }))).nome_produto, 'DIESEL RENOMEADO');
    assert.equal((await ok(req('PATCH', `/produtos/${prod.id}`, s.token, { ativo: false }))).ativo, false, 'inativar o produto é permitido');

    // Vínculo inativo: a troca passa (rastreável, incoerente), mas a exclusão continua bloqueada.
    await ok(alterar(s, v.id, { empresa_id: s.e1.id, versao: 1, ativo: false }));
    assert.equal((await ok(req('PATCH', `/produtos/${prod.id}`, s.token, { empresa_id: s.e2.id }))).empresa_id, s.e2.id);
    const del2 = await req('DELETE', `/produtos/${prod.id}`, s.token);
    assert.deepEqual(erro(del2).slice(0, 2), [409, 'PRODUTO_DELETE_BLOCKED'], del2.body);
    assert.ok(await p.produto.findUnique({ where: { id: prod.id } }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('V5 — produtos elegíveis do bem (contrato de leitura para a P1-02)', () => {
  test('TP-02 diesel S10 → só os produtos S10 da fazenda (S500 não); flex UT-04 → só gasolina e etanol, com o tipo de cada; sem vínculo → vazio; tanque informado filtra; sem preço, saldo ou custo', async () => {
    const s = await montarPatrimonio(app);
    const granel = await produtoNovo(s, s.e1, 'DIESEL S10 A GRANEL', { preco_custo: 6.19, estoque_atual: 1000 });
    const posto = await produtoNovo(s, s.e1, 'DIESEL S10 POSTO');
    const s500 = await produtoNovo(s, s.e1, 'DIESEL S500');
    const gasolina = await produtoNovo(s, s.e1, 'GASOLINA COMUM');
    const etanol = await produtoNovo(s, s.e1, 'ETANOL HIDRATADO');
    const daB = await produtoNovo(s, s.e2, 'DIESEL S10 DA B');
    for (const [tipo, prod, emp] of [
      [s.comb.DIESEL_S10, granel, s.e1], [s.comb.DIESEL_S10, posto, s.e1], [s.comb.DIESEL_S500, s500, s.e1],
      [s.comb.GASOLINA, gasolina, s.e1], [s.comb.ETANOL, etanol, s.e1], [s.comb.DIESEL_S10, daB, s.e2],
    ]) await vincularOk(s, tipo, emp.id, prod.id);
    const trator = await criarBem(s, corpoTrator(s));
    const caminhonete = await criarBem(s, corpoCaminhonete(s));
    const tanqueTrator = trator.tanques[0];
    const tanqueFlex = caminhonete.tanques[0];
    const item = (tanque, tipoId, tipoNome, prod) => ({
      tanque_id: tanque.id, tanque_identificador: tanque.identificador, tipo_combustivel_id: tipoId, tipo_combustivel_nome: tipoNome,
      produto_id: prod.id, produto_nome: prod.nome_produto, unidade_principal_estoque: prod.unidade_principal_estoque, empresa_id: s.e1.id,
    });
    const foraAntes = await contagemForaDoPatrimonio(s.c);

    assert.deepEqual(await ok(elegiveis(s, trator.id, s.e1.id)), {
      itens: [item(tanqueTrator, s.comb.DIESEL_S10, 'Diesel S10', granel), item(tanqueTrator, s.comb.DIESEL_S10, 'Diesel S10', posto)],
    }, 'S10 no tanque: os dois produtos S10 da fazenda; o S500 nunca');
    assert.deepEqual(await ok(elegiveis(s, caminhonete.id, s.e1.id, `&tanque_id=${tanqueFlex.id}`)), {
      itens: [item(tanqueFlex, s.comb.ETANOL, 'Etanol', etanol), item(tanqueFlex, s.comb.GASOLINA, 'Gasolina', gasolina)],
    }, 'flex: só os produtos de gasolina e etanol, identificando o combustível de cada');

    // Mesmo bem-tipo na fazenda B sem vínculo de B para o tipo do tanque → vazio (nunca "todos os produtos").
    const tratorB = await criarBem(s, corpoTrator(s, { empresa_id: s.e2.id, tanques: [{ identificador: 'Tanque', capacidade_litros: '200', combustivel_ids: [s.comb.DIESEL_S500] }] }));
    assert.deepEqual(await ok(elegiveis(s, tratorB.id, s.e2.id)), { itens: [] });
    assert.deepEqual(await contagemForaDoPatrimonio(s.c), foraAntes, 'leitura pura');
  });

  test('produto inativo, vínculo inativo, tipo inativo e produto em outra fazenda saem dos elegíveis (mas o vínculo segue rastreável na lista); tanque inativo não oferece nada', async () => {
    const s = await montarPatrimonio(app);
    const p = prisma();
    const granel = await produtoNovo(s, s.e1, 'DIESEL S10 A GRANEL');
    const posto = await produtoNovo(s, s.e1, 'DIESEL S10 POSTO');
    const terceiro = await produtoNovo(s, s.e1, 'DIESEL S10 TERCEIRO');
    const vGranel = await vincularOk(s, s.comb.DIESEL_S10, s.e1.id, granel.id);
    const vPosto = await vincularOk(s, s.comb.DIESEL_S10, s.e1.id, posto.id);
    const vTerceiro = await vincularOk(s, s.comb.DIESEL_S10, s.e1.id, terceiro.id);
    const trator = await criarBem(s, corpoTrator(s));
    const ids = async () => (await ok(elegiveis(s, trator.id, s.e1.id))).itens.map((i) => i.produto_id);
    assert.deepEqual(await ids(), [granel.id, posto.id, terceiro.id]);

    await ok(req('PATCH', `/produtos/${granel.id}`, s.token, { ativo: false }));
    await ok(alterar(s, vPosto.id, { empresa_id: s.e1.id, versao: 1, ativo: false }));
    // Defesa em profundidade: mesmo se a coerência de fazenda fosse violada por fora do serviço
    // (SQL direto), o vínculo ATIVO com produto de outra fazenda nunca é elegível.
    await p.$executeRaw`UPDATE "Produto" SET empresa_id = ${s.e2.id} WHERE id = ${terceiro.id}`;
    assert.deepEqual(await ids(), [], 'nenhum elegível — e nunca "todos os produtos"');
    const lista = await ok(req('GET', urlVinculos(s.comb.DIESEL_S10, s.e1.id), s.token));
    const porId = Object.fromEntries(lista.items.map((i) => [i.id, i]));
    assert.deepEqual(
      [vGranel.id, vPosto.id, vTerceiro.id].map((id) => [porId[id].ativo, porId[id].produto.ativo, porId[id].produto.empresa_coerente]),
      [[true, false, true], [false, true, true], [true, true, false]],
      'os três seguem rastreáveis, rotulados'
    );
    await p.$executeRaw`UPDATE "Produto" SET empresa_id = ${s.e1.id} WHERE id = ${terceiro.id}`;
    assert.deepEqual(await ids(), [terceiro.id]);
    // Tipo inativo no catálogo: não é selecionável para operação nova.
    await ok(req('PATCH', `/patrimonio-combustiveis/${s.comb.DIESEL_S10}`, s.token, { versao: 1, ativo: false }));
    assert.deepEqual(await ids(), []);
    await ok(req('PATCH', `/patrimonio-combustiveis/${s.comb.DIESEL_S10}`, s.token, { versao: 2, ativo: true }));
    assert.deepEqual(await ids(), [terceiro.id]);
    // Tanque inativo: nada (nem com o tanque informado).
    const tanque = trator.tanques[0];
    await ok(req('PATCH', `/bens-patrimoniais/${trator.id}`, s.token, {
      empresa_id: s.e1.id, versao: trator.versao,
      tanques: [{ id: tanque.id, identificador: tanque.identificador, capacidade_litros: '180', combustivel_ids: [s.comb.DIESEL_S10], ativo: false }],
    }));
    assert.deepEqual(await ids(), []);
    assert.deepEqual((await ok(elegiveis(s, trator.id, s.e1.id, `&tanque_id=${tanque.id}`))).itens, []);
  });

  test('bem de outra fazenda, de outro tenant ou inexistente → 404 uniforme; tanque de outro bem → 404; fazenda de outro tenant → 404', async () => {
    const s = await montarPatrimonio(app);
    const outro = await montarPatrimonio(app);
    const trator = await criarBem(s, corpoTrator(s));
    const caminhonete = await criarBem(s, corpoCaminhonete(s));
    const doOutro = await criarBem(outro, corpoTrator(outro));
    const base = await elegiveis(s, INEXISTENTE, s.e1.id);
    assert.deepEqual(erro(base).slice(0, 2), [404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO']);
    assert.deepEqual(corpoErro(await elegiveis(s, trator.id, s.e2.id)), corpoErro(base), 'outra fazenda');
    assert.deepEqual(corpoErro(await elegiveis(s, doOutro.id, s.e1.id)), corpoErro(base), 'outro tenant');
    const tanqueAlheio = await elegiveis(s, trator.id, s.e1.id, `&tanque_id=${caminhonete.tanques[0].id}`);
    assert.deepEqual(erro(tanqueAlheio), [404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO', 'tanque_id', 'tanque_inexistente']);
    assert.deepEqual(corpoErro(await elegiveis(s, trator.id, s.e1.id, `&tanque_id=${doOutro.tanques[0].id}`)), corpoErro(tanqueAlheio));
    assert.deepEqual(corpoErro(await elegiveis(s, trator.id, outro.e1.id)), corpoErro(await elegiveis(s, trator.id, INEXISTENTE)));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('V6 — opções de produtos da fazenda', () => {
  test('só produtos ATIVOS da fazenda, busca por nome/código, keyset (nome, id) e o vínculo ativo de cada um indicado', async () => {
    const s = await montarPatrimonio(app);
    const granel = await produtoNovo(s, s.e1, 'DIESEL S10 A GRANEL', { codigo_interno: 'D10G' });
    const gasolina = await produtoNovo(s, s.e1, 'GASOLINA COMUM');
    const racao = await produtoNovo(s, s.e1, 'RAÇÃO 22%');
    await produtoNovo(s, s.e1, 'DIESEL ANTIGO', { ativo: false });
    await produtoNovo(s, s.e2, 'DIESEL DA FAZENDA B');
    await vincularOk(s, s.comb.DIESEL_S10, s.e1.id, granel.id);
    const r = await ok(opcoes(s, s.e1.id));
    assert.deepEqual(r, {
      itens: [
        { id: granel.id, nome: 'DIESEL S10 A GRANEL', unidade_principal_estoque: 'KG', vinculo_ativo: { tipo_combustivel_id: s.comb.DIESEL_S10, tipo_nome: 'Diesel S10' } },
        { id: gasolina.id, nome: 'GASOLINA COMUM', unidade_principal_estoque: 'KG', vinculo_ativo: null },
        { id: racao.id, nome: 'RAÇÃO 22%', unidade_principal_estoque: 'KG', vinculo_ativo: null },
      ],
      has_more: false,
      next_cursor: null,
    });
    assert.deepEqual((await ok(opcoes(s, s.e1.id, '&q=d10g'))).itens.map((i) => i.id), [granel.id], 'busca pelo código interno');
    assert.deepEqual((await ok(opcoes(s, s.e1.id, '&q=gasol'))).itens.map((i) => i.id), [gasolina.id]);
    assert.deepEqual((await ok(opcoes(s, s.e1.id, '&q=%25'))).itens.map((i) => i.id), [racao.id], 'busca literal (% não casa tudo)');
    const p1 = await ok(opcoes(s, s.e1.id, '&limit=2'));
    assert.equal(p1.has_more, true);
    const p2 = await ok(opcoes(s, s.e1.id, `&limit=2&cursor=${encodeURIComponent(p1.next_cursor)}`));
    assert.deepEqual([...p1.itens, ...p2.itens].map((i) => i.id), [granel.id, gasolina.id, racao.id]);
    assert.deepEqual(erro(await opcoes(s, s.e1.id, '&cursor=xx')).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED']);
    assert.deepEqual(erro(await opcoes(s, INEXISTENTE)).slice(0, 2), [404, 'EMPRESA_NOT_FOUND']);
    assert.deepEqual(erro(await req('GET', '/patrimonio-combustiveis-opcoes/produtos', s.token)).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], 'empresa obrigatória');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('V7 — permissões e corpo fechado', () => {
  test('401 sem sessão; 403 por ação (ver/criar/editar/inativar da tela Combustíveis; elegíveis = ver dos bens); opções = criar OU editar', async () => {
    const s = await montarPatrimonio(app);
    const prod = await produtoNovo(s, s.e1, 'DIESEL PERMISSÕES');
    const outroProd = await produtoNovo(s, s.e1, 'DIESEL PERMISSÕES 2');
    const v = await vincularOk(s, s.comb.DIESEL_S10, s.e1.id, prod.id);
    const trator = await criarBem(s, corpoTrator(s));
    const T = TELAS.combustiveis;
    const rotas = [
      ['GET', urlVinculos(s.comb.DIESEL_S10, s.e1.id)],
      ['POST', `/patrimonio-combustiveis/${s.comb.DIESEL_S10}/produtos`, { empresa_id: s.e1.id, produto_id: outroProd.id }],
      ['PATCH', `/patrimonio-combustivel-produtos/${v.id}`, { empresa_id: s.e1.id, versao: 1, ativo: false }],
      ['GET', `/patrimonio-combustiveis-opcoes/produtos?empresa_id=${s.e1.id}`],
      ['GET', `/bens-patrimoniais/${trator.id}/produtos-elegiveis?empresa_id=${s.e1.id}`],
    ];
    for (const [m, url, corpo] of rotas) assert.equal((await req(m, url, null, corpo)).statusCode, 401, `${m} ${url}`);

    const status = async (conta) => {
      const out = [];
      for (const [m, url, corpo] of rotas) out.push((await req(m, url, conta.token, corpo)).statusCode);
      return out;
    };
    const so = (acoes) => s.contaCom(linha(T, acoes));
    const antes = await fotoPatrimonio(s.c);
    assert.deepEqual(await status(await so({ visualizar: true })), [200, 403, 403, 403, 403], 'só ver a tela Combustíveis');
    assert.deepEqual(await status(await so({ visualizar: true, editar: true })), [200, 403, 403, 200, 403], 'editar sem inativar: PATCH de situação 403; opções 200');
    assert.equal(await fotoPatrimonio(s.c), antes, 'nada gravado pelas recusas');
    assert.deepEqual(await status(await s.contaCom(linha(TELAS.bens, { visualizar: true }))), [403, 403, 403, 403, 200], 'só ver os bens: elegíveis');
    const criador = await so({ visualizar: true, novo: true });
    const r = await status(criador);
    assert.deepEqual(r, [200, 201, 403, 200, 403], 'novo: cria e lista opções; não inativa');
    const inativador = await s.contaCom(linha(T, { visualizar: true, inativar: true }));
    assert.equal((await req('PATCH', `/patrimonio-combustivel-produtos/${v.id}`, inativador.token, { empresa_id: s.e1.id, versao: 1, ativo: false })).statusCode, 200, 'inativar exige a ação extra');
    assert.equal((await req('GET', urlVinculos(s.comb.DIESEL_S10, s.e1.id), (await s.contaCom(tudo(T))).token)).statusCode, 200);
  });

  test('cliente_id, campo extra ou campo imutável no corpo/query → 400 sem efeito', async () => {
    const s = await montarPatrimonio(app);
    const prod = await produtoNovo(s, s.e1, 'DIESEL FECHADO');
    const v = await vincularOk(s, s.comb.DIESEL_S10, s.e1.id, prod.id);
    const antes = await fotoPatrimonio(s.c);
    const recusas = [
      ['POST', `/patrimonio-combustiveis/${s.comb.DIESEL_S10}/produtos`, { empresa_id: s.e1.id, produto_id: prod.id, cliente_id: s.c }],
      ['POST', `/patrimonio-combustiveis/${s.comb.DIESEL_S10}/produtos`, { empresa_id: s.e1.id, produto_id: prod.id, ativo: false }],
      ['POST', `/patrimonio-combustiveis/${s.comb.DIESEL_S10}/produtos`, { produto_id: prod.id }],
      ['PATCH', `/patrimonio-combustivel-produtos/${v.id}`, { empresa_id: s.e1.id, versao: 1, ativo: false, cliente_id: s.c }],
      ['PATCH', `/patrimonio-combustivel-produtos/${v.id}`, { empresa_id: s.e1.id, versao: 1, ativo: false, produto_id: prod.id }],
      ['PATCH', `/patrimonio-combustivel-produtos/${v.id}`, { empresa_id: s.e1.id, versao: 1, ativo: false, tipo_combustivel_id: s.comb.DIESEL_S500 }],
      ['PATCH', `/patrimonio-combustivel-produtos/${v.id}`, { empresa_id: s.e2.id, versao: 1, ativo: false, empresa_destino: s.e2.id }],
      ['PATCH', `/patrimonio-combustivel-produtos/${v.id}`, { empresa_id: s.e1.id, versao: 1 }],
      ['GET', `${urlVinculos(s.comb.DIESEL_S10, s.e1.id)}&cliente_id=${s.c}`],
      ['GET', `/patrimonio-combustiveis-opcoes/produtos?empresa_id=${s.e1.id}&cliente_id=${s.c}`],
      ['GET', `/bens-patrimoniais/${INEXISTENTE}/produtos-elegiveis?empresa_id=${s.e1.id}&preco=1`],
    ];
    for (const [m, url, corpo] of recusas) {
      const r = await req(m, url, s.token, corpo);
      assert.equal(r.statusCode, 400, `${m} ${url} ${JSON.stringify(corpo ?? {})}: ${r.body}`);
    }
    assert.equal(await fotoPatrimonio(s.c), antes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('V8 — banco e auditoria', () => {
  test('CHECK (ativo ⇔ ativo_chave, NULL-safe; versão ≥ 1), uniques (par; um ativo por produto) e FKs compostas com o tenant barram SQL direto', async () => {
    const s = await montarPatrimonio(app);
    const outro = await montarPatrimonio(app);
    const prod = await produtoNovo(s, s.e1, 'DIESEL BANCO');
    const prodOutro = await produtoNovo(outro, outro.e1, 'DIESEL OUTRO BANCO');
    const v = await vincularOk(s, s.comb.DIESEL_S10, s.e1.id, prod.id);
    const p = prisma();
    const antes = await fotoPatrimonio([s.c, outro.c]);
    const recusa = async (sql, padrao, rotulo) => {
      await assert.rejects(() => p.$executeRawUnsafe(sql), (e) => {
        assert.match(`${/** @type {any} */ (e).message} ${JSON.stringify(/** @type {any} */ (e).meta ?? {})}`, padrao, rotulo);
        return true;
      }, rotulo);
    };
    const ins = (cli, emp, tipo, prodId, ativo = 'true', chave = 'true', versao = 1) =>
      `INSERT INTO "TipoCombustivelProduto" (id, cliente_id, empresa_id, tipo_combustivel_id, produto_id, ativo, ativo_chave, versao, "updatedAt") VALUES ('x${randomUUID().replace(/-/g, '').slice(0, 24)}', '${cli}', '${emp}', '${tipo}', '${prodId}', ${ativo}, ${chave}, ${versao}, now())`;
    await recusa(`UPDATE "TipoCombustivelProduto" SET ativo = false WHERE id = '${v.id}'`, /TipoCombustivelProduto_ativo_chave_check/, 'inativo com chave');
    await recusa(`UPDATE "TipoCombustivelProduto" SET ativo_chave = NULL WHERE id = '${v.id}'`, /TipoCombustivelProduto_ativo_chave_check/, 'ativo sem chave (NULL-safe)');
    await recusa(`UPDATE "TipoCombustivelProduto" SET ativo_chave = false WHERE id = '${v.id}'`, /TipoCombustivelProduto_ativo_chave_check/, 'chave false');
    await recusa(`UPDATE "TipoCombustivelProduto" SET versao = 0 WHERE id = '${v.id}'`, /TipoCombustivelProduto_versao_check/, 'versão zero');
    await recusa(ins(s.c, s.e1.id, s.comb.DIESEL_S10, prod.id, 'false', 'NULL'), /23505|duplicate key|TipoCombustivelProduto_par_key/i, 'par repetido');
    await recusa(ins(s.c, s.e1.id, s.comb.DIESEL_S500, prod.id), /23505|duplicate key|TipoCombustivelProduto_produto_ativo_key/i, 'produto ativo em dois tipos');
    // FKs isoladas (vínculo INATIVO: nenhum unique interfere).
    await recusa(ins(s.c, s.e1.id, s.comb.DIESEL_S500, prodOutro.id, 'false', 'NULL'), /foreign key|produto_id_fkey/i, 'produto de outro tenant');
    await recusa(ins(s.c, outro.e1.id, s.comb.DIESEL_S500, prod.id, 'false', 'NULL'), /foreign key|empresa_id_fkey/i, 'fazenda de outro tenant');
    await recusa(ins(s.c, s.e1.id, outro.comb.DIESEL_S500, prod.id, 'false', 'NULL'), /foreign key|tipo_combustivel_id_fkey/i, 'tipo de outro tenant');
    await recusa(`DELETE FROM "Produto" WHERE id = '${prod.id}'`, /foreign key|produto_id_fkey/i, 'produto vinculado não some (RESTRICT)');
    await recusa(`DELETE FROM "TipoCombustivel" WHERE id = '${s.comb.DIESEL_S10}'`, /foreign key/i, 'tipo vinculado não some (RESTRICT)');
    // Inativos (chave NULL) não colidem entre si.
    await p.$executeRawUnsafe(ins(s.c, s.e1.id, s.comb.DIESEL_S500, prod.id, 'false', 'NULL'));
    await p.$executeRawUnsafe(ins(s.c, s.e1.id, s.comb.GASOLINA, prod.id, 'false', 'NULL'));
    assert.equal(await p.tipoCombustivelProduto.count({ where: { cliente_id: s.c, produto_id: prod.id } }), 3);
    await p.tipoCombustivelProduto.deleteMany({ where: { cliente_id: s.c, produto_id: prod.id, ativo: false } });
    assert.equal(await fotoPatrimonio([s.c, outro.c]), antes);
  });

  test('auditoria por allowlist (sem nome do produto) na mesma transação; falha forçada por gatilho → 5xx e NADA gravado (POST, inativar, reativar)', async () => {
    const s = await montarPatrimonio(app);
    const prod = await produtoNovo(s, s.e1, 'DIESEL AUDITADO SENTINELA');
    const v = await vincularOk(s, s.comb.DIESEL_S10, s.e1.id, prod.id);
    await ok(alterar(s, v.id, { empresa_id: s.e1.id, versao: 1, ativo: false }));
    const p = prisma();
    const eventos = await p.auditLog.findMany({ where: { cliente_id: s.c, entidade: 'TipoCombustivelProduto' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(eventos.map((e) => e.acao), ['create', 'update']);
    assert.deepEqual(eventos[0].dados_novos, { id: v.id, empresa_id: s.e1.id, tipo_combustivel_id: s.comb.DIESEL_S10, produto_id: prod.id, ativo: true, versao: 1 });
    assert.deepEqual(eventos[1].dados_anteriores, { id: v.id, empresa_id: s.e1.id, tipo_combustivel_id: s.comb.DIESEL_S10, produto_id: prod.id, ativo: true, versao: 1 });
    assert.deepEqual(eventos[1].dados_novos, { id: v.id, empresa_id: s.e1.id, tipo_combustivel_id: s.comb.DIESEL_S10, produto_id: prod.id, ativo: false, versao: 2, campos_alterados: ['ativo'] });
    assert.ok(!JSON.stringify(eventos).includes('SENTINELA'), 'sem texto livre do produto na auditoria');

    const outroProd = await produtoNovo(s, s.e1, 'DIESEL NAO GRAVA');
    const antes = await fotoPatrimonio(s.c);
    await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION patrimonio_r2_falha_audit() RETURNS trigger AS $$ BEGIN
      IF NEW.entidade = 'TipoCombustivelProduto' THEN RAISE EXCEPTION 'falha forçada'; END IF;
      RETURN NEW; END $$ LANGUAGE plpgsql`);
    await p.$executeRawUnsafe('CREATE TRIGGER patrimonio_r2_falha_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION patrimonio_r2_falha_audit()');
    try {
      for (const [rotulo, pedido] of [
        ['POST', () => vincular(s, s.comb.DIESEL_S500, s.e1.id, outroProd.id)],
        ['reativar', () => alterar(s, v.id, { empresa_id: s.e1.id, versao: 2, ativo: true })],
      ]) {
        const r = await pedido();
        assert.ok(r.statusCode >= 500, `${rotulo}: ${r.statusCode} ${r.body}`);
        assert.equal(r.json().message, 'erro interno');
      }
    } finally {
      await p.$executeRawUnsafe('DROP TRIGGER IF EXISTS patrimonio_r2_falha_audit ON "AuditLog"');
      await p.$executeRawUnsafe('DROP FUNCTION IF EXISTS patrimonio_r2_falha_audit()');
    }
    assert.equal(await fotoPatrimonio(s.c), antes, 'rollback completo');
  });
});
