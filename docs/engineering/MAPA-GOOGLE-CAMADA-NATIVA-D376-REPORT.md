# Mapa do Google no app: a camada do Mapa Geral desenhada pelo Android (D-PROD-376)

**Data:** 2026-11-27 · **Decisão:** [D-PROD-376](./DECISIONS.md) · **Antes:** [ícones como marcadores do mapa, D-PROD-374](./MAPA-GOOGLE-ETAPA3-NOMES-D374-REPORT.md) · **Migration:** nenhuma · **APK:** 1.0.9 (código 10), `nativoMinimo` 5

## O que o proprietário viu no APK 1.0.8

- "Ainda fica dando um bug de travadinha nos ícones."
- "Os nomes do zoom e hectares tem vezes que fica cortado."

Ele pediu para ficar nativo, com a garantia de que o desenho dos ícones não muda.

## Causas

1. O mapa do Google desenha os marcadores dele, mas não sabe as regras do Mapa Geral: o nome que diminui com o zoom e a troca para sigla. Por isso os nomes ficavam do mesmo tamanho durante o zoom e eram refeitos quando o mapa parava. Essa troca de imagens pela ponte é a "travadinha".
2. A troca de nível no meio do gesto reenviava todos os nomes pela ponte.
3. O nome ficava por baixo dos ícones e parecia cortado onde um cocho ou ponto o cobria.

## O que mudou

### Uma camada do próprio app, desenhada pelo Android

- `CamadaDoMapaView.java` é uma camada transparente por cima do mapa, dentro do contêiner do plugin e por baixo da página.
- A cada passo da câmera ela desenha todos os ícones e nomes no lugar e no tamanho certos.
- A conta é a mesma da página: Web Mercator, ladrilho de 256 dp, rumo, e zoom do MapLibre = zoom do Google − 1. Ela foi conferida contra `projetarNaCamera` (530,66 × 445,46 px nos dois).
- Quem avisa cada passo da câmera é o próprio mapa. O remendo do plugin ganhou o gancho `MaikeCamera.mexeu()` no `onCameraMove`, e o arquivo `MaikeCamera.java` é criado no plugin pelo `postinstall`. Com o mapa parado, a camada não trabalha.

### A página manda as imagens uma vez

- `camadaNativa.js` manda cada imagem uma vez, com uma chave curta da URL `data:`. São as mesmas imagens que o sistema desenha: o lote com as cabeças e o identificador, o cocho com o nível e o farol, os pontos, as tarefas e os nomes. **O desenho dos ícones não mudou.**
- A página manda os itens de cada grupo: ponto, tamanho, deslocamento, âncora, ordem e se recebe toque.
  - Para os nomes, vão também as paradas de tamanho nos zooms 0 a 24 do MapLibre. O Android interpola entre elas, como o `icon-size` do MapLibre, então os nomes crescem e diminuem junto com o zoom.
- Um grupo igual ao último mandado não vai de novo.

### Ordem e toque

- A ordem é a do site e do MapLibre: o nome por cima dos ícones (não é mais coberto) e o ponto azul por cima de tudo.
- A camada não pega toque, então a pinça e o arrasto são do mapa.
- O toque rápido chega pelo clique do mapa, que pergunta à camada qual item com clique está no ponto (`tocar`, com folga de 4 dp). Sem item, abre a área.

### Sem trabalho da página durante o gesto

Com os ícones no mapa nativo (a camada ou os marcadores do 1.0.8), a página não pede a câmera a cada quadro. Os nomes são revistos quando o mapa para.

## Versões

| APK | Ícones e nomes no app |
|---|---|
| 1.0.9 em diante | Camada nativa (esta decisão) |
| 1.0.8 | Marcadores do mapa (D-PROD-374); se a camada não ligar, também |
| 1.0.7 ou antes | Imagens na página, por cima do mapa (D-PROD-372/373) |

O site não muda, e o `nativoMinimo` segue 5.

## Arquivos

- `android/app/src/main/java/com/makgestao/app/CamadaDoMapaPlugin.java` e `CamadaDoMapaView.java` (novos); `MainActivity.java` registra o plugin.
- `android/app/build.gradle`: `play-services-maps` na mesma versão do plugin do mapa.
- `scripts/app/remendar-google-maps.mjs`: o gancho `MaikeCamera` e o 7º remendo.
- `src/lib/mapaNativo/camadaNativa.js` (novo).
- `src/components/mapa/MapaGoogleNativo.jsx`: usa a camada no APK 1.0.9, o toque pela camada e sem câmera a cada quadro.
- `app-version.json`: 1.0.9 (código 10).

## Testes

- `mapaGoogleCamadaNativaD376.test.jsx` (12, novo).
- `mapaGoogleCameraD373.test.js`: os 7 remendos, o gancho e o APK 1.0.9.
- O Java foi compilado contra imitações das classes do Android. O APK de verdade é compilado no CI ("apk assinado").

## Como testar

1. Instalar o APK 1.0.9 (Release `app-v1.0.9`).
2. Abrir o Mapa Geral no mapa do Google (teste).
3. Dar zoom com os dedos: os nomes crescem e diminuem junto, e nada trava quando o mapa para.
4. Arrastar o mapa: os ícones e os nomes ficam colados nele.
5. Tocar num lote, cocho, ponto ou tarefa: abre o detalhe. Tocar fora deles, no pasto: abre o pasto.
6. Conferir que nenhum nome fica coberto por ícone.

## Ainda não

- O nível dos nomes (tudo, nome ou sigla) calculado no próprio celular: hoje a página escolhe quando o mapa para.
- A mesma camada no iPhone.
- Etapa 4b: arrastar lote, piscar o identificador, local da tarefa pelo toque, toque longo na área.
