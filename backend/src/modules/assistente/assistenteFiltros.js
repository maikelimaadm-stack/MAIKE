/**
 * Assistente só de leitura (D-PROD-230) — filtros, ordenação, agrupamento e a
 * calculadora das ferramentas.
 *
 * Tudo roda sobre listas que JÁ vieram filtradas pelo tenant e pela fazenda: a
 * entrada da IA só estreita, ordena ou conta o que o usuário já pode ver. Nada
 * daqui vira SQL. A entrada é conferida contra o schema da própria ferramenta
 * (tipos, faixas, enumerações, nada de chave extra); fora do schema vira erro da
 * ferramenta, que volta para a IA como `is_error` em vez de derrubar a pergunta.
 */

import { AppError } from '../../shared/errors/AppError.js';

const erro = (mensagem) => new AppError('REQUEST_VALIDATION_FAILED', mensagem);

/**
 * Confere a entrada contra o subconjunto de JSON Schema que as ferramentas usam.
 * @param {any} schema @param {unknown} entrada @param {string} nome
 * @returns {Record<string, any>}
 */
export const validarEntrada = (schema, entrada, nome) => {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) throw erro(`${nome}: a entrada tem de ser um objeto`);
  const props = schema?.properties ?? {};
  for (const chave of Object.keys(entrada)) {
    if (!Object.prototype.hasOwnProperty.call(props, chave)) throw erro(`${nome}: parâmetro desconhecido "${chave}"`);
  }
  for (const req of schema?.required ?? []) {
    if (entrada[req] === undefined || entrada[req] === null || entrada[req] === '') throw erro(`${nome}: falta "${req}"`);
  }
  for (const [chave, regra] of Object.entries(props)) {
    const v = entrada[chave];
    if (v === undefined || v === null) continue;
    conferirValor(regra, v, `${nome}.${chave}`);
  }
  return /** @type {Record<string, any>} */ (entrada);
};

/** @param {any} regra @param {unknown} v @param {string} rotulo */
const conferirValor = (regra, v, rotulo) => {
  if (regra.enum && !regra.enum.includes(v)) throw erro(`${rotulo}: use um de ${regra.enum.join(', ')}`);
  switch (regra.type) {
    case 'string':
      if (typeof v !== 'string') throw erro(`${rotulo}: tem de ser texto`);
      if (regra.minLength && v.length < regra.minLength) throw erro(`${rotulo}: texto vazio`);
      if (regra.maxLength && v.length > regra.maxLength) throw erro(`${rotulo}: texto longo demais`);
      if (regra.pattern && !new RegExp(regra.pattern).test(v)) throw erro(`${rotulo}: formato inválido`);
      return;
    case 'integer':
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v) || (regra.type === 'integer' && !Number.isInteger(v))) throw erro(`${rotulo}: tem de ser ${regra.type === 'integer' ? 'número inteiro' : 'número'}`);
      if (regra.minimum !== undefined && v < regra.minimum) throw erro(`${rotulo}: mínimo ${regra.minimum}`);
      if (regra.maximum !== undefined && v > regra.maximum) throw erro(`${rotulo}: máximo ${regra.maximum}`);
      return;
    case 'boolean':
      if (typeof v !== 'boolean') throw erro(`${rotulo}: tem de ser verdadeiro ou falso`);
      return;
    case 'array':
      if (!Array.isArray(v)) throw erro(`${rotulo}: tem de ser uma lista`);
      if (regra.maxItems && v.length > regra.maxItems) throw erro(`${rotulo}: no máximo ${regra.maxItems} itens`);
      v.forEach((item, i) => conferirValor(regra.items ?? {}, item, `${rotulo}[${i}]`));
      return;
    default:
      return;
  }
};

/** Comparação de texto sem acento e sem caixa ("Pasto 3" casa com "PASTO 3"). @param {unknown} s */
export const normalizar = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** "contém", sem acento e sem caixa. @param {unknown} valor @param {string|undefined} filtro */
export const contem = (valor, filtro) => filtro === undefined || normalizar(valor).includes(normalizar(filtro));

/** Dentro da faixa [min, max]; valor ausente só passa se não houver faixa. */
export const naFaixa = (/** @type {number|null} */ v, /** @type {number|undefined} */ min, /** @type {number|undefined} */ max) => {
  if (min === undefined && max === undefined) return true;
  if (v === null || v === undefined || !Number.isFinite(v)) return false;
  return (min === undefined || v >= min) && (max === undefined || v <= max);
};

/**
 * Ordena (nulos por último) e corta. Devolve o total antes do corte para a IA
 * saber que há mais.
 * @template T
 * @param {T[]} lista @param {{ ordenar_por?: string, ordem?: 'asc'|'desc', limite?: number }} entrada
 * @param {Record<string, (x: T) => any>} chaves @param {number} limitePadrao
 */
