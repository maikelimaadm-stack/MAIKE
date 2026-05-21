import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
      <DialogContent className="max-w-lg rounded-[1.5px] p-1 gap-1 sm:p-1">
        <DialogHeader className="px-2 pt-1">
          <DialogTitle className="text-sm">{titulo}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 p-2">
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <Checkbox checked={useConfiguredColumns} onCheckedChange={setUseConfiguredColumns} className="h-3 w-3 rounded-none border-slate-400 data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500" />
            Sempre exportar as colunas selecionadas abaixo
          </label>

          <div className="border border-slate-300 rounded-[1.5px] max-h-72 overflow-auto">
            {columns.map((column) =>
            <label key={column.id} className="flex items-center gap-2 px-3 py-2 text-xs border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                <Checkbox checked={columnIds.includes(column.id)} onCheckedChange={() => toggleColumn(column.id)} className="h-3 w-3 rounded-none border-slate-400 data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500" />
                <span className="truncate">{column.label}</span>
              </label>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} className="rounded-[1.5px] border-slate-300 shadow-none">Descartar</Button>
            <Button type="button" size="sm" onClick={handleSave} className="rounded-[1.5px] bg-green-500 hover:bg-green-600 text-white shadow-none">Salvar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>);

}