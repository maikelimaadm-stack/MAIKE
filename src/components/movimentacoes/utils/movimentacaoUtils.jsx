// ========== FUNÇÕES UTILITÁRIAS PARA MOVIMENTAÇÕES DE ESTOQUE ==========

/**
 * Converte valor interno (slug) para label amigável de exibição
 * Ex: "ajuste_positivo" → "Ajuste Positivo"
 */
export const toLabel = (value) => {
  if (!value) return '';
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
};

/**
 * Converte label para valor canônico (slug)
 * Ex: "Ajuste Positivo" → "ajuste_positivo"
 * Se já vier como slug, mantém
 */
export const toValue = (labelOrValue) => {
  if (!labelOrValue) return '';
  // Se já vier como slug (contém _), mantém em lowercase
  if (String(labelOrValue).includes('_')) return String(labelOrValue).toLowerCase();
  // Se vier como label, converte para slug
  return String(labelOrValue)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
};

/**
 * Retorna o local de estoque principal de uma movimentação
 * baseado no tipo de movimentação:
 * - Entrada → destino
 * - Saída → origem
 * - Transferência → origem → destino
 * - Ajuste → origem (padrão, ou destino se não houver origem)
 */
export const getLocalEstoque = (m) => {
  if (!m) return '';
  
  const origem = m.local_estoque_origem || m.local_estoque_origem_nome || m.local_origem || '';
  const destino = m.local_estoque_destino || m.local_estoque_destino_nome || m.local_destino || '';
  
  switch (m.tipo_movimentacao) {
    case 'Entrada':
      return destino || origem || '';
    case 'Saída':
      return origem || destino || '';
    case 'Transferência':
      if (origem && destino) {
        return `${origem} → ${destino}`;
      }
      return origem || destino || '';
    case 'Ajuste':
      // Para ajuste, preferir origem (local onde o ajuste foi feito)
      // Se não tiver origem, usar destino
      return origem || destino || '';
    default:
      return origem || destino || '';
  }
};

/**
 * Retorna apenas o local origem de uma movimentação
 */
export const getLocalOrigem = (m) => {
  if (!m) return '';
  return m.local_estoque_origem || m.local_estoque_origem_nome || m.local_origem || '';
};

/**
 * Retorna apenas o local destino de uma movimentação
 */
export const getLocalDestino = (m) => {
  if (!m) return '';
  return m.local_estoque_destino || m.local_estoque_destino_nome || m.local_destino || '';
};

/**
 * Prepara os campos de local para salvamento baseado no tipo de movimentação
 * @param {string} tipo - Tipo de movimentação (ENTRADA, SAIDA, TRANSFERENCIA, AJUSTE)
 * @param {string} operacao - Operação específica (ajuste_positivo, ajuste_negativo, etc)
 * @param {string} localOrigemId - ID do local de origem
 * @param {string} localDestinoId - ID do local de destino
 * @param {object} locais - Array de locais para buscar nomes
 * @returns {object} - Objeto com campos formatados para salvamento
 */
export const prepararLocaisParaSalvar = (tipo, operacao, localOrigemId, localDestinoId, locais = []) => {
  const localOrigem = locais.find(l => l.id === localOrigemId);
  const localDestino = locais.find(l => l.id === localDestinoId);
  
  const resultado = {
    local_estoque_origem_id: undefined,
    local_estoque_origem: undefined,
    local_estoque_origem_nome: undefined,
    local_estoque_destino_id: undefined,
    local_estoque_destino: undefined,
    local_estoque_destino_nome: undefined,
  };
  
  switch (tipo) {
    case 'ENTRADA':
      // Entrada → salva apenas destino
      if (localDestinoId) {
        resultado.local_estoque_destino_id = localDestinoId;
        resultado.local_estoque_destino = localDestino?.nome;
        resultado.local_estoque_destino_nome = localDestino?.nome;
      }
      break;
      
    case 'SAIDA':
      // Saída → salva apenas origem
      if (localOrigemId) {
        resultado.local_estoque_origem_id = localOrigemId;
        resultado.local_estoque_origem = localOrigem?.nome;
        resultado.local_estoque_origem_nome = localOrigem?.nome;
      }
      break;
      
    case 'TRANSFERENCIA':
      // Transferência → salva ambos
      if (localOrigemId) {
        resultado.local_estoque_origem_id = localOrigemId;
        resultado.local_estoque_origem = localOrigem?.nome;
        resultado.local_estoque_origem_nome = localOrigem?.nome;
      }
      if (localDestinoId) {
        resultado.local_estoque_destino_id = localDestinoId;
        resultado.local_estoque_destino = localDestino?.nome;
        resultado.local_estoque_destino_nome = localDestino?.nome;
      }
      break;
      
    case 'AJUSTE':
      // Ajuste positivo → entrada (destino), Ajuste negativo → saída (origem)
      if (operacao === 'ajuste_positivo' || operacao === 'inventario' || operacao === 'correcao') {
        if (localDestinoId) {
          resultado.local_estoque_destino_id = localDestinoId;
          resultado.local_estoque_destino = localDestino?.nome;
          resultado.local_estoque_destino_nome = localDestino?.nome;
        }
      } else if (operacao === 'ajuste_negativo') {
        if (localOrigemId) {
          resultado.local_estoque_origem_id = localOrigemId;
          resultado.local_estoque_origem = localOrigem?.nome;
          resultado.local_estoque_origem_nome = localOrigem?.nome;
        }
      } else {
        // Outros ajustes - usar origem como padrão
        if (localOrigemId) {
          resultado.local_estoque_origem_id = localOrigemId;
          resultado.local_estoque_origem = localOrigem?.nome;
          resultado.local_estoque_origem_nome = localOrigem?.nome;
        } else if (localDestinoId) {
          resultado.local_estoque_destino_id = localDestinoId;
          resultado.local_estoque_destino = localDestino?.nome;
          resultado.local_estoque_destino_nome = localDestino?.nome;
        }
      }
      break;
      
    default:
      break;
  }
  
  return resultado;
};

