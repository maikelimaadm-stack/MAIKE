// @vitest-environment jsdom
/**
 * D-PROD-119 — Detalhes do Lote: Manejos e Históricos em quadros (ícone +
 * nome) no mesmo lugar, em grupos separados; sem os menus "Eventos"/"Históricos".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const fonte = readFileSync("src/components/mapa/DetalhesLote.jsx", "utf8");

describe("Detalhes do Lote em quadros (D-PROD-119)", () => {
  it("dois grupos separados — Manejos e Históricos — e nenhum menu suspenso", () => {
    expect(fonte).toMatch(/aria-label="Manejos"/);
    expect(fonte).toMatch(/aria-label="Históricos"/);
    expect(fonte).not.toMatch(/DropdownMenu/);
  });

  it("todos os manejos e históricos continuam, com as mesmas permissões", () => {
    for (const [perm, nome] of [
      ["mover_lotes", "Mover"], ["pesar_lotes", "Pesar"], ["registrar_nascimento", "Nascimento"], ["registrar_morte", "Morte"],
      ["registrar_abate", "Abate"], ["mudar_categoria_lotes", "Mudar Categoria"], ["juntar_lotes", "Juntar Lotes"], ["renomear_lotes", "Renomear Lote"],
      ["visualizar_historico_movimentacoes_lote", "Movimentação"], ["visualizar_historico_suplementacao_lote", "Suplementação"],
    ]) {
      expect(fonte, nome).toMatch(new RegExp(`permissions\\.${perm} !== false[^\\n]*nome: '${nome}'`));
    }
  });

  it("o próprio Detalhes do Lote abre no diálogo padrão (tela inteira no celular)", () => {
    const mapa = readFileSync("src/pages/MapaGeral.jsx", "utf8");
    expect(mapa).toMatch(/<LancLoteDialogo(?:(?!<\/?LancLoteDialogo)[\s\S])*?titulo="Detalhes do Lote"(?:(?!<\/?LancLoteDialogo)[\s\S])*?somenteLeitura/);
  });
});
