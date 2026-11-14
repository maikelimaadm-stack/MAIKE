/**
 * Service do cadastro de Formulações de suplemento da fazenda (D-PROD-202,
 * etapa 2a da suplementação), tabelas CADFORMULACAO, CADFORMULACAOINGREDIENTE
 * e CADFORMULACAOREGRA.
 *
 * Uma formulação é PRONTO (produto comprado pronto, ex.: sal mineral) ou
 * BATELADA (mistura feita na fazenda com produtos do estoque, com os
 * ingredientes em kg POR BATIDA). O produto é sempre o que vai ao cocho: o
 * próprio produto pronto, ou o produto misturado, cadastrado antes em Produtos.
 * Consumo alvo em %PV padrão, com exceção opcional por Categoria de Manejo (não
 * consome, ou consome com %PV próprio). A validação aqui espelha a do servidor;
 * o servidor é quem decide. A produção da batelada (estoque) é a etapa 2b.
 */

import { listFormulacoes, createFormulacao, updateFormulacao, deleteFormulacao } from '@/apis/formulacoes';
import { API_ERROR_CODES } from '@/apis/_core/ApiError';

export const TIPOS_FORMULACAO = Object.freeze([
  Object.freeze({ valor: 'PRONTO', rotulo: 'Produto pronto' }),
  Object.freeze({ valor: 'BATELADA', rotulo: 'Batelada' }),
]);
/** Raiz da chave das formulações ATIVAS do lançamento de suplementação: gravar no cadastro a invalida. */
export const QUERY_FORMULACOES_LANCAMENTO = 'formulacoes-opcoes-lancamento';
/** %PV máximo aceito (padrão e da regra), como no servidor. */
export const PV_MAXIMO = 5;

/** @param {unknown} tipo */
export const rotuloDoTipo = (tipo) => TIPOS_FORMULACAO.find((t) => t.valor === tipo)?.rotulo ?? '';

/**
 * Texto digitado (vírgula ou ponto decimal; "1.000" e "1.250,5" são milhar) → número com até
 * `casas` casas, maior que zero e até `maximo`. `null` quando não é válido;
 * `undefined` quando vazio.
 * @param {unknown} texto
 * @param {{ casas: number, maximo?: number }} regra
 * @returns {number | null | undefined}
 */
export const lerDecimal = (texto, { casas, maximo }) => {
  if (typeof texto === 'number') return lerDecimal(String(texto), { casas, maximo });
  const t = String(texto ?? '').trim();
  if (!t) return undefined;
  // Milhar pt-BR ("1.000", "1.250,5") é milhar, não decimal: "1.000" kg na batida é mil quilos.
  const normal = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(',', '.');
  if (!new RegExp(`^\\d+(\\.\\d{1,${casas}})?$`).test(normal)) return null;
  const n = Number(normal);
  if (!Number.isFinite(n) || n <= 0 || (maximo !== undefined && n > maximo)) return null;
  return Number(n.toFixed(casas));
};

/** %PV (0, 5], até 4 casas. @param {unknown} texto */
export const lerPercentualPV = (texto) => lerDecimal(texto, { casas: 4, maximo: PV_MAXIMO });
/** kg por batida, > 0, até 3 casas. @param {unknown} texto */
export const lerKg = (texto) => lerDecimal(texto, { casas: 3 });
/** Consumo objetivo (g/cab/dia), > 0, até 2 casas. @param {unknown} texto */
export const lerGramas = (texto) => lerDecimal(texto, { casas: 2 });

/**
 * Número → texto com vírgula ("0,15"; "1.000"). Vazio sem valor.
 * @param {unknown} valor
 * @param {{ casasMin?: number, casasMax?: number }} [opcoes]
 */
export const formatarNumero = (valor, opcoes = {}) => {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return '';
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: opcoes.casasMin ?? 0, maximumFractionDigits: opcoes.casasMax ?? 4 });
};

