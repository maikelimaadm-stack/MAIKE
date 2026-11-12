/**
 * D-PROD-175 — as fontes voltam ao estilo e ao tamanho da prévia que o proprietário escolheu
 * (prévia `maike-funzkhxes`, commit 836344f): DM Sans e os tamanhos de antes da D-PROD-167, com o mapa
 * como era antes da D-PROD-173. Este teste segura a volta: outra fonte ou outra escala só entra com nova decisão.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { FONTE_CONTAGEM_PX } from "@/lib/maplibre/contagemLote.js";
import { loadCadastroBase1ColumnPrefs } from "@/lib/cadastroBase1ColumnPrefs";

const raiz = process.cwd();
const ler = (p) => readFileSync(join(raiz, p), "utf8");
const arquivos = (dir) =>
  readdirSync(join(raiz, dir)).flatMap((nome) => {
    const rel = `${dir}/${nome}`;
    return statSync(join(raiz, rel)).isDirectory() ? arquivos(rel) : [rel];
  });

describe("fontes da prévia escolhida (D-PROD-175)", () => {
  it("index.html carrega a DM Sans, sem Open Sans nem Lato", () => {
    const html = ler("index.html");
    expect(html).toMatch(/fonts\.googleapis\.com\/css2\?family=DM\+Sans/);
    expect(html).not.toMatch(/Open\+Sans|family=Lato/);
  });

  it("texto do sistema e do motor Base1 em DM Sans; sem a folha do padrão de tipografia", () => {
    expect(ler("src/index.css")).toMatch(/body \{\s*font-family: "DM Sans"/);
    expect(ler("src/styles/base1-tipografia.css")).toMatch(/font-family: "DM Sans"/);
    expect(ler("src/index.css")).not.toMatch(/tipografia-sistema\.css/);
    expect(existsSync(join(raiz, "src/styles/tipografia-sistema.css"))).toBe(false);
  });

  it("nenhuma tela pede Open Sans ou Lato", () => {
    const usos = arquivos("src")
      .filter((f) => /\.(jsx?|css)$/.test(f))
      .filter((f) => /Open Sans|"Lato"|'Lato'|Lato,/.test(ler(f)));
    expect(usos).toEqual([]);
  });

  it("escala do Tailwind é a padrão (text-xs 12px): o tailwind.config não troca os tamanhos", () => {
    expect(ler("tailwind.config.js")).not.toMatch(/fontSize/);
  });

  it("colunas das listas na largura que cada tela define (sem crescer com a fonte)", () => {
    const { columnWidths } = loadCadastroBase1ColumnPrefs("teste-d175-colunas", [{ id: "nome", width: 120 }, { id: "obs" }]);
    expect(columnWidths).toEqual({ nome: 120, obs: 160 });
  });

  it("mapa: número de cabeças no marcador como na prévia", () => {
    expect(FONTE_CONTAGEM_PX).toBe(9.5);
  });
});
