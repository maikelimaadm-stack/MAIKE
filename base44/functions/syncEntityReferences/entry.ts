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
};

function normalizeValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
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

  const oldValue = normalizeValue(oldData?.[rule.sourceField]);
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
    const newValue = sourceData?.[sourceField] ?? null;
    const oldValue = oldData?.[sourceField] ?? null;
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