/**
 * Dinheiro, quantidades e percentuais no navegador (D-PROD-154) — SEM ponto
 * flutuante em nenhuma conta.
 *
 * Representação canônica: texto com ponto decimal e sem separador de milhar
 * ("1234.56", "0.5", "10"); diferenças podem ser negativas ("-0.01"). É o mesmo
 * formato que a API recebe e devolve. Somas, diferenças, produtos e rateios são
 * feitos em BigInt de unidades mínimas; o arredondamento é ROUND_HALF_UP (igual
 * ao `decimalFinanceiro.js` do servidor). Ninguém aqui chama `Number()` sobre um
 * valor: a única conversão para número de máquina é a da formatação, e mesmo
 * ela recebe a STRING (Intl.NumberFormat v3 formata o decimal exato) e é
 * conferida dígito a dígito.
 *
 * Entrada localizada: os separadores vêm de `Intl.NumberFormat(locale)
 * .formatToParts` (sempre com `numberingSystem: 'latn'`), aceitando número com
 * ou sem milhar ("1.234,56" e "1234,56" em pt-BR; "1,234.56" em en-US). Texto
 * ambíguo ou fora do padrão do locale é recusado — nunca "adivinhado".
 */

/** Locales aceitos pelo perfil financeiro (catálogo fechado do servidor, §8.6). */
export const LOCALES_FINANCEIROS = Object.freeze(['pt-BR', 'pt-PT', 'es-AR', 'es-PY', 'es-UY', 'es-ES', 'en-US', 'ja-JP']);

/** Limites por tipo de campo (mesmos patterns AJV do servidor, §8.2). */
export const LIMITES = Object.freeze({
  DINHEIRO: Object.freeze({ inteiros: 14, casas: 4 }),
  QUANTIDADE: Object.freeze({ inteiros: 10, casas: 4 }),
  PRECO: Object.freeze({ inteiros: 12, casas: 6 }),
  PERCENTUAL: Object.freeze({ inteiros: 3, casas: 6 }),
});

const RE_CANONICO = /^(-)?(\d+)(?:\.(\d+))?$/;
const ESPACOS = /[\s\u00a0\u202f\u2007]/g;

/** @type {Map<string, { decimal: string, grupo: string }>} */
const cacheSeparadores = new Map();

/**
 * Separadores decimal e de milhar do locale (dígitos latinos).
 * @param {string} [locale]
 * @returns {{ decimal: string, grupo: string }}
 */
export const separadoresDoLocale = (locale = 'pt-BR') => {
  const chave = String(locale || 'pt-BR');
  const guardado = cacheSeparadores.get(chave);
  if (guardado) return guardado;
  let decimal = ',';
  let grupo = '.';
  try {
    const partes = new Intl.NumberFormat(chave, { numberingSystem: 'latn', useGrouping: true, minimumFractionDigits: 1 }).formatToParts(1234567.5);
    decimal = partes.find((p) => p.type === 'decimal')?.value ?? decimal;
    grupo = partes.find((p) => p.type === 'group')?.value ?? '';
  } catch {
    /* locale inválido: padrão pt-BR */
  }
  const resultado = Object.freeze({ decimal, grupo: grupo.replace(ESPACOS, ' ') });
  cacheSeparadores.set(chave, resultado);
  return resultado;
};

/**
 * Resultado da leitura: `ok` com `valor` canônico, ou `motivo` da recusa.
 * @typedef {{ ok: boolean, valor?: string, motivo?: 'vazio'|'formato'|'casas'|'limite' }} LeituraNumero
 */

/** @param {string} s */
const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Lê um número digitado no formato do locale e devolve a string canônica.
 * Nunca arredonda: casa a mais é recusada (`casas`), dígito inteiro a mais
 * também (`limite`).
 *
 * @param {unknown} texto
 * @param {string} [locale]
 * @param {{ casas?: number, inteiros?: number }} [limites]
 * @returns {LeituraNumero}
 */
