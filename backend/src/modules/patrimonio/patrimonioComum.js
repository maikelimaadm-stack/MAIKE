/**
 * D-PROD-156 — peças comuns do Patrimônio e Frota (P1-01). Pequenas e
 * explícitas; o texto, a empresa e a trava vêm de `gestao/gestaoComum.js`
 * (D14: estender o que existe, sem solução paralela).
 */

import { AppError } from '../../shared/errors/AppError.js';
import { ID_DE_CURSOR, clausulaKeysetDesc, decodificarCursor, montarEnvelopeKeyset, normalizarLimite } from '../../shared/pagination/keysetCursor.js';
import { escaparCuringasLike } from '../usuarios/usuarioRepository.js';
import { ehViolacaoDeUnique, invalido, textoDeBusca, travarEscopo } from '../gestao/gestaoComum.js';
import { PADRAO_CODIGO_CATALOGO } from './patrimonioDominio.js';

// ─── trava, versão e unicidade ──────────────────────────────────────────────

/** Chave da trava de TODAS as escritas de catálogo do tenant (A9). */
export const chaveCatalogo = (clienteId) => `patrimonio:catalogo:${clienteId}`;

/**
 * Serializa as escritas de catálogo do tenant até o fim da transação
 * (pré-checagem de código/nome, sync de perfis do tipo e catálogo padrão).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 */
export const travarCatalogo = (tx, clienteId) => travarEscopo(tx, chaveCatalogo(clienteId));

/**
 * 409 da concorrência otimista: o registro mudou desde a leitura.
 * @param {number|null} versaoAtual
 * @param {unknown} versaoInformada
 */
export const versaoConflito = (versaoAtual, versaoInformada) =>
  new AppError('PATRIMONIO_VERSAO_CONFLITO', 'o registro foi alterado por outra pessoa desde que você o abriu; recarregue e tente de novo; nada foi gravado', {
    details: { versao_atual: versaoAtual, versao_informada: versaoInformada },
  });

/** `versao` do corpo tem de ser a do registro lido (antes de qualquer escrita). */
export const exigirVersao = (registro, versaoInformada) => {
  if (registro.versao !== versaoInformada) throw versaoConflito(registro.versao, versaoInformada);
};

/**
 * UPDATE com CAS por `versao` (incrementa uma vez). `count !== 1` → 409 com a
 * versão que está no banco agora.
 * @param {any} delegado  ex.: `tx.familiaPatrimonial`
 * @param {{ clienteId: string, id: string, versao: number, data: Record<string, unknown> }} pedido
 */
export const atualizarComVersao = async (delegado, { clienteId, id, versao, data }) => {
  const r = await delegado.updateMany({ where: { cliente_id: clienteId, id, versao }, data: { ...data, versao: { increment: 1 } } });
  if (r.count !== 1) {
    const atual = await delegado.findFirst({ where: { cliente_id: clienteId, id }, select: { versao: true } });
    throw versaoConflito(atual?.versao ?? null, versao);
  }
};

/**
 * Corrida perdida no unique do banco (P2002) → erro de negócio estável, pelo
 * campo EXATO do alvo (`codigo` não casa com `codigo_frota`). Outro erro segue.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {Record<string, () => AppError>} porCampo  campo do unique → fábrica do erro
 * @returns {Promise<T>}
 */
export const comUnicosEstaveis = async (fn, porCampo) => {
  try {
    return await fn();
  } catch (erro) {
    if (ehViolacaoDeUnique(erro)) {
      const alvo = /** @type {any} */ (erro)?.meta?.target;
      const campos = Array.isArray(alvo) ? alvo.map(String) : [];
      const texto = typeof alvo === 'string' ? alvo : '';
      for (const [campo, fabrica] of Object.entries(porCampo)) {
        if (campos.includes(campo) || (texto && texto.includes(`_${campo}_`))) throw fabrica();
      }
    }
    throw erro;
  }
};

export const codigoDuplicado = () =>
  new AppError('PATRIMONIO_CODIGO_DUPLICADO', 'já existe um cadastro com este código; nada foi gravado', { details: { field: 'codigo', reason: 'codigo_repetido' } });
export const nomeDuplicado = () =>
  new AppError('PATRIMONIO_NOME_DUPLICADO', 'já existe um cadastro com este nome; nada foi gravado', { details: { field: 'nome', reason: 'nome_repetido' } });

/**
 * Filtro de nome IGUAL sem diferenciar maiúsculas para a pré-checagem de
 * unicidade. O Prisma gera `ILIKE` para `equals` + `insensitive`: `%`, `_` e
 * `\` do nome são escapados para a comparação ser literal ('Linha_1' não
 * casa com 'LinhaX1'; 'LINHA\NOVA' casa com 'Linha\Nova').
 * @param {string} nome
 */
export const nomeIgual = (nome) => ({ equals: escaparCuringasLike(nome), mode: /** @type {const} */ ('insensitive') });

// ─── texto, código e datas ──────────────────────────────────────────────────

