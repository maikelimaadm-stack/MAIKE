/**
 * D-PROD-160 — Patrimônio UX-02: A16 `GET /patrimonio-abastecimentos-opcoes/produtos-do-bem`
 * (contrato UX-02 §2.5). PostgreSQL real, HTTP autenticado (`app.inject`),
 * cenário `montarAbastecimento` da P1-02.
 *
 * O operador escolhe o PRODUTO (nunca o tipo de combustível): o servidor deriva
 * o tipo do vínculo ATIVO na fazenda, os tanques do bem que o aceitam e o fator
 * vigente do par. Só leitura; a confirmação continua a barreira (TOCTOU).
 *
 *  PB-01 corpo exato (TP-02) e a opção → formulário → A3/A4 com o corpo de hoje
 *  PB-02 flex · PB-03 multi-tanque · PB-04 vários Produtos por tipo
 *  PB-05 sem vínculo / unidade ≠ KG · PB-06 sem fator · PB-07 inativações sem editar o bem
 *  PB-08 fazendas · PB-09 tenant e query fechada · PB-10 has_more e resumo
 *  PB-11 permissões · PB-12 histórico A→B · PB-13 opção velha (TOCTOU sequencial)
 *  PB-14 só leitura
 *
 * A corrida REAL vínculo × confirmação é o C7 de
 * `patrimonioP1AbastecimentosConcorrencia.test.mjs` (não duplicado aqui); o
 * cancelamento com produto movido de fazenda (409 `produto_mudou_de_fazenda`)
 * é o AB11 de `patrimonioP1Abastecimentos.test.mjs`.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { HOJE, acoesAbastecimento, corpoErro, corpoPrevia, erro, fotoAbastecimento, montarAbastecimento, opId, prisma } from './patrimonioP1AbastecimentoCenario.mjs';
import { TELAS, corpoGerador, corpoImplemento, corpoTrator, tudo } from './patrimonioP1Cenario.mjs';
import { formularioVazio, montarCorpoConfirmacao, montarCorpoPrevia } from '../../src/lib/abastecimentoRegras.js';

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

const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);
const vazioResumo = (motivo, extra = {}) => ({ motivo_sem_opcao: motivo, total: 0, sem_fator: 0, fora_de_kg: 0, tipos_sem_produto: [], ...extra });

/** Produtos do bem (200) com a conta dada. */
const pdb = (s, bem, extra = '', tok = s.operador.token, empresa = s.e1) => A.ok(A.produtosDoBem(tok, empresa.id, bem.id, extra));

let seq = 0;
/** Produto REAL de estoque (como o cenário da P1-02), na empresa dada. */
const novoProduto = (s, empresa, nome, unidade = 'KG') =>
  prisma().produto.create({
    data: { cliente_id: s.c, empresa_id: empresa.id, numero_produto: `UX-${(seq += 1)}-${randomUUID().slice(0, 6)}`, nome_produto: nome, unidade_principal_estoque: unidade },
  });
/** Vínculo pela API existente (R2). */
const vincular = (s, tipoId, empresa, prod) => A.ok(A.req('POST', `/patrimonio-combustiveis/${tipoId}/produtos`, s.token, { empresa_id: empresa.id, produto_id: prod.id }), 201);
const versaoDe = async (delegado, id) => (await /** @type {any} */ (prisma())[delegado].findUnique({ where: { id } })).versao;
/** Ativa/inativa o vínculo (PATCH existente, CAS por versão). */
const situacaoVinculo = async (s, vinculoId, ativo) =>
  A.ok(A.req('PATCH', `/patrimonio-combustivel-produtos/${vinculoId}`, s.token, { empresa_id: s.e1.id, versao: await versaoDe('tipoCombustivelProduto', vinculoId), ativo }));
