/**
 * D-PROD-161 — MAIKE-ESTOQUE-P0-01 R2: reconciliação escalável SEM falso
 * positivo. PostgreSQL real; a medida física é a do próprio PostgreSQL
 * (`pg_stat_xact_user_tables`, dentro da transação da leitura) e a contagem de
 * linhas devolvidas ao Node por ida ao banco.
 *
 *  RX  exclusões legadas de lote (só existem no AuditLog): dimensão PRÓPRIA da
 *      varredura (cursor próprio, orçamento contado), cada exclusão vira achado
 *      — inclusive a de produto que já não existe (nunca omitida em silêncio);
 *      a evidência que rebaixa produto/local é buscada só quando muda a
 *      classe, com teto físico; acima do teto → evidência parcial declarada.
 *  RO  órfãos (lote/movimento com produto inexistente) antes do primeiro,
 *      entre dois e depois do último id de Produto, e tenant sem produto: a
 *      chave da varredura é o `produto_id` (de Produto, lote OU movimento), e
 *      nenhuma linha é processada fora do orçamento contado; produto pesado
 *      devolve ao Node só as linhas suspeitas (agregado no SQL), com teto.
 *  RS  contrato: fim do escopo desta chamada × continuação × cobertura
 *      cumulativa × conclusão global (só com o escopo inteiro num ÚNICO
 *      snapshot; em várias chamadas = INCONCLUSIVO, nunca falso OK).
 *  RK  cursor autenticado (HMAC-SHA256, chave HKDF do AUTH_SECRET com rótulo
 *      próprio) e amarrado a tenant, empresa, produto, local, limite e versão:
 *      qualquer desvio → o MESMO 400 (sem oráculo).
 *  RV  linhagem da transferência (`lote_destino_id`), AuditLog benigno
 *      (procedência, renomeação, custo de cadastro) e filtro de local nunca
 *      mascaram divergência física.
 *  RI  isolamento: `cliente_id` em toda consulta, nada de outro tenant entra,
 *      zero escrita (estatística da transação).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, hkdfSync, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

import { criarApp, criarTenant, limparBanco, encerrar } from './helpers.mjs';
import { acoes, codigo, docCom, montarTenant, opId, prisma } from './gestaoP3Cenario.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoes>} */
let A;
/** @type {PrismaClient} */
let aux;
before(async () => {
  app = await criarApp();
  await app.ready();
  await limparBanco();
  A = acoes(app);
  aux = new PrismaClient();
});
after(async () => {
  await aux?.$disconnect();
  await app.close();
  await encerrar();
});

const ROTA = '/estoque-fisico/reconciliacao';
const MODULO = '../src/modules/estoqueFisico/reconciliacaoEstoque.js';
const URL_TRANSF = '/movimentacoes-estoque/comandos/transferencia-locais';
const DESFAZ = 'r2-desfaz';
const AGORA = Date.parse(process.env.MAIKE_TESTE_AGORA ?? '2027-06-15T15:00:00.000Z');
const item = (produto, quantidade, valor_unitario, extra = {}) => ({ produto, quantidade, valor_unitario, ...extra });

