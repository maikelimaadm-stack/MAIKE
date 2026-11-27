# Relatório: cadastrar no mapa como no AgriWebb, etapa 2 (D-PROD-362)

**Data:** 2026-11-27 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-362](./DECISIONS.md)

## Pedido

O proprietário pediu cadastrar no mapa como no AgriWebb, "movendo o ponto ou clicando para redirecionar na minha localização". A etapa 1 (D-PROD-361) levou o "+" com pasto, ponto e linha ao Mapa Geral e deixou o editor confortável no dedo. Esta etapa traz:
- a mira fixa no centro;
- seguir a posição;
- a seta de direção.

## O que mudou

| Onde | Mudança |
|---|---|
| `src/lib/maplibre/miraDoEditor.js` (novo) | `acaoDaMira`: o que "Marcar aqui" faz em cada situação. `centroDaMira`: o centro do mapa |
| `src/components/mapa/useRumoDoAparelho.js` (novo) | Rumo da bússola (Android absoluto e iPhone) e do GPS andando |
| `src/components/mapa/useLocalizacaoNoMapa.js` | `PosicaoGps` ganha `rumo` e `velocidade` |
| `src/components/mapa/useMinhaLocalizacaoNoEditor.js` | Seta no ponto azul, girada pelo rumo; devolve `rumo` |
| `src/components/mapa/MapaDesenho.jsx` | Coluna da direita com "Mira no centro" e "Seguir minha posição"; mira desenhada no centro; botão "Marcar aqui"; o toque não marca com a mira ligada; seguir recentra a cada leitura e para ao arrastar; medidas e dicas se ajustam à mira |

## Verificação

- `tests/smoke/miraNoEditorD362.test.jsx`, MI-01 a MI-08:
  - MI-04 a MI-08 falham no código antigo;
  - MI-01 a MI-03 são dos módulos novos.
- Navegador real (harness WebGL, Pixel 7 com toque): com a mira ligada, quatro "Marcar ponto aqui", arrastando o mapa entre eles, desenharam o pasto ("Área: 9,99 ha"). Sem erro de página e sem rolagem horizontal.
