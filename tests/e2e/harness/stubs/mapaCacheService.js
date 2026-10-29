export * from "../../../../src/services/mapaCacheService.js";
import { AREAS, LOTES, PONTOS_SUPL, LINHAS } from "../dados.js";
const DADOS = { areas: AREAS, lotes: LOTES, pontosSuplementacao: PONTOS_SUPL, linhas: LINHAS };
export const getMapaCachedData = async (k) => DADOS[k] || [];
export const refreshMapaCacheEntry = async (k) => DADOS[k] || [];
