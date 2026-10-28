import React from "react";
import { Badge } from "@/components/ui/badge";
import { Building2 } from "lucide-react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";

export const EMPRESAS_COLUNAS = [
  { id: "numero_empresa", label: "Nº", default: true, sortable: true, width: 56, align: "right" },
  { id: "logotipo", label: "Logo", default: true, sortable: false, width: 72 },
  { id: "apelido", label: "Apelido", default: true, sortable: true, width: 140 },
  { id: "nome", label: "Nome/Razão Social", default: true, sortable: true, width: 220 },
  { id: "tipo", label: "Tipo", default: true, sortable: true, width: 100 },
  { id: "documento", label: "CPF/CNPJ", default: true, sortable: false, width: 140 },
  { id: "telefone", label: "Telefone", default: false, sortable: false, width: 130 },
  { id: "cidade", label: "Cidade", default: true, sortable: true, width: 160 },
];

/**
 * @param {object} empresa
 * @param {string} colId
 */
export function getEmpresaFieldValue(empresa, colId) {
  if (colId === "numero_empresa") {
    const n = empresa?.numero_empresa;
    return n != null && n !== "" ? String(n) : "";
  }
  if (colId === "logotipo") return empresa.logotipo_url ? "Com logo" : "";
  if (colId === "apelido") return empresa.apelido || "";
  if (colId === "nome") return empresa.nome || "";
  if (colId === "tipo") return empresa.tipo_pessoa || "";
  if (colId === "documento") {
    return empresa.tipo_pessoa === "Física" ? empresa.cpf || "" : empresa.cnpj || "";
  }
  if (colId === "telefone") return empresa.telefone || "";
  if (colId === "cidade") {
    return empresa.cidade ? `${empresa.cidade} - ${empresa.estado || ""}`.trim() : "";
  }
  return "";
}

/**
 * @param {object} empresa
 * @param {string} colId
 */
function renderCell(empresa, colId) {
  if (colId === "numero_empresa") {
    const n = empresa?.numero_empresa;
    return n != null && n > 0 ? (
      <span className="font-mono tabular-nums text-slate-800">{n}</span>
    ) : (
      <span className="text-[11px] text-amber-700">Pendente</span>
    );
  }
  if (colId === "logotipo") {
    return empresa.logotipo_url ? (
      <img
        src={empresa.logotipo_url}
        alt={empresa.apelido || ""}
        className="h-10 w-10 object-contain border rounded"
      />
    ) : (
      <div className="h-10 w-10 bg-slate-100 rounded flex items-center justify-center">
        <Building2 className="w-5 h-5 text-slate-400" />
      </div>
    );
  }
  if (colId === "apelido") return <span className="font-semibold">{empresa.apelido || "–"}</span>;
  if (colId === "nome") return empresa.nome || "–";
  if (colId === "tipo") {
    return (
      <Badge
        variant="outline"
        className={`text-xs ${empresa.tipo_pessoa === "Física" ? "bg-blue-50 text-blue-700 border-blue-300" : "bg-purple-50 text-purple-700 border-purple-300"}`}
      >
        {empresa.tipo_pessoa || "–"}
      </Badge>
    );
  }
  if (colId === "documento") {
    return (
      <span className="font-mono">
        {empresa.tipo_pessoa === "Física" ? empresa.cpf || "–" : empresa.cnpj || "–"}
      </span>
    );
  }
  if (colId === "telefone") return empresa.telefone || "–";
  if (colId === "cidade") {
    return empresa.cidade ? `${empresa.cidade} - ${empresa.estado || ""}` : "–";
  }
  return "–";
}

export default function TabelaEmpresas({
  empresas = [],
  onEdit,
  isLoading,
  showConfigColunas,
  setShowConfigColunas,
  searchQuery = "",
  resetFiltersKey = 0,
  onSelectionChange,
  onFiltersActiveChange,
  viewMode,
  displayLimit = undefined,
  onListMetrics = undefined,
  cardFields,
  cardsPerRow,
  configureColumnsAnchorRef,
  matchesSearch,
}) {
  return (
    <CadastroBase1Grade
      rows={empresas}
      columns={EMPRESAS_COLUNAS}
      storageKey="colunas_empresas_v2"
      droppableId="colunas-empresas"
      getFieldValue={getEmpresaFieldValue}
      renderCell={renderCell}
      defaultSortKey="apelido"
      emptyText="Nenhuma empresa"
      isLoading={isLoading}
      onOpen={onEdit}
      showConfigColunas={showConfigColunas}
      setShowConfigColunas={setShowConfigColunas}
      searchQuery={searchQuery}
      resetFiltersKey={resetFiltersKey}
      configureColumnsAnchorRef={configureColumnsAnchorRef}
      onSelectionChange={onSelectionChange}
      onFiltersActiveChange={onFiltersActiveChange}
      viewMode={viewMode}
      displayLimit={displayLimit}
      onListMetrics={onListMetrics}
      cardFields={cardFields}
      cardsPerRow={cardsPerRow}
      cardsTitleColId="nome"
      cardsCodeColId="numero_empresa"
      matchesSearch={
        matchesSearch ??
        ((empresa, q) => {
          const searchLower = q.toLowerCase();
          const numStr = empresa.numero_empresa != null ? String(empresa.numero_empresa) : "";
          return (
            numStr.includes(q.trim()) ||
            empresa.nome?.toLowerCase().includes(searchLower) ||
            empresa.apelido?.toLowerCase().includes(searchLower) ||
            empresa.cidade?.toLowerCase().includes(searchLower) ||
            empresa.cpf?.includes(searchLower) ||
            empresa.cnpj?.includes(searchLower) ||
            empresa.email?.toLowerCase().includes(searchLower)
          );
        })
      }
    />
  );
}
