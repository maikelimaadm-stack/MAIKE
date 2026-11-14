/**
 * Porta nativa de ApontamentoAtividade (D-PROD-190, Fatia C).
 *
 * O apontamento é a EXECUÇÃO de um Tipo de Atividade (D-PROD-182): a TAREFA é a
 * demanda; a ATIVIDADE é a operação feita. Só online (lista keyset da EMPRESA,
 * como o abastecimento); tenant só no JWT, empresa na query da leitura e no
 * corpo da gravação.
 *
 * O corpo vai por ALLOWLIST (o servidor recusa qualquer outra chave com 400):
 * nada de `cliente_id`, número, snapshots do tipo, status, autoria, nem as
 * flags de exigência do antigo Tipo de Tarefa. Sem DELETE: o apontamento só se
 * CANCELA (`POST /:id/cancelar` com motivo, `versao` e — D-PROD-191 — o
 * `operation_id` do recibo, porque o cancelamento estorna os itens de Produto).
 * Os seletores do formulário têm rotas PRÓPRIAS da tela
 * (`/apontamentos-atividade-opcoes/…`): quem só tem esta tela não leva 403 das
 * telas de bens, de centros ou de estoque.
 *
 * Itens (D-PROD-191, Fatia D): só ADICIONAR (`POST /:id/itens`) e CANCELAR
 * (`POST /:id/itens/:itemId/cancelar`), cada um com `operation_id` e a `versao`
 * do apontamento; não há PATCH nem DELETE de item. O corpo do item vai por
 * allowlist e SEM `null` (o servidor não aceita nulo em nenhuma chave do item).
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';

const RESOURCE = 'ApontamentoAtividade';
const CAMINHO = '/apontamentos-atividade';
const CAMINHO_OPCOES = '/apontamentos-atividade-opcoes';

/**
 * Seletores próprios da tela (guardados por `visualizar` da tela; `locais`, o
 * saldo por local de um Produto, por `editar|salvar`: é de quem lança item).
 */
export const RECURSOS_OPCOES_APONTAMENTO = Object.freeze(['bens', 'operadores', 'centros-custo', 'centros-resultado', 'produtos', 'locais']);

/** Colunas que o formulário grava (o servidor deriva número, snapshots, status, autoria e versão). */
export const CAMPOS_DO_APONTAMENTO = Object.freeze([
  'tipo_atividade_id',
  'data_operacional',
  'hora_inicio',
  'hora_fim',
  'bem_id',
  'implemento_bem_id',
  'operador_usuario_id',
  'area_id',
  'centro_custo_id',
  'centro_resultado_id',
  'safra_ciclo',
  'quantidade_produzida',
  'unidade_producao',
  'horas_trabalhadas',
  'lancamento_tarefa_id',
  'observacao',
]);

export const CAMPOS_DE_CRIACAO = Object.freeze(['empresa_id', ...CAMPOS_DO_APONTAMENTO]);
export const CAMPOS_DE_ATUALIZACAO = Object.freeze(['empresa_id', 'versao', ...CAMPOS_DO_APONTAMENTO]);
/** D-PROD-191 (D-2): o cancelamento estorna os itens de Produto, então leva o `operation_id` do recibo. */
export const CAMPOS_DE_CANCELAMENTO = Object.freeze(['empresa_id', 'versao', 'motivo', 'operation_id']);

/**
 * Item do apontamento (D-PROD-191): PRODUTO leva `produto_id` e
 * `local_estoque_id`; SERVICO e OUTRO, `descricao` e `valor_unitario`. O
 * servidor recusa a chave do outro tipo (`campo_nao_permitido`).
 */
export const CAMPOS_DE_ITEM = Object.freeze([
  'empresa_id',
  'versao',
  'operation_id',
  'tipo',
  'produto_id',
  'local_estoque_id',
  'quantidade',
  'descricao',
  'valor_unitario',
]);
export const CAMPOS_DE_CANCELAMENTO_ITEM = Object.freeze(['empresa_id', 'versao', 'operation_id', 'motivo']);

/** Filtros da lista (query FECHADA no servidor: nada além disso vai). */
const FILTROS_LISTA = Object.freeze([
  'empresa_id',
  'data_de',
  'data_ate',
  'bem_id',
  'implemento_bem_id',
  'tipo_atividade_id',
  'area_id',
  'lancamento_tarefa_id',
  'status',
  'q',
  'limit',
  'cursor',
]);
const FILTROS_OPCOES = Object.freeze(['empresa_id', 'q', 'limit', 'cursor']);
/** Locais com saldo de UM Produto: a query do servidor é fechada em empresa e produto (sem busca nem página). */
const FILTROS_OPCOES_LOCAIS = Object.freeze(['empresa_id', 'produto_id']);

/** @param {string} operation @param {Record<string, unknown>} [details] */
const ctx = (operation, details) => ({ operation, resource: RESOURCE, ...(details ? { details } : {}) });

/** @param {unknown} valor */
const valorDeEnvio = (valor) => {
  if (valor === undefined) return undefined;
  if (typeof valor === 'string' && valor.trim() === '') return null;
  return valor;
};

/**
 * Só as chaves permitidas, na forma de envio (texto vazio = `null`, que limpa
 * o campo opcional; `undefined` = ausente).
 * @param {Record<string, unknown>} dados @param {readonly string[]} permitidos
 */
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

