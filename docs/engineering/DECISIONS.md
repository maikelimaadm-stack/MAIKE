# Decisões

Registro append-only. Decisão nunca é apagada — é superada por outra.

Formato: `D-xx` · data · decisão · justificativa · consequência

---

## D-01 — Tenancy: cliente único

**Decisão:** o sistema hoje atende um único cliente (operação própria).

**Consequência:** a migração de dados atribui o mesmo `cliente_id` a todos os
registros. Não há etapa de desambiguação.

**Importante:** isto **não** dispensa `cliente_id` nos models. Ver D-02.

---

## D-02 — `cliente_id` obrigatório desde o primeiro model

**Decisão:** todo model Prisma tem `cliente_id`, mesmo com um cliente único.

**Justificativa:** retrofitar multi-tenancy em 87 models depois é ordens de
grandeza mais caro e arriscado que fazer certo desde o início.

**Consequência:** travado por `gate:tenancy` e `gate:indices`.

---

## D-03 — PROJETOMG como molde arquitetural

**Decisão:** o repositório PROJETOMG é a referência de arquitetura. Não se
inventa padrão novo.

**Consequência:** divergência do molde exige justificativa escrita nesta lista.

---

## D-04 — Shim de compatibilidade antes de migrar componentes

**Decisão:** criar um cliente com assinatura idêntica à do SDK da Base44 antes
de tocar em qualquer componente.

**Justificativa:** são 2.696 chamadas espalhadas em componentes. Reescrever tudo
de uma vez é inviável e impossível de revisar.

**Consequência:** a Fase 3 vem antes da Fase 4.

---

## D-05 — Independência monotônica

**Decisão:** o acoplamento com a Base44 nunca aumenta, nem temporariamente.

**Consequência:** travado por `gate:base44` com baseline versionado.

---

## D-06 — Meta-entidades de layout avaliadas contra MDP

**Decisão:** as 11 meta-entidades de layout (`LayoutCampo`, `FormPanel`,
`CampoPersonalizado` e correlatas) não são portadas automaticamente. Cada uma é
avaliada contra o motor MDP do PROJETOMG antes de virar model próprio.

**Consequência:** escopo real cai de ~87 para ~76 entidades de domínio.



---

## D-PROD-01 — Produto focado: Pecuária Mapa Geral + Manejo

**Data:** 2026-07-28 · **Missão:** P0.1

**Decisão:** o MAIKE deixa de ser um ERP amplo. O produto é exclusivamente um
sistema de **Pecuária — Mapa Geral + Manejo**.

**Consequência:** financeiro, fiscal, folha, máquinas, combustível, agrícola,
safra, comercial/cotação, pesagens individuais, relatórios genéricos, dashboards
paralelos, fichas personalizadas e editor visual saem do produto.

---

## D-PROD-02 — Limpeza destrutiva autorizada

**Data:** 2026-07-28 · **Missão:** P0.1

**Decisão:** o sistema não está em produção e não tem operação crítica. Módulos e
códigos fora do escopo são excluídos diretamente.

**Consequência:** sem shim de compatibilidade, sem migração de dados legados, sem
preservar tela "por segurança". A recuperação é pelo histórico Git.

---

## D-PROD-03 — PROJETOMG como molde parcial

**Data:** 2026-07-28 · **Missão:** P0.1

**Decisão:** o PROJETOMG é referência para arquitetura modular, ModeloBase1,
backend, Prisma, migrations, tenancy, APIs, gates, testes e governança.

**Consequência:** **não** é fonte para copiar Studio, MDP, MMM, Marketplace,
Runtime Universal, low-code ou intelligence engines. Supera parcialmente D-03.

---

## D-PROD-04 — Base44 temporária apenas na cadeia preservada

**Data:** 2026-07-28 · **Missão:** P0.1

**Decisão:** a Base44 permanece somente como provider temporário das capacidades
preservadas. Nenhuma referência nova pode ser criada.

**Consequência:** `gate:base44` (catraca) passa a medir eixos separados: arquivos
com SDK, imports do SDK, `base44.entities`, `base44.auth`, `base44.integrations`,
`base44.functions`, plugin Vite, schemas e functions. Remoção integral em P7.

---

## D-PROD-05 — Interface primária é o MapaGeral

**Data:** 2026-07-28 · **Missão:** P0.1

**Decisão:** `MapaGeral` é a superfície principal. A raiz `/` redireciona para
`/MapaGeral`.

**Consequência:** `Home` e `Dashboard` foram excluídos. `pages.config.js` declara
`mainPage: "MapaGeral"`, validado por `gate:product-scope`.

---

## D-PROD-06 — Funcionalidade acima do nome do arquivo

**Data:** 2026-07-28 · **Missão:** P0.1

**Decisão:** um arquivo só permanece quando for necessário ao Mapa Geral, ao
manejo executado pelo Mapa Geral ou à configuração indispensável dessas
capacidades. Ter "pecuária", "mapa" ou "manejo" no nome não basta.

**Consequência:** `MapaPecuaria`, `MapaMovimentacao`, `RelatorioMapaPastos`,
`RelatorioGadoMapaGeral`, `ManejosTecnicosRebanho`, `MovimentacoesLote` e
`AreasPastagem` foram excluídos — a operação equivalente já está embutida no
Mapa Geral ou fora do escopo.

---

## D-PROD-07 — Chave do Google Maps sai do código

**Data:** 2026-07-28 · **Missão:** P0.1

**Decisão:** a chave literal `AIza...` que existia em 8 arquivos foi removida. O
carregamento passa por `src/lib/googleMaps.js`, lendo
`import.meta.env.VITE_GOOGLE_MAPS_API_KEY`.

**Consequência:** sem a variável, o Mapa Geral exibe mensagem de configuração
ausente (não fica em branco). `gate:no-secrets` reprova qualquer chave literal.
A chave exposta no histórico Git **precisa ser revogada e rotacionada pelo
proprietário** — esta missão não reescreve histórico.

---

## D-PROD-08 — Entrada de estoque sai do produto em P0.1

**Data:** 2026-07-28 · **Missão:** P0.1

**Decisão:** `MovimentacoesEstoque` e `LancamentoProdutosEstoque` foram excluídos.
O mapa lê `EstoqueLoteNota`/`MovimentacaoEstoque` e escreve a transferência de
depósito pelo próprio fluxo (`FormularioTransferenciaDeposito`), sem depender
dessas telas.

**Justificativa:** as telas arrastavam integração financeira, importação de NF-e,
rateio de centro de custo e fornecedores — todos fora do produto.

**Consequência:** o produto fica temporariamente sem tela de **entrada** de
estoque. A capacidade é reconstruída nativamente em **P6**. Risco registrado no
relatório da missão.

---

## D-PROD-09 — Menu com SSOT único

**Data:** 2026-07-28 · **Missão:** P0.1

**Decisão:** a navegação vive apenas em `src/lib/menuConfig.js`. O menu dinâmico
por `localStorage` (`custom_menu`) e o editor de menus de `ConfiguracoesGerais`
foram removidos.

**Consequência:** `ConfiguracoesGerais` mantém somente o gerenciador de ícones
(`ConfiguracaoIcone`), consumido pelo mapa. `gate:product-scope` valida que toda
`url` do menu existe em `config/mapa-manejo-scope.json`.

---

## D-PROD-10 — D-04 (shim de compatibilidade) está superada

**Data:** 2026-07-28 · **Missão:** P0.1-R1

**Decisão:** `D-04 — Shim de compatibilidade antes de migrar componentes` está
**superada** para o produto atual. Não haverá shim compatível com toda a
superfície da Base44.

**Justificativa:** D-04 foi escrita quando o alvo era migrar um ERP de 87
entidades e 2.801 chamadas sem reescrever componentes. Depois de D-PROD-01 e
D-PROD-02 o produto é Mapa Geral + Manejo, com 38 entidades e 371 chamadas, e
a estratégia passou a ser reconstrução direta (`docs/engineering/ROADMAP.md`).
Um shim genérico agora seria a "solução paralela" que a Constituição (P2) proíbe.

**Consequência:** a transição acontece por **capacidade**, com contratos
próprios em `src/apis/` (P1) e persistência nativa (P4–P6). A Base44 permanece
como provider temporário apenas na cadeia preservada, até ser substituída
capacidade a capacidade e removida em P7 (D-PROD-04).

**D-04 não é apagada** — o registro é append-only. Ela permanece como história
da decisão anterior.

---

## D-PROD-11 — Catraca de dívida de tipos em vez de conversão em massa

**Data:** 2026-07-28 · **Missão:** P0.1-R1

**Decisão:** `npm run typecheck` passa a ser a catraca
`scripts/gates/gate-typecheck-ratchet.mjs`, com baseline versionado em
`scripts/gates/typecheck-baseline.json`. A cobertura é `jsconfig.typecheck.json`,
que inclui **todo** o `src/` — inclusive `src/components/ui`, `src/api` e
`src/lib`, que o `jsconfig.json` original excluía.

**Justificativa:** converter milhares de arquivos legados não é escopo do P0.1,
e afrouxar o `jsconfig.json` seria esconder o problema. A regra honesta é que a
dívida nunca cresce.

**Consequência:** o significado de verde é explícito — *nenhuma regressão sobre
a dívida legada versionada*, **não** "sem erros". A dívida bruta continua
visível em `npm run typecheck:raw`. P1 deve reduzi-la monotonicamente até zero,
quando a catraca vira um gate comum.

---

## D-PROD-12 — Fechamento de código sem arquivo órfão

**Data:** 2026-07-28 · **Missão:** P0.1-R1

**Decisão:** todo arquivo executável em `src/` precisa ser alcançável a partir
das entradas reais do produto (`gate:source-closure`). Órfão é removido ou entra
em `orphanAllowlist` com caminho, justificativa, consumidor dinâmico e decisão
associada. Allowlist por diretório ou padrão não é aceita, e "pode ser usado no
futuro" não é justificativa.

**Consequência:** 27 componentes de `src/components/ui` sem nenhum consumidor e
`src/hooks/use-mobile.jsx` foram excluídos, junto com 33 dependências que só
existiam para eles. A decisão do P0.1 de preservar `src/components/ui/**`
integralmente fica restrita ao que a cadeia preservada realmente importa.

---

## D-PROD-13 — Baseline protege a configuração, não só os resultados

**Data:** 2026-07-28 · **Missão:** P0.1-R2

**Decisão:** o baseline da catraca de tipos passa a gravar e validar
`projectPath`, `projectSha256` (hash canônico do arquivo de projeto e da cadeia
local de `extends`, sem caminho absoluto), `effectiveCommand`,
`typescriptVersion` e `coverageContract`. Além disso, a configuração **atual** é
validada mecanicamente contra invariantes de cobertura: `checkJs: true`,
`include` não vazio cobrindo `src/**/*.{js,jsx,ts,tsx}`, nenhuma exclusão que
alcance `src/components/ui`, `src/api`, `src/lib` ou `src/services`, e exclusões
restritas a `node_modules`, `dist`, `dist-ssr`, `coverage` e fixtures fora de
`src/`.

