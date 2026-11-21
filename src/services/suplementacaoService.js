/**
 * Service de suplementação (P1.4).
 *
 * Recebeu o I/O que estava em `consumoUtils.jsx` (fechamento e reabertura de
 * período) e as leituras que o formulário de lançamento fazia direto no
 * provider — ponto atualizado, áreas, lotes, último evento, produtos, depósito,
 * lotes de nota e movimentações pecuárias.
 *
 * A aritmética continua pura em `consumoUtils` e em `timeWeightedAllocation`.
 */

import {
  listEventos,
  filterEventos,
  updateEvento,
  listLotesSuplementacao,
  updateLoteSuplementacao,
  listProdutos,
  listLotesRebanho,
  listMovimentacoesPecuarias,
  listAreas,
  listPontosSuplementacao,
  listLotesNota,
} from '@/apis/suplementacao';
import {
  calcularConsumo,
  calcularConsumoLotesPonderadoPorTempo,
  calcularFechamentoDePeriodo,
  PATCH_REABERTURA_EVENTO,
  PATCH_REABERTURA_LOTE,
} from '@/components/utils/consumoUtils';
import { comandoLancamentoComLotes } from '@/apis/suplementacao-eventos';
import { listarPosicoesRebanhoServidor } from '@/apis/lotes';
import { listFormulacoesOpcoesLancamento } from '@/apis/formulacoes';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import { getMapaCachedData } from '@/services/mapaCacheService';
import { calcularNivelCocho } from '@/domain/suplementacao/nivelSuplementacao';
import { somarDias } from '@/lib/diaCivil';

const novaOperationId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const exigirConexaoParaComando = () => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, {
      operation: 'registrarLancamento',
      resource: 'Suplementacao',
      details: { motivo: 'offline_comando_composto', mensagem: 'Lançamento requer conexão para confirmar.' },
    });
  }
};

/**
 * @param {Array<any>} registros
 * @param {string} empresaId
 * @returns {Array<any>}
 */
const daEmpresa = (registros, empresaId) => registros.filter((item) => item.empresa_id === empresaId);

// ── Leituras do formulário de lançamento ──────────────────────────────────

/** Ponto de suplementação recarregado do provider, para pegar o estado atual. */
export const carregarPontoAtualizado = async (pontoId) => {
  const pontos = await listPontosSuplementacao();
  return pontos.find((ponto) => ponto.id === pontoId) || null;
};

export const listarPontosDaEmpresa = async (empresaId) => daEmpresa(await listPontosSuplementacao(), empresaId);
export const listarAreasDaEmpresa = async (empresaId) => daEmpresa(await listAreas(), empresaId);
export const listarLotesDaEmpresa = async (empresaId) => daEmpresa(await listLotesRebanho(), empresaId);

/**
 * D-PROD-201 — rebanho ATIVO da empresa para o lançamento de suplementação, da
 * MESMA fonte do mapa (D-PROD-107): empresa no ledger → as POSIÇÕES (cabeças
 * atuais por área, com `projecao_peso`); legado → os Lotes ativos. Antes o
 * formulário lia o cadastro de Lote, que no ledger é só o cadastro de entrada
 * (cabeças e área desatualizados). Erro na consulta propaga: nunca cai para o
 * Lote como saldo numa empresa ativada.
 * @param {string} empresaId
 */
export const listarRebanhoParaSuplementacao = async (empresaId) => {
  const ledger = /** @type {{ativo?: boolean, itens?: any[]}} */ (await listarPosicoesRebanhoServidor(empresaId));
  if (ledger?.ativo) return (Array.isArray(ledger.itens) ? ledger.itens : []).filter((p) => p?.status === 'Ativo');
  return (await listarLotesDaEmpresa(empresaId)).filter((l) => l?.status === 'Ativo');
};
export const listarProdutosDaEmpresa = async (empresaId) => daEmpresa(await listProdutos(), empresaId);
/**
 * D-PROD-203 — formulações ATIVAS da fazenda para o lançamento (obrigatório
 * escolher uma): produto que vai ao cocho, %PV padrão e regras por Categoria de
 * Manejo. Rota própria, também liberada a quem só lança suplementação no mapa.
 * @param {string} empresaId
 */
