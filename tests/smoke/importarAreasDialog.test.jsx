/**
 * Assistente "Importar áreas" (D-PROD-90).
 *
 * O que a tela promete e este arquivo prova:
 *  - ler o arquivo e conferir não grava nada (nenhuma chamada de importação);
 *  - preenchimento em massa só nas linhas selecionadas, sem atropelar valor
 *    personalizado sem perguntar;
 *  - gravação só no clique final, com a seleção inteira num pedido só;
 *  - 422 → "nenhuma área foi gravada" com a pendência na linha;
 *  - rede caída → "resultado desconhecido" e reenvio com a MESMA chave;
 *  - troca de empresa e falta de rede bloqueiam a gravação;
 *  - sucesso atualiza a lista e o cache do mapa.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";

let empresaAtual = "emp-1";
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => empresaAtual }));

const apis = { conferirImportacaoAreas: vi.fn(), importarAreas: vi.fn() };
vi.mock("@/apis/areas", async (importOriginal) => ({
  ...(await importOriginal()),
  conferirImportacaoAreas: (...a) => apis.conferirImportacaoAreas(...a),
  importarAreas: (...a) => apis.importarAreas(...a),
}));

const SETORES = [
  { id: "s1", nome: "NORTE", empresa_id: "emp-1", ativo: true },
  { id: "s2", nome: "SUL", empresa_id: "emp-1", ativo: true },
];
const setoresCarregados = vi.fn();
vi.mock("@/services/mapaService", () => ({
  listarSetoresAtivos: async () => {
    setoresCarregados();
    return SETORES;
  },
}));
const refreshCache = vi.fn(async () => []);
vi.mock("@/services/mapaCacheService", () => ({ refreshMapaCacheEntry: (...a) => refreshCache(...a) }));
vi.mock("@/components/mapa/importacaoAreas/PreviaImportacaoMapa", () => ({
  default: ({ linhas }) => <div data-testid="previa-mock">{linhas.length} contornos</div>,
}));

const { ApiError, API_ERROR_CODES } = await import("@/apis/_core/ApiError");
const { default: ImportarAreasDialog } = await import("@/components/mapa/importacaoAreas/ImportarAreasDialog");

const KML = readFileSync(resolve(process.cwd(), "tests/smoke/fixtures/importacaoAreas/fazenda-google-earth.kml"), "utf8");

let queryClient;
const renderDialog = () => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(queryClient, "invalidateQueries");
  const onOpenChange = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ImportarAreasDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>
  );
  return { ...utils, onOpenChange };
};

const enviarArquivo = async (nome = "fazenda.kml", texto = KML) => {
  const file = new File([texto], nome, { type: "application/vnd.google-earth.kml+xml" });
  if (typeof file.text !== "function") file.text = async () => texto;
  fireEvent.change(screen.getByTestId("importacao-input-arquivo"), { target: { files: [file] } });
  await screen.findByTestId("importacao-resumo-arquivo");
};

const irParaConferencia = async () => {
  await enviarArquivo();
  fireEvent.click(screen.getByRole("button", { name: "Conferir áreas" }));
  await screen.findByTestId("importacao-tabela");
  // setores carregados
  await waitFor(() => expect(setoresCarregados).toHaveBeenCalled());
  await act(async () => {});
};

const contador = (rotulo) => screen.getByTestId(`contador-${rotulo}`).textContent;
const linha = (ref) => screen.getByTestId(`linha-${ref}`);
const select = (ref, rotulo) => within(linha(ref)).getByRole("combobox", { name: new RegExp(`^${rotulo}`) });

/** Abre o Select (Radix) e escolhe a opção pelo texto. */
const escolher = (trigger, opcao) => {
  // jsdom não tem PointerEvent: o clique cai no caminho "toque" do Radix.
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("option", { name: opcao }));
};

const preencherEmMassa = (campos) => {
  for (const [rotulo, opcao] of Object.entries(campos)) {
    escolher(screen.getByRole("combobox", { name: rotulo }), opcao);
  }
  fireEvent.click(screen.getByRole("button", { name: "Aplicar à seleção" }));
};

const completarTudo = () => {
  preencherEmMassa({
    "Setor em massa": "NORTE",
    "Tipo de uso em massa": "Pastagem",
    "Tipo de cultura em massa": "Marandu",
    "Modo da área pastejada em massa": "Igual à área total de cada uma",
  });
  fireEvent.change(within(linha("f3")).getByLabelText(/^Nome/), { target: { value: "Pasto sem nome" } });
};

