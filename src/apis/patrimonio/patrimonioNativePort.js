/**
 * Porta nativa de Patrimônio e Frota (D-PROD-157). Só online; tenant só no JWT.
 *
 * Catálogos (famílias, tipos, perfis de medição, combustíveis) são do TENANT:
 * nenhuma rota de catálogo leva `empresa_id`. Bens pertencem a uma empresa:
 * `empresa_id` vai na query da leitura e no corpo da gravação. O vínculo
 * Combustível × Produto (R2) é POR EMPRESA: `empresa_id` na query da leitura e
 * no corpo do POST/PATCH.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';

/** Caminho de cada catálogo (recurso → rota). */
export const CAMINHOS_CATALOGO = Object.freeze({
  familias: '/patrimonio-familias',
  tipos: '/patrimonio-tipos',
  'perfis-medicao': '/patrimonio-perfis-medicao',
  combustiveis: '/patrimonio-combustiveis',
});

const RECURSO_DO_CATALOGO = Object.freeze({
  familias: 'FamiliaPatrimonial',
  tipos: 'TipoPatrimonial',
  'perfis-medicao': 'PerfilMedicao',
  combustiveis: 'TipoCombustivel',
});

const CAMINHO_CATALOGO_PADRAO = '/patrimonio-catalogo-padrao';
const CAMINHO_BENS = '/bens-patrimoniais';
const CAMINHO_PREVIA = '/bens-patrimoniais-previa-depreciacao';
const CAMINHO_OPCOES = '/bens-patrimoniais-opcoes';

const RESOURCE_BEM = 'BemPatrimonial';

/**
 * Combustível × Produto por empresa (R2): vínculos do tipo NA empresa, item do
 * vínculo (inativar/reativar) e opções de produto. Nenhuma rota começa pelos
 * caminhos da porta de Produtos — o produto é só referência por id.
 */
const CAMINHO_VINCULO_COMBUSTIVEL_PRODUTO = '/patrimonio-combustivel-produtos';
const CAMINHO_OPCOES_PRODUTOS_COMBUSTIVEL = '/patrimonio-combustiveis-opcoes/produtos';
const RESOURCE_VINCULO = 'TipoCombustivelProduto';

/** @param {string} operation @param {string} resource @param {Record<string, unknown>} [details] */
const ctx = (operation, resource, details) => ({ operation, resource, ...(details ? { details } : {}) });

/** @param {unknown} v */
const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** @param {string} recurso @returns {string} */
const caminhoDoCatalogo = (recurso) => /** @type {Record<string, string>} */ (CAMINHOS_CATALOGO)[recurso];
/** @param {string} recurso @returns {string} */
const recursoDoCatalogo = (recurso) => /** @type {Record<string, string>} */ (RECURSO_DO_CATALOGO)[recurso];

/**
 * @param {URLSearchParams} params
 * @param {Record<string, unknown>} filtros
 */
const paginacao = (params, filtros) => {
  const q = texto(filtros.q);
  if (q) params.set('q', q);
  if (filtros.limit != null) params.set('limit', String(filtros.limit));
  if (typeof filtros.cursor === 'string' && filtros.cursor) params.set('cursor', filtros.cursor);
};

/** @param {string} caminho @param {URLSearchParams} params */
const comQuery = (caminho, params) => {
  const qs = params.toString();
  return qs ? `${caminho}?${qs}` : caminho;
};

/**
 * Listagem keyset de um catálogo: `q`, `ativo`, `natureza` (famílias) e
 * `familia_id` (tipos).
 * @param {string} recurso @param {Record<string, unknown>} [filtros]
 */
export const montarCaminhoListagemCatalogo = (recurso, filtros = {}) => {
  const params = new URLSearchParams();
  if (filtros.ativo === true || filtros.ativo === false) params.set('ativo', String(filtros.ativo));
  const natureza = texto(filtros.natureza);
  if (natureza) params.set('natureza', natureza);
  const familia = texto(filtros.familia_id);
  if (familia) params.set('familia_id', familia);
  paginacao(params, filtros);
  return comQuery(caminhoDoCatalogo(recurso), params);
};

