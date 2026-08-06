# P2 — ModeloBase1 Pecuário Foundation — Relatório

**Missão:** P2 · **Data:** 2026-08-06 · **Decisão:** D-PROD-21
**Base:** `main` no merge `7398d85ab16a788c7d85f34dc9b76611bc60c5fe` (PR #6)
**Branch:** `claude/p2-modelobase1-pecuario-foundation`

---

## 1. O que a missão fez

Transformou identidade, tenancy, timestamps, auditoria, numeração, anexos,
exclusão, concorrência e vocabulário de erro em **contrato oficial, versionado e
verificável** para o backend que começa na P3.

Não criou backend, não instalou Prisma, não gerou `schema.prisma`, não escreveu
migration e não tocou em `src/`, `base44/`, rotas, menu ou escopo.

## 2. Esclarecimento de nome — por que ele era necessário

"ModeloBase1" é um nome carregado. No PROJETOMG ele significa `src/ModeloBase1/`:
o motor visual certificado de cadastro, com página fina de ~10 linhas, painéis de
tabela/formulário/busca, hooks de preferência, config factory e Template
Registry.

Importar esse significado para o MAIKE seria importar exatamente o que a
D-PROD-03 proíbe — runtime universal de telas e plataforma low-code — e seria
absurdo por um motivo mais simples: o MAIKE já tem as telas dele, migradas para a
fronteira nativa ao longo de toda a P1.

**D-PROD-21** fixa o significado local: ModeloBase1 Pecuário é **contrato de
dados/backend**. Não é template visual, não cria runtime genérico, não cria
low-code, não substitui as telas atuais, e é contrato obrigatório para P3–P6.

A decisão foi acrescentada em `docs/engineering/DECISIONS.md` de forma
append-only. Nenhuma decisão anterior foi apagada ou reescrita.

## 3. Arquivos

### Criados

| Caminho | Papel |
|---|---|
| `config/modelobase1-pecuario.json` | SSOT executável do contrato |
| `docs/architecture/MODELOBASE1-PECUARIO-CONTRACT.md` | leitura humana, 17 seções |
| `scripts/gates/gate-modelobase1-pecuario.mjs` | gate absoluto |
| `scripts/tests/gates/modelobase1-pecuario.test.mjs` | 37 testes (MB1-01 a MB1-20 com sub-casos) |
| `docs/engineering/P2-MODELOBASE1-PECUARIO-FOUNDATION-REPORT.md` | este relatório |

### Alterados

| Caminho | Mudança |
|---|---|
| `package.json` | script `gate:modelobase1-pecuario` — **nenhuma dependência adicionada** |
| `scripts/gates/verify-all.mjs` | etapa `modelobase1-pecuario` entre `base44` e `types` |
| `docs/engineering/DECISIONS.md` | D-PROD-21, append-only |
| `docs/engineering/CURRENT-STATE.md` | P1 mergeada, P2 em andamento, gate novo, métricas |
| `docs/engineering/ROADMAP.md` | P1 concluída, P2 descrita e em PR, P3 não iniciada |
| `docs/engineering/GATE-REGISTRY.md` | gate, 11 códigos, ordem do `verify:all`, seção própria |
| `README_AI.md` | estado, inventário, 14 etapas, índice de relatórios |
| `AGENTS.md` | **fora da lista da missão — justificativa abaixo** |

**Justificativa para `AGENTS.md`:** ele é a SSOT de comandos operacionais
(item 9 da leitura obrigatória) e contém a tabela completa de gates e a contagem
de etapas do `verify:all`. Adicionar um gate sem registrá-lo ali deixaria o
documento ativamente errado por causa desta PR. A edição foi mínima: uma linha na
tabela de gates, `12 etapas` → `14 etapas` e a correção de `2.802` → `2.319` na
armadilha de tipos, número que já estava defasado desde a P1.4.

`CLAUDE.md` **não** foi alterado: ele aponta para `CURRENT-STATE.md` em vez de
duplicar estado, e nada nele contradiz a `main`.

**Não editados:** `src/`, `base44/`, `vite.config.*`,
`config/mapa-manejo-scope.json`, `package-lock.json`. Nenhum `npm install` foi
executado — apenas `npm ci`, que instala a partir do lockfile sem alterá-lo.

## 4. O contrato

`config/modelobase1-pecuario.json`, versão 1, status `official`, `meaning`
`persistence-domain-contract`, `productScope` `pecuaria-mapa-geral-manejo`.

Onze seções: `identity`, `tenancy`, `timestamps`, `audit`, `numbering`,
`attachments`, `deletion`, `concurrency`, `errorCodes`, `prohibitedPatterns`,
`p3Handoff`.

| Área | Regra central |
|---|---|
| Identidade | `id String @default(cuid())`, nunca fornecido pelo cliente, imutável; código de negócio não é PK |
| Tenancy | `Cliente` é raiz e **única** exceção sem `cliente_id`; catálogo global vazio; tenant vem de `auth_context`; unique e índice sempre tenant-first |
| Timestamps | `createdAt`/`updatedAt` obrigatórios; autoridade é o banco |
| Auditoria | timestamps por model **+** `AuditLog` central tenant-scoped; ator da sessão; sem segredo no payload; falha crítica observável |
| Numeração | sequência atômica e transacional; `max + 1` e `count + 1` proibidos; número não reutilizado |
| Anexos | `storage_key` é a identidade; URL nunca é; sem binário no PostgreSQL; provedor não decidido |
| Exclusão | hard delete só com vínculo autorizado; sem soft delete global; lifecycle por capacidade |
| Concorrência | transação em operação composta crítica; unique como última barreira; sem saga |

### Detalhe que não estava na especificação e precisou de desenho

A chave conceitual da sequência é `[cliente_id, entidade, escopo_tipo,
escopo_id]`, com `escopo_id` opcional. No PostgreSQL, `NULL` nunca é igual a
`NULL` num índice unique — então, no escopo `tenant`, duas linhas de sequência
para a mesma entidade coexistiriam e distribuiriam números em paralelo. O unique
não barraria nada, e o sintoma só apareceria sob concorrência.

O contrato registra o risco em `numbering.sequenceModel.nullScopeHazard`, lista
as duas representações aceitas (valor sentinela não nulo, ou unique parcial por
tipo de escopo), proíbe `escopo_id` nulo em unique comum e delega a escolha à P3.
O gate exige que essa seção exista e que a representação proibida esteja
declarada.

## 5. O gate

`npm run gate:modelobase1-pecuario` · `scripts/gates/gate-modelobase1-pecuario.mjs`

**Absoluto, não catraca.** Sem `--update`, sem baseline, sem modo de correção e
sem escrita no arquivo — nem quando o contrato está inválido. Contrato quebrado
se conserta no contrato, com revisão humana.

Onze códigos de falha: `P2-MB1-CONTRACT-MISSING`, `P2-MB1-CONTRACT-INVALID`,
`P2-MB1-CONTRACT-VERSION`, `P2-MB1-CONTRACT-SHAPE`, `P2-MB1-TENANCY`,
`P2-MB1-IDENTITY`, `P2-MB1-AUDIT`, `P2-MB1-NUMBERING`, `P2-MB1-ATTACHMENT`,
`P2-MB1-PROHIBITED`, `P2-MB1-HANDOFF`.

As 23 exigências do gate estão tabeladas em `docs/engineering/GATE-REGISTRY.md`.

**Posição no `verify:all`:** depois de `base44`, antes de `types`. Ele lê um JSON
e custa milissegundos; reprovar antes do `tsc` economiza ~40 s por falha.

## 6. Testes

`scripts/tests/gates/modelobase1-pecuario.test.mjs` — **37 testes**, todos
executando o gate real em diretórios temporários, sobre contratos **mutados a
partir do contrato real do repositório**. Nenhum teste procura palavra em prosa.

MB1-01 válido · MB1-02 ausente · MB1-03 JSON inválido · MB1-04 versão (+ status)
· MB1-05 `meaning` de template visual (+ `contractId`, + seção ausente) · MB1-06
tenant do request (+ fonte proibida removida) · MB1-07 segunda exceção (+
catálogo global) · MB1-08 unique sem tenant · MB1-09 índice sem `cliente_id`
primeiro (+ unique da sequência) · MB1-10 `max + 1` · MB1-11 `count + 1` (+
estratégia proibida como oficial) · MB1-12 sequência não transacional (+
incremento não atômico, + `nullScopeHazard` ausente) · MB1-13 URL como identidade
(+ anexo sem tenant, + binário no banco) · MB1-14 `AuditLog` sem tenant (+
`cliente_id` opcional) · MB1-15 ator do body (+ segredo permitido no payload) ·
MB1-16 código de erro ausente (+ HTTP não-erro) · MB1-17 padrão proibido ausente
(+ sem descrição) · MB1-18 handoff incompleto (+ `authorizedInP2: true`) · MB1-19
o gate não reescreve arquivo inválido, nem com flag de correção · MB1-20 o
contrato real passa (+ asserções diretas sobre o contrato versionado).

`npm run test:gates` passou de **323 para 360** testes.

## 7. Verificação

```
npm run gate:modelobase1-pecuario          PASSOU
node --test scripts/tests/gates/modelobase1-pecuario.test.mjs   37/37
npm run gate:governance-paths              PASSOU
npm run lint                               0 erros
npm run verify:all                         14/14 PASS, exit 0
```

O resumo do `verify:all` está colado na §13 deste relatório.

**A CI não pode estar aqui.** Um commit não pode conter o resultado da própria
execução — o run e o job do commit funcional ficam registrados no **corpo da PR**.
É por isso que a P2 não se declara concluída dentro do próprio commit.

**Nota de ambiente:** o `.nvmrc` fixa Node 20.19.0 e a CI usa exatamente essa
versão. Esta sessão executou em Node 22.22.2, a única disponível no container. O
código novo usa apenas API presente no Node 20 (`node:fs`, `node:path`,
`node:test`, `JSON`) — sem `fs.globSync`, sem `Object.groupBy`, sem
`Array.prototype.toSorted`. A verificação definitiva é a CI, e o run fica no
corpo da PR.

## 8. Preservação da P1

| Invariante | Estado |
|---|---|
| `gate:api-boundary` | **0/0/0/0/0/0** — as seis listas do baseline continuam vazias |
| Registry literal do provider | **38** entidades |
| `gate:base44` | não aumentou em nenhum eixo |
| `gate:types` | 2.319 diagnósticos, teto 2.319 — inalterados |
| `npm run lint` | 0 erros |
| `gate:source-closure` | PASS |
| `gate:import-integrity` | PASS |
| `gate:no-secrets` | PASS |
| `npm run build` | preservado |

Nenhum arquivo de `src/` foi lido para escrita nesta missão.

## 9. Qualidade, escalabilidade e riscos

| # | Pergunta | Resposta |
|---|---|---|
| Q1 | contrato simples o suficiente para a P3? | sim — 11 seções, um JSON, sem indireção. A P3 lê o arquivo e escreve models |
| Q2 | criou framework genérico? | não. Sem runtime, sem registry, sem motor. O único código novo é um validador de JSON de ~450 linhas |
| Q3 | tenancy definida desde o primeiro model? | sim, e com o tipo de model explícito (root/tenant/systemCatalog), o que impede "exceção temporária" na P3 |
| Q4 | índices e unique tenant-aware? | sim, e o gate exige `cliente_id` como primeira coluna, não apenas como membro |
| Q5 | numeração segura para concorrência? | sim — sequência atômica em transação, com o risco de `NULL` no unique resolvido por desenho antes da primeira migration |
| Q6 | anexos independentes de provider? | sim — `storage_key` é a identidade, URL é efêmera, provedor não decidido |
| Q7 | auditoria sem segredo? | sim — `senha`, `credencial`, `segredo` e conteúdo binário são proibidos no payload, e o ator vem da sessão |
| Q8 | a P3 consegue implementar sem redesenhar a P2? | sim. O que ficou aberto ficou **nomeado** (§15 do documento arquitetural): representação de `escopo_id`, forma do `auth_context`, política de `onDelete` de `Cliente` |

### Riscos preservados, não resolvidos

| Risco | Estado |
|---|---|
| OWNER-SECURITY-01 | **aberto** — chave do Google Maps no histórico Git, pendente com o proprietário |
| Base44 | temporária até a P7 |
| Dívida de tipos | 2.319 diagnósticos, teto 2.319 |
| Bundle | ~2,50 MB, sem code splitting (DBT-06) |
| `npm audit` | pendente (DBT-11) |
| Operações Base44 sem ACID | DBT-19, aberto até a P3 |
| Backend | inexistente até a P3 |

Nenhum deles é escopo desta missão.

## 10. Divergências em relação ao PROJETOMG

| Divergência | Justificativa |
|---|---|
| `AuditLog.cliente_id` **obrigatório** (lá é nullable com `onDelete: SetNull`) | log de auditoria sem tenant não é auditável em sistema multi-tenant; a exceção existe lá por herança de dados legados que o MAIKE não tem |
| Sem `id_global` | numeração global de registro não tem consumidor no Mapa Geral + Manejo. Entra por decisão se algum dia tiver |
| `RegistroAnexo` sem `file_url` de primeira classe | identidade é `storage_key`; URL de provider é efêmera |
| Sequência com `escopo_tipo`/`escopo_id` (lá é `[cliente_id, entity_name]`) | o produto precisa de escopo por empresa em algumas capacidades. O custo é o risco de `NULL`, tratado explicitamente |
| Nada de `src/ModeloBase1/`, MDP, MMM, CADCPS, Marketplace, Studio | D-PROD-03 e D-PROD-21 |

## 11. Decisões que precisam de aprovação humana

1. **O merge da PR.** O contrato só é oficial depois dele. Até lá existe e é
   verificado, mas não está aprovado — e nenhuma migration de domínio pode
   começar.
2. **`gate:tenancy` e `gate:indices`** ficam para a P3, conforme o registro de
   gates futuros. A P2 não os cria porque, sem `schema.prisma`, não teriam o que
   ler.

## 12. Estado da PR

Draft. Não marcada como ready, não mergeada, não fechada. A P3 **não** foi
iniciada.

## 13. `npm run verify:all` — saída

Executado com `set -o pipefail` e `tee`, com o status lido de `PIPESTATUS[0]`,
conforme a disciplina registrada em `docs/engineering/GATE-REGISTRY.md`.

```
  ETAPA                RESULTADO   EXIT    DURAÇÃO  COMANDO
  test:gates           PASS           0      76.2s  npm run test:gates
  governance-paths     PASS           0      308ms  npm run gate:governance-paths
  package-sync         PASS           0      203ms  npm run gate:package-sync
  product-scope        PASS           0      732ms  npm run gate:product-scope
  api-boundary         PASS           0       1.7s  npm run gate:api-boundary
  source-closure       PASS           0      247ms  npm run gate:source-closure
  import-integrity     PASS           0      223ms  npm run gate:import-integrity
  no-secrets           PASS           0      567ms  npm run gate:no-secrets
  base44               PASS           0      202ms  npm run gate:base44
  modelobase1-pecuario PASS           0      191ms  npm run gate:modelobase1-pecuario
  types                PASS           0      11.3s  npm run gate:types
  lint                 PASS           0       5.0s  npm run lint
  test:smoke           PASS           0      13.8s  npm run test:smoke
  build                PASS           0      15.1s  npm run build

  Total: 125.7s

TODAS AS ETAPAS PASSARAM
```

Linhas de contrato dentro dessa execução:

```
gate:api-boundary — legado: 0 arquivo(s) importam o client, 0 usam entities
gate:api-boundary — PASSOU (0 arquivo(s) legado(s) restante(s))
gate:base44 — medição atual: {"arquivosComSdk":4,"importsSdk":1,"entitiesRefs":38,
  "authRefs":10,"integrationsRefs":1,"functionsRefs":1,"vitePlugin":1,
  "runtimeConfigRefs":1,"schemas":38,"functionsBase44":1}
gate:modelobase1-pecuario — PASSOU (config/modelobase1-pecuario.json:
  11 seções, 8 códigos de erro, 10 padrões proibidos)
gate:types — diagnósticos atuais: 2319 em 140 arquivo(s)
gate:types — PASSOU (sem regressão sobre 2319; atual: 2319; teto certificado: 2319)
```

Registry literal do provider: **38 entidades**. `test:smoke`: 494 testes em 22
arquivos. `test:gates`: 360 testes.

Varredura do log completo por `Base44 SDK Error`, `Network Error`,
`AggregateError`, `ECONNREFUSED` e `ENOTFOUND`: **zero ocorrências**.
`git diff --check`: limpo.