const reconciliar = (token, query = {}) => {
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
  return app.inject({ method: 'GET', url: qs ? `${ROTA}?${qs}` : ROTA, headers: token ? { authorization: `Bearer ${token}` } : {} });
};
const relatorio = async (s, query = {}) => {
  const r = await reconciliar(s.token, query);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const contexto = (c) => ({ auth: { clienteId: c, usuarioId: 'r2', login: 'r2' }, requestId: `r2-${randomUUID().slice(0, 8)}` });
/** Serviço direto (abre a própria transação), com orçamento opcional. */
const servico = async (c, filtro = {}, orcamento = undefined) => {
  const { reconciliarEstoque } = await import(MODULO);
  return reconciliarEstoque(contexto(c), filtro, orcamento);
};
/** Varredura inteira pelo cursor (cada chamada = um snapshot). */
const varrer = async (c, filtro = {}, orcamento = undefined, maximo = 80) => {
  const chamadas = [];
  let cursor = filtro.cursor;
  do {
    const r = await servico(c, { ...filtro, cursor }, orcamento);
    chamadas.push(r);
    cursor = r.cobertura.proximo_cursor ?? undefined;
    assert.ok(chamadas.length <= maximo, `a varredura termina (${chamadas.length} chamadas)`);
  } while (cursor);
  return chamadas;
};
const textoSql = (args) => {
  if (args[0] && typeof args[0] === 'object' && Array.isArray(args[0].strings) && !('raw' in args[0])) return { text: args[0].text, values: args[0].values };
  if (Array.isArray(args[0]) && 'raw' in args[0]) {
    const s = Prisma.sql(args[0], ...args.slice(1));
    return { text: s.text, values: s.values };
  }
  return { text: String(args[0]), values: args.slice(1) };
};
/**
 * UMA chamada de `lerReconciliacao` dentro de uma transação RepeatableRead do
 * teste (desfeita no fim): idas ao banco (texto, valores, linhas devolvidas) e
 * a estatística física da transação (`pg_stat_xact_user_tables`).
 * `enable_seqscan=off` só nesta sessão do teste: com tabelas pequenas o
 * planejador preferiria ler a tabela inteira (barato aqui, caro em escala); o
 * que se mede é a forma do plano que vale em escala (o EXPLAIN da carga mostra
 * o mesmo plano escolhido por custo).
 */
const medir = async (c, filtro = {}, orcamento = undefined, { semSeqscan = true } = {}) => {
  const { lerReconciliacao } = await import(MODULO);
  /** @type {Array<{ text: string, values: unknown[], linhas: number }>} */
  const consultas = [];
  /** @type {any} */
  let r = null;
  /** @type {any[]} */
  let stats = [];
  let sessao = null;
  // `pg_stat_xact_*` (PG15+) soma também o que transações anteriores da MESMA conexão ainda não
  // descarregaram: mede-se a diferença entre o começo e o fim desta transação.
  const estatistica = (tx) => tx.$queryRaw`SELECT relname::text AS tabela, seq_scan::int, seq_tup_read::int, idx_scan::int, idx_tup_fetch::int,
      n_tup_ins::int, n_tup_upd::int, n_tup_del::int
    FROM pg_stat_xact_user_tables WHERE seq_scan + idx_scan + n_tup_ins + n_tup_upd + n_tup_del > 0`;
  await aux.$transaction(async (tx) => {
    const base = /** @type {any[]} */ (await estatistica(tx));
    if (semSeqscan) await tx.$queryRaw`SELECT set_config('enable_seqscan', 'off', true)`;
    const proxy = new Proxy(tx, {
      get(alvo, prop) {
        const v = alvo[prop];
        if (prop === '$queryRaw' || prop === '$executeRaw' || prop === '$queryRawUnsafe' || prop === '$executeRawUnsafe') {
          return async (...args) => {
            const antesDbg = process.env.R2_DEPURAR ? await estatistica(alvo) : null;
            const res = await v.apply(alvo, args);
            if (antesDbg) {
              const depoisDbg = /** @type {any[]} */ (await estatistica(alvo));
              const de = (l) => (l.find((t) => t.tabela === 'AuditLog') ?? { seq_tup_read: 0, idx_tup_fetch: 0 });
              const n = de(depoisDbg).seq_tup_read + de(depoisDbg).idx_tup_fetch - de(antesDbg).seq_tup_read - de(antesDbg).idx_tup_fetch;
              console.error('DBG', n, textoSql(args).text.trim().replace(/\s+/g, ' ').slice(0, 80));
            }
            consultas.push({ ...textoSql(args), linhas: Array.isArray(res) ? res.length : 0, prop: String(prop) });
            return res;
          };
        }
        if (v && typeof v === 'object' && typeof v.findUnique === 'function') {
          return new Proxy(v, { get: (m, met) => (typeof m[met] === 'function' ? (...a) => { consultas.push({ text: `${String(prop)}.${String(met)}`, values: [JSON.stringify(a)], linhas: 1, prop: 'modelo' }); return m[met].apply(m, a); } : m[met]) });
        }
        return typeof v === 'function' ? v.bind(alvo) : v;
      },
    });
    r = await lerReconciliacao(proxy, c, filtro, orcamento);
    const fim = /** @type {any[]} */ (await estatistica(tx));
    const campos = ['seq_scan', 'seq_tup_read', 'idx_scan', 'idx_tup_fetch', 'n_tup_ins', 'n_tup_upd', 'n_tup_del'];
    stats = fim.map((t) => {
      const b = base.find((x) => x.tabela === t.tabela);
      return { tabela: t.tabela, ...Object.fromEntries(campos.map((c) => [c, t[c] - (b?.[c] ?? 0)])) };
    });
    sessao = (await tx.$queryRaw`SELECT current_setting('transaction_read_only') AS ro, current_setting('transaction_isolation') AS iso`)[0];
    throw new Error(DESFAZ);
  }, { isolationLevel: 'RepeatableRead', maxWait: 10000, timeout: 120000 }).catch((e) => { if (e?.message !== DESFAZ) throw e; });
  const tabela = (nome) => stats.find((t) => t.tabela === nome) ?? { seq_tup_read: 0, idx_tup_fetch: 0, seq_scan: 0, idx_scan: 0 };
  const lidasDe = (nome) => { const t = tabela(nome); return t.seq_tup_read + t.idx_tup_fetch; };
  return { r, consultas, stats, sessao, lidasDe, linhasAoNode: consultas.reduce((t, q) => t + q.linhas, 0) };
};
/** Varredura inteira pela transação medida (o cursor vem da resposta anterior). */
const medirTudo = async (c, filtro = {}, orcamento = undefined, maximo = 60) => {
  const chamadas = [];
  let cursor = filtro.cursor;
  do {
    const m = await medir(c, { ...filtro, cursor }, orcamento);
    chamadas.push(m);
    cursor = m.r.cobertura.proximo_cursor ?? undefined;
    if (chamadas.length > maximo) break;
  } while (cursor);
  return chamadas;
};
const achadosDe = (rel, nivel, campo, id) => rel.achados.filter((a) => a.nivel === nivel && a.chave?.[campo] === id);
const chaveDe = (a) => `${a.nivel}|${JSON.stringify(a.chave)}|${a.classe}|${a.regra}`;
const todos = (chamadas) => chamadas.flatMap((x) => (x.r ?? x).achados);
const somaResumo = (chamadas, k) => chamadas.reduce((t, x) => t + (x.r ?? x).resumo[k], 0);
const somaClasse = (chamadas, k) => chamadas.reduce((t, x) => t + (x.r ?? x).resumo.por_classe[k], 0);
const auditoria = (c, dados) => prisma().auditLog.create({ data: { cliente_id: c, request_id: `req-${randomUUID().slice(0, 8)}`, ...dados } });
const definirEstoqueAtual = (s, produto, valor) =>
  prisma().produto.update({ where: { cliente_id_id: { cliente_id: s.c, id: produto.id } }, data: { estoque_atual: valor } });

/** Tenant com dados nos 6 produtos (compra + venda em cada), consistente. */
const tenantComSeisProdutos = async () => {
  const s = await montarTenant(app);
  const produtos = [s.e1.sal, s.e1.racao, s.e1.milho, s.e2.sal, s.e2.racao, s.e2.milho].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const p of produtos) {
    const e = p.empresa_id === s.e1.id ? s.e1 : s.e2;
    await A.criarConfirmar(s.token, docCom(e, s.local, [item(p, '10', '2.00')]));
    await A.criarConfirmar(s.token, docCom(e, s.local, [item(p, '3', '5.00')], { direcao: 'RECEBER' }));
  }
  return { s, produtos };
};
/** Tenant SEM nenhum Produto (só empresa e local), para os órfãos. */
const tenantSemProduto = async () => {
  const t = await criarTenant({ papelTenant: 'administrador' });
  const c = t.cliente.id;
  const e = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', nome: `Fazenda ${c}` } });
  const local = await prisma().localEstoque.create({ data: { cliente_id: c, numero_local: '1', nome: `DEPOSITO ${c}` } });
  return { c, e, local };
};
/** `n` lotes órfãos (produto_id inexistente) + 1 movimento de Entrada por lote. */
const orfaos = async (c, empresaId, localId, ids) => {
  for (const pid of ids) {
    const mov = await prisma().movimentacaoEstoque.create({
      data: {
        cliente_id: c, empresa_id: empresaId, produto_id: pid, unidade_medida: 'KG', data_movimentacao: new Date('2027-06-11T12:00:00.000Z'),
        numero_movimentacao: `ORF-${randomUUID().slice(0, 12)}`, tipo_movimentacao: 'Entrada', tipo_detalhado: 'compra_financeiro',
        origem_sistema: 'operacao_financeira', status: 'Ativa', quantidade: '5', local_estoque_destino: localId,
      },
    });
    await prisma().estoqueLoteNota.create({
      data: {
        cliente_id: c, empresa_id: empresaId, produto_id: pid, local_estoque_id: localId, custo_unitario: '1', quantidade_entrada: '5',
        quantidade_disponivel: '5', status: 'Disponivel', movimentacao_entrada_id: mov.id,
      },
    });
  }
};
/** Linhas que a chamada PROCESSOU (lotes + movimentos varridos) nunca passam do que ela CONTOU no orçamento. */
const contabilidadeFecha = (r, rotulo) =>
  assert.ok(r.cobertura.linhas_previstas >= r.resumo.lotes + r.resumo.movimentos,
    `${rotulo}: linhas_previstas ${r.cobertura.linhas_previstas} < lotes ${r.resumo.lotes} + movimentos ${r.resumo.movimentos} (linhas fora do orçamento)`);

