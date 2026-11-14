import { montarPontoRedondo } from "./pontos/redondo";

/**
 * GUIA RÁPIDO — EDIÇÃO DO ÍCONE DO COCHO
 *
 * 1. CORES E ESPESSURA: altere COCHO_APARENCIA logo abaixo.
 *    marcador = desenho dentro da bolinha do mapa.
 *    subicone = desenho sem bolinha, usado nos detalhes.
 *    cor = contorno e pés; espessura = grossura do contorno; sal = preenchimento.
 *    As cores são códigos hexadecimais (ex.: #d2d7db).
 *    O depósito também usa esta paleta; seu contorno claro tem uma cor própria
 *    em deposito-sal.js. Para instruções completas, leia README.md nesta pasta.
 *
 * 2. FORMATO DO COCHO NO MAPA E NOS DETALHES: COCHO_DESCOBERTO_FORMA.
 *    corpo é o caminho SVG do recipiente; pes são os caminhos dos apoios.
 *    Ao trocar o desenho, atualize também viewBox, width, height e limites.
 *    limites define a área do preenchimento para o nível subir e baixar.
 *
 * 3. SVG PARA UPLOAD: COCHO_DESCOBERTO_SVG é o modelo estático oferecido no
 *    gerenciador. Trocar só essa string NÃO muda o desenho dinâmico do mapa.
 *
 * 4. BOLINHA BRANCA, PONTEIRA E SOMBRA: pontos/redondo.js, compartilhado com
 *    o depósito. ENCAIXE_FIGURA controla a posição e o tamanho do desenho interno.
 *    O tamanho total no mapa fica em useMapRenderer.jsx (baseSize).
 */

// CORES DE PREENCHIMENTO, CONTORNO E ESPESSURA — EDITE AQUI.
export const COCHO_APARENCIA = {
  marcador: {
    cor: "#65717a",       // Contorno e pés do cocho no mapa.
    espessura: 12,        // Grossura do contorno no mapa, em unidades do SVG.
    sal: "#d2d7db",       // Cor do sal dentro do cocho no mapa.
  },
  subicone: {
    cor: "#e2e6e9",       // Contorno e pés do subícone nos detalhes.
    espessura: 6,         // Grossura do contorno do subícone.
    sal: "#e2e6e9",       // Cor do sal dentro do subícone.
  },
};

// MODELO ESTÁTICO: botão de upload do gerenciador de ícones.
export const COCHO_DESCOBERTO_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"178.2695144653321 91.38145294189454 252.57620544433593 184.96979064941405\" width=\"252.57620239257812\" height=\"184.96978759765625\"><path id=\"pe-1\" d=\"M229.373 236.206v.247l-15.219 39.53-.047.064h-28.416l-.006-.223 13.653-40.16.037-.056.002-.001Z\" transform=\"matrix(0.7623104453086853 0 0 0.7835536003112793 66.1938705444336 54.0399169921875)\" fill=\"#65717a\" stroke=\"#65717a\" stroke-width=\"0\" stroke-linecap=\"round\" stroke-linejoin=\"round\" /><path id=\"pe-2\" d=\"m408.903 235.69 14.729 40.233.013.123-.003.001h-28.988l-.054-.073-15.259-39.634-.015-.125.013-.008 29.503-.599Z\" transform=\"matrix(0.7623104453086853 0 0 0.7835536003112793 78.48945617675781 53.56975555419922)\" fill=\"#65717a\" stroke=\"#65717a\" stroke-width=\"0\" stroke-linecap=\"round\" stroke-linejoin=\"round\" /><path id=\"corpo-cocho\" d=\"M424.832 97.769 L424.78 105.388 L419.652 168.887 L419.527 170.196 L418.077 183.117 L417.953 184.111 L417.152 189.887 L417.053 190.551 L416.194 195.923 L416.077 196.602 L415.164 201.537 L415.033 202.197 L414.07 206.693 L413.912 207.37 L412.903 211.402 L412.729 212.046 L411.666 215.652 L411.496 216.18 L410.39 219.337 L410.193 219.848 L409.04 222.564 L408.863 222.94 L407.66 225.233 L407.506 225.496 L406.273 227.34 L406.149 227.502 L404.909 228.883 L404.834 228.954 L403.588 229.91 L402.413 230.429 L401.161 230.607 L207.466 230.607 L204.767 229.915 L203.587 229.098 L203.539 229.057 L202.31 227.8 L202.2 227.666 L201.001 225.993 L200.837 225.732 L199.704 223.681 L199.517 223.3 L198.422 220.795 L198.224 220.29 L197.215 217.437 L196.997 216.757 L196.044 213.462 L195.862 212.767 L194.98 209.08 L194.795 208.227 L193.983 204.126 L193.833 203.296 L193.834 203.296 L193.091 198.767 L192.957 197.87 L192.294 192.971 L192.184 192.081 L191.595 186.786 L191.507 185.912 L190.993 180.219 L190.926 179.402 L190.51 173.63 L190.507 173.6 L184.534 105.122 L184.28324 97.39517\" fill=\"none\" stroke=\"#65717a\" stroke-width=\"6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" /></svg>";