export const listarFormulacoesParaLancamento = async (empresaId) => listFormulacoesOpcoesLancamento(empresaId);
export const listarLotesNotaDaEmpresa = async (empresaId) => daEmpresa(await listLotesNota(), empresaId);
export const listarMovimentacoesPecuariasDaEmpresa = async (empresaId) =>
  daEmpresa(await listMovimentacoesPecuarias(), empresaId);

/** Eventos de um ponto, do mais recente para o mais antigo. */
export const listarEventosDoPonto = async ({ empresaId, pontoId, limit }) => {
  const eventos = await filterEventos(
    { empresa_id: empresaId, ponto_suplementacao_id: pontoId },
    { order: '-data_lancamento', limit }
  );
  return eventos;
};

/** Último evento aberto de um ponto, ou `null`. */
export const ultimoEventoDoPonto = async ({ empresaId, pontoId }) => {
  const eventos = await listarEventosDoPonto({ empresaId, pontoId, limit: 1 });
  return eventos[0] || null;
};

export const listarEventosDaEmpresa = async (empresaId) => {
  const eventos = await listEventos({ order: '-data_lancamento' });
  return daEmpresa(eventos, empresaId);
};

// ── Escrita do lançamento ─────────────────────────────────────────────────

/**
 * Cria evento + lotes rateados em comando transacional único (ESTAB-P0-01).
 *
 * D-PROD-268: `eventoAnteriorId` é o último lançamento ATIVO do cocho que a tela viu (null:
 * nenhum). O servidor recusa com 409 `LANCAMENTO_DESATUALIZADO` quando o cocho mudou (um
 * lançamento foi cancelado ou registrado em outra tela); `undefined` não envia (abas antigas).
 * @param {{ evento: Record<string, unknown>, lotes?: Array<Record<string, unknown>>, operationId?: string, eventoAnteriorId?: string|null }} params
 */
export const registrarLancamento = async ({ evento, lotes, operationId, eventoAnteriorId }) => {
  exigirConexaoParaComando();
  const resposta = await comandoLancamentoComLotes({
    operation_id: operationId || novaOperationId(),
    evento,
    lotes: Array.isArray(lotes) ? lotes : [],
    ...(eventoAnteriorId !== undefined ? { evento_anterior_id: eventoAnteriorId ?? null } : {}),
  });
  return resposta.evento;
};

/**
 * D-PROD-268 — campos de QUEM fechou o período, conferidos pelo servidor no PATCH de fechamento:
 * o lançamento seguinte do cocho (`{ tipo: 'lancamento', eventoId }`) ou a movimentação do gado
 * (`{ tipo: 'movimentacao_gado' }`). Sem `fechadoPor`, nada é acrescentado.
 * @param {{ tipo: 'lancamento' | 'movimentacao_gado', eventoId?: string } | null | undefined} fechadoPor
 */
const camposFechadoPor = (fechadoPor) => {
  if (!fechadoPor) return {};
  if (fechadoPor.tipo === 'lancamento') return { fechado_por_tipo: 'lancamento', fechado_por_evento_id: String(fechadoPor.eventoId ?? '') };
  return { fechado_por_tipo: 'movimentacao_gado' };
};

// ── Fechamento e reabertura de período ────────────────────────────────────

/** @param {unknown} v */
const numeroOuNulo = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * D-PROD-206 — faixa de tolerância do farol de consumo. O lançamento novo grava a da formulação
 * (`faixa_tolerancia_percentual`, null = padrão); evento anterior a esta decisão busca a formulação
 * pelo `formulacao_id` (só as ativas aparecem nas opções); sem ela, null (= 15%).
 * @param {any} evento
 */
const faixaDoEvento = async (evento) => {
  if (Object.prototype.hasOwnProperty.call(evento ?? {}, 'faixa_tolerancia_percentual')) return numeroOuNulo(evento.faixa_tolerancia_percentual);
  if (!evento?.formulacao_id || !evento?.empresa_id) return null;
  try {
    const formulacoes = await listFormulacoesOpcoesLancamento(evento.empresa_id);
    const f = (Array.isArray(formulacoes) ? formulacoes : []).find((item) => String(item?.id) === String(evento.formulacao_id));
    return numeroOuNulo(f?.faixa_tolerancia_percentual);
  } catch {
    return null;
  }
};

