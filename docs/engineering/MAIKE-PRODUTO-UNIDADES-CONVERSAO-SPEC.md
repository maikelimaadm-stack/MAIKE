# MAIKE — Produto: unidades de conversão (SPEC, D-PROD-285)

Decisão: [D-PROD-285](./DECISIONS.md) · Runbook: [`MAIKE-PRODUTO-UNIDADES-CONVERSAO-RUNBOOK-RELEASE.md`](./MAIKE-PRODUTO-UNIDADES-CONVERSAO-RUNBOOK-RELEASE.md) ·
Relatório: [`MAIKE-PRODUTO-UNIDADES-CONVERSAO-REPORT.md`](./MAIKE-PRODUTO-UNIDADES-CONVERSAO-REPORT.md)

## 1. Modelo

`ProdutoUnidadeConversao` (tabela nova, tenant-scoped):

| Coluna | Tipo | Regra |
|---|---|---|
| `cliente_id` | VARCHAR(64) NOT NULL | primeiro em todo índice; vem do `auth_context` |
| `produto_id` | VARCHAR(64) NOT NULL | FK composta (`cliente_id`, `produto_id`) → `Produto`(`cliente_id`, `id`), RESTRICT |
| `sigla` | VARCHAR(8) NOT NULL | maiúscula e aparada; nunca `KG`, `L` ou `UN` (CHECK); nunca a unidade de estoque do produto (serviço) |
| `operacao` | VARCHAR(12) NOT NULL | `MULTIPLICA` \| `DIVIDE` (CHECK) |
| `fator` | DECIMAL(14,6) NOT NULL | > 0; no `DIVIDE`, ≤ 10.000 (CHECK) — a quantidade de estoque tem 4 casas |
| `uso_compra`, `uso_venda` | BOOLEAN NOT NULL DEFAULT true | CHECK (`uso_compra` OR `uso_venda`) |
| `codigo_barras` | VARCHAR(64) NULL | opcional |
| `ativa` | BOOLEAN NOT NULL DEFAULT true | desativada some dos seletores |
| `ordem` | INTEGER NOT NULL DEFAULT 0 | ≥ 0 |
| `excluido_em` | TIMESTAMP(3) NULL | exclusão lógica |

Índices: único (`cliente_id`, `id`); **único parcial** (`cliente_id`, `produto_id`, `sigla`) `WHERE excluido_em IS NULL`
(só na migration: o Prisma não expressa índice parcial); não-único (`cliente_id`, `produto_id`). RLS com o corpo aprovado.

A sigla cabe nas colunas `unidade` VARCHAR(8) que as linhas de lançamento já têm: nenhuma coluna de linha muda de tipo.

## 2. A conta (o "motor" da conversão)

`backend/src/modules/produtos/produtoUnidadesConversao.js`, funções puras:

- unidade de estoque efetiva: `L` para L; `KG` para KG e para o SACO legado (que guarda kg);
- `MULTIPLICA`: quantidade de estoque = quantidade × fator; `DIVIDE`: quantidade ÷ fator; **uma** vez, 4 casas, ROUND_HALF_UP;
- custo por unidade de estoque (entrada): `MULTIPLICA` → custo ÷ fator; `DIVIDE` → custo × fator, em 4 casas;
- fator efetivo gravado (`fator_kg`): o multiplicador em 4 casas (no `DIVIDE`, 1/fator). Nunca se recalcula a quantidade
  de estoque a partir dele (ex.: ÷3 grava 0,3333, mas 2 ÷ 3 = 0,6667);
- `KG` ↔ `L` continua recusado (`unidade_incompativel`), como na D-PROD-162;
- conversão desativada → `unidade_inativa`; sem o uso da origem → `unidade_sem_uso`; sigla desconhecida → `unidade_nao_cadastrada`;
- `SACO` sem a conversão SACO: o caminho antigo pelo `peso_por_saco_kg` (`peso_por_saco_ausente` sem peso).

O custo médio (D-PROD-256), o lote (D-PROD-282) e o recálculo (D-PROD-273) não mudam: o motor de estoque recebe sempre
a quantidade já na unidade de estoque.

## 3. Onde vale