**Justificativa:** a auditoria de P0.1-R2 mostrou que o gate validava apenas o
*caminho* do projeto. Mantendo o mesmo nome de arquivo e trocando o conteúdo por
`{"compilerOptions":{"checkJs":false},"include":[]}`, os diagnósticos cairiam a
zero e a catraca ficaria verde sem nenhuma melhora real. Um número de dívida só
significa alguma coisa junto da cobertura que o produziu.

**Consequência:** três códigos novos — `P01-TYPE-CONTRACT` (a configuração atual
viola a cobertura obrigatória), `P01-TYPE-CONFIG-DRIFT` (divergência em relação
ao baseline) e `P01-TYPE-VERSION-DRIFT` (mudança de versão do compilador).
Mudança consciente usa a flag separada `--rebase-contract`; `--update` continua
sendo só para diagnósticos, após redução e sem regressão. A cobertura
obrigatória **não é rebaseável**. O schema do baseline vai para a versão 2, e os
testes passam a executar o gate real em projetos temporários com `tsc` de
verdade — 22 casos ponta a ponta.

---

## D-PROD-14 — O scanner de segredos avalia o valor, não a linha

**Data:** 2026-07-28 · **Missão:** P0.1-R2

**Decisão:** `gate:no-secrets` deixa de descartar a linha inteira quando ela
contém um marcador de máscara. Cada detector declara qual grupo do match é o
valor do segredo, e a decisão de "mascarado" olha apenas para esse valor.

**Justificativa:** o atalho `if (MASKED.test(linha)) return;` rodava antes das
regras. Bastava citar `import.meta.env`, `process.env`, `EXAMPLE`,
`PLACEHOLDER` ou `SUA_CHAVE` na mesma linha para esconder um segredo verdadeiro
— exatamente o padrão `const key = import.meta.env.K || "AIza…";` que a missão
P0.1 tinha acabado de remover do produto.

**Consequência:** fallback literal, placeholder ao lado de segredo real e
comentário `// EXAMPLE` deixam de isentar. Leitura de variável de ambiente sem
fallback e placeholder puro continuam permitidos. O relato segue sendo
`arquivo:linha + tipo`, sem nunca imprimir o valor. A primeira execução do gate
endurecido reprovou uma fixture do próprio repositório de testes, escrita como
literal em arquivo versionado — a fixture passou a ser construída em tempo de
execução.

---

## D-PROD-15 — Fechamento de escopo por AST, não por formatação

**Data:** 2026-07-28 · **Missão:** P0.1-R2

**Decisão:** a análise das functions Base44 passa a usar a AST do TypeScript.
Acesso computado com valor não literal (`entities[nome]`,
`functions.invoke(nome)`) reprova com
`P01-SCOPE-FUNCTION-DYNAMIC-UNVERIFIABLE`.

**Justificativa:** a extração anterior dependia de
`^ {2}([A-Za-z_]\w*)\s*:\s*\[` — quatro espaços, tabulação ou chave entre aspas
escapavam do gate. Indentação não pode decidir se o escopo do produto está
fechado. E um nome de entidade que só existe em tempo de execução não é
verificável: afirmar fechamento sobre ele seria mentira.

**Consequência:** `syncEntityReferences` deixou de indexar o SDK com nome
dinâmico. As 14 entidades que a function pode tocar — exatamente a união das
chaves-fonte e dos destinos de `PROPAGATION_RULES` — vivem num registro literal
(`buildEntityRegistry`), e o nome dinâmico indexa esse mapa local, cujo domínio
está visível no código. Comportamento preservado: nome desconhecido devolve
nulo, como o `?.[]` fazia. O `typescript`, que já era dependência de
desenvolvimento, passa a ser usado também pelos gates.

---

## D-PROD-16 — Google Maps só está carregado com as capacidades prontas

**Data:** 2026-07-28 · **Missão:** P0.1-R2

> **Nota histórica (P1.2-R1, 2026-08-03):** a exigência de `google.maps.drawing`
> registrada abaixo foi **superada pela D-PROD-19**. O Google removeu o
> `DrawingManager` na versão 3.65 e a library deixou de existir no canal atual.
> O texto original fica preservado — é o registro do que foi decidido em
> 2026-07-28, e não se reescreve história. Todo o resto desta decisão continua
> em vigor.

**Decisão:** `loadGoogleMaps` só resolve quando `google.maps.Map`,
`google.maps.geometry` e `google.maps.drawing` estão disponíveis. Depois do
evento `load`, o loader observa as capacidades de forma limitada até o timeout
total; se seguir incompleto, rejeita com o código novo `MAPS_SDK_INCOMPLETE`,
remove o script e limpa a promise.

**Justificativa:** `onLoad` chamava `succeed()` sem verificar nada, e
`dataset.loaded === 'true'` resolvia sozinho. O produto declarava "mapa pronto"
com `window.google` inexistente, e a promise resolvida ficava em cache — toda
chamada seguinte herdava o mesmo falso sucesso, sem retentativa possível. Havia
até um teste formalizando esse comportamento; ele foi corrigido.

**Consequência:** `dataset.loaded` vira pista, nunca prova. Script com o ID
correto e URL fora de `https://maps.googleapis.com/maps/api/js`, ou com
libraries incompletas, é inválido. `window.gm_authFailure` derruba a carga em
andamento, encadeando e restaurando o handler anterior. A chave continua fora de
qualquer log ou mensagem de erro, com teste específico.

---

## D-PROD-17 — Rebase de contrato nunca autoriza regressão de dívida

**Data:** 2026-07-30 · **Missão:** P0.1-R3

**Decisão:** a barreira de não regressão da catraca de tipos vale em **todos os
modos** — execução normal, `--update` e `--rebase-contract` — e roda antes de
qualquer escrita. `--rebase-contract` atualiza **metadados de contrato** (hash da
configuração, cadeia local de `extends`, versão do TypeScript, comando efetivo,
metadados de cobertura); ele não move o teto de qualidade.

Junto com isso:

1. **Nenhum modo aceita fingerprint novo**, multiplicidade aumentada, arquivo com
   contagem maior, total maior ou total acima do teto certificado. Falha
   qualquer uma delas, o baseline fica byte a byte intacto.
2. **`--seed` foi removido do gate de produção.** Baseline ausente é falha dura
   em todos os modos (`P01-TYPE-BASELINE-MISSING`), e passar `--seed` reprova
   explicitamente (`P01-TYPE-SEED-FORBIDDEN`). Fixtures de teste montam o próprio
   baseline; o gate nunca semeia.
3. **`certifiedCeiling` só diminui.** É um inteiro não negativo, obrigatório no
   schema 3. `total` do baseline e total atual não podem excedê-lo. `--update` e
   `--rebase-contract` gravam `min(teto, total atual)` — nunca mais que isso.
4. **Código novo nasce limpo em relação ao baseline.** Diagnóstico introduzido
   por código novo é corrigido no código, não absorvido pelo baseline.

**Justificativa:** a auditoria da P0.1-R2 encontrou duas coisas ligadas. A falha
por regressão estava condicionada a `&& !rebasear`, de modo que
`--rebase-contract` podia gravar um baseline com dívida maior — a própria
operação de rebase redefinia a dívida para cima. E foi exatamente isso que
aconteceu na prática: o baseline subiu de 2.803 para 2.808 porque cinco
diagnósticos do loader novo do Google Maps foram absorvidos por uma nova
semeadura, e o relatório da R2 aceitou o aumento. CI verde não representava a
propriedade declarada pela catraca.

**Consequência:** os cinco diagnósticos foram corrigidos no próprio
`src/lib/googleMaps.js`, com `@typedef` locais para `window.google` e
`window.gm_authFailure` — contratos reais do runtime, não silenciamento. O
arquivo passou de 6 para **0** diagnósticos, incluindo o que já existia desde a
R1. O baseline foi migrado a partir do arquivo **certificado na R1** (commit
`9713c3a`), não do da R2, e só foi gravado depois de provado que o conjunto
atual é subconjunto do histórico: 0 fingerprints novos, 0 multiplicidades
aumentadas, 1 redução. Total 2.802, teto 2.802.

---

## D-PROD-18 — UI acessa dados por API explícita de módulo

**Data:** 2026-08-03 · **Missão:** P1.1

**Decisão:** página e componente não conhecem provider de dados. O acesso passa
por uma fronteira nativa:

```
página → service do módulo → src/apis/<modulo>/ → provider interno
```

Regras que essa fronteira carrega:

1. `src/apis/<modulo>/` é a **superfície pública** do módulo. Quem consome
   importa dali, nunca de `_core/` nem de `_providers/`.
2. O provider Base44 é **temporário e interno**. Um único arquivo —
   `src/apis/_providers/base44Provider.js` — pode importar `@/api/base44Client`,
   e o objeto do provider **nunca** é exportado.
3. O registro de entidade é **literal**. Nada de `entities[nome]`: o domínio do
   registry está escrito no código e é conferível por AST. Entidade entra uma
   por slice, quando tem consumidor migrado.
4. A migração é **monotônica por módulo**. Cada slice remove caminhos legados;
   nenhuma adiciona.
5. `gate:api-boundary` protege isso por **identidade de arquivo**, não por
   contagem — rename e troca de caminho são regressão.

**Justificativa:** 371 chamadas `base44.entities` viviam dentro de componentes
React (DBT-01). Trocar o provider nessa forma exigiria tocar em todas elas ao
mesmo tempo. Com a fronteira, trocar Base44 por HTTP em P7 é alterar o adapter —
a página não muda (QLT-P11-02).

Não é wrapper: a página deixou de falar o formato do provider. `Empresa.jsx`
chama `empresaService.listEmpresas()`, não `entities.Empresa.list('-created_date')`.

**Consequência:** a regra de nome duplicado saiu da mutation da página para
`empresaService`, e passou a comparar contra a leitura atual em vez do cache do
React Query. A UI identifica conflito pelo código `EMPRESA_NAME_CONFLICT`, não
pelo texto da mensagem. Erro do provider é normalizado em `ApiError`, com o
original preso em `cause` e fora da mensagem pública.

A configuração de runtime foi centralizada em `src/config/runtimeConfig.js` e
`src/lib/app-params.js` foi removido — sem shim. Autenticação e
`requiresAuth: false` não foram tocados.

Esta slice migra **apenas** o módulo Empresa. P1 continua em andamento.

---

## D-PROD-19 — Google Maps não depende mais da Drawing Library

**Data:** 2026-08-03 · **Missão:** P1.2-R1

**Decisão:** o loader passa a carregar `libraries=geometry` e a exigir apenas
`google.maps.Map` e `google.maps.geometry`. `google.maps.drawing` sai da URL,
das capacidades exigidas, das mensagens e dos testes.

