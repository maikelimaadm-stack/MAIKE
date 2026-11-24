/**
 * D-PROD-282 — regras de TELA da escolha de lote (produto que controla lote): a sugestão FEFO (a mesma do servidor,
 * que já devolve os lotes nessa ordem), a divisão entre lotes, o aviso de vencido e o corpo `lotes` da linha.
 * Sem cálculo de custo: o servidor valoriza cada fatia pelo custo da camada.
 */
import { LIMITES_ENTRADA, LOCALE_ENTRADA } from './estoqueEntradasRegras.js';
import { lerNumeroLocal } from '@/lib/dinheiroDecimal';

/** Dias de antecedência do aviso "vence em N dias" (o mesmo do servidor). */
export const DIAS_AVISO_VENCIMENTO = 30;

const num = (/** @type {unknown} */ v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const q4 = (/** @type {number} */ n) => Math.round(n * 10000) / 10000;

/** AAAA-MM-DD → dd/mm. @param {string|null|undefined} dia */
export const diaMes = (dia) => (dia && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}` : '');

/** Texto do aviso do lote (vencido ou vencendo em até 30 dias); vazio sem aviso. @param {any} lote */
export const avisoDoLote = (lote) => {
  if (!lote?.data_validade) return '';
  if (lote.vencido) return `Lote vencido em ${diaMes(lote.data_validade)}`;
  if (Number.isInteger(lote.vence_em_dias) && lote.vence_em_dias <= DIAS_AVISO_VENCIMENTO) {
    return lote.vence_em_dias === 0 ? 'Vence hoje' : `Vence em ${lote.vence_em_dias} dia${lote.vence_em_dias === 1 ? '' : 's'}`;
  }
  return '';
};

/**
 * Sugestão FEFO: consome `quantidade` (na unidade de estoque) dos lotes na ordem recebida (o servidor já ordena).
 * @param {any[]} lotes @param {number} quantidade
 * @returns {{ fatias: Array<{ id: string, quantidade: number }>, suficiente: boolean }}
 */
export const sugestaoFefo = (lotes, quantidade) => {
  const fatias = [];
  let resta = q4(quantidade);
  for (const l of lotes ?? []) {
    if (resta <= 0) break;
    const disp = num(l.quantidade_disponivel);
    if (disp <= 0) continue;
    const q = q4(Math.min(disp, resta));
    fatias.push({ id: l.id, quantidade: q });
    resta = q4(resta - q);
  }
  return { fatias, suficiente: resta <= 0 };
};

/** Quantidade da linha na unidade de ESTOQUE (SACO → kg pelo peso do saco). @param {any} linha */
export const quantidadeDeEstoque = (linha) => {
  const r = lerNumeroLocal(linha?.quantidade, LOCALE_ENTRADA, LIMITES_ENTRADA);
  if (!r.ok) return 0;
  const q = num(r.valor);
  return linha?.unidade === 'SACO' ? q4(q * num(linha?.produto?.peso_por_saco_kg)) : q;
};

/**
 * Confere a escolha (`escolha`: null = FEFO; [{ id, quantidade: texto }] = manual) contra a quantidade `total` (na
 * unidade de estoque); devolve o erro em português ou ''. Sem escolha manual, confere só se a sugestão cobre o total.
 * É a regra de qualquer tela que tira produto com lote do estoque (Saída, cocho, financeiro, atividade, abastecimento).
 * @param {Array<{ id: string, quantidade: string }>|null|undefined} escolha @param {number} total @param {any[]} lotes disponíveis
 */
export const erroDaEscolha = (escolha, total, lotes) => {
  if (!(total > 0)) return '';
  if (!Array.isArray(escolha)) return sugestaoFefo(lotes, total).suficiente ? '' : 'Saldo dos lotes insuficiente neste depósito.';
  let soma = 0;
  for (const f of escolha) {
    const r = lerNumeroLocal(f.quantidade, LOCALE_ENTRADA, LIMITES_ENTRADA);
    if (!r.ok) return 'Quantidade de lote inválida.';
    const l = (lotes ?? []).find((x) => x.id === f.id);
    if (l && num(r.valor) > num(l.quantidade_disponivel)) return `O lote ${l.lote_fabricante ?? ''} não tem essa quantidade.`;
    soma = q4(soma + num(r.valor));
  }
  return soma === q4(total) ? '' : 'A soma dos lotes tem de ser a quantidade da linha.';
};

/**
 * Confere a escolha manual da linha do Estoque (`linha.lotes`) contra a quantidade da linha; '' sem erro.
 * @param {any} linha @param {any[]} lotes disponíveis
 */
export const erroDosLotes = (linha, lotes) => {
  if (!linha?.produto?.controla_lote) return '';
  return erroDaEscolha(linha.lotes, quantidadeDeEstoque(linha), lotes);
};

/** Os lotes que a escolha vai usar (a manual ou a sugestão FEFO de `total`). @param {any} escolha @param {number} total @param {any[]} lotes */
export const lotesUsadosNaEscolha = (escolha, total, lotes) => {
  if (Array.isArray(escolha)) return escolha.map((f) => (lotes ?? []).find((l) => l.id === f.id)).filter(Boolean);
  return sugestaoFefo(lotes, total).fatias.map((f) => (lotes ?? []).find((l) => l.id === f.id)).filter(Boolean);
};

/** Os lotes que a linha vai usar (a escolha manual ou a sugestão FEFO). @param {any} linha @param {any[]} lotes */
export const lotesUsados = (linha, lotes) => lotesUsadosNaEscolha(linha?.lotes, quantidadeDeEstoque(linha), lotes);

/** Algum lote usado pela escolha está vencido (a tela pede confirmação). @param {any} escolha @param {number} total @param {any[]} lotes */
export const usaLoteVencidoNaEscolha = (escolha, total, lotes) => lotesUsadosNaEscolha(escolha, total, lotes).some((l) => l.vencido);

/** Algum lote usado está vencido (a tela pede confirmação). @param {any} linha @param {any[]} lotes */
export const usaLoteVencido = (linha, lotes) => lotesUsados(linha, lotes).some((l) => l.vencido);

/**
 * Lista `lotes` do corpo HTTP a partir da escolha manual (quantidades com ponto; zeradas saem). Sem escolha manual,
 * `null`: o servidor aplica o FEFO.
 * @param {Array<{ id: string, quantidade: string }>|null|undefined} escolha
 * @returns {Array<{ estoque_lote_nota_id: string, quantidade: string }>|null}
 */
export const corpoDaEscolha = (escolha) => {
  if (!Array.isArray(escolha)) return null;
  return escolha
    .map((f) => ({ estoque_lote_nota_id: f.id, quantidade: /** @type {any} */ (lerNumeroLocal(f.quantidade, LOCALE_ENTRADA, LIMITES_ENTRADA)).valor }))
    .filter((f) => f.quantidade && !/^0(\.0*)?$/.test(f.quantidade));
};

/** Corpo `lotes` da linha (só com escolha manual; sem ela, o servidor aplica o FEFO). @param {any} linha */
export const corpoDosLotes = (linha) => {
  if (!linha?.produto?.controla_lote || !Array.isArray(linha.lotes)) return {};
  return { lotes: /** @type {any[]} */ (corpoDaEscolha(linha.lotes)) };
};

/**
 * Pendência da escolha de lote para o formulário bloquear o envio ('' sem pendência): o erro dos lotes (que o campo
 * devolve) ou o vencido sem confirmação. Produto sem lote: nunca pendente.
 * @param {{ produto?: any, erroLote?: string, loteVencido?: boolean, confirmaVencido?: boolean }} estado
 */
export const pendenciaDoLote = ({ produto, erroLote, loteVencido, confirmaVencido }) => {
  if (!produto?.controla_lote) return '';
  if (erroLote) return erroLote;
  if (loteVencido && confirmaVencido !== true) return 'Confirme o uso do lote vencido.';
  return '';
};
