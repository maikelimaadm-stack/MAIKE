/**
 * D-PROD-381 — o canal de teste do app: o proprietário instala o APK de teste UMA vez e cada ajuste chega nele pela
 * atualização de teste, antes do PR e do merge.
 *
 *  CT-01. O canal: oficial por padrão; "teste" só com VITE_CANAL_APP=teste; o endereço das atualizações de teste só
 *         em https.
 *  CT-02. No canal de teste, a atualização vem do `ultima.json` da Release de teste (HTTP nativo, sem CORS), nunca do
 *         servidor oficial; o pacote é baixado do endereço completo que o `ultima.json` dá.
 *  CT-03. No canal oficial nada muda (o servidor), e o canal de teste sem endereço não confere nada.
 *  CT-04. O selo "TESTE" só no canal de teste.
 *  CT-05. O workflow `app-teste`: só à mão (nunca no push nem na PR), publica na Release de pré-lançamento
 *         `app-teste`, o pacote com o canal de teste, o zip antes do `ultima.json`, o APK com a chave fixa do oficial.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const plugin = {
  download: vi.fn(async ({ version }) => ({ id: `id-${version}` })),
  next: vi.fn(async () => ({})),
  notifyAppReady: vi.fn(async () => ({})),
  set: vi.fn(async () => ({})),
};
const app = { getInfo: vi.fn(async () => ({ build: "10" })), addListener: vi.fn(async () => ({})) };
const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@capgo/capacitor-updater", () => ({ CapacitorUpdater: plugin }));
vi.mock("@capacitor/app", () => ({ App: app }));
vi.mock("@capacitor/core", async (orig) => ({ ...(/** @type {any} */ (await orig())), CapacitorHttp: http }));

const ORIGEM = "https://servidor.exemplo.invalido";
const TESTE = "https://github.com/dono/repo/releases/download/app-teste/ultima.json";

const carregar = async (env = {}) => {
  vi.resetModules();
  vi.stubEnv("VITE_MAIKE_API_URL", ORIGEM);
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  /** @type {any} */ (window).Capacitor = { isNativePlatform: () => true };
  return import("@/lib/app/atualizacaoAutomatica");
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  /** @type {any} */ (window).Capacitor = undefined;
});

describe("CT-01 — o canal do app", () => {
  it("oficial por padrão; teste só com VITE_CANAL_APP=teste; o endereço só em https", async () => {
    vi.resetModules();
    let m = await import("@/lib/app/canalDoApp");
    expect(m.canalDoApp()).toBe("oficial");
    expect(m.urlDasAtualizacoesDeTeste()).toBeNull();
    vi.stubEnv("VITE_CANAL_APP", "teste");
    vi.stubEnv("VITE_CANAL_TESTE_URL", TESTE);
    vi.resetModules();
    m = await import("@/lib/app/canalDoApp");
    expect(m.canalDoApp()).toBe("teste");
    expect(m.urlDasAtualizacoesDeTeste()).toBe(TESTE);
    vi.stubEnv("VITE_CANAL_TESTE_URL", "http://inseguro/ultima.json");
    vi.resetModules();
    m = await import("@/lib/app/canalDoApp");
    expect(m.urlDasAtualizacoesDeTeste()).toBeNull();
  });
});

describe("CT-02 — no canal de teste, a atualização de teste", () => {
  it("lê o ultima.json da Release de teste pelo HTTP nativo e baixa o pacote do endereço completo", async () => {
    const zip = "https://github.com/dono/repo/releases/download/app-teste/teste-abc-7.zip";
    http.get.mockResolvedValue({ status: 200, data: JSON.stringify({ versao: "teste-abc-7", url: zip, checksum: "f00", nativoMinimo: 5 }) });
    const fetch = vi.fn(async (url) => (url === "/app-versao.json" ? { ok: true, json: async () => ({ versao: "teste-abc-6" }) } : { ok: false }));
    vi.stubGlobal("fetch", fetch);
    const { conferirAtualizacao } = await carregar({ VITE_CANAL_APP: "teste", VITE_CANAL_TESTE_URL: TESTE });
    expect(await conferirAtualizacao()).toBe("baixada");
    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get.mock.calls[0][0].url.startsWith(`${TESTE}?t=`)).toBe(true);
    expect(http.get.mock.calls[0][0].responseType).toBe("text");
    // nunca o servidor oficial
    expect(fetch.mock.calls.map(([u]) => u)).not.toContain(`${ORIGEM}/app-atualizacao/ultima.json`);
    expect(plugin.download).toHaveBeenCalledWith({ url: zip, version: "teste-abc-7", checksum: "f00" });
    expect(plugin.next).toHaveBeenCalledWith({ id: "id-teste-abc-7" });
  });

  it("a mesma versão de teste: não baixa; a Release fora do ar: falhou (tenta de novo depois)", async () => {
    http.get.mockResolvedValue({ status: 200, data: { versao: "teste-abc-7", url: "https://x/y.zip" } });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ versao: "teste-abc-7" }) })));
    const { conferirAtualizacao } = await carregar({ VITE_CANAL_APP: "teste", VITE_CANAL_TESTE_URL: TESTE });
    expect(await conferirAtualizacao()).toBe("atual");
    http.get.mockResolvedValue({ status: 404, data: "" });
    expect(await conferirAtualizacao()).toBe("falhou");
    expect(plugin.download).not.toHaveBeenCalled();
  });
});

