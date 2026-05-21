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
      <DialogContent className="max-w-lg rounded-[1px] border-[1px] border-slate-200 p-0 gap-0 sm:p-0 shadow-none">
        <DialogHeader className="px-2 py-1 border-b border-slate-200 rounded-t-[1.5px]">
          <DialogTitle className="text-sm">{titulo}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 p-2">
          <label className="flex items-center gap-2 text-xs text-slate-700 rounded-[1px] px-3">
            <ToggleSwitch checked={useConfiguredColumns} onChange={setUseConfiguredColumns} />
            <span className="truncate">Sempre exportar as colunas selecionadas abaixo</span>
          </label>

          <div className="border border-slate-200 rounded-[1px] max-h-72 overflow-auto">
            {columns.map((column) =>
            <label key={column.id} className="flex items-center gap-2 px-3 py-2 text-xs border-b border-slate-200 last:border-b-0 hover:bg-slate-50 rounded-none">
              <ToggleSwitch checked={columnIds.includes(column.id)} onChange={() => toggleColumn(column.id)} />
              <span className="truncate text-slate-700">{column.label}</span>
            </label>
            )}
          </div>

          <div className="flex justify-end border-t border-slate-200 py-1 rounded-[1px]">
            <div className="inline-grid grid-cols-2 border border-slate-200 rounded-[1px]">
              <Button type="button" onClick={handleSave} title="Salvar" className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border hover:text-accent-foreground h-7 w-8 rounded-none border-y-0 border-l-0 border-r-[0.5px] border-slate-300 bg-white hover:bg-slate-50 text-slate-700 shadow-none">
                <Check className="w-4 h-4" />
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)} title="Descartar" className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border hover:text-accent-foreground h-7 w-8 rounded-none border-y-0 border-l-0 border-slate-300 bg-white hover:bg-slate-50 text-slate-700 shadow-none">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>);

}