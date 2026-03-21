import React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { ACTION_OPTIONS, PAGE_CATEGORY_OPTIONS } from "@/lib/navigationConfig";

export default function MatrizPermissoesGrupo({ permissoes, onToggleAction, onTogglePage }) {
  return (
    <div className="space-y-4 max-h-[34rem] overflow-auto pr-1">
      {Object.entries(PAGE_CATEGORY_OPTIONS).map(([categoria, paginas]) => (
        <div key={categoria} className="rounded-xl border bg-white overflow-hidden">
          <div className="px-3 py-2 border-b bg-slate-50">
            <h3 className="text-xs font-semibold text-slate-900 uppercase">{categoria}</h3>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b bg-white">
                  <th className="text-left text-xs font-semibold text-slate-700 px-3 py-2">Tela</th>
                  {ACTION_OPTIONS.map((action) => (
                    <th key={action.id} className="text-center text-xs font-semibold text-slate-700 px-2 py-2 uppercase">
                      {action.title}
                    </th>
                  ))}
                  <th className="text-center text-xs font-semibold text-slate-700 px-2 py-2 uppercase">Tudo</th>
                </tr>
              </thead>
              <tbody>
                {paginas.map((pagina) => {
                  const pagePermissions = permissoes[pagina.id] || {};
                  const allChecked = ACTION_OPTIONS.every((action) => pagePermissions[action.id]);

                  return (
                    <tr key={pagina.id} className="border-b last:border-b-0 hover:bg-slate-50">
                      <td className="px-3 py-2 text-xs font-medium text-slate-800 uppercase">{pagina.title}</td>
                      {ACTION_OPTIONS.map((action) => (
                        <td key={action.id} className="px-2 py-2 text-center">
                          <Checkbox checked={pagePermissions[action.id] === true} onCheckedChange={() => onToggleAction(pagina.id, action.id)} />
                        </td>
                      ))}
                      <td className="px-2 py-2 text-center">
                        <Checkbox checked={allChecked} onCheckedChange={() => onTogglePage(pagina.id, !allChecked)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}