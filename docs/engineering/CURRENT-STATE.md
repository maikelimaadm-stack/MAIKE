# Estado Atual

**Atualizado em:** 2026-07-28 (missão P0.1)

---

## Programa

**MAIKE Pecuária — Mapa Geral + Manejo.** Sistema nativo e escalável, com a
Base44 mantida apenas como provider temporário da cadeia preservada (D-PROD-04).

| Campo | Valor |
|---|---|
| Produto | Pecuária — Mapa Geral + Manejo (D-PROD-01) |
| Superfície primária | `MapaGeral` (D-PROD-05) |
| Missão atual | **P0.1 — Product Scope Reset** |
| Próxima missão | P1 — Native Foundation Bootstrap |
| Branch | `claude/maike-scope-reset-ona5vs` |
| Escopo executável | `config/mapa-manejo-scope.json` |
| Roadmap | `docs/engineering/ROADMAP.md` |
| Molde arquitetural | PROJETOMG, parcial (D-PROD-03) |

## Progresso por missão

| Missão | Nome | Estado |
|---|---|---|
| P0 | Product Scope Reset | **entregue (P0.1)** |
| P1 | Native Foundation Bootstrap | não iniciada |
| P2 | ModeloBase1 Pecuário Foundation | não iniciada |
| P3 | Backend + Prisma + PostgreSQL Foundation | não iniciada |
| P4 | Mapa Core Native Persistence | não iniciada |
| P5 | Manejo Core Native Persistence | não iniciada |
| P6 | Supporting Capabilities | não iniciada |
| P7 | Base44 Final Removal | não iniciada |
| P8 | Hardening and Release | não iniciada |

## Inventário depois do P0.1

| Métrica | Antes | Depois |
|---|---|---|
| Páginas em `src/pages` | 102 | 16 |
| Arquivos em `src/` | 472 | 231 |
| Arquivos em `src/components` | 312 | 184 |
| Schemas em `base44/entities` | 87 | 38 |
| Functions em `base44/functions` | 11 | 1 |
| Arquivos em `src/` com SDK/base44Client | 197 | 71 |
| Ocorrências de `base44.entities` | 1014 | 371 |
| Ocorrências de `base44.auth` | 29 | 16 |
| Ocorrências de `base44.integrations` | 24 | 6 |
| Ocorrências de `base44.functions` | 9 | 5 |
| Chaves Google Maps literais em `src/` | 8 | 0 |
| Bundle de produção (JS) | 4.347 kB | 2.458 kB |

Medição completa: `docs/engineering/P0.1-MAPA-MANEJO-SCOPE-RESET-REPORT.md`.
Baseline mecânico: `scripts/gates/base44-baseline.json`.

## Gates ativos

Ver `docs/engineering/GATE-REGISTRY.md`. Comando único: `npm run verify:all`.

## Débito conhecido

| # | Item | Tratamento |
|---|---|---|
| DBT-01 | Componentes acessam `base44` direto; não existe camada `src/apis/` | P1 |
| DBT-02 | `requiresAuth: false` em `src/api/base44Client.js` | P3 |
| DBT-03 | `npm run typecheck` falha (herdado da `main`): projeto JS com `checkJs: true` e sem tipos | P1 |
| DBT-04 | Sem tela de **entrada** de estoque (D-PROD-08) | P6 |
| DBT-05 | Chave Google Maps antiga permanece no histórico Git — revogar e rotacionar | ação do proprietário |
| DBT-06 | Bundle único de ~2,4 MB, sem code splitting | P8 |
| DBT-07 | `src/services/campoEngine.js` e a cadeia `Layout*` sustentam o formulário dinâmico de lote | reavaliar em P2 |
