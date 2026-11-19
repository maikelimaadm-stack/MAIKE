/**
 * Estoque (D-PROD-255) — espelho de `GUARDAS.estoque` (backend/src/shared/auth/guardasRotas.js)
 * e de `TELAS.ESTOQUE` (backend/src/shared/auth/autorizacaoTela.js).
 *
 *  - ver = `visualizar` da tela `sup-estoque` (consultar saldo e movimentos).
 *
 *  - entrada = ação extra `entrada` da mesma linha (D-PROD-257): lançar entrada manual / saldo de
 *    implantação, editar a observação e excluir. SEPARADA de `visualizar` e sem concessão por padrão.
 *
 * `ajuste` (ajustar inventário) segue RESERVADA e não existe. Administrador real e `is_admin` têm tudo.
 * Quem bloqueia de fato é o servidor (403).
 */
import { canPerformAction } from './permissions.js';

export const MODULO_ESTOQUE = 'suporte-mapa';
export const TELA_ESTOQUE = 'sup-estoque';

/**
 * @param {unknown} permissao permissão EFETIVA
 * @returns {{ ver: boolean, entrada: boolean }}
 */
export const acoesDaTelaEstoque = (permissao) => ({
  ver: canPerformAction(permissao, TELA_ESTOQUE, MODULO_ESTOQUE, 'visualizar'),
  entrada: canPerformAction(permissao, TELA_ESTOQUE, MODULO_ESTOQUE, 'entrada'),
});
