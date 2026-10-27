/**
 * Propagação nativa de referências denormalizadas (P5.5).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { documentoComoPublico } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import { PROPAGATION_RULES } from './propagationRules.js';

const DELEGATES = {
  AreaPastagem: 'areaPastagem',
  GrupoAtividade: 'grupoAtividade',
  LancamentoTarefa: 'lancamentoTarefa',
  Lote: 'lote',
  ManejoTecnicoRebanho: 'manejoTecnicoRebanho',
  MovimentacaoEstoque: 'movimentacaoEstoque',
  MovimentacaoMapa: 'movimentacaoMapa',
  MovimentacaoPecuaria: 'movimentacaoPecuaria',
  PontoSuplementacao: 'pontoSuplementacao',
  Produto: 'produto',
  Setor: 'setor',
  SuplementacaoEvento: 'suplementacaoEvento',
  SuplementacaoLote: 'suplementacaoLote',
  TipoTarefa: 'tipoTarefa',
};

const JSON_ENTITIES = new Set([
  'MovimentacaoMapa',
  'MovimentacaoPecuaria',
  'SuplementacaoEvento',
  'SuplementacaoLote',
  'ManejoTecnicoRebanho',
]);

const normalizeValue = (value) => (value === null || value === undefined ? '' : String(value).trim().toLowerCase());

const getSourceFieldValue = (data, sourceField) => data?.[sourceField] ?? null;

const getRelevantSourceFields = (rules) => {
  const fields = new Set();
  for (const rule of rules) {
    for (const sourceField of Object.values(rule.fieldMap || {})) {
      if (sourceField && sourceField !== 'id') fields.add(sourceField);
    }
  }
  return [...fields];
};

const buildPatchForRecord = (record, rule, sourceData, oldData) => {
  const patch = {};
  for (const [targetField, sourceField] of Object.entries(rule.fieldMap || {})) {
    const newValue = getSourceFieldValue(sourceData, sourceField);
    const oldValue = getSourceFieldValue(oldData, sourceField);
    const currentValue = record?.[targetField] ?? null;
    const comparisonField =
      rule.matchType === 'value' ? rule.targetMatchFieldMap?.[targetField] || targetField : targetField;
    const comparisonValue = record?.[comparisonField] ?? null;
    if (newValue === oldValue) continue;
    if (rule.matchType === 'value' && normalizeValue(comparisonValue) !== normalizeValue(oldValue)) continue;
    if (currentValue === newValue) continue;
    patch[targetField] = newValue;
  }
  return patch;
};

const listRecords = async (prisma, clienteId, entityName, empresaId) => {
  const delegate = DELEGATES[entityName];
  if (!delegate || !prisma[delegate]) return [];
  const where = { cliente_id: clienteId };
  if (empresaId) where.empresa_id = empresaId;
  const rows = await prisma[delegate].findMany({ where, take: 5000, orderBy: { createdAt: 'desc' } });
  if (JSON_ENTITIES.has(entityName)) {
    return rows.map(documentoComoPublico);
  }
  return rows;
};

const applyPatch = async (prisma, clienteId, entityName, recordId, patch) => {
  const delegate = DELEGATES[entityName];
  if (!delegate || !prisma[delegate]) return;
  if (JSON_ENTITIES.has(entityName)) {
    const existente = await prisma[delegate].findUnique({
      where: { cliente_id_id: { cliente_id: clienteId, id: recordId } },
    });
    if (!existente) return;
    const dados = { ...(existente.dados || {}), ...patch };
    await prisma[delegate].update({
      where: { cliente_id_id: { cliente_id: clienteId, id: recordId } },
      data: { dados },
    });
    return;
  }
  await prisma[delegate].update({
    where: { cliente_id_id: { cliente_id: clienteId, id: recordId } },
    data: patch,
  });
};

/** @param {{auth: {clienteId: string}}} contexto */
export const sincronizarReferencias = async (contexto, payload) => {
  const clienteId = contexto?.auth?.clienteId;
  const event = payload?.event || {};
  const sourceEntity = event?.entity_name || payload?.entity_name || null;
  const sourceData = payload?.data || payload?.new_data || null;
  const oldData = payload?.old_data || payload?.previous_data || null;

  if (!clienteId || !sourceEntity || event?.type !== 'update' || !sourceData?.id || !oldData) {
    return { success: true, skipped: true, reason: 'Nenhum update compatível recebido.' };
  }

  const rules = PROPAGATION_RULES[sourceEntity] || [];
  if (!rules.length) {
    return { success: true, skipped: true, reason: `Nenhuma regra cadastrada para ${sourceEntity}.` };
  }

  const changedFields = Array.isArray(payload?.changed_fields) ? payload.changed_fields : [];
  const relevant = getRelevantSourceFields(rules);
  if (changedFields.length && !changedFields.some((field) => relevant.includes(field))) {
    return { success: true, skipped: true, reason: 'Update sem alterações relevantes para propagação.' };
  }

  const prisma = getPrismaClient();
  let totalUpdated = 0;
  const empresaId = sourceData?.empresa_id || null;

  for (const rule of rules) {
    const records = await listRecords(prisma, clienteId, rule.entity, empresaId);
    const candidatos =
      rule.matchType === 'id'
        ? records.filter((record) => record?.[rule.queryField] === sourceData.id)
        : records.filter((record) => {
            const oldValue = normalizeValue(getSourceFieldValue(oldData, rule.sourceField));
            if (!oldValue) return false;
            if (empresaId && record?.empresa_id && record.empresa_id !== empresaId) return false;
            return (rule.matchFields || []).some((field) => normalizeValue(record?.[field]) === oldValue);
          });

    for (const record of candidatos) {
      const patch = buildPatchForRecord(record, rule, sourceData, oldData);
      if (!Object.keys(patch).length) continue;
      await applyPatch(prisma, clienteId, rule.entity, record.id, patch);
      totalUpdated += 1;
    }
  }

  return {
    success: true,
    source_entity: sourceEntity,
    source_id: sourceData.id,
    total_updated: totalUpdated,
    halted_due_to_rate_limit: false,
    pending_count: 0,
    results: [],
  };
};
