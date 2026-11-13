/**
 * MAIKE-ESTOQUE-P1-02 (D-PROD-177) — M5: o estorno confere o original e a
 * camada (contrato §2 M5; §6.2 item 8). PostgreSQL real; o motor é chamado
 * direto, em transações reais com a trava canônica do produto. Estados
 * "impossíveis pelo protocolo" (original adulterado, camada de outra
 * empresa/produto/local) são montados por UPDATE direto no setup.
 *
 *  I1. duplo estorno: compra → 2º recusa `lote_consumido`; venda → 2º recusa
 *      `original_ja_estornado`; o mesmo original em dois itens do lote → o 2º
 *      recusa `original_ja_estornado`; nada muda;
 *  I2. original não 'Ativa' (`original_nao_ativo`), 'Estornada' sem filho e
 *      'Ativa' com `movimento_filho_id` (`original_ja_estornado`), original
 *      inexistente (404), de outra empresa/produto (`vinculo_divergente`);
 *  I3. camada adulterada (empresa, produto, local) → `camada_divergente` sem
 *      dados da camada nos details (compra e venda no lote; `estornarEntrada`);
 *  I4. outra empresa no estorno e outro tenant: recusa sem oráculo e sem
 *      escrita em NENHUM tenant;
 *  I5. rollback total: um item ruim no meio de três → nada muda (recusa antes
 *      de escrever); e o CAS do original (alterado entre a leitura e a
 *      marcação, por gatilho na própria transação) → 409 CONCURRENCY_CONFLICT
 *      `original_alterado` DEPOIS das escritas, tudo desfeito;
 *  I6. `estornarEntrada` e `estornarSaida`: as mesmas guardas e o mesmo CAS;
 *  I7. R1 corretiva: `estornarSaida` (caminho do cancelamento de abastecimento)
 *      confere o vínculo do original (empresa/produto) e cada camada das fatias
 *      (empresa/produto/local, lida FOR UPDATE) ANTES de escrever; várias
 *      fatias voltam cada uma ao seu lote.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { montarTenant, prisma } from './gestaoP3Cenario.mjs';
import {
  D, OPCOES_TX, argsEstornoEmLote, argsEstornoEntrada, conferirInvariantes, ctxDe, entrar, estadoFisico, estornarLote, estornarUmaEntrada, itemDaEntrada,
  itemDaSaida, localDe, q4, recusaAntesDeEscrever, resumoErro, sairFifo,
} from './estoqueP1MCenario.mjs';
import * as motor from '../src/modules/estoqueFisico/estoqueFisicoMotor.js';

/** @type {import('fastify').FastifyInstance} */
let app;
before(async () => {
  app = await criarApp();
  await app.ready();
  await limparBanco();
});
after(async () => {
  await app.close();
  await encerrar();
});

const lote = (id) => prisma().estoqueLoteNota.findUnique({ where: { id } });
const movimento = (id) => prisma().movimentacaoEstoque.findUnique({ where: { id } });
const alterarMovimento = (id, data) => prisma().movimentacaoEstoque.update({ where: { id }, data });
const alterarLote = (id, data) => prisma().estoqueLoteNota.update({ where: { id }, data });
const JA = 'ESTOQUE_JA_CONSUMIDO';