// ─────────────────────────────────────────────────────────────────────────────
describe('RX — exclusões legadas de lote: dimensão própria, orçamento contado, nunca omitidas', () => {
  test('RX1: 1.200 linhas de AuditLog de lote + 3 exclusões (uma de produto inexistente): cada chamada lê do AuditLog só o orçamento; cada exclusão aparece UMA vez, inclusive a sem produto', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2.00')]));
    // ruído histórico (renomeações de lotes que já não existem) espalhado pela faixa do índice
    await prisma().auditLog.createMany({
      data: Array.from({ length: 1200 }, (_, k) => ({
        cliente_id: s.c, acao: 'update', entidade: 'EstoqueLoteNota', entidade_id: `n${String(k).padStart(5, '0')}-lote-antigo`, request_id: 'req-ruido',
        dados_anteriores: { local_estoque_nome: 'A' }, dados_novos: { local_estoque_nome: 'B' },
      })),
    });
    const del = async (entidadeId, produtoId, localId) => auditoria(s.c, {
      acao: 'delete', entidade: 'EstoqueLoteNota', entidade_id: entidadeId,
      dados_anteriores: { id: entidadeId, empresa_id: e.id, produto_id: produtoId, local_estoque_id: localId, quantidade_disponivel: '0' },
    });
    await del('a0000-lote-excluido', e.sal.id, s.local.id); // antes de todo o ruído
    await del('n00600-lote-excluido', `produto-que-nao-existe-${randomUUID().slice(0, 6)}`, s.local.id); // no meio
    await del('z9999-lote-excluido', e.milho.id, s.local2.id); // depois de todo o ruído

    const orc = { linhasPorPagina: 100, linhasPorChamada: 250 };
    const chamadas = await medirTudo(s.c, {}, orc);
    assert.ok(chamadas.length >= 4, `paginada: ${chamadas.length} chamadas`);
    for (const [k, m] of chamadas.entries()) {
      const lidas = m.lidasDe('AuditLog');
      assert.ok(lidas <= orc.linhasPorChamada + orc.linhasPorPagina + 10, `chamada ${k + 1}: ${lidas} linhas de AuditLog lidas (orçamento ${orc.linhasPorChamada})`);
      assert.ok(m.r.cobertura.linhas_previstas <= orc.linhasPorChamada + orc.linhasPorPagina + 10, `chamada ${k + 1}: ${m.r.cobertura.linhas_previstas}`);
    }
    const lidasNaFase = chamadas.reduce((t, m) => t + m.r.cobertura.exclusoes_lidas, 0);
    const historico = await prisma().auditLog.count({ where: { cliente_id: s.c, entidade: 'EstoqueLoteNota' } });
    assert.ok(historico >= 1203, String(historico));
    assert.equal(lidasNaFase, historico, 'a fase de exclusões leu cada linha de AuditLog de lote exatamente uma vez na varredura');
    const exclusoes = todos(chamadas).filter((a) => a.nivel === 'lote' && /-lote-excluido$/.test(a.chave.lote_id));
    assert.deepEqual(exclusoes.map((a) => [a.chave.lote_id, a.classe, a.regra]).sort(), [
      ['a0000-lote-excluido', 'LIMITACAO_LEGADA', 'lote_excluido_fora_do_motor'],
      ['n00600-lote-excluido', 'DADOS_INSUFICIENTES', 'lote_excluido_produto_inexistente'],
      ['z9999-lote-excluido', 'LIMITACAO_LEGADA', 'lote_excluido_fora_do_motor'],
    ]);
    const final = chamadas.at(-1).r;
    assert.equal(final.cobertura.cumulativa.exclusoes_legadas, 3);
    assert.notEqual(final.resumo.situacao, 'CONSISTENTE');
    // numa chamada só (orçamento padrão) o resultado é o mesmo, com conclusão comprovada
    const uma = await servico(s.c);
    assert.equal(uma.cobertura.conclusao_global, 'COMPROVADA', JSON.stringify(uma.cobertura));
    assert.deepEqual(uma.achados.map(chaveDe).sort(), todos(chamadas).map(chaveDe).sort());
    assert.equal(uma.resumo.situacao, 'COM_ACHADOS');
  });

  test('RX2: a evidência de exclusão que rebaixa produto é buscada com teto físico; acima do teto → evidência parcial declarada (nunca CONSISTENTE nem rebaixamento sem prova)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2.00')]));
    await definirEstoqueAtual(s, e.sal, '130'); // o cache ficou com os 30 kg do lote apagado pelo DELETE legado
    await prisma().auditLog.createMany({
      data: Array.from({ length: 20 }, (_, k) => ({
        cliente_id: s.c, acao: 'update', entidade: 'EstoqueLoteNota', entidade_id: `a${String(k).padStart(3, '0')}-ruido`, request_id: 'req-ruido', dados_novos: { local_estoque_nome: 'X' },
      })),
    });
    await auditoria(s.c, {
      acao: 'delete', entidade: 'EstoqueLoteNota', entidade_id: 'zz-lote-apagado',
      dados_anteriores: { id: 'zz-lote-apagado', empresa_id: e.id, produto_id: e.sal.id, local_estoque_id: s.local.id, quantidade_disponivel: '30' },
    });
    // (a) uma chamada: a exclusão rebaixa o produto (LIMITACAO_LEGADA) e aparece como achado próprio
    const uma = await servico(s.c, { empresaId: e.id });
    assert.deepEqual(achadosDe(uma, 'produto', 'produto_id', e.sal.id).map((a) => [a.classe, a.regra]), [['LIMITACAO_LEGADA', 'cache_diverge_legado']], JSON.stringify(uma.achados));
    assert.deepEqual(achadosDe(uma, 'lote', 'lote_id', 'zz-lote-apagado').map((a) => [a.classe, a.regra]), [['LIMITACAO_LEGADA', 'lote_excluido_fora_do_motor']]);
    assert.equal(uma.cobertura.evidencia_exclusoes, 'completa');
    // (b) a página do produto numa chamada que para ANTES da fase de exclusões: busca limitada, mesmo rebaixamento
    const parada = await servico(s.c, { empresaId: e.id }, { produtosPorPagina: 1, linhasPorChamada: 1 });
    assert.equal(parada.cobertura.fim_do_escopo, false);
    const prod = achadosDe(parada, 'produto', 'produto_id', e.sal.id);
    if (prod.length) {
      assert.deepEqual([prod[0].classe, prod[0].regra], ['LIMITACAO_LEGADA', 'cache_diverge_legado']);
      assert.equal(parada.cobertura.evidencia_exclusoes, 'completa');
      assert.ok(parada.cobertura.auditoria_lida >= 21, JSON.stringify(parada.cobertura));
    }
    const varredura = await varrer(s.c, { empresaId: e.id }, { produtosPorPagina: 1, linhasPorChamada: 1 });
    assert.deepEqual(todos(varredura).filter((a) => a.nivel === 'produto' && a.chave.produto_id === e.sal.id).map((a) => [a.classe, a.regra]), [['LIMITACAO_LEGADA', 'cache_diverge_legado']]);
    // (c) teto da busca menor que o histórico: a evidência fica PARCIAL e isso é declarado
    const curta = await varrer(s.c, { empresaId: e.id }, { produtosPorPagina: 1, linhasPorChamada: 1, auditoriaPorChamada: 5 });
    const comSal = curta.find((r) => achadosDe(r, 'produto', 'produto_id', e.sal.id).length);
    assert.ok(comSal, 'o produto divergente continua aparecendo');
    assert.deepEqual(achadosDe(comSal, 'produto', 'produto_id', e.sal.id).map((a) => a.classe), ['DIVERGENCIA_REAL'], 'sem a prova da exclusão, nada é rebaixado');
    assert.equal(comSal.cobertura.evidencia_exclusoes, 'parcial');
    assert.ok(comSal.cobertura.motivos_inconclusiva.includes('evidencia_de_exclusao_parcial'), JSON.stringify(comSal.cobertura));
    assert.equal(comSal.resumo.situacao, 'INCOMPLETO');
    assert.equal(comSal.resumo.por_classe.OK, null);
    const fim = curta.at(-1);
    assert.ok(fim.cobertura.cumulativa.chamadas_com_evidencia_parcial >= 1);
    assert.notEqual(fim.resumo.situacao, 'CONSISTENTE');
    assert.equal(fim.cobertura.conclusao_global, 'INCONCLUSIVA');
  });

  test('RX3: chamada filtrada por produto que para antes da fase de exclusões lê do AuditLog só o histórico dos lotes DAQUELE produto (nunca o do tenant)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2.00'), item(e.milho, '50', '3.00')]));
    const loteMilho = compra.itens[1].estoque_lote_nota_id;
    await prisma().auditLog.createMany({
      data: Array.from({ length: 1500 }, () => ({
        cliente_id: s.c, acao: 'update', entidade: 'EstoqueLoteNota', entidade_id: loteMilho, request_id: 'req-renome',
        dados_anteriores: { local_estoque_nome: 'A' }, dados_novos: { local_estoque_nome: 'B' },
      })),
    });
    const m = await medir(s.c, { produtoId: e.sal.id }, { linhasPorChamada: 1 });
    assert.ok(m.lidasDe('AuditLog') <= 20, `AuditLog lido: ${m.lidasDe('AuditLog')} (os 1.500 são de outro produto)`);
    assert.equal(m.r.cobertura.exclusoes_lidas, 0);
    assert.equal(m.r.cobertura.fim_do_escopo, false, 'a fase de exclusões fica para a próxima chamada (orçamento)');
    assert.equal(m.r.resumo.situacao, 'INCOMPLETO');
  });
});

