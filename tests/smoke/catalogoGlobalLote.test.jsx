/**
 * PR145-R2 (D-PROD-69) — catálogo global só leitura.
 *
 * Sem painel de gerenciamento no MAIKE. O vínculo
 * CategoriaManejo.catalogo_categoria_visual_id → categoria visual do tipo
 * `lote` SAIU na Fatia D (D-PROD-187, emenda do proprietário): a coluna foi
 * apagada, o seletor "Ícone oficial (catálogo MAK Gestão)" saiu do cadastro de
 * Categoria de Manejo e a prévia do ícone saiu do Formulário de Lote (ela só
 * dependia desse vínculo). Este arquivo prova que nada disso voltou e que o
 * lote não consulta o catálogo. Só as chamadas HTTP são substituídas.
 */
import React from "react";
import { existsSync, readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = {
  categoriasManejo: vi.fn(),
};

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

/** Uma categoria ainda traz o vínculo antigo (cache de antes da D-PROD-187): nada pode usá-lo. */
const CATEGORIAS_MANEJO = [
  { id: "cm-bez", empresa_id: "emp-1", nome: "BEZERRO DESMAMA", catalogo_categoria_visual_id: "cv-bez" },
  { id: "cm-gar", empresa_id: "emp-1", nome: "GARROTE" },
];

const wrap = (ui) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Prov = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return render(ui, { wrapper: Prov });
};

beforeEach(() => {
  cleanup();
  Object.values(api).forEach((f) => f.mockReset());
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

  it("o frontend não tem mais cliente do catálogo global (D-PROD-187: o único consumidor era o vínculo do ícone)", () => {
    expect(existsSync("src/apis/catalogoGlobal")).toBe(false);
    expect(existsSync("src/services/catalogoGlobalService.js")).toBe(false);
  });
});

describe("D-PROD-187: o ícone oficial saiu do cadastro de Categoria de Manejo e do Formulário de Lote", () => {
  it("os componentes e o service do vínculo não existem mais", () => {
    for (const arquivo of [
      "src/components/catalogoGlobal/CategoriaOficialCatalogoSelect.jsx",
      "src/components/catalogoGlobal/IconeOficialLotePreview.jsx",
      "src/services/catalogoGlobalService.js",
    ]) {
      expect(existsSync(arquivo), arquivo).toBe(false);
    }
    for (const arquivo of ["src/components/lotes/FormularioLote.jsx", "src/components/categorias-manejo/FormularioCategoriaManejo.jsx"]) {
      expect(readFileSync(arquivo, "utf8"), arquivo).not.toMatch(/IconeOficialLotePreview|CategoriaOficialCatalogoSelect|catalogo_categoria_visual_id/);
    }
  });

  it("o formulário de Categoria de Manejo não tem o campo; registro antigo com vínculo salva sem enviá-lo", async () => {
    const { default: Form, buildFormInitialFromRecord } = await import("@/components/categorias-manejo/FormularioCategoriaManejo");
    const { normalizarCategoriaManejo } = await vi.importActual("@/services/categoriaManejoService");
    const onSubmit = vi.fn();
    wrap(
      <Form
        initialData={buildFormInitialFromRecord({
          id: "cm-bez", nome: "BEZERRO", sigla: "BZ", especie: "Bovinos", sexo: "Macho",
          idade_minima_meses: 0, idade_maxima_meses: 8,
          catalogo_categoria_visual_id: "cv-bez",
        })}
        isEditing
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByLabelText("Ícone oficial (catálogo MAK Gestão)")).toBeNull();
    expect(screen.queryByTestId("categoria-oficial-catalogo")).toBeNull();
    expect(screen.queryByText(/SEM VÍNCULO|upload|enviar imagem|publicar/i)).toBeNull();
    fireEvent.submit(screen.getByTestId("b1-form-categoria-manejo"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = normalizarCategoriaManejo(onSubmit.mock.calls[0][0], { empresaId: "emp-1", edicao: true });
    expect(Object.keys(payload).filter((k) => /icone|catalogo/i.test(k))).toEqual([]);
    for (const f of Object.values(api)) expect(f).not.toHaveBeenCalled();
  });
});

describe("FormularioLote sem prévia do ícone oficial (D-PROD-187)", () => {
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
  const semCatalogo = () => {
    expect(screen.queryByTestId("icone-oficial-lote")).toBeNull();
    expect(screen.queryByAltText("Ícone oficial do lote")).toBeNull();
  };

  it("novo lote: sem dica de ícone sob a Categoria de Manejo e sem consulta ao catálogo", async () => {
    await renderLote({ initialData: null, isEditing: false });
    await waitFor(() => expect(api.categoriasManejo).toHaveBeenCalled());
    semCatalogo();
  });

  it("editar lote cuja categoria ainda traz o vínculo antigo (cache): nada de ícone, nada de catálogo", async () => {
    await renderLote({ initialData: LOTE, isEditing: true });
    await waitFor(() => expect(api.categoriasManejo).toHaveBeenCalled());
    semCatalogo();
  });

  it("duplicar lote: idem", async () => {
    await renderLote({ initialData: { ...LOTE, id: undefined, categoria_manejo_id: "cm-gar", _isDuplicate: true }, isEditing: true });
    await waitFor(() => expect(api.categoriasManejo).toHaveBeenCalled());
    semCatalogo();
  });

  it("o lote salva com payload sem campo de ícone", async () => {
    const { onSubmit } = await renderLote({ initialData: LOTE, isEditing: true });
    await waitFor(() => expect(api.categoriasManejo).toHaveBeenCalled());
    fireEvent.submit(document.getElementById("formulario-lote-base1"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0];
    // Edição de lote já lançado não reenvia a categoria (é a da entrada, D-PROD-85).
    expect(payload).not.toHaveProperty("categoria_manejo_id");
    expect(Object.keys(payload).filter((k) => /icone|catalogo/i.test(k))).toEqual([]);
    semCatalogo();
  });
});
