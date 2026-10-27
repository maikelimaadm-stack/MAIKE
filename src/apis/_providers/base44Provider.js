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
import { createNormalizedEntityAdapter } from '@/lib/textNormalization';
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
  'SuplementacaoEvento',
  'SuplementacaoLote',
  'MovimentacaoMapa',
  'AplicacaoMedicamento',
  'EventoSanitario',
  'ManejoTecnicoRebanho',
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
 * `allowedBase44Entities` (`P11-API-BOUNDARY-SCOPE`). A P1.4 fechou o registry
 * **igual** ao manifesto, com 35 entidades.
 *
 * Desde a P4.1 a relação é de **inclusão, não igualdade**: 29 entidades aqui
 * para 35 no manifesto. `Setor` (D-PROD-25), `AreaPastagem` (D-PROD-31), a
 * tríade P4.3 (`ConfiguracaoIcone`, `PontoReferencia`, `LinhaGeografica`,
 * D-PROD-32) e `Marca` (D-PROD-43) migraram para persistência nativa e saíram
 * daqui, mas continuam no
 * manifesto
 * porque a function `syncEntityReferences` ainda os cita. A diferença é o
 * número de capacidades já migradas — declaradas em `MIGRADAS_PARA_NATIVO`
 * (`tests/smoke/suporteBoundary.test.js`).
 */