export const lerNumeroLocal = (texto, locale = 'pt-BR', limites = {}) => {
  const casas = limites.casas ?? 2;
  const inteiros = limites.inteiros ?? 14;
  const bruto = String(texto ?? '').replace(ESPACOS, '');
  if (!bruto) return { ok: false, motivo: 'vazio' };
  const { decimal, grupo } = separadoresDoLocale(locale);
  const grupoSemEspaco = grupo.trim();
  const partes = bruto.split(decimal);
  if (partes.length > 2) return { ok: false, motivo: 'formato' };
  const [parteInteira, parteFracao = ''] = partes;
  if (!/^\d*$/.test(parteFracao)) return { ok: false, motivo: 'formato' };
  let digitosInteiros = parteInteira;
  if (grupoSemEspaco && parteInteira.includes(grupoSemEspaco)) {
    const g = escaparRegex(grupoSemEspaco);
    // Milhar só nas posições certas: "1.234.567" sim; "1.23" ou "12.3456" não.
    if (!new RegExp(`^\\d{1,3}(?:${g}\\d{3})+$`).test(parteInteira)) return { ok: false, motivo: 'formato' };
    digitosInteiros = parteInteira.split(grupoSemEspaco).join('');
  }
  if (!/^\d*$/.test(digitosInteiros)) return { ok: false, motivo: 'formato' };
  if (!digitosInteiros && !parteFracao) return { ok: false, motivo: 'formato' };
  const inteira = digitosInteiros.replace(/^0+(?=\d)/, '') || '0';
  const fracao = parteFracao.replace(/0+$/, '');
  if (fracao.length > casas) return { ok: false, motivo: 'casas' };
  if (inteira.length > inteiros) return { ok: false, motivo: 'limite' };
  return { ok: true, valor: fracao ? `${inteira}.${fracao}` : inteira };
};

/**
 * Texto canônico → BigInt na escala pedida. Casa decimal significativa além da
 * escala é ERRO (nada é arredondado em silêncio).
 * @param {unknown} canonico
 * @param {number} casas
 * @returns {bigint}
 */
export const paraUnidades = (canonico, casas) => {
  const m = RE_CANONICO.exec(String(canonico ?? '').trim());
  if (!m) throw new RangeError('valor_invalido');
  const [, sinal, inteira, fracao = ''] = m;
  if (fracao.replace(/0+$/, '').length > casas) throw new RangeError('casas_excedidas');
  const digitos = `${inteira}${fracao.padEnd(casas, '0').slice(0, casas)}`;
  const unidades = BigInt(digitos);
  return sinal ? -unidades : unidades;
};

/**
 * BigInt de unidades mínimas → texto canônico com exatamente `casas` decimais.
 * @param {bigint} unidades
 * @param {number} casas
 */
export const deUnidades = (unidades, casas) => {
  const negativo = unidades < 0n;
  let abs = (negativo ? -unidades : unidades).toString();
  if (casas > 0) {
    abs = abs.padStart(casas + 1, '0');
    abs = `${abs.slice(0, abs.length - casas)}.${abs.slice(abs.length - casas)}`;
  }
  return negativo ? `-${abs}` : abs;
};

/** Escala natural do texto canônico ("10.50" → [1050n, 2]). @param {string} canonico @returns {[bigint, number]} */
const escalaNatural = (canonico) => {
  const m = RE_CANONICO.exec(String(canonico ?? '').trim());
  if (!m) throw new RangeError('valor_invalido');
  const casas = (m[3] ?? '').length;
  return [paraUnidades(canonico, casas), casas];
};

/** É texto canônico válido (sem sinal)? @param {unknown} v */
export const ehCanonico = (v) => typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v);

/**
 * Divisão inteira com ROUND_HALF_UP (empate afasta do zero).
 * @param {bigint} numerador
 * @param {bigint} denominador
 */