/**
 * Código de catálogo: aparado, em MAIÚSCULAS, `^[A-Z0-9_]{2,32}$`; fora do
 * padrão → 400.
 * @param {unknown} valor
 * @param {string} [campo]
 */
export const codigoDoCorpo = (valor, campo = 'codigo') => {
  if (typeof valor !== 'string') throw invalido(`${campo} é obrigatório`, { field: campo });
  const codigo = valor.trim().toUpperCase();
  if (!PADRAO_CODIGO_CATALOGO.test(codigo)) {
    throw invalido(`${campo} deve ter de 2 a 32 letras, números ou sublinhado`, { field: campo, reason: 'codigo_invalido' });
  }
  return codigo;
};

/** `ativo` da querystring ('true'/'false') → boolean; ausente → null. */
export const lerAtivo = (v) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : null);

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Dia civil `AAAA-MM-DD` que EXISTE no calendário (2026-02-30 não existe).
 * @param {unknown} valor
 */
export const ehDiaValido = (valor) => {
  if (typeof valor !== 'string') return false;
  const m = DIA.exec(valor);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
};

/**
 * Dia do corpo (`AAAA-MM-DD`) ou null; inexistente → 422 `PATRIMONIO_DATA_INVALIDA`.
 * @param {unknown} valor
 * @param {string} campo
 * @returns {string|null|undefined} undefined = campo ausente
 */
export const diaDoCorpo = (valor, campo) => {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  if (!ehDiaValido(valor)) {
    throw new AppError('PATRIMONIO_DATA_INVALIDA', `a data informada em ${campo} não existe; use AAAA-MM-DD; nada foi gravado`, {
      details: { field: campo, reason: 'data_inexistente' },
    });
  }
  return /** @type {string} */ (valor);
};

/** `AAAA-MM-DD` → Date (meia-noite UTC), para coluna `@db.Date`. */
export const comoData = (dia) => (dia === null || dia === undefined ? null : new Date(`${dia}T00:00:00.000Z`));
/** Date de coluna `@db.Date` → `AAAA-MM-DD`. */
export const diaDe = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ?? null);

// ─── listagem keyset (createdAt desc, id desc) ──────────────────────────────

/**
 * Listagem keyset padrão dos catálogos: envelope `{items, next_cursor,
 * has_more, total, limit}`; o `total` ignora o cursor.
 * @param {any} delegado  ex.: `prisma.familiaPatrimonial`
 * @param {{ where: Record<string, unknown>, busca: any[] , query: Record<string, any>, select?: any, include?: any, mapItem: (r: any) => any }} pedido
 *   `busca`: cláusulas OR da busca `q` (já montadas pelo chamador) ou vazio.
 */
