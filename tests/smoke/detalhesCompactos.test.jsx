// @vitest-environment jsdom
/**
 * D-PROD-224 — os detalhes do mapa no desenho v12, mais compactos e mais
 * organizados. Pedido do proprietário: "gostei do novo estilo mas está muito
 * grande as informações e espalhadas sendo que pode organizar melhor", com os
 * prints do estilo antigo como referência de densidade.
 *
 *  DC-1. piso de leitura: nenhum texto abaixo de 11 px no CSS dos detalhes (só a
 *        seta de ordenar da tabela de lotes, que é desenho);
 *  DC-2. densidade: grade com células de 128 px (mais colunas), células e linhas
 *        mais baixas, valor em negrito como no estilo antigo; os alvos de toque
 *        continuam com 40 px ou mais (linha, item, abas, grupos);
 *  DC-3. popup (a partir de 768 px): o nível do cocho e o do depósito ao lado do
 *        cartão dos números, como o "Nível do cocho" antigo; os avisos do
 *        depósito embaixo, de ponta a ponta;
 *  DC-4. linha do tempo: as linhas do cartão em grade; texto livre (descrição,
 *        observações, detalhe, motivo) ou longo, de ponta a ponta.
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import LinhaDoTempo from "@/components/mapa/detalhes-lote/LinhaDoTempo";
import DepositoNivel from "@/components/mapa/DepositoNivel";
import { calcularNivelDeposito } from "@/domain/suplementacao/nivelSuplementacao";

afterEach(cleanup);

const ler = (arquivo) => readFileSync(arquivo, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const ARQUIVOS = ["src/styles/mk-detalhes-pasto.css", ...readdirSync("src/styles").filter((f) => /^mk-dp-.*\.css$/.test(f)).map((f) => `src/styles/${f}`)];

/** Corpo da regra com exatamente este seletor, no início de uma linha (a primeira, fora das media queries). */
const regra = (css, seletor) => {
  const i = css.indexOf(`\n${seletor} {`);
  if (i < 0) return null;
  return css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
};
/** Trecho do arquivo a partir da media query do popup (a partir de 768 px). */
const doPopup = (css) => {
  const i = css.indexOf("@media (min-width: 768px)");
  return i < 0 ? "" : css.slice(i);
};

describe("DC-1 — piso de leitura", () => {
  it("nenhum texto abaixo de 11 px no CSS dos detalhes (fora a seta de ordenar, que é desenho)", () => {
    expect(ARQUIVOS.length).toBeGreaterThan(5);
    let conferidos = 0;
    for (const arquivo of ARQUIVOS) {
      for (const [, seletor, corpo] of ler(arquivo).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const tamanho = /font-size:\s*([\d.]+)px/.exec(corpo);
        if (!tamanho || /mk-dp-tabela__seta/.test(seletor)) continue;
        conferidos += 1;
        expect(Number(tamanho[1]), `${arquivo} ${seletor.trim()}`).toBeGreaterThanOrEqual(11);
      }
    }
    expect(conferidos).toBeGreaterThan(40);
  });
});

describe("DC-2 — densidade", () => {
  const css = ler("src/styles/mk-detalhes-pasto.css");
  const px = (seletor, propriedade) => Number(new RegExp(`(?:^|\\s)${propriedade}:\\s*(\\d+)px`).exec(regra(css, seletor) ?? "")?.[1]);

  it("grade com células de 128 px, células baixas e o valor em negrito (como o estilo antigo)", () => {
    expect(regra(css, ".mk-dp .mk-dp-grade")).toMatch(/grid-template-columns:\s*repeat\(auto-fill, minmax\(128px, 1fr\)\)/);
    expect(regra(css, ".mk-dp .mk-dp-cel")).toMatch(/padding:\s*7px 10px 7px 0;/);
    expect(regra(css, ".mk-dp .mk-dp-cel__rot")).toMatch(/font-size:\s*11\.5px;/);
    expect(regra(css, ".mk-dp .mk-dp-cel__val")).toMatch(/font-size:\s*13px;/);
    expect(regra(css, ".mk-dp .mk-dp-cel__val")).toMatch(/font-weight:\s*600;/);
    expect(regra(css, ".mk-dp")).toMatch(/font-size:\s*13px;/);
    expect(regra(css, ".mk-dp .mk-dp__corpo--cards")).toMatch(/gap:\s*8px;/);
  });

  it("os alvos de toque continuam com 40 px ou mais", () => {
    expect(px(".mk-dp .mk-dp-linha", "min-height")).toBeGreaterThanOrEqual(40);
    expect(px(".mk-dp .mk-dp-item", "min-height")).toBeGreaterThanOrEqual(40);
    expect(px(".mk-dp .mk-dp-itens__cab", "min-height")).toBeGreaterThanOrEqual(40);
    expect(px(".mk-dp .mk-dp-aba", "height")).toBeGreaterThanOrEqual(40);
    expect(px(".mk-dp .mk-dp-grupo__cab", "min-height")).toBeGreaterThanOrEqual(40);
  });
});

