import { nativeRequest } from '../_core/nativeHttpClient.js';
const CAMINHO = '/registros-anexo';
const ctx = (operation) => ({ operation, resource: 'RegistroAnexo' });
export const registroAnexoPort = Object.freeze({
  filter: (criterio) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(criterio || {})) {
      if (v != null && v !== '') params.set(k, String(v));
    }
    const qs = params.toString();
    return nativeRequest(`${CAMINHO}${qs ? `?${qs}` : ''}`, { autenticado: true }, ctx('filterRegistroAnexo'));
  },
  create: (dados) => nativeRequest(CAMINHO, { method: 'POST', body: dados, autenticado: true }, ctx('createRegistroAnexo')),
  delete: (id) => nativeRequest(`${CAMINHO}/${encodeURIComponent(id)}`, { method: 'DELETE', autenticado: true }, ctx('deleteRegistroAnexo')),
});
