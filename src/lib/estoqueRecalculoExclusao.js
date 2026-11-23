/**
 * D-PROD-273 (fatia 4) — exclusão com recálculo, na tela: o resumo da PRÉVIA
 * (`GET /estoque/movimentos/:id/exclusao/previa`) que as janelas de exclusão mostram antes de confirmar, e as
 * mensagens claras das recusas do recálculo (iguais em todas as origens: saída manual, cocho, atividade,
 * abastecimento e venda). Puro: sem React e sem rede.
 */
import { lerErroGestao, mensagemRecalculoDaExclusao } from '@/lib/gestaoErros';
import { formatarMoeda } from '@/lib/dinheiroDecimal';

const NADA = 'Nada foi alterado.';

/** Códigos do recálculo (o servidor recusa antes de gravar qualquer coisa). */
export const CODIGOS_RECALCULO = Object.freeze(['ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL', 'ESTOQUE_EXCLUSAO_SALDO_NEGATIVO', 'ESTOQUE_RECALCULO_VOLUME_EXCEDIDO']);

/**
 * Mensagem da recusa do recálculo, ou null quando o erro é de outro tipo.
 * @param {unknown} erro
 * @returns {string|null}
 */
export const mensagemRecusaRecalculo = (erro) => {
  const { code, reason, details } = lerErroGestao(erro);
  return mensagemRecalculoDaExclusao(code, reason, details);
};

/** @param {unknown} v */
const reais = (v) => (typeof v === 'string' && v !== '' ? formatarMoeda(v, { casas: 2 }) : '—');

const ROTULO_TIPO = /** @type {Record<string, string>} */ ({
  suplementacao: 'Cocho',
  saida_manual: 'Saída manual',
  venda_financeiro: 'Venda',
  transferencia_enviada: 'Transferência (saída)',
  transferencia_recebida: 'Transferência (entrada)',
});
const rotuloDoMovimento = (m) => {
  if (ROTULO_TIPO[m?.tipo_detalhado]) return ROTULO_TIPO[m.tipo_detalhado];
  if (m?.origem_sistema === 'abastecimento_patrimonio') return 'Abastecimento';
  if (m?.origem_sistema === 'apontamento_atividade') return 'Atividade';
  if (typeof m?.tipo_detalhado === 'string' && m.tipo_detalhado.startsWith('estorno_')) return 'Estorno';
  return m?.tipo === 'Entrada' ? 'Entrada' : 'Saída';
};

/**
 * Resumo das prévias (uma por movimento a excluir) para a janela:
 *  - `exato`: nada foi lançado depois que mude de custo — o estorno devolve o valor exato;
 *  - `recalcula`: X movimentos posteriores terão o custo recalculado (`linhas`: antes → depois, só os que mudam de valor);
 *  - `recusa`: o servidor vai recusar (mensagem clara).
 * @param {any[]} previas respostas da prévia
 * @param {{ maxLinhas?: number }} [o]
 */
export const resumoDaPrevia = (previas, o = {}) => {
  const lista = (Array.isArray(previas) ? previas : []).filter(Boolean);
  const recusada = lista.find((p) => p.permitido === false);
  if (recusada) {
    const r = recusada.recusa ?? {};
    return { estado: 'recusa', mensagem: mensagemRecusaRecalculo({ code: r.code, details: r }) ?? `A exclusão não é possível. ${NADA}`, posteriores: 0, linhas: [], mais: 0 };
  }
  const excluidos = new Set(lista.flatMap((p) => p.excluidos ?? []));
  /** @type {Map<string, any>} */
  const porId = new Map();
  for (const p of lista) for (const m of p.movimentos ?? []) if (!excluidos.has(m.id) && m.antes?.valor_total !== m.depois?.valor_total) porId.set(m.id, m);
  const mudam = [...porId.values()].sort((a, b) => Number(a.numero) - Number(b.numero));
  const posteriores = Math.max(0, ...lista.map((p) => Number(p.movimentos_posteriores) || 0));
  if (!mudam.length) return { estado: 'exato', mensagem: posteriores ? 'Os movimentos lançados depois não mudam de custo.' : 'Nada foi lançado depois: o estorno devolve o valor exato.', posteriores, linhas: [], mais: 0 };
  const max = o.maxLinhas ?? 5;
  const linhas = mudam.slice(0, max).map((m) => ({ id: m.id, numero: m.numero, tipo: rotuloDoMovimento(m), antes: reais(m.antes?.valor_total), depois: reais(m.depois?.valor_total) }));
  const n = mudam.length;
  return {
    estado: 'recalcula',
    mensagem: `${n} ${n === 1 ? 'movimento posterior terá' : 'movimentos posteriores terão'} o custo recalculado.`,
    posteriores, linhas, mais: Math.max(0, n - max),
  };
};
