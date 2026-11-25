/**
 * D-PROD-282 — regras de TELA da escolha de lote (produto que controla lote): a sugestão FEFO (a mesma do servidor,
 * que já devolve os lotes nessa ordem), a divisão entre lotes, o aviso de vencido e o corpo `lotes` da linha.
 * Sem cálculo de custo: o servidor valoriza cada fatia pelo custo da camada.
 */
// Só imports relativos e sem efeitos de tela: as regras de abastecimento e de atividade (que o backend também carrega,
// nos testes de contrato da tela) importam este módulo direto pelo Node, sem o alias `@/`.
import { lerNumeroLocal } from './dinheiroDecimal.js';

/** Locale e limites das quantidades de lote: os mesmos da Entrada (`estoqueEntradasRegras`: pt-BR, 10 inteiros e 4 casas). */
const LOCALE_ENTRADA = 'pt-BR';
const LIMITES_ENTRADA = Object.freeze({ inteiros: 10, casas: 4 });

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

/**
 * `lotes_por_item` da confirmação do lançamento financeiro e a primeira pendência ('' sem pendência). Só os efeitos
 * de estoque de produto que controla lote (`controla_lote` da prévia) entram:
 *  - compra (PAGAR): `lote_fabricante` obrigatório (aparado, até 64) e `data_validade` obrigatória se o produto
 *    controla validade (opcional nos demais; vai só quando informada);
 *  - venda (RECEBER): a escolha do `CampoLotes` (`lotes` só com escolha manual; sem ela, o servidor aplica o FEFO),
 *    com a soma conferida e o vencido confirmado.
 * `estado` por `item_ordem`: compra `{ lote, validade }`; venda `{ lotes, confirmaVencido, loteVencido, erroLote }`.
 * @param {string} direcao @param {any[]} efeitos @param {Record<string|number, any>} estado
 * @returns {{ lotes_por_item: Array<Record<string, unknown>>, pendencia: string }}
 */
export const lotesDaConfirmacao = (direcao, efeitos, estado) => {
  /** @type {Array<Record<string, unknown>>} */
  const lotesPorItem = [];
  /** @type {string[]} */
  const pendencias = [];
  for (const e of efeitos ?? []) {
    if (!e?.controla_lote) continue;
    const n = e.item_ordem;
    const s = estado?.[n] ?? {};
    if (direcao === 'PAGAR') {
      const lote = String(s.lote ?? '').trim();
      const validade = String(s.validade ?? '');
      if (!lote) pendencias.push(`Item ${n}: informe o lote do fabricante.`);
      else if (lote.length > 64) pendencias.push(`Item ${n}: o lote tem no máximo 64 caracteres.`);
      else if (e.controla_validade && !validade) pendencias.push(`Item ${n}: informe a validade.`);
      else lotesPorItem.push({ item_ordem: n, lote_fabricante: lote, ...(validade ? { data_validade: validade } : {}) });
      continue;
    }
    const pendencia = pendenciaDoLote({ produto: { controla_lote: true }, ...s });
    if (pendencia) {
      pendencias.push(`Item ${n}: ${pendencia}`);
      continue;
    }
    const corpo = corpoDaEscolha(s.lotes);
    if (corpo && corpo.length) lotesPorItem.push({ item_ordem: n, lotes: corpo });
  }
  return { lotes_por_item: lotesPorItem, pendencia: pendencias[0] ?? '' };
};

/** Estado inicial da escolha de lote de uma tela (FEFO, sem confirmação, sem erro). */
export const ESCOLHA_LOTE_INICIAL = Object.freeze({ lotes: null, confirmaVencido: false, loteVencido: false, erroLote: '' });

/** AAAA-MM-DD → dd/mm/aaaa. @param {string|null|undefined} dia */
const diaMesAno = (dia) => (dia && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}` : '');

/**
 * Texto do alerta quando a resposta de uma saída traz `avisos: [{ tipo: 'lote_vencido', lote, validade }]` (o
 * servidor nunca recusa o vencido; só avisa). '' sem aviso de vencido. Um texto só para vários lotes.
 * @param {Array<{ tipo?: string, lote?: string|null, validade?: string }>|null|undefined} avisos
 */
export const mensagemDeLoteVencido = (avisos) => {
  const vencidos = (Array.isArray(avisos) ? avisos : []).filter((a) => a?.tipo === 'lote_vencido');
  if (!vencidos.length) return '';
  const partes = vencidos.map((a) => `${a.lote ?? 'sem lote'} (venceu em ${diaMesAno(a.validade)})`);
  return `Saiu de lote vencido: ${partes.join(', ')}.`;
};
