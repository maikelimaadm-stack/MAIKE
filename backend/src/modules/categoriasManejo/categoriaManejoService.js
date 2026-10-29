/**
 * Serviço de CategoriaManejo (P5.4).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError, catalogoGlobalInvalid } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { exigirCategoriaVisualLoteVinculavel } from '../catalogoGlobal/catalogoValidacao.js';
import {
  listarRegistros,
  buscarRegistro,
  inserirRegistro,
  atualizarRegistroPorId,
  excluirRegistroPorId,
} from './categoriaManejoRepository.js';



const erroNaoEncontrado = () => new AppError('CATEGORIA_MANEJO_NOT_FOUND', 'CategoriaManejo não encontrado');

const CAMPO_VINCULO = 'catalogo_categoria_visual_id';

/**
 * Normaliza e valida o vínculo opcional com a categoria visual global
 * (D-PROD-69). Ausente no corpo → não mexe; `null`/'' → remove o vínculo;
 * id → só categoria ativa do tipo oficial `lote`. O tenant escolhe a
 * categoria; o ícone continua sendo do catálogo global.
 *
 * Na edição, reenviar o MESMO vínculo já gravado não revalida: se a categoria
 * oficial foi desativada depois, o cadastro antigo continua editável.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Record<string, unknown>} dados
 * @param {Record<string, unknown> | null} [existente]
 */
const validarVinculoCatalogo = async (tx, dados, existente = null) => {
  if (!Object.prototype.hasOwnProperty.call(dados, CAMPO_VINCULO)) return dados;
  const valor = dados[CAMPO_VINCULO];
  if (valor === null || valor === '') return { ...dados, [CAMPO_VINCULO]: null };
  if (typeof valor !== 'string' || valor.length > 64) {
    throw catalogoGlobalInvalid('identificador de categoria oficial inválido', { campo: CAMPO_VINCULO });
  }
  if (existente && existente[CAMPO_VINCULO] === valor) return dados;
  await exigirCategoriaVisualLoteVinculavel(tx, valor);
  return dados;
};

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
    const dados = await validarVinculoCatalogo(tx, { ...entrada, cliente_id: auth.clienteId });

    const registro = await inserirRegistro(tx, dados);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: 'CategoriaManejo', entidadeId: registro.id, dadosNovos: comoPublico(registro) },
      tx
    );
    return registro;
  });
  return comoPublico(criado);
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const atualizado = await prisma.$transaction(async (tx) => {
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    const dados = await validarVinculoCatalogo(tx, { ...entrada }, existente);
    const registro = await atualizarRegistroPorId(tx, auth.clienteId, id, dados);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'CategoriaManejo',
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
      { acao: 'delete', entidade: 'CategoriaManejo', entidadeId: id, dadosAnteriores: comoPublico(existente) },
      tx
    );
  });
};
