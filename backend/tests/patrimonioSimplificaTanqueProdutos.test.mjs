/**
 * D-PROD-162 — MAIKE-PATRIMONIO-SIMPLIFICA-01: tanques do bem × Produtos
 * ACEITOS (`TanqueBemProduto`). PostgreSQL real, HTTP autenticado, prova por
 * fotografia das linhas.
 *
 *  T1. Aceita Produto em L e em KG (tanque novo e tanque existente); forma
 *      pública e auditoria com `produto_ids`; tanque sem Produto (P-01).
 *  T2. Recusas 422 `TANQUE_PRODUTO_INVALIDO` (SACO → unidade_incompativel,
 *      outra fazenda → outra_empresa, outro tenant → inexistente sem oráculo,
 *      inativo ao acrescentar, repetido, mais de 20 → limite), nada gravado;
 *      `medicoes`/`combustivel_ids`/sem `produto_ids` → 400.
 *  T3. Aceite mantido não é revalidado: Produto inativado depois continua
 *      aceito (`produto_ativo: false`).
 *  T4. Achado D11: retirar um aceite SEM abastecimento apaga a linha; COM
 *      abastecimento só desliga `ativo` (a linha fica e volta a mesma).
 *  T5. Achado D1: aceite em tanque inativo ou bem inativo; reativar o tanque
 *      (ou o bem) com o Produto já em outra fazenda/unidade → 422; retirando-o
 *      no mesmo PATCH → 200.
 *  T6. Achado D12: `GET /bens-patrimoniais-opcoes/produtos` — só ativos, da
 *      fazenda, L ou KG (nunca SACO nem outro tenant); `unidade` filtra;
 *      busca; paginação estável.
 *  T7. Integração com o Produto (F4): a troca de fazenda/unidade do Produto não
 *      é travada por aceite que não vale; retirado sem histórico, o Produto
 *      pode ser excluído.
 *  T8. Corridas: o acréscimo lê o Produto `FOR KEY SHARE` antes de validar —
 *      exclusão ou troca de fazenda/unidade em voo (que tomam `FOR UPDATE`)
 *      terminam primeiro e o POST/PATCH do bem recebe 422 com o reason certo,
 *      nunca 403/500 da FK nem aceite incoerente.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { corpoCurral, corpoErro, corpoTrator, erro, fotoPatrimonio, http, montarPatrimonio, prisma, produto, produtoKG, produtoL, tanqueCom } from './patrimonioP1Cenario.mjs';

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

const req = (...a) => H.req(...a);
const ok = (...a) => H.ok(...a);
const INEXISTENTE = 'cl0inexistente000000000000';
const criarOk = (s, corpo) => ok(req('POST', '/bens-patrimoniais', s.token, corpo), 201);
const patchBem = (s, bem, corpo, versao) => req('PATCH', `/bens-patrimoniais/${bem.id}`, s.token, { empresa_id: bem.empresa_id ?? s.e1.id, versao: versao ?? bem.versao, ...corpo });
/** Itens `tanques` do PATCH a partir do bem público (mantém tudo; `produtos` por tanque substituível). */
const tanquesDe = (bem, produtosPorTanque = {}) =>
  bem.tanques.map((t, i) => ({
    id: t.id,
    identificador: t.identificador,
    capacidade_litros: t.capacidade_litros,
    ativo: t.ativo,
    produto_ids: produtosPorTanque[i] ?? t.produtos.map((p) => p.produto_id),
  }));
const aceites = (clienteId) => prisma().tanqueBemProduto.findMany({ where: { cliente_id: clienteId }, orderBy: [{ tanque_id: 'asc' }, { produto_id: 'asc' }] });

/**
 * Histórico SINTÉTICO de abastecimento no par tanque × Produto (direto no
 * banco: o teste prova o sync do aceite, não o abastecimento). Cria local,
 * movimento e um `AbastecimentoBem` CONFIRMADO em L.
 */
