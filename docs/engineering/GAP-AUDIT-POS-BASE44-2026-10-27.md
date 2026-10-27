# Auditoria de gap — pós-Base44 (dados e schema)

**Data:** 2026-10-27  
**Branch:** `cursor/gap-audit-pos-base44-516d`  
**Projeto Supabase:** `uuemcasqcdjucflulkne` (MAIKE)

## Pergunta

Ainda falta **migrar** entidades para o PostgreSQL ou **criar** tabelas novas para
o escopo do produto?

## Resposta curta

**Não.** Para o manifesto `config/mapa-manejo-scope.json`, a migração de **dados
de domínio** da Base44 está **fechada** desde **P5.5** (PR #84). O runtime não
usa SDK Base44 (P7, PR #85). O que resta é **P8** (hardening), **UX Base1**,
dados operacionais vazios (seeds/backfill opcional) e limpeza **opcional** de
artefatos legados (`base44/entities/*.jsonc`), não schema faltando.

---

## Evidências

### 1. Escopo × Prisma

| Fonte | Contagem |
|---|---|
| `allowedBase44Entities` no manifesto | **35** (`User` → model `Usuario`) |
| Models em `backend/prisma/schema.prisma` | **38** (35 de domínio + fundação P3) |
| Entidades do escopo **sem** model Prisma | **0** |

Comparação automatizada (2026-10-27): nenhuma entidade permitida ficou de fora
do schema.

### 2. Supabase (produção)

| Métrica | Valor |
|---|---|
| Tabelas de aplicação (excl. `_prisma_migrations`) | **38** — espelham os models Prisma |
| Linhas em `_prisma_migrations` | **14** — igual ao repositório |
| Última migration | `20261028120000_p55_base44_exit_final` |

O banco **já existe** e está **alinhado** ao ledger Prisma. Não há fila de DDL
pendente para fechar a saída Base44.

**RLS:** todas as tabelas públicas estão com RLS **desligado** — esperado hoje
(o app usa JWT no Fastify, não PostgREST anon). Endurecer RLS é trabalho **P8**,
não migração de entidade.

### 3. Runtime frontend

- `src/apis/_providers/base44Provider.js` — registry **vazio** (P5.5).
- Nenhuma chamada `base44.entities` / `VITE_BASE44_*` em `src/`.
- Persistência: portas `*NativePort` → monólito Vercel → PostgreSQL.

### 4. Backend

Todas as rotas de domínio do escopo estão registradas em `backend/src/app.js`
(auth, mapa, cadastros, manejo, estoque, satélites bebedouro, upload, sync de
referências).

---

## O que está DONE (não confundir com “falta migrar”)

| Item | Estado |
|---|---|
| Auth JWT nativo | **DONE** (P4.0+) |
| CRUD das 16 páginas do menu | **DONE** — ver `CADASTROS-E-MODULOS-STATUS.md` |
| Models + migrations P3–P5.5 | **DONE** — 14 migrations versionadas |
| Dados via API (não Base44) | **DONE** (P5.5 + P7) |
| Deploy monólito + Supabase | **DONE** — ver `POST-P7-PRODUCAO-REPORT-2026-10-27.md` |

**Tabelas com 0 linhas** (ex.: `Lote`, `Produto`) indicam ambiente **sem seed
operacional**, não schema ausente.

---

## O que NÃO é “migração Base44” (próximo trabalho)

| Trilha | Descrição |
|---|---|
| **P8** | RLS/policies (se expuser PostgREST), rate limit, observabilidade, backup/restore testado, CSP, release |
| **UX Base1** | Paridade visual cadastros — pausado até **H.5** (D-PROD-41); piloto Marcas |
| **Operação** | Bootstrap tenant: `npm run auth:bootstrap:local` (Cliente + Usuario). **Empresa** e demais cadastros entram pela UI `/Empresa` ou futuro script de seed — não há gap de model |
| **P7 opcional** | Remover `base44/entities` do repo/manifesto — **documentação/spec**, não runtime |
| **Modelos JSON doc (P5.5)** | `MovimentacaoMapa`, `MovimentacaoPecuaria`, sanitários, suplementação satélite usam coluna `dados Json` — evolução futura para colunas tipadas é **refino de domínio**, não bloqueio de migração |
| **DBT legados** | Alguns parágrafos históricos em `CURRENT-STATE.md` ainda mencionam Base44 como fonte — texto de arquivo, não comportamento |

---

## Conclusão para produto

**Não falta criar banco nem migrar entidades do escopo para PostgreSQL.** A
próxima missão autorizável no roadmap é **P8 — Hardening and Release**, em
paralelo com aceite UX (**H.5**) quando o proprietário quiser.

Nenhum patch de código de domínio foi necessário nesta auditoria.
