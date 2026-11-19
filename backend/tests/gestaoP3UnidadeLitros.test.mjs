/**
 * D-PROD-162 (F4, §4.7 e §4.8) — Gestão P3 em LITROS, só para Produto em L.
 *
 *  U1. PURO, byte a byte: para KG, SACO e UN, o plano (`normalizarDocumento` +
 *      `planejarOperacao`), as recusas (código, mensagem e details) e as
 *      recusas de referência são IDÊNTICOS aos de antes da D-PROD-162: o
 *      sha256 do JSON canônico foi calculado no HEAD `e39d318b` (antes desta
 *      missão) sobre os vetores compartilhados `rateioCabecalhoVetores.json` e
 *      um lote de casos de borda (kg zero, limites, resíduo, unidade errada);
 *  U2. compra de 1.000 L de um Produto em L → item `L` com `fator_kg = 1` e
 *      `quantidade_estoque` = a quantidade, lote em L, movimento
 *      `unidade_medida = 'L'`, `estoque_atual` += 1.000; venda de 120 L → saída
 *      FIFO rotulada `L`; cancelar a venda e a compra → estornos `L` exatos.
 *      No MESMO documento, Produto KG e Produto SACO continuam com o rótulo `KG`;
 *  U3. item `L` só com Produto em L e Produto em L só com item `L` (os dois
 *      sentidos e o SACO) → 422 `OPERACAO_REFERENCIA_INVALIDA`/`unidade_invalida`
 *      na criação, sem gravar nada;
 *  U4. KG + SACO pela API: resposta e linhas (item, lote, movimento, título)
 *      idênticas às de antes (sha256 do JSON normalizado, calculado no HEAD
 *      `e39d318b`) e rótulo `'KG'` no movimento, inclusive do Produto SACO;
 *  U5. mensagens `quantidade_estoque_zero` e `valor_excede_limite_estoque` de um
 *      item em L dizem "em L"; em KG e SACO o texto é o de hoje (comparação exata).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Prisma } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, codigo, docCom, foto, montarTenant, motivo, opId, prisma } from './gestaoP3Cenario.mjs';
import { normalizarDocumento, planejarOperacao } from '../src/modules/financeiro/operacaoFinanceiraPlano.js';
import { problemasDeReferencia } from '../src/modules/financeiro/operacaoFinanceiraService.js';
import { dec } from '../src/modules/financeiro/decimalFinanceiro.js';

const VETORES = JSON.parse(readFileSync(new URL('../../tests/smoke/fixtures/rateioCabecalhoVetores.json', import.meta.url), 'utf8'));

/**
 * sha256 calculados no HEAD `e39d318b` (antes da D-PROD-162), com este mesmo
 * arquivo: qualquer mudança no caminho KG/SACO/UN muda o hash.
 */
const HASH_PURO_ANTES = 'ab57fc5d2d901ccd0002d018ac6bb1cdd629d75bf8d51ea12ad381b41c754389';
// D-PROD-256: único campo que mudou nesta resposta e nas linhas: `modo_saida_fifo` das 2 saídas da venda, 'FIFO' → 'CUSTO_MEDIO'
// (os valores são iguais porque cada poço tem uma só camada). Diferença conferida campo a campo contra a `main` 75464e88.
const HASH_API_ANTES = 'a9080c5bd76c2ad32e90c7cbb65dd5ae890207e6587511dac0924f8a13b06bbb';

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

const sha = (texto) => createHash('sha256').update(texto).digest('hex');
const q4 = (v) => (v === null || v === undefined ? null : new Prisma.Decimal(v).toFixed(4));

// ─── U1: plano puro ─────────────────────────────────────────────────────────

/** Produtos fictícios do caso puro: id = `P<n>`, empresa `E`. */
const produtoPuro = (n, unidade, peso = null, ativo = true) => ({
  id: `P${n}`, empresa_id: 'E', nome_produto: `PRODUTO ${n}`, ativo, unidade_principal_estoque: unidade, peso_por_saco_kg: peso, estoque_atual: '0',
});