describe('RO — órfãos e produto pesado: nenhuma linha fora do orçamento, nunca OK sobre o que não foi varrido', () => {
  test('RO1: tenant com ZERO produtos e 40 chaves órfãs: paginado pelo orçamento (nunca uma página aberta sem conta), cada órfão uma vez, nunca CONSISTENTE', async () => {
    const t = await tenantSemProduto();
    const ids = Array.from({ length: 40 }, (_, k) => `orfao-${String(k).padStart(3, '0')}`);
    await orfaos(t.c, t.e.id, t.local.id, ids);
    const orc = { produtosPorPagina: 5, linhasPorChamada: 20 };
    const primeira = await servico(t.c, {}, orc);
    contabilidadeFecha(primeira, 'primeira chamada');
    assert.equal(primeira.cobertura.fim_do_escopo, false, JSON.stringify(primeira.cobertura));
    assert.equal(typeof primeira.cobertura.proximo_cursor, 'string');
    assert.equal(primeira.resumo.situacao, 'INCOMPLETO');
    assert.equal(primeira.resumo.por_classe.OK, null);
    assert.ok(primeira.resumo.lotes < 40, `a primeira chamada não engole os 40 órfãos: ${primeira.resumo.lotes}`);
    const chamadas = await varrer(t.c, {}, orc);
    for (const [k, r] of chamadas.entries()) {
      contabilidadeFecha(r, `chamada ${k + 1}`);
      assert.notEqual(r.resumo.situacao, 'CONSISTENTE');
    }
    assert.equal(somaResumo(chamadas, 'lotes'), 40);
    assert.equal(somaResumo(chamadas, 'movimentos'), 40);
    const porLote = todos(chamadas).filter((a) => a.nivel === 'lote');
    assert.equal(porLote.length, 40);
    assert.equal(new Set(porLote.map((a) => a.chave.lote_id)).size, 40, 'cada órfão exatamente uma vez');
    assert.ok(porLote.every((a) => a.classe === 'DADOS_INSUFICIENTES' && a.regra === 'produto_inexistente'));
    assert.equal(somaClasse(chamadas, 'DADOS_INSUFICIENTES'), 40 * 3, 'lote, movimento e local de cada órfão');
    const fim = chamadas.at(-1);
    assert.equal(fim.cobertura.cumulativa.chaves_orfas_varridas, 40);
    assert.equal(fim.cobertura.cumulativa.lotes, 40);
    // uma chamada só, orçamento padrão: escopo inteiro num snapshot → conclusão comprovada (com achados)
    const uma = await servico(t.c);
    assert.equal(uma.cobertura.conclusao_global, 'COMPROVADA');
    assert.equal(uma.resumo.situacao, 'COM_ACHADOS');
    assert.equal(uma.resumo.por_classe.DADOS_INSUFICIENTES, 120);
  });

  test('RO2: órfãos ANTES do primeiro, ENTRE dois e DEPOIS do último id de Produto: cada um numa chave própria, a página terminal também é contada; soma = chamada única', async () => {
    const { s, produtos } = await tenantComSeisProdutos();
    const antes = '0000-orfao-antes';
    const entre = `${produtos[2].id}0`;
    const depois = Array.from({ length: 10 }, (_, k) => `zzzz-orfao-depois-${k}`);
    await orfaos(s.c, s.e1.id, s.local.id, [antes, entre, ...depois]);
    const orc = { produtosPorPagina: 1, linhasPorPagina: 1, linhasPorChamada: 1 };
    const chamadas = await varrer(s.c, {}, orc);
    for (const [k, r] of chamadas.entries()) contabilidadeFecha(r, `chamada ${k + 1}`);
    assert.ok(chamadas.length >= 6 + 12, `uma chave por chamada: ${chamadas.length}`);
    const lotesOrfaos = todos(chamadas).filter((a) => a.nivel === 'lote' && a.regra === 'produto_inexistente').map((a) => a.chave.produto_id).sort();
    assert.deepEqual(lotesOrfaos, [antes, entre, ...depois].sort());
    const uma = await servico(s.c);
    assert.equal(uma.cobertura.conclusao_global, 'COMPROVADA');
    assert.deepEqual(todos(chamadas).map(chaveDe).sort(), uma.achados.map(chaveDe).sort());
    for (const k of ['produtos', 'locais', 'lotes', 'movimentos']) assert.equal(somaResumo(chamadas, k), uma.resumo[k], k);
    assert.equal(uma.cobertura.chaves_orfas_varridas, 12);
  });

  test('RO3: produto pesado (1.500 lotes + 1.500 movimentos) consistente devolve ao Node só agregados (sem linha por lote); acima do teto de suspeitos → página truncada e declarada', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const tag = randomUUID().slice(0, 8);
    await prisma().$executeRaw`INSERT INTO "MovimentacaoEstoque" (id, cliente_id, empresa_id, numero_movimentacao, tipo_movimentacao, tipo_detalhado, data_movimentacao,
        produto_id, quantidade, unidade_medida, local_estoque_destino, origem_sistema, status, "updatedAt")
      SELECT 'r2m-' || ${tag} || '-' || k, ${s.c}, ${e.id}, 'R2-' || ${tag} || '-' || k, 'Entrada', 'compra_financeiro', now(), ${e.sal.id}, 10, 'KG', ${s.local.id},
             'operacao_financeira', 'Ativa', now()
      FROM generate_series(1, 1500) k`;
    await prisma().$executeRaw`INSERT INTO "EstoqueLoteNota" (id, cliente_id, empresa_id, produto_id, local_estoque_id, custo_unitario, quantidade_entrada,
        quantidade_disponivel, movimentacao_entrada_id, status, "updatedAt")
      SELECT 'r2l-' || ${tag} || '-' || k, ${s.c}, ${e.id}, ${e.sal.id}, ${s.local.id}, 2, 10, 10, 'r2m-' || ${tag} || '-' || k, 'Disponivel', now()
      FROM generate_series(1, 1500) k`;
    await definirEstoqueAtual(s, e.sal, '15000');
    const m = await medir(s.c, { produtoId: e.sal.id });
    assert.equal(m.r.resumo.situacao, 'CONSISTENTE', JSON.stringify(m.r.achados.slice(0, 3)));
    assert.deepEqual([m.r.resumo.lotes, m.r.resumo.movimentos], [1500, 1500]);
    assert.ok(m.linhasAoNode <= 20, `linhas devolvidas ao Node: ${m.linhasAoNode} (${m.consultas.map((q) => q.linhas).join(',')})`);

    // 30 lotes com UPDATE −1 e teto de 10 suspeitos por consulta: classifica 10, declara a página truncada
    await prisma().$executeRaw`UPDATE "EstoqueLoteNota" SET quantidade_disponivel = quantidade_disponivel - 1
      WHERE cliente_id = ${s.c} AND id IN (SELECT 'r2l-' || ${tag} || '-' || k FROM generate_series(1, 30) k)`;
    const trunc = await servico(s.c, { produtoId: e.sal.id }, { anomaliasPorConsulta: 10 });
    assert.equal(trunc.cobertura.paginas_truncadas, 1, JSON.stringify(trunc.cobertura));
    assert.ok(trunc.cobertura.motivos_inconclusiva.includes('paginas_truncadas'));
    assert.equal(trunc.resumo.situacao, 'INCOMPLETO');
    assert.equal(trunc.resumo.por_classe.OK, null);
    assert.equal(trunc.achados.filter((a) => a.nivel === 'lote').length, 10);
    const cheio = await servico(s.c, { produtoId: e.sal.id });
    assert.equal(cheio.achados.filter((a) => a.nivel === 'lote').length, 30);
    assert.equal(cheio.cobertura.conclusao_global, 'COMPROVADA');
  });
});

