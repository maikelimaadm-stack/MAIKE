/**
 * Porta nativa de TipoAtividade (D-PROD-182; padrões e flags, D-PROD-197).
 *
 * O corpo vai por ALLOWLIST (o servidor recusa qualquer outra chave com 400):
 * os campos do cadastro, os PADRÕES que a atividade herda (categoria, centro de
 * custo, centro de resultado, unidade de produção e coeficiente) e as 8 FLAGS de
 * como ela funciona. Nada das flags legadas de TipoTarefa (`pode_ter_*`).
 *
 * Tipos no corpo (o servidor não coage, e o valor de outro tipo dá 400): flag só
 * viaja como booleano; coeficiente só como texto — a string canônica
 * `^\d{1,10}(\.\d{1,4})?$`, que o formulário monta a partir do formato local da
 * tela — ou `null`. Valor de outro tipo fica fora do corpo (ausente = `false` no
 * POST; no PATCH, não muda). Texto vazio continua indo como `null`.
 *
 * As opções do formulário (centros ATIVOS de uma fazenda) têm rota própria do
 * tipo (`/tipos-atividade/opcoes/…`, guardada por quem cria ou edita tipo, não
 * pelas telas de centros) e são só online: não passam pelo adapter offline.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';

const RESOURCE = 'TipoAtividade';
const CAMINHO = '/tipos-atividade';

export const ENTIDADE_OFFLINE = 'TipoAtividade';

/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });

/** As 8 flags de como a atividade funciona (D-PROD-197), na ordem do contrato. */
export const FLAGS_TIPO_ATIVIDADE = Object.freeze([
  'exige_area',
  'exige_safra',
  'exige_maquina',
  'permite_implemento',
  'permite_produto',
  'permite_servico',
  'permite_mao_obra',
  'exige_producao',
]);

/** Padrões que a atividade herda do tipo (D-PROD-197); `null` = sem padrão. */
export const CAMPOS_PADRAO_TIPO_ATIVIDADE = Object.freeze([
  'categoria',
  'centro_custo_padrao_id',
  'centro_resultado_padrao_id',
  'unidade_producao_id',
  'coeficiente_padrao',
]);

export const CAMPOS_DE_CRIACAO = Object.freeze([
  'nome_tipo',
  'grupo_atividade_id',
  'ativo',
  'descricao',
  ...CAMPOS_PADRAO_TIPO_ATIVIDADE,
  ...FLAGS_TIPO_ATIVIDADE,
  // D-PROD-268: o alvo da Aplicação (vem do cadastro da operação; o funcionário não escolhe).
  'alvo',
]);

export const CAMPOS_DE_ATUALIZACAO = Object.freeze([...CAMPOS_DE_CRIACAO]);

/** Seletores do formulário com rota própria do tipo (D-PROD-197, contrato §3.4). */
export const RECURSOS_OPCOES_TIPO_ATIVIDADE = Object.freeze(['centros-custo', 'centros-resultado']);

/** @param {string} campo @param {unknown} valor */
const valorDeEnvio = (campo, valor) => {
  if (valor === undefined) return undefined;
  if (FLAGS_TIPO_ATIVIDADE.includes(campo)) return typeof valor === 'boolean' ? valor : undefined;
  if (campo === 'coeficiente_padrao') {
    if (valor === null) return null;
    if (typeof valor !== 'string') return undefined;
    return valor.trim() || null;
  }
  if (typeof valor === 'string' && valor.trim() === '') return null;
  return valor;
};

/** @param {Record<string, unknown>} dados @param {readonly string[]} permitidos */
export const corpoDeEnvio = (dados, permitidos) => {
  /** @type {Record<string, unknown>} */
  const corpo = {};
  for (const campo of permitidos) {
    if (!Object.prototype.hasOwnProperty.call(dados ?? {}, campo)) continue;
    const valor = valorDeEnvio(campo, /** @type {Record<string, unknown>} */ (dados)[campo]);
    if (valor !== undefined) corpo[campo] = valor;
  }
  return corpo;
};

/** @param {unknown} v */
const textoOuNulo = (v) => (typeof v === 'string' && v.trim() ? v : null);
/** @param {unknown} v */
const objetoOuNulo = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/**
 * Registro como a tela lê (D-PROD-197): as 8 flags sempre booleanas (registro
 * do cache offline anterior às colunas lê `false`, como o banco); padrão
 * ausente = `null`; os objetos que o servidor inclui (`centro_custo_padrao`,
 * `centro_resultado_padrao`, `unidade_producao`) ou `null`. O resto passa
 * intacto.
 * @param {unknown} registro
 * @returns {any}
 */
export const tipoAtividadeDeResposta = (registro) => {
  if (!registro || typeof registro !== 'object' || Array.isArray(registro)) return registro;
  const r = /** @type {Record<string, unknown>} */ (registro);
  return {
    ...r,
    categoria: textoOuNulo(r.categoria),
    centro_custo_padrao_id: textoOuNulo(r.centro_custo_padrao_id),
    centro_custo_padrao: objetoOuNulo(r.centro_custo_padrao),
    centro_resultado_padrao_id: textoOuNulo(r.centro_resultado_padrao_id),
    centro_resultado_padrao: objetoOuNulo(r.centro_resultado_padrao),
    unidade_producao_id: textoOuNulo(r.unidade_producao_id),
    unidade_producao: objetoOuNulo(r.unidade_producao),
    coeficiente_padrao: textoOuNulo(r.coeficiente_padrao),
    ...Object.fromEntries(FLAGS_TIPO_ATIVIDADE.map((flag) => [flag, r[flag] === true])),
    // D-PROD-268: o `alvo` da Aplicação passa como veio (ausente no cache antigo = sem alvo).
  };
};

/** @param {string} recurso @param {string} empresaId */
export const montarCaminhoOpcoes = (recurso, empresaId) =>
  `${CAMINHO}/opcoes/${encodeURIComponent(recurso)}?${new URLSearchParams({ empresa_id: String(empresaId) }).toString()}`;

export const operacoesNativas = Object.freeze({
  list: () => nativeRequest(CAMINHO, { autenticado: true }, ctx('listTiposAtividade')),

  /** @param {string} id */
  get: (id) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { autenticado: true },
      ctx('getTipoAtividade')
    ),

  /** @param {Record<string, unknown>} dados */
  create: (dados) =>
    nativeRequest(
      CAMINHO,
      { method: 'POST', body: corpoDeEnvio(dados, CAMPOS_DE_CRIACAO), autenticado: true },
      ctx('createTipoAtividade')
    ),

  /** @param {string} id @param {Record<string, unknown>} dados */
  update: (id, dados) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: corpoDeEnvio(dados, CAMPOS_DE_ATUALIZACAO), autenticado: true },
      ctx('updateTipoAtividade')
    ),

  /** @param {string} id */
  delete: (id) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'DELETE', autenticado: true },
      ctx('deleteTipoAtividade')
    ),
});

/** Opções do formulário (só online, fora do adapter offline). */
export const opcoesNativas = Object.freeze({
  /** @param {string} recurso @param {string} empresaId */
  listar: (recurso, empresaId) =>
    nativeRequest(montarCaminhoOpcoes(recurso, empresaId), { autenticado: true }, ctx('listOpcoesTipoAtividade')),
});

export const tipoAtividadePort = createOfflineEntityAdapter({
  entityName: ENTIDADE_OFFLINE,
  operations: operacoesNativas,
  enabled: offlineStorageDisponivel(),
  tenantScoped: true,
});
