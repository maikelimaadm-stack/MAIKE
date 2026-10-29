export * from "../../../../src/services/mapaCacheService.js";
import { AREAS, LOTES, PONTOS_SUPL, LINHAS, EMPRESA_B, AREAS_B, LOTES_B } from "../dados.js";
const POR_EMPRESA = {
  [EMPRESA_B]: { areas: AREAS_B, lotes: LOTES_B, pontosSuplementacao: [], linhas: [] },
};
const PADRAO = { areas: AREAS, lotes: LOTES, pontosSuplementacao: PONTOS_SUPL, linhas: LINHAS };
const dados = (k, emp) => ((POR_EMPRESA[emp] || PADRAO)[k] || []);
/** GEO-09: atraso opcional para provar que fetch pendente não mostra a empresa anterior. */
const atraso = () => new Promise((r) => setTimeout(r, Number(window.__E2E_ATRASO__ || 0)));
export const getMapaCachedData = async () => [];
export const refreshMapaCacheEntry = async (k, emp) => { await atraso(); return dados(k, emp); };
