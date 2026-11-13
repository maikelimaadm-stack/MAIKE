/**
 * MAIKE-ESTOQUE-P1-02 (D-PROD-177) — M3: domínio FECHADO da unidade de
 * estoque {KG, SACO, L} (contrato §5 C1). PostgreSQL real, HTTP autenticado;
 * a prova de "nada gravado" é a fotografia das linhas do tenant.
 *
 *  D1. cadastro: KG, SACO e L criam (com espaços aparados); ausente → KG
 *      (como antes); 'UN', 'Litro', 'kg', 'Kg', 'CX' → 400
 *      REQUEST_VALIDATION_FAILED `unidade_invalida` (field
 *      `unidade_principal_estoque`, `permitidos`), sem número reservado nem
 *      auditoria;
 *  D2. produto LEGADO (unidade fora do domínio gravada direto no banco)
 *      continua editável reenviando a MESMA unidade ou sem ela; não troca
 *      para outra fora do domínio; troca para KG/SACO/L (sem histórico);
 *  D3. Central: item KG em Produto L, SACO sem peso, SACO em Produto KG, L em
 *      Produto KG → 422 OPERACAO_REFERENCIA_INVALIDA `unidade_invalida`
 *      (serviço, antes do plano); item KG em Produto legado ('UN', 'kg') →
 *      422 OPERACAO_VALORES_INVALIDOS `unidade_produto_invalida` (plano); KG
 *      em Produto SACO passa; nada gravado, nenhum recibo;
 *  D4. confirmar um rascunho cujo Produto virou legado → 422
 *      `unidade_produto_invalida`, sem efeito físico e SEM recibo: corrigida
 *      a unidade, a MESMA operation_id confirma de verdade (não é replay);
 *  D5. plano puro: as recusas próprias do plano (`unidade_incompativel`,
 *      `unidade_produto_invalida`) e as combinações aceitas.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, docCom, foto, fotoEstoque, montarTenant, opId, prisma } from './gestaoP3Cenario.mjs';
import { conferirInvariantes, q4 } from './estoqueP1MCenario.mjs';
import { UNIDADES_ESTOQUE } from '../src/modules/produtos/produtoService.js';
import { normalizarDocumento, planejarOperacao } from '../src/modules/financeiro/operacaoFinanceiraPlano.js';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoes>} */
let A;
before(async () => {
  app = await criarApp();
  await app.ready();
  await limparBanco();
  A = acoes(app);
});
after(async () => {
  await app.close();
  await encerrar();
});

const erro = (r) => [r.statusCode, r.json().code, r.json().field ?? r.json().details?.field ?? null, r.json().reason ?? r.json().details?.reason ?? null];
const recibos = (s, chave) => prisma().operacaoIdempotente.count({ where: { cliente_id: s.c, operation_key: chave } });
const unidadeGravada = async (id) => (await prisma().produto.findUnique({ where: { id } })).unidade_principal_estoque;
let seq = 0;
/** Produto direto no banco (legado ou com peso escolhido). */
const produtoNoBanco = (s, unidade, extra = {}) => {
  seq += 1;
  return prisma().produto.create({
    data: { cliente_id: s.c, empresa_id: s.e1.id, numero_produto: `M3${seq}`, nome_produto: `PRODUTO M3 ${seq}`, unidade_principal_estoque: unidade, ...extra },
  });
};

