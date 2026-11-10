/**
 * D-PROD-159 — Patrimônio P1-02: abastecimento e consumo (matriz FUNCIONAL
 * AB1–AB16 do contrato §9.1, PostgreSQL real + HTTP autenticado).
 *
 *  - AB1/AB10: aceite TP-02 com diesel S10 — fator → prévia (zero escrita) →
 *    confirmar 201 (movimento `abastecimento_patrimonio`, FIFO em 2 lotes de
 *    custo distinto, 354,6000 / 5,2768) → replay 200 → cancelar (estorno EXATO
 *    por lote) → 409 duplicado → replay do cancelamento 200;
 *  - AB2 flex (um tanque, gasolina e etanol); AB3 duas fazendas do mesmo
 *    tenant; AB4/AB5 fator ausente e fator alterado depois do histórico; AB6
 *    todos os vetores L→kg de `tests/smoke/fixtures/abastecimentoVetores.json`;
 *    AB7 estoque (sem lote, insuficiente, `estoque_atual` legado, unidade,
 *    local); AB8 capacidade e parciais; AB11 cancelamento bloqueado; AB12
 *    inativações com a tela aberta; AB13 efeitos na P3 (D14); AB14 X1;
 *    AB15 lista/detalhe; AB16 opções;
 *  - recortes de segurança que dependem do fluxo (403/404/400, mesma chave em
 *    outro tenant) — sempre com "nada gravado" pela fotografia das linhas.
 *
 * O medidor e o consumo (M1–M8) ficam em `patrimonioP1AbastecimentosMedidor.test.mjs`.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import {
  acoesAbastecimento, corpoAbastecimento, corpoPrevia, erro, fotoAbastecimento, linhaAbastecimento, montarAbastecimento, opId, prisma,
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
/** O corpo da prévia que a tela montaria a partir do corpo da confirmação. */
const previaDe = (corpo) => {
  const c = { ...corpo };
  delete c.operation_id;
  delete c.conversao_id;
  delete c.conversao_versao;
  return c;
};
/** Item do tanque para o PATCH do bem (P1-01). */
const itemTanque = (t, extra = {}) => ({
  id: t.id, identificador: t.identificador, capacidade_litros: t.capacidade_litros, observacao: t.observacao ?? null, combustivel_ids: t.combustiveis.map((c) => c.id), ...extra,
});
const cancelarCorpo = (versao = 1, extra = {}) => ({ versao, motivo: 'lançado no bem errado', operation_id: opId(), ...extra });
const movimentosAbastecimento = (c) => prisma().movimentacaoEstoque.count({ where: { cliente_id: c, origem_sistema: 'abastecimento_patrimonio' } });

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
    // o vetor `fifo` compartilhado tela × servidor
    const vf = VETORES.fifo;
    assert.deepEqual([d.quantidade_litros, d.kg_por_litro, d.quantidade_kg, d.custo_total, d.custo_unitario_kg], [vf.litros, vf.kg_por_litro, vf.kg, vf.custo_total, vf.custo_unitario_kg]);
    assert.deepEqual(d.fatias.map((f) => [f.ordem, f.quantidade_kg, f.custo_unitario, f.valor]), vf.fatias.map((f) => [f.ordem, f.quantidade_kg, f.custo_unitario, f.valor]));
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
    assert.deepEqual(await saldoLote(s.lotes.dieselA.id), ['0.0000', 'Esgotado']);
    assert.deepEqual(await saldoLote(s.lotes.dieselB.id), ['82.8000', 'Disponivel']);
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
    const bemPublico = await A.bem(s.token, s.e1.id, s.trator.id);
    assert.deepEqual(bemPublico.medidor_operacional, { leitura: '1550.5000', data: '2027-06-10', abastecimento_id: d.id });
    assert.equal(bemPublico.medidor.leitura_atual, '1520.5000');

    // ── replay: mesma chave + mesmo corpo ("80" ≡ "80.0000") → 200, um único movimento ──
    const rr = await A.confirmar(s.operador.token, { ...corpo, quantidade_litros: '80.0000' });
    assert.equal(rr.statusCode, 200, rr.body);
    assert.equal(rr.json().replay, true);
    assert.equal(rr.json().id, d.id);
    assert.equal(await movimentosAbastecimento(s.c), 1);

    // mesma chave + corpo diferente → 409, nada gravado, conflito auditado
    const fotoReplay = await fotoAbastecimento(s.c);
    const rx = await A.confirmar(s.operador.token, { ...corpo, quantidade_litros: '81' });
    assert.deepEqual(erro(rx).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
    const conflito = await prisma().auditLog.findMany({ where: { cliente_id: s.c, acao: 'abastecimento_bem.reenvio_conflitante' } });
    assert.equal(conflito.length, 1);
    assert.equal(conflito[0].dados_novos.operation_id, corpo.operation_id);
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
    assert.equal(k.estorno.quantidade_kg, '67.2000');
    assert.equal(k.estorno.valor_total, '354.6000');
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
    assert.equal(lista.items[0].quantidade_kg, '67.2000');
    assert.deepEqual(lista.items[0].tipo_combustivel, { id: s.comb.DIESEL_S10, nome: 'Diesel S10' });
    const det = await A.ok(A.detalhe(s.leitor.token, d.id, s.e1.id));
    assert.equal(det.status, 'CANCELADO');
    assert.equal(det.fatias.length, 2);
  });
});

