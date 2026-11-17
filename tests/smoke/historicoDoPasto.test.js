/**
 * Detalhes do Lote v12 — aba Histórico: linha do tempo do pasto, pura
 * (`historicoDoPasto.js`, D-PROD-V12; número definitivo no PR).
 *
 * Os movimentos têm a forma dos documentos que o servidor grava no ledger
 * (`rebanhoLedgerService.js` / `rebanhoLedgerManejos.js`): transferência com
 * uma linha por posição, pesagem com uma linha por lote, nascimento por sexo,
 * baixa com a distribuição por lote, mudança de categoria, junção. Dados
 * sintéticos.
 */
import { describe, it, expect } from "vitest";
import {
  DIA_NAO_INFORMADO,
  FILTROS_DO_HISTORICO,
  agruparPorDia,
  cartaoDaSuplementacao,
  cartoesDaMovimentacao,
  eventoDoPasto,
  filtroValido,
  fmtNumero,
  montarHistoricoDoPasto,
  rotuloDoDia,
  rotuloDoFiltro,
} from "@/components/mapa/detalhes-lote/historicoDoPasto";

const EMP = "emp-1";
const P07 = "a-p07";
const CTX = { areaId: P07, areaNome: "Pasto 07" };

const ledger = (id, dia, reg) => ({
  efeito_servidor: { comando: "rebanho_ledger", evento_id: `ev-${id}`, operation_id: `op-${id}`, registrado_em: reg, registrado_por_usuario_id: "u-1" },
  created_date: reg,
  data_movimentacao: `${dia}T12:00:00.000Z`,
  historico_ocorrencia: dia,
  historico_registrado_em: reg,
});

const ENTRADA = {
  id: "mv-entrada",
  empresa_id: EMP,
  tipo: "Transferência de Área",
  lote: "L-2026-027",
  lote_id: "ent-27",
  lote_ids: ["pos-27", "ent-27"],
  quantidade_animais: 33,
  area_origem_id: "a-p04",
  area_origem_nome: "Pasto 04",
  area_destino_id: P07,
  area_destino_nome: "Pasto 07",
  categoria_animal: "BOI MAGRO",
  linhas: [
    { origem_posicao_id: "pos-27", destino_posicao_id: "pos-27b", quantidade: 33, area_origem_id: "a-p04", area_origem_nome: "Pasto 04", lote_entrada_id: "ent-27", nome: "L-2026-027", categoria: "BOI MAGRO", sexo: "Macho" },
  ],
  ...ledger("entrada", "2026-11-05", "2026-11-05T15:10:00.000Z"),
};

const SAIDA_DOIS_LOTES = {
  id: "mv-saida",
  empresa_id: EMP,
  tipo: "Transferência de Área",
  lote: "L-2026-004",
  quantidade_animais: 100,
  area_origem_id: P07,
  area_origem_nome: "Pasto 07",
  area_destino_id: "a-p08",
  area_destino_nome: "Pasto 08",
  linhas: [
    { origem_posicao_id: "p4", quantidade: 72, area_origem_id: P07, area_origem_nome: "Pasto 07", nome: "L-2026-004", categoria: "VACA", sexo: "Fêmea" },
    { origem_posicao_id: "p5", quantidade: 28, area_origem_id: P07, area_origem_nome: "Pasto 07", nome: "L-2026-005", categoria: "VACA", sexo: "Fêmea" },
  ],
  ...ledger("saida", "2026-09-02", "2026-09-02T10:00:00.000Z"),
};

const PESAGEM = {
  id: "mv-pesagem",
  empresa_id: EMP,
  tipo: "Pesagem",
  lote: "L-2026-008",
  quantidade_animais: 0,
  area_origem_id: P07,
  area_origem_nome: "Pasto 07",
  modo_pesagem: "por_lote",
  linhas: [
    { lote_id: "p8", posicao_id: "p8", lote_nome: "L-2026-008", quantidade_cabecas: 38, peso_anterior_kg: 440, peso_novo_kg: 449.5, ganho_kg: 9.5 },
    { lote_id: "p14", posicao_id: "p14", lote_nome: "L-2026-014", quantidade_cabecas: 86, peso_anterior_kg: null, peso_novo_kg: 382.5, ganho_kg: null },
  ],
  ...ledger("pesagem", "2026-11-03", "2026-11-03T18:00:00.000Z"),
};

