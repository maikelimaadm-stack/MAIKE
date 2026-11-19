# MAIKE — Lançamento de Atividades pela área (relatório, D-PROD-251 e D-PROD-252)

> **fatia:** reorganizar o lançamento para quem está no campo · **branch:** `cursor/atividades-por-area-0b6c` · **PR:** a abrir
> Decisão **D-PROD-251** · a partir da `main` `637a3002` (PR #327, D-PROD-249)

O proprietário aprovou a lógica dos rascunhos e pediu o visual do MAIKE. O tipo se cadastra uma vez, longe do dia a dia. Abrir a atividade é o formulário padrão do app, numa tela só (ver §7). No campo, cada área tem o que já foi feito e o custo dela. O total da atividade é a soma.

## 1. O que entra

| Camada | Entrega |
|---|---|
| Tela | `FormularioAtividade` (tipo, áreas e data numa tela só; ver §7); `FluxoPorArea` (cartões, detalhe agrupado, "o que registrar", confirmação); lista com situação e custo em palavras simples; Tipos de atividade com "O que pode registrar" |
| Regras de tela | `src/lib/atividadeFluxoCampo.js` (situação, progresso, grupos pasto/lavoura, opções de registro, frase da confirmação, movimentos por tipo) |
| Abastecimento pela área | `JanelaAbastecimentoDaArea`: o mesmo formulário, revisão e confirmação da tela Abastecimentos, ligado ao registro do dia da área. Não passa mais por "Ajustar um dia" |
| Implementos | Opção "Implemento" (só se o tipo permite) abre o formulário da máquina; na área há o grupo "Implementos" ao lado de "Máquinas", com os usos e a nota de que o custo está em Máquinas |
| O que não muda | Servidor, banco, permissões, formulários de linha, estoque, medidor. "Mais detalhes" guarda o ajuste por tipo e por dia |

## 2. Migration `20261118100000_atividade_areas`

Já está no repositório (D-PROD-249, CONTRACT, SHA `098f0d06d45922886f64cb4e2f4bd00644dac26b833e8020feeed2632d31ec06`). O registro original daquela decisão dizia **`SCHEMA_APPLIED_PROD: NÃO`**. Depois, em **2026-11-18 às 19:05:13 UTC**, ela foi **aplicada em produção** pelo caminho B (`SCHEMA_APPLIED_PROD: SIM`; postcheck `APLICADA E CONFERIDA`, 68/0, 97 tabelas; registro no runbook §9). Esta entrega não cria nem aplica migration.

### O que depende da migration (já aplicada)

Começar a área e gravar registros na área (inclusive o abastecimento, que se liga ao registro do dia da área) dependem da `20261118100000_atividade_areas` em produção, que já está aplicada (2026-11-18 19:05:13 UTC). Falta só esta entrega chegar à `main`.

### Regras que o campo precisa saber

- Abastecimento na área exige um registro do dia na área: sem nenhum, a tela diz "registre antes uma máquina neste lugar".
- Implemento não tem custo próprio no servidor; o grupo mostra "N usos". O custo está em Máquinas.
- A opção de abastecimento só aparece com a permissão de novo abastecimento.

## 3. Como ver na máquina do proprietário

Pasta separada, para não mexer no checkout que já está na porta 5173:

```bash
git fetch origin cursor/atividades-por-area-0b6c
git worktree add ../MAIKE-atividades cursor/atividades-por-area-0b6c
cd ../MAIKE-atividades
npm install
```

Copie o `.env` e o `.env.local` do checkout que já funciona (não versionar). O frontend precisa de `VITE_MAIKE_API_URL` (em desenvolvimento, `http://localhost:3333`). O backend precisa de `DATABASE_URL`, `AUTH_SECRET` e `FRONTEND_ORIGINS` incluindo `http://localhost:5174`.

```bash
npm run dev -- --port 5174
```

O backend, se for o mesmo da porta 3333 que já está no ar, não precisa de outro processo. Se subir outro, use outra `PORT` e aponte o `VITE_MAIKE_API_URL` para ela. A porta 5173 não é usada por este comando.

## 4. Prévia

`vercel.json` deixa esta branch passar no `ignoreCommand`, junto com `main` e `codex/previa-detalhes-mapa`. O endereço da prévia aparece no comentário da Vercel no PR, depois do build.

## 5. Verificação

| Comando | Resultado |
|---|---|
| `npm run verify:all` | todas as etapas passam, **exceto** `test:backend` e `test:smoke` (abaixo) |
| `npm run test:smoke` | 3.664 passam; 3 falham, todos em `lancamentoSuplementacaoDataFazenda.test.jsx` (LD-1, LD-2, LD-3). Falham igual sem estas mudanças: esperam a data do relógio da máquina em 13/11/2026 e o relógio daqui está em 12/11. Não são desta entrega |
| `npm run test:backend` | **não rodou**: não há PostgreSQL nesta máquina (sem `DATABASE_URL`, sem Docker). O servidor não foi alterado nesta entrega. Rodar na CI ou com `npm run db:up` |
| Testes novos | `tests/smoke/atividadeFluxoCampo.test.js` (4), `LL-ABAST-AREA-1` e `-2` (abastecimento pela área, permissão), implemento em `LA-RAIO-2` |

Palavras da confirmação: "Registro salvo. Foi anotado em Pasto 01, na atividade Adubação."

## 6. Ajuste do visual (feedback do proprietário)

O caminho foi aprovado; o visual dos lançamentos, não ("parecia tudo feito só para celular; abre janela atrás de janela, uma pergunta por tela"). A entrega passa a reusar o padrão que o app já tem.

**Padrão adotado (lido no código, não suposto):**

| Peça | Componente |
|---|---|
| Janela do lançamento por tipo (abas, cabeçalho, dia, rodapé Voltar / Salvar / Confirmar) | `JanelaLancamentoPorTipo` + `B1Janela` (já responsiva; tela cheia só no celular, como no resto do app) |
| Formulários de máquina, implemento, produto, mão de obra e serviço | `JanelasDaLinha` (`JanelaLinhaMaquina`, `JanelaLinhaProduto`, `JanelaLinhaMaoObra`, `JanelaLinhaServico`) com `CampoSelect`, `CampoDia`, `CampoNumero` |
| Abastecimento | `FormularioAbastecimento` + `DialogoPreviaAbastecimento` (`useFluxoAbastecimento`) |
| Botões e avisos | `BOTAO_PRIMARIO` / `BOTAO_SECUNDARIO`, `AvisoGestao`, cartão `b1-aba-cartao` |

**O que mudou (só `FluxoPorArea.jsx`):**

- some a tela "O que você quer registrar?" à parte: ela virou uma seção dentro da tela da área, em grade de 1, 2 ou 3 colunas conforme a largura;
- a confirmação deixou de ser uma tela cheia com botões grandes: é um aviso no alto da área, com a mesma frase ("Foi anotado em …") e o botão Fechar;
- botões no tamanho padrão do app (sem `min-h-12 w-full`);
- cada opção abre direto o formulário de sempre (um passo a menos).

**Mantido:** fluxo tipo → áreas → área → registrar; agrupamento por tipo; totais por área; frases em português simples; testids. Backend, API e migrations **sem mudança**. A `20261118100000_atividade_areas` já está **aplicada** em produção (2026-11-18 19:05:13 UTC); nenhuma migration nova.

Verificação desta rodada: testes de lançamento 161 passam; `npm run test:smoke` 3.665 passam e 3 falham (LD-1, LD-2, LD-3 em `lancamentoSuplementacaoDataFazenda.test.jsx`, fuso do relógio, já falhavam antes); `verify:all` passa em tudo, exceto `test:backend` (sem PostgreSQL aqui) e esse `test:smoke`.

## 7. Segunda rodada do visual: abrir a atividade também é o formulário do app

O proprietário mostrou a tela "Que trabalho é este?" (cartões grandes, "Toque só uma vez", "Continuar"): o assistente de três passos tinha ficado com o visual de celular que ele já recusou. A rodada anterior o mantinha por engano.

| Mudança | Detalhe |
|---|---|
| `AssistenteNovaAtividade` | **Removido** (arquivo apagado). "Nova atividade" abre o `FormularioAtividade`, que já tinha as áreas por caixas de marcar (D-PROD-249) |
| Padrão reaproveitado | `FormularioAtividade`, `SeletorAreasDaAtividade`, `CampoSelect`/`CampoTexto`/`SecaoForm`/`AvisoGestao` (`GestaoFormParts`), `CampoDia`, `CadastroFormShell`, `CadastroFormActions` (Cancelar / Abrir atividade) |
| Nota do tipo | Sob o seletor de tipo: "Este tipo permite registrar: máquinas, …" (`data-testid="atividade-tipo-registra"`); texto, não cartões |
| `modoCampo` | Removido de `JanelaLancamentoPorTipo`, `FluxoPorArea`, `AtividadeAberta` e da página. Rótulos e título voltam ao padrão ("Dia do lançamento", "Lançamento do dia", "Área do dia (ha)", "Salvar e fechar"). O aviso na área depende só da área fixa da janela |
| Mantido | Fluxo tipo → áreas → área → lançar; grupos e totais por área; abastecimento e implemento pela área; `atividadeFluxoCampo.js` (só regras e textos, sem layout) |
| Servidor / banco | Sem mudança. Nenhuma migration criada ou aplicada por esta entrega; a `20261118100000_atividade_areas` já está **aplicada** em produção |
| Testes | `LA-CABECALHO-1` volta a ser o formulário numa tela só (e confere a nota do tipo). Os testes do assistente (`assistente-*`) saíram junto com o componente |

## 8. Terceira rodada: o campo Áreas é uma lista fechada com pesquisa, e a escolha vira tabela

| Item | Detalhe |
|---|---|
| Campo | `SeletorAreasDaAtividade`: `B1Field` + botão `b1-select-btn` (visual do `CampoSelect`), fechado, "Selecione as áreas…"; com escolhas mostra o nome ou "N áreas selecionadas" |
| Lista | Popover Radix `mk-map-multi-popup` (o de `B1MultiSelecao` / `MapaFiltroSelecao`, sem tocar neles), com "Pesquisar…" e uma caixa por pasto/talhão (nome, tipo, setor, tamanho). Marcar atualiza a tabela na hora; fechar mantém. Não aparece aberta |
| Tabela | `b1-tipo-tabela`: Área · Tipo (`grupoDaArea`: Pasto / Talhão / Outra) · Setor · Tamanho (ha) · Hectares (ha) editável · ✕ + total. Celular: os cartões de antes, agora com o tipo |
| Remover / voltar | ✕ tira a linha e desmarca na lista; marcar de novo restaura o tamanho cadastrado como padrão |
| Hectares | **Gravados em `AtividadeArea.area_planejada`**: `corpoDasAreasDaAbertura` → `corpo.areas` no `POST /atividades`; `atividadesApi` já aceita `area_planejada`. Nada em modo só leitura |
| testids | Mantidos; novos `areas-abertura-campo` (o botão) e `areas-abertura-lista` (o popover). Busca e opções só existem com a lista aberta |
| Servidor / banco | Sem mudança. A `20261118100000_atividade_areas` já está **aplicada** em produção (2026-11-18 19:05:13 UTC); nenhuma migration nova |
| Testes | `AR-ABERTURA-1..3` (fechado; busca; marcar; colunas; editar ha; tirar desmarca; marcar de novo restaura) e `LA-CABECALHO-1` abrindo a lista antes de marcar |

## 9. Quarta rodada: o lançamento organizado (D-PROD-252)

| Item | Detalhe |
|---|---|
| Atividade | `FluxoPorArea`: (linha de resumo e contadores saíram na Emenda 2) `CardAreasDaAtividade` como tabela única (Área, Situação, Planejada, Feita, %, Custo, Último lançamento, ⚡, total). O nome abre a área; o ⚡ abre / inicia / conclui / reabre / altera a planejada / remove. Sem cartões, sem "Registrar nesta área", sem o card de 12 células |
| Área | `LancamentosDaArea` (novo): o nome da área e o da atividade (sem repetir hectares e custo, Emenda 1), botões "+" e a tabela Ações · Tipo · Dia · Item · Quantidade · Valor (celular: Valor e Quantidade antes de Item e Dia), total do servidor, ⚡ Editar / Cancelar. Regras puras em `src/lib/lancamentosDaAreaRegras.js` |
| Lançamento novo | `JanelaLancamentoPorTipo` reescrita: um nível, só Dia e os campos do tipo; Cancelar / Salvar / Salvar e novo. Os formulários são os de `JanelasDaLinha` |
| Abastecimento | `JanelaAbastecimentoDaArea`: sem Atividade / Lançamento travados; "Confira antes de confirmar" na mesma janela (`CorpoDaPreviaAbastecimento`, extraído de `DialogoPreviaAbastecimento`); `FormularioAbastecimento` ganhou `botoesNoRodape` |
| Resumo das áreas | `ResumoDasAreas`: `por_area` dos totais; colunas Área · ha · Máquinas · Insumos · Mão de obra · Serviços · Abastecimento · Total · R$/ha e a linha de total; zero vira "—"; sem Tipo, sem Implementos, sem nota (Emenda 1; a primeira versão tinha Tipo e uma nota sobre o implemento) |
| Celular | Janela em tela cheia (`b1-janela--tela-cheia` / `b1-janela__camada--tela-cheia`), também no abastecimento e em Editar uma linha; tabelas continuam tabelas (`b1-tipo-tabela__rolagem`), sem `.b1-tipo-card` |
| Dias | **Emenda 1:** "Dias lançados", "Ajustar um dia" e "Área do dia" saíram da tela (a primeira versão os deixava recolhidos no Resumo da atividade). Cada linha tem a data dela; o registro do dia segue por baixo, criado com o primeiro item da data |
| Feita / R$/ha | **Emenda 1:** a Feita (ha) é editável na linha da área (coluna Feita e ⚡ "Hectares feitos"): o valor vai no lançamento confirmado mais novo da área (`area_executada_dia`, `PATCH` de sempre) e os outros ficam sem valor, então a soma do servidor é o digitado. Sem endpoint novo. A dose/ha do produto usa a Feita da área ou, sem ela, a planejada. Sem Feita, "—" |
| Outros pedidos | **Emenda 1:** sem subtítulo da lista; sem o aviso "Reaberta em …" (os dados ficam no histórico); com uma área aberta, abas e "1 registro" escondidos e só um total (o do rodapé) |
| **Emenda 2 (Base1)** | Revisão do proprietário sobre o commit `b83a518d`: a tela não seguia o modelo Base1. **Referência oficial:** a lista do Lançamento de Atividades (`CadastroBase1Screen` → `CadastroListaChrome` → `CadastroBase1Grade` → `Base1Grid`, `BASE1_LISTA_INTEGRADA_VISUAL`), a mesma casca de Tipos de atividade, Produtos e Lotes. As quatro tabelas (áreas da atividade, lançamentos da área, Resumo das áreas e itens do Resumo da atividade) passam a ser a **mesma grade**, pelo invólucro `TabelaBase1`, sem `b1-aba-cartao`; o total é o `<tfoot class="mg-grid-foot">` e o "N registros" / tamanho da página do Base1 fica no fim da casca (a aba preenche a altura: `b1-form--tabela`). `gridFooter` de `CadastroBase1Grade` aceita função (recebe os ids das colunas visíveis). Saíram: a linha "Aberta · desde …" (`fluxo-resumo`, `linhaResumoDaAtividade`, `textoCustoComPorHa`), o título e os contadores do cartão de áreas, o banner "Foi anotado em …" (`registro-confirmado`, `fraseDoRegistro`, `recado`, `onGravou`; o aviso é o toast `notifySuccess`, também no abastecimento). Resumo da atividade: um detalhe de cadastro (`SecaoForm`, `ValorCalculado`) com os valores únicos como campos e os itens numa tabela Tipo · Item · Quantidade · Custo. As colunas das duas tabelas de lançamento, no celular e no computador, seguem as da Emenda 1. Capturas do app real: `impl3-*.png` |
| **Emenda 3 (janelas)** | Revisão do proprietário sobre o commit `c0d98ca6` ("as aberturas estão estranhas: tem hora que fica pequeno, tem hora que fica grande; os dados mais organizados"). **Tamanho padrão:** `B1Janela` (680px, `min(86vh, 720px)`, corpo que rola, título e ✕ em cima, botões embaixo; celular em tela cheia). Antes: lançamento por tipo 960px; diálogos da área, Concluir atividade, Cancelar linha / lançamento e Reabrir / Cancelar atividade ~512px (`max-w-lg`); revisão e cancelamento do abastecimento 560px; abastecimento da área e Editar linha 680px. Depois: 680px em todas. `b1-janela--tipo` e `b1-janela--estreita` saíram; `DialogoAcao` ganhou `janelaBase1`. **Conteúdo:** o formulário dos cadastros (`SecaoForm` + `mg-b1-form-grid`): o Dia é o primeiro campo do grupo Lançamento (uma grade só, não duas), grupos Uso / Quantidade / Quantidade e custo / Valores, sem subtítulo, sem contexto repetido e sem textos de ajuda; valores calculados como campos de leitura; Concluir atividade com o Resumo em campos (sem barra, sem "Faltam…", sem nota). O "Repetir" fica como era. Capturas: `impl4-*.png` e `impl4-contact-desktop.png` |
| Servidor / banco | Sem mudança; nenhuma migration |
| Testes | `LL-JANELA-TIPO-1..9` (novo fluxo), `LL-ABERTA-1..8, 10`, `LL-ABAST-AREA-1..2`, `LA-RAIO-2, 5`, `AR-CARD-1..4` e `AR-CARD-FEITA`, `RA-1..2`, `FL-1..3`, `LAR-1..2` e `LAR-FEITA`; `LL-ABERTA-6` (sem dias), `LA-LISTA-1` (sem subtítulo), `LA-ACOES-2` (sem aviso de reabertura). Os testes antigos da lista por dia seguem por `tests/smoke/helpers/diasLegadoNoTeste.jsx`. Capturas do app real: `impl-desktop-*` e `impl-mobile-*` |


## 10. Quinta rodada: Detalhes da área e "Registrar serviço" (D-PROD-254)

| Item | Resultado |
|---|---|
| Pedido | Maquetes `area-*` aprovadas ("pode implementar"); a tela de Atividades misturava planejar e registrar |
| Mapa | `DetalhesArea` na casca do lote: Detalhes (cartão, atividades em andamento, custos do mês) · Histórico (registros de campo); rodapé Manejos + Histórico completo; Manejos lista os tipos ativos do cadastro; escolher abre o registro com a área presa |
| Atividades | "+ Nova atividade" (planejar) e "Registrar serviço" (registrar), o mesmo `JanelaRegistroDeCampo`, o mesmo `POST /atividades/registrar` |
| Servidor | `POST /atividades/registrar` (acha a atividade aberta do tipo com a área no mês, a de `updatedAt` mais recente; senão abre `<Tipo> · <Área> · <mmm/aa>`), `GET /atividades-por-area/:areaId/resumo` e `/registros`; sem migration |
| Preservado | Curral/Abate, Medição de Forragem, Histórico completo com exclusão do administrador |
| Testes | `tests/smoke/detalhesAreaHistorico.test.jsx` (reescrito), `LA-REGISTRAR-1..4` em `lancamentoAtividades.test.jsx`, `backend/tests/atividadeRegistro.test.mjs` |
| Capturas | `/workspace/maike-cc-shots/impl-area-{desktop,mobile}-{detalhes,historico,manejos,registro-gradeacao,atividades,atividades-registrar}.png` |
| Emenda 1 (feedback do proprietário) | "O abastecimento deve ser feito na opção de máquina, … que daí já lanço hora etc." Abastecimento saiu dos Manejos da área e do "Registrar serviço" (critério: nome do tipo, sem id fixo) e o servidor o recusa com 422. Agora: Atividades › área › **+ Máquina › Salvar e abastecer** (grava as horas e a mesma janela vira o abastecimento da máquina) ou **⚡ da linha da máquina › Abastecer**. Reaproveita `JanelaAbastecimentoDaArea` / `useFluxoAbastecimento` (tanque, litros, horímetro e revisão dentro da janela). O botão "+ Abastecimento" da área foi removido; a tela Abastecimentos e o bloco do detalhe do lançamento ficam |
| Testes da emenda | `atividadeRegistro.test.mjs` (422 do tipo Abastecimento), `atividadeFluxoCampo.test.js` (FC-1/FC-3), `detalhesAreaHistorico.test.jsx` (Manejos e formulário genérico sem Abastecimento), `lancamentoAtividadesLinhas.test.jsx` (LL-ABAST-AREA-1..3) |
| Capturas da emenda | `/workspace/maike-cc-shots/impl-area-{desktop,mobile}-manejos.png`, `impl-maquina-abastecimento-{desktop,mobile}.png` |
