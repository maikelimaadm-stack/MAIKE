/**
 * D-PROD-160 — Patrimônio UX-02: cenário OBRIGATÓRIO A→B da missão (§D) —
 * trocar o Produto associado ao combustível vale só para o FUTURO.
 * PostgreSQL real, HTTP autenticado (`app.inject`), cenário `montarAbastecimento`
 * da P1-02 (trator TP-02: 1 tanque que aceita só Diesel S10; Produto A =
 * "Diesel S10 granel" em KG, fator (S10, A) 0,840000, lotes 50 kg a 5,20 e
 * 100 kg a 5,50).
 *
 * Os corpos de prévia/confirmação saem da OPÇÃO do servidor (A16
 * `produtos-do-bem`: ids de tipo, tanque, produto e o fator VISTO na prévia),
 * como a tela faz — sem importar `src/lib` (editado em paralelo).
 *
 *  TA-01 base: A pronto; X_A por prévia + confirmação; detalhe e saldos guardados
 *  TA-02 troca A→B no cadastro de Combustíveis (bem intocado): B sem fator; B e A velho recusados
 *  TA-03 histórico de X_A imutável (detalhe, lista, linhas do banco), inclusive com o fator de A encerrado
 *  TA-04 fator de B → X_B grava B, kg HALF_UP(L × 0,85, 4), FIFO só de B; A intocado
 *  TA-05 cancelar X_A com a associação atual = B → lotes de A restaurados fatia a fatia; B e X_B intocados
 *  TA-05b cancelar X_A com A movido de fazenda → 409 explícito; nada trocado para B
 *  TA-06 cancelar X_B → lotes de B restaurados; A intocado
 *  TA-07 vários Produtos no mesmo combustível (A reativado + B): os dois, sem auto-seleção; cada confirmação grava o seu
 *  TA-08 Produto passa de S10 para S500: histórico S10 intacto; o fator de (S10, A) não vale para (S500, A)
 *  TA-09 idempotência: replay de X_B (antes e depois da troca) não baixa de novo nem troca o Produto
 *  TA-10 prévia invalidada (vínculo inativado / fator trocado) → confirmação recusada fail-closed
 *  TA-11 concorrência troca de associação × confirmação (Promise.all, invariantes)
 *
 * Citações (não duplicadas, rodadas como regressão): corrida DETERMINÍSTICA
 * vínculo × confirmação = C7 de `patrimonioP1AbastecimentosConcorrencia.test.mjs`;
 * opção velha sequencial = PB-13 e A→B resumido = PB-12 de
 * `patrimonioUx02ProdutosDoBem.test.mjs`; produto movido de fazenda com
 * gasolina = AB11 (c) de `patrimonioP1Abastecimentos.test.mjs`.
 *
 * Decimais: só strings da API/banco ou `Prisma.Decimal` (nunca Number).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoesAbastecimento, erro, fotoAbastecimento, montarAbastecimento, opId, prisma } from './patrimonioP1AbastecimentoCenario.mjs';

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

const D = (v) => new Prisma.Decimal(v);
const q4 = (v) => D(v).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4);
const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);
const NOME_B = 'Diesel S10 estoque novo';

// ─── leituras ────────────────────────────────────────────────────────────────

/** A16 (200) com a conta dada. */
const pdb = (s, bem, tok = s.operador.token) => A.ok(A.produtosDoBem(tok, s.e1.id, bem.id));
const versaoDe = async (delegado, id) => (await /** @type {any} */ (prisma())[delegado].findUnique({ where: { id } })).versao;
/** Lotes do produto (data, id) com saldo e situação em TEXTO. */
const lotesDe = async (s, prod) =>
  (await prisma().estoqueLoteNota.findMany({ where: { cliente_id: s.c, produto_id: prod.id }, orderBy: [{ data_documento: 'asc' }, { id: 'asc' }] }))
    .map((l) => ({ id: l.id, disponivel: l.quantidade_disponivel.toFixed(4), status: l.status }));
const estoqueDe = async (prod) => (await prisma().produto.findUnique({ where: { id: prod.id } })).estoque_atual.toFixed(4);
const movimentosDe = (s, prod) => prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c, produto_id: prod.id } });
/** Linha COMPLETA do abastecimento, fatias e movimentos (saída e estorno) — prova de imutabilidade. */
const linhaDb = async (s, id) => {
  const p = prisma();
  const ab = await p.abastecimentoBem.findUnique({ where: { id } });
  const fatias = await p.abastecimentoBemConsumoLote.findMany({ where: { cliente_id: s.c, abastecimento_id: id }, orderBy: { ordem: 'asc' } });
  const movimentos = await p.movimentacaoEstoque.findMany({
    where: { cliente_id: s.c, id: { in: [ab.movimentacao_estoque_id, ab.movimentacao_estorno_id].filter(Boolean) } },
    orderBy: { id: 'asc' },
  });
  return JSON.stringify({ ab, fatias, movimentos }, replacer);
};
/** Bem, tanques e `TanqueBemCombustivel` COMPLETOS (prova de "o bem não foi tocado"). */
const fotoDoBem = async (s, bemId) => {
  const p = prisma();
  const bem = await p.bemPatrimonial.findUnique({ where: { id: bemId } });
  const tanques = await p.tanqueBem.findMany({ where: { cliente_id: s.c, bem_id: bemId }, orderBy: { id: 'asc' } });
  const tbc = await p.tanqueBemCombustivel.findMany({ where: { cliente_id: s.c, tanque_id: { in: tanques.map((t) => t.id) } }, orderBy: { id: 'asc' } });
  return JSON.stringify({ bem, tanques, tbc }, replacer);
};
/**
 * Detalhe sem os campos DERIVADOS dos vizinhos (`consumo` e
 * `efeito_cancelamento_medidor` mudam quando outro abastecimento do bem entra:
 * não são o fato gravado) nem o `replay` da resposta do comando.
 */
const historico = (det) => {
  const r = { ...det };
  delete r.consumo;
  delete r.efeito_cancelamento_medidor;
  delete r.replay;
  return r;
};
const itemDaLista = async (s, id, filtro = '') => {
  const l = await A.ok(A.lista(s.leitor.token, s.e1.id, filtro));
  return l.items.find((i) => i.id === id) ?? null;
};
const idsDaLista = async (s, filtro) => (await A.ok(A.lista(s.leitor.token, s.e1.id, filtro))).items.map((i) => i.id).sort();

// ─── escritas de cadastro (APIs existentes) ─────────────────────────────────

let seq = 0;
/** Produto REAL de estoque na Fazenda 1 (como o cenário da P1-02). */
const novoProduto = (s, nome, unidade = 'KG') =>
  prisma().produto.create({
    data: { cliente_id: s.c, empresa_id: s.e1.id, numero_produto: `TA-${(seq += 1)}-${randomUUID().slice(0, 6)}`, nome_produto: nome, unidade_principal_estoque: unidade },
  });
