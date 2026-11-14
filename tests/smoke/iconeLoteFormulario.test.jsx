/**
 * D-PROD-191 — prévia do ícone do lote no Formulário de Lote, vinda do CÓDIGO.
 *
 * O desenho é o subícone de `src/assets/icones/lotes`, pela chave SEXO + FAIXA DE IDADE da
 * Categoria de Manejo escolhida: o animal sozinho, na cor do sexo (nunca misto). Sem
 * upload, sem catálogo, sem rede, sem query e sem cache: aparece offline. O lote não
 * guarda ícone. Só os services de dados do formulário são substituídos; o motor de
 * ícones é o real. A rede fica bloqueada pelo setup do smoke (`fetch` é um mock).
 */
import React from "react";
import { existsSync, readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { COR_FEMEA, COR_MACHO, COR_MISTO } from "@/assets/icones/lotes";

const api = { categoriasManejo: vi.fn() };

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

const CATEGORIAS_MANEJO = [
  // Ainda vinculada ao catálogo antigo: a prévia ignora o vínculo.
  { id: "cm-novilha", empresa_id: "emp-1", nome: "NOVILHA", sexo: "Fêmea", idade_minima_meses: 13, idade_maxima_meses: 24, catalogo_categoria_visual_id: "cv-nov" },
  { id: "cm-bezerro", empresa_id: "emp-1", nome: "BEZERRO", sexo: "Macho", idade_minima_meses: 0, idade_maxima_meses: 8 },
  { id: "cm-sem-faixa", empresa_id: "emp-1", nome: "MACHO SEM FAIXA", sexo: "Macho" },
  { id: "cm-sem-sexo", empresa_id: "emp-1", nome: "SEM SEXO", idade_minima_meses: 25, idade_maxima_meses: 36 },
];

const LOTE = {
  id: "lote-1", nome: "LOTE 1", quantidade_cabecas: 10, peso_medio_kg: 180, area_entrada_id: "a1", setor_id: "s1",
  motivo_entrada: "COMPRA", categoria_manejo_id: "cm-novilha", data_entrada: "2026-10-01",
};

/** @type {QueryClient} */
let qc;
const renderLote = async (props) => {
  const { default: FormularioLote } = await import("@/components/lotes/FormularioLote.jsx");
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSubmit = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <FormularioLote visualVariant="base1" variant="embedded" toolbarActions readOnly={false}
        onSubmit={onSubmit} onCancel={() => {}} {...props} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api.categoriasManejo).toHaveBeenCalled());
  return { onSubmit };
};

const dica = () => screen.queryByTestId("icone-lote-categoria");
const PREFIXO_SVG = "data:image/svg+xml;base64,";
/** O SVG desenhado na amostra da dica. */
const svgDaAmostra = () => {
  const src = dica()?.querySelector("img")?.getAttribute("src") ?? "";
  expect(src.startsWith(PREFIXO_SVG)).toBe(true);
  return atob(src.slice(PREFIXO_SVG.length));
};
/** A dica mostra o animal da figura, na cor do sexo — nunca o misto. */
const esperaAnimal = async (figura, cor) => {
  await waitFor(() => expect(dica()?.getAttribute("data-figura")).toBe(figura));
  expect(dica()?.getAttribute("data-status")).toBe("ok");
  expect(dica()?.textContent).toBe("Ícone da categoria");
  const svg = svgDaAmostra();
  expect(svg).toContain(`data-figura="${figura}"`);
  expect(svg).toContain(`fill="${cor}"`);
  expect(svg).not.toContain(COR_MISTO);
};

beforeEach(() => {
  cleanup();
  api.categoriasManejo.mockReset();
  api.categoriasManejo.mockResolvedValue(CATEGORIAS_MANEJO);
  localStorage.removeItem("cadastro_lotes_form_layout_config");
});
afterEach(() => cleanup());

