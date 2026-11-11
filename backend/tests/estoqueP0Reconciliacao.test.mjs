/**
 * D-PROD-161 — MAIKE-ESTOQUE-P0-01, fatia F4: reconciliação SOMENTE LEITURA do
 * estoque físico (SPEC §5, §2 W25/W31, §7.2 item 11). PostgreSQL real, HTTP
 * autenticado; a prova de "sem auto-reparo" é a fotografia do tenant e a
 * contagem de AuditLog, iguais antes e depois.
 *
 * GET /estoque-fisico/reconciliacao (só o administrador real) classifica cada
 * produto, (empresa, produto, local), lote e movimento:
 *  OK                  nenhuma regra disparou (só no resumo);
 *  DADOS_INSUFICIENTES não há como atribuir a diferença (órfão, local ou
 *                      situação desconhecidos, cache sem nenhum lote nem
 *                      evidência, consumo legado sem recibo);
 *  LIMITACAO_LEGADA    a diferença tem um escritor fora do protocolo com
 *                      evidência (AuditLog, lote sem movimento de entrada,
 *                      origem manual, data 2001 da transferência antiga,
 *                      resíduo de Number do caminho legado);
 *  DIVERGENCIA_REAL    o invariante (I1–I5) quebra e tudo é do protocolo.
 *
 * As fixtures dos dois formatos de prova do consumo de suplementação e
 * transferência são emuladas por prisma — o recibo legado (só
 * `response_json.rateio`) e o `lotes_consumidos` do caminho novo —, então os
 * testes não dependem da fatia F1 para esses dois formatos.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, codigo, docCom, foto, loteLegado, montarTenant, opId, prisma } from './gestaoP3Cenario.mjs';
import { montarAbastecimento, corpoAbastecimento, acoesAbastecimento } from './patrimonioP1AbastecimentoCenario.mjs';
import { travarProdutosEstoque } from '../src/modules/estoqueFisico/estoqueFisicoMotor.js';
import { ESCOPO_TENANT, reservarNumeros } from '../src/modules/sequencias/entidadeCodigoService.js';
import { DEMO, seedDemoTenant } from '../../scripts/ops/seed-demo-tenant.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoes>} */
let A;
/** Pool PRÓPRIO do teste (detentor de travas, observação de `pg_locks`, contagem de consultas). @type {PrismaClient} */
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
const URL_SUP = '/movimentacoes-estoque/comandos/saida-suplementacao';
const URL_TRANSF = '/movimentacoes-estoque/comandos/transferencia-locais';
const MODULO = '../src/modules/estoqueFisico/reconciliacaoEstoque.js';
const item = (produto, quantidade, valor_unitario, extra = {}) => ({ produto, quantidade, valor_unitario, ...extra });

/** GET da reconciliação; `query` sem `undefined`. */
const reconciliar = (token, query = {}) => {
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
  return app.inject({ method: 'GET', url: qs ? `${ROTA}?${qs}` : ROTA, headers: token ? { authorization: `Bearer ${token}` } : {} });
};
/** Relatório (200) do administrador do tenant. */
const relatorio = async (s, query = {}) => {
  const r = await reconciliar(s.token, query);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
/** Achados de um nível cuja chave tem `campo = id`. */
const achadosDe = (rel, nivel, campo, id) => rel.achados.filter((a) => a.nivel === nivel && a.chave?.[campo] === id);
/** `[classe, regra]` do ÚNICO achado da entidade (ou null se OK). */
const classe = (rel, nivel, campo, id) => {
  const lista = achadosDe(rel, nivel, campo, id);
  assert.ok(lista.length <= 1, `um achado por entidade: ${JSON.stringify(lista)}`);
  return lista.length ? [lista[0].classe, lista[0].regra] : null;
};
const zerado = (extra = {}) => ({ OK: 0, DIVERGENCIA_REAL: 0, LIMITACAO_LEGADA: 0, DADOS_INSUFICIENTES: 0, ...extra });
const auditorias = (c) => prisma().auditLog.count({ where: { cliente_id: c } });
const suplementar = (s, e, produto, local, quantidade) =>
  A.ok(A.req('POST', URL_SUP, s.token, { operation_id: opId(), empresa_id: e.id, produto_id: produto.id, local_origem_id: local.id, quantidade }), 201);
const transferir = (s, e, produto, origem, destino, quantidade) =>
  A.ok(A.req('POST', URL_TRANSF, s.token, { operation_id: opId(), empresa_id: e.id, produto_id: produto.id, local_origem_id: origem.id, local_destino_id: destino.id, quantidade }), 201);
const cancelar = (s, d, e) => A.ok(A.cancelarReq(s.token, d.id, e.id));
const definirEstoqueAtual = (s, produto, valor) =>
  prisma().produto.update({ where: { cliente_id_id: { cliente_id: s.c, id: produto.id } }, data: { estoque_atual: valor } });
let seq = 0;
const numeroLegado = (rotulo) => `${rotulo}-${(seq += 1)}-${randomUUID().slice(0, 6)}`;

/** Movimento escrito direto no banco (emula o caminho legado ou o novo, sem depender da F1). */
const movimento = (s, e, produto, dados) =>
  prisma().movimentacaoEstoque.create({
    data: {
      cliente_id: s.c, empresa_id: e.id, produto_id: produto.id, produto_nome: produto.nome_produto, unidade_medida: 'KG',
      data_movimentacao: new Date('2027-06-11T12:00:00.000Z'), numero_movimentacao: numeroLegado('MOV'), status: 'Ativa', ...dados,
    },
  });
/** Recibo committed de comando de estoque (tipo `saida_suplementacao`/`transferencia_locais`). */
const recibo = (s, tipo, corpo) =>
  prisma().operacaoIdempotente.create({
    data: { cliente_id: s.c, operation_key: opId(), tipo_operacao: tipo, fingerprint: randomUUID().replace(/-/g, ''), status: 'committed', http_status: 201, response_json: corpo },
  });
/** Fatia do `rateio` do recibo, no formato externo de hoje (números JSON). */
const fatiaRecibo = (loteId, quantidade, custo) => ({
  lote_id: loteId, numero_documento: 'S/N', serie_documento: '', data_documento: '2027-06-10T00:00:00.000Z', fornecedor_id: null, fornecedor_nome: null,
  quantidade_consumida: quantidade, custo_unitario: custo, valor_total: quantidade * custo,
});

/** pids diretamente bloqueados por `pid`. */
const bloqueadosPor = async (pid) =>
  /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND ${pid}::int = ANY(pg_blocking_pids(pid))`).map((r) => r.pid);
const esperar = async (cond, rotulo, ms = 15000) => {
  const limite = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > limite) throw new Error(`tempo esgotado esperando: ${rotulo}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};
