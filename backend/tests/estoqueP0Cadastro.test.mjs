/**
 * D-PROD-161 — Estoque P0 (fatia F2): o Cadastro de Produtos NÃO lança estoque.
 * PostgreSQL real, HTTP autenticado, prova pelas linhas gravadas (fotografia
 * completa do tenant), nunca só pelo status HTTP.
 *
 * `estoque_atual` é cache derivado das ENTRADAS/MOVIMENTAÇÕES (motor físico):
 *
 *  C1. POST com estoque_atual ≠ 0 → 422 PRODUTO_ESTOQUE_ATUAL_NAO_EDITAVEL e
 *      nada gravado (nem produto, nem número, nem auditoria, nem lote/movimento);
 *  C2. POST com 0 ou sem o campo → 201 com cache 0, 0 lotes e 0 movimentos;
 *  C3. POST com valor negativo ou fracionário ≠ 0 → 422;
 *  C4. depois de uma compra de 100 kg, PATCH {estoque_atual: 999} → 422, cache e lote intactos;
 *  C5. PATCH com o valor ATUAL (a 4 casas) é aceito sem efeito e os outros campos seguem;
 *  C6. edição informativa (nome, categoria, preços, mínimos) preserva o saldo; preco_custo
 *      não altera custo de lote nem de movimento, e a venda seguinte custa pelo FIFO;
 *  C7. a comparação é feita SOB TRAVA: um motor segura o produto e muda o cache para 90
 *      enquanto o PATCH espera → 422 e cache 90 (sem lost update); o valor novo sob trava é aceito;
 *  C8. peso por saco e unidade continuam editáveis (efeito prospectivo; o histórico tem fator_kg);
 *  C9. troca de empresa com lote, movimento ou cache ≠ 0 → 409 PRODUTO_COM_ESTOQUE_NAO_MUDA_EMPRESA;
 *  C10. DELETE de produto com lote (sem movimento) → 409 PRODUTO_DELETE_BLOCKED vinculo 'lotes de estoque'.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient, Prisma } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, codigo, docCom, foto, loteLegado, montarTenant, prisma } from './gestaoP3Cenario.mjs';
import { travarProdutosEstoque } from '../src/modules/estoqueFisico/estoqueFisicoMotor.js';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoes>} */
let A;
/** Cliente do TESTE (pool próprio) para quem segura a trava do produto e observa `pg_locks`. @type {PrismaClient} */
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

const D = (v) => new Prisma.Decimal(v);
const q4 = (v) => D(v).toFixed(4);
const item = (produto, quantidade, valor_unitario, extra = {}) => ({ produto, quantidade, valor_unitario, ...extra });
const comprar = (s, e, itens, extra = {}) => A.criarConfirmar(s.token, docCom(e, s.local, itens, extra));
const vender = (s, e, itens, extra = {}) => A.criarConfirmar(s.token, docCom(e, s.local, itens, { direcao: 'RECEBER', ...extra }));
const estoqueAtual = async (produto) => (await prisma().produto.findUnique({ where: { id: produto.id } })).estoque_atual.toFixed(4);
const recusa = (r) => [r.statusCode, codigo(r), r.json().field, r.json().reason];
const criarProduto = (s, corpo) => A.req('POST', '/produtos', s.token, corpo);
const patch = (s, produto, corpo) => A.req('PATCH', `/produtos/${produto.id}`, s.token, corpo);
const contagens = async (s) => {
  const p = prisma();
  const w = { where: { cliente_id: s.c } };
  return {
    produtos: await p.produto.count(w),
    lotes: await p.estoqueLoteNota.count(w),
    movimentos: await p.movimentacaoEstoque.count(w),
  };
};
/** Linha inteira do lote e do movimento (custo histórico) + o cache do produto. */
const historico = async (produto, conf) => {
  const p = prisma();
  const i = conf.itens[0];
  return JSON.stringify({
    lote: await p.estoqueLoteNota.findUnique({ where: { id: i.estoque_lote_nota_id } }),
    movimento: await p.movimentacaoEstoque.findUnique({ where: { id: i.movimentacao_estoque_id } }),
    item: await p.operacaoFinanceiraItem.findUnique({ where: { id: i.id } }),
    estoque_atual: await estoqueAtual(produto),
  });
};

