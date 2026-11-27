/**
 * D-PROD-162 (MAIKE-PATRIMONIO-SIMPLIFICA-01) — abastecimento na unidade do
 * Produto, contra PostgreSQL real e HTTP autenticado (contrato §4.9 e §6.1.3).
 *
 *  - L: compra P3 de 1.000 L → abastecer 120 L → lote −120, `estoque_atual`
 *    −120, movimento `unidade_medida = 'L'`, `AbastecimentoBem.quantidade =
 *    120.0000` e `unidade = 'L'`; custo FIFO = Σ fatias; `custo_unitario` = o do
 *    movimento. KG: compra 500 kg → abastecer 80 kg, idem com `'KG'`. Nenhuma
 *    conversão: a baixa é o número digitado;
 *  - capacidade só para L; Produto não aceito (e aceite desligado); outra
 *    fazenda; troca de aceite A → B sem afetar o histórico (a FK segura a linha);
 *  - cancelamento com estorno exato em L e em KG (mesmos lotes, `estoque_atual`
 *    de volta, movimento filho, medidor recalculado); `unidade_mudou` forçado
 *    por SQL → 409; unidade EFETIVA (achado D7): KG → SACO não bloqueia;
 *  - idempotência v2: replay, conflito auditado, corpo v1 → 400, recibo v1 com
 *    a mesma `operation_id` nunca reaproveitado;
 *  - 2 tanques (achado D12): A aceita diesel e B aceita Arla → A16 separa os
 *    tanques por Produto; diesel no B → 422; A16 (`produtos-do-bem`) com os
 *    motivos do `resumo`, busca e paginação estável;
 *  - consumo: kg/h e `unidades_misturadas` (o resto em `patrimonioP1AbastecimentosMedidor`).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import {
  acoesAbastecimento, corpoAbastecimento, corpoPrevia, erro, fotoAbastecimento, itemTanque, montarAbastecimento, opId, previaDe, prisma,
} from './patrimonioP1AbastecimentoCenario.mjs';
import { corpoTrator } from './patrimonioP1Cenario.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoesAbastecimento>} */
let A;
before(async () => {
  app = await criarApp();
  await app.ready();
  A = acoesAbastecimento(app);
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const p4 = (v) => (v === null || v === undefined ? null : v.toFixed(4));
const saldoLote = async (id) => {
  const l = await prisma().estoqueLoteNota.findUnique({ where: { id } });
  return [p4(l.quantidade_disponivel), l.status];
};
const estoqueAtual = async (produto) => p4((await prisma().produto.findUnique({ where: { id: produto.id } })).estoque_atual);
const cancelarCorpo = (empresaId, versao = 1, extra = {}) => ({ empresa_id: empresaId, versao, motivo: 'lançado errado', operation_id: opId(), ...extra });
/** A linha crua e o movimento de saída de um abastecimento. */
const cru = async (id) => {
  const a = await prisma().abastecimentoBem.findUnique({ where: { id } });
  const m = await prisma().movimentacaoEstoque.findUnique({ where: { id: a.movimentacao_estoque_id } });
  const fatias = await prisma().abastecimentoBemConsumoLote.findMany({ where: { abastecimento_id: id }, orderBy: { ordem: 'asc' } });
  return { a, m, fatias };
};
const somaFatias = (fatias) => fatias.reduce((t, f) => t.plus(f.quantidade.times(f.custo_unitario).toDecimalPlaces(4)), fatias[0].quantidade.times(0));

describe('D-PROD-162 — a baixa é a quantidade digitada, na unidade do Produto', () => {
  test('L: compra P3 de 1.000 L → abastecer 120 L; KG: compra 500 kg → abastecer 80 kg; cancelar devolve exatamente aos mesmos lotes', async () => {
    const s = await montarAbastecimento(app);
    const compraL = await s.compraP3(s.e1, s.diesel, s.local2, { quantidade: '1000', preco: '5.50' });
    const compraKg = await s.compraP3(s.e1, s.dieselKg, s.local2, { quantidade: '500', preco: '6.00' });
    assert.deepEqual([await saldoLote(compraL.lote_id), await saldoLote(compraKg.lote_id)], [['1000.0000', 'Disponivel'], ['500.0000', 'Disponivel']]);
    const [estoqueL0, estoqueKg0] = [await estoqueAtual(s.diesel), await estoqueAtual(s.dieselKg)];
    assert.deepEqual([estoqueL0, estoqueKg0], ['1150.0000', '800.0000']);

    // ── L ──
    const rpL = await A.ok(A.previa(s.operador.token, corpoPrevia(s, { local_estoque_id: s.local2.id, quantidade: '120' })));
    assert.deepEqual([rpL.bloqueios, rpL.plano.quantidade, rpL.plano.unidade, rpL.plano.estoque.unidade, rpL.plano.estoque.saldo_local], [[], '120.0000', 'L', 'L', '1000.0000']);
    const l = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { local_estoque_id: s.local2.id, quantidade: '120' }));
    const cl = await cru(l.id);
    assert.deepEqual([p4(cl.a.quantidade), cl.a.unidade, p4(cl.m.quantidade), cl.m.unidade_medida], ['120.0000', 'L', '120.0000', 'L']);
    assert.deepEqual(cl.fatias.map((f) => [f.estoque_lote_nota_id, p4(f.quantidade)]), [[compraL.lote_id, '120.0000']]);
    assert.equal(p4(cl.a.custo_total), p4(somaFatias(cl.fatias)), 'custo FIFO = Σ fatias');
    assert.deepEqual([p4(cl.a.custo_total), p4(cl.a.custo_unitario), p4(cl.m.valor_unitario)], ['660.0000', '5.5000', '5.5000'], 'custo_unitario = o do movimento');
    assert.deepEqual(await saldoLote(compraL.lote_id), ['880.0000', 'Disponivel']);
    assert.equal(await estoqueAtual(s.diesel), '1030.0000');

    // ── KG (no MESMO tanque de 180 L: o número de kg nunca é comparado com a capacidade) ──
    const k = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, {
      produto_id: s.dieselKg.id, local_estoque_id: s.local2.id, quantidade: '80', data_operacional: '2027-06-11', medidor_leitura: '1560',
    }));
    const ck = await cru(k.id);
    assert.deepEqual([p4(ck.a.quantidade), ck.a.unidade, p4(ck.m.quantidade), ck.m.unidade_medida], ['80.0000', 'KG', '80.0000', 'KG']);
    assert.deepEqual(ck.fatias.map((f) => [f.estoque_lote_nota_id, p4(f.quantidade)]), [[compraKg.lote_id, '80.0000']]);
    assert.deepEqual([p4(ck.a.custo_total), p4(ck.a.custo_unitario), p4(ck.m.valor_unitario)], ['480.0000', '6.0000', '6.0000']);
    assert.deepEqual(await saldoLote(compraKg.lote_id), ['420.0000', 'Disponivel']);
    assert.equal(await estoqueAtual(s.dieselKg), '720.0000');
    assert.deepEqual([k.produto.unidade_principal_estoque, k.unidade, k.movimentacao.unidade], ['KG', 'KG', 'KG']);

    // ── cancelar o KG (o último): estorno exato, leitura operacional volta ao L ──
    const xk = await A.ok(A.cancelar(s.contaCancelar.token, k.id, cancelarCorpo(s.e1.id)));
    assert.deepEqual([xk.status, xk.estorno.quantidade, xk.estorno.unidade, xk.leitura_operacional_antes.leitura, xk.leitura_operacional_depois.leitura],
      ['CANCELADO', '80.0000', 'KG', '1560.0000', '1550.5000']);
    const est = await prisma().movimentacaoEstoque.findUnique({ where: { id: xk.estorno.id } });
    assert.deepEqual([est.movimento_pai_id, est.unidade_medida, p4(est.quantidade)], [ck.m.id, 'KG', '80.0000']);
    assert.deepEqual(await saldoLote(compraKg.lote_id), ['500.0000', 'Disponivel']);
    assert.equal(await estoqueAtual(s.dieselKg), estoqueKg0);
    // ── cancelar o L ──
    const xl = await A.ok(A.cancelar(s.contaCancelar.token, l.id, cancelarCorpo(s.e1.id)));
    assert.deepEqual([xl.estorno.quantidade, xl.estorno.unidade, xl.leitura_operacional_depois.origem], ['120.0000', 'L', 'CADASTRO']);
    assert.deepEqual(await saldoLote(compraL.lote_id), ['1000.0000', 'Disponivel']);
    assert.equal(await estoqueAtual(s.diesel), estoqueL0);
    assert.equal((await A.bem(s.token, s.e1.id, s.trator.id)).medidor_operacional, null);
  });

  test('capacidade: L acima → 422; o MESMO número em KG → aceito; quantidade zero → 422; a capacidade reduzida só afeta o L', async () => {
    const s = await montarAbastecimento(app);
    const antes = await fotoAbastecimento(s.c);
    const l = await A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade: '180.0001' }));
    assert.deepEqual(erro(l), [422, 'ABASTECIMENTO_EXCEDE_CAPACIDADE', 'quantidade', 'excede_capacidade_tanque']);
    assert.match(l.json().message, /em litros passa da capacidade do tanque \(180\.0000 L\)/);
    assert.deepEqual(erro(await A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade: '0' }))), [422, 'OPERACAO_VALORES_INVALIDOS', 'quantidade', 'quantidade_nao_positiva']);
    assert.equal(await fotoAbastecimento(s.c), antes);
    const kg = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { produto_id: s.dieselKg.id, quantidade: '180.0001' }));
    assert.deepEqual([kg.quantidade, kg.unidade], ['180.0001', 'KG']);
    const rp = await A.ok(A.previa(s.operador.token, corpoPrevia(s, { produto_id: s.dieselKg.id, quantidade: '119.9999', medidor_leitura: '1551' })));
    assert.deepEqual([rp.bloqueios, rp.plano.confere_capacidade], [[], false]);
  });

  test('Produto não aceito, aceite desligado, outra fazenda, inativo, outro tenant e unidade fora de L/KG/SACO → 422 com o motivo; nada gravado', async () => {
    const s = await montarAbastecimento(app);
    const outro = await montarAbastecimento(app);
    // D-PROD-169: SACO abastece (em kg); a recusa por unidade fica para unidade legada fora de L/KG/SACO.
    await prisma().$executeRaw`UPDATE "Produto" SET unidade_principal_estoque = 'UN' WHERE id = ${s.emSaco.id}`;
    const antes = await fotoAbastecimento([s.c, outro.c]);
    const recusa = async (extra, esperado, rotulo) => {
      const rp = await A.ok(A.previa(s.operador.token, corpoPrevia(s, extra)));
      assert.deepEqual([rp.bloqueios[0].code, rp.bloqueios[0].field, rp.bloqueios[0].reason], esperado.slice(1), `${rotulo} (prévia)`);
      assert.deepEqual(erro(await A.confirmar(s.operador.token, corpoAbastecimento(s, extra))), esperado, rotulo);
    };
    await recusa({ produto_id: s.arla.id }, [422, 'ABASTECIMENTO_PRODUTO_NAO_ACEITO', 'produto_id', 'nao_aceito_pelo_tanque'], 'Arla no tanque de diesel');
    await recusa({ produto_id: s.diesel2.id }, [422, 'ABASTECIMENTO_PRODUTO_INVALIDO', 'produto_id', 'outra_empresa'], 'Produto da outra fazenda');
    await recusa({ produto_id: outro.diesel.id }, [422, 'ABASTECIMENTO_PRODUTO_INVALIDO', 'produto_id', 'inexistente'], 'Produto de outro tenant (sem oráculo)');
    await recusa({ produto_id: s.emSaco.id }, [422, 'ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL', 'produto_id', 'unidade_nao_aceita'], 'Produto em UN (legado)');
    assert.equal(await fotoAbastecimento([s.c, outro.c]), antes);
    // inativo: o aceite fica, o abastecimento recusa
    await A.ok(A.req('PATCH', `/produtos/${s.diesel.id}`, s.token, { ativo: false }));
    await recusa({}, [422, 'ABASTECIMENTO_PRODUTO_INVALIDO', 'produto_id', 'inativo'], 'Produto inativo');
    await A.ok(A.req('PATCH', `/produtos/${s.diesel.id}`, s.token, { ativo: true }));
    // aceite desligado (linha com ativo=false, forçada por SQL: o PATCH do bem apagaria a linha sem histórico)
    await prisma().$executeRaw`UPDATE "TanqueBemProduto" SET ativo = false WHERE cliente_id = ${s.c} AND tanque_id = ${s.trator.tanques[0].id} AND produto_id = ${s.diesel.id}`;
    await recusa({}, [422, 'ABASTECIMENTO_PRODUTO_NAO_ACEITO', 'produto_id', 'nao_aceito_pelo_tanque'], 'aceite desligado');
  });

  test('troca do Produto aceito (A → B) não afeta o histórico: o abastecimento antigo segue com A, detalhe e cancelamento funcionam; a FK segura a linha do aceite', async () => {
    const s = await montarAbastecimento(app);
    const antigo = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade: '20', data_operacional: '2027-06-05', medidor_leitura: '1530' }));
    // o tanque passa a aceitar só o Arla (o diesel sai; o diesel em kg também)
    await A.ok(s.patchAceites(s.trator, [[s.arla.id]]));
    const aceites = await prisma().tanqueBemProduto.findMany({ where: { cliente_id: s.c, tanque_id: s.trator.tanques[0].id }, orderBy: { produto_id: 'asc' } });
    const porProduto = Object.fromEntries(aceites.map((x) => [x.produto_id, x.ativo]));
    assert.deepEqual(porProduto, { [s.diesel.id]: false, [s.arla.id]: true }, 'com histórico só desliga; sem histórico (diesel em kg) apaga (D11)');
    // o histórico continua com o diesel
    const det = await A.ok(A.detalhe(s.leitor.token, antigo.id, s.e1.id));
    assert.deepEqual([det.produto.id, det.quantidade, det.unidade, det.status], [s.diesel.id, '20.0000', 'L', 'CONFIRMADO']);
    assert.deepEqual((await A.ok(A.lista(s.leitor.token, s.e1.id, `&produto_id=${s.diesel.id}`))).items.map((i) => i.id), [antigo.id]);
    const filtro = await A.ok(A.opcoes(s.leitor.token, 'produtos-filtro', `empresa_id=${s.e1.id}`));
    assert.ok(filtro.itens.some((p) => p.id === s.diesel.id), 'o filtro da lista ainda oferece o Produto do histórico');
    // diesel agora é recusado; Arla é aceito
    assert.deepEqual(erro(await A.confirmar(s.operador.token, corpoAbastecimento(s))), [422, 'ABASTECIMENTO_PRODUTO_NAO_ACEITO', 'produto_id', 'nao_aceito_pelo_tanque']);
    const arla = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { produto_id: s.arla.id, quantidade: '10' }));
    assert.deepEqual([arla.produto.id, arla.unidade], [s.arla.id, 'L']);
    // a linha do aceite desligado é a âncora da FK do histórico
    const linha = aceites.find((x) => x.produto_id === s.diesel.id);
    const del = await prisma().$executeRawUnsafe(`DELETE FROM "TanqueBemProduto" WHERE id = '${linha.id}'`).then(() => null, (e) => e);
    assert.match(String(del?.message), /foreign key/i, 'o banco não deixa apagar o aceite que um abastecimento referencia');
    // cancelar o antigo: estorno exato mesmo com o aceite desligado
    const x = await A.ok(A.cancelar(s.contaCancelar.token, antigo.id, cancelarCorpo(s.e1.id)));
    assert.deepEqual([x.status, x.estorno.quantidade, x.produto.id], ['CANCELADO', '20.0000', s.diesel.id]);
    assert.deepEqual([await saldoLote(s.lotes.dieselA.id), await estoqueAtual(s.diesel)], [['50.0000', 'Disponivel'], '150.0000']);
  });

  test('unidade_mudou: a troca que envolve L (forçada por SQL) bloqueia o estorno (409, nada alterado); KG → SACO (unidade efetiva kg) não bloqueia', async () => {
    const s = await montarAbastecimento(app);
    const l = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade: '20', data_operacional: '2027-06-05', medidor_leitura: '1530' }));
    const k = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { produto_id: s.dieselKg.id, quantidade: '80', data_operacional: '2027-06-06', medidor_leitura: '1535' }));
    // L → KG por fora (a tela de Produto recusaria: P-10)
    await prisma().$executeRaw`UPDATE "Produto" SET unidade_principal_estoque = 'KG' WHERE id = ${s.diesel.id}`;
    let antes = await fotoAbastecimento(s.c);
    const rl = await A.cancelar(s.contaCancelar.token, l.id, cancelarCorpo(s.e1.id));
    assert.deepEqual(erro(rl), [409, 'ABASTECIMENTO_CANCELAMENTO_BLOQUEADO', 'abastecimento', 'unidade_mudou']);
    assert.deepEqual([rl.json().details.unidade_abastecimento, rl.json().details.unidade_produto], ['L', 'KG']);
    assert.match(rl.json().message, /unidade de estoque do Produto mudou/);
    assert.equal(await fotoAbastecimento(s.c), antes, 'nada alterado');
    await prisma().$executeRaw`UPDATE "Produto" SET unidade_principal_estoque = 'L' WHERE id = ${s.diesel.id}`;
    // KG → L por fora: bloqueia
    await prisma().$executeRaw`UPDATE "Produto" SET unidade_principal_estoque = 'L' WHERE id = ${s.dieselKg.id}`;
    antes = await fotoAbastecimento(s.c);
    assert.deepEqual(erro(await A.cancelar(s.contaCancelar.token, k.id, cancelarCorpo(s.e1.id))), [409, 'ABASTECIMENTO_CANCELAMENTO_BLOQUEADO', 'abastecimento', 'unidade_mudou']);
    assert.equal(await fotoAbastecimento(s.c), antes);
    await prisma().$executeRaw`UPDATE "Produto" SET unidade_principal_estoque = 'KG' WHERE id = ${s.dieselKg.id}`;
    // KG → SACO, depois de tirar o aceite: a unidade efetiva continua kg → o estorno exato passa. D-PROD-369: a API não
    // põe mais produto em SACO (só legado); o SACO entra por fora, como nos produtos antigos.
    await A.ok(s.patchAceites(s.trator, [[s.diesel.id]]));
    await prisma().$executeRaw`UPDATE "Produto" SET unidade_principal_estoque = 'SACO', peso_por_saco_kg = 50 WHERE id = ${s.dieselKg.id}`;
    const xk = await A.ok(A.cancelar(s.contaCancelar.token, k.id, cancelarCorpo(s.e1.id)));
    assert.deepEqual([xk.status, xk.estorno.quantidade], ['CANCELADO', '80.0000']);
    assert.deepEqual([await saldoLote(s.lotes.dieselKg.id), await estoqueAtual(s.dieselKg)], [['300.0000', 'Disponivel'], '300.0000']);
    // e o L, com a unidade de volta, também cancela
    assert.equal((await A.cancelar(s.contaCancelar.token, l.id, cancelarCorpo(s.e1.id))).statusCode, 200);
  });
});

