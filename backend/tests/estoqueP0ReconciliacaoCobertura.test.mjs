/**
 * D-PROD-161 — MAIKE-ESTOQUE-P0-01 R1: reconciliação SOB VOLUME (cobertura
 * limitada, fail-closed), semântica do filtro de local e relevância da
 * evidência do AuditLog. PostgreSQL real; o HTTP é o mesmo GET
 * `/estoque-fisico/reconciliacao` (só o administrador real).
 *
 *  RC  cobertura: a varredura anda por páginas de produto (keyset por id) com
 *      orçamento de linhas e de tempo por chamada; acima do orçamento a
 *      resposta é 200 com `cobertura.completa=false`, `proximo_cursor`,
 *      `resumo.situacao='INCOMPLETO'` e `por_classe.OK=null` (nada é
 *      declarado OK sobre dados parciais). `truncado` continua sendo só o corte
 *      da LISTA de achados pelo `limite`.
 *  RL  filtro de local: o nível produto (I1) é SEMPRE calculado sobre todos os
 *      locais do produto (`cobertura.nivel_produto='todos_os_locais'`); uma
 *      divergência de cache causada por lote de OUTRO local nunca vira OK.
 *  RA  AuditLog benigno (renomeação, custo/fornecedor do lote, nome/preço do
 *      produto, quantidade igual em outro formato, movimento manual) nunca
 *      rebaixa DIVERGENCIA_REAL; só escrita de `estoque_atual` do produto ou de
 *      quantidade/situação/vínculo do lote é evidência de LIMITACAO_LEGADA.
 *  RW  recibo legado casado ao movimento pelo id E pela janela de criação
 *      (mesma transação no caminho legado): fora dela, DADOS_INSUFICIENTES.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, codigo, docCom, montarTenant, opId, prisma } from './gestaoP3Cenario.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoes>} */
let A;
/** @type {PrismaClient} */
let aux;
before(async () => {
  app = await criarApp();
  await app.ready();
  await limparBanco();
  A = acoes(app);
  aux = new PrismaClient();
});
after(async () => {
  await aux?.$disconnect();
  await app.close();
  await encerrar();
});

const ROTA = '/estoque-fisico/reconciliacao';
const MODULO = '../src/modules/estoqueFisico/reconciliacaoEstoque.js';
const URL_SUP = '/movimentacoes-estoque/comandos/saida-suplementacao';
const item = (produto, quantidade, valor_unitario, extra = {}) => ({ produto, quantidade, valor_unitario, ...extra });
const reconciliar = (token, query = {}) => {
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
  return app.inject({ method: 'GET', url: qs ? `${ROTA}?${qs}` : ROTA, headers: token ? { authorization: `Bearer ${token}` } : {} });
};
const relatorio = async (s, query = {}) => {
  const r = await reconciliar(s.token, query);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
/** Serviço direto, com orçamento pequeno (o HTTP usa o orçamento padrão). */
const servico = async (s, filtro = {}, orcamento = undefined) => {
  const { reconciliarEstoque } = await import(MODULO);
  return reconciliarEstoque({ auth: { clienteId: s.c, usuarioId: s.admId, login: s.admLogin }, requestId: `rc-${randomUUID().slice(0, 8)}` }, filtro, orcamento);
};
const achadosDe = (rel, nivel, campo, id) => rel.achados.filter((a) => a.nivel === nivel && a.chave?.[campo] === id);
const classe = (rel, nivel, campo, id) => {
  const lista = achadosDe(rel, nivel, campo, id);
  assert.ok(lista.length <= 1, `um achado por entidade: ${JSON.stringify(lista)}`);
  return lista.length ? [lista[0].classe, lista[0].regra] : null;
};
const chaveDe = (a) => `${a.nivel}|${JSON.stringify(a.chave)}|${a.classe}|${a.regra}`;
const definirEstoqueAtual = (s, produto, valor) =>
  prisma().produto.update({ where: { cliente_id_id: { cliente_id: s.c, id: produto.id } }, data: { estoque_atual: valor } });
const auditoria = (s, dados) =>
  prisma().auditLog.create({ data: { cliente_id: s.c, usuario_id: s.admId, request_id: `req-${randomUUID().slice(0, 8)}`, ...dados } });
let seq = 0;
const movimento = (s, e, produto, dados) =>
  prisma().movimentacaoEstoque.create({
    data: {
      cliente_id: s.c, empresa_id: e.id, produto_id: produto.id, produto_nome: produto.nome_produto, unidade_medida: 'KG',
      data_movimentacao: new Date('2027-06-11T12:00:00.000Z'), numero_movimentacao: `RC-${(seq += 1)}-${randomUUID().slice(0, 6)}`, status: 'Ativa', ...dados,
    },
  });
const recibo = (s, tipo, corpo) =>
  prisma().operacaoIdempotente.create({
    data: { cliente_id: s.c, operation_key: opId(), tipo_operacao: tipo, fingerprint: randomUUID().replace(/-/g, ''), status: 'committed', http_status: 201, response_json: corpo },
  });

/** Tenant com dados nos 6 produtos (compra + venda em cada) e UMA divergência real no último produto em ordem de id. */
const tenantComSeisProdutos = async () => {
  const s = await montarTenant(app);
  const produtos = [s.e1.sal, s.e1.racao, s.e1.milho, s.e2.sal, s.e2.racao, s.e2.milho].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const p of produtos) {
    const e = p.empresa_id === s.e1.id ? s.e1 : s.e2;
    await A.criarConfirmar(s.token, docCom(e, s.local, [item(p, '10', '2.00')]));
    await A.criarConfirmar(s.token, docCom(e, s.local, [item(p, '3', '5.00')], { direcao: 'RECEBER' }));
  }
  return { s, produtos };
};

