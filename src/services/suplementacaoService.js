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
  calcularDiasPeriodo,
} from '@/components/utils/consumoUtils';
import { comandoLancamentoComLotes } from '@/apis/suplementacao-eventos';
import { listarPosicoesRebanhoServidor } from '@/apis/lotes';
import { listFormulacoesOpcoesLancamento } from '@/apis/formulacoes';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import { getMapaCachedData } from '@/services/mapaCacheService';
import { calcularNivelCocho } from '@/domain/suplementacao/nivelSuplementacao';
import { somarDias } from '@/lib/diaCivil';
import { comEstoqueAguardandoEnvio } from '@/services/estoqueAguardandoEnvioService';
import { comandoSaidaSuplementacao } from '@/apis/movimentacoes-estoque';
import {
  registrarTipoDeEnvio,
  enviarOuGuardar,
  alterarNaFila,
  situacaoNaFila,
  descartarDaFila,
  dependentesNaFila,
  registroNaFila,
  referenciaAoResultado,
  classificarFalhaDeEnvio,
} from '@/lib/offline/sincronizacao/motorDeSincronizacao';
import { comLancamentosAguardandoEnvio, lancamentoAguardandoComoEvento } from '@/services/lancamentoCochoAguardandoService';
import { TIPO_LANCAMENTO_COCHO } from '@/lib/offline/sincronizacao/tiposDeEnvio';

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
// D-PROD-296: com o efeito do que foi lançado sem internet e espera envio.
/** @param {string} empresaId @param {{ ignorar?: string|null }} [opcoes] o registro em edição não desconta a si mesmo */
export const listarLotesNotaDaEmpresa = async (empresaId, opcoes = {}) =>
  daEmpresa(await comEstoqueAguardandoEnvio(await listLotesNota(), opcoes), empresaId);
export const listarMovimentacoesPecuariasDaEmpresa = async (empresaId) =>
  daEmpresa(await listMovimentacoesPecuarias(), empresaId);

/** Eventos de um ponto, do mais recente para o mais antigo (D-PROD-296: + os que esperam envio). */
export const listarEventosDoPonto = async ({ empresaId, pontoId, limit }) => {
  const eventos = await filterEventos(
    { empresa_id: empresaId, ponto_suplementacao_id: pontoId },
    { order: '-data_lancamento', limit }
  );
  const todos = await comLancamentosAguardandoEnvio(Array.isArray(eventos) ? eventos : [], empresaId, pontoId);
  return typeof limit === 'number' && limit > 0 ? todos.slice(0, limit) : todos;
};

/** Último evento aberto de um ponto, ou `null`. */
export const ultimoEventoDoPonto = async ({ empresaId, pontoId }) => {
  const eventos = await listarEventosDoPonto({ empresaId, pontoId, limit: 1 });
  return eventos[0] || null;
};

