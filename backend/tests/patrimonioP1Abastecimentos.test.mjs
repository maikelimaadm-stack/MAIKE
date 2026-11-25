/**
 * D-PROD-159, revisto pela D-PROD-162 — Patrimônio P1-02: abastecimento e
 * consumo (matriz FUNCIONAL, PostgreSQL real + HTTP autenticado).
 *
 *  - AB1/AB10: aceite TP-02 com o diesel em LITROS — prévia (zero escrita) →
 *    confirmar 201 (movimento `abastecimento_patrimonio` em `L`, FIFO em 2
 *    lotes de custo distinto, 432,0000 / 5,4000 (médio de 50×5,20 + 100×5,50 ÷ 150); a baixa é EXATAMENTE a
 *    quantidade digitada) → replay 200 → cancelar (estorno EXATO por lote) →
 *    409 duplicado → replay do cancelamento 200;
 *  - AB2 flex (um tanque aceita gasolina e etanol; Produto não aceito → 422);
 *    AB3 duas fazendas do mesmo tenant; AB6 todos os vetores de quantidade de
 *    `tests/smoke/fixtures/abastecimentoVetores.json` (sem conversão); AB7
 *    estoque (sem lote, insuficiente, `estoque_atual` legado, unidade fora de L/KG/SACO,
 *    local); AB8 capacidade (só para Produto em L) e parciais; AB11
 *    cancelamento bloqueado; AB12 inativações e aceite retirado com a tela
 *    aberta; AB13 efeitos na P3 (D14); AB14 X1; AB15 lista/detalhe; AB16 opções;
 *  - recortes de segurança que dependem do fluxo (403/404/400, mesma chave em
 *    outro tenant, rotas do fator removidas) — sempre com "nada gravado" pela
 *    fotografia das linhas.
 *
 * O medidor e o consumo (M1–M8) ficam em `patrimonioP1AbastecimentosMedidor.test.mjs`;
 * L × KG, aceites e idempotência v2 em `patrimonioSimplificaAbastecimentos.test.mjs`.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import {
  acoesAbastecimento, corpoAbastecimento, corpoPrevia, erro, fotoAbastecimento, itemTanque, linhaAbastecimento, montarAbastecimento, opId, previaDe, prisma,
} from './patrimonioP1AbastecimentoCenario.mjs';
import { corpoImplemento, corpoTrator } from './patrimonioP1Cenario.mjs';

const VETORES = JSON.parse(readFileSync(new URL('../../tests/smoke/fixtures/abastecimentoVetores.json', import.meta.url), 'utf8'));

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

const lote = (id) => prisma().estoqueLoteNota.findUnique({ where: { id } });
const saldoLote = async (id) => {
  const l = await lote(id);
  return [l.quantidade_disponivel.toFixed(4), l.status];
};
const estoqueAtual = async (produtoId) => (await prisma().produto.findUnique({ where: { id: produtoId } })).estoque_atual.toFixed(4);
const bemCru = (id) => prisma().bemPatrimonial.findUnique({ where: { id } });
const cancelarCorpo = (versao = 1, extra = {}) => ({ versao, motivo: 'lançado no bem errado', operation_id: opId(), ...extra });
const movimentosAbastecimento = (c) => prisma().movimentacaoEstoque.count({ where: { cliente_id: c, origem_sistema: 'abastecimento_patrimonio' } });
/** Campos que saíram com o fator kg/L e o tipo de combustível (D-PROD-162): nunca voltam numa resposta. */
const CAMPOS_REMOVIDOS = Object.freeze(['tipo_combustivel', 'tipo_combustivel_id', 'conversao', 'conversao_id', 'kg_por_litro', 'quantidade_litros', 'quantidade_kg', 'custo_unitario_kg']);
const semCamposRemovidos = (obj, rotulo) => {
  for (const c of CAMPOS_REMOVIDOS) assert.equal(Object.prototype.hasOwnProperty.call(obj, c), false, `${rotulo}: ${c} saiu (D-PROD-162)`);
};