describe('P1-02 — combustível, fazenda e fator', () => {
  test('AB2: flex — um tanque aceita GASOLINA e ETANOL; produto de um tipo com o outro tipo → 422 sem_vinculo_ativo; cada um com o seu tipo → 201', async () => {
    const s = await montarAbastecimento(app);
    const tanque = s.caminhonete.tanques[0];
    const flex = (tipo, prod, fator, extra = {}) =>
      corpoAbastecimento(s, {
        bem_id: s.caminhonete.id, tanque_id: tanque.id, tipo_combustivel_id: s.comb[tipo], produto_id: prod.id, conversao_id: fator.id, conversao_versao: fator.versao,
        quantidade_litros: '40', ...extra,
      });
    const tq = await A.ok(A.opcoes(s.operador.token, 'tanques', `empresa_id=${s.e1.id}&bem_id=${s.caminhonete.id}`));
    assert.deepEqual(tq.itens.map((t) => [t.id, t.capacidade_litros, t.combustiveis.map((c) => c.codigo)]), [[tanque.id, '80.0000', ['ETANOL', 'GASOLINA']]], 'um único tanque, dois tipos');
    const soDoTipo = async (tipo) => (await A.ok(A.opcoes(s.operador.token, 'produtos', `empresa_id=${s.e1.id}&tipo_combustivel_id=${s.comb[tipo]}`))).itens.map((p) => p.id);
    assert.deepEqual(await soDoTipo('GASOLINA'), [s.gasolina.id]);
    assert.deepEqual(await soDoTipo('ETANOL'), [s.etanol.id]);

    const antes = await fotoAbastecimento(s.c);
    for (const [tipo, prod, fator] of [['ETANOL', s.gasolina, s.fator.gasolina], ['GASOLINA', s.etanol, s.fator.etanol]]) {
      const corpo = flex(tipo, prod, fator, { medidor_leitura: '35300' });
      const rp = await A.ok(A.previa(s.operador.token, previaDe(corpo)));
      assert.equal(rp.bloqueios[0].code, 'COMBUSTIVEL_PRODUTO_INVALIDO');
      assert.deepEqual([rp.bloqueios[0].field, rp.bloqueios[0].reason], ['produto_id', 'sem_vinculo_ativo'], 'o produto não troca de combustível pelo nome');
      assert.deepEqual(erro(await A.confirmar(s.operador.token, corpo)), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'sem_vinculo_ativo']);
    }
    // diesel no tanque flex: o tanque não aceita o tipo
    const diesel = await A.confirmar(s.operador.token, flex('DIESEL_S10', s.diesel, s.fator.diesel, { medidor_leitura: '35300' }));
    assert.deepEqual(erro(diesel), [422, 'TANQUE_COMBUSTIVEL_INCOMPATIVEL', 'tipo_combustivel_id', 'nao_aceito_pelo_tanque']);
    assert.equal(await fotoAbastecimento(s.c), antes);

    const g = await A.confirmarOk(s.operador.token, flex('GASOLINA', s.gasolina, s.fator.gasolina, { data_operacional: '2027-06-02', medidor_leitura: '35300' }));
    const e = await A.confirmarOk(s.operador.token, flex('ETANOL', s.etanol, s.fator.etanol, { data_operacional: '2027-06-06', medidor_leitura: '35650', quantidade_litros: '30' }));
    assert.deepEqual([g.tanque.id, g.tipo_combustivel.codigo, g.produto.id, g.kg_por_litro, g.quantidade_kg, g.custo_total], [tanque.id, 'GASOLINA', s.gasolina.id, '0.745000', '29.8000', '178.8000']);
    assert.deepEqual([e.tanque.id, e.tipo_combustivel.codigo, e.produto.id, e.kg_por_litro, e.quantidade_kg, e.custo_total], [tanque.id, 'ETANOL', s.etanol.id, '0.789100', '23.6730', '94.6920']);
    assert.deepEqual(await saldoLote(s.lotes.gasolina.id), ['270.2000', 'Disponivel']);
    assert.deepEqual(await saldoLote(s.lotes.etanol.id), ['276.3270', 'Disponivel']);
    assert.equal(await estoqueAtual(s.gasolina.id), '270.2000');
    assert.equal(await estoqueAtual(s.etanol.id), '276.3270');
  });

  test('AB3: duas fazendas do mesmo tenant — produto da F2 com bem da F1 → 422 outra_empresa; lotes da F2 nunca consumidos; F1 não vê o abastecimento da F2 (404)', async () => {
    const s = await montarAbastecimento(app);
    const antes = await fotoAbastecimento(s.c);
    const cruzado = corpoAbastecimento(s, { produto_id: s.diesel2.id, conversao_id: s.fator.diesel2.id, conversao_versao: 1 });
    const rp = await A.ok(A.previa(s.operador.token, previaDe(cruzado)));
    assert.deepEqual([rp.bloqueios[0].code, rp.bloqueios[0].reason], ['COMBUSTIVEL_PRODUTO_INVALIDO', 'outra_empresa']);
    assert.deepEqual(erro(await A.confirmar(s.operador.token, cruzado)), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'outra_empresa']);
    const fatorCruzado = await s.configurarFator(s.e1, s.comb.DIESEL_S10, s.diesel2, '0.840000', null, s.contaFator.token);
    assert.deepEqual(erro(fatorCruzado), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'sem_vinculo_ativo'], fatorCruzado.body);
    const locaisCruzados = await A.opcoes(s.operador.token, 'locais', `empresa_id=${s.e1.id}&produto_id=${s.diesel2.id}`);
    assert.deepEqual(erro(locaisCruzados), [404, 'PRODUTO_NOT_FOUND', 'produto_id', 'produto_nao_encontrado']);
    assert.equal(await fotoAbastecimento(s.c), antes);

    // F1 no MESMO local onde a F2 tem 500 kg: só os lotes da F1 entram no FIFO
    const d1 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s));
    assert.deepEqual(d1.fatias.map((f) => f.lote_id), [s.lotes.dieselA.id, s.lotes.dieselB.id]);
    assert.deepEqual(await saldoLote(s.lotes.diesel2.id), ['500.0000', 'Disponivel'], 'o lote da F2 não foi tocado');
    assert.equal(await estoqueAtual(s.diesel2.id), '500.0000');

    // bem da F2 abastece com o produto da F2
    const tratorF2 = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, { empresa_id: s.e2.id, codigo_frota: 'TP-09' })), 201);
    const corpoF2 = corpoAbastecimento(s, {
      empresa_id: s.e2.id, bem_id: tratorF2.id, tanque_id: tratorF2.tanques[0].id, produto_id: s.diesel2.id, conversao_id: s.fator.diesel2.id, conversao_versao: 1,
    });
    const semBemNaF1 = await A.previa(s.operador.token, previaDe({ ...corpoF2, empresa_id: s.e1.id }));
    assert.deepEqual(erro(semBemNaF1), [404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO', 'bem_id', 'bem_inexistente']);
    const d2 = await A.confirmarOk(s.operador.token, corpoF2);
    assert.equal(d2.empresa_id, s.e2.id);
    assert.deepEqual(d2.fatias.map((f) => [f.lote_id, f.quantidade_kg]), [[s.lotes.diesel2.id, '67.2000']]);
    assert.deepEqual(await saldoLote(s.lotes.diesel2.id), ['432.8000', 'Disponivel']);
    assert.equal(await estoqueAtual(s.diesel.id), '82.8000', 'o produto da F1 só perdeu o abastecimento da F1');

    const l1 = await A.ok(A.lista(s.operador.token, s.e1.id));
    const l2 = await A.ok(A.lista(s.operador.token, s.e2.id));
    assert.deepEqual([l1.total, l1.items.map((i) => i.id)], [1, [d1.id]]);
    assert.deepEqual([l2.total, l2.items.map((i) => i.id)], [1, [d2.id]]);
    assert.deepEqual(erro(await A.detalhe(s.operador.token, d2.id, s.e1.id)).slice(0, 2), [404, 'ABASTECIMENTO_NAO_ENCONTRADO']);
    const fotoF2 = await fotoAbastecimento(s.c);
    const cancelarCruzado = await A.cancelar(s.contaCancelar.token, d2.id, { empresa_id: s.e1.id, ...cancelarCorpo() });
    assert.deepEqual(erro(cancelarCruzado).slice(0, 2), [404, 'ABASTECIMENTO_NAO_ENCONTRADO']);
    assert.equal(await fotoAbastecimento(s.c), fotoF2);
    const fatoresF1 = await A.ok(A.req('GET', `/patrimonio-conversoes-combustivel?empresa_id=${s.e1.id}`, s.leitor.token));
    assert.equal(fatoresF1.items.some((f) => f.id === s.fator.diesel2.id), false, 'o fator da F2 não aparece na F1');
    const bensF1 = await A.ok(A.opcoes(s.operador.token, 'bens', `empresa_id=${s.e1.id}`));
    assert.equal(bensF1.itens.some((b) => b.id === tratorF2.id), false);
    assert.deepEqual(erro(await A.opcoes(s.operador.token, 'tanques', `empresa_id=${s.e1.id}&bem_id=${tratorF2.id}`)).slice(0, 2), [404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO']);
  });

  test('AB4: sem fator vigente → prévia com bloqueio AUSENTE e confirmação 422', async () => {
    const s = await montarAbastecimento(app, { fatores: false });
    const antes = await fotoAbastecimento(s.c);
    const rp = await A.ok(A.previa(s.operador.token, corpoPrevia(s)));
    assert.deepEqual(rp.bloqueios.map((b) => [b.code, b.field, b.reason]), [['ABASTECIMENTO_CONVERSAO_AUSENTE', 'conversao_id', 'sem_conversao_vigente']]);
    assert.deepEqual(rp.bloqueios[0].details, { tipo_combustivel_id: s.comb.DIESEL_S10, produto_id: s.diesel.id });
    assert.equal(rp.plano.quantidade_kg, null, 'nenhum kg sem fator: 1 L nunca vale 1 kg');
    assert.equal(rp.plano.conversao, null);
    assert.equal(rp.plano.fifo, null);
    const rc = await A.confirmar(s.operador.token, corpoAbastecimento(s, { conversao_id: 'fator-inexistente', conversao_versao: 1 }));
    assert.deepEqual(erro(rc), [422, 'ABASTECIMENTO_CONVERSAO_AUSENTE', 'conversao_id', 'sem_conversao_vigente']);
    const produtos = await A.ok(A.opcoes(s.operador.token, 'produtos', `empresa_id=${s.e1.id}&tipo_combustivel_id=${s.comb.DIESEL_S10}`));
    assert.deepEqual(produtos.itens.map((p) => [p.id, p.conversao]), [[s.diesel.id, null]]);
    assert.equal(await fotoAbastecimento(s.c), antes);
  });

  test('AB5: fator alterado DEPOIS do histórico — o abastecimento antigo guarda o f1; confirmar com f1 → 409 ALTERADA; com f2 → 201; vigente errado → 409; encerrar → 422 AUSENTE', async () => {
    const s = await montarAbastecimento(app);
    const f1 = s.fator.diesel;
    const a1 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '20', data_operacional: '2027-06-05', medidor_leitura: '1530' }));
    assert.deepEqual([a1.kg_por_litro, a1.quantidade_kg], ['0.840000', '16.8000']);
    const corpoVisto = corpoAbastecimento(s, { quantidade_litros: '20' }); // a tela viu o f1 na prévia

    const f2 = await A.ok(s.configurarFator(s.e1, s.comb.DIESEL_S10, s.diesel, '0.850000', f1.id, s.contaFator.token), 201);
    assert.deepEqual([f2.sequencia, f2.versao, f2.kg_por_litro, f2.ativo], [2, 1, '0.850000', true]);
    const f1Encerrado = await prisma().conversaoCombustivelProduto.findUnique({ where: { id: f1.id } });
    assert.deepEqual([f1Encerrado.ativo, f1Encerrado.ativo_chave, f1Encerrado.versao, f1Encerrado.kg_por_litro.toFixed(6)], [false, null, 2, '0.840000']);
    const historico = await A.ok(A.detalhe(s.leitor.token, a1.id, s.e1.id));
    assert.deepEqual([historico.kg_por_litro, historico.quantidade_kg, historico.conversao], ['0.840000', '16.8000', { id: f1.id, sequencia: 1, versao: 2, vigente: false }], 'o histórico nunca é reconvertido');

    const antes = await fotoAbastecimento(s.c);
    const rc = await A.confirmar(s.operador.token, corpoVisto);
    assert.deepEqual(erro(rc), [409, 'ABASTECIMENTO_CONVERSAO_ALTERADA', 'conversao_id', 'conversao_alterada']);
    assert.deepEqual([rc.json().details.conversao_vigente_id, rc.json().details.conversao_vigente_versao], [f2.id, 1]);
    const rv = await s.configurarFator(s.e1, s.comb.DIESEL_S10, s.diesel, '0.860000', f1.id, s.contaFator.token);
    assert.deepEqual(erro(rv), [409, 'ABASTECIMENTO_CONVERSAO_ALTERADA', 'conversao_vigente_id', 'vigente_divergente']);
    const rnulo = await s.configurarFator(s.e1, s.comb.DIESEL_S10, s.diesel, '0.860000', null, s.contaFator.token);
    assert.deepEqual(erro(rnulo), [409, 'ABASTECIMENTO_CONVERSAO_ALTERADA', 'conversao_vigente_id', 'vigente_divergente']);
    const versaoErrada = await A.confirmar(s.operador.token, { ...corpoVisto, operation_id: opId(), conversao_id: f2.id, conversao_versao: 2 });
    assert.deepEqual(erro(versaoErrada), [409, 'ABASTECIMENTO_CONVERSAO_ALTERADA', 'conversao_id', 'conversao_alterada'], 'mesmo id com outra versão');
    // faixa e declaração do fator (0 < f ≤ 10, 6 casas, estoque declarado em KG)
    const fator = (kg, extra = {}) => A.req('POST', '/patrimonio-conversoes-combustivel', s.contaFator.token, {
      empresa_id: s.e1.id, tipo_combustivel_id: s.comb.DIESEL_S10, produto_id: s.diesel.id, kg_por_litro: kg, declara_estoque_em_kg: true, conversao_vigente_id: f2.id, ...extra,
    });
    assert.deepEqual(erro(await fator('10.000001')), [422, 'ABASTECIMENTO_CONVERSAO_INVALIDA', 'kg_por_litro', 'fator_acima_do_teto']);
    assert.deepEqual(erro(await fator('0.000000')), [422, 'ABASTECIMENTO_CONVERSAO_INVALIDA', 'kg_por_litro', 'fator_nao_positivo']);
    assert.deepEqual(erro(await fator('0.850000', { declara_estoque_em_kg: false })), [422, 'ABASTECIMENTO_CONVERSAO_INVALIDA', 'declara_estoque_em_kg', 'declaracao_obrigatoria']);
    assert.equal(erro(await fator('0.8500001'))[0], 400, '7 casas');
    assert.equal(await fotoAbastecimento(s.c), antes);

    const rp = await A.ok(A.previa(s.operador.token, previaDe(corpoVisto)));
    assert.deepEqual([rp.bloqueios, rp.plano.conversao.id, rp.plano.quantidade_kg], [[], f2.id, '17.0000'], 'a prévia refeita usa o f2');
    const a2 = await A.confirmarOk(s.operador.token, { ...corpoVisto, operation_id: opId(), conversao_id: f2.id, conversao_versao: f2.versao });
    assert.deepEqual([a2.kg_por_litro, a2.quantidade_kg, a2.conversao.id], ['0.850000', '17.0000', f2.id]);

    const lista = async (situacao) => (await A.ok(A.req('GET', `/patrimonio-conversoes-combustivel?empresa_id=${s.e1.id}&produto_id=${s.diesel.id}&situacao=${situacao}`, s.leitor.token))).items;
    assert.deepEqual((await lista('TODAS')).map((f) => [f.sequencia, f.ativo]).sort(), [[1, false], [2, true]]);
    assert.deepEqual((await lista('VIGENTES')).map((f) => f.id), [f2.id]);

    const enc = await A.ok(A.req('POST', `/patrimonio-conversoes-combustivel/${f2.id}/encerrar`, s.contaFator.token, { empresa_id: s.e1.id, versao: 1 }));
    assert.deepEqual([enc.ativo, enc.versao], [false, 2]);
    assert.equal((await A.ok(A.req('POST', `/patrimonio-conversoes-combustivel/${f2.id}/encerrar`, s.contaFator.token, { empresa_id: s.e1.id, versao: 2 }))).versao, 2, 'já encerrado: 200 sem escrita');
    const auditFator = await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'ConversaoCombustivelProduto', entidade_id: { in: [f1.id, f2.id] } }, orderBy: { createdAt: 'asc' } });
    const linhaAudit = (a) => JSON.stringify([a.acao, a.entidade_id, a.dados_novos.kg_por_litro, a.dados_novos.ativo]);
    assert.deepEqual(auditFator.map(linhaAudit).sort(), [
      ['conversao_combustivel.criar', f1.id, '0.840000', true],
      ['conversao_combustivel.encerrar', f1.id, '0.840000', false],
      ['conversao_combustivel.criar', f2.id, '0.850000', true],
      ['conversao_combustivel.encerrar', f2.id, '0.850000', false],
    ].map((l) => JSON.stringify(l)).sort(), 'criar e encerrar auditados (o mesmo lote de eventos pode ter o mesmo instante); o encerramento repetido não audita');
    const antes2 = await fotoAbastecimento(s.c);
    const ausente = await A.confirmar(s.operador.token, { ...corpoVisto, operation_id: opId(), conversao_id: f2.id, conversao_versao: 1 });
    assert.deepEqual(erro(ausente), [422, 'ABASTECIMENTO_CONVERSAO_AUSENTE', 'conversao_id', 'sem_conversao_vigente']);
    assert.equal(await fotoAbastecimento(s.c), antes2);
    // os dois históricos continuam com o seu fator
    const lst = await A.ok(A.lista(s.leitor.token, s.e1.id));
    assert.deepEqual(lst.items.map((i) => [i.id, i.kg_por_litro]).sort(), [[a1.id, '0.840000'], [a2.id, '0.850000']].sort());
  });

  test('AB6: conversão L→kg — TODOS os vetores de abastecimentoVetores.json (prévia = confirmação; recusas; CHECK do banco)', async () => {
    const s = await montarAbastecimento(app);
    // bem sem medidor e com tanque grande o bastante para cada vetor (a capacidade nunca mascara a recusa de kg)
    const grande = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, {
      empresa_id: s.e1.id, nome: 'Grupo gerador de teste', familia_id: s.fam.EQUIPAMENTOS, tipo_id: s.tip.GERADOR, medidor: { tipo: 'SEM_MEDIDOR' },
      tanques: [{ identificador: 'Tanque de prova', capacidade_litros: '9999999999.9999', combustivel_ids: [s.comb.DIESEL_S10] }],
    }), 201);
    await s.lote(s.e1, s.diesel, s.local, { kg: '20000.0000', custo: '5.0000', dia: '2027-06-05' });
    let vigente = s.fator.diesel;
    const gravados = [];
    for (const v of VETORES.conversao) {
      if (vigente.kg_por_litro !== v.kg_por_litro) vigente = await A.ok(s.configurarFator(s.e1, s.comb.DIESEL_S10, s.diesel, v.kg_por_litro, vigente.id, s.contaFator.token), 201);
      assert.equal(vigente.kg_por_litro, v.kg_por_litro);
      const corpo = corpoAbastecimento(s, {
        bem_id: grande.id, tanque_id: grande.tanques[0].id, quantidade_litros: v.litros, medidor_leitura: null, tanque_cheio: false,
        conversao_id: vigente.id, conversao_versao: vigente.versao,
      });
      const rp = await A.ok(A.previa(s.operador.token, previaDe(corpo)));
      if (v.recusa) {
        assert.deepEqual(rp.bloqueios.map((b) => [b.code, b.reason]), [['OPERACAO_VALORES_INVALIDOS', v.recusa]], `${v.litros} × ${v.kg_por_litro}`);
        const antes = await fotoAbastecimento(s.c);
        assert.deepEqual(erro(await A.confirmar(s.operador.token, corpo)), [422, 'OPERACAO_VALORES_INVALIDOS', 'quantidade_litros', v.recusa]);
        assert.equal(await fotoAbastecimento(s.c), antes);
        continue;
      }
      assert.deepEqual([rp.bloqueios, rp.plano.quantidade_litros, rp.plano.quantidade_kg], [[], v.litros, v.kg], `prévia ${v.litros} × ${v.kg_por_litro}`);
      const d = await A.confirmarOk(s.operador.token, corpo);
      assert.deepEqual([d.quantidade_litros, d.kg_por_litro, d.quantidade_kg, d.movimentacao.quantidade_kg], [v.litros, v.kg_por_litro, v.kg, v.kg], `confirmação ${v.litros} × ${v.kg_por_litro}`);
      gravados.push(d.id);
    }
    assert.equal(gravados.length, VETORES.conversao.filter((v) => !v.recusa).length);
    // CHECK conversao_kg do banco: toda linha gravada obedece round(litros × fator, 4) do PostgreSQL
    const [{ divergentes }] = await prisma().$queryRaw`SELECT count(*)::int AS divergentes FROM "AbastecimentoBem" WHERE cliente_id = ${s.c} AND quantidade_kg <> round(quantidade_litros * kg_por_litro, 4)`;
    assert.equal(divergentes, 0);
    assert.equal(await prisma().abastecimentoBem.count({ where: { cliente_id: s.c } }), gravados.length);
  });
});

