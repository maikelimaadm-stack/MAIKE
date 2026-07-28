# Registro de Gates

SSOT dos pontos de verificação mecânica. Regra sem gate é sugestão (Constituição P5).

Todos os scripts vivem em `scripts/gates/`. Todos estão ligados ao `package.json`.

---

| Gate | Comando | Verifica | Regra | Script |
|---|---|---|---|---|
| **governance-paths** | `npm run gate:governance-paths` | Documentos obrigatórios existem, links resolvem, sem SSOT duplicado na raiz, gates do registro ligados ao `package.json` | R6 · R8 | `scripts/gates/gate-governance-paths.mjs` |
| **product-scope** | `npm run gate:product-scope` | Rotas, menu, schemas e functions dentro de `config/mapa-manejo-scope.json`; superfície primária é `MapaGeral` | R1 · R2 · D21–D23 | `scripts/gates/gate-product-scope.mjs` |
| **import-integrity** | `npm run gate:import-integrity` | Nenhum import estático em `src/` aponta para arquivo inexistente | R3 | `scripts/gates/gate-import-integrity.mjs` |
| **no-secrets** | `npm run gate:no-secrets` | Sem chave Google Maps, token Base44 ou JWT literal em `src/`; sem `.env` versionado | R4 · D25 | `scripts/gates/gate-no-hardcoded-secrets.mjs` |
| **base44** | `npm run gate:base44` | Acoplamento com a Base44 só diminui (catraca, 9 eixos) | R5 · D7 · D8 | `scripts/gates/gate-base44-ratchet.mjs` |
| **verify:all** | `npm run verify:all` | Roda os 5 gates + `lint` + `typecheck` + `build` | — | `scripts/gates/verify-all.mjs` |

---

## Códigos de falha

| Código | Gate |
|---|---|
| `P01-SCOPE-ROUTE` | product-scope |
| `P01-SCOPE-ENTITY` | product-scope |
| `P01-SCOPE-FUNCTION` | product-scope |
| `P01-IMPORT-BROKEN` | import-integrity |
| `P01-GOVERNANCE-DRIFT` | governance-paths |
| `P01-SECRET-HARDCODED` | no-secrets |
| `P01-BASE44-REGRESSION` | base44 |
| `P01-BUILD-FAILURE` | verify:all, etapa `build` |

## Comportamento

- A catraca da Base44 mede 9 eixos separados: `arquivosComSdk`, `importsSdk`,
  `entitiesRefs`, `authRefs`, `integrationsRefs`, `functionsRefs`, `vitePlugin`,
  `schemas`, `functionsBase44`. Qualquer eixo que suba reprova.
- O baseline fica em `scripts/gates/base44-baseline.json`. Regravar com
  `node scripts/gates/gate-base44-ratchet.mjs --update`; **só aceita valores
  menores** (A11).
- `verify:all` executa na ordem: governance-paths → product-scope →
  import-integrity → no-secrets → base44 → lint → typecheck → build. Nenhuma
  etapa tem o exit code ignorado nem convertido em sucesso.
- Alterar `config/mapa-manejo-scope.json` para admitir um módulo novo exige
  registro em `docs/engineering/DECISIONS.md`. Agente de IA não amplia o escopo
  sozinho — propõe e aguarda aprovação.

## Etapa vermelha conhecida

`typecheck` falha **desde antes desta missão**: `tsc -p ./jsconfig.json` roda com
`checkJs: true` sobre código JavaScript sem tipos, e os componentes de
`src/components/ui` são `React.forwardRef` sem contrato de props.

| Momento | Erros `tsc` |
|---|---|
| `main` (antes do P0.1) | 10.935 |
| depois do P0.1 | 2.788 |

Nenhum erro novo foi introduzido — a queda é consequência da exclusão de escopo.
Tratamento planejado em P1 (DBT-03). O gate **não** foi desabilitado, o
`jsconfig.json` **não** foi alterado e nenhum `eslint-disable`/`@ts-nocheck` foi
adicionado para mascarar isso.

## Gates futuros

| Gate | Missão | Verifica |
|---|---|---|
| `gate:apis` | P1 | Componente não acessa provider de dados direto |
| `gate:types` | P1 | `typecheck` sem erro (fecha DBT-03) |
| `gate:tenancy` | P3 | Todo model Prisma tem `cliente_id` |
| `gate:indices` | P3 | `@@index`/`@@unique` começam por `cliente_id` |
| `gate:no-base44` | P7 | Zero referências. Substitui a catraca |
| `gate:rls` | P8 | Toda tabela tem policy de RLS |