const dividirHalfUp = (numerador, denominador) => {
  if (denominador === 0n) throw new RangeError('divisao_por_zero');
  const negativo = numerador < 0n !== denominador < 0n;
  const n = numerador < 0n ? -numerador : numerador;
  const d = denominador < 0n ? -denominador : denominador;
  let q = n / d;
  if ((n % d) * 2n >= d) q += 1n;
  return negativo ? -q : q;
};

/**
 * Muda a escala com ROUND_HALF_UP.
 * @param {bigint} unidades
 * @param {number} deCasas
 * @param {number} paraCasas
 */
const reescalar = (unidades, deCasas, paraCasas) => {
  if (paraCasas >= deCasas) return unidades * 10n ** BigInt(paraCasas - deCasas);
  return dividirHalfUp(unidades, 10n ** BigInt(deCasas - paraCasas));
};

/**
 * Texto canônico na escala pedida, arredondando HALF_UP se tiver mais casas.
 * @param {string} canonico
 * @param {number} casas
 */
export const arredondar = (canonico, casas) => {
  const [u, c] = escalaNatural(canonico);
  return deUnidades(reescalar(u, c, casas), casas);
};

/** Texto canônico com exatamente `casas` decimais (recusa casa a mais). @param {string} canonico @param {number} casas */
export const naEscala = (canonico, casas) => deUnidades(paraUnidades(canonico, casas), casas);

/**
 * q × vu arredondado HALF_UP na escala (subtotal do item). Exato: o produto é
 * feito em BigInt na escala somada dos dois fatores.
 * @param {string} a
 * @param {string} b
 * @param {number} casas
 */
export const multiplicarArredondar = (a, b, casas) => {
  const [ua, ca] = escalaNatural(a);
  const [ub, cb] = escalaNatural(b);
  return deUnidades(reescalar(ua * ub, ca + cb, casas), casas);
};

/**
 * Soma exata na escala (valores ausentes contam como zero).
 * @param {Array<string|null|undefined>} valores
 * @param {number} casas
 */
export const somar = (valores, casas) => deUnidades(valores.reduce((s, v) => s + (v ? paraUnidades(v, casas) : 0n), 0n), casas);

/** a − b na escala. @param {string} a @param {string} b @param {number} casas */
export const subtrair = (a, b, casas) => deUnidades(paraUnidades(a, casas) - paraUnidades(b, casas), casas);

/**
 * Compara dois textos canônicos (qualquer escala).
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1}
 */
export const comparar = (a, b) => {
  const [ua, ca] = escalaNatural(a);
  const [ub, cb] = escalaNatural(b);
  const c = Math.max(ca, cb);
  const x = reescalar(ua, ca, c);
  const y = reescalar(ub, cb, c);
  return x === y ? 0 : x < y ? -1 : 1;
};

/** @param {string} v */
export const ehZero = (v) => comparar(v, '0') === 0;
/** @param {string} v */
export const ehPositivo = (v) => comparar(v, '0') > 0;

/**
 * Percentual informativo de `valor` sobre `total` (HALF_UP em `casasPct`).
 * @param {string} valor
 * @param {string} total
 * @param {number} casas escala da moeda
 * @param {number} [casasPct]
 * @returns {string|null}
 */
export const percentualDe = (valor, total, casas, casasPct = 2) => {
  const ut = paraUnidades(total, casas);
  if (ut === 0n) return null;
  const uv = paraUnidades(valor, casas);
  return deUnidades(dividirHalfUp(uv * 100n * 10n ** BigInt(casasPct), ut), casasPct);
};

const CEM_POR_CENTO = 100n * 1000000n;

/**
 * Rateio PERCENTUAL (mesmo algoritmo do servidor, §2.2): cada linha recebe o
 * PISO de total × p / 100 na escala da moeda; o resto em unidades mínimas vai
 * 1 a 1 às linhas de MAIOR resto fracionário (empate: menor ordem). Só fecha
 * quando os percentuais somam EXATAMENTE 100.
 *
 * @param {string} total canônico
 * @param {Array<string|null>} percentuais canônicos (até 6 casas); null = linha sem percentual
 * @param {number} casas
 * @returns {{ fecha100: boolean, somaPercentual: string, valores: Array<string|null>, linhasZeradas: number[] }}
 */
