/**
 * Service da geografia do mapa (P1.2, D-PROD-18).
 *
 * Coordena áreas, pontos, linhas e a cascata de exclusão. Não conhece React,
 * React Query, toast nem provider: fala com `@/apis/mapa` e `@/apis/estoque`.
 */

import {
  listIcones,
  listAreas,
  listPontos,
  listPontosSuplementacao,
  listLinhas,
  listSetores,
  listBebedouros,
  filterAreas as filterAreasApi,
  createArea,
  updateArea,
  createPonto,
  updatePonto,
  deletePonto,
  createPontoSuplementacao,
  updatePontoSuplementacao,
  deletePontoSuplementacao,
  createLinha,
  updateLinha,
} from '@/apis/mapa';
import { listLotes, listMovimentacoes, listMovimentacoesPecuarias, listSuplementacaoEventos } from '@/apis/lotes';
import { listLancamentos } from '@/apis/tarefas';
import { listManejosTecnicos } from '@/apis/rebanho';
import { deleteLocal, listLocais } from '@/apis/estoque';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import { evaluateDeleteBlock, dependenciesOf } from '@/domain/deleteRules';
import { normalizarTexto } from '@/domain/mapa/pontoCascata';

/**
 * @param {any[]} items
 * @param {string} empresaId
 * @returns {any[]}
 */
const daEmpresa = (items, empresaId) => items.filter((item) => item.empresa_id === empresaId);
/**
 * @param {any[]} items
 * @returns {any[]}
 */
const ativos = (items) => items.filter((item) => item.ativo !== false);

// ── Leitura ───────────────────────────────────────────────────────────────

export const listarAreasAtivas = async (empresaId) => ativos(daEmpresa(await listAreas(), empresaId));
export const listarPontosAtivos = async (empresaId) => ativos(daEmpresa(await listPontos(), empresaId));
export const listarLinhasAtivas = async (empresaId) => ativos(daEmpresa(await listLinhas(), empresaId));
export const listarSetoresAtivos = async (empresaId) => ativos(daEmpresa(await listSetores(), empresaId));

export const listarPontosSuplementacaoAtivos = async (empresaId) =>
  daEmpresa(await listPontosSuplementacao(), empresaId).filter((p) => p.status === 'Ativo');

export const listarBebedourosAtivos = async (empresaId) =>
  ativos(daEmpresa(await listBebedouros(), empresaId));

// ── Escrita simples ───────────────────────────────────────────────────────

export const criarArea = (dados) => createArea(dados);
export const atualizarArea = (id, dados) => updateArea(id, dados);
export const criarPonto = (dados) => createPonto(dados);
export const atualizarPonto = (id, dados) => updatePonto(id, dados);
export const criarLinha = (dados) => createLinha(dados);
export const atualizarLinha = (id, dados) => updateLinha(id, dados);
export const criarPontoSuplementacao = (dados) => createPontoSuplementacao(dados);
export const atualizarPontoSuplementacao = (id, dados) => updatePontoSuplementacao(id, dados);

// ── Exclusão de área ──────────────────────────────────────────────────────

/**
 * Carrega os registros das entidades de que a regra depende.
 *
 * Cada dependência tem uma **capacidade explícita**; não existe
 * `entities[nome]` neste caminho. A regra em si continua sendo a mesma tabela
 * de `@/domain/deleteRules`, sem cópia.
 */
const CARREGADORES_DE_DEPENDENCIA = {
  Lote: () => listLotes(),
  MovimentacaoMapa: () => listMovimentacoes(),
  MovimentacaoPecuaria: () => listMovimentacoesPecuarias(),
  SuplementacaoEvento: () => listSuplementacaoEventos(),
  PontoSuplementacao: () => listPontosSuplementacao(),
  LancamentoTarefa: () => listLancamentos(),
  ManejoTecnicoRebanho: () => listManejosTecnicos(),
};

/**
 * Exclusão lógica de área, com a mesma regra de bloqueio de antes.
 *
 * @throws {ApiError} `MAPA_DELETE_BLOCKED` quando há registro vinculado
 */
export const excluirArea = async (id, empresaId) => {
  const areas = await listAreas();
  const areaAtual = areas.find((item) => item.id === id) || null;

  const dependencias = dependenciesOf('AreaPastagem');
  const entidades = [...new Set(dependencias.map((r) => r.entity))];

  const carregadas = await Promise.all(
    entidades.map(async (entidade) => {
      const carregar = CARREGADORES_DE_DEPENDENCIA[entidade];
      // Dependência sem capacidade migrada não pode virar "liberado" silencioso.
      if (!carregar) {
        throw new ApiError(API_ERROR_CODES.OPERATION_FAILED, {
          operation: 'excluirArea',
          resource: 'AreaPastagem',
          details: { dependencia: entidade },
        });
      }
      return [entidade, await carregar()];
    })
  );

  const recordsByEntity = Object.fromEntries(carregadas);
  const veredito = evaluateDeleteBlock({
    entityName: 'AreaPastagem',
    id,
    currentRecord: areaAtual,
    recordsByEntity,
  });

  if (veredito.blocked) {
    throw new ApiError(API_ERROR_CODES.MAPA_DELETE_BLOCKED, {
      operation: 'excluirArea',
      resource: 'AreaPastagem',
      details: { id, vinculo: veredito.label, quantidade: veredito.linkedCount },
    });
  }

  await updateArea(id, { ativo: false });
  return { id, empresaId: empresaId ?? areaAtual?.empresa_id ?? null };
};

