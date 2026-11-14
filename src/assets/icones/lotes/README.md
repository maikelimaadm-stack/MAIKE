# Como editar o ícone do lote

O desenho do lote no Mapa Geral, e o subícone nos detalhes e nos formulários de manejo,
vêm do **código**, pela chave **sexo + faixa de idade** da Categoria de Manejo
(D-PROD-186 e D-PROD-191). Não há mais upload de ícone de Lote em Configurações, e o
ícone aparece mesmo sem rede.

| Arquivo | O que tem |
| --- | --- |
| `quadradinho.js` | A moldura branca (card + ponteira), a geometria do card e o tamanho do marcador no mapa |
| `animais.js` | Os 10 animais (fêmea e macho × 5 faixas), as cores de fêmea e macho, a borda e o tamanho por faixa |
| `mistos.js` | Os 4 mistos, a cor de misto, a borda da vaca no misto, a composição automática, os nomes e a tabela de mistos |
| `index.js` | A cascata que escolhe o desenho e a montagem do SVG (não precisa mexer para mudar aparência) |

As constantes de aparência ficam **no topo** de cada arquivo, comentadas.

## Cores

| Constante | Arquivo | Valor | Onde aparece |
| --- | --- | --- | --- |
| `COR_FEMEA` | `animais.js` | `#d4a017` | Fêmea, no mapa e nos detalhes |
| `COR_MACHO` | `animais.js` | `#1f7a8c` | Macho, no mapa e nos detalhes |
| `COR_MISTO` | `mistos.js` | `#ff0000` | Só no marcador do mapa, quando o pasto mistura sexos |

O subícone dos detalhes **nunca** usa `COR_MISTO`: cada linha mostra o animal da categoria
dela, na cor do sexo dela.

## Borda branca

| Constante | Arquivo | Valor | O que muda |
| --- | --- | --- | --- |
| `BORDA_PADRAO` | `animais.js` | `3` | Contorno branco de todos os animais |
| `BORDA_VACA_MISTO` | `mistos.js` | `5` | Contorno da vaca **dentro** de um ícone com mais de um animal |

- A unidade é **% da largura do card**: `3` = 3% da largura do card.
- O traço branco fica **atrás** do animal: metade dele aparece em volta. Ele separa as
  partes do desenho (a vaca da frente do boi de trás, o úbere do corpo) e nunca afina as
  pernas.
- O código **compensa a escala** de cada desenho: o bezerro a 70% e o boi a 100% ficam com
  a mesma grossura na tela.
- A borda 5 vale só para os caminhos marcados com `data-vaca="1"` num ícone com mais de um
  animal (os mistos e a composição automática). A fêmea "Maior que 36 meses" **sozinha**
  usa a borda 3.
- No subícone, a borda tem na tela a mesma grossura do mapa, em qualquer tamanho.

## Tamanho

`TAMANHO_POR_FAIXA` (`animais.js`) e `TAMANHO_MISTO` (`mistos.js`): largura do desenho em
fração da **largura útil** do card.

| Faixa | Tamanho |
| --- | --- |
| 0 a 8 meses | 0.70 |
| 9 a 12 meses | 0.78 |
| 13 a 24 meses | 0.86 |
| 25 a 36 meses | 0.94 |
| Maior que 36 meses | 1.00 |
| Mistos | 1.00 |

A largura útil é calculada sozinha: é a maior em que **todos** os desenhos, cada um no
seu tamanho, cabem na área livre do card. Por isso nenhum animal invade a contagem, mesmo
se você mudar os tamanhos.

## Geometria do card (`quadradinho.js`)

| Constante | Valor | O que é |
| --- | --- | --- |
| `CARD_FRAC` | `0.8851` | Fração da altura do desenho ocupada pelo card; o resto é a ponteira |
| `FAIXA_CONTAGEM` | `0.66` | Os animais ficam de 0 a 66% da altura do card; os 34% de baixo são da quantidade de cabeças |
| `FOLGA_LATERAL` | `0.05` | Folga entre os animais e as laterais do card |
| `FOLGA_TOPO` | `0.04` | Folga entre o topo do card e o animal mais alto |
| `LARGURA_MARCADOR_PX` | `44` | Largura do marcador do lote no mapa, em pixels |

