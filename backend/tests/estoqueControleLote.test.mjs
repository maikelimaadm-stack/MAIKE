/**
 * D-PROD-282 — controle de lote (e de validade) por produto. PostgreSQL real, pela API (usuário autenticado).
 *
 * Números feitos à mão (em kg, custo por kg):
 *  - L1: E_A 100 kg a 4,00 (lote A, vence 31/12/2027), E_B 50 kg a 6,00 (lote B, vence 01/08/2027),
 *        E_C 40 kg a 5,00 (lote C, vence 31/01/2028).
 *  - FEFO: saída de 60 kg sem escolha → B 50 × 6 = 300 + A 10 × 4 = 40 → 340,0000; unitário 340 ÷ 60 = 5,6667.
 *  - Escolha manual: 20 kg do A → 80,0000. Divisão: 10 do A (40) + 20 do C (100) → 140,0000, unitário 4,6667.
 *  - Nenhuma camada é reavaliada: A segue a 4,0000 e C a 5,0000 depois das saídas.
 *  - Transferência: 15 kg do C para L2 → 75,0000; a camada no destino nasce lote C, vence 31/01/2028, custo 5,0000.
 *  - Produto SEM lote (sem regressão): 10 a 2 + 10 a 4, saída de 5 → 15,0000 a 3,0000 (médio) e o resto a 3,0000.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { http, prisma } from './patrimonioP1Cenario.mjs';
import { montarAbastecimento } from './patrimonioP1AbastecimentoCenario.mjs';
import { auditarReplayDoProduto } from '../src/modules/estoqueRecalculo/estoqueRecalculoService.js';
import { emLeituraSomente } from '../src/modules/estoqueRecalculo/estoqueRecalculoLeitor.js';
import { consumirPorLote, ordenarFefo } from '../src/modules/estoqueFisico/estoqueFisicoMotor.js';

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

const hoje = () => new Date().toISOString().slice(0, 10);
const ok = (r, status = 200) => {
  assert.equal(r.statusCode, status, r.body);
  return r.json();
};
const erro = (r, status, code, reason) => {
  assert.equal(r.statusCode, status, r.body);
  const b = r.json();
  if (code) assert.equal(b.code, code, r.body);
  if (reason) assert.equal(b.reason ?? b.details?.reason, reason, r.body);
  return b;
};
const v4 = (d) => (d === null || d === undefined ? null : Number(d).toFixed(4));
const dia = (d) => (d ? d.toISOString().slice(0, 10) : null);

const montar = async () => {
  const s = await montarAbastecimento(app, { lotes: false });
  const p = prisma();
  const suf = randomUUID().slice(0, 6);
  const sal = await p.produto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_produto: `SAL-${suf}`, nome_produto: `Vermífugo ${suf}`, unidade_principal_estoque: 'KG' } });
  const semLote = await p.produto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_produto: `SL-${suf}`, nome_produto: `Sal comum ${suf}`, unidade_principal_estoque: 'KG' } });
  const motivosEntrada = (await H.ok(H.req('GET', '/estoque/motivos-entrada', s.token))).items;
  const motivosSaida = (await H.ok(H.req('GET', '/estoque/motivos-saida', s.token))).items;
  const compra = motivosEntrada.find((m) => m.nome === 'Compra').id;
  const perda = motivosSaida.find((m) => m.nome === 'Perda').id;
  ok(await H.req('PUT', '/perfis-financeiros-empresa', s.token, { empresa_id: s.e1.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' }));
  // O produto com lote nasce "sem lote" (padrão Não) e passa a controlar lote e validade com saldo zero.
  const marcado = ok(await H.req('PATCH', `/produtos/${sal.id}`, s.token, { controla_lote: true, controla_validade: true }));
  assert.deepEqual([marcado.controla_lote, marcado.controla_validade], [true, true]);
  return { ...s, sal, semLote, compra, perda };
};

const entrar = async (x, local, kg, custo, lote, validade, produto = x.sal) =>
  H.req('POST', '/estoque/entradas', x.token, {
    empresa_id: x.e1.id, operation_id: `en-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(),
    itens: [{ produto_id: produto.id, local_estoque_id: local.id, unidade: 'KG', quantidade: kg, custo_unitario: custo, lote_fabricante: lote, data_validade: validade }],
  });
const sair = (x, local, kg, lotes, produto = x.sal) =>
  H.req('POST', '/estoque/saidas', x.token, {
    empresa_id: x.e1.id, operation_id: `sa-${randomUUID()}`, motivo_id: x.perda, data_saida: hoje(),
    itens: [{ produto_id: produto.id, local_estoque_id: local.id, unidade: 'KG', quantidade: kg, ...(lotes ? { lotes } : {}) }],
  });
const transferir = (x, origem, destino, kg, lotes) =>
  H.req('POST', '/movimentacoes-estoque/comandos/transferencia-locais', x.token, {
    operation_id: `tr-${randomUUID()}`, empresa_id: x.e1.id, produto_id: x.sal.id, local_origem_id: origem.id, local_destino_id: destino.id, quantidade: kg,
    ...(lotes ? { lotes } : {}),
  });
const lotesDisponiveis = async (x, local, produto = x.sal) =>
  ok(await H.req('GET', `/estoque/lotes-disponiveis?empresa_id=${x.e1.id}&produto_id=${produto.id}&local_estoque_id=${local.id}`, x.token));
const mov = (id) => prisma().movimentacaoEstoque.findUnique({ where: { id } });
const movDoItem = (doc) => mov(doc.itens[0].movimentacao_estoque_id);
const camadaDe = async (doc) => prisma().estoqueLoteNota.findFirst({ where: { movimentacao_entrada_id: doc.itens[0].movimentacao_estoque_id } });
const camada = async (id) => {
  const l = await prisma().estoqueLoteNota.findUnique({ where: { id } });
  return { disp: v4(l.quantidade_disponivel), custo: v4(l.custo_unitario), status: l.status, lote: l.lote_fabricante, validade: dia(l.data_validade) };
};
const provarReplay = async (x, produto = x.sal) => {
  const r = await emLeituraSomente((tx) => auditarReplayDoProduto(tx, x.c, x.e1.id, produto.id));
  assert.equal(r.reproduzivel, true, JSON.stringify({ problemas: r.problemas, parada: r.parada }));
  assert.deepEqual(r.divergencias, [], JSON.stringify(r.divergencias.slice(0, 5)));
  return r;
};

/** As três entradas de L1 (A, B, C). */
const tresLotes = async (x) => {
  const a = ok(await entrar(x, x.local, '100', '4', 'A', '2027-12-31'), 201);
  const b = ok(await entrar(x, x.local, '50', '6', 'B', '2027-08-01'), 201);
  const c = ok(await entrar(x, x.local, '40', '5', 'C', '2028-01-31'), 201);
  return { a, b, c, A: (await camadaDe(a)).id, B: (await camadaDe(b)).id, C: (await camadaDe(c)).id };
};