describe('D1 — cadastro do Produto: só KG, SACO ou L', () => {
  test('KG, SACO e L criam; espaços aparados; ausente → KG; UN/Litro/kg/Kg/CX → 400 unidade_invalida sem gravar nada (nem número, nem auditoria)', async () => {
    const s = await montarTenant(app);
    assert.deepEqual([...UNIDADES_ESTOQUE], ['KG', 'SACO', 'L']);
    for (const [informado, gravado] of [['KG', 'KG'], ['SACO', 'SACO'], ['L', 'L'], [' L ', 'L'], ['KG ', 'KG']]) {
      const r = await A.req('POST', '/produtos', s.token, { empresa_id: s.e1.id, nome_produto: `PRODUTO ${informado.trim()} ${seq++}`, unidade_principal_estoque: informado });
      assert.equal(r.statusCode, 201, `${JSON.stringify(informado)}: ${r.body}`);
      assert.equal(await unidadeGravada(r.json().id), gravado);
    }
    const semUnidade = await A.req('POST', '/produtos', s.token, { empresa_id: s.e1.id, nome_produto: 'PRODUTO SEM UNIDADE' });
    assert.equal(semUnidade.statusCode, 201, semUnidade.body);
    assert.equal(await unidadeGravada(semUnidade.json().id), 'KG', 'ausente continua virando KG (como antes)');

    for (const ruim of ['UN', 'Litro', 'kg', 'Kg', 'CX', 'LITROS', 'L L']) {
      const antes = await foto(s.c);
      const r = await A.req('POST', '/produtos', s.token, { empresa_id: s.e1.id, nome_produto: `PRODUTO RUIM ${ruim}`, unidade_principal_estoque: ruim });
      assert.deepEqual(erro(r), [400, 'REQUEST_VALIDATION_FAILED', 'unidade_principal_estoque', 'unidade_invalida'], `${ruim}: ${r.body}`);
      const det = r.json().details ?? {};
      assert.deepEqual([det.informado, det.permitidos], [ruim, ['KG', 'SACO', 'L']], `${ruim}: details`);
      assert.equal(await foto(s.c), antes, `${ruim}: nada gravado (produto, sequência, auditoria)`);
    }
  });

  test('texto vazio ou só espaços: hoje vira KG (comportamento anterior preservado pelo agente B; ver relatório)', async () => {
    const s = await montarTenant(app);
    for (const vazio of ['', '   ']) {
      const r = await A.req('POST', '/produtos', s.token, { empresa_id: s.e1.id, nome_produto: `PRODUTO VAZIO ${seq++}`, unidade_principal_estoque: vazio });
      assert.equal(r.statusCode, 201, `${JSON.stringify(vazio)}: ${r.body}`);
      assert.equal(await unidadeGravada(r.json().id), 'KG');
    }
  });
});

describe('D2 — Produto legado (fora do domínio) continua editável', () => {
  test('UN gravado: PATCH com a MESMA unidade ou sem ela → 200; para CX/Litro → 400 unidade_invalida sem mudar nada; para KG → 200; legado kg minúsculo → KG passa', async () => {
    const s = await montarTenant(app);
    const legado = await produtoNoBanco(s, 'UN');
    const patch = (corpo) => A.req('PATCH', `/produtos/${legado.id}`, s.token, corpo);
    const r1 = await patch({ nome_produto: 'LEGADO RENOMEADO', unidade_principal_estoque: 'UN' });
    assert.equal(r1.statusCode, 200, r1.body);
    const r2 = await patch({ nome_produto: 'LEGADO RENOMEADO 2' });
    assert.equal(r2.statusCode, 200, r2.body);
    const lido = await prisma().produto.findUnique({ where: { id: legado.id } });
    assert.deepEqual([lido.nome_produto, lido.unidade_principal_estoque], ['LEGADO RENOMEADO 2', 'UN']);

    for (const ruim of ['CX', 'Litro', 'un', 'kg']) {
      const antes = await foto(s.c);
      const r = await patch({ nome_produto: 'NAO DEVE GRAVAR', unidade_principal_estoque: ruim });
      assert.deepEqual(erro(r), [400, 'REQUEST_VALIDATION_FAILED', 'unidade_principal_estoque', 'unidade_invalida'], `${ruim}: ${r.body}`);
      assert.equal(await foto(s.c), antes, `${ruim}: nada mudou (nem o nome)`);
    }
    const r3 = await patch({ unidade_principal_estoque: 'KG' });
    assert.equal(r3.statusCode, 200, r3.body);
    assert.equal(await unidadeGravada(legado.id), 'KG');
    const r4 = await patch({ unidade_principal_estoque: 'UN' });
    assert.deepEqual(erro(r4), [400, 'REQUEST_VALIDATION_FAILED', 'unidade_principal_estoque', 'unidade_invalida'], 'saiu do legado: não volta para UN');

    const minusculo = await produtoNoBanco(s, 'kg');
    const m1 = await A.req('PATCH', `/produtos/${minusculo.id}`, s.token, { nome_produto: 'MINUSCULO', unidade_principal_estoque: 'kg' });
    assert.equal(m1.statusCode, 200, m1.body);
    const m2 = await A.req('PATCH', `/produtos/${minusculo.id}`, s.token, { unidade_principal_estoque: 'KG' });
    assert.equal(m2.statusCode, 200, m2.body);
    assert.equal(await unidadeGravada(minusculo.id), 'KG');
  });
});

