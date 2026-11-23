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
import { dec } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant } from '../gestao/gestaoComum.js';
import { CLASSE, classificar, compararComGravado, compararCanonico, reproduzir, simularExclusao } from './estoqueReplay.js';
import {
  ORIGEM_ABASTECIMENTO, ORIGEM_AJUSTE_ESTOQUE, ORIGEM_APONTAMENTO, ORIGEM_SAIDA_ESTOQUE, ORIGEM_SISTEMA, ORIGEM_SUPLEMENTACAO,
  TIPO_FALTA_AJUSTE, TIPO_SOBRA_AJUSTE, ehOrigemEntradaDocumentada,
} from '../estoqueFisico/estoqueFisicoMotor.js';
import { buscarMovimentoPosterior } from '../estoqueFisico/movimentoPosterior.js';
import {
  TETO_MOVIMENTOS_AFETADOS, TETO_MOVIMENTOS_PRODUTO, buscarAjustePosterior, emLeituraSomente, lerDependentes, lerHistoricoDoProduto, volumeExcedido,
} from './estoqueRecalculoLeitor.js';

/** Recusa de negócio da prévia (o recálculo não é seguro; `details.reason` diz por quê). */
export const recalculoInviavel = (reason, extra = {}, mensagem = undefined) =>
  new AppError('ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL', mensagem ?? `a exclusão com recálculo não pode ser prevista com segurança (${reason}); nada foi alterado`, {
    details: { field: 'movimento_id', reason, ...extra },
  });

const DIVERGENCIAS_MOSTRADAS = 20;

/** D-PROD-273 (escolha do proprietário, 2026-11-23): razão da recusa com ajuste de inventário depois. Nunca contornável. */
export const RAZAO_AJUSTE_POSTERIOR = 'ajuste_de_inventario_posterior';

/**
 * Recusa: há uma contagem de inventário (sobra/falta de ajuste vigente) depois do movimento, num depósito que a exclusão
 * mudaria. Excluir (com recálculo ou pelo estorno exato) deixaria o estoque diferente do contado. Completa o número do
 * ajuste quando só veio o id (a simulação não lê o cabeçalho).
 * @param {any} tx @param {string} cli
 * @param {{ local_estoque_id?: string, movimento_id?: string, movimento_numero?: string, ajuste_id?: string|null, ajuste_numero?: string|null }} d
 */
export const recusaAjustePosterior = async (tx, cli, d) => {
  let ajusteNumero = d.ajuste_numero ?? null;
  if (!ajusteNumero && d.ajuste_id) ajusteNumero = (await tx.ajusteEstoque.findFirst({ where: { cliente_id: cli, id: d.ajuste_id }, select: { numero: true } }))?.numero ?? null;
  const qual = ajusteNumero ? `ajuste nº ${ajusteNumero}` : `movimento nº ${d.movimento_numero}`;
  return recalculoInviavel(RAZAO_AJUSTE_POSTERIOR, {
    local_estoque_id: d.local_estoque_id ?? null, movimento_id: d.movimento_id ?? null, movimento_numero: d.movimento_numero ?? null,
    ajuste_id: d.ajuste_id ?? null, ajuste_numero: ajusteNumero,
  }, `há uma contagem de inventário (${qual}) depois deste movimento no depósito; exclua a contagem primeiro ou faça uma nova contagem; nada foi alterado`);
};

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
 * Recusa do recálculo que as origens que já estornavam pelo valor exato (abastecimento, atividade, venda) contornam
 * com o estorno exato de antes da fatia 4: inviável (qualquer motivo), volume acima do teto e cocho ocupado. Saldo
 * negativo NUNCA é contornado.
 * @param {unknown} erro
 */
export const ehRecusaContornavel = (erro) => {
  const e = /** @type {any} */ (erro);
  if (!(e instanceof AppError)) return false;
  // Ajuste de inventário depois: o estorno exato também deixaria o saldo acima/abaixo do contado — nunca contorna.
  if (e.details?.reason === RAZAO_AJUSTE_POSTERIOR) return false;
  if (e.code === 'ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL' || e.code === 'ESTOQUE_RECALCULO_VOLUME_EXCEDIDO') return true;
  return e.code === 'CONCURRENCY_CONFLICT' && e.details?.reason === 'cocho_ocupado';
};