export const ordenarECortar = (lista, entrada, chaves, limitePadrao) => {
  let out = [...lista];
  const chave = entrada.ordenar_por ? chaves[entrada.ordenar_por] : null;
  if (chave) {
    const sinal = entrada.ordem === 'desc' ? -1 : 1;
    out.sort((a, b) => {
      const va = chave(a);
      const vb = chave(b);
      if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sinal;
      return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true }) * sinal;
    });
  }
  const limite = entrada.limite ?? limitePadrao;
  const total = out.length;
  out = out.slice(0, limite);
  return { total, mostrados: out.length, cortado: total > out.length, itens: out };
};

/**
 * Agrupa e soma no servidor (contas certas e menos texto para a IA).
 * @param {any[]} lista @param {(x: any) => string} grupoDe
 * @param {{ cabecas?: (x: any) => number, peso?: (x: any) => number|null, hectares?: (x: any) => number|null }} medidas
 */
export const agrupar = (lista, grupoDe, medidas) => {
  /** @type {Map<string, any>} */
  const mapa = new Map();
  for (const x of lista) {
    const g = grupoDe(x) || 'não informado';
    const acc = mapa.get(g) ?? { grupo: g, itens: 0, cabecas: 0, _peso: 0, _cabPeso: 0, hectares: 0 };
    acc.itens += 1;
    const cab = medidas.cabecas ? medidas.cabecas(x) || 0 : 0;
    acc.cabecas += cab;
    const peso = medidas.peso ? medidas.peso(x) : null;
    if (peso !== null && peso !== undefined && cab > 0) {
      acc._peso += peso * cab;
      acc._cabPeso += cab;
    }
    const ha = medidas.hectares ? medidas.hectares(x) : null;
    if (ha) acc.hectares += ha;
    mapa.set(g, acc);
  }
  return [...mapa.values()]
    .map(({ _peso, _cabPeso, ...a }) => {
      const r = { grupo: a.grupo, itens: a.itens };
      if (medidas.cabecas) r.cabecas = a.cabecas;
      if (medidas.peso) r.peso_medio_kg = _cabPeso ? arred(_peso / _cabPeso, 1) : null;
      if (medidas.peso) r.peso_total_kg = _cabPeso ? arred(_peso, 0) : null;
      if (medidas.hectares) r.hectares = arred(a.hectares, 2);
      return r;
    })
    .sort((a, b) => (b.cabecas ?? b.itens) - (a.cabecas ?? a.itens) || String(a.grupo).localeCompare(String(b.grupo), 'pt-BR'));
};

/** @param {number} v @param {number} casas */
export const arred = (v, casas = 2) => {
  const f = 10 ** casas;
  return Math.round((v + Number.EPSILON) * f) / f;
};

// ---------------------------------------------------------------------------
// Calculadora: analisador de expressão próprio (sem eval / Function).
// Gramática:
//   expr   := termo (('+'|'-') termo)*
//   termo  := fator (('*'|'/'|'%') fator)*
//   fator  := ('+'|'-') fator | base ('^' fator)?
//   base   := número | '(' expr ')' | função '(' args ')'
//   args   := (expr | lista) (',' (expr | lista))*
//   lista  := '[' expr (',' expr)* ']'
// ---------------------------------------------------------------------------

const MAX_EXPRESSAO = 2000;
const MAX_PROFUNDIDADE = 50;

/** @type {Record<string, (args: Array<number|number[]>) => number>} */
const FUNCOES = {
  soma: (a) => planos(a).reduce((s, v) => s + v, 0),
  media: (a) => {
    const v = planos(a);
    if (!v.length) throw erro('calcular: média de lista vazia');
    return v.reduce((s, x) => s + x, 0) / v.length;
  },
  minimo: (a) => {
    const v = planos(a);
    if (!v.length) throw erro('calcular: mínimo de lista vazia');
    return Math.min(...v);
  },
  maximo: (a) => {
    const v = planos(a);
    if (!v.length) throw erro('calcular: máximo de lista vazia');
    return Math.max(...v);
  },
  arred: (a) => {
    const [x, casas = 0] = escalares(a, 'arred', 1, 2);
    if (!Number.isInteger(casas) || casas < 0 || casas > 10) throw erro('calcular: arred aceita de 0 a 10 casas');
    return arred(x, casas);
  },
  pct: (a) => {
    const [parte, todo] = escalares(a, 'pct', 2, 2);
    if (todo === 0) throw erro('calcular: divisão por zero em pct');
    return (parte / todo) * 100;
  },
  // Média ponderada: media_ponderada([valores], [pesos]).
  media_ponderada: (a) => {
    if (a.length !== 2 || !Array.isArray(a[0]) || !Array.isArray(a[1]) || a[0].length !== a[1].length) throw erro('calcular: media_ponderada([valores], [pesos]) com listas do mesmo tamanho');
    const pesos = a[1].reduce((s, p) => s + p, 0);
    if (pesos === 0) throw erro('calcular: soma dos pesos é zero');
    return a[0].reduce((s, v, i) => s + v * a[1][i], 0) / pesos;
  },
  raiz: (a) => {
    const [x] = escalares(a, 'raiz', 1, 1);
    if (x < 0) throw erro('calcular: raiz de número negativo');
    return Math.sqrt(x);
  },
  abs: (a) => Math.abs(escalares(a, 'abs', 1, 1)[0]),
};

