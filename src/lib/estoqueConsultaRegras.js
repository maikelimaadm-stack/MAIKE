/**
 * Estoque — Saldo e Movimentos (D-PROD-255): rótulos e formatação das consultas.
 *
 * Os decimais vêm do servidor como TEXTO canônico ("150.0000"); nada aqui faz
 * aritmética de ponto flutuante. Quantidade na unidade de estoque do Produto (D-PROD-371: kg, L, SC, UN...).
 * Datas em DD/MM/AAAA, dinheiro em R$.
 */
import { formatarMoeda } from '@/lib/dinheiroDecimal';
import { formatarQuantidadeCurta } from '@/lib/abastecimentoRegras';
import { textoDaUnidadeDigitada } from '@/lib/unidadeLancamentoRegras';

/** Origem do movimento (`origem_sistema` do motor) → rótulo da tela. */
export const ROTULO_ORIGEM = Object.freeze(
  /** @type {Record<string, string>} */ ({
    operacao_financeira: 'Compra ou venda',
    abastecimento_patrimonio: 'Abastecimento',
    apontamento_atividade: 'Atividade',
    suplementacao: 'Suplementação',
    deposito: 'Transferência',
    entrada_estoque: 'Entrada de estoque',
    saida_estoque: 'Saída de estoque',
    ajuste_estoque: 'Ajuste de inventário',
    manual: 'Manual',
  }),
);

/** Opções do filtro "Origem" (a ordem é a da tela). */
export const OPCOES_ORIGEM = Object.freeze([
  { value: '', label: 'Todas as origens' },
  ...Object.entries(ROTULO_ORIGEM).map(([value, label]) => ({ value, label })),
]);

export const OPCOES_TIPO = Object.freeze([
  { value: '', label: 'Entradas e saídas' },
  { value: 'Entrada', label: 'Entradas' },
  { value: 'Saída', label: 'Saídas' },
]);

const ROTULO_DETALHADO = Object.freeze(
  /** @type {Record<string, string>} */ ({
    compra_financeiro: 'Compra',
    venda_financeiro: 'Venda',
    estorno_compra: 'Estorno da compra',
    estorno_venda: 'Estorno da venda',
    abastecimento_patrimonio: 'Abastecimento',
    estorno_abastecimento: 'Estorno do abastecimento',
    apontamento_atividade: 'Atividade',
    estorno_apontamento_atividade: 'Estorno da atividade',
    suplementacao: 'Suplementação',
    transferencia_enviada: 'Transferência (saída)',
    transferencia_recebida: 'Transferência (entrada)',
    // D-PROD-268
    estorno_suplementacao: 'Estorno do lançamento do cocho',
    estorno_transferencia_enviada: 'Estorno da transferência (volta à origem)',
    estorno_transferencia_recebida: 'Estorno da transferência (saída do destino)',
    estorno_entrada_revisao: 'Estorno da entrada (revisão)',
    estorno_entrada_exclusao: 'Estorno da entrada (exclusão)',
    saida_manual: 'Saída manual',
    estorno_saida_manual: 'Estorno da saída (exclusão)',
    ajuste_sobra: 'Ajuste: sobra',
    ajuste_falta: 'Ajuste: falta',
    estorno_ajuste_sobra: 'Estorno do ajuste (sobra)',
    estorno_ajuste_falta: 'Estorno do ajuste (falta)',
  }),
);

/** @param {{ tipo_detalhado?: string|null, origem_sistema?: string, tipo?: string }} m */
export const rotuloDoMovimento = (m) => {
  const d = m?.tipo_detalhado ?? '';
  if (ROTULO_DETALHADO[d]) return ROTULO_DETALHADO[d];
  if (d.startsWith('entrada_')) return 'Entrada de estoque';
  return ROTULO_ORIGEM[m?.origem_sistema ?? ''] ?? (m?.tipo === 'Saída' ? 'Saída' : 'Entrada');
};

/**
 * D-PROD-273 (fatia 2): o movimento excluído (original 'Estornada') e o estorno dele somem da lista; o filtro
 * "Mostrar excluídos" os traz de volta, marcados pelo servidor (`excluido`). Sem par completo, a situação de sempre.
 */
