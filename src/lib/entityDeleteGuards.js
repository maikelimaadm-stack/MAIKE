const ENTITY_LABELS = {
  Setor: "setor",
  AreaPastagem: "área",
  Produto: "produto",
  Fornecedor: "fornecedor",
  Lote: "lote",
  Safra: "safra",
};

const DELETE_RULES = {
  Setor: [
    { entity: "AreaPastagem", fields: ["setor_id"], label: "áreas" },
    { entity: "MovimentacaoMapa", fields: ["setor_id", "setor_origem_id", "setor_destino_id"], label: "movimentações" },
  ],
  AreaPastagem: [
    { entity: "Lote", fields: ["area_entrada_id", "area_atual_id"], label: "lotes" },
    { entity: "MovimentacaoMapa", fields: ["area_id", "area_origem_id", "area_destino_id"], label: "movimentações" },
    { entity: "SuplementacaoEvento", fields: ["area_id"], arrayFields: ["area_ids"], label: "lançamentos de suplementação" },
    { entity: "LancamentoTarefa", fields: ["area_id"], label: "lançamentos de tarefas" },
    { entity: "TarefaMapa", fields: ["area_id"], label: "tarefas do mapa" },
    { entity: "ControleArea", fields: ["area_id"], label: "controles de área" },
  ],
  Produto: [
    { entity: "CustoSafra", fields: ["produto_id"], label: "custos de safra" },
    { entity: "HistoricoEntrega", fields: ["produto_id"], label: "histórico de entregas" },
    { entity: "MovimentacaoEstoque", fields: ["produto_id"], label: "movimentações de estoque" },
    { entity: "SuplementacaoEvento", fields: ["produto_id"], label: "lançamentos de suplementação" },
  ],
  Fornecedor: [
    { entity: "CustoSafra", fields: ["fornecedor_id"], label: "custos de safra" },
    { entity: "HistoricoEntrega", fields: ["fornecedor_id"], label: "histórico de entregas" },
    { entity: "MovimentacaoEstoque", fields: ["fornecedor_id"], label: "movimentações de estoque" },
    { entity: "Lote", fields: ["fornecedor_id"], label: "lotes" },
  ],
  Lote: [
    { entity: "MovimentacaoMapa", fields: ["lote_id"], label: "movimentações" },
    { entity: "SuplementacaoLote", fields: ["lote_id"], label: "lançamentos de suplementação" },
    { entity: "LancamentoTarefa", fields: ["lote_id"], label: "lançamentos de tarefas" },
    { entity: "TarefaMapa", fields: ["lote_id"], label: "tarefas do mapa" },
    { entity: "MovimentacaoPecuaria", fields: ["lote_id"], label: "movimentações pecuárias" },
  ],
  Safra: [
    { entity: "CustoSafra", fields: ["safra_id"], label: "custos de safra" },
    { entity: "HistoricoEntrega", fields: ["safra_id"], label: "histórico de entregas" },
    { entity: "MovimentacaoEstoque", fields: ["safra_id"], label: "movimentações de estoque" },
    { entity: "ControleArea", fields: ["safra_id"], label: "controles de área" },
  ],
};

async function listEntityRecords(base44, entityName) {
  const entityApi = base44.entities?.[entityName];
  if (!entityApi?.list) return [];
  return await entityApi.list("-created_date", 5000);
}

function hasMatchingReference(record, id, rule) {
  const matchesField = (rule.fields || []).some((field) => record?.[field] === id);
  const matchesArray = (rule.arrayFields || []).some((field) => Array.isArray(record?.[field]) && record[field].includes(id));
  return matchesField || matchesArray;
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
        if (empresaId && record?.empresa_id && record.empresa_id !== empresaId) return false;
        return hasMatchingReference(record, id, rule);
      }).length;

      return { ...rule, linkedCount };
    })
  );

  const blockedBy = checks.find((item) => item.linkedCount > 0);
  if (!blockedBy) return true;

  const entityLabel = ENTITY_LABELS[entityName] || "registro";
  throw new Error(`Não é possível excluir este ${entityLabel} porque existem registros vinculados em ${blockedBy.label}.`);
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