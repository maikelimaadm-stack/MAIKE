/**
 * MAIKE-SAAS-ADMIN-S04-P1-R1 — troca de senha na tela /Usuarios.
 *
 * O backend (S04-P1) encerra todas as sessões da conta quando a senha muda.
 * Prova, com a página real (controller Base1, React Query e mutações reais;
 * só a tabela, o formulário e a rede são stubs observáveis):
 *  - A: a troca da PRÓPRIA senha confirmada pelo servidor chama `logout()` do
 *    AuthContext uma vez e avisa para entrar de novo; a de OUTRA conta não;
 *    a própria conta é decidida pelo ID autenticado, não pelo login;
 *  - B: nenhuma credencial (`senha_atual`, `nova_senha`) fica na ficha
 *    (`editingItem`), no QueryCache, no MutationCache nem em toast;
 *  - falhas não viram sucesso nem logout; resultado incerto é dito como tal.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ApiError, API_ERROR_CODES } from "@/apis/_core/ApiError";

const SENHA_ATUAL = "Senha-Atual-Secreta-1";
const SENHA_NOVA = "Senha-Nova-Secreta-2";

const rede = { atualizar: vi.fn(), pagina: vi.fn() };
const logoutMock = vi.fn();
const authAtual = { clienteId: "cliente-a", user: { id: "u-eu", login: "eu" }, logout: logoutMock };
const currentUserMock = vi.fn();

vi.mock("@/services/usuarioAdminService", async (importOriginal) => ({
  ...(await importOriginal()),
  listarContasAcessoPagina: (...a) => rede.pagina(...a),
  atualizarContaAcesso: (...a) => rede.atualizar(...a),
  criarContaAcesso: vi.fn(),
}));
vi.mock("@/services/sessionService", async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentUser: (...a) => currentUserMock(...a),
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => authAtual }));

const toastMock = { success: vi.fn(), error: vi.fn(), message: vi.fn() };
vi.mock("sonner", () => ({
  toast: {
    success: (...a) => toastMock.success(...a),
    error: (...a) => toastMock.error(...a),
    message: (...a) => toastMock.message(...a),
  },
}));

vi.mock("../../src/components/usuarios/TabelaContasAcesso", () => ({
  CONTAS_ACESSO_COLUNAS: [{ id: "nome", label: "Nome" }],
  getContaAcessoFieldValue: (item, id) => item[id] ?? "",
  default: ({ contas, onEdit }) => (
    <div data-testid="tabela">
      {contas.map((c) => (
        <button key={c.id} type="button" onClick={() => onEdit(c)}>{`abrir-${c.id}`}</button>
      ))}
    </div>
  ),
}));

vi.mock("../../src/components/usuarios/FormularioContaAcesso", () => ({
  FORMULARIO_CONTA_ACESSO_ID: "formulario-conta-acesso",
  default: ({ onSubmit, initialData, readOnly, ehPropriaConta }) => (
    <div data-testid="formulario">
      <span data-testid="modo">{readOnly ? "consulta" : "edicao"}</span>
      <span data-testid="propria">{String(ehPropriaConta)}</span>
      <pre data-testid="ficha">{JSON.stringify(initialData ?? {})}</pre>
      <button type="button" onClick={() => onSubmit({ nova_senha: SENHA_NOVA, senha_atual: SENHA_ATUAL })}>
        enviar-propria-senha
      </button>
      <button type="button" onClick={() => onSubmit({ nova_senha: SENHA_NOVA })}>enviar-senha-outro</button>
      <button type="button" onClick={() => onSubmit({ nome: "Nome Novo" })}>enviar-nome</button>
    </div>
  ),
}));

const EU = { id: "u-eu", nome: "Eu Mesmo", login: "eu", email: "eu", ativo: true };
const OUTRO = { id: "u-outro", nome: "Outro", login: "outro", email: "outro", ativo: true };
const pagina = (items) => ({ items, next_cursor: null, has_more: false, total: items.length, limit: 100 });

const renderPagina = async () => {
  const { default: Usuarios } = await import("@/pages/Usuarios");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Usuarios />
    </QueryClientProvider>,
  );
  return queryClient;
};

/** Abre a conta, entra em edição e envia o formulário stub. */
const editarEEnviar = async (conta, botao) => {
  fireEvent.click(await screen.findByRole("button", { name: `abrir-${conta.id}` }));
  fireEvent.click(await screen.findByRole("button", { name: /^editar$/i }));
  await waitFor(() => expect(screen.getByTestId("modo")).toHaveTextContent("edicao"));
  fireEvent.click(screen.getByRole("button", { name: botao }));
};

/** Nada de credencial na ficha, nos caches do React Query nem nos toasts. */
const semCredencialRetida = (queryClient) => {
  const ficha = screen.queryByTestId("ficha")?.textContent ?? "";
  const queries = JSON.stringify(queryClient.getQueryCache().getAll().map((q) => q.state.data ?? null));
  const mutacoes = JSON.stringify(queryClient.getMutationCache().getAll().map((m) => m.state.variables ?? null));
  const toasts = JSON.stringify([...toastMock.success.mock.calls, ...toastMock.error.mock.calls]);
  for (const [onde, texto] of Object.entries({ ficha, queries, mutacoes, toasts })) {
    expect(texto, onde).not.toContain(SENHA_ATUAL);
    expect(texto, onde).not.toContain(SENHA_NOVA);
    expect(texto, onde).not.toMatch(/senha_atual|nova_senha|senha_hash/);
  }
};