export const ROTULO_EXCLUIDO = "Excluído";
export const ROTULO_ESTORNO_DA_EXCLUSAO = "Estorno da exclusão";
export const OPCOES_EXCLUIDOS = Object.freeze([
  { value: "", label: "Não" },
  { value: "sim", label: "Sim" },
]);

/** Situação do movimento: Excluído / Estorno da exclusão (par excluído), Estornada, Estorno ou Ativa. @param {any} m */
export const rotuloSituacao = (m) => {
  if (m?.excluido === true) return m?.estorno ? ROTULO_ESTORNO_DA_EXCLUSAO : ROTULO_EXCLUIDO;
  return m?.status === "Estornada" ? "Estornada" : m?.estorno ? "Estorno" : "Ativa";
};

/** @param {string|null|undefined} dia AAAA-MM-DD → DD/MM/AAAA */
export const formatarDia = (dia) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dia ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/** @param {string|null|undefined} iso instante ISO → DD/MM/AAAA HH:MM (fuso do navegador) */
export const formatarInstante = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/**
 * "150" + "L" → "150 L"; "KG" → "kg". D-PROD-371: outra unidade de estoque sai com a sigla ("40 SC", "12 UN").
 * @param {unknown} v @param {unknown} unidade
 */
export const formatarQtd = (v, unidade) => {
  if (typeof v !== 'string') return '';
  const sigla = typeof unidade === 'string' ? unidade.trim().toUpperCase() : '';
  if (!sigla || sigla === 'KG' || sigla === 'L' || sigla === 'SACO') return formatarQuantidadeCurta(v, sigla || unidade);
  return `${formatarQuantidadeCurta(v, null)} ${sigla}`;
};

/** Sem o centavo quebrado: R$ 1.234,56; custo com até 4 casas. @param {unknown} v */
export const formatarReais = (v) => (typeof v === 'string' ? formatarMoeda(v, { casas: 2 }) : '');
/** @param {unknown} v */
export const formatarCustoUnitario = (v) => (typeof v === 'string' ? formatarMoeda(v, { casas: 2, casasMax: 4 }) : '');

/** Quantidade do movimento com sinal: entrada "+", saída "−". @param {any} m */
export const quantidadeComSinal = (m) => {
  const q = formatarQtd(m?.quantidade, m?.unidade);
  if (!q) return '';
  return m?.tipo === 'Saída' ? `− ${q}` : `+ ${q}`;
};

/**
 * D-PROD-313 — a quantidade com sinal e, quando foi digitada numa unidade de conversão (D-PROD-310), a digitada entre
 * parênteses: "− 75 kg (3 SC)". Sem conversão, igual a `quantidadeComSinal`.
 * @param {any} m
 */
export const quantidadeComDigitada = (m) => {
  const q = quantidadeComSinal(m);
  const digitada = textoDaUnidadeDigitada(m);
  return q && digitada ? `${q} (${digitada})` : q;
};

/** Depósito do movimento: "origem → destino", ou o único que existe. @param {any} m */
export const depositoDoMovimento = (m) => {
  const o = m?.local_origem ?? '';
  const d = m?.local_destino ?? '';
  if (o && d && o !== d) return `${o} → ${d}`;
  return o || d || '';
};

/** @param {string|null|undefined} dia AAAA-MM-DD ou vazio */
export const ehDia = (dia) => typeof dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dia);

/**
 * D-PROD-382 — o documento do ESTOQUE por trás de uma linha de Movimentos (a entrada, a saída manual ou o ajuste), para
 * as ações do ⚡ da linha (Editar, Duplicar, Excluir). O motor grava o id do documento em `lancamento_origem_id`.
 * Movimento de outra origem (atividade, cocho, financeiro, transferência, abastecimento), estorno ou já excluído: `null`
 * — esse se corrige no lançamento de origem.
 * @param {any} m a linha da lista
 * @returns {{ tipo: 'entrada'|'saida'|'ajuste', id: string } | null}
 */
export const documentoDaLinha = (m) => {
  if (!m || m.excluido === true || m.estorno === true) return null;
  const id = typeof m.lancamento_origem_id === 'string' ? m.lancamento_origem_id : '';
  if (!id) return null;
  if (m.origem_sistema === 'entrada_estoque') return { tipo: 'entrada', id };
  if (m.origem_sistema === 'saida_estoque') return { tipo: 'saida', id };
  if (m.origem_sistema === 'ajuste_estoque') return { tipo: 'ajuste', id };
  return null;
};
