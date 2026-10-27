/**
 * Service de marcas — persistência nativa (P4.4-Marcas, D-PROD-42 + D-PROD-54).
 *
 * Unicidade de nome por empresa continua no service para falha rápida na UI, mas
 * a numeração e a constraint definitiva vivem no backend.
 * Listagem de tela usa keyset (`listarMarcasPagina`); dropdowns usam página limitada.
 */

import { listMarcas, listMarcasPage, createMarca, updateMarca, deleteMarca } from '@/apis/marcas';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

const chaveDeNome = (valor) => String(valor ?? '').trim().toUpperCase();

/** Teto de linhas acumuladas no browser — além disso refine a busca (escala). */
export const MARCAS_MAX_JANELA_CLIENTE = 2000;

/**
 * Página keyset da empresa (tela Marcas).
 * @param {string} empresaId
 * @param {{ limit?: number, cursor?: string|null, q?: string, ativo?: boolean }} [opts]
 */
export const listarMarcasPagina = async (empresaId, opts = {}) => {
  if (!empresaId) {
    return { items: [], next_cursor: null, has_more: false, total: 0, limit: opts.limit ?? 100 };
  }
  return listMarcasPage({
    empresa_id: empresaId,
    limit: opts.limit,
    cursor: opts.cursor ?? undefined,
    q: opts.q,
    ativo: opts.ativo,
  });
};

/**
 * Compat / dropdown: até 500 itens da empresa (não usar para “listar tudo”).
 * @param {string} empresaId
 */
export const listarMarcasDaEmpresa = async (empresaId) => {
  const page = await listarMarcasPagina(empresaId, { limit: 500 });
  return page.items;
};

/** Marcas ativas da empresa — opções do formulário de produto (cap 500). */
export const listarMarcasAtivas = async (empresaId) => {
  const page = await listarMarcasPagina(empresaId, { limit: 500, ativo: true });
  return page.items;
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

// reexport tipado para callers que ainda importam listMarcas via service legado
export { listMarcas };