describe('D-PROD-162 — idempotência v2', () => {
  test('mesma chave + mesmo corpo → 200 replay; corpo diferente → 409 auditado; corpo v1 → 400; recibo v1 com a mesma operation_id nunca é reaproveitado', async () => {
    const s = await montarAbastecimento(app);
    const corpo = corpoAbastecimento(s, { quantidade: '30' });
    const d = await A.confirmarOk(s.operador.token, corpo);
    const replay = await A.confirmar(s.operador.token, { ...corpo, quantidade: '30.0000', observacao: null });
    assert.deepEqual([replay.statusCode, replay.json().replay, replay.json().id], [200, true, d.id]);
    for (const diferente of [{ quantidade: '31' }, { tanque_cheio: false }, { produto_id: s.dieselKg.id }, { medidor_leitura: '1551' }, { referencia_externa: 'NF-1' }]) {
      const r = await A.confirmar(s.operador.token, { ...corpo, ...diferente });
      assert.deepEqual(erro(r).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT'], JSON.stringify(diferente));
    }
    const conflitos = await prisma().auditLog.findMany({ where: { cliente_id: s.c, acao: 'abastecimento_bem.reenvio_conflitante' } });
    assert.equal(conflitos.length, 5);
    assert.ok(conflitos.every((c) => c.dados_novos.tipo_operacao === 'confirmar_abastecimento_bem_v2'));
    assert.equal(await prisma().abastecimentoBem.count({ where: { cliente_id: s.c } }), 1);
    // corpo v1 (litros + tipo + fator): 400, nunca falso sucesso nem replay
    const v1 = { ...corpo, tipo_combustivel_id: 'tipo-antigo', conversao_id: 'fator-antigo', conversao_versao: 1, quantidade_litros: '30' };
    delete v1.quantidade;
    assert.deepEqual(erro(await A.confirmar(s.operador.token, v1)).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED']);

    // recibo v1 (antes da D-PROD-162) com a MESMA chave: a confirmação v2 é operação nova
    const chave = opId();
    for (const tipo of ['confirmar_abastecimento_bem', 'cancelar_abastecimento_bem']) {
      await prisma().operacaoIdempotente.create({
        data: { cliente_id: s.c, operation_key: chave, tipo_operacao: tipo, fingerprint: 'fingerprint-v1', status: 'committed', http_status: 201, response_json: { id: 'abastecimento-antigo', replay: false } },
      });
    }
    const novo = await A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade: '10', operation_id: chave }));
    assert.deepEqual([novo.statusCode, novo.json().replay], [201, false], novo.body);
    assert.notEqual(novo.json().id, 'abastecimento-antigo');
    const k = await A.cancelar(s.contaCancelar.token, novo.json().id, cancelarCorpo(s.e1.id, 1, { operation_id: chave }));
    assert.deepEqual([k.statusCode, k.json().replay, k.json().status], [200, false, 'CANCELADO'], k.body);
    const recibos = await prisma().operacaoIdempotente.findMany({ where: { cliente_id: s.c, operation_key: chave }, orderBy: { tipo_operacao: 'asc' } });
    assert.deepEqual(recibos.map((r) => [r.tipo_operacao, r.fingerprint === 'fingerprint-v1']), [
      ['cancelar_abastecimento_bem', true], ['cancelar_abastecimento_bem_v2', false], ['confirmar_abastecimento_bem', true], ['confirmar_abastecimento_bem_v2', false],
    ], 'os recibos v1 ficam intactos ao lado dos v2');
  });
});

