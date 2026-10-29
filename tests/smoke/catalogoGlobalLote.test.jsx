/**
 * PR145-R2 (D-PROD-69) — catálogo global só leitura + ícone oficial no lote.
 *
 * Sem painel de gerenciamento no MAIKE. O vínculo é
 * CategoriaManejo.catalogo_categoria_visual_id → categoria visual do tipo
 * `lote`; o FormularioLote deriva a prévia da categoria de manejo escolhida.
 * Só as chamadas HTTP são substituídas; URLs de imagem são fictícias.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = {
  tipos: vi.fn(),
  categorias: vi.fn(),
  icones: vi.fn(),
  categoriasManejo: vi.fn(),
};

vi.mock("@/apis/catalogoGlobal", () => ({
  listTiposCatalogoPublicados: (...a) => api.tipos(...a),
  listCategoriasCatalogoPublicadas: (...a) => api.categorias(...a),
  listIconesCatalogoPublicados: (...a) => api.icones(...a),
}));

vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
vi.mock("@/hooks/useSetorAreas", () => ({
  default: () => ({
    setores: [{ id: "s1", nome: "SETOR 1" }],
    areas: [{ id: "a1", nome: "AREA 1", setor_id: "s1" }],
    getAreasBySetor: () => [{ id: "a1", nome: "AREA 1", setor_id: "s1" }],
  }),
}));
vi.mock("@/services/loteCadastroService", async (importOriginal) => ({
  ...(await importOriginal()),
  listarCategoriasManejoAtivas: (...a) => api.categoriasManejo(...a),
  listarFornecedores: vi.fn(async () => []),
}));

const TIPOS = [
  { id: "t-lote", codigo: "lote", nome: "Lote" },
  { id: "t-area", codigo: "area", nome: "Área" },
];
const CATEGORIAS = [
  { id: "cv-bez", tipo_id: "t-lote", codigo: "bezerro", nome: "Bezerro" },
  { id: "cv-gar", tipo_id: "t-lote", codigo: "garrote", nome: "Garrote" },
  { id: "cv-pasto", tipo_id: "t-area", codigo: "pasto", nome: "Pasto" },
];
const ICONES = [
  { id: "i-bez", tipo_id: "t-lote", categoria_id: "cv-bez", revisao: 2, asset_principal_url: "https://cdn.exemplo/v2/bez.png" },
  { id: "i-gar", tipo_id: "t-lote", categoria_id: "cv-gar", revisao: 1, asset_principal_url: "https://cdn.exemplo/v1/gar.png" },
];
const CATEGORIAS_MANEJO = [
  { id: "cm-bez", empresa_id: "emp-1", nome: "BEZERRO DESMAMA", catalogo_categoria_visual_id: "cv-bez" },
  { id: "cm-gar", empresa_id: "emp-1", nome: "GARROTE", catalogo_categoria_visual_id: "cv-gar" },
  { id: "cm-sem", empresa_id: "emp-1", nome: "SEM VINCULO", catalogo_categoria_visual_id: null },
];

const wrap = (ui) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Prov = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return render(ui, { wrapper: Prov });
};

beforeEach(() => {
  cleanup();
  Object.values(api).forEach((f) => f.mockReset());
  api.tipos.mockResolvedValue(TIPOS);
  api.categorias.mockResolvedValue(CATEGORIAS);
  api.icones.mockResolvedValue(ICONES);
  api.categoriasManejo.mockResolvedValue(CATEGORIAS_MANEJO);
  localStorage.removeItem("cadastro_lotes_form_layout_config");
});
afterEach(() => cleanup());

describe("Sem painel de gerenciamento do catálogo no MAIKE", () => {
  it("não há página, rota de escopo nem rewrite /CatalogoGlobalMaike", async () => {
    const { PAGES } = await import("@/pages.config.js");
    expect(Object.keys(PAGES)).not.toContain("CatalogoGlobalMaike");
    const escopo = JSON.parse(readFileSync("config/mapa-manejo-scope.json", "utf8"));
    expect(JSON.stringify(escopo)).not.toMatch(/CatalogoGlobalMaike/i);
    expect(readFileSync("vercel.json", "utf8")).not.toMatch(/catalogoglobalmaike/i);
  });

  it("a API do catálogo no frontend é só leitura (sem upload/publicar/desativar)", async () => {
    const mod = await vi.importActual("@/apis/catalogoGlobal");
    expect(Object.keys(mod).sort()).toEqual([
      "listCategoriasCatalogoPublicadas",
      "listIconesCatalogoPublicados",
      "listTiposCatalogoPublicados",
    ]);
    const porta = readFileSync("src/apis/catalogoGlobal/catalogoGlobalNativePort.js", "utf8");
    expect(porta).not.toMatch(/\/admin\/|method:\s*'(POST|PATCH|PUT|DELETE)'/);
  });
});

describe("Resolver do ícone oficial do lote", () => {
  it("sem vínculo → pendente; outro tipo ou outra categoria nunca casam", async () => {
    const { resolverIconeOficialDoLote: r } = await vi.importActual("@/services/catalogoGlobalService");
    expect(r({ categoriaVisualId: null, tipoLoteId: "t-lote", icones: ICONES })).toEqual({ status: "mapeamento_pendente" });
    const deOutroTipo = [{ id: "x", tipo_id: "t-area", categoria_id: "cv-bez", revisao: 9 }];
    expect(r({ categoriaVisualId: "cv-bez", tipoLoteId: "t-lote", icones: deOutroTipo }).status).toBe("sem_icone_publicado");
    expect(r({ categoriaVisualId: "cv-zzz", tipoLoteId: "t-lote", icones: ICONES }).status).toBe("sem_icone_publicado");
    expect(r({ categoriaVisualId: "cv-bez", tipoLoteId: null, icones: ICONES }).status).toBe("sem_icone_publicado");
    expect(r({ categoriaVisualId: "cv-bez", tipoLoteId: "t-lote", icones: ICONES }).icone.id).toBe("i-bez");
  });

  it("vários publicados para a mesma categoria: maior revisão vence, empate → menor id, independente da ordem", async () => {
    const { resolverIconeOficialDoLote: r } = await vi.importActual("@/services/catalogoGlobalService");
    const c = [
      { id: "b", tipo_id: "t-lote", categoria_id: "cv-bez", revisao: 3 },
      { id: "a", tipo_id: "t-lote", categoria_id: "cv-bez", revisao: 3 },
      { id: "c", tipo_id: "t-lote", categoria_id: "cv-bez", revisao: 5 },
    ];
    for (const ordem of [c, [...c].reverse(), [c[1], c[2], c[0]]]) {
      const res = r({ categoriaVisualId: "cv-bez", tipoLoteId: "t-lote", icones: ordem });
      expect(res.icone.id).toBe("c");
      expect(res.candidatos).toBe(3);
    }
    expect(r({ categoriaVisualId: "cv-bez", tipoLoteId: "t-lote", icones: c.slice(0, 2) }).icone.id).toBe("a");
  });
});

describe("Categoria de Manejo escolhe a categoria oficial (sem editar ícone)", () => {
  it("lista só categorias publicadas do tipo lote e o id real segue no payload", async () => {
    const { default: Form } = await import("@/components/categorias-manejo/FormularioCategoriaManejo");
    const { normalizarCategoriaManejo } = await vi.importActual("@/services/categoriaManejoService");
    const onSubmit = vi.fn();
    wrap(
      <Form
        initialData={{ nome: "BEZERRO", sigla: "BZ", especie: "Bovinos", sexo: "Macho", raca: "NELORE", categoria_oficial: "Bezerro" }}
        categoriasOficiaisDisponiveis={["Bezerro"]}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    const select = await screen.findByLabelText("Ícone oficial (catálogo MAIKE)");
    await waitFor(() => expect(select.getAttribute("data-status")).toBe("ok"));
    const opcoes = [...select.querySelectorAll("option")].map((o) => o.textContent);
    expect(opcoes).toEqual(["SEM VÍNCULO", "Bezerro", "Garrote"]);
    expect(screen.queryByText(/upload|enviar imagem|publicar/i)).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();

    fireEvent.change(select, { target: { value: "cv-gar" } });
    fireEvent.submit(screen.getByTestId("b1-form-categoria-manejo"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const dados = onSubmit.mock.calls[0][0];
    expect(dados.catalogo_categoria_visual_id).toBe("cv-gar");
    expect(normalizarCategoriaManejo({ ...dados, ganho_peso_anual_kg: "" }, { empresaId: "emp-1" }).catalogo_categoria_visual_id).toBe("cv-gar");
    expect(normalizarCategoriaManejo({ ...dados, catalogo_categoria_visual_id: "" }).catalogo_categoria_visual_id).toBeNull();
  });

  it("ao editar, vínculo gravado aparece; catálogo fora do ar não bloqueia salvar", async () => {
    api.tipos.mockRejectedValue(new Error("rede"));
    const { default: Form, buildFormInitialFromRecord } = await import("@/components/categorias-manejo/FormularioCategoriaManejo");
    const onSubmit = vi.fn();
    wrap(
      <Form
        initialData={buildFormInitialFromRecord({
          id: "cm-bez", nome: "BEZERRO", sigla: "BZ", especie: "Bovinos", sexo: "Macho", raca: "NELORE",
          categoria_oficial: "Bezerro", catalogo_categoria_visual_id: "cv-bez",
        })}
        isEditing
        categoriasOficiaisDisponiveis={["Bezerro"]}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    const select = await screen.findByLabelText("Ícone oficial (catálogo MAIKE)");
    await waitFor(() => expect(select.getAttribute("data-status")).toBe("erro"));
    expect(select.value).toBe("cv-bez");
    fireEvent.submit(screen.getByTestId("b1-form-categoria-manejo"));
    expect(onSubmit.mock.calls[0][0].catalogo_categoria_visual_id).toBe("cv-bez");
  });
});

describe("Prévia do ícone oficial", () => {
  it("troca de categoria troca a imagem; sem vínculo não consulta o catálogo; imagem quebrada usa fallback", async () => {
    const { default: Previa } = await import("@/components/catalogoGlobal/IconeOficialLotePreview");
    const { rerender } = wrap(<Previa categoriaVisualId="cv-bez" categoriaManejoSelecionada />);
    expect((await screen.findByAltText("Ícone oficial do lote")).getAttribute("src")).toBe("https://cdn.exemplo/v2/bez.png");

    rerender(<Previa categoriaVisualId="cv-gar" categoriaManejoSelecionada />);
    await waitFor(() =>
      expect(screen.getByAltText("Ícone oficial do lote").getAttribute("src")).toBe("https://cdn.exemplo/v1/gar.png"),
    );

    rerender(<Previa categoriaVisualId={null} categoriaManejoSelecionada />);
    expect(screen.queryByAltText("Ícone oficial do lote")).toBeNull();
    expect(screen.getByTestId("icone-oficial-lote").getAttribute("data-status")).toBe("mapeamento_pendente");

    rerender(<Previa categoriaVisualId="cv-bez" categoriaManejoSelecionada />);
    fireEvent.error(await screen.findByAltText("Ícone oficial do lote"));
    expect(screen.queryByAltText("Ícone oficial do lote")).toBeNull();
    expect(screen.getByTestId("icone-oficial-lote").getAttribute("data-status")).toBe("ok");
  });

  it("sem vínculo não chama a API", async () => {
    const { default: Previa } = await import("@/components/catalogoGlobal/IconeOficialLotePreview");
    wrap(<Previa categoriaVisualId={null} />);
    expect(screen.getByTestId("icone-oficial-lote").getAttribute("data-status")).toBe("sem_categoria");
    expect(api.icones).not.toHaveBeenCalled();
  });
});

describe("FormularioLote mostra o ícone da categoria de manejo escolhida", () => {
  const LOTE = {
    id: "lote-1", nome: "LOTE 1", quantidade_cabecas: 10, area_entrada_id: "a1", setor_id: "s1",
    motivo_entrada: "COMPRA", categoria_manejo_id: "cm-bez", data_entrada: "2026-10-01",
  };
  const renderLote = async (props) => {
    const { default: FormularioLote } = await import("@/components/lotes/FormularioLote.jsx");
    const onSubmit = vi.fn();
    wrap(
      <FormularioLote visualVariant="base1" variant="embedded" toolbarActions readOnly={false}
        onSubmit={onSubmit} onCancel={() => {}} {...props} />,
    );
    return { onSubmit };
  };
  const status = () => screen.getByTestId("icone-oficial-lote").getAttribute("data-status");

  it("novo lote sem categoria: fallback discreto", async () => {
    await renderLote({ initialData: null, isEditing: false });
    expect(status()).toBe("sem_categoria");
  });

  it("editar lote: prévia real da categoria vinculada", async () => {
    await renderLote({ initialData: LOTE, isEditing: true });
    expect((await screen.findByAltText("Ícone oficial do lote")).getAttribute("src")).toBe("https://cdn.exemplo/v2/bez.png");
    expect(screen.getByTestId("icone-oficial-lote").getAttribute("data-icone-id")).toBe("i-bez");
  });

  it("duplicar lote: prévia real da categoria do registro duplicado", async () => {
    await renderLote({ initialData: { ...LOTE, id: undefined, categoria_manejo_id: "cm-gar", _isDuplicate: true }, isEditing: true });
    expect((await screen.findByAltText("Ícone oficial do lote")).getAttribute("src")).toBe("https://cdn.exemplo/v1/gar.png");
  });

  it("categoria de manejo sem vínculo: pendente, sem consultar ícones", async () => {
    await renderLote({ initialData: { ...LOTE, categoria_manejo_id: "cm-sem" }, isEditing: true });
    await waitFor(() => expect(api.categoriasManejo).toHaveBeenCalled());
    await waitFor(() => expect(status()).toBe("mapeamento_pendente"));
    expect(api.icones).not.toHaveBeenCalled();
  });

  it("catálogo fora do ar: aviso e o lote salva com payload sem campo de ícone", async () => {
    api.icones.mockRejectedValue(new Error("rede"));
    const { onSubmit } = await renderLote({ initialData: LOTE, isEditing: true });
    await waitFor(() => expect(status()).toBe("erro"));
    fireEvent.submit(document.getElementById("formulario-lote-base1"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.categoria_manejo_id).toBe("cm-bez");
    expect(Object.keys(payload).filter((k) => /icone|catalogo/i.test(k))).toEqual([]);
  });
});