/** @param {Record<string, unknown>} [filtros] */
export const montarCaminhoListagemBens = (filtros = {}) => {
  const params = new URLSearchParams();
  const empresa = texto(filtros.empresa_id);
  if (empresa) params.set('empresa_id', empresa);
  if (filtros.ativo === true || filtros.ativo === false) params.set('ativo', String(filtros.ativo));
  for (const chave of ['familia_id', 'tipo_id', 'natureza']) {
    const valor = texto(filtros[chave]);
    if (valor) params.set(chave, valor);
  }
  paginacao(params, filtros);
  return comQuery(CAMINHO_BENS, params);
};

/** @param {string} recurso @param {Record<string, unknown>} [filtros] */
export const montarCaminhoOpcoes = (recurso, filtros = {}) => {
  const params = new URLSearchParams();
  const empresa = texto(filtros.empresa_id);
  if (empresa) params.set('empresa_id', empresa);
  const familia = texto(filtros.familia_id);
  if (familia) params.set('familia_id', familia);
  paginacao(params, filtros);
  return comQuery(`${CAMINHO_OPCOES}/${encodeURIComponent(recurso)}`, params);
};

/** @param {string} recurso @param {string} id */
const doCatalogo = (recurso, id) => `${caminhoDoCatalogo(recurso)}/${encodeURIComponent(id)}`;
/** @param {string} id */
const doBem = (id) => `${CAMINHO_BENS}/${encodeURIComponent(id)}`;
/** Vínculos de um tipo de combustível: `/patrimonio-combustiveis/:id/produtos`. @param {string} tipoId */
const produtosDoCombustivel = (tipoId) => `${doCatalogo('combustiveis', tipoId)}/produtos`;
/** @param {string} vinculoId */
const doVinculo = (vinculoId) => `${CAMINHO_VINCULO_COMBUSTIVEL_PRODUTO}/${encodeURIComponent(vinculoId)}`;

/**
 * Vínculos do tipo NA empresa (keyset): `empresa_id`, `ativo`, `limit`, `cursor`.
 * @param {string} tipoId @param {Record<string, unknown>} [filtros]
 */
export const montarCaminhoProdutosDoCombustivel = (tipoId, filtros = {}) => {
  const params = new URLSearchParams();
  const empresa = texto(filtros.empresa_id);
  if (empresa) params.set('empresa_id', empresa);
  if (filtros.ativo === true || filtros.ativo === false) params.set('ativo', String(filtros.ativo));
  if (filtros.limit != null) params.set('limit', String(filtros.limit));
  if (typeof filtros.cursor === 'string' && filtros.cursor) params.set('cursor', filtros.cursor);
  return comQuery(produtosDoCombustivel(tipoId), params);
};

/**
 * Opções de produto ATIVO da empresa para vincular: `empresa_id`, `q`, `limit`, `cursor`.
 * @param {Record<string, unknown>} [filtros]
 */
export const montarCaminhoOpcoesProdutosCombustivel = (filtros = {}) => {
  const params = new URLSearchParams();
  const empresa = texto(filtros.empresa_id);
  if (empresa) params.set('empresa_id', empresa);
  paginacao(params, filtros);
  return comQuery(CAMINHO_OPCOES_PRODUTOS_COMBUSTIVEL, params);
};

/**
 * Produtos elegíveis de um bem (contrato de leitura da P1-02): `empresa_id` e `tanque_id` opcional.
 * @param {string} bemId @param {Record<string, unknown>} [filtros]
 */
export const montarCaminhoProdutosElegiveisDoBem = (bemId, filtros = {}) => {
  const params = new URLSearchParams();
  const empresa = texto(filtros.empresa_id);
  if (empresa) params.set('empresa_id', empresa);
  const tanque = texto(filtros.tanque_id);
  if (tanque) params.set('tanque_id', tanque);
  return comQuery(`${doBem(bemId)}/produtos-elegiveis`, params);
};
/** @param {string} caminho @param {string} empresaId */
const comEmpresa = (caminho, empresaId) => `${caminho}?${new URLSearchParams({ empresa_id: String(empresaId) }).toString()}`;

// ─── Abastecimentos (D-PROD-159) ─────────────────────────────────────────
/**
 * Abastecimentos da EMPRESA e fatores kg/L (Patrimônio P1-02). Prefixo próprio
 * (`/patrimonio-abastecimentos…`, `/patrimonio-conversoes-combustivel`); as
 * opções da tela são rotas DESTA tela (`/patrimonio-abastecimentos-opcoes/<recurso>`),
 * montadas por template — nenhuma rota é a da porta de Produtos ou de Locais.
 * Decimais (litros, leitura, fator) viajam como TEXTO canônico.
 */
