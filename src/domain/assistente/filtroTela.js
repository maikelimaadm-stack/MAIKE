/**
 * Filtro de tela pedido pelo Assistente (D-PROD-230) — contrato de URL no cliente.
 *
 * O assistente devolve uma ação `{ tela, filtros }`; o botão do balão navega para
 * `/<tela minúscula>?af=<JSON dos filtros>` e a tela lê o parâmetro, valida e aplica
 * sobre os dados que já mostra. Espelho de backend/src/modules/assistente/assistenteAcoes.js:
 * as chaves aceitas aqui são as mesmas (o teste de fumaça confere). Chave desconhecida ou
 * valor fora do formato é ignorado; nada daqui chega ao servidor.
 */
import { createPageUrl } from '@/utils';

export const PARAMETRO_FILTRO = 'af';

const NOMES = 'nomes';
const NUMERO = 'numero';

/** @type {Readonly<Record<string, Readonly<Record<string, string | readonly string[]>>>>} */
export const CHAVES_POR_TELA = Object.freeze({
  MapaGeral: Object.freeze({
    setores: NOMES,
    tipos_cultura: Object.freeze(['Pastagem', 'Agricultura', 'Reserva', 'APP', 'Infraestrutura']),
    tipos_pastagem: NOMES,
    categorias: NOMES,
    sistemas: NOMES,
    peso_min: NUMERO,
    peso_max: NUMERO,
    colorir_por: Object.freeze(['padrao', 'tipo_cultura', 'aproveitamento', 'ocupacao', 'categoria_gado', 'tipo_pastagem', 'ua_ha', 'situacao_pasto', 'forragem']),
  }),
  CadastroLotes: Object.freeze({
    status: Object.freeze(['Ativo', 'Inativo']),
    categorias_manejo: NOMES,
    categorias: NOMES,
    sexos: NOMES,
    setores: NOMES,
    areas: NOMES,
    peso_min: NUMERO,
    peso_max: NUMERO,
    cabecas_min: NUMERO,
    cabecas_max: NUMERO,
  }),
});

export const TELAS_COM_FILTRO = Object.freeze(Object.keys(CHAVES_POR_TELA));

/** Chave → lista de valores únicos (tipos_cultura é lista de opções fechadas). */
const CHAVES_LISTA_FECHADA = new Set(['tipos_cultura']);

/**
 * Filtros válidos para a tela (o resto é descartado em silêncio).
 * @param {string} tela @param {unknown} bruto
 * @returns {Record<string, any>}
 */
export const validarFiltroTela = (tela, bruto) => {
  const regras = CHAVES_POR_TELA[tela];
  /** @type {Record<string, any>} */
  const out = {};
  if (!regras || !bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return out;
  for (const [chave, valor] of Object.entries(/** @type {Record<string, unknown>} */ (bruto))) {
    const regra = regras[chave];
    if (!regra) continue;
    if (regra === NUMERO) {
      if (typeof valor === 'number' && Number.isFinite(valor) && valor >= 0 && valor <= 100000) out[chave] = valor;
    } else if (regra === NOMES || CHAVES_LISTA_FECHADA.has(chave)) {
      if (!Array.isArray(valor)) continue;
      const lista = [...new Set(valor.filter((v) => typeof v === 'string').map((v) => v.trim()).filter((v) => v && v.length <= 120))].slice(0, 50);
      const aceitos = Array.isArray(regra) ? lista.filter((v) => regra.includes(v)) : lista;
      if (aceitos.length) out[chave] = aceitos;
    } else if (Array.isArray(regra) && typeof valor === 'string' && regra.includes(valor)) {
      out[chave] = valor;
    }
  }
  return out;
};

/** URL da tela com o filtro. Filtros vazios = limpar. @param {{ tela: string, filtros?: Record<string, any> }} acao */
export const urlDoFiltro = (acao) => {
  const filtros = validarFiltroTela(acao.tela, acao.filtros ?? {});
  return `${createPageUrl(acao.tela)}?${PARAMETRO_FILTRO}=${encodeURIComponent(JSON.stringify(filtros))}`;
};

/**
 * Lê o filtro da URL. `null` = não há pedido; `{}` = pedido para limpar.
 * @param {string} search location.search @param {string} tela
 * @returns {Record<string, any> | null}
 */
export const lerFiltroDaUrl = (search, tela) => {
  let bruto;
  try {
    bruto = new URLSearchParams(search || '').get(PARAMETRO_FILTRO);
  } catch {
    return null;
  }
  if (bruto === null) return null;
  try {
    return validarFiltroTela(tela, JSON.parse(bruto));
  } catch {
    return {};
  }
};

/** A URL sem o parâmetro do assistente (para não reaplicar ao recarregar). @param {string} search */
export const searchSemFiltro = (search) => {
  const p = new URLSearchParams(search || '');
  p.delete(PARAMETRO_FILTRO);
  const resto = p.toString();
  return resto ? `?${resto}` : '';
};

/** Comparação sem acento e sem caixa. @param {unknown} s */
export const normalizarNome = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/**
 * Casa os nomes pedidos com as opções da tela. Devolve os valores da tela que casaram e
 * os nomes que não casaram com nada.
 * @template T
 * @param {string[] | undefined} pedidos
 * @param {T[]} opcoes
 * @param {(o: T) => unknown} nomeDe
 * @param {(o: T) => any} [valorDe]
 */
export const casarNomes = (pedidos, opcoes, nomeDe, valorDe = (o) => o) => {
  if (!pedidos?.length) return { valores: [], faltando: [] };
  const valores = [];
  const faltando = [];
  for (const pedido of pedidos) {
    const alvo = normalizarNome(pedido);
    const achados = opcoes.filter((o) => normalizarNome(nomeDe(o)) === alvo);
    if (!achados.length) faltando.push(pedido);
    for (const o of achados) {
      const v = valorDe(o);
      if (!valores.includes(v)) valores.push(v);
    }
  }
  return { valores, faltando };
};

/** Evento que avisa a tela já aberta que a URL ganhou um filtro do assistente. */
export const EVENTO_FILTRO_ASSISTENTE = 'maike:filtro-assistente';

export const avisarFiltroDoAssistente = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_FILTRO_ASSISTENTE));
};