**Justificativa:** o Google removeu o `DrawingManager` do Maps JavaScript API na
versão 3.65, em junho de 2026. A partir daí o contrato da D-PROD-16 virou
insatisfazível no canal atual: mesmo com chave válida e faturamento em dia,
`google.maps.drawing` nunca aparece, `isGoogleMapsReady()` fica permanentemente
falso, e toda carga termina em `MAPS_SDK_INCOMPLETE` depois do timeout. A
exigência não protegia mais nada — garantia apenas que o mapa nunca carregasse.

A auditoria mecânica sobre `src/`, `tests/`, `scripts/`, `docs/` e `config/`
mostrou **zero uso executável** de `google.maps.drawing`, `DrawingManager` ou
`OverlayType`. O produto sempre desenhou por conta própria: `MapaDesenho` monta
ponto, linha e polígono com `google.maps.Marker`, `Polyline` e `Polygon`, mais
listeners de `dblclick`, `mousemove` e `mouseout`, e edição manual de vértices.
A library era dependência declarada e nunca exercida — por isso nada precisou
ser migrado e nenhuma dependência nova entrou.

**Consequência:** `GOOGLE_MAPS_LIBRARIES` passa a ser `'geometry'` e
`GOOGLE_MAPS_REQUIRED_LIBRARIES` a ser `['geometry']`. `isExpectedScriptSrc`
continua exigindo que a URL contenha as libraries exigidas — uma URL herdada com
`drawing,geometry` continua válida, porque contém `geometry`; o produto apenas
não gera mais essa URL. `geometry` **permanece obrigatória** porque é usada de
verdade: `computeArea`, `computeLength`, `computeDistanceBetween` e
`poly.containsLocation` aparecem em sete componentes do mapa.

**Relação com a D-PROD-16:** esta decisão **supera** a D-PROD-16 apenas na parte
que exigia `drawing`. Todo o resto da D-PROD-16 continua valendo integralmente —
capacidade comprovada em vez de `onLoad`, `dataset.loaded` como pista e nunca
prova, `MAPS_SDK_INCOMPLETE`, falha nunca em cache, retentativa possível,
`gm_authFailure` derrubando a carga. A D-PROD-16 não é apagada nem reescrita.

**O que esta decisão não afirma:** nada sobre a segurança da chave. A `VITE_*`
vai para o bundle do cliente por definição do Vite, e a proteção correta é
restrição por referrer e por API no Google Cloud. OWNER-SECURITY-01 continua
aberto.

---

## D-PROD-20 — Normalização, offline e guarda de exclusão por composição explícita

**Data:** 2026-08-05 · **Missão:** P1.4 · **Estado:** vigente

Até a P1.3, `src/api/base44Client.js` instalava **três monkey patches globais**
sobre o SDK, um atrás do outro:

```
installTextNormalization(base44Client);
applyDeleteGuards(base44Client);
installOfflineEntitySync(base44Client);
```

Cada um varria `client.entities` e substituía `create`, `update`, `list`,
`filter`, `delete` e afins **in place**, por entidade. O efeito era invisível no
código de chamada: `Produto.list()` devolvia dado formatado, `Produto.delete()`
consultava uma tabela de dependências e podia lançar, e `Lote.create()` podia
gravar numa fila IndexedDB em vez de na rede — nada disso aparecia no ponto de
uso.

Três problemas, e nenhum deles é estético:

1. **os módulos conheciam o provider.** `entities` é vocabulário da Base44, e a
   P7 troca o provider inteiro. Um utilitário de texto não tem por que saber
   disso;
2. **o acesso era por nome dinâmico.** `client.entities[entityName]` é a mesma
   porta que `gate:api-boundary` existe para fechar — só que escondida atrás de
   uma lista de strings;
3. **mutar objeto do SDK depende de o SDK expor os métodos como propriedades
   graváveis** — contrato que ninguém prometeu e que uma versão futura pode
   quebrar sem aviso.

**Decisão.** O client volta a ter responsabilidade única: ler a configuração,
criar o cliente, exportá-lo. As três capacidades passam a ser compostas
explicitamente:

- **normalização** — `createNormalizedEntityAdapter({entityName, endpoint})`
  recebe o endpoint **já resolvido** e devolve um objeto novo. `entityName` entra
  como rótulo; nada é buscado com ele. Nada é mutado;
- **runtime offline** — `createOfflineEntityAdapter({entityName, operations,
  enabled, storage})` recebe operações já resolvidas e uma porta de
  armazenamento. Conhece IndexedDB, fila, cache, ids offline, replay e
  `navigator.onLine`; não conhece Base44, client nem provider. O catálogo de
  entidades offline é montado pelo provider, literalmente, uma chamada por
  entidade;
- **guarda de exclusão** — `assertExclusaoPermitida` em
  `src/services/deleteGuardService.js`, com carregadores declarados por
  entidade. Dependência declarada sem carregador **falha**, em vez de virar
  liberação silenciosa.

O provider compõe as duas primeiras em `comFronteira(nome, endpoint)`, com a
normalização por dentro — mais perto da rede, para que o cache offline guarde o
mesmo formato que a tela veria.

**Consequência de desenho:** o runtime offline só se ativa quando há
armazenamento (`typeof indexedDB !== 'undefined'`). Sem ele — jsdom, SSR,
navegador restrito — o adapter devolve as operações **intactas**, em vez de
fingir uma fila durável que não existe. O antecessor não fazia essa checagem:
chamava `indexedDB.open` e estourava.

**Consequência operacional:** uma entrada de fila cuja entidade não está no
catálogo agora falha com `OFFLINE_ENTITY_UNSUPPORTED` e **permanece na fila**. O
antecessor fazia `continue` e o item ficava preso para sempre, invisível.

**O que esta decisão não afirma:** nada sobre atomicidade. Operação composta
continua sem transação (DBT-19). O que muda é que a falha parcial passa a ser
declarada, não escondida.

---

## D-PROD-21 — ModeloBase1 Pecuário é contrato de dados, não template visual

**Data:** 2026-08-06 · **Missão:** P2 · **Estado:** vigente

O nome "ModeloBase1" vem do PROJETOMG, onde ele significa uma coisa muito
específica: `src/ModeloBase1/` é o **motor visual certificado de cadastro** —
página fina de ~10 linhas, painéis de tabela/formulário/busca, hooks de
preferência, config factory e Template Registry — descrito no documento
04-MODELOBASE1-RULES da constituição **do PROJETOMG**, que não existe neste
repositório.

Importar esse significado para o MAIKE seria importar exatamente o que a
D-PROD-03 proíbe: runtime universal de telas e plataforma low-code. E seria
absurdo por um motivo mais simples — o MAIKE já tem as telas dele, construídas e
migradas para a fronteira nativa ao longo de toda a P1.

**Decisão.** No MAIKE, **ModeloBase1 Pecuário** significa:

1. é o **contrato base de persistência e domínio** para os futuros models Prisma;
2. **não** é um template visual;
3. **não** cria runtime genérico de telas;
4. **não** cria low-code;
5. **não** substitui as telas atuais — nada em `src/` muda por causa dele;
6. é **contrato obrigatório para P3, P4, P5 e P6**.

O contrato vive em `config/modelobase1-pecuario.json`, é lido por humanos em
`docs/architecture/MODELOBASE1-PECUARIO-CONTRACT.md` e é verificado
mecanicamente por `gate:modelobase1-pecuario`.

**Consequência.** O gate é **absoluto**: sem `--update`, sem baseline, sem modo
de correção e sem escrita no arquivo — nem quando o contrato está inválido. Ele
reprova, entre outras coisas, `meaning` diferente de
`persistence-domain-contract`, segunda exceção de tenancy além de `Cliente`,
catálogo global não vazio, `cliente_id` vindo de request, numeração por
`max + 1` ou `count + 1`, URL de provider como identidade de anexo, `AuditLog`
sem tenant e handoff de P3 incompleto. Onze códigos de falha, `P2-MB1-*`,
registrados em `docs/engineering/GATE-REGISTRY.md`.

**O que esta decisão não afirma:** nada sobre existir backend. A P2 não cria
`backend/`, não instala Prisma, não gera `schema.prisma` e não escreve migration.
O contrato descreve o que a P3 vai construir; construir é missão dela.

---

## D-PROD-22 — `Cliente` é a raiz estrutural do tenant e a única exceção atual sem `cliente_id`

**Data:** 2026-09-08 · **Missão:** precondição de governança da P3 (`P3-G0.2`)
**Estado:** vigente somente após aprovação e merge
**Emenda constitucional aprovada por:** proprietário do projeto — a aprovação se
materializa no **merge desta PR**, conforme `00-CONSTITUICAO.md` §4. Enquanto a
PR não for mergeada, esta decisão não está vigente e a P3 permanece bloqueada.

### Contexto e colisão

A regra constitucional de tenancy foi escrita antes da formalização do contrato
ModeloBase1 Pecuário. Hoje existem duas normas incompatíveis:

- `docs/constitution/00-CONSTITUICAO.md`, princípio P3, determina que
  `cliente_id` entra em todo model desde o início;
- `docs/constitution/07-DO-NOT-DO.md`, regra D1, determina que todo model possui
  `cliente_id`, sem exceção;

enquanto o contrato oficial da P2, `config/modelobase1-pecuario.json`,
estabelece:

- `Cliente` como `rootModel`;
- `Cliente` como o próprio tenant;
- `modelsWithoutTenantField = ["Cliente"]`;
- todos os models tenant-scoped com `cliente_id` obrigatório e não nulo;
- nenhum catálogo global adicional autorizado nesta fundação.

Pela hierarquia normativa vigente, a Constituição e o DO-NOT-DO prevalecem sobre
D-PROD-21. Assim, sem esta emenda, o contrato aprovado da P2 não pode ser
implementado literalmente na P3.

### Decisão

A regra original de tenancy é reafirmada e tornada estruturalmente precisa:

1. Todo model **tenant-scoped** possui `cliente_id` obrigatório e não nulo desde
   sua criação.
2. `Cliente` não é um model tenant-scoped: `Cliente` **é o próprio tenant**, e
   `Cliente.id` é a identidade da raiz de tenancy.
3. `Cliente` é a **única exceção estrutural atualmente autorizada** sem
   `cliente_id`.
4. Não existe, nesta fundação, qualquer outro model global ou catálogo global
   autorizado sem `cliente_id`.
5. Uma segunda exceção sem `cliente_id` não pode ser introduzida por
   conveniência, implementação ou alteração isolada de schema/contrato. Exige
   nova decisão formal e atualização coerente das normas e gates aplicáveis.
6. É proibido criar `cliente_id` autorreferente em `Cliente` apenas para
   satisfazer formalmente a redação anterior.

### Emenda em `docs/constitution/00-CONSTITUICAO.md`

O princípio **P3 — Tenancy desde o primeiro dia** passa a ser:

> `cliente_id` entra em todo model tenant-scoped desde o início, mesmo com um
> cliente único. `Cliente` é a raiz estrutural e a única exceção atual sem
> `cliente_id`, porque ele é o próprio tenant. Nenhuma segunda exceção é
> admitida sem decisão formal e atualização das normas e gates aplicáveis.
> Retrofitar tenancy depois é o erro mais caro possível do projeto.

### Emenda em `docs/constitution/07-DO-NOT-DO.md`

A regra **D1** passa a ser:

| # | NÃO faça | Faça em vez disso |
|---|---|---|
| D1 | Criar model tenant-scoped sem `cliente_id`, ou criar nova exceção estrutural não autorizada | Todo model tenant-scoped tem `cliente_id` obrigatório e não nulo. `Cliente` é a única exceção atual, por ser a raiz do tenant |

D2, D3, D4 e D5 permanecem vigentes.

### Contrato ModeloBase1 Pecuário

`config/modelobase1-pecuario.json` **não muda** por esta correção. Permanecem:

```text
tenancy.rootModel                        = "Cliente"
tenancy.modelsWithoutTenantField         = ["Cliente"]
tenancy.globalCatalogModels              = []
tenancy.tenantFieldRequiredOnTenantModels = true
```

A emenda alinha as normas superiores ao contrato já aprovado; não altera o
desenho aprovado na P2.

### Proteção mecânica

Na P3, `gate:tenancy` deve materializar esta decisão no schema real. No mínimo:

```text
Cliente sem cliente_id                      → PASS
Usuario sem cliente_id                      → FAIL
AuditLog sem cliente_id                     → FAIL
EntidadeCodigoSequencia sem cliente_id      → FAIL
RegistroAnexo sem cliente_id                → FAIL
qualquer segundo model sem cliente_id       → FAIL
cliente_id nullable em model tenant-scoped  → FAIL
```

A introdução de um segundo root/exceção deve reprovar com código estável:

```text
P3-TEN-ROOT-CONTRACT
```

Como estabelecido pela lição da P2-R1, a proteção só é considerada demonstrada
quando o contrato mutilado **reprovar**.

### O que esta decisão NÃO autoriza

Esta decisão não autoriza: adiar tenancy; criar model de domínio sem
`cliente_id`; criar catálogo global por conveniência; tornar `cliente_id`
nullable; criar autorrelação de `Cliente`; permitir relação cross-tenant;
remover `cliente_id` de model existente; enfraquecer
`gate:modelobase1-pecuario`; alterar `modelsWithoutTenantField` além de
`["Cliente"]`; alterar `globalCatalogModels` sem nova decisão formal.

O princípio de tenancy desde o primeiro model e a regra D5 permanecem
integralmente vigentes.

### Questão levantada e deliberadamente não resolvida aqui

`config/modelobase1-pecuario.json` **não consta** da hierarquia normativa do
`00-CONSTITUICAO.md` §3. Ele é SSOT criado pela P2 e o §3 nunca foi atualizado
para incluí-lo, de modo que o contrato oficial só tem força indireta, via
D-PROD-21, no nível 4. Incluí-lo na hierarquia foi proposto durante a análise
desta colisão e **deixado de fora desta emenda por decisão do arquiteto**, para
manter a mudança normativa restrita ao mínimo necessário para destravar a P3. A
questão fica registrada: a mesma classe de colisão pode reaparecer em P4–P6
sempre que o contrato disser algo que a Constituição ou o DO-NOT-DO não
previram.

---

## D-PROD-23 — Decisões concretas da fundação backend

**Data:** 2026-09-08 · **Missão:** P3 · **Estado:** vigente após merge

A P2 deixou seis pontos deliberadamente em aberto, para que a P3 os resolvesse
com o schema na frente. Aqui estão as escolhas, com o motivo de cada uma.

### 1. `Cliente` — forma mínima

```
id · codigo · nome · ativo · createdAt · updatedAt
```

`codigo` é o identificador operacional usado no login, com `@unique` global —
`Cliente` não é tenant-scoped, então o unique dele é global por definição
(D-PROD-22). Não é chave primária: a PK continua sendo `id`/`cuid()`.

**Não importados do PROJETOMG:** `plano`, `limite_usuarios`, `limite_empresas`,
`data_vencimento`, `total_empresas`, `next_id_global`, `cpf_cnpj`, `telefone`,
`email`. Nenhum tem consumidor na P3, e campo sem consumidor é dívida que
parece funcionalidade.

### 2. `Usuario` — forma mínima

```
id · cliente_id · nome · login · senha_hash · ativo · createdAt · updatedAt
@@unique([cliente_id, login])   @@index([cliente_id, ativo])
```

Senha existe apenas como hash bcrypt. **Não importados:** `Empresa`,
`PermissaoEmpresa`, `acesso_global`, `perfil`, `codigo`, `ultimo_acesso`.
Autorização real é P8.

### 3. Sessão e `auth_context`

JWT assinado com `AUTH_SECRET`, TTL configurável (padrão 8h), via
`@fastify/jwt`. O payload carrega `cliente_id`, `usuario_id` e `login` — nunca
senha nem hash.

O login recebe `cliente` (o `codigo`), **não** `cliente_id`. Essa inversão é o
que impede tenant vindo do payload: o `cliente_id` é **resultado** da
autenticação, não entrada dela.

`construirAuthContext` recebe o payload verificado do token e mais nada —
nenhuma função de `authContext.js` aceita `request` como parâmetro, por
desenho.

Mensagem única para toda falha de credencial, e comparação de bcrypt executada
mesmo sem usuário, contra hash descartável: sem isso o tempo de resposta separa
"usuário existe" de "não existe".

### 4. `onDelete` — `Restrict` em todas as relações com a raiz

O contrato exige política explícita e revisada, nunca cascade acidental
(`clienteDeletePolicy = "explicit-reviewed"`). `Cascade` apagaria em silêncio a
auditoria inteira de um tenant junto com o `Cliente` — exatamente o rastro que
alguém procuraria depois.

`AuditLog.usuario_id` também é `Restrict`, e não `SetNull`: anular o ator faria
um evento humano passar por evento de sistema, e o contrato reserva
`usuario_id` nulo **só** para eventos de sistema. O rastro mentiria.

Consequência aceita: apagar `Cliente` ou `Usuario` com histórico falha. A
exclusão vira operação deliberada, que é o que "explícita e revisada" significa.

### 5. `escopo_id` — sentinela não nula

**Escolhida:** `escopo_id String` não nulo. No escopo `tenant`, recebe o próprio
`cliente_id`; no escopo `empresa`, receberá o id da Empresa quando essa
capacidade existir.

**Rejeitada:** `escopo_id` nullable com unique comum. No PostgreSQL `NULL` nunca
é igual a `NULL` num índice unique — duas linhas de sequência para a mesma
entidade coexistiriam e distribuiriam números **em paralelo**. O unique não
barraria nada, e o sintoma só apareceria sob concorrência.

**Rejeitada:** índice unique parcial por `escopo_tipo`. Funciona, mas exigiria
SQL manual fora do `schema.prisma`, criando uma segunda fonte de verdade sobre
a chave — e `prisma validate` deixaria de descrever a restrição real.

Travado por `gate:indices` (`P3-IDX-SEQUENCE-NULL-SCOPE`) e provado por
concorrência real em `backend/tests/foundation.test.mjs` (BE-17).

A P3 **não** decide qual entidade usa qual escopo. Isso é P4–P6.

### 6. Banco em desenvolvimento e na CI

**Local:** Docker Compose, `postgres:16.13-alpine`, versão fixada, healthcheck,
volume nomeado. `latest` faria o banco do desenvolvedor divergir do da CI sem
ninguém perceber.

**CI:** serviço `postgres` efêmero do GitHub Actions, mesma versão, criado e
destruído com o job, `DATABASE_URL` exclusiva. Nenhuma CI toca staging,
Supabase, PostgreSQL externo ou banco do proprietário.

O banco da CI nasce vazio a cada execução, e `test:backend` roda
`prisma migrate deploy` antes dos testes — o smoke de migration sai de graça: se
a migration não aplica em banco vazio, o job falha ali.

### 7. Catálogo de erros do frontend — adiado, declarado

O contrato declara `errorNamespace.addedToFrontendCatalogInPhase = "P3"`, mas a
P3 tem `src/` congelado. Os oito códigos existem em
`backend/src/shared/errors/errorCodes.js`; **não** foram adicionados a
`src/apis/_core/ApiError.js`.

O campo do contrato, portanto, **não foi cumprido**, e
`config/modelobase1-pecuario.json` **não foi alterado** para esconder isso. A
sincronização fica para a primeira missão que autorizar tocar em `src/` — na
prática P4, quando a primeira capacidade consumir o backend e os códigos
ganharem consumidor real (a regra SE11 exige consumidor).

### 8. Dependências do backend na raiz, sem workspaces

O backend não tem `package.json` próprio. Motivo: `gate:package-sync` compara
`package.json` com `packages[""]` do lock. Um segundo manifesto criaria
dependências fora do alcance do gate; workspaces manteriam um lockfile só, mas
moveriam as dependências do backend para fora da entrada raiz — e o gate
deixaria de vê-las do mesmo jeito.

Um manifesto, um lockfile, um gate enxergando tudo.

## D-PROD-24 — Ativação do transporte e da sessão nativos na entrada da P4

**Missão:** P4.0 — Native Transport + Session Activation
**Estado:** vigente

A P3 entregou um backend que sabe autenticar, e o frontend continuou
autenticando na Base44. Enquanto isso durar, nenhuma capacidade pode ser
considerada migrada: o navegador não tem como provar quem é para o backend
próprio. A P4.0 existe para fechar essa distância — e por isso vem **antes** de
qualquer model de domínio.

### A. O backend usa JWT próprio, assinado por `AUTH_SECRET`

`POST /auth/login` devolve um token assinado pelo `@fastify/jwt` com o segredo
do processo. `GET /auth/contexto` o verifica e deriva o `auth_context`.

### B. O token da Base44 não é credencial do MAIKE

É proibido, sem exceção: repassar o token da Base44 ao backend MAIKE; validá-lo
no backend; criar troca de token Base44 → MAIKE; importar o SDK no backend;
consultar a Base44 para autenticar requisição nossa.

São dois sistemas de identidade sem relação. Aceitar credencial de um no outro
transformaria a Base44 num provedor de identidade do MAIKE — dependência nova,
na direção contrária à D-PROD-04, e criada justamente na missão que existe para
cortá-la.

`gate:native-api` protege isso com `P4-NATIVE-BASE44-TOKEN`.

### C. `VITE_MAIKE_API_URL` — pública por definição

A URL do backend nativo é variável de build e vai para o bundle. Isso está
certo: endereço de API não é segredo, e quem protege a API é o CORS mais o JWT.