const acompanhar = (pedido) => {
  const t0 = Date.now();
  /** @type {{ feito: boolean, r: any, ms: number, p: Promise<any> }} */
  const a = { feito: false, r: null, ms: 0, p: Promise.resolve() };
  a.p = Promise.resolve(pedido).then((r) => {
    Object.assign(a, { feito: true, r, ms: Date.now() - t0 });
    return r;
  });
  return a;
};
const DESFAZ = 'p0f4-desfaz-detentor';

// ─────────────────────────────────────────────────────────────────────────────
describe('R1 — fixture consistente: 0 achados em todas as classes', () => {
  test('R1: compra 100 sal + venda 30 + supl 10 (comando) + transf 20 (comando) + compra cancelada + venda cancelada → resumo só OK, achados []', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2.00')]));
    await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '30', '5.00')], { direcao: 'RECEBER' }));
    await suplementar(s, e, e.sal, s.local, 10);
    await transferir(s, e, e.sal, s.local, s.local2, 20);
    // estornos do protocolo: o razão (com todos os status) se compensa e o consumo devolvido sai da conta
    const compraMilho = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.milho, '50', '1.00')]));
    await cancelar(s, compraMilho, e);
    const venda2 = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '5', '5.00')], { direcao: 'RECEBER' }));
    await cancelar(s, venda2, e);

    const rel = await relatorio(s, { empresa_id: e.id });
    assert.deepEqual(rel.achados, [], JSON.stringify(rel.achados));
    // 3 produtos (sal, ração, milho); 3 locais (sal×local, sal×local2, milho×local); 3 lotes (compra sal,
    // destino da transferência, compra de milho estornada); 9 movimentos (compra, venda, supl, transf×2,
    // compra de milho + estorno, venda 2 + estorno)
    assert.deepEqual([rel.resumo.produtos, rel.resumo.locais, rel.resumo.lotes, rel.resumo.movimentos], [3, 3, 3, 9]);
    assert.deepEqual(rel.resumo.por_classe, zerado({ OK: 18 }));
    assert.equal(rel.truncado, false);
    assert.deepEqual(rel.escopo, { empresa_id: e.id, produto_id: null, local_estoque_id: null, limite: 500 });
    assert.match(rel.gerado_em, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('R1b: abastecimento confirmado + abastecimento cancelado (fatias FK por lote) → 0 achados no diesel', async () => {
    const s = await montarAbastecimento(app, { lotes: false });
    const AB = acoesAbastecimento(app);
    await s.compraP3(s.e1, s.diesel, s.local, { quantidade: '200.0000', preco: '5.00' });
    await AB.confirmarOk(s.operador.token, corpoAbastecimento(s));
    const d2 = await AB.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade: '50', medidor_leitura: '1600.5' }));
    const rc = await AB.cancelar(s.contaCancelar.token, d2.id, { empresa_id: s.e1.id, versao: 1, motivo: 'lançado no bem errado', operation_id: opId() });
    assert.equal(rc.statusCode, 200, rc.body);
    const rel = await relatorio(s, { empresa_id: s.e1.id, produto_id: s.diesel.id });
    assert.deepEqual(rel.achados, [], JSON.stringify(rel.achados));
    // 1 produto, 1 local, 1 lote; compra + 2 saídas (uma estornada) + estorno
    assert.deepEqual([rel.resumo.produtos, rel.resumo.locais, rel.resumo.lotes, rel.resumo.movimentos], [1, 1, 1, 4]);
    assert.deepEqual(rel.resumo.por_classe, zerado({ OK: 7 }));
  });
});

describe('R2 — divergência real injetada por SQL no lote de compra', () => {
  test('R2: UPDATE −1 no lote da compra → lote DIVERGENCIA_REAL/consumo_nao_explicado; produto …/cache_diverge; local …/razao_diverge (strings 4 casas)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2.00')]));
    await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '30', '5.00')], { direcao: 'RECEBER' }));
    const L = compra.itens[0].estoque_lote_nota_id;
    assert.deepEqual((await relatorio(s, { empresa_id: e.id })).achados, [], 'antes da injeção: consistente');

    await prisma().$executeRaw`UPDATE "EstoqueLoteNota" SET quantidade_disponivel = quantidade_disponivel - 1 WHERE cliente_id = ${s.c} AND id = ${L}`;
    const rel = await relatorio(s, { empresa_id: e.id });
    const [lote] = achadosDe(rel, 'lote', 'lote_id', L);
    assert.deepEqual([lote?.classe, lote?.regra, lote?.esperado, lote?.observado, lote?.diferenca], ['DIVERGENCIA_REAL', 'consumo_nao_explicado', '30.0000', '31.0000', '1.0000'], JSON.stringify(rel.achados));
    const [produto] = achadosDe(rel, 'produto', 'produto_id', e.sal.id);
    assert.deepEqual([produto?.classe, produto?.regra, produto?.esperado, produto?.observado, produto?.diferenca], ['DIVERGENCIA_REAL', 'cache_diverge', '69.0000', '70.0000', '1.0000']);
    const local = achadosDe(rel, 'local', 'produto_id', e.sal.id).find((a) => a.chave.local_estoque_id === s.local.id);
    assert.deepEqual([local?.classe, local?.regra, local?.esperado, local?.observado, local?.diferenca], ['DIVERGENCIA_REAL', 'razao_diverge', '70.0000', '69.0000', '-1.0000']);
    assert.deepEqual(rel.resumo.por_classe, zerado({ OK: rel.resumo.produtos + rel.resumo.locais + rel.resumo.lotes + rel.resumo.movimentos - 3, DIVERGENCIA_REAL: 3 }));
  });
});