const respostaConferencia = (refs, pendentes = {}) => ({
  empresa_id: "emp-1",
  total: refs.length,
  validas: refs.filter((r) => !pendentes[r]).length,
  com_pendencia: Object.keys(pendentes).length,
  itens: refs.map((ref) => ({ ref, ok: !pendentes[ref], tamanho_hectares_geodesico: 96, pendencias: pendentes[ref] ?? [] })),
});

beforeAll(() => {
  // Radix Select usa APIs de ponteiro/rolagem que o jsdom não implementa.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  empresaAtual = "emp-1";
  apis.conferirImportacaoAreas.mockReset();
  apis.importarAreas.mockReset();
  refreshCache.mockClear();
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  // O React Query também escuta online/offline: devolve o estado "online".
  window.dispatchEvent(new Event("online"));
  onlineManager.setOnline(true);
});

afterEach(() => cleanup());

describe("Importar áreas — etapa 1 (arquivo)", () => {
  it("lê o KML e mostra nome, formato e contagens sem nenhuma chamada ao servidor", async () => {
    renderDialog();
    await enviarArquivo();
    const resumo = screen.getByTestId("importacao-resumo-arquivo");
    expect(resumo.textContent).toMatch(/fazenda\.kml/);
    expect(resumo.textContent).toMatch(/KML · .*7 elemento\(s\): 3 área\(s\), 2 ignorado\(s\).*2 inválido\(s\)/);
    expect(apis.conferirImportacaoAreas).not.toHaveBeenCalled();
    expect(apis.importarAreas).not.toHaveBeenCalled();
  });

  it(".json que não é GeoJSON mostra erro humano e não avança", async () => {
    renderDialog();
    const file = new File(['{"a":1}'], "config.json");
    if (typeof file.text !== "function") file.text = async () => '{"a":1}';
    fireEvent.change(screen.getByTestId("importacao-input-arquivo"), { target: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/não é GeoJSON/);
    expect(screen.queryByTestId("importacao-resumo-arquivo")).toBeNull();
  });
});

describe("Importar áreas — etapa 2 (conferência)", () => {
  it("contadores e bloqueio: sem dados obrigatórios, nada pode ser conferido nem importado", async () => {
    renderDialog();
    await irParaConferencia();
    expect(contador("Identificados")).toBe("7");
    expect(contador("Áreas")).toBe("3");
    expect(contador("Pendentes")).toBe("3");
    expect(contador("Inválidos")).toBe("2");
    expect(contador("Ignorados (ponto/linha)")).toBe("2");
    expect(screen.getByRole("button", { name: /Importar 3 área/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Conferir seleção/ })).toBeDisabled();
    expect(screen.getByTestId("importacao-bloqueios").textContent).toMatch(/3 área\(s\) selecionada\(s\) com pendência/);
    expect(within(screen.getByTestId("situacao-f1")).getByText(/Escolha o setor/)).toBeInTheDocument();
    expect(screen.getByTestId("importacao-nao-importaveis").textContent).toMatch(/buraco/);
  });

  it("preenchimento em massa altera só as linhas selecionadas", async () => {
    renderDialog();
    await irParaConferencia();
    fireEvent.click(within(linha("f2")).getByRole("checkbox"));
    preencherEmMassa({ "Setor em massa": "SUL", "Tipo de uso em massa": "Agricultura" });
    expect(select("f1", "Setor")).toHaveTextContent("SUL");
    expect(select("f3", "Setor")).toHaveTextContent("SUL");
    expect(select("f2", "Setor")).toHaveTextContent("Selecione");
    expect(select("f2", "Tipo de uso")).toHaveTextContent("Selecione");
    expect(select("f1", "Tipo de uso")).toHaveTextContent("Agricultura");
  });

  it("valor personalizado na linha não é sobrescrito sem confirmação", async () => {
    renderDialog();
    await irParaConferencia();
    escolher(select("f1", "Setor"), "NORTE");
    preencherEmMassa({ "Setor em massa": "SUL" });
    expect(screen.getByRole("alert")).toHaveTextContent(/1 área\(s\) selecionada\(s\) já têm valor próprio em Setor/);
    fireEvent.click(screen.getByRole("button", { name: "Manter valores próprios" }));
    expect(select("f1", "Setor")).toHaveTextContent("NORTE");
    expect(select("f2", "Setor")).toHaveTextContent("SUL");
  });

  it("Reserva aceita 0 sem cultura; pastejada maior que o total é pendência", async () => {
    renderDialog();
    await irParaConferencia();
    preencherEmMassa({ "Setor em massa": "NORTE", "Tipo de uso em massa": "Reserva" });
    fireEvent.change(within(linha("f1")).getByLabelText(/^Área pastejada/), { target: { value: "0" } });
    expect(screen.getByTestId("estado-f1").textContent).toMatch(/Sem pendência/);
    expect(screen.queryByTestId("situacao-f1")).toBeNull();
    fireEvent.change(within(linha("f2")).getByLabelText(/^Área pastejada/), { target: { value: "5000" } });
    expect(screen.getByTestId("situacao-f2").textContent).toMatch(/maior que a área total/);
  });
});

describe("Importar áreas — etapa 3 (gravação)", () => {
  it("conferir não grava; importar envia a seleção inteira num pedido só e atualiza lista e mapa", async () => {
    const eventos = vi.fn();
    window.addEventListener("atualizar-mapa", eventos);
    const { onOpenChange } = renderDialog();
    await irParaConferencia();
    completarTudo();
    apis.conferirImportacaoAreas.mockResolvedValue(respostaConferencia(["f1", "f2", "f3"]));
    fireEvent.click(screen.getByRole("button", { name: "Conferir seleção (3)" }));
    await screen.findByText(/3 área\(s\) prontas para importar. Nada foi gravado ainda/);
    expect(apis.importarAreas).not.toHaveBeenCalled();

    const [pedidoConferencia] = apis.conferirImportacaoAreas.mock.calls[0];
    expect(pedidoConferencia.empresaId).toBe("emp-1");
    for (const item of pedidoConferencia.itens) {
      expect(item).not.toHaveProperty("numero_area");
      expect(item).not.toHaveProperty("setor_nome");
      expect(item).not.toHaveProperty("cliente_id");
      expect(item).not.toHaveProperty("empresa_id");
    }
    expect(pedidoConferencia.itens[0].coords[0]).toEqual([-15.6, -56.1]);

    apis.importarAreas.mockResolvedValue({
      operation_id: "x",
      gravadas: 3,
      replay: false,
      importadas: ["f1", "f2", "f3"].map((ref, i) => ({ ref, id: `a${i}`, numero_area: String(i + 1), nome: `N${i}`, setor_nome: "NORTE", tamanho_hectares: 96 })),
    });
    fireEvent.click(screen.getByRole("button", { name: "Importar 3 área(s)" }));
    expect(apis.importarAreas).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Gravar áreas" }));
    await screen.findByTestId("importacao-resultado");
    expect(apis.importarAreas).toHaveBeenCalledTimes(1);
    const [pedido] = apis.importarAreas.mock.calls[0];
    expect(pedido.itens.map((i) => i.ref)).toEqual(["f1", "f2", "f3"]);
    expect(pedido.operationId).toMatch(/^imp-/);
    expect(screen.getByTestId("importacao-resultado").textContent).toMatch(/3 área\(s\) gravada\(s\)/);
    expect(queryClient.invalidateQueries).toHaveBeenCalled();
    expect(refreshCache).toHaveBeenCalledWith("areas", "emp-1", { force: true });
    expect(eventos).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ver áreas cadastradas" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    window.removeEventListener("atualizar-mapa", eventos);
  });

  it("422 do servidor: nenhuma área gravada e a pendência aparece na linha", async () => {
    renderDialog();
    await irParaConferencia();
    completarTudo();
    apis.conferirImportacaoAreas.mockResolvedValue(respostaConferencia(["f1", "f2", "f3"]));
    fireEvent.click(screen.getByRole("button", { name: "Conferir seleção (3)" }));
    await screen.findByText(/prontas para importar/);
    apis.importarAreas.mockRejectedValue(
      new ApiError(API_ERROR_CODES.AREA_IMPORT_VALIDATION_FAILED, {
        details: respostaConferencia(["f1", "f2", "f3"], {
          f2: [{ campo: "coords", codigo: "AREA_DUPLICADA", mensagem: "Contorno idêntico ao da área 7 (PASTO) já cadastrada." }],
        }),
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Importar 3 área(s)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Gravar áreas" }));
    expect(await screen.findByTestId("importacao-mensagem")).toHaveTextContent(/Nenhuma área foi gravada/);
    expect(screen.getByTestId("situacao-f2").textContent).toMatch(/Contorno idêntico/);
    expect(contador("Possíveis duplicadas")).toBe("1");
    expect(screen.getByRole("button", { name: "Importar 3 área(s)" })).toBeDisabled();
  });

  it("rede caiu na gravação: resultado desconhecido, edição travada e reenvio com a MESMA chave", async () => {
    renderDialog();
    await irParaConferencia();
    completarTudo();
    apis.conferirImportacaoAreas.mockResolvedValue(respostaConferencia(["f1", "f2", "f3"]));
    fireEvent.click(screen.getByRole("button", { name: "Conferir seleção (3)" }));
    await screen.findByText(/prontas para importar/);
    apis.importarAreas.mockRejectedValueOnce(new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE));
    fireEvent.click(screen.getByRole("button", { name: "Importar 3 área(s)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Gravar áreas" }));
    expect(await screen.findByTestId("importacao-mensagem")).toHaveTextContent(/Resultado desconhecido/);
    expect(within(linha("f1")).getByLabelText(/^Nome/)).toBeDisabled();

    apis.importarAreas.mockResolvedValueOnce({ gravadas: 3, replay: true, importadas: [] });
    fireEvent.click(screen.getByRole("button", { name: "Verificar e concluir" }));
    await screen.findByTestId("importacao-resultado");
    expect(apis.importarAreas).toHaveBeenCalledTimes(2);
    expect(apis.importarAreas.mock.calls[1][0].operationId).toBe(apis.importarAreas.mock.calls[0][0].operationId);
    expect(screen.getByTestId("importacao-resultado").textContent).toMatch(/nada foi duplicado/);
  });

  it("editar depois de conferir invalida a conferência", async () => {
    renderDialog();
    await irParaConferencia();
    completarTudo();
    apis.conferirImportacaoAreas.mockResolvedValue(respostaConferencia(["f1", "f2", "f3"]));
    fireEvent.click(screen.getByRole("button", { name: "Conferir seleção (3)" }));
    await screen.findByText(/prontas para importar/);
    expect(screen.getByRole("button", { name: "Importar 3 área(s)" })).toBeEnabled();
    fireEvent.change(within(linha("f1")).getByLabelText(/^Nome/), { target: { value: "Outro nome" } });
    expect(screen.getByRole("button", { name: "Importar 3 área(s)" })).toBeDisabled();
    expect(screen.getByTestId("importacao-bloqueios").textContent).toMatch(/Confira a seleção no servidor/);
  });

  it("troca de empresa com o assistente aberto invalida e bloqueia a gravação", async () => {
    const { rerender } = renderDialog();
    await irParaConferencia();
    completarTudo();
    empresaAtual = "emp-2";
    rerender(
      <QueryClientProvider client={queryClient}>
        <ImportarAreasDialog open onOpenChange={() => {}} />
      </QueryClientProvider>
    );
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/empresa selecionada mudou/);
    expect(screen.getByRole("button", { name: /Conferir seleção/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Importar 3 área/ })).toBeDisabled();
  });

  it("sem conexão: rascunho continua editável, mas conferir e importar ficam bloqueados", async () => {
    renderDialog();
    await irParaConferencia();
    completarTudo();
    await act(async () => {
      Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText(/Sem conexão. Você pode continuar ajustando/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Conferir seleção/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Importar 3 área/ })).toBeDisabled();
    expect(apis.conferirImportacaoAreas).not.toHaveBeenCalled();
  });

  it("cancelar fecha sem gravar nada", async () => {
    const { onOpenChange } = renderDialog();
    await irParaConferencia();
    completarTudo();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(apis.importarAreas).not.toHaveBeenCalled();
  });
});

describe("Cadastro do Mapa — botão na aba Áreas", () => {
  it("'Importar áreas' aparece na aba Áreas e abre o assistente; desenhar, selecionar e GPS continuam lá", async () => {
    vi.doMock("@/services/mapaService", () => ({
      listarSetoresAtivos: async () => SETORES,
      listarAreasAtivas: async () => [],
      listarPontosAtivos: async () => [],
      listarLinhasAtivas: async () => [],
      excluirArea: vi.fn(),
      excluirPontoComCascata: vi.fn(),
      excluirLinha: vi.fn(),
    }));
    vi.resetModules();
    const { default: MapaCadastro } = await import("@/pages/MapaCadastro");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MapaCadastro />
      </QueryClientProvider>
    );
    for (const nome of ["Desenhar no Mapa", "Selecionar no Mapa", "Usar GPS"]) {
      expect(screen.getByRole("button", { name: nome })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: /Importar áreas/ }));
    expect(await screen.findByText(/Etapa 1 de 3/)).toBeInTheDocument();
    expect(apis.importarAreas).not.toHaveBeenCalled();
    vi.doUnmock("@/services/mapaService");
  });
});
