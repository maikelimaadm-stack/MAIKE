import React, { useMemo } from "react";

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

  const filtered = useMemo(() => {
    const q = (searchQuery || "").trim().toLowerCase();
    if (!q) return contas;
    return contas.filter((conta) => {
      const login = (conta.login || conta.email || "").toLowerCase();
      const nome = (conta.nome || conta.full_name || "").toLowerCase();
      return login.includes(q) || nome.includes(q);
    });
  }, [contas, searchQuery]);

  const toggleSelect = (id) => {
    if (!onSelectionChange) return;
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    onSelectionChange(next);
  };

  const table = (
    <div className="cadastro-grade-viewport relative w-full overflow-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-xs table-fixed">
        <thead>
          <tr className="sticky top-0 z-40 bg-white">
            <th className="h-7 w-[25px] border-r border-b border-gray-200 p-0" />
            <th className="h-7 px-2 text-left font-medium border-r border-b border-gray-200">Login</th>
            <th className="h-7 px-2 text-left font-medium border-r border-b border-gray-200">Nome</th>
            <th className="h-7 px-2 text-center font-medium border-r border-b border-gray-200">Status</th>
            <th className="h-7 w-[25px] border-r border-b border-gray-200 p-0" />
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={5} className="text-center py-8 text-slate-400 border border-gray-300">
                Carregando contas…
              </td>
            </tr>
          ) : filtered.length === 0 ? (
            <tr>
              <td colSpan={5} className="text-center py-8 text-slate-400 border border-gray-300">
                Nenhuma conta encontrada.
              </td>
            </tr>
          ) : (
            filtered.map((conta) => {
              const login = conta.login || conta.email || "";
              const id = conta.id || login;
              const isSelf = loginAtual && login.toLowerCase() === loginAtual;
              return (
                <tr
                  key={id}
                  className="border-b hover:bg-gray-100 cursor-pointer"
                  onDoubleClick={() => !isSelf && onEdit?.(conta)}
                >
                  <td
                    className="h-7 p-0 text-center border-r border-b border-gray-300"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded-full border-2 border-gray-400"
                      checked={selectedIds.includes(id)}
                      onChange={() => toggleSelect(id)}
                      aria-label={`Selecionar ${login}`}
                    />
                  </td>
                  <td className="h-7 px-2 font-mono border-r border-b border-gray-300">{login}</td>
                  <td className="h-7 px-2 border-r border-b border-gray-300">{conta.nome || conta.full_name || "—"}</td>
                  <td className="h-7 px-2 text-center border-r border-b border-gray-300">
                    {conta.ativo === false ? (
                      <span className="inline-block px-2 py-0.5 rounded border text-[10px] text-slate-600">Inativa</span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px]">Ativa</span>
                    )}
                  </td>
                  <td className="h-7 px-1 text-center border-r border-b border-gray-300">
                    {!isSelf ? (
                      <button
                        type="button"
                        className="text-[10px] font-semibold text-emerald-700 hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit?.(conta);
                        }}
                      >
                        Editar
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );

  if (chromeLayout) {
    return <div className="overflow-hidden">{table}</div>;
  }

  return (
    <div className="cadastro-b1 rounded-md border border-slate-300 bg-white shadow-sm overflow-hidden mb-4">
      {table}
    </div>
  );
}
