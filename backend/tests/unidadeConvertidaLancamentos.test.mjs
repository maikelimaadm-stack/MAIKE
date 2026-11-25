/**
 * D-PROD-309 — a quantidade digitada numa UNIDADE DE CONVERSÃO do cadastro do produto (D-PROD-288) no cocho, nas duas
 * transferências entre depósitos (a do mapa e a da tela Estoque, o mesmo comando) e na linha de produto da atividade.
 * Emenda da Constituição aprovada pelo proprietário em 2026-11-25. PostgreSQL real, pela API.
 *
 * Para cada origem:
 *  - a conversão converte pelo cadastro (o motor da compra do financeiro: uma conta, 4 casas) e grava a unidade, a
 *    quantidade digitada e o fator; a quantidade do movimento (e da linha) fica na unidade de estoque;
 *  - unidade inválida (desativada, desconhecida, de outro produto) → 422 `UNIDADE_LANCAMENTO_INVALIDA`, nada gravado; a
 *    `quantidade` de estoque enviada junto que não bate com a conta → 422 `quantidade_divergente`;
 *  - sem unidade → como sempre (nada a mais gravado);
 *  - editar / reenviar mantém o fator GRAVADO (o cadastro mudou depois);
 *  - a escolha do lote (D-PROD-300) com a unidade: os lotes continuam na unidade de ESTOQUE.
 * E a sigla usada num desses lançamentos não se apaga do cadastro: fica desativada.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { http, prisma } from './patrimonioP1Cenario.mjs';
import { montarAbastecimento } from './patrimonioP1AbastecimentoCenario.mjs';

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
const opId = () => `op-${randomUUID()}`;
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
/** As 3 colunas da unidade digitada de um registro (movimento ou linha). */
const unidadeDe = (r) => [r.unidade_lancamento ?? null, v4(r.quantidade_lancamento), v4(r.fator_lancamento)];
const SEM = [null, null, null];

const montar = async () => {
  const s = await montarAbastecimento(app, { lotes: false });
  const p = prisma();
  const suf = randomUUID().slice(0, 6);
  const novo = (prefixo, nome) => p.produto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_produto: `${prefixo}-${suf}`, nome_produto: `${nome} ${suf}`, unidade_principal_estoque: 'KG' } });
  const racao = await novo('RA', 'Ração');
  const sal = await novo('SAL', 'Sal mineral com lote');
  const outro = await novo('OU', 'Outro produto');
  const motivosEntrada = (await H.ok(H.req('GET', '/estoque/motivos-entrada', s.token))).items;
  const compra = motivosEntrada.find((m) => m.nome === 'Compra').id;
  // Ração: SACO ×25, G ÷1000 e o BALDE desativado.
  const cadastro = (produto, lista) => H.req('PATCH', `/produtos/${produto.id}`, s.token, { unidades_conversao: lista });
  ok(await cadastro(racao, [
    { sigla: 'SACO', operacao: 'MULTIPLICA', fator: '25' },
    { sigla: 'G', operacao: 'DIVIDE', fator: '1000' },
    { sigla: 'BALDE', operacao: 'MULTIPLICA', fator: '20', ativa: false },
  ]));
  ok(await cadastro(outro, [{ sigla: 'SC', operacao: 'MULTIPLICA', fator: '40' }]));
  ok(await H.req('PATCH', `/produtos/${sal.id}`, s.token, { controla_lote: true, controla_validade: true }));
  ok(await cadastro(sal, [{ sigla: 'BALDE', operacao: 'MULTIPLICA', fator: '4' }]));
  const grupo = await p.grupoAtividade.create({ data: { cliente_id: s.c, nome_grupo: `GRUPO ${suf}` } });
  const tipo = await p.tipoAtividade.create({ data: { cliente_id: s.c, nome_tipo: `ADUBAÇÃO ${suf}`, grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo, permite_produto: true } });
  const conversoes = async (produto) => p.produtoUnidadeConversao.findMany({ where: { produto_id: produto.id }, orderBy: { sigla: 'asc' } });
  const idDaSigla = async (produto, sigla) => (await conversoes(produto)).find((c) => c.sigla === sigla).id;
  return { ...s, racao, sal, outro, compra, tipo, cadastro, conversoes, idDaSigla };
};