| Origem | Uso | Campo de unidade | Situação |
|---|---|---|---|
| Entrada documentada (`/estoque/entradas`) | compra | `EntradaEstoqueItem.unidade`/`fator_kg`/`quantidade_estoque`/`custo_kg` | **conversão** |
| Saída manual (`/estoque/saidas`) | venda/saída | `SaidaEstoqueItem.unidade`/`fator_kg`/`quantidade_estoque` | **conversão** |
| Ajuste de inventário (`/estoque/ajustes`) | qualquer ativa | `AjusteEstoqueItem.unidade`/`fator_kg`/`contado_estoque` | **conversão** |
| Compra do financeiro (PAGAR) | compra | `OperacaoFinanceiraItem.unidade`/`fator_kg`/`quantidade_estoque` | **conversão** |
| Venda do financeiro (RECEBER) | venda/saída | idem | **conversão** |
| Transferência, cocho | — | sem unidade digitada no servidor (a tela converte o SACO antigo em kg) | fora (§7) |
| Linha de produto da atividade, abastecimento | — | `unidade` = unidade de estoque (snapshot) | fora (§7, Constituição) |

Na retificação do financeiro, a linha já recebida numa unidade de conversão mantém o fator **gravado** (como o SACO,
D-PROD-158): editar o fator no cadastro não muda o documento antigo.

## 4. Cadastro (POST/PATCH `/produtos`)

`unidades_conversao: [{ id?, sigla, operacao, fator, uso_compra?, uso_venda?, codigo_barras?, ativa?, ordem? }]`.
A lista substitui a vigente; ausente no corpo = nada muda. Sigla nova cria; existente (id ou sigla) altera; ausente e
usada em lançamento (entrada, saída, ajuste ou financeiro) → `ativa = false`; ausente e nunca usada → `excluido_em`.
A sigla de uma unidade usada não muda. Recusas: 400 `REQUEST_VALIDATION_FAILED` com `details.reason`
(`sigla_obrigatoria`, `sigla_longa`, `sigla_igual_principal`, `sigla_reservada`, `sigla_repetida`, `operacao_invalida`,
`fator_invalido`, `fator_divide_alto`, `sem_uso`, `sigla_em_uso`). A leitura (`GET /produtos`, `/produtos/page`) traz
`unidade_estoque` e `unidades_conversao` (com `equivalencia`, "1 SACO = 25 KG"); as opções de produto da entrada/saída/
ajuste e do financeiro trazem as ativas.

**Campos que saem da tela.** `preco_custo`, `preco_venda`, `local_estoque` e `codigo_interno` continuam aceitos no
corpo (cliente antigo) e são **ignorados**; o código interno nasce igual ao `numero_produto`. Os valores antigos ficam
no banco. `estoque_atual` segue as regras da D-PROD-161 (só leitura).

## 5. Formulação

`CADFORMULACAO.consumo_minimo_pv` e `consumo_maximo_pv` (DECIMAL(14,6), anuláveis), lidos e gravados pelo
`/formulacoes` (0 < x ≤ 5, até 4 casas; vazio limpa). A migration copia do produto que a formulação leva ao cocho. A
tela do produto deixa de mostrar o bloco "Configuração de Suplementação" (tipo de consumo, %PV padrão, mínimo e
máximo) e mostra um aviso apontando para a Formulação. As colunas do Produto não são apagadas.

## 6. Telas

- Produto: aba **Unidades** (lista com unidade, Multiplica/Divide, fator, Compra/Saída e a prévia "1 SACO = 25 KG");
  sem preços, local, consumo e peso por saco; código interno e estoque atual só leitura; unidade de estoque KG ou L
  (SACO só aparece no produto legado).
- Entrada, saída e ajuste: o seletor "Unidade" lista a de estoque e as conversões (com a equivalência no rótulo) e a
  linha mostra "10 SACO = 250 kg".
- Financeiro: o seletor do item lista as conversões com o uso da direção e o resumo mostra a equivalência.
- Formulações: %PV mínimo e %PV máximo.
- Tudo em cartões que quebram em 390 px (grade de 12 colunas com `col-span-6`/`col-span-12` no celular).

## 7. Fora do escopo e o que exigiria emenda

- Conversão na linha de produto da atividade, no abastecimento, no cocho e na transferência: a Constituição
  (D-PROD-159/162/193) manda baixar "exatamente a quantidade digitada, na unidade de estoque do Produto" e o `07` proíbe
  "converter a quantidade entre unidades … por fator" no abastecimento. **Emenda proposta (não aplicada)**, se o dono
  quiser: "Na linha de produto da atividade, no cocho e na transferência, a quantidade pode ser digitada numa unidade de
  conversão do cadastro do produto (D-PROD-285); o servidor converte para a unidade de estoque pelo fator cadastrado e
  grava a unidade, a quantidade e o fator. O abastecimento continua sem conversão." Fica para decisão do proprietário.
- `UN` como unidade de estoque (o motor e os CHECKs de atividade e abastecimento só têm KG e L).
- Migrar o cocho e o farol para lerem o consumo da Formulação em vez do produto.