describe('R3 — cache sem lote: ausência de histórico × escritor legado com evidência; seed demo (W25)', () => {
  test('R3: cache 50 via prisma sem lote nem AuditLog → DADOS_INSUFICIENTES/cache_sem_lote; com AuditLog de estoque_atual → LIMITACAO_LEGADA; AuditLog sem mudança de estoque não é evidência', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await definirEstoqueAtual(s, e.milho, '50');
    await definirEstoqueAtual(s, e.racao, '50');
    await definirEstoqueAtual(s, s.e2.sal, '50');
    const auditoria = (produto, antes, depois) =>
      prisma().auditLog.create({
        data: {
          cliente_id: s.c, usuario_id: s.admId, acao: 'update', entidade: 'Produto', entidade_id: produto.id, request_id: `req-${randomUUID().slice(0, 8)}`,
          dados_anteriores: { id: produto.id, empresa_id: produto.empresa_id, nome_produto: produto.nome_produto, estoque_atual: antes },
          dados_novos: { id: produto.id, empresa_id: produto.empresa_id, nome_produto: `${produto.nome_produto} X`, estoque_atual: depois },
        },
      });
    await auditoria(e.racao, 0, 50); // PATCH legado de estoque_atual
    await auditoria(s.e2.sal, 0, 0); // renomeação: não mexe no estoque
    const rel = await relatorio(s);
    assert.deepEqual(classe(rel, 'produto', 'produto_id', e.milho.id), ['DADOS_INSUFICIENTES', 'cache_sem_lote']);
    assert.deepEqual(classe(rel, 'produto', 'produto_id', e.racao.id), ['LIMITACAO_LEGADA', 'cache_escrito_fora_do_motor']);
    assert.deepEqual(classe(rel, 'produto', 'produto_id', s.e2.sal.id), ['DADOS_INSUFICIENTES', 'cache_sem_lote']);
    const [milho] = achadosDe(rel, 'produto', 'produto_id', e.milho.id);
    assert.deepEqual([milho.esperado, milho.observado, milho.diferenca, milho.chave.empresa_id], ['0.0000', '50.0000', '50.0000', e.id]);
    // sem PII: nem dados_* do AuditLog, nem login/nome/id de usuário
    const corpo = JSON.stringify(rel);
    for (const proibido of ['dados_anteriores', 'dados_novos', 'usuario', s.admLogin, s.admId, 'RACAO 1 X']) assert.ok(!corpo.includes(proibido), `sem "${proibido}" na resposta`);
  });

  test('W25: o seed demo cria o produto com estoque_atual 0 (sem saldo sem fato) e a reconciliação o vê OK', async () => {
    const s = await montarTenant(app);
    assert.equal(DEMO.produto.estoque_atual, 0, 'DEMO.produto.estoque_atual');
    await seedDemoTenant(prisma(), { clienteId: s.c, empresaId: s.e1.id });
    const produto = await prisma().produto.findUnique({ where: { cliente_id_numero_produto: { cliente_id: s.c, numero_produto: DEMO.produto.numero_produto } } });
    assert.equal(produto?.estoque_atual.toFixed(4), '0.0000');
    const rel = await relatorio(s, { produto_id: produto.id });
    assert.deepEqual(rel.achados, []);
    assert.deepEqual(rel.resumo.por_classe, zerado({ OK: 1 }));
  });
});

describe('R4/R5 — limitação legada e dados insuficientes no nível do lote', () => {
  test('R4: loteLegado + cache coerente → lote LIMITACAO_LEGADA/lote_sem_movimento_entrada, produto OK; limite=1 trunca os achados e mantém o resumo', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const legado = await loteLegado(s, e, e.sal, s.local, { kg: '40' });
    await definirEstoqueAtual(s, e.sal, '40');
    const rel = await relatorio(s, { empresa_id: e.id });
    assert.deepEqual(classe(rel, 'lote', 'lote_id', legado.id), ['LIMITACAO_LEGADA', 'lote_sem_movimento_entrada']);
    assert.equal(classe(rel, 'produto', 'produto_id', e.sal.id), null, 'o cache bate com os lotes: produto OK');
    const local = achadosDe(rel, 'local', 'produto_id', e.sal.id);
    assert.deepEqual(local.map((a) => [a.classe, a.regra, a.esperado, a.observado]), [['LIMITACAO_LEGADA', 'razao_diverge_legado', '0.0000', '40.0000']]);

    const outro = await loteLegado(s, e, e.milho, s.local2, { kg: '7' });
    await definirEstoqueAtual(s, e.milho, '7');
    const cheio = await relatorio(s, { empresa_id: e.id });
    const curto = await relatorio(s, { empresa_id: e.id, limite: 1 });
    assert.equal(cheio.achados.length, 4);
    assert.ok(cheio.achados.some((a) => a.chave.lote_id === outro.id));
    assert.deepEqual([curto.achados.length, curto.truncado, cheio.truncado], [1, true, false]);
    assert.deepEqual(curto.resumo, cheio.resumo, 'o limite corta só a lista; o resumo conta tudo');
  });

  test('R5: status "X" e lote/movimento órfão → DADOS_INSUFICIENTES; transferência antiga com data 2001 → LIMITACAO_LEGADA/data_transferencia_2001 (origem explicada pelo recibo legado); Esgotado/Estornado fora do saldo', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    // (a) situação desconhecida
    const x = await loteLegado(s, e, e.milho, s.local, { kg: '5', status: 'X' });
    // (b) lote e movimento órfãos (sem FK para Produto)
    const fantasma = { id: `produto-fantasma-${randomUUID().slice(0, 8)}`, nome_produto: 'FANTASMA', empresa_id: e.id };
    const orfao = await loteLegado(s, e, fantasma, s.local, { kg: '3' });
    const movOrfao = await movimento(s, e, fantasma, { tipo_movimentacao: 'Saída', tipo_detalhado: 'venda_financeiro', origem_sistema: 'operacao_financeira', quantidade: '1', local_estoque_origem: s.local.id });
    // (c) transferência ANTIGA (formato legado) de 90 kg de ração: lote de origem da compra, destino com o ano 2001
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.racao, '10', '60', { unidade: 'SACO' })]));
    const L1 = compra.itens[0].estoque_lote_nota_id;
    await prisma().estoqueLoteNota.update({ where: { cliente_id_id: { cliente_id: s.c, id: L1 } }, data: { quantidade_disponivel: '210' } });
    const saida = await movimento(s, e, e.racao, {
      tipo_movimentacao: 'Saída', tipo_detalhado: 'transferencia_enviada', origem_sistema: 'deposito', quantidade: '90', local_estoque_origem: s.local.id, local_estoque_destino: s.local2.id,
    });
    const entrada = await movimento(s, e, e.racao, {
      tipo_movimentacao: 'Entrada', tipo_detalhado: 'transferencia_recebida', origem_sistema: 'deposito', quantidade: '90', local_estoque_origem: s.local.id, local_estoque_destino: s.local2.id,
      movimento_pai_id: saida.id,
    });
    await prisma().movimentacaoEstoque.update({ where: { cliente_id_id: { cliente_id: s.c, id: saida.id } }, data: { movimento_filho_id: entrada.id } });
    const T1 = await prisma().estoqueLoteNota.create({
      data: {
        cliente_id: s.c, empresa_id: e.id, produto_id: e.racao.id, local_estoque_id: s.local2.id, data_documento: new Date('2001-06-10T00:00:00.000Z'),
        custo_unitario: '2.0000', quantidade_entrada: '90', quantidade_disponivel: '90', movimentacao_entrada_id: entrada.id, status: 'Disponivel',
      },
    });
    await recibo(s, 'transferencia_locais', {
      committed: true, operation_id: 'op-legado', replay: false,
      movimentacao_saida: { id: saida.id, numero_movimentacao: saida.numero_movimentacao, movimento_filho_id: null },
      movimentacao_entrada: { id: entrada.id, numero_movimentacao: entrada.numero_movimentacao },
      rateio: [fatiaRecibo(L1, 90, 2)],
    });
    // (d) Esgotado/Estornado com saldo (incoerentes): não entram no saldo do produto
    const esgotado = await loteLegado(s, s.e2, s.e2.sal, s.local, { kg: '10', status: 'Esgotado', disponivel: '7' });
    await loteLegado(s, s.e2, s.e2.sal, s.local, { kg: '10', status: 'Estornado', disponivel: '3' });

    const rel = await relatorio(s);
    assert.deepEqual(classe(rel, 'lote', 'lote_id', x.id), ['DADOS_INSUFICIENTES', 'status_desconhecido']);
    assert.deepEqual(classe(rel, 'lote', 'lote_id', orfao.id), ['DADOS_INSUFICIENTES', 'produto_inexistente']);
    assert.deepEqual(classe(rel, 'movimento', 'movimento_id', movOrfao.id), ['DADOS_INSUFICIENTES', 'produto_inexistente']);
    assert.deepEqual(classe(rel, 'lote', 'lote_id', T1.id), ['LIMITACAO_LEGADA', 'data_transferencia_2001']);
    assert.equal(classe(rel, 'lote', 'lote_id', L1), null, 'origem: os 90 kg são explicados pelo rateio do recibo legado');
    assert.equal(classe(rel, 'produto', 'produto_id', e.racao.id), null, 'a transferência não muda o cache (300 = 210 + 90)');
    assert.equal(classe(rel, 'movimento', 'movimento_id', saida.id), null);
    assert.equal(classe(rel, 'movimento', 'movimento_id', entrada.id), null);
    for (const loc of [s.local, s.local2]) {
      assert.equal(achadosDe(rel, 'local', 'produto_id', e.racao.id).filter((a) => a.chave.local_estoque_id === loc.id).length, 0, `razão da ração em ${loc.nome}`);
    }
    // Esgotado 7 e Estornado 3 fora do saldo: cache 0 = Σ 'Disponivel' 0 → produto OK; o lote incoerente aparece
    assert.equal(classe(rel, 'produto', 'produto_id', s.e2.sal.id), null);
    const [lEsgotado] = achadosDe(rel, 'lote', 'lote_id', esgotado.id);
    assert.equal(lEsgotado.classe, 'LIMITACAO_LEGADA');
    assert.ok(lEsgotado.evidencias.includes('saldo_fora_de_disponivel'), JSON.stringify(lEsgotado));
    assert.ok(rel.achados.every((a) => a.chave.produto_id !== undefined || a.chave.movimento_id !== undefined || a.chave.lote_id !== undefined));
  });
});

