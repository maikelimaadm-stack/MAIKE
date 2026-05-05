/* global Deno */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const formSections = [
  { section_id: 'dados-principais', titulo: 'Dados da pesagem', ordem: 1 },
  { section_id: 'origem-destino', titulo: 'Origem, destino e produto', ordem: 2 },
  { section_id: 'pesos', titulo: 'Pesos', ordem: 3 },
  { section_id: 'observacoes', titulo: '', ordem: 4 },
];

const fields = [
  { section_id: 'dados-principais', field_id: 'data_pesagem', field_name: 'data_pesagem', label: 'Data da Pesagem', tipo: 'date', col_span: 4, ordem: 1, obrigatorio: true },
  { section_id: 'dados-principais', field_id: 'tipo_pesagem', field_name: 'tipo_pesagem', label: 'Tipo de Pesagem', tipo: 'select', col_span: 4, ordem: 2, obrigatorio: true, options: [{ value: 'Entrada', label: 'Entrada' }, { value: 'Saída', label: 'Saída' }, { value: 'Ambos', label: 'Ambos' }] },
  { section_id: 'dados-principais', field_id: 'placa_caminhao', field_name: 'placa_caminhao', label: 'Placa do Caminhão', tipo: 'text', col_span: 4, ordem: 3, placeholder: 'ABC-1234', uppercase: true },
  { section_id: 'origem-destino', field_id: 'nome_motorista', field_name: 'nome_motorista', label: 'Nome do Motorista', tipo: 'text', col_span: 4, ordem: 1, placeholder: 'NOME COMPLETO', uppercase: true },
  { section_id: 'origem-destino', field_id: 'produto', field_name: 'produto', label: 'Produto/Insumo', tipo: 'select', col_span: 4, ordem: 2, options_source: 'produtos', uppercase: true },
  { section_id: 'origem-destino', field_id: 'fornecedor_destino', field_name: 'fornecedor_destino', label: 'Fornecedor/Destino', tipo: 'select', col_span: 4, ordem: 3, options_source: 'fornecedores', uppercase: true },
  { section_id: 'pesos', field_id: 'peso_tara', field_name: 'peso_tara', label: 'Peso Tara (kg)', tipo: 'number', col_span: 4, ordem: 1, obrigatorio: true, step: '0.01', placeholder: '0.00' },
  { section_id: 'pesos', field_id: 'peso_bruto', field_name: 'peso_bruto', label: 'Peso Bruto (kg)', tipo: 'number', col_span: 4, ordem: 2, obrigatorio: true, step: '0.01', placeholder: '0.00' },
  { section_id: 'pesos', field_id: 'peso_liquido', field_name: 'peso_liquido', label: 'Peso Líquido (kg)', tipo: 'readonlyNumber', col_span: 4, ordem: 3, read_only: true, regras: { calculation: { expression: 'peso_bruto - peso_tara' } } },
  { section_id: 'observacoes', field_id: 'observacoes', field_name: 'observacoes', label: 'Observações', tipo: 'textarea', col_span: 12, ordem: 1, rows: 2, placeholder: 'INFORMAÇÕES ADICIONAIS...', uppercase: true },
];

const columns = [
  { column_id: 'numero', field_name: 'numero_registro', label: 'Nº', ordem: 1, visivel: true, ordenavel: true },
  { column_id: 'data', field_name: 'data_pesagem', label: 'Data', ordem: 2, visivel: true, ordenavel: true, formato: 'date' },
  { column_id: 'tipo', field_name: 'tipo_pesagem', label: 'Tipo', ordem: 3, visivel: true, ordenavel: true },
  { column_id: 'placa', field_name: 'placa_caminhao', label: 'Placa', ordem: 4, visivel: true, ordenavel: true },
  { column_id: 'motorista', field_name: 'nome_motorista', label: 'Motorista', ordem: 5, visivel: true, ordenavel: true },
  { column_id: 'produto', field_name: 'produto', label: 'Produto', ordem: 6, visivel: true, ordenavel: true },
  { column_id: 'fornecedor', field_name: 'fornecedor_destino', label: 'Fornecedor/Destino', ordem: 7, visivel: true, ordenavel: true },
  { column_id: 'tara', field_name: 'peso_tara', label: 'Tara (kg)', ordem: 8, visivel: true, ordenavel: true, alinhamento: 'right', formato: 'number' },
  { column_id: 'bruto', field_name: 'peso_bruto', label: 'Bruto (kg)', ordem: 9, visivel: true, ordenavel: true, alinhamento: 'right', formato: 'number' },
  { column_id: 'liquido', field_name: 'peso_liquido', label: 'Líquido (kg)', ordem: 10, visivel: true, ordenavel: true, alinhamento: 'right', formato: 'number', destaque: true },
  { column_id: 'observacoes', field_name: 'observacoes', label: 'Observações', ordem: 11, visivel: false, ordenavel: false, truncate: true },
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const existing = await base44.asServiceRole.entities.LayoutConfiguracao.filter({ tela: 'Pesagens', escopo: 'sistema' });
    if (existing.length > 0) {
      return Response.json({ success: true, message: 'Layout padrão de Pesagens já existe.', layout_id: existing[0].id });
    }

    const layout = await base44.asServiceRole.entities.LayoutConfiguracao.create({
      tela: 'Pesagens',
      nome: 'Layout Padrão - Pesagens',
      descricao: 'Layout padrão persistido para lançamento e consulta de pesagens.',
      escopo: 'sistema',
      versao_ativa: 1,
      ativo: true,
      metadata: { entity_name: 'Pesagem' },
    });

    await base44.asServiceRole.entities.LayoutSecao.bulkCreate(formSections.map((section) => ({ ...section, layout_id: layout.id, ativo: true })));
    await base44.asServiceRole.entities.LayoutCampo.bulkCreate(fields.map((field) => ({ ...field, layout_id: layout.id, entity_name: 'Pesagem', origem: 'fixo', ativo: true })));
    await base44.asServiceRole.entities.LayoutTabelaColuna.bulkCreate(columns.map((column) => ({ ...column, layout_id: layout.id, entity_name: 'Pesagem', origem: 'fixo' })));

    await base44.asServiceRole.entities.LayoutVersao.create({
      layout_id: layout.id,
      versao: 1,
      snapshot: { sections: formSections, fields, columns },
      motivo: 'Criação do layout padrão de Pesagens',
      ativo: true,
    });

    return Response.json({ success: true, layout_id: layout.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});