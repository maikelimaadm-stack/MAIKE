import React, { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2 } from "lucide-react";

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
  const data = new Date(dataBase + 'T00:00:00');
  if (isNaN(data.getTime())) return new Date().toISOString().split('T')[0];
  data.setMonth(data.getMonth() + meses);
  return data.toISOString().split('T')[0];
};

export default function ParcelasSection({ parcelado, parcelas, onParceladoChange, onParcelasChange, valorTotal, dataVencimento }) {

  const handleQuantidadeChange = (qtdStr) => {
    const qtd = parseInt(qtdStr) || 1;
    if (qtd < 1 || qtd > 120) return;

    const valorParcela = valorTotal > 0 ? valorTotal / qtd : 0;
    const novasParcelas = Array.from({ length: qtd }, (_, i) => ({
      numero: i + 1,
      data_vencimento: calcularProximoMes(dataVencimento, i),
      valor: Number(valorParcela.toFixed(2)),
      status: 'Aberto',
    }));

    // Ajustar diferença de arredondamento na última parcela
    if (novasParcelas.length > 0 && valorTotal > 0) {
      const totalGerado = novasParcelas.reduce((sum, p) => sum + p.valor, 0);
      const diff = valorTotal - totalGerado;
      novasParcelas[novasParcelas.length - 1].valor = Number((novasParcelas[novasParcelas.length - 1].valor + diff).toFixed(2));
    }

    onParcelasChange(novasParcelas);
  };

  const atualizarParcela = (index, campo, valor) => {
    const updated = parcelas.map((p, i) => {
      if (i !== index) return p;
      if (campo === 'valor_str') {
        return { ...p, valor: parseNumero(valor) };
      }
      return { ...p, [campo]: valor };
    });
    onParcelasChange(updated);
  };

  const removerParcela = (index) => {
    if (parcelas.length <= 1) return;
    const updated = parcelas.filter((_, i) => i !== index).map((p, i) => ({ ...p, numero: i + 1 }));
    onParcelasChange(updated);
  };

  const totalParcelas = parcelas.reduce((sum, p) => sum + (p.valor || 0), 0);
  const restante = valorTotal - totalParcelas;

  return (
    <div className="space-y-2 border border-slate-200 rounded-lg p-2.5 bg-white">
      <div className="flex justify-between items-center">
        <h3 className="text-xs font-bold text-slate-700 uppercase">Parcelamento</h3>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={parcelado}
            onCheckedChange={onParceladoChange}
            id="parcelado"
          />
          <label htmlFor="parcelado" className="text-xs font-medium text-slate-700 cursor-pointer">Parcelar</label>
        </div>
      </div>

      {parcelado && (
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-slate-500">Qtd. Parcelas</Label>
              <Input
                type="number"
                min={1}
                max={120}
                value={parcelas.length || 1}
                onChange={(e) => handleQuantidadeChange(e.target.value)}
                className="h-7 text-xs w-20 text-center"
              />
            </div>
            <div className="text-xs text-slate-500 pb-1">
              Valor base por parcela: <span className="font-mono font-semibold">{formatarMoeda(valorTotal > 0 && parcelas.length > 0 ? valorTotal / parcelas.length : 0)}</span>
            </div>
          </div>

          <div className="space-y-1 max-h-64 overflow-auto">
            {parcelas.map((parcela, index) => (
              <div key={index} className="grid grid-cols-12 gap-1.5 items-center bg-slate-50 rounded p-1.5">
                <div className="col-span-1 text-center">
                  <span className="text-xs font-bold text-slate-600">{parcela.numero}</span>
                </div>

                <div className="col-span-5 space-y-0.5">
                  <Label className="text-[10px] uppercase text-slate-500">Vencimento</Label>
                  <Input
                    type="date"
                    value={parcela.data_vencimento}
                    onChange={(e) => atualizarParcela(index, 'data_vencimento', e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>

                <div className="col-span-4 space-y-0.5">
                  <Label className="text-[10px] uppercase text-slate-500">Valor</Label>
                  <Input
                    value={formatarNumero(parcela.valor)}
                    onChange={(e) => atualizarParcela(index, 'valor_str', e.target.value.replace(/[^\d,]/g, ''))}
                    placeholder="0,00"
                    className="h-7 text-xs text-right font-mono"
                  />
                </div>

                <div className="col-span-2 flex justify-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => removerParcela(index)}
                    disabled={parcelas.length <= 1}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className={`flex justify-between text-xs px-1.5 py-1 rounded ${Math.abs(restante) > 0.01 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
            <span className="font-semibold">Total parcelas: {formatarMoeda(totalParcelas)}</span>
            {Math.abs(restante) > 0.01 && <span className="font-semibold">Diferença: {formatarMoeda(restante)}</span>}
          </div>
        </div>
      )}

      {!parcelado && (
        <p className="text-xs text-slate-400 text-center py-1">Pagamento à vista (parcela única no vencimento)</p>
      )}
    </div>
  );
}