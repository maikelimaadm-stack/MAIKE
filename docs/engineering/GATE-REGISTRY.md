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
| **no-secrets** | `npm run gate:no-secrets` | Nenhum segredo literal em **qualquer arquivo versionado**; nenhum `.env` versionado | D-PROD-07 · D-PROD-14 | `scripts/gates/gate-no-hardcoded-secrets.mjs` |
| **base44** | `npm run gate:base44` | Acoplamento com a Base44 só diminui (catraca, 10 eixos) | D-PROD-04 | `scripts/gates/gate-base44-ratchet.mjs` |
| **types** | `npm run gate:types` | A dívida de tipos nunca cresce, em nenhum modo (catraca por fingerprint) | D-PROD-11 · D-PROD-13 · D-PROD-17 | `scripts/gates/gate-typecheck-ratchet.mjs` |
| **verify:all** | `npm run verify:all` | Toda a cadeia, na ordem abaixo | — | `scripts/gates/verify-all.mjs` |

## Ordem do `verify:all`

Contratos baratos primeiro, build por último:

```
test:gates → governance-paths → package-sync → product-scope → api-boundary
→ source-closure → import-integrity → no-secrets → base44 → types → lint
→ test:smoke → build
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

O gate varre todo arquivo de texto listado por `git ls-files`, com 11 detectores.
O relato é sempre `arquivo:linha + tipo do segredo`; **o valor nunca é impresso**.

Cada detector declara qual grupo do match é o valor. A decisão de "mascarado"
olha só para esse valor (D-PROD-14). Ignorar a linha inteira era um bypass real:

| Linha | Antes | Agora |
|---|---|---|
| `const k = import.meta.env.K \|\| "AIza…real…"` | passava | **reprova** |
| `const demo = "SUA_CHAVE"; const t = "ghp_…real…"` | passava | **reprova** |
| `const API_KEY = "…real…"; // EXAMPLE` | passava | **reprova** |
| `const k = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;` | passava | passa |
| `VITE_GOOGLE_MAPS_API_KEY=SUA_CHAVE` | passava | passa |

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
| página, componente, hook ou `Layout.jsx` importando API de módulo | `P11-API-BOUNDARY-SERVICE-BYPASS` |
| import de implementação interna de módulo vindo de fora do módulo | `P11-API-BOUNDARY-MODULE-INTERNAL-BYPASS` |
| acesso computado a `entities` **dentro de `src/apis/`** | `P11-API-BOUNDARY-DYNAMIC-ENTITY` |
| registry com entidade fora de `allowedBase44Entities` | `P11-API-BOUNDARY-SCOPE` |

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

**Estado atual (P1.1):** 67 arquivos legados importam o client, 63 usam
`entities`. Empresa saiu de todos os eixos.

## Smoke automatizado

`npm run test:smoke` roda Vitest + jsdom + Testing Library. Nenhuma chamada real
a Base44, Google, rede ou geolocalização: `fetch` e `XMLHttpRequest` são
bloqueados no setup, e qualquer `console.error` inesperado ou unhandled
rejection reprova o teste.

Cobertura mínima: registro das 16 páginas, importabilidade de cada uma, raiz
apontando para `/MapaGeral`, fallback do `MapaGeral` sem chave, `MapaCadastro`
com SDK mockado, montagem do `App`, e o contrato completo do carregador do
Google Maps.

### Contrato do carregador do Google Maps (D-PROD-16)

`loadGoogleMaps` só resolve com **capacidade comprovada**:

```
google.maps.Map  ∧  google.maps.geometry  ∧  google.maps.drawing
```

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
