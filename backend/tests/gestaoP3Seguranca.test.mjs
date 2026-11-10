/**
 * D-PROD-155 — P3-01 Central Única de Lançamentos: SEGURANÇA (matriz exaustiva).
 * PostgreSQL real, HTTP autenticado (`app.inject`), prova por fotografia do banco.
 *
 *  S1. 2 tenants × 2 empresas: TODA rota recusa o cruzamento com 404 uniforme
 *      (corpo idêntico ao de um id inexistente) e sem efeito algum;
 *  S2. `cliente_id` forjado no corpo/query → 400; cabeçalho/cookie ignorados;
 *  S3. referência (parceiro, natureza, centros, produto, local) de outro
 *      tenant/empresa → 422 idêntico ao de id inexistente, sem efeito;
 *  S4. matriz de permissões por ação (13 ações × 15 contas);
 *  S5. baixa no ato sem `liquidar` → 403 sem nada gravado; perfil só admin
 *      real ou `is_admin`; conta desativada → 401; permissão revogada → 403;
 *  S6. RLS ligado e zero grants públicos nas 8 tabelas;
 *  S7. INSERT/UPDATE direto recusado pelas FKs/CHECKs do banco.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import {
  ACOES_EXTRAS, ACOES_PADRAO, acoes, codigo, corpoErro, docAvista, docCom, docSem, foto, linhaTela, loteLegado, montarTenant, motivo, opId, prisma,
} from './gestaoP3Cenario.mjs';

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

const TABELAS_P3 = [
  'PerfilFinanceiroEmpresa', 'OperacaoFinanceira', 'OperacaoFinanceiraItem', 'OperacaoFinanceiraConsumoLote',
  'OperacaoFinanceiraRateio', 'TituloFinanceiro', 'LiquidacaoFinanceira', 'LiquidacaoFinanceiraEstorno',
];
const INEXISTENTE = 'cl0inexistente000000000000';

/**
 * Tenant com: lançamento confirmado (prazo) com 1 liquidação, rascunho, lote de
 * compra confirmada; devolve os ids que um atacante tentaria usar.
 */
const tenantComDados = async () => {
  const s = await montarTenant(app);
  const conf = await A.criarConfirmar(s.token, docSem(s.e1, { descricao: 'lançamento do alvo', documento_referencia: 'NF-ALVO' }));
  const liq = await A.ok(A.liquidarReq(s.token, conf.titulos[0].id, s.e1.id, { valor: '100.00' }), 201);
  const rascunho = await A.criar(s.token, docSem(s.e1, { valor_bruto: '80.00', rateios: [{ natureza_id: s.e1.desp.id, valor: '80.00' }], parcelas: [{ vencimento: '2027-07-10', valor: '80.00' }] }));
  const compra = await A.criarConfirmar(s.token, docCom(s.e1, s.local, [{ produto: s.e1.sal, quantidade: '50', valor_unitario: '2' }]));
  return { s, conf, titulo: conf.titulos[0], liquidacao: liq.titulos[0].liquidacoes[0], rascunho, compra };
};

