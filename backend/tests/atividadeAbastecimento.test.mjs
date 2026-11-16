/**
 * D-PROD-210 (Fatia 5 do Lançamento de Atividades) — abastecimento ligado à
 * atividade, contra PostgreSQL real e HTTP autenticado (`app.inject`).
 * Contrato: docs/engineering/MAIKE-ATIVIDADE-ABASTECIMENTO-CONTRATO.md §2.
 *
 * Cobre: origem EXTERNO (posto de estrada) confirmada e cancelada SEM nenhum
 * efeito de estoque (nem movimento, nem fatia, nem lote, nem `estoque_atual`);
 * as recusas do corpo por origem (`local_estoque_id` no EXTERNO, `custo_total`
 * obrigatório, > 0 e com 2 casas, `custo_total` no ESTOQUE, `atividade_id` do
 * cliente); o vínculo com o apontamento (atividade derivada; apontamento
 * cancelado, atividade concluída ou cancelada recusados; outra fazenda e outro
 * tenant 404); o centro de custo snapshot (da atividade, senão do bem); o
 * snapshot do medidor (primeira leitura, depois do cadastro → não confiável,
 * depois de abastecimento e de linha de máquina → confiável), também na
 * prévia; a cascata do cancelamento do apontamento e da atividade (estorno no
 * ESTOQUE, só o status no EXTERNO; motivo derivado; auditoria por
 * abastecimento); a edição do apontamento não mexe nos abastecimentos; os
 * totais com combustível e o consumo por bem (L/h, km/L, unidades misturadas
 * → nulo); replay idempotente; filtros da lista; e a corrida entre confirmar
 * ligado e cancelar o apontamento (sem deadlock, sem abastecimento órfão).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { erro, montarLinhasCusto, opId, prisma } from './atividadeLinhaCustoCenario.mjs';
import { acoesAbastecimento, corpoAbastecimento, fotoAbastecimento } from './patrimonioP1AbastecimentoCenario.mjs';

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

/** Corpo EXTERNO: o do trator sem local de estoque, com o valor da nota. */
const corpoExterno = (s, extra = {}) => {
  const c = /** @type {Record<string, unknown>} */ (corpoAbastecimento(s, { origem: 'EXTERNO', custo_total: '480.50', referencia_externa: 'NF 1234', ...extra }));
  if (!Object.prototype.hasOwnProperty.call(extra, 'local_estoque_id')) delete c.local_estoque_id;
  return c;
};
const semOperacao = (c) => {
  const x = { ...c };
  delete x.operation_id;
  return x;
};

