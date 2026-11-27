# Mapa leve — etapa 1 (D-PROD-347)

**Data:** 2026-11-27 · sem servidor, sem migration

## Objetivo da missão

Deixar abrir, arrastar e dar zoom no Mapa Geral tão leves quanto no app do AgriWebb, sem trocar o MapLibre e sem mudar o visual aprovado. Plano em etapas: (0) medir, (1) nomes sem travar o zoom, (2) pontos desenhados pelo mapa, (3) lotes desenhados pelo mapa, com arrastar, (4) medir de novo.

## Como medir

```bash
npx vite --config tests/e2e/harness/vite.e2e.config.mjs --force
```

```bash
node tests/e2e/harness/run-perf.cjs 200 rotulo
```

`?grande=N` no harness gera N pastos em grade, um lote em cada e um cocho a cada 4. O WebGL é SwiftShader (CPU): os números comparam antes × depois na mesma máquina; não são o tempo de um celular. Reiniciar o Vite com `--force` entre medições (sem isso ele serviu código antigo numa rodada).

## Resultado (200 pastos, Pixel 7 emulado, CPU 4×)

| Cenário | Antes | Depois |
|---|---|---|
| Zoom — quadros/s | 2,5 | 8,5 |
| Zoom — quadro mais lento (p95) | 1.200 ms | 217 ms |
| Zoom — layout no gesto | 36 s | 0,05 s |
| Arrastar — quadros/s | ≈ 9 | ≈ 9 |

Perfil (CPU) do zoom antes: 28,5 s em `getBoundingClientRect` dentro de `arrumarRotulos`, quase tudo na última passada (ler um nome, escalar, ler o próximo). Depois: 0,26 s.

## O que mudou

- `src/components/mapa/useMapRenderer.jsx`: última passada de `arrumarRotulos` em duas (ler todos, depois escrever todos); `arrumarRotulos({ soNaTela: true })` durante o zoom mexe só nos pastos na tela; o `moveend` revê todos.
- `tests/e2e/harness/`: `run-perf.cjs` (novo), `dados.js` (`?grande=N`), `stubs/AuthContext.jsx` e alias no `vite.e2e.config.mjs` (o Mapa Geral passou a usar `useAuth`).
- `tests/smoke/mapaLeveRotulosD347.test.js`: guarda as duas passadas e a revisão só na tela.

## O que fica para as próximas etapas

O arrastar continua em ≈ 9 quadros/s: o custo é o recálculo de estilo de ~400 marcadores HTML (nomes, lotes e cochos) reposicionados a cada quadro (`estilo_s` ≈ 9 s no gesto). A próxima etapa desenha pontos e lotes pelo próprio mapa (camadas `symbol` com as mesmas imagens). Riscos levantados: contagem do lote sem fonte de letras no mapa sem internet (vira parte da imagem), arrastar o lote (refazer com os eventos do mapa), ordem dos desenhos (o que for pintado no mapa fica abaixo do que continuar HTML).
