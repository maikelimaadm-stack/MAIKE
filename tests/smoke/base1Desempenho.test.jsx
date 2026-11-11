/**
 * D-PROD-165 — lentidão: alguns `:has()` faziam o Chrome recalcular o estilo da página INTEIRA a cada mudança no DOM
 * (rolar a lista, abrir/fechar janela, digitar). Medido com 3.000 lotes: rolar a lista caiu de ~1,3 s para ~0,2 s de
 * estilo; abrir/fechar janela deixou de recalcular a página toda.
 *  - `body:has(.cadastro-b1--full-page)` virou `body.b1-tela`, posta pelo casco Base1 (`useCascoBase1`);
 *  - `form:has(.mk-lanc)` virou `form[data-mk-lanc]`, posto pelo `LancField`;
 *  - `div:has(+ [role="dialog"] > .mg-confirm-dialog)` virou classe no fundo e na camada do `ConfirmDialog`;
 *  - `.mg-shell:has(.b1-fr)` virou `.mg-shell[data-b1-faixa]`, posto pela faixa de filtros.
 */
import React from "react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import LancField from "@/components/cadastro/base1/LancField";
import { CLASSE_TELA_BASE1 } from "@/components/cadastro/base1/telaBase1";

afterEach(() => cleanup());

describe("CSS sem os :has() que recalculavam a página inteira", () => {
  const pasta = join(process.cwd(), "src/styles");
  const folhas = readdirSync(pasta).filter((n) => n.endsWith(".css"));
  const semComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const proibidos = [
    // `:has()` com descendente ancorado no topo da página (qualquer mudança no DOM reavalia tudo)
    [/(^|[\s,>+~(])(body|html|:root):has\(/, "body/html:has(…) — use a classe body.b1-tela"],
    [/(^|[\s,>+~(])form:has\(/, "form:has(…) — use um atributo posto pelo componente (ex.: form[data-mk-lanc])"],
    // `:has()` de irmão em qualquer div: o #root vira candidato quando uma janela entra no <body>
    [/(^|[\s,>+~(])div:has\(\s*\+/, "div:has(+ …) — marque o elemento com uma classe"],
    [/\.mg-shell:has\(\.b1-fr\)/, ".mg-shell:has(.b1-fr) — use .mg-shell[data-b1-faixa]"],
  ];

  it.each(folhas)("%s", (nome) => {
    const css = semComentarios(readFileSync(join(pasta, nome), "utf8"));
    for (const [re, dica] of proibidos) expect(re.test(css), `${nome}: ${dica}`).toBe(false);
  });
});

describe("marcas que substituem os :has()", () => {
  it("body.b1-tela enquanto houver casco Base1 na página (várias telas contam juntas)", () => {
    expect(document.body.classList.contains(CLASSE_TELA_BASE1)).toBe(false);
    const a = render(
      <CadastroWorkspace title="Lotes" pageLayout="base1-list">
        <p>lista</p>
      </CadastroWorkspace>,
    );
    expect(document.querySelector(".cadastro-b1--full-page")).not.toBeNull();
    expect(document.body.classList.contains(CLASSE_TELA_BASE1)).toBe(true);
    const b = render(
      <CadastroWorkspace title="Setores" pageLayout="base1-list">
        <p>outra</p>
      </CadastroWorkspace>,
    );
    a.unmount();
    expect(document.body.classList.contains(CLASSE_TELA_BASE1)).toBe(true);
    b.unmount();
    expect(document.body.classList.contains(CLASSE_TELA_BASE1)).toBe(false);
  });

  it("tela fora do layout Base1 não liga a classe", () => {
    render(
      <CadastroWorkspace title="Outra" pageLayout="default">
        <p>conteúdo</p>
      </CadastroWorkspace>,
    );
    expect(document.body.classList.contains(CLASSE_TELA_BASE1)).toBe(false);
  });

  it("form com campo de lançamento ganha data-mk-lanc; sem campo, perde", () => {
    function Formulario({ campos }) {
      return (
        <form data-testid="f">
          {Array.from({ length: campos }, (_, i) => (
            <LancField key={i} label={`Peso ${i}`}>
              <input defaultValue="" />
            </LancField>
          ))}
        </form>
      );
    }
    const { rerender, getByTestId } = render(<Formulario campos={2} />);
    expect(getByTestId("f")).toHaveAttribute("data-mk-lanc");
    rerender(<Formulario campos={1} />);
    expect(getByTestId("f")).toHaveAttribute("data-mk-lanc");
    rerender(<Formulario campos={0} />);
    expect(getByTestId("f")).not.toHaveAttribute("data-mk-lanc");
  });
});