/** Item do tanque para o PATCH do bem (P1-01). */
const itemTanque = (t, extra = {}) => ({
  id: t.id, identificador: t.identificador, capacidade_litros: t.capacidade_litros, observacao: t.observacao ?? null, combustivel_ids: t.combustiveis.map((c) => c.id), ...extra,
});
const patchBem = async (s, bemId, corpo) => {
  const b = await A.bem(s.token, s.e1.id, bemId);
  return A.ok(A.req('PATCH', `/bens-patrimoniais/${bemId}`, s.token, { empresa_id: s.e1.id, versao: b.versao, ...corpo(b) }));
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
 * Opção do servidor → formulário da tela (mapeamento EXATO do contrato §2.6;
 * `montarCorpoPrevia`/`montarCorpoConfirmacao` não mudam). O local é o único
 * com saldo de `/opcoes/locais` (como a tela auto-seleciona).
 * @param {any} s @param {any} bem item de `/opcoes/bens` ou o `bem` de A16 @param {any} item opção de A16
 * @param {Record<string, unknown>} [extra] `tanque_id` (multi-tanque), litros, leitura, data…
 */
const formDaOpcao = async (s, bem, item, extra = {}) => {
  const locais = await A.ok(A.opcoes(s.operador.token, 'locais', `empresa_id=${s.e1.id}&produto_id=${item.produto.id}`));
  assert.equal(locais.itens.length, 1, 'um local com saldo → a tela auto-seleciona');
  return {
    ...formularioVazio(HOJE),
    bem,
    produto: { ...item.produto, conversao: item.conversao, tipo_combustivel: item.tipo_combustivel, tanques: item.tanques, pronto: item.pronto },
    tipo_combustivel_id: item.tipo_combustivel.id,
    tanque_id: item.tanques.length === 1 ? item.tanques[0].id : null,
    local_estoque_id: String(locais.itens[0].local_estoque_id),
    data_operacional: '2027-06-10',
    quantidade_litros: '80',
    medidor_leitura: '1550,5',
    tanque_cheio: true,
    ...extra,
  };
};
/** Prévia → confirmação com o corpo da tela (o fator VISTO na prévia). */
const confirmarPelaTela = async (s, form, tok = s.operador.token) => {
  const previa = await A.ok(A.previa(tok, montarCorpoPrevia(s.e1.id, form)));
  assert.deepEqual(previa.bloqueios, [], JSON.stringify(previa.bloqueios));
  return { previa, r: await A.confirmar(tok, { ...montarCorpoConfirmacao(s.e1.id, form, previa.plano), operation_id: opId() }) };
};

// ─────────────────────────────────────────────────────────────────────────────
describe('PB-01..04 — opções completas (TP-02, flex, multi-tanque, vários Produtos)', () => {
  test('PB-01: TP-02 — corpo EXATO; a opção mapeada monta o MESMO corpo de hoje; A3 sem bloqueios e A4 201 com o fator da opção', async () => {
    const s = await montarAbastecimento(app);
    const r = await pdb(s, s.trator);
    const tanques = await A.ok(A.opcoes(s.operador.token, 'tanques', `empresa_id=${s.e1.id}&bem_id=${s.trator.id}`));
    assert.deepEqual(r, {
      bem: {
        id: s.trator.id, numero: s.trator.numero, codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA', ativo: true,
        medidor: { tipo: 'HORIMETRO', unidade: 'h' },
        leitura_vigente: { leitura: '1520.5000', data: '2027-06-01', origem: 'CADASTRO', abastecimento_id: null, numero: null },
      },
      itens: [{
        id: s.diesel.id,
        produto: { id: s.diesel.id, nome: 'Diesel S10 granel', codigo_interno: null, unidade_principal_estoque: 'KG' },
        tipo_combustivel: { id: s.comb.DIESEL_S10, codigo: 'DIESEL_S10', nome: 'Diesel S10' },
        conversao: { id: s.fator.diesel.id, versao: 1, sequencia: 1, kg_por_litro: '0.840000' },
        tanques: [{ id: s.trator.tanques[0].id, identificador: 'Tanque principal', capacidade_litros: '180.0000' }],
        bloqueios: [],
        pronto: true,
      }],
      has_more: false,
      next_cursor: null,
      resumo: { motivo_sem_opcao: null, total: 1, sem_fator: 0, fora_de_kg: 0, tipos_sem_produto: [] },
    });
    assert.deepEqual(r.bem, tanques.bem, 'o `bem` é EXATAMENTE o de A8 (com a leitura vigente)');

    // a tela: bem de /opcoes/bens → opção única (auto) → local único → corpo IDÊNTICO ao de hoje
    const bens = await A.ok(A.opcoes(s.operador.token, 'bens', `empresa_id=${s.e1.id}`));
    const bem = bens.itens.find((b) => b.id === s.trator.id);
    assert.deepEqual([r.itens.length, r.has_more], [1, false], 'resposta completa com 1 opção → a tela auto-seleciona');
    const form = await formDaOpcao(s, bem, r.itens[0]);
    assert.deepEqual(montarCorpoPrevia(s.e1.id, form), corpoPrevia(s), 'o corpo da API não mudou');
    const antes = await fotoAbastecimento(s.c);
    const { previa, r: r4 } = await confirmarPelaTela(s, form);
    assert.deepEqual([previa.plano.conversao.id, previa.plano.conversao.versao], [r.itens[0].conversao.id, r.itens[0].conversao.versao]);
    assert.equal(r4.statusCode, 201, r4.body);
    const det = r4.json();
    assert.deepEqual([det.conversao.id, det.conversao.versao, det.tipo_combustivel.id, det.produto.id, det.tanque.id, det.quantidade_kg],
      [s.fator.diesel.id, 1, s.comb.DIESEL_S10, s.diesel.id, s.trator.tanques[0].id, '67.2000']);
    assert.notEqual(await fotoAbastecimento(s.c), antes);
    // depois do abastecimento a leitura vigente acompanha (a mesma de A8)
    const r2 = await pdb(s, s.trator);
    assert.deepEqual(r2.bem.leitura_vigente, { leitura: '1550.5000', data: '2027-06-10', origem: 'ABASTECIMENTO', abastecimento_id: det.id, numero: det.numero });
    assert.deepEqual(r2.bem, (await A.ok(A.opcoes(s.operador.token, 'tanques', `empresa_id=${s.e1.id}&bem_id=${s.trator.id}`))).bem);
  });

  test('PB-02: flex — um tanque com Gasolina e Etanol → 2 Produtos (Etanol hidratado, Gasolina comum), cada um com o SEU tipo e o MESMO tanque', async () => {
    const s = await montarAbastecimento(app);
    const r = await pdb(s, s.caminhonete);
    const tanque = [{ id: s.caminhonete.tanques[0].id, identificador: 'Tanque', capacidade_litros: '80.0000' }];
    assert.deepEqual(r.itens.map((i) => [i.produto.nome, i.tipo_combustivel.codigo, i.tanques, i.pronto, i.conversao?.kg_por_litro]), [
      ['Etanol hidratado', 'ETANOL', tanque, true, '0.789100'],
      ['Gasolina comum', 'GASOLINA', tanque, true, '0.745000'],
    ]);
    assert.deepEqual(r.itens.map((i) => [i.id, i.tipo_combustivel.id]), [[s.etanol.id, s.comb.ETANOL], [s.gasolina.id, s.comb.GASOLINA]]);
    assert.deepEqual([r.has_more, r.next_cursor, r.resumo], [false, null, { motivo_sem_opcao: null, total: 2, sem_fator: 0, fora_de_kg: 0, tipos_sem_produto: [] }]);
  });

  test('PB-03: multi-tanque — A e B ativos (S10) + C inativo → 1 item com [A, B]; tanque S10 + tanque Gasolina → cada Produto no seu tanque; A4 no Tanque B → 201', async () => {
    const s = await montarAbastecimento(app);
    const multi = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, {
      nome: 'Trator TP-05 dois tanques', codigo_frota: 'TP-05',
      tanques: ['Tanque A', 'Tanque B', 'Tanque C'].map((identificador, i) => ({ identificador, capacidade_litros: ['100', '90', '40'][i], combustivel_ids: [s.comb.DIESEL_S10] })),
    })), 201);
    await patchBem(s, multi.id, (b) => ({ tanques: b.tanques.map((t) => itemTanque(t, { ativo: t.identificador !== 'Tanque C' })) }));
    const porNome = Object.fromEntries((await A.bem(s.token, s.e1.id, multi.id)).tanques.map((t) => [t.identificador, t]));
    const r = await pdb(s, multi);
    assert.deepEqual(r.itens.map((i) => [i.id, i.tipo_combustivel.id, i.tanques]), [[s.diesel.id, s.comb.DIESEL_S10, [
      { id: porNome['Tanque A'].id, identificador: 'Tanque A', capacidade_litros: '100.0000' },
      { id: porNome['Tanque B'].id, identificador: 'Tanque B', capacidade_litros: '90.0000' },
    ]]], 'um item por Produto, com os tanques ATIVOS que aceitam o tipo (o inativo fora)');

    const misto = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, {
      nome: 'Trator TP-06 diesel e gasolina', codigo_frota: 'TP-06',
      tanques: [
        { identificador: 'Tanque diesel', capacidade_litros: '100', combustivel_ids: [s.comb.DIESEL_S10] },
        { identificador: 'Tanque gasolina', capacidade_litros: '50', combustivel_ids: [s.comb.GASOLINA] },
      ],
    })), 201);
    const tm = Object.fromEntries(misto.tanques.map((t) => [t.identificador, t.id]));
    const r2 = await pdb(s, misto);
    assert.deepEqual(r2.itens.map((i) => [i.produto.nome, i.tipo_combustivel.codigo, i.tanques.map((t) => t.id)]), [
      ['Diesel S10 granel', 'DIESEL_S10', [tm['Tanque diesel']]],
      ['Gasolina comum', 'GASOLINA', [tm['Tanque gasolina']]],
    ]);

    // a tela pergunta "Qual tanque será abastecido?" e manda o id escolhido (B)
    const form = await formDaOpcao(s, r.bem, r.itens[0], { tanque_id: porNome['Tanque B'].id, quantidade_litros: '60' });
    const { r: r4 } = await confirmarPelaTela(s, form);
    assert.equal(r4.statusCode, 201, r4.body);
    assert.deepEqual([r4.json().tanque.id, r4.json().produto.id, r4.json().tipo_combustivel.id], [porNome['Tanque B'].id, s.diesel.id, s.comb.DIESEL_S10]);
  });

  test('PB-04: vários Produtos por tipo — "Diesel S10 posto" sem fator → 2 itens; posto sem fator (o do granel NÃO aparece nele); resumo total 2, sem_fator 1', async () => {
    const s = await montarAbastecimento(app);
    const antes = await pdb(s, s.trator);
    const posto = await novoProduto(s, s.e1, 'Diesel S10 posto');
    await vincular(s, s.comb.DIESEL_S10, s.e1, posto);
    const r = await pdb(s, s.trator);
    assert.deepEqual(r.itens.map((i) => i.produto.nome), ['Diesel S10 granel', 'Diesel S10 posto']);
    assert.deepEqual(r.itens[0], antes.itens[0], 'o granel segue intacto');
    assert.deepEqual(r.itens[1], {
      id: posto.id,
      produto: { id: posto.id, nome: 'Diesel S10 posto', codigo_interno: null, unidade_principal_estoque: 'KG' },
      tipo_combustivel: { id: s.comb.DIESEL_S10, codigo: 'DIESEL_S10', nome: 'Diesel S10' },
      conversao: null,
      tanques: antes.itens[0].tanques,
      bloqueios: ['sem_fator'],
      pronto: false,
    });
    assert.equal(await prisma().conversaoCombustivelProduto.count({ where: { cliente_id: s.c, produto_id: posto.id } }), 0, 'nenhum fator foi criado ou reaproveitado');
    assert.deepEqual(r.resumo, { motivo_sem_opcao: null, total: 2, sem_fator: 1, fora_de_kg: 0, tipos_sem_produto: [] });

    // o MESMO Produto passa de S10 para S500 (F3): o fator do par antigo (S10, granel) não serve ao par novo
    await situacaoVinculo(s, s.vinculos.diesel.id, false);
    await vincular(s, s.comb.DIESEL_S500, s.e1, s.diesel);
    const g = await pdb(s, s.gerador);
    assert.deepEqual(g.itens.map((i) => [i.id, i.tipo_combustivel.codigo, i.conversao, i.pronto]), [
      [s.diesel.id, 'DIESEL_S500', null, false],
      [posto.id, 'DIESEL_S10', null, false],
    ], 'o tipo vem do vínculo ATIVO; o fator vigente do par inativo não aparece');
    assert.deepEqual(g.resumo, { motivo_sem_opcao: null, total: 2, sem_fator: 2, fora_de_kg: 1, tipos_sem_produto: [] });
    assert.deepEqual((await pdb(s, s.trator)).itens.map((i) => i.id), [posto.id], 'o trator (só S10) deixa de oferecer o granel');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PB-05..08 — sem opção, sem fator, inativações e fazendas', () => {
  test('PB-05: combustível novo sem Produto → nenhum_produto_associado + tipos_sem_produto; gerador S10+S500 → só o diesel (fora_de_kg 1); só S500 → produto_unidade_nao_kg', async () => {
    const s = await montarAbastecimento(app);
    const bio = await A.ok(A.req('POST', '/patrimonio-combustiveis', s.token, { codigo: 'BIODIESEL_B100', nome: 'Biodiesel B100', unidade: 'L' }), 201);
    const bemBio = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoGerador(s, {
      nome: 'Gerador do biodiesel', tanques: [{ identificador: 'Tanque bio', capacidade_litros: '100', combustivel_ids: [bio.id] }],
    })), 201);
    const r = await pdb(s, bemBio);
    assert.deepEqual([r.itens, r.has_more, r.next_cursor], [[], false, null]);
    assert.deepEqual(r.resumo, vazioResumo('nenhum_produto_associado', { tipos_sem_produto: [{ id: bio.id, nome: 'Biodiesel B100' }] }));

    const g = await pdb(s, s.gerador);
    assert.deepEqual(g.itens.map((i) => [i.id, i.tipo_combustivel.codigo]), [[s.diesel.id, 'DIESEL_S10']], 'o Produto em L (S500) não entra');
    assert.deepEqual(g.resumo, { motivo_sem_opcao: null, total: 1, sem_fator: 0, fora_de_kg: 1, tipos_sem_produto: [] });

    const soS500 = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoGerador(s, {
      nome: 'Gerador só S500', tanques: [{ identificador: 'Tanque S500', capacidade_litros: '100', combustivel_ids: [s.comb.DIESEL_S500] }],
    })), 201);
    const u = await pdb(s, soS500);
    assert.deepEqual(u.itens, []);
    assert.deepEqual(u.resumo, vazioResumo('produto_unidade_nao_kg', { fora_de_kg: 1 }));
  });

  test('PB-06: sem fator — item com conversao null e pronto false (motivo null); A3 com a opção → ABASTECIMENTO_CONVERSAO_AUSENTE; nada gravado', async () => {
    const s = await montarAbastecimento(app, { fatores: false });
    const r = await pdb(s, s.trator);
    assert.deepEqual(r.itens.map((i) => [i.id, i.conversao, i.bloqueios, i.pronto]), [[s.diesel.id, null, ['sem_fator'], false]]);
    assert.deepEqual(r.resumo, { motivo_sem_opcao: null, total: 1, sem_fator: 1, fora_de_kg: 0, tipos_sem_produto: [] });
    const form = await formDaOpcao(s, r.bem, r.itens[0]);
    const antes = await fotoAbastecimento(s.c);
    const previa = await A.ok(A.previa(s.operador.token, montarCorpoPrevia(s.e1.id, form)));
    assert.deepEqual(previa.bloqueios.map((b) => [b.code, b.reason]), [['ABASTECIMENTO_CONVERSAO_AUSENTE', 'sem_conversao_vigente']]);
    assert.throws(() => montarCorpoConfirmacao(s.e1.id, form, previa.plano), /conversao_ausente_no_plano/, 'a tela não consegue montar a confirmação');
    assert.equal(await fotoAbastecimento(s.c), antes, 'nada gravado');
  });

  test('PB-07: vínculo, produto e fator mudam a elegibilidade SEM editar o bem; tipo, tanque e bem inativos → os motivos', async () => {
    const s = await montarAbastecimento(app);
    const foto = await fotoDoBem(s, s.trator.id);
    const intocado = async (passo) => assert.equal(await fotoDoBem(s, s.trator.id), foto, `${passo}: bem, tanques e TanqueBemCombustivel idênticos`);
    const s10 = [{ id: s.comb.DIESEL_S10, nome: 'Diesel S10' }];

    await situacaoVinculo(s, s.vinculos.diesel.id, false);
    let r = await pdb(s, s.trator);
    assert.deepEqual([r.itens, r.resumo], [[], vazioResumo('nenhum_produto_associado', { tipos_sem_produto: s10 })], 'vínculo inativo');
    await intocado('inativar o vínculo');
    await situacaoVinculo(s, s.vinculos.diesel.id, true);
    r = await pdb(s, s.trator);
    assert.deepEqual(r.itens.map((i) => [i.id, i.pronto, i.conversao?.id]), [[s.diesel.id, true, s.fator.diesel.id]], 'reativado volta (o fator do par não foi encerrado)');
    await intocado('reativar o vínculo');

    await A.ok(A.req('PATCH', `/produtos/${s.diesel.id}`, s.token, { ativo: false }));
    r = await pdb(s, s.trator);
    assert.deepEqual([r.itens, r.resumo], [[], vazioResumo('nenhum_produto_associado', { tipos_sem_produto: s10 })], 'produto inativo some');
    await intocado('inativar o produto');
    await A.ok(A.req('PATCH', `/produtos/${s.diesel.id}`, s.token, { ativo: true }));

    await A.ok(A.req('POST', `/patrimonio-conversoes-combustivel/${s.fator.diesel.id}/encerrar`, s.contaFator.token, { empresa_id: s.e1.id, versao: 1 }));
    r = await pdb(s, s.trator);
    assert.deepEqual(r.itens.map((i) => [i.id, i.conversao, i.pronto]), [[s.diesel.id, null, false]], 'fator encerrado → sem fator');
    assert.deepEqual(r.resumo, { motivo_sem_opcao: null, total: 1, sem_fator: 1, fora_de_kg: 0, tipos_sem_produto: [] });
    await intocado('encerrar o fator');

    await A.ok(A.req('PATCH', `/patrimonio-combustiveis/${s.comb.DIESEL_S10}`, s.token, { versao: await versaoDe('tipoCombustivel', s.comb.DIESEL_S10), ativo: false }));
    r = await pdb(s, s.trator);
    assert.deepEqual([r.itens, r.resumo], [[], vazioResumo('tanque_sem_combustivel')], 'tipo inativo');
    await A.ok(A.req('PATCH', `/patrimonio-combustiveis/${s.comb.DIESEL_S10}`, s.token, { versao: await versaoDe('tipoCombustivel', s.comb.DIESEL_S10), ativo: true }));

    await patchBem(s, s.trator.id, (b) => ({ tanques: [itemTanque(b.tanques[0], { ativo: false })] }));
    r = await pdb(s, s.trator);
    assert.deepEqual([r.itens, r.resumo], [[], vazioResumo('sem_tanque_ativo')], 'tanque inativo');
    await patchBem(s, s.trator.id, () => ({ ativo: false }));
    r = await pdb(s, s.trator);
    assert.deepEqual([r.itens, r.resumo, r.bem.ativo, r.bem.id], [[], vazioResumo('bem_inativo'), false, s.trator.id], 'bem inativo');

    // natureza sem tanque (implemento) → sem_tanque_ativo
    const impl = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoImplemento(s)), 201);
    r = await pdb(s, impl);
    assert.deepEqual([r.itens, r.resumo, r.bem.leitura_vigente], [[], vazioResumo('sem_tanque_ativo'), null]);
  });

  test('PB-08: fazendas — S10 na E1 só o diesel da E1, na E2 só o da E2 (com o fator da E2); bem da E1 pedido na E2 → 404 do inexistente; vínculo incoerente excluído', async () => {
    const s = await montarAbastecimento(app);
    const r1 = await pdb(s, s.trator);
    assert.deepEqual(r1.itens.map((i) => i.id), [s.diesel.id]);
    const bemE2 = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, { empresa_id: s.e2.id, nome: 'Trator da fazenda 2', codigo_frota: 'TF-01' })), 201);
    const r2 = await pdb(s, bemE2, '', s.token, s.e2);
    assert.deepEqual(r2.itens.map((i) => [i.id, i.tipo_combustivel.id, i.conversao?.id, i.conversao?.kg_por_litro]), [[s.diesel2.id, s.comb.DIESEL_S10, s.fator.diesel2.id, '0.840000']]);

    const inex = `x${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const sem = (r, id) => JSON.stringify(corpoErro(r)).split(id).join('<id>');
    const outraFazenda = await A.produtosDoBem(s.token, s.e2.id, s.trator.id);
    const inexistente = await A.produtosDoBem(s.token, s.e2.id, inex);
    assert.deepEqual(erro(outraFazenda), [404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO', 'bem_id', 'bem_inexistente']);
    assert.equal(sem(outraFazenda, s.trator.id), sem(inexistente, inex), 'bem de outra fazenda = inexistente (sem oráculo)');

    // vínculo incoerente: o produto "mudou" de fazenda por fora; o vínculo da E1 continua ativo
    const movido = await novoProduto(s, s.e1, 'Diesel S10 transferido');
    await vincular(s, s.comb.DIESEL_S10, s.e1, movido);
    assert.deepEqual((await pdb(s, s.trator)).itens.map((i) => i.id), [s.diesel.id, movido.id]);
    await prisma().$executeRaw`UPDATE "Produto" SET empresa_id = ${s.e2.id} WHERE id = ${movido.id}`;
    const r3 = await pdb(s, s.trator);
    assert.deepEqual([r3.itens.map((i) => i.id), r3.resumo], [[s.diesel.id], { motivo_sem_opcao: null, total: 1, sem_fator: 0, fora_de_kg: 0, tipos_sem_produto: [] }],
      'o produto de outra fazenda nunca entra, nem no resumo');
    assert.deepEqual((await pdb(s, bemE2, '', s.token, s.e2)).itens.map((i) => i.id), [s.diesel2.id], 'na E2 o vínculo da E1 não vale');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PB-09..11 — tenant, query fechada, paginação e permissões', () => {
  test('PB-09: bem e empresa de OUTRO tenant → os mesmos erros do inexistente e de A8; query fechada → 400; cursor adulterado → cursor_invalido', async () => {
    const s = await montarAbastecimento(app);
    const t = await montarAbastecimento(app);
    const fotoT = await fotoAbastecimento(t.c);
    const inex = `x${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const sem = (r, id) => JSON.stringify(corpoErro(r)).split(id).join('<id>');
    const alheio = await A.produtosDoBem(s.token, s.e1.id, t.trator.id);
    const inexistente = await A.produtosDoBem(s.token, s.e1.id, inex);
    assert.deepEqual(erro(alheio), [404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO', 'bem_id', 'bem_inexistente']);
    assert.equal(sem(alheio, t.trator.id), sem(inexistente, inex), 'bem de outro tenant = inexistente');
    assert.equal(sem(alheio, t.trator.id), sem(await A.opcoes(s.token, 'tanques', `empresa_id=${s.e1.id}&bem_id=${t.trator.id}`), t.trator.id), 'o mesmo corpo de A8');

    const empAlheia = await A.produtosDoBem(s.token, t.e1.id, s.trator.id);
    const empA8 = await A.opcoes(s.token, 'tanques', `empresa_id=${t.e1.id}&bem_id=${s.trator.id}`);
    const empInex = await A.produtosDoBem(s.token, inex, s.trator.id);
    assert.equal(empAlheia.json().code, 'EMPRESA_NOT_FOUND', empAlheia.body);
    assert.deepEqual([empAlheia.statusCode, corpoErro(empAlheia)], [empA8.statusCode, corpoErro(empA8)], 'empresa de outro tenant: o MESMO erro de A8');
    assert.deepEqual([empAlheia.statusCode, sem(empAlheia, t.e1.id)], [empInex.statusCode, sem(empInex, inex)], 'e o mesmo da empresa inexistente');

    const base = `empresa_id=${s.e1.id}&bem_id=${s.trator.id}`;
    const casos = [
      ['sem bem_id', `empresa_id=${s.e1.id}`],
      ['sem empresa_id', `bem_id=${s.trator.id}`],
      ['cliente_id', `${base}&cliente_id=${s.c}`],
      ['tipo_combustivel_id', `${base}&tipo_combustivel_id=${s.comb.DIESEL_S10}`],
      ['uso', `${base}&uso=formulario`],
      ['limit=0', `${base}&limit=0`],
      ['limit=101', `${base}&limit=101`],
      ['cursor > 2200', `${base}&cursor=${'a'.repeat(2201)}`],
      ['q > 120', `${base}&q=${'a'.repeat(121)}`],
    ];
    for (const [rotulo, query] of casos) {
      const r = await A.opcoes(s.token, 'produtos-do-bem', query);
      assert.deepEqual([r.statusCode, r.json().code], [400, 'REQUEST_VALIDATION_FAILED'], `${rotulo}: ${r.body}`);
    }
    const adulterado = await A.produtosDoBem(s.token, s.e1.id, s.trator.id, '&cursor=nao-e-um-cursor');
    assert.deepEqual(erro(adulterado), [400, 'REQUEST_VALIDATION_FAILED', 'cursor', 'cursor_invalido']);
    assert.equal(await fotoAbastecimento(t.c), fotoT, 'nada mudou no outro tenant');
  });

  test('PB-10: has_more — 3 Produtos S10, limit=1 → 3 páginas (true, true, false), união sem repetição na ordem (nome, id), resumo IGUAL nas 3; q filtra só os itens', async () => {
    const s = await montarAbastecimento(app);
    const posto = await novoProduto(s, s.e1, 'Diesel S10 posto');
    const reserva = await novoProduto(s, s.e1, 'Diesel S10 reserva');
    await vincular(s, s.comb.DIESEL_S10, s.e1, posto);
    await vincular(s, s.comb.DIESEL_S10, s.e1, reserva);
    const resumo = { motivo_sem_opcao: null, total: 3, sem_fator: 2, fora_de_kg: 0, tipos_sem_produto: [] };
    /** @type {any[]} */
    const paginas = [];
    let cursor = null;
    do {
      const r = await pdb(s, s.trator, `&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      paginas.push(r);
      cursor = r.next_cursor;
      assert.ok(paginas.length <= 3, 'no máximo 3 páginas');
    } while (cursor);
    assert.deepEqual(paginas.map((p) => [p.itens.length, p.has_more, p.next_cursor === null]), [[1, true, false], [1, true, false], [1, false, true]]);
    assert.deepEqual(paginas.map((p) => p.itens[0].id), [s.diesel.id, posto.id, reserva.id], 'ordem (nome, id), sem repetição');
    for (const p of paginas) {
      assert.deepEqual(p.resumo, resumo, 'o resumo é do conjunto inteiro');
      assert.equal(p.bem.id, s.trator.id);
    }
    const q = await pdb(s, s.trator, '&q=POSTO');
    assert.deepEqual([q.itens.map((i) => i.id), q.has_more, q.resumo], [[posto.id], false, resumo], 'q (sem caixa) filtra os itens; o resumo não muda');
    const nada = await pdb(s, s.trator, '&q=gasolina');
    assert.deepEqual([nada.itens, nada.resumo], [[], resumo], 'busca vazia não vira "nenhum produto"');
  });

  test('PB-11: permissões — só visualizar 200; sem a linha da tela (ou só a de Bens) 403 ACAO_NAO_PERMITIDA; sem token 401; nada gravado', async () => {
    const s = await montarAbastecimento(app);
    const semLinha = await s.conta(null);
    const soBens = await s.contaCom(tudo(TELAS.bens));
    const antes = await fotoAbastecimento(s.c);
    const doLeitor = await pdb(s, s.trator, '', s.leitor.token);
    assert.deepEqual(doLeitor, await pdb(s, s.trator, '', s.token), 'o leitor vê o mesmo que o administrador');
    for (const [rotulo, tok] of [['sem linha', semLinha.token], ['só pat-bens-patrimoniais (C12)', soBens.token]]) {
      const r = await A.produtosDoBem(tok, s.e1.id, s.trator.id);
      assert.deepEqual([r.statusCode, r.json().code], [403, 'ACAO_NAO_PERMITIDA'], `${rotulo}: ${r.body}`);
    }
    for (const tok of [null, 'nao.e.um.jwt']) {
      const r = await A.produtosDoBem(tok, s.e1.id, s.trator.id);
      assert.deepEqual([r.statusCode, r.json().code], [401, 'TENANT_CONTEXT_REQUIRED'], r.body);
    }
    assert.equal(await fotoAbastecimento(s.c), antes, 'nada gravado');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PB-12..14 — histórico A→B, opção velha e só leitura', () => {
  test('PB-12: A→B — confirma A; troca o vínculo para B sem tocar o bem; B sem fator recusado; fator de B → 201 com B; A velho 422; histórico A intacto; cancelar A devolve os lotes de A', async () => {
    const s = await montarAbastecimento(app);
    const tok = s.contaCancelar.token;
    const p = prisma();
    // 1) abastecimento A com a opção do endpoint
    const rA = await pdb(s, s.trator, '', tok);
    const opcaoA = rA.itens[0];
    assert.equal(opcaoA.id, s.diesel.id);
    const { r: r1 } = await confirmarPelaTela(s, await formDaOpcao(s, rA.bem, opcaoA), tok);
    assert.equal(r1.statusCode, 201, r1.body);
    const detA = r1.json();
    assert.deepEqual([detA.quantidade_kg, detA.fatias.map((f) => f.quantidade_kg)], ['67.2000', ['50.0000', '17.2000']]);
    const linhaA = async () => JSON.stringify({
      ab: await p.abastecimentoBem.findUnique({ where: { id: detA.id } }),
      fatias: await p.abastecimentoBemConsumoLote.findMany({ where: { cliente_id: s.c, abastecimento_id: detA.id }, orderBy: { ordem: 'asc' } }),
      movimento: await p.movimentacaoEstoque.findUnique({ where: { id: detA.movimentacao.id } }),
    }, replacer);
    const fotoA = await linhaA();
    const fotoBem = await fotoDoBem(s, s.trator.id);

    // 2) troca A → B no cadastro de Combustíveis (o bem não é tocado)
    await situacaoVinculo(s, s.vinculos.diesel.id, false);
    const B = await novoProduto(s, s.e1, 'Diesel S10 estoque novo');
    const loteB = await s.lote(s.e1, B, s.local, { kg: '200.0000', custo: '6.0000', dia: '2027-06-05' });
    await vincular(s, s.comb.DIESEL_S10, s.e1, B);
    assert.equal(await fotoDoBem(s, s.trator.id), fotoBem, 'bem e TanqueBemCombustivel iguais à foto');

    // 3) B aparece SEM fator (o de A não é reaproveitado) e a confirmação recusa
    const rB0 = await pdb(s, s.trator, '', tok);
    assert.deepEqual(rB0.itens.map((i) => [i.id, i.tipo_combustivel.id, i.conversao, i.pronto]), [[B.id, s.comb.DIESEL_S10, null, false]]);
    const formB0 = await formDaOpcao(s, rB0.bem, rB0.itens[0], { data_operacional: '2027-06-12', medidor_leitura: '1560', quantidade_litros: '50' });
    const antes3 = await fotoAbastecimento(s.c);
    const pB0 = await A.ok(A.previa(tok, montarCorpoPrevia(s.e1.id, formB0)));
    assert.deepEqual(pB0.bloqueios.map((b) => b.code), ['ABASTECIMENTO_CONVERSAO_AUSENTE']);
    const comFatorDeA = await A.confirmar(tok, { ...montarCorpoPrevia(s.e1.id, formB0), conversao_id: s.fator.diesel.id, conversao_versao: 1, operation_id: opId() });
    assert.deepEqual(erro(comFatorDeA).slice(0, 2), [422, 'ABASTECIMENTO_CONVERSAO_AUSENTE'], comFatorDeA.body);
    assert.equal(await fotoAbastecimento(s.c), antes3, 'nada gravado');

    // 4) fator de B → B pronto → 201 com B, fatias só nos lotes de B
    const fatorB = await A.ok(s.configurarFator(s.e1, s.comb.DIESEL_S10, B, '0.830000', null, s.contaFator.token), 201);
    const rB = await pdb(s, s.trator, '', tok);
    assert.deepEqual(rB.itens.map((i) => [i.id, i.pronto, i.conversao]), [[B.id, true, { id: fatorB.id, versao: 1, sequencia: 1, kg_por_litro: '0.830000' }]]);
    const { r: r4 } = await confirmarPelaTela(s, await formDaOpcao(s, rB.bem, rB.itens[0], { data_operacional: '2027-06-12', medidor_leitura: '1560', quantidade_litros: '50' }), tok);
    assert.equal(r4.statusCode, 201, r4.body);
    const detB = r4.json();
    assert.deepEqual([detB.produto.id, detB.kg_por_litro, detB.quantidade_kg, detB.conversao.id, detB.fatias.map((f) => [f.lote_id, f.quantidade_kg])],
      [B.id, '0.830000', '41.5000', fatorB.id, [[loteB.id, '41.5000']]], 'quantidade_kg = round(50 × 0,83, 4), só no lote de B');

    // 5) a opção VELHA de A (tela aberta antes da troca) → 422 sem_vinculo_ativo, nada gravado
    const formVelho = await formDaOpcao(s, rA.bem, opcaoA, { data_operacional: '2027-06-13', medidor_leitura: '1570', quantidade_litros: '10' });
    const antes5 = await fotoAbastecimento(s.c);
    const pVelha = await A.ok(A.previa(tok, montarCorpoPrevia(s.e1.id, formVelho)));
    assert.deepEqual(pVelha.bloqueios.map((b) => [b.code, b.reason]), [['COMBUSTIVEL_PRODUTO_INVALIDO', 'sem_vinculo_ativo']]);
    const cVelha = await A.confirmar(tok, { ...montarCorpoPrevia(s.e1.id, formVelho), conversao_id: opcaoA.conversao.id, conversao_versao: opcaoA.conversao.versao, operation_id: opId() });
    assert.deepEqual(erro(cVelha), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'sem_vinculo_ativo']);
    assert.equal(await fotoAbastecimento(s.c), antes5, 'nada gravado');

    // 6) histórico A intacto (linha, fatias, movimento) e lido como A
    assert.equal(await linhaA(), fotoA, 'AbastecimentoBem A, fatias e movimento idênticos à foto');
    const detA2 = await A.ok(A.detalhe(tok, detA.id, s.e1.id));
    assert.deepEqual([detA2.produto.id, detA2.produto.nome, detA2.kg_por_litro, detA2.conversao.id, detA2.quantidade_kg],
      [s.diesel.id, 'Diesel S10 granel', '0.840000', s.fator.diesel.id, '67.2000']);
    assert.deepEqual((await A.ok(A.lista(tok, s.e1.id, `&produto_id=${s.diesel.id}`))).items.map((i) => i.id), [detA.id]);

    // 7) cancelar A devolve os lotes de A (nunca B)
    const estoqueB = (await p.produto.findUnique({ where: { id: B.id } })).estoque_atual.toFixed(4);
    const loteBAntes = (await p.estoqueLoteNota.findUnique({ where: { id: loteB.id } })).quantidade_disponivel.toFixed(4);
    assert.deepEqual([estoqueB, loteBAntes], ['158.5000', '158.5000']);
    const canc = await A.ok(A.cancelar(tok, detA.id, { empresa_id: s.e1.id, versao: detA2.versao, motivo: 'lançado no produto errado', operation_id: opId() }));
    assert.equal(canc.status, 'CANCELADO');
    const lotesA = await p.estoqueLoteNota.findMany({ where: { id: { in: [s.lotes.dieselA.id, s.lotes.dieselB.id] } }, orderBy: { data_documento: 'asc' } });
    assert.deepEqual(lotesA.map((l) => l.quantidade_disponivel.toFixed(4)), ['50.0000', '100.0000'], 'lotes de A de volta');
    assert.equal((await p.produto.findUnique({ where: { id: s.diesel.id } })).estoque_atual.toFixed(4), '150.0000');
    assert.deepEqual([(await p.produto.findUnique({ where: { id: B.id } })).estoque_atual.toFixed(4), (await p.estoqueLoteNota.findUnique({ where: { id: loteB.id } })).quantidade_disponivel.toFixed(4)],
      [estoqueB, loteBAntes], 'lotes e estoque de B intocados');
    const estorno = await p.movimentacaoEstoque.findUnique({ where: { id: canc.estorno.id } });
    assert.equal(estorno.produto_id, s.diesel.id, 'o estorno é do Produto A');
  });

  test('PB-13: opção velha (TOCTOU sequencial) — opção A lida, vínculo A inativado → A3 bloqueia e A4 422 sem_vinculo_ativo; nada gravado (corrida real = C7)', async () => {
    const s = await montarAbastecimento(app);
    const r = await pdb(s, s.trator);
    const form = await formDaOpcao(s, r.bem, r.itens[0]);
    await situacaoVinculo(s, s.vinculos.diesel.id, false);
    const antes = await fotoAbastecimento(s.c);
    const previa = await A.ok(A.previa(s.operador.token, montarCorpoPrevia(s.e1.id, form)));
    assert.deepEqual(previa.bloqueios.map((b) => [b.code, b.reason]), [['COMBUSTIVEL_PRODUTO_INVALIDO', 'sem_vinculo_ativo']]);
    const c = await A.confirmar(s.operador.token, { ...montarCorpoPrevia(s.e1.id, form), conversao_id: r.itens[0].conversao.id, conversao_versao: r.itens[0].conversao.versao, operation_id: opId() });
    assert.deepEqual(erro(c), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'sem_vinculo_ativo']);
    assert.equal(await fotoAbastecimento(s.c), antes, 'nada gravado');
    assert.deepEqual((await pdb(s, s.trator)).itens, [], 'a releitura já não oferece A');
  });

  test('PB-14: só leitura — linhas do abastecimento, estoque, bens e auditoria idênticas depois de várias leituras (inclusive páginas e busca)', async () => {
    const s = await montarAbastecimento(app);
    await vincular(s, s.comb.DIESEL_S10, s.e1, await novoProduto(s, s.e1, 'Diesel S10 posto'));
    const antes = await fotoAbastecimento(s.c);
    const auditoria = await prisma().auditLog.count({ where: { cliente_id: s.c } });
    const p1 = await pdb(s, s.trator, '&limit=1');
    await pdb(s, s.trator, `&limit=1&cursor=${encodeURIComponent(p1.next_cursor)}`);
    await pdb(s, s.trator, '&q=granel', s.leitor.token);
    await pdb(s, s.caminhonete);
    assert.equal(await fotoAbastecimento(s.c), antes, 'nada gravado');
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: s.c } }), auditoria, 'sem auditoria de leitura');
  });
});
