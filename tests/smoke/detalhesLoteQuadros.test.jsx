// @vitest-environment jsdom
/**
 * D-PROD-119 — Detalhes do Lote: um botão só ("Manejos e históricos") abre os
 * quadros (ícone + nome) em grupos separados; sem os menus "Eventos"/"Históricos".
 * O resto do Detalhes do Lote fica como era.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { Scale } from "lucide-react";
import AcoesDoLote from "@/components/mapa/AcoesDoLote";
import { readFileSync } from "node:fs";

afterEach(cleanup);

const fonte = readFileSync("src/components/mapa/DetalhesLote.jsx", "utf8");

const grupos = (pesar, historico) => [
  { titulo: "Manejos", itens: [{ nome: "Pesar", Icone: Scale, onClick: pesar }] },
  { titulo: "Históricos", itens: [{ nome: "Movimentação", rotulo: "Histórico de Movimentação", Icone: Scale, onClick: historico }] },
];
const comoCelular = (sim) => {
  window.matchMedia = /** @type {any} */ ((q) => ({ matches: sim && /max-width: 639px/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
};

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

  it("mesmos campos do lote e da área (só o visual mudou)", () => {
    // UI-DETALHES-LOTE-V8: os campos saíram do DetalhesLote para o catálogo único (uma definição por
    // campo) e para o cartão da aba Tudo; a unidade foi para o rótulo ("Peso médio (kg)").
    const catalogo = readFileSync("src/components/mapa/detalhes-lote/catalogo.js", "utf8");
    const cartoesTudo = readFileSync("src/components/mapa/detalhes-lote/CartoesLoteTudo.jsx", "utf8");
    const area = readFileSync("src/components/mapa/InformacoesArea.jsx", "utf8");
    const camposLote = catalogo.slice(catalogo.indexOf("export function camposCartaoTudo"));
    for (const c of ["Identificador", "Sigla", "Qtd. Cabeças", "Peso médio (kg)", "Dias de pastejo", "Sist. Rep.", "Sexo"]) {
      expect(camposLote, c).toContain(c);
    }
    expect(cartoesTudo).toContain("Categoria de Manejo:");
    // D-PROD-124: o proprietário tirou "Categoria Oficial" do lote e "Sistemas Reprodutivos"/"Lotes" da área.
    for (const f of [fonte, catalogo, cartoesTudo]) expect(f).not.toContain("Categoria Oficial");
    for (const f of [area, catalogo]) expect(f).not.toMatch(/Sistemas Reprodutivos|Lotes:/);
    expect(area).toContain("area.camposResumo");
    for (const c of ["Hectares", "UA/ha", "UA total", "Qtd. Lotes", "Qtd. Cabeças", "Média geral", "Pastagem", "Dias pastejo"]) {
      expect(catalogo, c).toContain(c);
    }
  });

  it("desktop: quadros à vista; um clique abre a ação", async () => {
    comoCelular(false);
    const pesar = vi.fn();
    render(<AcoesDoLote grupos={grupos(pesar, vi.fn())} />);
    expect(screen.queryByRole("button", { name: "Manejos e históricos" })).toBeNull();
    expect(screen.getByRole("region", { name: "Manejos" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Históricos" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pesar" }));
    expect(pesar).toHaveBeenCalledTimes(1);
  });

  it("celular: um botão só abre a folha; escolher fecha a folha e chama a ação", async () => {
    comoCelular(true);
    const historico = vi.fn();
    render(<AcoesDoLote grupos={grupos(vi.fn(), historico)} />);
    expect(screen.queryByRole("button", { name: "Histórico de Movimentação" })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Manejos e históricos" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Histórico de Movimentação" })); });
    expect(historico).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Histórico de Movimentação" })).toBeNull();
    comoCelular(false);
  });
});
