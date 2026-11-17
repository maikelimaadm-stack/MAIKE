/**
 * SelecaoAreasMapa ("Selecionar no mapa") — ligação das ações em lote (frente G1):
 *  - "Reatribuir Códigos" offline não grava nada e explica que precisa de conexão;
 *  - online, é UMA chamada à renumeração do servidor (atômica), nunca PATCH por área;
 *  - recusa do servidor vira mensagem clara, com o código em uso;
 *  - lote de cultura com um curral na seleção grava só no pasto e avisa o curral.
 */
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

// Mapa falso: o teste é da ligação das ações, não do desenho.
vi.mock("@/lib/maplibre/lifecycle.js", () => {
  const map = {
    on: (evento, fn) => {
      if (evento === "load") setTimeout(fn, 0);
    },
    off: () => {},
    resize: () => {},
    fitBounds: () => {},
    jumpTo: () => {},
    setFeatureState: () => {},
    queryRenderedFeatures: () => [],
    getCanvas: () => document.createElement("canvas"),
  };
  class Marker {
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
  }
  class LngLatBounds {
    extend() {
      return this;
    }
  }
  return {
    createEditorMap: () => ({ map, getCancelled: () => false, dispose: () => {} }),
    maplibregl: { Marker, LngLatBounds },
    setSourceData: () => {},
  };
});
vi.mock("@/lib/maplibre/selecaoAreasMapa.js", async (importOriginal) => ({
  ...(await importOriginal()),
  ensureSelecaoAreasLayers: () => {},
}));
// Menu e select simples (o Radix depende de pointer events que o jsdom não tem).
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

const QUADRADO = [
  [-15.6, -56.1],
  [-15.6, -56.091],
  [-15.609, -56.091],
  [-15.609, -56.1],
];
const PASTO = {
  id: "a1",
  empresa_id: "emp-1",
  nome: "PASTO 1",
  numero_area: "1",
  tipo_cultura: "Pastagem",
  tipo_pastagem: "Marandu",
  coordenadas: { coords: QUADRADO, cor: "#61aad9" },
};
const CURRAL = {
  id: "c1",
  empresa_id: "emp-1",
  nome: "CURRAL SEDE",
  numero_area: "2",
  tipo_cultura: "Infraestrutura",
  tipo_pastagem: "Curral",
  coordenadas: { coords: QUADRADO, cor: "#61aad9" },
};

const svc = vi.hoisted(() => ({ atualizarArea: vi.fn(), renumerarAreas: vi.fn() }));
vi.mock("@/services/mapaService", () => ({
  renumerarAreas: (...a) => svc.renumerarAreas(...a),
  listarAreasAtivas: async () => [{ ...PASTO }, { ...CURRAL }],
  atualizarArea: (...a) => svc.atualizarArea(...a),
}));

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  window.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
});
beforeEach(() => {
  svc.atualizarArea.mockReset();
  svc.atualizarArea.mockImplementation(async (id, dados) => ({ id, ...dados }));
  svc.renumerarAreas.mockReset();
  svc.renumerarAreas.mockImplementation(async (itens) => itens);
  toast.success.mockClear();
  toast.error.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const montar = async () => {
  const { default: SelecaoAreasMapa } = await import("@/components/mapa/SelecaoAreasMapa");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SelecaoAreasMapa onClose={() => {}} selectedIds={["a1", "c1"]} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.queryByText("Carregando mapa…")).not.toBeInTheDocument());
  await act(async () => {});
};

const abrirAcao = async (rotulo) => {
  await act(async () => fireEvent.click(screen.getByRole("button", { name: rotulo })));
};
const aplicar = async () => {
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Aplicar" })));
};

describe("SelecaoAreasMapa — Reatribuir Códigos", () => {
  it("offline: não chama o servidor nem o PATCH (nada vai para a fila) e pede conexão", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    await montar();
    await abrirAcao("Reatribuir Códigos");
    await aplicar();
    expect(svc.renumerarAreas).not.toHaveBeenCalled();
    expect(svc.atualizarArea).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/conexão/));
  });

  it("online: uma chamada só à renumeração, em ordem de nome, sem PATCH por área", async () => {
    await montar();
    await abrirAcao("Reatribuir Códigos");
    fireEvent.change(screen.getByPlaceholderText("1"), { target: { value: "10" } });
    await aplicar();
    await waitFor(() => expect(svc.renumerarAreas).toHaveBeenCalledTimes(1));
    expect(svc.renumerarAreas).toHaveBeenCalledWith([
      { id: "c1", numero_area: "10" },
      { id: "a1", numero_area: "11" },
    ]);
    expect(svc.atualizarArea).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Códigos reatribuídos"));
  });

  it("recusa do servidor (código em uso): mensagem com o código, sem fingir sucesso", async () => {
    svc.renumerarAreas.mockImplementation(async () => {
      throw Object.assign(new Error("Argumento inválido"), {
        code: "API_INVALID_ARGUMENT",
        details: { field: "numero_area", reason: "codigo_em_uso", codigos: ["11"] },
      });
    });
    await montar();
    await abrirAcao("Reatribuir Códigos");
    fireEvent.change(screen.getByPlaceholderText("1"), { target: { value: "10" } });
    await aplicar();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/código 11 já pertence a outra área/)));
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("SelecaoAreasMapa — lote de cultura respeita a regra do cadastro", () => {
  it("com um curral na seleção, grava a cultura só no pasto e avisa o curral", async () => {
    await montar();
    await abrirAcao("Definir Tipo de Cultura");
    await aplicar();
    await waitFor(() => expect(svc.atualizarArea).toHaveBeenCalledTimes(1));
    expect(svc.atualizarArea).toHaveBeenCalledWith("a1", { tipo_pastagem: "Brachiaria" });
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/CURRAL SEDE/));
  });

  it("só o curral selecionado: nada é gravado e aparece o motivo", async () => {
    const { default: SelecaoAreasMapa } = await import("@/components/mapa/SelecaoAreasMapa");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SelecaoAreasMapa onClose={() => {}} selectedIds={["c1"]} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.queryByText("Carregando mapa…")).not.toBeInTheDocument());
    await act(async () => {});
    await abrirAcao("Definir Tipo de Cultura");
    await aplicar();
    expect(svc.atualizarArea).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/infraestrutura/i));
  });
});
