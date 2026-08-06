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
| **api-boundary** | `npm run gate:api-boundary` | A UI não fala com o provider de dados: fronteira `src/apis/` protegida por identidade de arquivo | D-PROD-18 | `scripts/gates/gate-api-boundary.mjs` |
| **source-closure** | `npm run gate:source-closure` | Todo arquivo executável em `src/` é alcançável a partir das entradas reais | D-PROD-12 | `scripts/gates/gate-source-closure.mjs` |
| **import-integrity** | `npm run gate:import-integrity` | Nenhum import estático em `src/` aponta para arquivo inexistente | D-PROD-02 | `scripts/gates/gate-import-integrity.mjs` |
| **no-secrets** | `npm run gate:no-secrets` | Nenhum segredo literal em **arquivo versionado ou não ignorado**; nenhum `.env` versionado | D-PROD-07 · D-PROD-14 | `scripts/gates/gate-no-hardcoded-secrets.mjs` |
| **base44** | `npm run gate:base44` | Acoplamento com a Base44 só diminui (catraca, 10 eixos) | D-PROD-04 | `scripts/gates/gate-base44-ratchet.mjs` |
| **modelobase1-pecuario** | `npm run gate:modelobase1-pecuario` | O contrato base de persistência e domínio: identidade, tenancy, timestamps, auditoria, numeração, anexos, exclusão, concorrência, códigos de erro, padrões proibidos e handoff da P3 | D-PROD-21 | `scripts/gates/gate-modelobase1-pecuario.mjs` |
| **types** | `npm run gate:types` | A dívida de tipos nunca cresce, em nenhum modo (catraca por fingerprint) | D-PROD-11 · D-PROD-13 · D-PROD-17 | `scripts/gates/gate-typecheck-ratchet.mjs` |
| **verify:all** | `npm run verify:all` | Toda a cadeia, na ordem abaixo | — | `scripts/gates/verify-all.mjs` |

## Ordem do `verify:all`

Contratos baratos primeiro, build por último:

```
test:gates → governance-paths → package-sync → product-scope → api-boundary
→ source-closure → import-integrity → no-secrets → base44
→ modelobase1-pecuario → types → lint → test:smoke → build
```

14 etapas desde a P2. `modelobase1-pecuario` entra depois dos gates
arquiteturais baratos e antes de `types`: ele lê um único JSON, custa
milissegundos e reprova antes de o `tsc` gastar ~40 s.

O resumo imprime nome, PASS/FAIL, código de saída, duração e comando executado.
Nenhuma etapa é ignorada nem tem o exit code convertido em sucesso.

## Códigos de falha

| Código | Gate |
|---|---|
| `P01-SCOPE-ROUTE` | product-scope |
| `P01-SCOPE-ENTITY` | product-scope |
| `P01-SCOPE-FUNCTION` | product-scope |
| `P01-SCOPE-FUNCTION-ENTITY` | product-scope |
| `P01-SCOPE-FUNCTION-DYNAMIC-UNVERIFIABLE` | product-scope |
| `P11-API-BOUNDARY-BASELINE` | api-boundary |
| `P11-API-BOUNDARY-REGRESSION` | api-boundary |
| `P11-API-BOUNDARY-SDK-IMPORT` | api-boundary |
| `P11-API-BOUNDARY-PROVIDER-LEAK` | api-boundary |
| `P11-API-BOUNDARY-DYNAMIC-ENTITY` | api-boundary |
| `P11-API-BOUNDARY-SCOPE` | api-boundary |
| `P11-API-BOUNDARY-LAYER-BYPASS` | api-boundary |
| `P11-API-BOUNDARY-PUBLIC-PROVIDER-LEAK` | api-boundary |
| `P11-API-BOUNDARY-SERVICE-BYPASS` | api-boundary |
| `P11-API-BOUNDARY-MODULE-INTERNAL-BYPASS` | api-boundary |
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
| `P01-TYPE-BASELINE-MISSING` | types |
| `P01-TYPE-SEED-FORBIDDEN` | types |
| `P01-TYPE-REGRESSION` | types |
| `P01-TYPE-RUNNER` | types |
| `P01-TYPE-CONTRACT` | types |
| `P01-TYPE-CONFIG-DRIFT` | types |
| `P01-TYPE-VERSION-DRIFT` | types |
| `P2-MB1-CONTRACT-MISSING` | modelobase1-pecuario |
| `P2-MB1-CONTRACT-INVALID` | modelobase1-pecuario |
| `P2-MB1-CONTRACT-VERSION` | modelobase1-pecuario |
| `P2-MB1-CONTRACT-SHAPE` | modelobase1-pecuario |
| `P2-MB1-TENANCY` | modelobase1-pecuario |
| `P2-MB1-IDENTITY` | modelobase1-pecuario |
| `P2-MB1-AUDIT` | modelobase1-pecuario |
| `P2-MB1-NUMBERING` | modelobase1-pecuario |
| `P2-MB1-ATTACHMENT` | modelobase1-pecuario |
| `P2-MB1-PROHIBITED` | modelobase1-pecuario |
| `P2-MB1-HANDOFF` | modelobase1-pecuario |
| `P01-PACKAGE-DRIFT` | package-sync |
| `P01-LOCKFILE-INVALID` | package-sync |
| `P01-SMOKE-FAILURE` | test:smoke |
| `P01-BUILD-FAILURE` | verify:all, etapa `build` |

## Catracas

Ambas seguem o mesmo contrato:

