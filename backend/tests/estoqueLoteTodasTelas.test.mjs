/**
 * D-PROD-282 em todas as telas — a escolha manual do lote (e o aviso de lote vencido) nas origens que tiram produto
 * do estoque fora da tela Estoque: cocho, venda do financeiro, linha de produto da atividade e abastecimento; e o lote
 * do fabricante e a validade na compra do financeiro. PostgreSQL real, pela API.
 *
 *  T0 a leitura dos lotes disponíveis (`GET /estoque/lotes-disponiveis`) é liberada a quem lança nessas telas
 *     (antes só a tela Estoque); quem não lança em nenhuma continua recebendo 403.
 *  T1 cocho: a escolha manual soma certo e sai pelo custo do lote escolhido; soma errada → 422; produto sem lote com
 *     a lista → 422; lote vencido escolhido → aviso; o cancelamento do lançamento devolve ao lote escolhido.
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
  return { ...s, sal, semLote, compra };
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
