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

<!-- Próxima decisão: D-PROD-10 -->