describe('P1-02 — fluxo feliz do aceite (TP-02, diesel em litros)', () => {
  test('AB1/AB10: prévia → confirmar → replay → cancelar (estorno exato em 2 lotes) → 409 → replay do cancelamento', async () => {
    const s = await montarAbastecimento(app);
    const bemAntes = await bemCru(s.trator.id);

    // ── prévia: plano completo e ZERO escrita ──
    const fotoAntes = await fotoAbastecimento(s.c);
    const rp = await A.previa(s.operador.token, corpoPrevia(s));
    assert.equal(rp.statusCode, 200, rp.body);
    const { plano, bloqueios } = rp.json();
    assert.deepEqual(bloqueios, []);
    semCamposRemovidos(plano, 'plano');
    assert.deepEqual([plano.quantidade, plano.unidade, plano.confere_capacidade], ['80.0000', 'L', true]);
    assert.deepEqual(plano.produto, { id: s.diesel.id, nome: 'Diesel S10 (L)', codigo_interno: null, unidade_principal_estoque: 'L', unidade_abastecimento: 'L' });
    assert.deepEqual(plano.tanque, { id: s.trator.tanques[0].id, identificador: 'Tanque principal', capacidade_litros: '180.0000', ativo: true });
    assert.equal(plano.custo_e_estimativa, true);
    assert.equal(plano.fifo.suficiente, true);
    assert.equal(plano.fifo.custo_total_estimado, '432.0000');
    assert.equal(plano.fifo.custo_unitario_estimado, '5.4000');
    assert.deepEqual(
      plano.fifo.fatias.map((f) => [f.ordem, f.lote_id, f.data_lote, f.quantidade, f.custo_unitario, f.valor]),
      [
        [1, s.lotes.dieselA.id, '2027-06-01', '50.0000', '5.4000', '270.0000'],
        [2, s.lotes.dieselB.id, '2027-06-03', '30.0000', '5.4000', '162.0000'],
      ]
    );
    assert.deepEqual(plano.estoque, { saldo_local: '150.0000', estoque_atual: '150.0000', unidade: 'L' });
    assert.equal(plano.medidor.tipo, 'HORIMETRO');
    assert.equal(plano.medidor.unidade, 'h');
    assert.equal(plano.medidor.leitura, '1550.5000');
    assert.equal(plano.medidor.anterior.origem, 'CADASTRO');
    assert.equal(plano.medidor.anterior.leitura, '1520.5000');
    assert.equal(await fotoAbastecimento(s.c), fotoAntes, 'a prévia não grava nada');

    // ── confirmar: 201 ──
    const corpo = corpoAbastecimento(s);
    const rc = await A.confirmar(s.operador.token, corpo);
    assert.equal(rc.statusCode, 201, rc.body);
    const d = rc.json();
    semCamposRemovidos(d, 'detalhe');
    assert.equal(d.replay, false);
    assert.equal(d.status, 'CONFIRMADO');
    assert.equal(d.versao, 1);
    assert.match(d.numero, /^\d+$/);
    assert.equal(d.data_operacional, '2027-06-10');
    assert.deepEqual([d.quantidade, d.unidade, d.custo_total, d.custo_unitario], ['80.0000', 'L', '432.0000', '5.4000']);
    assert.equal(d.tanque_cheio, true);
    assert.deepEqual(d.medidor, { tipo: 'HORIMETRO', unidade: 'h', leitura: '1550.5000', origem: 'ABASTECIMENTO' });
    assert.deepEqual(d.produto, { id: s.diesel.id, nome: 'Diesel S10 (L)', unidade_principal_estoque: 'L' });
    assert.equal(d.movimentacao.tipo_movimentacao, 'Saída');
    assert.equal(d.movimentacao.tipo_detalhado, 'abastecimento_patrimonio');
    assert.equal(d.movimentacao.status, 'Ativa');
    assert.deepEqual([d.movimentacao.quantidade, d.movimentacao.unidade, d.movimentacao.valor_total, d.movimentacao.valor_unitario], ['80.0000', 'L', '432.0000', '5.4000']);
    assert.match(d.movimentacao.numero, /^\d+$/);
    assert.equal(d.estorno, null);
    assert.equal(d.cancelamento, null);
    assert.deepEqual(d.criado_por, { id: s.operador.id, login: s.operador.login });
    assert.deepEqual(
      d.fatias.map((f) => [f.ordem, f.lote_id, f.quantidade, f.custo_unitario, f.valor]),
      [
        [1, s.lotes.dieselA.id, '50.0000', '5.4000', '270.0000'],
        [2, s.lotes.dieselB.id, '30.0000', '5.4000', '162.0000'],
      ]
    );
    // o vetor `fifo` compartilhado tela × servidor
    const vf = VETORES.fifo;
    assert.deepEqual([d.quantidade, d.unidade, d.custo_total, d.custo_unitario], [vf.quantidade, vf.unidade, vf.custo_total, vf.custo_unitario]);
    assert.deepEqual(d.fatias.map((f) => [f.ordem, f.quantidade, f.custo_unitario, f.valor]), vf.fatias.map((f) => [f.ordem, f.quantidade, f.custo_unitario, f.valor]));
    assert.equal(d.consumo.situacao, 'DADOS_INSUFICIENTES');
    assert.equal(d.consumo.motivo, 'sem_tanque_cheio_anterior');
    assert.equal(d.efeito_cancelamento_medidor.muda, true);
    assert.equal(d.efeito_cancelamento_medidor.leitura_operacional_antes.origem, 'ABASTECIMENTO');
    assert.equal(d.efeito_cancelamento_medidor.leitura_operacional_depois.origem, 'CADASTRO');

    // banco: movimento físico de saída do motor, nunca financeiro; a baixa é o número digitado, em L
    const mov = await prisma().movimentacaoEstoque.findUnique({ where: { id: d.movimentacao.id } });
    assert.equal(mov.origem_sistema, 'abastecimento_patrimonio');
    assert.equal(mov.exclusao_somente_em, 'abastecimento_patrimonio');
    assert.equal(mov.lancamento_origem_id, d.id);
    assert.equal(mov.motivo_movimentacao, 'Saída por abastecimento de bem patrimonial');
    assert.equal(mov.quantidade.toFixed(4), '80.0000');
    assert.equal(mov.unidade_medida, 'L', 'o rótulo do movimento vem do Produto (D-PROD-162 §4.8)');
    assert.equal(mov.local_estoque_origem, s.local.id);
    assert.deepEqual(mov.lotes_consumidos, [
      { lote_id: s.lotes.dieselA.id, quantidade: '50.0000', custo_unitario: '5.4000' },
      { lote_id: s.lotes.dieselB.id, quantidade: '30.0000', custo_unitario: '5.4000' },
    ]);
    assert.equal(mov.vinculado ?? false, false, 'C8: M2 não preenche vínculo do movimento');
    assert.deepEqual(await saldoLote(s.lotes.dieselA.id), ['0.0000', 'Esgotado']);
    assert.deepEqual(await saldoLote(s.lotes.dieselB.id), ['70.0000', 'Disponivel']);
    assert.equal(await estoqueAtual(s.diesel.id), '70.0000');
    const linhaDb = await prisma().abastecimentoBem.findUnique({ where: { id: d.id } });
    assert.equal(linhaDb.operation_id, corpo.operation_id);
    assert.equal(linhaDb.medidor_origem, 'ABASTECIMENTO');
    assert.deepEqual([linhaDb.quantidade.toFixed(4), linhaDb.unidade, linhaDb.custo_unitario.toFixed(4)], ['80.0000', 'L', '5.4000']);
    assert.equal(await prisma().operacaoFinanceira.count({ where: { cliente_id: s.c } }), 0, 'nenhum lançamento financeiro');
    const recibo = await prisma().operacaoIdempotente.findMany({ where: { cliente_id: s.c, operation_key: corpo.operation_id } });
    assert.deepEqual(recibo.map((r) => [r.tipo_operacao, r.status]), [['confirmar_abastecimento_bem_v2', 'committed']], 'recibo v2 (D-PROD-162)');
    const audit = await prisma().auditLog.findMany({ where: { cliente_id: s.c, acao: 'abastecimento_bem.confirmar' } });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].entidade_id, d.id);
    assert.deepEqual([audit[0].dados_novos.quantidade, audit[0].dados_novos.unidade, audit[0].dados_novos.custo_unitario], ['80.0000', 'L', '5.4000']);
    semCamposRemovidos(audit[0].dados_novos, 'auditoria');
    assert.equal(audit[0].dados_novos.fatias.length, 2);
    assert.equal(JSON.stringify(await bemCru(s.trator.id)), JSON.stringify(bemAntes), 'o abastecimento nunca grava o bem (versão e medidor intactos)');

    // detalhe do bem ganha a leitura operacional (X2)
    const bemPublico = await A.bem(s.token, s.e1.id, s.trator.id);
    assert.deepEqual(bemPublico.medidor_operacional, { leitura: '1550.5000', data: '2027-06-10', abastecimento_id: d.id });
    assert.equal(bemPublico.medidor.leitura_atual, '1520.5000');

    // ── replay: mesma chave + mesmo corpo ("80" ≡ "80.0000") → 200, um único movimento ──
    const rr = await A.confirmar(s.operador.token, { ...corpo, quantidade: '80.0000' });
    assert.equal(rr.statusCode, 200, rr.body);
    assert.equal(rr.json().replay, true);
    assert.equal(rr.json().id, d.id);
    assert.equal(await movimentosAbastecimento(s.c), 1);

    // mesma chave + corpo diferente → 409, nada gravado, conflito auditado
    const fotoReplay = await fotoAbastecimento(s.c);
    const rx = await A.confirmar(s.operador.token, { ...corpo, quantidade: '81' });
    assert.deepEqual(erro(rx).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
    const conflito = await prisma().auditLog.findMany({ where: { cliente_id: s.c, acao: 'abastecimento_bem.reenvio_conflitante' } });
    assert.equal(conflito.length, 1);
    assert.equal(conflito[0].dados_novos.operation_id, corpo.operation_id);
    assert.equal(conflito[0].dados_novos.tipo_operacao, 'confirmar_abastecimento_bem_v2');
    const semConflito = (f) => JSON.parse(f).auditLog.filter((l) => l.acao !== 'abastecimento_bem.reenvio_conflitante').length;
    assert.equal(semConflito(await fotoAbastecimento(s.c)), semConflito(fotoReplay));

    // ── cancelar: recusas antes do estorno (nada alterado) ──
    const fotoAntesCancelar = await fotoAbastecimento(s.c);
    const cancelarSem = await A.cancelar(s.operador.token, d.id, { empresa_id: s.e1.id, ...cancelarCorpo() });
    assert.deepEqual(erro(cancelarSem).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA'], 'sem a ação extra cancelar');
    const versaoVelha = await A.cancelar(s.contaCancelar.token, d.id, { empresa_id: s.e1.id, ...cancelarCorpo(2) });
    assert.deepEqual(erro(versaoVelha).slice(0, 2), [409, 'PATRIMONIO_VERSAO_CONFLITO'], versaoVelha.body);
    const motivoCurto = await A.cancelar(s.contaCancelar.token, d.id, { empresa_id: s.e1.id, ...cancelarCorpo(1, { motivo: ' x ' }) });
    assert.deepEqual(erro(motivoCurto), [400, 'REQUEST_VALIDATION_FAILED', 'motivo', 'motivo_curto']);
    assert.equal(await fotoAbastecimento(s.c), fotoAntesCancelar);

    // ── cancelar: estorno EXATO fatia a fatia ──
    const corpoCancelar = { empresa_id: s.e1.id, ...cancelarCorpo() };
    const rk = await A.cancelar(s.contaCancelar.token, d.id, corpoCancelar);
    assert.equal(rk.statusCode, 200, rk.body);
    const k = rk.json();
    assert.equal(k.replay, false);
    assert.equal(k.status, 'CANCELADO');
    assert.equal(k.versao, 2);
    assert.equal(k.cancelamento.motivo, 'lançado no bem errado');
    assert.deepEqual(k.cancelamento.cancelado_por, { id: s.contaCancelar.id, login: s.contaCancelar.login });
    assert.equal(k.estorno.tipo_movimentacao, 'Entrada');
    assert.equal(k.estorno.tipo_detalhado, 'estorno_abastecimento');
    assert.deepEqual([k.estorno.quantidade, k.estorno.unidade, k.estorno.valor_total], ['80.0000', 'L', '432.0000']);
    assert.equal(k.estorno.data_movimentacao, '2027-06-15T12:00:00.000Z', 'dia do estorno = hoje da fazenda');
    assert.equal(k.movimentacao.status, 'Estornada');
    assert.equal(k.leitura_operacional_antes.origem, 'ABASTECIMENTO');
    assert.equal(k.leitura_operacional_depois.origem, 'CADASTRO');
    assert.equal(k.efeito_cancelamento_medidor, null);
    assert.equal(k.consumo.situacao, 'NAO_APLICAVEL');
    assert.deepEqual(await saldoLote(s.lotes.dieselA.id), ['50.0000', 'Disponivel']);
    assert.deepEqual(await saldoLote(s.lotes.dieselB.id), ['100.0000', 'Disponivel']);
    assert.equal(await estoqueAtual(s.diesel.id), '150.0000');
    const orig = await prisma().movimentacaoEstoque.findUnique({ where: { id: d.movimentacao.id } });
    const est = await prisma().movimentacaoEstoque.findUnique({ where: { id: k.estorno.id } });
    assert.equal(orig.status, 'Estornada');
    assert.equal(orig.movimento_filho_id, est.id);
    assert.equal(est.movimento_pai_id, orig.id);
    assert.equal(est.origem_sistema, 'abastecimento_patrimonio');
    assert.equal(est.motivo_movimentacao, 'Estorno de abastecimento cancelado');
    assert.equal(est.valor_unitario.toFixed(4), orig.valor_unitario.toFixed(4));
    assert.equal(est.local_estoque_destino, s.local.id);
    assert.match(est.numero_movimentacao, /^\d+$/);
    assert.equal(JSON.stringify(await bemCru(s.trator.id)), JSON.stringify(bemAntes), 'o cancelamento nunca grava o bem');
    const auditCancel = await prisma().auditLog.findMany({ where: { cliente_id: s.c, acao: 'abastecimento_bem.cancelar' } });
    assert.equal(auditCancel.length, 1);
    assert.equal(auditCancel[0].dados_novos.leitura_operacional_depois.origem, 'CADASTRO');
    assert.equal((await A.bem(s.token, s.e1.id, s.trator.id)).medidor_operacional, null);
    const reciboCancel = await prisma().operacaoIdempotente.findMany({ where: { cliente_id: s.c, operation_key: corpoCancelar.operation_id } });
    assert.deepEqual(reciboCancel.map((r) => r.tipo_operacao), ['cancelar_abastecimento_bem_v2']);

    // cancelar de novo (outra chave) → 409; replay da 1ª chave → 200 com o mesmo corpo
    const fotoCancelado = await fotoAbastecimento(s.c);
    const rk2 = await A.cancelar(s.contaCancelar.token, d.id, { ...corpoCancelar, versao: 2, operation_id: opId() });
    assert.deepEqual(erro(rk2), [409, 'ABASTECIMENTO_STATUS_INVALIDO', 'status', 'status_invalido']);
    assert.deepEqual([rk2.json().details.status, rk2.json().details.esperado], ['CANCELADO', 'CONFIRMADO']);
    const rk3 = await A.cancelar(s.contaCancelar.token, d.id, corpoCancelar);
    assert.equal(rk3.statusCode, 200, rk3.body);
    assert.equal(rk3.json().replay, true);
    assert.equal(rk3.json().estorno.id, k.estorno.id);
    assert.equal(await movimentosAbastecimento(s.c), 2);
    assert.equal(await fotoAbastecimento(s.c), fotoCancelado, 'estorno duplicado e replay não gravam nada');

    // lista com filtro por operation_id (C6) e detalhe
    const lista = await A.ok(A.lista(s.operador.token, s.e1.id, `&operation_id=${corpo.operation_id}`));
    assert.equal(lista.total, 1);
    assert.equal(lista.items[0].id, d.id);
    assert.equal(lista.items[0].status, 'CANCELADO');
    assert.deepEqual([lista.items[0].quantidade, lista.items[0].unidade, lista.items[0].produto], ['80.0000', 'L', { id: s.diesel.id, nome: 'Diesel S10 (L)' }]);
    semCamposRemovidos(lista.items[0], 'lista');
    const det = await A.ok(A.detalhe(s.leitor.token, d.id, s.e1.id));
    assert.equal(det.status, 'CANCELADO');
    assert.equal(det.fatias.length, 2);
  });
});