/** D-PROD-273 (fatia 4): origens que, com o recálculo inviável, fazem o estorno exato (sem recalcular). */
export const ORIGENS_ESTORNO_EXATO_SE_INVIAVEL = Object.freeze([ORIGEM_ABASTECIMENTO, ORIGEM_APONTAMENTO, ORIGEM_SISTEMA]);
/**
 * Origens cujo documento exclui TODOS os movimentos dele juntos (a prévia simula o documento inteiro): venda e compra
 * do financeiro, saída manual, entrada documentada (fatia 5) e ajuste de inventário (fatia 5: sobras e faltas juntas).
 */
const ORIGENS_DOCUMENTO_INTEIRO = Object.freeze([ORIGEM_SISTEMA, ORIGEM_SAIDA_ESTOQUE, ORIGEM_AJUSTE_ESTOQUE]);
/** A origem é de um documento inteiro (a entrada documentada é reconhecida pelo motor — D-PROD-257). @param {string} o */
const ehDocumentoInteiro = (o) => ORIGENS_DOCUMENTO_INTEIRO.includes(o) || ehOrigemEntradaDocumentada(o);

/**
 * Os movimentos que a exclusão de `m` exclui junto: a transferência (as duas pernas) ou, no documento (venda, compra,
 * saída manual, entrada documentada, ajuste), os outros movimentos do MESMO produto do mesmo documento (o cancelamento é
 * do documento inteiro). No ajuste, a sobra e a falta do produto vão juntas.
 * @param {any} tx @param {string} cli @param {any} m
 * @returns {Promise<string[]>}
 */
const excluidosJuntos = async (tx, cli, m) => {
  if (m.tipo_detalhado === 'transferencia_enviada' || m.tipo_detalhado === 'transferencia_recebida') {
    return [m.tipo_detalhado === 'transferencia_enviada' ? m.id : m.movimento_pai_id, m.tipo_detalhado === 'transferencia_enviada' ? m.movimento_filho_id : m.id].filter(Boolean);
  }
  const ehEstorno = typeof m.tipo_detalhado === 'string' && m.tipo_detalhado.startsWith('estorno_');
  if (!ehDocumentoInteiro(m.origem_sistema) || !m.lancamento_origem_id || ehEstorno) return [m.id];
  const doAjuste = m.origem_sistema === ORIGEM_AJUSTE_ESTOQUE;
  const irmaos = await tx.movimentacaoEstoque.findMany({
    where: {
      cliente_id: cli, empresa_id: m.empresa_id, produto_id: m.produto_id, lancamento_origem_id: m.lancamento_origem_id, origem_sistema: m.origem_sistema,
      ...(doAjuste ? { tipo_detalhado: { in: [TIPO_SOBRA_AJUSTE, TIPO_FALTA_AJUSTE] } } : { tipo_detalhado: m.tipo_detalhado, tipo_movimentacao: m.tipo_movimentacao }),
      status: 'Ativa', movimento_filho_id: null,
    },
    select: { id: true },
  });
  return [...new Set([m.id, ...irmaos.map((x) => x.id)])].sort();
};

/**
 * A exclusão faria o estorno exato de sempre: nenhum dos movimentos teve outro DEPOIS no depósito dele (a mesma
 * consulta dos serviços; no cocho, descontando os pares neutros).
 */
const nadaDepois = async (tx, cli, m, ids) => {
  const lidos = await tx.movimentacaoEstoque.findMany({
    where: { cliente_id: cli, id: { in: ids } }, select: { id: true, numero_movimentacao: true, createdAt: true, local_estoque_origem: true, local_estoque_destino: true },
  });
  for (const x of lidos) {
    const locais = [x.local_estoque_origem, x.local_estoque_destino].filter((v) => typeof v === 'string' && v);
    if (!locais.length) return false;
    const depois = await buscarMovimentoPosterior(tx, cli, {
      empresaId: m.empresa_id, produtoId: m.produto_id, locais, ignorarIds: ids,
      desde: { createdAt: x.createdAt, numero: x.numero_movimentacao }, ignorarParesNeutros: m.origem_sistema === ORIGEM_SUPLEMENTACAO,
    });
    if (depois) return false;
  }
  return true;
};