const CAMINHO_ABASTECIMENTOS = '/patrimonio-abastecimentos';
const CAMINHO_ABASTECIMENTOS_PREVIA = '/patrimonio-abastecimentos-previa';
const CAMINHO_ABASTECIMENTOS_OPCOES = '/patrimonio-abastecimentos-opcoes';
const CAMINHO_ABASTECIMENTOS_CONSUMO = '/patrimonio-abastecimentos-consumo';
const CAMINHO_CONVERSOES = '/patrimonio-conversoes-combustivel';
const RESOURCE_ABASTECIMENTO = 'AbastecimentoBem';
const RESOURCE_CONVERSAO = 'ConversaoCombustivelProduto';

/** Prévia/confirmar/cancelar mexem em lotes e movimentos: prazo próprio (o servidor responde em ≤ 19 s). */
export const TIMEOUT_COMANDO_ABASTECIMENTO_MS = 60000;
/** Recursos de opção da tela Abastecimentos (guardados pela própria tela). */
/** `produtos-do-bem` (A16, D-PROD-160): os Produtos que o operador escolhe para o bem, com o tipo e os tanques do servidor. */
export const RECURSOS_OPCOES_ABASTECIMENTO = Object.freeze(['bens', 'tanques', 'tipos', 'produtos', 'produtos-filtro', 'locais', 'produtos-do-bem']);

/** Filtros aceitos por recurso (query FECHADA no servidor: nada além disso vai). */
const FILTROS_LISTA_ABASTECIMENTOS = Object.freeze(['empresa_id', 'bem_id', 'tanque_id', 'produto_id', 'status', 'data_de', 'data_ate', 'operation_id', 'q', 'limit', 'cursor']);
const FILTROS_OPCOES_ABASTECIMENTO = Object.freeze(/** @type {Record<string, readonly string[]>} */ ({
  bens: ['empresa_id', 'uso', 'q', 'limit', 'cursor'],
  tanques: ['empresa_id', 'bem_id'],
  tipos: ['empresa_id', 'q', 'limit', 'cursor'],
  produtos: ['empresa_id', 'tipo_combustivel_id', 'q', 'limit', 'cursor'],
  'produtos-filtro': ['empresa_id', 'q', 'limit', 'cursor'],
  locais: ['empresa_id', 'produto_id'],
  'produtos-do-bem': ['empresa_id', 'bem_id', 'q', 'limit', 'cursor'],
}));
const FILTROS_CONSUMO = Object.freeze(['empresa_id', 'bem_id', 'tanque_id', 'limit']);
const FILTROS_CONVERSOES = Object.freeze(['empresa_id', 'tipo_combustivel_id', 'produto_id', 'situacao', 'limit', 'cursor']);

/**
 * Caminho com só as chaves permitidas, sem vazio (texto aparado; número como texto).
 * @param {string} caminho @param {readonly string[]} permitidas @param {Record<string, unknown>} filtros
 */
const comFiltros = (caminho, permitidas, filtros) => {
  const params = new URLSearchParams();
  for (const chave of permitidas) {
    const valor = filtros[chave];
    if (valor === undefined || valor === null) continue;
    const textoValor = typeof valor === 'string' ? valor.trim() : String(valor);
    if (textoValor) params.set(chave, textoValor);
  }
  return comQuery(caminho, params);
};

/** @param {Record<string, unknown>} [filtros] */
export const montarCaminhoListagemAbastecimentos = (filtros = {}) => comFiltros(CAMINHO_ABASTECIMENTOS, FILTROS_LISTA_ABASTECIMENTOS, filtros);
/** @param {string} recurso @param {Record<string, unknown>} [filtros] */
export const montarCaminhoOpcoesAbastecimento = (recurso, filtros = {}) =>
  comFiltros(`${CAMINHO_ABASTECIMENTOS_OPCOES}/${encodeURIComponent(recurso)}`, FILTROS_OPCOES_ABASTECIMENTO[recurso] ?? [], filtros);
/** @param {Record<string, unknown>} [filtros] */
export const montarCaminhoConsumoAbastecimento = (filtros = {}) => comFiltros(CAMINHO_ABASTECIMENTOS_CONSUMO, FILTROS_CONSUMO, filtros);
/** @param {Record<string, unknown>} [filtros] */
export const montarCaminhoConversoes = (filtros = {}) => comFiltros(CAMINHO_CONVERSOES, FILTROS_CONVERSOES, filtros);
/** @param {string} id */
const doAbastecimento = (id) => `${CAMINHO_ABASTECIMENTOS}/${encodeURIComponent(id)}`;
/** @param {string} id */
const daConversao = (id) => `${CAMINHO_CONVERSOES}/${encodeURIComponent(id)}`;

