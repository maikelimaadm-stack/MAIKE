/**
 * Apontamento de Atividade (D-PROD-190) — espelho EXATO dos guardas do
 * servidor (`GUARDAS.apontamentoAtividade` em
 * backend/src/shared/auth/guardasRotas.js), no esquema do cadastro de Tipo de
 * Atividade (`sup-tipos-atividade`):
 *  - ver      = visualizar da tela (lista, detalhe e os seletores PRÓPRIOS da tela);
 *  - criar    = novo OU salvar;
 *  - editar   = editar OU salvar;
 *  - cancelar = excluir (não há DELETE físico: cancelar ocupa a ação Excluir).
 *
 * O módulo é o grupo de menu que contém a tela (`menuConfig`), o mesmo par
 * módulo × tela que a tela Permissões grava e o servidor confere. Permissão
 * EFETIVA: administrador da fazenda e `is_admin` = tudo. Sem linha da tela →
 * nada (fail-closed; sem concessão automática). Quem bloqueia de fato é o
 * servidor (403).
 */
import { canPerformAction } from './permissions.js';
import { DEFAULT_MENU, findMenuItemByUrl } from './menuConfig.js';

export const PAGINA_APONTAMENTOS_ATIVIDADE = 'ApontamentosAtividade';
export const TELA_APONTAMENTOS_ATIVIDADE = 'op-apontamentos-atividade';
/** Grupo de menu que contém a tela (logo abaixo de Tipos de Atividade). */
export const MODULO_APONTAMENTOS_ATIVIDADE = findMenuItemByUrl(DEFAULT_MENU, PAGINA_APONTAMENTOS_ATIVIDADE)?.moduleId ?? 'suporte-mapa';

/**
 * @param {unknown} permissao permissão efetiva
 * @returns {{ ver: boolean, criar: boolean, editar: boolean, cancelar: boolean }}
 */
export const acoesDaTelaApontamento = (permissao) => {
  const pode = (/** @type {string} */ acao) => canPerformAction(permissao, TELA_APONTAMENTOS_ATIVIDADE, MODULO_APONTAMENTOS_ATIVIDADE, acao);
  return {
    ver: pode('visualizar'),
    criar: pode('novo') || pode('salvar'),
    editar: pode('editar') || pode('salvar'),
    cancelar: pode('excluir'),
  };
};
