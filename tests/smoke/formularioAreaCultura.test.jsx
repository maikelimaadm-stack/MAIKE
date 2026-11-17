/**
 * D-PROD-216 — a Área ligada à Cultura no formulário:
 *  - com culturas cadastradas na fazenda, o campo vira "Cultura" e lista "001 · NOME" (as ativas, por código);
 *    escolher manda `cultura_id` (o servidor deriva `tipo_pastagem` do nome);
 *  - área antiga, sem cultura: a dica mostra o texto de antes e salvar sem escolher continua funcionando;
 *  - sem culturas (sem permissão, erro ou lista vazia): o formulário segue com a lista fixa de antes e não manda
 *    `cultura_id` (a cultura gravada não é tocada);
 *  - regras puras: rótulo, ordem por código e a cultura inativa da própria área na lista.
 */
import React from "react";
import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { culturasParaArea, rotuloCultura, textoDaCulturaDaArea } from "@/domain/areas/culturaDaArea";

vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
const svc = {
  criarArea: vi.fn(async (d) => ({ id: "nova", ...d })),
  atualizarArea: vi.fn(async (id, d) => ({ id, ...d })),
  listarCulturas: vi.fn(),
};
vi.mock("@/services/mapaService", () => ({
  listarSetoresAtivos: async () => [{ id: "s1", nome: "NORTE", empresa_id: "emp-1", ativo: true }],
  criarArea: (...a) => svc.criarArea(...a),
  atualizarArea: (...a) => svc.atualizarArea(...a),
}));
vi.mock("@/services/culturaCadastroService", () => ({ listarCulturas: (...a) => svc.listarCulturas(...a) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const MARANDU = { id: "c1", codigo: "001", nome: "BRACHIARIA BRIZANTHA CV. MARANDU", tipo: "PASTAGEM", ativo: true };
const MOMBACA = { id: "c7", codigo: "007", nome: "PANICUM CV. MOMBAÇA", tipo: "PASTAGEM", ativo: true };
const INATIVA = { id: "c9", codigo: "009", nome: "PANICUM CV. ZURI", tipo: "PASTAGEM", ativo: false };

const QUADRADO = [
  { lat: -15.6, lng: -56.1 },
  { lat: -15.6, lng: -56.091 },
  { lat: -15.609, lng: -56.091 },
  { lat: -15.609, lng: -56.1 },
];

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  svc.criarArea.mockClear();
  svc.atualizarArea.mockClear();
  svc.listarCulturas.mockReset();
});
afterEach(() => cleanup());

const escolher = async (rotulo, opcao) => {
  const campo = screen.getByText(rotulo, { selector: "label" }).parentElement;
  await act(async () => {
    fireEvent.click(within(/** @type {HTMLElement} */ (campo)).getByRole("combobox"));
  });
  await act(async () => {
    fireEvent.click(within(/** @type {HTMLElement} */ (document.querySelector('[role="listbox"]'))).getByRole("option", { name: opcao }));
  });
};

const montar = async (props) => {
  const { default: FormularioArea } = await import("@/components/mapa/FormularioArea");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <FormularioArea coordenadas={QUADRADO} onSave={() => {}} onCancel={() => {}} {...props} />
    </QueryClientProvider>
  );
  await waitFor(() => expect(screen.getByText("Setor", { selector: "label" })).toBeInTheDocument());
  await act(async () => {});
};

