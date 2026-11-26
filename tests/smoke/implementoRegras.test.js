/**
 * Diário da máquina — as contas do implemento (src/lib/implementoRegras.js), sem tela:
 *  - saldo, % no implemento e produto restante (item × saldo ÷ capacidade);
 *  - a mistura aberta com saldo (a que o Passo 2 aplica);
 *  - a validação da mistura (implemento com capacidade, produto, local e quantidade > 0);
 *  - a aplicação (esvaziou, ou sobrou: o que foi para o pasto) e o corpo que vai ao servidor (sobra só quando sobrou);
 *  - o destino da sobra (perda pede motivo; transferência pede o pasto) e os horímetros opcionais;
 *  - a quantidade padrão do produto (por implemento cheio) como vem do servidor.
 */
import { describe, it, expect } from "vitest";
import {
  corpoDaAplicacao,
  corpoDaMistura,
  corpoDaSobra,
  misturaAberta,
  percentualNoImplemento,
  produtoRestante,
  produtosDaAplicacao,
  quantidadePadraoDoProduto,
  resumoDoImplemento,
  textoDaBarra,
  textoDecimal,
  validarAplicacao,
  validarMistura,
  validarSobra,
  volumeAplicado,
} from "@/lib/implementoRegras";

const mistura = (extra = {}) => ({
  id: "m1",
  numero: 1,
  implemento_bem_id: "imp1",
  area_id: "area-1",
  capacidade: "2000.0000",
  unidade: "L",
  saldo: "2000.0000",
  status: "ABERTA",
  itens: [
    { produto_id: "p1", produto: { nome: "Herbicida glifosato", unidade: "L" }, local_estoque_id: "l1", quantidade: "4.0000" },
    { produto_id: "p2", produto: { nome: "Adjuvante óleo mineral", unidade: "L" }, local_estoque_id: "l1", quantidade: "0.5000" },
  ],
  ...extra,
});

describe("implementoRegras — saldo e barra", () => {
  it("o produto restante é item × saldo ÷ capacidade", () => {
    // 4 L em 2.000 L: com 1.200 L no implemento, sobram 2,4 L de herbicida.
    expect(produtoRestante({ quantidade: "4" }, 1200, 2000)).toBe(2.4);
    expect(produtoRestante({ quantidade: "0.5" }, 1200, 2000)).toBe(0.3);
  });

  it("a porcentagem é saldo ÷ capacidade, entre 0 e 100", () => {
    expect(percentualNoImplemento(1000, 2000)).toBe(50);
    expect(percentualNoImplemento(2500, 2000)).toBe(100);
    expect(percentualNoImplemento(10, 0)).toBe(0);
  });

  it("o resumo traz saldo, capacidade, % e o restante de cada produto", () => {
    const r = resumoDoImplemento(mistura({ saldo: "1200" }));
    expect(r).toMatchObject({ existe: true, saldo: 1200, capacidade: 2000, unidade: "L", percentual: 60 });
    expect(r.produtos.map((p) => [p.nome, p.restante])).toEqual([
      ["Herbicida glifosato", 2.4],
      ["Adjuvante óleo mineral", 0.3],
    ]);
  });

  it("a barra mostra 'No implemento: X L de Y L' com os produtos", () => {
    const texto = textoDaBarra(resumoDoImplemento(mistura({ saldo: "1200" })));
    expect(texto).toBe("No implemento: 1.200 L de 2.000 L · Herbicida glifosato 2,4 L · Adjuvante óleo mineral 0,3 L");
    expect(textoDaBarra(resumoDoImplemento(null))).toBe("Nenhuma mistura no implemento");
  });

  it("a mistura aberta é a que tem saldo; a de maior número quando há mais de uma", () => {
    expect(misturaAberta([mistura({ saldo: "0" }), mistura({ id: "m2", numero: 2, status: "ACABOU" })])).toBeNull();
    const aberta = misturaAberta([mistura({ id: "m1", numero: 1 }), mistura({ id: "m3", numero: 3 })]);
    expect(aberta?.id).toBe("m3");
  });

  it("a kg funciona igual (distribuidor em kg)", () => {
    const r = resumoDoImplemento(mistura({ capacidade: "600", saldo: "300", unidade: "KG", itens: [{ produto_id: "u", produto: { nome: "Ureia", unidade: "KG" }, quantidade: "600" }] }));
    expect(r.unidade).toBe("KG");
    expect(r.produtos[0].restante).toBe(300);
  });
});

