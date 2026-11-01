/**
 * Serviço de MovimentacaoEstoque (P5.4).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { exigirSomenteCamposPermitidos, movimentoExigeCancelamento } from '../../shared/operacional/protecaoOperacional.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import {
  listarRegistros,
  buscarRegistro,
  inserirRegistro,
  atualizarRegistroPorId,
} from './movimentacaoEstoqueRepository.js';

export const ENTIDADE_SEQUENCIA = 'MovimentacaoEstoque';

const erroNaoEncontrado = () => new AppError('MOVIMENTACAO_ESTOQUE_NOT_FOUND', 'MovimentacaoEstoque não encontrado');

/** @param {Record<string, unknown>} registro */
export const comoPublico = (registro) => {
  // eslint-disable-next-line no-unused-vars -- tenant não exposto na API pública
  const { createdAt, updatedAt, cliente_id, ...resto } = registro;
  return {
    ...resto,
    created_date: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    updated_date: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
  };
};

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const listar = async (contexto, filtros = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarRegistros(auth.clienteId, filtros);
  return registros.map(comoPublico);
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const criado = await prisma.$transaction(async (tx) => {
    /** @type {Record<string, unknown>} */
    const dados = { ...entrada, cliente_id: auth.clienteId };
    if (Object.prototype.hasOwnProperty.call(dados, 'numero_movimentacao')) {
      delete dados.numero_movimentacao;
    }
    dados.numero_movimentacao = String(
      await reservarNumero(tx, {
        clienteId: auth.clienteId,
        entidade: ENTIDADE_SEQUENCIA,
        escopoTipo: ESCOPO_TENANT,
      })
    );
    const registro = await inserirRegistro(tx, dados);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: 'MovimentacaoEstoque', entidadeId: registro.id, dadosNovos: comoPublico(registro) },
      tx
    );
    return registro;
  });
  return comoPublico(criado);
};

/**
 * R2A (D-PROD-97): movimento de estoque compõe saldo, FIFO e custo. PATCH aceita
 * SÓ o nome exibido do local (`local_origem`/`local_destino`), que a renomeação
 * de depósito propaga (`FormularioPonto`). O nome é conferido contra o
 * `LocalEstoque` vinculado ao movimento (`local_estoque_origem`/`_destino`) no
 * mesmo tenant: não muda id de local, quantidade, custo, produto, tipo ou data.
 */
export const CAMPOS_PATCH_PERMITIDOS = Object.freeze(['local_origem', 'local_destino']);

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const atualizado = await prisma.$transaction(async (tx) => {
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    exigirSomenteCamposPermitidos(entrada, CAMPOS_PATCH_PERMITIDOS, { entidade: 'MovimentacaoEstoque', empresaAtual: existente.empresa_id });
    const patch = {};
    for (const [campo, campoId] of [
      ['local_origem', 'local_estoque_origem'],
      ['local_destino', 'local_estoque_destino'],
    ]) {
      if (!Object.prototype.hasOwnProperty.call(entrada, campo)) continue;
      const localId = existente[campoId];
      const nome = typeof entrada[campo] === 'string' ? entrada[campo].trim() : '';
      const local = localId
        ? await tx.localEstoque.findUnique({
            where: { cliente_id_id: { cliente_id: auth.clienteId, id: localId } },
            select: { nome: true },
          })
        : null;
      if (!local || !nome || local.nome !== nome) {
        throw new AppError('NOME_LOCAL_DIVERGENTE', 'nome não corresponde ao local vinculado ao movimento', {
          details: { field: campo },
        });
      }
      patch[campo] = nome;
    }
    if (Object.keys(patch).length === 0) return existente;
    const registro = await atualizarRegistroPorId(tx, auth.clienteId, id, patch);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'MovimentacaoEstoque',
        entidadeId: id,
        dadosAnteriores: comoPublico(existente),
        dadosNovos: comoPublico(registro),
      },
      tx
    );
    return registro;
  });
  return comoPublico(atualizado);
};

/** R2A (D-PROD-97): DELETE apagaria saldo/FIFO sem estorno — nada é removido. */
export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const existente = await buscarRegistro(auth.clienteId, id);
  if (!existente) throw erroNaoEncontrado();
  throw movimentoExigeCancelamento('MovimentacaoEstoque');
};