describe('L1 — entrada exige lote e validade conforme o produto', () => {
  test('sem lote → 422 ESTOQUE_LOTE_OBRIGATORIO lote_obrigatorio; sem validade → validade_obrigatoria; com os dois, a camada guarda lote e validade; produto sem lote ignora', async () => {
    const x = await montar();
    erro(await entrar(x, x.local, '10', '4', null, '2027-12-31'), 422, 'ESTOQUE_LOTE_OBRIGATORIO', 'lote_obrigatorio');
    erro(await entrar(x, x.local, '10', '4', 'A', null), 422, 'ESTOQUE_LOTE_OBRIGATORIO', 'validade_obrigatoria');
    assert.equal(await prisma().estoqueLoteNota.count({ where: { cliente_id: x.c } }), 0, 'nada gravado');
    const e = ok(await entrar(x, x.local, '10', '4', 'A', '2027-12-31'), 201);
    assert.deepEqual(await camada((await camadaDe(e)).id), { disp: '10.0000', custo: '4.0000', status: 'Disponivel', lote: 'A', validade: '2027-12-31' });
    const s = ok(await entrar(x, x.local, '10', '2', 'X', '2027-12-31', x.semLote), 201);
    const l = await camada((await camadaDe(s)).id);
    assert.deepEqual([l.lote, l.validade], [null, null], 'produto sem lote: a camada fica sem lote, como hoje');
  });
});

