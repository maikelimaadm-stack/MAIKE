import React, { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

const fmt = (v) => {
  if (v == null || isNaN(v)) return '0,00';
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtMoeda = (v) => {
  if (v == null || isNaN(v)) return 'R$ 0,00';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};
const fmtData = (d) => {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');
};

const TH = "sticky top-0 z-10 bg-white text-[11px] font-medium text-gray-900 text-center align-middle whitespace-nowrap h-7 px-2 border-r border-b border-gray-200";
const TD = "px-2 py-0 text-xs align-middle border-r border-b border-gray-300 h-7";
const INP = "w-full bg-transparent border-0 outline-none text-xs h-[26px] px-0 focus:ring-0 text-center font-mono";

export default function SaidaPorNotaDialog({ open, onOpenChange, lotes = [], produtoNome, onConfirmar }) {
  const [selecionados, setSelecionados] = useState({});

  const toggleLote = (loteId, checked) => {
    setSelecionados(prev => {
      if (!checked) {
        const { [loteId]: _, ...rest } = prev;
        return rest;
      }
      const lote = lotes.find(l => l.id === loteId);
      return { ...prev, [loteId]: lote?.quantidade_disponivel || 0 };
    });
  };

  // Estado para digitação livre no campo de quantidade
  const [qtdInputs, setQtdInputs] = useState({});

  const setQuantidade = (loteId, val) => {
    const lote = lotes.find(l => l.id === loteId);
    const max = lote?.quantidade_disponivel || 0;
    let num = parseFloat(String(val).replace(/\./g, '').replace(',', '.')) || 0;
    if (num < 0) num = 0;
    if (num > max) num = max;
    setSelecionados(prev => ({ ...prev, [loteId]: num }));
    setQtdInputs(prev => { const n = { ...prev }; delete n[loteId]; return n; });
  };

  const totalSelecionado = Object.values(selecionados).reduce((s, v) => s + v, 0);
  const custoTotal = Object.entries(selecionados).reduce((s, [id, qtd]) => {
    const lote = lotes.find(l => l.id === id);
    return s + qtd * (lote?.custo_unitario || 0);
  }, 0);
  const custoMedio = totalSelecionado > 0 ? custoTotal / totalSelecionado : 0;

  const handleConfirmar = () => {
    const itensConfirmados = Object.entries(selecionados)
      .filter(([, qtd]) => qtd > 0)
      .map(([id, qtd]) => {
        const lote = lotes.find(l => l.id === id);
        return {
          lote_id: id,
          numero_documento: lote?.numero_documento || '',
          fornecedor_nome: lote?.fornecedor_nome || '',
          quantidade_consumida: qtd,
          custo_unitario: lote?.custo_unitario || 0,
        };
      });
    onConfirmar(itensConfirmados, totalSelecionado, custoMedio, custoTotal);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col p-2" onPointerDownOutside={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader className="pb-1">
          <DialogTitle className="text-sm font-semibold text-slate-900">
            Saída por Nota — {produtoNome}
          </DialogTitle>
          <div className="text-[11px] text-slate-500">
            Selecione as notas/lotes e defina a quantidade de cada um.
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {lotes.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs">
              Nenhum lote disponível para este produto neste local de estoque.
            </div>
          ) : (
            <table className="w-full border-collapse border-separate border-spacing-0 table-fixed">
              <colgroup>
                <col style={{ width: 30 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 100 }} />
              </colgroup>
              <thead>
                <tr>
                  <th className={`${TH} border-r-0`}></th>
                  <th className={TH}>Documento</th>
                  <th className={TH}>Data</th>
                  <th className={TH}>Fornecedor</th>
                  <th className={TH}>Saldo Disp.</th>
                  <th className={TH}>Custo Unit.</th>
                  <th className={TH}>Qtd. Saída</th>
                  <th className={`${TH} border-r-0`}>Custo Total</th>
                </tr>
              </thead>
              <tbody>
                {lotes.map((lote) => {
                  const isSel = lote.id in selecionados;
                  const qtd = selecionados[lote.id] || 0;
                  return (
                    <tr key={lote.id} className={`hover:bg-gray-50 ${isSel ? 'bg-emerald-50' : ''}`}>
                      <td className={`${TD} text-center border-r-0`}>
                        <Checkbox
                          checked={isSel}
                          onCheckedChange={(c) => toggleLote(lote.id, c)}
                          className="h-3.5 w-3.5"
                          disabled={lote.quantidade_disponivel <= 0}
                        />
                      </td>
                      <td className={TD}>{lote.numero_documento || 'S/N'}</td>
                      <td className={`${TD} text-center`}>{fmtData(lote.data_documento)}</td>
                      <td className={TD}>{lote.fornecedor_nome || '-'}</td>
                      <td className={`${TD} text-right font-mono`}>{fmt(lote.quantidade_disponivel)}</td>
                      <td className={`${TD} text-right font-mono`}>{fmtMoeda(lote.custo_unitario)}</td>
                      <td className={TD}>
                        {isSel ? (
                          <input
                            value={qtdInputs[lote.id] != null ? qtdInputs[lote.id] : fmt(qtd)}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^\d,\.]/g, '');
                              setQtdInputs(prev => ({ ...prev, [lote.id]: raw }));
                            }}
                            onBlur={() => {
                              const raw = qtdInputs[lote.id];
                              if (raw != null) {
                                setQuantidade(lote.id, raw);
                              }
                            }}
                            className={INP}
                          />
                        ) : (
                          <span className="text-slate-400 text-center block">-</span>
                        )}
                      </td>
                      <td className={`${TD} text-right font-mono border-r-0 ${isSel ? 'text-emerald-700 font-semibold' : 'text-slate-400'}`}>
                        {isSel ? fmtMoeda(qtd * (lote.custo_unitario || 0)) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between border-t pt-2 mt-1">
          <div className="text-[11px] text-slate-600 space-x-3">
            <span>Qtd Total: <strong className="font-mono">{fmt(totalSelecionado)}</strong></span>
            <span>Custo Médio: <strong className="font-mono text-emerald-700">{fmtMoeda(custoMedio)}</strong></span>
            <span>Custo Total: <strong className="font-mono">{fmtMoeda(custoTotal)}</strong></span>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleConfirmar}
              disabled={totalSelecionado <= 0}
            >
              Confirmar Seleção
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}