/** Corpo DOC com produtos (uma parcela a prazo com o valor `parcela`). */
const corpoPuro = (caso, parcela) => ({
  empresa_id: 'E',
  direcao: caso.direcao ?? 'PAGAR',
  conteudo: 'COM_PRODUTOS',
  condicao: 'PRAZO',
  parceiro_id: 'F',
  data_emissao: '2027-06-10',
  data_operacional: '2027-06-10',
  efeito_fisico_confirmado: true,
  valor_desconto: caso.valor_desconto ?? null,
  valor_acrescimo: caso.valor_acrescimo ?? null,
  rateio_modo: 'PERCENTUAL',
  rateios: [{ natureza_id: 'N', percentual: '100' }],
  parcelas: [{ vencimento: '2027-07-10', valor: parcela }],
  itens: caso.itens.map((i, k) =>
    i.tipo_item === 'SERVICO'
      ? { tipo_item: 'SERVICO', unidade: i.unidade ?? 'UN', quantidade: i.quantidade, valor_unitario: i.valor_unitario, descricao: i.descricao ?? `SERVICO ${k + 1}` }
      : { tipo_item: 'MERCADORIA', produto_id: `P${k + 1}`, local_estoque_id: 'L1', unidade: i.unidade, quantidade: i.quantidade, valor_unitario: i.valor_unitario }),
});

const erroPuro = (e) => (e && typeof e === 'object' && 'code' in e ? { code: e.code, message: e.message, details: e.details ?? null } : { tipo: String(e?.name), message: String(e?.message) });

/**
 * Plano de um caso (2 passos: o 1º descobre o total para a parcela). Itens com
 * `quantidade_bruta` entram direto no documento normalizado (casas além do
 * schema da rota: só assim a quantidade em estoque arredonda a zero).
 */
const planoPuro = (caso) => {
  const produtos = new Map(caso.itens.map((i, k) => [`P${k + 1}`, produtoPuro(k + 1, i.produto_unidade ?? (i.unidade === 'SACO' ? 'SACO' : i.unidade), i.peso_por_saco_kg ?? null)]));
  const refs = { casas: caso.casas ?? 2, moeda: caso.moeda ?? 'BRL', produtos };
  const tentar = (parcela) => {
    const doc = normalizarDocumento(corpoPuro(caso, parcela), refs.casas);
    caso.itens.forEach((i, k) => {
      if (i.quantidade_bruta !== undefined) doc.itens[k].quantidade = dec(i.quantidade_bruta);
    });
    return planejarOperacao(doc, refs);
  };
  try {
    return { ok: tentar('1') };
  } catch (e) {
    const esperado = /** @type {any} */ (e)?.details?.reason === 'soma_diferente' ? /** @type {any} */ (e).details.esperado : null;
    if (esperado === null) return { erro: erroPuro(e) };
    try {
      return { ok: tentar(esperado) };
    } catch (e2) {
      return { erro: erroPuro(e2) };
    }
  }
};

/** Recusas de referência (puro) com Produto do caso em `produto_unidade`. */
const referenciaPura = (caso) => {
  const produtos = new Map(caso.itens.map((i, k) => [`P${k + 1}`, produtoPuro(k + 1, i.produto_unidade, i.peso_por_saco_kg ?? null)]));
  const doc = normalizarDocumento(corpoPuro(caso, '1'), 2);
  const refs = {
    parceiro: { id: 'F', empresa_id: 'E', ativo: true, tipos: ['fornecedor', 'cliente'] },
    naturezas: new Map([['N', { id: 'N', nome: 'N', tipo: doc.direcao === 'PAGAR' ? 'DESPESA' : 'RECEITA', ativo: true }]]),
    sinteticas: new Set(),
    centrosCusto: new Map(),
    centrosResultado: new Map(),
    produtos,
    locais: new Map([['L1', { id: 'L1', nome: 'L1', ativo: true }]]),
  };
  return problemasDeReferencia(doc, refs, { pais: 'BR', moeda: 'BRL' });
};

