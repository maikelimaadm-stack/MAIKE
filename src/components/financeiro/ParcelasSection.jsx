import React from "react";
import { Plus, X } from "lucide-react";
import { formatarMoedaInput, parseMoedaInput, formatarMoeda } from "@/components/financeiro/moedaUtils";

const calcularProximoMes = (dataBase, meses) => {
  if (!dataBase) return new Date().toISOString().split('T')[0];
  const d = new Date(dataBase + 'T00:00:00');
  if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
  d.setDate(d.getDate() + (30 * meses));
  return d.toISOString().split('T')[0];
};

const CELL = "px-2 py-0 text-xs border-b border-slate-200 h-[30px] align-middle";
const INPUT_BASE = "w-full bg-transparent border-0 outline-none text-xs h-[28px] px-0 focus:ring-0";

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
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="flex justify-between items-center bg-slate-100 px-2 h-[30px]">
        <span className="font-semibold text-xs text-slate-700">Vencimentos / Parcelas</span>
        <button type="button" onClick={adicionarParcela} className="w-5 h-5 rounded bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center">
          <Plus className="w-3 h-3" />
        </button>
      </div>

      <div className="overflow-auto max-h-[180px]">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-50 border-b border-slate-300">
              <th className="text-left text-[11px] font-bold text-slate-600 px-2 py-1 w-8">#</th>
              <th className="text-left text-[11px] font-bold text-slate-600 px-2 py-1">Vencimento</th>
              <th className="text-right text-[11px] font-bold text-slate-600 px-2 py-1 w-28">Valor (R$)</th>
              <th className="text-left text-[11px] font-bold text-slate-600 px-2 py-1">Observação</th>
              <th className="w-7 px-1 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {parcelas.map((parcela, index) => (
              <tr key={index} className="hover:bg-slate-50">
                <td className={`${CELL} text-center font-bold text-slate-500`}>{parcela.numero}</td>
                <td className={CELL}>
                  <input type="date" value={parcela.data_vencimento} onChange={(e) => atualizarParcela(index, 'data_vencimento', e.target.value)} className={INPUT_BASE} />
                </td>
                <td className={`${CELL} text-right`}>
                  <input value={formatarMoedaInput(parcela.valor)} onChange={(e) => atualizarParcela(index, 'valor', e.target.value)} placeholder="0,00" className={`${INPUT_BASE} text-right font-mono`} />
                </td>
                <td className={CELL}>
                  <input value={parcela.observacao_parcela || ''} onChange={(e) => atualizarParcela(index, 'observacao_parcela', e.target.value.toUpperCase())} className={`${INPUT_BASE} uppercase`} />
                </td>
                <td className={`${CELL} text-center`}>
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
        <div className={`flex justify-between text-[11px] px-2 h-[26px] items-center ${Math.abs(restante) > 0.01 ? 'bg-red-50 text-red-700 border-t border-red-200' : 'bg-emerald-50 text-emerald-700 border-t border-emerald-200'}`}>
          <span className="font-semibold">Total: {formatarMoeda(totalParcelas)}</span>
          {Math.abs(restante) > 0.01 && <span className="font-semibold">Diferença: {formatarMoeda(restante)}</span>}
          {parcelas.length > 1 && <span className="font-semibold">{parcelas.length}x</span>}
        </div>
      )}
    </div>
  );
}