/**
 * Total da batida e o percentual de cada ingrediente, a partir dos textos do
 * formulário (ou dos números da API). Soma em gramas inteiras: sem ruído de
 * ponto flutuante. Ingrediente sem kg válido conta 0 e fica com `percentual` null.
 * @param {Array<{ quantidade_kg?: unknown }>} ingredientes
 * @returns {{ totalKg: number, percentuais: Array<number | null> }}
 */
export const resumoDaBatida = (ingredientes) => {
  const gramas = (ingredientes || []).map((i) => {
    const kg = lerKg(i?.quantidade_kg);
    return typeof kg === 'number' ? Math.round(kg * 1000) : null;
  });
  const total = gramas.reduce((s, g) => s + (g ?? 0), 0);
  return {
    totalKg: total / 1000,
    percentuais: gramas.map((g) => (g === null || total <= 0 ? null : Number(((g / total) * 100).toFixed(2)))),
  };
};

/**
 * @typedef {{ produto_id: string, quantidade_kg: string }} IngredienteForm
 * @typedef {{ categoria_manejo_id: string, consome: boolean, percentual_pv: string }} RegraForm
 * @typedef {{
 *   nome: string, tipo: string, produto_id: string, percentual_pv_padrao: string,
 *   consumo_objetivo_g_cab_dia: string, observacoes: string, ativo: boolean,
 *   ingredientes: IngredienteForm[], regras: RegraForm[],
 * }} FormulacaoForm
 */

/**
 * Valida o formulário como o servidor e monta o corpo. `erros` é um mapa
 * campo → mensagem (`ingredientes.0.quantidade_kg`, `regras.1.percentual_pv`…).
 * PRONTO envia `ingredientes: []` (a troca de BATELADA para PRONTO esvazia a lista).
 * @param {FormulacaoForm} f
 * @returns {{ erros: Record<string, string>, corpo: Record<string, unknown> | null }}
 */
export const validarFormulacao = (f) => {
  /** @type {Record<string, string>} */
  const erros = {};
  const nome = String(f.nome || '').trim().toUpperCase();
  if (!nome) erros.nome = 'Obrigatório';
  if (!TIPOS_FORMULACAO.some((t) => t.valor === f.tipo)) erros.tipo = 'Obrigatório';
  if (!f.produto_id) erros.produto_id = 'Obrigatório';
  const pv = lerPercentualPV(f.percentual_pv_padrao);
  if (pv === undefined) erros.percentual_pv_padrao = 'Obrigatório';
  else if (pv === null) erros.percentual_pv_padrao = `De 0 a ${PV_MAXIMO}%, até 4 casas`;
  const gramas = lerGramas(f.consumo_objetivo_g_cab_dia);
  if (gramas === null) erros.consumo_objetivo_g_cab_dia = 'Maior que 0, até 2 casas';

  const batelada = f.tipo === 'BATELADA';
  const ingredientes = batelada ? f.ingredientes || [] : [];
  if (batelada && ingredientes.length === 0) erros.ingredientes = 'A batelada precisa de pelo menos 1 ingrediente';
  const vistosProdutos = new Set();
  const corpoIngredientes = ingredientes.map((i, n) => {
    if (!i.produto_id) erros[`ingredientes.${n}.produto_id`] = 'Obrigatório';
    else if (vistosProdutos.has(i.produto_id)) erros[`ingredientes.${n}.produto_id`] = 'Produto repetido';
    else if (i.produto_id === f.produto_id) erros[`ingredientes.${n}.produto_id`] = 'É o próprio produto misturado';
    vistosProdutos.add(i.produto_id);
    const kg = lerKg(i.quantidade_kg);
    if (typeof kg !== 'number') erros[`ingredientes.${n}.quantidade_kg`] = 'kg maior que 0, até 3 casas';
    return { produto_id: i.produto_id, quantidade_kg: kg };
  });

  const vistasCategorias = new Set();
  const corpoRegras = (f.regras || []).map((r, n) => {
    if (!r.categoria_manejo_id) erros[`regras.${n}.categoria_manejo_id`] = 'Obrigatório';
    else if (vistasCategorias.has(r.categoria_manejo_id)) erros[`regras.${n}.categoria_manejo_id`] = 'Categoria repetida';
    vistasCategorias.add(r.categoria_manejo_id);
    if (!r.consome) return { categoria_manejo_id: r.categoria_manejo_id, consome: false, percentual_pv: null };
    const pvRegra = lerPercentualPV(r.percentual_pv);
    if (typeof pvRegra !== 'number') erros[`regras.${n}.percentual_pv`] = `De 0 a ${PV_MAXIMO}%, até 4 casas`;
    return { categoria_manejo_id: r.categoria_manejo_id, consome: true, percentual_pv: pvRegra };
  });

  if (Object.keys(erros).length) return { erros, corpo: null };
  const observacoes = String(f.observacoes || '').trim().toUpperCase();
  return {
    erros,
    corpo: {
      nome,
      tipo: f.tipo,
      produto_id: f.produto_id,
      percentual_pv_padrao: pv,
      consumo_objetivo_g_cab_dia: gramas ?? null,
      observacoes: observacoes || null,
      ativo: f.ativo !== false,
      ingredientes: corpoIngredientes,
      regras: corpoRegras,
    },
  };
};

