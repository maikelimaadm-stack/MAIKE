// @vitest-environment jsdom
/**
 * Detalhes do Lote v12 (D-PROD-V12) — peças puras de
 * `src/components/mapa/detalhes-lote/blocos.jsx` e o visual comum de
 * `src/styles/mk-detalhes-pasto.css`.
 *
 * - Abas: badge (0 = pasto sem lote → só "Lotes", como o v12), tablist com
 *   tabindex móvel, `aria-controls` só na ativa, ← → Home End.
 * - CaixaMarcar: `desabilitado` (como os rodapés; `disabled` é apelido), "meio"
 *   = `aria-checked="mixed"`, o clique não sobe para o item.
 * - Item / ListaItens / GrupoMarcar: o item abre uma vez, a caixa não abre.
 * - Busca: foco e placeholder como medidos no v12.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import {
  Abas,
  Busca,
  CaixaMarcar,
  GrupoMarcar,
  Item,
  ListaItens,
  idsDaAba,
} from "@/components/mapa/detalhes-lote/blocos.jsx";

const css = readFileSync("src/styles/mk-detalhes-pasto.css", "utf8");

/** Corpo da regra CSS com exatamente este seletor (primeira ocorrência). */
function regra(seletor) {
  const i = css.indexOf(`${seletor} {`);
  if (i < 0) return null;
  return css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
}

const ABAS = [
  { id: "detalhes", rotulo: "Detalhes" },
  { id: "lotes", rotulo: "Lotes", badge: 6 },
  { id: "historico", rotulo: "Histórico" },
  { id: "supl", rotulo: "Suplementação" },
];

function AbasComEstado({ inicial = "lotes", onMudar = () => {} }) {
  const [ativa, setAtiva] = React.useState(inicial);
  return (
    <Abas
      abas={ABAS}
      ativa={ativa}
      idBase="pasto"
      onMudar={(id) => {
        onMudar(id);
        setAtiva(id);
      }}
    />
  );
}

