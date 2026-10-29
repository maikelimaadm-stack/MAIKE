export * from "../../../../src/services/mapaService.js";
import { AREAS, LINHAS, EMPRESA } from "../dados.js";

/**
 * GEO-08: store de leitura/gravação LOCAL (sessionStorage) — sobrevive a reload
 * da página, nunca sai do navegador. Simula o contrato de criarArea/atualizarArea.
 */
const CHAVE = "e2e-areas-salvas";
const ler = () => { try { return JSON.parse(sessionStorage.getItem(CHAVE) || "[]"); } catch { return []; } };
const gravar = (v) => sessionStorage.setItem(CHAVE, JSON.stringify(v));
export const lerAreasSalvas = ler;
export const SETOR_E2E = { id: "setor-e2e", empresa_id: EMPRESA, nome: "Setor E2E", ativo: true };

export const listarAreasAtivas = async (emp) => [...(emp === EMPRESA ? AREAS : []), ...ler().filter((a) => a.empresa_id === emp)];
export const listarTodasAreas = async () => [...AREAS, ...ler()];
export const listarLinhasAtivas = async () => LINHAS;
export const listarPontosAtivos = async () => [];
export const listarIconesDaEmpresa = async () => [];
export const listarSetoresAtivos = async () => [SETOR_E2E];
export const listarBebedourosAtivos = async () => [];
export const criarArea = async (dados) => {
  const nova = { ...JSON.parse(JSON.stringify(dados)), id: `nova-${ler().length + 1}` };
  gravar([...ler(), nova]);
  return nova;
};
export const atualizarArea = async (id, dados) => {
  const lista = ler();
  const i = lista.findIndex((a) => a.id === id);
  if (i < 0) throw new Error("área inexistente");
  lista[i] = { ...lista[i], ...JSON.parse(JSON.stringify(dados)) };
  gravar(lista);
  return lista[i];
};
