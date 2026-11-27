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

import { ARQUIVO_GANCHO, GANCHO, MARCA, MARCA_CAMADA, MARCA_DATA, MARCA_TOQUE, REMENDOS, criarGancho, remendar } from "../../scripts/app/remendar-google-maps.mjs";

describe("G373-1 — o plugin instalado avisa a câmera a cada quadro", () => {
  it("Android e iOS remendados (câmera a cada quadro; D-PROD-374: imagem data: e toque no marcador)", () => {
    const r = remendar();
    expect(r.map((x) => x.estado)).toEqual(REMENDOS.map(() => "ja-remendado"));
    const kt = readFileSync("node_modules/@capacitor/google-maps/android/src/main/java/com/capacitorjs/plugins/googlemaps/CapacitorGoogleMap.kt", "utf8");
    expect(kt).toContain('delegate.notify("onCameraMove", dados)');
    const swift = readFileSync("node_modules/@capacitor/google-maps/ios/Sources/CapacitorGoogleMapsPlugin/CapacitorGoogleMapsPlugin.swift", "utf8");
    expect(swift).toContain("didChange position: GMSCameraPosition");
    expect(swift).toContain('self.notifyListeners("onCameraMove"');
    // D-PROD-374: o marcador nativo aceita a imagem desenhada na hora, e o toque nele não centraliza o mapa
    expect(kt).toContain(MARCA_DATA);
    expect(kt).toContain("android.util.Base64.decode");
    expect(kt).toContain(MARCA_TOQUE);
    const mapaSwift = readFileSync("node_modules/@capacitor/google-maps/ios/Sources/CapacitorGoogleMapsPlugin/Map.swift", "utf8");
    expect(mapaSwift).toContain(MARCA_DATA);
    expect(mapaSwift).toContain("Data(base64Encoded:");
    expect(swift).toContain(MARCA_TOQUE);
    // D-PROD-376: o gancho da câmera para a camada nativa, chamado logo no começo do onCameraMove
    expect(readFileSync(join("node_modules/@capacitor/google-maps", ARQUIVO_GANCHO), "utf8")).toBe(GANCHO);
    expect(kt).toContain(`${MARCA_CAMADA} (desenha junto com a câmera)\n        MaikeCamera.mexeu()`);
  });
});

describe("G373-2 — o remendo", () => {
  // um arquivo pode ter mais de um remendo: o conteúdo de cada arquivo junta as âncoras dele
  const pastaCom = (conteudo) => {
    const pasta = mkdtempSync(join(tmpdir(), "gmaps-"));
    /** @type {Map<string, string[]>} */
    const porArquivo = new Map();
    // a âncora que nasce de outro remendo (D-PROD-376: logo depois do D-PROD-373) não vai: ela aparece quando ele entra
    const nascida = (/** @type {string} */ a) => REMENDOS.some((r) => a.includes(r.marca));
    for (const { arquivo, ancora } of REMENDOS) {
      if (!nascida(ancora)) porArquivo.set(arquivo, [...(porArquivo.get(arquivo) || []), ancora]);
    }
    for (const [arquivo, ancoras] of porArquivo) {
      const caminho = join(pasta, arquivo);
      mkdirSync(dirname(caminho), { recursive: true });
      writeFileSync(caminho, ancoras.map((a) => conteudo(a)).join("\n"));
    }
    return pasta;
  };

  it("liga o evento uma vez só (rodar de novo não duplica)", () => {
    const pasta = pastaCom((ancora) => `antes\n${ancora}        depois\n`);
    expect(remendar(pasta).map((x) => x.estado)).toEqual(REMENDOS.map(() => "remendado"));
    expect(remendar(pasta).map((x) => x.estado)).toEqual(REMENDOS.map(() => "ja-remendado"));
    for (const { arquivo, marca } of REMENDOS) {
      const texto = readFileSync(join(pasta, arquivo), "utf8");
      expect(texto.split(marca)).toHaveLength(2);
    }
    expect(MARCA).toContain("onCameraMove");
  });

  it("plugin mudado (sem o ponto de remendo) ou ausente: não mexe e diz o que houve", () => {
    const pasta = pastaCom(() => "outro conteúdo\n");
    expect(remendar(pasta).map((x) => x.estado)).toEqual(REMENDOS.map(() => "sem-ancora"));
    expect(remendar(join(pasta, "nada")).map((x) => x.estado)).toEqual(REMENDOS.map(() => "sem-arquivo"));
  });

  it("D-PROD-376: o gancho da câmera é criado uma vez; sem o plugin, nada", () => {
    const pasta = pastaCom((a) => a);
    expect(criarGancho(pasta)).toBe("criado");
    expect(readFileSync(join(pasta, ARQUIVO_GANCHO), "utf8")).toBe(GANCHO);
    expect(criarGancho(pasta)).toBe("ja-criado");
    expect(criarGancho(join(pasta, "nada"))).toBe("sem-plugin");
  });
});

describe("G373-3 — postinstall e versão do APK", () => {
  it("o postinstall roda o remendo; APK 1.0.9 (código 10, D-PROD-376); nativoMinimo segue 5 (o site funciona no APK antigo)", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.postinstall).toBe("node scripts/app/remendar-google-maps.mjs");
    const versao = JSON.parse(readFileSync("app-version.json", "utf8"));
    expect(versao).toEqual({ versionName: "1.0.9", versionCode: 10, nativoMinimo: 5 });
  });
});
