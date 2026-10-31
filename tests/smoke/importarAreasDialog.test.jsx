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
const renderDialog = (props = {}) => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(queryClient, "invalidateQueries");
  const onOpenChange = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ImportarAreasDialog open onOpenChange={onOpenChange} {...props} />
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
const escolher = async (trigger, opcao) => {
  // jsdom não tem PointerEvent: o clique cai no caminho "toque" do Radix. Dentro
  // de act assíncrono para o Radix assentar abertura/fechamento antes do passo seguinte.
  await act(async () => {
    fireEvent.click(trigger);
  });
  // Busca só dentro da lista aberta: getByRole no documento inteiro é lento com centenas de linhas.
  const lista = /** @type {HTMLElement} */ (document.querySelector('[role="listbox"]'));
  await act(async () => {
    fireEvent.click(within(lista).getByRole("option", { name: opcao }));
  });
};
const painelMassa = () => within(screen.getByTestId("importacao-massa"));
const acoes = () => within(screen.getByTestId("importacao-acoes"));
const gravarNaConfirmacao = async () => {
  await waitFor(() => expect(document.querySelector('[role="alertdialog"]')).not.toBeNull());
  // A gravação termina de forma assíncrona: deixa resolver dentro de act.
  await act(async () => {
    fireEvent.click(within(/** @type {HTMLElement} */ (document.querySelector('[role="alertdialog"]'))).getByRole("button", { name: "Gravar áreas" }));
  });
};
const mensagem = () => screen.getByTestId("importacao-mensagem");

const preencherEmMassa = async (campos) => {
  for (const [rotulo, opcao] of Object.entries(campos)) {
    await escolher(painelMassa().getByRole("combobox", { name: rotulo }), opcao);
  }
  fireEvent.click(painelMassa().getByRole("button", { name: "Aplicar à seleção" }));
};

const completarTudo = async () => {
  await preencherEmMassa({
    "Setor em massa": "NORTE",
    "Tipo de uso em massa": "Pastagem",
    "Tipo de cultura em massa": "Marandu",
    "Modo da área pastejada em massa": "Igual à área total de cada uma",
  });
  fireEvent.change(within(linha("f3")).getByLabelText(/^Nome/), { target: { value: "Pasto sem nome" } });
};

