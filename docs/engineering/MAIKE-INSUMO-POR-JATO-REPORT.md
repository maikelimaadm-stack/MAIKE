MAIKE-INSUMO-POR-JATO (D-PROD-283) · `claude/tipo-tarefa-drop-colunas-1aznvv` · PR (a abrir)

# Relatório — Entrega B: "Jatos de hoje" (insumo por jato, sem cadastro de mistura)

Maquetes aprovadas pelo proprietário em 2026-11-24 (`jatos-sem-mistura.png` e `jatos-com-maquina.png`), com o botão
**"Editar"** no lugar de "Mudar". "Por enquanto sem mistura."

## O que mudou

### 1. Banco (migration EXPAND, ainda não aplicada em produção)

`20261125100000_insumo_por_jato`: 1 coluna anulável `jato` INTEGER em `AtividadeApontamentoProduto`, sem DEFAULT e sem
CHECK (a API confere 1..999). Checksum `725a8c5a…3551`, pinado em `MIGRATIONS_APROVADAS`; coluna exigida pelo preflight
do deploy. Runbook: [`MAIKE-INSUMO-POR-JATO-RUNBOOK-RELEASE.md`](./MAIKE-INSUMO-POR-JATO-RUNBOOK-RELEASE.md).

### 2. Servidor

- **Cada produto de cada jato é uma linha de insumo de sempre**, com o número do jato. A baixa FIFO, o custo, o estorno
  e o recálculo não mudam: o estoque cai pela soma dos jatos.
- `produtos[]` do lançamento (`POST /atividades/registrar`, `POST …/apontamentos`, `…/duplicar`) aceita `jato` em texto
  ("1" a "999"); fora disso, ou em número, 400 e nada gravado. Sem `jato`, a linha e o fingerprint de antes.
- A linha pública de insumo traz `jato` (nulo sem jato). Editar a quantidade da linha de um jato mantém o jato.
- `GET /atividades-opcoes/implementos` traz `jato: { capacidade, unidade }` quando o tipo do implemento é "por jato"
  (D-PROD-279); senão `jato: null`.
- A linha de máquina traz `implemento.jato` só quando o implemento é "por jato" (as outras, a forma de sempre). É assim
  que o "Novo lançamento", que repete a máquina do último dia, sabe que o insumo vai por jato.

### 3. Tela (`RegistroDeCampo`, novo `JatosDoDia.jsx`, novo `src/lib/jatosRegras.js`)

Quando a máquina do lançamento tem implemento "por jato", a seção **Insumos** vira **"Jatos de hoje"**, no formulário
inteiro e já no "Novo lançamento" curto:

- um cartão por jato ("Jato 1 · 2.000 L", os produtos e as quantidades) com **"Editar"**;
- jato igual ao anterior numa linha só: "Jato 2 · igual ao jato 1";
- **"+ Repetir o jato anterior"** copia os produtos e as quantidades do último jato; **"+ Jato diferente"** abre um jato
  vazio (o primeiro é **"+ Jato"**);
- dentro de um jato, a seção de insumos de sempre, só com as linhas dele, e **"Pronto"**;
- embaixo, o total do dia: "Hoje: 3 jatos · glifosato 34 L · adubo 24 kg";
- os hectares não são perguntados aqui (só ao finalizar a área, como antes).

Máquina, horímetro, pessoas, serviço de terceiro e "Finalizou a atividade hoje?" não mudaram. Com outro implemento, a
tela é a de sempre.

## Verificação

- `node --test backend/tests/insumoPorJato.test.mjs` (Postgres real, `maike_va2` com as 78 migrations): 6/6.
- Backend de atividades, abastecimento e patrimônio (`atividade*`, `abastecimento*`, `tipoImplementoProduto`,
  `patrimonioP1Catalogos`): 412/412 (um teste antigo, `atividadeLinhaProduto`, ganhou `jato` na lista de campos).
- Provas de migration com espelhos (`diaDaD223` e as 14 que o usam, `categoriaManejoCadcategoriaMigration`,
  `patrimonioSimplificaMigration`, `estoqueEntradasMotivosMigration`): 203/203.
- Deploy: `premerge-migrate.test.mjs` e `preflight-schema.test.mjs`: 215/215 (B43o, B43p e B43q novos; posições do
  manifesto e contagens ajustadas para 78).
- Smoke: `tests/smoke/jatosDoDia.test.jsx` (9) e 3 casos novos em `servicoVariosDias.test.jsx` (o "Novo lançamento" com
  o pulverizador do último dia: os jatos, "Repetir", "Editar", o total e o corpo enviado); a suíte inteira antes dos
  testes novos: 4094/4094.
- `node scripts/gates/verify-all.mjs --pular=test:backend`: **TODAS AS ETAPAS PASSARAM** (smoke inteiro, com os testes novos, incluído).

## Fora desta entrega

- Cadastro de mistura ("Começar de uma mistura" entra depois como mais um botão, sem refazer nada).
- Cálculo por hectare ao finalizar a área (as quantidades por jato já ficam gravadas para isso).
- Escolher o jato nas janelas "Só insumo" do mapa (continuam lançando insumo sem jato).

## Junto nesta PR (pedido do proprietário, 2026-11-24): a rolagem dos formulários de cadastro

"Na tela de frota não consigo rolar para baixo" (computador e celular). Causa: abaixo de 1024 px (celular, tablet e
janela menor ou com zoom no computador) as seções do formulário ficam empilhadas, e uma regra de `base1-design.css`
(D-PROD-161, feita para o formulário de Lote, que tem rolagem própria) punha `overflow: hidden` na área de rolagem de
TODOS os formulários. Agora a regra só vale quando o formulário tem a rolagem própria (`:has(.b1-form-rolagem)`); os
demais (Bens e os outros cadastros) voltam a rolar. Conferido no navegador real (tela + servidor + PostgreSQL local, 25
bens): 390 e 900 px rolam até "Aquisição e depreciação"; 1024 e 1280 px, cada guia cabe na tela; a lista já rolava.
