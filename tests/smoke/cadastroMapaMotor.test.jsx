/**
 * D-PROD-174 — Cadastro de Áreas, Pontos e Linhas no motor Base1:
 *  - a tela é a do motor (abas Áreas/Pontos/Linhas, "+ Novo", grade, registro com os campos travados);
 *  - GPS, seleção no mapa, importação e as ações em lote ficam em "Mais opções"; as de lote pedem seleção;
 *  - o registro tem "Editar no mapa";
 *  - `SelectDoMotor` dá aos formulários do mapa a lista do motor com a mesma interface do Select antigo;
 *  - a junção dos pontos com suplementação e bebedouro segue a regra da tabela antiga.
 */
import React from "react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/mapa/MapaDesenho", () => ({ default: ({ tipoDesenho, itemEditando, onCancelar }) => <div data-testid="editor-geometria">{tipoDesenho}:{itemEditando.id}<button onClick={onCancelar}>Sair do mapa</button></div> }));

const AREAS = [
  { id: "a1", empresa_id: "emp-1", nome: "PIQUETE 01", sigla: "P1", numero_area: "1", setor_id: "s1", setor_nome: "NORTE", tipo_cultura: "Pastagem", tipo_pastagem: "Marandu", tamanho_hectares: 12.5, capacidade_maxima: 40, quantidade_atual: 10, status_ocupacao: "Ocupado", aproveitamento_classificacao: "Média", coordenadas: { coords: [[-15.6, -56.1], [-15.6, -56.09], [-15.61, -56.09]], cor: "#61aad9" } },
  { id: "a2", empresa_id: "emp-1", nome: "RETIRO 02", sigla: "R2", numero_area: "2", setor_id: "s1", setor_nome: "NORTE", tipo_cultura: "Pastagem", tipo_pastagem: "Mombaça", tamanho_hectares: 30, capacidade_maxima: 80, quantidade_atual: 0, status_ocupacao: "Disponível", aproveitamento_classificacao: "Alta", coordenadas: { coords: [[-15.7, -56.1], [-15.7, -56.09], [-15.71, -56.09]], cor: "#61aad9" } },
];

vi.mock("@/services/mapaService", () => ({
  listarSetoresAtivos: async () => [{ id: "s1", nome: "NORTE", empresa_id: "emp-1", ativo: true }],
  listarAreasAtivas: async () => AREAS,
  listarPontosAtivos: async () => [{ id: "p1", nome: "COCHO TESTE", tipo: "Cocho", empresa_id: "emp-1", latitude: -15.6, longitude: -56.1 }],
  listarLinhasAtivas: async () => [{ id: "l1", nome: "CERCA TESTE", empresa_id: "emp-1", coordenadas: [] }],
  listarPontosSuplementacaoDaEmpresa: async () => [],
  listarBebedourosAtivos: async () => [],
  excluirArea: vi.fn(),
  excluirPontoComCascata: vi.fn(),
  excluirLinha: vi.fn(),
  atualizarArea: vi.fn(async () => ({})),
  criarArea: vi.fn(),
}));

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(() => cleanup());

const montar = async () => {
  const { default: MapaCadastro } = await import("@/pages/MapaCadastro");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MapaCadastro />
    </QueryClientProvider>,
  );
  await screen.findByText("PIQUETE 01");
};

