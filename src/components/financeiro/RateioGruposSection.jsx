import React from "react";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";
import AutocompleteGenerico from "./AutocompleteGenerico.jsx";
import { formatarMoedaInput, parseMoedaInput, formatarMoeda } from "@/components/financeiro/moedaUtils";

export default function RateioGruposSection({ rateios, onChange, grupos, valorTotal }) {
  const totalRateado = rateios.reduce((sum, r) => sum + (r.valor || 0), 0);
  const restante = Math.max(0, valorTotal - totalRateado);

  const adicionarRateio = () => {
    const novoValor = Math.max(0, Number(restante.toFixed(2)));
    const novoPercentual = valorTotal > 0 ? Number(((novoValor / valorTotal) * 100).toFixed(2)) : 0;
    onChange([...rateios, { grupo_financeiro_id: '', grupo_financeiro_nome: '', valor: novoValor, percentual: novoPercentual }]);
  };

  const removerRateio = (index) => onChange(rateios.filter((_, i) => i !== index));

  const atualizarRateio = (index, campo, valor) => {
    const updated = rateios.map((r, i) => {
      if (i !== index) return r;
      const newR = { ...r, [campo]: valor };
      if (campo === 'grupo_financeiro_id') {
        const grupo = grupos.find(g => g.id === valor);
        newR.grupo_financeiro_nome = grupo?.nome || '';
      }
      if (campo === 'valor_input') {
        let numVal = parseMoedaInput(valor);
        if (numVal < 0) numVal = 0;
        const outrosTotal = rateios.reduce((s, r2, j) => j === index ? s : s + (r2.valor || 0), 0);
        const maxPermitido = Math.max(0, valorTotal - outrosTotal);
        if (numVal > maxPermitido) numVal = Number(maxPermitido.toFixed(2));
        newR.valor = numVal;
        newR.percentual = valorTotal > 0 ? Number(((numVal / valorTotal) * 100).toFixed(2)) : 0;
      }
      return newR;
    });
    onChange(updated);
  };

  const totalAtual = rateios.reduce((sum, r) => sum + (r.valor || 0), 0);
  const restanteAtual = valorTotal - totalAtual;

  return (
    <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-1 space-y-0.5">
      <div className="flex justify-between items-center">
        <span className="font-semibold text-xs text-slate-700">Rateio Grupo Financeiro</span>
        <button type="button" onClick={adicionarRateio} className="w-5 h-5 rounded bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center" disabled={restante <= 0.01 && rateios.length > 0}>
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {rateios.length === 0 ? (
        <p className="text-[11px] text-slate-400 text-center py-1">Nenhum rateio (opcional)</p>
      ) : (
        <div className="overflow-auto max-h-48">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-300 bg-slate-100">
                <th className="text-left py-1 px-1 font-semibold text-slate-600">Grupo</th>
                <th className="text-right py-1 px-1 font-semibold text-slate-600 w-24">Valor</th>
                <th className="text-right py-1 px-1 font-semibold text-slate-600 w-16">%</th>
                <th className="w-7"></th>
              </tr>
            </thead>
            <tbody>
              {rateios.map((rateio, index) => (
                <tr key={index} className="border-b border-slate-200 hover:bg-white">
                  <td className="py-0.5 px-1">
                    <AutocompleteGenerico
                      items={grupos}
                      value={rateio.grupo_financeiro_id}
                      onChange={(v) => atualizarRateio(index, 'grupo_financeiro_id', v)}
                      placeholder="BUSCAR GRUPO..."
                      displayField="display_nome"
                      searchFields={["nome", "display_nome"]}
                      renderItem={(g) => <div className="text-xs text-slate-900">{g.display_nome || g.nome}</div>}
                      className="w-full"
                      inputClassName="border-0 shadow-none focus-visible:ring-0 bg-transparent h-6 text-xs"
                    />
                  </td>
                  <td className="py-0.5 px-1">
                    <Input value={formatarMoedaInput(rateio.valor)} onChange={(e) => atualizarRateio(index, 'valor_input', e.target.value)} placeholder="0,00" className="h-6 text-xs text-right font-mono border-slate-300 shadow-none focus-visible:ring-0 bg-transparent px-1" />
                  </td>
                  <td className="py-0.5 px-1 text-right font-mono text-slate-500">{rateio.percentual ? `${rateio.percentual}%` : '0%'}</td>
                  <td className="py-0.5 px-1 text-center">
                    <button type="button" onClick={() => removerRateio(index)} className="text-slate-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rateios.length > 0 && (
        <div className={`flex justify-between text-[11px] px-1 py-0.5 rounded ${Math.abs(restanteAtual) > 0.01 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
          <span className="font-semibold">Total: {formatarMoeda(totalAtual)}</span>
          <span className="font-semibold">Restante: {formatarMoeda(Math.max(0, restanteAtual))}</span>
        </div>
      )}
    </div>
  );
}