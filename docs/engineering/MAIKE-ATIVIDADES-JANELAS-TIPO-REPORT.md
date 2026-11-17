# MAIKE-ATIVIDADES-JANELAS-TIPO — Relatório

> **fatia:** 2 (janelas por tipo) · **branch:** `feat/atividades-janelas-tipo` · **PR:** a abrir

Decisão: [D-PROD-233](./DECISIONS.md) · a partir da `main` `48ec6ca3` (PR #319). Fatia 1: [D-PROD-232](./MAIKE-ATIVIDADES-MENU-RAIO-REPORT.md).

Segunda fatia do redesenho do **Lançamento de Atividades** pelo protótipo HTML do proprietário: cada item de lançar do
menu ⚡ da lista abre a **janela do tipo** (Trabalho de máquinas, Aplicação de insumos, Mão de obra, Custos extras),
com a lista do tipo no dia, **Inserir**, a aba **Dados**, **Salvar** e **Salvar e fechar**. O modelo visual continua o do
sistema (`B1Janela`, campos e botões do motor, abas `b1-panel-tab`, o ⚡ da fatia 1); do protótipo vieram o desenho e
a ordem das partes.

## 1. Regra do dia (aprovada pelo proprietário: "pode ser")

| Situação na data escolhida | O que acontece ao salvar o item |
|---|---|
| Nenhum lançamento CONFIRMADO (ou só cancelado) | O lançamento do dia nasce **com o item, no mesmo envio**: `criarApontamento` com `maquinas[]` / `produtos[]` / `mao_obra[]` / `servicos[]` (uma transação no servidor, `operation_id` persistente — o mecanismo do "Repetir"). O corpo leva a data e, se informada, a **área do dia** do cabeçalho (opcional no servidor, opcional aqui) |
| Um lançamento CONFIRMADO | O item entra nele pelas rotas de linha de sempre, com a `versao` dele (a resposta atualiza a versão para o próximo item) |
| Mais de um (turnos / passadas) | Aparece o seletor **"Lançamento do dia"** (ex.: "Tarde · 2ª passada"); padrão: o mais recente (maior passada) |

O dia começa **hoje no fuso da fazenda**; **‹ ›** e o campo de data trocam o dia (nunca depois de hoje). A área do dia
que já existe aparece só para leitura, com o **lápis** que abre o formulário do dia de sempre (PATCH com a `versao`).
Fora do período da atividade: o aviso de sempre (o servidor aceita com alerta, que vira aviso depois de salvar).

## 2. Entrega

| Camada | O que entrou |
|---|---|
| `JanelaLancamentoPorTipo.jsx` (novo) | Título com o ícone do tipo; "Atividade Nº 7 · TIPO · Talhão: ÁREA · Lançamento de DD/MM/AAAA · N ha"; o dia (‹ data ›, seletor do lançamento, área do dia); abas **"<Tipo> (n)"** / **"Dados"**; rodapé **Fechar** (na aba Dados, **Voltar / Salvar / Salvar e fechar**). Lista: as colunas do protótipo **que a linha gravada tem**, a linha de **Total**, o ⚡ da linha com **Editar** (janela de edição de sempre) e **Cancelar** (diálogo de sempre), "Mostrar canceladas (k)". `LANCAMENTOS_POR_TIPO` (rótulo, aba, flag, ícone) é a lista que o menu ⚡ usa. No celular, a janela ocupa a tela (`b1-janela--tela-cheia`) |
| `JanelasDaLinha.jsx` | As janelas de produto, máquina, mão de obra e serviço ganharam `Casca` (onde o formulário aparece: a janela própria, por padrão, ou a aba Dados) e `novoDia` (o dia ainda não existe: a linha vai no lançamento novo; o corpo do dia fica guardado no envio, então "Repetir o mesmo envio" repete o mesmo corpo com a mesma chave; "Consultar" procura o lançamento novo do dia com a linha). Campos, validação, saldo / FIFO, medidor e "Última leitura", custos e `operation_id`: **os mesmos**. `DialogoCancelarLinha` (exportado) |
| `LinhasDoApontamento.jsx` | Usa `DialogoCancelarLinha`; sai `abrirAoMontar` |
| `ListaApontamentos.jsx` / `FormularioApontamento.jsx` | Saem `abrirLinha` e `lancamentoDoTipo` (o fluxo provisório da fatia 1) |
| `LancamentoAtividades.jsx` | O ⚡ abre `JanelaLancamentoPorTipo`; depois de cada escrita, a lista de atividades e o totalizador se relêem e o cabeçalho devolvido vai para o cache do detalhe |
| Regras puras | `confirmadosDoDia` (`atividadeApontamentoRegras.js`); `totalDasLinhas`, `CAMPO_DO_VALOR_DA_LINHA`, `rotuloDoLancamentoNoDia` (`atividadeLinhasRegras.js`) |
| CSS | `base1-design-ajustes.css` (`b1-janela--tipo` larga, `--tela-cheia` no celular); `cadastro-base1.css` (cabeçalho do dia, abas, tabela do tipo, o menu ⚡ acima das janelas) |

Sem backend, sem banco, sem migration; nenhuma rota, corpo ou regra do servidor mudou.

## 3. Diesel

**Fora desta fatia.** O abastecimento ligado ao dia (`AbastecimentoBem` com `apontamento_id`, D-PROD-211) passa pelo
`useFluxoAbastecimento`: produto, origem (estoque ou posto), prévia do custo e confirmação, e precisa do lançamento já
gravado. Um "Diesel (L)" dentro da máquina seria outro envio, fora da transação da linha, e outra tela de custo — um
segundo motor, o que a missão proíbe. O diesel continua no bloco **Abastecimentos** do dia, na atividade aberta; a
coluna "Diesel" do protótipo fica para quando a janela puder abrir o fluxo do abastecimento já ligado ao dia (Fatia 3
ou missão própria).

## 4. Fora do escopo e ressalvas

- Atividade aberta redesenhada (Fatia 3), cards do celular (Fatia 4), "Múltiplos talhões".
- **Operador** do formulário do protótipo: o operador é do **lançamento do dia**, não da linha. A coluna "Operador"
  mostra o do dia; para mudar, o lápis do dia. O dia que nasce com o item não leva operador (vai pelo lápis depois).
- **Valor da hora (cadastro)** e "Valor do diesel" do protótipo: o custo da máquina continua o que o servidor calcula
  (custo de uso do cadastro do bem) e aparece na lista depois de salvar, como nas janelas de linha.
- Trocar o dia com o formulário de Dados aberto recomeça o formulário (ele é do dia escolhido: o medidor é lido na data).

## 5. Testes e gates

| Item | Resultado |
|---|---|
| `tests/smoke/lancamentoAtividades.test.jsx` | **LA-RAIO-5** reescrito: o ⚡ abre a janela do tipo com hoje, o subtítulo, a regra do dia e a lista vazia; Fechar fecha sem gravar |
| `tests/smoke/lancamentoAtividadesLinhas.test.jsx` | 9 novos (**LL-JANELA-TIPO-1 a 9**): sem dia, o primeiro item cria o lançamento (POST com `maquinas[]`, `area_executada_dia`, `operation_id`), Salvar fica num Dados vazio, o segundo item vai pela rota da linha com a versão nova e Salvar e fechar fecha; dia com um lançamento (rota da linha, `versao`) e ‹ › (o dia só com cancelado = sem dia; › para em hoje); vários no dia (seletor, padrão o mais recente, o item entra no escolhido); a lista só do tipo e do dia, com colunas, total e canceladas atrás do "Mostrar"; ⚡ da linha com Editar (PATCH) e Cancelar (motivo); sem resposta ao criar o dia, "Repetir o mesmo envio" repete o mesmo corpo e chave e o dia não duplica; mão de obra e custos extras (o custo extra cria o dia com `servicos[]`); só leitura (concluída: sem Inserir, Dados desabilitada, sem ⚡; sem lançar / editar: só Cancelar no ⚡); celular em tela cheia pelo ⚡ do card |
| `npm run test:smoke` | 265 arquivos, **3.249 testes**, todos passando |
| `node scripts/gates/verify-all.mjs --pular=test:backend` | todas as etapas passam (`test:backend` roda no CI, precisa de PostgreSQL); `gate:types` sem regressão (479 de 625; a `DestinoDoEnvio` tipada com `TipoDeLinha`) |

## 6. Imagens para o proprietário

Harness local (Vite + Playwright, a página real com sessão, fazenda, tipos, áreas e um backend falso; sem o menu do
topo do app), 1440×900 e 390×844, `deviceScaleFactor` 2, na pasta de rascunho da sessão (`scratchpad/fatia2-shots/`):
`d1-maquinas-lista.png`, `d2-maquinas-dados.png`, `d3-dia-varios-lancamentos.png` (seletor do lançamento do dia),
`d4-dia-sem-lancamento.png` (o dia que nasce com o primeiro item, área opcional), `d5-insumos-lista.png`,
`d6-insumos-dados.png`, `d7-maoobra-lista.png`, `d8-extras-lista.png`, `c1-maquinas-folha.png` e
`c2-maquinas-dados-folha.png` (celular, tela cheia). O campo de data aparece como `mm/dd/yyyy` porque o Chrome sem
interface usa o idioma inglês no seletor nativo.