/**
 * Lista de todas as operações possíveis com seus valores e labels
 */
export const TODAS_OPERACOES = [
  // Entradas
  { value: 'compra', label: 'Compra', tipo: 'ENTRADA' },
  { value: 'devolucao_cliente', label: 'Devolução de Cliente', tipo: 'ENTRADA' },
  { value: 'devolucao_fornecedor', label: 'Devolução de Fornecedor', tipo: 'ENTRADA' },
  { value: 'bonificacao', label: 'Bonificação', tipo: 'ENTRADA' },
  { value: 'transferencia_recebida', label: 'Transferência Recebida', tipo: 'ENTRADA' },
  { value: 'producao_entrada', label: 'Produção Interna', tipo: 'ENTRADA' },
  { value: 'ajuste_positivo', label: 'Ajuste Positivo', tipo: 'ENTRADA' },
  { value: 'outros_entrada', label: 'Outros', tipo: 'ENTRADA' },
  // Saídas
  { value: 'venda', label: 'Venda', tipo: 'SAIDA' },
  { value: 'devolucao_fornecedor', label: 'Devolução ao Fornecedor', tipo: 'SAIDA' },
  { value: 'consumo_interno', label: 'Consumo Interno', tipo: 'SAIDA' },
  { value: 'suplementacao', label: 'Suplementação', tipo: 'SAIDA' },
  { value: 'aplicacao_area', label: 'Aplicação em Área', tipo: 'SAIDA' },
  { value: 'manutencao', label: 'Manutenção', tipo: 'SAIDA' },
  { value: 'perda_quebra', label: 'Perda/Quebra', tipo: 'SAIDA' },
  { value: 'transferencia_enviada', label: 'Transferência Enviada', tipo: 'SAIDA' },
  { value: 'ajuste_negativo', label: 'Ajuste Negativo', tipo: 'SAIDA' },
  { value: 'outros_saida', label: 'Outros', tipo: 'SAIDA' },
  // Transferências
  { value: 'entre_locais', label: 'Entre Locais', tipo: 'TRANSFERENCIA' },
  { value: 'entre_empresas', label: 'Entre Empresas', tipo: 'TRANSFERENCIA' },
  { value: 'outros_transferencia', label: 'Outros', tipo: 'TRANSFERENCIA' },
  // Ajustes
  { value: 'ajuste_positivo', label: 'Ajuste Positivo (Entrada)', tipo: 'AJUSTE' },
  { value: 'ajuste_negativo', label: 'Ajuste Negativo (Saída)', tipo: 'AJUSTE' },
  { value: 'inventario', label: 'Inventário', tipo: 'AJUSTE' },
  { value: 'correcao', label: 'Correção de Estoque', tipo: 'AJUSTE' },
  { value: 'outros_ajuste', label: 'Outros Ajustes', tipo: 'AJUSTE' },
];

/**
 * Busca a label de uma operação pelo seu valor
 */
export const getLabelOperacao = (value) => {
  if (!value) return '-';
  const op = TODAS_OPERACOES.find(o => o.value === value);
  if (op) return op.label;
  // Fallback: usar toLabel
  return toLabel(value);
};