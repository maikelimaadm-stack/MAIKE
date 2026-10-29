/**
 * SCALE-01 — tela /Usuarios paginada no servidor (keyset).
 *
 * Prova que a tela consome `GET /usuarios/page` via `listarContasAcessoPagina`:
 * página 1, "carregar mais" com cursor, busca `q` enviada ao servidor (acha
 * conta que não está na janela carregada), DOM limitado à página e sessão de
 * outro cliente sem reaproveitar cache do anterior.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const paginaMock = vi.fn();
const listarLegadoMock = vi.fn();
const authAtual = { clienteId: "cliente-a", user: { id: "u-a" } };

vi.mock("@/services/usuarioAdminService", () => ({
  listarContasAcessoPagina: (...a) => paginaMock(...a),
  listarContasAcesso: (...a) => listarLegadoMock(...a),
  criarContaAcesso: vi.fn(),
  atualizarContaAcesso: vi.fn(),
  validarPatchContaAcesso: vi.fn(),
}));

vi.mock("@/services/sessionService", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, getCurrentUser: vi.fn(async () => ({ login: "admin" })) };
});

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => authAtual,
}));

const conta = (prefixo, i) => ({
  id: `${prefixo}-${String(i).padStart(4, "0")}`,
  login: `${prefixo}.login.${i}`,
  email: `${prefixo}.login.${i}`,
  nome: `${prefixo} Conta ${i}`,
  ativo: true,
});

/** Simula o backend: 250 contas por cliente, páginas de `limit`, busca no servidor. */
const backendFalso = (prefixo) => {
  const todas = Array.from({ length: 250 }, (_, i) => conta(prefixo, 250 - i));
  return ({ limit = 100, cursor, q }) => {
    const base = q
      ? todas.filter((c) => `${c.nome} ${c.login}`.toLowerCase().includes(q.toLowerCase()))
      : todas;
    const inicio = cursor ? Number(cursor) : 0;
    const items = base.slice(inicio, inicio + limit);
    const fim = inicio + items.length;
    return Promise.resolve({
      items,
      next_cursor: fim < base.length ? String(fim) : null,
      has_more: fim < base.length,
      total: cursor ? null : base.length,
      limit,
    });
  };
};

/** Métricas do rodapé Base1 (`.mg-summary__item`: "Listados: N", "Totais: M"). */
const rodape = () => {
  const itens = [...document.querySelectorAll(".mg-summary__item")].map((e) => e.textContent || "");
  const num = (rotulo) => {
    const item = itens.find((t) => t.startsWith(`${rotulo}:`));
    return item ? Number(item.slice(rotulo.length + 1).trim()) : null;
  };
  return { listados: num("Listados"), totais: num("Totais") };
};

/** Campo de busca: abre a pílula se a toolbar estiver recolhida. */
const campoBusca = () => {
  const campos = screen.queryAllByPlaceholderText("Buscar contas…");
  if (campos.length) return campos[0];
  fireEvent.click(screen.getAllByLabelText("Abrir pesquisa")[0]);
  return screen.getAllByPlaceholderText("Buscar contas…")[0];
};

function wrap(ui, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { qc, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
}

beforeEach(() => {
  cleanup();
  paginaMock.mockReset();
  listarLegadoMock.mockReset();
  authAtual.clienteId = "cliente-a";
  authAtual.user = { id: "u-a" };
});

describe("SCALE-01 — /Usuarios paginado no servidor", () => {
  it("carrega só a primeira página e nunca chama a lista completa legada", async () => {
    paginaMock.mockImplementation(backendFalso("A"));
    const { default: Usuarios } = await import("@/pages/Usuarios");
    wrap(<Usuarios />);

    await waitFor(() => expect(paginaMock).toHaveBeenCalled());
    const [primeira] = paginaMock.mock.calls[0];
    expect(primeira.cursor ?? null).toBeNull();
    expect(primeira.limit).toBeGreaterThan(0);
    expect(primeira.limit).toBeLessThanOrEqual(500);

    // Janela = 1 página (100), total exato do servidor (250): não houve full-fetch.
    await waitFor(() => expect(rodape()).toEqual({ listados: 100, totais: 250 }));
    expect(paginaMock).toHaveBeenCalledTimes(1);
    expect(listarLegadoMock).not.toHaveBeenCalled();
  });

  it("'carregar mais' pede a próxima página com o cursor do servidor", async () => {
    paginaMock.mockImplementation(backendFalso("A"));
    const { default: Usuarios } = await import("@/pages/Usuarios");
    wrap(<Usuarios />);
    await waitFor(() => expect(rodape().listados).toBe(100));

    const botoes = await screen.findAllByLabelText("Carregar mais registros");
    fireEvent.click(botoes[0]);

    await waitFor(() =>
      expect(paginaMock.mock.calls.some(([a]) => typeof a.cursor === "string" && a.cursor)).toBe(true),
    );
    const comCursor = paginaMock.mock.calls.find(([a]) => a.cursor)[0];
    expect(comCursor.cursor).toBe(String(comCursor.limit));
    // Total continua o da página 0 (página 2 devolve total null).
    await waitFor(() => expect(rodape()).toEqual({ listados: 200, totais: 250 }));
  });

  it("busca aplicada vai ao servidor e encontra conta fora da janela carregada", async () => {
    paginaMock.mockImplementation(backendFalso("A"));
    const { default: Usuarios } = await import("@/pages/Usuarios");
    wrap(<Usuarios />);
    await waitFor(() => expect(rodape().listados).toBe(100));

    // "A Conta 37" está na 3ª página do servidor — fora da janela carregada.
    const campo = campoBusca();
    fireEvent.change(campo, { target: { value: "login.37" } });
    fireEvent.keyDown(campo, { key: "Enter" });

    await waitFor(() => expect(paginaMock.mock.calls.some(([a]) => a.q === "login.37")).toBe(true));
    expect(await screen.findByText("A Conta 37")).toBeTruthy();
    expect(rodape().totais).toBe(1);
  });

  it("troca de cliente não reaproveita dados do cliente anterior", async () => {
    paginaMock.mockImplementation(backendFalso("A"));
    const { default: Usuarios } = await import("@/pages/Usuarios");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = wrap(<Usuarios />, qc);
    await waitFor(() => expect(rodape().totais).toBe(250));
    unmount();

    authAtual.clienteId = "cliente-b";
    authAtual.user = { id: "u-b" };
    const backendB = backendFalso("B");
    paginaMock.mockImplementation((args) =>
      backendB(args).then((p) => ({ ...p, items: p.items.slice(0, 1), has_more: false, total: 1 })),
    );
    wrap(<Usuarios />, qc);

    expect(await screen.findByText("B Conta 250")).toBeTruthy();
    expect(screen.queryByText(/^A Conta/)).toBeNull();
    await waitFor(() => expect(rodape().totais).toBe(1));
    const chaves = qc.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey));
    expect(chaves.some((k) => k.includes("cliente-a"))).toBe(true);
    expect(chaves.some((k) => k.includes("cliente-b"))).toBe(true);
  });
});
