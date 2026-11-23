/**
 * Cancelamento do lançamento de cocho — D-PROD-268.
 *
 * Contrato (só online; a tela nunca enfileira):
 *   GET  /suplementacao-eventos/:id/elegibilidade-cancelamento?empresa_id=  (informativa, ensaio desfeito)
 *   POST /suplementacao-eventos/:id/cancelamento  { empresa_id, operation_id, motivo }
 *
 * Uma transação faz tudo ou nada, e o GET roda o MESMO núcleo (`cancelarLancamentoTravado`) dentro
 * de um SAVEPOINT desfeito no fim (o padrão de `movimentacaoMapaExclusaoService.js`):
 *   1. permissão relida do banco (admin real, `is_admin` ou a chave `cancelar_lancamentos_estoque`);
 *   2. idempotência por (cliente, operation_id, 'cancelamento_lancamento_cocho') + fingerprint;
 *   3. trava do cocho (a MESMA do PATCH de fechamento, do POST genérico e do lançamento) e o
 *      evento `FOR UPDATE`; só o ÚLTIMO lançamento ATIVO do cocho, com o período ainda aberto;
 *   4. provas do servidor, nunca do corpo: o recibo do comando de lançamento (único), o rateio
 *      igual ao gravado por ele, a baixa do depósito pelo recibo da saída (mesma chave), sem
 *      gado movimentado depois nas áreas do lançamento;
 *   5. o período anterior só é reaberto quando há PROVA de que este lançamento o fechou
 *      (`fechado_por_evento_id`, ou o rastro legado no AuditLog) e nada mudou depois (deriva):
 *      volta exatamente ao retrato de antes do fechamento (sobra inicial, custo, camadas…);
 *   6. a baixa do depósito é estornada pelo MOTOR (`estornarSaidaSuplementacao`: camadas por CAS,
 *      poço com o valor exato) e numerada no fim. D-PROD-273 (fatia 4): com movimento depois no depósito
 *      (descontados os pares neutros), a exclusão RECALCULA o custo de tudo que veio depois
 *      (`estoqueExclusaoRecalculo`, inclusive o custo do fechamento dos outros cochos), em vez de recusar;
 *   7. o evento e o rateio dele ficam `situacao = 'cancelado'` (sem exclusão física); os recibos
 *      originais ficam 'committed' (reconciliação e bloqueio da exclusão da compra os leem);
 *   8. AuditLog numa ida só.
 * Toda recusa de negócio é 409 `SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO` com `details.reason`; nada
 * é gravado. Tenant e ator vêm só do `auth_context` (R11).
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { carregarAutorizacao, exigirCancelamentoLancamentosEstoque, podeCancelarLancamentosEstoque, CHAVE_CANCELAR_LANCAMENTOS_ESTOQUE } from '../../shared/auth/autorizacaoTela.js';
import { AppError } from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { documentoComoPublico } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import { TRANSACAO_CURTA, TRANSACAO_LONGA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { exigirEmpresaDoTenant } from '../gestao/gestaoComum.js';
import { agoraDoServidor, hojeDaEmpresa } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import { travarAreas } from '../rebanhoLedger/rebanhoLedgerNucleo.js';
import { registrarEventosEmLote } from '../auditoria/auditService.js';
import { comoPublico as movimentoPublico } from '../movimentacoesEstoque/movimentacaoEstoqueService.js';
import { CASAS_QUANTIDADE, Dec, dec } from '../financeiro/decimalFinanceiro.js';
import {
  ORIGEM_SUPLEMENTACAO,
  estornarSaidaSuplementacao,
  exigirLocaisEstoque,
  numerarMovimentos,
  numeroMovimentoProvisorio,
  travarProdutosEstoque,
} from '../estoqueFisico/estoqueFisicoMotor.js';
import { ACAO_AUDITORIA_RECALCULO, aplicarExclusaoComRecalculo, planejarExclusaoComRecalculo } from '../estoqueRecalculo/estoqueExclusaoRecalculo.js';
import { CAMPOS_PATCH_PERMITIDOS as CAMPOS_FECHAMENTO_EVENTO } from './camposFechamentoEvento.js';
import { CAMPOS_PATCH_PERMITIDOS as CAMPOS_FECHAMENTO_LOTE } from '../suplementacaoLotes/suplementacaoLoteService.js';
import { SITUACAO_CANCELADO, documentoCancelado, diaDoLancamento, eventosAtivosDoCocho, lerParaAtualizar, textoOuNulo, travarCocho } from './suplementacaoCocho.js';

export const TIPO_OPERACAO_CANCELAMENTO_COCHO = 'cancelamento_lancamento_cocho';
const TIPO_LANCAMENTO = 'lancamento_suplementacao';
const TIPO_SAIDA = 'saida_suplementacao';
const ENTIDADE_EVENTO = 'SuplementacaoEvento';
const ENTIDADE_LOTE = 'SuplementacaoLote';
const ENTIDADE_MOVIMENTO = 'MovimentacaoEstoque';
/** Recibo do lançamento: [createdAt − 2 min, createdAt + 1 min] do evento (mesma transação). */
const RECIBO_ANTES_MS = 2 * 60 * 1000;
const RECIBO_DEPOIS_MS = 60 * 1000;
/** Prova legada do fechamento do período anterior: até 300 s depois do lançamento. */
const JANELA_PROVA_LEGADA_MS = 300 * 1000;
export const MOTIVO_MIN = 3;
export const MOTIVO_MAX = 500;
const LIMITE_MOTIVO_MOVIMENTO = 255;