- **baseline ausente ou malformado é falha dura.** Execução normal **nunca** cria
  nem escreve o baseline. `gate:types` não tem mais nenhuma porta de semeadura
  (D-PROD-17): baseline perdido se restaura do Git.
- `--update` só grava quando **não há regressão** e **houve pelo menos uma
  redução**. A escrita é atômica (arquivo temporário + rename).
- O baseline é versionado no Git e tem versão de schema própria.
- **Nenhuma flag desativa a barreira de não regressão.** Quando ela dispara, o
  processo encerra com o baseline byte a byte intacto.

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

- Fingerprint: `caminho relativo | código TS | mensagem normalizada`. Linha e
  coluna **não** entram na identidade — deslocar código não pode transformar
  dívida antiga em erro novo.
- Multiplicidade preservada: três ocorrências do mesmo fingerprint comparam três.
- Reprova em: fingerprint novo, multiplicidade aumentada, arquivo com mais erros
  que o baseline, ou falha do compilador sem diagnóstico parseável
  (`P01-TYPE-RUNNER`).

#### A configuração faz parte do contrato (P0.1-R2, D-PROD-13)

Contar diagnósticos só significa alguma coisa se a **cobertura** também estiver
versionada. Sem isso, `checkJs: false`, `include: []` ou excluir `src/lib`
derrubariam os números e o gate ficaria verde sem nada ter melhorado.

O baseline grava e o gate compara:

| Campo | Papel |
|---|---|
| `projectPath` | qual arquivo de projeto foi usado |
| `projectSha256` | hash canônico do conteúdo, com a cadeia local de `extends`, sem caminho absoluto |
| `effectiveCommand` | argumentos exatos do compilador |
| `typescriptVersion` | versão do `tsc` que produziu os números |
| `coverageContract` | `checkJs`, `include`, `exclude`, arquivos da cadeia e os invariantes exigidos |

Independentemente do baseline, a configuração **atual** precisa cumprir:

- `checkJs: true`;
- `include` presente e não vazio, cobrindo `src/**/*.{js,jsx,ts,tsx}` na raiz e
  em profundidade;
- nenhuma exclusão que alcance `src/components/ui`, `src/api`, `src/lib` ou
  `src/services`;
- exclusões apenas em `node_modules`, `dist`, `dist-ssr`, `coverage` e fixtures
  fora de `src/`.

A verificação é mecânica: cada invariante é testado com caminhos-sonda contra o
glob real do `include`/`exclude`, não por comparação de texto.

| Situação | Código |
|---|---|
| a configuração atual viola a cobertura obrigatória | `P01-TYPE-CONTRACT` |
| a configuração mudou em relação ao baseline (caminho, hash, comando, cobertura) | `P01-TYPE-CONFIG-DRIFT` |
| a versão do TypeScript mudou | `P01-TYPE-VERSION-DRIFT` |

Mudança consciente de configuração ou de versão do compilador usa
`--rebase-contract`, uma flag separada de `--update`. **A cobertura obrigatória
não é rebaseável**: ela é validada antes de qualquer gravação.

#### A não regressão vale em todos os modos (P0.1-R3, D-PROD-17)

A versão anterior condicionava a falha por regressão a `&& !rebasear`. Com isso
`--rebase-contract` podia gravar um baseline com dívida **maior** — a própria
operação de rebase redefinia a dívida para cima. E foi o que aconteceu: o
baseline subiu de 2.803 para 2.808 absorvendo cinco diagnósticos de código novo.

Agora a barreira roda antes de qualquer escrita, em execução normal, `--update` e
`--rebase-contract`, e reprova com `P01-TYPE-REGRESSION` diante de:

- fingerprint novo;
- multiplicidade aumentada;
- arquivo com contagem maior;
- total maior que o do baseline;
- total acima do `certifiedCeiling`.

`--rebase-contract` atualiza **metadados de contrato**, não o teto de qualidade.
Ele só grava quando o contrato realmente mudou, a cobertura continua válida e
não há nenhuma regressão.

#### `certifiedCeiling` — o teto só desce

| Regra | Comportamento |
|---|---|
| tipo | inteiro não negativo, obrigatório no schema 3 |
| ausente ou inválido | `P01-TYPE-BASELINE` |
| `baseline.total > teto` | `P01-TYPE-BASELINE` (baseline incoerente) |
| total atual `>` teto | `P01-TYPE-REGRESSION` |
| gravação (`--update` / `--rebase-contract`) | grava `min(teto, total atual)` |
| execução normal | nunca altera o teto |

#### Sem semeadura

`--seed` foi removido. Baseline ausente reprova com `P01-TYPE-BASELINE-MISSING`
em todos os modos; passar `--seed` reprova com `P01-TYPE-SEED-FORBIDDEN`.
Fixtures de teste montam o próprio baseline — o gate de produção nunca semeia.

Baseline: `scripts/gates/typecheck-baseline.json` (schema versão 3).

**Estado atual:** 2.802 diagnósticos de dívida legada, teto certificado 2.802.
P1 deve reduzi-los monotonicamente (DBT-03).

Os testes de `scripts/tests/gates/typecheck-ratchet.test.mjs` executam o **gate
real** em projetos temporários com `tsc` de verdade — 27 casos de baseline, teto
e contrato, mais 11 casos dedicados a `--rebase-contract`, além dos casos
unitários de parser, glob e canonicalização e de quatro asserções sobre o
baseline versionado do próprio repositório.

