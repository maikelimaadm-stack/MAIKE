/**
 * D-PROD-198 — peso projetado nos Detalhes do Lote (catálogo do mapa).
 * A projeção vem pronta do servidor (`projecao_peso` de cada posição); o catálogo
 * só formata: projetado, @, GMD do mês, base, objetivo, quando atinge, pesado × previsto
 * e os próximos fins de mês.
 */
import { describe, it, expect } from "vitest";
import { montarModeloDetalhes, camposDoLote, camposDaSecao } from "@/components/mapa/detalhes-lote/catalogo";

const AREA = { id: "a1", nome: "PASTO A", tamanho_hectares: 10 };
const projecao = (extra = {}) => ({
  disponivel: true,
  dia: "2027-06-15",
  peso_kg: 407,
  arroba: 13.57,
  sem_curva: false,
  gmd_hoje_kg: 0.5,
  base: { dia: "2027-06-01", tipo: "ENTRADA", peso_gravado_kg: 400, peso_kg: 400, derivado: false, dias: 14 },
  peso_objetivo_kg: 420,
  falta_kg: 13,
  atingiu_objetivo: false,
  data_prevista_objetivo: "2027-07-11",
  dias_para_objetivo: 26,
  ultima_pesagem: { dia: "2027-06-10", peso_kg: 395, previsto_kg: 404.5, percentual_do_previsto: 97.65 },
  projecao_mensal: [
    { mes: "2027-06", dia: "2027-06-30", peso_kg: 414.5, arroba: 13.82 },
    { mes: "2027-07", dia: "2027-07-31", peso_kg: 430, arroba: 14.33 },
    { mes: "2027-08", dia: "2027-08-31", peso_kg: 445.5, arroba: 14.85 },
  ],
  ...extra,
});
const lote = (extra = {}) => ({ id: "p1", posicao_id: "p1", __posicao: true, nome: "LOTE 1", area_atual_id: "a1", quantidade_cabecas: 20, peso_medio_kg: 400, categoria: "Boi 25 a 36 meses", sexo: "Macho", status: "Ativo", data_entrada: "2027-06-01", ...extra });
const modelo = (lotes) => montarModeloDetalhes({ area: AREA, lotes, lotesDaArea: lotes, hoje: new Date(2027, 5, 15) });
const valor = (l, chave) => l.valores[chave]?.texto;

describe("D-PROD-198 — peso projetado nos Detalhes do Lote", () => {
  it("formata projetado, @, GMD, base, objetivo, previsão, pesado × previsto e próximos meses", () => {
    const [l] = modelo([lote({ projecao_peso: projecao() })]).lotes;
    expect(valor(l, "projetado")).toBe("407,0");
    expect(valor(l, "projArroba")).toBe("13,57");
    expect(valor(l, "gmdMes")).toBe("0,500");
    expect(valor(l, "baseProj")).toBe("ENTRADA 01/06");
    expect(valor(l, "objetivo")).toBe("420");
    expect(valor(l, "atinge")).toBe("11/07/2027 (26 d)");
    expect(valor(l, "pesPrev")).toBe("97,7% do previsto");
    expect(valor(l, "projMeses")).toBe("30/06: 415 · 31/07: 430 · 31/08: 446");
    // v12 (D-PROD-V12): os blocos do lote (vista Lote e tela do lote) mostram o projetado, com a dica.
    const projetado = camposDoLote(l, "Pesagem").find((c) => c.rotulo === "Peso projetado (kg)");
    expect(projetado).toMatchObject({ texto: "407,0", dica: "último peso + ganho diário da curva da categoria, até hoje" });
    // os campos novos ficam na seção Pesagem (coluna padrão da Lista)
    expect(camposDaSecao("Pesagem").map((c) => c.chave).slice(0, 8)).toEqual(["projetado", "projArroba", "gmdMes", "baseProj", "objetivo", "atinge", "pesPrev", "projMeses"]);
  });

  it("objetivo atingido, sem curva e sem previsão", () => {
    const [a, b, c] = modelo([
      lote({ id: "a", posicao_id: "a", projecao_peso: projecao({ atingiu_objetivo: true }) }),
      lote({ id: "b", posicao_id: "b", projecao_peso: projecao({ sem_curva: true, gmd_hoje_kg: 0, data_prevista_objetivo: null, dias_para_objetivo: null, ultima_pesagem: null }) }),
      lote({ id: "c", posicao_id: "c", projecao_peso: projecao({ peso_objetivo_kg: null, data_prevista_objetivo: null }) }),
    ]).lotes;
    expect(valor(a, "atinge")).toBe("ATINGIDO");
    expect(valor(b, "gmdMes")).toBe("SEM CURVA");
    expect(valor(b, "atinge")).toBe("SEM PREVISÃO");
    expect(valor(b, "pesPrev")).toBe("—");
    expect(valor(c, "objetivo")).toBe("—");
    expect(valor(c, "atinge")).toBe("—");
    // ordenação numérica: ATINGIDO antes de qualquer data, SEM PREVISÃO depois
    const [d] = modelo([lote({ id: "d", posicao_id: "d", projecao_peso: projecao() })]).lotes;
    const ordens = [a, b, d].map((l) => l.valores.atinge.ordem);
    for (const o of ordens) expect(typeof o).toBe("number");
    expect(ordens[0]).toBeLessThan(ordens[2]);
    expect(ordens[2]).toBeLessThan(ordens[1]);
  });

  it("sem projeção (lote fora do ledger ou indisponível) → células vazias, sem quebrar", () => {
    const [x, y] = modelo([lote({ id: "x", posicao_id: "x" }), lote({ id: "y", posicao_id: "y", projecao_peso: { disponivel: false, motivo: "sem_peso" } })]).lotes;
    for (const l of [x, y]) {
      expect(l.projecao).toBeNull();
      for (const chave of ["projetado", "projArroba", "gmdMes", "baseProj", "objetivo", "atinge", "pesPrev", "projMeses"]) expect(valor(l, chave)).toBe("—");
    }
  });
});
