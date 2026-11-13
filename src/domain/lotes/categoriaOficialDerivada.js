/**
 * Categoria oficial DERIVADA de uma categoria de manejo — MAIKE-CATEGORIA-MANEJO-ENXUGAR.
 *
 * Espelho de `backend/src/modules/movimentacoesMapa/categoriaOficialDerivada.js`
 * (o servidor é quem decide; o smoke `categoriaOficialDerivada.test.js` confere
 * que as duas tabelas e as duas funções concordam). A oficial vem de
 * **sexo + faixa de idade**; o nome da categoria de manejo é livre e nunca é a
 * chave ("BOI + 36 MESES" → "Touro + 36 meses").
 *
 * Funções puras: nada de rede, cache ou React.
 */

/**
 * Faixas oficiais de idade (meses, limites inclusivos; `ate: null` = sem teto)
 * e a categoria oficial de cada sexo nela.
 */
export const FAIXAS_CATEGORIA_OFICIAL = Object.freeze([
  Object.freeze({ de: 0, ate: 12, MACHO: 'Bezerro 0 a 12 meses', FEMEA: 'Bezerra 0 a 12 meses' }),
  Object.freeze({ de: 13, ate: 24, MACHO: 'Garrote 13 a 24 meses', FEMEA: 'Novilha 13 a 24 meses' }),
  Object.freeze({ de: 25, ate: 36, MACHO: 'Boi 25 a 36 meses', FEMEA: 'Vaca 25 a 36 meses' }),
  Object.freeze({ de: 37, ate: null, MACHO: 'Touro + 36 meses', FEMEA: 'Vaca + 36 meses' }),
]);

/** As 8 categorias oficiais, na ordem do servidor (`CATEGORIAS_OFICIAIS`): faixa a faixa, macho e fêmea. */
export const CATEGORIAS_OFICIAIS = Object.freeze(FAIXAS_CATEGORIA_OFICIAL.flatMap((f) => [f.MACHO, f.FEMEA]));

const semAcento = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();

/** 'Macho'/'MACHO' → 'MACHO'; 'Fêmea'/'FEMEA'/'Femea' → 'FEMEA'; qualquer outro → null. */
export const sexoOficial = (sexo) => {
  const s = semAcento(sexo);
  return s === 'MACHO' || s === 'FEMEA' ? s : null;
};

/** undefined = ausente (null/undefined/''); NaN = inválido (negativo, fracionário, texto); senão o inteiro. */
const mesesDe = (valor) => {
  if (valor === null || valor === undefined || valor === '') return undefined;
  const n = typeof valor === 'number' ? valor : typeof valor === 'string' && /^\s*\d+\s*$/.test(valor) ? Number(valor) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};

const faixaDe = (meses) => FAIXAS_CATEGORIA_OFICIAL.findIndex((f) => meses >= f.de && (f.ate === null || meses <= f.ate));

/**
 * Categoria oficial de uma categoria de manejo, ou `null` quando não dá para
 * deduzir com segurança (sexo diferente de Macho/Fêmea; sem idade; idade
 * negativa/fracionária ou mínima > máxima; faixa que atravessa duas oficiais;
 * sem máxima e mínima abaixo de 37). Mínima ausente vale 0.
 *
 * @param {{ sexo?: unknown, idade_minima_meses?: unknown, idade_maxima_meses?: unknown } | null | undefined} categoria
 * @returns {string | null}
 */
export const categoriaOficialDaCategoriaManejo = (categoria) => {
  const sexo = sexoOficial(categoria?.sexo);
  if (!sexo) return null;
  const minima = mesesDe(categoria?.idade_minima_meses);
  const maxima = mesesDe(categoria?.idade_maxima_meses);
  if (Number.isNaN(minima) || Number.isNaN(maxima)) return null;
  if (minima === undefined && maxima === undefined) return null;
  const inicio = minima ?? 0;
  if (maxima !== undefined && maxima < inicio) return null;
  const faixa = faixaDe(inicio);
  if (faixa < 0) return null;
  if (maxima === undefined ? FAIXAS_CATEGORIA_OFICIAL[faixa].ate !== null : faixaDe(maxima) !== faixa) return null;
  return FAIXAS_CATEGORIA_OFICIAL[faixa][sexo];
};

/** A categoria de manejo deriva ESTA oficial? (sem acento, sem caixa; não derivável nunca casa). */
export const derivaCategoriaOficial = (categoria, oficial) => {
  const derivada = categoriaOficialDaCategoriaManejo(categoria);
  return derivada !== null && semAcento(derivada) === semAcento(oficial);
};

/**
 * Faixas de idade FIXAS do cadastro de Categoria de Manejo (decisão do
 * proprietário, 2026-11-13) — espelho de `FAIXAS_IDADE_CATEGORIA_MANEJO` do
 * servidor (o smoke de paridade confere que as listas são idênticas). O par
 * gravado (`idade_minima_meses`, `idade_maxima_meses`) é exatamente o de uma
 * delas; toda faixa cabe inteira numa faixa oficial (0–8 e 9–12 → 0–12).
 */
export const FAIXAS_IDADE_CATEGORIA_MANEJO = Object.freeze([
  Object.freeze({ rotulo: '0 a 8 meses', idade_minima_meses: 0, idade_maxima_meses: 8 }),
  Object.freeze({ rotulo: '9 a 12 meses', idade_minima_meses: 9, idade_maxima_meses: 12 }),
  Object.freeze({ rotulo: '13 a 24 meses', idade_minima_meses: 13, idade_maxima_meses: 24 }),
  Object.freeze({ rotulo: '25 a 36 meses', idade_minima_meses: 25, idade_maxima_meses: 36 }),
  Object.freeze({ rotulo: 'Maior que 36 meses', idade_minima_meses: 37, idade_maxima_meses: null }),
]);

/**
 * A faixa da lista fixa com EXATAMENTE este par (mínima, máxima), ou `null`.
 * Ausente (null/undefined/'') conta como `null`; valor inválido nunca casa.
 * @param {unknown} minima
 * @param {unknown} maxima
 */
export const faixaIdadeDaLista = (minima, maxima) => {
  const min = mesesDe(minima);
  const max = mesesDe(maxima);
  if (Number.isNaN(min) || Number.isNaN(max)) return null;
  return (
    FAIXAS_IDADE_CATEGORIA_MANEJO.find(
      (f) => f.idade_minima_meses === (min ?? null) && f.idade_maxima_meses === (max ?? null)
    ) ?? null
  );
};

/**
 * Texto da faixa de idade gravada (grade e CSV): o rótulo da faixa da lista
 * ("25 a 36 meses"); par fora da lista → "X a Y meses" ("A partir de X meses"
 * / "Até Y meses" com um lado só); sem nenhuma idade → "".
 * @param {{ idade_minima_meses?: unknown, idade_maxima_meses?: unknown } | null | undefined} categoria
 * @returns {string}
 */
export const rotuloFaixaIdade = (categoria) => {
  const minima = categoria?.idade_minima_meses;
  const maxima = categoria?.idade_maxima_meses;
  const faixa = faixaIdadeDaLista(minima, maxima);
  if (faixa) return faixa.rotulo;
  const vazio = (v) => v === null || v === undefined || String(v).trim() === '';
  if (vazio(minima) && vazio(maxima)) return '';
  if (vazio(maxima)) return `A partir de ${String(minima).trim()} meses`;
  if (vazio(minima)) return `Até ${String(maxima).trim()} meses`;
  return `${String(minima).trim()} a ${String(maxima).trim()} meses`;
};
