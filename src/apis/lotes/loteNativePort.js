/**
 * Porta nativa de Lote (P5.1, D-PROD-47).
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
  removerRegistroDosCachesOffline,
  temPendenciaOfflineDoRegistro,
} from '@/lib/offline/offlineEntityRuntime';

const RESOURCE = 'Lote';
const CAMINHO = '/lotes';

export const ENTIDADE_OFFLINE = 'Lote';

const ctx = (operation) => ({ operation, resource: RESOURCE });

const CAMPOS_DE_CRIACAO = Object.freeze([
  'empresa_id',
  'nome',
  'identificador_nome',
  'identificador_sigla',
  'identificador_cor',
  'quantidade_cabecas',
  'categoria',
  'categoria_manejo_id',
  'categoria_manejo_nome',
  'sexo',
  'peso_medio_kg',
  'idade_media_meses',
  'setor_id',
  'area_entrada_id',
  'area_atual_id',
  'raca_predominante',
  'sistema_produtivo',
  'data_entrada',
  'motivo_entrada',
  'origem',
  'fornecedor_id',
  'fornecedor_nome',
  'nota_fiscal',
  'chave_nfe',
  'numero_gta',
  'cidade_origem',
  'estado_origem',
  'valor_total_compra',
  'valor_por_cabeca',
  'valor_frete',
  'motivo_ajuste',
  'motivo_outros',
  'observacoes',
  'status',
  'campos_personalizados',
]);

const CAMPOS_DE_ATUALIZACAO = Object.freeze(
  CAMPOS_DE_CRIACAO.filter((campo) => campo !== 'empresa_id' && campo !== 'area_entrada_id')
);

const valorDeEnvio = (valor) => {
  if (valor === undefined) return undefined;
  if (typeof valor === 'string' && valor.trim() === '') return null;
  return valor;
};

/** @param {Record<string, unknown>} dados @param {readonly string[]} permitidos */
export const corpoDeEnvio = (dados, permitidos) => {
  /** @type {Record<string, unknown>} */
  const corpo = {};
  for (const campo of permitidos) {
    if (!Object.prototype.hasOwnProperty.call(dados ?? {}, campo)) continue;
    const valor = valorDeEnvio(/** @type {Record<string, unknown>} */ (dados)[campo]);
    if (valor !== undefined) corpo[campo] = valor;
  }
  return corpo;
};

export const operacoesNativas = Object.freeze({
  list: () => nativeRequest(CAMINHO, { autenticado: true }, ctx('listLotes')),

  create: (dados) =>
    nativeRequest(
      CAMINHO,
      { method: 'POST', body: corpoDeEnvio(dados, CAMPOS_DE_CRIACAO), autenticado: true },
      ctx('createLote')
    ),

  update: (id, dados) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: corpoDeEnvio(dados, CAMPOS_DE_ATUALIZACAO), autenticado: true },
      ctx('updateLote')
    ),

  delete: (id) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'DELETE', autenticado: true },
      ctx('deleteLote')
    ),
});

/**
 * Exclusão do Cadastro (MAIKE-LOTES-R1): sempre direto no servidor, nunca pela
 * fila offline — exclusão é definitiva e o servidor decide física × lógica.
 */
export const operacoesDeExclusao = Object.freeze({
  elegibilidade: (id) =>
    nativeRequest(`${CAMINHO}/${encodeURIComponent(id)}/elegibilidade-exclusao`, { autenticado: true }, ctx('elegibilidadeExclusaoLote')),
  excluirOnline: (id) => operacoesNativas.delete(id),
  /** Depois de 204 do servidor: tira o lote de todos os caches offline do tenant. */
  removerDosCachesOffline: (id) => removerRegistroDosCachesOffline(ENTIDADE_OFFLINE, id),
  /** Edição/criação offline deste lote ainda na fila? */
  temPendenciaOffline: (id) => temPendenciaOfflineDoRegistro(ENTIDADE_OFFLINE, id),
  /** Leitura por id, inclusive lote excluído logicamente (histórico/auditoria). */
  buscarPorId: (id) => nativeRequest(`${CAMINHO}/${encodeURIComponent(id)}`, { autenticado: true }, ctx('buscarLotePorIdServidor')),
});

export const lotePort = createOfflineEntityAdapter({
  entityName: ENTIDADE_OFFLINE,
  operations: operacoesNativas,
  enabled: offlineStorageDisponivel(),
  tenantScoped: true,
});