Os animais ficam centralizados na horizontal e apoiados numa mesma linha de chão, logo
acima da faixa da contagem. O número de cabeças fica no meio dessa faixa
(`CONTAGEM_TOPO_PCT`, calculado em `index.js` e usado pelo mapa); a letra continua em
`FONTE_CONTAGEM_PX`, em `src/lib/maplibre/contagemLote.js`.

## Qual desenho aparece no mapa (a cascata)

Para cada pasto, `resolverFiguraDoPasto` olha as posições do rebanho que estão nele:

1. **Uma única combinação sexo+faixa** → o animal dela, na cor do sexo.
2. **Várias faixas do mesmo sexo** → **um** animal só, o da faixa com mais cabeças (empate:
   a faixa mais velha), na cor do sexo. A contagem mostra o total.
3. **Sexos cruzados, com misto declarado** na `TABELA_MISTOS` → o desenho do misto, em
   `COR_MISTO`. Se mais de um misto bater, ganha a **menor prioridade**.
4. **Sexos cruzados, sem misto declarado** → o predominante de cada sexo, os dois no mesmo
   card, o mais velho maior e atrás, na mesma linha de chão, em `COR_MISTO`. No máximo 2.
5. **Último recurso** (sexo desconhecido, ou falta faixa para os níveis acima) → o
   predominante geral por cabeças, em `COR_MISTO`. Sem nenhum sexo conhecido, o boi adulto
   (`FIGURA_ULTIMO_RECURSO`).

Sempre sai uma figura: nunca fica marcador vazio.

O sexo e a faixa de cada posição vêm da **Categoria de Manejo** dela. Sem categoria
conhecida, valem o sexo da posição e a categoria oficial gravada no lote (por exemplo,
"Bezerro 0 a 12 meses" → macho, 0 a 8 meses).

## Tabela de mistos (`mistos.js`)

| Chave | Composição | Prioridade |
| --- | --- | --- |
| misto1 | macho 37+, fêmea 37+, macho 0–8 | 10 |
| misto2 | macho 37+, fêmea 37+ | 20 |
| misto3 | macho 37+, macho 0–8 | 20 |
| misto4 | fêmea 37+, macho 0–8 | 20 |

`tipo_regra: 'MINIMA'` em todas: o misto vale quando o pasto **tem** esses animais,
podendo ter outros junto. A composição usa os nomes de `ANIMAIS_SVG` (`sexo-faixa`).

**Nome de exibição:** `ROTULO_MISTO`. O proprietário ainda não escolheu os nomes; por ora
vale a própria chave. Para trocar, mude só a linha do misto.

**Novo misto:** cole o SVG em `MISTOS_SVG` com uma chave nova, acrescente a linha em
`TABELA_MISTOS` e o nome em `ROTULO_MISTO`.

## Trocar um desenho

1. O SVG precisa ter `viewBox="0 0 1000 ALTURA"` (largura 1000), justo no desenho, só com
   `<path d="…"/>` e `fill="currentColor"` na raiz — o formato dos arquivos atuais.
2. Na vaca, marque os caminhos dela com `data-vaca="1"`.
3. Cole o SVG inteiro entre as aspas simples, na chave do animal (`ANIMAIS_SVG`) ou do misto
   (`MISTOS_SVG`). A cor nunca vem do arquivo.
4. Atualize a altura, o número de caminhos e a marca da vaca na tabela `MEDIDAS` de
   `tests/smoke/iconesLoteMotor.test.js` (o teste confere que os arquivos são os do
   proprietário).

## Conferir antes de publicar

```bash
npx eslint src/assets/icones/lotes/
```

```bash
npx vitest run --config vitest.config.js tests/smoke/iconesLoteMotor.test.js
```

```bash
npm run build
```

Para publicar pelo GitHub e pela Vercel, siga os passos de `src/assets/icones/README.md`.
Confira a **nova** URL de prévia da Vercel do commit: URLs antigas mostram a versão antiga.

## Guia geral do mapa

[Guia do mapa e dos ícones](../../../../docs/design/GUIA-MAPA-E-ICONES.md).