describe('L2 — FEFO, escolha manual, divisão e custo do lote', () => {
  test('FEFO 60 kg → B 50 × 6 + A 10 × 4 = 340 (5,6667); manual 20 do A = 80; divisão 10 A + 20 C = 140 (4,6667); nenhuma camada reavaliada', async () => {
    const x = await montar();
    const L = await tresLotes(x);
    const sug = await lotesDisponiveis(x, x.local);
    assert.deepEqual(sug.lotes.map((l) => l.lote_fabricante), ['B', 'A', 'C'], 'a sugestão já vem na ordem FEFO');
    assert.equal(sug.controla_lote, true);

    const s1 = ok(await sair(x, x.local, '60'), 201);
    const m1 = await movDoItem(s1);
    assert.deepEqual([m1.modo_saida_fifo, v4(m1.valor_total), v4(m1.valor_unitario)], ['LOTE', '340.0000', '5.6667']);
    assert.deepEqual(m1.lotes_consumidos, [
      { lote_id: L.B, quantidade: '50.0000', custo_unitario: '6.0000' },
      { lote_id: L.A, quantidade: '10.0000', custo_unitario: '4.0000' },
    ]);
    assert.deepEqual([v4(s1.itens[0].custo_unitario), v4(s1.itens[0].valor_total)], ['5.6667', '340.0000']);

    const s2 = ok(await sair(x, x.local, '20', [{ estoque_lote_nota_id: L.A, quantidade: '20' }]), 201);
    assert.deepEqual([v4((await movDoItem(s2)).valor_total)], ['80.0000']);

    const s3 = ok(await sair(x, x.local, '30', [{ estoque_lote_nota_id: L.A, quantidade: '10' }, { estoque_lote_nota_id: L.C, quantidade: '20' }]), 201);
    const m3 = await movDoItem(s3);
    assert.deepEqual([v4(m3.valor_total), v4(m3.valor_unitario)], ['140.0000', '4.6667']);

    assert.deepEqual(await camada(L.A), { disp: '60.0000', custo: '4.0000', status: 'Disponivel', lote: 'A', validade: '2027-12-31' });
    assert.deepEqual(await camada(L.B), { disp: '0.0000', custo: '6.0000', status: 'Esgotado', lote: 'B', validade: '2027-08-01' });
    assert.deepEqual(await camada(L.C), { disp: '20.0000', custo: '5.0000', status: 'Disponivel', lote: 'C', validade: '2028-01-31' });
    await provarReplay(x);
  });

  test('recusas: lote sem saldo, soma diferente, lote repetido, lote de outro depósito, lotes em produto sem lote; nada gravado', async () => {
    const x = await montar();
    const L = await tresLotes(x);
    const antes = await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } });
    erro(await sair(x, x.local, '200', [{ estoque_lote_nota_id: L.A, quantidade: '200' }]), 422, 'ESTOQUE_LOTE_INVALIDO', 'lote_sem_saldo');
    erro(await sair(x, x.local, '30', [{ estoque_lote_nota_id: L.A, quantidade: '20' }]), 422, 'ESTOQUE_LOTE_INVALIDO', 'lotes_nao_somam');
    erro(await sair(x, x.local, '20', [{ estoque_lote_nota_id: L.A, quantidade: '10' }, { estoque_lote_nota_id: L.A, quantidade: '10' }]), 422, 'ESTOQUE_LOTE_INVALIDO', 'lote_repetido');
    erro(await sair(x, x.local2, '10', [{ estoque_lote_nota_id: L.A, quantidade: '10' }]), 422, 'ESTOQUE_LOTE_INVALIDO', 'lote_indisponivel');
    ok(await entrar(x, x.local, '10', '2', 'X', '2027-12-31', x.semLote), 201);
    const cs = await prisma().estoqueLoteNota.findFirst({ where: { produto_id: x.semLote.id } });
    erro(await sair(x, x.local, '5', [{ estoque_lote_nota_id: cs.id, quantidade: '5' }], x.semLote), 422, 'ESTOQUE_LOTE_INVALIDO', 'produto_sem_controle_de_lote');
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } }), antes + 1, 'só a entrada do produto sem lote foi gravada');
  });

  test('função pura: sem validade vai por último; empate de validade pela entrada mais antiga', () => {
    const t = (d) => new Date(`${d}T00:00:00.000Z`);
    const camadas = [
      { id: 'c', quantidade_disponivel: '5', custo_unitario: '1', data_validade: null, data_documento: t('2027-01-01'), createdAt: t('2027-01-01') },
      { id: 'b', quantidade_disponivel: '5', custo_unitario: '2', data_validade: t('2027-09-01'), data_documento: t('2027-03-01'), createdAt: t('2027-03-01') },
      { id: 'a', quantidade_disponivel: '5', custo_unitario: '3', data_validade: t('2027-09-01'), data_documento: t('2027-02-01'), createdAt: t('2027-02-01') },
    ];
    assert.deepEqual(ordenarFefo(camadas).map((l) => l.id), ['a', 'b', 'c']);
    const r = consumirPorLote(camadas, '7');
    // a 5 × 3 = 15 + b 2 × 2 = 4 → 19; unitário 19 ÷ 7 = 2,7143
    assert.deepEqual([r.valorTotal.toFixed(4), r.valorUnitario.toFixed(4), r.camadasRestantes.length], ['19.0000', '2.7143', 0]);
  });
});

