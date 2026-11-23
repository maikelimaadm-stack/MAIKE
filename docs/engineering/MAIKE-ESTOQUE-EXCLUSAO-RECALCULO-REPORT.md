# MAIKE — Exclusão com recálculo do estoque · relatório

**Decisão:** [D-PROD-273](./DECISIONS.md) · **SPEC:** [MAIKE-ESTOQUE-EXCLUSAO-RECALCULO-SPEC.md](./MAIKE-ESTOQUE-EXCLUSAO-RECALCULO-SPEC.md) · **Migration:** nenhuma

## Problema relatado

Ao excluir um movimento de estoque (ex.: a saída para suplementação), o sistema
grava um estorno que continua aparecendo nas telas, e depois disso nada anterior
pode mais ser excluído ("movimento posterior"). O dono decidiu: o excluído
**some da tela**, a exclusão **recalcula** o custo médio de tudo que veio depois,
na **ordem em que foi lançado** (número do movimento). Emenda aprovada.

## Fatias entregues nesta PR

| Fatia | Conteúdo | Estado |
|---|---|---|
| 1 | Decisão D-PROD-273, emenda constitucional (00 e 07), SPEC | feita |
| 2 | "Some da tela": `incluir_excluidos` na consulta, filtro **Mostrar excluídos** no Kardex, saldo exibido sem os excluídos | feita |
| 3 | Replay puro + prévia + prova replay = gravado (sem escrita) | próxima PR |
| 4 | Exclusão com recálculo — saídas | pendente |
| 5 | Exclusão com recálculo — entradas, compra, transferência, edição | pendente |
| 6 | Reconciliação de valor + gate | pendente |

## Fatia 2 — o que mudou

- **Par excluído** = movimento `Estornada` + o estorno dele (`tipo_detalhado`
  `estorno_*`, `movimento_pai_id` = original), mesmo tenant/empresa/produto. Só o
  par completo some; estornada sem estorno, estorno órfão e movimento ativo
  aparecem como antes.
- **`GET /estoque/movimentos`**: `incluir_excluidos` (padrão `false`, inválido →
  400). Mesmos filtros, busca e keyset `(data DESC, id DESC)`; pares calculados uma
  vez por consulta (`NOT IN`), então total, paginação e cursor continuam corretos.
  O cursor fica amarrado ao modo (usar no outro modo → 400). Base sintética de 66 mil
  movimentos / 6 mil pares: contagem ~36 ms, página ~25 ms.
- **Campo `excluido`** na lista e no detalhe.
- **Saldo exibido**: saldo gravado menos o efeito dos excluídos do mesmo produto e
  depósito lançados antes (ordem da SPEC §1.3). Igual com o filtro ligado ou
  desligado e no detalhe. Só leitura; nada é regravado.
- **Kardex**: pílula **Mostrar excluídos** (Não/Sim; no celular, na folha Filtros);
  com "Sim", etiquetas **Excluído** e **Estorno da exclusão**.
- **Histórico do depósito (mapa)**: a regra de esconder continua a da D-PROD-268; o
  saldo antes/depois dos cartões passa a usar a mesma regra do servidor
  (`src/lib/estoqueSaldoSemExcluidos.js`, inteiro com 4 casas).
- Motor, camadas e regras de exclusão **não mudaram** nesta fatia.

## Validação

| Verificação | Resultado |
|---|---|
| PG `estoqueConsulta` / `estoqueConsultaExcluidos` (novo) | 23/23 · 7/7 |
| PG `estoqueEntradas` / `estoqueSaidas` / `motorEstornoCochoTransferencia` | 47/47 · 15/15 · 13/13 |
| PG `estoqueSaidasEdicao` + `estoqueEntradasEdicao` | verdes |
| Smoke inteiro | 317 arquivos, 3977 testes |
| Gate tests | 1055/1055 |
| eslint, `typecheck:backend`, `typecheck` (374, igual à base) | ok |

## Decisões de implementação (dentro da D-PROD-273)

1. O saldo de um movimento ativo é o mesmo com o filtro ligado ou desligado
   (o número não "pula" ao ligar o filtro; lista e detalhe batem).
2. O histórico do depósito no mapa continua escondendo qualquer `Estornada` /
   `estorno_*`, como na D-PROD-268 (no mapa só existe exclusão).

## Riscos e próximos passos

- A ordem canônica supõe que o número do movimento segue a ordem real de
  processamento (atribuído sob a trava do produto — verdadeiro para todo escritor
  atual).
- Fatia 3: replay puro sobre os dados reais de produção (leitura) e prova
  replay = gravado antes de qualquer escrita.
