/**
 * D-PROD-373 — o mapa nativo do Google avisa a câmera a cada quadro (`onCameraMove`), para os ícones do Mapa Geral
 * andarem junto com o mapa no app. O plugin `@capacitor/google-maps` só avisava o começo e o fim do movimento; o
 * remendo `scripts/app/remendar-google-maps.mjs` roda no `postinstall` (antes do build do APK).
 *
 *  G373-1. O plugin instalado já está remendado (o `postinstall` rodou e os pontos de remendo existem).
 *  G373-2. O remendo: liga o evento no Android e no iOS, é idempotente e avisa quando o plugin mudou.
 *  G373-3. O `postinstall` chama o remendo; o APK sobe de versão.
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { MARCA, REMENDOS, remendar } from "../../scripts/app/remendar-google-maps.mjs";

describe("G373-1 — o plugin instalado avisa a câmera a cada quadro", () => {
  it("Android e iOS remendados", () => {
    const r = remendar();
    expect(r.map((x) => x.estado)).toEqual(["ja-remendado", "ja-remendado"]);
    const kt = readFileSync("node_modules/@capacitor/google-maps/android/src/main/java/com/capacitorjs/plugins/googlemaps/CapacitorGoogleMap.kt", "utf8");
    expect(kt).toContain('delegate.notify("onCameraMove", dados)');
    const swift = readFileSync("node_modules/@capacitor/google-maps/ios/Sources/CapacitorGoogleMapsPlugin/CapacitorGoogleMapsPlugin.swift", "utf8");
    expect(swift).toContain("didChange position: GMSCameraPosition");
    expect(swift).toContain('self.notifyListeners("onCameraMove"');
  });
});

describe("G373-2 — o remendo", () => {
  const pastaCom = (conteudo) => {
    const pasta = mkdtempSync(join(tmpdir(), "gmaps-"));
    for (const { arquivo, ancora } of REMENDOS) {
      const caminho = join(pasta, arquivo);
      mkdirSync(dirname(caminho), { recursive: true });
      writeFileSync(caminho, conteudo(ancora));
    }
    return pasta;
  };

  it("liga o evento uma vez só (rodar de novo não duplica)", () => {
    const pasta = pastaCom((ancora) => `antes\n${ancora}        depois\n`);
    expect(remendar(pasta).map((x) => x.estado)).toEqual(["remendado", "remendado"]);
    expect(remendar(pasta).map((x) => x.estado)).toEqual(["ja-remendado", "ja-remendado"]);
    for (const { arquivo } of REMENDOS) {
      const texto = readFileSync(join(pasta, arquivo), "utf8");
      expect(texto.split(MARCA)).toHaveLength(2);
      expect(texto).toContain("onCameraMove");
    }
  });

  it("plugin mudado (sem o ponto de remendo) ou ausente: não mexe e diz o que houve", () => {
    const pasta = pastaCom(() => "outro conteúdo\n");
    expect(remendar(pasta).map((x) => x.estado)).toEqual(["sem-ancora", "sem-ancora"]);
    expect(remendar(join(pasta, "nada")).map((x) => x.estado)).toEqual(["sem-arquivo", "sem-arquivo"]);
  });
});

describe("G373-3 — postinstall e versão do APK", () => {
  it("o postinstall roda o remendo; APK 1.0.7 (código 8); nativoMinimo segue 5 (o site funciona no APK antigo)", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.postinstall).toBe("node scripts/app/remendar-google-maps.mjs");
    const versao = JSON.parse(readFileSync("app-version.json", "utf8"));
    expect(versao).toEqual({ versionName: "1.0.7", versionCode: 8, nativoMinimo: 5 });
  });
});
