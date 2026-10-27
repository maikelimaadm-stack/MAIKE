/**
 * API do módulo Arquivos (P5.5 — upload nativo).
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { nativeRequest } from '../_core/nativeHttpClient.js';

const RESOURCE = 'Arquivo';

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * @param {{file: File|Blob}} payload
 */
export const uploadArquivo = async (payload) => {
  const contexto = { operation: 'uploadArquivo', resource: RESOURCE };
  assertArgument(Boolean(payload) && typeof payload === 'object' && 'file' in payload, 'file', contexto);
  const file = payload.file;
  const conteudo_base64 = await fileToBase64(file);
  const mime_type = file.type || 'application/octet-stream';
  return runProviderCall(
    () =>
      nativeRequest('/arquivos/upload', {
        method: 'POST',
        body: { conteudo_base64, mime_type },
        autenticado: true,
      }, contexto),
    contexto
  );
};
