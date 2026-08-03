/**
 * API do módulo Arquivos (P1.2).
 *
 * Upload de anexo de tarefa. Integração, não entidade — fica fora do registry
 * por natureza. O formato do payload e o retorno são os mesmos de antes: esta
 * slice move a fronteira, não muda o fluxo de upload.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { arquivosProvider } from '../_providers/base44Provider.js';

const RESOURCE = 'Arquivo';

/**
 * Envia um arquivo e devolve o payload do provider (inclui `file_url`).
 *
 * Nada do conteúdo entra em log, mensagem ou `details` (QLT-P12-07).
 *
 * @param {{file: File|Blob}} payload
 */
export const uploadArquivo = async (payload) => {
  const contexto = { operation: 'uploadArquivo', resource: RESOURCE };
  assertArgument(Boolean(payload) && typeof payload === 'object' && 'file' in payload, 'file', contexto);
  return runProviderCall(() => arquivosProvider.upload(payload), contexto);
};
