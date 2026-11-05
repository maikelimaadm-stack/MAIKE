export * from "../../../../src/services/loteManejoService.js";
import { EMPRESA } from "../dados.js";
/**
 * D-PROD-123 (H2): página do histórico como o servidor H2 a entrega — já na
 * ordem por ocorrência, com `historico_ocorrencia` e `historico_registrado_em`.
 * Dados sintéticos.
 */
const mov = (id, oc, reg, extra = {}) => ({
  id, empresa_id: EMPRESA, tipo: "Transferência de Área", lote: "Lote A", lote_id: "l1", quantidade_animais: 42,
  area_origem_id: "a2", area_origem_nome: "PASTO 02", area_destino_id: "a1", area_destino_nome: "PASTO 01",
  data_movimentacao: oc ?? undefined, created_date: reg, historico_ocorrencia: oc, historico_ocorrencia_origem: oc ? "evento" : null, historico_registrado_em: reg,
  ...extra,
});
const PAGINAS = {
  "": { items: [mov("h1", "2026-10-30", "2026-10-30T15:10:00.000Z"), mov("h2", "2026-01-05", "2026-11-01T18:00:00.000Z", { tipo: "Pesagem", area_destino_id: undefined, observacoes: "Lançamento retroativo registrado depois" })], next_cursor: "v2-e2e", has_more: true, total: 3, limit: 100, ordem: "ocorrencia_desc_v2" },
  "v2-e2e": { items: [mov("h3", null, "2026-11-02T08:00:00.000Z", { tipo: "Pesagem", area_destino_id: undefined })], next_cursor: null, has_more: false, total: 3, limit: 100, ordem: "ocorrencia_desc_v2" },
};
export const listarHistoricoMovimentacoesPagina = async ({ cursor }) => PAGINAS[cursor || ""];
export const buscarLoteDoHistorico = async () => null;
