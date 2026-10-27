/**
 * Constantes de escala da lista Base1 (D-PROD-54).
 * Espelho do teto do backend — não importar código de `backend/` no Vite.
 */

/** Teto por request (alinhar com `LIMITE_MAXIMO` do backend). */
export const LIMITE_MAXIMO = 500;

/** Página padrão. */
export const LIMITE_PADRAO = 100;

/**
 * Page sizes da UI Base1, limitados ao teto de rede.
 * (O seletor legado ia até 1000; acima de 500 o servidor corta.)
 */
export const CADASTRO_B1_PAGE_SIZES_ESCALA = [100, 200, 300, 400, 500];
