// @vitest-environment jsdom
/**
 * D-PROD-115 — lançamentos de lote do Mapa Geral com a mesma abertura do
 * cadastro rápido: um cabeçalho só (título + lotes) com ✕ e ✓; o rodapé do
 * formulário vira o ✓ do cabeçalho e respeita "enviando".
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { LancLoteDialogo, LancLoteForm, LancLoteRodape, LancLoteItem, LancLoteSegmento } from "@/components/lotes/LancamentoLoteUi";

afterEach(cleanup);

const montar = (props = {}) => {
  const onSubmit = vi.fn((e) => e.preventDefault());
  const onCancelar = vi.fn();
  render(
    <LancLoteDialogo open onOpenChange={() => {}} titulo="Registrar Morte" lotes={[{ nome: "LOTE 1" }, { nome: "LOTE 2" }]}>
      <LancLoteForm onSubmit={onSubmit}>
        <input aria-label="campo" />
        <LancLoteRodape onCancelar={onCancelar} textoAcao="Registrar Mortes" textoEnviando="Registrando…" {...props} />
      </LancLoteForm>
    </LancLoteDialogo>,
  );
  return { onSubmit, onCancelar };
};

describe("LancLoteDialogo (D-PROD-115)", () => {
  it("um cabeçalho só: título e os lotes; sem rodapé de botões dentro do formulário", () => {
    montar();
    expect(screen.getAllByText("Registrar Morte")).toHaveLength(1);
    expect(screen.getByText("LOTE 1 · LOTE 2")).toBeTruthy();
    expect(screen.queryByText("Cancelar")).toBeNull();
    expect(document.querySelector(".mk-ll__rodape")).toBeNull();
  });

  it("✓ do cabeçalho envia o formulário; ✕ chama o cancelar do formulário", async () => {
    const { onSubmit, onCancelar } = montar();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Registrar Mortes" }));
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancelar).toHaveBeenCalledTimes(1);
  });

  it("enquanto envia, o ✓ fica desabilitado e mostra o texto de envio", () => {
    montar({ enviando: true });
    const ok = screen.getByRole("button", { name: "Registrando…" });
    expect(ok.hasAttribute("disabled")).toBe(true);
  });

  it("trocar o rodapé por outro (ex.: Mover → fechamento de consumo) mantém o ✓ ativo com a ação nova", async () => {
    const Troca = ({ etapa }) => (
      <LancLoteDialogo open onOpenChange={() => {}} titulo="Mover Lotes">
        {etapa === "a" ? (
          <LancLoteForm key="a"><LancLoteRodape onCancelar={() => {}} textoAcao="Confirmar Movimentação" /></LancLoteForm>
        ) : (
          <>
            <p>fechamento</p>
            <LancLoteForm key="b"><LancLoteRodape onCancelar={() => {}} textoAcao="Fechar Consumos e Continuar" /></LancLoteForm>
          </>
        )}
      </LancLoteDialogo>
    );
    const { rerender } = render(<Troca etapa="a" />);
    expect(screen.getByRole("button", { name: "Confirmar Movimentação" }).hasAttribute("disabled")).toBe(false);
    await act(async () => {
      rerender(<Troca etapa="b" />);
    });
    const ok = screen.getByRole("button", { name: "Fechar Consumos e Continuar" });
    expect(ok.hasAttribute("disabled")).toBe(false);
  });

  it("fechamento de consumo aceita sobra até o fornecido + a sobra anterior (mesmo limite do envio)", () => {
    const fonte = readFileSync("src/components/lotes/FormularioMovimentacaoLote.jsx", "utf8");
    expect(fonte).toMatch(/max=\{\(evento\.quantidade_total_kg \|\| 0\) \+ \(evento\.sobra_kg \|\| 0\)\}/);
    expect(fonte).toMatch(/saldoFisicoMaximo = \(evento\.quantidade_total_kg \|\| 0\) \+ \(evento\.sobra_kg \|\| 0\)/);
  });

  it("fora do diálogo o rodapé desenha Cancelar e a ação (desabilitada ao enviar)", () => {
    render(<LancLoteRodape onCancelar={() => {}} textoAcao="Salvar" enviando textoEnviando="Salvando..." />);
    expect(screen.getByRole("button", { name: "Salvando..." }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
  });

  it("item tem título e ✕ na mesma linha; segmento marca a opção escolhida", () => {
    const onRemover = vi.fn();
    const onChange = vi.fn();
    render(
      <>
        <LancLoteItem titulo="Categoria 1" onRemover={onRemover} rotuloRemover="Remover categoria"><input /></LancLoteItem>
        <LancLoteSegmento rotulo="Movimentar todo o lote?" opcoes={[{ value: "sim", label: "Sim" }, { value: "nao", label: "Não" }]} valor="sim" onChange={onChange} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remover categoria" }));
    expect(onRemover).toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Sim" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Não" }));
    expect(onChange).toHaveBeenCalledWith("nao");
  });

  it("os lançamentos de lote não têm mais cartão com cabeçalho próprio (sem cabeçalho duplicado)", () => {
    for (const f of ["Abate", "Morte", "Nascimento", "Pesagem", "MudancaCategoria", "MovimentacaoLote"]) {
      const fonte = readFileSync(`src/components/lotes/Formulario${f}.jsx`, "utf8");
      expect(fonte, f).not.toMatch(/<CardHeader|<CardTitle/);
      expect(fonte, f).toMatch(/LancLoteRodape/);
    }
    const detalhes = readFileSync("src/components/mapa/DetalhesLote.jsx", "utf8");
    for (const t of ["Registrar Morte", "Registrar Abate", "Registrar Nascimento", "Registrar Pesagem", "Mudança de Categoria", "Mover Lotes", "Juntar Lotes", "Renomear Lote"]) {
      expect(detalhes, t).toMatch(new RegExp(`<LancLoteDialogo(?:(?!</?LancLoteDialogo)[\\s\\S])*?titulo="${t}"`));
    }
  });
});
