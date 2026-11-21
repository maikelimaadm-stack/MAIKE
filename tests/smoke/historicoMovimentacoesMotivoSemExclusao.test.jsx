/**
 * `motivoSemExclusao` (HistoricoMovimentacoes): o texto do domínio
 * (`motivoSemCancelamento`) é dito na tela em termos de exclusão. Cobre o ramo
 * de reserva — texto desconhecido com cancel/estorn — e o texto neutro que
 * passa igual. O domínio é substituído só aqui; situacaoMovimento.js não muda.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dominio = vi.hoisted(() => ({ texto: undefined }));

vi.mock("@/domain/lotes/situacaoMovimento", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    motivoSemCancelamento: (mov) => (dominio.texto === undefined ? real.motivoSemCancelamento(mov) : dominio.texto),
  };
});
vi.mock("@/services/loteManejoService", () => ({
  listarHistoricoMovimentacoesPagina: vi.fn(),
  excluirMovimentacaoMapa: vi.fn(),
  consultarExclusaoMovimentacao: vi.fn(),
  removerMovimentacaoExcluidaDoCacheOffline: vi.fn(async () => 0),
  pendenciasOfflineDaMovimentacao: vi.fn(async () => []),
}));
vi.mock("@/services/mapaCacheService", () => ({
  getMapaCachedData: vi.fn(),
  getMapaCacheSnapshot: vi.fn(),
  refreshMapaCacheEntry: vi.fn(),
  updateMapaCachedData: vi.fn(async () => []),
}));
vi.mock("@/services/sessionService", () => ({ getCurrentUser: async () => null, ehAdministrador: () => false }));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));

const { motivoSemExclusao } = await import("@/components/lotes/HistoricoMovimentacoes");

const MOV = { id: "mv-1", empresa_id: "emp-1", tipo: "Transferência de Área", lote_id: "l1" };

beforeEach(() => { dominio.texto = undefined; });

describe("motivoSemExclusao", () => {
  it("texto desconhecido do domínio com cancel/estorn vira o texto genérico de exclusão", () => {
    dominio.texto = "Estorno indisponível X";
    expect(motivoSemExclusao(MOV)).toBe("Exclusão não disponível para este registro.");
    dominio.texto = "Cancelamento bloqueado por algo novo";
    expect(motivoSemExclusao(MOV)).toBe("Exclusão não disponível para este registro.");
  });

  it("texto neutro do domínio passa sem mudança", () => {
    dominio.texto = "Sem dados";
    expect(motivoSemExclusao(MOV)).toBe("Sem dados");
  });

  it("domínio sem texto dá null", () => {
    dominio.texto = null;
    expect(motivoSemExclusao(MOV)).toBeNull();
  });

  it("com o domínio real: movimento cancelado dá null e os textos conhecidos falam só em exclusão", () => {
    expect(motivoSemExclusao({ ...MOV, situacao: "cancelado" })).toBeNull();
    const semProva = motivoSemExclusao(MOV);
    expect(semProva).toMatch(/exclusão indisponível/);
    expect(semProva).not.toMatch(/cancel|estorn/i);
    const outroTipo = motivoSemExclusao({ ...MOV, tipo: "Entrada" });
    expect(outroTipo).toBe("Exclusão não disponível para este tipo.");
  });
});
