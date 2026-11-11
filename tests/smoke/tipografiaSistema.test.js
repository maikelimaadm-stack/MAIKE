/**
 * D-PROD-167 — padrão de tipografia do sistema, pedido pelo proprietário: Open Sans no texto, Lato nos títulos de grupo
 * e nos números de medição; escala 13 · 14 · 16 · 18 · 20 · 24 · 30 · 34 · 46; texto 14px, linha 1.5, espaçamento 0.3px.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { fontesRotuloPorZoom } from "@/lib/maplibre/mapaGeralRender.js";
import { FONTE_CONTAGEM_PX } from "@/lib/maplibre/contagemLote.js";
import { larguraPadraoDaColuna } from "@/lib/cadastroBase1ColumnPrefs";

const ler = (p) => readFileSync(join(process.cwd(), p), "utf8");
const regra = (css, seletor) => {
  const i = css.indexOf(seletor);
  if (i < 0) return "";
  return css.slice(css.indexOf("{", i), css.indexOf("}", i));
};

describe("fontes e base", () => {
  it("index.html carrega Open Sans e Lato (e não mais a DM Sans)", () => {
    const html = ler("index.html");
    expect(html).toMatch(/fonts\.googleapis\.com\/css2\?family=Lato[^"]*&family=Open\+Sans/);
    expect(html).not.toMatch(/DM\+Sans/);
  });

  it("body: Open Sans 14px, linha 1.5, espaçamento 0.3px; títulos com linha 1.25", () => {
    const css = ler("src/index.css");
    const body = regra(css, "\nbody {");
    expect(body).toMatch(/font-family:\s*var\(--mk-fonte-texto/);
    expect(body).toMatch(/font-size:\s*14px/);
    expect(body).toMatch(/line-height:\s*1\.5/);
    expect(body).toMatch(/letter-spacing:\s*0\.3px/);
    expect(regra(css, ":is(h1, h2, h3, h4, h5, h6)")).toMatch(/line-height:\s*1\.25/);
    expect(css).toMatch(/@import "\.\/styles\/tipografia-sistema\.css";/);
  });

  it("tokens: texto/listas/campos/rótulos/botões 14px; título de janela 20px; toque com campo de 16px", () => {
    const css = ler("src/styles/mk-unificado.css");
    expect(css).toMatch(/--mk-fonte-texto:\s*"Open Sans"/);
    expect(css).toMatch(/--mk-fonte-titulo:\s*"Lato", "Open Sans"/);
    for (const t of ["--mk-font-list", "--mk-font-field", "--mk-font-heading", "--mk-font-search", "--mk-font-float-rest", "--mk-action-font"]) {
      expect(css, t).toMatch(new RegExp(`${t}:\\s*14px`));
    }
    expect(css).toMatch(/--mk-font-title:\s*20px/);
    expect(css).toMatch(/--mk-font-field:\s*16px/); // ≤ 1023px
    const b1 = ler("src/styles/base1-tipografia.css");
    expect(b1).toMatch(/--mk-font-list:\s*14px/);
    expect(b1).toMatch(/font-family:\s*var\(--mk-fonte-texto\)/);
    expect(b1).not.toMatch(/DM Sans/);
  });
});

describe("peças com tamanho próprio", () => {
  const css = ler("src/styles/tipografia-sistema.css");

  it("título de janela 20px/600; toast 16/14px 500; cabeçalho de grupo Lato 13px maiúsculas 600", () => {
    expect(regra(css, ".mk-dialogo-titulo:not(#mk-a)")).toMatch(/font-size:\s*20px !important;[\s\S]*font-weight:\s*600/);
    expect(regra(css, ".mg-toast__title:not(#mk-a)")).toMatch(/font-size:\s*16px;[\s\S]*font-weight:\s*500/);
    expect(regra(css, ".mg-toast__desc:not(#mk-a)")).toMatch(/font-size:\s*14px;[\s\S]*font-weight:\s*500/);
    const grupo = regra(css, ".mk-grupo-lista:not(#mk-a)");
    expect(grupo).toMatch(/var\(--mk-fonte-titulo\)/);
    expect(grupo).toMatch(/font-size:\s*13px/);
    expect(grupo).toMatch(/text-transform:\s*uppercase/);
  });

  it("rótulo de campo 300; select 600; abas do topo 14px/600; card de medição Lato 30px / unidade 13px", () => {
    expect(regra(css, ".cadastro-b1 .mg-field__label:not(#mk-a)")).toMatch(/font-weight:\s*300/);
    expect(regra(css, '.cadastro-b1 .mg-field__control button[role="combobox"]:not(#mk-a)')).toMatch(/font-weight:\s*600/);
    expect(regra(css, ".mk-topnav .mk-topnav-item:not(#mk-a)")).toMatch(/font-size:\s*14px;[\s\S]*font-weight:\s*600/);
    expect(regra(css, ".mk-mapa-resumo__num:not(#mk-a)")).toMatch(/font-size:\s*30px/);
    expect(regra(css, ".mk-mapa-resumo__num small:not(#mk-a)")).toMatch(/font-size:\s*13px/);
  });

  it("mapa: nome do pasto 12px e área 10px de perto; número de cabeças 13px", () => {
    expect(fontesRotuloPorZoom(18)).toEqual({ nome: 12, ha: 10 });
    expect(FONTE_CONTAGEM_PX).toBe(13);
    const mapa = ler("src/components/mapa/useMapRenderer.jsx");
    expect(mapa).toMatch(/text-shadow:0 1px 2px rgba\(0,0,0,\.85\)/);
    expect(mapa).toMatch(/font-size:\$\{FONTE_CONTAGEM_PX\}px;font-weight:500/);
  });

  it("largura padrão das colunas acompanha a fonte da lista (12 → 14px)", () => {
    expect(larguraPadraoDaColuna({ width: 120 })).toBe(140);
    expect(larguraPadraoDaColuna({})).toBe(187);
  });
});