describe('P1-02 — Produtos aceitos e fazenda', () => {
  test('AB2: flex — um tanque aceita gasolina e etanol; Produto que o tanque não aceita → 422 nao_aceito_pelo_tanque; cada aceito → 201', async () => {
    const s = await montarAbastecimento(app);
    const tanque = s.caminhonete.tanques[0];
    const flex = (prod, extra = {}) => corpoAbastecimento(s, { bem_id: s.caminhonete.id, tanque_id: tanque.id, produto_id: prod.id, quantidade: '40', ...extra });
    const tq = await A.ok(A.opcoes(s.operador.token, 'tanques', `empresa_id=${s.e1.id}&bem_id=${s.caminhonete.id}`));
    assert.deepEqual(tq.itens.map((t) => [t.id, t.capacidade_litros, t.produtos.map((p) => [p.id, p.unidade_principal_estoque, p.elegivel])]),
      [[tanque.id, '80.0000', [[s.etanol.id, 'L', true], [s.gasolina.id, 'L', true]]]], 'um único tanque, dois Produtos aceitos');

    const antes = await fotoAbastecimento(s.c);
    for (const prod of [s.diesel, s.arla]) {
      const corpo = flex(prod, { medidor_leitura: '35300' });
      const rp = await A.ok(A.previa(s.operador.token, previaDe(corpo)));
      assert.deepEqual(rp.bloqueios.map((b) => [b.code, b.field, b.reason]), [['ABASTECIMENTO_PRODUTO_NAO_ACEITO', 'produto_id', 'nao_aceito_pelo_tanque']], prod.nome_produto);
      assert.deepEqual(erro(await A.confirmar(s.operador.token, corpo)), [422, 'ABASTECIMENTO_PRODUTO_NAO_ACEITO', 'produto_id', 'nao_aceito_pelo_tanque']);
    }
    assert.equal(await fotoAbastecimento(s.c), antes);

    const g = await A.confirmarOk(s.operador.token, flex(s.gasolina, { data_operacional: '2027-06-02', medidor_leitura: '35300' }));
    const e = await A.confirmarOk(s.operador.token, flex(s.etanol, { data_operacional: '2027-06-06', medidor_leitura: '35650', quantidade: '30' }));
    assert.deepEqual([g.tanque.id, g.produto.id, g.quantidade, g.unidade, g.custo_total], [tanque.id, s.gasolina.id, '40.0000', 'L', '240.0000']);
    assert.deepEqual([e.tanque.id, e.produto.id, e.quantidade, e.unidade, e.custo_total], [tanque.id, s.etanol.id, '30.0000', 'L', '120.0000']);
    assert.deepEqual(await saldoLote(s.lotes.gasolina.id), ['260.0000', 'Disponivel']);
    assert.deepEqual(await saldoLote(s.lotes.etanol.id), ['270.0000', 'Disponivel']);
    assert.equal(await estoqueAtual(s.gasolina.id), '260.0000');
    assert.equal(await estoqueAtual(s.etanol.id), '270.0000');
  });

  test('AB3: duas fazendas do mesmo tenant — produto da F2 com bem da F1 → 422 outra_empresa; lotes da F2 nunca consumidos; F1 não vê o abastecimento da F2 (404)', async () => {
    const s = await montarAbastecimento(app);
    const antes = await fotoAbastecimento(s.c);
    const cruzado = corpoAbastecimento(s, { produto_id: s.diesel2.id });
    const rp = await A.ok(A.previa(s.operador.token, previaDe(cruzado)));
    assert.deepEqual([rp.bloqueios[0].code, rp.bloqueios[0].reason], ['ABASTECIMENTO_PRODUTO_INVALIDO', 'outra_empresa']);
    assert.equal(rp.plano.estoque, null, 'nada do estoque da outra fazenda aparece');
    assert.deepEqual(erro(await A.confirmar(s.operador.token, cruzado)), [422, 'ABASTECIMENTO_PRODUTO_INVALIDO', 'produto_id', 'outra_empresa']);
    const locaisCruzados = await A.opcoes(s.operador.token, 'locais', `empresa_id=${s.e1.id}&produto_id=${s.diesel2.id}`);
    assert.deepEqual(erro(locaisCruzados), [404, 'PRODUTO_NOT_FOUND', 'produto_id', 'produto_nao_encontrado']);
    assert.equal(await fotoAbastecimento(s.c), antes);

    // F1 no MESMO local onde a F2 tem 500 L: só os lotes da F1 entram no FIFO
    const d1 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s));
    assert.deepEqual(d1.fatias.map((f) => f.lote_id), [s.lotes.dieselA.id, s.lotes.dieselB.id]);
    assert.deepEqual(await saldoLote(s.lotes.diesel2.id), ['500.0000', 'Disponivel'], 'o lote da F2 não foi tocado');
    assert.equal(await estoqueAtual(s.diesel2.id), '500.0000');

    // bem da F2 abastece com o produto da F2
    const tratorF2 = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, {
      empresa_id: s.e2.id, codigo_frota: 'TP-09', tanques: [{ identificador: 'Tanque principal', capacidade_litros: '180', produto_ids: [s.diesel2.id] }],
    })), 201);
    const corpoF2 = corpoAbastecimento(s, { empresa_id: s.e2.id, bem_id: tratorF2.id, tanque_id: tratorF2.tanques[0].id, produto_id: s.diesel2.id });
    const semBemNaF1 = await A.previa(s.operador.token, previaDe({ ...corpoF2, empresa_id: s.e1.id }));
    assert.deepEqual(erro(semBemNaF1), [404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO', 'bem_id', 'bem_inexistente']);
    const d2 = await A.confirmarOk(s.operador.token, corpoF2);
    assert.equal(d2.empresa_id, s.e2.id);
    assert.deepEqual(d2.fatias.map((f) => [f.lote_id, f.quantidade]), [[s.lotes.diesel2.id, '80.0000']]);
    assert.deepEqual(await saldoLote(s.lotes.diesel2.id), ['420.0000', 'Disponivel']);
    assert.equal(await estoqueAtual(s.diesel.id), '70.0000', 'o produto da F1 só perdeu o abastecimento da F1');

    const l1 = await A.ok(A.lista(s.operador.token, s.e1.id));
    const l2 = await A.ok(A.lista(s.operador.token, s.e2.id));
    assert.deepEqual([l1.total, l1.items.map((i) => i.id)], [1, [d1.id]]);
    assert.deepEqual([l2.total, l2.items.map((i) => i.id)], [1, [d2.id]]);
    assert.deepEqual(erro(await A.detalhe(s.operador.token, d2.id, s.e1.id)).slice(0, 2), [404, 'ABASTECIMENTO_NAO_ENCONTRADO']);
    const fotoF2 = await fotoAbastecimento(s.c);
    const cancelarCruzado = await A.cancelar(s.contaCancelar.token, d2.id, { empresa_id: s.e1.id, ...cancelarCorpo() });
    assert.deepEqual(erro(cancelarCruzado).slice(0, 2), [404, 'ABASTECIMENTO_NAO_ENCONTRADO']);
    assert.equal(await fotoAbastecimento(s.c), fotoF2);
    const bensF1 = await A.ok(A.opcoes(s.operador.token, 'bens', `empresa_id=${s.e1.id}`));
    assert.equal(bensF1.itens.some((b) => b.id === tratorF2.id), false);
    assert.deepEqual(erro(await A.opcoes(s.operador.token, 'tanques', `empresa_id=${s.e1.id}&bem_id=${tratorF2.id}`)).slice(0, 2), [404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO']);
  });

  test('AB6: quantidade — TODOS os vetores de abastecimentoVetores.json (prévia = confirmação = movimento = Σ fatias; nenhuma conversão)', async () => {
    const s = await montarAbastecimento(app);
    // bem sem medidor e com tanque enorme aceitando L e KG (a capacidade nunca mascara o vetor)
    const grande = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, {
      empresa_id: s.e1.id, nome: 'Grupo gerador de teste', familia_id: s.fam.EQUIPAMENTOS, tipo_id: s.tip.GERADOR, medidor: { tipo: 'SEM_MEDIDOR' },
      tanques: [{ identificador: 'Tanque de prova', capacidade_litros: '9999999999.9999', produto_ids: [s.diesel.id, s.dieselKg.id] }],
    }), 201);
    await s.lote(s.e1, s.diesel, s.local, { quantidade: '20000.0000', custo: '5.0000', dia: '2027-06-05' });
    await s.lote(s.e1, s.dieselKg, s.local, { quantidade: '20000.0000', custo: '6.0000', dia: '2027-06-05' });
    const produtoDa = (u) => (u === 'L' ? s.diesel : s.dieselKg);
    const gravados = [];
    for (const v of VETORES.quantidade) {
      const corpo = corpoAbastecimento(s, {
        bem_id: grande.id, tanque_id: grande.tanques[0].id, produto_id: produtoDa(v.unidade).id, quantidade: v.digitado, medidor_leitura: null, tanque_cheio: false,
      });
      const rotulo = `${v.digitado} ${v.unidade}`;
      const antes = await fotoAbastecimento(s.c);
      if (v.recusa === 'formato') {
        assert.deepEqual(erro(await A.previa(s.operador.token, previaDe(corpo))).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], rotulo);
        assert.deepEqual(erro(await A.confirmar(s.operador.token, corpo)).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], rotulo);
        assert.equal(await fotoAbastecimento(s.c), antes);
        continue;
      }
      const rp = await A.ok(A.previa(s.operador.token, previaDe(corpo)));
      if (v.recusa) {
        assert.deepEqual(rp.bloqueios.map((b) => [b.code, b.field, b.reason]), [['OPERACAO_VALORES_INVALIDOS', 'quantidade', v.recusa]], rotulo);
        assert.equal(rp.plano.fifo, null, `${rotulo}: sem FIFO para quantidade inválida`);
        assert.deepEqual(erro(await A.confirmar(s.operador.token, corpo)), [422, 'OPERACAO_VALORES_INVALIDOS', 'quantidade', v.recusa]);
        assert.equal(await fotoAbastecimento(s.c), antes);
        continue;
      }
      assert.deepEqual([rp.bloqueios, rp.plano.quantidade, rp.plano.unidade], [[], v.baixa, v.unidade], `prévia ${rotulo}`);
      const d = await A.confirmarOk(s.operador.token, corpo);
      assert.deepEqual([d.quantidade, d.unidade, d.movimentacao.quantidade, d.movimentacao.unidade], [v.baixa, v.unidade, v.baixa, v.unidade], `confirmação ${rotulo}`);
      gravados.push(d.id);
    }
    assert.equal(gravados.length, VETORES.quantidade.filter((v) => !v.recusa).length);
    // banco: quantidade do abastecimento = quantidade do movimento = Σ fatias, sem fator nenhum
    const [{ divergentes }] = await prisma().$queryRaw`
      SELECT count(*)::int AS divergentes FROM "AbastecimentoBem" a
      JOIN "MovimentacaoEstoque" m ON m.cliente_id = a.cliente_id AND m.id = a.movimentacao_estoque_id
      WHERE a.cliente_id = ${s.c} AND (a.quantidade <> m.quantidade OR a.quantidade <> (SELECT sum(f.quantidade) FROM "AbastecimentoBemConsumoLote" f WHERE f.cliente_id = a.cliente_id AND f.abastecimento_id = a.id))`;
    assert.equal(divergentes, 0);
    assert.equal(await prisma().abastecimentoBem.count({ where: { cliente_id: s.c } }), gravados.length);
  });
});

