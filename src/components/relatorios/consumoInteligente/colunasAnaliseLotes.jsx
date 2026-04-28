export const COLUNAS_ANALISE_LOTES = [
  { id: 'data', label: 'Data', default: true },
  { id: 'retiro', label: 'Retiro', default: true },
  { id: 'modulo', label: 'Módulo', default: true },
  { id: 'area', label: 'Área', default: true },
  { id: 'lote', label: 'Nome Lote', default: true },
  { id: 'categoria', label: 'Categoria Manejo', default: true },
  { id: 'cabecas', label: 'Quantidade (cab)', default: true },
  { id: 'peso_medio', label: 'Peso Médio', default: true },
  { id: 'classificacao_produto', label: 'Classificação Produto', default: true },
  { id: 'produto', label: 'Produto', default: true },
  { id: 'quantidade_kg', label: 'Quantidade (kg)', default: true },
  { id: 'meta_consumo', label: 'Meta Consumo (%)', default: true },
  { id: 'consumo_percentual', label: 'Consumo (%)', default: true },
  { id: 'desvio_percentual', label: 'Desvio (%)', default: true },
  { id: 'meta_cabeca', label: 'Meta Consumo (Cab)', default: true },
  { id: 'consumo_cabeca', label: 'Consumo (Cab)', default: true },
  { id: 'desvio_cabeca', label: 'Desvio (Cab)', default: true },
  { id: 'cocho', label: 'Cocho', default: false },
  { id: 'deposito', label: 'Depósito', default: false },
  { id: 'status', label: 'Status', default: false },
];

export const STORAGE_KEY_COLUNAS_ANALISE_LOTES = 'colunas_relatorio_consumo_lotes';