/** Casos KG/SACO/UN (os vetores compartilhados + bordas). Nenhum usa L. */
const CASOS_KG_SACO = () => [
  ...VETORES.casos.map((c) => ({
    id: c.id, casas: c.casas, moeda: c.perfil.moeda, direcao: c.direcao, valor_desconto: c.valor_desconto, valor_acrescimo: c.valor_acrescimo,
    itens: c.itens.map((i) => ({ ...i })),
  })),
  { id: 'kg_simples', itens: [{ unidade: 'KG', quantidade: '100', valor_unitario: '2.5' }] },
  { id: 'saco_simples', itens: [{ unidade: 'SACO', quantidade: '3', valor_unitario: '90', peso_por_saco_kg: '30' }] },
  { id: 'kg_saco_servico', itens: [{ unidade: 'KG', quantidade: '12.3456', valor_unitario: '1.234567' }, { unidade: 'SACO', quantidade: '7', valor_unitario: '45', peso_por_saco_kg: '25.5' }, { tipo_item: 'SERVICO', quantidade: '1', valor_unitario: '150' }] },
  { id: 'venda_kg_saco', direcao: 'RECEBER', itens: [{ unidade: 'KG', quantidade: '50', valor_unitario: '3' }, { unidade: 'SACO', quantidade: '2', valor_unitario: '100', peso_por_saco_kg: '40' }] },
  { id: 'kg_zero', itens: [{ unidade: 'KG', quantidade: '1', quantidade_bruta: '0.00001', valor_unitario: '100000' }] },
  { id: 'saco_peso_minusculo', itens: [{ unidade: 'SACO', quantidade: '1', valor_unitario: '10', peso_por_saco_kg: '0.00001' }] },
  { id: 'saco_sem_peso', itens: [{ unidade: 'SACO', quantidade: '1', valor_unitario: '10', peso_por_saco_kg: null }] },
  { id: 'kg_acima_limite', itens: [{ unidade: 'KG', quantidade: '9999999999', quantidade_bruta: '10000000000', valor_unitario: '0.01' }] },
  { id: 'saco_acima_limite', itens: [{ unidade: 'SACO', quantidade: '9999999999', valor_unitario: '0.01', peso_por_saco_kg: '2' }] },
  { id: 'kg_custo_acima_limite', itens: [{ unidade: 'KG', quantidade: '0.0001', valor_unitario: '9999999999' }] },
  { id: 'kg_residuo_alto', itens: [{ unidade: 'KG', quantidade: '100000', valor_unitario: '0.00001' }] },
  { id: 'servico_kg', itens: [{ tipo_item: 'SERVICO', unidade: 'KG', quantidade: '1', valor_unitario: '10' }] },
  { id: 'kg_desconto_total', valor_desconto: '100.00', itens: [{ unidade: 'KG', quantidade: '10', valor_unitario: '10' }] },
];

/** Recusas de referência KG/SACO (Produto não-L). */
const REFERENCIAS_KG_SACO = () => [
  { id: 'kg_em_kg', itens: [{ unidade: 'KG', quantidade: '1', valor_unitario: '1', produto_unidade: 'KG' }] },
  { id: 'kg_em_saco', itens: [{ unidade: 'KG', quantidade: '1', valor_unitario: '1', produto_unidade: 'SACO', peso_por_saco_kg: '30' }] },
  { id: 'saco_em_saco', itens: [{ unidade: 'SACO', quantidade: '1', valor_unitario: '1', produto_unidade: 'SACO', peso_por_saco_kg: '30' }] },
  { id: 'saco_em_kg', itens: [{ unidade: 'SACO', quantidade: '1', valor_unitario: '1', produto_unidade: 'KG' }] },
  { id: 'saco_sem_peso', itens: [{ unidade: 'SACO', quantidade: '1', valor_unitario: '1', produto_unidade: 'SACO', peso_por_saco_kg: null }] },
  { id: 'kg_em_legado', itens: [{ unidade: 'KG', quantidade: '1', valor_unitario: '1', produto_unidade: 'UN' }] },
];

describe('U1 — KG, SACO e UN: plano, recusas e referências byte a byte iguais aos de antes', () => {
  test('sha256 do JSON canônico = o do HEAD e39d318b', () => {
    const tudo = {
      planos: CASOS_KG_SACO().map((c) => ({ id: c.id, ...planoPuro(c) })),
      referencias: REFERENCIAS_KG_SACO().map((c) => ({ id: c.id, problemas: referenciaPura(c) })),
    };
    const json = JSON.stringify(tudo);
    // Sanidade: os casos de borda chegam às recusas que deveriam (o hash não é de um erro genérico).
    const porId = Object.fromEntries(tudo.planos.map((p) => [p.id, p]));
    assert.equal(porId.kg_zero.erro?.details?.reason, 'quantidade_estoque_zero', json);
    assert.equal(porId.saco_peso_minusculo.erro?.details?.reason, 'quantidade_estoque_zero', json);
    assert.equal(porId.kg_acima_limite.erro?.details?.reason, 'valor_excede_limite_estoque', json);
    assert.equal(porId.kg_custo_acima_limite.erro?.details?.reason, 'valor_excede_limite_estoque', json);
    assert.equal(porId.kg_residuo_alto.erro?.details?.reason, 'custo_kg_nao_representavel', json);
    assert.ok(porId.kg_saco_servico.ok, json);
    assert.equal(sha(json), HASH_PURO_ANTES, 'o caminho KG/SACO/UN mudou: o plano tem de ser byte a byte o de antes');
  });
});

