/**
 * Contrato do dono: `Lote` é só o cadastro de ENTRADA. Empresa ainda não
 * migrada para o ledger (o mapa entrega Lotes, não POSIÇÕES): todo manejo do
 * mapa é recusado no navegador com a mensagem de REBANHO_CUTOVER_PENDENTE e
 * NENHUMA requisição sai. No ledger os formulários abrem como antes.
 * Componente renderizado com dados sintéticos; serviços mockados.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const servico = vi.hoisted(() => ({
  listarProdutosDaEmpresa: vi.fn(async () => []),
  criarEventoSuplementacao: vi.fn(),
  registrarSuplementacaoEmLote: vi.fn(),
  registrarManejoRebanho: vi.fn(),
  registrarJuncaoLotes: vi.fn(),
  registrarBaixaRebanho: vi.fn(),
  registrarTransferenciaLedger: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
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
const { MENSAGENS_MANEJO_REBANHO } = await import("@/services/manejoRebanhoService");

const MSG = "Esta fazenda ainda não foi migrada para o controle por posições. O administrador precisa concluir a migração; nada foi gravado.";
const BOI = "BOI";
const loteLegado = (id) => ({ id, nome: `L-${id}`, categoria: BOI, quantidade_cabecas: 10, area_atual_id: "a1", status: "Ativo" });
const posicao = (id) => ({ ...loteLegado(id), __posicao: true });
const MANEJOS = ["Mover", "Morte", "Abate", "Nascimento", "Mudar Categoria", "Pesar", "Juntar Lotes"];

const renderizar = async (lotes) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <DetalhesLote lotes={lotes} onClose={() => {}} />
    </QueryClientProvider>
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return utils;
};
const clicar = (el) => act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 10)); });
/** D-PROD-119: manejos e históricos em quadros (no celular, atrás do botão "Manejos e históricos"). */
const acao = async (nome) => {
  const botaoUnico = screen.queryByRole("button", { name: "Manejos e históricos" });
  if (botaoUnico) await clicar(botaoUnico); // celular; no desktop os quadros já estão à vista
  await clicar(screen.getByRole("button", { name: nome }));
};
const nenhumaEscrita = () => {
  for (const fn of ["registrarManejoRebanho", "registrarJuncaoLotes", "registrarBaixaRebanho", "registrarTransferenciaLedger", "criarEventoSuplementacao", "registrarSuplementacaoEmLote"]) {
    expect(servico[fn]).not.toHaveBeenCalled();
  }
};

beforeEach(() => {
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
});
afterEach(() => cleanup());

describe("REBANHO_CUTOVER_PENDENTE: mensagem própria e recusa definitiva", () => {
  it("mensagem exata do dono", () => {
    expect(MENSAGENS_MANEJO_REBANHO.REBANHO_CUTOVER_PENDENTE).toBe(MSG);
  });
  it("409 do servidor vira a mensagem e limpa a pendência (nada foi gravado)", async () => {
    const { enviarManejoRebanho, mensagemDaTransferenciaLedger, lerPendencia } = await import("@/services/manejoRebanhoService");
    const storage = { dados: {}, getItem(k) { return this.dados[k] ?? null; }, setItem(k, v) { this.dados[k] = v; }, removeItem(k) { delete this.dados[k]; } };
    const erro = Object.assign(new Error("x"), { code: "API_OPERATION_FAILED", cause: { code: "REBANHO_CUTOVER_PENDENTE" } });
    const corpo = { tipo: "Pesagem", empresa_id: "emp-1", area_id: "a1", linhas: [] };
    await expect(enviarManejoRebanho(corpo, { escopo: "s", storage, enviar: async () => { throw erro; } })).rejects.toBe(erro);
    expect(lerPendencia("s", corpo, storage)).toBe(null);
    expect(mensagemDaTransferenciaLedger(erro)).toBe(MSG);
  });
});

describe("DetalhesLote sem ledger (empresa não migrada)", () => {
  it.each(MANEJOS)("%s: toast com a mensagem do cutover, nenhum formulário e nenhuma requisição", async (manejo) => {
    await renderizar([loteLegado("l1"), loteLegado("l2")]);
    await acao(manejo);
    expect(toast.error).toHaveBeenCalledWith(MSG);
    expect(screen.queryByRole("dialog")).toBe(null);
    nenhumaEscrita();
  });
  it("arrastar para outra área (open-movimentacao) também recusa sem abrir o Mover", async () => {
    await renderizar([loteLegado("l1")]);
    await act(async () => { window.dispatchEvent(new CustomEvent("open-movimentacao", { detail: { areaDestinoId: "a2" } })); });
    expect(toast.error).toHaveBeenCalledWith(MSG);
    expect(screen.queryByTestId("form-mover")).toBe(null);
    nenhumaEscrita();
  });
  it("históricos seguem abrindo (somente leitura)", async () => {
    await renderizar([loteLegado("l1")]);
    await acao("Histórico de Movimentação");
    expect(screen.getByTestId("form-historico")).toBeTruthy();
    // D-PROD-117: o histórico é um diálogo modal (LancLoteDialogo); fecha antes de abrir o outro.
    await clicar(screen.getByRole("button", { name: "Fechar" }));
    await acao("Histórico de Suplementação");
    expect(screen.getByTestId("form-historico-supl")).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("DetalhesLote no ledger (posições): formulários abrem como antes", () => {
  it.each([["Mover", "mover"], ["Morte", "morte"], ["Abate", "abate"], ["Nascimento", "nascimento"], ["Mudar Categoria", "mudanca"], ["Pesar", "pesagem"]])(
    "%s abre o formulário sem recusa",
    async (manejo, id) => {
      await renderizar([posicao("p1"), posicao("p2")]);
      await acao(manejo);
      expect(screen.getByTestId(`form-${id}`)).toBeTruthy();
      expect(toast.error).not.toHaveBeenCalled();
    }
  );
  it("Juntar Lotes abre o diálogo de junção", async () => {
    await renderizar([posicao("p1"), posicao("p2")]);
    await acao("Juntar Lotes");
    expect(screen.getByText("Selecione o lote que receberá os animais (lote principal):")).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("DetalhesLote não grava efeito de manejo em Lote (fonte)", () => {
  const codigo = readFileSync("src/components/mapa/DetalhesLote.jsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  it("sem atualizarLote/criarLote/criarMovimentacao/registrarManejoLote, sem releitura de Lotes nem validação temporal no navegador", () => {
    expect(codigo).not.toMatch(/atualizarLote|criarLote|criarMovimentacao|registrarManejoLote|listarLotesDaEmpresa|validarOrdemTemporal|saldoEStatusDaOrigem|comEstadoEsperado|usarComandoDoServidor/);
    expect(codigo).not.toMatch(/Abrir pesagem depois da movimentação|registrarPesagemAposMovimentacao/);
  });
  it("todo manejo passa pela recusa do cutover quando não há ledger", () => {
    expect(codigo).toMatch(/toast\.error\(MENSAGENS_MANEJO_REBANHO\.REBANHO_CUTOVER_PENDENTE\)/);
    for (const fn of ["const executarBaixa = async", "const executarManejoRebanho = async", "const confirmarJuncao = async", "const handlePesagem = async"]) {
      const i = codigo.indexOf(fn);
      expect(i).toBeGreaterThan(-1);
      expect(codigo.slice(i, i + 200)).toMatch(/if \(!modoLedger\) return recusarManejoSemLedger\(\);/);
    }
  });
});