/**
 * D-PROD-206 — R$/kg da saída de estoque do lançamento. O lançamento novo grava `custo_unitario_kg`;
 * evento anterior busca o movimento (`movimentacao_estoque_id`) no cache do mapa. Sem nada: null.
 * @param {any} evento
 */
const custoDoEvento = async (evento) => {
  const gravado = numeroOuNulo(evento?.custo_unitario_kg);
  if (gravado !== null) return gravado;
  if (!evento?.movimentacao_estoque_id || !evento?.empresa_id) return null;
  try {
    const movimentos = await getMapaCachedData('movimentacaoEstoque', evento.empresa_id);
    const m = (Array.isArray(movimentos) ? movimentos : []).find((item) => String(item?.id) === String(evento.movimentacao_estoque_id));
    return numeroOuNulo(m?.valor_unitario);
  } catch {
    return null;
  }
};

/**
 * D-PROD-206 — o ciclo é de um cocho COMPARTILHADO (os mesmos animais com o mesmo produto em outro
 * cocho)? Mesma regra do nível do cocho (`calcularNivelCocho`, D-PROD-178), no dia do fechamento,
 * com os eventos e os cochos do cache do mapa. Na dúvida (sem cache, erro), não marca.
 * @param {any} evento
 * @param {number} diasPeriodo
 */
const cicloCompartilhadoNoCache = async (evento, diasPeriodo) => {
  try {
    if (!evento?.empresa_id || !evento?.ponto_suplementacao_id || !evento?.data_lancamento) return false;
    const [eventos, pontos] = await Promise.all([
      getMapaCachedData('eventosSuplementacao', evento.empresa_id),
      getMapaCachedData('pontosSuplementacao', evento.empresa_id),
    ]);
    const ponto = (pontos || []).find((p) => String(p?.id) === String(evento.ponto_suplementacao_id));
    if (!ponto) return false;
    const dia = String(evento.data_lancamento).slice(0, 10);
    const hoje = somarDias(dia, Math.max(0, Math.round(Number(diasPeriodo) || 0)));
    if (!hoje) return false;
    const nivel = calcularNivelCocho({ ponto, eventos: eventos || [], hoje, pontos: pontos || [] });
    return nivel?.confiabilidade === 'compartilhada' && String(nivel?.evento?.id) === String(evento.id);
  } catch {
    return false;
  }
};

/**
 * D-PROD-212 — de onde vem o custo da sobra que o período HERDOU: o fechamento
 * anterior do mesmo cocho (o evento fechado mais recente antes deste). Com as
 * camadas que ele gravou (`sobra_final_camadas`), elas; senão, o custo/kg do
 * lançamento dele (gravado ou achado pelo movimento de estoque). Sem anterior,
 * sem rede ou sem custo: `{}` — o cálculo usa o custo do lançamento atual e
 * marca aproximado. Só leitura; erro de leitura não impede o fechamento.
 * @param {any} evento
 * @returns {Promise<{ camadas?: unknown, custoAnteriorKg?: number|null }>}
 */
const sobraHerdadaDoEvento = async (evento) => {
  try {
    if (!evento?.ponto_suplementacao_id || !evento?.data_lancamento) return {};
    const eventos = await listEventos();
    const dia = String(evento.data_lancamento).slice(0, 10);
    const anteriores = (Array.isArray(eventos) ? eventos : []).filter((item) =>
      item && String(item.id) !== String(evento.id)
      && String(item.ponto_suplementacao_id) === String(evento.ponto_suplementacao_id)
      && (!evento.empresa_id || item.empresa_id === evento.empresa_id)
      && item.dias_periodo !== null && item.dias_periodo !== undefined
      && String(item.data_lancamento ?? '').slice(0, 10) <= dia);
    if (anteriores.length === 0) return {};
    const chave = (item) => `${String(item.data_lancamento ?? '').slice(0, 10)}|${String(item.createdAt ?? item.created_date ?? '')}`;
    const anterior = anteriores.reduce((a, b) => (chave(b) > chave(a) ? b : a));
    if (Array.isArray(anterior.sobra_final_camadas) && anterior.sobra_final_camadas.length > 0) {
      return { camadas: anterior.sobra_final_camadas };
    }
    return { custoAnteriorKg: await custoDoEvento(anterior) };
  } catch {
    return {};
  }
};

