# Relatório: cadastrar no mapa como no AgriWebb, etapa 1 (D-PROD-361)

**Data:** 2026-11-27 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-361](./DECISIONS.md)

## Pedido

O proprietário pediu cadastrar pastos, pontos e linhas no mapa como no AgriWebb: movendo o ponto, usando a minha localização, e também sem internet com sincronização.

## O que já existia (levantamento)

O editor do Cadastro do Mapa (`MapaDesenho`) já:
- desenha pasto e linha por toque;
- arrasta vértice e ponto, insere no meio, remove vértice, desfaz e refaz;
- move a forma inteira e tem ímã nas divisas vizinhas;
- mostra área e comprimento ao vivo e tem "Usar minha localização" para o ponto;
- grava sem internet: cópia local primeiro e fila com `versao_esperada`.

Faltava chegar a ele pelo Mapa Geral, e os alvos de toque eram pequenos (vértice com 14 px, botões com 28 px).

Lacunas frente ao AgriWebb, que ficam para as próximas etapas:
- mira fixa no centro;
- seguir minha posição e direção;
- caminhar gravando o contorno sozinho;
- régua sem salvar;
- excluir pasto e ponto ligado a cocho sem internet;
- KMZ;
- dividir e juntar pastos.

## O que mudou

| Onde | Mudança |
|---|---|
| `src/components/mapa/NovoCadastroMapaBotao.jsx` (novo) | O "+" abre Novo pasto · Novo ponto · Nova linha |
| `src/pages/MapaGeral.jsx` | O "+" da aba Pontos usa o botão novo e leva a `MapaCadastro?novo=<tipo>` |
| `src/pages/MapaCadastro.jsx` | Aceita `?novo=area` e `?novo=linha` além de `ponto`; abre direto o editor e volta ao Mapa Geral ao fechar |
| `src/lib/maplibre/estiloAreas.js` | Acerto no dedo de 14 para 22 px |
| `src/lib/maplibre/editorVisual.js` | `eToque`: reconhece `touchstart` e pointer `touch`/`pen` |
| `src/components/mapa/MapaDesenho.jsx` | Usa `eToque`; Mover pega a linha a 16 px no dedo; "Mover linha inteira"; classes para o CSS de toque |
| `src/styles/mk-cadastro-mapa.css` | Botões com 44 px em tela de toque; a barra de baixo cabe na tela e quebra em duas linhas |
| `src/styles/mapa-geral.css` | Menu do "+" |

## Verificação

- `tests/smoke/mapaCadastroNoDedoD361.test.jsx`, MC-01 a MC-07:
  - MC-02, MC-03, MC-05, MC-06 e MC-07 falham no código antigo;
  - MC-01 é do componente novo;
  - MC-04 cobre o pedido desconhecido.
- Mudados de propósito:
  - `mapaFocoBarraV12.test.jsx` BARRA-9: o "+" abre a escolha;
  - `maplibreEditorParidadeVisual.test.jsx` VIS-04: o nome do teste diz 22 px.
- Navegador real (harness WebGL, Pixel 7 com toque): `run-geo`, `run-webgl`, `run-editor-visual`, `run-editor-finalizacao` e `run-editor-meios-cadastro` passaram, sem rolagem horizontal.
  - A barra de baixo, medida a 412 px, ia de −34 a 446 px antes e agora vai de 8 a 404 px, em duas linhas.
