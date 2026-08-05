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
import { getDataProviderConfig } from '@/config/runtimeConfig';
import { createNormalizedEntityAdapter, createNormalizedSessionAdapter } from '@/lib/textNormalization';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
  instalarSincronizacaoAoVoltarOnline,
} from '@/lib/offline/offlineEntityRuntime';

/**
 * Entidades com cache e fila offline (P1.4).
 *
 * A mesma lista que o antigo `offlineEntitySync` mantinha, agora aplicada por
 * composição em vez de monkey patch. O catálogo é fechado: entidade fora daqui
 * fala com a rede e ponto.
 */
const OFFLINE_ENTITIES = new Set([
  'LancamentoTarefa', 'HistoricoLancamentoTarefa', 'AreaPastagem', 'PontoReferencia',
  'PontoSuplementacao', 'LinhaGeografica', 'Lote', 'ConfiguracaoIcone',
  'SuplementacaoEvento', 'SuplementacaoLote', 'EstoqueLoteNota', 'MovimentacaoMapa',
  'MovimentacaoEstoque', 'TipoTarefa', 'Fornecedor', 'Produto', 'Permissao', 'Setor',
  'Empresa', 'AplicacaoMedicamento', 'EventoSanitario', 'ManejoTecnicoRebanho',
  'LocalEstoque', 'CategoriaManejo',
]);

/**
 * Compõe a fronteira de uma entidade: normalização de texto e, quando o
 * ambiente tem armazenamento, o runtime offline.
 *
 * A ordem importa. A normalização fica **por dentro** — mais perto da rede —
 * para que o que entra no cache offline já esteja no formato de exibição, igual
 * ao que o patch global produzia. O runtime offline fica por fora, e é ele quem
 * decide se a chamada vai à rede ou ao cache.
 *
 * Sem IndexedDB o adapter offline devolve as operações intactas: o produto
 * continua funcionando online e nada finge persistência que não existe.
 *
 * @param {string} nome nome literal da entidade, só como rótulo
 * @param {object} endpoint endpoint já resolvido
 */
const comFronteira = (nome, endpoint) =>
  createOfflineEntityAdapter({
    entityName: nome,
    operations: createNormalizedEntityAdapter({ entityName: nome, endpoint }),
    enabled: OFFLINE_ENTITIES.has(nome) && offlineStorageDisponivel(),
  });

/**
 * Registro literal das entidades com consumidor migrado.
 *
 * Toda chave aqui precisa existir em `config/mapa-manejo-scope.json` →
 * `allowedBase44Entities` (`P11-API-BOUNDARY-SCOPE`). Desde a P1.4 o registry é
 * **igual** ao manifesto: 38 entidades, nem uma a mais.
 */
