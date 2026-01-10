// Utilitários para Movimentação de Estoque

/**
 * Formata número para exibição em R$
 */
export const formatarMoedaBR = (valor) => {
  if (valor === null || valor === undefined || isNaN(valor)) return "R$ 0,00";
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

/**
 * Converte string de moeda BR para número
 */
export const parseMoedaBR = (str) => {
  if (!str && str !== 0) return 0;
  if (typeof str === 'number') return str;
  const cleaned = String(str)
    .replace(/\s/g, '')
    .replace(/R\$/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
};

/**
 * Formata número para exibição (quantidade)
 */
export const formatarNumero = (num, decimais = 2) => {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return Number(num).toLocaleString('pt-BR', { 
    minimumFractionDigits: decimais, 
    maximumFractionDigits: decimais 
  });
};

/**
 * Parse de string de número BR para number
 */
export const parseNumeroBR = (str) => {
  if (!str && str !== 0) return 0;
  if (typeof str === 'number') return str;
  return parseFloat(String(str).replace(/\./g, '').replace(',', '.')) || 0;
};

/**
 * Calcula os totais de um item
 */
export const calcularTotaisItem = (quantidade, precoUnitario, desconto = 0) => {
  const qtd = parseNumeroBR(quantidade) || 0;
  const preco = parseMoedaBR(precoUnitario) || 0;
  const desc = parseMoedaBR(desconto) || 0;
  
  const total = qtd * preco;
  const liquido = Math.max(0, total - desc);
  const unitarioLiquido = qtd > 0 ? liquido / qtd : 0;
  
  return {
    quantidade: qtd,
    precoUnitario: preco,
    total,
    desconto: desc,
    liquido,
    unitarioLiquido
  };
};

/**
 * Distribui quantidade de saída entre lotes disponíveis (FIFO)
 * @param {Array} lotes - Lista de lotes disponíveis ordenados por data
 * @param {number} quantidadeTotal - Quantidade total a ser baixada
 * @returns {Array} - Lista de baixas por lote [{lote, quantidade, custo}]
 */
export const distribuirSaidaPorLotes = (lotes, quantidadeTotal) => {
  const baixas = [];
  let restante = quantidadeTotal;
  
  // Ordenar por data do documento (mais antigo primeiro - FIFO)
  const lotesOrdenados = [...lotes]
    .filter(l => l.quantidade_disponivel > 0)
    .sort((a, b) => new Date(a.data_documento || a.created_date || 0) - new Date(b.data_documento || b.created_date || 0));
  
  for (const lote of lotesOrdenados) {
    if (restante <= 0) break;
    
    const qtdBaixa = Math.min(lote.quantidade_disponivel, restante);
    if (qtdBaixa > 0) {
      baixas.push({
        lote_id: lote.id,
        lote,
        quantidade: qtdBaixa,
        custo_unitario: lote.custo_unitario || 0,
        valor_total: qtdBaixa * (lote.custo_unitario || 0)
      });
      restante -= qtdBaixa;
    }
  }
  
  return {
    baixas,
    quantidadeAtendida: quantidadeTotal - restante,
    quantidadePendente: restante
  };
};

/**
 * Calcula saldo total de um produto em um local
 */
export const calcularSaldoProdutoLocal = (lotes, produtoId, localId) => {
  return lotes
    .filter(l => l.produto_id === produtoId && l.local_estoque_id === localId && l.quantidade_disponivel > 0)
    .reduce((sum, l) => sum + (l.quantidade_disponivel || 0), 0);
};

/**
 * Operações disponíveis por tipo
 */
export const OPERACOES_POR_TIPO = {
  ENTRADA: [
    { value: 'compra', label: 'Compra', exigeFornecedor: true },
    { value: 'devolucao_cliente', label: 'Devolução de Cliente', exigeFornecedor: false },
    { value: 'bonificacao', label: 'Bonificação', exigeFornecedor: true },
    { value: 'ajuste_positivo', label: 'Ajuste Positivo', exigeFornecedor: false },
    { value: 'producao_entrada', label: 'Produção/Entrada Interna', exigeFornecedor: false },
    { value: 'outros_entrada', label: 'Outros', exigeFornecedor: false }
  ],
  SAIDA: [
    { value: 'venda', label: 'Venda', exigeDestino: true, precoEditavel: true },
    { value: 'consumo_interno', label: 'Consumo Interno', exigeVinculo: true, precoEditavel: false },
    { value: 'suplementacao', label: 'Suplementação', exigeVinculo: true, precoEditavel: false },
    { value: 'aplicacao_area', label: 'Aplicação em Área', exigeVinculo: true, precoEditavel: false },
    { value: 'manutencao', label: 'Manutenção', exigeVinculo: true, precoEditavel: false },
    { value: 'perda_quebra', label: 'Perda/Quebra', exigeVinculo: false, precoEditavel: false },
    { value: 'ajuste_negativo', label: 'Ajuste Negativo', exigeVinculo: false, precoEditavel: false },
    { value: 'outros_saida', label: 'Outros', exigeVinculo: false, precoEditavel: false }
  ]
};

/**
 * Tipos de vínculo para saídas
 */
export const TIPOS_VINCULO = [
  { value: 'lote', label: 'Lote (Pecuária)' },
  { value: 'area', label: 'Área / Pasto' },
  { value: 'maquina', label: 'Máquina / Veículo' },
  { value: 'centro_custo', label: 'Centro de Custo' },
  { value: 'funcionario', label: 'Funcionário' },
  { value: 'outro', label: 'Outro (texto livre)' }
];

/**
 * Tipos de documento
 */
export const TIPOS_DOCUMENTO = [
  { value: 'nfe', label: 'NF-e' },
  { value: 'nota_fiscal', label: 'Nota Fiscal' },
  { value: 'recibo', label: 'Recibo' },
  { value: 'outros', label: 'Outros' }
];