const historico = async (s, bemId, tanqueId, produtoId) => {
  const p = prisma();
  const sufixo = randomUUID().slice(0, 8);
  const local = await p.localEstoque.create({ data: { cliente_id: s.c, numero_local: `L-${sufixo}`, nome: `Tanque da sede ${sufixo}` } });
  const mov = await p.movimentacaoEstoque.create({
    data: {
      cliente_id: s.c, empresa_id: s.e1.id, numero_movimentacao: `M-${sufixo}`, tipo_movimentacao: 'Saída', data_movimentacao: new Date('2027-06-10T12:00:00Z'),
      produto_id: produtoId, quantidade: '10', unidade_medida: 'L',
    },
  });
  return p.abastecimentoBem.create({
    data: {
      cliente_id: s.c, empresa_id: s.e1.id, numero: `H-${sufixo}`, status: 'CONFIRMADO', bem_id: bemId, tanque_id: tanqueId, produto_id: produtoId, local_estoque_id: local.id,
      data_operacional: new Date('2027-06-10T00:00:00Z'), quantidade: '10', unidade: 'L', custo_total: '50', custo_unitario: '5', medidor_tipo: 'SEM_MEDIDOR',
      operation_id: `hist-${sufixo}`, movimentacao_estoque_id: mov.id,
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
describe('T1 — aceitar Produtos em L e em KG', () => {
  test('POST com Produto L e KG; forma pública (por nome) e auditoria (ids ordenados); PATCH acrescenta; tanque sem Produto é aceito (P-01)', async () => {
    const s = await montarPatrimonio(app);
    const diesel = await produtoL(s, { nome: 'Diesel S10 (L)', codigo_interno: 'DS10' });
    const racao = await produtoKG(s, { nome: 'Arla em kg' });
    const trator = await criarOk(s, corpoTrator(s, { tanques: [tanqueCom([racao.id, diesel.id])] }));
    assert.equal(trator.tanques.length, 1);
    assert.equal(trator.medicoes, undefined, 'sem medições na forma pública');
    assert.deepEqual(trator.tanques[0].produtos, [
      { produto_id: racao.id, nome: 'Arla em kg', codigo_interno: null, unidade_principal_estoque: 'KG', produto_ativo: true },
      { produto_id: diesel.id, nome: 'Diesel S10 (L)', codigo_interno: 'DS10', unidade_principal_estoque: 'L', produto_ativo: true },
    ]);
    assert.deepEqual(Object.keys(trator.tanques[0]).sort(), ['ativo', 'capacidade_litros', 'id', 'identificador', 'observacao', 'produtos']);
    assert.deepEqual(await ok(req('GET', `/bens-patrimoniais/${trator.id}?empresa_id=${s.e1.id}`, s.token)), trator, 'detalhe = resposta do POST');
    const linhas = await aceites(s.c);
    assert.deepEqual(linhas.map((l) => [l.tanque_id, l.produto_id, l.ativo]).sort(), [[trator.tanques[0].id, diesel.id, true], [trator.tanques[0].id, racao.id, true]].sort());

    const evento = await prisma().auditLog.findFirst({ where: { cliente_id: s.c, entidade: 'BemPatrimonial', entidade_id: trator.id, acao: 'create' } });
    assert.deepEqual(/** @type {any} */ (evento.dados_novos).tanques, [{ id: trator.tanques[0].id, ativo: true, capacidade_litros: '180.0000', produto_ids: [diesel.id, racao.id].sort() }]);

    // Tanque sem Produto aceito (P-01) e acréscimo por PATCH (tanque novo + existente).
    const gasolina = await produtoL(s, { nome: 'Gasolina comum' });
    const semProduto = await criarOk(s, corpoTrator(s, { nome: 'Trator reserva', codigo_frota: 'TP-07' }));
    assert.deepEqual(semProduto.tanques[0].produtos, []);
    const editado = await ok(patchBem(s, semProduto, {
      tanques: [...tanquesDe(semProduto, { 0: [gasolina.id] }), { identificador: 'Tanque auxiliar', capacidade_litros: '50', produto_ids: [diesel.id] }],
    }));
    assert.equal(editado.versao, 2);
    assert.deepEqual(editado.tanques.map((t) => t.produtos.map((p) => p.nome)), [['Gasolina comum'], ['Diesel S10 (L)']]);
    const upd = await prisma().auditLog.findFirst({ where: { cliente_id: s.c, entidade: 'BemPatrimonial', entidade_id: semProduto.id, acao: 'update' } });
    assert.deepEqual(/** @type {any} */ (upd.dados_novos).campos_alterados, ['tanques']);
    assert.deepEqual(/** @type {any} */ (upd.dados_anteriores).tanques[0].produto_ids, []);
    // Mesmo conjunto em outra ordem: sem mudança efetiva (nem versão, nem auditoria).
    const mesma = await ok(patchBem(s, editado, { tanques: tanquesDe(editado) }));
    assert.equal(mesma.versao, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('T2 — recusas do Produto aceito', () => {
  test('SACO, outra fazenda, outro tenant (sem oráculo), inativo, repetido e mais de 20 → 422 TANQUE_PRODUTO_INVALIDO com field/reason; 400 para medicoes/combustivel_ids/sem produto_ids; nada gravado', async () => {
    const s = await montarPatrimonio(app);
    const outro = await montarPatrimonio(app);
    const saco = await produto(s, 'SACO', { nome: 'Ração ensacada' });
    const daE2 = await produtoL(s, { empresa: s.e2, nome: 'Diesel da fazenda 2' });
    const alheio = await produtoL(outro, { nome: 'Diesel alheio' });
    const inativo = await produtoL(s, { nome: 'Diesel inativo', ativo: false });
    const diesel = await produtoL(s, { nome: 'Diesel S10' });
    const trator = await criarOk(s, corpoTrator(s, { tanques: [tanqueCom([diesel.id])] }));
    const antes = await fotoPatrimonio([s.c, outro.c]);
    const post = (ids) => req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, { codigo_frota: null, tanques: [tanqueCom([]), tanqueCom(ids, { identificador: 'Segundo' })] }));
    const patch = (ids) => patchBem(s, trator, { tanques: tanquesDe(trator, { 0: ids }) });

    for (const [rotulo, pedido, reason, extra] of [
      ['SACO', post([saco.id]), 'unidade_incompativel', { produto_id: saco.id, unidade: 'SACO' }],
      ['outra fazenda', post([daE2.id]), 'outra_empresa', { produto_id: daE2.id }],
      ['outro tenant', post([alheio.id]), 'inexistente', { produto_id: alheio.id }],
      ['inativo ao acrescentar', post([inativo.id]), 'inativo', { produto_id: inativo.id }],
      ['repetido', post([diesel.id, diesel.id]), 'repetido', {}],
      ['PATCH SACO', patch([diesel.id, saco.id]), 'unidade_incompativel', { produto_id: saco.id, unidade: 'SACO' }],
      ['PATCH inativo', patch([diesel.id, inativo.id]), 'inativo', { produto_id: inativo.id }],
    ]) {
      const r = await pedido;
      const field = rotulo.startsWith('PATCH') ? 'tanques[0].produto_ids' : 'tanques[1].produto_ids';
      assert.deepEqual(erro(r), [422, 'TANQUE_PRODUTO_INVALIDO', field, reason], `${rotulo}: ${r.body}`);
      assert.deepEqual(r.json().details ?? {}, extra, `${rotulo}: details além de field/reason (que sobem para o topo)`);
      assert.match(r.json().message, /nada foi gravado/);
    }
    // Sem oráculo: Produto de outro tenant tem o MESMO corpo de um id inexistente.
    const deFora = await post([alheio.id]);
    const deNinguem = await post([INEXISTENTE]);
    const semId = (r) => ({ ...corpoErro(r), details: { ...corpoErro(r).details, produto_id: null } });
    assert.deepEqual(semId(deFora), semId(deNinguem));

    // Limite: 21 Produtos aceitos (válidos) → 422 limite; 20 passam.
    const vinte = await Promise.all(Array.from({ length: 21 }, (_, i) => produtoL(s, { nome: `Produto ${String(i).padStart(2, '0')}` })));
    const limite = await post(vinte.map((p) => p.id));
    assert.deepEqual(erro(limite), [422, 'TANQUE_PRODUTO_INVALIDO', 'tanques[1].produto_ids', 'limite']);
    assert.equal(limite.json().details.maximo, 20);
    // Schema: mais de 50 é abuso (400); medições, combustíveis e tanque sem `produto_ids` também.
    for (const [rotulo, corpo] of [
      ['51 ids', corpoTrator(s, { codigo_frota: null, tanques: [tanqueCom(Array.from({ length: 51 }, () => diesel.id))] })],
      ['medicoes', corpoCurral(s, { medicoes: [] })],
      ['combustivel_ids', corpoTrator(s, { codigo_frota: null, tanques: [{ identificador: 'T', capacidade_litros: '10', combustivel_ids: [] }] })],
      ['combustivel_ids junto', corpoTrator(s, { codigo_frota: null, tanques: [{ ...tanqueCom([diesel.id]), combustivel_ids: [] }] })],
      ['sem produto_ids', corpoTrator(s, { codigo_frota: null, tanques: [{ identificador: 'T', capacidade_litros: '10' }] })],
      ['id malformado', corpoTrator(s, { codigo_frota: null, tanques: [tanqueCom(['x;drop'])] })],
    ]) {
      const r = await req('POST', '/bens-patrimoniais', s.token, corpo);
      assert.deepEqual(erro(r).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], `${rotulo}: ${r.body}`);
    }
    assert.equal((await patchBem(s, trator, { medicoes: [] })).statusCode, 400, 'PATCH com medicoes');
    assert.equal(await fotoPatrimonio([s.c, outro.c]), antes, 'nenhuma recusa gravou nada');
    const vinteOk = await criarOk(s, corpoTrator(s, { codigo_frota: 'TP-20', tanques: [tanqueCom(vinte.slice(0, 20).map((p) => p.id))] }));
    assert.equal(vinteOk.tanques[0].produtos.length, 20);
  });

  test('tanque em natureza sem tanque → 422 BEM_CAMPO_NAO_APLICAVEL (nada gravado)', async () => {
    const s = await montarPatrimonio(app);
    const diesel = await produtoL(s);
    const antes = await fotoPatrimonio(s.c);
    const r = await req('POST', '/bens-patrimoniais', s.token, corpoCurral(s, { tanques: [tanqueCom([diesel.id])] }));
    assert.deepEqual(erro(r).slice(0, 3), [422, 'BEM_CAMPO_NAO_APLICAVEL', 'tanques']);
    assert.equal(await fotoPatrimonio(s.c), antes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('T3 — aceite mantido não é revalidado', () => {
  test('Produto inativado depois continua aceito (produto_ativo false); editar o bem sem mexer nele passa; tirá-lo e recolocá-lo inativo → 422', async () => {
    const s = await montarPatrimonio(app);
    const diesel = await produtoL(s, { nome: 'Diesel S10' });
    const trator = await criarOk(s, corpoTrator(s, { tanques: [tanqueCom([diesel.id])] }));
    await prisma().produto.update({ where: { id: diesel.id }, data: { ativo: false } });
    const lido = await ok(req('GET', `/bens-patrimoniais/${trator.id}?empresa_id=${s.e1.id}`, s.token));
    assert.equal(lido.tanques[0].produtos[0].produto_ativo, false);
    const editado = await ok(patchBem(s, lido, { nome: 'Trator TP-02 revisado', tanques: tanquesDe(lido, { 0: [diesel.id] }).map((t) => ({ ...t, capacidade_litros: '200' })) }));
    assert.deepEqual([editado.versao, editado.tanques[0].capacidade_litros, editado.tanques[0].produtos[0].produto_id], [2, '200.0000', diesel.id]);
    // Retirado (sem histórico → linha apagada) e acrescentado de novo → é acréscimo, e inativo não entra.
    const sem = await ok(patchBem(s, editado, { tanques: tanquesDe(editado, { 0: [] }) }));
    const volta = await patchBem(s, sem, { tanques: tanquesDe(sem, { 0: [diesel.id] }) });
    assert.deepEqual(erro(volta), [422, 'TANQUE_PRODUTO_INVALIDO', 'tanques[0].produto_ids', 'inativo']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('T4 — retirar o aceite (achado D11)', () => {
  test('sem abastecimento a linha é apagada; com abastecimento só desliga ativo, a linha fica e volta a MESMA; sync completo nos dois tanques', async () => {
    const s = await montarPatrimonio(app);
    const diesel = await produtoL(s, { nome: 'Diesel S10' });
    const arla = await produtoL(s, { nome: 'Arla 32' });
    const graxa = await produtoKG(s, { nome: 'Graxa' });
    const trator = await criarOk(s, corpoTrator(s, {
      tanques: [tanqueCom([diesel.id, arla.id]), tanqueCom([graxa.id], { identificador: 'Reservatório de graxa', capacidade_litros: '20' })],
    }));
    const [tA] = trator.tanques;
    const hist = await historico(s, trator.id, tA.id, diesel.id);
    const linhaDiesel = (await aceites(s.c)).find((l) => l.produto_id === diesel.id);

    // Retira Diesel (com histórico) e Arla (sem) do tanque A; Graxa do B (sem).
    const sem = await ok(patchBem(s, trator, { tanques: tanquesDe(trator, { 0: [], 1: [] }) }));
    assert.deepEqual(sem.tanques.map((t) => t.produtos), [[], []], 'a forma pública só mostra os aceites ativos');
    const depois = await aceites(s.c);
    assert.deepEqual(depois.map((l) => [l.id, l.produto_id, l.ativo]), [[linhaDiesel.id, diesel.id, false]], 'só a linha com histórico ficou, desligada');
    assert.ok(await prisma().abastecimentoBem.findUnique({ where: { id: hist.id } }), 'o histórico continua apontando o par');
    const audit = await prisma().auditLog.findFirst({ where: { cliente_id: s.c, entidade: 'BemPatrimonial', entidade_id: trator.id, acao: 'update' } });
    assert.deepEqual(/** @type {any} */ (audit.dados_novos).tanques.map((t) => t.produto_ids), [[], []]);

    // Recoloca Diesel (mesma linha, ativo de novo) e Arla (linha nova).
    const volta = await ok(patchBem(s, sem, { tanques: tanquesDe(sem, { 0: [arla.id, diesel.id] }) }));
    assert.deepEqual(volta.tanques[0].produtos.map((p) => p.nome), ['Arla 32', 'Diesel S10']);
    const agora = await aceites(s.c);
    const dieselDeNovo = agora.find((l) => l.produto_id === diesel.id);
    assert.deepEqual([dieselDeNovo.id, dieselDeNovo.ativo], [linhaDiesel.id, true], 'reativar = a mesma linha');
    assert.equal(agora.length, 2);
    assert.equal(volta.versao, 3);
    // FK do abastecimento segura o par: apagar a linha à força é recusado pelo banco.
    await assert.rejects(() => prisma().$executeRawUnsafe(`DELETE FROM "TanqueBemProduto" WHERE id = '${linhaDiesel.id}'`), /foreign key|violates/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('T5 — reativação revalida os aceites (achado D1)', () => {
  test('tanque inativo com Produto que mudou de fazenda/unidade: reativar → 422 com o reason; retirando no mesmo PATCH → 200; bem inativo idem (com e sem `tanques` no corpo)', async () => {
    const s = await montarPatrimonio(app);
    const diesel = await produtoL(s, { nome: 'Diesel S10' });
    const graxa = await produtoKG(s, { nome: 'Graxa' });
    const trator = await criarOk(s, corpoTrator(s, {
      tanques: [tanqueCom([diesel.id]), tanqueCom([graxa.id], { identificador: 'Reserva', capacidade_litros: '30' })],
    }));
    // Inativa o tanque A (o aceite segue ativo nele).
    const inat = await ok(patchBem(s, trator, { tanques: tanquesDe(trator).map((t, i) => (i === 0 ? { ...t, ativo: false } : t)) }));
    assert.deepEqual([inat.tanques[0].ativo, inat.tanques[0].produtos.length], [false, 1]);
    // O Produto vai para a outra fazenda enquanto o tanque está inativo (troca do Produto simulada no banco).
    await prisma().produto.update({ where: { id: diesel.id }, data: { empresa_id: s.e2.id } });
    const antes = await fotoPatrimonio(s.c);
    const reativa = await patchBem(s, inat, { tanques: tanquesDe(inat).map((t) => ({ ...t, ativo: true })) });
    assert.deepEqual(erro(reativa), [422, 'TANQUE_PRODUTO_INVALIDO', 'tanques[0].produto_ids', 'outra_empresa'], reativa.body);
    assert.equal(reativa.json().details.produto_id, diesel.id);
    // Unidade que deixou de ser L/KG também é pega.
    await prisma().produto.update({ where: { id: diesel.id }, data: { empresa_id: s.e1.id, unidade_principal_estoque: 'SACO' } });
    assert.deepEqual(erro(await patchBem(s, inat, { tanques: tanquesDe(inat).map((t) => ({ ...t, ativo: true })) })).slice(0, 4), [422, 'TANQUE_PRODUTO_INVALIDO', 'tanques[0].produto_ids', 'unidade_incompativel']);
    assert.equal(await fotoPatrimonio(s.c), antes, 'as recusas não gravaram nada');
    // Mantido num tanque que SEGUE inativo: não é revalidado (editar o tanque inativo ou outra coisa passa).
    const outraCoisa = await ok(patchBem(s, inat, { observacoes: 'revisão', tanques: tanquesDe(inat).map((t, i) => (i === 0 ? { ...t, capacidade_litros: '190' } : t)) }));
    assert.deepEqual([outraCoisa.versao, outraCoisa.tanques[0].ativo, outraCoisa.tanques[0].capacidade_litros], [3, false, '190.0000']);
    await prisma().produto.update({ where: { id: diesel.id }, data: { empresa_id: s.e2.id, unidade_principal_estoque: 'L' } });
    // Retirando o Produto no mesmo PATCH, o tanque volta.
    const volta = await ok(patchBem(s, outraCoisa, { tanques: tanquesDe(outraCoisa, { 0: [] }).map((t) => ({ ...t, ativo: true })) }));
    assert.deepEqual([volta.tanques[0].ativo, volta.tanques[0].produtos], [true, []]);

    // Bem inativo: o aceite de um tanque ativo vale de novo ao reativar o bem.
    const bemInativo = await ok(patchBem(s, volta, { ativo: false }));
    assert.equal(bemInativo.ativo, false);
    await prisma().produto.update({ where: { id: graxa.id }, data: { empresa_id: s.e2.id } });
    const semTanques = await patchBem(s, bemInativo, { ativo: true });
    assert.deepEqual(erro(semTanques), [422, 'TANQUE_PRODUTO_INVALIDO', 'tanques[1].produto_ids', 'outra_empresa'], `reativar o bem sem tanques no corpo: ${semTanques.body}`);
    const comTanques = await patchBem(s, bemInativo, { ativo: true, tanques: tanquesDe(bemInativo) });
    assert.deepEqual(erro(comTanques).slice(0, 4), [422, 'TANQUE_PRODUTO_INVALIDO', 'tanques[1].produto_ids', 'outra_empresa']);
    const reativado = await ok(patchBem(s, bemInativo, { ativo: true, tanques: tanquesDe(bemInativo, { 1: [] }) }));
    assert.deepEqual([reativado.ativo, reativado.tanques[1].produtos], [true, []]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('T6 — opções de Produtos para o tanque (achado D12)', () => {
  test('só ativos, da fazenda, L ou KG; `unidade` filtra; busca por nome ou código; keyset estável; empresa obrigatória; outro tenant nunca aparece', async () => {
    const s = await montarPatrimonio(app);
    const outro = await montarPatrimonio(app);
    const criados = {
      b: await produtoL(s, { nome: 'B Diesel S10', codigo_interno: 'DS10' }),
      a: await produtoKG(s, { nome: 'A Graxa' }),
      c: await produtoL(s, { nome: 'C Gasolina' }),
      d: await produtoKG(s, { nome: 'D Sal mineral' }),
    };
    await produto(s, 'SACO', { nome: 'E Ração ensacada' });
    await produtoL(s, { nome: 'F Inativo', ativo: false });
    await produtoL(s, { empresa: s.e2, nome: 'G Fazenda 2' });
    await produto(s, 'UN', { nome: 'H Unidade' });
    await produtoL(outro, { nome: 'B Diesel alheio' });
    const url = (q = '') => `/bens-patrimoniais-opcoes/produtos?empresa_id=${s.e1.id}${q}`;
    const tudo = await ok(req('GET', url(), s.token));
    assert.deepEqual(tudo.itens.map((i) => i.nome), ['A Graxa', 'B Diesel S10', 'C Gasolina', 'D Sal mineral']);
    assert.deepEqual(tudo.itens[1], { id: criados.b.id, nome: 'B Diesel S10', codigo_interno: 'DS10', unidade_principal_estoque: 'L' });
    assert.deepEqual([tudo.has_more, tudo.next_cursor], [false, null]);
    assert.deepEqual((await ok(req('GET', url('&unidade=L'), s.token))).itens.map((i) => i.nome), ['B Diesel S10', 'C Gasolina']);
    assert.deepEqual((await ok(req('GET', url('&unidade=KG'), s.token))).itens.map((i) => i.nome), ['A Graxa', 'D Sal mineral']);
    assert.deepEqual((await ok(req('GET', url('&q=ds10'), s.token))).itens.map((i) => i.id), [criados.b.id], 'busca pelo código interno');
    assert.deepEqual((await ok(req('GET', url('&q=gaso'), s.token))).itens.map((i) => i.id), [criados.c.id]);
    assert.equal((await ok(req('GET', url('&q=%25'), s.token))).itens.length, 0, 'busca literal');
    // Paginação estável (nome, id).
    const nomes = [];
    let cursor = null;
    do {
      const r = await ok(req('GET', url(`&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), s.token));
      nomes.push(...r.itens.map((i) => i.nome));
      cursor = r.next_cursor;
      assert.equal(r.has_more, cursor !== null);
    } while (cursor);
    assert.deepEqual(nomes, ['A Graxa', 'B Diesel S10', 'C Gasolina', 'D Sal mineral']);
    for (const [rotulo, u] of [
      ['sem empresa', '/bens-patrimoniais-opcoes/produtos'], ['unidade SACO', url('&unidade=SACO')], ['campo extra', url('&tipo=1')], ['cursor adulterado', url('&cursor=bGl4bw')],
      ['limit 101', url('&limit=101')],
    ]) {
      assert.equal((await req('GET', u, s.token)).statusCode, 400, rotulo);
    }
    // Fazenda de outro tenant: 404 uniforme; o outro tenant só vê os seus.
    assert.deepEqual(erro(await req('GET', `/bens-patrimoniais-opcoes/produtos?empresa_id=${s.e1.id}`, outro.token)).slice(0, 2), [404, 'EMPRESA_NOT_FOUND']);
    const doOutro = await ok(req('GET', `/bens-patrimoniais-opcoes/produtos?empresa_id=${outro.e1.id}`, outro.token));
    assert.deepEqual(doOutro.itens.map((i) => i.nome), ['B Diesel alheio']);
    // A rota antiga de produtos elegíveis saiu.
    const trator = await criarOk(s, corpoTrator(s, { tanques: [tanqueCom([criados.b.id])] }));
    assert.equal((await req('GET', `/bens-patrimoniais/${trator.id}/produtos-elegiveis?empresa_id=${s.e1.id}`, s.token)).statusCode, 404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('T7 — integração com o cadastro do Produto (F4: produtoService)', () => {
  test('aceite em tanque inativo ou bem inativo não trava a troca de fazenda nem de unidade; aceite que vale trava (409); retirado sem histórico, o Produto pode ser excluído', async () => {
    const s = await montarPatrimonio(app);
    const diesel = await produtoL(s, { nome: 'Diesel S10' });
    const graxa = await produtoKG(s, { nome: 'Graxa' });
    const trator = await criarOk(s, corpoTrator(s, { tanques: [tanqueCom([diesel.id]), tanqueCom([graxa.id], { identificador: 'Reserva', capacidade_litros: '30' })] }));
    const patchProduto = (id, corpo) => req('PATCH', `/produtos/${id}`, s.token, corpo);
    // Aceite que vale (tanque ativo, bem ativo) trava a troca de fazenda.
    const trava = await patchProduto(diesel.id, { empresa_id: s.e2.id });
    assert.deepEqual(erro(trava).slice(0, 2), [409, 'PRODUTO_EM_TANQUE_PATRIMONIO'], trava.body);
    // Tanque A inativo: o aceite não vale e não trava.
    const inat = await ok(patchBem(s, trator, { tanques: tanquesDe(trator).map((t, i) => (i === 0 ? { ...t, ativo: false } : t)) }));
    assert.equal((await patchProduto(diesel.id, { empresa_id: s.e2.id })).statusCode, 200, 'aceite em tanque inativo não trava a fazenda');
    // Bem inativo: o aceite do tanque B não vale e a unidade troca (KG nunca usado → SACO, P-08).
    await ok(patchBem(s, inat, { ativo: false }));
    assert.equal((await patchProduto(graxa.id, { unidade_principal_estoque: 'SACO' })).statusCode, 200, 'aceite em bem inativo não trava a unidade');
    // Exclusão: com aceite (mesmo sem histórico) → 409 PRODUTO_DELETE_BLOCKED; retirado sem histórico (linha apagada) → excluído.
    const oleo = await produtoL(s, { nome: 'Óleo hidráulico' });
    const outroTrator = await criarOk(s, corpoTrator(s, { nome: 'Trator 3', codigo_frota: 'TP-03', tanques: [tanqueCom([oleo.id])] }));
    const bloqueado = await req('DELETE', `/produtos/${oleo.id}`, s.token);
    assert.deepEqual(erro(bloqueado).slice(0, 2), [409, 'PRODUTO_DELETE_BLOCKED'], bloqueado.body);
    assert.equal(bloqueado.json().details?.vinculo, 'tanques do patrimônio');
    await ok(patchBem(s, outroTrator, { tanques: tanquesDe(outroTrator, { 0: [] }) }));
    assert.equal(await prisma().tanqueBemProduto.count({ where: { cliente_id: s.c, produto_id: oleo.id } }), 0);
    const excluido = await req('DELETE', `/produtos/${oleo.id}`, s.token);
    assert.ok([200, 204].includes(excluido.statusCode), excluido.body);
    assert.equal(await prisma().produto.findUnique({ where: { id: oleo.id } }), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('T8 — corridas com o Produto (trava FOR KEY SHARE do acréscimo)', () => {
  /** @type {PrismaClient} */
  let aux;
  before(() => {
    aux = new PrismaClient();
  });
  after(async () => {
    await aux?.$disconnect();
  });
  /** Espera uma CONDIÇÃO observável (nunca um tempo fixo). */
  const esperar = async (cond, rotulo, ms = 5000) => {
    const limite = Date.now() + ms;
    for (;;) {
      const v = await cond();
      if (v) return v;
      if (Date.now() > limite) throw new Error(`tempo esgotado esperando: ${rotulo}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  test('exclusão, troca de fazenda e troca de unidade do Produto em voo (FOR UPDATE, como o serviço do Produto) → o POST/PATCH do bem espera e recebe 422 inexistente/outra_empresa/unidade_incompativel; nada gravado', async () => {
    const s = await montarPatrimonio(app);
    const base = await criarOk(s, corpoTrator(s, { nome: 'Trator base', codigo_frota: 'TP-50' }));
    for (const [caso, reason, viaPatch] of [
      ['exclusao', 'inexistente', false], ['fazenda', 'outra_empresa', false], ['unidade', 'unidade_incompativel', true],
    ]) {
      const alvo = await produtoL(s, { nome: `Em corrida ${caso}` });
      const antes = await fotoPatrimonio(s.c);
      /** @type {Promise<any>} */
      let pedido = Promise.resolve(null);
      await aux.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Produto" WHERE id = ${alvo.id} FOR UPDATE`;
          if (caso === 'exclusao') await tx.$executeRaw`DELETE FROM "Produto" WHERE id = ${alvo.id}`;
          if (caso === 'fazenda') await tx.$executeRaw`UPDATE "Produto" SET empresa_id = ${s.e2.id} WHERE id = ${alvo.id}`;
          if (caso === 'unidade') await tx.$executeRaw`UPDATE "Produto" SET unidade_principal_estoque = 'SACO' WHERE id = ${alvo.id}`;
          const [{ pid }] = /** @type {Array<{ pid: number }>} */ (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`);
          pedido = viaPatch
            ? patchBem(s, base, { tanques: tanquesDe(base, { 0: [alvo.id] }) })
            : req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, { codigo_frota: null, tanques: [tanqueCom([alvo.id])] }));
          await esperar(async () => {
            const l = /** @type {any[]} */ (await tx.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND ${pid}::int = ANY(pg_blocking_pids(pid))`);
            return l.length > 0;
          }, `${caso}: o bem esperando a trava do Produto`);
        },
        { maxWait: 10000, timeout: 30000 },
      );
      const r = await pedido;
      assert.deepEqual(erro(r), [422, 'TANQUE_PRODUTO_INVALIDO', 'tanques[0].produto_ids', reason], `${caso}: ${r.body}`);
      assert.equal(await fotoPatrimonio(s.c), antes, `${caso}: nada gravado`);
    }
  });
});