// ── Exclusão de linha ─────────────────────────────────────────────────────

/** Exclusão lógica, como antes: `ativo: false`. */
export const excluirLinha = async (id) => {
  await updateLinha(id, { ativo: false });
  return { id };
};

// ── Exclusão de ponto, com cascata ────────────────────────────────────────

/**
 * Exclui um ponto de referência e a cascata vinculada.
 *
 * Ordem preservada da implementação anterior:
 *  1. excluir `PontoReferencia`;
 *  2. localizar `PontoSuplementacao` vinculados pelo nome normalizado;
 *  3. para cada depósito, remover o `LocalEstoque` (tolerando ausência);
 *  4. desvincular cochos que apontavam para o depósito;
 *  5. remover os pontos de suplementação vinculados.
 *
 * **Sem transação.** A Base44 não oferece atomicidade multi-entidade
 * (QLT-P12-06). Se a etapa 1 falhar, nada mais acontece; se falhar depois dela,
 * o resultado é parcial — e isso é reportado, não escondido.
 *
 * @returns {Promise<{pontoId: string, pontosSuplementacaoRemovidos: number,
 *   locaisEstoqueIgnorados: number, cochosDesvinculados: number}>}
 */
export const excluirPontoComCascata = async (pontoId, empresaId, pontoConhecido = null) => {
  const pontos = pontoConhecido ? null : await listPontos();
  const ponto = pontoConhecido || pontos?.find((item) => item.id === pontoId) || null;

  await deletePonto(pontoId);

  const todosSupl = await listPontosSuplementacao();
  const vinculados = todosSupl.filter(
    (item) =>
      item.empresa_id === empresaId &&
      item.status === 'Ativo' &&
      normalizarTexto(item.nome_ponto) === normalizarTexto(ponto?.nome)
  );

  let locaisEstoqueIgnorados = 0;
  let cochosDesvinculados = 0;

  const depositos = vinculados.filter((item) => normalizarTexto(item.categoria_ponto) === 'DEPOSITO');
  for (const deposito of depositos) {
    if (deposito.local_estoque_id) {
      try {
        await deleteLocal(deposito.local_estoque_id);
      } catch {
        // Tolerância deliberada e testada: local já removido não bloqueia a
        // cascata. Contado em vez de virar `console.warn` com erro cru.
        locaisEstoqueIgnorados += 1;
      }
    }

    const cochos = todosSupl.filter(
      (item) => item.empresa_id === empresaId && item.deposito_origem_id === deposito.id
    );
    for (const cocho of cochos) {
      await updatePontoSuplementacao(cocho.id, { deposito_origem_id: null, deposito_origem_nome: null });
      cochosDesvinculados += 1;
    }
  }

  for (const item of vinculados) {
    await deletePontoSuplementacao(item.id);
  }

  return {
    pontoId,
    pontosSuplementacaoRemovidos: vinculados.length,
    locaisEstoqueIgnorados,
    cochosDesvinculados,
  };
};

/** Ícones ativos de um tipo de entidade. Configuração global. */
export const listarIconesPorTipoEntidade = async (tipoEntidade) => {
  const todos = await listIcones();
  // `null` significa "todos os ícones", sem recorte por tipo.
  return tipoEntidade == null ? todos : ativos(todos).filter((item) => item.tipo_entidade === tipoEntidade);
};

/** Ícones ativos da empresa. Alguns consumidores filtram por empresa. */
export const listarIconesDaEmpresa = async (empresaId) => ativos(daEmpresa(await listIcones(), empresaId));

/** Todos os pontos de referência, sem filtro. */
export const listarTodosPontos = () => listPontos();

/** Todos os pontos de suplementação, sem filtro. */
export const listarTodosPontosSuplementacao = () => listPontosSuplementacao();

/** Todos os bebedouros, sem filtro. */
export const listarTodosBebedouros = () => listBebedouros();

/** Todas as áreas, sem filtro de empresa. Preserva a numeração global. */
export const listarTodasAreas = () => listAreas();

/** Ícones ativos. Configuração global: não filtra por empresa. */
export const listarIconesAtivos = async () => ativos(await listIcones());

/** Áreas sem filtro de ativo — usada por telas que mostram histórico. */
export const listarAreasDaEmpresa = async (empresaId) => daEmpresa(await listAreas(), empresaId);

/** Pontos de referência sem filtro de ativo. */
export const listarPontosDaEmpresa = async (empresaId) => daEmpresa(await listPontos(), empresaId);

/** Todas as linhas, sem filtro de empresa. Preserva a numeração global. */
export const listarTodasLinhas = () => listLinhas();

/** Linhas sem filtro de ativo. */
export const listarLinhasDaEmpresa = async (empresaId) => daEmpresa(await listLinhas(), empresaId);

/** Todos os pontos de suplementação da empresa, qualquer status. */
export const listarPontosSuplementacaoDaEmpresa = async (empresaId) =>
  daEmpresa(await listPontosSuplementacao(), empresaId);

/** Áreas por critério explícito — usada pela importação de GeoJSON. */
export const buscarAreasPorCriterio = (criterio) => filterAreasApi(criterio);

export const listarLocaisEstoque = (empresaId) =>
  listLocais().then((locais) => daEmpresa(locais, empresaId));
