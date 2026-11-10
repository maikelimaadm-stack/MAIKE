/**
 * D-PROD-161 (F4, §4.6) — Produto em LITROS e a troca da unidade de estoque.
 * PostgreSQL real, HTTP autenticado; a prova de "nada gravado" é a fotografia
 * das linhas do tenant.
 *
 *  P1. criar Produto em `L`; KG nunca usado ↔ L troca (200); a unidade igual à
 *      gravada não é troca;
 *  P2. padrão P-10: a troca que ENVOLVE L (de L ou para L) só passa sem
 *      histórico — 409 `PRODUTO_UNIDADE_EM_USO` com `reason`, nesta ordem:
 *      `estoque` (estoque_atual ≠ 0) → `lotes` (algum lote, mesmo esgotado) →
 *      `movimentos` → `lancamentos` (item da Gestão P3, rascunho inclusive);
 *      `details.de/para`; nada gravado;
 *  P3. KG ↔ SACO sem tanque: como hoje (P-08), mesmo com estoque e lotes;
 *  P4. unidade nova fora de {L, KG} com ACEITE QUE VALE (tanque ativo de bem
 *      ativo) → 409 `aceito_em_tanque` com `details.tanques`; aceite em tanque
 *      inativo não trava; KG aceito → L (sem histórico) passa;
 *  P5. troca de fazenda com aceite que vale → 409 `PRODUTO_EM_TANQUE_PATRIMONIO`
 *      com `details.tanques = [{ bem_id, bem_numero, tanque_id, identificador }]`;
 *      com o tanque inativo, troca;
 *  P6. exclusão com aceite → 409 `PRODUTO_DELETE_BLOCKED`
 *      (`vinculo: 'tanques do patrimônio'`), nunca 403 da FK;
 *  P7. transferência entre depósitos (achado D5): Produto em L rotula os dois
 *      movimentos `L`; os outros Produtos, `unidade_medida || 'KG'` como antes.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, docCom, foto, montarTenant, opId, prisma } from './gestaoP3Cenario.mjs';
import { corpoTrator, tanqueCom } from './patrimonioP1Cenario.mjs';

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

const porCodigo = async (delegado, c) =>
  Object.fromEntries((await delegado.findMany({ where: { cliente_id: c }, select: { id: true, codigo: true } })).map((r) => [r.codigo, r.id]));

/** Tenant da P3 (2 fazendas, parceiros, perfil BRL, locais) + catálogo padrão do Patrimônio. */
const montar = async () => {
  const s = await montarTenant(app);
  const r = await A.req('POST', '/patrimonio-catalogo-padrao', s.token, {});
  assert.equal(r.statusCode, 200, r.body);
  return { ...s, fam: await porCodigo(prisma().familiaPatrimonial, s.c), tip: await porCodigo(prisma().tipoPatrimonial, s.c) };
};

let seq = 0;
const produtoNovo = (s, unidade, extra = {}) => {
  seq += 1;
  return prisma().produto.create({
    data: { cliente_id: s.c, empresa_id: s.e1.id, numero_produto: `U${seq}`, nome_produto: `PRODUTO ${unidade} ${seq}`, unidade_principal_estoque: unidade, ...extra },
  });
};
const patch = (s, produto, corpo) => A.req('PATCH', `/produtos/${produto.id}`, s.token, corpo);
const erro = (r) => [r.statusCode, r.json().code, r.json().field ?? null, r.json().reason ?? null];
const unidadeGravada = async (produto) => (await prisma().produto.findUnique({ where: { id: produto.id } })).unidade_principal_estoque;

const lote = (s, produto, { entrada = '10', disponivel = entrada, status = 'Disponivel' } = {}) =>
  prisma().estoqueLoteNota.create({
    data: {
      cliente_id: s.c, empresa_id: s.e1.id, produto_id: produto.id, produto_nome: produto.nome_produto, local_estoque_id: s.local.id, local_estoque_nome: s.local.nome,
      data_documento: new Date('2027-06-01T00:00:00.000Z'), custo_unitario: '2.0000', quantidade_entrada: entrada, quantidade_disponivel: disponivel, status,
    },
  });
const movimento = (s, produto) =>
  prisma().movimentacaoEstoque.create({
    data: {
      cliente_id: s.c, empresa_id: s.e1.id, numero_movimentacao: `M-${produto.id}`, tipo_movimentacao: 'Entrada', data_movimentacao: new Date('2027-06-01T12:00:00.000Z'),
      produto_id: produto.id, produto_nome: produto.nome_produto, quantidade: '1', unidade_medida: 'KG', status: 'Estornada',
    },
  });

/** 409 PRODUTO_UNIDADE_EM_USO com o `reason` e `de/para`; nada gravado. */
const unidadeEmUso = async (s, produto, para, reason) => {
  const de = await unidadeGravada(produto);
  const antes = await foto(s.c);
  const r = await patch(s, produto, { empresa_id: s.e1.id, unidade_principal_estoque: para });
  assert.deepEqual(erro(r), [409, 'PRODUTO_UNIDADE_EM_USO', 'unidade_principal_estoque', reason], r.body);
  assert.deepEqual([r.json().details?.de, r.json().details?.para], [de, para], r.body);
  assert.equal(await foto(s.c), antes, 'nada gravado, nada auditado');
  assert.equal(await unidadeGravada(produto), de);
  return r.json();
};

