# Registro de Gates

SSOT dos pontos de verificação mecânica. Regra sem gate é sugestão (Constituição P5).

Todos os scripts vivem em `scripts/gates/`. Todos estão ligados ao `package.json`.
Todos têm teste unitário com casos de falha reais em `scripts/tests/gates/`.

---

## Gates

| Gate | Comando | Verifica | Decisões | Script |
|---|---|---|---|---|
| **test:gates** | `npm run test:gates` | Os próprios gates: baselines, contratos, allowlists, scanners | — | `scripts/tests/gates/*.test.mjs` |
| **governance-paths** | `npm run gate:governance-paths` | Documentos obrigatórios existem, links resolvem, sem SSOT duplicado na raiz, gates do registro ligados ao `package.json` | D-PROD-01 | `scripts/gates/gate-governance-paths.mjs` |
| **package-sync** | `npm run gate:package-sync` | `package.json` e `package-lock.json` batem em name, version e dependências diretas | D-PROD-02 | `scripts/gates/gate-package-sync.mjs` |
| **product-scope** | `npm run gate:product-scope` | Rotas, menu, schemas e functions dentro de `config/mapa-manejo-scope.json`; superfície primária é `MapaGeral`; **entidades citadas dentro das functions** | D-PROD-01 · D-PROD-05 · D-PROD-06 | `scripts/gates/gate-product-scope.mjs` |
| **source-closure** | `npm run gate:source-closure` | Todo arquivo executável em `src/` é alcançável a partir das entradas reais | D-PROD-12 | `scripts/gates/gate-source-closure.mjs` |
| **import-integrity** | `npm run gate:import-integrity` | Nenhum import estático em `src/` aponta para arquivo inexistente | D-PROD-02 | `scripts/gates/gate-import-integrity.mjs` |
| **no-secrets** | `npm run gate:no-secrets` | Nenhum segredo literal em **qualquer arquivo versionado**; nenhum `.env` versionado | D-PROD-07 | `scripts/gates/gate-no-hardcoded-secrets.mjs` |
| **base44** | `npm run gate:base44` | Acoplamento com a Base44 só diminui (catraca, 10 eixos) | D-PROD-04 | `scripts/gates/gate-base44-ratchet.mjs` |
| **types** | `npm run gate:types` | A dívida de tipos nunca cresce (catraca por fingerprint) | D-PROD-11 | `scripts/gates/gate-typecheck-ratchet.mjs` |
| **verify:all** | `npm run verify:all` | Toda a cadeia, na ordem abaixo | — | `scripts/gates/verify-all.mjs` |

## Ordem do `verify:all`

Contratos baratos primeiro, build por último:

```
test:gates → governance-paths → package-sync → product-scope → source-closure
→ import-integrity → no-secrets → base44 → types → lint → test:smoke → build
```

O resumo imprime nome, PASS/FAIL, código de saída, duração e comando executado.
Nenhuma etapa é ignorada nem tem o exit code convertido em sucesso.

## Códigos de falha

| Código | Gate |
|---|---|
| `P01-SCOPE-ROUTE` | product-scope |
| `P01-SCOPE-ENTITY` | product-scope |
| `P01-SCOPE-FUNCTION` | product-scope |
| `P01-SCOPE-FUNCTION-ENTITY` | product-scope |
| `P01-SCOPE-ORPHAN` | source-closure |
| `P01-SCOPE-DYNAMIC-ALLOWLIST` | source-closure |
| `P01-IMPORT-BROKEN` | import-integrity |
| `P01-GOVERNANCE-DRIFT` | governance-paths |
| `P01-SECRET-HARDCODED` | no-secrets |
| `P01-SECRET-ENV-TRACKED` | no-secrets |
| `P01-BASE44-BASELINE` | base44 |
| `P01-BASE44-CONTRACT` | base44 |
| `P01-BASE44-REGRESSION` | base44 |
| `P01-TYPE-BASELINE` | types |
| `P01-TYPE-REGRESSION` | types |
| `P01-TYPE-RUNNER` | types |
| `P01-PACKAGE-DRIFT` | package-sync |
| `P01-LOCKFILE-INVALID` | package-sync |
| `P01-SMOKE-FAILURE` | test:smoke |
| `P01-BUILD-FAILURE` | verify:all, etapa `build` |

## Catracas

Ambas seguem o mesmo contrato:

- **baseline ausente ou malformado é falha dura.** Execução normal **nunca** cria
  nem escreve o baseline.
- `--update` só grava quando **não há regressão** e **houve pelo menos uma
  redução**. A escrita é atômica (arquivo temporário + rename).
