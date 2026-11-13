/**
 * MAIKE-ESTOQUE-P1-03 (D-PROD-185) — M7: índices EXPAND-ONLY. PostgreSQL real.
 *
 *  X1. catálogo: as duas definições EXATAS (pg_indexes), não-únicas, sem
 *      predicado, `cliente_id` primeiro (R10), sem índice duplicado (mesmas
 *      colunas, ordem, opções e predicado) nas duas tabelas;
 *  X2. keyset de MovimentacaoEstoque `(data_movimentacao DESC, id DESC)` com
 *      `empresa_id` obrigatória: páginas encadeadas pelo cursor (data, id)
 *      exclusivo cobrem exatamente a lista ordenada — sem linha repetida nem
 *      perdida —, com datas EMPATADAS, duas empresas e dois tenants (nenhuma
 *      linha de outro tenant ou empresa). Consulta de ensaio: não há rota (P1-04);
 *  X3. o índice keyset SERVE a consulta: com sort/seqscan desligados o plano é
 *      um Index Scan nele, com o cursor no `Index Cond` e sem nó de Sort;
 *  X4. LC-2: a leitura de recibos da reconciliação (tipo = ANY, intervalo de
 *      `createdAt`) usa o índice novo com `tipo_operacao` no `Index Cond`.
 *
 * RED: num banco sem a migration `20261113300000_estoque_p1_03_indices`, X1, X3
 * e X4 falham (índice ausente). O keyset (X2) é correto com ou sem índice — é a
 * prova da semântica que o índice tem de servir.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { montarTenant, prisma } from './gestaoP3Cenario.mjs';
import { entrar } from './estoqueP1MCenario.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
before(async () => {
  app = await criarApp();
  await app.ready();
  await limparBanco();
});
after(async () => {
  await app.close();
  await encerrar();
});

const KEYSET = 'MovimentacaoEstoque_keyset_empresa_idx';
const LC2 = 'OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx';
const ESPERADOS = Object.freeze({
  [KEYSET]: 'CREATE INDEX "MovimentacaoEstoque_keyset_empresa_idx" ON public."MovimentacaoEstoque" USING btree (cliente_id, empresa_id, data_movimentacao DESC, id DESC)',
  [LC2]: 'CREATE INDEX "OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx" ON public."OperacaoIdempotente" USING btree (cliente_id, tipo_operacao, "createdAt")',
});

/** Plano JSON (sem executar) de `sql` numa transação com os ajustes dados; desfaz tudo. */
const plano = async (sql, ajustes = []) => {
  /** @type {any} */
  let saida = null;
  await prisma().$transaction(async (tx) => {
    for (const a of ajustes) await tx.$executeRawUnsafe(`SET LOCAL ${a}`);
    const [linha] = /** @type {any[]} */ (await tx.$queryRaw(Prisma.sql`EXPLAIN (FORMAT JSON) ${sql}`));
    saida = linha['QUERY PLAN'][0].Plan;
  });
  return saida;
};
/** Todos os nós do plano, em profundidade. */
const nos = (p) => [p, ...(p.Plans ?? []).flatMap(nos)];

