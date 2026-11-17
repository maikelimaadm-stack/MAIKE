// @vitest-environment jsdom
/**
 * D-PROD-220 — casca v12 dos detalhes de uma tela (cocho, depósito, bebedouro,
 * tarefa): `CascaDetalhe` publica título, sub e ‹ Voltar no `LancLoteDialogo`
 * (o Esc volta; num formulário empilhado, `escVolta={false}`, o Esc é
 * ignorado), fica filha direta do `.mk-ll` (o popup a partir de 768 px
 * depende disso), desenha o corpo e o rodapé, e fora do diálogo usa o
 * cabeçalho próprio. Peças novas: `Nivel` e `Acao`.
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import CascaDetalhe from "@/components/mapa/detalhes-lote/CascaDetalhe";
import { Acao, Nivel, RodapePilulas } from "@/components/mapa/detalhes-lote/blocos";

/** Largura da tela para os `matchMedia` (desktop 1280, tablet 820, celular 390). */
const largura = (w) => {
  window.matchMedia = /** @type {any} */ ((q) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    const matches = (!min || w >= Number(min[1])) && (!max || w <= Number(max[1]));
    return { matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  });
};
const original = window.matchMedia;
afterEach(() => {
  cleanup();
  window.matchMedia = original;
});

const tituloDoDialogo = () => document.querySelector(".mk-ll-dlg__titulo")?.textContent;
const subDoDialogo = () => document.querySelector(".mk-ll-dlg__lotes")?.textContent ?? null;
const esc = () => act(async () => { fireEvent.keyDown(document.activeElement || document.body, { key: "Escape", code: "Escape" }); });

/** Tela de teste: principal › histórico (empilhada, com ‹ Voltar). */
function TelaDeTeste() {
  const [tela, setTela] = React.useState("principal");
  const historico = tela === "historico";
  return (
    <CascaDetalhe
      titulo={historico ? "Histórico do cocho" : "Cocho 07"}
      sub={historico ? "Cocho 07" : "Pasto 07 · Retiro"}
      onVoltar={historico ? () => setTela("principal") : null}
      chaveTela={tela}
      anim={historico ? "empurrar" : null}
      rodape={historico ? null : <RodapePilulas itens={[{ rotulo: "Histórico", onClick: () => setTela("historico") }]} />}
    >
      <div data-testid={`corpo-${tela}`} />
    </CascaDetalhe>
  );
}

const noDialogo = (filho, onOpenChange = () => {}) =>
  render(
    <LancLoteDialogo open onOpenChange={onOpenChange} titulo="Ponto de Suplementação" largo somenteLeitura popupDesde="tablet">
      {filho}
    </LancLoteDialogo>,
  );

describe("CascaDetalhe no diálogo", () => {
  it("publica título e sub no cabeçalho; a raiz .mk-dp é filha direta do .mk-ll; modo pela largura", () => {
    largura(1280);
    noDialogo(<TelaDeTeste />);
    expect(tituloDoDialogo()).toBe("Cocho 07");
    expect(subDoDialogo()).toBe("Pasto 07 · Retiro");
    const raiz = document.querySelector(".mk-ll > .mk-dp");
    expect(raiz).toBeTruthy();
    expect(raiz?.getAttribute("data-modo")).toBe("desktop");
    expect(raiz?.querySelector(".mk-dp__corpo--cards")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Voltar" })).toBeNull();
    // sem cabeçalho próprio dentro do diálogo
    expect(document.querySelector(".mk-dp-cab")).toBeNull();
  });

  it("tela empilhada: ‹ Voltar no cabeçalho do diálogo; o Esc volta sem fechar; o rodapé vazio some", async () => {
    largura(820);
    let fechou = 0;
    noDialogo(<TelaDeTeste />, (aberto) => { if (!aberto) fechou += 1; });
    expect(document.querySelector(".mk-dp")?.getAttribute("data-modo")).toBe("tablet");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Histórico" })); });
    expect(screen.getByTestId("corpo-historico")).toBeTruthy();
    expect(tituloDoDialogo()).toBe("Histórico do cocho");
    expect(subDoDialogo()).toBe("Cocho 07");
    expect(document.querySelector(".mk-dp__corpo")?.className).toContain("mk-dp-anim--empurrar");
    expect(document.querySelector(".mk-dp__rodape")?.childElementCount).toBe(0);
    expect(screen.getByRole("button", { name: "Voltar" })).toBeTruthy();
    await esc();
    expect(screen.getByTestId("corpo-principal")).toBeTruthy();
    expect(tituloDoDialogo()).toBe("Cocho 07");
    expect(fechou).toBe(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Histórico" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Voltar" })); });
    expect(screen.getByTestId("corpo-principal")).toBeTruthy();
  });

  it("formulário empilhado (escVolta={false}, D-PROD-220): o ‹ Voltar fica e o Esc é ignorado no popup e na tela cheia — o que foi digitado não se perde", async () => {
    function FormularioEmpilhado() {
      const [tela, setTela] = React.useState("form");
      return tela === "form" ? (
        <CascaDetalhe titulo="Lançamento" sub="Cocho 07" onVoltar={() => setTela("principal")} escVolta={false} chaveTela="form">
          <textarea aria-label="Observação" />
        </CascaDetalhe>
      ) : (
        <CascaDetalhe titulo="Cocho 07" chaveTela="principal">
          <div data-testid="corpo-principal" />
        </CascaDetalhe>
      );
    }
    for (const w of [1280, 390]) {
      largura(w);
      let fechou = 0;
      noDialogo(<FormularioEmpilhado />, (aberto) => { if (!aberto) fechou += 1; });
      const campo = /** @type {HTMLTextAreaElement} */ (screen.getByLabelText("Observação"));
      fireEvent.change(campo, { target: { value: "BOIA VAZANDO" } });
      campo.focus();
      await esc();
      expect(tituloDoDialogo(), `Esc a ${w}px`).toBe("Lançamento");
      expect(/** @type {HTMLTextAreaElement} */ (screen.getByLabelText("Observação")).value).toBe("BOIA VAZANDO");
      expect(fechou).toBe(0);
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Voltar" })); });
      expect(screen.getByTestId("corpo-principal")).toBeTruthy();
      expect(tituloDoDialogo()).toBe("Cocho 07");
      cleanup();
    }
  });

  it("ao sair, devolve o título do diálogo", () => {
    largura(1280);
    const { rerender } = noDialogo(<TelaDeTeste />);
    expect(tituloDoDialogo()).toBe("Cocho 07");
    rerender(
      <LancLoteDialogo open onOpenChange={() => {}} titulo="Ponto de Suplementação" largo somenteLeitura popupDesde="tablet">
        <div />
      </LancLoteDialogo>,
    );
    expect(tituloDoDialogo()).toBe("Ponto de Suplementação");
  });
});

