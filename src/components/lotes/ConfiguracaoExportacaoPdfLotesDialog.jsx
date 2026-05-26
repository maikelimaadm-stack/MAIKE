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
      <DialogContent className="bg-background fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-1rem)] max-h-[90vh] translate-x-[-50%] translate-y-[-50%] gap-1 overflow-x-hidden overflow-y-auto border-[1px] border-slate-200 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:w-full rounded-none sm:rounded-none sm:p-1 max-w-[760px]">
        <div className="space-y-1">
        <div className="border border-slate-200 bg-white">
          <div className="h-8 flex items-center gap-2 border-b border-slate-200 px-2">
            <span className="px-1.5 py-0.5 rounded-sm bg-slate-500 text-white text-[11px] font-bold">{tipo === "excel" ? "EXCEL" : "PDF"}</span>
            <span className="text-xs font-semibold text-slate-700 truncate">{titulo}</span>
          </div>

          <div className="md:px-8 w-full space-y-1 pt-1 pb-1">
            <label className="text-xs text-slate-700 items-center flex px-1 gap-2 mx-1">
              <ToggleSwitch checked={useConfiguredColumns} onChange={setUseConfiguredColumns} />
              <span className="truncate">Sempre exportar as colunas selecionadas abaixo</span>
            </label>
          </div>

          <div className="border border-slate-200 rounded-none max-h-72 overflow-auto">
            {columns.map((column) =>
              <label key={column.id} className="flex items-center gap-2 px-3 py-2 text-xs border-b border-slate-200 last:border-b-0 hover:bg-slate-50 rounded-none">
              <ToggleSwitch checked={columnIds.includes(column.id)} onChange={() => toggleColumn(column.id)} />
              <span className="truncate text-slate-700">{column.label}</span>
            </label>
              )}
          </div>

        </div>

        <div className="border border-slate-200 rounded-none bg-white">
          <div className="flex justify-end gap-0 border-t border-slate-200">
            <Button type="button" onClick={handleSave} title="Salvar" className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border hover:text-accent-foreground h-8 w-8 rounded-none border-y-0 border-l-0 border-r border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-none">
              <Check className="w-4 h-4" />
            </Button>
            <Button type="button" onClick={() => onOpenChange(false)} title="Descartar" className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border hover:text-accent-foreground h-8 w-8 rounded-none border-y-0 border-l-0 border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-none">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
        </div>
      </DialogContent>
    </Dialog>);

}