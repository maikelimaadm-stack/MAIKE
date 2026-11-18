// @vitest-environment jsdom
/**
 * D-PROD-224 e D-PROD-226 — os detalhes do mapa no desenho v12, mais compactos
 * (D-PROD-224) e organizados como o estilo antigo (D-PROD-226). Pedido do
 * proprietário: "gostei do novo estilo mas está muito grande as informações e
 * espalhadas sendo que pode organizar melhor", com os prints do estilo antigo.
 *
 *  DC-1. piso de leitura: nenhum texto abaixo de 11 px no CSS dos detalhes (só a
 *        seta de ordenar da tabela de lotes, que é desenho);
 *  DC-2. densidade: grade com células de 128 px, células e linhas mais baixas,
 *        valor em negrito; alvos de toque de 40 px ou mais (no celular e na tela
 *        de toque, com áreas invisíveis no link, no "Excluir" e no ✕); teal AA;
 *        texto livre com o rótulo numa coluna e o valor logo depois, em todas as
 *        larguras; sem palavra sozinha na última linha do valor;
 *  DC-3. popup (a partir de 768 px): o nível do cocho e o do depósito ao lado do
 *        cartão dos números; em todos os modos, o cartão do limite do cocho em
 *        três e o dos números do depósito em 2 + 3, com os valores alinhados;
 *  DC-4. linha do tempo: as linhas do cartão em grade, com a divisória entre as
 *        fileiras; texto livre ou longo de ponta a ponta;
 *  DC-5. popup: pares lado a lado (Lotação | Categorias, Fornecimento | Consumo,
 *        Resumo | Último registro, Saldo | Pastos atendidos), pelo 1º e o 2º
 *        título do corpo, só a partir de 768 px.
 *
 * O CSS é lido regra a regra (chaves balanceadas e listas de seletores), para
 * que uma regra fora do lugar ou sem a declaração não passe só por o texto
 * aparecer no arquivo.
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

/** Corpo da regra com exatamente este seletor, no início de uma linha (fora das media queries). */
const regra = (css, seletor) => {
  const i = css.indexOf(`\n${seletor} {`);
  if (i < 0) return null;
  return css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
};

/** Lista de seletores separada nas vírgulas de fora dos parênteses (`:is(a, b)` fica inteiro). */
const separar = (lista) => {
  const partes = [];
  let profundidade = 0;
  let atual = "";
  for (const ch of lista) {
    if (ch === "(") profundidade += 1;
    if (ch === ")") profundidade -= 1;
    if (ch === "," && profundidade === 0) {
      partes.push(atual);
      atual = "";
    } else atual += ch;
  }
  partes.push(atual);
  return partes.map((p) => p.trim().replace(/\s+/g, " ")).filter(Boolean);
};

/** Blocos `@media <condição> { … }`: começo, fim e o que fica dentro (chaves balanceadas). */
const blocosMedia = (css, condicao) => {
  const abre = `@media ${condicao} {`;
  const blocos = [];
  for (let i = css.indexOf(abre); i >= 0; i = css.indexOf(abre, i + 1)) {
    const chave = css.indexOf("{", i);
    let profundidade = 0;
    let j = chave;
    for (; j < css.length; j += 1) {
      if (css[j] === "{") profundidade += 1;
      if (css[j] === "}" && --profundidade === 0) break;
    }
    blocos.push({ ini: i, fim: j + 1, dentro: css.slice(chave + 1, j) });
  }
  return blocos;
};

/** O arquivo sem os blocos `@media <condição>`. */
const semMedia = (css, condicao) => blocosMedia(css, condicao).reduceRight((t, b) => t.slice(0, b.ini) + t.slice(b.fim), css);

/** Regras de um trecho: a lista de seletores e o corpo. */
const regrasDe = (trecho) => [...trecho.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, corpo]) => ({ seletores: separar(sel), corpo }));

/** Corpo da regra cuja lista de seletores tem todos estes. */
const regraCom = (regras, ...seletores) => regras.find((r) => seletores.every((s) => r.seletores.includes(s)))?.corpo ?? null;

