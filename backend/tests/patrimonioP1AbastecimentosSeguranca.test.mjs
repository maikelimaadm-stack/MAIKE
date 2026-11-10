/**
 * D-PROD-159 — Patrimônio P1-02: abastecimento × segurança (S1–S9 do
 * contrato §9.1). PostgreSQL real, HTTP autenticado, prova por linhas gravadas.
 *
 *  S1 401 sem sessão (ou token inválido) nas 16 rotas (A16 `produtos-do-bem`: D-PROD-160)
 *  S2 403 pela matriz da tela `pat-abastecimentos` (negado por padrão; ações extras próprias)
 *  S3 404 entre tenants e fazendas, sem oráculo (mesmo corpo do inexistente)
 *  S4 corpo/query fechados e decimais só como texto → 400; nada gravado
 *  S5 falha transacional provocada (gatilho) na auditoria E no estoque, no meio
 *     do efeito → rollback TOTAL (lotes, movimentos, estoque_atual, recibo, as 3
 *     tabelas e sequências idênticos); repetir com a MESMA chave aplica uma vez
 *  S6 RLS ligado sem FORCE e zero grants para PUBLIC/anon/authenticated
 *  S7 constraints por SQL direto (CHECKs, uniques, FKs compostas, RESTRICT)
 *  S8 `BemPatrimonial` nunca recebe 'ABASTECIMENTO' e o abastecimento não grava o bem
 *  S9 exclusões de empresa/produto/local/lote com abastecimento → 409, nunca 403
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import {
  TABELAS_ABASTECIMENTO, acoesAbastecimento, corpoAbastecimento, corpoErro, corpoPrevia, fotoAbastecimento, linhaAbastecimento, montarAbastecimento, opId, prisma,
} from './patrimonioP1AbastecimentoCenario.mjs';
import { TELAS, tudo } from './patrimonioP1Cenario.mjs';

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

const p4 = (v) => (v === null || v === undefined ? null : v.toFixed(4));
const contar = (s, modelo, where = {}) => /** @type {any} */ (prisma())[modelo].count({ where: { cliente_id: s.c, ...where } });
const estoqueAtual = async (produto) => p4((await prisma().produto.findUnique({ where: { id: produto.id } })).estoque_atual);
const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);

/**
 * As 16 rotas com entradas VÁLIDAS pelo schema e que, passando pela guarda, não
 * gravam nada (versão/fator vistos de propósito velhos → 409 de negócio).
 * @param {any} s @param {{ ab: string, conv: string }} ids
 */
const rotas = (s, { ab, conv }) => [
  ['A1', 'ver', 'GET', `/patrimonio-abastecimentos?empresa_id=${s.e1.id}`],
  ['A2', 'ver', 'GET', `/patrimonio-abastecimentos/${ab}?empresa_id=${s.e1.id}`],
  ['A3', 'criar', 'POST', '/patrimonio-abastecimentos-previa', corpoPrevia(s)],
  ['A4', 'criar', 'POST', '/patrimonio-abastecimentos', corpoAbastecimento(s, { conversao_versao: 99 })],
  ['A5', 'cancelar', 'POST', `/patrimonio-abastecimentos/${ab}/cancelar`, { empresa_id: s.e1.id, versao: 99, motivo: 'teste de permissão', operation_id: opId() }],
  ['A6', 'ver', 'GET', `/patrimonio-abastecimentos-consumo?empresa_id=${s.e1.id}&bem_id=${s.trator.id}`],
  ['A7', 'ver', 'GET', `/patrimonio-abastecimentos-opcoes/bens?empresa_id=${s.e1.id}`],
  ['A8', 'ver', 'GET', `/patrimonio-abastecimentos-opcoes/tanques?empresa_id=${s.e1.id}&bem_id=${s.trator.id}`],
  ['A9', 'ver', 'GET', '/patrimonio-abastecimentos-opcoes/tipos'],
  ['A10', 'ver', 'GET', `/patrimonio-abastecimentos-opcoes/produtos?empresa_id=${s.e1.id}&tipo_combustivel_id=${s.comb.DIESEL_S10}`],
  ['A11', 'ver', 'GET', `/patrimonio-abastecimentos-opcoes/produtos-filtro?empresa_id=${s.e1.id}`],
  ['A12', 'criar', 'GET', `/patrimonio-abastecimentos-opcoes/locais?empresa_id=${s.e1.id}&produto_id=${s.diesel.id}`],
  ['A13', 'ver', 'GET', `/patrimonio-conversoes-combustivel?empresa_id=${s.e1.id}`],
  ['A14', 'configurar', 'POST', '/patrimonio-conversoes-combustivel', {
    empresa_id: s.e1.id, tipo_combustivel_id: s.comb.DIESEL_S10, produto_id: s.diesel.id, kg_por_litro: '0.850000', declara_estoque_em_kg: true, conversao_vigente_id: 'nao-e-a-vigente',
  }],
  ['A15', 'configurar', 'POST', `/patrimonio-conversoes-combustivel/${conv}/encerrar`, { empresa_id: s.e1.id, versao: 99 }],
  ['A16', 'ver', 'GET', `/patrimonio-abastecimentos-opcoes/produtos-do-bem?empresa_id=${s.e1.id}&bem_id=${s.trator.id}`],
];

