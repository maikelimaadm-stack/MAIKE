/**
 * MAIKE-CATEGORIA-MANEJO-ENXUGAR (Fatia C, D-PROD-185) — cadastro enxuto.
 *
 * CategoriaManejo ficou só com nome (obrigatório), sigla, espécie, sexo,
 * faixa de idade (De ≤ a, ambas opcionais) e o vínculo com o ícone oficial.
 * Raça, categoria oficial (texto), ganho de peso anual e os doze GMDs saíram
 * do contrato. Este arquivo prova, no front:
 *  (a) o formulário mostra só esses campos e bloqueia faixa invertida;
 *  (b) a porta nativa não envia chaves legadas no POST/PATCH;
 *  (c) preferências de coluna salvas com ids removidos não quebram a grade;
 *  (d) as colunas exportáveis (CSV) não trazem nenhum campo removido.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const notifyWarning = vi.fn();
vi.mock("@/lib/maikeNotify", () => ({
  notifyWarning: (...a) => notifyWarning(...a),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock("@/apis/catalogoGlobal", () => ({
  listTiposCatalogoPublicados: vi.fn(async () => [{ id: "t-lote", codigo: "lote", nome: "Lote" }]),
  listCategoriasCatalogoPublicadas: vi.fn(async () => [
    { id: "cv-bez", tipo_id: "t-lote", codigo: "bezerro", nome: "Bezerro" },
  ]),
  listIconesCatalogoPublicados: vi.fn(async () => []),
}));

const nativeRequest = vi.fn(async () => ({ id: "cm1" }));
vi.mock("@/apis/_core/nativeHttpClient.js", () => ({ nativeRequest: (...a) => nativeRequest(...a) }));

/** As 15 chaves que saíram do contrato de CategoriaManejo. */
const CHAVES_REMOVIDAS = Object.freeze([
  "raca",
  "categoria_oficial",
  "ganho_peso_anual_kg",
  "gmd_janeiro",
  "gmd_fevereiro",
  "gmd_marco",
  "gmd_abril",
  "gmd_maio",
  "gmd_junho",
  "gmd_julho",
  "gmd_agosto",
  "gmd_setembro",
  "gmd_outubro",
  "gmd_novembro",
  "gmd_dezembro",
]);

const REMOVIDO_RE = /\braca\b|categoria_oficial|ganho_peso|gmd_/;

const legado = () =>
  Object.fromEntries(CHAVES_REMOVIDAS.map((chave) => [chave, chave === "raca" ? "NELORE" : "1"]));