const criarBem = async (s, corpo) => {
  const r = await A.req('POST', '/bens-patrimoniais', s.token, corpo);
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const tanquesDoCorpo = (bem, mudar = () => ({})) =>
  bem.tanques.map((t, i) => ({ id: t.id, identificador: t.identificador, capacidade_litros: t.capacidade_litros, produto_ids: t.produtos.map((p) => p.produto_id), ativo: t.ativo, ...mudar(t, i) }));
const patchBem = async (s, bem, corpo) => {
  const r = await A.req('PATCH', `/bens-patrimoniais/${bem.id}`, s.token, { empresa_id: s.e1.id, versao: bem.versao, ...corpo });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};

// ─────────────────────────────────────────────────────────────────────────────
describe('P1 — Produto em L', () => {
  test('cria em L; KG nunca usado ↔ L troca; unidade igual à gravada não é troca (mesmo com estoque)', async () => {
    const s = await montar();
    const r = await A.req('POST', '/produtos', s.token, { empresa_id: s.e1.id, nome_produto: 'Diesel S10 (L)', unidade_principal_estoque: 'L' });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().unidade_principal_estoque, 'L');
    assert.equal(await unidadeGravada(r.json()), 'L');

    const novo = await produtoNovo(s, 'KG');
    assert.equal((await patch(s, novo, { empresa_id: s.e1.id, unidade_principal_estoque: 'L' })).statusCode, 200);
    assert.equal(await unidadeGravada(novo), 'L');
    assert.equal((await patch(s, novo, { unidade_principal_estoque: 'KG' })).statusCode, 200);
    assert.equal(await unidadeGravada(novo), 'KG');

    const comEstoque = await produtoNovo(s, 'KG', { estoque_atual: '5' });
    const mesma = await patch(s, comEstoque, { empresa_id: s.e1.id, unidade_principal_estoque: 'KG', nome_produto: 'renomeado com estoque' });
    assert.equal(mesma.statusCode, 200, mesma.body);
    assert.equal(mesma.json().nome_produto, 'RENOMEADO COM ESTOQUE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('P2 — P-10: troca envolvendo L só sem histórico', () => {
  test('estoque → lotes → movimentos → lancamentos, nos dois sentidos; nada gravado', async () => {
    const s = await montar();
    // estoque (vence lotes): KG com estoque e lote → `estoque`
    const kgEstoque = await produtoNovo(s, 'KG', { estoque_atual: '10' });
    await lote(s, kgEstoque);
    await unidadeEmUso(s, kgEstoque, 'L', 'estoque');
    // lotes: estoque 0, um lote ESGOTADO (P-10: mesmo esgotado)
    const kgLote = await produtoNovo(s, 'KG');
    await lote(s, kgLote, { disponivel: '0', status: 'Esgotado' });
    await unidadeEmUso(s, kgLote, 'L', 'lotes');
    // movimentos: sem lote, um movimento (estornado, inclusive)
    const kgMov = await produtoNovo(s, 'KG');
    await movimento(s, kgMov);
    await unidadeEmUso(s, kgMov, 'L', 'movimentos');
    // lancamentos: só um item de RASCUNHO da Gestão P3
    const kgItem = await produtoNovo(s, 'KG');
    await A.criar(s.token, docCom(s.e1, s.local, [{ produto: kgItem, quantidade: '3', valor_unitario: '2.00' }]));
    await unidadeEmUso(s, kgItem, 'L', 'lancamentos');
    // De L para KG e de L para SACO: as mesmas regras
    const lEstoque = await produtoNovo(s, 'L', { estoque_atual: '1' });
    await unidadeEmUso(s, lEstoque, 'KG', 'estoque');
    const lLote = await produtoNovo(s, 'L');
    await lote(s, lLote, { disponivel: '0', status: 'Estornado' });
    await unidadeEmUso(s, lLote, 'SACO', 'lotes');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('P3 — KG ↔ SACO sem tanque continua como hoje (P-08)', () => {
  test('KG com estoque e lote → SACO e de volta a KG: 200', async () => {
    const s = await montar();
    const p = await produtoNovo(s, 'KG', { estoque_atual: '10' });
    await lote(s, p);
    await movimento(s, p);
    const r = await patch(s, p, { empresa_id: s.e1.id, unidade_principal_estoque: 'SACO', peso_por_saco_kg: 30 });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual([r.json().unidade_principal_estoque, r.json().peso_por_saco_kg], ['SACO', 30]);
    assert.equal((await patch(s, p, { unidade_principal_estoque: 'KG' })).statusCode, 200);
    assert.equal(await unidadeGravada(p), 'KG');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('P4 — unidade fora de {L, KG} com aceite que vale', () => {
  test('aceito em tanque ativo → SACO recusado (aceito_em_tanque + tanques); KG aceito → L passa; tanque inativo não trava', async () => {
    const s = await montar();
    const graxa = await produtoNovo(s, 'KG');
    const trator = await criarBem(s, corpoTrator(s, { tanques: [tanqueCom([graxa.id], { identificador: 'Reserva' })] }));
    const corpo = await unidadeEmUso(s, graxa, 'SACO', 'aceito_em_tanque');
    assert.deepEqual(corpo.details.tanques, [{ bem_id: trator.id, bem_numero: trator.numero, tanque_id: trator.tanques[0].id, identificador: 'Reserva' }]);
    // KG → L: o abastecimento aceita L, a troca sem histórico passa (e volta).
    assert.equal((await patch(s, graxa, { unidade_principal_estoque: 'L' })).statusCode, 200);
    assert.equal((await patch(s, graxa, { unidade_principal_estoque: 'KG' })).statusCode, 200);
    // Tanque inativo: o aceite não vale e não trava a troca para SACO.
    await patchBem(s, trator, { tanques: tanquesDoCorpo(trator, () => ({ ativo: false })) });
    assert.equal((await patch(s, graxa, { unidade_principal_estoque: 'SACO' })).statusCode, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('P5 — troca de fazenda com aceite que vale', () => {
  test('409 PRODUTO_EM_TANQUE_PATRIMONIO com os tanques; nada gravado; tanque inativo → troca', async () => {
    const s = await montar();
    const diesel = await produtoNovo(s, 'L');
    const t1 = await criarBem(s, corpoTrator(s, { tanques: [tanqueCom([diesel.id])] }));
    const t2 = await criarBem(s, corpoTrator(s, { nome: 'Trator 2', codigo_frota: 'TP-09', tanques: [tanqueCom([diesel.id], { identificador: 'T-2' })] }));
    const antes = await foto(s.c);
    const r = await patch(s, diesel, { empresa_id: s.e2.id });
    assert.deepEqual(erro(r).slice(0, 2), [409, 'PRODUTO_EM_TANQUE_PATRIMONIO'], r.body);
    const tanques = [...r.json().details.tanques].sort((a, b) => a.bem_numero.localeCompare(b.bem_numero));
    assert.deepEqual(tanques, [
      { bem_id: t1.id, bem_numero: t1.numero, tanque_id: t1.tanques[0].id, identificador: 'Tanque principal' },
      { bem_id: t2.id, bem_numero: t2.numero, tanque_id: t2.tanques[0].id, identificador: 'T-2' },
    ].sort((a, b) => a.bem_numero.localeCompare(b.bem_numero)));
    assert.equal(await foto(s.c), antes, 'nada gravado');
    // Os dois tanques inativos: nenhum aceite vale e a fazenda troca.
    await patchBem(s, t1, { tanques: tanquesDoCorpo(t1, () => ({ ativo: false })) });
    await patchBem(s, t2, { tanques: tanquesDoCorpo(t2, () => ({ ativo: false })) });
    const ok = await patch(s, diesel, { empresa_id: s.e2.id });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().empresa_id, s.e2.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('P6 — exclusão com aceite em tanque', () => {
  test('409 PRODUTO_DELETE_BLOCKED pelos tanques do patrimônio (nunca 403); nada apagado', async () => {
    const s = await montar();
    const arla = await produtoNovo(s, 'L');
    await criarBem(s, corpoTrator(s, { tanques: [tanqueCom([arla.id])] }));
    const antes = await foto(s.c);
    const r = await A.req('DELETE', `/produtos/${arla.id}`, s.token);
    assert.deepEqual([r.statusCode, r.json().code, r.json().details?.vinculo, r.json().details?.quantidade], [409, 'PRODUTO_DELETE_BLOCKED', 'tanques do patrimônio', 1], r.body);
    assert.equal(await foto(s.c), antes, 'nada apagado');
    assert.equal(await prisma().produto.count({ where: { id: arla.id } }), 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('P7 — transferência entre depósitos', () => {
  test('Produto em L → movimentos L; Produto KG com unidade_medida "kg" → como antes', async () => {
    const s = await montar();
    const diesel = await produtoNovo(s, 'L', { estoque_atual: '100', unidade_medida: 'kg' });
    const racao = await produtoNovo(s, 'KG', { estoque_atual: '100', unidade_medida: 'kg' });
    const rotulos = async (produto) => {
      await lote(s, produto, { entrada: '100' });
      const r = await A.req('POST', '/movimentacoes-estoque/comandos/transferencia-locais', s.token, {
        operation_id: opId(), empresa_id: s.e1.id, produto_id: produto.id, local_origem_id: s.local.id, local_destino_id: s.local2.id, quantidade: 40,
      });
      assert.equal(r.statusCode, 201, r.body);
      const movs = await prisma().movimentacaoEstoque.findMany({ where: { cliente_id: s.c, produto_id: produto.id }, orderBy: { numero_movimentacao: 'asc' } });
      return movs.map((m) => m.unidade_medida);
    };
    assert.deepEqual(await rotulos(diesel), ['L', 'L']);
    assert.deepEqual(await rotulos(racao), ['kg', 'kg']);
  });
});
