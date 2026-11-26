/**
 * Diário da máquina — degradação no service e o corpo da quantidade padrão no cadastro de produto.
 *  - `diarioDisponivel`: recusa do servidor (rota inexistente, 404/405/501 ou erro de contrato) = indisponível (false);
 *    falta de rede (`PROVIDER_UNAVAILABLE`) é lançada, para o react-query tentar de novo;
 *  - `normalizarProduto`: a quantidade padrão só vai quando a pessoa a preencheu ou mudou (servidor antigo recusa campo
 *    desconhecido); preenchida, vai como texto decimal na unidade L ou KG; limpa na edição, vai como null.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/apis/atividades/misturaPort", () => ({
  misturaPort: { listar: vi.fn(), criar: vi.fn(), aplicar: vi.fn(), sobra: vi.fn(), resumoDoDia: vi.fn() },
}));

import { API_ERROR_CODES, ApiError } from "@/apis/_core/ApiError";
import { misturaPort } from "@/apis/atividades/misturaPort";
import { definirFazendaDaTela } from "@/services/lancamentoAtividadesService";
import { diarioDisponivel } from "@/services/diarioMaquinaService";
import { normalizarProduto } from "@/services/produtoService";

describe("diarioDisponivel — degradação", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    definirFazendaDaTela("emp-1");
  });

  it("com dados (items) = ligado", async () => {
    vi.mocked(misturaPort.listar).mockResolvedValue({ items: [] });
    await expect(diarioDisponivel("atv-1")).resolves.toBe(true);
    expect(misturaPort.listar).toHaveBeenCalledWith("atv-1", "emp-1");
  });

  it("recusa do servidor (rota que não existe) = indisponível, sem lançar", async () => {
    vi.mocked(misturaPort.listar).mockRejectedValue(new ApiError(API_ERROR_CODES.OPERATION_FAILED, { operation: "listMisturas" }));
    await expect(diarioDisponivel("atv-1")).resolves.toBe(false);
  });

  it("resposta sem `items` = indisponível", async () => {
    vi.mocked(misturaPort.listar).mockResolvedValue(null);
    await expect(diarioDisponivel("atv-1")).resolves.toBe(false);
  });

  it("falta de rede é lançada (não marca o diário como indisponível)", async () => {
    vi.mocked(misturaPort.listar).mockRejectedValue(new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, { operation: "listMisturas" }));
    await expect(diarioDisponivel("atv-1")).rejects.toMatchObject({ code: API_ERROR_CODES.PROVIDER_UNAVAILABLE });
  });

  it("sem fazenda na tela, nem pergunta ao servidor", async () => {
    definirFazendaDaTela(null);
    await expect(diarioDisponivel("atv-1")).resolves.toBe(false);
    expect(misturaPort.listar).not.toHaveBeenCalled();
  });
});

describe("normalizarProduto — quantidade padrão por implemento cheio", () => {
  const base = { nome_produto: "Herbicida", categoria: "Herbicida", unidade_medida: "L", unidade_principal_estoque: "L", ativo: true };

  it("sem mexer no campo, o corpo não leva a quantidade padrão", () => {
    const payload = normalizarProduto({ ...base, quantidade_padrao: "4", quantidade_padrao_unidade: "L" }, { isEditing: true });
    expect(payload).not.toHaveProperty("quantidade_padrao");
    expect(payload).not.toHaveProperty("quantidade_padrao_unidade");
  });

  it("preenchida pela pessoa, vai como texto decimal na unidade escolhida", () => {
    const payload = normalizarProduto({ ...base, quantidade_padrao: "0,5", quantidade_padrao_unidade: "L", quantidade_padrao_alterada: true }, { isEditing: false });
    expect(payload).toMatchObject({ quantidade_padrao: "0.5", quantidade_padrao_unidade: "L" });
  });

  it("limpa na edição: vai como null", () => {
    const payload = normalizarProduto({ ...base, quantidade_padrao: "", quantidade_padrao_unidade: "KG", quantidade_padrao_alterada: true }, { isEditing: true });
    expect(payload).toMatchObject({ quantidade_padrao: null, quantidade_padrao_unidade: "KG" });
  });
});
