import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

const BACKFILL_RULES = {
  Setor: [
    { entity: 'AreaPastagem', matchType: 'id', queryField: 'setor_id', fieldMap: { setor_nome: 'nome' } },
    { entity: 'AreaPastagem', matchType: 'value', sourceField: 'nome', matchFields: ['setor_nome'], fieldMap: { setor_nome: 'nome' } },
    { entity: 'LancamentoTarefa', matchType: 'value', sourceField: 'nome', matchFields: ['setor_nome'], fieldMap: { setor_nome: 'nome' } },
    { entity: 'MovimentacaoMapa', matchType: 'id', queryField: 'setor_id', fieldMap: { setor_nome: 'nome' } },
    { entity: 'MovimentacaoMapa', matchType: 'id', queryField: 'setor_origem_id', fieldMap: { setor_origem_nome: 'nome' } },
    { entity: 'MovimentacaoMapa', matchType: 'id', queryField: 'setor_destino_id', fieldMap: { setor_destino_nome: 'nome' } },
    { entity: 'MovimentacaoMapa', matchType: 'value', sourceField: 'nome', matchFields: ['setor_nome', 'setor_origem_nome', 'setor_destino_nome', 'transferencia_origem', 'transferencia_destino'], fieldMap: { setor_nome: 'nome', setor_origem_nome: 'nome', setor_destino_nome: 'nome', transferencia_origem: 'nome', transferencia_destino: 'nome' } },
    { entity: 'MovimentacaoPecuaria', matchType: 'id', queryField: 'setor_id', fieldMap: { setor_nome: 'nome' } },
    { entity: 'MovimentacaoPecuaria', matchType: 'id', queryField: 'setor_origem_id', fieldMap: { setor_origem_nome: 'nome' } },
    { entity: 'MovimentacaoPecuaria', matchType: 'id', queryField: 'setor_destino_id', fieldMap: { setor_destino_nome: 'nome' } },
    { entity: 'MovimentacaoPecuaria', matchType: 'value', sourceField: 'nome', matchFields: ['setor_nome', 'setor_origem_nome', 'setor_destino_nome', 'transferencia_origem', 'transferencia_destino'], fieldMap: { setor_nome: 'nome', setor_origem_nome: 'nome', setor_destino_nome: 'nome', transferencia_origem: 'nome', transferencia_destino: 'nome' } },
  ],
  CategoriaManejo: [
    { entity: 'Lote', matchType: 'id', queryField: 'categoria_manejo_id', fieldMap: { categoria_manejo_nome: 'nome', categoria: 'categoria_oficial' } },
    { entity: 'Lote', matchType: 'id', queryField: 'categoria_manejo_entrada_id', fieldMap: { categoria_manejo_entrada_nome: 'nome', categoria_entrada: 'categoria_oficial' } },
    { entity: 'Lote', matchType: 'value', sourceField: 'nome', matchFields: ['categoria_manejo_nome', 'categoria_manejo_entrada_nome'], fieldMap: { categoria_manejo_nome: 'nome', categoria_manejo_entrada_nome: 'nome' } },
    { entity: 'Lote', matchType: 'value', sourceField: 'categoria_oficial', matchFields: ['categoria', 'categoria_entrada'], fieldMap: { categoria: 'categoria_oficial', categoria_entrada: 'categoria_oficial' } },
    { entity: 'MovimentacaoPecuaria', matchType: 'value', sourceField: 'nome', matchFields: ['categoria_animal', 'categoria_nova', 'transferencia_origem', 'transferencia_destino'], fieldMap: { categoria_animal: 'nome', categoria_nova: 'nome', transferencia_origem: 'nome', transferencia_destino: 'nome' } },
    { entity: 'MovimentacaoPecuaria', matchType: 'value', sourceField: 'categoria_oficial', matchFields: ['categoria_animal', 'categoria_nova', 'transferencia_origem', 'transferencia_destino'], fieldMap: { categoria_animal: 'categoria_oficial', categoria_nova: 'categoria_oficial', transferencia_origem: 'categoria_oficial', transferencia_destino: 'categoria_oficial' } },
    { entity: 'ManejoTecnicoRebanho', matchType: 'value', sourceField: 'nome', matchFields: ['categoria'], fieldMap: { categoria: 'nome' } },
    { entity: 'ManejoTecnicoRebanho', matchType: 'value', sourceField: 'categoria_oficial', matchFields: ['categoria'], fieldMap: { categoria: 'categoria_oficial' } },
    { entity: 'FatorConsumoCategoria', matchType: 'value', sourceField: 'nome', matchFields: ['categoria'], fieldMap: { categoria: 'nome' } },
    { entity: 'FatorConsumoCategoria', matchType: 'value', sourceField: 'categoria_oficial', matchFields: ['categoria'], fieldMap: { categoria: 'categoria_oficial' } },
    { entity: 'SuplementacaoLote', matchType: 'value', sourceField: 'nome', matchFields: ['categoria'], fieldMap: { categoria: 'nome' } },
    { entity: 'SuplementacaoLote', matchType: 'value', sourceField: 'categoria_oficial', matchFields: ['categoria'], fieldMap: { categoria: 'categoria_oficial' } },
  ],
};

function normalizeValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

function getSourceValue(record, field) {
  return record?.[field] ?? null;
}

async function getScopedRecords(entityApi, empresaId) {
  if (!entityApi) return [];
  if (empresaId) {
    try {
      return await entityApi.filter({ empresa_id: empresaId }, '-created_date', 5000);
    } catch {
      const records = await entityApi.list('-created_date', 5000);
      return records.filter((record) => record?.empresa_id === empresaId);
    }
  }
  return await entityApi.list('-created_date', 5000);
}

async function getTargetRecords(entityApi, rule, sourceRecord, empresaId) {
  if (rule.matchType === 'id') {
    const query = { ...(empresaId ? { empresa_id: empresaId } : {}), [rule.queryField]: sourceRecord.id };
    try {
      return await entityApi.filter(query, '-created_date', 5000);
    } catch {
      const records = await getScopedRecords(entityApi, empresaId);
      return records.filter((record) => record?.[rule.queryField] === sourceRecord.id);
    }
  }

  const matchValue = normalizeValue(getSourceValue(sourceRecord, rule.sourceField));
  if (!matchValue) return [];

  const records = await getScopedRecords(entityApi, empresaId);
  return records.filter((record) => (rule.matchFields || []).some((field) => normalizeValue(record?.[field]) === matchValue));
}

function buildPatch(record, rule, sourceRecord) {
  const patch = {};
  for (const [targetField, sourceField] of Object.entries(rule.fieldMap || {})) {
    const newValue = getSourceValue(sourceRecord, sourceField);
    if (newValue === null || newValue === undefined || newValue === '') continue;
    if (record?.[targetField] === newValue) continue;
    patch[targetField] = newValue;
  }
  return patch;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const payload = await req.json().catch(() => ({}));
    const empresaId = payload?.empresaId || null;
    const entityNames = Array.isArray(payload?.entityNames) && payload.entityNames.length
      ? payload.entityNames
      : ['Setor', 'CategoriaManejo'];

    const summary = [];
    let totalUpdated = 0;

    for (const entityName of entityNames) {
      const sourceApi = base44.asServiceRole.entities?.[entityName];
      const rules = BACKFILL_RULES[entityName] || [];
      if (!sourceApi || !rules.length) continue;

      const sourceRecords = await getScopedRecords(sourceApi, empresaId);
      let entityUpdated = 0;

      for (const sourceRecord of sourceRecords) {
        for (const rule of rules) {
          const targetApi = base44.asServiceRole.entities?.[rule.entity];
          if (!targetApi) continue;

          const targetRecords = await getTargetRecords(targetApi, rule, sourceRecord, empresaId || sourceRecord?.empresa_id || null);
          for (const targetRecord of targetRecords) {
            const patch = buildPatch(targetRecord, rule, sourceRecord);
            if (!Object.keys(patch).length) continue;
            await targetApi.update(targetRecord.id, patch);
            entityUpdated += 1;
            totalUpdated += 1;
          }
        }
      }

      summary.push({ entityName, updated: entityUpdated, sourceCount: sourceRecords.length });
    }

    return Response.json({ success: true, totalUpdated, summary });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});