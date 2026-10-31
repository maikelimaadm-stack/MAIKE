import { useCallback, useMemo, useState } from "react";

/**
 * Preferências de cards Base1 (layout + campos), persistidas por tela.
 *
 * @param {string} storageKey prefixo localStorage da grade
 * @param {string[]} defaultFieldKeys colunas padrão nos cards
 */
/** Celular mostra 3 campos por card por padrão (protótipo v2, D-PROD-88); escolha salva vale sempre. */
const camposPadrao = (keys) => {
  const celular = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 639px)").matches;
  if (!celular) return keys;
  // Nome e código já aparecem no topo do card (Base1Cards): contam 3 campos além deles.
  const noTopo = new Set(["numero", "nome", "name", "code"]);
  return [...keys.filter((k) => noTopo.has(k)), ...keys.filter((k) => !noTopo.has(k)).slice(0, 3)];
};

export function useCadastroCardsPrefs(storageKey, defaultFieldKeys) {
  const [cardsPerRow, setCardsPerRowState] = useState(() => {
    try {
      const n = Number(localStorage.getItem(`${storageKey}_cardsPerRow`));
      return n >= 1 && n <= 4 ? /** @type {1|2|3|4} */ (n) : 4;
    } catch {
      return 4;
    }
  });

  const [cardFields, setCardFieldsState] = useState(() => {
    try {
      const raw = localStorage.getItem(`${storageKey}_cardFields`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch {
      /* ignore */
    }
    return camposPadrao(defaultFieldKeys);
  });

  const setCardsPerRow = useCallback(
    (n) => {
      setCardsPerRowState(n);
      try {
        localStorage.setItem(`${storageKey}_cardsPerRow`, String(n));
      } catch {
        /* sem storage */
      }
    },
    [storageKey],
  );

  const setCardFields = useCallback(
    (keys) => {
      setCardFieldsState(keys);
      try {
        localStorage.setItem(`${storageKey}_cardFields`, JSON.stringify(keys));
      } catch {
        /* sem storage */
      }
    },
    [storageKey],
  );

  const restoreLayout = useCallback(() => setCardsPerRow(4), [setCardsPerRow]);

  const restoreFields = useCallback(
    () => setCardFields(camposPadrao(defaultFieldKeys)),
    [defaultFieldKeys, setCardFields],
  );

  return useMemo(
    () => ({
      cardsPerRow,
      setCardsPerRow,
      cardFields,
      setCardFields,
      restoreLayout,
      restoreFields,
    }),
    [cardsPerRow, setCardsPerRow, cardFields, setCardFields, restoreLayout, restoreFields],
  );
}
