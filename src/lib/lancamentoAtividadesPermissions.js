/**
 * Lançamento de Atividades (D-PROD-200) — espelho dos guardas do servidor,
 * pela linha da tela `op-atividades` (contrato §5):
 *  - ver      = visualizar (lista, detalhe, apontamentos e os seletores PRÓPRIOS da tela);
 *  - criar    = novo OU salvar (abrir e duplicar atividade);
 *  - editar   = editar OU salvar (editar o cabeçalho e concluir);
 *  - cancelar = excluir (não há DELETE físico: cancelar ocupa a ação Excluir).
 * Ações EXTRAS da mesma linha (D-PROD-155; nascem desligadas):
 *  - reabrir              = `reabrir` (reabrir atividade concluída);
 *  - lancarApontamento    = `lancar_apontamento` (novo lançamento e "Repetir");
 *  - editarApontamento    = `editar_apontamento`;
 *  - cancelarApontamento  = `cancelar_apontamento`.
 *
 * O módulo é o grupo de menu que contém a tela (`menuConfig`), o mesmo par
 * módulo × tela que a tela Permissões grava e o servidor confere. Permissão
 * EFETIVA: administrador da fazenda e `is_admin` = tudo. Sem linha da tela →
 * nada (fail-closed; sem concessão automática). As linhas antigas
 * `op-apontamentos-atividade` ficam inertes no JSON (precedente D-PROD-162).
 * Quem bloqueia de fato é o servidor (403).
 */
import { canPerformAction } from './permissions.js';
import { DEFAULT_MENU, findMenuItemByUrl } from './menuConfig.js';

export const PAGINA_LANCAMENTO_ATIVIDADES = 'LancamentoAtividades';
export const TELA_ATIVIDADES = 'op-atividades';
/** Grupo de menu que contém a tela (logo abaixo de Tipos de Atividade). */
export const MODULO_ATIVIDADES = findMenuItemByUrl(DEFAULT_MENU, PAGINA_LANCAMENTO_ATIVIDADES)?.moduleId ?? 'suporte-mapa';

/** Ações extras da linha `op-atividades` (as mesmas de `EXTRA_ACTION_KEYS_BY_PAGE`). */
export const ACOES_EXTRAS_ATIVIDADES = Object.freeze({
  reabrir: 'reabrir',
  lancarApontamento: 'lancar_apontamento',
  editarApontamento: 'editar_apontamento',
  cancelarApontamento: 'cancelar_apontamento',
});

/** MAIKE-ENTREGA3 (D-PROD-275) — a tela do Cadastro do Mapa (o `PATCH /areas-pastagem/:id` pede o editar dela). */
export const TELA_MAPA_CADASTRO = 'pec-mapa-cadastro';
const MODULO_MAPA_CADASTRO = findMenuItemByUrl(DEFAULT_MENU, 'MapaCadastro')?.moduleId ?? 'mapa';

/**
 * D-PROD-275 — trocar o capim da área na conclusão da reforma: o servidor pede, além do editar da tela de atividades, o
 * editar do Cadastro do Mapa (o mesmo da edição da área). Espelho do guarda `GUARDAS.planejamentos.concluir`.
 * @param {unknown} permissao permissão efetiva
 */
export const podeTrocarCapimDaArea = (permissao) => canPerformAction(permissao, TELA_MAPA_CADASTRO, MODULO_MAPA_CADASTRO, 'editar');

/**
 * @param {unknown} permissao permissão efetiva
 * @returns {{ ver: boolean, criar: boolean, editar: boolean, cancelar: boolean, reabrir: boolean,
 *   lancarApontamento: boolean, editarApontamento: boolean, cancelarApontamento: boolean }}
 */
export const acoesDaTelaAtividades = (permissao) => {
  const pode = (/** @type {string} */ acao) => canPerformAction(permissao, TELA_ATIVIDADES, MODULO_ATIVIDADES, acao);
  return {
    ver: pode('visualizar'),
    criar: pode('novo') || pode('salvar'),
    editar: pode('editar') || pode('salvar'),
    cancelar: pode('excluir'),
    reabrir: pode(ACOES_EXTRAS_ATIVIDADES.reabrir),
    lancarApontamento: pode(ACOES_EXTRAS_ATIVIDADES.lancarApontamento),
    editarApontamento: pode(ACOES_EXTRAS_ATIVIDADES.editarApontamento),
    cancelarApontamento: pode(ACOES_EXTRAS_ATIVIDADES.cancelarApontamento),
  };
};