describe('RS — contrato: fim desta chamada × continuação × cobertura cumulativa × conclusão global', () => {
  const COBERTURA = ['auditoria_lida', 'chaves_orfas_varridas', 'chaves_varridas', 'completa', 'conclusao_global', 'conclusao_global_comprovada', 'cumulativa',
    'evidencia_exclusoes', 'exclusoes_lidas', 'fase', 'fim_do_escopo', 'interrompida_por', 'linhas_previstas', 'motivos_inconclusiva', 'nivel_produto', 'paginas',
    'paginas_truncadas', 'produtos_antes_do_cursor', 'produtos_no_escopo', 'produtos_restantes', 'produtos_varridos', 'proximo_cursor', 'snapshot_unico'];
  const CUMULATIVA = ['chamadas', 'chamadas_com_evidencia_parcial', 'chaves_orfas_varridas', 'chaves_varridas', 'exclusoes_legadas', 'iniciada_em', 'locais', 'lotes',
    'movimentos', 'paginas', 'paginas_truncadas', 'por_classe', 'produtos_varridos'];

  test('RS1: chamada única = COMPROVADA; várias chamadas = INCOMPLETO até o fim e INCONCLUSIVO no fim (OK=null), com a cobertura cumulativa somando exatamente a chamada única', async () => {
    const { s } = await tenantComSeisProdutos();
    const uma = await relatorio(s);
    assert.deepEqual(Object.keys(uma.cobertura).sort(), COBERTURA);
    assert.deepEqual(Object.keys(uma.cobertura.cumulativa).sort(), CUMULATIVA);
    assert.deepEqual(Object.keys(uma.resumo).sort(), ['exclusoes_legadas', 'locais', 'lotes', 'movimentos', 'por_classe', 'produtos', 'situacao']);
    assert.deepEqual(
      [uma.cobertura.completa, uma.cobertura.conclusao_global, uma.cobertura.conclusao_global_comprovada, uma.cobertura.fim_do_escopo, uma.cobertura.snapshot_unico,
        uma.cobertura.fase, uma.cobertura.proximo_cursor, uma.cobertura.motivos_inconclusiva, uma.resumo.situacao],
      [true, 'COMPROVADA', true, true, true, 'fim', null, [], 'CONSISTENTE']);
    assert.equal(typeof uma.resumo.por_classe.OK, 'number');
    assert.equal(uma.cobertura.cumulativa.chamadas, 1);
    assert.equal(uma.cobertura.cumulativa.iniciada_em, uma.gerado_em);

    const chamadas = await varrer(s.c, {}, { produtosPorPagina: 2, linhasPorChamada: 1 });
    assert.ok(chamadas.length >= 3);
    for (const r of chamadas.slice(0, -1)) {
      assert.deepEqual([r.cobertura.fim_do_escopo, r.cobertura.conclusao_global, r.resumo.situacao, r.resumo.por_classe.OK, r.cobertura.completa],
        [false, 'INCONCLUSIVA', 'INCOMPLETO', null, false]);
      assert.ok(r.cobertura.motivos_inconclusiva.includes('continua_no_cursor'));
      assert.equal(typeof r.cobertura.proximo_cursor, 'string');
    }
    const fim = chamadas.at(-1);
    assert.deepEqual(
      [fim.cobertura.fim_do_escopo, fim.cobertura.proximo_cursor, fim.cobertura.snapshot_unico, fim.cobertura.conclusao_global, fim.cobertura.conclusao_global_comprovada,
        fim.cobertura.completa, fim.cobertura.motivos_inconclusiva, fim.resumo.situacao, fim.resumo.por_classe.OK],
      [true, null, false, 'INCONCLUSIVA', false, false, ['varios_snapshots'], 'INCONCLUSIVO', null]);
    const cum = fim.cobertura.cumulativa;
    assert.equal(cum.chamadas, chamadas.length);
    for (const k of ['locais', 'lotes', 'movimentos']) assert.equal(cum[k], uma.resumo[k], k);
    assert.equal(cum.produtos_varridos, uma.resumo.produtos);
    assert.equal(cum.paginas, chamadas.reduce((t, r) => t + r.cobertura.paginas, 0));
    assert.deepEqual(cum.por_classe, { DIVERGENCIA_REAL: 0, LIMITACAO_LEGADA: 0, DADOS_INSUFICIENTES: 0 });
    assert.equal(cum.iniciada_em, chamadas[0].gerado_em);
  });

  test('RS2: lote alterado ENTRE duas chamadas (página já varrida) → o fim da varredura é INCONCLUSIVO, nunca CONSISTENTE; a chamada única seguinte vê a divergência', async () => {
    const { s, produtos } = await tenantComSeisProdutos();
    const orc = { produtosPorPagina: 1, linhasPorChamada: 1 };
    const c1 = await servico(s.c, {}, orc);
    assert.equal(c1.cobertura.produtos_varridos, 1);
    await prisma().$executeRaw`UPDATE "EstoqueLoteNota" SET quantidade_disponivel = quantidade_disponivel - 1 WHERE cliente_id = ${s.c} AND produto_id = ${produtos[0].id} AND status = 'Disponivel'`;
    const resto = await varrer(s.c, { cursor: c1.cobertura.proximo_cursor }, orc);
    const fim = resto.at(-1);
    assert.equal(fim.resumo.situacao, 'INCONCLUSIVO');
    assert.equal(fim.cobertura.cumulativa.por_classe.DIVERGENCIA_REAL, 0, 'a página 1 foi lida ANTES da mudança: a varredura em vários snapshots não a vê');
    const depois = await servico(s.c);
    assert.equal(depois.resumo.situacao, 'COM_ACHADOS');
    assert.ok(depois.resumo.por_classe.DIVERGENCIA_REAL >= 1);
  });
});