describe('RF — os DOIS formatos de prova do consumo (recibo legado e lotes_consumidos novo), emulados por prisma', () => {
  test('RF1: recibo legado (rateio, movimento sem lotes_consumidos) + caminho novo (lotes_consumidos, com recibo que também tem rateio) explicam o consumo sem contar duas vezes; sem o recibo legado → DADOS_INSUFICIENTES', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '60', '2.00')]));
    const L = compra.itens[0].estoque_lote_nota_id;
    // legado: baixa absoluta do lote, decremento do cache, movimento sem fatias e recibo com o rateio
    await prisma().estoqueLoteNota.update({ where: { cliente_id_id: { cliente_id: s.c, id: L } }, data: { quantidade_disponivel: '48' } });
    await prisma().produto.update({ where: { cliente_id_id: { cliente_id: s.c, id: e.sal.id } }, data: { estoque_atual: { decrement: 12 } } });
    const sLegado = await movimento(s, e, e.sal, { tipo_movimentacao: 'Saída', tipo_detalhado: 'suplementacao', origem_sistema: 'suplementacao', quantidade: '12', local_estoque_origem: s.local.id });
    const rLegado = await recibo(s, 'saida_suplementacao', {
      committed: true, operation_id: 'op-a', replay: false, movimentacao: { id: sLegado.id, numero_movimentacao: sLegado.numero_movimentacao }, rateio: [fatiaRecibo(L, 12, 2)],
    });
    // novo: fatias em lotes_consumidos; o recibo novo TAMBÉM traz rateio (não pode contar de novo)
    await prisma().estoqueLoteNota.update({ where: { cliente_id_id: { cliente_id: s.c, id: L } }, data: { quantidade_disponivel: '40' } });
    await prisma().produto.update({ where: { cliente_id_id: { cliente_id: s.c, id: e.sal.id } }, data: { estoque_atual: { decrement: 8 } } });
    const sNovo = await movimento(s, e, e.sal, {
      tipo_movimentacao: 'Saída', tipo_detalhado: 'suplementacao', origem_sistema: 'suplementacao', quantidade: '8.0000', local_estoque_origem: s.local.id, modo_saida_fifo: 'FIFO',
      lotes_consumidos: [{ lote_id: L, quantidade: '8.0000', custo_unitario: '2.0000' }],
    });
    await recibo(s, 'saida_suplementacao', {
      committed: true, operation_id: 'op-b', replay: false, movimentacao: { id: sNovo.id, numero_movimentacao: sNovo.numero_movimentacao }, rateio: [fatiaRecibo(L, 8, 2)],
    });
    const rel = await relatorio(s, { empresa_id: e.id, produto_id: e.sal.id });
    assert.deepEqual(rel.achados, [], JSON.stringify(rel.achados));
    assert.deepEqual([rel.resumo.lotes, rel.resumo.movimentos], [1, 3]);

    await prisma().operacaoIdempotente.delete({ where: { id: rLegado.id } });
    const sem = await relatorio(s, { empresa_id: e.id, produto_id: e.sal.id });
    assert.deepEqual(classe(sem, 'lote', 'lote_id', L), ['DADOS_INSUFICIENTES', 'consumo_legado_sem_recibo']);
    assert.deepEqual(classe(sem, 'movimento', 'movimento_id', sLegado.id), ['DADOS_INSUFICIENTES', 'consumo_legado_sem_recibo']);
    assert.equal(classe(sem, 'movimento', 'movimento_id', sNovo.id), null);
    assert.equal(classe(sem, 'produto', 'produto_id', e.sal.id), null, 'o cache continua coerente com os lotes');
  });

  test('RF2: float do recibo legado (0.30000000000000004) vira 0.3000; resíduo de 0.0001 por fatia legada → LIMITACAO_LEGADA/residuo_number_legado; acima da tolerância → DIVERGENCIA_REAL', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.milho, '0.3', '2.00'), item(e.sal, '10', '1.00')]));
    const [M, S] = [0, 1].map((k) => compra.itens[k].estoque_lote_nota_id);
    // milho: o FIFO em Number consumiu 0.30000000000000004 (o lote ficou Esgotado 0.0000)
    await prisma().estoqueLoteNota.update({ where: { cliente_id_id: { cliente_id: s.c, id: M } }, data: { quantidade_disponivel: '0', status: 'Esgotado' } });
    await definirEstoqueAtual(s, e.milho, '0');
    const mMilho = await movimento(s, e, e.milho, { tipo_movimentacao: 'Saída', tipo_detalhado: 'suplementacao', origem_sistema: 'suplementacao', quantidade: '0.3', local_estoque_origem: s.local.id });
    await recibo(s, 'saida_suplementacao', { committed: true, movimentacao: { id: mMilho.id }, rateio: [fatiaRecibo(M, 0.1 + 0.2, 2)] });
    // sal: pedido 2.34565 → movimento 2.3457 (numeric), cache 10 − 2.34565 = 7.6544, lote gravado em absoluto 7.6544
    await prisma().estoqueLoteNota.update({ where: { cliente_id_id: { cliente_id: s.c, id: S } }, data: { quantidade_disponivel: '7.6544' } });
    await definirEstoqueAtual(s, e.sal, '7.6544');
    const mSal = await movimento(s, e, e.sal, { tipo_movimentacao: 'Saída', tipo_detalhado: 'suplementacao', origem_sistema: 'suplementacao', quantidade: '2.3457', local_estoque_origem: s.local.id });
    await recibo(s, 'saida_suplementacao', { committed: true, movimentacao: { id: mSal.id }, rateio: [fatiaRecibo(S, 2.34565, 1)] });

    const rel = await relatorio(s, { empresa_id: e.id });
    assert.equal(classe(rel, 'lote', 'lote_id', M), null, 'o float do rateio é lido com 4 casas');
    assert.equal(classe(rel, 'movimento', 'movimento_id', mMilho.id), null);
    const [lote] = achadosDe(rel, 'lote', 'lote_id', S);
    assert.deepEqual([lote?.classe, lote?.regra, lote?.esperado, lote?.observado, lote?.diferenca], ['LIMITACAO_LEGADA', 'residuo_number_legado', '2.3457', '2.3456', '-0.0001'], JSON.stringify(rel.achados));
    const local = achadosDe(rel, 'local', 'produto_id', e.sal.id);
    assert.deepEqual(local.map((a) => [a.classe, a.regra, a.diferenca]), [['LIMITACAO_LEGADA', 'residuo_number_legado', '0.0001']]);
    assert.equal(classe(rel, 'produto', 'produto_id', e.sal.id), null);

    // além da tolerância (0.0001 × 1 fatia): divergência real
    await prisma().estoqueLoteNota.update({ where: { cliente_id_id: { cliente_id: s.c, id: S } }, data: { quantidade_disponivel: '7.6546' } });
    const pior = await relatorio(s, { empresa_id: e.id });
    assert.deepEqual(classe(pior, 'lote', 'lote_id', S), ['DIVERGENCIA_REAL', 'consumo_nao_explicado']);
  });
});