## `gate:modelobase1-pecuario` — contrato base pecuário (D-PROD-21)

Não é catraca. **É absoluto**: sem `--update`, sem baseline, sem modo de
correção e sem escrita no arquivo — nem quando o contrato está inválido. Não
existe "estado herdado aceitável" num contrato que ainda não tem nenhuma
implementação.

| Item | Valor |
|---|---|
| Comando | `npm run gate:modelobase1-pecuario` |
| Script | `scripts/gates/gate-modelobase1-pecuario.mjs` |
| Arquivo protegido | `config/modelobase1-pecuario.json` |
| Documento legível | `docs/architecture/MODELOBASE1-PECUARIO-CONTRACT.md` |
| Testes | `scripts/tests/gates/modelobase1-pecuario.test.mjs` — MB1-01 a MB1-20 |
| Posição no `verify:all` | depois de `base44`, antes de `types` |

### O que o gate exige

| # | Exigência | Código |
|---|---|---|
| 1 | o contrato existe | `P2-MB1-CONTRACT-MISSING` |
| 2 | é JSON válido, objeto na raiz | `P2-MB1-CONTRACT-INVALID` |
| 3–4 | `version: 1` e `status: "official"` | `P2-MB1-CONTRACT-VERSION` |
| 5–7 | `contractId`, `meaning` e `productScope` exatos | `P2-MB1-CONTRACT-SHAPE` |
| 8 | as 11 seções obrigatórias existem, com o tipo certo | `P2-MB1-CONTRACT-SHAPE` |
| 9 | `Cliente` é a **única** exceção sem `cliente_id` | `P2-MB1-TENANCY` |
| 10 | catálogo global adicional vazio | `P2-MB1-TENANCY` |
| 11–12 | tenant vem de `auth_context`; `body`/`query`/`params` proibidos | `P2-MB1-TENANCY` |
| 13–14 | unique de negócio tenant-scoped; índice começa por `cliente_id` | `P2-MB1-TENANCY` |
| — | PK `id`/`String`/`cuid()`, não fornecida pelo cliente, imutável | `P2-MB1-IDENTITY` |
| 15 | `max + 1` e `count + 1` proibidos e declarados como proibidos | `P2-MB1-NUMBERING` |
| 16 | sequência atômica e transacional, com `nullScopeHazard` resolvido | `P2-MB1-NUMBERING` |
| 17–18 | `storage_key` é a identidade; URL nunca é | `P2-MB1-ATTACHMENT` |
| 19 | `AuditLog` tenant-scoped, com `cliente_id` obrigatório e ator da sessão | `P2-MB1-AUDIT` |
| 20 | os oito códigos de erro mínimos, com HTTP 4xx/5xx e significado | `P2-MB1-CONTRACT-SHAPE` |
| 21 | os dez padrões proibidos, com descrição | `P2-MB1-PROHIBITED` |
| 22 | handoff da P3 completo e `authorizedInP2: false` | `P2-MB1-HANDOFF` |
| 23 | o gate **nunca** escreve nem corrige o arquivo | — |

### O que os testes cobrem

Cada caso monta um contrato **estruturado** num diretório temporário e roda o
gate real. Nenhum teste procura palavra em prosa — o que reprova é a forma do
JSON. MB1-01 contrato válido · MB1-02 ausente · MB1-03 JSON inválido · MB1-04
versão · MB1-05 `meaning` de template visual · MB1-06 tenant do request · MB1-07
segunda exceção · MB1-08 unique sem tenant · MB1-09 índice sem `cliente_id`
primeiro · MB1-10 `max + 1` · MB1-11 `count + 1` · MB1-12 sequência não
transacional · MB1-13 URL como identidade · MB1-14 `AuditLog` sem tenant ·
MB1-15 ator vindo do body · MB1-16 código de erro ausente · MB1-17 padrão
proibido ausente · MB1-18 handoff incompleto · MB1-19 o gate não reescreve
arquivo inválido · MB1-20 o contrato real do repositório passa.

### O que o gate **não** verifica

Ele valida o **contrato**, não a implementação — que ainda não existe. Quem vai
provar que o `schema.prisma` cumpre estas regras são `gate:tenancy` e
`gate:indices`, criados na P3. As duas camadas ficam: uma protege o acordo, a
outra protege o código.

## Fechamento de escopo dentro das functions

`gate:product-scope` não se contenta com a pasta da function existir. Ele lê o
código de `base44/functions/**` e reprova quando:

- uma chave-fonte de `PROPAGATION_RULES` está fora de `allowedBase44Entities`;
- um destino `entity: 'X'` está fora do manifesto;
- há acesso literal (`entities.X`, `entities['X']`) fora do manifesto;
- uma entidade de `forbiddenBase44Entities` é citada em código executável;
- a function invoca outra function fora de `allowedBase44Functions`;
- há acesso **computado não literal** — `entities[nome]`, `functions.invoke(nome)`
  — que o gate não consegue provar (`P01-SCOPE-FUNCTION-DYNAMIC-UNVERIFIABLE`).

A análise é feita sobre a **AST do TypeScript** (D-PROD-15), não sobre regex de
texto. A versão anterior casava `^ {2}Nome: [`: quatro espaços, tabulação ou
chave entre aspas passavam despercebidos. Formatação não pode decidir se o
escopo do produto está fechado.

Por isso `syncEntityReferences` deixou de fazer
`base44.asServiceRole.entities?.[nome]`. As 14 entidades que ela pode tocar
vivem num registro literal (`buildEntityRegistry`), e o nome dinâmico indexa
esse mapa local — cujo domínio está visível no código — em vez do SDK.

