/**
 * GUIA RÁPIDO — MOLDURA DO ÍCONE DO LOTE NO MAPA (o "quadradinho" branco com a ponteira)
 *
 * 1. GEOMETRIA DO CARD: CARD_FRAC, FAIXA_CONTAGEM e as folgas, logo abaixo.
 *    O card é a parte de cima, sem a ponteira. Os animais ficam na faixa de cima do card;
 *    a faixa de baixo é da quantidade de cabeças e nenhum animal entra nela.
 * 2. TAMANHO NO MAPA: LARGURA_MARCADOR_PX. O mapa desenha o marcador do lote com esta
 *    largura (a altura acompanha a proporção do desenho).
 * 3. DESENHO DA MOLDURA: QUADRADINHO_SVG é o arquivo quadradinho.svg do proprietário, como
 *    veio. Para trocar, cole o SVG novo inteiro entre as aspas simples, com viewBox de
 *    largura 1000, e confira CARD_FRAC.
 * Instruções completas: README.md nesta pasta.
 */

// GEOMETRIA DO CARD — EDITE AQUI.
// Fração da altura do desenho ocupada pelo card (o resto, embaixo, é a ponteira).
export const CARD_FRAC = 0.8851;
// Linha que separa os animais da contagem, em fração da altura do card: os animais ficam
// de 0 até 0.66; os 34% de baixo são da quantidade de cabeças.
export const FAIXA_CONTAGEM = 0.66;
// Folga entre os animais e as laterais do card, em fração da largura do card.
export const FOLGA_LATERAL = 0.05;
// Folga entre o topo do card e o animal mais alto, em fração da altura do card.
export const FOLGA_TOPO = 0.04;

// TAMANHO DO MARCADOR DO LOTE NO MAPA, em pixels de largura.
export const LARGURA_MARCADOR_PX = 44;

// PRÉVIA — borda interna na mesma cor do animal. Percentual da largura do card.
// 4% de 44 px = aproximadamente 1,8 px visíveis; a borda não aumenta o marcador.
export const BORDA_MOLDURA_PCT = 4;

// DESENHO DA MOLDURA: arquivo do proprietário, como veio.
export const QUADRADINHO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 961.94"><path d="M 132.009345794,0 L 867.990654206,0 C 941.588785047,0 1000,58.4112149533 1000,132.009345794 L 1000,723.130841121 C 1000,796.728971963 941.588785047,855.140186916 867.990654206,855.140186916 L 662.301565421,855.140186916 C 635.432406542,855.140186916 593.658948598,865.654205607 578.47203271,883.177570093 L 523.364485981,948.799135514 C 510.514018692,966.3225 489.485981308,966.3225 476.635514019,948.799135514 L 421.52796729,883.177570093 C 406.341051402,865.654205607 364.567593458,855.140186916 337.698434579,855.140186916 L 132.009345794,855.140186916 C 58.4112149533,855.140186916 0,796.728971963 0,723.130841121 L 0,132.009345794 C 0,58.4112149533 58.4112149533,0 132.009345794,0 Z" fill="#ffffff" stroke="#ffffff" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/></svg>';
