# MAIKE-ESTOQUE-ENTRADA-VARIOS-PRODUTOS — Relatório: a entrada não lançava mais de um produto

**Data:** 2026-11-19 · **Branch:** `claude/new-session-26kpxu` (a partir da `main` `095b057d`) · **Decisão:** correção da [D-PROD-259](./DECISIONS.md) (sem decisão nova) · **Migration:** nenhuma

## O problema (relato do proprietário)

"Não consigo lançar mais de um produto" na Entrada do "Novo movimento" (Estoque → Movimentos).

## Causa (reproduzida no navegador, com backend real e PostgreSQL local)

1. **Desktop e celular — a linha do produto achatada.** Cada produto era um cartão com a classe `mg-b1-form-grid`. A grade compacta de 4 colunas da Base1, que entrou com a PR #339 (`base1-design-ajustes.css`), passou a valer também dentro do cartão. O cartão ficou com 48 px de altura e os campos da linha 1 ficaram por cima dos da linha 2, o que impedia escolher o produto e o depósito.
2. **Celular — opções que não recebiam o toque.** A folha de baixo das listas (produto, local, motivo…) nascia no `body`, fora da janela modal. A janela (`B1Janela`, Radix Dialog) ficava por cima e recebia o toque, então nenhuma opção podia ser escolhida no celular.

O servidor não tinha defeito: uma entrada com 3 produtos (2 produtos, 1 deles em 2 depósitos) grava os 3 itens. O teste novo em `backend/tests/estoqueEntradas.test.mjs` comprova isso.

## Correção

`src/components/estoque/JanelaNovoMovimentoEstoque.jsx`:
- **Cartão do produto:** é um cartão de linha inteira (`b1-form-embutido`) com uma grade própria dentro (`grid-cols-12`). Ele não é mais `mg-b1-form-grid`.
- **Folha das listas no celular:** nasce dentro da janela, pelo mesmo padrão de `JanelaAbastecimentoDaArea` (`MobileSheetPortalCtx` mais o alvo em `fora`). Com a folha aberta, fechar a janela fecha só a folha.

## Provas

| Prova | Resultado |
|---|---|
| Navegador real (Playwright, backend Fastify real, PostgreSQL 17 local), 1280 px | Compra com 2 produtos lançada; janela da entrada nº 1 com UREIA 100 kg e SAL MINERAL 50 kg, total R$ 450,00; 2 itens no banco |
| Idem, 390 px (toque) | Compra com 2 produtos lançada; 2 itens no banco |
| Antes da correção, 1280 px | Linhas de 48 px com os campos sobrepostos; nenhuma entrada gravada |
| Antes da correção, 390 px | O toque na opção era interceptado pela janela; nenhuma entrada gravada |
| `tests/smoke/estoqueNovoMovimento.test.jsx` | 12/12. Os 2 testes novos falham com o componente antigo e passam com o novo |
| `backend/tests/estoqueEntradas.test.mjs` | Teste novo "VÁRIOS PRODUTOS" passa |

## Ponto aberto

`src/components/mapa/cadastro/AcoesEmLoteAreas.jsx` também usa listas dentro de uma `B1Janela` sem o `MobileSheetPortalCtx`, então pode ter o mesmo problema de toque no celular. Não foi verificado nem alterado aqui.
