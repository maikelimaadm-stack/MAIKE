# MAIKE — Estoque: Editar, Duplicar e Excluir no ⚡ da linha de Movimentos (D-PROD-382)

**Data:** 2026-11-28 · **Decisão:** [D-PROD-382](./DECISIONS.md) · **Branch:** `claude/estoque-acoes-linha` · **Migration:** nenhuma

## 1. Pedido

O proprietário escreveu: "preciso ajustar na página de estoque, não consigo editar uma entrada, duplicar, excluir etc." e depois "entrada ou saída que seja, mas eu tenho que poder excluir". Por fim, pediu: "excluir etc., essas coisas têm que ficar iguais às dos modelos de cadastros, mostrando lá em cima".

## 2. Causa

Editar e Excluir já existiam (D-PROD-271, D-PROD-273), mas ficavam escondidos três passos para dentro:

1. o ⚡ "Ver detalhes";
2. o link do documento;
3. só então os botões.

O ⚡ da linha tinha só "Ver detalhes", e "Duplicar" não existia. O servidor já aceitava as três operações.

## 3. O que mudou

| Onde | Mudança |
|---|---|
| `MovimentosEstoque.jsx` | o ⚡ da linha mostra Editar, Duplicar e Excluir (entrada e saída) ou Excluir (ajuste), cada um com a ação da tela (`entrada`, `saida`, `ajuste`); outras origens só "Ver detalhes". Os botões Editar, Duplicar e Excluir da **barra de cima** (padrão Base1) agem no movimento selecionado, pelo mesmo caminho, e um aviso diz o porquê quando o movimento não aceita a ação |
| `estoqueConsultaRegras.js` | `documentoDaLinha`: acha a entrada, a saída ou o ajuste pela origem e pelo `lancamento_origem_id`; estorno e excluído ficam de fora |
| `TelaNovoMovimentoEstoque.jsx` | modo cópia (`copia`): um movimento novo com os dados do documento, a data de hoje e, na entrada, sem o número do documento; o título diz de qual documento veio |
| `JanelaEntradaEstoque.jsx`, `JanelaSaidaEstoque.jsx`, `JanelaAjusteEstoque.jsx` | abrem já pedindo o motivo quando vêm do "Excluir" da linha; entrada e saída ganham o botão "Duplicar" |
| `estoqueConsultaService.js` (servidor) | a linha da lista traz `lancamento_origem_id`, o id do documento gravado pelo motor |

As permissões, as regras do servidor e a exclusão continuam como eram: versão, `operation_id` e a prévia do recálculo.

## 4. Testes

- **Smoke de Estoque:** 20 arquivos, 207/207. São 15 testes novos em `estoqueNovoMovimento.test.jsx`. Os 6 da barra de cima cobrem Editar, Duplicar e Excluir da selecionada, e os avisos de outra origem, de ajuste e de permissão. Os 9 do ⚡ cobrem:
  - os itens do ⚡ por origem e por permissão;
  - Editar direto;
  - Duplicar com POST e sem PATCH;
  - Excluir já no motivo;
  - Duplicar no detalhe;
  - saída e ajuste.
- **Backend** (PostgreSQL local), 104/104:
  - `estoqueEntradas` (com a nova conferência da linha: origem e id da entrada);
  - `estoqueConsulta` e `estoqueConsultaExcluidos`;
  - `estoqueSaidas` e `estoqueAjustes`.
- `gate:types` passou, sem regressão.

## 5. Limite conhecido

Num produto com estoque fora de KG ou L, como o LI 700 em LT, a tela do movimento ainda escreve "kg" no rótulo da quantidade na edição e na cópia. O que é gravado está certo, pela conversão do produto. Corrigir isso é a UE-2 (D-PROD-371), que o proprietário pausou.
