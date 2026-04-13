import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

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
  const numStr = String(num).replace('.', ',');
  const [inteiro, decimal] = numStr.split(',');
  const inteiroFormatado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimal !== undefined ? `${inteiroFormatado},${decimal}` : inteiroFormatado;
};

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
        delete newR.valor_str;
      }

      return newR;
    });
    onChange(updated);
  };

  const totalRateado = rateios.reduce((sum, r) => sum + (r.valor || 0), 0);
  const restante = valorTotal - totalRateado;

  return (
    <div className="space-y-2 border border-slate-200 rounded-lg p-2.5 bg-white">
      <div className="flex justify-between items-center">
        <h3 className="text-xs font-bold text-slate-700 uppercase">Rateio por Centro de Custo</h3>
        <Button type="button" variant="outline" size="sm" className="h-6 text-xs gap-1" onClick={adicionarRateio}>
          <Plus className="w-3 h-3" /> Adicionar
        </Button>
      </div>

      {rateios.length === 0 && (
        <p className="text-xs text-slate-400 text-center py-2">Nenhum rateio adicionado (opcional)</p>
      )}

      {rateios.map((rateio, index) => (
        <div key={index} className="grid grid-cols-12 gap-1.5 items-end bg-slate-50 rounded p-1.5">
          <div className="col-span-5 space-y-1">
            <Label className="text-[10px] uppercase text-slate-500">Centro de Custo</Label>
            <Select value={rateio.centro_custo_id} onValueChange={(v) => atualizarRateio(index, 'centro_custo_id', v)}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
              <SelectContent>
                {centros.map(c => (
                  <SelectItem key={c.id} value={c.id} className="text-xs uppercase">{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-3 space-y-1">
            <Label className="text-[10px] uppercase text-slate-500">Valor</Label>
            <Input
              value={formatarNumero(rateio.valor)}
              onChange={(e) => atualizarRateio(index, 'valor_str', e.target.value.replace(/[^\d,]/g, ''))}
              placeholder="0,00"
              className="h-7 text-xs text-right font-mono"
            />
          </div>

          <div className="col-span-3 space-y-1">
            <Label className="text-[10px] uppercase text-slate-500">%</Label>
            <Input
              value={rateio.percentual ? `${rateio.percentual}%` : '0%'}
              readOnly
              className="h-7 text-xs text-right font-mono bg-slate-100"
            />
          </div>

          <div className="col-span-1 flex justify-center">
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removerRateio(index)}>
              <Trash2 className="w-3.5 h-3.5 text-red-500" />
            </Button>
          </div>
        </div>
      ))}

      {rateios.length > 0 && (
        <div className={`flex justify-between text-xs px-1.5 py-1 rounded ${Math.abs(restante) > 0.01 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
          <span className="font-semibold">Total rateado: {formatarMoeda(totalRateado)}</span>
          <span className="font-semibold">Restante: {formatarMoeda(restante)}</span>
        </div>
      )}
    </div>
  );
}