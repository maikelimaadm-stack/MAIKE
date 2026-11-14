/**
 * Superfície pública do módulo Atividades (D-PROD-182; padrões e flags do tipo,
 * D-PROD-197; Lançamento de Atividades — cabeçalho e apontamentos, D-PROD-200; linhas de produto e
 * de máquina e totais, D-PROD-202).
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
  RECURSOS_OPCOES_ATIVIDADE,
  listAtividadesPage,
  getAtividade,
  createAtividade,
  updateAtividade,
  completeAtividade,
  reopenAtividade,
  cancelAtividade,
  duplicateAtividade,
  listAtividadeApontamentos,
  getAtividadeApontamento,
  createAtividadeApontamento,
  updateAtividadeApontamento,
  cancelAtividadeApontamento,
  duplicateAtividadeApontamento,
  listOpcoesAtividade,
  TIPOS_LINHA_ATIVIDADE,
  getAtividadeTotais,
  createAtividadeLinha,
  updateAtividadeLinha,
  cancelAtividadeLinha,
  getMedidorAtividade,
} from './atividadesApi.js';
