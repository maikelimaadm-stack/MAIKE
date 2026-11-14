/**
 * D-PROD-199 — na Mudança de Categoria, a tela mostra a categoria de manejo que
 * o lote vai receber; com mais de uma possível, pede a escolha (não adivinha). O
 * cadastro de Categoria de Manejo avisa quando outra ativa tem o mesmo sexo e a
 * mesma faixa (não bloqueia).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { categoriasManejoDuplicadas, categoriasManejoParaMudanca } from "@/domain/lotes/categoriaOficialDerivada";

const notifyWarning = vi.fn();
vi.mock("@/lib/maikeNotify", () => ({
  notifyWarning: (...a) => notifyWarning(...a),
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
  notifyInfo: vi.fn(),
}));

const categorias = { atual: [] };
vi.mock("@/services/categoriaManejoService", async (importOriginal) => ({
  ...(await importOriginal()),
  listarCategoriasManejoDaEmpresa: async () => categorias.atual,
}));

const { default: FormularioMudancaCategoria } = await import("@/components/lotes/FormularioMudancaCategoria");
const { default: FormularioCategoriaManejo } = await import("@/components/categorias-manejo/FormularioCategoriaManejo");

const CM = (id, nome, sexo, de, ate, extra = {}) => ({ id, nome, sexo, idade_minima_meses: de, idade_maxima_meses: ate, ativo: true, ...extra });
const GARROTE = CM("g", "GARROTE 13 A 24 MESES", "Macho", 13, 24);
const BOI = CM("b", "BOI 25 A 36 MESES", "Macho", 25, 36);
const BOI_CONF = CM("bc", "BOI CONFINAMENTO", "Macho", 25, 36);
const LOTE = { id: "p1", nome: "LOTE 1", categoria: "Garrote 13 a 24 meses", quantidade_cabecas: 30 };

const wrap = (ui) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

/** Escolhe `nome` no select `rotulo` (o painel pode ainda estar fechando: tenta de novo). */
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

/** Abre o formulário, adiciona uma linha, informa 10 cabeças e a categoria nova. */
const montarMudanca = async (onSubmit) => {
  wrap(<FormularioMudancaCategoria lote={[LOTE]} onSubmit={onSubmit} onCancel={() => {}} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Adicionar/i }));
  });
  fireEvent.change(screen.getByLabelText(/^Quantidade/), { target: { value: "10" } });
  await escolher(/^Nova Categoria/, "Boi 25 a 36 meses");
};

const enviar = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Confirmar Mudanças/i }));
  });
};

beforeEach(() => {
  cleanup();
  notifyWarning.mockReset();
  localStorage.setItem("empresa_selecionada_id", "emp-1");
});

describe("D-PROD-199 — funções puras", () => {
  it("candidatas da mudança: todas as ativas da oficial, por nome; inativa e outra faixa fora", () => {
    const inativa = CM("x", "BOI VELHO", "Macho", 25, 36, { ativo: false });
    const lista = categoriasManejoParaMudanca([BOI_CONF, GARROTE, inativa, BOI], "Boi 25 a 36 meses");
    expect(lista.map((c) => c.id)).toEqual(["b", "bc"]);
    expect(categoriasManejoParaMudanca([GARROTE], "Boi 25 a 36 meses")).toEqual([]);
    expect(categoriasManejoParaMudanca(null, "Boi 25 a 36 meses")).toEqual([]);
  });

  it("duplicadas: mesmo sexo e mesma faixa, outra ativa; 0–8 × 9–12 não conta; o próprio registro não conta", () => {
    const mamando = CM("m", "BEZERRO MAMANDO", "Macho", 0, 8);
    const teste = CM("t", "TESTE", "Macho", 0, 8);
    const desmama = CM("d", "BEZERRO 09 A 12 MESES", "Macho", 9, 12);
    const femea = CM("f", "BEZERRA MAMANDO", "Fêmea", 0, 8);
    const todas = [mamando, teste, desmama, femea];
    expect(categoriasManejoDuplicadas(todas, mamando).map((c) => c.id)).toEqual(["t"]);
    expect(categoriasManejoDuplicadas(todas, desmama)).toEqual([]);
    expect(categoriasManejoDuplicadas(todas, { sexo: "Macho", idade_minima_meses: 0, idade_maxima_meses: 8 }).map((c) => c.id)).toEqual(["m", "t"]);
    expect(categoriasManejoDuplicadas([mamando, { ...teste, ativo: false }], mamando)).toEqual([]);
    expect(categoriasManejoDuplicadas(todas, { sexo: "", idade_minima_meses: 0, idade_maxima_meses: 8 })).toEqual([]);
    // "Maior que 36 meses" (sem teto) também compara.
    const vacaLeiteira = CM("v", "VACA LEITERA", "Fêmea", 37, null);
    const errada = CM("e", "GARROTE 13 A 24 MESES", "Fêmea", 37, null);
    expect(categoriasManejoDuplicadas([vacaLeiteira, errada], vacaLeiteira).map((c) => c.id)).toEqual(["e"]);
  });
});

