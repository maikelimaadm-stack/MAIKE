# Mapa do Google: nomes dos pastos e ícones nativos no app (D-PROD-374)

**Data:** 2026-11-27 · **Decisão:** [D-PROD-374](./DECISIONS.md) · **Antes:** [câmera a cada quadro, D-PROD-373](./MAPA-GOOGLE-APP-CAMERA-D373-REPORT.md) · **Migration:** nenhuma · **APK:** 1.0.8 (código 9), `nativoMinimo` 5

## O que o proprietário pediu

- Etapa 3 do mapa do Google: os nomes dos pastos, como no mapa de sempre.
- No APK 1.0.7: "só fica tremendo os ícones, mas isso você ajusta junto com os nomes" e "eles tremem e não acompanham, por quê?".

## Por que os ícones tremiam

- No app, os ícones ficavam num `div` por cima do mapa nativo. A posição deles vinha da câmera que o Android manda para a página.
- Essa câmera atravessa a ponte nativo → página. Ela chega com atraso, então o ícone anda atrás do mapa. Ela também chega em rajadas, várias num quadro e nenhuma no seguinte, então o ícone dá trancos.
- A posição era arredondada para o px inteiro. Com o mapa se mexendo, isso faz o ícone pular de um px para o outro.

## O que mudou

### Ícones como marcadores do próprio mapa (APK 1.0.8)

- O mapa nativo do Google desenha os marcadores dele junto com o mapa: eles não dependem da página e andam colados.
- O SDK só aceitava imagem de arquivo do app ou `https`. O remendo do plugin (`scripts/app/remendar-google-maps.mjs`, no `postinstall`) passa a aceitar a imagem `data:`. É a mesma imagem que o sistema desenha: o lote com as cabeças, o identificador, o cocho com o nível e o farol, os pontos, as tarefas e os nomes.
- O toque no marcador abre o detalhe do Mapa Geral. O remendo faz o mapa não centralizar nem abrir balão.
- `marcadoresNativos.js`:
  - A posição em px (centro ou topo no ponto + deslocamento) vira uma margem transparente na imagem, que põe o ponto do mapa no meio dela. A âncora 0,5 × 0,5 vale no Android e no iOS. A margem é em px inteiros, porque o Android lê o tamanho do ícone em número inteiro.
  - A troca por grupo compara o desenho e o lugar de cada marcador. O que não mudou fica. O que mudou entra antes do velho sair, para não piscar.
  - O nome do pasto muda de tamanho com o zoom. Ele é refeito no tamanho certo quando o mapa para, se mudou mais de 4%.
- O app só usa os marcadores nativos no APK 1.0.8 em diante (código 9, lido com `@capacitor/app`). No APK 1.0.7 ou mais antigo, segue o `div` por cima do mapa.

### Sem tremor no APK antigo e no site

- A câmera que chega em rajada é usada uma vez por quadro da tela (`requestAnimationFrame`).
- A posição não é arredondada: `translate3d` com 2 casas (`posicaoDoMarcador.js`). O site e o app usam a mesma conta.

### Nomes dos pastos

`nomesGoogle.js`, com as mesmas regras do MapLibre:
- Os três níveis: "tudo" (nome, hectares e o extra do Mapa Geral), "nome" e "sigla".
- O nível é o mesmo para todos os pastos, escolhido por colisão e por caber no pasto (`escolherModoRotulos`). Os ícones de lote contam como obstáculos.
- O tamanho segue o zoom (`tamanhoNoZoom`). No site, a cada quadro. No app, quando o mapa para.
- Sem lote, o nome fica centrado no ponto do pasto. Com lote, o topo do nome fica 10 px abaixo do ponto e o lote sobe para o par ícone + nome.
- O nome não pega o toque: no site, o clique passa para o pasto; no app, o toque no nome abre o pasto.
- O nível é revisto a cada câmera. Durante o movimento, só pelos pastos à vista e no máximo a cada 120 ms. Quando o mapa para, por todos.
- A letra Inter é esperada antes de medir, como no MapLibre.

## Arquivos

- `scripts/app/remendar-google-maps.mjs`: 6 remendos (câmera, imagem `data:` e toque no marcador, no Android e no iOS), cada um com a sua marca.
- `src/lib/mapaNativo/posicaoDoMarcador.js` (novo), `nomesGoogle.js` (novo), `marcadoresNativos.js` (novo).
- `src/lib/mapaNativo/mapaGoogleWeb.js`: tamanho no zoom, âncora, nome sem toque, `aoMudarCamera`.
- `src/lib/mapaNativo/camadaDeImagens.js`: a mesma conta de posição; o nome não pega o toque.
- `src/lib/mapaNativo/mapaGoogleNativo.js`: `APK_MARCADORES_NATIVOS` e `numeroDoApk`.
- `src/components/mapa/MapaGoogleNativo.jsx`: marcadores nativos no APK 1.0.8, câmera por quadro, toque no marcador, `aoMudarCamera`.
- `src/components/mapa/useMarcadoresGoogle.js`: `syncLabels`, `revisarNomes`, o lote sobe com nome.
- `src/pages/MapaGeral.jsx`: os nomes vão para o mapa do Google quando ele está aberto.
- `app-version.json`: 1.0.8 (código 9).

## Testes

- `mapaGoogleNomesD374.test.jsx` (16, novo).
- `mapaGoogleCameraD373.test.js`: os 6 remendos e o APK 1.0.8.
- `mapaGoogleAppMarcadoresD372.test.jsx` e `mapaGoogleMarcadoresD369.test.jsx`: `translate3d` e uma câmera por quadro.

## Como testar

1. Instalar o APK 1.0.8 (Release `app-v1.0.8`).
2. Abrir o Mapa Geral no mapa do Google (teste).
3. Arrastar e dar zoom: os ícones e os nomes ficam colados no mapa.
4. Dar zoom com os dedos em cima de um ícone: o mapa dá zoom.
5. Tocar num lote, cocho, ponto ou tarefa: abre o detalhe. Tocar no nome ou no pasto: abre o pasto.
6. No site, os nomes aparecem e mudam de tamanho e de nível com o zoom, como no mapa de sempre.

## Ainda não

- Etapa 4: arrastar lote, piscar o identificador, linhas, localização, "Localizar", local da tarefa pelo toque, coloração.
- Etapa 5: testes com o proprietário. Etapa 6: o mapa do Google vira o padrão.
