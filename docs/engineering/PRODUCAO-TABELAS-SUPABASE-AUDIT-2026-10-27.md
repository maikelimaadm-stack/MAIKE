# Auditoria Supabase MAIKE — tabelas e migrations (2026-10-27)

**Missão:** `cursor/producao-tabelas-completas-516d`  
**Projeto Supabase:** MAIKE (`uuemcasqcdjucflulkne`, sa-east-1)  
**Referência schema:** `backend/prisma/schema.prisma` @ `main` `f25ec332`

## Resumo

| Área | Resultado |
|------|-----------|
| Tabelas vs models Prisma (10 models) | **OK** — todas presentes em `public` |
| `_prisma_migrations` | **6/6** — nomes alinhados ao repositório |
| Índices (`gate:indices`) | **OK** — inclui `Usuario_login_ativo_global_key` (P6.1) |
| FKs compostas (AreaPastagem, AuditLog) | **OK** |
| Dados de domínio | **Vazios** (esperado); bootstrap **já aplicado** (1 `Cliente`, 1 `Usuario`) |
| DDL / `apply_migration` | **Não necessário** — nenhuma migration pendente |
| Vercel env (MCP) | **Bloqueado** — token do agente não enxerga o projeto que serve `maike-five.vercel.app` |
| Bootstrap local | **Não executado** — `DATABASE_URL` do agente aponta para `localhost:5432` (sem Docker); produção já tem usuário |

## Inventário de tabelas

| Model Prisma | Tabela `public` | Linhas (2026-10-27) | RLS |
|--------------|-----------------|---------------------|-----|
| — | `_prisma_migrations` | 6 | off (esperado até P8) |
| `Cliente` | `Cliente` | 1 | off |
| `Usuario` | `Usuario` | 1 | off |
| `AuditLog` | `AuditLog` | 0 | off |
| `EntidadeCodigoSequencia` | `EntidadeCodigoSequencia` | 0 | off |
| `RegistroAnexo` | `RegistroAnexo` | 0 | off |
| `Setor` | `Setor` | 0 | off |
| `AreaPastagem` | `AreaPastagem` | 0 | off |
| `ConfiguracaoIcone` | `ConfiguracaoIcone` | 0 | off |
| `PontoReferencia` | `PontoReferencia` | 0 | off |
| `LinhaGeografica` | `LinhaGeografica` | 0 | off |

**URL API Supabase (referência):** `https://uuemcasqcdjucflulkne.supabase.co` — o app MAIKE usa Prisma via `DATABASE_URL` no Vercel, não o client anon do Supabase.

## Migrations registradas

| `migration_name` | `applied_steps_count` |
|------------------|----------------------|
| `20260908174141_p3_foundation` | 1 |
| `20260909112833_p4_1_setor_native` | 1 |
| `20260909201703_p4_1_r2_setor_tipo_default` | 1 |
| `20260910190000_p4_2_area_pastagem_native` | 1 |
| `20261023180000_p4_3_map_geography_native` | 1 |
| `20261023210000_p6_1_login_global_hygiene` | 1 |

Nota: a API `list_migrations` do Supabase MCP expõe `version` interna distinta do `migration_name` Prisma; a fonte de verdade para go-live é `_prisma_migrations.migration_name` (consulta acima).

## Rotas backend (escopo mapa-manejo)

Registradas em `backend/src/app.js` e reescritas em `vercel.json`:

- `/health`, `/auth/*`
- `/setores`, `/areas-pastagem`
- `/configuracao-icones`, `/pontos-referencia`, `/linhas-geograficas`
- `/usuarios` (P6.0)

Nenhuma alteração de código necessária nesta missão.

## Smoke HTTP (produção)

| URL | Resultado |
|-----|-----------|
| `GET https://maike-five.vercel.app/health` | **200** — `status: ok`, `banco: up`, `configuracaoIncompleta: []` |
| `GET https://maike-five.vercel.app/setores` (sem JWT) | **401** — `TENANT_CONTEXT_REQUIRED` (rota e auth OK) |

Login autenticado em `/setores` não foi repetido aqui (credenciais do bootstrap não estão no repositório).

## O que foi corrigido automaticamente

- **Nada no banco** — schema já completo antes desta auditoria.
- **Nada no Vercel via MCP** — `filter_project_envs` / `get_project` retornam `404 Project not found` para `maike`, `maike-five` e `prj_jbLcws3pOJqXu2Fo3joKFJG86dzh`; apenas `controle-de-estoque` aparece na listagem de projetos do time autorizado ao token.

## Bloqueios (credenciais / permissões)

1. **Vercel MCP** — reconectar ou autorizar o projeto/team que hospeda `maike-five.vercel.app` para o agente ajustar `VITE_MAIKE_API_URL` (vazio no monólito), `FRONTEND_ORIGINS` e remover `VITE_SKIP_NATIVE_LOGIN`.
2. **Redeploy** — após mudança de `VITE_*`, novo build Production no dashboard (MCP sem acesso ao projeto).
3. **RLS** — permanece desligado por decisão P8; não habilitar sem políticas (advisory Supabase).

## Referências

- [`PRODUCAO-GO-LIVE-CHECKLIST.md`](./PRODUCAO-GO-LIVE-CHECKLIST.md)
- [`SUPABASE-MAIKE-MIGRATIONS-SYNC-REPORT.md`](./SUPABASE-MAIKE-MIGRATIONS-SYNC-REPORT.md)