const NASCIMENTO = {
  id: "mv-nasc",
  empresa_id: EMP,
  tipo: "Nascimento",
  lote: "NASCIDOS BEZERRO 0 A 12 MESES",
  lote_id: "pos-nasc-m",
  lote_ids: ["pos-nasc-m", "pos-nasc-f"],
  quantidade_animais: 5,
  area_origem_id: P07,
  area_origem_nome: "Pasto 07",
  linhas: [
    { sexo: "Macho", categoria_mae: "Vaca + 36 meses", categoria_filhote: "Bezerro 0 a 12 meses", quantidade: 3, peso_medio_kg: 32, posicao_id: "pos-nasc-m", maes_lote_ids: ["ent-8"], lote_criado: false },
    { sexo: "Fêmea", categoria_mae: "Vaca + 36 meses", categoria_filhote: "Bezerra 0 a 12 meses", quantidade: 2, peso_medio_kg: null, posicao_id: "pos-nasc-f", maes_lote_ids: ["ent-8"], lote_criado: false },
  ],
  ...ledger("nasc", "2026-10-28", "2026-10-28T11:00:00.000Z"),
};

const MORTE = {
  id: "mv-morte",
  empresa_id: EMP,
  tipo: "Morte",
  lote: "L-2026-031",
  quantidade_animais: 3,
  area_origem_id: P07,
  area_origem_nome: "Pasto 07",
  baixa: { total_cabecas: 3, lotes: [{ nome: "L-2026-031", quantidade: 2 }, { nome: "L-2026-032", quantidade: 1 }] },
  linhas: [
    {
      categoria: "Bezerro 0 a 12 meses",
      quantidade: 3,
      causa_morte: "Doença",
      distribuicao: [
        { lote_id: "p31", posicao_id: "p31", nome: "L-2026-031", numero_lote: "31", quantidade: 2 },
        { lote_id: "p32", posicao_id: "p32", nome: "L-2026-032", numero_lote: "32", quantidade: 1 },
      ],
    },
  ],
  ...ledger("morte", "2026-11-03", "2026-11-03T09:00:00.000Z"),
};

const ABATE = {
  id: "mv-abate",
  empresa_id: EMP,
  tipo: "Abate",
  lote: "L-2026-014",
  quantidade_animais: 10,
  area_origem_id: P07,
  linhas: [
    {
      categoria: "Boi 25 a 36 meses",
      quantidade: 10,
      peso_vivo_total_kg: 5400,
      peso_carcaca_total_kg: 2900,
      destino: "Frigorífico",
      destino_nome: "FRIGORÍFICO MODELO",
      distribuicao: [{ lote_id: "p14", posicao_id: "p14", nome: "L-2026-014", quantidade: 10 }],
    },
  ],
  ...ledger("abate", "2026-10-12", "2026-10-12T08:00:00.000Z"),
};

const MUDANCA = {
  id: "mv-mudanca",
  empresa_id: EMP,
  tipo: "Mudança de Categoria",
  lote: "L-2026-031",
  quantidade_animais: 12,
  area_origem_id: P07,
  linhas: [
    { quantidade: 12, categoria_atual: "Bezerro 0 a 12 meses", categoria_nova: "Garrote 13 a 24 meses", categoria_manejo_nome: "Recria", partes: [{ modo: "parcial", quantidade: 12, de_posicao_id: "p31", para_posicao_id: "p40" }] },
  ],
  ...ledger("mudanca", "2026-10-20", "2026-10-20T08:00:00.000Z"),
};

