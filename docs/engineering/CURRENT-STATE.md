# Estado Atual

**Atualizado em:** 2026-11-19 (missão ativa D-PROD-259; blocos abaixo por data) · antes: 2026-10-27 (**pós-P7** + auditoria de gap — PR **#85** mergeada;
dados e SDK Base44 fora do runtime; Supabase `_prisma_migrations` **14/14** e **38**
tabelas de app alinhadas ao Prisma — ver
[`GAP-AUDIT-POS-BASE44-2026-10-27.md`](./GAP-AUDIT-POS-BASE44-2026-10-27.md) e
`POST-P7-PRODUCAO-REPORT-2026-10-27.md`; UX Base1 — gate §H **5/6** aguardando **H.5**;
rollout pausado **D-PROD-41**)

---

**Conserto (2026-11-19):** no celular as listas do "Definir setor" (ações em lote das áreas) e do `DialogoAcao` em janela Base1 (`DialogoAreaDaAtividade`) abrem a folha DENTRO da `B1Janela` (`MobileSheetPortalCtx`) — ver [`MAIKE-B1JANELA-FOLHA-CELULAR-REPORT.md`](./MAIKE-B1JANELA-FOLHA-CELULAR-REPORT.md).

## Missão ativa (2026-11-19) — MAIKE-ESTOQUE-NOVO-MOVIMENTO: "Novo movimento" em Movimentos, motivos de entrada por cadastro (D-PROD-259)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-259**, pedido do proprietário: escolher o tipo de movimento (Entrada ou Transferência) dentro de Movimentos; a aba Entradas sai |
| Branch / PR | `claude/new-session-26kpxu`, a partir da `main` `c2991afd` · PR draft |
| Escopo | Janela "Novo movimento" (Entrada com cabeçalho e várias linhas de produto; Transferência pelo comando existente); cadastro `MotivoEntradaEstoque` (Compra, Doação, Saldo de implantação + os do usuário, sem cor); fornecedor, centros de custo e de resultado, lote e validade na entrada |
| Migration | `20261119200000_estoque_entradas_motivos`, **CONTRACT**. **Aplicada em produção** em 2026-11-19 19:33:14 UTC pelo caminho B, com o GO do proprietário (70 concluídas, 101 tabelas). Até o merge, a entrada por doação/"outra causa" do código da `main` falha no CHECK novo |
| Constituição | emenda da D-PROD-259 (motivos por cadastro, Compra como motivo, sem justificativa obrigatória) **aprovada pelo proprietário em 2026-11-19**; parágrafo em `00` §1 e nota em `07` |
| Abertos | consulta recíproca na Central (R-DEDUPE), edição física por revisão, saída manual, ajuste de inventário, cor por tipo |
| Relatório | [`MAIKE-ESTOQUE-NOVO-MOVIMENTO-REPORT.md`](./MAIKE-ESTOQUE-NOVO-MOVIMENTO-REPORT.md) · runbook [`MAIKE-ESTOQUE-NOVO-MOVIMENTO-RUNBOOK-RELEASE.md`](./MAIKE-ESTOQUE-NOVO-MOVIMENTO-RUNBOOK-RELEASE.md) |

