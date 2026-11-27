# MAIKE — Cadastro de produto: "Conversão de unidades" no padrão Base1 (relatório, D-PROD-368)

**Data:** 2026-11-27 · **Decisão:** [D-PROD-368](./DECISIONS.md) · **Branch:** `claude/produto-tela-base1` · **Migration:** nenhuma

## Pedido

O proprietário pediu três coisas:
- a tela do cadastro de produtos estava "bugada", com campos fora do padrão Base1;
- a aba "Unidades" devia ter outro nome;
- a unidade de estoque devia ser a do cadastro principal.

A terceira (guardar o estoque em SC, UN ou CX) exige emenda da Constituição e vai em missão própria. Esta PR cuida das duas primeiras.

## O que estava errado (capturas com os componentes reais e backend falso)

- **Aba "Unidades"** (`UnidadesConversaoProduto.jsx`):
  - cada conversão tinha rótulos soltos (`<label>` com `<span>`) em cima de controles com a classe do campo Base1, mas sem a caixa (`.mg-field`);
  - no computador, Unidade, Conta e Fator ficavam empilhados, com o valor do seletor no meio da linha e o fator na ponta direita;
  - Compra/Saída eram caixas de seleção do navegador, e a lixeira ficava solta.
- **Aba "Unidade de Estoque":** a "Quantidade por implemento cheio" punha o número e o seletor kg/L dentro da mesma caixa, e o rótulo longo ficava por cima do seletor.

## Mudança

- **Aba renomeada** para **"Conversão de unidades"** (`FormularioProduto.jsx`), com o mesmo nome no `aria-label` da seção.
- **Cada conversão:**
  - campos `B1Field` para Unidade (obrigatório), Conta (Multiplica/Divide) e Fator (obrigatório, numérico à direita);
  - chaves `B1ChaveRow` para Compra e Saída;
  - os erros aparecem no próprio campo, como no resto do Base1;
  - embaixo vêm a prévia ("1 SC = 25 KG"), a marca de desativada e o botão "Remover";
  - no computador, a grade segue o padrão Base1 de 4 campos por linha; no celular, um por linha.
- **"Quantidade por implemento cheio":** número numa caixa e "Unidade do implemento" (kg/L) em outra.
- **O que não muda:** o envio ao servidor, as validações e as regras.

## Verificação

- Smoke do cadastro de produtos: 7 arquivos, 49 testes, todos passando (`produtoUnidadesConversao` com o nome novo da aba).
- Capturas (Vite + backend falso) em 1280 px (abas Unidade de Estoque e Conversão de unidades) e 390 px (edição), sem rolagem lateral.

## Fora (próxima missão)

- **Estoque na unidade escolhida no cadastro** (SC, UN, CX...). Hoje o saldo e o custo ficam sempre em KG ou L (Constituição e D-PROD-162/288). Mudar isso afeta o motor do estoque, o custo, os lotes, as conversões, o cocho (consumo em kg) e o depósito. Primeiro vem a proposta de emenda para o proprietário aprovar.