Ela é **independente** de `VITE_BASE44_BACKEND_URL`, que continua apontando para
a Base44. Apontar uma para a outra quebraria as duas.

Diferente dos parâmetros da Base44, esta variável **não aceita override** por
query string nem por `localStorage`. Aqueles herdaram a porta do legado; esta
nasce sem ela, porque trocar a base URL redirecionaria o `Authorization` com o
JWT para um servidor escolhido por quem montou o link.

### D. Segredo continua só no servidor

`DATABASE_URL`, `AUTH_SECRET`, senhas e hashes nunca levam prefixo `VITE_`.
Prefixar não protege — publica.

### E. CORS com allowlist explícita

`FRONTEND_ORIGINS` é uma lista de origins exatas, comparadas por igualdade.
Proibido: `*`, `startsWith`, `includes`, sufixo parcial, regex aberta, ou ecoar
a origin recebida (que é wildcard escrito de outro jeito).

Lista vazia significa **nenhuma origin de navegador autorizada** — configuração
ausente vira porta fechada, nunca porta aberta.

Requisição sem `Origin` continua passando: CORS é proteção que o navegador
aplica a páginas web, e recusá-la não bloquearia atacante nenhum enquanto
quebraria health check e integração. A defesa dessas chamadas é o JWT.

`credentials` fica em `false`: esta fase usa Bearer, e ligar cookie abriria CSRF
sem nenhum ganho.

### F. O JWT nativo mora em memória + `sessionStorage`

Uma única chave, `maike_native_access_token`, num único módulo
(`src/lib/auth/nativeTokenStorage.js`).

**Proibido** guardar o token nativo em: `localStorage`, query string, hash de
URL, cookie de JavaScript, variável `VITE_`, console, log, `ApiError.details`,
documentação ou estado serializado do React Query.

`localStorage` sobrevive a fechar o navegador; num computador compartilhado —
o caso comum na fazenda — isso deixa sessão aberta para o próximo. O
`sessionStorage` morre com a aba, que é o tempo de vida que uma sessão de
trabalho deveria ter.

**O trade-off, dito sem maquiagem:** `sessionStorage` é acessível a JavaScript.
Um XSS nesta origem lê o token, e trocar `localStorage` por `sessionStorage`
**não resolve XSS** — reduz a janela, não a classe do problema. A defesa real é
cookie `HttpOnly` com `SameSite`, refresh token com rotação, revogação no
servidor e CSP. Nada disso está nesta fatia. Pertence à fase de segurança (P8),
e registrar isso importa: sem o registro, ficaria a impressão de que a sessão
está endurecida.

**Refresh token não foi implementado nesta PR**, por decisão de escopo.

### G. A autenticação do aplicativo é nativa, sem dual-auth

A Base44 continua **apenas** como provider dos dados ainda não migrados.

Não existe fallback: se o backend MAIKE não responde, o usuário vê falha de
login — não uma sessão Base44 de consolação. Dual-auth silenciosa transformaria
"o backend caiu" em "sua senha está errada", que é a pior mensagem possível:
manda o usuário tentar de novo para sempre e esconde o incidente de quem
poderia resolvê-lo.

Consequências práticas registradas:

- `redirectToLogin` saiu da cadeia. Ele mandava o usuário ao login da Base44, o
  que autenticaria no provider errado e voltaria sem sessão MAIKE — laço sem
  saída;
- o `logout` da Base44 saiu, e **não deve** ser chamado. O token do SDK chega
  uma única vez pela query string; descartá-lo deixaria o próximo login com
  sessão MAIKE válida e provider de dados morto, sem caminho de volta. Ele é a
  credencial da aplicação com a Base44, não a do usuário com o MAIKE;
- o logout nativo é **local**. O JWT da P3 é stateless: não há sessão a
  invalidar no servidor. Revogação de verdade exige lista de invalidação ou
  refresh com rotação — P8.

**G.1 — Falha de autenticação ≠ falha de disponibilidade** (refinamento
P4.0-R1, mesma decisão)

A primeira implementação desta decisão tratava as duas como a mesma coisa: a
restauração da sessão apagava o JWT para **qualquer** erro. Um backend fora do
ar por trinta segundos destruía a sessão de quem estava trabalhando e exigia
senha de novo — punindo o usuário por uma falha de infraestrutura, e apagando a
única credencial que ele tinha.

A distinção agora é explícita, e vale só para a **restauração**:

| Resposta do servidor | Token | Estado | Tela |
|---|---|---|---|
| 200, contexto válido | preservado | autenticada | aplicativo |
| `TENANT_CONTEXT_REQUIRED` | **removido** | não autenticada | login nativo |
| rede, timeout, CORS, 5xx | **preservado** | validação indisponível | "Não foi possível validar sua sessão", com *Tentar novamente* |

A regra que separa os casos é o **código**, não a faixa de status: `403` de
escopo (`TENANT_SCOPE_VIOLATION`) não diz que a credencial é inválida e também
não limpa o token.

Isto **não** é confiar no token guardado. Enquanto o backend não confirmar,
`isAuthenticated` continua `false`, o aplicativo continua fechado e nenhum
conteúdo protegido é renderizado. É **fail-closed sem destruir a credencial**.
O login também não aparece: pedir senha ali diria ao usuário que ela não serve,
quando o servidor apenas não respondeu.

O retry reusa o **mesmo** JWT e chama `/auth/contexto` de novo. Nunca
`/auth/login`, nunca pede senha, nunca decodifica ou valida o JWT no frontend,
nunca renova token e nunca cai para a Base44 — a ausência de fallback do item G
vale igualmente aqui: o comportamento correto é "backend indisponível", jamais
"backend indisponível → Base44".

**O login novo não muda.** Se `/auth/contexto` falhar logo depois de um
`POST /auth/login`, a sessão é descartada e a falha aparece como falha de
login. Ali não existe credencial anterior a preservar, e sessão pela metade é
pior que sessão ausente. O bloqueador corrigido era especificamente
*JWT já existente + reload + indisponibilidade transitória*.

### H. O frontend nunca fornece o tenant

O login envia exatamente `{cliente, login, senha}`. `cliente` é o código
operacional digitado por quem entra; `cliente_id` é o que o backend **devolve**
depois de autenticar.

Essa inversão é a regra de tenancy inteira em uma linha. O backend já recusa
`cliente_id` no corpo com 400 (`additionalProperties: false` mais
`removeAdditional: false`, correção da P3), mas não é por isso que não
mandamos: não mandamos porque o tenant não é nosso para informar.

`P4-NATIVE-TENANT-SOURCE` protege o lado do cliente.

### I. Por que a P4.0 vem antes de Setor

`AreaPastagem` depende de `Setor`, e `Setor` depende de existir um caminho
autenticado até o backend. Criar model de domínio antes disso produziria
persistência que ninguém consegue consumir — e a primeira tentativa de consumo
descobriria, tarde, que faltava autenticação, transporte, CORS e catálogo de
erro.

A ordem é P4.0 → P4.1 (Setor) → P4.2 (AreaPastagem).

### J. O catálogo de erros do frontend, fechado

`config/modelobase1-pecuario.json` declara
`errorNamespace.addedToFrontendCatalogInPhase = "P3"`, e a P3 não pôde cumprir
porque `src/` estava congelado (D-PROD-23, item 7). A P4.0 fecha a dívida: os
oito códigos entraram em `src/apis/_core/ApiError.js` com mensagem pública
própria, agora que existe consumidor real.

`AUTH_INVALID_CREDENTIALS` entrou junto, pelo mesmo critério de consumidor real
que removeu `PRODUTO_PARTIAL_IMPORT` na P1.4-R1. Os demais códigos backend-only
(`REQUEST_VALIDATION_FAILED`, `REQUEST_REJECTED`, `INTERNAL_ERROR`) **não**
viraram vocabulário público: descrevem o que o servidor achou da requisição, e
para a tela isso já é `API_INVALID_ARGUMENT` ou `API_OPERATION_FAILED`.

O SSOT dos códigos continua sendo o JSON do contrato. O catálogo do frontend é
de **mensagem**, não segunda fonte de verdade.

### K. A mensagem do servidor nunca é exibida

O backend responde `{code, message, request_id}`. O frontend usa `code` e
descarta `message`.

Não é desconfiança do próprio backend: mensagem de servidor carrega caminho, id
interno, fragmento de query e, num dia ruim, eco da entrada do atacante.
Exibi-la daria aparência confiável a texto não controlado — o mesmo defeito que
a P1.1-R2 corrigiu no `ApiError` (R2-B3). O texto exibível vem do catálogo
local.

---

## D-PROD-25 — Setor é a primeira capacidade de domínio com persistência nativa

**Data:** P4.1 · **Missão:** P4.1 — Setor Native Persistence

**Decisão:** `Setor` deixa de ser entidade da Base44 e passa a ser model Prisma
tenant-scoped no backend próprio, com migration versionada, rotas autenticadas e
numeração por `EntidadeCodigoSequencia`. A leitura do cadastro, a leitura do
mapa, a criação e a atualização passam a ser nativas. A Base44 não é mais
origem, destino nem **fallback** do dado de Setor.

Nenhuma outra capacidade migra nesta missão. `AreaPastagem`,
`PontoReferencia`, `PontoSuplementacao`, `LinhaGeografica`,
`ConfiguracaoIcone`, `MovimentacaoMapa`, `Empresa` e `Lote` continuam onde
estavam.

### A. Por que Setor primeiro

`AreaPastagem` referencia `Setor` — por `setor_id` e pelo nome denormalizado.
Migrar a área antes obrigaria a criar uma FK para um model inexistente ou a
deixar o vínculo solto, e a segunda opção nunca é corrigida depois. Setor é a
folha da árvore de dependências do mapa, e por isso é a primeira.

### B. Numeração: escopo `tenant`, não `empresa`

O contrato oferece os dois escopos e manda a **capacidade** escolher
(`numbering.scopeDeclaredByCapability`). A P4.1 escolhe `tenant`.

Numerar por empresa exigiria que `escopo_id` fosse um id de `Empresa` — e
`Empresa` só é nativa na P6. O backend não tem como provar que o `empresa_id`
recebido existe, pertence a este tenant ou não foi inventado. Ancorar uma
sequência num identificador que ele não consegue validar produziria uma
sequência por string arbitrária, criada sob demanda por quem chamasse a API.

Escopo `tenant` numera mais largo — dois setores de empresas diferentes não
compartilham número — e é verificável hoje. Estreitar depois é decisão da P6,
com `Empresa` nativa; alargar depois seria migração de dado.

**Consequência declarada:** a numeração muda de significado. Antes,
`numero_setor` vinha de `MAX + 1` sobre *todos* os setores carregados —
efetivamente global e sujeito a corrida. Agora é uma sequência por tenant,
atômica e sem reuso após exclusão.

### C. `empresa_id` continua String, sem relação Prisma

