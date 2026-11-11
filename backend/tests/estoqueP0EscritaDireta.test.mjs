/**
 * D-PROD-161 — MAIKE-ESTOQUE-P0-01, fatia F3: corte dos escritores genéricos de
 * estoque (SPEC §2 W13/W16/W17/W18, §4, §7.2 item 2). PostgreSQL real, HTTP
 * autenticado, prova pelas linhas gravadas (`foto` do tenant inteiro).
 *
 * Movimento e lote só nascem, mudam de saldo/custo/situação ou deixam de
 * existir pelos comandos do motor físico. As rotas genéricas continuam
 * registradas (gates P5.4), mas:
 *  D1  POST /movimentacoes-estoque (corpo válido, admin real) → 409
 *      ESTOQUE_ESCRITA_DIRETA_RECUSADA; nada gravado; a sequência de movimentos
 *      do tenant não é reservada (nem esperada: não abre transação);
 *  D2  a ordem das recusas anteriores fica: schema 400 → guarda 403 → colunas 400;
 *  D3  POST /estoque-lotes-nota → 409; nenhum lote;
 *  D4  PATCH de coluna operacional em lote LIVRE → 409 DEPOIS da trava produto →
 *      lote (a semântica de C1 continua); lote de compra → 409
 *      REGISTRO_OPERACIONAL_IMUTAVEL; is_admin sem ser admin real → 403;
 *  D5  a renomeação benigna (`local_estoque_nome` conferido) continua 200;
 *  D6  DELETE de lote livre → 409; o lote fica;
 *  D7  PATCH de nome no movimento → 200; DELETE → 409 MOVIMENTO_CANCELAMENTO_OBRIGATORIO;
 *  D8  as leituras continuam 200.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, codigo, docCom, foto, loteLegado, montarTenant, prisma } from './gestaoP3Cenario.mjs';
import { travarProdutosEstoque } from '../src/modules/estoqueFisico/estoqueFisicoMotor.js';
import { ESCOPO_TENANT, reservarNumeros } from '../src/modules/sequencias/entidadeCodigoService.js';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoes>} */
let A;
/** Pool PRÓPRIO do teste para quem segura travas e observa `pg_locks`; os pedidos usam o pool do app. @type {PrismaClient} */
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

const RECUSA = 'ESTOQUE_ESCRITA_DIRETA_RECUSADA';
const item = (produto, quantidade, valor_unitario, extra = {}) => ({ produto, quantidade, valor_unitario, ...extra });
/** Linha de Permissão do Mapa Cadastro com só "editar" (a conta que renomeia depósitos). */
const MAPA_CADASTRO_EDITAR = {
  modulos_permitidos: ['mapa'],
  permissoes_telas: [{ modulo_id: 'mapa', tela_id: 'pec-mapa-cadastro', visualizar: true, novo: false, salvar: false, editar: true, excluir: false, importar: false, exportar: false }],
};
const corpoMovimento = (s, e, extra = {}) => ({
  empresa_id: e.id, tipo_movimentacao: 'Entrada', data_movimentacao: '2027-06-10T12:00:00.000Z', produto_id: e.sal.id,
  quantidade: 3, unidade_medida: 'KG', local_estoque_destino: s.local.id, ...extra,
});
const corpoLote = (s, e, extra = {}) => ({
  empresa_id: e.id, produto_id: e.sal.id, produto_nome: e.sal.nome_produto, local_estoque_id: s.local.id, local_estoque_nome: s.local.nome,
  numero_documento: 'NF-1', data_documento: '2027-06-01T00:00:00.000Z', custo_unitario: 2.5, quantidade_entrada: 100, quantidade_disponivel: 100, status: 'Disponivel', ...extra,
});
/** [status, code, details] da resposta (corpo JSON). */
const recusa = (r) => [r.statusCode, r.json().code, r.json().details];
const sequenciaDeMovimentos = (s) => prisma().entidadeCodigoSequencia.findFirst({ where: { cliente_id: s.c, entidade: 'MovimentacaoEstoque' } });

/** pids diretamente bloqueados por `pid`. */
const bloqueadosPor = async (pid) =>
  /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND ${pid}::int = ANY(pg_blocking_pids(pid))`).map((r) => r.pid);
/** Espera uma CONDIÇÃO observável (nunca um tempo fixo); estoura com rótulo. */
const esperar = async (cond, rotulo, ms = 15000) => {
  const limite = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > limite) throw new Error(`tempo esgotado esperando: ${rotulo}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};
