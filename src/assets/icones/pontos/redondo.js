/**
 * MOLDURA DOS PONTOS — arquivo REDONDO ORIGINAL.svg enviado pelo proprietário.
 * O SVG abaixo é guardado como veio, incluindo a ponteira e a sombra.
 * Troque só esta constante para substituir a moldura. Se a geometria mudar,
 * confira também ENCAIXE_FIGURA: o retângulo do cocho/depósito dentro do círculo.
 * Os desenhos do cocho e do depósito continuam em seus próprios arquivos.
 */
export const REDONDO_ORIGINAL_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"145.57914202365706 -108.00162320146532 116.5598968897234 124.12796131751702\" width=\"116.5598968897234\" height=\"124.12796131751702\"><defs><filter id=\"editor-shadow-1w6pxkj1h\" filterUnits=\"userSpaceOnUse\" x=\"-50\" y=\"-42\" width=\"1100\" height=\"1067.4220581054688\" color-interpolation-filters=\"sRGB\"><feDropShadow dx=\"3\" dy=\"4\" stdDeviation=\"25\" flood-color=\"#263442\" flood-opacity=\"0.25\"/></filter><filter id=\"editor-shadow-ptzhwlufs\" filterUnits=\"userSpaceOnUse\" x=\"-1.2211761474609375\" y=\"-42\" width=\"1002.4424438476562\" height=\"1067.4220581054688\" color-interpolation-filters=\"sRGB\"><feDropShadow dx=\"3\" dy=\"4\" stdDeviation=\"25\" flood-color=\"#263442\" flood-opacity=\"0.25\"/></filter></defs><g><defs/><g fill=\"none\">\n  \n</g></g><g><defs/><g fill=\"none\">\n  \n</g></g><g><defs/><g fill=\"none\">\n  \n<path transform=\"matrix(0.11646828800439835 0 0 0.11646828800439835 145.62493133544922 -103.2063856124878)\" fill=\"#ffffff\" stroke=\"#ffffff\" stroke-width=\"15\" stroke-linecap=\"round\" stroke-linejoin=\"round\" opacity=\"1\" width=\"1000\" height=\"1000\" d=\"M638.93014 812 C615.93014 820.58603 580.17206 829.58603 567.17206 836 L520 892.17206 C509 907.17206 491 907.17206 480 892.17206 L432.82794 836 C419.82794 829.58603 384.06986 820.58603 361.06986 812 C191.58411 745.26071 93.5009 567.43684 127.46625 388.479 C161.4316 209.52116 317.84744 80 500 80 C682.15256 80 838.5684 209.52116 872.53375 388.479 C906.4991 567.43684 808.41589 745.26071 638.93014 812 Z\" style=\"fill: rgb(255, 255, 255); stroke: rgb(255, 255, 255); stroke-width: 15; filter: url(&quot;#editor-shadow-ptzhwlufs&quot;);\" filter=\"url(#editor-shadow-ptzhwlufs)\"/></g></g></svg>";

// Personalização da borda: mantém a espessura e o caminho do SVG original.
export const COR_BORDA_REDONDO = "#bbb7b7";

// Retângulo interno na coordenada do SVG original (não são pixels do mapa).
// x/y = canto superior esquerdo; width/height = tamanho máximo do desenho.
export const ENCAIXE_FIGURA = {
  x: 171.859075,
  y: -73.130875,
  width: 64,
  height: 47,
};

/** Monta a moldura original e uma figura independente, sem mudar suas proporções. */
export function montarPontoRedondo(desenho, viewBox, encaixe = ENCAIXE_FIGURA) {
  const figura = `<svg data-figura-ponto="" x="${encaixe.x}" y="${encaixe.y}" width="${encaixe.width}" height="${encaixe.height}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${desenho}</svg>`;
  const moldura = REDONDO_ORIGINAL_SVG
    .replace(/stroke="#ffffff"/g, `stroke="${COR_BORDA_REDONDO}"`)
    .replace(/stroke:\s*rgb\(255,\s*255,\s*255\)/g, `stroke: ${COR_BORDA_REDONDO}`);
  return moldura.replace(/(<svg[^>]*>)([\s\S]*)(<\/svg>)/, (_, inicio, fundo, fim) => `${inicio}<g data-fundo-ponto="">${fundo}</g>${figura}${fim}`);
}