/** Alocações ponderadas por tempo, com os dados carregados aqui. */
export const calcularAlocacoesDoPeriodo = async ({ evento, diasPeriodo, consumoTotal }) => {
  const [todosLotesSupl, lotesAtivos, movimentacoes] = await Promise.all([
    listLotesSuplementacao(),
    listLotesRebanho(),
    listMovimentacoesPecuarias(),
  ]);

  return calcularConsumoLotesPonderadoPorTempo({
    evento,
    diasPeriodo,
    consumoTotal,
    todosLotesSupl,
    lotesAtivos,
    movimentacoes,
  });
};

/**
 * Calcula o fechamento do período SEM gravar nada (D-PROD-137, SUP-01).
 *
 * Só leituras (lotes do período, lotes, movimentações) e a aritmética pura de
 * `consumoUtils`. Quem fecha o consumo ao MOVER o gado prepara aqui e grava com
 * `aplicarFechamentoPeriodo` só depois de o servidor confirmar a transferência:
 * antes, o fechamento era gravado primeiro e uma transferência recusada,
 * cancelada ou offline deixava o período fechado sem o gado ter saído.
 *
 * @param {object} p
 * @param {any} p.evento
 * @param {number} p.diasPeriodo
 * @param {number} p.sobraFinal
 * @param {number} [p.sobraInicial]
 * @param {boolean|null} [p.sobraInformada] D-PROD-206: a sobra final foi medida? null = não se sabe
 * @param {boolean} [p.compartilhado] D-PROD-206: ciclo de cocho compartilhado; sem ele, confere pelo cache do mapa
 * @param {{ tipo: 'lancamento' | 'movimentacao_gado', eventoId?: string } | null} [p.fechadoPor] D-PROD-268: quem fecha o período
 */
export const prepararFechamentoPeriodo = async ({ evento, diasPeriodo, sobraFinal, sobraInicial, sobraInformada = null, compartilhado, fechadoPor = null }) => {
  const lotesSupl = await listLotesSuplementacao();
  const lotesDoEvento = lotesSupl.filter((lote) => lote.suplementacao_evento_id === evento.id);
  // D-PROD-206: faixa da formulação, custo da saída de estoque e cocho compartilhado — o que o fechamento do
  // consumo precisa e que um evento anterior a esta decisão não traz gravado.
  // D-PROD-212: e o custo da sobra herdada (a sobra antiga sai primeiro no custo do período).
  const [faixaPercentual, custoUnitarioKg, cicloCompartilhado, sobraHerdada] = await Promise.all([
    faixaDoEvento(evento),
    custoDoEvento(evento),
    compartilhado === undefined ? cicloCompartilhadoNoCache(evento, diasPeriodo) : Promise.resolve(Boolean(compartilhado)),
    sobraHerdadaDoEvento(evento),
  ]);

  const metricas = calcularConsumo({
    fornecido: evento.quantidade_total_kg,
    sobraFinal,
    sobraInicial: sobraInicial ?? evento.sobra_kg,
    diasPeriodo,
    totalCabecas: evento.total_cabecas_afetadas,
  });

  const alocacoes = await calcularAlocacoesDoPeriodo({
    evento,
    diasPeriodo,
    consumoTotal: metricas.consumoTotal,
  });

  const fechamento = calcularFechamentoDePeriodo({
    evento,
    diasPeriodo,
    sobraFinal,
    sobraInicial,
    lotesDoEvento,
    alocacoes,
    sobraInformada,
    faixaPercentual,
    custoUnitarioKg,
    compartilhado: cicloCompartilhado,
    sobraHerdada,
  });

  return {
    eventoId: evento.id,
    patchEvento: { ...fechamento.patchEvento, ...camposFechadoPor(fechadoPor) },
    patchesDeLote: fechamento.patchesDeLote,
    consumoTotal: fechamento.consumoTotal,
    consumoDiarioGrupo: fechamento.consumoDiarioGrupo,
    consumoPorCabecaDia: fechamento.consumoPorCabecaDia,
  };
};

/**
 * Grava um fechamento preparado: o evento e depois cada lote do período (a
 * mesma ordem do legado; o `onProgress` marca essa fronteira).
 * @param {Awaited<ReturnType<typeof prepararFechamentoPeriodo>>} preparado
 * @param {{ onProgress?: (mensagem: string) => void }} [opcoes]
 */