describe('R6 — tenancy e autorização da rota', () => {
  test('R6: tenant B nunca aparece para A; 401 sem token; 403 TENANT_ADMIN_REQUIRED (is_admin e operador); 404 empresa de B; 400 querystring extra/limite inválido; produto de B → vazio (sem oráculo)', async () => {
    const s = await montarTenant(app);
    const b = await montarTenant(app);
    await loteLegado(b, b.e1, b.e1.sal, b.local, { kg: '9' });
    await definirEstoqueAtual(b, b.e1.milho, '5');
    await loteLegado(s, s.e1, s.e1.sal, s.local, { kg: '4' });
    await definirEstoqueAtual(s, s.e1.sal, '4');

    const rel = await relatorio(s);
    const corpo = JSON.stringify(rel);
    for (const idDeB of [b.c, b.e1.id, b.e2.id, b.e1.sal.id, b.e1.milho.id, b.local.id]) assert.ok(!corpo.includes(idDeB), `id de B (${idDeB}) não aparece para A`);
    assert.equal(rel.resumo.produtos, 6, 'só os 6 produtos de A');
    assert.ok(rel.achados.length >= 1);

    const semToken = await reconciliar(null, {});
    assert.deepEqual([semToken.statusCode, codigo(semToken)], [401, 'TENANT_CONTEXT_REQUIRED'], semToken.body);
    for (const conta of [await s.conta({ is_admin: true }), await s.contaCom({ visualizar: true, confirmar: true })]) {
      const r = await reconciliar(conta.token, { empresa_id: s.e1.id });
      assert.deepEqual([r.statusCode, codigo(r)], [403, 'TENANT_ADMIN_REQUIRED'], r.body);
    }
    const empresaB = await reconciliar(s.token, { empresa_id: b.e1.id });
    assert.deepEqual([empresaB.statusCode, codigo(empresaB)], [404, 'EMPRESA_NOT_FOUND'], empresaB.body);
    for (const q of [{ cliente_id: b.c }, { empresa_id: s.e1.id, extra: '1' }, { limite: 0 }, { limite: 2001 }, { limite: 'abc' }]) {
      const r = await reconciliar(s.token, q);
      assert.deepEqual([r.statusCode, codigo(r)], [400, 'REQUEST_VALIDATION_FAILED'], `${JSON.stringify(q)} → ${r.body}`);
    }
    const produtoB = await relatorio(s, { produto_id: b.e1.sal.id });
    assert.deepEqual([produtoB.achados, produtoB.resumo.produtos, produtoB.resumo.lotes], [[], 0, 0]);
  });
});