/** pids bloqueados DIRETAMENTE por `pid`. */
const bloqueadosPor = async (pid) =>
  /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND ${pid}::int = ANY(pg_blocking_pids(pid))`).map((r) => r.pid);
/** Espera uma CONDIÇÃO observável (nunca um tempo fixo). */
const esperar = async (cond, rotulo, ms = 15000) => {
  const limite = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > limite) throw new Error(`tempo esgotado esperando: ${rotulo}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};

/**
 * Um "motor" do TESTE segura o produto (`travarProdutosEstoque`: advisory + FOR UPDATE)
 * e, com o PATCH já parado na trava, baixa 10 kg do lote (CAS) e do cache; só então commita.
 * @returns {Promise<any>} a resposta do PATCH (que terminou DEPOIS do commit do motor)
 */
const patchDuranteMotor = async (s, e, produto, lote, corpo) => {
  /** @type {Promise<any>|null} */
  let pedido = null;
  await aux.$transaction(async (tx) => {
    const [{ pid }] = /** @type {any[]} */ (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`);
    await travarProdutosEstoque(tx, s.c, e.id, [produto.id]);
    pedido = patch(s, produto, corpo);
    await esperar(async () => (await bloqueadosPor(pid)).length > 0, 'PATCH esperando a trava do produto');
    const cas = await tx.estoqueLoteNota.updateMany({
      where: { cliente_id: s.c, id: lote.id, status: 'Disponivel', quantidade_disponivel: '100' },
      data: { quantidade_disponivel: '90' },
    });
    assert.equal(cas.count, 1, 'CAS do lote');
    await tx.produto.update({ where: { cliente_id_id: { cliente_id: s.c, id: produto.id } }, data: { estoque_atual: { decrement: '10' } } });
  }, { maxWait: 10000, timeout: 30000 });
  return pedido;
};

// ─────────────────────────────────────────────────────────────────────────────
describe('C1–C3 — POST /produtos não cria saldo', () => {
  test('C1: estoque_atual 100 → 422 PRODUTO_ESTOQUE_ATUAL_NAO_EDITAVEL; nada gravado (produto, número, auditoria, lote, movimento)', async () => {
    const s = await montarTenant(app);
    const antes = await foto(s.c);
    const n = await contagens(s);
    const r = await criarProduto(s, { empresa_id: s.e1.id, nome_produto: 'SAL COM SALDO', estoque_atual: 100, estoque_minimo: 0, unidade_principal_estoque: 'KG', ativo: true });
    assert.deepEqual(recusa(r), [422, 'PRODUTO_ESTOQUE_ATUAL_NAO_EDITAVEL', 'estoque_atual', 'somente_leitura'], r.body);
    assert.equal(r.json().message.includes('Entradas'), true, r.body);
    assert.deepEqual(await contagens(s), n);
    assert.equal(await prisma().produto.count({ where: { cliente_id: s.c, nome_produto: 'SAL COM SALDO' } }), 0);
    assert.equal(await foto(s.c), antes, 'nada gravado: nem a sequência de números nem a auditoria');
  });

  test('C2: estoque_atual 0 e campo ausente → 201 com cache 0, 0 lotes e 0 movimentos; a auditoria registra 0', async () => {
    const s = await montarTenant(app);
    const p = prisma();
    const n = await contagens(s);
    const comZero = await A.ok(criarProduto(s, { empresa_id: s.e1.id, nome_produto: 'SAL ZERO', estoque_atual: 0 }), 201);
    const semCampo = await A.ok(criarProduto(s, { empresa_id: s.e1.id, nome_produto: 'SAL SEM CAMPO' }), 201);
    const fracionarioZero = await A.ok(criarProduto(s, { empresa_id: s.e1.id, nome_produto: 'SAL ZERO DECIMAL', estoque_atual: 0.0 }), 201);
    for (const criado of [comZero, semCampo, fracionarioZero]) {
      assert.equal(criado.estoque_atual, 0);
      assert.equal(await estoqueAtual(criado), '0.0000');
      assert.equal(await p.estoqueLoteNota.count({ where: { cliente_id: s.c, produto_id: criado.id } }), 0);
      assert.equal(await p.movimentacaoEstoque.count({ where: { cliente_id: s.c, produto_id: criado.id } }), 0);
      const audit = await p.auditLog.findFirst({ where: { cliente_id: s.c, entidade: 'Produto', entidade_id: criado.id, acao: 'create' } });
      assert.equal(/** @type {any} */ (audit?.dados_novos)?.estoque_atual, 0);
    }
    assert.deepEqual(await contagens(s), { ...n, produtos: n.produtos + 3 });
  });

  test('C3: estoque_atual −5 e 0,00001 → 422; nada gravado', async () => {
    const s = await montarTenant(app);
    const antes = await foto(s.c);
    for (const valor of [-5, 0.00001, 1e-9]) {
      const r = await criarProduto(s, { empresa_id: s.e1.id, nome_produto: `SAL ${valor}`, estoque_atual: valor });
      assert.deepEqual(recusa(r), [422, 'PRODUTO_ESTOQUE_ATUAL_NAO_EDITAVEL', 'estoque_atual', 'somente_leitura'], `${valor}: ${r.body}`);
    }
    assert.equal(await foto(s.c), antes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C4–C7 — PATCH /produtos/:id nunca escreve estoque_atual', () => {
  test('C4: depois da compra de 100 kg, PATCH {estoque_atual: 999} → 422; cache 100, lote 100, nada gravado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const conf = await comprar(s, e, [item(e.sal, '100', '2')]);
    assert.equal(await estoqueAtual(e.sal), '100.0000');
    const antes = await foto(s.c);
    for (const corpo of [{ estoque_atual: 999 }, { estoque_atual: 0 }, { estoque_atual: 999, nome_produto: 'NAO GRAVA' }, { empresa_id: e.id, estoque_atual: 100.0001 }]) {
      const r = await patch(s, e.sal, corpo);
      assert.deepEqual(recusa(r), [422, 'PRODUTO_ESTOQUE_ATUAL_NAO_EDITAVEL', 'estoque_atual', 'somente_leitura'], `${JSON.stringify(corpo)}: ${r.body}`);
    }
    assert.equal(await foto(s.c), antes, 'nada gravado (nem o nome, nem auditoria)');
    const lote = await prisma().estoqueLoteNota.findUnique({ where: { id: conf.itens[0].estoque_lote_nota_id } });
    assert.deepEqual([await estoqueAtual(e.sal), q4(lote.quantidade_disponivel), lote.status], ['100.0000', '100.0000', 'Disponivel']);
  });

  test('C5: PATCH {estoque_atual: 100, nome_produto} (igual ao atual a 4 casas) → 200; nome trocado, cache 100, lote intacto', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const conf = await comprar(s, e, [item(e.sal, '100', '2')]);
    const loteAntes = await prisma().estoqueLoteNota.findUnique({ where: { id: conf.itens[0].estoque_lote_nota_id } });
    const r = await A.ok(patch(s, e.sal, { estoque_atual: 100, nome_produto: 'SAL NOVO' }));
    assert.deepEqual([r.nome_produto, r.estoque_atual], ['SAL NOVO', 100]);
    // 100.00004 arredonda (HALF_UP, 4 casas) para o valor atual: sem efeito
    const r2 = await A.ok(patch(s, e.sal, { estoque_atual: 100.00004, observacoes: 'OBS' }));
    assert.deepEqual([r2.observacoes, r2.estoque_atual], ['OBS', 100]);
    // só o campo, igual: aceito sem efeito
    await A.ok(patch(s, e.sal, { estoque_atual: 100 }));
    assert.equal(await estoqueAtual(e.sal), '100.0000');
    assert.equal(JSON.stringify(await prisma().estoqueLoteNota.findUnique({ where: { id: loteAntes.id } })), JSON.stringify(loteAntes));
    // 100.00005 arredonda para 100.0001 ≠ atual → 422
    const r3 = await patch(s, e.sal, { estoque_atual: 100.00005 });
    assert.deepEqual(recusa(r3), [422, 'PRODUTO_ESTOQUE_ATUAL_NAO_EDITAVEL', 'estoque_atual', 'somente_leitura'], r3.body);
  });

  test('C6: PATCH de nome, categoria, preços e mínimos (preco_custo 999) preserva cache, lote, item e movimento; a venda de 10 kg custa 20.0000 pelo FIFO', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const conf = await comprar(s, e, [item(e.sal, '100', '2')]);
    const antes = await historico(e.sal, conf);
    const editado = await A.ok(patch(s, e.sal, {
      empresa_id: e.id, nome_produto: 'SAL EDITADO', categoria: 'MINERAL', preco_custo: 999, preco_venda: 1500, estoque_minimo: 3, consumo_minimo_pv: 0.1, consumo_maximo_pv: 0.3,
    }));
    // D-PROD-285: preço de custo e de venda saíram da tela; o corpo que os traz é aceito e IGNORADO.
    assert.deepEqual([editado.nome_produto, editado.preco_custo, editado.estoque_minimo, editado.estoque_atual], ['SAL EDITADO', null, 3, 100]);
    assert.equal(await historico(e.sal, conf), antes, 'lote (custo 2.0000), item, movimento e cache intactos');
    const venda = await vender(s, e, [item(e.sal, '10', '50')]);
    const saida = await p.movimentacaoEstoque.findUnique({ where: { id: venda.itens[0].movimentacao_estoque_id } });
    assert.deepEqual([saida.tipo_movimentacao, q4(saida.quantidade), q4(saida.valor_unitario), q4(saida.valor_total)], ['Saída', '10.0000', '2.0000', '20.0000']);
    const fatias = await p.operacaoFinanceiraConsumoLote.findMany({ where: { cliente_id: s.c, item_id: venda.itens[0].id } });
    assert.deepEqual(fatias.map((f) => [f.estoque_lote_nota_id, q4(f.quantidade), q4(f.custo_unitario)]), [[conf.itens[0].estoque_lote_nota_id, '10.0000', '2.0000']]);
    assert.equal(await estoqueAtual(e.sal), '90.0000');
    assert.equal((await p.produto.findUnique({ where: { id: e.sal.id } })).preco_custo, null, 'D-PROD-285: preco_custo ignorado no PATCH; o motor também não o altera');
  });

  test('C7: motor segura o produto e muda o cache 100 → 90 enquanto o PATCH {estoque_atual: 100} espera → 422 e cache 90 (sem lost update); {estoque_atual: 90} sob a mesma corrida é aceito', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const conf = await comprar(s, e, [item(e.sal, '100', '2')]);
    const lote = await prisma().estoqueLoteNota.findUnique({ where: { id: conf.itens[0].estoque_lote_nota_id } });
    const r = await patchDuranteMotor(s, e, e.sal, lote, { estoque_atual: 100, observacoes: 'NAO GRAVA' });
    assert.deepEqual(recusa(r), [422, 'PRODUTO_ESTOQUE_ATUAL_NAO_EDITAVEL', 'estoque_atual', 'somente_leitura'], r.body);
    const depois = await prisma().produto.findUnique({ where: { id: e.sal.id } });
    assert.deepEqual([depois.estoque_atual.toFixed(4), depois.observacoes ?? null], ['90.0000', null], 'o cache do motor não é sobrescrito');
    assert.equal(q4((await prisma().estoqueLoteNota.findUnique({ where: { id: lote.id } })).quantidade_disponivel), '90.0000');

    // A comparação usa o valor RELIDO sob a trava (90), não o lido antes dela (100).
    const s2 = await montarTenant(app);
    const e2 = s2.e1;
    const conf2 = await comprar(s2, e2, [item(e2.sal, '100', '2')]);
    const lote2 = await prisma().estoqueLoteNota.findUnique({ where: { id: conf2.itens[0].estoque_lote_nota_id } });
    const ok = await patchDuranteMotor(s2, e2, e2.sal, lote2, { estoque_atual: 90, observacoes: 'GRAVA' });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.deepEqual([ok.json().estoque_atual, ok.json().observacoes], [90, 'GRAVA']);
    assert.equal(await estoqueAtual(e2.sal), '90.0000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C8 — peso por saco e unidade continuam editáveis (prospectivo)', () => {
  test('PATCH peso_por_saco_kg e unidade_principal_estoque → 200; lote, item (fator_kg 30) e movimento da compra em SACO intactos', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const conf = await comprar(s, e, [item(e.racao, '10', '80', { unidade: 'SACO' })]);
    assert.deepEqual([conf.itens[0].fator_kg, conf.itens[0].quantidade_estoque], ['30.0000', '300.0000']);
    const antes = await historico(e.racao, conf);
    const r = await A.ok(patch(s, e.racao, { empresa_id: e.id, peso_por_saco_kg: 50 }));
    assert.equal(r.peso_por_saco_kg, 50);
    const r2 = await A.ok(patch(s, e.racao, { unidade_principal_estoque: 'KG', peso_por_saco_kg: null }));
    assert.deepEqual([r2.unidade_principal_estoque, r2.peso_por_saco_kg, r2.estoque_atual], ['KG', null, 300]);
    assert.equal(await historico(e.racao, conf), antes, 'o histórico guarda fator_kg 30 e 300 kg');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C9 — troca de empresa de produto com estoque', () => {
  test('com lote + movimento (compra), só lote (legado) ou só cache ≠ 0 → 409 PRODUTO_COM_ESTOQUE_NAO_MUDA_EMPRESA, nada gravado; a mesma empresa no corpo e o produto sem estoque seguem', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    await comprar(s, e, [item(e.sal, '100', '2')]);
    await loteLegado(s, e, e.milho, s.local, { kg: '5' });
    const soCache = await p.produto.create({ data: { cliente_id: s.c, empresa_id: e.id, numero_produto: '91', nome_produto: 'SO CACHE', estoque_atual: '50' } });
    const vazio = await p.produto.create({ data: { cliente_id: s.c, empresa_id: e.id, numero_produto: '92', nome_produto: 'SEM ESTOQUE' } });
    const antes = await foto(s.c);
    const casos = [
      [e.sal, { lotes: 1, movimentos: 1 }],
      [e.milho, { lotes: 1, movimentos: 0 }],
      [soCache, { lotes: 0, movimentos: 0 }],
    ];
    for (const [produto, esperado] of casos) {
      const r = await patch(s, produto, { empresa_id: s.e2.id, nome_produto: 'NAO GRAVA' });
      assert.deepEqual([r.statusCode, codigo(r)], [409, 'PRODUTO_COM_ESTOQUE_NAO_MUDA_EMPRESA'], `${produto.nome_produto}: ${r.body}`);
      assert.deepEqual([r.json().details.id, r.json().details.lotes, r.json().details.movimentos], [produto.id, esperado.lotes, esperado.movimentos], r.body);
    }
    assert.equal(await foto(s.c), antes, 'nada gravado');
    // o formulário reenvia a MESMA empresa: não é troca
    const mesma = await A.ok(patch(s, e.sal, { empresa_id: e.id, observacoes: 'MESMA FAZENDA' }));
    assert.deepEqual([mesma.empresa_id, mesma.estoque_atual], [e.id, 100]);
    // sem lote, sem movimento e cache 0: a troca continua permitida
    const movido = await A.ok(patch(s, vazio, { empresa_id: s.e2.id }));
    assert.equal(movido.empresa_id, s.e2.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C10 — DELETE de produto com lote', () => {
  test('lote sem movimento → 409 PRODUTO_DELETE_BLOCKED vinculo "lotes de estoque"; produto e lote continuam; com movimento o vínculo continua "movimentações de estoque"', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const lote = await loteLegado(s, e, e.milho, s.local, { kg: '5' });
    const antes = await foto(s.c);
    const r = await A.req('DELETE', `/produtos/${e.milho.id}`, s.token);
    assert.equal(r.statusCode, 409, `hoje: ${r.statusCode} (apaga o produto e deixa o lote órfão) ${r.body}`);
    assert.equal(codigo(r), 'PRODUTO_DELETE_BLOCKED', r.body);
    assert.deepEqual(r.json().details, { id: e.milho.id, vinculo: 'lotes de estoque', quantidade: 1 });
    assert.equal(await foto(s.c), antes, 'nada apagado, nada auditado');
    assert.ok(await p.produto.findUnique({ where: { id: e.milho.id } }));
    assert.ok(await p.estoqueLoteNota.findUnique({ where: { id: lote.id } }));

    await comprar(s, e, [item(e.sal, '10', '2')]);
    const r2 = await A.req('DELETE', `/produtos/${e.sal.id}`, s.token);
    assert.deepEqual([r2.statusCode, codigo(r2), r2.json().details.vinculo], [409, 'PRODUTO_DELETE_BLOCKED', 'movimentações de estoque'], r2.body);

    // sem lote nem movimento: a exclusão segue
    const livre = await p.produto.create({ data: { cliente_id: s.c, empresa_id: e.id, numero_produto: '93', nome_produto: 'LIVRE' } });
    const r3 = await A.req('DELETE', `/produtos/${livre.id}`, s.token);
    assert.equal(r3.statusCode, 204, r3.body);
  });
});
