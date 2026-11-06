/**
 * D-PROD-139 — "Editar Informação" no Detalhes do Lote, controle por posições.
 * DetalhesLote e o formulário REAIS; mocks só na borda (serviços de rede, toast,
 * diálogo). Antes o botão só mostrava "renomeie no Cadastro de Lotes".
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const servico = vi.hoisted(() => ({
  listarProdutosDaEmpresa: vi.fn(async () => []),
  criarEventoSuplementacao: vi.fn(),
  registrarSuplementacaoEmLote: vi.fn(),
  registrarManejoRebanho: vi.fn(),
  registrarJuncaoLotes: vi.fn(),
  registrarBaixaRebanho: vi.fn(),
  registrarTransferenciaLedger: vi.fn(),
  atualizarLote: vi.fn(),
  criarMovimentacao: vi.fn(),
  listarTodasMovimentacoes: vi.fn(async () => []),
  editarInformacaoPosicaoNoServidor: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }));
const formulario = vi.hoisted(() => (nome) => async () => {
  const { createElement } = await import("react");
  return { default: () => createElement("div", { "data-testid": `form-${nome}` }) };
});
const cache = vi.hoisted(() => ({ getMapaCachedData: vi.fn(async () => []), refreshMapaCacheEntry: vi.fn(async () => []) }));

vi.mock("@/services/loteManejoService", () => servico);
vi.mock("@/services/mapaCacheService", () => cache);
vi.mock("@/services/mapaService", () => ({ listarIconesPorTipoEntidade: async () => [] }));
vi.mock("@/services/sessionService", () => ({ getCurrentUser: async () => ({ id: "u-1", cliente_id: "c-1" }) }));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
vi.mock("@/components/lotes/ExcluirMovimentacao", () => ({ escopoDoUsuario: () => "c-1:u-1" }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }) => <button type="button" onClick={onClick}>{children}</button>,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }) => <div>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <div>{children}</div>,
  DialogDescription: ({ children }) => <div>{children}</div>,
}));
vi.mock("@/components/lotes/FormularioMovimentacaoLote", formulario("mover"));
vi.mock("@/components/lotes/FormularioMorte", formulario("morte"));
vi.mock("@/components/lotes/FormularioNascimento", formulario("nascimento"));
vi.mock("@/components/lotes/FormularioAbate", formulario("abate"));
vi.mock("@/components/lotes/FormularioMudancaCategoria", formulario("mudanca"));
vi.mock("@/components/lotes/FormularioPesagem", formulario("pesagem"));
vi.mock("@/components/lotes/HistoricoMovimentacoes", formulario("historico"));
vi.mock("@/components/suplementacao/HistoricoSuplementacaoLote", formulario("historico-supl"));
vi.mock("@/components/suplementacao/ResumoSuplementacao", formulario("resumo-supl"));
vi.mock("@/components/lotes/RenomearLoteForm", formulario("renomear"));
vi.mock("@/components/mapa/InformacoesArea", formulario("info-area"));

const { default: DetalhesLote } = await import("@/components/mapa/DetalhesLote");

const posicao = (id, extra = {}) => ({
  id, posicao_id: id, __posicao: true, nome: `GRUPO ${id}`, numero_lote: "7", categoria: "BOI", sexo: "Macho", categoria_manejo_nome: "Recria",
  quantidade_cabecas: 12, peso_medio_kg: 410, area_atual_id: "a1", area_atual_nome: "PASTO A", status: "Ativo", lote_entrada_id: `entrada-${id}`,
  identificador_nome: "Brinco", identificador_sigla: "BR", identificador_cor: "#2c303e", raca_predominante: "Nelore", sistema_produtivo: "Pasto", data_entrada: "2026-10-25",
  ...extra,
});
const erroServidor = (code) => Object.assign(new Error("x"), { code: "API_OPERATION_FAILED", cause: { code } });

let client;
let onClose;
const renderizar = async (lotes, permissions = {}) => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["mapa-lotes", "emp-1"], lotes);
  onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <DetalhesLote lotes={lotes} onClose={onClose} permissions={permissions} />
    </QueryClientProvider>
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return utils;
};
const clicar = (el) => act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 10)); });
const acao = async (nome) => {
  const botaoUnico = screen.queryByRole("button", { name: "Manejos e históricos" });
  if (botaoUnico) await clicar(botaoUnico);
  await clicar(screen.getByRole("button", { name: nome }));
};
const digitar = (rotulo, valor) => act(async () => { fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } }); });
const salvar = () => act(async () => {
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await new Promise((r) => setTimeout(r, 20));
});
const nenhumaEscritaDeManejoOuCadastro = () => {
  for (const fn of ["registrarManejoRebanho", "registrarJuncaoLotes", "registrarBaixaRebanho", "registrarTransferenciaLedger", "criarEventoSuplementacao", "registrarSuplementacaoEmLote", "atualizarLote", "criarMovimentacao"]) {
    expect(servico[fn], fn).not.toHaveBeenCalled();
  }
};

beforeEach(() => {
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  vi.clearAllMocks();
  cache.refreshMapaCacheEntry.mockImplementation(async () => []);
});
afterEach(() => cleanup());

describe("Editar Informação da posição (controle por posições)", () => {
  it("vários grupos: escolhe o grupo (com área), edita só o descritivo e envia SÓ os campos alterados", async () => {
    // "Servidor": o PATCH grava; o GET seguinte (refresh do cache do mapa) devolve o gravado.
    let doServidor = [posicao("p1"), posicao("p2")];
    servico.editarInformacaoPosicaoNoServidor.mockImplementation(async (id, corpo) => {
      doServidor = doServidor.map((x) => (x.id === id ? { ...x, nome: corpo.nome, identificador_sigla: corpo.identificador_sigla } : x));
      return { alterados: ["nome", "identificador_sigla"], posicao: doServidor.find((x) => x.id === id) };
    });
    cache.refreshMapaCacheEntry.mockImplementation(async () => doServidor);
    const eventos = [];
    const ouvir = (e) => eventos.push(e.detail);
    window.addEventListener("atualizar-mapa", ouvir);
    await renderizar([posicao("p1"), posicao("p2")]);
    await acao("Editar Informação");
    expect(toast.error).not.toHaveBeenCalled();
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByText("Selecione o grupo desta área para editar:")).toBeTruthy();
    await clicar(within(dialogo).getByRole("button", { name: /GRUPO p2/ }));

    expect(screen.getByTestId("info-posicao-alvo").textContent).toContain("GRUPO p2");
    expect(screen.getByTestId("info-posicao-alvo").textContent).toContain("PASTO A");
    expect(screen.getByRole("group", { name: "Informações do grupo (editáveis)" })).toBeTruthy();
    const leitura = screen.getByTestId("info-posicao-somente-leitura");
    for (const t of ["Nelore", "Pasto", "25/10/2026", "Recria", "410"]) expect(leitura.textContent).toContain(t);
    expect(within(leitura).queryByRole("textbox")).toBeNull();

    await digitar("Nome do grupo", "  GRUPO NOVO ");
    await digitar("Identificador (sigla)", "GN");
    await salvar();

    expect(servico.editarInformacaoPosicaoNoServidor).toHaveBeenCalledTimes(1);
    expect(servico.editarInformacaoPosicaoNoServidor).toHaveBeenCalledWith("p2", { empresa_id: "emp-1", nome: "GRUPO NOVO", identificador_sigla: "GN" });
    expect(toast.success).toHaveBeenCalledWith("Informações do grupo salvas.");
    nenhumaEscritaDeManejoOuCadastro();
    // cache do mapa (inclusive depois do novo GET) mostra o valor gravado; p1 intacto
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(cache.refreshMapaCacheEntry).toHaveBeenCalledWith("lotes", "emp-1");
    const noCache = client.getQueryData(["mapa-lotes", "emp-1"]);
    expect(noCache.find((x) => x.id === "p2").nome).toBe("GRUPO NOVO");
    expect(noCache.find((x) => x.id === "p1").nome).toBe("GRUPO p1");
    expect(eventos.some((d) => d?.cacheKeys?.includes("lotes"))).toBe(true);
    expect(onClose).toHaveBeenCalled();
    window.removeEventListener("atualizar-mapa", ouvir);
  });

  it("um grupo só: abre direto o formulário; identificação apagada vai como null", async () => {
    servico.editarInformacaoPosicaoNoServidor.mockResolvedValue({ alterados: ["identificador_nome"], posicao: posicao("p1", { identificador_nome: null }) });
    await renderizar([posicao("p1")]);
    await acao("Editar Informação");
    expect(screen.getByTestId("info-posicao-alvo").textContent).toContain("GRUPO p1");
    await digitar("Identificador (nome)", "   ");
    await salvar();
    expect(servico.editarInformacaoPosicaoNoServidor).toHaveBeenCalledWith("p1", { empresa_id: "emp-1", identificador_nome: null });
  });

  it("sem mudança: não envia e avisa que nada foi gravado", async () => {
    await renderizar([posicao("p1")]);
    await acao("Editar Informação");
    await salvar();
    expect(servico.editarInformacaoPosicaoNoServidor).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("Nada mudou. Nada foi gravado.");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("nome vazio: não envia; mensagem na tela", async () => {
    await renderizar([posicao("p1")]);
    await acao("Editar Informação");
    await digitar("Nome do grupo", "   ");
    await salvar();
    expect(servico.editarInformacaoPosicaoNoServidor).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Informe o nome do grupo.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([
    ["ACAO_NAO_PERMITIDA", "Sua conta não tem permissão para editar informações do lote no mapa. Nada foi gravado."],
    ["POSICAO_REBANHO_NOT_FOUND", "Este grupo não existe mais nesta área (foi movido ou o mapa está desatualizado). Recarregue o mapa. Nada foi gravado."],
    ["POSICAO_REBANHO_VAZIA", "Este grupo não tem mais animais nesta área. Recarregue o mapa. Nada foi gravado."],
  ])("erro do servidor %s: mensagem precisa, sem sucesso falso, formulário continua aberto e cache intacto", async (codigo, mensagem) => {
    servico.editarInformacaoPosicaoNoServidor.mockRejectedValue(erroServidor(codigo));
    await renderizar([posicao("p1")]);
    await acao("Editar Informação");
    await digitar("Nome do grupo", "OUTRO");
    await salvar();
    expect(toast.error).toHaveBeenCalledWith(mensagem);
    expect(screen.getByRole("alert").textContent).toBe(mensagem);
    expect(toast.success).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(client.getQueryData(["mapa-lotes", "emp-1"])[0].nome).toBe("GRUPO p1");
  });

  it("falha de rede: mensagem de resultado não confirmado (repetir é seguro)", async () => {
    servico.editarInformacaoPosicaoNoServidor.mockRejectedValue(Object.assign(new Error("offline"), { code: "SERVICE_UNAVAILABLE" }));
    await renderizar([posicao("p1")]);
    await acao("Editar Informação");
    await digitar("Nome do grupo", "OUTRO");
    await salvar();
    expect(toast.error).toHaveBeenCalledWith("Não foi possível confirmar a gravação (conexão ou servidor). Tente de novo: repetir não duplica nada.");
  });

  it("sem renomear_lotes: o botão não aparece", async () => {
    await renderizar([posicao("p1")], { renomear_lotes: false });
    const botaoUnico = screen.queryByRole("button", { name: "Manejos e históricos" });
    if (botaoUnico) await clicar(botaoUnico);
    expect(screen.queryByRole("button", { name: "Editar Informação" })).toBeNull();
  });

  it("sem ledger (lote legado): continua o formulário antigo de renomear, sem o comando de posição", async () => {
    const legado = { id: "l1", nome: "L-1", categoria: "BOI", quantidade_cabecas: 10, area_atual_id: "a1", status: "Ativo" };
    await renderizar([legado]);
    await acao("Editar Informação");
    expect(screen.getByTestId("form-renomear")).toBeTruthy();
    expect(screen.queryByTestId("info-posicao-alvo")).toBeNull();
    expect(servico.editarInformacaoPosicaoNoServidor).not.toHaveBeenCalled();
  });
});
