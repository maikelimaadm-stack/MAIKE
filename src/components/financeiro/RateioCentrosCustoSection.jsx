import React from "react";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";
import AutocompleteGenerico from "./AutocompleteGenerico.jsx";

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const parseNumero = (str) => {
  if (!str) return 0;
  return parseFloat(String(str).replace(/[R$ ]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
};

const formatarNumero = (num) => {
  if (!num && num !== 0) return '';
  return num.toFixed(2).replace('.', ',');
};

const FL = ({ label, children }) => (
  <div>
    <label className="text-[10px] text-slate-500 pl-1 leading-none">{label}</label>
    <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors">
      {children}
    </div>
  </div>
);

export default function RateioCentrosCustoSection({ rateios, onChange, centros, valorTotal }) {
  const adicionarRateio = () => {
    onChange([...rateios, { centro_custo_id: '', centro_custo_nome: '', valor: 0, percentual: 0 }]);
  };

  const removerRateio = (index) => {
    onChange(rateios.filter((_, i) => i !== index));
  };

  const atualizarRateio = (index, campo, valor) => {
    const updated = rateios.map((r, i) => {
      if (i !== index) return r;
      const newR = { ...r, [campo]: valor };
      if (campo === 'centro_custo_id') {
        const centro = centros.find(c => c.id === valor);
        newR.centro_custo_nome = centro?.nome || '';
      }
      if (campo === 'valor_str') {
        const numVal = parseNumero(valor);
        newR.valor = numVal;
        newR.percentual = valorTotal > 0 ? Number(((numVal / valorTotal) * 100).toFixed(2)) : 0;
      }
      return newR;
    });
    onChange(updated);
  };

  const totalRateado = rateios.reduce((sum, r) => sum + (r.valor || 0), 0);
  const restante = valorTotal - totalRateado;

  return (
    <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-1 space-y-0.5">
      <div className="flex justify-between items-center">
        <span className="font-semibold text-xs text-slate-700">Rateio Centro de Custo</span>
        <button type="button" onClick={adicionarRateio} className="w-5 h-5 rounded bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {rateios.length === 0 && (
        <p className="text-[11px] text-slate-400 text-center py-1">Nenhum rateio (opcional)</p>
      )}

      {rateios.map((rateio, index) => (
        <div key={index} className="grid grid-cols-12 gap-1 items-end">
          <div className="col-span-5">
            <FL label="Centro de Custo">
              <AutocompleteGenerico
                items={centros}
                value={rateio.centro_custo_id}
                onChange={(v) => atualizarRateio(index, 'centro_custo_id', v)}
                placeholder="BUSCAR CENTRO..."
                displayField="display_nome"
                searchFields={["nome", "display_nome"]}
                renderItem={(c) => <div className="text-xs text-slate-900">{c.display_nome || c.nome}</div>}
                className="w-full"
                inputClassName="border-0 shadow-none focus-visible:ring-0 bg-transparent h-7"
              />
            </FL>
          </div>
          <div className="col-span-3">
            <FL label="Valor">
              <Input value={formatarNumero(rateio.valor)} onChange={(e) => atualizarRateio(index, 'valor_str', e.target.value.replace(/[^\d,]/g, ''))} placeholder="0,00" className="h-7 text-xs text-right font-mono border-0 shadow-none focus-visible:ring-0 bg-transparent" />
            </FL>
          </div>
          <div className="col-span-3">
            <FL label="%">
              <Input value={rateio.percentual ? `${rateio.percentual}%` : '0%'} readOnly className="h-7 text-xs text-right font-mono border-0 shadow-none focus-visible:ring-0 bg-slate-100" />
            </FL>
          </div>
          <div className="col-span-1 flex justify-center pb-0.5">
            <button type="button" onClick={() => removerRateio(index)} className="text-slate-400 hover:text-red-500">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}

      {rateios.length > 0 && (
        <div className={`flex justify-between text-[11px] px-1 py-0.5 rounded ${Math.abs(restante) > 0.01 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
          <span className="font-semibold">Total: {formatarMoeda(totalRateado)}</span>
          <span className="font-semibold">Restante: {formatarMoeda(restante)}</span>
        </div>
      )}
    </div>
  );
}