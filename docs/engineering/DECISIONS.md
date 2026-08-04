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

<!-- Próxima decisão: D-PROD-20 -->
