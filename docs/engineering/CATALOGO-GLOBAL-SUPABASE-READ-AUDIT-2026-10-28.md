# Auditoria read-only — catálogo global (Supabase produção)

**Data:** 28/10/2026 (UTC)  
**Projeto Supabase:** `uuemcasqcdjucflulkne` (MAIKE, `sa-east-1`, `ACTIVE_HEALTHY`, Postgres **17**)  
**Autorização:** leitura produção autorizada pelo proprietário (`AUTORIZO A LEITURA`)  
**Checkpoint Git:** `origin/main` @ `ed32521` — pós-merge **PR #126** (D-PROD-57) e **PR #127** (MapLibre M1 / D-PROD-58)  
**Decisão de produto:** [D-PROD-57](./DECISIONS.md) · Plano: [PLAN-CONFIGURACOES-GERAIS-SEPARACAO-MAPA-2026-10-28.md](./PLAN-CONFIGURACOES-GERAIS-SEPARACAO-MAPA-2026-10-28.md)  
**Natureza:** auditoria **somente leitura** — zero alteração em Supabase, Vercel ou código de produto nesta missão.

---

## 1. Objetivo

Validar o estado real de produção antes da **slice 1 backend** do catálogo global (PostgreSQL + Storage + API interna), conforme ordem operacional do plano §6 pós-PR #126/#127.

---

## 2. Método

| Fonte | Uso |
|---|---|
| Supabase MCP `execute_sql` | Contagens, `information_schema`, `pg_*`, `storage.buckets` |
| Supabase MCP `get_advisors` | Security + performance |
| Supabase MCP `list_migrations` | Paridade com histórico Supabase |
| Supabase MCP `get_project` | Metadados do projeto |
| GitHub | Estado PR #126 / #127 |

**Limitação MCP Storage:** o namespace Supabase **não expõe** ferramenta dedicada `list_buckets`. Buckets foram consultados via SQL em `storage.buckets` (papel `postgres`). Não houve auditoria de políticas RLS em `storage.objects` nem inventário de objetos além da ausência de buckets.

**Sessão SQL:** `current_user = postgres`, `rolbypassrls = true` — contagens refletem dados reais, não mascaramento por RLS da sessão de auditoria.

---

## 3. Inventário de dados (legado mapa / ícones)

### 3.1 Contagens

| Entidade | `COUNT(*)` | `pg_stat_user_tables.n_live_tup` |
|---|---:|---:|
| `ConfiguracaoIcone` | **0** | **0** |
| `PontoReferencia` (total) | **0** | **0** |
| `PontoReferencia` com `configuracao_icone_id` NOT NULL | **0** | — |
| Regras `categoria = 'MISTO'` / `categorias_misto` preenchido | **0** / **0** | — |

**Contexto de volume (mesmo banco):** `Cliente` 1 · `Usuario` 1 · `Empresa` 2 · `AreaPastagem` 4 · `Lote` 2 — ambiente de produção **com dados operacionais mínimos**, mas **sem** ícones nem POIs persistidos.

### 3.2 Implicação para migração (D-PROD-57)

- Não há inventário legado em produção para `(cliente_id, id ConfiguracaoIcone) → id global` **neste momento** — risco de quebra por dados existentes é **baixo hoje**, mas o contrato de migração continua obrigatório antes de cortar o legado no código.
- `PontoReferencia.configuracao_icone_id` é **referência opaca** (sem FK para `ConfiguracaoIcone`) — confirmado em produção (apenas FK `cliente_id → Cliente`).
- URLs duplicadas em `PontoReferencia.icone_url` / `sub_icone_url` não existem com zero linhas.

---

## 4. Esquema físico amostral (produção = Prisma P4.3)

### 4.1 `ConfiguracaoIcone`

| Coluna | Tipo | Nullable |
|---|---|---|
| `id` | text | NO |
| `cliente_id` | varchar | NO |
| `empresa_id` | varchar | YES |
| `tipo_entidade` | varchar | NO |
| `categoria` | varchar | NO |
| `icone_url` | varchar | YES |
| `sub_icone_url` | varchar | YES |
| `cor_padrao` | varchar | YES |
| `descricao` | varchar | YES |
| `categorias_misto` | jsonb | YES |
| `ativo` | boolean | NO (default true) |
| `createdAt` / `updatedAt` | timestamp | NO |

