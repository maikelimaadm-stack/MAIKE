/**
 * Detalhes do Lote v12 (D-PROD-218) — catálogo puro: colunas por chave, células
 * da aba Detalhes e dos blocos do lote, status/descanso da área (a mesma regra
 * do mapa) e os números do exemplo do v12.
 *
 * Também guarda o que o detalhesLoteQuadros guardava sobre os campos (D-PROD-124):
 * os mesmos campos da área e do lote, sem "Categoria Oficial" e sem
 * "Sistemas Reprodutivos"/"Lotes:".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  CAMPOS_LOTE,
  COLUNAS_PADRAO,
  SECOES_DO_LOTE,
  SECOES_LOTE,
  camposDaSecao,
  camposDoCartaoDaArea,
  camposDoLote,
  colunasPorChave,
  montarModeloDetalhes,
  normalizarColunas,
  ordenarLotes,
  statusDaArea,
} from "@/components/mapa/detalhes-lote/catalogo";
import { calcularSituacaoPasto } from "@/domain/mapa/mapaGeralDerivados";
import { AREA_V12, HOJE_V12, modeloV12, movimentacoesV12 } from "./fixtures/pastoV12.jsx";

const rotulos = (campos) => campos.map((c) => c.rotulo);
const CHAVES_LOTE = CAMPOS_LOTE.map((c) => c.chave);

describe("colunas da Lista por chave", () => {
  it("padrão = Alertas + Lotação + Pesagem (28 colunas), na ordem do catálogo", () => {
    expect(COLUNAS_PADRAO).toHaveLength(28);
    expect(COLUNAS_PADRAO).toEqual(CAMPOS_LOTE.filter((c) => c.secao !== "Identificação").map((c) => c.chave));
    expect(SECOES_LOTE.map((s) => camposDaSecao(s).length)).toEqual([3, 10, 15, 6]);
  });

  it("colunasPorChave segue a ordem do catálogo e ignora chave desconhecida", () => {
    expect(colunasPorChave(["sexo", "cab", "nada", "alNivel"]).map((c) => c.chave)).toEqual(["alNivel", "cab", "sexo"]);
    expect(colunasPorChave(null)).toEqual([]);
  });

  it("normalizarColunas: só chaves conhecidas, sem repetição; lista vazia vale; o que não é lista → null", () => {
    expect(normalizarColunas(["manejo", "cab", "cab", "raca"])).toEqual(["cab", "manejo"]);
    expect(normalizarColunas([])).toEqual([]);
    expect(normalizarColunas("cab")).toBeNull();
    expect(normalizarColunas(undefined)).toBeNull();
    expect(CHAVES_LOTE).toHaveLength(34);
  });

  it("larguras do v12: nome à parte; projeção do mês 172, tipo de alerta e atinge 128, pesado × previsto e base 116; o resto cresce de 84", () => {
    const largura = Object.fromEntries(CAMPOS_LOTE.map((c) => [c.chave, c.largura]));
    expect(largura).toMatchObject({ projMeses: "172px", alTipo: "128px", atinge: "128px", pesPrev: "116px", baseProj: "116px", cab: "minmax(84px, auto)", sexo: "minmax(84px, auto)" });
  });
});

describe("números do exemplo do v12 (Pasto 07, 6 lotes, 314 cab)", () => {
  const modelo = modeloV12();

  it("resumo e totais da área", () => {
    expect(modelo.resumo).toEqual({ pesoMedio: "329,7", pesoMedioProjetado: "342,6", cab: "314", uaHa: "2,24", kgPvHa: "1.008" });
    expect(modelo.totais).toMatchObject({ cab: "314", peso: "329,7", partCab: "100%", ua: "230,09", partUA: "100%", uaha: "2,24", kgpvha: "1.008", dias: "26", pesoTotal: "103.540", ocupacao: "6.457", projetado: "342,6" });
  });

  it("textos do item do Resumo: '38 cb · 38,0 UA · VACA' e '449,5 kg'", () => {
    const vaca = modelo.lotes.find((l) => l.nome === "L-2026-008");
    expect(vaca.textos).toEqual({ meta: "38 cb · 38,0 UA · VACA", pesoKg: "449,5 kg" });
    expect(vaca.situacao).toEqual({ rotulo: "Atenção", tom: "atencao" });
    expect(vaca.alertas.map((a) => a.frase)).toEqual(["Faz 82 dias sem pesar"]);
  });

  it("ordenarLotes: nome (pt-BR), coluna com vazios no fim nos dois sentidos", () => {
    const nomes = (ls) => ls.map((l) => l.nome);
    expect(nomes(ordenarLotes(modelo.lotes, { chave: "nome", dir: 1 }))).toEqual(["L-2026-008", "L-2026-014", "L-2026-019", "L-2026-022", "L-2026-025", "L-2026-027"]);
    expect(nomes(ordenarLotes(modelo.lotes, { chave: "alValor", dir: -1 }))[0]).toBe("L-2026-008");
    expect(nomes(ordenarLotes(modelo.lotes, { chave: "alValor", dir: 1 }))[0]).toBe("L-2026-008");
  });
});

describe("aba Detalhes: células", () => {
  it("cartão da área na ordem do v12, com setor e status de fora", () => {
    const area = modeloV12().area;
    const campos = camposDoCartaoDaArea(area, { setor: "Retiro", status: { texto: "OCUPADO", cor: "#1f2937" } });
    expect(campos.map((c) => [c.rotulo, c.texto])).toEqual([
      ["Setor", "Retiro"],
      ["Hectares", "109,30"],
      ["Área pastejada (ha)", "102,70"],
      ["Pastagem", "Braquiária Brizantha"],
      ["Status", "OCUPADO"],
      ["Dias pastejo", "26"],
    ]);
    expect(area.sub).toBe("Pastagem / Braquiária Brizantha");
    expect(camposDoCartaoDaArea(area, { setor: "", status: { texto: "VAZIO", cor: "#64748b" } })[0].texto).toBe("—");
  });

  it("Lotação: 9 células com sub só em UA total, UA/ha (faixa) e Capacidade; % da capacidade em âmbar acima de 100", () => {
    const { lotacao } = modeloV12().area;
    expect(rotulos(lotacao)).toEqual(["Qtd. Lotes", "Qtd. Cabeças", "UA total", "UA/ha", "Capacidade (UA/ha)", "% da capacidade", "kg PV/ha", "Cab/ha", "Peso médio geral (kg)"]);
    const por = Object.fromEntries(lotacao.map((c) => [c.rotulo, c]));
    expect(por["UA total"].dica).toBe("peso vivo ÷ 450");
    expect(por["UA/ha"]).toMatchObject({ texto: "2,24", dot: "#f59e0b", dica: "Alta (1,8 - 2,4 UA/ha)" });
    expect(por["Capacidade (UA/ha)"]).toMatchObject({ texto: "2,20", dica: "capacidade máxima ÷ hectares" });
    expect(por["% da capacidade"]).toMatchObject({ texto: "102%", cor: "#b45309", barra: 100, corBarra: "#f59e0b" });
    expect(lotacao.filter((c) => c.dica).map((c) => c.rotulo)).toEqual(["UA total", "UA/ha", "Capacidade (UA/ha)"]);
  });

  it("categorias: '20% do pasto · peso 196 kg' e '62 cab'; sem peso, só a participação", () => {
    expect(modeloV12().area.categorias.map((c) => [c.nome, c.descricao, c.valor])).toEqual([
      ["BEZERRO", "20% do pasto · peso 196 kg", "62 cab"],
      ["BOI MAGRO", "40% do pasto · peso 377 kg", "127 cab"],
      ["NOVILHA", "28% do pasto · peso 304 kg", "87 cab"],
      ["VACA", "12% do pasto · peso 450 kg", "38 cab"],
    ]);
    const semPeso = montarModeloDetalhes({ area: AREA_V12, lotes: [{ id: "x", categoria: "Boi", quantidade_cabecas: 10 }], hoje: HOJE_V12 });
    expect(semPeso.area.categorias[0].descricao).toBe("100% do pasto");
  });

  it("sem gado: Sem gado (cinza), UA total 0,00, Cab/ha e % da capacidade —", () => {
    const area = modeloV12({ qtd: 0 }).area;
    const por = Object.fromEntries(area.lotacao.map((c) => [c.rotulo, c]));
    expect(por["UA/ha"]).toMatchObject({ texto: "—", dot: "#d1d5db", dica: "Sem gado" });
    expect(por["UA total"].texto).toBe("0,00");
    expect(por["Cab/ha"].texto).toBe("—");
    expect(por["% da capacidade"].texto).toBe("—");
    expect(por["% da capacidade"].barra).toBeUndefined();
    expect(area.campos.dias.texto).toBe("—");
    expect(area.categorias).toEqual([]);
  });
});

describe("status da área: OCUPADO, descanso desde a última saída (regra do mapa), VAZIO", () => {
  it("com cabeças é OCUPADO, sem olhar as movimentações", () => {
    expect(statusDaArea({ areaId: AREA_V12.id, cab: 10, movimentacoes: movimentacoesV12({ saidaEm: "2026-10-01" }), hoje: HOJE_V12 })).toEqual({ texto: "OCUPADO", cor: "#1f2937", descansoDias: null });
  });

  it("vazio com saída: dias desde a saída MAIS RECENTE (como calcularSituacaoPasto)", () => {
    const movs = [
      { id: "s1", tipo: "Transferência de Área", data_movimentacao: "2026-09-01", area_origem_id: AREA_V12.id },
      { id: "s2", tipo: "Transferência de Área", data_movimentacao: "2026-10-25", area_origem_id: AREA_V12.id },
      { id: "e1", tipo: "Transferência de Área", data_movimentacao: "2026-11-10", area_origem_id: "outra", area_destino_id: AREA_V12.id },
    ];
    const status = statusDaArea({ areaId: AREA_V12.id, cab: 0, movimentacoes: movs, hoje: HOJE_V12 });
    expect(status).toEqual({ texto: "VAZIO · descanso há 21 dias", cor: "#64748b", descansoDias: 21 });
    const mapa = calcularSituacaoPasto({ areas: [{ id: AREA_V12.id }], lotes: [], movimentacoes: movs, agora: HOJE_V12 })[AREA_V12.id];
    expect(mapa).toEqual({ tipo: "descanso", dias: 21 });
    // Saída por linha (ledger) também conta; 1 dia no singular.
    const porLinha = [{ id: "s3", tipo: "Transferência de Área", data_movimentacao: "2026-11-14", linhas: [{ area_origem_id: AREA_V12.id }] }];
    expect(statusDaArea({ areaId: AREA_V12.id, cab: 0, movimentacoes: porLinha, hoje: HOJE_V12 }).texto).toBe("VAZIO · descanso há 1 dia");
  });

  it("vazio sem saída (ou saída hoje, ou sem área) → VAZIO", () => {
    expect(statusDaArea({ areaId: AREA_V12.id, cab: 0, movimentacoes: [], hoje: HOJE_V12 }).texto).toBe("VAZIO");
    const hoje = [{ id: "s", tipo: "Transferência de Área", data_movimentacao: "2026-11-15", area_origem_id: AREA_V12.id }];
    expect(statusDaArea({ areaId: AREA_V12.id, cab: 0, movimentacoes: hoje, hoje: HOJE_V12 }).texto).toBe("VAZIO");
    expect(statusDaArea({ areaId: null, cab: 0, movimentacoes: hoje, hoje: HOJE_V12 }).texto).toBe("VAZIO");
  });
});

describe("blocos do lote", () => {
  const vaca = modeloV12().lotes.find((l) => l.nome === "L-2026-008");

  it("seções abertas Lotação, Pesagem e Identificação (os alertas viram avisos)", () => {
    expect(SECOES_DO_LOTE).toEqual(["Lotação", "Pesagem", "Identificação"]);
  });

  it("dica só nos campos de projeção da Pesagem", () => {
    const comDica = SECOES_DO_LOTE.flatMap((s) => camposDoLote(vaca, s)).filter((c) => c.dica).map((c) => c.chave);
    expect(comDica).toEqual(["projetado", "projArroba", "projMeses"]);
    const proj = camposDoLote(vaca, "Pesagem").find((c) => c.chave === "projMeses");
    expect(proj).toMatchObject({ quebra: true, texto: "30/11: 469 · 31/12: 475 · 31/01: 481" });
  });

  it("Identificação começa por Categoria (que não é coluna da tabela)", () => {
    const ident = camposDoLote(vaca, "Identificação");
    expect(rotulos(ident)).toEqual(["Categoria", "Sexo", "Sist. Rep.", "Identificador", "Sigla", "Entrada", "Cat. de manejo"]);
    expect(ident[0].texto).toBe("VACA");
    expect(ident.find((c) => c.rotulo === "Identificador")).toMatchObject({ texto: "VERMELHO", dot: "#ef4444" });
    expect(CHAVES_LOTE).not.toContain("categoria");
  });
});

describe("os mesmos campos do lote e da área (D-PROD-124), no v12", () => {
  const fonte = (rel) => readFileSync(rel, "utf8");
  const ARQUIVOS = [
    "src/components/mapa/detalhes-lote/catalogo.js",
    "src/components/mapa/detalhes-lote/AbaDetalhes.jsx",
    "src/components/mapa/detalhes-lote/BlocosLote.jsx",
    "src/components/mapa/detalhes-lote/VistaResumo.jsx",
    "src/components/mapa/detalhes-lote/VistaLista.jsx",
  ];

  it("lote: identificador, sigla, cabeças, peso médio, dias de pastejo, sistema, sexo e categoria de manejo", () => {
    const vaca = modeloV12().lotes[0];
    const todos = rotulos(SECOES_DO_LOTE.flatMap((s) => camposDoLote(vaca, s)));
    for (const r of ["Identificador", "Sigla", "Cab.", "Peso médio (kg)", "Dias pastejo", "Sist. Rep.", "Sexo", "Cat. de manejo", "Categoria"]) expect(todos, r).toContain(r);
  });

  it("área: hectares, UA/ha, UA total, lotes, cabeças, peso médio geral, pastagem e dias de pastejo", () => {
    const area = modeloV12().area;
    const todos = rotulos([...camposDoCartaoDaArea(area, { setor: "Retiro", status: { texto: "OCUPADO", cor: "" } }), ...area.lotacao]);
    for (const r of ["Hectares", "UA/ha", "UA total", "Qtd. Lotes", "Qtd. Cabeças", "Peso médio geral (kg)", "Pastagem", "Dias pastejo", "Setor", "Status"]) expect(todos, r).toContain(r);
  });

  it("sem 'Categoria Oficial', 'Sistemas Reprodutivos' nem 'Lotes:'; sem Raça", () => {
    for (const rel of ARQUIVOS) {
      const f = fonte(rel);
      expect(f, rel).not.toContain("Categoria Oficial");
      expect(f, rel).not.toMatch(/Sistemas Reprodutivos|Lotes:/);
      expect(f, rel).not.toMatch(/Raça/);
    }
  });
});

it("peso médio projetado pondera cabeças e usa somente projeções disponíveis, sem substituir por peso atual", () => {
  const lotes = [
    { id: 'a', quantidade_cabecas: 80, peso_medio_kg: 300, projecao_peso: { disponivel: true, peso_kg: 400 } },
    { id: 'b', quantidade_cabecas: 20, peso_medio_kg: 500, projecao_peso: { disponivel: true, peso_kg: 600 } },
  ];
  const modelo = montarModeloDetalhes({ area: AREA_V12, lotes, hoje: HOJE_V12 });
  expect(modelo.resumo.pesoMedioProjetado).toBe('440,0');
  expect(modelo.resumo.pesoMedio).toBe('340,0');
  expect(modelo.resumo.pesoMedioProjetado).toBe(modelo.totais.projetado);
  const sem = lotes.map(l => ({ ...l, projecao_peso: { disponivel: false, peso_kg: 999 } }));
  expect(montarModeloDetalhes({ area: AREA_V12, lotes: sem }).resumo.pesoMedioProjetado).toBe('—');
});