// ─── apoio HTTP ─────────────────────────────────────────────────────────────
const produtoNovo = (s, e, unidade, nome, extra = {}) =>
  prisma().produto.create({ data: { cliente_id: s.c, empresa_id: e.id, numero_produto: `L-${nome}`, nome_produto: nome, unidade_principal_estoque: unidade, ...extra } });
const estoqueAtual = async (produto) => (await prisma().produto.findUnique({ where: { id: produto.id } })).estoque_atual.toFixed(4);
const lotesDe = (s, produto) => prisma().estoqueLoteNota.findMany({ where: { cliente_id: s.c, produto_id: produto.id }, orderBy: { createdAt: 'asc' } });
const movimentosDe = (s, produto) =>
  prisma().movimentacaoEstoque.findMany({ where: { cliente_id: s.c, produto_id: produto.id }, orderBy: [{ createdAt: 'asc' }, { numero_movimentacao: 'asc' }] });
const itensDe = (s, operacaoId) => prisma().operacaoFinanceiraItem.findMany({ where: { cliente_id: s.c, operacao_id: operacaoId }, orderBy: { ordem: 'asc' } });

// ─── U2 ─────────────────────────────────────────────────────────────────────
describe('U2 — compra e venda em L de Produto em L', () => {
  test('compra 1.000 L → lote/movimento/estoque em L; venda 120 L FIFO rotulada L; cancelamentos exatos; KG e SACO no mesmo documento continuam KG', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const diesel = await produtoNovo(s, e, 'L', 'DIESEL S10 (L)');
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [
      { produto: diesel, unidade: 'L', quantidade: '1000', valor_unitario: '6.00' },
      { produto: e.sal, unidade: 'KG', quantidade: '10', valor_unitario: '3.00' },
      { produto: e.racao, unidade: 'SACO', quantidade: '2', valor_unitario: '90.00' },
    ]));
    assert.equal(compra.status, 'CONFIRMADO');
    const [iL, iKg, iSaco] = await itensDe(s, compra.id);
    assert.deepEqual([iL.unidade, q4(iL.fator_kg), q4(iL.quantidade_estoque), q4(iL.valor_liquido)], ['L', '1.0000', '1000.0000', '6000.0000']);
    assert.deepEqual([iKg.unidade, q4(iKg.fator_kg), q4(iKg.quantidade_estoque)], ['KG', '1.0000', '10.0000']);
    assert.deepEqual([iSaco.unidade, q4(iSaco.fator_kg), q4(iSaco.quantidade_estoque)], ['SACO', '30.0000', '60.0000']);
    const [lote] = await lotesDe(s, diesel);
    assert.deepEqual([q4(lote.quantidade_entrada), q4(lote.quantidade_disponivel), q4(lote.custo_unitario), lote.status], ['1000.0000', '1000.0000', '6.0000', 'Disponivel']);
    const [entrada] = await movimentosDe(s, diesel);
    assert.deepEqual([entrada.tipo_movimentacao, entrada.unidade_medida, q4(entrada.quantidade), q4(entrada.valor_total)], ['Entrada', 'L', '1000.0000', '6000.0000']);
    assert.equal(await estoqueAtual(diesel), '1000.0000');
    // Os outros dois itens do MESMO documento: rótulo KG (o SACO guarda kg).
    assert.deepEqual((await movimentosDe(s, e.sal)).map((m) => m.unidade_medida), ['KG']);
    assert.deepEqual((await movimentosDe(s, e.racao)).map((m) => m.unidade_medida), ['KG']);

    // Venda de 120 L a custo FIFO (o preço de venda não entra no custo).
    const venda = await A.criarConfirmar(s.token, docCom(e, s.local, [{ produto: diesel, unidade: 'L', quantidade: '120', valor_unitario: '7.00' }], { direcao: 'RECEBER' }));
    const saida = (await movimentosDe(s, diesel)).find((m) => m.tipo_movimentacao === 'Saída');
    assert.deepEqual([saida.unidade_medida, q4(saida.quantidade), q4(saida.valor_unitario), q4(saida.valor_total)], ['L', '120.0000', '6.0000', '720.0000']);
    assert.deepEqual([q4((await lotesDe(s, diesel))[0].quantidade_disponivel), await estoqueAtual(diesel)], ['880.0000', '880.0000']);
    const [iVenda] = await itensDe(s, venda.id);
    assert.deepEqual([iVenda.unidade, q4(iVenda.fator_kg), q4(iVenda.quantidade_estoque)], ['L', '1.0000', '120.0000']);

    // Cancelar a venda devolve a fatia ao MESMO lote; cancelar a compra estorna o lote. Tudo rotulado L.
    assert.equal((await A.cancelarReq(s.token, venda.id, e.id)).statusCode, 200);
    assert.deepEqual([q4((await lotesDe(s, diesel))[0].quantidade_disponivel), await estoqueAtual(diesel)], ['1000.0000', '1000.0000']);
    assert.equal((await A.cancelarReq(s.token, compra.id, e.id)).statusCode, 200);
    const movs = await movimentosDe(s, diesel);
    assert.deepEqual(movs.map((m) => [m.tipo_movimentacao, m.tipo_detalhado, m.unidade_medida, q4(m.quantidade)]).sort(), [
      ['Entrada', 'compra_financeiro', 'L', '1000.0000'],
      ['Entrada', 'estorno_venda', 'L', '120.0000'],
      ['Saída', 'estorno_compra', 'L', '1000.0000'],
      ['Saída', 'venda_financeiro', 'L', '120.0000'],
    ]);
    assert.deepEqual([(await lotesDe(s, diesel))[0].status, await estoqueAtual(diesel)], ['Estornado', '0.0000']);
    // O estorno da compra dos outros itens também segue KG.
    assert.deepEqual((await movimentosDe(s, e.racao)).map((m) => m.unidade_medida), ['KG', 'KG']);
  });
});