export const ratearPercentual = (total, percentuais, casas) => {
  const ut = paraUnidades(total, casas);
  const ps = percentuais.map((p) => (p == null ? null : paraUnidades(p, 6)));
  const soma = ps.reduce((s, p) => s + (p ?? 0n), 0n);
  const somaPercentual = deUnidades(soma, 6);
  if (soma !== CEM_POR_CENTO || ps.some((p) => p == null) || ut <= 0n) {
    return { fecha100: false, somaPercentual, valores: ps.map(() => null), linhasZeradas: [] };
  }
  const linhas = ps.map((p, i) => ({ i, valor: (ut * /** @type {bigint} */ (p)) / CEM_POR_CENTO, resto: (ut * /** @type {bigint} */ (p)) % CEM_POR_CENTO }));
  let sobra = ut - linhas.reduce((s, l) => s + l.valor, 0n);
  const ordem = [...linhas].sort((a, b) => (a.resto === b.resto ? a.i - b.i : a.resto > b.resto ? -1 : 1));
  for (const linha of ordem) {
    if (sobra <= 0n) break;
    linha.valor += 1n;
    sobra -= 1n;
  }
  return {
    fecha100: true,
    somaPercentual,
    valores: linhas.map((l) => deUnidades(l.valor, casas)),
    linhasZeradas: linhas.filter((l) => l.valor === 0n).map((l) => l.i),
  };
};

/**
 * Divide `total` em `quantidade` partes iguais na escala; o RESTO do
 * arredondamento vai para a ÚLTIMA (§7).
 * @param {string} total
 * @param {number} quantidade
 * @param {number} casas
 * @returns {string[]}
 */
export const dividirComRestoNaUltima = (total, quantidade, casas) => {
  const n = BigInt(quantidade);
  if (n < 1n) return [];
  const ut = paraUnidades(total, casas);
  const base = ut / n;
  const ultima = ut - base * (n - 1n);
  return Array.from({ length: quantidade }, (_, k) => deUnidades(k === quantidade - 1 ? ultima : base, casas));
};

// ─── Formatação ──────────────────────────────────────────────────────────

/** @type {Map<string, Intl.NumberFormat>} */
const cacheFormatadores = new Map();

/** @param {string} locale @param {Intl.NumberFormatOptions} opcoes */
const formatador = (locale, opcoes) => {
  const chave = `${locale}|${JSON.stringify(opcoes)}`;
  let fmt = cacheFormatadores.get(chave);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, { ...opcoes, numberingSystem: 'latn' });
    cacheFormatadores.set(chave, fmt);
  }
  return fmt;
};

/**
 * Ajusta as casas do texto canônico ao que o Intl vai desenhar: completa até
 * `min`, tira zeros à direita acima de `min` e arredonda HALF_UP acima de `max`.
 * @param {string} canonico @param {number} min @param {number} max
 */
const ajustarCasas = (canonico, min, max) => {
  const [u, c] = escalaNatural(canonico);
  let texto = c > max ? deUnidades(reescalar(u, c, max), max) : canonico;
  const [inteira, fracao = ''] = texto.split('.');
  let f = fracao.replace(/0+$/, '');
  if (f.length < min) f = f.padEnd(min, '0');
  texto = f ? `${inteira}.${f}` : inteira;
  return texto;
};

/** @param {string} s */
const digitos = (s) => s.replace(/\D/g, '');

/**
 * Desenha o número com os separadores do locale sem passar por float (reserva
 * para motores antigos sem Intl.NumberFormat v3).
 * @param {string} alvo @param {string} locale @param {Intl.NumberFormatOptions} opcoes
 */
