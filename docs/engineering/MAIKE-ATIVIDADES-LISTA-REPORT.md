# MAIKE-ATIVIDADES-LISTA — Relatório

> **fatia:** 4 (lista: filtros e celular) · **branch:** `feat/atividades-lista-filtros-celular` · **PR:** #325

Decisão: [D-PROD-237](./DECISIONS.md) · a partir da `main` `83d08e5c` (PR #324). Fatias anteriores:
[D-PROD-232](./MAIKE-ATIVIDADES-MENU-RAIO-REPORT.md) (menu ⚡ e Concluir),
[D-PROD-233](./MAIKE-ATIVIDADES-JANELAS-TIPO-REPORT.md) (janelas por tipo) e
[D-PROD-234](./MAIKE-ATIVIDADES-ABERTA-RESUMO-REPORT.md) (atividade aberta).

Quarta e última fatia do redesenho do **Lançamento de Atividades** pelo protótipo HTML do proprietário: a **lista**. O
pedido: "renovar também os filtros lá em cima, aqueles 4 filtros que estão soltos: tipo de atividade, área, início,
até". A caixa solta sai; os filtros viram pílulas da faixa do motor Base1, na ordem do protótipo; e os cards do
celular ganham o selo do tipo, "Nº · Status" e os campos em duas colunas. O modelo visual continua o do sistema.

## 1. Entrega

| Camada | O que entrou |
|---|---|
| `LancamentoAtividades.jsx` | Sai a caixa `atividades-filtros` (CampoSelect Tipo, CampoSelect Área, CampoDia Início de / até). `filtrosDaTela` = **Status** · **Tipo de atividade** (com os inativos marcados) · **Área** (`ocultarPadrao`) · **Início** (`tipo: "periodo"`, `testId` `atividades-filtro-inicio`), cada um com a `coluna` que cobre. A grade recebe `quickFilterIds` vazio (sem pílulas automáticas), `quickSortOptions` em palavras da tela ("Nº (mais recentes primeiro)"), `cardsAvatar` (sigla e cor do tipo) e `cardsSubtitle` ("Nº 7 · Aberta"). Campos padrão do card: Nº, Tipo de atividade, Área, Início, **Valor total** |
| `FiltrosRapidos.jsx` (motor) | `FiltroDaTela` = `FiltroDeEscolha` \| `FiltroDePeriodo`. `JanelaDoPeriodo` (De / Até lado a lado, rascunho até o ✓, aviso do período invertido e ✓ desligado, "Limpar datas", Enter aplica; na folha do celular, ✓ no topo). `textoDoPeriodo`, `filtroDaTelaAtivo`. `ocultarPadrao`. "Pesquisar…" nas listas de escolha com mais de 8 opções. Coluna coberta fora da faixa salva e do "+ Filtro". "Limpar filtros" e o ✕ da pílula tratam o período |
| `Base1Cards.jsx` / `CadastroBase1Grade.jsx` (motor) | `avatar` / `cardsAvatar` e `subtitle` / `cardsSubtitle`, opt-in; o selo ganhou `data-testid="b1-card-avatar"` |
| Regras puras (`lancamentoAtividadesRegras.js`) | `siglaDoTipoAtividade`, `PALETA_TIPO_ATIVIDADE` (8 tons, contraste ≥ 4,5:1 com branco), `corDoTipoAtividade` (pelo id do tipo) |
| CSS (`cadastro-base1.css`) | `.b1-fr-periodo*` (a janela do período; no celular, um campo embaixo do outro, 44 px) e o ✓ desligado. Fica fora de `base1-design.css`, que é a cópia mecânica do design (sem edição à mão, sem tamanho de fonte) |

## 2. Os filtros continuam no servidor

| Pílula | Parâmetro de `GET /atividades` | Padrão |
|---|---|---|
| Status | `status` | Todos os status (sem parâmetro) |
| Tipo de atividade | `tipo_atividade_id` | Todos os tipos |
| Área | `area_id` | Todas as áreas |
| Início (De / Até) | `data_de` / `data_ate` | sem datas |

A chave da consulta da lista leva os filtros: cada mudança relê a lista keyset do começo (como antes). O período
aplicado nunca é invertido (o ✓ não aplica); a guarda antiga da página (`periodoInvertido` → lista desligada) ficou,
por segurança. Trocar de fazenda continua limpando a área.

## 3. Ressalvas e perguntas em aberto

- **Selo do card:** no protótipo, o selo repete as letras do **nome** ("CIG" para "CIGARRINHA PIQUETE 02", que é do
  tipo Pulverização). Aqui é a **sigla do tipo** ("PUL") com a cor do tipo, como a missão pediu. Se o proprietário
  preferir o nome, é uma linha em `seloDoCardAtividade`.
- **Cor do tipo:** o cadastro de Tipos de Atividade não tem cor; a paleta é fixa e determinística (o mesmo tipo
  sempre na mesma cor; dois tipos podem coincidir, com 8 cores).
- **Pílulas no padrão** mostram só o rótulo ("Status ⌄"), como no protótipo; na folha do celular, o valor aparece
  ("Todos os status") como nas outras telas.
- **Quem já tinha pílulas salvas** na faixa desta lista (navegador): a do tipo, da área ou do início deixa de aparecer
  (é coberta pela pílula da consulta); as outras (ex.: Máquina) continuam depois do Início.
- **Campos do card:** quem já personalizou os campos dos cards mantém a escolha (o Valor total entra só no padrão).
- O campo de data aparece como `mm/dd/yyyy` nas imagens porque o Chrome sem interface usa o inglês no seletor nativo.

## 4. Testes e gates

| Item | Resultado |
|---|---|
| `tests/smoke/lancamentoAtividades.test.jsx` | **LA-LISTA-2** reescrito para as pílulas (status, tipo, área, período invertido com o ✓ desligado). 11 novos (**LA-FILTROS-1 a 11**): sem a caixa solta e a ordem das pílulas (sem "Tipo de atividade" duplicado; "+ Filtro" sem os campos cobertos e com Máquina / Conclusão); a faixa salva antes não duplica; cada pílula manda o seu parâmetro e o ✕ tira só aquele; Início com De / Até, o período no rótulo, rascunho, ✕ da janela e "Limpar datas"; "Limpar filtros"; pesquisa com mais de 8 áreas; cards do celular (selo, cor por tipo, título, "Nº · Status", ⚡, campos e valores); folha "Filtros" do celular com as mesmas pílulas (tipo e período no servidor, invertido não aplica, Limpar filtros); computador sem cards e a ordem "Nº (mais recentes primeiro)"; regras puras; o card do motor sem / com `avatar` e `subtitle` |
| `npm run test:smoke` | 269 arquivos, **3.287 testes**, todos passando |
| `node scripts/gates/verify-all.mjs --pular=test:backend` | todas as etapas passam; `gate:types` sem regressão (479 de 625) |
| Backend | nenhuma mudança (não rodado) |

## 5. Imagens para o proprietário

Harness local (Vite + Playwright, a página real com sessão, fazenda, tipos e áreas e um backend falso que filtra pela
query; sem o menu do topo do app), 1440×900 e 390×844, `deviceScaleFactor` 2, na pasta de rascunho da sessão
(`scratchpad/fatia4-shots/`): `d1-lista-pilulas.png` (a faixa fechada), `d2-inicio-aberto.png` (janela do Início
com De / Até), `d3-inicio-invertido.png` (o aviso e o ✓ desligado), `d4-inicio-aplicado.png` ("Início 03/11 – 17/11"
e a lista filtrada), `d5-tipo-aberto.png`, `d6-tipo-aplicado.png`, `c1-lista-cards.png` (cards do celular),
`c2-filtros-folha.png` (folha "Filtros"), `c3-filtro-inicio.png` (Início no celular), `c4-lista-filtrada.png`.
