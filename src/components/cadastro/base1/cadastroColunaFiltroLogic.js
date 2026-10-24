/**
 * Lógica do filtro de coluna estilo Excel (referência CONTROLE-DE-ESTOQUE / FiltroDeColuna).
 * @typedef {'texto' | 'num' | 'data'} CadastroColunaFiltroTipo
 * @typedef {{ op: string; v1: string; v2: string; valores: Set<string> | null }} CadastroColunaFiltroAtivo
 */

const OPS = {
  num: [
    ["", "Sem condição"],
    ["ig", "É igual a"],
    ["dif", "É diferente de"],
    ["mai", "É maior do que"],
    ["maie", "É maior ou igual a"],
    ["men", "É menor do que"],
    ["mene", "É menor ou igual a"],
    ["entre", "Está entre"],
  ],
  data: [
    ["", "Sem condição"],
    ["ig", "É"],
    ["dif", "É diferente de"],
    ["men", "Antes de"],
    ["mai", "Depois de"],
    ["entre", "Está entre"],
  ],
  texto: [
    ["", "Sem condição"],
    ["ig", "É igual a"],
    ["dif", "É diferente de"],
    ["com", "Começa com"],
    ["ter", "Termina com"],
    ["cont", "Contém"],
    ["ncont", "Não contém"],
  ],
};

export function operadoresParaTipo(tipo) {
  return OPS[tipo] ?? OPS.texto;
}

const numDe = (v) => {
  if (!/[0-9]/.test(v)) return null;
  const n = Number(v.replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return v.trim() === "" || Number.isNaN(n) ? null : n;
};

const dataDe = (v) => {
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let a = Number(m[3]);
  if (a < 100) a += 2000;
  const mes = Number(m[2]);
  const dia = Number(m[1]);
  const data = new Date(a, mes - 1, dia);
  return data.getFullYear() === a && data.getMonth() === mes - 1 && data.getDate() === dia
    ? a * 10000 + mes * 100 + dia
    : null;
};

/** @param {CadastroColunaFiltroAtivo} f @param {CadastroColunaFiltroTipo} tipo @param {string} valor */
export function casaNoFiltroColuna(f, tipo, valor) {
  if (f.valores && !f.valores.has(valor)) return false;
  if (!f.op || f.v1.trim() === "" || (f.op === "entre" && f.v2.trim() === "")) return true;
  if (tipo === "texto") {
    const a = valor.toLowerCase();
    const b = f.v1.toLowerCase();
    if (f.op === "ig") return a === b;
    if (f.op === "dif") return a !== b;
    if (f.op === "com") return a.startsWith(b);
    if (f.op === "ter") return a.endsWith(b);
    if (f.op === "cont") return a.includes(b);
    return !a.includes(b);
  }
  const conv = tipo === "num" ? numDe : dataDe;
  const x = conv(valor);
  const a = conv(f.v1);
  const b = conv(f.v2);
  if (x === null || a === null) return false;
  switch (f.op) {
    case "ig":
      return x === a;
    case "dif":
      return x !== a;
    case "mai":
      return x > a;
    case "maie":
      return x >= a;
    case "men":
      return x < a;
    case "mene":
      return x <= a;
    case "entre":
      return b === null ? x >= a : x >= Math.min(a, b) && x <= Math.max(a, b);
    default:
      return true;
  }
}

/** @param {string} colId @param {{ filterKind?: CadastroColunaFiltroTipo }} [col] */
export function tipoFiltroDaColuna(colId, col) {
  if (col?.filterKind) return col.filterKind;
  if (colId === "numero" || colId.endsWith("_num") || colId === "numero_marca") return "num";
  return "texto";
}
