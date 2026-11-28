# Mapa do Google: nomes com contorno; no app, tamanho fixo e somem quando não cabem (D-PROD-379)

**Data:** 2026-11-28 · **Decisão:** [D-PROD-379](./DECISIONS.md) · **Antes:** [camada nativa desligada, D-PROD-378](./DECISIONS.md) · **Migration:** nenhuma · **APK:** nenhum novo

## O que o proprietário pediu

Depois do APK 1.0.9, ele pediu: "arrume e melhore a questão dos nomes e pontos" e "pesquise como o AgriWebb faz".

Aprovou a proposta com uma condição e uma abertura: "a proporção de zoom dos ícones deixe a mesma; se puder ficar melhor que os deles, eu aceito".

## Pesquisa

Usei só fontes públicas (central de ajuda, loja, páginas do AgriWebb). Nenhum app foi desmontado.

- O AgriWebb usa o mapa do Google como base do satélite.
- Pelo que as fontes mostram, o detalhe do pasto (nome, área total e área pastejável) fica no resumo que abre ao tocar no pasto. Elas não dizem se o mapa mostra rótulos.
- Também têm um modo "Contorno", só com as bordas.
- Não é público como desenham os rótulos.

A proposta usa o princípio dos mapas: rótulo de tamanho fixo que some quando não cabe e contorno para ler no satélite. O visual continua o do Mapa Geral.

## O que mudou

### Contorno nas letras (site e app, MapLibre e Google)

- Um contorno escuro fino (3 px, 60% de preto) por baixo de cada linha do nome: nome, "ha" e a linha extra.
- O branco lê bem em campo claro, estrada ou nuvem, e o nome deixa de parecer "cortado".
- A imagem ganha 2 px de margem para o contorno caber.

### No app: nomes de tamanho fixo

- O nome tem tamanho fixo na tela, como os rótulos do próprio Google. O mapa nativo não muda o tamanho de um marcador no zoom, e refazer os nomes ao parar era a "travadinha". Agora nada é refeito.
- Quando o mapa para:
  - o nível é o mesmo para todos (nome + ha, só o nome, ou a sigla), pelo que cabe;
  - do maior pasto para o menor, o nome aparece se o pasto não é minúsculo na tela;
  - o nome que bate noutro nome ou num ícone (cocho, ponto, tarefa, lote de outro pasto) some, em vez de ficar coberto. O lote do próprio pasto não conta: o nome fica logo abaixo dele.
- No meio do gesto, nada é feito: os ícones e os nomes ficam colados no mapa.
- Um ícone novo em cima de um nome o esconde na hora.

### Os ícones não mudaram

Mesmo desenho e mesma proporção de zoom.

### Imagens menores nos marcadores

A imagem só ganha a margem transparente que o ponto de âncora precisa, e a âncora vai no ponto. Antes, o ponto ia no meio e a imagem dobrava. O lote, por exemplo, foi de 44 × 94 para 44 × 47.

## Arquivos

- `src/lib/maplibre/nomesNoMapa.js`: o contorno.
- `src/lib/mapaNativo/nomesGoogle.js`: `caixaDoNomeFixo` e `nomesFixosNaCamera`.
- `src/components/mapa/useMarcadoresGoogle.js`: os nomes fixos (`nomesFixos`), os ícones como obstáculos e a revisão só com o mapa parado.
- `src/components/mapa/MapaGoogleNativo.jsx`: `nomesFixos` nos marcadores do mapa nativo.
- `src/lib/mapaNativo/marcadoresNativos.js`: `imagemComAncora`, com a margem mínima.

## Testes

- `mapaGoogleNomesFixosD379.test.jsx` (8, novo). Com o mapa girado, a caixa do pasto usa os quatro cantos.
- N354-2: o contorno.
- G374-3: a margem mínima.
- G376-3: `nomesFixos`.

## Como testar

1. No app, abrir o Mapa Geral no mapa do Google (teste).
2. Dar zoom e soltar: os nomes ficam do mesmo tamanho, sem travar.
3. Afastar o zoom: os nomes viram sigla e, quando não cabem, somem. Ao aproximar, voltam com os hectares.
4. Conferir que nenhum nome fica coberto por um cocho ou ponto e que o texto lê bem no satélite.
