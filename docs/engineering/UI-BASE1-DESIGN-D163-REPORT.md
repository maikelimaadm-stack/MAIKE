# UI-BASE1-DESIGN-D163 — relatório

**Fatia:** design "Cadastro de Lote" no motor Base1 (D-PROD-163; paridade medida em D-PROD-164).
**Tipo:** visual (UI) e comportamento de tela. Sem migration, domínio, rota, página, config de escopo ou dependência nova.
**Fonte da verdade:** `docs/design/cadastro-de-lote/cadastro-de-lote.dc.html` (roda com o `support.js` de `docs/design/detalhes-do-lote/`).
**Pedido do proprietário:** repassar a configuração ao motor Base1 e a todas as telas que o consomem, mantendo o tamanho de fonte real do sistema; depois, "100% igual", medido no sistema real e não em capturas.
**Numeração:** nasceu como D-PROD-161/162; no merge da `main` (que já tinha a D-PROD-161 do Estoque P0-01 e a D-PROD-162 do Patrimônio SIMPLIFICA-01) passou a D-PROD-163/164, com código, testes, relatório e evidências.

## Como a paridade foi medida (D-PROD-164)

Comparação automática no navegador (Chromium), estado por estado, nos três tamanhos (desktop 1280×900, tablet 820×1180, celular 390×844):

1. o design roda no próprio protótipo (moldura do aparelho); o sistema roda de verdade (Vite, com backend falso com os mesmos 12 lotes do design);
2. cada elemento visível dos dois lados é casado por tag + classes do motor + rótulo/texto;
3. para cada par: posição e tamanho (tolerância 1 px) e estilo calculado (cor, fundo, bordas, cantos, sombra, espaçamentos, peso, opacidade, traço de ícone, cursor, cor visível do texto);
4. lista o que existe só de um lado, e gera captura dos dois lados com mapa de diferenças em pixels;
5. para cada diferença, a regra CSS vencedora é localizada (DevTools Protocol) para corrigir na origem.

Estados medidos (os mesmos do design): lista, linha selecionada, registro em leitura, registro em edição, novo com erros, pílula de filtro, Ordenar, "+ Filtro", pesquisa, funil, menu da coluna, mais opções, cards, tabela no celular, lista do campo (Setor), Sistema Produtivo, quantidade por página e excluir — 43 combinações estado × tamanho.

**Movimento (proposta 6.32).** Em cada ação, no design e no sistema, toda animação é gravada — as feitas por script (`Element.animate`) e as de CSS (`animationstart`) — com alvo, quadros-chave, duração, curva e preenchimento, e as duas listas são comparadas entrada a entrada. Também são congelados quadros no mesmo instante (60, 150 e 300 ms depois do clique) dos dois lados. 63 combinações de ação × tamanho: abrir e fechar cada janela, escolher opção, filtro novo, pesquisa, condição, Configurar colunas, aba editando × leitura, próximo registro, editar, cancelar, aperto do Novo, folha do celular (✕, Esc, escolher) e abrir card.

## O que foi feito

| Peça | Onde |
|---|---|
| CSS de propostas do design portado **inteiro e mecanicamente** (`@container` → `@media`, peças compartilhadas sob `body:has(.cadastro-b1--full-page)`, nenhum `font-size`) | `src/styles/base1-design.css` |
| Tokens da raiz do design; cores frias literais do CSS do sistema viram `var(--mkq-<hex>, <hex>)` (quentes só com tela Base1 aberta) | `src/styles/base1-design-tokens.css` + 15 arquivos de `src/styles/` (só o valor da cor muda) |
| slate/gray do Tailwind em variável com a cor padrão de reserva | `tailwind.config.js`, `src/styles/base1-design-tokens.css` |
| Hex arbitrários frios em classes (`bg-[#FAFCFE]`…) | `src/styles/base1-paleta-tailwind.css` |
| Acertos do app para o design (cada um com o porquê) | `src/styles/base1-design-ajustes.css` |
| Tipografia só com tamanhos (as cores seguem o design) | `src/styles/base1-tipografia.css` |
| Título visível do desktop, faixa de filtros (faixa/trilho/setas, janelas, condição, lista "Filtros" no celular), rodapé em palavras | `CadastroWorkspace.jsx`, `FiltrosRapidos.jsx`, `CadastroListaChrome.jsx`, `contagemBase1.js`, `CadastroBase1Grade.jsx` |
| Grade: ponto de situação, título da célula de cor pelo nome, "0" não é vazio, caixa de 18 px | `cadastroBase1CellKind.jsx`, `Base1Grid.jsx`, `Base1Ui.jsx` |
| Registro: ‹ › na linha das abas (desktop) ou acima das seções (tablet), na ordem da grade; sem a faixa de cabeçalho; sem lista lateral | `registroNavBase1.jsx`, `ordemDaListaBase1.js`, `Base1PanelTabs.jsx`, controladores |
| Formulário: grupos, chave em caixa, campo travado, campo numérico, dica do ícone oficial sob a categoria, Sistema Produtivo em janela, larguras do design | `DynamicFormRenderer.jsx`, `B1Field.jsx`, `B1MultiSelecao.jsx`, `FormularioLote.jsx`, `IconeOficialLotePreview.jsx` |
| Listas de seleção dos campos no modelo do design (largura do campo, "+" na pesquisa, nome do campo) | `PainelSelecao.jsx`, `AutocompleteGenerico.jsx` |
| "Filtrar por campo" sem título e alinhado como no design | `FiltroPorCampo.jsx` |
| Movimento do design feito por script: aperto com mola, janela que nasce do botão e volta para ele, pílula nova que cresce — ligado só com tela Base1 aberta, nada com "reduzir movimento" | `movimentoBase1.js` (usado por `CadastroWorkspace.jsx`, `CadastroRapidoSheet.jsx`, `TarefasCardsMapa.jsx`) |
| Folha do celular com tela Base1 aberta: ✕ e toque fora fecham na hora e a cópia desce como no design | `MobileSheet.jsx` |
| Painel da aba só esmaece ao trocar de aba; ‹ › não repetem a entrada ao trocar de registro; "Confirmar exclusão" sem esmaecer | `Base1PanelTabs.jsx`, `registroNavBase1.jsx`, `CadastroListaChrome.jsx`, `base1-design-ajustes.css` |

