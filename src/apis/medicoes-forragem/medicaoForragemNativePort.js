/**
 * Porta nativa da Medição de Forragem (D-PROD-219), `/medicoes-forragem`.
 *
 * A criação passa pela fila offline (a medição é feita no pasto, muitas vezes sem
 * sinal). O servidor tem o corpo FECHADO; por isso o `create` envia só os campos que
 * ele aceita (os derivados — média, situação da régua, matéria verde/seca — são dele).
 *
 * D-PROD-319 (Etapa 5a): o id da medição nova é gerado no aparelho (UUID) e é definitivo; repetir a criação
 * (resposta perdida, app fechado no meio) devolve a mesma medição em vez de gravar outra.
 */
import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';
import { eIdDoAparelho } from '@/lib/offline/idDoAparelho';

const RESOURCE = 'MedicaoForragem';
const CAMINHO = '/medicoes-forragem';
export const ENTIDADE_OFFLINE = 'MedicaoForragem';

/** Os únicos campos que o servidor aceita no POST. */
export const CAMPOS_DA_MEDICAO = Object.freeze([
  'empresa_id', 'area_id', 'data_medicao', 'metodo', 'leituras_cm', 'situacao',
  'quadro_m2', 'qtd_amostras', 'peso_verde_g', 'peso_seco_g', 'materia_seca_pct', 'observacoes',
]);

/** @param {Record<string, unknown>} dados */
export const corpoDaMedicao = (dados) => ({
  ...Object.fromEntries(CAMPOS_DA_MEDICAO.filter((k) => dados?.[k] !== undefined).map((k) => [k, dados[k]])),
  ...(eIdDoAparelho(dados?.id) ? { id: dados.id } : {}),
});

/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });

const operacoesNativas = Object.freeze({
  list: (ordenacao, limite) => {
    void ordenacao;
    const qs = limite ? `?limit=${encodeURIComponent(String(limite))}` : '';
    return nativeRequest(`${CAMINHO}${qs}`, { autenticado: true }, ctx('listMedicaoForragem'));
  },

  create: (dados) =>
    nativeRequest(CAMINHO, { method: 'POST', body: corpoDaMedicao(dados), autenticado: true }, ctx('createMedicaoForragem')),

  delete: (id) =>
    nativeRequest(`${CAMINHO}/${encodeURIComponent(id)}`, { method: 'DELETE', autenticado: true }, ctx('deleteMedicaoForragem')),
});

/**
 * D-PROD-223 — por pasto da fazenda: se há lote dentro agora e o dia em que o último
 * lote saiu (pelo ledger do rebanho). Só leitura e só online: o cache do mapa guarda a
 * última resposta para uso sem rede.
 * @param {string} empresaId
 */
export const descansoDosPastosNativo = (empresaId) =>
  nativeRequest(`${CAMINHO}/descanso?empresa_id=${encodeURIComponent(empresaId)}`, { autenticado: true }, ctx('listDescansoPastos'));

export const medicaoForragemPort = offlineStorageDisponivel()
  ? createOfflineEntityAdapter({
      entityName: ENTIDADE_OFFLINE,
      operations: operacoesNativas,
      enabled: true,
      tenantScoped: true,
      idDoAparelho: true,
    })
  : operacoesNativas;