// ─── U3 ─────────────────────────────────────────────────────────────────────
describe('U3 — L só com Produto em L (e Produto em L só com L)', () => {
  test('item L × Produto KG, item KG × Produto L, item SACO × Produto L → 422 unidade_invalida, nada gravado; item L × Produto L passa', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const diesel = await produtoNovo(s, e, 'L', 'DIESEL (L)');
    const antes = await foto(s.c);
    for (const [rotulo, produto, unidade] of [['item L, produto KG', e.sal, 'L'], ['item L, produto SACO', e.racao, 'L'], ['item KG, produto L', diesel, 'KG'], ['item SACO, produto L', diesel, 'SACO']]) {
      const r = await A.req('POST', '/operacoes-financeiras', s.token, { ...docCom(e, s.local, [{ produto, unidade, quantidade: '10', valor_unitario: '1.00' }]), operation_id: opId() });
      assert.deepEqual([r.statusCode, codigo(r), r.json().field, motivo(r)], [422, 'OPERACAO_REFERENCIA_INVALIDA', 'unidade', 'unidade_invalida'], `${rotulo}: ${r.body}`);
      assert.deepEqual([r.json().details?.colecao, r.json().details?.indice], ['itens', 0], rotulo);
    }
    // Mensagem do caso SACO intocada (KG/SACO byte a byte); a do L diz litros.
    const saco = await A.req('POST', '/operacoes-financeiras', s.token, { ...docCom(e, s.local, [{ produto: e.sal, unidade: 'SACO', quantidade: '1', valor_unitario: '1.00' }]), operation_id: opId() });
    assert.equal(saco.json().message, 'unidade incompatível com o produto (SACO exige produto em SACO com peso por saco); nada foi gravado');
    const litro = await A.req('POST', '/operacoes-financeiras', s.token, { ...docCom(e, s.local, [{ produto: e.sal, unidade: 'L', quantidade: '1', valor_unitario: '1.00' }]), operation_id: opId() });
    assert.match(litro.json().message, /litros \(L\)/);
    assert.equal(await foto(s.c), antes, 'nada gravado');
    const ok = await A.req('POST', '/operacoes-financeiras', s.token, { ...docCom(e, s.local, [{ produto: diesel, unidade: 'L', quantidade: '10', valor_unitario: '1.00' }]), operation_id: opId() });
    assert.equal(ok.statusCode, 201, ok.body);
  });
});

