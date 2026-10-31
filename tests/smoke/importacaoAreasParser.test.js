/**
 * Leitura de KML/GeoJSON para importação de áreas (D-PROD-90) — regra pura.
 * Fixtures sintéticas em tests/smoke/fixtures/importacaoAreas.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

import { lerArquivoDeAreas, detectarFormato, normalizarAnel, LIMITES_ARQUIVO } from "@/lib/geografia/importacaoAreas";
import { areaHectares, toPersistedCoords, anelSeAutoIntersecta } from "@/lib/geografia";
import { itemDeEnvio } from "@/services/areaImportacaoService";

const fixture = (nome) =>
  readFileSync(resolve(process.cwd(), "tests/smoke/fixtures/importacaoAreas", nome), "utf8");

const ler = (nomeArquivo, texto) => lerArquivoDeAreas({ nomeArquivo, texto });

/** Área plana em Web Mercator — o cálculo do importador antigo, só para comparação. */
const hectaresMercator = (vertices) => {
  const R = 6378137;
  const pts = vertices.map(({ lat, lng }) => [
    R * ((lng * Math.PI) / 180),
    R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2)),
  ]);
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(a) / 2 / 10000;
};

describe("KML (Google Earth)", () => {
  const r = ler("fazenda-google-earth.kml", fixture("fazenda-google-earth.kml"));

  it("lê namespace, Placemark/name, altitude opcional e anel fechado", () => {
    expect(r.ok).toBe(true);
    expect(r.formato).toBe("kml");
    expect(r.contagem).toEqual({ elementos: 7, areas: 3, ignorados: 2, invalidos: 2 });
    const sede = r.itens[0];
    expect(sede.situacao).toBe("area");
    expect(sede.nomeNoArquivo).toBe("Pasto Sede");
    // KML é lng,lat; o item fica {lat, lng}, anel aberto (fechamento removido).
    expect(sede.vertices).toEqual([
      { lat: -15.6, lng: -56.1 },
      { lat: -15.6, lng: -56.091 },
      { lat: -15.609, lng: -56.091 },
      { lat: -15.609, lng: -56.1 },
    ]);
    expect(toPersistedCoords(sede.vertices)).toEqual([
      [-15.6, -56.1],
      [-15.6, -56.091],
      [-15.609, -56.091],
      [-15.609, -56.1],
    ]);
  });

  it("anel sem fechamento explícito também é lido; Placemark sem nome fica com nome vazio", () => {
    expect(r.itens[1].situacao).toBe("area");
    expect(r.itens[1].vertices).toHaveLength(4);
    expect(r.itens[2].situacao).toBe("area");
    expect(r.itens[2].nomeNoArquivo).toBe("");
  });

  it("ponto e linha: ignorados, nunca viram área", () => {
    expect(r.itens[3]).toMatchObject({ situacao: "ignorado", nomeNoArquivo: "Curral" });
    expect(r.itens[4]).toMatchObject({ situacao: "ignorado", nomeNoArquivo: "Estrada" });
  });

  it("buraco interno e MultiGeometry com 2 polígonos: inválidos com causa, sem usar só o primeiro anel", () => {
    expect(r.itens[5]).toMatchObject({ situacao: "invalido" });
    expect(r.itens[5].motivo).toMatch(/buraco/);
    expect(r.itens[5].vertices).toBeUndefined();
    expect(r.itens[6]).toMatchObject({ situacao: "invalido" });
    expect(r.itens[6].motivo).toMatch(/MultiGeometry com 2 polígonos/);
  });

  it("recusa DOCTYPE/ENTITY, XML malformado e raiz que não é <kml>", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY x SYSTEM "file:///etc/passwd">]><kml><Placemark><name>&x;</name></Placemark></kml>`;
    expect(ler("a.kml", xxe)).toMatchObject({ ok: false, erro: expect.stringMatching(/DOCTYPE/) });
    expect(ler("a.kml", "<kml><Placemark>")).toMatchObject({ ok: false, erro: expect.stringMatching(/malformado/) });
    expect(ler("a.kml", "<svg></svg>")).toMatchObject({ ok: false, erro: expect.stringMatching(/raiz <kml>/) });
  });

  it("NetworkLink remoto não é seguido, só avisado", () => {
    const kml = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><NetworkLink><Link><href>https://exemplo.invalid/x.kml</href></Link></NetworkLink>
      <Placemark><name>A</name><Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 0.01,0 0.01,0.01 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
    const lido = ler("a.kml", kml);
    expect(lido.ok).toBe(true);
    expect(lido.avisosDoArquivo[0]).toMatch(/NetworkLink/);
  });

  it("coordenada malformada invalida o contorno inteiro (não descarta vértice em silêncio)", () => {
    const kml = `<kml><Placemark><name>A</name><Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 abc,1 0.01,0.01 0,0.01</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>`;
    const lido = ler("a.kml", kml);
    expect(lido.itens[0].situacao).toBe("invalido");
  });
});

describe("GeoJSON (.geojson e .json)", () => {
  it(".geojson FeatureCollection: propriedades PT/EN, MultiPolygon de 1 parte sem perda, ponto ignorado, 2 partes inválido", () => {
    const r = ler("talhoes.geojson", fixture("talhoes.geojson"));
    expect(r.ok).toBe(true);
    expect(r.contagem).toEqual({ elementos: 4, areas: 2, ignorados: 1, invalidos: 1 });
    expect(r.itens[0]).toMatchObject({ nomeNoArquivo: "Talhão A", siglaNoArquivo: "TA", situacao: "area" });
    expect(r.itens[1]).toMatchObject({ nomeNoArquivo: "Reserva Legal", situacao: "area" });
    expect(r.itens[1].avisos.join(" ")).toMatch(/uma única parte/);
    expect(r.itens[2].situacao).toBe("ignorado");
    expect(r.itens[3].motivo).toMatch(/2 partes/);
  });

  it("área informada no arquivo diferente da calculada: aviso, o cálculo prevalece", () => {
    const r = ler("talhoes.geojson", fixture("talhoes.geojson"));
    expect(r.itens[0].avisos.join(" ")).toMatch(/informa 50,00 ha.*vale o cálculo/);
    expect(r.itens[0].hectares).toBeGreaterThan(90);
  });

  it(".json com Feature único; lat/lng = 0 são válidos; descrição não vira nome", () => {
    const r = ler("pasto-unico.json", fixture("pasto-unico.json"));
    expect(r.ok).toBe(true);
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0].nomeNoArquivo).toBe("Pasto do Rio");
    expect(r.itens[0].vertices[0]).toEqual({ lat: 0, lng: 0 });
    expect(r.itens[0].vertices[1]).toEqual({ lat: 0, lng: 0.01 });
  });

  it(".json que não é GeoJSON é recusado; JSON inválido é recusado", () => {
    expect(ler("configuracao-qualquer.json", fixture("configuracao-qualquer.json"))).toMatchObject({
      ok: false,
      erro: expect.stringMatching(/não é GeoJSON/),
    });
    expect(ler("x.json", "{ quebrado")).toMatchObject({ ok: false, erro: expect.stringMatching(/JSON inválido/) });
  });

  it("CRS diferente de WGS84 é recusado; coordenada projetada (UTM) vira inválida com causa", () => {
    const utm = {
      type: "FeatureCollection",
      crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::31981" } },
      features: [],
    };
    expect(ler("a.geojson", JSON.stringify(utm))).toMatchObject({ ok: false, erro: expect.stringMatching(/CRS/) });
    const semCrs = {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [[[500000, 8270000], [501000, 8270000], [501000, 8271000], [500000, 8270000]]] },
    };
    const r = ler("a.geojson", JSON.stringify(semCrs));
    expect(r.itens[0].situacao).toBe("invalido");
    expect(r.itens[0].motivo).toMatch(/outra projeção/);
  });

  it("buraco interno em Polygon GeoJSON é inválido; sem polígono algum, contagem de áreas = 0", () => {
    const comBuraco = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
          [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.2]],
        ],
      },
    };
    expect(ler("a.geojson", JSON.stringify(comBuraco)).itens[0].motivo).toMatch(/buraco/);
    const soPontos = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } }] };
    expect(ler("a.geojson", JSON.stringify(soPontos)).contagem.areas).toBe(0);
  });
});

describe("formato, limites e geometria", () => {
  it("extensão e conteúdo contraditórios são recusados; KMZ explica o que fazer", () => {
    expect(detectarFormato("a.kml", "{}")).toEqual({ erro: expect.stringMatching(/não é XML/) });
    expect(detectarFormato("a.json", "<kml/>")).toEqual({ erro: expect.stringMatching(/não é JSON/) });
    expect(detectarFormato("a.kmz", "PK")).toEqual({ erro: expect.stringMatching(/KMZ/) });
    expect(detectarFormato("a.shp", "x")).toEqual({ erro: expect.stringMatching(/não aceito/) });
    expect(detectarFormato(null, "<kml/>")).toEqual({ formato: "kml" });
  });

  it("BOM e espaços no início são tolerados", () => {
    const r = ler("a.json", `﻿  ${fixture("pasto-unico.json")}`);
    expect(r.ok).toBe(true);
  });

  it("arquivo acima do limite é recusado antes de ler", () => {
    const r = lerArquivoDeAreas({ nomeArquivo: "a.kml", texto: "<kml/>", tamanhoBytes: LIMITES_ARQUIVO.maxBytes + 1 });
    expect(r).toMatchObject({ ok: false, erro: expect.stringMatching(/maior que/) });
  });

  it("autointerseção, degenerado e fora de faixa são inválidos; repetição em sequência vira aviso", () => {
    const gravata = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 0 }, { lat: 1, lng: 1 }];
    expect(anelSeAutoIntersecta(gravata)).toBe(true);
    expect(normalizarAnel(gravata)).toMatchObject({ ok: false, motivo: expect.stringMatching(/cruza/) });
    expect(normalizarAnel([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 0, lng: 2 }])).toMatchObject({ ok: false });
    expect(normalizarAnel([{ lat: 91, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }])).toMatchObject({
      ok: false,
      motivo: expect.stringMatching(/WGS84/),
    });
    const repetido = normalizarAnel([{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }, { lat: 0, lng: 0.01 }, { lat: 0.01, lng: 0.01 }]);
    expect(repetido.ok).toBe(true);
    expect(repetido.vertices).toHaveLength(3);
    expect(repetido.avisos[0]).toMatch(/repetido/);
  });

  it("hectares geodésicos (Turf) vs. Web Mercator do importador antigo", () => {
    const r = ler("fazenda-google-earth.kml", fixture("fazenda-google-earth.kml"));
    const sede = r.itens[0];
    // ~0,009° x 0,009° a 15,6°S: ~963 m x ~1000 m ≈ 96 ha.
    expect(sede.hectares).toBeCloseTo(areaHectares(sede.vertices), 10);
    expect(sede.hectares).toBeGreaterThan(95);
    expect(sede.hectares).toBeLessThan(97.5);
    // Mercator infla a área com a latitude (~7,7 % a 15,6°S): o cálculo antigo erraria.
    const mercator = hectaresMercator(sede.vertices);
    expect(mercator / sede.hectares).toBeGreaterThan(1.07);
  });

  it("item de envio: [lat,lng], sem número/setor_nome/cliente, nome em maiúsculas, 0 preservado", () => {
    const r = ler("pasto-unico.json", fixture("pasto-unico.json"));
    const item = itemDeEnvio({
      ref: "f1",
      nome: " pasto  do rio ",
      sigla: "",
      setor_id: "s1",
      tipo_cultura: "Reserva",
      tipo_pastagem: "",
      tipo_infraestrutura: "",
      area_pastejada: "0",
      aproveitamento: "Média",
      cor: "#f8f9fa",
      vertices: r.itens[0].vertices,
    });
    expect(item).toEqual({
      ref: "f1",
      nome: "PASTO DO RIO",
      sigla: null,
      setor_id: "s1",
      tipo_cultura: "Reserva",
      tipo_pastagem: null,
      area_pastejada: 0,
      aproveitamento_classificacao: "Média",
      cor: "#f8f9fa",
      coords: [[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0]],
    });
    expect(Object.keys(item)).not.toContain("numero_area");
    expect(Object.keys(item)).not.toContain("setor_nome");
    expect(Object.keys(item)).not.toContain("cliente_id");
  });
});
