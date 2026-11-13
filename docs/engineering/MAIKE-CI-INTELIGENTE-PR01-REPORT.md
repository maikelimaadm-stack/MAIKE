# MAIKE-CI-INTELIGENTE-PR01 — CI rápida para documentação, completa para código

**Decisão:** [D-PROD-179](./DECISIONS.md). **Registro:** [`GATE-REGISTRY.md`](./GATE-REGISTRY.md), seção "Integração contínua".
**Natureza:** só infraestrutura de CI. Não muda código de produto, banco, Prisma, migrations, escopo, permissões nem a constituição.

## 1. Estado inicial

| Item | Valor |
|---|---|
| `origin/main` de partida | `da9fb314ea7089968b2747d6ac7f846be1f31728` (merge da PR #253) |
| Gate zero | PR #253 **mergeada** em 2026-11-13T12:06:54Z. A D-PROD-177 está no `00` (2 ocorrências), no `07` (1) e tem a nota de ratificação no `DECISIONS.md`. A missão não alterou a ratificação |
| Branch | `claude/maike-ci-inteligente-pr01`, criada a partir de `origin/main` |
| Workflow antes | um job `verify` (check `verify:all`) que sempre rodava `npm run verify:all` com PostgreSQL 16.13 efêmero, `timeout-minutes: 30` |
| CI da `main` no início | run 43422451165 (push de `da9fb314`) em andamento; a do push de `b7e5ab11` (#252) foi cancelada pela concorrência |

## 2. Desenho

```text
classify ──┬── verify:docs-fast   (só quando a PR muda apenas Markdown de documentação)
           └── verify:full        (todo o resto, e sempre em push na main)
                     │
                verify:all        (sempre roda; é o único check exigido)
```

- **`classify`**
  - Roda `scripts/ci/quality-profile.mjs` na versão do commit **base** da PR: `ref: pull_request.base.sha`, checkout esparso de `scripts/ci`, `persist-credentials: false`.
  - Tem só `contents: read` e `pull-requests: read`.
  - Se a base ainda não tem o classificador (o caso desta PR), o perfil é `full`.
  - Escreve `mode`, `reason` e `files_count` no `GITHUB_OUTPUT` e no resumo da run.
- **`verify:docs-fast`**
  - Não tem `services`, PostgreSQL, `DATABASE_URL`, backend, Vitest nem build.
  - Roda `npm ci`, porque o `gate:product-scope` importa `typescript`.
  - Depois, em passos separados, sem `continue-on-error`: `gate:governance-paths`, `gate:package-sync`, `gate:product-scope`, `gate:no-secrets`, `gate:deploy-migrations` e `test:gates`.
- **`verify:full`**: o job anterior, igual. PostgreSQL 16.13 efêmero, `DATABASE_URL`, `AUTH_SECRET` e `FRONTEND_ORIGINS` do job, NODE_ENV não definido, alias `maike-alvo-teste`, `npm ci`, `npm run verify:all` e 30 min de limite.
- **`verify:all`** (agregador)
  - `needs: [classify, docs-fast, full]`, `if: always()`.
  - Só passa em duas combinações:
    - `DOCS_FAST_PASS`: classify success, mode `docs_fast`, docs-fast success, full skipped, **e** evento `pull_request` com `GITHUB_BASE_REF` igual à branch padrão (defesa em profundidade);
    - `FULL_PASS`: classify success, mode `full`, full success, docs-fast skipped.
  - Qualquer outra combinação reprova.
  - Lê só variáveis de ambiente, sem interpolar `${{ }}` no script.
  - O resumo diz, no modo docs, que a suíte completa não rodou.
- **Gatilho:** igual ao anterior (`pull_request`, e `push` em `main`), sem `paths`/`paths-ignore` e sem `pull_request_target`. A concorrência `quality-${{ github.ref }}` com `cancel-in-progress` foi mantida.

### 2.1 Regras do classificador (fail-closed)

| Situação | Perfil | `reason` |
|---|---|---|
| `push` (inclusive merge só de docs) | full | `push_sempre_full` |
| Outro evento (`merge_group`, `workflow_dispatch`, …) | full | `evento_<nome>` |
| PR contra branch que não é a padrão (ou base/padrão ausente) | full, sem consultar a API | `base_nao_padrao` |
| Todos os arquivos `docs/**/*.md` ou `README.md`/`README_AI.md`/`CLAUDE.md`/`AGENTS.md` na raiz, `added`/`modified` | docs_fast | `somente_documentacao` |
| Algum arquivo de código, config, script, `.github`, lockfile, SQL/Prisma, JSON/YAML ou Markdown fora de `docs/` | full | `arquivo_nao_documental:<arquivo>` |
| Documento lido por etapa que só roda no full (`DOCS_ACOPLADOS`) | full | `documento_acoplado_a_teste` |
| Arquivo removido, renomeado, copiado ou com estado desconhecido | full | `estado_<status>` |
| Caminho com `..`, `/` inicial, `\`, NUL ou segmento vazio | full | `caminho_invalido` |
| Lista vazia ou inválida, arquivo repetido, contagem ≠ `changed_files` | full | `lista_vazia`, `lista_invalida`, `arquivo_repetido`, `contagem_divergente` |
| Mais de 3.000 arquivos (limite da API) | full | `acima_do_limite_listavel` |
| HEAD da PR mudou antes ou depois da listagem | full | `head_divergente` |
| Falha HTTP, sem token, evento ilegível, paginação incompleta | full | `falha_*`, `evento_ilegivel`, `paginacao_incompleta` |

Rótulo, título, descrição e autor da PR não entram na decisão. O teste QP-E2 manda título e rótulo "docs_fast" junto com código, e o resultado é `full`.

O motivo que vai para o `GITHUB_OUTPUT` e para o resumo passa por `motivoSeguro`, que troca por `_` qualquer caractere fora de `[A-Za-z0-9_./:@+-]`. Como o nome do arquivo vem da PR, isso impede quebra de linha, `|` e crase.

### 2.2 Documentos acoplados a etapas do full

Primeiro foi preciso saber quem lê Markdown.
- **Trace dinâmico.** Um hook de `fs`, só local, rodou nos 30 gates estáticos do `verify:all`. Três leem `.md` de `docs/` ou da raiz: `governance-paths`, `no-secrets` e `deploy-migrations`, que lê `docs/engineering/DEPLOY-MIGRATION-01-PRODUCTION-MIGRATION-BARRIER-REPORT.md`. Os três estão no docs-fast.
- **Busca estática nas etapas pesadas.** Em `test:backend`, `test:smoke`, lint e build, um teste do Vitest lê um documento: `tests/smoke/maplibreR6StyleRetry.test.js:27` lê `docs/engineering/MAPLIBRE-M1-EDITOR-AREAS-REPORT.md`. Esse documento entrou em `DOCS_ACOPLADOS` e vai sempre para `full`.
- **Teste-guarda QP-G1, no `test:gates`.** Varre `src`, `apps`, `backend`, `tests`, `scripts` e `api`, menos os arquivos que o docs-fast executa e os roteiros manuais `tests/e2e/` (nenhuma etapa os executa; eles só gravam evidências em `docs/`).
  - **O que procura**, em literais de string sem espaço:
    - caminhos Markdown de documentação, depois de normalizados: tira `${…}/`, `./` e `../` e corta antes de um `docs/` interno. Isso cobre `new URL('../../docs/…md')`, `` `${ROOT}/docs/…md` ``, `'../../CLAUDE.md'` e `'./README.md'`;
    - diretórios de `docs/` (`join(ROOT, 'docs', …)`, `readdirSync('docs/x')`).
  - Reprova se algum caminho ficar fora de `DOCS_ACOPLADOS`. Prosa com espaço ("Ver docs/…") cita um documento, não o lê, e por isso fica de fora. O QP-G3 fixa as formas detectadas.
  - **Provas RED, com os arquivos de sonda removidos depois:**
    - o caminho do teste do MapLibre trocado por `docs/engineering/DECISIONS.md`;
    - um teste de backend com `new URL("../../docs/engineering/DECISIONS.md", import.meta.url)`;
    - um teste de backend com `join(process.cwd(), "docs", "x")`.

    Nos três casos o QP-G1 reprovou.

## 3. Arquivos

| Arquivo | Mudança |
|---|---|
| `.github/workflows/quality.yml` | 4 jobs: `classify`, `verify:docs-fast`, `verify:full` (o antigo) e `verify:all` (agregador) |
| `scripts/ci/quality-profile.mjs` | novo. Funções puras (`classifyChangedFiles`, `decideQualityProfile`), consulta paginada somente leitura e CLI |
| `scripts/tests/gates/quality-profile.test.mjs` | novo. 44 testes, rodam no `test:gates` |
| `docs/engineering/DECISIONS.md` | D-PROD-179; marcador para D-PROD-180 |
| `docs/engineering/GATE-REGISTRY.md` | seção "Integração contínua" atualizada |
| `docs/engineering/MAIKE-CI-INTELIGENTE-PR01-REPORT.md` | este relatório |

`package.json`, gates existentes, `verify-all.mjs`, código de produto, banco e branch protection não foram alterados.

## 4. Testes novos (`scripts/tests/gates/quality-profile.test.mjs`)

| Grupo | Casos | O que prova |
|---|---|---|
| QP-C1..C10 | conjunto de arquivos | só DECISIONS, 00/07 e raiz → fast. docs + backend, `.github/workflows`, `scripts/ci`, `package.json`, lockfile, Prisma, migration, `src`, `config`, `.nvmrc`, `.txt`/`.json`/`.yml` em docs, `README.md` de `src`/`apps`, `.MD` → full. Removido, renomeado, caminho suspeito, vazio, repetido, contagem divergente, mais de 3.000 e documento acoplado → full |
| QP-D1..D6 | evento, base e consistência | push → full mesmo só com docs; evento desconhecido → full; PR contra outra branch (ou base/padrão ausente, ou caixa diferente) → full; HEAD divergente, falha de API, paginação incompleta e `changed_files` inválido → full |
| QP-P1..P7 | paginação | 250 arquivos em 3 páginas; exatamente 200 (a página vazia confirma o fim); páginas curtas; push no meio; HTTP 502; fetch que lança; mais de 3.000 sem listar |
| QP-E1..E7 | CLI de ponta a ponta | processo separado contra API HTTP local: `GITHUB_OUTPUT` correto, token nunca impresso, rótulo "docs_fast" ignorado, sem token → full, push → full sem consulta, PR contra outra branch → full com 0 pedidos à API, nome de arquivo com `\|`, crase e quebra de linha não injeta saída, evento ilegível → full |
| QP-R1..R5 | agregador `verify:all` | o script **extraído do próprio workflow** roda no bash: as 2 combinações válidas passam (full também em push); 18 inválidas reprovam (falha, cancelado, ambos pulados, ambos rodados, classify falho, modo inválido ou vazio, variáveis ausentes); `docs_fast` em push, `merge_group`, evento vazio, base diferente ou vazia e branch padrão vazia reprova; sem `${{ }}` no script |
| QP-W1..W6 | estrutura do workflow | um único `verify:all`; sem `paths`/`pull_request_target`/`write`; concorrência mantida; docs-fast sem `services`/postgres/`DATABASE_URL` e com a lista exata de comandos; full com PG 16.13, env, alias, `npm ci`, `verify:all` e 30 min; classify lê o classificador da base |
| QP-G1..G3 | guarda | documentos acoplados (ver §2.2); formas de caminho detectadas; a lista não guarda arquivo inexistente |

O teste já existente `build-environment.test.mjs` (ENV-B1/B2, NODE_ENV fora do workflow e o comentário explicativo) continua passando sem alteração.

## 5. Evidências locais

Ambiente: Node 22.22.0 local; a CI usa o `.nvmrc`, 20.19.0. O código novo usa só APIs que existem no Node 20 (`fetch`, `node:http`, `node:child_process`).

| Comando | Resultado |
|---|---|
| `node --test scripts/tests/gates/quality-profile.test.mjs` | 44/44 pass (o revisor também rodou a versão anterior, 39/39, no Node 20.20) |
| Mutação: checagem de base desligada | QP-D6 e QP-E6 reprovam (0/2); restaurada, 44/44 |
| `npx eslint scripts/ci/quality-profile.mjs scripts/tests/gates/quality-profile.test.mjs` | exit 0 |
| Simulação do docs-fast (6 comandos, sem `DATABASE_URL`, sem PostgreSQL) | 6/6 exit 0 em 74,5 s locais. `test:gates`: 778/778 (739 anteriores + 39 novos) |
| `npm run verify:all` integral (PostgreSQL 17 local descartável, banco novo) | ver §5.1 |

### 5.1 `verify:all` integral local

A execução integral começou em 2026-11-13T12:16:46Z, no commit de código `26fcc415`, num PostgreSQL 17.11 local descartável com banco novo e vazio, sem `NODE_ENV`. Ainda estava rodando quando este relatório foi commitado. O resultado, com exit code e contagens, fica na descrição da PR.

A evidência oficial é a da CI: o job `verify:full` desta PR roda o mesmo `npm run verify:all` integral no PostgreSQL 16.13 do workflow, no SHA final.

## 6. CI

- Esta PR altera `.github/workflows/` e `scripts/`. O classificador da base ainda não existe, então o perfil é **full**: a CI desta PR roda o `verify:all` integral no job `verify:full`.
- O status do HEAD final vai na descrição da PR e no relatório da missão.
- **Tempo:** o baseline é o do próprio workflow ("16,5–18 min na `main`, passa de 20") e das runs anteriores (por exemplo, run 43357755295: 24 min 42 s, só de documentação).
  - O tempo do `docs_fast` **na CI** só existe depois do merge, na primeira PR só de documentação. Aqui há apenas a medida local da §5, e não afirmo nenhum ganho em minutos na CI.

## 7. Riscos e limites

| Risco | Tratamento |
|---|---|
| PR só de docs quebra algo que só o full exercita | `DOCS_ACOPLADOS` + guarda QP-G1; push na `main` sempre roda o full depois do merge |
| Leitura de Markdown por caminho montado em tempo de execução, que a busca de literais não vê | QP-G1 também reprova literal `'docs'` fora do docs-fast; hoje há zero ocorrências |
| PR altera o classificador para se declarar docs | o classificador vem da base; `scripts/ci/**` → full |
| PR altera o próprio workflow | inerente ao `pull_request` (vale também para o workflow antigo); `.github/**` → full pelo classificador da base, e mudança de workflow exige revisão humana |
| Branch protection exigir outro nome de check | o nome `verify:all` foi mantido no agregador. Não consultei nem alterei as regras da branch |
| `always()` em run cancelada pela concorrência | o agregador vê `cancelled` e reprova num SHA já superado; o SHA novo tem a própria run |
| Node 20 da CI × Node 22 local | só APIs do Node 20; a CI (full) confirma no `.nvmrc` |
| PR de docs aprovada com base antiga, enquanto a `main` ganha um documento acoplado novo | o push da `main` roda o full e pega depois do merge. Recomendação, não aplicada (exige o proprietário): exigir "branch atualizada" na proteção da `main` |
| PR que altera `quality.yml` | recomendação, não aplicada: CODEOWNERS em `.github/` e `scripts/ci/` |
| Link simbólico chamado `*.md` | a API não informa o modo do arquivo; o revisor não achou efeito prático (o ESLint não segue o link). Hipótese registrada |
| QP-W5 confere trechos, não o job inteiro | o revisor fez o diff manual do job antigo contra o `verify:full`: idêntico, a menos de `name`, `needs`, `if` e uma linha em branco |

## 8. Revisão cética independente

Um agente só de leitura, sem acesso ao meu raciocínio, revisou o commit `26fcc415`. Resultado:

| Achado | Severidade | Destino |
|---|---|---|
| B1: `docs_fast` decidido contra uma base que não é a `main` continua verde depois que a PR é redirecionada para a `main` (trocar a base não dispara o workflow) | bloqueante | **corrigido**: `base_nao_padrao` no classificador e checagem de evento e base no agregador; QP-D6, QP-E6 e QP-R5 com prova por mutação |
| I1: o guarda não via `new URL('../../docs/…')`, `${ROOT}/docs/…`, `join(ROOT,'docs/x','X.md')`, `../../CLAUDE.md` | importante | **corrigido**: normalização e diretórios de docs; QP-G3 e duas provas RED |
| I2: `scripts/gates/lib/` excluído do guarda, mas também serve gates só do full | importante | **corrigido**: saiu da exclusão |
| M1: "push → full" dependia só do classificador | menor | **corrigido** junto com o B1 (agregador exige `pull_request`) |
| M3: nome de arquivo entrava cru no resumo | menor | **corrigido**: `motivoSeguro`; QP-E7 |
| M2, M4, M5, M7 | menor | registrados na §7 |
| M6: documentos fora do commit de código | menor | já resolvido no commit `4023edf6` |

O que o revisor confirmou sem achado:
- o agregador fecha em falha, inclusive com cancelamento, job pulado e modo vazio; o bash compara exato, mesmo com o `==` do Actions não diferenciando maiúsculas;
- o checkout esparso inclui `.nvmrc`;
- não há injeção no `GITHUB_OUTPUT`;
- o `verify:full` é idêntico ao job antigo;
- **invariante 4, por trace de leituras de arquivo**: nos 29 gates estáticos, só `governance-paths`, `no-secrets` e `deploy-migrations` leem documentação, e os três estão no docs-fast. No `test:smoke` (214 arquivos), só o relatório do MapLibre, que está em `DOCS_ACOPLADOS`. `lint`, `typecheck:backend` e `gate:types` não leem nenhum `.md`.
