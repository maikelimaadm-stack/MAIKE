import { emitDeleteDialog } from "@/lib/deleteDialogBus";
import { DELETE_RULES, ENTITY_LABELS, hasMatchingReference } from "@/domain/deleteRules";

export { DELETE_RULES, ENTITY_LABELS } from "@/domain/deleteRules";

async function listEntityRecords(base44, entityName) {
  const entityApi = base44.entities?.[entityName];
  if (!entityApi?.list) return [];

  try {
    return await entityApi.list("-created_date", 5000);
  } catch {
    return [];
  }
}

export async function ensureDeleteAllowed(base44, entityName, id) {
  const rules = DELETE_RULES[entityName];
  if (!rules?.length) return true;

  const entityRecords = await listEntityRecords(base44, entityName);
  const currentRecord = entityRecords.find((item) => item.id === id);
  const empresaId = currentRecord?.empresa_id;

  const checks = await Promise.all(
    rules.map(async (rule) => {
      const records = await listEntityRecords(base44, rule.entity);
      const linkedCount = records.filter((record) => {
        if (entityName !== "Empresa" && empresaId && record?.empresa_id && record.empresa_id !== empresaId) return false;
        return hasMatchingReference(record, id, rule, currentRecord);
      }).length;

      return { ...rule, linkedCount };
    })
  );

  const blockedBy = checks.find((item) => item.linkedCount > 0);
  if (!blockedBy) return true;

  const entityLabel = ENTITY_LABELS[entityName] || "registro";
  const total = blockedBy.linkedCount;
  const registroTexto = total === 1 ? "1 registro vinculado" : `${total} registros vinculados`;
  const message = `Não é possível excluir este ${entityLabel} porque existem ${registroTexto} em ${blockedBy.label}.`;
  emitDeleteDialog(message);
  throw new Error(message);
}

export function applyDeleteGuards(base44) {
  Object.keys(DELETE_RULES).forEach((entityName) => {
    const entityApi = base44.entities?.[entityName];
    if (!entityApi?.delete || entityApi.__deleteGuardApplied) return;

    const originalDelete = entityApi.delete.bind(entityApi);

    entityApi.delete = async (id, ...args) => {
      await ensureDeleteAllowed(base44, entityName, id);
      return originalDelete(id, ...args);
    };

    entityApi.__deleteGuardApplied = true;
  });
}