const JUNCAO = {
  id: "mv-juncao",
  empresa_id: EMP,
  tipo: "Junção de Lotes",
  lote: "L-2026-019",
  quantidade_animais: 20,
  area_origem_id: P07,
  juncao: { principal: { nome: "L-2026-019", quantidade_antes: 54, quantidade_depois: 74 } },
  linhas: [
    { nome: "L-2026-020", quantidade: 12, peso_medio_kg: 300 },
    { nome: "L-2026-021", quantidade: 8, peso_medio_kg: null },
  ],
  ...ledger("juncao", "2026-10-14", "2026-10-14T08:00:00.000Z"),
};

const SUPL = {
  id: "ev-1",
  empresa_id: EMP,
  ponto_suplementacao_id: "k07",
  ponto_nome: "Cocho 07",
  area_id: P07,
  area_ids: [P07],
  data_lancamento: "2026-11-09",
  produto: "SAL MINERAL 80",
  quantidade_total_kg: 400,
  quantidade_sacos: 16,
  peso_por_saco_kg: 25,
  unidade_lancamento: "SACO",
  created_date: "2026-11-09T14:00:00.000Z",
};

const pares = (cartao) => cartao.linhas.map((l) => [l.rotulo, l.valor]);

describe("formatos e filtros", () => {
  it("dia do v12: 'DD MMM. AAAA' com MAIO sem ponto; sem dia → no fim, sem data inventada", () => {
    expect(rotuloDoDia("2026-11-09")).toBe("09 NOV. 2026");
    expect(rotuloDoDia("2026-05-01")).toBe("01 MAIO 2026");
    expect(rotuloDoDia("2026-09-30")).toBe("30 SET. 2026");
    expect(rotuloDoDia(null)).toBe(DIA_NAO_INFORMADO);
    expect(rotuloDoDia("2026-13-01")).toBe(DIA_NAO_INFORMADO);
  });

  it("números pt-BR; vazio vira '—' (nunca 0 inventado)", () => {
    expect(fmtNumero(1008)).toBe("1.008");
    expect(fmtNumero(449.5, 1)).toBe("449,5");
    expect(fmtNumero(400, 2)).toBe("400,00");
    expect(fmtNumero(null)).toBe("—");
    expect(fmtNumero("")).toBe("—");
    expect(fmtNumero(-0.0001, 1)).toBe("0,0");
  });

  it("'Mostrar': as 5 opções do v12, na ordem; filtro desconhecido volta para 'Todos os registros'", () => {
    expect(FILTROS_DO_HISTORICO.map((f) => f.rotulo)).toEqual(["Todos os registros", "Movimentações", "Pesagens", "Manejos", "Suplementação"]);
    expect(filtroValido("pes")).toBe("pes");
    expect(filtroValido("qualquer")).toBe("todos");
    expect(rotuloDoFiltro("man")).toBe("Manejos");
    expect(rotuloDoFiltro(undefined)).toBe("Todos os registros");
  });
});

