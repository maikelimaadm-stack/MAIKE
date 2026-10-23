/**
 * Portas nativas da geografia do mapa (P4.3, D-PROD-32).
 *
 * ConfiguracaoIcone, PontoReferencia e LinhaGeografica — única porta de cada
 * agregado. Sem fallback para a Base44.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';

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

// ── ConfiguracaoIcone ─────────────────────────────────────────────────────

const CAMPOS_ICONE_CRIACAO = Object.freeze([
  'empresa_id',
  'tipo_entidade',
  'categoria',
  'icone_url',
  'sub_icone_url',
  'cor_padrao',
  'descricao',
  'categorias_misto',
  'ativo',
]);

const CAMPOS_ICONE_ATUALIZACAO = Object.freeze([...CAMPOS_ICONE_CRIACAO]);

export const ENTIDADE_OFFLINE_ICONE = 'ConfiguracaoIcone';

const operacoesIcone = Object.freeze({
  list: () =>
    nativeRequest('/configuracao-icones', { autenticado: true }, {
      operation: 'listIcones',
      resource: 'ConfiguracaoIcone',
    }),
  create: (dados) =>
    nativeRequest(
      '/configuracao-icones',
      {
        method: 'POST',
        body: corpoDeEnvio(dados, CAMPOS_ICONE_CRIACAO),
        autenticado: true,
      },
      { operation: 'createIcone', resource: 'ConfiguracaoIcone' }
    ),
  update: (id, dados) =>
    nativeRequest(
      `/configuracao-icones/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: corpoDeEnvio(dados, CAMPOS_ICONE_ATUALIZACAO),
        autenticado: true,
      },
      { operation: 'updateIcone', resource: 'ConfiguracaoIcone' }
    ),
});

export const configuracaoIconePort = createOfflineEntityAdapter({
  entityName: ENTIDADE_OFFLINE_ICONE,
  operations: operacoesIcone,
  enabled: offlineStorageDisponivel(),
  tenantScoped: true,
});

// ── PontoReferencia ───────────────────────────────────────────────────────

const CAMPOS_PONTO_CRIACAO = Object.freeze([
  'empresa_id',
  'nome',
  'sigla',
  'tipo',
  'configuracao_icone_id',
  'icone_url',
  'sub_icone_url',
  'coordenadas',
  'cor',
  'observacoes',
  'ativo',
]);

const CAMPOS_PONTO_ATUALIZACAO = Object.freeze(
  CAMPOS_PONTO_CRIACAO.filter((c) => c !== 'empresa_id')
);

export const ENTIDADE_OFFLINE_PONTO = 'PontoReferencia';

const operacoesPonto = Object.freeze({
  list: () =>
    nativeRequest('/pontos-referencia', { autenticado: true }, {
      operation: 'listPontos',
      resource: 'PontoReferencia',
    }),
  create: (dados) =>
    nativeRequest(
      '/pontos-referencia',
      {
        method: 'POST',
        body: corpoDeEnvio(dados, CAMPOS_PONTO_CRIACAO),
        autenticado: true,
      },
      { operation: 'createPonto', resource: 'PontoReferencia' }
    ),
  update: (id, dados) =>
    nativeRequest(
      `/pontos-referencia/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: corpoDeEnvio(dados, CAMPOS_PONTO_ATUALIZACAO),
        autenticado: true,
      },
      { operation: 'updatePonto', resource: 'PontoReferencia' }
    ),
  delete: (id) =>
    nativeRequest(
      `/pontos-referencia/${encodeURIComponent(id)}`,
      { method: 'DELETE', autenticado: true },
      { operation: 'deletePonto', resource: 'PontoReferencia' }
    ),
});

export const pontoReferenciaPort = createOfflineEntityAdapter({
  entityName: ENTIDADE_OFFLINE_PONTO,
  operations: operacoesPonto,
  enabled: offlineStorageDisponivel(),
  tenantScoped: true,
});

// ── LinhaGeografica ───────────────────────────────────────────────────────

const CAMPOS_LINHA_CRIACAO = Object.freeze([
  'empresa_id',
  'nome',
  'sigla',
  'tipo',
  'coordenadas',
  'comprimento_metros',
  'cor',
  'observacoes',
  'ativo',
]);

const CAMPOS_LINHA_ATUALIZACAO = Object.freeze(
  CAMPOS_LINHA_CRIACAO.filter((c) => c !== 'empresa_id')
);

export const ENTIDADE_OFFLINE_LINHA = 'LinhaGeografica';

const operacoesLinha = Object.freeze({
  list: () =>
    nativeRequest('/linhas-geograficas', { autenticado: true }, {
      operation: 'listLinhas',
      resource: 'LinhaGeografica',
    }),
  create: (dados) =>
    nativeRequest(
      '/linhas-geograficas',
      {
        method: 'POST',
        body: corpoDeEnvio(dados, CAMPOS_LINHA_CRIACAO),
        autenticado: true,
      },
      { operation: 'createLinha', resource: 'LinhaGeografica' }
    ),
  update: (id, dados) =>
    nativeRequest(
      `/linhas-geograficas/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: corpoDeEnvio(dados, CAMPOS_LINHA_ATUALIZACAO),
        autenticado: true,
      },
      { operation: 'updateLinha', resource: 'LinhaGeografica' }
    ),
});

export const linhaGeograficaPort = createOfflineEntityAdapter({
  entityName: ENTIDADE_OFFLINE_LINHA,
  operations: operacoesLinha,
  enabled: offlineStorageDisponivel(),
  tenantScoped: true,
});
