/**
 * Provider de dados temporário (P1.1, D-PROD-04 + D-PROD-18).
 *
 * **Este é o único arquivo dentro de `src/apis/` autorizado a importar
 * `@/api/base44Client`.** `gate:api-boundary` reprova qualquer outro
 * (`P11-API-BOUNDARY-PROVIDER-LEAK`).
 *
 * Regras que este arquivo materializa:
 *
 *  - o objeto do provider **nunca** é exportado. Não há `export { base44 }`,
 *    `export default base44` nem reexport indireto. O que sai daqui são
 *    funções pequenas, com assinatura própria;
 *  - o acesso a entidade é **literal**. Não existe `entities[nome]` nem
 *    `getEntity(nome)` com nome aberto: o domínio do registry está escrito no
 *    código e é conferível por AST (`P11-API-BOUNDARY-DYNAMIC-ENTITY`);
 *  - o registry cresce **uma entidade por slice**, e só quando existe consumidor
 *    migrado (SCL-P11-02). Na P1.1 havia só `Empresa`; a P1.2 acrescenta as 24
 *    entidades realmente consumidas pelo Mapa, e nada além delas.
 *
 * Quando a Base44 sair em P7, este arquivo é substituído por um provider HTTP.
 * Nenhuma página, componente ou service precisa mudar (QLT-P11-02).
 */

import { base44 } from '@/api/base44Client';

/**
 * Registro literal das entidades com consumidor migrado.
 *
 * Toda chave aqui precisa existir em `config/mapa-manejo-scope.json` →
 * `allowedBase44Entities` (`P11-API-BOUNDARY-SCOPE`).
 */
const ENTITY_REGISTRY = Object.freeze({
  Empresa: base44.entities.Empresa,

  // Geografia do mapa (P1.2)
  AreaPastagem: base44.entities.AreaPastagem,
  PontoReferencia: base44.entities.PontoReferencia,
  PontoSuplementacao: base44.entities.PontoSuplementacao,
  LinhaGeografica: base44.entities.LinhaGeografica,
  Setor: base44.entities.Setor,
  ConfiguracaoIcone: base44.entities.ConfiguracaoIcone,
  Bebedouro: base44.entities.Bebedouro,

  // Lotes e manejo iniciado pelo mapa (P1.2)
  Lote: base44.entities.Lote,
  MovimentacaoMapa: base44.entities.MovimentacaoMapa,
  MovimentacaoPecuaria: base44.entities.MovimentacaoPecuaria,
  SuplementacaoEvento: base44.entities.SuplementacaoEvento,
  SuplementacaoLote: base44.entities.SuplementacaoLote,

  // Estoque consumido pelos pontos de suplementação (P1.2)
  LocalEstoque: base44.entities.LocalEstoque,
  EstoqueLoteNota: base44.entities.EstoqueLoteNota,
  MovimentacaoEstoque: base44.entities.MovimentacaoEstoque,
  Produto: base44.entities.Produto,

  // Tarefas georreferenciadas (P1.2)
  LancamentoTarefa: base44.entities.LancamentoTarefa,
  HistoricoLancamentoTarefa: base44.entities.HistoricoLancamentoTarefa,
  TipoTarefa: base44.entities.TipoTarefa,
  GrupoAtividade: base44.entities.GrupoAtividade,

  // Sessão e permissão consumidas pelo mapa (P1.2)
  Permissao: base44.entities.Permissao,
  User: base44.entities.User,

  // Histórico sanitário lido pelo cache offline do mapa (P1.2)
  AplicacaoMedicamento: base44.entities.AplicacaoMedicamento,
  EventoSanitario: base44.entities.EventoSanitario,
  ManejoTecnicoRebanho: base44.entities.ManejoTecnicoRebanho,

  // Cadastros do manejo (P1.3)
  Categoria: base44.entities.Categoria,
  CategoriaManejo: base44.entities.CategoriaManejo,
  Fornecedor: base44.entities.Fornecedor,

  // Layout configurável do lote (P1.3)
  LayoutConfiguracao: base44.entities.LayoutConfiguracao,
  LayoutSecao: base44.entities.LayoutSecao,
  LayoutCampo: base44.entities.LayoutCampo,

  // Anexos de registro — hoje só o Lote consome (P1.3)
  RegistroAnexo: base44.entities.RegistroAnexo,

  // Bebedouros (P1.3)
  BebedouroHistorico: base44.entities.BebedouroHistorico,
  BebedouroSanidade: base44.entities.BebedouroSanidade,
  BebedouroAlerta: base44.entities.BebedouroAlerta,
});

