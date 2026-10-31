/**
 * D-PROD-90 R1 — fronteira da gravação: timeout próprio e o que cada falha prova.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const API = "https://backend.exemplo.invalido";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_MAIKE_API_URL", API);
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("timeout por pedido", () => {
  it("o padrão global (20 s) continua; a gravação da importação espera 75 s antes de desistir", async () => {
    vi.useFakeTimers();
    const sinais = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => {
        sinais.push(init.signal);
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new DOMException("abort", "AbortError")));
        });
      })
    );
    const { setNativeToken } = await import("@/lib/auth/nativeTokenStorage");
    setNativeToken("jwt.teste");
    const { nativeRequest } = await import("@/apis/_core/nativeHttpClient.js");
    const { importarAreasNativa, TIMEOUT_GRAVACAO_MS } = await import("@/apis/areas/areaImportacaoNativePort.js");
    expect(TIMEOUT_GRAVACAO_MS).toBe(75000);

    const comum = nativeRequest("/setores", { autenticado: true }, { operation: "x", resource: "Setor" }).catch((e) => e);
    const gravacao = importarAreasNativa({ operationId: "imp-12345678", empresaId: "e1", itens: [{ ref: "f1", coords: [] }] }).catch((e) => e);

    await vi.advanceTimersByTimeAsync(20001);
    expect(sinais[0].aborted).toBe(true);
    expect(sinais[1].aborted).toBe(false);
    expect((await comum).code).toBe("API_PROVIDER_UNAVAILABLE");

    await vi.advanceTimersByTimeAsync(55000);
    expect(sinais[1].aborted).toBe(true);
    expect((await gravacao).code).toBe("API_PROVIDER_UNAVAILABLE");
  });
});

describe("classificação da falha de gravação", () => {
  it("recusa conclusiva × não processada × ambígua", async () => {
    const { classificarFalhaDeGravacao, respostaDeGravacaoValida } = await import("@/services/areaImportacaoService");
    const { ApiError, API_ERROR_CODES: C } = await import("@/apis/_core/ApiError");
    const de = (codigo) => classificarFalhaDeGravacao(new ApiError(codigo));
    for (const c of [C.AREA_IMPORT_VALIDATION_FAILED, C.AREA_IMPORT_LIMIT_EXCEEDED, C.INVALID_ARGUMENT, C.IDEMPOTENCY_CONFLICT, C.EMPRESA_NOT_FOUND]) {
      expect(de(c), c).toBe("recusada");
    }
    expect(de(C.TENANT_CONTEXT_REQUIRED)).toBe("nao_processada");
    for (const c of [C.PROVIDER_UNAVAILABLE, C.OPERATION_FAILED, C.IDEMPOTENCY_IN_PROGRESS, C.CONCURRENCY_CONFLICT, C.AUDIT_WRITE_FAILED]) {
      expect(de(c), c).toBe("ambigua");
    }
    expect(classificarFalhaDeGravacao(new TypeError("Failed to fetch"))).toBe("ambigua");
    expect(classificarFalhaDeGravacao(undefined)).toBe("ambigua");

    const itens = [{ ref: "f1" }, { ref: "f2" }];
    expect(respostaDeGravacaoValida({ importadas: [{ ref: "f1", id: "a" }, { ref: "f2", id: "b" }] }, itens)).toBe(true);
    expect(respostaDeGravacaoValida({ importadas: [] }, itens)).toBe(false);
    expect(respostaDeGravacaoValida({ importadas: [{ ref: "f1", id: "a" }, { ref: "f9", id: "b" }] }, itens)).toBe(false);
    expect(respostaDeGravacaoValida(null, itens)).toBe(false);
    expect(respostaDeGravacaoValida("", itens)).toBe(false);
  });

  it("502 e 504 da borda viram indisponibilidade (logo, resultado ambíguo), nunca recusa", async () => {
    const { setNativeToken } = await import("@/lib/auth/nativeTokenStorage");
    setNativeToken("jwt.teste");
    const { classificarFalhaDeGravacao } = await import("@/services/areaImportacaoService");
    for (const status of [502, 504]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, text: async () => "<html>gateway</html>" }));
      const { importarAreasNativa } = await import("@/apis/areas/areaImportacaoNativePort.js");
      const erro = await importarAreasNativa({ operationId: "imp-12345678", empresaId: "e1", itens: [{ ref: "f1", coords: [] }] }).catch((e) => e);
      expect(classificarFalhaDeGravacao(erro), String(status)).toBe("ambigua");
    }
  });

  it("500 com código desconhecido e corpo ilegível → ambíguo", async () => {
    const { setNativeToken } = await import("@/lib/auth/nativeTokenStorage");
    setNativeToken("jwt.teste");
    const { classificarFalhaDeGravacao } = await import("@/services/areaImportacaoService");
    const { importarAreasNativa } = await import("@/apis/areas/areaImportacaoNativePort.js");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "{nao-json" }));
    const e1 = await importarAreasNativa({ operationId: "imp-12345678", empresaId: "e1", itens: [{ ref: "f1", coords: [] }] }).catch((e) => e);
    expect(classificarFalhaDeGravacao(e1)).toBe("ambigua");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 418, text: async () => JSON.stringify({ code: "ALGO_NOVO" }) }));
    const e2 = await importarAreasNativa({ operationId: "imp-12345678", empresaId: "e1", itens: [{ ref: "f1", coords: [] }] }).catch((e) => e);
    expect(classificarFalhaDeGravacao(e2)).toBe("ambigua");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 201, text: async () => { throw new TypeError("corpo cortado"); } }));
    const e3 = await importarAreasNativa({ operationId: "imp-12345678", empresaId: "e1", itens: [{ ref: "f1", coords: [] }] }).catch((e) => e);
    expect(classificarFalhaDeGravacao(e3)).toBe("ambigua");
  });
});
