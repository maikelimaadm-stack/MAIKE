import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

const PROPAGATION_RULES = {
  Produto: [
    {
      entity: 'CustoSafra',
      matchType: 'id',
      queryField: 'produto_id',
      fieldMap: {
        produto_nome: 'nome_produto',
      },
    },
    {
      entity: 'HistoricoEntrega',
      matchType: 'id',
      queryField: 'produto_id',
      fieldMap: {
        produto_nome: 'nome_produto',
      },
    },
    {
      entity: 'MovimentacaoEstoque',
      matchType: 'id',
      queryField: 'produto_id',
      fieldMap: {
        produto_nome: 'nome_produto',
        produto_codigo: 'codigo_interno',
        produto_categoria: 'categoria',
      },
    },
    {
      entity: 'SuplementacaoEvento',
      matchType: 'id',
      queryField: 'produto_id',
      fieldMap: {
        produto: 'nome_produto',
      },
    },
    {
      entity: 'OperacaoAgricola',
      matchType: 'value',
      sourceField: 'nome_produto',
      matchFields: ['produto_aplicado'],
      fieldMap: {
        produto_aplicado: 'nome_produto',
      },
    },
    {
      entity: 'ManejoTecnicoRebanho',
      matchType: 'value',
      sourceField: 'nome_produto',
      matchFields: ['produto', 'produto_utilizado'],
      fieldMap: {
        produto: 'nome_produto',
        produto_utilizado: 'nome_produto',
      },
    },
    {
      entity: 'PontoSuplementacao',
      matchType: 'value',
      sourceField: 'nome_produto',
      matchFields: ['produto_padrao'],
      fieldMap: {
        produto_padrao: 'nome_produto',
      },
    },
  ],
  Fornecedor: [
    {
      entity: 'CustoSafra',
      matchType: 'id',
      queryField: 'fornecedor_id',
      fieldMap: {
        fornecedor_nome: 'nome',
      },
    },
    {
      entity: 'HistoricoEntrega',
      matchType: 'id',
      queryField: 'fornecedor_id',
      fieldMap: {
        fornecedor_nome: 'nome',
      },
    },
    {
      entity: 'MovimentacaoEstoque',
      matchType: 'id',
      queryField: 'fornecedor_id',
      fieldMap: {
        fornecedor_nome: 'nome',
      },
    },
    {
      entity: 'LancamentoFinanceiro',
      matchType: 'id',
      queryField: 'fornecedor_id',
      fieldMap: {
        fornecedor_nome: 'nome',
      },
    },
    {
      entity: 'Lote',
      matchType: 'id',
      queryField: 'fornecedor_id',
      fieldMap: {
        fornecedor_nome: 'nome',
      },
    },
    {
      entity: 'AtivoFixo',
      matchType: 'id',
      queryField: 'fornecedor_id',
      fieldMap: {
        fornecedor_nome: 'nome',
      },
    },
  ],
  Safra: [
    {
      entity: 'MovimentacaoEstoque',
      matchType: 'id',
      queryField: 'safra_id',
      fieldMap: {
        safra_nome: '__safra_label__',
      },
    },
    {
      entity: 'LancamentoFinanceiro',
      matchType: 'id',
      queryField: 'safra_id',
      fieldMap: {
        safra_nome: '__safra_label__',
      },
    },
  ],
  UnidadeMedida: [
    {
      entity: 'Produto',
      matchType: 'value',
      sourceField: 'sigla',
      matchFields: ['unidade_medida'],
      fieldMap: {
        unidade_medida: 'sigla',
      },
    },
    {
      entity: 'MovimentacaoEstoque',
      matchType: 'value',
      sourceField: 'sigla',
      matchFields: ['unidade_medida'],
      fieldMap: {
        unidade_medida: 'sigla',
      },
    },
  ],
  Categoria: [
    {
      entity: 'Produto',
      matchType: 'value',
      sourceField: 'nome',
      matchFields: ['categoria'],
      fieldMap: {
        categoria: 'nome',
      },
    },
  ],
  LocalEstoque: [
    {
      entity: 'Produto',
      matchType: 'value',
      sourceField: 'nome',
      matchFields: ['local_estoque'],
      fieldMap: {
        local_estoque: 'nome',
      },
    },
    {
      entity: 'LancamentoFinanceiro',
      matchType: 'value',
      sourceField: 'nome',
      matchFields: ['local_estoque'],
      fieldMap: {
        local_estoque: 'nome',
      },
    },
    {
      entity: 'MovimentacaoEstoque',
      matchType: 'value',
      sourceField: 'nome',
      matchFields: ['local_origem', 'local_destino', 'local_estoque_origem', 'local_estoque_destino'],
      fieldMap: {
        local_origem: 'nome',
        local_destino: 'nome',
        local_estoque_origem: 'nome',
        local_estoque_destino: 'nome',
      },
    },
  ],
  CentroCusto: [
    {
      entity: 'LancamentoFinanceiro',
      matchType: 'id',
      queryField: 'centro_custo_id',
      fieldMap: {
        centro_custo_nome: 'nome',
      },
    },
    {
      entity: 'MovimentacaoEstoque',
      matchType: 'id',
      queryField: 'centro_custo_id',
      fieldMap: {
        centro_custo_nome: 'nome',
      },
    },
  ],
  GrupoAtividade: [
    {
      entity: 'TipoTarefa',
      matchType: 'id',
      queryField: 'grupo_atividade_id',
      fieldMap: {
        grupo_atividade_nome: 'nome_grupo',
      },
    },
    {
      entity: 'LancamentoTarefa',
      matchType: 'id',
      queryField: 'grupo_atividade_id',
      fieldMap: {
        grupo_atividade_nome: 'nome_grupo',
      },
    },
    {
      entity: 'TarefaMapa',
      matchType: 'id',
      queryField: 'grupo_atividade_id',
      fieldMap: {
        grupo_atividade_nome: 'nome_grupo',
      },
    },
  ],
  TipoTarefa: [
    {
      entity: 'LancamentoTarefa',
      matchType: 'id',
      queryField: 'tipo_tarefa_id',
      fieldMap: {
        tipo_tarefa_nome: 'nome_tipo',
        grupo_atividade_id: 'grupo_atividade_id',
        grupo_atividade_nome: 'grupo_atividade_nome',
      },
    },
    {
      entity: 'TarefaMapa',
      matchType: 'id',
      queryField: 'tipo_tarefa_id',
      fieldMap: {
        tipo_tarefa_nome: 'nome_tipo',
        grupo_atividade_id: 'grupo_atividade_id',
        grupo_atividade_nome: 'grupo_atividade_nome',
      },
    },
  ],
  Lote: [
    {
      entity: 'MovimentacaoMapa',
      matchType: 'id',
      queryField: 'lote_id',
      fieldMap: {
        lote: 'nome',
      },
    },
    {
      entity: 'SuplementacaoLote',
      matchType: 'id',
      queryField: 'lote_id',
      fieldMap: {
        lote_nome: 'nome',
      },
    },
    {
      entity: 'LancamentoTarefa',
      matchType: 'id',
      queryField: 'lote_id',
      fieldMap: {
        lote_nome: 'nome',
      },
    },
    {
      entity: 'TarefaMapa',
      matchType: 'id',
      queryField: 'lote_id',
      fieldMap: {
        lote_nome: 'nome',
      },
    },
  ],
};

function normalizeValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

function getSourceFieldValue(data, sourceField) {
  if (!data) return null;
  if (sourceField === '__safra_label__') {
    if (data.ano_inicio && data.ano_fim) return `${data.ano_inicio}/${data.ano_fim}`;
    return data.descricao || null;
  }
  return data?.[sourceField] ?? null;
}

async function readPayload(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

async function listRecordsForRule(base44, rule, sourceData, oldData) {
  const entityApi = base44.asServiceRole.entities?.[rule.entity];
  if (!entityApi) return [];

  if (rule.matchType === 'id') {
    try {
      return await entityApi.filter({ [rule.queryField]: sourceData.id }, '-created_date', 5000);
    } catch {
      const fallback = await entityApi.list('-created_date', 5000);
      return fallback.filter((record) => record?.[rule.queryField] === sourceData.id);
    }
  }

  const oldValue = normalizeValue(getSourceFieldValue(oldData, rule.sourceField));
  if (!oldValue) return [];

  const records = await entityApi.list('-created_date', 5000);
  return records.filter((record) => {
    if (sourceData?.empresa_id && record?.empresa_id && record.empresa_id !== sourceData.empresa_id) {
      return false;
    }

    return (rule.matchFields || []).some((field) => normalizeValue(record?.[field]) === oldValue);
  });
}

function buildPatchForRecord(record, rule, sourceData, oldData) {
  const patch = {};

  Object.entries(rule.fieldMap || {}).forEach(([targetField, sourceField]) => {
    const newValue = getSourceFieldValue(sourceData, sourceField);
    const oldValue = getSourceFieldValue(oldData, sourceField);
    const currentValue = record?.[targetField] ?? null;

    if (newValue === oldValue) return;

    if (rule.matchType === 'value' && normalizeValue(currentValue) !== normalizeValue(oldValue)) {
      return;
    }

    if (currentValue === newValue) return;

    patch[targetField] = newValue;
  });

  return patch;
}

async function propagateRule(base44, rule, sourceData, oldData) {
  const entityApi = base44.asServiceRole.entities?.[rule.entity];
  if (!entityApi) {
    return { entity: rule.entity, updated_count: 0 };
  }

  const records = await listRecordsForRule(base44, rule, sourceData, oldData);
  if (!records.length) {
    return { entity: rule.entity, updated_count: 0 };
  }

  let updatedCount = 0;

  for (const record of records) {
    const patch = buildPatchForRecord(record, rule, sourceData, oldData);
    if (!Object.keys(patch).length) continue;

    await entityApi.update(record.id, patch);
    updatedCount += 1;
  }

  return {
    entity: rule.entity,
    updated_count: updatedCount,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await readPayload(req);

    const event = payload?.event || {};
    const sourceEntity = event?.entity_name || payload?.entity_name || null;
    const sourceData = payload?.data || payload?.new_data || null;
    const oldData = payload?.old_data || payload?.previous_data || null;

    if (!sourceEntity || event?.type !== 'update' || !sourceData?.id || !oldData) {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'Nenhum update compatível recebido.',
      });
    }

    const rules = PROPAGATION_RULES[sourceEntity] || [];
    if (!rules.length) {
      return Response.json({
        success: true,
        skipped: true,
        reason: `Nenhuma regra cadastrada para ${sourceEntity}.`,
      });
    }

    const results = await Promise.all(
      rules.map((rule) => propagateRule(base44, rule, sourceData, oldData))
    );

    const totalUpdated = results.reduce((sum, item) => sum + (item.updated_count || 0), 0);

    return Response.json({
      success: true,
      source_entity: sourceEntity,
      source_id: sourceData.id,
      total_updated: totalUpdated,
      results,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});