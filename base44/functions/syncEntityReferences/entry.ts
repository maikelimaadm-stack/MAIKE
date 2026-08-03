import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Regras de propagação — escopo Pecuária Mapa Geral + Manejo (P0.1-R1).
//
// Toda chave-fonte e todo `entity` de destino precisam existir em
// `config/mapa-manejo-scope.json` → `allowedBase44Entities`.
// Validado por `npm run gate:product-scope` (P01-SCOPE-FUNCTION-ENTITY).
//
// As chaves-fonte são exatamente as cinco invocadas pela cadeia preservada:
//   Produto        → src/pages/Produtos.jsx
//   Setor          → src/pages/CadastroSetores.jsx
//   TipoTarefa     → src/pages/TiposTarefa.jsx
//   GrupoAtividade → src/pages/GruposAtividades.jsx
//   Lote           → src/core/repositories/loteRepository.js
const PROPAGATION_RULES = {
  Produto: [
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
  ],
  Setor: [
    {
      entity: 'AreaPastagem',
      matchType: 'id',
      queryField: 'setor_id',
      fieldMap: {
        setor_nome: 'nome',
      },
    },
    {
      entity: 'AreaPastagem',
      matchType: 'value',
      sourceField: 'nome',
      matchFields: ['setor_nome'],
      fieldMap: {
        setor_nome: 'nome',
        setor_id: 'id',
      },
      targetMatchFieldMap: {
        setor_id: 'setor_nome',
      },
    },
    {
      entity: 'PontoSuplementacao',
      matchType: 'id',
      queryField: 'setor_id',
      fieldMap: {
        setor_nome: 'nome',
      },
    },
    {
      entity: 'PontoSuplementacao',
      matchType: 'value',
      sourceField: 'nome',
      matchFields: ['setor_nome'],
      fieldMap: {
        setor_nome: 'nome',
        setor_id: 'id',
      },
      targetMatchFieldMap: {
        setor_id: 'setor_nome',
      },
    },
    {
      entity: 'Lote',
      matchType: 'id',
      queryField: 'setor_id',
      fieldMap: {
        setor_nome: 'nome',
      },
    },
    {
      entity: 'Lote',
      matchType: 'value',
      sourceField: 'nome',
      matchFields: ['setor_nome'],
      fieldMap: {
        setor_nome: 'nome',
        setor_id: 'id',
      },
      targetMatchFieldMap: {
        setor_id: 'setor_nome',
      },
    },
    {
      entity: 'LancamentoTarefa',
      matchType: 'value',
      sourceField: 'nome',
      matchFields: ['setor_nome'],
      fieldMap: {
        setor_nome: 'nome',
      },
    },
    {
      entity: 'MovimentacaoMapa',
      matchType: 'id',
      queryField: 'setor_id',
      fieldMap: {
        setor_nome: 'nome',
      },
    },
    {
      entity: 'MovimentacaoMapa',
      matchType: 'id',
      queryField: 'setor_origem_id',
      fieldMap: {
        setor_origem_nome: 'nome',
      },
    },
    {
      entity: 'MovimentacaoMapa',
      matchType: 'id',
      queryField: 'setor_destino_id',
      fieldMap: {
        setor_destino_nome: 'nome',
      },
    },
    {
      entity: 'MovimentacaoMapa',
      matchType: 'value',
      sourceField: 'nome',
      matchFields: ['setor_nome', 'setor_origem_nome', 'setor_destino_nome', 'transferencia_origem', 'transferencia_destino'],
      fieldMap: {
        setor_nome: 'nome',
        setor_origem_nome: 'nome',
        setor_destino_nome: 'nome',
        transferencia_origem: 'nome',
        transferencia_destino: 'nome',
        setor_id: 'id',
        setor_origem_id: 'id',
        setor_destino_id: 'id',
      },
      targetMatchFieldMap: {
        setor_id: 'setor_nome',
        setor_origem_id: 'setor_origem_nome',
        setor_destino_id: 'setor_destino_nome',
      },
    },
    {
      entity: 'MovimentacaoPecuaria',
      matchType: 'id',
      queryField: 'setor_id',
      fieldMap: {
        setor_nome: 'nome',
      },
    },
    {
      entity: 'MovimentacaoPecuaria',
      matchType: 'id',
      queryField: 'setor_origem_id',
      fieldMap: {
        setor_origem_nome: 'nome',
      },
    },
    {
      entity: 'MovimentacaoPecuaria',
      matchType: 'id',
      queryField: 'setor_destino_id',
      fieldMap: {
        setor_destino_nome: 'nome',
      },
    },
    {
      entity: 'MovimentacaoPecuaria',
      matchType: 'value',
      sourceField: 'nome',
      matchFields: ['setor_nome', 'setor_origem_nome', 'setor_destino_nome', 'transferencia_origem', 'transferencia_destino'],
      fieldMap: {
        setor_nome: 'nome',
        setor_origem_nome: 'nome',
        setor_destino_nome: 'nome',
        transferencia_origem: 'nome',
        transferencia_destino: 'nome',
        setor_id: 'id',
        setor_origem_id: 'id',
        setor_destino_id: 'id',
      },
      targetMatchFieldMap: {
        setor_id: 'setor_nome',
        setor_origem_id: 'setor_origem_nome',
        setor_destino_id: 'setor_destino_nome',
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
  ],
};

// Registro literal das entidades que esta function pode tocar (P0.1-R2).
//
// Antes o código fazia `base44.asServiceRole.entities?.[nome]` com um nome vindo
// de variável. Isso é indecidível estaticamente: `gate:product-scope` não tem
// como provar que o conjunto acessado cabe no manifesto, e reprova com
// P01-SCOPE-FUNCTION-DYNAMIC-UNVERIFIABLE.
//
// Aqui cada entidade aparece como acesso literal. O nome dinâmico passa a
// indexar este mapa local — cujo domínio é visível no código — e não o SDK.
// A lista é exatamente a união das chaves-fonte e dos destinos de
// PROPAGATION_RULES; entrada desconhecida devolve null, como antes.
function buildEntityRegistry(base44) {
  const entities = base44.asServiceRole.entities;
  return {
    AreaPastagem: entities?.AreaPastagem,
    GrupoAtividade: entities?.GrupoAtividade,
    LancamentoTarefa: entities?.LancamentoTarefa,
    Lote: entities?.Lote,
    ManejoTecnicoRebanho: entities?.ManejoTecnicoRebanho,
    MovimentacaoEstoque: entities?.MovimentacaoEstoque,
    MovimentacaoMapa: entities?.MovimentacaoMapa,
    MovimentacaoPecuaria: entities?.MovimentacaoPecuaria,
    PontoSuplementacao: entities?.PontoSuplementacao,
    Produto: entities?.Produto,
    Setor: entities?.Setor,
    SuplementacaoEvento: entities?.SuplementacaoEvento,
    SuplementacaoLote: entities?.SuplementacaoLote,
    TipoTarefa: entities?.TipoTarefa,
  };
}

const ENTITY_REGISTRY_CACHE = new WeakMap();

function resolveEntityApi(base44, entityName) {
  if (!base44 || typeof entityName !== 'string' || !entityName) return null;

  let registry = ENTITY_REGISTRY_CACHE.get(base44);
  if (!registry) {
    registry = buildEntityRegistry(base44);
    ENTITY_REGISTRY_CACHE.set(base44, registry);
  }

  if (!Object.prototype.hasOwnProperty.call(registry, entityName)) return null;
  return registry[entityName] || null;
}

function normalizeValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

function getSourceFieldValue(data, sourceField) {
  if (!data) return null;
  return data?.[sourceField] ?? null;
}

function getRelevantSourceFields(rules) {
  const fields = new Set();

  rules.forEach((rule) => {
    Object.values(rule.fieldMap || {}).forEach((sourceField) => {
      if (!sourceField || sourceField === 'id') return;
      fields.add(sourceField);
    });
  });

  return [...fields];
}

async function readPayload(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('429') || message.includes('rate limit');
}

async function updateRecordWithRetry(entityApi, recordId, patch) {
  let lastError = null;

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await entityApi.update(recordId, patch);
      await sleep(180);
      return;
    } catch (error) {
      lastError = error;
      const isRateLimit = isRateLimitError(error);

      if (!isRateLimit || attempt === 10) {
        throw error;
      }

      await sleep(900 * attempt + Math.floor(Math.random() * 350));
    }
  }

  throw lastError;
}

