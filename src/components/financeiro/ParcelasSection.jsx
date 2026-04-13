import React from "react";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";

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

const calcularProximoMes = (dataBase, meses) => {
  if (!dataBase) return new Date().toISOString().split('T')[0];
  const d = new Date(dataBase + 'T00:00:00');
  if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
  d.setDate(d.getDate() + (30 * meses));
  return d.toISOString().split('T')[0];
};

const FL = ({ label, children }) => (
  <div>
    <label className="text-[10px] text-slate-500 pl-1 leading-none">{label}</label>
    <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors">
      {children}
    </div>
  </div>
);

export default function ParcelasSection({ parcelas, onParcelasChange, valorTotal, dataEmissao }) {

  const adicionarParcela = () => {
    const proxNumero = parcelas.length + 1;
    const venc = calcularProximoMes(dataEmissao, proxNumero);
    const qtdNovas = proxNumero;
    const valorParcela = valorTotal > 0 ? Number((valorTotal / qtdNovas).toFixed(2)) : 0;

    // Redistribuir valores iguais
    const novasParcelas = [...parcelas, { numero: proxNumero, data_vencimento: venc, valor: 0, status: 'Aberto' }]
      .map((p, i) => ({ ...p, numero: i + 1, valor: valorParcela }));

    // Ajustar arredondamento na última
    const totalGerado = novasParcelas.reduce((s, p) => s + p.valor, 0);
    const diff = valorTotal - totalGerado;
    if (novasParcelas.length > 0) {
      novasParcelas[novasParcelas.length - 1].valor = Number((novasParcelas[novasParcelas.length - 1].valor + diff).toFixed(2));
    }
    onParcelasChange(novasParcelas);
  };

  const removerParcela = (index) => {
    if (parcelas.length <= 1) return;
    const updated = parcelas.filter((_, i) => i !== index).map((p, i) => ({ ...p, numero: i + 1 }));

    // Redistribuir valores
    const qtd = updated.length;
    const valorParcela = valorTotal > 0 ? Number((valorTotal / qtd).toFixed(2)) : 0;
    const redistribuido = updated.map(p => ({ ...p, valor: valorParcela }));
    const totalGerado = redistribuido.reduce((s, p) => s + p.valor, 0);
    const diff = valorTotal - totalGerado;
    if (redistribuido.length > 0) {
      redistribuido[redistribuido.length - 1].valor = Number((redistribuido[redistribuido.length - 1].valor + diff).toFixed(2));
    }
    onParcelasChange(redistribuido);
  };

  const atualizarParcela = (index, campo, valor) => {
    const updated = parcelas.map((p, i) => {
      if (i !== index) return p;
      if (campo === 'valor_str') return { ...p, valor: parseNumero(valor) };
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

      <div className="space-y-0.5 max-h-72 overflow-auto">
        {parcelas.map((parcela, index) => (
          <div key={index} className="grid grid-cols-12 gap-1 items-center bg-white rounded p-0.5 border border-slate-200">
            <div className="col-span-1 text-center">
              <span className="text-xs font-bold text-slate-600">{parcela.numero}</span>
            </div>
            <div className="col-span-5">
              <FL label="Vencimento">
                <Input type="date" value={parcela.data_vencimento} onChange={(e) => atualizarParcela(index, 'data_vencimento', e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
              </FL>
            </div>
            <div className="col-span-4">
              <FL label="Valor">
                <Input value={formatarNumero(parcela.valor)} onChange={(e) => atualizarParcela(index, 'valor_str', e.target.value.replace(/[^\d,]/g, ''))} placeholder="0,00" className="h-7 text-xs text-right font-mono border-0 shadow-none focus-visible:ring-0 bg-transparent" />
              </FL>
            </div>
            <div className="col-span-2 flex justify-center">
              <button type="button" onClick={() => removerParcela(index)} disabled={parcelas.length <= 1} className={`${parcelas.length <= 1 ? 'text-slate-200' : 'text-slate-400 hover:text-red-500'}`}>
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
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