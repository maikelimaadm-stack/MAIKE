# Registro de Gates

SSOT dos pontos de verificação mecânica. Regra sem gate é sugestão.

---

| Gate | Comando | Verifica | Regra | Script |
|---|---|---|---|---|
| **tenancy** | `npm run gate:tenancy` | Todo model tem `cliente_id` | R1 · D1 | `scripts/gates/gate-tenancy.mjs` |
| **indices** | `npm run gate:indices` | `@@index`/`@@unique` começam por `cliente_id`; sem `@unique` isolado | R2 · R3 · D2 · D3 | `scripts/gates/gate-indices.mjs` |
| **base44** | `npm run gate:base44` | Acoplamento com Base44 só diminui | R5 · D7 · D8 | `scripts/gates/gate-base44.mjs` |
| **apis** | `npm run gate:apis` | Componente não importa SDK direto | R4 · D10 | `scripts/gates/gate-apis.mjs` |
| **verify:all** | `npm run verify:all` | Roda os quatro | — | `scripts/gates/verify-all.mjs` |

---

## Comportamento

- Gates de schema **pulam** (exit 0) enquanto `backend/prisma/schema.prisma` não existir
- `gate:base44` cria o baseline na primeira execução
- `gate:base44 --update` grava novo baseline; **só aceita valores menores**

## Allowlists

`gate-tenancy.mjs` e `gate-indices.mjs` têm ALLOWLIST no topo do arquivo, para
models legitimamente globais.

**Adicionar model à allowlist exige registro em `DECISIONS.md`.** Agente de IA
não adiciona sozinho — propõe e aguarda aprovação.

## Gates futuros

| Gate | Fase | Verifica |
|---|---|---|
| `gate:rls` | 5 | Toda tabela tem policy de RLS |
| `gate:auth` | 5 | Nenhuma rota sem middleware de autenticação |
| `gate:no-base44` | 6 | Zero referências. Substitui o gate de catraca |
