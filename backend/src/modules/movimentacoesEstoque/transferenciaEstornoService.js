/**
 * D-PROD-268 — CANCELAMENTO (estorno exato) da TRANSFERÊNCIA entre depósitos.
 *
 * Contrato (só online; a tela não enfileira):
 *   GET  /movimentacoes-estoque/:id/elegibilidade-cancelamento-transferencia?empresa_id=…  (ensaio, sem gravar)
 *   POST /movimentacoes-estoque/:id/cancelar-transferencia  { empresa_id, motivo, operation_id }
 *
 * O `:id` é o de QUALQUER perna do par: a Saída `transferencia_enviada` (S) ou a Entrada
 * `transferencia_recebida` (R). O tenant vem SEMPRE do auth_context (R11); do corpo só entram a
 * empresa (conferida no tenant), o motivo e a chave. Quantidade, custo, locais e data são do servidor.
 *
 * Uma transação faz tudo ou nada (TRANSACAO_LONGA: a tela persiste e reenvia a MESMA chave):
 *   1. permissão relida do banco (`exigirCancelamentoLancamentosEstoque`: administrador real,
 *      `is_admin` ou a chave gravadora `cancelar_lancamentos_estoque` `=== true`) — negada → 403 sem recibo;
 *   2. recibo idempotente (`executarComIdempotencia`, tipo `cancelar_transferencia_locais`, FORA dos
 *      recibos de comando de estoque da reconciliação): mesma chave + mesmo corpo → replay; outro corpo → 409;
 *   3. empresa do tenant e o "hoje" da fazenda (data dos estornos);
 *   4. o MOTOR (`estornarTransferenciaEstoque`) faz o resto, com as próprias travas (locais → produto →
 *      camadas → S/R) e TODOS os cintos antes da primeira escrita: par S/R coerente, legado sem fatias
 *      recusa, estado 'Ativa', regra do ÚLTIMO nos DOIS depósitos (qualquer movimento posterior do produto
 *      em qualquer um deles recusa — D-PROD-264), camadas do destino intocadas, devolução cabível na
 *      origem, prova de saldo e limite; origem INATIVA → 422 `ESTOQUE_LOCAL_INVALIDO` `local_inativo`;
 *   5. numeração dos dois estornos NO FIM (E_d = n, E_o = n + 1) e AuditLog (dois `create` e o evento
 *      `movimentacao_estoque.cancelar_transferencia` na Saída).
 * Nada é apagado: S e R ficam 'Estornada' e nascem os dois movimentos de estorno.
 *
 * A elegibilidade (GET) ensaia o MESMO motor dentro de SAVEPOINT e desfaz; não grava recibo nem
 * AuditLog. O POST revalida tudo sob trava.
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import {
  CHAVE_CANCELAR_LANCAMENTOS_ESTOQUE,
  carregarAutorizacao,
  exigirCancelamentoLancamentosEstoque,
  podeCancelarLancamentosEstoque,
} from '../../shared/auth/autorizacaoTela.js';
import { AppError } from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { TRANSACAO_LONGA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEventosEmLote } from '../auditoria/auditService.js';
import { CASAS_QUANTIDADE, dec } from '../financeiro/decimalFinanceiro.js';
import { unidadeEstoqueEfetiva } from '../produtos/produtoUnidadesConversao.js';
import {
  descobrirParDeTransferencia,
  estornarTransferenciaEstoque,
  exigirLocaisEstoque,
  numerarMovimentos,
  numeroMovimentoProvisorio,
  travarProdutosEstoque,
} from '../estoqueFisico/estoqueFisicoMotor.js';
import { aplicarExclusaoComRecalculo, planejarExclusaoComRecalculo } from '../estoqueRecalculo/estoqueExclusaoRecalculo.js';
import { exigirEmpresaDoTenant } from '../gestao/gestaoComum.js';
import { hojeDaEmpresa } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import { comoPublico } from './movimentacaoEstoqueService.js';

/** Tipo do recibo (≤ VarChar(64)); fica FORA de `TIPOS_RECIBO` da reconciliação de propósito. */
export const TIPO_OPERACAO_CANCELAR_TRANSFERENCIA = 'cancelar_transferencia_locais';
/** Ação do AuditLog do cancelamento (na Saída S). */
export const ACAO_AUDITORIA_CANCELAR_TRANSFERENCIA = 'movimentacao_estoque.cancelar_transferencia';