## Scanner de segredos — o valor, não a linha

O gate varre todo arquivo de texto do repositório, com 11 detectores. O relato é
sempre `arquivo:linha + tipo do segredo`; **o valor nunca é impresso**.

### Cobertura da varredura (DBT-17, fechado na P1.4)

A lista de arquivos é a união, deduplicada, de duas listas do Git:

| Origem | Comando |
|---|---|
| rastreados | `git ls-files -z` |
| não rastreados e não ignorados | `git ls-files -z --others --exclude-standard` |

Até a P1.3 só a primeira existia, e isso tinha uma consequência incômoda:
arquivo novo com segredo dentro passava batido até o `git add`. O gate ficava
verde exatamente no momento em que o segredo estava mais fresco e mais perto de
virar commit — e a CI, que vê o commit inteiro, reprovava depois. Aconteceu de
verdade na P1.1-R1.

`--exclude-standard` faz o Git aplicar `.gitignore`, `.git/info/exclude` e o
global. Ou seja: `.env.local` ignorado **continua fora** da varredura, que é
justamente onde o segredo deve ficar. O que entra é o arquivo que ninguém mandou
ignorar.

Um `.env` não rastreado e não ignorado é relatado com texto próprio — "a um
`git add` de ser versionado" —, para o relato não afirmar algo falso sobre o
estado do Git.

Cada detector declara qual grupo do match é o valor. A decisão de "mascarado"
olha só para esse valor (D-PROD-14). Ignorar a linha inteira era um bypass real:

| Linha | Antes | Agora |
|---|---|---|
| `const k = import.meta.env.K \|\| "AIza…real…"` | passava | **reprova** |
| `const demo = "SUA_CHAVE"; const t = "ghp_…real…"` | passava | **reprova** |
| `const API_KEY = "…real…"; // EXAMPLE` | passava | **reprova** |
| `const k = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;` | passava | passa |
| `VITE_GOOGLE_MAPS_API_KEY=SUA_CHAVE` | passava | passa |

## Cobertura do lint (DBT-10, fechado na P1.4)

`npm run lint` roda `eslint .` sobre três árvores inteiras:

| Árvore | Globais |
|---|---|
| `src/**/*.{js,mjs,cjs,jsx}` | browser · regras do React e `react-hooks/rules-of-hooks` |
| `scripts/**/*.{js,mjs,cjs}` | Node · `no-unused-vars` como **erro** |
| `tests/**` e `scripts/tests/**` | Node + browser + Vitest |

Até a P1.3 a cobertura era nominal: `src/components`, `src/pages`,
`src/Layout.jsx`, `src/apis`, `src/config` e **um** service citado pelo nome.
`src/lib`, `src/api`, `src/domain`, o restante de `src/services`, `scripts/` e
`tests/` ficavam fora — ou seja, a fundação nativa construída na P1 era o código
menos verificado do repositório.

Não há `ignores` de diretório, regra desligada em massa nem `eslint-disable`
espalhado. `no-unused-vars` fica desligado em `src/` e em `tests/` de propósito:
essa dívida é medida pela catraca de tipos, que já impede que ela cresça; ligá-la
aqui produziria centenas de erros sem informação nova.

## `gate:api-boundary` — fronteira de dados (D-PROD-18)

A catraca `gate:base44` conta ocorrências. Esta mede **identidade de arquivo**:
quais caminhos ainda falam com a Base44 diretamente.

A diferença importa. Contagem sozinha deixa passar troca — remover um acesso
aqui e criar outro ali fecharia o número e abriria caminho novo. Por isso o
baseline guarda **listas ordenadas de caminhos** por eixo, e rename também é
regressão: o caminho antigo sai da lista e o novo entra.

| Eixo | O que lista |
|---|---|
| `importsLegacyClient` | arquivos que importam `@/api/base44Client` |
| `entitiesRefs` | arquivos que referenciam `base44.entities` |
| `authRefs` | arquivos que referenciam `base44.auth` |
| `integrationsRefs` | arquivos que referenciam `base44.integrations` |
| `functionsRefs` | arquivos que referenciam `base44.functions` |
| `dynamicEntityFiles` | arquivos com acesso computado a `entities` |

O adapter autorizado — `src/apis/_providers/base44Provider.js` — fica **fora**
das listas: ele não é dívida, é a fronteira. Por isso o número significa "quanto
falta migrar".

### Invariantes, válidas sempre

Independem do baseline e não têm exceção histórica:

| Situação | Código |
|---|---|
| `@base44/sdk` carregado fora de `src/api/base44Client.js` | `P11-API-BOUNDARY-SDK-IMPORT` |
| arquivo fora de `src/apis/<modulo>/` importando `src/apis/_providers/` | `P11-API-BOUNDARY-LAYER-BYPASS` |
| arquivo em `src/apis/` importando o client legado sem ser o adapter | `P11-API-BOUNDARY-PROVIDER-LEAK` |
| objeto do provider reexportado (`export { base44 }`, `export default base44`, alias, reexport direto) | `P11-API-BOUNDARY-PROVIDER-LEAK` |
| símbolo de `src/apis/_providers/` exportado por `src/apis/<modulo>/` | `P11-API-BOUNDARY-PUBLIC-PROVIDER-LEAK` |
| provider (ou método cru dele) passado como **argumento** de uma chamada | `P11-API-BOUNDARY-PUBLIC-PROVIDER-LEAK` |
| página, componente, hook ou `Layout.jsx` importando API de módulo | `P11-API-BOUNDARY-SERVICE-BYPASS` |
| import de implementação interna de módulo vindo de fora do módulo | `P11-API-BOUNDARY-MODULE-INTERNAL-BYPASS` |
| acesso computado a `entities` **dentro de `src/apis/`** | `P11-API-BOUNDARY-DYNAMIC-ENTITY` |
| registry com entidade fora de `allowedBase44Entities` | `P11-API-BOUNDARY-SCOPE` |