**Índices:** PK `id`; unique `(cliente_id, id)`; índices `(cliente_id, tipo_entidade|ativo|categoria)`.

### 4.2 `PontoReferencia` (campos ligados a ícone)

| Coluna | Tipo | Nullable |
|---|---|---|
| `configuracao_icone_id` | varchar | YES |
| `icone_url` / `sub_icone_url` | varchar | YES |
| (+ demais campos de negócio/geo conforme P4.3) | | |

**Índice em `configuracao_icone_id`:** **nenhum** (esperado — coluna não indexada no schema atual).

### 4.3 Tabelas “catálogo global” (D-PROD-57)

Busca em `pg_tables` por `%icone%`, `%catalog%`, `%global%`, `%asset%`: **apenas** `ConfiguracaoIcone` (modelo tenant-scoped legado). **Nenhuma** tabela global sem `cliente_id` existe ainda.

---

## 5. Migrations e paridade repo ↔ produção

| Verificação | Resultado |
|---|---|
| `_prisma_migrations` aplicadas | **18** (`20260908174141_p3_foundation` … `20261028240000_p8_supabase_public_revoke_rls`) |
| Repositório `backend/prisma/migrations/` | **18** diretórios — **alinhado** |
| Última migration | `20261028240000_p8_supabase_public_revoke_rls` @ `2026-10-28 19:55:36+00` |
| Supabase `list_migrations` | **18** entradas; nomes consistentes com Prisma (versões Supabase ≠ timestamps de pasta Prisma — normal) |

---

## 6. Segurança (RLS, grants, advisors)

### 6.1 P8 / D-PROD-56 (estado observado)

| Métrica | Valor |
|---|---|
| Tabelas `public` (exc. `_prisma*`) | **39** |
| Com RLS habilitado | **39/39** |
| Grants `anon` / `authenticated` em `public` | **0 tabelas** (consulta `information_schema.role_table_grants`) |
| Papel de runtime backend | `maike_vercel` — ALL em tabelas via política `maike_backend_all` (`USING true` / `WITH CHECK true` **somente** para esse papel) |

Exemplo (`ConfiguracaoIcone`, `PontoReferencia`): política única `maike_backend_all` → role `{maike_vercel}`.

**Nota:** isolamento multi-tenant continua **na API Fastify** (`cliente_id` do JWT), não via `auth.uid()` Supabase — coerente com comentários da migration P8.

### 6.2 Supabase Security Advisor

**0 lints** — consistente com hardening P8 (sem políticas abertas para `anon`/`authenticated` em `public`).

### 6.3 Lacunas para catálogo global (planejamento)

D-PROD-57 exige escrita só com identidade **produto MAIKE** e leitura controlada para tenants. **Não auditado nesta leitura:** claims JWT internos, tabela de operadores, nem desenho de políticas para tabelas **sem** `cliente_id`. Novas tabelas globais devem repetir o padrão P8 (revoke Data API + RLS + política explícita para `maike_vercel` **e** regra de autorização no backend — global **não** pode herdar filtro tenant cego).

---

## 7. Supabase Storage

| Verificação | Resultado |
|---|---|
| `storage.buckets` | **0 buckets** |
| Ferramenta MCP `list_buckets` | **Indisponível** — uso de SQL |
| RLS em schema `storage` | Habilitado em `buckets`, `objects`, etc. |

**Conclusão:** infraestrutura Storage existe, mas **nenhum bucket** foi provisionado para assets do catálogo. Slice 1 precisa definir bucket(s), políticas de leitura pública seletiva, upload restrito ao backend e convenção de revisão/caminho (D-PROD-57).

---

## 8. Performance Advisor (extrato relevante)

| Lint | Nível | Relevância catálogo |
|---|---|---|
| `unindexed_foreign_keys` | INFO | 1 FK em `Lote` — **fora** do escopo ícones |
| `unused_index` | INFO | 67 índices não usados (incl. índices de `ConfiguracaoIcone` / `PontoReferencia`) — esperado com tabelas vazias e carga baixa |
| `auth_db_connections_absolute` | INFO | Auth max 10 conexões absolutas — operacional Supabase |

Nada bloqueia DDL da slice 1; revisitar índices após carga real do catálogo.

---

## 9. Checkpoint handoff (PR #126 / #127)

