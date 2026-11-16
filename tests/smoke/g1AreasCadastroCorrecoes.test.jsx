/**
 * Correções do Cadastro de Áreas (frente G1):
 *  - área pastejada decimal vinda da API ("10.5") não vira 105 ao editar;
 *  - área de Infraestrutura abre e salva com o tipo gravado em `tipo_pastagem`;
 *  - lote de uso/cultura respeita a regra do cadastro (curral não perde o tipo);
 *  - "Reatribuir códigos" é uma chamada só à renumeração do servidor, nunca vai para a
 *    fila offline e explica a falha;
 *  - "1.500" digitado no formulário é milhar (1500 ha), como nos demais formulários;
 *  - no registro do cadastro, Cancelar desfaz o digitado e o cabeçalho mostra o nome salvo.
 */
import React from "react";
import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

// ~1 km x 1 km (≈ 96 ha)
const QUADRADO = [
  [-15.6, -56.1],
  [-15.6, -56.091],
  [-15.609, -56.091],
  [-15.609, -56.1],
];

const banco = vi.hoisted(() => ({ areas: /** @type {any[]} */ ([]) }));
const svc = vi.hoisted(() => ({
  atualizarArea: vi.fn(),
  criarArea: vi.fn(),
  renumerarAreas: vi.fn(),
}));

vi.mock("@/services/mapaService", () => ({
  renumerarAreas: (...a) => svc.renumerarAreas(...a),
  listarSetoresAtivos: async () => [{ id: "s1", nome: "NORTE", empresa_id: "emp-1", ativo: true }],
  listarAreasAtivas: async () => banco.areas.map((a) => ({ ...a })),
  listarPontosAtivos: async () => [],
  listarLinhasAtivas: async () => [],
  listarPontosSuplementacaoDaEmpresa: async () => [],
  listarBebedourosAtivos: async () => [],
  excluirArea: vi.fn(),
  excluirPontoComCascata: vi.fn(),
  excluirLinha: vi.fn(),
  atualizarArea: (...a) => svc.atualizarArea(...a),
  criarArea: (...a) => svc.criarArea(...a),
}));

const PASTO = {
  id: "a1",
  empresa_id: "emp-1",
  nome: "PASTO 1",
  numero_area: "1",
  setor_id: "s1",
  setor_nome: "NORTE",
  tipo_cultura: "Pastagem",
  tipo_pastagem: "Marandu",
  tamanho_hectares: 96,
  area_pastejada: 10.5,
  aproveitamento_classificacao: "Média",
  coordenadas: { coords: QUADRADO, cor: "#61aad9" },
};
const CURRAL = {
  id: "c1",
  empresa_id: "emp-1",
  nome: "CURRAL SEDE",
  numero_area: "2",
  setor_id: "s1",
  setor_nome: "NORTE",
  tipo_cultura: "Infraestrutura",
  tipo_pastagem: "Curral",
  tamanho_hectares: 0,
  area_pastejada: 0,
  coordenadas: { coords: QUADRADO, cor: "#61aad9" },
};

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  banco.areas = [{ ...PASTO }, { ...CURRAL }];
  svc.renumerarAreas.mockReset();
  svc.renumerarAreas.mockImplementation(async (itens) => itens);
  svc.atualizarArea.mockReset();
  svc.atualizarArea.mockImplementation(async (id, dados) => {
    const i = banco.areas.findIndex((a) => a.id === id);
    banco.areas[i] = { ...banco.areas[i], ...dados };
    return { ...banco.areas[i] };
  });
  toast.success.mockClear();
  toast.error.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const novoQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const montarFormulario = async (item, props = {}) => {
  const { default: FormularioArea } = await import("@/components/mapa/FormularioArea");
  const onSave = vi.fn();
  render(
    <QueryClientProvider client={novoQc()}>
      <FormularioArea item={item} coordenadas={item.coordenadas.coords} onSave={onSave} onCancel={() => {}} {...props} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText("Setor", { selector: "label" })).toBeInTheDocument());
  await act(async () => {});
  return { onSave };
};

const campo = (rotulo) =>
  within(/** @type {HTMLElement} */ (screen.getByText(rotulo, { selector: "label" }).closest(".mg-field"))).getByRole("textbox");

