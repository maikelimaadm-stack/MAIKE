import { canAccessPage } from '@/lib/permissions';

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
  // D-PROD-219 — Medição de Forragem do pasto (ação gravadora).
  medir_forragem: true,
  // D-PROD-266 — excluir movimentação do lote (gravadora). Nasce DESLIGADA para
  // todo operador: só `=== true` gravado liga (`normalizeMapaGeralPermissions`).
  excluir_movimentacoes_lote: false,
  // D-PROD-267 — cancelar lançamento de cocho e transferência entre depósitos
  // (devolve estoque; gravadora). Nasce DESLIGADA para todo operador.
  cancelar_lancamentos_estoque: false,
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
      // D-PROD-266
      { key: 'excluir_movimentacoes_lote', label: 'Excluir movimentações do lote' },
    ],
  },
  {
    title: 'Cochos e depósitos',
    items: [
      { key: 'visualizar_detalhes_cochos', label: 'Abrir detalhes de cocho / depósito' },
      { key: 'lancar_suplementacao', label: 'Lançar suplementação' },
      { key: 'movimentar_depositos', label: 'Fazer entrada / saída em depósito' },
      { key: 'visualizar_historico_cocho', label: 'Ver histórico de cocho / depósito' },
      // D-PROD-267
      { key: 'cancelar_lancamentos_estoque', label: 'Cancelar lançamento de cocho e transferência de depósito' },
    ],
  },
  {
    title: 'Pastos',
    items: [
      // D-PROD-219
      { key: 'medir_forragem', label: 'Lançar medição de forragem' },
    ],
  },
];

/**
 * Chaves que GRAVAM (mesma lista de `ACOES_GRAVADORAS_MAPA` no servidor,
 * `backend/src/shared/auth/autorizacaoTela.js` — teste de paridade).
 */
export const MAPA_GERAL_ACOES_GRAVADORAS = Object.freeze([
  'mover_lotes', 'pesar_lotes', 'mudar_categoria_lotes', 'registrar_nascimento', 'registrar_morte',
  'registrar_abate', 'renomear_lotes', 'juntar_lotes', 'lancar_suplementacao', 'movimentar_depositos',
  // D-PROD-219
  'medir_forragem',
  // D-PROD-266
  'excluir_movimentacoes_lote',
  // D-PROD-267
  'cancelar_lancamentos_estoque',
]);

/** Administrador real da fazenda ou concessão `is_admin`: tudo ligado. */
export const MAPA_GERAL_ACESSO_TOTAL = Object.freeze(
  Object.fromEntries(Object.keys(DEFAULT_MAPA_GERAL_PERMISSIONS).map((key) => [key, true]))
);

const ehGravadora = (key) => MAPA_GERAL_ACOES_GRAVADORAS.includes(key);

/**
 * Permissões do mapa de um OPERADOR (R2, mesma regra do servidor):
 *  - tela do mapa não visível (`enabled` false) → tudo desligado;
 *  - ação gravadora: ligada só se gravada `=== true` (ausente, objeto ausente ou
 *    valor não booleano → desligada — registro parcial legado não ganha ação);
 *  - visualização: ausente = ligada; só `false` desliga.
 * @param {unknown} value
 * @param {boolean} [enabled]
 * @returns {Record<string, any>}
 */
export const normalizeMapaGeralPermissions = (value, enabled = true) => {
  const chaves = Object.keys(DEFAULT_MAPA_GERAL_PERMISSIONS);
  if (!enabled) return Object.fromEntries(chaves.map((key) => [key, false]));
  const salvo = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    chaves.map((key) => [key, ehGravadora(key) ? salvo[key] === true : salvo[key] !== false])
  );
};

/** D-PROD-266 — chave do mapa que libera excluir movimentação do lote. */
export const CHAVE_EXCLUIR_MOVIMENTACOES_LOTE = 'excluir_movimentacoes_lote';

/**
 * D-PROD-266 — quem vê a ação "Excluir movimentação" (mesma regra do servidor,
 * `podeExcluirMovimentacaoLote` em `backend/src/shared/auth/autorizacaoTela.js`):
 * administrador real da fazenda (`administrador_fazenda`, papel lido do servidor),
 * a concessão `is_admin` da permissão efetiva, ou a chave gravadora
 * `excluir_movimentacoes_lote` com a tela do Mapa Geral visível — a mesma
 * combinação que `MapaGeral.jsx` usa para montar as permissões do mapa.
 * Só interface: o servidor reautoriza no GET de elegibilidade e no POST.
 * @param {any} usuario  `getCurrentUser()`
 * @param {any} permissao  `carregarPermissaoEfetiva(usuario)` (ou null)
 * @returns {boolean}
 */
export const podeExcluirMovimentacoesDoLote = (usuario, permissao) => {
  if (usuario?.administrador_fazenda === true || permissao?.is_admin === true) return true;
  if (!permissao) return false;
  const mapa = normalizeMapaGeralPermissions(permissao.mapa_geral_permissoes, canAccessPage(permissao, 'pec-mapa-geral', 'mapa'));
  return mapa[CHAVE_EXCLUIR_MOVIMENTACOES_LOTE] === true;
};

/** D-PROD-267 — chave do mapa que libera cancelar lançamento de cocho e transferência de depósito. */
export const CHAVE_CANCELAR_LANCAMENTOS_ESTOQUE = 'cancelar_lancamentos_estoque';

/**
 * D-PROD-267 — quem vê "Cancelar lançamento" (cocho) e "Cancelar transferência"
 * (depósito): administrador real, `is_admin` ou a chave gravadora
 * `cancelar_lancamentos_estoque` com a tela do Mapa Geral visível. Mesma regra do
 * servidor (`podeCancelarLancamentosEstoque`). Só interface: o servidor reautoriza.
 * @param {any} usuario  `getCurrentUser()`
 * @param {any} permissao  `carregarPermissaoEfetiva(usuario)` (ou null)
 * @returns {boolean}
 */
export const podeCancelarLancamentosEstoque = (usuario, permissao) => {
  if (usuario?.administrador_fazenda === true || permissao?.is_admin === true) return true;
  if (!permissao) return false;
  const mapa = normalizeMapaGeralPermissions(permissao.mapa_geral_permissoes, canAccessPage(permissao, 'pec-mapa-geral', 'mapa'));
  return mapa[CHAVE_CANCELAR_LANCAMENTOS_ESTOQUE] === true;
};