/**
 * D-PROD-273 (fatia 5) — a camada da ENTRADA `movimentoId` continua intocada: uma só, 'Disponivel', disponível = entrada e
 * custo = o valor unitário do movimento (nenhuma reavaliação do poço a alcançou). Então nada lançado depois foi valorizado
 * com o custo dela e o estorno exato de sempre (tirar a camada inteira, pelo custo dela) é o mesmo que o recálculo daria.
 * @param {any} tx @param {string} cli @param {string} movimentoId
 */
export const entradaIntocada = async (tx, cli, movimentoId) => {
  const [m] = /** @type {any[]} */ (await tx.$queryRaw`SELECT valor_unitario FROM "MovimentacaoEstoque" WHERE cliente_id = ${cli} AND id = ${movimentoId}`);
  const camadas = /** @type {any[]} */ (await tx.$queryRaw`SELECT status, quantidade_entrada, quantidade_disponivel, custo_unitario FROM "EstoqueLoteNota"
    WHERE cliente_id = ${cli} AND movimentacao_entrada_id = ${movimentoId}`);
  if (!m || m.valor_unitario === null || camadas.length !== 1) return false;
  const [l] = camadas;
  return l.status === 'Disponivel' && dec(l.quantidade_disponivel).eq(dec(l.quantidade_entrada)) && dec(l.custo_unitario).eq(dec(m.valor_unitario));
};

/**
 * Ajuste de inventário vigente depois de algum dos movimentos `ids`, no depósito dele (origem ou destino).
 * @param {any} tx @param {string} cli @param {string} empresaId @param {string} produtoId @param {string[]} ids
 */
export const ajusteDepoisDe = async (tx, cli, empresaId, produtoId, ids) => {
  const lidos = await tx.movimentacaoEstoque.findMany({
    where: { cliente_id: cli, id: { in: ids } }, select: { id: true, numero_movimentacao: true, createdAt: true, local_estoque_origem: true, local_estoque_destino: true },
  });
  for (const x of lidos) {
    const ajuste = await buscarAjustePosterior(tx, cli, {
      empresaId, produtoId, locais: [x.local_estoque_origem, x.local_estoque_destino], ignorarIds: ids, desde: { createdAt: x.createdAt, numero: x.numero_movimentacao },
    });
    if (ajuste) return ajuste;
  }
  return null;
};