describe('RK — cursor autenticado (HMAC) e amarrado ao tenant e ao escopo; qualquer desvio é o MESMO 400', () => {
  const SEGREDO = process.env.AUTH_SECRET ?? 'ci-only-ephemeral-signing-key';
  const chave = (segredo) => Buffer.from(hkdfSync('sha256', Buffer.from(segredo, 'utf8'), Buffer.from('maike-estoque-fisico', 'utf8'), 'maike-estoque-reconciliacao-cursor:v2', 32));
  const amarra = (cli, f, limite) => JSON.stringify(['estoque-reconciliacao', 2, cli, f.empresaId ?? null, f.produtoId ?? null, f.localId ?? null, limite]);
  const assinar = (segredo, cli, f, limite, estado) => {
    const corpo = Buffer.from(JSON.stringify(estado), 'utf8');
    const mac = createHmac('sha256', chave(segredo)).update(amarra(cli, f, limite)).update('\n').update(corpo).digest();
    return Buffer.concat([corpo, mac]).toString('base64url');
  };
  const abrir = (cursor) => {
    const b = Buffer.from(cursor, 'base64url');
    return { estado: JSON.parse(b.subarray(0, b.length - 32).toString('utf8')), mac: b.subarray(b.length - 32) };
  };
  const fechar = (estado, mac) => Buffer.concat([Buffer.from(JSON.stringify(estado), 'utf8'), mac]).toString('base64url');
  const semRequestId = (r) => { const j = r.json(); delete j.requestId; delete j.request_id; return JSON.stringify(j); };

  test('RK1: cursor de OUTRO tenant, outro limite/empresa/produto/local, adulterado, adiantado, fora da faixa, versão inválida, sem assinatura, chave errada, vencido ou do futuro → o mesmo 400; o legítimo continua', async () => {
    const { s, produtos } = await tenantComSeisProdutos();
    const b = await tenantComSeisProdutos();
    const orc = { produtosPorPagina: 1, linhasPorChamada: 1 };
    const cursorA = (await servico(s.c, {}, orc)).cobertura.proximo_cursor;
    const cursorB = (await servico(b.s.c, {}, orc)).cobertura.proximo_cursor;
    assert.equal(typeof cursorA, 'string');
    const corpos = new Set();
    const recusado = async (rotulo, q) => {
      const r = await reconciliar(s.token, q);
      assert.deepEqual([r.statusCode, codigo(r)], [400, 'REQUEST_VALIDATION_FAILED'], `${rotulo}: ${r.body}`);
      assert.deepEqual([r.json().field, r.json().reason, r.json().details], ['cursor', 'cursor_invalido', undefined], rotulo);
      corpos.add(semRequestId(r));
    };
    // casos que independem da forma interna do cursor
    for (const [rotulo, q] of [
      ['cursor de outro tenant (mesma forma de escopo)', { cursor: cursorB }],
      ['outro limite', { cursor: cursorA, limite: 7 }],
      ['outra empresa', { cursor: cursorA, empresa_id: s.e1.id }],
      ['outro produto', { cursor: cursorA, produto_id: produtos[1].id }],
      ['outro local', { cursor: cursorA, local_estoque_id: s.local.id }],
      ['assinatura truncada', { cursor: cursorA.slice(0, -4) }],
      ['lixo base64url', { cursor: 'AAAA' }],
    ]) await recusado(rotulo, q);
    const { estado, mac } = abrir(cursorA);
    assert.equal(estado.a, produtos[0].id, 'o cursor carrega a posição (não é segredo; a assinatura impede mexer nela)');
    const casos = [
      ['adiantado (posição mexida)', { cursor: fechar({ ...estado, a: produtos[4].id }, mac) }],
      ['fora da faixa', { cursor: fechar({ ...estado, a: 'zzzzzzzzzzzz' }, mac) }],
      ['contadores mexidos', { cursor: fechar({ ...estado, c: estado.c + 5 }, mac) }],
      ['versão inválida', { cursor: fechar({ ...estado, v: 1 }, mac) }],
      ['campo apagado', { cursor: fechar(Object.fromEntries(Object.entries(estado).filter(([k]) => k !== 'n')), mac) }],
      ['sem a assinatura', { cursor: Buffer.from(JSON.stringify(estado), 'utf8').toString('base64url') }],
      ['chave errada', { cursor: assinar('outro-segredo-qualquer', s.c, {}, 500, estado) }],
      ['vencido (25 h)', { cursor: assinar(SEGREDO, s.c, {}, 500, { ...estado, t: AGORA - 25 * 3600 * 1000, t0: AGORA - 25 * 3600 * 1000 }) }],
      ['do futuro (1 h)', { cursor: assinar(SEGREDO, s.c, {}, 500, { ...estado, t: AGORA + 3600 * 1000 }) }],
      ['assinado para o tenant B', { cursor: assinar(SEGREDO, b.s.c, {}, 500, estado) }],
    ];
    for (const [rotulo, q] of casos) await recusado(rotulo, q);
    assert.equal(corpos.size, 1, `todas as recusas têm o MESMO corpo (sem oráculo): ${[...corpos].join(' || ')}`);
    // o legítimo continua de onde parou, só no tenant de A
    const ok = await relatorio(s, { cursor: cursorA });
    assert.equal(ok.cobertura.produtos_antes_do_cursor, 1);
    const corpo = JSON.stringify(ok);
    for (const idDeB of [b.s.c, b.s.e1.id, b.s.e1.sal.id, b.s.local.id]) assert.ok(!corpo.includes(idDeB), `id de B (${idDeB}) não aparece`);
    // assinado com a chave do servidor (só ele tem): a posição é aceita — a autenticidade vem da chave, não da forma
    const assinado = assinar(SEGREDO, s.c, {}, 500, { ...estado, a: produtos[2].id });
    assert.equal((await relatorio(s, { cursor: assinado })).cobertura.produtos_antes_do_cursor, 3);
  });

  test('RK2: produto-âncora do cursor apagado entre as chamadas → a continuação segue (keyset por id), nada é pulado e não há oráculo', async () => {
    const s = await montarTenant(app);
    const produtos = [s.e1.sal, s.e1.racao, s.e1.milho, s.e2.sal, s.e2.racao, s.e2.milho].sort((a, b) => (a.id < b.id ? -1 : 1));
    // compra só nos produtos de índice par: os ímpares ficam sem histórico (podem ser apagados)
    for (const [k, p] of produtos.entries()) {
      if (k % 2 === 0) await A.criarConfirmar(s.token, docCom(p.empresa_id === s.e1.id ? s.e1 : s.e2, s.local, [item(p, '10', '2.00')]));
    }
    const orc = { produtosPorPagina: 2, linhasPorChamada: 1 };
    const c1 = await servico(s.c, {}, orc); // varre produtos[0..1]; âncora = produtos[1] (sem histórico)
    await prisma().produto.delete({ where: { cliente_id_id: { cliente_id: s.c, id: produtos[1].id } } });
    const resto = await varrer(s.c, { cursor: c1.cobertura.proximo_cursor }, orc);
    const total = [c1, ...resto];
    assert.equal(somaResumo(total, 'produtos'), 6, 'os 2 da 1ª chamada + os 4 restantes; nenhum pulado');
    assert.equal(resto[0].cobertura.produtos_antes_do_cursor, 1, 'o apagado não conta mais (não é oráculo: só o escopo atual)');
  });
});

