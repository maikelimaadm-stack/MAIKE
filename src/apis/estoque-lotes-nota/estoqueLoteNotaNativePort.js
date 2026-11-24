/**
 * Porta nativa de EstoqueLoteNota (P5.4).
 *
 * D-PROD-161 (MAIKE-ESTOQUE-P0-01, F3): sem `create` e sem `delete`. Lote só
 * nasce de uma entrada (compra confirmada) ou de uma transferência, e nunca é
 * apagado (o backend responde 409). Como o adaptador offline só expõe as
 * operações que existem, não há como enfileirar essas escritas. Ficam a
 * leitura e o `update` — a renomeação do local (`local_estoque_nome`) feita
 * pelo FormularioPonto.
 */
import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';
import { registrarLeiturasOffline } from '@/lib/offline/leiturasOffline';

const RESOURCE = 'EstoqueLoteNota';
const CAMINHO = '/estoque-lotes-nota';
export const ENTIDADE_OFFLINE = 'EstoqueLoteNota';

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
    return nativeRequest(CAMINHO, { autenticado: true }, ctx('listEstoqueLoteNota'));
  },
  filter: async (criterio) => {
    const chaves = Object.keys(criterio || {}).filter(
      (k) => criterio[k] !== undefined && criterio[k] !== null && criterio[k] !== ''
    );
    if (chaves.length === 1 && chaves[0] === 'id') {
      const item = await nativeRequest(
        `${CAMINHO}/${encodeURIComponent(String(criterio.id))}`,
        { autenticado: true },
        ctx('getEstoqueLoteNotaById')
      );
      return item ? [item] : [];
    }
    return nativeRequest(`${CAMINHO}${queryDeFiltro(criterio)}`, { autenticado: true }, ctx('filterEstoqueLoteNota'));
  },
  update: (id, dados) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: dados, autenticado: true },
      ctx('updateEstoqueLoteNota')
    ),
});

export const estoqueLoteNotaPort = offlineStorageDisponivel()
  ? createOfflineEntityAdapter({
      entityName: ENTIDADE_OFFLINE,
      operations: operacoesNativas,
      enabled: true,
      tenantScoped: true,
    })
  : operacoesNativas;

// D-PROD-291: leituras que as telas deste módulo fazem ao abrir — baixadas antes
// de o app abrir pela primeira vez (o caminho fica aqui, na porta do módulo).
registrarLeiturasOffline([
  '/estoque-lotes-nota',
]);