/** POST do vínculo (R2) — a resposta crua (para provar 409). */
const vincular = (s, tipoId, prod) => A.req('POST', `/patrimonio-combustiveis/${tipoId}/produtos`, s.token, { empresa_id: s.e1.id, produto_id: prod.id });
/** PATCH da situação do vínculo (CAS pela versão atual) — a resposta crua. */
const situacao = async (s, vinculoId, ativo) =>
  A.req('PATCH', `/patrimonio-combustivel-produtos/${vinculoId}`, s.token, { empresa_id: s.e1.id, versao: await versaoDe('tipoCombustivelProduto', vinculoId), ativo });
const situacaoOk = async (s, vinculoId, ativo) => A.ok(situacao(s, vinculoId, ativo));

// ─── a tela: opção do servidor → prévia → confirmação ───────────────────────

/**
 * Corpo da PRÉVIA montado só com ids da opção de A16 (tanque único) e o único
 * local com saldo de A12 — como a tela auto-seleciona.
 * @param {any} s @param {any} bem @param {any} opcao @param {Record<string, unknown>} campos litros/data/leitura
 */
const corpoDaOpcao = async (s, bem, opcao, campos) => {
  assert.equal(opcao.tanques.length, 1, 'tanque único → a tela escolhe sozinha');
  const locais = await A.ok(A.opcoes(s.operador.token, 'locais', `empresa_id=${s.e1.id}&produto_id=${opcao.produto.id}`));
  assert.equal(locais.itens.length, 1, 'um local com saldo → a tela auto-seleciona');
  return {
    empresa_id: s.e1.id,
    bem_id: bem.id,
    tanque_id: opcao.tanques[0].id,
    tipo_combustivel_id: opcao.tipo_combustivel.id,
    produto_id: opcao.produto.id,
    local_estoque_id: locais.itens[0].local_estoque_id,
    tanque_cheio: false,
    observacao: null,
    referencia_externa: null,
    ...campos,
  };
};
/** Prévia (sem bloqueios) → confirmação com o fator VISTO na prévia e operation_id nova. */
const confirmarComPrevia = async (s, corpo, tok = s.operador.token) => {
  const previa = await A.ok(A.previa(tok, corpo));
  assert.deepEqual(previa.bloqueios, [], JSON.stringify(previa.bloqueios));
  const confirmacao = { ...corpo, operation_id: opId(), conversao_id: previa.plano.conversao.id, conversao_versao: previa.plano.conversao.versao };
  return { previa, confirmacao, r: await A.confirmar(tok, confirmacao) };
};
const bloqueiosDe = (previa) => previa.bloqueios.map((b) => [b.code, b.field, b.reason]);

// ─── fases do cenário A→B (compostas por cada teste) ────────────────────────

/** TA-01: X_A = 80 L em 2027-06-10 (horímetro 1550,5) pela opção A do servidor. */
const faseA = async (s) => {
  const lotesAntes = await lotesDe(s, s.diesel);
  const estoqueAntes = await estoqueDe(s.diesel);
  const r = await pdb(s, s.trator);
  const opcaoA = r.itens[0];
  const corpo = await corpoDaOpcao(s, r.bem, opcaoA, { data_operacional: '2027-06-10', quantidade_litros: '80', medidor_leitura: '1550.5' });
  const { previa, confirmacao, r: resp } = await confirmarComPrevia(s, corpo);
  assert.equal(resp.statusCode, 201, resp.body);
  const xa = resp.json();
  return {
    r, opcaoA, corpoA: corpo, previaA: previa, confirmacaoA: confirmacao, xa,
    detalheA: await A.ok(A.detalhe(s.leitor.token, xa.id, s.e1.id)),
    itemA: await itemDaLista(s, xa.id),
    linhaA: await linhaDb(s, xa.id),
    lotesAntes, estoqueAntes, lotesDepois: await lotesDe(s, s.diesel), estoqueDepois: await estoqueDe(s.diesel),
  };
};

/**
 * TA-02: troca A → B no cadastro de Combustíveis (inativar (S10, A); Produto B
 * em KG com 2 lotes de custos diferentes; vincular (S10, B)). O bem não é tocado.
 */
const trocarParaB = async (s) => {
  const fotoBem = await fotoDoBem(s, s.trator.id);
  const inativadoA = await situacaoOk(s, s.vinculos.diesel.id, false);
  const B = await novoProduto(s, NOME_B);
  const loteB1 = await s.lote(s.e1, B, s.local, { kg: '30.0000', custo: '6.0000', dia: '2027-06-04' });
  const loteB2 = await s.lote(s.e1, B, s.local, { kg: '200.0000', custo: '6.5000', dia: '2027-06-05' });
  const vinculoB = await A.ok(vincular(s, s.comb.DIESEL_S10, B), 201);
  assert.equal(await fotoDoBem(s, s.trator.id), fotoBem, 'bem, tanques e TanqueBemCombustivel iguais à foto (só o cadastro de Combustíveis mudou)');
  return { B, loteB1, loteB2, vinculoB, inativadoA, fotoBem };
};

/** TA-04: fator (S10, B) = 0,850000 pela conta de "configurar fator" (A14). */
const fatorDeB = (s, B) => A.ok(s.configurarFator(s.e1, s.comb.DIESEL_S10, B, '0.850000', null, s.contaFator.token), 201);

/** X_B = 50,001 L em 2027-06-12 (horímetro 1560) pela opção B do servidor. */
const LITROS_B = '50.001';
const faseB = async (s) => {
  const r = await pdb(s, s.trator);
  assert.deepEqual(r.itens.map((i) => [i.produto.nome, i.pronto]), [[NOME_B, true]]);
  const corpo = await corpoDaOpcao(s, r.bem, r.itens[0], { data_operacional: '2027-06-12', quantidade_litros: LITROS_B, medidor_leitura: '1560' });
  const { previa, confirmacao, r: resp } = await confirmarComPrevia(s, corpo);
  assert.equal(resp.statusCode, 201, resp.body);
  return { previaB: previa, confirmacaoB: confirmacao, xb: resp.json(), opcaoB: r.itens[0] };
};

