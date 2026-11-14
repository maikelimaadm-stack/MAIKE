/** Superfície pública do módulo Atividades (D-PROD-182; apontamentos, D-PROD-190; itens do apontamento, D-PROD-191). */

export {
  listTiposAtividade,
  getTipoAtividade,
  createTipoAtividade,
  updateTipoAtividade,
  deleteTipoAtividade,
  RECURSOS_OPCOES_APONTAMENTO,
  listApontamentosAtividadePage,
  getApontamentoAtividade,
  createApontamentoAtividade,
  updateApontamentoAtividade,
  cancelarApontamentoAtividade,
  adicionarItemApontamentoAtividade,
  cancelarItemApontamentoAtividade,
  listOpcoesApontamentoAtividade,
} from './atividadesApi.js';