/** Nomes registrados. Usado por teste e diagnóstico; não expõe o provider. */
export const getRegisteredEntityNames = () => Object.keys(ENTITY_REGISTRY);

/**
 * Endpoint interno de uma entidade registrada.
 *
 * Privado de propósito: não é exportado. Um nome fora do registry é erro de
 * programação, não condição de runtime — por isso lança em vez de devolver nulo.
 */
const endpointOf = (nome) => {
  if (!Object.prototype.hasOwnProperty.call(ENTITY_REGISTRY, nome)) {
    throw new Error(`entidade não registrada no provider: ${nome}`);
  }
  return ENTITY_REGISTRY[nome];
};

/**
 * Adapter da entidade `Empresa`.
 *
 * Só as quatro operações que o produto realmente usa. Sem paginação, cache ou
 * filtro que o provider atual não ofereça (QLT-P11-03).
 */
export const empresaProvider = Object.freeze({
  /**
   * @param {string} ordenacao ex.: `-created_date`
   * @returns {Promise<Array<object>>}
   */
  list: (ordenacao) => endpointOf('Empresa').list(ordenacao),

  /**
   * @param {object} dados
   * @returns {Promise<object>}
   */
  create: (dados) => endpointOf('Empresa').create(dados),

  /**
   * @param {string} id
   * @param {object} dados
   * @returns {Promise<object>}
   */
  update: (id, dados) => endpointOf('Empresa').update(id, dados),

  /**
   * @param {string} id
   * @returns {Promise<unknown>}
   */
  delete: (id) => endpointOf('Empresa').delete(id),
});


// ── Geografia do mapa (P1.2) ──────────────────────────────────────────────
// Um objeto por agregado, com as operações que existem de verdade. Nenhum
// `entityName`, nenhuma operação especulativa (QLT-P12-03).

export const mapaProvider = Object.freeze({
  listAreas: (ordenacao) => endpointOf('AreaPastagem').list(ordenacao),
  filterAreas: (criterio) => endpointOf('AreaPastagem').filter(criterio),
  createArea: (dados) => endpointOf('AreaPastagem').create(dados),
  updateArea: (id, dados) => endpointOf('AreaPastagem').update(id, dados),

  listPontos: (ordenacao) => endpointOf('PontoReferencia').list(ordenacao),
  createPonto: (dados) => endpointOf('PontoReferencia').create(dados),
  updatePonto: (id, dados) => endpointOf('PontoReferencia').update(id, dados),
  deletePonto: (id) => endpointOf('PontoReferencia').delete(id),

  listPontosSuplementacao: (ordenacao) => endpointOf('PontoSuplementacao').list(ordenacao),
  createPontoSuplementacao: (dados) => endpointOf('PontoSuplementacao').create(dados),
  updatePontoSuplementacao: (id, dados) => endpointOf('PontoSuplementacao').update(id, dados),
  deletePontoSuplementacao: (id) => endpointOf('PontoSuplementacao').delete(id),

  listLinhas: (ordenacao) => endpointOf('LinhaGeografica').list(ordenacao),
  createLinha: (dados) => endpointOf('LinhaGeografica').create(dados),
  updateLinha: (id, dados) => endpointOf('LinhaGeografica').update(id, dados),

  listSetores: (ordenacao) => endpointOf('Setor').list(ordenacao),
  listIcones: (ordenacao) => endpointOf('ConfiguracaoIcone').list(ordenacao),
  listBebedouros: (ordenacao) => endpointOf('Bebedouro').list(ordenacao),
});

// ── Lotes e manejo (P1.2, reutilizável pela P1.3 — QLT-P12-01) ────────────

