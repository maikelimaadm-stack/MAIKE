/**
 * O que um clique no contorno de uma área faz no Mapa Geral
 * (MAIKE-MAPA-HISTORICO-MOVIMENTACOES-R1.1, D-PROD-94a). Função pura e testável.
 *
 * Precedência:
 *  1. selecionando local de tarefa → o clique escolhe o local (nunca abre detalhes);
 *  2. clique que encerra um toque longo (que já abriu o lançamento de tarefa) → ignora;
 *  3. curral → abre detalhes (histórico de abate, como antes; o histórico da
 *     área entra só com a permissão de histórico);
 *  4. qualquer outra área (com ou sem lote) → abre detalhes SE o usuário pode
 *     ver histórico de movimentações (`visualizar_historico_movimentacoes_lote`,
 *     a mesma permissão que já abre o histórico pelo lote); sem ela, nada.
 */

/** @param {any} area */
export const ehCurral = (area) =>
  area?.tipo_cultura === 'Infraestrutura' &&
  String(area?.tipo_infraestrutura || area?.tipo_pastagem || '').trim().toLowerCase() === 'curral';

/** @param {Record<string, any>|null|undefined} permissoes */
export const podeVerHistoricoDaArea = (permissoes) => permissoes?.visualizar_historico_movimentacoes_lote !== false;

/**
 * @param {{ area: any, selecionandoLocalTarefa: boolean, toqueLongoAcabouDeDisparar: boolean, permissoes: Record<string, any>|null|undefined }} p
 * @returns {'selecionar-local'|'ignorar'|'abrir-detalhes'}
 */
export const acaoDoCliqueNaArea = ({ area, selecionandoLocalTarefa, toqueLongoAcabouDeDisparar, permissoes }) => {
  if (selecionandoLocalTarefa) return 'selecionar-local';
  if (!area || toqueLongoAcabouDeDisparar) return 'ignorar';
  if (ehCurral(area)) return 'abrir-detalhes';
  return podeVerHistoricoDaArea(permissoes) ? 'abrir-detalhes' : 'ignorar';
};
