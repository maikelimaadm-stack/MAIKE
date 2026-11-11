/**
 * Contagem da lista em palavras (D-PROD-163): "12 lotes", "5 de 12 lotes", "1 selecionado".
 * O nome vem da tela (`{ um, varios }`) ou, sem ele, da pesquisa da barra ("Buscar lotes…" → lote/lotes).
 */

/** @typedef {{ um: string, varios: string }} NomesDaContagem */

const PADRAO = Object.freeze({ um: "registro", varios: "registros" });

/** @param {string} p plural de uma palavra */
function singularDe(p) {
  if (/ns$/.test(p)) return p.replace(/ns$/, "m");
  if (/ões$/.test(p)) return p.replace(/ões$/, "ão");
  if (/ais$/.test(p)) return p.replace(/ais$/, "al");
  if (/éis$/.test(p)) return p.replace(/éis$/, "el");
  if (/(r|z)es$/.test(p)) return p.replace(/es$/, "");
  return p.replace(/s$/, "");
}

/** @param {string} s singular de uma palavra */
function pluralDe(s) {
  if (/ão$/.test(s)) return s.replace(/ão$/, "ões");
  if (/m$/.test(s)) return s.replace(/m$/, "ns");
  if (/al$/.test(s)) return s.replace(/al$/, "ais");
  if (/[rz]$/.test(s)) return `${s}es`;
  return `${s}s`;
}

/**
 * @param {string | undefined} placeholder texto da pesquisa da barra ("Buscar lotes…")
 * @param {Partial<NomesDaContagem> | undefined} [nomes] nomes informados pela tela (vencem)
 * @returns {NomesDaContagem}
 */
export function nomesDaContagem(placeholder, nomes) {
  if (nomes?.um && nomes?.varios) return { um: nomes.um, varios: nomes.varios };
  const m = String(placeholder || "").match(/^\s*(?:buscar|pesquisar)\s+([a-zà-ú][a-zà-ú\s]*?)\s*(?:…|\.\.\.)?\s*$/i);
  if (!m) return PADRAO;
  const [primeira, ...resto] = m[1].toLowerCase().split(/\s+/);
  const cauda = resto.length ? ` ${resto.join(" ")}` : "";
  if (/s$/.test(primeira)) return { um: `${singularDe(primeira)}${cauda}`, varios: `${primeira}${cauda}` };
  return { um: `${primeira}${cauda}`, varios: `${pluralDe(primeira)}${cauda}` };
}

/** @param {number} n */
const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");

/**
 * @param {{ mostrados: number, totais: number, nomes: NomesDaContagem }} p
 * @returns {string} "12 lotes" quando tudo aparece; "5 de 12 lotes" quando há filtro ou falta carregar
 */
export function textoDoTotal({ mostrados, totais, nomes }) {
  if (mostrados === totais) return `${fmt(totais)} ${totais === 1 ? nomes.um : nomes.varios}`;
  return `${fmt(mostrados)} de ${fmt(totais)} ${nomes.varios}`;
}

/** @param {number} n @returns {string} "" quando nada está marcado */
export function textoDaSelecao(n) {
  if (!n) return "";
  return `${fmt(n)} selecionado${n === 1 ? "" : "s"}`;
}
