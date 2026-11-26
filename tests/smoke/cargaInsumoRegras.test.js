/**
 * D-PROD-334 — as regras puras da "Carga de insumo": a próxima carga do dia, o título e a linha de apoio, o marcador do
 * horímetro (ida e volta e entrada malformada), o apontamento de hoje, as linhas da carga e o local com mais saldo.
 */
import { describe, it, expect } from "vitest";
import {
  apontamentoDeHoje,
  linhasDaCarga,
  lerCarga,
  localMaisCheio,
  marcadorDaCarga,
  proximaCarga,
  subDaCarga,
  tituloDaCarga,
} from "@/lib/cargaInsumoRegras";

const HOJE = "2026-11-26";
const linha = (over = {}) => ({ id: `pl-${Math.random()}`, status: "CONFIRMADO", produto_id: "p-gli", quantidade: "10.0000", jato: 1, ...over });
const apontamento = (over = {}) => ({ id: "ap-1", data_operacional: HOJE, status: "CONFIRMADO", produtos: [], ...over });

describe("proximaCarga", () => {
  it("sem apontamento nem linha de carga no dia, é a 1", () => {
    expect(proximaCarga([], HOJE)).toBe(1);
    expect(proximaCarga([apontamento({ produtos: [] })], HOJE)).toBe(1);
    expect(proximaCarga([apontamento({ produtos: [linha({ jato: null })] })], HOJE)).toBe(1);
  });

  it("é a maior carga das linhas CONFIRMADAS de hoje, mais 1", () => {
    const aps = [apontamento({ produtos: [linha({ jato: 1 }), linha({ jato: 3 })] }), apontamento({ id: "ap-2", produtos: [linha({ jato: 2 })] })];
    expect(proximaCarga(aps, HOJE)).toBe(4);
  });

  it("lê o número da carga também quando vem como texto", () => {
    expect(proximaCarga([apontamento({ produtos: [linha({ jato: "2" })] })], HOJE)).toBe(3);
  });

  it("ignora linhas CANCELADAS, apontamentos CANCELADOS e outros dias", () => {
    const aps = [
      apontamento({ produtos: [linha({ jato: 7, status: "CANCELADO" }), linha({ jato: 2 })] }),
      apontamento({ id: "ap-2", status: "CANCELADO", produtos: [linha({ jato: 9 })] }),
      apontamento({ id: "ap-3", data_operacional: "2026-11-25", produtos: [linha({ jato: 8 })] }),
    ];
    expect(proximaCarga(aps, HOJE)).toBe(3);
  });
});

describe("título e linha de apoio da carga", () => {
  it("\"Carga n\" e \"Encher o <implemento>\"; sem implemento, \"Carga de insumo\"", () => {
    expect(tituloDaCarga(4)).toBe("Carga 4");
    expect(subDaCarga("Pulverizador 2.000 L")).toBe("Encher o Pulverizador 2.000 L");
    expect(subDaCarga("  ")).toBe("Carga de insumo");
    expect(subDaCarga(undefined)).toBe("Carga de insumo");
  });
});

describe("marcadorDaCarga / lerCarga (horímetro na observação)", () => {
  it("vai e volta: o horímetro canônico sai do marcador", () => {
    const marca = marcadorDaCarga("1245.0");
    expect(marca).toBe("[carga hor=1245.0]");
    expect(lerCarga(marca)).toEqual({ horimetro: "1245.0" });
    expect(lerCarga(`${marca}\nTexto da pessoa`)).toEqual({ horimetro: "1245.0" });
  });

  it("sem horímetro (ou fora do formato canônico), não há marcador", () => {
    expect(marcadorDaCarga(null)).toBeNull();
    expect(marcadorDaCarga("")).toBeNull();
    expect(marcadorDaCarga("1.245,0")).toBeNull();
  });

  it("entrada malformada ou sem marcador lê como nula (sem quebrar)", () => {
    expect(lerCarga(undefined)).toBeNull();
    expect(lerCarga(null)).toBeNull();
    expect(lerCarga("só texto")).toBeNull();
    expect(lerCarga("[carga hor=abc]")).toBeNull();
    expect(lerCarga("[carga hor=1245.0")).toBeNull();
    expect(lerCarga("texto antes [carga hor=1245.0]")).toBeNull();
  });
});

describe("apontamentoDeHoje", () => {
  it("é o CONFIRMADO de hoje; sem ele, null", () => {
    const aps = [apontamento({ id: "ap-cancelado", status: "CANCELADO" }), apontamento({ id: "ap-ontem", data_operacional: "2026-11-25" }), apontamento({ id: "ap-hoje" })];
    expect(apontamentoDeHoje(aps, HOJE)).toMatchObject({ id: "ap-hoje" });
    expect(apontamentoDeHoje([apontamento({ data_operacional: "2026-11-25" })], HOJE)).toBeNull();
  });
});

describe("linhasDaCarga", () => {
  const item = (produtoId, quantidade, local = "l-dep") => ({
    produto: { id: produtoId, rotulo: produtoId, unidade_principal_estoque: "L" },
    local_estoque_id: local,
    quantidade,
    observacao: "",
  });

  it("uma linha por produto, todas com o MESMO jato; sem horímetro, observação nula", () => {
    const corpos = linhasDaCarga([item("p-gli", "25"), item("p-ure", "40", "l-b")], { carga: 2 });
    expect(corpos).toHaveLength(2);
    expect(corpos[0]).toMatchObject({ produto_id: "p-gli", local_estoque_id: "l-dep", quantidade: "25", jato: "2", observacao: null });
    expect(corpos[1]).toMatchObject({ produto_id: "p-ure", local_estoque_id: "l-b", quantidade: "40", jato: "2", observacao: null });
    expect(corpos[0]).not.toHaveProperty("unidade_lancamento");
  });

  it("com horímetro, a observação de cada linha leva o marcador da carga", () => {
    const [corpo] = linhasDaCarga([item("p-gli", "25")], { carga: 1, horimetro: "1245.0" });
    expect(corpo.observacao).toBe("[carga hor=1245.0]");
    expect(lerCarga(corpo.observacao)).toEqual({ horimetro: "1245.0" });
  });
});

describe("localMaisCheio", () => {
  it("o local com maior disponível; vazio sem locais", () => {
    expect(localMaisCheio([])).toBe("");
    expect(localMaisCheio([{ local_estoque_id: "l-a", disponivel: "100.0000" }, { local_estoque_id: "l-b", disponivel: "900.0000" }])).toBe("l-b");
    expect(localMaisCheio([{ local_estoque_id: "l-a", disponivel: "5.0000" }])).toBe("l-a");
    expect(localMaisCheio([{ local_estoque_id: "l-a", disponivel: "lixo" }, { local_estoque_id: "l-b", disponivel: "0" }])).toBe("l-a");
  });
});