describe('D3 — Central: unidade do item × unidade do Produto', () => {
  test('KG×L, SACO×SACO sem peso, SACO×KG, L×KG → 422 OPERACAO_REFERENCIA_INVALIDA unidade_invalida; KG×UN e KG×kg → 422 OPERACAO_VALORES_INVALIDOS unidade_produto_invalida; nada gravado, sem recibo; KG×SACO passa', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const litros = await produtoNoBanco(s, 'L');
    const sacoSemPeso = await produtoNoBanco(s, 'SACO');
    const legadoUN = await produtoNoBanco(s, 'UN');
    const legadoMin = await produtoNoBanco(s, 'kg');
    const casos = [
      ['KG em Produto L', litros, 'KG', [422, 'OPERACAO_REFERENCIA_INVALIDA', 'unidade', 'unidade_invalida'], 'L'],
      ['SACO em Produto SACO sem peso', sacoSemPeso, 'SACO', [422, 'OPERACAO_REFERENCIA_INVALIDA', 'unidade', 'unidade_invalida'], undefined],
      ['SACO em Produto KG', e.sal, 'SACO', [422, 'OPERACAO_REFERENCIA_INVALIDA', 'unidade', 'unidade_invalida'], undefined],
      ['L em Produto KG', e.sal, 'L', [422, 'OPERACAO_REFERENCIA_INVALIDA', 'unidade', 'unidade_invalida'], 'KG'],
      ['KG em Produto legado UN', legadoUN, 'KG', [422, 'OPERACAO_VALORES_INVALIDOS', 'unidade', 'unidade_produto_invalida'], 'UN'],
      ['KG em Produto legado kg', legadoMin, 'KG', [422, 'OPERACAO_VALORES_INVALIDOS', 'unidade', 'unidade_produto_invalida'], 'kg'],
    ];
    for (const [rotulo, produto, unidade, esperado, unidadeProduto] of casos) {
      const antes = await foto(s.c);
      const chave = opId();
      const corpo = docCom(e, s.local, [{ produto: e.milho, quantidade: '2', valor_unitario: '3' }, { produto, unidade, quantidade: '10', valor_unitario: '2' }]);
      const r = await A.req('POST', '/operacoes-financeiras', s.token, { ...corpo, operation_id: chave });
      assert.deepEqual(erro(r), esperado, `${rotulo}: ${r.body}`);
      const det = r.json().details ?? {};
      assert.deepEqual([det.colecao, det.indice, det.unidade_produto], ['itens', 1, unidadeProduto], `${rotulo}: details`);
      assert.equal(await foto(s.c), antes, `${rotulo}: nada gravado`);
      assert.equal(await recibos(s, chave), 0, `${rotulo}: nenhum recibo`);
    }
    // KG em Produto SACO (com peso) é aceito: o kg é a unidade física-base
    const fisico = await fotoEstoque(s.c);
    const ok = await A.criarConfirmar(s.token, docCom(e, s.local, [{ produto: e.racao, unidade: 'KG', quantidade: '45', valor_unitario: '2' }]));
    assert.equal(ok.status, 'CONFIRMADO');
    assert.notEqual(await fotoEstoque(s.c), fisico);
    const lote = await prisma().estoqueLoteNota.findUnique({ where: { id: ok.itens[0].estoque_lote_nota_id } });
    assert.deepEqual([q4(lote.quantidade_entrada), lote.produto_id], ['45.0000', e.racao.id]);
    await conferirInvariantes(s, 'D3');
  });
});

