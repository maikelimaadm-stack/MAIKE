# MAIKE — Controles do Mapa Geral numa faixa acima do mapa (D-PROD-286)

**Data:** 2026-11-24 · **Decisão:** [D-PROD-286](./DECISIONS.md) · **Branch:** `claude/kind-knuth-tztu1v`

## O que foi pedido

O proprietário quer que o mapa abra calmo, com o terreno em primeiro plano e os comandos fora dele. Depois de várias rodadas de imagens (atual × proposto, em celular, tablet e computador), aprovou a arrumação e o estilo de botão do exemplo "Chat | Work".

## O que mudou

Só arrumação: tudo o que se fazia no mapa continua.

| Peça | Antes | Depois |
|---|---|---|
| Filtro · Lotes · Pontos · Visualização | Barra escura flutuando sobre o mapa (celular); botões soltos (computador/tablet) | Faixa branca fixa acima do mapa, com um trilho segmentado; Filtro e Visualização só com ícone |
| Resumo dos animais | Cartão embaixo à esquerda | Mesmo lugar, no estilo de trilho, mais baixo, milhar em pt-BR |
| Atualizar · Localização · Arrasto | Pilha à direita, no topo | Pílula em pé embaixo à direita |

## Arquivos

- `src/components/mapa/MapaControlesMobile.jsx` — a barra dentro de `.mk-mapa-faixa`; pílula com classes próprias `mk13-pilha`/`mk13-btn`.
- `src/pages/MapaGeral.jsx` — contêiner em coluna (`mk-mapa--v13`): faixa em cima, área do mapa (`mk-mapa-area`) embaixo; resumo numa linha.
- `src/styles/mapa-controles-v13.css` (novo).
- `tests/smoke/mapaControlesV13.test.jsx` (novo).

## Verificação

- Suíte smoke completa: 327 arquivos, 4.121 testes passando; os testes do mapa existentes passam sem alteração.
- `gate:source-closure`, `gate:types` e eslint dos arquivos tocados passando.
- Mapa real aberto em 1280, 820 e 390 px (Lotes, Pontos e o painel Visualização aberto).
- A atribuição do MapLibre foi deslocada para não ficar sob a pílula; no celular sobe acima do resumo.

## Pendências

- As regras antigas da barra escura e da pilha (`.mk-mapa-barra`, `.mk-mapa-dir`, `.mk-mapa-pilha .mk-mapa-btn`) continuam em `mapa-geral.css` e `mk-mapa-superficie.css`, sobrepostas pelo CSS v13; podem ser apagadas numa limpeza.
- Próxima etapa aprovada em proposta: aparência dos pastos e marcadores.