const ENTITY_REGISTRY = Object.freeze({
  Empresa: comFronteira('Empresa', base44.entities.Empresa),

  // Geografia do mapa (P1.2)
  AreaPastagem: comFronteira('AreaPastagem', base44.entities.AreaPastagem),
  PontoReferencia: comFronteira('PontoReferencia', base44.entities.PontoReferencia),
  PontoSuplementacao: comFronteira('PontoSuplementacao', base44.entities.PontoSuplementacao),
  LinhaGeografica: comFronteira('LinhaGeografica', base44.entities.LinhaGeografica),
  Setor: comFronteira('Setor', base44.entities.Setor),
  ConfiguracaoIcone: comFronteira('ConfiguracaoIcone', base44.entities.ConfiguracaoIcone),
  Bebedouro: comFronteira('Bebedouro', base44.entities.Bebedouro),

  // Lotes e manejo iniciado pelo mapa (P1.2)
  Lote: comFronteira('Lote', base44.entities.Lote),
  MovimentacaoMapa: comFronteira('MovimentacaoMapa', base44.entities.MovimentacaoMapa),
  MovimentacaoPecuaria: comFronteira('MovimentacaoPecuaria', base44.entities.MovimentacaoPecuaria),
  SuplementacaoEvento: comFronteira('SuplementacaoEvento', base44.entities.SuplementacaoEvento),
  SuplementacaoLote: comFronteira('SuplementacaoLote', base44.entities.SuplementacaoLote),

  // Estoque consumido pelos pontos de suplementação (P1.2)
  LocalEstoque: comFronteira('LocalEstoque', base44.entities.LocalEstoque),
  EstoqueLoteNota: comFronteira('EstoqueLoteNota', base44.entities.EstoqueLoteNota),
  MovimentacaoEstoque: comFronteira('MovimentacaoEstoque', base44.entities.MovimentacaoEstoque),
  Produto: comFronteira('Produto', base44.entities.Produto),

  // Tarefas georreferenciadas (P1.2)
  LancamentoTarefa: comFronteira('LancamentoTarefa', base44.entities.LancamentoTarefa),
  HistoricoLancamentoTarefa: comFronteira('HistoricoLancamentoTarefa', base44.entities.HistoricoLancamentoTarefa),
  TipoTarefa: comFronteira('TipoTarefa', base44.entities.TipoTarefa),
  GrupoAtividade: comFronteira('GrupoAtividade', base44.entities.GrupoAtividade),

  // Sessão e permissão consumidas pelo mapa (P1.2)
  Permissao: comFronteira('Permissao', base44.entities.Permissao),
  User: comFronteira('User', base44.entities.User),

  // Histórico sanitário lido pelo cache offline do mapa (P1.2)
  AplicacaoMedicamento: comFronteira('AplicacaoMedicamento', base44.entities.AplicacaoMedicamento),
  EventoSanitario: comFronteira('EventoSanitario', base44.entities.EventoSanitario),
  ManejoTecnicoRebanho: comFronteira('ManejoTecnicoRebanho', base44.entities.ManejoTecnicoRebanho),

  // Cadastros do manejo (P1.3)
  Categoria: comFronteira('Categoria', base44.entities.Categoria),
  CategoriaManejo: comFronteira('CategoriaManejo', base44.entities.CategoriaManejo),
  Fornecedor: comFronteira('Fornecedor', base44.entities.Fornecedor),

  // Layout configurável do lote (P1.3)
  LayoutConfiguracao: comFronteira('LayoutConfiguracao', base44.entities.LayoutConfiguracao),
  LayoutSecao: comFronteira('LayoutSecao', base44.entities.LayoutSecao),
  LayoutCampo: comFronteira('LayoutCampo', base44.entities.LayoutCampo),

  // Anexos de registro — hoje só o Lote consome (P1.3)
  RegistroAnexo: comFronteira('RegistroAnexo', base44.entities.RegistroAnexo),

  // Bebedouros (P1.3)
  BebedouroHistorico: comFronteira('BebedouroHistorico', base44.entities.BebedouroHistorico),
  BebedouroSanidade: comFronteira('BebedouroSanidade', base44.entities.BebedouroSanidade),
  BebedouroAlerta: comFronteira('BebedouroAlerta', base44.entities.BebedouroAlerta),

  // Cadastros de suporte (P1.4)
  Marca: comFronteira('Marca', base44.entities.Marca),
  UnidadeMedida: comFronteira('UnidadeMedida', base44.entities.UnidadeMedida),
});

// O replay ao voltar online é instalado uma única vez, aqui — o provider é o
// dono do catálogo offline e o único que sabe que ele existe.
instalarSincronizacaoAoVoltarOnline();

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
  listBebedouros: (ordenacao) => endpointOf('Bebedouro').list(ordenacao),

  // Configuração de ícones: leitura pelo mapa, CRUD pelo gerenciador (P1.4).
  // A exclusão é lógica — `ativo: false` —, então não há `delete` aqui.
  listIcones: (ordenacao) => endpointOf('ConfiguracaoIcone').list(ordenacao),
  createIcone: (dados) => endpointOf('ConfiguracaoIcone').create(dados),
  updateIcone: (id, dados) => endpointOf('ConfiguracaoIcone').update(id, dados),
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

  // Movimentação e lote de nota completos, consumidos pela suplementação (P1.4)
  createMovimentacao: (dados) => endpointOf('MovimentacaoEstoque').create(dados),
  deleteMovimentacao: (id) => endpointOf('MovimentacaoEstoque').delete(id),
  createLoteNota: (dados) => endpointOf('EstoqueLoteNota').create(dados),
  deleteLoteNota: (id) => endpointOf('EstoqueLoteNota').delete(id),
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

  // Cadastro de grupos e tipos (P1.4)
  createGrupo: (dados) => endpointOf('GrupoAtividade').create(dados),
  updateGrupo: (id, dados) => endpointOf('GrupoAtividade').update(id, dados),
  deleteGrupo: (id) => endpointOf('GrupoAtividade').delete(id),
  createTipo: (dados) => endpointOf('TipoTarefa').create(dados),
  updateTipo: (id, dados) => endpointOf('TipoTarefa').update(id, dados),
  deleteTipo: (id) => endpointOf('TipoTarefa').delete(id),
});

