/**
 * MAIKE-SAAS-ADMIN-S04-P1-R2 — HTTP 500 na troca da própria senha.
 *
 * Cadeia REAL até o fetch: `atualizarContaAcesso` → porta nativa de usuários →
 * `nativeRequest` (normalização de erro). Só o `fetch` é falso, sem servidor
 * nem segredo real. Prova que um 500 `{code:'INTERNAL_ERROR'}` vira
 * `API_OPERATION_FAILED` e é tratado como RESULTADO NÃO CONFIRMADO; que
 * rejeições contratuais continuam rejeição; que o transporte não repete o
 * PATCH; e que o formulário real limpa os campos de senha ao enviar.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const API = "https://backend.exemplo.invalido";
const SENHA_ATUAL = "Senha-Atual-Transporte-1";
const SENHA_NOVA = "Senha-Nova-Transporte-2";

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("VITE_MAIKE_API_URL", API);
  window.sessionStorage.clear();
  window.localStorage.clear();
  const { setNativeToken } = await import("@/lib/auth/nativeTokenStorage");
  setNativeToken("token-de-teste");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** fetch falso: uma resposta (status, corpo bruto) ou uma rejeição de rede. */
const fetchQueResponde = (status, corpo) =>
  vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    text: async () => corpo,
  }));

const trocarPropriaSenha = async () => {
  const servico = await import("@/services/usuarioAdminService");
  const { API_ERROR_CODES, isApiError } = await import("@/apis/_core/ApiError");
  let erro = null;
  try {
    await servico.atualizarContaAcesso("u-eu", { nova_senha: SENHA_NOVA, senha_atual: SENHA_ATUAL });
  } catch (e) {
    erro = e;
  }
  return { erro, servico, API_ERROR_CODES, isApiError };
};

describe("S04-P1-R2 — transporte real: 500 é resultado não confirmado", () => {
  it.each([
    ["500 {code: INTERNAL_ERROR}", 500, JSON.stringify({ code: "INTERNAL_ERROR", message: "falhou", request_id: "r-1" }), "OPERATION_FAILED", true],
    ["500 sem corpo JSON", 500, "<html>erro</html>", "OPERATION_FAILED", true],
    ["502", 502, "", "PROVIDER_UNAVAILABLE", true],
    ["503", 503, "", "PROVIDER_UNAVAILABLE", true],
    ["504", 504, "", "PROVIDER_UNAVAILABLE", true],
    ["400 REQUEST_VALIDATION_FAILED", 400, JSON.stringify({ code: "REQUEST_VALIDATION_FAILED", message: "x" }), "INVALID_ARGUMENT", false],
    ["403 USUARIO_SENHA_ATUAL_INVALIDA", 403, JSON.stringify({ code: "USUARIO_SENHA_ATUAL_INVALIDA", message: "x" }), "USUARIO_SENHA_ATUAL_INVALIDA", false],
    ["409 CONCURRENCY_CONFLICT", 409, JSON.stringify({ code: "CONCURRENCY_CONFLICT", message: "x" }), "CONCURRENCY_CONFLICT", false],
  ])("%s → código normalizado e classificação", async (_nome, status, corpo, codigo, incerto) => {
    const fetch = fetchQueResponde(status, corpo);
    vi.stubGlobal("fetch", fetch);
    const { erro, servico, API_ERROR_CODES, isApiError } = await trocarPropriaSenha();
    expect(isApiError(erro)).toBe(true);
    expect(erro.code).toBe(API_ERROR_CODES[codigo]);
    expect(servico.resultadoIncerto(erro)).toBe(incerto);
    expect(fetch, "zero retries no transporte").toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url).startsWith(API)).toBe(true);
    expect(new URL(String(url)).pathname.endsWith("/usuarios/u-eu")).toBe(true);
    expect(init.method).toBe("PATCH");
    // A mensagem pública e o contexto exibível nunca carregam a senha nem texto cru do servidor.
    const exibivel = JSON.stringify({ m: erro.message, d: erro.details });
    expect(exibivel).not.toContain(SENHA_NOVA);
    expect(exibivel).not.toContain(SENHA_ATUAL);
    expect(erro.message).not.toContain("falhou");
  });

  it("falha de rede (fetch rejeita) → PROVIDER_UNAVAILABLE, incerto, sem retry", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetch);
    const { erro, servico, API_ERROR_CODES } = await trocarPropriaSenha();
    expect(erro.code).toBe(API_ERROR_CODES.PROVIDER_UNAVAILABLE);
    expect(servico.resultadoIncerto(erro)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("o ajuste é local: retryable global continua só em PROVIDER_UNAVAILABLE", async () => {
    const { ApiError, API_ERROR_CODES } = await import("@/apis/_core/ApiError");
    expect(new ApiError(API_ERROR_CODES.OPERATION_FAILED).retryable).toBe(false);
    expect(new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE).retryable).toBe(true);
  });
});

describe("S04-P1-R2 — formulário real limpa as entradas de senha ao enviar", () => {
  it("própria conta: envia senha atual e nova; depois do envio os campos ficam vazios no DOM", async () => {
    const { default: FormularioContaAcesso } = await import("@/components/usuarios/FormularioContaAcesso");
    const onSubmit = vi.fn();
    render(
      <FormularioContaAcesso
        initialData={{ id: "u-eu", nome: "Eu Mesmo", login: "eu", ativo: true }}
        ehPropriaConta
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Nova senha/i), { target: { value: SENHA_NOVA } });
    fireEvent.change(screen.getByLabelText(/Senha atual/i), { target: { value: SENHA_ATUAL } });
    fireEvent.submit(screen.getByRole("button", { name: "Salvar conta" }).closest("form"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ nova_senha: SENHA_NOVA, senha_atual: SENHA_ATUAL });
    expect(screen.getByLabelText(/Nova senha/i).value).toBe("");
    expect(document.body.innerHTML).not.toContain(SENHA_NOVA);
    expect(document.body.innerHTML).not.toContain(SENHA_ATUAL);
  });
});