const montarManual = (alvo, locale, opcoes) => {
  const negativo = alvo.startsWith('-');
  const [inteira, fracao = ''] = alvo.replace('-', '').split('.');
  const { decimal, grupo } = separadoresDoLocale(locale);
  const agrupado = opcoes.useGrouping === false || !grupo ? inteira : inteira.replace(/\B(?=(\d{3})+(?!\d))/g, grupo);
  const numero = fracao ? `${agrupado}${decimal}${fracao}` : agrupado;
  let partes;
  try {
    partes = formatador(locale, opcoes).formatToParts(negativo ? -1 : 1);
  } catch {
    return `${negativo ? '-' : ''}${numero}`;
  }
  let usado = false;
  return partes
    .map((p) => {
      if (p.type === 'integer' || p.type === 'group' || p.type === 'decimal' || p.type === 'fraction') {
        if (usado) return '';
        usado = true;
        return numero;
      }
      return p.value;
    })
    .join('');
};

/**
 * @param {string} canonico
 * @param {string} locale
 * @param {Intl.NumberFormatOptions & { minimumFractionDigits: number, maximumFractionDigits: number }} opcoes
 */
const formatarExato = (canonico, locale, opcoes) => {
  const alvo = ajustarCasas(canonico, opcoes.minimumFractionDigits, opcoes.maximumFractionDigits);
  try {
    // Intl.NumberFormat v3: string = decimal exato (sem float). Conferimos os dígitos.
    const texto = formatador(locale, opcoes).format(/** @type {any} */ (alvo));
    if (digitos(texto) === digitos(alvo)) return texto;
  } catch {
    /* motor antigo ou locale inválido: montagem manual */
  }
  return montarManual(alvo, locale, opcoes);
};

/**
 * Valor monetário formatado no locale (ex.: "R$ 1.234,56"). Texto vazio ou
 * inválido vira "—".
 * @param {unknown} canonico
 * @param {{ locale?: string, moeda?: string, casas?: number }} [opcoes]
 */
export const formatarMoeda = (canonico, opcoes = {}) => {
  const { locale = 'pt-BR', moeda = 'BRL', casas = 2 } = opcoes;
  if (typeof canonico !== 'string' || !RE_CANONICO.test(canonico.trim())) return '—';
  return formatarExato(canonico.trim(), locale, { style: 'currency', currency: moeda, minimumFractionDigits: casas, maximumFractionDigits: casas });
};

/**
 * Número formatado no locale (quantidade, preço, percentual).
 * @param {unknown} canonico
 * @param {{ locale?: string, casasMin?: number, casasMax?: number, agrupar?: boolean }} [opcoes]
 */
export const formatarNumero = (canonico, opcoes = {}) => {
  const { locale = 'pt-BR', casasMin = 0, casasMax = 4, agrupar = true } = opcoes;
  if (typeof canonico !== 'string' || !RE_CANONICO.test(canonico.trim())) return '—';
  return formatarExato(canonico.trim(), locale, { minimumFractionDigits: casasMin, maximumFractionDigits: casasMax, useGrouping: agrupar });
};

/**
 * Texto para preencher um campo de edição a partir do valor canônico
 * ("1234.50" → "1.234,50" em pt-BR). Vazio para valor ausente.
 * @param {unknown} canonico
 * @param {string} locale
 * @param {{ casasMin?: number, casasMax?: number }} [opcoes]
 */
export const paraTextoDeEdicao = (canonico, locale, opcoes = {}) => {
  if (typeof canonico !== 'string' || !RE_CANONICO.test(canonico.trim())) return '';
  return formatarNumero(canonico, { locale, casasMin: opcoes.casasMin ?? 0, casasMax: opcoes.casasMax ?? 6 });
};

/** Exemplo do formato aceito no locale (para o texto de ajuda). @param {string} locale @param {number} casas */
export const exemploDoLocale = (locale, casas = 2) => {
  const { decimal, grupo } = separadoresDoLocale(locale);
  const g = grupo.trim() ? grupo : ' ';
  return casas > 0 ? `1${g}234${decimal}${'5678'.slice(0, casas)}` : `1${g}234`;
};