`Empresa` é P6. Uma relação para um model inexistente não compila, e criar um
model `Empresa` mínimo só para satisfazer a FK anteciparia uma capacidade
inteira dentro de uma missão que não a autoriza.

`empresa_id` carrega o valor que a Base44 já gravava, e o filtro por empresa que
a tela faz continua funcionando. Vira FK composta tenant-aware quando `Empresa`
for nativa.

### D. NÃO existe `DELETE /setores/:id`

A guarda de exclusão de Setor consulta `AreaPastagem`, `LancamentoTarefa`,
`MovimentacaoMapa` e `MovimentacaoPecuaria` — por id **e** por nome
denormalizado. As quatro continuam na Base44; o Setor não. As saídas possíveis
eram:

| Saída | Por que foi recusada |
|---|---|
| Apagar no nativo, conferir vínculo na Base44 | operação destrutiva decidida por dois sistemas, sem transação em volta. Uma metade falha e sobra área apontando para setor inexistente |
| Apagar sem conferir | destrói a integridade que hoje existe |
| Aceitar do frontend uma "prova" de que pode apagar | o cliente decidindo a própria autorização |
| Consultar a Base44 a partir do backend | proibido por `P3-TEN-BASE44` — o backend nativo dependeria da plataforma que substitui |

A quinta é recusar, e é a escolhida. A rota **não existe** — não é um handler
que reprova. O frontend recusa localmente, sem requisição, com código próprio
`SETOR_DELETE_UNAVAILABLE`.

O código é próprio de propósito. `SETOR_DELETE_BLOCKED` significa "existem
registros vinculados", e usá-lo aqui afirmaria um vínculo que ninguém
verificou — mentira útil que esconderia o motivo real quando a P4.2 reabrir a
exclusão. Pelo mesmo critério, `SETOR_DELETE_BLOCKED` **saiu** do catálogo do
frontend: ficou sem consumidor, e código catalogado sem consumidor é promessa
sem contrato (regra herdada da P1.4-R1, que removeu `PRODUTO_PARTIAL_IMPORT`).

**Segurança e integridade prevalecem sobre paridade de funcionalidade.**
Paridade falsa é pior que função ausente, porque some com o dado.

### E. `SETOR_NOT_FOUND`, e não `TENANT_SCOPE_VIOLATION`

Um `PATCH` com id de outro tenant devolve 404 `SETOR_NOT_FOUND`, indistinguível
de um id que nunca existiu — mesma resposta, mesmo status, mesma mensagem.

`TENANT_SCOPE_VIOLATION` (403) descreveria o caso, mas **confirmaria** que o
registro existe em outro cliente: quem quisesse descobrir se um id pertence a
outro tenant bastaria comparar as respostas. E `ATTACHMENT_OWNER_INVALID`, o 404
do contrato, fala de anexo — reaproveitá-lo só para evitar um código novo
tornaria o vocabulário mentiroso.

### F. Uma porta só para o cadastro e para o mapa

Antes existiam duas leituras do mesmo agregado: `mapaProvider.listSetores` e
`setoresProvider.list`. Eram equivalentes enquanto batiam na mesma entidade da
Base44. Com persistência nativa deixariam de ser: duas portas, dois caches
offline com a mesma chave, e nenhuma garantia de que o mapa e o cadastro
enxergassem a mesma lista.

`src/apis/setores/setorNativePort.js` é a porta única. `src/apis/mapa` reexporta
`listSetores` dela — a superfície pública do mapa não muda.

### G. O corpo enviado é montado por lista literal de campos

`CadastroSetores` monta o formulário de edição com
`{...getInitialFormData(), ...setor}`, então o objeto que chega à porta carrega
`id`, `numero_setor`, `created_date`, `updated_date` e, quando o registro nasceu
offline, `_isOffline` e um id `offline_…`. O backend recusa todos com 400
(`additionalProperties: false` + `removeAdditional: false`), e está certo: os
três primeiros são atribuídos pelo servidor.

A filtragem mora na camada mais interna — a porta — e não no service, porque o
**replay da fila offline** chama as operações diretamente, sem passar por
service nenhum. Sem ela, todo setor criado sem rede falharia no replay.

**A regra de identidade do backend não foi enfraquecida para acomodar o
offline.** O offline é que passou a respeitá-la.

### H. Registry e manifesto deixam de ser iguais — e essa é a única diferença aceita

A P1.4 fechou o registry do provider **igual** ao manifesto: 38 e 38. A P4.1
abre a primeira diferença: 37 no registry, 38 no manifesto.

`base44/entities/Setor.jsonc` continua existindo e `Setor` continua em
`allowedBase44Entities` porque `syncEntityReferences` — a function que propaga o
nome do setor para os campos denormalizados de **seis** destinos (§N) — ainda
roda na Base44 e ainda o cita. `gate:product-scope` exige manifesto e
schemas iguais nos dois sentidos, então tirá-lo de lá reprovaria por uma
independência que ainda não existe.

A verificação continua sendo por **igualdade**, não por inclusão: o conjunto
esperado é `manifesto − MIGRADAS_PARA_NATIVO`, e cada nome dessa lista é
conferido contra o manifesto **e** contra o registry. Trocar por "é
subconjunto" deixaria qualquer entidade sumir do registry sem ninguém decidir
nada — e sumir do registry é justamente o sintoma de uma migração pela metade.

### I. A normalização de texto continua no frontend

Nome e campos em maiúsculas, decimal com vírgula, opcional vazio como `null`.
É convenção de apresentação do cadastro, não invariante de dados. Duplicá-la no
backend criaria duas versões da mesma regra, que divergiriam na primeira vez que
uma das duas mudasse.

O backend valida o **contrato**: forma, tamanho, tipo permitido, campo
desconhecido — no schema da rota, onde a falha vira 400 antes de qualquer regra
rodar.

### J. `ativo` não virou soft delete

O campo existe desde o cadastro legado e continua sendo campo de negócio. O
contrato proíbe `ativoFieldReplacesDeletionPolicy`, e a P4.1 não transformou a
recusa de exclusão em "marque como inativo": a recusa é explícita, com código
próprio, e não altera dado nenhum.

### K. `gate:setor-native`

Gate **absoluto** — sem `--update`, sem baseline, sem correção automática, nunca
escreve arquivo. **Doze** regras e **54 provas**, quase todas negativas, com
controles positivos para cada regra que poderia virar scanner ingênuo.

Composição: dez regras e 42 provas nesta fatia; `P41-SETOR-OFFLINE-TENANT` e mais
seis provas na P4.1-R1 (§L); `P41-SETOR-TIPO-DEFAULT` e mais seis na P4.1-R2
(§M).

Ele existe porque nenhuma dessas invariantes quebra em vermelho: um
`setoresProvider` reintroduzido continuaria listando setores; um `catch`
devolvendo a lista da Base44 pareceria resiliência; um `MAX + 1` de volta no
service passaria em toda tela de navegador único.

### L. P4.1-R1 — o armazenamento offline ganhou dono

Três defeitos achados em revisão da própria PR, corrigidos **dentro dela**, como
a P4.0-R1 foi na PR #12. Os dois primeiros só existem porque a P4.1 mudou quem
autentica o replay.

#### L.1 A fila era de todo mundo

Cache e fila eram particionados por `entidade::empresa_id`. Não havia tenant em
lugar nenhum — e não precisava haver: enquanto `Setor` vivia na Base44, o replay
usava a credencial de lá, que não é tenant do MAIKE.

Com a P4.1 o replay passou a mandar `Authorization: Bearer` do MAIKE, e o
backend tira o `cliente_id` **do token**. A sequência:

1. usuário do cliente A cria um setor offline; a operação fica na fila;
2. sai da sessão. `logout()` descarta o JWT e nada mais — o IndexedDB fica;
3. usuário do cliente B entra no mesmo navegador;
4. volta a conexão, o replay dispara e grava o setor de A **dentro de B**.

Nenhuma regra do backend foi violada: o tenant sempre veio do token, como manda
a R11. O erro é do cliente, que replayou operação de outro dono — e é por isso
que a correção é toda do lado do navegador.

Agora cache, fila e replay têm dono. `getOfflineTenant()` responde quem é, a
chave do cache carrega o `cliente_id`, e cada entrada da fila é carimbada no
enfileiramento. O replay classifica cada entrada em `aplicar`, `pular` ou
`descartar` — e uma entrada de outro dono **fica na fila**, intocada, até aquele
dono voltar. Pular não é perder.

#### L.2 A fila legada travava tudo

`operacoesNativas` não tem `delete`, por decisão (§D). Uma exclusão enfileirada
**antes** do corte chamava `operations.delete(...)` e estourava `TypeError`; o
replay retorna no primeiro erro, então a fila **inteira**, de todas as
entidades, parava ali para sempre. Um `update` enfileirado contra id da Base44
dava 404 nativo e travava igual.

Entradas anteriores ao corte são identificáveis: não têm carimbo de dono. Elas
são **descartadas**, e isso é deliberado. As alternativas são piores:

- tentar aplicar é o defeito que estamos corrigindo;
- atribuí-las ao tenant logado gravaria dado de procedência desconhecida dentro
  de um cliente real — inventar dono é pior do que perder rascunho;
- deixá-las na fila para sempre reproduz o bloqueio, só que silencioso.

O descarte é a única perda de dado deste desenho, está dita aqui em vez de
escondida, e alcança apenas operação offline que nunca chegou a servidor nenhum.
O cache no formato antigo — `Setor::empresa`, inalcançável pelas chaves novas —
também é removido na primeira gravação de cada entidade+empresa, para que dado
da era Base44 não fique em repouso depois do corte.

#### L.3 Obrigatório só com espaço virava 500

`minLength: 1` aceita `" "`. `textoOuNulo` apara e devolve `null`, então o valor
chegava ao Prisma como `null` numa coluna NOT NULL e virava `INTERNAL_ERROR`
500 — recusa correta, status errado, sem causa para quem chamou. `pattern: '\\S'`
nos obrigatórios move a recusa para a fronteira, com 400. É a mesma classe que o
`maxLength` já tratava ali.

#### O que a P4.1-R1 **não** fez

- **não** mudou a regra do backend. O tenant continua vindo só do token; nada
  do lado do servidor foi afrouxado para acomodar o cliente;
- **não** tornou as entidades da Base44 tenant-scoped. Elas não têm tenant do
  MAIKE, e carimbar um dono que não governa nada só inventaria procedência.
  `tenantScoped` é opt-in por entidade, e OFF28/OFF29 são o controle positivo
  de que a fila delas segue funcionando igual;
- **não** limpa o IndexedDB no logout. Seria mais simples e destruiria trabalho
  offline legítimo de quem apenas troca de usuário e volta.

Gate: `P41-SETOR-OFFLINE-TENANT`, com as três pontas exigidas — a porta declara,
o runtime decide, a sessão marca e descarta. SN-13 a SN-17 reprovam cada
mutilação; SN-18 é o controle positivo.

