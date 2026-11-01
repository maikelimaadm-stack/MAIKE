/**
 * Exclusão do Cadastro de Lotes depois de cancelamento seguro — MAIKE-LOTES-R1
 * (D-PROD-100).
 *
 * O Cadastro de Lotes é o lançamento de ENTRADA. Excluir decide, dentro de UMA
 * transação, com o lote travado (`FOR UPDATE`) e tudo relido do banco:
 *
 *   - `exclusao_fisica` — nenhum vínculo, nenhuma alteração operacional, nenhum
 *     anexo: apaga a linha (comportamento anterior, D-PROD-87);
 *   - `exclusao_logica` — o único histórico são movimentos do mapa CANCELADOS
 *     com prova (comando de manejo + cancelamento idempotente confirmado), o
 *     lote voltou exatamente ao estado de entrada e toda alteração operacional
 *     registrada no AuditLog é explicada por esses comandos; ou há anexo que
 *     não pode ficar órfão. Grava `excluido_em` (tombstone): a linha fica para
 *     a auditoria e os movimentos cancelados continuam apontando para ela;
 *   - `bloqueado` — qualquer outra coisa (movimento ativo, outra fonte de
 *     registro, vínculo legado só por nome, cancelamento sem prova, estado
 *     diferente da entrada, alteração sem comprovação, lote gerado por manejo).
 *
 * Exclusão lógica NÃO é estorno: não mexe em saldo, situação nem histórico.
 * Na dúvida, bloqueia — não existe atalho de exclusão física.
 */

import { Prisma } from '@prisma/client';

import { TIPO_OPERACAO_CANCELAMENTO, SITUACAO_CANCELADO } from '../movimentacoesMapa/movimentacaoMapaCancelamentoService.js';
import { COMANDO_MANEJO } from '../movimentacoesMapa/manejoMapaComandoService.js';
import { origemDerivadaDeManejo } from './loteOrigem.js';

export const TIPO_FISICA = 'exclusao_fisica';
export const TIPO_LOGICA = 'exclusao_logica';
export const TIPO_BLOQUEADO = 'bloqueado';
export const TIPO_JA_EXCLUIDO = 'ja_excluido';

/** Fontes JSON com `dados.lote_id` (tabela constante, nunca entrada). */
const FONTES_JSON = Object.freeze([
  { tabela: 'MovimentacaoPecuaria', motivo: 'movimentacoes_pecuarias' },
  { tabela: 'SuplementacaoLote', motivo: 'suplementacao_lote' },
  { tabela: 'ManejoTecnicoRebanho', motivo: 'manejos_tecnicos' },
  { tabela: 'EventoSanitario', motivo: 'eventos_sanitarios' },
  { tabela: 'AplicacaoMedicamento', motivo: 'aplicacoes_medicamento' },
]);


const nulo = (v) => (v === undefined || v === '' ? null : v);

/**
 * O lote está no retrato da ENTRADA? Saldo = entrada, área atual = de entrada,
 * categoria (quando a entrada a tem) = de entrada, situação Ativo.
 * @param {Record<string, any>} x snapshot do lote (linha do banco ou AuditLog)
 */
export const noEstadoDeEntrada = (x) =>
  !!x &&
  typeof x.quantidade_cabecas === 'number' &&
  x.quantidade_cabecas === x.quantidade_entrada &&
  x.quantidade_cabecas > 0 &&
  x.status === 'Ativo' &&
  nulo(x.area_atual_id) === nulo(x.area_entrada_id) &&
  (!nulo(x.categoria_entrada) || nulo(x.categoria) === nulo(x.categoria_entrada)) &&
  (!nulo(x.categoria_manejo_entrada_id) || nulo(x.categoria_manejo_id) === nulo(x.categoria_manejo_entrada_id));

const bloqueio = (motivo, detalhes = {}) => ({ tipo: TIPO_BLOQUEADO, motivo, detalhes });

/**
 * Movimentos do mapa que citam o lote por qualquer caminho de identidade:
 * `lote_id`, `lote_destino_id`, `efeito_servidor.efeitos[].lote_id` ou o id
 * dentro de `observacoes` (legado). Sem teto: consulta no banco, não lista.
 */