describe('R10 — evidência do AuditLog (Q5) e JSON fora de forma', () => {
  test('R10: renomeação benigna do lote não é evidência; PATCH/DELETE legado de lote e POST manual de movimento → LIMITACAO_LEGADA; JSON forjado ou fora de forma nunca derruba a leitura', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2.00')]));
    const L = compra.itens[0].estoque_lote_nota_id;
    // renomeação benigna pela rota (FormularioPonto): o AuditLog só muda local_estoque_nome/updated_date
    await A.ok(A.req('PATCH', `/estoque-lotes-nota/${L}`, s.token, { local_estoque_nome: s.local.nome }));
    assert.ok(await prisma().auditLog.count({ where: { cliente_id: s.c, entidade: 'EstoqueLoteNota', entidade_id: L, acao: 'update' } }) >= 1);
    // AuditLog de lote com dados fora de forma (lista/nulo): não é evidência e não quebra a leitura
    await prisma().auditLog.create({ data: { cliente_id: s.c, acao: 'update', entidade: 'EstoqueLoteNota', entidade_id: L, request_id: 'req-forma', dados_novos: ['x'] } });
    assert.deepEqual((await relatorio(s, { empresa_id: e.id })).achados, [], 'a renomeação benigna não é escritor fora do protocolo');

    // PATCH legado de quantidade (antes da P0): o lote e o cache divergem e há evidência
    const publico = (disp, nome) => ({
      id: L, empresa_id: e.id, produto_id: e.sal.id, local_estoque_id: s.local.id, local_estoque_nome: nome, quantidade_entrada: '100', quantidade_disponivel: disp,
      status: 'Disponivel', updated_date: new Date().toISOString(),
    });
    await prisma().estoqueLoteNota.update({ where: { cliente_id_id: { cliente_id: s.c, id: L } }, data: { quantidade_disponivel: '90' } });
    await prisma().auditLog.create({
      data: { cliente_id: s.c, acao: 'update', entidade: 'EstoqueLoteNota', entidade_id: L, request_id: 'req-patch', dados_anteriores: publico('100', s.local.nome), dados_novos: publico('90', s.local.nome) },
    });
    // DELETE legado de um lote de milho (o cache ficou com o saldo do lote apagado)
    await definirEstoqueAtual(s, e.milho, '30');
    await prisma().auditLog.create({
      data: {
        cliente_id: s.c, acao: 'delete', entidade: 'EstoqueLoteNota', entidade_id: `lote-apagado-${randomUUID().slice(0, 8)}`, request_id: 'req-del',
        dados_anteriores: { produto_id: e.milho.id, empresa_id: e.id, local_estoque_id: s.local.id, quantidade_disponivel: '30' },
      },
    });
    // POST genérico legado de movimento (origem manual) de ração, sem lote
    const manual = await movimento(s, e, e.racao, { tipo_movimentacao: 'Entrada', tipo_detalhado: 'ajuste', origem_sistema: 'manual', quantidade: '25', local_estoque_destino: s.local.id });
    await prisma().auditLog.create({
      data: { cliente_id: s.c, acao: 'create', entidade: 'MovimentacaoEstoque', entidade_id: manual.id, request_id: 'req-post', dados_novos: { id: manual.id, empresa_id: e.id, produto_id: e.racao.id, origem_sistema: 'manual' } },
    });
    // lotes_consumidos forjado (quantidade não numérica) e recibo com rateio fora de forma
    const forjado = await movimento(s, s.e2, s.e2.milho, {
      tipo_movimentacao: 'Saída', tipo_detalhado: 'suplementacao', origem_sistema: 'suplementacao', quantidade: '1', local_estoque_origem: s.local.id,
      lotes_consumidos: [{ lote_id: 'x', quantidade: 'abc' }, 'texto', { lote_id: 'y', quantidade: '1e999999' }],
    });
    await recibo(s, 'saida_suplementacao', { movimentacao: { id: forjado.id }, rateio: { nao: 'lista' } });
    await recibo(s, 'transferencia_locais', ['nao', 'objeto']);

    const rel = await relatorio(s);
    const [lote] = achadosDe(rel, 'lote', 'lote_id', L);
    assert.deepEqual([lote?.classe, lote?.regra], ['LIMITACAO_LEGADA', 'lote_escrito_fora_do_motor'], JSON.stringify(rel.achados));
    assert.ok(lote.evidencias.includes('consumo_nao_explicado') && lote.evidencias.includes('auditoria:EstoqueLoteNota:update'), JSON.stringify(lote));
    assert.deepEqual(classe(rel, 'produto', 'produto_id', e.sal.id), ['LIMITACAO_LEGADA', 'cache_diverge_legado']);
    assert.deepEqual(classe(rel, 'produto', 'produto_id', e.milho.id), ['LIMITACAO_LEGADA', 'cache_diverge_legado'], 'cache sem lote, mas com o DELETE legado como evidência');
    assert.deepEqual(classe(rel, 'movimento', 'movimento_id', manual.id), ['LIMITACAO_LEGADA', 'origem_fora_do_protocolo']);
    const localRacao = achadosDe(rel, 'local', 'produto_id', e.racao.id);
    assert.deepEqual(localRacao.map((a) => [a.classe, a.regra, a.esperado, a.observado]), [['LIMITACAO_LEGADA', 'razao_diverge_legado', '25.0000', '0.0000']]);
    assert.deepEqual(classe(rel, 'movimento', 'movimento_id', forjado.id), ['DADOS_INSUFICIENTES', 'fatias_ilegiveis']);
    const corpo = JSON.stringify(rel);
    for (const proibido of ['dados_anteriores', 'dados_novos', 'req-patch', 'req-del']) assert.ok(!corpo.includes(proibido), `sem "${proibido}" na resposta`);
  });
});