describe('P1-02 — estoque, capacidade e idempotência', () => {
  test('AB7: sem lote no local / lotes insuficientes / estoque_atual legado menor / unidade fora de L/KG/SACO / local inativo ou inexistente → 422; nada gravado', async () => {
    const s = await montarAbastecimento(app);
    // D-PROD-169: SACO passou a abastecer (em kg); a recusa por unidade vale para unidade fora de L/KG/SACO (dado legado).
    await prisma().$executeRaw`UPDATE "Produto" SET unidade_principal_estoque = 'UN' WHERE id = ${s.emSaco.id}`;
    const antes = await fotoAbastecimento(s.c);
    const semLote = await A.confirmar(s.operador.token, corpoAbastecimento(s, { local_estoque_id: s.local2.id }));
    assert.deepEqual(erro(semLote), [422, 'ESTOQUE_SALDO_INSUFICIENTE', 'quantidade', 'saldo_lote_insuficiente']);
    assert.deepEqual([semLote.json().details.disponivel, semLote.json().details.solicitado, semLote.json().details.unidade], ['0.0000', '80.0000', 'L']);
    assert.match(semLote.json().message, /disponível 0\.0000 L/);
    const insuficiente = await A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade: '151' }));
    assert.deepEqual(erro(insuficiente), [422, 'ESTOQUE_SALDO_INSUFICIENTE', 'quantidade', 'saldo_lote_insuficiente']);
    assert.deepEqual([insuficiente.json().details.disponivel, insuficiente.json().details.solicitado], ['150.0000', '151.0000']);
    const inativo = await A.confirmar(s.operador.token, corpoAbastecimento(s, { local_estoque_id: s.localInativo.id }));
    assert.deepEqual(erro(inativo), [422, 'ABASTECIMENTO_LOCAL_INVALIDO', 'local_estoque_id', 'local_inativo']);
    const inexistente = await A.confirmar(s.operador.token, corpoAbastecimento(s, { local_estoque_id: 'local-que-nao-existe' }));
    assert.deepEqual(erro(inexistente), [422, 'ABASTECIMENTO_LOCAL_INVALIDO', 'local_estoque_id', 'local_inexistente']);
    // UN não é L, KG nem SACO: recusado antes do aceite e do estoque (e nunca convertido)
    const saco = corpoAbastecimento(s, { bem_id: s.gerador.id, tanque_id: s.gerador.tanques[0].id, produto_id: s.emSaco.id, medidor_leitura: null, quantidade: '10' });
    const rpS = await A.ok(A.previa(s.operador.token, previaDe(saco)));
    assert.deepEqual([rpS.bloqueios[0].code, rpS.bloqueios[0].reason, rpS.bloqueios[0].details.unidade], ['ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL', 'unidade_nao_aceita', 'UN']);
    assert.deepEqual([rpS.plano.unidade, rpS.plano.fifo, rpS.plano.estoque], [null, null, null]);
    assert.deepEqual(erro(await A.confirmar(s.operador.token, saco)), [422, 'ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL', 'produto_id', 'unidade_nao_aceita']);
    assert.equal(await fotoAbastecimento(s.c), antes);

    // `estoque_atual` legado MENOR que os lotes (incoerência herdada): recusa, nunca saldo negativo
    await prisma().produto.update({ where: { id: s.diesel.id }, data: { estoque_atual: '50.0000' } });
    const antes2 = await fotoAbastecimento(s.c);
    const rp = await A.ok(A.previa(s.operador.token, corpoPrevia(s)));
    assert.deepEqual(rp.bloqueios.map((b) => [b.code, b.reason, b.details.estoque_atual, b.details.unidade]), [['ESTOQUE_SALDO_INSUFICIENTE', 'estoque_atual_insuficiente', '50.0000', 'L']]);
    assert.deepEqual(erro(await A.confirmar(s.operador.token, corpoAbastecimento(s))), [422, 'ESTOQUE_SALDO_INSUFICIENTE', 'quantidade', 'estoque_atual_insuficiente']);
    assert.equal(await fotoAbastecimento(s.c), antes2);
  });

  test('AB8: capacidade — Produto em L: 180,0001 L → 422 e 180 L não é recusado por capacidade; Produto em KG nunca é comparado com a capacidade; parciais aceitos sem presumir saldo do tanque', async () => {
    const s = await montarAbastecimento(app);
    const antes = await fotoAbastecimento(s.c);
    const rc = await A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade: '180.0001' }));
    assert.deepEqual(erro(rc), [422, 'ABASTECIMENTO_EXCEDE_CAPACIDADE', 'quantidade', 'excede_capacidade_tanque']);
    assert.equal(rc.json().details.capacidade_litros, '180.0000');
    const zero = await A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade: '0.0000' }));
    assert.deepEqual(erro(zero), [422, 'OPERACAO_VALORES_INVALIDOS', 'quantidade', 'quantidade_nao_positiva']);
    assert.equal(await fotoAbastecimento(s.c), antes);
    const rp = await A.ok(A.previa(s.operador.token, corpoPrevia(s, { quantidade: '180' })));
    // 180 L > 150 L nos lotes: o saldo (não a capacidade) recusa.
    assert.deepEqual(rp.bloqueios.map((b) => [b.code, b.reason]), [['ESTOQUE_SALDO_INSUFICIENTE', 'saldo_lote_insuficiente']]);

    await s.lote(s.e1, s.diesel, s.local, { quantidade: '200.0000', custo: '6.0000', dia: '2027-06-04' });
    const cheio = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade: '180', data_operacional: '2027-06-08', medidor_leitura: '1540' }));
    assert.deepEqual([cheio.quantidade, cheio.unidade], ['180.0000', 'L']);
    // parciais no MESMO dia e logo depois do cheio: o sistema não controla o saldo físico do tanque
    const p1 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade: '20', tanque_cheio: false, medidor_leitura: '1541' }));
    const p2 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade: '30', tanque_cheio: false, medidor_leitura: '1541' }));
    assert.deepEqual([p1.quantidade, p2.quantidade], ['20.0000', '30.0000']);
    assert.equal(await estoqueAtual(s.diesel.id), '120.0000', '350 - 180 - 20 - 30');

    // Produto em KG no mesmo tanque de 180 L: 250 kg passa (a capacidade é em litros e só vale para L)
    const rpKg = await A.ok(A.previa(s.operador.token, corpoPrevia(s, { produto_id: s.dieselKg.id, quantidade: '250', data_operacional: '2027-06-11', medidor_leitura: '1542', tanque_cheio: false })));
    assert.deepEqual([rpKg.bloqueios, rpKg.plano.unidade, rpKg.plano.confere_capacidade], [[], 'KG', false]);
    const kg = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { produto_id: s.dieselKg.id, quantidade: '250', data_operacional: '2027-06-11', medidor_leitura: '1542', tanque_cheio: false }));
    assert.deepEqual([kg.quantidade, kg.unidade, kg.custo_total], ['250.0000', 'KG', '1525.0000']);
    assert.equal(await estoqueAtual(s.dieselKg.id), '50.0000');
    assert.equal(await movimentosAbastecimento(s.c), 4);
  });
});

