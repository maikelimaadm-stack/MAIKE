# Relatório — a sincronização num cartão no meio da tela (D-PROD-331)

**Data:** 2026-11-26 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-331](./DECISIONS.md)

## Pedido

"A sincronização tem que aparecer no meio da tela."

Das opções oferecidas, o proprietário escolheu "Cartão no meio, app livre".

## O que mudou

| Onde | Mudança |
|---|---|
| `src/components/offline/CirculoDeSincronizacao.jsx` | O círculo do canto virou um cartão no meio da tela, com o círculo grande (84 px) mostrando a porcentagem, o título e a etapa. Tocar abre a "Sincronização". No fim, mostra ✓ ou ! e some. |
| `src/styles/mk-sincronia.css` | O cartão fica centrado, sem fundo escuro, acima do mapa e abaixo das janelas. |

O resto da D-PROD-329 não mudou: quando sincroniza, a ordem envio → baixa e a porcentagem por etapa.

## Verificação

- Conferido em imagem de 390 px: o cartão fica no meio, mostrando 68 %, "Sincronizando" e "Baixando: Cadastros", e o mapa continua visível em volta.
- `tests/smoke/sincronizacaoCompletaCirculo.test.jsx` (SC-01..05) continua passando: porcentagem, ✓ e toque abrindo a janela.
