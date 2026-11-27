import { unzipSync, strFromU8 } from "fflate";
import { LIMITES_ARQUIVO } from "./importacaoAreas.js";

/**
 * D-PROD-367 — KMZ (o KML compactado que o Google Earth e o AgriWebb exportam). O KMZ é um ZIP com um `.kml` dentro
 * (normalmente `doc.kml`); a importação lê esse KML como já lia o `.kml` solto. Tudo no aparelho, sem servidor.
 *
 * Proteções: só arquivos `.kml` são abertos (imagens e ícones do KMZ ficam de fora) e o KML aberto não pode passar do
 * limite de tamanho da importação (um ZIP pequeno pode esconder um arquivo enorme).
 *
 * @param {Uint8Array} bytes
 * @returns {{ ok: true, nomeKml: string, texto: string } | { ok: false, erro: string }}
 */
export function kmlDoKmz(bytes) {
  let pastas;
  try {
    pastas = unzipSync(bytes, {
      filter: (f) => /\.kml$/i.test(f.name) && !f.name.startsWith("__MACOSX/") && f.originalSize <= LIMITES_ARQUIVO.maxBytes,
    });
  } catch {
    return { ok: false, erro: "Não foi possível abrir o KMZ (arquivo compactado danificado)." };
  }
  const nomes = Object.keys(pastas);
  if (!nomes.length) return { ok: false, erro: "O KMZ não tem um arquivo .kml dentro (ou o .kml passa do tamanho máximo)." };
  // O KML principal: `doc.kml` na raiz; senão, o da raiz; senão, o primeiro.
  const raiz = nomes.filter((n) => !n.includes("/"));
  const nomeKml = nomes.find((n) => /^doc\.kml$/i.test(n)) || raiz[0] || nomes[0];
  const conteudo = pastas[nomeKml];
  if (conteudo.length > LIMITES_ARQUIVO.maxBytes) return { ok: false, erro: "O KML dentro do KMZ passa do tamanho máximo. Divida o arquivo." };
  return { ok: true, nomeKml, texto: strFromU8(conteudo) };
}

/** @param {string|null|undefined} nome */
export const eKmz = (nome) => /\.kmz$/i.test(String(nome || ""));
