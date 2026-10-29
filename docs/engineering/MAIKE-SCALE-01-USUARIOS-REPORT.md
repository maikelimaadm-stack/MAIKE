# MAIKE-SCALE-01 — Usuários paginados + benchmark local isolado

**Data:** 29/10/2026 · **Branch:** `claude/new-session-abgn5w` · **Base:** `main` `e8540e7d` (pós-merge #139)
**Missão:** `MAIKE-SCALE-01-USUARIOS-PAGINACAO-E-BENCHMARK-ISOLADO` (+ R2 `MAIKE-SCALE-01-R2-BENCH-GUARDRAILS-CI-PR-DRAFT`) · **PR:** DRAFT aberta na R2 para rodar o CI

## 1. Problema (comprovado no código)

`/Usuarios` usava `useCadastroBase1FullListController` + `listarContasAcesso` → `GET /usuarios`,
que faz `findMany` sem `take` e devolve **o tenant inteiro**; o filtro rodava no navegador.
Medido localmente: 100 mil usuários = **21,7 MB por carregamento, p95 19,6 s, 0,66 req/s**.

## 2. Entrega

| Camada | Mudança |
|---|---|
| Backend | `GET /usuarios/page` (aditivo). Querystring estrita: `limit` 1–500 (padrão 100), `cursor` opaco ≤512, `q` ≤200, `ativo`. Qualquer outro parâmetro (ex.: `cliente_id`) → 400. Tenant só do `auth_context`. |
| Ordem | `createdAt DESC, id DESC`, `take: limit + 1`, cursor `keysetCursor.js`. Sem OFFSET. |
| Keyset indexável | `createdAt <= t AND (createdAt < t OR id < i)` (local em `usuarioRepository`). A forma do helper compartilhado (`OR`) vira só filtro e varre o índice desde o topo. |
| Busca `q` | `nome`/`login` contains case-insensitive, **curingas `%`, `_`, `\` escapados** (bug encontrado pelo teste: o `contains` do Prisma não escapa — `q=%` casava tudo). |
| Total | Contado **só na 1ª página** (sem cursor); páginas seguintes devolvem `total: null` = "não calculado nesta página" (nunca 0 nem estimativa). O motor Base1 lê o total da página 0. Na R2, `listUsuariosPage` preserva o `null` (o normalizador compartilhado o convertia em 0) — correção local, motor Base1 intocado. |
| Campos | Só `id, nome, login, ativo, created_date, updated_date`. Nunca `senha_hash`/`cliente_id`. |
| Índice | `Usuario(cliente_id, createdAt, id)` — migration aditiva `20261029100000_scale01_usuario_keyset_index`. Aplicada **apenas** em PostgreSQL local. |
| Legado | `GET /usuarios` **inalterado** (array completo, `createdAt ASC`) para Permissões/Mapa. |
| Frontend | `/Usuarios` passa a usar `useCadastroBase1Controller` (keyset) com `fetchPage → listarContasAcessoPagina`. Nenhum componente/hook compartilhado alterado. Query key `["contasAcesso", sessaoKey, "page", q, limit]`; invalidação existente (`["contasAcesso", sessaoKey]`) continua cobrindo. |
| CSV | Comportamento do motor: exporta **só a janela carregada** e avisa quando há mais no servidor. Sem full-fetch escondido. |

Arquivos: `backend/src/modules/usuarios/{usuarioRepository,usuarioService,usuarioRoutes}.js`,
`backend/prisma/schema.prisma` (+1 `@@index`), migration nova, `src/apis/usuarios/*`,
`src/services/usuarioAdminService.js`, `src/pages/Usuarios.jsx`, testes novos e
`scripts/performance/usuarios-bench.mjs`.

## 3. Testes

- `backend/tests/usuariosPaginacaoScale.test.mjs` (PostgreSQL 16 real, **9/9**): 401 sem token;
  cursor adulterado/limit 0, 501/`cliente_id` → 400; percorre 1.204 linhas com `limit` 100 e 500
  igual à ordem do banco, sem duplicata/omissão, com empates de `createdAt`; `limit=1`/padrão;
  inserção no meio da paginação; isolamento entre 2 tenants (inclusive cursor forjado de outro
  tenant e busca pelo prefixo do outro); `q` exato, por nome, `%`/`_`/`'`/`\` literais, só espaços;
  `ativo`; payload sem `senha_hash`; `GET /usuarios` legado; criar/desativar refletido.
- `tests/smoke/usuariosPaginacaoScale.test.jsx` (**4/4**): 1ª página só (Listados 100 / Totais 250,
  sem chamar o legado); "carregar mais" usa o `next_cursor`; busca aplicada vai ao servidor e acha
  conta fora da janela; troca de cliente não reaproveita cache do anterior.
- Smoke existentes `usuariosPermissoesSplit` e `r3PostPr96Bugfix` adaptados ao novo contrato
  (mock de `listarContasAcessoPagina` com envelope); a asserção estrutural agora exige o motor
  keyset e **proíbe** o full-list — mais forte que antes.

## 4. Benchmark local

**Tipo:** HTTP real (Fastify em `127.0.0.1`, `fetch` keep-alive, processo único) + `EXPLAIN (ANALYZE, BUFFERS)`.
Não é `inject`. **Ambiente:** Intel Xeon 2,8 GHz, 4 núcleos, 15,7 GB, Node 22.22, PostgreSQL 16.15
local, pool Prisma padrão. Cliente de carga na mesma máquina (compete por CPU).
**Dataset:** 1 tenant sintético por tamanho, `generate_series`, 7 linhas por segundo de `createdAt`
(empates), 10% inativos. **Método:** cada cenário isolado, 30 req de aquecimento, 300 req por nível,
concorrência 10/50/100. Busca `q=00004` (pouco seletiva: ~10% das linhas).

### Banco (EXPLAIN ANALYZE, ms)

| Usuários | Consulta | sem índice | com índice |
|---|---|---|---|
| 10.001 | 1ª página | 6,91 (Sort) | **0,11** (Index Scan) |
| 10.001 | página profunda | 5,17 | **0,12** |
| 100.001 | 1ª página | 49,88 (Gather Merge > Sort > Seq Scan) | **0,08** |
| 100.001 | página profunda (meio) | 52,83 | **0,10** |
| 100.001 | busca `ILIKE` | 222,65 | 167,88 |
| 100.001 | COUNT | 12,36 (Index Only Scan) | 96,43 (Seq Scan)* |

\* Variação de plano do COUNT logo após a carga (visibility map não atualizado sem VACUUM);
não é efeito do índice novo — ver riscos.

Forma do keyset (página no meio de 100 mil, com índice): `OR` do helper compartilhado
**10,17 ms / 50.001 linhas descartadas** → forma indexável **0,235 ms / 1 linha descartada**.

### HTTP 100.001 usuários — p50 / p95 / p99 (ms), req/s, erro

| Cenário | Conc. | sem índice | com índice |
|---|---|---|---|
| página profunda (cursor) | 10 | 296 / 513 / 547 · 30,8 rps | **23 / 31 / 126 · 383 rps** |
| página profunda (cursor) | 100 | 3.149 / 3.407 / 3.460 · 30,9 rps | **147 / 195 / 205 · 623 rps** |
| 1ª página + COUNT | 10 | 333 / 571 / 619 · 27,6 rps | 282 / 382 / 429 · 34,9 rps |
| 1ª página + COUNT | 100 | 3.760 / 4.142 / 4.254 · 26,2 rps | 2.054 / 2.305 / 2.342 · 45,6 rps |
| busca `q` | 10 | 1.215 / 1.450 / 1.549 · 8,1 rps | 1.121 / 1.309 / 1.371 · 8,9 rps |
| busca `q` | 100 | 10.268 / 10.547 / 10.594 · **14% erro** | 10.197 / 10.539 / 10.581 · **3% erro** |
| **legado `GET /usuarios`** | 10 | 14.247 / 19.562 / 19.942 · 0,66 rps · **21,7 MB/resp** | — |

Payload da página: ~21,8 KB (100 itens) em todos os tamanhos. Erros só na busca com 100
conexões simultâneas (timeout de pool sob fila de `ILIKE`).

1.001 e 10.001 usuários: todos os cenários de página p95 < 350 ms em c100 com índice; legado em
10k já é 2,1 MB / p95 1,45 s. JSON completo gerado por `usuarios-bench.mjs` (não versionado).

**NOT_RUN:** 1 milhão (interrompido por tempo nesta sessão); 1 bilhão (não simulado). Nenhum teste
de carga externo.

### Experimento (não incluído no código): `pg_trgm`

GIN trigram em `nome`/`login`, 100 mil: busca seletiva (11 hits) **66 → 3 ms**; busca pouco seletiva
continua ~227 ms (o planner prefere o índice de ordenação). Exige `CREATE EXTENSION` — decisão de
infraestrutura, fica para slice próprio.

## 5. Leitura honesta

- **Resolvido:** a tela não baixa mais o tenant; a navegação keyset tem custo de banco constante
  (~0,1 ms) de 1k a 100k e escala com concorrência (623 req/s em c100, processo único).
- **Ainda caro:** COUNT da 1ª página (~12–96 ms em 100k) e busca `ILIKE '%q%'` (~170–220 ms + COUNT
  ~200 ms). Com 100 buscas simultâneas o pool satura e aparecem erros. Nada disso é SLO certificado:
  os números valem para esta máquina, um processo Node e PostgreSQL local.
- Capacidade de usuários simultâneos em Vercel + Supabase **não foi medida** e exige staging dimensionado.

## 6. Riscos / dívidas

1. Busca `ILIKE '%q%'` sem índice adequado (trigram ou busca por prefixo) — principal gargalo.
2. COUNT exato a cada 1ª página/busca: avaliar total opcional/assíncrono ou limite "10.000+".
3. Plano do COUNT sensível a VACUUM/estatísticas (Seq Scan vs Index Only Scan).
4. `GET /usuarios` legado continua O(n) para Permissões/Mapa — requer fatia própria.
5. Sugestões de busca do motor Base1 filtram só a janela carregada (hook compartilhado); a busca
   aplicada (Enter) é que vai ao servidor.
6. O helper compartilhado `clausulaKeysetDesc` tem o mesmo defeito de varredura em todas as listas
   (Marcas, Produtos, Unidades…) — correção proposta para um slice dedicado.
7. Migration em produção: preferir `CREATE INDEX CONCURRENTLY` em janela própria; não aplicada.

## 7. Próximo slice recomendado

Corrigir `clausulaKeysetDesc` (forma indexável) + escape de curingas `contains` nas demais listas
keyset, com os mesmos testes de ordem/tenant e o benchmark reaproveitado.

## 8. Produção

0 writes em Supabase/Vercel/Storage, 0 migrations aplicadas fora do PostgreSQL local, 0 testes de
carga externos.

---

# R2 — guardrails do benchmark, contrato `total` e CI

## Bug P0 corrigido: benchmark validava um banco e conectava em outro

`backend/src/config/env.js` resolve a URL do Prisma como
`POSTGRES_PRISMA_URL ?? DATABASE_URL ?? POSTGRES_URL` (depois de `dotenv`). O script R1 validava
só `DATABASE_URL`. **Reproduzido** com o script do commit `7b1907b`: `DATABASE_URL=…/maike_perf`
(validado) + `POSTGRES_PRISMA_URL=…/maike_vitima` (banco local vazio criado para a prova) →
o Prisma conectou em `maike_vitima` (`The table public.Cliente does not exist`). Contra um
`POSTGRES_PRISMA_URL` real de produção, o mesmo caminho faria `INSERT`/`DELETE`/`DROP INDEX` lá.

**Correção** (`scripts/performance/benchGuard.mjs`, função pura, + preflight do script):

1. carrega o `.env` com o mesmo `dotenv` do backend **antes** de validar (aliases do `.env` contam);
2. exige `PERF_TEST_LOCAL=sim`, `DATABASE_URL` explícita, local (`localhost`/`127.0.0.1`/`::1`),
   PostgreSQL, sem provedor remoto, sem `host=`/`pgbouncer` na query, porta ≠ 6543, banco com
   `perf`/`test` no nome; `NODE_ENV≠production` (processo ou `.env`);
3. qualquer alias presente — `POSTGRES_PRISMA_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`,
   `MIGRATION_DATABASE_URL`, `DIRECT_URL` — precisa ser **idêntico** a `DATABASE_URL`; a URL
   efetiva calculada com a precedência do backend precisa ser a aprovada;
4. só então importa `backend/src/config/env.js` e confere `env.databaseUrl === aprovada` e
   `env.nodeEnv ≠ production`; só então importa Prisma;
5. com a conexão aberta e **antes de qualquer mutação**: `current_database()` = aprovado,
   `inet_server_addr()` loopback ou socket, nenhuma role Supabase (`supabase_admin`,
   `authenticator`, `supabase_auth_admin`);
6. logs mostram só `protocolo://host:porta/banco` — nunca usuário/senha.

**Limitação explícita:** `localhost` não prova ausência de túnel/port-forward para um banco
remoto; a checagem de identidade reduz, não elimina, esse risco. Use apenas PostgreSQL
descartável de fato.

**Testes negativos** `scripts/tests/deploy/usuarios-bench-guard.test.mjs` (rodam no `test:gates`
da CI, **sem banco**): script real em processo filho, ambiente limpo, `.env` de fixture em
diretório temporário, `PERF_GUARD_TRACE=1`. Cada caso exige exit 2, `RECUSADO`, ausência dos
marcadores `ENV_OK`/`IMPORT_PRISMA` (recusa antes de importar Prisma) e nenhuma credencial no log:
BG-01 sem opt-in · BG-02 remoto direto/pooler · **BG-03 `POSTGRES_PRISMA_URL` remoto no processo**
· **BG-04 o mesmo só no `.env`** · BG-05 `POSTGRES_URL` (processo/.env) · BG-06
`MIGRATION_DATABASE_URL`/`DIRECT_URL` diferentes · BG-07 `NODE_ENV=production` (processo/.env)
· BG-08 porta 6543 e banco não descartável · BG-09 sem `DATABASE_URL`; BG-10..12 função pura
(aceite local, precedência, IP/`host=`/`pgbouncer`/mysql, identidade). **12/12.**

## Estado do índice preservado

Antes: a R1 criava o índice se ausente e o recriava ao fim — deixava índice novo num banco onde
ele não existia. Agora `restaurarIndice()` devolve ao estado de **origem** em sucesso, exceção e
`SIGINT`/`SIGTERM`. Provado no PostgreSQL local:

| Caso | antes | depois |
|---|---|---|
| origem presente, execução completa | 1 | 1 |
| origem ausente, execução completa | 0 | 0 |
| `SIGINT` durante a fase sem índice (100k) | 0 (no meio) | 1, tenants `perf-*` = 0, exit 130 |

Risco residual: `SIGKILL`/queda entre `DROP` e `CREATE` deixa o banco local sem o índice; o
script imprime o comando de recuperação (`CREATE INDEX IF NOT EXISTS …`) no início.

## Números

Os números da seção 4 são da R1 (mesma metodologia e mesmo código de consulta). Na R2 o script
foi reexecutado só em 1k para provar guard/identidade/índice. **1M: NOT_RUN.** Bilhão: fora do
escopo.

## Rollout futuro do índice (não executado)

O runner `deploy:migrate` chama `prisma migrate deploy`, que no PostgreSQL executa o arquivo da
migration dentro de transação; `CREATE INDEX CONCURRENTLY` não roda em bloco de transação
(comportamento a confirmar no ensaio do rollout), então a migration versionada fica como está. Plano: (1) medir tamanho real de
`Usuario` em produção; (2) com volume pequeno, a migration normal (bloqueio curto de escrita) é
aceitável na janela de deploy; (3) com volume grande, criar antes manualmente
`CREATE INDEX CONCURRENTLY IF NOT EXISTS "Usuario_cliente_id_createdAt_id_idx" …` e marcar a
migration como aplicada (`prisma migrate resolve --applied`) — decisão e backup do proprietário.
