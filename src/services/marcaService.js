/**
 * Service de marcas (P1.4).
 *
 * Nome único por empresa, numeração automática por `max + 1` e CRUD. A regra de
 * unicidade estava dentro do `mutationFn` da página, comparando contra a lista
 * já carregada em memória — mantida, mas agora sobre a leitura do service.
 *
 * `max + 1` continua sem segurança de concorrência (DBT-06 da P1.2): duas
 * criações simultâneas podem receber o mesmo número. Fechar isso exige o
 * backend nativo da P3.
 */

import { listMarcas, createMarca, updateMarca, deleteMarca } from '@/apis/marcas';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

const chaveDeNome = (valor) => String(valor ?? '').trim().toUpperCase();

/** Marcas da empresa, mais recentes primeiro. */
export const listarMarcasDaEmpresa = async (empresaId) => {
  const todas = await listMarcas({ order: '-created_date' });
  return todas.filter((marca) => marca.empresa_id === empresaId);
};

/** Marcas ativas da empresa — a fonte de opções do formulário de produto. */
export const listarMarcasAtivas = async (empresaId) => {
  const todas = await listMarcas();
  return todas.filter((marca) => marca.empresa_id === empresaId && marca.ativo !== false);
};

/**
 * Próximo `numero_marca`.
 *
 * A numeração olha **todas** as marcas, não só as da empresa: era o alcance da
 * página, e estreitá-lo geraria números repetidos entre empresas.
 */
export const proximoNumeroDeMarca = async () => {
  const todas = await listMarcas();
  const numeros = todas
    .map((marca) => Number.parseInt(marca.numero_marca, 10) || 0)
    .filter((n) => n > 0 && n < 1000000000);
  return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
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
  const numero = await proximoNumeroDeMarca();
  return createMarca({ ...dados, empresa_id: empresaId, numero_marca: String(numero) });
};

export const atualizarMarca = (id, dados) => updateMarca(id, dados);

/**
 * Exclusão múltipla.
 *
 * Best-effort explícito: cada id é tentado, e o resultado diz quais saíram e
 * quais falharam. A página não some com a falha num `catch {}`.
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