export const MOTIVO_MIN = 3;
export const MOTIVO_MAX = 500;

const invalido = (field, reason, mensagem) =>
  new AppError('REQUEST_VALIDATION_FAILED', mensagem, { details: { field, reason } });

/**
 * Corpo do POST normalizado: chave (8..128), empresa e motivo (trim, 3..500). Recusa antes de qualquer I/O.
 * @param {string} id @param {Record<string, unknown>} corpo
 */
export const normalizarCancelamento = (id, corpo) => {
  const operationId = typeof corpo?.operation_id === 'string' ? corpo.operation_id.trim() : '';
  if (operationId.length < 8 || operationId.length > 128) throw invalido('operation_id', 'format', 'operation_id inválido');
  const empresaId = typeof corpo?.empresa_id === 'string' ? corpo.empresa_id.trim() : '';
  if (!empresaId) throw invalido('empresa_id', 'required', 'empresa_id é obrigatório');
  const motivo = typeof corpo?.motivo === 'string' ? corpo.motivo.trim() : '';
  if (motivo.length < MOTIVO_MIN || motivo.length > MOTIVO_MAX) {
    throw invalido('motivo', 'format', `informe o motivo do cancelamento (${MOTIVO_MIN} a ${MOTIVO_MAX} caracteres)`);
  }
  const movimentacaoId = typeof id === 'string' ? id.trim() : '';
  if (!movimentacaoId) throw invalido('id', 'required', 'id da movimentação é obrigatório');
  return { operation_id: operationId, empresa_id: empresaId, motivo, movimentacao_id: movimentacaoId };
};

/** Fingerprint do recibo: o id como veio no path, a empresa e o motivo normalizado. */
const fingerprintDoCancelamento = (e) =>
  fingerprintDePayload({ acao: TIPO_OPERACAO_CANCELAR_TRANSFERENCIA, movimentacao_id: e.movimentacao_id, empresa_id: e.empresa_id, motivo: e.motivo });

const relerMovimento = (tx, cli, id) => tx.movimentacaoEstoque.findUnique({ where: { cliente_id_id: { cliente_id: cli, id } } });

const kg = (v) => (v === null || v === undefined ? null : dec(v).toFixed(CASAS_QUANTIDADE));

/**
 * O que o cancelamento faz (para a tela), lido do par: produto, quantidade, valor, origem → destino e números.
 * @param {any} s @param {any} r @param {{ origem?: { id: string, nome: string|null }, destino?: { id: string, nome: string|null } }} [locais]
 */
const efeitosDoPar = (s, r, locais = {}) => ({
  movimentacao_saida_id: s.id,
  movimentacao_entrada_id: r.id,
  produto_id: s.produto_id,
  produto_nome: s.produto_nome ?? null,
  quantidade: kg(s.quantidade),
  // D-PROD-369: o rótulo real do movimento (a unidade de estoque do produto); o SACO legado e o vazio são KG.
  unidade: unidadeEstoqueEfetiva({ unidade_principal_estoque: s.unidade_medida }),
  valor_total: s.valor_total === null || s.valor_total === undefined ? null : dec(s.valor_total).toFixed(2),
  origem: { id: s.local_estoque_origem, nome: locais.origem?.nome ?? s.local_origem ?? null },
  destino: { id: s.local_estoque_destino, nome: locais.destino?.nome ?? s.local_destino ?? r.local_destino ?? null },
  numero_saida: s.numero_movimentacao ?? null,
  numero_entrada: r.numero_movimentacao ?? null,
  data_movimentacao: s.data_movimentacao instanceof Date ? s.data_movimentacao.toISOString() : s.data_movimentacao ?? null,
});

