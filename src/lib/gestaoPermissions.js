/**
 * Gestão Rural (D-PROD-145) — espelho EXATO dos guardas do servidor
 * (`GUARDAS.parceiro|centroCusto|centroResultado` em
 * backend/src/shared/auth/guardasRotas.js):
 *  - ver       = visualizar da tela;
 *  - criar     = novo OU salvar;
 *  - editar    = editar OU salvar (também inativar, reativar e vincular).
 *
 * Recebe a permissão EFETIVA (`permissaoEfetiva`): administrador da fazenda e a
 * concessão `is_admin` chegam com `is_admin: true` = tudo, como no servidor.
 * Sem registro / sem linha da tela → nada (fail-closed; não há concessão
 * automática das telas novas). Quem bloqueia de fato é o servidor (403).
 */
import { canPerformAction } from './permissions.js';

export const MODULO_GESTAO_RURAL = 'gestao-rural';

export const TELAS_GESTAO = Object.freeze({
  PARCEIROS: 'ges-parceiros',
  CENTROS_CUSTO: 'ges-centros-custo',
  CENTROS_RESULTADO: 'ges-centros-resultado',
});

/**
 * @param {unknown} permissao
 * @param {string} tela
 * @returns {{ ver: boolean, criar: boolean, editar: boolean }}
 */
export const acoesDaTelaGestao = (permissao, tela) => {
  const pode = (/** @type {string} */ acao) => canPerformAction(permissao, tela, MODULO_GESTAO_RURAL, acao);
  return {
    ver: pode('visualizar'),
    criar: pode('novo') || pode('salvar'),
    editar: pode('editar') || pode('salvar'),
  };
};
