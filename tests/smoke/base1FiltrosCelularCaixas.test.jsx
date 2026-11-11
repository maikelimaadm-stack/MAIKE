/**
 * D-PROD-168 / D-PROD-171 — pedidos do proprietário:
 *  - no celular, só o menu da coluna da tabela ("⋮": filtro avançado, autoajustar, congelar, ocultar) abre como
 *    "Mais opções" (a janela flutuante); os filtros (funil "Filtros", pílulas, filtro do campo e da coluna) continuam
 *    nas folhas de baixo do celular, como antes da D-PROD-168 (D-PROD-171 revoga essa parte dela);
 *  - nas listas de marcar vários a caixa de marcar aparece À DIREITA, com o ✓ dentro quando marcada;
 *  - campos de marcar vários usam a lista do Sistema Produtivo (`B1MultiSelecao`), que aceita `{ value, label }`.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import FiltrosRapidos, { FiltrosRapidosSlotContext } from "@/components/cadastro/base1/FiltrosRapidos";
import FiltroPorCampo from "@/components/cadastro/base1/FiltroPorCampo";
import CadastroColunaFiltro from "@/components/cadastro/base1/CadastroColunaFiltro";
import B1MultiSelecao from "@/components/cadastro/base1/B1MultiSelecao";
import MapaFiltroSelecao from "@/components/mapa/MapaFiltroSelecao";

const COLS = [
  { id: "nome", label: "Nome" },
  { id: "sexo", label: "Sexo" },
];
const ROWS = [
  { id: "1", nome: "A", sexo: "Macho" },
  { id: "2", nome: "B", sexo: "Fêmea" },
  { id: "3", nome: "C", sexo: "Macho" },
];

/** Tela de celular (390px): toda consulta de largura máxima casa. */
const telaDeCelular = () =>
  vi.stubGlobal("matchMedia", (consulta) => ({
    matches: /max-width/.test(consulta),
    media: consulta,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));

function Faixa() {
  const [slot, setSlot] = React.useState(null);
  return (
    <FiltrosRapidosSlotContext.Provider value={slot}>
      <div ref={setSlot} />
      <FiltrosRapidos
        columns={COLS}
        rows={ROWS}
        getFieldValue={(l, id) => l[id]}
        filters={{}}
        onFilterChange={() => {}}
        onClearFilters={() => {}}
        sort={{ key: "nome", direction: "asc" }}
        onSortChange={() => {}}
        storageKey="teste_celular"
        defaultIds={["sexo"]}
      />
    </FiltrosRapidosSlotContext.Provider>
  );
}

const semFolhaDeBaixo = () => expect(document.querySelector(".mk-sheet-root")).toBeNull();

beforeEach(() => {
  localStorage.removeItem("teste_celular_filtrosRapidos");
  telaDeCelular();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.removeItem("teste_celular_filtrosRapidos");
});

describe("celular: só o menu da coluna abre como 'Mais opções'; os filtros ficam nas folhas", () => {
  it("sem a faixa de pílulas no celular (os filtros abrem pelo funil, na folha 'Filtros')", () => {
    render(<Faixa />);
    expect(screen.queryByRole("button", { name: "Adicionar ou tirar filtros" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Sexo/ })).toBeNull();
  });

  it("'Filtrar por campo' abre na folha de baixo", () => {
    const ancora = /** @type {DOMRect} */ ({ left: 20, right: 60, top: 100, bottom: 136, width: 40, height: 36, x: 20, y: 100, toJSON() {} });
    render(<FiltroPorCampo colunas={COLS} filtros={{}} ancora={ancora} onEscolher={() => {}} onFechar={() => {}} />);
    expect(document.querySelector(".mk-sheet-root")).not.toBeNull();
    expect(document.querySelector(".fpc--pop")).toBeNull();
  });

  it("o filtro do cabeçalho da coluna abre na folha de baixo", () => {
    render(
      <>
        <table>
          <thead>
            <tr>
              <th>
                Sexo <button type="button" data-b1-col-menu="sexo" aria-label="Abrir menu da coluna Sexo" />
              </th>
            </tr>
          </thead>
        </table>
        <CadastroColunaFiltro
          rotulo="Sexo"
          tipo="texto"
          ancora='[data-b1-col-menu="sexo"]'
          valores={["Macho", "Fêmea"]}
          totais={2}
          atual={null}
          onAplicar={() => {}}
          onFechar={() => {}}
        />
      </>,
    );
    expect(document.querySelector(".mk-sheet-root")).not.toBeNull();
    expect(document.querySelector(".b1-col-pop")).toBeNull();
  });

  it("código: o menu da coluna não usa a folha (abre como 'Mais opções'); os filtros usam", () => {
    const ler = (p) => readFileSync(join(process.cwd(), p), "utf8");
    expect(ler("src/components/cadastro/base1/Base1Grid.jsx")).not.toMatch(/MobileSheet|useCelular/);
    for (const arquivo of ["FiltrosRapidos.jsx", "FiltroPorCampo.jsx", "CadastroColunaFiltro.jsx"]) {
      expect(ler(`src/components/cadastro/base1/${arquivo}`), arquivo).toMatch(/MobileSheet/);
    }
    expect(ler("src/components/cadastro/base1/CadastroBase1Grade.jsx")).toMatch(/menuCelularAberto=\{menuFiltrosCelular\}/);
  });
});

describe("caixa de marcar à direita", () => {
  it("janela do filtro: 'Todos' e cada valor têm a caixa; Ordenar continua só com o ✓", () => {
    vi.unstubAllGlobals(); // desktop: a faixa de pílulas aparece
    render(<Faixa />);
    fireEvent.click(screen.getByRole("button", { name: /Sexo/ }));
    const opcoes = within(screen.getByRole("dialog", { name: "Sexo" })).getAllByRole("option");
    expect(opcoes.map((o) => o.querySelector(".b1-fr-op__txt")?.textContent)).toEqual(["Todos", "Fêmea", "Macho"]);
    for (const o of opcoes) {
      const caixa = o.querySelector(".b1-fr-box");
      expect(caixa).not.toBeNull();
      expect(caixa).not.toHaveClass("b1-fr-box--unica");
    }
  });

  it("CSS: a caixa vai para o fim da linha (order), com borda e o ✓ branco no verde quando marcada", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/base1-design-ajustes.css"), "utf8");
    const regra = css.slice(css.indexOf("body.b1-tela .b1-fr-op .b1-fr-box:not(.b1-fr-box--unica)"));
    expect(regra.slice(0, regra.indexOf("}"))).toMatch(/order:\s*9;[\s\S]*width:\s*18px;[\s\S]*border:\s*1\.5px solid #D1D0CA/);
    expect(css).toMatch(/\.b1-fr-op\[aria-selected="true"\] \.b1-fr-box:not\(\.b1-fr-box--unica\)[^{]*\{[^}]*background:\s*#32d65e[^}]*color:\s*#fff/);
    const unificado = readFileSync(join(process.cwd(), "src/styles/mk-unificado.css"), "utf8");
    expect(unificado).toMatch(/\.mk-map-multi-options label:not\(#mk-a\):not\(#mk-b\) \{[^}]*justify-content:\s*space-between/);
  });

  it("campo de marcar vários: lista com o texto e a caixa à direita; aceita { value, label }", () => {
    const onChange = vi.fn();
    const opcoes = [
      { value: "fornecedor", label: "Fornecedor" },
      { value: "cliente", label: "Cliente" },
      { value: "outros", label: "Outros" },
    ];
    render(<B1MultiSelecao rotulo="Papéis do parceiro" opcoes={opcoes} valor={["outros", "fornecedor"]} onChange={onChange} />);
    const campo = screen.getByRole("combobox", { name: "Papéis do parceiro" });
    expect(campo).toHaveValue("Fornecedor, Outros"); // na ordem da lista
    fireEvent.click(campo);
    const lista = screen.getByRole("dialog", { name: "Papéis do parceiro" });
    const linhas = [...lista.querySelectorAll(".mk-map-multi-options label")];
    expect(linhas.map((l) => [l.firstElementChild?.tagName, l.lastElementChild?.getAttribute("type")])).toEqual([
      ["SPAN", "checkbox"],
      ["SPAN", "checkbox"],
      ["SPAN", "checkbox"],
    ]);
    expect(within(lista).getByRole("checkbox", { name: "Fornecedor" })).toBeChecked();
    expect(within(lista).getByRole("checkbox", { name: "Cliente" })).not.toBeChecked();
    fireEvent.click(within(lista).getByRole("checkbox", { name: "Cliente" }));
    expect(onChange).toHaveBeenCalledWith(["fornecedor", "cliente", "outros"]);
  });

  it("filtros do mapa: o texto vem antes e a caixa fica à direita", () => {
    render(
      <MapaFiltroSelecao value="todos" onChange={() => {}} aria-label="Sistema">
        <option value="todos">Todos</option>
        <option value="cria">Cria</option>
        <option value="recria">Recria</option>
      </MapaFiltroSelecao>,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Sistema" }));
    const linhas = [...document.querySelectorAll(".mk-map-multi-options label")];
    expect(linhas).toHaveLength(3);
    for (const l of linhas) {
      expect(l.firstElementChild?.tagName).toBe("SPAN");
      expect(l.lastElementChild).toHaveAttribute("type", "checkbox");
    }
  });
});
