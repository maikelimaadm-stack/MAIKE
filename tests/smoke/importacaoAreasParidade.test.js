/**
 * Paridade navegador × servidor da importação de áreas (D-PROD-90) e regra
 * compartilhada com o formulário manual.
 *
 * O servidor recalcula hectares e revalida o contorno; se as duas pontas
 * divergirem, a prévia mostraria um número e o cadastro gravaria outro.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

import { lerArquivoDeAreas } from "@/lib/geografia/importacaoAreas";
import { toPersistedCoords, anelSeAutoIntersecta } from "@/lib/geografia";
import { pendenciasDaArea, lerHectares } from "@/domain/areas/regrasCadastroArea";
import {
  validarAnel,
  anelSeAutoIntersecta as anelSeAutoIntersectaServidor,
  chaveCanonicaDoContorno,
} from "../../backend/src/modules/areas/areaImportacaoGeometria.js";

const fixture = (nome) => readFileSync(resolve(process.cwd(), "tests/smoke/fixtures/importacaoAreas", nome), "utf8");

describe("paridade de geometria", () => {
  it("hectares do navegador = hectares do servidor para cada área das fixtures", () => {
    for (const [nome, arquivo] of [["fazenda.kml", "fazenda-google-earth.kml"], ["t.geojson", "talhoes.geojson"], ["p.json", "pasto-unico.json"]]) {
      const r = lerArquivoDeAreas({ nomeArquivo: nome, texto: fixture(arquivo) });
      for (const item of r.itens.filter((i) => i.situacao === "area")) {
        const servidor = validarAnel(toPersistedCoords(item.vertices));
        expect(servidor.ok).toBe(true);
        expect(servidor.hectares).toBeCloseTo(item.hectares, 9);
      }
    }
  });

  it("autointerseção: mesma resposta nas duas pontas", () => {
    const casos = [
      [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 0 }, { lat: 1, lng: 1 }],
      [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }, { lat: 1, lng: 0 }],
      [{ lat: 0, lng: 0 }, { lat: 0, lng: 2 }, { lat: 1, lng: 1 }, { lat: 2, lng: 2 }, { lat: 2, lng: 0 }, { lat: 1, lng: 1 }],
    ];
    for (const anel of casos) {
      expect(anelSeAutoIntersecta(anel)).toBe(
        anelSeAutoIntersectaServidor(anel) || new Set(anel.map((v) => `${v.lat},${v.lng}`)).size !== anel.length
      );
    }
  });

  it("chave canônica: mesmo contorno em outro sentido/início dá a mesma chave", () => {
    const a = [[0, 0], [0, 1], [1, 1], [1, 0]];
    const b = [[1, 1], [0, 1], [0, 0], [1, 0], [1, 1]];
    expect(chaveCanonicaDoContorno(a)).toBe(chaveCanonicaDoContorno(b));
    expect(chaveCanonicaDoContorno(a)).not.toBe(chaveCanonicaDoContorno([[0, 0], [0, 1], [1, 1], [1, 0.5]]));
    expect(chaveCanonicaDoContorno([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }, { lat: 1, lng: 0 }])).toBe(
      chaveCanonicaDoContorno(a)
    );
  });
});

describe("regra compartilhada (formulário manual e importação)", () => {
  it("0 é valor informado; vazio é pendência", () => {
    expect(lerHectares("0")).toBe(0);
    expect(lerHectares("")).toBeNull();
    expect(lerHectares("1.234,5")).toBe(1234.5);
    expect(lerHectares("12.5")).toBe(12.5);
    expect(Number.isNaN(lerHectares("abc"))).toBe(true);
  });

  it("Pastagem exige cultura e pastejada; Reserva aceita 0 sem cultura; Infraestrutura exige o tipo", () => {
    const base = { nome: "A", setor_id: "s1", total_ha: 10 };
    expect(pendenciasDaArea({ ...base, tipo_cultura: "Pastagem" }).map((p) => p.campo)).toEqual(["tipo_pastagem", "area_pastejada"]);
    expect(pendenciasDaArea({ ...base, tipo_cultura: "Reserva", area_pastejada: "0" })).toEqual([]);
    expect(pendenciasDaArea({ ...base, tipo_cultura: "APP", area_pastejada: "" }).map((p) => p.campo)).toEqual(["area_pastejada"]);
    expect(pendenciasDaArea({ ...base, tipo_cultura: "Infraestrutura" }).map((p) => p.campo)).toEqual(["tipo_infraestrutura"]);
    expect(pendenciasDaArea({ ...base, tipo_cultura: "Infraestrutura", tipo_pastagem: "Curral" })).toEqual([]);
    expect(pendenciasDaArea({ ...base, tipo_cultura: "Pastagem", tipo_pastagem: "Marandu", area_pastejada: "10,004" })).toEqual([]);
    expect(pendenciasDaArea({ ...base, tipo_cultura: "Pastagem", tipo_pastagem: "Marandu", area_pastejada: "10,2" })[0].mensagem).toMatch(
      /maior que a área total/
    );
    expect(pendenciasDaArea({ tipo_cultura: "" }).map((p) => p.campo)).toEqual(["nome", "setor_id", "tipo_cultura"]);
  });
});

describe("R1 — paridade de regras de campo: navegador × servidor, caso a caso", () => {
  it("mesmas pendências (por campo) em toda a matriz de uso × cultura × pastejada × nome × sigla × setor", async () => {
    const { pendenciasDeCampos, TIPOS_USO: USO_S, TIPOS_CULTURA: CULT_S, TIPOS_INFRAESTRUTURA: INFRA_S, MAX_NOME: NOME_S, MAX_SIGLA: SIGLA_S } =
      await import("../../backend/src/modules/areas/areaImportacaoRegras.js");
    const regras = await import("@/domain/areas/regrasCadastroArea");
    // Listas e limites idênticos.
    expect([...USO_S]).toEqual([...regras.TIPOS_USO]);
    expect([...CULT_S]).toEqual([...regras.TIPOS_CULTURAS]);
    expect([...INFRA_S]).toEqual([...regras.TIPOS_INFRAESTRUTURA]);
    expect([NOME_S, SIGLA_S]).toEqual([regras.MAX_NOME, regras.MAX_SIGLA]);

    const total = 10;
    let casos = 0;
    for (const nome of ["", "  ", "Pasto A", "x".repeat(256)]) {
      for (const sigla of ["", "AB", "X".repeat(11)]) {
        for (const setor of ["", "s1"]) {
          for (const uso of ["", "Pastagem", "Agricultura", "Reserva", "APP", "Infraestrutura", "Lazer"]) {
            for (const tipo of ["", "Marandu", "Curral", "Banana"]) {
              const pastejadas = uso === "Infraestrutura" ? [null] : [null, 0, 5, 10.004, 10.2, -1];
              for (const pastejada of pastejadas) {
                casos += 1;
                const servidor = pendenciasDeCampos(
                  { nome, sigla, setor_id: setor, tipo_cultura: uso, tipo_pastagem: tipo, area_pastejada: pastejada },
                  total
                ).pendencias.map((p) => p.campo);
                const navegador = regras
                  .pendenciasDaArea({
                    nome,
                    sigla,
                    setor_id: setor,
                    tipo_cultura: uso,
                    tipo_pastagem: tipo,
                    area_pastejada: pastejada === null ? "" : String(pastejada),
                    total_ha: total,
                  })
                  .map((p) => (p.campo === "tipo_infraestrutura" ? "tipo_pastagem" : p.campo));
                const chave = JSON.stringify({ nome: nome.length, sigla, setor, uso, tipo, pastejada });
                expect([...new Set(navegador)].sort(), chave).toEqual([...new Set(servidor)].sort());
              }
            }
          }
        }
      }
    }
    expect(casos).toBeGreaterThan(1500);
  });

  it("hectares arredondados a 2 casas: 10,004 cabe em 10; 10,006 não (tolerância 0,005 nas duas pontas)", async () => {
    const { pendenciasDeCampos } = await import("../../backend/src/modules/areas/areaImportacaoRegras.js");
    const base = { nome: "A", setor_id: "s1", tipo_cultura: "Pastagem", tipo_pastagem: "Marandu" };
    for (const [valor, ok] of [[10.004, true], [10.006, false]]) {
      const srv = pendenciasDeCampos({ ...base, area_pastejada: valor }, 10).pendencias;
      const nav = pendenciasDaArea({ ...base, area_pastejada: String(valor), total_ha: 10 });
      expect(srv.length === 0).toBe(ok);
      expect(nav.length === 0).toBe(ok);
    }
  });
});