describe('RV — linhagem da transferência, AuditLog benigno e filtro de local nunca mascaram divergência física', () => {
  test('RV1: transferência pelo comando sem achado; lote_destino_id adulterado (inexistente, apontando a outro lote, ou camada de destino com custo ou quantidade diferentes) → DIVERGENCIA_REAL linhagem_transferencia_diverge', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2.00')]));
    const t = await A.ok(A.req('POST', URL_TRANSF, s.token, { operation_id: opId(), empresa_id: e.id, produto_id: e.sal.id, local_origem_id: s.local.id, local_destino_id: s.local2.id, quantidade: 20 }), 201);
    const saidaId = t.movimentacao_saida.id;
    assert.deepEqual((await relatorio(s, { empresa_id: e.id })).achados, [], 'transferência do motor: linhagem coerente');
    const saida = await prisma().movimentacaoEstoque.findUnique({ where: { cliente_id_id: { cliente_id: s.c, id: saidaId } } });
    const fatias = /** @type {any[]} */ (saida.lotes_consumidos);
    const destino = fatias[0].lote_destino_id;
    const origem = fatias[0].lote_id;
    const comFatia = (extra) => prisma().movimentacaoEstoque.update({ where: { cliente_id_id: { cliente_id: s.c, id: saidaId } }, data: { lotes_consumidos: [{ ...fatias[0], ...extra }] } });
    const linhagem = async (rotulo) => {
      const rel = await relatorio(s, { empresa_id: e.id });
      const mov = achadosDe(rel, 'movimento', 'movimento_id', saidaId);
      assert.deepEqual(mov.map((a) => [a.classe, a.regra]), [['DIVERGENCIA_REAL', 'linhagem_transferencia_diverge']], `${rotulo}: ${JSON.stringify(rel.achados)}`);
    };
    await comFatia({ lote_destino_id: 'lote-que-nao-existe' });
    await linhagem('destino inexistente');
    await comFatia({ lote_destino_id: origem });
    await linhagem('destino aponta ao lote de ORIGEM');
    await comFatia({ lote_destino_id: undefined });
    await linhagem('fatia sem lote_destino_id');
    await comFatia({});
    await prisma().estoqueLoteNota.update({ where: { cliente_id_id: { cliente_id: s.c, id: destino } }, data: { custo_unitario: '9.9999' } });
    await linhagem('camada de destino com custo diferente da fatia');
    await prisma().estoqueLoteNota.update({ where: { cliente_id_id: { cliente_id: s.c, id: destino } }, data: { custo_unitario: fatias[0].custo_unitario } });
    assert.deepEqual((await relatorio(s, { empresa_id: e.id })).achados, [], 'restaurada: coerente de novo');
  });

  test('RV2: UPDATE −1 no lote + AuditLog benigno (procedência pelo financeiro, renomeação, custo de cadastro do produto) + AuditLog de OUTRO tenant com o id do lote → DIVERGENCIA_REAL em lote, local e produto', async () => {
    const s = await montarTenant(app);
    const b = await montarTenant(app);
    const e = s.e1;
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2.00')]));
    const L = compra.itens[0].estoque_lote_nota_id;
    await prisma().$executeRaw`UPDATE "EstoqueLoteNota" SET quantidade_disponivel = quantidade_disponivel - 1 WHERE cliente_id = ${s.c} AND id = ${L}`;
    const base = { id: L, empresa_id: e.id, produto_id: e.sal.id, local_estoque_id: s.local.id, quantidade_entrada: '100', quantidade_disponivel: '100', status: 'Disponivel' };
    await auditoria(s.c, { acao: 'operacao_financeira.retificar_procedencia', entidade: 'EstoqueLoteNota', entidade_id: L,
      dados_anteriores: { ...base, fornecedor_nome: 'A', numero_documento: '1', data_documento: '2027-06-01' }, dados_novos: { ...base, fornecedor_nome: 'B', numero_documento: '2', data_documento: '2027-06-02' } });
    await auditoria(s.c, { acao: 'update', entidade: 'EstoqueLoteNota', entidade_id: L, dados_anteriores: { ...base, local_estoque_nome: 'X' }, dados_novos: { ...base, local_estoque_nome: s.local.nome } });
    await auditoria(s.c, { acao: 'update', entidade: 'Produto', entidade_id: e.sal.id, dados_anteriores: { id: e.sal.id, preco_custo: '2', estoque_atual: '100' }, dados_novos: { id: e.sal.id, preco_custo: '9', estoque_atual: '100.0000' } });
    // evidência "forte" gravada no OUTRO tenant com os ids de A: nunca entra
    await auditoria(b.c, { acao: 'update', entidade: 'EstoqueLoteNota', entidade_id: L, dados_anteriores: { ...base }, dados_novos: { ...base, quantidade_disponivel: '99' } });
    await auditoria(b.c, { acao: 'update', entidade: 'Produto', entidade_id: e.sal.id, dados_anteriores: { estoque_atual: '100' }, dados_novos: { estoque_atual: '99' } });
    await auditoria(b.c, { acao: 'delete', entidade: 'EstoqueLoteNota', entidade_id: 'lote-de-b', dados_anteriores: { produto_id: e.sal.id, empresa_id: e.id, local_estoque_id: s.local.id } });
    const rel = await relatorio(s, { empresa_id: e.id });
    assert.deepEqual(achadosDe(rel, 'lote', 'lote_id', L).map((a) => [a.classe, a.regra]), [['DIVERGENCIA_REAL', 'consumo_nao_explicado']], JSON.stringify(rel.achados));
    assert.deepEqual(achadosDe(rel, 'produto', 'produto_id', e.sal.id).map((a) => [a.classe, a.regra]), [['DIVERGENCIA_REAL', 'cache_diverge']]);
    assert.deepEqual(achadosDe(rel, 'local', 'produto_id', e.sal.id).map((a) => [a.classe, a.regra]), [['DIVERGENCIA_REAL', 'razao_diverge']]);
    assert.equal(achadosDe(rel, 'lote', 'lote_id', 'lote-de-b').length, 0, 'exclusão de outro tenant não aparece');
  });

  test('RV3: filtro de local nunca esconde o cache global; a exclusão legada de OUTRO local rebaixa o produto (todos os locais) e o achado da exclusão só aparece no filtro do local dela', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2.00')]));
    await definirEstoqueAtual(s, e.sal, '110');
    await auditoria(s.c, { acao: 'delete', entidade: 'EstoqueLoteNota', entidade_id: 'lote-apagado-local2',
      dados_anteriores: { id: 'lote-apagado-local2', empresa_id: e.id, produto_id: e.sal.id, local_estoque_id: s.local2.id, quantidade_disponivel: '10' } });
    const l1 = await relatorio(s, { empresa_id: e.id, local_estoque_id: s.local.id });
    assert.deepEqual(achadosDe(l1, 'produto', 'produto_id', e.sal.id).map((a) => [a.classe, a.regra]), [['LIMITACAO_LEGADA', 'cache_diverge_legado']], JSON.stringify(l1.achados));
    assert.equal(achadosDe(l1, 'lote', 'lote_id', 'lote-apagado-local2').length, 0);
    const l2 = await relatorio(s, { empresa_id: e.id, local_estoque_id: s.local2.id });
    assert.deepEqual(achadosDe(l2, 'lote', 'lote_id', 'lote-apagado-local2').map((a) => [a.classe, a.regra]), [['LIMITACAO_LEGADA', 'lote_excluido_fora_do_motor']]);
    assert.deepEqual(achadosDe(l2, 'produto', 'produto_id', e.sal.id).map((a) => a.classe), ['LIMITACAO_LEGADA']);
  });
});

