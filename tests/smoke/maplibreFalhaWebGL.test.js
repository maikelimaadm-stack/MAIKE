/**
 * Mapa sem WebGL: a mensagem técnica do MapLibre vira explicação em português.
 * Caso real (proprietário): aceleração gráfica desligada no navegador.
 */
import { describe, it, expect } from "vitest";
import {
  MENSAGEM_WEBGL_DESLIGADO,
  ehFalhaDeWebGL,
  mensagemFalhaMapa,
  navegadorTemWebGL,
} from "@/lib/maplibre/falhaWebGL";

const ERRO_REAL = JSON.stringify({
  requestedAttributes: { antialias: false, preserveDrawingBuffer: false, powerPreference: "high-performance" },
  statusMessage:
    "Could not create a WebGL context, VENDOR = 0xffff, DEVICE = 0xffff, GL_VENDOR = Disabled, GL_RENDERER = Disabled, Sandboxed = yes, Optimus = no, AMD switchable = no, Reset notification strategy = 0x0000, ErrorMessage = BindToCurrentSequence failed: .",
  type: "webglcontextcreationerror",
  message: "Failed to initialize WebGL",
});

describe("falhaWebGL", () => {
  it("o erro real (JSON do MapLibre) vira a explicação, nunca o JSON", () => {
    const erro = new Error(ERRO_REAL);
    expect(ehFalhaDeWebGL(erro)).toBe(true);
    const msg = mensagemFalhaMapa(erro);
    expect(msg).toBe(MENSAGEM_WEBGL_DESLIGADO);
    expect(msg).not.toMatch(/[{}]|GL_VENDOR|0xffff/);
    expect(msg).toMatch(/aceleração gráfica/);
    expect(msg).toMatch(/chrome:\/\/settings\/system/);
  });

  it("evento webglcontextcreationerror e mensagens curtas também são reconhecidos", () => {
    expect(ehFalhaDeWebGL({ type: "webglcontextcreationerror", message: "Failed to initialize WebGL" })).toBe(true);
    expect(ehFalhaDeWebGL(new Error("WebGL indisponível"))).toBe(true);
  });

  it("outras falhas mantêm a mensagem; JSON ou vazio caem no texto padrão", () => {
    expect(mensagemFalhaMapa(new Error("container ausente"))).toBe("container ausente");
    expect(mensagemFalhaMapa(new Error('{"x":1}'), "Falha ao criar o mapa.")).toBe("Falha ao criar o mapa.");
    expect(mensagemFalhaMapa(null, "Falha ao criar o mapa.")).toBe("Falha ao criar o mapa.");
  });

  it("detecta WebGL: contexto disponível → true (e é liberado); ausente ou exceção → false", () => {
    let liberado = false;
    const gl = { getExtension: () => ({ loseContext: () => { liberado = true; } }) };
    const comGL = { createElement: () => ({ getContext: (t) => (t === "webgl2" ? gl : null) }) };
    const semGL = { createElement: () => ({ getContext: () => null }) };
    const quebrado = { createElement: () => { throw new Error("x"); } };
    const antes = globalThis.WebGLRenderingContext;
    globalThis.WebGLRenderingContext = function WebGLRenderingContext() {};
    try {
      expect(navegadorTemWebGL(/** @type {any} */ (comGL))).toBe(true);
      expect(liberado).toBe(true);
      expect(navegadorTemWebGL(/** @type {any} */ (semGL))).toBe(false);
      expect(navegadorTemWebGL(/** @type {any} */ (quebrado))).toBe(false);
    } finally {
      globalThis.WebGLRenderingContext = antes;
    }
    expect(navegadorTemWebGL(/** @type {any} */ (comGL))).toBe(antes === undefined ? false : true);
  });
});