// ─────────────────────────────────────────────────────────────────────────────
describe('S1–S2 — sessão e permissões da tela pat-abastecimentos', () => {
  test('S1: sem token e com token inválido → 401 TENANT_CONTEXT_REQUIRED nas 16 rotas; S2: matriz 403 (negado por padrão; ações extras próprias; is_admin e administrador real passam); nada gravado', async () => {
    const s = await montarAbastecimento(app);
    const ab = await A.confirmarOk(s.operador.token, corpoAbastecimento(s));
    const ids = { ab: ab.id, conv: s.fator.diesel.id };
    const R = rotas(s, ids);
    assert.equal(R.length, 16);

    // ── S1 ──
    for (const [id, , metodo, url, corpo] of R) {
      for (const token of [null, 'nao.e.um.jwt']) {
        const r = await A.req(metodo, url, token, corpo);
        assert.deepEqual([r.statusCode, r.json().code], [401, 'TENANT_CONTEXT_REQUIRED'], `${id} ${token ? 'token inválido' : 'sem token'}: ${r.body}`);
      }
    }

    // ── S2 ── contas (todas criadas ANTES da fotografia)
    const conta = (acoes, modulos = ['patrimonio']) => s.conta({ modulos_permitidos: modulos, permissoes_telas: [linhaAbastecimento(acoes)] });
    const tudoMenosVer = { novo: true, salvar: true, editar: true, excluir: true, importar: true, exportar: true, cancelar: true, configurar_conversao: true };
    const contas = {
      'administrador real': { token: s.token, pode: ['ver', 'criar', 'cancelar', 'configurar'] },
      is_admin: { token: (await s.conta({ is_admin: true })).token, pode: ['ver', 'criar', 'cancelar', 'configurar'] },
      'perfil completo em pat-bens-patrimoniais, sem a linha': { token: (await s.contaCom(tudo(TELAS.bens))).token, pode: [] },
      'linha completa sem visualizar': { token: (await conta(tudoMenosVer)).token, pode: [] },
      'linha completa sem o módulo patrimonio': { token: (await conta({ visualizar: true, ...tudoMenosVer }, ['gestao-rural'])).token, pode: [] },
      'só visualizar': { token: s.leitor.token, pode: ['ver'] },
      'visualizar + novo': { token: s.operador.token, pode: ['ver', 'criar'] },
      'visualizar + salvar': { token: (await s.contaAbastecimento({ salvar: true })).token, pode: ['ver', 'criar'] },
      'visualizar + novo + cancelar': { token: s.contaCancelar.token, pode: ['ver', 'criar', 'cancelar'] },
      'visualizar + cancelar (sem novo)': { token: (await s.contaAbastecimento({ cancelar: true })).token, pode: ['ver', 'cancelar'] },
      'visualizar + configurar_conversao': { token: s.contaFator.token, pode: ['ver', 'configurar'] },
      'visualizar + editar/excluir/importar/exportar (ações que a tela não usa)': {
        token: (await s.contaAbastecimento({ editar: true, excluir: true, importar: true, exportar: true })).token, pode: ['ver'],
      },
    };
    const antes = await fotoAbastecimento(s.c);
    /** @type {string[]} */
    const divergencias = [];
    for (const [nome, c] of Object.entries(contas)) {
      for (const [id, guarda, metodo, url, corpo] of rotas(s, ids)) {
        const r = await A.req(metodo, url, c.token, corpo);
        const negado = r.statusCode === 403;
        const esperadoNegado = !c.pode.includes(guarda);
        if (negado !== esperadoNegado) divergencias.push(`${nome} · ${id} (${guarda}): ${r.statusCode} ${r.body.slice(0, 160)}`);
        if (negado) assert.equal(r.json().code, 'ACAO_NAO_PERMITIDA', `${nome} ${id}: ${r.body}`);
        else assert.ok(r.statusCode !== 401 && r.statusCode < 500, `${nome} ${id}: ${r.statusCode} ${r.body}`);
      }
    }
    assert.deepEqual(divergencias, [], 'matriz de permissões');
    assert.equal(await fotoAbastecimento(s.c), antes, 'nenhuma rota gravou nada (negadas antes da escrita; liberadas pararam no 409 de negócio)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S3 — isolamento entre tenants e fazendas', () => {
  test('abastecimento, bem, conversão, produto e empresa de OUTRO tenant (e abastecimento de OUTRA fazenda) → 404 com o MESMO corpo do inexistente; nada muda no outro tenant', async () => {
    const s = await montarAbastecimento(app);
    const t = await montarAbastecimento(app);
    const abT = await A.confirmarOk(t.operador.token, corpoAbastecimento(t));
    const abS = await A.confirmarOk(s.operador.token, corpoAbastecimento(s));
    const fotoT = await fotoAbastecimento(t.c);
    const fotoS = await fotoAbastecimento(s.c);
    const inex = `x${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    /** Corpo de erro sem request_id e com o id trocado por <id>: o alheio tem de ser IGUAL ao inexistente. */
    const sem = (r, ...ids) => ids.reduce((txt, id) => txt.split(id).join('<id>'), JSON.stringify(corpoErro(r)));
    const casos = [
      ['detalhe de abastecimento de outro tenant', abT.id, (id) => A.detalhe(s.token, id, s.e1.id), [404, 'ABASTECIMENTO_NAO_ENCONTRADO']],
      ['detalhe de abastecimento de outra fazenda', abS.id, (id) => A.detalhe(s.token, id, s.e2.id), [404, 'ABASTECIMENTO_NAO_ENCONTRADO']],
      ['cancelar abastecimento de outro tenant', abT.id, (id) => A.cancelar(s.contaCancelar.token, id, { empresa_id: s.e1.id, versao: 1, motivo: 'tentativa alheia', operation_id: opId() }), [404, 'ABASTECIMENTO_NAO_ENCONTRADO']],
      ['cancelar abastecimento de outra fazenda', abS.id, (id) => A.cancelar(s.token, id, { empresa_id: s.e2.id, versao: 1, motivo: 'tentativa alheia', operation_id: opId() }), [404, 'ABASTECIMENTO_NAO_ENCONTRADO']],
      ['empresa de outro tenant (lista)', t.e1.id, (id) => A.lista(s.token, id), null],
      ['prévia com bem de outro tenant', t.trator.id, (id) => A.previa(s.operador.token, corpoPrevia(s, { bem_id: id })), [404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO']],
      ['confirmar com bem de outro tenant', t.trator.id, (id) => A.confirmar(s.operador.token, corpoAbastecimento(s, { bem_id: id })), [404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO']],
      ['consumo de bem de outro tenant', t.trator.id, (id) => A.consumo(s.token, s.e1.id, id), [404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO']],
      ['tanques de bem de outro tenant', t.trator.id, (id) => A.opcoes(s.token, 'tanques', `empresa_id=${s.e1.id}&bem_id=${id}`), [404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO']],
      ['produtos do bem de outro tenant', t.trator.id, (id) => A.produtosDoBem(s.token, s.e1.id, id), [404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO']],
      ['locais de produto de outro tenant', t.diesel.id, (id) => A.opcoes(s.token, 'locais', `empresa_id=${s.e1.id}&produto_id=${id}`), [404, 'PRODUTO_NOT_FOUND']],
      ['encerrar fator de outro tenant', t.fator.diesel.id, (id) => A.req('POST', `/patrimonio-conversoes-combustivel/${id}/encerrar`, s.token, { empresa_id: s.e1.id, versao: 1 }), [404, 'CONVERSAO_COMBUSTIVEL_NAO_ENCONTRADA']],
      ['fator para produto de outro tenant', t.diesel.id, (id) => A.req('POST', '/patrimonio-conversoes-combustivel', s.token, {
        empresa_id: s.e1.id, tipo_combustivel_id: s.comb.DIESEL_S10, produto_id: id, kg_por_litro: '0.840000', declara_estoque_em_kg: true, conversao_vigente_id: null,
      }), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO']],
    ];
    for (const [rotulo, idAlheio, chamar, esperado] of casos) {
      const ra = await chamar(idAlheio);
      const ri = await chamar(inex);
      if (esperado) assert.deepEqual([ra.statusCode, ra.json().code], esperado, `${rotulo}: ${ra.body}`);
      else assert.ok([400, 404].includes(ra.statusCode) && ra.json().code === 'EMPRESA_NOT_FOUND', `${rotulo}: ${ra.body}`);
      assert.equal(ra.statusCode, ri.statusCode, `${rotulo}: mesmo status do inexistente`);
      assert.equal(sem(ra, idAlheio), sem(ri, inex), `${rotulo}: mesmo corpo do inexistente (sem oráculo)`);
    }
    // listas: nada do outro tenant / da outra fazenda
    const lista = await A.ok(A.lista(s.token, s.e1.id));
    assert.deepEqual(lista.items.map((i) => i.id), [abS.id]);
    assert.equal((await A.ok(A.lista(s.token, s.e1.id, `&bem_id=${t.trator.id}`))).total, 0);
    assert.equal((await A.ok(A.lista(s.token, s.e2.id))).total, 0);
    assert.equal((await A.ok(A.lista(s.token, s.e1.id, `&operation_id=${encodeURIComponent(corpoAbastecimento(t).operation_id)}`))).total, 0);
    assert.equal(await fotoAbastecimento(t.c), fotoT, 'nada mudou no outro tenant');
    assert.equal(await fotoAbastecimento(s.c), fotoS, 'nada mudou no próprio tenant');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S4 — corpo e query fechados; decimais só como texto', () => {
  test('campo extra, cliente_id, decimal número (quantidade_litros, medidor_leitura, kg_por_litro), formato inválido e operation_id inválido → 400; nada gravado', async () => {
    const s = await montarAbastecimento(app);
    const ab = await A.confirmarOk(s.operador.token, corpoAbastecimento(s));
    const antes = await fotoAbastecimento(s.c);
    const fator = (extra) => A.req('POST', '/patrimonio-conversoes-combustivel', s.contaFator.token, {
      empresa_id: s.e1.id, tipo_combustivel_id: s.comb.DIESEL_S10, produto_id: s.diesel.id, kg_por_litro: '0.850000', declara_estoque_em_kg: true, conversao_vigente_id: s.fator.diesel.id, ...extra,
    });
    const cancelar = (extra) => A.cancelar(s.contaCancelar.token, ab.id, { empresa_id: s.e1.id, versao: 1, motivo: 'corpo inválido', operation_id: opId(), ...extra });
    const casos = [
      ['A4 campo extra', () => A.confirmar(s.operador.token, corpoAbastecimento(s, { qualquer: 1 }))],
      ['A4 cliente_id', () => A.confirmar(s.operador.token, corpoAbastecimento(s, { cliente_id: s.c }))],
      ['A4 quantidade_litros número', () => A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: 80 })), 'quantidade_litros', 'valor_deve_ser_texto'],
      ['A4 medidor_leitura número', () => A.confirmar(s.operador.token, corpoAbastecimento(s, { medidor_leitura: 1550.5 })), 'medidor_leitura', 'valor_deve_ser_texto'],
      ['A4 litros com vírgula', () => A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '80,5' }))],
      ['A4 litros em notação científica', () => A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '8e1' }))],
      ['A4 litros com 5 casas', () => A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '80.00001' }))],
      ['A4 operation_id curto', () => A.confirmar(s.operador.token, corpoAbastecimento(s, { operation_id: 'curta' }))],
      ['A4 operation_id com espaço', () => A.confirmar(s.operador.token, corpoAbastecimento(s, { operation_id: 'abast com espaço 123' }))],
      ['A4 sem conversao_versao', () => A.confirmar(s.operador.token, { ...corpoAbastecimento(s), conversao_versao: undefined })],
      ['A3 com operation_id', () => A.previa(s.operador.token, { ...corpoPrevia(s), operation_id: opId() })],
      ['A3 cliente_id', () => A.previa(s.operador.token, { ...corpoPrevia(s), cliente_id: s.c })],
      ['A3 quantidade_litros número', () => A.previa(s.operador.token, { ...corpoPrevia(s), quantidade_litros: 80 }), 'quantidade_litros', 'valor_deve_ser_texto'],
      ['A5 cliente_id', () => cancelar({ cliente_id: s.c })],
      ['A5 campo extra', () => cancelar({ estornar_tudo: true })],
      ['A5 operation_id inválido', () => cancelar({ operation_id: 'x' })],
      ['A14 kg_por_litro número', () => fator({ kg_por_litro: 0.85 }), 'kg_por_litro', 'valor_deve_ser_texto'],
      ['A14 kg_por_litro com 7 casas', () => fator({ kg_por_litro: '0.8500001' })],
      ['A14 cliente_id', () => fator({ cliente_id: s.c })],
      ['A14 campo extra', () => fator({ ativo: true })],
      ['A15 campo extra', () => A.req('POST', `/patrimonio-conversoes-combustivel/${s.fator.diesel.id}/encerrar`, s.contaFator.token, { empresa_id: s.e1.id, versao: 1, motivo: 'x' })],
      ['A1 query com cliente_id', () => A.lista(s.token, s.e1.id, `&cliente_id=${s.c}`)],
      ['A1 query com campo extra', () => A.lista(s.token, s.e1.id, '&ordem=asc')],
      ['A12 query com campo extra', () => A.opcoes(s.token, 'locais', `empresa_id=${s.e1.id}&produto_id=${s.diesel.id}&todos=1`)],
      ['A16 query com cliente_id', () => A.produtosDoBem(s.token, s.e1.id, s.trator.id, `&cliente_id=${s.c}`)],
    ];
    for (const [rotulo, chamar, field, reason] of casos) {
      const r = await chamar();
      assert.deepEqual([r.statusCode, r.json().code], [400, 'REQUEST_VALIDATION_FAILED'], `${rotulo}: ${r.body}`);
      if (field) assert.deepEqual([r.json().field, r.json().reason], [field, reason], `${rotulo}: ${r.body}`);
    }
    assert.equal(await fotoAbastecimento(s.c), antes, 'nada gravado');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S5 — falha transacional provocada no meio do efeito', () => {
  const FALHA = 'p102s_falha';
  const instalarFalha = async (s, tabela, condicao = 'TRUE', evento = 'INSERT') => {
    const p = prisma();
    await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${FALHA}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'falha provocada pelo teste P1-02 S5'; END $f$`);
    await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${FALHA} ON "${tabela}"`);
    await p.$executeRawUnsafe(`CREATE TRIGGER ${FALHA} BEFORE ${evento} ON "${tabela}" FOR EACH ROW WHEN (NEW.cliente_id = '${s.c}' AND ${condicao}) EXECUTE FUNCTION ${FALHA}()`);
  };
  const removerFalha = (tabela) => prisma().$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${FALHA} ON "${tabela}"`);
  /** Roda `chamar` com o gatilho de falha; exige 5xx genérico e o banco IDÊNTICO; remove o gatilho. */
  const comFalha = async (s, rotulo, [tabela, condicao, evento], chamar) => {
    const antes = await fotoAbastecimento(s.c);
    await instalarFalha(s, tabela, condicao, evento);
    let r;
    try {
      r = await chamar();
    } finally {
      await removerFalha(tabela);
    }
    assert.ok(r.statusCode >= 500, `${rotulo}: ${r.statusCode} ${r.body}`);
    assert.ok(['INTERNAL_ERROR', 'AUDIT_WRITE_FAILED'].includes(r.json().code), `${rotulo}: ${r.body}`);
    assert.ok(!r.body.includes('falha provocada'), `${rotulo}: o erro do banco não vaza na resposta`);
    assert.equal(await fotoAbastecimento(s.c), antes, `${rotulo}: rollback total (3 tabelas, lotes, movimentos, estoque_atual, recibo, auditoria, sequências)`);
  };

  test('confirmar e cancelar: falha no 2º lote (estoque) e na auditoria → 5xx e nada gravado; repetir com a MESMA chave aplica uma única vez', async () => {
    const s = await montarAbastecimento(app);
    const loteB = s.lotes.dieselB.id;
    // (1) confirmar: o lote A já foi baixado NA transação quando o UPDATE do lote B falha
    const c1 = corpoAbastecimento(s);
    await comFalha(s, 'confirmar × falha no lote B', ['EstoqueLoteNota', `NEW.id = '${loteB}'`, 'UPDATE'], () => A.confirmar(s.operador.token, c1));
    const d1 = await A.confirmarOk(s.operador.token, c1);
    assert.deepEqual(d1.fatias.map((f) => f.quantidade_kg), ['50.0000', '17.2000']);
    // (2) confirmar: falha na auditoria (depois de lotes, movimento, linha, fatias e numeração)
    const c2 = corpoAbastecimento(s, { quantidade_litros: '10' });
    await comFalha(s, 'confirmar × falha na auditoria', ['AuditLog', `NEW.entidade = 'AbastecimentoBem'`], () => A.confirmar(s.operador.token, c2));
    const d2 = await A.confirmarOk(s.operador.token, c2);
    assert.equal(await contar(s, 'movimentacaoEstoque', { origem_sistema: 'abastecimento_patrimonio' }), 2, 'uma saída por abastecimento, mesmo depois das falhas');
    assert.equal(await estoqueAtual(s.diesel), '74.4000');
    // (3) cancelar d1: o lote A já recebeu a devolução NA transação quando o lote B falha
    const k1 = { empresa_id: s.e1.id, versao: 1, motivo: 'estorno com falha provocada', operation_id: opId() };
    await comFalha(s, 'cancelar × falha no lote B', ['EstoqueLoteNota', `NEW.id = '${loteB}'`, 'UPDATE'], () => A.cancelar(s.contaCancelar.token, d1.id, k1));
    const x1 = await A.cancelar(s.contaCancelar.token, d1.id, k1);
    assert.deepEqual([x1.statusCode, x1.json().status, x1.json().replay], [200, 'CANCELADO', false], x1.body);
    // (4) cancelar d2: falha na auditoria do cancelamento
    const k2 = { empresa_id: s.e1.id, versao: 1, motivo: 'estorno com falha provocada', operation_id: opId() };
    await comFalha(s, 'cancelar × falha na auditoria', ['AuditLog', `NEW.acao = 'abastecimento_bem.cancelar'`], () => A.cancelar(s.contaCancelar.token, d2.id, k2));
    const x2 = await A.cancelar(s.contaCancelar.token, d2.id, k2);
    assert.equal(x2.statusCode, 200, x2.body);
    assert.equal(await contar(s, 'movimentacaoEstoque', { tipo_detalhado: 'estorno_abastecimento' }), 2, 'um estorno por cancelamento');
    assert.equal(await estoqueAtual(s.diesel), '150.0000');
    assert.equal(await contar(s, 'auditLog', { entidade: 'AbastecimentoBem' }), 4, 'confirmar ×2 e cancelar ×2, nenhuma auditoria das tentativas que falharam');
  });

  test('fator kg/L: falha na auditoria e no INSERT do fator novo (depois de encerrar o vigente) → 5xx e o vigente segue intacto; repetir aplica', async () => {
    const s = await montarAbastecimento(app, { lotes: false });
    const troca = () => s.configurarFator(s.e1, s.comb.DIESEL_S10, s.diesel, '0.850000', s.fator.diesel.id);
    await comFalha(s, 'fator × falha na auditoria', ['AuditLog', `NEW.entidade = 'ConversaoCombustivelProduto'`], troca);
    await comFalha(s, 'fator × falha no INSERT do novo', ['ConversaoCombustivelProduto', 'TRUE'], troca);
    const f1 = await prisma().conversaoCombustivelProduto.findUnique({ where: { id: s.fator.diesel.id } });
    assert.deepEqual([f1.ativo, f1.versao, f1.encerrado_em], [true, 1, null], 'o encerramento do vigente voltou junto');
    const r = await troca();
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual([r.json().sequencia, r.json().kg_por_litro], [2, '0.850000']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S6–S8 — o banco é a última rede', () => {
  test('S6: RLS ligado sem FORCE e zero grants para PUBLIC/anon/authenticated nas 3 tabelas', async () => {
    const p = prisma();
    const rls = /** @type {any[]} */ (await p.$queryRaw`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace AND relname = ANY(${[...TABELAS_ABASTECIMENTO]}::text[]) ORDER BY relname`);
    assert.deepEqual(rls.map((r) => [r.relname, r.relrowsecurity, r.relforcerowsecurity]), [...TABELAS_ABASTECIMENTO].sort().map((t) => [t, true, false]));
    const grants = /** @type {any[]} */ (await p.$queryRaw`
      SELECT c.relname, a.grantee::regrole::text AS grantee, a.privilege_type
        FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
       WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY(${[...TABELAS_ABASTECIMENTO]}::text[])
         AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))`);
    assert.deepEqual(grants, [], 'nenhum privilégio para PUBLIC, anon ou authenticated');
    for (const papel of ['anon', 'authenticated']) {
      const existe = /** @type {any[]} */ (await p.$queryRaw`SELECT 1 FROM pg_roles WHERE rolname = ${papel}`);
      if (!existe.length) continue;
      for (const t of TABELAS_ABASTECIMENTO) {
        const [r] = /** @type {any[]} */ (await p.$queryRawUnsafe(`SELECT has_table_privilege('${papel}', 'public."${t}"', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS pode`));
        assert.equal(r.pode, false, `${papel} em ${t}`);
      }
    }
  });

  test('S6b: com os papéis do Supabase e o default hostil simulado (GRANT ALL a anon/authenticated), o DO da migration revoga tudo e cria maike_backend_all para maike_vercel — numa transação desfeita no fim', async () => {
    // Na CI (cluster novo) anon/authenticated/maike_vercel não existem quando a migration roda:
    // o DO pula o REVOKE e a política, e o S6 acima não exercita nenhum dos dois. Aqui os papéis
    // são criados (CREATE ROLE é transacional), o default do Supabase é simulado e o DO
    // EXATO do migration.sql roda de novo (é idempotente). Tudo volta no ROLLBACK.
    const sql = readFileSync(new URL('../prisma/migrations/20261110200000_patrimonio_p1_02_abastecimentos/migration.sql', import.meta.url), 'utf8');
    const blocos = sql.match(/^DO \$\$[\s\S]*?^END \$\$;/gm) ?? [];
    assert.equal(blocos.length, 1, 'a migration tem exatamente um bloco DO (o de REVOKE/RLS)');
    const PRIVS = 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';
    const papeis = ['anon', 'authenticated'];
    const p = prisma();
    const antes = /** @type {any[]} */ (await p.$queryRaw`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'maike_vercel') ORDER BY 1`);
    const DESFAZER = new Error('rollback proposital do S6b');
    /** @type {{ controle: any[], depois: any[], politicas: any[] } | null} */
    let visto = null;
    const pode = async (tx) => {
      const linhas = [];
      for (const papel of papeis) {
        for (const t of TABELAS_ABASTECIMENTO) {
          const [r] = /** @type {any[]} */ (await tx.$queryRawUnsafe(`SELECT has_table_privilege('${papel}', 'public."${t}"', '${PRIVS}') AS pode`));
          linhas.push([papel, t, r.pode]);
        }
      }
      return linhas;
    };
    await p
      .$transaction(async (tx) => {
        for (const papel of ['anon', 'authenticated', 'maike_vercel']) {
          await tx.$executeRawUnsafe(`DO $papel$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${papel}') THEN CREATE ROLE ${papel} NOLOGIN; END IF; END $papel$`);
        }
        for (const t of TABELAS_ABASTECIMENTO) await tx.$executeRawUnsafe(`GRANT ALL ON TABLE public."${t}" TO anon, authenticated`);
        const controle = await pode(tx);
        await tx.$executeRawUnsafe(blocos[0]);
        const depois = await pode(tx);
        const politicas = /** @type {any[]} */ (await tx.$queryRaw`SELECT tablename::text AS t, cmd, array_to_string(roles, ',') AS roles, qual, with_check FROM pg_policies
          WHERE schemaname = 'public' AND policyname = 'maike_backend_all' AND tablename = ANY(${[...TABELAS_ABASTECIMENTO]}::text[]) ORDER BY 1`);
        visto = { controle, depois, politicas };
        throw DESFAZER;
      }, { timeout: 20000 })
      .catch((e) => {
        if (e !== DESFAZER) throw e;
      });
    assert.ok(visto, 'a transação chegou ao fim');
    const v = /** @type {{ controle: any[], depois: any[], politicas: any[] }} */ (/** @type {unknown} */ (visto));
    assert.ok(v.controle.every((l) => l[2] === true), `controle negativo: o GRANT simulado vale antes do DO (${JSON.stringify(v.controle)})`);
    assert.ok(v.depois.every((l) => l[2] === false), `o DO revoga anon/authenticated nas 3 (${JSON.stringify(v.depois)})`);
    assert.deepEqual(
      v.politicas.map((x) => [x.t, x.cmd, x.roles, x.qual, x.with_check]),
      [...TABELAS_ABASTECIMENTO].sort().map((t) => [t, 'ALL', 'maike_vercel', 'true', 'true']),
      '1 política maike_backend_all, ALL, só para maike_vercel, em cada tabela',
    );
    const depoisDoRollback = /** @type {any[]} */ (await p.$queryRaw`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'maike_vercel') ORDER BY 1`);
    assert.deepEqual(depoisDoRollback, antes, 'nenhum papel criado sobrevive ao ROLLBACK');
  });

  test('S7: CHECKs, uniques, FKs compostas e RESTRICT recusam escrita direta incoerente; S8: BemPatrimonial nunca recebe ABASTECIMENTO e o abastecimento não grava o bem', async () => {
    const s = await montarAbastecimento(app);
    const p = prisma();
    const bemAntes = JSON.stringify(await p.bemPatrimonial.findUnique({ where: { id: s.trator.id } }), replacer);
    const tanquesAntes = JSON.stringify(await p.tanqueBem.findMany({ where: { bem_id: s.trator.id }, orderBy: { id: 'asc' } }), replacer);
    const a1 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s));
    const a2 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '10' }));
    // S8: o bem (todas as colunas, inclusive versao/updatedAt e medidor) e os tanques ficam intactos
    assert.equal(JSON.stringify(await p.bemPatrimonial.findUnique({ where: { id: s.trator.id } }), replacer), bemAntes, 'abastecer não grava BemPatrimonial');
    assert.equal(JSON.stringify(await p.tanqueBem.findMany({ where: { bem_id: s.trator.id }, orderBy: { id: 'asc' } }), replacer), tanquesAntes);
    const vinculo = await p.tipoCombustivelProduto.findFirst({ where: { cliente_id: s.c, produto_id: s.diesel.id } });
    const antes = await fotoAbastecimento(s.c);
    const bemCheck = /** @type {any[]} */ (await p.$queryRaw`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'BemPatrimonial_medidor_origem_check'`);
    assert.equal(bemCheck.length, 1);
    assert.match(bemCheck[0].def, /CADASTRO_INICIAL/);
    assert.match(bemCheck[0].def, /AJUSTE_CADASTRO/);
    assert.doesNotMatch(bemCheck[0].def, /ABASTECIMENTO/, 'CHECK antigo do bem intacto (D4)');

    const recusa = async (sql, padrao, rotulo) => {
      const r = await p.$executeRawUnsafe(sql).then(() => null, (e) => e);
      assert.ok(r, `${rotulo}: o banco aceitou`);
      assert.match(String(r.message), padrao, `${rotulo}: ${r.message}`);
    };
    const AB = (set, id = a1.id) => `UPDATE "AbastecimentoBem" SET ${set} WHERE id = '${id}'`;
    // S8
    await recusa(`UPDATE "BemPatrimonial" SET medidor_origem = 'ABASTECIMENTO' WHERE id = '${s.trator.id}'`, /BemPatrimonial_medidor_origem_check/, 'bem com origem ABASTECIMENTO');
    // S7 — AbastecimentoBem
    await recusa(AB('quantidade_kg = quantidade_kg + 0.0001'), /AbastecimentoBem_conversao_kg_check/, 'kg ≠ round(litros × fator, 4)');
    await recusa(AB('kg_por_litro = 0.850000'), /AbastecimentoBem_conversao_kg_check/, 'fator trocado sem recalcular kg');
    await recusa(AB('medidor_leitura = NULL'), /AbastecimentoBem_medidor_check/, 'contador sem leitura');
    await recusa(AB(`medidor_tipo = 'SEM_MEDIDOR'`), /AbastecimentoBem_medidor_check/, 'SEM_MEDIDOR com leitura');
    await recusa(AB(`medidor_origem = 'CADASTRO_INICIAL'`), /AbastecimentoBem_medidor_check/, 'origem ≠ ABASTECIMENTO');
    await recusa(AB(`medidor_unidade = 'km'`), /AbastecimentoBem_medidor_check/, 'horímetro em km');
    await recusa(AB(`status = 'CANCELADO'`), /AbastecimentoBem_status_check/, 'CANCELADO sem estorno');
    await recusa(AB(`status = 'ESTORNADO'`), /AbastecimentoBem_status_check/, 'status fora do domínio');
    await recusa(AB(`status = 'CANCELADO', movimentacao_estorno_id = movimentacao_estoque_id, cancelado_em = now(), motivo_cancelamento = 'estorno direto'`), /AbastecimentoBem_movimentos_check|AbastecimentoBem_cliente_id_movimentacao_estorno_id_key/, 'estorno = o próprio movimento');
    await recusa(AB('quantidade_litros = 0, quantidade_kg = 0'), /AbastecimentoBem_quantidades_check/, 'litros zero');
    await recusa(AB(`conversao_id = '${s.fator.gasolina.id}'`), /AbastecimentoBem_conversao_fkey|foreign key/i, 'fator de OUTRO par (FK de 5 colunas)');
    await recusa(AB(`empresa_id = '${s.e2.id}'`), /foreign key/i, 'abastecimento mudado de fazenda (fator/fatias da e1)');
    await recusa(AB(`operation_id = '${(await p.abastecimentoBem.findUnique({ where: { id: a1.id } })).operation_id}'`, a2.id), /AbastecimentoBem_cliente_id_operation_id_key|23505/, 'operation_id repetido');
    await recusa(AB(`numero = '${a1.numero}'`, a2.id), /AbastecimentoBem_cliente_id_numero_key|23505/, 'número repetido');
    await recusa(AB(`movimentacao_estoque_id = '${a1.movimentacao.id}'`, a2.id), /AbastecimentoBem_cliente_id_movimentacao_estoque_id_key|23505/, 'mesmo movimento em 2 abastecimentos');
    // fatias
    await recusa(`UPDATE "AbastecimentoBemConsumoLote" SET empresa_id = '${s.e2.id}' WHERE abastecimento_id = '${a1.id}'`, /AbastecimentoBemConsumoLote_abastecimento_fkey|foreign key/i, 'fatia de outra fazenda');
    await recusa(`UPDATE "AbastecimentoBemConsumoLote" SET quantidade = 0 WHERE abastecimento_id = '${a1.id}' AND ordem = 1`, /AbastecimentoBemConsumoLote_valores_check/, 'fatia zero');
    await recusa(`UPDATE "AbastecimentoBemConsumoLote" SET ordem = 1 WHERE abastecimento_id = '${a1.id}' AND ordem = 2`, /AbastecimentoBemConsumoLote_abastecimento_ordem_key|23505/, 'ordem repetida');
    // fator
    const F = (set) => `UPDATE "ConversaoCombustivelProduto" SET ${set} WHERE id = '${s.fator.diesel.id}'`;
    await recusa(F('kg_por_litro = 10.000001'), /ConversaoCombustivelProduto_fator_check/, 'fator > 10');
    await recusa(F('kg_por_litro = 0'), /ConversaoCombustivelProduto_fator_check/, 'fator zero');
    await recusa(F('declara_estoque_em_kg = false'), /ConversaoCombustivelProduto_declaracao_check/, 'sem declaração de estoque em KG');
    await recusa(F('ativo = false'), /ConversaoCombustivelProduto_vigencia_check/, 'encerrado com ativo_chave');
    await recusa(`INSERT INTO "ConversaoCombustivelProduto" (id, cliente_id, empresa_id, tipo_combustivel_id, produto_id, sequencia, kg_por_litro, declara_estoque_em_kg, ativo, ativo_chave, versao, "updatedAt")
      VALUES ('${randomUUID()}', '${s.c}', '${s.e1.id}', '${s.comb.DIESEL_S10}', '${s.diesel.id}', 9, 0.85, true, true, true, 1, now())`, /ConversaoCombustivelProduto_par_vigente_key|23505/, 'dois vigentes no par');
    await recusa(`INSERT INTO "ConversaoCombustivelProduto" (id, cliente_id, empresa_id, tipo_combustivel_id, produto_id, sequencia, kg_por_litro, declara_estoque_em_kg, ativo, ativo_chave, versao, "updatedAt")
      VALUES ('${randomUUID()}', '${s.c}', '${s.e1.id}', '${s.comb.GASOLINA}', '${s.diesel.id}', 1, 0.85, true, true, true, 1, now())`, /ConversaoCombustivelProduto_vinculo_fkey|foreign key/i, 'fator sem vínculo do par');
    // RESTRICT: nada referenciado some por DELETE direto
    await recusa(`DELETE FROM "MovimentacaoEstoque" WHERE id = '${a1.movimentacao.id}'`, /foreign key/i, 'movimento do abastecimento');
    await recusa(`DELETE FROM "EstoqueLoteNota" WHERE id = '${s.lotes.dieselA.id}'`, /foreign key/i, 'lote com fatia');
    await recusa(`DELETE FROM "TanqueBem" WHERE id = '${s.trator.tanques[0].id}'`, /foreign key/i, 'tanque abastecido');
    await recusa(`DELETE FROM "ConversaoCombustivelProduto" WHERE id = '${s.fator.diesel.id}'`, /foreign key/i, 'fator usado');
    await recusa(`DELETE FROM "TipoCombustivelProduto" WHERE id = '${vinculo.id}'`, /foreign key/i, 'vínculo com fator');
    await recusa(`DELETE FROM "AbastecimentoBem" WHERE id = '${a1.id}'`, /foreign key/i, 'abastecimento com fatias');
    assert.equal(await fotoAbastecimento(s.c), antes, 'nenhuma escrita direta passou');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S9 — exclusões barradas por abastecimento', () => {
  test('empresa (conta as 3 tabelas), produto, local e lote com abastecimento → 409 (nunca 403 da FK), antes e depois do cancelamento; nada apagado', async () => {
    const s = await montarAbastecimento(app);
    const ab = await A.confirmarOk(s.operador.token, corpoAbastecimento(s));
    const tentar = async (rotulo) => {
      const antes = await fotoAbastecimento(s.c);
      const emp = await A.req('DELETE', `/empresas/${s.e1.id}`, s.token);
      assert.deepEqual([emp.statusCode, emp.json().code], [409, 'EMPRESA_COM_VINCULOS'], `${rotulo} empresa: ${emp.body}`);
      const entidades = emp.json().details.vinculos.map((v) => v.entidade);
      for (const t of TABELAS_ABASTECIMENTO) assert.ok(entidades.includes(t), `${rotulo}: vínculos da empresa contam ${t} (${entidades})`);
      const prod = await A.req('DELETE', `/produtos/${s.diesel.id}`, s.token);
      assert.deepEqual([prod.statusCode, prod.json().code], [409, 'PRODUTO_DELETE_BLOCKED'], `${rotulo} produto: ${prod.body}`);
      const local = await A.req('DELETE', `/locais-estoque/${s.local.id}`, s.token);
      assert.deepEqual([local.statusCode, local.json().code], [409, 'LOCAL_ESTOQUE_DELETE_BLOCKED'], `${rotulo} local: ${local.body}`);
      const lote = await A.req('DELETE', `/estoque-lotes-nota/${s.lotes.dieselA.id}`, s.token);
      assert.deepEqual([lote.statusCode, lote.json().code, lote.json().details?.vinculo], [409, 'REGISTRO_OPERACIONAL_IMUTAVEL', 'abastecimento_bem'], `${rotulo} lote: ${lote.body}`);
      assert.equal(await fotoAbastecimento(s.c), antes, `${rotulo}: nada apagado`);
    };
    await tentar('confirmado');
    const x = await A.cancelar(s.contaCancelar.token, ab.id, { empresa_id: s.e1.id, versao: 1, motivo: 'histórico continua', operation_id: opId() });
    assert.equal(x.statusCode, 200, x.body);
    await tentar('cancelado (o histórico fica)');
  });
});
