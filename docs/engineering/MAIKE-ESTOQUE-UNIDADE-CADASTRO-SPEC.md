# MAIKE — Estoque na unidade do cadastro do produto (SPEC, D-PROD-371)

**Data:** 2026-11-27 · **Decisão:** [D-PROD-371](./DECISIONS.md) · **Emenda da Constituição:** aprovada pelo
proprietário em 2026-11-27 ("Aprovo a emenda"; para cocho e depósito, "Usar a conversão para KG").

## 1. Pedido

- O proprietário pediu: "a unidade de estoque para a conversão tem que ser a unidade do cadastro principal".
- Ele escolheu: "Estoque na unidade que eu escolher".
- Hoje o produto tem dois campos:
  - a **Unidade de Medida**, que é a sigla do cadastro de Unidades (`Produto.unidade_medida`, por exemplo SC, UN, CX);
  - a **Unidade principal de estoque**, que só aceita KG ou L (`Produto.unidade_principal_estoque`; SACO é o legado em kg).
- Saldo, custo e lotes ficam sempre em KG ou L. Isso vem da Constituição, da D-PROD-162, da D-PROD-184 (M3) e da D-PROD-288.

## 2. Regra nova (emenda)

1. **Um campo só.** A unidade de estoque do produto passa a ser a sua **Unidade de Medida**, uma sigla ativa do
   cadastro de Unidades com até 8 caracteres (por exemplo KG, L, SC, UN, CX, GL, DS). O servidor grava a mesma sigla em
   `unidade_principal_estoque`, que é o campo que o motor lê. O campo separado sai da tela.
2. **O motor não muda a conta.** A quantidade do movimento, o saldo (`estoque_atual`), o custo médio, os lotes, o
   recálculo e o replay ficam na unidade de estoque, qualquer que seja ela. O motor já trata a quantidade como um número
   sem unidade. O que muda é o rótulo: o movimento grava a sigla real (`unidade_medida`), e não mais "KG" fixo.
3. **A conversão vale a partir da unidade de estoque.** "1 SC = 25 KG" num produto em KG e "1 KG = 0,04 SC" num
   produto em SC são igualmente válidos.
   - KG, L e UN podem ser unidade de conversão. Nunca valem a própria unidade de estoque nem uma sigla repetida.
   - **KG ↔ L continua proibido** nos dois sentidos: um produto em KG não ganha L como conversão, e um produto em L não
     ganha KG. Densidade fica fora.
4. **Troca da unidade de estoque.** Só é permitida enquanto o produto nunca teve lote, movimento ou item de lançamento.
   Antes a regra valia só para L. Com histórico, o servidor recusa e explica o motivo.
5. **SACO legado.** O produto com `unidade_principal_estoque = SACO` continua guardando kg (`peso_por_saco_kg`) até ser
   editado. Na edição, a unidade de estoque passa a KG, que é o mesmo saldo, e a conversão SACO já existe.
6. **Abastecimento sem mudança.** Combustível continua só em L ou KG, como dizem a D-PROD-162 e a 07-DO-NOT-DO. Um
   produto com estoque em outra unidade não entra em tanque nem em abastecimento.
7. **Peso no cocho, no depósito e na formulação.** Consumo em g/cab/dia, % do peso vivo, capacidade e mínimo do cocho em
   kg e custo por kg são contas de peso.
   - **"kg por unidade de estoque"** do produto:
     - 1 para produto em KG;
     - `peso_por_saco_kg` para SACO legado;
     - o fator da conversão **KG** ativa para as outras unidades (produto em SC com "1 KG = 0,04 SC" → 25 kg por SC).
   - Produto sem esse fator **não entra no cocho** (recusa com o motivo) e fica fora do nível do depósito, com o aviso
     que já existe para o produto em L.
8. **Mistura do implemento sem mudança.** A capacidade do implemento continua em L ou KG (D-PROD-323). Produto com
   estoque em outra unidade não entra na mistura até haver uma decisão própria.

## 3. Banco (migration `estoque_unidade_cadastro`)

Os CHECKs da tabela abaixo ficam mais largos, refeitos com o mesmo nome. A migration pinada no manifesto não apaga
coluna nem dado.

| CHECK | Hoje | Passa a |
|---|---|---|
| `ProdutoUnidadeConversao_sigla_check` | não vazia, maiúscula, `NOT IN ('KG','L','UN')` | não vazia, maiúscula |
| `EntradaEstoqueItem/SaidaEstoqueItem/AjusteEstoqueItem_unidade_check` | não vazia e `<> 'UN'` | não vazia |
| `OperacaoFinanceiraItem_forma_check` | MERCADORIA com `unidade <> 'UN'` | MERCADORIA com unidade não vazia (o SERVIÇO continua `= 'UN'`) |
| `AtividadeApontamentoProduto_valores_check` | `unidade IN ('L','KG')` | unidade não vazia (o resto igual) |

As colunas de unidade dos itens já são VARCHAR(8), e a sigla da unidade de estoque também fica limitada a 8.

## 4. Entregas (uma PR cada, R7)

| PR | Escopo |
|---|---|
| **UE-1** | SPEC e emenda. Migration. Servidor: unidade de estoque genérica (`unidadeEstoqueEfetiva`), domínio no cadastro, troca com histórico, conversões. Rótulos do motor, da entrada, da saída, do ajuste e da consulta. Tela do produto com campo único. Helpers do app. **Trava:** produto com estoque fora de KG/SACO é recusado no cocho e fica fora do nível do depósito até a UE-3 |
| **UE-2** | Lançamentos com qualquer unidade: financeiro (`exigirUnidadeCompativel`, opções), linha de produto da atividade e suas opções, transferência e telas de estoque com o rótulo real |
| **UE-3** | Cocho, depósito e formulação pelo "kg por unidade de estoque" (§2.7), tirando a trava da UE-1 |

## 5. Fora

> **Próximo passo já combinado (2026-11-27):** o proprietário avisou que o **abastecimento** também vai passar a aceitar
> a unidade do cadastro ("essa regra nós vamos mudar também futuramente, vai ser igual para os outros"). Vai ser uma
> etapa própria (UE-4), com uma emenda própria. Até lá, a sigla "LT" do cadastro de Unidades da fazenda fica como está.
> Nenhum produto usa LT hoje; só depois da UE-4 um produto em LT poderá entrar no tanque.


- Conversão KG ↔ L (densidade).
- Abastecimento em outra unidade.
- Mistura do implemento em outra unidade.
- Trocar a unidade de produto com histórico.
