/**
 * Serviço de SuplementacaoLote (P5.5).
 */
import { exigirLotesDosDocumentos } from '../../shared/lotes/loteVivo.js';
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { documentoComoPublico, montarDocumento } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import { exigirNumerosOuNulo, exigirSomenteCamposPermitidos, movimentoExigeCancelamento } from '../../shared/operacional/protecaoOperacional.js';
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

export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const criado = await prisma.$transaction(async (tx) => {
    const dados = montarDocumento(auth.clienteId, entrada);
    // Lote excluído do cadastro não recebe registro novo (MAIKE-LOTES-R1).
    await exigirLotesDosDocumentos(tx, auth.clienteId, [dados.dados]);
    const registro = await inserirRegistro(tx, dados);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: ENTIDADE, entidadeId: registro.id, dadosNovos: documentoComoPublico(registro) },
      tx
    );
    return registro;
  });
  return documentoComoPublico(criado);
};

export const criarEmLote = async (contexto, registros) => {
  const auth = exigirAuthContext(contexto?.auth);
  if (!Array.isArray(registros) || registros.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'lista vazia');
  }
  const prisma = getPrismaClient();
  const criados = await prisma.$transaction(async (tx) => {
    const saida = [];
    for (const entrada of registros) {
      const dados = montarDocumento(auth.clienteId, entrada);
      // Lote excluído do cadastro não recebe registro novo (MAIKE-LOTES-R1).
      await exigirLotesDosDocumentos(tx, auth.clienteId, [dados.dados]);
      const registro = await inserirRegistro(tx, dados);
      saida.push(registro);
    }
    return saida;
  });
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

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const atualizado = await prisma.$transaction(async (tx) => {
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    exigirSomenteCamposPermitidos(entrada, CAMPOS_PATCH_PERMITIDOS, { entidade: ENTIDADE, empresaAtual: existente.empresa_id });
    exigirNumerosOuNulo(entrada, ENTIDADE);
    const patch = montarDocumento(auth.clienteId, { ...documentoComoPublico(existente), ...entrada }, { atualizacao: true, id, dadosAnteriores: existente.dados });
    await exigirLotesDosDocumentos(tx, auth.clienteId, [patch.dados]);
    const registro = await atualizarRegistroPorId(tx, auth.clienteId, id, patch);
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
  });
  return documentoComoPublico(atualizado);
};

/** R2A (D-PROD-99): DELETE desmontaria o evento sem devolver estoque — nada é removido. */
export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const existente = await buscarRegistro(auth.clienteId, id);
  if (!existente) throw erroNaoEncontrado();
  throw movimentoExigeCancelamento(ENTIDADE);
};

