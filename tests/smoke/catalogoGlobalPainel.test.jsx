/**
 * MAIKE-CATALOGO-GLOBAL-ICONES-LOTES-01 — painel interno + prévia no lote.
 *
 * O service real é usado nas regras (códigos de erro, resolvedor, limites);
 * só as chamadas HTTP são substituídas. Fixtures de imagem são bytes
 * sintéticos — nenhuma imagem do proprietário entra em teste.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = {
  visao: vi.fn(),
  revisao: vi.fn(),
  criarTipo: vi.fn(),
  enviarImagem: vi.fn(),
  criarIcone: vi.fn(),
  publicar: vi.fn(),
  listarPublicados: vi.fn(),
};
const avisos = { sucesso: vi.fn(), aviso: vi.fn(), erro: vi.fn() };

vi.mock("@/services/catalogoGlobalService", async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    carregarVisaoAdminCatalogo: (...a) => api.visao(...a),
    obterRevisaoCatalogo: (...a) => api.revisao(...a),
    criarTipoCatalogo: (...a) => api.criarTipo(...a),
    enviarImagemCatalogo: (...a) => api.enviarImagem(...a),
    criarIconeCatalogo: (...a) => api.criarIcone(...a),
    publicarIconeCatalogo: (...a) => api.publicar(...a),
    listarIconesOficiaisPublicados: (...a) => api.listarPublicados(...a),
  };
});

vi.mock("@/lib/maikeNotify", () => ({
  notifySuccess: (...a) => avisos.sucesso(...a),
  notifyWarning: (...a) => avisos.aviso(...a),
  notifyError: (...a) => avisos.erro(...a),
  notifyInfo: vi.fn(),
}));

const erroServidor = (code) => Object.assign(new Error(code), { code: "OPERATION_FAILED", cause: { code } });

const VISAO = {
  revisao: 7,
  limites: { mimes: ["image/png", "image/jpeg", "image/webp", "image/gif"], max_bytes: 512 * 1024 },
  tipos: [{ id: "t1", codigo: "lote", nome: "Lote", ordem: 0, ativo: true }],
  categorias: [{ id: "c1", tipo_id: "t1", codigo: "bezerro", nome: "Bezerro", ordem: 0, ativo: true }],
  icones: [
    {
      id: "i1",
      tipo_id: "t1",
      categoria_id: "c1",
      estado: "rascunho",
      ativo: true,
      revisao: 0,
      cor_fallback: null,
      asset_principal: { id: "a1", mime: "image/png", bytes: 68, public_url: "https://cdn.exemplo/a1.png" },
      asset_subicone: null,
    },
  ],
  assets: [],
};

const wrap = (ui) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
  cleanup();
  Object.values(api).forEach((f) => f.mockReset());
  Object.values(avisos).forEach((f) => f.mockReset());
  globalThis.URL.createObjectURL ||= () => "blob:previa";
});

describe("Painel interno do catálogo global", () => {
  it("tenant sem OperadorProdutoMaike (403) vê acesso restrito e nenhum formulário", async () => {
    api.visao.mockRejectedValue(erroServidor("PRODUCT_OPERATOR_REQUIRED"));
    const { default: Pagina } = await import("@/pages/CatalogoGlobalMaike");
    wrap(<Pagina />);
    expect(await screen.findByText("Acesso restrito")).toBeTruthy();
    expect(screen.queryByText("Novo ícone")).toBeNull();
    expect(screen.queryByRole("button", { name: /criar/i })).toBeNull();
  });

  it("erro genérico mostra mensagem e permite tentar de novo", async () => {
    api.visao.mockRejectedValueOnce(new Error("rede")).mockResolvedValue(VISAO);
    const { default: Pagina } = await import("@/pages/CatalogoGlobalMaike");
    wrap(<Pagina />);
    fireEvent.click(await screen.findByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Bezerro", { selector: "p" })).toBeTruthy();
  });

  it("operador vê ícone em rascunho com prévia, revisão e limites do backend", async () => {
    api.visao.mockResolvedValue(VISAO);
    const { default: Pagina } = await import("@/pages/CatalogoGlobalMaike");
    wrap(<Pagina />);
    expect(await screen.findByText(/revisão 7/)).toBeTruthy();
    expect(screen.getByText("Rascunho")).toBeTruthy();
    expect(screen.getByAltText("Ícone principal").getAttribute("src")).toBe("https://cdn.exemplo/a1.png");
    expect(screen.getByText(/image\/png, image\/jpeg, image\/webp, image\/gif/)).toBeTruthy();
    expect(screen.getByText(/até 512 KB/)).toBeTruthy();
  });

  it("publicar com revisão desatualizada (409) avisa, recarrega e não mostra sucesso", async () => {
    api.visao.mockResolvedValue(VISAO);
    api.publicar.mockRejectedValue(Object.assign(new Error("409"), { code: "CONCURRENCY_CONFLICT" }));
    const { default: Pagina } = await import("@/pages/CatalogoGlobalMaike");
    wrap(<Pagina />);
    fireEvent.click(await screen.findByRole("button", { name: "Publicar" }));
    await waitFor(() => expect(avisos.aviso).toHaveBeenCalled());
    expect(api.publicar).toHaveBeenCalledWith("i1", 7);
    expect(avisos.aviso.mock.calls[0][0]).toMatch(/outro operador/);
    expect(avisos.sucesso).not.toHaveBeenCalled();
    await waitFor(() => expect(api.visao.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("criar tipo manda revisao_esperada atual e só confirma após sucesso", async () => {
    api.visao.mockResolvedValue(VISAO);
    let resolver;
    api.criarTipo.mockReturnValue(new Promise((r) => (resolver = r)));
    const { default: Pagina } = await import("@/pages/CatalogoGlobalMaike");
    wrap(<Pagina />);
    fireEvent.change(await screen.findByLabelText("Código do novo tipo"), { target: { value: "area" } });
    fireEvent.change(screen.getByLabelText("Nome do novo tipo"), { target: { value: "Área" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar tipo" }));
    await waitFor(() => expect(api.criarTipo).toHaveBeenCalledWith({ codigo: "area", nome: "Área" }, 7));
    expect(avisos.sucesso).not.toHaveBeenCalled();
    resolver({ id: "t2" });
    await waitFor(() => expect(avisos.sucesso).toHaveBeenCalled());
  });

  it("novo ícone: envia a imagem sem alterar, relê a revisão e cria com o asset", async () => {
    api.visao.mockResolvedValue(VISAO);
    api.enviarImagem.mockResolvedValue({ id: "a9" });
    api.revisao.mockResolvedValue(8);
    api.criarIcone.mockResolvedValue({ id: "i9" });
    const { default: Pagina } = await import("@/pages/CatalogoGlobalMaike");
    wrap(<Pagina />);
    fireEvent.change(await screen.findByLabelText("Tipo do ícone"), { target: { value: "t1" } });
    fireEvent.change(screen.getByLabelText("Categoria do ícone"), { target: { value: "c1" } });
    const arquivo = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "bezerro.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Imagem principal"), { target: { files: [arquivo] } });
    fireEvent.click(screen.getByRole("button", { name: "Criar ícone" }));
    await waitFor(() => expect(api.criarIcone).toHaveBeenCalled());
    expect(api.enviarImagem.mock.calls[0][0]).toBe(arquivo);
    expect(api.enviarImagem.mock.calls[0][1]).toBe(7);
    expect(api.criarIcone).toHaveBeenCalledWith(
      { tipo_id: "t1", categoria_id: "c1", asset_principal_id: "a9", asset_subicone_id: null, cor_fallback: null },
      8,
    );
  });
});

describe("Service do catálogo — regras locais", () => {
  it("resolvedor do lote: sem vínculo explícito → pendente; nunca casa por texto", async () => {
    const { resolverIconeOficialDoLote } = await vi.importActual("@/services/catalogoGlobalService");
    const icones = [{ id: "i1", categoria_id: "c1", asset_principal_url: "u" }];
    expect(resolverIconeOficialDoLote({ categoriaVisualId: null, icones })).toEqual({ status: "mapeamento_pendente" });
    expect(resolverIconeOficialDoLote({ categoriaVisualId: "c2", icones })).toEqual({
      status: "sem_icone_publicado",
      categoriaVisualId: "c2",
    });
    expect(resolverIconeOficialDoLote({ categoriaVisualId: "c1", icones }).status).toBe("ok");
  });

  it("enviarImagemCatalogo recusa formato fora da whitelist e arquivo acima do limite antes da rede", async () => {
    const { enviarImagemCatalogo } = await vi.importActual("@/services/catalogoGlobalService");
    const limites = { mimes: ["image/png"], max_bytes: 10 };
    await expect(enviarImagemCatalogo(new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }), 1, limites)).rejects.toThrow(
      /Formato não aceito/,
    );
    await expect(enviarImagemCatalogo(new File([new Uint8Array(20)], "x.png", { type: "image/png" }), 1, limites)).rejects.toThrow(
      /acima do limite/,
    );
  });

  it("códigos de erro do servidor são lidos do corpo original (cause)", async () => {
    const { ehSemPermissaoCatalogo, ehConflitoRevisaoCatalogo } = await vi.importActual("@/services/catalogoGlobalService");
    expect(ehSemPermissaoCatalogo(erroServidor("PRODUCT_OPERATOR_REQUIRED"))).toBe(true);
    expect(ehConflitoRevisaoCatalogo({ code: "CONCURRENCY_CONFLICT" })).toBe(true);
    expect(ehSemPermissaoCatalogo(new Error("x"))).toBe(false);
  });
});

describe("Prévia do ícone oficial no lote", () => {
  it("sem vínculo explícito mostra pendência e não consulta o catálogo", async () => {
    const { default: Previa } = await import("@/components/catalogoGlobal/IconeOficialLotePreview");
    wrap(<Previa />);
    const el = await screen.findByTestId("icone-oficial-lote");
    expect(el.getAttribute("data-status")).toBe("mapeamento_pendente");
    expect(el.textContent).toMatch(/ainda não configurado/);
    expect(api.listarPublicados).not.toHaveBeenCalled();
  });

  it("com vínculo explícito mostra o ícone publicado; catálogo fora do ar não quebra", async () => {
    const { default: Previa } = await import("@/components/catalogoGlobal/IconeOficialLotePreview");
    api.listarPublicados.mockResolvedValue([{ id: "i1", categoria_id: "c1", asset_principal_url: "https://cdn/x.png" }]);
    wrap(<Previa categoriaVisualId="c1" />);
    expect((await screen.findByAltText("Ícone oficial do lote")).getAttribute("src")).toBe("https://cdn/x.png");
    cleanup();
    api.listarPublicados.mockReset();
    api.listarPublicados.mockRejectedValue(new Error("fora"));
    wrap(<Previa categoriaVisualId="c1" />);
    await waitFor(() => expect(screen.getByTestId("icone-oficial-lote").getAttribute("data-status")).toBe("erro"));
  });
});