describe('P1-02 — cancelamento bloqueado e efeitos na P3', () => {
  test('AB11: cancelamento bloqueado — original/camada divergentes (P1-02 R1), devolução acima da entrada, lote Estornado (compra P3 cancelada após reposição), produto movido de fazenda; nada alterado', async () => {
    const s = await montarAbastecimento(app);
    const compra = await s.compraP3(s.e1, s.diesel, s.local2, { quantidade: '100.0000', preco: '5.00' });
    const L = compra.lote_id;
    const d = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { local_estoque_id: s.local2.id }));
    assert.deepEqual(d.fatias.map((f) => [f.lote_id, f.quantidade, f.custo_unitario]), [[L, '80.0000', '5.0000']], 'consome o lote nascido da compra P3 em litros');
    /** Mexe no banco por fora, confere a recusa EXATA e que nada mudou, e desfaz. */
    const bloqueadoPor = async (sujar, reason, limpar) => {
      await sujar();
      const foto = await fotoAbastecimento(s.c);
      const r = await A.cancelar(s.contaCancelar.token, d.id, { empresa_id: s.e1.id, ...cancelarCorpo() });
      assert.deepEqual(erro(r), [409, 'ABASTECIMENTO_CANCELAMENTO_BLOQUEADO', 'abastecimento', reason], r.body);
      assert.equal(await fotoAbastecimento(s.c), foto, `${reason}: nada alterado`);
      await limpar();
    };
    const estoqueAtualOriginal = await estoqueAtual(s.diesel.id);
    await bloqueadoPor(() => prisma().$executeRaw`UPDATE "Produto" SET estoque_atual = 9999999999.0000 WHERE id = ${s.diesel.id}`, 'estoque_excede_limite',
      () => prisma().$executeRaw`UPDATE "Produto" SET estoque_atual = ${estoqueAtualOriginal}::numeric WHERE id = ${s.diesel.id}`);
    await bloqueadoPor(() => prisma().$executeRaw`UPDATE "MovimentacaoEstoque" SET status = 'Estornada' WHERE id = ${d.movimentacao.id}`, 'movimento_estornado',
      () => prisma().$executeRaw`UPDATE "MovimentacaoEstoque" SET status = 'Ativa' WHERE id = ${d.movimentacao.id}`);
    // MAIKE-ESTOQUE-P1-02 R1 (M5): o motor revalida o original e as camadas SOB TRAVA, antes de escrever.
    const restaurarMov = () => prisma().$executeRaw`UPDATE "MovimentacaoEstoque" SET produto_id = ${s.diesel.id}, empresa_id = ${s.e1.id} WHERE id = ${d.movimentacao.id}`;
    const restaurarLote = () => prisma().$executeRaw`UPDATE "EstoqueLoteNota" SET produto_id = ${s.diesel.id}, empresa_id = ${s.e1.id}, local_estoque_id = ${s.local2.id} WHERE id = ${L}`;
    await bloqueadoPor(() => prisma().$executeRaw`UPDATE "MovimentacaoEstoque" SET produto_id = ${s.gasolina.id} WHERE id = ${d.movimentacao.id}`, 'vinculo_divergente', restaurarMov);
    await bloqueadoPor(() => prisma().$executeRaw`UPDATE "MovimentacaoEstoque" SET empresa_id = ${s.e2.id} WHERE id = ${d.movimentacao.id}`, 'vinculo_divergente', restaurarMov);
    await bloqueadoPor(() => prisma().$executeRaw`UPDATE "EstoqueLoteNota" SET produto_id = ${s.gasolina.id} WHERE id = ${L}`, 'camada_divergente', restaurarLote);
    await bloqueadoPor(() => prisma().$executeRaw`UPDATE "EstoqueLoteNota" SET empresa_id = ${s.e2.id} WHERE id = ${L}`, 'camada_divergente', restaurarLote);
    await bloqueadoPor(() => prisma().$executeRaw`UPDATE "EstoqueLoteNota" SET local_estoque_id = ${s.local.id} WHERE id = ${L}`, 'camada_divergente', restaurarLote);

    // (a) reposição por fora: o lote volta a 100 L → devolver 80 passaria a entrada
    await prisma().$executeRaw`UPDATE "EstoqueLoteNota" SET quantidade_disponivel = quantidade_entrada WHERE id = ${L}`;
    await prisma().$executeRaw`UPDATE "Produto" SET estoque_atual = estoque_atual + 80 WHERE id = ${s.diesel.id}`;
    const fotoA = await fotoAbastecimento(s.c);
    const excede = await A.cancelar(s.contaCancelar.token, d.id, { empresa_id: s.e1.id, ...cancelarCorpo() });
    assert.deepEqual(erro(excede), [409, 'ABASTECIMENTO_CANCELAMENTO_BLOQUEADO', 'abastecimento', 'devolucao_excede_entrada']);
    assert.equal(excede.json().details.lote_id, L);
    assert.equal(await fotoAbastecimento(s.c), fotoA);

    // (b) lote 'Estornado' → a devolução não tem para onde voltar. Com o abastecimento ATIVO depois, cancelar a compra
    // recusa, nada gravado. D-PROD-313: a recusa do recálculo (replay_diverge_do_gravado, pela reposição feita por fora)
    // agora é precedida pela do registro posterior — o abastecimento é o mais recente que ainda vale. O estado "compra
    // cancelada com o lote Estornado" é emulado no banco para manter provada a defesa do cancelamento do abastecimento.
    const fotoAntesCompra = await fotoAbastecimento(s.c);
    const cancelCompra = await A.req('POST', `/operacoes-financeiras/${compra.operacao.id}/cancelar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), motivo: 'compra devolvida ao fornecedor' });
    assert.deepEqual(erro(cancelCompra), [409, 'ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR', 'movimento_id', 'registro_posterior'], cancelCompra.body);
    assert.deepEqual([cancelCompra.json().details.posterior_id, cancelCompra.json().details.posterior_numero], [d.movimentacao.id, d.movimentacao.numero], cancelCompra.body);
    assert.equal(await fotoAbastecimento(s.c), fotoAntesCompra);
    await prisma().$executeRaw`UPDATE "EstoqueLoteNota" SET status = 'Estornado', quantidade_disponivel = 0 WHERE id = ${L}`;
    await prisma().$executeRaw`UPDATE "Produto" SET estoque_atual = estoque_atual - 100 WHERE id = ${s.diesel.id}`;
    assert.deepEqual(await saldoLote(L), ['0.0000', 'Estornado']);
    const fotoB = await fotoAbastecimento(s.c);
    const estornado = await A.cancelar(s.contaCancelar.token, d.id, { empresa_id: s.e1.id, ...cancelarCorpo() });
    assert.deepEqual(erro(estornado), [409, 'ABASTECIMENTO_CANCELAMENTO_BLOQUEADO', 'abastecimento', 'lote_indisponivel_para_devolucao']);
    assert.equal(estornado.json().details.lote_id, L);
    assert.equal(await fotoAbastecimento(s.c), fotoB);
    assert.equal((await A.ok(A.detalhe(s.leitor.token, d.id, s.e1.id))).status, 'CONFIRMADO');

    // (c) produto movido de fazenda (aceite retirado do tanque + PATCH do produto) → produto_mudou_de_fazenda
    const g = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, {
      bem_id: s.caminhonete.id, tanque_id: s.caminhonete.tanques[0].id, produto_id: s.gasolina.id, quantidade: '30', medidor_leitura: '35300',
    }));
    await A.ok(s.patchAceites(s.caminhonete, [[s.etanol.id]]));
    // D-PROD-161 (Estoque P0): produto com lote, movimento ou cache ≠ 0 não muda mais de fazenda pela API
    // (409 PRODUTO_COM_ESTOQUE_NAO_MUDA_EMPRESA, nada gravado). O estado "produto movido de fazenda" só
    // existe como dado legado (anterior à P0); ele é emulado direto no banco para manter provada a defesa
    // `produto_mudou_de_fazenda` do cancelamento.
    const fotoAntesPatch = await fotoAbastecimento(s.c);
    const patchEmpresa = await A.req('PATCH', `/produtos/${s.gasolina.id}`, s.token, { empresa_id: s.e2.id });
    assert.equal(patchEmpresa.statusCode, 409, patchEmpresa.body);
    assert.equal(patchEmpresa.json().code, 'PRODUTO_COM_ESTOQUE_NAO_MUDA_EMPRESA');
    assert.equal(await fotoAbastecimento(s.c), fotoAntesPatch);
    await prisma().$executeRaw`UPDATE "Produto" SET empresa_id = ${s.e2.id} WHERE id = ${s.gasolina.id}`;
    const fotoC = await fotoAbastecimento(s.c);
    const mudou = await A.cancelar(s.contaCancelar.token, g.id, { empresa_id: s.e1.id, ...cancelarCorpo() });
    assert.deepEqual(erro(mudou), [409, 'ABASTECIMENTO_CANCELAMENTO_BLOQUEADO', 'abastecimento', 'produto_mudou_de_fazenda']);
    assert.equal(await fotoAbastecimento(s.c), fotoC);
  });

  test('AB13: efeitos na P3 (D14) — compra cujo lote o abastecimento consumiu: retificar/excluir 409 e cancelar 409 (D-PROD-313: registro posterior); cancelado o abastecimento (o mais recente), cancelar a compra volta a funcionar e retificar/excluir seguem bloqueados', async () => {
    const s = await montarAbastecimento(app);
    const compra = await s.compraP3(s.e1, s.diesel, s.local2, { quantidade: '100.0000', preco: '5.00' });
    const L = compra.lote_id;
    assert.deepEqual(await saldoLote(L), ['100.0000', 'Disponivel']);
    const d = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { local_estoque_id: s.local2.id }));
    assert.deepEqual(await saldoLote(L), ['20.0000', 'Disponivel']);

    const detalheCompra = async () => A.ok(A.req('GET', `/operacoes-financeiras/${compra.operacao.id}?empresa_id=${s.e1.id}`, s.token));
    const retificar = async () => {
      const atual = await detalheCompra();
      const doc = await s.docCompraP3(s.e1, s.diesel, s.local2, { quantidade: '90.0000', preco: '5.00' });
      return A.req('POST', `/operacoes-financeiras/${atual.id}/retificar`, s.token, { ...doc, versao: atual.versao, operation_id: opId(), motivo: 'quantidade corrigida' });
    };
    const excluir = async () => {
      const atual = await detalheCompra();
      return A.req('POST', `/operacoes-financeiras/${atual.id}/excluir`, s.token, { empresa_id: s.e1.id, versao: atual.versao, operation_id: opId(), motivo: 'lançamento indevido' });
    };
    const motivosDe = (r) => (r.json().details?.motivos ?? []).map((m) => [m.codigo, m.entidade ?? null, m.numero ?? null]);
    const bloqueiosP3 = async () => {
      const ret = await retificar();
      assert.deepEqual([ret.statusCode, ret.json().code, ret.json().details?.reason ?? ret.json().reason], [409, 'OPERACAO_RETIFICACAO_BLOQUEADA', 'lote_consumido'], ret.body);
      assert.ok(motivosDe(ret).some(([c, e, num]) => c === 'lote_consumido' && e === 'MovimentacaoEstoque' && num === d.movimentacao.numero), ret.body);
      const exc = await excluir();
      assert.deepEqual([exc.statusCode, exc.json().code, exc.json().details?.reason ?? exc.json().reason], [409, 'OPERACAO_EXCLUSAO_BLOQUEADA', 'lote_consumido'], exc.body);
    };
    const fotoAntes = await fotoAbastecimento(s.c);
    await bloqueiosP3();
    const cancel1 = await A.req('POST', `/operacoes-financeiras/${compra.operacao.id}/cancelar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), motivo: 'compra devolvida' });
    // D-PROD-313: com o abastecimento depois (ainda vale), o cancelamento da compra recusa 409 registro posterior
    // apontando o abastecimento, nada muda; exclui-se o mais recente primeiro (o abastecimento, logo abaixo)
    assert.deepEqual(erro(cancel1), [409, 'ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR', 'movimento_id', 'registro_posterior'], cancel1.body);
    assert.deepEqual([cancel1.json().details.posterior_id, cancel1.json().details.posterior_numero], [d.movimentacao.id, d.movimentacao.numero], cancel1.body);
    assert.equal(await fotoAbastecimento(s.c), fotoAntes, 'nenhuma recusa da P3 mexeu no estoque nem no abastecimento');

    // cancelar o abastecimento devolve os 80 L ao lote da compra
    await A.ok(A.cancelar(s.contaCancelar.token, d.id, { empresa_id: s.e1.id, ...cancelarCorpo() }));
    assert.deepEqual(await saldoLote(L), ['100.0000', 'Disponivel']);
    await bloqueiosP3(); // o histórico do abastecimento (movimento com lotes_consumidos) continua citando o lote
    const cancel2 = await A.req('POST', `/operacoes-financeiras/${compra.operacao.id}/cancelar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), motivo: 'compra devolvida' });
    assert.equal(cancel2.statusCode, 200, cancel2.body);
    assert.deepEqual(await saldoLote(L), ['0.0000', 'Estornado']);
    assert.equal(await estoqueAtual(s.diesel.id), '150.0000', 'só os lotes legados do cenário');
  });

  test('AB14: X1 — PATCH restrito e DELETE do lote com fatia de abastecimento → 409 REGISTRO_OPERACIONAL_IMUTAVEL; o nome do local segue livre', async () => {
    const s = await montarAbastecimento(app);
    const d = await A.confirmarOk(s.operador.token, corpoAbastecimento(s));
    const antes = await fotoAbastecimento(s.c);
    const patch = await A.req('PATCH', `/estoque-lotes-nota/${s.lotes.dieselB.id}`, s.token, { quantidade_disponivel: 1000 });
    assert.deepEqual(erro(patch).slice(0, 2), [409, 'REGISTRO_OPERACIONAL_IMUTAVEL'], patch.body);
    assert.equal(patch.json().details.vinculo, 'abastecimento_bem');
    const del = await A.req('DELETE', `/estoque-lotes-nota/${s.lotes.dieselA.id}`, s.token);
    assert.deepEqual(erro(del).slice(0, 2), [409, 'REGISTRO_OPERACIONAL_IMUTAVEL'], del.body);
    assert.equal(await fotoAbastecimento(s.c), antes);
    const nome = await A.req('PATCH', `/estoque-lotes-nota/${s.lotes.dieselB.id}`, s.token, { local_estoque_nome: s.local.nome });
    assert.equal(nome.statusCode, 200, nome.body);
    // cancelado: o histórico da fatia continua protegendo o lote
    await A.ok(A.cancelar(s.contaCancelar.token, d.id, { empresa_id: s.e1.id, versao: 1, motivo: 'teste do X1', operation_id: opId() }));
    const patch2 = await A.req('PATCH', `/estoque-lotes-nota/${s.lotes.dieselA.id}`, s.token, { quantidade_disponivel: 10 });
    assert.deepEqual(erro(patch2).slice(0, 2), [409, 'REGISTRO_OPERACIONAL_IMUTAVEL']);
  });
});

describe('P1-02 — inativações com a tela aberta (entre a prévia e a confirmação)', () => {
  test('AB12: produto, unidade, local, tanque, bem, capacidade e aceite mudados depois da prévia → os 422 do plano e nada gravado; natureza sem tanque e tanque de outro bem recusados', async () => {
    const s = await montarAbastecimento(app);
    /** A tela abre com tudo válido, o cadastro muda, a confirmação relê sob as travas. */
    const comTelaAberta = async (rotulo, mudar, esperado, desfazer) => {
      const corpo = corpoAbastecimento(s);
      assert.deepEqual((await A.ok(A.previa(s.operador.token, previaDe(corpo)))).bloqueios, [], `${rotulo}: a tela abriu válida`);
      await mudar();
      const antes = await fotoAbastecimento(s.c);
      const rc = await A.confirmar(s.operador.token, corpo);
      assert.deepEqual(erro(rc), esperado, `${rotulo}: ${rc.body}`);
      assert.equal(await fotoAbastecimento(s.c), antes, `${rotulo}: nada gravado`);
      const refeita = await A.ok(A.previa(s.operador.token, previaDe(corpo)));
      assert.deepEqual([refeita.bloqueios[0].code, refeita.bloqueios[0].reason], [esperado[1], esperado[3]], `${rotulo}: a prévia refeita mostra o mesmo bloqueio`);
      if (desfazer) await desfazer();
    };
    const produto = (ativo) => () => A.ok(A.req('PATCH', `/produtos/${s.diesel.id}`, s.token, { ativo }));
    const unidadeSql = (u) => () => prisma().$executeRaw`UPDATE "Produto" SET unidade_principal_estoque = ${u} WHERE id = ${s.diesel.id}`;
    const local = (ativo) => () => A.ok(A.req('PATCH', `/locais-estoque/${s.local.id}`, s.token, { ativo }));
    const ACEITES = [s.diesel.id, s.dieselKg.id];
    const patchBem = async (corpo) => {
      const b = await A.bem(s.token, s.e1.id, s.trator.id);
      return A.ok(A.req('PATCH', `/bens-patrimoniais/${s.trator.id}`, s.token, { empresa_id: s.e1.id, versao: b.versao, ...corpo(b) }));
    };
    const tanque = (extra, ids = ACEITES) => () => patchBem((b) => ({ tanques: [itemTanque(b.tanques[0], ids, extra)] }));

    await comTelaAberta('produto', produto(false), [422, 'ABASTECIMENTO_PRODUTO_INVALIDO', 'produto_id', 'inativo'], produto(true));
    await comTelaAberta('unidade do produto', unidadeSql('UN'), [422, 'ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL', 'produto_id', 'unidade_nao_aceita'], unidadeSql('L'));
    await comTelaAberta('local', local(false), [422, 'ABASTECIMENTO_LOCAL_INVALIDO', 'local_estoque_id', 'local_inativo'], local(true));
    await comTelaAberta('tanque', tanque({ ativo: false }), [422, 'ABASTECIMENTO_TANQUE_INVALIDO', 'tanque_id', 'tanque_inativo'], tanque({ ativo: true }));
    await comTelaAberta('bem', () => patchBem(() => ({ ativo: false })), [422, 'ABASTECIMENTO_BEM_INELEGIVEL', 'bem_id', 'bem_inativo'], () => patchBem(() => ({ ativo: true })));
    // não é só inativação: capacidade reduzida e Produto retirado dos aceites também são relidos sob as travas
    await comTelaAberta('capacidade', tanque({ capacidade_litros: '50' }), [422, 'ABASTECIMENTO_EXCEDE_CAPACIDADE', 'quantidade', 'excede_capacidade_tanque'],
      tanque({ capacidade_litros: '180' }));
    await comTelaAberta('aceite retirado', tanque({}, [s.dieselKg.id]), [422, 'ABASTECIMENTO_PRODUTO_NAO_ACEITO', 'produto_id', 'nao_aceito_pelo_tanque'], tanque({}));
    // refeito tudo, a mesma tela confirma
    const confirmado = await A.confirmarOk(s.operador.token, corpoAbastecimento(s));

    const antes = await fotoAbastecimento(s.c);
    // implemento (natureza sem tanque)
    const impl = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoImplemento(s)), 201);
    const ri = await A.confirmar(s.operador.token, corpoAbastecimento(s, { bem_id: impl.id, medidor_leitura: null }));
    assert.deepEqual(erro(ri), [422, 'ABASTECIMENTO_BEM_INELEGIVEL', 'bem_id', 'natureza_sem_tanque']);
    assert.equal(ri.json().details.natureza, 'IMPLEMENTO');
    // tanque de OUTRO bem
    const rt = await A.confirmar(s.operador.token, corpoAbastecimento(s, { tanque_id: s.caminhonete.tanques[0].id }));
    assert.deepEqual(erro(rt), [422, 'ABASTECIMENTO_TANQUE_INVALIDO', 'tanque_id', 'tanque_inexistente']);
    const fotoDepois = JSON.parse(await fotoAbastecimento(s.c));
    const fotoAntes = JSON.parse(antes);
    // o implemento criado acima é a única diferença (bem, auditoria e sequência do cadastro P1-01)
    for (const t of ['abastecimentoBem', 'abastecimentoBemConsumoLote', 'tanqueBemProduto', 'movimentacaoEstoque', 'estoqueLoteNota', 'operacaoIdempotente', 'tanqueBem', 'produtos']) {
      assert.deepEqual(fotoDepois[t], fotoAntes[t], t);
    }

    // C14: cancelar é correção — com aceite retirado, tanque, bem, produto e local INATIVOS o estorno exato passa
    await tanque({}, [s.dieselKg.id])();
    const aceite = await prisma().tanqueBemProduto.findFirst({ where: { cliente_id: s.c, tanque_id: s.trator.tanques[0].id, produto_id: s.diesel.id } });
    assert.equal(aceite.ativo, false, 'com histórico, retirar o aceite só desliga a linha (a FK do abastecimento segura o par)');
    await tanque({ ativo: false }, [s.dieselKg.id])();
    await patchBem(() => ({ ativo: false }));
    await produto(false)();
    await local(false)();
    const k = await A.ok(A.cancelar(s.contaCancelar.token, confirmado.id, { empresa_id: s.e1.id, ...cancelarCorpo() }));
    assert.deepEqual([k.status, k.estorno.quantidade, k.estorno.unidade], ['CANCELADO', '80.0000', 'L']);
    assert.equal(await estoqueAtual(s.diesel.id), '150.0000');
  });
});

describe('P1-02 — lista, detalhe e opções', () => {
  test('AB15: lista com filtros (empresa, bem, tanque, produto, status, período, operation_id, q), keyset limit=2 e total; erros de período', async () => {
    const s = await montarAbastecimento(app);
    const cam = { bem_id: s.caminhonete.id, tanque_id: s.caminhonete.tanques[0].id };
    const a1 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, {
      quantidade: '20', data_operacional: '2027-06-05', medidor_leitura: '1530', referencia_externa: 'NF-100', observacao: '  Frentista João — bomba 2  ',
    }));
    assert.deepEqual([a1.observacao, a1.referencia_externa], ['Frentista João — bomba 2', 'NF-100'], 'textos aparados');
    const auditA1 = await prisma().auditLog.findFirst({ where: { cliente_id: s.c, acao: 'abastecimento_bem.confirmar', entidade_id: a1.id } });
    assert.deepEqual([auditA1.dados_novos.tem_observacao, auditA1.dados_novos.tem_referencia_externa], [true, true]);
    assert.equal(/Frentista|NF-100/.test(JSON.stringify(auditA1)), false, 'a auditoria não copia texto livre (allowlist)');
    const a2 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade: '20', data_operacional: '2027-06-08', medidor_leitura: '1540', referencia_externa: 'nf-200' }));
    const a3 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { ...cam, produto_id: s.gasolina.id, quantidade: '30', data_operacional: '2027-06-09', medidor_leitura: '35300' }));
    const a4 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, {
      ...cam, produto_id: s.etanol.id, quantidade: '10', data_operacional: '2027-06-12', medidor_leitura: '35400', tanque_cheio: false,
    }));
    await A.ok(A.cancelar(s.contaCancelar.token, a2.id, { empresa_id: s.e1.id, ...cancelarCorpo() }));
    const ids = async (extra) => (await A.ok(A.lista(s.leitor.token, s.e1.id, extra))).items.map((i) => i.id);

    const tudo = await A.ok(A.lista(s.leitor.token, s.e1.id));
    assert.deepEqual([tudo.total, tudo.has_more, tudo.next_cursor, tudo.items.map((i) => i.id)], [4, false, null, [a4.id, a3.id, a2.id, a1.id]]);
    const r3 = tudo.items[1];
    assert.deepEqual(Object.keys(r3).sort(), [
      'apontamento', 'atividade', 'bem', 'centro_custo', 'created_date', 'custo_total', 'data_operacional', 'id', 'intervalo_confiavel', 'local_estoque', 'medidor',
      'medidor_delta', 'medidor_leitura_anterior', 'numero', 'origem', 'produto', 'quantidade', 'referencia_externa', 'status', 'tanque',
      'tanque_cheio', 'unidade', 'updated_date', 'versao',
    ], 'D-PROD-211: origem, vínculo, centro de custo e snapshot do medidor');
    assert.deepEqual([r3.produto, r3.tanque.id, r3.medidor, r3.quantidade, r3.unidade, r3.custo_total],
      [{ id: s.gasolina.id, nome: 'Gasolina comum (L)' }, cam.tanque_id, { tipo: 'ODOMETRO', unidade: 'km', leitura: '35300.0000' }, '30.0000', 'L', '180.0000']);
    assert.deepEqual(await ids(`&bem_id=${s.trator.id}`), [a2.id, a1.id]);
    assert.deepEqual(await ids(`&tanque_id=${cam.tanque_id}`), [a4.id, a3.id]);
    assert.deepEqual(await ids(`&produto_id=${s.gasolina.id}`), [a3.id]);
    assert.deepEqual(await ids('&status=CANCELADO'), [a2.id]);
    assert.deepEqual(await ids('&status=CONFIRMADO'), [a4.id, a3.id, a1.id]);
    assert.deepEqual(await ids('&data_de=2027-06-08&data_ate=2027-06-09'), [a3.id, a2.id]);
    assert.deepEqual(await ids('&data_de=2027-06-12'), [a4.id]);
    assert.deepEqual(await ids(`&operation_id=${encodeURIComponent((await prisma().abastecimentoBem.findUnique({ where: { id: a1.id } })).operation_id)}`), [a1.id]);
    assert.deepEqual(await ids('&q=NF-'), [a2.id, a1.id], 'referência externa sem diferenciar maiúsculas');
    assert.deepEqual(await ids(`&q=${a3.numero}`), [a3.id]);
    assert.deepEqual(await ids(`&bem_id=${s.trator.id}&status=CONFIRMADO`), [a1.id]);
    assert.equal((await A.ok(A.lista(s.leitor.token, s.e2.id))).total, 0);

    const p1 = await A.ok(A.lista(s.leitor.token, s.e1.id, '&limit=2'));
    assert.deepEqual([p1.total, p1.limit, p1.has_more, p1.items.map((i) => i.id)], [4, 2, true, [a4.id, a3.id]]);
    assert.equal(typeof p1.next_cursor, 'string');
    const p2 = await A.ok(A.lista(s.leitor.token, s.e1.id, `&limit=2&cursor=${encodeURIComponent(p1.next_cursor)}`));
    assert.deepEqual([p2.total, p2.has_more, p2.next_cursor, p2.items.map((i) => i.id)], [4, false, null, [a2.id, a1.id]]);

    assert.deepEqual(erro(await A.lista(s.leitor.token, s.e1.id, '&data_de=2027-02-30')), [422, 'PATRIMONIO_DATA_INVALIDA', 'data_de', 'data_inexistente']);
    assert.deepEqual(erro(await A.lista(s.leitor.token, s.e1.id, '&data_de=2027-06-10&data_ate=2027-06-09')), [400, 'REQUEST_VALIDATION_FAILED', 'data_ate', 'periodo_invertido']);
    assert.equal(erro(await A.lista(s.leitor.token, s.e1.id, '&status=ESTORNADO'))[0], 400);
    assert.deepEqual(erro(await A.lista(s.leitor.token, s.e1.id, '&cursor=lixo')).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED']);

    // detalhe: fatias, movimento, estorno, cancelamento e consumo (CANCELADO e CONFIRMADO)
    const d2 = await A.ok(A.detalhe(s.leitor.token, a2.id, s.e1.id));
    assert.deepEqual([d2.status, d2.estorno.tipo_detalhado, d2.movimentacao.status, d2.cancelamento.motivo, d2.consumo.situacao, d2.consumo.motivo],
      ['CANCELADO', 'estorno_abastecimento', 'Estornada', 'lançado no bem errado', 'NAO_APLICAVEL', 'cancelado']);
    const d3 = await A.ok(A.detalhe(s.leitor.token, a3.id, s.e1.id));
    assert.deepEqual([d3.fatias.map((f) => [f.lote_id, f.quantidade]), d3.estorno, d3.cancelamento, d3.consumo.metrica, d3.consumo.metodologia.startsWith('Método do tanque cheio')],
      [[[s.lotes.gasolina.id, '30.0000']], null, null, 'KM_POR_LITRO', true]);
    assert.deepEqual(erro(await A.detalhe(s.leitor.token, 'nao-existe', s.e1.id)).slice(0, 2), [404, 'ABASTECIMENTO_NAO_ENCONTRADO']);
  });

  test('AB16: opções — bens (formulário × filtro), tanques (Produtos aceitos + leitura vigente), produtos-filtro e locais (saldo na unidade do Produto)', async () => {
    const s = await montarAbastecimento(app);
    const tok = s.operador.token;
    const q = `empresa_id=${s.e1.id}`;
    const nomes = (r) => r.itens.map((i) => i.nome);
    const impl = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoImplemento(s)), 201);
    const reserva = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, {
      nome: 'Trator TP-03 reserva', codigo_frota: 'TP-03', tanques: [{ identificador: 'Tanque principal', capacidade_litros: '180', produto_ids: [s.diesel.id] }],
    })), 201);
    await A.ok(A.req('PATCH', `/bens-patrimoniais/${reserva.id}`, s.token, { empresa_id: s.e1.id, versao: reserva.versao, tanques: [itemTanque(reserva.tanques[0], [s.diesel.id], { ativo: false })] }));
    await A.ok(A.req('PATCH', `/bens-patrimoniais/${s.gerador.id}`, s.token, { empresa_id: s.e1.id, versao: s.gerador.versao, ativo: false }));

    // bens
    const form = await A.ok(A.opcoes(tok, 'bens', q));
    assert.deepEqual(nomes(form), ['Caminhonete UT-04', 'Trator TP-02'], 'só ativos com tanque ativo');
    assert.deepEqual(form.itens[1], { id: s.trator.id, numero: s.trator.numero, codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA', ativo: true, medidor: { tipo: 'HORIMETRO', unidade: 'h' } });
    const filtro = await A.ok(A.opcoes(tok, 'bens', `${q}&uso=filtro`));
    assert.deepEqual(nomes(filtro), ['Caminhonete UT-04', 'Gerador da sede', 'Trator TP-02', 'Trator TP-03 reserva']);
    assert.equal(filtro.itens.some((b) => b.id === impl.id), false, 'implemento (sem tanque) nunca aparece');
    assert.deepEqual(nomes(await A.ok(A.opcoes(tok, 'bens', `${q}&q=tp-02`))), ['Trator TP-02']);
    const pag = await A.ok(A.opcoes(tok, 'bens', `${q}&uso=filtro&limit=3`));
    assert.deepEqual([nomes(pag), pag.has_more], [['Caminhonete UT-04', 'Gerador da sede', 'Trator TP-02'], true]);
    const pag2 = await A.ok(A.opcoes(tok, 'bens', `${q}&uso=filtro&limit=3&cursor=${encodeURIComponent(pag.next_cursor)}`));
    assert.deepEqual([nomes(pag2), pag2.has_more], [['Trator TP-03 reserva'], false]);

    // tanques: Produtos aceitos (com a unidade e se servem agora) + leitura vigente (cadastro → abastecimento)
    const t0 = await A.ok(A.opcoes(tok, 'tanques', `${q}&bem_id=${s.trator.id}`));
    assert.deepEqual(t0.itens, [{
      id: s.trator.tanques[0].id, identificador: 'Tanque principal', capacidade_litros: '180.0000',
      produtos: [
        { id: s.diesel.id, nome: 'Diesel S10 (L)', codigo_interno: null, unidade_principal_estoque: 'L', unidade_abastecimento: 'L', elegivel: true, motivo: null },
        { id: s.dieselKg.id, nome: 'Diesel S10 granel (kg)', codigo_interno: null, unidade_principal_estoque: 'KG', unidade_abastecimento: 'KG', elegivel: true, motivo: null },
      ],
    }]);
    semCamposRemovidos(t0.itens[0], 'tanque');
    assert.equal(Object.prototype.hasOwnProperty.call(t0.itens[0], 'combustiveis'), false);
    assert.deepEqual(t0.bem.leitura_vigente, { leitura: '1520.5000', data: '2027-06-01', origem: 'CADASTRO', abastecimento_id: null, numero: null });
    const d = await A.confirmarOk(tok, corpoAbastecimento(s));
    const t1 = await A.ok(A.opcoes(tok, 'tanques', `${q}&bem_id=${s.trator.id}`));
    assert.deepEqual(t1.bem.leitura_vigente, { leitura: '1550.5000', data: '2027-06-10', origem: 'ABASTECIMENTO', abastecimento_id: d.id, numero: d.numero });
    assert.deepEqual((await A.ok(A.opcoes(tok, 'tanques', `${q}&bem_id=${reserva.id}`))).itens, [], 'tanque inativo fora');
    assert.equal((await A.ok(A.opcoes(tok, 'tanques', `${q}&bem_id=${s.gerador.id}`))).bem.leitura_vigente, null, 'sem medidor: sem leitura');
    assert.deepEqual(erro(await A.opcoes(tok, 'tanques', `empresa_id=${s.e2.id}&bem_id=${s.trator.id}`)).slice(0, 2), [404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO']);
    // Produto aceito que ficou inativo continua listado, marcado
    await A.ok(A.req('PATCH', `/produtos/${s.etanol.id}`, s.token, { ativo: false }));
    const cam = await A.ok(A.opcoes(tok, 'tanques', `${q}&bem_id=${s.caminhonete.id}`));
    assert.deepEqual(cam.itens[0].produtos.map((p) => [p.nome, p.elegivel, p.motivo]), [['Etanol hidratado (L)', false, 'inativo'], ['Gasolina comum (L)', true, null]]);

    // produtos do filtro: aceitos em tanque de bem da fazenda (inclui o inativo); nunca o da F2 nem o que nenhum tanque aceita
    const pf = await A.ok(A.opcoes(tok, 'produtos-filtro', q));
    assert.deepEqual(pf.itens.map((p) => p.id).sort(), [s.diesel.id, s.dieselKg.id, s.etanol.id, s.gasolina.id].sort());

    // locais com saldo do produto, na unidade do Produto (local inativo fora; produto de outra fazenda 404)
    await s.lote(s.e1, s.diesel, s.localInativo, { quantidade: '10.0000', custo: '5.0000', dia: '2027-06-02' });
    await s.lote(s.e1, s.diesel, s.local2, { quantidade: '5.0000', custo: '5.0000', dia: '2027-06-02' });
    const loc = await A.ok(A.opcoes(tok, 'locais', `${q}&produto_id=${s.diesel.id}`));
    assert.deepEqual(loc.itens, [
      { local_estoque_id: s.local2.id, local_nome: s.local2.nome, disponivel: '5.0000', unidade: 'L', unidade_principal_estoque: 'L' },
      { local_estoque_id: s.local.id, local_nome: s.local.nome, disponivel: '70.0000', unidade: 'L', unidade_principal_estoque: 'L' },
    ]);
    const locKg = await A.ok(A.opcoes(tok, 'locais', `${q}&produto_id=${s.dieselKg.id}`));
    assert.deepEqual(locKg.itens.map((l) => [l.local_estoque_id, l.disponivel, l.unidade]), [[s.local.id, '300.0000', 'KG']]);
    assert.deepEqual(erro(await A.opcoes(tok, 'locais', `${q}&produto_id=${s.diesel2.id}`)), [404, 'PRODUTO_NOT_FOUND', 'produto_id', 'produto_nao_encontrado']);
    const loc2 = await A.ok(A.opcoes(tok, 'locais', `empresa_id=${s.e2.id}&produto_id=${s.diesel2.id}`));
    assert.deepEqual(loc2.itens.map((l) => [l.local_estoque_id, l.disponivel]), [[s.local.id, '500.0000']]);
  });
});

describe('P1-02 — permissões e isolamento', () => {
  test('S4 (parcial): decimal como número, campo antigo do fator/tipo/litros e campo extra → 400; nada gravado', async () => {
    const s = await montarAbastecimento(app);
    const antes = await fotoAbastecimento(s.c);
    const numero = await A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade: 80 }));
    assert.deepEqual(erro(numero), [400, 'REQUEST_VALIDATION_FAILED', 'quantidade', 'valor_deve_ser_texto']);
    const v1 = corpoAbastecimento(s);
    delete v1.quantidade;
    for (const antigo of [
      { ...v1, quantidade_litros: '80' },
      { ...corpoAbastecimento(s), tipo_combustivel_id: 'qualquer' },
      { ...corpoAbastecimento(s), conversao_id: 'qualquer', conversao_versao: 1 },
      { ...corpoAbastecimento(s), cliente_id: s.c },
    ]) {
      const r = await A.confirmar(s.operador.token, antigo);
      assert.deepEqual(erro(r).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], r.body);
    }
    assert.equal(await fotoAbastecimento(s.c), antes);
  });

  test('S2 (parcial): sem a linha da tela tudo 403; só visualizar lê mas não confirma; as rotas do fator kg/L e dos tipos saíram (404)', async () => {
    const s = await montarAbastecimento(app);
    const antes = await fotoAbastecimento(s.c);
    const semLinha = await s.conta({ modulos_permitidos: ['patrimonio'], permissoes_telas: [{ ...linhaAbastecimento({}), tela_id: 'pat-bens-patrimoniais', visualizar: true, novo: true }] });
    for (const r of [
      await A.lista(semLinha.token, s.e1.id),
      await A.previa(semLinha.token, corpoPrevia(s)),
      await A.confirmar(semLinha.token, corpoAbastecimento(s)),
      await A.req('GET', `/patrimonio-abastecimentos-opcoes/bens?empresa_id=${s.e1.id}`, semLinha.token),
    ]) {
      assert.deepEqual(erro(r).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA'], r.body);
    }
    assert.equal((await A.lista(s.leitor.token, s.e1.id)).statusCode, 200);
    assert.equal((await A.req('GET', `/patrimonio-abastecimentos-opcoes/bens?empresa_id=${s.e1.id}`, s.leitor.token)).statusCode, 200);
    assert.deepEqual(erro(await A.previa(s.leitor.token, corpoPrevia(s))).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    assert.deepEqual(erro(await A.confirmar(s.leitor.token, corpoAbastecimento(s))).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    assert.deepEqual(erro(await A.req('GET', `/patrimonio-abastecimentos-opcoes/locais?empresa_id=${s.e1.id}&produto_id=${s.diesel.id}`, s.leitor.token)).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    for (const [metodo, url, corpo] of [
      ['GET', `/patrimonio-conversoes-combustivel?empresa_id=${s.e1.id}`],
      ['POST', '/patrimonio-conversoes-combustivel', { empresa_id: s.e1.id }],
      ['POST', '/patrimonio-conversoes-combustivel/qualquer/encerrar', { empresa_id: s.e1.id, versao: 1 }],
      ['GET', '/patrimonio-abastecimentos-opcoes/tipos'],
      ['GET', `/patrimonio-abastecimentos-opcoes/produtos?empresa_id=${s.e1.id}&tipo_combustivel_id=x`],
    ]) {
      assert.equal((await A.req(metodo, url, s.token, corpo)).statusCode, 404, `${metodo} ${url} saiu (D-PROD-162)`);
    }
    assert.equal(await fotoAbastecimento(s.c), antes);
    // o administrador real passa
    assert.equal((await A.previa(s.token, corpoPrevia(s))).statusCode, 200);
  });

  test('S3/AB9 (parcial): outro tenant → 404 (abastecimento, bem, empresa) e 422 sem oráculo (produto, local); a MESMA operation_id em outro tenant é operação nova', async () => {
    const s = await montarAbastecimento(app);
    const outro = await montarAbastecimento(app);
    const corpo = corpoAbastecimento(s);
    const d = await A.confirmarOk(s.operador.token, corpo);
    const antes = await fotoAbastecimento([s.c, outro.c]);
    assert.deepEqual(erro(await A.detalhe(outro.operador.token, d.id, outro.e1.id)).slice(0, 2), [404, 'ABASTECIMENTO_NAO_ENCONTRADO']);
    assert.deepEqual(erro(await A.detalhe(outro.operador.token, d.id, s.e1.id)).slice(0, 2), [404, 'EMPRESA_NOT_FOUND']);
    const cancelar = await A.cancelar(outro.contaCancelar.token, d.id, { empresa_id: outro.e1.id, versao: 1, motivo: 'tentativa cruzada', operation_id: opId() });
    assert.deepEqual(erro(cancelar).slice(0, 2), [404, 'ABASTECIMENTO_NAO_ENCONTRADO']);
    const prev = await A.previa(outro.operador.token, corpoPrevia(outro, { bem_id: s.trator.id }));
    assert.deepEqual(erro(prev), [404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO', 'bem_id', 'bem_inexistente']);
    const conf = await A.confirmar(outro.operador.token, corpoAbastecimento(outro, { produto_id: s.diesel.id }));
    assert.deepEqual(erro(conf), [422, 'ABASTECIMENTO_PRODUTO_INVALIDO', 'produto_id', 'inexistente']);
    const inexistente = await A.confirmar(outro.operador.token, corpoAbastecimento(outro, { produto_id: 'produto-que-nao-existe' }));
    assert.deepEqual(erro(inexistente), erro(conf), 'o Produto de outro tenant responde como o inexistente (sem oráculo)');
    const localCruzado = await A.confirmar(outro.operador.token, corpoAbastecimento(outro, { local_estoque_id: s.local.id }));
    assert.deepEqual(erro(localCruzado), [422, 'ABASTECIMENTO_LOCAL_INVALIDO', 'local_estoque_id', 'local_inexistente']);
    assert.equal((await A.ok(A.lista(outro.operador.token, outro.e1.id))).total, 0);
    assert.equal(await fotoAbastecimento([s.c, outro.c]), antes);

    // AB9: a chave é por tenant — o outro tenant grava a SUA operação com a mesma operation_id
    const mesmaChave = await A.confirmar(outro.operador.token, corpoAbastecimento(outro, { operation_id: corpo.operation_id }));
    assert.equal(mesmaChave.statusCode, 201, mesmaChave.body);
    assert.equal(mesmaChave.json().replay, false);
    assert.notEqual(mesmaChave.json().id, d.id);
    assert.deepEqual([await movimentosAbastecimento(s.c), await movimentosAbastecimento(outro.c)], [1, 1]);
    const replayOrigem = await A.confirmar(s.operador.token, corpo);
    assert.deepEqual([replayOrigem.statusCode, replayOrigem.json().id], [200, d.id]);
  });
});
