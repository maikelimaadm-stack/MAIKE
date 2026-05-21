import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, X } from "lucide-react";
import ToggleSwitch from "@/components/common/ToggleSwitch";
import { saveLotesExcelExportConfig, saveLotesPdfExportConfig } from "./pdfExportConfig";

export default function ConfiguracaoExportacaoPdfLotesDialog({ open, onOpenChange, columns = [], initialConfig, tipo = "pdf" }) {
  const [useConfiguredColumns, setUseConfiguredColumns] = useState(false);
  const [columnIds, setColumnIds] = useState([]);

  useEffect(() => {
    setUseConfiguredColumns(Boolean(initialConfig?.useConfiguredColumns));
    setColumnIds(initialConfig?.columnIds?.length ? initialConfig.columnIds : columns.map((column) => column.id));
  }, [initialConfig, columns, open]);

  const toggleColumn = (columnId) => {
    setColumnIds((prev) => prev.includes(columnId) ? prev.filter((id) => id !== columnId) : [...prev, columnId]);
  };

  const handleSave = () => {
    const config = { useConfiguredColumns, columnIds };
    if (tipo === "excel") {
      saveLotesExcelExportConfig(config);
    } else {
      saveLotesPdfExportConfig(config);
    }
    onOpenChange(false);
  };

  const titulo = tipo === "excel" ? "Configuração da exportação Excel" : "Configuração da exportação PDF";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-[1.5px] border border-slate-200 p-0 gap-0 sm:p-0 shadow-none overflow-hidden">
        <DialogHeader className="px-2 py-1 border-b border-slate-200">
          <DialogTitle className="text-sm">{titulo}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 p-2">
          <label className="grid grid-cols-[minmax(0,1fr)_110px] items-center gap-1 text-xs text-slate-700">
            <span className="truncate text-right">Sempre exportar selecionadas:</span>
            <span className="h-6 border border-slate-300 bg-white rounded-[1.5px] flex items-center px-1">
              <ToggleSwitch checked={useConfiguredColumns} onChange={setUseConfiguredColumns} />
            </span>
          </label>

          <div className="border border-slate-200 rounded-[1.5px] max-h-72 overflow-auto">
            {columns.map((column) =>
            <label key={column.id} className="grid grid-cols-[minmax(0,1fr)_110px] items-center gap-1 px-2 py-1 text-xs border-b border-slate-200 last:border-b-0 hover:bg-slate-50">
              <span className="truncate text-right text-slate-700">{column.label}:</span>
              <span className="h-6 border border-slate-300 bg-white rounded-[1.5px] flex items-center px-1">
                <ToggleSwitch checked={columnIds.includes(column.id)} onChange={() => toggleColumn(column.id)} />
              </span>
            </label>
            )}
          </div>

          <div className="flex justify-end border-t border-slate-200 pt-2">
            <div className="inline-grid grid-cols-2 border border-slate-200 rounded-[1.5px] overflow-hidden">
              <Button type="button" onClick={handleSave} title="Salvar" className="h-8 w-12 rounded-none border-0 border-r border-slate-200 bg-white hover:bg-slate-50 text-slate-800 shadow-none p-0">
                <Check className="w-4 h-4" />
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)} title="Descartar" className="h-8 w-12 rounded-none border-0 bg-white hover:bg-slate-50 text-slate-800 shadow-none p-0">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>);

}