import React from "react";
import { Plus, X } from "lucide-react";
import AutocompleteGenerico from "./AutocompleteGenerico.jsx";
import { formatarMoedaInput, parseMoedaInput, formatarMoeda } from "@/components/financeiro/moedaUtils";

const CELL = "px-2 py-0 text-xs border-b border-slate-200 h-[30px] align-middle";
const INPUT_BASE = "w-full bg-transparent border-0 outline-none text-xs h-[28px] px-0 focus:ring-0";

export default function RateioCentrosCustoSection({ rateios, onChange, centros, valorTotal }) {
  const totalRateado = rateios.reduce((sum, r) => sum + (r.valor || 0), 0);
  const restante = Math.max(0, valorTotal - totalRateado);

  const adicionarRateio = () => {
    const novoValor = Math.max(0, Number(restante.toFixed(2)));
    const novoPercentual = valorTotal > 0 ? Number(((novoValor / valorTotal) * 100).toFixed(2)) : 0;
    onChange([...rateios, { centro_custo_id: '', centro_custo_nome: '', valor: novoValor, percentual: novoPercentual }]);
  };

  const removerRateio = (index) => onChange(rateios.filter((_, i) => i !== index));

  const atualizarRateio = (index, campo, valor) => {
    const updated = rateios.map((r, i) => {
      if (i !== index) return r;
      const newR = { ...r, [campo]: valor };
      if (campo === 'centro_custo_id') {
        const centro = centros.find(c => c.id === valor);
        newR.centro_custo_nome = centro?.nome || '';
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
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="flex justify-between items-center bg-slate-100 px-2 h-[30px]">
        <span className="font-semibold text-xs text-slate-700">Rateio Centro de Custo</span>
        <button type="button" onClick={adicionarRateio} className="w-5 h-5 rounded bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center" disabled={restante <= 0.01 && rateios.length > 0}>
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {rateios.length === 0 ? (
        <div className="text-[11px] text-slate-400 text-center py-2 border-b border-slate-200">Nenhum rateio (opcional)</div>
      ) : (
        <div className="overflow-auto max-h-[150px]">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50 border-b border-slate-300">
                <th className="text-left text-[11px] font-bold text-slate-600 px-2 py-1">Centro de Custo</th>
                <th className="text-right text-[11px] font-bold text-slate-600 px-2 py-1 w-24">Valor (R$)</th>
                <th className="text-right text-[11px] font-bold text-slate-600 px-2 py-1 w-14">%</th>
                <th className="w-7 px-1 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {rateios.map((rateio, index) => (
                <tr key={index} className="hover:bg-slate-50">
                  <td className={CELL}>
                    <AutocompleteGenerico
                      items={centros}
                      value={rateio.centro_custo_id}
                      onChange={(v) => atualizarRateio(index, 'centro_custo_id', v)}
                      placeholder="BUSCAR CENTRO..."
                      displayField="display_nome"
                      searchFields={["nome", "display_nome"]}
                      renderItem={(c) => <div className="text-xs text-slate-900">{c.display_nome || c.nome}</div>}
                      className="w-full"
                      inputClassName="border-0 shadow-none focus-visible:ring-0 bg-transparent h-[28px] text-xs px-0"
                    />
                  </td>
                  <td className={`${CELL} text-right`}>
                    <input value={formatarMoedaInput(rateio.valor)} onChange={(e) => atualizarRateio(index, 'valor_input', e.target.value)} placeholder="0,00" className={`${INPUT_BASE} text-right font-mono`} />
                  </td>
                  <td className={`${CELL} text-right font-mono text-slate-500`}>{rateio.percentual ? `${rateio.percentual}%` : '0%'}</td>
                  <td className={`${CELL} text-center`}>
                    <button type="button" onClick={() => removerRateio(index)} className="text-slate-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rateios.length > 0 && (
        <div className={`flex justify-between text-[11px] px-2 h-[26px] items-center ${Math.abs(restanteAtual) > 0.01 ? 'bg-red-50 text-red-700 border-t border-red-200' : 'bg-emerald-50 text-emerald-700 border-t border-emerald-200'}`}>
          <span className="font-semibold">Total: {formatarMoeda(totalAtual)}</span>
          <span className="font-semibold">Restante: {formatarMoeda(Math.max(0, restanteAtual))}</span>
        </div>
      )}
    </div>
  );
}