export * from "../../../../src/services/mapaService.js";
import { AREAS, LINHAS } from "../dados.js";
export const listarAreasAtivas = async () => (window.__E2E_AREAS__ || AREAS);
export const listarLinhasAtivas = async () => LINHAS;
export const listarPontosAtivos = async () => [];
export const listarIconesDaEmpresa = async () => [];
export const listarSetoresAtivos = async () => [];
export const listarBebedourosAtivos = async () => [];
