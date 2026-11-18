// @vitest-environment jsdom
/**
 * D-PROD-119 — Detalhes do Lote: os manejos e os históricos em quadros (ícone +
 * nome), em grupos separados; sem os menus "Eventos"/"Históricos".
 * D-PROD-218 — a grade é a tela empilhada "Manejos e históricos" da casca do
 * Detalhes v12, aberta pelo "Manejos" do rodapé, com 3 colunas em todos os modos.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { Scale } from "lucide-react";
import AcoesDoLote from "@/components/mapa/AcoesDoLote";
import PainelPasto from "@/components/mapa/detalhes-lote/PainelPasto";
import { montarModeloDetalhes } from "@/components/mapa/detalhes-lote/catalogo";
import { readFileSync } from "node:fs";

// O conteúdo da aba Lotes é de outra peça (LOTES); aqui só a casca importa.
vi.mock("@/components/mapa/detalhes-lote/AbaLotes", async () => {
  const { createElement } = await import("react");
  return { default: () => createElement("div", { "data-testid": "aba-lotes" }) };
});

afterEach(cleanup);

const fonte = readFileSync("src/components/mapa/DetalhesLote.jsx", "utf8");

const grupos = (pesar, historico) => [
  { titulo: "Manejos", itens: [{ nome: "Pesar", Icone: Scale, onClick: pesar }] },
  { titulo: "Históricos", itens: [{ nome: "Movimentação", rotulo: "Histórico de Movimentação", Icone: Scale, onClick: historico }] },
];

const PERMISSOES = { mover: true, pesar: true, historico: true, supl: true, detalhesCocho: true, lancarSupl: true, historicoCocho: true };
const modelo = () =>
  montarModeloDetalhes({
    area: { id: "a1", nome: "Pasto 07", tamanho_hectares: 100 },
    lotes: [{ id: "p1", nome: "L-2026-008", categoria: "VACA", quantidade_cabecas: 38, peso_medio_kg: 449.5, area_atual_id: "a1", __posicao: true }],
    hoje: new Date("2026-11-15T12:00:00"),
  });

describe("Detalhes do Lote: Manejos e Históricos em quadros (D-PROD-119)", () => {
  it("sem menus suspensos; dois grupos separados — Manejos e Históricos", () => {
    expect(fonte).toMatch(/<AcoesDoLote grupos=\{\[\{ titulo: 'Manejos', itens: manejos \}, \{ titulo: 'Históricos', itens: historicos \}\]\} \/>/);
    expect(fonte).not.toMatch(/DropdownMenu/);
  });

  it("todos os manejos e históricos continuam, com as mesmas permissões", () => {
    for (const [perm, nome] of [
      ["mover_lotes", "Mover"], ["pesar_lotes", "Pesar"], ["registrar_nascimento", "Nascimento"], ["registrar_morte", "Morte"],
      ["registrar_abate", "Saída"], ["mudar_categoria_lotes", "Mudar Categoria"], ["renomear_lotes", "Editar Informação"],
      ["visualizar_historico_movimentacoes_lote", "Movimentação"], ["visualizar_historico_suplementacao_lote", "Suplementação"],
    ]) {
      expect(fonte, nome).toMatch(new RegExp(`permissions\\.${perm} !== false[^\\n]*nome: '${nome}'`));
    }
  });

  it("D-PROD-124: sem \"Categoria Oficial\" no lote nem \"Sistemas Reprodutivos\"/\"Lotes:\" na área", () => {
    // Os campos v12 do lote e da área (cartões, grade e tabela) são da aba Lotes/Detalhes (peça LOTES).
    const catalogo = readFileSync("src/components/mapa/detalhes-lote/catalogo.js", "utf8");
    for (const f of [fonte, catalogo]) expect(f).not.toContain("Categoria Oficial");
    expect(catalogo).not.toMatch(/Sistemas Reprodutivos|Lotes:/);
  });

  it("a grade é só a grade: grupos com nome, cada quadro chama a ação (sem gatilho nem diálogo próprios)", () => {
    const pesar = vi.fn();
    const historico = vi.fn();
    render(<AcoesDoLote grupos={grupos(pesar, historico)} />);
    expect(screen.getByRole("region", { name: "Manejos" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Históricos" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Manejos e históricos" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pesar" }));
    fireEvent.click(screen.getByRole("button", { name: "Histórico de Movimentação" }));
    expect(pesar).toHaveBeenCalledTimes(1);
    expect(historico).toHaveBeenCalledTimes(1);
  });

  it("v12: 3 colunas em todos os modos, quadro no padrão dos cartões (#fff) de 112 px, desabilitado a 45%", () => {
    const css = readFileSync("src/styles/acoes-lote-modulos.css", "utf8");
    expect(css).toMatch(/\.mk-al__quadros:not\(#mk-padrao\) \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[^}]*gap: 10px;/);
    expect(css).not.toMatch(/@media/);
    expect(css).toMatch(/\.mk-al__quadro:not\(#mk-padrao\) \{[^}]*min-height: 112px;[^}]*border-radius: 6px;[^}]*background: #fff !important;/);
    expect(css).toMatch(/\.mk-al__quadro:not\(#mk-padrao\):disabled \{[^}]*opacity: 0\.45;/);
  });

  it("casca: \"Manejos\" do rodapé empilha \"Manejos e históricos\" com a grade; ‹ volta às abas", async () => {
    const pesar = vi.fn();
    render(
      <PainelPasto modelo={modelo()} permissoes={PERMISSOES} dados={{ areaNome: "Pasto 07", setorNome: "Retiro" }}
        manejos={<AcoesDoLote grupos={grupos(pesar, vi.fn())} />} />,
    );
    expect(screen.queryByRole("region", { name: "Manejos" })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Manejos" })); });
    expect(screen.getByRole("heading", { name: "Manejos e históricos" })).toBeTruthy();
    expect(screen.getByText("Pasto 07")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Manejos" })).toBeTruthy();
    // Na tela de manejos não há rodapé (nem abas): o quadro "Pesar" é o único botão com esse nome.
    expect(screen.queryByRole("tablist")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pesar" }));
    expect(pesar).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Voltar" })); });
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Manejos" })).toBeNull();
  });
});