export const listarKeyset = async (delegado, { where, busca, query, select, include, mapItem }) => {
  const limit = normalizarLimite(query.limit);
  const cursorBruto = typeof query.cursor === 'string' ? query.cursor : null;
  const cursor = cursorBruto ? decodificarCursor(cursorBruto) : null;
  if (cursorBruto && !cursor) throw invalido('cursor inválido', { field: 'cursor', reason: 'cursor_invalido' });
  /** @type {any[]} */
  const AND = busca.length ? [{ OR: busca }] : [];
  const total = await delegado.count({ where: { ...where, ...(AND.length ? { AND } : {}) } });
  if (cursor) AND.push(clausulaKeysetDesc(cursor));
  const registros = await delegado.findMany({
    where: { ...where, ...(AND.length ? { AND } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(select ? { select } : {}),
    ...(include ? { include } : {}),
  });
  return montarEnvelopeKeyset({ registros, limit, total, mapItem });
};

/**
 * Termo de busca literal (`%`/`_` escapados: `q=%` não casa tudo); '' = sem busca.
 * @param {unknown} q
 */
export const termoDeBusca = (q) => escaparCuringasLike(textoDeBusca(q));

// ─── opções de seletor: keyset (nome, id) crescente ─────────────────────────

export const LIMITE_OPCOES_PADRAO = 50;
export const LIMITE_OPCOES_MAXIMO = 100;

const NOME_IMPOSSIVEL = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const codificarCursorOpcoes = (nome, id) => Buffer.from(JSON.stringify([nome, id]), 'utf8').toString('base64url');
const decodificarCursorOpcoes = (bruto) => {
  try {
    const v = JSON.parse(Buffer.from(String(bruto), 'base64url').toString('utf8'));
    if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== 'string' || typeof v[1] !== 'string') return null;
    if (!ID_DE_CURSOR.test(v[1]) || NOME_IMPOSSIVEL.test(v[0]) || [...v[0]].length > 255) return null;
    return { nome: v[0], id: v[1] };
  } catch {
    return null;
  }
};

/**
 * Limite (padrão 50, máx. 100), cursor (nome, id) e termo de busca literal.
 * Cursor adulterado → 400 `cursor_invalido`.
 * @param {Record<string, any>} query
 */
export const paginacaoOpcoes = (query) => {
  const n = Number(query.limit);
  const limit = Number.isInteger(n) && n >= 1 ? Math.min(n, LIMITE_OPCOES_MAXIMO) : LIMITE_OPCOES_PADRAO;
  const cursor = query.cursor ? decodificarCursorOpcoes(query.cursor) : null;
  if (query.cursor && !cursor) throw invalido('cursor inválido', { field: 'cursor', reason: 'cursor_invalido' });
  return { limit, cursor, q: termoDeBusca(query.q) };
};

/**
 * Página de opções por (campoNome, id) crescente; envelope `{itens, has_more, next_cursor}`.
 * @param {any} delegado
 * @param {{ where: any, campoNome?: string, select: any, limit: number, cursor: {nome: string, id: string}|null, mapear: (linhas: any[]) => any[]|Promise<any[]> }} pedido
 */
export const paginarPorNome = async (delegado, { where, campoNome = 'nome', select, limit, cursor, mapear }) => {
  const AND = [where];
  if (cursor) AND.push({ OR: [{ [campoNome]: { gt: cursor.nome } }, { [campoNome]: cursor.nome, id: { gt: cursor.id } }] });
  const linhas = await delegado.findMany({ where: { AND }, orderBy: [{ [campoNome]: 'asc' }, { id: 'asc' }], take: limit + 1, select });
  const visiveis = linhas.slice(0, limit);
  const ultimo = visiveis[visiveis.length - 1];
  return {
    itens: await mapear(visiveis),
    has_more: linhas.length > limit,
    next_cursor: linhas.length > limit && ultimo ? codificarCursorOpcoes(ultimo[campoNome], ultimo.id) : null,
  };
};

// ─── anti-coerção dos decimais (A1) ─────────────────────────────────────────

/** Decimais do corpo do bem (POST/PATCH), por caminho. */
const DECIMAIS_DO_BEM = Object.freeze({
  topo: Object.freeze(['potencia_cv']),
  blocos: Object.freeze({
    medidor: Object.freeze(['leitura_inicial', 'leitura_atual']),
    aquisicao: Object.freeze(['valor_aquisicao', 'custo_incorporacao']),
    depreciacao: Object.freeze(['valor_residual', 'residual_percentual']),
  }),
  listas: Object.freeze({ medicoes: Object.freeze(['valor']), tanques: Object.freeze(['capacidade_litros']) }),
});
/** Decimais do corpo da prévia de depreciação (todos no topo). */
const DECIMAIS_DA_PREVIA = Object.freeze(['valor_aquisicao', 'custo_incorporacao', 'valor_residual', 'residual_percentual']);

const recusarNaoTexto = (obj, chave, caminho) => {
  if (!Object.prototype.hasOwnProperty.call(obj, chave)) return;
  const v = obj[chave];
  if (v !== null && v !== undefined && typeof v !== 'string') {
    throw new AppError('REQUEST_VALIDATION_FAILED', `${caminho} deve ser texto decimal (ex.: "1250.50"), nunca número`, {
      details: { field: caminho, reason: 'valor_deve_ser_texto', campo: caminho },
    });
  }
};
const ehObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * `preValidation` do plugin do Patrimônio (antes do AJV, que COERGE número em
 * string e deixaria o float corromper o valor): decimal presente e não-string
 * (e não null) → 400 `REQUEST_VALIDATION_FAILED` reason `valor_deve_ser_texto`,
 * `details.campo` = caminho (`medicoes[0].valor`, `aquisicao.valor_aquisicao`...).
 * Cobre o corpo do bem E o da prévia (as chaves não colidem).
 * @param {unknown} corpo
 */
export const recusarCoercaoPatrimonio = (corpo) => {
  if (!ehObjeto(corpo)) return;
  const c = /** @type {Record<string, any>} */ (corpo);
  for (const chave of DECIMAIS_DO_BEM.topo) recusarNaoTexto(c, chave, chave);
  for (const chave of DECIMAIS_DA_PREVIA) recusarNaoTexto(c, chave, chave);
  for (const [bloco, chaves] of Object.entries(DECIMAIS_DO_BEM.blocos)) {
    if (!ehObjeto(c[bloco])) continue;
    for (const chave of chaves) recusarNaoTexto(c[bloco], chave, `${bloco}.${chave}`);
  }
  for (const [lista, chaves] of Object.entries(DECIMAIS_DO_BEM.listas)) {
    if (!Array.isArray(c[lista])) continue;
    c[lista].forEach((item, i) => {
      if (!ehObjeto(item)) return;
      for (const chave of chaves) recusarNaoTexto(item, chave, `${lista}[${i}].${chave}`);
    });
  }
};

// ─── auditoria ──────────────────────────────────────────────────────────────

const comparavel = (v) => (v instanceof Date ? v.toISOString() : Array.isArray(v) ? JSON.stringify(v) : v && typeof v === 'object' ? String(v) : v ?? null);

/**
 * NOMES dos campos que mudaram (allowlist; nunca o conteúdo de texto livre).
 * Datas, listas e Decimal comparados pelo valor.
 * @param {Record<string, any>|null} antes
 * @param {Record<string, any>} depois
 * @param {readonly string[]} campos
 */
export const camposAlterados = (antes, depois, campos) => campos.filter((c) => comparavel(antes?.[c]) !== comparavel(depois?.[c]));
