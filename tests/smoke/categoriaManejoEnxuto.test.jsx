/**
 * MAIKE-CATEGORIA-MANEJO-ENXUGAR (Fatia C, D-PROD-185) — cadastro enxuto.
 *
 * CategoriaManejo ficou só com nome, sigla, espécie, sexo, faixa de idade e o
 * vínculo com o ícone oficial. Nome, Sexo e Faixa de idade são obrigatórios; a
 * faixa é UM select com as cinco faixas fixas (decisão do proprietário,
 * 2026-11-13) — sem campos livres "De"/"a".
 * Raça, categoria oficial (texto), ganho de peso anual e os doze GMDs saíram
 * do contrato. Este arquivo prova, no front:
 *  (a) o formulário mostra só esses campos; o select de faixa tem as cinco
 *      opções, é obrigatório e preserva o par legado quando não é tocado;
 *  (b) a porta nativa não envia chaves legadas no POST/PATCH;
 *  (c) preferências de coluna salvas com ids removidos não quebram a grade;
 *  (d) as colunas exportáveis (CSV) não trazem nenhum campo removido.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
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

const FAIXAS_ROTULOS = ["0 a 8 meses", "9 a 12 meses", "13 a 24 meses", "25 a 36 meses", "Maior que 36 meses"];

/** Abre o select (painel de desktop) e devolve os rótulos das opções listadas. */
const abrirSelect = async (rotulo) => {
  const campo = screen.getByLabelText(rotulo);
  await act(async () => {
    fireEvent.click(campo);
  });
  return campo;
};
/** O campo está marcado como inválido (borda + mensagem "Obrigatório")? */
const invalido = (rotulo) => screen.getByLabelText(rotulo).closest(".mg-field").classList.contains("is-invalid");
/**
 * Escolhe `nome` no select `rotulo`. O painel (Popover) do select anterior pode
 * ainda estar fechando sob carga: se a opção não aparecer, clica no campo de novo.
 */
const escolher = async (rotulo, nome) => {
  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    if (!screen.queryByRole("option", { name: nome })) {
      await act(async () => {
        fireEvent.click(screen.getByLabelText(rotulo));
      });
    }
    const opcao = await screen.findByRole("option", { name: nome }, { timeout: 400 }).catch(() => null);
    if (opcao) {
      await act(async () => {
        fireEvent.click(opcao);
      });
      return;
    }
  }
  throw new Error(`opção ${nome} não apareceu em ${rotulo}`);
};

