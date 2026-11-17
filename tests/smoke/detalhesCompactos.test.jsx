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
import { render, cleanup, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import LinhaDoTempo from "@/components/mapa/detalhes-lote/LinhaDoTempo";
import DepositoNivel from "@/components/mapa/DepositoNivel";
import { calcularNivelDeposito } from "@/domain/suplementacao/nivelSuplementacao";
import { CascaDeTeste, modeloV12 } from "./fixtures/pastoV12.jsx";

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

  it("toque (celular e tela de toque): pílulas e segmentado com 40 px; link e Excluir com área de 40 px; caixa com 40 px", () => {
    const i = css.indexOf("@media (max-width: 767px), (pointer: coarse) {");
    expect(i).toBeGreaterThan(0);
    const toque = css.slice(i, css.indexOf("\n}", i));
    expect(toque).toMatch(/\.mk-dp \.mk-dp-pilula \{\s*height: 40px;/);
    expect(toque).toMatch(/\.mk-dp \.mk-dp-seg__op \{\s*height: 40px;/);
    expect(toque).toMatch(/\.mk-dp :is\(\.mk-dp-link, \.mk-dp-acao\) \{\s*position: relative;\s*z-index: 1;/);
    expect(toque).toMatch(/\.mk-dp \.mk-dp-link::before \{\s*content: "";\s*position: absolute;\s*inset: -13px -6px;/);
    expect(toque).toMatch(/\.mk-dp \.mk-dp-acao::before \{\s*content: "";\s*position: absolute;\s*inset: -6px -4px;/);
    expect(regra(css, ".mk-dp button.mk-dp-cx::before")).toMatch(/inset:\s*-12px;/);
  });

  it("teal do link, da ação e do número da aba com contraste AA (4,5:1)", () => {
    for (const s of [".mk-dp .mk-dp-link", ".mk-dp .mk-dp-acao", ".mk-dp .mk-dp-aba__badge"]) expect(regra(css, s), s).toMatch(/color:\s*#0a7a8f;/);
    expect(css).not.toMatch(/#0e8fa6/i);
  });
});

describe("DC-3 — popup: nível ao lado do cartão dos números", () => {
  it("cocho: só a região do nível vira duas colunas (a da leitura segue em coluna); no cartão do limite, o medidor de ponta a ponta e Saldo | Duração | Próxima numa fileira (D-PROD-226)", () => {
    const css = ler("src/styles/mk-dp-cocho.css");
    const popup = doPopup(css);
    expect(popup).toMatch(/\.mk-dp \.mk-dp-cocho__regiao:has\(> \.mk-dp-cocho__nivel\) \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/);
    expect(regra(css, ".mk-dp .mk-dp-cocho__cartao-nivel .mk-dp-grade")).toMatch(/grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
    expect(regra(css, ".mk-dp .mk-dp-cocho__cartao-nivel .mk-dp-grade > .mk-dp-medidor")).toMatch(/grid-column:\s*1 \/ -1;/);
    expect(popup).not.toMatch(/\.mk-dp-cocho__cartao-nivel \.mk-dp-grade \{/);
    // Fora do popup, a região continua em coluna.
    expect(regra(ler("src/styles/mk-dp-cocho.css"), ".mk-dp .mk-dp-cocho__regiao")).toMatch(/flex-direction:\s*column;/);
  });

  it("depósito: nível na 1ª coluna, cartão na 2ª e os avisos embaixo, de ponta a ponta", () => {
    const popup = doPopup(ler("src/styles/mk-dp-deposito.css"));
    expect(popup).toMatch(/\.mk-dp \.mk-dp-deposito__nivel \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/);
    expect(popup).toMatch(/\.mk-dp \.mk-dp-deposito__nivel > \.mk-dp-nivel \{\s*grid-column: 1;\s*grid-row: 1;/);
    expect(popup).toMatch(/\.mk-dp \.mk-dp-deposito__nivel > \.mk-dp-cartao \{\s*grid-column: 2;\s*grid-row: 1;/);
    expect(popup).toMatch(/\.mk-dp \.mk-dp-deposito__nivel > \.mk-dp-aviso \{\s*grid-column: 1 \/ -1;/);
    // Como o DepositoNivel antigo: Ocupação | Estoque mínimo; Saldo | Sacos | Necessidade (6 trilhos, todos os modos).
    const css = ler("src/styles/mk-dp-deposito.css");
    expect(regra(css, ".mk-dp .mk-dp-deposito__nivel > .mk-dp-cartao .mk-dp-grade")).toMatch(/grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\);/);
    expect(regra(css, ".mk-dp .mk-dp-deposito__nivel > .mk-dp-cartao .mk-dp-grade > .mk-dp-cel")).toMatch(/grid-column:\s*span 2;/);
    expect(css).toMatch(/> \.mk-dp-cel:nth-child\(-n \+ 2\),\s*[^{]*> \.mk-dp-cel:nth-child\(3\):nth-last-child\(2\),\s*[^{]*> \.mk-dp-cel:nth-child\(4\):last-child \{\s*grid-column: span 3;/);
    expect(popup).not.toMatch(/\.mk-dp-cartao \.mk-dp-grade \{/);
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

  it("D-PROD-226: linha fina entre as fileiras (a 1ª fica sem), espaço do estilo antigo e valor equilibrado", () => {
    const css = ler("src/styles/mk-dp-historico.css");
    expect(regra(css, ".mk-dp .mk-dp-tl__linhas")).toMatch(/padding:\s*0 12px;\s*clip-path:\s*inset\(0 12px\);/);
    expect(regra(css, ".mk-dp .mk-dp-tl__row")).toMatch(/position:\s*relative;/);
    expect(regra(css, ".mk-dp .mk-dp-tl__row::before")).toMatch(/top:\s*-1px;[\s\S]*height:\s*1px;\s*background:\s*#f0f1f3;\s*pointer-events:\s*none;/);
    expect(regra(css, ".mk-dp .mk-dp-tl")).toMatch(/gap:\s*6px;/);
    expect(regra(css, ".mk-dp .mk-dp-tl__cab")).toMatch(/min-height:\s*36px;/);
    expect(regra(css, ".mk-dp .mk-dp-tl__row > dd")).toMatch(/text-wrap:\s*balance;/);
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

describe("DC-5 — popup: pares lado a lado (D-PROD-226)", () => {
  const css = ler("src/styles/mk-detalhes-pasto.css");
  const popup = css.slice(css.indexOf("@media (min-width: 768px)"));
  const CORPOS = [
    '.mk-dp .mk-dp__corpo--cards[id$="-painel-detalhes"]:has(> .mk-dp-titulo ~ .mk-dp-titulo)',
    '.mk-dp .mk-dp__corpo--cards[id$="-painel-supl"]:has(> .mk-dp-kpis)',
    ".mk-dp.mk-dp-bebedouro > .mk-dp__corpo--cards",
    ".mk-dp.mk-dp-deposito > .mk-dp__corpo--cards:has(> .mk-dp-deposito__nivel)",
  ];
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  it("o corpo vira grade de 2 colunas com linhas min-content (sem elas os cartões encolhem e cortam)", () => {
    const i = popup.indexOf(`${CORPOS[3]} {`);
    expect(i).toBeGreaterThan(0);
    const corpoDaRegra = popup.slice(popup.indexOf("{", i) + 1, popup.indexOf("}", i));
    expect(corpoDaRegra).toMatch(/display:\s*grid;\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);\s*grid-auto-flow:\s*row dense;\s*grid-auto-rows:\s*min-content;\s*align-content:\s*start;\s*align-items:\s*start;/);
    for (const c of CORPOS) expect(popup, c).toContain(`${c},`.slice(0, -1));
  });

  it("o 1º título e o bloco logo depois na coluna 1; o 2º na coluna 2 (pelo título, não pela posição)", () => {
    for (const c of CORPOS) {
      expect(popup).toMatch(new RegExp(`${esc(c)} > \\.mk-dp-titulo:nth-child\\(1 of \\.mk-dp-titulo\\) \\+ \\*[,\\s]`));
      expect(popup).toMatch(new RegExp(`${esc(c)} > \\.mk-dp-titulo:nth-child\\(2 of \\.mk-dp-titulo\\) \\+ \\*[,\\s]`));
    }
    expect(popup).not.toMatch(/nth-last-child/);
  });

  it("aba Detalhes do pasto: o corpo é o painel `…-painel-detalhes` e os dois títulos são Lotação e Categorias, cada um logo antes do seu cartão; sem lotes, um título só (o corpo fica em coluna)", () => {
    const titulosDoCorpo = (corpo) => [...corpo.children].filter((f) => f.classList.contains("mk-dp-titulo"));
    const { unmount } = render(<CascaDeTeste modelo={modeloV12()} abaInicial="detalhes" />);
    const corpo = screen.getByRole("tabpanel");
    expect(corpo.id).toMatch(/-painel-detalhes$/);
    expect(corpo.classList.contains("mk-dp__corpo--cards")).toBe(true);
    const titulos = titulosDoCorpo(corpo);
    expect(titulos.map((t) => t.textContent)).toEqual(["Lotação", "Categorias"]);
    for (const t of titulos) expect(t.nextElementSibling?.classList.contains("mk-dp-cartao"), t.textContent).toBe(true);
    unmount();
    render(<CascaDeTeste modelo={modeloV12({ qtd: 0 })} abaInicial="detalhes" />);
    expect(titulosDoCorpo(screen.getByRole("tabpanel")).map((t) => t.textContent)).toEqual(["Lotação"]);
  });
});
