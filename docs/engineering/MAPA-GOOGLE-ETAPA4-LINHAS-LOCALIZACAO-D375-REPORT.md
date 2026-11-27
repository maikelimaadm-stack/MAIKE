# Mapa do Google, etapa 4: linhas, minha localização e "Localizar" (D-PROD-375)

**Data:** 2026-11-27 · **Decisão:** [D-PROD-375](./DECISIONS.md) · **Antes:** [nomes dos pastos e ícones nativos, D-PROD-374](./MAPA-GOOGLE-ETAPA3-NOMES-D374-REPORT.md) · **Migration:** nenhuma · **APK:** nenhum novo

## O que faltava

No mapa do Google (site e app):
- As linhas do Mapa Geral (cercas, estradas, redes) não apareciam.
- A localização (ponto azul e círculo de precisão) não aparecia.
- O "Localizar" não fazia nada: o GPS só ligava com o mapa de sempre (MapLibre) pronto e centralizava nele.

## O que mudou

### Linhas

- Mesma cor (a da linha, ou laranja `#f59e0b`) e mesma espessura (3 px) do MapLibre, desenhadas como linha do próprio Google (`polilinhasDasLinhas`).
- No app, a espessura é multiplicada pela densidade da tela, como nos contornos das áreas.
- Tocar numa linha mostra o nome e o tipo dela num aviso. No MapLibre é um balão no ponto.
- No site, o toque que começou num ícone não abre a linha por baixo, a mesma regra das áreas.
- As linhas seguem a permissão "visualizar linhas" e a camada "Linhas" do painel.

### Minha localização

- O ponto azul (24 px, borda branca, sombra) é um marcador por cima de tudo e não pega o toque: o toque vai para o que está por baixo.
- O círculo mostra a precisão real do GPS, entre 3 e 500 m, e 20 m sem leitura (`circuloDaLocalizacao`, como o MapLibre).
- A cada leitura nova do GPS, o círculo novo entra antes de o velho sair, para não piscar.
- Seguem a permissão "visualizar localização" e a camada "Minha localização".

### "Localizar"

- Com o mapa do Google aberto, o GPS liga com ele (antes esperava o MapLibre).
- O "Localizar" centraliza no mapa do Google, no mesmo zoom de antes: 18 do MapLibre, 19 do Google.
  - `useLocalizacaoNoMapa` ganhou `centrarEm`.
  - O mapa do Google expõe `centrar`: no site, `setCenter` e `setZoom`; no app, `setCamera`.

## Por que não precisa de APK novo

O plugin `@capacitor/google-maps` do APK 1.0.8 já desenha linhas (`addPolylines`) e círculos (`addCircles`) e avisa o toque na linha (`setOnPolylineClickListener`). A mudança é só na página e chega pela atualização automática.

## Arquivos

- `src/lib/mapaNativo/mapaGoogleNativo.js`: `polilinhasDasLinhas`, `raioDaPrecisao`, `circuloDaLocalizacao`, `imagemDoPontoDeLocalizacao`, `marcadorDaLocalizacao`.
- `src/lib/mapaNativo/mapaGoogleWeb.js`: linhas, círculos, o toque na linha e `centrar`.
- `src/lib/mapaNativo/marcadoresNativos.js`: `zNativo` (a ordem no app do ponto azul).
- `src/components/mapa/MapaGoogleNativo.jsx`: as props `linhas`, `onClickLinha` e `localizacao`, e `centrar` no app.
- `src/components/mapa/useLocalizacaoNoMapa.js`: `centrarEm`.
- `src/pages/MapaGeral.jsx`: as linhas, a localização e o "Localizar" no mapa do Google.

## Testes

`mapaGoogleLinhasD375.test.jsx` (6, novo).

## Como testar

1. Abrir o Mapa Geral no mapa do Google (teste), no site ou no app.
2. Ligar "Linhas": as linhas aparecem com a cor delas. Tocar numa linha mostra o nome e o tipo.
3. Ligar "Minha localização": aparece o ponto azul com o círculo, e o ponto anda com você.
4. Tocar em "Localizar": o mapa vai até você.

## Ainda falta na etapa 4

- Arrastar lote ("Mover").
- Piscar o identificador do lote com alerta.
- Marcar o local da tarefa tocando no mapa.
- Toque longo na área.