Como o porte é no motor, vale para todas as telas Base1. O Mapa Geral não muda: tudo o que é compartilhado só muda com uma tela Base1 aberta.

## Resultado (medição final)

Arquivo completo: `docs/engineering/evidencias/base1-design-d163/paridade-RESUMO.txt`.

| Tamanho | Estados | Elementos sem par (por lado) | Estilos diferentes por estado |
|---|---|---|---|
| Desktop | 17 | 5–8 na lista e janelas (dados e nomes de ícone) | 18–31, todos explicados abaixo |
| Tablet | 17 | 7–11 (idem) | 11–36 |
| Celular | 8 | 6–13 (idem) | 21–26 |

O que sobra, em todos os estados, é só:

1. **Tamanho de fonte** (pedido do proprietário: vale o do sistema). Ex.: tabela 12 px no sistema × 13 px no design; título da página 13 × 15 px — por isso a lista fica 4 px mais alta no desktop; rótulos e chips mudam a largura em 1–4 px.
2. **Dados do ambiente de teste:** nome do usuário ("Usuario" × "Maike") e um módulo a mais no menu (Patrimônio e Frota); ícone oficial da categoria (o backend falso não tem o vínculo do catálogo).
3. **Artefatos do arquivo do design:** ícones de cadeado e calendário quebrados no design (o arquivo trocou `viewBox` por `sc-camel-view-box`); preto `#000` × `#0a0a0a` no texto da casca (o protótipo não tem a variável de cor do tema); nomes de ícone do Lucide (`table-2` × `table2`).
4. **Comportamento do sistema mantido:** painel de correção da entrada (R1) no registro em edição; "Carregar mais" apagado quando não há mais registros; foco do teclado vai para a lista aberta (o visual de campo aberto foi reproduzido); dica "Novo setor" no "+" (o design diz "Novo").

### Movimento

Arquivo completo: `docs/engineering/evidencias/base1-design-d163/movimento-RESUMO.txt`; quadros congelados em `movimento-ordem.png` e `movimento-mais-opcoes.png` (esquerda = design, direita = sistema).

| | Animações do design | Idênticas no sistema | Só px diferente | Explicadas |
|---|---|---|---|---|
| Desktop, tablet e celular (63 ações × tamanho) | 250 | 227 | 16 | 7 |

- **Só px:** o recorte de partida é o próprio botão, que mede alguns px a menos ou a mais com a fonte do sistema.
- **Explicadas:** a mesma folha do celular com uma classe a mais no sistema (`mk-base1-sheet`), animação igual; a mola de volta do "Cancelar", que no design roda num botão que já saiu da tela (nada visível).
- **Próximo registro:** aqui o formulário remonta ao trocar de registro (no design, não). Por isso a mola continua no botão novo (mesmo lugar, mesmo nome, mesmo ponto da curva) e ‹ › não repetem a entrada — na tela, igual ao design.
- **Arquivo do design:** no tablet, a área de rolagem do design fica por cima de ‹ › e eles não recebem o clique; no sistema funcionam.

## Mudanças de comportamento (decididas em D-PROD-164)

- Rodapé em palavras ("12 lotes", "5 de 12 lotes · 1 selecionado"); some no celular e no registro fora do desktop. Os números ficam em `data-*` do `.mg-summary`.
- ‹ › do registro seguem a ordem que a lista mostra (antes: a ordem dos dados).
- Salvar com campo numérico vazio avisa "Campos obrigatórios" ("Número inválido" só com número digitado errado).
- Celular: o funil abre a lista "Filtros" da faixa (antes: "Filtrar por campo").
- Abas sem a opção de lista lateral; "Ativo" como chave em caixa; situação na grade com ponto colorido (o selo antigo saiu).
- Com tela Base1 aberta: janelas abrem e fecham com o movimento do design; o painel da aba não esmaece mais ao abrir, criar ou trocar de registro (só ao trocar de aba); "Confirmar exclusão" aparece e some sem esmaecer; no celular, o ✕ e o toque fora fecham a folha na hora e a cópia faz a descida (arrastar para fechar continua igual).

## Verificação

- Navegador real: medição acima (`paridade-*.png` = design | sistema | diferenças em vermelho; `design-*`/`app-*` = capturas).
- Testes: suíte de fumaça inteira passando; testes atualizados onde fixavam o comportamento antigo (rodapé, selo de situação, lista lateral, "+" da folha, chave do Ativo, dica do ícone) e testes novos (condição dentro da janela do filtro; movimento em `base1Movimento.test.jsx`: aperto e mola, mola no botão trocado, janela que nasce e volta, pílula nova, "reduzir movimento", folha do celular, painel da aba, ‹ › ao trocar de registro).
- `lint`, `gate:types`, `gate:source-closure`, `gate:import-integrity`, `gate:no-secrets`, `gate:base44`, `gate:product-scope`, `gate:governance-paths`. `test:backend` exige PostgreSQL, que não existe neste contêiner; a fatia não toca o backend.

## Pendências para o proprietário

- Levar a paleta quente (e o movimento) ao Mapa Geral e à casca fora das telas Base1?