describe("D-PROD-191 — o Formulário de Lote mostra o ícone da categoria, vindo do código", () => {
  it("editar lote: o animal da categoria (fêmea, 13 a 24 meses), na cor da fêmea", async () => {
    await renderLote({ initialData: LOTE, isEditing: true });
    await esperaAnimal("femea-13-24", COR_FEMEA);
    expect(screen.getByAltText("Fêmea, 13 a 24 meses")).toBeInTheDocument();
  });

  it("duplicar lote: o animal da categoria do registro duplicado (macho, 0 a 8 meses), na cor do macho", async () => {
    await renderLote({ initialData: { ...LOTE, id: undefined, categoria_manejo_id: "cm-bezerro", _isDuplicate: true }, isEditing: true });
    await esperaAnimal("macho-0-8", COR_MACHO);
  });

  it("novo lote: sem categoria escolhida, nada sob o campo; escolher e trocar a categoria troca o desenho", async () => {
    await renderLote({ initialData: null, isEditing: false });
    expect(dica()).toBeNull();
    const campo = screen.getByPlaceholderText("BUSCAR CATEGORIA...");

    await act(async () => fireEvent.click(campo));
    await act(async () => fireEvent.click(screen.getByRole("option", { name: "NOVILHA" })));
    await esperaAnimal("femea-13-24", COR_FEMEA);

    await act(async () => fireEvent.click(campo));
    await act(async () => fireEvent.click(screen.getByRole("option", { name: "BEZERRO" })));
    await esperaAnimal("macho-0-8", COR_MACHO);
  });

  it.each([
    ["sem faixa de idade", "cm-sem-faixa"],
    ["sem sexo (o sexo gravado no lote não completa a chave)", "cm-sem-sexo"],
  ])("categoria %s: dica 'Sem ícone…', sem desenho", async (_caso, categoriaId) => {
    await renderLote({ initialData: { ...LOTE, categoria_manejo_id: categoriaId, sexo: "Fêmea" }, isEditing: true });
    await waitFor(() => expect(dica()?.getAttribute("data-status")).toBe("sem_icone"));
    expect(dica()?.textContent).toBe("Sem ícone: categoria sem sexo ou faixa de idade");
    expect(dica()?.querySelector("img")).toBeNull();
  });

  it("nenhuma API de catálogo nem rede; nenhuma query de ícone; o componente do catálogo saiu", async () => {
    await renderLote({ initialData: LOTE, isEditing: true });
    await esperaAnimal("femea-13-24", COR_FEMEA);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const chaves = qc.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey));
    expect(chaves.filter((k) => /catalogo|icone/i.test(k))).toEqual([]);
    expect(screen.queryByTestId("icone-oficial-lote")).toBeNull();
    expect(existsSync("src/components/catalogoGlobal/IconeOficialLotePreview.jsx")).toBe(false);
    expect(readFileSync("src/components/lotes/FormularioLote.jsx", "utf8")).not.toMatch(/IconeOficialLotePreview|catalogo_categoria_visual_id/);
  });

  it("a prévia sozinha aparece offline: sem QueryClient e sem rede", async () => {
    const { default: IconeLotePreview } = await import("@/components/lotes/IconeLotePreview.jsx");
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    render(<IconeLotePreview categoria={CATEGORIAS_MANEJO[1]} />);
    await esperaAnimal("macho-0-8", COR_MACHO);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("o payload salvo não ganha campo de ícone (o duplicado leva a categoria, e só ela)", async () => {
    const { onSubmit } = await renderLote({ initialData: { ...LOTE, id: undefined, categoria_manejo_id: "cm-bezerro", _isDuplicate: true }, isEditing: true });
    await esperaAnimal("macho-0-8", COR_MACHO);
    fireEvent.submit(/** @type {HTMLFormElement} */ (document.getElementById("formulario-lote-base1")));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.categoria_manejo_id).toBe("cm-bezerro");
    expect(Object.keys(payload).filter((k) => /icone|figura|catalogo/i.test(k))).toEqual([]);
  });
});