/** Estado do estoque do tenant: movimentos, fatias, lotes e `estoque_atual` dos produtos. */
const estoque = async (c) => {
  const p = prisma();
  return JSON.stringify({
    mov: await p.movimentacaoEstoque.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    fatias: await p.abastecimentoBemConsumoLote.count({ where: { cliente_id: c } }),
    lotes: await p.estoqueLoteNota.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' }, select: { id: true, quantidade_disponivel: true, status: true } }),
    produtos: await p.produto.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' }, select: { id: true, estoque_atual: true } }),
  }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
};
const estoqueAtual = async (produtoId) => (await prisma().produto.findUnique({ where: { id: produtoId } })).estoque_atual.toFixed(4);
const cancelarCorpo = (s, versao = 1, extra = {}) => ({ empresa_id: s.e1.id, versao, motivo: 'lançado errado', operation_id: opId('canc'), ...extra });

// ─────────────────────────────────────────────────────────────────────────────
describe('origem EXTERNO (posto de estrada)', () => {
  test('confirmar: sem movimento, sem fatia, estoque intocado; custo da nota e custo unitário de 4 casas; replay; cancelar só muda o status', async () => {
    const s = await montarLinhasCusto(app);
    const antes = await estoque(s.c);
    const corpo = corpoExterno(s);
    const r = await A.confirmar(s.token, corpo);
    assert.equal(r.statusCode, 201, r.body);
    const d = r.json();
    assert.deepEqual(
      [d.origem, d.local_estoque, d.movimentacao, d.estorno, d.fatias, d.quantidade, d.custo_total, d.custo_unitario, d.referencia_externa, d.status],
      ['EXTERNO', null, null, null, [], '80.0000', '480.5000', '6.0063', 'NF 1234', 'CONFIRMADO'],
      '480,50 ÷ 80 = 6,00625 → 6,0063'
    );
    assert.equal(await estoque(s.c), antes, 'nenhum efeito de estoque');
    const linha = await prisma().abastecimentoBem.findUnique({ where: { id: d.id } });
    assert.deepEqual([linha.origem, linha.local_estoque_id, linha.movimentacao_estoque_id], ['EXTERNO', null, null]);
    // replay: mesmo corpo → 200 replay; corpo diferente com a mesma chave → 409
    const rep = await A.confirmar(s.token, corpo);
    assert.deepEqual([rep.statusCode, rep.json().replay, rep.json().id], [200, true, d.id]);
    assert.equal((await A.confirmar(s.token, { ...corpo, custo_total: '480.51' })).statusCode, 409);
    // a leitura do EXTERNO entra na série do medidor: leitura menor no dia seguinte é regressiva
    const regressiva = await A.confirmar(s.token, corpoExterno(s, { data_operacional: '2027-06-11', medidor_leitura: '1540', operation_id: opId() }));
    assert.deepEqual(erro(regressiva).slice(0, 2), [422, 'MEDIDOR_LEITURA_REGRESSIVA']);
    // cancelar: só o status
    const k = await A.cancelar(s.token, d.id, cancelarCorpo(s));
    assert.equal(k.statusCode, 200, k.body);
    assert.deepEqual([k.json().status, k.json().estorno, k.json().cancelamento.motivo], ['CANCELADO', null, 'lançado errado']);
    assert.equal(await estoque(s.c), antes, 'cancelar o EXTERNO não estorna nada');
    const au = await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'AbastecimentoBem', entidade_id: d.id }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(au.map((a) => a.acao), ['abastecimento_bem.confirmar', 'abastecimento_bem.cancelar']);
    assert.deepEqual([au[0].dados_novos.origem, au[0].dados_novos.movimentacao_estoque_id, au[1].dados_novos.movimentacao_estorno_id], ['EXTERNO', null, null]);
  });

  test('recusas do corpo (nada gravado): local no EXTERNO, custo ausente/zero/3 casas, custo no ESTOQUE, ESTOQUE sem local, atividade_id do cliente, origem inválida', async () => {
    const s = await montarLinhasCusto(app);
    const foto = await fotoAbastecimento(s.c);
    const casos = [
      [corpoExterno(s, { local_estoque_id: s.local.id }), 'local_estoque_id', 'nao_se_aplica_externo'],
      [corpoExterno(s, { custo_total: null }), 'custo_total', 'obrigatorio'],
      [corpoExterno(s, { custo_total: '0.00' }), 'custo_total', 'nao_positivo'],
      [corpoAbastecimento(s, { custo_total: '10.00' }), 'custo_total', 'nao_se_aplica_estoque'],
      [(() => { const c = corpoAbastecimento(s); delete c.local_estoque_id; return c; })(), 'local_estoque_id', 'obrigatorio'],
    ];
    for (const [corpo, field, reason] of casos) {
      assert.deepEqual(erro(await A.confirmar(s.token, corpo)), [400, 'REQUEST_VALIDATION_FAILED', field, reason], JSON.stringify(corpo));
    }
    for (const corpo of [
      corpoExterno(s, { custo_total: '10.123' }),
      corpoExterno(s, { custo_total: 10 }),
      corpoAbastecimento(s, { atividade_id: s.atividade.id }),
      corpoAbastecimento(s, { origem: 'POSTO' }),
    ]) {
      assert.deepEqual(erro(await A.confirmar(s.token, corpo)).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], JSON.stringify(corpo));
    }
    assert.equal(await fotoAbastecimento(s.c), foto);
  });

  test('prévia do EXTERNO: sem FIFO nem estoque; sem custo ainda → custo nulo; com custo → custo unitário', async () => {
    const s = await montarLinhasCusto(app);
    const sem = await A.ok(A.previa(s.token, semOperacao(corpoExterno(s, { custo_total: null }))));
    assert.deepEqual(sem.bloqueios, []);
    assert.deepEqual([sem.plano.origem, sem.plano.local_estoque, sem.plano.fifo, sem.plano.estoque, sem.plano.custo_total, sem.plano.custo_e_estimativa], ['EXTERNO', null, null, null, null, false]);
    const com = await A.ok(A.previa(s.token, semOperacao(corpoExterno(s))));
    assert.deepEqual([com.plano.custo_total, com.plano.custo_unitario], ['480.5000', '6.0063']);
    // o ESTOQUE segue com a estimativa do FIFO: 50 × 5,20 + 30 × 5,50 = 425
    const est = await A.ok(A.previa(s.token, semOperacao(corpoAbastecimento(s))));
    assert.deepEqual([est.plano.origem, est.plano.custo_total, est.plano.custo_e_estimativa], ['ESTOQUE', '425.0000', true]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('snapshot do medidor (leitura anterior, delta e intervalo confiável)', () => {
  test('depois do cadastro → não confiável; depois de abastecimento → confiável; depois de linha de máquina → confiável; prévia igual à confirmação', async () => {
    const s = await montarLinhasCusto(app);
    // 1) o anterior é o CADASTRO do trator (1520,5 h em 2027-06-01)
    const p1 = await A.ok(A.previa(s.token, semOperacao(corpoAbastecimento(s, { quantidade: '10' }))));
    assert.deepEqual([p1.plano.medidor_leitura_anterior, p1.plano.medidor_delta, p1.plano.intervalo_confiavel], ['1520.5000', '30.0000', false]);
    const a1 = await A.confirmarOk(s.token, corpoAbastecimento(s, { quantidade: '10' }));
    assert.deepEqual([a1.medidor_leitura_anterior, a1.medidor_delta, a1.intervalo_confiavel], ['1520.5000', '30.0000', false]);
    // 2) depois de um abastecimento
    const c2 = corpoAbastecimento(s, { quantidade: '10', data_operacional: '2027-06-11', medidor_leitura: '1560' });
    const p2 = await A.ok(A.previa(s.token, semOperacao(c2)));
    assert.deepEqual([p2.plano.medidor_leitura_anterior, p2.plano.medidor_delta, p2.plano.intervalo_confiavel], ['1550.5000', '9.5000', true]);
    const a2 = await A.confirmarOk(s.token, c2);
    assert.deepEqual([a2.medidor_leitura_anterior, a2.medidor_delta, a2.intervalo_confiavel], ['1550.5000', '9.5000', true]);
    // mesma leitura (delta 0): gravado, mas não confiável
    const a3 = await A.confirmarOk(s.token, corpoAbastecimento(s, { quantidade: '5', data_operacional: '2027-06-11', medidor_leitura: '1560', tanque_cheio: false }));
    assert.deepEqual([a3.medidor_leitura_anterior, a3.medidor_delta, a3.intervalo_confiavel], ['1560.0000', '0.0000', false]);
    // 3) depois de uma linha de máquina (leitura final 1570 em 2027-06-12)
    await s.apontar({ data_operacional: '2027-06-12', operation_id: opId(), maquinas: [{ bem_id: s.trator.id, sem_medidor: false, leitura_inicial: '1560', leitura_final: '1570' }] });
    const a4 = await A.confirmarOk(s.token, corpoExterno(s, { data_operacional: '2027-06-12', medidor_leitura: '1571', quantidade: '20', custo_total: '120' }));
    assert.deepEqual([a4.medidor_leitura_anterior, a4.medidor_delta, a4.intervalo_confiavel], ['1570.0000', '1.0000', true]);
    // detalhe e lista trazem os mesmos três
    const det = await A.ok(A.detalhe(s.token, a2.id, s.e1.id));
    assert.deepEqual([det.medidor_leitura_anterior, det.medidor_delta, det.intervalo_confiavel], ['1550.5000', '9.5000', true]);
    const item = (await A.ok(A.lista(s.token, s.e1.id))).items.find((i) => i.id === a4.id);
    assert.deepEqual([item.origem, item.medidor_leitura_anterior, item.medidor_delta, item.intervalo_confiavel, item.local_estoque], ['EXTERNO', '1570.0000', '1.0000', true, null]);
  });

  test('primeira leitura (nenhum ponto anterior: o cadastro é de data posterior) e bem sem medidor: os três vazios', async () => {
    const s = await montarLinhasCusto(app);
    // o cadastro do trator é de 2027-06-01: em 2027-05-31 não há ponto anterior (o cadastro é o posterior)
    const primeira = corpoAbastecimento(s, { quantidade: '10', data_operacional: '2027-05-31', medidor_leitura: '1500' });
    const p = await A.ok(A.previa(s.token, semOperacao(primeira)));
    assert.deepEqual([p.plano.medidor.anterior, p.plano.medidor_leitura_anterior, p.plano.medidor_delta, p.plano.intervalo_confiavel], [null, null, null, false]);
    const a = await A.confirmarOk(s.token, primeira);
    assert.deepEqual([a.medidor_leitura_anterior, a.medidor_delta, a.intervalo_confiavel], [null, null, false]);
    const g = await A.confirmarOk(s.token, corpoAbastecimento(s, {
      bem_id: s.gerador.id, tanque_id: s.gerador.tanques[0].id, quantidade: '10', medidor_leitura: null, tanque_cheio: false,
    }));
    assert.deepEqual([g.medidor.tipo, g.medidor_leitura_anterior, g.medidor_delta, g.intervalo_confiavel], ['SEM_MEDIDOR', null, null, false]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('vínculo com o lançamento (apontamento) e centro de custo', () => {
  test('atividade derivada do apontamento; centro de custo da atividade, senão o do bem; filtros da lista', async () => {
    const s = await montarLinhasCusto(app);
    const p = prisma();
    const ccAtividade = await p.centroCusto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero: 'CC-AT', nome: 'Lavoura' } });
    await p.bemPatrimonial.update({ where: { id: s.trator.id }, data: { centro_custo_id: s.centro1.id } });
    await p.atividade.update({ where: { id: s.atividade.id }, data: { centro_custo_id: ccAtividade.id } });
    const ap = await s.apontar({ turno: 'MANHA' });
    // prévia já traz o vínculo e o centro
    const pv = await A.ok(A.previa(s.token, semOperacao(corpoAbastecimento(s, { apontamento_id: ap.id }))));
    assert.deepEqual([pv.plano.atividade?.id, pv.plano.apontamento?.id, pv.plano.centro_custo], [s.atividade.id, ap.id, { id: ccAtividade.id, nome: 'Lavoura' }]);
    const ligado = await A.confirmarOk(s.token, corpoAbastecimento(s, { apontamento_id: ap.id }));
    assert.deepEqual(ligado.atividade, { id: s.atividade.id, numero: s.atividade.numero, nome: s.atividade.nome });
    assert.deepEqual(ligado.apontamento, { id: ap.id, data_operacional: '2027-06-10', turno: 'MANHA', sequencia: ap.sequencia });
    assert.deepEqual(ligado.centro_custo, { id: ccAtividade.id, nome: 'Lavoura' }, 'o da atividade');
    const linha = await p.abastecimentoBem.findUnique({ where: { id: ligado.id } });
    assert.deepEqual([linha.atividade_id, linha.apontamento_id, linha.centro_custo_id], [s.atividade.id, ap.id, ccAtividade.id]);
    // sem apontamento: o do bem; snapshot — trocar o centro do bem depois não muda o gravado
    const solto = await A.confirmarOk(s.token, corpoAbastecimento(s, { quantidade: '10', data_operacional: '2027-06-11', medidor_leitura: '1560' }));
    assert.deepEqual([solto.atividade, solto.apontamento, solto.centro_custo], [null, null, { id: s.centro1.id, nome: 'Máquinas e frota' }]);
    // atividade sem centro, com apontamento: cai no do bem
    const b = await s.abrir();
    await p.atividade.update({ where: { id: b.id }, data: { centro_custo_id: null } });
    const apB = await s.apontar({ data_operacional: '2027-06-12' }, { a: b });
    const deB = await A.confirmarOk(s.token, corpoExterno(s, { apontamento_id: apB.id, data_operacional: '2027-06-12', medidor_leitura: '1570' }));
    assert.deepEqual([deB.atividade.id, deB.centro_custo?.id], [b.id, s.centro1.id]);
    await p.bemPatrimonial.update({ where: { id: s.trator.id }, data: { centro_custo_id: null } });
    assert.equal((await A.ok(A.detalhe(s.token, solto.id, s.e1.id))).centro_custo.id, s.centro1.id, 'snapshot: nunca relido do bem');
    // filtros novos da lista
    const ids = async (q) => (await A.ok(A.lista(s.token, s.e1.id, q))).items.map((i) => i.id).sort();
    assert.deepEqual(await ids(`&apontamento_id=${ap.id}`), [ligado.id]);
    assert.deepEqual(await ids(`&atividade_id=${b.id}`), [deB.id]);
    assert.deepEqual(await ids('&origem=EXTERNO'), [deB.id]);
    const item = (await A.ok(A.lista(s.token, s.e1.id, `&apontamento_id=${ap.id}`))).items[0];
    assert.deepEqual([item.atividade.id, item.apontamento.id, item.centro_custo.id], [s.atividade.id, ap.id, ccAtividade.id]);
  });

  test('recusas: apontamento cancelado, atividade concluída e cancelada (mesmo erro do lançamento novo), outra fazenda e outro tenant (404); nada gravado', async () => {
    const s = await montarLinhasCusto(app);
    const ap = await s.apontar();
    const apCancelado = await s.apontar({ data_operacional: '2027-06-11' });
    await s.H.ok(s.H.req('POST', `${s.baseAp(s.atividade)}/${apCancelado.id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: apCancelado.versao, motivo: 'dia errado' }));
    const r1 = await A.confirmar(s.token, corpoAbastecimento(s, { apontamento_id: apCancelado.id }));
    assert.deepEqual([...erro(r1).slice(0, 2), r1.json().details?.entidade ?? r1.json().entidade], [409, 'ATIVIDADE_STATUS_INVALIDO', 'apontamento']);
    // a prévia recusa igual
    assert.deepEqual(erro(await A.previa(s.token, semOperacao(corpoAbastecimento(s, { apontamento_id: apCancelado.id })))).slice(0, 2), [409, 'ATIVIDADE_STATUS_INVALIDO']);
    // atividade concluída
    const atual = await s.H.ok(s.H.req('GET', `/atividades/${s.atividade.id}?empresa_id=${s.e1.id}`, s.token));
    await s.H.ok(s.H.req('POST', `/atividades/${s.atividade.id}/concluir`, s.token, { empresa_id: s.e1.id, versao: atual.versao, data_conclusao: '2027-06-14' }));
    const r2 = await A.confirmar(s.token, corpoAbastecimento(s, { apontamento_id: ap.id }));
    const lancarNovo = await s.lancarAp({ data_operacional: '2027-06-12' });
    assert.deepEqual(erro(r2).slice(0, 2), [409, 'ATIVIDADE_STATUS_INVALIDO']);
    assert.deepEqual([r2.json().details?.status ?? r2.json().status, erro(lancarNovo)[1]], ['CONCLUIDA', 'ATIVIDADE_STATUS_INVALIDO'], 'o mesmo erro do lançamento novo');
    // atividade cancelada
    const b = await s.abrir();
    const apB = await s.apontar({}, { a: b });
    await s.H.ok(s.H.req('POST', `/atividades/${b.id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: b.versao, motivo: 'aberta por engano' }));
    assert.deepEqual(erro(await A.confirmar(s.token, corpoAbastecimento(s, { apontamento_id: apB.id }))).slice(0, 2), [409, 'ATIVIDADE_STATUS_INVALIDO']);
    // outra fazenda (o apontamento é da F2, o abastecimento da F1) e outro tenant: 404 sem oráculo
    const deF2 = await s.abrir({ empresa_id: s.e2.id });
    const apF2 = await s.apontar({}, { a: deF2 });
    assert.deepEqual(erro(await A.confirmar(s.token, corpoAbastecimento(s, { apontamento_id: apF2.id }))), [404, 'ATIVIDADE_APONTAMENTO_NOT_FOUND', 'apontamento_id', 'inexistente']);
    const outro = await montarLinhasCusto(app);
    const apOutro = await outro.apontar();
    assert.deepEqual(erro(await A.confirmar(s.token, corpoAbastecimento(s, { apontamento_id: apOutro.id }))), [404, 'ATIVIDADE_APONTAMENTO_NOT_FOUND', 'apontamento_id', 'inexistente']);
    assert.equal(await prisma().abastecimentoBem.count({ where: { cliente_id: s.c } }), 0, 'nada gravado');
  });

  test('cancelar o abastecimento ligado: recusado com a atividade CONCLUIDA (nada alterado), permitido depois de reabrir; o solto não depende da atividade', async () => {
    const s = await montarLinhasCusto(app);
    const estoqueInicial = await estoqueAtual(s.diesel.id);
    const ap = await s.apontar();
    const ligado = await A.confirmarOk(s.token, corpoAbastecimento(s, { apontamento_id: ap.id }));
    const externo = await A.confirmarOk(s.token, corpoExterno(s, { apontamento_id: ap.id, medidor_leitura: '1551', quantidade: '10', custo_total: '50' }));
    const solto = await A.confirmarOk(s.token, corpoAbastecimento(s, { quantidade: '10', data_operacional: '2027-06-11', medidor_leitura: '1560' }));
    const v1 = (await s.H.ok(s.H.req('GET', `/atividades/${s.atividade.id}?empresa_id=${s.e1.id}`, s.token))).versao;
    await s.H.ok(s.H.req('POST', `/atividades/${s.atividade.id}/concluir`, s.token, { empresa_id: s.e1.id, versao: v1, data_conclusao: '2027-06-14' }));
    const foto = await fotoAbastecimento(s.c);
    for (const a of [ligado, externo]) {
      const r = await A.cancelar(s.token, a.id, cancelarCorpo(s));
      assert.deepEqual(erro(r).slice(0, 2), [409, 'ATIVIDADE_STATUS_INVALIDO'], r.body);
      const corpo = r.json();
      assert.deepEqual([corpo.details?.status ?? corpo.status, corpo.details?.acao ?? corpo.acao], ['CONCLUIDA', 'cancelar_abastecimento']);
      assert.match(corpo.message, /reaberta antes/);
    }
    assert.equal(await fotoAbastecimento(s.c), foto, 'nada alterado (nem estorno, nem recibo)');
    assert.equal(await estoqueAtual(s.diesel.id), (Number(estoqueInicial) - 90).toFixed(4));
    // o solto (sem atividade) cancela com a atividade concluída
    assert.equal((await A.cancelar(s.token, solto.id, cancelarCorpo(s))).statusCode, 200);
    // reabrir → cancelar os ligados passa (ESTOQUE estornado, EXTERNO só o status)
    const v2 = (await s.H.ok(s.H.req('GET', `/atividades/${s.atividade.id}?empresa_id=${s.e1.id}`, s.token))).versao;
    await s.H.ok(s.H.req('POST', `/atividades/${s.atividade.id}/reabrir`, s.token, { empresa_id: s.e1.id, versao: v2, motivo: 'faltou cancelar o diesel' }));
    const k1 = await A.ok(A.cancelar(s.token, ligado.id, cancelarCorpo(s)));
    const k2 = await A.ok(A.cancelar(s.token, externo.id, cancelarCorpo(s)));
    assert.deepEqual([k1.status, Boolean(k1.estorno), k2.status, k2.estorno], ['CANCELADO', true, 'CANCELADO', null]);
    assert.equal(await estoqueAtual(s.diesel.id), estoqueInicial, 'estoque de volta');
  });

  test('editar o apontamento (data e área) não mexe nos abastecimentos ligados', async () => {
    const s = await montarLinhasCusto(app);
    const ap = await s.apontar({ area_executada_dia: '5' });
    const ab = await A.confirmarOk(s.token, corpoAbastecimento(s, { apontamento_id: ap.id }));
    const antes = await prisma().abastecimentoBem.findUnique({ where: { id: ab.id } });
    const ed = await s.H.ok(s.H.req('PATCH', `${s.baseAp(s.atividade)}/${ap.id}`, s.token, { empresa_id: s.e1.id, versao: ap.versao, data_operacional: '2027-06-09', area_executada_dia: '6' }));
    assert.equal(ed.apontamento.data_operacional, '2027-06-09');
    assert.deepEqual(await prisma().abastecimentoBem.findUnique({ where: { id: ab.id } }), antes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('cascata: cancelar o apontamento ou a atividade', () => {
  test('cancelar o apontamento cancela os abastecimentos ligados (ESTOQUE estornado, EXTERNO só status), com motivo derivado e auditoria; os outros ficam', async () => {
    const s = await montarLinhasCusto(app);
    const estoqueInicial = await estoqueAtual(s.diesel.id);
    const ap = await s.apontar({ turno: 'TARDE' });
    const est = await A.confirmarOk(s.token, corpoAbastecimento(s, { apontamento_id: ap.id }));
    const ext = await A.confirmarOk(s.token, corpoExterno(s, { apontamento_id: ap.id, medidor_leitura: '1551', quantidade: '20', custo_total: '100' }));
    const solto = await A.confirmarOk(s.token, corpoAbastecimento(s, { quantidade: '10', data_operacional: '2027-06-11', medidor_leitura: '1560' }));
    assert.equal(await estoqueAtual(s.diesel.id), (Number(estoqueInicial) - 90).toFixed(4));
    const r = await s.H.ok(s.H.req('POST', `${s.baseAp(s.atividade)}/${ap.id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: ap.versao, motivo: 'dia errado' }));
    assert.equal(r.apontamento.status, 'CANCELADO');
    const p = prisma();
    const [e1, e2, e3] = await Promise.all([est, ext, solto].map((a) => p.abastecimentoBem.findUnique({ where: { id: a.id } })));
    assert.deepEqual([e1.status, e2.status, e3.status], ['CANCELADO', 'CANCELADO', 'CONFIRMADO']);
    assert.ok(e1.movimentacao_estorno_id, 'o ESTOQUE é estornado pelo motor');
    assert.equal(e2.movimentacao_estorno_id, null, 'o EXTERNO não tem estorno');
    assert.equal(await estoqueAtual(s.diesel.id), (Number(estoqueInicial) - 10).toFixed(4), 'só o solto continua baixado');
    const esperado = `cancelado com o lançamento de 10/06/2027 tarde nº ${ap.sequencia} da atividade ${s.atividade.numero}: dia errado`;
    assert.deepEqual([e1.motivo_cancelamento, e2.motivo_cancelamento], [esperado, esperado]);
    const au = await p.auditLog.findMany({ where: { cliente_id: s.c, acao: 'abastecimento_bem.cancelar' }, orderBy: { entidade_id: 'asc' } });
    assert.deepEqual(au.map((a) => a.entidade_id).sort(), [est.id, ext.id].sort());
    assert.ok(au.every((a) => a.dados_novos.cascata.origem === 'APONTAMENTO' && a.dados_novos.cascata.apontamento_id === ap.id));
    const auAp = await p.auditLog.findFirst({ where: { cliente_id: s.c, acao: 'atividade_apontamento.cancelar', entidade_id: ap.id } });
    assert.equal(auAp.dados_novos.linhas_canceladas.abastecimentos, 2);
    // cancelar de novo o abastecimento já cancelado pela cascata → 409
    assert.deepEqual(erro(await A.cancelar(s.token, est.id, cancelarCorpo(s, e1.versao))).slice(0, 2), [409, 'ABASTECIMENTO_STATUS_INVALIDO']);
  });

  test('cancelar a atividade cancela os abastecimentos de todos os apontamentos; o já cancelado à mão fica como estava', async () => {
    const s = await montarLinhasCusto(app);
    const estoqueInicial = await estoqueAtual(s.diesel.id);
    const ap1 = await s.apontar();
    const ap2 = await s.apontar({ data_operacional: '2027-06-11' });
    const a1 = await A.confirmarOk(s.token, corpoAbastecimento(s, { apontamento_id: ap1.id, quantidade: '30' }));
    const a2 = await A.confirmarOk(s.token, corpoExterno(s, { apontamento_id: ap2.id, data_operacional: '2027-06-11', medidor_leitura: '1560' }));
    const a3 = await A.confirmarOk(s.token, corpoAbastecimento(s, { apontamento_id: ap2.id, quantidade: '5', data_operacional: '2027-06-11', medidor_leitura: '1561', tanque_cheio: false }));
    await A.ok(A.cancelar(s.token, a3.id, cancelarCorpo(s)));
    const atual = await s.H.ok(s.H.req('GET', `/atividades/${s.atividade.id}?empresa_id=${s.e1.id}`, s.token));
    await s.H.ok(s.H.req('POST', `/atividades/${s.atividade.id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: atual.versao, motivo: 'atividade duplicada' }));
    const p = prisma();
    const linhas = await p.abastecimentoBem.findMany({ where: { cliente_id: s.c }, orderBy: { numero: 'asc' } });
    assert.deepEqual(linhas.map((l) => [l.id, l.status]), [[a1.id, 'CANCELADO'], [a2.id, 'CANCELADO'], [a3.id, 'CANCELADO']]);
    assert.match(linhas[0].motivo_cancelamento, /^cancelado com o lançamento de 10\/06\/2027 nº \d+ da atividade .+ \(atividade cancelada\): atividade duplicada$/);
    assert.equal(linhas[2].motivo_cancelamento, 'lançado errado', 'o cancelado à mão não é tocado');
    assert.equal(await estoqueAtual(s.diesel.id), estoqueInicial, 'estoque de volta');
    const au = await p.auditLog.findMany({ where: { cliente_id: s.c, acao: 'abastecimento_bem.cancelar' } });
    assert.deepEqual(au.filter((a) => a.dados_novos.cascata?.origem === 'ATIVIDADE').map((a) => a.entidade_id).sort(), [a1.id, a2.id].sort());
  });

  test('corrida: confirmar ligado × cancelar o apontamento — sem deadlock e sem abastecimento confirmado em apontamento cancelado', async () => {
    const s = await montarLinhasCusto(app);
    for (let i = 0; i < 3; i += 1) {
      const ap = await s.apontar({ data_operacional: '2027-06-10' });
      const [c, k] = await Promise.all([
        A.confirmar(s.token, corpoAbastecimento(s, { apontamento_id: ap.id, quantidade: '5', medidor_leitura: `${1550 + i}`, tanque_cheio: false })),
        s.H.req('POST', `${s.baseAp(s.atividade)}/${ap.id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: ap.versao, motivo: 'corrida' }),
      ]);
      assert.equal(k.statusCode, 200, k.body);
      assert.ok([201, 409].includes(c.statusCode), c.body);
      const orfaos = await prisma().abastecimentoBem.count({ where: { cliente_id: s.c, apontamento_id: ap.id, status: 'CONFIRMADO' } });
      assert.equal(orfaos, 0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('totais da atividade com combustível', () => {
  test('combustível, custo/ha com combustível, custo de combustível/ha e consumo por bem (L/h, km/L, misturado → nulo, sem uso → nulo)', async () => {
    const s = await montarLinhasCusto(app);
    const ap = await s.apontar({
      area_executada_dia: '10', operation_id: opId(),
      maquinas: [
        { bem_id: s.trator.id, sem_medidor: false, leitura_inicial: '1520.5', leitura_final: '1530.5' }, // 10 h
        { bem_id: s.caminhonete.id, sem_medidor: false, leitura_inicial: '35210', leitura_final: '35310' }, // 100 km
      ],
    });
    // trator: 80 L do estoque (FIFO 425,00); caminhonete: 10 L de gasolina no posto (60,00)
    await A.confirmarOk(s.token, corpoAbastecimento(s, { apontamento_id: ap.id, medidor_leitura: '1531' }));
    await A.confirmarOk(s.token, corpoExterno(s, {
      apontamento_id: ap.id, bem_id: s.caminhonete.id, tanque_id: s.caminhonete.tanques[0].id, produto_id: s.gasolina.id, quantidade: '10', custo_total: '60', medidor_leitura: '35311',
    }));
    // gerador sem medidor: entra no combustível, consumo sem métrica
    await A.confirmarOk(s.token, corpoAbastecimento(s, { apontamento_id: ap.id, bem_id: s.gerador.id, tanque_id: s.gerador.tanques[0].id, quantidade: '10', medidor_leitura: null, tanque_cheio: false }));
    // um abastecimento cancelado não conta
    const cancelado = await A.confirmarOk(s.token, corpoExterno(s, { apontamento_id: ap.id, quantidade: '1', custo_total: '5', medidor_leitura: '1532', tanque_cheio: false }));
    await A.ok(A.cancelar(s.token, cancelado.id, cancelarCorpo(s)));
    const t = await s.totais();
    // gerador: 10 L do lote B a 5,50 = 55,00 (o trator já levou os 50 do A e 30 do B)
    assert.deepEqual(t.combustivel, { quantidade_l: '100.0000', quantidade_kg: null, custo_total: '540.0000' });
    assert.deepEqual([t.custo_total, t.custo_por_ha, t.custo_combustivel_por_ha], ['540.0000', '54.0000', '54.0000']);
    const porNome = Object.fromEntries(t.consumo_por_bem.map((c) => [c.bem.nome, c]));
    assert.deepEqual(Object.keys(porNome).sort(), ['Caminhonete UT-04', 'Gerador da sede', 'Trator TP-02']);
    const trator = porNome['Trator TP-02'];
    assert.deepEqual([trator.medidor_tipo, trator.uso, trator.quantidade, trator.unidade, trator.metrica, trator.unidade_metrica, trator.valor],
      ['HORIMETRO', '10.0000', '80.0000', 'L', 'LITROS_POR_HORA', 'L/h', '8.0000']);
    const cam = porNome['Caminhonete UT-04'];
    assert.deepEqual([cam.medidor_tipo, cam.uso, cam.quantidade, cam.unidade_metrica, cam.valor], ['ODOMETRO', '100.0000', '10.0000', 'km/L', '10.0000']);
    const ger = porNome['Gerador da sede'];
    assert.deepEqual([ger.medidor_tipo, ger.uso, ger.quantidade, ger.metrica, ger.valor], ['SEM_MEDIDOR', null, '10.0000', null, null]);
    // trator com diesel em kg também: L e kg nunca se somam → sem métrica
    await A.confirmarOk(s.token, corpoAbastecimento(s, { apontamento_id: ap.id, produto_id: s.dieselKg.id, quantidade: '10', medidor_leitura: '1533', tanque_cheio: false }));
    const t2 = await s.totais();
    const misto = t2.consumo_por_bem.find((c) => c.bem.id === s.trator.id);
    assert.deepEqual([misto.quantidade, misto.unidade, misto.quantidade_l, misto.quantidade_kg, misto.metrica, misto.valor], [null, null, '80.0000', '10.0000', null, null]);
    assert.deepEqual([t2.combustivel.quantidade_l, t2.combustivel.quantidade_kg, t2.combustivel.custo_total], ['100.0000', '10.0000', '601.0000']);
    // sem uso (nenhuma linha de máquina do bem na atividade): valor nulo
    const b = await s.abrir();
    const apB = await s.apontar({ data_operacional: '2027-06-12' }, { a: b });
    await A.confirmarOk(s.token, corpoExterno(s, { apontamento_id: apB.id, data_operacional: '2027-06-12', medidor_leitura: '1540', quantidade: '10', custo_total: '50' }));
    const tb = await s.totais(b);
    assert.deepEqual([tb.consumo_por_bem[0].uso, tb.consumo_por_bem[0].metrica, tb.consumo_por_bem[0].valor, tb.custo_total, tb.custo_por_ha, tb.custo_combustivel_por_ha],
      [null, 'LITROS_POR_HORA', null, '50.0000', null, null]);
  });
});
