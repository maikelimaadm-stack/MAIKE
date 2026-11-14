/**
 * D-PROD-191 — o Gerenciamento de Ícones (Configurações) não cadastra mais ícone de Lote.
 *
 * O desenho do lote vem do código, pela chave sexo + faixa de idade da Categoria de
 * Manejo (src/assets/icones/lotes). A tela deixa de oferecer "Lote de Gado" e o bloco
 * "Categorias que formam o MISTO"; linhas antigas de "Lote" ficam no banco, sem uso, e
 * não aparecem. Ponto, Área, Linha, Prioridade Tarefa e Ícone Menu Mobile seguem iguais,
 * com os dois uploads (principal e sub ícone). Só os services são substituídos.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const icones = {
  listar: vi.fn(),
  criar: vi.fn(),
  atualizar: vi.fn(),
  desativar: vi.fn(),
};

vi.mock("@/services/configuracaoIconeService", async (importOriginal) => ({
  ...(await importOriginal()),
  listarIconesAtivos: (...a) => icones.listar(...a),
  criarIcone: (...a) => icones.criar(...a),
  atualizarIcone: (...a) => icones.atualizar(...a),
  desativarIcone: (...a) => icones.desativar(...a),
}));
vi.mock("@/services/arquivoService", () => ({ enviarArquivo: vi.fn(async () => "https://arquivos.exemplo/icone.png") }));

const PONTO = { id: "i-ponto", tipo_entidade: "Ponto", categoria: "COCHO", icone_url: "https://arquivos.exemplo/cocho.svg", ativo: true };
const AREA = { id: "i-area", tipo_entidade: "Area", categoria: "PASTO", cor_padrao: "#10b981", ativo: true };
/** Linhas antigas de Lote: continuam vindo do servidor (o banco não é tocado). */
const LOTES_ORFAOS = [
  { id: "i-lote", tipo_entidade: "Lote", categoria: "BEZERRO 0 A 12 MESES", icone_url: "https://arquivos.exemplo/bezerro.png", ativo: true },
  { id: "i-misto", tipo_entidade: "Lote", categoria: "MISTO", categorias_misto: ["BOI", "VACA"], icone_url: "https://arquivos.exemplo/misto.png", ativo: true },
];

/** @type {QueryClient} */
let qc;
const montar = async (lista) => {
  icones.listar.mockResolvedValue(lista);
  const { default: GerenciadorIcones } = await import("@/components/configuracoes/GerenciadorIcones");
  const { ICONES_QUERY_KEY } = await import("@/services/configuracaoIconeService");
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <GerenciadorIcones />
    </QueryClientProvider>,
  );
  // A lista do servidor chegou (initialData é [] até lá).
  await waitFor(() => expect(qc.getQueryData(ICONES_QUERY_KEY)).toHaveLength(lista.length));
};

/** Abre o Select (Radix) e devolve os textos das opções. */
const abrirSelect = async (trigger) => {
  await act(async () => {
    fireEvent.click(trigger);
  });
  const lista = /** @type {HTMLElement} */ (document.querySelector('[role="listbox"]'));
  return { lista, opcoes: within(lista).getAllByRole("option").map((o) => o.textContent.trim()) };
};

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  cleanup();
  Object.values(icones).forEach((f) => f.mockReset());
  icones.criar.mockResolvedValue({ id: "novo" });
});
afterEach(() => cleanup());

describe("D-PROD-191 — Gerenciamento de Ícones sem Lote", () => {
  it("a lista não tem 'Lote de Gado'; os outros tipos seguem; linha órfã de Lote vinda do servidor não aparece", async () => {
    await montar([PONTO, AREA, ...LOTES_ORFAOS]);
    expect(await screen.findByText("COCHO")).toBeInTheDocument();
    expect(screen.getByText("PASTO")).toBeInTheDocument();
    for (const secao of ["Ponto de Referência (1)", "Área/Polígono (1)", "Linha/Estrada (0)", "Prioridade de Tarefa (0)", "Ícone Menu Mobile (0)"]) {
      expect(screen.getByText(secao)).toBeInTheDocument();
    }
    expect(screen.queryByText(/Lote de Gado/)).toBeNull();
    expect(screen.queryByText("BEZERRO 0 A 12 MESES")).toBeNull();
    expect(screen.queryByText("MISTO")).toBeNull();
    expect(screen.queryByAltText("BEZERRO 0 A 12 MESES")).toBeNull();
    // Há ícone oferecido: sem o aviso geral de lista vazia.
    expect(screen.queryByText('Clique em "Novo Ícone" para começar')).toBeNull();
  });

  it("só linhas órfãs de Lote no servidor: a tela diz que não há ícone cadastrado", async () => {
    await montar(LOTES_ORFAOS);
    expect(screen.getByText('Clique em "Novo Ícone" para começar')).toBeInTheDocument();
    expect(screen.queryByText("BEZERRO 0 A 12 MESES")).toBeNull();
    expect(screen.queryByText(/Lote de Gado/)).toBeNull();
  });

  it("o formulário não oferece 'Lote de Gado' nem o bloco do MISTO; Ponto segue com o modelo de cocho e os dois uploads", async () => {
    await montar([PONTO]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Novo Ícone/ }));
    });
    const dialogo = within(screen.getByRole("dialog"));

    const tipo = await abrirSelect(dialogo.getByRole("combobox"));
    expect(tipo.opcoes).toEqual(["Ponto de Referência", "Área/Polígono", "Linha/Estrada", "Prioridade de Tarefa", "Ícone Menu Mobile"]);
    await act(async () => {
      fireEvent.click(within(tipo.lista).getByRole("option", { name: "Ponto de Referência" }));
    });

    const [, seletorCategoria] = dialogo.getAllByRole("combobox");
    const categoria = await abrirSelect(seletorCategoria);
    expect(categoria.opcoes).toContain("Cocho");
    await act(async () => {
      fireEvent.click(within(categoria.lista).getByRole("option", { name: "Cocho" }));
    });
    expect(dialogo.queryByText(/Categorias que formam o MISTO/)).toBeNull();
    expect(dialogo.getAllByRole("button", { name: "Usar modelo de cocho SVG" })).toHaveLength(2);
    expect(dialogo.getByText("Ícone Principal (Mapa)")).toBeInTheDocument();
    expect(dialogo.getByText("Sub Ícone (Informações/Detalhes)")).toBeInTheDocument();
    expect(document.querySelectorAll('[role="dialog"] input[type="file"]')).toHaveLength(2);

    await act(async () => {
      fireEvent.click(dialogo.getByRole("button", { name: "Salvar" }));
    });
    await waitFor(() => expect(icones.criar).toHaveBeenCalledTimes(1));
    const salvo = icones.criar.mock.calls[0][0];
    expect(salvo).toMatchObject({ tipo_entidade: "Ponto", categoria: "COCHO" });
    expect(salvo).not.toHaveProperty("categorias_misto");
  });

  it("o código não guarda mais Lote, MISTO nem categorias_misto", () => {
    const fonte = readFileSync("src/components/configuracoes/GerenciadorIcones.jsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(fonte).not.toMatch(/"Lote"|Lote de Gado|categorias_misto|MISTO/);
  });
});
