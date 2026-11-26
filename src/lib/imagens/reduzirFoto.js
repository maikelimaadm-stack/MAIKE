/**
 * D-PROD-327 — a foto da tarefa é reduzida no celular antes de subir.
 *
 * A foto da câmera tem de 2 a 5 MB; ela fica guardada dentro da tarefa (endereço `data:`), e o servidor recusava
 * a tarefa inteira acima do limite do envio. Reduzida para caber em 1600 px (JPEG 0,75), ela fica em torno de
 * 200–400 KB e ainda dá para ver o detalhe da cerca, do cocho ou do pasto.
 *
 * Nunca piora o envio: sem conseguir abrir a imagem (navegador sem canvas, formato que ele não lê), ou se a
 * reduzida não ficar menor, devolve o arquivo original.
 */

/** Lado maior da foto guardada (px). */
export const LADO_MAXIMO_FOTO = 1600;
/** Qualidade do JPEG reduzido. */
export const QUALIDADE_FOTO = 0.75;
/** Foto já pequena (bytes) e dentro do lado máximo: sobe como está. */
export const FOTO_JA_PEQUENA = 400 * 1024;

/**
 * Dimensões que cabem em `lado × lado`, mantendo a proporção e sem ampliar.
 *
 * @param {number} largura
 * @param {number} altura
 * @param {number} [lado]
 * @returns {{ largura: number, altura: number }}
 */
export const dimensoesDaFoto = (largura, altura, lado = LADO_MAXIMO_FOTO) => {
  if (!(largura > 0) || !(altura > 0)) return { largura: 0, altura: 0 };
  const escala = Math.min(1, lado / Math.max(largura, altura));
  return { largura: Math.max(1, Math.round(largura * escala)), altura: Math.max(1, Math.round(altura * escala)) };
};

/** @param {Blob} arquivo @returns {Promise<{ largura: number, altura: number, desenhar: (ctx: any, l: number, a: number) => void, liberar: () => void }>} */
const carregarNoNavegador = async (arquivo) => {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(arquivo);
    return {
      largura: bitmap.width,
      altura: bitmap.height,
      desenhar: (ctx, l, a) => ctx.drawImage(bitmap, 0, 0, l, a),
      liberar: () => bitmap.close?.(),
    };
  }
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      // Sem resposta do navegador (imagem que ele não decodifica), desiste: sobe a original.
      const desistir = setTimeout(() => reject(new Error('imagem não carregou')), TEMPO_PARA_ABRIR_MS);
      i.onload = () => { clearTimeout(desistir); resolve(i); };
      i.onerror = (e) => { clearTimeout(desistir); reject(e); };
      i.src = url;
    });
    return {
      largura: img.naturalWidth,
      altura: img.naturalHeight,
      desenhar: (ctx, l, a) => ctx.drawImage(img, 0, 0, l, a),
      liberar: () => URL.revokeObjectURL(url),
    };
  } catch (erro) {
    URL.revokeObjectURL(url);
    throw erro;
  }
};

/** Quanto esperar o navegador abrir a imagem. */
const TEMPO_PARA_ABRIR_MS = 8000;

const canvasDoNavegador = () => (typeof document === 'undefined' ? null : document.createElement('canvas'));

/**
 * @param {File | Blob} arquivo
 * @param {{ lado?: number, qualidade?: number, carregar?: typeof carregarNoNavegador, criarCanvas?: () => any }} [opcoes]
 * @returns {Promise<File | Blob>}
 */
export const reduzirFoto = async (arquivo, opcoes = {}) => {
  const { lado = LADO_MAXIMO_FOTO, qualidade = QUALIDADE_FOTO, carregar = carregarNoNavegador, criarCanvas = canvasDoNavegador } = opcoes;
  const tipo = String(arquivo?.type || '');
  if (!arquivo || !tipo.startsWith('image/') || tipo === 'image/svg+xml' || tipo === 'image/gif') return arquivo;
  let imagem = null;
  try {
    // O canvas antes da imagem: sem ele (aparelho/ambiente que não desenha), nem tenta abrir a foto.
    const canvas = criarCanvas();
    const ctx = canvas?.getContext?.('2d');
    if (!ctx) return arquivo;
    imagem = await carregar(arquivo);
    const { largura, altura } = dimensoesDaFoto(imagem.largura, imagem.altura, lado);
    if (!largura) return arquivo;
    const cabe = largura === imagem.largura && altura === imagem.altura;
    if (cabe && arquivo.size <= FOTO_JA_PEQUENA) return arquivo;
    canvas.width = largura;
    canvas.height = altura;
    ctx.imageSmoothingQuality = 'high';
    imagem.desenhar(ctx, largura, altura);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', qualidade));
    if (!blob || !(blob.size > 0) || blob.size >= arquivo.size) return arquivo;
    const nome = String(/** @type {any} */ (arquivo).name || 'foto').replace(/\.[^.]+$/, '') + '.jpg';
    return typeof File === 'function' ? new File([blob], nome, { type: 'image/jpeg' }) : blob;
  } catch {
    return arquivo;
  } finally {
    try {
      imagem?.liberar();
    } catch {
      /* nada a liberar */
    }
  }
};