/**
 * Recusa de negócio do cancelamento (nada foi alterado).
 * @param {string} reason @param {Record<string, unknown>} [extra]
 */
const bloqueado = (reason, extra = {}) =>
  new AppError('SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', `o lançamento de cocho não pode ser cancelado com segurança (${reason}); nada foi alterado`, {
    details: { field: 'evento_id', reason, ...extra },
  });

const naoEncontrado = () => new AppError('SUPLEMENTACAOEVENTO_NOT_FOUND', 'SuplementacaoEvento não encontrado');

/** @param {unknown} v */
const nulo = (v) => v === null || v === undefined;
/** @param {any} o @param {string} k */
const tem = (o, k) => Boolean(o) && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
/** JSON com as chaves ordenadas (jsonb não guarda a ordem). @param {unknown} v @returns {string} */
const canonico = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(/** @type {any} */ (v)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
};
/** Mesmo valor da chave `k` nos dois retratos (presença inclusive). @param {any} a @param {any} b @param {string} k */
const mesmoCampo = (a, b, k) => tem(a, k) === tem(b, k) && (!tem(a, k) || canonico(a[k]) === canonico(b[k]));
/** @param {unknown} a @param {unknown} b */
const mesmoNumero = (a, b) => {
  const x = Number(a ?? 0);
  const y = Number(b ?? 0);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-9;
};
/** @param {any} d */
const ms = (d) => new Date(d).getTime();

/**
 * Motivo do usuário: obrigatório, aparado, de 3 a 500 caracteres.
 * @param {unknown} v
 */
export const exigirMotivo = (v) => {
  const motivo = typeof v === 'string' ? v.trim() : '';
  if (motivo.length < MOTIVO_MIN || motivo.length > MOTIVO_MAX) {
    throw new AppError('REQUEST_VALIDATION_FAILED', `motivo obrigatório (${MOTIVO_MIN} a ${MOTIVO_MAX} caracteres)`, { details: { field: 'motivo', reason: 'format' } });
  }
  return motivo;
};

/** @param {unknown} v */
const exigirOperationId = (v) => {
  const chave = typeof v === 'string' ? v.trim() : '';
  if (chave.length < 8 || chave.length > 128) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'operation_id inválido', { details: { field: 'operation_id', reason: 'format' } });
  }
  return chave;
};

/** O AuditLog `update` é a transição de fechamento (dias_periodo nulo → preenchido)? @param {any} a */
const ehFechamento = (a) => nulo(a?.dados_anteriores?.dias_periodo) && !nulo(a?.dados_novos?.dias_periodo);