// ── Sessão e permissão (P1.2) ─────────────────────────────────────────────
// `me()` é a única porta para o usuário atual. O provider não conhece
// `localStorage` — a política de fallback offline vive no service (seção 10).

const authNormalizada = createNormalizedSessionAdapter({
  me: base44.auth?.me ? () => base44.auth.me() : undefined,
  updateMe: base44.auth?.updateMe ? (dados) => base44.auth.updateMe(dados) : undefined,
});

/**
 * Capacidades de autenticação que o provider atual realmente oferece (P1.4).
 *
 * `logout` e `redirectToLogin` são do SDK, não do produto: um provider futuro
 * pode não ter nenhum dos dois. Em vez de chamar e torcer, o service pergunta —
 * e quando a capacidade não existe o produto degrada de forma previsível em vez
 * de estourar `undefined is not a function` no meio do logout.
 */
const capacidadesDeSessao = Object.freeze({
  logout: typeof base44.auth?.logout === 'function',
  redirectToLogin: typeof base44.auth?.redirectToLogin === 'function',
  updateMe: typeof base44.auth?.updateMe === 'function',
});

export const sessionProvider = Object.freeze({
  /** Função, não propriedade: entrega **dado**, nunca uma referência interna. */
  capacidades: () => ({ ...capacidadesDeSessao }),

  me: () => authNormalizada.me(),
  listUsuarios: (ordenacao, limite) => endpointOf('User').list(ordenacao, limite),
  listPermissoes: (ordenacao) => endpointOf('Permissao').list(ordenacao),

  // P1.4 — administração de usuários e permissões
  updateUsuario: (id, dados) => endpointOf('User').update(id, dados),
  createPermissao: (dados) => endpointOf('Permissao').create(dados),
  updatePermissao: (id, dados) => endpointOf('Permissao').update(id, dados),
  deletePermissao: (id) => endpointOf('Permissao').delete(id),

  logout: (urlDeRetorno) => {
    if (!capacidadesDeSessao.logout) return undefined;
    return urlDeRetorno ? base44.auth.logout(urlDeRetorno) : base44.auth.logout();
  },
  redirectToLogin: (urlDeRetorno) => {
    if (!capacidadesDeSessao.redirectToLogin) return undefined;
    return base44.auth.redirectToLogin(urlDeRetorno);
  },

  /**
   * Configurações públicas do app.
   *
   * `AuthContext` montava esta requisição à mão, com `appId`, `serverUrl` e
   * `Authorization` dentro de um componente React. A URL e o cabeçalho são
   * detalhe do provider — quando a Base44 sair, some com ela.
   */
  fetchPublicSettings: async () => {
    const { appId, serverUrl, token } = getDataProviderConfig();
    const headers = { 'X-App-Id': appId };
    if (token) headers.Authorization = `Bearer ${token}`;

    const resposta = await fetch(
      `${serverUrl}/api/apps/public/prod/public-settings/by-id/${appId}`,
      { headers }
    );

    if (!resposta.ok) {
      const dados = await resposta.json().catch(() => null);
      // `status` e `data` são o contrato que o `AuthContext` usa para separar
      // `auth_required` de `user_not_registered`. Ficam em `Object.assign` para
      // não depender de `Error` aceitar campos arbitrários.
      throw Object.assign(new Error('Failed to load app public settings'), {
        status: resposta.status,
        data: dados,
      });
    }

    return resposta.json();
  },
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


// ── Suporte e administração (P1.4) ────────────────────────────────────────

/** Produto: cadastro completo. A leitura pelo estoque continua em `estoqueProvider`. */
export const produtosProvider = Object.freeze({
  list: (ordenacao) => endpointOf('Produto').list(ordenacao),
  filter: (criterio) => endpointOf('Produto').filter(criterio),
  create: (dados) => endpointOf('Produto').create(dados),
  update: (id, dados) => endpointOf('Produto').update(id, dados),
  delete: (id) => endpointOf('Produto').delete(id),
});

/** Marca de produto, por empresa. */
export const marcasProvider = Object.freeze({
  list: (ordenacao) => endpointOf('Marca').list(ordenacao),
  create: (dados) => endpointOf('Marca').create(dados),
  update: (id, dados) => endpointOf('Marca').update(id, dados),
  delete: (id) => endpointOf('Marca').delete(id),
});

/** Unidade de medida. A sigla é a chave que o Produto referencia. */
export const unidadesMedidaProvider = Object.freeze({
  list: (ordenacao) => endpointOf('UnidadeMedida').list(ordenacao),
  create: (dados) => endpointOf('UnidadeMedida').create(dados),
  update: (id, dados) => endpointOf('UnidadeMedida').update(id, dados),
  delete: (id) => endpointOf('UnidadeMedida').delete(id),
});

/**
 * Suplementação: evento, lote de suplementação e o estoque que eles consomem.
 *
 * Agrupa o que o lançamento, a baixa FIFO e a reversão precisam. As leituras
 * que o mapa já fazia continuam em `lotesProvider` e `estoqueProvider` — este
 * adapter existe para as operações de escrita que só a suplementação usa.
 */
export const suplementacaoProvider = Object.freeze({
  listEventos: (ordenacao) => endpointOf('SuplementacaoEvento').list(ordenacao),
  filterEventos: (criterio, ordenacao, limite) => endpointOf('SuplementacaoEvento').filter(criterio, ordenacao, limite),
  createEvento: (dados) => endpointOf('SuplementacaoEvento').create(dados),
  updateEvento: (id, dados) => endpointOf('SuplementacaoEvento').update(id, dados),
  deleteEvento: (id) => endpointOf('SuplementacaoEvento').delete(id),

  listLotes: (ordenacao, limite) => endpointOf('SuplementacaoLote').list(ordenacao, limite),
  bulkCreateLotes: (registros) => endpointOf('SuplementacaoLote').bulkCreate(registros),
  updateLote: (id, dados) => endpointOf('SuplementacaoLote').update(id, dados),
  deleteLote: (id) => endpointOf('SuplementacaoLote').delete(id),

  listMovimentacoesEstoque: (ordenacao, limite) => endpointOf('MovimentacaoEstoque').list(ordenacao, limite),
  createMovimentacaoEstoque: (dados) => endpointOf('MovimentacaoEstoque').create(dados),
  updateMovimentacaoEstoque: (id, dados) => endpointOf('MovimentacaoEstoque').update(id, dados),
  deleteMovimentacaoEstoque: (id) => endpointOf('MovimentacaoEstoque').delete(id),

  listLotesNota: (ordenacao) => endpointOf('EstoqueLoteNota').list(ordenacao),
  filterLotesNota: (criterio) => endpointOf('EstoqueLoteNota').filter(criterio),
  createLoteNota: (dados) => endpointOf('EstoqueLoteNota').create(dados),
  updateLoteNota: (id, dados) => endpointOf('EstoqueLoteNota').update(id, dados),
  deleteLoteNota: (id) => endpointOf('EstoqueLoteNota').delete(id),

  listProdutos: (ordenacao) => endpointOf('Produto').list(ordenacao),
  updateProduto: (id, dados) => endpointOf('Produto').update(id, dados),

  listLotesRebanho: (ordenacao) => endpointOf('Lote').list(ordenacao),
  listMovimentacoesPecuarias: (ordenacao) => endpointOf('MovimentacaoPecuaria').list(ordenacao),
  listAreas: (ordenacao) => endpointOf('AreaPastagem').list(ordenacao),
  listPontosSuplementacao: (ordenacao) => endpointOf('PontoSuplementacao').list(ordenacao),
});