#### Proveniência entre arquivos (DBT-18, fechado na P1.4 para argumento)

Exportar o provider já reprovava desde a P1.1-R4. Passá-lo como argumento, não —
e o efeito é exatamente o mesmo:

```js
helper(empresaProvider)                // entrega a capacidade inteira    → reprova
helper(empresaProvider.create)         // entrega a operação crua         → reprova
helper(empresaProvider.create.bind(p)) // função que ainda executa        → reprova
helper(await empresaProvider.list())   // entrega DADO                    → passa
```

O helper pode viver em qualquer arquivo. A partir do momento em que ele segura a
referência, chama a operação por fora de `runProviderCall`, da normalização de
erro e da validação de argumento — que é tudo o que a fronteira existe para
garantir.

A distinção é a mesma que já separava export legítimo de vazamento: **chamada
materializada devolve resultado, e resultado é dado**. Por isso a regra reusa
`ehCapacidade`, a mesma classificação usada nos exports, e por isso existe
controle positivo (`P14-N7`): passar o retorno de uma chamada continua permitido.

Três posições são explicitamente excluídas, porque são receptor e não repasse:
`p.list.call(p, …)`, `p.list.apply(p, […])` e `p.list.bind(p)`. As duas
primeiras **executam** a operação ali mesmo; na terceira, o vazamento é a função
resultante, e ela é classificada onde for usada.

O que continua fora do alcance é a análise semântica de wrapper que só se
resolve com dataflow entre módulos. Mas sem argumento e sem export, a capacidade
não tem por onde sair do arquivo.

#### Enforcement de camada (P1.1-R1)

Bloquear só `base44` não bastava. Uma página podia importar `empresaProvider`
direto de `src/apis/_providers/` — sem tocar em `base44`, sem reexportar nada — e
pular a fronteira inteira com o gate verde.

`src/apis/_providers/**` é **interno**. Só `src/apis/<modulo>/**` importa de lá,
com `<modulo>` sem prefixo `_`. A regra escala sozinha: módulo novo já nasce
autorizado; `_core/` e `_providers/` continuam de fora, e página, componente,
hook, service, repository e `src/lib/` nunca entram.

A resolução é por AST e cobre alias `@/`, caminho relativo, extensão opcional,
`import()` e `export ... from`.

#### Superfície pública de módulo (P1.1-R2)

A autorização da R1 é para **usar** `_providers`, não para republicá-lo. Sem essa
distinção a fronteira vazava de forma transitiva: o módulo reexportava o
provider, o consumidor importava `@/apis/empresa` — que o gate autoriza — e
recebia o objeto do provider sem nunca citar `_providers`.

Nenhum símbolo vindo de `src/apis/_providers/**` pode ser exportado por
`src/apis/<modulo>/**`, em nenhuma forma: `export … from`, `export *`, reexport
de binding, alias, `export default`, `const` igual ao binding, objeto que o
contém, ou função que o devolve → `P11-API-BOUNDARY-PUBLIC-PROVIDER-LEAK`.

A linha que separa uso de vazamento é o que a expressão entrega:

```js
export const listEmpresas = () => empresaProvider.list(ordem);  // resultado → ok
export const getProvider  = () => empresaProvider;              // referência → vaza
```

**Camadas.** Para cada módulo, `src/apis/<modulo>/index.js` é a superfície
pública; qualquer outro arquivo do módulo é implementação interna.

| Camada | Pode importar |
|---|---|
| `src/pages/`, `src/components/`, `src/hooks/`, `src/Layout.jsx` | `src/services/` e `src/apis/_core/` — **nunca** API de dados |
| `src/services/` | `@/apis/<modulo>` (ou `@/apis/<modulo>/index`), nunca arquivo interno, nunca `_providers/` |
| `src/apis/<modulo>/` | irmãos do próprio módulo e `_providers/` |

`_core/` não é API de módulo — o prefixo `_` o mantém fora da regra, e é por isso
que a página continua podendo importar `getApiErrorMessage`.

Decisão única sobre extensão: o especificador é resolvido sem extensão, então
`@/apis/empresa`, `@/apis/empresa/index` e `@/apis/empresa/index.js` são o mesmo
alvo público. Não há dois padrões.

A regra vale por construção para módulos futuros (`lote`, `mapa`, `setor`): nada
no analisador cita `empresa`.

#### Proveniência de carregamento (P1.1-R3)

A R2 provou a regra para `import` estático. Faltavam as outras formas de
**carregar** o provider e a referência a **membro** dele. O analisador passa a
trabalhar com proveniência, não com uma lista de nomes:

| Origem de proveniência | Exemplo |
|---|---|
| import estático nomeado, default ou namespace | `import * as p from '../_providers/…'` |
| `import x = require(…)` (TypeScript) | `import p = require('../_providers/…')` |
| `import()` literal do módulo provider | `import('../_providers/…')` |
| `require()` literal do módulo provider | `require('../_providers/…')` |
| desestruturação de qualquer origem acima | `const { empresaProvider } = require(…)` |
| alias local de qualquer origem acima | `const raw = empresaProvider` |

