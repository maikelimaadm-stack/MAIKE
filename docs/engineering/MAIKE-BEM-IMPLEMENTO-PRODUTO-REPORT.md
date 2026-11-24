MAIKE-BEM-IMPLEMENTO-PRODUTO (D-PROD-297) · `claude/tipo-tarefa-drop-colunas-1aznvv` · PR (a abrir)

# Relatório — o produto do implemento no cadastro do próprio bem

Pedido do proprietário (2026-11-24): "infelizmente ainda não aparece … isso não tem que ficar no cadastro de tipo, se usa
produto ou não, tinha que ficar dentro do cadastro mesmo". Diagnóstico em produção (só leitura): nenhum tipo de
implemento estava marcado "usa produto" (o "teste" e o "Columbia" em branco) e nenhuma linha de insumo tinha jato. Por
isso o "Jatos de hoje" nunca aparecia.

## O que mudou

### 1. Banco (migration EXPAND, ainda não aplicada em produção)

`20261126100000_bem_implemento_produto`: 4 colunas anuláveis, sem DEFAULT e sem CHECK, em `BemPatrimonial`
(`usa_produto`, `forma_produto`, `capacidade`, `capacidade_unidade`). Checksum `330d9318…efbe`, pinado em
`MIGRATIONS_APROVADAS`; colunas exigidas pelo preflight do deploy. As colunas do tipo (D-PROD-279) ficam como estão.
Runbook: [`MAIKE-BEM-IMPLEMENTO-PRODUTO-RUNBOOK-RELEASE.md`](./MAIKE-BEM-IMPLEMENTO-PRODUTO-RUNBOOK-RELEASE.md).

### 2. Servidor

- `POST/PATCH /bens-patrimoniais` aceitam os 4 campos, conferidos pela mesma regra do tipo (`produtoDoCorpo`): só
  IMPLEMENTO (outro Tipo de bem, mesmo com null: 400 `so_implemento`); "Sim" exige forma JATO, capacidade > 0 e até
  100.000 e unidade L ou KG; "Não" limpa o resto; `usa_produto` fora de sim/não: 400. O PATCH só grava o que mudou
  (a mesma capacidade escrita de outro jeito não conta) e entra na auditoria. A leitura do bem devolve os 4.
- O tanque do implemento vem do **bem** (`jatoDoBem`): marcado no bem, vale o bem (inclusive "Não", que vence um tipo
  "por jato"); sem marcação no bem (nulo), vale o tipo, como antes. Usado na lista de implementos e na linha de máquina.

### 3. Tela

- **Bens › Implemento, primeira aba:** bloco "Leva produto (veneno, adubo)?" Sim/Não; com Sim, "Quanto cabe no tanque"
  e a medida (Litros/Quilos), e a dica "No lançamento, o produto é contado por tanque cheio (jato)". Bem novo começa
  em "Não". Sem a capacidade, o aviso e nada vai. Outros Tipos de bem não mostram nem mandam esses campos.
- **Gerenciar tipos / Novo tipo:** o "Usa produto?" saiu (volta a ser "Renomear" com o teto de salto).
- **Correção achada no ensaio real:** na "Nova atividade" (formulário inteiro), com implemento por jato e a área
  continuando em andamento, o dia gravava os 100% da área (ex.: dois dias = "20 de 10 ha"). Agora o dia vai só com a
  área, sem hectares (nota "Com jato, os hectares não contam hoje: são perguntados quando finalizar a área"), e o
  "Fez o pasto todo?" do Finalizar informa os hectares. Com "Sim, finalizei" no mesmo dia, os hectares vão como antes.

## Ensaio no navegador real (backend + tela locais, banco de teste)

1. Bens › Novo › Implemento › "Leva produto? Sim" sem capacidade → aviso; 2.000 Litros → salvo; a API de implementos
   devolve `jato: { capacidade: "2000", unidade: "L" }`. Conferido também no celular (390 px).
2. Nova atividade de Aplicação, trator + esse pulverizador → "Jatos de hoje · Tanque de 2.000 L"; jato 1 com herbicida
   10 L, "Repetir" duas vezes → "Hoje: 3 jatos · herbicida 30 L"; salvo com 3 linhas (jato 1, 2, 3) e a área em
   **0 de 10 ha**.
3. Finalizar pelo cartão → "Fez o pasto todo?" sem resposta marcada; "Sim, os 10 ha" → "3 jatos · 8 horas",
   "3 L/ha", custo total e por hectare; atividade e área CONCLUIDAS com 10 ha.

## Testes

- Servidor: `bemImplementoProduto.test.mjs` (novo, 5), `patrimonioP1Bens` (chaves do detalhe), `insumoPorJato`,
  `tipoImplementoProduto`, provas de migration (`categoriaManejoCadcategoriaMigration`, `patrimonioSimplificaMigration`,
  `estoqueEntradasMotivosMigration`).
- Deploy: `premerge-migrate.test.mjs` (B45a/b/c e as posições do manifesto), `preflight-schema.test.mjs`.
- Tela: `bensPatrimoniais.test.jsx` (bloco do produto), `registroDeCampoVariasLinhas.test.jsx` (hectares com jato),
  `bensGerenciarTipos.test.jsx` (volta ao Renomear); `tipoImplementoProduto.test.jsx` saiu (o bloco saiu do tipo).

## Pendente

- Aplicar a migration em produção (GO "aplica"), depois o merge. Antes, conferir que a das unidades de conversão
  (D-PROD-288) já está em produção (o preflight mostra).
- Depois do deploy, marcar no cadastro cada pulverizador (ex.: "Columbia AD-18 IP-01") com "Leva produto? Sim".