/**
 * GET …/exclusao/previa. `autorizar(origem)` é a guarda da exclusão correspondente (a rota escolhe pela origem do
 * movimento lido); roda depois de achar o movimento e antes de ler o histórico.
 *
 * D-PROD-273 (fatia 4) — `modo` diz o que a exclusão VAI fazer:
 *  - `estorno_exato`: nada foi lançado depois (mesmo com histórico que não se sabe recalcular) — nada é lido além;
 *  - `recalculo`: o que mudaria (movimentos, depósitos, camadas, dependentes);
 *  - `estorno_exato_sem_recalculo` (abastecimento, atividade, venda): o recálculo não é possível (`aviso`), e a
 *    exclusão faz o estorno exato de antes, sem recalcular os posteriores — não é recusa.
 * Na venda e na saída manual, simula juntas as saídas do mesmo produto do documento (o cancelamento é do documento).
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
    const ehEstorno = typeof m.tipo_detalhado === 'string' && m.tipo_detalhado.startsWith('estorno_');
    const juntos = await excluidosJuntos(tx, cli, m);
    const vazio = { movimentos_lidos: 0, movimentos_posteriores: 0, depositos_afetados: [], movimentos: [], depositos: [], camadas: [], dependentes: [], gravado: false, recusa: null, aviso: null };
    // Ajuste de inventário depois, no depósito do movimento (ou da outra perna): recusa, nem recálculo nem estorno exato.
    const recusaDeAjuste = (erro) => ({
      ...vazio, movimento: resumoDoMovimento(m), excluidos: juntos, permitido: false, modo: null,
      recusa: { code: erro.code, message: erro.message, ...erro.details },
    });
    if (m.status === 'Ativa' && !m.movimento_filho_id && !ehEstorno) {
      const ajuste = await ajusteDepoisDe(tx, cli, empresaId, m.produto_id, juntos);
      if (ajuste) return recusaDeAjuste(await recusaAjustePosterior(tx, cli, ajuste));
    }
    // D-PROD-273 (fatia 5): entrada (documentada ou compra) com a camada intocada → o estorno exato de antes, como o serviço.
    const entradasIntocadas = async () => m.tipo_movimentacao === 'Entrada' && (m.origem_sistema === ORIGEM_SISTEMA || ehOrigemEntradaDocumentada(m.origem_sistema))
      && (await Promise.all(juntos.map((id) => entradaIntocada(tx, cli, id)))).every(Boolean);
    if (m.status === 'Ativa' && !m.movimento_filho_id && !ehEstorno && juntos.length && (await nadaDepois(tx, cli, m, juntos) || await entradasIntocadas())) {
      return { ...vazio, movimento: resumoDoMovimento(m), excluidos: juntos, permitido: true, modo: 'estorno_exato' };
    }
    const contorna = ORIGENS_ESTORNO_EXATO_SE_INVIAVEL.includes(m.origem_sistema) && m.tipo_movimentacao === 'Saída' && !ehEstorno;
    const semRecalculo = (erro) => ({
      ...vazio, movimento: resumoDoMovimento(m), excluidos: juntos, permitido: true, modo: 'estorno_exato_sem_recalculo',
      aviso: { code: erro.code, reason: erro.details?.reason ?? null },
    });
    try {
      const historico = await lerHistoricoDoProduto(tx, cli, empresaId, m.produto_id, { teto: o.teto ?? TETO_MOVIMENTOS_PRODUTO });
      const porId = new Map(historico.movimentos.map((x) => [x.id, x]));
      const excluir = [...new Set([...excluidosDe(m, porId), ...juntos])].sort();
      if (m.movimentacao_grupo_id !== null && m.movimentacao_grupo_id !== undefined && m.status === 'Ativa') {
        throw recalculoInviavel('grupo_legado_preenchido', { movimento_id: m.id });
      }
      const primeiro = historico.movimentos.filter((x) => excluir.includes(x.id)).sort(compararCanonico)[0];
      const afetados = historico.movimentos.filter((x) => compararCanonico(x, primeiro) > 0 && !excluir.includes(x.id)).length;
      const tetoAfetados = o.tetoAfetados ?? TETO_MOVIMENTOS_AFETADOS;
      if (afetados > tetoAfetados) throw volumeExcedido({ afetados, teto: tetoAfetados });
      const base = exigirReplayIgualAoGravado(historico);
      const sim = simularExclusao(historico, base, excluir);
      const dependentes = sim.permitido ? await lerDependentes(tx, cli, empresaId, sim.movimentos.map((x) => x.id)) : [];
      const { reason, ...detalhes } = sim.recusa ?? { reason: null };
      if (!sim.permitido && reason === RAZAO_AJUSTE_POSTERIOR) return recusaDeAjuste(await recusaAjustePosterior(tx, cli, detalhes));
      if (!sim.permitido && reason !== 'saldo_negativo' && contorna) return semRecalculo(recalculoInviavel(reason, detalhes));
      return {
        movimento: resumoDoMovimento(m),
        excluidos: excluir,
        permitido: sim.permitido,
        modo: sim.permitido ? 'recalculo' : null,
        recusa: sim.permitido ? null : {
          code: reason === 'saldo_negativo' ? 'ESTOQUE_EXCLUSAO_SALDO_NEGATIVO' : 'ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL',
          reason,
          ...detalhes,
        },
        aviso: null,
        movimentos_lidos: historico.movimentos.length,
        movimentos_posteriores: afetados,
        depositos_afetados: sim.afetados,
        movimentos: sim.movimentos,
        depositos: sim.depositos,
        camadas: sim.camadas,
        dependentes,
        gravado: false,
      };
    } catch (erro) {
      if (contorna && ehRecusaContornavel(erro) && m.status === 'Ativa' && !m.movimento_filho_id) return semRecalculo(erro);
      throw erro;
    }
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