/** AuditLogs `update` de um documento, em ordem. @param {any} tx @param {string} cli @param {string} entidade @param {string} id */
const updatesDe = (tx, cli, entidade, id) =>
  tx.auditLog.findMany({ where: { cliente_id: cli, entidade, entidade_id: id, acao: 'update' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

/**
 * Restaura as chaves `campos` ao retrato `anteriores` (a chave sai quando não estava lá).
 * @param {Record<string, unknown>} dados @param {any} anteriores @param {readonly string[]} campos
 */
const restaurar = (dados, anteriores, campos) => {
  const saida = { ...dados };
  for (const k of campos) {
    if (tem(anteriores, k)) saida[k] = anteriores[k];
    else delete saida[k];
  }
  return saida;
};

/**
 * D-PROD-273 (fatia 4) — o retrato `base` (o `dados_novos` do fechamento) com as reescritas do recálculo aplicadas em
 * ordem. Cada trilha diz, campo a campo, o antes e o depois; o antes tem de bater com o estado até ali (senão `null`).
 * @param {any} base @param {any[]} recalculos AuditLog `estoque.recalculo` do evento, em ordem
 * @returns {Record<string, unknown>|null}
 */
const estadoDepoisDosRecalculos = (base, recalculos) => {
  const estado = { ...(base ?? {}) };
  for (const r of recalculos) {
    const antes = r.dados_anteriores && typeof r.dados_anteriores === 'object' ? r.dados_anteriores : {};
    const depois = r.dados_novos && typeof r.dados_novos === 'object' ? r.dados_novos : {};
    for (const k of Object.keys(antes)) {
      if (canonico(estado[k] ?? null) !== canonico(antes[k] ?? null) || !tem(depois, k)) return null;
      estado[k] = depois[k];
    }
  }
  return estado;
};

/**
 * Plano da reabertura do período anterior P (em memória; nada é escrito aqui). Casos:
 *  (a) sem P, (b) P aberto, (c) P fechado ANTES de N por outro fluxo → nada a reabrir;
 *  (d) P fechado por N (prova nova `fechado_por_*` ou legada pelo AuditLog) → reabre ao retrato
 *      exato de antes do fechamento, com teste de deriva; o mesmo para cada lote fechado de P.
 * Qualquer outra combinação recusa.
 * @param {any} tx @param {string} cli
 * @param {{ N: any, P: any|null, lotesP: any[], criacaoN: any|null, em: string, operationKey: string }} a
 * @returns {Promise<null | { evento: any, restaurado: Record<string, unknown>, lotes: Array<{ lote: any, restaurado: Record<string, unknown> }> }>}
 */
const planejarReabertura = async (tx, cli, { N, P, lotesP, criacaoN, em, operationKey }) => {
  const apontam = /** @type {any[]} */ (await tx.$queryRaw`SELECT id FROM "SuplementacaoEvento"
    WHERE cliente_id = ${cli} AND empresa_id = ${N.empresa_id} AND dados->>'fechado_por_evento_id' = ${N.id}`);
  if (apontam.some((e) => e.id !== P?.id)) throw bloqueado('periodo_anterior_nao_comprovado', { evento_anterior_id: P?.id ?? null });
  if (!P) return null;
  const dadosP = P.dados ?? {};
  const fechadoPorN = dadosP.fechado_por_evento_id === N.id;
  if (nulo(dadosP.dias_periodo)) {
    if (fechadoPorN || lotesP.some((l) => !nulo(l.dados?.dias_periodo))) throw bloqueado('periodo_anterior_nao_comprovado', { evento_anterior_id: P.id });
    return null;
  }
  const fechamentos = (await updatesDe(tx, cli, ENTIDADE_EVENTO, P.id)).filter(ehFechamento);
  const A = fechamentos.at(-1);
  if (!A) throw bloqueado('periodo_anterior_nao_comprovado', { evento_anterior_id: P.id });
  if (!fechadoPorN && ms(A.createdAt) < ms(N.createdAt)) return null;

  let provado = false;
  if (fechadoPorN) {
    provado = dadosP.fechado_por_tipo === 'lancamento' && ms(A.createdAt) >= ms(N.createdAt);
  } else if (nulo(dadosP.fechado_por_tipo) && nulo(dadosP.fechado_por_evento_id)) {
    const depoisDeN = fechamentos.filter((f) => ms(f.createdAt) >= ms(N.createdAt));
    provado = depoisDeN.length === 1 && depoisDeN[0].id === A.id && Boolean(criacaoN)
      && A.usuario_id === criacaoN.usuario_id
      && ms(A.createdAt) >= ms(criacaoN.createdAt) && ms(A.createdAt) - ms(criacaoN.createdAt) <= JANELA_PROVA_LEGADA_MS
      && tem(A.dados_novos, 'sobra_kg') && mesmoNumero(A.dados_novos.sobra_kg, N.dados?.sobra_kg);
  }
  if (!provado) throw bloqueado('periodo_anterior_nao_comprovado', { evento_anterior_id: P.id });
  // D-PROD-273 (fatia 4): o recálculo da exclusão de uma saída anterior pode ter reescrito o CUSTO deste fechamento
  // (trilha `estoque.recalculo`, antes → depois). O estado legítimo é o do fechamento com essas reescritas aplicadas,
  // em ordem, cada uma conferida contra o estado anterior a ela (qualquer quebra da cadeia = alterado).
  const recalculos = await tx.auditLog.findMany({
    where: { cliente_id: cli, entidade: ENTIDADE_EVENTO, entidade_id: P.id, acao: ACAO_AUDITORIA_RECALCULO, createdAt: { gte: A.createdAt } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const legitimo = estadoDepoisDosRecalculos(A.dados_novos, recalculos);
  if (!legitimo || !CAMPOS_FECHAMENTO_EVENTO.every((k) => mesmoCampo(dadosP, legitimo, k))) {
    throw bloqueado('periodo_anterior_alterado', { evento_anterior_id: P.id });
  }
  const restaurado = {
    ...restaurar(dadosP, A.dados_anteriores, CAMPOS_FECHAMENTO_EVENTO),
    // o custo/kg da saída do período reaberto é o vigente (o recálculo o mudou depois do fechamento)
    ...(recalculos.length && tem(A.dados_anteriores, 'custo_unitario_kg') && tem(dadosP, 'custo_unitario_kg') ? { custo_unitario_kg: dadosP.custo_unitario_kg } : {}),
    reaberto_por_cancelamento: { evento_cancelado_id: N.id, em, operation_id: operationKey },
  };

  const lotes = [];
  for (const lote of lotesP) {
    if (nulo(lote.dados?.dias_periodo)) continue;
    const B = (await updatesDe(tx, cli, ENTIDADE_LOTE, lote.id)).filter(ehFechamento).at(-1);
    const loteProvado = Boolean(B) && Boolean(criacaoN) && B.usuario_id === criacaoN.usuario_id
      && ms(B.createdAt) >= ms(N.createdAt) && ms(B.createdAt) - ms(criacaoN.createdAt) <= JANELA_PROVA_LEGADA_MS;
    if (!loteProvado) throw bloqueado('lote_periodo_anterior_nao_comprovado', { evento_anterior_id: P.id, lote_id: lote.id });
    if (!CAMPOS_FECHAMENTO_LOTE.every((k) => mesmoCampo(lote.dados, B.dados_novos, k))) {
      throw bloqueado('periodo_anterior_alterado', { evento_anterior_id: P.id, lote_id: lote.id });
    }
    lotes.push({ lote, restaurado: restaurar(lote.dados, B.dados_anteriores, CAMPOS_FECHAMENTO_LOTE) });
  }
  return { evento: P, restaurado, lotes };
};

/** `quantidade` (Decimal do banco) = `valor` arredondado a 4 casas. @param {any} kg @param {unknown} valor */
const mesmaQuantidade = (kg, valor) => {
  try {
    const q = new Dec(String(valor ?? ''));
    return !q.isNaN() && dec(kg).eq(q.toDecimalPlaces(CASAS_QUANTIDADE, Dec.ROUND_HALF_UP));
  } catch {
    return false;
  }
};

/**
 * Recusa `gado_movimentado` se há MovimentacaoMapa ativa gravada depois de N nas áreas dele
 * (origem, destino, área ou qualquer linha).
 * @param {any} tx @param {string} cli @param {string} empresaId @param {any} N @param {string[]} areas
 */
const exigirGadoParado = async (tx, cli, empresaId, N, areas) => {
  if (!areas.length) return;
  const [mov] = /** @type {any[]} */ (await tx.$queryRaw`SELECT m.id FROM "MovimentacaoMapa" m
    WHERE m.cliente_id = ${cli} AND m.empresa_id = ${empresaId} AND m."createdAt" > ${N.createdAt}
      AND COALESCE(m.dados->>'situacao', '') <> ${SITUACAO_CANCELADO}
      AND (m.dados->>'area_origem_id' = ANY(${areas}::text[]) OR m.dados->>'area_destino_id' = ANY(${areas}::text[]) OR m.dados->>'area_id' = ANY(${areas}::text[])
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.dados->'linhas') = 'array' THEN m.dados->'linhas' ELSE '[]'::jsonb END) l
                   WHERE l->>'area_origem_id' = ANY(${areas}::text[]) OR l->>'area_destino_id' = ANY(${areas}::text[])))
    ORDER BY m."createdAt" LIMIT 1`);
  if (mov) throw bloqueado('gado_movimentado', { movimentacao_mapa_id: mov.id });
};

/**
 * Núcleo do cancelamento, sob a transação de quem chama (o POST ou o ensaio do GET). Recusa
 * antes de qualquer escrita; escreve na ordem estorno → documentos → numeração → AuditLog.
 * @param {any} tx
 * @param {{ requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext }} contexto
 * @param {{ cli: string, empresaId: string, id: string, hoje: string, motivo: string, operationKey: string }} a
 */
export const cancelarLancamentoTravado = async (tx, contexto, { cli, empresaId, id, hoje, motivo, operationKey }) => {
  const auth = exigirAuthContext(contexto?.auth);
  // 3. Descobre o cocho sem trava, trava o cocho e relê o evento FOR UPDATE.
  const previa = await tx.suplementacaoEvento.findUnique({ where: { cliente_id_id: { cliente_id: cli, id } } });
  if (!previa || previa.empresa_id !== empresaId) throw naoEncontrado();
  const ponto = textoOuNulo(previa.dados?.ponto_suplementacao_id);
  if (documentoCancelado(previa.dados)) throw new AppError('CANCELAMENTO_JA_REALIZADO', 'este lançamento de cocho já foi cancelado', { details: { evento_id: id } });
  if (!ponto) throw bloqueado('sem_recibo');
  await travarCocho(tx, cli, empresaId, ponto);
  const N = await lerParaAtualizar(tx, ENTIDADE_EVENTO, cli, id);
  if (!N || N.empresa_id !== empresaId) throw naoEncontrado();
  if (textoOuNulo(N.dados?.ponto_suplementacao_id) !== ponto) throw new AppError('CONCURRENCY_CONFLICT', 'o lançamento mudou de cocho durante o cancelamento; tente de novo com a mesma operation_id');
  if (documentoCancelado(N.dados)) throw new AppError('CANCELAMENTO_JA_REALIZADO', 'este lançamento de cocho já foi cancelado', { details: { evento_id: id } });
  if (!nulo(N.dados?.dias_periodo)) throw bloqueado('periodo_fechado');

  // 5. Só o último ATIVO do cocho (data e cadastro: fail-closed pelas duas ordens) e o anterior P.
  const ativos = await eventosAtivosDoCocho(tx, cli, empresaId, ponto);
  const diaN = diaDoLancamento(N.dados?.data_lancamento);
  const posterior = ativos.find((e) => e.id !== N.id && (diaDoLancamento(e.dados?.data_lancamento) > diaN
    || ms(e.createdAt) > ms(N.createdAt) || (ms(e.createdAt) === ms(N.createdAt) && String(e.id) > String(N.id))));
  if (posterior) throw bloqueado('lancamento_posterior', { evento_posterior_id: posterior.id });
  const outros = ativos.filter((e) => e.id !== N.id);
  const previaP = outros.length ? outros[outros.length - 1] : null;
  const P = previaP ? await lerParaAtualizar(tx, ENTIDADE_EVENTO, cli, previaP.id) : null;
  if (previaP && (!P || documentoCancelado(P.dados))) throw new AppError('CONCURRENCY_CONFLICT', 'o período anterior mudou durante o cancelamento; tente de novo com a mesma operation_id');
  const idsLotes = P ? [N.id, P.id] : [N.id];
  const lotes = /** @type {any[]} */ (await tx.$queryRaw`SELECT id, cliente_id, empresa_id, dados, "createdAt", "updatedAt" FROM "SuplementacaoLote"
    WHERE cliente_id = ${cli} AND dados->>'suplementacao_evento_id' = ANY(${idsLotes}::text[]) ORDER BY id FOR UPDATE`);
  const lotesN = lotes.filter((l) => l.dados?.suplementacao_evento_id === N.id);
  const lotesP = P ? lotes.filter((l) => l.dados?.suplementacao_evento_id === P.id && !documentoCancelado(l.dados)) : [];
  if (lotesN.some((l) => !nulo(l.dados?.dias_periodo))) throw bloqueado('periodo_fechado');

  // 6. Gado movimentado depois nas áreas do lançamento (a regra da tela, agora no servidor).
  //    As linhas das áreas (`AreaPastagem` FOR UPDATE, em ordem de id) são a MESMA trava que os
  //    comandos do ledger do rebanho tomam antes de gravar a MovimentacaoMapa: com elas, ou a
  //    movimentação espera este cancelamento, ou ele a vê e recusa. A checagem se repete logo antes
  //    da auditoria (fim da transação) para os escritores genéricos, que ainda não tomam a trava.
  const areas = [...new Set([N.dados?.area_id, ...(Array.isArray(N.dados?.area_ids) ? N.dados.area_ids : [])].filter((v) => typeof v === 'string' && v))];
  await travarAreas(tx, cli, empresaId, areas);
  await exigirGadoParado(tx, cli, empresaId, N, areas);

  // 7. Recibos do servidor: o do lançamento (único), o rateio dele e o da saída (mesma chave).
  const desde = new Date(ms(N.createdAt) - RECIBO_ANTES_MS);
  const ate = new Date(ms(N.createdAt) + RECIBO_DEPOIS_MS);
  const recibos = /** @type {any[]} */ (await tx.$queryRaw`SELECT id, operation_key, response_json FROM "OperacaoIdempotente"
    WHERE cliente_id = ${cli} AND tipo_operacao = ${TIPO_LANCAMENTO} AND status = 'committed'
      AND "createdAt" >= ${desde} AND "createdAt" <= ${ate} AND response_json->'evento'->>'id' = ${N.id}`);
  if (recibos.length !== 1) throw bloqueado('sem_recibo');
  const reciboLancamento = recibos[0];
  if (Number(reciboLancamento.response_json?.lotes_gravados) !== lotesN.length) {
    throw bloqueado('rateio_divergente', { lotes_gravados: reciboLancamento.response_json?.lotes_gravados ?? null, lotes_atuais: lotesN.length });
  }
  const reciboSaida = await tx.operacaoIdempotente.findUnique({
    where: { cliente_id_operation_key_tipo_operacao: { cliente_id: cli, operation_key: reciboLancamento.operation_key, tipo_operacao: TIPO_SAIDA } },
  });

  // 8. A baixa do depósito, provada pelo servidor (nunca pelo `movimentacao_estoque_id` do corpo).
  const movimentoId = textoOuNulo(N.dados?.movimentacao_estoque_id);
  let M = null;
  if (movimentoId) {
    const resposta = /** @type {any} */ (reciboSaida?.response_json);
    if (!reciboSaida || reciboSaida.status !== 'committed' || resposta?.movimentacao?.id !== movimentoId) {
      throw bloqueado('saida_nao_comprovada', { movimentacao_id: movimentoId });
    }
    M = await tx.movimentacaoEstoque.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: movimentoId } } });
    const comprovada = M && M.empresa_id === empresaId && M.tipo_movimentacao === 'Saída' && M.origem_sistema === ORIGEM_SUPLEMENTACAO
      && M.tipo_detalhado === 'suplementacao' && M.produto_id === textoOuNulo(N.dados?.produto_id)
      && (M.ponto_suplementacao_id ?? null) === ponto && typeof M.local_estoque_origem === 'string' && M.local_estoque_origem && !M.local_estoque_destino
      && mesmaQuantidade(M.quantidade, N.dados?.quantidade_total_kg);
    if (!comprovada) throw bloqueado('saida_nao_comprovada', { movimentacao_id: movimentoId });
    const [outroEvento] = /** @type {any[]} */ (await tx.$queryRaw`SELECT id FROM "SuplementacaoEvento"
      WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND id <> ${N.id}
        AND dados->>'movimentacao_estoque_id' = ${movimentoId} AND COALESCE(dados->>'situacao', '') <> ${SITUACAO_CANCELADO} LIMIT 1`);
    if (outroEvento) throw bloqueado('saida_nao_comprovada', { movimentacao_id: movimentoId, evento_id_que_cita: outroEvento.id });
    if (M.status !== 'Ativa' || M.movimento_filho_id) throw bloqueado('movimento_estornado', { movimentacao_id: movimentoId });
    if (!Array.isArray(M.lotes_consumidos) || M.lotes_consumidos.length === 0) throw bloqueado('saida_sem_fatias', { movimentacao_id: movimentoId });
  } else if (reciboSaida) {
    throw bloqueado('saida_nao_comprovada', { movimentacao_id: /** @type {any} */ (reciboSaida.response_json)?.movimentacao?.id ?? null });
  }

  // 9. Plano do período anterior (em memória).
  const criacaoN = await tx.auditLog.findFirst({ where: { cliente_id: cli, entidade: ENTIDADE_EVENTO, entidade_id: N.id, acao: 'create' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const em = agoraDoServidor().toISOString();
  const plano = await planejarReabertura(tx, cli, { N, P, lotesP, criacaoN, em, operationKey });

  // 10–11. Estorno da baixa pelo motor: locais FOR KEY SHARE → produto → (motor) camadas → original.
  let estorno = null;
  /** @type {import('../estoqueRecalculo/estoqueExclusaoRecalculo.js').PlanoRecalculo[]} */
  let planos = [];
  if (M) {
    const locais = await exigirLocaisEstoque(tx, cli, [{ id: M.local_estoque_origem, field: 'local_origem_id', exigirAtivo: false }]);
    await travarProdutosEstoque(tx, cli, empresaId, [M.produto_id]);
    const produto = await tx.produto.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id: M.produto_id } });
    if (!produto) throw bloqueado('saida_nao_comprovada', { movimentacao_id: M.id });
    const local = /** @type {{ id: string, nome: string }} */ (locais.get(M.local_estoque_origem));
    const nomeCocho = textoOuNulo(N.dados?.ponto_nome) ?? 'cocho';
    // D-PROD-273 (fatia 4): com movimento depois no depósito (descontados os pares neutros, como antes), a exclusão
    // recalcula o que veio depois em vez de recusar; a prova (replay = gravado) vem antes de qualquer escrita.
    planos = await planejarExclusaoComRecalculo(tx, cli, {
      empresaId, movimentos: [{ id: M.id, produtoId: M.produto_id, localId: M.local_estoque_origem }], ignorarParesNeutros: true,
    });
    const r = await estornarSaidaSuplementacao(tx, contexto, {
      empresaId,
      movimentoId: M.id,
      produto,
      local: { id: local.id, nome: local.nome },
      dia: hoje,
      origem: { operacaoId: N.id, motivoEstorno: [...`Cancelamento do lançamento do cocho ${nomeCocho}: ${motivo}`].slice(0, LIMITE_MOTIVO_MOVIMENTO).join('') },
      numeroMovimento: numeroMovimentoProvisorio(),
      vinculo: { pontoSuplementacaoId: ponto, quantidadeKg: N.dados?.quantidade_total_kg },
      exigirUltimo: planos.length === 0,
    });
    estorno = { r, local, produto };
  }

  // 12. Documentos (inteiros, montados pelo servidor), em ordem de id.
  const cancelamento = {
    em,
    por_usuario_id: auth.usuarioId,
    motivo,
    operation_id: operationKey,
    movimentacao_estorno_id: estorno?.r.movimento.id ?? null,
    evento_reaberto_id: plano?.evento.id ?? null,
  };
  const eventoCancelado = await tx.suplementacaoEvento.update({
    where: { cliente_id_id: { cliente_id: cli, id: N.id } },
    data: { dados: { ...N.dados, situacao: SITUACAO_CANCELADO, cancelamento } },
  });
  /** @type {any[]} */
  const auditorias = [{ acao: 'cancelamento', entidade: ENTIDADE_EVENTO, entidadeId: N.id, dadosAnteriores: documentoComoPublico(N), dadosNovos: documentoComoPublico(eventoCancelado) }];
  for (const lote of lotesN) {
    const novo = await tx.suplementacaoLote.update({
      where: { cliente_id_id: { cliente_id: cli, id: lote.id } },
      data: { dados: { ...lote.dados, situacao: SITUACAO_CANCELADO, cancelamento: { evento_id: N.id, em, operation_id: operationKey } } },
    });
    auditorias.push({ acao: 'cancelamento', entidade: ENTIDADE_LOTE, entidadeId: lote.id, dadosAnteriores: documentoComoPublico(lote), dadosNovos: documentoComoPublico(novo) });
  }
  if (plano) {
    const reaberto = await tx.suplementacaoEvento.update({ where: { cliente_id_id: { cliente_id: cli, id: plano.evento.id } }, data: { dados: plano.restaurado } });
    auditorias.push({ acao: 'reabertura', entidade: ENTIDADE_EVENTO, entidadeId: plano.evento.id, dadosAnteriores: documentoComoPublico(plano.evento), dadosNovos: documentoComoPublico(reaberto) });
    for (const { lote, restaurado } of plano.lotes) {
      const novo = await tx.suplementacaoLote.update({ where: { cliente_id_id: { cliente_id: cli, id: lote.id } }, data: { dados: restaurado } });
      auditorias.push({ acao: 'reabertura', entidade: ENTIDADE_LOTE, entidadeId: lote.id, dadosAnteriores: documentoComoPublico(lote), dadosNovos: documentoComoPublico(novo) });
    }
  }

  // 12b. D-PROD-273 (fatia 4): o recálculo do que veio depois (com o evento já cancelado e o período anterior reaberto).
  const recalculo = estorno && planos.length
    ? await aplicarExclusaoComRecalculo(tx, contexto, planos, {
      empresaId, estornos: new Map([[estorno.r.original.id, estorno.r.movimento.id]]), origem: ORIGEM_SUPLEMENTACAO,
      motivo: [...`Cancelamento do lançamento do cocho ${textoOuNulo(N.dados?.ponto_nome) ?? 'cocho'}: ${motivo}`].slice(0, LIMITE_MOTIVO_MOVIMENTO).join(''),
    })
    : null;

  // 13. Numeração no FIM e releitura do estorno.
  let resumoEstorno = null;
  if (estorno) {
    await numerarMovimentos(tx, cli, [estorno.r.movimento.id]);
    const entrada = await tx.movimentacaoEstoque.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: estorno.r.movimento.id } } });
    const original = await tx.movimentacaoEstoque.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: estorno.r.original.id } } });
    auditorias.push({ acao: 'create', entidade: ENTIDADE_MOVIMENTO, entidadeId: entrada.id, dadosNovos: movimentoPublico(entrada) });
    auditorias.push({
      acao: 'estorno', entidade: ENTIDADE_MOVIMENTO, entidadeId: original.id,
      dadosAnteriores: { status: 'Ativa', movimento_filho_id: null }, dadosNovos: { status: original.status, movimento_filho_id: original.movimento_filho_id },
    });
    resumoEstorno = {
      movimentacao_original_id: original.id,
      movimentacao_estorno_id: entrada.id,
      numero_movimentacao: entrada.numero_movimentacao,
      quantidade: dec(estorno.r.quantidade).toFixed(CASAS_QUANTIDADE),
      valor_total: dec(estorno.r.valor_total).toString(),
      local_estoque_id: estorno.local.id,
      local_nome: estorno.local.nome,
      produto_id: estorno.produto.id,
      produto_nome: estorno.produto.nome_produto ?? null,
    };
  }

  // 14. Gado de novo (fecha a janela do motor para quem grava sem a trava) e auditoria numa ida só.
  await exigirGadoParado(tx, cli, empresaId, N, areas);
  await registrarEventosEmLote(contexto, auditorias, tx);

  return {
    evento: documentoComoPublico(eventoCancelado),
    lotes_cancelados: lotesN.length,
    estorno: resumoEstorno,
    recalculo,
    periodo_reaberto: plano
      ? {
          evento_id: plano.evento.id,
          data_lancamento: plano.evento.dados?.data_lancamento ?? null,
          sobra_inicial_restaurada_kg: plano.restaurado.sobra_kg ?? null,
          lotes_reabertos: plano.lotes.length,
        }
      : null,
  };
};