describe('D4 — confirmar com Produto que virou legado', () => {
  test('rascunho com Produto KG; a unidade vira UN no banco; confirmar → 422 unidade_produto_invalida, sem efeito físico e sem recibo; corrigida, a MESMA operation_id confirma (200, não replay) e só então é replay', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const rascunho = await A.criar(s.token, docCom(e, s.local, [{ produto: e.sal, quantidade: '10', valor_unitario: '2' }]));
    await prisma().produto.update({ where: { id: e.sal.id }, data: { unidade_principal_estoque: 'UN' } });
    const antes = await foto(s.c);
    const chave = opId();
    const corpo = { empresa_id: e.id, operation_id: chave, versao: rascunho.versao };
    const r = await A.req('POST', `/operacoes-financeiras/${rascunho.id}/confirmar`, s.token, corpo);
    assert.deepEqual(erro(r), [422, 'OPERACAO_VALORES_INVALIDOS', 'unidade', 'unidade_produto_invalida'], r.body);
    assert.equal(await foto(s.c), antes, 'nada gravado (nem lote, nem movimento, nem cache, nem recibo)');
    assert.equal(await recibos(s, chave), 0);

    await prisma().produto.update({ where: { id: e.sal.id }, data: { unidade_principal_estoque: 'KG' } });
    const r2 = await A.req('POST', `/operacoes-financeiras/${rascunho.id}/confirmar`, s.token, corpo);
    assert.equal(r2.statusCode, 200, r2.body);
    assert.equal(r2.json().replay, false, 'a recusa não deixou recibo: é a 1ª execução de verdade');
    const r3 = await A.req('POST', `/operacoes-financeiras/${rascunho.id}/confirmar`, s.token, corpo);
    assert.deepEqual([r3.statusCode, r3.json().replay], [200, true]);
    assert.equal(q4((await prisma().produto.findUnique({ where: { id: e.sal.id } })).estoque_atual), '10.0000');
    await conferirInvariantes(s, 'D4');
  });
});

// ─── D5: plano puro ─────────────────────────────────────────────────────────
const corpoPuro = (unidade) => ({
  empresa_id: 'E', direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', condicao: 'PRAZO', parceiro_id: 'F', data_emissao: '2027-06-10', data_operacional: '2027-06-10',
  efeito_fisico_confirmado: true, rateio_modo: 'PERCENTUAL', rateios: [{ natureza_id: 'N', percentual: '100' }], parcelas: [{ vencimento: '2027-07-10', valor: '20.00' }],
  itens: [{ tipo_item: 'MERCADORIA', produto_id: 'P1', local_estoque_id: 'L1', unidade, quantidade: '10', valor_unitario: '2' }],
});
const planoPuro = (unidadeItem, unidadeProduto, peso = null) => {
  const refs = { casas: 2, moeda: 'BRL', produtos: new Map([['P1', { id: 'P1', empresa_id: 'E', nome_produto: 'P', ativo: true, unidade_principal_estoque: unidadeProduto, peso_por_saco_kg: peso, estoque_atual: '0' }]]) };
  try {
    planejarOperacao(normalizarDocumento(corpoPuro(unidadeItem), 2), refs);
    return 'ok';
  } catch (x) {
    const z = /** @type {any} */ (x);
    if (z?.details?.reason === 'soma_diferente') return 'ok';
    return [z.code, z.details?.field ?? null, z.details?.reason ?? null];
  }
};

describe('D5 — plano puro: garantias próprias do plano', () => {
  test('KG×L, L×KG, SACO×KG → unidade_incompativel; Produto fora do domínio (UN, kg, " KG", null) → unidade_produto_invalida; KG×KG, KG×SACO, SACO×SACO(peso), L×L passam; SACO sem peso → quantidade_estoque_zero (como antes)', () => {
    const INC = ['OPERACAO_VALORES_INVALIDOS', 'unidade', 'unidade_incompativel'];
    const LEG = ['OPERACAO_VALORES_INVALIDOS', 'unidade', 'unidade_produto_invalida'];
    assert.deepEqual(planoPuro('KG', 'L'), INC);
    assert.deepEqual(planoPuro('L', 'KG'), INC);
    assert.deepEqual(planoPuro('SACO', 'KG', '30'), INC);
    assert.deepEqual(planoPuro('L', 'SACO', '30'), INC);
    for (const legado of ['UN', 'kg', ' KG', null]) assert.deepEqual(planoPuro('KG', legado), LEG, `Produto ${JSON.stringify(legado)}`);
    assert.deepEqual(planoPuro('L', 'UN'), LEG, 'o domínio do Produto vem antes da compatibilidade');
    for (const [item, produto, peso] of [['KG', 'KG'], ['KG', 'SACO', '30'], ['SACO', 'SACO', '30'], ['L', 'L']]) {
      assert.equal(planoPuro(item, produto, peso ?? null), 'ok', `${item}×${produto}`);
    }
    assert.deepEqual(planoPuro('SACO', 'SACO', null)?.[2], 'quantidade_estoque_zero');
  });
});