describe('D-PROD-162 — Produtos do bem (A16) e dois tanques', () => {
  test('2 tanques: A aceita diesel e B aceita Arla → cada Produto com o SEU tanque; diesel no B → 422; resumo coerente', async () => {
    const s = await montarAbastecimento(app);
    const bem = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, {
      nome: 'Trator TP-08', codigo_frota: 'TP-08',
      tanques: [
        { identificador: 'Tanque A', capacidade_litros: '180', produto_ids: [s.diesel.id] },
        { identificador: 'Tanque B', capacidade_litros: '40', produto_ids: [s.arla.id] },
      ],
    })), 201);
    const tanque = (id) => bem.tanques.find((t) => t.identificador === id);
    const [ta, tb] = [tanque('Tanque A'), tanque('Tanque B')];
    const r = await A.ok(A.produtosDoBem(s.operador.token, s.e1.id, bem.id));
    assert.deepEqual(r.itens.map((i) => [i.produto.id, i.produto.unidade_principal_estoque, i.tanques.map((t) => t.id), i.pronto]), [
      [s.arla.id, 'L', [tb.id], true],
      [s.diesel.id, 'L', [ta.id], true],
    ]);
    assert.deepEqual(r.resumo, { motivo_sem_opcao: null, total: 2, fora_de_unidade: 0, inativos_ou_outra_fazenda: 0 });
    for (const item of r.itens) for (const campo of ['tipo_combustivel', 'conversao', 'bloqueios']) assert.equal(Object.prototype.hasOwnProperty.call(item, campo), false, campo);
    const corpo = (t, prod, extra = {}) => corpoAbastecimento(s, { bem_id: bem.id, tanque_id: t.id, produto_id: prod.id, quantidade: '20', medidor_leitura: '1550', ...extra });
    assert.deepEqual(erro(await A.confirmar(s.operador.token, corpo(tb, s.diesel))), [422, 'ABASTECIMENTO_PRODUTO_NAO_ACEITO', 'produto_id', 'nao_aceito_pelo_tanque']);
    assert.deepEqual(erro(await A.confirmar(s.operador.token, corpo(ta, s.arla))), [422, 'ABASTECIMENTO_PRODUTO_NAO_ACEITO', 'produto_id', 'nao_aceito_pelo_tanque']);
    const a = await A.confirmarOk(s.operador.token, corpo(ta, s.diesel));
    const b = await A.confirmarOk(s.operador.token, corpo(tb, s.arla, { quantidade: '40', medidor_leitura: '1551' }));
    assert.deepEqual([a.tanque.id, b.tanque.id, b.quantidade], [ta.id, tb.id, '40.0000']);
    // a capacidade é a do tanque escolhido (B tem 40 L)
    assert.deepEqual(erro(await A.confirmar(s.operador.token, corpo(tb, s.arla, { quantidade: '40.0001', medidor_leitura: '1552' }))), [422, 'ABASTECIMENTO_EXCEDE_CAPACIDADE', 'quantidade', 'excede_capacidade_tanque']);
  });

  test('A16: motivos do resumo (bem inativo, sem tanque ativo, tanque sem Produto, unidade fora de L/KG/SACO, inativo ou de outra fazenda), busca e paginação estável; só leitura', async () => {
    const s = await montarAbastecimento(app);
    const tok = s.operador.token;
    const novoBem = (nome, frota, tanques) => A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, { nome, codigo_frota: frota, tanques })), 201);
    const resumo = async (bem, extra = '') => (await A.ok(A.produtosDoBem(tok, s.e1.id, bem.id, extra))).resumo;
    // trator do cenário: diesel (L) e diesel em kg
    const t = await A.ok(A.produtosDoBem(tok, s.e1.id, s.trator.id));
    assert.deepEqual([t.itens.map((i) => i.produto.id), t.resumo], [[s.diesel.id, s.dieselKg.id], { motivo_sem_opcao: null, total: 2, fora_de_unidade: 0, inativos_ou_outra_fazenda: 0 }]);
    assert.deepEqual(t.bem.leitura_vigente.origem, 'CADASTRO');
    // busca (nome ou código) e paginação: o resumo é do conjunto inteiro
    const q = await A.ok(A.produtosDoBem(tok, s.e1.id, s.trator.id, '&q=kg'));
    assert.deepEqual([q.itens.map((i) => i.produto.id), q.resumo.total], [[s.dieselKg.id], 2]);
    const p1 = await A.ok(A.produtosDoBem(tok, s.e1.id, s.trator.id, '&limit=1'));
    assert.deepEqual([p1.itens.map((i) => i.produto.id), p1.has_more], [[s.diesel.id], true]);
    const p2 = await A.ok(A.produtosDoBem(tok, s.e1.id, s.trator.id, `&limit=1&cursor=${encodeURIComponent(p1.next_cursor)}`));
    assert.deepEqual([p2.itens.map((i) => i.produto.id), p2.has_more, p2.next_cursor], [[s.dieselKg.id], false, null]);
    // tanque sem Produto aceito (P-01)
    const vazio = await novoBem('Trator vazio', 'TV-01', [{ identificador: 'Tanque', capacidade_litros: '100', produto_ids: [] }]);
    assert.equal((await resumo(vazio)).motivo_sem_opcao, 'tanque_sem_produto');
    // Produto aceito que virou SACO (por fora) continua servindo (D-PROD-169: abastece em kg);
    // virou uma unidade fora de L/KG/SACO (dado legado) → unidade incompatível
    const saco = await novoBem('Trator saco', 'TS-01', [{ identificador: 'Tanque', capacidade_litros: '100', produto_ids: [s.gasolina.id] }]);
    await prisma().$executeRaw`UPDATE "Produto" SET unidade_principal_estoque = 'SACO' WHERE id = ${s.gasolina.id}`;
    assert.deepEqual(await resumo(saco), { motivo_sem_opcao: null, total: 1, fora_de_unidade: 0, inativos_ou_outra_fazenda: 0 });
    const emSaco = await A.ok(A.produtosDoBem(tok, s.e1.id, saco.id));
    assert.deepEqual([emSaco.itens[0].produto.unidade_principal_estoque, emSaco.itens[0].produto.unidade_abastecimento], ['SACO', 'KG']);
    await prisma().$executeRaw`UPDATE "Produto" SET unidade_principal_estoque = 'UN' WHERE id = ${s.gasolina.id}`;
    assert.deepEqual(await resumo(saco), { motivo_sem_opcao: 'produto_unidade_incompativel', total: 0, fora_de_unidade: 1, inativos_ou_outra_fazenda: 0 });
    await prisma().$executeRaw`UPDATE "Produto" SET unidade_principal_estoque = 'L' WHERE id = ${s.gasolina.id}`;
    // Produto aceito inativado → inativo ou de outra fazenda
    await A.ok(A.req('PATCH', `/produtos/${s.gasolina.id}`, s.token, { ativo: false }));
    assert.deepEqual(await resumo(saco), { motivo_sem_opcao: 'produto_inativo_ou_outra_fazenda', total: 0, fora_de_unidade: 0, inativos_ou_outra_fazenda: 1 });
    // o trator continua com os dois; o motivo de um aceite que não serve aparece em A8
    const tq = await A.ok(A.opcoes(tok, 'tanques', `empresa_id=${s.e1.id}&bem_id=${saco.id}`));
    assert.deepEqual(tq.itens[0].produtos.map((p) => [p.id, p.elegivel, p.motivo]), [[s.gasolina.id, false, 'inativo']]);
    // bem inativo / sem tanque ativo
    const b = await s.bemAtual(vazio);
    await A.ok(A.req('PATCH', `/bens-patrimoniais/${vazio.id}`, s.token, { empresa_id: s.e1.id, versao: b.versao, ativo: false }));
    assert.equal((await resumo(vazio)).motivo_sem_opcao, 'bem_inativo');
    const semTanque = await novoBem('Trator sem tanque ativo', 'TT-01', [{ identificador: 'Tanque', capacidade_litros: '100', produto_ids: [s.diesel.id] }]);
    const atual = await s.bemAtual(semTanque);
    await A.ok(A.req('PATCH', `/bens-patrimoniais/${semTanque.id}`, s.token, {
      empresa_id: s.e1.id, versao: atual.versao, tanques: atual.tanques.map((x) => itemTanque(x, x.produtos.map((y) => y.produto_id), { ativo: false })),
    }));
    assert.equal((await resumo(semTanque)).motivo_sem_opcao, 'sem_tanque_ativo');
    // outro tenant / outra fazenda: 404 sem oráculo; nada gravado pela leitura
    const antes = await fotoAbastecimento(s.c);
    assert.deepEqual(erro(await A.produtosDoBem(tok, s.e2.id, s.trator.id)).slice(0, 2), [404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO']);
    assert.equal(await fotoAbastecimento(s.c), antes);
  });
});