const wrap = (ui) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
  cleanup();
  notifyWarning.mockReset();
  nativeRequest.mockClear();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("(a) formulário enxuto de Categoria de Manejo", () => {
  it("mostra só Nome, Sigla, Espécie, Sexo, Ícone oficial e a faixa De/a", async () => {
    const { default: Form } = await import("@/components/categorias-manejo/FormularioCategoriaManejo");
    wrap(<Form onSubmit={vi.fn()} onCancel={() => {}} />);
    const form = screen.getByTestId("b1-form-categoria-manejo");

    const rotulos = [...form.querySelectorAll("label.mg-field__label")].map((l) =>
      l.textContent.replace(/\s*\*\s*$/, "").trim(),
    );
    expect(rotulos).toEqual([
      "Nome da Categoria",
      "Sigla",
      "Espécie",
      "Sexo",
      "Ícone oficial (catálogo MAK Gestão)",
      "De",
      "a",
    ]);
    expect(screen.getByText("Faixa de idade (meses)")).toBeTruthy();
    expect(await screen.findByLabelText("Ícone oficial (catálogo MAK Gestão)")).toBeTruthy();

    expect(form.querySelectorAll('input[type="number"]')).toHaveLength(2);
    expect(form.textContent).not.toMatch(/Raça|Categoria oficial|Ganho|GMD|Janeiro|Dezembro/i);
    for (const el of form.querySelectorAll("[name]")) {
      expect(el.getAttribute("name")).not.toMatch(REMOVIDO_RE);
    }
  });

  it("De > a bloqueia o envio com MENSAGEM_FAIXA_IDADE_INVALIDA; corrigir libera", async () => {
    const mod = await import("@/components/categorias-manejo/FormularioCategoriaManejo");
    const { default: Form, MENSAGEM_FAIXA_IDADE_INVALIDA, faixaIdadeValida } = mod;
    expect(MENSAGEM_FAIXA_IDADE_INVALIDA).toBe("A idade inicial não pode ser maior que a final.");

    const onSubmit = vi.fn();
    wrap(<Form onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Nome da Categoria/), { target: { value: "garrote" } });
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("a"), { target: { value: "13" } });
    fireEvent.submit(screen.getByTestId("b1-form-categoria-manejo"));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(notifyWarning).toHaveBeenCalledWith("Atenção", MENSAGEM_FAIXA_IDADE_INVALIDA);
    expect(screen.getByRole("alert").textContent).toContain(MENSAGEM_FAIXA_IDADE_INVALIDA);
    expect(screen.getByLabelText("a").getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(screen.getByLabelText("a"), { target: { value: "36" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.submit(screen.getByTestId("b1-form-categoria-manejo"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      nome: "GARROTE",
      idade_minima_meses: "25",
      idade_maxima_meses: "36",
    });

    // Pontas opcionais: só uma preenchida, ou iguais, é válido.
    expect(faixaIdadeValida({ idade_minima_meses: "12", idade_maxima_meses: "" })).toBe(true);
    expect(faixaIdadeValida({ idade_minima_meses: "", idade_maxima_meses: "12" })).toBe(true);
    expect(faixaIdadeValida({ idade_minima_meses: "12", idade_maxima_meses: "12" })).toBe(true);
    expect(faixaIdadeValida({ idade_minima_meses: "13", idade_maxima_meses: "12" })).toBe(false);
  });

  it("registro legado aberto para edição não exibe nem cria campo para as chaves removidas", async () => {
    const { default: Form, buildFormInitialFromRecord } = await import(
      "@/components/categorias-manejo/FormularioCategoriaManejo"
    );
    const onSubmit = vi.fn();
    wrap(
      <Form
        initialData={buildFormInitialFromRecord({ id: "cm1", nome: "BOI", idade_minima_meses: 37, ...legado() })}
        isEditing
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    const form = screen.getByTestId("b1-form-categoria-manejo");
    expect(form.querySelectorAll('input[type="number"]')).toHaveLength(2);
    expect(form.textContent).not.toMatch(/NELORE|Raça|GMD/i);
    fireEvent.submit(form);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});

describe("(b) porta nativa descarta chaves legadas do corpo", () => {
  it("POST e PATCH levam só os campos graváveis", async () => {
    const { categoriaManejoPort, corpoDeEnvio, CAMPOS_GRAVAVEIS } = await import(
      "@/apis/categorias-manejo/categoriaManejoNativePort.js"
    );
    for (const chave of CHAVES_REMOVIDAS) expect(CAMPOS_GRAVAVEIS).not.toContain(chave);

    const dados = {
      empresa_id: "emp-1",
      nome: "BOI",
      sigla: "B",
      especie: "Bovinos",
      sexo: "Macho",
      idade_minima_meses: 37,
      idade_maxima_meses: null,
      catalogo_categoria_visual_id: "cv-bez",
      ativo: true,
      ...legado(),
      chave_desconhecida: "x",
    };
    const esperado = {
      empresa_id: "emp-1",
      nome: "BOI",
      sigla: "B",
      especie: "Bovinos",
      sexo: "Macho",
      idade_minima_meses: 37,
      idade_maxima_meses: null,
      catalogo_categoria_visual_id: "cv-bez",
      ativo: true,
    };
    expect(corpoDeEnvio(dados)).toEqual(esperado);
    expect(corpoDeEnvio(undefined)).toEqual({});

    await categoriaManejoPort.create(dados);
    await categoriaManejoPort.update("cm 1", { nome: "VACA", ...legado() });

    expect(nativeRequest).toHaveBeenCalledTimes(2);
    const [urlPost, optsPost] = nativeRequest.mock.calls[0];
    expect(urlPost).toBe("/categorias-manejo");
    expect(optsPost.method).toBe("POST");
    expect(optsPost.body).toEqual(esperado);

    const [urlPatch, optsPatch] = nativeRequest.mock.calls[1];
    expect(urlPatch).toBe("/categorias-manejo/cm%201");
    expect(optsPatch.method).toBe("PATCH");
    expect(optsPatch.body).toEqual({ nome: "VACA" });

    for (const [, opts] of nativeRequest.mock.calls) {
      for (const chave of CHAVES_REMOVIDAS) expect(opts.body).not.toHaveProperty(chave);
    }
  });
});

describe("(c) preferências de coluna salvas com ids removidos", () => {
  const STORAGE_KEY = "colunas_largura_categorias_manejo";

  it("formato unificado: ids raca/categoria_oficial/gmd_* são descartados sem quebrar", async () => {
    const { loadCadastroBase1ColumnPrefs, CADASTRO_B1_COLUMN_PREFS_VERSION } = await import(
      "@/lib/cadastroBase1ColumnPrefs"
    );
    const { CATEGORIAS_MANEJO_COLUNAS } = await import("@/components/categorias-manejo/TabelaCategoriasManejo");
    const ids = CATEGORIAS_MANEJO_COLUNAS.map((c) => c.id);

    localStorage.setItem(
      `${STORAGE_KEY}_prefs`,
      JSON.stringify({
        version: CADASTRO_B1_COLUMN_PREFS_VERSION,
        columns: {
          widths: { raca: 200, categoria_oficial: 220, gmd_janeiro: 90, nome: 250 },
          order: ["gmd_janeiro", "raca", "sigla", "categoria_oficial", "nome"],
          visible: ["raca", "categoria_oficial", "gmd_janeiro", "gmd_dezembro", "nome", "sigla"],
          frozen: 5,
          autoFit: ["raca", "gmd_marco", "nome"],
        },
      }),
    );

    const prefs = loadCadastroBase1ColumnPrefs(STORAGE_KEY, CATEGORIAS_MANEJO_COLUNAS);
    expect(prefs.colunasVisiveis).toEqual(["nome", "sigla"]);
    expect(prefs.colunasOrdem).toEqual(["sigla", "nome", ...ids.filter((id) => id !== "sigla" && id !== "nome")]);
    expect(Object.keys(prefs.columnWidths).sort()).toEqual([...ids].sort());
    expect(prefs.columnWidths.nome).toBe(250);
    expect(prefs.frozenCount).toBe(2);
    expect([...prefs.autoFitKeys]).toEqual(["nome"]);
    expect(JSON.stringify({ ...prefs, autoFitKeys: [...prefs.autoFitKeys] })).not.toMatch(REMOVIDO_RE);
  });

  it("só ids removidos salvos (formato legado) → volta às colunas padrão", async () => {
    const { loadCadastroBase1ColumnPrefs } = await import("@/lib/cadastroBase1ColumnPrefs");
    const { CATEGORIAS_MANEJO_COLUNAS } = await import("@/components/categorias-manejo/TabelaCategoriasManejo");
    const ids = CATEGORIAS_MANEJO_COLUNAS.map((c) => c.id);
    const padrao = CATEGORIAS_MANEJO_COLUNAS.filter((c) => c.default !== false).map((c) => c.id);

    localStorage.setItem(`${STORAGE_KEY}_visiveis`, JSON.stringify(["raca", "categoria_oficial", "gmd_julho"]));
    localStorage.setItem(`${STORAGE_KEY}_ordem`, JSON.stringify(["gmd_julho", "raca"]));
    localStorage.setItem(`${STORAGE_KEY}_largura`, JSON.stringify({ raca: 300, gmd_julho: 80 }));
    localStorage.setItem(`${STORAGE_KEY}_autofit`, JSON.stringify(["categoria_oficial"]));
    localStorage.setItem(`${STORAGE_KEY}_congeladas`, "3");

    const prefs = loadCadastroBase1ColumnPrefs(STORAGE_KEY, CATEGORIAS_MANEJO_COLUNAS);
    expect(prefs.colunasVisiveis).toEqual(padrao);
    expect(prefs.colunasOrdem).toEqual(ids);
    expect(prefs.columnWidths).toEqual(Object.fromEntries(CATEGORIAS_MANEJO_COLUNAS.map((c) => [c.id, c.width])));
    expect([...prefs.autoFitKeys]).toEqual([]);
    expect(prefs.frozenCount).toBe(3);
  });
});

describe("(d) colunas exportáveis (CSV) de Categorias de Manejo", () => {
  it("nenhuma coluna nem valor exportado vem de campo removido", async () => {
    const { CATEGORIAS_MANEJO_COLUNAS, getCategoriaManejoFieldValue } = await import(
      "@/components/categorias-manejo/TabelaCategoriasManejo"
    );
    const { exportCadastroCsv } = await import("@/components/cadastro/base1/cadastroExportCsv");

    expect(CATEGORIAS_MANEJO_COLUNAS.map((c) => c.id)).toEqual(["nome", "sigla", "sexo", "idade", "especie"]);
    for (const coluna of CATEGORIAS_MANEJO_COLUNAS) {
      expect(coluna.id).not.toMatch(REMOVIDO_RE);
      expect(coluna.label).not.toMatch(/Raça|Categoria oficial|Ganho|GMD/i);
    }
    // Pedir um campo removido ao extrator devolve vazio.
    const registro = { nome: "BOI", sigla: "B", sexo: "Macho", especie: "Bovinos", idade_minima_meses: 37, ...legado() };
    for (const chave of CHAVES_REMOVIDAS) expect(getCategoriaManejoFieldValue(registro, chave)).toBe("");

    // O CSV gerado de verdade: cabeçalho e linha só com as colunas enxutas.
    let blob = null;
    const criar = vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      blob = b;
      return "blob:csv";
    });
    const clique = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    exportCadastroCsv("categorias-manejo.csv", CATEGORIAS_MANEJO_COLUNAS, [registro], getCategoriaManejoFieldValue);
    expect(criar).toHaveBeenCalledTimes(1);
    expect(clique).toHaveBeenCalledTimes(1);
    // jsdom não implementa `Blob#text`; FileReader lê o mesmo conteúdo.
    const texto = await new Promise((resolve, reject) => {
      const leitor = new FileReader();
      leitor.onload = () => resolve(String(leitor.result));
      leitor.onerror = () => reject(leitor.error);
      leitor.readAsText(blob);
    });
    const [cabecalho, linha] = texto.replace(/^﻿/, "").split("\n");
    expect(cabecalho).toBe('"Nome";"Sigla";"Sexo";"Faixa Idade";"Espécie"');
    expect(linha).toBe('"BOI";"B";"Macho";"37 - ∞ meses";"Bovinos"');
    expect(texto).not.toMatch(/NELORE|Raça|GMD|ganho/i);
  });
});