/** As regras de dentro do único bloco `@media <condição>` do arquivo. */
const regrasDoBloco = (css, condicao) => {
  const blocos = blocosMedia(css, condicao);
  expect(blocos, condicao).toHaveLength(1);
  return regrasDe(blocos[0].dentro);
};

const POPUP = "(min-width: 768px)";
const TOQUE = "(max-width: 767px), (pointer: coarse)";

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

describe("DC-2 — densidade, toque, contraste e texto livre", () => {
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

  it("toque (celular e tela de toque): pílulas, segmentado e cabeçalho ordenável com 40 px; link, Excluir e ✕ com área invisível de 40 px; caixa com 40 px", () => {
    const toque = regrasDoBloco(css, TOQUE);
    expect(regraCom(toque, ".mk-dp .mk-dp-pilula")).toMatch(/^\s*height: 40px;\s*$/);
    expect(regraCom(toque, ".mk-dp .mk-dp-seg__op")).toMatch(/^\s*height: 40px;\s*$/);
    expect(regraCom(toque, ".mk-dp :is(.mk-dp-link, .mk-dp-acao)")).toMatch(/position: relative;\s*z-index: 1;/);
    expect(regraCom(toque, ".mk-dp .mk-dp-link::before")).toMatch(/content: "";\s*position: absolute;\s*inset: -13px -6px;/);
    expect(regraCom(toque, ".mk-dp .mk-dp-acao::before")).toMatch(/content: "";\s*position: absolute;\s*inset: -6px -4px;/);
    const x = ".mk-ll-dlg:has(> .mk-ll > .mk-dp) .mk-ll-dlg__acoes .tb-btn.mg-act-cancelar";
    expect(regraCom(toque, x)).toMatch(/position: relative;/);
    expect(regraCom(toque, `${x}::before`)).toMatch(/content: "";\s*position: absolute;\s*inset: -2px;/);
    expect(regraCom(regrasDoBloco(ler("src/styles/mk-dp-lotes.css"), TOQUE), ".mk-dp .mk-dp-tabela__ordenar")).toMatch(/min-height: 40px;/);
    expect(regra(css, ".mk-dp button.mk-dp-cx::before")).toMatch(/inset:\s*-12px;/);
  });

  it("celular de 360 px ou mais: a pílula não encolhe abaixo do texto (sem reticências)", () => {
    expect(regraCom(regrasDoBloco(css, "(min-width: 360px) and (max-width: 767px)"), ".mk-dp .mk-dp-pilula")).toMatch(/min-width: auto;/);
    expect(regra(css, ".mk-dp .mk-dp-pilula")).toMatch(/min-width: 0;/);
  });

  it("teal do link, da ação e do número da aba com contraste AA (4,5:1)", () => {
    for (const s of [".mk-dp .mk-dp-link", ".mk-dp .mk-dp-acao", ".mk-dp .mk-dp-aba__badge"]) expect(regra(css, s), s).toMatch(/color:\s*#0a7a8f;/);
    expect(css).not.toMatch(/#0e8fa6/i);
  });

  it("texto livre em todas as larguras: rótulo numa coluna que não encolhe abaixo de min(168 px, 33%) e valor logo depois, à esquerda", () => {
    expect(regra(css, ".mk-dp .mk-dp-linha--quebra:has(.mk-dp-linha__val) .mk-dp-linha__txt")).toMatch(/flex: 0 1 auto;\s*min-width: min\(168px, 33%\);\s*max-width: 50%;/);
    expect(regra(css, ".mk-dp .mk-dp-linha--quebra .mk-dp-linha__fim")).toMatch(/flex: 1 1 0;\s*justify-content: flex-start;\s*min-width: 0;/);
    expect(regra(css, ".mk-dp .mk-dp-linha--quebra .mk-dp-linha__val")).toMatch(/text-align: left;\s*overflow-wrap: break-word;/);
    // Nenhuma regra do texto livre presa a uma largura: vale no celular e no popup.
    for (const b of blocosMedia(css, POPUP)) expect(b.dentro).not.toMatch(/mk-dp-linha--quebra/);
    for (const b of blocosMedia(css, "(max-width: 767px)")) expect(b.dentro).not.toMatch(/mk-dp-linha--quebra/);
  });

  it("quebra do valor: nas células, sem palavra sozinha na última linha (pretty, sem o balance que separava \"900 / kg\"); na linha do tempo, equilibrada (não parte o código do lote no hífen)", () => {
    expect(regra(css, ".mk-dp .mk-dp-cel__val")).toMatch(/text-wrap: pretty;/);
    expect(css).not.toMatch(/text-wrap:\s*balance/);
    expect(regra(ler("src/styles/mk-dp-historico.css"), ".mk-dp .mk-dp-tl__row > dd")).toMatch(/text-wrap: balance;/);
  });
});

describe("DC-3 — o nível e os cartões dos números do cocho e do depósito", () => {
  const cocho = ler("src/styles/mk-dp-cocho.css");
  const deposito = ler("src/styles/mk-dp-deposito.css");

  it("cocho: no popup, só a região do nível vira duas colunas; fora do popup, a região segue em coluna", () => {
    const popup = regrasDoBloco(cocho, POPUP);
    expect(regraCom(popup, ".mk-dp .mk-dp-cocho__regiao:has(> .mk-dp-cocho__nivel)")).toMatch(/display: grid;\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/);
    expect(semMedia(cocho, POPUP)).not.toMatch(/mk-dp-cocho__regiao:has/);
    expect(regra(cocho, ".mk-dp .mk-dp-cocho__regiao")).toMatch(/flex-direction:\s*column;/);
  });

  it("cocho, em todos os modos: o medidor de ponta a ponta e Saldo | Duração | Próxima numa fileira, com os valores na mesma linha (subgrid)", () => {
    expect(regra(cocho, ".mk-dp .mk-dp-cocho__cartao-nivel .mk-dp-grade")).toMatch(/grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
    expect(regra(cocho, ".mk-dp .mk-dp-cocho__cartao-nivel .mk-dp-grade > .mk-dp-medidor")).toMatch(/grid-column:\s*1 \/ -1;/);
    expect(regra(cocho, ".mk-dp .mk-dp-cocho__cartao-nivel .mk-dp-grade > .mk-dp-cel:not(.mk-dp-medidor)")).toMatch(/display: grid;\s*grid-row: span 3;\s*grid-template-rows: subgrid;\s*row-gap: 1px;/);
    for (const b of blocosMedia(cocho, POPUP)) expect(b.dentro).not.toMatch(/mk-dp-cocho__cartao-nivel/);
  });

  it("depósito: no popup, nível na 1ª coluna, cartão na 2ª e os avisos embaixo, de ponta a ponta; fora do popup, em coluna", () => {
    const popup = regrasDoBloco(deposito, POPUP);
    expect(regraCom(popup, ".mk-dp .mk-dp-deposito__nivel")).toMatch(/display: grid;\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/);
    expect(regraCom(popup, ".mk-dp .mk-dp-deposito__nivel > .mk-dp-nivel")).toMatch(/grid-column: 1;\s*grid-row: 1;/);
    expect(regraCom(popup, ".mk-dp .mk-dp-deposito__nivel > .mk-dp-cartao")).toMatch(/grid-column: 2;\s*grid-row: 1;/);
    expect(regraCom(popup, ".mk-dp .mk-dp-deposito__nivel > .mk-dp-aviso")).toMatch(/grid-column: 1 \/ -1;/);
    expect(semMedia(deposito, POPUP)).not.toMatch(/mk-dp-deposito__nivel > \.mk-dp-(nivel|cartao|aviso) \{/);
  });

  it("depósito, em todos os modos: Ocupação | Estoque mínimo; Saldo | Sacos | Necessidade (6 trilhos), com os valores da 2ª fileira na mesma linha (subgrid)", () => {
    const base = regrasDe(semMedia(deposito, POPUP));
    const g = ".mk-dp .mk-dp-deposito__nivel > .mk-dp-cartao .mk-dp-grade";
    expect(regraCom(base, g)).toMatch(/grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\);/);
    expect(regraCom(base, `${g} > .mk-dp-cel`)).toMatch(/grid-column:\s*span 2;/);
    expect(regraCom(base, `${g} > .mk-dp-cel:nth-child(-n + 2)`, `${g} > .mk-dp-cel:nth-child(3):nth-last-child(2)`, `${g} > .mk-dp-cel:nth-child(4):last-child`)).toMatch(/grid-column:\s*span 3;/);
    expect(regraCom(base, `${g} > .mk-dp-cel:nth-child(n + 3)`)).toMatch(/display: grid;\s*grid-row: span 3;\s*grid-template-rows: subgrid;\s*row-gap: 1px;/);
    for (const b of blocosMedia(deposito, POPUP)) expect(b.dentro).not.toMatch(/\.mk-dp-grade/);
  });

  it("depósito: a região tem como filhos diretos o nível, os avisos e o cartão (o que a grade do popup posiciona)", () => {
    const RACAO = { id: "pr-racao", unidade_principal_estoque: "KG" };
    const nivel = calcularNivelDeposito({
      deposito: { id: "dep", local_estoque_id: "loc", capacidade_cocho_kg: 1000, estoque_minimo_kg: 600 },
      estoqueLotes: [{ id: "l1", local_estoque_id: "loc", produto_id: "pr-desconhecido", quantidade_disponivel: 500 }],
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
    // Com aviso de unidade: o aviso fica entre os dois no DOM.
    expect(filhos.slice(2, -1)).toEqual(["mk-dp-aviso"]);
  });
});

describe("DC-4 — linha do tempo em grade", () => {
  const css = ler("src/styles/mk-dp-historico.css");

  it("as linhas do cartão em grade; uma linha só ou texto longo, de ponta a ponta", () => {
    expect(regra(css, ".mk-dp .mk-dp-tl__linhas")).toMatch(/display:\s*grid;\s*grid-template-columns:\s*repeat\(auto-fill, minmax\(140px, 1fr\)\);/);
    expect(regra(css, ".mk-dp .mk-dp-tl__row")).toMatch(/flex-direction:\s*column;/);
    expect(css).toMatch(/\.mk-dp \.mk-dp-tl__row:only-child,\s*\.mk-dp \.mk-dp-tl__row--larga \{\s*grid-column: 1 \/ -1;/);
  });

  it("D-PROD-226: linha fina de ponta a ponta entre as fileiras (a 1ª fica sem, cortada pelo clip-path) e o espaço do estilo antigo", () => {
    expect(regra(css, ".mk-dp .mk-dp-tl__linhas")).toMatch(/padding:\s*0 12px;\s*clip-path:\s*inset\(0 12px\);/);
    expect(regra(css, ".mk-dp .mk-dp-tl__row")).toMatch(/position:\s*relative;/);
    expect(regra(css, ".mk-dp .mk-dp-tl__row::before")).toMatch(/content: "";\s*position: absolute;\s*top: -1px;\s*left: -2000px;\s*right: -2000px;\s*height: 1px;\s*background: #f0f1f3;\s*pointer-events: none;/);
    expect(regra(css, ".mk-dp .mk-dp-tl")).toMatch(/gap:\s*6px;/);
    expect(regra(css, ".mk-dp .mk-dp-tl__cab")).toMatch(/min-height:\s*36px;/);
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
  const blocos = blocosMedia(css, POPUP).filter((b) => b.dentro.includes("mk-dp__corpo--cards"));
  const regras = blocos.length === 1 ? regrasDe(blocos[0].dentro) : [];
  const CORPOS = [
    '.mk-dp .mk-dp__corpo--cards[id$="-painel-detalhes"]:has(> .mk-dp-titulo ~ .mk-dp-titulo)',
    '.mk-dp .mk-dp__corpo--cards[id$="-painel-supl"]:has(> .mk-dp-kpis)',
    ".mk-dp.mk-dp-bebedouro > .mk-dp__corpo--cards",
    ".mk-dp.mk-dp-deposito > .mk-dp__corpo--cards:has(> .mk-dp-deposito__nivel)",
  ];

  it("os quatro corpos viram grade de 2 colunas com linhas min-content, só no popup (sem as linhas min-content os cartões encolhem e cortam)", () => {
    expect(blocos).toHaveLength(1);
    expect(regraCom(regras, ...CORPOS)).toMatch(/^\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);\s*grid-auto-flow: row dense;\s*grid-auto-rows: min-content;\s*align-content: start;\s*align-items: start;\s*$/);
    // Fora do bloco do popup, nenhuma regra dos pares (no celular o corpo segue em coluna).
    const fora = css.slice(0, blocos[0].ini) + css.slice(blocos[0].fim);
    for (const c of CORPOS) expect(fora.includes(c), c).toBe(false);
  });

  it("tudo de ponta a ponta; o 1º título e o bloco logo depois na coluna 1; o 2º na coluna 2 (pelo título, não pela posição); os títulos no fim da fileira", () => {
    expect(regraCom(regras, ...CORPOS.map((c) => `${c} > *`))).toMatch(/^\s*grid-column: 1 \/ -1;\s*$/);
    for (const n of [1, 2]) {
      const seletores = CORPOS.flatMap((c) => [`${c} > .mk-dp-titulo:nth-child(${n} of .mk-dp-titulo)`, `${c} > .mk-dp-titulo:nth-child(${n} of .mk-dp-titulo) + *`]);
      expect(regraCom(regras, ...seletores), `coluna ${n}`).toMatch(new RegExp(`^\\s*grid-column: ${n};\\s*$`));
    }
    expect(regraCom(regras, ...CORPOS.map((c) => `${c} > .mk-dp-titulo`))).toMatch(/^\s*align-self: end;\s*$/);
    expect(blocos[0].dentro).not.toMatch(/nth-last-child/);
  });

  it("quatro células em meia coluna ficam em 2 × 2 (Fornecimento, Consumo e Resumo operacional)", () => {
    expect(
      regraCom(
        regras,
        '.mk-dp .mk-dp__corpo--cards[id$="-painel-supl"]:has(> .mk-dp-kpis) > .mk-dp-cartao .mk-dp-grade',
        ".mk-dp.mk-dp-bebedouro > .mk-dp__corpo--cards > .mk-dp-titulo:nth-child(1 of .mk-dp-titulo) + .mk-dp-cartao .mk-dp-grade",
      ),
    ).toMatch(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  });

  it("aba Detalhes do pasto (D-PROD-236 do dono): o corpo é o painel `…-painel-detalhes`, com a grade `.mk-dp-area-organizada` de seções Lotação e Categorias, cada título logo antes do seu cartão; sem lotes, só Lotação", () => {
    const secoesDoCorpo = (corpo) => [...corpo.querySelectorAll(":scope > .mk-dp-area-organizada > .mk-dp-secao")];
    const { unmount } = render(<CascaDeTeste modelo={modeloV12()} abaInicial="detalhes" />);
    const corpo = screen.getByRole("tabpanel");
    expect(corpo.id).toMatch(/-painel-detalhes$/);
    expect(corpo.classList.contains("mk-dp__corpo--cards")).toBe(true);
    const secoes = secoesDoCorpo(corpo);
    expect(secoes.map((s) => s.firstElementChild?.textContent)).toEqual(["Lotação", "Categorias"]);
    for (const s of secoes) {
      const titulo = s.firstElementChild;
      expect(titulo.classList.contains("mk-dp-titulo"), titulo.textContent).toBe(true);
      expect(s.getAttribute("aria-labelledby")).toBe(titulo.querySelector("h3")?.id);
      expect(titulo.nextElementSibling?.classList.contains("mk-dp-cartao"), titulo.textContent).toBe(true);
    }
    unmount();
    render(<CascaDeTeste modelo={modeloV12({ qtd: 0 })} abaInicial="detalhes" />);
    expect(secoesDoCorpo(screen.getByRole("tabpanel")).map((s) => s.firstElementChild?.textContent)).toEqual(["Lotação"]);
  });
});
