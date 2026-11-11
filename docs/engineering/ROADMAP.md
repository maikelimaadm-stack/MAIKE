# Roadmap — MAIKE Pecuária (Mapa Geral + Manejo)

**Status:** Oficial · **Versão:** 2.0.0 · **Substitui:** `docs/archive/ROADMAP-SAAS-2026-06.md`

O produto é um sistema nativo de **Pecuária — Mapa Geral + Manejo** (D-PROD-01).
Este roadmap descreve **reconstrução direta**, não migração conservadora: não há
shim de compatibilidade, não há preservação de módulos fora do escopo.

O PROJETOMG é molde de **disciplina e arquitetura** (D-PROD-03): API → service →
repository → Prisma, migrations versionadas, tenancy desde o primeiro model, erros
padronizados, gates obrigatórios, uma missão por PR. **Não** é fonte para copiar
Studio, MDP/MMM, marketplace, runtime universal ou plataforma low-code.

---

## P0 — Product Scope Reset

Reduzir o repositório à cadeia funcional do Mapa Geral + Manejo. Excluir páginas,
componentes, schemas e functions fora do produto. Corrigir a governança para
caminhos executáveis. Instalar os gates de escopo.

**Estado:** P0.1 **mergeada** (PR #1) — relatórios `P0.1-MAPA-MANEJO-SCOPE-RESET`,
`P0.1-R1-CORRECTIVE-HARDENING`, `P0.1-R2-FINAL-CONTRACT-CLOSURE`,
`P0.1-R3-TYPE-RATCHET-NON-REGRESSION` e `P0.1-R4-SSOT-FINAL-SYNCHRONIZATION`.

---

## P1 — Native Foundation Bootstrap

Preparar o repositório para código nativo: estrutura de pastas própria, contratos
de UI em `src/apis/`, padrão de erro único, camada de configuração por ambiente,
testes automatizados mínimos. Nenhum componente ainda acessa provider de dados
direto.

**Critério de aceite:** nenhuma tela do escopo importa `base44` diretamente;
toda leitura/escrita passa por `src/apis/`.

**Estado:** **concluída** — a PR #6 foi mergeada na `main` pelo proprietário
(merge `7398d85`), fechando P1.4 e P1.4-R1. Os seis eixos de
`gate:api-boundary` estão em zero e o baseline versionado tem as seis listas
vazias.

A P1 é executada em slices, uma PR por slice. Cada uma **remove** caminhos do
baseline de `gate:api-boundary`; nenhuma adiciona (SCL-P11-01).

| Slice | Escopo | Estado |
|---|---|---|
| **P1.1** | fundação (`src/apis/`, `ApiError`, `runtimeConfig`, provider interno) + piloto **Empresa** | entregue |
| **P1.2** | Mapa — `MapaGeral`, `MapaCadastro`, `DetalhesLote`, componentes de `src/components/mapa/`, cache offline e `useSetorAreas` | mergeada (PR #3); corrigida por P1.2-R1 e P1.2-R2 |
| **P1.3** | Manejo — `CadastroLotes`, `CadastroSetores`, `Categorias`, `CategoriasManejo`, `Bebedouros`, componentes de lotes e bebedouros, anexos; remoção dos repositórios legados | **mergeada** (PR #5) |
| **P1.4** | Suporte e Administração + fechamento da P1 — casca, autenticação, configurações, produtos, marcas, unidades, locais de estoque, tarefas, usuários e suplementação; remoção dos três monkey patches globais; DBT-10, DBT-17, DBT-18 e DBT-25 | **mergeada** (PR #6, merge `7398d85`) |
| **P1.4-R1** | correção de contrato sobre a P1.4, sem migrar caminho: classificação de erro de sessão só na fronteira (`{ok, value}` / `{ok, reason}`), `Button` tipado de verdade em vez de `any`, rastro fiel do rename parcial, remoção do código de erro órfão | **mergeada** na mesma PR #6 |

A P1 só seria declarada concluída na P1.4, quando o baseline de fronteira
chegasse a zero caminho legado nas telas do escopo. Isso aconteceu, e o merge da
PR #6 formalizou: **a P1 está concluída**.

Zerar os eixos não fechou sozinho a fronteira: a P1.4-R1 mostrou que o formato de
erro do provider ainda atravessava três camadas com a contagem já em zero. Daí a
regra que fica para as próximas slices — **eixo zerado é condição necessária, não
suficiente**; o que prova a fronteira é o contrato que sai dela.

---

## P2 — ModeloBase1 Pecuário Foundation

**Contrato base de persistência e domínio — não é motor visual** (D-PROD-21).

Definir identidade, tenancy, timestamps, auditoria, numeração, anexos, exclusão,
concorrência, vocabulário de erro e padrões proibidos para os futuros models
Prisma, no padrão validado no PROJETOMG e restrito ao escopo do produto.

O nome vem do PROJETOMG, o significado não: lá `ModeloBase1` é o motor visual de
cadastro; aqui é contrato de dados. Nada em `src/` muda por causa dele, e ele não
cria runtime genérico, low-code nem template de tela.

**Entregas:** `config/modelobase1-pecuario.json` (SSOT executável),
`docs/architecture/MODELOBASE1-PECUARIO-CONTRACT.md` (leitura humana),
`gate:modelobase1-pecuario` (verificação absoluta, sem baseline) e os testes
MB1-01 a MB1-20.

**Critério de aceite:** modelo base documentado e aprovado — isto é, **mergeado**
— antes de qualquer migration de domínio.

**Estado:** **concluída e mergeada** — PR #7, merge `1851503`, 2026-08-28.
Inclui a correção **P2-R1**, que fechou três invariantes que o contrato
declarava e o gate ainda não protegia. O contrato é oficial e vigente.

---

## P3 — Backend + Prisma + PostgreSQL Foundation

Criar `backend/` com Fastify, Prisma e PostgreSQL. Schema apenas com a camada de
tenant. `cliente_id` em todo model desde o primeiro dia. Migrations versionadas.

**Critério de aceite:** `prisma validate` passa; health check responde;
autenticação própria emite sessão válida; zero import de `@base44/sdk` no backend;
`gate:tenancy` e `gate:indices` criados e verdes; tudo conforme
`config/modelobase1-pecuario.json`.

**Estado:** **concluída e mergeada — PR #10, merge `4ce4608`**, sobre a
implementação certificada em `5bcee77`. Entregou `backend/` com Fastify, Prisma e
PostgreSQL; os cinco models da fundação; migration versionada; Docker Compose
local e PostgreSQL efêmero na CI; `auth_context` com sessão própria; e os gates
`gate:tenancy` e `gate:indices`, absolutos e com prova negativa por invariante.

Inclui a correção **P3-R1**, que fechou cinco bloqueios de auditoria dentro da
mesma PR: identidade em runtime contornando o `@default(cuid())`, relação
`AuditLog → Usuario` sem coerência de tenant, regressão de bundle causada por
`NODE_ENV` no workflow, `backend/` sem cobertura de tipos e `prisma validate`
que não rodava na cadeia. Ver §16 do relatório da P3.

A precondição de governança `P3-G0.2` foi resolvida antes da implementação: a
colisão entre a Constituição e o contrato sobre `Cliente` sem `cliente_id` virou
a emenda **D-PROD-22**, mergeada na PR #9.

Implementa **somente** a camada de tenant/fundação: nenhum model de mapa e
nenhum model de manejo, que ficam para P4–P6, uma capacidade de cada vez.

---

## P4 — Mapa Core Native Persistence

**Estado:** **concluída** — P4.0–P4.3 mergeadas; mapa core persiste no PostgreSQL.

| Fatia | Nome | Estado |
|---|---|---|
| **P4.0** | Native Transport + Session Activation | **concluída e mergeada** — PR #12, merge `45599f5` (inclui a **P4.0-R1**); corrigida pela **P4.0-R2** — PR #15, merge `b2535ec` |
| **P4.1** | Setor Native Persistence | **concluída e mergeada** — PR #14, merge `b559c48` (inclui a **P4.1-R1**); fechada pela **P4.1-R2** — PR #17, merge `588792b` |
| P4.2 | AreaPastagem Native Persistence | **concluída e mergeada** — PR #26, merge `87a2d2d4`; `gate:area-pastagem-native` (D-PROD-31) |
| P4.3 | PontoReferencia + LinhaGeografica + ConfiguracaoIcone | **concluída** — `gate:map-geography-native` (D-PROD-32) |

A ordem é estrutural, não preferência. A P3 entregou um backend que sabe
autenticar e o frontend continuou autenticando na Base44 — sem URL configurada,
sem cliente HTTP, sem sessão própria. Criar model de domínio antes disso
produziria persistência que ninguém consegue consumir. E `AreaPastagem` depende
de `Setor`, o que fixa o resto da ordem.

A **P4.0** entregou: `VITE_MAIKE_API_URL`, cliente HTTP nativo único, sessão JWT
em `sessionStorage`, login nativo sem dual-auth, CORS com allowlist exata,
bootstrap local do primeiro usuário e o gate absoluto `gate:native-api`.
Fechou também a dívida da P3 (D-PROD-23, item 7): os oito códigos de erro do
contrato entraram em `src/apis/_core/ApiError.js`. **Nenhum model de domínio** —
o schema Prisma está inalterado. Ver D-PROD-24.

A **P4.0-R1** corrigiu, dentro da mesma PR, um bloqueador achado em auditoria
externa: a restauração da sessão apagava o JWT para qualquer erro, confundindo
backend fora do ar com credencial recusada. Ver D-PROD-24 §G.1.

A **P4.0-R2** corrigiu, em PR própria depois do merge, um defeito que chegou ao
usuário: `VITE_MAIKE_API_URL` sem esquema não falhava — virava URL relativa, e o
`POST /auth/login` saía com a senha para a origem do frontend. É fatia corretiva
da P4.0 porque o defeito está no transporte que ela entregou; `P4.2` segue
reservada para `AreaPastagem`. Ver D-PROD-26.

A **P4.1** entregou a primeira capacidade de domínio nativa: model Prisma
`Setor` tenant-scoped, migration versionada, rotas `GET`/`POST`/`PATCH`
autenticadas, numeração por `EntidadeCodigoSequencia` no escopo `tenant`, porta
única no frontend usada pelo cadastro **e** pelo mapa, e o gate absoluto
`gate:setor-native`. Com ela morre o `MAX+1` de `numero_setor` (DBT-26), que só
agora tinha onde ser resolvido de verdade — com a sequência atômica da P3 e o
caminho autenticado da P4.0.

A exclusão de setor ficou **fechada** nesta fatia, por decisão: não existe
`DELETE /setores/:id` enquanto `AreaPastagem`, `LancamentoTarefa`,
`MovimentacaoMapa` e `MovimentacaoPecuaria` — os dependentes que a guarda de
vínculo consulta — não forem nativos. **A P4.2 migrou o primeiro dos quatro e
não reabriu a exclusão**: os outros três seguem na Base44, e reabrir com um
quarto do vínculo verificável seria pior que manter fechado. Ver D-PROD-25 §D e
§N.

A **P4.2** migrou `AreaPastagem`, o próximo nó da árvore de dependências do mapa
e o primeiro com FK composta tenant-aware para `Setor` — a relação que o
`@@unique([cliente_id, id])` da P4.1 existia para tornar possível sem retrofit.
Trouxe também três coisas que não eram óbvias: `setor_nome` deixou de ser
enviado pelo cliente e passou a ser derivado do setor lido na mesma transação;
renomear um setor passou a reescrever o `setor_nome` das áreas nativamente,
fechando um dos seis destinos de `syncEntityReferences`; e os **dois** leitores
de área no frontend (mapa e suplementação) passaram a ter dono único em
`@/apis/areas`. Ver D-PROD-30.

**Critério de aceite:** `MapaGeral` e `MapaCadastro` operam contra o backend
próprio — **atendido** (P4.3 + extensões P5.x no mapa).

---

## P5 — Manejo Core Native Persistence

**Estado:** **concluída** — fatias P5.1–P5.5 entregues (lotes, movimentações,
bebedouros, manejo técnico/sanitário nativos). Relatórios em `docs/engineering/P5*.md`
e fechamento **P5.5** (`P5.5-FINAL-BASE44-EXIT-REPORT.md`).

Migrar o manejo iniciado no mapa: `Lote`, `CategoriaManejo`, movimentação,
nascimento, morte, abate, mudança de categoria, pesagem do lote, junção,
renomeação, histórico, validação temporal, `ManejoTecnicoRebanho`,
`EventoSanitario`, `AplicacaoMedicamento`.

**Critério de aceite:** `DetalhesLote` opera contra o backend próprio, com regra
de negócio no service e não no componente.

---

## P6 — Supporting Capabilities

**Estado:** **majoritariamente entregue** — cadastros de suporte, tarefas, empresa,
usuários/permissoes e anexos de upload nativos; **entrada de estoque** (DBT-04) permanece.

Migrar o suporte: suplementação (`SuplementacaoEvento`, `SuplementacaoLote`),
estoque do mapa (`EstoqueLoteNota`, `MovimentacaoEstoque`, `LocalEstoque`),
produtos e unidades, bebedouros e seus históricos, tarefas do mapa
(`LancamentoTarefa`, `TipoTarefa`, `GrupoAtividade`), anexos, empresa,
usuários e permissões.

Inclui reconstruir a **entrada de estoque** do produto, removida em P0.1 junto
com o módulo de movimentações de estoque legado.

---

## P7 — Base44 Final Removal

**Estado:** **parcial — mergeada PR #85 (2026-10-27)** — limpeza de runtime e
comentários (D-PROD-52, `P7-BASE44-LEGACY-CLEANUP-REPORT.md`): sem `@base44/sdk` em
`src/`, sem `VITE_BASE44_*`, baseline `gate:base44` com eixos de código zerados.
Schemas `base44/entities/*.jsonc` permanecem como especificação legada no manifesto;
remoção física e `gate:no-base44` absoluto ficam para decisão de produto pós-P8.

Remover `@base44/sdk` e `@base44/vite-plugin` do `package.json`, remover o plugin
do `vite.config.js`, arquivar `base44/` como referência histórica e substituir
`gate:base44` por `gate:no-base44` (zero referências).

**Critério de aceite:** `gate:no-base44` passa com contagem zero — **pendente**
(arquivo de schemas ainda versionado).

---

## P8 — Hardening and Release

**Estado:** **próxima missão autorizável** pós-P7.

RLS no PostgreSQL, autorização real, rate limiting, observabilidade, backup com
teste de restore, performance do mapa em campo, release.

Checklist operacional (stub): [`P8-HARDENING-CHECKLIST.md`](./P8-HARDENING-CHECKLIST.md).

---

## Track paralelo — UX Base1 / paridade Portal Compras

Execução incremental da paridade visual Agro ERP (MODELO BASE1) nos cadastros do
manifesto — piloto **Marcas**, motor em `src/components/cadastro/base1/`. Plano
operacional: [`docs/engineering/PLAN-EXECUCAO-PARIDADE-BASE1.md`](./PLAN-EXECUCAO-PARIDADE-BASE1.md)
(checklist §11 em [`PROMPT-MODELO-VISUAL-AGRO-ERP.md`](./PROMPT-MODELO-VISUAL-AGRO-ERP.md);
PR #51 / branch `cursor/ux-base1-cards-colunas-878d`). Não substitui missões P4–P8;
anexos nativos permanecem em P8.

## Track autorizado — Gestão Rural P1 (D-PROD-146)

Cadastros antes de lançar: **Parceiros** (sobre o model `Fornecedor`, papéis
múltiplos), **Centros de Custo**, **Centros de Resultado** e o vínculo N:N
opcional entre os centros. **Fora**: naturezas financeiras, lançamentos, compras,
NF-e/XML, contas a pagar, movimento financeiro e qualquer efeito em estoque ou
mapa. Relatório: [`MAIKE-GESTAO-CADASTROS-P1-REPORT.md`](./MAIKE-GESTAO-CADASTROS-P1-REPORT.md).
Próximos passos (cada um com decisão própria): operações que **referenciam** os
ids estáveis destes cadastros (ver contrato no relatório §6).

## Track autorizado — Gestão Rural P2: Naturezas Financeiras gerenciais (D-PROD-153)

Cadastro de **naturezas de receita/despesa** com hierarquia (pai do mesmo tipo,
mesma empresa), para classificar FUTURAS operações pelo tipo econômico. Uma
entidade canônica (`NaturezaFinanceira`); **não** é plano de contas contábil e
**não** tem vínculo estático com Parceiro ou Centros (a combinação será da
operação). **Fora**: lançamentos, valores, saldos, caixa/bancos, tributos,
compras, NF-e/XML, contas a pagar/receber, estoque e mapa. Relatório:
[`MAIKE-GESTAO-CADASTROS-P2-NATUREZAS-REPORT.md`](./MAIKE-GESTAO-CADASTROS-P2-NATUREZAS-REPORT.md).

## Track autorizado — Gestão Rural P3-01: Central Única de Lançamentos (D-PROD-155)

Uma tela (`LancamentosFinanceiros`) e um documento (`OperacaoFinanceira`) para
compras, vendas, despesas e receitas **gerenciais**: PAGAR/RECEBER, com ou sem
produtos, à vista, a prazo ou parcelado. Tem rateio **global** por natureza e
centros, títulos (uma linha por parcela), liquidação **manual** com estorno e perfil
financeiro da empresa (país, moeda, locale). O lançamento só mexe no estoque (KG,
FIFO) ao ser confirmado, e o estorna ao ser cancelado, por um comando composto.
É a primeira entrada de estoque nativa (DBT-04), sem tela avulsa de entrada.
O custo do lote é o custo de aquisição **líquido** (desconto e acréscimo do
cabeçalho rateados entre as linhas; resíduo de arredondamento explícito, rodada 4).
Migration expand-only com 8 tabelas novas.

**Estado:** em produção. A migration foi aplicada e conferida em 2026-11-09 às
14:08:36 UTC, e o proprietário fez o merge da PR #230 (`f2b81e1b`). Runbook
executado:
[`MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md).
Relatório:
[`MAIKE-GESTAO-P3-01-LANCAMENTO-UNICO-REPORT.md`](./MAIKE-GESTAO-P3-01-LANCAMENTO-UNICO-REPORT.md).

**Próximos passos:**
- o custo líquido do lote entrou na rodada 4;
- o rateio por item é a P3-02 (D-PROD-156), e editar, excluir e duplicar são a P3-03 (D-PROD-158), descritas abaixo;
- o pedido de compra continua fora desta fase e só entra com decisão própria do
  proprietário.

## Track autorizado — Gestão Rural P3-02: rateio gerencial por item (D-PROD-156)

É feito na mesma tela `LancamentosFinanceiros` e só vale com produtos. O escopo
do rateio pode ser **Geral** (o padrão, comportamento da P3-01) ou **Por item**.
No modo Por item, cada item (mercadoria ou serviço) tem a sua própria divisão
entre naturezas e centros, por valor ou percentual. A base é o valor líquido do
item, e a soma é exata por item e no total. Os dois modos nunca convivem no mesmo
documento. Detalhe e prévia mostram o resumo consolidado. Não há efeito novo em
títulos, estoque ou custo.

Banco: uma migration expand-only, com uma coluna anulável `rateio_escopo` e a
tabela nova `OperacaoFinanceiraItemRateio`.

**Estado:** em produção. A migration foi aplicada e conferida em 2026-11-09 às
17:42:13 UTC, e o proprietário fez o merge da PR #231 (`e4e907ea`). Runbook
executado:
[`MAIKE-GESTAO-P3-02-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-02-RUNBOOK-RELEASE.md).
Relatório:
[`MAIKE-GESTAO-P3-02-RATEIO-POR-ITEM-REPORT.md`](./MAIKE-GESTAO-P3-02-RATEIO-POR-ITEM-REPORT.md).

## Track autorizado — Gestão Rural P3-03: editar, excluir e duplicar lançamentos (D-PROD-158)

Na mesma tela `LancamentosFinanceiros`:
- **Editar** um documento confirmado é uma retificação. Se a assinatura física das
  mercadorias não muda, ela é feita no lugar (`versao+1`). Se muda, o documento
  antigo é estornado e um novo, com o mesmo número, é confirmado na mesma transação;
- **Excluir** um confirmado é lógico: estorno, `excluido_em` e evento com motivo;
- **Duplicar** cria um rascunho novo a partir de qualquer documento.

Retificar e excluir ficam bloqueados por liquidação, consumo de lote ou movimento
posterior. O histórico fica em `OperacaoFinanceiraEvento` e no AuditLog.

Banco: uma migration expand-only, com duas colunas anuláveis e a tabela nova
`OperacaoFinanceiraEvento`.

**Estado:** a migration foi aplicada e conferida em produção em 2026-11-09 às
21:32:01 UTC, pelo runbook
[`MAIKE-GESTAO-P3-03-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-03-RUNBOOK-RELEASE.md).
A PR #234 foi mergeada pelo proprietário (`a2347741`; registrado pela P1-02). Relatório:
[`MAIKE-GESTAO-P3-03-EDITAR-EXCLUIR-DUPLICAR-REPORT.md`](./MAIKE-GESTAO-P3-03-EDITAR-EXCLUIR-DUPLICAR-REPORT.md).

**Fora desta fase** (cada item só com decisão própria do proprietário): pedido
de compra e rateio fiscal. **Fora do produto** (não voltam sem emenda de
escopo): conciliação bancária, bancos/contas bancárias/OFX, módulo de
caixa/bancos, DRE, plano de contas, fiscal/tributos/NF-e, câmbio, contabilidade e
relatórios/dashboards financeiros.

---

## Track autorizado — Patrimônio P1-01: cadastros patrimoniais e frota (D-PROD-157)

Grupo de menu próprio **Patrimônio e Frota** com cinco telas nativas no Motor Base1:
`BensPatrimoniais`, `FamiliasPatrimoniais`, `TiposPatrimoniais`, `PerfisMedicao` e
`Combustiveis`. Catálogos do tenant (famílias com natureza fechada, tipos com
perfis de medição sugeridos, perfis com conversão só dentro da dimensão,
combustíveis classificatórios) e um catálogo padrão instalável pelo administrador.
O bem tem código patrimonial estável, código de frota único por fazenda (ex.:
TP-02), medições físicas (benfeitorias), medidor de uso que não regride (horímetro,
odômetro, ciclos ou sem medidor), tanques com os combustíveis que aceitam (flex sem
tanque falso) e parâmetros de aquisição e depreciação linear com **prévia só
simulada**. Na R2, cada fazenda liga os seus Produtos aos tipos de combustível
(vínculo por empresa, sem efeito em estoque, custo ou unidade) e a P1-02 ganha um
contrato só de leitura dos produtos elegíveis de cada bem. Migration expand-only
com 10 tabelas novas.

**Estado:** PR #232 mergeada (`76edc913`) e migration aplicada em produção em
2026-11-09 às 23:04:22 UTC (registrado pela P1-02; houve incidente de sequência:
o merge veio antes da migration, ver D-PROD-157). Relatório:
[`MAIKE-PATRIMONIO-P1-01-REPORT.md`](./MAIKE-PATRIMONIO-P1-01-REPORT.md).

**Próximos passos (cada um com decisão própria):** P1-02 Abastecimentos/Consumo
(D-PROD-159, abaixo), depois manutenção, apuração mensal de depreciação por
competência e transferência entre fazendas. As telas de famílias, tipos, perfis e
combustíveis e o vínculo combustível × produto são **superados pela D-PROD-162**
(SIMPLIFICA-01, abaixo).

## Track autorizado — Patrimônio P1-02: abastecimentos e consumo de combustível (D-PROD-159)

Página nativa **Abastecimentos** (`pat-abastecimentos`) no grupo Patrimônio e Frota.
O responsável configura o **fator kg/L** de cada produto de combustível da fazenda
(informado, validado e versionado; nunca 1 L = 1 KG nem densidade presumida). O
abastecimento de um bem (tanque, combustível aceito, produto vinculado da mesma
fazenda, local de estoque, litros, leitura do medidor e tanque cheio) passa por uma
**prévia sem escrita** e por uma **confirmação transacional** que converte litros em KG
uma vez (`ROUND_HALF_UP`, 4 casas) e baixa o estoque **de verdade** pelo motor
existente (FIFO por lote, custo FIFO final), sem lançamento financeiro. Idempotência
por `operation_id`, cancelamento com estorno exato das fatias, histórico paginado,
leitura do medidor guardada no próprio abastecimento (série monotônica, sem gravar o
bem) e consumo km/L ou L/h pelo método do tanque cheio declarado. Permissões novas,
negadas por padrão. Migration expand-only com 3 tabelas novas.

**Estado:** migration aplicada em produção em 2026-11-10 às 13:18:33 UTC, com GO
expresso, pelo runbook
[`MAIKE-PATRIMONIO-P1-02-RUNBOOK-RELEASE.md`](./MAIKE-PATRIMONIO-P1-02-RUNBOOK-RELEASE.md);
depois dela, a PR #235 foi mergeada pelo proprietário (`e3ea4c39`; registrado pela
UX-02). Relatório:
[`MAIKE-PATRIMONIO-P1-02-ABASTECIMENTOS-REPORT.md`](./MAIKE-PATRIMONIO-P1-02-ABASTECIMENTOS-REPORT.md).

**Fora desta fase** (cada item só com decisão própria): manutenção, ordens de
serviço, peças, compras, custo/hora, apuração de depreciação, transferência entre
fazendas, saldo de tanque, GNV em tanque de litros, mapas e dashboards.

O fator kg/L, a conversão de litros em KG e o "Produto obrigatoriamente em KG" são
**superados pela D-PROD-162** (SIMPLIFICA-01, abaixo): o abastecimento passa a baixar a
quantidade na unidade do Produto (L ou KG).

## Track autorizado — Patrimônio UX-02: abastecimento orientado pelo Produto associado (D-PROD-160)

Correção de UX pedida pelo proprietário sobre a P1-02, sem schema. O cadastro de
**Combustíveis** passa a ser o lugar onde cada fazenda associa os seus Produtos ao
combustível (Associados, Inativos e Disponíveis, vários de uma vez, também ao criar
o combustível, com resultado explícito quando algum vínculo falha). No **Novo
abastecimento**, depois de escolher a máquina ou o veículo, o operador escolhe o
**Produto** pelo nome real; o tipo de combustível, o tanque (quando só há um), o
fator e o local (quando só um tem saldo) são resolvidos pelo servidor a partir dos
vínculos ativos. A troca do Produto associado vale para os próximos abastecimentos,
sem editar o bem e sem reescrever o histórico; o novo Produto precisa do seu próprio
fator kg/L. Backend: uma rota nova só de leitura
(`GET /patrimonio-abastecimentos-opcoes/produtos-do-bem`); nenhuma API mutativa muda.

**Estado:** PR [#237](https://github.com/maikelimaadm-stack/MAIKE/pull/237)
**mergeada** na `main` (`e39d318b`, 2026-11-10 19:51:48 UTC; registrado pela
SIMPLIFICA-01), sem migration. Relatório:
[`MAIKE-PATRIMONIO-UX-02-ABASTECIMENTO-PRODUTO-REPORT.md`](./MAIKE-PATRIMONIO-UX-02-ABASTECIMENTO-PRODUTO-REPORT.md).

**Limites registrados** (mudar exige decisão própria e schema): um Produto só pode
estar ativo num combustível por fazenda; o fator kg/L é por par combustível ×
Produto. **Superados pela D-PROD-162** (abaixo), que tira o combustível e o fator.

## Track autorizado — Estoque P0-01: motor físico único, ENTRADA ≠ MOVIMENTAÇÃO (D-PROD-161)

Consolida o estoque físico num **único motor** (`estoqueFisicoMotor.js`), sem tela
nova e **sem DDL**. ENTRADA (hoje só a compra confirmada da Central de Lançamentos)
é o único lugar onde nasce quantidade; MOVIMENTAÇÃO (venda, abastecimento,
suplementação e transferência entre locais) só baixa ou muda de lugar o que entrou.
Suplementação e transferência saem do segundo FIFO em `Number` (`fifoEstoque.js`,
apagado) e passam ao FIFO Decimal com CAS do motor; a transferência deixa de gravar o
lote de destino com ano 2001. O Cadastro de Produtos não lança estoque
(`estoque_atual` é cache derivado e somente leitura; CSV sem estoque; troca de empresa
e exclusão bloqueadas com estoque). As escritas genéricas de movimento e de lote
respondem 409 `ESTOQUE_ESCRITA_DIRETA_RECUSADA` (fica só a renomeação benigna do
local). Uma reconciliação **somente leitura** (`GET /estoque-fisico/reconciliacao`,
SO_ADMIN) classifica divergências sem corrigir nada. A reconciliação tem trabalho
limitado por chamada e cursor assinado por HMAC e amarrado ao tenant e ao escopo.
Ela só declara a conclusão global COMPROVADA num snapshot único; em várias chamadas
o resultado é INCONCLUSIVO, nunca OK.
No fechamento R2 também entraram:
- a correção das máscaras do Cadastro de Produtos (o valor exibido agora é o gravado);
- a folha "Local de Destino" do celular, que passou a abrir dentro do diálogo certo.

**Estado:** PR [#238](https://github.com/maikelimaadm-stack/MAIKE/pull/238)
**mergeada** na `main` (`e8472481`, 2026-11-11 00:27:25 UTC; registrado pela
SIMPLIFICA-01), sem migration (`SCHEMA_APPLIED_PROD = N/A`). Relatório:
[`MAIKE-ESTOQUE-P0-01-REPORT.md`](./MAIKE-ESTOQUE-P0-01-REPORT.md).

**Próximo (P1, só design nesta fase; cada item com decisão própria):** documento de
Entrada de Estoque manual (implantação de saldo, ajuste, doação, devolução) pelo
motor; lote de fabricante e validade; linhagem estruturada com FK e tabela de fatias;
estorno de suplementação e de transferência no motor; CHECKs/FKs de integridade e
saneamento auditado com GO (lotes de 2001, `Disponivel` com 0, recálculo de cache);
consulta/histórico por lote com contrato próprio. Bloqueios arquiteturais da
reconciliação, registrados na D-PROD-161:
- **R2-1:** partição de um produto gigantesco por local;
- **R2-2:** índice de expressão no AuditLog de lote excluído (DDL);
- **R2-3:** varredura global assíncrona com snapshot exportado, fora do HTTP.

## Track autorizado — Patrimônio SIMPLIFICA-01: o Patrimônio recomeça do zero, simplificado (D-PROD-162)

Decisão do proprietário de 2026-11-10. O grupo **Patrimônio e Frota** fica com duas
páginas: **Bens Patrimoniais** e **Abastecimentos**. Famílias e Tipos são escolhidos e
criados dentro do formulário do Bem ("+ Nova família", "+ Novo tipo") e mantidos em
"⋯ › Gerenciar famílias e tipos". Cada tanque do bem aceita **Produtos do estoque**
(em litros ou em quilos). O abastecimento escolhe a máquina e o Produto e baixa do
estoque **exatamente** a quantidade digitada, na unidade do Produto, sem conversão; a
capacidade do tanque só é conferida para Produto em litros. O Produto e a compra/venda
da Gestão P3 ganham a unidade **Litros (L)**, com KG e SACO byte a byte como antes. Saem
os perfis de medição, as medições de benfeitoria, o cadastro de Combustíveis, o vínculo
combustível × produto e o fator kg/L.

Uma migration **CONTRACT** única (exceção fechada à D-PROD-72 item 3 e à D-PROD-107 R7)
apaga as 13 tabelas do Patrimônio, com os dados de todos os clientes, alarga 2 CHECKs do
item da compra P3 para aceitar `'L'` e cria 7 tabelas no formato novo: 39 → 40 migrations,
85 → 79 tabelas. Ela recusa se houver abastecimento CONFIRMADO, se as contagens não forem
as do preflight ou se o papel não for o dono das tabelas.

Integra a D-PROD-161 (motor físico único, mergeada antes): o rótulo `L` do movimento
vem do Produto no motor único, que também grava a suplementação e a transferência.

**Estado:** em implementação, PR draft. Migration **não aplicada** em nenhum ambiente
remoto. Release pelo runbook
[`MAIKE-PATRIMONIO-SIMPLIFICA-01-RUNBOOK-RELEASE.md`](./MAIKE-PATRIMONIO-SIMPLIFICA-01-RUNBOOK-RELEASE.md):
migration antes do merge, merge imediato depois do postcheck rápido e janela curta de
500 no Patrimônio até o deploy READY. Relatório:
[`MAIKE-PATRIMONIO-SIMPLIFICA-01-REPORT.md`](./MAIKE-PATRIMONIO-SIMPLIFICA-01-REPORT.md).

**Fora desta fase** (cada item só com decisão própria): manutenção, ordens de serviço,
peças, compras do Patrimônio, custo/hora, apuração de depreciação, transferência entre
fazendas, saldo de tanque, abastecimento em unidade que não seja L nem KG (ex.: GNV em
m³), conversão entre unidades, mapas novos e dashboards.

## Fora do roadmap

Plataforma low-code, Studio, MDP/MMM, marketplace, runtime universal, motor de
intelligence genérico, ERP amplo. Ver `docs/constitution/07-DO-NOT-DO.md`.