describe("DC-3 — popup: nível ao lado do cartão dos números", () => {
  it("cocho: só a região do nível vira duas colunas (a da leitura segue em coluna), e o limite em 2 × 2", () => {
    const popup = doPopup(ler("src/styles/mk-dp-cocho.css"));
    expect(popup).toMatch(/\.mk-dp \.mk-dp-cocho__regiao:has\(> \.mk-dp-cocho__nivel\) \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/);
    expect(popup).toMatch(/\.mk-dp-cocho__cartao-nivel \.mk-dp-grade \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    // Fora do popup, a região continua em coluna.
    expect(regra(ler("src/styles/mk-dp-cocho.css"), ".mk-dp .mk-dp-cocho__regiao")).toMatch(/flex-direction:\s*column;/);
  });

  it("depósito: nível na 1ª coluna, cartão na 2ª e os avisos embaixo, de ponta a ponta", () => {
    const popup = doPopup(ler("src/styles/mk-dp-deposito.css"));
    expect(popup).toMatch(/\.mk-dp \.mk-dp-deposito__nivel \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/);
    expect(popup).toMatch(/\.mk-dp \.mk-dp-deposito__nivel > \.mk-dp-nivel \{\s*grid-column: 1;\s*grid-row: 1;/);
    expect(popup).toMatch(/\.mk-dp \.mk-dp-deposito__nivel > \.mk-dp-cartao \{\s*grid-column: 2;\s*grid-row: 1;/);
    expect(popup).toMatch(/\.mk-dp \.mk-dp-deposito__nivel > \.mk-dp-aviso \{\s*grid-column: 1 \/ -1;/);
  });

  it("depósito: a região tem como filhos diretos o nível, os avisos e o cartão (o que a grade do popup posiciona)", () => {
    const RACAO = { id: "pr-racao", unidade_principal_estoque: "KG" };
    const nivel = calcularNivelDeposito({
      deposito: { id: "dep", local_estoque_id: "loc", capacidade_cocho_kg: 1000, estoque_minimo_kg: 600 },
      estoqueLotes: [{ id: "l1", local_estoque_id: "loc", produto_id: RACAO.id, quantidade_disponivel: 500 }],
      produtos: [RACAO],
    });
    const { container } = render(
      <div className="mk-dp">
        <DepositoNivel nivel={nivel} />
      </div>,
    );
    const regiao = /** @type {HTMLElement} */ (container.querySelector("section.mk-dp-deposito__nivel"));
    const filhos = [...regiao.children].map((f) => f.classList[0]);
    expect(filhos[0]).toBe("mk-dp-deposito__oculto");
    expect(filhos[1]).toBe("mk-dp-nivel");
    expect(filhos.at(-1)).toBe("mk-dp-cartao");
    // Abaixo do mínimo: o aviso fica entre os dois no DOM e a grade o põe embaixo.
    expect(filhos.slice(2, -1)).toEqual(["mk-dp-aviso"]);
  });
});

describe("DC-4 — linha do tempo em grade", () => {
  it("as linhas do cartão em grade; uma linha só ou texto longo, de ponta a ponta", () => {
    const css = ler("src/styles/mk-dp-historico.css");
    expect(regra(css, ".mk-dp .mk-dp-tl__linhas")).toMatch(/display:\s*grid;\s*grid-template-columns:\s*repeat\(auto-fill, minmax\(140px, 1fr\)\);/);
    expect(regra(css, ".mk-dp .mk-dp-tl__row")).toMatch(/flex-direction:\s*column;/);
    expect(css).toMatch(/\.mk-dp \.mk-dp-tl__row:only-child,\s*\.mk-dp \.mk-dp-tl__row--larga \{\s*grid-column: 1 \/ -1;/);
  });

  it("texto livre (descrição, observações, detalhe, motivo) ou longo ocupa a largura; números e nomes curtos ficam lado a lado", () => {
    const { container } = render(
      <div className="mk-dp">
        <LinhaDoTempo
          dias={[
            {
              chave: "d1",
              rotulo: "09 NOV. 2026",
              cartoes: [
                {
                  chave: "c1",
                  icone: "suplementacao",
                  titulo: "Suplementação",
                  linhas: [
                    { rotulo: "Lote", valor: "L-2026-014" },
                    { rotulo: "Descrição", valor: "Curta" },
                    { rotulo: "Produto", valor: "SAL MINERAL 80" },
                    { rotulo: "Lotes juntados", valor: "L-2026-020 · L-2026-021" },
                    { rotulo: "Destino", valor: "Um destino com um nome bem comprido" },
                    { rotulo: "Observações", valor: "—" },
                    { rotulo: "Motivo", valor: "Erro" },
                    { rotulo: "Detalhe", valor: "Ok" },
                  ],
                },
              ],
            },
          ]}
        />
      </div>,
    );
    const linhas = [...container.querySelectorAll(".mk-dp-tl__row")].map((r) => [r.querySelector("dt")?.textContent, r.classList.contains("mk-dp-tl__row--larga")]);
    expect(linhas).toEqual([
      ["Lote", false],
      ["Descrição", true],
      ["Produto", false],
      ["Lotes juntados", false],
      ["Destino", true],
      ["Observações", true],
      ["Motivo", true],
      ["Detalhe", true],
    ]);
  });
});
