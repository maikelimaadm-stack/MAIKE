/**
 * D-PROD-155 — P3-01 Central Única de Lançamentos: correções da revisão
 * adversarial RODADA 2 (backend). PostgreSQL real, HTTP autenticado.
 *
 *  R1. DINHEIRO-1   — Decimal lido do banco recalcula com a precisão da camada (50);
 *  R2. SCHEMA_OPS-1 — soma das liquidações do título filtra `empresa_id`;
 *  R3. API-1        — `q` com caractere de controle → 400, nunca 500;
 *  R4. API-2        — cursor adulterado → 400 `cursor_invalido` (P3 e todo módulo
 *                     do keyset compartilhado);
 *  R5. API-3        — `next_cursor` das opções sempre aceito pela própria rota;
 *  R6. API-4        — motivo só de espaços → 400 com field e reason;
 *  R7. CRITICO-2    — estornos do cancelamento EM LOTE: equivalência com o laço
 *                     item a item (oráculo: `estornarEntrada`/`estornarSaida`) e volume.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, codigo, motivo, docAvista, docCom, docSem, foto, loteLegado, montarTenant, prisma } from './gestaoP3Cenario.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { Dec, dec } from '../src/modules/financeiro/decimalFinanceiro.js';
import { estornarEntrada, estornarSaida, travarProdutosEstoque } from '../src/modules/estoqueFisico/estoqueFisicoMotor.js';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoes>} */
let A;
before(async () => {
  app = await criarApp();
  await app.ready();
  await limparBanco();
  A = acoes(app);
});
after(async () => {
  await app.close();
  await encerrar();
});

const campo = (r) => r.json().field ?? r.json().details?.field;
const recusa400 = (r, field, reason, rotulo) =>
  assert.deepEqual([r.statusCode, codigo(r), campo(r), motivo(r)], [400, 'REQUEST_VALIDATION_FAILED', field, reason], `${rotulo}: ${r.body}`);
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o), 'utf8').toString('base64url');
const item = (produto, quantidade, valor_unitario, extra = {}) => ({ produto, quantidade, valor_unitario, ...extra });
const definirEstoqueAtual = (produto, kg) => prisma().produto.update({ where: { id: produto.id }, data: { estoque_atual: kg } });