describe('R7/R8 — sem auto-reparo, sem trava, número fixo de consultas', () => {
  test('R7: foto() do tenant e contagem de AuditLog iguais antes e depois de reconciliar (com divergências presentes); duas leituras dão o mesmo relatório', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2.00')]));
    await prisma().$executeRaw`UPDATE "EstoqueLoteNota" SET quantidade_disponivel = quantidade_disponivel - 1 WHERE cliente_id = ${s.c} AND id = ${compra.itens[0].estoque_lote_nota_id}`;
    await loteLegado(s, e, e.milho, s.local, { kg: '3' });
    await definirEstoqueAtual(s, e.racao, '11');
    const antes = await foto([s.c]);
    const audAntes = await auditorias(s.c);
    const r1 = await relatorio(s);
    const r2 = await relatorio(s, {});
    assert.equal(await foto([s.c]), antes, 'nada gravado no tenant');
    assert.equal(await auditorias(s.c), audAntes, 'nenhum AuditLog');
    assert.ok(r1.achados.length >= 3);
    assert.deepEqual({ ...r1, gerado_em: null }, { ...r2, gerado_em: null });
  });

  test('R8: com detentor segurando travarProdutosEstoque + reservarNumeros + FOR UPDATE nos lotes, o reconciliador termina em < 2 s e nunca aparece em pg_blocking_pids', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2.00')]));
    /** @type {any} */
    let pedido;
    let bloqueado = false;
    await aux.$transaction(async (tx) => {
      const [{ pid }] = /** @type {any[]} */ (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`);
      await travarProdutosEstoque(tx, s.c, e.id, [e.sal.id, e.milho.id, e.racao.id]);
      await reservarNumeros(tx, { clienteId: s.c, entidade: 'MovimentacaoEstoque', escopoTipo: ESCOPO_TENANT }, 1);
      await tx.$queryRaw`SELECT id FROM "EstoqueLoteNota" WHERE cliente_id = ${s.c} ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Empresa" WHERE cliente_id = ${s.c} ORDER BY id FOR UPDATE`;
      pedido = acompanhar(reconciliar(s.token, { empresa_id: e.id }));
      await esperar(async () => {
        if (pedido.feito) return true;
        bloqueado = bloqueado || (await bloqueadosPor(pid)).length > 0;
        return false;
      }, 'reconciliação respondendo com as travas seguras', 12000);
      throw new Error(DESFAZ);
    }, { maxWait: 10000, timeout: 60000 }).catch((erro) => { if (erro?.message !== DESFAZ) throw erro; });
    await pedido.p;
    assert.equal(bloqueado, false, 'a leitura nunca esperou trava');
    assert.equal(pedido.r.statusCode, 200, pedido.r.body);
    assert.ok(pedido.ms < 2000, `terminou em ${pedido.ms} ms`);
  });

  test('R8b: número FIXO de idas ao banco numa página (≤ 10; R1: +5 por página, ver RC4), igual para tenant pequeno e grande; a 1ª é SET TRANSACTION READ ONLY e a transação recusa escrita', async () => {
    const { lerReconciliacao } = await import(MODULO);
    const contar = (tx) => {
      /** @type {string[]} */
      const chamadas = [];
      const proxy = new Proxy(tx, {
        get(alvo, prop) {
          const v = alvo[prop];
          if (prop === '$queryRaw' || prop === '$queryRawUnsafe' || prop === '$executeRaw' || prop === '$executeRawUnsafe') {
            return (...args) => {
              const sql = Array.isArray(args[0]) ? args[0][0] : String(args[0]?.strings?.[0] ?? args[0]);
              chamadas.push(`${String(prop)}:${sql.trim().replace(/\s+/g, ' ').slice(0, 30)}`);
              return v.apply(alvo, args);
            };
          }
          if (v && typeof v === 'object' && typeof v.findUnique === 'function') {
            return new Proxy(v, {
              get(modelo, metodo) {
                const f = modelo[metodo];
                return typeof f === 'function' ? (...args) => { chamadas.push(`${String(prop)}.${String(metodo)}`); return f.apply(modelo, args); } : f;
              },
            });
          }
          return typeof v === 'function' ? v.bind(alvo) : v;
        },
      });
      return { proxy, chamadas };
    };
    const medir = async (s, filtro) => {
      let chamadas = [];
      let recusa = null;
      await aux.$transaction(async (tx) => {
        const c = contar(tx);
        await lerReconciliacao(c.proxy, s.c, filtro);
        chamadas = c.chamadas;
        recusa = await tx.$executeRaw`UPDATE "Produto" SET nome_produto = nome_produto WHERE cliente_id = ${s.c}`.then(() => null, (erro) => String(erro?.message ?? erro));
        throw new Error(DESFAZ);
      }, { isolationLevel: 'RepeatableRead' }).catch((erro) => { if (erro?.message !== DESFAZ) throw erro; });
      return { chamadas, recusa };
    };
    const pequeno = await montarTenant(app);
    await loteLegado(pequeno, pequeno.e1, pequeno.e1.sal, pequeno.local, { kg: '1' });
    const grande = await montarTenant(app);
    for (const prod of [grande.e1.sal, grande.e1.milho]) {
      await A.criarConfirmar(grande.token, docCom(grande.e1, grande.local, [item(prod, '50', '2.00')]));
      await A.criarConfirmar(grande.token, docCom(grande.e1, grande.local, [item(prod, '5', '3.00')], { direcao: 'RECEBER' }));
      for (let k = 0; k < 3; k += 1) await loteLegado(grande, grande.e1, prod, grande.local2, { kg: String(k + 1) });
    }
    const p = await medir(pequeno, { empresaId: pequeno.e1.id });
    const g = await medir(grande, { empresaId: grande.e1.id });
    // R1 (D-PROD-161): a varredura é paginada; numa página são 4 idas fixas (READ ONLY, plan_cache_mode,
    // pré-contagem do escopo, exclusões legadas de lote) + a empresa + 5 da página (Q1–Q5). Antes: ≤ 7 sem paginar.
    assert.ok(p.chamadas.length <= 10, p.chamadas.join(' | '));
    assert.match(p.chamadas[1], /^\$queryRaw:SELECT set_config\('plan_cache_/);
    assert.deepEqual(g.chamadas, p.chamadas, 'mesmas idas ao banco, sem N+1');
    assert.match(p.chamadas[0], /^\$queryRaw:SET TRANSACTION READ ONLY/);
    assert.ok(!p.chamadas.some((c) => c.startsWith('$executeRaw')), 'nenhuma escrita');
    assert.match(String(p.recusa), /read-only transaction/, 'a transação da leitura é READ ONLY');
    const semEmpresa = await medir(grande, {});
    assert.equal(semEmpresa.chamadas.length, p.chamadas.length - 1, 'sem empresa: só não valida a empresa');
  });

  test('R9: o módulo não tem chamada de escrita nem trava (create/update/delete/upsert/$executeRaw/FOR UPDATE/advisory) e usa RepeatableRead + READ ONLY', () => {
    const semComentarios = (texto) => texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    // R2 (D-PROD-161): a ÚNICA cadeia `.update(` permitida é a do HMAC do cursor (`createHmac(...).update(...).digest()`,
    // memória, não banco); ela sai do texto antes da busca e tem de aparecer exatamente uma vez.
    const HMAC_DO_CURSOR = /createHmac\('sha256', chaveCursor\(\)\)(?:\.update\((?:[^()]|\([^()]*\))*\))+\.digest\(\)/g;
    for (const arquivo of ['../src/modules/estoqueFisico/reconciliacaoEstoque.js', '../src/modules/estoqueFisico/estoqueFisicoRoutes.js']) {
      const bruto = semComentarios(readFileSync(new URL(arquivo, import.meta.url), 'utf8'));
      if (arquivo.endsWith('reconciliacaoEstoque.js')) assert.equal((bruto.match(HMAC_DO_CURSOR) ?? []).length, 1, 'uma só cadeia HMAC do cursor');
      const codigoFonte = bruto.replace(HMAC_DO_CURSOR, 'HMAC_DO_CURSOR');
      for (const proibido of [/\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\s*\(/, /\$executeRaw/, /\bFOR\s+(NO\s+KEY\s+)?(UPDATE|SHARE)\b/i, /FOR KEY SHARE/i, /pg_advisory/, /\b(INSERT|UPDATE|DELETE)\s/, /travarEscopo|travarProdutosEstoque|reservarNumero/]) {
        assert.ok(!proibido.test(codigoFonte), `${arquivo}: ${proibido}`);
      }
    }
    const modulo = readFileSync(new URL('../src/modules/estoqueFisico/reconciliacaoEstoque.js', import.meta.url), 'utf8');
    assert.match(modulo, /SET TRANSACTION READ ONLY/);
    assert.match(modulo, /isolationLevel:.*'RepeatableRead'/);
  });
});

describe('Classificação pura (sem banco)', () => {
  const produto = (extra = {}) => ({
    id: 'p1', empresa_id: 'e1', estoque_atual: '10.0000', saldo_lotes: '10.0000', n_lotes: 1, n_lotes_outra_empresa: 0, n_lotes_status_desconhecido: 0,
    n_lotes_sem_movimento_entrada: 0, n_movimentos_outra_empresa: 0, n_movimentos_fora_do_protocolo: 0, n_saidas_legadas: 0, ...extra,
  });
  const lote = (extra = {}) => ({
    id: 'l1', empresa_id: 'e1', produto_id: 'p1', local_estoque_id: 'loc1', status: 'Disponivel', entrada: '10.0000', disponivel: '10.0000', movimentacao_entrada_id: 'm1',
    data_antiga: false, produto_inexistente: false, produto_empresa_id: 'e1', local_inexistente: false, consumo_financeiro: '0', consumo_abastecimento: '0',
    consumo_movimentos: '0', consumo_recibos: '0', fatias_recibo: 0, fatias_recibo_fora_janela: 0, compra_estornada: false, tem_movimento_entrada: true,
    entrada_tipo: 'Entrada', entrada_tipo_detalhado: 'compra_financeiro', entrada_origem: 'operacao_financeira', entrada_quantidade: '10.0000', entrada_incoerente: false, ...extra,
  });
  const vazio = { produtos: [], locais: [], lotes: [], movimentos: [], auditoria: [] };

  test('a primeira classe que casa vale (DADOS_INSUFICIENTES > LIMITACAO_LEGADA > DIVERGENCIA_REAL); as outras regras viram evidência', async () => {
    const { classificarReconciliacao } = await import(MODULO);
    const r = classificarReconciliacao({
      ...vazio,
      lotes: [
        lote({ id: 'ok' }),
        lote({ id: 'div', disponivel: '9.0000' }),
        lote({ id: 'leg', disponivel: '9.0000', movimentacao_entrada_id: null, tem_movimento_entrada: false }),
        lote({ id: 'ins', disponivel: '9.0000', movimentacao_entrada_id: null, tem_movimento_entrada: false, local_inexistente: true }),
        lote({ id: 'zero', disponivel: '0.0000', consumo_financeiro: '10.0000' }),
      ],
    });
    const de = (id) => r.achados.find((a) => a.chave.lote_id === id);
    assert.equal(de('ok'), undefined);
    assert.deepEqual([de('div').classe, de('div').regra], ['DIVERGENCIA_REAL', 'consumo_nao_explicado']);
    assert.deepEqual([de('leg').classe, de('leg').regra], ['LIMITACAO_LEGADA', 'lote_sem_movimento_entrada']);
    assert.ok(de('leg').evidencias.includes('consumo_nao_explicado'));
    assert.deepEqual([de('ins').classe, de('ins').regra], ['DADOS_INSUFICIENTES', 'local_inexistente']);
    assert.deepEqual([de('zero').classe, de('zero').regra], ['DIVERGENCIA_REAL', 'disponivel_zerado'], 'Disponivel com 0.0000 criado pelo motor');
    assert.deepEqual(r.resumo.por_classe, { OK: 1, DIVERGENCIA_REAL: 2, LIMITACAO_LEGADA: 1, DADOS_INSUFICIENTES: 1 });
  });

  test('produto: só o invariante do cache decide; lote legado com cache coerente não suja o produto; resíduo legado dentro da tolerância', async () => {
    const { classificarReconciliacao } = await import(MODULO);
    const r = classificarReconciliacao({
      ...vazio,
      produtos: [
        produto({ id: 'coerente', n_lotes_sem_movimento_entrada: 3 }),
        produto({ id: 'residuo', estoque_atual: '10.0002', n_saidas_legadas: 2 }),
        produto({ id: 'fora', estoque_atual: '10.0003', n_saidas_legadas: 2 }),
        produto({ id: 'negativo', estoque_atual: '-1.0000', saldo_lotes: '0', n_lotes: 0 }),
      ],
    });
    const de = (id) => r.achados.find((a) => a.chave.produto_id === id);
    assert.equal(de('coerente'), undefined);
    assert.deepEqual([de('residuo').classe, de('residuo').regra, de('residuo').diferenca], ['LIMITACAO_LEGADA', 'residuo_number_legado', '0.0002']);
    assert.deepEqual([de('fora').classe, de('fora').regra], ['DIVERGENCIA_REAL', 'cache_diverge']);
    assert.deepEqual([de('negativo').classe, de('negativo').regra], ['DADOS_INSUFICIENTES', 'cache_sem_lote']);
  });

  test('movimento: provisório, estornado sem filho, fatias ≠ quantidade → DIVERGENCIA_REAL; origem manual → LIMITACAO_LEGADA; origem desconhecida → DADOS_INSUFICIENTES', async () => {
    const { classificarReconciliacao } = await import(MODULO);
    const mov = (extra = {}) => ({
      id: 'm', empresa_id: 'e1', produto_id: 'p1', local_estoque_id: 'loc1', tipo_movimentacao: 'Saída', tipo_detalhado: 'venda_financeiro', origem_sistema: 'operacao_financeira',
      status: 'Ativa', quantidade: '5.0000', produto_inexistente: false, produto_empresa_id: 'e1', tipo_desconhecido: false, status_desconhecido: false, numero_provisorio: false,
      estornada_sem_filho: false, par_incoerente: false, tem_fatias_json: true, soma_fatias_json: '5.0000', n_fatias_json_ilegiveis: 0, legado: false, tem_recibo: false,
      soma_recibo: null, n_fatias_recibo: 0, transferencia_recebida: false, soma_lotes_destino: null, pai_legado: false, exige_camada: false, exige_fk: true, soma_fk: '5.0000', ...extra,
    });
    const r = classificarReconciliacao({
      ...vazio,
      movimentos: [
        mov({ id: 'prov', numero_provisorio: true }),
        mov({ id: 'est', status: 'Estornada', estornada_sem_filho: true }),
        mov({ id: 'fat', soma_fatias_json: '4.0000' }),
        mov({ id: 'man', origem_sistema: 'manual', tem_fatias_json: false, soma_fatias_json: null, exige_fk: false, soma_fk: null, numero_provisorio: true }),
        mov({ id: 'des', origem_sistema: 'importado', tem_fatias_json: false, soma_fatias_json: null, exige_fk: false, soma_fk: null }),
      ],
    });
    const de = (id) => r.achados.find((a) => a.chave.movimento_id === id);
    assert.deepEqual([de('prov').classe, de('prov').regra], ['DIVERGENCIA_REAL', 'numero_provisorio']);
    assert.deepEqual([de('est').classe, de('est').regra], ['DIVERGENCIA_REAL', 'estorno_sem_filho']);
    assert.deepEqual([de('fat').classe, de('fat').regra, de('fat').esperado, de('fat').observado], ['DIVERGENCIA_REAL', 'fatias_divergem_da_quantidade', '5.0000', '4.0000']);
    assert.deepEqual([de('man').classe, de('man').regra], ['LIMITACAO_LEGADA', 'origem_fora_do_protocolo']);
    assert.deepEqual([de('des').classe, de('des').regra], ['DADOS_INSUFICIENTES', 'origem_desconhecida']);
  });
});