const respostaGravacao = (refs, { replay = false, base = 0 } = {}) => ({
  operation_id: "x",
  gravadas: refs.length,
  replay,
  importadas: refs.map((ref, i) => ({ ref, id: `a-${ref}`, numero_area: String(base + i + 1), nome: ref, setor_nome: "NORTE", tamanho_hectares: 96 })),
});

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
    await preencherEmMassa({ "Setor em massa": "SUL", "Tipo de uso em massa": "Agricultura" });
    expect(select("f1", "Setor")).toHaveTextContent("SUL");
    expect(select("f3", "Setor")).toHaveTextContent("SUL");
    expect(select("f2", "Setor")).toHaveTextContent("Selecione");
    expect(select("f2", "Tipo de uso")).toHaveTextContent("Selecione");
    expect(select("f1", "Tipo de uso")).toHaveTextContent("Agricultura");
  });

  it("valor personalizado na linha não é sobrescrito sem confirmação", async () => {
    renderDialog();
    await irParaConferencia();
    await escolher(select("f1", "Setor"), "NORTE");
    await preencherEmMassa({ "Setor em massa": "SUL" });
    expect(screen.getByRole("alert")).toHaveTextContent(/1 área\(s\) selecionada\(s\) já têm valor próprio em Setor/);
    fireEvent.click(screen.getByRole("button", { name: "Manter valores próprios" }));
    expect(select("f1", "Setor")).toHaveTextContent("NORTE");
    expect(select("f2", "Setor")).toHaveTextContent("SUL");
  });

  it("Reserva aceita 0 sem cultura; pastejada maior que o total é pendência", async () => {
    renderDialog();
    await irParaConferencia();
    await preencherEmMassa({ "Setor em massa": "NORTE", "Tipo de uso em massa": "Reserva" });
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
    await completarTudo();
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
    await completarTudo();
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
    await completarTudo();
    apis.conferirImportacaoAreas.mockResolvedValue(respostaConferencia(["f1", "f2", "f3"]));
    fireEvent.click(screen.getByRole("button", { name: "Conferir seleção (3)" }));
    await screen.findByText(/prontas para importar/);
    apis.importarAreas.mockRejectedValueOnce(new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE));
    fireEvent.click(screen.getByRole("button", { name: "Importar 3 área(s)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Gravar áreas" }));
    expect(await screen.findByTestId("importacao-mensagem")).toHaveTextContent(/Resultado desconhecido/);
    expect(within(linha("f1")).getByLabelText(/^Nome/)).toBeDisabled();

    apis.importarAreas.mockResolvedValueOnce(respostaGravacao(["f1", "f2", "f3"], { replay: true }));
    fireEvent.click(screen.getByRole("button", { name: "Verificar e concluir" }));
    await screen.findByTestId("importacao-resultado");
    expect(apis.importarAreas).toHaveBeenCalledTimes(2);
    expect(apis.importarAreas.mock.calls[1][0].operationId).toBe(apis.importarAreas.mock.calls[0][0].operationId);
    expect(screen.getByTestId("importacao-resultado").textContent).toMatch(/nada foi duplicado/);
  });

  it("editar depois de conferir invalida a conferência", async () => {
    renderDialog();
    await irParaConferencia();
    await completarTudo();
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
    await completarTudo();
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
    await completarTudo();
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
    await completarTudo();
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


// ─── R1 (D-PROD-90): resultado desconhecido, classificação e lotes ─────────

const prepararDesconhecido = async (erro = new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE)) => {
  const utils = renderDialog();
  await irParaConferencia();
  await completarTudo();
  apis.conferirImportacaoAreas.mockResolvedValue(respostaConferencia(["f1", "f2", "f3"]));
  fireEvent.click(screen.getByRole("button", { name: "Conferir seleção (3)" }));
  await screen.findByText(/prontas para importar/);
  apis.importarAreas.mockRejectedValueOnce(erro);
  fireEvent.click(screen.getByRole("button", { name: "Importar 3 área(s)" }));
  fireEvent.click(await screen.findByRole("button", { name: "Gravar áreas" }));
  await screen.findByRole("button", { name: "Verificar e concluir" });
  return utils;
};

describe("R1 — resultado desconhecido não pode ser descartado sem querer", () => {
  it("Esc, Cancelar e 'Outro arquivo' não descartam a operação; tudo fica travado", async () => {
    const { onOpenChange } = await prepararDesconhecido();
    expect(screen.getByTestId("importacao-mensagem")).toHaveTextContent(/podem já ter sido criadas/);
    expect(screen.getByTestId("importacao-mensagem").textContent).not.toMatch(/Nenhuma área/);

    // Esc
    fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
    expect(await screen.findByTestId("importacao-confirmar-saida")).toHaveTextContent(/áreas podem já ter sido criadas/);
    fireEvent.click(screen.getByRole("button", { name: "Continuar verificando" }));
    await waitFor(() => expect(screen.queryByTestId("importacao-confirmar-saida")).toBeNull());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Verificar e concluir" })).toBeEnabled();

    // Cancelar
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(await screen.findByTestId("importacao-confirmar-saida")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continuar verificando" }));
    await waitFor(() => expect(screen.queryByTestId("importacao-confirmar-saida")).toBeNull());

    // Outro arquivo, edição e seleção travados
    expect(screen.getByRole("button", { name: /Outro arquivo/ })).toBeDisabled();
    expect(within(linha("f1")).getByLabelText(/^Nome/)).toBeDisabled();
    expect(within(linha("f1")).getByRole("checkbox")).toBeDisabled();
    expect(select("f1", "Setor")).toBeDisabled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("clique fora (overlay) também pede confirmação; 'Sair sem confirmar' fecha sem afirmar que nada foi gravado", async () => {
    const { onOpenChange } = await prepararDesconhecido();
    const overlay = document.querySelector("[data-state='open'].fixed.inset-0");
    expect(overlay).not.toBeNull();
    fireEvent.pointerDown(/** @type {Element} */ (overlay));
    expect(await screen.findByTestId("importacao-confirmar-saida")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sair sem confirmar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(queryClient.invalidateQueries).toHaveBeenCalled();
  });

  it("troca de empresa durante o desconhecido: a verificação continua com a empresa e o conteúdo originais; resposta tardia conclui uma vez só", async () => {
    const { rerender } = await prepararDesconhecido();
    const primeiro = apis.importarAreas.mock.calls[0][0];
    empresaAtual = "emp-2";
    rerender(
      <QueryClientProvider client={queryClient}>
        <ImportarAreasDialog open onOpenChange={() => {}} />
      </QueryClientProvider>
    );
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/verificação pendente continua na empresa do arquivo/);
    expect(screen.queryByRole("button", { name: "Recomeçar" })).toBeNull();
    refreshCache.mockClear();
    apis.importarAreas.mockResolvedValueOnce(respostaGravacao(["f1", "f2", "f3"], { replay: true }));
    fireEvent.click(screen.getByRole("button", { name: "Verificar e concluir" }));
    await screen.findByTestId("importacao-resultado");
    const segundo = apis.importarAreas.mock.calls[1][0];
    expect(segundo.operationId).toBe(primeiro.operationId);
    expect(segundo.empresaId).toBe("emp-1");
    expect(JSON.stringify(segundo.itens)).toBe(JSON.stringify(primeiro.itens));
    expect(refreshCache).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("importacao-resultado").textContent).toMatch(/nada foi duplicado/);
  });

  it.each([
    ["500 interno", new ApiError(API_ERROR_CODES.OPERATION_FAILED)],
    ["gateway 502/504", new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE)],
    ["ainda em processamento", new ApiError(API_ERROR_CODES.IDEMPOTENCY_IN_PROGRESS)],
    ["erro sem código (corpo ilegível)", new TypeError("body stream already read")],
  ])("%s depois do envio → resultado desconhecido, nunca 'nenhuma gravada'", async (_nome, erro) => {
    await prepararDesconhecido(erro);
    expect(screen.getByTestId("importacao-mensagem")).toHaveTextContent(/podem já ter sido criadas/);
  });

  it("201 com corpo inesperado não é sucesso: vira resultado desconhecido", async () => {
    renderDialog();
    await irParaConferencia();
    await completarTudo();
    apis.conferirImportacaoAreas.mockResolvedValue(respostaConferencia(["f1", "f2", "f3"]));
    fireEvent.click(screen.getByRole("button", { name: "Conferir seleção (3)" }));
    await screen.findByText(/prontas para importar/);
    apis.importarAreas.mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "Importar 3 área(s)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Gravar áreas" }));
    expect(await screen.findByRole("button", { name: "Verificar e concluir" })).toBeInTheDocument();
    expect(screen.queryByTestId("importacao-resultado")).toBeNull();
    expect(refreshCache).not.toHaveBeenCalled();
  });

  it("sessão expirada no reenvio mantém o estado desconhecido (não prova nada sobre o 1º envio)", async () => {
    await prepararDesconhecido();
    apis.importarAreas.mockRejectedValueOnce(new ApiError(API_ERROR_CODES.TENANT_CONTEXT_REQUIRED));
    fireEvent.click(screen.getByRole("button", { name: "Verificar e concluir" }));
    expect(await screen.findByText(/A sessão expirou antes de confirmar/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verificar e concluir" })).toBeInTheDocument();
  });

  it("422 no reenvio é conclusivo: libera a correção; conteúdo novo usa chave NOVA", async () => {
    await prepararDesconhecido();
    const chave1 = apis.importarAreas.mock.calls[0][0].operationId;
    apis.importarAreas.mockRejectedValueOnce(
      new ApiError(API_ERROR_CODES.AREA_IMPORT_VALIDATION_FAILED, {
        details: respostaConferencia(["f1", "f2", "f3"], {
          f3: [{ campo: "nome", codigo: "NOME_DUPLICADO_NO_SETOR", mensagem: "Já existe a área 9 com este nome neste setor." }],
        }),
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Verificar e concluir" }));
    expect(await screen.findByTestId("importacao-mensagem")).toHaveTextContent(/Nenhuma área deste lote foi gravada/);
    expect(within(linha("f3")).getByLabelText(/^Nome/)).toBeEnabled();
    fireEvent.change(within(linha("f3")).getByLabelText(/^Nome/), { target: { value: "Outro pasto" } });
    apis.conferirImportacaoAreas.mockResolvedValue(respostaConferencia(["f1", "f2", "f3"]));
    fireEvent.click(screen.getByRole("button", { name: "Conferir seleção (3)" }));
    await screen.findByText(/prontas para importar/);
    apis.importarAreas.mockResolvedValueOnce(respostaGravacao(["f1", "f2", "f3"]));
    fireEvent.click(screen.getByRole("button", { name: "Importar 3 área(s)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Gravar áreas" }));
    await screen.findByTestId("importacao-resultado");
    const chave3 = apis.importarAreas.mock.calls[2][0].operationId;
    expect(chave3).not.toBe(chave1);
  });

  it("IDEMPOTENCY_CONFLICT é recusa conclusiva: libera e troca de chave", async () => {
    await prepararDesconhecido();
    const chave1 = apis.importarAreas.mock.calls[0][0].operationId;
    apis.importarAreas.mockRejectedValueOnce(new ApiError(API_ERROR_CODES.IDEMPOTENCY_CONFLICT));
    fireEvent.click(screen.getByRole("button", { name: "Verificar e concluir" }));
    expect(await screen.findByTestId("importacao-mensagem")).toHaveTextContent(/Nenhuma área deste lote foi gravada/);
    apis.importarAreas.mockResolvedValueOnce(respostaGravacao(["f1", "f2", "f3"]));
    fireEvent.click(screen.getByRole("button", { name: "Importar 3 área(s)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Gravar áreas" }));
    await screen.findByTestId("importacao-resultado");
    expect(apis.importarAreas.mock.calls[2][0].operationId).not.toBe(chave1);
  });
});

/** FeatureCollection sintética com N quadrados nomeados. */
const geojsonComAreas = (n) =>
  JSON.stringify({
    type: "FeatureCollection",
    features: Array.from({ length: n }, (_, i) => {
      const lat = -15.6 - Math.floor(i / 20) * 0.02;
      const lng = -56.1 + (i % 20) * 0.02;
      const d = 0.009;
      return {
        type: "Feature",
        properties: { name: `Pasto ${i + 1}` },
        geometry: { type: "Polygon", coordinates: [[[lng, lat], [lng + d, lat], [lng + d, lat - d], [lng, lat - d], [lng, lat]]] },
      };
    }),
  });

// O servidor limita 100 por confirmação (IMP-19 prova 205 = 100+100+5 em PostgreSQL).
// Na UI, 205 linhas estouram a memória do jsdom; a MESMA lógica é exercida com
// lote de 10 e 25 linhas (10 + falha + 10 + 5). A carga de 205 linhas foi medida
// no Chromium real (relatório R1, benchmark).
describe("R1 — arquivo maior que o lote continua em lotes no mesmo assistente", () => {
  it("25 áreas com lote de 10: 10 + (falha) + 10 + 5, preservando edições e marcando as já gravadas", async () => {
    const { onOpenChange } = renderDialog({ maxPorLote: 10 });
    await enviarArquivo("lote.geojson", geojsonComAreas(25));
    fireEvent.click(screen.getByRole("button", { name: "Conferir áreas" }));
    await screen.findByTestId("importacao-tabela");
    await waitFor(() => expect(setoresCarregados).toHaveBeenCalled());
    await act(async () => {});
    expect(contador("Áreas")).toBe("25");
    expect(contador("Selecionadas")).toBe("10");

    // Edição numa linha do 2º lote, antes de qualquer gravação.
    fireEvent.change(within(linha("f15")).getByLabelText(/^Nome/), { target: { value: "Editado na conferência" } });

    apis.conferirImportacaoAreas.mockImplementation(async ({ itens }) => respostaConferencia(itens.map((i) => i.ref)));
    let base = 0;
    apis.importarAreas.mockImplementation(async ({ itens }) => {
      const r = respostaGravacao(itens.map((i) => i.ref), { base });
      base += itens.length;
      return r;
    });

    const rodada = async (esperadas) => {
      await preencherEmMassa({
        "Setor em massa": "NORTE",
        "Tipo de uso em massa": "Pastagem",
        "Tipo de cultura em massa": "Marandu",
        "Modo da área pastejada em massa": "Igual à área total de cada uma",
      });
      await act(async () => {
        fireEvent.click(acoes().getByRole("button", { name: `Conferir seleção (${esperadas})` }));
      });
      await waitFor(() => expect(mensagem()).toHaveTextContent(/prontas para importar/));
      fireEvent.click(acoes().getByRole("button", { name: `Importar ${esperadas} área(s)` }));
      await gravarNaConfirmacao();
    };

    // Lote 1
    await rodada(10);
    await screen.findByTestId("importacao-resultado");
    expect(screen.getByTestId("acumulado-gravadas")).toHaveTextContent("10");
    expect(screen.getByTestId("acumulado-restantes")).toHaveTextContent("15");
    fireEvent.click(within(screen.getByTestId("importacao-resultado")).getByRole("button", { name: "Continuar com áreas restantes (15)" }));
    await screen.findByTestId("importacao-tabela");
    await act(async () => {});
    expect(contador("Selecionadas")).toBe("10");
    expect(contador("Gravadas")).toBe("10");
    expect(within(linha("f1")).getByRole("checkbox")).toBeDisabled();
    expect(screen.getByTestId("estado-f1")).toHaveTextContent(/Gravada · nº 1 \(lote 1\)/);
    expect(within(linha("f15")).getByLabelText(/^Nome/)).toHaveValue("Editado na conferência");

    // Lote 2 falha no servidor (422): o lote 1 continua gravado.
    apis.importarAreas.mockImplementationOnce(async () => {
      throw new ApiError(API_ERROR_CODES.AREA_IMPORT_VALIDATION_FAILED, {
        details: respostaConferencia(["f11"], { f11: [{ campo: "setor_id", codigo: "SETOR_INATIVO", mensagem: "O setor está inativo." }] }),
      });
    });
    await rodada(10);
    await waitFor(() => expect(mensagem()).toHaveTextContent(/Nenhuma área deste lote foi gravada/));
    expect(contador("Gravadas")).toBe("10");
    expect(screen.getByTestId("estado-f1")).toHaveTextContent(/Gravada/);

    // Reconferir e gravar o lote 2.
    fireEvent.click(acoes().getByRole("button", { name: "Conferir seleção (10)" }));
    await waitFor(() => expect(mensagem()).toHaveTextContent(/prontas para importar/));
    fireEvent.click(acoes().getByRole("button", { name: "Importar 10 área(s)" }));
    await gravarNaConfirmacao();
    await screen.findByTestId("importacao-resultado");
    expect(screen.getByTestId("acumulado-gravadas")).toHaveTextContent("20");
    fireEvent.click(within(screen.getByTestId("importacao-resultado")).getByRole("button", { name: "Continuar com áreas restantes (5)" }));
    await screen.findByTestId("importacao-tabela");
    await act(async () => {});

    // Lote 3
    await rodada(5);
    await screen.findByTestId("importacao-resultado");
    expect(screen.getByTestId("acumulado-gravadas")).toHaveTextContent("25");
    expect(screen.getByTestId("acumulado-restantes")).toHaveTextContent("0");
    expect(within(screen.getByTestId("importacao-resultado")).queryByRole("button", { name: /Continuar com áreas restantes/ })).toBeNull();

    // Pedidos: lotes disjuntos, chaves diferentes por lote gravado, edição preservada.
    const chamadas = apis.importarAreas.mock.calls.map((c) => c[0]);
    expect(chamadas.map((c) => c.itens.length)).toEqual([10, 10, 10, 5]);
    const gravados = [chamadas[0], chamadas[2], chamadas[3]];
    const refs = gravados.flatMap((c) => c.itens.map((i) => i.ref));
    expect(new Set(refs).size).toBe(25);
    expect(new Set(gravados.map((c) => c.operationId)).size).toBe(3);
    expect(chamadas[2].itens.find((i) => i.ref === "f15").nome).toBe("EDITADO NA CONFERÊNCIA");
    expect(refreshCache).toHaveBeenCalledTimes(3);

    fireEvent.click(within(screen.getByTestId("importacao-resultado")).getByRole("button", { name: "Ver áreas cadastradas" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  }, 60000);

  it("sair no meio avisa que lotes anteriores ficam gravados e os restantes não", async () => {
    const { onOpenChange } = renderDialog({ maxPorLote: 10 });
    await enviarArquivo("lote.geojson", geojsonComAreas(15));
    fireEvent.click(screen.getByRole("button", { name: "Conferir áreas" }));
    await screen.findByTestId("importacao-tabela");
    await waitFor(() => expect(setoresCarregados).toHaveBeenCalled());
    await act(async () => {});
    apis.conferirImportacaoAreas.mockImplementation(async ({ itens }) => respostaConferencia(itens.map((i) => i.ref)));
    apis.importarAreas.mockImplementation(async ({ itens }) => respostaGravacao(itens.map((i) => i.ref)));
    await preencherEmMassa({
      "Setor em massa": "NORTE",
      "Tipo de uso em massa": "Pastagem",
      "Tipo de cultura em massa": "Marandu",
      "Modo da área pastejada em massa": "Igual à área total de cada uma",
    });
    fireEvent.click(acoes().getByRole("button", { name: "Conferir seleção (10)" }));
    await waitFor(() => expect(mensagem()).toHaveTextContent(/prontas para importar/));
    fireEvent.click(acoes().getByRole("button", { name: "Importar 10 área(s)" }));
    await gravarNaConfirmacao();
    await screen.findByTestId("importacao-resultado");
    fireEvent.click(screen.getByRole("button", { name: "Ver áreas cadastradas" }));
    expect(await screen.findByTestId("importacao-confirmar-saida")).toHaveTextContent(
      /10 área\(s\) de lotes anteriores já foram gravadas e continuam gravadas. 5 área\(s\) restantes ainda não foram gravadas/
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(within(/** @type {HTMLElement} */ (document.querySelector('[role="alertdialog"]'))).getByRole("button", { name: "Sair mesmo assim" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  }, 60000);
});
