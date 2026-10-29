#!/usr/bin/env node
/**
 * SCALE-01 — benchmark LOCAL de `GET /usuarios/page` vs `GET /usuarios` (legado).
 *
 * Só roda contra PostgreSQL comprovadamente local e descartável:
 *   PERF_TEST_LOCAL=sim
 *   DATABASE_URL=postgresql://…@localhost|127.0.0.1|::1/<banco com "perf" ou "test" no nome>
 * Qualquer outro host (Supabase, Vercel, pooler, IP remoto), NODE_ENV=production
 * ou ausência do opt-in → falha dura, sem tocar no banco.
 *
 * O que faz, por tamanho de dataset (default 1000,10000,100000 usuários num
 * único tenant sintético `perf-scale01-*`):
 *   1. semeia via `generate_series` (dados artificiais, sem dado pessoal);
 *   2. EXPLAIN (ANALYZE, BUFFERS) da query paginada (1ª página, página
 *      profunda via cursor, busca `q`) e do COUNT — SQL equivalente ao Prisma;
 *   3. sobe o Fastify REAL numa porta local e mede HTTP de verdade
 *      (fetch + keep-alive): p50/p95/p99, throughput, erros, payload, nas
 *      concorrências PERF_CONCORRENCIAS (default 10,50,100);
 *   4. repete 2–3 SEM o índice `Usuario_cliente_id_createdAt_id_idx`
 *      (DROP/CREATE só neste banco local) para o comparativo antes/depois.
 * Limpeza: remove apenas os tenants `perf-scale01-*` que ele mesmo criou.
 *
 * Saída: JSON em PERF_SAIDA (default stdout) + resumo legível no stderr.
 */

import os from 'node:os';
import { performance } from 'node:perf_hooks';

const falhar = (msg) => {
  console.error(`usuarios-bench: RECUSADO — ${msg}`);
  process.exit(2);
};

