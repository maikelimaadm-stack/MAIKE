/**
 * D-PROD-261 (R-DEDUPE) — uma compra não entra no estoque duas vezes: pela Central
 * (lançamento com produtos) e pela entrada manual (Estoque → Novo movimento → Entrada).
 *
 * Regra escolhida pelo proprietário ("bloquear só se mexer no estoque"):
 *  - a Central recusa confirmar/retificar um lançamento COM produtos (mercadoria) cujo documento é o
 *    de uma entrada manual CONFIRMADA da mesma fazenda; sem produtos (só o pagamento), passa;
 *  - a entrada manual recusa um documento que já está num lançamento CONFIRMADO da Central COM
 *    produtos; o mesmo documento só no financeiro (sem produtos) não bloqueia mais;
 *  - a identidade do documento é o número normalizado (sem espaços nas pontas, maiúsculas) na fazenda;
 *  - as duas portas serializam pela mesma trava do documento (sem corrida que passe as duas).
 *
 * Tudo contra PostgreSQL real e HTTP autenticado.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, codigo, docAvista, docCom, fotoEstoque, montarTenant, motivo, prisma } from './gestaoP3Cenario.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoes>} */
let A;
before(async () => {
  app = await criarApp();
  await app.ready();
  A = acoes(app);
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const hoje = () => new Date().toISOString().slice(0, 10);

const cenario = async () => {
  const s = await montarTenant(app);
  const motivos = (await A.ok(A.req('GET', '/estoque/motivos-entrada', s.token))).items;
  const compra = motivos.find((m) => m.nome === 'Compra').id;
  return { s, e: s.e1, compra };
};

/** Entrada manual (Compra) de 10 kg de sal com o documento dado. */
const entradaReq = (x, documento, extra = {}) =>
  A.req('POST', '/estoque/entradas', x.s.token, {
    empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(), documento_numero: documento,
    itens: [{ produto_id: x.e.sal.id, local_estoque_id: x.s.local.id, unidade: 'KG', quantidade: '10', custo_unitario: '2' }],
    ...extra,
  });

const compraCom = (x, documento) => docCom(x.e, x.s.local, [{ produto: x.e.milho, quantidade: '100', valor_unitario: '1.50' }], { documento_referencia: documento });
const pagamentoSem = (x, documento) => docAvista(x.e, '20.00', { documento_referencia: documento });

describe('D-PROD-261 — Central: lançamento com produtos e documento de entrada manual', () => {
  test('entrada manual confirmada com NF-77 → a Central recusa confirmar a compra COM produtos (409, nada no estoque) e a prévia mostra o bloqueio', async () => {
    const x = await cenario();
    const ent = await entradaReq(x, 'NF-77');
    assert.equal(ent.statusCode, 201, ent.body);
    const rascunho = await A.criar(x.s.token, compraCom(x, ' nf-77 '));
    const prev = await A.previa(x.s.token, rascunho.id, x.e.id);
    assert.deepEqual(prev.bloqueios.map((b) => [b.code, b.reason ?? b.details?.reason]), [['OPERACAO_DOCUMENTO_DUPLICADO', 'documento_de_entrada_manual']]);
    const antes = await fotoEstoque(x.s.c);
    const r = await A.confirmarReq(x.s.token, rascunho, x.e.id);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(codigo(r), 'OPERACAO_DOCUMENTO_DUPLICADO');
    assert.equal(motivo(r), 'documento_de_entrada_manual');
    assert.equal(r.json().details?.entrada_numero ?? r.json().entrada_numero, ent.json().numero);
    assert.equal(await fotoEstoque(x.s.c), antes, 'nada mudou no estoque');
    const op = await prisma().operacaoFinanceira.findUnique({ where: { cliente_id_id: { cliente_id: x.s.c, id: rascunho.id } } });
    assert.equal(op.status, 'RASCUNHO');
  });

  test('o mesmo documento num lançamento SEM produtos (só o pagamento) passa', async () => {
    const x = await cenario();
    assert.equal((await entradaReq(x, 'NF-78')).statusCode, 201);
    const pago = await A.criarConfirmar(x.s.token, pagamentoSem(x, 'NF-78'));
    assert.equal(pago.status, 'CONFIRMADO');
  });

  test('entrada EXCLUÍDA libera o documento para a compra com produtos; outra fazenda não conflita', async () => {
    const x = await cenario();
    const ent = (await entradaReq(x, 'NF-79')).json();
    const outra = await A.criar(x.s.token, docCom(x.s.e2, x.s.local, [{ produto: x.s.e2.milho, quantidade: '10', valor_unitario: '1.00' }], { documento_referencia: 'NF-79' }));
    assert.equal((await A.confirmarReq(x.s.token, outra, x.s.e2.id)).statusCode, 200, 'outra fazenda');
    const ex = await A.req('POST', `/estoque/entradas/${ent.id}/excluir`, x.s.token, { empresa_id: x.e.id, versao: 1, motivo: 'vai pela Central', operation_id: `ex-${randomUUID()}` });
    assert.equal(ex.statusCode, 200, ex.body);
    const ok = await A.criarConfirmar(x.s.token, compraCom(x, 'NF-79'));
    assert.equal(ok.status, 'CONFIRMADO');
  });

  test('retificar um lançamento sem produtos para COM produtos com o documento de uma entrada manual → 409', async () => {
    const x = await cenario();
    assert.equal((await entradaReq(x, 'NF-80')).statusCode, 201);
    const pago = await A.criarConfirmar(x.s.token, docCom(x.e, x.s.local, [{ produto: x.e.milho, quantidade: '10', valor_unitario: '1.00' }], { documento_referencia: 'NF-81' }));
    const det = await A.detalhe(x.s.token, pago.id, x.e.id);
    const r = await A.req('POST', `/operacoes-financeiras/${pago.id}/retificar`, x.s.token, {
      ...compraCom(x, 'NF-80'), operation_id: `op-${randomUUID()}`, versao: det.versao, motivo: 'documento errado',
    });
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(motivo(r), 'documento_de_entrada_manual');
  });
});

describe('D-PROD-261 — Entrada manual: documento de lançamento da Central', () => {
  test('lançamento CONFIRMADO com produtos e NF-90 → a entrada manual com nf-90 é recusada (409 documento_de_compra)', async () => {
    const x = await cenario();
    await A.criarConfirmar(x.s.token, compraCom(x, 'NF-90'));
    const r = await entradaReq(x, ' nf-90 ');
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'ENTRADA_ESTOQUE_DOCUMENTO_CONFLITANTE');
    assert.equal(motivo(r), 'documento_de_compra');
  });

  test('lançamento CONFIRMADO SEM produtos com NF-91 → a entrada manual passa (o estoque entra só por ela)', async () => {
    const x = await cenario();
    await A.criarConfirmar(x.s.token, pagamentoSem(x, 'NF-91'));
    const r = await entradaReq(x, 'NF-91');
    assert.equal(r.statusCode, 201, r.body);
  });

  test('lançamento com produtos ainda em RASCUNHO ou CANCELADO não bloqueia a entrada', async () => {
    const x = await cenario();
    await A.criar(x.s.token, compraCom(x, 'NF-92'));
    assert.equal((await entradaReq(x, 'NF-92')).statusCode, 201);
    const c = await A.criarConfirmar(x.s.token, compraCom(x, 'NF-93'));
    const canc = await A.cancelarReq(x.s.token, c.id, x.e.id);
    assert.equal(canc.statusCode, 200, canc.body);
    assert.equal((await entradaReq(x, 'NF-93')).statusCode, 201);
  });
});

describe('D-PROD-261 — corrida: entrada manual e compra com produtos com o mesmo documento ao mesmo tempo', () => {
  test('só uma das duas grava; o estoque recebe uma vez só', async () => {
    const x = await cenario();
    for (let i = 0; i < 4; i++) {
      const doc = `NF-C${i}`;
      const rascunho = await A.criar(x.s.token, compraCom(x, doc));
      const [ent, conf] = await Promise.all([entradaReq(x, doc), A.confirmarReq(x.s.token, rascunho, x.e.id)]);
      const ok = [ent.statusCode === 201, conf.statusCode === 200].filter(Boolean).length;
      assert.equal(ok, 1, `rodada ${i}: entrada ${ent.statusCode} ${ent.body} / central ${conf.statusCode} ${conf.body}`);
    }
  });
});
