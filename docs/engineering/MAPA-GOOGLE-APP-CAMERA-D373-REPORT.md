# Mapa do Google no app: os ícones andam junto com o mapa (D-PROD-373)

**Data:** 2026-11-27 · **Decisão:** [D-PROD-373](./DECISIONS.md) · **Antes:** [ícones no app, D-PROD-372](./MAPA-GOOGLE-APP-MARCADORES-D372-REPORT.md) · **Migration:** nenhuma · **APK:** 1.0.7 (código 8), `nativoMinimo` 5

## O que o proprietário viu no APK 1.0.6

- "Quando começo a dar zoom os pontos somem e só aparecem depois que eu paro."
- "Movimentar no mapa também faz sumir os ícones."
- "Quando dou zoom com o dedo em algum ícone trava e não dá zoom."

## Causas

1. O plugin `@capacitor/google-maps` só avisa a câmera quando o mapa começa a mexer (`onCameraMoveStarted`) e quando para (`onCameraIdle`). Sem a câmera durante o movimento, os ícones (um `div` por cima do mapa nativo) não tinham como acompanhar e ficavam escondidos.
2. A imagem do ícone pegava o toque. O plugin entrega ao mapa nativo só o toque que começa fora de elementos da página (`elementFromPoint`), então a pinça que começava num ícone ficava na página.

## O que mudou

### Câmera a cada quadro (APK 1.0.7)

`scripts/app/remendar-google-maps.mjs` roda no `postinstall`, antes do `cap sync` e do build do APK. Ele faz o mapa nativo avisar `onCameraMove` com latitude, longitude, zoom, rumo e inclinação:
- **Android:** dentro do `onCameraMove` que o plugin já ouvia (ele só usava para agrupar marcadores).
- **iOS:** no `mapView(_:didChange:)` do `GMSMapViewDelegate`.

O remendo é idempotente. Se o plugin mudar de versão e o ponto de remendo sumir, ele avisa e não mexe, e o teste `mapaGoogleCameraD373` reprova.

No app, o `MapaGoogleNativo` ouve o evento pelo plugin (`pluginDoMapaGoogle`) e reposiciona os ícones a cada quadro, com a mesma projeção da D-PROD-372. No APK 1.0.6, que não tem o evento, os ícones continuam sumindo durante o movimento e voltando quando o mapa para. O site funciona nos dois, então o `nativoMinimo` segue 5.

### Todo toque é do mapa

- As imagens dos ícones têm `pointer-events: none`: a pinça e o arrasto em cima de um ícone mexem o mapa.
- O toque rápido chega pelo clique do mapa (`onMapClick`) e é decidido no JavaScript:
  - **Ícone:** o ícone de cima no ponto, com folga de 4 px para o dedo, abre o detalhe dele (`camada.tocar`).
  - **Área:** sem ícone, a área que contém o ponto abre o detalhe da área (`areaNoPonto`, ponto no polígono).
- No app, os polígonos não são clicáveis, para o clique do mapa sempre chegar. No site nada muda.

## Testes

- `tests/smoke/mapaGoogleCameraD373.test.js`, 4 testes:
  - o plugin instalado está remendado no Android e no iOS;
  - o remendo é idempotente;
  - plugin mudado ou ausente: não mexe;
  - o `postinstall` roda o remendo, e a versão do APK é 1.0.7.
- `tests/smoke/mapaGoogleAppMarcadoresD372.test.jsx`, 9 testes:
  - o toque vai para o ícone de cima;
  - a imagem não pega toque;
  - com o evento, os ícones ficam à vista e acompanham a câmera, e o evento de outro mapa é ignorado;
  - no APK antigo, somem e voltam;
  - o toque no ícone abre o ícone, o toque no pasto abre a área, e os polígonos não são clicáveis.
- `tests/smoke/mapaGoogleNativoD366.test.jsx`: o mapa falso ganha `setOnMapClickListener`.
- `gate:types`, lint e `gate:governance-paths`: verdes.

## O que não deu para testar aqui

O mapa nativo não roda no container. O workflow `app-android` desta PR confere que o Android compila com o remendo e sai assinado. A prova final é o APK 1.0.7 no celular do proprietário.