// ─────────────────────────────────────────────────────────────────────────────
describe('RC — cobertura limitada, cursor keyset e fail-closed', () => {
  test('RC1: orçamento estourado → 200 INCOMPLETO (OK=null, proximo_cursor); as páginas somadas = a chamada completa; o HTTP aceita o cursor emitido', async () => {
    const { s, produtos } = await tenantComSeisProdutos();
    const ultimo = produtos[5];
    await definirEstoqueAtual(s, ultimo, '99'); // cache 7 → 99: DIVERGENCIA_REAL só no último produto
    // lote órfão cujo produto_id cai ENTRE o 3º e o 4º produto: a faixa (desde, ate] de alguma página intermediária o cobre
    const orfao = await prisma().estoqueLoteNota.create({
      data: {
        cliente_id: s.c, empresa_id: s.e1.id, produto_id: `${produtos[2].id}0`, local_estoque_id: s.local.id, custo_unitario: '1', quantidade_entrada: '2',
        quantidade_disponivel: '2', status: 'Disponivel',
      },
    });

    const cheio = await servico(s);
    assert.equal(cheio.cobertura.completa, true, JSON.stringify(cheio.cobertura));
    assert.deepEqual([cheio.cobertura.produtos_no_escopo, cheio.cobertura.produtos_varridos, cheio.cobertura.produtos_restantes, cheio.cobertura.proximo_cursor], [6, 6, 0, null]);
    assert.equal(cheio.cobertura.interrompida_por, null);
    assert.equal(cheio.resumo.situacao, 'COM_ACHADOS');
    assert.equal(typeof cheio.resumo.por_classe.OK, 'number');
    assert.deepEqual(classe(cheio, 'produto', 'produto_id', ultimo.id), ['DIVERGENCIA_REAL', 'cache_diverge']);
    assert.deepEqual(classe(cheio, 'lote', 'lote_id', orfao.id), ['DADOS_INSUFICIENTES', 'produto_inexistente']);

    // 2 produtos por página e orçamento de 1 linha por chamada: para depois da 1ª página
    const orc = { produtosPorPagina: 2, linhasPorChamada: 1 };
    const p1 = await servico(s, {}, orc);
    assert.deepEqual(
      [p1.cobertura.completa, p1.cobertura.interrompida_por, p1.cobertura.produtos_no_escopo, p1.cobertura.produtos_antes_do_cursor, p1.cobertura.produtos_varridos, p1.cobertura.produtos_restantes, p1.cobertura.paginas],
      [false, 'orcamento', 6, 0, 2, 4, 1], JSON.stringify(p1.cobertura));
    assert.equal(typeof p1.cobertura.proximo_cursor, 'string');
    assert.equal(p1.resumo.situacao, 'INCOMPLETO', 'sem achados nas 2 primeiras, mas nunca "consistente" sobre dados parciais');
    assert.equal(p1.resumo.por_classe.OK, null, 'nada é declarado OK sobre dados parciais');
    assert.deepEqual(p1.achados, []);
    assert.equal(p1.truncado, false, 'truncado é só o corte da lista; cobertura é outra coisa');

    // percorre até o fim: cada página continua do cursor anterior
    const paginas = [p1];
    while (paginas.at(-1).cobertura.proximo_cursor) {
      paginas.push(await servico(s, { cursor: paginas.at(-1).cobertura.proximo_cursor }, orc));
      assert.ok(paginas.length <= 6, 'termina');
    }
    assert.equal(paginas.length, 3);
    const fim = paginas.at(-1);
    assert.deepEqual([fim.cobertura.completa, fim.cobertura.produtos_antes_do_cursor, fim.cobertura.produtos_varridos, fim.cobertura.produtos_restantes], [false, 4, 2, 0]);
    assert.equal(fim.resumo.situacao, 'INCOMPLETO', 'a última página sozinha não cobre o escopo inteiro');
    const soma = (k) => paginas.reduce((t, p) => t + p.resumo[k], 0);
    for (const k of ['produtos', 'locais', 'lotes', 'movimentos']) assert.equal(soma(k), cheio.resumo[k], k);
    for (const c of ['DIVERGENCIA_REAL', 'LIMITACAO_LEGADA', 'DADOS_INSUFICIENTES']) assert.equal(paginas.reduce((t, p) => t + p.resumo.por_classe[c], 0), cheio.resumo.por_classe[c], c);
    assert.deepEqual(paginas.flatMap((p) => p.achados).map(chaveDe).sort(), cheio.achados.map(chaveDe).sort());
    assert.equal(paginas.filter((p) => achadosDe(p, 'lote', 'lote_id', orfao.id).length).length, 1, 'o órfão aparece em exatamente uma página');

    // o cursor emitido vale no HTTP (orçamento padrão: vai até o fim a partir dele)
    const http = await relatorio(s, { cursor: p1.cobertura.proximo_cursor });
    assert.deepEqual([http.cobertura.produtos_antes_do_cursor, http.cobertura.produtos_varridos, http.cobertura.proximo_cursor, http.cobertura.completa], [2, 4, null, false]);
    assert.deepEqual(http.achados.map(chaveDe).sort(), cheio.achados.map(chaveDe).sort());
    assert.equal(http.resumo.por_classe.OK, null);
  });

  test('RC2: orçamento de tempo esgotado → para entre páginas (interrompida_por "tempo"); produto mais pesado que a página é varrido sozinho, nunca pulado', async () => {
    const { s } = await tenantComSeisProdutos();
    const tempo = await servico(s, {}, { produtosPorPagina: 1, tempoMs: 0 });
    assert.deepEqual([tempo.cobertura.completa, tempo.cobertura.interrompida_por, tempo.cobertura.produtos_varridos, tempo.cobertura.paginas], [false, 'tempo', 1, 1]);
    assert.equal(tempo.resumo.por_classe.OK, null);

    // orçamento de 1 linha por página: cada página leva 1 produto (todos têm > 1 linha) e a chamada cobre tudo
    const fino = await servico(s, {}, { linhasPorPagina: 1 });
    assert.deepEqual([fino.cobertura.completa, fino.cobertura.paginas, fino.cobertura.produtos_varridos], [true, 6, 6]);
    assert.equal(fino.resumo.situacao, 'CONSISTENTE');
    const cheio = await servico(s);
    assert.deepEqual(fino.resumo, cheio.resumo);
    assert.ok(cheio.cobertura.linhas_previstas >= 6 * 3, JSON.stringify(cheio.cobertura));
  });

  test('RC3: cursor validado (400 field cursor): lixo, base64 sem JSON, versão errada, id inválido, cursor de OUTRO escopo; cursor com id de outro tenant não é oráculo', async () => {
    const { s } = await tenantComSeisProdutos();
    const b = await montarTenant(app);
    const p1 = await servico(s, { empresaId: s.e1.id }, { produtosPorPagina: 1, linhasPorChamada: 1 });
    const cursor = p1.cobertura.proximo_cursor;
    assert.equal(typeof cursor, 'string');
    const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v), 'utf8').toString('base64url');
    const conteudo = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    for (const [rotulo, q] of [
      ['caractere fora do base64url', { cursor: 'abc!' }],
      ['base64 sem JSON', { cursor: b64('nao é json') }],
      ['versão', { empresa_id: s.e1.id, cursor: b64({ ...conteudo, v: 2 }) }],
      ['id inválido', { empresa_id: s.e1.id, cursor: b64({ ...conteudo, apos: 'x y' }) }],
      ['sem empresa (escopo diferente)', { cursor }],
      ['outra empresa', { empresa_id: s.e2.id, cursor }],
      ['com local (escopo diferente)', { empresa_id: s.e1.id, local_estoque_id: s.local.id, cursor }],
      ['grande demais', { cursor: 'a'.repeat(600) }],
    ]) {
      const r = await reconciliar(s.token, q);
      assert.deepEqual([r.statusCode, codigo(r)], [400, 'REQUEST_VALIDATION_FAILED'], `${rotulo}: ${r.body}`);
    }
    const ok = await relatorio(s, { empresa_id: s.e1.id, cursor });
    assert.equal(ok.cobertura.produtos_antes_do_cursor, 1);
    // id de produto de B no cursor: só posiciona o keyset no tenant de A; nada de B aparece
    const deB = await relatorio(s, { cursor: b64({ v: 1, apos: b.e1.sal.id, e: null, p: null, l: null }) });
    const corpo = JSON.stringify(deB);
    for (const idDeB of [b.c, b.e1.id, b.e1.sal.id, b.local.id]) assert.ok(!corpo.includes(idDeB), `id de B (${idDeB}) não aparece`);
  });

  test('RC4: idas ao banco = fixas por chamada + 5 por página (sem N+1 por lote/movimento); plan_cache_mode=force_custom_plan, jit=off e READ ONLY na transação', async () => {
    const { lerReconciliacao } = await import(MODULO);
    const { s } = await tenantComSeisProdutos();
    const medir = async (orcamento) => {
      /** @type {string[]} */
      const chamadas = [];
      let modo = null;
      let recusa = null;
      await aux.$transaction(async (tx) => {
        const proxy = new Proxy(tx, {
          get(alvo, prop) {
            const v = alvo[prop];
            if (prop === '$queryRaw' || prop === '$queryRawUnsafe' || prop === '$executeRaw' || prop === '$executeRawUnsafe') {
              return (...args) => {
                const sql = Array.isArray(args[0]) ? args[0][0] : String(args[0]?.strings?.[0] ?? args[0]);
                chamadas.push(`${String(prop)}:${sql.trim().replace(/\s+/g, ' ').slice(0, 30)}`);
                return v.apply(alvo, args);
              };
            }
            if (v && typeof v === 'object' && typeof v.findUnique === 'function') {
              return new Proxy(v, { get: (m, met) => (typeof m[met] === 'function' ? (...a) => { chamadas.push(`${String(prop)}.${String(met)}`); return m[met].apply(m, a); } : m[met]) });
            }
            return typeof v === 'function' ? v.bind(alvo) : v;
          },
        });
        await lerReconciliacao(proxy, s.c, {}, orcamento);
        modo = (await tx.$queryRaw`SELECT current_setting('plan_cache_mode') || '/' || current_setting('jit') AS m`)[0].m;
        recusa = await tx.$executeRaw`UPDATE "Produto" SET nome_produto = nome_produto WHERE cliente_id = ${s.c}`.then(() => null, (e) => String(e?.message ?? e));
        throw new Error('desfaz');
      }, { isolationLevel: 'RepeatableRead' }).catch((e) => { if (e?.message !== 'desfaz') throw e; });
      return { chamadas, modo, recusa };
    };
    const uma = await medir(undefined);
    const seis = await medir({ produtosPorPagina: 1 });
    assert.equal(uma.modo, 'force_custom_plan/off', 'plano genérico nunca entra (0,9 s → 6,6 s na 6ª execução) e sem JIT (1,6 s de compilação por consulta)');
    assert.match(String(uma.recusa), /read-only transaction/);
    assert.match(uma.chamadas[0], /^\$queryRaw:SET TRANSACTION READ ONLY/);
    assert.ok(!uma.chamadas.some((c) => c.startsWith('$executeRaw')), uma.chamadas.join(' | '));
    const fixas = uma.chamadas.length - 5;
    assert.equal(seis.chamadas.length, fixas + 5 * 6, seis.chamadas.join(' | '));
    assert.deepEqual(seis.chamadas.slice(0, fixas), uma.chamadas.slice(0, fixas));
    for (let k = 0; k < 6; k += 1) assert.deepEqual(seis.chamadas.slice(fixas + 5 * k, fixas + 5 * (k + 1)), uma.chamadas.slice(fixas), `página ${k + 1}: as mesmas 5 consultas`);
  });
});

