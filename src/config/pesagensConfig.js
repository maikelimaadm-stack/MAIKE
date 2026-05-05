export const PESAGEM_FORM_CONFIG = {
  id: "pesagem-form",
  sections: [
    {
      id: "dados-principais",
      title: "Dados da pesagem",
      fields: [
        { id: "data_pesagem", name: "data_pesagem", label: "Data da Pesagem", type: "date", required: true, colSpan: 4 },
        {
          id: "tipo_pesagem",
          name: "tipo_pesagem",
          label: "Tipo de Pesagem",
          type: "select",
          required: true,
          colSpan: 4,
          options: [
            { value: "Entrada", label: "Entrada" },
            { value: "Saída", label: "Saída" },
            { value: "Ambos", label: "Ambos" },
          ],
        },
        { id: "placa_caminhao", name: "placa_caminhao", label: "Placa do Caminhão", type: "text", placeholder: "ABC-1234", uppercase: true, colSpan: 4 },
      ],
    },
    {
      id: "origem-destino",
      title: "Origem, destino e produto",
      fields: [
        { id: "nome_motorista", name: "nome_motorista", label: "Nome do Motorista", type: "text", placeholder: "NOME COMPLETO", uppercase: true, colSpan: 4 },
        {
          id: "produto",
          name: "produto",
          label: "Produto/Insumo",
          type: "select",
          placeholder: "SELECIONE",
          colSpan: 4,
          uppercase: true,
          options: ({ produtos = [] }) => produtos.map((produto) => ({ value: produto.nome_produto, label: produto.nome_produto })),
        },
        {
          id: "fornecedor_destino",
          name: "fornecedor_destino",
          label: "Fornecedor/Destino",
          type: "select",
          placeholder: "SELECIONE",
          colSpan: 4,
          uppercase: true,
          options: ({ fornecedores = [] }) => fornecedores.map((fornecedor) => ({ value: fornecedor.nome, label: fornecedor.nome })),
        },
      ],
    },
    {
      id: "pesos",
      title: "Pesos",
      fields: [
        { id: "peso_tara", name: "peso_tara", label: "Peso Tara (kg)", type: "number", step: "0.01", placeholder: "0.00", required: true, colSpan: 4 },
        { id: "peso_bruto", name: "peso_bruto", label: "Peso Bruto (kg)", type: "number", step: "0.01", placeholder: "0.00", required: true, colSpan: 4 },
        { id: "peso_liquido", name: "peso_liquido", label: "Peso Líquido (kg)", type: "readonlyNumber", decimals: 2, readOnly: true, colSpan: 4 },
      ],
    },
    {
      id: "observacoes",
      fields: [
        { id: "observacoes", name: "observacoes", label: "Observações", type: "textarea", placeholder: "INFORMAÇÕES ADICIONAIS...", uppercase: true, rows: 2, colSpan: 12 },
      ],
    },
  ],
};

export const PESAGEM_TABLE_COLUMNS = [
  { id: "numero", label: "Nº", default: true, sortable: true, accessor: "numero_registro" },
  { id: "data", label: "Data", default: true, sortable: true, accessor: "data_pesagem", format: "date" },
  { id: "tipo", label: "Tipo", default: true, sortable: true, accessor: "tipo_pesagem" },
  { id: "placa", label: "Placa", default: true, sortable: true, accessor: "placa_caminhao", uppercase: true },
  { id: "motorista", label: "Motorista", default: true, sortable: true, accessor: "nome_motorista" },
  { id: "produto", label: "Produto", default: true, sortable: true, accessor: "produto" },
  { id: "fornecedor", label: "Fornecedor/Destino", default: true, sortable: true, accessor: "fornecedor_destino" },
  { id: "tara", label: "Tara (kg)", default: true, sortable: true, accessor: "peso_tara", align: "right", format: "number" },
  { id: "bruto", label: "Bruto (kg)", default: true, sortable: true, accessor: "peso_bruto", align: "right", format: "number" },
  { id: "liquido", label: "Líquido (kg)", default: true, sortable: true, accessor: "peso_liquido", align: "right", format: "number", strong: true },
  { id: "observacoes", label: "Observações", default: false, sortable: false, accessor: "observacoes", truncate: true },
];