## Missão anterior (2026-11-19) — MAIKE-ESTOQUE-ENTRADAS: aba Entradas do Estoque (D-PROD-257, PR 2 de 2)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-257**: aba **Entradas** (entrada manual documentada e saldo de implantação) na tela Estoque; o inventário inicial é o motivo `SALDO_IMPLANTACAO`, não uma aba |
| Branch / PR | `cursor/estoque-entradas` · mergeada na `main` (PRs #335, #337, #340) |
| Escopo | `backend/src/modules/estoqueEntradas/` (rotas, serviço, regras), dois invólucros no motor (`aplicarEntradaDocumentada`, `estornarEntradaDocumentada`), reconciliação (origem e FK do estorno), permissão extra `entrada` da tela `sup-estoque`, aba/lista/formulário/detalhe no front |
| Migration | `20261119100000_estoque_entradas`, **EXPAND** (3 tabelas novas). **Aplicada em produção** em 2026-11-19 17:54:41 UTC pelo caminho B, com o GO do proprietário (69 concluídas; ver [`MAIKE-ESTOQUE-NOVO-MOVIMENTO-REPORT.md`](./MAIKE-ESTOQUE-NOVO-MOVIMENTO-REPORT.md) §1) |
| Constituição | a emenda do custo médio (D-PROD-256) **continua pendente de ratificação** no merge da #337; esta PR não a aprova |
| Abertos | consulta recíproca da P3 (compra → entrada; bloqueio de liberação do contrato), edição física por revisão (P1-05b), janela FIFO/R-DATA, inventário periódico e `ajuste` |
| Relatório | [`MAIKE-ESTOQUE-ENTRADAS-REPORT.md`](./MAIKE-ESTOQUE-ENTRADAS-REPORT.md) |

## Missão anterior (2026-11-19) — MAIKE-ESTOQUE-CUSTO-MEDIO: custo médio ponderado no motor único (D-PROD-256, PR 1 de 2)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-256**, pedido do proprietário: custo médio e aba Entradas, em PRs empilhadas, custo médio primeiro; Entradas é a **D-PROD-257** (PR 2) |
| Branch / PR | `cursor/estoque-custo-medio`, a partir da `main` `75464e88` (PR #335) · sem push nem PR ainda |
| Escopo | `estoqueFisicoMotor.js`: `consumirCustoMedio` e `aplicarSaida` (no lugar de `consumirFifo`/`aplicarSaidaFifo`), reavaliação do poço produto × depósito, estorno exato, transferência com valor conservado; chamadores renomeados (abastecimento, atividade, cocho, venda, transferência) |
| Cutover | daqui para a frente; histórico, fatias e consumos **não** são reescritos; saída FIFO antiga estornada devolve o valor FIFO gravado |
| Migration | **nenhuma** (só código, sem DDL). Nada roda no banco no merge |
| Constituição | emenda **proposta** em `00-CONSTITUICAO.md` §1 e `07-DO-NOT-DO.md`; **só vale com a aprovação do proprietário no merge manual** |
| Fica para a PR 2 | aba Entradas, `EntradaEstoque*`, motivos (D-PROD-177), permissão `entrada`/`ajuste`, migration, reconciliação |
| Relatório | [`MAIKE-ESTOQUE-CUSTO-MEDIO-REPORT.md`](./MAIKE-ESTOQUE-CUSTO-MEDIO-REPORT.md) |

## Missão anterior (2026-11-19) — MAIKE-ATIVIDADES-FASE1: tipos fixos + formulário único, só serviços de pasto (D-PROD-258)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-258**, pedido do proprietário: aprovou a fase 1 da análise de Atividades, com escopo só de pastos |
| Branch / PR | `feat/atividades-tipos-fixos` · PR **#338**, mergeada na `main` `bab0f38a` |
| Escopo | 7 tipos fixos obrigatórios na categoria; cadastro de operação com tipo + nome + ativo; "Registrar serviço" em dois passos (tipo, depois operação) com as quatro seções sempre visíveis; Manejos do mapa abre o mesmo formulário com a área preenchida; Grupo e as 8 chaves fora das telas de atividade |
| Backend | `categoria` obrigatória (7 valores) em `POST/PATCH /tipos-atividade`; grupo `GERAL` e chaves em padrão na criação. **Nenhuma migration** |
| Dados | `scripts/ops/tipos-fixos-atividade-dados.mjs`: dry-run por padrão, **não executado** em dados reais; precisa da conferência do proprietário |
| Relatório | [`MAIKE-ATIVIDADES-TIPOS-FIXOS-REPORT.md`](./MAIKE-ATIVIDADES-TIPOS-FIXOS-REPORT.md) |

## Missão anterior (2026-11-19) — MAIKE-ESTOQUE-E1-E2: tela Estoque com Saldo e Movimentos, só consulta (D-PROD-255)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-255**, pedido do proprietário: um item "Estoque" com abas; implementadas só **Saldo** e **Movimentos** (Entradas e Inventário não aparecem) |
| Branch / PR | `cursor/estoque-saldo-movimentos`, a partir da `main` `9d791735` · sem push nem PR ainda |
| Escopo | Página `Estoque` (Suporte do Mapa → Estoque, `/estoque`), na cadeia Base1; Saldo produto × depósito (das camadas), Movimentos (kardex) com filtros, janela de detalhe somente leitura; clicar no Saldo leva aos Movimentos do produto e depósito |
| Backend | `GET /estoque/saldo`, `/estoque/movimentos` (P1-04, keyset + cursor assinado), `/estoque/movimentos/:id`, `/estoque/opcoes/produtos` e `/locais`; guarda da tela nova `sup-estoque` (`visualizar`). **Nenhuma migration**, motor intocado, guardas existentes mantidas |
| Fica para depois | Entradas (saldo inicial, doação, outra causa), Inventário (saldo inicial + contagem periódica com ajuste e motivo), saída manual com motivos fixos, **custo médio** (feito na D-PROD-256; antes FIFO por camada), permissão extra `entrada`/`ajuste` |
| Relatório | [`MAIKE-ESTOQUE-E1-E2-REPORT.md`](./MAIKE-ESTOQUE-E1-E2-REPORT.md) |

## Missão anterior (2026-11-18) — MAIKE-DETALHES-AREA: Detalhes da área como o do lote e "Registrar serviço" nas Atividades (D-PROD-254)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-254** (a 253 é da PR #275), pedido do proprietário: maquetes `area-*` aprovadas + separar planejar de registrar nas Atividades |
| Branch / PR | `cursor/detalhes-area`, a partir da `main` `633f75f0` (PR #331) · sem push nem PR ainda |
| Escopo | `DetalhesArea` com abas Detalhes · Histórico (registros de campo), rodapé Manejos + Histórico completo, Manejos com os tipos do cadastro, registro de campo compartilhado (`JanelaRegistroDeCampo`); botão "Registrar serviço" ao lado de "Nova atividade" |
| Backend | `POST /atividades/registrar` (transacional: acha ou abre a atividade do mês, grava o registro; recusa o tipo Abastecimento com 422), `GET /atividades-por-area/:areaId/resumo` e `/registros`. Nenhuma migration |
| Emenda 1 | Abastecimento é da **máquina**: fora dos Manejos e do "Registrar serviço"; entra por "Salvar e abastecer" na janela da máquina e pelo "Abastecer" do ⚡ da linha da máquina (a janela do abastecimento de sempre, com a máquina escolhida). O botão "+ Abastecimento" da área saiu |
| Relatório | [`MAIKE-ATIVIDADES-POR-AREA-REPORT.md`](./MAIKE-ATIVIDADES-POR-AREA-REPORT.md) (seção 10) |

## Missão anterior (2026-11-18) — MAIKE-LANCAMENTOS-ORGANIZAR: uma tabela de áreas, uma tabela de lançamentos por área e um nível de janela (D-PROD-252)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-252**, pedido do proprietário sobre a auditoria e as maquetes aprovadas (desktop, celular e Resumo das áreas) |
| Branch / PR | `cursor/lancamentos-organizar`, a partir da `main` `3a329d90` (PR #329, D-PROD-251) · PR a abrir |
| Escopo | Atividade: linha de resumo + UMA tabela de áreas. Área: botões "+" e UMA tabela de lançamentos (abastecimento e implemento dentro dela). Lançamento novo direto numa janela de um nível (Cancelar / Salvar / Salvar e novo). Abastecimento com a revisão na mesma janela e sem os campos travados. Resumo das áreas (Área · ha · Máquinas · Insumos · Mão de obra · Serviços · Abastecimento · Total · R$/ha, sem nota). Celular: janela em tela cheia (padrão `b1-janela--tela-cheia`), nunca caixa flutuante. **Emenda 1 (revisão do proprietário, commit `36c11c8a`):** a tela não fala mais em "dias" (sem Dias lançados, Ajustar um dia nem Área do dia); a **Feita (ha)** se informa na linha da área e grava no lançamento mais novo dela; a área aberta mostra uma tabela e um total (sem abas por cima); sem subtítulo da lista; sem o aviso "Reaberta em…" **Emenda 2 (revisão do proprietário, commit `b83a518d`):** todas as tabelas (áreas, lançamentos da área, Resumo das áreas e itens do Resumo da atividade) são a grade Base1 da lista (`TabelaBase1` → `CadastroBase1Grade`), sem cartão, com o rodapé do Base1 no fim da casca e o total no `<tfoot>`; sem a linha "Aberta · desde …" e sem o aviso "Foi anotado em …" (só o toast); Resumo da atividade como um detalhe de cadastro (campos + tabela Tipo · Item · Quantidade · Custo). Referência oficial: a lista do Lançamento de Atividades. **Emenda 3 (revisão do proprietário, commit `c0d98ca6`):** todas as janelas desta tela têm UM tamanho no computador — a `B1Janela` padrão do Base1, 680px, altura `min(86vh, 720px)`, título e ✕ em cima e botões embaixo (saíram `b1-janela--tipo` 960px, `b1-janela--estreita` 560px e o diálogo de ~512px; o `DialogoAcao` ganhou `janelaBase1`); no celular, tela cheia. Dentro delas os dados ficam organizados no formulário dos cadastros: uma grade só em grupos (`SecaoForm`, duas colunas), o Dia como primeiro campo do grupo Lançamento, sem subtítulo, sem contexto repetido e sem textos de ajuda; o Concluir atividade mostra o Resumo como campos de leitura. |
| Backend | Nenhuma mudança. Nenhuma migration nova |
| Release | Merge normal de frontend. A prévia da Vercel segue a regra da D-PROD-251 (`ignoreCommand`) |
| Relatório | [`MAIKE-ATIVIDADES-POR-AREA-REPORT.md`](./MAIKE-ATIVIDADES-POR-AREA-REPORT.md) (seção 9) |

## Missão anterior (2026-11-18) — MAIKE-ATIVIDADES-POR-AREA: o lançamento pela área, em passos, com o tipo separado (D-PROD-251)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-251**, pedido do proprietário: a lógica dos rascunhos (tipo uma vez, abrir em passos, registrar na área) no visual do sistema |
| Branch / PR | `cursor/atividades-por-area-0b6c`, a partir da `main` `637a3002` (PR #327, D-PROD-249) |
| Escopo | Assistente de abertura (tipo → áreas → conferir); atividade aberta pelos cartões de área; registro um de cada vez com confirmação na área; lista em palavras simples; Tipos de atividade separado, com "O que pode registrar". O ⚡ da lista não lança. "Mais detalhes" guarda o ajuste por tipo e por dia |
| Backend | Nenhuma mudança. Nenhuma migration nova |
| Migration anterior | `20261118100000_atividade_areas` (D-PROD-249) **foi aplicada em produção em 2026-11-18 às 19:05:13 UTC** (caminho B, depois de a #327 já estar na `main`; `SCHEMA_APPLIED_PROD: SIM`). Esta missão não cria migration |
| Release | Merge normal de frontend. A prévia da Vercel está liberada só para esta branch (`ignoreCommand`) |
| Relatório | [`MAIKE-ATIVIDADES-POR-AREA-REPORT.md`](./MAIKE-ATIVIDADES-POR-AREA-REPORT.md) |

## Missão anterior (2026-11-18) — MAIKE-ATIVIDADE-AREAS: várias áreas por atividade, cada lançamento datado de uma área (D-PROD-249)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-249**, pedido do proprietário ("nessa atividade são vários pastos que vou fazendo ao decorrer do tempo … cada custo e lançamento é feito para aquela área"); uma atividade com várias áreas, não uma atividade por área |
| Branch / PR | `feat/atividade-varias-areas`, a partir da `main` `e260a305` (PR #325, D-PROD-237) · PR a abrir |
| Escopo | Tabela `AtividadeArea` (ciclo PLANEJADA → EM_ANDAMENTO → CONCLUIDA, com as datas) e `AtividadeApontamento.atividade_area_id` com FK composta; rotas da área (adicionar, planejada, iniciar, concluir, reabrir, remover); lançamento só em área em andamento; `por_area` nos totais; "Abrir atividade" com Áreas; card "Áreas da atividade"; janela do tipo presa na área; coluna Área "2 de 5 em andamento" |
| Migration | `20261118100000_atividade_areas`, **CONTRACT** (CONVERSÃO, sem `DROP`; backfill da área nº 1 das atividades com área), SHA `098f0d06d45922886f64cb4e2f4bd00644dac26b833e8020feeed2632d31ec06`. Produção 67 → 68; tabelas 96 → 97 |
| Release | **Aplicada em produção em 2026-11-18 às 19:05:13 UTC** pelo caminho B (Supabase `execute_sql`, envelope do runbook), com GO do proprietário. A PR #327 já estava mergeada, o que fechou o caminho A (`CONTRACT_INESPERADO`, como na D-PROD-183). SHA aprovado `417e065e`. Preflight `PRONTO PARA APLICAR` (67/0; 96 tabelas); postcheck `APLICADA E CONFERIDA` (68/0; 97 tabelas; `AtividadeArea` 4 linhas `EM_ANDAMENTO`; 4/4 lançamentos ligados; FK validada; 0 lints). `SCHEMA_APPLIED_PROD: SIM`. Registro no [runbook](./MAIKE-ATIVIDADE-AREAS-RUNBOOK-RELEASE.md) (§9) |
| Documentos | [contrato](./MAIKE-ATIVIDADE-AREAS-CONTRATO.md) · [relatório](./MAIKE-ATIVIDADE-AREAS-REPORT.md) · [runbook](./MAIKE-ATIVIDADE-AREAS-RUNBOOK-RELEASE.md) |

## Missão anterior (2026-11-18) — MAIKE-ATIVIDADES-LISTA: Lançamento de Atividades, fatia 4 (última) do redesenho — a lista: filtros em pílulas e cards do celular (D-PROD-237)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-237**, fatia 4 (última) do plano da D-PROD-232: os filtros da lista na faixa de pílulas e os cards do celular no desenho do protótipo |
| Branch / PR | `feat/atividades-lista-filtros-celular`, a partir da `main` `83d08e5c` (PR #324) · PR a abrir |
| Escopo | Sai a caixa solta (Tipo, Área, Início de / até); a faixa fica Ordenar · Status · Tipo de atividade · Área · Início (uma pílula com De / Até e o período no rótulo) · + Filtro, todos na query do servidor de sempre. Motor (opt-in): filtro de período da tela, `ocultarPadrao`, pesquisa acima de 8 opções, coluna coberta fora da faixa salva e do "+ Filtro", selo e subtítulo do card. Celular: cards com a sigla do tipo na cor do tipo, "Nº · Status", ⚡ e Nº / Tipo / Área / Início / Valor total |
| Backend | Nenhuma mudança |
| Release | Merge e deploy normais (só frontend); nenhuma migration, nenhum dado muda |
| Relatório | [`MAIKE-ATIVIDADES-LISTA-REPORT.md`](./MAIKE-ATIVIDADES-LISTA-REPORT.md) |

## Missão anterior (2026-11-17) — MAIKE-MAPA-DETALHES-V12: barra do topo v12, Detalhes do Lote v12 (D-PROD-218), os detalhes do mapa no mesmo desenho (D-PROD-220) e os lançamentos e históricos deles no desenho do manejo (D-PROD-222), com a densidade (D-PROD-224) e a organização (D-PROD-226) do estilo antigo e o subícone do sistema nos detalhes (D-PROD-225)

| Campo | Valor |
|---|---|
| Decisões | **D-PROD-218** (barra ⚙ · Lotes · Pastos · Tarefas e Detalhes do Lote v12), **D-PROD-220** (cocho, depósito, bebedouro, tarefa e Histórico da Área no mesmo desenho), **D-PROD-222** (lançamentos e históricos que abrem desses detalhes iguais aos do manejo do lote), **D-PROD-224** (detalhes mais compactos, com a densidade do estilo antigo), **D-PROD-225** (cocho e depósito com o subícone do sistema nos detalhes, sem a bolinha do mapa; nasceu como D-PROD-223, que a `main` deu ao farol estimado) e **D-PROD-226** (detalhes organizados como o estilo antigo: pares lado a lado no popup, toque e contraste), pedidos do proprietário; filtros do mapa como estão |
| Refinamento D-PROD-235 (nasceu D-PROD-230) | Botão Visualização integrado ao fim da barra escura do mapa; painel e permissões preservados, ações laterais abaixo da barra. |
| Refinamento D-PROD-236 (nasceu D-PROD-232) | Detalhes de área e lote com cartões em linhas, rótulos à esquerda e valores à direita; blocos empilhados no celular/tablet e em pares no desktop, preservando os dados. |
| Refinamento D-PROD-248 | Detalhes aprovados: popup estável, resumo com cinco indicadores, média projetada ponderada, projeções responsivas, passagem automática de texto e histórico compacto; PR/merge autorizados pelo dono. |
| Refinamento D-PROD-238 | Popup dos detalhes dimensionado pela viewport; campos em duas colunas no tablet e três no desktop amplo, mantendo as linhas no celular. |
| Refinamento D-PROD-239 | Cartões largos empilhados em desktop/tablet, com apenas os campos internos em colunas; popup estável e celular preservados. |
| Refinamento D-PROD-229 | Detalhes de lote com identidade sem repetição, Lotação, Pesagem, Projeção de peso e Identificação separadas; pares no computador e uma coluna no celular. Tabela e regras preservadas. |
| Refinamento D-PROD-228 | Histórico de cocho e depósito somente pelo botão; nova ação Fechamentos no cocho, com todos os períodos fechados e permissão de histórico. Resumo sem registros antigos; detalhes de lote preservados. |
| Refinamento D-PROD-227 | Cocho e depósito com seções nomeadas, métricas do último registro agrupadas e projeções/limites sem repetição no resumo; pares explícitos no popup e uma coluna no celular. Regras e permissões preservadas. |
| Branch / PR | `claude/design-filters-implementation-agzxk8` · PR **#308** (merge a pedido do proprietário: "Tiver pronto faça o merge"); `main` `83d08e5` (PR #324, D-PROD-234) mesclada |
| Escopo | Mapa Geral: barra **⚙ · Lotes · Pastos · Tarefas** (`src/lib/mapaFoco.js`); Detalhes do Lote v12 (`.mk-dp`); casca v12 de uma tela (`CascaDetalhe`) no cocho, no depósito (com cocho empilhado), no bebedouro, na tarefa e no Histórico da Área (com a Forragem da D-PROD-219, o farol da D-PROD-221 e as abas do curral); popup a partir de 768 px. D-PROD-222: cartão comum dos históricos (`CartaoHistorico`, as classes do Histórico de Movimentação) no cocho, no depósito, no bebedouro, na tarefa e no abate do curral; Lançar e Leitura do cocho, Entrada e Saída do depósito e Lançar do bebedouro no `LancLoteDialogo` + `LancField` + `B1Select` dos manejos; Esc com lista aberta fecha só a lista em todos os lançamentos. D-PROD-225: nos detalhes (nível do cocho e do depósito, listas de cochos), o subícone do sistema (`COCHO_APARENCIA.subicone`); o marcador fica só no mapa. D-PROD-224: densidade do estilo antigo no v12 (letra menor com piso de 11 px, valor em negrito, 6 colunas no popup do computador (5 no do tablet), nível ao lado do cartão no cocho e no depósito, linha do tempo em grade). D-PROD-226: a partir de 768 px, pares lado a lado (Lotação \| Categorias, Fornecimento \| Consumo, Resumo \| Último registro, Saldo \| Pastos atendidos); cartões do limite do cocho e dos números do depósito como os antigos, com os valores alinhados; texto livre com o rótulo numa coluna em todas as larguras; divisória na linha do tempo; alvos de toque de 40 px (inclusive o ✕); teal AA; Tab na Lista mostra o cabeçalho inteiro |
| Testes | `test:smoke` 292 arquivos e 3.634 testes (com a `main` da PR #324, D-PROD-234); `gate:types` 374 de 625; lint sem erros; build e demais gates do `verify:all` passam; `test:backend` no CI (precisa de PostgreSQL). Revisões independentes com verificação adversarial: relatórios da D-PROD-220 (§7 e §10.1) e da D-PROD-222 |
| Relatórios | [`MAIKE-MAPA-DETALHES-LOTE-V12-REPORT.md`](./MAIKE-MAPA-DETALHES-LOTE-V12-REPORT.md) · [`MAIKE-MAPA-DETALHES-PONTOS-V12-REPORT.md`](./MAIKE-MAPA-DETALHES-PONTOS-V12-REPORT.md) · [`MAIKE-MAPA-LANCAMENTOS-HISTORICOS-MANEJO-REPORT.md`](./MAIKE-MAPA-LANCAMENTOS-HISTORICOS-MANEJO-REPORT.md) |

## Missão anterior (2026-11-18) — MAIKE-ATIVIDADES-ABERTA-RESUMO: Lançamento de Atividades, fatia 3 do redesenho — a atividade aberta (D-PROD-234)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-234**, fatia 3 do plano da D-PROD-232: a atividade aberta no desenho do protótipo do proprietário, no modelo visual do sistema |
| Branch / PR | `feat/atividades-aberta-resumo`, a partir da `main` `0facca65` (PR #322) · PR a abrir |
| Escopo | `AtividadeAberta.jsx` (novo): abas Lançamentos / Resumo da atividade com a navegação do registro; "Resumo de custo · ÁREA"; a tabela dos tipos (Itens, Resumo, Valor, Total, ⚡ Inserir / Ver lançamentos e "+ Lançar" que abrem a janela da fatia 2); "Dias lançados" recolhível com a lista de sempre; a aba Resumo com os totais por item e os dados só leitura; celular com a cabeça ✕ / Concluir e os tipos em cartões. Lista: coluna Valor total e o R$ no cabeçalho do ⚡ |
| Backend | **Só leitura, sem migration:** `GET /atividades/:id/totais` + `custo_por_tipo` e `litros_combustivel_por_ha`; `GET /atividades` + `custo_total` por item (uma consulta agrupada por página) |
| Release | Merge e deploy normais (frontend e API juntos); nenhuma migration, nenhum dado muda |
| Relatório | [`MAIKE-ATIVIDADES-ABERTA-RESUMO-REPORT.md`](./MAIKE-ATIVIDADES-ABERTA-RESUMO-REPORT.md) |

## Missão anterior (2026-11-17) — MAIKE-ATIVIDADES-JANELAS-TIPO: Lançamento de Atividades, fatia 2 do redesenho — janelas por tipo de lançamento (D-PROD-233)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-233**, fatia 2 do plano da D-PROD-232, com a regra do dia aprovada pelo proprietário ("pode ser"): hoje por padrão, ‹ ›, e o dia criado sozinho ao salvar o primeiro item |
| Branch / PR | `feat/atividades-janelas-tipo`, a partir da `main` `48ec6ca3` (PR #319) · PR **#322**, mergeada |
| Escopo | `JanelaLancamentoPorTipo.jsx` (novo): Trabalho de máquinas, Aplicação de insumos, Mão de obra e Custos extras pelo ⚡ da lista; o dia (hoje, ‹ ›, o lançamento do dia quando há mais de um, a área do dia); aba da lista do tipo com o total e o ⚡ da linha (Editar e Cancelar de sempre); aba Dados com o MESMO formulário de `JanelasDaLinha` (casca trocável, destino "dia novo": `criarApontamento` com a linha, `operation_id` persistente), Voltar / Salvar / Salvar e fechar; celular em tela cheia. `DialogoCancelarLinha` compartilhado. Sai o fluxo provisório da fatia 1. Diesel fica no bloco Abastecimentos do dia (fora desta fatia) |
| Release | **Só frontend**: sem backend, banco ou migration — merge e deploy normais |
| Relatório | [`MAIKE-ATIVIDADES-JANELAS-TIPO-REPORT.md`](./MAIKE-ATIVIDADES-JANELAS-TIPO-REPORT.md) |

## Missão anterior (2026-11-17) — MAIKE-ATIVIDADES-MENU-RAIO: Lançamento de Atividades, fatia 1 do redesenho pelo protótipo do proprietário — menu ⚡ por linha e Concluir com resumo (D-PROD-232)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-232** (pedida como D-PROD-224; da 224 à 231 já estão em branches abertas de outras sessões), pedido do proprietário com o protótipo HTML dele: seguir a lógica e o estilo, mantendo o modelo visual do sistema. Plano em 4 fatias: 1 menu ⚡ + concluir; 2 janelas por tipo (lista, Inserir, Dados, Salvar e Salvar e fechar; dia com hoje por padrão e setas; dia criado sozinho ao salvar o primeiro item — "pode ser"); 3 atividade aberta (Resumo de custo, tabela dos 4 tipos, aba Resumo da atividade); 4 celular |
| Branch / PR | `feat/atividades-menu-raio`, a partir da `main` `64310bd4` (PR #313), com a `main` `bd9fc99b` (PR #315, D-PROD-230) por merge · PR **#316**, mergeada |
| Escopo | Motor Base1: `renderAcoesDaLinha` opt-in em `CadastroBase1Grade` / `Base1Grid` / `Base1Cards` (⚡ na célula de seleção com "Ações" no cabeçalho; no topo do card) e `B1AcoesDaLinha.jsx` (botão + menu: janela no computador, `MobileSheet` no celular). Lançamento de Atividades: menu ⚡ (Trabalho de máquinas / Aplicação de insumos / Mão de obra / Custos extras pelo tipo e pela permissão; Abrir; Alterar, Concluir/Reabrir, Duplicar, Cancelar); lançar pelo ⚡ abre o dia (hoje) e, gravado, a atividade abre com a janela do tipo no dia; `DialogoConcluirAtividade` com o resumo (`/totais` e os dias lançados do detalhe; "—" sem valor) e o aviso da área que falta; "Concluir" à vista na atividade aberta |
| Release | **Só frontend**: sem backend, banco ou migration — merge e deploy normais |
| Relatório | [`MAIKE-ATIVIDADES-MENU-RAIO-REPORT.md`](./MAIKE-ATIVIDADES-MENU-RAIO-REPORT.md) |

## Missão anterior (2026-11-17) — MAIKE-ASSISTENTE-LEITURA: assistente só de leitura em todas as telas (D-PROD-230)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-230** (a `main` indica D-PROD-224, mas a branch `claude/design-filters-implementation-agzxk8` já usa da D-PROD-224 à D-PROD-228 e indica a 229 como a próxima dela), pedido do proprietário: uma IA que responda perguntas sobre os dados da fazenda, só de leitura, com a chave da API do Claude dele |
| Branch / PR | `claude/kind-knuth-tztu1v`, a partir da `main` `cdd8d79d` (PR #312, D-PROD-223) · PR **#315**, mergeada |
| Escopo | `POST /assistente/perguntar` (tenant só da sessão, fazenda conferida, corpo fechado, histórico curto do cliente, dica da tela); 5 ferramentas fechadas e só de leitura sobre os serviços que já existem (pastos com forragem, medições do pasto, rebanho por pasto, resumo do rebanho, leituras de cocho); botão flutuante do assistente em todas as telas logadas, montado uma vez no Layout |
| Migration | **Nenhuma.** Nada é gravado: sem tabela, sem histórico no servidor |
| Configuração | `ANTHROPIC_API_KEY` nas variáveis de ambiente da Vercel (produção). Sem ela, o assistente responde "não configurado" (503 `ASSISTENTE_NAO_CONFIGURADO`) |
| Relatório | [`MAIKE-ASSISTENTE-LEITURA-REPORT.md`](./MAIKE-ASSISTENTE-LEITURA-REPORT.md) |

## Missão anterior (2026-11-17) — MAIKE-DESCANSO-ESTIMADO: farol de forragem estimado pelos dias de descanso e parâmetros próprios do pasto (D-PROD-223)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-223** (a D-PROD-222 está reservada pela branch `claude/design-filters-implementation-agzxk8`), pedido do proprietário: sem medição recente, o farol do pasto estimado pelos dias desde a saída do último lote contra os dias de descanso da cultura |
| Branch / PR | `claude/kind-knuth-tztu1v`, a partir da `main` `9b4bf78f` (PR #311, D-PROD-221) |
| Escopo | `CADCULTURAS.dias_descanso` (API 1..365, formulário e grade "Dias de descanso", lista de referência com os valores); `GET /medicoes-forragem/descanso` (ocupação e última saída por pasto pelo ledger do rebanho); `dias_descanso` na cultura embutida de `/areas-pastagem`; regra pura (Descanso < D ≤ Pronto ≤ arredondar(D×1,5) < Passou; nunca Rapado); farol estimado no modo "Forragem" (tom bem claro, "(estimado)" na legenda) e no painel Forragem do pasto ("Em pastejo" com lote dentro); **parâmetros próprios do pasto** na Área (alturas de entrada/saída e dias de descanso; vazio = os da cultura), usados na Medição de Forragem, na estimativa e no painel, com a seção opcional no formulário da Área |
| Migration | `20261117300000_descanso_e_alturas_por_area`, **EXPAND** (4 colunas anuláveis em tabelas antigas, sem CHECK — faixas na API), SHA-256 `c391e4b0c28dbefdafa8d0819d948efde952bf8ee5adc20ff58aa930239b477e`. Produção 66 → 67 (a anterior é a `20261117200000_medicao_forragem`, D-PROD-219); tabelas 96 (nenhuma nova) |
| Dados | Depois da migration, os dias de descanso de referência nas 11 culturas da fazenda (só onde vazio, por código e nome; DML guardado, uma transação, evento na auditoria) — [runbook](./MAIKE-DESCANSO-ESTIMADO-RUNBOOK-RELEASE.md) §4 |
| Release | **Aplicada em produção** em 2026-11-17 às 13:48:31 UTC (caminho B do [runbook](./MAIKE-DESCANSO-ESTIMADO-RUNBOOK-RELEASE.md), GO do proprietário): preflight 66 / 0, postcheck 67 / 0, as 4 colunas presentes, 96 tabelas. Passo de dados às 13:48:50 UTC: 11 culturas com os dias de descanso de referência, auditado (`d-prod-223-backfill`). Merge depois do CI verde |
| Relatório | [`MAIKE-DESCANSO-ESTIMADO-REPORT.md`](./MAIKE-DESCANSO-ESTIMADO-REPORT.md) |

## Missão anterior (2026-11-17) — MAIKE-FAROL-FORRAGEM: farol de forragem no Mapa Geral (D-PROD-221)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-221**, pedido do proprietário: depois da Medição de Forragem, o farol no mapa (cada pasto pintado pela última medição) |
| Branch / PR | `claude/kind-knuth-tztu1v`, a partir da `main` `e58cbbc9` (PR #310, ajuste da D-PROD-219) |
| Escopo | Modo de coloração **"Forragem"** no painel Visualização (preferência por usuário, como os outros modos); cor do pasto pela última medição (Rapado vermelho, Descanso amarelo, Pronto verde, Passou do ponto roxo; mais de 15 dias → cinza; nunca medido → neutro; no olho → tom mais claro + 👁); infraestrutura, reserva e APP com a cor normal; legenda; chip do farol no detalhe do pasto. Domínio puro em `src/domain/pastagem/farolForragem.js` |
| Release | **Sem migration** (lê a `MEDICAOFORRAGEM` da D-PROD-219): merge e deploy normais |
| Relatório | [`MAIKE-FAROL-FORRAGEM-REPORT.md`](./MAIKE-FAROL-FORRAGEM-REPORT.md) |

## Missão anterior (2026-11-17) — MAIKE-MEDICAO-FORRAGEM: Medição de Forragem do pasto, tabela `MEDICAOFORRAGEM` (D-PROD-219)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-219**, pedido do proprietário: medição pela régua, no olho e a amostra de matéria seca, pelo botão no pasto do Mapa Geral |
| Branch / PR | `claude/kind-knuth-tztu1v`, a partir da `main` `effc50be` (PR #307, D-PROD-216), com a `main` `d0b49099` (PR #303, D-PROD-217) mesclada |
| Escopo | Model `MedicaoForragem` / tabela `MEDICAOFORRAGEM`; API `/medicoes-forragem` (GET autenticado; POST/DELETE com a chave nova do mapa `medir_forragem`); contas no servidor (média, situação pelas alturas da cultura, matéria verde, MS%, massa seca) e prévia na tela; painel **Forragem** no detalhe do pasto com o botão "Medição de Forragem" e as últimas medições; fila offline e cache do mapa. Farol no mapa fica para a próxima missão |
| Migration | `20261117200000_medicao_forragem`, **EXPAND** (só a tabela nova), SHA-256 `66f5fb51b3d2c92419bd8d2320f33b7c632b03edf29a0b598686622e92e7b62f`. Produção 65 → 66 (a anterior é a `20261117100000_abastecimento_fk_apontamento_atividade`, D-PROD-217, mergeada e aplicada antes); tabelas 95 → 96 |
| Release | **Aplicada em produção** em 2026-11-17 às 03:04:47 UTC (caminho B do [runbook](./MAIKE-MEDICAO-FORRAGEM-RUNBOOK-RELEASE.md), GO do proprietário): preflight 65 / 0, postcheck 66 / 0, `MEDICAOFORRAGEM` com RLS e 1 política, 9 constraints, 5 índices, `anon` sem SELECT, 96 tabelas |
| Relatório | [`MAIKE-MEDICAO-FORRAGEM-REPORT.md`](./MAIKE-MEDICAO-FORRAGEM-REPORT.md) |

## Missão anterior (2026-11-17) — MAIKE-ABASTECIMENTO-FK-APONTAMENTO: reforço no banco, o apontamento do abastecimento é da atividade dele (D-PROD-217)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-217** (nasceu D-PROD-213, depois D-PROD-214 e D-PROD-216; a `main` deu a 213 ao Resumo do Rebanho, a 214 aos ajustes do mapa, a 215 às Culturas e a 216 à Área ligada à Cultura, PR #307), pedido do proprietário ("pode fazer o reforço no banco"); continua a D-PROD-211 (item 8, "reforço futuro") |
| Branch / PR | `feat/abastecimento-fk-apontamento-atividade`, a partir da `main` `387903f2` (merge da PR #300, D-PROD-211), com a `main` `83206ab5` (PR #302, D-PROD-213), a `main` `133c6ed4` (PRs #304, #305 e #306, D-PROD-214 e D-PROD-215) e a `main` `effc50be` (PR #307, D-PROD-216) por merge · PR **#303** |
| Escopo | Só banco: `AtividadeApontamento` ganha o UNIQUE (`cliente_id`, `empresa_id`, `atividade_id`, `id`) e a FK `AbastecimentoBem_apontamento_fkey` passa a 4 colunas (com a atividade): o banco recusa um abastecimento ligado a apontamento de outra atividade. Código do servidor e da tela sem mudança |
| Migration | `20261117100000_abastecimento_fk_apontamento_atividade` — o nome com que foi registrada em produção (a pasta nasceu `20261116400000_…` e foi `20261116600000_…`; conteúdo idêntico), **CONTRACT** (décima terceira de `MIGRATIONS_CONTRACT_APROVADAS`; a guarda aborta com qualquer abastecimento ligado a apontamento de outra atividade), SHA `1ee8d5a3c3dd64e59d27459bd51224795b69f691c7358088fd5bbec375561c0e`. Produção 64 → 65 (a anterior é a `20261117000000_area_cultura`, D-PROD-216); tabelas 95 (sem mudança) |
| Release | **Aplicada em produção** em 2026-11-17 às 00:43:48 UTC (caminho B do [runbook](./MAIKE-ABASTECIMENTO-FK-APONTAMENTO-RUNBOOK-RELEASE.md), GO do proprietário): preflight PRONTO (64 / 0), postcheck 65 / 0, a FK de 4 colunas e o UNIQUE presentes, 95 tabelas, dados intactos. `SCHEMA_APPLIED_PROD: SIM (2026-11-17)` |
| Documentos | [relatório](./MAIKE-ABASTECIMENTO-FK-APONTAMENTO-REPORT.md) · [runbook](./MAIKE-ABASTECIMENTO-FK-APONTAMENTO-RUNBOOK-RELEASE.md) (§9, registro da execução) |

## Missão anterior (2026-11-16) — MAIKE-AREA-CULTURA: Área ligada à Cultura e o vínculo das áreas à 001 Marandu (D-PROD-216)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-216**, pedido do proprietário: a área aponta para a cultura do cadastro; as pastagens atuais viram 001 Marandu, uso Pastagem |
| Branch / PR | `claude/kind-knuth-tztu1v`, a partir da `main` `133c6ed4` (PR #306) |
| Escopo | `AreaPastagem.cultura_id` (FK composta pela fazenda, RESTRICT); `tipo_pastagem` derivado do nome da cultura; API das áreas com `cultura_id` e `cultura`; `CULTURA_EM_USO` (409) na exclusão; formulário da Área com o campo "Cultura" ("001 · NOME"); grade com o rótulo; SQL Editor 01–04 na ordem nova. Sem alturas no pasto ou no lote |
| Migration | `20261117000000_area_cultura`, **CONTRACT aditiva** (D-PROD-216), SHA-256 `e7fd7ee674a8cadff6c4b9fc9ee496e04d9157b19f231e97bff1abb758d8ff26`. Produção 63 → 64 (a anterior é a `20261116500000_cadculturas`, D-PROD-215); 95 tabelas (nenhuma nova) |
| Dados | Depois da migration, o vínculo das 107 áreas à cultura 001 (DML guardado, uma transação, evento na auditoria) — [runbook](./MAIKE-AREA-CULTURA-RUNBOOK-RELEASE.md) §4 |
| Release | **Aplicada em produção** em 2026-11-17 às 00:24:16 UTC (caminho B do [runbook](./MAIKE-AREA-CULTURA-RUNBOOK-RELEASE.md), GO do proprietário); postcheck 64 / 0, FK e índices presentes. Vínculo às 00:24:38 UTC: 107 áreas → cultura 001 Marandu, uso Pastagem, auditado |
| Relatório | [`MAIKE-AREA-CULTURA-REPORT.md`](./MAIKE-AREA-CULTURA-REPORT.md) |

## Missão anterior (2026-11-16) — MAIKE-CULTURAS: Cadastro de Culturas, tabela `CADCULTURAS`, com lista de referência (D-PROD-215)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-215**, pedido do proprietário: primeiro passo da produção de forragem e das medições; o catálogo de culturas traz as alturas de referência, numerado |
| Branch / PR | `claude/kind-knuth-tztu1v`, a partir da `main` `83206ab5` (PR #302, D-PROD-213) |
| Escopo | Model `Cultura` / tabela `CADCULTURAS` por fazenda; API `/culturas` + comando idempotente `POST /culturas/comandos/lista-referencia` (11 forrageiras); tela "Culturas" Base1 no menu Manejo; permissão `pec-culturas` sem concessão automática. Sem vínculo com Área, pasto ou lote |
| Migration | `20261116500000_cadculturas`, **EXPAND** (só a tabela nova), SHA-256 `37a71c46f138f457022fbab8316d645eb4f39a6e2a3ddfe4c8a3394e19665715`. Produção 62 → 63 (a anterior é a `20261116300000_abastecimento_atividade`, D-PROD-211); tabelas 94 → 95 |
| Release | **Aplicada em produção** em 2026-11-16 às 22:54:49 UTC, caminho B do [runbook](./MAIKE-CULTURAS-RUNBOOK-RELEASE.md), com o GO escrito do proprietário; postcheck 63 / 0, checksum igual ao pinado, `CADCULTURAS` com RLS e 1 política, 5 constraints, `anon` sem SELECT, 95 tabelas |
| Relatório | [`MAIKE-CULTURAS-REPORT.md`](./MAIKE-CULTURAS-REPORT.md) |

## Missão anterior (2026-11-16) — MAIKE-MAPA-CADASTROS-LIGACOES: bugs dos cadastros do mapa e das ligações (D-PROD-214)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-214**, pedido do proprietário: verificar e corrigir os cadastros do mapa (pontos, áreas, linhas, cochos, depósitos, bebedouros), o cadastro em lote e as ligações entre áreas, pontos e lotes |
| Branch / PR | `fix/mapa-cadastros-ligacoes`, a partir da `main` `83206ab5` (PR #302) · PR **#305** |
| Escopo | Ligação estrita ponto↔cocho/depósito/bebedouro; exclusão com histórico bloqueada; `numero_ponto` no servidor; ocupação derivada; propagação de nome de área/setor; renumeração de áreas; Mapa Geral relendo depois de cadastros. Bugs de lote/movimentação só registrados (pausa nos lotes) |
| Release | Sem migration: merge e deploy normais |
| Relatório | [`MAIKE-MAPA-CADASTROS-LIGACOES-REPORT.md`](./MAIKE-MAPA-CADASTROS-LIGACOES-REPORT.md) |

## Missão anterior (2026-11-16) — MAIKE-RESUMO-REBANHO: Resumo do Rebanho no Mapa Geral (D-PROD-213)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-213**, pedido do proprietário: relação do rebanho por categoria com peso hoje, peso projetado em 90 dias, arrobas e lotação por pasto, no padrão visual do sistema |
| Branch / PR | `claude/kind-knuth-tztu1v`, a partir da `main` `387903f2` · PR **#302**, mergeada (`83206ab5`) |
| Escopo | Cartão do resumo inferior do Mapa Geral abre o diálogo (casca do Detalhes do Lote v8); contas puras em `src/domain/rebanho/resumoDoRebanho.js`; sem backend, sem migration, sem permissão nova |
| Release | Sem migration: merge e deploy normais |
| Relatório | [`MAIKE-RESUMO-REBANHO-REPORT.md`](./MAIKE-RESUMO-REBANHO-REPORT.md) |

## Missão anterior (2026-11-16) — MAIKE-ATIVIDADE-ABASTECIMENTO: Fatia 5, abastecimento ligado à atividade (D-PROD-211)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-211** (nasceu D-PROD-210; a `main` deu a D-PROD-210 à base do consumo, PR #297), Fatia 5 do brief do Lançamento de Atividades, liberada pelo proprietário ("pode iniciar a fatia 5") |
| Branch / PR | `feat/atividade-abastecimento`, a partir da `main` `18426967` (merge da PR #299, D-PROD-209), com a `main` `67f44d76` (PR #297, D-PROD-210) e `72e31cbe` (PR #301, D-PROD-212) por merge · PR **#300** |
| Escopo | Abastecimento ligado ao lançamento (atividade derivada), origem `EXTERNO` (posto, sem estoque), snapshots de centro de custo, leitura anterior, delta e intervalo confiável; cascata de cancelamento; totalizador com combustível, custo/ha e consumo por bem |
| Migration | `20261116300000_abastecimento_atividade`, **CONTRACT**, SHA `6dfc825cb908c28e903e66b25d16f2628db5da2cb50b9af73c6f1711b7faa436`. Produção 61 → 62 (a anterior é a `20261116200000_formulacao_base_consumo`, D-PROD-210); tabelas 94 (sem mudança) |
| Release | **Aplicada em produção em 2026-11-16** (GO escrito do proprietário, caminho B): postcheck APLICADA E CONFERIDA, produção 62/0, 94 tabelas. Registro no [runbook](./MAIKE-ATIVIDADE-ABASTECIMENTO-RUNBOOK-RELEASE.md) §9 |
| Documentos | [contrato](./MAIKE-ATIVIDADE-ABASTECIMENTO-CONTRATO.md) · [relatório](./MAIKE-ATIVIDADE-ABASTECIMENTO-REPORT.md) · [runbook](./MAIKE-ATIVIDADE-ABASTECIMENTO-RUNBOOK-RELEASE.md) |

## Missão anterior (2026-11-16) — MAIKE-FECHAMENTO-REFINAMENTOS: peso médio do período no esperado (base %PV) e a sobra antiga primeiro no custo (D-PROD-212)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-212** (a D-PROD-211 fica para a PR #300, aberta), refinamentos 1 e 2 do fechamento do consumo aprovados pelo proprietário |
| Branch / PR | `claude/kind-knuth-tztu1v`, a partir da `main` `67f44d76` (PR #297, D-PROD-210) |
| Escopo | Esperado do fechamento pelo peso médio do período (curva de ganho do lote, mesma regra do peso projetado D-PROD-198), só na base PV; custo do período com a sobra herdada saindo primeiro (camadas FIFO no cocho); correção do PATCH de `SuplementacaoEvento`, que recusava os campos do fechamento do consumo desde a D-PROD-206 |
| Migration | **Nenhuma** (campos no documento JSON do evento e do lote) |
| Release | Merge sem passo de banco |
| Relatório | [`MAIKE-FECHAMENTO-REFINAMENTOS-REPORT.md`](./MAIKE-FECHAMENTO-REFINAMENTOS-REPORT.md) |

## Missão anterior (2026-11-15) — MAIKE-BASE-CONSUMO: base do consumo na Formulação, % do peso vivo ou g por cabeça por dia (D-PROD-210)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-210** (nasceu D-PROD-207 e depois D-PROD-208; a `main` deu a D-PROD-207 à Fatia 4, a D-PROD-208 ao ajuste dela e a D-PROD-209 ao tipo Terceirizado), pedido do proprietário: sal mineral em g/cab/dia fixo; uma base por formulação, sem mistura; regras por categoria na mesma base |
| Branch / PR | `claude/kind-knuth-tztu1v`, a partir da `main` `f31d3397` (PR #296), com a `main` `18426967` (PR #299, D-PROD-209) por merge · PR **#297** |
| Escopo | `base_consumo` PV / G_CAB_DIA na Formulação (API, tela, validação sem mistura), regra em gramas, esperado do lançamento na base G (sem peso), farol do fechamento pelos gramas na base G |
| Migration | `20261116200000_formulacao_base_consumo`, **CONTRACT** (décima de `MIGRATIONS_CONTRACT_APROVADAS`; as 3 tabelas de Formulações vazias pela guarda), SHA-256 `a8c42eeb8c1fc7667833213d2d87c5a7dffd460ad1dea279ab6d5338732c3171`. Produção 58 → 59, 95 tabelas. Aprovação do CONTRACT pelo proprietário ("os dados eram só teste"; tabelas com 0 linhas) |
| Release | **Aplicada em produção** em 2026-11-16 às 02:06:55 UTC, caminho B do [runbook](./MAIKE-BASE-CONSUMO-RUNBOOK-RELEASE.md), com o GO escrito do proprietário ("go"); postcheck 61 / 0, checksum igual ao pinado, colunas e CHECKs novos presentes, 94 tabelas em `public` |
| Relatório | [`MAIKE-BASE-CONSUMO-REPORT.md`](./MAIKE-BASE-CONSUMO-REPORT.md) |

## Missão anterior (2026-11-16) — MAIKE-FUNCIONARIO-TIPO: tipo do funcionário Mensalista, Diarista ou Terceirizado (D-PROD-209)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-209**, pedido do proprietário ("por enquanto deixe a escolha assim, mensalista, diárias, terceirzado") |
| Branch / PR | `feat/funcionario-tipo-terceirizado`, a partir da `main` `3de613a5` (merge da PR #298, D-PROD-208) · PR **#299** |
| Escopo | `Fornecedor.funcionario_tipo` ∈ `MENSALISTA \| DIARISTA \| TERCEIRIZADO` (`TERCEIRIZADO` no lugar de `TAREFEIRO`), na tela Parceiros e no servidor; medida sugerida na mão de obra: Terceirizado → hora (Mensalista → hora e Diarista → diária continuam); a medida `TAREFA` da linha continua |
| Migration | `20261116100000_funcionario_tipo_terceirizado`, **CONTRACT** (troca do CHECK `Fornecedor_funcionario_check`; a guarda aborta com qualquer parceiro `TAREFEIRO`), SHA `44dd42d800de7b5db034af1c42e0b0425f18666b5e73d260ed599d95d73adab6`. Produção 59 → 60; tabelas 94 (sem mudança) |
| Release | **Aplicada em produção em 2026-11-16** (GO escrito do proprietário, caminho B): postcheck APLICADA E CONFERIDA, produção 60/0, 94 tabelas, CHECK com `TERCEIRIZADO`. Registro no [runbook](./MAIKE-FUNCIONARIO-TIPO-RUNBOOK-RELEASE.md) §9; validação toda local (GitHub Actions pausado) |
| Constituição | Sem nota (não muda escopo) |
| Documentos | [`MAIKE-FUNCIONARIO-TIPO-REPORT.md`](./MAIKE-FUNCIONARIO-TIPO-REPORT.md) · [`MAIKE-FUNCIONARIO-TIPO-RUNBOOK-RELEASE.md`](./MAIKE-FUNCIONARIO-TIPO-RUNBOOK-RELEASE.md) |

## Missão anterior (2026-11-15) — MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO (ajuste da Fatia 4): o funcionário vira papel do parceiro, e a mão de obra pode ser de funcionário ou de terceiro (D-PROD-208)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-208**, pedido do proprietário ("o cadastro de funcionários deveria ser lá em parceiros, outra coisa, eu também tenho mão de obra com terceiros não apenas com funcionários […]"); plano aprovado: "sim pode fazer" |
| Branch / PR | `feat/atividade-mao-obra-parceiro`, a partir da `main` `9a666393` (merge da PR #294, Fatia 4, D-PROD-207) · PR **a abrir** |
| Escopo | Papel `funcionario` no parceiro com tipo, cargo e custos por hora e por diária; a linha de mão de obra aponta para o parceiro, com a `origem` `FUNCIONARIO`/`TERCEIRO` decidida pelo servidor (funcionário: hora e diária com snapshot, tarefa digitada; terceiro: custo sempre digitado); seletor `GET /atividades-opcoes/mao-obra`; tabela, tela e rotas de Funcionário saem (vazias em produção) |
| Migration | `20261116000000_mao_obra_parceiro`, **CONTRACT condicionado a tabelas vazias** (`drop_no_fim`), SHA `65a8a4eb8abc7b44e24d3121605a375fee34ea88968bffe875c53b30e9cf9dd0`. Produção 58 → 59; tabelas 95 → 94; de tenant, 80 → 79 |
| Release | **Aplicada em produção** em 2026-11-15 às 22:57:36 UTC, antes do merge, caminho B do [runbook](./MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO-RUNBOOK-RELEASE.md), com o GO "aplica e aprova"; postcheck 59 / 0, 94 tabelas; validação toda local (GitHub Actions pausado) |
| Constituição | Nota "Ajuste (D-PROD-208)" no `00` e no `07`, redigida pelo agente e **aprovada pelo proprietário** em 2026-11-15 |
| Documentos | [`MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO-CONTRATO.md`](./MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO-CONTRATO.md) · [`MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO-REPORT.md`](./MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO-REPORT.md) |

## Missão anterior (2026-11-15) — MAIKE-ATIVIDADE-MAO-OBRA (Fatia 4 do Lançamento de Atividades): mão de obra e serviço de terceiro (D-PROD-207)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-207**, pedido do proprietário ("FATIA 4 — Mão de obra e serviço de terceiro. Fecha o custo."); escolha aprovada antes de implementar: Funcionário próprio (não `Usuario`) e prestador do cadastro de Parceiros ("sim, vai de acordo com o cadastro de parceiro") |
| Branch / PR | `feat/atividade-mao-obra-servico`, a partir da `main` `8d4b36a1`, com a `main` `c181e327` (PR #290, Formulações, D-PROD-203), a `5490308f` (PR #280, D-PROD-204), a `45444d21` (PR #295, leitura de cocho, D-PROD-205) e a `f31d3397` (PR #296, fechamento do consumo, D-PROD-206) mescladas |
| Escopo | Cadastros mínimos de Funcionário e de Serviço por fazenda (só inativar), linha de mão de obra (hora e diária com snapshot do custo, tarefa digitada), linha de serviço (unidade como snapshot, valor digitado, parceiro prestador opcional), editar/cancelar e cascatas como na Fatia 3, totais e custo por hectare com as quatro linhas |
| Migration | `20261115900000_atividade_mao_obra_servico`, **EXPAND** (só 4 tabelas novas), SHA `79f139a0ea5b55253db522f00af78dd4e252529ee259da59ada7b4932dad0725`. Produção 57 → 58 (depois da faixa de tolerância do fechamento do consumo, D-PROD-206, já aplicada); tabelas 91 → 95; de tenant, 76 → 80 |
| Release | **Aplicada em produção** em 2026-11-15 às 19:58:35 UTC, antes do merge, caminho B do [runbook](./MAIKE-ATIVIDADE-MAO-OBRA-RUNBOOK-RELEASE.md), com o GO do proprietário; postcheck 58 / 0, 95 tabelas |
| Constituição | Expansão D-PROD-207 no `00` e nota no `07`, redigidas pelo agente e **aprovadas pelo proprietário** em 2026-11-15 ("Aplica e aprova") |
| Documentos | [`MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md`](./MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md) · [`MAIKE-ATIVIDADE-MAO-OBRA-REPORT.md`](./MAIKE-ATIVIDADE-MAO-OBRA-REPORT.md) |

## Missão anterior (2026-11-15) — MAIKE-FECHAMENTO-CONSUMO: fechamento do consumo do cocho (%PV real × esperado, farol pela faixa da formulação, custo por cab/dia) (D-PROD-206)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-206**, decisões do proprietário para a etapa 4 da suplementação (abastecimento fecha o período; farol ±faixa da formulação, padrão 15%; custo pelo estoque; sobra não informada = aproximado) |
| Branch / PR | `claude/kind-knuth-tztu1v`, a partir da `main` `45444d21` (merge da PR #295, D-PROD-205) |
| Escopo | Faixa de tolerância na Formulação (API, tela e coluna); o lançamento grava custo/kg da saída FIFO, faixa e peso vivo de quem consome; sobra vazia = não medida; fechamento puro (`fechamentoConsumo.js`) gravado no evento nos dois caminhos que fecham; farol, %PV, g/cab/dia e custo no cartão do lançamento, no detalhe do cocho ("Último período fechado") e na prévia do abastecimento |
| Migration | `20261115200000_formulacao_faixa_tolerancia`, **EXPAND** (1 coluna anulável em CADFORMULACAO). SHA-256 `bb8be379c241341e1ba45a7d7da8258aef77d5f4e089db302c8d655608d58e4c`. Release pelo [runbook](./MAIKE-FECHAMENTO-CONSUMO-RUNBOOK-RELEASE.md) |
| Release | **Aplicada em produção** em 2026-11-15 às 17:27:54 UTC, caminho B do [runbook](./MAIKE-FECHAMENTO-CONSUMO-RUNBOOK-RELEASE.md), com aprovação do proprietário; postcheck 57 / 0, checksum igual ao pinado, coluna `numeric(5,2)` anulável sem default, 91 tabelas em `public` |
| Próximas etapas | 2b Produção da batelada, quando o proprietário precisar |
| Relatório | [`MAIKE-FECHAMENTO-CONSUMO-REPORT.md`](./MAIKE-FECHAMENTO-CONSUMO-REPORT.md) |

## Missão anterior (2026-11-15) — MAIKE-LEITURA-COCHO: leitura de cocho (escore, acesso, estrutura) e farol do cocho no mapa (D-PROD-205)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-205**, decisões do proprietário para a etapa 3 da suplementação (escore Vazio/Adequado/Cheio + acesso + estrutura, sem estoque; farol no mapa; leitura vence depois de 2 dias) |
| Branch / PR | `claude/kind-knuth-tztu1v`, a partir da `main` `5490308f` (merge da PR #280, D-PROD-204) |
| Escopo | Tabela `LEITURACOCHO`, API `/leituras-cocho` (GET autenticado; POST/DELETE com a chave do mapa `lancar_suplementacao`), leitura também offline (fila), farol do cocho (vermelho/verde/azul/cinza) no detalhe e no marcador do mapa, avisos de acesso e estrutura |
| Migration | `20261115100000_leitura_cocho`, **EXPAND** (1 tabela nova). SHA-256 `f31cb0b8dace187b3b7bc76d6b989c0b6f2f0cd96c623834efcd23c0a9bcd1a1`. Release pelo [runbook](./MAIKE-LEITURA-COCHO-RUNBOOK-RELEASE.md), **antes do merge** (D-PROD-72) |
| Release | **Aplicada em produção** em 2026-11-15 às 15:20:55 UTC, caminho B do [runbook](./MAIKE-LEITURA-COCHO-RUNBOOK-RELEASE.md), com aprovação do proprietário; postcheck 56 / 0, checksum igual ao pinado, `LEITURACOCHO` com RLS e 1 política, 7 constraints, `anon` sem SELECT, 91 tabelas em `public` |
| Próximas etapas | 4 Fechamento de consumo em %PV com faixa configurável (padrão ±15%) e custo por cab/dia · 2b Produção da batelada, quando o proprietário precisar |
| Relatório | [`MAIKE-LEITURA-COCHO-REPORT.md`](./MAIKE-LEITURA-COCHO-REPORT.md) |

## Missão anterior (2026-11-14) — MAIKE-OFFLINE-MAPA-IDS: o id do servidor de uma criação offline sobrevive entre passadas do replay (D-PROD-204)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-204** (nasceu D-PROD-198, que a `main` deu ao peso projetado do lote; a D-PROD-203 é da PR #290, mergeada) |
| Branch / PR | `claude/relaxed-bardeen-jlgbp7`, PR #280, exclusiva desta missão. Nasceu sobre a PR #279 (emenda R2 da D-PROD-195); depois do merge dela, atualizada por merge com a `main` e com a `main` como base |
| Escopo | `syncOfflineEntityQueue`: depois de um `create` confirmado e antes de tirá-lo da fila, todo item da fila que cita o id offline passa a citar o do servidor (`record_id` e `data`). `substituirIdsMapeados` troca só id `offline_…`, por chave própria do mapa, inclusive dentro de listas. Sem retenção nova. Só frontend, sem migration |
| Provas | `offlineMapaDeIdsEntrePassadas` (6, todos reprovam com o runtime anterior) + `offlineRuntime`, `estoqueP0FilaOfflineLegada`, `loteDeleteOfflineBloqueado`, `loteExclusaoCacheOffline`, `categoriaManejoCriacaoOnline` |
| Relatório | [`MAIKE-OFFLINE-MAPA-IDS-REPORT.md`](./MAIKE-OFFLINE-MAPA-IDS-REPORT.md) |

## Missão anterior (2026-11-14) — MAIKE-FORMULACOES: Formulações de suplemento (produto pronto ou batelada, %PV por categoria) e formulação obrigatória no lançamento do cocho (D-PROD-203)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-203**, decisões do proprietário para a etapa 2 da suplementação (pronto × batelada, %PV com exceção por categoria, ingredientes em kg por batida, produto misturado cadastrado antes em Produtos, formulação obrigatória no lançamento) |
| Branch / PR | `claude/kind-knuth-tztu1v`, a partir da `main` `10a966e7` (merge da PR #288, D-PROD-201) |
| Escopo | Etapa 2a de 4 da suplementação: cadastro de Formulações (tela `Formulacoes`, menu Manejo, tela de permissão `pec-formulacoes`), API `/formulacoes` com `opcoes-lancamento` (só ativas; também pela chave do mapa `lancar_suplementacao`), e o lançamento do cocho com a Formulação obrigatória no lugar do Produto e o consumo esperado lote a lote (regra da categoria ou %PV padrão) |
| Migration | `20261114700000_cadformulacao`, **EXPAND** (3 tabelas novas: `CADFORMULACAO`, `CADFORMULACAOINGREDIENTE`, `CADFORMULACAOREGRA`). SHA-256 `96f3f3641815960335ddd5321896258a4114a42f62f46448ae53a35907784524`. Repositório 54 → **55** (a 55ª, depois da `20261114600000_atividade_linhas_produto_maquina` da PR #289); tabelas 87 → **90** |
| Release | **Aplicada em produção** em 2026-11-14 às 23:41:42 UTC, caminho B do [runbook](./MAIKE-FORMULACOES-RUNBOOK-RELEASE.md), com GO escrito do proprietário ("go"); postcheck 55 / 0, 3 tabelas com RLS, 90 tabelas, advisors sem achados. A PR #289 (migration `20261114600000`, já aplicada) entrou na `main` (`8d4b36a1`, com a #291) e foi incorporada nesta branch |
| Próximas etapas | 2b Produção da batelada (baixa dos ingredientes e entrada do misturado pelo motor de estoque) · 3 Leitura de cocho e farol · 4 Fechamento de consumo em %PV com faixa configurável |
| Relatório | [`MAIKE-FORMULACOES-REPORT.md`](./MAIKE-FORMULACOES-REPORT.md) |

## Missão anterior (2026-11-14) — MAIKE-ATIVIDADE-LINHAS (Fatia 3 do Lançamento de Atividades): linhas de produto e de máquina (D-PROD-202)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-202**, pedido do proprietário ("FATIA 3 — As linhas que geram custo: produto e máquina."), liberada com "pode começar" |
| Branch / PR | `feat/atividade-itens-produto-maquina`, a partir da `main` `74bd3ee1` |
| Escopo | Linha de produto (baixa e estorno FIFO pelo motor único), linha de máquina (medidor do bem, leitura na linha), totalizador, repetir com linhas, custo de uso e teto de salto nos cadastros |
| Migration | `20261114600000_atividade_linhas_produto_maquina`, **EXPAND**, SHA `e374c81d448711894a19825e319ed0d760128c9b77a02953647e4cf7a09a5489`. Produção 53 → 54; tabelas 84 → 87 |
| Release | **Aplicada em produção** em 2026-11-14, antes do merge, com o GO "autorizo vocÇe", pelo caminho B do [runbook](./MAIKE-ATIVIDADE-LINHAS-RUNBOOK-RELEASE.md). Postcheck: 54 / 0, 87 tabelas, APLICADA E CONFERIDA |
| Constituição | Nota D-PROD-202 no `00` e no `07`, redigida pelo agente e **aprovada pelo proprietário** em 2026-11-14 |
| Documentos | [`MAIKE-ATIVIDADE-LINHAS-CONTRATO.md`](./MAIKE-ATIVIDADE-LINHAS-CONTRATO.md) · [`MAIKE-ATIVIDADE-LINHAS-REPORT.md`](./MAIKE-ATIVIDADE-LINHAS-REPORT.md) |

## Missão anterior (2026-11-14) — MAIKE-SUPLEMENTACAO-BASE: rebanho e peso certos no lançamento de suplementação, sem baixa dupla, datas em ordem (D-PROD-201)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-201** |
| Branch / PR | `claude/kind-knuth-tztu1v`, recomeçada da `main` `74bd3ee1` (merge da PR #285) |
| Escopo | Etapa 1 de 4 da suplementação: o lançamento usa o rebanho do mapa (posições) e o peso projetado (ou o último peso); lote sem peso não entra como zero; um `operation_id` por lançamento (salvar de novo não baixa duas vezes); `toast.warning`; recusa de data anterior ao último abastecimento; motivo "sem peso" no mapa |
| Migration | Nenhuma; servidor inalterado |
| Próximas etapas | 2 Formulação (pronto × batelada, %PV padrão e por categoria, produção com custo do estoque) · 3 Leitura de cocho (escore, acesso, estrutura) e farol de cocho · 4 Fechamento de consumo em %PV com faixa configurável e custo/cab/dia |
| Relatório | [`MAIKE-SUPLEMENTACAO-BASE-REPORT.md`](./MAIKE-SUPLEMENTACAO-BASE-REPORT.md) |

## Missão anterior (2026-11-14) — MAIKE-ATIVIDADE-CABECALHO (Fatia 2 do Lançamento de Atividades): Atividade como cabeçalho e o apontamento do dia como filho (D-PROD-200)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-200**, pedido do proprietário ("FATIA 2 — O cabeçalho + transformar o apontamento atual em filho dele."), liberada com "Sim, comece a Fatia 2 (Recomendado)" |
| Branch / PR | `feat/atividade-cabecalho`, a partir da `main` `1dd44f0c` (merge da PR #276) |
| Escopo | `Atividade` e `AtividadeApontamento` no lugar do apontamento de linha única e dos itens da D-PROD-193; API `/atividades`; tela "Lançamento de Atividades"; permissões `op-atividades` com as extras de apontamento e de reabrir |
| Migration | `20261114500000_atividade_cabecalho`, **CONTRACT** com conversão (sétima entrada; formato novo do portão). SHA-256 `c288cf47c1bbb1de1b25295ffc57c37185c2ce1060e092eec7088d9d501f1feb`. Repositório 51 → **52**; tabelas 85 → **84** |
| Release | **Aplicada em produção** em 2026-11-14 às 20:25:14 UTC, caminho B, com GO do proprietário; conferência 53 / 0, 84 tabelas |
| Próxima fatia | Fatia 3 (`feat/atividade-itens-produto-maquina`), só quando o proprietário liberar |
| Documentos | [`MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md`](./MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md) · [`MAIKE-ATIVIDADE-CABECALHO-REPORT.md`](./MAIKE-ATIVIDADE-CABECALHO-REPORT.md) |

## Missão ativa (2026-11-14) — MAIKE-PESO-PROJETADO: peso projetado do lote e peso objetivo na Categoria de Manejo (D-PROD-198)

## Missão ativa (2026-11-14) — MAIKE-MUDANCA-CATEGORIA-MANEJO: a Mudança de Categoria mostra e pede a categoria de manejo de destino (D-PROD-199)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-199** |
| Branch / PR | `claude/kind-knuth-tztu1v`, recomeçada da `main` `2b211d7b` (merge da PR #283) e avançada até a `main` `02ea10b5` (PR #284) |
| Escopo | Mudança de Categoria: mostra a categoria de manejo de destino; escolha obrigatória quando há mais de uma; aviso quando não há nenhuma. Cadastro de Categoria de Manejo: aviso de categoria ativa com o mesmo sexo e a mesma faixa |
| Migration | Nenhuma; servidor inalterado |
| Relatório | [`MAIKE-MUDANCA-CATEGORIA-MANEJO-REPORT.md`](./MAIKE-MUDANCA-CATEGORIA-MANEJO-REPORT.md) |

## Missão anterior (2026-11-14) — MAIKE-PESO-PROJETADO: peso projetado do lote e peso objetivo na Categoria de Manejo (D-PROD-198)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-198** |
| Branch / PR | `claude/kind-knuth-tztu1v`, recomeçada da `main` `ab63ee26` (merge da PR #282) e atualizada por merge com a `main` `1dd44f0c` (PR #276, D-PROD-197) |
| Escopo | Peso objetivo opcional na categoria; motor do peso projetado pela curva (base derivada pelo projetado das origens); `projecao_peso` em `GET /rebanho/posicoes`; Detalhes do Lote com projetado, @, GMD, base, objetivo, quando atinge, pesado × previsto e próximos meses |
| Migration | `20261114400000_cadcategoria_peso_objetivo`, **EXPAND** (uma coluna anulável). SHA-256 `d44f8070…3fb1a9`. Repositório e produção: 51 → **52** (depois da `20261114300000_tipo_atividade_defaults`, já aplicada); tabelas iguais |
| Release | **Aplicada em produção** em 2026-11-14 às 19:00:00 UTC, caminho B do [runbook](./MAIKE-PESO-PROJETADO-RUNBOOK-RELEASE.md), com GO escrito do proprietário ("go"); postcheck 52 / 0, coluna `numeric(10,2)` anulável sem default, 10 categorias com o campo vazio, 85 tabelas, advisors de segurança sem achados. Merge da PR #283 depois da aplicação |
| Próxima fatia | Mudança de Categoria entre Categorias de Manejo com a mesma categoria oficial (pasto → confinamento) |
| Relatório | [`MAIKE-PESO-PROJETADO-REPORT.md`](./MAIKE-PESO-PROJETADO-REPORT.md) |

## Missão anterior (2026-11-14) — MAIKE-TIPO-ATIVIDADE-DEFAULTS (Fatia 1 do Lançamento de Atividades): padrões e flags do Tipo de Atividade (D-PROD-197)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-197** (revê a D-PROD-182 só no ponto "TipoAtividade sem flags"), com o pedido do proprietário literal ("TipoAtividade ganha os defaults e as flags. É a base de tudo."; "estas flags são do TIPO DE ATIVIDADE, não do TipoTarefa") |
| Branch / PR | `feat/tipo-atividade-defaults`, a partir da `main` `a65ea468` e atualizada por merge (sem rebase) com a `main` `29052ea7` (PRs #278 e #279, D-PROD-195) e depois com a `main` `ab63ee26` (PRs #281 e #282, D-PROD-196, que levou esta para D-PROD-197). PR **#276**, exclusiva desta fatia |
| Escopo | `TipoAtividade` ganha categoria, centro de custo padrão, centro de resultado padrão, unidade de produção (`UnidadeMedida`), coeficiente padrão e 8 flags; API `/tipos-atividade` com os campos, regras 422 e opções de centros da fazenda; tela em 3 seções; helper puro para a Fatia 2. Apontamento de Atividade de hoje inalterado |
| Migration | `20261114300000_tipo_atividade_defaults`, **CONTRACT** aditiva (sexta entrada fechada). SHA-256 `b65d4f08de5f587cd69b893bcb2626df5cc775e1f4ca5b68fdaac863aab55dbf`; guarda `e15780190baf9494f20535c2e3ced21eb20ea6b8f362eeac0b2477dcf6dab3b0`. Repositório 50 → **51** (a D-PROD-195 da `main` já está aplicada em produção); tabelas não mudam |
| Release | **Aplicada em produção** em 2026-11-14 às 17:05:05 UTC, caminho B do [runbook](./MAIKE-TIPO-ATIVIDADE-DEFAULTS-RUNBOOK-RELEASE.md), com GO escrito do proprietário ("Sim: aplique e faça o merge (Recomendado)"); postcheck `APLICADA E CONFERIDA` (51 / 0). Merge da PR #276 depois da aplicação |
| Constituição | Nota D-PROD-197 no `07`, redigida pelo agente e **aprovada pelo proprietário** junto com o merge (mesma resposta) |
| Próxima fatia | Fatia 2 (`feat/atividade-cabecalho`: Atividade + apontamento como filho), liberada pelo proprietário ("Sim, comece a Fatia 2 (Recomendado)") |
| Documentos | [`MAIKE-TIPO-ATIVIDADE-DEFAULTS-CONTRATO.md`](./MAIKE-TIPO-ATIVIDADE-DEFAULTS-CONTRATO.md) · [`MAIKE-TIPO-ATIVIDADE-DEFAULTS-REPORT.md`](./MAIKE-TIPO-ATIVIDADE-DEFAULTS-REPORT.md) |

## Missão ativa (2026-11-14) — MAIKE-LOTE-SEM-RACA-IDADE: cadastro de lotes sem raça predominante e idade média (D-PROD-196)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-196** |
| Branch / PR | `claude/kind-knuth-tztu1v`, recomeçada da `main` `29052ea7` (merge da PR #279) |
| Escopo | Raça Predominante e Idade Média (meses) saem do formulário, da grade, da porta, da correção da entrada, do mapa e da posição; a aba Geral fica com duas linhas cheias |
| Banco | **Sem migration**: colunas ficam no banco com os valores antigos (84 lotes); a API não lê, não grava e não devolve, e aceita e ignora se um cliente antigo enviar |
| Relatório | [`MAIKE-LOTE-SEM-RACA-IDADE-REPORT.md`](./MAIKE-LOTE-SEM-RACA-IDADE-REPORT.md) |

## Missão anterior (2026-11-14) — MAIKE-APONTAMENTO-ITENS (Fatia D do apontamento): itens de custo (D-PROD-193)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-193**, com as palavras do proprietário literais ("Baixa o estoque (Recomendado)"; "Descrição + valor (Recomendado)") e os pontos D-1…D-9 do contrato registrados como interpretação, reversíveis. Numeração: D-PROD-190 é a PR #269; D-PROD-191 e D-PROD-192 são a PR #271 (a #272 foi mergeada dentro dela); a PR #273 cita a D-PROD-190 e precisa renumerar |
| Branch / PR | `feat/apontamento-itens`, empilhada sobre `feat/apontamento-atividade` (PR #269) e atualizada por merge (sem rebase) com ela em `be322ab8`, que já traz a `main` `00a06096` (PRs #263, #267, #268 e #270). PR **#274** em rascunho, exclusiva desta fatia |
| Escopo | Itens do apontamento CONFIRMADO: **PRODUTO** baixa o estoque pelo motor único (FIFO por lote, custo do lote, estorno exato ao cancelar o item ou o apontamento, origem nova `apontamento_atividade`); **SERVIÇO** e **OUTRO** com descrição livre, quantidade, valor unitário e total calculado, sem estoque nem financeiro. Itens imutáveis (só cancelar); cancelar o apontamento passa a exigir `operation_id` (D-2) e cancela os itens junto; combustível não entra como item (D-8); até 200 itens (D-9). Seção "Itens" no formulário existente, sem componente novo |
| Migration | `20261113800000_apontamento_atividade_item`, **EXPAND** (só as 2 tabelas novas: `ApontamentoAtividadeItem` e `ApontamentoAtividadeItemConsumoLote`). SHA-256 `866dc9944772afb08ee851dd653d62db73dccfa5e152f611f2205c3eb594533c`; DO `7aaa176ccec3645fe0730b5aaedee8882b1a276e3912f3360c8d0d2c1b67f710`. Repositório (com a base nova): 47 → **48** migrations, 83 → **85** tabelas em `public` (68 → **70** de tenant), conferidos num banco limpo migrado. **Aplicada em produção em 2026-11-14 12:51:06 UTC** (caminho B, GO do proprietário, desvio da D-PROD-74), conferida: 48/0, 85 tabelas, RLS, 11 FKs `RESTRICT`, advisors sem alerta |
| Release | **Migration aplicada em produção em 2026-11-14 12:51:06 UTC, antes do merge** ([relatório](./MAIKE-APONTAMENTO-ITENS-REPORT.md) §7): 47 → **48** concluídas, 83 → **85** tabelas. Merge da PR #274 pedido pelo proprietário, que também aprova o texto constitucional da D-PROD-193. A CONTRACT da PR #273 (`20261114100000_cadcurvaganho_mensal`) exige release isolada. Falta: deploy e smoke ([relatório](./MAIKE-APONTAMENTO-ITENS-REPORT.md) §6) |
| Constituição | Parágrafo D-PROD-193 no `00 §1` e nota D-PROD-193 no `07`, redigidos pelo agente; **valem só com a aprovação explícita do proprietário no merge manual** |
| Próxima fatia | Fatia E (abastecimento ligado à atividade), só quando o proprietário liberar |
| Documentos | [`MAIKE-APONTAMENTO-ITENS-CONTRATO.md`](./MAIKE-APONTAMENTO-ITENS-CONTRATO.md) · [`MAIKE-APONTAMENTO-ITENS-REPORT.md`](./MAIKE-APONTAMENTO-ITENS-REPORT.md) |

## Missão anterior (2026-11-13) — MAIKE-APONTAMENTO-ATIVIDADE (Fatia C do apontamento): execução da atividade (D-PROD-190)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-190**, reservada pela `main` para a PR #269 (a especificação dizia D-PROD-184, que a `main` já deu ao Estoque P1-02; a branch usou depois a D-PROD-188, que a `main` deu às Estações na PR #265; a D-PROD-189 é a das Curvas de Ganho, PR #270). A D-PROD-191 é da PR #271 e a **D-PROD-192** fica reservada à Fatia D do apontamento. A PR #273 também cita a D-PROD-190 e precisa renumerar |
| Branch / PR | `feat/apontamento-atividade`, atualizada por merge (sem rebase) com a `main` `776befe` (PR #265, Estações) e depois com a `main` `00a06096`, que já traz as PRs #270 (Curvas de Ganho), #268 (Categoria de Manejo, Fatia D), #267 (só testes) e #263 (Estoque P1-03), todas mergeadas depois da aplicação desta migration. PR **#269**, exclusiva desta fatia |
| Escopo | Model `ApontamentoAtividade`, API `/apontamentos-atividade` (lista, detalhe, criar, editar com `versao`, cancelar; sem DELETE), opções do formulário, tela `op-apontamentos-atividade` abaixo de "Tipos de Atividade", regras R-a…R-l. Centro de resultado escolhido pelo usuário; centro de custo copiado do bem na criação e trocável (snapshot) |
| Migration | `20261113700000_apontamento_atividade`, **EXPAND** (só a tabela nova). SHA-256 `a9735833d64b5ebd50d35b12e6eaaa20e1d70bbad6defc131db1dd50e5fab75e`; DO `5da2c547f176a4c49841f52ce19922b9f7c3150d3b1851cdc8e0554e408f1867`. Nome com data depois da `20261113400000_cadestacoes_cadastro`, da `20261113500000_categoria_manejo_cadcategoria` (PR #268) e da `20261113600000_cadcurvaganho_cadastro`; `migration.sql` intacto. Repositório (com a `main` `00a06096`): 46 → **47** migrations, 82 → **83** tabelas em `public` (68 de tenant), 27 → **28** páginas e 110 → **114** rewrites, conferidos num banco limpo migrado. **Aplicada em produção em 2026-11-13 23:23:18 UTC** (caminho B, GO do proprietário, desvio da D-PROD-74), conferida: 45/0 (produção já tinha a `…600000` da PR #270), 83 tabelas, RLS, 13 FKs `RESTRICT`, advisors sem alerta |
| Release | Migration aplicada antes do merge ([relatório](./MAIKE-APONTAMENTO-ATIVIDADE-REPORT.md) §7). Depois dela, produção recebeu a CONTRACT `…500000` da PR #268 e a `…300000` da PR #263: hoje tem as 47 do repositório. PR #269 **mergeada** em 2026-11-14 (`f4802558`, merge pedido pelo proprietário). Falta: smoke (proprietário) |
| Próximas fatias | Fatia D do apontamento (itens, D-PROD-193, missão ativa acima) e Fatia E (abastecimento ligado à atividade), só quando o proprietário liberar |
| Documentos | [`MAIKE-APONTAMENTO-ATIVIDADE-REPORT.md`](./MAIKE-APONTAMENTO-ATIVIDADE-REPORT.md) |

## Missão concluída (2026-11-14) — MAIKE-ESTOQUE-P1-03: índices M7 EXPAND-ONLY (D-PROD-185)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-185** |
| Branch / PR | `claude/maike-estoque-p1-03-indices`, PR #263. Main integrada: `b46bb184` (R3) |
| Escopo | Migration `20261113300000_estoque_p1_03_indices` (EXPAND; SHA-256 `5d91e751…28565`): LC-2 `OperacaoIdempotente(cliente_id, tipo_operacao, createdAt)` e keyset `MovimentacaoEstoque(cliente_id, empresa_id, data_movimentacao DESC, id DESC)`. R2-2 **não** criado: não há consulta que o use (D-PROD-185 item 2). Repositório: 42 → **43** migrations |
| Release | **Aplicada em produção em 2026-11-14** (caminho B, GO do proprietário): preflight `SEGUIR` com 46, envelope com guardas, postcheck `JA_APLICADA` com 47 e os 2 índices válidos. Merge depois da CI verde. Runbook §7: [`MAIKE-ESTOQUE-P1-03-RUNBOOK-RELEASE.md`](./MAIKE-ESTOQUE-P1-03-RUNBOOK-RELEASE.md) |
| R2-2 | Adiamento **aprovado** pelo proprietário até o slice da consulta de auditoria por produto. M7 parcial: LC-2 e keyset prontos |
| Pendência herdada | I2 da P1-02 (D-PROD-184), decisão do proprietário |
| Situação (2026-11-14) | PR #263 **mergeada** (`00a06096`) |
| Relatório | [`MAIKE-ESTOQUE-P1-03-REPORT.md`](./MAIKE-ESTOQUE-P1-03-REPORT.md) |

## Proposta em revisão (2026-11-11) — MAIKE-ESTOQUE-P1-01-GOVERNANCA: contrato do Estoque P1 e emenda proposta (D-PROD-177, PROPOSTA)

| Campo | Valor |
|---|---|
| Status | **PROPOSTA, aguardando aprovação expressa do proprietário.** Não é missão de implementação e não muda comportamento |
| Decisão | D-PROD-177 registrada como **proposta pendente** (não vigente) |
| Branch / PR | `claude/maike-estoque-p1-01-governanca-proposta`, PR #248 DRAFT só de documentação; criada sobre `74ad3b86` e integrada por merge com a `main` `0ed6ae9c` em 2026-11-13 |
| Escopo | Proposta de emenda (texto para 00 e 07, **sem editá-los**, A10); contrato do Estoque P1 (entrada manual com 3 motivos, deduplicação nos dois sentidos com a Central, implantação só sem histórico, lote do fabricante sem saldo e sem custo, unidades KG/SACO/L sem conversão, sequência de slices) |
| Revisão R2 (2026-11-11) | A pedido do proprietário, a proposta passa a prever **Editar** e **Excluir** a entrada (sem "Cancelar" como ação do usuário). A edição confirmada é uma revisão versionada pelo motor, e a exclusão é lógica, com estorno integral. As duas só valem sem dependência física e sem impacto FIFO. Proposta nova: R-EDICAO-EXCLUSAO; R-IMPL refeita. **Nada disso está implementado** |
| Revisão R3 (2026-11-13) | Correção da auditoria do arquiteto: sequência transacional única com checagem FIFO pelos ids reais; prova de dependência fail-closed; saldo exato do produto; índice único parcial nas linhas vigentes. Continua **proposta**, sem código |
| Código / schema / migration | **Nenhum** |
| Produção | Intocada. Só SELECT de leitura na análise P1-00 |
| Ainda vale | A proibição de entrada avulsa (expansão D-PROD-155 na constituição e nota D-PROD-155 no 07) até a ratificação |
| Merge ≠ ratificação | O merge desta PR **não** aprova a D-PROD-177 nem emenda a constituição. A ratificação exige o texto incorporado em 00/07 e uma nota datada na D-PROD-177 |
| Documentos | [`MAIKE-ESTOQUE-P1-CONTRATO.md`](./MAIKE-ESTOQUE-P1-CONTRATO.md) · [`MAIKE-ESTOQUE-P1-01-PROPOSTA-EMENDA.md`](./MAIKE-ESTOQUE-P1-01-PROPOSTA-EMENDA.md) · [`MAIKE-ESTOQUE-P1-01-REPORT.md`](./MAIKE-ESTOQUE-P1-01-REPORT.md) |

## Missão ativa (2026-11-14) — MAIKE-CADCATEGORIA-CURVA-GANHO: Categoria de Manejo com Curva de Ganho obrigatória (D-PROD-195)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-195** |
| Branch / PR | `claude/kind-knuth-tztu1v`, recomeçada da `main` `a65ea468` (merge da PR #273). PR nova, exclusiva desta missão |
| Escopo | `CADCATEGORIA.curva_ganho_id` obrigatório, da mesma fazenda (FK composta, `RESTRICT`); API e tela da categoria com o campo "Curva de ganho"; opções `GET /categorias-manejo-opcoes/curvas-ganho`; excluir curva em uso → 409 `CURVA_GANHO_EM_USO` |
| Dado prévio | `'CURVA PADRÃO'` (0,100 kg/dia nos 12 meses) cadastrada pelo banco em 2026-11-14 13:40:36 UTC na única fazenda com categorias, a pedido do proprietário ([runbook](./MAIKE-CADCATEGORIA-CURVA-GANHO-RUNBOOK-RELEASE.md) §7) |
| Migration | `20261114200000_cadcategoria_curva_ganho`, **CONTRACT** (liga as 10 categorias à CURVA PADRÃO da fazenda e torna o campo obrigatório). SHA-256 `b509ee754722f5e9f70938f2c17ddbe253734c7c86e0aecb55498a37d44e68fb`; guarda `292d2446…63a8`. Repositório e produção: 49 → **50** migrations; tabelas iguais. **Aplicada em produção em 2026-11-14 14:51:56 UTC** (caminho B, GO escrito do proprietário, desvio da D-PROD-74), conferida: 50/0, coluna `NOT NULL`, 10 categorias na CURVA PADRÃO, FK e índices, advisors sem alerta |
| Release | Aplicação **antes do merge** pelo runbook; merge logo depois da conferência (na janela, criar categoria falha e excluir curva em uso dá 403 em vez de 409; nada se perde) |
| Merge | PR #278 em 2026-11-14 (`890eaff6`); produção com o `release` novo, smoke 401 nas duas rotas |
| Emenda R2 | Fila offline: nenhum item vai ao servidor citando uma criação retida pela política (lote criado offline fica retido junto; edição de registro real vai sem o campo); os demais ids offline seguem como antes; a criação retida some das listas; `criacao: 'somente_online'` no runtime. Só frontend, PR própria |
| Relatório | [`MAIKE-CADCATEGORIA-CURVA-GANHO-REPORT.md`](./MAIKE-CADCATEGORIA-CURVA-GANHO-REPORT.md) |

## Missão anterior (2026-11-14) — MAIKE-CADCURVAGANHO-MENSAL: Curva de Ganho com 12 GMD mensais, sem ligação com as Estações (D-PROD-194)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-194** (revê o "GMD por estação" da D-PROD-189; nasceu como D-PROD-190 e depois D-PROD-191, números que a `main` deu às PRs #269 e #271) |
| Branch / PR | `claude/kind-knuth-tztu1v`, recomeçada da `main` `cf07309c` (merge da PR #270) e integrada por merge com a `main` `810a312a` (PR #268, Fatia D) `565e4a95` (PRs #269, #271 e #263) e `cfa3e7e9` (PR #274). PR #273, exclusiva desta missão |
| Escopo | `"CADCURVAGANHO"` passa de 3 GMD por estação para 12 GMD mensais (`gmd_jan` … `gmd_dez`, kg/dia, -2 a 3). API `/curvas-ganho` com os 12 campos. Tela: 12 meses com o ganho do mês pelos dias reais, atalho "repetir →", ganho no ano, média por dia e gráfico. Estações seguem como cadastro próprio, fora da curva. **Sem vínculo** com categoria ou lote |
| Migration | `20261114100000_cadcurvaganho_mensal`, **CONTRACT** isolada (tabela vazia sai e volta mensal; guarda recusa se houver curva). SHA-256 `a18b2845815a637398ccd8d1e0f9cbcbad1bab8e8b628e988d26cf09c302953c`; guarda `3cd5adc4…0b6d`. Repositório e produção: 48 → **49** migrations; tabelas iguais. **Aplicada em produção em 2026-11-14 13:29:18 UTC** (caminho B, GO escrito do proprietário, desvio da D-PROD-74), conferida: 49/0, 12 colunas mensais, RLS, advisors sem alerta |
| Release | Migration aplicada antes do merge ([runbook](./MAIKE-CADCURVAGANHO-MENSAL-RUNBOOK-RELEASE.md) §7). PR #273 mergeada em `a65ea468` (2026-11-14 13:30 UTC, merge autorizado pelo proprietário); produção conferida: `/health` com `release` = `a65ea468`, `/api/native/curvas-ganho` → 401; `verify:all` local verde (Actions pausado). Planejado: (caminho A com `--contract D-PROD-194`; caminho B só com GO escrito e específico desta migration). Aplicar **fora de pico** (o `DROP TABLE` trava `Cliente` e `Empresa` em `ACCESS EXCLUSIVE` por menos de 1 s). Merge logo depois da conferência: na janela até o deploy, só `/curvas-ganho` dá 500 |
| Relatório | [`MAIKE-CADCURVAGANHO-MENSAL-REPORT.md`](./MAIKE-CADCURVAGANHO-MENSAL-REPORT.md) |

## Missão ativa (2026-11-14) — MAIKE-ICONES-CATEGORIA-DIGITADA: a categoria digitada no cadastro de ícone não é mais apagada (D-PROD-192)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-192** (D-PROD-191 com a PR #271; D-PROD-190 com as PRs #269 e #273; D-PROD-193 com a PR #274; D-PROD-187 com a PR #268; D-PROD-185 com a PR #263) |
| Branch / PR | `claude/fervent-knuth-txff6q`, empilhada sobre `feat/icones-lote-codigo` (`950907fc`), porque as duas alteram `GerenciadorIcones.jsx`. PR **#272**, exclusiva desta correção, mergeada pelo proprietário na `feat/icones-lote-codigo` (`b4b5040e`); chega à `main` com a PR #271 |
| Escopo | No diálogo "Cadastrar Novo Ícone" (Configurações), o Select de categoria só recebe valor que é uma das sugestões, sem diferença de maiúsculas; o texto digitado em "OU DIGITE UMA NOVA CATEGORIA" fica e é salvo em maiúsculas. Causa: o `<select>` nativo oculto do Radix Select 2.3.7 respondia `""` para valor fora das opções, e o `onValueChange` gravava `categoria: ""` |
| Banco | **Sem migration.** Backend e banco intocados |
| Testes | `tests/smoke/gerenciadorIconesCategoriaDigitada.test.jsx` (5 casos): falham antes da correção, passam depois |
| Relatório | [`MAIKE-ICONES-CATEGORIA-DIGITADA-REPORT.md`](./MAIKE-ICONES-CATEGORIA-DIGITADA-REPORT.md) |

## Missão ativa (2026-11-13) — MAIKE-ICONES-LOTE-CODIGO: ícone do lote pelo código, sexo + faixa de idade (D-PROD-191)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-191** (D-PROD-190 com as PRs #269 e #273; D-PROD-193 com a PR #274) |
| Branch / PR | `feat/icones-lote-codigo`, criada de `origin/main` `776befe9`, com a `main` integrada por merge duas vezes: `cf07309c` (PR #270) e `00a06096` (PRs #268, #267 e #263). PR **#271**, exclusiva desta fatia; a PR #272 (D-PROD-192) entrou nesta branch antes |
| Escopo | O ícone do Lote sai do upload (`ConfiguracaoIcone` tipo `Lote`) e vem do código, em `src/assets/icones/lotes/`, pela chave sexo + faixa de idade da Categoria de Manejo. Marcador do mapa pela cascata de 5 níveis (sempre sai figura); subícone dos detalhes e dos formulários de manejo na cor do sexo, nunca misto; prévia local no Formulário de Lote; Configurações sem cadastro de ícone de Lote |
| Banco | **Sem migration.** `ConfiguracaoIcone` intocada; as linhas `tipo_entidade = 'Lote'` ficam órfãs (limpeza CONTRACT com GO próprio, fora desta fatia) |
| Convivência | A PR #268 (D-PROD-187) entrou antes desta e já apagou `IconeOficialLotePreview.jsx`, `catalogoGlobalService.js` e a porta do catálogo. No merge, os conflitos foram os previstos: a linha do campo no `FormularioLote.jsx` (ficou a dica com a prévia local), o `catalogoGlobalLote.test.jsx` (ficou a versão da #268) e os docs comuns |
| Relatório | [`MAIKE-ICONES-LOTE-CODIGO-REPORT.md`](./MAIKE-ICONES-LOTE-CODIGO-REPORT.md) |

## Missão concluída (2026-11-14) — MAIKE-CATEGORIA-MANEJO-CADCATEGORIA (Fatia D): DROP das 15 colunas dormentes e do Ícone oficial, tabela física `CADCATEGORIA` (D-PROD-187)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-187** (inclui a emenda do proprietário de 2026-11-13: o Ícone oficial também sai) |
| Branch / PR | `feat/categoria-manejo-cadcategoria`, base `origin/main` `dba4a8c` (merge da PR #264), integrada por merge com a `main` `776befe` (merge da PR #265, CADESTACOES) e com a `main` `cf07309` (merge da PR #270, CADCURVAGANHO). PR **#268**, exclusiva desta fatia |
| Escopo | Migration CONTRACT que apaga as 15 colunas dormentes e `catalogo_categoria_visual_id` (com a FK e o índice) e renomeia a tabela física `CategoriaManejo` → `CADCATEGORIA` (model Prisma continua `CategoriaManejo`, com `@@map`). O campo "Ícone oficial (catálogo MAK Gestão)" sai do formulário, do service, da porta, do backend (a chave passa a ser aceita e ignorada) e a prévia do ícone sai do Formulário de Lote |
| Migration | `20261113500000_categoria_manejo_cadcategoria`, **CONTRACT** (terceira exceção fechada). SHA-256 `83ca58a07439a1cf4e12671fd5f6b89bf62be2aef7ff64112cca6f1418d37e1c`; guarda `0efa2ef32dd4faf3d2419896521a6a62552f89c1af8d151b6cf1eb2495c3e384`; 23 instruções pinadas. Repositório: 44 → **45** migrations. Produção já tem 44 concluídas (a 43ª aplicada é a CADESTACOES da PR #265 e a 44ª a CADCURVAGANHO da PR #270); esta CONTRACT entra como 45ª, depois da `…600000`, fora da ordem dos nomes; 82 tabelas antes e depois (rename); a tabela de 28 → **12** colunas. `20261113300000` fica livre para a PR #263 |
| Release | **NÃO EXECUTADA.** Sem janela compatível: o código anterior dá `P2021` contra `CADCATEGORIA`, então a release exige **acesso bloqueado** pelo proprietário; caminho B (conector, uma transação) esperado. Depois da aplicação, proibido o *Instant Rollback* para antes do merge desta PR. Runbook com preflight, envelope do caminho B e postcheck |
| Produção | Intocada nesta fatia (nada lido nem escrito) |
| Situação (2026-11-14) | PR #268 **mergeada** (`810a312a`). A migration já está aplicada em produção, depois da `…600000` (PR #270) e da `…700000` (PR #269), fora da ordem dos nomes: o preflight do Estoque P1-03 deu `SEGUIR` com a base de 46, que inclui esta CONTRACT |
| Documentos | [`MAIKE-CATEGORIA-MANEJO-CADCATEGORIA-REPORT.md`](./MAIKE-CATEGORIA-MANEJO-CADCATEGORIA-REPORT.md) · [`MAIKE-CATEGORIA-MANEJO-CADCATEGORIA-RUNBOOK-RELEASE.md`](./MAIKE-CATEGORIA-MANEJO-CADCATEGORIA-RUNBOOK-RELEASE.md) |

## Missão concluída (2026-11-13) — MAIKE-CADCURVAGANHO-CADASTRO: Curvas de Ganho de Peso por estação, tabela `CADCURVAGANHO` (D-PROD-189)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-189** |
| Branch / PR | `claude/kind-knuth-tztu1v`, recomeçada da `main` `776befe9` (merge da PR #265). PR #270, exclusiva desta missão, **mergeada** (`cf07309`) |
| Escopo | Model `CadCurvaGanho` → tabela física `"CADCURVAGANHO"` (`@@map`), por fazenda; GMD (kg/dia) nas Águas, na Transição e na Seca, de -2 a 3; API `/curvas-ganho`; tela `CurvasGanho` (menu Manejo, tela `pec-curvas-ganho`). **Sem vínculo** com categoria, lote ou estação |
| Migration | `20261113600000_cadcurvaganho_cadastro`, **EXPAND** (só a tabela nova). SHA-256 `137f93f26f2f5edd3feeaeae21ff363d2746fbdb93b729efe75935c631e96ac6`. Repositório: 43 → **44** migrations, 81 → **82** tabelas. **Aplicada em produção em 2026-11-13 23:18:10 UTC** (caminho B, GO escrito do proprietário, desvio da D-PROD-74), conferida: 44/0, 82 tabelas, RLS, advisors sem alerta |
| Release | Migration aplicada antes do merge ([runbook](./MAIKE-CADCURVAGANHO-RUNBOOK-RELEASE.md) §7). PR #270 mergeada pelo proprietário em `cf07309c` (2026-11-13 23:26 UTC), depois da CI verde; produção conferida: `/health` com `release` = `cf07309c`, `/api/native/curvas-ganho` → 401. GMD por estação revisto pela D-PROD-190 |
| Relatório | [`MAIKE-CADCURVAGANHO-CADASTRO-REPORT.md`](./MAIKE-CADCURVAGANHO-CADASTRO-REPORT.md) |

## Missão concluída (2026-11-13) — MAIKE-CADESTACOES-CADASTRO: cadastro de Estações da fazenda, tabela `CADESTACOES` (D-PROD-188)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-188** (D-PROD-185 com a PR #263; D-PROD-186 é a Fatia C; D-PROD-187 reservada à Fatia D) |
| Branch / PR | `claude/kind-knuth-tztu1v`, base `origin/main` `af47797`. PR #265, exclusiva desta missão, **mergeada** (`776befe`) |
| Escopo | Model `CadEstacao` → tabela física `"CADESTACOES"` (`@@map`), por fazenda; API `/estacoes`; tela `Estacoes` (menu Manejo, tela `pec-estacoes`); estações ativas da mesma fazenda sem sobreposição. **Sem vínculo** com lote, categoria, curva ou outro cadastro |
| Migration | `20261113400000_cadestacoes_cadastro`, **EXPAND** (só a tabela nova). SHA-256 `5d295863216619103ac9e645229edb9d3ffa25a06774097df3429b5358dc90f7`. Repositório: 42 → **43** migrations, 80 → **81** tabelas. **Aplicada em produção em 2026-11-13 19:48:14 UTC** (caminho B, GO escrito do proprietário, desvio da D-PROD-74), conferida: 43/0, 81 tabelas, RLS, advisors sem alerta |
| Release | Migration aplicada antes do merge ([runbook](./MAIKE-CADESTACOES-RUNBOOK-RELEASE.md) §7). PR #265 mergeada em `776befe9` (2026-11-13, merge autorizado pelo proprietário); produção conferida: `/health` com `release` = `776befe9`, `/api/native/estacoes` → 401 |
| Relatório | [`MAIKE-CADESTACOES-CADASTRO-REPORT.md`](./MAIKE-CADESTACOES-CADASTRO-REPORT.md) |

## Missão concluída (2026-11-13) — MAIKE-CATEGORIA-MANEJO-ENXUGAR (Fatia C): Categoria de Manejo enxuta (D-PROD-186)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-186** |
| Branch / PR | `feat/categoria-manejo-enxugar`, base `origin/main` `73aca4f` (merge da PR #261). PR **#264** **mergeada** (`dba4a8c`) |
| Escopo | Cadastro com Nome, Sigla, Espécie, Sexo e Faixa de idade (+ Ícone oficial, que sai na Fatia D). `raca`, `categoria_oficial`, `ganho_peso_anual_kg` e os 12 `gmd_*` saem do formulário, da grade, do CSV, da porta, do service e da API (aceitos e ignorados no corpo). Categoria oficial do rebanho derivada de sexo + faixa de idade |
| Banco | **Sem migration.** As 15 colunas ficaram dormentes (`@ignore`); `migrate diff` vazio |
| Dados de produção | Em 2026-11-13 as **4** categorias de produção receberam a faixa de idade como dado, com a lista do proprietário: **9-12**, **13-24**, **25-36** e **37+** |
| Próxima fatia | **Fatia D** (D-PROD-187), a missão ativa acima |
| Documentos | [`MAIKE-CATEGORIA-MANEJO-ENXUGAR-REPORT.md`](./MAIKE-CATEGORIA-MANEJO-ENXUGAR-REPORT.md) |

## Missão anterior (2026-11-13) — MAIKE-TIPO-TAREFA-DROP-COLUNAS (Fatia LIMPEZA): DROP das 4 colunas dormentes do TipoTarefa (D-PROD-183)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-183** |
| Branch / PR | `claude/tipo-tarefa-drop-colunas-1aznvv` (o pedido nomeou `feat/tipo-tarefa-drop-colunas`), base `origin/main` `65ad9d7`. PR **#261** mergeada (`73aca4f`) |
| Escopo | Migration CONTRACT que apaga `exige_area`, `pode_ter_produto`, `pode_ter_maquina` e `pode_ter_implemento` de `TipoTarefa`; as 4 linhas `@ignore` saem do `schema.prisma`; entrada fechada em `MIGRATIONS_CONTRACT_APROVADAS`; testes, ensaio local e runbook |
| Migration | `20261113200000_tipo_tarefa_drop_colunas`, **CONTRACT**. SHA-256 `47409bb1a7d371efe89fffba753ae292aec6f95e1ba7845d35dff74371136c17`; guarda `35e1a698b0567bf07f9e99943f7181a3a6ee8b1e03ea2ff423a939e755984878`. Repositório: 41 → **42** migrations; tabelas iguais; `TipoTarefa` 13 → **9** colunas. **Aplicada em produção em 2026-11-13 às 17:45:35 UTC** pelo caminho B (conector), com GO do proprietário: 42/0, `TipoTarefa` com 9 colunas, 0 alertas de segurança. Perdeu-se 1 tipo de tarefa com as 4 flags `true` (1 cliente) |
| Release | Feita. O merge (17:18 UTC) veio antes da aplicação, o que fechou o caminho A; a aplicação foi pelo caminho B, com o registro no runbook §11. Proibido voltar a produção para deploy anterior ao merge `6b85696` (PR #254) |
| Próxima fatia | Fatia C (`ApontamentoAtividade`), só depois desta aplicada e liberada pelo proprietário |
| Situação (2026-11-13) | PR #261 **mergeada** (`73aca4f`). Migration `20261113200000_tipo_tarefa_drop_colunas` **aplicada em produção** em 2026-11-13 17:45:35 UTC pelo caminho B do runbook (conector Supabase, uma transação), com GO do proprietário: impressão `5194f45d42b0` (1 tipo de tarefa com flags, "ARRUMAR CERCA"), backup físico de 2026-11-13 05:51 UTC `COMPLETED`. Postcheck: 42 concluídas / 0 em aberto, checksum `47409bb1…`, `TipoTarefa` com as 9 colunas, RLS ligada, política `maike_backend_all`, sem grant para `anon`/`authenticated` |
| Documentos | [`MAIKE-TIPO-TAREFA-DROP-COLUNAS-REPORT.md`](./MAIKE-TIPO-TAREFA-DROP-COLUNAS-REPORT.md) · [`MAIKE-TIPO-TAREFA-DROP-COLUNAS-RUNBOOK-RELEASE.md`](./MAIKE-TIPO-TAREFA-DROP-COLUNAS-RUNBOOK-RELEASE.md) |

## Missão anterior (2026-11-13) — MAIKE-TIPO-ATIVIDADE-CADASTRO (Fatia B): cadastro de Tipo de Atividade (D-PROD-182)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-182** |
| Branch / PR | `feat/tipo-atividade-cadastro`, empilhada sobre `feat/tipo-tarefa-sem-flags` (Fatia A, PR #254). PR em rascunho com base na Fatia A |
| Escopo | Model, migration, API `/tipos-atividade`, tela `TiposAtividade` (4 campos), menu e permissão `sup-tipos-atividade`, bloqueio da exclusão do grupo e propagação do nome |
| Migration | `20261113100000_tipo_atividade_cadastro`, **EXPAND** (só a tabela nova). SHA-256 `5a0ded9c62f108c818c5796c2fe9d116faaceaf62bc4da6312562ec74d3a724e`. Repositório: 40 → **41** migrations, 79 → **80** tabelas. **Aplicada em produção** e conferida pelo proprietário (informado na abertura da Fatia LIMPEZA, 2026-11-13): 41 migrations, 0 pendentes, RLS e índices iguais aos do `TipoTarefa`, nenhum alerta de segurança |
| Release | Merge da Fatia A, depois desta; em seguida `deploy:migrate` pelo caminho oficial e deploy |
| Relatório | [`MAIKE-TIPO-ATIVIDADE-CADASTRO-REPORT.md`](./MAIKE-TIPO-ATIVIDADE-CADASTRO-REPORT.md) |

## Missão anterior (2026-11-13) — MAIKE-TIPO-TAREFA-SEM-FLAGS (Fatia A): Tipo de Tarefa sem flags de exigência (D-PROD-181)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-181** |
| Branch / PR | `feat/tipo-tarefa-sem-flags`, base `origin/main` `b7e5ab11`. PR em rascunho, exclusiva desta fatia |
| Escopo | Remove `exige_area`, `pode_ter_produto`, `pode_ter_maquina` e `pode_ter_implemento` do cadastro de Tipo de Tarefa: Prisma, backend, porta, formulário e contrato. A API aceita e ignora essas chaves vindas de cliente antigo |
| Migration | **Nenhuma.** As 4 colunas ficam dormentes no banco (`DEFAULT false`). O `DROP COLUMN` é CONTRACT e depende de GO próprio (D-PROD-181 item 4) |
| Próxima fatia | Fatia B (TipoAtividade). Só começa depois da resposta do proprietário |
| Relatório | [`MAIKE-TIPO-TAREFA-SEM-FLAGS-REPORT.md`](./MAIKE-TIPO-TAREFA-SEM-FLAGS-REPORT.md) |

## Missão anterior (2026-11-12) — MAIKE-MAPA-NIVEIS-COCHO-DEPOSITO-UX01: níveis de cocho e depósito no Mapa Geral (D-PROD-178)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-178** (a D-PROD-177 está reservada pela PR #248). Substitui em parte a D-PROD-176 |
| Branch / PR | `claude/new-session-abgn5w`, base `origin/main` `fecbc18c` (merge da PR #249). PR **#250** em rascunho, exclusiva deste slice |
| Escopo | Fonte única (`src/domain/suplementacao/nivelSuplementacao.js`) usada pelo mapa, pelos detalhes, pelo tooltip e pelos alertas de cocho e depósito. Cocho = restante estimado do ciclo, pela taxa %PV gravada no lançamento e pelo dia civil no fuso da fazenda. Depósito = saldo real ÷ limite operacional, com percentual bruto e excesso; o mínimo é só limiar. Estados neutros quando não há estimativa |
| Migration | Nenhuma (só frontend e testes) |
| Release | PR #250 mergeada pelo proprietário em 2026-11-12 |
| Relatório | [`MAIKE-MAPA-NIVEIS-COCHO-DEPOSITO-UX01-REPORT.md`](./MAIKE-MAPA-NIVEIS-COCHO-DEPOSITO-UX01-REPORT.md) |

## Missão anterior (2026-11-11) — UI-FONTES-PREVIA: fontes voltam ao estilo e ao tamanho da prévia escolhida (D-PROD-175)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-175**, pedida pelo proprietário em 2026-11-11: "as fontes estão enormes […] deixe as fontes do tamanho que estava no anterior" e "o estilo e tamanho das fontes eu quero deixe igual está aqui nessa visualização do vercel" (prévia `maike-funzkhxes`, commit `836344f`) |
| Branch / PR | `claude/design-implementation-optimize-7wr2qh`, sobre a `main` com a D-PROD-174 |
| Escopo | Reversão do código da D-PROD-173 e da D-PROD-167: DM Sans e os tamanhos de antes em todo o sistema e no mapa. Medido igual à prévia em Produtos, Lotes, Mapa Geral e Detalhes do Lote (1366 e 390 px). Ficam as telas no motor da D-PROD-169 a D-PROD-174 |
| Migration | Nenhuma |
| Release | Merge e deploy, depois do OK do proprietário nas imagens |
| Relatório | [`UI-FONTES-PREVIA-D175-REPORT.md`](./UI-FONTES-PREVIA-D175-REPORT.md) |

## Missão anterior (2026-11-11) — UI-CADASTRO-MAPA: Cadastro de Áreas, Pontos e Linhas no motor Base1 (D-PROD-174)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-174**, pedida pelo proprietário em 2026-11-11: "Já aproveite e já ajuste também para cadastro de áreas, etc" |
| Branch / PR | `claude/design-implementation-optimize-7wr2qh`, sobre a `main` com a D-PROD-173 |
| Escopo | Cada aba (Áreas, Pontos, Linhas) vira uma tela do motor: barra, faixa, grade e cards, registro. "+ Novo" desenha no mapa; GPS, seleção no mapa, importação, pontos em lote e ações em lote das áreas em "Mais opções"; "Editar no mapa" no registro. Formulário da Área com campos e listas do motor; Ponto e Linha com a lista do motor (`SelectDoMotor`) e travados em leitura. Saem as tabelas antigas |
| Migration | Nenhuma |
| Release | Merge e deploy |
| Relatório | [`UI-CADASTRO-MAPA-D174-REPORT.md`](./UI-CADASTRO-MAPA-D174-REPORT.md) |

## Missão anterior (2026-11-11) — UI-MAPA-TIPOGRAFIA: o Mapa Geral com a tipografia do motor Base1 (D-PROD-173)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-173**, pedida pelo proprietário em 2026-11-11: "ajuste todas as fontes do meu mapa para igual a fonte do motor base 1 […] Detalhes de lote, etc" |
| Branch / PR | `claude/design-implementation-optimize-7wr2qh`, sobre a `main` com a D-PROD-172 |
| Escopo | Detalhes do Lote (tabela de papéis `TIPO`), Filtros e Visualização, manejos e janelas abertos pelo mapa: texto 14 px, apoio 13 px, títulos em Lato 13 px / 600, nada abaixo de 13 px fora as peças do próprio motor. Ficam os rótulos desenhados sobre o mapa e a atribuição. Fora: Cadastro de Áreas, Pontos e Linhas no motor (D-PROD-174) |
| Migration | Nenhuma |
| Release | Merge e deploy |
| Relatório | [`UI-MAPA-TIPOGRAFIA-D173-REPORT.md`](./UI-MAPA-TIPOGRAFIA-D173-REPORT.md) |

## Missão anterior (2026-11-11) — UI-GESTAO-MOTOR: Gestão, Patrimônio e Financeiro no padrão do motor Base1 (D-PROD-172)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-172**, pedida pelo proprietário em 2026-11-11: filtros fora da barra (na faixa do motor), campos, listagem e escolha iguais ao motor em Bens, Abastecimentos e no financeiro. Antes dela, na mesma branch: **D-PROD-171** (PR #243, mergeada em `899df140`), que devolveu os filtros do celular às folhas e deixou só o menu "⋮" da coluna como "Mais opções" |
| Branch / PR | `claude/design-implementation-optimize-7wr2qh`, sobre a `main` `899df140` |
| Escopo | Filtros da tela como pílulas da faixa (Centros, Parceiros, Naturezas, Bens, Abastecimentos, Lançamentos); `CampoSelect` com pesquisa, MAIÚSCULAS e ✕ (sem opção vazia); `SeletorPaginadoGestao` na janela das listas do motor; painel de perfil financeiro no cartão do motor. Fora: Cadastro de Áreas, Pontos e Linhas e fontes do Mapa Geral (próxima missão) |
| Migration | Nenhuma |
| Release | Merge e deploy; nada é gravado de outro jeito |
| Relatório | [`UI-GESTAO-MOTOR-D172-REPORT.md`](./UI-GESTAO-MOTOR-D172-REPORT.md) |

## Missão anterior (2026-11-11) — MAIKE-PATRIMONIO-SIMPLIFICA-02: Produtos aceitos em qualquer unidade, sem Área/Localização, Família fora da tela (D-PROD-169)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-169**, pedida pelo proprietário em 2026-11-11 depois de testar a SIMPLIFICA-01 em produção. Respostas: "Família some", "Tipo de bem + Tipo", "Junta tudo numa PR só". **D-PROD-170**: Patrimônio no modelo do motor Base1 (janelas `B1Janela` e botões do motor), pedido do proprietário antes do merge |
| Branch / PR | `claude/new-session-abgn5w`, base `origin/main` `87e8a5ca` (merge da PR #239), com a `main` da PR #242 (SVG, D-PROD-163) e da PR #240 (motor Base1, D-PROD-164 a D-PROD-168) integrada por merge. Vai junto da PR [#241](https://github.com/maikelimaadm-stack/MAIKE/pull/241), que registra a release da D-PROD-162 |
| Escopo | **Tanque e abastecimento:** Produtos aceitos em L, KG ou SACO; SACO abastece em kg, a unidade de estoque. **Bem:** saem Área e Localização; sai a Família; a lista fixa "Tipo de bem" (natureza) vem com o "Tipo" do usuário, com "+ Novo tipo" e "Gerenciar tipos" (listar, renomear, excluir; tipo em uso → 409 `PATRIMONIO_TIPO_EM_USO`). **Catálogo:** garantido automaticamente, com a família padrão `OUTROS` |
| Migration | Nenhuma |
| Release | Merge e deploy; não há escrita no banco |
| Relatório | [`MAIKE-PATRIMONIO-SIMPLIFICA-02-REPORT.md`](./MAIKE-PATRIMONIO-SIMPLIFICA-02-REPORT.md) |

## Missão anterior (2026-11-10) — MAIKE-PATRIMONIO-SIMPLIFICA-01: o Patrimônio recomeça do zero, simplificado (D-PROD-162)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-162**, decidida pelo proprietário em 2026-11-10: Litros no Produto (D1-A), Produtos aceitos por tanque (D2-A), medições e perfis removidos (D4-B), Patrimônio do zero (D8-B), Famílias e Tipos dentro de Bens, menu só com Bens e Abastecimentos, sem tipo de combustível e sem fator kg/L. Padrões P-01…P-12 do contrato registrados na decisão. Supera em parte a D-PROD-157 e a D-PROD-159 e quase toda a D-PROD-160. Exceção CONTRACT única à D-PROD-72 item 3 e à D-PROD-107 R7. Emendas **propostas** em [`00-CONSTITUICAO.md`](../constitution/00-CONSTITUICAO.md) §1 e em [`07-DO-NOT-DO.md`](../constitution/07-DO-NOT-DO.md) (notas D-PROD-157 e D-PROD-159); valem só com a aprovação explícita do proprietário no merge |
| Branch / PR | `claude/new-session-abgn5w`, base `origin/main` `e39d318b` (merge da PR #237, UX-02), com a `main` `e8472481` (PR #238, Estoque P0-01, D-PROD-161) integrada por merge · schema e migration no commit `8442e9f5` · PR **draft**; número, HEAD final e CI registrados no relatório |
| Escopo | **Bens:** Família e Tipo escolhidos e criados no próprio formulário ("+ Nova família", "+ Novo tipo"), "⋯ › Gerenciar famílias e tipos" e "Instalar catálogo padrão" (só administrador); cada tanque com "Produtos aceitos" do estoque (L ou KG, até 20). **Abastecimentos:** Máquina/Veículo → Produto → Tanque (só com mais de um) → Local → quantidade na unidade do Produto → medidor → "Completou o tanque?" → revisar → confirmar; o estoque baixa **exatamente** a quantidade digitada, sem conversão; capacidade conferida só para Produto em L; consumo km/L, L/h, km/kg ou kg/h. **Produto e Gestão P3:** unidade "LITROS (L)"; KG e SACO byte a byte como antes. **Mapa Geral:** depósito soma só Produtos em kg (P-11). **Saem:** as páginas `FamiliasPatrimoniais`, `TiposPatrimoniais`, `PerfisMedicao` e `Combustiveis`, perfis de medição, medições de benfeitoria, tipos de combustível, vínculo combustível × produto, fator kg/L e a ação `configurar_conversao`. **Fora:** manutenção, OS, custo/hora, saldo de tanque, unidade que não seja L nem KG |
| Backend | Rotas removidas respondem 404; Abastecimentos 16 → **11** rotas; nova `GET /bens-patrimoniais-opcoes/produtos`; famílias e tipos guardados pela tela de Bens ([cobertura](./MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md)). Idempotência v2 do abastecimento (recibo v1 nunca reaproveitado) |
| Migration | `20261110300000_patrimonio_simplifica`, **CONTRACT** (exceção única): guarda fail-closed (0 abastecimento CONFIRMADO, impressão das contagens aprovada, papel dono das 13, nada criado fora das migrations), **apaga as 13 tabelas do Patrimônio** com os dados de todos os clientes, alarga 2 CHECKs de `OperacaoFinanceiraItem` para aceitar `'L'` e cria 7 tabelas no formato novo (inclusive `TanqueBemProduto`). SHA-256 `787d6d118939c6eca4e3c3f45bf94a4f94d1f1625cbfb2ea2102b190ad944222`. Repositório: 39 → **40** migrations, 85 → **79** tabelas. `deploy:migrate` remoto só aplica com `MIGRATION_CONTRACT_AUTORIZADO=D-PROD-162`, que só o `premerge-migrate --aplicar --contract D-PROD-162` define. **Aplicada em produção em 2026-11-11** (ver `MAIKE-PATRIMONIO-SIMPLIFICA-01-REPORT.md`) |
| Release | Migration **antes** do merge, pelo runbook [`MAIKE-PATRIMONIO-SIMPLIFICA-01-RUNBOOK-RELEASE.md`](./MAIKE-PATRIMONIO-SIMPLIFICA-01-RUNBOOK-RELEASE.md), **executado em 2026-11-11** (caminho B; PR #239 mergeada em `87e8a5ca`; deploy READY; postcheck R1–R9 e C1–C4 ok; registro no §11 do runbook). Entre o `COMMIT` e o deploy READY o runtime antigo responde 500 no Patrimônio e em 3 rotas de produto/empresa: merge imediato, `main` congelada, horário de pouco uso. Dado apagado só volta pelo backup do banco inteiro; reversão de schema só até a primeira escrita (P-12) |
| GO do proprietário | Escrito em 2026-11-10 para a limpeza em produção: "pode apaguar oque tiver lançado dessas tabelas", "olha pode fazer não precisa pedir confirmação ok, pode fazer", "ok apague oque tiver faça oque tem que fazer". Alcance e limites na D-PROD-162: as barreiras técnicas fail-closed continuam valendo |
| Relatório | [`MAIKE-PATRIMONIO-SIMPLIFICA-01-REPORT.md`](./MAIKE-PATRIMONIO-SIMPLIFICA-01-REPORT.md) |
| Antes dela | Estoque P0-01 (D-PROD-161): PR #238 mergeada na `main` (`e8472481`, 2026-11-11 00:27:25 UTC), sem migration. Antes, UX-02 (D-PROD-160): PR #237 mergeada (`e39d318b`, 2026-11-10 19:51:48 UTC), sem migration. Produção: 39 migrations, 85 tabelas |

## Missão anterior (2026-11-10) — MAIKE-ESTOQUE-P0-01: motor físico único, ENTRADA ≠ MOVIMENTAÇÃO (D-PROD-161)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-161** (a D-PROD-160 é a da PR #237, já mergeada), autorizada pelo proprietário na missão (2026-11-10) |
| Branch / PR | `claude/maike-estoque-p0-motor-unico-01`, base `origin/main` `e3ea4c39` (PRs #232, #234 e #235 mergeadas), com a `main` integrada por merge · PR [#238](https://github.com/maikelimaadm-stack/MAIKE/pull/238) **mergeada** na `main` (`e8472481`, 2026-11-11 00:27:25 UTC; registrado pela SIMPLIFICA-01) |
| Escopo | Um único motor físico (`estoqueFisicoMotor.js`): suplementação e transferência entre locais migradas para o FIFO Decimal com CAS (o segundo FIFO em `Number`, `fifoEstoque.js`, foi apagado; corrigido o lote de destino com ano 2001); Cadastro de Produtos sem efeito de estoque (`estoque_atual` é cache derivado: POST só 0, PATCH só o valor atual sem efeito, troca de empresa e DELETE bloqueados com estoque, CSV sem estoque, aviso no formulário); escritas genéricas fechadas (`POST /movimentacoes-estoque`, `POST`/`DELETE /estoque-lotes-nota` e `PATCH` de lote fora da renomeação → 409 `ESTOQUE_ESCRITA_DIRETA_RECUSADA`); reconciliação somente leitura `GET /estoque-fisico/reconciliacao` (só administrador real). A reconciliação tem orçamento por chamada, páginas por chave de produto (órfãos incluídos) e exclusões legadas como fase própria. O cursor é HMAC amarrado ao tenant e ao escopo, e a conclusão global só é COMPROVADA num snapshot único. Bloqueios R2-1/2/3 ficam registrados para a P1. No fechamento R2 também entraram as máscaras do Cadastro de Produtos (o valor exibido agora é o gravado) e a folha "Local de Destino" do celular dentro do diálogo certo. Nenhuma tela nova |
| Migration | **Nenhuma (zero DDL)**: `git diff origin/main -- backend/prisma` vazio. `SCHEMA_APPLIED_PROD = N/A` |
| Produção (só leitura) | Preflight 2026-11-10 15:50 UTC: 39/39 migrations, 0 produto com cache divergente, 0 lote fora de faixa/situação, 0 lote de transferência com ano 2001, 0 saldo sem fato, 0 número provisório, 0 movimento fora do protocolo (2 produtos, 2 lotes, 3 movimentos, 1 local). Nada foi corrigido nem escrito |
| Release | Sem migration: o merge manual do proprietário publica o código. Nada a aplicar no banco |
| Testes / CI | Pós-merge da `main` (`6da66a55`), em PG17 local novo: `verify:all` integral PASS; backend 1593/1598 (0 fail, 5 todo); testes de tela 2353/2353; gates 716/716. E2E reais nos pools 3 e 5, sem 5xx: estoque 8/8 em 1280/390/412, Central Financeira 68/68, Patrimônio 27/27, UX-02 25/25. CI `quality` verde ([run 42917240485](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/42917240485)). Detalhes no relatório §11 |
| Relatório | [`MAIKE-ESTOQUE-P0-01-REPORT.md`](./MAIKE-ESTOQUE-P0-01-REPORT.md) |
| Antes dela | Patrimônio UX-02 (D-PROD-160): PR #237 mergeada na `main` (`e39d318b`), sem migration |

## Missão anterior (2026-11-10) — MAIKE-PATRIMONIO-UX-02: abastecimento orientado pelo Produto associado ao combustível (D-PROD-160)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-160**, autorizada pelo proprietário na missão (2026-11-10). Refina só a UX e a leitura de elegibilidade da D-PROD-159; nenhuma decisão anterior é reescrita. **Superada quase inteira pela D-PROD-162** |
| Branch / PR | `claude/maike-patrimonio-ux-02-abastecimento-produto`, base `origin/main` `e3ea4c39` (merge da PR #235) · PR [#237](https://github.com/maikelimaadm-stack/MAIKE/pull/237) **mergeada** na `main` (`e39d318b`, 2026-11-10 19:51:48 UTC; registrado pela SIMPLIFICA-01) · HEAD final e CI registrados no relatório |
| Escopo | **Combustíveis:** seção "Produtos associados nesta fazenda" no cadastro e na edição (Associados, Inativos, Disponíveis; vários de uma vez; o combustível novo já sai com os Produtos, com resultado explícito e repetição só do que falhou). **Novo abastecimento:** Máquina/Veículo → **Produto** (o nome real; o tipo de combustível sai do fluxo) → tanque só se houver mais de um → local automático com um só saldo → litros, medidor, "Completou o tanque?" → "Revisar abastecimento" → confirmar. Lista com Data, Máquina/Veículo, Produto, Litros, Medidor e Situação. Trocar o Produto associado vale para os próximos abastecimentos, sem editar o bem e sem reescrever o histórico. **Fora:** schema, migration, FIFO, custo, medidor, estorno, RLS, concorrência, APIs mutativas, `TanquesBem.jsx`, mapas e financeiro |
| Backend | Só uma rota nova, **de leitura**: `GET /patrimonio-abastecimentos-opcoes/produtos-do-bem` (A16, guarda `pat-abastecimentos` `visualizar`, instantâneo RepeatableRead só leitura, resumo do conjunto inteiro). As 16 rotas da tela continuam classe **a** ([cobertura](./MAIKE-PERMISSOES-R2-COBERTURA-ENDPOINTS.md)). Os corpos de prévia, confirmação, cancelamento, vínculo e fator não mudam |
| Migration | **Nenhuma.** `schema.prisma` e migrations intocados; repositório e produção continuam com 39 migrations e 85 tabelas |
| Release | Sem migration. Mergeada pelo proprietário (`e39d318b`); deploy e smoke de produção não foram conferidos pela SIMPLIFICA-01 |
| Relatório | [`MAIKE-PATRIMONIO-UX-02-ABASTECIMENTO-PRODUTO-REPORT.md`](./MAIKE-PATRIMONIO-UX-02-ABASTECIMENTO-PRODUTO-REPORT.md) |
| Antes dela | P1-02 (D-PROD-159): migration aplicada em produção (2026-11-10, 13:18:33 UTC) e PR #235 mergeada (`e3ea4c39`, 13:41:02 UTC) |

## Missão anterior (2026-11-10) — MAIKE-PATRIMONIO-P1-02: abastecimentos e consumo de combustível da frota (D-PROD-159)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-159**, autorizada pelo proprietário na missão (2026-11-10). Constituição: nota de expansão em [`00-CONSTITUICAO.md`](../constitution/00-CONSTITUICAO.md) e em [`07-DO-NOT-DO.md`](../constitution/07-DO-NOT-DO.md) |
| Branch / PR | `claude/maike-patrimonio-p1-02-abastecimentos`, base `origin/main` `a2347741` (PRs #232 e #234 mergeadas) · PR [#235](https://github.com/maikelimaadm-stack/MAIKE/pull/235) **mergeada** na `main` (`e3ea4c39`, 2026-11-10 13:41:02 UTC; registrado pela UX-02) · código final `6dd34014` |
| Escopo | Página nativa **Abastecimentos** (`pat-abastecimentos`) no grupo Patrimônio e Frota: fator kg/L por fazenda × combustível × produto, informado pelo responsável e versionado; prévia sem escrita; confirmação transacional com baixa **física real em KG** pelo motor de estoque (FIFO por lote, custo FIFO final, origem `abastecimento_patrimonio`, nenhum lançamento financeiro); idempotência por `operation_id`; cancelamento com estorno exato das fatias; leitura do medidor no próprio abastecimento (série monotônica, sem gravar o bem); consumo km/L ou L/h pelo tanque cheio declarado. Permissões negadas por padrão (`visualizar`, `novo`/`salvar`, `cancelar`, `configurar_conversao`). **Fora:** manutenção, OS, compras, financeiro, custo/hora, depreciação apurada, transferência, mapas, dashboards, saldo de tanque |
| Migration | `20261110200000_patrimonio_p1_02_abastecimentos`, expand-only: 3 tabelas novas (`ConversaoCombustivelProduto`, `AbastecimentoBem`, `AbastecimentoBemConsumoLote`), nenhum DDL em tabela antiga. SHA-256 `20f8f9609a8e09f123dac0ed7ba87747069b26ad07411e843481ffec59b15fba`, hash do DO `ac1d201b0ef75b629d018b8c3c98354eb9453d752ab5e62ee4c3edb23c14bddd`, pinados. Repositório: 39 migrations, 85 tabelas. **Aplicada em produção em 2026-11-10 às 13:18:33 UTC** com GO expresso do proprietário, caminho B; postcheck completo no §11 do runbook (`SCHEMA_APPLIED_PRODUCTION: SIM`). Produção: 39 migrations, 85 tabelas |
| Release | **Concluído na ordem certa:** migration aplicada (acima) e, depois dela, merge manual da PR #235 (`e3ea4c39`; registrado pela UX-02). Deploy e smoke de produção não foram conferidos pela UX-02. A migration precisava vir **antes** do merge (o runtime novo sem as tabelas daria 500 também em `GET`/`PATCH /bens-patrimoniais/:id`, `PATCH`/`DELETE /estoque-lotes-nota/:id` e `DELETE /empresas/:id`). Runbook com preflight, aplicação, postcheck e rollback de schema vazio: [`MAIKE-PATRIMONIO-P1-02-RUNBOOK-RELEASE.md`](./MAIKE-PATRIMONIO-P1-02-RUNBOOK-RELEASE.md) |
| Testes / CI | `verify:all` 39/39 PASS em `6dd34014` (1157 s) · CI run [42761888698](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/42761888698) verde em `6dd34014` (18 min 31 s) · contagens no relatório §15 |
| Relatório | [`MAIKE-PATRIMONIO-P1-02-ABASTECIMENTOS-REPORT.md`](./MAIKE-PATRIMONIO-P1-02-ABASTECIMENTOS-REPORT.md) |
| Antes dela | P1-01 (D-PROD-157): PR #232 mergeada (`76edc913`) e migration aplicada em produção (2026-11-09, 23:04:22 UTC). P3-03 (D-PROD-158): migration aplicada (21:32:01 UTC) e PR #234 mergeada (`a2347741`). Produção: 38 migrations |

## Missão anterior (2026-11-09) — MAIKE-GESTAO-P3-03: editar, excluir e duplicar lançamentos (D-PROD-158)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-158** (nasceu como D-PROD-157; renumerada ao integrar a `main` `76edc913`, onde a D-PROD-157 é o Patrimônio P1-01). O comentário dentro do `migration.sql` da P3-03, já aplicado em produção, ainda diz D-PROD-157 e fica imutável (checksum) |
| Branch / PR | `claude/maike-gestao-p3-03-editar-excluir-duplicar`, PR #234 **mergeada** na `main` (`a2347741`; registrado pela P1-02), depois de integrada com a `origin/main` `76edc913` (PR #232, Patrimônio) por merge não destrutivo |
| Escopo | Na tela `LancamentosFinanceiros`: **Editar** documento confirmado por retificação (no lugar, quando a assinatura física não muda; por substituição, com estorno e documento novo de mesmo número, quando muda); **Excluir** confirmado de forma lógica (estorno, `excluido_em`, evento); **Duplicar** como rascunho novo. Bloqueios por liquidação, consumo de lote e movimento posterior. Histórico em `OperacaoFinanceiraEvento` e AuditLog |
| Migration | `20261109300000_gestao_p3_03_editar_excluir`, expand-only: colunas anuláveis `OperacaoFinanceira.excluido_em` e `.retificado_em` e tabela nova `OperacaoFinanceiraEvento`. SHA-256 `3f3af00e…df890b`. **Aplicada em produção em 2026-11-09 às 21:32:01 UTC** (caminho B, GO escrito), 37 migrations, conferida pelo §6 do runbook |
| Release | **Concluído:** GO, preflight, backup comprovado (PITR desligado), ensaio local, migration, conferência e merge manual da PR #234 (`a2347741`). Deploy e smoke não foram conferidos pela P1-02. Runbook com o §11 preenchido: [`MAIKE-GESTAO-P3-03-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-03-RUNBOOK-RELEASE.md) |
| Relatório | [`MAIKE-GESTAO-P3-03-EDITAR-EXCLUIR-DUPLICAR-REPORT.md`](./MAIKE-GESTAO-P3-03-EDITAR-EXCLUIR-DUPLICAR-REPORT.md) |
| Antes dela | P3-02 (D-PROD-156) em produção: migration aplicada em 2026-11-09 às 17:42:13 UTC e PR #231 mergeada (`e4e907ea`) |

## Missão anterior (2026-11-09) — MAIKE-PATRIMONIO-P1-01: cadastros patrimoniais, frota e parâmetros operacionais (D-PROD-157)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-157** (nasceu como D-PROD-156; renumerada ao integrar a `main`, onde a D-PROD-156 é a Gestão P3-02), autorizada pelo proprietário na missão (2026-11-09). Constituição: nota de expansão em [`00-CONSTITUICAO.md`](../constitution/00-CONSTITUICAO.md) |
| Branch / PR | `claude/maike-patrimonio-p1-01-cadastros-inventario` · PR #232 **mergeada** na `main` (`76edc913`) |
| Escopo | Grupo de menu **Patrimônio e Frota** com 5 telas nativas (`BensPatrimoniais`, `FamiliasPatrimoniais`, `TiposPatrimoniais`, `PerfisMedicao`, `Combustiveis`): bens por fazenda com código patrimonial e código de frota, medições físicas, medidor de uso, tanques com combustíveis permitidos, aquisição e depreciação com prévia só simulada. **R2:** vínculo combustível × produto por empresa na tela Combustíveis e contrato só de leitura dos produtos elegíveis de um bem (para a P1-02). **Fora:** abastecimento, manutenção, financeiro, estoque, apuração de depreciação e transferência |
| Migration | `20261110100000_patrimonio_p1_01_cadastros` (expand-only, 10 tabelas novas, nenhum DDL em tabela antiga; nunca aplicada em ambiente remoto, por isso ampliada na R2 com `TipoCombustivelProduto`). SHA-256 final `b8818ba8f16528580b7ba6053b0c89f07f0d4fd434955f4b9c5830a62ffd64dc`, hash do DO `01dbf9ae4875444fa77082d37e1b71da655f217ecc25cc95a4d1b8a4a108a0a3` (os da R1 são inválidos). Com a `main`: 37 migrations, 81 tabelas. **Não aplicada em produção** |
| Release | **Incidente de sequência:** a PR #232 foi mergeada (`76edc913`, deploy às ~21:41 UTC) **antes** de a migration `20261110100000_patrimonio_p1_01_cadastros` ser aplicada. Às 22:30 UTC (só leitura) a migration não estava aplicada e os domínios de produção serviam o deploy anterior `afbebcbc`. **Depois, por outro fluxo:** migration aplicada em 2026-11-09 às 23:04:22 UTC (checksum `b8818ba8…ffd64dc`, `applied_steps_count = 1`). A produção ficou com 38 concluídas e 0 com falha, 82 tabelas, as 10 do Patrimônio vazias, com RLS sem FORCE e 0 grants públicos, e o advisor com 0 alertas (conferido por esta PR, só leitura, às 23:19 UTC). Os domínios continuavam em `afbebcbc`. Runbook: [`MAIKE-PATRIMONIO-P1-01-RUNBOOK-RELEASE.md`](./MAIKE-PATRIMONIO-P1-01-RUNBOOK-RELEASE.md) |
| Relatório | [`MAIKE-PATRIMONIO-P1-01-REPORT.md`](./MAIKE-PATRIMONIO-P1-01-REPORT.md) |
| Antes dela | Gestão P3-02, rateio por item (D-PROD-156): mergeada na `main` pela PR #231 (`e4e907ea`), migration aplicada em produção; P3-01 (D-PROD-155) idem pela PR #230 |

## Missão anterior (2026-11-09) — MAIKE-GESTAO-P3-02: rateio gerencial por item (D-PROD-156)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-156**, autorizada pelo proprietário na missão de 2026-11-09, depois do merge da P3-01 |
| Branch / PR | `claude/maike-gestao-p3-02-rateio-por-item`, PR #231 **mergeada** pelo proprietário (`e4e907ea`) |
| Escopo | Na mesma tela `LancamentosFinanceiros` e só com produtos, o rateio pode ser Geral (padrão) ou Por item. Por item, cada linha é dividida por natureza e centros, em valor ou percentual, sobre o **líquido** do item. A soma é exata por item e no total, os dois modos nunca convivem e existe um resumo consolidado. Não há efeito novo em títulos, estoque ou custo |
| Migration | `20261109200000_gestao_p3_02_rateio_por_item`, expand-only: coluna anulável `OperacaoFinanceira.rateio_escopo` e tabela nova `OperacaoFinanceiraItemRateio`. SHA-256 `df4d1ab2…2076f4a0` pinado. **Aplicada em produção em 2026-11-09 às 17:42:13 UTC** (caminho B, GO escrito) e conferida pelo §6 do runbook |
| Release | **Concluído:** GO, preflight, ensaio local, migration (36 concluídas), conferência e merge manual da PR #231 (`e4e907ea`), com deploy em produção. Runbook com o §11 preenchido: [`MAIKE-GESTAO-P3-02-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-02-RUNBOOK-RELEASE.md) |
| Relatório | [`MAIKE-GESTAO-P3-02-RATEIO-POR-ITEM-REPORT.md`](./MAIKE-GESTAO-P3-02-RATEIO-POR-ITEM-REPORT.md) |
| Antes dela | P3-01 (D-PROD-155) em produção: migration aplicada em 2026-11-09 às 14:08:36 UTC e PR #230 mergeada (`f2b81e1b`) |

## Missão anterior (2026-11-09, rodada 4) — MAIKE-GESTAO-P3-01: Central Única de Lançamentos (D-PROD-155)

| Campo | Valor |
|---|---|
| Decisão | **D-PROD-155**, autorizada pelo proprietário na missão (2026-11-08). Constituição: nota de expansão em [`00-CONSTITUICAO.md`](../constitution/00-CONSTITUICAO.md) |
| Branch / PR | `claude/maike-gestao-p3-01-lancamento-unico` · PR #230, **mergeada** pelo proprietário (`f2b81e1b`) |
| Escopo | Página nativa `LancamentosFinanceiros` (tela `ges-lancamentos-financeiros`): documento PAGAR/RECEBER com ou sem produtos, rateio global, títulos/parcelas, liquidação manual e efeito de estoque só na confirmação (estorno no cancelamento), por comando composto. **Fora:** conciliação, bancos/OFX, DRE, plano de contas, fiscal, câmbio, contabilidade, caixa/bancos, rateio por item, pedido de compra, relatórios/dashboards |
| Migration | `20261109100000_gestao_p3_01_central_lancamentos` (8 tabelas novas, expand-only). SHA-256 `bb89f4e0…4a451dc18a` (rodada 4), DO `0289125d…ab4fe`, pinados. **Aplicada em produção em 2026-11-09 às 14:08:36 UTC** (caminho B, GO escrito do proprietário), conferida pelo runbook §6 |
| Custo (rodada 4) | Custo de aquisição **líquido**: desconto e acréscimo do cabeçalho rateados entre as linhas pelos maiores restos; lote = líquido ÷ kg (4 casas), movimento = líquido exato; resíduo explícito fora do FIFO, recusado acima de 0,1% da linha, nunca menos que 1 unidade mínima da moeda (`custo_kg_nao_representavel`) |
| Vercel | `vercel.json` fixa `maxDuration` 60 s para `api/fastify.js`; vale no deploy de produção depois do merge (não comprovado em produção) |
| Release | **Concluída:** GO, preflight, backup diário comprovado (PITR desligado), migration (35 concluídas), conferência, merge manual da PR #230 (`f2b81e1b`) e deploy de produção `dpl_2oFTcopkiQv1YqQD9sv282zdy7q4` READY. Smoke só leitura feito: health 200, rota 200, API anônima 401, só o FSTDEP023 preexistente nos logs. Pendente: Max Duration de 60 s no painel da Vercel. Runbook, com o §11 preenchido: [`MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md) |
| Relatório | [`MAIKE-GESTAO-P3-01-LANCAMENTO-UNICO-REPORT.md`](./MAIKE-GESTAO-P3-01-LANCAMENTO-UNICO-REPORT.md) |
| Antes dela | Gestão P1 (D-PROD-146) e P2 (D-PROD-153): cadastros de Parceiros, Centros e Naturezas, sem lançamento |

---

## Backend, migrations e deploy

| Campo | Valor |
|---|---|
| Plano operacional | `docs/engineering/PLAN-BACKEND-MIGRACAO-100.md` |
| Migrations no repositório | **18** (`backend/prisma/migrations/`) — até `20261028240000_p8_supabase_public_revoke_rls` |
| Models Prisma (domínio + fundação) | Fundação P3 + mapa P4 + cadastros/manejo P5.x + hygiene P6.1 (schema completo pós-P5.5) |
| Runner de produção | `npm run deploy:migrate` — variável **`MIGRATION_DATABASE_URL`** (sem fallback para `DATABASE_URL`) |
| Banco local | `npm run db:up` (Docker `postgres:16.13-alpine`) + `npm run prisma:deploy` |
| Testes backend | `npm run test:backend` — **142** testes; falha dura sem `DATABASE_URL`. Rodada integrada da D-PROD-137 (HEAD `1e2b9fc5`, `node --test`): **998** testes, 993 passam, 0 falhas, 5 `todo` |
| Monólito Vercel | `api/fastify.js` + `vercel.json` reescreve **todas** as rotas nativas para `/api/fastify` (correção 2026-10-27) |
| Supabase (MAIKE) | **18/18** `_prisma_migrations` (P8 D-PROD-56 aplicado 2026-10-28: RLS 40/40, grants anon/authenticated zerados; ver `P8-SUPABASE-PUBLIC-GRANTS-RLS-REPORT.md`) |
| Deploy | Monólito Vercel + Supabase; `npm run deploy:migrate` no pipeline quando `MIGRATION_DATABASE_URL` definida |
| Certificação agente 2026-10-27 (pós-P7) | `/health` **200**; rotas `/marcas`, `/empresas`, `/lancamentos-tarefa` **401** sem JWT; Vercel MCP enxerga projeto `maike`; login autenticado não repetido (senha fora do repo) |

Checklist operacional de go-live: [`PRODUCAO-GO-LIVE-CHECKLIST.md`](./PRODUCAO-GO-LIVE-CHECKLIST.md).

Variáveis críticas: `DATABASE_URL`, `MIGRATION_DATABASE_URL` (pre-deploy), `AUTH_SECRET`,
`FRONTEND_ORIGINS`, `VITE_MAIKE_API_URL` (build frontend). Detalhes em `.env.example`.

---

## Migração Base44 × banco — auditoria 2026-10-27

**Não falta migração de entidades nem DDL pendente** para o escopo do produto.

| Verificação | Resultado |
|---|---|
| `allowedBase44Entities` (35) × models Prisma | **100%** — `User` → `Usuario`; zero entidade do manifesto sem tabela |
| Migrations repo × Supabase `_prisma_migrations` | **14/14** |
| Runtime `src/` → Base44 como provider de dados | **Ausente** — registry vazio; APIs nativas |
| Próximo trabalho de plataforma | **P8** (RLS se PostgREST, observabilidade, release) — não schema |

Telas vazias ou poucos registros (ex.: lotes, produtos) são **conteúdo operacional**
(bootstrap de tenant via `npm run auth:bootstrap:local`; empresa e cadastros pela UI
`/Empresa` e demais rotas), não lacuna de migração. Relatório completo:
[`GAP-AUDIT-POS-BASE44-2026-10-27.md`](./GAP-AUDIT-POS-BASE44-2026-10-27.md).

Arquivos `base44/entities/*.jsonc` e entradas no manifesto são **spec legada** —
não implicam que o app ainda persista na Base44.

---

## Cadastros — o que funciona hoje

**Matriz operacional (menu, rota, backend nativo vs Base44, UI, produção):**
[`CADASTROS-E-MODULOS-STATUS.md`](./CADASTROS-E-MODULOS-STATUS.md).

Resumo: **todas as telas do escopo** persistem no PostgreSQL via APIs nativas (`src/apis/*` → monólito Vercel). **Base44** permanece só como schemas JSONC de referência (`base44/entities`) — sem SDK nem provider de dados (P5.5 + P7). Não há tela de **Cliente** (tenant) — só bootstrap. Áreas não têm menu próprio: use **Mapa Geral** / **Cadastro do Mapa**. Matriz detalhada: [`CADASTROS-E-MODULOS-STATUS.md`](./CADASTROS-E-MODULOS-STATUS.md).

---

## Programa UX Base1 (cadastros)

| Campo | Valor |
|---|---|
| Plano | `docs/engineering/PLAN-EXECUCAO-PARIDADE-BASE1.md` |
| Piloto único | **Marcas** — checklist `docs/engineering/MARCAS-MODELO-BASE1-CHECKLIST.md` |
| Rollout demais cadastros | **Pausado** até aceite proprietário (**H.5**) — **D-PROD-41** |
| Gate §H (checklist modelo) | **H.1–H.4, H.6** DONE; **H.5** TODO (produto) — ver `MARCAS-MODELO-BASE1-CHECKLIST.md` |
| Merges UX Base1 (2026-10-26) | #51–#58 · **#59** `eb3866ee` · **#60** `d05304d4` (UX-50 SSOT limpar filtros+busca) |
| Próximo passo Marcas | **Aguardando H.5** — aceite proprietário via `docs/engineering/MARCAS-H5-MANUAL-TEST.md` (matriz screenshots + smoke: `cadastroListaClearFilters`, prefs coluna, camadas fpop) |

---

## Programa

**MAIKE Pecuária — Mapa Geral + Manejo.** Sistema nativo e escalável; persistência
100% PostgreSQL no escopo. Base44 resta só como **especificação JSONC** no
repositório (D-PROD-04 / P7 opcional de arquivo).

| Campo | Valor |
|---|---|
| Produto | Pecuária — Mapa Geral + Manejo (D-PROD-01) |
| Superfície primária | `MapaGeral` (D-PROD-05) |
| Missão em execução | **MAIKE-GESTAO-P3-03 — editar, excluir e duplicar lançamentos** (**D-PROD-158**, PR #234 draft; ver "Missão ativa" no topo). Antes dela: **P3-02** (D-PROD-156), PR #231 mergeada; **P3-01** (D-PROD-155), PR #230 mergeada. Registro anterior desta linha: **Missão integrada: autorização real e preferências do Mapa Geral** (**D-PROD-137**, então a decisão mais recente). Parte 1 na `main` (PR #205). Parte 2 na branch `claude/autorizacao-preferencias-integradas` (HEAD `1e2b9fc5`). Relatório: `MAIKE-MISSAO-INTEGRADA-AUTORIZACAO-PREFERENCIAS-REPORT.md`. Antes dela: **P8 — Hardening** (**D-PROD-56**); catálogo **D-PROD-57/60/62** (#126/#130/#132); UX Base1 **H.5**; MapLibre M1/M2-A/M2-B1/M2-B2/M2-B3 (**D-PROD-58/59/61/63/64**, #127/#129/#131/#133/#134) em `main`; **MapLibre áreas unificadas + Mapa Geral MapLibre + satélite Map Tiles** (**D-PROD-65**, R1 polígonos) **mergeada** em `main` (#139, merge `e8540e7d`, CI 40876450764 verde); **paridade visual do editor de polígonos** (**D-PROD-66**) **mergeada** (#141); **fechar/finalizar polígono e prévia do formulário** (**D-PROD-67**) **mergeada** (#142); **pontos médios no cadastro de área aberta** (**D-PROD-68**, `MAPLIBRE-PONTOS-MÉDIOS-NO-CADASTRO-03`) na branch `claude/new-session-26kpxu` — PR DRAFT, merge só após auditoria |
| Última mergeada (runtime) | **P7 — Base44 legacy cleanup** (PR **#85**, D-PROD-52); dados nativos fechados em **P5.5** (PR #84) |
| Mergeadas anteriores | P3 — Backend + Prisma + PostgreSQL Foundation (PR #10, merge `4ce4608`), com a P3-R1; P2 — ModeloBase1 Pecuário Foundation (PR #7, merge `1851503`); SSOT sincronizada nas PRs #8 (`378bfd3`) e #11 (`672ea99`); emenda D-PROD-22 na PR #9 (merge `44b204c`) |
| Próxima fatia autorizável | **P8 — Hardening and Release** (ver `ROADMAP.md`) |
| Contrato de dados | `config/modelobase1-pecuario.json` — **oficial**; obrigatório para P3–P6 |
| Escopo executável | `config/mapa-manejo-scope.json` |
| Roadmap | `docs/engineering/ROADMAP.md` |
| Molde arquitetural | PROJETOMG, parcial (D-PROD-03) |

**OWNER-SECURITY-01 continua aberto.** A PR #1 foi mergeada pelo proprietário em
2026-08-03 **sem** que a confirmação de rotação da chave do Google Maps tenha
sido registrada. O merge não muda a exposição: a chave antiga permanece no
histórico Git, agora também na `main`. Revogação, criação de chave nova,
restrição por HTTP referrer e por API (Maps JavaScript API e Geometry — a
Drawing Library saiu do loader na P1.2-R1 e não é mais necessária) e
armazenamento apenas em `.env.local` seguem pendentes com o proprietário — ver
`docs/engineering/P0.1-R1-CORRECTIVE-HARDENING-REPORT.md`.

## Progresso por missão

| Missão | Nome | Estado |
|---|---|---|
| P0 | Product Scope Reset | **mergeada** (PR #1, merge `508cf62`) |
| P1 | Native Foundation Bootstrap | **concluída e mergeada** — P1.1 a P1.3 em PRs anteriores; P1.4 e P1.4-R1 na PR #6, merge `7398d85`. Os seis eixos de `gate:api-boundary` estão em zero |
| P2 | ModeloBase1 Pecuário Foundation | **mergeada** (PR #7, merge `1851503`) — inclui a correção P2-R1 |
| P3 | Backend + Prisma + PostgreSQL Foundation | **concluída e mergeada** (PR #10, merge `4ce4608`) — `backend/` com Fastify, Prisma e PostgreSQL; cinco models; `gate:tenancy` e `gate:indices`. Inclui a correção **P3-R1** |
| P4 | Mapa Core Native Persistence | **concluída** — P4.0–P4.3 mergeadas; geografia e setor/área nativos em produção |
| P5 | Manejo Core Native Persistence | **concluída (P5.x + P5.5)** — lotes, movimentações, bebedouros, manejo técnico nativos; ver relatórios P5.x |
| P6 | Supporting Capabilities | **majoritariamente entregue** — cadastros, tarefas, empresa, usuários/permissoes nativos; entrada de estoque (DBT-04) permanece; endereçada pela Gestão P3-01 (D-PROD-155) só pelo lançamento confirmado, pendente de merge e release |
| P7 | Base44 Final Removal | **runtime concluído** (PR **#85**) — sem SDK/`VITE_BASE44_*` em `src/`; opcional: arquivar schemas `base44/` e ratchet |
| P8 | Hardening and Release | **em curso** — fatia grants/RLS (**D-PROD-56**) aplicada no remoto; restam CSP/cookies, observabilidade, release |

## Inventário

Números medidos após `npm ci` e `npm run build` finais.

| Métrica | Antes da P0.1 | pós-P0.1 | pós-P1.1 | pós-P1.2 | pós-P1.3 | Depois da P1.4 |
|---|---|---|---|---|---|---|
| Páginas em `src/pages` | 102 | 16 | 16 | 16 | 16 | **16** |
| Arquivos em `src/` | 472 | 203 | 209 | 230 | 245 | **263** |
| Arquivos em `src/components` | 312 | 157 | 157 | 156 | 156 | **155** |
| Schemas em `base44/entities` | 87 | 38 | 38 | 38 | 38 | **38** |
| Functions em `base44/functions` | 11 | 1 | 1 | 1 | 1 | **1** |
| Dependências diretas (`dependencies`) | 63 | 31 | 31 | 31 | 31 | **31** |
| Dependências diretas (`devDependencies`) | 15 | 18 | 18 | 18 | 18 | **18** |
| Arquivos em `src/` com SDK/base44Client | 197 | 71 | 71 | 46 | 27 | **4** |
| Ocorrências de `base44.entities` | 1014 | 371 | 368 | 230 | 151 | **38** |
| Ocorrências de `base44.auth` | 29 | 16 | 16 | 14 | 14 | **10** |
| Ocorrências de `base44.integrations` | 24 | 6 | 6 | 5 | 4 | **1** |
| Ocorrências de `base44.functions` | 9 | 5 | 5 | 5 | 4 | **1** |
| Acoplamento Base44 fora de `src/` | 22 | 1 | 1 | 1 | 1 | **1** |
| Chaves Google Maps literais | 8 | 0 | 0 | 0 | 0 | **0** |
| Erros de lint | 64 | 0 | 0 | 0 | 0 | **0** |
| Diagnósticos `tsc` (cobertura total) | — | 2.802 | 2.797 | 2.759 | 2.728 | **2.319** (teto 2.319) |
| Testes automatizados | 0 | 183 | 377 | 478 | 625 | **817** (323 de gate + 494 de smoke) |
| Bundle de produção — JS | 4.347,45 kB | 2.461,36 kB | 2.464,58 kB | 2.474,37 kB | 2.482,90 kB | **2.496,61 kB** |
| Bundle de produção — CSS | 120,36 kB | 77,00 kB | 77,00 kB | 77,00 kB | 77,00 kB | **77,00 kB** |

**Depois da P2**, todos os números acima permanecem idênticos: a missão não
tocou em `src/`, `base44/`, `vite.config.js` nem no manifesto de escopo. Só duas
métricas mudaram, e as duas por acréscimo de verificação:

| Métrica | Depois da P1.4 | Depois da P2 | Depois da P3-R1 | Depois da P4.0 | Depois da P4.1 |
|---|---|---|---|---|---|
| Testes automatizados | 817 (323 gate + 494 smoke) | 862 (368 gate + 494 smoke) | 964 (428 gate + 495 smoke + 41 backend) | 1.046 (452 gate + 534 smoke + 60 backend) | **1.140** (494 gate + 556 smoke + 90 backend) |
| Etapas do `verify:all` | 13 | 14 | 18 | 19 | **20** |
| Dependências diretas | 49 | 49 | 55 | 56 | **56** (38 `dependencies` + 18 `devDependencies`) |
| Bundle de produção — JS | 2.496,61 kB | 2.496,61 kB | 2.496,62 kB | 2.504,83 kB | **2.505,17 kB** (671,56 kB gzip) |
| Dívida de tipos em `src/` | 2.319 | 2.319 | 2.319 (teto 2.319) | 2.318 (teto 2.318) | **2.318** (teto 2.318) |
| Arquivos em `src/` | 263 | 263 | 263 | 263 | **271** |
| Models Prisma | — | — | 5 | 5 | **6+** (fundação + domínio mapa + P6.1) |
| Migrations versionadas | — | — | 1 | 1 | **6** (2026-10-27) |
| Registry literal do provider | 38 | 38 | 38 | 38 | **37** (o manifesto menos `Setor`) |
| Ocorrências de `base44.entities` | 38 | 38 | 38 | 38 | **37** |

A **P4.1** é a primeira missão desde a P1.4 a mexer no registry do provider, e a
primeira a fazê-lo **para baixo**: `Setor` saiu porque a persistência dele é
nativa (D-PROD-25). `base44/entities/Setor.jsonc` continua existindo e `Setor`
continua em `allowedBase44Entities` — `syncEntityReferences` ainda o cita, e
`gate:product-scope` exige manifesto e schemas iguais nos dois sentidos. Por
isso `schemas` continua 38 enquanto `entitiesRefs` caiu para 37.

O bundle cresceu 0,34 kB (+0,01%): a porta nativa e os dois códigos de erro
novos custam mais que o `setoresProvider` removido. Continua sem code splitting
(DBT-06).

A diferença de 0,01 kB na linha do bundle é arredondamento entre ambientes de
medição — as colunas P1.4 e P2 vêm da CI, as colunas P3 vêm de build local
reproduzível. O artefato é o mesmo: base `44b204c` e HEAD da P3-R1 produzem o
**mesmo hash de chunk** (`index-nzvr8O-2.js`) quando construídos com
`NODE_ENV=production`.

**A primeira versão da P3 tinha, sim, uma regressão de bundle na CI** — 3.555,01
kB —, e ela não era do backend: eu havia definido `NODE_ENV: test` no `env:` do
job do workflow, o que alcançava o `npm run build` e fazia o Vite empacotar as
bibliotecas em modo de desenvolvimento. A inflação reproduz igual no commit base,
onde backend não existe. Corrigido na P3-R1 em duas pontas — `NODE_ENV` saiu do
workflow e `verify:all` fixa `production` no passo de build —, com cinco casos
travando as duas. Ver §16.3 do relatório da P3.

Os 45 testes novos são MB1-01 a MB1-20 com sub-casos, todos executando o gate
real em diretórios temporários. Oito deles vieram da **P2-R1**, que fechou três
invariantes que o contrato declarava e o gate não protegia: `headers` e `cookie`
nas fontes proibidas de tenant, `headers` nas fontes proibidas do ator de
auditoria, e o escopo `empresa` da numeração. O contrato JSON e o documento
arquitetural não mudaram — o defeito estava só no verificador. Ver §14 do
relatório da P2.

As quatro ocorrências restantes de SDK/`base44Client` em `src/` são, todas,
**dentro da fronteira**: o client (`src/api/base44Client.js`), o adapter
autorizado (`src/apis/_providers/base44Provider.js`) e as duas referências que o
adapter faz a `base44.auth` e `base44.integrations`. Nenhuma página, componente,
hook, lib ou service acessa o provider.

Os artefatos do bundle vêm da CI do **último commit com mudanças executáveis**
desta PR — não de um build local nem de uma execução anterior.

Os artefatos da P1.4 vêm da CI do commit funcional desta PR — o run e o job
ficam registrados no corpo da PR #6, porque um commit não pode conter o
resultado da própria execução.

| Artefato | Tamanho | gzip |
|---|---|---|
| `dist/assets/index-CcAJh1Vu.js` | 2.496,61 kB | 668,91 kB |
| `dist/assets/index-DM5ihJ4E.css` | 77,00 kB | 13,31 kB |
| `dist/index.html` | 0,48 kB | 0,31 kB |

O hash do JS mudou porque a P1.4 alterou `src/`; o do CSS não mudou porque
nenhuma folha de estilo foi tocada. O bundle cresceu 13,71 kB (+0,55%) — os
quatro módulos de API novos, os onze services e os módulos de domínio custam
mais do que os acessos diretos que substituíram. Continua sem code splitting
(DBT-06).

Baselines mecânicos: `scripts/gates/base44-baseline.json` (schema 2) e
`scripts/gates/typecheck-baseline.json` (schema 3: contrato de configuração —
D-PROD-13 — e teto certificado monotônico — D-PROD-17).

## Fronteira de dados (P1.1, D-PROD-18)

| Eixo do `gate:api-boundary` | `main` pós-P0.1 | pós-P1.1 | pós-P1.2 | pós-P1.3 | Depois da P1.4 |
|---|---|---|---|---|---|
| arquivos que importam `@/api/base44Client` | 68 | 67 | 42 | 23 | **0** |
| arquivos que usam `base44.entities` | 64 | 63 | 38 | 20 | **0** |
| arquivos que usam `base44.auth` | 13 | 13 | 9 | 8 | **0** |
| arquivos que usam `base44.integrations` | 5 | 5 | 3 | 2 | **0** |
| arquivos que usam `base44.functions` | 5 | 5 | 5 | 3 | **0** |
| arquivos com acesso computado a `entities` | 3 | 3 | 3 | 2 | **0** |

Cada eixo é uma **lista de caminhos**, não um número: trocar um arquivo por
outro do mesmo tamanho reprova. Todos os eixos acima são subconjuntos estritos
do estado anterior — nenhum arquivo entrou.

Saíram de todos os eixos: `src/pages/Empresa.jsx` (P1.1) e, na P1.2,
`MapaGeral`, `MapaCadastro`, `useSetorAreas`, os 20 componentes de
`src/components/mapa/`, `manejoValidations` e o antigo `mapaOfflineCache`, que
foi removido e substituído por `src/services/mapaCacheService.js`.

O adapter autorizado `src/apis/_providers/base44Provider.js` não conta como
dívida — ele é a fronteira. Registry literal do provider após a P1.4: **38
entidades**, exatamente iguais a `allowedBase44Entities` do manifesto. A P1.4
acrescentou só `Marca` e `UnidadeMedida`, e apenas porque passaram a ter
consumidor migrado.

A P1.3 migrou os cadastros do manejo — lotes, setores, categorias, categorias de
manejo, bebedouros e anexos — e **removeu** os dois repositórios legados
(`loteRepository`, `bebedouroRepository`), sem shim.

A P1.4 migrou os 23 caminhos restantes — casca, autenticação, configurações,
produtos, marcas, unidades, locais de estoque, tarefas, usuários e suplementação
— e **removeu os três monkey patches globais** que o client instalava sobre o
SDK: normalização de texto, guardas de exclusão e runtime offline. Os arquivos
`src/lib/entityDeleteGuards.js` e `src/lib/offlineEntitySync.js` foram excluídos;
`historicoSuplementacaoUtils.jsx` virou `src/services/suplementacaoHistoricoService.js`.
Com isso os seis eixos ficaram em zero e o baseline versionado tem as seis
listas vazias: **qualquer reintrodução reprova**.

Não restam arquivos legados. A P1 está tecnicamente fechada na branch: a única
porta para a Base44 é `src/api/base44Client.js`, consumido só por
`src/apis/_providers/base44Provider.js`.

A **P1.4-R1** não migrou caminho nenhum — corrigiu quatro defeitos que a
contagem zerada escondia: o formato de erro do provider ainda atravessava três
camadas (agora `sessionApi` classifica uma vez e devolve `{ok, value}` /
`{ok, reason}`), o teto de tipos caiu porque a verificação do `Button` fora
desligada com `any` (agora o contrato é declarado de verdade), o rastro de falha
parcial do rename afirmava menos do que havia acontecido, e
`PRODUTO_PARTIAL_IMPORT` estava catalogado sem nenhum chamador. Ver
`docs/engineering/P1.4-NATIVE-API-BOUNDARY-SUPPORT-ADMIN-REPORT.md` §15.

## Contrato base pecuário (P2, D-PROD-21)

A P2 não migrou caminho nenhum, não criou backend e não tocou em `src/`. Ela
transformou identidade, tenancy, timestamps, auditoria, numeração, anexos,
exclusão, concorrência e vocabulário de erro em **contrato versionado e
verificável**, para que a P3 implemente Prisma contra um acordo escrito em vez de
decidir cada regra sob pressão de migration.

| Artefato | Caminho |
|---|---|
| SSOT executável | `config/modelobase1-pecuario.json` |
| Documento legível | `docs/architecture/MODELOBASE1-PECUARIO-CONTRACT.md` |
| Gate | `scripts/gates/gate-modelobase1-pecuario.mjs` |
| Testes | `scripts/tests/gates/modelobase1-pecuario.test.mjs` |
| Relatório | `docs/engineering/P2-MODELOBASE1-PECUARIO-FOUNDATION-REPORT.md` |

O nome vem do PROJETOMG; o significado, não. Lá `ModeloBase1` é o motor visual
de cadastro. Aqui é contrato de dados — não é template visual, não cria runtime
genérico, não cria low-code e não substitui as telas atuais (D-PROD-21).

O gate é **absoluto**: sem `--update`, sem baseline, sem correção automática e
sem escrita no arquivo, nem quando o contrato está inválido. Onze códigos
`P2-MB1-*`, 11 seções obrigatórias, 8 códigos de erro mínimos e 10 padrões
proibidos.

O contrato só seria **oficial** depois do merge humano da PR, e o merge
aconteceu: PR #7, merge `1851503`, 2026-08-28. **O contrato está oficial e
vigente** — é obrigatório para P3, P4, P5 e P6, e nenhuma migration de domínio
pode divergir dele.

A P2 incluiu a correção **P2-R1**, que fechou três invariantes declaradas no
contrato e não protegidas pelo gate: as fontes proibidas de tenant passaram de
três para as cinco do SSOT (`body`, `query`, `params`, `headers`, `cookie`), o
ator de auditoria ficou com as quatro que o SSOT declara, e o escopo `empresa`
da numeração passou a ser exigido junto com `tenant`. Cada uma ganhou prova
negativa executando o gate real — ver §14 do relatório da P2.

## Backend nativo (P3, D-PROD-23)

Pela primeira vez o repositório tem backend próprio. `backend/` existe, com
Fastify, Prisma e PostgreSQL, na camada `route → service → repository → Prisma`.

| Item | Valor |
|---|---|
| Models | 5 — `Cliente`, `Usuario`, `AuditLog`, `EntidadeCodigoSequencia`, `RegistroAnexo` |
| Migration | `backend/prisma/migrations/20260908174141_p3_foundation/` |
| Banco local | Docker Compose, `postgres:16.13-alpine`, versão fixada |
| Banco na CI | serviço efêmero do GitHub Actions, mesma versão, `DATABASE_URL` do job |
| Sessão | JWT via `@fastify/jwt`; senha em hash bcrypt |
| Gates novos | `gate:tenancy`, `gate:indices` — absolutos, sem baseline |
| Typecheck próprio | `npm run typecheck:backend` — `jsconfig.backend.typecheck.json`, tolerância zero, sem baseline |
| Testes | 55 de gate (38 tenancy + 17 indices) e 41 de backend contra PostgreSQL real |

**Nenhum model de domínio foi criado.** Mapa e manejo ficam para P4–P6, uma
capacidade por vez. **À época da P3** o backend ainda não era consumido pelo
frontend: `src/` não foi tocado, e a fronteira da P1 continuava apontando
inteiramente para o provider Base44. A **P4.0** mudou isso para a autenticação —
ver a seção abaixo; o domínio geográfico segue na Base44 até a P4.1.

Duas invariantes do contrato que só o banco prova, e que aqui estão provadas:
40 reservas concorrentes de sequência sem número duplicado (BE-17), e auditoria
dentro de transação revertida que não sobrevive ao rollback (BE-25).

**Duas correções que os testes obrigaram**, ambas de defeito real e não de
fixture. O Fastify vem com `removeAdditional` ligado: um `cliente_id` enviado no
corpo do login era **descartado em silêncio**, não recusado — numa superfície de
tenancy, silêncio é pior que erro, e agora vira 400. E o handler de erro
normalizava qualquer exceção do framework em `INTERNAL_ERROR`, de modo que
requisição malformada devolvia **500** em vez de 400 — o servidor se culpando
por erro do cliente.

### P3-R1 — fechamento corretivo

A auditoria da P3 apontou cinco bloqueios, todos corrigidos na mesma branch e na
mesma PR. Três deles eram **invariante declarada e não verificada** — a mesma
classe da P2-R1:

| # | Defeito | Correção |
|---|---|---|
| B1 | O repositório da sequência criava a linha por `INSERT` cru com `gen_random_uuid()`, contornando o `@default(cuid())` que o schema declarava | `createMany({ skipDuplicates: true })`, que compila para `ON CONFLICT DO NOTHING` e preserva a idempotência. Prova negativa: `P3-TEN-RUNTIME-IDENTITY` |
| B2 | `AuditLog → Usuario` referenciava só o `id`: auditoria do cliente A podia apontar para usuário do cliente B | FK **composta** `[cliente_id, usuario_id] → [cliente_id, id]`, com `@@unique([cliente_id, id])` em `Usuario`. Migration regerada. O PostgreSQL recusa A×B (R1-T06) e o evento de sistema com `usuario_id` nulo continua válido por `MATCH SIMPLE` (R1-T07) |
| B3 | Bundle inflado na CI, ~1 MB acima do patamar | Não era do backend: era `NODE_ENV: test` no `env:` do job, que alcançava o `npm run build`. Ver acima |
| B4 | `backend/` sem cobertura de tipos — lacuna declarada na P3 | `jsconfig.backend.typecheck.json` e `typecheck:backend`, tolerância zero. Os 10 diagnósticos reais foram corrigidos no código, com module augmentation do Fastify — sem `any`, sem `@ts-ignore` |
| B5 | `prisma validate` existia como script e não rodava na cadeia | Passou a ser obrigatório, antes de `generate` e `migrate deploy` |

O isolamento por tenant passou a ser provado pelo caminho **service → repository**
(R1-T09), e não por um `WHERE` escrito dentro do teste — que provaria o `WHERE`,
não a aplicação.

Um detalhe vale registro porque a lição não é óbvia: a primeira versão da regra
de identidade em runtime era um `grep` por `randomUUID` e **reprovou o próprio
repositório** — `requestContext.js` usa `randomUUID()` para o id de correlação da
requisição, que é uso legítimo. A regra foi reescrita para casar só na **posição
de identidade**, e TEN-27 existe como controle positivo para impedir que alguém a
alargue de volta para um scanner textual ingênuo.

## Transporte e sessão nativos (P4.0, D-PROD-24)

Pela primeira vez o navegador fala com o backend próprio. A P4.0 não migrou
capacidade nenhuma — ela construiu a estrada que a P4.1 vai usar.

| Item | Valor |
|---|---|
| URL do backend | `VITE_MAIKE_API_URL` — pública, sem override por query string ou storage |
| Fronteira HTTP | `src/apis/_core/nativeHttpClient.js`, única |
| Sessão | JWT do MAIKE em memória + `sessionStorage`, guarda única; com "Manter conectado" no armazenamento persistente, validade `AUTH_TOKEN_TTL_LEMBRAR` (D-PROD-136) |
| Login | `{cliente, login, senha}` — **nunca** `cliente_id` |
| CORS | `FRONTEND_ORIGINS`, allowlist de origins exatas, sem wildcard |
| Gate novo | `gate:native-api` — absoluto, 7 códigos, 24 provas |
| Bootstrap | `npm run auth:bootstrap:local` — script, não endpoint |
| Estados da sessão | `carregando` · `autenticada` · `nao_autenticada` · `validacao_indisponivel` |

**Nenhum model de domínio.** O schema Prisma está inalterado e não há migration
nova; `Setor` e `AreaPastagem` continuam só na Base44.

A dívida de erros que a P3 declarou **fechou**: os oito códigos do contrato
ModeloBase1 entraram em `src/apis/_core/ApiError.js`, com mensagem pública
própria, agora que existe consumidor real.

**A autenticação do aplicativo deixou de ser da Base44**, e não há fallback: se
o backend MAIKE não responde, o usuário vê falha de login. Dual-auth silenciosa
transformaria "o backend caiu" em "sua senha está errada". Com isso, `authRefs`
caiu de 10 para 5 — `redirectToLogin` autenticaria no provider errado, e o
`logout` da Base44 **não deve** ser chamado, porque descartaria o token do SDK
que chega uma única vez pela query string.

Duas coisas ficam ditas sem maquiagem. `sessionStorage` é acessível a
JavaScript: um XSS nesta origem lê o token, e a troca por `localStorage`
**reduz a janela, não a classe do problema** — cookie `HttpOnly`, refresh com
rotação, revogação e CSP são P8. E o logout é local, porque o JWT da P3 é
stateless e não há sessão a invalidar no servidor.

**A P4.0-R1 corrigiu um bloqueador que a auditoria externa encontrou** depois da
CI verde do primeiro HEAD: a restauração da sessão apagava o JWT para *qualquer*
erro, então um backend fora do ar por trinta segundos destruía a sessão de quem
estava trabalhando e pedia senha de novo — punindo o usuário por uma falha de
infraestrutura. Pior: o comentário que eu havia escrito justificava o
comportamento, o que o fazia parecer deliberado.

Agora as duas classes são separadas por **código**: `TENANT_CONTEXT_REQUIRED`
limpa o token; rede, timeout, CORS e 5xx **preservam** o token e levam ao estado
`validacao_indisponivel`, onde o aplicativo continua fechado, o login **não**
aparece, e o usuário recebe *Tentar novamente* — que reusa o mesmo JWT, sem
pedir senha. Fail-closed sem destruir a credencial. Ver §19 do relatório da P4.0
e D-PROD-24 §G.1.

Um detalhe de processo que se repetiu pela terceira vez: **duas regras do gate
novo reprovaram o próprio repositório** na primeira versão — `getNativeApiUrl`
casava na definição, e `Authorization` casava no provider da Base44, que monta
esse cabeçalho legitimamente. É a mesma classe de falso positivo da P3-R1. A
correção foi tornar a regra precisa (verificar *posição*, não palavra), com
controles positivos que quebram se alguém alargar de volta.

## Setor nativo (P4.1, D-PROD-25)

A **primeira capacidade de domínio** a sair da Base44.

| Camada | Antes da P4.1 | Depois da P4.1 |
|---|---|---|
| Persistência | entidade `Setor` da Base44 | `model Setor` no PostgreSQL, tenant-scoped, migration `20260909112833_p4_1_setor_native` |
| Leitura do cadastro | `setoresProvider.list` | `GET /setores`, autenticado |
| Leitura do mapa | `mapaProvider.listSetores` — **segunda** leitura do mesmo agregado | a **mesma** função, reexportada de `@/apis/setores` |
| Criação | `POST` na Base44 com `numero_setor` calculado no navegador | `POST /setores`; o número vem de `EntidadeCodigoSequencia` |
| Numeração | `MAX + 1` sobre a lista carregada | sequência atômica, escopo `tenant`, na transação da criação |
| Atualização | `PATCH` na Base44 | `PATCH /setores/:id`, autenticado |
| Exclusão | `DELETE` na Base44, com guarda de vínculo | **não existe rota**; recusa local com `SETOR_DELETE_UNAVAILABLE` |
| Auditoria | nenhuma | `AuditLog` na mesma transação da escrita |
| Offline | cache + fila sobre as operações da Base44 | cache + fila sobre as operações **nativas** |

O `MAX + 1` não era questão de estilo. A lista carregada é uma **fotografia**:
dois navegadores criando setor ao mesmo tempo liam o mesmo máximo e pediam o
mesmo número. `BE-P41-08` cria 12 setores em paralelo contra PostgreSQL real e
exige exatamente 1..12 — o caso que uma criação em série nunca distinguiria.

Três decisões que custam explicação e estão registradas em D-PROD-25:

- **escopo `tenant`, não `empresa`** (§B): `Empresa` só é nativa na P6, e o
  backend não consegue validar o `empresa_id` que recebe. Ancorar uma sequência
  num identificador não verificável criaria uma sequência por string arbitrária;
- **sem `DELETE`** (§D): a guarda de vínculo consulta quatro entidades que ainda
  vivem na Base44. Todas as formas de conciliar as duas bases numa operação
  destrutiva são inseguras, e a recusa tem código próprio — nunca
  `SETOR_DELETE_BLOCKED`, que afirmaria um vínculo não verificado;
- **corpo montado por lista literal** (§G): o objeto da tela de edição carrega
  `id`, `numero_setor` e `created_date`, e o registro criado offline carrega
  `_isOffline` e um id `offline_…`. A filtragem mora na porta, e não no service,
  porque o replay da fila chama as operações direto. **A regra de identidade do
  backend não foi enfraquecida para acomodar o offline** — o offline é que
  passou a respeitá-la.

`gate:setor-native` trava **doze** invariantes, com **54 provas** quase todas
negativas. Ver `docs/engineering/GATE-REGISTRY.md`.

### P4.1-R1 — fechamento corretivo

Três defeitos achados em revisão da própria PR e corrigidos dentro dela, como a
P4.0-R1 foi na PR #12. Os dois primeiros existem porque a P4.1 mudou **quem
autentica o replay** da fila offline:

- **escrita entre tenants.** Cache e fila eram particionados por
  `entidade::empresa_id`, sem tenant, e `logout()` descarta só o JWT. O replay
  passou a mandar `Authorization: Bearer` do MAIKE e o backend grava pelo tenant
  do token, então a operação enfileirada pelo cliente A era aplicada dentro do
  cliente B que entrasse depois no mesmo navegador. Agora cache, fila e replay
  têm dono, e a entrada de outro dono fica na fila até ele voltar — pular não é
  perder;
- **fila legada travando tudo.** `operacoesNativas` não tem `delete`. Uma
  exclusão enfileirada antes do corte estourava `TypeError`, e o replay retorna
  no primeiro erro: a fila **inteira**, de todas as entidades, parava ali para
  sempre. Entradas anteriores ao corte não têm dono, e são descartadas — a única
  perda de dado deste desenho, dita em vez de escondida;
- **obrigatório só com espaço.** `minLength: 1` aceitava `" "`, que virava
  `null` na normalização e `INTERNAL_ERROR` 500 no Prisma. `pattern: '\\S'` move a
  recusa para a fronteira, com 400.

Nada do backend foi afrouxado: o tenant continua vindo só do token. A correção é
toda do lado do navegador, que era quem estava errado. Gate
`P41-SETOR-OFFLINE-TENANT`, provas SN-13 a SN-18 e OFF21 a OFF29. Ver D-PROD-25 §L.

## Base URL nativa (P4.0-R2, D-PROD-26)

Correção de um defeito que **chegou ao usuário**, e a primeira desta missão que
não veio de análise e sim de produção.

`VITE_MAIKE_API_URL` estava na Vercel como `maike-production.up.railway.app`,
sem `https://`. Como `nativeRequest` concatena base e caminho, o `fetch` recebeu
uma URL **relativa** e o navegador a resolveu contra a origem do frontend: o
`POST /auth/login`, com a senha no corpo, foi para a Vercel, que respondeu `404`
em `text/plain`. Na tela, erro genérico de login.

O que isso ensinou, e está registrado em D-PROD-26:

- **o sintoma mentia.** `curl` contra o backend autenticava com `200`; só o
  navegador falhava. Backend, banco, JWT e CORS estavam corretos o tempo todo;
- **configuração ausente falhava bem; configuração malformada, não.** A P4.0 já
  tratava `null` corretamente (`PROVIDER_UNAVAILABLE`, sem tocar na rede). O
  buraco era o valor presente e inválido;
- **o custo foi credencial no host errado**, não indisponibilidade.

`getNativeApiUrl()` agora normaliza host puro para `https://`, preserva
`http://`/`https://` explícitos e devolve `null` para toda forma ambígua —
`//outro.host`, `javascript:`, `ftp://`, caminho relativo. Gate próprio,
`P4-NATIVE-SCHEME`, com provas negativas NAT-25/26/27 e controle positivo
NAT-28.


## Sem backfill da Base44 (P4.1-R2, D-PROD-27)

Decisão do **proprietário**, não do arquiteto: os registros históricos da Base44
**não** serão migrados. As capacidades nativas nascem vazias e o que for
necessário é recadastrado.

Some do caminho: backfill, dual-write, reconciliação de contagem/checksum,
rollback de dado e downtime de corte. Sobra migração de **capacidade** — schema,
rotas, serviços, troca de provider.

O que a decisão **não** autoriza, e está escrito porque é fácil ler errado:

- **não** apagar `Cliente`, `Usuario`, `AuditLog`, `EntidadeCodigoSequencia`,
  `RegistroAnexo` ou `Setor` já existentes no backend nativo;
- **não** apagar nada da Base44 — ela continua sendo a fonte de 37 entidades em
  produção;
- **não** fazer limpeza automática em lugar nenhum sem ação explícita e nomeada
  do proprietário.

Cada capacidade migrada aparece zerada na tela até ser recadastrada. É esperado.

A premissa está oficializada; o replanejamento das fases é trabalho da próxima
fatia, com auditoria própria. A **P4.2 continua não iniciada**.

## Gates ativos

20 etapas em `npm run verify:all` — ver `docs/engineering/GATE-REGISTRY.md`.
Todos os gates têm teste com casos de falha reais em `scripts/tests/gates/`; a
catraca de tipos é exercitada ponta a ponta, com `tsc` de verdade em projetos
temporários.

CI em `.github/workflows/quality.yml`.

| Commit | Conteúdo | Run | Resultado |
|---|---|---|---|
| `3c03ecf` | **commit funcional** da P1.1 | [30812723777](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30812723777) | **verde**, 13/13 |
| `df3e6f1` | certificação de estado da P1.1 | [30812950738](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30812950738) | **verde**, 13/13 |
| `8866768` | **commit funcional** da P1.1-R1 | [30815360716](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30815360716) | **vermelha** — `no-secrets` (ver abaixo) |
| `9447884` | correção do relatório da P1.1-R1 | [30815727984](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30815727984) | **verde**, 13/13 |
| `4acd1d4` | **commit funcional** da P1.1-R2 | [30818797942](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30818797942) | **verde**, 13/13 |
| `5946809` | **commit funcional** da P1.1-R3 | [30836332701](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30836332701) | **verde**, 13/13 |
| `6d88794` | certificação de estado da P1.1-R3 | [30836737386](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30836737386) | **verde**, 13/13 |
| `9767545` | **commit funcional** da P1.1-R4 | [30841392611](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30841392611) | **verde**, 13/13 — origem dos artefatos |
| `48d6d66` | **commit funcional** da P1.2 | [30847666490](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30847666490) | **verde**, 13/13 |
| `98b966d` | **commit funcional** da P1.3 | [30868215796](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/30868215796) | **verde**, 13/13 |
| `344accb` | **commit funcional** da P1.3-R1 | [31007455901](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/31007455901) | **verde**, 13/13 |
| `c72f892` | **commit funcional** da P1.3-R2 | [31009031928](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/31009031928) | **verde**, 13/13 |
| `dc7e022` | fechamento documental da P1.3 | [31012186549](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/31012186549) | **verde**, 13/13 |
| P1.4 | **commit funcional** da P1.4 | CI registrada no corpo da PR #6 | — |
| P1.4-R1 | **commit funcional** da P1.4-R1 | CI registrada no corpo da PR #6 | — |
| `3c1a90d` | **commit funcional** da P2 | [31108882141](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/31108882141) | **verde**, 14/14 |
| `acc2f11` | **commit funcional** da P2-R1 | [31125606483](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/31125606483) | **não executou** — ver abaixo |
| `8a5e3ee` | commit vazio da P2-R1, para disparar CI | — | nenhum run criado |
| `80ecf69` | **commit funcional** da P3 | [34243753654](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/34243753654) | **verde**, 17/17 |
| `5bcee77` | **HEAD certificado** da P3-R1, mergeado na PR #10 | [34260918759](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/34260918759) | **verde**, 18/18 |
| `0185d10` | **commit funcional** da P4.0 | [34269584058](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/34269584058) | **verde**, 19/19 |
| `f01201b` | **HEAD certificado** da P4.0-R1, mergeado na PR #12 | [34272006608](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/34272006608) | **verde**, 19/19 |
| `8c477f9` | **commit funcional** da P4.1 | [34349251485](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/34349251485) | **verde**, 20/20 |

Um commit não pode conter o resultado da própria execução de CI. A execução do
commit funcional fica no corpo da PR aberta — PR #2 para a P1.1, PR #3 para a
P1.2, PR #5 para a P1.3, PR #6 para a P1.4 e a P1.4-R1, PR #7 para a P2, PR #10
para a P3 e a P3-R1, PR #12 para a P4.0 e a P4.0-R1, PR #14 para a P4.1.

Ao contrário da P2-R1, a P3 entrou na `main` com **execução de CI própria e
verde sobre o HEAD exato que foi mergeado**: o job `102178796058` do run
`34260918759` rodou as 18 etapas em `5bcee77`, e é esse commit que o merge
`4ce4608` trouxe. A lacuna declarada em `acc2f11` não se repetiu.

**O commit `acc2f11` entrou na `main` sem execução de CI própria.** Não houve
reprovação: o job `92695474512` nasceu na fila às 18:16:53 de 2026-08-06, nunca
recebeu runner (`runner_id: 0`, 0 ms faturados) e foi cancelado 15 minutos
depois. Re-run pela API foi aceito mas nunca enfileirou; um commit vazio no
mesmo HEAD não gerou run nenhum, enquanto o Vercel fez deploy normalmente no
mesmo push — ou seja, o gatilho chegava e o Actions não executava. A evidência
que existe para esse commit é o `verify:all` local, 14/14 com exit 0, mais a CI
verde do commit imediatamente anterior. O proprietário mergeou com esse quadro
registrado no corpo da PR #7. **A primeira execução verde na `main` cobre essa
lacuna** — até lá, ela fica declarada aqui em vez de escondida.

O run vermelho de `8866768` fica registrado em vez de omitido. A reprovação foi
legítima: o relatório da própria P1.1-R1 citava um par nome-de-chave mais
literal ao explicar um achado, e `gate:no-secrets` casa esse padrão em qualquer
arquivo versionado, prosa incluída. Corrigido em `9447884`; ver DBT-17 para o
motivo de o `verify:all` local não ter pego antes.

## Débito conhecido

| # | Item | Tratamento |
|---|---|---|
| DBT-01 | **Fechado na P1.4.** Nenhum componente, página, hook, lib ou service acessa `base44`. As 37 ocorrências de `base44.entities` que restam estão todas dentro do adapter autorizado, uma por entidade do registry — eram 38 até a P4.1 migrar `Setor` | fechado |
| DBT-02 | `requiresAuth: false` em `src/api/base44Client.js` | P3 |
| DBT-03 | 2.318 diagnósticos de dívida de tipos versionados na catraca, com teto certificado de 2.318. A catraca impede crescimento em qualquer modo (D-PROD-17) e impede afrouxar a configuração (D-PROD-13). Trajetória: 2.802 → 2.759 (P1.2) → 2.728 (P1.3-R1) → 2.323 (P1.4, −405) → 2.319 (P1.4-R1, com o contrato de props do `Button` declarado de verdade, sem `any`) → **2.318** (P4.0, com o contrato do `AuthContext` declarado) → 2.318 (P4.1, estável: o diagnóstico que o código novo introduziu foi corrigido no código, não absorvido). A P2 e a P3 não mexeram em `src/` e por isso não reduziram nada. *O número de abertura desta linha dizia 2.319 desde a P4.0, contradizendo a própria trajetória e a tabela de inventário do mesmo documento; corrigido na P4.1.* | P4–P8 |
| DBT-04 | Sem tela de **entrada** de estoque (D-PROD-08). **Endereçado pela Gestão P3-01 (D-PROD-155), em produção desde 2026-11-09 (PR #230):** a entrada passa a existir só como efeito do lançamento confirmado de compra com mercadoria (`LancamentosFinanceiros`, comando composto do motor de estoque). Não há tela avulsa de entrada, e `MovimentacoesEstoque`/`LancamentoProdutosEstoque` continuam proibidas | P6 → fechado pela PR #230 (merge `f2b81e1b`) |
| DBT-05 | Chave Google Maps antiga permanece no histórico Git — revogar e rotacionar (OWNER-SECURITY-01) | ação do proprietário |
| DBT-06 | Bundle único de ~2,50 MB, sem code splitting | P8 |
| DBT-07 | `LayoutCampo`/`LayoutSecao`/`LayoutConfiguracao` + `src/services/campoEngine.js` sustentam o formulário dinâmico de lote — um mini-motor de layout dentro do produto. A P2 é contrato de dados e não toca em UI (D-PROD-21); o desmonte acontece quando o lote migrar | P5 |
| DBT-08 | **Fechado na P1.4.** `src/lib/offlineEntitySync.js` foi removido. O runtime offline é provider-agnostic (`src/lib/offline/offlineEntityRuntime.js`) e o catálogo de entidades offline é montado literalmente pelo provider, uma chamada por entidade | fechado |
| DBT-09 | A numeração por `max + 1` lista a coleção inteira e não tem segurança de concorrência. Saiu das telas para os services na P1.4 (produtos, marcas, unidades, locais), o que torna a regra testável — mas duas criações simultâneas ainda podem receber o mesmo número. Fecha com o backend próprio | P3 |
| DBT-10 | **Fechado na P1.4.** `eslint.config.js` cobre `src/**`, `scripts/**` e `tests/**` inteiros, com globais por ambiente (browser, Node, Vitest/JSDOM). Sem `ignores` de diretório, sem regra desligada em massa e sem `eslint-disable` espalhado | fechado |
| DBT-11 | `npm audit` reporta vulnerabilidades nas dependências transitivas remanescentes | P8 |
| DBT-12 | `gate:types` fixa `typescriptVersion` no baseline. Atualizar o TypeScript exige `--rebase-contract` consciente — por desenho, mas é passo manual em toda subida de versão | P1 |
| DBT-14 | **Fechado na P1.4.** Zero arquivos importam `@/api/base44Client` fora do adapter. O baseline de `gate:api-boundary` tem as seis listas vazias, então qualquer reintrodução reprova | fechado |
| DBT-15 | **Fechado na P1.4.** As três telas que subiam arquivo (logotipo da empresa, ícone e sub-ícone) passam por `src/services/arquivoService.js` sobre `src/apis/arquivos/`. Upload sem `file_url` de volta virou falha explícita, em vez de gravar `undefined` no campo | fechado |
| DBT-16 | **Fechado na P1.4.** Os dois arquivos foram removidos. Nenhum acesso computado a `entities` sobrou: o eixo `dynamicEntityFiles` está vazio no baseline | fechado |
| DBT-18 | **Fechado na P1.4 para o repasse por argumento.** O gate reprova entregar o provider — ou um método cru dele — como argumento de qualquer chamada, que era o caminho pelo qual a capacidade cruzava para outro arquivo. Passar o **resultado** de uma chamada continua permitido, e há controle positivo (P14-N7). Continua fora do alcance a análise semântica de wrapper que só se resolve com dataflow entre módulos — mas sem argumento nem export, a capacidade não tem por onde sair | parcial · P3 |
| DBT-17 | **Fechado na P1.4.** `gate:no-secrets` varre rastreados **e** não rastreados não ignorados, deduplicados. Arquivo novo com segredo reprova antes do `git add`; `.env.local` ignorado continua fora da varredura, que é onde o segredo deve ficar | fechado |
| DBT-19 | Operação composta de manejo não é atômica: a Base44 não oferece transação multi-entidade. A P1.2 tornou a falha parcial **visível** (`MAPA_PARTIAL_OPERATION` com etapa concluída e etapa de falha), não a eliminou; a P1.4-R1 tornou o rastro do rename de local **fiel** — cada etapa é registrada quando conclui, com contagem por cocho. Some com o backend próprio | P3 |
| DBT-20 | `DetalhesLote.jsx` segue com ~1.300 linhas. A fronteira de dados fechou na P1.2 e as decisões puras saíram para `src/domain/lotes/`, mas o componente continua grande demais para revisão confortável | P5 |
| DBT-21 | A chave `VITE_GOOGLE_MAPS_API_KEY` vai para o bundle do cliente por definição do Vite. Não é defeito e não tem correção no código: a proteção é restrição por referrer e por API no Google Cloud, mais rotação e monitoramento (P1.2-R1) | ação do proprietário |
| DBT-22 | O sintoma `MAPS_CONFIG_MISSING` em produção não teve causa raiz confirmada. A leitura de env funcionava antes e depois da P1.2-R1 (medido em build real); a explicação compatível com a evidência é ausência da variável no serviço que executa `npm run build`, o que exige inspeção da plataforma de deploy | ação do proprietário |
| DBT-23 | O produto não tem backend nativo neste repositório: é frontend Vite consumindo `@base44/sdk`. Um serviço externo no Railway não é automaticamente o backend do frontend — integrar exige contrato de endpoints, autenticação e CORS. `VITE_BASE44_BACKEND_URL` pertence ao SDK da Base44 e não deve ser apontada para outro destino | P3 |
| DBT-24 | Validação de layout real depende de inspeção visual em produção. Os testes de shell provam estrutura e comportamento em JSDOM, que não calcula layout. Playwright não foi adotado | P8 |
| DBT-25 | **Fechado na P1.4.** `src/domain/numeroPtBR.js` lê vírgula e ponto: `'12,5'` → 12,5, `'1.234,56'` → 1234,56, campo em branco → `null` em vez de `NaN`. Aplicado no cadastro de setor e nos payloads de produto e CSV; o teste S3b foi invertido para fixar a leitura correta | fechado |
| DBT-26 | **Parcialmente fechado na P4.1.** `numero_setor` passou a vir de `EntidadeCodigoSequencia`, no escopo `tenant`, dentro da transação da criação — provado com 12 criações concorrentes contra PostgreSQL real (BE-P41-08). `numero_lote` continua com `max + 1` no cliente: `Lote` é P5 | parcial · P5 |
| DBT-27 | A exclusão de setor está **fechada**: não existe `DELETE /setores/:id`, e o frontend recusa com `SETOR_DELETE_UNAVAILABLE` sem ir à rede. Não é omissão — a guarda de vínculo consulta quatro entidades que ainda vivem na Base44, e nenhuma forma de conciliar as duas bases numa operação destrutiva é segura (D-PROD-25 §D). **Reabrir exige reconciliar `deleteRules` com os seis destinos de `syncEntityReferences`, as FKs nativas e a semântica de `Lote` e `PontoSuplementacao`** — não basta "as quatro dependências migraram" (D-PROD-25 §N) | P4.2 |
| DBT-28 | Setor criado **offline** não tem `numero_setor` até o replay: o número vem da sequência do servidor. A tabela mostra o campo vazio nesse intervalo. A alternativa — deixar o navegador escolher — seria reintroduzir o `MAX + 1` que a P4.1 removeu, e ainda por cima sem ver a lista inteira | P4.2 |
| DBT-29 | **Parcialmente fechado na P4.2.** `AreaPastagem` saiu: renomear um setor agora reescreve o `setor_nome` das áreas na mesma transação, nativamente (D-PROD-31). Os outros cinco destinos seguem. `syncEntityReferences` continua na Base44 e continua sendo chamada quando o nome de um setor muda: os **seis** destinos denormalizados (`AreaPastagem`, `PontoSuplementacao`, `Lote`, `LancamentoTarefa`, `MovimentacaoMapa`, `MovimentacaoPecuaria`) ainda são entidades de lá. É a única razão pela qual `Setor` permanece em `allowedBase44Entities`. **Não são os mesmos quatro da guarda de exclusão** — ver D-PROD-25 §N | P4.2 |
| **DEPLOY-MIGRATION-01** | **Fechado.** 01A (runner, gate, provas — D-PROD-28) na PR #19; 01B (ativação no Railway — D-PROD-29) nas PRs #20, #21 e #22. O deployment `f0dab2d0`, originado do merge `257eaaa`, aplicou `20260909201703_p4_1_r2_setor_tipo_default` pelo pre-deploy, em container separado do `backend:start`. Produção passou de **2** para **3** migrations e `Setor.tipo` ganhou o default `'Próprio'` sem ninguém rodar SQL à mão. Fica a regra do achado: configuração de deploy só vale no próximo deployment **originado da fonte** — `redeploy` reexecuta a especificação antiga e não prova ativação | fechado |
| DBT-30 | `deleteRules.Setor` (4 dependências) e os destinos de `syncEntityReferences` (6) não coincidem, e o SSOT tratava os dois como o mesmo contrato até a P4.1-R2. Reabrir o `DELETE` exige reconciliar os dois, mais as FKs nativas e a semântica de `Lote` e `PontoSuplementacao` — D-PROD-25 §N | P4.2 |
| DBT-31 | `AreaPastagem.quantidade_atual` e `status_ocupacao` continuam editáveis pelo cliente. Os dois descrevem ocupação, que é consequência de `Lote` — entidade da P5. Enquanto o lote não for nativo, o backend não tem como derivá-los sem consultar a Base44 (proibido); inventá-los produziria número errado com cara de calculado (D-PROD-30) | P5 |
| DBT-32 | `syncEntityReferences` continua na Base44 e continua citando `AreaPastagem` entre os destinos — ramificação que, desde a P4.2, escreve em dado que ninguém lê. Inofensiva; sai quando os outros cinco destinos migrarem. A propagação que importa passou a ser nativa e transacional (`propagarNomeDoSetor`) | P5–P6 |
| DBT-13 | `test:gates` leva ~42 s porque a catraca de tipos roda `tsc` de verdade em ~45 projetos temporários. É o preço de testar o gate real em vez do parser | P8 |
