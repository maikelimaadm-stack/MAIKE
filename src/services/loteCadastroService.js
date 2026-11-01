/**
 * Service do cadastro de lotes (P1.3, D-PROD-18).
 *
 * Substitui `src/core/repositories/loteRepository.js`, removido nesta slice.
 * O repositório antigo era um objeto único que falava direto com o SDK e
 * misturava leitura de lote com persistência de layout configurável. O cadastro
 * usa apenas campos fixos do schema `Lote`; campos personalizados via `Layout*`
 * saíram do produto (D-PROD-30).
 *
 * O manejo (movimentação, morte, abate, pesagem) **não** está aqui: vive em
 * `loteManejoService`, criado na P1.2, e é reutilizado (QLT-P13-03).
 */

import { comEstadoEsperado } from '@/domain/lotes/movimentacaoLote';
import {
  listLotes,
  createLote,
  updateLote,
  deleteLote,
  consultarElegibilidadeExclusaoLote,
  excluirLoteOnline,
  removerLoteDosCachesOffline,
  temPendenciaOfflineLote,
  listMovimentacoes,
  listMovimentacoesPecuarias,
  listTodasMovimentacoes,
  listFornecedores,
  listCategoriasManejo,
  sincronizarReferenciasLote,
  listSuplementacaoLotes,
} from '@/apis/lotes';
import { listAreas } from '@/apis/mapa';
import { listLancamentos } from '@/apis/tarefas';
import { listManejosTecnicos } from '@/apis/rebanho';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import { assertExclusaoPermitida } from './deleteGuardService';
import { updateMapaCachedData } from './mapaCacheService';
import { ehLoteDerivadoDeManejo, motivoDeHistoricoDoLote } from '@/domain/lotes/saldoLote';
import { TIPOS_EXCLUSAO, mensagemDoMotivoExclusao } from '@/domain/lotes/exclusaoLote';

/**
 * Origens geradas pelo próprio sistema.
 *
 * Um lote com essas origens nasceu de um manejo (movimentação, nascimento,
 * mudança de categoria) e não de um cadastro manual. A tela de cadastro os
 * esconde por padrão. Lista preservada do repositório removido.
 */
/** Valores aceitos por POST /lotes (schema Fastify). */
const MOTIVOS_ENTRADA_CANONICOS = Object.freeze(['Compra', 'Ajuste', 'Inventário', 'Outros']);

/**
 * Autocomplete legado enviava ids em maiúsculas; o backend exige enum exato.
 * @param {unknown} valor
 * @returns {string|undefined}
 */
export const normalizarMotivoEntrada = (valor) => {
  if (valor === undefined || valor === null) return undefined;
  const bruto = String(valor).trim();
  if (!bruto) return undefined;
  if (MOTIVOS_ENTRADA_CANONICOS.includes(bruto)) return bruto;
  const chave = bruto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  const mapa = Object.freeze({
    COMPRA: 'Compra',
    AJUSTE: 'Ajuste',
    INVENTARIO: 'Inventário',
    OUTROS: 'Outros',
  });
  return mapa[chave];
};

export const ORIGENS_SISTEMA = Object.freeze([
  'MOVIMENTAÇÃO',
  'REVERSÃO MOVIMENTAÇÃO',
  'Nascimento',
  'Mudança de Categoria',
  'NASCIMENTO',
  'MUDANÇA DE CATEGORIA',
]);

/**
 * @param {any[]} items
 * @param {string} [empresaId]
 * @returns {any[]}
 */
const daEmpresa = (items, empresaId) =>
  empresaId ? items.filter((item) => item.empresa_id === empresaId) : items;

// ── Leitura ───────────────────────────────────────────────────────────────

/**
 * Lotes da empresa.
 *
 * @param {{empresaId?: string, incluirSistema?: boolean}} [opcoes]
 * @returns {Promise<any[]>}
 */
export const listarLotes = async ({ empresaId, incluirSistema = true } = {}) => {
  const todos = await listLotes();
  return daEmpresa(todos, empresaId).filter(
    (lote) => incluirSistema || !ORIGENS_SISTEMA.includes(lote.origem)
  );
};

/** @returns {Promise<object|null>} */
export const buscarLotePorId = async (id) => {
  const todos = await listLotes();
  return todos.find((lote) => lote.id === id) || null;
};

