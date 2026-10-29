# MAIKE — Escalabilidade: estado atual e roadmap

**Atualizado em:** 29/10/2026 · **Base verificada:** `main` `d6a49647348dc59152dc1e9b3fc857d46e525f1b`
**Relatório histórico (detalhes e números):** [`MAIKE-SCALE-01-USUARIOS-REPORT.md`](./MAIKE-SCALE-01-USUARIOS-REPORT.md)

> Legenda: **CONFIRMADO** = verificado no código/GitHub nesta data · **INFERÊNCIA** = conclusão
> a partir do código, sem teste específico · **NÃO VERIFICADO** = não foi possível conferir (diz
> como conferir).

---

## A. Resumo executivo

**Entregue (CONFIRMADO):** a tela **Usuários** deixou de baixar todas as contas da empresa de
uma vez. Agora ela pede ao servidor páginas de até 100 registros (máximo 500), e a busca roda no
servidor. Um índice novo no banco deixa essas páginas rápidas mesmo com muitos usuários. Foi
entregue também um script de medição (benchmark) com travas que impedem rodá-lo em produção ou
em banco remoto. Tudo foi integrado na `main` pela PR #140, com CI verde.

**Não comprovado:** o sistema **não** foi testado com 1 milhão de registros, nem com bilhões, nem
com milhares de usuários simultâneos em Vercel + Supabase. Os números que existem são de uma
máquina local e **não são garantia de produção**. A migration do índice **não é aplicada
automaticamente** no deploy da Vercel, e o estado do banco de produção não foi verificado aqui.

**Próximo passo recomendado:** antes de qualquer fatia nova, **decidir e executar (com backup)
a aplicação da migration do índice em produção**. Depois, seguir para a **SCALE-02**: corrigir o
helper de paginação compartilhado, que tem um defeito conhecido em todas as outras listas.

---

## B. SCALE-01 — estado confirmado