describe("CT-03 — o canal oficial não muda", () => {
  it("oficial: o servidor, sem HTTP nativo; teste sem endereço: não confere", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (url === "/app-versao.json") return { ok: true, json: async () => ({ versao: "v1" }) };
        if (url === `${ORIGEM}/app-atualizacao/ultima.json`) return { ok: true, json: async () => ({ versao: "v2", url: "/app-atualizacao/v2.zip", nativoMinimo: 5 }) };
        return { ok: false };
      })
    );
    let m = await carregar();
    expect(await m.conferirAtualizacao()).toBe("baixada");
    expect(plugin.download).toHaveBeenCalledWith({ url: `${ORIGEM}/app-atualizacao/v2.zip`, version: "v2", checksum: undefined });
    expect(http.get).not.toHaveBeenCalled();

    m = await carregar({ VITE_CANAL_APP: "teste" });
    expect(await m.conferirAtualizacao()).toBe("atual");
    expect(http.get).not.toHaveBeenCalled();
  });
});

describe("CT-04 — o selo TESTE", () => {
  it("só no canal de teste", async () => {
    vi.resetModules();
    let { default: Selo } = await import("@/components/app/SeloDeTeste");
    const fora = render(<Selo />);
    expect(fora.queryByTestId("selo-de-teste")).toBeNull();
    fora.unmount();
    vi.stubEnv("VITE_CANAL_APP", "teste");
    vi.resetModules();
    ({ default: Selo } = await import("@/components/app/SeloDeTeste"));
    const dentro = render(<Selo />);
    expect(dentro.getByTestId("selo-de-teste")).toHaveTextContent("TESTE");
    expect(dentro.getByTestId("selo-de-teste").style.pointerEvents).toBe("none");
  });

  it("o App mostra o selo", () => {
    expect(readFileSync("src/App.jsx", "utf8")).toContain("<SeloDeTeste />");
  });
});

describe("CT-05 — o workflow app-teste", () => {
  const wf = readFileSync(".github/workflows/app-teste.yml", "utf8");
  const oficial = readFileSync(".github/workflows/app-android.yml", "utf8");

  it("só à mão: nunca no push nem na PR", () => {
    expect(wf).toMatch(/on:\s*\n\s*workflow_dispatch:/);
    expect(wf).not.toMatch(/^\s*push:/m);
    expect(wf).not.toMatch(/^\s*pull_request:/m);
  });

  it("o pacote do canal de teste, na Release de pré-lançamento app-teste; o zip antes do ultima.json", () => {
    expect(wf).toContain("VITE_CANAL_APP: teste");
    expect(wf).toContain("VITE_CANAL_TESTE_URL: https://github.com/${{ github.repository }}/releases/download/app-teste/ultima.json");
    expect(wf).toContain("RELEASE: app-teste");
    expect(wf).toContain("--prerelease");
    expect(wf.indexOf("saida-teste/*.zip --clobber")).toBeLessThan(wf.indexOf("saida-teste/ultima.json --clobber"));
    // a versão de teste nunca é igual a uma oficial (o commit curto, sozinho)
    expect(wf).toMatch(/versao="teste-/);
  });

  it("o APK de teste: o mesmo pacote e a chave fixa do oficial", () => {
    const certificado = /CERTIFICADO_SHA256: '([0-9a-f]{64})'/.exec(oficial)?.[1];
    expect(certificado).toBeTruthy();
    expect(wf).toContain(`CERTIFICADO_SHA256: '${certificado}'`);
    expect(wf).toContain("rm -rf dist && mv dist-app dist");
    expect(wf).toContain("PACOTE_MANTER_APP: '1'");
  });

  it("o gerador do pacote aceita a pasta, o endereço e a versão do canal de teste", () => {
    const pacote = readFileSync("scripts/app/pacote-atualizacao.mjs", "utf8");
    for (const v of ["PACOTE_PUBLICACAO", "PACOTE_URL_BASE", "PACOTE_VERSAO", "PACOTE_MANTER_APP"]) expect(pacote).toContain(`process.env.${v}`);
  });
});
