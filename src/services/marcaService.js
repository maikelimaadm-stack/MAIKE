/**
 * Service de marcas — persistência nativa (P4.4-Marcas, D-PROD-42).
 *
 * Unicidade de nome por empresa continua no service para falha rápida na UI, mas
 * a numeração e a constraint definitiva vivem no backend.
 */

import { listMarcas, createMarca, updateMarca, deleteMarca } from '@/apis/marcas';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

const chaveDeNome = (valor) => String(valor ?? '').trim().toUpperCase();

/** Marcas da empresa, mais recentes primeiro (ordem do backend). */
export const listarMarcasDaEmpresa = async (empresaId) => {
  const todas = await listMarcas();
  return todas.filter((marca) => marca.empresa_id === empresaId);
};

/** Marcas ativas da empresa — opções do formulário de produto. */
export const listarMarcasAtivas = async (empresaId) => {
  const todas = await listMarcas();
  return todas.filter((marca) => marca.empresa_id === empresaId && marca.ativo !== false);
};

const assertNomeLivre = (marcas, nome, ignorarId) => {
  const alvo = chaveDeNome(nome);
  const conflito = marcas.some((marca) => marca.id !== ignorarId && chaveDeNome(marca.nome) === alvo);
  if (conflito) {
    throw new ApiError(API_ERROR_CODES.MARCA_NAME_CONFLICT, {
      operation: 'criarMarca',
      resource: 'Marca',
      details: { campo: 'nome' },
    });
  }
};

export const criarMarca = async ({ dados, empresaId, marcasDaEmpresa = [] }) => {
  assertNomeLivre(marcasDaEmpresa, dados?.nome);
  return createMarca({ ...dados, empresa_id: empresaId });
};

export const atualizarMarca = async (id, dados, marcasDaEmpresa = []) => {
  if (dados?.nome) assertNomeLivre(marcasDaEmpresa, dados.nome, id);
  return updateMarca(id, dados);
};

/**
 * Exclusão múltipla (best-effort).
 *
 * @returns {Promise<{excluidas: string[], falhas: Array<{id: string, code: string}>}>}
 */
export const excluirMarcas = async (ids) => {
  const excluidas = [];
  const falhas = [];

  for (const id of Array.isArray(ids) ? ids : [ids]) {
    try {
      await deleteMarca(id);
      excluidas.push(id);
    } catch (erro) {
      falhas.push({ id, code: erro?.code ?? API_ERROR_CODES.OPERATION_FAILED });
    }
  }

  return { excluidas, falhas };
};