async function getCachedEntityRecords(base44, entityName, empresaId, cache) {
  const cacheKey = `${entityName}:${empresaId || 'all'}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const entityApi = resolveEntityApi(base44, entityName);
  if (!entityApi) {
    cache.set(cacheKey, []);
    return [];
  }

  const records = empresaId
    ? await entityApi.filter({ empresa_id: empresaId }, '-created_date', 5000)
    : await entityApi.list('-created_date', 5000);

  cache.set(cacheKey, records);
  return records;
}

async function listRecordsForRule(base44, rule, sourceData, oldData, cache) {
  const entityApi = resolveEntityApi(base44, rule.entity);
  if (!entityApi) return [];

  const empresaFilter = sourceData?.empresa_id ? { empresa_id: sourceData.empresa_id } : null;
  const cachedRecords = await getCachedEntityRecords(base44, rule.entity, sourceData?.empresa_id || null, cache);

  if (rule.matchType === 'id') {
    return cachedRecords.filter((record) => record?.[rule.queryField] === sourceData.id);
  }

  const oldValue = normalizeValue(getSourceFieldValue(oldData, rule.sourceField));
  if (!oldValue) return [];

  return cachedRecords.filter((record) => {
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
    const comparisonField = rule.matchType === 'value'
      ? rule.targetMatchFieldMap?.[targetField] || targetField
      : targetField;
    const comparisonValue = record?.[comparisonField] ?? null;

    if (newValue === oldValue) return;

    if (rule.matchType === 'value' && normalizeValue(comparisonValue) !== normalizeValue(oldValue)) {
      return;
    }

    if (currentValue === newValue) return;

    patch[targetField] = newValue;
  });

  return patch;
}

async function propagateRulesForEntity(base44, entityName, rules, sourceData, oldData, cache) {
  const entityApi = resolveEntityApi(base44, entityName);
  if (!entityApi) {
    return { entity: entityName, updated_count: 0 };
  }

  const patchesByRecordId = new Map();

  for (const rule of rules) {
    const records = await listRecordsForRule(base44, rule, sourceData, oldData, cache);
    if (!records.length) continue;

    for (const record of records) {
      const patch = buildPatchForRecord(record, rule, sourceData, oldData);
      if (!Object.keys(patch).length) continue;

      const existing = patchesByRecordId.get(record.id) || {};
      patchesByRecordId.set(record.id, { ...existing, ...patch });
    }
  }

  let updatedCount = 0;
  let haltedDueToRateLimit = false;

  for (const [recordId, patch] of patchesByRecordId.entries()) {
    try {
      await updateRecordWithRetry(entityApi, recordId, patch);
      updatedCount += 1;
    } catch (error) {
      if (isRateLimitError(error)) {
        haltedDueToRateLimit = true;
        break;
      }
      throw error;
    }
  }

  return {
    entity: entityName,
    updated_count: updatedCount,
    halted_due_to_rate_limit: haltedDueToRateLimit,
    pending_count: Math.max(0, patchesByRecordId.size - updatedCount),
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

    const changedFields = Array.isArray(payload?.changed_fields) ? payload.changed_fields : [];
    const relevantSourceFields = getRelevantSourceFields(rules);
    if (changedFields.length && !changedFields.some((field) => relevantSourceFields.includes(field))) {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'Update sem alterações relevantes para propagação.',
      });
    }

    const rulesByEntity = Object.entries(
      rules.reduce((acc, rule) => {
        if (!acc[rule.entity]) acc[rule.entity] = [];
        acc[rule.entity].push(rule);
        return acc;
      }, {})
    );

    const entityCache = new Map();
    const results = [];
    for (const [entityName, entityRules] of rulesByEntity) {
      const result = await propagateRulesForEntity(base44, entityName, entityRules, sourceData, oldData, entityCache);
      results.push(result);
      await sleep(250);
    }

    const totalUpdated = results.reduce((sum, item) => sum + (item.updated_count || 0), 0);
    const haltedDueToRateLimit = results.some((item) => item.halted_due_to_rate_limit);
    const pendingCount = results.reduce((sum, item) => sum + (item.pending_count || 0), 0);

    return Response.json({
      success: true,
      source_entity: sourceEntity,
      source_id: sourceData.id,
      total_updated: totalUpdated,
      halted_due_to_rate_limit: haltedDueToRateLimit,
      pending_count: pendingCount,
      results,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});