describe("implementoRegras — mistura (Passo 1)", () => {
  it("valida implemento, capacidade, produto, local e quantidade", () => {
    expect(validarMistura({ implementoId: "", capacidade: "2000", linhas: [] }).ok).toBe(false);
    const sem = validarMistura({ implementoId: "imp1", capacidade: null, linhas: [{ produto_id: "p1", local_estoque_id: "l1", quantidade: "4" }] });
    expect(sem.erros.capacidade).toMatch(/capacidade/);
    const linhas = validarMistura({
      implementoId: "imp1",
      capacidade: "2000",
      linhas: [{ produto_id: "", local_estoque_id: "", quantidade: "" }],
    });
    expect(linhas.ok).toBe(false);
    expect(linhas.erros.linhas[0]).toEqual({ produto: "Escolha o produto.", quantidade: "Informe a quantidade." });
    const local = validarMistura({ implementoId: "imp1", capacidade: "2000", linhas: [{ produto_id: "p1", local_estoque_id: "", quantidade: "4" }] });
    expect(local.erros.linhas[0].local).toMatch(/local/);
    expect(validarMistura({ implementoId: "imp1", capacidade: "2000", linhas: [{ produto_id: "p1", local_estoque_id: "l1", quantidade: "4" }] }).ok).toBe(true);
  });

  it("o corpo leva decimais como texto e só as chaves do contrato", () => {
    const corpo = corpoDaMistura({
      empresaId: "emp-1",
      implementoId: "imp1",
      areaId: "area-1",
      linhas: [{ produto_id: "p1", local_estoque_id: "l1", quantidade: "4,0", extra: "x" }],
    });
    expect(corpo).toEqual({
      empresa_id: "emp-1",
      implemento_bem_id: "imp1",
      area_id: "area-1",
      itens: [{ produto_id: "p1", local_estoque_id: "l1", quantidade: "4" }],
    });
    expect(typeof corpo.itens[0].quantidade).toBe("string");
  });

  it("texto decimal canônico: vírgula vira ponto e zeros à direita saem", () => {
    expect(textoDecimal("0,5")).toBe("0.5");
    expect(textoDecimal("2.000,0000")).toBe("2000");
    expect(textoDecimal("")).toBeNull();
    expect(textoDecimal("-1")).toBeNull();
  });
});

describe("implementoRegras — aplicação (Passo 2)", () => {
  it("esvaziou: aplica o saldo e não manda sobra", () => {
    expect(validarAplicacao({ esvaziou: true, sobra: "", saldo: 2000, unidade: "L" })).toBeNull();
    expect(volumeAplicado({ saldo: 2000, esvaziou: true, sobra: "" })).toBe(2000);
    expect(corpoDaAplicacao({ empresaId: "emp-1", esvaziou: true, sobra: "999" })).toEqual({ empresa_id: "emp-1", esvaziou: true });
  });

  it("sobrou um pouco: a sobra é obrigatória, > 0 e menor que o saldo", () => {
    expect(validarAplicacao({ esvaziou: false, sobra: "", saldo: 2000, unidade: "L" })).toMatch(/sobrou/);
    expect(validarAplicacao({ esvaziou: false, sobra: "0", saldo: 2000, unidade: "L" })).toMatch(/sobrou/);
    expect(validarAplicacao({ esvaziou: false, sobra: "2000", saldo: 2000, unidade: "L" })).toMatch(/menor/);
    expect(validarAplicacao({ esvaziou: false, sobra: "500", saldo: 2000, unidade: "L" })).toBeNull();
  });

  it("parcial: o que foi ao pasto é saldo − sobra, e o produto sai na mesma proporção", () => {
    const m = mistura();
    const usado = volumeAplicado({ saldo: 2000, esvaziou: false, sobra: "500" });
    expect(usado).toBe(1500);
    const porProduto = produtosDaAplicacao(m, usado);
    expect(porProduto.map((p) => [p.nome, p.quantidade])).toEqual([
      ["Herbicida glifosato", 3],
      ["Adjuvante óleo mineral", 0.375],
    ]);
  });

  it("parcial manda a sobra como texto no corpo", () => {
    expect(corpoDaAplicacao({ empresaId: "emp-1", esvaziou: false, sobra: "500,5" })).toEqual({ empresa_id: "emp-1", esvaziou: false, sobra: "500.5" });
  });
});

describe("implementoRegras — sobra (Trocar pasto e Encerrar o dia)", () => {
  it("perda exige motivo; transferência exige o pasto de chegada", () => {
    expect(validarSobra({ tipo: "PERDA", motivo: "" })).toMatch(/motivo/);
    expect(validarSobra({ tipo: "PERDA", motivo: "Vazou" })).toBeNull();
    expect(validarSobra({ tipo: "TRANSFERENCIA", paraAreaId: "" })).toMatch(/pasto/);
    expect(validarSobra({ tipo: "DEVOLUCAO" })).toBeNull();
  });

  it("o corpo leva só o que foi preenchido (horímetros opcionais; motivo só na perda; pasto só na transferência)", () => {
    expect(corpoDaSobra({ empresaId: "emp-1", tipo: "TRANSFERENCIA", paraAreaId: "area-2" })).toEqual({
      empresa_id: "emp-1",
      tipo: "TRANSFERENCIA",
      para_area_id: "area-2",
    });
    expect(
      corpoDaSobra({ empresaId: "emp-1", tipo: "TRANSFERENCIA", paraAreaId: "area-2", horimetroSaida: "1250,6", horimetroChegada: "" }),
    ).toEqual({ empresa_id: "emp-1", tipo: "TRANSFERENCIA", para_area_id: "area-2", horimetro_saida: "1250.6" });
    expect(corpoDaSobra({ empresaId: "emp-1", tipo: "PERDA", paraAreaId: "area-2", motivo: " Vazou " })).toEqual({
      empresa_id: "emp-1",
      tipo: "PERDA",
      motivo: "Vazou",
    });
  });
});

describe("implementoRegras — quantidade padrão do produto", () => {
  it("vem do servidor como texto e na unidade dele; sem padrão, vazio na unidade de estoque", () => {
    expect(quantidadePadraoDoProduto({ quantidade_padrao: "4.0000", quantidade_padrao_unidade: "L" })).toEqual({ quantidade: "4.0000", unidade: "L" });
    expect(quantidadePadraoDoProduto({ unidade_principal_estoque: "KG" })).toEqual({ quantidade: "", unidade: "KG" });
    expect(quantidadePadraoDoProduto({ unidade_principal_estoque: "L" })).toEqual({ quantidade: "", unidade: "L" });
  });
});