describe("(a) formulário enxuto de Categoria de Manejo", () => {
  it("mostra só Nome, Sigla, Espécie, Sexo, Ícone oficial e UM select de faixa de idade (sem número livre)", async () => {
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
      "Faixa de idade",
    ]);
    // Obrigatórios marcados: Nome, Sexo e Faixa de idade.
    const obrigatorios = [...form.querySelectorAll("label.mg-field__label")]
      .filter((l) => l.querySelector(".req"))
      .map((l) => l.textContent.replace(/\s*\*\s*$/, "").trim());
    expect(obrigatorios).toEqual(["Nome da Categoria", "Sexo", "Faixa de idade"]);
    expect(await screen.findByLabelText("Ícone oficial (catálogo MAK Gestão)")).toBeTruthy();

    expect(form.querySelectorAll('input[type="number"]')).toHaveLength(0);
    expect(screen.queryByLabelText("De")).toBeNull();
    expect(screen.queryByLabelText("a")).toBeNull();
    expect(form.textContent).not.toMatch(/Raça|Categoria oficial|Ganho|GMD|Janeiro|Dezembro/i);
    for (const el of form.querySelectorAll("[name]")) {
      expect(el.getAttribute("name")).not.toMatch(REMOVIDO_RE);
    }
  });

  it("o select de faixa tem exatamente as cinco faixas fixas (a lista do domínio)", async () => {
    const { default: Form } = await import("@/components/categorias-manejo/FormularioCategoriaManejo");
    const { FAIXAS_IDADE_CATEGORIA_MANEJO } = await import("@/domain/lotes/categoriaOficialDerivada");
    expect(FAIXAS_IDADE_CATEGORIA_MANEJO.map((f) => f.rotulo)).toEqual(FAIXAS_ROTULOS);
    wrap(<Form onSubmit={vi.fn()} onCancel={() => {}} />);
    await abrirSelect(/^Faixa de idade/);
    const opcoes = await screen.findAllByRole("option");
    expect(opcoes.map((o) => o.textContent.trim())).toEqual(FAIXAS_ROTULOS);
    expect(opcoes.every((o) => !o.disabled)).toBe(true);
  });

  it("Nome, Sexo e Faixa de idade obrigatórios: sem eles não envia; escolhendo, envia o par da faixa", async () => {
    const { default: Form } = await import("@/components/categorias-manejo/FormularioCategoriaManejo");
    const onSubmit = vi.fn();
    wrap(<Form onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.submit(screen.getByTestId("b1-form-categoria-manejo"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(notifyWarning).toHaveBeenCalledWith("Atenção", "Preencha os campos obrigatórios.");
    expect(screen.getAllByRole("alert")).toHaveLength(3);
    expect(invalido(/^Faixa de idade/)).toBe(true);
    expect(invalido(/^Sexo/)).toBe(true);
    expect(invalido(/Nome da Categoria/)).toBe(true);

    fireEvent.change(screen.getByLabelText(/Nome da Categoria/), { target: { value: "boi" } });
    await escolher(/^Sexo/, "Macho");
    fireEvent.submit(screen.getByTestId("b1-form-categoria-manejo"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(invalido(/^Faixa de idade/)).toBe(true);
    expect(invalido(/^Sexo/)).toBe(false);

    await escolher(/^Faixa de idade/, "25 a 36 meses");
    expect(invalido(/^Faixa de idade/)).toBe(false);
    fireEvent.submit(screen.getByTestId("b1-form-categoria-manejo"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      nome: "BOI",
      sexo: "Macho",
      idade_minima_meses: 25,
      idade_maxima_meses: 36,
      faixa_idade_alterada: true,
    });

    // "Maior que 36 meses" grava (37, null).
    await escolher(/^Faixa de idade/, "Maior que 36 meses");
    fireEvent.submit(screen.getByTestId("b1-form-categoria-manejo"));
    expect(onSubmit.mock.calls[1][0]).toMatchObject({ idade_minima_meses: 37, idade_maxima_meses: null });
  });

  it("registro com faixa da lista: o select mostra a faixa; salvar sem mexer NÃO reenvia as idades", async () => {
    const { default: Form, buildFormInitialFromRecord } = await import(
      "@/components/categorias-manejo/FormularioCategoriaManejo"
    );
    const { normalizarCategoriaManejo } = await import("@/services/categoriaManejoService");
    const onSubmit = vi.fn();
    wrap(
      <Form
        initialData={buildFormInitialFromRecord({ id: "cm1", nome: "BEZERRO", sexo: "MACHO", idade_minima_meses: 9, idade_maxima_meses: 12 })}
        isEditing
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByLabelText(/^Faixa de idade/).textContent).toBe("9 a 12 meses");
    // 'MACHO' gravado aparece como a opção "Macho".
    expect(screen.getByLabelText(/^Sexo/).textContent).toBe("Macho");
    fireEvent.submit(screen.getByTestId("b1-form-categoria-manejo"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = normalizarCategoriaManejo(onSubmit.mock.calls[0][0], { empresaId: "emp-1", edicao: true });
    expect(payload).not.toHaveProperty("idade_minima_meses");
    expect(payload).not.toHaveProperty("idade_maxima_meses");
    expect(payload.sexo).toBe("Macho");
  });

  it("par legado fora da lista vira opção extra DESABILITADA; sem mexer, o par fica intocado; trocar envia a faixa nova", async () => {
    const { default: Form, buildFormInitialFromRecord } = await import(
      "@/components/categorias-manejo/FormularioCategoriaManejo"
    );
    const { normalizarCategoriaManejo } = await import("@/services/categoriaManejoService");
    const onSubmit = vi.fn();
    wrap(
      <Form
        initialData={buildFormInitialFromRecord({ id: "cm1", nome: "BOI", sexo: "Macho", idade_minima_meses: 10, idade_maxima_meses: 20 })}
        isEditing
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    const campo = screen.getByLabelText(/^Faixa de idade/);
    expect(campo.textContent).toBe("De 10 a 20 meses (fora da lista)");
    await abrirSelect(/^Faixa de idade/);
    const opcoes = await screen.findAllByRole("option");
    expect(opcoes.map((o) => o.textContent.trim())).toEqual([...FAIXAS_ROTULOS, "De 10 a 20 meses (fora da lista)"]);
    expect(opcoes.at(-1).disabled).toBe(true);
    expect(opcoes.slice(0, 5).every((o) => !o.disabled)).toBe(true);
    // Fechar sem escolher (novo clique no campo) e salvar: o par legado não vai no corpo.
    await act(async () => {
      fireEvent.click(campo);
    });
    fireEvent.submit(screen.getByTestId("b1-form-categoria-manejo"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const intocado = normalizarCategoriaManejo(onSubmit.mock.calls[0][0], { empresaId: "emp-1", edicao: true });
    expect(intocado).not.toHaveProperty("idade_minima_meses");
    expect(intocado).not.toHaveProperty("idade_maxima_meses");

    await escolher(/^Faixa de idade/, "13 a 24 meses");
    expect(screen.getByLabelText(/^Faixa de idade/).textContent).toBe("13 a 24 meses");
    fireEvent.submit(screen.getByTestId("b1-form-categoria-manejo"));
    const trocado = normalizarCategoriaManejo(onSubmit.mock.calls[1][0], { empresaId: "emp-1", edicao: true });
    expect(trocado).toMatchObject({ idade_minima_meses: 13, idade_maxima_meses: 24 });
  });

  it("par legado com um lado só também é preservado e rotulado", async () => {
    const { valorFaixaIdade, rotuloFaixaForaDaLista, FAIXA_FORA_DA_LISTA } = await import(
      "@/components/categorias-manejo/FormularioCategoriaManejo"
    );
    expect(valorFaixaIdade({ idade_minima_meses: 12, idade_maxima_meses: "" })).toBe(FAIXA_FORA_DA_LISTA);
    expect(rotuloFaixaForaDaLista({ idade_minima_meses: 12, idade_maxima_meses: "" })).toBe("A partir de 12 meses (fora da lista)");
    expect(rotuloFaixaForaDaLista({ idade_minima_meses: "", idade_maxima_meses: 12 })).toBe("Até 12 meses (fora da lista)");
    expect(valorFaixaIdade({ idade_minima_meses: 37, idade_maxima_meses: "" })).toBe("37-");
    expect(valorFaixaIdade({ idade_minima_meses: "", idade_maxima_meses: "" })).toBe("");
  });

  it("registro legado aberto para edição não exibe nem cria campo para as chaves removidas", async () => {
    const { default: Form, buildFormInitialFromRecord } = await import(
      "@/components/categorias-manejo/FormularioCategoriaManejo"
    );
    const onSubmit = vi.fn();
    wrap(
      <Form
        initialData={buildFormInitialFromRecord({ id: "cm1", nome: "BOI", sexo: "Macho", idade_minima_meses: 37, ...legado() })}
        isEditing
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    const form = screen.getByTestId("b1-form-categoria-manejo");
    expect(form.querySelectorAll('input[type="number"]')).toHaveLength(0);
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
    expect(linha).toBe('"BOI";"B";"Macho";"Maior que 36 meses";"Bovinos"');
    expect(texto).not.toMatch(/NELORE|Raça|GMD|ganho/i);
  });

  it("coluna Faixa Idade (grade e CSV): rótulo da faixa; par fora da lista → \"X a Y meses\"; sem idade → vazio", async () => {
    const { getCategoriaManejoFieldValue } = await import("@/components/categorias-manejo/TabelaCategoriasManejo");
    const v = (idade_minima_meses, idade_maxima_meses) =>
      getCategoriaManejoFieldValue({ idade_minima_meses, idade_maxima_meses }, "idade");
    expect(v(0, 8)).toBe("0 a 8 meses");
    expect(v(9, 12)).toBe("9 a 12 meses");
    expect(v(13, 24)).toBe("13 a 24 meses");
    expect(v(25, 36)).toBe("25 a 36 meses");
    expect(v(37, null)).toBe("Maior que 36 meses");
    expect(v(10, 20)).toBe("10 a 20 meses");
    expect(v(24, 12)).toBe("24 a 12 meses");
    expect(v(0, 12)).toBe("0 a 12 meses");
    expect(v(12, null)).toBe("A partir de 12 meses");
    expect(v(null, 12)).toBe("Até 12 meses");
    expect(v(null, null)).toBe("");
    expect(v(undefined, undefined)).toBe("");
  });
});