describe('L3 — transferência leva lote e validade', () => {
  test('15 kg do C para L2 → 75,0000; a camada no destino nasce lote C, vence 31/01/2028, custo 5; uma entrada nova em L2 (D a 9) não reavalia a C', async () => {
    const x = await montar();
    const L = await tresLotes(x);
    const t = ok(await transferir(x, x.local, x.local2, 15, [{ estoque_lote_nota_id: L.C, quantidade: '15' }]), 201);
    const s = await mov(t.movimentacao_saida.id);
    assert.deepEqual([s.modo_saida_fifo, v4(s.valor_total)], ['LOTE', '75.0000']);
    const destino = await prisma().estoqueLoteNota.findFirst({ where: { movimentacao_entrada_id: t.movimentacao_entrada.id } });
    assert.deepEqual(await camada(destino.id), { disp: '15.0000', custo: '5.0000', status: 'Disponivel', lote: 'C', validade: '2028-01-31' });
    ok(await entrar(x, x.local2, '10', '9', 'D', '2029-01-01'), 201);
    const s2 = ok(await sair(x, x.local2, '5', [{ estoque_lote_nota_id: destino.id, quantidade: '5' }]), 201);
    assert.equal(v4((await movDoItem(s2)).valor_total), '25.0000', 'sai a 5 (o custo da camada C), não pelo médio de L2');
    assert.equal((await camada(destino.id)).custo, '5.0000');
    await provarReplay(x);
  });
});

describe('L4 — lote vencido avisa e deixa usar', () => {
  test('validade antes de hoje: a lista diz vencido; a saída escolhendo o lote vencido é aceita', async () => {
    const x = await montar();
    const v = ok(await entrar(x, x.local, '10', '3', 'VENC', '2027-01-10'), 201);
    const l = (await lotesDisponiveis(x, x.local)).lotes[0];
    assert.deepEqual([l.lote_fabricante, l.vencido, l.vence_em_dias < 0], ['VENC', true, true]);
    const id = (await camadaDe(v)).id;
    const s = ok(await sair(x, x.local, '4', [{ estoque_lote_nota_id: id, quantidade: '4' }]), 201);
    assert.equal(v4((await movDoItem(s)).valor_total), '12.0000');
  });
});

