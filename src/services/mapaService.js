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
  renumerarAreas as renumerarAreasApi,
  createPonto,
  updatePonto,
  deletePonto,
  createPontoSuplementacao,
  updatePontoSuplementacao,
  deletePontoSuplementacao,
  createLinha,
  updateLinha,
} from '@/apis/mapa';
import {
  listLotes,
  listTodasMovimentacoes,
  listHistoricoMovimentacoesPagina,
  listMovimentacoesPecuarias,
  listSuplementacaoEventos,
} from '@/apis/lotes';
import { listLancamentos } from '@/apis/tarefas';
import { listManejosTecnicos } from '@/apis/rebanho';
import { listLocais } from '@/apis/estoque';
import { consultarElegibilidadeExclusaoPontoSuplementacao } from '@/apis/pontos-suplementacao';
import { consultarElegibilidadeExclusaoBebedouro } from '@/apis/bebedouros';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import { evaluateDeleteBlock, dependenciesOf } from '@/domain/deleteRules';
import { resolverSuplementacaoDoPonto, bebedourosDoPonto } from '@/domain/mapa/ligacaoPontoReferencia';

/**
 * @param {any[]} items
 * @param {string} empresaId
 * @returns {any[]}
 */
const daEmpresa = (items, empresaId) => items.filter((item) => item.empresa_id === empresaId);
/**
 * Ícones são configuração do TENANT: `empresa_id` nulo vale para todas as
 * empresas (o Gerenciador de Ícones grava sem empresa). Um ícone com empresa
 * continua restrito a ela.
 * @param {any[]} items
 * @param {string} empresaId
 * @returns {any[]}
 */
const daEmpresaOuDoTenant = (items, empresaId) =>
  items.filter((item) => item.empresa_id == null || item.empresa_id === empresaId);
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
/** Reatribui `numero_area` de várias áreas numa operação só no servidor (somente online). */
export const renumerarAreas = (itens) => renumerarAreasApi(itens);
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
  // Consulta FILTRADA pela área no servidor (origem, destino ou área do evento),
  // sem o teto das 500 movimentações mais recentes do tenant: movimentação
  // antiga também segura a área. Sem empresa conhecida, lista sem teto.
  MovimentacaoMapa: async ({ id, empresaId }) => {
    if (!empresaId) return listTodasMovimentacoes();
    const pagina = await listHistoricoMovimentacoesPagina({ empresaId, areaId: id, limit: 1 });
    return Array.isArray(pagina?.items) ? pagina.items : [];
  },
  MovimentacaoPecuaria: () => listMovimentacoesPecuarias(),
  SuplementacaoEvento: () => listSuplementacaoEventos(),
  PontoSuplementacao: () => listPontosSuplementacao(),
  LancamentoTarefa: () => listLancamentos(),
  ManejoTecnicoRebanho: () => listManejosTecnicos(),
  // Só bebedouros ATIVOS seguram a área: o inativado pela troca de tipo do
  // ponto some das telas e não teria onde ser corrigido.
  Bebedouro: async () => (await listBebedouros()).filter((b) => b.ativo !== false),
};

/**
 * Exclusão lógica de área, com a mesma regra de bloqueio de antes.
 *
 * @throws {ApiError} `MAPA_DELETE_BLOCKED` quando há registro vinculado
 */
