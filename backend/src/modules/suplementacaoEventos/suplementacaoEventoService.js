/**
 * Serviço de SuplementacaoEvento (P5.5).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { documentoComoPublico, montarDocumento } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import { exigirSomenteCamposPermitidos, movimentoExigeCancelamento } from '../../shared/operacional/protecaoOperacional.js';
import { CAMPOS_PATCH_PERMITIDOS, CAMPO_FECHADO_POR_EVENTO, CAMPO_FECHADO_POR_TIPO, exigirTiposDoFechamento } from './camposFechamentoEvento.js';
import { TRANSACAO_CURTA, emTransacao, MENSAGEM_CONFLITO_SEM_CHAVE } from '../../shared/prisma/transacaoConcorrente.js';
import {
  documentoCancelado,
  eventosAtivosDoCocho,
  lerParaAtualizar,
  rejeitarReservadosDaSuplementacao,
  textoOuNulo,
  travarCocho,
} from './suplementacaoCocho.js';
import {
  listarRegistros,
  buscarRegistro,
  inserirRegistro,
  atualizarRegistroPorId,
} from './suplementacaoEventoRepository.js';

const ENTIDADE = 'SuplementacaoEvento';
const erroNaoEncontrado = () => new AppError('SUPLEMENTACAOEVENTO_NOT_FOUND', 'SuplementacaoEvento não encontrado');

export const listar = async (contexto, filtros = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarRegistros(auth.clienteId, filtros);
  return registros.map(documentoComoPublico);
};

/**
 * POST genérico (legado: o evento automático da chegada do gado, `DetalhesLote.jsx`). D-PROD-267:
 * recusa os campos reservados (400 `CAMPO_RESERVADO_CANCELAMENTO`) e, com cocho, toma a trava dele
 * antes de inserir (serializa com o cancelamento, o fechamento e o lançamento).
 */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  rejeitarReservadosDaSuplementacao(entrada);
  const criado = await emTransacao(TRANSACAO_CURTA, async (tx) => {
    const dados = montarDocumento(auth.clienteId, entrada);
    const ponto = textoOuNulo(dados.dados.ponto_suplementacao_id);
    if (ponto) await travarCocho(tx, auth.clienteId, dados.empresa_id, ponto);
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
  const prisma = getPrismaClient();
  const criados = await prisma.$transaction(async (tx) => {
    const saida = [];
    for (const entrada of registros) {
      const dados = montarDocumento(auth.clienteId, entrada);
      const registro = await inserirRegistro(tx, dados);
      saida.push(registro);
    }
    return saida;
  });
  return criados.map(documentoComoPublico);
};

/**
 * R2A (D-PROD-99): o evento compõe saída de estoque e rateio por lote. PATCH só
 * aceita o que o fechamento/reabertura do período grava — as métricas do período
 * (sobra, dias, consumo diário do grupo) e, desde a D-PROD-212, os campos do
 * fechamento do consumo (farol, %PV, custo, peso médio, sobra herdada), cada um
 * com o seu tipo (`camposFechamentoEvento.js`). Nada disso mexe em saldo;
 * qualquer outro campo → REGISTRO_OPERACIONAL_IMUTAVEL, nada gravado.
 */
export { CAMPOS_PATCH_PERMITIDOS };

/** @param {unknown} v */
const nulo = (v) => v === null || v === undefined;

/** 409 do fechamento que não é mais verdade no cocho (cancelado, desatualizado, fora de ordem). */
const fechamentoInvalido = (reason, extra = {}) =>
  new AppError('LANCAMENTO_DESATUALIZADO', `o fechamento do período não confere com o cocho agora (${reason}); recarregue; nada foi gravado`, {
    details: { field: CAMPO_FECHADO_POR_TIPO, reason, ...extra },
  });

/**
 * D-PROD-267 — o fechamento (transição `dias_periodo` nulo → preenchido) diz QUEM fechou:
 *  - `'lancamento'`: `fechado_por_evento_id` é um evento ATIVO do mesmo cocho e empresa, o evento
 *    fechado é o predecessor ATIVO imediato dele e `sobra_kg` do patch é a sobra dele;
 *  - `'movimentacao_gado'`: sem evento; o evento fechado é o ÚLTIMO ativo do cocho.
 * Fora da transição, `fechado_por_*` só passa se for igual ao gravado. Evento sem cocho (legado,
 * sem cadeia de períodos e sem cancelamento) fecha como antes. Senão 409, nada gravado.
 * Assim um PATCH atrasado (fila offline, aba antiga) não fecha o período em nome de um
 * lançamento já cancelado.
 * @param {any} tx @param {string} cli @param {any} existente @param {Record<string, unknown>} entrada
 */
const exigirFechamentoCoerente = async (tx, cli, existente, entrada) => {
  const dados = existente.dados ?? {};
  const fechando = Object.prototype.hasOwnProperty.call(entrada, 'dias_periodo') && !nulo(entrada.dias_periodo) && nulo(dados.dias_periodo);
  const temOrigem = Object.prototype.hasOwnProperty.call(entrada, CAMPO_FECHADO_POR_TIPO) || Object.prototype.hasOwnProperty.call(entrada, CAMPO_FECHADO_POR_EVENTO);
  if (!fechando) {
    if (!temOrigem) return;
    const igual = (c) => !Object.prototype.hasOwnProperty.call(entrada, c) || (entrada[c] ?? null) === (dados[c] ?? null);
    if (!igual(CAMPO_FECHADO_POR_TIPO) || !igual(CAMPO_FECHADO_POR_EVENTO)) throw fechamentoInvalido('origem_fora_do_fechamento');
    return;
  }
  const ponto = textoOuNulo(dados.ponto_suplementacao_id);
  // Evento sem cocho (legado): não há cadeia de períodos a proteger nem cancelamento possível.
  if (!ponto) {
    if (temOrigem) throw fechamentoInvalido('evento_sem_cocho');
    return;
  }
  const tipo = entrada[CAMPO_FECHADO_POR_TIPO];
  if (tipo !== 'lancamento' && tipo !== 'movimentacao_gado') throw fechamentoInvalido('fechado_por_ausente');
  const ativos = await eventosAtivosDoCocho(tx, cli, existente.empresa_id, ponto);
  const posicao = ativos.findIndex((e) => e.id === existente.id);
  if (posicao < 0) throw fechamentoInvalido('evento_inativo');
  if (tipo === 'movimentacao_gado') {
    if (!nulo(entrada[CAMPO_FECHADO_POR_EVENTO])) throw fechamentoInvalido('movimentacao_com_evento');
    if (posicao !== ativos.length - 1) throw fechamentoInvalido('nao_e_o_ultimo', { evento_posterior_id: ativos[ativos.length - 1].id });
    return;
  }
  const fechadorId = textoOuNulo(entrada[CAMPO_FECHADO_POR_EVENTO]);
  const fechador = fechadorId ? ativos.find((e) => e.id === fechadorId) : null;
  if (!fechador) throw fechamentoInvalido('lancamento_inexistente_ou_cancelado', { fechado_por_evento_id: fechadorId });
  if (ativos[ativos.indexOf(fechador) - 1]?.id !== existente.id) throw fechamentoInvalido('nao_e_o_predecessor', { fechado_por_evento_id: fechadorId });
  const sobraPatch = Number(entrada.sobra_kg);
  const sobraNova = Number(fechador.dados?.sobra_kg ?? 0);
  if (!Number.isFinite(sobraPatch) || Math.abs(sobraPatch - sobraNova) > 1e-9) throw fechamentoInvalido('sobra_divergente', { fechado_por_evento_id: fechadorId });
};

/**
 * PATCH do fechamento/reabertura do período. D-PROD-267: numa transação curta, com a trava do
 * cocho e a linha `FOR UPDATE`; documento cancelado → 409 `SUPLEMENTACAO_REGISTRO_CANCELADO`;
 * a transição de fechamento passa por `exigirFechamentoCoerente`.
 */
export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const atualizado = await emTransacao(TRANSACAO_CURTA, async (tx) => {
    const previa = await buscarRegistro(cli, id, tx);
    if (!previa) throw erroNaoEncontrado();
    const ponto = textoOuNulo(previa.dados?.ponto_suplementacao_id);
    if (ponto) await travarCocho(tx, cli, previa.empresa_id, ponto);
    const existente = await lerParaAtualizar(tx, 'SuplementacaoEvento', cli, id);
    if (!existente) throw erroNaoEncontrado();
    if (textoOuNulo(existente.dados?.ponto_suplementacao_id) !== ponto) {
      throw new AppError('CONCURRENCY_CONFLICT', MENSAGEM_CONFLITO_SEM_CHAVE);
    }
    if (documentoCancelado(existente.dados)) {
      throw new AppError('SUPLEMENTACAO_REGISTRO_CANCELADO', 'este lançamento de suplementação foi cancelado e não aceita alteração', { details: { entidade: ENTIDADE, id } });
    }
    exigirSomenteCamposPermitidos(entrada, CAMPOS_PATCH_PERMITIDOS, { entidade: ENTIDADE, empresaAtual: existente.empresa_id });
    exigirTiposDoFechamento(entrada, ENTIDADE);
    await exigirFechamentoCoerente(tx, cli, existente, entrada);
    const patch = montarDocumento(cli, { ...documentoComoPublico(existente), ...entrada }, { atualizacao: true, id, dadosAnteriores: existente.dados });
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