export const lotesProvider = Object.freeze({
  listLotes: (ordenacao) => endpointOf('Lote').list(ordenacao),
  filterLotes: (criterio) => endpointOf('Lote').filter(criterio),
  createLote: (dados) => endpointOf('Lote').create(dados),
  updateLote: (id, dados) => endpointOf('Lote').update(id, dados),
  deleteLote: (id) => endpointOf('Lote').delete(id),
  updateMovimentacao: (id, dados) => endpointOf('MovimentacaoMapa').update(id, dados),

  listMovimentacoes: (ordenacao, limite) => endpointOf('MovimentacaoMapa').list(ordenacao, limite),
  listTodasMovimentacoes: (ordenacao) => endpointOf('MovimentacaoMapa').list(ordenacao),
  filterMovimentacoes: (criterio, ordenacao, limite) => endpointOf('MovimentacaoMapa').filter(criterio, ordenacao, limite),
  createMovimentacao: (dados) => endpointOf('MovimentacaoMapa').create(dados),
  deleteMovimentacao: (id) => endpointOf('MovimentacaoMapa').delete(id),

  /** Só leitura: consumida pela regra de bloqueio de exclusão de área. */
  listMovimentacoesPecuarias: (ordenacao, limite) => endpointOf('MovimentacaoPecuaria').list(ordenacao, limite),

  listSuplementacaoEventos: (ordenacao) => endpointOf('SuplementacaoEvento').list(ordenacao),
  createSuplementacaoEvento: (dados) => endpointOf('SuplementacaoEvento').create(dados),

  listSuplementacaoLotes: (ordenacao, limite) => endpointOf('SuplementacaoLote').list(ordenacao, limite),
  filterSuplementacaoLotes: (criterio, ordenacao, limite) => endpointOf('SuplementacaoLote').filter(criterio, ordenacao, limite),
  bulkCreateSuplementacaoLote: (registros) => endpointOf('SuplementacaoLote').bulkCreate(registros),
});

// ── Estoque consumido pelos pontos de suplementação (P1.2) ────────────────

export const estoqueProvider = Object.freeze({
  listLocais: (ordenacao) => endpointOf('LocalEstoque').list(ordenacao),
  createLocal: (dados) => endpointOf('LocalEstoque').create(dados),
  updateLocal: (id, dados) => endpointOf('LocalEstoque').update(id, dados),
  deleteLocal: (id) => endpointOf('LocalEstoque').delete(id),

  listLotesNota: (ordenacao) => endpointOf('EstoqueLoteNota').list(ordenacao),
  filterLotesNota: (criterio) => endpointOf('EstoqueLoteNota').filter(criterio),
  updateLoteNota: (id, dados) => endpointOf('EstoqueLoteNota').update(id, dados),

  listMovimentacoes: (ordenacao, limite) => endpointOf('MovimentacaoEstoque').list(ordenacao, limite),
  updateMovimentacao: (id, dados) => endpointOf('MovimentacaoEstoque').update(id, dados),

  listProdutos: (ordenacao) => endpointOf('Produto').list(ordenacao),
  filterProdutos: (criterio) => endpointOf('Produto').filter(criterio),
});

// ── Tarefas georreferenciadas (P1.2) ──────────────────────────────────────

export const tarefasProvider = Object.freeze({
  listLancamentos: (ordenacao) => endpointOf('LancamentoTarefa').list(ordenacao),
  createLancamento: (dados) => endpointOf('LancamentoTarefa').create(dados),
  updateLancamento: (id, dados) => endpointOf('LancamentoTarefa').update(id, dados),
  deleteLancamento: (id) => endpointOf('LancamentoTarefa').delete(id),

  listHistorico: (ordenacao, limite) => endpointOf('HistoricoLancamentoTarefa').list(ordenacao, limite),
  createHistorico: (dados) => endpointOf('HistoricoLancamentoTarefa').create(dados),
  deleteHistorico: (id) => endpointOf('HistoricoLancamentoTarefa').delete(id),

  listTipos: (ordenacao) => endpointOf('TipoTarefa').list(ordenacao),
  listGrupos: (ordenacao) => endpointOf('GrupoAtividade').list(ordenacao),
});

// ── Sessão e permissão (P1.2) ─────────────────────────────────────────────
// `me()` é a única porta para o usuário atual. O provider não conhece
// `localStorage` — a política de fallback offline vive no service (seção 10).

export const sessionProvider = Object.freeze({
  me: () => base44.auth.me(),
  listUsuarios: (ordenacao, limite) => endpointOf('User').list(ordenacao, limite),
  listPermissoes: (ordenacao) => endpointOf('Permissao').list(ordenacao),
});

// ── Histórico sanitário lido pelo cache offline (P1.2) ────────────────────

export const rebanhoProvider = Object.freeze({
  listAplicacoesMedicamento: (ordenacao, limite) => endpointOf('AplicacaoMedicamento').list(ordenacao, limite),
  listEventosSanitarios: (ordenacao, limite) => endpointOf('EventoSanitario').list(ordenacao, limite),
  listManejosTecnicos: (ordenacao, limite) => endpointOf('ManejoTecnicoRebanho').list(ordenacao, limite),
});

// ── Upload de anexo de tarefa (P1.2) ──────────────────────────────────────
// Integração, não entidade: fica fora do registry por natureza.

export const arquivosProvider = Object.freeze({
  upload: (payload) => base44.integrations.Core.UploadFile(payload),
});


