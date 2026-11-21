/**
 * Serviço de SuplementacaoLote (P5.5).
 */
import { exigirLotesDosDocumentos } from '../../shared/lotes/loteVivo.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { documentoComoPublico, montarDocumento } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import { exigirNumerosOuNulo, exigirSomenteCamposPermitidos, movimentoExigeCancelamento } from '../../shared/operacional/protecaoOperacional.js';
import { TRANSACAO_CURTA, emTransacao, MENSAGEM_CONFLITO_SEM_CHAVE } from '../../shared/prisma/transacaoConcorrente.js';
import {
  documentoCancelado,
  lerParaAtualizar,
  rejeitarReservadosDaSuplementacao,
  textoOuNulo,
  travarCocho,
} from '../suplementacaoEventos/suplementacaoCocho.js';
import {
  listarRegistros,
  buscarRegistro,
  inserirRegistro,
  atualizarRegistroPorId,
} from './suplementacaoLoteRepository.js';

const ENTIDADE = 'SuplementacaoLote';
const erroNaoEncontrado = () => new AppError('SUPLEMENTACAOLOTE_NOT_FOUND', 'SuplementacaoLote não encontrado');

export const listar = async (contexto, filtros = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarRegistros(auth.clienteId, filtros);
  return registros.map(documentoComoPublico);
};

const registroCancelado = (entidade, id) =>
  new AppError('SUPLEMENTACAO_REGISTRO_CANCELADO', 'este lançamento de suplementação foi cancelado e não aceita alteração', { details: { entidade, id } });

/**
 * D-PROD-268 — o evento-pai do rateio: com cocho, toma a trava dele e relê o evento sob
 * `FOR UPDATE`; evento cancelado → 409 `SUPLEMENTACAO_REGISTRO_CANCELADO`. Sem evento (legado)
 * ou evento de outro tenant: null (nada a travar).
 * @param {any} tx @param {string} cli @param {unknown} eventoId
 */
const travarEventoPai = async (tx, cli, eventoId) => {
  const id = textoOuNulo(eventoId);
  if (!id) return null;
  const previa = await tx.suplementacaoEvento.findUnique({ where: { cliente_id_id: { cliente_id: cli, id } } });
  if (!previa) return null;
  const ponto = textoOuNulo(previa.dados?.ponto_suplementacao_id);
  if (ponto) await travarCocho(tx, cli, previa.empresa_id, ponto);
  const evento = await lerParaAtualizar(tx, 'SuplementacaoEvento', cli, id);
  if (evento && documentoCancelado(evento.dados)) throw registroCancelado('SuplementacaoEvento', id);
  return evento;
};

/**
 * POST genérico do rateio (legado). D-PROD-268: campos reservados → 400; evento-pai cancelado → 409;
 * com a trava do cocho do evento-pai.
 */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  rejeitarReservadosDaSuplementacao(entrada);
  const criado = await emTransacao(TRANSACAO_CURTA, async (tx) => {
    const dados = montarDocumento(auth.clienteId, entrada);
    await travarEventoPai(tx, auth.clienteId, dados.dados.suplementacao_evento_id);
    // Lote excluído do cadastro não recebe registro novo (MAIKE-LOTES-R1).
    await exigirLotesDosDocumentos(tx, auth.clienteId, [dados.dados]);
    const registro = await inserirRegistro(tx, dados);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: ENTIDADE, entidadeId: registro.id, dadosNovos: documentoComoPublico(registro) },
      tx
    );
    return registro;
  }, {}, MENSAGEM_CONFLITO_SEM_CHAVE);
  return documentoComoPublico(criado);
};

export const criarEmLote = async (contexto, registros) => {
  const auth = exigirAuthContext(contexto?.auth);
  if (!Array.isArray(registros) || registros.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'lista vazia');
  }
  for (const entrada of registros) rejeitarReservadosDaSuplementacao(entrada);
  const criados = await emTransacao(TRANSACAO_CURTA, async (tx) => {
    const saida = [];
    // Trava cada evento-pai uma vez, em ordem de id (sem deadlock entre dois bulks).
    const pais = [...new Set(registros.map((r) => textoOuNulo(r?.suplementacao_evento_id)).filter(Boolean))].sort();
    for (const pai of pais) await travarEventoPai(tx, auth.clienteId, pai);
    for (const entrada of registros) {
      const dados = montarDocumento(auth.clienteId, entrada);
      // Lote excluído do cadastro não recebe registro novo (MAIKE-LOTES-R1).
      await exigirLotesDosDocumentos(tx, auth.clienteId, [dados.dados]);
      const registro = await inserirRegistro(tx, dados);
      saida.push(registro);
    }
    return saida;
  }, {}, MENSAGEM_CONFLITO_SEM_CHAVE);
  return criados.map(documentoComoPublico);
};

