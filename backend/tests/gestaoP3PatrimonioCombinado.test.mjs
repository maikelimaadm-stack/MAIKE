/**
 * D-PROD-158 × D-PROD-157 × D-PROD-161 — comportamento COMBINADO da Gestão
 * P3-03 (retificar/excluir lançamentos) com o Patrimônio (bens e Produtos
 * aceitos pelos tanques, D-PROD-161), que chegaram à mesma base pelo merge de
 * `main` na P3-03. Cada frente tinha os seus testes; nenhum exercitava as duas
 * juntas. PostgreSQL real, HTTP autenticado, prova pelas linhas do tenant.
 *
 *  C1. fornecedor que é parceiro de lançamento confirmado E proprietário e
 *      fornecedor de bem: DELETE → 409 PARCEIRO_EM_USO com os `details`
 *      completos (nunca 403), nada apagado; continua 409 depois da exclusão
 *      lógica do lançamento; a retificação NO_LUGAR que troca o parceiro leva
 *      só a contagem financeira para o novo parceiro, e o bem segura o antigo;
 *  C2. produto com item financeiro E aceito num tanque de bem: DELETE → 409
 *      PRODUTO_DELETE_BLOCKED (nunca 403) antes e depois de SUBSTITUIÇÃO +
 *      exclusão; trocar a fazenda → 409 PRODUTO_EM_TANQUE_PATRIMONIO; com
 *      rascunho, o bloqueio financeiro vem primeiro e, descartado o rascunho, o
 *      aceite do tanque continua segurando;
 *  C2b. (D-PROD-161) compra P3 de diesel em L → abastecimento de 80 L (tanque de 100 L) → o
 *      cancelamento do abastecimento devolve ao MESMO lote → o cancelamento da
 *      compra estorna o lote intacto; tudo rotulado `L`;
 *  C3. permissões cruzadas: a concessão total de uma frente não abre a outra
 *      (retificar, excluir e elegibilidade × bens); `porTodas` recusa quando
 *      falta só um dos lados, mesmo numa conta com o Patrimônio inteiro; nada
 *      gravado pelas recusas; 401 sem sessão.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { ACOES_EXTRAS, ACOES_PADRAO, TELA, acoes, codigo, docCom, docSem, foto, linhaTela, montarTenant, opId, prisma } from './gestaoP3Cenario.mjs';
import { TELAS, contagens, fotoPatrimonio, tanqueCom, tudo } from './patrimonioP1Cenario.mjs';

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

// ─── apoio ──────────────────────────────────────────────────────────────────
const porCodigo = async (delegado, c) =>
  Object.fromEntries((await delegado.findMany({ where: { cliente_id: c }, select: { id: true, codigo: true } })).map((r) => [r.codigo, r.id]));

/** Tenant da P3 (2 fazendas, parceiros, produtos, perfil BRL) + catálogo padrão do Patrimônio instalado pelo endpoint. */
const montar = async () => {
  const s = await montarTenant(app);
  const r = await A.req('POST', '/patrimonio-catalogo-padrao', s.token, {});
  assert.equal(r.statusCode, 200, r.body);
  const p = prisma();
  return { ...s, fam: await porCodigo(p.familiaPatrimonial, s.c), tip: await porCodigo(p.tipoPatrimonial, s.c) };
};
/** Trator com um tanque de 100 L que aceita os Produtos dados (D-PROD-161; P-01: pode ser nenhum). */
const trator = (s, e, extra = {}, produtoIds = []) => ({
  empresa_id: e.id,
  nome: `Trator ${randomUUID().slice(0, 6)}`,
  familia_id: s.fam.MAQUINAS,
  tipo_id: s.tip.TRATOR_PNEUS,
  medidor: { tipo: 'HORIMETRO', leitura_inicial: '10', data_leitura: '2027-06-01' },
  tanques: [tanqueCom(produtoIds, { identificador: 'T1', capacidade_litros: '100' })],
  ...extra,
});
const criarBem = async (s, corpo, tok = s.token) => {
  const r = await A.req('POST', '/bens-patrimoniais', tok, corpo);
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const parceiroNovo = (s, e, numero, nome) =>
  prisma().fornecedor.create({ data: { cliente_id: s.c, empresa_id: e.id, numero_cadastro: numero, tipo_pessoa: 'Jurídica', nome, tipos: ['fornecedor'] } });
const retificarReq = (tok, d, doc, extra = {}) =>
  A.req('POST', `/operacoes-financeiras/${d.id}/retificar`, tok, { ...doc, versao: d.versao, operation_id: opId(), motivo: 'correção combinada', ...extra });
const excluirReq = (tok, d, empresaId, extra = {}) =>
  A.req('POST', `/operacoes-financeiras/${d.id}/excluir`, tok, { empresa_id: empresaId, versao: d.versao, operation_id: opId(), motivo: 'exclusão combinada', ...extra });
const elegReq = (tok, d, empresaId) => A.req('GET', `/operacoes-financeiras/${d.id}/elegibilidade?empresa_id=${empresaId}`, tok);

/** Estado do tenant: contagem de TODAS as tabelas + linhas completas do financeiro/estoque e do Patrimônio (com a auditoria). */
const estado = async (c) => JSON.stringify([await contagens(c), await foto(c), await fotoPatrimonio(c)]);

/** DELETE /fornecedores/:id → 409 PARCEIRO_EM_USO com exatamente estes `details`; nada muda no tenant. */
const parceiroEmUso = async (s, id, details) => {
  const antes = await estado(s.c);
  const r = await A.req('DELETE', `/fornecedores/${id}`, s.token);
  assert.deepEqual([r.statusCode, codigo(r)], [409, 'PARCEIRO_EM_USO'], r.body);
  assert.deepEqual(r.json().details, details, r.body);
  assert.equal(await estado(s.c), antes, 'nada apagado, nada auditado');
};

/** DELETE /produtos/:id → 409 PRODUTO_DELETE_BLOCKED pelo vínculo dado; nada muda no tenant. */
const produtoBloqueado = async (s, produto, vinculo) => {
  const antes = await estado(s.c);
  const r = await A.req('DELETE', `/produtos/${produto.id}`, s.token);
  assert.deepEqual([r.statusCode, codigo(r), r.json().details?.vinculo, r.json().details?.id], [409, 'PRODUTO_DELETE_BLOCKED', vinculo, produto.id], r.body);
  assert.equal(await estado(s.c), antes, 'nada apagado, nada auditado');
  return r.json().details;
};

/** PATCH /produtos/:id trocando a fazenda com aceite ATIVO num tanque ativo de bem ativo → 409 PRODUTO_EM_TANQUE_PATRIMONIO; nada muda. */
const trocaDeFazendaRecusada = async (s, produto, empresaDestino, bem) => {
  const antes = await estado(s.c);
  const r = await A.req('PATCH', `/produtos/${produto.id}`, s.token, { empresa_id: empresaDestino.id });
  assert.deepEqual([r.statusCode, codigo(r), r.json().details], [409, 'PRODUTO_EM_TANQUE_PATRIMONIO', {
    id: produto.id, tanques: [{ bem_id: bem.id, bem_numero: bem.numero, tanque_id: bem.tanques[0].id, identificador: 'T1' }],
  }], r.body);
  assert.equal(await estado(s.c), antes, 'nada gravado');
};

/** Bem com um tanque que aceita o Produto (o aceite nasce pelo POST do bem, D-PROD-161). */
const aceitar = (s, e, produto) => criarBem(s, trator(s, e, {}, [produto.id]));

// ─────────────────────────────────────────────────────────────────────────────
describe('C1 — fornecedor com lançamento financeiro E bem patrimonial', () => {
  test('DELETE → 409 PARCEIRO_EM_USO com details completos (nunca 403); continua após a exclusão lógica; NO_LUGAR que troca o parceiro move só a contagem financeira', async () => {
    const s = await montar();
    const e = s.e1;
    // Compra a prazo confirmada com o parceiro (1 título) + bem ARRENDADO em que ele é proprietário E fornecedor.
    const d0 = await A.criarConfirmar(s.token, docSem(e));
    await criarBem(s, trator(s, e, { propriedade: 'ARRENDADO', proprietario_parceiro_id: e.forn.id, aquisicao: { fornecedor_parceiro_id: e.forn.id } }));
    await parceiroEmUso(s, e.forn.id, { lotes: 0, notas: 0, movimentacoes: 0, operacoes_financeiras: 1, titulos: 1, bens: 1 });

    // Exclusão LÓGICA (P3-03): o documento e o título continuam no banco (CANCELADO) → continua em uso.
    const ex = await excluirReq(s.token, d0, e.id);
    assert.equal(ex.statusCode, 200, ex.body);
    assert.equal(ex.json().status, 'CANCELADO');
    await parceiroEmUso(s, e.forn.id, { lotes: 0, notas: 0, movimentacoes: 0, operacoes_financeiras: 1, titulos: 1, bens: 1 });

    // NO_LUGAR trocando o parceiro: o antigo perde o documento e o título, mas o bem (proprietário e fornecedor) o segura;
    // o novo parceiro passa a ter o documento e o título, sem bem.
    const antigo = await parceiroNovo(s, e, '1098', 'PARCEIRO ANTIGO');
    const novo = await parceiroNovo(s, e, '1099', 'PARCEIRO NOVO');
    await criarBem(s, trator(s, e, { propriedade: 'ARRENDADO', proprietario_parceiro_id: antigo.id, aquisicao: { fornecedor_parceiro_id: antigo.id } }));
    const d1 = await A.criarConfirmar(s.token, docSem(e, { parceiro_id: antigo.id }));
    await parceiroEmUso(s, antigo.id, { lotes: 0, notas: 0, movimentacoes: 0, operacoes_financeiras: 1, titulos: 1, bens: 1 });
    const ret = await retificarReq(s.token, d1, docSem(e, { parceiro_id: novo.id }));
    assert.equal(ret.statusCode, 200, ret.body);
    assert.deepEqual([ret.json().retificacao.modo, ret.json().parceiro_id], ['NO_LUGAR', novo.id]);
    await parceiroEmUso(s, antigo.id, { lotes: 0, notas: 0, movimentacoes: 0, operacoes_financeiras: 0, titulos: 0, bens: 1 });
    await parceiroEmUso(s, novo.id, { lotes: 0, notas: 0, movimentacoes: 0, operacoes_financeiras: 1, titulos: 1, bens: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C2 — produto com item financeiro E aceito num tanque de bem', () => {
  test('DELETE → 409 PRODUTO_DELETE_BLOCKED (nunca 403) antes e depois de SUBSTITUIÇÃO + exclusão; troca de fazenda → 409 PRODUTO_EM_TANQUE_PATRIMONIO; descartado o rascunho, o aceite segura', async () => {
    const s = await montar();
    const e = s.e1;
    const bemMilho = await aceitar(s, e, e.milho);
    const d0 = await A.criarConfirmar(s.token, docCom(e, s.local, [{ produto: e.milho, quantidade: '100', valor_unitario: '2.00' }]));
    // A compra confirmada gera movimento de entrada: é o primeiro bloqueio conferido.
    await produtoBloqueado(s, e.milho, 'movimentações de estoque');
    await trocaDeFazendaRecusada(s, e.milho, s.e2, bemMilho);

    // SUBSTITUIÇÃO (a quantidade muda): documento novo com o mesmo produto; depois, exclusão lógica do novo.
    const sub = await retificarReq(s.token, d0, docCom(e, s.local, [{ produto: e.milho, quantidade: '80', valor_unitario: '2.00' }]));
    assert.equal(sub.statusCode, 200, sub.body);
    assert.equal(sub.json().retificacao.modo, 'SUBSTITUICAO');
    const ex = await excluirReq(s.token, sub.json(), e.id);
    assert.equal(ex.statusCode, 200, ex.body);
    assert.equal(ex.json().status, 'CANCELADO');
    await produtoBloqueado(s, e.milho, 'movimentações de estoque');
    await trocaDeFazendaRecusada(s, e.milho, s.e2, bemMilho);
    assert.equal(await prisma().produto.count({ where: { cliente_id: s.c, id: e.milho.id } }), 1, 'o produto continua existindo');

    // Produto aceito num tanque + rascunho (sem movimento): o bloqueio financeiro vem primeiro;
    // descartado o rascunho, só o aceite do tanque segura. (O SACO não entra em tanque: o sal, em KG.)
    const bemSal = await aceitar(s, e, e.sal);
    const rascunho = await A.criar(s.token, docCom(e, s.local, [{ produto: e.sal, unidade: 'KG', quantidade: '1', valor_unitario: '1.00' }]));
    assert.equal((await produtoBloqueado(s, e.sal, 'lançamentos financeiros')).quantidade, 1);
    const descarte = await A.req('DELETE', `/operacoes-financeiras/${rascunho.id}?empresa_id=${e.id}&versao=${rascunho.versao}`, s.token);
    assert.equal(descarte.statusCode, 204, descarte.body);
    assert.equal((await produtoBloqueado(s, e.sal, 'tanques do patrimônio')).quantidade, 1);
    await trocaDeFazendaRecusada(s, e.sal, s.e2, bemSal);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C2b — compra P3 em L → abastecimento em L → cancelamentos (D-PROD-161)', () => {
  test('lote/movimentos/estoque em L do começo ao fim; o estorno do abastecimento devolve ao mesmo lote e a compra cancela', async () => {
    const s = await montar();
    const e = s.e1;
    const p = prisma();
    const diesel = await p.produto.create({ data: { cliente_id: s.c, empresa_id: e.id, numero_produto: '9001', nome_produto: 'DIESEL S10 (L)', unidade_principal_estoque: 'L' } });
    const bem = await aceitar(s, e, diesel);
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [{ produto: diesel, unidade: 'L', quantidade: '1000', valor_unitario: '6.00' }]));
    const [lote] = await p.estoqueLoteNota.findMany({ where: { cliente_id: s.c, produto_id: diesel.id } });
    const estoque = async () => (await p.produto.findUnique({ where: { id: diesel.id } })).estoque_atual.toFixed(4);
    const disponivel = async () => (await p.estoqueLoteNota.findUnique({ where: { id: lote.id } })).quantidade_disponivel.toFixed(4);
    assert.deepEqual([lote.quantidade_entrada.toFixed(4), await estoque()], ['1000.0000', '1000.0000']);

    const ab = await A.req('POST', '/patrimonio-abastecimentos', s.token, {
      empresa_id: e.id, bem_id: bem.id, tanque_id: bem.tanques[0].id, produto_id: diesel.id, local_estoque_id: s.local.id,
      data_operacional: '2027-06-10', quantidade: '80', medidor_leitura: '12', tanque_cheio: false, observacao: null, referencia_externa: null, operation_id: opId(),
    });
    assert.equal(ab.statusCode, 201, ab.body);
    assert.deepEqual([ab.json().quantidade, ab.json().unidade], ['80.0000', 'L']);
    assert.deepEqual([await disponivel(), await estoque()], ['920.0000', '920.0000']);

    const x = await A.req('POST', `/patrimonio-abastecimentos/${ab.json().id}/cancelar`, s.token, { empresa_id: e.id, versao: ab.json().versao, motivo: 'combinado P3 × abastecimento', operation_id: opId() });
    assert.equal(x.statusCode, 200, x.body);
    assert.deepEqual([await disponivel(), await estoque()], ['1000.0000', '1000.0000']);

    const c = await A.cancelarReq(s.token, compra.id, e.id);
    assert.equal(c.statusCode, 200, c.body);
    assert.deepEqual([await disponivel(), await estoque()], ['0.0000', '0.0000']);
    const movs = await p.movimentacaoEstoque.findMany({ where: { cliente_id: s.c, produto_id: diesel.id } });
    assert.equal(movs.length, 4, 'entrada da compra, saída do abastecimento, estorno do abastecimento e estorno da compra');
    assert.ok(movs.every((m) => m.unidade_medida === 'L'), JSON.stringify(movs.map((m) => m.unidade_medida)));
    // O histórico segura o Produto (movimentos) e o aceite (FK do abastecimento): nunca 403.
    await produtoBloqueado(s, diesel, 'movimentações de estoque');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C3 — permissões cruzadas entre Patrimônio e Lançamentos Financeiros', () => {
  test('a concessão total de uma frente não abre a outra; porTodas recusa com só um dos lados mesmo com o Patrimônio inteiro; nada gravado; 401 sem sessão', async () => {
    const s = await montar();
    const e = s.e1;
    const d0 = await A.criarConfirmar(s.token, docSem(e));
    const bem = await criarBem(s, trator(s, e));
    const PATRIMONIO = Object.values(TELAS).map(tudo);
    const tudoLancamentos = Object.fromEntries([...ACOES_PADRAO, ...ACOES_EXTRAS].map((a) => [a, true]));
    const comPatrimonio = (acoesLancamento) =>
      s.conta({ modulos_permitidos: ['gestao-rural', 'patrimonio'], permissoes_telas: [linhaTela({ visualizar: true, ...acoesLancamento }), ...PATRIMONIO] });
    const soPatrimonio = await s.conta({ modulos_permitidos: ['patrimonio'], permissoes_telas: PATRIMONIO });
    const soLancamentos = await s.conta({ modulos_permitidos: ['gestao-rural'], permissoes_telas: [linhaTela(tudoLancamentos)] });
    const editarSemConfirmar = await comPatrimonio({ editar: true, salvar: true, excluir: true, cancelar: true });
    const confirmarSemEditar = await comPatrimonio({ confirmar: true, excluir: true, cancelar: true });
    const cancelarSemExcluir = await comPatrimonio({ editar: true, salvar: true, confirmar: true, cancelar: true });
    const excluirSemCancelar = await comPatrimonio({ editar: true, salvar: true, confirmar: true, excluir: true });

    // `faltam` do porTodas: rótulos `tela:ação`, alternativas da mesma exigência unidas por `|`.
    const L = (acao) => `${TELA}:${acao}`;
    const EDITAR_OU_SALVAR = `${L('editar')}|${L('salvar')}`;
    const antes = await estado(s.c);
    /** [pedido, rótulo, `faltam` esperado (só nas rotas com porTodas)] */
    const recusas = [
      [() => retificarReq(soPatrimonio.token, d0, docSem(e, { descricao: 'x' })), 'retificar com só o Patrimônio', [EDITAR_OU_SALVAR, L('confirmar')]],
      [() => excluirReq(soPatrimonio.token, d0, e.id), 'excluir com só o Patrimônio', [L('cancelar'), L('excluir')]],
      [() => elegReq(soPatrimonio.token, d0, e.id), 'elegibilidade com só o Patrimônio'],
      [() => A.req('POST', '/bens-patrimoniais', soLancamentos.token, trator(s, e)), 'criar bem com só Lançamentos'],
      [() => A.req('GET', `/bens-patrimoniais?empresa_id=${e.id}`, soLancamentos.token), 'listar bens com só Lançamentos'],
      [() => A.req('GET', `/bens-patrimoniais/${bem.id}?empresa_id=${e.id}`, soLancamentos.token), 'detalhe do bem com só Lançamentos'],
      [() => A.req('PATCH', `/bens-patrimoniais/${bem.id}`, soLancamentos.token, { empresa_id: e.id, versao: bem.versao, nome: 'RENOMEADO' }), 'editar bem com só Lançamentos'],
      [() => retificarReq(editarSemConfirmar.token, d0, docSem(e, { descricao: 'x' })), 'retificar com editar/salvar sem confirmar', [L('confirmar')]],
      [() => retificarReq(confirmarSemEditar.token, d0, docSem(e, { descricao: 'x' })), 'retificar com confirmar sem editar/salvar', [EDITAR_OU_SALVAR]],
      [() => excluirReq(cancelarSemExcluir.token, d0, e.id), 'excluir com cancelar sem excluir', [L('excluir')]],
      [() => excluirReq(excluirSemCancelar.token, d0, e.id), 'excluir com excluir sem cancelar', [L('cancelar')]],
    ];
    for (const [pedido, rotulo, faltam] of recusas) {
      const r = await pedido();
      assert.deepEqual([r.statusCode, codigo(r)], [403, 'ACAO_NAO_PERMITIDA'], `${rotulo}: ${r.body}`);
      if (faltam) assert.deepEqual(r.json().details?.faltam, faltam, `${rotulo}: ${r.body}`);
    }
    assert.equal(await estado(s.c), antes, 'nada gravado, nada auditado pelas recusas');

    // As mesmas contas fazem o que a SUA concessão cobre.
    const eleg = await elegReq(soLancamentos.token, d0, e.id);
    assert.equal(eleg.statusCode, 200, eleg.body);
    assert.equal((await A.req('GET', `/bens-patrimoniais?empresa_id=${e.id}`, soPatrimonio.token)).statusCode, 200);
    await criarBem(s, trator(s, e), editarSemConfirmar.token);
    // Os dois lados de cada porTodas: `salvar` vale por `editar`; retificar e excluir passam com as duas frentes.
    const salvarEConfirmar = await comPatrimonio({ salvar: true, confirmar: true });
    const ret = await retificarReq(salvarEConfirmar.token, d0, docSem(e, { descricao: 'ok' }));
    assert.equal(ret.statusCode, 200, ret.body);
    const cancelarEExcluir = await comPatrimonio({ cancelar: true, excluir: true });
    const ex = await excluirReq(cancelarEExcluir.token, ret.json(), e.id);
    assert.equal(ex.statusCode, 200, ex.body);

    // Sem sessão: 401 nas duas frentes.
    for (const [metodo, url, corpo] of [
      ['POST', `/operacoes-financeiras/${d0.id}/retificar`, { ...docSem(e), versao: 1, operation_id: opId(), motivo: 'x' }],
      ['POST', `/operacoes-financeiras/${d0.id}/excluir`, { empresa_id: e.id, versao: 1, operation_id: opId(), motivo: 'x' }],
      ['GET', `/operacoes-financeiras/${d0.id}/elegibilidade?empresa_id=${e.id}`, undefined],
      ['POST', '/bens-patrimoniais', trator(s, e)],
    ]) {
      const r = await A.req(metodo, url, null, corpo);
      assert.equal(r.statusCode, 401, `${metodo} ${url}: ${r.body}`);
    }
  });
});