// ─── U4 ─────────────────────────────────────────────────────────────────────
const ID = /c[a-z0-9]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|op-[a-z0-9-]+/g;
const INSTANTES = new Set(['em', 'createdAt', 'updatedAt', 'created_date', 'updated_date', 'confirmado_em', 'cancelado_em', 'criado_em', 'atualizado_em', 'data_confirmacao', 'data_cancelamento']);
/**
 * JSON normalizado: ids (cuid/uuid/operation_id) → `#n` na ordem em que
 * aparecem; instantes de relógio → `<instante>`; chaves ordenadas.
 */
const normalizar = (valor, logins) => {
  /** @type {Map<string, string>} */
  const mapa = new Map();
  const token = (id) => {
    if (!mapa.has(id)) mapa.set(id, `#${mapa.size + 1}`);
    return mapa.get(id);
  };
  const rec = (v, chave) => {
    if (v === null || v === undefined) return null;
    if (INSTANTES.has(chave)) return '<instante>';
    if (v instanceof Date) return v.toISOString();
    if (Prisma.Decimal.isDecimal(v)) return v.toString();
    if (typeof v === 'string') return logins.reduce((t, l) => t.split(l).join('<login>'), v).replace(ID, token);
    if (typeof v === 'bigint') return v.toString();
    if (Array.isArray(v)) return v.map((x) => rec(x, chave));
    if (typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, rec(v[k], k)]));
    return v;
  };
  return JSON.stringify(rec(valor, ''));
};

describe('U4 — KG + SACO pela API: resposta e linhas iguais às de antes', () => {
  test('compra KG + SACO confirmada, venda e cancelamento: sha256 normalizado = o do HEAD e39d318b; rótulo KG também no SACO', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [
      { produto: e.sal, unidade: 'KG', quantidade: '250.5', valor_unitario: '2.345678' },
      { produto: e.racao, unidade: 'SACO', quantidade: '40', valor_unitario: '88.90' },
    ], { valor_desconto: '13.37', valor_acrescimo: '4.21', total: '4134.43' }));
    const venda = await A.criarConfirmar(s.token, docCom(e, s.local, [
      { produto: e.sal, unidade: 'KG', quantidade: '100', valor_unitario: '4.00' },
      { produto: e.racao, unidade: 'SACO', quantidade: '5', valor_unitario: '120.00' },
    ], { direcao: 'RECEBER' }));
    const cancelada = await A.ok(A.cancelarReq(s.token, venda.id, e.id));
    const p = prisma();
    const w = { where: { cliente_id: s.c }, orderBy: { id: /** @type {const} */ ('asc') } };
    const linhas = {
      itens: (await p.operacaoFinanceiraItem.findMany({ where: { cliente_id: s.c } })).sort((a, b) => `${a.valor_total}|${a.ordem}`.localeCompare(`${b.valor_total}|${b.ordem}`)),
      lotes: (await p.estoqueLoteNota.findMany(w)).sort((a, b) => `${a.produto_nome}|${a.quantidade_entrada}`.localeCompare(`${b.produto_nome}|${b.quantidade_entrada}`)),
      movimentos: (await p.movimentacaoEstoque.findMany(w)).sort((a, b) => `${a.produto_nome}|${a.tipo_detalhado}`.localeCompare(`${b.produto_nome}|${b.tipo_detalhado}`)),
      consumos: (await p.operacaoFinanceiraConsumoLote.findMany(w)).sort((a, b) => `${a.quantidade}`.localeCompare(`${b.quantidade}`)),
      titulos: (await p.tituloFinanceiro.findMany(w)).sort((a, b) => `${a.valor_original ?? ''}|${a.direcao ?? ''}`.localeCompare(`${b.valor_original ?? ''}|${b.direcao ?? ''}`)),
      produtos: (await p.produto.findMany(w)).map((x) => [x.nome_produto, x.estoque_atual.toString(), x.unidade_principal_estoque]).sort(),
    };
    assert.ok(linhas.movimentos.length >= 6, 'compra (2), venda (2) e estorno da venda (2)');
    assert.ok(linhas.movimentos.every((m) => m.unidade_medida === 'KG'), 'rótulo KG em todos, inclusive do Produto SACO');
    const json = normalizar({ compra, venda, cancelada, linhas }, [s.admLogin]);
    assert.equal(sha(json), HASH_API_ANTES, 'o caminho KG/SACO mudou: resposta e linhas têm de ser as de antes');
  });
});