describe("Abas", () => {
  it("badge vira parte do nome acessível; 0, null, vazio e false não desenham badge", () => {
    const { container, rerender } = render(<Abas abas={ABAS} ativa="lotes" onMudar={() => {}} />);
    expect(screen.getByRole("tab", { name: "Lotes 6" })).toBeInTheDocument();
    expect(container.querySelectorAll(".mk-dp-aba__badge")).toHaveLength(1);

    for (const badge of [0, null, "", false]) {
      rerender(<Abas abas={[{ id: "lotes", rotulo: "Lotes", badge }]} ativa="lotes" onMudar={() => {}} />);
      expect(screen.getByRole("tab", { name: "Lotes" })).toBeInTheDocument();
      expect(container.querySelector(".mk-dp-aba__badge")).toBeNull();
    }
  });

  it("tabindex móvel e aria-controls só na aba ativa", () => {
    render(<Abas abas={ABAS} ativa="lotes" idBase="pasto" onMudar={() => {}} />);
    const ativa = screen.getByRole("tab", { selected: true });
    expect(ativa).toHaveAccessibleName("Lotes 6");
    expect(ativa).toHaveAttribute("tabindex", "0");
    expect(ativa).toHaveAttribute("id", idsDaAba("pasto", "lotes").aba);
    expect(ativa).toHaveAttribute("aria-controls", idsDaAba("pasto", "lotes").painel);
    const inativa = screen.getByRole("tab", { name: "Detalhes" });
    expect(inativa).toHaveAttribute("tabindex", "-1");
    expect(inativa).not.toHaveAttribute("aria-controls");
    expect(screen.getByRole("tablist")).toHaveAccessibleName("Seções do pasto");
  });

  it("setas, Home e End mudam de aba e levam o foco (ativação automática, com volta)", () => {
    const onMudar = vi.fn();
    render(<AbasComEstado onMudar={onMudar} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Lotes 6" }), { key: "ArrowRight" });
    expect(onMudar).toHaveBeenLastCalledWith("historico");
    expect(screen.getByRole("tab", { name: "Histórico" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Histórico" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(document.activeElement, { key: "End" });
    expect(onMudar).toHaveBeenLastCalledWith("supl");
    fireEvent.keyDown(document.activeElement, { key: "ArrowRight" });
    expect(onMudar).toHaveBeenLastCalledWith("detalhes");
    fireEvent.keyDown(document.activeElement, { key: "ArrowLeft" });
    expect(onMudar).toHaveBeenLastCalledWith("supl");
    fireEvent.keyDown(document.activeElement, { key: "Home" });
    expect(onMudar).toHaveBeenLastCalledWith("detalhes");
    expect(screen.getByRole("tab", { name: "Detalhes" })).toHaveFocus();

    // Clicar na aba já ativa não chama onMudar de novo
    const chamadas = onMudar.mock.calls.length;
    fireEvent.click(screen.getByRole("tab", { name: "Detalhes" }));
    expect(onMudar).toHaveBeenCalledTimes(chamadas);
  });
});

describe("CaixaMarcar", () => {
  it("estados viram aria-checked (true / false / mixed) e o clique não sobe", () => {
    const onAlternar = vi.fn();
    const onPai = vi.fn();
    const { rerender } = render(
      <div onClick={onPai}>
        <CaixaMarcar estado="meio" rotulo="Selecionar todos" onAlternar={onAlternar} />
      </div>,
    );
    const caixa = screen.getByRole("checkbox", { name: "Selecionar todos" });
    expect(caixa).toHaveAttribute("aria-checked", "mixed");
    fireEvent.click(caixa);
    expect(onAlternar).toHaveBeenCalledTimes(1);
    expect(onPai).not.toHaveBeenCalled();

    rerender(
      <div onClick={onPai}>
        <CaixaMarcar estado rotulo="Selecionar todos" onAlternar={onAlternar} />
      </div>,
    );
    expect(caixa).toHaveAttribute("aria-checked", "true");
    rerender(
      <div onClick={onPai}>
        <CaixaMarcar estado="vazia" rotulo="Selecionar todos" onAlternar={onAlternar} />
      </div>,
    );
    expect(caixa).toHaveAttribute("aria-checked", "false");
  });

  it("`desabilitado` (como nos rodapés) e o apelido `disabled` travam a caixa", () => {
    const onAlternar = vi.fn();
    const { rerender } = render(<CaixaMarcar rotulo="Selecionar L-1" onAlternar={onAlternar} desabilitado />);
    const caixa = screen.getByRole("checkbox", { name: "Selecionar L-1" });
    expect(caixa).toBeDisabled();
    fireEvent.click(caixa);
    expect(onAlternar).not.toHaveBeenCalled();

    rerender(<CaixaMarcar rotulo="Selecionar L-1" onAlternar={onAlternar} disabled />);
    expect(caixa).toBeDisabled();
    rerender(<CaixaMarcar rotulo="Selecionar L-1" onAlternar={onAlternar} />);
    expect(caixa).toBeEnabled();
  });
});

describe("ListaItens e Item", () => {
  it("o item abre uma vez; a caixa marca sem abrir; o cabeçalho marca todos", () => {
    const abrir = vi.fn();
    const marcar = vi.fn();
    const todos = vi.fn();
    render(
      <ListaItens titulo="Pasto 07 (314)" marcacao="meio" onMarcarTodos={todos} rotuloTodos="Selecionar todos os lotes">
        <Item titulo="L-2026-008" meta="38 cb · 38,0 UA · VACA" marcado onMarcar={marcar} chevron onClick={abrir} />
      </ListaItens>,
    );
    const lista = screen.getByRole("list", { name: "Pasto 07 (314)" });
    const corpo = within(lista).getByRole("button", { name: /^L-2026-008/ });
    fireEvent.click(corpo);
    expect(abrir).toHaveBeenCalledTimes(1);

    const caixa = screen.getByRole("checkbox", { name: "Selecionar L-2026-008" });
    expect(caixa).toHaveAttribute("aria-checked", "true");
    fireEvent.click(caixa);
    expect(marcar).toHaveBeenCalledTimes(1);
    expect(abrir).toHaveBeenCalledTimes(1);

    const caixaTodos = screen.getByRole("checkbox", { name: "Selecionar todos os lotes" });
    expect(caixaTodos).toHaveAttribute("aria-checked", "mixed");
    fireEvent.click(caixaTodos);
    expect(todos).toHaveBeenCalledTimes(1);
  });
});

describe("GrupoMarcar", () => {
  it("cabeçalho meio-marcado com contador n/N; cada linha alterna a sua chave", () => {
    const alternar = vi.fn();
    const alternarTodos = vi.fn();
    render(
      <GrupoMarcar
        titulo="Alertas"
        itens={[
          { chave: "alNivel", rotulo: "Situação", marcado: true },
          { chave: "alTipo", rotulo: "Tipo de alerta", marcado: false },
        ]}
        onAlternar={alternar}
        onAlternarTodos={alternarTodos}
      />,
    );
    const grupo = screen.getByRole("group", { name: "Alertas" });
    const caixas = within(grupo).getAllByRole("checkbox");
    expect(caixas[0]).toHaveAttribute("aria-checked", "mixed");
    expect(caixas[0]).toHaveTextContent("1/2");
    fireEvent.click(caixas[0]);
    expect(alternarTodos).toHaveBeenCalledTimes(1);
    fireEvent.click(within(grupo).getByRole("checkbox", { name: "Tipo de alerta" }));
    expect(alternar).toHaveBeenCalledWith("alTipo");
  });
});

describe("Busca", () => {
  it("campo de busca com nome acessível e onMudar", () => {
    const onMudar = vi.fn();
    render(<Busca valor="" onMudar={onMudar} placeholder="Filtrar" />);
    const campo = screen.getByRole("searchbox", { name: "Filtrar" });
    fireEvent.change(campo, { target: { value: "peso" } });
    expect(onMudar).toHaveBeenCalledWith("peso");
  });

  it("foco e placeholder como no v12: anel de 2 px no campo, rótulo sem borda de foco, placeholder #757575", () => {
    const foco = regra(".mk-dp .mk-dp-busca__in:focus-visible");
    expect(foco).toMatch(/outline:\s*2px solid #3db5c9/);
    expect(foco).toMatch(/outline-offset:\s*2px/);
    expect(css).not.toMatch(/\.mk-dp-busca:focus-within/);
    const placeholder = regra(".mk-dp .mk-dp-busca__in::placeholder");
    expect(placeholder).toMatch(/color:\s*#757575/);
    expect(placeholder).toMatch(/opacity:\s*1/);
  });

  it("as abas usam o anel de 2 px por fora do v12 (sem a exceção de contorno por dentro)", () => {
    const excecao = css.match(/\.mk-dp :is\(([^)]*)\):focus-visible\s*\{[^}]*outline-offset:\s*-2px/);
    expect(excecao).not.toBeNull();
    expect(excecao[1]).not.toMatch(/mk-dp-aba/);
  });
});
