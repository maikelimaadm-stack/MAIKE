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

import {
  listLotes,
  createLote,
  updateLote,
  deleteLote,
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
import { API_ERROR_CODES } from '@/apis/_core/ApiError';
import { assertExclusaoPermitida } from './deleteGuardService';

/**
 * Origens geradas pelo próprio sistema.
 *
 * Um lote com essas origens nasceu de um manejo (movimentação, nascimento,
 * mudança de categoria) e não de um cadastro manual. A tela de cadastro os
 * esconde por padrão. Lista preservada do repositório removido.
 */
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
 * Próximo `numero_lote`.
 *
 * **Risco conhecido (R2):** `max + 1` calculado no cliente não é seguro sob
 * concorrência — duas criações simultâneas podem receber o mesmo número. A
 * regra é preservada porque mudá-la exigiria sequência no servidor, que só
 * existe com persistência nativa (P4). Não há lock aqui e não se declara um.
 *
 * @param {any[]} lotes
 * @returns {string}
 */
export const proximoNumeroLote = (lotes) => {
  const maior = (lotes || []).reduce(
    (max, lote) => Math.max(max, parseInt(lote.numero_lote, 10) || 0),
    0
  );
  return String(maior + 1);
};

/**
 * @param {object} dados
 * @param {{empresaId?: string}} [opcoes]
 */
export const criarLote = async (dados, { empresaId } = {}) => {
  const todos = await listLotes();
  return createLote({
    ...dados,
    empresa_id: empresaId || dados.empresa_id,
    numero_lote: dados.numero_lote || proximoNumeroLote(todos),
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
  const atualizado = await updateLote(id, {
    ...dados,
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

export const validarExclusaoDeLote = async (id) => {
  const lote = await buscarLotePorId(id);
  await assertExclusaoPermitida({
    entityName: 'Lote',
    id,
    currentRecord: lote,
    carregadores: CARREGADORES_DE_DEPENDENCIA,
    blockedCode: API_ERROR_CODES.LOTE_DELETE_BLOCKED,
    operation: 'validarExclusaoDeLote',
  });
};