/**
 * R2A (D-PROD-99): o evento compõe saída de estoque e rateio por lote. PATCH só
 * aceita as métricas de fechamento/reabertura de período (métricas de consumo do lote no período), que não mexem
 * em saldo; qualquer outro campo → REGISTRO_OPERACIONAL_IMUTAVEL, nada gravado.
 */
export const CAMPOS_PATCH_PERMITIDOS = Object.freeze([
  'dias_periodo',
  'consumo_unitario_dia',
  'consumo_por_cabeca_dia_kg',
  'consumo_total_lote_periodo_kg',
  'percentual_consumo_lote',
  'animal_dias_periodo',
  'dias_ativos_periodo',
]);

/** @param {unknown} v */
const nulo = (v) => v === null || v === undefined;

/**
 * PATCH do fechamento/reabertura do lote do período. D-PROD-268: transação curta, trava do cocho
 * do evento-pai e a linha `FOR UPDATE`; lote ou evento-pai cancelado → 409
 * `SUPLEMENTACAO_REGISTRO_CANCELADO`; na transição de fechamento (`dias_periodo` nulo →
 * preenchido) o evento-pai DE COCHO tem de estar ATIVO e JÁ fechado (o front grava o evento antes
 * dos lotes) — senão 409 `LANCAMENTO_DESATUALIZADO`. Lote de evento sem cocho (legado) fecha como antes.
 */
export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const atualizado = await emTransacao(TRANSACAO_CURTA, async (tx) => {
    const previa = await buscarRegistro(cli, id, tx);
    if (!previa) throw erroNaoEncontrado();
    const paiId = textoOuNulo(previa.dados?.suplementacao_evento_id);
    const pai = await travarEventoPai(tx, cli, paiId);
    const existente = await lerParaAtualizar(tx, 'SuplementacaoLote', cli, id);
    if (!existente) throw erroNaoEncontrado();
    if (textoOuNulo(existente.dados?.suplementacao_evento_id) !== paiId) throw new AppError('CONCURRENCY_CONFLICT', MENSAGEM_CONFLITO_SEM_CHAVE);
    if (documentoCancelado(existente.dados)) throw registroCancelado(ENTIDADE, id);
    exigirSomenteCamposPermitidos(entrada, CAMPOS_PATCH_PERMITIDOS, { entidade: ENTIDADE, empresaAtual: existente.empresa_id });
    exigirNumerosOuNulo(entrada, ENTIDADE);
    const fechando = Object.prototype.hasOwnProperty.call(entrada, 'dias_periodo') && !nulo(entrada.dias_periodo) && nulo(existente.dados?.dias_periodo);
    // Lote sem evento-pai de cocho (legado) fecha como antes: não há cadeia de períodos a proteger.
    if (fechando && pai && textoOuNulo(pai.dados?.ponto_suplementacao_id) && nulo(pai.dados?.dias_periodo)) {
      throw new AppError('LANCAMENTO_DESATUALIZADO', 'o lote só fecha depois do evento do período; recarregue; nada foi gravado', {
        details: { field: 'dias_periodo', reason: 'evento_aberto', suplementacao_evento_id: paiId },
      });
    }
    const patch = montarDocumento(cli, { ...documentoComoPublico(existente), ...entrada }, { atualizacao: true, id, dadosAnteriores: existente.dados });
    await exigirLotesDosDocumentos(tx, cli, [patch.dados]);
    const registro = await atualizarRegistroPorId(tx, cli, id, patch);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: ENTIDADE,
        entidadeId: id,
        dadosAnteriores: documentoComoPublico(existente),
        dadosNovos: documentoComoPublico(registro),
      },
      tx
    );
    return registro;
  }, {}, MENSAGEM_CONFLITO_SEM_CHAVE);
  return documentoComoPublico(atualizado);
};

/** R2A (D-PROD-99): DELETE desmontaria o evento sem devolver estoque — nada é removido. */
export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const existente = await buscarRegistro(auth.clienteId, id);
  if (!existente) throw erroNaoEncontrado();
  throw movimentoExigeCancelamento(ENTIDADE);
};