| Aspecto | Estado | Evidência |
|---|---|---|
| Endpoint paginado | `GET /usuarios/page` — CONFIRMADO | `backend/src/modules/usuarios/usuarioRoutes.js` |
| Ordem | `createdAt DESC, id DESC` (estável, com desempate por `id`) | `usuarioRepository.js` |
| Limite de página | padrão 100, mínimo 1, máximo 500; parâmetro desconhecido → 400 | `usuarioRoutes.js` (`LISTAR_PAGINA_SCHEMA`), `shared/pagination/keysetCursor.js` |
| Isolamento por empresa (tenant) | `cliente_id` vem só do token autenticado (`auth_context`); `cliente_id` na URL é recusado | `usuarioService.js` + testes US-PG-02/05 |
| Cursor | opaco (base64), inválido → 400; forma indexável `createdAt <= t AND (createdAt < t OR id < i)` | `usuarioRepository.js` |
| Busca `q` | no servidor, em `nome`/`login`, sem diferenciar maiúsculas; `%`, `_` e `\` tratados como texto literal | `escaparCuringasLike` em `usuarioRepository.js` |
| Contagem (`total`) | exata **só na 1ª página**; páginas seguintes devolvem `null` ("não calculado") | `usuarioService.js`; `src/apis/usuarios/usuariosApi.js` preserva o `null` |
| Campos expostos | `id, nome, login, ativo, created_date, updated_date` (sem senha, sem `cliente_id`) | teste US-PG-07 |
| Tela `/Usuarios` | usa o motor paginado `useCadastroBase1Controller` | `src/pages/Usuarios.jsx` |
| Endpoint legado | `GET /usuarios` **continua** devolvendo a lista completa (ver SCALE-04) | `usuarioRoutes.js` |
| Índice | `Usuario(cliente_id, createdAt, id)` | `backend/prisma/schema.prisma`; migration `20261029100000_scale01_usuario_keyset_index` |
| Benchmark local | `scripts/performance/usuarios-bench.mjs` + `benchGuard.mjs` + `benchEscopo.mjs` | travas de banco local, limpeza só da própria execução, exclusão mútua |

**Testes e CI (CONFIRMADO):**
- PR [#140](https://github.com/maikelimaadm-stack/MAIKE/pull/140) — **MERGED** em 29/10/2026 14:23 UTC
  (head `3701fa53`, merge `8f489416`).
- CI `quality / verify:all` do head da PR: [run 40890028778](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/40890028778) — SUCCESS.
- CI da `main` após o merge: [run 40891011505](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/40891011505) — SUCCESS.
- CI da `main` atual (`d6a49647`): [run 40911471492](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/40911471492) — SUCCESS.
- Suítes: `backend/tests/usuariosPaginacaoScale.test.mjs` (9), `backend/tests/usuariosBenchEscopo.test.mjs` (4),
  `scripts/tests/deploy/usuarios-bench-guard.test.mjs` (13), `tests/smoke/usuariosPaginacaoScale.test.jsx` (4),
  `tests/smoke/usuariosApiPagina.test.js` (3).

**Migration — onde está aplicada:**

| Ambiente | Estado |
|---|---|
| PostgreSQL local descartável (sessão de desenvolvimento) | aplicada (CONFIRMADO no relatório SCALE-01) |
| CI (banco efêmero de cada job) | aplicada a cada execução pelo `test:backend` (CONFIRMADO) |
| Staging | **NÃO VERIFICADO** — não há staging documentado no repositório |
| Produção (Supabase) | **NÃO VERIFICADO** — conferir só por leitura: `SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE migration_name LIKE '20261029100000%';` |

Importante (CONFIRMADO em `vercel.json`): o build da Vercel roda `npm run prisma:generate && npm run build`
— **sem `deploy:migrate`**. O merge na `main` **não** aplica a migration sozinho. A aplicação é manual,
com o runner `npm run deploy:migrate` e `MIGRATION_DATABASE_URL` (ver `scripts/deploy/run-migrations.mjs`).
INFERÊNCIA: sem o índice, `GET /usuarios/page` continua correto, só mais lento em empresas grandes.

**Limitações:** sugestões de busca enquanto se digita filtram só a página carregada (vem do motor
compartilhado); a busca aplicada (Enter) vai ao servidor. A exportação CSV exporta só o que está
carregado e avisa.

---

## C. Benchmarks e limites das evidências

Números do relatório SCALE-01. Medidos numa **máquina local** (4 núcleos, 15,7 GB, PostgreSQL 16
local, um único processo Node, cliente de carga na mesma máquina). **Não são metas (SLO) nem
garantia de produção.**

| 100.001 usuários numa empresa | Antes (lista completa) | Depois (página + índice) |
|---|---|---|
| Tamanho da resposta | ~21,7 MB | ~21,8 KB |
| Tempo p95 (10 acessos simultâneos) | ~19,6 s | página com cursor ~31 ms |
| Consulta da 1ª página no banco | ~50 ms (sem índice) | ~0,1 ms |

O que **não** foi comprovado (segundo o último relatório disponível):

| Item | Estado |
|---|---|
| 1 milhão de registros | **NOT_RUN** |
| 1 bilhão de registros | não simulado |
| Carga real em Vercel + Supabase / milhares de usuários simultâneos | não certificada |

Gargalos conhecidos:
- **Busca `ILIKE '%texto%'`**: ~170–220 ms no banco em 100k; com 100 buscas simultâneas, p95 ≈ 10,5 s e 3% de erro.
- **`COUNT` exato** na 1ª página e em cada busca: ~12–96 ms em 100k, dependente de estatísticas/VACUUM.
- **Endpoints que devolvem a lista completa** (ver SCALE-04).

---

## D. Próximas fatias (planejadas, **não implementadas**)

Ordem recomendada. Antes de todas: **aplicar a migration da SCALE-01 em produção** (decisão do
proprietário, backup confirmado, `deploy:migrate`, conferência por `SELECT`). Para tabela grande,
considerar `CREATE INDEX CONCURRENTLY` manual + `prisma migrate resolve --applied` (plano no relatório SCALE-01).

### SCALE-02 — Paginação compartilhada
Consumidores do helper `clausulaKeysetDesc` (CONFIRMADO em `main`): `marcas`, `produtos`, `setores`,
`unidadesMedida`, `locaisEstoque` (o módulo `usuarios` já usa a forma indexável própria).
- Trocar a forma `createdAt < t OR (createdAt = t AND id < i)` (o banco varre desde o topo até o cursor)
  pela forma indexável já provada na SCALE-01 (10,17 ms → 0,235 ms no meio de 100k).
- Escapar `%`, `_` e `\` nas buscas `contains` dessas listas (hoje só `usuarios` escapa — CONFIRMADO:
  `escaparCuringasLike` existe apenas em `usuarioRepository.js`). Sem isso, `q=%` traz tudo.
- Conferir se cada tabela tem índice `(cliente_id, createdAt, id)` (NÃO VERIFICADO tabela a tabela).
- Testes: ordem estável, empates de `createdAt`, sem duplicata/omissão, cursor inválido, isolamento por
  tenant, busca literal. Comparar plano/tempo antes e depois em banco descartável.
- Não tocar em módulos do mapa.

### SCALE-03 — Busca e contagem
- Medir `ILIKE` e `COUNT` por tabela com volumes realistas.
- Avaliar: `pg_trgm` (no teste local, busca seletiva 66 → 3 ms; pouco seletiva sem ganho), busca por
  prefixo, total opcional ou "10.000+", contagem assíncrona.
- Não instalar extensão nem mudar infraestrutura sem benchmark e revisão.

### SCALE-04 — Endpoints legados
Consumidores de `GET /usuarios` (lista completa) encontrados no frontend (CONFIRMADO):
- `src/pages/Permissoes.jsx` → `sessionService.listarUsuarios()`;
- `src/components/mapa/FormularioTarefaMapa.jsx` → `tarefasMapaService.listarUsuarios({ limit: 200 })` —
  o `limit` é **ignorado** pela função (`tarefasMapaService.js` não o repassa), então baixa todos;
- `src/services/usuarioAdminService.js` → `listarContasAcesso()` (mantido, sem uso pela tela Usuários).
- Planejar migração gradual (página ou endpoint específico, ex.: seletor com busca), sem quebrar
  contratos antes de mapear e testar cada consumidor. Outras entidades com `GET` completo além do
  `/page`: NÃO VERIFICADO — mapear na própria fatia.

### SCALE-05 — Capacidade real da infraestrutura
- Planejar testes progressivos em **staging dimensionado** (Vercel + Supabase), nunca em produção.
- Definir antes: cenários, volumes, metas de p95/p99, taxa de erro, concorrência, limite de conexões
  (pooler), observabilidade.
- 1 milhão só com autorização explícita, ambiente descartável e guardrails verificados.
- Não declarar suporte a 1 bilhão sem plano, custo e evidências.
- Validar rollout e estratégia de migration antes de qualquer mudança remota.

Por que esta ordem: SCALE-02 corrige um defeito já medido, que afeta 5 listas, com risco baixo e
sem infraestrutura nova. SCALE-03 depende de medições por tabela. SCALE-04 exige mapear contratos.
SCALE-05 exige ambiente e autorização que ainda não existem.

---

## E. Matriz de status

| Item | Status | Evidência | Risco | Próximo passo |
|---|---|---|---|---|
| Paginação de Usuários | CONCLUÍDO | PR #140, CI run 40890028778 | baixo | — |
| Índice/migration `Usuario` | PARCIAL | arquivo na `main`; local/CI aplicada; produção NÃO VERIFICADA | lentidão em empresas grandes até aplicar | aplicar com backup + conferir por `SELECT` |
| Guardrails do benchmark | CONCLUÍDO | `benchGuard.mjs`, `benchEscopo.mjs`, testes BG-01..13 e BE-01..04 | baixo (SIGKILL deixa resto local) | — |
| Helper de paginação compartilhado | PENDENTE | `clausulaKeysetDesc` usado por 5 módulos | varredura crescente em listas grandes | SCALE-02 |
| Escape de curingas nas outras buscas | PENDENTE | só `usuarios` escapa | `q=%` devolve tudo | SCALE-02 |
| Busca (`ILIKE`) | PENDENTE | relatório SCALE-01 | erros sob concorrência | SCALE-03 |
| Contagem (`COUNT`) | PARCIAL | Usuários conta só na 1ª página | custo por busca | SCALE-03 |
| Endpoints legados (`GET /usuarios` etc.) | PENDENTE | 3 consumidores mapeados | payload O(n) | SCALE-04 |
| Teste de 1 milhão | NÃO VERIFICADO (NOT_RUN) | relatório SCALE-01 | desconhecido | SCALE-05 com autorização |
| Escala de 1 bilhão | NÃO VERIFICADO | — | desconhecido | SCALE-05, com plano e custo |
| Teste Vercel + Supabase | NÃO VERIFICADO | — | desconhecido | SCALE-05 em staging |
| Deploy de produção com a PR #140 | NÃO VERIFICADO | acesso Vercel bloqueado (403 de escopo) nesta sessão | — | conferir no painel da Vercel |

---

## F. Critérios para declarar prontidão de escala

Não declarar o sistema "pronto para escala" até que **todos** estejam cumpridos:
1. Consultas e índices adequados em todas as listas grandes (SCALE-02/03).
2. Isolamento por tenant testado em cada endpoint paginado.
3. Limites de página e de tamanho de resposta em todos os endpoints de lista.
4. Endpoints legados de lista completa avaliados e migrados ou limitados (SCALE-04).
5. Testes de carga reproduzíveis, com metas (p95, p99, taxa de erro, concorrência) definidas **antes**.
6. Métricas de produção/staging visíveis (latência, erros, conexões do banco).
7. Plano seguro de migrations (backup, ordem, rollback/forward-fix) aplicado e conferido.
8. Resultados de staging dimensionado compatíveis com as metas.

---

## G. Como retomar em outra sessão

1. Ler este roadmap e o [relatório SCALE-01](./MAIKE-SCALE-01-USUARIOS-REPORT.md).
2. Conferir `main`, PRs abertas e o estado do worktree (`git status`); não confiar no histórico do chat.
3. Retomar pela próxima fatia pendente (hoje: aplicação da migration em produção, depois SCALE-02),
   sem colidir com outra missão (ex.: MapLibre).
4. Abrir PR separada somente se não houver outra PR aberta e sem risco de colisão de arquivos.
5. Nunca fazer merge sem auditoria independente e autorização manual do proprietário.
6. Benchmark só em PostgreSQL local descartável (`PERF_TEST_LOCAL=sim`); nunca em Supabase/Vercel.
