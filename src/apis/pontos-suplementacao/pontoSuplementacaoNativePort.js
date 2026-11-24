/**
 * Porta nativa de PontoSuplementacao (P5.4).
 */
import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';
import { registrarLeiturasOffline } from '@/lib/offline/leiturasOffline';

const RESOURCE = 'PontoSuplementacao';
const CAMINHO = '/pontos-suplementacao';
export const ENTIDADE_OFFLINE = 'PontoSuplementacao';

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
    return nativeRequest(CAMINHO, { autenticado: true }, ctx('listPontoSuplementacao'));
  },

  create: (dados) =>
    nativeRequest(CAMINHO, { method: 'POST', body: dados, autenticado: true }, ctx('createPontoSuplementacao')),
  update: (id, dados) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: dados, autenticado: true },
      ctx('updatePontoSuplementacao')
    ),
  delete: (id) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'DELETE', autenticado: true },
      ctx('deletePontoSuplementacao')
    ),
});

export const pontoSuplementacaoPort = offlineStorageDisponivel()
  ? createOfflineEntityAdapter({
      entityName: ENTIDADE_OFFLINE,
      operations: operacoesNativas,
      enabled: true,
    })
  : operacoesNativas;

/**
 * Elegibilidade de exclusão (só leitura, só online): `{ id, pode_excluir, motivos }`.
 * Fica FORA do adaptador offline: a exclusão do ponto do mapa precisa da
 * resposta do servidor para não apagar cocho/depósito com histórico.
 * @param {string} id
 */
export const consultarElegibilidadeExclusaoPontoSuplementacaoNativa = (id) =>
  nativeRequest(
    `${CAMINHO}/${encodeURIComponent(id)}/elegibilidade-exclusao`,
    { autenticado: true },
    ctx('elegibilidadeExclusaoPontoSuplementacao')
  );

// D-PROD-289: leituras que as telas deste módulo fazem ao abrir — baixadas antes
// de o app abrir pela primeira vez (o caminho fica aqui, na porta do módulo).
registrarLeiturasOffline([
  '/pontos-suplementacao',
]);
