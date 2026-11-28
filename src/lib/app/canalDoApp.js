/**
 * D-PROD-381 — o canal do app: "oficial" (todos) ou "teste" (o APK de teste do proprietário).
 *
 * O APK de teste é gerado com `VITE_CANAL_APP=teste` pelo workflow `app-teste` (Actions), a partir de uma branch, SEM
 * merge. Ele recebe as atualizações de teste (não as oficiais): lê o `ultima.json` da Release `app-teste` do GitHub
 * (`VITE_CANAL_TESTE_URL`). Assim o proprietário instala o APK de teste uma vez e cada ajuste chega nele pela
 * atualização, até ele aprovar; só então a mudança vira PR, passa pelas verificações e vai para o canal oficial.
 */

/** @returns {"oficial" | "teste"} */
export const canalDoApp = () => (import.meta.env.VITE_CANAL_APP === "teste" ? "teste" : "oficial");

/** O endereço do `ultima.json` das atualizações de teste, ou null (canal oficial ou sem endereço). */
export const urlDasAtualizacoesDeTeste = () => {
  if (canalDoApp() !== "teste") return null;
  const url = String(import.meta.env.VITE_CANAL_TESTE_URL || "").trim();
  return /^https:\/\//.test(url) ? url : null;
};
