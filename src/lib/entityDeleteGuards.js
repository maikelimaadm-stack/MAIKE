import { emitDeleteDialog } from "@/lib/deleteDialogBus";

const ENTITY_LABELS = {
  Empresa: "empresa",
  Setor: "setor",
  AreaPastagem: "área",
  CategoriaManejo: "categoria de manejo",
  Produto: "produto",
  Fornecedor: "fornecedor",
  Lote: "lote",
  Safra: "safra",
  UnidadeMedida: "unidade de medida",
  Categoria: "categoria",
  LocalEstoque: "local de estoque",
  CentroCusto: "centro de custo",
  PlanoContas: "plano de contas",
  GrupoFinanceiro: "grupo financeiro",
  FormaPagamento: "forma de pagamento",
  Maquina: "máquina",
  PontoSuplementacao: "ponto de suplementação",
  GrupoAtividade: "grupo de atividades",
  TipoTarefa: "tipo de tarefa",
};

const EMPRESA_DEPENDENCIES = [
  { entity: "Setor", fields: ["empresa_id"], label: "setores" },
  { entity: "AreaPastagem", fields: ["empresa_id"], label: "áreas" },
  { entity: "Lote", fields: ["empresa_id"], label: "lotes" },
  { entity: "MovimentacaoPecuaria", fields: ["empresa_id"], label: "movimentações pecuárias" },
  { entity: "MovimentacaoMapa", fields: ["empresa_id"], label: "movimentações do mapa" },
  { entity: "Produto", fields: ["empresa_id"], label: "produtos" },
  { entity: "Fornecedor", fields: ["empresa_id"], label: "fornecedores" },
  { entity: "MovimentacaoEstoque", fields: ["empresa_id"], label: "movimentações de estoque" },
  { entity: "LancamentoFinanceiro", fields: ["empresa_id"], label: "lançamentos financeiros" },
  { entity: "CustoSafra", fields: ["empresa_id"], label: "custos de safra" },
  { entity: "HistoricoEntrega", fields: ["empresa_id"], label: "histórico de entregas" },
  { entity: "SuplementacaoEvento", fields: ["empresa_id"], label: "lançamentos de suplementação" },
  { entity: "SuplementacaoLote", fields: ["empresa_id"], label: "lotes de suplementação" },
  { entity: "PontoSuplementacao", fields: ["empresa_id"], label: "pontos de suplementação" },
  { entity: "ControleArea", fields: ["empresa_id"], label: "controles de área" },
  { entity: "Pesagem", fields: ["empresa_id"], label: "pesagens" },
  { entity: "CentroCusto", fields: ["empresa_id"], label: "centros de custo" },
  { entity: "PlanoContas", fields: ["empresa_id"], label: "planos de contas" },
  { entity: "GrupoFinanceiro", fields: ["empresa_id"], label: "grupos financeiros" },
  { entity: "FormaPagamento", fields: ["empresa_id"], label: "formas de pagamento" },
  { entity: "Maquina", fields: ["empresa_id"], label: "máquinas" },
  { entity: "ManutencaoMaquina", fields: ["empresa_id"], label: "manutenções de máquinas" },
  { entity: "AbastecimentoMaquina", fields: ["empresa_id"], label: "abastecimentos de máquinas" },
  { entity: "OperacaoAgricola", fields: ["empresa_id"], label: "operações agrícolas" },
  { entity: "LancamentoTarefa", fields: ["empresa_id"], label: "lançamentos de tarefas" },
  { entity: "TarefaMapa", fields: ["empresa_id"], label: "tarefas do mapa" },
  { entity: "HistoricoLancamentoTarefa", fields: ["empresa_id"], label: "históricos de tarefas" },
  { entity: "HistoricoTarefaMapa", fields: ["empresa_id"], label: "históricos do mapa" },
  { entity: "ManejoTecnicoRebanho", fields: ["empresa_id"], label: "manejos técnicos" },
];