export const operacoesNativas = Object.freeze({
  /** @param {string} recurso @param {Record<string, unknown>} [filtros] */
  catalogoListPage: (recurso, filtros = {}) =>
    nativeRequest(montarCaminhoListagemCatalogo(recurso, filtros), { autenticado: true }, ctx('listPatrimonioCatalogoPage', recursoDoCatalogo(recurso))),
  /** @param {string} recurso @param {string} id */
  catalogoGet: (recurso, id) => nativeRequest(doCatalogo(recurso, id), { autenticado: true }, ctx('getPatrimonioCatalogo', recursoDoCatalogo(recurso), { id })),
  /** @param {string} recurso @param {Record<string, unknown>} corpo */
  catalogoCreate: (recurso, corpo) =>
    nativeRequest(caminhoDoCatalogo(recurso), { method: 'POST', body: corpo, autenticado: true }, ctx('createPatrimonioCatalogo', recursoDoCatalogo(recurso))),
  /** @param {string} recurso @param {string} id @param {Record<string, unknown>} corpo */
  catalogoUpdate: (recurso, id, corpo) =>
    nativeRequest(doCatalogo(recurso, id), { method: 'PATCH', body: corpo, autenticado: true }, ctx('updatePatrimonioCatalogo', recursoDoCatalogo(recurso), { id })),
  catalogoPadrao: () =>
    nativeRequest(CAMINHO_CATALOGO_PADRAO, { method: 'POST', body: {}, autenticado: true }, ctx('instalarPatrimonioCatalogoPadrao', 'PatrimonioCatalogoPadrao')),
  /** @param {Record<string, unknown>} [filtros] */
  bensListPage: (filtros = {}) => nativeRequest(montarCaminhoListagemBens(filtros), { autenticado: true }, ctx('listBensPatrimoniaisPage', RESOURCE_BEM)),
  /** @param {string} id @param {string} empresaId */
  bemGet: (id, empresaId) => nativeRequest(comEmpresa(doBem(id), empresaId), { autenticado: true }, ctx('getBemPatrimonial', RESOURCE_BEM, { id })),
  /** @param {Record<string, unknown>} corpo */
  bemCreate: (corpo) => nativeRequest(CAMINHO_BENS, { method: 'POST', body: corpo, autenticado: true }, ctx('createBemPatrimonial', RESOURCE_BEM)),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  bemUpdate: (id, corpo) => nativeRequest(doBem(id), { method: 'PATCH', body: corpo, autenticado: true }, ctx('updateBemPatrimonial', RESOURCE_BEM, { id })),
  /** @param {Record<string, unknown>} corpo */
  previaDepreciacao: (corpo) =>
    nativeRequest(CAMINHO_PREVIA, { method: 'POST', body: corpo, autenticado: true }, ctx('previaDepreciacaoBemPatrimonial', RESOURCE_BEM)),
  /** @param {string} recurso @param {Record<string, unknown>} [filtros] */
  opcoes: (recurso, filtros = {}) =>
    nativeRequest(montarCaminhoOpcoes(recurso, filtros), { autenticado: true }, ctx('listOpcoesBemPatrimonial', RESOURCE_BEM, { recurso })),
  /** @param {string} bemId @param {Record<string, unknown>} [filtros] */
  bemProdutosElegiveis: (bemId, filtros = {}) =>
    nativeRequest(montarCaminhoProdutosElegiveisDoBem(bemId, filtros), { autenticado: true }, ctx('listProdutosElegiveisBemPatrimonial', RESOURCE_BEM, { id: bemId })),
  /** @param {string} tipoId @param {Record<string, unknown>} [filtros] */
  combustivelProdutosListPage: (tipoId, filtros = {}) =>
    nativeRequest(montarCaminhoProdutosDoCombustivel(tipoId, filtros), { autenticado: true }, ctx('listProdutosDoCombustivelPage', RESOURCE_VINCULO, { tipo_combustivel_id: tipoId })),
  /** @param {string} tipoId @param {Record<string, unknown>} corpo */
  combustivelProdutoCreate: (tipoId, corpo) =>
    nativeRequest(produtosDoCombustivel(tipoId), { method: 'POST', body: corpo, autenticado: true }, ctx('createVinculoCombustivelProduto', RESOURCE_VINCULO, { tipo_combustivel_id: tipoId })),
  /** @param {string} vinculoId @param {Record<string, unknown>} corpo */
  combustivelProdutoUpdate: (vinculoId, corpo) =>
    nativeRequest(doVinculo(vinculoId), { method: 'PATCH', body: corpo, autenticado: true }, ctx('updateVinculoCombustivelProduto', RESOURCE_VINCULO, { id: vinculoId })),
  /** @param {Record<string, unknown>} [filtros] */
  combustivelProdutoOpcoes: (filtros = {}) =>
    nativeRequest(montarCaminhoOpcoesProdutosCombustivel(filtros), { autenticado: true }, ctx('listOpcoesProdutosCombustivel', RESOURCE_VINCULO)),
  // ─── Abastecimentos (D-PROD-159) ───
  /** @param {Record<string, unknown>} [filtros] */
  abastecimentosListPage: (filtros = {}) =>
    nativeRequest(montarCaminhoListagemAbastecimentos(filtros), { autenticado: true }, ctx('listAbastecimentosPage', RESOURCE_ABASTECIMENTO)),
  /** @param {string} id @param {string} empresaId */
  abastecimentoGet: (id, empresaId) =>
    nativeRequest(comEmpresa(doAbastecimento(id), empresaId), { autenticado: true }, ctx('getAbastecimento', RESOURCE_ABASTECIMENTO, { id })),
  /** @param {Record<string, unknown>} corpo */
  abastecimentoPrevia: (corpo) =>
    nativeRequest(
      CAMINHO_ABASTECIMENTOS_PREVIA,
      { method: 'POST', body: corpo, autenticado: true, timeoutMs: TIMEOUT_COMANDO_ABASTECIMENTO_MS },
      ctx('previaAbastecimento', RESOURCE_ABASTECIMENTO),
    ),
  /** @param {Record<string, unknown>} corpo */
  abastecimentoConfirmar: (corpo) =>
    nativeRequest(
      CAMINHO_ABASTECIMENTOS,
      { method: 'POST', body: corpo, autenticado: true, timeoutMs: TIMEOUT_COMANDO_ABASTECIMENTO_MS },
      ctx('confirmarAbastecimento', RESOURCE_ABASTECIMENTO),
    ),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  abastecimentoCancelar: (id, corpo) =>
    nativeRequest(
      `${doAbastecimento(id)}/cancelar`,
      { method: 'POST', body: corpo, autenticado: true, timeoutMs: TIMEOUT_COMANDO_ABASTECIMENTO_MS },
      ctx('cancelarAbastecimento', RESOURCE_ABASTECIMENTO, { id }),
    ),
  /** @param {string} recurso @param {Record<string, unknown>} [filtros] */
  abastecimentoOpcoes: (recurso, filtros = {}) =>
    nativeRequest(montarCaminhoOpcoesAbastecimento(recurso, filtros), { autenticado: true }, ctx('listOpcoesAbastecimento', RESOURCE_ABASTECIMENTO, { recurso })),
  /** @param {Record<string, unknown>} [filtros] */
  abastecimentoConsumo: (filtros = {}) =>
    nativeRequest(montarCaminhoConsumoAbastecimento(filtros), { autenticado: true }, ctx('getConsumoAbastecimento', RESOURCE_ABASTECIMENTO)),
  /** @param {Record<string, unknown>} [filtros] */
  conversoesListPage: (filtros = {}) =>
    nativeRequest(montarCaminhoConversoes(filtros), { autenticado: true }, ctx('listConversoesCombustivelPage', RESOURCE_CONVERSAO)),
  /** @param {Record<string, unknown>} corpo */
  conversaoCriar: (corpo) =>
    nativeRequest(CAMINHO_CONVERSOES, { method: 'POST', body: corpo, autenticado: true }, ctx('createConversaoCombustivel', RESOURCE_CONVERSAO)),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  conversaoEncerrar: (id, corpo) =>
    nativeRequest(`${daConversao(id)}/encerrar`, { method: 'POST', body: corpo, autenticado: true }, ctx('encerrarConversaoCombustivel', RESOURCE_CONVERSAO, { id })),
});