describe('L5 — troca do "Controla lote" só com saldo zero', () => {
  test('com saldo → 409 PRODUTO_LOTE_TROCA_COM_SALDO; validade sem lote → 400; zerado pela saída → troca aceita', async () => {
    const x = await montar();
    ok(await entrar(x, x.local, '10', '2', null, null, x.semLote), 201);
    erro(await H.req('PATCH', `/produtos/${x.semLote.id}`, x.token, { controla_lote: true }), 409, 'PRODUTO_LOTE_TROCA_COM_SALDO', 'saldo_nao_zero');
    erro(await H.req('PATCH', `/produtos/${x.semLote.id}`, x.token, { controla_validade: true }), 400, 'REQUEST_VALIDATION_FAILED', 'validade_sem_lote');
    ok(await sair(x, x.local, '10', null, x.semLote), 201);
    const p = ok(await H.req('PATCH', `/produtos/${x.semLote.id}`, x.token, { controla_lote: true }));
    assert.equal(p.controla_lote, true);
    // E o contrário, com saldo, também recusa.
    ok(await entrar(x, x.local, '5', '4', 'A', '2027-12-31'), 201);
    erro(await H.req('PATCH', `/produtos/${x.sal.id}`, x.token, { controla_lote: false, controla_validade: false }), 409, 'PRODUTO_LOTE_TROCA_COM_SALDO', 'saldo_nao_zero');
  });
});

describe('L6 — exclusões', () => {
  /** D-PROD-313: 409 ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR apontando o registro mais recente que ainda vale. */
  const recusaPosterior = (r, posteriorMovId) => {
    const b = erro(r, 409, 'ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR', 'registro_posterior');
    assert.equal(b.details.posterior_id, posteriorMovId, r.body);
    return b;
  };
  const excluirSaida = (x, doc) => H.req('POST', `/estoque/saidas/${doc.id}/excluir`, x.token, { empresa_id: x.e1.id, versao: doc.versao, motivo: 'lançada errada', operation_id: `ex-${randomUUID()}` });
  const excluirEntrada = (x, doc) => H.req('POST', `/estoque/entradas/${doc.id}/excluir`, x.token, { empresa_id: x.e1.id, versao: doc.versao, motivo: 'lançada errada', operation_id: `ex-${randomUUID()}` });
  const retrato = async (x, L) => ({
    movimentos: await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } }),
    ativos: await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c, status: 'Ativa' } }),
    A: await camada(L.A), B: await camada(L.B), C: await camada(L.C),
  });

  test('D-PROD-313: excluir a saída com outra saída depois → 409 registro posterior, nada gravado; exclui a mais recente primeiro e a saída devolve ao mesmo lote pelo custo dele; replay = gravado', async () => {
    const x = await montar();
    const L = await tresLotes(x);
    const s1 = ok(await sair(x, x.local, '20', [{ estoque_lote_nota_id: L.A, quantidade: '20' }]), 201);
    const s2 = ok(await sair(x, x.local, '10', [{ estoque_lote_nota_id: L.C, quantidade: '10' }]), 201); // depois, no mesmo depósito
    const antes = await retrato(x, L);
    recusaPosterior(await excluirSaida(x, s1), s2.itens[0].movimentacao_estoque_id);
    assert.deepEqual(await retrato(x, L), antes, 'nada gravado');
    // Do mais recente para o mais antigo: a s2 sai, depois a s1.
    ok(await excluirSaida(x, s2));
    ok(await excluirSaida(x, s1));
    assert.deepEqual(await camada(L.A), { disp: '100.0000', custo: '4.0000', status: 'Disponivel', lote: 'A', validade: '2027-12-31' });
    assert.deepEqual(await camada(L.C), { disp: '40.0000', custo: '5.0000', status: 'Disponivel', lote: 'C', validade: '2028-01-31' });
    await provarReplay(x);
  });

  test('excluir a entrada de um lote que já teve saída → 409 (D-PROD-313: registro posterior), nada gravado; excluídas a saída e as entradas do mais recente para o mais antigo, a de um lote intocado sai', async () => {
    const x = await montar();
    const L = await tresLotes(x);
    const s = ok(await sair(x, x.local, '10', [{ estoque_lote_nota_id: L.C, quantidade: '10' }]), 201);
    const antes = await retrato(x, L);
    // D-PROD-313: a recusa lote_consumido agora é precedida pela do registro posterior (toda saída do lote é posterior à entrada dele).
    recusaPosterior(await excluirEntrada(x, L.c), s.itens[0].movimentacao_estoque_id);
    // O B não teve saída, mas a entrada C e a saída vieram depois dele no mesmo depósito: a mais recente (a saída) vincula.
    recusaPosterior(await excluirEntrada(x, L.b), s.itens[0].movimentacao_estoque_id);
    assert.deepEqual(await retrato(x, L), antes, 'nada gravado');
    // Do mais recente para o mais antigo: a saída, a entrada C, a entrada B.
    ok(await excluirSaida(x, s));
    ok(await excluirEntrada(x, L.c));
    assert.deepEqual([(await camada(L.C)).status, (await camada(L.C)).disp], ['Estornado', '0.0000']);
    ok(await excluirEntrada(x, L.b));
    assert.deepEqual([(await camada(L.B)).status, (await camada(L.B)).disp], ['Estornado', '0.0000']);
    assert.deepEqual(await camada(L.A), { disp: '100.0000', custo: '4.0000', status: 'Disponivel', lote: 'A', validade: '2027-12-31' });
    await provarReplay(x);
  });
});