describe('D-PROD-162 — consumo na unidade do Produto', () => {
  test('kg/h entre dois cheios em KG; L e KG misturados no intervalo → unidades_misturadas (nunca soma litro com quilo)', async () => {
    const s = await montarAbastecimento(app);
    const c = (extra) => corpoAbastecimento(s, { produto_id: s.dieselKg.id, ...extra });
    await A.confirmarOk(s.operador.token, c({ quantidade: '100', data_operacional: '2027-06-05', medidor_leitura: '1530' }));
    const k2 = await A.confirmarOk(s.operador.token, c({ quantidade: '50', data_operacional: '2027-06-08', medidor_leitura: '1555' }));
    assert.deepEqual([k2.consumo.situacao, k2.consumo.metrica, k2.consumo.unidade_metrica, k2.consumo.quantidade, k2.consumo.unidade, k2.consumo.valor],
      ['CALCULADO', 'KG_POR_HORA', 'kg/h', '50.0000', 'KG', '2.0000'], '50 kg ÷ 25 h');
    // um parcial em L no meio e o cheio seguinte em KG: misturado
    await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade: '10', data_operacional: '2027-06-09', medidor_leitura: '1560', tanque_cheio: false }));
    const k3 = await A.confirmarOk(s.operador.token, c({ quantidade: '20', data_operacional: '2027-06-10', medidor_leitura: '1570' }));
    assert.deepEqual([k3.consumo.situacao, k3.consumo.motivo, k3.consumo.metrica, k3.consumo.valor, k3.consumo.intervalo], ['DADOS_INSUFICIENTES', 'unidades_misturadas', null, null, '15.0000']);
    const a6 = await A.ok(A.consumo(s.leitor.token, s.e1.id, s.trator.id));
    assert.deepEqual(a6.intervalos.map((i) => [i.situacao, i.motivo, i.unidade_metrica]), [
      ['DADOS_INSUFICIENTES', 'unidades_misturadas', null],
      ['CALCULADO', null, 'kg/h'],
      ['DADOS_INSUFICIENTES', 'sem_tanque_cheio_anterior', 'kg/h'],
    ]);
  });
});