// ─────────────────────────────────────────────────────────────────────────────
describe('TA-01..04 — base, troca A→B, histórico e fator de B', () => {
  test('TA-01: base — A16 devolve só A pronto; X_A por prévia + confirmação (operation_id); detalhe completo (A, 67,2 kg, fator 0,84 v1, custo 354,6, 2 fatias) e saldos dos lotes de A', async () => {
    const s = await montarAbastecimento(app);
    const f = await faseA(s);
    // A16: só A, completo, pronto (a tela auto-seleciona: 1 item e has_more false)
    assert.deepEqual(f.r.itens, [{
      id: s.diesel.id,
      produto: { id: s.diesel.id, nome: 'Diesel S10 granel', codigo_interno: null, unidade_principal_estoque: 'KG' },
      tipo_combustivel: { id: s.comb.DIESEL_S10, codigo: 'DIESEL_S10', nome: 'Diesel S10' },
      conversao: { id: s.fator.diesel.id, versao: 1, sequencia: 1, kg_por_litro: '0.840000' },
      tanques: [{ id: s.trator.tanques[0].id, identificador: 'Tanque principal', capacidade_litros: '180.0000' }],
      bloqueios: [],
      pronto: true,
    }]);
    assert.deepEqual([f.r.has_more, f.r.next_cursor, f.r.resumo], [false, null, { motivo_sem_opcao: null, total: 1, sem_fator: 0, fora_de_kg: 0, tipos_sem_produto: [] }]);
    // prévia = o plano que a confirmação executa
    assert.deepEqual([f.previaA.plano.produto.id, f.previaA.plano.conversao, f.previaA.plano.quantidade_kg], [s.diesel.id, { id: s.fator.diesel.id, versao: 1, sequencia: 1, kg_por_litro: '0.840000' }, '67.2000']);
    assert.deepEqual(f.previaA.plano.fifo.fatias.map((x) => [x.lote_id, x.quantidade_kg, x.custo_unitario]), [[s.lotes.dieselA.id, '50.0000', '5.2000'], [s.lotes.dieselB.id, '17.2000', '5.5000']]);
    assert.equal(f.confirmacaoA.operation_id.startsWith('abast-'), true);
    // X_A: o fato gravado
    const d = f.detalheA;
    assert.equal(f.xa.replay, false);
    assert.deepEqual(historico(f.xa), historico(d), 'a resposta do comando é o detalhe');
    assert.deepEqual(
      [d.status, d.produto, d.tipo_combustivel.id, d.tanque.id, d.quantidade_litros, d.kg_por_litro, d.quantidade_kg, d.conversao, d.custo_total, d.custo_unitario_kg],
      ['CONFIRMADO', { id: s.diesel.id, nome: 'Diesel S10 granel', unidade_principal_estoque: 'KG' }, s.comb.DIESEL_S10, s.trator.tanques[0].id, '80.0000', '0.840000', '67.2000',
        { id: s.fator.diesel.id, sequencia: 1, versao: 1, vigente: true }, '354.6000', '5.2768']
    );
    assert.deepEqual(d.fatias, [
      { ordem: 1, lote_id: s.lotes.dieselA.id, data_lote: '2027-06-01', quantidade_kg: '50.0000', custo_unitario: '5.2000', valor: '260.0000' },
      { ordem: 2, lote_id: s.lotes.dieselB.id, data_lote: '2027-06-03', quantidade_kg: '17.2000', custo_unitario: '5.5000', valor: '94.6000' },
    ]);
    // coerência em Decimal: kg = HALF_UP(80 × 0,84, 4); Σ fatias = kg; Σ valores = custo
    assert.equal(q4(D('80').times(D('0.840000'))), d.quantidade_kg);
    assert.equal(q4(d.fatias.reduce((acc, x) => acc.plus(D(x.quantidade_kg)), D(0))), d.quantidade_kg);
    assert.equal(q4(d.fatias.reduce((acc, x) => acc.plus(D(x.quantidade_kg).times(D(x.custo_unitario))), D(0))), d.custo_total);
    assert.equal((await prisma().movimentacaoEstoque.findUnique({ where: { id: d.movimentacao.id } })).produto_id, s.diesel.id);
    // lista: mesma identidade (Produto A, tipo da classificação no detalhe técnico)
    assert.deepEqual([f.itemA.produto, f.itemA.tipo_combustivel, f.itemA.quantidade_kg, f.itemA.kg_por_litro, f.itemA.custo_total],
      [{ id: s.diesel.id, nome: 'Diesel S10 granel' }, { id: s.comb.DIESEL_S10, nome: 'Diesel S10' }, '67.2000', '0.840000', '354.6000']);
    // saldos por lote de A: antes 50/100 (150), depois 0/82,8 (82,8)
    assert.deepEqual([f.lotesAntes.map((l) => l.disponivel), f.estoqueAntes], [['50.0000', '100.0000'], '150.0000']);
    assert.deepEqual([f.lotesDepois.map((l) => l.disponivel), f.estoqueDepois], [['0.0000', '82.8000'], '82.8000']);
  });

  test('TA-02: troca A→B sem editar o bem — A16 devolve só B (sem_fator, pronto:false; o fator de A NÃO vale para B); B recusado na prévia e na confirmação; a opção velha A recusada (422 sem_vinculo_ativo); nada gravado', async (t) => {
    const s = await montarAbastecimento(app);
    const f = await faseA(s);
    const { B, inativadoA } = await trocarParaB(s);
    assert.equal(inativadoA.ativo, false);

    const r = await pdb(s, s.trator);
    assert.deepEqual(r.itens, [{
      id: B.id,
      produto: { id: B.id, nome: NOME_B, codigo_interno: null, unidade_principal_estoque: 'KG' },
      tipo_combustivel: { id: s.comb.DIESEL_S10, codigo: 'DIESEL_S10', nome: 'Diesel S10' },
      conversao: null,
      tanques: [{ id: s.trator.tanques[0].id, identificador: 'Tanque principal', capacidade_litros: '180.0000' }],
      bloqueios: ['sem_fator'],
      pronto: false,
    }], 'só B; A não aparece; o fator (S10, A) não é reaproveitado');
    assert.deepEqual([r.has_more, r.resumo], [false, { motivo_sem_opcao: null, total: 1, sem_fator: 1, fora_de_kg: 0, tipos_sem_produto: [] }]);
    // a configuração histórica de A não se apaga: o fator (S10, A) continua vigente (só o par mudou)
    const fatoresA = await A.ok(A.req('GET', `/patrimonio-conversoes-combustivel?empresa_id=${s.e1.id}&produto_id=${s.diesel.id}&situacao=VIGENTES`, s.leitor.token));
    assert.deepEqual(fatoresA.items.map((c) => [c.id, c.tipo_combustivel.id, c.kg_por_litro, c.ativo]), [[s.fator.diesel.id, s.comb.DIESEL_S10, '0.840000', true]]);

    const antes = await fotoAbastecimento(s.c);
    // B sem fator: a prévia mostra o bloqueio (sem kg, sem FIFO)
    const corpoB = await corpoDaOpcao(s, r.bem, r.itens[0], { data_operacional: '2027-06-12', quantidade_litros: '50', medidor_leitura: '1560' });
    const pB = await A.ok(A.previa(s.operador.token, corpoB));
    assert.deepEqual(bloqueiosDe(pB), [['ABASTECIMENTO_CONVERSAO_AUSENTE', 'conversao_id', 'sem_conversao_vigente']]);
    assert.deepEqual(pB.bloqueios[0].details, { tipo_combustivel_id: s.comb.DIESEL_S10, produto_id: B.id });
    assert.deepEqual([pB.plano.conversao, pB.plano.quantidade_kg, pB.plano.fifo], [null, null, null]);
    // confirmação de B: sem conversão vista o corpo nem passa do contrato (400); reciclando o fator de A → 422
    const semConversao = await A.confirmar(s.operador.token, { ...corpoB, operation_id: opId() });
    assert.deepEqual(erro(semConversao).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], semConversao.body);
    t.diagnostic(`TA-02 B sem conversao_id: ${JSON.stringify(erro(semConversao))}`);
    const comFatorDeA = await A.confirmar(s.operador.token, { ...corpoB, operation_id: opId(), conversao_id: s.fator.diesel.id, conversao_versao: 1 });
    assert.deepEqual(erro(comFatorDeA), [422, 'ABASTECIMENTO_CONVERSAO_AUSENTE', 'conversao_id', 'sem_conversao_vigente'], comFatorDeA.body);
    // opção VELHA de A (tela aberta antes da troca)
    const corpoVelho = { ...f.corpoA, data_operacional: '2027-06-12', medidor_leitura: '1560', quantidade_litros: '10' };
    const pVelha = await A.ok(A.previa(s.operador.token, corpoVelho));
    assert.deepEqual(bloqueiosDe(pVelha), [['COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'sem_vinculo_ativo']]);
    const cVelha = await A.confirmar(s.operador.token, { ...corpoVelho, operation_id: opId(), conversao_id: f.opcaoA.conversao.id, conversao_versao: f.opcaoA.conversao.versao });
    assert.deepEqual(erro(cVelha), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'sem_vinculo_ativo'], cVelha.body);
    assert.equal(await fotoAbastecimento(s.c), antes, 'fail-closed: nada gravado (abastecimentos, fatias, lotes, estoque, movimentos, recibos, auditoria)');
  });

  test('TA-03: histórico imutável — depois da troca, do fator de B e de X_B, o detalhe, a linha da lista e as linhas do banco de X_A são idênticos a TA-01 (Produto A, 67,2 kg, 0,84 v1, custo, fatias); nada aponta para B; com o fator de A encerrado, o snapshot segue (só o estado vivo do fator muda)', async () => {
    const s = await montarAbastecimento(app);
    const f = await faseA(s);
    const { B } = await trocarParaB(s);
    await fatorDeB(s, B);
    const { xb } = await faseB(s);

    const det = await A.ok(A.detalhe(s.leitor.token, f.xa.id, s.e1.id));
    assert.deepEqual(historico(det), historico(f.detalheA), 'detalhe de X_A idêntico (fora consumo/efeito, derivados dos vizinhos)');
    assert.deepEqual(await itemDaLista(s, f.xa.id), f.itemA, 'linha da lista idêntica');
    assert.equal(await linhaDb(s, f.xa.id), f.linhaA, 'AbastecimentoBem, fatias e movimento de X_A idênticos');
    // nada de X_A aponta para B
    const loteIdsB = (await lotesDe(s, B)).map((l) => l.id);
    assert.equal(det.produto.id, s.diesel.id);
    assert.equal(det.fatias.some((x) => loteIdsB.includes(x.lote_id)), false);
    assert.deepEqual(await idsDaLista(s, `&produto_id=${s.diesel.id}`), [f.xa.id]);
    assert.deepEqual(await idsDaLista(s, `&produto_id=${B.id}`), [xb.id]);
    // o derivado muda (prova de que foi certo excluí-lo): X_B é a leitura mais nova, cancelar X_A já não muda o medidor
    assert.deepEqual([f.detalheA.efeito_cancelamento_medidor.muda, det.efeito_cancelamento_medidor.muda], [true, false]);

    // fator de (S10, A) encerrado (A15): o fato de X_A não depende da linha do fator
    const encerrado = await A.ok(A.req('POST', `/patrimonio-conversoes-combustivel/${s.fator.diesel.id}/encerrar`, s.contaFator.token, { empresa_id: s.e1.id, versao: 1 }));
    assert.deepEqual([encerrado.ativo, encerrado.versao], [false, 2]);
    const det2 = await A.ok(A.detalhe(s.leitor.token, f.xa.id, s.e1.id));
    assert.deepEqual(det2.conversao, { id: s.fator.diesel.id, sequencia: 1, versao: 2, vigente: false }, '`conversao.versao/vigente` do detalhe são o estado VIVO da linha do fator');
    const semVivo = (x) => ({ ...historico(x), conversao: { id: x.conversao.id, sequencia: x.conversao.sequencia } });
    assert.deepEqual(semVivo(det2), semVivo(f.detalheA), 'snapshot (kg_por_litro, quantidade_kg, custo, fatias, conversao id/sequência) intacto');
    assert.deepEqual(await itemDaLista(s, f.xa.id), f.itemA);
    assert.equal(await linhaDb(s, f.xa.id), f.linhaA);
  });

  test('TA-04: fator novo (S10, B) = 0,85 — A16: B pronto com o fator de B; X_B grava B, kg = HALF_UP(50,001 × 0,85, 4) = 42,5009 (meio exato), FIFO só nos 2 lotes de B, custo de B; lotes de A não mudam', async () => {
    const s = await montarAbastecimento(app);
    const f = await faseA(s);
    const { B, loteB1, loteB2 } = await trocarParaB(s);
    const fatorB = await fatorDeB(s, B);
    assert.deepEqual([fatorB.sequencia, fatorB.versao, fatorB.kg_por_litro, fatorB.produto.id, fatorB.tipo_combustivel.id], [1, 1, '0.850000', B.id, s.comb.DIESEL_S10]);
    const r = await pdb(s, s.trator);
    assert.deepEqual(r.itens.map((i) => [i.id, i.tipo_combustivel.id, i.conversao, i.bloqueios, i.pronto]),
      [[B.id, s.comb.DIESEL_S10, { id: fatorB.id, versao: 1, sequencia: 1, kg_por_litro: '0.850000' }, [], true]]);
    assert.deepEqual(r.resumo, { motivo_sem_opcao: null, total: 1, sem_fator: 0, fora_de_kg: 0, tipos_sem_produto: [] });

    const lotesA = await lotesDe(s, s.diesel);
    const estoqueA = await estoqueDe(s.diesel);
    const movA = await movimentosDe(s, s.diesel);
    const { previaB, xb } = await faseB(s);
    // HALF_UP(50,0010 × 0,850000) = 42,500850 → 42,5009 (HALF_EVEN daria 42,5008)
    const bruto = D(LITROS_B).times(D('0.850000'));
    assert.equal(bruto.toFixed(6), '42.500850');
    assert.equal(bruto.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_EVEN).toFixed(4), '42.5008', 'o caso discrimina HALF_UP de HALF_EVEN');
    const kg = q4(bruto);
    assert.equal(kg, '42.5009');
    assert.equal(previaB.plano.quantidade_kg, kg);
    assert.deepEqual(
      [xb.produto, xb.tipo_combustivel.id, xb.conversao, xb.quantidade_litros, xb.kg_por_litro, xb.quantidade_kg],
      [{ id: B.id, nome: NOME_B, unidade_principal_estoque: 'KG' }, s.comb.DIESEL_S10, { id: fatorB.id, sequencia: 1, versao: 1, vigente: true }, '50.0010', '0.850000', kg]
    );
    assert.deepEqual(xb.fatias.map((x) => [x.lote_id, x.data_lote, x.quantidade_kg, x.custo_unitario, x.valor]), [
      [loteB1.id, '2027-06-04', '30.0000', '6.0000', '180.0000'],
      [loteB2.id, '2027-06-05', '12.5009', '6.5000', '81.2559'],
    ], 'FIFO de B: o lote mais antigo de B primeiro; nenhum lote de A');
    assert.equal(q4(xb.fatias.reduce((acc, x) => acc.plus(D(x.quantidade_kg)), D(0))), kg);
    assert.equal(xb.custo_total, q4(xb.fatias.reduce((acc, x) => acc.plus(D(x.quantidade_kg).times(D(x.custo_unitario))), D(0))));
    assert.equal(xb.custo_total, '261.2559');
    assert.equal((await prisma().movimentacaoEstoque.findUnique({ where: { id: xb.movimentacao.id } })).produto_id, B.id);
    // saldos: B baixou exatamente kg; A intocado
    assert.deepEqual((await lotesDe(s, B)).map((l) => l.disponivel), ['0.0000', '187.4991']);
    assert.equal(await estoqueDe(B), D('230.0000').minus(D(kg)).toFixed(4));
    assert.deepEqual([await lotesDe(s, s.diesel), await estoqueDe(s.diesel), await movimentosDe(s, s.diesel)], [lotesA, estoqueA, movA]);
    assert.equal(await linhaDb(s, f.xa.id), f.linhaA);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TA-05..06 — cancelamentos depois da troca', () => {
  test('TA-05: cancelar X_A com a associação atual = B → 200; lotes de A restaurados EXATAMENTE aos saldos de antes de X_A, fatia por fatia; estorno do Produto A; B e X_B intocados (o cancelamento não consulta o vínculo)', async () => {
    const s = await montarAbastecimento(app);
    const f = await faseA(s);
    const { B } = await trocarParaB(s);
    await fatorDeB(s, B);
    const { xb } = await faseB(s);
    // a associação atual de Diesel S10 na fazenda é só B
    assert.deepEqual((await pdb(s, s.trator)).itens.map((i) => i.id), [B.id]);
    const lotesB = await lotesDe(s, B);
    const estoqueB = await estoqueDe(B);
    const movB = await movimentosDe(s, B);
    const linhaB = await linhaDb(s, xb.id);
    const lotesAntesCancelar = await lotesDe(s, s.diesel);

    const canc = await A.ok(A.cancelar(s.contaCancelar.token, f.xa.id, { empresa_id: s.e1.id, versao: f.detalheA.versao, motivo: 'lançado no produto errado', operation_id: opId() }));
    assert.deepEqual([canc.status, canc.versao, canc.produto.id, canc.tipo_combustivel.id, canc.cancelamento.motivo], ['CANCELADO', 2, s.diesel.id, s.comb.DIESEL_S10, 'lançado no produto errado']);
    assert.deepEqual(canc.fatias, f.detalheA.fatias, 'as fatias gravadas (de A) não mudam');
    assert.equal(canc.estorno.quantidade_kg, '67.2000');
    const estorno = await prisma().movimentacaoEstoque.findUnique({ where: { id: canc.estorno.id } });
    assert.deepEqual([estorno.produto_id, estorno.tipo_detalhado], [s.diesel.id, 'estorno_abastecimento'], 'o estorno é do Produto A');
    // fatia por fatia: saldo depois = saldo antes de cancelar + fatia = saldo antes de X_A
    const lotesDepois = await lotesDe(s, s.diesel);
    for (const fatia of f.detalheA.fatias) {
      const antesCanc = lotesAntesCancelar.find((l) => l.id === fatia.lote_id);
      const depois = lotesDepois.find((l) => l.id === fatia.lote_id);
      const antesDeXA = f.lotesAntes.find((l) => l.id === fatia.lote_id);
      assert.equal(depois.disponivel, D(antesCanc.disponivel).plus(D(fatia.quantidade_kg)).toFixed(4), `lote ${fatia.lote_id}`);
      assert.deepEqual(depois, antesDeXA, `lote ${fatia.lote_id} de volta ao saldo de antes de X_A`);
    }
    assert.deepEqual([lotesDepois, await estoqueDe(s.diesel)], [f.lotesAntes, f.estoqueAntes], 'A: 50/100, estoque 150');
    // B e X_B intocados
    assert.deepEqual([await lotesDe(s, B), await estoqueDe(B), await movimentosDe(s, B)], [lotesB, estoqueB, movB]);
    assert.equal(await linhaDb(s, xb.id), linhaB);
    assert.equal((await A.ok(A.detalhe(s.leitor.token, xb.id, s.e1.id))).status, 'CONFIRMADO');
    // e a associação não mudou por causa do cancelamento
    assert.deepEqual((await pdb(s, s.trator)).itens.map((i) => i.id), [B.id]);
  });

  test('TA-05b: cancelar X_A quando A foi movido de fazenda (invariante real) → 409 explícito produto_mudou_de_fazenda; nada gravado; nada trocado para B (cf. AB11 c)', async () => {
    const s = await montarAbastecimento(app);
    const f = await faseA(s);
    const { B } = await trocarParaB(s);
    // o vínculo de A está inativo: a fazenda do Produto A pode mudar (produtoService). O homônimo da
    // Fazenda 2 do cenário (`diesel2`) é renomeado antes: `Produto` é único por (tenant, empresa, nome).
    await prisma().produto.update({ where: { id: s.diesel2.id }, data: { nome_produto: 'Diesel S10 granel F2' } });
    await A.ok(A.req('PATCH', `/produtos/${s.diesel.id}`, s.token, { empresa_id: s.e2.id }));
    const antes = await fotoAbastecimento(s.c);
    const lotesB = await lotesDe(s, B);
    const r = await A.cancelar(s.contaCancelar.token, f.xa.id, { empresa_id: s.e1.id, versao: 1, motivo: 'lançado no produto errado', operation_id: opId() });
    assert.deepEqual(erro(r), [409, 'ABASTECIMENTO_CANCELAMENTO_BLOQUEADO', 'abastecimento', 'produto_mudou_de_fazenda'], r.body);
    assert.match(r.json().message, /nada foi alterado/);
    assert.equal(await fotoAbastecimento(s.c), antes, 'nada gravado');
    assert.deepEqual(await lotesDe(s, B), lotesB, 'B intocado');
    const det = await A.ok(A.detalhe(s.leitor.token, f.xa.id, s.e1.id));
    assert.deepEqual([det.status, det.produto.id, det.fatias], ['CONFIRMADO', s.diesel.id, f.detalheA.fatias], 'X_A segue CONFIRMADO, com A e as fatias de A');
  });

  test('TA-06: cancelar X_B → lotes de B restaurados exatamente (30/200, estoque 230); estorno do Produto B; A e X_A intocados', async () => {
    const s = await montarAbastecimento(app);
    const f = await faseA(s);
    const { B } = await trocarParaB(s);
    await fatorDeB(s, B);
    const lotesBAntes = await lotesDe(s, B);
    const estoqueBAntes = await estoqueDe(B);
    const { xb } = await faseB(s);
    const lotesA = await lotesDe(s, s.diesel);
    const estoqueA = await estoqueDe(s.diesel);
    const canc = await A.ok(A.cancelar(s.contaCancelar.token, xb.id, { empresa_id: s.e1.id, versao: xb.versao, motivo: 'litros digitados errados', operation_id: opId() }));
    assert.deepEqual([canc.status, canc.produto.id, canc.estorno.quantidade_kg], ['CANCELADO', B.id, '42.5009']);
    assert.equal((await prisma().movimentacaoEstoque.findUnique({ where: { id: canc.estorno.id } })).produto_id, B.id);
    assert.deepEqual([await lotesDe(s, B), await estoqueDe(B)], [lotesBAntes, estoqueBAntes]);
    assert.deepEqual(lotesBAntes.map((l) => l.disponivel), ['30.0000', '200.0000']);
    assert.equal(estoqueBAntes, '230.0000');
    assert.deepEqual([await lotesDe(s, s.diesel), await estoqueDe(s.diesel)], [lotesA, estoqueA]);
    assert.equal(await linhaDb(s, f.xa.id), f.linhaA);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TA-07..08 — vários Produtos por combustível e Produto que muda de combustível', () => {
  test('TA-07: reativar (S10, A) com B ativo → A16 devolve B e A (2 itens: sem auto-seleção), cada um com o SEU fator; o mesmo Produto em dois combustíveis → 409; confirmar com cada um grava o Produto escolhido', async () => {
    const s = await montarAbastecimento(app);
    await faseA(s);
    const { B, loteB1, vinculoB } = await trocarParaB(s);
    const fatorB = await fatorDeB(s, B);
    const reativado = await situacaoOk(s, s.vinculos.diesel.id, true);
    assert.equal(reativado.ativo, true);
    const r = await pdb(s, s.trator);
    assert.deepEqual(r.itens.map((i) => [i.produto.nome, i.tipo_combustivel.id, i.conversao, i.pronto]), [
      [NOME_B, s.comb.DIESEL_S10, { id: fatorB.id, versao: 1, sequencia: 1, kg_por_litro: '0.850000' }, true],
      ['Diesel S10 granel', s.comb.DIESEL_S10, { id: s.fator.diesel.id, versao: 1, sequencia: 1, kg_por_litro: '0.840000' }, true],
    ], 'ordem (nome, id); A volta com o fator que nunca foi encerrado');
    assert.deepEqual([r.itens.length, r.has_more, r.resumo.total, r.resumo.sem_fator], [2, false, 2, 0], 'dois elegíveis: a tela pede a escolha (nenhum é o "único")');
    // um Produto, um combustível ativo por fazenda
    const dois = await vincular(s, s.comb.DIESEL_S500, B);
    assert.deepEqual(erro(dois), [409, 'COMBUSTIVEL_PRODUTO_EM_OUTRO_TIPO', 'produto_id', 'vinculado_a_outro_tipo'], dois.body);
    assert.equal(dois.json().details.tipo_combustivel_id, s.comb.DIESEL_S10);
    assert.equal((await prisma().tipoCombustivelProduto.findUnique({ where: { id: vinculoB.id } })).ativo, true);

    const [opB, opA] = r.itens;
    const cA = await confirmarComPrevia(s, await corpoDaOpcao(s, r.bem, opA, { data_operacional: '2027-06-13', quantidade_litros: '10', medidor_leitura: '1570' }));
    assert.equal(cA.r.statusCode, 201, cA.r.body);
    const xa2 = cA.r.json();
    assert.deepEqual([xa2.produto.id, xa2.conversao.id, xa2.kg_por_litro, xa2.quantidade_kg, xa2.fatias.map((x) => [x.lote_id, x.quantidade_kg])],
      [s.diesel.id, s.fator.diesel.id, '0.840000', '8.4000', [[s.lotes.dieselB.id, '8.4000']]]);
    const cB = await confirmarComPrevia(s, await corpoDaOpcao(s, r.bem, opB, { data_operacional: '2027-06-14', quantidade_litros: '10', medidor_leitura: '1580' }));
    assert.equal(cB.r.statusCode, 201, cB.r.body);
    const xb2 = cB.r.json();
    assert.deepEqual([xb2.produto.id, xb2.conversao.id, xb2.kg_por_litro, xb2.quantidade_kg, xb2.fatias.map((x) => [x.lote_id, x.quantidade_kg])],
      [B.id, fatorB.id, '0.850000', '8.5000', [[loteB1.id, '8.5000']]]);
    assert.deepEqual([(await lotesDe(s, s.diesel)).map((l) => l.disponivel), (await lotesDe(s, B)).map((l) => l.disponivel)], [['0.0000', '74.4000'], ['21.5000', '200.0000']]);
  });

  test('TA-08: Produto A passa de S10 para S500 (gerador flex S10+S500) — histórico S10 intacto; (S500, A) sem fator (o de (S10, A) não vale) é recusado; reativar (S10, A) → 409; com fator próprio de (S500, A) grava S500', async () => {
    const s = await montarAbastecimento(app);
    // antes: o gerador aceita S10 e S500; só A (S10) é elegível (óleo em L fica fora de KG)
    const g0 = await pdb(s, s.gerador);
    assert.deepEqual(g0.itens.map((i) => [i.id, i.tipo_combustivel.id, i.pronto]), [[s.diesel.id, s.comb.DIESEL_S10, true]]);
    const f = await faseA(s);
    // troca de combustível do MESMO Produto na MESMA fazenda (o gerador e o trator não são tocados)
    const fotoGerador = await fotoDoBem(s, s.gerador.id);
    await situacaoOk(s, s.vinculos.diesel.id, false);
    const vinculoS500 = await A.ok(vincular(s, s.comb.DIESEL_S500, s.diesel), 201);
    assert.equal(await fotoDoBem(s, s.gerador.id), fotoGerador);
    // trator (só S10): nada a oferecer; gerador: A sob S500, sem fator
    const t = await pdb(s, s.trator);
    assert.deepEqual([t.itens, t.resumo], [[], { motivo_sem_opcao: 'nenhum_produto_associado', total: 0, sem_fator: 0, fora_de_kg: 0, tipos_sem_produto: [{ id: s.comb.DIESEL_S10, nome: 'Diesel S10' }] }]);
    const g = await pdb(s, s.gerador);
    assert.deepEqual(g.itens.map((i) => [i.id, i.tipo_combustivel.id, i.conversao, i.bloqueios, i.pronto, i.tanques.map((x) => x.id)]),
      [[s.diesel.id, s.comb.DIESEL_S500, null, ['sem_fator'], false, [s.gerador.tanques[0].id]]]);
    assert.deepEqual(g.resumo, { motivo_sem_opcao: null, total: 1, sem_fator: 1, fora_de_kg: 1, tipos_sem_produto: [{ id: s.comb.DIESEL_S10, nome: 'Diesel S10' }] });

    const antes = await fotoAbastecimento(s.c);
    const corpoS500 = await corpoDaOpcao(s, g.bem, g.itens[0], { data_operacional: '2027-06-12', quantidade_litros: '20', medidor_leitura: null });
    const p = await A.ok(A.previa(s.operador.token, corpoS500));
    assert.deepEqual(bloqueiosDe(p), [['ABASTECIMENTO_CONVERSAO_AUSENTE', 'conversao_id', 'sem_conversao_vigente']]);
    assert.deepEqual(p.bloqueios[0].details, { tipo_combustivel_id: s.comb.DIESEL_S500, produto_id: s.diesel.id });
    const comFatorS10 = await A.confirmar(s.operador.token, { ...corpoS500, operation_id: opId(), conversao_id: s.fator.diesel.id, conversao_versao: 1 });
    assert.deepEqual(erro(comFatorS10), [422, 'ABASTECIMENTO_CONVERSAO_AUSENTE', 'conversao_id', 'sem_conversao_vigente'], comFatorS10.body);
    // o par velho (S10, A) no gerador: sem vínculo ativo
    const corpoS10 = { ...corpoS500, tipo_combustivel_id: s.comb.DIESEL_S10 };
    const cS10 = await A.confirmar(s.operador.token, { ...corpoS10, operation_id: opId(), conversao_id: s.fator.diesel.id, conversao_versao: 1 });
    assert.deepEqual(erro(cS10), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'sem_vinculo_ativo'], cS10.body);
    // um Produto, um combustível: reativar (S10, A) com (S500, A) ativo → 409
    const reat = await situacao(s, s.vinculos.diesel.id, true);
    assert.deepEqual(erro(reat), [409, 'COMBUSTIVEL_PRODUTO_EM_OUTRO_TIPO', 'produto_id', 'vinculado_a_outro_tipo'], reat.body);
    assert.equal(reat.json().details.tipo_combustivel_id, s.comb.DIESEL_S500);
    assert.equal(await fotoAbastecimento(s.c), antes, 'nada gravado');
    assert.equal(await linhaDb(s, f.xa.id), f.linhaA, 'X_A (sob S10) intacto');

    // fator PRÓPRIO do par (S500, A): os dois fatores de A convivem, um por par
    const fatorS500 = await A.ok(s.configurarFator(s.e1, s.comb.DIESEL_S500, s.diesel, '0.830000', null, s.contaFator.token), 201);
    assert.equal(fatorS500.sequencia, 1, 'sequência própria do par novo');
    const vigentes = await A.ok(A.req('GET', `/patrimonio-conversoes-combustivel?empresa_id=${s.e1.id}&produto_id=${s.diesel.id}&situacao=VIGENTES`, s.leitor.token));
    assert.deepEqual(vigentes.items.map((c) => [c.tipo_combustivel.id, c.kg_por_litro]).sort(), [[s.comb.DIESEL_S10, '0.840000'], [s.comb.DIESEL_S500, '0.830000']].sort());
    const g2 = await pdb(s, s.gerador);
    assert.deepEqual(g2.itens.map((i) => [i.tipo_combustivel.id, i.conversao?.id, i.pronto]), [[s.comb.DIESEL_S500, fatorS500.id, true]]);
    const c = await confirmarComPrevia(s, await corpoDaOpcao(s, g2.bem, g2.itens[0], { data_operacional: '2027-06-12', quantidade_litros: '20', medidor_leitura: null }));
    assert.equal(c.r.statusCode, 201, c.r.body);
    const x = c.r.json();
    assert.deepEqual([x.bem.id, x.produto.id, x.tipo_combustivel.id, x.conversao.id, x.kg_por_litro, x.quantidade_kg, x.medidor.tipo],
      [s.gerador.id, s.diesel.id, s.comb.DIESEL_S500, fatorS500.id, '0.830000', '16.6000', 'SEM_MEDIDOR']);
    assert.equal(vinculoS500.tipo_combustivel_id, s.comb.DIESEL_S500);
    const detA = await A.ok(A.detalhe(s.leitor.token, f.xa.id, s.e1.id));
    assert.deepEqual([detA.tipo_combustivel.id, detA.kg_por_litro, detA.conversao.id], [s.comb.DIESEL_S10, '0.840000', s.fator.diesel.id], 'X_A segue sob S10 com 0,84');
    assert.equal(await linhaDb(s, f.xa.id), f.linhaA);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TA-09..11 — idempotência, prévia invalidada e concorrência', () => {
  test('TA-09: idempotência — repetir X_B com a MESMA operation_id → 200 replay, mesmo id, nada baixado; após a troca (B inativado) o replay ainda devolve o fato de B; operation_id nova → 422; a mesma operation_id com o Produto A → 409 IDEMPOTENCY_CONFLICT', async () => {
    const s = await montarAbastecimento(app);
    await faseA(s);
    const { B, vinculoB } = await trocarParaB(s);
    await fatorDeB(s, B);
    const { confirmacaoB, xb } = await faseB(s);
    const foto1 = await fotoAbastecimento(s.c);
    const r1 = await A.confirmar(s.operador.token, confirmacaoB);
    assert.equal(r1.statusCode, 200, r1.body);
    assert.equal(r1.json().replay, true);
    assert.deepEqual(historico(r1.json()), historico(xb), 'mesmo fato (id, Produto B, kg, fatias)');
    assert.equal(r1.json().id, xb.id);
    assert.equal(await fotoAbastecimento(s.c), foto1, 'replay: nenhuma baixa, lote, movimento, recibo ou auditoria');

    // troca de associação depois do fato: B deixa de ser oferecido
    await situacaoOk(s, vinculoB.id, false);
    assert.deepEqual((await pdb(s, s.trator)).itens, []);
    const foto2 = await fotoAbastecimento(s.c);
    const r2 = await A.confirmar(s.operador.token, confirmacaoB);
    assert.equal(r2.statusCode, 200, r2.body);
    assert.deepEqual([r2.json().replay, r2.json().id, r2.json().produto.id], [true, xb.id, B.id], 'o replay devolve o fato gravado; não troca o Produto');
    assert.equal(await fotoAbastecimento(s.c), foto2);
    // operation_id NOVA com o mesmo corpo: o estado atual vale (fail-closed)
    const nova = await A.confirmar(s.operador.token, { ...confirmacaoB, operation_id: opId() });
    assert.deepEqual(erro(nova), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'sem_vinculo_ativo'], nova.body);
    assert.equal(await fotoAbastecimento(s.c), foto2);
    // a MESMA operation_id com outro Produto (A): conflito, nunca "troca" do fato
    const auditoria = await prisma().auditLog.count({ where: { cliente_id: s.c } });
    const outro = await A.confirmar(s.operador.token, { ...confirmacaoB, produto_id: s.diesel.id, conversao_id: s.fator.diesel.id, conversao_versao: 1 });
    assert.deepEqual(erro(outro).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT'], outro.body);
    const det = await A.ok(A.detalhe(s.leitor.token, xb.id, s.e1.id));
    assert.deepEqual(historico(det), historico(xb));
    assert.equal(await prisma().abastecimentoBem.count({ where: { cliente_id: s.c } }), 2, 'X_A e X_B, nenhum outro');
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: s.c } }), auditoria + 1, 'só a auditoria do reenvio conflitante (D9)');
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: s.c, acao: 'abastecimento_bem.reenvio_conflitante' } }), 1);
  });

  test('TA-10: prévia invalidada — (a) prévia com A, vínculo (S10, A) inativado antes de confirmar → 422 sem_vinculo_ativo; (b) prévia com A, fator de A trocado → 409 ABASTECIMENTO_CONVERSAO_ALTERADA; nada gravado (cf. PB-13 e C7)', async () => {
    const s = await montarAbastecimento(app);
    // (b) primeiro (A ainda ativo): fator trocado entre a prévia e a confirmação
    const r = await pdb(s, s.trator);
    const corpo = await corpoDaOpcao(s, r.bem, r.itens[0], { data_operacional: '2027-06-10', quantidade_litros: '80', medidor_leitura: '1550.5' });
    const pv = await A.ok(A.previa(s.operador.token, corpo));
    assert.deepEqual(pv.bloqueios, []);
    const f2 = await A.ok(s.configurarFator(s.e1, s.comb.DIESEL_S10, s.diesel, '0.845000', s.fator.diesel.id, s.contaFator.token), 201);
    const antesB = await fotoAbastecimento(s.c);
    const alterada = await A.confirmar(s.operador.token, { ...corpo, operation_id: opId(), conversao_id: pv.plano.conversao.id, conversao_versao: pv.plano.conversao.versao });
    assert.deepEqual(erro(alterada), [409, 'ABASTECIMENTO_CONVERSAO_ALTERADA', 'conversao_id', 'conversao_alterada'], alterada.body);
    assert.deepEqual([alterada.json().details.conversao_vigente_id, alterada.json().details.conversao_vigente_versao], [f2.id, 1]);
    assert.equal(await fotoAbastecimento(s.c), antesB, 'nada gravado');

    // (a) nova prévia (fator f2) e o vínculo inativado antes da confirmação
    const pv2 = await A.ok(A.previa(s.operador.token, corpo));
    assert.deepEqual([pv2.bloqueios, pv2.plano.conversao.id, pv2.plano.quantidade_kg], [[], f2.id, '67.6000']);
    await situacaoOk(s, s.vinculos.diesel.id, false);
    const antesA = await fotoAbastecimento(s.c);
    const semVinculo = await A.confirmar(s.operador.token, { ...corpo, operation_id: opId(), conversao_id: pv2.plano.conversao.id, conversao_versao: pv2.plano.conversao.versao });
    assert.deepEqual(erro(semVinculo), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'sem_vinculo_ativo'], semVinculo.body);
    assert.equal(await fotoAbastecimento(s.c), antesA, 'nada gravado (sem baixa)');
    assert.deepEqual(bloqueiosDe(await A.ok(A.previa(s.operador.token, corpo))), [['COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'sem_vinculo_ativo']], 'uma nova revisão já mostra o motivo');
    assert.deepEqual((await pdb(s, s.trator)).itens, [], 'e a releitura de A16 já não oferece A');
    assert.equal(await prisma().abastecimentoBem.count({ where: { cliente_id: s.c } }), 0);
  });

  test('TA-11: concorrência troca de associação (inativar A + associar Bi) × confirmação com A (Promise.all, 6 rodadas, ordens e atrasos alternados) — OU 201 com A antes da inativação, OU 422 sem_vinculo_ativo; nunca baixa com Bi; estoque de A coerente (cf. C7 determinístico)', async (t) => {
    const s = await montarAbastecimento(app);
    const f = await faseA(s);
    // atraso (ms) antes da troca, por rodada: sem atraso a troca costuma vencer a trava (o comando faz
    // recibo, empresa, fuso e bem antes dela); com atraso a confirmação costuma vencer. Os dois ramos
    // são aceitos e as invariantes valem em qualquer ordem; a ordem DETERMINÍSTICA é o C7.
    const ATRASOS = [0, 0, 20, 40, 80, 160];
    const RODADAS = ATRASOS.length;
    const LITROS = '5';
    const kgRodada = q4(D(LITROS).times(D('0.840000')));
    assert.equal(kgRodada, '4.2000');
    /** @type {string[]} */
    const desfechos = [];
    /** @type {any[]} */
    const produtosB = [];
    let confirmados = 0;
    for (let i = 0; i < RODADAS; i += 1) {
      if (i > 0) await situacaoOk(s, s.vinculos.diesel.id, true); // a rodada começa com A associado
      const r = await pdb(s, s.trator);
      const opA = r.itens.find((x) => x.id === s.diesel.id);
      assert.ok(opA?.pronto, 'A elegível no início da rodada');
      const corpo = await corpoDaOpcao(s, r.bem, opA, { data_operacional: '2027-06-15', quantidade_litros: LITROS, medidor_leitura: String(1600 + i * 10) });
      const pv = await A.ok(A.previa(s.operador.token, corpo));
      assert.deepEqual(pv.bloqueios, []);
      const Bi = await novoProduto(s, `Diesel S10 lote novo ${i}`);
      produtosB.push(Bi);
      const troca = async () => {
        if (ATRASOS[i]) await new Promise((ok) => setTimeout(ok, ATRASOS[i]));
        const inativar = await situacao(s, s.vinculos.diesel.id, false);
        const associar = await vincular(s, s.comb.DIESEL_S10, Bi);
        return { inativar, associar };
      };
      const confirmar = () => A.confirmar(s.operador.token, { ...corpo, operation_id: opId(), conversao_id: pv.plano.conversao.id, conversao_versao: pv.plano.conversao.versao });
      const [tr, c] = i % 2 === 0
        ? await Promise.all([troca(), confirmar()])
        : await Promise.all([confirmar(), troca()]).then(([x, y]) => [y, x]);
      assert.equal(tr.inativar.statusCode, 200, tr.inativar.body);
      assert.equal(tr.associar.statusCode, 201, tr.associar.body);
      if (c.statusCode === 201) {
        const x = c.json();
        assert.deepEqual([x.produto.id, x.tipo_combustivel.id, x.conversao.id, x.kg_por_litro, x.quantidade_kg], [s.diesel.id, s.comb.DIESEL_S10, s.fator.diesel.id, '0.840000', kgRodada]);
        // serialização pela trava do vínculo: o fato nasceu antes de a inativação gravar
        assert.ok(x.created_date <= tr.inativar.json().updated_date, `${x.created_date} <= ${tr.inativar.json().updated_date}`);
        confirmados += 1;
        desfechos.push('201');
      } else {
        assert.deepEqual(erro(c), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'sem_vinculo_ativo'], c.body);
        desfechos.push('422');
      }
    }
    t.diagnostic(`TA-11 desfechos da confirmação por rodada: ${desfechos.join(',')}`);
    // invariantes finais
    const linhas = await prisma().abastecimentoBem.findMany({ where: { cliente_id: s.c } });
    assert.equal(linhas.length, 1 + confirmados, 'X_A + um por 201');
    assert.deepEqual([...new Set(linhas.map((l) => l.produto_id))], [s.diesel.id], 'nenhuma baixa com Bi');
    for (const Bi of produtosB) assert.equal(await movimentosDe(s, Bi), 0, `nenhum movimento de ${Bi.nome_produto}`);
    const esperado = D(f.estoqueAntes).minus(D('67.2000')).minus(D(kgRodada).times(confirmados)).toFixed(4);
    const lotes = await lotesDe(s, s.diesel);
    assert.equal(lotes.reduce((acc, l) => acc.plus(D(l.disponivel)), D(0)).toFixed(4), esperado, 'Σ lotes de A = 150 − 67,2 − 4,2 × confirmados');
    assert.equal(await estoqueDe(s.diesel), esperado, 'estoque_atual de A coerente com os lotes');
    // e o estado final da associação: A inativo, B0..B5 ativos
    const final = await pdb(s, s.trator);
    assert.deepEqual(final.itens.map((x) => x.id).sort(), produtosB.map((x) => x.id).sort());
  });
});
