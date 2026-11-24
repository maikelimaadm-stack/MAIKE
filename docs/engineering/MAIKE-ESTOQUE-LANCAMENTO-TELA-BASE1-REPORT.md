# MAIKE — "Novo movimento" do Estoque em tela cheia Base1 (D-PROD-285)

## Missão

O lançamento de estoque ("Novo movimento": Entrada, Saída, Transferência e Ajuste) e a edição de entrada/saída
abriam numa janela (popup). Agora abrem numa **tela cheia no padrão do Motor Base1**, como os outros cadastros Base1.
A lista de produtos segue o desenho e o uso da tabela **"Áreas"** do cadastro de atividades. A mudança é só de tela.

## O que mudou

| Arquivo | Mudança |
|---|---|
| `src/components/estoque/TelaNovoMovimentoEstoque.jsx` (antes `JanelaNovoMovimentoEstoque.jsx`) | Sai a `B1Janela` e a folha do celular presa à janela. O formulário vai dentro de `CadastroFormShell embedded`, com o título no cartão (no computador) e os botões "Cancelar"/"Lançar …" no pé. As linhas de Entrada e Saída viram células da tabela. Novo `onEnviando` (trava o ✕/✓ da barra durante o envio). Novo `tituloDoMovimento`. |
| `src/components/estoque/TabelaProdutosMovimento.jsx` (novo) | Tabela dos produtos no desenho de `SeletorAreasDaAtividade` (D-PROD-249): `b1-tipo-tabela` com cabeçalho, campos nas células, números à direita, ✕ no fim e total no rodapé. No celular, cartões com os campos rotulados e um cartão de total. Uma linha de detalhe sob o produto recebe o que não cabe numa célula. |
| `src/components/estoque/CamposAjusteEstoque.jsx` | A contagem do ajuste usa a mesma tabela (Contado, Saldo atual, Diferença). O custo da sobra e a nota do custo médio vão na linha de detalhe. |
| `src/components/estoque/MovimentosEstoque.jsx` | A tela é o **registro** da `CadastroBase1Screen` (`recordForm` + `formId`). É estado da página, sem rota nova. Fechar ou lançar volta para a lista. Cancelar a edição volta para o detalhe do documento, como antes. As abas Saldo/Movimentos ficam escondidas enquanto a tela está aberta. |
| `src/styles/cadastro-base1.css` | Bloco `.b1-mov-tabela`: alinhamento das células e rótulo do campo fora da vista na tabela (ele continua no DOM para leitor de tela; o cabeçalho da coluna já diz o que é). |

### Colunas

- **Entrada:** Produto · Unidade · Local de estoque · Quantidade · Valor unitário · Valor total · Sem custo · Lote · Validade · ✕. O rodapé traz o total de produtos e o valor total. "Valor total da entrada" continua abaixo da tabela.
- **Saída:** Produto · Unidade · Local de estoque · Quantidade · ✕. Os lotes (FEFO, troca, divisão, aviso e confirmação de vencido) ficam na linha de detalhe quando o produto controla lote.
- **Ajuste:** Produto · Unidade · Local de estoque · Contado · Saldo atual · Diferença · ✕. O custo da sobra fica no detalhe.
- **Transferência:** tem um produto só, então não muda.

## O que não mudou

Continuam iguais:

- as chamadas ao servidor e o `operation_id`, que é reaproveitado no reenvio;
- validações, mensagens de erro e motivos ("Motivos…" na mesma tela);
- custo, unitário ↔ total e "Sem custo";
- lote e validade, FEFO e a confirmação de lote vencido;
- permissões: ações `entrada`/`saida`/`ajuste` e o fuso da fazenda;
- o modo edição: tipo fixo, motivo da edição e versão.

Nada no backend mudou. Rotas, menu e `config/mapa-manejo-scope.json` também não mudaram: a tela é estado da página.

## Testes

- `tests/smoke/estoqueNovoMovimento.test.jsx`: **49/49**.
  - Atualizados: os testes que esperavam a janela (`.b1-janela--tela-cheia`, 1 `dialog`, a folha "dentro da janela") e os de "cartão de linha inteira".
  - Novos:
    - abrir troca a lista pela tela, sem `dialog`, com título e o ✓ ligado ao formulário; o ✕ volta à lista sem gravar;
    - no celular (até 639px, o que inclui 390px) os produtos viram cartões com o ✕;
    - linha de tabela, ✕ e total para Entrada, Saída e Ajuste.
- `tests/smoke/estoqueControleLote.test.jsx`: 5/5.
- `npm run verify:all`: verde (ver a PR).

## Celular (390px)

- **Verificado:** pelo RTL, com `matchMedia` de celular (`max-width: 639px`). Os produtos viram cartões em `grid-cols-12`, onde cada campo ocupa a linha inteira (`col-span-12` abaixo de `md`), sem tabela e sem rolagem horizontal. O título e o voltar ficam na casca móvel do registro Base1.
- **Não verificado:** não há navegador (Playwright) neste ambiente. A conferência visual em aparelho fica para a revisão.

## Pendências

- O marcador `<!-- Próxima decisão -->` continua em D-PROD-284. Outra missão em paralelo pode tomar a D-PROD-284, por isso esta ficou com a D-PROD-285.
- No computador, a tabela da Entrada tem 9 colunas de campos e rola na horizontal quando a largura não basta (`b1-tipo-tabela__rolagem`), como a tabela das Áreas.