describe('D-PROD-162 — FK do aceite é a última rede', () => {
  test('aceite apagado entre a leitura e o INSERT (forçado por SQL) → 422 ABASTECIMENTO_PRODUTO_NAO_ACEITO, nunca 500; nada gravado', async () => {
    const s = await montarAbastecimento(app);
    // um gatilho apaga o aceite logo antes do INSERT do abastecimento (simula um escritor fora do protocolo)
    const p = prisma();
    const nome = 'simp_apaga_aceite';
    await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${nome}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
      DELETE FROM "TanqueBemProduto" WHERE cliente_id = NEW.cliente_id AND tanque_id = NEW.tanque_id AND produto_id = NEW.produto_id; RETURN NEW; END $f$`);
    await p.$executeRawUnsafe(`CREATE TRIGGER ${nome} BEFORE INSERT ON "AbastecimentoBem" FOR EACH ROW WHEN (NEW.cliente_id = '${s.c}') EXECUTE FUNCTION ${nome}()`);
    let r;
    const antes = await fotoAbastecimento(s.c);
    try {
      r = await A.confirmar(s.operador.token, corpoAbastecimento(s));
    } finally {
      await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${nome} ON "AbastecimentoBem"`);
    }
    assert.deepEqual(erro(r), [422, 'ABASTECIMENTO_PRODUTO_NAO_ACEITO', 'produto_id', 'nao_aceito_pelo_tanque'], r.body);
    assert.equal(await fotoAbastecimento(s.c), antes, 'a transação inteira voltou (lotes, movimento, recibo, o aceite apagado pelo gatilho)');
    assert.equal((await A.previa(s.operador.token, previaDe(corpoAbastecimento(s)))).json().bloqueios.length, 0, 'sem o gatilho tudo volta a valer');
  });
});