const ENTITY_REGISTRY = Object.freeze({
  // Geografia do mapa (P1.2)
  // `AreaPastagem` saiu na P4.2 (D-PROD-31): a persistência é nativa, e a porta
  // é `src/apis/areas/areaPastagemNativePort.js`. O schema continua em
  // `base44/entities/AreaPastagem.jsonc` e o nome continua em
  // `allowedBase44Entities` porque `syncEntityReferences` ainda o cita — a
  // function roda lá e ainda serve os outros cinco destinos denormalizados.
  // Sair do manifesto antes disso reprovaria `gate:product-scope` por uma
  // independência que ainda não existe. Ver DBT-32.
  // `PontoReferencia`, `LinhaGeografica` e `ConfiguracaoIcone` saíram na P4.3
  // (D-PROD-32): persistência nativa em `src/apis/mapaGeografia/`.
  // `PontoSuplementacao` saiu na P5.4 (D-PROD-50): `pontoSuplementacaoNativePort.js`.
  // `Setor` saiu na P4.1 (D-PROD-25): a persistência é nativa, e a porta é
  // `src/apis/setores/setorNativePort.js`. O schema continua em
  // `base44/entities/Setor.jsonc` e o nome continua em `allowedBase44Entities`
  // porque `syncEntityReferences` — a function que propaga o nome do setor para
  // os campos denormalizados da geografia — ainda roda lá e ainda o cita. Sair
  // do manifesto antes dos destinos migrarem reprovaria `gate:product-scope`
  // por uma independência que ainda não existe.
  // `Bebedouro` (cadastro) saiu na P5.4: `bebedouroNativePort.js`. Histórico/sanidade
  // permanecem abaixo.

  // Lotes e manejo iniciado pelo mapa (P1.2)
  // `Lote` saiu na P5.1 (D-PROD-47): persistência nativa em `loteNativePort.js`.
  MovimentacaoMapa: comFronteira('MovimentacaoMapa', base44.entities.MovimentacaoMapa),
  MovimentacaoPecuaria: comFronteira('MovimentacaoPecuaria', base44.entities.MovimentacaoPecuaria),
  SuplementacaoEvento: comFronteira('SuplementacaoEvento', base44.entities.SuplementacaoEvento),
  SuplementacaoLote: comFronteira('SuplementacaoLote', base44.entities.SuplementacaoLote),

  // Estoque: `EstoqueLoteNota` e `MovimentacaoEstoque` nativos na P5.4 (D-PROD-50).

  // Tarefas georreferenciadas (P1.2)
  // LancamentoTarefa e HistoricoLancamentoTarefa migraram na P5.3 (D-PROD-49):
  // portas em lancamentoTarefaNativePort.js e historicoLancamentoTarefaNativePort.js.
  // TipoTarefa e GrupoAtividade migraram na P5.0 (D-PROD-45).

  // Sessão: `Permissao` nativa na P5.4 (`permissaoNativePort.js`).
  User: comFronteira('User', base44.entities.User),

  // Histórico sanitário lido pelo cache offline do mapa (P1.2)
  AplicacaoMedicamento: comFronteira('AplicacaoMedicamento', base44.entities.AplicacaoMedicamento),
  EventoSanitario: comFronteira('EventoSanitario', base44.entities.EventoSanitario),
  ManejoTecnicoRebanho: comFronteira('ManejoTecnicoRebanho', base44.entities.ManejoTecnicoRebanho),

  // Cadastros do manejo (P1.3)
  // `CategoriaManejo` e `Fornecedor` nativos na P5.4.

  // Anexos de registro — hoje só o Lote consome (P1.3)
  RegistroAnexo: comFronteira('RegistroAnexo', base44.entities.RegistroAnexo),

  // Bebedouros (P1.3)
  BebedouroHistorico: comFronteira('BebedouroHistorico', base44.entities.BebedouroHistorico),
  BebedouroSanidade: comFronteira('BebedouroSanidade', base44.entities.BebedouroSanidade),
  BebedouroAlerta: comFronteira('BebedouroAlerta', base44.entities.BebedouroAlerta),

  // Cadastros de suporte (P1.4)
  // `Marca` saiu na P4.4-Marcas (D-PROD-42): persistência nativa em
  // `src/apis/marcas/marcaNativePort.js`. O schema continua em
  // `base44/entities/Marca.jsonc` e o nome continua em `allowedBase44Entities`
  // enquanto `Produto` referenciar marca na Base44.
  // `UnidadeMedida` saiu na P4.5 (D-PROD-44): `unidadeMedidaNativePort.js`.
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

// `empresaProvider` removido na P5.4 (D-PROD-50): Empresa é nativa em
// `src/apis/empresa/empresaNativePort.js`.

// ── Geografia do mapa (P1.2) ──────────────────────────────────────────────
// Um objeto por agregado, com as operações que existem de verdade. Nenhum
// `entityName`, nenhuma operação especulativa (QLT-P12-03).

/** Reservado: geografia nativa migrou; pontos de suplementação na P5.4. */
export const mapaProvider = Object.freeze({});

// ── Lotes e manejo (P1.2, reutilizável pela P1.3 — QLT-P12-01) ────────────

export const lotesProvider = Object.freeze({
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

// `estoqueProvider` removido na P5.4: movimentações e lotes-nota nativos.

// ── Sessão e permissão (P1.2) ─────────────────────────────────────────────
// Autenticação do aplicativo é nativa (P4.0). Este bloco cobre só cadastros
// legados (`User`, `Permissao`) e configurações públicas do app na Base44.

const capacidadesDeSessao = Object.freeze({
  updateMe: false,
});

export const sessionProvider = Object.freeze({
  /** Função, não propriedade: entrega **dado**, nunca uma referência interna. */
  capacidades: () => ({ ...capacidadesDeSessao }),

  listUsuarios: (ordenacao, limite) => endpointOf('User').list(ordenacao, limite),

  // P1.4 — perfil legado `User` (usuários nativos vivem em `@/apis/usuarios`)
  updateUsuario: (id, dados) => endpointOf('User').update(id, dados),

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

// `setoresProvider` foi REMOVIDO na P4.1 (D-PROD-25). Setor é nativo: a porta
// é `src/apis/setores/setorNativePort.js`, e não existe adapter da Base44 para
// esta entidade — nem para leitura, nem para escrita, nem como fallback.

// `categoriasProvider` removido na P5.2 (D-PROD-48): Categoria é nativa em
// `src/apis/categorias/categoriaNativePort.js`.

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
  listHistorico: (ordenacao) => endpointOf('BebedouroHistorico').list(ordenacao),
  createHistorico: (dados) => endpointOf('BebedouroHistorico').create(dados),
  deleteHistorico: (id) => endpointOf('BebedouroHistorico').delete(id),
  listSanidade: (ordenacao) => endpointOf('BebedouroSanidade').list(ordenacao),
  createSanidade: (dados) => endpointOf('BebedouroSanidade').create(dados),
  listAlertas: (ordenacao) => endpointOf('BebedouroAlerta').list(ordenacao),
});


// ── Suporte e administração (P1.4) ────────────────────────────────────────

// `produtosProvider` removido na P5.2 (D-PROD-48): Produto é nativo em
// `src/apis/produtos/produtoNativePort.js`.

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

  listProdutos: async (ordenacao) => {
    const { listProdutos } = await import('@/apis/produtos');
    return listProdutos(ordenacao);
  },
  updateProduto: async (id, dados) => {
    const { updateProduto } = await import('@/apis/produtos');
    return updateProduto(id, dados);
  },

  listMovimentacoesPecuarias: (ordenacao) => endpointOf('MovimentacaoPecuaria').list(ordenacao),
});