// ---------------------------------------------------------------- guardrails
if (process.env.PERF_TEST_LOCAL !== 'sim') falhar('defina PERF_TEST_LOCAL=sim (opt-in explícito).');
if (process.env.NODE_ENV === 'production') falhar('NODE_ENV=production.');
const urlBruta = process.env.DATABASE_URL || '';
let url;
try {
  url = new URL(urlBruta);
} catch {
  falhar('DATABASE_URL ausente ou inválida.');
}
const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
if (!['postgresql:', 'postgres:'].includes(url.protocol)) falhar('DATABASE_URL não é PostgreSQL.');
if (!HOSTS_LOCAIS.has(url.hostname)) falhar(`host "${url.hostname}" não é local.`);
if (/supabase|vercel|pooler|neon|rds|amazonaws/i.test(urlBruta)) falhar('URL com provedor remoto.');
if (url.port === '6543') falhar('porta 6543 (pooler) recusada.');
const banco = url.pathname.replace(/^\//, '');
if (!/perf|test/i.test(banco)) falhar(`banco "${banco}" não tem "perf"/"test" no nome.`);
for (const v of ['MIGRATION_DATABASE_URL', 'DIRECT_URL']) {
  const outro = process.env[v];
  if (outro && outro !== urlBruta) falhar(`${v} difere de DATABASE_URL — ambiente ambíguo.`);
}
process.env.AUTH_SECRET ||= 'perf-local-efemero';
process.env.FRONTEND_ORIGINS ||= 'http://localhost:5173';

// ---------------------------------------------------------------- parâmetros
const lista = (v, d) => (v || d).split(',').map((x) => Number(x.trim())).filter((n) => n > 0);
const TAMANHOS = lista(process.env.PERF_TAMANHOS, '1000,10000,100000');
const CONCORRENCIAS = lista(process.env.PERF_CONCORRENCIAS, '10,50,100');
const REQS_POR_NIVEL = Number(process.env.PERF_REQS || 400);
const LEGADO_ATE = Number(process.env.PERF_LEGADO_ATE || 100000);
const PREFIXO = 'perf-scale01-';
const INDICE = 'Usuario_cliente_id_createdAt_id_idx';

const { getPrismaClient, closePrismaClient } = await import('../../backend/src/database/prismaClient.js');
const { construirApp } = await import('../../backend/src/app.js');
const { gerarSenhaHash } = await import('../../backend/src/modules/auth/authService.js');
const { codificarCursor } = await import('../../backend/src/shared/pagination/keysetCursor.js');

const prisma = getPrismaClient();
const percentil = (ordenado, p) =>
  ordenado.length ? ordenado[Math.min(ordenado.length - 1, Math.ceil((p / 100) * ordenado.length) - 1)] : null;
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

const limparPerf = async () => {
  const clientes = await prisma.cliente.findMany({ where: { codigo: { startsWith: PREFIXO } }, select: { id: true } });
  const ids = clientes.map((c) => c.id);
  if (!ids.length) return;
  await prisma.auditLog.deleteMany({ where: { cliente_id: { in: ids } } });
  await prisma.usuario.deleteMany({ where: { cliente_id: { in: ids } } });
  await prisma.cliente.deleteMany({ where: { id: { in: ids } } });
};

const semear = async (n) => {
  const codigo = `${PREFIXO}${n}-${Date.now()}`;
  const cliente = await prisma.cliente.create({ data: { codigo, nome: `Perf ${n}` } });
  const senha = 'perf-senha-local-1';
  const operador = await prisma.usuario.create({
    data: { cliente_id: cliente.id, nome: 'Operador Perf', login: `${codigo}.op`, senha_hash: await gerarSenhaHash(senha) },
  });
  const t0 = performance.now();
  const LOTE = 50000;
  for (let ini = 1; ini <= n; ini += LOTE) {
    const fim = Math.min(n, ini + LOTE - 1);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Usuario" (id, cliente_id, nome, login, senha_hash, ativo, "createdAt", "updatedAt")
       SELECT 'perf' || md5($1 || g::text), $1, 'Sintetico ' || lpad(g::text, 8, '0'),
              $2 || '.s' || g::text, 'sintetico-sem-login', (g % 10) <> 0,
              timestamp '2026-01-01' + (g / 7) * interval '1 second', now()
       FROM generate_series($3::int, $4::int) g`,
      cliente.id,
      codigo,
      ini,
      fim
    );
  }
  await prisma.$executeRawUnsafe('ANALYZE "Usuario"');
  return { cliente, operador, login: `${codigo}.op`, senha, seedMs: performance.now() - t0 };
};

// SQL equivalente ao que o Prisma gera para listarUsuariosPagina/contarUsuarios.
const SQL_PAGINA = `SELECT id, cliente_id, nome, login, ativo, "createdAt", "updatedAt" FROM "Usuario"
  WHERE cliente_id = $1 ORDER BY "createdAt" DESC, id DESC LIMIT 101`;
// Mesma forma de clausulaKeysetDescIndexavel (usuarioRepository).
const SQL_PAGINA_CURSOR = `SELECT id, cliente_id, nome, login, ativo, "createdAt", "updatedAt" FROM "Usuario"
  WHERE cliente_id = $1 AND "createdAt" <= $2 AND ("createdAt" < $2 OR id < $3)
  ORDER BY "createdAt" DESC, id DESC LIMIT 101`;
const SQL_BUSCA = `SELECT id, cliente_id, nome, login, ativo, "createdAt", "updatedAt" FROM "Usuario"
  WHERE cliente_id = $1 AND (nome ILIKE $2 OR login ILIKE $2)
  ORDER BY "createdAt" DESC, id DESC LIMIT 101`;
const SQL_COUNT = `SELECT count(*) FROM "Usuario" WHERE cliente_id = $1`;
const SQL_COUNT_BUSCA = `SELECT count(*) FROM "Usuario" WHERE cliente_id = $1 AND (nome ILIKE $2 OR login ILIKE $2)`;

const explicar = async (sql, params) => {
  const linhas = await prisma.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, ...params);
  const plano = /** @type {any} */ (linhas)[0]['QUERY PLAN'][0];
  const nos = [];
  const andar = (n) => {
    nos.push(n['Index Name'] ? `${n['Node Type']}(${n['Index Name']})` : n['Node Type']);
    (n.Plans || []).forEach(andar);
  };
  andar(plano.Plan);
  return { execMs: r2(plano['Execution Time']), planejamentoMs: r2(plano['Planning Time']), nos: nos.join(' > ') };
};

const planos = async (clienteId, n) => {
  const meio = await prisma.usuario.findFirst({
    where: { cliente_id: clienteId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: Math.floor(n / 2),
    select: { createdAt: true, id: true },
  });
  return {
    pagina1: await explicar(SQL_PAGINA, [clienteId]),
    paginaProfunda: meio ? await explicar(SQL_PAGINA_CURSOR, [clienteId, meio.createdAt, meio.id]) : null,
    busca: await explicar(SQL_BUSCA, [clienteId, '%00004%']),
    count: await explicar(SQL_COUNT, [clienteId]),
    countBusca: await explicar(SQL_COUNT_BUSCA, [clienteId, '%00004%']),
  };
};

const carga = async (base, token, { concorrencia, total, rotas }) => {
  const lat = [];
  let erros = 0;
  let bytes = 0;
  let proximo = 0;
  const t0 = performance.now();
  const trabalhador = async () => {
    for (;;) {
      const i = proximo++;
      if (i >= total) return;
      const rota = rotas[i % rotas.length];
      const ini = performance.now();
      try {
        const r = await fetch(`${base}${rota}`, { headers: { authorization: `Bearer ${token}` } });
        const corpo = await r.arrayBuffer();
        bytes += corpo.byteLength;
        if (r.status !== 200) erros += 1;
      } catch {
        erros += 1;
      }
      const ms = performance.now() - ini;
      lat.push(ms);
    }
  };
  await Promise.all(Array.from({ length: concorrencia }, trabalhador));
  const dur = performance.now() - t0;
  lat.sort((a, b) => a - b);
  return {
    concorrencia,
    requisicoes: total,
    p50: r2(percentil(lat, 50)),
    p95: r2(percentil(lat, 95)),
    p99: r2(percentil(lat, 99)),
    max: r2(lat[lat.length - 1]),
    rps: r2((total / dur) * 1000),
    erroPct: r2((erros / total) * 100),
    payloadMedioKB: r2(bytes / total / 1024),
  };
};

const indiceExiste = async () =>
  Number(
    /** @type {any} */ (
      await prisma.$queryRawUnsafe(`SELECT count(*)::int AS c FROM pg_indexes WHERE indexname = $1`, INDICE)
    )[0].c
  ) > 0;

// ---------------------------------------------------------------- execução
const resultado = {
  ambiente: {
    cpu: os.cpus()[0]?.model,
    nucleos: os.cpus().length,
    memoriaGB: r2(os.totalmem() / 1024 ** 3),
    node: process.version,
    postgres: /** @type {any} */ (await prisma.$queryRawUnsafe('SHOW server_version'))[0].server_version,
    banco,
    host: url.hostname,
    tipoMedicao: 'HTTP real (Fastify em 127.0.0.1, fetch keep-alive) + EXPLAIN ANALYZE local',
  },
  parametros: { TAMANHOS, CONCORRENCIAS, REQS_POR_NIVEL, LEGADO_ATE },
  datasets: [],
};

const indiceNaOrigem = await indiceExiste();
const app = await construirApp({ logger: false });
await app.listen({ host: '127.0.0.1', port: 0 });
const base = `http://127.0.0.1:${/** @type {any} */ (app.server.address()).port}`;

try {
  await limparPerf();
  for (const n of TAMANHOS) {
    const s = await semear(n);
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: s.login, senha: s.senha }),
    });
    const { token } = await login.json();
    if (!token) throw new Error(`login falhou (${login.status})`);

    // Cursor do meio do dataset para simular página profunda via HTTP.
    const meio = await prisma.usuario.findFirst({
      where: { cliente_id: s.cliente.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: Math.floor(n / 2),
      select: { createdAt: true, id: true },
    });
    // Cada cenário é medido ISOLADO (misturar rotas faz as lentas enfileirarem
    // as rápidas no pool e mascara o custo de cada uma), com aquecimento.
    const CENARIOS = {
      pagina1_com_count: '/usuarios/page?limit=100',
      pagina_profunda_cursor: `/usuarios/page?limit=100&cursor=${encodeURIComponent(codificarCursor(meio))}`,
      busca_q_ilike: '/usuarios/page?limit=100&q=00004',
    };

    const fase = async (rotulo) => {
      const p = await planos(s.cliente.id, n);
      /** @type {Record<string, unknown[]>} */
      const http = {};
      for (const [nome, rota] of Object.entries(CENARIOS)) {
        await carga(base, token, { concorrencia: 5, total: 30, rotas: [rota] }); // aquecimento
        http[nome] = [];
        for (const c of CONCORRENCIAS) {
          http[nome].push(await carga(base, token, { concorrencia: c, total: REQS_POR_NIVEL, rotas: [rota] }));
        }
      }
      return { rotulo, planos: p, http };
    };

    const ds = { usuarios: n + 1, seedMs: r2(s.seedMs), fases: [] };
    if (!(await indiceExiste())) {
      await prisma.$executeRawUnsafe(`CREATE INDEX "${INDICE}" ON "Usuario" (cliente_id, "createdAt", id)`);
    }
    ds.fases.push(await fase('com_indice'));
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${INDICE}"`);
    await prisma.$executeRawUnsafe('ANALYZE "Usuario"');
    ds.fases.push(await fase('sem_indice'));
    await prisma.$executeRawUnsafe(`CREATE INDEX "${INDICE}" ON "Usuario" (cliente_id, "createdAt", id)`);
    await prisma.$executeRawUnsafe('ANALYZE "Usuario"');

    // Baseline da tela antiga: GET /usuarios devolve o tenant inteiro.
    if (n <= LEGADO_ATE) {
      ds.legadoListaCompleta = await carga(base, token, {
        concorrencia: 10,
        total: Math.min(50, REQS_POR_NIVEL),
        rotas: ['/usuarios'],
      });
    }
    resultado.datasets.push(ds);
    console.error(
      `[${n + 1} usuários] seed ${r2(s.seedMs)}ms | ` +
        ds.fases
          .map((f) => `${f.rotulo}: ` +
            Object.entries(f.http)
              .map(([nome, niveis]) => `${nome}[${niveis.map((h) => `c${h.concorrencia} p95=${h.p95}`).join(' ')}]`)
              .join(' '))
          .join(' || ') +
        (ds.legadoListaCompleta
          ? ` || legado c10 p95=${ds.legadoListaCompleta.p95}ms ${ds.legadoListaCompleta.payloadMedioKB}KB`
          : '')
    );
    await limparPerf();
  }
} finally {
  await app.close();
  if (indiceNaOrigem && !(await indiceExiste())) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "${INDICE}" ON "Usuario" (cliente_id, "createdAt", id)`);
  }
  await limparPerf();
  await closePrismaClient();
}

const saida = JSON.stringify(resultado, null, 2);
if (process.env.PERF_SAIDA) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.PERF_SAIDA, saida);
} else {
  process.stdout.write(`${saida}\n`);
}