/**
 * D-PROD-273 (fatia 5) — o cancelamento, com ou sem recálculo, numa transação já aberta (o POST e o ensaio da
 * elegibilidade). Descobre o par, trava locais → produto (a ordem do motor) e planeja: nada depois nos dois depósitos →
 * o estorno exato de sempre (`estornarTransferenciaEstoque`, sem mudança); algo depois → a prova do recálculo (replay =
 * gravado, simulação sem a transferência: saldo negativo em qualquer depósito → 409 `ESTOQUE_EXCLUSAO_SALDO_NEGATIVO`;
 * contagem de inventário depois → 409 `ajuste_de_inventario_posterior`; sem estorno exato como saída), o estorno sem
 * tocar nas camadas (`recalculo: true`) e o recálculo de tudo que veio depois, com a marca dos dois pares.
 * @param {any} tx @param {any} contexto @param {{ empresaId: string, movimentoId: string, dia: string, motivo: string, numeros?: { destino?: string, origem?: string } }} a
 */
const cancelarNaTransacao = async (tx, contexto, a) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const antes = await descobrirParDeTransferencia(tx, cli, { empresaId: a.empresaId, movimentoId: a.movimentoId });
  const locais = await exigirLocaisEstoque(tx, cli, [
    { id: antes.origemId, field: 'local_origem_id', exigirAtivo: false },
    { id: antes.destinoId, field: 'local_destino_id', exigirAtivo: false },
  ]);
  // A descoberta de novo, já sob a trava do produto (um cancelamento concorrente que venceu → `original_ja_estornado`,
  // como antes, e não uma recusa do recálculo).
  await travarProdutosEstoque(tx, cli, a.empresaId, [antes.produtoId]);
  const par = await descobrirParDeTransferencia(tx, cli, { empresaId: a.empresaId, movimentoId: a.movimentoId });
  // Origem inativa: o motor recusa (422 `local_inativo`) antes de qualquer escrita, como antes — sem planejar.
  const planos = !locais.get(par.origemId)?.ativo ? [] : await planejarExclusaoComRecalculo(tx, cli, {
    empresaId: a.empresaId,
    movimentos: [{ id: par.saida.id, produtoId: par.produtoId, localId: par.origemId }, { id: par.entrada.id, produtoId: par.produtoId, localId: par.destinoId }],
  });
  const t = await estornarTransferenciaEstoque(tx, contexto, {
    empresaId: a.empresaId, movimentoId: a.movimentoId, dia: a.dia, motivo: a.motivo, operacaoId: null, numeros: a.numeros, recalculo: planos.length > 0,
  });
  const recalculo = planos.length
    ? await aplicarExclusaoComRecalculo(tx, contexto, planos, {
      empresaId: a.empresaId, origem: 'transferencia', motivo: `Cancelamento da transferência ${t.saida.numero_movimentacao}: ${a.motivo}`.slice(0, 255),
      estornos: new Map([[t.saida.id, t.estornoOrigem.id], [t.entrada.id, t.estornoDestino.id]]),
    })
    : null;
  return { t, recalculo };
};

/**
 * POST /movimentacoes-estoque/:id/cancelar-transferencia.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id id de S ou de R (só alvo; o tenant vem do auth_context)
 * @param {Record<string, unknown>} corpo { empresa_id, motivo, operation_id }
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
 */
