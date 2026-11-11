import React from "react";

/**
 * Classe do `<body>` enquanto houver um casco Base1 (`.cadastro-b1--full-page`) na página (D-PROD-166).
 *
 * O CSS do design usava `body:has(.cadastro-b1--full-page)` para valer só nas telas Base1 (o Mapa Geral não muda).
 * Esse `:has()` com descendente no `<body>` fazia o Chrome recalcular o estilo da página INTEIRA a cada mudança
 * no DOM — rolar a lista, abrir uma janela, digitar —, e era a maior parte da lentidão medida. Uma classe no
 * `<body>` dá o mesmo alcance sem esse custo.
 */
export const CLASSE_TELA_BASE1 = "b1-tela";

/** @type {Set<Element>} */
const cascos = new Set();

const atualizar = () => {
  if (typeof document === "undefined" || !document.body) return;
  document.body.classList.toggle(CLASSE_TELA_BASE1, cascos.size > 0);
};

/**
 * `ref` de callback para o elemento `.cadastro-b1--full-page`: liga `body.b1-tela` enquanto ele estiver na página
 * (várias telas ao mesmo tempo contam juntas). O ref roda no commit, antes da pintura: a primeira imagem da tela
 * já sai com o estilo Base1.
 * @returns {(el: Element | null) => void}
 */
export function useCascoBase1() {
  const no = React.useRef(/** @type {Element | null} */ (null));
  return React.useCallback((/** @type {Element | null} */ el) => {
    if (no.current) cascos.delete(no.current);
    no.current = el;
    if (el) cascos.add(el);
    atualizar();
  }, []);
}