// ── Cadastros e manejo (P1.3) ─────────────────────────────────────────────

/** Setor: CRUD do cadastro. A leitura do mapa continua em `mapaProvider`. */
export const setoresProvider = Object.freeze({
  list: (ordenacao) => endpointOf('Setor').list(ordenacao),
  create: (dados) => endpointOf('Setor').create(dados),
  update: (id, dados) => endpointOf('Setor').update(id, dados),
  delete: (id) => endpointOf('Setor').delete(id),
});

/** Categoria de produto, hierárquica por `categoria_pai_id`. */
export const categoriasProvider = Object.freeze({
  list: (ordenacao) => endpointOf('Categoria').list(ordenacao),
  create: (dados) => endpointOf('Categoria').create(dados),
  update: (id, dados) => endpointOf('Categoria').update(id, dados),
  delete: (id) => endpointOf('Categoria').delete(id),
});

/** Categoria de manejo do rebanho. */
export const categoriasManejoProvider = Object.freeze({
  list: (ordenacao) => endpointOf('CategoriaManejo').list(ordenacao),
  create: (dados) => endpointOf('CategoriaManejo').create(dados),
  update: (id, dados) => endpointOf('CategoriaManejo').update(id, dados),
  delete: (id) => endpointOf('CategoriaManejo').delete(id),
});

/**
 * Layout configurável do cadastro de lote, mais as entidades que servem de
 * fonte de opções.
 *
 * `listOptionSource` recebe um **nome já validado** contra o catálogo fechado
 * da API (`OPTION_SOURCES`). Não é ponto de entrada para nome arbitrário: quem
 * chama já provou que o nome pertence ao catálogo, e `endpointOf` reprova
 * qualquer coisa fora do registry (QLT-P13-12).
 */
export const loteLayoutProvider = Object.freeze({
  listConfiguracoes: () => endpointOf('LayoutConfiguracao').list(),
  createConfiguracao: (dados) => endpointOf('LayoutConfiguracao').create(dados),
  listSecoes: () => endpointOf('LayoutSecao').list(),
  createSecao: (dados) => endpointOf('LayoutSecao').create(dados),
  listCampos: () => endpointOf('LayoutCampo').list(),
  createCampo: (dados) => endpointOf('LayoutCampo').create(dados),
  updateCampo: (id, dados) => endpointOf('LayoutCampo').update(id, dados),
  deleteCampo: (id) => endpointOf('LayoutCampo').delete(id),
  listOptionSource: (nomeValidado) => endpointOf(nomeValidado).list(),
});

/** Fornecedor — cadastro lido pelo formulário de lote e como fonte de opções. */
export const fornecedoresProvider = Object.freeze({
  list: (ordenacao) => endpointOf('Fornecedor').list(ordenacao),
});

/**
 * Sincronização de referências denormalizadas após renomear um cadastro.
 *
 * A function da Base44 é genérica, mas o adapter **não** é: o nome
 * `syncEntityReferences` é literal aqui e a API pública não aceita nome de
 * função do chamador (QLT-P13-09).
 */
export const referenciasProvider = Object.freeze({
  sincronizar: (payload) => base44.functions.invoke('syncEntityReferences', payload),
});

/** Anexos de registro. Hoje só o Lote consome; a API pública fecha isso. */
export const anexosProvider = Object.freeze({
  filter: (criterio, ordenacao) => endpointOf('RegistroAnexo').filter(criterio, ordenacao),
  create: (dados) => endpointOf('RegistroAnexo').create(dados),
  delete: (id) => endpointOf('RegistroAnexo').delete(id),
});

/** Bebedouros: cadastro, histórico, sanidade e alertas. */
export const bebedourosProvider = Object.freeze({
  listBebedouros: (ordenacao) => endpointOf('Bebedouro').list(ordenacao),
  createBebedouro: (dados) => endpointOf('Bebedouro').create(dados),
  updateBebedouro: (id, dados) => endpointOf('Bebedouro').update(id, dados),
  listHistorico: (ordenacao) => endpointOf('BebedouroHistorico').list(ordenacao),
  createHistorico: (dados) => endpointOf('BebedouroHistorico').create(dados),
  deleteHistorico: (id) => endpointOf('BebedouroHistorico').delete(id),
  listSanidade: (ordenacao) => endpointOf('BebedouroSanidade').list(ordenacao),
  createSanidade: (dados) => endpointOf('BebedouroSanidade').create(dados),
  listAlertas: (ordenacao) => endpointOf('BebedouroAlerta').list(ordenacao),
});
