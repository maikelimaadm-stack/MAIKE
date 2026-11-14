/**
 * Superfície pública do módulo Atividades (D-PROD-182; padrões e flags do tipo,
 * D-PROD-196; apontamentos, D-PROD-190; itens do apontamento, D-PROD-193).
 */

export {
  listTiposAtividade,
  getTipoAtividade,
  createTipoAtividade,
  updateTipoAtividade,
  deleteTipoAtividade,
  FLAGS_TIPO_ATIVIDADE,
  RECURSOS_OPCOES_TIPO_ATIVIDADE,
  listOpcoesTipoAtividade,
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