describe('X1 — catálogo', () => {
  test('definição exata, não-única, sem predicado, cliente_id primeiro; nenhum índice duplicado nas duas tabelas', async () => {
    const linhas = /** @type {any[]} */ (await prisma().$queryRaw`SELECT i.indexname, i.indexdef, x.indisunique, x.indpred IS NULL AS sem_predicado, x.indexprs IS NULL AS sem_expressao
      FROM pg_indexes i JOIN pg_class c ON c.relname = i.indexname JOIN pg_index x ON x.indexrelid = c.oid
      WHERE i.schemaname = 'public' AND i.indexname = ANY(${Object.keys(ESPERADOS)}::text[])`);
    const porNome = Object.fromEntries(linhas.map((l) => [l.indexname, l]));
    for (const [nome, def] of Object.entries(ESPERADOS)) {
      const l = porNome[nome];
      assert.ok(l, `índice ${nome} existe`);
      assert.equal(l.indexdef, def, `${nome}: colunas, ordem e direção exatas`);
      assert.deepEqual([l.indisunique, l.sem_predicado, l.sem_expressao], [false, true, true], `${nome}: comum, total, sem expressão`);
      assert.match(l.indexdef, /USING btree \(cliente_id, /, `${nome}: tenant primeiro (R10)`);
    }
    // Nenhum par de índices da mesma tabela com as MESMAS colunas, opções (ASC/DESC), expressões e predicado.
    const dup = /** @type {any[]} */ (await prisma().$queryRaw`SELECT t.relname, array_agg(c.relname ORDER BY c.relname) AS nomes
      FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid
      WHERE t.relname IN ('MovimentacaoEstoque', 'OperacaoIdempotente')
      GROUP BY t.relname, x.indkey::text, x.indoption::text, pg_get_expr(x.indexprs, x.indrelid), pg_get_expr(x.indpred, x.indrelid)
      HAVING count(*) > 1`);
    assert.deepEqual(dup, [], 'sem índice duplicado');
  });
});

/** Página do keyset (consulta de ensaio do P1-04): empresa obrigatória, cursor (data, id) exclusivo. */
const pagina = (cli, empresaId, cursor, n) => prisma().$queryRaw`SELECT id, cliente_id, empresa_id, data_movimentacao FROM "MovimentacaoEstoque"
  WHERE cliente_id = ${cli} AND empresa_id = ${empresaId}
  ${cursor ? Prisma.sql`AND (data_movimentacao, id) < (${cursor.data}::timestamp(3), ${cursor.id})` : Prisma.empty}
  ORDER BY data_movimentacao DESC, id DESC LIMIT ${n}::int`;

describe('X2 — keyset (data_movimentacao DESC, id DESC) com empresa obrigatória', () => {
  test('páginas encadeadas = lista ordenada inteira; datas empatadas; sem repetida nem perdida; nada de outra empresa ou tenant', async () => {
    const s = await montarTenant(app);
    const t = await montarTenant(app);
    // 3 dias, vários movimentos no MESMO instante (o motor grava o dia: empate de data_movimentacao).
    for (const dia of ['2027-06-08', '2027-06-09', '2027-06-10']) {
      for (let i = 0; i < 4; i += 1) await entrar(s, s.e1, s.e1.sal, { dia });
      await entrar(s, s.e2, s.e2.sal, { dia });
      await entrar(t, t.e1, t.e1.sal, { dia });
    }
    const completa = /** @type {any[]} */ (await prisma().$queryRaw`SELECT id, data_movimentacao FROM "MovimentacaoEstoque"
      WHERE cliente_id = ${s.c} AND empresa_id = ${s.e1.id} ORDER BY data_movimentacao DESC, id DESC`);
    assert.equal(completa.length, 12);
    const datas = new Set(completa.map((m) => m.data_movimentacao.toISOString()));
    assert.equal(datas.size, 3, 'há empates: 12 movimentos em 3 instantes');

    for (const n of [1, 3, 5, 12, 50]) {
      /** @type {any[]} */
      const vistos = [];
      let cursor = null;
      for (let voltas = 0; voltas < 100; voltas += 1) {
        const p = /** @type {any[]} */ (await pagina(s.c, s.e1.id, cursor, n));
        for (const m of p) assert.deepEqual([m.cliente_id, m.empresa_id], [s.c, s.e1.id], 'só o tenant e a empresa pedidos');
        vistos.push(...p);
        if (p.length < n) break;
        const ult = p[p.length - 1];
        cursor = { data: ult.data_movimentacao.toISOString(), id: ult.id };
      }
      assert.deepEqual(vistos.map((m) => m.id), completa.map((m) => m.id), `página de ${n}: mesma sequência, sem repetida nem perdida`);
      assert.equal(new Set(vistos.map((m) => m.id)).size, vistos.length, `página de ${n}: sem duplicata`);
    }
    // o cursor é EXCLUSIVO: a página depois da última linha é vazia, e a depois da 1ª não a repete
    const ult = completa[completa.length - 1];
    assert.deepEqual(await pagina(s.c, s.e1.id, { data: ult.data_movimentacao.toISOString(), id: ult.id }, 50), []);
    const prim = completa[0];
    const depois = /** @type {any[]} */ (await pagina(s.c, s.e1.id, { data: prim.data_movimentacao.toISOString(), id: prim.id }, 50));
    assert.deepEqual(depois.map((m) => m.id), completa.slice(1).map((m) => m.id));
    // outro tenant com o cursor e a empresa de s: nada (o filtro é cliente_id + empresa_id, sempre)
    assert.deepEqual(await pagina(t.c, s.e1.id, null, 50), []);
  });
});

describe('X3 — o índice keyset serve a consulta', () => {
  test('Index Scan no índice novo, cursor no Index Cond, sem Sort', async () => {
    const sql = Prisma.sql`SELECT id FROM "MovimentacaoEstoque" WHERE cliente_id = ${'c'} AND empresa_id = ${'e'}
      AND (data_movimentacao, id) < (${'2027-06-10T00:00:00.000Z'}::timestamp(3), ${'z'}) ORDER BY data_movimentacao DESC, id DESC LIMIT 50`;
    const p = await plano(sql, ['enable_seqscan = off', 'enable_bitmapscan = off', 'enable_sort = off', 'enable_incremental_sort = off']);
    const todos = nos(p);
    const scan = todos.find((x) => x['Index Name'] === KEYSET);
    assert.ok(scan, `o plano usa ${KEYSET}: ${JSON.stringify(todos.map((x) => [x['Node Type'], x['Index Name']]))}`);
    assert.equal(scan['Scan Direction'], 'Forward', 'DESC/DESC: varredura para frente');
    assert.match(scan['Index Cond'], /ROW\(data_movimentacao, id\) </, 'cursor resolvido no índice');
    assert.ok(!todos.some((x) => /Sort/.test(x['Node Type'])), 'a ordem vem do índice');
  });
});

describe('X4 — LC-2: recibos por tipo dentro do intervalo', () => {
  test('com recibos de outros tipos no intervalo, a leitura da reconciliação usa o índice novo (tipo no Index Cond, nada filtrado depois); sem ele, lia e descartava os de outro tipo', async () => {
    const s = await montarTenant(app);
    const tipos = ['saida_suplementacao', 'transferencia_locais'];
    const base = Date.parse('2027-06-01T00:00:00.000Z');
    // 3.000 recibos de OUTROS comandos e 20 dos dois tipos lidos pela reconciliação, todos no mesmo dia.
    const linhas = Array.from({ length: 3020 }, (_, i) => ({
      cliente_id: s.c, operation_key: `p103-${i}`, tipo_operacao: i < 20 ? tipos[i % 2] : `outro_comando_${i % 7}`,
      fingerprint: 'f', status: 'committed', response_json: { i }, createdAt: new Date(base + i * 1000),
    }));
    await prisma().operacaoIdempotente.createMany({ data: linhas });
    await prisma().$executeRawUnsafe('ANALYZE "OperacaoIdempotente"');
    const consulta = Prisma.sql`SELECT o."createdAt" FROM "OperacaoIdempotente" o
      WHERE o.cliente_id = ${s.c} AND o."createdAt" >= ${'2027-06-01T00:00:00.000Z'}::timestamp(3) AND o."createdAt" <= ${'2027-06-02T00:00:00.000Z'}::timestamp(3)
        AND o.tipo_operacao = ANY(${tipos}::text[]) AND o.status = 'committed' AND o.response_json IS NOT NULL`;
    /** EXPLAIN ANALYZE numa transação desfeita; `semIndice` remove o índice novo DENTRO dela (DDL transacional). */
    const medir = async (semIndice) => {
      /** @type {any} */
      let p = null;
      await prisma().$transaction(async (tx) => {
        if (semIndice) await tx.$executeRawUnsafe(`DROP INDEX "${LC2}"`);
        const [l] = /** @type {any[]} */ (await tx.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${consulta}`));
        p = l['QUERY PLAN'][0].Plan;
        throw new Error('desfaz');
      }).catch((x) => {
        if (x?.message !== 'desfaz') throw x;
      });
      return p;
    };
    const com = await medir(false);
    const scan = nos(com).find((x) => x['Index Name'] === LC2);
    assert.ok(scan, `o planejador escolhe ${LC2} sozinho: ${JSON.stringify(nos(com).map((x) => [x['Node Type'], x['Index Name']]))}`);
    assert.match(scan['Index Cond'], /tipo_operacao\)?(::text)? = ANY/, `o tipo é resolvido no índice: ${scan['Index Cond']}`);
    assert.match(scan['Index Cond'], /"createdAt" >=/, 'o intervalo também');
    assert.equal(com['Actual Rows'], 20);
    assert.equal(nos(com).reduce((t, x) => t + (x['Rows Removed by Filter'] ?? 0), 0), 0, 'com o índice novo nenhum recibo de outro tipo é lido e descartado');
    const sem = await medir(true);
    assert.equal(sem['Actual Rows'], 20, 'mesmo resultado sem o índice');
    assert.ok(!nos(sem).some((x) => x['Index Name'] === LC2));
    const descartados = nos(sem).reduce((t, x) => t + (x['Rows Removed by Filter'] ?? 0) + (x['Rows Removed by Index Recheck'] ?? 0), 0);
    assert.ok(descartados >= 3000 || nos(sem).some((x) => x['Node Type'] === 'Seq Scan'), `sem o índice novo os 3.000 de outro tipo são lidos (descartados: ${descartados})`);
    console.log(`# X4 medida local: com índice ${JSON.stringify({ linhas: com['Actual Rows'], buffers: com['Shared Hit Blocks'] + (com['Shared Read Blocks'] ?? 0) })}; sem índice ${JSON.stringify({ linhas: sem['Actual Rows'], descartados, buffers: sem['Shared Hit Blocks'] + (sem['Shared Read Blocks'] ?? 0), plano: nos(sem).map((x) => x['Node Type'] + (x['Index Name'] ? ':' + x['Index Name'] : '')) })}`);
  });
});

describe('X5 — preflight do release (somente leitura)', () => {
  test('o .sql do preflight roda numa transação READ ONLY e, no banco migrado, vê os 2 índices e a migration registrada', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(new URL('../../scripts/ops/sql-editor/estoque-p1-03-preflight-indices-somente-leitura.sql', import.meta.url), 'utf8');
    /** @type {any[]} */
    let linhas = [];
    let modo = '';
    await prisma().$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      linhas = await tx.$queryRawUnsafe(sql);
      modo = /** @type {any[]} */ (await tx.$queryRawUnsafe('SHOW transaction_read_only'))[0].transaction_read_only;
      throw new Error('desfaz');
    }).catch((x) => {
      if (x?.message !== 'desfaz') throw x;
    });
    assert.equal(modo, 'on');
    const v = Object.fromEntries(linhas.map((l) => [`${l.secao}.${l.item}`, l.valor]));
    assert.equal(v['indice.novos_ja_existem'], '2', 'no banco de teste a migration já foi aplicada');
    assert.equal(v['migration.p1_03_registrada'], '1');
    assert.equal(v['migration.falhadas_pendentes'], '0');
    assert.equal(v['veredito.estado'], 'JA_APLICADA', 'banco migrado: os 2 índices e a migration concluída');
    assert.equal(v['indice.invalidos_nas_2_tabelas'], '0');
    for (const chave of ['tabela.MovimentacaoEstoque.linhas_estimadas', 'tabela.OperacaoIdempotente.tamanho_heap', 'atividade.transacao_aberta_mais_antiga_s', 'config.lock_timeout']) {
      assert.ok(chave in v, `preflight traz ${chave}`);
    }
  });
});