describe("D-PROD-216 — validação e lote com a área ligada", () => {
  it("pendenciasDaArea aceita o nome da cultura do cadastro quando há cultura_id; sem ela, a lista fixa vale", async () => {
    const { pendenciasDaArea } = await import("@/domain/areas/regrasCadastroArea");
    const base = { nome: "P", setor_id: "s1", tipo_cultura: "Pastagem", area_pastejada: 1, total_ha: 2 };
    expect(pendenciasDaArea({ ...base, tipo_pastagem: MARANDU.nome, cultura_id: "c1" })).toEqual([]);
    expect(pendenciasDaArea({ ...base, tipo_pastagem: MARANDU.nome }).map((p) => p.mensagem)).toEqual(["Tipo de cultura desconhecido."]);
  });

  it("lote: trocar o 'tipo de cultura' ignora a área ligada; trocar o uso não tropeça no nome da cultura", async () => {
    const { planejarLoteUsoCultura } = await import("@/domain/areas/loteUsoCulturaAreas");
    const areas = [
      { id: "a1", nome: "LIGADA", tipo_cultura: "Pastagem", tipo_pastagem: MARANDU.nome, cultura_id: "c1" },
      { id: "a2", nome: "SOLTA", tipo_cultura: "Pastagem", tipo_pastagem: "Brachiaria", cultura_id: null },
    ];
    const cultura = planejarLoteUsoCultura({ ids: ["a1", "a2"], areas, tipo: "cultura", valor: "Mombaça" });
    expect(cultura.aplicar.map((a) => a.id)).toEqual(["a2"]);
    expect(cultura.ignoradas.map((i) => i.id)).toEqual(["a1"]);
    const uso = planejarLoteUsoCultura({ ids: ["a1", "a2"], areas, tipo: "uso", valor: "Agricultura" });
    expect(uso.aplicar.map((a) => a.id)).toEqual(["a1", "a2"]);
  });
});

describe("D-PROD-216 — regras puras da cultura da área", () => {
  it("rótulo '001 · NOME', ordem por código, inativa só quando é a da área; texto da área cai para o antigo", () => {
    expect(rotuloCultura(MARANDU)).toBe("001 · BRACHIARIA BRIZANTHA CV. MARANDU");
    expect(rotuloCultura({ id: "x", nome: "SEM CÓDIGO" })).toBe("SEM CÓDIGO");
    expect(culturasParaArea([MOMBACA, INATIVA, MARANDU], null).map((c) => c.codigo)).toEqual(["001", "007"]);
    expect(culturasParaArea([MOMBACA, INATIVA, MARANDU], "c9").map((c) => c.codigo)).toEqual(["001", "007", "009"]);
    expect(culturasParaArea(null, null)).toEqual([]);
    expect(textoDaCulturaDaArea({ cultura: MARANDU, tipo_pastagem: "X" })).toBe("001 · BRACHIARIA BRIZANTHA CV. MARANDU");
    expect(textoDaCulturaDaArea({ cultura: null, tipo_pastagem: "Brachiaria" })).toBe("Brachiaria");
  });
});