/** @returns {Promise<any[]>} */
export const listarAreasAtivas = async (empresaId) => {
  const todas = await listAreas();
  return daEmpresa(todas, empresaId).filter((area) => area.ativo !== false);
};

/**
 * Ids de lotes que já têm movimentação — usados para bloquear exclusão na UI.
 * @returns {Promise<string[]>}
 */
export const listarIdsDeLotesComMovimentacao = async (empresaId) => {
  const [pecuarias, doMapa] = await Promise.all([
    listMovimentacoesPecuarias(),
    listTodasMovimentacoes(),
  ]);
  const ids = [...daEmpresa(pecuarias, empresaId), ...daEmpresa(doMapa, empresaId)]
    .filter((mov) => mov.lote_id)
    .map((mov) => mov.lote_id);
  return [...new Set(ids)];
};

/**
 * Ids de lotes da empresa citados por QUALQUER registro que bloqueia excluir
 * (movimentação do mapa, movimentação pecuária, suplementação, tarefa, manejo
 * técnico). Usado para travar editar/excluir no Cadastro (D-PROD-87).
 * @param {string} [empresaId]
 * @returns {Promise<Set<string>>}
 */
export const listarIdsDeLotesComRegistros = async (empresaId) => {
  const listas = await Promise.all(Object.values(CARREGADORES_DE_DEPENDENCIA).map((carregar) => carregar()));
  const ids = listas
    .flatMap((lista) => daEmpresa(Array.isArray(lista) ? lista : [], empresaId))
    .map((registro) => registro?.lote_id)
    .filter(Boolean)
    .map(String);
  return new Set(ids);
};

/** @returns {Promise<any[]>} */
export const listarCategoriasManejoAtivas = async (empresaId) => {
  const todas = await listCategoriasManejo();
  return daEmpresa(todas, empresaId).filter((categoria) => categoria.ativo !== false);
};

/** @returns {Promise<any[]>} */
export const listarFornecedores = async (empresaId) => {
  const todos = await listFornecedores();
  return daEmpresa(todos, empresaId);
};

// ── Escrita ───────────────────────────────────────────────────────────────

/**
 * @param {object} dados
 * @param {{empresaId?: string}} [opcoes]
 */
export const criarLote = async (dados, { empresaId } = {}) => {
  const motivo =
    normalizarMotivoEntrada(dados.motivo_entrada) ?? dados.motivo_entrada ?? 'Inventário';
  return createLote({
    ...dados,
    empresa_id: empresaId || dados.empresa_id,
    motivo_entrada: motivo,
    status: dados.status || 'Ativo',
    campos_personalizados: dados.campos_personalizados || {},
  });
};

/**
 * Atualiza o lote e sincroniza as referências denormalizadas.
 *
 * A sincronização acontece **depois** da atualização e usa capacidade nomeada,
 * não `invoke(nomeQualquer)`.
 */
/**
 * @param {string} id
 * @param {object} dados
 * @param {{registroAnterior?: object}} [opcoes]
 */
export const atualizarLote = async (id, dados, { registroAnterior } = {}) => {
  // R2A-R1 (D-PROD-99a): saldo/posição vão com o estado lido no formulário.
  const corpo = registroAnterior ? comEstadoEsperado(registroAnterior, dados) : dados;
  const atualizado = await updateLote(id, {
    ...corpo,
    campos_personalizados: dados.campos_personalizados || {},
  });
  await sincronizarReferenciasLote({ registro: atualizado, registroAnterior });
  return atualizado;
};

export const excluirLote = async (id) => deleteLote(id);

/**
 * O lote pode ser excluído?
 *
 * Usa a tabela provider-agnostic da P1.2 com carregadores explícitos por
 * dependência. Bloqueio vira `LOTE_DELETE_BLOCKED` — a UI trata por código e
 * nunca lê texto de erro.
 */
const CARREGADORES_DE_DEPENDENCIA = Object.freeze({
  MovimentacaoMapa: () => listMovimentacoes(),
  MovimentacaoPecuaria: () => listMovimentacoesPecuarias(),
  SuplementacaoLote: () => listSuplementacaoLotes(),
  LancamentoTarefa: () => listLancamentos(),
  ManejoTecnicoRebanho: () => listManejosTecnicos(),
});