describe('P1-02 — estoque, capacidade e idempotência', () => {
  test('AB7: sem lote no local / lotes insuficientes / estoque_atual legado menor / unidade "L" / local inativo ou inexistente → 422; nada gravado', async () => {
    const s = await montarAbastecimento(app);
    const antes = await fotoAbastecimento(s.c);
    const semLote = await A.confirmar(s.operador.token, corpoAbastecimento(s, { local_estoque_id: s.local2.id }));
    assert.deepEqual(erro(semLote), [422, 'ESTOQUE_SALDO_INSUFICIENTE', 'quantidade_litros', 'saldo_lote_insuficiente']);
    assert.deepEqual([semLote.json().details.disponivel, semLote.json().details.solicitado], ['0.0000', '67.2000']);
    const insuficiente = await A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '179' }));
    assert.deepEqual(erro(insuficiente), [422, 'ESTOQUE_SALDO_INSUFICIENTE', 'quantidade_litros', 'saldo_lote_insuficiente']);
    assert.deepEqual([insuficiente.json().details.disponivel, insuficiente.json().details.solicitado], ['150.0000', '150.3600']);
    const inativo = await A.confirmar(s.operador.token, corpoAbastecimento(s, { local_estoque_id: s.localInativo.id }));
    assert.deepEqual(erro(inativo), [422, 'ABASTECIMENTO_LOCAL_INVALIDO', 'local_estoque_id', 'local_inativo']);
    const inexistente = await A.confirmar(s.operador.token, corpoAbastecimento(s, { local_estoque_id: 'local-que-nao-existe' }));
    assert.deepEqual(erro(inexistente), [422, 'ABASTECIMENTO_LOCAL_INVALIDO', 'local_estoque_id', 'local_inexistente']);
    const litro = corpoAbastecimento(s, {
      bem_id: s.gerador.id, tanque_id: s.gerador.tanques[0].id, tipo_combustivel_id: s.comb.DIESEL_S500, produto_id: s.oleoLitro.id,
      medidor_leitura: null, quantidade_litros: '10', conversao_id: 'qualquer', conversao_versao: 1,
    });
    const rpL = await A.ok(A.previa(s.operador.token, previaDe(litro)));
    assert.deepEqual([rpL.bloqueios[0].code, rpL.bloqueios[0].details.unidade], ['ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL', 'L']);
    assert.deepEqual(erro(await A.confirmar(s.operador.token, litro)), [422, 'ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL', 'produto_id', 'unidade_estoque_nao_kg']);
    const fatorL = await s.configurarFator(s.e1, s.comb.DIESEL_S500, s.oleoLitro, '0.900000', null, s.contaFator.token);
    assert.deepEqual(erro(fatorL), [422, 'ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL', 'produto_id', 'unidade_estoque_nao_kg']);
    assert.equal(await fotoAbastecimento(s.c), antes);

    // `estoque_atual` legado MENOR que os lotes (incoerência herdada): recusa, nunca saldo negativo
    await prisma().produto.update({ where: { id: s.diesel.id }, data: { estoque_atual: '50.0000' } });
    const antes2 = await fotoAbastecimento(s.c);
    const rp = await A.ok(A.previa(s.operador.token, corpoPrevia(s)));
    assert.deepEqual(rp.bloqueios.map((b) => [b.code, b.reason, b.details.estoque_atual]), [['ESTOQUE_SALDO_INSUFICIENTE', 'estoque_atual_insuficiente', '50.0000']]);
    assert.deepEqual(erro(await A.confirmar(s.operador.token, corpoAbastecimento(s))), [422, 'ESTOQUE_SALDO_INSUFICIENTE', 'quantidade_litros', 'estoque_atual_insuficiente']);
    assert.equal(await fotoAbastecimento(s.c), antes2);
  });

  test('AB8: capacidade — 180,0001 L → 422; 180 L não é recusado por capacidade; parciais aceitos sem presumir saldo do tanque', async () => {
    const s = await montarAbastecimento(app);
    const antes = await fotoAbastecimento(s.c);
    const rc = await A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '180.0001' }));
    assert.deepEqual(erro(rc), [422, 'ABASTECIMENTO_EXCEDE_CAPACIDADE', 'quantidade_litros', 'excede_capacidade_tanque']);
    assert.equal(rc.json().details.capacidade_litros, '180.0000');
    const zero = await A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '0.0000' }));
    assert.deepEqual(erro(zero), [422, 'OPERACAO_VALORES_INVALIDOS', 'quantidade_litros', 'quantidade_nao_positiva']);
    assert.equal(await fotoAbastecimento(s.c), antes);
    const rp = await A.ok(A.previa(s.operador.token, corpoPrevia(s, { quantidade_litros: '180' })));
    // 180 L × 0,84 = 151,2 kg > 150 kg nos lotes: o saldo (não a capacidade) recusa.
    assert.deepEqual(rp.bloqueios.map((b) => [b.code, b.reason]), [['ESTOQUE_SALDO_INSUFICIENTE', 'saldo_lote_insuficiente']]);

    await s.lote(s.e1, s.diesel, s.local, { kg: '200.0000', custo: '6.0000', dia: '2027-06-04' });
    const cheio = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '180', data_operacional: '2027-06-08', medidor_leitura: '1540' }));
    assert.deepEqual([cheio.quantidade_litros, cheio.quantidade_kg], ['180.0000', '151.2000']);
    // parciais no MESMO dia e logo depois do cheio: o sistema não controla o saldo físico do tanque
    const p1 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '20', tanque_cheio: false, medidor_leitura: '1541' }));
    const p2 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '30', tanque_cheio: false, medidor_leitura: '1541' }));
    assert.deepEqual([p1.quantidade_kg, p2.quantidade_kg], ['16.8000', '25.2000']);
    assert.equal(await estoqueAtual(s.diesel.id), '156.8000', '350 - 151,2 - 16,8 - 25,2');
    assert.equal(await movimentosAbastecimento(s.c), 3);
  });
});

