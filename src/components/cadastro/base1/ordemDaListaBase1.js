import React from "react";

/**
 * Ordem em que a lista está sendo mostrada (ordenação e filtros da grade) — D-PROD-163.
 * A grade publica as linhas na ordem da tela; o controlador usa essa ordem para ‹ › do registro
 * ("3/12" é a 3ª linha que a pessoa vê, não a 3ª do servidor).
 *
 * @type {React.Context<((linhas: object[]) => void) | null>}
 */
export const OrdemDaListaContext = React.createContext(/** @type {((linhas: object[]) => void) | null} */ (null));

/**
 * Linhas na ordem que a grade mostra. Usa as linhas frescas (a lista pode ter sido recarregada);
 * o que não estava na grade vai para o fim. Sem ordem conhecida, devolve `linhas` como estão.
 * @template T
 * @param {object[] | null} ordem linhas na ordem da grade (podem ser objetos antigos)
 * @param {T[]} linhas linhas atuais
 * @param {(linha: any) => string | number} idDe
 * @returns {T[]}
 */
export function naOrdemDaLista(ordem, linhas, idDe) {
  if (!ordem || !ordem.length) return linhas;
  const porId = new Map(linhas.map((l) => [String(idDe(l)), l]));
  const vistos = new Set();
  /** @type {T[]} */
  const saida = [];
  for (const l of ordem) {
    const id = String(idDe(l));
    const fresca = porId.get(id);
    if (fresca && !vistos.has(id)) {
      saida.push(fresca);
      vistos.add(id);
    }
  }
  if (!saida.length) return linhas;
  for (const l of linhas) if (!vistos.has(String(idDe(l)))) saida.push(l);
  return saida;
}
