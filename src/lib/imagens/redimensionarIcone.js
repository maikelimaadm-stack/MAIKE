/**
 * Ajuste automático da imagem de ícone no envio (D-PROD-81).
 *
 * O proprietário escolhe qualquer imagem (foto, desenho de 1000 px...) e o
 * MAIKE a reduz para caber num quadrado de ícone, sem cortar nem deformar. O
 * marcador do mapa e os cartões exibem ícones de dezenas de pixels: guardar o
 * original só pesava o banco e o carregamento do mapa.
 */

/** Lado máximo do ícone guardado (folga para telas de alta densidade). */
export const LADO_MAXIMO_ICONE = 256;

/**
 * Dimensões que cabem em `lado × lado`, mantendo a proporção e sem ampliar.
 *
 * @param {number} largura
 * @param {number} altura
 * @param {number} [lado]
 * @returns {{ largura: number, altura: number }}
 */
export const dimensoesDeIcone = (largura, altura, lado = LADO_MAXIMO_ICONE) => {
  if (!(largura > 0) || !(altura > 0)) return { largura: 0, altura: 0 };
  const escala = Math.min(1, lado / Math.max(largura, altura));
  return {
    largura: Math.max(1, Math.round(largura * escala)),
    altura: Math.max(1, Math.round(altura * escala)),
  };
};

/** @param {Blob} arquivo @returns {Promise<HTMLImageElement>} */
const carregarImagem = (arquivo) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (erro) => {
      URL.revokeObjectURL(url);
      reject(erro);
    };
    img.src = url;
  });

/**
 * Reduz a imagem para ícone (PNG, transparência preservada).
 *
 * Devolve o arquivo original quando não há o que reduzir, quando não é imagem
 * rasterizável (SVG, por exemplo) ou quando o navegador não consegue processar:
 * o envio nunca fica pior do que era antes.
 *
 * @param {File} arquivo
 * @param {number} [lado]
 * @returns {Promise<File|Blob>}
 */
export const redimensionarParaIcone = async (arquivo, lado = LADO_MAXIMO_ICONE) => {
  if (!arquivo?.type?.startsWith('image/') || arquivo.type === 'image/svg+xml') return arquivo;
  try {
    const img = await carregarImagem(arquivo);
    const { largura, altura } = dimensoesDeIcone(img.naturalWidth, img.naturalHeight, lado);
    if (!largura || (largura === img.naturalWidth && altura === img.naturalHeight)) return arquivo;
    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext('2d');
    if (!ctx) return arquivo;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, largura, altura);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return arquivo;
    const nome = (arquivo.name || 'icone').replace(/\.[^.]+$/, '') + '.png';
    return typeof File === 'function' ? new File([blob], nome, { type: 'image/png' }) : blob;
  } catch {
    return arquivo;
  }
};
