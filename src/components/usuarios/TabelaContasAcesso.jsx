import React, { useState } from "react";

export default function TabelaContasAcesso({ contas = [], currentUser, onEdit, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");

  const loginAtual = (currentUser?.login || currentUser?.email || "").trim().toLowerCase();

  const filtered = contas.filter((conta) => {
    const q = searchTerm.toLowerCase();
    const login = (conta.login || conta.email || "").toLowerCase();
    const nome = (conta.nome || conta.full_name || "").toLowerCase();
    return login.includes(q) || nome.includes(q);
  });

  return (
    <div className="rounded-lg border border-slate-300 bg-white shadow-sm overflow-hidden">
      <div className="border-b px-4 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Contas de acesso MAIKE ({contas.length})</h2>
          <p className="text-[11px] text-slate-500">
            Entrada com login e senha no backend nativo. Desative em vez de excluir.
          </p>
        </div>
        <input
          type="search"
          placeholder="Buscar login ou nome..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="h-8 w-full sm:w-52 text-xs rounded-md border border-slate-300 px-2"
        />
      </div>
      <div className="overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b text-left">
              <th className="p-2 font-medium">Login</th>
              <th className="p-2 font-medium">Nome</th>
              <th className="p-2 font-medium text-center">Status</th>
              <th className="p-2 font-medium text-center w-24">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={4} className="text-center py-8 text-slate-400">
                  Carregando contas...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-8 text-slate-400">
                  Nenhuma conta encontrada.
                </td>
              </tr>
            ) : (
              filtered.map((conta) => {
                const login = conta.login || conta.email || "";
                const isSelf = loginAtual && login.toLowerCase() === loginAtual;
                return (
                  <tr key={conta.id || login} className="border-b border-slate-100">
                    <td className="p-2 font-mono">{login}</td>
                    <td className="p-2">{conta.nome || conta.full_name || "—"}</td>
                    <td className="p-2 text-center">
                      {conta.ativo === false ? (
                        <span className="inline-block px-2 py-0.5 rounded border text-[10px] text-slate-600">
                          Inativa
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px]">
                          Ativa
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-center">
                      <button
                        type="button"
                        onClick={() => onEdit(conta)}
                        className="text-xs text-emerald-700 hover:underline"
                      >
                        Editar
                      </button>
                      {isSelf ? <span className="block text-[10px] text-slate-400">Você</span> : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
