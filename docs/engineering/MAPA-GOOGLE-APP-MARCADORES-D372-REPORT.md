# Mapa do Google no app: lotes, cochos, pontos e tarefas (D-PROD-372)

**Data:** 2026-11-27 · **Decisão:** [D-PROD-372](./DECISIONS.md) · **Antes:** [etapa 2 no site, D-PROD-369](./MAPA-GOOGLE-ETAPA2-D369-REPORT.md) · **Migration:** nenhuma · **APK:** nenhum (atualização automática; o APK atual é o 1.0.6)

## Por quê

O proprietário testou o APK 1.0.6: no mapa do Google do app apareciam só as áreas. No app, o mapa do Google é o nativo do plugin `@capacitor/google-maps`, e o SDK nativo só aceita imagem de marcador vinda de um arquivo do app ou de um endereço `https`. Ele não aceita a imagem que o sistema desenha na hora: o lote com o número de cabeças e o identificador, o cocho com o nível e o farol.

## A escolha do proprietário

| | Ícones iguais (escolhida) | Ícones do Google |
|---|---|---|
| Desenho do código | sim | sim |
| Cabeças, nível, farol, identificador no ícone | sim | não (só ao tocar) |
| Ícone durante o arrasto | some e volta quando o mapa para | acompanha o mapa |
| APK novo | não | sim |

"É melhor deixar do jeito que está o nosso, não quero mudar."

## O que mudou

- **Camada por cima do mapa nativo:** `src/lib/mapaNativo/camadaDeImagens.js`. As imagens, as posições (centro no ponto mais o deslocamento do MapLibre), a ordem e os cliques são os mesmos do site: `useMarcadoresGoogle` e `itensDoMapaGeral`.
- **Posição pela câmera:** `projetarNaCamera`.
  - O plugin entrega a câmera quando o mapa para (`onCameraIdle`: latitude, longitude, zoom, rumo, inclinação).
  - A projeção é Web Mercator no zoom do Google (ladrilho de 256 px, em dp, que no app equivale ao px da página), com o centro da câmera no meio do elemento.
  - Ela é girada pelo rumo e, perto do meridiano 180, usa o caminho mais curto.
  - Mapa inclinado não tem projeção plana, e os ícones ficam escondidos.
- **Movimento:** quando o mapa começa a se mexer (`onCameraMoveStarted`), a camada some; quando ele para, ela volta reposicionada. O plugin não avisa a câmera quadro a quadro.
- **Toque:**
  - O `div` da camada tem `pointer-events: none`, então o toque fora do ícone vai para o mapa nativo: o plugin decide pelo `elementFromPoint`.
  - A imagem pega o toque e abre o mesmo detalhe de antes. Ela também tem `touch-action: none`.
- **Ligação:** no app, o `MapaGoogleNativo` entrega ao `MapaGeral` o `definirMarcadores` da camada, e não o mapa nativo. O resto é o mesmo do site.

## Testes

- `tests/smoke/mapaGoogleAppMarcadoresD372.test.jsx`, 7 testes:
  - **projeção:** centro, escala do zoom, rumo, inclinado, meridiano 180;
  - **camada:** posição, ordem, clique, troca por grupo, limpar, `touch-action`;
  - **componente no app:** recebe a camada, some ao mexer, volta ao parar, continua escondida com o mapa inclinado, e o `div` não pega o toque;
  - **no site:** não há a camada do app.
- `tests/smoke/mapaGoogleNativoD366.test.jsx`: o mapa falso ganha `setOnCameraMoveStartedListener`.
- `gate:types`, lint e `gate:governance-paths`: verdes.

## O que não deu para testar aqui

O mapa nativo não roda no container, porque não há Android nem iOS. A prova é o app do proprietário, com o APK 1.0.6 e a atualização automática.

## Fica para depois

- **Etapa 3:** os nomes dos pastos.
- **Etapa 4:** arrastar lote, piscar o identificador, linhas, localização, coloração e "Localizar".
- **Pinça a partir de um ícone:** começar a pinça com um dedo em cima de um ícone não dá zoom, porque esse toque é da página. Basta começar fora do ícone.