describe("FormularioArea — edição", () => {
  it("área pastejada 10.5 da API abre em pt-BR e é gravada como 10.5 (não 105)", async () => {
    await montarFormulario(PASTO);
    expect(campo("Área pastejada ou arável (ha)")).toHaveValue("10,50");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Salvar" })));
    await waitFor(() => expect(svc.atualizarArea).toHaveBeenCalledTimes(1));
    expect(svc.atualizarArea.mock.calls[0][1].area_pastejada).toBe(10.5);
  });

  it("pastejada que bloqueava por virar 105 (> total) agora salva", async () => {
    // total geodésico ≈ 96 ha; "95.5" virava 955 e era recusado
    await montarFormulario({ ...PASTO, area_pastejada: 95.5 });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Salvar" })));
    await waitFor(() => expect(svc.atualizarArea).toHaveBeenCalledTimes(1));
    expect(svc.atualizarArea.mock.calls[0][1].area_pastejada).toBe(95.5);
  });

  it("ponto decimal digitado no teclado ('1.5') grava 1.5; pt-BR '1,5' também", async () => {
    await montarFormulario(PASTO);
    fireEvent.change(campo("Área pastejada ou arável (ha)"), { target: { value: "1.5" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Salvar" })));
    await waitFor(() => expect(svc.atualizarArea).toHaveBeenCalledTimes(1));
    expect(svc.atualizarArea.mock.calls[0][1].area_pastejada).toBe(1.5);
  });

  it("'1.500' digitado (pt-BR, ponto de milhar) é 1500 ha, não 1,5: passa da total e é recusado", async () => {
    // total geodésico ≈ 96 ha
    await montarFormulario(PASTO);
    fireEvent.change(campo("Área pastejada ou arável (ha)"), { target: { value: "1.500" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Salvar" })));
    expect(svc.atualizarArea).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Área pastejada maior que a área total.");
  });

  it("Infraestrutura: o registro mostra o tipo gravado e salva sem pedir de novo", async () => {
    await montarFormulario(CURRAL, { readOnly: true, layout: "registro" });
    expect(campo("Tipo de infraestrutura")).toHaveValue("CURRAL");
    cleanup();
    await montarFormulario(CURRAL);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Salvar" })));
    await waitFor(() => expect(svc.atualizarArea).toHaveBeenCalledTimes(1));
    expect(svc.atualizarArea.mock.calls[0][1]).toMatchObject({ tipo_cultura: "Infraestrutura", tipo_pastagem: "Curral" });
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("lerHectaresDigitados — hectares digitados no formulário", () => {
  it("milhar pt-BR sem vírgula é milhar; ponto decimal do teclado continua decimal", async () => {
    const { lerHectaresDigitados, lerHectares } = await import("@/domain/areas/regrasCadastroArea");
    expect(lerHectaresDigitados("1.500")).toBe(1500);
    expect(lerHectaresDigitados("12.345.678")).toBe(12345678);
    expect(lerHectaresDigitados(" 1.500 ")).toBe(1500);
    expect(lerHectaresDigitados("1.234,56")).toBe(1234.56);
    expect(lerHectaresDigitados("10.5")).toBe(10.5);
    expect(lerHectaresDigitados("1.5")).toBe(1.5);
    expect(lerHectaresDigitados("10.50")).toBe(10.5);
    expect(lerHectaresDigitados("10,5")).toBe(10.5);
    expect(lerHectaresDigitados(10.5)).toBe(10.5);
    expect(lerHectaresDigitados("")).toBeNull();
    expect(lerHectaresDigitados("0")).toBe(0);
    // A importação por arquivo não muda (segue no leitor de sempre).
    expect(lerHectares("1.500")).toBe(1.5);
  });
});

describe("mensagemErroRenumeracao", () => {
  it("traduz o motivo do servidor e sempre diz que nada mudou", async () => {
    const { mensagemErroRenumeracao } = await import("@/domain/areas/mensagemErroRenumeracao");
    expect(mensagemErroRenumeracao({ details: { reason: "codigo_em_uso", codigos: ["3", "4"] } })).toMatch(
      /os códigos 3, 4 já pertencem a outra área.*Nenhum código foi mudado/,
    );
    expect(mensagemErroRenumeracao({ details: { reason: "codigo_repetido", codigo: "3" } })).toMatch(/mais de uma área/);
    expect(mensagemErroRenumeracao({ code: "API_PROVIDER_UNAVAILABLE" })).toMatch(/sem conexão/);
    expect(mensagemErroRenumeracao(new Error("x"))).toMatch(/servidor não aceitou.*Nenhum código foi mudado/);
    expect(mensagemErroRenumeracao(undefined)).toMatch(/Nenhum código foi mudado/);
  });
});

describe("Lote de uso/cultura (Selecionar no mapa) — regra do cadastro", () => {
  it("cultura não se aplica ao curral; uso Infraestrutura em pasto é recusado; pasto recebe a cultura", async () => {
    const { planejarLoteUsoCultura, textoDasIgnoradas } = await import("@/domain/areas/loteUsoCulturaAreas");
    const areas = [PASTO, CURRAL];
    const cultura = planejarLoteUsoCultura({ areas, ids: ["a1", "c1"], tipo: "cultura", valor: "Mombaça" });
    expect(cultura.erro).toBeNull();
    expect(cultura.aplicar).toEqual([{ id: "a1", dados: { tipo_pastagem: "Mombaça" } }]);
    expect(cultura.ignoradas.map((i) => i.id)).toEqual(["c1"]);
    expect(textoDasIgnoradas(cultura.ignoradas)).toMatch(/CURRAL SEDE/);

    const soCurral = planejarLoteUsoCultura({ areas, ids: ["c1"], tipo: "cultura", valor: "Mombaça" });
    expect(soCurral.aplicar).toEqual([]);
    expect(soCurral.erro).toMatch(/infraestrutura/i);

    const infra = planejarLoteUsoCultura({ areas, ids: ["a1"], tipo: "uso", valor: "Infraestrutura" });
    expect(infra.aplicar).toEqual([]);
    expect(infra.erro).toMatch(/tipo de infraestrutura/);

    const pastoNoCurral = planejarLoteUsoCultura({ areas, ids: ["a1", "c1"], tipo: "uso", valor: "Agricultura" });
    expect(pastoNoCurral.aplicar).toEqual([{ id: "a1", dados: { tipo_cultura: "Agricultura" } }]);
    expect(pastoNoCurral.ignoradas.map((i) => i.id)).toEqual(["c1"]);

    expect(planejarLoteUsoCultura({ areas, ids: ["a1"], tipo: "uso", valor: "Reserva" }).aplicar).toHaveLength(1);
    expect(planejarLoteUsoCultura({ areas, ids: ["a1"], tipo: "cultura", valor: "Inexistente" }).erro).toBeTruthy();
  });
});

describe("AcoesEmLoteAreas — Reatribuir códigos", () => {
  const montarLote = async (acao) => {
    const { default: AcoesEmLoteAreas } = await import("@/components/mapa/cadastro/AcoesEmLoteAreas");
    const onAplicado = vi.fn();
    render(<AcoesEmLoteAreas acao={acao} areas={[PASTO, CURRAL]} setores={[]} onFechar={() => {}} onAplicado={onAplicado} />);
    return { onAplicado };
  };

  it("offline: não grava nada (nada vai para a fila) e explica que precisa de conexão", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const { onAplicado } = await montarLote("renumerar");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Aplicar" })));
    expect(svc.atualizarArea).not.toHaveBeenCalled();
    expect(svc.renumerarAreas).not.toHaveBeenCalled();
    expect(onAplicado).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/conexão/));
  });

  it("online: uma chamada só à renumeração do servidor (ordem de nome), sem PATCH por área", async () => {
    const { onAplicado } = await montarLote("renumerar");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Aplicar" })));
    await waitFor(() => expect(onAplicado).toHaveBeenCalledTimes(1));
    expect(svc.renumerarAreas).toHaveBeenCalledTimes(1);
    expect(svc.renumerarAreas).toHaveBeenCalledWith([
      { id: "c1", numero_area: "1" },
      { id: "a1", numero_area: "2" },
    ]);
    expect(svc.atualizarArea).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Códigos reatribuídos");
  });

  it("online com recusa do servidor: mensagem clara, sem fingir sucesso", async () => {
    svc.renumerarAreas.mockImplementation(async () => {
      throw new Error("400");
    });
    const { onAplicado } = await montarLote("renumerar");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Aplicar" })));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/reatribuir os códigos/)));
    expect(toast.success).not.toHaveBeenCalled();
    expect(onAplicado).not.toHaveBeenCalled();
  });

  it("falha parcial (cor) recarrega a lista e avisa", async () => {
    svc.atualizarArea.mockImplementation(async (id) => {
      if (id === "c1") throw new Error("falhou");
      return {};
    });
    const { onAplicado } = await montarLote("cor");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Aplicar" })));
    await waitFor(() => expect(onAplicado).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/parcial/));
  });
});

describe("Registro do Cadastro de Áreas (TelaCadastroMapa)", () => {
  const montarCadastro = async () => {
    const { default: MapaCadastro } = await import("@/pages/MapaCadastro");
    render(
      <QueryClientProvider client={novoQc()}>
        <MapaCadastro />
      </QueryClientProvider>,
    );
    await screen.findByText("PASTO 1");
    fireEvent.doubleClick(screen.getByText("PASTO 1"));
    await screen.findByTestId("b1-form-area");
    await act(async () => {});
  };
  const editar = async () => {
    const botao = screen.getAllByRole("button").find((b) => /^Editar$/i.test(b.getAttribute("aria-label") || b.textContent.trim()));
    await act(async () => fireEvent.click(/** @type {HTMLElement} */ (botao)));
  };
  const campoNome = () =>
    within(/** @type {HTMLElement} */ (within(screen.getByTestId("b1-form-area")).getByText("Nome", { selector: "label" }).closest(".mg-field"))).getByRole("textbox");

  it("Cancelar descarta o que foi digitado", async () => {
    await montarCadastro();
    await editar();
    fireEvent.change(campoNome(), { target: { value: "PASTO X" } });
    expect(campoNome()).toHaveValue("PASTO X");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancelar" })));
    await waitFor(() => expect(campoNome()).toHaveValue("PASTO 1"));
    expect(svc.atualizarArea).not.toHaveBeenCalled();
  });

  it("depois de salvar, o registro aberto passa a ser o gravado (título/código/campos)", async () => {
    await montarCadastro();
    await editar();
    fireEvent.change(campoNome(), { target: { value: "Pasto 01" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Salvar" })));
    await waitFor(() => expect(svc.atualizarArea).toHaveBeenCalledTimes(1));
    // O registro aberto passa a ser a linha recarregada (o formulário remonta com o gravado:
    // "PASTO 01" do servidor, não o "Pasto 01" que ficou digitado no campo).
    await waitFor(() => expect(campoNome()).toHaveValue("PASTO 01"));
  });
});
