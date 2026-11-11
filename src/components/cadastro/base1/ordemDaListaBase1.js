import React from "react";

/**
 * Ordem em que a lista está sendo mostrada (ordenação e filtros da grade) — D-PROD-161.
 * A grade publica as linhas na ordem da tela; o controlador usa essa ordem para ‹ › do registro
 * ("3/12" é a 3ª linha que a pessoa vê, não a 3ª do servidor).
 *
 * @type {React.Context<((linhas: object[]) => void) | null>}
 */
export const OrdemDaListaContext = React.createContext(/** @type {((linhas: object[]) => void) | null} */ (null));