/** @param {Array<number|number[]>} a */
const planos = (a) => a.flatMap((x) => (Array.isArray(x) ? x : [x]));
/** @param {Array<number|number[]>} a @param {string} nome @param {number} min @param {number} max */
const escalares = (a, nome, min, max) => {
  if (a.length < min || a.length > max || a.some(Array.isArray)) throw erro(`calcular: ${nome} recebe de ${min} a ${max} número(s)`);
  return /** @type {number[]} */ (a);
};

/** @param {string} texto */
const tokenizar = (texto) => {
  const tokens = [];
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    if (/\s/.test(c)) { i += 1; continue; }
    // Número: 1234, 12.5 ou 12,5 só quando não há vírgula de argumento em jogo → aceitamos só ponto como decimal.
    const n = /^(\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(texto.slice(i));
    if (n) { tokens.push({ t: 'num', v: Number(n[0]) }); i += n[0].length; continue; }
    const id = /^[a-z_][a-z_0-9]*/i.exec(texto.slice(i));
    if (id) { tokens.push({ t: 'id', v: id[0].toLowerCase() }); i += id[0].length; continue; }
    if ('+-*/%^(),[]'.includes(c)) { tokens.push({ t: c }); i += 1; continue; }
    throw erro(`calcular: caractere não permitido "${c}"`);
  }
  return tokens;
};

/**
 * Avalia uma expressão aritmética sem executar código.
 * @param {string} expressao
 * @returns {number}
 */
export const avaliarExpressao = (expressao) => {
  if (typeof expressao !== 'string' || !expressao.trim()) throw erro('calcular: expressão vazia');
  if (expressao.length > MAX_EXPRESSAO) throw erro('calcular: expressão longa demais');
  const tokens = tokenizar(expressao);
  let pos = 0;
  let profundidade = 0;
  const olhar = () => tokens[pos];
  const comer = (t) => {
    const tk = tokens[pos];
    if (!tk || tk.t !== t) throw erro(`calcular: esperava "${t}"`);
    pos += 1;
    return tk;
  };
  const entrar = () => {
    profundidade += 1;
    if (profundidade > MAX_PROFUNDIDADE) throw erro('calcular: expressão aninhada demais');
  };

  /** @returns {number} */
  const expr = () => {
    entrar();
    let v = termo();
    while (olhar() && (olhar().t === '+' || olhar().t === '-')) {
      const op = tokens[pos++].t;
      const d = termo();
      v = op === '+' ? v + d : v - d;
    }
    profundidade -= 1;
    return v;
  };
  const termo = () => {
    let v = fator();
    while (olhar() && (olhar().t === '*' || olhar().t === '/' || olhar().t === '%')) {
      const op = tokens[pos++].t;
      const d = fator();
      if ((op === '/' || op === '%') && d === 0) throw erro('calcular: divisão por zero');
      v = op === '*' ? v * d : op === '/' ? v / d : v % d;
    }
    return v;
  };
  /** @returns {number} */
  const fator = () => {
    const tk = olhar();
    if (tk && (tk.t === '+' || tk.t === '-')) {
      pos += 1;
      entrar();
      const v = fator();
      profundidade -= 1;
      return tk.t === '-' ? -v : v;
    }
    const b = base();
    if (olhar() && olhar().t === '^') {
      pos += 1;
      entrar();
      const e = fator();
      profundidade -= 1;
      return b ** e;
    }
    return b;
  };
  const lista = () => {
    comer('[');
    const itens = [];
    if (olhar() && olhar().t === ']') { pos += 1; return itens; }
    itens.push(expr());
    while (olhar() && olhar().t === ',') { pos += 1; itens.push(expr()); }
    comer(']');
    if (itens.length > 1000) throw erro('calcular: lista grande demais');
    return itens;
  };
  /** @returns {number} */
  const base = () => {
    const tk = olhar();
    if (!tk) throw erro('calcular: expressão incompleta');
    if (tk.t === 'num') { pos += 1; return Number(tk.v); }
    if (tk.t === '(') { pos += 1; const v = expr(); comer(')'); return v; }
    if (tk.t === 'id') {
      const fn = Object.prototype.hasOwnProperty.call(FUNCOES, tk.v) ? FUNCOES[tk.v] : null;
      if (!fn) throw erro(`calcular: função desconhecida "${tk.v}" (use: ${Object.keys(FUNCOES).join(', ')})`);
      pos += 1;
      comer('(');
      /** @type {Array<number|number[]>} */
      const args = [];
      if (!(olhar() && olhar().t === ')')) {
        args.push(olhar() && olhar().t === '[' ? lista() : expr());
        while (olhar() && olhar().t === ',') { pos += 1; args.push(olhar() && olhar().t === '[' ? lista() : expr()); }
      }
      comer(')');
      return fn(args);
    }
    throw erro(`calcular: símbolo inesperado "${tk.t}"`);
  };

  const v = expr();
  if (pos !== tokens.length) throw erro('calcular: sobrou texto no fim da expressão');
  if (!Number.isFinite(v)) throw erro('calcular: o resultado não é um número finito');
  return v;
};
