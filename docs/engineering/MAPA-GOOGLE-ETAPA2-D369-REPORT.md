# Mapa do Google, etapa 2: marcadores no site (D-PROD-369)

**Data:** 2026-11-27 · **Decisão:** [D-PROD-369](./DECISIONS.md) · **Antes:** [etapa 1, D-PROD-366](./MAPA-GOOGLE-NATIVO-ETAPA1-D366-REPORT.md) · **Migration:** nenhuma · **APK:** nenhum

## Por quê

A etapa 1 pôs o mapa do Google no Mapa Geral só com as áreas. O proprietário desligou a Map Tiles API (cobrada por imagem). Com isso, o satélite do site só vem pelo mapa do Google, e faltavam os lotes, os cochos, os pontos e as tarefas.

## O que mudou

### Site: a Maps JavaScript API direto

A versão web do plugin `@capacitor/google-maps` não dá acesso ao mapa e só põe marcador com a ponta embaixo. Os marcadores do Mapa Geral são outros:
- cochos, pontos e tarefas ficam centrados no ponto;
- o lote fica acima do centro do pasto, e o identificador ao lado;
- cada tipo tem uma ordem fixa.

`src/lib/mapaNativo/mapaGoogleWeb.js` cria o mapa pelo carregador canônico (`loadGoogleMaps`, chave `VITE_GOOGLE_MAPS_API_KEY`). O objeto tem os mesmos nomes de método do `GoogleMap` do plugin (`setMapType`, `addPolygons`, `removePolygons`, `fitBounds`, os ouvintes, `destroy`), então o `MapaGoogleNativo` continua um só. No app nada muda: segue o mapa nativo do plugin.

No site, o componente desenha num `div` comum. O elemento `capacitor-google-map` do plugin apaga o próprio conteúdo quando volta à página.

### Marcadores

Uma camada `OverlayView` com uma imagem por marcador, no painel que recebe o mouse:
- **Posição:** o centro da imagem fica no ponto, mais o deslocamento do MapLibre. O lote usa `OFFSET_LOTE_PX`, e o identificador usa esse deslocamento mais `DESLOC_IDENT_PX`. A posição é refeita a cada quadro do mapa.
- **Ordem:** a dos z-index de antes. Cocho 500 < ponto 800 < lote 1000 < lote com alerta < identificador < tarefa 2500 < tarefa Urgente 3000.
- **Toque:** abre o mesmo detalhe de antes e não passa para o mapa nem para a área por baixo (`preventMapHitsAndGesturesFrom`).
- **Título:** o do MapLibre, que aparece no mouse sobre cocho, ponto e tarefa.
- **Troca por grupo:** o que saiu some, o resto é atualizado no mesmo elemento (sem piscar), e os outros grupos ficam.

### Os mesmos marcadores nos dois mapas

O que vai em cada marcador (posição, imagem, título, objeto do clique) saiu do `useMapRenderer` para `src/lib/maplibre/itensDoMapaGeral.js`:
- `itensDosLotes`
- `itensDosPontos`
- `itensDaSuplementacao`
- `itensDasTarefas`

O MapLibre e o `useMarcadoresGoogle` usam essas funções. A imagem é o mesmo desenho, com o mesmo cache e a mesma fila de `lotesNoMapa.js` e `pontosNoMapa.js`. No Google, ela vira uma URL `data:`, convertida uma vez por chave e densidade. Imagem que falha usa a reserva, como no MapLibre: o círculo verde do lote e o círculo da cor do ponto.

O `MapaGeral` chama `syncLotes`, `syncPontos`, `syncPontosSuplementacao` e `syncTarefas` com os mesmos filtros, permissões, focos e cliques de antes. Com o mapa do Google ligado, quem recebe é o `useMarcadoresGoogle`; com ele desligado, o MapLibre.

## Correção depois do merge: zoom com o mouse em cima de um marcador

No teste do proprietário, a roda do mouse não dava zoom quando o cursor estava em cima de um lote, cocho, ponto ou tarefa. A camada usava `OverlayView.preventMapHitsAndGesturesFrom`, que corta o clique e também a roda, o arrasto e a pinça.

Agora só o clique é do marcador:
- a roda, o arrasto e a pinça chegam ao mapa, como no MapLibre;
- para a área por baixo não abrir junto, um clique no polígono até 700 ms (`MS_TOQUE_NO_MARCADOR`) depois de um toque que começou num marcador é ignorado.

O teste "a roda do mouse e o arrasto em cima do marcador chegam ao mapa" cobre os dois lados.

## Testes

- `tests/smoke/mapaGoogleMarcadoresD369.test.jsx`, 9 testes com um `google.maps` falso:
  - mapa, tipo, enquadramento, câmera parada e destruição;
  - polígonos com a `tag`;
  - posição, ordem, título, clique e troca por grupo dos marcadores;
  - lote com identificador e alerta, cocho, ponto e tarefa com a ordem e o clique certos;
  - figura remota lenta: o grupo sai com a reserva em até 250 ms e é publicado de novo quando ela chega (achado da revisão automática);
  - nada sem o mapa do site;
  - os dois mapas usam `itensDoMapaGeral`.
- `tests/smoke/mapaGoogleNativoD366.test.jsx`: 21 testes. O site agora cria o mapa sem o plugin, e o app segue pelo plugin com a chave.
- `tests/smoke/mapaRotulosSemBagunca.test.js`: o ponto do lote e da tarefa agora é lido em `itensDoMapaGeral.js`.
- Os testes do mapa passaram (105 arquivos, 1.102 testes), além de `gate:types` e lint.

## O que não deu para testar aqui

O mapa real do Google não roda no container, porque não há a chave. A prova é o site no ar, com a escolha "Mapa do Google (teste)".

## Fica para depois

- **Etapa 3:** os nomes dos pastos.
- **Etapa 4:**
  - arrastar o lote e piscar o identificador com alerta;
  - linhas, sua localização e "Localizar";
  - coloração e escolha do local da tarefa.
- **App:** marcadores no mapa nativo. O SDK nativo só aceita imagem de arquivo do app ou de endereço `https`, não a imagem desenhada na hora.