describe("CascaDetalhe fora do diálogo", () => {
  it("desenha o cabeçalho próprio (com ‹ Voltar na tela empilhada) ou nenhum com semCabecalho; celular", async () => {
    largura(390);
    render(<TelaDeTeste />);
    expect(document.querySelector(".mk-dp")?.getAttribute("data-modo")).toBe("celular");
    expect(screen.getByRole("heading", { name: "Cocho 07" })).toBeTruthy();
    expect(screen.getByText("Pasto 07 · Retiro")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Histórico" })); });
    expect(screen.getByRole("heading", { name: "Histórico do cocho" })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Voltar" })); });
    expect(screen.getByRole("heading", { name: "Cocho 07" })).toBeTruthy();
    cleanup();
    render(<CascaDetalhe titulo="Bebedouro 01" semCabecalho><div /></CascaDetalhe>);
    expect(screen.queryByRole("heading")).toBeNull();
  });
});

describe("Nivel e Acao", () => {
  it("Nivel: figura (nó ou URL), rótulo, valor e linhas (vazias saem); sem valor, sem o número", () => {
    largura(1280);
    const { container, rerender } = render(
      <div className="mk-dp">
        <Nivel figura={<svg data-testid="figura" />} rotulo="Restante do ciclo (estimado)" valor="65%" linhas={["260 kg de 400 kg", "", null, "Restam 11,1 dia(s)"]} />
      </div>,
    );
    expect(screen.getByTestId("figura")).toBeTruthy();
    expect(screen.getByText("Restante do ciclo (estimado)").className).toBe("mk-dp-nivel__rot");
    expect(screen.getByText("65%").tagName).toBe("STRONG");
    expect([...container.querySelectorAll(".mk-dp-nivel__linha")].map((l) => l.textContent)).toEqual(["260 kg de 400 kg", "Restam 11,1 dia(s)"]);
    rerender(
      <div className="mk-dp">
        <Nivel figura="/icone.png" rotulo="Nível do depósito" linhas={["Sem estimativa."]} />
      </div>,
    );
    expect(container.querySelector(".mk-dp-nivel__fig")?.getAttribute("style")).toContain("/icone.png");
    expect(container.querySelector(".mk-dp-nivel__val")).toBeNull();
  });

  it("Acao: botão de texto; perigo; repassa aria-label e disabled", () => {
    let n = 0;
    render(
      <div className="mk-dp">
        <Acao tom="perigo" aria-label="Excluir a leitura de 12/11/2026" onClick={() => { n += 1; }}>Excluir</Acao>
        <Acao disabled>Ver tudo</Acao>
      </div>,
    );
    const excluir = screen.getByRole("button", { name: "Excluir a leitura de 12/11/2026" });
    expect(excluir.className).toContain("mk-dp-acao--perigo");
    fireEvent.click(excluir);
    expect(n).toBe(1);
    expect(screen.getByRole("button", { name: "Ver tudo" }).hasAttribute("disabled")).toBe(true);
  });
});
