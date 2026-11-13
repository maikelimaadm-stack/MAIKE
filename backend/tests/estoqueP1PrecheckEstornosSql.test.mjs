/**
 * MAIKE-ESTOQUE-P1-02 R1 — os SELECTs de pré-checagem do release, executados
 * EXATAMENTE como estão em `scripts/ops/sql-editor/`, numa transação READ ONLY
 * do PostgreSQL real (nunca em produção: GO pendente).
 *
 *  S1. dados limpos (2 abastecimentos CONFIRMADOS, um com duas fatias, e uma
 *      compra P3 CONFIRMADA) → só a linha 'NENHUM';
 *  S2. abastecimento com original de outro produto → ABASTECIMENTO /
 *      NOVA_RECUSA / vinculo_divergente (1 documento, o id dele); o cancelamento
 *      real pela API recusa com o MESMO motivo (o SQL concorda com o motor);
 *  S3. fatia de abastecimento em lote de outro local e lote da compra de outro
 *      produto → camada_divergente nas DUAS origens; fatias que não fecham →
 *      JA_RECUSAVA / fatias_inconsistentes;
 *  S4. a transação é READ ONLY (`transaction_read_only = on`, nunca commita) e
 *      o estado do banco é idêntico antes e depois; o precheck de unidades roda
 *      no mesmo regime.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoesAbastecimento, corpoAbastecimento, erro, montarAbastecimento, prisma } from './patrimonioP1AbastecimentoCenario.mjs';
import { estadoFisico } from './estoqueP1MCenario.mjs';

const sqlDe = (nome) => readFileSync(new URL(`../../scripts/ops/sql-editor/${nome}`, import.meta.url), 'utf8');
const ESTORNOS = sqlDe('estoque-p1-02-precheck-estornos-somente-leitura.sql');
const UNIDADES = sqlDe('estoque-p1-02-precheck-unidades-somente-leitura.sql');

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoesAbastecimento>} */
let A;
before(async () => {
  app = await criarApp();
  await app.ready();
  await limparBanco();
  A = acoesAbastecimento(app);
});
after(async () => {
  await app.close();
  await encerrar();
});

/**
 * Roda o SQL numa transação READ ONLY (conferida por `SHOW
 * transaction_read_only` DEPOIS do SELECT) que nunca commita.
 * @returns {Promise<any[]>}
 */
const rodarSomenteLeitura = async (sql) => {
  /** @type {any[]} */
  let linhas = [];
  let modo = '';
  await prisma().$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    linhas = await tx.$queryRawUnsafe(sql);
    modo = /** @type {any[]} */ (await tx.$queryRawUnsafe('SHOW transaction_read_only'))[0].transaction_read_only;
    throw new Error('rollback'); // nunca commita
  }).catch((x) => {
    if (x?.message !== 'rollback') throw x;
  });
  assert.equal(modo, 'on', 'a transação do precheck é READ ONLY');
  return linhas;
};

/** Linhas do precheck em forma comparável. */
const resumo = (linhas) => linhas.map((l) => [l.origem, l.efeito, l.motivo, Number(l.documentos)]);

describe('Precheck dos estornos (FINANCEIRO + ABASTECIMENTO), somente leitura', () => {
  test('S1–S4: limpo → NENHUM; adulterações aparecem na origem e no motivo certos, de acordo com o motor; nada é escrito', async () => {
    const s = await montarAbastecimento(app);
    const compra = await s.compraP3(s.e1, s.diesel, s.local2, { quantidade: '100.0000', preco: '5.00' });
    const a1 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s)); // 80 L: 50 do lote A + 30 do B
    assert.equal(a1.fatias.length, 2, 'abastecimento limpo com duas fatias');
    const a2 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade: '10', medidor_leitura: '1560', tanque_cheio: false }));

    // S1 — limpo
    const foto0 = await estadoFisico(prisma(), s.c);
    assert.deepEqual(resumo(await rodarSomenteLeitura(ESTORNOS)), [['NENHUM', '-', 'nenhum documento confirmado (financeiro ou abastecimento) seria recusado pelos estornos', 0]]);
    assert.equal(await estadoFisico(prisma(), s.c), foto0, 'S1: nada escrito');

    // S2 — original do abastecimento a2 de outro produto
    await prisma().$executeRaw`UPDATE "MovimentacaoEstoque" SET produto_id = ${s.gasolina.id} WHERE id = ${a2.movimentacao.id}`;
    const s2 = await rodarSomenteLeitura(ESTORNOS);
    assert.deepEqual(resumo(s2), [['ABASTECIMENTO', 'NOVA_RECUSA', 'vinculo_divergente', 1]]);
    assert.deepEqual(s2[0].exemplos, [a2.id]);
    assert.equal(s2[0].cliente_id, s.c);
    const cancel = await A.cancelar(s.contaCancelar.token, a2.id, { empresa_id: s.e1.id, versao: a2.versao, motivo: 'precheck', operation_id: `p102-${a2.id}` });
    assert.deepEqual(erro(cancel), [409, 'ABASTECIMENTO_CANCELAMENTO_BLOQUEADO', 'abastecimento', 'vinculo_divergente'], 'o motor concorda com o SQL');
    await prisma().$executeRaw`UPDATE "MovimentacaoEstoque" SET produto_id = ${s.diesel.id} WHERE id = ${a2.movimentacao.id}`;

    // S3 — camada de uma fatia de a1 em outro local; lote da compra de outro produto; fatias de a2 não fecham
    const loteFatia = a1.fatias[1].lote_id;
    await prisma().$executeRaw`UPDATE "EstoqueLoteNota" SET local_estoque_id = ${s.local2.id} WHERE id = ${loteFatia}`;
    await prisma().$executeRaw`UPDATE "EstoqueLoteNota" SET produto_id = ${s.gasolina.id} WHERE id = ${compra.lote_id}`;
    await prisma().$executeRaw`UPDATE "AbastecimentoBemConsumoLote" SET quantidade = quantidade - 1 WHERE abastecimento_id = ${a2.id}`;
    const foto3 = await estadoFisico(prisma(), s.c);
    const s3 = await rodarSomenteLeitura(ESTORNOS);
    assert.deepEqual(resumo(s3), [
      ['ABASTECIMENTO', 'JA_RECUSAVA', 'fatias_inconsistentes', 1],
      // o lote movido é a 2ª fatia de a1 E a fatia de a2 (o FIFO de a2 continuou nele): os dois documentos
      ['ABASTECIMENTO', 'NOVA_RECUSA', 'camada_divergente', 2],
      ['FINANCEIRO', 'NOVA_RECUSA', 'camada_divergente', 1],
    ]);
    assert.deepEqual(a2.fatias.map((f) => f.lote_id), [loteFatia], 'a2 consumiu o mesmo lote da 2ª fatia de a1');
    assert.deepEqual(s3.map((l) => l.exemplos), [[a2.id], [a1.id, a2.id].sort(), [compra.operacao.id]]);
    assert.equal(await estadoFisico(prisma(), s.c), foto3, 'S3: nada escrito pelo precheck');

    // S4 — precheck de unidades no mesmo regime (sintaxe + execução READ ONLY)
    const u = await rodarSomenteLeitura(UNIDADES);
    assert.ok(Array.isArray(u) && u.length >= 1, 'o precheck de unidades devolve ao menos uma linha (NENHUM ou contagens)');
    assert.equal(await estadoFisico(prisma(), s.c), foto3, 'S4: nada escrito');
  });
});