describe('RI — isolamento e somente leitura medidos no PostgreSQL', () => {
  test('RI1: linhas do tenant B que apontam para ids de A (produto, lote, movimento, AuditLog, recibo) não mudam NADA no relatório de A', async () => {
    const s = await montarTenant(app);
    const b = await montarTenant(app);
    const e = s.e1;
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2.00')]));
    const L = compra.itens[0].estoque_lote_nota_id;
    const t = await A.ok(A.req('POST', URL_TRANSF, s.token, { operation_id: opId(), empresa_id: e.id, produto_id: e.sal.id, local_origem_id: s.local.id, local_destino_id: s.local2.id, quantidade: 20 }), 201);
    const antes = await relatorio(s);
    await prisma().estoqueLoteNota.create({ data: { cliente_id: b.c, empresa_id: e.id, produto_id: e.sal.id, local_estoque_id: s.local.id, custo_unitario: '1', quantidade_entrada: '7', quantidade_disponivel: '7', status: 'Disponivel' } });
    await prisma().movimentacaoEstoque.create({ data: { cliente_id: b.c, empresa_id: e.id, produto_id: e.sal.id, unidade_medida: 'KG', data_movimentacao: new Date(), numero_movimentacao: `B-${randomUUID().slice(0, 8)}`,
      tipo_movimentacao: 'Saída', tipo_detalhado: 'suplementacao', origem_sistema: 'suplementacao', status: 'Ativa', quantidade: '3', local_estoque_origem: s.local.id,
      lotes_consumidos: [{ lote_id: L, quantidade: '3.0000', custo_unitario: '2.0000' }] } });
    await prisma().operacaoIdempotente.create({ data: { cliente_id: b.c, operation_key: opId(), tipo_operacao: 'transferencia_locais', fingerprint: 'x', status: 'committed', http_status: 201,
      response_json: { movimentacao_saida: { id: t.movimentacao_saida.id }, rateio: [{ lote_id: L, quantidade_consumida: 50 }] } } });
    await auditoria(b.c, { acao: 'update', entidade: 'EstoqueLoteNota', entidade_id: L, dados_anteriores: { quantidade_disponivel: '80' }, dados_novos: { quantidade_disponivel: '1' } });
    await auditoria(b.c, { acao: 'create', entidade: 'Produto', entidade_id: e.sal.id, dados_novos: { estoque_atual: '999' } });
    const depois = await relatorio(s);
    assert.deepEqual({ ...depois, gerado_em: null, cobertura: { ...depois.cobertura, cumulativa: { ...depois.cobertura.cumulativa, iniciada_em: null } } },
      { ...antes, gerado_em: null, cobertura: { ...antes.cobertura, cumulativa: { ...antes.cobertura.cumulativa, iniciada_em: null } } });
  });

  test('RI2: toda consulta da leitura filtra cada tabela por cliente_id = tenant do auth_context; a transação é READ ONLY e o PostgreSQL registra ZERO linhas inseridas/alteradas/apagadas', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2.00')]));
    await definirEstoqueAtual(s, e.sal, '130');
    await auditoria(s.c, { acao: 'delete', entidade: 'EstoqueLoteNota', entidade_id: 'lote-apagado-ri2', dados_anteriores: { produto_id: e.sal.id, empresa_id: e.id, local_estoque_id: s.local.id } });
    for (const [filtro, orc] of [[{}, undefined], [{ empresaId: e.id }, { produtosPorPagina: 1, linhasPorChamada: 1 }], [{ localId: s.local.id }, undefined]]) {
      const m = await medir(s.c, filtro, orc, { semSeqscan: false });
      assert.deepEqual(m.sessao, { ro: 'on', iso: 'repeatable read' });
      for (const t of m.stats) assert.deepEqual([t.tabela, t.n_tup_ins, t.n_tup_upd, t.n_tup_del], [t.tabela, 0, 0, 0], 'zero escrita');
      for (const q of m.consultas) {
        if (/^\s*(SET TRANSACTION|SELECT set_config)/.test(q.text)) continue;
        if (q.prop === 'modelo') {
          assert.ok(String(q.values[0]).includes(`"cliente_id":"${s.c}"`), `${q.text} filtra pelo tenant: ${q.values[0]}`);
          continue;
        }
        assert.ok(q.values.includes(s.c), `o tenant entra como parâmetro: ${q.text.slice(0, 80)}`);
        for (const [, tabela, apelido] of q.text.matchAll(/(?:FROM|JOIN)\s+"(\w+)"\s+(?:AS\s+)?(\w+)/g)) {
          assert.ok(new RegExp(`\\b${apelido}\\.cliente_id\\s*=`).test(q.text), `"${tabela}" ${apelido} sem cliente_id: ${q.text.slice(0, 120)}`);
        }
      }
    }
  });
});
