import React from "react";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";
import { formatarMoedaInput, parseMoedaInput, formatarMoeda } from "@/components/financeiro/moedaUtils";

const calcularProximoMes = (dataBase, meses) => {
  if (!dataBase) return new Date().toISOString().split('T')[0];
  const d = new Date(dataBase + 'T00:00:00');
  if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
  d.setDate(d.getDate() + (30 * meses));
  return d.toISOString().split('T')[0];
};

export default function ParcelasSection({ parcelas, onParcelasChange, valorTotal, dataEmissao }) {
  const adicionarParcela = () => {
    const proxNumero = parcelas.length + 1;
    const venc = calcularProximoMes(dataEmissao, proxNumero);
    const qtdNovas = proxNumero;
    const valorParcela = valorTotal > 0 ? Number((valorTotal / qtdNovas).toFixed(2)) : 0;
    const novasParcelas = [...parcelas, { numero: proxNumero, data_vencimento: venc, valor: 0, observacao_parcela: '', status: 'Aberto' }]
      .map((p, i) => ({ ...p, numero: i + 1, valor: valorParcela }));
    const totalGerado = novasParcelas.reduce((s, p) => s + p.valor, 0);
    const diff = valorTotal - totalGerado;
    if (novasParcelas.length > 0) novasParcelas[novasParcelas.length - 1].valor = Number((novasParcelas[novasParcelas.length - 1].valor + diff).toFixed(2));
    onParcelasChange(novasParcelas);
  };

  const removerParcela = (index) => {
    if (parcelas.length <= 1) return;
    const updated = parcelas.filter((_, i) => i !== index).map((p, i) => ({ ...p, numero: i + 1 }));
    const qtd = updated.length;
    const valorParcela = valorTotal > 0 ? Number((valorTotal / qtd).toFixed(2)) : 0;
    const redistribuido = updated.map(p => ({ ...p, valor: valorParcela }));
    const totalGerado = redistribuido.reduce((s, p) => s + p.valor, 0);
    const diff = valorTotal - totalGerado;
    if (redistribuido.length > 0) redistribuido[redistribuido.length - 1].valor = Number((redistribuido[redistribuido.length - 1].valor + diff).toFixed(2));
    onParcelasChange(redistribuido);
  };

  const atualizarParcela = (index, campo, valor) => {
    const updated = parcelas.map((p, i) => {
      if (i !== index) return p;
      if (campo === 'valor') return { ...p, valor: parseMoedaInput(valor) };
      return { ...p, [campo]: valor };
    });
    onParcelasChange(updated);
  };

  const totalParcelas = parcelas.reduce((sum, p) => sum + (p.valor || 0), 0);
  const restante = valorTotal - totalParcelas;

  return (
    <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-1 space-y-0.5">
      <div className="flex justify-between items-center">
        <span className="font-semibold text-xs text-slate-700">Vencimentos / Parcelas</span>
        <button type="button" onClick={adicionarParcela} className="w-5 h-5 rounded bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="overflow-auto max-h-60">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-300 bg-slate-100">
              <th className="text-left py-1 px-1 font-semibold text-slate-600 w-10">#</th>
              <th className="text-left py-1 px-1 font-semibold text-slate-600">Vencimento</th>
              <th className="text-right py-1 px-1 font-semibold text-slate-600 w-28">Valor</th>
              <th className="text-left py-1 px-1 font-semibold text-slate-600">Observação</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {parcelas.map((parcela, index) => (
              <tr key={index} className="border-b border-slate-200 hover:bg-white">
                <td className="py-0.5 px-1 font-bold text-slate-500 text-center">{parcela.numero}</td>
                <td className="py-0.5 px-1">
                  <Input type="date" value={parcela.data_vencimento} onChange={(e) => atualizarParcela(index, 'data_vencimento', e.target.value)} className="h-6 text-xs border-slate-300 shadow-none focus-visible:ring-0 bg-transparent px-1" />
                </td>
                <td className="py-0.5 px-1">
                  <Input value={formatarMoedaInput(parcela.valor)} onChange={(e) => atualizarParcela(index, 'valor', e.target.value)} placeholder="0,00" className="h-6 text-xs text-right font-mono border-slate-300 shadow-none focus-visible:ring-0 bg-transparent px-1" />
                </td>
                <td className="py-0.5 px-1">
                  <Input value={parcela.observacao_parcela || ''} onChange={(e) => atualizarParcela(index, 'observacao_parcela', e.target.value.toUpperCase())} placeholder="" className="h-6 text-xs border-slate-300 shadow-none focus-visible:ring-0 bg-transparent px-1 uppercase" />
                </td>
                <td className="py-0.5 px-1 text-center">
                  <button type="button" onClick={() => removerParcela(index)} disabled={parcelas.length <= 1} className={parcelas.length <= 1 ? 'text-slate-200' : 'text-slate-400 hover:text-red-500'}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {parcelas.length > 0 && (
        <div className={`flex justify-between text-[11px] px-1 py-0.5 rounded ${Math.abs(restante) > 0.01 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
          <span className="font-semibold">Total: {formatarMoeda(totalParcelas)}</span>
          {Math.abs(restante) > 0.01 && <span className="font-semibold">Diferença: {formatarMoeda(restante)}</span>}
          {parcelas.length > 1 && <span className="font-semibold">{parcelas.length}x</span>}
        </div>
      )}
    </div>
  );
}