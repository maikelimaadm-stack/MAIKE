# Como editar os ícones do mapa

## Cocho: cores e grossura

Abra `src/assets/icones/cocho-descoberto.js`. O bloco `COCHO_APARENCIA` fica no início:

```js
marcador: { cor: "#65717a", espessura: 12, sal: "#d2d7db" },
subicone: { cor: "#e2e6e9", espessura: 6, sal: "#e2e6e9" },
```

| Campo | O que muda |
| --- | --- |
| `marcador.cor` | Contorno e pés do cocho dentro da bolinha do mapa |
| `marcador.sal` | Preenchimento do sal no mapa |
| `marcador.espessura` | Grossura do contorno no mapa |
| `subicone.cor` | Contorno e pés nos detalhes |
| `subicone.sal` | Preenchimento nos detalhes |
| `subicone.espessura` | Grossura do contorno nos detalhes |

O depósito também usa essa paleta: mudanças em `sal` afetam seu preenchimento. Seu contorno no mapa segue `marcador.cor`; nos detalhes, a variável `estilo` de `deposito-sal.js` define a cor própria `#a6afb6`.

## Trocar o formato do cocho

No mesmo arquivo, altere `COCHO_DESCOBERTO_FORMA`:

- `corpo`: conteúdo do atributo `d` do caminho SVG do recipiente, na mesma coordenada do `viewBox`. O sistema usa esse caminho também para recortar o sal.
- `pes`: caminhos `d` e transformações dos apoios.
- `viewBox`, `width`, `height`: enquadramento e dimensões do novo desenho.
- `limites`: retângulo da área interna do recipiente (`x`, `y`, `width`, `height`), usado para calcular a altura do sal. Atualize junto com o formato para o nível não ficar deslocado.
- `strokeWidth`: margem geométrica usada no cálculo do nível. As espessuras visuais ficam em `COCHO_APARENCIA`.

O SVG precisa ter uma área interna que possa ser preenchida. Em um SVG com vários grupos, recortes e transformações, não basta copiar todo o arquivo para o campo `corpo`: é preciso identificar o recipiente e seus apoios e manter as coordenadas coerentes.

`COCHO_DESCOBERTO_SVG` é outro valor: o modelo estático usado pelo botão do gerenciador de ícones. Atualize-o também se quiser oferecer o novo desenho para upload. Alterar só esse modelo ou enviar outro SVG pelo cadastro não substitui o cocho dinâmico: os marcadores de Cocho usam `criarSvgCocho` e a geometria acima.

## Bolinha branca, ponteira e tamanho

A moldura agora está separada em `src/assets/icones/pontos/redondo.js`, usando o arquivo `REDONDO ORIGINAL.svg` do proprietário. `REDONDO_ORIGINAL_SVG` guarda a forma branca, a ponteira e a sombra. `ENCAIXE_FIGURA` controla a posição e o tamanho interno da figura.

A função `envolverMarcadorSvg` em `cocho-descoberto.js` apenas chama essa composição compartilhada com o depósito. Para trocar a bolinha, não precisa alterar os desenhos do cocho e do depósito. Veja [o guia da moldura](pontos/README.md).

- Em `src/components/mapa/useMapRenderer.jsx`, procure `const baseSize =`: o tamanho externo dos pontos é configurado ali.
- Em `src/components/mapa/CochoNivel.jsx`, a classe `w-[156px]` controla a largura do subícone nos detalhes.

## Depósito

Arquivo: `src/assets/icones/deposito-sal.js`.

- `MODELO`: SVG do depósito, sem bolinha.
- `CORPO`: caminho interno que limita o preenchimento. Mantenha coerente com o `path id="corpo"` do modelo.
- `estilo`: cores; o preenchimento usa `estilo.sal`.
- `stroke-width`: a função usa 5,5 no marcador e 4 no subícone.
- `desenhoAjustado`: transformação que deixa o depósito mais largo e baixo; confira o `viewBox` ao alterar.

## Publicar pelo GitHub e Vercel

1. Abra o arquivo no GitHub e clique no lápis para editar. Crie uma branch para a alteração.
2. Mude as cores ou o desenho, salve o commit e abra um pull request para `main`.
3. Confira os testes e abra a **nova URL de prévia da Vercel** associada ao commit. URLs antigas de prévias continuam mostrando a versão antiga.
4. Depois de validar, faça o merge do PR na `main`. A integração Git/Vercel cria a publicação de produção conforme a configuração do projeto. Aguarde o status **Ready**.

Se estiver editando localmente:

```bash
npx eslint src/assets/icones/cocho-descoberto.js src/assets/icones/deposito-sal.js
npx vitest run --config vitest.config.js tests/smoke/cochoNivel.test.jsx tests/smoke/depositoNivel.test.jsx
npm run build
```

Para uma alteração apenas de cor, mantenha as coordenadas e o cálculo do nível. Para trocar o formato, confira também os níveis cheio, intermediário e vazio, nos dois tamanhos.

## Ícone do lote (gado)

O desenho do lote no mapa e o subícone dos detalhes vêm do código, pela chave sexo + faixa de idade: veja [`lotes/README.md`](./lotes/README.md) para cores, bordas, tamanhos, mistos e como trocar um desenho.

## Guia geral do mapa

Para bois, letras, cores, posições de botões, filtros, catálogo oficial e ícones pré-definidos, consulte [Guia do mapa e dos ícones](../../../docs/design/GUIA-MAPA-E-ICONES.md).