/**
 * POST /suplementacao-eventos/:id/cancelamento — idempotente por `operation_id`.
 * @param {{ requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext }} contexto
 * @param {string} id
 * @param {{ empresa_id: string, operation_id: string, motivo: string }} entrada
 */
export const cancelarLancamentoCocho = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const operationKey = exigirOperationId(entrada?.operation_id);
  const motivo = exigirMotivo(entrada?.motivo);
  const empresaInformada = typeof entrada?.empresa_id === 'string' ? entrada.empresa_id.trim() : '';
  const fingerprint = fingerprintDePayload({ evento_id: id, empresa_id: empresaInformada, motivo });

  const resultado = await emTransacao(TRANSACAO_LONGA, async (tx) => {
    // Permissão relida DENTRO da transação (revogação concorrente vale), antes do recibo.
    await exigirCancelamentoLancamentosEstoque(contexto, tx);
    return executarComIdempotencia(tx, {
      clienteId: cli,
      operationKey,
      tipoOperacao: TIPO_OPERACAO_CANCELAMENTO_COCHO,
      fingerprint,
      executar: async () => {
        const empresaId = await exigirEmpresaDoTenant(tx, cli, empresaInformada);
        const { hoje } = await hojeDaEmpresa(tx, cli, empresaId);
        const r = await cancelarLancamentoTravado(tx, contexto, { cli, empresaId, id, hoje, motivo, operationKey });
        return { httpStatus: 200, body: { committed: true, operation_id: operationKey, replay: false, ...r } };
      },
    });
  });
  return { status: resultado.httpStatus, body: { ...resultado.body, replay: resultado.replay } };
};

