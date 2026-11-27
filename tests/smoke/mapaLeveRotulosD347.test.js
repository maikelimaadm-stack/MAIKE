/**
 * D-PROD-347 (mapa leve, etapa 1): a revisão dos nomes das áreas não pode alternar leitura e escrita de layout por
 * nome (isso recalculava a página inteira a cada nome e travava o zoom: 36 s de layout num zoom de 200 pastos).
 * Durante o zoom, só os pastos na tela são revistos; o moveend revê todos.
 *
 * D-PROD-354 (etapa 4): os nomes são desenhados pelo mapa e a revisão não lê nem escreve layout nenhum — a caixa de cada
 * nome sai do tamanho conhecido da imagem e de `map.project`. O funcionamento está em nomesNoMapaD354 (N354-5).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const r = readFileSync("src/components/mapa/useMapRenderer.jsx", "utf8");
const corpo = r.slice(r.indexOf("const arrumarNomes = (opcoes) =>"), r.indexOf("const ultimoArrumarRef"));

describe("nomes das áreas sem travar o zoom (D-PROD-347, sem DOM desde a D-PROD-354)", () => {
  it("a revisão não lê nem escreve layout: nada de getBoundingClientRect, estilo ou elemento de nome", () => {
    expect(corpo.length).toBeGreaterThan(500);
    expect(corpo).not.toMatch(/getBoundingClientRect|\.style\.|offsetWidth|offsetHeight|document\./);
    expect(corpo).toMatch(/map\.project\(n\.lngLat\)/);
    expect(r).not.toMatch(/mg-area-label/);
  });

  it("durante o zoom revê só os pastos na tela; o moveend revê todos", () => {
    expect(r).toMatch(/arrumarNomes\(\{ soNaTela: true \}\);/);
    expect(r).toMatch(/requestAnimationFrame\(\(\) => arrumarNomes\(\)\)/);
    expect(corpo).toMatch(/if \(alvo && !alvo\.has\(id\)\) return;/);
    // durante o zoom só publica quando o nível muda
    expect(corpo).toMatch(/if \(soNaTela && nivel === nomesEstadoRef\.current\.nivel\) return;/);
  });
});
