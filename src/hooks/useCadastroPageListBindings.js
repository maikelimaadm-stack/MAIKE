import React from "react";
import { Base1CardsToolbar } from "@/components/cadastro/base1/Base1Cards";
import { useCadastroCardsPrefs } from "@/hooks/useCadastroCardsPrefs";
import { useCadastroListaFooter } from "@/hooks/useCadastroListaFooter";

/**
 * Liga paginação, métricas de rodapé e prefs de cards para uma tela cadastro Base1.
 *
 * @param {object} p
 * @param {string} p.storageKey
 * @param {Array<{ id: string; label: string }>} p.columns
 * @param {{ resetFiltersKey: number; appliedSearch: string }} p.chrome
 */
export function useCadastroPageListBindings({ storageKey, columns, chrome }) {
  const listFooter = useCadastroListaFooter(
    storageKey,
    `${chrome.resetFiltersKey}:${chrome.appliedSearch}`,
  );
  const cardsPrefs = useCadastroCardsPrefs(
    storageKey,
    columns.map((c) => c.id),
  );
  const cardsToolbar = React.createElement(Base1CardsToolbar, { columns, cardsPrefs });

  return { listFooter, cardsPrefs, cardsToolbar };
}
