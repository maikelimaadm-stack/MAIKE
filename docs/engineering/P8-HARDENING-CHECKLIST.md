# P8 — Hardening and Release (checklist stub)

**Estado:** preparação pós-P7 / pós-auditoria de gap (#87). Missão **não**
iniciada — este documento lista trabalho autorizável; detalhes finos entram em
DECISIONS e relatório de missão ao fechar cada fatia.

Referência: [`ROADMAP.md`](./ROADMAP.md) § P8 · [`GAP-AUDIT-POS-BASE44-2026-10-27.md`](./GAP-AUDIT-POS-BASE44-2026-10-27.md)

## Segurança de dados e acesso

- [ ] **RLS** — políticas por `cliente_id` se PostgREST/anon key forem expostos;
  hoje o app usa Prisma com credencial de servidor (`gate:rls` futuro).
- [ ] **Autorização real** — além de JWT + tenant; perfis/permissões (continuação P6).
- [ ] **Rate limiting** — login e APIs sensíveis.
- [ ] **CSP / cookies** — endurecer front; JWT permanece memória + `sessionStorage`
  (D-PROD-24) até decisão de cookies httpOnly.
- [ ] **Refresh / rotação de token** — se escopo P8 incluir sessão longa.

## Observabilidade e operação

- [ ] **Logs estruturados** e correlação request-id no backend.
- [ ] **Métricas / alertas** — erros 5xx, latência mapa, falhas de auth.
- [ ] **Backup + restore testado** — runbook Supabase documentado e exercitado.
- [ ] **Advisories Supabase** — performance e security revisados pós-migration.

## Release e qualidade

- [ ] **Code splitting / bundle** (DBT-06).
- [ ] **Playwright ou equivalente** — layout real além de JSDOM (DBT-24).
- [ ] **`npm audit`** — tratar ou documentar exceções (DBT-11).
- [ ] **Anexos nativos** §11.16 — upload, grid, auditoria (UX Base1 placeholder).
- [ ] **Gate `gate:no-base44`** — decisão pós-P8 sobre arquivar `base44/`.

## Fora de P8 (não misturar)

- Demo seed operacional: [`DEMO-SEED-PRODUCAO.md`](./DEMO-SEED-PRODUCAO.md).
- Paridade UX Base1: track paralelo no ROADMAP.
