/**
 * D-PROD-347 (mapa leve, etapa 1): a revisão dos nomes das áreas não pode alternar leitura e escrita de layout por
 * nome (isso recalculava a página inteira a cada nome e travava o zoom: 36 s de layout num zoom de 200 pastos).
 * Durante o zoom, só os pastos na tela são revistos; o moveend revê todos.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const r = readFileSync("src/components/mapa/useMapRenderer.jsx", "utf8");
const corpo = r.slice(r.indexOf("const arrumarRotulos = (opcoes) =>"), r.indexOf("const escalarNome ="));

describe("nomes das áreas sem travar o zoom (D-PROD-347)", () => {
  it("lê o tamanho de todos os nomes antes de escalar qualquer um", () => {
    const leitura = corpo.indexOf("const t = entry.corpo.getBoundingClientRect();");
    const escrita = corpo.indexOf("escalarNome(entry, zoom);");
    expect(leitura).toBeGreaterThan(0);
    expect(escrita).toBeGreaterThan(leitura);
    // entre a leitura e a escrita termina um forEach e começa outro (duas passadas)
    const meio = corpo.slice(leitura, escrita);
    expect(meio).toMatch(/\}\);\s*labelsRef\.current\.forEach\(\(entry, id\) => \{/);
  });

  it("durante o zoom revê só os pastos na tela; o moveend revê todos", () => {
    expect(r).toMatch(/arrumarRotulos\(\{ soNaTela: true \}\);/);
    expect(r).toMatch(/requestAnimationFrame\(\(\) => arrumarRotulos\(\)\)/);
    expect(corpo).toMatch(/if \(alvo && !alvo\.has\(id\)\) return;/);
  });
});
