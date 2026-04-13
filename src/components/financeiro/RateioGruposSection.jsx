import React from "react";
import { Plus, X } from "lucide-react";
import AutocompleteGenerico from "./AutocompleteGenerico.jsx";
import { formatarMoedaInput, parseMoedaInput, formatarMoeda } from "@/components/financeiro/moedaUtils";

const TH = "sticky top-0 z-10 bg-white text-[11px] font-medium text-gray-900 text-center align-middle whitespace-nowrap h-7 px-2 border-r border-b border-gray-200";
const TD = "px-2 py-0 text-xs align-middle border-r border-b border-gray-300 h-7";
const INP = "w-full bg-transparent border-0 outline-none text-xs h-[26px] px-0 focus:ring-0";

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
    <div className="border border-gray-200 rounded-lg">
      <div className="flex justify-between items-center bg-slate-100 px-2 h-7 border-b border-gray-200 rounded-t-lg">
        <span className="font-semibold text-xs text-slate-700">Rateio Grupo Financeiro</span>
        <button type="button" onClick={adicionarRateio} className="w-5 h-5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-emerald-600 flex items-center justify-center" disabled={restante <= 0.01 && rateios.length > 0}>
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {rateios.length === 0 ? (
        <div className="text-[11px] text-slate-400 text-center py-2">Nenhum rateio (opcional)</div>
      ) : (
        <div className="overflow-visible max-h-[180px]">
          <table className="w-full border-collapse border-separate border-spacing-0 table-fixed">
            <colgroup>
              <col />
              <col style={{ width: 100 }} />
              <col style={{ width: 55 }} />
              <col style={{ width: 28 }} />
            </colgroup>
            <thead>
              <tr>
                <th className={`${TH} text-left`}>Grupo</th>
                <th className={TH}>Valor (R$)</th>
                <th className={TH}>%</th>
                <th className={`${TH} border-r-0`}></th>
              </tr>
            </thead>
            <tbody>
              {rateios.map((rateio, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className={`${TD} overflow-visible relative`}>
                    <AutocompleteGenerico
                      items={grupos}
                      value={rateio.grupo_financeiro_id}
                      onChange={(v) => atualizarRateio(index, 'grupo_financeiro_id', v)}
                      placeholder="BUSCAR GRUPO..."
                      displayField="display_nome"
                      searchFields={["nome", "display_nome"]}
                      renderItem={(g) => <div className="text-xs text-slate-900">{g.display_nome || g.nome}</div>}
                      className="w-full"
                      inputClassName="border-0 shadow-none focus-visible:ring-0 bg-transparent h-[26px] text-xs px-0"
                    />
                  </td>
                  <td className={TD}>
                    <input value={formatarMoedaInput(rateio.valor)} onChange={(e) => atualizarRateio(index, 'valor_input', e.target.value)} placeholder="0,00" className={`${INP} text-center font-mono`} />
                  </td>
                  <td className={`${TD} text-center font-mono text-slate-500 text-[11px]`}>{(rateio.percentual != null ? rateio.percentual.toFixed(2) : '0,00').replace('.', ',')}%</td>
                  <td className={`${TD} text-center border-r-0`}>
                    <button type="button" onClick={() => removerRateio(index)} className="text-slate-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rateios.length > 0 && (
        <div className={`flex justify-between text-[11px] px-2 h-[26px] items-center rounded-b-lg ${Math.abs(restanteAtual) > 0.01 ? 'bg-red-50 text-red-700 border-t border-red-200' : 'bg-emerald-50 text-emerald-700 border-t border-emerald-200'}`}>
          <span className="font-semibold">Total: {formatarMoeda(totalAtual)}</span>
          <span className="font-semibold">Restante: {formatarMoeda(Math.max(0, restanteAtual))}</span>
        </div>
      )}
    </div>
  );
}