describe("D-PROD-216 — FormularioArea com o cadastro de Culturas", () => {
  it("criação: o campo 'Cultura' lista as ativas por código e manda cultura_id", async () => {
    svc.listarCulturas.mockResolvedValue([MOMBACA, INATIVA, MARANDU]);
    await montar();
    await waitFor(() => expect(screen.getByText("Cultura", { selector: "label" })).toBeInTheDocument());
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "50" } });
    fireEvent.change(screen.getAllByRole("textbox")[2], { target: { value: "Pasto 1" } });
    await escolher("Setor", "NORTE");
    await act(async () => {
      fireEvent.click(within(/** @type {HTMLElement} */ (screen.getByText("Cultura", { selector: "label" }).parentElement)).getByRole("combobox"));
    });
    const opcoes = within(/** @type {HTMLElement} */ (document.querySelector('[role="listbox"]'))).getAllByRole("option").map((o) => o.textContent);
    expect(opcoes.filter(Boolean)).toEqual(["001 · BRACHIARIA BRIZANTHA CV. MARANDU", "007 · PANICUM CV. MOMBAÇA"]);
    await act(async () => {
      fireEvent.click(within(/** @type {HTMLElement} */ (document.querySelector('[role="listbox"]'))).getByRole("option", { name: "001 · BRACHIARIA BRIZANTHA CV. MARANDU" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    });
    await waitFor(() => expect(svc.criarArea).toHaveBeenCalledTimes(1));
    expect(svc.criarArea.mock.calls[0][0]).toMatchObject({ cultura_id: "c1", tipo_cultura: "Pastagem", tipo_pastagem: "BRACHIARIA BRIZANTHA CV. MARANDU" });
  });

  it("área antiga (sem cultura): dica com o texto de antes; salvar sem escolher mantém o texto e manda cultura_id nulo", async () => {
    svc.listarCulturas.mockResolvedValue([MARANDU, MOMBACA]);
    const item = { id: "a1", nome: "PASTO VELHO", setor_id: "s1", tamanho_hectares: 10, area_pastejada: 10, tipo_cultura: "Pastagem", tipo_pastagem: "Brachiaria", cultura_id: null, cultura: null, coordenadas: { coords: QUADRADO } };
    await montar({ item });
    await waitFor(() => expect(screen.getByText(/Cultura anterior: BRACHIARIA/)).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    });
    await waitFor(() => expect(svc.atualizarArea).toHaveBeenCalledTimes(1));
    expect(svc.atualizarArea.mock.calls[0][1]).toMatchObject({ tipo_pastagem: "Brachiaria", cultura_id: null });
  });

  it("área ligada a uma cultura que foi inativada: continua na lista e no rótulo do campo", async () => {
    svc.listarCulturas.mockResolvedValue([MARANDU, INATIVA]);
    const item = { id: "a2", nome: "PASTO ZURI", setor_id: "s1", tamanho_hectares: 10, area_pastejada: 10, tipo_cultura: "Pastagem", tipo_pastagem: INATIVA.nome, cultura_id: "c9", cultura: INATIVA, coordenadas: { coords: QUADRADO } };
    await montar({ item });
    await waitFor(() => expect(screen.getByText("Cultura", { selector: "label" })).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    });
    await waitFor(() => expect(svc.atualizarArea).toHaveBeenCalledTimes(1));
    expect(svc.atualizarArea.mock.calls[0][1]).toMatchObject({ cultura_id: "c9" });
  });

  it("área ligada, sem a lista do cadastro (sem permissão): o campo fica travado com o nome e cultura_id não vai no corpo", async () => {
    svc.listarCulturas.mockRejectedValue(Object.assign(new Error("403"), { status: 403 }));
    const item = { id: "a3", nome: "PASTO LIGADO", setor_id: "s1", tamanho_hectares: 10, area_pastejada: 10, tipo_cultura: "Pastagem", tipo_pastagem: MARANDU.nome, cultura_id: "c1", cultura: MARANDU, coordenadas: { coords: QUADRADO } };
    await montar({ item });
    await waitFor(() => expect(screen.getByLabelText("Cultura")).toHaveValue("001 · BRACHIARIA BRIZANTHA CV. MARANDU"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    });
    await waitFor(() => expect(svc.atualizarArea).toHaveBeenCalledTimes(1));
    expect(svc.atualizarArea.mock.calls[0][1]).not.toHaveProperty("cultura_id");
  });

  it("sem culturas (erro ou sem permissão): a lista fixa de antes, e cultura_id não vai no corpo", async () => {
    svc.listarCulturas.mockRejectedValue(Object.assign(new Error("403"), { status: 403 }));
    await montar();
    await waitFor(() => expect(screen.getByText("Tipo de cultura", { selector: "label" })).toBeInTheDocument());
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "50" } });
    fireEvent.change(screen.getAllByRole("textbox")[2], { target: { value: "Pasto 2" } });
    await escolher("Setor", "NORTE");
    await escolher("Tipo de cultura", "Marandu");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    });
    await waitFor(() => expect(svc.criarArea).toHaveBeenCalledTimes(1));
    const enviado = svc.criarArea.mock.calls[0][0];
    expect(enviado).toMatchObject({ tipo_pastagem: "Marandu" });
    expect(enviado).not.toHaveProperty("cultura_id");
  });
});