export const cancelarTransferencia = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const e = normalizarCancelamento(id, corpo);
  const fingerprint = fingerprintDoCancelamento(e);
  const r = await emTransacao(TRANSACAO_LONGA, async (tx) => {
    // Reconfere DENTRO da transação (revogação concorrente vale), antes do recibo: negado não deixa recibo.
    await exigirCancelamentoLancamentosEstoque(contexto, tx);
    return executarComIdempotencia(tx, {
      clienteId: cli,
      operationKey: e.operation_id,
      tipoOperacao: TIPO_OPERACAO_CANCELAR_TRANSFERENCIA,
      fingerprint,
      executar: async () => {
        const empresaId = await exigirEmpresaDoTenant(tx, cli, e.empresa_id);
        const tempo = await hojeDaEmpresa(tx, cli, empresaId);
        const { t, recalculo } = await cancelarNaTransacao(tx, contexto, {
          empresaId,
          movimentoId: e.movimentacao_id,
          dia: tempo.hoje,
          motivo: e.motivo,
          numeros: { destino: numeroMovimentoProvisorio(), origem: numeroMovimentoProvisorio() },
        });
        // Sequência de movimentos só no FIM: E_d = n, E_o = n + 1.
        await numerarMovimentos(tx, cli, [t.estornoDestino.id, t.estornoOrigem.id]);
        const [saida, entrada, estornoDestino, estornoOrigem] = await Promise.all(
          [t.saida.id, t.entrada.id, t.estornoDestino.id, t.estornoOrigem.id].map((mid) => relerMovimento(tx, cli, mid)),
        );
        const publicos = {
          movimentacao_saida: comoPublico(saida),
          movimentacao_entrada: comoPublico(entrada),
          estorno_destino: comoPublico(estornoDestino),
          estorno_origem: comoPublico(estornoOrigem),
        };
        await registrarEventosEmLote(contexto, [
          { acao: 'create', entidade: 'MovimentacaoEstoque', entidadeId: estornoDestino.id, dadosNovos: publicos.estorno_destino },
          { acao: 'create', entidade: 'MovimentacaoEstoque', entidadeId: estornoOrigem.id, dadosNovos: publicos.estorno_origem },
          {
            acao: ACAO_AUDITORIA_CANCELAR_TRANSFERENCIA,
            entidade: 'MovimentacaoEstoque',
            entidadeId: saida.id,
            dadosAnteriores: { status_saida: 'Ativa', status_entrada: 'Ativa', entrada_id: entrada.id },
            dadosNovos: {
              status: 'Estornada',
              status_entrada: entrada.status,
              entrada_id: entrada.id,
              estornos: [estornoDestino.id, estornoOrigem.id],
              quantidade: kg(t.quantidade),
              local_origem_id: t.origem.id,
              local_destino_id: t.destino.id,
              motivo_informado: true,
              recalculo,
            },
          },
        ], tx);
        return {
          httpStatus: 200,
          body: {
            committed: true,
            operation_id: e.operation_id,
            replay: false,
            ...publicos,
            devolvido: t.devolvido,
            recalculo,
          },
        };
      },
    });
  });
  return { status: 200, body: { ...r.body, replay: r.replay } };
};

/**
 * GET /movimentacoes-estoque/:id/elegibilidade-cancelamento-transferencia — só informativa.
 * 404 (movimento inexistente, de outro tenant ou de outra empresa; empresa fora do tenant) sobe como erro.
 * Qualquer recusa de negócio vira `{ elegivel: false, codigo, motivo, detalhes }`.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id
 * @param {string} empresaIdInformada
 */
export const elegibilidadeCancelamentoTransferencia = async (contexto, id, empresaIdInformada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  return emTransacao(TRANSACAO_LONGA, async (tx) => {
    const podeCancelar = podeCancelarLancamentosEstoque(await carregarAutorizacao(contexto, tx));
    const empresaId = await exigirEmpresaDoTenant(tx, cli, typeof empresaIdInformada === 'string' ? empresaIdInformada.trim() : empresaIdInformada);
    const comum = { movimentacao_id: id, pode_cancelar: podeCancelar, requer_permissao: CHAVE_CANCELAR_LANCAMENTOS_ESTOQUE, modo: 'estorno_transferencia' };
    const recusado = (erro, efeitos = null) => ({
      ...comum, elegivel: false, codigo: erro.code, motivo: erro.message, detalhes: erro.details ?? null, efeitos,
    });
    let par;
    try {
      par = await descobrirParDeTransferencia(tx, cli, { empresaId, movimentoId: id });
    } catch (erro) {
      if (erro instanceof AppError && erro.code !== 'MOVIMENTACAO_ESTOQUE_NOT_FOUND') return recusado(erro);
      throw erro;
    }
    const efeitosPar = efeitosDoPar(par.saida, par.entrada);
    const tempo = await hojeDaEmpresa(tx, cli, empresaId);
    await tx.$executeRawUnsafe('SAVEPOINT elegibilidade_cancelar_transferencia');
    try {
      const { t, recalculo } = await cancelarNaTransacao(tx, contexto, { empresaId, movimentoId: id, dia: tempo.hoje, motivo: 'ensaio' });
      return {
        ...comum,
        elegivel: true,
        codigo: null,
        motivo: null,
        detalhes: null,
        efeitos: { ...efeitosDoPar(par.saida, par.entrada, { origem: t.origem, destino: t.destino }), devolvido: t.devolvido, recalculo },
      };
    } catch (erro) {
      if (erro instanceof AppError) return recusado(erro, efeitosPar);
      throw erro;
    } finally {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT elegibilidade_cancelar_transferencia');
    }
  });
};
