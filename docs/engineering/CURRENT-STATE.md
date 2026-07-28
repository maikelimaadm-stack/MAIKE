# Estado Atual

**Atualizado em:** 2026-07-28 (missão P0.1 + correção P0.1-R1)

---

## Programa

**MAIKE Pecuária — Mapa Geral + Manejo.** Sistema nativo e escalável, com a
Base44 mantida apenas como provider temporário da cadeia preservada (D-PROD-04).

| Campo | Valor |
|---|---|
| Produto | Pecuária — Mapa Geral + Manejo (D-PROD-01) |
| Superfície primária | `MapaGeral` (D-PROD-05) |
| Missão atual | **P0.1 — Product Scope Reset**, corrigida por **P0.1-R1** |
| Estado da missão | **entregue e certificada** — `npm run verify:all` sai com 0 |
| Próxima missão | P1 — Native Foundation Bootstrap |
| Branch | `claude/maike-scope-reset-ona5vs` (PR #1, draft) |
| Escopo executável | `config/mapa-manejo-scope.json` |
| Roadmap | `docs/engineering/ROADMAP.md` |
| Molde arquitetural | PROJETOMG, parcial (D-PROD-03) |

O merge operacional continua **condicionado à confirmação do proprietário sobre
a rotação da chave do Google Maps** — ver OWNER-SECURITY-01 no relatório
`docs/engineering/P0.1-R1-CORRECTIVE-HARDENING-REPORT.md`.

## Progresso por missão

| Missão | Nome | Estado |
|---|---|---|
| P0 | Product Scope Reset | **entregue e certificada** |
| P1 | Native Foundation Bootstrap | não iniciada |
| P2 | ModeloBase1 Pecuário Foundation | não iniciada |
| P3 | Backend + Prisma + PostgreSQL Foundation | não iniciada |
| P4 | Mapa Core Native Persistence | não iniciada |
| P5 | Manejo Core Native Persistence | não iniciada |
| P6 | Supporting Capabilities | não iniciada |
| P7 | Base44 Final Removal | não iniciada |
| P8 | Hardening and Release | não iniciada |

## Inventário

Números medidos após `npm ci` e `npm run build` finais.

| Métrica | `main` | Depois do P0.1-R1 |
|---|---|---|
| Páginas em `src/pages` | 102 | **16** |
| Arquivos em `src/` | 472 | **203** |
| Arquivos em `src/components` | 312 | **157** |
| Schemas em `base44/entities` | 87 | **38** |
| Functions em `base44/functions` | 11 | **1** |
| Dependências diretas (`dependencies`) | 63 | **31** |
| Dependências diretas (`devDependencies`) | 15 | **18** |
| Arquivos em `src/` com SDK/base44Client | 197 | **71** |
| Ocorrências de `base44.entities` | 1014 | **371** |
| Ocorrências de `base44.auth` | 29 | **16** |
| Ocorrências de `base44.integrations` | 24 | **6** |
| Ocorrências de `base44.functions` | 9 | **5** |
| Acoplamento Base44 fora de `src/` | 22 | **1** |
| Chaves Google Maps literais | 8 | **0** |
| Erros de lint | 64 | **0** |
| Diagnósticos `tsc` (cobertura total) | — | **2.803** (dívida versionada) |
| Bundle de produção — JS | 4.347,45 kB | **2.460,06 kB** |
| Bundle de produção — CSS | 120,36 kB | **77,00 kB** |

O bundle é o do build final desta branch (`dist/assets/index-CZZXlY40.js`).

Baselines mecânicos: `scripts/gates/base44-baseline.json` e
`scripts/gates/typecheck-baseline.json`.

## Gates ativos

12 etapas em `npm run verify:all` — ver `docs/engineering/GATE-REGISTRY.md`.
Todos os gates têm teste unitário com casos de falha em `scripts/tests/gates/`.
CI em `.github/workflows/quality.yml`.

## Débito conhecido

| # | Item | Tratamento |
|---|---|---|
| DBT-01 | Componentes acessam `base44` direto; não existe camada `src/apis/`. 371 chamadas `base44.entities` dentro de componentes React | P1 |
| DBT-02 | `requiresAuth: false` em `src/api/base44Client.js` | P3 |
| DBT-03 | 2.803 diagnósticos de dívida de tipos versionados na catraca. `gate:types` impede crescer; P1 deve reduzir | P1 |
| DBT-04 | Sem tela de **entrada** de estoque (D-PROD-08) | P6 |
| DBT-05 | Chave Google Maps antiga permanece no histórico Git — revogar e rotacionar (OWNER-SECURITY-01) | ação do proprietário |
| DBT-06 | Bundle único de ~2,46 MB, sem code splitting | P8 |
| DBT-07 | `LayoutCampo`/`LayoutSecao`/`LayoutConfiguracao` + `src/services/campoEngine.js` sustentam o formulário dinâmico de lote — um mini-motor de layout dentro do produto | P2 |
| DBT-08 | `src/lib/offlineEntitySync.js` e `src/components/offline/mapaOfflineCache.jsx` mantêm listas de entidades duplicadas e desalinhadas entre si | P1 |
| DBT-09 | `getNextSystemNumber` em `src/pages/Produtos.jsx` lista a coleção inteira para calcular o próximo número | P6 |
| DBT-10 | `eslint.config.js` só cobre `src/components`, `src/pages` e `src/Layout.jsx`. `src/lib`, `src/api`, `src/services` e `scripts/` ficam fora do lint | P1 |
| DBT-11 | `npm audit` reporta vulnerabilidades nas dependências transitivas remanescentes | P8 |