// ─────────────────────────────────────────────────────────────────────────────
describe('R1 — DINHEIRO-1: Decimal do banco recalcula com precisão 50', () => {
  test('dec() troca o Prisma.Decimal lido do banco (precisão 20, mesmo protótipo) pelo Dec da camada; um Dec passa intacto', () => {
    const lido = new Prisma.Decimal('7984815747.9459');
    assert.equal(lido instanceof Dec, true, 'o protótipo é compartilhado: é isso que enganava o instanceof');
    assert.equal(dec(lido).constructor, Dec);
    assert.equal(dec(lido).times(dec(new Prisma.Decimal('219.522662'))).toFixed(2), '1752848008568.60');
    const proprio = new Dec('1');
    assert.equal(dec(proprio), proprio);
  });

  test('vetor da §8.7 (SERVICO 7984815747,9459 × 219,522662) e total grande sem produtos em PERCENTUAL: prévia sem bloqueio com …568,60 e confirmação 200 com o título …568,60', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const total = '1752848008568.60';
    const servico = [{ tipo_item: 'SERVICO', descricao: 'CONTRATO', unidade: 'UN', quantidade: '7984815747.9459', valor_unitario: '219.522662' }];
    const base = { empresa_id: e.id, direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', parceiro_id: e.prest.id, data_emissao: '2027-06-10', itens: servico };
    const percentual = [{ natureza_id: e.desp.id, percentual: '33.333333' }, { natureza_id: e.desp2.id, percentual: '66.666667' }];
    const docs = {
      'F1b (PERCENTUAL, a prazo)': { ...base, condicao: 'PRAZO', rateio_modo: 'PERCENTUAL', rateios: percentual, parcelas: [{ vencimento: '2027-07-10', valor: total }] },
      'VALOR, à vista': { ...base, condicao: 'AVISTA', rateio_modo: 'VALOR', rateios: [{ natureza_id: e.desp.id, valor: total }], parcelas: [{ vencimento: '2027-06-10', valor: total }] },
      'sem produtos, PERCENTUAL': docSem(e, { valor_bruto: total, rateio_modo: 'PERCENTUAL', rateios: percentual, parcelas: [{ vencimento: '2027-07-10', valor: total }] }),
    };
    for (const [rotulo, doc] of Object.entries(docs)) {
      const d = await A.criar(s.token, doc);
      assert.equal(d.valor_total, total, rotulo);
      const pv = await A.previa(s.token, d.id, e.id);
      assert.deepEqual([pv.bloqueios.length, pv.plano?.valor_total], [0, total], `${rotulo}: prévia ${JSON.stringify(pv.bloqueios)}`);
      const c = await A.confirmarReq(s.token, d, e.id);
      assert.equal(c.statusCode, 200, `${rotulo}: confirmar ${c.body}`);
      assert.deepEqual([c.json().status, c.json().titulos[0].valor], ['CONFIRMADO', total], rotulo);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R2 — SCHEMA_OPS-1: soma das liquidações usa as 3 colunas da unique (cliente, empresa, título)', () => {
  test('liquidar, estornar e baixa no ato: toda agregação de LiquidacaoFinanceira filtra cliente_id, empresa_id e titulo_id', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    /** @type {any[]} */
    const capturados = [];
    const cliente = /** @type {any} */ (getPrismaClient());
    const original = cliente.$transaction;
    // Caixa-branca: a transação do serviço recebe um `tx` que registra o `where` das agregações.
    cliente.$transaction = function (fn, opcoes) {
      if (typeof fn !== 'function') return original.call(this, fn, opcoes);
      return original.call(this, (tx) => fn(new Proxy(tx, {
        get(alvo, chave) {
          const v = alvo[chave];
          if (chave !== 'liquidacaoFinanceira') return v;
          return new Proxy(v, {
            get(d, m) {
              const f = d[m];
              return m === 'aggregate' ? (args) => { capturados.push(args.where); return f.call(d, args); } : f;
            },
          });
        },
      })), opcoes);
    };
    try {
      const d = await A.criarConfirmar(s.token, docSem(e));
      const l = await A.ok(A.liquidarReq(s.token, d.titulos[0].id, e.id), 201);
      await A.ok(A.estornarReq(s.token, l.titulos[0].liquidacoes[0].id, e.id), 201);
      await A.confirmar(s.token, await A.criar(s.token, docAvista(e)), e.id, { baixa_no_ato: { metodo: 'DINHEIRO', data: '2027-06-10' } });
    } finally {
      cliente.$transaction = original;
    }
    assert.ok(capturados.length >= 4, `agregações capturadas: ${capturados.length}`);
    for (const w of capturados) assert.deepEqual([w.cliente_id, w.empresa_id, typeof w.titulo_id], [s.c, e.id, 'string'], JSON.stringify(w));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R3 — API-1: q com caractere de controle', () => {
  test('as 7 rotas de busca recusam q com NUL/controle (400 field q, reason caractere_invalido); a busca literal continua', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const urls = [
      `/operacoes-financeiras?empresa_id=${e.id}`,
      `/operacoes-financeiras-opcoes/parceiros?empresa_id=${e.id}&direcao=PAGAR`,
      `/operacoes-financeiras-opcoes/produtos?empresa_id=${e.id}`,
      '/operacoes-financeiras-opcoes/locais?limit=50',
      `/operacoes-financeiras-opcoes/naturezas?empresa_id=${e.id}&tipo=DESPESA`,
      `/operacoes-financeiras-opcoes/centros-custo?empresa_id=${e.id}`,
      `/operacoes-financeiras-opcoes/centros-resultado?empresa_id=${e.id}`,
    ];
    for (const url of urls) {
      for (const q of ['a%00b', '%00', '%1F']) recusa400(await A.req('GET', `${url}&q=${q}`, s.token), 'q', 'caractere_invalido', `${url} q=${q}`);
    }
    const alvo = await A.criar(s.token, docSem(e, { descricao: 'RAÇÃO DE AÇÚCAR 50% _X' }));
    await A.criar(s.token, docSem(e, { descricao: 'OUTRA COISA' }));
    const r = await A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}&q=${encodeURIComponent('AÇÚCAR 50%')}`, s.token);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json().items.map((i) => i.id), [alvo.id]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R4 — API-2: cursor adulterado nunca chega ao banco', () => {
  const KEYSET = {
    'ano > 9999': b64({ t: '+010000-01-01T00:00:00.000Z', i: 'a' }),
    'ano < 0': b64({ t: '-000001-01-01T00:00:00.000Z', i: 'a' }),
    'id com NUL': b64({ t: '2027-01-01T00:00:00.000Z', i: 'a\u0000b' }),
    'id com surrogate isolado': b64('{"t":"2027-01-01T00:00:00.000Z","i":"\\ud800"}'),
    'id fora do padrão': b64({ t: '2027-01-01T00:00:00.000Z', i: 'x'.repeat(300) }),
  };
  const OPCOES = {
    'nome com NUL': b64(['a\u0000', 'x']),
    'nome com surrogate isolado': b64('["\\ud800","x"]'),
    'id com NUL': b64(['A', 'x\u0000']),
    'id fora do padrão': b64(['A', 'a b']),
    'nome maior que as colunas': b64(['é'.repeat(256), 'x']),
  };

  test('listagem da P3 e as 6 opções: 400 cursor_invalido; um next_cursor legítimo continua paginando', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    for (const [rotulo, c] of Object.entries(KEYSET)) recusa400(await A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}&cursor=${c}`, s.token), 'cursor', 'cursor_invalido', `lista: ${rotulo}`);
    const opcoes = [
      `/operacoes-financeiras-opcoes/parceiros?empresa_id=${e.id}&direcao=PAGAR`,
      `/operacoes-financeiras-opcoes/produtos?empresa_id=${e.id}`,
      '/operacoes-financeiras-opcoes/locais?limit=50',
      `/operacoes-financeiras-opcoes/naturezas?empresa_id=${e.id}&tipo=DESPESA`,
      `/operacoes-financeiras-opcoes/centros-custo?empresa_id=${e.id}`,
      `/operacoes-financeiras-opcoes/centros-resultado?empresa_id=${e.id}`,
    ];
    for (const url of opcoes) {
      for (const [rotulo, c] of Object.entries(OPCOES)) recusa400(await A.req('GET', `${url}&cursor=${c}`, s.token), 'cursor', 'cursor_invalido', `${url}: ${rotulo}`);
    }
    const criados = [];
    for (let i = 0; i < 3; i += 1) criados.push((await A.criar(s.token, docSem(e, { descricao: `DOC ${i}` }))).id);
    const vistos = [];
    let cursor = null;
    do {
      const r = await A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}&limit=1${cursor ? `&cursor=${cursor}` : ''}`, s.token);
      assert.equal(r.statusCode, 200, r.body);
      vistos.push(...r.json().items.map((x) => x.id));
      cursor = r.json().next_cursor;
    } while (cursor);
    assert.deepEqual(vistos.sort(), criados.sort());
    let cursorOpcoes = null;
    const nomes = [];
    do {
      const r = await A.req('GET', `/operacoes-financeiras-opcoes/naturezas?empresa_id=${e.id}&tipo=DESPESA&limit=1${cursorOpcoes ? `&cursor=${cursorOpcoes}` : ''}`, s.token);
      assert.equal(r.statusCode, 200, r.body);
      nomes.push(...r.json().itens.map((x) => x.nome));
      cursorOpcoes = r.json().next_cursor;
    } while (cursorOpcoes);
    assert.equal(nomes.length, 3, JSON.stringify(nomes));
  });

  test('o decodificador compartilhado (keysetCursor.js) protege TODO módulo que o usa: 400 cursor_invalido, nunca 500', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const rotas = [
      '/marcas?limit=10',
      '/locais-estoque/page?limit=10',
      `/produtos/page?empresa_id=${e.id}&limit=10`,
      '/unidades-medida/page?limit=10',
      '/usuarios/page?limit=10',
      `/setores/page?empresa_id=${e.id}&limit=10`,
      `/parceiros?empresa_id=${e.id}`,
      `/naturezas-financeiras?empresa_id=${e.id}`,
      `/centros-custo?empresa_id=${e.id}`,
      `/centros-resultado?empresa_id=${e.id}`,
    ];
    for (const url of rotas) {
      for (const [rotulo, c] of Object.entries(KEYSET)) recusa400(await A.req('GET', `${url}&cursor=${c}`, s.token), 'cursor', 'cursor_invalido', `${url}: ${rotulo}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R5 — API-3: next_cursor das opções com nome longo', () => {
  test('centro de custo com 120 caracteres japoneses (máximo da coluna) fecha a página: o next_cursor (> 512) é aceito e a página seguinte vem', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const longo = '牧場'.repeat(60);
    const depois = `${'牧場'.repeat(59)}牧牧`;
    await prisma().centroCusto.create({ data: { cliente_id: s.c, empresa_id: e.id, numero: '91', nome: longo } });
    await prisma().centroCusto.create({ data: { cliente_id: s.c, empresa_id: e.id, numero: '92', nome: depois } });
    const nomes = [];
    const tamanhos = [];
    let cursor = null;
    do {
      const r = await A.req('GET', `/operacoes-financeiras-opcoes/centros-custo?empresa_id=${e.id}&limit=1${cursor ? `&cursor=${cursor}` : ''}`, s.token);
      assert.equal(r.statusCode, 200, `cursor de ${cursor?.length ?? 0} caracteres: ${r.body}`);
      nomes.push(...r.json().itens.map((x) => x.nome));
      cursor = r.json().next_cursor;
      if (cursor) tamanhos.push(cursor.length);
    } while (cursor);
    assert.deepEqual(nomes.slice(-2), [longo, depois]);
    assert.ok(Math.max(...tamanhos) > 512, `o cenário exercita cursor acima do antigo teto: ${tamanhos}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R6 — API-4: motivo só de espaços', () => {
  test('cancelar e estornar com motivo em branco: 400 com field motivo e reason obrigatorio; nada gravado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const d = await A.criarConfirmar(s.token, docSem(e));
    const antes = await foto([s.c]);
    recusa400(await A.cancelarReq(s.token, d.id, e.id, { motivo: '   ' }), 'motivo', 'obrigatorio', 'cancelar');
    assert.equal(await foto([s.c]), antes);
    const l = await A.ok(A.liquidarReq(s.token, d.titulos[0].id, e.id), 201);
    const meio = await foto([s.c]);
    recusa400(await A.estornarReq(s.token, l.titulos[0].liquidacoes[0].id, e.id, { motivo: '　 ' }), 'motivo', 'obrigatorio', 'estornar');
    assert.equal(await foto([s.c]), meio);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Oráculo: o laço item a item ANTERIOR à rodada 2 (as mesmas leituras e
 * chamadas de `estornarEntrada`/`estornarSaida` que `cancelar` fazia), só a
 * parte de estoque, numa transação do teste.
 */
const estornarItemAItem = async (s, e, d, dia) => {
  const p = prisma();
  const op = await p.operacaoFinanceira.findUnique({ where: { id: d.id } });
  const itens = await p.operacaoFinanceiraItem.findMany({ where: { cliente_id: s.c, operacao_id: d.id, tipo_item: 'MERCADORIA' }, orderBy: { ordem: 'asc' }, include: { consumos: true } });
  const parceiro = await p.fornecedor.findUnique({ where: { id: op.parceiro_id }, select: { id: true, nome: true } });
  const ctx = { auth: { clienteId: s.c, usuarioId: s.admId, login: s.admLogin } };
  await p.$transaction(async (tx) => {
    await travarProdutosEstoque(tx, s.c, e.id, itens.map((i) => i.produto_id));
    for (const it of itens) {
      const produto = await tx.produto.findUnique({ where: { id: it.produto_id } });
      const local = await tx.localEstoque.findUnique({ where: { id: it.local_estoque_id }, select: { id: true, nome: true } });
      const comum = {
        empresaId: e.id, item: it, produto, local: { id: it.local_estoque_id, nome: local?.nome ?? it.local_estoque_nome }, dia,
        documento: { numero: op.documento_referencia ?? op.numero, data: op.data_emissao.toISOString().slice(0, 10) },
        parceiro: { id: parceiro?.id ?? op.parceiro_id, nome: parceiro?.nome ?? op.parceiro_nome }, origem: { operacaoId: d.id }, numeroMovimento: `p-oraculo-${it.ordem}`,
      };
      const res = op.direcao === 'PAGAR' ? await estornarEntrada(tx, ctx, comum) : await estornarSaida(tx, ctx, { ...comum, consumos: it.consumos });
      await tx.operacaoFinanceiraItem.update({ where: { id: it.id }, data: { movimentacao_estorno_id: res.movimento.id } });
    }
  }, { maxWait: 10000, timeout: 60000 });
};

/** Rótulos estáveis entre tenants para os ids do cenário e do documento. */
const rotulos = async (cen) => {
  const { s, e, d, L } = cen;
  const itens = await prisma().operacaoFinanceiraItem.findMany({ where: { cliente_id: s.c, operacao_id: d.id }, orderBy: { ordem: 'asc' } });
  const rot = new Map([[s.c, 'C'], [e.id, 'E1'], [e.sal.id, 'SAL'], [e.milho.id, 'MILHO'], [e.racao.id, 'RACAO'], [s.local.id, 'LOCAL'], [s.local2.id, 'LOCAL2'], [d.id, 'DOC'], [s.admId, 'ADM'], [s.admLogin, 'LOGIN'], [e.forn.id, 'FORN'], [e.cli.id, 'CLI']]);
  for (const [nome, l] of Object.entries(L)) rot.set(l.id, nome);
  for (const it of itens) {
    rot.set(it.id, `ITEM_${it.ordem}`);
    if (it.estoque_lote_nota_id) rot.set(it.estoque_lote_nota_id, `LOTE_ITEM_${it.ordem}`);
    if (it.movimentacao_estoque_id) rot.set(it.movimentacao_estoque_id, `ORIGINAL_${it.ordem}`);
    if (it.movimentacao_estorno_id) rot.set(it.movimentacao_estorno_id, `ESTORNO_${it.ordem}`);
  }
  return rot;
};
const rotular = (valor, rot) => {
  let json = JSON.stringify(valor);
  for (const [id, nome] of [...rot.entries()].sort((a, b) => b[0].length - a[0].length)) json = json.split(id).join(nome);
  return JSON.parse(json);
};

/** Estado de estoque do documento, sem ids/instantes (rótulos estáveis entre tenants). */
const estadoEstoque = async (cen) => {
  const p = prisma();
  const { s, e, d } = cen;
  const itens = await p.operacaoFinanceiraItem.findMany({ where: { cliente_id: s.c, operacao_id: d.id }, orderBy: { ordem: 'asc' }, include: { consumos: true } });
  const rot = await rotulos(cen);
  const movs = [];
  const sem = (m) => {
    const copia = { ...m };
    for (const k of ['id', 'createdAt', 'updatedAt', 'numero_movimentacao']) delete copia[k];
    return copia;
  };
  for (const it of itens) {
    const original = await p.movimentacaoEstoque.findUnique({ where: { id: it.movimentacao_estoque_id } });
    const estorno = it.movimentacao_estorno_id ? await p.movimentacaoEstoque.findUnique({ where: { id: it.movimentacao_estorno_id } }) : null;
    movs.push({ original: sem(original), estorno: estorno ? sem(estorno) : null, consumos: it.consumos.map((c) => [c.estoque_lote_nota_id, c.quantidade.toFixed(4)]).sort() });
  }
  const lotes = await p.estoqueLoteNota.findMany({ where: { cliente_id: s.c }, orderBy: { id: 'asc' } });
  const produtos = await p.produto.findMany({ where: { cliente_id: s.c, empresa_id: e.id }, select: { id: true, estoque_atual: true } });
  const estado = rotular({
    lotes: lotes.map((l) => [l.id, l.status, l.quantidade_disponivel.toFixed(4), l.quantidade_entrada.toFixed(4)]),
    produtos: produtos.map((x) => [x.id, x.estoque_atual.toFixed(4)]),
    itens: itens.map((i) => [i.ordem, i.movimentacao_estoque_id, i.movimentacao_estorno_id, i.estoque_lote_nota_id]),
    movimentos: movs,
  }, rot);
  estado.lotes.sort();
  estado.produtos.sort();
  return estado;
};

/** Venda: 2 produtos, 2 locais, lote L2 servindo dois itens, lotes Esgotado e parciais. */
const montarVenda = async () => {
  const s = await montarTenant(app);
  const e = s.e1;
  const L = {
    L1: await loteLegado(s, e, e.sal, s.local, { kg: '5', dia: '2027-06-01' }),
    L2: await loteLegado(s, e, e.sal, s.local, { kg: '5', dia: '2027-06-02' }),
    L3: await loteLegado(s, e, e.sal, s.local, { kg: '5', dia: '2027-06-03' }),
    L4: await loteLegado(s, e, e.sal, s.local2, { kg: '7', dia: '2027-06-01' }),
    M1: await loteLegado(s, e, e.milho, s.local2, { kg: '10', dia: '2027-06-01' }),
  };
  await definirEstoqueAtual(e.sal, '22');
  await definirEstoqueAtual(e.milho, '10');
  const d = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '7', '3'), item(e.milho, '4', '2', { local: s.local2 }), item(e.sal, '4', '3')], { direcao: 'RECEBER' }));
  return { s, e, d, L };
};

/** Compra: KG e SACO, 2 locais, lote anterior no mesmo produto + local. */
const montarCompra = async () => {
  const s = await montarTenant(app);
  const e = s.e1;
  const L = { P1: await loteLegado(s, e, e.sal, s.local, { kg: '10', dia: '2027-06-01' }) };
  await definirEstoqueAtual(e.sal, '10');
  const d = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '5', '2'), item(e.racao, '2', '90', { unidade: 'SACO', local: s.local2 }), item(e.sal, '3', '2')]));
  return { s, e, d, L };
};

/** Compra com desconto e acréscimo no cabeçalho (rodada 4): movimentos e lotes pelo valor LÍQUIDO de cada linha. */
const montarCompraLiquida = async () => {
  const s = await montarTenant(app);
  const e = s.e1;
  const L = { P1: await loteLegado(s, e, e.sal, s.local, { kg: '10', dia: '2027-06-01' }) };
  await definirEstoqueAtual(e.sal, '10');
  const d = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '5', '2'), item(e.racao, '2', '90', { unidade: 'SACO', local: s.local2 }), item(e.sal, '3', '2')], {
    valor_desconto: '7.77', valor_acrescimo: '1.23', total: '189.46',
  }));
  return { s, e, d, L };
};

const diaDoEstorno = async (cen) => {
  const it = await prisma().operacaoFinanceiraItem.findFirst({ where: { operacao_id: cen.d.id, NOT: { movimentacao_estorno_id: null } } });
  return (await prisma().movimentacaoEstoque.findUnique({ where: { id: it.movimentacao_estorno_id } })).data_movimentacao.toISOString().slice(0, 10);
};

describe('R7 — CRITICO-2: estornos do cancelamento em lote', () => {
  for (const [rotulo, montar] of /** @type {const} */ ([['venda (fatias cruzadas)', montarVenda], ['compra (KG e SACO)', montarCompra], ['compra com desconto e acréscimo (custo líquido)', montarCompraLiquida]])) {
    test(`equivalência — ${rotulo}: lotes, movimentos (campos e saldo antes/depois), estoque_atual, itens e fatias iguais aos do laço item a item`, async () => {
      const a = await montar();
      const b = await montar();
      const canc = await A.cancelarReq(a.s.token, a.d.id, a.e.id);
      assert.equal(canc.statusCode, 200, canc.body);
      await estornarItemAItem(b.s, b.e, b.d, await diaDoEstorno(a));
      assert.deepEqual(await estadoEstoque(a), await estadoEstoque(b));
      if (montar === montarCompraLiquida) {
        // o estorno devolve exatamente o valor LÍQUIDO de cada linha (desconto/acréscimo rateados)
        const its = await prisma().operacaoFinanceiraItem.findMany({ where: { operacao_id: a.d.id }, orderBy: { ordem: 'asc' } });
        const valores = [];
        for (const it of its) {
          const est = await prisma().movimentacaoEstoque.findUnique({ where: { id: it.movimentacao_estorno_id } });
          valores.push([it.valor_liquido.toFixed(4), est.valor_total.toFixed(4), est.valor_unitario.toFixed(4)]);
        }
        assert.deepEqual(valores, [['9.6600', '9.6600', '1.9320'], ['174.0000', '174.0000', '2.9000'], ['5.8000', '5.8000', '1.9333']]);
      }
      // números finais: numéricos, distintos e na ordem dos itens
      const itens = await prisma().operacaoFinanceiraItem.findMany({ where: { operacao_id: a.d.id }, orderBy: { ordem: 'asc' } });
      const numeros = [];
      for (const it of itens) numeros.push(Number((await prisma().movimentacaoEstoque.findUnique({ where: { id: it.movimentacao_estorno_id } })).numero_movimentacao));
      assert.ok(numeros.every((n, i) => Number.isInteger(n) && (i === 0 || n > numeros[i - 1])), `números ${numeros}`);
    });
  }

  test('equivalência das recusas (mesmo item, mesmo motivo, mesmos detalhes, nada gravado): venda com lote estornado no 3º item; compra com estoque_atual corrido insuficiente no 3º item', async () => {
    const casos = [
      ['venda', montarVenda, async (cen) => prisma().estoqueLoteNota.update({ where: { id: cen.L.L3.id }, data: { status: 'Estornado' } })],
      ['compra', montarCompra, async (cen) => definirEstoqueAtual(cen.e.sal, '7')],
    ];
    for (const [rotulo, montar, sabotar] of casos) {
      const a = await montar();
      const b = await montar();
      await sabotar(a);
      await sabotar(b);
      const antes = await foto([a.s.c]);
      const r = await A.cancelarReq(a.s.token, a.d.id, a.e.id);
      assert.equal(await foto([a.s.c]), antes, `${rotulo}: nada gravado`);
      const erroB = await estornarItemAItem(b.s, b.e, b.d, '2027-06-15').then(() => null, (x) => x);
      assert.ok(erroB, `${rotulo}: o oráculo também recusa`);
      const detA = { ...r.json().details, reason: r.json().reason };
      const detB = { ...erroB.details };
      delete detB.field;
      assert.deepEqual([r.json().code, rotular(detA, await rotulos(a))], [erroB.code, rotular(detB, await rotulos(b))], `${rotulo}: ${r.body}`);
      assert.equal(detA.item_ordem, 3, rotulo);
    }
  });

  test('volume: 200 itens (venda com 3 fatias por item, 600 lotes; e compra): o cancelamento custa menos da metade da confirmação na venda e menos que ela na compra, e devolve tudo', async () => {
    const tempos = {};
    for (const direcao of ['RECEBER', 'PAGAR']) {
      const s = await montarTenant(app);
      const e = s.e1;
      const p = prisma();
      if (direcao === 'RECEBER') {
        await p.estoqueLoteNota.createMany({
          data: Array.from({ length: 600 }, (_, i) => ({
            cliente_id: s.c, empresa_id: e.id, produto_id: e.sal.id, produto_nome: e.sal.nome_produto, local_estoque_id: s.local.id, local_estoque_nome: s.local.nome,
            data_documento: new Date(Date.UTC(2027, 0, 1) + i * 60000), custo_unitario: '2.0000', quantidade_entrada: '1', quantidade_disponivel: '1', status: 'Disponivel',
          })),
        });
        await definirEstoqueAtual(e.sal, '600');
      }
      const d = await A.criar(s.token, docCom(e, s.local, Array.from({ length: 200 }, () => item(e.sal, '3', '10')), { direcao }));
      let t = Date.now();
      const conf = await A.confirmarReq(s.token, d, e.id);
      const msConf = Date.now() - t;
      assert.equal(conf.statusCode, 200, conf.body);
      t = Date.now();
      const canc = await A.cancelarReq(s.token, d.id, e.id);
      const msCanc = Date.now() - t;
      assert.equal(canc.statusCode, 200, canc.body);
      tempos[direcao] = { confirmar: msConf, cancelar: msCanc };
      const esperado = direcao === 'RECEBER' ? '600.0000' : '0.0000';
      assert.equal((await p.produto.findUnique({ where: { id: e.sal.id } })).estoque_atual.toFixed(4), esperado);
      const disp = await p.estoqueLoteNota.groupBy({ by: ['status'], where: { cliente_id: s.c }, _count: true, _sum: { quantidade_disponivel: true } });
      assert.deepEqual(
        disp.map((g) => [g.status, g._count, g._sum.quantidade_disponivel?.toFixed(4)]),
        direcao === 'RECEBER' ? [['Disponivel', 600, '600.0000']] : [['Estornado', 200, '0.0000']],
      );
      assert.equal(await p.movimentacaoEstoque.count({ where: { cliente_id: s.c, status: 'Estornada' } }), 200);
      // O laço antigo (item a item) fazia ~2.250 idas ao banco para cancelar 200 itens (CRITICO-2); o lote faz ~64.
      // Na venda (3 fatias por item, 600 lotes), confirmar reparte os lotes e custa caro: cancelar fica em ~20% dele, e
      // "menos da metade" tem folga. Na compra, confirmar não reparte nada e já é barato: cancelar ficou entre 41% e 55%
      // dele nas rodadas da CI (a proporção muda com a máquina), e a metade reprovava o código igual. Ali vale "menos que
      // confirmar", que o laço antigo continua sem cumprir.
      const fator = direcao === 'RECEBER' ? 2 : 1;
      assert.ok(msCanc * fator < msConf, `${direcao}: cancelar ${msCanc} ms × ${fator} < confirmar ${msConf} ms`);
    }
    console.log(`R7 volume (ms): ${JSON.stringify(tempos)}`);
  });
});