// ─────────────────────────────────────────────────────────────────────────────
describe('S1 — isolamento entre tenants e entre empresas (404 uniforme, sem efeito)', () => {
  test('toda rota (lista, detalhe, rascunho, prévia, confirmar, cancelar, liquidar, estornar, perfil, 7 opções) recusa o cruzamento sem revelar existência', async () => {
    const alvo = await tenantComDados();
    const outro = await montarTenant(app);
    const { s } = alvo;
    const antes = await foto([s.c, outro.c]);

    /**
     * Cada rota com o id do ALVO e com um id INEXISTENTE, no contexto do
     * atacante: status 404, código esperado e corpo IDÊNTICO (nada revela que
     * o id existe em outro tenant/empresa).
     * @param {string} token @param {string} empresaId atacante
     */
    const rotasPorId = (token, empresaId, docEmpresa) => [
      ['GET detalhe', (id) => A.req('GET', `/operacoes-financeiras/${id}?empresa_id=${empresaId}`, token), alvo.conf.id, 'OPERACAO_FINANCEIRA_NOT_FOUND'],
      ['PUT rascunho', (id) => A.req('PUT', `/operacoes-financeiras/${id}`, token, { ...docSem(docEmpresa), versao: alvo.rascunho.versao }), alvo.rascunho.id, 'OPERACAO_FINANCEIRA_NOT_FOUND'],
      ['DELETE rascunho', (id) => A.req('DELETE', `/operacoes-financeiras/${id}?empresa_id=${empresaId}&versao=${alvo.rascunho.versao}`, token), alvo.rascunho.id, 'OPERACAO_FINANCEIRA_NOT_FOUND'],
      ['POST prévia', (id) => A.req('POST', `/operacoes-financeiras/${id}/previa`, token, { empresa_id: empresaId }), alvo.rascunho.id, 'OPERACAO_FINANCEIRA_NOT_FOUND'],
      ['POST confirmar', (id) => A.req('POST', `/operacoes-financeiras/${id}/confirmar`, token, { empresa_id: empresaId, operation_id: 'chave-fixa-confirmar', versao: alvo.rascunho.versao }), alvo.rascunho.id, 'OPERACAO_FINANCEIRA_NOT_FOUND'],
      ['POST cancelar', (id) => A.req('POST', `/operacoes-financeiras/${id}/cancelar`, token, { empresa_id: empresaId, operation_id: 'chave-fixa-cancelar', motivo: 'invasão' }), alvo.compra.id, 'OPERACAO_FINANCEIRA_NOT_FOUND'],
      ['POST liquidar', (id) => A.req('POST', `/titulos-financeiros/${id}/liquidacoes`, token, { empresa_id: empresaId, operation_id: 'chave-fixa-liquidar', valor: '1.00', data: '2027-06-12', metodo: 'DINHEIRO' }), alvo.titulo.id, 'TITULO_FINANCEIRO_NOT_FOUND'],
      ['POST estornar', (id) => A.req('POST', `/liquidacoes-financeiras/${id}/estorno`, token, { empresa_id: empresaId, operation_id: 'chave-fixa-estornar', motivo: 'invasão' }), alvo.liquidacao.id, 'LIQUIDACAO_FINANCEIRA_NOT_FOUND'],
      ['GET saldos', (id) => A.req('GET', `/operacoes-financeiras-opcoes/saldos?empresa_id=${empresaId}&produto_id=${id}`, token), s.e1.sal.id, 'PRODUTO_NOT_FOUND'],
    ];
    const conferir = async (rotulo, token, empresaId, docEmpresa) => {
      for (const [nome, chamar, id, esperado] of rotasPorId(token, empresaId, docEmpresa)) {
        const r = await chamar(id);
        const controle = await chamar(INEXISTENTE);
        assert.equal(r.statusCode, 404, `${rotulo} ${nome}: ${r.body}`);
        assert.equal(codigo(r), esperado, `${rotulo} ${nome}`);
        assert.deepEqual(corpoErro(r), corpoErro(controle), `${rotulo} ${nome}: corpo igual ao de id inexistente`);
      }
    };
    // (a) outro tenant, com a empresa DELE; (b) mesmo tenant, OUTRA empresa.
    await conferir('outro tenant', outro.token, outro.e1.id, outro.e1);
    await conferir('outra empresa', s.token, s.e2.id, s.e2);

    // (c) outro tenant usando a empresa do alvo: EMPRESA_NOT_FOUND idêntico ao de empresa inexistente.
    const comEmpresa = (empresaId) => [
      ['GET lista', () => A.req('GET', `/operacoes-financeiras?empresa_id=${empresaId}`, outro.token)],
      ['GET detalhe', () => A.req('GET', `/operacoes-financeiras/${alvo.conf.id}?empresa_id=${empresaId}`, outro.token)],
      ['POST criar', () => A.req('POST', '/operacoes-financeiras', outro.token, { ...docSem(s.e1), empresa_id: empresaId, operation_id: 'chave-fixa-criar' })],
      ['PUT rascunho', () => A.req('PUT', `/operacoes-financeiras/${alvo.rascunho.id}`, outro.token, { ...docSem(s.e1), empresa_id: empresaId, versao: 1 })],
      ['DELETE rascunho', () => A.req('DELETE', `/operacoes-financeiras/${alvo.rascunho.id}?empresa_id=${empresaId}&versao=1`, outro.token)],
      ['POST prévia', () => A.req('POST', `/operacoes-financeiras/${alvo.rascunho.id}/previa`, outro.token, { empresa_id: empresaId })],
      ['POST confirmar', () => A.req('POST', `/operacoes-financeiras/${alvo.rascunho.id}/confirmar`, outro.token, { empresa_id: empresaId, operation_id: 'chave-fixa-c2', versao: 1 })],
      ['POST cancelar', () => A.req('POST', `/operacoes-financeiras/${alvo.compra.id}/cancelar`, outro.token, { empresa_id: empresaId, operation_id: 'chave-fixa-x2', motivo: 'x' })],
      ['POST liquidar', () => A.req('POST', `/titulos-financeiros/${alvo.titulo.id}/liquidacoes`, outro.token, { empresa_id: empresaId, operation_id: 'chave-fixa-l2', valor: '1.00', data: '2027-06-12', metodo: 'DINHEIRO' })],
      ['POST estornar', () => A.req('POST', `/liquidacoes-financeiras/${alvo.liquidacao.id}/estorno`, outro.token, { empresa_id: empresaId, operation_id: 'chave-fixa-e2', motivo: 'x' })],
      ['GET perfil', () => A.req('GET', `/perfis-financeiros-empresa?empresa_id=${empresaId}`, outro.token)],
      ['PUT perfil', () => A.req('PUT', '/perfis-financeiros-empresa', outro.token, { empresa_id: empresaId, pais: 'US', moeda: 'BRL', locale: 'en-US' })],
      ['GET parceiros', () => A.req('GET', `/operacoes-financeiras-opcoes/parceiros?empresa_id=${empresaId}&direcao=PAGAR`, outro.token)],
      ['GET produtos', () => A.req('GET', `/operacoes-financeiras-opcoes/produtos?empresa_id=${empresaId}`, outro.token)],
      ['GET saldos', () => A.req('GET', `/operacoes-financeiras-opcoes/saldos?empresa_id=${empresaId}&produto_id=${s.e1.sal.id}`, outro.token)],
      ['GET naturezas', () => A.req('GET', `/operacoes-financeiras-opcoes/naturezas?empresa_id=${empresaId}&tipo=DESPESA`, outro.token)],
      ['GET centros-custo', () => A.req('GET', `/operacoes-financeiras-opcoes/centros-custo?empresa_id=${empresaId}`, outro.token)],
      ['GET centros-resultado', () => A.req('GET', `/operacoes-financeiras-opcoes/centros-resultado?empresa_id=${empresaId}`, outro.token)],
    ];
    const reais = comEmpresa(s.e1.id);
    const falsas = comEmpresa(INEXISTENTE);
    for (const [k, [nome, chamar]] of reais.entries()) {
      const r = await chamar();
      const controle = await falsas[k][1]();
      assert.deepEqual([r.statusCode, codigo(r)], [404, 'EMPRESA_NOT_FOUND'], `empresa do alvo — ${nome}: ${r.body}`);
      assert.deepEqual(corpoErro(r), corpoErro(controle), `empresa do alvo — ${nome}: corpo igual ao de empresa inexistente`);
    }

    // (d) leituras legítimas do atacante NÃO mostram nada do alvo.
    const idsAlvo = new Set([
      alvo.conf.id, alvo.rascunho.id, alvo.compra.id, s.local.id, s.local2.id,
      ...['forn', 'prest', 'cli', 'legado', 'desp', 'desp2', 'desp3', 'rec', 'rec2', 'cc', 'cc2', 'cr', 'sal', 'racao', 'milho'].map((k) => s.e1[k].id),
    ]);
    const vazamento = (lista) => lista.filter((i) => idsAlvo.has(i.id));
    const leituras = [
      ['lista', `/operacoes-financeiras?empresa_id=${outro.e1.id}`, 'items'],
      ['parceiros', `/operacoes-financeiras-opcoes/parceiros?empresa_id=${outro.e1.id}&direcao=PAGAR`, 'itens'],
      ['parceiros receber', `/operacoes-financeiras-opcoes/parceiros?empresa_id=${outro.e1.id}&direcao=RECEBER`, 'itens'],
      ['produtos', `/operacoes-financeiras-opcoes/produtos?empresa_id=${outro.e1.id}`, 'itens'],
      ['locais', '/operacoes-financeiras-opcoes/locais', 'itens'],
      ['naturezas', `/operacoes-financeiras-opcoes/naturezas?empresa_id=${outro.e1.id}&tipo=DESPESA`, 'itens'],
      ['centros-custo', `/operacoes-financeiras-opcoes/centros-custo?empresa_id=${outro.e1.id}`, 'itens'],
      ['centros-resultado', `/operacoes-financeiras-opcoes/centros-resultado?empresa_id=${outro.e1.id}`, 'itens'],
    ];
    for (const [nome, url, campo] of leituras) {
      const corpo = await A.ok(A.req('GET', url, outro.token));
      assert.deepEqual(vazamento(corpo[campo]), [], `outro tenant — ${nome} não mostra nada do alvo`);
    }
    const locaisOutro = await A.ok(A.req('GET', '/operacoes-financeiras-opcoes/locais', outro.token));
    assert.deepEqual(locaisOutro.itens.map((l) => l.id).sort(), [outro.local.id, outro.local2.id].sort());
    // Outra empresa do MESMO tenant: lista e opções da E2 não trazem nada da E1 (locais são do tenant — política declarada).
    const listaE2 = await A.ok(A.req('GET', `/operacoes-financeiras?empresa_id=${s.e2.id}`, s.token));
    assert.equal(listaE2.total, 0);
    for (const [url, campo, proprios] of [
      [`/operacoes-financeiras-opcoes/parceiros?empresa_id=${s.e2.id}&direcao=PAGAR`, 'itens', [s.e2.forn.id, s.e2.prest.id, s.e2.legado.id]],
      [`/operacoes-financeiras-opcoes/produtos?empresa_id=${s.e2.id}`, 'itens', [s.e2.sal.id, s.e2.racao.id, s.e2.milho.id]],
      [`/operacoes-financeiras-opcoes/naturezas?empresa_id=${s.e2.id}&tipo=DESPESA`, 'itens', [s.e2.desp.id, s.e2.desp2.id, s.e2.desp3.id]],
      [`/operacoes-financeiras-opcoes/centros-custo?empresa_id=${s.e2.id}`, 'itens', [s.e2.cc.id, s.e2.cc2.id]],
      [`/operacoes-financeiras-opcoes/centros-resultado?empresa_id=${s.e2.id}`, 'itens', [s.e2.cr.id]],
    ]) {
      const corpo = await A.ok(A.req('GET', url, s.token));
      assert.deepEqual(corpo[campo].map((i) => i.id).sort(), [...proprios].sort(), url);
    }
    // Saldos da E2 para um produto da E1 → 404; o lote da E1 nunca aparece na E2.
    const saldoE1 = await A.ok(A.req('GET', `/operacoes-financeiras-opcoes/saldos?empresa_id=${s.e1.id}&produto_id=${s.e1.sal.id}`, s.token));
    assert.deepEqual(saldoE1.itens.map((i) => [i.local_estoque_id, i.disponivel_kg]), [[s.local.id, '50.0000']]);

    // (e) a operation_id do alvo, reutilizada pelo outro tenant, não devolve a resposta guardada do alvo.
    const chaveAlvo = (await prisma().operacaoIdempotente.findFirst({ where: { cliente_id: s.c, tipo_operacao: 'confirmar_operacao_financeira' } })).operation_key;
    const roubo = await A.req('POST', `/operacoes-financeiras/${alvo.conf.id}/confirmar`, outro.token, { empresa_id: outro.e1.id, operation_id: chaveAlvo, versao: 1 });
    const semChave = await A.req('POST', `/operacoes-financeiras/${alvo.conf.id}/confirmar`, outro.token, { empresa_id: outro.e1.id, operation_id: opId(), versao: 1 });
    assert.deepEqual([roubo.statusCode, codigo(roubo)], [404, 'OPERACAO_FINANCEIRA_NOT_FOUND'], roubo.body);
    assert.deepEqual(corpoErro(roubo), corpoErro(semChave), 'a chave alheia não muda nada na resposta');

    assert.equal(await foto([s.c, outro.c]), antes, 'nenhuma linha de nenhum dos dois tenants mudou');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S2 — o tenant vem só da sessão', () => {
  test('cliente_id forjado no corpo ou na query → 400 em toda rota; cabeçalho/cookie com outro tenant são ignorados; nada gravado', async () => {
    const alvo = await tenantComDados();
    const atacante = await montarTenant(app);
    const { s } = alvo;
    const antes = await foto([s.c, atacante.c]);
    const forjado = { cliente_id: s.c };
    const e = atacante.e1;
    const pedidos = [
      ['POST criar', A.req('POST', '/operacoes-financeiras', atacante.token, { ...docSem(e), ...forjado, operation_id: opId() })],
      ['PUT rascunho', A.req('PUT', `/operacoes-financeiras/${alvo.rascunho.id}`, atacante.token, { ...docSem(e), ...forjado, versao: 1 })],
      ['POST prévia', A.req('POST', `/operacoes-financeiras/${alvo.rascunho.id}/previa`, atacante.token, { empresa_id: e.id, ...forjado })],
      ['POST confirmar', A.req('POST', `/operacoes-financeiras/${alvo.rascunho.id}/confirmar`, atacante.token, { empresa_id: e.id, operation_id: opId(), versao: 1, ...forjado })],
      ['POST cancelar', A.req('POST', `/operacoes-financeiras/${alvo.compra.id}/cancelar`, atacante.token, { empresa_id: e.id, operation_id: opId(), motivo: 'x', ...forjado })],
      ['POST liquidar', A.req('POST', `/titulos-financeiros/${alvo.titulo.id}/liquidacoes`, atacante.token, { empresa_id: e.id, operation_id: opId(), valor: '1.00', data: '2027-06-12', metodo: 'DINHEIRO', ...forjado })],
      ['POST estornar', A.req('POST', `/liquidacoes-financeiras/${alvo.liquidacao.id}/estorno`, atacante.token, { empresa_id: e.id, operation_id: opId(), motivo: 'x', ...forjado })],
      ['PUT perfil', A.req('PUT', '/perfis-financeiros-empresa', atacante.token, { empresa_id: s.e1.id, pais: 'US', moeda: 'BRL', locale: 'en-US', ...forjado })],
      ['item com cliente_id', A.req('POST', '/operacoes-financeiras', atacante.token, {
        ...docCom(e, atacante.local, [{ produto: e.sal, quantidade: '1', valor_unitario: '1' }]), operation_id: opId(),
        itens: [{ tipo_item: 'MERCADORIA', produto_id: e.sal.id, local_estoque_id: atacante.local.id, unidade: 'KG', quantidade: '1', valor_unitario: '1', cliente_id: s.c }],
      })],
      ['rateio com cliente_id', A.req('POST', '/operacoes-financeiras', atacante.token, { ...docSem(e), operation_id: opId(), rateios: [{ natureza_id: e.desp.id, valor: '500.00', cliente_id: s.c }] })],
      ['GET lista', A.req('GET', `/operacoes-financeiras?empresa_id=${s.e1.id}&cliente_id=${s.c}`, atacante.token)],
      ['GET detalhe', A.req('GET', `/operacoes-financeiras/${alvo.conf.id}?empresa_id=${s.e1.id}&cliente_id=${s.c}`, atacante.token)],
      ['DELETE rascunho', A.req('DELETE', `/operacoes-financeiras/${alvo.rascunho.id}?empresa_id=${s.e1.id}&versao=1&cliente_id=${s.c}`, atacante.token)],
      ['GET perfil', A.req('GET', `/perfis-financeiros-empresa?empresa_id=${s.e1.id}&cliente_id=${s.c}`, atacante.token)],
      ['GET parceiros', A.req('GET', `/operacoes-financeiras-opcoes/parceiros?empresa_id=${s.e1.id}&direcao=PAGAR&cliente_id=${s.c}`, atacante.token)],
      ['GET produtos', A.req('GET', `/operacoes-financeiras-opcoes/produtos?empresa_id=${s.e1.id}&cliente_id=${s.c}`, atacante.token)],
      ['GET locais', A.req('GET', `/operacoes-financeiras-opcoes/locais?cliente_id=${s.c}`, atacante.token)],
      ['GET saldos', A.req('GET', `/operacoes-financeiras-opcoes/saldos?empresa_id=${s.e1.id}&produto_id=${s.e1.sal.id}&cliente_id=${s.c}`, atacante.token)],
      ['GET naturezas', A.req('GET', `/operacoes-financeiras-opcoes/naturezas?empresa_id=${s.e1.id}&tipo=DESPESA&cliente_id=${s.c}`, atacante.token)],
      ['GET centros-custo', A.req('GET', `/operacoes-financeiras-opcoes/centros-custo?empresa_id=${s.e1.id}&cliente_id=${s.c}`, atacante.token)],
      ['GET centros-resultado', A.req('GET', `/operacoes-financeiras-opcoes/centros-resultado?empresa_id=${s.e1.id}&cliente_id=${s.c}`, atacante.token)],
    ];
    for (const [nome, pr] of pedidos) {
      const r = await pr;
      assert.deepEqual([r.statusCode, codigo(r)], [400, 'REQUEST_VALIDATION_FAILED'], `${nome}: ${r.body}`);
    }
    // Cabeçalho e cookie com o tenant do alvo não mudam o escopo: a lista é a do atacante.
    const r = await app.inject({
      method: 'GET',
      url: `/operacoes-financeiras?empresa_id=${e.id}`,
      headers: { authorization: `Bearer ${atacante.token}`, 'x-cliente-id': s.c, 'x-tenant-id': s.c, cookie: `cliente_id=${s.c}; tenant=${s.c}` },
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().total, 0);
    const r2 = await app.inject({
      method: 'GET',
      url: `/operacoes-financeiras/${alvo.conf.id}?empresa_id=${s.e1.id}`,
      headers: { authorization: `Bearer ${atacante.token}`, 'x-cliente-id': s.c, cookie: `cliente_id=${s.c}` },
    });
    assert.deepEqual([r2.statusCode, codigo(r2)], [404, 'EMPRESA_NOT_FOUND']);
    assert.equal(await foto([s.c, atacante.c]), antes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S3 — referências de outro tenant ou de outra empresa', () => {
  test('parceiro, natureza, centro de custo/resultado, produto e local alheios → 422 idêntico ao de id inexistente, no POST e no PUT; nada gravado', async () => {
    const s = await montarTenant(app);
    const outro = await montarTenant(app);
    const e = s.e1;
    const rascunho = await A.criar(s.token, docSem(e));
    const antes = await foto([s.c, outro.c]);
    const casos = [
      ['parceiro_id', 'parceiro_nao_encontrado', (id) => docSem(e, { parceiro_id: id }), [s.e2.forn.id, outro.e1.forn.id]],
      ['natureza_id', 'natureza_nao_encontrada', (id) => docSem(e, { rateios: [{ natureza_id: id, valor: '500.00' }] }), [s.e2.desp.id, outro.e1.desp.id]],
      ['centro_custo_id', 'centro_custo_nao_encontrado', (id) => docSem(e, { rateios: [{ natureza_id: e.desp.id, centro_custo_id: id, valor: '500.00' }] }), [s.e2.cc.id, outro.e1.cc.id]],
      ['centro_resultado_id', 'centro_resultado_nao_encontrado', (id) => docSem(e, { rateios: [{ natureza_id: e.desp.id, centro_resultado_id: id, valor: '500.00' }] }), [s.e2.cr.id, outro.e1.cr.id]],
      ['produto_id', 'produto_nao_encontrado', (id) => docCom(e, s.local, [{ produto: { id }, quantidade: '1', valor_unitario: '10' }]), [s.e2.sal.id, outro.e1.sal.id]],
      ['local_estoque_id', 'local_nao_encontrado', (id) => docCom(e, { id }, [{ produto: e.sal, quantidade: '1', valor_unitario: '10' }]), [outro.local.id]],
    ];
    for (const [field, reason, montar, alheios] of casos) {
      for (const [verbo, enviar] of [
        ['POST', (doc) => A.req('POST', '/operacoes-financeiras', s.token, { ...doc, operation_id: opId() })],
        ['PUT', (doc) => A.req('PUT', `/operacoes-financeiras/${rascunho.id}`, s.token, { ...doc, versao: rascunho.versao })],
      ]) {
        const controle = await enviar(montar(INEXISTENTE));
        assert.deepEqual([controle.statusCode, codigo(controle), controle.json().field, motivo(controle)], [422, 'OPERACAO_REFERENCIA_INVALIDA', field, reason], controle.body);
        for (const id of alheios) {
          const r = await enviar(montar(id));
          assert.deepEqual(corpoErro(r), corpoErro(controle), `${verbo} ${field}=${id}: mesmo corpo do inexistente`);
        }
      }
    }
    assert.equal(await foto([s.c, outro.c]), antes, 'nada gravado nas recusas');
    // Política declarada: o LOCAL é do tenant (compartilhado entre empresas); o saldo é SEMPRE filtrado pela empresa do lote.
    const compraE2 = await A.criarConfirmar(s.token, docCom(s.e2, s.local, [{ produto: s.e2.sal, quantidade: '10', valor_unitario: '3' }]));
    assert.equal(compraE2.status, 'CONFIRMADO', 'o local do tenant serve às duas empresas');
    // lote legado incoerente: produto da E1 gravado com empresa E2 no mesmo local — nunca entra no saldo da E1
    await loteLegado(s, s.e2, e.sal, s.local, { kg: '100' });
    await prisma().produto.update({ where: { id: e.sal.id }, data: { estoque_atual: '100' } });
    const saldos = await A.ok(A.req('GET', `/operacoes-financeiras-opcoes/saldos?empresa_id=${e.id}&produto_id=${e.sal.id}`, s.token));
    assert.deepEqual(saldos.itens, []);
    const vendaE1 = await A.criar(s.token, docCom(e, s.local, [{ produto: e.sal, quantidade: '1', valor_unitario: '9' }], { direcao: 'RECEBER' }));
    const prev = await A.previa(s.token, vendaE1.id, e.id);
    assert.deepEqual(prev.bloqueios.map((b) => [b.code, b.reason, b.details.disponivel]), [['ESTOQUE_SALDO_INSUFICIENTE', 'saldo_lote_insuficiente', '0.0000']]);
    const sem = await A.confirmarReq(s.token, vendaE1, e.id);
    assert.deepEqual([sem.statusCode, codigo(sem), motivo(sem), sem.json().details.disponivel], [422, 'ESTOQUE_SALDO_INSUFICIENTE', 'saldo_lote_insuficiente', '0.0000'], 'o lote de outra empresa no mesmo local não vale');
  });

  test('referência que fica inativa/alheia depois do rascunho: a confirmação revalida dentro da transação e recusa sem efeito', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const casos = [
      ['parceiro_inativo', () => p.fornecedor.update({ where: { id: e.forn.id }, data: { ativo: false } }), () => p.fornecedor.update({ where: { id: e.forn.id }, data: { ativo: true } })],
      ['natureza_inativa', () => p.naturezaFinanceira.update({ where: { id: e.desp.id }, data: { ativo: false } }), () => p.naturezaFinanceira.update({ where: { id: e.desp.id }, data: { ativo: true } })],
      ['centro_custo_inativo', () => p.centroCusto.update({ where: { id: e.cc.id }, data: { ativo: false } }), () => p.centroCusto.update({ where: { id: e.cc.id }, data: { ativo: true } })],
      ['produto_inativo', () => p.produto.update({ where: { id: e.sal.id }, data: { ativo: false } }), () => p.produto.update({ where: { id: e.sal.id }, data: { ativo: true } })],
      ['local_inativo', () => p.localEstoque.update({ where: { id: s.local.id }, data: { ativo: false } }), () => p.localEstoque.update({ where: { id: s.local.id }, data: { ativo: true } })],
    ];
    for (const [reason, estragar, consertar] of casos) {
      const doc = docCom(e, s.local, [{ produto: e.sal, quantidade: '5', valor_unitario: '2' }], { rateio_modo: 'VALOR', rateios: [{ natureza_id: e.desp.id, centro_custo_id: e.cc.id, valor: '10.00' }] });
      const d = await A.criar(s.token, doc);
      await estragar();
      const antes = await foto(s.c);
      const prev = await A.previa(s.token, d.id, e.id);
      assert.ok(prev.bloqueios.some((b) => b.reason === reason), `${reason}: a prévia mostra o bloqueio — ${JSON.stringify(prev.bloqueios)}`);
      const r = await A.confirmarReq(s.token, d, e.id);
      assert.deepEqual([r.statusCode, codigo(r), motivo(r)], [422, 'OPERACAO_REFERENCIA_INVALIDA', reason], r.body);
      assert.equal(await foto(s.c), antes, `${reason}: nada gravado`);
      await consertar();
      await A.ok(A.req('DELETE', `/operacoes-financeiras/${d.id}?empresa_id=${e.id}&versao=${d.versao}`, s.token), 204);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S4 — matriz de permissões por ação', () => {
  test('cada ação exige a SUA caixa (visualizar, novo|salvar, editar|salvar, confirmar, cancelar, liquidar, estornar_liquidacao); admin real e is_admin passam; negação sem efeito', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const tudo = Object.fromEntries([...ACOES_PADRAO, ...ACOES_EXTRAS].map((a) => [a, true]));
    const contas = {
      semLinha: await s.conta(null),
      semTela: await s.conta({ modulos_permitidos: ['gestao-rural'], permissoes_telas: [{ modulo_id: 'gestao-rural', tela_id: 'ges-centros-custo', ...tudo }] }),
      semModulo: await s.conta({ modulos_permitidos: ['mapa-geral'], permissoes_telas: [linhaTela(tudo)] }),
      extrasSemVer: await s.contaCom({ ...tudo, visualizar: false }, { semVisualizar: true }),
      ver: await s.contaCom({}),
      novo: await s.contaCom({ novo: true }),
      salvar: await s.contaCom({ salvar: true }),
      editar: await s.contaCom({ editar: true }),
      confirmar: await s.contaCom({ confirmar: true }),
      liquidar: await s.contaCom({ liquidar: true }),
      estornar: await s.contaCom({ estornar_liquidacao: true }),
      cancelar: await s.contaCom({ cancelar: true }),
      tudoSemAdmin: await s.contaCom(tudo),
      isAdmin: await s.conta({ is_admin: true }),
      adminRealSemLinha: await s.conta(null, { papel_tenant: 'administrador' }),
    };
    const VER = ['ver', 'novo', 'salvar', 'editar', 'confirmar', 'liquidar', 'estornar', 'cancelar', 'tudoSemAdmin', 'isAdmin', 'adminRealSemLinha'];
    const ADM = ['tudoSemAdmin', 'isAdmin', 'adminRealSemLinha'];
    const quem = {
      ver: VER,
      criar: ['novo', 'salvar', ...ADM],
      editar: ['salvar', 'editar', ...ADM],
      confirmar: ['confirmar', ...ADM],
      cancelar: ['cancelar', ...ADM],
      liquidar: ['liquidar', ...ADM],
      estornar: ['estornar', ...ADM],
      perfil: ['isAdmin', 'adminRealSemLinha'],
    };
    const rascunho = () => A.criar(s.token, docSem(e, { valor_bruto: '50.00', rateios: [{ natureza_id: e.desp.id, valor: '50.00' }], parcelas: [{ vencimento: '2027-07-10', valor: '50.00' }] }));
    const confirmado = () => A.criarConfirmar(s.token, docSem(e, { valor_bruto: '50.00', rateios: [{ natureza_id: e.desp.id, valor: '50.00' }], parcelas: [{ vencimento: '2027-07-10', valor: '50.00' }] }));
    const comLiquidacao = async () => {
      const d = await confirmado();
      const l = await A.ok(A.liquidarReq(s.token, d.titulos[0].id, e.id, { valor: '10.00' }), 201);
      return l.titulos[0].liquidacoes[0];
    };
    const p = prisma();
    /** ação → [preparar alvo, executar(token, alvo), status de sucesso, efeito(alvo)] */
    const ACOES = {
      lista: ['ver', async () => null, (t) => A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}`, t), 200, null],
      detalhe: ['ver', confirmado, (t, d) => A.req('GET', `/operacoes-financeiras/${d.id}?empresa_id=${e.id}`, t), 200, null],
      previa: ['ver', rascunho, (t, d) => A.req('POST', `/operacoes-financeiras/${d.id}/previa`, t, { empresa_id: e.id }), 200, null],
      perfilLer: ['ver', async () => null, (t) => A.req('GET', `/perfis-financeiros-empresa?empresa_id=${e.id}`, t), 200, null],
      opParceiros: ['ver', async () => null, (t) => A.req('GET', `/operacoes-financeiras-opcoes/parceiros?empresa_id=${e.id}&direcao=RECEBER`, t), 200, null],
      opProdutos: ['ver', async () => null, (t) => A.req('GET', `/operacoes-financeiras-opcoes/produtos?empresa_id=${e.id}`, t), 200, null],
      opLocais: ['ver', async () => null, (t) => A.req('GET', '/operacoes-financeiras-opcoes/locais', t), 200, null],
      opSaldos: ['ver', async () => null, (t) => A.req('GET', `/operacoes-financeiras-opcoes/saldos?empresa_id=${e.id}&produto_id=${e.sal.id}`, t), 200, null],
      opNaturezas: ['ver', async () => null, (t) => A.req('GET', `/operacoes-financeiras-opcoes/naturezas?empresa_id=${e.id}&tipo=RECEITA`, t), 200, null],
      opCentrosCusto: ['ver', async () => null, (t) => A.req('GET', `/operacoes-financeiras-opcoes/centros-custo?empresa_id=${e.id}`, t), 200, null],
      opCentrosResultado: ['ver', async () => null, (t) => A.req('GET', `/operacoes-financeiras-opcoes/centros-resultado?empresa_id=${e.id}`, t), 200, null],
      criar: ['criar', async () => ({ chave: opId() }), (t, a) => A.req('POST', '/operacoes-financeiras', t, { ...docSem(e), operation_id: a.chave }), 201,
        async (a) => assert.equal(await p.operacaoIdempotente.count({ where: { cliente_id: s.c, operation_key: a.chave } }), 1)],
      editar: ['editar', rascunho, (t, d) => A.req('PUT', `/operacoes-financeiras/${d.id}`, t, { ...docSem(e, { valor_bruto: '60.00', rateios: [{ natureza_id: e.desp.id, valor: '60.00' }], parcelas: [{ vencimento: '2027-07-10', valor: '60.00' }] }), versao: d.versao }), 200,
        async (d) => assert.deepEqual([(await p.operacaoFinanceira.findUnique({ where: { id: d.id } })).valor_total.toFixed(2)], ['60.00'])],
      descartar: ['editar', rascunho, (t, d) => A.req('DELETE', `/operacoes-financeiras/${d.id}?empresa_id=${e.id}&versao=${d.versao}`, t), 204,
        async (d) => assert.equal(await p.operacaoFinanceira.count({ where: { id: d.id } }), 0)],
      confirmar: ['confirmar', rascunho, (t, d) => A.req('POST', `/operacoes-financeiras/${d.id}/confirmar`, t, { empresa_id: e.id, operation_id: opId(), versao: d.versao }), 200,
        async (d) => assert.equal((await p.operacaoFinanceira.findUnique({ where: { id: d.id } })).status, 'CONFIRMADO')],
      cancelar: ['cancelar', confirmado, (t, d) => A.req('POST', `/operacoes-financeiras/${d.id}/cancelar`, t, { empresa_id: e.id, operation_id: opId(), motivo: 'matriz' }), 200,
        async (d) => assert.equal((await p.operacaoFinanceira.findUnique({ where: { id: d.id } })).status, 'CANCELADO')],
      liquidar: ['liquidar', confirmado, (t, d) => A.req('POST', `/titulos-financeiros/${d.titulos[0].id}/liquidacoes`, t, { empresa_id: e.id, operation_id: opId(), valor: '5.00', data: '2027-06-12', metodo: 'DINHEIRO' }), 201,
        async (d) => assert.equal((await p.tituloFinanceiro.findUnique({ where: { id: d.titulos[0].id } })).status, 'PARCIAL')],
      estornar: ['estornar', comLiquidacao, (t, l) => A.req('POST', `/liquidacoes-financeiras/${l.id}/estorno`, t, { empresa_id: e.id, operation_id: opId(), motivo: 'matriz' }), 201,
        async (l) => assert.equal(await p.liquidacaoFinanceiraEstorno.count({ where: { liquidacao_id: l.id } }), 1)],
      perfilGravar: ['perfil', async () => null, (t) => A.req('PUT', '/perfis-financeiros-empresa', t, { empresa_id: e.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' }), 200, null],
    };
    const negadosPorAcao = {};
    for (const [acao, [grupo, preparar, executar, sucesso, efeito]] of Object.entries(ACOES)) {
      const alvoNegado = await preparar();
      const antes = await foto(s.c);
      for (const [nome, conta] of Object.entries(contas)) {
        if (quem[grupo].includes(nome)) continue;
        const r = await executar(conta.token, alvoNegado);
        assert.deepEqual([r.statusCode, codigo(r)], [403, 'ACAO_NAO_PERMITIDA'], `${acao} por ${nome} deveria ser negado: ${r.body}`);
        (negadosPorAcao[acao] ??= []).push(nome);
      }
      assert.equal(await foto(s.c), antes, `${acao}: nenhuma negação gravou nada (nem auditoria, nem idempotência, nem número)`);
      for (const nome of quem[grupo]) {
        const alvo = grupo === 'ver' || grupo === 'perfil' ? alvoNegado : await preparar();
        const r = await executar(contas[nome].token, alvo);
        assert.equal(r.statusCode, sucesso, `${acao} por ${nome} deveria passar: ${r.body}`);
        if (efeito) await efeito(alvo);
      }
    }
    // A matriz cobriu de fato as 4 contas sem acesso nenhum em TODAS as ações.
    for (const acao of Object.keys(ACOES)) {
      for (const nome of ['semLinha', 'semTela', 'semModulo', 'extrasSemVer']) assert.ok(negadosPorAcao[acao].includes(nome), `${acao}/${nome}`);
    }
  });

  test('baixa no ato sem a caixa liquidar → 403 e NADA gravado (nem liquidação, nem efeito de estoque, nem idempotência); com a caixa → QUITADO', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const semLiquidar = await s.contaCom({ novo: true, confirmar: true });
    const comLiquidar = await s.contaCom({ confirmar: true, liquidar: true });
    // à vista COM mercadoria: a recusa precisa desfazer também o lote, o movimento e o estoque_atual
    const doc = docCom(e, s.local, [{ produto: e.sal, quantidade: '10', valor_unitario: '3' }], { condicao: 'AVISTA', parcelas: [{ vencimento: '2027-06-10', valor: '30.00' }] });
    const d = await A.criar(semLiquidar.token, doc);
    const antes = await foto(s.c);
    const chave = opId();
    const negado = await A.req('POST', `/operacoes-financeiras/${d.id}/confirmar`, semLiquidar.token, { empresa_id: e.id, operation_id: chave, versao: d.versao, baixa_no_ato: { metodo: 'PIX', data: '2027-06-10' } });
    assert.deepEqual([negado.statusCode, codigo(negado)], [403, 'ACAO_NAO_PERMITIDA'], negado.body);
    assert.equal(negado.json().details.acao, 'liquidar');
    assert.equal(await foto(s.c), antes, 'nada gravado');
    assert.equal(await p.operacaoIdempotente.count({ where: { cliente_id: s.c, operation_key: chave } }), 0);
    // sem a baixa, a mesma conta confirma (a ação liquidar só é exigida com baixa_no_ato)
    const conf = await A.ok(A.req('POST', `/operacoes-financeiras/${d.id}/confirmar`, comLiquidar.token, { empresa_id: e.id, operation_id: opId(), versao: d.versao, baixa_no_ato: { metodo: 'PIX', data: '2027-06-10' } }));
    assert.deepEqual([conf.status, conf.titulos[0].status, conf.titulos[0].liquidacoes.length], ['CONFIRMADO', 'QUITADO', 1]);
    assert.equal((await p.produto.findUnique({ where: { id: e.sal.id } })).estoque_atual.toFixed(4), '10.0000');
    const d2 = await A.criar(semLiquidar.token, docAvista(e));
    await A.ok(A.req('POST', `/operacoes-financeiras/${d2.id}/confirmar`, semLiquidar.token, { empresa_id: e.id, operation_id: opId(), versao: d2.versao }));
  });

  test('perfil: só administrador real ou is_admin gravam (a conta com TODAS as caixas não); conta desativada → 401 em tudo; permissão revogada após o login → 403', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const tudo = Object.fromEntries([...ACOES_PADRAO, ...ACOES_EXTRAS].map((a) => [a, true]));
    const operador = await s.contaCom(tudo);
    const perfilAntes = await p.perfilFinanceiroEmpresa.findMany({ where: { cliente_id: s.c }, orderBy: { id: 'asc' } });
    const negado = await A.req('PUT', '/perfis-financeiros-empresa', operador.token, { empresa_id: e.id, pais: 'PT', moeda: 'BRL', locale: 'pt-PT' });
    assert.deepEqual([negado.statusCode, codigo(negado)], [403, 'ACAO_NAO_PERMITIDA']);
    assert.deepEqual(await p.perfilFinanceiroEmpresa.findMany({ where: { cliente_id: s.c }, orderBy: { id: 'asc' } }), perfilAntes);
    const isAdmin = await s.conta({ is_admin: true });
    const gravado = await A.ok(A.req('PUT', '/perfis-financeiros-empresa', isAdmin.token, { empresa_id: e.id, pais: 'PT', moeda: 'BRL', locale: 'pt-PT' }));
    assert.deepEqual([gravado.pais, gravado.locale, gravado.metodos_permitidos.includes('PIX')], ['PT', 'pt-PT', false]);

    // Conta desativada DEPOIS do login: o token deixa de valer em todas as rotas (sessão relida do banco).
    const desativada = await s.contaCom(tudo);
    const d = await A.criar(desativada.token, docSem(e, { documento_referencia: null }));
    await p.usuario.update({ where: { id: desativada.id }, data: { ativo: false } });
    const antes = await foto(s.c);
    const rotas = [
      ['GET', `/operacoes-financeiras?empresa_id=${e.id}`], ['GET', `/operacoes-financeiras/${d.id}?empresa_id=${e.id}`],
      ['POST', '/operacoes-financeiras', { ...docSem(e), operation_id: opId() }], ['PUT', `/operacoes-financeiras/${d.id}`, { ...docSem(e), versao: d.versao }],
      ['DELETE', `/operacoes-financeiras/${d.id}?empresa_id=${e.id}&versao=${d.versao}`], ['POST', `/operacoes-financeiras/${d.id}/previa`, { empresa_id: e.id }],
      ['POST', `/operacoes-financeiras/${d.id}/confirmar`, { empresa_id: e.id, operation_id: opId(), versao: d.versao }],
      ['POST', `/operacoes-financeiras/${d.id}/cancelar`, { empresa_id: e.id, operation_id: opId(), motivo: 'x' }],
      ['POST', `/titulos-financeiros/${d.titulos[0].id}/liquidacoes`, { empresa_id: e.id, operation_id: opId(), valor: '1.00', data: '2027-06-12', metodo: 'DINHEIRO' }],
      ['POST', `/liquidacoes-financeiras/${INEXISTENTE}/estorno`, { empresa_id: e.id, operation_id: opId(), motivo: 'x' }],
      ['GET', `/perfis-financeiros-empresa?empresa_id=${e.id}`], ['PUT', '/perfis-financeiros-empresa', { empresa_id: e.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' }],
      ['GET', `/operacoes-financeiras-opcoes/parceiros?empresa_id=${e.id}&direcao=PAGAR`], ['GET', `/operacoes-financeiras-opcoes/produtos?empresa_id=${e.id}`],
      ['GET', '/operacoes-financeiras-opcoes/locais'], ['GET', `/operacoes-financeiras-opcoes/saldos?empresa_id=${e.id}&produto_id=${e.sal.id}`],
      ['GET', `/operacoes-financeiras-opcoes/naturezas?empresa_id=${e.id}&tipo=DESPESA`], ['GET', `/operacoes-financeiras-opcoes/centros-custo?empresa_id=${e.id}`],
      ['GET', `/operacoes-financeiras-opcoes/centros-resultado?empresa_id=${e.id}`],
    ];
    for (const [metodo, url, corpo] of rotas) {
      const r = await A.req(metodo, url, desativada.token, corpo);
      assert.deepEqual([r.statusCode, codigo(r)], [401, 'TENANT_CONTEXT_REQUIRED'], `${metodo} ${url}: ${r.body}`);
      const anonimo = await A.req(metodo, url, null, corpo);
      assert.equal(anonimo.statusCode, 401, `${metodo} ${url} sem sessão`);
    }
    assert.equal(await foto(s.c), antes);

    // Permissão revogada depois do login: a próxima requisição já é negada.
    const revogada = await s.contaCom(tudo);
    await A.ok(A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}`, revogada.token));
    await p.permissao.update({ where: { cliente_id_user_email: { cliente_id: s.c, user_email: revogada.login } }, data: { permissoes_telas: [linhaTela({ visualizar: true })] } });
    const semConfirmar = await A.req('POST', `/operacoes-financeiras/${d.id}/confirmar`, revogada.token, { empresa_id: e.id, operation_id: opId(), versao: d.versao });
    assert.deepEqual([semConfirmar.statusCode, codigo(semConfirmar)], [403, 'ACAO_NAO_PERMITIDA']);
    assert.equal((await p.operacaoFinanceira.findUnique({ where: { id: d.id } })).status, 'RASCUNHO');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S6/S7 — o banco é a última rede', () => {
  test('RLS ligado e zero grants para PUBLIC/anon/authenticated nas 8 tabelas novas', async () => {
    const p = prisma();
    const rls = /** @type {any[]} */ (await p.$queryRaw`SELECT relname, relrowsecurity FROM pg_class WHERE relkind = 'r' AND relname = ANY(${TABELAS_P3}::text[]) ORDER BY relname`);
    assert.deepEqual(rls.map((r) => r.relname).sort(), [...TABELAS_P3].sort());
    assert.ok(rls.every((r) => r.relrowsecurity === true), JSON.stringify(rls));
    const grants = /** @type {any[]} */ (await p.$queryRaw`
      SELECT c.relname, a.grantee::regrole::text AS grantee, a.privilege_type
        FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
       WHERE c.relname = ANY(${TABELAS_P3}::text[])
         AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))`);
    assert.deepEqual(grants, [], 'nenhum privilégio para PUBLIC, anon ou authenticated');
    for (const papel of ['anon', 'authenticated']) {
      const existe = /** @type {any[]} */ (await p.$queryRaw`SELECT 1 FROM pg_roles WHERE rolname = ${papel}`);
      if (!existe.length) continue;
      for (const t of TABELAS_P3) {
        const [r] = /** @type {any[]} */ (await p.$queryRawUnsafe(`SELECT has_table_privilege('${papel}', 'public."${t}"', 'SELECT,INSERT,UPDATE,DELETE') AS pode`));
        assert.equal(r.pode, false, `${papel} em ${t}`);
      }
    }
  });

  test('INSERT/UPDATE direto recusado: direção×tipo da natureza, estorno de outro título, título incoerente, mercadoria sem local, chave documental incoerente, cruzamento de tenant', async () => {
    const s = await montarTenant(app);
    const outro = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const d = await A.criarConfirmar(s.token, docSem(e, { condicao: 'PARCELADO', documento_referencia: 'NF-1', parcelas: [{ vencimento: '2027-07-10', valor: '250.00' }, { vencimento: '2027-08-10', valor: '250.00' }] }));
    const [t1, t2] = d.titulos;
    const liq = (await A.ok(A.liquidarReq(s.token, t1.id, e.id, { valor: '100.00' }), 201)).titulos[0].liquidacoes[0];
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [{ produto: e.sal, quantidade: '5', valor_unitario: '2' }]));
    const item = compra.itens[0];
    const rascunho = await A.criar(s.token, docSem(e, { documento_referencia: 'NF-2' }));
    const d2 = await A.criarConfirmar(s.token, docSem(e, { documento_referencia: 'NF-3' }));
    const antes = await foto([s.c, outro.c]);
    const recusa = async (sql, padrao, rotulo) => {
      await assert.rejects(() => p.$executeRawUnsafe(sql), (erro) => {
        const e = /** @type {any} */ (erro);
        assert.match(`${e.message} ${JSON.stringify(e.meta ?? {})}`, padrao, rotulo);
        return true;
      }, rotulo);
    };
    const novoId = () => `x${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const agora = 'now()';
    // (1) natureza RECEITA num lançamento PAGAR: CHECK direção×tipo e FK composta com o tipo
    await recusa(`INSERT INTO "OperacaoFinanceiraRateio" (id, cliente_id, empresa_id, operacao_id, operacao_direcao, ordem, natureza_id, natureza_tipo, natureza_nome, valor, "createdAt", "updatedAt")
      VALUES ('${novoId()}', '${s.c}', '${e.id}', '${d.id}', 'PAGAR', 9, '${e.rec.id}', 'RECEITA', 'x', 1, ${agora}, ${agora})`, /OperacaoFinanceiraRateio_tipo_direcao_check/, 'rateio PAGAR × RECEITA');
    await recusa(`INSERT INTO "OperacaoFinanceiraRateio" (id, cliente_id, empresa_id, operacao_id, operacao_direcao, ordem, natureza_id, natureza_tipo, natureza_nome, valor, "createdAt", "updatedAt")
      VALUES ('${novoId()}', '${s.c}', '${e.id}', '${d.id}', 'PAGAR', 9, '${e.rec.id}', 'DESPESA', 'x', 1, ${agora}, ${agora})`, /foreign key|natureza_ti_fkey/i, 'tipo declarado ≠ tipo real da natureza');
    await recusa(`INSERT INTO "OperacaoFinanceiraRateio" (id, cliente_id, empresa_id, operacao_id, operacao_direcao, ordem, natureza_id, natureza_tipo, natureza_nome, valor, "createdAt", "updatedAt")
      VALUES ('${novoId()}', '${s.c}', '${e.id}', '${d.id}', 'RECEBER', 9, '${e.rec.id}', 'RECEITA', 'x', 1, ${agora}, ${agora})`, /foreign key|operacao_id_fkey/i, 'direção do rateio ≠ direção do lançamento');
    await recusa(`UPDATE "OperacaoFinanceira" SET direcao = 'RECEBER' WHERE id = '${d.id}'`, /foreign key|violates/i, 'trocar a direção do cabeçalho com rateio gravado');
    // (2) estorno apontando a liquidação de OUTRO título
    await recusa(`INSERT INTO "LiquidacaoFinanceiraEstorno" (id, cliente_id, empresa_id, titulo_id, liquidacao_id, data, motivo, "createdAt", "updatedAt")
      VALUES ('${novoId()}', '${s.c}', '${e.id}', '${t2.id}', '${liq.id}', '2027-06-15', 'x', ${agora}, ${agora})`, /LiquidacaoFinanceiraEstorno_liquidacao_fkey/, 'estorno de liquidação de outro título');
    // (3) título com situação incoerente com o valor liquidado
    await recusa(`UPDATE "TituloFinanceiro" SET status = 'QUITADO' WHERE id = '${t2.id}'`, /TituloFinanceiro_coerencia_check/, 'QUITADO sem liquidação');
    await recusa(`UPDATE "TituloFinanceiro" SET status = 'ABERTO' WHERE id = '${t1.id}'`, /TituloFinanceiro_coerencia_check/, 'ABERTO com 100 liquidado');
    await recusa(`UPDATE "TituloFinanceiro" SET valor_liquidado = valor WHERE id = '${t1.id}'`, /TituloFinanceiro_coerencia_check/, 'PARCIAL com tudo liquidado');
    await recusa(`UPDATE "TituloFinanceiro" SET valor_liquidado = valor + 1, status = 'QUITADO' WHERE id = '${t1.id}'`, /TituloFinanceiro_liquidado_check|coerencia/, 'liquidado acima do valor');
    await recusa(`UPDATE "TituloFinanceiro" SET numero_parcela = 3 WHERE id = '${t2.id}'`, /TituloFinanceiro_parcela_check/, 'parcela acima do total');
    // (4) mercadoria sem local / serviço com produto
    await recusa(`UPDATE "OperacaoFinanceiraItem" SET local_estoque_id = NULL WHERE id = '${item.id}'`, /OperacaoFinanceiraItem_forma_check/, 'mercadoria sem local');
    await recusa(`UPDATE "OperacaoFinanceiraItem" SET tipo_item = 'SERVICO', unidade = 'UN' WHERE id = '${item.id}'`, /OperacaoFinanceiraItem_forma_check/, 'serviço com produto e lote');
    // (5) chave documental incoerente com a situação
    await recusa(`UPDATE "OperacaoFinanceira" SET documento_chave_ativa = 'NF-2' WHERE id = '${rascunho.id}'`, /OperacaoFinanceira_documento_chave_check/, 'rascunho com chave ativa');
    await recusa(`UPDATE "OperacaoFinanceira" SET documento_chave_ativa = 'OUTRA' WHERE id = '${d.id}'`, /OperacaoFinanceira_documento_chave_check/, 'confirmado com chave ≠ documento');
    await recusa(`UPDATE "OperacaoFinanceira" SET status = 'CANCELADO', cancelado_em = now(), motivo_cancelamento = 'x' WHERE id = '${d.id}'`, /OperacaoFinanceira_documento_chave_check/, 'cancelado mantendo a chave');
    await recusa(`UPDATE "OperacaoFinanceira" SET status = 'CONFIRMADO', documento_chave_ativa = 'NF-2' WHERE id = '${rascunho.id}'`, /OperacaoFinanceira_confirmado_check/, 'confirmado sem confirmado_em');
    // (6) cruzamento de tenant pela FK composta (cliente_id em toda FK)
    await recusa(`INSERT INTO "OperacaoFinanceiraRateio" (id, cliente_id, empresa_id, operacao_id, operacao_direcao, ordem, natureza_id, natureza_tipo, natureza_nome, valor, "createdAt", "updatedAt")
      VALUES ('${novoId()}', '${outro.c}', '${e.id}', '${d.id}', 'PAGAR', 9, '${e.desp.id}', 'DESPESA', 'x', 1, ${agora}, ${agora})`, /foreign key/i, 'rateio do outro tenant apontando o lançamento');
    await recusa(`INSERT INTO "LiquidacaoFinanceira" (id, cliente_id, empresa_id, titulo_id, valor, data, metodo, "createdAt", "updatedAt")
      VALUES ('${novoId()}', '${outro.c}', '${outro.e1.id}', '${t2.id}', 1, '2027-06-12', 'DINHEIRO', ${agora}, ${agora})`, /foreign key/i, 'liquidação do outro tenant num título alheio');
    await recusa(`INSERT INTO "LiquidacaoFinanceira" (id, cliente_id, empresa_id, titulo_id, valor, data, metodo, "createdAt", "updatedAt")
      VALUES ('${novoId()}', '${s.c}', '${s.e2.id}', '${t2.id}', 1, '2027-06-12', 'DINHEIRO', ${agora}, ${agora})`, /foreign key/i, 'liquidação de outra empresa no título');
    await recusa(`UPDATE "LiquidacaoFinanceira" SET metodo = 'CHEQUE' WHERE id = '${liq.id}'`, /LiquidacaoFinanceira_metodo_check/, 'método fora do domínio');
    await recusa(`UPDATE "LiquidacaoFinanceira" SET valor = 0 WHERE id = '${liq.id}'`, /LiquidacaoFinanceira_valor_check/, 'liquidação zero');
    // (7) um estorno por liquidação (unique): o par inteiro falha junto; e um CONFIRMADO ativo por chave documental
    const estornoSql = () => `INSERT INTO "LiquidacaoFinanceiraEstorno" (id, cliente_id, empresa_id, titulo_id, liquidacao_id, data, motivo, "createdAt", "updatedAt")
      VALUES ('${novoId()}', '${s.c}', '${e.id}', '${t1.id}', '${liq.id}', '2027-06-15', 'x', now(), now());`;
    await recusa(`DO $$ BEGIN ${estornoSql()} ${estornoSql()} END $$`, /23505.*liquidacao_id|liquidacao_id.*already exists/s, 'segundo estorno da mesma liquidação');
    await recusa(`UPDATE "OperacaoFinanceira" SET documento_referencia = 'NF-1', documento_chave_ativa = 'NF-1' WHERE id = '${d2.id}'`, /23505|duplicate key|unique/i, 'dois confirmados com a mesma chave');
    assert.equal(await foto([s.c, outro.c]), antes, 'nenhuma escrita direta passou');
  });
});
