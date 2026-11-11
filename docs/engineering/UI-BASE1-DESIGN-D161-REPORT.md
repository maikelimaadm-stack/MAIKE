# UI-BASE1-DESIGN-D161 — relatório

**Fatia:** acabamento do design "Cadastro de Lote" no motor Base1 (D-PROD-161).
**Tipo:** visual (UI). Sem migration, domínio, rota, página, config ou dependência nova.
**Fonte da verdade:** `docs/design/cadastro-de-lote/cadastro-de-lote.dc.html` (roda com o `support.js` de `docs/design/detalhes-do-lote/`).
**Pedido do proprietário:** repassar a configuração ao motor Base1 e a todas as telas que o consomem, mantendo o tamanho de fonte real do sistema.

## O que foi feito

| Peça | Arquivos |
|---|---|
| Paleta quente no lugar (251 declarações, só regras do escopo do motor) | `src/styles/cadastro-base1.css`, `cadastro-b1-portal.css`, `cadastro-b1-controls.css`, `cadastro-b1ref.css`, `maike-mobile-shell.css`, `maike-notify.css`, `mk-filtros.css`, `mk-superficie.css`, `base1-tipografia.css` |
| Camada do design (tokens, botões, ícones, tabela, rodapé, abas, campo) | `src/styles/base1-design.css` (novo), `src/index.css` |
| Abas em pílula, cartão com título, seções empilhadas abaixo de 1024 px, ponto de pendência | `src/components/cadastro/base1/Base1PanelTabs.jsx` |
| Mensagem de erro com ícone; "Campo obrigatório" no lugar de "true" | `src/components/cadastro/base1/B1Field.jsx` |
| Teste | `tests/smoke/base1DesignD161.test.jsx` |

Como o porte é no motor, vale para todas as telas Base1. Só três formulários usam abas (Lotes, Bens, Empresa); os demais recebem paleta, campo, tabela e botões.

## Como a paleta foi portada

O design traz uma cópia do CSS do sistema já recolorida. Um script comparou regra a regra essa cópia com o CSS real e trocou só a cor, só onde o seletor é do motor. As 73 declarações de seletores compartilhados com o mapa e a casca (folha, pílulas, cabeçalhos) **não** foram tocadas.

## O que ficou de fora

Está no design e não entrou nesta fatia:

- faixa de filtros rápidos, pílula de ordenação e "+ Filtro";
- listas de seleção e menus no modelo novo (janela branca, pesquisa com linha);
- cards em duas colunas com tag "Inativo"; bolinha de cor na coluna Cor; nome em negrito na tabela;
- cabeçalho do celular e demais mudanças da casca;
- movimento de abrir e fechar;
- campos do Lote reorganizados dentro da aba Geral;
- rodapé em palavras ("12 lotes · 1 selecionado") — contraria o teste PAR6 de `mobileParidadeV2`.

Motivo: a leitura em paralelo do motor foi interrompida pelo limite de uso da conta; o que entrou é o que pôde ser conferido no navegador por uma pessoa só.

## Diferenças em relação ao design

1. **Tamanhos de fonte:** todos os do sistema, por pedido.
2. **Cartão da aba:** no design o fundo do registro é creme e o cartão é branco com sombra. Aqui o registro continua numa superfície branca e o cartão da aba tem borda fina, porque Lotes, Bens e Empresa têm campos acima das abas que ficariam soltos no fundo.
3. **Botão de lista lateral das abas:** mantido (o design não o mostra; há teste e preferência salva).
4. **Caixa de seleção de 18 px e chave:** diferenças vindas de cópia antiga do CSS no design; vale o repositório.

## Verificação

- Navegador real (Chromium, backend falso, 1280/820/390 px): lista, registro em leitura e edição, novo com erros, cards, busca, menus. Capturas em `docs/engineering/evidencias/base1-design-d161/` (`design-*` e `app-*`).
- `npm run verify:all`: ver o PR. `test:backend` exige PostgreSQL, que não existe neste contêiner; a fatia não toca o backend.

## Pendências e decisões para o proprietário

- Portar o restante da lista acima (uma fatia por peça).
- Rodapé em palavras: revoga a ordem "Listados, Filtrados, Totais, Selecionados"?
- Levar a paleta quente ao Mapa Geral e à casca?