const movimentosQueCitam = async (tx, clienteId, loteId) =>
  /** @type {Array<{id: string, situacao: string|null, cancel_op: string|null, comando: string|null, dados: any}>} */ (
    await tx.$queryRaw`
      SELECT m.id,
             m.dados->>'situacao' AS situacao,
             m.dados->'cancelamento'->>'operation_id' AS cancel_op,
             m.dados->'efeito_servidor'->>'comando' AS comando,
             m.dados AS dados
        FROM "MovimentacaoMapa" m
       WHERE m.cliente_id = ${clienteId}
         AND (
           m.dados->>'lote_id' = ${loteId}
           OR m.dados->>'lote_destino_id' = ${loteId}
           OR position(${loteId} IN COALESCE(m.dados->>'observacoes', '')) > 0
           OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(m.dados->'efeito_servidor'->'efeitos') = 'array'
                    THEN m.dados->'efeito_servidor'->'efeitos' ELSE '[]'::jsonb END
             ) AS e(val)
             WHERE e.val->>'lote_id' = ${loteId}
           )
         )`
  );

/** Registro legado só por NOME (sem `lote_id`) na mesma empresa: identidade não demonstrável. */
const temLegadoPorNome = async (tx, clienteId, lote) => {
  const nome = String(lote.nome || '').trim().toUpperCase();
  if (!nome) return null;
  const [mapa] = /** @type {Array<{n: number}>} */ (
    await tx.$queryRaw`
      SELECT COUNT(*)::int AS n FROM "MovimentacaoMapa" m
       WHERE m.cliente_id = ${clienteId} AND m.empresa_id = ${lote.empresa_id}
         AND COALESCE(m.dados->>'lote_id', '') = ''
         AND upper(btrim(COALESCE(m.dados->>'lote', ''))) = ${nome}`
  );
  if (mapa?.n) return 'MovimentacaoMapa';
  for (const fonte of FONTES_JSON) {
    const [linha] = /** @type {Array<{n: number}>} */ (
      await tx.$queryRaw`
        SELECT COUNT(*)::int AS n FROM ${Prisma.raw(`"${fonte.tabela}"`)} d
         WHERE d.cliente_id = ${clienteId} AND d.empresa_id = ${lote.empresa_id}
           AND COALESCE(d.dados->>'lote_id', '') = ''
           AND upper(btrim(COALESCE(d.dados->>'lote', d.dados->>'lote_nome', d.dados->>'nome_lote', ''))) = ${nome}`
    );
    if (linha?.n) return fonte.tabela;
  }
  return null;
};

/** Outras fontes com vínculo por id (não têm cancelamento: qualquer linha bloqueia). */
const outraFonteVinculada = async (tx, clienteId, loteId) => {
  for (const fonte of FONTES_JSON) {
    const [linha] = /** @type {Array<{n: number}>} */ (
      await tx.$queryRaw`
        SELECT COUNT(*)::int AS n FROM ${Prisma.raw(`"${fonte.tabela}"`)} d
         WHERE d.cliente_id = ${clienteId}
           AND (d.dados->>'lote_id' = ${loteId} OR d.dados->>'lote_destino_id' = ${loteId})`
    );
    if (linha?.n) return fonte.motivo;
  }
  const tarefas = await tx.lancamentoTarefa.count({ where: { cliente_id: clienteId, lote_id: loteId } });
  if (tarefas) return 'lancamentos_tarefa';
  return null;
};

/**
 * Cancelamentos com prova: o movimento nasceu do comando de manejo e a
 * operação idempotente de cancelamento está confirmada apontando para ele.
 * Devolve os ids de auditoria que esses comandos (efeito + reversão) gravaram.
 */