describe('RL — filtro de local: nível produto sobre TODOS os locais, sem falso OK', () => {
  test('RL1: divergência de cache causada por lote de OUTRO local aparece com o filtro de local; o lote/local de fora não entra; nivel_produto explícito', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2.00')]));
    const c2 = await A.criarConfirmar(s.token, docCom(e, s.local2, [item(e.sal, '50', '3.00')]));
    const L2 = c2.itens[0].estoque_lote_nota_id;
    await prisma().$executeRaw`UPDATE "EstoqueLoteNota" SET quantidade_disponivel = quantidade_disponivel - 1 WHERE cliente_id = ${s.c} AND id = ${L2}`;

    const noLocal1 = await relatorio(s, { empresa_id: e.id, local_estoque_id: s.local.id });
    assert.equal(noLocal1.cobertura.nivel_produto, 'todos_os_locais');
    const [prod] = achadosDe(noLocal1, 'produto', 'produto_id', e.sal.id);
    assert.deepEqual([prod?.classe, prod?.regra, prod?.esperado, prod?.observado], ['DIVERGENCIA_REAL', 'cache_diverge', '149.0000', '150.0000'], JSON.stringify(noLocal1.achados));
    assert.equal(achadosDe(noLocal1, 'lote', 'lote_id', L2).length, 0, 'o lote do local 2 está fora do filtro');
    assert.ok(noLocal1.achados.every((a) => a.nivel === 'produto' || a.chave.local_estoque_id === s.local.id), JSON.stringify(noLocal1.achados));
    assert.notEqual(noLocal1.resumo.situacao, 'CONSISTENTE');
    assert.equal(noLocal1.resumo.por_classe.DIVERGENCIA_REAL, 1);
    assert.equal(noLocal1.resumo.movimentos, 1, 'só a compra do local 1');

    const noLocal2 = await relatorio(s, { empresa_id: e.id, local_estoque_id: s.local2.id });
    assert.deepEqual(classe(noLocal2, 'lote', 'lote_id', L2), ['DIVERGENCIA_REAL', 'consumo_nao_explicado']);
    assert.deepEqual(classe(noLocal2, 'produto', 'produto_id', e.sal.id), ['DIVERGENCIA_REAL', 'cache_diverge']);

    // cache escrito por fora e o produto sem nada no local filtrado: continua DIVERGENCIA no nível produto
    await definirEstoqueAtual(s, e.milho, '3');
    const semPresenca = await relatorio(s, { empresa_id: e.id, local_estoque_id: s.local2.id });
    assert.deepEqual(classe(semPresenca, 'produto', 'produto_id', e.milho.id), ['DADOS_INSUFICIENTES', 'cache_sem_lote']);
  });
});

