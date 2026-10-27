import { nativeRequest } from '../_core/nativeHttpClient.js';
export const sincronizarReferenciasNativas = (payload) =>
  nativeRequest('/referencias/sincronizar', { method: 'POST', body: payload, autenticado: true }, {
    operation: 'sincronizarReferencias',
    resource: 'Referencias',
  });
