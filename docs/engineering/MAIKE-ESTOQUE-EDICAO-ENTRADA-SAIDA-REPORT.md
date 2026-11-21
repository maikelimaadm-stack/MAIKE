# MAIKE-ESTOQUE-EDICAO-ENTRADA-SAIDA — Relatório: edição completa da Entrada e da Saída manual (D-PROD-271)

**Data:** 2026-11-21 · **Branch:** `claude/edicao-entrada-saida` (a partir da `main` `80aa1db3`) · **Migration:** nenhuma · **Decisão:** [D-PROD-271](./DECISIONS.md)

## 1. Pedido e escolhas do proprietário

Depois da saída manual, o proprietário pediu: "Olha também posso editar ok em entrada e saída". Escolhas (2026-11-20):

| Pergunta | Escolha |
|---|---|
| Quando | Depois do ajuste de inventário, numa PR própria |
| O que se edita | Tudo, se nada mexeu depois: data, motivo, fornecedor/documento, centros, produtos, quantidades, custo e depósitos, desfazendo a versão anterior e lançando a nova, com histórico |

## 2. Como funciona

- `PATCH /estoque/entradas/:id` (ação `entrada`) e `PATCH /estoque/saidas/:id` (ação `saida`). Só a observação: como antes. Qualquer campo físico: **substituição**, com o corpo completo da versão nova (o da criação) + `versao`, `motivo_edicao` e `operation_id`.
- Numa transação, sob a trava dos produtos de antes e de depois: valida a versão nova como a criação, prova "nada mexeu depois" (a mesma prova da exclusão), estorna as linhas vigentes pelo motor (data de hoje da fazenda) e lança as novas na data nova. Número e id do documento não mudam. Evento `EDICAO` modo `SUBSTITUICAO` com o antes e o depois.
- **Entrada:** linhas antigas ficam como revisão anterior (`revisao_fim`), com estorno `estorno_entrada_revisao`; o detalhe mostra as vigentes e `itens_historico`. O banco já previa o modo `SUBSTITUICAO`.
- **Saída, sem migration:** as linhas antigas vão inteiras para o evento `EDICAO` (com os ids do movimento e do estorno) e são substituídas no documento. Movimentos e camadas nunca são reescritos nem apagados; a reconciliação explica a saída pelos movimentos e `lotes_consumidos`, e a Consulta acha o documento pela origem do movimento (`lancamento_origem_id`).
- O estorno de uma linha substituída da própria saída não conta como "depois" da linha nova (mesma transação, empate de milissegundo); qualquer outro movimento conta.
- Inativos (motivo, produto, depósito, fornecedor) bloqueiam a edição, como a criação.

## 3. Constituição: emenda APROVADA

A entrada confirmada já podia ser editada sem camada tocada, mas "o motivo dela nunca muda"; a saída só editava a observação. O proprietário aprovou a emenda em 2026-11-21; ela foi aplicada como parágrafo próprio em `00-CONSTITUICAO.md` §1 e nota própria em `07-DO-NOT-DO.md`, com o texto da D-PROD-271.

## 4. Tela

No detalhe da Entrada e da Saída, ao lado de "Editar observação" (que continua só para a observação), o botão **"Editar"** (só com a ação `entrada`/`saida`, documento CONFIRMADO) abre o "Novo movimento" em modo edição: título "Editar entrada nº N"/"Editar saída nº N", tipo fixo, todos os campos preenchidos, campo obrigatório **"Motivo da edição"** e o aviso de que os lançamentos são estornados e refeitos (o número continua o mesmo); botão **"Salvar edição"**. Depois de salvar, o detalhe reabre com a versão nova; o histórico mostra "Editado (lançamentos refeitos)" e a entrada ganha a seção recolhida "Versões anteriores". As recusas têm texto próprio (ex.: "Não dá para editar: o produto Ureia teve outro movimento no depósito Galpão insumos depois desta saída (movimento nº 120). … Nada foi alterado."); o texto do servidor nunca aparece.

## 5. Testes

| Arquivo / verificação | Resultado |
|---|---|
| `backend/tests/estoqueEntradasEdicao.test.mjs` (novo) | 12/12 (0/12 contra a `main`) |
| `backend/tests/estoqueSaidasEdicao.test.mjs` (novo) | 10/10 (0/10 contra a `main`) |
| `estoqueEntradas` / `estoqueSaidas` / `estoqueConsulta` | 47/47 · 15/15 · 23/23 |
| `estoqueP0Reconciliacao*` · `estoqueP0MotorUnico` · `motorEstornoCochoTransferencia` | 44/44 · 23/23 · 13/13 |
| `test:gates` | 1055/1055 |
| smoke `estoque*` (9 testes novos) · `tests/smoke` inteiro | 83/83 · 3919/3919 |
| lint, `typecheck:backend`, `gate:types`, `source-closure`, `import-integrity`, `product-scope`, `api-boundary` | limpos |

## 6. Fora de escopo

Editar quando algo mexeu depois (recalcular o que veio depois), editar o ajuste de inventário, restaurar documento excluído.
