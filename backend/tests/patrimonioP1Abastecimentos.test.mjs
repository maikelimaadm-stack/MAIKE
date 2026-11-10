/**
 * D-PROD-159 — Patrimônio P1-02: abastecimento e consumo (testes funcionais
 * iniciais, PostgreSQL real + HTTP autenticado).
 *
 *  - fluxo feliz do aceite (TP-02, diesel S10): fator → prévia (zero escrita) →
 *    confirmar 201 (movimento `abastecimento_patrimonio`, FIFO em 2 lotes, custo
 *    354,6000 / 5,2768) → replay 200 → cancelar (estorno EXATO por lote) →
 *    cancelar de novo 409 → replay do cancelamento 200;
 *  - principais recusas: fator ausente, unidade do produto incompatível,
 *    capacidade do tanque, leitura regressiva, decimal número, 403 sem
 *    permissão e 404 de outro tenant — sempre com "nada gravado".
 *
 * Os testes extensos (concorrência, segurança, medidor, efeitos P3) vêm em
 * arquivos próprios sobre o mesmo cenário (`patrimonioP1AbastecimentoCenario.mjs`).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import {
  acoesAbastecimento, corpoAbastecimento, corpoPrevia, erro, fotoAbastecimento, linhaAbastecimento, montarAbastecimento, opId, prisma,
} from './patrimonioP1AbastecimentoCenario.mjs';

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
const estoqueAtual = async (produtoId) => (await prisma().produto.findUnique({ where: { id: produtoId } })).estoque_atual.toFixed(4);
const bemCru = (id) => prisma().bemPatrimonial.findUnique({ where: { id } });

describe('P1-02 — fluxo feliz do aceite (TP-02, diesel S10)', () => {
  test('AB1/AB10: fator → prévia → confirmar → replay → cancelar (estorno exato em 2 lotes) → 409 → replay do cancelamento', async () => {
    const s = await montarAbastecimento(app);
    assert.equal(s.fator.diesel.kg_por_litro, '0.840000');
    assert.equal(s.fator.diesel.sequencia, 1);
    assert.equal(s.fator.diesel.ativo, true);
    const bemAntes = await bemCru(s.trator.id);

    // ── prévia: plano completo e ZERO escrita ──
    const fotoAntes = await fotoAbastecimento(s.c);
    const rp = await A.previa(s.operador.token, corpoPrevia(s));
    assert.equal(rp.statusCode, 200, rp.body);
    const { plano, bloqueios } = rp.json();
    assert.deepEqual(bloqueios, []);
    assert.equal(plano.quantidade_litros, '80.0000');
    assert.equal(plano.quantidade_kg, '67.2000');
    assert.deepEqual(plano.conversao, { id: s.fator.diesel.id, versao: 1, sequencia: 1, kg_por_litro: '0.840000' });
    assert.equal(plano.custo_e_estimativa, true);
    assert.equal(plano.fifo.suficiente, true);
    assert.equal(plano.fifo.custo_total_estimado, '354.6000');
    assert.equal(plano.fifo.custo_unitario_estimado, '5.2768');
    assert.deepEqual(
      plano.fifo.fatias.map((f) => [f.ordem, f.lote_id, f.data_lote, f.quantidade_kg, f.custo_unitario, f.valor]),
      [
        [1, s.lotes.dieselA.id, '2027-06-01', '50.0000', '5.2000', '260.0000'],
        [2, s.lotes.dieselB.id, '2027-06-03', '17.2000', '5.5000', '94.6000'],
      ]
    );
    assert.deepEqual(plano.estoque, { saldo_local_kg: '150.0000', estoque_atual_kg: '150.0000' });
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
    assert.equal(d.replay, false);
    assert.equal(d.status, 'CONFIRMADO');
    assert.equal(d.versao, 1);
    assert.match(d.numero, /^\d+$/);
    assert.equal(d.data_operacional, '2027-06-10');
    assert.equal(d.quantidade_litros, '80.0000');
    assert.equal(d.kg_por_litro, '0.840000');
    assert.equal(d.quantidade_kg, '67.2000');
    assert.equal(d.custo_total, '354.6000');
    assert.equal(d.custo_unitario_kg, '5.2768');
    assert.equal(d.tanque_cheio, true);
    assert.deepEqual(d.medidor, { tipo: 'HORIMETRO', unidade: 'h', leitura: '1550.5000', origem: 'ABASTECIMENTO' });
    assert.deepEqual(d.conversao, { id: s.fator.diesel.id, sequencia: 1, versao: 1, vigente: true });
    assert.deepEqual(d.tipo_combustivel, { id: s.comb.DIESEL_S10, codigo: 'DIESEL_S10', nome: 'Diesel S10' });
    assert.deepEqual(d.produto, { id: s.diesel.id, nome: 'Diesel S10 granel', unidade_principal_estoque: 'KG' });
    assert.equal(d.movimentacao.tipo_movimentacao, 'Saída');
    assert.equal(d.movimentacao.tipo_detalhado, 'abastecimento_patrimonio');
    assert.equal(d.movimentacao.status, 'Ativa');
    assert.equal(d.movimentacao.quantidade_kg, '67.2000');
    assert.equal(d.movimentacao.valor_total, '354.6000');
    assert.equal(d.movimentacao.valor_unitario, '5.2768');
    assert.match(d.movimentacao.numero, /^\d+$/);
    assert.equal(d.estorno, null);
    assert.equal(d.cancelamento, null);
    assert.deepEqual(d.criado_por, { id: s.operador.id, login: s.operador.login });
    assert.deepEqual(
      d.fatias.map((f) => [f.ordem, f.lote_id, f.quantidade_kg, f.custo_unitario, f.valor]),
      [
        [1, s.lotes.dieselA.id, '50.0000', '5.2000', '260.0000'],
        [2, s.lotes.dieselB.id, '17.2000', '5.5000', '94.6000'],
      ]
    );
    assert.equal(d.consumo.situacao, 'DADOS_INSUFICIENTES');
    assert.equal(d.consumo.motivo, 'sem_tanque_cheio_anterior');
    assert.equal(d.efeito_cancelamento_medidor.muda, true);
    assert.equal(d.efeito_cancelamento_medidor.leitura_operacional_antes.origem, 'ABASTECIMENTO');
    assert.equal(d.efeito_cancelamento_medidor.leitura_operacional_depois.origem, 'CADASTRO');

    // banco: movimento físico de saída do motor, nunca financeiro
    const mov = await prisma().movimentacaoEstoque.findUnique({ where: { id: d.movimentacao.id } });
    assert.equal(mov.origem_sistema, 'abastecimento_patrimonio');
    assert.equal(mov.exclusao_somente_em, 'abastecimento_patrimonio');
    assert.equal(mov.lancamento_origem_id, d.id);
    assert.equal(mov.motivo_movimentacao, 'Saída por abastecimento de bem patrimonial');
    assert.equal(mov.quantidade.toFixed(4), '67.2000');
    assert.equal(mov.unidade_medida, 'KG');
    assert.equal(mov.local_estoque_origem, s.local.id);
    assert.deepEqual(mov.lotes_consumidos, [
      { lote_id: s.lotes.dieselA.id, quantidade: '50.0000', custo_unitario: '5.2000' },
      { lote_id: s.lotes.dieselB.id, quantidade: '17.2000', custo_unitario: '5.5000' },
    ]);
    assert.equal(mov.vinculado ?? false, false, 'C8: M2 não preenche vínculo do movimento');
    const a = await lote(s.lotes.dieselA.id);
    const b = await lote(s.lotes.dieselB.id);
    assert.deepEqual([a.quantidade_disponivel.toFixed(4), a.status], ['0.0000', 'Esgotado']);
    assert.deepEqual([b.quantidade_disponivel.toFixed(4), b.status], ['82.8000', 'Disponivel']);
    assert.equal(await estoqueAtual(s.diesel.id), '82.8000');
    const linhaDb = await prisma().abastecimentoBem.findUnique({ where: { id: d.id } });
    assert.equal(linhaDb.operation_id, corpo.operation_id);
    assert.equal(linhaDb.medidor_origem, 'ABASTECIMENTO');
    assert.equal(await prisma().operacaoFinanceira.count({ where: { cliente_id: s.c } }), 0, 'nenhum lançamento financeiro');
    const audit = await prisma().auditLog.findMany({ where: { cliente_id: s.c, acao: 'abastecimento_bem.confirmar' } });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].entidade_id, d.id);
    assert.equal(audit[0].dados_novos.quantidade_kg, '67.2000');
    assert.equal(audit[0].dados_novos.fatias.length, 2);
    assert.equal(JSON.stringify(await bemCru(s.trator.id)), JSON.stringify(bemAntes), 'o abastecimento nunca grava o bem (versão e medidor intactos)');

    // detalhe do bem ganha a leitura operacional (X2)
    const bemPublico = await A.ok(A.req('GET', `/bens-patrimoniais/${s.trator.id}?empresa_id=${s.e1.id}`, s.token));
    assert.deepEqual(bemPublico.medidor_operacional, { leitura: '1550.5000', data: '2027-06-10', abastecimento_id: d.id });
    assert.equal(bemPublico.medidor.leitura_atual, '1520.5000');

    // ── replay: mesma chave + mesmo corpo ("80" ≡ "80.0000") → 200, um único movimento ──
    const rr = await A.confirmar(s.operador.token, { ...corpo, quantidade_litros: '80.0000' });
    assert.equal(rr.statusCode, 200, rr.body);
    assert.equal(rr.json().replay, true);
    assert.equal(rr.json().id, d.id);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c, origem_sistema: 'abastecimento_patrimonio' } }), 1);

    // mesma chave + corpo diferente → 409, nada gravado, conflito auditado
    const fotoReplay = await fotoAbastecimento(s.c);
    const rx = await A.confirmar(s.operador.token, { ...corpo, quantidade_litros: '81' });
    assert.deepEqual(erro(rx).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
    const conflito = await prisma().auditLog.findMany({ where: { cliente_id: s.c, acao: 'abastecimento_bem.reenvio_conflitante' } });
    assert.equal(conflito.length, 1);
    assert.equal(conflito[0].dados_novos.operation_id, corpo.operation_id);
    const semConflito = (f) => JSON.parse(f).auditLog.filter((l) => l.acao !== 'abastecimento_bem.reenvio_conflitante').length;
    assert.equal(semConflito(await fotoAbastecimento(s.c)), semConflito(fotoReplay));

    // ── cancelar: estorno EXATO fatia a fatia ──
    const cancelarSem = await A.cancelar(s.operador.token, d.id, { empresa_id: s.e1.id, versao: 1, motivo: 'lançado no bem errado', operation_id: opId() });
    assert.deepEqual(erro(cancelarSem).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA'], 'sem a ação extra cancelar');
    const corpoCancelar = { empresa_id: s.e1.id, versao: 1, motivo: 'lançado no bem errado', operation_id: opId() };
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
    assert.equal(k.estorno.quantidade_kg, '67.2000');
    assert.equal(k.estorno.valor_total, '354.6000');
    assert.equal(k.estorno.data_movimentacao, '2027-06-15T12:00:00.000Z', 'dia do estorno = hoje da fazenda');
    assert.equal(k.movimentacao.status, 'Estornada');
    assert.equal(k.leitura_operacional_antes.origem, 'ABASTECIMENTO');
    assert.equal(k.leitura_operacional_depois.origem, 'CADASTRO');
    assert.equal(k.efeito_cancelamento_medidor, null);
    assert.equal(k.consumo.situacao, 'NAO_APLICAVEL');
    const a2 = await lote(s.lotes.dieselA.id);
    const b2 = await lote(s.lotes.dieselB.id);
    assert.deepEqual([a2.quantidade_disponivel.toFixed(4), a2.status], ['50.0000', 'Disponivel']);
    assert.deepEqual([b2.quantidade_disponivel.toFixed(4), b2.status], ['100.0000', 'Disponivel']);
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
    const depoisCancelar = await A.ok(A.req('GET', `/bens-patrimoniais/${s.trator.id}?empresa_id=${s.e1.id}`, s.token));
    assert.equal(depoisCancelar.medidor_operacional, null);

    // cancelar de novo (outra chave) → 409; replay da 1ª chave → 200 com o mesmo corpo
    const rk2 = await A.cancelar(s.contaCancelar.token, d.id, { ...corpoCancelar, versao: 2, operation_id: opId() });
    assert.deepEqual(erro(rk2), [409, 'ABASTECIMENTO_STATUS_INVALIDO', 'status', 'status_invalido']);
    const rk3 = await A.cancelar(s.contaCancelar.token, d.id, corpoCancelar);
    assert.equal(rk3.statusCode, 200, rk3.body);
    assert.equal(rk3.json().replay, true);
    assert.equal(rk3.json().estorno.id, k.estorno.id);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c, origem_sistema: 'abastecimento_patrimonio' } }), 2);

    // lista com filtro por operation_id (C6) e detalhe
    const lista = await A.ok(A.lista(s.operador.token, s.e1.id, `&operation_id=${corpo.operation_id}`));
    assert.equal(lista.total, 1);
    assert.equal(lista.items[0].id, d.id);
    assert.equal(lista.items[0].status, 'CANCELADO');
    assert.equal(lista.items[0].quantidade_kg, '67.2000');
    assert.deepEqual(lista.items[0].tipo_combustivel, { id: s.comb.DIESEL_S10, nome: 'Diesel S10' });
    const det = await A.ok(A.detalhe(s.leitor.token, d.id, s.e1.id));
    assert.equal(det.status, 'CANCELADO');
    assert.equal(det.fatias.length, 2);
  });
});

describe('P1-02 — recusas principais (nada gravado)', () => {
  test('AB4: sem fator vigente → prévia com bloqueio AUSENTE e confirmação 422', async () => {
    const s = await montarAbastecimento(app, { fatores: false });
    const antes = await fotoAbastecimento(s.c);
    const rp = await A.ok(A.previa(s.operador.token, corpoPrevia(s)));
    assert.deepEqual(rp.bloqueios.map((b) => [b.code, b.field, b.reason]), [['ABASTECIMENTO_CONVERSAO_AUSENTE', 'conversao_id', 'sem_conversao_vigente']]);
    assert.equal(rp.plano.quantidade_kg, null, 'nenhum kg sem fator: 1 L nunca vale 1 kg');
    assert.equal(rp.plano.conversao, null);
    const rc = await A.confirmar(s.operador.token, corpoAbastecimento(s, { conversao_id: 'fator-inexistente', conversao_versao: 1 }));
    assert.deepEqual(erro(rc), [422, 'ABASTECIMENTO_CONVERSAO_AUSENTE', 'conversao_id', 'sem_conversao_vigente']);
    assert.equal(await fotoAbastecimento(s.c), antes);
  });

  test('AB5 (parcial): fator trocado depois da prévia → 409 CONVERSAO_ALTERADA; vigente divergente no A14 → 409', async () => {
    const s = await montarAbastecimento(app);
    const f2 = await A.ok(s.configurarFator(s.e1, s.comb.DIESEL_S10, s.diesel, '0.850000', s.fator.diesel.id, s.contaFator.token), 201);
    assert.equal(f2.sequencia, 2);
    assert.equal(f2.kg_por_litro, '0.850000');
    const antes = await fotoAbastecimento(s.c);
    const rc = await A.confirmar(s.operador.token, corpoAbastecimento(s));
    const [st, code, field, reason] = erro(rc);
    assert.deepEqual([st, code, field, reason], [409, 'ABASTECIMENTO_CONVERSAO_ALTERADA', 'conversao_id', 'conversao_alterada']);
    assert.equal(rc.json().details.conversao_vigente_id, f2.id);
    assert.equal(await fotoAbastecimento(s.c), antes);
    const rv = await s.configurarFator(s.e1, s.comb.DIESEL_S10, s.diesel, '0.860000', s.fator.diesel.id, s.contaFator.token);
    assert.deepEqual(erro(rv), [409, 'ABASTECIMENTO_CONVERSAO_ALTERADA', 'conversao_vigente_id', 'vigente_divergente']);
    const ok = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { conversao_id: f2.id, conversao_versao: f2.versao }));
    assert.equal(ok.kg_por_litro, '0.850000');
    assert.equal(ok.quantidade_kg, '68.0000');
  });

  test('AB7: produto com estoque em "L" → 422 UNIDADE_INCOMPATIVEL (abastecimento e fator)', async () => {
    const s = await montarAbastecimento(app);
    const antes = await fotoAbastecimento(s.c);
    const corpo = corpoAbastecimento(s, {
      bem_id: s.gerador.id, tanque_id: s.gerador.tanques[0].id, tipo_combustivel_id: s.comb.DIESEL_S500, produto_id: s.oleoLitro.id,
      medidor_leitura: null, quantidade_litros: '10', conversao_id: 'qualquer', conversao_versao: 1,
    });
    const rp = await A.ok(A.previa(s.operador.token, corpoPrevia(s, { ...corpo, operation_id: undefined })));
    assert.equal(rp.bloqueios[0].code, 'ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL');
    assert.equal(rp.bloqueios[0].details.unidade, 'L');
    const rc = await A.confirmar(s.operador.token, corpo);
    assert.deepEqual(erro(rc), [422, 'ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL', 'produto_id', 'unidade_estoque_nao_kg']);
    const rf = await s.configurarFator(s.e1, s.comb.DIESEL_S500, s.oleoLitro, '0.900000', null, s.contaFator.token);
    assert.deepEqual(erro(rf), [422, 'ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL', 'produto_id', 'unidade_estoque_nao_kg']);
    assert.equal(await fotoAbastecimento(s.c), antes);
  });

  test('AB8: litros acima da capacidade nominal do tanque → 422; a capacidade exata não é recusada por capacidade', async () => {
    const s = await montarAbastecimento(app);
    const antes = await fotoAbastecimento(s.c);
    const rc = await A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '180.0001' }));
    assert.deepEqual(erro(rc), [422, 'ABASTECIMENTO_EXCEDE_CAPACIDADE', 'quantidade_litros', 'excede_capacidade_tanque']);
    assert.equal(rc.json().details.capacidade_litros, '180.0000');
    assert.equal(await fotoAbastecimento(s.c), antes);
    const rp = await A.ok(A.previa(s.operador.token, corpoPrevia(s, { quantidade_litros: '180' })));
    assert.equal(rp.bloqueios.some((b) => b.code === 'ABASTECIMENTO_EXCEDE_CAPACIDADE'), false);
    // 180 L × 0,84 = 151,2 kg > 150 kg nos lotes: o saldo (não a capacidade) recusa.
    assert.deepEqual(rp.bloqueios.map((b) => [b.code, b.reason]), [['ESTOQUE_SALDO_INSUFICIENTE', 'saldo_lote_insuficiente']]);
  });

  test('AB9/M4 (parcial): leitura obrigatória, regressiva ao cadastro e a abastecimento anterior; data futura', async () => {
    const s = await montarAbastecimento(app);
    const antes = await fotoAbastecimento(s.c);
    const semLeitura = await A.confirmar(s.operador.token, corpoAbastecimento(s, { medidor_leitura: null }));
    assert.deepEqual(erro(semLeitura), [422, 'MEDIDOR_LEITURA_INVALIDA', 'medidor_leitura', 'obrigatoria']);
    const regCadastro = await A.confirmar(s.operador.token, corpoAbastecimento(s, { medidor_leitura: '1500' }));
    assert.deepEqual(erro(regCadastro), [422, 'MEDIDOR_LEITURA_REGRESSIVA', 'medidor_leitura', 'leitura_regressiva']);
    assert.equal(regCadastro.json().details.origem_referencia, 'CADASTRO');
    assert.equal(regCadastro.json().details.leitura_referencia, '1520.5000');
    const futura = await A.confirmar(s.operador.token, corpoAbastecimento(s, { data_operacional: '2027-06-16' }));
    assert.deepEqual(erro(futura), [422, 'ABASTECIMENTO_DATA_FUTURA', 'data_operacional', 'data_futura']);
    assert.equal(await fotoAbastecimento(s.c), antes);

    const primeiro = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '20', medidor_leitura: '1550.5' }));
    const antes2 = await fotoAbastecimento(s.c);
    const regAbast = await A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '20', data_operacional: '2027-06-12', medidor_leitura: '1540' }));
    assert.deepEqual(erro(regAbast), [422, 'MEDIDOR_LEITURA_REGRESSIVA', 'medidor_leitura', 'leitura_regressiva']);
    assert.equal(regAbast.json().details.origem_referencia, 'ABASTECIMENTO');
    assert.equal(regAbast.json().details.abastecimento_id, primeiro.id);
    const acima = await A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '20', data_operacional: '2027-06-05', medidor_leitura: '1560' }));
    assert.deepEqual(erro(acima), [422, 'MEDIDOR_LEITURA_ACIMA_POSTERIOR', 'medidor_leitura', 'leitura_acima_posterior']);
    assert.equal(await fotoAbastecimento(s.c), antes2);
    // retroativo coerente (entre o cadastro e o abastecimento de 06-10) é aceito
    await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '20', data_operacional: '2027-06-05', medidor_leitura: '1530' }));
    // X2: PATCH do bem com ajuste abaixo do piso operacional → 422
    const bem = await A.ok(A.req('GET', `/bens-patrimoniais/${s.trator.id}?empresa_id=${s.e1.id}`, s.token));
    const patch = await A.req('PATCH', `/bens-patrimoniais/${s.trator.id}`, s.token, {
      empresa_id: s.e1.id, versao: bem.versao, medidor: { tipo: 'HORIMETRO', leitura_atual: '1540', data_leitura: '2027-06-14' },
    });
    assert.deepEqual(erro(patch), [422, 'MEDIDOR_LEITURA_REGRESSIVA', 'medidor.leitura_atual', 'leitura_regressiva']);
    assert.equal(patch.json().details.origem_referencia, 'ABASTECIMENTO');
  });

  test('S4 (parcial): decimal como número e campo extra → 400; nada gravado', async () => {
    const s = await montarAbastecimento(app);
    const antes = await fotoAbastecimento(s.c);
    const numero = await A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: 80 }));
    assert.deepEqual(erro(numero), [400, 'REQUEST_VALIDATION_FAILED', 'quantidade_litros', 'valor_deve_ser_texto']);
    const fatorNumero = await A.req('POST', '/patrimonio-conversoes-combustivel', s.contaFator.token, {
      empresa_id: s.e1.id, tipo_combustivel_id: s.comb.GASOLINA, produto_id: s.gasolina.id, kg_por_litro: 0.75, declara_estoque_em_kg: true, conversao_vigente_id: s.fator.gasolina.id,
    });
    assert.deepEqual(erro(fatorNumero), [400, 'REQUEST_VALIDATION_FAILED', 'kg_por_litro', 'valor_deve_ser_texto']);
    const extra = await A.confirmar(s.operador.token, { ...corpoAbastecimento(s), cliente_id: s.c });
    assert.equal(erro(extra)[0], 400);
    assert.equal(await fotoAbastecimento(s.c), antes);
  });
});

describe('P1-02 — X1: lote consumido por abastecimento', () => {
  test('AB14: PATCH restrito e DELETE do lote com fatia de abastecimento → 409 REGISTRO_OPERACIONAL_IMUTAVEL; o nome do local segue livre', async () => {
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

describe('P1-02 — permissões e isolamento', () => {
  test('S2 (parcial): sem a linha da tela tudo 403; só visualizar lê mas não confirma; sem configurar_conversao não cria fator', async () => {
    const s = await montarAbastecimento(app);
    const antes = await fotoAbastecimento(s.c);
    const semLinha = await s.conta({ modulos_permitidos: ['patrimonio'], permissoes_telas: [{ ...linhaAbastecimento({}), tela_id: 'pat-bens-patrimoniais', visualizar: true, novo: true }] });
    for (const r of [
      await A.lista(semLinha.token, s.e1.id),
      await A.previa(semLinha.token, corpoPrevia(s)),
      await A.confirmar(semLinha.token, corpoAbastecimento(s)),
      await A.req('GET', `/patrimonio-abastecimentos-opcoes/bens?empresa_id=${s.e1.id}`, semLinha.token),
      await A.req('GET', `/patrimonio-conversoes-combustivel?empresa_id=${s.e1.id}`, semLinha.token),
    ]) {
      assert.deepEqual(erro(r).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA'], r.body);
    }
    assert.equal((await A.lista(s.leitor.token, s.e1.id)).statusCode, 200);
    assert.equal((await A.req('GET', `/patrimonio-abastecimentos-opcoes/bens?empresa_id=${s.e1.id}`, s.leitor.token)).statusCode, 200);
    assert.deepEqual(erro(await A.previa(s.leitor.token, corpoPrevia(s))).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    assert.deepEqual(erro(await A.confirmar(s.leitor.token, corpoAbastecimento(s))).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    assert.deepEqual(erro(await A.req('GET', `/patrimonio-abastecimentos-opcoes/locais?empresa_id=${s.e1.id}&produto_id=${s.diesel.id}`, s.leitor.token)).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    const fatorSemAcao = await s.configurarFator(s.e1, s.comb.GASOLINA, s.gasolina, '0.750000', s.fator.gasolina.id, s.operador.token);
    assert.deepEqual(erro(fatorSemAcao).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    assert.equal(await fotoAbastecimento(s.c), antes);
    // o administrador real passa
    assert.equal((await A.previa(s.token, corpoPrevia(s))).statusCode, 200);
  });

  test('S3 (parcial): outro tenant → 404 (abastecimento, bem, empresa); nada gravado nos dois', async () => {
    const s = await montarAbastecimento(app);
    const outro = await montarAbastecimento(app);
    const d = await A.confirmarOk(s.operador.token, corpoAbastecimento(s));
    const antes = await fotoAbastecimento([s.c, outro.c]);
    assert.deepEqual(erro(await A.detalhe(outro.operador.token, d.id, outro.e1.id)).slice(0, 2), [404, 'ABASTECIMENTO_NAO_ENCONTRADO']);
    assert.deepEqual(erro(await A.detalhe(outro.operador.token, d.id, s.e1.id)).slice(0, 2), [404, 'EMPRESA_NOT_FOUND']);
    const cancelar = await A.cancelar(outro.contaCancelar.token, d.id, { empresa_id: outro.e1.id, versao: 1, motivo: 'tentativa cruzada', operation_id: opId() });
    assert.deepEqual(erro(cancelar).slice(0, 2), [404, 'ABASTECIMENTO_NAO_ENCONTRADO']);
    const prev = await A.previa(outro.operador.token, corpoPrevia(outro, { bem_id: s.trator.id }));
    assert.deepEqual(erro(prev), [404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO', 'bem_id', 'bem_inexistente']);
    const conf = await A.confirmar(outro.operador.token, corpoAbastecimento(outro, { produto_id: s.diesel.id }));
    assert.deepEqual(erro(conf), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'inexistente']);
    assert.equal((await A.ok(A.lista(outro.operador.token, outro.e1.id))).total, 0);
    assert.equal(await fotoAbastecimento([s.c, outro.c]), antes);
  });
});