describe('RA — AuditLog benigno nunca rebaixa DIVERGENCIA_REAL', () => {
  test('RA1: lote com UPDATE −1 + AuditLog benigno do lote (custo, fornecedor, documento, quantidade igual em outro formato) → DIVERGENCIA_REAL em lote, local e produto; PATCH de quantidade → LIMITACAO_LEGADA', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2.00')]));
    const L = compra.itens[0].estoque_lote_nota_id;
    await prisma().$executeRaw`UPDATE "EstoqueLoteNota" SET quantidade_disponivel = quantidade_disponivel - 1 WHERE cliente_id = ${s.c} AND id = ${L}`;
    const base = { id: L, empresa_id: e.id, produto_id: e.sal.id, local_estoque_id: s.local.id, local_estoque_nome: s.local.nome, quantidade_entrada: '100', status: 'Disponivel' };
    await auditoria(s, { acao: 'update', entidade: 'EstoqueLoteNota', entidade_id: L,
      dados_anteriores: { ...base, quantidade_disponivel: '100', custo_unitario: '2', fornecedor_nome: 'A', numero_documento: '1' },
      dados_novos: { ...base, quantidade_disponivel: '100.0000', custo_unitario: '2.5', fornecedor_nome: 'B', numero_documento: '2', updated_date: new Date().toISOString() } });
    await auditoria(s, { acao: 'update', entidade: 'EstoqueLoteNota', entidade_id: L, dados_anteriores: null, dados_novos: { ...base, quantidade_disponivel: '50' } });

    const rel = await relatorio(s, { empresa_id: e.id });
    assert.deepEqual(classe(rel, 'lote', 'lote_id', L), ['DIVERGENCIA_REAL', 'consumo_nao_explicado'], JSON.stringify(rel.achados));
    assert.deepEqual(classe(rel, 'produto', 'produto_id', e.sal.id), ['DIVERGENCIA_REAL', 'cache_diverge']);
    const local = achadosDe(rel, 'local', 'produto_id', e.sal.id);
    assert.deepEqual(local.map((a) => [a.classe, a.regra]), [['DIVERGENCIA_REAL', 'razao_diverge']]);
    assert.ok(achadosDe(rel, 'lote', 'lote_id', L)[0].evidencias.every((t) => !t.startsWith('auditoria:')), 'auditoria benigna nem aparece como evidência');

    // escrita legada de quantidade do PRÓPRIO lote: agora sim é evidência
    await auditoria(s, { acao: 'update', entidade: 'EstoqueLoteNota', entidade_id: L, dados_anteriores: { ...base, quantidade_disponivel: '100' }, dados_novos: { ...base, quantidade_disponivel: '99' } });
    const leg = await relatorio(s, { empresa_id: e.id });
    assert.deepEqual(classe(leg, 'lote', 'lote_id', L), ['LIMITACAO_LEGADA', 'lote_escrito_fora_do_motor']);
    assert.deepEqual(classe(leg, 'produto', 'produto_id', e.sal.id), ['LIMITACAO_LEGADA', 'cache_diverge_legado']);
  });

  test('RA2: cache com +5 por SQL + AuditLog de nome/preço do produto (sem estoque_atual anterior provado) ou de movimento manual → DIVERGENCIA_REAL; escrita provada de estoque_atual → LIMITACAO_LEGADA', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    for (const p of [e.sal, e.milho, e.racao]) await A.criarConfirmar(s.token, docCom(e, s.local, [item(p, '10', '2.00')]));
    for (const p of [e.sal, e.milho, e.racao]) await prisma().$executeRaw`UPDATE "Produto" SET estoque_atual = estoque_atual + 5 WHERE cliente_id = ${s.c} AND id = ${p.id}`;
    const publico = (p, extra) => ({ id: p.id, empresa_id: e.id, nome_produto: p.nome_produto, preco_custo: '2', ...extra });
    // sal: renomeação/preço com snapshot só no depois (anterior sem estoque_atual) e com anterior nulo
    await auditoria(s, { acao: 'update', entidade: 'Produto', entidade_id: e.sal.id, dados_anteriores: { nome_produto: e.sal.nome_produto }, dados_novos: publico(e.sal, { nome_produto: 'SAL NOVO', preco_custo: '9', estoque_atual: '15' }) });
    await auditoria(s, { acao: 'update', entidade: 'Produto', entidade_id: e.sal.id, dados_anteriores: null, dados_novos: publico(e.sal, { estoque_atual: '15' }) });
    await auditoria(s, { acao: 'update', entidade: 'Produto', entidade_id: e.sal.id, dados_anteriores: publico(e.sal, { estoque_atual: '10' }), dados_novos: publico(e.sal, { preco_custo: '3', estoque_atual: '10.0000' }) });
    // milho: POST manual legado de movimento (o movimento já não existe): não escreve cache nem lote
    await auditoria(s, { acao: 'create', entidade: 'MovimentacaoEstoque', entidade_id: `mov-apagado-${randomUUID().slice(0, 8)}`, dados_novos: { empresa_id: e.id, produto_id: e.milho.id, origem_sistema: 'manual', quantidade: '5' } });
    // ração: PATCH legado de estoque_atual provado (10 → 15)
    await auditoria(s, { acao: 'update', entidade: 'Produto', entidade_id: e.racao.id, dados_anteriores: publico(e.racao, { estoque_atual: '10' }), dados_novos: publico(e.racao, { estoque_atual: '15' }) });

    const rel = await relatorio(s, { empresa_id: e.id });
    assert.deepEqual(classe(rel, 'produto', 'produto_id', e.sal.id), ['DIVERGENCIA_REAL', 'cache_diverge'], JSON.stringify(rel.achados));
    assert.deepEqual(classe(rel, 'produto', 'produto_id', e.milho.id), ['DIVERGENCIA_REAL', 'cache_diverge']);
    assert.deepEqual(classe(rel, 'produto', 'produto_id', e.racao.id), ['LIMITACAO_LEGADA', 'cache_escrito_fora_do_motor']);
  });
});

