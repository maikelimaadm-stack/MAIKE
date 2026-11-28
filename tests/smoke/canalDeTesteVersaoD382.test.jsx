/**
 * D-PROD-382 — o APK de teste roda mesmo o pacote de teste:
 *
 *  CT382-1. O workflow `app-teste` dá ao APK de teste um número de versão próprio (o do oficial + 1, nome "-teste"),
 *           ANTES do build do Android. Com o mesmo número do oficial, o atualizador não percebe a troca de APK e segue
 *           rodando o pacote que já estava no celular (o oficial, que nunca lê o canal de teste).
 *  CT382-2. O selo mostra o número da atualização de teste em uso ("TESTE 3").
 */
import React from "react";
import { readFileSync } from "node:fs";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("CT382-1 — número de versão próprio do APK de teste", () => {
  const wf = readFileSync(".github/workflows/app-teste.yml", "utf8");
  const passoApk = wf.slice(wf.indexOf("- name: APK de teste"), wf.indexOf("- name: Publicar no canal de teste"));

  it("sobe o versionCode (+1) e marca o nome, antes do cap sync e do gradle", () => {
    expect(passoApk).toMatch(/v\.versionCode=Number\(v\.versionCode\)\+1/);
    expect(passoApk).toContain('v.versionName=v.versionName+"-teste"');
    const sobe = passoApk.indexOf("versionCode=Number");
    expect(sobe).toBeGreaterThan(-1);
    expect(sobe).toBeLessThan(passoApk.indexOf("npx cap sync android"));
    expect(sobe).toBeLessThan(passoApk.indexOf("assembleRelease"));
  });

  it("o pacote de teste é gerado antes (o nativoMinimo dele continua o do oficial)", () => {
    expect(wf.indexOf("node scripts/app/pacote-atualizacao.mjs")).toBeLessThan(wf.indexOf("versionCode=Number"));
  });

  it("o atualizador do app só reinicia o pacote quando o APK muda de número", () => {
    const cfg = JSON.parse(readFileSync("capacitor.config.json", "utf8"));
    expect(cfg.plugins.CapacitorUpdater.resetWhenUpdate).toBe(true);
  });
});

describe("CT382-2 — o selo com o número do teste", () => {
  it("lê o número do fim da versão de teste", async () => {
    const { numeroDoTeste } = await import("@/components/app/SeloDeTeste");
    expect(numeroDoTeste("teste-9d8cff0baf52-2")).toBe("2");
    expect(numeroDoTeste("abc1234")).toBeNull();
    expect(numeroDoTeste(undefined)).toBeNull();
  });

  it("no canal de teste, mostra 'TESTE <número>'", async () => {
    vi.stubEnv("VITE_CANAL_APP", "teste");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ versao: "teste-9d8cff0baf52-7" }) })));
    vi.resetModules();
    const { default: Selo } = await import("@/components/app/SeloDeTeste");
    const r = render(<Selo />);
    await waitFor(() => expect(r.getByTestId("selo-de-teste")).toHaveTextContent("TESTE 7"));
  });
});