/** @param {string} empresaId */
export const listarFormulacoes = (empresaId) => listFormulacoes(empresaId);

/** @param {Record<string, unknown>} dados @param {{ empresaId: string }} escopo */
export const criarFormulacao = (dados, { empresaId }) => createFormulacao({ ...dados, empresa_id: empresaId });

/** @param {{ id: string, dados: Record<string, unknown>, empresaId: string }} p */
export const atualizarFormulacao = ({ id, dados, empresaId }) => updateFormulacao(id, { ...dados, empresa_id: empresaId });

/**
 * Frase do 409 `FORMULACAO_EM_USO`, com quantos lançamentos a citam.
 * @param {unknown} lancamentos
 */
export const mensagemFormulacaoEmUso = (lancamentos) => {
  const n = Number(lancamentos);
  return Number.isInteger(n) && n > 0
    ? `Esta formulação já foi usada em ${n} lançamento(s) de suplementação e não pode ser excluída. Inative-a.`
    : 'Esta formulação já foi usada em lançamento(s) de suplementação e não pode ser excluída. Inative-a.';
};

/**
 * Aviso das formulações não excluídas.
 * @param {{ id: string, code: string, lancamentos?: number }[]} bloqueados
 */
export const mensagemExclusaoBloqueada = (bloqueados) => {
  const emUso = bloqueados.filter((b) => b.code === API_ERROR_CODES.FORMULACAO_EM_USO);
  if (bloqueados.length === 1) {
    return emUso.length ? mensagemFormulacaoEmUso(emUso[0].lancamentos) : '1 formulação não pôde ser excluída.';
  }
  const total = `${bloqueados.length} formulações não puderam ser excluídas.`;
  if (!emUso.length) return total;
  return `${total} ${emUso.length === 1 ? '1 já foi usada' : `${emUso.length} já foram usadas`} em lançamentos de suplementação: inative-as.`;
};

/**
 * @param {string | string[]} ids
 * @param {{ empresaId: string }} escopo
 * @returns {Promise<{ excluidos: string[], bloqueados: { id: string, code: string, lancamentos?: number }[] }>}
 */
export const excluirFormulacoes = async (ids, { empresaId }) => {
  /** @type {string[]} */
  const excluidos = [];
  /** @type {{ id: string, code: string, lancamentos?: number }[]} */
  const bloqueados = [];
  for (const id of Array.isArray(ids) ? ids : [ids]) {
    try {
      await deleteFormulacao(id, empresaId);
      excluidos.push(id);
    } catch (erro) {
      const e = /** @type {{ code?: string, details?: { lancamentos?: unknown } }} */ (erro);
      const code = e?.code ?? API_ERROR_CODES.OPERATION_FAILED;
      const lancamentos = Number(e?.details?.lancamentos);
      bloqueados.push(
        code === API_ERROR_CODES.FORMULACAO_EM_USO && Number.isInteger(lancamentos) && lancamentos > 0 ? { id, code, lancamentos } : { id, code },
      );
    }
  }
  return { excluidos, bloqueados };
};