beforeEach(() => {
  rede.atualizar.mockReset();
  rede.pagina.mockReset().mockResolvedValue(pagina([EU, OUTRO]));
  logoutMock.mockReset();
  currentUserMock.mockReset().mockResolvedValue({ login: "eu", email: "eu" });
  Object.values(toastMock).forEach((m) => m.mockReset());
});
afterEach(() => {
  cleanup();
  vi.resetModules();
});

describe("S04-P1-R1 — troca de senha encerra a sessão da própria conta", () => {
  it("1. própria senha confirmada → logout() uma vez, aviso de novo login, ficha sem credencial", async () => {
    /** @type {any[]} */
    const enviados = [];
    rede.atualizar.mockImplementation(async (id, dados) => {
      enviados.push([id, { ...dados }]); // cópia: o payload original é descartado depois
      return { ...EU };
    });
    const qc = await renderPagina();
    await editarEEnviar(EU, "enviar-propria-senha");
    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
    expect(enviados).toEqual([["u-eu", { nova_senha: SENHA_NOVA, senha_atual: SENHA_ATUAL }]]);
    // O objeto que o React Query guardou como variables foi esvaziado das credenciais.
    expect(rede.atualizar.mock.calls[0][1]).toEqual({});
    expect(toastMock.success).toHaveBeenCalledWith("Senha alterada. Entre novamente com a nova senha.");
    expect(screen.getByTestId("modo")).toHaveTextContent("consulta");
    semCredencialRetida(qc);
  });

  it("2. admin troca a senha de OUTRA conta → sem logout; credencial não fica na ficha, cache nem toast", async () => {
    rede.atualizar.mockResolvedValue({ ...OUTRO });
    const qc = await renderPagina();
    await editarEEnviar(OUTRO, "enviar-senha-outro");
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Conta atualizada!"));
    expect(logoutMock).not.toHaveBeenCalled();
    expect(JSON.parse(screen.getByTestId("ficha").textContent)).toMatchObject({ id: "u-outro", nome: "Outro" });
    semCredencialRetida(qc);
  });

  it("3. só o nome (própria ou de outra conta) → sem logout", async () => {
    rede.atualizar.mockImplementation(async (id, dados) => ({ ...(id === "u-eu" ? EU : OUTRO), ...dados }));
    await renderPagina();
    await editarEEnviar(EU, "enviar-nome");
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Conta atualizada!"));
    expect(JSON.parse(screen.getByTestId("ficha").textContent).nome).toBe("Nome Novo");
    cleanup();
    await renderPagina();
    await editarEEnviar(OUTRO, "enviar-nome");
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(2));
    expect(logoutMock).not.toHaveBeenCalled();
  });

  it.each([
    ["400 validação", new ApiError(API_ERROR_CODES.INVALID_ARGUMENT), false],
    ["403 senha atual errada", new ApiError(API_ERROR_CODES.USUARIO_SENHA_ATUAL_INVALIDA), false],
    ["409 conflito", new ApiError(API_ERROR_CODES.CONCURRENCY_CONFLICT), false],
    ["indisponível (rede/5xx)", new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE), true],
    ["erro desconhecido", new TypeError("Failed to fetch"), true],
  ])("4. falha %s na própria senha → sem sucesso, sem logout, sem credencial retida", async (_nome, erro, incerto) => {
    rede.atualizar.mockRejectedValue(erro);
    const qc = await renderPagina();
    await editarEEnviar(EU, "enviar-propria-senha");
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
    const msg = toastMock.error.mock.calls[0][0];
    if (incerto) expect(msg).toMatch(/Não foi possível confirmar a troca de senha/);
    else expect(msg).not.toMatch(/confirmar a troca/);
    semCredencialRetida(qc);
  });

  it("5. própria conta é decidida pelo ID autenticado: currentUser com login divergente ou ainda carregando não muda nada", async () => {
    currentUserMock.mockResolvedValue({ login: "login-divergente", email: "login-divergente" });
    rede.atualizar.mockResolvedValue({ ...EU });
    await renderPagina();
    fireEvent.click(await screen.findByRole("button", { name: "abrir-u-eu" }));
    expect(screen.getByTestId("propria")).toHaveTextContent("true");
    cleanup();
    await renderPagina();
    fireEvent.click(await screen.findByRole("button", { name: "abrir-u-outro" }));
    expect(screen.getByTestId("propria")).toHaveTextContent("false");
    cleanup();

    // currentUser nunca resolve: a decisão continua pelo ID e a troca própria encerra a sessão.
    currentUserMock.mockReturnValue(new Promise(() => {}));
    await renderPagina();
    await editarEEnviar(EU, "enviar-propria-senha");
    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));

    // Conta de outro com o MESMO login textual do currentUser: não é a própria.
    cleanup();
    logoutMock.mockReset();
    currentUserMock.mockResolvedValue({ login: "outro", email: "outro" });
    rede.atualizar.mockResolvedValue({ ...OUTRO });
    await renderPagina();
    await editarEEnviar(OUTRO, "enviar-senha-outro");
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Conta atualizada!"));
    expect(logoutMock).not.toHaveBeenCalled();
  });
});
