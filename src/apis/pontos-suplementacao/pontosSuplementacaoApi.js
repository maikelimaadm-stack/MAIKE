/** API pública de PontoSuplementacao (P5.4). */
import { pontoSuplementacaoPort, consultarElegibilidadeExclusaoPontoSuplementacaoNativa } from './pontoSuplementacaoNativePort.js';

/**
 * @param {unknown} registros
 * @returns {any[]}
 */
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);

/** @returns {Promise<any[]>} */
export const listPontosSuplementacao = async () =>
  comoLista(await pontoSuplementacaoPort.list());
export const createPontoSuplementacao = (dados) => pontoSuplementacaoPort.create(dados);
export const updatePontoSuplementacao = (id, dados) => pontoSuplementacaoPort.update(id, dados);
export const deletePontoSuplementacao = (id) => pontoSuplementacaoPort.delete(id);

/**
 * `{ id, pode_excluir: boolean, motivos: string[] }` — motivos: leituras_cocho,
 * lancamentos_suplementacao, movimentacoes_estoque, lancamentos_tarefa,
 * saldo_estoque, lancamentos_financeiros, abastecimentos, atividades.
 * @param {string} id
 * @returns {Promise<{ id: string, pode_excluir: boolean, motivos: string[] }>}
 */
export const consultarElegibilidadeExclusaoPontoSuplementacao = async (id) => {
  const r = /** @type {any} */ (await consultarElegibilidadeExclusaoPontoSuplementacaoNativa(id));
  return {
    id,
    pode_excluir: r?.pode_excluir === true,
    motivos: Array.isArray(r?.motivos) ? r.motivos.filter((m) => typeof m === 'string') : [],
  };
};