Uma expressão **entrega capacidade** — e portanto reprova — quando é uma origem,
um acesso a membro enraizado numa origem, um `await` de origem, ou um
objeto/array/spread/função que devolva qualquer uma dessas. Uma `CallExpression`
comum devolve **resultado da operação**, que é dado, não capacidade:

```js
export const criar     = (d) => empresaProvider.create(d);   // resultado → passa
export const createRaw = empresaProvider.create;             // método     → reprova
export const getModule = () => import('../_providers/…');    // namespace  → reprova
```

A referência crua de método é vazamento porque permite chamar a operação fora de
`runProviderCall`, da normalização de erro e da validação de argumento.

**Parser por extensão.** `scriptKindOf()` mapeia `.js`/`.mjs`/`.cjs` → JS,
`.jsx` → JSX, `.ts`/`.mts`/`.cts` → TS, `.tsx` → TSX. Sob `ScriptKind.TS` um
arquivo `.tsx` produz erro de parse, e arquivo que o parser não entende é
arquivo cujas invariantes não são verificadas.

#### Wrapper local e ponto fixo (P1.1-R4)

A classificação de um binding local e a verificação de um export usam **a mesma
função**. Era a diferença entre as duas que deixava passar:

```js
const bag = { empresaProvider };   // não entrava no conjunto de capacidades
export { bag };                    // …e o export só checava o conjunto
```

enquanto `export const bag = { empresaProvider };` já reprovava. Declarar
primeiro e exportar depois não pode mudar o resultado do gate.

Um binding local é **capacidade** quando seu initializer é: origem do provider,
membro derivado de origem, contêiner (objeto, array, spread) que a contenha,
função que a devolva, `.bind()` de método derivado, ou alias de outro binding já
classificado. Não é capacidade quando o initializer chama a operação e devolve o
resultado.

| Forma | Classificação |
|---|---|
| `empresaProvider.create(d)` | resultado → passa |
| `empresaProvider.create.call(p, d)` · `.apply(p, [d])` | resultado → passa |
| `empresaProvider.create` | capacidade → reprova |
| `empresaProvider.create.bind(p)` | capacidade → reprova |
| `c ? empresaProvider : null` · `c && empresaProvider` | capacidade → reprova |
| `return empresaProvider` em `if`/`switch`/`try` | capacidade → reprova |

`.bind()` é a exceção à regra "chamada devolve dado": ela devolve uma função que
ainda executa a operação, fora de `runProviderCall`, da normalização de erro e
da validação de argumento. `.call`/`.apply` executam ali mesmo.

Corpo em bloco é percorrido em **qualquer profundidade**, parando em fronteiras
de escopo (funções e classes aninhadas) — o `return` de uma função interna
pertence a ela.

**Ponto fixo real, sem limite de voltas.** A terminação vem da monotonicidade:
cada volta só adiciona nomes já presentes no AST, e o arquivo tem um número
finito de identificadores. A guarda residual **lança**; ela nunca devolve
resultado parcial. Um limite que sai calado transformaria "não consegui
analisar" em "está tudo certo" — foi o que a versão anterior fazia com cadeias
de alias declaradas em ordem inversa.

**Alcance declarado com precisão:** proveniência **local ao arquivo**, para os
bindings e expressões acima. Repasse interprocedural — capacidade passada por
parâmetro para função de outro módulo — continua fora (DBT-18).

#### Carregamento do SDK — todas as formas

`@base44/sdk` só entra por `src/api/base44Client.js`, em qualquer sintaxe:

```
import … from '@base44/sdk'      export … from '@base44/sdk'
import('@base44/sdk')            await import('@base44/sdk')
require('@base44/sdk')           import x = require('@base44/sdk')
```

Comentário ou string comum contendo o nome do pacote **não** reprova — a
detecção é sintática, não textual.

#### Origem certificada

`certifiedFromMain` precisa ser um SHA de 40 caracteres hexadecimais. String
livre permitiria um rótulo como `main-de-teste` e o baseline deixaria de ser
rastreável. `--update` preserva o campo.

Fora de `src/apis/`, o acesso computado herdado fica congelado no eixo
`dynamicEntityFiles`: os arquivos existentes só podem sair, e nenhum novo entra.

### Contrato do baseline

Igual ao das outras catracas: baseline ausente ou malformado é falha dura, não
existe `--seed`, execução normal nunca escreve, e `--update` só aceita
**subconjunto estrito** — com pelo menos um caminho removido. `certifiedFromMain`
registra a `main` de origem e é preservado nas atualizações.

Baseline: `scripts/gates/api-boundary-baseline.json` (schema 1).

**Estado atual (P1.3):** 23 arquivos legados importam o client, 20 usam
`entities`, 8 usam `auth`, 2 usam `integrations`, 3 usam `functions`, 2 acessam
`entities` por nome dinâmico.

Empresa saiu na P1.1; o Mapa e o manejo iniciado por ele, na P1.2; os cadastros
do manejo — lotes, setores, categorias, categorias de manejo, bebedouros e
anexos —, na P1.3, junto com a remoção dos repositórios `loteRepository` e
`bebedouroRepository`, sem shim. Todos os eixos são subconjuntos estritos do
estado anterior.

