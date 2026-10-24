import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";

const COLUNAS = [
  { id: "login", label: "Login", default: true, sortable: true, width: 180 },
  { id: "nome", label: "Nome", default: true, sortable: true, width: 220 },
  { id: "status", label: "Status", default: true, sortable: true, align: "center", width: 100 },
];

/**
 * @param {object} conta
 * @param {string} colId
 */
function getFieldValue(conta, colId) {
  if (colId === "login") return conta.login || conta.email || "";
  if (colId === "nome") return conta.nome || conta.full_name || "";
  if (colId === "status") return conta.ativo === false ? "Inativa" : "Ativa";
  return "";
}

/**
 * @param {object} conta
 * @param {string} colId
 */
function renderCell(conta, colId) {
  if (colId === "login") {
    return <span className="font-mono">{conta.login || conta.email || "—"}</span>;
  }
  if (colId === "nome") return conta.nome || conta.full_name || "—";
  if (colId === "status") {
    return conta.ativo === false ? (
      <span className="inline-block px-2 py-0.5 rounded border text-[10px] text-slate-600">Inativa</span>
    ) : (
      <span className="inline-block px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px]">Ativa</span>
    );
  }
  return "—";
}

export default function TabelaContasAcesso({
  contas = [],
  currentUser,
  onEdit,
  isLoading,
  searchQuery = "",
  chromeLayout = false,
  selectedIds = [],
  onSelectionChange,
}) {
  const loginAtual = (currentUser?.login || currentUser?.email || "").trim().toLowerCase();

  const grade = (
    <CadastroBase1Grade
      rows={contas}
      columns={COLUNAS}
      storageKey="colunas_contas_acesso_v1"
      droppableId="colunas-contas-acesso"
      getFieldValue={getFieldValue}
      renderCell={renderCell}
      defaultSortKey="login"
      emptyText="Nenhuma conta encontrada."
      isLoading={isLoading}
      onOpen={(conta) => {
        const login = (conta.login || conta.email || "").toLowerCase();
        if (loginAtual && login === loginAtual) return;
        onEdit?.(conta);
      }}
      searchQuery={searchQuery}
      onSelectionChange={onSelectionChange}
      rowKey={(conta) => String(conta.id || conta.login || conta.email || "")}
      matchesSearch={(conta, q) => {
        const login = (conta.login || conta.email || "").toLowerCase();
        const nome = (conta.nome || conta.full_name || "").toLowerCase();
        return login.includes(q) || nome.includes(q);
      }}
    />
  );

  if (chromeLayout) {
    return <div className="overflow-hidden">{grade}</div>;
  }

  return (
    <div className="cadastro-b1 rounded-md border border-slate-300 bg-white shadow-sm overflow-hidden mb-4">
      {grade}
    </div>
  );
}