/**
 * Elegibilidade de exclusão vinda do SERVIDOR (MAIKE-LOTES-R1). Lança
 * `LOTE_DELETE_BLOCKED` quando bloqueado (contrato anterior desta função).
 * @param {string} id
 */
export const validarExclusaoDeLote = async (id) => {
  const r = /** @type {any} */ (await consultarElegibilidadeExclusaoLote(id));
  if (r?.tipo === TIPOS_EXCLUSAO.BLOQUEADO) {
    throw new ApiError(API_ERROR_CODES.LOTE_DELETE_BLOCKED, {
      operation: 'validarExclusaoDeLote',
      resource: 'Lote',
      details: { id, motivo: r.motivo ?? null, mensagem: mensagemDoMotivoExclusao(r.motivo) },
    });
  }
  return r;
};

/**
 * Elegibilidade de vários lotes (para a confirmação). Só leitura.
 * @param {string[]} ids
 * @returns {Promise<Array<{id: string, tipo: string|null, motivo: string|null, erro?: unknown}>>}
 */
export const consultarExclusaoDeLotes = async (ids) => {
  const saida = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    try {
      const r = /** @type {any} */ (await consultarElegibilidadeExclusaoLote(id));
      saida.push({ id, tipo: r?.tipo ?? null, motivo: r?.motivo ?? null });
    } catch (erro) {
      saida.push({ id, tipo: null, motivo: null, erro });
    }
  }
  return saida;
};

const estaOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/**
 * Exclusão em lote com resultado por item (Motor Base1) — MAIKE-LOTES-R1.
 *
 * Sem pré-bloqueio por listas da tela: cada DELETE vai direto ao servidor
 * (nunca à fila offline), que trava o lote, reavalia e decide entre exclusão
 * física, lógica (histórico só cancelado) ou recusa com motivo. Offline: nada
 * é enviado nem enfileirado.
 * @param {string[]} ids
 * @param {{ lotes?: object[] }} [_opcoes]
 */
export const excluirLotes = async (ids, { lotes = [] } = {}) => {
  const listaIds = Array.isArray(ids) ? ids : [];
  /** @type {string[]} */
  const excluidos = [];
  /** @type {Array<{ id: string, code?: string, motivo?: string|null, erro?: unknown }>} */
  const bloqueados = [];

  if (!estaOnline()) {
    for (const id of listaIds) bloqueados.push({ id, code: API_ERROR_CODES.PROVIDER_UNAVAILABLE, motivo: 'offline' });
    return { excluidos, bloqueados };
  }

  for (const id of listaIds) {
    // Alteração deste lote feita sem conexão ainda na fila: excluir agora
    // faria o replay bater num lote que não existe mais (ou a descartaria em
    // silêncio). Recusa explícita; nada é enviado (PR167-R1).
    if (await temPendenciaOfflineLote(id).catch(() => true)) {
      bloqueados.push({ id, code: API_ERROR_CODES.LOTE_DELETE_BLOCKED, motivo: 'pendencia_offline' });
      continue;
    }
    try {
      await excluirLoteOnline(id);
      excluidos.push(id);
    } catch (erro) {
      const causa = /** @type {any} */ (erro)?.cause;
      bloqueados.push({
        id,
        code: causa?.code ?? /** @type {{ code?: string }} */ (erro)?.code ?? API_ERROR_CODES.OPERATION_FAILED,
        motivo: causa?.details?.motivo ?? null,
        erro,
      });
    }
  }

  // Só depois de resposta DEFINITIVA (204): o lote sai do cache offline da
  // entidade (todas as fazendas do tenant) e do cache do mapa da fazenda dele.
  // Falha aqui não desfaz a exclusão; a próxima leitura online corrige.
  for (const id of excluidos) {
    try {
      await removerLoteDosCachesOffline(id);
    } catch {
      /* cache é conveniência; a exclusão já foi confirmada */
    }
    const empresaId = /** @type {any} */ ((lotes || []).find((l) => /** @type {any} */ (l)?.id === id))?.empresa_id;
    if (empresaId) {
      try {
        await updateMapaCachedData('lotes', empresaId, (items) => (items || []).filter((l) => l?.id !== id));
      } catch {
        /* idem */
      }
    }
  }

  return { excluidos, bloqueados };
};
