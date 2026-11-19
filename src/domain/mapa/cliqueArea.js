/**
 * O que um clique no contorno de uma área faz no Mapa Geral
 * (MAIKE-MAPA-HISTORICO-MOVIMENTACOES-R1.1, D-PROD-94a). Função pura e testável.
 *
 * Precedência:
 *  1. selecionando local de tarefa → o clique escolhe o local (nunca abre detalhes);
 *  2. clique que encerra um toque longo (que já abriu o lançamento de tarefa) → ignora;
 *  3. curral → abre detalhes (aba Abate, como antes);
 *  4. qualquer outra área (com ou sem lote) → abre detalhes SE o usuário pode ver
 *     áreas (`visualizar_areas`, D-PROD-254: o painel "Detalhes da área" mostra o
 *     cartão da área; o que mais aparece nele — histórico de movimentação,
 *     forragem, atividades, Manejos — segue cada permissão própria, dentro do painel).
 */

/** @param {any} area */
export const ehCurral = (area) =>
  area?.tipo_cultura === 'Infraestrutura' &&
  String(area?.tipo_infraestrutura || area?.tipo_pastagem || '').trim().toLowerCase() === 'curral';

/** D-PROD-254 — quem enxerga áreas no mapa abre os detalhes dela. @param {Record<string, any>|null|undefined} permissoes */
export const podeVerAreas = (permissoes) => permissoes?.visualizar_areas !== false;

/** @param {Record<string, any>|null|undefined} permissoes */
export const podeVerHistoricoDaArea = (permissoes) => permissoes?.visualizar_historico_movimentacoes_lote !== false;

/**
 * D-PROD-219 — o botão "Medição de Forragem" aparece no detalhe do pasto: chave
 * gravadora do mapa (`=== true`) e área que não é infraestrutura.
 * @param {Record<string, any>|null|undefined} permissoes
 * @param {any} area
 */
export const podeMedirForragemNaArea = (permissoes, area) =>
  permissoes?.medir_forragem === true && Boolean(area) && area?.tipo_cultura !== 'Infraestrutura';

/**
 * @param {{ area: any, selecionandoLocalTarefa: boolean, toqueLongoAcabouDeDisparar: boolean, permissoes: Record<string, any>|null|undefined }} p
 * @returns {'selecionar-local'|'ignorar'|'abrir-detalhes'}
 */
export const acaoDoCliqueNaArea = ({ area, selecionandoLocalTarefa, toqueLongoAcabouDeDisparar, permissoes }) => {
  if (selecionandoLocalTarefa) return 'selecionar-local';
  if (!area || toqueLongoAcabouDeDisparar) return 'ignorar';
  if (ehCurral(area)) return 'abrir-detalhes';
  return podeVerAreas(permissoes) ? 'abrir-detalhes' : 'ignorar';
};