- O baseline é versionado no Git e tem versão de schema própria.

### `gate:base44` — 10 eixos

`arquivosComSdk` · `importsSdk` · `entitiesRefs` · `authRefs` ·
`integrationsRefs` · `functionsRefs` · `vitePlugin` · `runtimeConfigRefs` ·
`schemas` · `functionsBase44`

O conjunto de eixos é **exato**: eixo ausente ou inesperado reprova com
`P01-BASE44-CONTRACT`. A medição cobre `src/`, `vite.config.js` e as functions
preservadas. Documentação não conta como acoplamento executável.

Baseline: `scripts/gates/base44-baseline.json` (schema versão 2).

### `gate:types` — catraca de dívida

**O que verde significa aqui:**

```
gate:types verde  =  nenhuma regressão sobre a dívida legada versionada
gate:types verde  ≠  typecheck sem erros
```

Enquanto o baseline não chegar a zero, o projeto **tem** erros de tipo. A dívida
bruta está sempre visível em `npm run typecheck:raw`.

- Cobertura: `jsconfig.typecheck.json` inclui todo o `src/` (`.js`, `.jsx`,
  `.ts`, `.tsx`), **sem** excluir `src/components/ui`, `src/api` ou `src/lib`.
  As únicas exclusões são `node_modules`, `dist`, `dist-ssr` e `coverage`.
- Fingerprint: `caminho relativo | código TS | mensagem normalizada`. Linha e
  coluna **não** entram na identidade — deslocar código não pode transformar
  dívida antiga em erro novo.
- Multiplicidade preservada: três ocorrências do mesmo fingerprint comparam três.
- Reprova em: fingerprint novo, multiplicidade aumentada, arquivo com mais erros
  que o baseline, configuração divergente da registrada, ou falha do compilador
  sem diagnóstico parseável (`P01-TYPE-RUNNER`).

Baseline: `scripts/gates/typecheck-baseline.json` (schema versão 1), com
`version`, `project`, `command`, `total`, `byFile` e `fingerprints`.

**Estado atual:** 2.803 diagnósticos de dívida legada. P1 deve reduzi-los
monotonicamente (DBT-03).

## Fechamento de escopo dentro das functions

`gate:product-scope` não se contenta com a pasta da function existir. Ele lê o
código de `base44/functions/**` e reprova quando:

- uma chave-fonte de `PROPAGATION_RULES` está fora de `allowedBase44Entities`;
- um destino `entity: 'X'` está fora do manifesto;
- há acesso dinâmico literal (`entities.X`, `entities['X']`) fora do manifesto;
- uma entidade de `forbiddenBase44Entities` é citada em código executável;
- a function invoca outra function fora de `allowedBase44Functions`.

## Smoke automatizado

`npm run test:smoke` roda Vitest + jsdom + Testing Library. Nenhuma chamada real
a Base44, Google, rede ou geolocalização: `fetch` e `XMLHttpRequest` são
bloqueados no setup, e qualquer `console.error` inesperado ou unhandled
rejection reprova o teste.

Cobertura mínima: registro das 16 páginas, importabilidade de cada uma, raiz
apontando para `/MapaGeral`, fallback do `MapaGeral` sem chave, `MapaCadastro`
com SDK mockado, montagem do `App`, e o contrato completo do carregador do
Google Maps (idempotência, concorrência, timeout, retentativa, ausência de DOM).

## Integração contínua

`.github/workflows/quality.yml` roda `npm ci` e `npm run verify:all` em
`pull_request` e em `push` para `main`. Node vem de `.nvmrc`. O workflow apenas
chama os scripts oficiais — nenhuma lógica de gate é duplicada em YAML.

## Alterações de escopo

Ampliar `config/mapa-manejo-scope.json` para admitir módulo, página ou entidade
nova exige registro em `docs/engineering/DECISIONS.md`. Agente de IA não amplia
o escopo sozinho — propõe e aguarda aprovação (A11).

## Gates futuros

| Gate | Missão | Verifica |
|---|---|---|
| `gate:apis` | P1 | Componente não acessa provider de dados direto |
| `gate:tenancy` | P3 | Todo model Prisma tem `cliente_id` |
| `gate:indices` | P3 | `@@index`/`@@unique` começam por `cliente_id` |
| `gate:no-base44` | P7 | Zero referências. Substitui a catraca |
| `gate:rls` | P8 | Toda tabela tem policy de RLS |

Quando o baseline de tipos chegar a zero, `gate:types` deixa de ser catraca e
passa a exigir ausência total de diagnósticos.
