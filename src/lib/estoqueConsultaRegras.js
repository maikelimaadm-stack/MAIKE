/**
 * Estoque — Saldo e Movimentos (D-PROD-255): rótulos e formatação das consultas.
 *
 * Os decimais vêm do servidor como TEXTO canônico ("150.0000"); nada aqui faz
 * aritmética de ponto flutuante. Quantidade na unidade do Produto (L ou kg).
 * Datas em DD/MM/AAAA, dinheiro em R$.
 */
import { formatarMoeda } from '@/lib/dinheiroDecimal';
import { formatarQuantidadeCurta } from '@/lib/abastecimentoRegras';

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
    estorno_entrada_revisao: 'Estorno da entrada (revisão)',
    estorno_entrada_exclusao: 'Estorno da entrada (exclusão)',
    saida_manual: 'Saída manual',
    estorno_saida_manual: 'Estorno da saída (exclusão)',
  }),
);

/** @param {{ tipo_detalhado?: string|null, origem_sistema?: string, tipo?: string }} m */
export const rotuloDoMovimento = (m) => {
  const d = m?.tipo_detalhado ?? '';
  if (ROTULO_DETALHADO[d]) return ROTULO_DETALHADO[d];
  if (d.startsWith('entrada_')) return 'Entrada de estoque';
  return ROTULO_ORIGEM[m?.origem_sistema ?? ''] ?? (m?.tipo === 'Saída' ? 'Saída' : 'Entrada');
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

/** "150" + "L" → "150 L"; "KG" → "kg". @param {unknown} v @param {unknown} unidade */
export const formatarQtd = (v, unidade) => (typeof v === 'string' ? formatarQuantidadeCurta(v, unidade) : '');

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

/** Depósito do movimento: "origem → destino", ou o único que existe. @param {any} m */
export const depositoDoMovimento = (m) => {
  const o = m?.local_origem ?? '';
  const d = m?.local_destino ?? '';
  if (o && d && o !== d) return `${o} → ${d}`;
  return o || d || '';
};

/** @param {string|null|undefined} dia AAAA-MM-DD ou vazio */
export const ehDia = (dia) => typeof dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dia);