describe("cartões por tipo (só dado real)", () => {
  it("transferência que chega: 'Movimentação · entrada' com Lote, Cabeças, De e Até — sem 'Peso médio' nem 'Registrado por'", () => {
    const [c, ...resto] = cartoesDaMovimentacao(ENTRADA, CTX, { doServidor: true });
    expect(resto).toEqual([]);
    expect(c.titulo).toBe("Movimentação · entrada");
    expect(c.grupo).toBe("mov");
    expect(c.icone).toBe("movimentacao");
    expect(pares(c)).toEqual([
      ["Lote", "L-2026-027"],
      ["Cabeças", "33"],
      ["De", "Pasto 04"],
      ["Até", "Pasto 07"],
    ]);
    expect(c.cancelado).toBe(false);
    expect(c.ordem.oc).toBe("2026-11-05");
  });

  it("transferência que sai com dois lotes: um cartão 'Movimentação · saída' por lote", () => {
    const cartoes = cartoesDaMovimentacao(SAIDA_DOIS_LOTES, CTX);
    expect(cartoes.map((c) => c.titulo)).toEqual(["Movimentação · saída", "Movimentação · saída"]);
    expect(pares(cartoes[0])).toEqual([["Lote", "L-2026-004"], ["Cabeças", "72"], ["De", "Pasto 07"], ["Até", "Pasto 08"]]);
    expect(pares(cartoes[1])).toEqual([["Lote", "L-2026-005"], ["Cabeças", "28"], ["De", "Pasto 07"], ["Até", "Pasto 08"]]);
    expect(new Set(cartoes.map((c) => c.chave)).size).toBe(2);
  });

  it("linha da transferência que não passou por este pasto fica fora; nome de área ausente usa o do pasto", () => {
    const mov = {
      ...ENTRADA,
      id: "mv-misto",
      area_destino_nome: undefined,
      linhas: [
        { ...ENTRADA.linhas[0], area_origem_id: "a-p04", area_origem_nome: "Pasto 04", nome: "L-A" },
        { ...ENTRADA.linhas[0], area_origem_id: "a-p02", area_origem_nome: "Pasto 02", nome: "L-B" },
      ],
      area_destino_id: "a-p09",
    };
    expect(cartoesDaMovimentacao(mov, { areaId: "a-p02", areaNome: "Pasto 02" }).map((c) => pares(c)[0][1])).toEqual(["L-B"]);
    const entrada = cartoesDaMovimentacao({ ...ENTRADA, area_destino_nome: null }, CTX)[0];
    expect(pares(entrada)[3]).toEqual(["Até", "Pasto 07"]);
  });

  it("transferência antiga (sem linhas): campos do documento; o peso médio só aparece porque o registro antigo o guardava", () => {
    const antiga = {
      id: "mv-antiga",
      empresa_id: EMP,
      tipo: "Transferência de Área",
      lote: "LOTE VELHO",
      lote_id: "l-velho",
      quantidade_animais: 40,
      peso_medio: 312.8,
      area_origem_id: "a-p04",
      area_origem_nome: "Pasto 04",
      area_destino_id: P07,
      area_destino_nome: "Pasto 07",
      data_movimentacao: "2026-08-25T12:00:00.000Z",
      created_date: "2026-08-25T12:00:00.000Z",
    };
    const [c] = cartoesDaMovimentacao(antiga, CTX);
    expect(c.titulo).toBe("Movimentação · entrada");
    expect(pares(c)).toEqual([["Lote", "LOTE VELHO"], ["Cabeças", "40"], ["De", "Pasto 04"], ["Até", "Pasto 07"], ["Peso médio (kg)", "312,8"]]);
    const semPeso = cartoesDaMovimentacao({ ...antiga, peso_medio: undefined }, CTX)[0];
    expect(semPeso.linhas.some((l) => l.rotulo === "Peso médio (kg)")).toBe(false);
  });

  it("pesagem: um cartão por lote pesado, com cabeças pesadas, peso médio (1 casa) e Origem MEDIDO", () => {
    const cartoes = cartoesDaMovimentacao(PESAGEM, CTX, { doServidor: true });
    expect(cartoes.map((c) => [c.titulo, c.grupo, c.icone])).toEqual([
      ["Pesagem", "pes", "pesagem"],
      ["Pesagem", "pes", "pesagem"],
    ]);
    expect(pares(cartoes[0])).toEqual([["Lote", "L-2026-008"], ["Cabeças pesadas", "38"], ["Peso médio (kg)", "449,5"], ["Origem", "MEDIDO"]]);
    expect(pares(cartoes[1])).toEqual([["Lote", "L-2026-014"], ["Cabeças pesadas", "86"], ["Peso médio (kg)", "382,5"], ["Origem", "MEDIDO"]]);
  });

  it("nascimento: o nome do lote só onde o documento o guarda; a outra linha mostra a categoria do bezerro", () => {
    const [macho, femea] = cartoesDaMovimentacao(NASCIMENTO, CTX);
    expect(macho.titulo).toBe("Nascimento");
    expect(macho.grupo).toBe("man");
    expect(pares(macho)).toEqual([["Lote", "NASCIDOS BEZERRO 0 A 12 MESES"], ["Quantidade", "3"], ["Sexo", "MACHO"], ["Peso médio (kg)", "32,0"]]);
    expect(pares(femea)).toEqual([["Categoria", "BEZERRA 0 A 12 MESES"], ["Quantidade", "2"], ["Sexo", "FÊMEA"], ["Peso médio (kg)", "—"]]);
  });

  it("morte: um cartão por lote da distribuição, com a causa em maiúsculas", () => {
    const cartoes = cartoesDaMovimentacao(MORTE, CTX);
    expect(cartoes.map((c) => [c.titulo, c.icone])).toEqual([
      ["Morte", "morte"],
      ["Morte", "morte"],
    ]);
    expect(pares(cartoes[0])).toEqual([["Lote", "L-2026-031"], ["Quantidade", "2"], ["Causa", "DOENÇA"]]);
    expect(pares(cartoes[1])).toEqual([["Lote", "L-2026-032"], ["Quantidade", "1"], ["Causa", "DOENÇA"]]);
  });

  it("saída (abate): destino e pesos totais quando a linha é de um lote só; com vários lotes o peso da linha não vai para o lote", () => {
    const [c] = cartoesDaMovimentacao(ABATE, CTX);
    expect(c.titulo).toBe("Saída");
    expect(c.icone).toBe("saida");
    expect(pares(c)).toEqual([
      ["Lote", "L-2026-014"],
      ["Quantidade", "10"],
      ["Destino", "FRIGORÍFICO (FRIGORÍFICO MODELO)"],
      ["Peso vivo total (kg)", "5.400,0"],
      ["Peso de carcaça total (kg)", "2.900,0"],
    ]);
    const dividida = {
      ...ABATE,
      linhas: [{ ...ABATE.linhas[0], distribuicao: [{ nome: "L-A", quantidade: 6 }, { nome: "L-B", quantidade: 4 }] }],
    };
    const partes = cartoesDaMovimentacao(dividida, CTX);
    expect(partes.map((p) => pares(p))).toEqual([
      [["Lote", "L-A"], ["Quantidade", "6"], ["Destino", "FRIGORÍFICO (FRIGORÍFICO MODELO)"]],
      [["Lote", "L-B"], ["Quantidade", "4"], ["Destino", "FRIGORÍFICO (FRIGORÍFICO MODELO)"]],
    ]);
  });

  it("mudança de categoria: anterior → nova (e a categoria de manejo); o lote só quando a linha saiu de um lote só", () => {
    const [c] = cartoesDaMovimentacao(MUDANCA, CTX);
    expect(c.titulo).toBe("Mudança de Categoria");
    expect(pares(c)).toEqual([
      ["Lote", "L-2026-031"],
      ["Quantidade", "12"],
      ["Categoria anterior", "BEZERRO 0 A 12 MESES"],
      ["Categoria nova", "GARROTE 13 A 24 MESES"],
      ["Cat. de manejo", "RECRIA"],
    ]);
    const duasPartes = { ...MUDANCA, linhas: [{ ...MUDANCA.linhas[0], partes: [{}, {}] }] };
    expect(cartoesDaMovimentacao(duasPartes, CTX)[0].linhas.some((l) => l.rotulo === "Lote")).toBe(false);
  });

  it("junção: lote que recebeu, lotes juntados e quantidade", () => {
    const [c] = cartoesDaMovimentacao(JUNCAO, CTX);
    expect(c.titulo).toBe("Junção de Lotes");
    expect(c.icone).toBe("juncao");
    expect(pares(c)).toEqual([["Lote", "L-2026-019"], ["Lotes juntados", "L-2026-020 · L-2026-021"], ["Quantidade", "20"]]);
  });

  it("cancelado: marcado (o chip 'Cancelado' é do componente) e com o motivo, quando gravado", () => {
    const cancelado = { ...ENTRADA, situacao: "cancelado", cancelamento: { em: "2026-11-06T10:00:00.000Z", por_login: "admin", motivo: "Lançado no pasto errado" } };
    const [c] = cartoesDaMovimentacao(cancelado, CTX);
    expect(c.cancelado).toBe(true);
    expect(pares(c).at(-1)).toEqual(["Motivo do cancelamento", "Lançado no pasto errado"]);
    const semMotivo = cartoesDaMovimentacao({ ...cancelado, cancelamento: {} }, CTX)[0];
    expect(semMotivo.cancelado).toBe(true);
    expect(semMotivo.linhas.some((l) => l.rotulo === "Motivo do cancelamento")).toBe(false);
  });

  it("tipo sem desenho próprio: título do documento, nunca some", () => {
    const [c] = cartoesDaMovimentacao({ id: "x", tipo: "Entrada", motivo: "Renomear Lote", lote: "NOVO NOME", data_movimentacao: "2026-10-01" }, CTX);
    expect(c.titulo).toBe("Renomear Lote");
    expect(c.grupo).toBe("man");
    expect(pares(c)).toEqual([["Lote", "NOVO NOME"]]);
    expect(cartoesDaMovimentacao(null, CTX)).toEqual([]);
  });

  it("suplementação: Cocho, Produto, Quantidade (kg) e Sacos — os lançados em saco ou kg ÷ peso do saco", () => {
    const c = cartaoDaSuplementacao(SUPL);
    expect(c.titulo).toBe("Suplementação");
    expect(c.grupo).toBe("sup");
    expect(pares(c)).toEqual([["Cocho", "Cocho 07"], ["Produto", "SAL MINERAL 80"], ["Quantidade (kg)", "400,00"], ["Sacos", "16,00"]]);
    expect(pares(cartaoDaSuplementacao({ ...SUPL, quantidade_sacos: null, quantidade_total_kg: 250 }))[3]).toEqual(["Sacos", "10,00"]);
    expect(pares(cartaoDaSuplementacao({ ...SUPL, quantidade_sacos: null, peso_por_saco_kg: null }))[3]).toEqual(["Sacos", "—"]);
    expect(c.ordem.oc).toBe("2026-11-09");
  });

  it("evento do pasto: pela área (area_id ou area_ids) e pela empresa", () => {
    expect(eventoDoPasto(SUPL, P07, EMP)).toBe(true);
    expect(eventoDoPasto({ ...SUPL, area_id: "a-p01", area_ids: ["a-p01", P07] }, P07)).toBe(true);
    expect(eventoDoPasto({ ...SUPL, area_id: "a-p01", area_ids: ["a-p01"] }, P07)).toBe(false);
    expect(eventoDoPasto({ ...SUPL, empresa_id: "outra" }, P07, EMP)).toBe(false);
    expect(eventoDoPasto(SUPL, null)).toBe(false);
  });
});

