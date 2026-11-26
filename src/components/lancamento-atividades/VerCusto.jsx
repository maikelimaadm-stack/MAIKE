import { createContext, useContext } from "react";

/**
 * Contexto "ver R$" (Diário da máquina, Fase 2). O valor padrão é `true`: quem não passa o
 * provedor continua vendo o custo como antes. As telas de lançamento do operador passam
 * `podeVerCusto(permissaoEfetiva)` e as janelas escondem os valores em R$ quando for `false`.
 */
export const VerCustoContext = createContext(true);

/** @returns {boolean} `true` quando o usuário pode ver R$ nesta tela. */
export const useVerCusto = () => useContext(VerCustoContext);