### M. P4.1-R2 — o default de `tipo` que ficou para trás

Divergência objetiva de persistência, achada em auditoria **depois** do merge da
PR #14. Não é decisão nova: é defeito de implementação desta mesma D-PROD-25, e
por isso mora aqui em vez de consumir um identificador próprio.

`base44/entities/Setor.jsonc` declara, para `tipo`:

```json
"tipo": { "type": "string", "enum": ["Próprio", "Arrendado", "Parceria", "Terceiros"], "default": "Próprio" }
```

A P4.1 trouxe o enum (no schema HTTP) e a obrigatoriedade (`NOT NULL`), e deixou
o **default** para trás. O Prisma tinha `tipo String @db.VarChar(32)` e a
migration criou `"tipo" VARCHAR(32) NOT NULL`, sem `DEFAULT`.

#### A correção é aditiva, e isso não é preferência

A migration `20260909112833_p4_1_setor_native` já está mergeada e **aplicada no
ambiente real**, com o checksum registrado em `_prisma_migrations`. Editá-la para
"sempre ter tido" o default mudaria esse checksum e quebraria todo
`migrate deploy` seguinte com "migration was modified after it was applied".

Então a cadeia passa a ter dois passos, e é o **estado final** que importa:

| Passo | Efeito |
|---|---|
| `20260909112833_p4_1_setor_native` | cria `"tipo" VARCHAR(32) NOT NULL`, sem default |
| `20260909201703_p4_1_r2_setor_tipo_default` | `ALTER COLUMN "tipo" SET DEFAULT 'Próprio'` |

Reescrever histórico para que ele pareça correto desde sempre é a forma mais
limpa de perder a capacidade de confiar no histórico.

#### O default **não** torna `tipo` opcional na API

`POST /setores` continua exigindo `empresa_id`, `nome` e `tipo`. Sem `tipo` a
resposta é 400 `REQUEST_VALIDATION_FAILED`, e nada é gravado.

O default é **última barreira de persistência** — a garantia de que nenhum
caminho de escrita, hoje ou depois, consiga gravar a coluna vazia. Não é
permissão para o cliente omitir a intenção do usuário. Afrouxar o schema HTTP
porque o banco tem default trocaria uma escolha explícita por um palpite
silencioso, e o palpite ficaria gravado como se fosse decisão de quem cadastrou.

#### Prova

Nenhum gate estático prova default físico: ler `SET DEFAULT` no arquivo prova que
o texto está lá, não que o PostgreSQL aplicou.

- `P41R2-BE-01` lê `information_schema.columns` e exige `column_default` com
  `'Próprio'`;
- `P41R2-BE-02` grava por `INSERT` **cru**, omitindo a coluna, e lê o valor
  persistido. É cru de propósito: `prisma.setor.create` poderia preencher do lado
  do cliente e o teste passaria com a coluna sem default nenhum;
- `P41R2-BE-03` prova que a API continua explícita — 400, zero `Setor`, zero
  `AuditLog` e **zero sequência consumida**;
- `P41R2-BE-04` é o controle positivo: `tipo` informado continua sendo
  respeitado, e o default não sobrescreve.

Gate `P41-SETOR-TIPO-DEFAULT`, sobre o estado final da cadeia. SN-19 a SN-21b
reprovam cada mutilação, inclusive um `DROP DEFAULT` posterior a um `SET`.
SN-22 é o controle que importa: comentário citando `@default("Próprio")` e
`SET DEFAULT 'Próprio'` **não** satisfaz a regra.

### N. Dois contratos diferentes sobre as dependências de Setor

Auditoria da P4.1-R2 encontrou o SSOT afirmando que a propagação de Setor alcança
"quatro entidades". O código diz outra coisa.

`base44/functions/syncEntityReferences/entry.ts` tem **15 regras** no bloco
`Setor`, sobre **seis destinos distintos**:

| # | Destino | Também na guarda de exclusão? |
|---|---|---|
| 1 | `AreaPastagem` | sim |
| 2 | `PontoSuplementacao` | **não** |
| 3 | `Lote` | **não** |
| 4 | `LancamentoTarefa` | sim |
| 5 | `MovimentacaoMapa` | sim |
| 6 | `MovimentacaoPecuaria` | sim |

Já `deleteRules.Setor` lista **quatro** dependências: `AreaPastagem`,
`LancamentoTarefa`, `MovimentacaoMapa`, `MovimentacaoPecuaria`.

**São contratos diferentes, e não deviam ter sido tratados como o mesmo.**
Um responde "quem exibe o nome do setor e precisa ser atualizado quando ele
muda"; o outro responde "quem impede o setor de ser apagado". Um destino pode
estar em um e não no outro sem que isso seja bug — `Lote` guarda o nome do setor
para exibição sem que isso, por si, bloqueie a exclusão.

Esta R2 **não** acrescenta dependências ao `deleteGuardService`. O `DELETE` de
Setor continua fechado (§D), então mexer na guarda agora mudaria comportamento
sem consumidor e sem prova de necessidade.

O que fica registrado é o critério de reabertura:

> `DELETE /setores/:id` **não** pode ser reaberto com a frase "as quatro
> dependências migraram". Antes de reabrir, a fatia responsável precisa
> reconciliar, explicitamente: `deleteRules`; as FKs nativas realmente criadas;
> os **seis** destinos de `syncEntityReferences`; a semântica de `Lote`; e a
> semântica de `PontoSuplementacao`.

---

## D-PROD-26 — A base URL do backend nativo é absoluta ou não existe

**P4.0-R2.** Corrige um defeito que chegou ao usuário em produção.

Fatia corretiva da P4.0, não uma fatia nova: o defeito está no transporte
que a P4.0 entregou. `P4.2` continua reservada para `AreaPastagem Native
Persistence` no ROADMAP.

`D-PROD-25` pertence à P4.1 (persistência nativa de Setor), em revisão na
PR #14 no momento em que esta decisão foi escrita.

### O defeito

`VITE_MAIKE_API_URL` foi configurada na Vercel como
`maike-production.up.railway.app` — sem `https://`.

Isso não produziu erro em lugar nenhum. `nativeRequest` monta a URL por
concatenação literal (`` `${base}${caminho}` ``), e
`fetch('maike-production.up.railway.app/auth/login')` é uma URL **relativa**: o
navegador a resolve contra a origem do documento. O resultado observado:

```
POST https://maike-five.vercel.app/maike-production.up.railway.app/auth/login
→ 404, content-type: text/plain, "The page could not be found"
```

Três consequências, em ordem de gravidade:

1. o `POST /auth/login` levava **cliente, login e senha em texto** para a origem
   do frontend, não para o backend. A credencial saiu para o host errado;
2. o corpo não era JSON, então `lerCorpo` devolveu `null`, a validação do
   retorno falhou e a tela mostrou um erro genérico — sem nenhuma pista de que o
   destino estava errado;
3. o diagnóstico apontava para o lugar errado. `curl` contra o backend
   autenticava com `200`; só o navegador falhava. Backend, banco, CORS e JWT
   estavam corretos o tempo todo.

### A decisão

`getNativeApiUrl()` passa por `comEsquemaExplicito()`:

| Entrada | Resultado | Motivo |
|---|---|---|
| `https://api.exemplo.com` | intacta | já é absoluta |
| `http://localhost:3333` | intacta | backend local, e o `.env.example` documenta assim |
| `api.exemplo.com` | `https://api.exemplo.com` | host puro; o frontend é servido por HTTPS e `http://` seria bloqueado como conteúdo misto de qualquer forma |
| `api.exemplo.com:8443` | `https://api.exemplo.com:8443` | idem, com porta |
| `//outro.host` | `null` | protocol-relative: aponta para outro host herdando o esquema |
| `javascript:...` | `null` | esquema executável |
| `ftp://...` | `null` | esquema que o `fetch` não usa |
| `/api`, `host/caminho` | `null` | caminho relativo — o defeito original, em outra forma |

Com `null`, `nativeRequest` já falhava do jeito certo desde a P4.0: lança
`PROVIDER_UNAVAILABLE` **sem tocar na rede**. A senha não sai da máquina.

### Por que normalizar o host puro em vez de recusar tudo

Recusar seria mais simples e igualmente seguro, mas transformaria uma
configuração comum — host sem esquema — em aplicação fora do ar até alguém
reconfigurar a plataforma e reconstruir o bundle. `VITE_*` é variável de
**build**: o ciclo de correção é um deploy inteiro, não um restart.

Aceitar o host puro tem exatamente uma interpretação segura (`https://`), e é a
mesma que o navegador exigiria de qualquer forma. O que **não** é aceito é toda
forma ambígua — e essas são justamente as que produziriam requisição same-origin
ou destino inesperado. A regra é: normalizar o inequívoco, recusar o resto.

### `new URL()` continua fora

Pelo mesmo motivo de `semBarraFinal` (D-PROD-24): `new URL('javascript:alert(1)')`
é uma URL válida para o construtor. A validação é literal e conservadora.

### Gate

`P4-NATIVE-SCHEME`, em `gate:native-api` — absoluto, sem baseline. Exige as duas
pontas: que a validação exista e teste o esquema, e que `getNativeApiUrl()` passe
por ela. Provas negativas NAT-25/26/27, controle positivo NAT-28.

### O que esta decisão **não** faz

- não muda `nativeRequest`: a concatenação literal continua, e continua certa —
  o contrato agora é que a base já chega absoluta;
- não introduz override de URL por query string ou storage. A porta que a P4.0
  fechou (D-PROD-24) segue fechada: quem trocasse a base redirecionaria o
  `Authorization` com o JWT para um servidor escolhido por ele;
- não valida se o host **existe**. Isso é resposta de rede, não de configuração.

## D-PROD-27 — Sem backfill: o backend nativo começa vazio

**P4.1-R2.** Registra uma decisão do **proprietário**, não do arquiteto.

### A decisão

Os registros históricos que vivem na Base44 **não** serão migrados para o
PostgreSQL. As capacidades nativas nascem vazias, e o proprietário recadastra o
que precisar.

Isso vale para todas as fatias seguintes, não só para `Setor`.

### O que a decisão elimina

Backfill é, de longe, a parte mais cara e mais arriscada de sair de uma
plataforma. Sai tudo isto do caminho:

| Some | Por quê |
|---|---|
| **Backfill** | não há histórico a ler, transformar e carregar |
| **Dual-write** | não há janela em que as duas bases precisem concordar |
| **Reconciliação** | não há contagem nem checksum a comparar entre Base44 e PostgreSQL |
| **Rollback de dado** | não há dado migrado para desfazer |
| **Downtime de corte** | não há volume a transferir |

O que sobra é migração de **capacidade**: modelar schema, escrever rotas e
serviços, trocar o provider no frontend. O trabalho continua existindo; o risco
de corrupção silenciosa de dado histórico, não.

### O que a decisão **não** autoriza