describe('L7 — ajuste de inventário com lote', () => {
  test('sobra do lote A entra a 4 (custo do lote); sobra de lote novo sem custo → 422, com custo → informado; falta escolhendo o C sai a 5', async () => {
    const x = await montar();
    const L = await tresLotes(x); // saldo L1: 190
    const ajustar = (itens) => H.req('POST', '/estoque/ajustes', x.token, { empresa_id: x.e1.id, operation_id: `aj-${randomUUID()}`, itens });
    const base = { produto_id: x.sal.id, local_estoque_id: x.local.id, unidade: 'KG' };
    erro(await ajustar([{ ...base, quantidade_contada: '200' }]), 422, undefined, 'lote_obrigatorio');
    const a1 = ok(await ajustar([{ ...base, quantidade_contada: '200', lote_fabricante: 'A' }]), 201);
    assert.deepEqual([a1.itens[0].tipo, v4(a1.itens[0].custo_unitario), v4(a1.itens[0].valor_total), a1.itens[0].custo_informado], ['SOBRA', '4.0000', '40.0000', false]);
    const sobra = await prisma().estoqueLoteNota.findFirst({ where: { movimentacao_entrada_id: a1.itens[0].movimentacao_estoque_id } });
    assert.deepEqual([sobra.lote_fabricante, dia(sobra.data_validade)], ['A', '2027-12-31'], 'herda a validade do lote A');
    erro(await ajustar([{ ...base, quantidade_contada: '205', lote_fabricante: 'NOVO', data_validade: '2028-05-01' }]), 422, undefined, 'custo_obrigatorio_sem_saldo');
    const a2 = ok(await ajustar([{ ...base, quantidade_contada: '205', lote_fabricante: 'NOVO', data_validade: '2028-05-01', custo_unitario: '7' }]), 201);
    assert.deepEqual([v4(a2.itens[0].valor_total), a2.itens[0].custo_informado], ['35.0000', true]);
    const a3 = ok(await ajustar([{ ...base, quantidade_contada: '195', lotes: [{ estoque_lote_nota_id: L.C, quantidade: '10' }] }]), 201);
    assert.deepEqual([a3.itens[0].tipo, v4(a3.itens[0].valor_total)], ['FALTA', '50.0000']);
    await provarReplay(x);
  });
});

describe('L8 — produto sem lote: sem regressão', () => {
  test('10 a 2 + 10 a 4, saída de 5 → 15 a 3,0000 pelo médio (CUSTO_MEDIO) e o restante reavaliado a 3,0000', async () => {
    const x = await montar();
    ok(await entrar(x, x.local, '10', '2', null, null, x.semLote), 201);
    ok(await entrar(x, x.local, '10', '4', null, null, x.semLote), 201);
    const s = ok(await sair(x, x.local, '5', null, x.semLote), 201);
    const m = await movDoItem(s);
    assert.deepEqual([m.modo_saida_fifo, v4(m.valor_total), v4(m.valor_unitario)], ['CUSTO_MEDIO', '15.0000', '3.0000']);
    const custos = (await prisma().estoqueLoteNota.findMany({ where: { produto_id: x.semLote.id, status: 'Disponivel' } })).map((l) => v4(l.custo_unitario));
    assert.deepEqual(custos, ['3.0000', '3.0000']);
    await provarReplay(x, x.semLote);
  });
});