O acesso computado a entidade que restava no cadastro de lote
(`base44.entities[source.entity]`, com nome vindo de dado editável) virou
**catálogo fechado** de seis fontes na API de lotes; fonte fora do catálogo
lança código estável em vez de devolver lista vazia.

## Smoke automatizado

`npm run test:smoke` roda Vitest + jsdom + Testing Library. Nenhuma chamada real
a Base44, Google, rede ou geolocalização: `fetch` e `XMLHttpRequest` são
bloqueados no setup, e qualquer `console.error` inesperado ou unhandled
rejection reprova o teste.

Cobertura mínima: registro das 16 páginas, importabilidade de cada uma, raiz
apontando para `/MapaGeral`, fallback do `MapaGeral` sem chave, `MapaCadastro`
com SDK mockado, montagem do `App`, e o contrato completo do carregador do
Google Maps.

Desde a P1.2, também: a fronteira de dados do mapa (nenhuma tela do mapa fala
Base44, a UI só chama service, o service só chama superfície pública), a
política do cache offline (dedup, intervalo mínimo, cooldown por **código** de
erro, stale-while-revalidate), as regras de exclusão do `MapaCadastro`, a
decisão de permissão do `MapaGeral` e as regras puras de manejo de lote.

Desde a P1.2-R2, também: o contrato do App Shell — a raiz de `MapaGeral` não
pode ser overlay global (`fixed inset-0 z-50` a tirava do fluxo do `Layout` e
cobria cabeçalho e navegação), o gatilho do menu móvel abre o Sheet com nome
acessível e `aria-expanded`, navegar fecha o Sheet e troca a rota, e o
`.env.example` documenta toda `VITE_*` lida por `runtimeConfig.js`, sem valor e
sem segredo, distinguindo Vercel Preview/Production de Railway frontend/backend.

JSDOM não calcula layout, então classe sozinha não prova pixel: os testes de
shell combinam contrato estrutural com comportamento real de clique e rota.

Desde a P1.3-R1, `endpointOf(...)` **dentro do adapter Base44 autorizado** só
aceita string literal. É a mesma porta que `entities[nome]`, com um passo de
indireção: o provider da P1.3 tinha `listOptionSource(nomeValidado)`, e a
validação ficava na API — validação em cima de porta aberta é convenção, não
contrato. Reprovam identificador, membro, ternário, chamada e const
intermediária, com o código `P11-API-BOUNDARY-DYNAMIC-ENTITY`.

A regra é **escopada ao arquivo** `src/apis/_providers/base44Provider.js`
(P1.3-R2). `endpointOf` não é palavra reservada: um helper homônimo em qualquer
outro arquivo — `const endpointOf = (mapa, chave) => mapa[chave]` — **não** é
classificado como acesso de entidade. A regra existe pelo que a função faz
dentro do adapter, resolver endpoint no registry; fora dali o nome não significa
nada. Fixtures DP1–DP4 para o adapter, DP5 como controle de falso positivo.

O smoke também ficou hermético desde a **avaliação dos módulos**: o mock do
cliente Base44 vive em `tests/smoke/setup.js`, no escopo do módulo. O bloqueio
de rede em `beforeEach` deixava uma janela temporal aberta — módulos de teste
são avaliados antes do primeiro hook, e um `import` de topo do provider
inicializava o SDK real. `tests/smoke/hermeticidade.test.js` prova isso sem mock
local.

A P1.3 acrescentou as provas negativas N1–N8 ao teste do próprio gate, como
**fixtures analisadas pelo gate real** em projetos temporários: UI chamando API
direto, service importando implementação privada, repositório legado
reaparecendo, `entities[nome]`, função de nome aberto, provider reexportado,
arquivo migrado voltando ao baseline, e um controle positivo da cadeia
completa. Rodam em toda CI, em vez de uma vez em mutação manual.

Asserção que olha código-fonte usa um helper que **remove comentários antes de
comparar**: um comentário explicando que o módulo não usa `localStorage` não
pode reprovar a busca por `localStorage`.

### Provas de contrato da P1.4-R1

A P1.4 fechou os seis eixos da fronteira em zero, e a auditoria mostrou que
contagem zerada não é o mesmo que contrato fechado. Quatro provas novas em
`tests/smoke/sessaoContrato.test.js`, todas de **ausência na fonte** ou de
**consumo real**, porque nenhum gate de contagem pegaria o que elas pegam:

| Prova | O que fixa |
|---|---|
| SE1–SE8b | O contrato que sai da API de sessão: `{ok, value}` / `{ok, reason}` e `{autenticado, usuario, precisaAutenticar}`. O provider é mockado **só na fronteira** — é o único lugar autorizado a conhecer o formato de erro dele |
| SE9/AUTH8 | `src/lib/AuthContext.jsx` não contém `.status`, `.statusCode`, `.response`, `extra_data`, `.data?.`, `appError` nem `error.message` |
| SE10a | `src/services/sessionService.js` não contém `.status`, `.statusCode`, `.response`, `cause`, `extra_data` nem `statusDaFalha` |
| SE10b | Nenhum arquivo de `src/services`, `src/pages` ou `src/lib` casa `extra_data`, `.statusCode`, `erro?.status` ou `error.status` |
| SE10c | `src/apis/session/sessionApi.js` **contém** `extra_data` e `statusCode` — a classificação existe, e existe só ali |
| SE11 | Todo código de erro da P1.4 tem pelo menos um `API_ERROR_CODES.<CÓDIGO>` em `src/`, fora da própria declaração. Declaração, catálogo de mensagens, teste e documentação **não** contam como consumidor |
| SE12 | `src/components/ui/button.jsx` não contém `@type {any}`, `@type {unknown}`, `@ts-ignore`, `@ts-nocheck` nem `@ts-expect-error`, e declara `ComponentPropsWithoutRef`, `VariantProps`, `HTMLButtonElement` e `asChild` |
| LE-P1..LE-P6 | O rename de local de estoque registra em `details.etapas` **o que de fato concluiu** em cada ponto de falha, com contagem individual por cocho (`cochos:1`, `cochos:2`, …) |