/** Pedido HTTP acompanhado: sabe se já terminou e em quanto tempo. */
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
const DESFAZ = 'p0f3-desfaz-detentor';

// ─────────────────────────────────────────────────────────────────────────────
describe('D1–D2 — POST /movimentacoes-estoque não insere fato isolado', () => {
  test('D1: admin real, corpo válido (e forjado) → 409 ESTOQUE_ESCRITA_DIRETA_RECUSADA {entidade, operacao}; 0 movimentos, sequência e AuditLog intactos', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const antes = await foto([s.c]);
    const seqAntes = await sequenciaDeMovimentos(s);
    for (const corpo of [
      corpoMovimento(s, e),
      corpoMovimento(s, e, { numero_movimentacao: '99999' }),
      // forja do protocolo: origem do motor, fatias e saída FIFO
      corpoMovimento(s, e, { tipo_movimentacao: 'Saída', origem_sistema: 'operacao_financeira', lotes_consumidos: [{ lote_id: 'x', quantidade: '1.0000' }], local_estoque_origem: s.local.id }),
    ]) {
      const r = await A.req('POST', '/movimentacoes-estoque', s.token, corpo);
      assert.deepEqual(recusa(r), [409, RECUSA, { entidade: 'MovimentacaoEstoque', operacao: 'criar' }], r.body);
    }
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c } }), 0, 'nenhum movimento');
    assert.deepEqual(await sequenciaDeMovimentos(s), seqAntes, 'a sequência de movimentos do tenant não foi tocada');
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: s.c, entidade: 'MovimentacaoEstoque' } }), 0, 'nenhuma auditoria de movimento');
    assert.equal(await foto([s.c]), antes, 'nada gravado no tenant');
  });

  test('D1b: com a sequência de movimentos do tenant SEGURA por outra transação, o POST responde 409 na hora (não reserva nem espera número)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    /** @type {any} */
    let post;
    let bloqueado = false;
    await aux.$transaction(async (tx) => {
      const [{ pid }] = /** @type {any[]} */ (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`);
      // a MESMA trava que confirmar/cancelar e os comandos seguram no fim (D-PROD-155 §8.4)
      await reservarNumeros(tx, { clienteId: s.c, entidade: 'MovimentacaoEstoque', escopoTipo: ESCOPO_TENANT }, 1);
      post = acompanhar(A.req('POST', '/movimentacoes-estoque', s.token, corpoMovimento(s, e)));
      await esperar(async () => {
        if (post.feito) return true;
        bloqueado = bloqueado || (await bloqueadosPor(pid)).length > 0;
        return false;
      }, 'POST respondendo com a sequência segura', 12000);
      throw new Error(DESFAZ); // o detentor volta: a reserva dele não suja o tenant
    }, { maxWait: 10000, timeout: 60000 }).catch((erro) => { if (erro?.message !== DESFAZ) throw erro; });
    await post.p;
    assert.equal(bloqueado, false, 'o POST nunca esperou a sequência de movimentos');
    assert.deepEqual(recusa(post.r), [409, RECUSA, { entidade: 'MovimentacaoEstoque', operacao: 'criar' }], `${post.ms} ms ${post.r.body}`);
    assert.ok(post.ms < 3000, `recusa imediata, sem esperar a trava (${post.ms} ms)`);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c } }), 0);
  });

  test('D2: corpo vazio → 400 (schema); relação ou coluna desconhecida → 400 (colunas); is_admin e Mapa Cadastro → 403 (guarda); nada criado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const contas = [await s.conta({ is_admin: true }), await s.conta(MAPA_CADASTRO_EDITAR)];
    const antes = await foto([s.c]);
    const vazio = await A.req('POST', '/movimentacoes-estoque', s.token, {});
    assert.deepEqual([vazio.statusCode, codigo(vazio)], [400, 'REQUEST_VALIDATION_FAILED'], vazio.body);
    for (const extra of [{ itemFinanceiro: { connect: { id: 'qualquer' } } }, { coluna_que_nao_existe: 1 }]) {
      const r = await A.req('POST', '/movimentacoes-estoque', s.token, corpoMovimento(s, e, extra));
      assert.deepEqual([r.statusCode, codigo(r)], [400, 'REQUEST_VALIDATION_FAILED'], `${Object.keys(extra)}: ${r.body}`);
    }
    for (const conta of contas) {
      const r = await A.req('POST', '/movimentacoes-estoque', conta.token, corpoMovimento(s, e));
      assert.equal(r.statusCode, 403, r.body);
    }
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c } }), 0);
    assert.equal(await foto([s.c]), antes, 'nada gravado');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D3 — POST /estoque-lotes-nota não cria saldo sem fato', () => {
  test('admin real, corpo válido → 409 {entidade:EstoqueLoteNota, operacao:criar}; 0 lotes, estoque_atual igual; relação → 400; is_admin → 403', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const isAdmin = await s.conta({ is_admin: true });
    const antes = await foto([s.c]);
    const r = await A.req('POST', '/estoque-lotes-nota', s.token, corpoLote(s, e));
    assert.deepEqual(recusa(r), [409, RECUSA, { entidade: 'EstoqueLoteNota', operacao: 'criar' }], r.body);
    const rel = await A.req('POST', '/estoque-lotes-nota', s.token, corpoLote(s, e, { consumosFinanceiros: { connect: { id: 'x' } } }));
    assert.deepEqual([rel.statusCode, codigo(rel)], [400, 'REQUEST_VALIDATION_FAILED'], rel.body);
    const r403 = await A.req('POST', '/estoque-lotes-nota', isAdmin.token, corpoLote(s, e));
    assert.deepEqual([r403.statusCode, codigo(r403)], [403, 'TENANT_ADMIN_REQUIRED'], r403.body);
    assert.equal(await prisma().estoqueLoteNota.count({ where: { cliente_id: s.c } }), 0, 'nenhum lote');
    assert.equal((await prisma().produto.findUnique({ where: { id: e.sal.id } })).estoque_atual.toFixed(4), '0.0000');
    assert.equal(await foto([s.c]), antes, 'nada gravado');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D4 — PATCH de coluna operacional no lote', () => {
  test('lote LIVRE, admin real: cada coluna restrita → 409 {operacao:editar, campos}; nome correto JUNTO de coluna restrita também; nada gravado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const L = await loteLegado(s, e, e.sal, s.local, { kg: '10', custo: '2.0000' });
    const antes = await foto([s.c]);
    for (const [corpo, campos] of [
      [{ quantidade_disponivel: 12 }, ['quantidade_disponivel']],
      [{ quantidade_disponivel: 12, status: 'Disponivel' }, ['quantidade_disponivel', 'status']],
      [{ custo_unitario: 0.01 }, ['custo_unitario']],
      [{ quantidade_entrada: 999 }, ['quantidade_entrada']],
      [{ status: 'Esgotado' }, ['status']],
      [{ produto_id: e.milho.id }, ['produto_id']],
      [{ empresa_id: s.e2.id }, ['empresa_id']],
      [{ local_estoque_id: s.local2.id }, ['local_estoque_id']],
      [{ data_documento: '2001-03-05T00:00:00.000Z' }, ['data_documento']],
      [{ movimentacao_entrada_id: 'forjado' }, ['movimentacao_entrada_id']],
      // cliente antigo reenvia a empresa atual: ela não conta como restrita, o saldo sim
      [{ empresa_id: e.id, quantidade_disponivel: 12 }, ['quantidade_disponivel']],
      [{ local_estoque_nome: s.local.nome, custo_unitario: 9 }, ['custo_unitario']],
    ]) {
      const r = await A.req('PATCH', `/estoque-lotes-nota/${L.id}`, s.token, corpo);
      assert.deepEqual(recusa(r), [409, RECUSA, { entidade: 'EstoqueLoteNota', operacao: 'editar', campos }], `${JSON.stringify(corpo)}: ${r.body}`);
    }
    const lote = await prisma().estoqueLoteNota.findUnique({ where: { id: L.id } });
    assert.deepEqual([lote.quantidade_disponivel.toFixed(4), lote.custo_unitario.toFixed(4), lote.status], ['10.0000', '2.0000', 'Disponivel']);
    assert.equal(lote.updatedAt.getTime(), L.updatedAt.getTime(), 'o lote não foi tocado');
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: s.c, entidade: 'EstoqueLoteNota' } }), 0, 'nenhuma auditoria de lote');
    assert.equal(await foto([s.c]), antes, 'nada gravado');
  });

  test('a recusa vem DEPOIS da trava produto → lote: com o produto travado por outra transação o PATCH espera e, solta a trava, responde 409', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const L = await loteLegado(s, e, e.sal, s.local, { kg: '10' });
    /** @type {any} */
    let patch;
    await aux.$transaction(async (tx) => {
      const [{ pid }] = /** @type {any[]} */ (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`);
      await travarProdutosEstoque(tx, s.c, e.id, [e.sal.id]);
      patch = acompanhar(A.req('PATCH', `/estoque-lotes-nota/${L.id}`, s.token, { quantidade_disponivel: 12 }));
      await esperar(async () => patch.feito || (await bloqueadosPor(pid)).length > 0, 'PATCH chegando na trava do produto');
      assert.equal(patch.feito, false, `o PATCH restrito tinha de esperar a trava do produto: ${patch.r?.statusCode} ${patch.r?.body}`);
    }, { maxWait: 10000, timeout: 60000 });
    await patch.p;
    assert.deepEqual(recusa(patch.r), [409, RECUSA, { entidade: 'EstoqueLoteNota', operacao: 'editar', campos: ['quantidade_disponivel'] }], patch.r.body);
    assert.equal((await prisma().estoqueLoteNota.findUnique({ where: { id: L.id } })).quantidade_disponivel.toFixed(4), '10.0000');
  });

  test('is_admin sem ser admin real → 403 TENANT_ADMIN_REQUIRED; lote de compra → 409 REGISTRO_OPERACIONAL_IMUTAVEL (vínculo lancamento_financeiro); nada gravado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const livre = await loteLegado(s, e, e.sal, s.local, { kg: '10' });
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2')]));
    const daCompra = compra.itens[0].estoque_lote_nota_id;
    const isAdmin = await s.conta({ is_admin: true });
    const antes = await foto([s.c]);
    const r403 = await A.req('PATCH', `/estoque-lotes-nota/${livre.id}`, isAdmin.token, { quantidade_disponivel: 12 });
    assert.deepEqual([r403.statusCode, codigo(r403)], [403, 'TENANT_ADMIN_REQUIRED'], r403.body);
    const vinc = await A.req('PATCH', `/estoque-lotes-nota/${daCompra}`, s.token, { quantidade_disponivel: 12 });
    assert.deepEqual([vinc.statusCode, codigo(vinc), vinc.json().details?.vinculo], [409, 'REGISTRO_OPERACIONAL_IMUTAVEL', 'lancamento_financeiro'], vinc.body);
    assert.equal(await foto([s.c]), antes, 'nada gravado');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D5 — a renomeação benigna do local continua', () => {
  test('Mapa Cadastro editar: nome do LocalEstoque → 200 (lote livre e lote de compra); nome inventado → 422 NOME_LOCAL_DIVERGENTE; admin real reenviando a empresa atual → 200', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const livre = await loteLegado(s, e, e.sal, s.local, { kg: '10' });
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2')]));
    const daCompra = compra.itens[0].estoque_lote_nota_id;
    const mapa = await s.conta(MAPA_CADASTRO_EDITAR);
    const inventado = await A.req('PATCH', `/estoque-lotes-nota/${livre.id}`, mapa.token, { local_estoque_nome: 'NOME INVENTADO' });
    assert.deepEqual([inventado.statusCode, codigo(inventado)], [422, 'NOME_LOCAL_DIVERGENTE'], inventado.body);
    const nomeNovo = `DEPOSITO RENOMEADO ${s.c}`;
    await prisma().localEstoque.update({ where: { id: s.local.id }, data: { nome: nomeNovo } });
    for (const id of [livre.id, daCompra]) {
      const r = await A.req('PATCH', `/estoque-lotes-nota/${id}`, mapa.token, { local_estoque_nome: nomeNovo });
      assert.equal(r.statusCode, 200, r.body);
      const l = await prisma().estoqueLoteNota.findUnique({ where: { id } });
      assert.equal(l.local_estoque_nome, nomeNovo);
    }
    const eco = await A.req('PATCH', `/estoque-lotes-nota/${livre.id}`, s.token, { local_estoque_nome: nomeNovo, empresa_id: e.id });
    assert.equal(eco.statusCode, 200, eco.body);
    const l = await prisma().estoqueLoteNota.findUnique({ where: { id: livre.id } });
    assert.deepEqual([l.quantidade_disponivel.toFixed(4), l.status, l.empresa_id], ['10.0000', 'Disponivel', e.id], 'a renomeação não mexe no saldo');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D6 — DELETE de lote', () => {
  test('lote livre (com saldo e esgotado), admin real → 409 {operacao:excluir}; o lote continua lá; lote de compra → 409 REGISTRO_OPERACIONAL_IMUTAVEL; is_admin → 403', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const comSaldo = await loteLegado(s, e, e.sal, s.local, { kg: '10' });
    const esgotado = await loteLegado(s, e, e.sal, s.local2, { kg: '0', disponivel: '0', status: 'Esgotado' });
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2')]));
    const daCompra = compra.itens[0].estoque_lote_nota_id;
    const isAdmin = await s.conta({ is_admin: true });
    const antes = await foto([s.c]);
    for (const L of [comSaldo, esgotado]) {
      const r = await A.req('DELETE', `/estoque-lotes-nota/${L.id}`, s.token);
      assert.deepEqual(recusa(r), [409, RECUSA, { entidade: 'EstoqueLoteNota', operacao: 'excluir' }], r.body);
    }
    const vinc = await A.req('DELETE', `/estoque-lotes-nota/${daCompra}`, s.token);
    assert.deepEqual([vinc.statusCode, codigo(vinc), vinc.json().details?.vinculo], [409, 'REGISTRO_OPERACIONAL_IMUTAVEL', 'lancamento_financeiro'], vinc.body);
    const r403 = await A.req('DELETE', `/estoque-lotes-nota/${comSaldo.id}`, isAdmin.token);
    assert.equal(r403.statusCode, 403, r403.body);
    assert.equal(await prisma().estoqueLoteNota.count({ where: { id: { in: [comSaldo.id, esgotado.id, daCompra] } } }), 3, 'nenhum lote apagado');
    assert.equal(await foto([s.c]), antes, 'nada gravado');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D7–D8 — movimento: só a renomeação; leituras', () => {
  test('D7: PATCH {local_origem|local_destino: nome do local} → 200; DELETE → 409 MOVIMENTO_CANCELAMENTO_OBRIGATORIO', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2')]));
    const entrada = await prisma().movimentacaoEstoque.findFirst({ where: { cliente_id: s.c, lancamento_origem_id: compra.id } });
    // movimento de saída (fixture de banco, como o legado) com o local de origem
    const saida = await prisma().movimentacaoEstoque.create({
      data: {
        cliente_id: s.c, empresa_id: e.id, numero_movimentacao: '900001', tipo_movimentacao: 'Saída', data_movimentacao: new Date('2027-06-11T12:00:00.000Z'),
        produto_id: e.sal.id, quantidade: '1', unidade_medida: 'KG', local_estoque_origem: s.local.id, local_origem: 'NOME ANTIGO',
      },
    });
    const nomeNovo = `DEPOSITO RENOMEADO ${s.c}`;
    await prisma().localEstoque.update({ where: { id: s.local.id }, data: { nome: nomeNovo } });
    const mapa = await s.conta(MAPA_CADASTRO_EDITAR);
    const r1 = await A.req('PATCH', `/movimentacoes-estoque/${entrada.id}`, mapa.token, { local_destino: nomeNovo });
    assert.equal(r1.statusCode, 200, r1.body);
    const r2 = await A.req('PATCH', `/movimentacoes-estoque/${saida.id}`, mapa.token, { local_origem: nomeNovo });
    assert.equal(r2.statusCode, 200, r2.body);
    assert.deepEqual(
      [(await prisma().movimentacaoEstoque.findUnique({ where: { id: entrada.id } })).local_destino, (await prisma().movimentacaoEstoque.findUnique({ where: { id: saida.id } })).local_origem],
      [nomeNovo, nomeNovo],
    );
    const del = await A.req('DELETE', `/movimentacoes-estoque/${entrada.id}`, s.token);
    assert.deepEqual([del.statusCode, codigo(del)], [409, 'MOVIMENTO_CANCELAMENTO_OBRIGATORIO'], del.body);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c } }), 2);
  });

  test('D8: GET /movimentacoes-estoque, /estoque-lotes-nota e /estoque-lotes-nota/:id → 200 com as linhas do tenant', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2')]));
    const L = compra.itens[0].estoque_lote_nota_id;
    const movs = await A.ok(A.req('GET', '/movimentacoes-estoque', s.token));
    assert.equal(movs.length, 1);
    assert.equal(movs[0].lancamento_origem_id, compra.id);
    const lotes = await A.ok(A.req('GET', `/estoque-lotes-nota?empresa_id=${e.id}&produto_id=${e.sal.id}`, s.token));
    assert.deepEqual(lotes.map((l) => l.id), [L]);
    const um = await A.ok(A.req('GET', `/estoque-lotes-nota/${L}`, s.token));
    assert.equal(um.id, L);
  });
});
