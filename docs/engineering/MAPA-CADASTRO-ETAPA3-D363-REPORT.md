# Relatório: cadastrar no mapa como no AgriWebb, etapa 3 (D-PROD-363)

**Data:** 2026-11-27 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-363](./DECISIONS.md)

## Pedido

O proprietário pediu cadastrar pastos e linhas no mapa como no AgriWebb, também sem internet. No AgriWebb, a pessoa anda pela divisa e o app grava o contorno sozinho. Aqui, a captura por GPS só marcava um ponto a cada toque em "Marcar ponto N".

## O que mudou

| Onde | Mudança |
|---|---|
| `src/lib/maplibre/gravacaoCaminhando.js` (novo) | `deveGravar`: precisão ≤ 25 m, ≥ 5 m do último ponto e leitura nova. `simplificarTrilha`: Douglas-Peucker em metros, mantém pontas e cantos à mão. `distanciaM` |
| `src/components/mapa/CapturaGPSPoligono.jsx` | Gravar caminhando com Pausar/Continuar, Canto e Terminar; aviso de GPS fraco; tela acesa enquanto grava; satélite pelo controle do editor (`useBasemap`); pastos e linhas por baixo; abre no `body` (portal); confirmar no meio da gravação enxuga antes de salvar |
| `tests/e2e/harness/main.jsx` · `run-captura-gps.cjs` (novo) | Cena `captura` e o roteiro no navegador real |

## Verificação

- `tests/smoke/gravarCaminhandoD363.test.jsx`, GC-01 a GC-05:
  - GC-03, GC-04 e GC-05 falham no código antigo;
  - GC-01 e GC-02 são do módulo novo.
- Navegador real (harness WebGL, Pixel 7 com toque), `node tests/e2e/harness/run-captura-gps.cjs`:
  - o roteiro "anda" um quadrado de 60 × 60 m, um passo a cada 2 m, pelo GPS do Playwright;
  - gravou 32 pontos sozinho e ficaram 7 depois de Terminar;
  - a área deu 0,36 ha (60 × 60 m) e Confirmar salvou os 7;
  - a tela ocupa a tela inteira, no `body`, sem rolagem horizontal e sem erro de página;
  - capturas em `evidencias/mapa-cadastro/d363-*`.
  - No harness não há chave de satélite, então o fundo cai para as ruas, como deve sem chave.

## Limites

- Com a tela apagada à força ou com o app em segundo plano, o celular pode parar o GPS do app. Por isso a tela fica acesa enquanto grava.
- A gravação com o app fechado exigiria código nativo de localização em segundo plano, e ficou de fora.
