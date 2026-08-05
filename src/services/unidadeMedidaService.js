/**
 * Service de unidades de medida (P1.4).
 *
 * Numeração `max + 1`, autonumeração dos registros antigos e bloqueio de
 * exclusão quando algum produto usa a **sigla**. A guarda estava dentro do
 * `mutationFn` da página, lendo `Produto.list()` e lançando `Error` com texto —
 * agora é `deleteGuardService` com carregadores declarados e código estável.
 */

import {
  listUnidades,
  createUnidade,
  updateUnidade,
  deleteUnidade,
  listProdutosVinculados,
} from '@/apis/unidades-medida';
import { listTodasMovimentacoes as listTodasMovimentacoesEstoque } from '@/apis/estoque';
import { listManejosTecnicos } from '@/apis/rebanho';
import { API_ERROR_CODES } from '@/apis/_core/ApiError';
import { assertExclusaoPermitida } from './deleteGuardService';

export const listarUnidades = () => listUnidades();

/** Próximo `numero_unidade`. `max + 1` sem concorrência segura (dívida aberta). */
export const proximoNumeroDeUnidade = async () => {
  const todas = await listUnidades();
  const numeros = todas.map((item) => Number.parseInt(item.numero_unidade, 10) || 0).filter((n) => n > 0);
  return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
};

export const criarUnidade = async (dados) => {
  const numero = await proximoNumeroDeUnidade();
  return createUnidade({ ...dados, numero_unidade: String(numero) });
};

export const atualizarUnidade = (id, dados) => updateUnidade(id, dados);

/**
 * Preenche `numero_unidade` nos registros antigos que não têm.
 *
 * Best-effort, como antes: a tela roda isso em segundo plano. A diferença é que
 * agora o resultado é explícito em vez de um `catch {}` mudo.
 *
 * @returns {Promise<{numeradas: string[], falhas: string[]}>}
 */
export const numerarUnidadesSemNumero = async (unidades) => {
  const semNumero = (Array.isArray(unidades) ? unidades : []).filter((item) => !item.numero_unidade);
  const numeradas = [];
  const falhas = [];

  for (const unidade of semNumero) {
    try {
      const numero = await proximoNumeroDeUnidade();
      await updateUnidade(unidade.id, { numero_unidade: String(numero) });
      numeradas.push(unidade.id);
    } catch {
      falhas.push(unidade.id);
    }
  }

  return { numeradas, falhas };
};

/**
 * Carregadores das dependências declaradas em `DELETE_RULES.UnidadeMedida`:
 * Produto, MovimentacaoEstoque e ManejoTecnicoRebanho — todas casando pela
 * sigla.
 */
const carregadoresDeExclusao = {
  Produto: () => listProdutosVinculados(),
  MovimentacaoEstoque: () => listTodasMovimentacoesEstoque(),
  ManejoTecnicoRebanho: () => listManejosTecnicos(),
};

/**
 * Exclui uma unidade, com a guarda por sigla.
 *
 * As três dependências da tabela são consultadas — as mesmas que o patch global
 * `applyDeleteGuards` consultava antes de deixar o `delete` passar. A página só
 * verificava `Produto`; o resto vinha do patch e some com ele.
 */
export const excluirUnidade = async (id, { unidades = [] } = {}) => {
  const atual = unidades.find((item) => item.id === id) || null;

  await assertExclusaoPermitida({
    entityName: 'UnidadeMedida',
    id,
    currentRecord: atual,
    carregadores: carregadoresDeExclusao,
    blockedCode: API_ERROR_CODES.UNIDADE_MEDIDA_DELETE_BLOCKED,
    operation: 'excluirUnidade',
  });

  return deleteUnidade(id);
};

/**
 * Exclusão múltipla com resultado parcial explícito.
 *
 * @returns {Promise<{excluidas: string[], bloqueadas: Array<{id: string, code: string}>}>}
 */
export const excluirUnidades = async (ids, { unidades = [] } = {}) => {
  const excluidas = [];
  const bloqueadas = [];

  for (const id of Array.isArray(ids) ? ids : [ids]) {
    try {
      await excluirUnidade(id, { unidades });
      excluidas.push(id);
    } catch (erro) {
      bloqueadas.push({ id, code: erro?.code ?? API_ERROR_CODES.OPERATION_FAILED });
    }
  }

  return { excluidas, bloqueadas };
};