SE11 e SE12 existem por defeitos reais, não hipotéticos: `PRODUTO_PARTIAL_IMPORT`
estava catalogado sem chamador nenhum, e a queda de 405 diagnósticos de tipo da
P1.4 tinha vindo de desligar a verificação do `Button`, não de tipá-lo. Um gate
que só conta não distingue "resolvido" de "silenciado" — essas provas distinguem.

### Contrato do carregador do Google Maps (D-PROD-16)

`loadGoogleMaps` só resolve com **capacidade comprovada**:

```
google.maps.Map  ∧  google.maps.geometry
```

`google.maps.drawing` saiu do contrato na P1.2-R1 (D-PROD-19): o Google removeu
o `DrawingManager` na versão 3.65 e a library não existe mais no canal atual —
exigi-la tornava o readiness insatisfazível. O produto nunca a usou: o desenho é
manual, com `Marker`, `Polyline` e `Polygon`. `geometry` continua exigida porque
é usada de verdade (`computeArea`, `computeLength`, `computeDistanceBetween`,
`poly.containsLocation`).

O evento `load` e `dataset.loaded` são pistas de que o script terminou, nunca
prova de que o SDK está utilizável. Depois do `load`, o loader observa as
capacidades até o timeout total; se seguir incompleto, rejeita com
`MAPS_SDK_INCOMPLETE`, remove o script e limpa a promise — sucesso falso não
fica em cache e a retentativa funciona.

Também reprovam: script com o ID correto mas URL fora de
`https://maps.googleapis.com/maps/api/js`, libraries incompletas na URL, e
`window.gm_authFailure` (o handler anterior é encadeado e restaurado).

| Código | Situação |
|---|---|
| `MAPS_CONFIG_MISSING` | `VITE_GOOGLE_MAPS_API_KEY` ausente |
| `MAPS_SCRIPT_FAILED` | erro de rede, URL inesperada ou falha de autenticação |
| `MAPS_SCRIPT_TIMEOUT` | o script nunca respondeu |
| `MAPS_SDK_INCOMPLETE` | carregou sem as capacidades exigidas |
| `MAPS_ENV_UNAVAILABLE` | ambiente sem DOM |

A chave nunca aparece em log nem em mensagem de erro — há teste específico.

## Integração contínua

`.github/workflows/quality.yml` roda `npm ci` e `npm run verify:all` em
`pull_request` e em `push` para `main`. Node vem de `.nvmrc`. O workflow apenas
chama os scripts oficiais — nenhuma lógica de gate é duplicada em YAML.

## Disciplina de execução do `verify:all` (P1.2-R1)

`verify:all` é o gate; o shell em volta dele não pode enfraquecê-lo. Três formas
são proibidas em qualquer script ou sessão:

| Forma | Por que é defeito |
|---|---|
| `verify:all \| tail -N` | `tail` só imprime quando o processo termina. Durante os ~100 s a saída fica vazia e parece travamento — e as últimas N linhas podem esconder a etapa vermelha. |
| `verify:all \| algo` sem `set -o pipefail` | o status do pipeline vira o status do último comando. Um `verify:all` vermelho devolve 0. |
| `verify:all ; git push` | `;` torna o push **incondicional** — ele roda mesmo com a verificação vermelha. |

Somadas, as três significam que um `verify:all` vermelho pode ser seguido de
push. Forma correta quando é preciso guardar log:

```bash
set -o pipefail
npm run verify:all 2>&1 | tee /tmp/verify.log
status=${PIPESTATUS[0]}
test "$status" -eq 0
```

Push só depois de exit 0 confirmado, uma tentativa, erro visível — nada de laço
com espera exponencial escondendo a causa.

### Verificar na versão de runtime da CI

O `.nvmrc` fixa **Node 20.19.0** e a CI usa exatamente essa versão
(`node-version-file: .nvmrc`). Rodar `verify:all` local em outra versão **não é
verificação**: API que existe no Node novo e não no fixado passa na máquina e
reprova na CI.

Aconteceu de verdade na P1.2-R1: quatro testes usavam `fs.globSync`, que só
existe a partir do Node 22. Local em 22.22.2 deu 13/13; a CI, em 20.19.0,
reprovou `test:smoke`. Ver run [30849901416](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30849901416).

Antes de empurrar, use a versão do `.nvmrc` — `nvm use` ou o caminho explícito
do binário. Preferir API disponível na versão fixada resolve na origem:
`readdirSync(dir, { recursive: true })` cobre Node 18.17+, `globSync` não.

**Nenhum script versionado do repositório faz isso hoje**: `verify:all` é um
script Node que propaga o exit code, e `quality.yml` chama `npm run verify:all`
direto, sem pipe. Por isso a proteção vive aqui e no relatório da P1.2-R1, e não
como gate — não existe script responsável para um gate vigiar, e analisar shell
arbitrário não é objetivo deste registro.

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