export const listarEventosDaEmpresa = async (empresaId) => {
  const eventos = await listEventos({ order: '-data_lancamento' });
  return comLancamentosAguardandoEnvio(daEmpresa(eventos, empresaId), empresaId);
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

// ── D-PROD-296: lançamento do cocho pelo motor de sincronização ───────────

/** R$/kg da saída de estoque (FIFO) do lançamento; sem saída ou valor inválido → null. @param {any} movimento */
const custoDaSaida = (movimento) => {
  const v = movimento?.valor_unitario;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Os três passos do lançamento, na ordem e seguros para repetir com o MESMO
 * código (o motor reenvia depois de uma queda):
 *  1. a baixa do depósito (`saida-suplementacao`, deduplicada pelo código);
 *  2. o lançamento com os lotes (`lancamento-com-lotes`, deduplicado pelo código);
 *  3. o fechamento do período anterior, calculado AGORA com os dados do
 *     servidor. Só fecha o que está aberto ou que este mesmo lançamento já
 *     fechou (refazer grava os mesmos valores); fechado por outro, não mexe.
 *     Recusa do servidor no fechamento não desfaz o lançamento (como na tela
 *     com internet); falta de rede, sim, faz o motor tentar tudo de novo.
 *
 * Erro nos passos 1–2 sai com `saidaFeita` (a baixa já gravada, se houve) e
 * `mensagemDaFila` (o que fazer, na lista de envio).
 *
 * @param {any} p payload do lançamento
 * @param {{ operationId: string, registrarProgresso?: (progresso: Record<string, unknown>) => Promise<void> }} ctx
 */
const executarLancamentoDoCocho = async (p, { operationId, registrarProgresso }) => {
  let movimentacao = null;
  if (p.saida) {
    const r = await comandoSaidaSuplementacao({ ...p.saida, operation_id: operationId });
    movimentacao = r?.movimentacao ?? null;
    // A baixa está no servidor: daqui em diante ela não volta sozinha (descartar não a desfaz).
    await registrarProgresso?.({
      saida_feita: { movimentacao_id: movimentacao?.id ?? null, quantidade: p.saida.quantidade, produto_id: p.saida.produto_id, local_origem_id: p.saida.local_origem_id },
    });
  }
  const evento = { ...p.evento, movimentacao_estoque_id: movimentacao?.id ?? null, custo_unitario_kg: custoDaSaida(movimentacao) };
  let novoEvento;
  try {
    const resposta = await comandoLancamentoComLotes({
      operation_id: operationId,
      evento,
      lotes: Array.isArray(p.lotes) ? p.lotes : [],
      ...(p.evento_anterior_id !== undefined ? { evento_anterior_id: p.evento_anterior_id ?? null } : {}),
    });
    novoEvento = resposta.evento;
  } catch (erro) {
    if (movimentacao) {
      /** @type {any} */ (erro).saidaFeita = movimentacao;
      /** @type {any} */ (erro).mensagemDaFila = 'A baixa no estoque já foi feita: toque em "Tentar de novo" — o lançamento é refeito com o que o cocho tem agora, e o estoque não baixa outra vez.';
    }
    throw erro;
  }

  let fechamento = /** @type {'nenhum'|'feito'|'ja_fechado'|'falhou'} */ ('nenhum');
  if (p.fechamento && p.evento_anterior_id) {
    try {
      const anterior = (await listEventos()).find((e) => e?.id === p.evento_anterior_id) || null;
      const aberto = anterior && (anterior.dias_periodo === null || anterior.dias_periodo === undefined || anterior.fechado_por_evento_id === novoEvento?.id);
      if (aberto) {
        const { dataFim: _dataFim, ...paraFechar } = p.fechamento;
        await fecharPeriodoSuplementacao({ evento: anterior, ...paraFechar, fechadoPorEventoId: novoEvento.id });
        fechamento = 'feito';
      } else {
        fechamento = 'ja_fechado';
      }
    } catch (erro) {
      if (classificarFalhaDeEnvio(erro) === 'rede') throw erro;
      fechamento = 'falhou';
    }
  }
  return { evento: novoEvento, movimentacao, fechamento };
};

/**
 * "Tentar de novo" de um lançamento recusado porque o cocho mudou
 * (`LANCAMENTO_DESATUALIZADO`: outra pessoa lançou ou cancelou nesse meio
 * tempo). Busca no servidor o último lançamento ATIVO do cocho, liga a ele e
 * refaz o fechamento do período dele (dias até a data de fim deste, sobra
 * inicial dele, a sobra medida por quem lançou). A baixa já feita continua: o
 * código não muda, e o servidor devolve a mesma baixa. Outra recusa: payload
 * sem mudança.
 * @param {any} p
 * @param {{ ultimoErro: any }} ctx
 */
const reajustarLancamentoDoCocho = async (p, { ultimoErro }) => {
  if (ultimoErro?.codigo !== 'LANCAMENTO_DESATUALIZADO') return p;
  const pontoId = p?.evento?.ponto_suplementacao_id;
  const eventos = (await listEventos()).filter(
    (e) => e && e.ponto_suplementacao_id === pontoId && e.empresa_id === p.evento.empresa_id && e.situacao !== 'cancelado'
  );
  const ordem = (/** @type {any} */ e) => `${String(e.data_lancamento ?? '').slice(0, 10)}|${String(e.createdAt ?? e.created_date ?? '')}`;
  const ultimo = eventos.reduce((/** @type {any} */ a, /** @type {any} */ b) => (!a || ordem(b) > ordem(a) ? b : a), null);
  if (!ultimo) return { ...p, evento_anterior_id: null, fechamento: null };
  const aberto = ultimo.dias_periodo === null || ultimo.dias_periodo === undefined;
  const dataFim = p.fechamento?.dataFim ?? p.evento?.data_lancamento;
  const dias = aberto ? calcularDiasPeriodo(ultimo.data_lancamento, dataFim) : 0;
  return {
    ...p,
    evento_anterior_id: ultimo.id,
    fechamento:
      aberto && dias > 0
        ? {
            diasPeriodo: dias,
            sobraInicial: ultimo.sobra_kg || 0,
            sobraFinal: p.fechamento?.sobraFinal ?? 0,
            sobraInformada: p.fechamento?.sobraInformada ?? null,
            compartilhado: p.fechamento?.compartilhado,
            dataFim,
          }
        : null,
  };
};

registrarTipoDeEnvio({
  tipo: TIPO_LANCAMENTO_COCHO,
  versao: 1,
  offline: true,
  recursos: (p) => [`cocho:${p?.evento?.ponto_suplementacao_id ?? ''}`, ...(p?.saida?.local_origem_id ? [`estoque:${p.saida.local_origem_id}`] : [])],
  rotulo: (p) => `Lançamento · ${p?.evento?.ponto_nome ?? 'cocho'}`,
  atualiza: ['eventosSuplementacao', 'suplementacaoLote', 'movimentacaoEstoque', 'estoqueLotes'],
  enviar: executarLancamentoDoCocho,
  reajustar: reajustarLancamentoDoCocho,
});

/**
 * O id do lançamento anterior para o payload: do servidor, ou a referência ao
 * que ainda espera envio (o motor troca pelo id real antes de enviar).
 * @param {any} evento
 */
const idOuReferenciaDoEvento = (evento) => {
  if (!evento) return null;
  if (evento._aguardandoEnvio && evento._operationId) return referenciaAoResultado(evento._operationId, 'evento.id');
  return evento.id ?? null;
};

/**
 * Registra o lançamento do cocho (com internet, direto; sem internet, no
 * aparelho, e sobe depois).
 *
 * @param {{ saida: Record<string, unknown>|null, evento: Record<string, any>, lotes: Array<Record<string, unknown>>,
 *   eventoAnterior: any, fechamento: null | { diasPeriodo: number, sobraInicial: number, sobraFinal: number,
 *   sobraInformada: boolean|null, compartilhado?: boolean, dataFim?: string } }} dados
 * @param {{ operationId: string, rotulo?: string }} opcoes
 * @returns {Promise<{ aguardandoEnvio: boolean, evento: any, fechamento: string }>}
 */
/** @param {any} dados */
const payloadDoLancamento = (dados) => ({
  saida: dados.saida ?? null,
  evento: dados.evento,
  lotes: Array.isArray(dados.lotes) ? dados.lotes : [],
  evento_anterior_id: idOuReferenciaDoEvento(dados.eventoAnterior),
  fechamento: dados.eventoAnterior && dados.fechamento ? dados.fechamento : null,
});

export const registrarLancamentoDoCocho = async (dados, { operationId, rotulo }) => {
  const payload = payloadDoLancamento(dados);
  const r = await enviarOuGuardar(TIPO_LANCAMENTO_COCHO, payload, { empresaId: dados.evento?.empresa_id ?? null, operationId, rotulo });
  if (r.estado === 'enviado') {
    const res = /** @type {any} */ (r.resultado) ?? {};
    return { aguardandoEnvio: false, evento: res.evento, fechamento: res.fechamento ?? 'nenhum' };
  }
  return { aguardandoEnvio: true, evento: lancamentoAguardandoComoEvento(payload, r.operationId, new Date().toISOString()), fechamento: 'aguardando' };
};

// ── D-PROD-298: corrigir o lançamento que ainda não subiu ─────────────────

/** @param {string} mensagem */
const naoDaMais = (mensagem) => {
  const erro = new Error(mensagem);
  /** @type {any} */ (erro).code = 'LANCAMENTO_AGUARDANDO_INDISPONIVEL';
  return erro;
};

/**
 * Corrige na fila o lançamento que ainda não subiu (mesma posição, mesmo código).
 * @param {string} operationId
 * @param {Parameters<typeof registrarLancamentoDoCocho>[0]} dados
 * @param {{ rotulo?: string }} [opcoes]
 */
export const alterarLancamentoDoCocho = async (operationId, dados, opcoes = {}) => {
  const payload = payloadDoLancamento(dados);
  const ok = await alterarNaFila(operationId, payload, { rotulo: opcoes.rotulo });
  if (!ok) throw naoDaMais('Este lançamento já está subindo ou já chegou ao sistema: não dá mais para editar aqui. Se precisar, exclua o lançamento depois que ele aparecer como enviado.');
  return { aguardandoEnvio: true, evento: lancamentoAguardandoComoEvento(payload, operationId, new Date().toISOString()), fechamento: 'aguardando' };
};

/**
 * O que acontece se excluir o lançamento que ainda não subiu: quem depende dele
 * (o próximo lançamento do mesmo cocho, feito sem internet).
 * @param {{ _operationId?: string }} evento
 */
export const dependentesDoLancamentoAguardando = async (evento) =>
  evento?._operationId ? dependentesNaFila(evento._operationId) : [];

/**
 * Exclui o lançamento que ainda não subiu: sai só do aparelho, nada vai ao
 * servidor (a baixa do depósito vai junto, pois ainda não foi feita).
 * @param {{ _operationId?: string }} evento
 */
export const excluirLancamentoAguardando = async (evento) => {
  const opId = String(evento?._operationId ?? '');
  const situacao = await situacaoNaFila(opId);
  if (situacao === 'confirmando') throw naoDaMais('Este lançamento está sendo enviado agora. Espere confirmar para excluir.');
  if (situacao === 'enviado') throw naoDaMais('Este lançamento já chegou ao sistema. Atualize a tela e use "Excluir lançamento".');
  if (situacao && !(await descartarDaFila(opId))) throw naoDaMais('Não foi possível excluir este lançamento agora.');
};

/**
 * O lançamento que ainda não subiu, pronto para o formulário de edição; ou um
 * erro com a frase do motivo (já está subindo, já chegou, a baixa já foi feita).
 * @param {{ _operationId?: string }} evento
 * @returns {Promise<{ operationId: string, payload: any }>}
 */
export const lancamentoAguardandoParaEditar = async (evento) => {
  const registro = await registroNaFila(String(evento?._operationId ?? ''));
  if (!registro) throw naoDaMais('Este lançamento já chegou ao sistema. Atualize a tela.');
  if (!registro.podeAlterar) {
    throw naoDaMais(
      registro.progresso?.saida_feita
        ? 'A baixa deste lançamento já foi feita no estoque: não dá mais para editar. Use "Tentar de novo" em Dados sem internet.'
        : 'Este lançamento está sendo enviado agora. Espere confirmar.'
    );
  }
  return { operationId: registro.operationId, payload: registro.payload };
};