export const excluirArea = async (id, empresaId) => {
  const areas = await listAreas();
  const areaAtual = areas.find((item) => item.id === id) || null;
  const escopo = { id, empresaId: areaAtual?.empresa_id ?? empresaId ?? null };

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
      return [entidade, await carregar(escopo)];
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
 * Exclui um ponto de referência e o cocho/depósito/bebedouro ligado a ele.
 *
 * Ligação: `@/domain/mapa/ligacaoPontoReferencia` (fonte única) — cocho/depósito
 * pela mesma empresa + categoria compatível com o tipo do ponto + nome
 * (coordenadas desempatam); bebedouro só por `ponto_referencia_id`.
 *
 * Ordem (nada é apagado antes de tudo ser conferido):
 *  1. resolve a ligação; ambígua → `MAPA_DELETE_BLOCKED`, nada muda;
 *  2. pergunta ao servidor se o cocho/depósito e o bebedouro podem sair
 *     (leituras, lançamentos, movimentações, saldo, histórico, sanidade);
 *     algum com histórico → `MAPA_DELETE_BLOCKED`, nada muda;
 *  3. exclui o cocho/depósito — o servidor desvincula os cochos do depósito e
 *     inativa o LocalEstoque dele (D-PROD-137), na mesma transação, e recusa
 *     de novo se aparecer histórico;
 *  4. exclui o ponto de referência — o servidor exclui junto o bebedouro
 *     ligado sem histórico e só desliga (mantém inativo, com o histórico) o
 *     bebedouro INATIVO que tem histórico, na mesma transação.
 * Falha no passo 4 depois do 3 → `MAPA_PARTIAL_OPERATION` (a tela não diz
 * "excluído" quando não foi).
 *
 * @returns {Promise<{pontoId: string, pontosSuplementacaoRemovidos: number, bebedourosRemovidos: number}>}
 */
export const excluirPontoComCascata = async (pontoId, empresaId, pontoConhecido = null) => {
  const ponto = pontoConhecido || (await listPontos()).find((item) => item.id === pontoId) || null;
  const empresa = ponto?.empresa_id ?? empresaId ?? null;
  const pontoComEmpresa = ponto ? { ...ponto, id: pontoId, empresa_id: empresa } : null;

  const [todosSupl, todosBebedouros] = await Promise.all([listPontosSuplementacao(), listBebedouros()]);
  const ativosDaEmpresa = todosSupl.filter((item) => item.empresa_id === empresa && item.status === 'Ativo');
  const ligacao = resolverSuplementacaoDoPonto(pontoComEmpresa, ativosDaEmpresa);
  if (ligacao.ambiguo) {
    throw new ApiError(API_ERROR_CODES.MAPA_DELETE_BLOCKED, {
      operation: 'excluirPontoComCascata',
      resource: 'PontoReferencia',
      details: { id: pontoId, motivo: 'ligacao_ambigua', candidatos: ligacao.candidatos.map((c) => c.id) },
    });
  }
  const suplementacao = ligacao.registro;
  const bebedouros = bebedourosDoPonto({ id: pontoId }, todosBebedouros);

  const bloqueios = [];
  if (suplementacao) {
    const r = await consultarElegibilidadeExclusaoPontoSuplementacao(suplementacao.id);
    if (!r.pode_excluir) bloqueios.push({ recurso: 'PontoSuplementacao', id: suplementacao.id, motivos: r.motivos });
  }
  // Bebedouro INATIVO (o ponto deixou de ser bebedouro) não segura o ponto: o
  // servidor o apaga se não tiver histórico, ou só o desliga do ponto, mantendo
  // o histórico. Bebedouro ATIVO com histórico bloqueia.
  for (const bebedouro of bebedouros.filter((b) => b.ativo !== false)) {
    const r = await consultarElegibilidadeExclusaoBebedouro(bebedouro.id);
    if (!r.pode_excluir) bloqueios.push({ recurso: 'Bebedouro', id: bebedouro.id, motivos: r.motivos });
  }
  if (bloqueios.length) {
    throw new ApiError(API_ERROR_CODES.MAPA_DELETE_BLOCKED, {
      operation: 'excluirPontoComCascata',
      resource: 'PontoReferencia',
      details: { id: pontoId, motivo: 'historico', bloqueios },
    });
  }

  if (suplementacao) await deletePontoSuplementacao(suplementacao.id);

  try {
    await deletePonto(pontoId);
  } catch (erro) {
    if (!suplementacao) throw erro;
    throw new ApiError(API_ERROR_CODES.MAPA_PARTIAL_OPERATION, {
      operation: 'excluirPontoComCascata',
      resource: 'PontoReferencia',
      details: { id: pontoId, etapas: ['ponto_suplementacao'] },
      cause: erro,
    });
  }

  return {
    pontoId,
    pontosSuplementacaoRemovidos: suplementacao ? 1 : 0,
    bebedourosRemovidos: bebedouros.length,
  };
};

// ── Troca de tipo e desfazer criação (formulário e cadastro em lote) ─────

/**
 * Confere no servidor se o cocho/depósito pode sair (troca de tipo do ponto).
 * @throws {ApiError} `MAPA_DELETE_BLOCKED` com `details.motivos` quando tem histórico
 */
export const verificarRemocaoSuplementacao = async (suplementacao) => {
  const r = await consultarElegibilidadeExclusaoPontoSuplementacao(suplementacao.id);
  if (!r.pode_excluir) {
    throw new ApiError(API_ERROR_CODES.MAPA_DELETE_BLOCKED, {
      operation: 'verificarRemocaoSuplementacao',
      resource: 'PontoSuplementacao',
      details: { id: suplementacao.id, motivo: 'historico', motivos: r.motivos },
    });
  }
};

/**
 * Remove o cocho/depósito sem histórico. O servidor recusa de novo se houver
 * histórico, desvincula os cochos do depósito e inativa o local (D-PROD-137).
 */
export const removerPontoSuplementacao = (id) => deletePontoSuplementacao(id);

/**
 * Desfaz, no melhor esforço, um ponto recém-criado cujo cocho/depósito ou
 * bebedouro não pôde ser gravado — para não deixar `PontoReferencia` órfão.
 * O servidor exclui junto o bebedouro ligado ao ponto e aceita o DELETE de quem
 * só tem "novo" quando é a própria criação recente (desfazer). O local do
 * depósito novo nasce na mesma transação do depósito, então não há local a desfazer.
 *
 * @param {{ pontoId?: string|null }} p
 * @returns {Promise<boolean>} `true` quando tudo o que foi criado saiu
 */
export const desfazerCriacaoDePonto = async ({ pontoId = null }) => {
  if (!pontoId) return true;
  try {
    await deletePonto(pontoId);
    return true;
  } catch {
    return false;
  }
};

/** Ícones ativos de um tipo de entidade. Configuração global. */
export const listarIconesPorTipoEntidade = async (tipoEntidade) => {
  const todos = await listIcones();
  // `null` significa "todos os ícones", sem recorte por tipo.
  return tipoEntidade == null ? todos : ativos(todos).filter((item) => item.tipo_entidade === tipoEntidade);
};

/**
 * Ícones ativos válidos para a empresa: os do tenant (`empresa_id` nulo, que é
 * como o Gerenciador de Ícones grava) e os da própria empresa.
 */
export const listarIconesDaEmpresa = async (empresaId) =>
  ativos(daEmpresaOuDoTenant(await listIcones(), empresaId));

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
