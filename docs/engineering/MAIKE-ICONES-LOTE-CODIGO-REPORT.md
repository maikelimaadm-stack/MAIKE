# MAIKE-ICONES-LOTE-CODIGO — Relatório

> **Versão parcial, em preenchimento.** As seções marcadas "em andamento" fecham com as frentes de detalhes e de remoção e com o `verify:all`.

FATIA: MAIKE-ICONES-LOTE-CODIGO
BRANCH: feat/icones-lote-codigo
PR: #271

**Decisão:** [D-PROD-191](./DECISIONS.md) · **Base:** `origin/main` `776befe9` na criação; `cf07309c` (PR #270) integrada por merge · **Banco:** nenhuma migration · **Data:** 2026-11-13

## 1. Entrega

| Área | O que mudou |
| --- | --- |
| Assets | `src/assets/icones/lotes/`: `quadradinho.js` (moldura + geometria do card + `LARGURA_MARCADOR_PX`), `animais.js` (10 animais, `COR_FEMEA`, `COR_MACHO`, `BORDA_PADRAO`, `TAMANHO_POR_FAIXA`), `mistos.js` (4 mistos, `COR_MISTO`, `BORDA_VACA_MISTO`, `TAMANHO_MISTO`, `SOBREPOSICAO_COMPOSICAO`, `ROTULO_MISTO`, `TABELA_MISTOS`), `index.js` (resolução e composição) e `README.md`. Os 15 SVGs do zip entram como vieram, como texto literal (conferidos byte a byte; SHA-256 no anexo) |
| Motor | `resolverFiguraDoPasto` (cascata de 5 níveis, sempre sai figura), `desenhosDoMarcador` / `svgMarcadorLote` / `urlMarcadorLote` (moldura + animal(is), borda compensada, faixa da contagem livre), `figuraDaPosicao` / `figuraDoGrupo` / `svgSubiconeLote` / `urlSubiconeLote` (subícone na cor do sexo, nunca misto) |
| Mapa | `resolverIconeLote` (mapaGeralRender) chama a cascata e devolve `iconUrl` sempre; `syncLotes` recebe as Categorias de Manejo, usa `LARGURA_MARCADOR_PX`, põe a contagem em `CONTAGEM_TOPO_PCT`, guarda a chave do desenho no diff e em `data-icone-lote`, e só troca o `<img>` quando o desenho muda; o `MapaGeral` carrega `categoriasManejo` do cache, relê no "Atualizar" e não pré-carrega as imagens de Lote órfãs |
| Detalhes e manejo | _(em andamento: frente de detalhes e formulários de manejo)_ |
| Configurações | _(em andamento: frente de remoção)_ |
| Formulário de Lote | _(em andamento: frente de remoção)_ |
| Cache offline | `mapaCacheService`: capacidade nova `categoriasManejo` (a faixa vem da Categoria de Manejo; inclui as inativas) |
| Docs | D-PROD-191, `CURRENT-STATE.md`, este relatório, `docs/design/GUIA-MAPA-E-ICONES.md`, `src/assets/icones/README.md` |

## 2. Por que assim

- **Borda em % da largura do card, atrás do animal.** A primeira versão media a borda em pixels do marcador (3 px e 5 px num card de 44 px): renderizado, o contorno da vaca (2,5 px visíveis) apagava o boi atrás dela no misto1 e no misto2. Em % do card (3 = 3%), o filete branco fica fino e separa os animais como nos desenhos do proprietário. O traço fica atrás do animal (`paint-order: stroke`): metade aparece em volta e nenhuma perna afina. Para a grossura ser a mesma na tela, o traço de cada desenho é a borda dividida pela escala dele (bezerro a 70% e boi a 100% saem iguais). Os valores 3 e 5 do proprietário ficaram como estão.
- **Largura útil calculada.** O pedido fixa os tamanhos como fração da "largura útil do card", sem número. Com a largura útil igual à largura do card, os animais altos não caberiam acima da contagem. A largura útil é a maior em que os 14 desenhos de ícone único (10 animais e 4 mistos) cabem na área livre (folgas de 5% nas laterais e 4% no topo). Assim os tamanhos 0,70 … 1,00 valem exatamente, e mudar um tamanho nunca faz um animal entrar na contagem.
- **Linha de chão comum e contagem no centro da faixa.** Os animais ficam apoiados numa linha logo acima dos 34% de baixo do card (descontada meia borda, para nem o branco entrar). O número de cabeças sai de `top:69%` (que raspava as patas) para o centro da faixa reservada (≈ 73,46% da altura do marcador).
- **Faixa pela Categoria de Manejo, com reserva.** A posição do rebanho não guarda a faixa; ela vem da Categoria de Manejo (`categoria_manejo_id`). Sem categoria conhecida, valem o sexo da posição e a categoria oficial gravada ("Bezerro 0 a 12 meses" → macho 0–8). As categorias entram no cache offline do mapa.
- **Nível 5 para dado incompleto.** Pasto com posição de sexo desconhecido, ou sem faixa para os níveis 1–4, vai ao nível 5 (vermelho): a cor avisa de longe que o pasto não está classificado.
- **Subícone por tamanho.** O subícone recebe o tamanho em que a tela o mostra, para a borda ter a mesma grossura do mapa em 22, 32 ou 36 px.
- **Prévia local com nomes novos.** A PR #268 prova que `IconeOficialLotePreview`, `data-testid="icone-oficial-lote"` e o alt "Ícone oficial do lote" sumiram do Formulário de Lote. A prévia local usa outro componente, outro `data-testid` e outro texto: as provas da #268 continuam valendo depois das duas no ar.

## 3. Arquivos

_(lista final no fechamento da fatia)_

## 4. Critérios de aceite

| Critério | Evidência |
| --- | --- |
| Nenhum marcador de lote sem figura, em nenhuma combinação; teste dos 5 níveis | `iconesLoteMotor.test.js` ICL-D (níveis 1–5) e ICL-E (5.000 pastos aleatórios com lixo: sempre figura, os 5 níveis aparecem); `iconeLoteMapa.test.jsx` (17 casos: figura com lista vazia, sem categoria, categoria desconhecida, "Misto"; marcador com a data URL, `data-icone-lote`, contagem no centro da faixa, 44 px; troca de categoria atualiza o mesmo marcador; contagem nova não troca o `<img>`) |
| Cores exatas | ICL-B; ICL-F (a cor vai no desenho, nunca `currentColor`) |
| Borda uniforme nos 14 ícones; vaca no misto com 5 | ICL-F "borda uniforme NA TELA": traço × escala = 30 unidades (3%) em todos; caminhos `data-vaca` em ícone com mais de um animal = 50 (5%); fêmea 37+ sozinha = 30 |
| Tamanho cresce com a faixa 70/78/86/94/100 | ICL-F "tamanho cresce com a faixa" (largura ÷ largura útil = tamanho, 9 casas) |
| Nenhum animal invade a faixa de 34% | ICL-F: base de cada desenho + meia borda ≤ 0,66 × altura do card, nos 14 ícones únicos e nas composições do nível 4 |
| Subícone nunca vermelho/misto | ICL-G; _(em andamento)_ |
| Mesmo sexo com várias faixas = 1 ícone, o de mais cabeças | ICL-D nível 2 (exemplo do proprietário: macho 13–24, contagem 345) |
| Configurações sem cadastro de ícone de Lote; outros tipos seguem | _(em andamento)_ |
| Ícone do lote sem rede (sem cache de 60 s) | Desenho embutido; data: URL; categorias no cache offline; _(em andamento)_ |
| Nenhuma migration; `prisma migrate diff` limpo | §6 |
| `npm run verify:all` verde | §6 |
| Relatório | este arquivo |
| Decisão nova | D-PROD-191 |

## 5. PRs abertas e conflitos

_(tabela final no fechamento; ver §5 da versão final)_

## 6. Verificação

_(saída colada no fechamento)_

## 7. Divergências do molde, pendências e riscos

_(no fechamento)_

## 8. Decisões que precisam do proprietário

_(no fechamento)_

## Anexo — SHA-256 dos arquivos do zip `icones-lote-limpos.zip`

| Arquivo | SHA-256 |
| --- | --- |
| `femea-0-8.svg` | `fdf22897ad2e16d4eecd4dbd7279d89e83d4bb5be012b510c1b3773302469ff3` |
| `femea-13-24.svg` | `1be90a7a97844d8bbd361b62f53a5adc5fc6dfc5a3a96bea1eb2e75839d6e485` |
| `femea-25-36.svg` | `158ada68271b5ea96c1f3349702927498c2deff80d256ace49666e5cb84d2beb` |
| `femea-37-mais.svg` | `ae4493367af934ecc0b8a95c95d5334c4ecc1eb62970f64801f00709656fd2e8` |
| `femea-9-12.svg` | `c5a30316ef3b1872dd4c5bdc0d10799953d218eba4f1a57827b55a2effe2eacb` |
| `macho-0-8.svg` | `242d5c2852f5ad986f6cc98ba88f84f36f7eabd810026e21414de8f463651d36` |
| `macho-13-24.svg` | `384070360de48c4dedaffc7af728202b4d620f5db248290116b28c872116031d` |
| `macho-25-36.svg` | `0ce8557987f7400e35822a56730d9248f7227f2fa7df2fcbc7c3043c5523f59f` |
| `macho-37-mais.svg` | `1590547aceb5fc9f398deabd75bc0ec4d4862e498c07c36e82a41910edbf9af8` |
| `macho-9-12.svg` | `3d51aad831dabc6a97b14fa736b09d8780709317ab78eee0a1e4b7b68e5a5f1f` |
| `misto1.svg` | `05d23cc99bd930b1e99d0f7a1188017a41d7e89fb1f296c19176cc3f68060a43` |
| `misto2.svg` | `430608bd6c32fb281e24a7cde25a0ff2ce7b3b00837a2eeaf74d4f58b568e076` |
| `misto3.svg` | `733446a530aab9ca6044b8c17d7c405c0d753908c6a276ef6c63b869c8f42c09` |
| `misto4.svg` | `8282e15e9beb140a97589efc0e84662076c9a27c221d00cb6c979d5c79fd7c30` |
| `quadradinho.svg` | `308b140f4fca38c59038a82a995f9930a0991146ed30e06d700a92fdd33b3362` |
| `_medidas.json` | `c7f1fc2eeb73d3ba88a61e6e6b95e73ec1f9bee04676d351e6a9d5c755887412` |
