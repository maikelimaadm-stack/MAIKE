export const DEFAULT_MAPA_GERAL_PERMISSIONS = {
  visualizar_areas: true,
  visualizar_nomes_areas: true,
  visualizar_lotes: true,
  visualizar_pontos_referencia: true,
  visualizar_linhas: true,
  visualizar_cochos_suplementacao: true,
  visualizar_alertas: true,
  visualizar_localizacao: true,
  visualizar_filtros_camadas: true,
  visualizar_insights: true,
  visualizar_tarefas: true,
  visualizar_detalhes_lotes: true,
  mover_lotes: true,
  pesar_lotes: true,
  mudar_categoria_lotes: true,
  registrar_nascimento: true,
  registrar_morte: true,
  registrar_abate: true,
  renomear_lotes: true,
  juntar_lotes: true,
  visualizar_historico_movimentacoes_lote: true,
  visualizar_historico_suplementacao_lote: true,
  visualizar_detalhes_cochos: true,
  lancar_suplementacao: true,
  movimentar_depositos: true,
  visualizar_historico_cocho: true,
};

export const MAPA_GERAL_PERMISSION_GROUPS = [
  {
    title: 'Camadas e painéis',
    items: [
      { key: 'visualizar_areas', label: 'Ver áreas / pastos' },
      { key: 'visualizar_nomes_areas', label: 'Ver nomes das áreas' },
      { key: 'visualizar_lotes', label: 'Ver lotes de gado' },
      { key: 'visualizar_pontos_referencia', label: 'Ver pontos de referência' },
      { key: 'visualizar_linhas', label: 'Ver linhas / cercas' },
      { key: 'visualizar_cochos_suplementacao', label: 'Ver cochos / depósitos' },
      { key: 'visualizar_alertas', label: 'Ver alertas' },
      { key: 'visualizar_localizacao', label: 'Ver minha localização' },
      { key: 'visualizar_filtros_camadas', label: 'Ver filtros e camadas' },
      { key: 'visualizar_insights', label: 'Ver insights' },
      { key: 'visualizar_tarefas', label: 'Ver tarefas no mapa' },
    ],
  },
  {
    title: 'Lotes de gado',
    items: [
      { key: 'visualizar_detalhes_lotes', label: 'Abrir detalhes do lote' },
      { key: 'mover_lotes', label: 'Mover lotes' },
      { key: 'pesar_lotes', label: 'Pesar lotes' },
      { key: 'mudar_categoria_lotes', label: 'Mudar categoria' },
      { key: 'registrar_nascimento', label: 'Registrar nascimento' },
      { key: 'registrar_morte', label: 'Registrar morte' },
      { key: 'registrar_abate', label: 'Registrar abate' },
      { key: 'renomear_lotes', label: 'Renomear lote' },
      { key: 'juntar_lotes', label: 'Juntar lotes' },
      { key: 'visualizar_historico_movimentacoes_lote', label: 'Ver histórico de movimentações' },
      { key: 'visualizar_historico_suplementacao_lote', label: 'Ver histórico de suplementação' },
    ],
  },
  {
    title: 'Cochos e depósitos',
    items: [
      { key: 'visualizar_detalhes_cochos', label: 'Abrir detalhes de cocho / depósito' },
      { key: 'lancar_suplementacao', label: 'Lançar suplementação' },
      { key: 'movimentar_depositos', label: 'Fazer entrada / saída em depósito' },
      { key: 'visualizar_historico_cocho', label: 'Ver histórico de cocho / depósito' },
    ],
  },
];

export const normalizeMapaGeralPermissions = (value, enabled = true) => {
  if (!enabled) {
    return Object.fromEntries(Object.keys(DEFAULT_MAPA_GERAL_PERMISSIONS).map((key) => [key, false]));
  }

  return {
    ...DEFAULT_MAPA_GERAL_PERMISSIONS,
    ...(value || {}),
  };
};