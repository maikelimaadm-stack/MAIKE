/**
 * Porta nativa de Empresa (P5.4).
 */
import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';

const RESOURCE = 'Empresa';
const CAMINHO = '/empresas';
export const ENTIDADE_OFFLINE = 'Empresa';

const ctx = (operation) => ({ operation, resource: RESOURCE });

const queryDeFiltro = (criterio) => {
  if (!criterio || typeof criterio !== 'object') return '';
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(criterio)) {
    if (valor === undefined || valor === null || valor === '') continue;
    params.set(chave, String(valor));
  }
  const texto = params.toString();
  return texto ? `?${texto}` : '';
};

const operacoesNativas = Object.freeze({
  list: (ordenacao) => {
    void ordenacao;
    return nativeRequest(CAMINHO, { autenticado: true }, ctx('listEmpresa'));
  },

  create: (dados) =>
    nativeRequest(CAMINHO, { method: 'POST', body: dados, autenticado: true }, ctx('createEmpresa')),
  update: (id, dados) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: dados, autenticado: true },
      ctx('updateEmpresa')
    ),
  delete: (id) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'DELETE', autenticado: true },
      ctx('deleteEmpresa')
    ),
});

/** D-PROD-124: rota administrativa do fuso (online; nunca entra na fila offline). */
export const configurarFusoHorarioNativo = (id, corpo) =>
  nativeRequest(
    `${CAMINHO}/${encodeURIComponent(id)}/fuso-horario`,
    { method: 'PUT', body: corpo, autenticado: true },
    ctx('configurarFusoHorarioEmpresa')
  );

export const empresaPort = offlineStorageDisponivel()
  ? createOfflineEntityAdapter({
      entityName: ENTIDADE_OFFLINE,
      operations: operacoesNativas,
      enabled: true,
      tenantScoped: true,
      tenantCatalog: true,
    })
  : operacoesNativas;