export const aplicarFechamentoPeriodo = async (preparado, { onProgress } = {}) => {
  await updateEvento(preparado.eventoId, preparado.patchEvento);
  onProgress?.('Atualizando lotes do período...');
  await Promise.all(preparado.patchesDeLote.map(({ id, patch }) => updateLoteSuplementacao(id, patch)));
};

/**
 * Grava o fechamento preparado só se o período AINDA estiver aberto: entre o
 * preparo (passo do consumo) e a confirmação da transferência, outra pessoa
 * pode ter fechado o mesmo período — não se sobrescreve o fechamento dela.
 * @param {Awaited<ReturnType<typeof prepararFechamentoPeriodo>>} preparado
 * @returns {Promise<{ aplicado: boolean, motivo?: 'ja_fechado' | 'nao_encontrado' }>}
 */
export const aplicarFechamentoSeAindaAberto = async (preparado) => {
  const atual = (await listEventos()).find((evento) => evento.id === preparado.eventoId) || null;
  if (!atual) return { aplicado: false, motivo: 'nao_encontrado' };
  if (atual.dias_periodo !== null && atual.dias_periodo !== undefined) return { aplicado: false, motivo: 'ja_fechado' };
  // D-PROD-268: este caminho é o fechamento pela MOVIMENTAÇÃO DO GADO (`DetalhesLote`): o servidor
  // só aceita fechar o último lançamento ativo do cocho com `fechado_por_tipo: 'movimentacao_gado'`.
  const patchEvento = preparado.patchEvento?.fechado_por_tipo
    ? preparado.patchEvento
    : { ...preparado.patchEvento, ...camposFechadoPor({ tipo: 'movimentacao_gado' }) };
  await aplicarFechamentoPeriodo({ ...preparado, patchEvento });
  return { aplicado: true };
};

/**
 * Fecha o período: calcula e grava o evento e cada lote (lançamento novo no
 * cocho, que fecha o período anterior DEPOIS de gravar o novo).
 *
 * Mesmos valores do legado. Agora todas as leituras vêm antes da primeira
 * escrita: uma falha de leitura não deixa mais o evento fechado e os lotes não.
 *
 * @param {object} p
 * @param {any} p.evento
 * @param {number} p.diasPeriodo
 * @param {number} p.sobraFinal
 * @param {number} [p.sobraInicial]
 * @param {boolean|null} [p.sobraInformada] D-PROD-206: a sobra final foi medida? null = não se sabe
 * @param {boolean} [p.compartilhado] D-PROD-206: ciclo de cocho compartilhado; sem ele, confere pelo cache do mapa
 * @param {string} [p.fechadoPorEventoId] D-PROD-268: o lançamento novo que fecha este período (prova do cancelamento)
 * @param {(mensagem: string) => void} [p.onProgress]
 */
export const fecharPeriodoSuplementacao = async ({ evento, diasPeriodo, sobraFinal, sobraInicial, sobraInformada = null, compartilhado, fechadoPorEventoId, onProgress }) => {
  const fechadoPor = fechadoPorEventoId ? { tipo: /** @type {const} */ ('lancamento'), eventoId: fechadoPorEventoId } : null;
  const preparado = await prepararFechamentoPeriodo({ evento, diasPeriodo, sobraFinal, sobraInicial, sobraInformada, compartilhado, fechadoPor });
  await aplicarFechamentoPeriodo(preparado, { onProgress });
  return {
    consumoTotal: preparado.consumoTotal,
    consumoDiarioGrupo: preparado.consumoDiarioGrupo,
    consumoPorCabecaDia: preparado.consumoPorCabecaDia,
  };
};

/** Reabre um período: remove as métricas do evento e dos lotes. */
export const reabrirPeriodoSuplementacao = async ({ eventoId, lotesSupl }) => {
  await updateEvento(eventoId, { ...PATCH_REABERTURA_EVENTO });

  const lotesDoEvento = (lotesSupl || []).filter((item) => item.suplementacao_evento_id === eventoId);
  for (const lote of lotesDoEvento) {
    await updateLoteSuplementacao(lote.id, { ...PATCH_REABERTURA_LOTE });
  }
};
