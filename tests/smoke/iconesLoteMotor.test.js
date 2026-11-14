/**
 * MAIKE-ICONES-LOTE-CODIGO (D-PROD-191) — motor do ícone do lote.
 *
 * O desenho do lote vem do código (src/assets/icones/lotes), pela chave SEXO + FAIXA
 * DE IDADE da Categoria de Manejo. Aqui: fidelidade dos 15 SVGs do proprietário, as
 * constantes, os 5 níveis da cascata, o invariante "sempre sai figura", a faixa da
 * contagem livre de animal, o tamanho por faixa, a borda igual na tela e o subícone
 * que nunca é misto.
 */
import { describe, it, expect } from "vitest";
import { ANIMAIS_SVG } from "@/assets/icones/lotes/animais";
import { MISTOS_SVG } from "@/assets/icones/lotes/mistos";
import { QUADRADINHO_SVG } from "@/assets/icones/lotes/quadradinho";
import {
  BORDA_PADRAO,
  BORDA_VACA_MISTO,
  CARD_FRAC,
  CONTAGEM_TOPO_PCT,
  COR_FEMEA,
  COR_MACHO,
  COR_MISTO,
  FAIXA_CONTAGEM,
  FAIXA_SEM_IDADE,
  FIGURA_ULTIMO_RECURSO,
  FIGURAS_ANIMAIS,
  FIGURAS_MISTOS,
  LARGURA_MARCADOR_PX,
  LIMITE_ANIMAIS,
  LINHA_DE_CHAO,
  ROTULO_MISTO,
  TABELA_MISTOS,
  TAMANHO_MISTO,
  TAMANHO_POR_FAIXA,
  chaveDaPosicao,
  desenhosDoMarcador,
  figuraDaPosicao,
  figuraDe,
  figuraDoGrupo,
  larguraUtilDoCard,
  mapaDeCategorias,
  resolverFiguraDoPasto,
  svgMarcadorLote,
  svgSubiconeLote,
  urlMarcadorLote,
  urlSubiconeLote,
} from "@/assets/icones/lotes";
import { FAIXAS_IDADE_CATEGORIA_MANEJO } from "@/domain/lotes/categoriaOficialDerivada";

/** `_medidas.json` do zip do proprietário (altura de cada desenho, viewBox 0 0 1000 H). */
const MEDIDAS = {
  "femea-0-8": { altura: 837.91, paths: 1, tem_vaca: false },
  "femea-9-12": { altura: 821.82, paths: 1, tem_vaca: false },
  "femea-13-24": { altura: 752.26, paths: 2, tem_vaca: false },
  "femea-25-36": { altura: 738.07, paths: 2, tem_vaca: false },
  "femea-37-mais": { altura: 673.26, paths: 2, tem_vaca: true },
  "macho-0-8": { altura: 848.12, paths: 1, tem_vaca: false },
  "macho-9-12": { altura: 839.5, paths: 1, tem_vaca: false },
  "macho-13-24": { altura: 745.98, paths: 1, tem_vaca: false },
  "macho-25-36": { altura: 688.68, paths: 1, tem_vaca: false },
  "macho-37-mais": { altura: 703.59, paths: 1, tem_vaca: false },
  misto1: { altura: 577.32, paths: 4, tem_vaca: true },
  misto2: { altura: 703.59, paths: 3, tem_vaca: true },
  misto3: { altura: 577.32, paths: 2, tem_vaca: false },
  misto4: { altura: 575.4, paths: 3, tem_vaca: true },
};

const FAIXAS = FAIXAS_IDADE_CATEGORIA_MANEJO.map((f) => f.rotulo);
const SEXOS = ["MACHO", "FEMEA"];

/** Categoria de Manejo de teste: id = sexo + faixa. */
const cat = (sexo, faixa) => {
  const f = FAIXAS_IDADE_CATEGORIA_MANEJO.find((x) => x.rotulo === faixa);
  return { id: `${sexo}|${faixa}`, sexo: sexo === "FEMEA" ? "Fêmea" : "Macho", idade_minima_meses: f.idade_minima_meses, idade_maxima_meses: f.idade_maxima_meses };
};
const CATEGORIAS = SEXOS.flatMap((s) => FAIXAS.map((f) => cat(s, f)));
/** Posição do rebanho apontando para a categoria (sexo, faixa). */
const pos = (sexo, faixa, cabecas) => ({ categoria_manejo_id: `${sexo}|${faixa}`, quantidade_cabecas: cabecas });
const resolver = (posicoes) => resolverFiguraDoPasto(posicoes, CATEGORIAS);

