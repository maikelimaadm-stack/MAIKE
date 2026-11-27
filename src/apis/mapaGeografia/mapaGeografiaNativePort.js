/**
 * Portas nativas da geografia do mapa (P4.3, D-PROD-32).
 *
 * ConfiguracaoIcone, PontoReferencia e LinhaGeografica — única porta de cada
 * agregado. Sem fallback para a Base44.
 */

import { eIdDoAparelho } from '@/lib/offline/idDoAparelho';
import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';
import { registrarLeiturasOffline } from '@/lib/offline/leiturasOffline';
import { ordemPorCriacaoCrescente, registrarListaIncremental } from '@/lib/offline/sincronizacaoIncremental';

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
        // D-PROD-355: o id gerado no aparelho vai junto.
        body: { ...corpoDeEnvio(dados, CAMPOS_PONTO_CRIACAO), ...(eIdDoAparelho(/** @type {any} */ (dados)?.id) ? { id: /** @type {any} */ (dados).id } : {}) },
        autenticado: true,
      },
      { operation: 'createPonto', resource: 'PontoReferencia' }
    ),
  update: (id, dados) =>
    nativeRequest(
      `/pontos-referencia/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        // D-PROD-344: a versão que a pessoa viu vai junto; o servidor confere.
        body: corpoDeEnvio(dados, [...CAMPOS_PONTO_ATUALIZACAO, 'versao_esperada']),
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
  // D-PROD-355: nasce com o id definitivo (UUID).
  idDoAparelho: true,
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
        // D-PROD-355: o id gerado no aparelho vai junto.
        body: { ...corpoDeEnvio(dados, CAMPOS_LINHA_CRIACAO), ...(eIdDoAparelho(/** @type {any} */ (dados)?.id) ? { id: /** @type {any} */ (dados).id } : {}) },
        autenticado: true,
      },
      { operation: 'createLinha', resource: 'LinhaGeografica' }
    ),
  update: (id, dados) =>
    nativeRequest(
      `/linhas-geograficas/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        // D-PROD-344: a versão que a pessoa viu vai junto; o servidor confere.
        body: corpoDeEnvio(dados, [...CAMPOS_LINHA_ATUALIZACAO, 'versao_esperada']),
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
  // D-PROD-355: nasce com o id definitivo (UUID).
  idDoAparelho: true,
});

// D-PROD-294: leituras que as telas deste módulo fazem ao abrir — baixadas antes
// de o app abrir pela primeira vez (o caminho fica aqui, na porta do módulo).
registrarLeiturasOffline([
  '/configuracao-icones',
  '/linhas-geograficas',
  '/pontos-referencia',
]);

// D-PROD-345: as listas inteiras (sem filtros) sincronizam só o que mudou desde a última vez.
registrarListaIncremental('/pontos-referencia', { mudancas: '/pontos-referencia/mudancas', ordem: ordemPorCriacaoCrescente });
registrarListaIncremental('/linhas-geograficas', { mudancas: '/linhas-geograficas/mudancas', ordem: ordemPorCriacaoCrescente });
