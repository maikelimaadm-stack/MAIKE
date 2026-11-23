/**
 * D-PROD-273 (fatia 3) — PRÉVIA da exclusão com recálculo (sem nenhuma escrita) e a auditoria "replay = gravado".
 *
 * `previaExclusao`: numa transação SOMENTE LEITURA, lê todo o histórico do produto do movimento, prova que o replay
 * sem exclusão reproduz exatamente o gravado (senão recusa: não se recalcula o que não se sabe reproduzir), simula
 * a sequência SEM o movimento (e o par dele) e devolve o que mudaria — ou a recusa `ESTOQUE_EXCLUSAO_SALDO_NEGATIVO`
 * com o depósito, o movimento e o saldo. Lista também os dependentes fora do estoque dos movimentos que mudam
 * (SPEC §3), só identificados. O tenant vem do `auth_context` (R11); nada do pedido escolhe tenant.
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { exigirEmpresaDoTenant } from '../gestao/gestaoComum.js';
import { CLASSE, classificar, compararComGravado, compararCanonico, reproduzir, simularExclusao } from './estoqueReplay.js';
import { TETO_MOVIMENTOS_AFETADOS, TETO_MOVIMENTOS_PRODUTO, emLeituraSomente, lerDependentes, lerHistoricoDoProduto, volumeExcedido } from './estoqueRecalculoLeitor.js';

/** Recusa de negócio da prévia (o recálculo não é seguro; `details.reason` diz por quê). */
export const recalculoInviavel = (reason, extra = {}, mensagem = undefined) =>
  new AppError('ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL', mensagem ?? `a exclusão com recálculo não pode ser prevista com segurança (${reason}); nada foi alterado`, {
    details: { field: 'movimento_id', reason, ...extra },
  });

const DIVERGENCIAS_MOSTRADAS = 20;

/**
 * Movimento a excluir e o par dele (transferência: S e R). Recusa estorno, excluído e o que o motor não gravou.
 * @param {any} m @param {Map<string, any>} porId
 * @returns {string[]}
 */
const excluidosDe = (m, porId) => {
  const classe = classificar(m, porId);
  if (m.status !== 'Ativa' || m.movimento_filho_id && classe !== CLASSE.TRANSFERENCIA_ENVIADA) throw recalculoInviavel('movimento_ja_excluido', { movimento_id: m.id }, 'este movimento já foi excluído; nada foi alterado');
  if (classe === CLASSE.FORA_DO_PROTOCOLO) throw recalculoInviavel('origem_nao_suportada', { movimento_id: m.id, origem_sistema: m.origem_sistema });
  if (/** @type {string[]} */ ([CLASSE.ESTORNO_SAIDA, CLASSE.ESTORNO_ENTRADA, CLASSE.ESTORNO_TRANSFERENCIA_ENVIADA, CLASSE.ESTORNO_TRANSFERENCIA_RECEBIDA]).includes(classe)) {
    throw recalculoInviavel('movimento_e_estorno', { movimento_id: m.id }, 'o movimento é o estorno de outro; exclua o original; nada foi alterado');
  }
  if (classe === CLASSE.TRANSFERENCIA_ENVIADA || classe === CLASSE.TRANSFERENCIA_RECEBIDA) {
    const s = classe === CLASSE.TRANSFERENCIA_ENVIADA ? m : porId.get(m.movimento_pai_id);
    const r = s?.movimento_filho_id ? porId.get(s.movimento_filho_id) : null;
    if (!s || !r || r.movimento_pai_id !== s.id) throw recalculoInviavel('par_de_transferencia_incoerente', { movimento_id: m.id });
    if (s.status !== 'Ativa' || r.status !== 'Ativa' || r.movimento_filho_id) throw recalculoInviavel('movimento_ja_excluido', { movimento_id: m.id }, 'esta transferência já foi excluída; nada foi alterado');
    return [s.id, r.id];
  }
  return [m.id];
};

const resumoDoMovimento = (m) => ({
  id: m.id, numero: m.numero_movimentacao, tipo: m.tipo_movimentacao, tipo_detalhado: m.tipo_detalhado ?? null, origem_sistema: m.origem_sistema,
  produto_id: m.produto_id, local_origem_id: m.local_estoque_origem ?? null, local_destino_id: m.local_estoque_destino ?? null,
  quantidade: m.quantidade === null ? null : m.quantidade.toFixed(4),
});

/**
 * Replay sem exclusão = gravado, ou a recusa. Devolve o replay base.
 * @param {{ movimentos: any[], camadas: any[], cutover: any }} historico
 */
