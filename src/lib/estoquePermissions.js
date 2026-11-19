/**
 * Estoque (D-PROD-255) — espelho de `GUARDAS.estoque` (backend/src/shared/auth/guardasRotas.js)
 * e de `TELAS.ESTOQUE` (backend/src/shared/auth/autorizacaoTela.js).
 *
 *  - ver = `visualizar` da tela `sup-estoque` (consultar saldo e movimentos).
 *
 * FUTURO, não implementado e SEPARADO de `visualizar`: as ações extras `entrada` e `ajuste` da
 * mesma linha (dar entrada, ajustar inventário). Ainda não há o que gravar: a tela Permissões não
 * oferece essas chaves (nada em `EXTRA_ACTION_KEYS_BY_PAGE`). Administrador real e `is_admin` têm tudo.
 * Quem bloqueia de fato é o servidor (403).
 */
import { canPerformAction } from './permissions.js';

export const MODULO_ESTOQUE = 'suporte-mapa';
export const TELA_ESTOQUE = 'sup-estoque';

/**
 * @param {unknown} permissao permissão EFETIVA
 * @returns {{ ver: boolean }}
 */
export const acoesDaTelaEstoque = (permissao) => ({
  ver: canPerformAction(permissao, TELA_ESTOQUE, MODULO_ESTOQUE, 'visualizar'),
});