describe("linha do tempo do pasto", () => {
  const TODOS = [ENTRADA, PESAGEM, MORTE, NASCIMENTO, MUDANCA, JUNCAO, ABATE, SAIDA_DOIS_LOTES];
  const OUTRO_PASTO = { ...SUPL, id: "ev-2", area_id: "a-p01", area_ids: ["a-p01"], data_lancamento: "2026-11-10" };

  it("agrupa por dia, o mais recente primeiro (ordem H2); no mesmo dia, o registrado por último primeiro", () => {
    const { dias, total } = montarHistoricoDoPasto({ movimentacoes: TODOS, eventos: [SUPL, OUTRO_PASTO], areaId: P07, areaNome: "Pasto 07", doServidor: true });
    expect(dias.map((d) => d.rotulo)).toEqual([
      "09 NOV. 2026",
      "05 NOV. 2026",
      "03 NOV. 2026",
      "28 OUT. 2026",
      "20 OUT. 2026",
      "14 OUT. 2026",
      "12 OUT. 2026",
      "02 SET. 2026",
    ]);
    expect(dias[0].cartoes.map((c) => c.titulo)).toEqual(["Suplementação"]);
    // 03/11: pesagem registrada às 18h, morte às 9h.
    expect(dias[2].cartoes.map((c) => c.titulo)).toEqual(["Pesagem", "Pesagem", "Morte", "Morte"]);
    expect(total).toBe(13);
    expect(dias.flatMap((d) => d.cartoes).some((c) => c.linhas.some((l) => l.rotulo === "Registrado por"))).toBe(false);
  });

  it("filtros: Movimentações, Pesagens, Manejos e Suplementação", () => {
    const titulos = (filtro) =>
      montarHistoricoDoPasto({ movimentacoes: TODOS, eventos: [SUPL], areaId: P07, filtro, doServidor: true }).dias.flatMap((d) => d.cartoes.map((c) => c.titulo));
    expect(titulos("mov")).toEqual(["Movimentação · entrada", "Movimentação · saída", "Movimentação · saída"]);
    expect(titulos("pes")).toEqual(["Pesagem", "Pesagem"]);
    expect(titulos("man")).toEqual(["Morte", "Morte", "Nascimento", "Nascimento", "Mudança de Categoria", "Junção de Lotes", "Saída"]);
    expect(titulos("sup")).toEqual(["Suplementação"]);
    expect(titulos("nao-existe")).toHaveLength(13);
  });

  it("filtro sem registro: nenhum dia (a tela mostra o vazio)", () => {
    const r = montarHistoricoDoPasto({ movimentacoes: [ENTRADA], eventos: [], areaId: P07, filtro: "pes" });
    expect(r.dias).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("sem data da ocorrência: grupo 'DATA NÃO INFORMADA' no fim", () => {
    const semData = { ...PESAGEM, id: "mv-sem-data", historico_ocorrencia: null, data_movimentacao: null };
    const { dias } = montarHistoricoDoPasto({ movimentacoes: [semData, ENTRADA], areaId: P07, doServidor: true });
    expect(dias.map((d) => d.rotulo)).toEqual(["05 NOV. 2026", DIA_NAO_INFORMADO]);
  });

  it("cache do aparelho (sem H2): a ocorrência vem do dia literal de data_movimentacao", () => {
    const doCache = { ...ENTRADA, historico_ocorrencia: "2020-01-01", data_movimentacao: "2026-11-04T12:00:00.000Z" };
    expect(montarHistoricoDoPasto({ movimentacoes: [doCache], areaId: P07, doServidor: false }).dias[0].rotulo).toBe("04 NOV. 2026");
    expect(montarHistoricoDoPasto({ movimentacoes: [doCache], areaId: P07, doServidor: true }).dias[0].rotulo).toBe("01 JAN. 2020");
  });

  it("com mais páginas, evento mais antigo que a última movimentação carregada espera a próxima página (só em 'Todos')", () => {
    const antigo = { ...SUPL, id: "ev-antigo", data_lancamento: "2026-10-01", created_date: "2026-10-01T10:00:00.000Z" };
    const base = { movimentacoes: [ENTRADA, PESAGEM], eventos: [SUPL, antigo], areaId: P07, doServidor: true };
    const comMais = montarHistoricoDoPasto({ ...base, haMaisPaginas: true });
    expect(comMais.adiados).toBe(1);
    expect(comMais.dias.flatMap((d) => d.cartoes).filter((c) => c.grupo === "sup")).toHaveLength(1);
    expect(montarHistoricoDoPasto({ ...base, haMaisPaginas: false }).adiados).toBe(0);
    // Só suplementação: não há movimentação na tela, nada fica fora de lugar.
    const soSupl = montarHistoricoDoPasto({ ...base, haMaisPaginas: true, filtro: "sup" });
    expect(soSupl.adiados).toBe(0);
    expect(soSupl.total).toBe(2);
  });

  it("agruparPorDia junta só dias seguidos (a entrada já vem ordenada)", () => {
    const c = (oc, id) => ({ chave: id, grupo: "mov", icone: "movimentacao", titulo: id, linhas: [], cancelado: false, ordem: { oc, reg: null, criado: null, id } });
    expect(agruparPorDia([c("2026-11-02", "a"), c("2026-11-02", "b"), c("2026-11-01", "c")]).map((d) => [d.rotulo, d.cartoes.length])).toEqual([
      ["02 NOV. 2026", 2],
      ["01 NOV. 2026", 1],
    ]);
  });
});
