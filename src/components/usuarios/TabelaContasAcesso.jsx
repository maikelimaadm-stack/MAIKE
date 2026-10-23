import React, { useState } from "react";
import { Button } from "@/components/ui/button";

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
    <div className="rounded-md border border-slate-300 bg-white shadow-sm overflow-hidden mb-4">
      <div className="border-b border-gray-200 px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Contas de acesso MAIKE ({contas.length})</h2>
          <p className="text-[11px] text-slate-500">Login e senha no backend nativo.</p>
        </div>
        <input
          type="search"
          placeholder="Buscar login ou nome…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="h-7 w-full sm:w-52 text-xs rounded-full border border-slate-300 px-3 bg-slate-50 focus:bg-white focus:border-emerald-500 outline-none"
        />
      </div>
      <div className="cadastro-grade-viewport relative w-full overflow-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-xs table-fixed">
          <thead>
            <tr className="sticky top-0 z-40 bg-white">
              <th className="h-7 px-2 text-left font-medium border-r border-b border-gray-200">Login</th>
              <th className="h-7 px-2 text-left font-medium border-r border-b border-gray-200">Nome</th>
              <th className="h-7 px-2 text-center font-medium border-r border-b border-gray-200">Status</th>
              <th className="h-7 px-2 text-center font-medium border-r border-b border-gray-200 w-24">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={4} className="text-center py-8 text-slate-400 border border-gray-300">
                  Carregando contas…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-8 text-slate-400 border border-gray-300">
                  Nenhuma conta encontrada.
                </td>
              </tr>
            ) : (
              filtered.map((conta) => {
                const login = conta.login || conta.email || "";
                const isSelf = loginAtual && login.toLowerCase() === loginAtual;
                return (
                  <tr key={conta.id || login} className="border-b hover:bg-gray-100">
                    <td className="h-7 px-2 font-mono border-r border-b border-gray-300">{login}</td>
                    <td className="h-7 px-2 border-r border-b border-gray-300">{conta.nome || conta.full_name || "—"}</td>
                    <td className="h-7 px-2 text-center border-r border-b border-gray-300">
                      {conta.ativo === false ? (
                        <span className="inline-block px-2 py-0.5 rounded border text-[10px] text-slate-600">Inativa</span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px]">Ativa</span>
                      )}
                    </td>
                    <td className="h-7 px-2 text-center border-r border-b border-gray-300">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px] px-2"
                        disabled={isSelf}
                        onClick={() => onEdit(conta)}
                      >
                        Editar
                      </Button>
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