describe('P1-02 — cancelamento bloqueado e efeitos na P3', () => {
  test('AB11: cancelamento bloqueado — devolução acima da entrada, lote Estornado (compra P3 cancelada após reposição), produto movido de fazenda; nada alterado', async () => {
    const s = await montarAbastecimento(app);
    const compra = await s.compraP3(s.e1, s.diesel, s.local2, { kg: '100.0000', preco: '5.00' });
    const L = compra.lote_id;
    const d = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { local_estoque_id: s.local2.id }));
    assert.deepEqual(d.fatias.map((f) => [f.lote_id, f.quantidade_kg, f.custo_unitario]), [[L, '67.2000', '5.0000']], 'consome o lote nascido da compra P3');
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

    // (a) reposição por fora: o lote volta a 100 kg → devolver 67,2 passaria a entrada
    await prisma().$executeRaw`UPDATE "EstoqueLoteNota" SET quantidade_disponivel = quantidade_entrada WHERE id = ${L}`;
    await prisma().$executeRaw`UPDATE "Produto" SET estoque_atual = estoque_atual + 67.2 WHERE id = ${s.diesel.id}`;
    const fotoA = await fotoAbastecimento(s.c);
    const excede = await A.cancelar(s.contaCancelar.token, d.id, { empresa_id: s.e1.id, ...cancelarCorpo() });
    assert.deepEqual(erro(excede), [409, 'ABASTECIMENTO_CANCELAMENTO_BLOQUEADO', 'abastecimento', 'devolucao_excede_entrada']);
    assert.equal(excede.json().details.lote_id, L);
    assert.equal(await fotoAbastecimento(s.c), fotoA);

    // (b) com o lote intocado de novo, a compra P3 é cancelada (lote 'Estornado') → a devolução não tem para onde voltar
    const cancelCompra = await A.req('POST', `/operacoes-financeiras/${compra.operacao.id}/cancelar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), motivo: 'compra devolvida ao fornecedor' });
    assert.equal(cancelCompra.statusCode, 200, cancelCompra.body);
    assert.deepEqual(await saldoLote(L), ['0.0000', 'Estornado']);
    const fotoB = await fotoAbastecimento(s.c);
    const estornado = await A.cancelar(s.contaCancelar.token, d.id, { empresa_id: s.e1.id, ...cancelarCorpo() });
    assert.deepEqual(erro(estornado), [409, 'ABASTECIMENTO_CANCELAMENTO_BLOQUEADO', 'abastecimento', 'lote_indisponivel_para_devolucao']);
    assert.equal(estornado.json().details.lote_id, L);
    assert.equal(await fotoAbastecimento(s.c), fotoB);
    assert.equal((await A.ok(A.detalhe(s.leitor.token, d.id, s.e1.id))).status, 'CONFIRMADO');

    // (c) produto movido de fazenda (vínculo inativado + PATCH do produto) → produto_mudou_de_fazenda
    const g = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, {
      bem_id: s.caminhonete.id, tanque_id: s.caminhonete.tanques[0].id, tipo_combustivel_id: s.comb.GASOLINA, produto_id: s.gasolina.id,
      conversao_id: s.fator.gasolina.id, conversao_versao: 1, quantidade_litros: '30', medidor_leitura: '35300',
    }));
    await A.ok(A.req('PATCH', `/patrimonio-combustivel-produtos/${s.vinculos.gasolina.id}`, s.token, { empresa_id: s.e1.id, versao: s.vinculos.gasolina.versao, ativo: false }));
    await A.ok(A.req('PATCH', `/produtos/${s.gasolina.id}`, s.token, { empresa_id: s.e2.id }));
    const fotoC = await fotoAbastecimento(s.c);
    const mudou = await A.cancelar(s.contaCancelar.token, g.id, { empresa_id: s.e1.id, ...cancelarCorpo() });
    assert.deepEqual(erro(mudou), [409, 'ABASTECIMENTO_CANCELAMENTO_BLOQUEADO', 'abastecimento', 'produto_mudou_de_fazenda']);
    assert.equal(await fotoAbastecimento(s.c), fotoC);
  });

  test('AB13: efeitos na P3 (D14) — compra cujo lote o abastecimento consumiu: retificar/excluir 409 e cancelar 409; cancelado o abastecimento, cancelar a compra volta a funcionar e retificar/excluir seguem bloqueados', async () => {
    const s = await montarAbastecimento(app);
    const compra = await s.compraP3(s.e1, s.diesel, s.local2, { kg: '100.0000', preco: '5.00' });
    const L = compra.lote_id;
    assert.deepEqual(await saldoLote(L), ['100.0000', 'Disponivel']);
    const d = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { local_estoque_id: s.local2.id }));
    assert.deepEqual(await saldoLote(L), ['32.8000', 'Disponivel']);

    const detalheCompra = async () => A.ok(A.req('GET', `/operacoes-financeiras/${compra.operacao.id}?empresa_id=${s.e1.id}`, s.token));
    const retificar = async () => {
      const atual = await detalheCompra();
      const doc = await s.docCompraP3(s.e1, s.diesel, s.local2, { kg: '90.0000', preco: '5.00' });
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
      assert.ok(motivosDe(ret).some(([c, e, n]) => c === 'lote_consumido' && e === 'MovimentacaoEstoque' && n === d.movimentacao.numero), ret.body);
      const exc = await excluir();
      assert.deepEqual([exc.statusCode, exc.json().code, exc.json().details?.reason ?? exc.json().reason], [409, 'OPERACAO_EXCLUSAO_BLOQUEADA', 'lote_consumido'], exc.body);
    };
    const fotoAntes = await fotoAbastecimento(s.c);
    await bloqueiosP3();
    const cancel1 = await A.req('POST', `/operacoes-financeiras/${compra.operacao.id}/cancelar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), motivo: 'compra devolvida' });
    assert.deepEqual(erro(cancel1), [409, 'ESTOQUE_JA_CONSUMIDO', 'itens', 'lote_consumido'], cancel1.body);
    assert.equal(cancel1.json().details.lote_id, L);
    assert.equal(await fotoAbastecimento(s.c), fotoAntes, 'nenhuma recusa da P3 mexeu no estoque nem no abastecimento');

    // cancelar o abastecimento devolve os 67,2 kg ao lote da compra
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
  test('AB12: vínculo, tipo, produto, local, tanque e bem inativados depois da prévia → os 422 do §5.5 e nada gravado; GNV (m3) e natureza sem tanque recusados', async () => {
    const s = await montarAbastecimento(app);
    const versaoDe = async (delegado, id) => (await /** @type {any} */ (prisma())[delegado].findUnique({ where: { id } })).versao;
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
    const vinculo = (ativo) => async () =>
      A.ok(A.req('PATCH', `/patrimonio-combustivel-produtos/${s.vinculos.diesel.id}`, s.token, { empresa_id: s.e1.id, versao: await versaoDe('tipoCombustivelProduto', s.vinculos.diesel.id), ativo }));
    const tipo = (ativo) => async () =>
      A.ok(A.req('PATCH', `/patrimonio-combustiveis/${s.comb.DIESEL_S10}`, s.token, { versao: await versaoDe('tipoCombustivel', s.comb.DIESEL_S10), ativo }));
    const produto = (ativo) => () => A.ok(A.req('PATCH', `/produtos/${s.diesel.id}`, s.token, { ativo }));
    const local = (ativo) => () => A.ok(A.req('PATCH', `/locais-estoque/${s.local.id}`, s.token, { ativo }));
    const patchBem = async (corpo) => {
      const b = await A.bem(s.token, s.e1.id, s.trator.id);
      return A.ok(A.req('PATCH', `/bens-patrimoniais/${s.trator.id}`, s.token, { empresa_id: s.e1.id, versao: b.versao, ...corpo(b) }));
    };

    await comTelaAberta('vínculo', vinculo(false), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'sem_vinculo_ativo'], vinculo(true));
    await comTelaAberta('tipo', tipo(false), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'tipo_combustivel_id', 'tipo_inativo'], tipo(true));
    await comTelaAberta('produto', produto(false), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'inativo'], produto(true));
    await comTelaAberta('local', local(false), [422, 'ABASTECIMENTO_LOCAL_INVALIDO', 'local_estoque_id', 'local_inativo'], local(true));
    await comTelaAberta('tanque', () => patchBem((b) => ({ tanques: [itemTanque(b.tanques[0], { ativo: false })] })), [422, 'ABASTECIMENTO_TANQUE_INVALIDO', 'tanque_id', 'tanque_inativo'],
      () => patchBem((b) => ({ tanques: [itemTanque(b.tanques[0], { ativo: true })] })));
    await comTelaAberta('bem', () => patchBem(() => ({ ativo: false })), [422, 'ABASTECIMENTO_BEM_INELEGIVEL', 'bem_id', 'bem_inativo'], () => patchBem(() => ({ ativo: true })));
    // não é só inativação: capacidade reduzida e combustível retirado do tanque também são relidos sob as travas
    await comTelaAberta('capacidade', () => patchBem((b) => ({ tanques: [itemTanque(b.tanques[0], { capacidade_litros: '50' })] })),
      [422, 'ABASTECIMENTO_EXCEDE_CAPACIDADE', 'quantidade_litros', 'excede_capacidade_tanque'], () => patchBem((b) => ({ tanques: [itemTanque(b.tanques[0], { capacidade_litros: '180' })] })));
    await comTelaAberta('combustível do tanque', () => patchBem((b) => ({ tanques: [itemTanque(b.tanques[0], { combustivel_ids: [s.comb.DIESEL_S500] })] })),
      [422, 'TANQUE_COMBUSTIVEL_INCOMPATIVEL', 'tipo_combustivel_id', 'nao_aceito_pelo_tanque'], () => patchBem((b) => ({ tanques: [itemTanque(b.tanques[0], { combustivel_ids: [s.comb.DIESEL_S10] })] })));
    await comTelaAberta('fator encerrado', () => A.ok(A.req('POST', `/patrimonio-conversoes-combustivel/${s.fator.diesel.id}/encerrar`, s.contaFator.token, { empresa_id: s.e1.id, versao: 1 })),
      [422, 'ABASTECIMENTO_CONVERSAO_AUSENTE', 'conversao_id', 'sem_conversao_vigente'], async () => {
        s.fator.diesel = await A.ok(s.configurarFator(s.e1, s.comb.DIESEL_S10, s.diesel, '0.840000', null, s.contaFator.token), 201);
      });
    // reativado tudo, a mesma tela confirma
    const confirmado = await A.confirmarOk(s.operador.token, corpoAbastecimento(s));

    const antes = await fotoAbastecimento(s.c);
    // GNV é medido em m3: o abastecimento só aceita litros (nem o fator é configurável)
    const gnv = corpoAbastecimento(s, {
      bem_id: s.caminhonete.id, tanque_id: s.caminhonete.tanques[0].id, tipo_combustivel_id: s.comb.GNV, produto_id: s.gasolina.id, medidor_leitura: '35300',
      conversao_id: s.fator.gasolina.id, conversao_versao: 1,
    });
    const rg = await A.confirmar(s.operador.token, gnv);
    assert.deepEqual(erro(rg), [422, 'TANQUE_COMBUSTIVEL_INCOMPATIVEL', 'tipo_combustivel_id', 'unidade_nao_litro']);
    assert.equal(rg.json().details.unidade, 'm3');
    assert.deepEqual(erro(await s.configurarFator(s.e1, s.comb.GNV, s.gasolina, '0.700000', null, s.contaFator.token)), [422, 'TANQUE_COMBUSTIVEL_INCOMPATIVEL', 'tipo_combustivel_id', 'unidade_nao_litro']);
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
    for (const t of ['abastecimentoBem', 'abastecimentoBemConsumoLote', 'conversaoCombustivelProduto', 'movimentacaoEstoque', 'estoqueLoteNota', 'operacaoIdempotente', 'tanqueBem', 'produtos']) {
      assert.deepEqual(fotoDepois[t], fotoAntes[t], t);
    }

    // C14: cancelar é correção — com bem, tanque, tipo, vínculo, produto e local INATIVOS o estorno exato passa
    await patchBem((b) => ({ tanques: [itemTanque(b.tanques[0], { ativo: false })] }));
    await patchBem(() => ({ ativo: false }));
    await vinculo(false)();
    await tipo(false)();
    await produto(false)();
    await local(false)();
    const k = await A.ok(A.cancelar(s.contaCancelar.token, confirmado.id, { empresa_id: s.e1.id, ...cancelarCorpo() }));
    assert.deepEqual([k.status, k.estorno.quantidade_kg], ['CANCELADO', '67.2000']);
    assert.equal(await estoqueAtual(s.diesel.id), '150.0000');
  });
});