// FORMATO DINÂMICO: usado pelo mapa e pelos detalhes; mantenha os limites coerentes.
export const COCHO_DESCOBERTO_FORMA = {
  "viewBox": "178.2695144653321 91.38145294189454 252.57620544433593 184.96979064941405",
  "width": 252.576202,
  "height": 184.969788,
  "corpo": "M424.832 97.769 L424.78 105.388 L419.652 168.887 L419.527 170.196 L418.077 183.117 L417.953 184.111 L417.152 189.887 L417.053 190.551 L416.194 195.923 L416.077 196.602 L415.164 201.537 L415.033 202.197 L414.07 206.693 L413.912 207.37 L412.903 211.402 L412.729 212.046 L411.666 215.652 L411.496 216.18 L410.39 219.337 L410.193 219.848 L409.04 222.564 L408.863 222.94 L407.66 225.233 L407.506 225.496 L406.273 227.34 L406.149 227.502 L404.909 228.883 L404.834 228.954 L403.588 229.91 L402.413 230.429 L401.161 230.607 L207.466 230.607 L204.767 229.915 L203.587 229.098 L203.539 229.057 L202.31 227.8 L202.2 227.666 L201.001 225.993 L200.837 225.732 L199.704 223.681 L199.517 223.3 L198.422 220.795 L198.224 220.29 L197.215 217.437 L196.997 216.757 L196.044 213.462 L195.862 212.767 L194.98 209.08 L194.795 208.227 L193.983 204.126 L193.833 203.296 L193.834 203.296 L193.091 198.767 L192.957 197.87 L192.294 192.971 L192.184 192.081 L191.595 186.786 L191.507 185.912 L190.993 180.219 L190.926 179.402 L190.51 173.63 L190.507 173.6 L184.534 105.122 L184.28324 97.39517",
  "stroke": "#65717a",
  "strokeWidth": 6,
  "pes": [
    {
      "d": "M229.373 236.206v.247l-15.219 39.53-.047.064h-28.416l-.006-.223 13.653-40.16.037-.056.002-.001Z",
      "transform": "matrix(0.7623104453086853 0 0 0.7835536003112793 66.1938705444336 54.0399169921875)",
      "fill": "#65717a",
      "stroke": "#65717a",
      "strokeWidth": 0
    },
    {
      "d": "m408.903 235.69 14.729 40.233.013.123-.003.001h-28.988l-.054-.073-15.259-39.634-.015-.125.013-.008 29.503-.599Z",
      "transform": "matrix(0.7623104453086853 0 0 0.7835536003112793 78.48945617675781 53.56975555419922)",
      "fill": "#65717a",
      "stroke": "#65717a",
      "strokeWidth": 0
    }
  ],
  // Área interna do recipiente: x/y = canto superior; width/height = largura/altura.
  "limites": {
    "x": 184.283234,
    "y": 97.395172,
    "width": 240.548767,
    "height": 133.211823
  }
};

/** Geometria compartilhada pelo mapa e pelo subícone. Percentual entre 0 e 1. */
export function geometriaNivelCocho(percent = 0) {
  const forma = COCHO_DESCOBERTO_FORMA;
  const fracao = Number.isFinite(percent) ? Math.max(0, Math.min(1, percent)) : 0;
  const nivel = Math.round(fracao * 100);
  const amplitudeMaxima = Math.min(8, forma.limites.width * 0.035);
  const topo = forma.limites.y + forma.strokeWidth / 2 + amplitudeMaxima;
  const fundo = forma.limites.y + forma.limites.height - forma.strokeWidth / 2;
  const y = fundo - (fundo - topo) * fracao;
  const onda = Math.min(amplitudeMaxima, (fundo - y) * 0.4);
  const esquerda = forma.limites.x;
  const larguraOnda = forma.limites.width / 6;
  const direita = esquerda + forma.limites.width;
  const base = forma.limites.y + forma.limites.height + forma.strokeWidth;
  return { fracao, nivel, preenchimento: `M${esquerda} ${y} Q${esquerda + larguraOnda / 2} ${y - onda * 2} ${esquerda + larguraOnda} ${y} T${esquerda + larguraOnda * 2} ${y} T${esquerda + larguraOnda * 3} ${y} T${esquerda + larguraOnda * 4} ${y} T${esquerda + larguraOnda * 5} ${y} T${direita} ${y} L${direita} ${base} H${esquerda}Z` };
}

/** SVG isolado para a imagem do marcador; não depende de URLs de upload. */
export function criarSvgCocho(percent = 0, marcador = false) {
  const forma = COCHO_DESCOBERTO_FORMA;
  const { fracao, preenchimento } = geometriaNivelCocho(percent);
  const aparencia = marcador ? COCHO_APARENCIA.marcador : COCHO_APARENCIA.subicone;
  const pes = forma.pes.map(pe => `<path d="${pe.d}" transform="${pe.transform}" fill="${aparencia.cor}"/>`).join("");
  const desenho = `<defs><clipPath id="interior"><path d="${forma.corpo}"/></clipPath></defs>${pes}${fracao > 0 ? `<path d="${preenchimento}" fill="${aparencia.sal}" clip-path="url(#interior)"/>` : ""}<path d="${forma.corpo}" fill="none" stroke="${aparencia.cor}" stroke-width="${aparencia.espessura}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (!marcador) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${forma.viewBox}" width="${forma.width}" height="${forma.height}">${desenho}</svg>`;
  return envolverMarcadorSvg(desenho, forma.viewBox);
}

export function urlIconeCocho(percent = 0, marcador = false) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(criarSvgCocho(percent, marcador))}`;
}

/** Compatibilidade: monta cocho e depósito com a moldura independente do proprietário. */
export function envolverMarcadorSvg(desenho, viewBox) {
  return montarPontoRedondo(desenho, viewBox);
}
