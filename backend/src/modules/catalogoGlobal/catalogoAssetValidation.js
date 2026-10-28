import { createHash } from 'node:crypto';

import { env } from '../../config/env.js';
import { catalogoAssetInvalid } from '../../shared/errors/AppError.js';

const MIMES_PERMITIDOS = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** @param {Buffer} buffer */
export const detectarMimeReal = (buffer) => {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (
    buffer.length >= 6 &&
    (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a')
  ) {
    return 'image/gif';
  }
  if (buffer.length >= 5 && buffer.toString('utf8', 0, 5).toLowerCase().includes('<svg')) {
    return 'image/svg+xml';
  }
  return null;
};

/** @param {Buffer} buffer */
export const lerDimensoesImagem = (buffer) => {
  const mime = detectarMimeReal(buffer);
  if (mime === 'image/png' && buffer.length >= 24) {
    return { largura: buffer.readUInt32BE(16), altura: buffer.readUInt32BE(20) };
  }
  if (mime === 'image/jpeg') {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const len = buffer.readUInt16BE(offset + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        return { altura: buffer.readUInt16BE(offset + 5), largura: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + len;
    }
  }
  if (mime === 'image/gif' && buffer.length >= 10) {
    return { largura: buffer.readUInt16LE(6), altura: buffer.readUInt16LE(8) };
  }
  return { largura: null, altura: null };
};

/**
 * @param {Buffer} buffer
 * @param {string} [mimeDeclarado]
 */
export const validarBufferAssetCatalogo = (buffer, mimeDeclarado) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw catalogoAssetInvalid('conteúdo vazio');
  }
  if (buffer.length > env.catalogoAssetMaxBytes) {
    throw catalogoAssetInvalid('arquivo excede tamanho máximo do catálogo', {
      max_bytes: env.catalogoAssetMaxBytes,
    });
  }
  const mimeReal = detectarMimeReal(buffer);
  if (!mimeReal || !MIMES_PERMITIDOS.has(mimeReal)) {
    throw catalogoAssetInvalid('tipo de imagem não permitido (SVG e formatos desconhecidos reprovados)');
  }
  if (mimeDeclarado && mimeDeclarado !== mimeReal) {
    throw catalogoAssetInvalid('Content-Type não corresponde ao conteúdo real');
  }
  const { largura, altura } = lerDimensoesImagem(buffer);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  return { mime: mimeReal, sha256, largura, altura, bytes: buffer.length };
};
