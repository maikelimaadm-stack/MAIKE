/**
 * D-PROD-282 em todas as telas — a escolha manual do lote (e o aviso de lote vencido) nas origens que tiram produto
 * do estoque fora da tela Estoque: cocho, venda do financeiro, linha de produto da atividade e abastecimento; e o lote
 * do fabricante e a validade na compra do financeiro. PostgreSQL real, pela API.
 *
 *  T0 a leitura dos lotes disponíveis (`GET /estoque/lotes-disponiveis`) é liberada a quem lança nessas telas
 *     (antes só a tela Estoque); quem não lança em nenhuma continua recebendo 403.
 *  T1 cocho: a escolha manual soma certo e sai pelo custo do lote escolhido; soma errada → 422; produto sem lote com
 *     a lista → 422; lote vencido escolhido → aviso.
 *  T2 financeiro: a compra de produto com lote SEM `lotes_por_item` é recusada (422 lote_obrigatorio, nada gravado) — é
 *     por isso que a confirmação da tela passa a mandar o lote; com o lote e a validade, a camada nasce com eles. A
 *     prévia diz, por efeito de estoque, se o produto controla lote/validade (a tela decide os campos por ela). Venda:
 *     escolha manual pelo custo do lote; soma errada e produto sem lote com a lista → 422; vencido → aviso com o item;
 *     o cancelamento devolve ao lote escolhido; replay = gravado.
 *  T3 atividade (linha de produto): aceita `lotes` na linha (lançar, editar e os `produtos[]` do lançamento, que é o
 *     caminho dos "Jatos de hoje"); soma, produto sem lote, vencido como nas outras; editar sem mandar `lotes` (só a
 *     observação) mantém os lotes da linha; cancelar devolve aos lotes escolhidos; replay = gravado.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { http, prisma } from './patrimonioP1Cenario.mjs';
import { montarAbastecimento } from './patrimonioP1AbastecimentoCenario.mjs';
import { auditarReplayDoProduto } from '../src/modules/estoqueRecalculo/estoqueRecalculoService.js';
import { emLeituraSomente } from '../src/modules/estoqueRecalculo/estoqueRecalculoLeitor.js';

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

const hoje = () => new Date().toISOString().slice(0, 10);
const opId = () => `op-${randomUUID()}`;
const ok = (r, status = 200) => {
  assert.equal(r.statusCode, status, r.body);
  return r.json();
};
const erro = (r, status, code, reason) => {
  assert.equal(r.statusCode, status, r.body);
  const b = r.json();
  if (code) assert.equal(b.code, code, r.body);
  if (reason) assert.equal(b.reason ?? b.details?.reason, reason, r.body);
  return b;
};
const v4 = (d) => (d === null || d === undefined ? null : Number(d).toFixed(4));
const semId = (avisos) => (avisos ?? []).map((a) => Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'lote_id')));

const montar = async () => {
  const s = await montarAbastecimento(app, { lotes: false });
  const p = prisma();
  const suf = randomUUID().slice(0, 6);
  const novo = (prefixo, nome) => p.produto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_produto: `${prefixo}-${suf}`, nome_produto: `${nome} ${suf}`, unidade_principal_estoque: 'KG' } });
  const sal = await novo('SAL', 'Vermífugo');
  const semLote = await novo('SL', 'Sal comum');
  const motivosEntrada = (await H.ok(H.req('GET', '/estoque/motivos-entrada', s.token))).items;
  const compra = motivosEntrada.find((m) => m.nome === 'Compra').id;
  ok(await H.req('PUT', '/perfis-financeiros-empresa', s.token, { empresa_id: s.e1.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' }));
  ok(await H.req('PATCH', `/produtos/${sal.id}`, s.token, { controla_lote: true, controla_validade: true }));
  const grupo = await p.grupoAtividade.create({ data: { cliente_id: s.c, nome_grupo: `GRUPO ${suf}` } });
  const tipo = await p.tipoAtividade.create({ data: { cliente_id: s.c, nome_tipo: `ADUBAÇÃO ${suf}`, grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo, permite_produto: true } });
  return { ...s, sal, semLote, compra, tipo };
};

const entrar = async (x, produto, local, kg, custo, lote = null, validade = null) =>
  ok(await H.req('POST', '/estoque/entradas', x.token, {
    empresa_id: x.e1.id, operation_id: `en-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(),
    itens: [{ produto_id: produto.id, local_estoque_id: local.id, unidade: produto.unidade_principal_estoque, quantidade: kg, custo_unitario: custo, lote_fabricante: lote, data_validade: validade }],
  }), 201);
/** Camadas vigentes do produto por lote do fabricante: { LOTE: [disponível, custo] }. */
const porLote = async (produto) => {
  const ls = await prisma().estoqueLoteNota.findMany({ where: { produto_id: produto.id, status: 'Disponivel' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return Object.fromEntries(ls.map((l) => [l.lote_fabricante ?? l.id, [v4(l.quantidade_disponivel), v4(l.custo_unitario)]]));
};
const idDoLote = async (produto, lote) => (await prisma().estoqueLoteNota.findFirst({ where: { produto_id: produto.id, lote_fabricante: lote } })).id;
const provarReplay = async (x, produto) => {
  const r = await emLeituraSomente((tx) => auditarReplayDoProduto(tx, x.c, x.e1.id, produto.id));
  assert.equal(r.reproduzivel, true, JSON.stringify({ problemas: r.problemas, parada: r.parada }));
  assert.deepEqual(r.divergencias, [], JSON.stringify(r.divergencias.slice(0, 5)));
};
/** Três lotes do vermífugo no depósito: VELHO (vencido) 10 a 3; B 50 a 6 (vence antes); A 100 a 4. */
const tresLotes = async (x) => {
  await entrar(x, x.sal, x.local, '10', '3', 'VELHO', '2027-01-10');
  await entrar(x, x.sal, x.local, '50', '6', 'B', '2027-08-01');
  await entrar(x, x.sal, x.local, '100', '4', 'A', '2027-12-31');
  return { V: await idDoLote(x.sal, 'VELHO'), B: await idDoLote(x.sal, 'B'), A: await idDoLote(x.sal, 'A') };
};

// ── Permissões de leitura dos lotes ─────────────────────────────────────────
const acoesTela = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
const linhaTela = (modulo, tela, a) => ({ modulo_id: modulo, tela_id: tela, ...acoesTela(false), ...a });

describe('T0 — quem lança nas telas que tiram produto lê os lotes disponíveis', () => {
  test('cocho (chave do mapa), financeiro, atividade e abastecimento leem; só "ver o mapa" → 403', async () => {
    const x = await montar();
    await entrar(x, x.sal, x.local, '10', '3', 'A', '2027-12-31');
    const url = `/estoque/lotes-disponiveis?empresa_id=${x.e1.id}&produto_id=${x.sal.id}&local_estoque_id=${x.local.id}`;
    const mapa = (chaves) => ({
      modulos_permitidos: ['mapa'],
      permissoes_telas: [linhaTela('mapa', 'pec-mapa-geral', { visualizar: true })],
      mapa_geral_permissoes: { visualizar_lotes: true, lancar_suplementacao: false, movimentar_depositos: false, mover_lotes: false, ...chaves },
    });
    const cocho = await x.conta(mapa({ lancar_suplementacao: true }));
    const soMapa = await x.conta(mapa({}));
    const financeiro = await x.conta({ modulos_permitidos: ['gestao-rural'], permissoes_telas: [linhaTela('gestao-rural', 'ges-lancamentos-financeiros', { visualizar: true, novo: true })] });
    const atividade = await x.conta({ modulos_permitidos: ['suporte-mapa'], permissoes_telas: [linhaTela('suporte-mapa', 'op-atividades', { visualizar: true, lancar_apontamento: true })] });
    const abastecimento = await x.contaAbastecimento({ novo: true });
    for (const conta of [cocho, financeiro, atividade, abastecimento]) {
      const r = ok(await H.req('GET', url, conta.token));
      assert.deepEqual(r.lotes.map((l) => l.lote_fabricante), ['A']);
    }
    erro(await H.req('GET', url, soMapa.token), 403, 'ACAO_NAO_PERMITIDA');
    erro(await H.req('GET', url, x.leitor.token), 403, 'ACAO_NAO_PERMITIDA');
  });
});

// ── Cocho ───────────────────────────────────────────────────────────────────
const saidaCocho = (x, produto, kg, lotes) =>
  H.req('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', x.token, {
    operation_id: `sup-${randomUUID()}`, empresa_id: x.e1.id, produto_id: produto.id, local_origem_id: x.local.id, quantidade: kg,
    ponto_suplementacao_id: 'ponto-1', data_movimentacao: '2027-06-10', ...(lotes ? { lotes } : {}),
  });

describe('T1 — cocho com a escolha manual do lote', () => {
  test('12 do A + 8 do B = 20 kg → 4 × 12 + 6 × 8 = 96,0000; FEFO teria usado o VELHO; replay = gravado', async () => {
    const x = await montar();
    const L = await tresLotes(x);
    const r = ok(await saidaCocho(x, x.sal, 20, [{ estoque_lote_nota_id: L.A, quantidade: '12' }, { estoque_lote_nota_id: L.B, quantidade: '8' }]), 201);
    assert.equal(r.avisos, undefined);
    assert.equal(v4(r.movimentacao.valor_total), '96.0000');
    assert.deepEqual(r.rateio.map((f) => [f.lote_id, f.quantidade_consumida]), [[L.A, 12], [L.B, 8]]);
    assert.deepEqual(await porLote(x.sal), { VELHO: ['10.0000', '3.0000'], B: ['42.0000', '6.0000'], A: ['88.0000', '4.0000'] });
    await provarReplay(x, x.sal);
  });

  test('recusas: soma diferente → 422 lotes_nao_somam; produto sem lote com a lista → 422; nada gravado', async () => {
    const x = await montar();
    const L = await tresLotes(x);
    await entrar(x, x.semLote, x.local, '10', '2');
    erro(await saidaCocho(x, x.sal, 20, [{ estoque_lote_nota_id: L.A, quantidade: '12' }]), 422, 'ESTOQUE_LOTE_INVALIDO', 'lotes_nao_somam');
    erro(await saidaCocho(x, x.semLote, 5, [{ estoque_lote_nota_id: L.A, quantidade: '5' }]), 422, 'ESTOQUE_LOTE_INVALIDO', 'produto_sem_controle_de_lote');
    assert.deepEqual(await porLote(x.sal), { VELHO: ['10.0000', '3.0000'], B: ['50.0000', '6.0000'], A: ['100.0000', '4.0000'] });
    // Produto sem lote, sem a lista: como hoje (custo médio).
    const r = ok(await saidaCocho(x, x.semLote, 5), 201);
    assert.equal(v4(r.movimentacao.valor_total), '10.0000');
  });

  test('o lote vencido escolhido sai com aviso (nunca recusa)', async () => {
    const x = await montar();
    const L = await tresLotes(x);
    const r = ok(await saidaCocho(x, x.sal, 4, [{ estoque_lote_nota_id: L.V, quantidade: '4' }]), 201);
    assert.deepEqual(semId(r.avisos), [{ tipo: 'lote_vencido', lote: 'VELHO', validade: '2027-01-10' }]);
  });
});

// ── Financeiro ──────────────────────────────────────────────────────────────
/** Rascunho COM_PRODUTOS (PAGAR = compra de fornecedor; RECEBER = venda a cliente) com as linhas `[produto, local, kg, preço]`. */
const rascunho = async (x, direcao, linhas) => {
  const p = prisma();
  const base = { cliente_id: x.c, empresa_id: x.e1.id };
  const marca = randomUUID().slice(0, 6);
  const compra = direcao === 'PAGAR';
  const parceiro = await p.fornecedor.create({ data: { ...base, numero_cadastro: `PA-${marca}`, tipo_pessoa: 'Jurídica', nome: `Parceiro ${marca}`, tipos: [compra ? 'fornecedor' : 'cliente'] } });
  const natureza = await p.naturezaFinanceira.create({ data: { ...base, numero: `NA-${marca}`, tipo: compra ? 'DESPESA' : 'RECEITA', nome: `${compra ? 'INSUMOS' : 'VENDAS'} ${marca}` } });
  const centavos = linhas.reduce((t, [, , kg, preco]) => t + Math.round(Number(kg) * Number(preco) * 100), 0);
  const total = `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
  return ok(await H.req('POST', '/operacoes-financeiras', x.token, {
    empresa_id: x.e1.id, direcao, conteudo: 'COM_PRODUTOS', condicao: 'PRAZO', parceiro_id: parceiro.id, data_emissao: '2027-06-10', data_operacional: '2027-06-10',
    efeito_fisico_confirmado: true,
    itens: linhas.map(([produto, local, kg, preco]) => ({ tipo_item: 'MERCADORIA', produto_id: produto.id, local_estoque_id: local.id, unidade: 'KG', quantidade: kg, valor_unitario: preco })),
    rateio_modo: 'PERCENTUAL', rateios: [{ natureza_id: natureza.id, percentual: '100' }], parcelas: [{ vencimento: '2027-07-10', valor: total }],
    operation_id: opId(),
  }), 201);
};
const confirmarCom = (x, r, lotesPorItem) =>
  H.req('POST', `/operacoes-financeiras/${r.id}/confirmar`, x.token, { empresa_id: x.e1.id, operation_id: opId(), versao: r.versao, ...(lotesPorItem ? { lotes_por_item: lotesPorItem } : {}) });
const previaDe = async (x, r) => ok(await H.req('POST', `/operacoes-financeiras/${r.id}/previa`, x.token, { empresa_id: x.e1.id }));

describe('T2 — financeiro: lote na compra e escolha na venda', () => {
  test('compra de produto com lote sem lotes_por_item → 422 lote_obrigatorio, nada gravado; com lote e validade → camada com eles; sem lote, como hoje', async () => {
    const x = await montar();
    const r = await rascunho(x, 'PAGAR', [[x.sal, x.local, '40', '5'], [x.semLote, x.local, '10', '2']]);
    erro(await confirmarCom(x, r), 422, 'ESTOQUE_LOTE_OBRIGATORIO', 'lote_obrigatorio');
    assert.equal(await prisma().estoqueLoteNota.count({ where: { cliente_id: x.c } }), 0, 'nada gravado');
    erro(await confirmarCom(x, r, [{ item_ordem: 1, lote_fabricante: 'NF-77' }]), 422, 'ESTOQUE_LOTE_OBRIGATORIO', 'validade_obrigatoria');
    const c = ok(await confirmarCom(x, r, [{ item_ordem: 1, lote_fabricante: 'NF-77', data_validade: '2027-12-31' }]));
    assert.equal(c.status, 'CONFIRMADO');
    const camadas = await prisma().estoqueLoteNota.findMany({ where: { cliente_id: x.c }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(camadas.map((l) => [l.produto_id === x.sal.id ? 'sal' : 'semLote', l.lote_fabricante, l.data_validade?.toISOString().slice(0, 10) ?? null, v4(l.custo_unitario)]),
      [['sal', 'NF-77', '2027-12-31', '5.0000'], ['semLote', null, null, '2.0000']]);
  });

  test('a prévia diz, por efeito de estoque, se o produto controla lote e validade', async () => {
    const x = await montar();
    const compra = await previaDe(x, await rascunho(x, 'PAGAR', [[x.sal, x.local, '40', '5'], [x.semLote, x.local, '10', '2']]));
    assert.deepEqual(compra.plano.efeitos_estoque.entradas.map((e) => [e.item_ordem, e.controla_lote, e.controla_validade]), [[1, true, true], [2, false, false]]);
    await entrar(x, x.sal, x.local, '10', '3', 'A', '2027-12-31');
    const venda = await previaDe(x, await rascunho(x, 'RECEBER', [[x.sal, x.local, '5', '9']]));
    assert.deepEqual(venda.plano.efeitos_estoque.saidas.map((e) => [e.item_ordem, e.controla_lote, e.controla_validade]), [[1, true, true]]);
  });

  test('venda: 12 do A + 8 do B → custo 96,0000 (sem aviso); cancelar devolve aos mesmos lotes; replay = gravado', async () => {
    const x = await montar();
    const L = await tresLotes(x);
    const r = await rascunho(x, 'RECEBER', [[x.sal, x.local, '20', '9']]);
    const c = ok(await confirmarCom(x, r, [{ item_ordem: 1, lotes: [{ estoque_lote_nota_id: L.A, quantidade: '12' }, { estoque_lote_nota_id: L.B, quantidade: '8' }] }]));
    assert.equal(c.avisos, undefined);
    const mov = await prisma().movimentacaoEstoque.findFirst({ where: { cliente_id: x.c, tipo_detalhado: 'venda_financeiro' } });
    assert.equal(v4(mov.valor_total), '96.0000');
    assert.deepEqual(await porLote(x.sal), { VELHO: ['10.0000', '3.0000'], B: ['42.0000', '6.0000'], A: ['88.0000', '4.0000'] });
    await provarReplay(x, x.sal);
    ok(await H.req('POST', `/operacoes-financeiras/${r.id}/cancelar`, x.token, { empresa_id: x.e1.id, operation_id: opId(), motivo: 'lançada errada' }));
    assert.deepEqual(await porLote(x.sal), { VELHO: ['10.0000', '3.0000'], B: ['50.0000', '6.0000'], A: ['100.0000', '4.0000'] });
    await provarReplay(x, x.sal);
  });

  test('venda: soma errada → 422 lotes_nao_somam; produto sem lote com a lista → 422; vencido escolhido → aviso com item_ordem', async () => {
    const x = await montar();
    const L = await tresLotes(x);
    await entrar(x, x.semLote, x.local, '10', '2');
    const r = await rascunho(x, 'RECEBER', [[x.sal, x.local, '20', '9']]);
    erro(await confirmarCom(x, r, [{ item_ordem: 1, lotes: [{ estoque_lote_nota_id: L.A, quantidade: '12' }] }]), 422, 'ESTOQUE_LOTE_INVALIDO', 'lotes_nao_somam');
    const r2 = await rascunho(x, 'RECEBER', [[x.semLote, x.local, '5', '9']]);
    erro(await confirmarCom(x, r2, [{ item_ordem: 1, lotes: [{ estoque_lote_nota_id: L.A, quantidade: '5' }] }]), 422, 'ESTOQUE_LOTE_INVALIDO', 'produto_sem_controle_de_lote');
    assert.deepEqual(await porLote(x.sal), { VELHO: ['10.0000', '3.0000'], B: ['50.0000', '6.0000'], A: ['100.0000', '4.0000'] });
    const c = ok(await confirmarCom(x, r, [{ item_ordem: 1, lotes: [{ estoque_lote_nota_id: L.V, quantidade: '10' }, { estoque_lote_nota_id: L.A, quantidade: '10' }] }]));
    assert.deepEqual(semId(c.avisos), [{ tipo: 'lote_vencido', lote: 'VELHO', validade: '2027-01-10', item_ordem: 1 }]);
  });
});

// ── Atividade ───────────────────────────────────────────────────────────────
let seq = 0;
/** Atividade aberta + apontamento do dia 10/06/2027; lançar, editar e cancelar linha de produto. */
const atividade = async (x) => {
  const a = ok(await H.req('POST', '/atividades', x.token, {
    empresa_id: x.e1.id, nome: `Adubação ${++seq}`, tipo_atividade_id: x.tipo.id, data_inicio: '2027-06-01', data_prevista_fim: '2027-06-30',
  }), 201);
  const base = `/atividades/${a.id}/apontamentos`;
  let ap = ok(await H.req('POST', base, x.token, { empresa_id: a.empresa_id, data_operacional: '2027-06-10', area_executada_dia: '10' }), 201).apontamento;
  const guardar = (r) => {
    if (r.statusCode < 300) ap = r.json().apontamento;
    return r;
  };
  return {
    lancar: async (produto, kg, lotes) => guardar(await H.req('POST', `${base}/${ap.id}/produtos`, x.token, {
      empresa_id: a.empresa_id, versao: ap.versao, operation_id: opId(), produto_id: produto.id, local_estoque_id: x.local.id, quantidade: kg, ...(lotes ? { lotes } : {}),
    })),
    editar: async (linha, campos) => guardar(await H.req('PATCH', `${base}/${ap.id}/produtos/${linha.id}`, x.token, { empresa_id: a.empresa_id, versao: ap.versao, operation_id: opId(), ...campos })),
    cancelar: async (linha) => guardar(await H.req('POST', `${base}/${ap.id}/produtos/${linha.id}/cancelar`, x.token, { empresa_id: a.empresa_id, versao: ap.versao, operation_id: opId(), motivo: 'lançado errado' })),
    /** Lançamento novo (outro apontamento) com `produtos[]`: o caminho do registro e dos "Jatos de hoje". */
    lancamento: (produtos) => H.req('POST', base, x.token, { empresa_id: a.empresa_id, data_operacional: '2027-06-11', area_executada_dia: '5', operation_id: opId(), produtos }),
  };
};

describe('T3 — atividade: escolha do lote na linha de produto', () => {
  test('lançar 12 do A + 8 do B → 96,0000; editar só a observação mantém A e B; editar com outros lotes troca; cancelar devolve; replay = gravado', async () => {
    const x = await montar();
    const L = await tresLotes(x);
    const at = await atividade(x);
    const r = ok(await at.lancar(x.sal, '20', [{ estoque_lote_nota_id: L.A, quantidade: '12' }, { estoque_lote_nota_id: L.B, quantidade: '8' }]), 201);
    assert.equal(r.avisos, undefined);
    assert.equal(v4(r.linha.custo_total), '96.0000');
    assert.deepEqual(await porLote(x.sal), { VELHO: ['10.0000', '3.0000'], B: ['42.0000', '6.0000'], A: ['88.0000', '4.0000'] });
    // Editar só a observação: estorno exato + nova saída NOS MESMOS lotes (sem `lotes`, a escolha da linha vale).
    const e1 = ok(await at.editar(r.linha, { observacao: 'conferido' }));
    assert.equal(v4(e1.linha.custo_total), '96.0000');
    assert.deepEqual(await porLote(x.sal), { VELHO: ['10.0000', '3.0000'], B: ['42.0000', '6.0000'], A: ['88.0000', '4.0000'] });
    await provarReplay(x, x.sal);
    // Editar com outra escolha: 20 do A = 80,0000.
    const e2 = ok(await at.editar(e1.linha, { lotes: [{ estoque_lote_nota_id: L.A, quantidade: '20' }] }));
    assert.equal(v4(e2.linha.custo_total), '80.0000');
    assert.deepEqual(await porLote(x.sal), { VELHO: ['10.0000', '3.0000'], B: ['50.0000', '6.0000'], A: ['80.0000', '4.0000'] });
    // Editar a quantidade sem lotes: a escolha antiga não cabe → FEFO (VELHO 10 + B 5).
    const e3 = ok(await at.editar(e2.linha, { quantidade: '15' }));
    assert.equal(v4(e3.linha.custo_total), '60.0000');
    assert.deepEqual(semId(e3.avisos), [{ tipo: 'lote_vencido', lote: 'VELHO', validade: '2027-01-10' }]);
    await provarReplay(x, x.sal);
    ok(await at.cancelar(e3.linha));
    assert.deepEqual(await porLote(x.sal), { VELHO: ['10.0000', '3.0000'], B: ['50.0000', '6.0000'], A: ['100.0000', '4.0000'] });
    await provarReplay(x, x.sal);
  });

  test('recusas: soma diferente → 422; produto sem lote com a lista → 422; nada gravado; vencido escolhido → aviso', async () => {
    const x = await montar();
    const L = await tresLotes(x);
    await entrar(x, x.semLote, x.local, '10', '2');
    const at = await atividade(x);
    erro(await at.lancar(x.sal, '20', [{ estoque_lote_nota_id: L.A, quantidade: '12' }]), 422, 'ESTOQUE_LOTE_INVALIDO', 'lotes_nao_somam');
    erro(await at.lancar(x.semLote, '5', [{ estoque_lote_nota_id: L.A, quantidade: '5' }]), 422, 'ESTOQUE_LOTE_INVALIDO', 'produto_sem_controle_de_lote');
    assert.deepEqual(await porLote(x.sal), { VELHO: ['10.0000', '3.0000'], B: ['50.0000', '6.0000'], A: ['100.0000', '4.0000'] });
    // Produto sem lote, sem a lista: como hoje.
    assert.equal(v4(ok(await at.lancar(x.semLote, '5'), 201).linha.custo_total), '10.0000');
    const r = ok(await at.lancar(x.sal, '4', [{ estoque_lote_nota_id: L.V, quantidade: '4' }]), 201);
    assert.deepEqual(semId(r.avisos), [{ tipo: 'lote_vencido', lote: 'VELHO', validade: '2027-01-10' }]);
  });

  test('lançamento com produtos[] (registro e "Jatos de hoje") leva a escolha por linha', async () => {
    const x = await montar();
    const L = await tresLotes(x);
    const at = await atividade(x);
    const r = ok(await at.lancamento([
      { produto_id: x.sal.id, local_estoque_id: x.local.id, quantidade: '10', jato: '1', lotes: [{ estoque_lote_nota_id: L.A, quantidade: '10' }] },
      { produto_id: x.sal.id, local_estoque_id: x.local.id, quantidade: '10', jato: '2' },
    ]), 201);
    const linhas = r.apontamento.produtos.map((l) => [l.jato, v4(l.custo_total)]);
    // Jato 1: 10 do A (40,0000); jato 2 pelo FEFO: VELHO 10 (30,0000).
    assert.deepEqual(linhas, [[1, '40.0000'], [2, '30.0000']]);
    await provarReplay(x, x.sal);
  });
});

