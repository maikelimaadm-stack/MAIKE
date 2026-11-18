/**
 * G4 — porta de áreas: "Reatribuir códigos" e PATCH vazio.
 *
 *  - `updateArea(id, { numero_area })` não manda mais um PATCH vazio (400):
 *    segue por `POST /areas-pastagem/renumerar`;
 *  - `renumerarAreas` manda a seleção inteira numa operação só (troca 1↔2);
 *  - `operacoesNativas.update` com corpo vazio não vai à rede: no replay da
 *    fila offline, um `{ numero_area }` antigo não trava as pendências.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const API = "https://backend.exemplo.invalido";

const respostaJson = (corpo, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } }));

let chamadas;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("VITE_MAIKE_API_URL", API);
  window.sessionStorage.clear();
  chamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url, init) => {
      const corpo = init?.body ? JSON.parse(init.body) : undefined;
      chamadas.push({ url: String(url), method: init?.method || "GET", corpo });
      if (String(url).endsWith("/areas-pastagem/renumerar")) {
        return respostaJson({ itens: corpo.itens.map((i) => ({ id: i.id, numero_area: i.numero_area, nome: `A-${i.id}` })) });
      }
      return respostaJson({ id: "a1", nome: "PASTO", ...corpo });
    })
  );
  const { setNativeToken } = await import("@/lib/auth/nativeTokenStorage");
  setNativeToken("jwt.teste");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("G4 — reatribuir códigos de área", () => {
  it("updateArea com numero_area usa a renumeração do servidor, não um PATCH vazio", async () => {
    const { updateArea } = await import("@/apis/areas");
    const area = await updateArea("a1", { numero_area: 7 });

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].method).toBe("POST");
    expect(chamadas[0].url.endsWith("/areas-pastagem/renumerar")).toBe(true);
    expect(chamadas[0].corpo).toEqual({ itens: [{ id: "a1", numero_area: "7" }] });
    expect(area.numero_area).toBe("7");
  });

  it("numero_area junto com outro campo: renumera e o PATCH leva só o resto", async () => {
    const { updateArea } = await import("@/apis/areas");
    await updateArea("a1", { numero_area: "3", cor: "#fff" });

    expect(chamadas.map((c) => `${c.method} ${c.url.replace(/^.*(\/areas-pastagem)/, "$1")}`)).toEqual([
      "POST /areas-pastagem/renumerar",
      "PATCH /areas-pastagem/a1",
    ]);
    expect(chamadas[1].corpo).toEqual({ cor: "#fff" });
  });

  it("renumerarAreas manda a seleção inteira numa operação (troca 1↔2)", async () => {
    const { renumerarAreas } = await import("@/apis/areas");
    const itens = await renumerarAreas([
      { id: "a1", numero_area: "2" },
      { id: "a2", numero_area: "1" },
    ]);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].corpo).toEqual({ itens: [{ id: "a1", numero_area: "2" }, { id: "a2", numero_area: "1" }] });
    expect(itens.map((a) => a.numero_area)).toEqual(["2", "1"]);
  });

  it("dados sem nenhum campo gravável são recusados antes da rede e da fila", async () => {
    const { updateArea } = await import("@/apis/areas");
    const erro = await updateArea("a1", { setor_nome: "X", created_date: "y" }).catch((e) => e);
    expect(erro.code).toBe("API_INVALID_ARGUMENT");
    expect(chamadas).toHaveLength(0);
  });
});

describe("G4 — PATCH vazio não trava o replay offline", () => {
  it("operacoesNativas.update sem campo gravável não chama a rede e confirma o id", async () => {
    const { operacoesNativas } = await import("@/apis/areas/areaPastagemNativePort.js");
    const resultado = await operacoesNativas.update("a1", { numero_area: "9" });
    expect(resultado).toEqual({ id: "a1" });
    expect(chamadas).toHaveLength(0);
  });

  it("com campo gravável o PATCH segue normalmente", async () => {
    const { operacoesNativas } = await import("@/apis/areas/areaPastagemNativePort.js");
    await operacoesNativas.update("a1", { nome: "PASTO 9", numero_area: "9" });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].method).toBe("PATCH");
    expect(chamadas[0].corpo).toEqual({ nome: "PASTO 9" });
  });
});