const DELETE_RULES = {
  Empresa: EMPRESA_DEPENDENCIES,
  Setor: [
    { entity: "AreaPastagem", fields: ["setor_id"], label: "áreas" },
    { entity: "MovimentacaoMapa", fields: ["setor_id", "setor_origem_id", "setor_destino_id"], label: "movimentações do mapa" },
    { entity: "MovimentacaoPecuaria", fields: ["setor_id", "setor_origem_id", "setor_destino_id"], label: "movimentações pecuárias" },
  ],
  AreaPastagem: [
    { entity: "Lote", fields: ["area_entrada_id", "area_atual_id"], label: "lotes" },
    { entity: "MovimentacaoMapa", fields: ["area_id", "area_origem_id", "area_destino_id"], label: "movimentações do mapa" },
    { entity: "MovimentacaoPecuaria", fields: ["area_origem_id", "area_destino_id"], label: "movimentações pecuárias" },
    { entity: "SuplementacaoEvento", fields: ["area_id"], arrayFields: ["area_ids"], label: "lançamentos de suplementação" },
    { entity: "PontoSuplementacao", fields: ["area_vinculada_id"], arrayFields: ["area_vinculada_ids"], label: "pontos de suplementação" },
    { entity: "LancamentoTarefa", fields: ["area_id"], label: "lançamentos de tarefas" },
    { entity: "TarefaMapa", fields: ["area_id"], label: "tarefas do mapa" },
    { entity: "ControleArea", fields: ["area_id"], label: "controles de área" },
    { entity: "OperacaoAgricola", fields: ["area_id"], label: "operações agrícolas" },
    { entity: "ManejoTecnicoRebanho", fields: ["area_id"], label: "manejos técnicos" },
  ],
  CategoriaManejo: [
    { entity: "Lote", fields: ["categoria_manejo_id", "categoria_manejo_entrada_id"], label: "lotes" },
    { entity: "Lote", valueMatches: [{ sourceField: "nome", targetFields: ["categoria_manejo_nome", "categoria_manejo_entrada_nome", "categoria", "categoria_entrada"] }], label: "lotes" },
    { entity: "MovimentacaoPecuaria", valueMatches: [{ sourceField: "nome", targetFields: ["categoria_animal", "categoria_nova"] }], label: "movimentações pecuárias" },
    { entity: "ManejoTecnicoRebanho", valueMatches: [{ sourceField: "nome", targetFields: ["categoria"] }], label: "manejos técnicos" },
  ],
  Produto: [
    { entity: "CustoSafra", fields: ["produto_id"], label: "custos de safra" },
    { entity: "HistoricoEntrega", fields: ["produto_id"], label: "histórico de entregas" },
    { entity: "MovimentacaoEstoque", fields: ["produto_id"], label: "movimentações de estoque" },
    { entity: "SuplementacaoEvento", fields: ["produto_id"], label: "lançamentos de suplementação" },
    { entity: "OperacaoAgricola", valueMatches: [{ sourceField: "nome_produto", targetFields: ["produto_aplicado"] }], label: "operações agrícolas" },
    { entity: "ManejoTecnicoRebanho", valueMatches: [{ sourceField: "nome_produto", targetFields: ["produto", "produto_utilizado"] }], label: "manejos técnicos" },
    { entity: "PontoSuplementacao", valueMatches: [{ sourceField: "nome_produto", targetFields: ["produto_padrao"] }], label: "pontos de suplementação" },
  ],
  Fornecedor: [
    { entity: "CustoSafra", fields: ["fornecedor_id"], label: "custos de safra" },
    { entity: "HistoricoEntrega", fields: ["fornecedor_id"], label: "histórico de entregas" },
    { entity: "MovimentacaoEstoque", fields: ["fornecedor_id"], label: "movimentações de estoque" },
    { entity: "Lote", fields: ["fornecedor_id"], label: "lotes" },
    { entity: "LancamentoFinanceiro", fields: ["fornecedor_id"], label: "lançamentos financeiros" },
    { entity: "ManutencaoMaquina", fields: ["fornecedor_id"], label: "manutenções de máquinas" },
    { entity: "AbastecimentoMaquina", fields: ["fornecedor_id"], label: "abastecimentos de máquinas" },
    { entity: "MovimentacaoPecuaria", valueMatches: [{ sourceField: "nome", targetFields: ["fornecedor_origem"] }], label: "movimentações pecuárias" },
  ],
  Lote: [
    { entity: "MovimentacaoMapa", fields: ["lote_id"], label: "movimentações do mapa" },
    { entity: "SuplementacaoLote", fields: ["lote_id"], label: "lotes de suplementação" },
    { entity: "LancamentoTarefa", fields: ["lote_id"], label: "lançamentos de tarefas" },
    { entity: "TarefaMapa", fields: ["lote_id"], label: "tarefas do mapa" },
    { entity: "MovimentacaoPecuaria", fields: ["lote_id"], label: "movimentações pecuárias" },
    { entity: "ManejoTecnicoRebanho", fields: ["lote_id"], label: "manejos técnicos" },
  ],
  Safra: [
    { entity: "CustoSafra", fields: ["safra_id"], label: "custos de safra" },
    { entity: "HistoricoEntrega", fields: ["safra_id"], label: "histórico de entregas" },
    { entity: "MovimentacaoEstoque", fields: ["safra_id"], label: "movimentações de estoque" },
    { entity: "ControleArea", fields: ["safra_id"], label: "controles de área" },
    { entity: "LancamentoFinanceiro", fields: ["safra_id"], label: "lançamentos financeiros" },
    { entity: "OperacaoAgricola", fields: ["safra_id"], label: "operações agrícolas" },
  ],
  UnidadeMedida: [
    { entity: "Produto", valueMatches: [{ sourceField: "sigla", targetFields: ["unidade_medida"] }], label: "produtos" },
    { entity: "MovimentacaoEstoque", valueMatches: [{ sourceField: "sigla", targetFields: ["unidade_medida"] }], label: "movimentações de estoque" },
    { entity: "ManejoTecnicoRebanho", valueMatches: [{ sourceField: "sigla", targetFields: ["unidade"] }], label: "manejos técnicos" },
  ],
  Categoria: [
    { entity: "Produto", valueMatches: [{ sourceField: "nome", targetFields: ["categoria"] }], label: "produtos" },
  ],
  LocalEstoque: [
    { entity: "Produto", valueMatches: [{ sourceField: "nome", targetFields: ["local_estoque"] }], label: "produtos" },
    { entity: "LancamentoFinanceiro", valueMatches: [{ sourceField: "nome", targetFields: ["local_estoque"] }], label: "lançamentos financeiros" },
    { entity: "MovimentacaoEstoque", valueMatches: [{ sourceField: "nome", targetFields: ["local_origem", "local_destino", "local_estoque_origem", "local_estoque_destino"] }], label: "movimentações de estoque" },
    { entity: "PontoSuplementacao", valueMatches: [{ sourceField: "nome", targetFields: ["local_estoque_nome"] }], label: "pontos de suplementação" },
  ],
  CentroCusto: [
    { entity: "LancamentoFinanceiro", fields: ["centro_custo_id"], label: "lançamentos financeiros" },
    { entity: "MovimentacaoEstoque", fields: ["centro_custo_id"], label: "movimentações de estoque" },
    { entity: "CustoSafra", fields: ["centro_custo_id"], label: "custos de safra" },
  ],
  PlanoContas: [
    { entity: "PlanoContas", fields: ["plano_pai_id"], label: "subcontas" },
    { entity: "LancamentoFinanceiro", fields: ["plano_contas_id"], label: "lançamentos financeiros" },
  ],
  GrupoFinanceiro: [
    { entity: "GrupoFinanceiro", fields: ["grupo_pai_id"], label: "subgrupos financeiros" },
    { entity: "LancamentoFinanceiro", fields: ["grupo_id"], label: "lançamentos financeiros" },
  ],
  FormaPagamento: [
    { entity: "LancamentoFinanceiro", fields: ["forma_pagamento_id"], label: "lançamentos financeiros" },
  ],
  Maquina: [
    { entity: "ManutencaoMaquina", fields: ["maquina_id"], label: "manutenções de máquinas" },
    { entity: "AbastecimentoMaquina", fields: ["maquina_id"], label: "abastecimentos de máquinas" },
    { entity: "OperacaoAgricola", fields: ["maquina_id"], label: "operações agrícolas" },
    { entity: "MovimentacaoEstoque", fields: ["maquina_vinculada_id"], label: "movimentações de estoque" },
  ],
  PontoSuplementacao: [
    { entity: "SuplementacaoEvento", fields: ["ponto_suplementacao_id"], label: "lançamentos de suplementação" },
    { entity: "LancamentoTarefa", fields: ["ponto_suplementacao_id"], label: "lançamentos de tarefas" },
    { entity: "MovimentacaoEstoque", fields: ["ponto_suplementacao_id", "deposito_id"], label: "movimentações de estoque" },
  ],
  GrupoAtividade: [
    { entity: "TipoTarefa", fields: ["grupo_atividade_id"], label: "tipos de tarefa" },
    { entity: "LancamentoTarefa", fields: ["grupo_atividade_id"], label: "lançamentos de tarefas" },
    { entity: "TarefaMapa", fields: ["grupo_atividade_id"], label: "tarefas do mapa" },
  ],
  TipoTarefa: [
    { entity: "LancamentoTarefa", fields: ["tipo_tarefa_id"], label: "lançamentos de tarefas" },
    { entity: "TarefaMapa", fields: ["tipo_tarefa_id"], label: "tarefas do mapa" },
  ],
};

async function listEntityRecords(base44, entityName) {
  const entityApi = base44.entities?.[entityName];
  if (!entityApi?.list) return [];

  try {
    return await entityApi.list("-created_date", 5000);
  } catch {
    return [];
  }
}

function normalizeValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toLowerCase();
}

function fieldMatchesValue(recordValue, expectedValue) {
  if (Array.isArray(recordValue)) {
    return recordValue.some((item) => normalizeValue(item) === expectedValue);
  }
  return normalizeValue(recordValue) === expectedValue;
}

function hasMatchingReference(record, id, rule, currentRecord) {
  const matchesField = (rule.fields || []).some((field) => record?.[field] === id);
  const matchesArray = (rule.arrayFields || []).some((field) => Array.isArray(record?.[field]) && record[field].includes(id));
  const matchesValue = (rule.valueMatches || []).some(({ sourceField, targetFields }) => {
    const sourceValue = normalizeValue(currentRecord?.[sourceField]);
    if (!sourceValue) return false;
    return (targetFields || []).some((field) => fieldMatchesValue(record?.[field], sourceValue));
  });
  return matchesField || matchesArray || matchesValue;
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