/** Recusa do estorno em lote (antes de escrever) → [status, code, field, reason] + details. */
const recusaEmLote = async (s, e, itens, extra = {}, ctxS = s) => {
  const erro = await recusaAntesDeEscrever(ctxS, e.id, itens.map((i) => i.produto_id), (tx) => motor.estornarEmLote(tx, ctxDe(ctxS), argsEstornoEmLote(s, e, itens, extra)));
  return { r: resumoErro(erro), details: erro?.details ?? null, erro };
};
/** Recusa de `estornarEntrada` (antes de escrever). */
const recusaEntrada = async (s, e, r, extra = {}, produtoId = r.lote.produto_id) => {
  const erro = await recusaAntesDeEscrever(s, e.id, [produtoId], async (tx) => {
    const produto = await tx.produto.findUnique({ where: { id: produtoId } });
    await motor.estornarEntrada(tx, ctxDe(s), argsEstornoEntrada(s, e, r, produto, extra));
  });
  return { r: resumoErro(erro), details: erro?.details ?? null, erro };
};
/** Argumentos de `estornarSaida` a partir do resultado de `sairFifo`. */
const argsEstornoSaida = (s, e, v, produto, extra = {}) => ({
  empresaId: e.id,
  item: { ordem: 1, quantidade_estoque: v.movimento.quantidade, movimentacao_estoque_id: v.movimento.id },
  consumos: v.fatias.map((f) => ({ estoque_lote_nota_id: f.lote_id, quantidade: f.quantidade })),
  produto, local: localDe(s.local), dia: '2027-06-12', parceiro: { id: e.cli.id, nome: e.cli.nome },
  origem: { operacaoId: 'op-venda-p102' }, numeroMovimento: motor.numeroMovimentoProvisorio(), ...extra,
});
const recusaSaida = async (s, e, v, produtoId) => {
  const erro = await recusaAntesDeEscrever(s, e.id, [produtoId], async (tx) => {
    const produto = await tx.produto.findUnique({ where: { id: produtoId } });
    await motor.estornarSaida(tx, ctxDe(s), argsEstornoSaida(s, e, v, produto));
  });
  return { r: resumoErro(erro), details: erro?.details ?? null };
};

// ─── gatilho que altera o original DENTRO da transação do estorno (CAS) ─────
const GATILHO = 'p102m5_altera_original';
/**
 * Depois do INSERT do movimento de estorno filho de `originalId`, o gatilho
 * muda o original (status ou filho) na MESMA transação — o "escritor fora do
 * protocolo" entre a leitura sob trava e a marcação. Sempre removido no fim.
 */
