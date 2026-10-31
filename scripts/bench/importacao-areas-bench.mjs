#!/usr/bin/env node
/**
 * Benchmark LOCAL da importação de áreas (D-PROD-90 R1). Não roda no CI.
 *
 * Uso (banco PostgreSQL descartável, NUNCA produção):
 *   DATABASE_URL=postgresql://.../maike_bench AUTH_SECRET=... FRONTEND_ORIGINS=http://localhost \
 *     node scripts/bench/importacao-areas-bench.mjs
 *
 * Mede, por cenário: leitura/validação no "navegador" (mesmo código do
 * assistente, em Node), conferência e gravação no servidor (Fastify inject +
 * PostgreSQL real) e memória do processo. Tempo de rede até o banco de
 * produção NÃO está aqui: ver o relatório para a estimativa por ida ao banco.
 */
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from '../../backend/tests/helpers.mjs';
import { lerArquivoDeAreas } from '../../src/lib/geografia/importacaoAreas.js';

const circulo = (i, n) => {
  const lat0 = -15.6 - Math.floor(i / 10) * 0.03;
  const lng0 = -56.1 + (i % 10) * 0.03;
  const r = 900; // metros
  const pts = [];
  for (let k = 0; k < n; k += 1) {
    const a = (2 * Math.PI * k) / n;
    pts.push([lng0 + (r / (111320 * Math.cos((lat0 * Math.PI) / 180))) * Math.cos(a), lat0 + (r / 110540) * Math.sin(a)]);
  }
  pts.push(pts[0]);
  return pts;
};

const geojson = (qtd, vertices) =>
  JSON.stringify({
    type: 'FeatureCollection',
    features: Array.from({ length: qtd }, (_, i) => ({
      type: 'Feature',
      properties: { name: `Area ${i + 1}` },
      geometry: { type: 'Polygon', coordinates: [circulo(i, vertices)] },
    })),
  });

const CENARIOS = [
  { nome: '10 áreas × 4 vértices', qtd: 10, v: 4 },
  { nome: '50 áreas × 4 vértices', qtd: 50, v: 4 },
  { nome: '100 áreas × 4 vértices', qtd: 100, v: 4 },
  { nome: '100 áreas × 500 vértices (50 mil)', qtd: 100, v: 500 },
  { nome: '10 áreas × 5000 vértices (50 mil, máx. por área)', qtd: 10, v: 5000 },
];

const mb = (b) => (b / 1024 / 1024).toFixed(0);

const main = async () => {
  const app = await criarApp();
  await app.ready();
  const linhas = [];
  for (const c of CENARIOS) {
    await limparBanco();
    const { credenciais } = await criarTenant();
    const { corpo } = await autenticarNoApp(app, credenciais);
    const h = { authorization: `Bearer ${corpo.token}` };
    const emp = (await app.inject({ method: 'POST', url: '/empresas', headers: h, payload: { apelido: 'B', nome: 'BENCH', tipo_pessoa: 'Jurídica' } })).json();
    const setor = (await app.inject({ method: 'POST', url: '/setores', headers: h, payload: { empresa_id: emp.id, nome: 'S', tipo: 'Próprio' } })).json();

    const texto = geojson(c.qtd, c.v);
    const t0 = performance.now();
    const lido = lerArquivoDeAreas({ nomeArquivo: 'bench.geojson', texto });
    const tLeitura = performance.now() - t0;
    if (!lido.ok || lido.contagem.areas !== c.qtd) throw new Error(`leitura falhou: ${JSON.stringify(lido.contagem ?? lido)}`);

    const itens = lido.itens.map((it) => ({
      ref: it.ref,
      nome: `AREA ${it.ref}`,
      setor_id: setor.id,
      tipo_cultura: 'Pastagem',
      tipo_pastagem: 'Marandu',
      area_pastejada: 1,
      aproveitamento_classificacao: 'Média',
      cor: '#f8f9fa',
      coords: it.vertices.map((p) => [p.lat, p.lng]),
    }));
    const payload = { empresa_id: emp.id, itens };
    const bytes = Buffer.byteLength(JSON.stringify({ operation_id: 'x'.repeat(40), ...payload }));

    const t1 = performance.now();
    const conf = await app.inject({ method: 'POST', url: '/areas-pastagem/importacao/conferir', headers: h, payload });
    const tConferir = performance.now() - t1;
    if (conf.statusCode !== 200 || conf.json().validas !== c.qtd) throw new Error(`conferir: ${conf.statusCode} ${conf.body.slice(0, 300)}`);

    const t2 = performance.now();
    const imp = await app.inject({ method: 'POST', url: '/areas-pastagem/importacao', headers: h, payload: { operation_id: `bench-${randomUUID()}`, ...payload } });
    const tImportar = performance.now() - t2;
    if (imp.statusCode !== 201) throw new Error(`importar: ${imp.statusCode} ${imp.body.slice(0, 300)}`);

    linhas.push({
      cenario: c.nome,
      corpo_kb: Math.round(bytes / 1024),
      leitura_navegador_ms: Math.round(tLeitura),
      conferir_ms: Math.round(tConferir),
      importar_ms: Math.round(tImportar),
      rss_mb: mb(process.memoryUsage().rss),
    });
  }
  console.table(linhas);
  console.log(JSON.stringify(linhas));
  await app.close();
  await encerrar();
};

main().catch(async (e) => {
  console.error(e);
  await encerrar();
  process.exit(1);
});
