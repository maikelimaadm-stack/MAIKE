export const RECORD_SOURCE_OPTIONS = [
  {
    page: "Pesagens",
    entity: "Pesagem",
    label: "Pesagens",
    labelField: "numero_registro",
    fields: [
      { value: "numero_registro", label: "Número" },
      { value: "data_pesagem", label: "Data" },
      { value: "tipo_pesagem", label: "Tipo" },
      { value: "placa_caminhao", label: "Placa" },
      { value: "nome_motorista", label: "Motorista" },
      { value: "produto", label: "Produto" },
      { value: "fornecedor_destino", label: "Fornecedor/Destino" },
      { value: "peso_tara", label: "Peso Tara" },
      { value: "peso_bruto", label: "Peso Bruto" },
      { value: "peso_liquido", label: "Peso Líquido" },
    ],
  },
  {
    page: "Fornecedores",
    entity: "Fornecedor",
    label: "Fornecedores/Clientes",
    labelField: "nome",
    fields: [
      { value: "nome", label: "Nome" },
      { value: "tipo_pessoa", label: "Tipo Pessoa" },
      { value: "cpf", label: "CPF" },
      { value: "cnpj", label: "CNPJ" },
      { value: "telefone", label: "Telefone" },
      { value: "email", label: "E-mail" },
      { value: "cidade", label: "Cidade" },
      { value: "estado", label: "Estado" },
    ],
  },
  {
    page: "Produtos",
    entity: "Produto",
    label: "Produtos",
    labelField: "nome_produto",
    fields: [
      { value: "nome_produto", label: "Nome" },
      { value: "codigo_interno", label: "Código Interno" },
      { value: "categoria", label: "Categoria" },
      { value: "marca", label: "Marca" },
      { value: "unidade_medida", label: "Unidade" },
      { value: "preco_custo", label: "Preço Custo" },
      { value: "preco_venda", label: "Preço Venda" },
      { value: "estoque_atual", label: "Estoque Atual" },
    ],
  },
  {
    page: "MovimentacoesEstoque",
    entity: "MovimentacaoEstoque",
    label: "Movimentações de Estoque",
    labelField: "numero_movimentacao",
    fields: [
      { value: "numero_movimentacao", label: "Número" },
      { value: "tipo_movimentacao", label: "Tipo" },
      { value: "produto_nome", label: "Produto" },
      { value: "quantidade", label: "Quantidade" },
      { value: "valor_unitario", label: "Valor Unitário" },
      { value: "valor_total", label: "Valor Total" },
      { value: "local_origem", label: "Local Origem" },
      { value: "local_destino", label: "Local Destino" },
    ],
  },
  {
    page: "LancamentoFinanceiro",
    entity: "LancamentoFinanceiro",
    label: "Lançamentos Financeiros",
    labelField: "descricao",
    fields: [
      { value: "descricao", label: "Descrição" },
      { value: "tipo", label: "Tipo" },
      { value: "status", label: "Status" },
      { value: "valor_total", label: "Valor Total" },
      { value: "valor_pago", label: "Valor Pago" },
      { value: "data_vencimento", label: "Vencimento" },
      { value: "fornecedor_nome", label: "Fornecedor" },
      { value: "cliente_nome", label: "Cliente" },
    ],
  },
  {
    page: "CadastroLotes",
    entity: "Lote",
    label: "Lotes",
    labelField: "nome_lote",
    fields: [
      { value: "nome_lote", label: "Nome" },
      { value: "numero_lote", label: "Número" },
      { value: "categoria", label: "Categoria" },
      { value: "quantidade_animais", label: "Quantidade Animais" },
      { value: "peso_medio", label: "Peso Médio" },
      { value: "peso_total", label: "Peso Total" },
    ],
  },
  {
    page: "MapaCadastro",
    entity: "AreaPastagem",
    label: "Áreas de Pastagem",
    labelField: "nome_area",
    fields: [
      { value: "nome_area", label: "Nome" },
      { value: "setor_nome", label: "Setor" },
      { value: "area_hectares", label: "Área (ha)" },
      { value: "status", label: "Status" },
    ],
  },
  {
    page: "CadastroMaquinas",
    entity: "Maquina",
    label: "Máquinas",
    labelField: "nome_maquina",
    fields: [
      { value: "nome_maquina", label: "Nome" },
      { value: "marca", label: "Marca" },
      { value: "modelo", label: "Modelo" },
      { value: "placa", label: "Placa" },
      { value: "status", label: "Status" },
    ],
  },
];

export const ENTITY_OPTIONS = RECORD_SOURCE_OPTIONS.map((source) => ({
  value: source.entity,
  label: source.label,
}));

export function getSourceByEntity(entityName) {
  return RECORD_SOURCE_OPTIONS.find((source) => source.entity === entityName);
}

export function getFieldsByEntity(entityName) {
  return getSourceByEntity(entityName)?.fields || [];
}

export function getLabelFieldByEntity(entityName) {
  return getSourceByEntity(entityName)?.labelField || "id";
}