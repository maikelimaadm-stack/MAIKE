export * from "../../../../src/hooks/useEmpresaSelecionadaId.js";
import { useEffect, useState } from "react";
import { EMPRESA } from "../dados.js";
/** GEO-09: troca de empresa pelo harness (evento `e2e-empresa`). */
export const useEmpresaSelecionadaId = () => {
  const [id, setId] = useState(() => window.__E2E_EMPRESA__ || EMPRESA);
  useEffect(() => {
    const h = () => setId(window.__E2E_EMPRESA__ || EMPRESA);
    window.addEventListener("e2e-empresa", h);
    return () => window.removeEventListener("e2e-empresa", h);
  }, []);
  return id;
};