// ─── U5 ─────────────────────────────────────────────────────────────────────
describe('U5 — mensagens com a unidade do item', () => {
  const caso = (unidade, extra = {}) => planoPuro({ itens: [{ unidade, produto_unidade: unidade, ...extra }] });
  test('quantidade_estoque_zero e valor_excede_limite_estoque: "em L" para L; texto de hoje para KG e SACO', () => {
    const zeroL = caso('L', { quantidade: '1', quantidade_bruta: '0.00001', valor_unitario: '100000' }).erro;
    assert.deepEqual([zeroL?.code, zeroL?.details?.reason, zeroL?.message], ['OPERACAO_VALORES_INVALIDOS', 'quantidade_estoque_zero', 'a quantidade em L (arredondada a 4 casas) é zero']);
    const zeroKg = caso('KG', { quantidade: '1', quantidade_bruta: '0.00001', valor_unitario: '100000' }).erro;
    assert.equal(zeroKg?.message, 'a quantidade em kg (arredondada a 4 casas) é zero');
    const zeroSaco = caso('SACO', { quantidade: '1', valor_unitario: '10', peso_por_saco_kg: '0.00001' }).erro;
    assert.equal(zeroSaco?.message, 'a quantidade em kg (arredondada a 4 casas) é zero');
    const limiteL = caso('L', { quantidade: '9999999999', quantidade_bruta: '10000000000', valor_unitario: '0.01' }).erro;
    assert.deepEqual([limiteL?.details?.reason, limiteL?.message], ['valor_excede_limite_estoque', 'mercadoria acima do limite das colunas de estoque (9.999.999.999,9999 em L, custo por L e valor)']);
    const custoL = caso('L', { quantidade: '0.0001', valor_unitario: '9999999999' }).erro;
    assert.deepEqual([custoL?.details?.reason, custoL?.message], ['valor_excede_limite_estoque', 'mercadoria acima do limite das colunas de estoque (9.999.999.999,9999 em L, custo por L e valor)']);
    const limiteKg = caso('KG', { quantidade: '9999999999', quantidade_bruta: '10000000000', valor_unitario: '0.01' }).erro;
    assert.equal(limiteKg?.message, 'mercadoria acima do limite das colunas de estoque (9.999.999.999,9999 em kg, custo por kg e valor)');
    const limiteSaco = caso('SACO', { quantidade: '9999999999', valor_unitario: '0.01', peso_por_saco_kg: '2' }).erro;
    assert.equal(limiteSaco?.message, 'mercadoria acima do limite das colunas de estoque (9.999.999.999,9999 em kg, custo por kg e valor)');
    // Resíduo de custo de um item L fala em L; mercadoria em UN cita as 3 unidades aceitas.
    const residuoL = caso('L', { quantidade: '100000', valor_unitario: '0.00001' }).erro;
    assert.deepEqual([residuoL?.details?.reason, residuoL?.message], ['custo_kg_nao_representavel', 'o custo por L com 4 casas não representa o valor líquido desta linha (o resíduo passa de 0,1% do líquido da linha, mínimo 1 unidade da moeda); revise quantidade, unidade ou valores']);
    const un = caso('UN', { quantidade: '1', valor_unitario: '10' }).erro;
    assert.deepEqual([un?.details?.reason, un?.message], ['unidade_invalida', 'mercadoria usa a unidade KG, SACO ou L']);
    // Plano de um item L: fator 1 e quantidade em estoque = a quantidade (4 casas).
    const okL = caso('L', { quantidade: '1000', valor_unitario: '6' }).ok;
    assert.deepEqual([okL?.itens[0].unidade, okL?.itens[0].fator_kg.toString(), okL?.itens[0].quantidade_estoque.toFixed(4)], ['L', '1', '1000.0000']);
  });
});
