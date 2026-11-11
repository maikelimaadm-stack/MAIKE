# UI-MAPA-TIPOGRAFIA-D173 — relatório

**Fatia:** o Mapa Geral com a tipografia do motor Base1 (D-PROD-173).
**Tipo:** visual. Mudam só tamanho, peso e família de fonte. Sem migration, rota, página, regra, envio ao servidor ou dependência nova.
**Pedido do proprietário (2026-11-11):** "ajuste todas as fontes do meu mapa para igual a fonte do motor base 1 […] Detalhes de lote, etc".
**Escala do motor (D-PROD-167):** Open Sans no texto e Lato nos títulos e números; 13 · 14 · 16 · 18 · 20 · 24 · 30 · 34 · 46 px.

## Como foi medido

No navegador (Chromium, backend falso só de leitura, sem nenhuma escrita), o mapa abriu com 8 pastos e 11 lotes ativos, com as posições do rebanho como em produção (`LEDGER=1`). Para cada estado, um script leu a família, o tamanho e o peso de todo texto visível e agrupou os resultados:

- mapa;
- Detalhes do Lote: abas Tudo, Área, Lotes e Suplementação;
- Filtros, Visualização, Tarefas e Histórico da área;
- manejos de Pesagem e de Movimentação, e Editar informação.

As medidas foram feitas em 1366 px e em 390 px, antes e depois da mudança.

| Antes (exemplos) | Depois |
|---|---|
| Rótulos e valores do Detalhes do Lote 10,5 px / 500–600 | rótulo 13 px / 400, valor 14 px / 500 |
| Pílula de título do cartão 11 px / 700; situação ("Atenção") 10 px / 700 | Lato 13 px / 600; 13 px / 600 |
| Títulos de seção em caixa alta 9 px / 700 | Lato 13 px / 600, MAIÚSCULAS |
| Abas do Detalhes 13 px (12,5 px no celular) | 14 px / 600 |
| Linhas de Filtros e Visualização 12 px; títulos 12 px | 14 px; Lato 13 px / 600 |
| Manejos, Ações do lote, Histórico e Tarefas: 11 a 12,5 px | 13 px (apoio) e 14 px (texto, botões, opções) |

Depois da mudança, nenhum texto da interface do mapa fica abaixo de 13 px, fora as peças que já são do próprio motor: o rótulo do campo quando sobe (12 px, D-PROD-167) e o rodapé das listas ("0 tarefas"). Ficam de fora também:

- os rótulos desenhados sobre o mapa (nome do pasto, hectares, cabeças, siglas), que seguem o zoom;
- a atribuição do mapa base.

## O que mudou

| Peça | Onde |
|---|---|
| Tabela de papéis `TIPO` (texto, valor, rótulo, item, selo, título, grupo) e uso dela em todas as peças do Detalhes do Lote | `src/components/mapa/detalhes-lote/*.jsx` |
| Colunas da vista Lista crescem na proporção do texto (14 / 10,5); cartão de lote da aba Tudo em 3 colunas no desktop e no tablet | `VistaLista.jsx`, `CartoesLoteTudo.jsx` |
| Texto que corre (`.mk-dl__linha`) herda o tamanho de quem o usa | `src/styles/lancamento-lote.css` |
| Abas, subtítulo da janela, quadros de manejo e seletores do Detalhes | `src/styles/mk-detalhes-lote.css` |
| Filtros e Visualização: `--mk-map-font` 14 px, títulos em Lato 13 px, rótulos de campo 13 px com coluna maior | `src/styles/mk-mapa-superficie.css` |
| Manejos, Ações do lote, Histórico, Tarefas | `src/styles/lancamento-lote.css` |
| Botões do mapa, aviso do satélite, painel Visualização, resumo | `src/styles/mapa-geral.css` |
| Painéis de depósito e cocho, filtros avançados, legenda, insights, tarefas e importação: tamanhos de 8 a 12 px viram 13 px (apoio) ou 14 px (texto), e os títulos usam `mk-tipo-titulo` / `mk-tipo-grupo` | `src/components/mapa/*.jsx`, `src/styles/tipografia-sistema.css` |

## Verificação

- `npm run test:smoke`: 199 arquivos e 2.443 testes, todos passando. `detalhesLoteVisualGesto.test.jsx` foi atualizado para conferir a pílula com o título do motor, `.mk-dl__linha` herdando o tamanho e `.mk-dl__chip` com 13 px.
- Capturas em 1366 px e em 390 px conferidas uma a uma: nenhum rótulo cortado. O "Peso médio (kg)" do cartão de lote e o "Tipo de Pastagem" dos filtros cortavam antes do ajuste de colunas.

## Evidências

`docs/engineering/evidencias/mapa-tipografia-d173/`:

- `detalhes-lote-tudo-antes-depois.png` e `detalhes-lote-lotes-antes-depois.png`: Detalhes do Lote no desktop;
- `manejo-pesagem-antes-depois.png`: manejo de Pesagem aberto pelo Detalhes;
- `paineis-filtros-visualizacao-antes-depois.png`: painéis Filtros e Visualização;
- `celular-detalhes-filtros-antes-depois.png`: celular, Detalhes do Lote e Filtro.

## Fora desta fatia

O Cadastro de Áreas, Pontos e Linhas no motor Base1 vai na próxima missão (D-PROD-174).