Esta é a parte que precisa estar escrita, porque "não vamos migrar dado" é fácil
de ler como "podemos apagar dado".

**Não autoriza apagar nada do backend nativo.** `Cliente`, `Usuario`,
`AuditLog`, `EntidadeCodigoSequencia`, `RegistroAnexo` e `Setor` que já existam
continuam onde estão. Toda linha ali foi criada por uso real ou por decisão
explícita.

**Não autoriza apagar nada da Base44.** A base legada permanece intacta. Não
carregar o histórico no destino é diferente de destruir a origem — enquanto a
Base44 for a fonte das 37 entidades restantes, apagá-la seria apagar o sistema
em produção.

**Não autoriza limpeza automática de nada, em lugar nenhum**, sem ação explícita
e nomeada do proprietário.

### Consequência visível

Cada capacidade migrada aparece **zerada** na tela até ser recadastrada. Isso é
esperado, não é defeito, e não deve ser "corrigido" com carga improvisada.

### O que esta decisão **não** faz

Não comprime o ROADMAP. A premissa está oficializada aqui; o replanejamento das
fases seguintes é trabalho da próxima fatia de implementação, com auditoria
própria. A P4.2 continua **não iniciada**, e nenhum model novo entrou nesta R2.

## D-PROD-28 — Migrations de produção são etapa de deploy, não de startup

**DEPLOY-MIGRATION-01.** Infraestrutura de entrega, não capacidade de domínio.

### O problema

Até aqui, migration em produção era **ato manual**. A tabela `Setor` (P4.1) e o
default de `Setor.tipo` (P4.1-R2) foram aplicados à mão — e a segunda ficou
horas no repositório sem estar no banco, depois do merge, porque o deploy do
Railway constrói e sobe o código sem aplicar migration nenhuma.

Com uma capacidade por vez isso é incômodo. Com uma onda de domínio inteira, é
a garantia de que em algum deploy o código chega antes da tabela — e o sintoma
aparece como erro de aplicação em produção, não como falha de deploy.

### A decisão

**A.** Migrations de produção rodam **antes** do processo principal do backend
entrar em execução.

**B.** Migration **não** roda em `backend:start`, `server.js`, `app.js`, rota de
health, primeira requisição, nem no startup de cada réplica.

**C.** O motivo não é estético. Migrar no startup faz o lifecycle do schema
virar o lifecycle do processo:

- todo restart, todo crash-loop e todo scale-up tentam migrar;
- com N réplicas, N processos disputam a mesma tarefa. O advisory lock do
  Prisma evita corrupção, mas transforma o start numa fila — e o healthcheck
  não espera fila;
- falha de migration vira falha de boot, que o orquestrador trata como
  "reinicie", produzindo um loop em vez de um erro legível;
- o deploy anterior, saudável, é substituído antes de alguém saber que o schema
  não subiu.

**D.** No Railway a responsabilidade é do **pre-deploy**, que roda entre o build
e o deploy, com acesso às variáveis do serviço e à rede privada.

**E.** Falha de migration **impede o deployment de prosseguir**. É a semântica
documentada do pre-deploy: exit ≠ 0 não é repetido e o deploy não avança.

**F.** A migration usa conexão própria: `MIGRATION_DATABASE_URL`.

**G.** A aplicação continua usando `DATABASE_URL`.

**H.** `MIGRATION_DATABASE_URL` é server-only: nunca com prefixo `VITE_`, nunca
no bundle, nunca versionada, nunca impressa, **nunca com fallback silencioso
para `DATABASE_URL`**.

**I.** No Supabase, a migration usa a conexão de **sessão** (Supavisor session
mode) ou a **direta**, ambas na 5432 — e **não** o pooler de modo transação na
6543.

**J.** Nenhum seed automático é acoplado ao deploy.

**K.** Só migrations versionadas são executadas: `prisma migrate deploy`. Nunca
`migrate dev`, `db push` ou `migrate reset` em produção.

**L.** O comando é idempotente: com tudo aplicado, ele sai 0 e o deploy segue.

**M.** Aplicar schema e servir tráfego são estágios diferentes.

**N.** O caminho é provado na CI contra PostgreSQL descartável.

### Por que uma variável separada, e por que sem fallback

As duas conexões têm requisitos diferentes. A aplicação pode falar por um pooler
de transação, otimizado para muitas conexões curtas. A migration não: roda DDL
em transação longa, com advisory lock, e precisa de sessão de verdade.

Fallback silencioso seria o pior dos mundos. Em produção, com a variável
ausente, o runner usaria a conexão da aplicação e **funcionaria** — até o dia em
que travasse no meio de um `ALTER TABLE`, com o deploy pela metade e ninguém
sabendo por quê. Já aconteceu neste projeto uma vez, com `migrate deploy`
apontado para a 6543: ficou pendurado até o deploy ser cancelado à mão.

Ausência é falha dura, e é dura de propósito.

### Por que o schema Prisma NÃO ganhou `directUrl`

O Prisma 6 suporta `directUrl` no datasource, e seria a solução "de manual".
Recusada aqui: ela faria `prisma validate`, `prisma generate`, o
desenvolvimento local, a CI e o runtime passarem todos a depender de uma segunda
variável para resolver um problema que é **só do deploy**.

Em vez disso, a fronteira é explícita e mora num lugar só: o runner passa
`DATABASE_URL=<MIGRATION_DATABASE_URL>` ao subprocesso do Prisma, e só a ele.

```
runtime    → DATABASE_URL
migration  → MIGRATION_DATABASE_URL (substituída na fronteira)
schema     → env("DATABASE_URL"), simples e inalterado
```

O ambiente do próprio runner não é mutado; a substituição existe apenas no
`env` do subprocesso.

### Config as Code do Railway NÃO foi adotado

A implementação original prevista era versionar `railway.backend.json` e
apontá-lo como Custom Config File. A documentação oficial atual desautoriza
isso, e o fato é verificável:

> **Config as Code is deprecated.** Prefer Infrastructure as Code
> (`.railway/railway.ts`). Existing `railway.json` / `railway.toml` files
> continue to work for services that already use them until **2026-12-01**
> (hard cutoff). **New services cannot opt into Config as Code.**

O serviço de backend deste projeto **não** usa Config as Code hoje — não há
`railway.json` nem `railway.toml` no repositório, e a configuração vem do
painel. Adotá-lo agora seria uma adesão nova, que a plataforma diz não aceitar,
num mecanismo que deixa de ser lido em menos de três meses.

Versionar um arquivo que a plataforma vai parar de ler — ou que o serviço sequer
consegue adotar — e criar um gate que o certifica seria **teatro**: o gate
ficaria verde enquanto a barreira não existiria. Este repositório tem cinco
registros de armadilhas de scanner ingênuo justamente para não fazer isso.

A ativação usa o campo **Pre-deploy Command** do painel, que não está
depreciado e vale hoje. O caminho declarativo futuro é Infrastructure as Code
(`.railway/railway.ts`, campo `preDeploy`), que **não** foi autorado nesta
fatia por dois motivos: é project-level com semântica *omit = delete*, e
autorá-lo sem `railway config pull` contra o projeto vivo arriscaria apagar
variáveis, domínio e configuração do proprietário — que ainda tem um patch em
*staged* no serviço.

### O que o repositório pode e não pode garantir

O repositório garante que **o comando existe, é seguro e é o mesmo que a CI
exercita**. Ele não pode garantir que a plataforma foi configurada para
chamá-lo: isso é estado externo.

Por isso o blocker é dividido:

| | Escopo | Fecha quando |
|---|---|---|
| **DEPLOY-MIGRATION-01A** | barreira no repositório | runner, gate, provas e CI verdes |
| **DEPLOY-MIGRATION-01B** | ativação no Railway | o proprietário configurar a variável e o pre-deploy, e um deploy demonstrar a execução |

Nenhum relatório pode declarar `DEPLOY-MIGRATION-01` fechado enquanto **01B**
estiver pendente.

### Gate

`gate:deploy-migrations`, absoluto, na **posição 15** do `verify:all` (que passa
de 20 para 21 etapas) — depois dos gates de schema, antes de qualquer coisa que
suba banco. **Seis códigos, 22 provas de gate** e 13 provas do runner, quase
todas negativas. Ver `docs/engineering/GATE-REGISTRY.md`.

---

## D-PROD-29 — A conexão de migration é referência, e mudança de deploy só vale no deployment seguinte

**Missão:** `DEPLOY-MIGRATION-01B`.
**Relatório:** `docs/engineering/DEPLOY-MIGRATION-01B-BARRIER-ACTIVATION-REPORT.md`.

A D-PROD-28 decidiu **o que** a barreira faz. Esta decide **como** ela vive em
produção, e registra um comportamento de plataforma que já custou uma conclusão
errada.

### `MIGRATION_DATABASE_URL` é uma referência, não uma cópia

No serviço de backend, o valor gravado é a referência do Railway
`${{ DATABASE_URL }}` — não uma connection string digitada.

Motivo: senha duplicada em três variáveis é senha rotacionada em três lugares,
com uma janela em que discordam. Com a referência, `DATABASE_URL` é a única
fonte e a rotação é um campo só. E ninguém precisou ler o segredo para
configurar.

Isso **não** é o fallback proibido pela D-PROD-28. O runner continua sem
fallback: variável ausente é `DEPLOY-MIGRATION-URL-REQUIRED`, falha dura. O que
existe é uma decisão explícita de operador — hoje as duas conexões são a mesma,
porque a aplicação também fala pelo *session pooler* na 5432.

A decisão tem condição de término, e ela é verificável: se a aplicação migrar
para o pooler de transação (6543), a referência **deve** ser desfeita. Se
alguém esquecer, o runner recusa a 6543 (`DEPLOY-MIGRATION-UNSAFE-POOLER`) e o
deploy falha — o esquecimento vira erro visível, não corrupção silenciosa.

### Mudança de configuração de deploy só existe no deployment seguinte da fonte

`redeploy` re-executa um deployment que já existe, com a especificação **dele**.
Pre-deploy configurado depois daquele deployment não entra ali.

Isso foi estabelecido por prova, não por leitura: com o pre-deploy já gravado,
`MIGRATION_DATABASE_URL` foi apontada para uma fixture inválida (porta 6543,
credenciais falsas) e um `redeploy` foi disparado. A barreira, se ativa, teria
de reprovar. O deployment terminou `SUCCESS` — logo, o pre-deploy não rodou.

Regra que fica:

> Configuração de deploy alterada só passa a valer no próximo deployment
> **originado da fonte**. Um `redeploy` não confirma ativação — e um deployment
> verde depois de mudar configuração não é evidência de que a mudança rodou.

Corolário para o método: ausência de log nunca fecha uma verificação. Quando o
sinal esperado não aparece, monta-se o controle negativo que **tem de** falhar.
Foi assim que o repositório evitou registrar uma barreira ativa que não estava.

<!-- Próxima decisão: D-PROD-30 -->