export const exigirReplayIgualAoGravado = (historico) => {
  const base = reproduzir(historico);
  if (!base.reproduzivel) {
    throw recalculoInviavel('historico_nao_reproduzivel', {
      problemas: [...base.problemas, ...(base.parada ? [base.parada] : [])].slice(0, DIVERGENCIAS_MOSTRADAS),
    }, 'o histórico deste produto tem movimentos que o recálculo não sabe reproduzir; nada foi alterado');
  }
  const divergencias = compararComGravado(base, historico);
  if (divergencias.length) {
    throw recalculoInviavel('replay_diverge_do_gravado', { divergencias: divergencias.length, amostra: divergencias.slice(0, DIVERGENCIAS_MOSTRADAS) },
      'o recálculo sem exclusão não reproduz os valores gravados deste produto; nada foi alterado');
  }
  return base;
};

/**
 * GET …/exclusao/previa. `autorizar(origem)` é a guarda da exclusão correspondente (a rota escolhe pela origem do
 * movimento lido); roda depois de achar o movimento e antes de ler o histórico.
 * @param {{ auth: any }} contexto @param {string} movimentoId @param {{ empresa_id?: string }} query
 * @param {{ autorizar?: (origem: string) => Promise<void>, teto?: number, tetoAfetados?: number }} [o]
 */
export const previaExclusao = async (contexto, movimentoId, query = {}, o = {}) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  return emLeituraSomente(async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, query.empresa_id);
    const m = await tx.movimentacaoEstoque.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: movimentoId } } });
    if (!m || m.empresa_id !== empresaId) throw new AppError('MOVIMENTACAO_ESTOQUE_NOT_FOUND', 'movimento de estoque não encontrado');
    if (o.autorizar) await o.autorizar(m.origem_sistema);
    const historico = await lerHistoricoDoProduto(tx, cli, empresaId, m.produto_id, { teto: o.teto ?? TETO_MOVIMENTOS_PRODUTO });
    const porId = new Map(historico.movimentos.map((x) => [x.id, x]));
    const excluir = excluidosDe(m, porId);
    const primeiro = historico.movimentos.filter((x) => excluir.includes(x.id)).sort(compararCanonico)[0];
    const afetados = historico.movimentos.filter((x) => compararCanonico(x, primeiro) > 0 && !excluir.includes(x.id)).length;
    const tetoAfetados = o.tetoAfetados ?? TETO_MOVIMENTOS_AFETADOS;
    if (afetados > tetoAfetados) throw volumeExcedido({ afetados, teto: tetoAfetados });
    const base = exigirReplayIgualAoGravado(historico);
    const sim = simularExclusao(historico, base, excluir);
    const dependentes = sim.permitido ? await lerDependentes(tx, cli, empresaId, sim.movimentos.map((x) => x.id)) : [];
    const { reason, ...detalhes } = sim.recusa ?? { reason: null };
    return {
      movimento: resumoDoMovimento(m),
      excluidos: excluir,
      permitido: sim.permitido,
      recusa: sim.permitido ? null : {
        code: reason === 'saldo_negativo' ? 'ESTOQUE_EXCLUSAO_SALDO_NEGATIVO' : 'ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL',
        reason,
        ...detalhes,
      },
      movimentos_lidos: historico.movimentos.length,
      movimentos_posteriores: afetados,
      depositos_afetados: sim.afetados,
      movimentos: sim.movimentos,
      depositos: sim.depositos,
      camadas: sim.camadas,
      dependentes,
      gravado: false,
    };
  });
};

/**
 * Auditoria "replay = gravado" de um produto (o script de ops e os testes): sem exclusão, devolve as divergências.
 * @param {any} tx @param {string} cli @param {string} empresaId @param {string} produtoId @param {{ teto?: number, cutover?: number|null }} [o]
 */
export const auditarReplayDoProduto = async (tx, cli, empresaId, produtoId, o = {}) => {
  const historico = await lerHistoricoDoProduto(tx, cli, empresaId, produtoId, o);
  const base = reproduzir(historico);
  const divergencias = base.parada ? [] : compararComGravado(base, historico);
  return {
    movimentos: historico.movimentos.length,
    camadas: historico.camadas.length,
    reproduzivel: base.reproduzivel,
    problemas: base.problemas,
    parada: base.parada,
    divergencias,
    legados: [...base.resultados.values()].filter((r) => r.regra === 'legado').length,
  };
};