/**
 * GET /suplementacao-eventos/:id/elegibilidade-cancelamento — só informativa: ensaia o MESMO
 * núcleo dentro de SAVEPOINT e desfaz. O POST revalida tudo sob trava.
 * @param {{ requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext }} contexto
 * @param {string} id
 * @param {string} empresaIdInformada
 */
export const elegibilidadeCancelamentoCocho = async (contexto, id, empresaIdInformada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  return emTransacao(TRANSACAO_CURTA, async (tx) => {
    const pode = podeCancelarLancamentosEstoque(await carregarAutorizacao(contexto, tx));
    const empresaId = await exigirEmpresaDoTenant(tx, cli, empresaIdInformada);
    const previa = await tx.suplementacaoEvento.findUnique({ where: { cliente_id_id: { cliente_id: cli, id } } });
    if (!previa || previa.empresa_id !== empresaId) throw naoEncontrado();
    const comum = { evento_id: id, requer_permissao: CHAVE_CANCELAR_LANCAMENTOS_ESTOQUE, pode_cancelar_permissao: pode };
    const recusado = (/** @type {any} */ erro) => ({
      ...comum, elegivel: false, codigo: erro.code, reason: erro.details?.reason ?? null, mensagem: erro.message, detalhes: erro.details ?? null,
      efeitos: { estorno: null, periodo_reaberto: null, lotes_a_cancelar: 0, recalculo: null },
    });
    // A guarda da rota (GUARDAS.suplementacaoEvento.cancelar) já nega 403 antes daqui; esta releitura
    // na transação só pega a revogação que chega entre a guarda e o BEGIN (defesa contra corrida).
    // Por isso um 200 normal sai com pode_cancelar_permissao = true.
    if (!pode) return recusado(new AppError('ACAO_NAO_PERMITIDA', 'sem permissão para cancelar lançamentos', { details: { mapa: CHAVE_CANCELAR_LANCAMENTOS_ESTOQUE } }));
    const { hoje } = await hojeDaEmpresa(tx, cli, empresaId);
    await tx.$executeRawUnsafe('SAVEPOINT elegibilidade_cancelamento_cocho');
    try {
      const r = await cancelarLancamentoTravado(tx, contexto, { cli, empresaId, id, hoje, motivo: 'ensaio', operationKey: 'ensaio-elegibilidade' });
      return {
        ...comum, elegivel: true, codigo: null, reason: null, mensagem: null, detalhes: null,
        efeitos: {
          estorno: r.estorno
            ? { quantidade: r.estorno.quantidade, valor_total: r.estorno.valor_total, local_estoque_id: r.estorno.local_estoque_id, local_nome: r.estorno.local_nome, produto_nome: r.estorno.produto_nome }
            : null,
          periodo_reaberto: r.periodo_reaberto
            ? { evento_id: r.periodo_reaberto.evento_id, data_lancamento: r.periodo_reaberto.data_lancamento, sobra_inicial_restaurada_kg: r.periodo_reaberto.sobra_inicial_restaurada_kg }
            : null,
          lotes_a_cancelar: r.lotes_cancelados,
          // D-PROD-273 (fatia 4): o que a exclusão recalcularia (movimentos, camadas e dependentes reescritos), ou null.
          recalculo: r.recalculo,
        },
      };
    } catch (erro) {
      if (erro instanceof AppError) return recusado(erro);
      throw erro;
    } finally {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT elegibilidade_cancelamento_cocho');
    }
  });
};
