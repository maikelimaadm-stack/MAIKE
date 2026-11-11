/**
 * D-PROD-164 — o desenho do design "Cadastro de Lote" vale para TODAS as telas do motor Base1, não só Lotes:
 * densidade `compacto` em todo formulário, registro sem abas no cartão (sem a faixa de cabeçalho antiga),
 * chave "Ativo" em caixa, título de grupo do design e seletor sem "SELECIONE" por cima do rótulo.
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import CadastroRecordHeader from "@/components/cadastro/base1/CadastroRecordHeader";
import Base1PanelTabs from "@/components/cadastro/base1/Base1PanelTabs";
import B1Select from "@/components/cadastro/base1/B1Select";
import B1Field, { B1CartaoCampos, B1TituloGrupo, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import { SecaoForm } from "@/components/gestao/GestaoFormParts";
import FormularioMarca from "@/components/marcas/FormularioMarca";

afterEach(() => cleanup());

const cabecalho = (extra = {}) => <CadastroRecordHeader title="Nova marca" index={2} total={5} onGo={() => {}} {...extra} />;

const registro = (corpo, extra = {}) => (
  <CadastroListaChrome
    recordMode
    recordEditing={false}
    joinTableToolbar
    recordHeader={cabecalho(extra)}
    recordBody={corpo}
    onNew={() => {}}
  >
    <div />
  </CadastroListaChrome>
);

describe("registro sem abas (todas as telas do motor)", () => {
  it("sem a faixa de cabeçalho antiga; ‹ › numa linha acima do formulário, que vira o cartão (data-b1-painel)", () => {
    render(registro(<form data-densidade={DENSIDADE_BASE1} data-testid="form" />));
    expect(screen.queryByTestId("cadastro-record-header")).toBeNull();
    const rolagem = document.querySelector(".mg-form-scroll");
    expect(rolagem).toHaveAttribute("data-b1-painel");
    const linha = rolagem?.querySelector(".b1-reg-navlinha");
    expect(linha).not.toBeNull();
    expect(screen.getByTestId("cadastro-record-nav")).toHaveTextContent("3/5");
    // a linha vem antes do formulário
    expect(linha?.nextElementSibling).toBe(screen.getByTestId("form"));
  });

  it("registro novo (sem navegação): só o cartão, sem linha de ‹ ›", () => {
    render(registro(<form data-densidade={DENSIDADE_BASE1} />, { onGo: undefined }));
    expect(document.querySelector(".b1-reg-navlinha")).toBeNull();
    expect(document.querySelector(".mg-form-scroll")).toHaveAttribute("data-b1-painel");
  });

  it("com abas o registro NÃO é painel e a classe de abas fora não é apagada pelo React", async () => {
    const abas = [
      { id: "geral", label: "Geral" },
      { id: "compra", label: "Motivo" },
    ];
    function Abas() {
      const [aba, setAba] = React.useState("geral");
      return (
        <form data-densidade={DENSIDADE_BASE1}>
          <Base1PanelTabs tabs={abas} value={aba} onChange={setAba} renderPanel={(id) => <p>painel {id}</p>} />
        </form>
      );
    }
    await act(async () => {
      render(registro(<Abas />));
    });
    const rolagem = document.querySelector(".mg-form-scroll");
    expect(rolagem).not.toHaveAttribute("data-b1-painel");
    expect(rolagem).toHaveClass("b1-form--abas-fora");
    // ‹ › na linha das abas, não acima do formulário
    expect(document.querySelector(".b1-panel-tabs-rail [data-testid='cadastro-record-nav']")).not.toBeNull();
    expect(document.querySelector(".mg-form-scroll > .b1-reg-navlinha")).toBeNull();
  });
});

describe("peças do formulário no desenho do design", () => {
  it("todo formulário do motor tem a densidade do design (ex.: Marcas)", () => {
    render(<FormularioMarca onSubmit={() => {}} onCancel={() => {}} variant="embedded" toolbarActions />);
    expect(document.querySelector("form")).toHaveAttribute("data-densidade", "compacto");
  });

  it("chave Sim/Não é a chave em caixa (mg-field--switch), com o rótulo e a chave dentro", () => {
    render(
      <div className="b1 mg-b1-form-grid">
        <B1ChaveRow label="Ativo" span={6} checked onChange={() => {}} ariaLabel="Marca ativa" />
      </div>,
    );
    const caixa = document.querySelector(".mg-field.mg-field--switch[data-chave-row]");
    expect(caixa).not.toBeNull();
    expect(caixa?.querySelector(".mg-field__label")).toHaveTextContent("Ativo");
    expect(screen.getByRole("switch", { name: "Marca ativa" })).toBeTruthy();
  });

  it("título de seção = título de grupo do design (nome + linha), sem caixa alta", () => {
    render(
      <div className="b1 mg-b1-form-grid">
        <SecaoForm titulo="Contato" />
        <B1TituloGrupo titulo="Unidade de Estoque" />
      </div>,
    );
    const titulos = document.querySelectorAll(".b1-grupo__cab .b1-grupo__titulo");
    expect([...titulos].map((t) => t.textContent)).toEqual(["Contato", "Unidade de Estoque"]);
    expect(document.querySelectorAll(".b1-grupo__cab .b1-grupo__linha")).toHaveLength(2);
    expect(titulos[0].className).not.toMatch(/uppercase/);
  });

  it("campos fora das abas ficam num cartão com a grade por dentro", () => {
    render(
      <B1CartaoCampos>
        <B1Field label="Apelido" span={6}>
          <input />
        </B1Field>
      </B1CartaoCampos>,
    );
    const cartao = document.querySelector(".b1-aba-cartao.b1-cartao-campos");
    expect(cartao?.firstElementChild).toHaveClass("mg-b1-form-grid");
    expect(cartao?.querySelector(".mg-field")).not.toBeNull();
  });

  it("seletor vazio com opção 'SELECIONE' (valor-sentinela) não escreve por cima do rótulo", () => {
    render(
      <B1Field label="Sexo" span={4}>
        <B1Select value="__VAZIO__" onChange={() => {}} aria-label="Sexo">
          <option value="__VAZIO__">SELECIONE</option>
          <option value="Macho">Macho</option>
        </B1Select>
      </B1Field>,
    );
    const botao = screen.getByRole("combobox", { name: "Sexo" });
    expect(botao).toHaveAttribute("data-placeholder");
    expect(botao.querySelector(".b1-select-btn__v")).toHaveTextContent("");
  });
});