describe("Cadastro de Áreas, Pontos e Linhas no motor", () => {
  it.each([
    ["Áreas", "PIQUETE 01", "Editar área", "area:a1"],
    ["Pontos", "COCHO TESTE", "Editar posição", "ponto:p1"],
    ["Linhas", "CERCA TESTE", "Editar traçado", "linha:l1"],
  ])("abre a geometria do registro em %s pelo botão direto", async (aba, nome, acao, resultado) => {
    await montar();
    fireEvent.click(screen.getByRole("tab", { name: aba }));
    fireEvent.doubleClick(await screen.findByText(nome));
    fireEvent.keyDown(await screen.findByRole("button", { name: "Editar" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: acao }));
    expect(await screen.findByTestId("editor-geometria")).toHaveTextContent(resultado);
    expect(document.body.style.pointerEvents).not.toBe("none");
    fireEvent.click(screen.getByRole("button", { name: "Sair do mapa" }));
    expect(await screen.findByRole("button", { name: "Novo" })).toBeEnabled();
    expect(document.body.style.pointerEvents).not.toBe("none");
  });
  it.each([
    ["Áreas", "PIQUETE 01"],
    ["Pontos", "COCHO TESTE"],
    ["Linhas", "CERCA TESTE"],
  ])("não bloqueia a tela ao abrir, cancelar e reabrir a edição em %s", async (aba, nome) => {
    await montar();
    fireEvent.click(screen.getByRole("tab", { name: aba }));
    fireEvent.doubleClick(await screen.findByText(nome));
    for (let tentativa = 0; tentativa < 2; tentativa += 1) {
      fireEvent.keyDown(await screen.findByRole("button", { name: "Editar" }), { key: "ArrowDown" });
      await screen.findByRole("menuitem", { name: "Editar detalhes" });
      // O menu de ações não é uma janela modal: não pode bloquear a página.
      expect(document.body.style.pointerEvents).not.toBe("none");
      fireEvent.click(screen.getByRole("menuitem", { name: "Editar detalhes" }));
      fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(document.body.style.pointerEvents).not.toBe("none"));
      expect(screen.queryByRole("menu")).toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: "Tabela" }));
    fireEvent.click(await screen.findByRole("tab", { name: aba === "Áreas" ? "Pontos" : "Áreas" }));
    expect(await screen.findByText(aba === "Áreas" ? "COCHO TESTE" : "PIQUETE 01")).toBeVisible();
  });

  it("abas, '+ Novo' e a grade do motor com as áreas", async () => {
    await montar();
    expect(screen.getByRole("tab", { name: "Áreas", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Pontos" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Linhas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Novo" })).toBeInTheDocument();
    expect(screen.getByText("RETIRO 02")).toBeInTheDocument();
    // sem os botões antigos na barra: as ações ficam em "Mais opções"
    expect(screen.queryByRole("button", { name: "Desenhar no Mapa" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Usar GPS" })).toBeNull();
  });

  it("'Mais opções': GPS, seleção no mapa e importação; as ações em lote pedem área selecionada", async () => {
    await montar();
    fireEvent.click(screen.getByRole("button", { name: "Mais opções" }));
    for (const nome of ["Nova área por GPS", "Selecionar no mapa", "Importar áreas"]) {
      expect(screen.getByText(nome)).toBeInTheDocument();
    }
    for (const nome of ["Definir setor", "Definir cor", "Reatribuir códigos"]) {
      const item = screen.getByText(nome).closest("button, [role='menuitem']");
      expect(item).toHaveAttribute("disabled");
    }
  });

  it("o registro abre com os campos travados e tem 'Editar no mapa'", async () => {
    await montar();
    fireEvent.doubleClick(screen.getByText("PIQUETE 01"));
    const form = await screen.findByTestId("b1-form-area");
    const nome = within(form).getByText("Nome", { selector: "label" }).closest(".mg-field");
    expect(nome).toHaveClass("mg-field--locked");
    expect(within(/** @type {HTMLElement} */ (nome)).getByRole("textbox")).toHaveValue("PIQUETE 01");
    expect(screen.getByRole("button", { name: "Editar" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Mais opções" }));
    expect(screen.queryByText("Editar no mapa")).toBeNull();
    expect(screen.queryByText("Importar áreas")).toBeNull();
  });

  it("mantém a edição no mapa visível e protege os detalhes em edição", async () => {
    await montar();
    fireEvent.doubleClick(screen.getByText("PIQUETE 01"));
    await screen.findByTestId("b1-form-area");
    fireEvent.keyDown(screen.getByRole("button", { name: "Editar" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Editar detalhes" }));
    const mapa = screen.getByRole("button", { name: "Editar no mapa — salve ou cancele os detalhes primeiro" });
    expect(mapa).toBeDisabled();
    expect(mapa).toHaveAttribute("title", "Editar no mapa — salve ou cancele os detalhes primeiro");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Editar" })).toBeEnabled();
  });
});

describe("SelectDoMotor — a lista do motor com a interface do Select antigo", () => {
  it("'Selecione' vira o campo vazio; escolher devolve o valor; o ✕ devolve o sentinela", async () => {
    const { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } = await import("@/components/cadastro/base1/SelectDoMotor");
    const onValueChange = vi.fn();
    const Caso = ({ valor }) => (
      <Select value={valor} onValueChange={onValueChange}>
        <SelectTrigger aria-label="Setor">
          <SelectValue placeholder="Selecione" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Selecione</SelectItem>
          <SelectItem value="s1">
            <span>NORTE</span>
          </SelectItem>
        </SelectContent>
      </Select>
    );
    const { rerender } = render(<Caso valor="__none__" />);
    const campo = screen.getByRole("combobox", { name: "Setor" });
    expect(campo).toHaveAttribute("data-placeholder");
    await act(async () => fireEvent.click(campo));
    const opcoes = screen.getAllByRole("option").map((o) => o.textContent.trim());
    expect(opcoes).toEqual(["NORTE"]);
    await act(async () => fireEvent.click(screen.getByRole("option", { name: "NORTE" })));
    expect(onValueChange).toHaveBeenLastCalledWith("s1");
    rerender(<Caso valor="s1" />);
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    expect(onValueChange).toHaveBeenLastCalledWith("__none__");
  });
});

describe("Pontos — junção com suplementação e bebedouro (regra da tabela antiga)", () => {
  it("o detalhe vem pelo nome; o bebedouro pelo ponto de referência", async () => {
    const { pontosComDetalhes, valorDoPonto } = await import("@/components/mapa/cadastro/colunasCadastroMapa");
    const [cocho, beb] = pontosComDetalhes(
      [
        { id: "p1", nome: "Cocho 1", tipo: "Cocho", coordenadas: { lat: -15.61234567, lng: -56.1 } },
        { id: "p2", nome: "Beb 1", tipo: "Bebedouro" },
      ],
      [{ id: "sup1", nome_ponto: "COCHO 1", categoria_ponto: "COCHO", deposito_origem_nome: "DEP 1", area_vinculada_nomes: ["PIQUETE 01", "RETIRO 02"], status: "Ativo" }],
      [{ id: "b1", ponto_referencia_id: "p2", nome: "Outro nome", tipo: "Australiano", capacidade_litros: 5000, status: "Ativo" }],
    );
    expect(valorDoPonto(cocho, "categoria")).toBe("COCHO");
    expect(valorDoPonto(cocho, "deposito")).toBe("DEP 1");
    expect(valorDoPonto(cocho, "areas")).toBe("PIQUETE 01, RETIRO 02");
    expect(valorDoPonto(cocho, "coordenadas")).toBe("-15.612346, -56.100000");
    expect(valorDoPonto(beb, "categoria")).toBe("BEBEDOURO");
    expect(valorDoPonto(beb, "tipo")).toBe("Australiano");
    expect(valorDoPonto(beb, "capacidade")).toBe("5000");
  });
});

describe("Áreas — números da grade", () => {
  it("tamanho em pt-BR e ordenação numérica de verdade", async () => {
    const { celulaDaArea, comparadorNumerico, valorDaArea } = await import("@/components/mapa/cadastro/colunasCadastroMapa");
    expect(celulaDaArea({ tamanho_hectares: 1234.5 }, "tamanho")).toBe("1.234,50");
    const comparar = comparadorNumerico(valorDaArea);
    expect(comparar({ tamanho_hectares: 9.2 }, { tamanho_hectares: 18.4 }, "tamanho")).toBeLessThan(0);
    expect(comparar({ nome: "B" }, { nome: "A" }, "nome")).toBeUndefined();
  });
});