describe("D-PROD-199 — Mudança de Categoria", () => {
  it("uma categoria de manejo possível: mostra qual é e envia o id dela", async () => {
    categorias.atual = [GARROTE, BOI];
    const onSubmit = vi.fn(async () => {});
    await montarMudanca(onSubmit);
    expect(await screen.findByTestId("mudanca-manejo-unica")).toHaveTextContent("BOI 25 A 36 MESES");
    expect(screen.queryByTestId("mudanca-manejo-escolha")).toBeNull();
    await enviar();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [m] = onSubmit.mock.calls[0][0].mudancas;
    expect(m).toMatchObject({ categoria_nova: "Boi 25 a 36 meses", quantidade: 10, categoria_manejo_id_novo: "b", categoria_manejo_nome_novo: "BOI 25 A 36 MESES", sexo_novo: "Macho" });
  });

  it("duas possíveis: pede a escolha, não envia sem ela e envia a escolhida", async () => {
    categorias.atual = [GARROTE, BOI, BOI_CONF];
    const onSubmit = vi.fn(async () => {});
    await montarMudanca(onSubmit);
    await screen.findByTestId("mudanca-manejo-escolha");
    expect(screen.queryByTestId("mudanca-manejo-unica")).toBeNull();
    await enviar();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(notifyWarning).toHaveBeenCalledWith("Atenção", expect.stringMatching(/Escolha a categoria de manejo/));

    await escolher(/^Categoria de Manejo/, "BOI CONFINAMENTO");
    await enviar();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].mudancas[0]).toMatchObject({ categoria_manejo_id_novo: "bc", categoria_manejo_nome_novo: "BOI CONFINAMENTO" });
  });

  it("nenhuma possível: avisa que o lote fica sem curva e envia sem categoria de manejo", async () => {
    categorias.atual = [GARROTE];
    const onSubmit = vi.fn(async () => {});
    await montarMudanca(onSubmit);
    expect(await screen.findByTestId("mudanca-manejo-nenhuma")).toHaveTextContent(/sem curva de ganho/);
    await enviar();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].mudancas[0].categoria_manejo_id_novo).toBeUndefined();
  });
});

describe("D-PROD-199 — aviso de duplicada no cadastro", () => {
  const base = { nome: "TESTE", sigla: "", especie: "Bovinos", sexo: "Macho", idade_minima_meses: 0, idade_maxima_meses: 8, curva_ganho_id: "cg-1", ativo: true };
  const CURVAS = [{ id: "cg-1", nome: "CURVA PADRÃO", ativo: true }];

  it("mostra a categoria repetida sob a faixa de idade (sem bloquear) e some no modo leitura", () => {
    const mamando = CM("m", "BEZERRO MAMANDO", "Macho", 0, 8);
    const { unmount } = wrap(
      <FormularioCategoriaManejo initialData={{ ...base, id: "t" }} isEditing onSubmit={() => {}} onCancel={() => {}} curvasGanho={CURVAS} categoriasDaFazenda={[mamando, CM("t", "TESTE", "Macho", 0, 8)]} />,
    );
    expect(screen.getByText(/Já existe BEZERRO MAMANDO com o mesmo sexo e faixa/)).toBeInTheDocument();
    unmount();
    wrap(
      <FormularioCategoriaManejo initialData={{ ...base, id: "t" }} readOnly onSubmit={() => {}} onCancel={() => {}} curvasGanho={CURVAS} categoriasDaFazenda={[mamando]} />,
    );
    expect(screen.queryByText(/Já existe/)).toBeNull();
  });

  it("sem repetida (outra faixa da mesma oficial) não avisa", () => {
    wrap(
      <FormularioCategoriaManejo initialData={base} isEditing onSubmit={() => {}} onCancel={() => {}} curvasGanho={CURVAS} categoriasDaFazenda={[CM("d", "BEZERRO 09 A 12 MESES", "Macho", 9, 12)]} />,
    );
    expect(screen.queryByText(/Já existe/)).toBeNull();
  });
});