describe('RW — recibo legado: consulta limitada pela janela de criação do movimento', () => {
  test('RW1: recibo na janela explica o consumo legado; o mesmo recibo 2 h depois do movimento não casa → DADOS_INSUFICIENTES (nunca OK)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '60', '2.00')]));
    const L = compra.itens[0].estoque_lote_nota_id;
    await prisma().estoqueLoteNota.update({ where: { cliente_id_id: { cliente_id: s.c, id: L } }, data: { quantidade_disponivel: '48' } });
    await prisma().produto.update({ where: { cliente_id_id: { cliente_id: s.c, id: e.sal.id } }, data: { estoque_atual: { decrement: 12 } } });
    const mLeg = await movimento(s, e, e.sal, { tipo_movimentacao: 'Saída', tipo_detalhado: 'suplementacao', origem_sistema: 'suplementacao', quantidade: '12', local_estoque_origem: s.local.id });
    const r = await recibo(s, 'saida_suplementacao', {
      committed: true, movimentacao: { id: mLeg.id },
      rateio: [{ lote_id: L, quantidade_consumida: 12, custo_unitario: 2, valor_total: 24 }],
    });
    const ok = await relatorio(s, { empresa_id: e.id, produto_id: e.sal.id });
    assert.deepEqual(ok.achados, [], JSON.stringify(ok.achados));

    await prisma().$executeRaw`UPDATE "OperacaoIdempotente" SET "createdAt" = "createdAt" + interval '2 hours' WHERE cliente_id = ${s.c} AND id = ${r.id}`;
    const fora = await relatorio(s, { empresa_id: e.id, produto_id: e.sal.id });
    assert.deepEqual(classe(fora, 'movimento', 'movimento_id', mLeg.id), ['DADOS_INSUFICIENTES', 'consumo_legado_sem_recibo'], JSON.stringify(fora.achados));
    assert.deepEqual(classe(fora, 'lote', 'lote_id', L), ['DADOS_INSUFICIENTES', 'consumo_legado_sem_recibo']);
  });

  test('RW2: comando de suplementação (caminho novo) continua sem achado e sem depender do recibo', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '20', '2.00')]));
    await A.ok(A.req('POST', URL_SUP, s.token, { operation_id: opId(), empresa_id: e.id, produto_id: e.sal.id, local_origem_id: s.local.id, quantidade: 4 }), 201);
    const rel = await relatorio(s, { empresa_id: e.id });
    assert.deepEqual(rel.achados, []);
    assert.equal(rel.resumo.situacao, 'CONSISTENTE');
    assert.equal(rel.cobertura.completa, true);
  });
});