/**
 * Corpo do ITEM: as chaves permitidas, sem ausente, sem `null` e sem texto
 * vazio (nenhuma chave do item aceita nulo no servidor).
 * @param {Record<string, unknown>} dados @param {readonly string[]} permitidos
 */
export const corpoDoItemDeEnvio = (dados, permitidos) => {
  /** @type {Record<string, unknown>} */
  const corpo = {};
  for (const [campo, valor] of Object.entries(corpoDeEnvio(dados, permitidos))) {
    if (valor !== null) corpo[campo] = valor;
  }
  return corpo;
};

/**
 * Caminho com só as chaves permitidas, sem vazio. `natureza` (só em `bens`)
 * vai repetida, uma por natureza.
 * @param {string} caminho @param {readonly string[]} permitidas @param {Record<string, unknown>} filtros
 */
const comFiltros = (caminho, permitidas, filtros) => {
  const params = new URLSearchParams();
  for (const chave of permitidas) {
    const valor = filtros[chave];
    if (valor === undefined || valor === null) continue;
    const texto = typeof valor === 'string' ? valor.trim() : String(valor);
    if (texto) params.set(chave, texto);
  }
  const naturezas = Array.isArray(filtros.natureza) ? filtros.natureza : [];
  for (const natureza of naturezas) {
    if (typeof natureza === 'string' && natureza.trim()) params.append('natureza', natureza.trim());
  }
  const qs = params.toString();
  return qs ? `${caminho}?${qs}` : caminho;
};

/** @param {Record<string, unknown>} [filtros] */
export const montarCaminhoListagem = (filtros = {}) => comFiltros(CAMINHO, FILTROS_LISTA, { ...filtros, natureza: undefined });

/** @param {string} recurso @param {Record<string, unknown>} [filtros] */
export const montarCaminhoOpcoes = (recurso, filtros = {}) =>
  comFiltros(
    `${CAMINHO_OPCOES}/${encodeURIComponent(recurso)}`,
    recurso === 'locais' ? FILTROS_OPCOES_LOCAIS : FILTROS_OPCOES,
    recurso === 'bens' ? filtros : { ...filtros, natureza: undefined },
  );

/** @param {string} id */
const doApontamento = (id) => `${CAMINHO}/${encodeURIComponent(id)}`;
/** @param {string} id @param {string} empresaId */
const comEmpresa = (id, empresaId) => `${doApontamento(id)}?${new URLSearchParams({ empresa_id: String(empresaId) }).toString()}`;

export const operacoesNativas = Object.freeze({
  /** @param {Record<string, unknown>} [filtros] */
  listPage: (filtros = {}) => nativeRequest(montarCaminhoListagem(filtros), { autenticado: true }, ctx('listApontamentosAtividadePage')),

  /** @param {string} id @param {string} empresaId */
  get: (id, empresaId) => nativeRequest(comEmpresa(id, empresaId), { autenticado: true }, ctx('getApontamentoAtividade', { id })),

  /** @param {Record<string, unknown>} dados */
  create: (dados) =>
    nativeRequest(
      CAMINHO,
      { method: 'POST', body: corpoDeEnvio(dados, CAMPOS_DE_CRIACAO), autenticado: true },
      ctx('createApontamentoAtividade'),
    ),

  /** @param {string} id @param {Record<string, unknown>} dados */
  update: (id, dados) =>
    nativeRequest(
      doApontamento(id),
      { method: 'PATCH', body: corpoDeEnvio(dados, CAMPOS_DE_ATUALIZACAO), autenticado: true },
      ctx('updateApontamentoAtividade', { id }),
    ),

  /** @param {string} id @param {Record<string, unknown>} dados */
  cancelar: (id, dados) =>
    nativeRequest(
      `${doApontamento(id)}/cancelar`,
      { method: 'POST', body: corpoDeEnvio(dados, CAMPOS_DE_CANCELAMENTO), autenticado: true },
      ctx('cancelarApontamentoAtividade', { id }),
    ),

  /** D-PROD-191: adiciona UM item ao apontamento CONFIRMADO. @param {string} id @param {Record<string, unknown>} dados */
  adicionarItem: (id, dados) =>
    nativeRequest(
      `${doApontamento(id)}/itens`,
      { method: 'POST', body: corpoDoItemDeEnvio(dados, CAMPOS_DE_ITEM), autenticado: true },
      ctx('adicionarItemApontamentoAtividade', { id }),
    ),

  /** D-PROD-191: cancela UM item (o de Produto volta ao estoque). @param {string} id @param {string} itemId @param {Record<string, unknown>} dados */
  cancelarItem: (id, itemId, dados) =>
    nativeRequest(
      `${doApontamento(id)}/itens/${encodeURIComponent(itemId)}/cancelar`,
      { method: 'POST', body: corpoDoItemDeEnvio(dados, CAMPOS_DE_CANCELAMENTO_ITEM), autenticado: true },
      ctx('cancelarItemApontamentoAtividade', { id, itemId }),
    ),

  /** @param {string} recurso @param {Record<string, unknown>} [filtros] */
  opcoes: (recurso, filtros = {}) =>
    nativeRequest(montarCaminhoOpcoes(recurso, filtros), { autenticado: true }, ctx('listOpcoesApontamentoAtividade', { recurso })),
});