describe('P1-02 — lista, detalhe e opções', () => {
  test('AB15: lista com filtros (empresa, bem, tanque, produto, status, período, operation_id, q), keyset limit=2 e total; erros de período', async () => {
    const s = await montarAbastecimento(app);
    const cam = { bem_id: s.caminhonete.id, tanque_id: s.caminhonete.tanques[0].id };
    const a1 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '20', data_operacional: '2027-06-05', medidor_leitura: '1530', referencia_externa: 'NF-100' }));
    const a2 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '20', data_operacional: '2027-06-08', medidor_leitura: '1540', referencia_externa: 'nf-200' }));
    const a3 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, {
      ...cam, tipo_combustivel_id: s.comb.GASOLINA, produto_id: s.gasolina.id, conversao_id: s.fator.gasolina.id, conversao_versao: 1, quantidade_litros: '30',
      data_operacional: '2027-06-09', medidor_leitura: '35300',
    }));
    const a4 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, {
      ...cam, tipo_combustivel_id: s.comb.ETANOL, produto_id: s.etanol.id, conversao_id: s.fator.etanol.id, conversao_versao: 1, quantidade_litros: '10',
      data_operacional: '2027-06-12', medidor_leitura: '35400', tanque_cheio: false,
    }));
    await A.ok(A.cancelar(s.contaCancelar.token, a2.id, { empresa_id: s.e1.id, ...cancelarCorpo() }));
    const ids = async (extra) => (await A.ok(A.lista(s.leitor.token, s.e1.id, extra))).items.map((i) => i.id);

    const tudo = await A.ok(A.lista(s.leitor.token, s.e1.id));
    assert.deepEqual([tudo.total, tudo.has_more, tudo.next_cursor, tudo.items.map((i) => i.id)], [4, false, null, [a4.id, a3.id, a2.id, a1.id]]);
    const r3 = tudo.items[1];
    assert.deepEqual(Object.keys(r3).sort(), [
      'bem', 'created_date', 'custo_total', 'data_operacional', 'id', 'kg_por_litro', 'local_estoque', 'medidor', 'numero', 'produto', 'quantidade_kg', 'quantidade_litros',
      'referencia_externa', 'status', 'tanque', 'tanque_cheio', 'tipo_combustivel', 'updated_date', 'versao',
    ]);
    assert.deepEqual([r3.tipo_combustivel.nome, r3.produto, r3.tanque.id, r3.medidor, r3.kg_por_litro, r3.quantidade_kg],
      ['Gasolina', { id: s.gasolina.id, nome: 'Gasolina comum' }, cam.tanque_id, { tipo: 'ODOMETRO', unidade: 'km', leitura: '35300.0000' }, '0.745000', '22.3500']);
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
    assert.deepEqual([d3.fatias.map((f) => [f.lote_id, f.quantidade_kg]), d3.estorno, d3.cancelamento, d3.consumo.metrica, d3.consumo.metodologia.startsWith('Método do tanque cheio')],
      [[[s.lotes.gasolina.id, '22.3500']], null, null, 'KM_POR_LITRO', true]);
    assert.deepEqual(erro(await A.detalhe(s.leitor.token, 'nao-existe', s.e1.id)).slice(0, 2), [404, 'ABASTECIMENTO_NAO_ENCONTRADO']);
  });

  test('AB16: opções — bens (formulário × filtro), tanques (leitura vigente), tipos (só L ativos), produtos (com conversão), produtos-filtro e locais (saldo da empresa)', async () => {
    const s = await montarAbastecimento(app);
    const tok = s.operador.token;
    const q = `empresa_id=${s.e1.id}`;
    const nomes = (r) => r.itens.map((i) => i.nome);
    const impl = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoImplemento(s)), 201);
    const reserva = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, { nome: 'Trator TP-03 reserva', codigo_frota: 'TP-03' })), 201);
    await A.ok(A.req('PATCH', `/bens-patrimoniais/${reserva.id}`, s.token, { empresa_id: s.e1.id, versao: reserva.versao, tanques: [itemTanque(reserva.tanques[0], { ativo: false })] }));
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

    // tanques + leitura vigente (cadastro → abastecimento)
    const t0 = await A.ok(A.opcoes(tok, 'tanques', `${q}&bem_id=${s.trator.id}`));
    assert.deepEqual(t0.itens, [{ id: s.trator.tanques[0].id, identificador: 'Tanque principal', capacidade_litros: '180.0000', combustiveis: [{ id: s.comb.DIESEL_S10, codigo: 'DIESEL_S10', nome: 'Diesel S10' }] }]);
    assert.deepEqual(t0.bem.leitura_vigente, { leitura: '1520.5000', data: '2027-06-01', origem: 'CADASTRO', abastecimento_id: null, numero: null });
    const d = await A.confirmarOk(tok, corpoAbastecimento(s));
    const t1 = await A.ok(A.opcoes(tok, 'tanques', `${q}&bem_id=${s.trator.id}`));
    assert.deepEqual(t1.bem.leitura_vigente, { leitura: '1550.5000', data: '2027-06-10', origem: 'ABASTECIMENTO', abastecimento_id: d.id, numero: d.numero });
    assert.deepEqual((await A.ok(A.opcoes(tok, 'tanques', `${q}&bem_id=${reserva.id}`))).itens, [], 'tanque inativo fora');
    assert.equal((await A.ok(A.opcoes(tok, 'tanques', `${q}&bem_id=${s.gerador.id}`))).bem.leitura_vigente, null, 'sem medidor: sem leitura');
    assert.deepEqual(erro(await A.opcoes(tok, 'tanques', `empresa_id=${s.e2.id}&bem_id=${s.trator.id}`)).slice(0, 2), [404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO']);

    // tipos: só litro e ativos (GNV fora; inativado sai)
    const tipos = async () => (await A.ok(A.opcoes(tok, 'tipos', ''))).itens.map((t) => t.codigo);
    assert.deepEqual(await tipos(), ['DIESEL_S10', 'DIESEL_S500', 'ETANOL', 'GASOLINA']);
    const s500 = await prisma().tipoCombustivel.findUnique({ where: { id: s.comb.DIESEL_S500 } });
    await A.ok(A.req('PATCH', `/patrimonio-combustiveis/${s.comb.DIESEL_S500}`, s.token, { versao: s500.versao, ativo: false }));
    assert.deepEqual(await tipos(), ['DIESEL_S10', 'ETANOL', 'GASOLINA']);
    const cam = await A.ok(A.opcoes(tok, 'tanques', `${q}&bem_id=${s.caminhonete.id}`));
    assert.deepEqual(cam.itens[0].combustiveis.map((c) => c.nome), ['Etanol', 'Gasolina']);

    // produtos do tipo, com a conversão vigente (ou null)
    const prods = async (tipo) => (await A.ok(A.opcoes(tok, 'produtos', `${q}&tipo_combustivel_id=${tipo}`))).itens;
    assert.deepEqual(await prods(s.comb.DIESEL_S10), [{ id: s.diesel.id, nome: 'Diesel S10 granel', codigo_interno: null, unidade_principal_estoque: 'KG', conversao: { id: s.fator.diesel.id, versao: 1, sequencia: 1, kg_por_litro: '0.840000' } }]);
    assert.deepEqual((await prods(s.comb.DIESEL_S500)).map((p) => [p.id, p.unidade_principal_estoque, p.conversao]), [[s.oleoLitro.id, 'L', null]]);
    await A.ok(A.req('PATCH', `/produtos/${s.etanol.id}`, s.token, { ativo: false }));
    assert.deepEqual(await prods(s.comb.ETANOL), [], 'produto inativo fora do formulário');
    const pf = await A.ok(A.opcoes(tok, 'produtos-filtro', q));
    assert.deepEqual(pf.itens.map((p) => p.id).sort(), [s.diesel.id, s.etanol.id, s.gasolina.id, s.oleoLitro.id].sort(), 'o filtro inclui o inativo; nunca o da F2');

    // locais com saldo do produto (local inativo fora; produto de outra fazenda 404)
    await s.lote(s.e1, s.diesel, s.localInativo, { kg: '10.0000', custo: '5.0000', dia: '2027-06-02' });
    await s.lote(s.e1, s.diesel, s.local2, { kg: '5.0000', custo: '5.0000', dia: '2027-06-02' });
    const loc = await A.ok(A.opcoes(tok, 'locais', `${q}&produto_id=${s.diesel.id}`));
    assert.deepEqual(loc.itens, [
      { local_estoque_id: s.local2.id, local_nome: s.local2.nome, disponivel_kg: '5.0000' },
      { local_estoque_id: s.local.id, local_nome: s.local.nome, disponivel_kg: '82.8000' },
    ]);
    assert.deepEqual(erro(await A.opcoes(tok, 'locais', `${q}&produto_id=${s.diesel2.id}`)), [404, 'PRODUTO_NOT_FOUND', 'produto_id', 'produto_nao_encontrado']);
    const loc2 = await A.ok(A.opcoes(tok, 'locais', `empresa_id=${s.e2.id}&produto_id=${s.diesel2.id}`));
    assert.deepEqual(loc2.itens.map((l) => [l.local_estoque_id, l.disponivel_kg]), [[s.local.id, '500.0000']]);
  });
});

describe('P1-02 — permissões e isolamento', () => {
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

  test('S3/AB9 (parcial): outro tenant → 404 (abastecimento, bem, empresa, produto); a MESMA operation_id em outro tenant é operação nova', async () => {
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
    assert.deepEqual(erro(conf), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'inexistente']);
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