const provarCancelamentos = async (tx, clienteId, cancelados) => {
  const chaves = cancelados.map((m) => m.cancel_op).filter((k) => typeof k === 'string' && k);
  const operacoes = chaves.length
    ? await tx.operacaoIdempotente.findMany({
        where: { cliente_id: clienteId, tipo_operacao: TIPO_OPERACAO_CANCELAMENTO, operation_key: { in: chaves } },
        select: { operation_key: true, status: true, response_json: true },
      })
    : [];
  const porChave = new Map(operacoes.map((o) => [o.operation_key, o]));
  const explicadas = new Set();
  for (const m of cancelados) {
    const op = m.cancel_op ? porChave.get(m.cancel_op) : null;
    const resposta = /** @type {any} */ (op?.response_json);
    if (m.comando !== COMANDO_MANEJO || !op || op.status !== 'committed' || resposta?.movimentacao?.id !== m.id) {
      return { ok: false, movimentacao_id: m.id };
    }
    for (const lista of [m.dados?.efeito_servidor?.efeitos, m.dados?.cancelamento?.efeitos]) {
      for (const e of Array.isArray(lista) ? lista : []) {
        if (typeof e?.auditoria_id === 'string') explicadas.add(e.auditoria_id);
      }
    }
  }
  return { ok: true, explicadas };
};

/**
 * Toda linha de auditoria do lote tem explicação: criação; edição que manteve
 * o lote no retrato da entrada antes e depois (correção do lançamento, peso,
 * nome…); ou efeito/reversão de comando cancelado com prova. O resto é
 * alteração operacional sem comprovação — inclusive ida e volta de saldo.
 */
const auditoriaExplicada = async (tx, clienteId, loteId, explicadas) => {
  const linhas = await tx.auditLog.findMany({
    where: { cliente_id: clienteId, entidade: 'Lote', entidade_id: loteId },
    select: { id: true, acao: true, dados_anteriores: true, dados_novos: true },
  });
  for (const l of linhas) {
    if (l.acao === 'create') continue;
    if (explicadas.has(l.id)) continue;
    const a = /** @type {any} */ (l.dados_anteriores);
    const n = /** @type {any} */ (l.dados_novos);
    if (l.acao === 'update' && noEstadoDeEntrada(a) && noEstadoDeEntrada(n)) continue;
    return { ok: false, auditoria_id: l.id };
  }
  return { ok: true };
};

/**
 * Classifica a exclusão de UM lote. Chamar com o lote já travado e relido na
 * mesma transação (o DELETE faz isso; a elegibilidade só lê).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {Record<string, any>} lote linha do banco (mesmo tenant)
 * @returns {Promise<{tipo: string, motivo: string|null, detalhes: Record<string, unknown>}>}
 */
export const avaliarExclusaoLote = async (tx, clienteId, lote) => {
  if (lote.excluido_em) return { tipo: TIPO_JA_EXCLUIDO, motivo: null, detalhes: {} };
  if (origemDerivadaDeManejo(lote.origem)) return bloqueio('lote_gerado_por_manejo');

  const outra = await outraFonteVinculada(tx, clienteId, lote.id);
  if (outra) return bloqueio(outra);

  const legado = await temLegadoPorNome(tx, clienteId, lote);
  if (legado) return bloqueio('vinculo_legado_por_nome', { fonte: legado });

  const movimentos = await movimentosQueCitam(tx, clienteId, lote.id);
  const ativo = movimentos.find((m) => m.situacao !== SITUACAO_CANCELADO);
  if (ativo) return bloqueio('movimentacao_ativa', { movimentacao_id: ativo.id });

  const prova = await provarCancelamentos(tx, clienteId, movimentos);
  if (!prova.ok) return bloqueio('cancelamento_nao_comprovado', { movimentacao_id: prova.movimentacao_id });

  if (!noEstadoDeEntrada(lote)) return bloqueio('estado_divergente_da_entrada');

  const auditoria = await auditoriaExplicada(tx, clienteId, lote.id, prova.explicadas);
  if (!auditoria.ok) return bloqueio('alteracao_sem_comprovacao', { auditoria_id: auditoria.auditoria_id });

  const anexos = await tx.registroAnexo.count({ where: { cliente_id: clienteId, entidade: 'Lote', entidade_id: lote.id } });
  if (movimentos.length || anexos) {
    return { tipo: TIPO_LOGICA, motivo: movimentos.length ? 'historico_somente_cancelado' : 'anexos_preservados', detalhes: { cancelados: movimentos.length, anexos } };
  }
  return { tipo: TIPO_FISICA, motivo: null, detalhes: {} };
};