const xml = (texto) => new DOMParser().parseFromString(texto, "image/svg+xml");
const escalaDe = (g) => Number(/scale\(([^)]+)\)/.exec(g.getAttribute("transform"))[1]);

describe("ICL-A — os 15 SVGs do proprietário, como vieram", () => {
  it("cada animal e misto tem o viewBox 0 0 1000 H do _medidas.json, os mesmos caminhos e a marca da vaca", () => {
    const todos = { ...ANIMAIS_SVG, ...MISTOS_SVG };
    expect(Object.keys(todos).sort()).toEqual(Object.keys(MEDIDAS).sort());
    for (const [nome, m] of Object.entries(MEDIDAS)) {
      const svg = todos[nome];
      expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${m.altura}" fill="currentColor">`), nome).toBe(true);
      expect(svg.match(/<path\b/g), nome).toHaveLength(m.paths);
      expect(svg.includes('data-vaca="1"'), nome).toBe(m.tem_vaca);
      expect(svg.endsWith("</svg>"), nome).toBe(true);
    }
  });

  it("a moldura é o quadradinho 1000 × 961,94 e o card ocupa CARD_FRAC = 0,8851 da altura", () => {
    expect(QUADRADINHO_SVG.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 961.94">')).toBe(true);
    expect(CARD_FRAC).toBe(0.8851);
    expect(FAIXA_CONTAGEM).toBe(0.66);
  });
});

describe("ICL-B — constantes do proprietário, exatamente", () => {
  it("cores, bordas e tamanhos", () => {
    expect([COR_FEMEA, COR_MACHO, COR_MISTO]).toEqual(["#d4a017", "#1f7a8c", "#ff0000"]);
    expect([BORDA_PADRAO, BORDA_VACA_MISTO]).toEqual([3, 5]);
    expect(TAMANHO_POR_FAIXA).toEqual({
      "0 a 8 meses": 0.7,
      "9 a 12 meses": 0.78,
      "13 a 24 meses": 0.86,
      "25 a 36 meses": 0.94,
      "Maior que 36 meses": 1,
    });
    expect(TAMANHO_MISTO).toBe(1);
    expect(LARGURA_MARCADOR_PX).toBe(44);
  });

  it("as faixas do tamanho são as faixas fixas da Categoria de Manejo (D-PROD-186), na mesma ordem", () => {
    expect(Object.keys(TAMANHO_POR_FAIXA)).toEqual(FAIXAS);
  });

  it("tabela de mistos: composição, prioridade e regra MINIMA; nome provisório = a chave", () => {
    expect(TABELA_MISTOS.map((m) => [m.chave, [...m.composicao], m.prioridade, m.tipo_regra])).toEqual([
      ["misto1", ["macho-37-mais", "femea-37-mais", "macho-0-8"], 10, "MINIMA"],
      ["misto2", ["macho-37-mais", "femea-37-mais"], 20, "MINIMA"],
      ["misto3", ["macho-37-mais", "macho-0-8"], 20, "MINIMA"],
      ["misto4", ["femea-37-mais", "macho-0-8"], 20, "MINIMA"],
    ]);
    expect(ROTULO_MISTO).toEqual({ misto1: "misto1", misto2: "misto2", misto3: "misto3", misto4: "misto4" });
    for (const m of TABELA_MISTOS) for (const f of m.composicao) expect(FIGURAS_ANIMAIS, `${m.chave}: ${f}`).toContain(f);
  });

  it("figura = sexo + faixa, nos nomes dos arquivos do proprietário", () => {
    expect(figuraDe("Fêmea", "13 a 24 meses")).toBe("femea-13-24");
    expect(figuraDe("MACHO", "Maior que 36 meses")).toBe("macho-37-mais");
    expect(figuraDe("Misto", "0 a 8 meses")).toBeNull();
    expect(figuraDe("Macho", "0 a 12 meses")).toBeNull();
    expect(SEXOS.flatMap((s) => FAIXAS.map((f) => figuraDe(s, f))).sort()).toEqual([...FIGURAS_ANIMAIS].sort());
  });
});

describe("ICL-C — sexo e faixa de cada posição", () => {
  const porId = mapaDeCategorias(CATEGORIAS);

  it("a Categoria de Manejo manda: sexo e faixa dela, mesmo com o texto oficial dizendo outra coisa", () => {
    const p = { categoria_manejo_id: "FEMEA|9 a 12 meses", sexo: "Macho", categoria: "Touro + 36 meses", quantidade_cabecas: "12" };
    expect(chaveDaPosicao(p, porId)).toEqual({ sexo: "FEMEA", faixa: "9 a 12 meses", cabecas: 12 });
  });

  it("sem categoria de manejo conhecida: sexo da posição e faixa do texto oficial (0 a 12 → 0 a 8)", () => {
    expect(chaveDaPosicao({ categoria: "Bezerra 0 a 12 meses", quantidade_cabecas: 5 }, porId)).toEqual({ sexo: "FEMEA", faixa: "0 a 8 meses", cabecas: 5 });
    expect(chaveDaPosicao({ categoria_manejo_id: "apagada", categoria: "VACA + 36 MESES", sexo: "Fêmea" }, porId)).toEqual({ sexo: "FEMEA", faixa: "Maior que 36 meses", cabecas: 0 });
    expect(chaveDaPosicao({ categoria: "Garrote 13 a 24 meses" }, porId).faixa).toBe("13 a 24 meses");
  });

  it("par de idade fora da lista (registro antigo) → a faixa que contém a idade mínima", () => {
    const antigas = mapaDeCategorias([{ id: "x", sexo: "Macho", idade_minima_meses: 10, idade_maxima_meses: 20 }, { id: "y", sexo: "Macho", idade_minima_meses: null, idade_maxima_meses: 12 }]);
    expect(chaveDaPosicao({ categoria_manejo_id: "x" }, antigas).faixa).toBe("9 a 12 meses");
    expect(chaveDaPosicao({ categoria_manejo_id: "y" }, antigas).faixa).toBe("0 a 8 meses");
  });

  it('sexo "Misto" do lote não é sexo; sem nada conhecido fica null', () => {
    expect(chaveDaPosicao({ sexo: "Misto", categoria: "TESTE" }, porId)).toEqual({ sexo: null, faixa: null, cabecas: 0 });
    expect(chaveDaPosicao(null, porId)).toEqual({ sexo: null, faixa: null, cabecas: 0 });
  });
});

describe("ICL-D — cascata do marcador do mapa", () => {
  it("nível 1: uma única combinação → o animal dela, na cor do sexo", () => {
    for (const s of SEXOS) {
      for (const f of FAIXAS) {
        const r = resolver([pos(s, f, 7), pos(s, f, 3)]);
        expect(r.nivel).toBe(1);
        expect(r.cor).toBe(s === "FEMEA" ? COR_FEMEA : COR_MACHO);
        expect(r.animais.map((a) => a.figura)).toEqual([figuraDe(s, f)]);
        expect(r.cabecas).toBe(10);
      }
    }
  });

  it("nível 2: mesmo sexo em várias faixas → UM animal, o de mais cabeças (exemplo do proprietário)", () => {
    const r = resolver([pos("MACHO", "9 a 12 meses", 40), pos("MACHO", "13 a 24 meses", 210), pos("MACHO", "25 a 36 meses", 95)]);
    expect(r).toMatchObject({ nivel: 2, cor: COR_MACHO, cabecas: 345, misto: null });
    expect(r.animais.map((a) => a.figura)).toEqual(["macho-13-24"]);
  });

  it("nível 2: empate de cabeças → a faixa mais velha; posições da mesma faixa somam", () => {
    expect(resolver([pos("FEMEA", "0 a 8 meses", 50), pos("FEMEA", "25 a 36 meses", 50)]).animais[0].figura).toBe("femea-25-36");
    expect(resolver([pos("FEMEA", "0 a 8 meses", 30), pos("FEMEA", "0 a 8 meses", 30), pos("FEMEA", "Maior que 36 meses", 50)]).animais[0].figura).toBe("femea-0-8");
  });

  it("nível 3: sexos cruzados com misto declarado → o misto, em COR_MISTO; menor prioridade ganha", () => {
    const base = [pos("MACHO", "Maior que 36 meses", 10), pos("FEMEA", "Maior que 36 meses", 10)];
    expect(resolver([...base, pos("MACHO", "0 a 8 meses", 4)])).toMatchObject({ nivel: 3, misto: "misto1", cor: COR_MISTO, rotulo: "misto1" });
    expect(resolver(base)).toMatchObject({ nivel: 3, misto: "misto2", cor: COR_MISTO });
    expect(resolver([pos("FEMEA", "Maior que 36 meses", 9), pos("MACHO", "0 a 8 meses", 9)]).misto).toBe("misto4");
  });

  it("nível 3: regra MINIMA — o pasto pode ter outras combinações junto", () => {
    const r = resolver([pos("MACHO", "Maior que 36 meses", 10), pos("MACHO", "0 a 8 meses", 10), pos("FEMEA", "13 a 24 meses", 300)]);
    expect(r).toMatchObject({ nivel: 3, misto: "misto3" });
    const todos = resolver([...SEXOS.flatMap((s) => FAIXAS.map((f) => pos(s, f, 1)))]);
    expect(todos.misto).toBe("misto1");
  });

  it("nível 3 só com sexos cruzados: machos 37+ e 0–8 sozinhos são nível 2", () => {
    const r = resolver([pos("MACHO", "Maior que 36 meses", 10), pos("MACHO", "0 a 8 meses", 20)]);
    expect(r).toMatchObject({ nivel: 2, misto: null });
    expect(r.animais[0].figura).toBe("macho-0-8");
  });

  it("nível 4: sexos cruzados sem misto → o predominante de cada sexo, o mais velho atrás, em COR_MISTO", () => {
    const r = resolver([pos("MACHO", "13 a 24 meses", 210), pos("MACHO", "25 a 36 meses", 95), pos("FEMEA", "0 a 8 meses", 20), pos("FEMEA", "Maior que 36 meses", 19)]);
    expect(r).toMatchObject({ nivel: 4, cor: COR_MISTO, misto: null, cabecas: 344 });
    expect(r.animais.map((a) => a.figura)).toEqual(["macho-13-24", "femea-0-8"]);
    // empate de faixa: o macho fica atrás
    expect(resolver([pos("FEMEA", "25 a 36 meses", 5), pos("MACHO", "25 a 36 meses", 5)]).animais.map((a) => a.figura)).toEqual(["macho-25-36", "femea-25-36"]);
  });

  it("nível 4: no máximo 2 animais, na mesma linha de chão, o mais velho maior", () => {
    for (const fm of FAIXAS) {
      for (const ff of FAIXAS) {
        const r = resolver([pos("MACHO", fm, 10), pos("FEMEA", ff, 10)]);
        if (r.nivel === 3) continue; // combinações que têm misto declarado
        expect(r.nivel).toBe(4);
        const desenhos = desenhosDoMarcador(r);
        expect(desenhos).toHaveLength(2);
        const [fundo, frente] = desenhos;
        const base = (d) => d.y + d.svg.altura * d.escala;
        expect(base(fundo)).toBeCloseTo(LINHA_DE_CHAO, 6);
        expect(base(frente)).toBeCloseTo(LINHA_DE_CHAO, 6);
        const largura = (d) => d.svg.largura * d.escala;
        const [tFundo, tFrente] = r.animais.map((a) => TAMANHO_POR_FAIXA[a.faixa]);
        expect(largura(fundo) / largura(frente)).toBeCloseTo(tFundo / tFrente, 6);
        expect(tFundo).toBeGreaterThanOrEqual(tFrente);
      }
    }
  });

  it("nível 5: sexo desconhecido → o predominante geral por cabeças, em COR_MISTO", () => {
    const r = resolver([pos("FEMEA", "13 a 24 meses", 80), { sexo: "Misto", categoria: "LOTE DE TESTE", quantidade_cabecas: 500 }, pos("FEMEA", "0 a 8 meses", 10)]);
    expect(r).toMatchObject({ nivel: 5, cor: COR_MISTO });
    expect(r.animais[0].figura).toBe("femea-13-24");
  });

  it("nível 5: sexo conhecido sem nenhuma faixa → o adulto desse sexo; sem nada → FIGURA_ULTIMO_RECURSO", () => {
    expect(resolver([{ sexo: "Fêmea", quantidade_cabecas: 3 }]).animais[0]).toMatchObject({ sexo: "FEMEA", faixa: FAIXA_SEM_IDADE });
    for (const vazio of [[], null, undefined, [null], [{}], [{ sexo: "Misto" }]]) {
      const r = resolverFiguraDoPasto(/** @type {any} */ (vazio), CATEGORIAS);
      expect(r).toMatchObject({ nivel: 5, cor: COR_MISTO });
      expect(r.animais.map((a) => a.figura)).toEqual([FIGURA_ULTIMO_RECURSO]);
    }
    // dois sexos, mas um deles sem faixa: não dá para compor → nível 5
    expect(resolver([pos("MACHO", "13 a 24 meses", 10), { sexo: "Fêmea", quantidade_cabecas: 50 }]).nivel).toBe(5);
  });

  it("posição sem cabeça não conta quando há outras com cabeça", () => {
    expect(resolver([pos("MACHO", "13 a 24 meses", 10), pos("FEMEA", "0 a 8 meses", 0)])).toMatchObject({ nivel: 1, cor: COR_MACHO });
  });
});

describe("ICL-E — INVARIANTE: sempre sai uma figura", () => {
  /** Gerador determinístico (sem Math.random, para o teste ser reprodutível). */
  const gerador = (semente) => () => {
    semente = (semente * 1103515245 + 12345) % 2147483648;
    return semente / 2147483648;
  };
  const lixo = [null, undefined, {}, { sexo: "Misto" }, { categoria: "???" }, { categoria_manejo_id: "nao-existe", quantidade_cabecas: -5 }, { quantidade_cabecas: "abc" }];

  it("5.000 pastos aleatórios (com lixo no meio): nível 1–5, figura existente e SVG com desenho", () => {
    const r = gerador(42);
    const niveis = new Set();
    for (let i = 0; i < 5000; i += 1) {
      const n = Math.floor(r() * 6);
      const posicoes = Array.from({ length: n }, () => {
        const sorteio = r();
        if (sorteio < 0.1) return lixo[Math.floor(r() * lixo.length)];
        if (sorteio < 0.2) return { categoria: ["Bezerro 0 a 12 meses", "Vaca + 36 meses", "Novilha 13 a 24 meses"][Math.floor(r() * 3)], quantidade_cabecas: Math.floor(r() * 50) };
        return pos(SEXOS[Math.floor(r() * 2)], FAIXAS[Math.floor(r() * 5)], Math.floor(r() * 100));
      });
      const icone = resolverFiguraDoPasto(posicoes, i % 7 === 0 ? null : CATEGORIAS);
      niveis.add(icone.nivel);
      expect(icone).toBeTruthy();
      expect([1, 2, 3, 4, 5]).toContain(icone.nivel);
      expect(icone.animais.length).toBeGreaterThanOrEqual(1);
      expect(icone.animais.length).toBeLessThanOrEqual(3);
      for (const a of icone.animais) expect(FIGURAS_ANIMAIS).toContain(a.figura);
      if (icone.misto) expect(FIGURAS_MISTOS).toContain(icone.misto);
      const desenhos = desenhosDoMarcador(icone);
      expect(desenhos.length).toBeGreaterThanOrEqual(1);
      expect(desenhos.length).toBeLessThanOrEqual(2);
    }
    expect([...niveis].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("o SVG e a URL do marcador nunca saem vazios; a URL é data: base64 do SVG", () => {
    const icone = resolver([pos("FEMEA", "9 a 12 meses", 3)]);
    const svg = svgMarcadorLote(icone);
    expect(svg).toContain(`data-icone-lote="${icone.chave}"`);
    expect(xml(svg).querySelectorAll("g[data-desenho] path").length).toBeGreaterThan(0);
    const url = urlMarcadorLote(icone);
    expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(atob(url.slice("data:image/svg+xml;base64,".length))).toBe(svg);
    expect(urlMarcadorLote({ ...icone })).toBe(url);
  });
});

describe("ICL-F — geometria do marcador: contagem livre, tamanho por faixa, borda igual", () => {
  const unicos = [
    ...SEXOS.flatMap((s) => FAIXAS.map((f) => resolver([pos(s, f, 1)]))),
    resolver([pos("MACHO", "Maior que 36 meses", 1), pos("FEMEA", "Maior que 36 meses", 1), pos("MACHO", "0 a 8 meses", 1)]),
    resolver([pos("MACHO", "Maior que 36 meses", 1), pos("FEMEA", "Maior que 36 meses", 1)]),
    resolver([pos("MACHO", "Maior que 36 meses", 1), pos("MACHO", "0 a 8 meses", 1), pos("FEMEA", "9 a 12 meses", 1)]),
    resolver([pos("FEMEA", "Maior que 36 meses", 1), pos("MACHO", "0 a 8 meses", 1)]),
  ];
  const compostos = SEXOS.length && FAIXAS.flatMap((fm) => FAIXAS.map((ff) => resolver([pos("MACHO", fm, 1), pos("FEMEA", ff, 1)]))).filter((r) => r.nivel === 4);

  it("os 14 ícones de desenho único: 10 animais e os 4 mistos", () => {
    expect(unicos.filter((r) => r.nivel === 1)).toHaveLength(10);
    expect(unicos.filter((r) => r.nivel === 3).map((r) => r.misto)).toEqual(["misto1", "misto2", "misto3", "misto4"]);
    expect(compostos.length).toBeGreaterThan(0);
  });

  it("nenhum animal (nem a borda branca dele) invade os 34% de baixo do card, da contagem", () => {
    const meia = (borda) => (borda / 100) * 1000 / 2;
    for (const icone of [...unicos, ...compostos]) {
      for (const d of desenhosDoMarcador(icone)) {
        const borda = d.comVaca && d.svg.paths.some((p) => p.vaca) ? BORDA_VACA_MISTO : BORDA_PADRAO;
        expect(d.y + d.svg.altura * d.escala + meia(borda), icone.chave).toBeLessThanOrEqual(LIMITE_ANIMAIS + 1e-9);
        expect(d.y, icone.chave).toBeGreaterThanOrEqual(0);
        expect(d.x, icone.chave).toBeGreaterThanOrEqual(0);
        expect(d.x + d.svg.largura * d.escala, icone.chave).toBeLessThanOrEqual(1000);
      }
    }
    expect(LIMITE_ANIMAIS).toBeCloseTo(961.94 * 0.8851 * 0.66, 6);
  });

  it("a contagem fica no meio da faixa reservada (abaixo dos animais, dentro do card)", () => {
    expect(CONTAGEM_TOPO_PCT).toBeCloseTo(((0.66 + 1) / 2) * 0.8851 * 100, 2);
    expect((CONTAGEM_TOPO_PCT / 100) * 961.94).toBeGreaterThan(LIMITE_ANIMAIS);
    expect((CONTAGEM_TOPO_PCT / 100) * 961.94).toBeLessThan(961.94 * 0.8851);
  });

  it("tamanho cresce com a faixa: 70 / 78 / 86 / 94 / 100 % da largura útil; misto 100 %", () => {
    const util = larguraUtilDoCard();
    for (const icone of unicos) {
      const [d] = desenhosDoMarcador(icone);
      const esperado = icone.nivel === 3 ? TAMANHO_MISTO : TAMANHO_POR_FAIXA[icone.animais[0].faixa];
      expect((d.svg.largura * d.escala) / util, icone.chave).toBeCloseTo(esperado, 9);
      // centralizado na horizontal e apoiado na linha de chão
      expect(d.x + (d.svg.largura * d.escala) / 2).toBeCloseTo(500, 6);
      expect(d.y + d.svg.altura * d.escala).toBeCloseTo(LINHA_DE_CHAO, 6);
    }
  });

  it("borda uniforme NA TELA: traço × escala do desenho é o mesmo nos 14 ícones; vaca no misto com 5", () => {
    const naTela = (g, p) => Number(p.getAttribute("stroke-width")) * escalaDe(g);
    for (const icone of [...unicos, ...compostos]) {
      const doc = xml(svgMarcadorLote(icone));
      const grupos = [...doc.querySelectorAll("g[data-desenho]")];
      const varios = icone.nivel === 3 || icone.nivel === 4;
      for (const g of grupos) {
        for (const p of g.querySelectorAll("path")) {
          const vaca = p.getAttribute("data-vaca") === "1";
          const esperado = (varios && vaca ? BORDA_VACA_MISTO : BORDA_PADRAO) * 10; // % da largura 1000
          expect(naTela(g, p), `${icone.chave} ${g.getAttribute("data-desenho")}`).toBeCloseTo(esperado, 2);
        }
      }
    }
    // a fêmea "Maior que 36" sozinha usa a borda padrão, apesar de marcada como vaca
    const vaca = xml(svgMarcadorLote(resolver([pos("FEMEA", "Maior que 36 meses", 1)])));
    const g = vaca.querySelector("g[data-desenho]");
    for (const p of g.querySelectorAll('path[data-vaca="1"]')) expect(naTela(g, p)).toBeCloseTo(BORDA_PADRAO * 10, 2);
  });

  it("a cor do ícone vai no desenho, nunca o currentColor do arquivo", () => {
    for (const icone of [...unicos, ...compostos]) {
      const svg = svgMarcadorLote(icone);
      expect(svg).not.toContain("currentColor");
      expect(svg).toContain(`fill="${icone.cor}"`);
    }
  });
});

describe("ICL-G — subícone dos detalhes: o animal da categoria, na cor do sexo, NUNCA misto", () => {
  it("as 10 figuras: svg certo, cor do sexo, sem vermelho", () => {
    for (const s of SEXOS) {
      for (const f of FAIXAS) {
        const figura = figuraDe(s, f);
        const svg = svgSubiconeLote(figura, 22);
        expect(svg).toContain(`data-figura="${figura}"`);
        expect(svg).toContain(`fill="${s === "FEMEA" ? COR_FEMEA : COR_MACHO}"`);
        expect(svg).not.toContain(COR_MISTO);
        expect(xml(svg).querySelectorAll("path")).toHaveLength(MEDIDAS[figura].paths);
      }
    }
  });

  it("figura da posição e do grupo: sempre um animal, nunca misto, mesmo em pasto misturado", () => {
    expect(figuraDaPosicao(pos("FEMEA", "13 a 24 meses", 4), CATEGORIAS)).toEqual({ sexo: "FEMEA", faixa: "13 a 24 meses", figura: "femea-13-24" });
    expect(figuraDaPosicao(pos("MACHO", "Maior que 36 meses", 4), CATEGORIAS).figura).toBe("macho-37-mais");
    expect(figuraDaPosicao({ sexo: "Misto", categoria: "X" }, CATEGORIAS)).toBeNull();
    const grupo = [pos("MACHO", "9 a 12 meses", 40), pos("MACHO", "13 a 24 meses", 210), pos("FEMEA", "Maior que 36 meses", 5)];
    expect(figuraDoGrupo(grupo, CATEGORIAS).figura).toBe("macho-13-24");
    expect(figuraDoGrupo([], CATEGORIAS)).toBeNull();
  });

  it("a borda do subícone tem a mesma grossura na tela em qualquer tamanho (a do mapa)", () => {
    const pxDoTraco = (tamanho) => {
      const svg = xml(svgSubiconeLote("macho-0-8", tamanho)).documentElement;
      const largura = Number(svg.getAttribute("viewBox").split(" ")[2]);
      return Number(svg.querySelector("g").getAttribute("stroke-width")) * (tamanho / largura);
    };
    const esperado = (BORDA_PADRAO / 100) * LARGURA_MARCADOR_PX;
    // números do SVG com 4 casas: a grossura na tela bate até a 4ª casa (≪ 1 px)
    for (const t of [22, 32, 36, 48]) expect(pxDoTraco(t), `${t}px`).toBeCloseTo(esperado, 4);
  });

  it("URL do subícone: data: base64, memorizada; figura inexistente → null", () => {
    const url = urlSubiconeLote("femea-25-36", 32);
    expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(urlSubiconeLote("femea-25-36", 32)).toBe(url);
    expect(urlSubiconeLote("misto1", 32)).toBeNull();
    expect(urlSubiconeLote(null, 32)).toBeNull();
    expect(svgSubiconeLote("nao-existe")).toBeNull();
  });
});
