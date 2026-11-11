/**
 * D-PROD-166 — com uma lista/janela aberta, clicar no botão de OUTRA abre a outra (antes ela abria e fechava
 * na hora). Duas causas, as duas cobertas aqui:
 *  1. a janela que fechava devolvia o foco ao próprio botão/campo, tirando o foco da janela nova (que fechava);
 *  2. nos grupos com UMA janela aberta por vez (pílulas, menus de coluna), o fechamento atrasado da anterior
 *     zerava o estado do grupo e apagava a nova.
 * Teclado continua igual: Esc fecha e o foco volta ao botão que abriu.
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { B1Popover } from "@/components/cadastro/base1/Base1Ui";
import B1Field from "@/components/cadastro/base1/B1Field";
import B1Select from "@/components/cadastro/base1/B1Select";
import { focoFicaOndeEsta, trocaJanela } from "@/components/cadastro/base1/janelaUnica";

afterEach(() => cleanup());

/**
 * O mouse descendo num botão, como no navegador: o jsdom não tem `PointerEvent`, e sem `button: 0` o Radix
 * trata o "clique fora" na hora (no navegador ele espera o fim do clique — é nessa espera que o defeito nascia).
 * @param {Element} el
 */
const mouseDesce = (el) => fireEvent(el, new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));

/** Deixa o Radix terminar o que agenda em `setTimeout` (foco ao montar/desmontar, ouvintes de "clique fora"). */
const esperar = (ms = 30) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

describe("trocaJanela (uma janela aberta por vez num grupo)", () => {
  it("abrir troca a aberta; fechar só vale para a que está aberta", () => {
    expect(trocaJanela(null, "a", true)).toBe("a");
    expect(trocaJanela("a", "b", true)).toBe("b");
    expect(trocaJanela("a", "a", false)).toBeNull();
    // fechamento atrasado de "a" depois que "b" abriu: não apaga "b"
    expect(trocaJanela("b", "a", false)).toBe("b");
  });
});

describe("focoFicaOndeEsta (ao fechar a janela)", () => {
  it("foco já noutro botão: não puxa de volta; foco perdido (body) ou dentro da janela: deixa o Radix devolver", () => {
    const janela = document.createElement("div");
    const dentro = document.createElement("button");
    janela.appendChild(dentro);
    const outro = document.createElement("button");
    document.body.append(janela, outro);
    const evento = () => {
      const e = new Event("focusScope.autoFocusOnUnmount", { cancelable: true });
      Object.defineProperty(e, "currentTarget", { value: janela });
      return e;
    };

    outro.focus();
    let e = evento();
    expect(focoFicaOndeEsta(e)).toBe(true);
    expect(e.defaultPrevented).toBe(true);

    outro.blur();
    e = evento();
    expect(focoFicaOndeEsta(e)).toBe(false);
    expect(e.defaultPrevented).toBe(false);

    dentro.focus();
    e = evento();
    expect(focoFicaOndeEsta(e)).toBe(false);
    janela.remove();
    outro.remove();
  });
});

/** Dois menus de um mesmo grupo (como os menus das colunas): estado único com o id do aberto. */
function GrupoDeMenus({ controle }) {
  const [aberta, setAberta] = React.useState(/** @type {string | null} */ ("a"));
  controle.abrir = setAberta;
  return (
    <div>
      {["a", "b"].map((id) => (
        <B1Popover
          key={id}
          open={aberta === id}
          onOpenChange={(o) => setAberta((x) => trocaJanela(x, id, o))}
          trigger={<button type="button">botão {id}</button>}
        >
          <button type="button">item de {id}</button>
        </B1Popover>
      ))}
    </div>
  );
}

describe("clicar no botão de outra janela com uma aberta", () => {
  it("menus do mesmo grupo: a janela nova abre e fica aberta (o foco não volta para o botão da anterior)", async () => {
    const controle = /** @type {{ abrir: (id: string | null) => void }} */ ({ abrir: () => {} });
    render(<GrupoDeMenus controle={controle} />);
    await esperar();
    expect(screen.getByText("item de a")).toBeInTheDocument();

    // No navegador: o mouse desce no botão B (o Radix adia o "clique fora" da A para o fim do clique e o foco
    // vai para B); o clique de B troca a aberta ANTES de esse "clique fora" ser confirmado.
    const b = screen.getByRole("button", { name: "botão b" });
    mouseDesce(b);
    act(() => b.focus());
    act(() => controle.abrir("b"));
    await esperar(60);

    expect(screen.queryByText("item de a")).toBeNull();
    expect(screen.getByText("item de b")).toBeInTheDocument();
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "botão a" }));
  });

  it("Esc ainda fecha e devolve o foco ao botão que abriu", async () => {
    const controle = /** @type {{ abrir: (id: string | null) => void }} */ ({ abrir: () => {} });
    render(<GrupoDeMenus controle={controle} />);
    await esperar();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await esperar(60);
    expect(screen.queryByText("item de a")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "botão a" }));
  });

  it("listas dos campos (B1Select): com a de Sexo aberta, clicar em Raça abre a de Raça", async () => {
    render(
      <div className="b1 mg-b1-form-grid">
        <B1Field label="Sexo" span={6}>
          <B1Select value="" onChange={() => {}} aria-label="Sexo">
            <option value="">SELECIONE</option>
            <option value="Macho">Macho</option>
            <option value="Fêmea">Fêmea</option>
          </B1Select>
        </B1Field>
        <B1Field label="Raça" span={6}>
          <B1Select value="" onChange={() => {}} aria-label="Raça">
            <option value="">SELECIONE</option>
            <option value="NELORE">NELORE</option>
            <option value="ANGUS">ANGUS</option>
          </B1Select>
        </B1Field>
      </div>,
    );
    const sexo = screen.getByRole("combobox", { name: "Sexo" });
    const raca = screen.getByRole("combobox", { name: "Raça" });
    fireEvent.click(sexo);
    await esperar();
    expect(screen.getByRole("option", { name: "Macho" })).toBeInTheDocument();

    // mouse desce em Raça (o foco vai para ela), sobe e clica — como no navegador
    mouseDesce(raca);
    fireEvent.mouseDown(raca, { button: 0 });
    act(() => raca.focus());
    fireEvent.pointerUp(raca, { button: 0 });
    fireEvent.mouseUp(raca, { button: 0 });
    fireEvent.click(raca);
    await esperar(60);

    expect(screen.queryByRole("option", { name: "Macho" })).toBeNull();
    expect(screen.getByRole("option", { name: "NELORE" })).toBeInTheDocument();
    expect(raca).toHaveAttribute("aria-expanded", "true");
  });
});