| PR | Estado | Conteúdo relevante |
|---|---|---|
| [#126](https://github.com/maikelimaadm-stack/MAIKE/pull/126) | **MERGED** 2026-10-28 | D-PROD-57, plano, relatório governança — catálogo Supabase + Storage + painel interno |
| [#127](https://github.com/maikelimaadm-stack/MAIKE/pull/127) | **MERGED** 2026-10-28 | MapLibre M1 editor (D-PROD-58) — **não** altera contrato de ícones; renderizadores legados preservados até migração testada |

Pré-requisito “aguardar mapa” do plano §6: **parcialmente atendido** (M1 mergeado); cortes futuros no Mapa Geral / `useMapRenderer` **permanecem fora** da slice 1 backend.

---

## 10. Riscos

| # | Risco | Severidade | Mitigação |
|---|---|---|---|
| R1 | Produção sem dados legados **hoje** pode mascarar complexidade de migração futura | Média | Manter plano de mapeamento `(cliente_id, id)` antes de desligar `GerenciadorIcones` |
| R2 | Novas tabelas globais sem padrão P8 reabrem Data API | Alta | Migration dedicada: RLS + revoke + política `maike_vercel`; gate/review |
| R3 | Storage vazio — URLs atuais provavelmente externas ou in-memory | Média | Definir bucket + revisão/hash antes de servir mapa |
| R4 | Autorização “produto MAIKE” ainda não modelada no banco | Alta | ADR + implementação backend antes de expor escrita |
| R5 | `configuracao_icone_id` sem FK/index | Baixa agora | Index + FK lógica na migração para POIs |
| R6 | CDN/cache ao versionar assets (D-PROD-57) | Média | Política de path com revisão; proibir overwrite silencioso |

---

## 11. Veredito — slice 1 **backend** (schema + API servidor + Storage bootstrap)

| Critério | Avaliação |
|---|---|
| Migrations repo = produção (18/18) | OK |
| Baseline segurança P8 | OK |
| Dados legados a migrar em produção | **Nenhum** (facilita, não dispensa desenho) |
| Tabelas/assets globais existentes | **Não** — greenfield DDL |
| Storage pronto | **Não** — criar na slice |
| Auth produto para escrita global | **Pendente** desenho/implementação |

### GO / NO-GO

**GO condicional** para abrir **uma PR isolada de slice 1 backend** (migrations Prisma + módulo Fastify + políticas Storage **via backend**, sem painel tenant e **sem** trocar `useMapRenderer` / `GerenciadorIcones`), **desde que**:

1. PR inclua extensão do padrão P8 para **todas** as tabelas novas globais.
2. PR documente decisão física de nomes (ou referência D-PROD atualizada) e seed inicial opcional.
3. PR **não** promova leitura/escrita global pelo PostgREST anon/authenticated.
4. Autorização de escrita catálogo seja enforced no **backend** (claim/role produto) mesmo antes do painel interno UI.

**NO-GO** para, na mesma slice: alterar `ConfiguracaoIcone` tenant existente, migrar POIs, publicar painel no menu tenant, ou assumir Supabase Auth como SSOT de operadores internos **sem** desenho explícito.

---

## 12. Próximos passos recomendados

1. **Produto/engenharia:** fechar modelo físico (tabelas tipo/categoria/ícone/regra MISTO/revisão) e registrar em `DECISIONS.md` se divergir do conceitual D-PROD-57.
2. **Backend:** PR slice 1 — DDL + repositórios + rotas internas (`/api/...` protegidas) + testes `test:backend` com PostgreSQL.
3. **Supabase Storage:** criar bucket, políticas, contrato de URL versionada; validar leitura CDN.
4. **Operação:** após slice 1, re-auditar contagens legado se clientes reais passarem a usar `GerenciadorIcones` em produção.
5. **Frontend (slice posterior):** painel interno MAIKE + leitura global no mapa — somente após API estável e testes MISTO.

---

## Apêndice A — SQL executado (referência)

- Contagens `ConfiguracaoIcone` / `PontoReferencia` / MISTO
- Colunas `information_schema.columns`
- Tail e lista completa `_prisma_migrations`
- RLS `pg_class` · políticas `pg_policies`
- Índices/constraints · grants · `storage.buckets`
- `get_advisors` security + performance

**Executor:** agente cloud · read-only · 28/10/2026 UTC.