const entrar = async (x, produto, local, kg, custo, lote = null, validade = null) =>
  ok(await H.req('POST', '/estoque/entradas', x.token, {
    empresa_id: x.e1.id, operation_id: `en-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(),
    itens: [{ produto_id: produto.id, local_estoque_id: local.id, unidade: 'KG', quantidade: kg, custo_unitario: custo, lote_fabricante: lote, data_validade: validade }],
  }), 201);
const idDoLote = async (produto, lote) => (await prisma().estoqueLoteNota.findFirst({ where: { produto_id: produto.id, lote_fabricante: lote } })).id;
/** Dois lotes do sal no depósito: B 50 a 6 (vence antes) e A 100 a 4. */
const doisLotes = async (x) => {
  await entrar(x, x.sal, x.local, '50', '6', 'B', '2027-08-01');
  await entrar(x, x.sal, x.local, '100', '4', 'A', '2027-12-31');
  return { B: await idDoLote(x.sal, 'B'), A: await idDoLote(x.sal, 'A') };
};
const movimentos = (x) => prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } });
const saldo = async (produto, local) => {
  const ls = await prisma().estoqueLoteNota.findMany({ where: { produto_id: produto.id, local_estoque_id: local.id, status: 'Disponivel' } });
  return ls.reduce((t, l) => t + Number(l.quantidade_disponivel), 0).toFixed(4);
};

// ── Cocho ───────────────────────────────────────────────────────────────────
const saidaCocho = (x, produto, corpo) =>
  H.req('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', x.token, {
    operation_id: `sup-${randomUUID()}`, empresa_id: x.e1.id, produto_id: produto.id, local_origem_id: x.local.id,
    ponto_suplementacao_id: 'ponto-1', data_movimentacao: '2027-06-10', ...corpo,
  });

describe('UC-1 — cocho', () => {
  test('2 SACO (sigla ou id) → 50 kg; o movimento grava SACO, 2 e o fator 25; com a quantidade de estoque junto, confere', async () => {
    const x = await montar();
    await entrar(x, x.racao, x.local, '500', '2');
    const r1 = ok(await saidaCocho(x, x.racao, { unidade_lancamento: 'SACO', quantidade_lancamento: '2' }), 201);
    assert.equal(v4(r1.movimentacao.quantidade), '50.0000');
    assert.deepEqual(unidadeDe(r1.movimentacao), ['SACO', '2.0000', '25.0000']);
    const id = await x.idDaSigla(x.racao, 'SACO');
    const r2 = ok(await saidaCocho(x, x.racao, { unidade_lancamento: id, quantidade_lancamento: 1.5, quantidade: 37.5 }), 201);
    assert.deepEqual([v4(r2.movimentacao.quantidade), ...unidadeDe(r2.movimentacao)], ['37.5000', 'SACO', '1.5000', '25.0000']);
    // DIVIDE: 2500 G ÷ 1000 = 2,5 kg; o fator gravado é o multiplicador (0,001).
    const r3 = ok(await saidaCocho(x, x.racao, { unidade_lancamento: 'G', quantidade_lancamento: '2500' }), 201);
    assert.deepEqual([v4(r3.movimentacao.quantidade), ...unidadeDe(r3.movimentacao)], ['2.5000', 'G', '2500.0000', '0.0010']);
    assert.equal(await saldo(x.racao, x.local), '410.0000');
  });

  test('unidade inválida → 422 UNIDADE_LANCAMENTO_INVALIDA (desativada, desconhecida, de outro produto, quantidade divergente); nada gravado', async () => {
    const x = await montar();
    await entrar(x, x.racao, x.local, '500', '2');
    const antes = await movimentos(x);
    erro(await saidaCocho(x, x.racao, { unidade_lancamento: 'BALDE', quantidade_lancamento: '1' }), 422, 'UNIDADE_LANCAMENTO_INVALIDA', 'unidade_inativa');
    erro(await saidaCocho(x, x.racao, { unidade_lancamento: 'TAMBOR', quantidade_lancamento: '1' }), 422, 'UNIDADE_LANCAMENTO_INVALIDA', 'unidade_nao_cadastrada');
    erro(await saidaCocho(x, x.racao, { unidade_lancamento: await x.idDaSigla(x.outro, 'SC'), quantidade_lancamento: '1' }), 422, 'UNIDADE_LANCAMENTO_INVALIDA', 'unidade_de_outro_produto');
    erro(await saidaCocho(x, x.racao, { unidade_lancamento: 'L', quantidade_lancamento: '1' }), 422, 'UNIDADE_LANCAMENTO_INVALIDA', 'unidade_incompativel');
    erro(await saidaCocho(x, x.racao, { unidade_lancamento: 'SACO', quantidade_lancamento: '2', quantidade: 40 }), 422, 'UNIDADE_LANCAMENTO_INVALIDA', 'quantidade_divergente');
    erro(await saidaCocho(x, x.racao, { unidade_lancamento: 'SACO' }), 400, 'REQUEST_VALIDATION_FAILED');
    assert.equal(await movimentos(x), antes, 'nada gravado');
    assert.equal(await saldo(x.racao, x.local), '500.0000');
  });

  test('sem unidade → como sempre (as 3 colunas nulas); a própria unidade de estoque também não grava nada a mais', async () => {
    const x = await montar();
    await entrar(x, x.racao, x.local, '500', '2');
    const r = ok(await saidaCocho(x, x.racao, { quantidade: 5 }), 201);
    assert.equal(v4(r.movimentacao.quantidade), '5.0000');
    assert.deepEqual(unidadeDe(r.movimentacao), SEM);
    const k = ok(await saidaCocho(x, x.racao, { unidade_lancamento: 'KG', quantidade_lancamento: '7' }), 201);
    assert.deepEqual([v4(k.movimentacao.quantidade), ...unidadeDe(k.movimentacao)], ['7.0000', ...SEM]);
  });

  test('reenvio (replay, a fila sem internet) depois de o fator mudar no cadastro devolve o GRAVADO (25); um lançamento novo usa o novo (30)', async () => {
    const x = await montar();
    await entrar(x, x.racao, x.local, '500', '2');
    const corpo = { operation_id: `sup-${randomUUID()}`, unidade_lancamento: 'SACO', quantidade_lancamento: '2' };
    const r1 = ok(await saidaCocho(x, x.racao, corpo), 201);
    ok(await x.cadastro(x.racao, [{ id: await x.idDaSigla(x.racao, 'SACO'), sigla: 'SACO', operacao: 'MULTIPLICA', fator: '30' }, { sigla: 'G', operacao: 'DIVIDE', fator: '1000' }]));
    const r2 = ok(await saidaCocho(x, x.racao, corpo));
    assert.equal(r2.replay, true);
    assert.equal(r2.movimentacao.id, r1.movimentacao.id);
    assert.deepEqual([v4(r2.movimentacao.quantidade), ...unidadeDe(r2.movimentacao)], ['50.0000', 'SACO', '2.0000', '25.0000']);
    const r3 = ok(await saidaCocho(x, x.racao, { unidade_lancamento: 'SACO', quantidade_lancamento: '2' }), 201);
    assert.deepEqual([v4(r3.movimentacao.quantidade), ...unidadeDe(r3.movimentacao)], ['60.0000', 'SACO', '2.0000', '30.0000']);
    assert.equal(await saldo(x.racao, x.local), '390.0000');
    // A mesma chave com outra unidade é outro corpo: 409.
    erro(await saidaCocho(x, x.racao, { ...corpo, quantidade_lancamento: '3' }), 409, 'IDEMPOTENCY_CONFLICT');
  });

  test('a escolha do lote com a unidade: 5 BALDE (×4) = 20 kg, lotes A 12 + B 8 (em kg) → 4 × 12 + 6 × 8 = 96; lotes que somam 5 → 422', async () => {
    const x = await montar();
    const L = await doisLotes(x);
    erro(await saidaCocho(x, x.sal, { unidade_lancamento: 'BALDE', quantidade_lancamento: '5', lotes: [{ estoque_lote_nota_id: L.A, quantidade: '5' }] }), 422, 'ESTOQUE_LOTE_INVALIDO', 'lotes_nao_somam');
    const r = ok(await saidaCocho(x, x.sal, { unidade_lancamento: 'BALDE', quantidade_lancamento: '5', quantidade: 20, lotes: [{ estoque_lote_nota_id: L.A, quantidade: '12' }, { estoque_lote_nota_id: L.B, quantidade: '8' }] }), 201);
    assert.equal(v4(r.movimentacao.valor_total), '96.0000');
    assert.deepEqual([v4(r.movimentacao.quantidade), ...unidadeDe(r.movimentacao)], ['20.0000', 'BALDE', '5.0000', '4.0000']);
    assert.deepEqual(r.rateio.map((f) => [f.lote_id, f.quantidade_consumida]), [[L.A, 12], [L.B, 8]]);
  });
});

// ── Transferências (mapa e tela Estoque: o mesmo comando) ──────────────────
const transferir = (x, produto, corpo, { doMapa = true } = {}) =>
  H.req('POST', '/movimentacoes-estoque/comandos/transferencia-locais', x.token, {
    operation_id: `trf-${randomUUID()}`, empresa_id: x.e1.id, produto_id: produto.id, local_origem_id: x.local.id, local_destino_id: x.local2.id,
    data_movimentacao: '2027-06-10',
    // O mapa manda os nomes e o rateio nas observações; a tela Estoque, só a observação digitada.
    ...(doMapa ? { local_origem_nome: x.local.nome, local_destino_nome: x.local2.nome, observacoes: 'Saída pelo depósito\n[RATEIO_FIFO] x' } : { observacoes: null }),
    ...corpo,
  });

describe('UC-2 — transferência entre depósitos (mapa e tela Estoque)', () => {
  for (const [nome, doMapa] of [['mapa', true], ['tela Estoque', false]]) {
    test(`${nome}: 2 SACO → 50 kg; as DUAS pernas gravam SACO, 2 e 25; o saldo muda em kg`, async () => {
      const x = await montar();
      await entrar(x, x.racao, x.local, '500', '2');
      const r = ok(await transferir(x, x.racao, { unidade_lancamento: 'SACO', quantidade_lancamento: '2', quantidade: 50 }, { doMapa }), 201);
      for (const m of [r.movimentacao_saida, r.movimentacao_entrada]) assert.deepEqual([v4(m.quantidade), ...unidadeDe(m)], ['50.0000', 'SACO', '2.0000', '25.0000']);
      assert.equal(await saldo(x.racao, x.local), '450.0000');
      assert.equal(await saldo(x.racao, x.local2), '50.0000');
    });
  }

  test('inválida → 422 (desativada, desconhecida, de outro produto, divergente), nada gravado; sem unidade, como sempre', async () => {
    const x = await montar();
    await entrar(x, x.racao, x.local, '500', '2');
    const antes = await movimentos(x);
    erro(await transferir(x, x.racao, { unidade_lancamento: 'BALDE', quantidade_lancamento: '1' }), 422, 'UNIDADE_LANCAMENTO_INVALIDA', 'unidade_inativa');
    erro(await transferir(x, x.racao, { unidade_lancamento: 'TAMBOR', quantidade_lancamento: '1' }), 422, 'UNIDADE_LANCAMENTO_INVALIDA', 'unidade_nao_cadastrada');
    erro(await transferir(x, x.racao, { unidade_lancamento: await x.idDaSigla(x.outro, 'SC'), quantidade_lancamento: '1' }), 422, 'UNIDADE_LANCAMENTO_INVALIDA', 'unidade_de_outro_produto');
    erro(await transferir(x, x.racao, { unidade_lancamento: 'SACO', quantidade_lancamento: '1', quantidade: 20 }), 422, 'UNIDADE_LANCAMENTO_INVALIDA', 'quantidade_divergente');
    assert.equal(await movimentos(x), antes, 'nada gravado');
    const r = ok(await transferir(x, x.racao, { quantidade: 10 }), 201);
    for (const m of [r.movimentacao_saida, r.movimentacao_entrada]) assert.deepEqual([v4(m.quantidade), ...unidadeDe(m)], ['10.0000', ...SEM]);
  });

  test('reenvio depois de o fator mudar devolve o GRAVADO; a escolha do lote com a unidade (5 BALDE = 20 kg, A 12 + B 8)', async () => {
    const x = await montar();
    await entrar(x, x.racao, x.local, '500', '2');
    const corpo = { operation_id: `trf-${randomUUID()}`, unidade_lancamento: 'SACO', quantidade_lancamento: '2' };
    const r1 = ok(await transferir(x, x.racao, corpo), 201);
    ok(await x.cadastro(x.racao, [{ sigla: 'SACO', operacao: 'MULTIPLICA', fator: '30' }]));
    const r2 = ok(await transferir(x, x.racao, corpo));
    assert.equal(r2.replay, true);
    assert.equal(r2.movimentacao_saida.id, r1.movimentacao_saida.id);
    assert.deepEqual(unidadeDe(r2.movimentacao_saida), ['SACO', '2.0000', '25.0000']);
    assert.equal(await saldo(x.racao, x.local2), '50.0000');
    const L = await doisLotes(x);
    const r = ok(await transferir(x, x.sal, { unidade_lancamento: 'BALDE', quantidade_lancamento: '5', lotes: [{ estoque_lote_nota_id: L.A, quantidade: '12' }, { estoque_lote_nota_id: L.B, quantidade: '8' }] }), 201);
    assert.deepEqual([v4(r.movimentacao_saida.quantidade), ...unidadeDe(r.movimentacao_saida)], ['20.0000', 'BALDE', '5.0000', '4.0000']);
    const destino = await prisma().estoqueLoteNota.findMany({ where: { produto_id: x.sal.id, local_estoque_id: x.local2.id }, orderBy: { lote_fabricante: 'asc' } });
    assert.deepEqual(destino.map((l) => [l.lote_fabricante, v4(l.quantidade_disponivel)]), [['A', '12.0000'], ['B', '8.0000']]);
  });
});

// ── Atividade ───────────────────────────────────────────────────────────────
let seq = 0;
const atividade = async (x) => {
  const a = ok(await H.req('POST', '/atividades', x.token, {
    empresa_id: x.e1.id, nome: `Adubação ${++seq}`, tipo_atividade_id: x.tipo.id, data_inicio: '2027-06-01', data_prevista_fim: '2027-06-30',
  }), 201);
  const base = `/atividades/${a.id}/apontamentos`;
  let ap = ok(await H.req('POST', base, x.token, { empresa_id: a.empresa_id, data_operacional: '2027-06-10', area_executada_dia: '10' }), 201).apontamento;
  const guardar = (r) => {
    if (r.statusCode < 300) ap = r.json().apontamento;
    return r;
  };
  return {
    lancar: async (produto, corpo) => guardar(await H.req('POST', `${base}/${ap.id}/produtos`, x.token, {
      empresa_id: a.empresa_id, versao: ap.versao, operation_id: opId(), produto_id: produto.id, local_estoque_id: x.local.id, ...corpo,
    })),
    editar: async (linha, campos) => guardar(await H.req('PATCH', `${base}/${ap.id}/produtos/${linha.id}`, x.token, { empresa_id: a.empresa_id, versao: ap.versao, operation_id: opId(), ...campos })),
    lancamento: (produtos) => H.req('POST', base, x.token, { empresa_id: a.empresa_id, data_operacional: '2027-06-11', area_executada_dia: '5', operation_id: opId(), produtos }),
  };
};
const movimentoDaLinha = (linha) => prisma().movimentacaoEstoque.findUnique({ where: { id: linha.movimentacao_estoque_id } });

describe('UC-3 — linha de produto da atividade', () => {
  test('2 SACO → 50 kg na linha (unidade KG) e no movimento, com SACO, 2 e 25; a dose/ha é em kg; as opções de produto trazem as conversões ativas', async () => {
    const x = await montar();
    await entrar(x, x.racao, x.local, '500', '2');
    const at = await atividade(x);
    const r = ok(await at.lancar(x.racao, { unidade_lancamento: 'SACO', quantidade_lancamento: '2' }), 201);
    assert.deepEqual([r.linha.quantidade, r.linha.unidade, ...unidadeDe(r.linha), r.linha.dose_ha], ['50.0000', 'KG', 'SACO', '2.0000', '25.0000', '5.0000']);
    assert.deepEqual(unidadeDe(await movimentoDaLinha(r.linha)), ['SACO', '2.0000', '25.0000']);
    const opcoes = ok(await H.req('GET', `/atividades-opcoes/produtos?empresa_id=${x.e1.id}&q=${encodeURIComponent(x.racao.nome_produto)}`, x.token));
    const item = (opcoes.items ?? opcoes.itens).find((o) => o.id === x.racao.id);
    assert.deepEqual(item.unidades_conversao.map((c) => [c.sigla, c.equivalencia]), [['SACO', '1 SACO = 25 KG'], ['G', '1 G = 0,001 KG']]);
  });

  test('inválida → 422 (desativada, desconhecida, de outro produto, divergente), nada gravado; sem unidade, como sempre', async () => {
    const x = await montar();
    await entrar(x, x.racao, x.local, '500', '2');
    const at = await atividade(x);
    const antes = await movimentos(x);
    erro(await at.lancar(x.racao, { unidade_lancamento: 'BALDE', quantidade_lancamento: '1' }), 422, 'UNIDADE_LANCAMENTO_INVALIDA', 'unidade_inativa');
    erro(await at.lancar(x.racao, { unidade_lancamento: 'TAMBOR', quantidade_lancamento: '1' }), 422, 'UNIDADE_LANCAMENTO_INVALIDA', 'unidade_nao_cadastrada');
    erro(await at.lancar(x.racao, { unidade_lancamento: await x.idDaSigla(x.outro, 'SC'), quantidade_lancamento: '1' }), 422, 'UNIDADE_LANCAMENTO_INVALIDA', 'unidade_de_outro_produto');
    erro(await at.lancar(x.racao, { unidade_lancamento: 'SACO', quantidade_lancamento: '1', quantidade: '20' }), 422, 'UNIDADE_LANCAMENTO_INVALIDA', 'quantidade_divergente');
    erro(await at.lancar(x.racao, { unidade_lancamento: 'SACO', quantidade_lancamento: 1 }), 400, 'REQUEST_VALIDATION_FAILED');
    assert.equal(await movimentos(x), antes, 'nada gravado');
    const r = ok(await at.lancar(x.racao, { quantidade: '10' }), 201);
    assert.deepEqual([r.linha.quantidade, ...unidadeDe(r.linha)], ['10.0000', ...SEM]);
    assert.deepEqual(unidadeDe(await movimentoDaLinha(r.linha)), SEM);
  });

  test('editar mantém o fator GRAVADO: o cadastro passa a 30, editar a observação fica em 50 kg (25); 3 SACO = 75 kg (25, não 30); só a quantidade em kg tira a conversão', async () => {
    const x = await montar();
    await entrar(x, x.racao, x.local, '500', '2');
    const at = await atividade(x);
    const r = ok(await at.lancar(x.racao, { unidade_lancamento: 'SACO', quantidade_lancamento: '2', quantidade: '50' }), 201);
    ok(await x.cadastro(x.racao, [{ sigla: 'SACO', operacao: 'MULTIPLICA', fator: '30' }, { sigla: 'G', operacao: 'DIVIDE', fator: '1000' }]));
    const e1 = ok(await at.editar(r.linha, { observacao: 'conferido' }));
    assert.deepEqual([e1.linha.quantidade, ...unidadeDe(e1.linha)], ['50.0000', 'SACO', '2.0000', '25.0000']);
    const e2 = ok(await at.editar(e1.linha, { unidade_lancamento: 'SACO', quantidade_lancamento: '3' }));
    assert.deepEqual([e2.linha.quantidade, ...unidadeDe(e2.linha)], ['75.0000', 'SACO', '3.0000', '25.0000']);
    assert.deepEqual(unidadeDe(await movimentoDaLinha(e2.linha)), ['SACO', '3.0000', '25.0000']);
    // A tela que confere com o fator novo (90 kg) diverge da conta do servidor (o gravado): 422, nada gravado.
    erro(await at.editar(e2.linha, { unidade_lancamento: 'SACO', quantidade_lancamento: '3', quantidade: '90' }), 422, 'UNIDADE_LANCAMENTO_INVALIDA', 'quantidade_divergente');
    const e3 = ok(await at.editar(e2.linha, { quantidade: '10' }));
    assert.deepEqual([e3.linha.quantidade, ...unidadeDe(e3.linha)], ['10.0000', ...SEM]);
    // De volta para uma unidade de conversão: a linha nova não tem fator gravado → o do cadastro (30).
    const e4 = ok(await at.editar(e3.linha, { unidade_lancamento: 'SACO', quantidade_lancamento: '1' }));
    assert.deepEqual([e4.linha.quantidade, ...unidadeDe(e4.linha)], ['30.0000', 'SACO', '1.0000', '30.0000']);
    assert.equal(await saldo(x.racao, x.local), '470.0000');
  });

  test('a escolha do lote com a unidade e os produtos[] do lançamento (o caminho do registro e dos "Jatos de hoje")', async () => {
    const x = await montar();
    const L = await doisLotes(x);
    await entrar(x, x.racao, x.local, '500', '2');
    const at = await atividade(x);
    const r = ok(await at.lancar(x.sal, { unidade_lancamento: 'BALDE', quantidade_lancamento: '5', lotes: [{ estoque_lote_nota_id: L.A, quantidade: '12' }, { estoque_lote_nota_id: L.B, quantidade: '8' }] }), 201);
    assert.equal(r.linha.custo_total, '96.0000');
    assert.deepEqual([r.linha.quantidade, ...unidadeDe(r.linha)], ['20.0000', 'BALDE', '5.0000', '4.0000']);
    // Editar só a observação: mesma unidade e quantidade → os MESMOS lotes (A 12 + B 8).
    const e = ok(await at.editar(r.linha, { observacao: 'ok' }));
    assert.equal(e.linha.custo_total, '96.0000');
    const l = ok(await at.lancamento([
      { produto_id: x.racao.id, local_estoque_id: x.local.id, unidade_lancamento: 'G', quantidade_lancamento: '2500' },
      { produto_id: x.racao.id, local_estoque_id: x.local.id, quantidade: '1' },
    ]), 201);
    const linhas = l.apontamento.produtos;
    assert.deepEqual(linhas.map((p) => [p.quantidade, ...unidadeDe(p)]), [['2.5000', 'G', '2500.0000', '0.0010'], ['1.0000', ...SEM]]);
  });
});

describe('UC-4 — a sigla usada no cocho, na transferência ou na atividade não se apaga do cadastro', () => {
  test('tirar o SACO da lista depois de um cocho com SACO → desativado (o histórico fica); o G, nunca usado, sai', async () => {
    const x = await montar();
    await entrar(x, x.racao, x.local, '500', '2');
    ok(await saidaCocho(x, x.racao, { unidade_lancamento: 'SACO', quantidade_lancamento: '1' }), 201);
    ok(await x.cadastro(x.racao, []));
    const cs = await x.conversoes(x.racao);
    const porSigla = Object.fromEntries(cs.map((c) => [c.sigla, [c.ativa, c.excluido_em !== null]]));
    assert.deepEqual(porSigla.SACO, [false, false], 'SACO usado: desativado, não excluído');
    assert.deepEqual(porSigla.G, [false, true], 'G nunca usado: exclusão lógica');
  });
});
