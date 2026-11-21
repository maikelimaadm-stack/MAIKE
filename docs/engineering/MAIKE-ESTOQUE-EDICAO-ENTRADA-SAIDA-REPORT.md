# MAIKE-ESTOQUE-EDICAO-ENTRADA-SAIDA — Relatório: edição completa da Entrada e da Saída manual (D-PROD-270)

**Data:** 2026-11-21 · **Branch:** `claude/edicao-entrada-saida` (a partir da `main` `80aa1db3`) · **Migration:** nenhuma · **Decisão:** [D-PROD-270](./DECISIONS.md)

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

## 3. Constituição: emenda PROPOSTA (falta a aprovação)

A entrada confirmada já podia ser editada sem camada tocada, mas "o motivo dela nunca muda"; a saída só editava a observação. O texto proposto está na D-PROD-270 e **não foi aplicado**; a PR fica em rascunho até a aprovação.

## 4. Testes

Ver o corpo da PR (backend e tela).

## 5. Fora de escopo

Editar quando algo mexeu depois (recalcular o que veio depois), editar o ajuste de inventário, restaurar documento excluído.