const comOriginalAlterado = async (s, originalId, modo, fn) => {
  const p = prisma();
  const set = modo === 'status' ? `status = 'Cancelada'` : `movimento_filho_id = NEW.id`;
  await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${GATILHO}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
    UPDATE "MovimentacaoEstoque" SET ${set} WHERE cliente_id = NEW.cliente_id AND id = NEW.movimento_pai_id; RETURN NULL; END $f$`);
  try {
    await p.$executeRawUnsafe(`CREATE TRIGGER ${GATILHO} AFTER INSERT ON "MovimentacaoEstoque" FOR EACH ROW
      WHEN (NEW.cliente_id = '${s.c}' AND NEW.movimento_pai_id = '${originalId}') EXECUTE FUNCTION ${GATILHO}()`);
    return await fn();
  } finally {
    await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${GATILHO} ON "MovimentacaoEstoque"`);
    await p.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${GATILHO}()`);
  }
};

describe('I1 — duplo estorno e original repetido', () => {
  test('compra: 2º estorno → 409 lote_consumido; venda: 2º → 409 original_ja_estornado; o mesmo original em dois itens → o 2º recusa original_ja_estornado; nada muda nas recusas', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const c = await entrar(s, e, e.sal);
    await estornarLote(s, e, [itemDaEntrada(c)], { direcao: 'PAGAR' });
    const dupla = await recusaEmLote(s, e, [itemDaEntrada(c)], { direcao: 'PAGAR' });
    assert.deepEqual(dupla.r, [409, JA, 'itens', 'lote_consumido']);
    assert.equal(dupla.details.status, 'Estornado');

    const c2 = await entrar(s, e, e.sal);
    const v = await sairFifo(s, e, e.sal, '3.0000');
    await estornarLote(s, e, [itemDaSaida(v, e.sal, s.local)], { direcao: 'RECEBER' });
    const duplaVenda = await recusaEmLote(s, e, [itemDaSaida(v, e.sal, s.local)], { direcao: 'RECEBER' });
    assert.deepEqual(duplaVenda.r, [409, JA, 'itens', 'original_ja_estornado']);
    assert.deepEqual([duplaVenda.details.item_ordem, duplaVenda.details.indice, duplaVenda.details.colecao], [1, 0, 'itens']);
    assert.equal(q4((await lote(c2.lote.id)).quantidade_disponivel), '10.0000', 'a devolução não foi aplicada duas vezes');

    // mesmo original em dois itens (compra: lotes diferentes, o 2º aponta o original do 1º)
    const c3 = await entrar(s, e, e.sal);
    const c4 = await entrar(s, e, e.sal);
    const repetido = await recusaEmLote(s, e, [itemDaEntrada(c3, 1), itemDaEntrada(c4, 2, { movimentacao_estoque_id: c3.movimento.id })], { direcao: 'PAGAR' });
    assert.deepEqual(repetido.r, [409, JA, 'itens', 'original_ja_estornado']);
    assert.equal(repetido.details.item_ordem, 2);
    // venda: o mesmo item duas vezes
    const v2 = await sairFifo(s, e, e.sal, '2.0000');
    const vendaRepetida = await recusaEmLote(s, e, [itemDaSaida(v2, e.sal, s.local, 1), itemDaSaida(v2, e.sal, s.local, 2)], { direcao: 'RECEBER' });
    assert.deepEqual(vendaRepetida.r, [409, JA, 'itens', 'original_ja_estornado']);
    assert.equal(vendaRepetida.details.item_ordem, 2);
    await conferirInvariantes(s, 'I1');
  });
});

describe('I2 — o original tem de estar Ativa, sem filho e ser do produto e da empresa', () => {
  test('não Ativa → original_nao_ativo; Estornada sem filho e Ativa com filho → original_ja_estornado; inexistente → 404; outra empresa/produto → vinculo_divergente (lote e estornarEntrada); nada muda', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const outro = await entrar(s, e, e.sal); // movimento existente para servir de "filho"
    const casos = [
      ['Cancelada', { status: 'Cancelada' }, 'original_nao_ativo'],
      ['Pendente', { status: 'Pendente' }, 'original_nao_ativo'],
      ['Estornada sem filho', { status: 'Estornada' }, 'original_ja_estornado'],
      ['Ativa com filho', { movimento_filho_id: outro.movimento.id }, 'original_ja_estornado'],
      ['outra empresa', { empresa_id: s.e2.id }, 'vinculo_divergente'],
      ['outro produto', { produto_id: e.milho.id }, 'vinculo_divergente'],
    ];
    for (const [rotulo, data, reason] of casos) {
      const c = await entrar(s, e, e.sal);
      await alterarMovimento(c.movimento.id, data);
      const emLote = await recusaEmLote(s, e, [itemDaEntrada(c)], { direcao: 'PAGAR' });
      assert.deepEqual(emLote.r, [409, JA, 'itens', reason], `lote: ${rotulo}`);
      const umaEntrada = await recusaEntrada(s, e, c);
      assert.deepEqual(umaEntrada.r, [409, JA, 'itens', reason], `estornarEntrada: ${rotulo}`);
      assert.equal((await lote(c.lote.id)).status, 'Disponivel', `${rotulo}: lote intocado`);
      // desfaz a adulteração e o estorno correto passa (prova que a recusa era só do original)
      await alterarMovimento(c.movimento.id, { status: 'Ativa', movimento_filho_id: null, empresa_id: e.id, produto_id: e.sal.id });
      await estornarLote(s, e, [itemDaEntrada(c)], { direcao: 'PAGAR' });
    }
    // original inexistente
    const c = await entrar(s, e, e.sal);
    const semOriginal = await recusaEmLote(s, e, [itemDaEntrada(c, 1, { movimentacao_estoque_id: 'nao-existe-p102' })], { direcao: 'PAGAR' });
    assert.deepEqual(semOriginal.r, [404, 'MOVIMENTACAO_ESTOQUE_NOT_FOUND', null, null]);
    const semOriginal2 = await recusaEntrada(s, e, { ...c, movimento: { ...c.movimento, id: 'nao-existe-p102' } });
    assert.deepEqual(semOriginal2.r, [404, 'MOVIMENTACAO_ESTOQUE_NOT_FOUND', null, null]);
    // venda: original Cancelada → original_nao_ativo (o vínculo de estornarSaida é provado no I7)
    const v = await sairFifo(s, e, e.sal, '1.0000');
    await alterarMovimento(v.movimento.id, { status: 'Cancelada' });
    assert.deepEqual((await recusaEmLote(s, e, [itemDaSaida(v, e.sal, s.local)], { direcao: 'RECEBER' })).r, [409, JA, 'itens', 'original_nao_ativo']);
    assert.deepEqual((await recusaSaida(s, e, v, e.sal.id)).r, [409, JA, 'itens', 'original_nao_ativo']);
    await alterarMovimento(v.movimento.id, { status: 'Ativa' });
    await conferirInvariantes(s, 'I2');
  });
});

describe('I3 — camada adulterada', () => {
  test('lote de outra empresa/produto/local → camada_divergente (compra no lote, venda no lote, estornarEntrada); details só com ids da linha; nada muda', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const CHAVES = ['colecao', 'field', 'indice', 'item_ordem', 'lote_id', 'reason'];
    const adulteracoes = [
      ['empresa', { empresa_id: s.e2.id }],
      ['produto', { produto_id: e.milho.id }],
      ['local', { local_estoque_id: s.local2.id }],
    ];
    for (const [rotulo, data] of adulteracoes) {
      // compra
      const c = await entrar(s, e, e.sal);
      await alterarLote(c.lote.id, data);
      const emLote = await recusaEmLote(s, e, [itemDaEntrada(c)], { direcao: 'PAGAR' });
      assert.deepEqual(emLote.r, [409, JA, 'itens', 'camada_divergente'], `compra no lote: ${rotulo}`);
      assert.deepEqual(Object.keys(emLote.details).sort(), CHAVES, `${rotulo}: nada da camada divergente nos details`);
      assert.deepEqual([emLote.details.lote_id, emLote.details.item_ordem, emLote.details.indice], [c.lote.id, 1, 0]);
      const umaEntrada = await recusaEntrada(s, e, c);
      assert.deepEqual(umaEntrada.r, [409, JA, 'itens', 'camada_divergente'], `estornarEntrada: ${rotulo}`);
      assert.deepEqual(Object.keys(umaEntrada.details).sort(), CHAVES);
      await alterarLote(c.lote.id, { empresa_id: e.id, produto_id: e.sal.id, local_estoque_id: s.local.id });
      await estornarLote(s, e, [itemDaEntrada(c)], { direcao: 'PAGAR' });

      // venda: a camada de um consumo adulterada
      const cv = await entrar(s, e, e.sal);
      const v = await sairFifo(s, e, e.sal, '4.0000');
      assert.deepEqual(v.fatias.map((f) => f.lote_id), [cv.lote.id]);
      await alterarLote(cv.lote.id, data);
      const venda = await recusaEmLote(s, e, [itemDaSaida(v, e.sal, s.local)], { direcao: 'RECEBER' });
      assert.deepEqual(venda.r, [409, JA, 'itens', 'camada_divergente'], `venda no lote: ${rotulo}`);
      assert.deepEqual(Object.keys(venda.details).sort(), CHAVES);
      assert.equal(venda.details.lote_id, cv.lote.id);
      await alterarLote(cv.lote.id, { empresa_id: e.id, produto_id: e.sal.id, local_estoque_id: s.local.id });
      await estornarLote(s, e, [itemDaSaida(v, e.sal, s.local)], { direcao: 'RECEBER' });
      await estornarLote(s, e, [itemDaEntrada(cv)], { direcao: 'PAGAR' });
    }
    await conferirInvariantes(s, 'I3');
  });
});

describe('I4 — outra empresa e outro tenant', () => {
  test('estorno com a empresa errada → camada_divergente; outro tenant com ids alheios → lote_inexistente / 404 sem oráculo; nenhum tenant muda', async () => {
    const s = await montarTenant(app);
    const b = await montarTenant(app);
    const e = s.e1;
    const c = await entrar(s, e, e.sal);
    const v = await sairFifo(s, e, e.sal, '2.0000');
    const fotoS = await estadoFisico(prisma(), s.c);

    // a empresa E2 do mesmo tenant tentando estornar a compra da E1
    const outraEmpresa = await recusaEmLote(s, s.e2, [itemDaEntrada(c)], { direcao: 'PAGAR' });
    assert.deepEqual(outraEmpresa.r, [409, JA, 'itens', 'camada_divergente']);
    const outraEmpresaVenda = await recusaEmLote(s, s.e2, [itemDaSaida(v, e.sal, s.local)], { direcao: 'RECEBER' });
    assert.deepEqual(outraEmpresaVenda.r, [409, JA, 'itens', 'vinculo_divergente'], 'venda: o original da E1 não serve à E2');
    const outraEmpresaEntrada = await recusaEntrada(s, s.e2, c);
    assert.deepEqual(outraEmpresaEntrada.r, [409, JA, 'itens', 'camada_divergente']);

    // tenant B com ids do tenant A
    const compraB = await recusaEmLote(s, b.e1, [itemDaEntrada(c)], { direcao: 'PAGAR' }, b);
    assert.deepEqual(compraB.r, [409, JA, 'itens', 'lote_inexistente']);
    assert.deepEqual(Object.keys(compraB.details).sort(), ['colecao', 'field', 'indice', 'item_ordem', 'lote_id', 'reason'], 'só o id que o próprio chamador mandou');
    const vendaB = await recusaEmLote(s, b.e1, [itemDaSaida(v, e.sal, s.local)], { direcao: 'RECEBER' }, b);
    assert.deepEqual(vendaB.r, [404, 'MOVIMENTACAO_ESTOQUE_NOT_FOUND', null, null]);
    const erroEntradaB = await recusaAntesDeEscrever(b, b.e1.id, [e.sal.id], async (tx) => {
      await motor.estornarEntrada(tx, ctxDe(b), argsEstornoEntrada(b, b.e1, c, { ...e.sal, empresa_id: b.e1.id }));
    });
    assert.deepEqual(resumoErro(erroEntradaB), [409, JA, 'itens', 'lote_inexistente']);
    // o mesmo corpo de um id que não existe (sem oráculo)
    const inexistente = await recusaEmLote(b, b.e1, [itemDaEntrada(c, 1, { estoque_lote_nota_id: 'lote-inexistente-p102' })], { direcao: 'PAGAR' });
    assert.deepEqual({ ...inexistente.details, lote_id: null }, { ...compraB.details, lote_id: null });
    assert.equal(inexistente.erro.message, compraB.erro.message);
    assert.equal(await estadoFisico(prisma(), s.c), fotoS, 'o tenant A não mudou');
    await conferirInvariantes(s, 'I4');
    await conferirInvariantes(b, 'I4-B');
  });
});

describe('I5 — rollback total e CAS do original', () => {
  test('três itens, o 3º com camada adulterada → nada muda (recusa antes de escrever); depois, o 2º original alterado entre a leitura e a marcação → 409 CONCURRENCY_CONFLICT original_alterado e TUDO desfeito (lotes, movimentos, cache, números)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const c1 = await entrar(s, e, e.sal);
    const c2 = await entrar(s, e, e.milho);
    const c3 = await entrar(s, e, e.sal, { quantidadeKg: '5.0000', valorTotal: '12.5000' });
    await alterarLote(c3.lote.id, { local_estoque_id: s.local2.id });
    const itens = () => [itemDaEntrada(c1, 1), itemDaEntrada(c2, 2), itemDaEntrada(c3, 3)];
    const ruim = await recusaEmLote(s, e, itens(), { direcao: 'PAGAR' });
    assert.deepEqual(ruim.r, [409, JA, 'itens', 'camada_divergente']);
    assert.equal(ruim.details.item_ordem, 3);
    await alterarLote(c3.lote.id, { local_estoque_id: s.local.id });

    for (const modo of ['status', 'filho']) {
      const antes = await estadoFisico(prisma(), s.c);
      const erro = await comOriginalAlterado(s, c2.movimento.id, modo, () => estornarLote(s, e, itens(), { direcao: 'PAGAR' }).then(() => null, (x) => x));
      assert.deepEqual(resumoErro(erro), [409, 'CONCURRENCY_CONFLICT', 'itens', 'original_alterado'], `${modo}: ${erro?.message}`);
      assert.deepEqual([erro.details.originais, erro.details.marcados], [3, 2]);
      assert.equal(await estadoFisico(prisma(), s.c), antes, `${modo}: lotes, movimentos, cache e sequência desfeitos`);
    }
    // sem o gatilho, o mesmo lote passa inteiro
    const ids = await estornarLote(s, e, itens(), { direcao: 'PAGAR' });
    assert.equal(ids.length, 3);
    for (const [r, id] of [[c1, ids[0]], [c2, ids[1]], [c3, ids[2]]]) {
      assert.deepEqual([(await movimento(r.movimento.id)).status, (await movimento(r.movimento.id)).movimento_filho_id, (await lote(r.lote.id)).status], ['Estornada', id, 'Estornado']);
    }
    await conferirInvariantes(s, 'I5');
  });
});

describe('I6 — estornarEntrada e estornarSaida: guardas e CAS', () => {
  test('estornarEntrada: duplo → lote_consumido; lote inexistente; CAS do original → original_alterado (tudo desfeito); estornarSaida: duplo → original_ja_estornado; CAS → original_alterado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const c = await entrar(s, e, e.sal);
    await estornarUmaEntrada(s, e, c);
    assert.deepEqual([(await movimento(c.movimento.id)).status, (await lote(c.lote.id)).status], ['Estornada', 'Estornado']);
    assert.deepEqual((await recusaEntrada(s, e, c)).r, [409, JA, 'itens', 'lote_consumido']);
    assert.deepEqual((await recusaEntrada(s, e, { ...c, lote: { ...c.lote, id: 'lote-que-nao-existe' } })).r, [409, JA, 'itens', 'lote_inexistente']);

    for (const modo of ['status', 'filho']) {
      const c2 = await entrar(s, e, e.sal);
      const antes = await estadoFisico(prisma(), s.c);
      const erro = await comOriginalAlterado(s, c2.movimento.id, modo, () => estornarUmaEntrada(s, e, c2).then(() => null, (x) => x));
      assert.deepEqual(resumoErro(erro), [409, 'CONCURRENCY_CONFLICT', 'itens', 'original_alterado'], `entrada ${modo}: ${erro?.message}`);
      assert.equal(erro.details.movimento_id, c2.movimento.id);
      assert.equal(await estadoFisico(prisma(), s.c), antes, `entrada ${modo}: tudo desfeito`);
      await estornarUmaEntrada(s, e, c2);
    }

    const cv = await entrar(s, e, e.sal);
    const estornarVenda = (v) => prisma().$transaction(async (tx) => {
      await motor.travarProdutosEstoque(tx, s.c, e.id, [e.sal.id]);
      const produto = await tx.produto.findUnique({ where: { id: e.sal.id } });
      const res = await motor.estornarSaida(tx, ctxDe(s), argsEstornoSaida(s, e, v, produto));
      await motor.numerarMovimentos(tx, s.c, [res.movimento.id]);
      return res;
    }, OPCOES_TX);
    const v = await sairFifo(s, e, e.sal, '3.0000');
    await estornarVenda(v);
    assert.deepEqual((await recusaSaida(s, e, v, e.sal.id)).r, [409, JA, 'itens', 'original_ja_estornado']);
    assert.equal(q4((await lote(cv.lote.id)).quantidade_disponivel), '10.0000');
    for (const modo of ['status', 'filho']) {
      const v2 = await sairFifo(s, e, e.sal, '1.5000');
      const antes = await estadoFisico(prisma(), s.c);
      const erro = await comOriginalAlterado(s, v2.movimento.id, modo, () => estornarVenda(v2).then(() => null, (x) => x));
      assert.deepEqual(resumoErro(erro), [409, 'CONCURRENCY_CONFLICT', 'itens', 'original_alterado'], `saída ${modo}: ${erro?.message}`);
      assert.equal(await estadoFisico(prisma(), s.c), antes, `saída ${modo}: devolução ao lote e cache desfeitos`);
      await estornarVenda(v2);
    }
    await conferirInvariantes(s, 'I6');
  });
});

describe('I7 — estornarSaida: vínculo do original e camada de cada fatia (R1 corretiva)', () => {
  test('original de outro produto/empresa → vinculo_divergente; fatia em lote de outra empresa/produto/local → camada_divergente; lote inexistente; nada muda; corrigido, devolve cada fatia ao seu lote', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    // Cada rodada acrescenta duas camadas de 10 kg; a saída FIFO de 14 kg consome a 1ª camada
    // ainda cheia (10) e 4 da seguinte. `a`/`b` são os lotes REAIS das fatias, não os recém-criados.
    const comLotes = async () => {
      await entrar(s, e, e.sal);
      await entrar(s, e, e.sal);
      const v = await sairFifo(s, e, e.sal, '14.0000');
      assert.equal(v.fatias.length, 2, 'a saída consome duas camadas');
      return { a: { lote: { id: v.fatias[0].lote_id } }, b: { lote: { id: v.fatias[1].lote_id } }, v };
    };
    // original adulterado (vínculo)
    for (const [rotulo, data] of [['outro produto', { produto_id: e.milho.id }], ['outra empresa', { empresa_id: s.e2.id }]]) {
      const { a, b, v } = await comLotes();
      await alterarMovimento(v.movimento.id, data);
      const r = await recusaSaida(s, e, v, e.sal.id);
      assert.deepEqual(r.r, [409, JA, 'itens', 'vinculo_divergente'], `original ${rotulo}`);
      assert.deepEqual([q4((await lote(a.lote.id)).quantidade_disponivel), q4((await lote(b.lote.id)).quantidade_disponivel)], ['0.0000', '6.0000'], `${rotulo}: lotes intocados`);
      assert.equal((await movimento(v.movimento.id)).status, 'Ativa', `${rotulo}: original intocado`);
      await alterarMovimento(v.movimento.id, { produto_id: e.sal.id, empresa_id: e.id });
      await estornarSaidaOk(s, e, v);
    }
    // camada adulterada (a SEGUNDA fatia: prova que a validação de todas vem antes da 1ª escrita)
    for (const [rotulo, data] of [['outra empresa', { empresa_id: s.e2.id }], ['outro produto', { produto_id: e.milho.id }], ['outro local', { local_estoque_id: s.local2.id }]]) {
      const { a, b, v } = await comLotes();
      await alterarLote(b.lote.id, data);
      const r = await recusaSaida(s, e, v, e.sal.id);
      assert.deepEqual(r.r, [409, JA, 'itens', 'camada_divergente'], `camada ${rotulo}`);
      assert.deepEqual(Object.keys(r.details).sort(), ['colecao', 'field', 'indice', 'item_ordem', 'lote_id', 'reason'], `${rotulo}: details só com ids da linha`);
      assert.equal(r.details.lote_id, b.lote.id);
      assert.equal(q4((await lote(a.lote.id)).quantidade_disponivel), '0.0000', `${rotulo}: a 1ª fatia NÃO foi devolvida`);
      await alterarLote(b.lote.id, { empresa_id: e.id, produto_id: e.sal.id, local_estoque_id: s.local.id });
      await estornarSaidaOk(s, e, v);
    }
    // fatia apontando para lote inexistente
    const { v } = await comLotes();
    const sumida = { ...v, fatias: [v.fatias[0], { ...v.fatias[1], lote_id: 'lote-que-nao-existe-p102' }] };
    assert.deepEqual((await recusaSaida(s, e, sumida, e.sal.id)).r, [409, JA, 'itens', 'lote_indisponivel_para_devolucao']);
    // estorno válido de duas fatias: cada uma volta ao SEU lote, original Estornada com filho, cache volta
    const antes = q4((await prisma().produto.findUnique({ where: { id: e.sal.id } })).estoque_atual);
    const res = await estornarSaidaOk(s, e, v);
    const lotes = await Promise.all(v.fatias.map((f) => lote(f.lote_id)));
    assert.deepEqual(lotes.map((l) => [q4(l.quantidade_disponivel), l.status]), [['10.0000', 'Disponivel'], ['10.0000', 'Disponivel']]);
    const orig = await movimento(v.movimento.id);
    assert.deepEqual([orig.status, orig.movimento_filho_id], ['Estornada', res.movimento.id]);
    assert.equal(q4((await prisma().produto.findUnique({ where: { id: e.sal.id } })).estoque_atual), D4(antes, '14'));
    await conferirInvariantes(s, 'I7');
  });

  test('outro tenant: a mesma chamada com ids alheios não lê nem escreve o tenant dono', async () => {
    const s = await montarTenant(app);
    const t = await montarTenant(app);
    const e = s.e1;
    await entrar(s, e, e.sal);
    const v = await sairFifo(s, e, e.sal, '3.0000');
    const fotoDono = await estadoFisico(prisma(), s.c);
    // o tenant `t` tenta estornar a saída do tenant `s` (ids de s, contexto de t)
    const r = await recusaAntesDeEscrever(t, t.e1.id, [t.e1.sal.id], async (tx) => {
      const produto = await tx.produto.findUnique({ where: { id: t.e1.sal.id } });
      await motor.estornarSaida(tx, ctxDe(t), { ...argsEstornoSaida(t, t.e1, v, produto), local: localDe(t.local) });
    });
    // fail-closed sem oráculo: para `t`, o original de `s` simplesmente não existe (o mesmo 404 de id inventado)
    assert.deepEqual(resumoErro(r), [404, 'MOVIMENTACAO_ESTOQUE_NOT_FOUND', null, null]);
    assert.equal(r.details ?? null, null, 'nada do tenant dono nos details');
    assert.equal(await estadoFisico(prisma(), s.c), fotoDono, 'tenant dono intocado');
  });
});

/** `estornarSaida` numa transação própria com a trava canônica. */
const estornarSaidaOk = (s, e, v) => prisma().$transaction(async (tx) => {
  await motor.travarProdutosEstoque(tx, s.c, e.id, [e.sal.id]);
  const produto = await tx.produto.findUnique({ where: { id: e.sal.id } });
  const res = await motor.estornarSaida(tx, ctxDe(s), argsEstornoSaida(s, e, v, produto));
  await motor.numerarMovimentos(tx, s.c, [res.movimento.id]);
  return res;
}, OPCOES_TX);
const D4 = (a, b) => D(a).plus(D(b)).toFixed(4);
