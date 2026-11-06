/**
 * Serviço de EstoqueLoteNota (P5.4).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { exigirSomenteColunasGravaveis } from '../../shared/prisma/colunasGravaveis.js';
import { atorDoTenant, ehAdminTenantAtivo, tenantAdminRequired } from '../../shared/auth/exigirAdminTenant.js';
import {
  listarRegistros,
  buscarRegistro,
  inserirRegistro,
  atualizarRegistroPorId,
  excluirRegistroPorId,
} from './estoqueLoteNotaRepository.js';



const erroNaoEncontrado = () => new AppError('ESTOQUE_LOTE_NOT_FOUND', 'EstoqueLoteNota não encontrado');

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

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id */
export const buscarPorId = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registro = await buscarRegistro(auth.clienteId, id);
  if (!registro) throw erroNaoEncontrado();
  return comoPublico(registro);
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const criado = await prisma.$transaction(async (tx) => {
    /** @type {Record<string, unknown>} */
    const dados = { ...exigirSomenteColunasGravaveis('EstoqueLoteNota', entrada), cliente_id: auth.clienteId };

    const registro = await inserirRegistro(tx, dados);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: 'EstoqueLoteNota', entidadeId: registro.id, dadosNovos: comoPublico(registro) },
      tx
    );
    return registro;
  });
  return comoPublico(criado);
};

/**
 * D-PROD-136 (F5/F7). O lote de nota compõe saldo e custo FIFO do depósito; o
 * POST e o estorno são só do administrador real. Por isso o PATCH:
 *  - aceita de QUALQUER conta só `local_estoque_nome` — a renomeação do depósito
 *    (FormularioPonto) propaga o nome DEPOIS de renomear o LocalEstoque;
 *  - qualquer outra coluna (quantidade, custo, status...) só do administrador
 *    real, relido no banco dentro da transação; a concessão is_admin não basta;
 *  - o nome é conferido contra o LocalEstoque vinculado (local_estoque_id) no
 *    mesmo tenant, para todos — admin inclusive (mesma regra do
 *    MovimentacaoEstoque). Relação ou chave desconhecida → 400.
 */
export const CAMPOS_PATCH_DE_QUALQUER_CONTA = Object.freeze(['local_estoque_nome']);

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const atualizado = await prisma.$transaction(async (tx) => {
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    const patch = exigirSomenteColunasGravaveis('EstoqueLoteNota', entrada);
    const restritos = Object.keys(patch).filter((campo) => {
      if (CAMPOS_PATCH_DE_QUALQUER_CONTA.includes(campo)) return false;
      // clientes antigos reenviam a empresa atual
      return !(campo === 'empresa_id' && patch.empresa_id === existente.empresa_id);
    });
    if (restritos.length && !ehAdminTenantAtivo(await atorDoTenant(contexto, tx))) throw tenantAdminRequired();
    if (Object.prototype.hasOwnProperty.call(patch, 'local_estoque_nome')) {
      const nome = typeof patch.local_estoque_nome === 'string' ? patch.local_estoque_nome.trim() : '';
      const localId = Object.prototype.hasOwnProperty.call(patch, 'local_estoque_id') ? patch.local_estoque_id : existente.local_estoque_id;
      const local = typeof localId === 'string' && localId
        ? await tx.localEstoque.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: localId } }, select: { nome: true } })
        : null;
      if (!local || !nome || local.nome !== nome) {
        throw new AppError('NOME_LOCAL_DIVERGENTE', 'nome não corresponde ao local vinculado ao lote de nota', {
          details: { field: 'local_estoque_nome' },
        });
      }
      patch.local_estoque_nome = nome;
    }
    const registro = await atualizarRegistroPorId(tx, auth.clienteId, id, patch);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'EstoqueLoteNota',
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

export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  await prisma.$transaction(async (tx) => {
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    await excluirRegistroPorId(tx, auth.clienteId, id);
    await registrarEvento(
      contexto,
      { acao: 'delete', entidade: 'EstoqueLoteNota', entidadeId: id, dadosAnteriores: comoPublico(existente) },
      tx
    );
  });
};
