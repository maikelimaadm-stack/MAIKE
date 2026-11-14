/**
 * D-PROD-196 — raça predominante e idade média (meses) saíram do cadastro do lote.
 * Prova, no front:
 *  (a) a porta não envia os dois campos no POST nem no PATCH, mesmo que venham
 *      num corpo antigo (fila offline gravada pela versão anterior);
 *  (b) a grade do cadastro não tem mais a coluna Raça;
 *  (c) os detalhes do lote no mapa não mostram mais Raça (nem coluna, nem card);
 *  (d) a correção da entrada não compara nem envia os dois campos.
 */
import { describe, it, expect, vi } from "vitest";

const nativeRequest = vi.fn(async (_url, opts) => ({ id: "l1", ...(opts?.body || {}) }));
vi.mock("@/apis/_core/nativeHttpClient.js", () => ({ nativeRequest: (...a) => nativeRequest(...a) }));

const REMOVIDOS = ["raca_predominante", "idade_media_meses"];

describe("D-PROD-196 — lote sem raça predominante e idade média", () => {
  it("(a) a porta não envia os campos removidos (POST e PATCH)", async () => {
    const { operacoesNativas } = await import("@/apis/lotes/loteNativePort.js");
    const antigo = { empresa_id: "e1", nome: "L1", quantidade_cabecas: 10, motivo_entrada: "Compra", raca_predominante: "NELORE", idade_media_meses: 12 };
    await operacoesNativas.create(antigo);
    await operacoesNativas.update("l1", { nome: "L2", raca_predominante: "ANGUS", idade_media_meses: 24 });
    const [post, patch] = nativeRequest.mock.calls.map(([, opts]) => opts.body);
    expect(post).toMatchObject({ nome: "L1", quantidade_cabecas: 10 });
    expect(patch).toEqual({ nome: "L2" });
    for (const corpo of [post, patch]) for (const c of REMOVIDOS) expect(corpo).not.toHaveProperty(c);
  });

  it("(b) a grade do cadastro não tem a coluna Raça", async () => {
    const { COLUNAS_DISPONIVEIS } = await import("@/components/lotes/TabelaLotes");
    expect(COLUNAS_DISPONIVEIS.map((c) => c.id)).not.toContain("raca");
    for (const rotulo of COLUNAS_DISPONIVEIS.map((c) => c.label)) expect(rotulo).not.toMatch(/(^|\s)(Raça|Idade)(\s|$)/i);
  });

  it("(c) os detalhes do lote no mapa não mostram Raça", async () => {
    const { CAMPOS_LOTE } = await import("@/components/mapa/detalhes-lote/catalogo.js");
    expect(CAMPOS_LOTE.map((c) => c.id ?? c.chave ?? c[0])).not.toContain("raca");
    expect(JSON.stringify(CAMPOS_LOTE.map((c) => c.rotulo ?? c.label ?? null))).not.toMatch(/Raça/);
  });

  it("(d) a correção da entrada ignora os campos removidos", async () => {
    const { CAMPOS_ADMINISTRATIVOS_DA_ENTRADA } = await import("@/domain/lotes/correcaoEntrada");
    for (const c of REMOVIDOS) expect(CAMPOS_ADMINISTRATIVOS_DA_ENTRADA).not.toHaveProperty(c);
  });
});
