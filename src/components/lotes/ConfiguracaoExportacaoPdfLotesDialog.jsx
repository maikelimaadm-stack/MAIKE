import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
      <DialogContent className="max-w-lg rounded-[1.5px] border border-slate-300 p-1 gap-1 sm:p-1 shadow-none">
        <DialogHeader className="px-2 pt-1 border-b border-slate-300 pb-1">
          <DialogTitle className="text-sm">{titulo}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 p-2">
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <ToggleSwitch checked={useConfiguredColumns} onChange={setUseConfiguredColumns} />
            Sempre exportar as colunas selecionadas abaixo
          </label>

          <div className="border border-slate-300 rounded-[1.5px] max-h-72 overflow-auto">
            {columns.map((column) =>
            <label key={column.id} className="flex items-center gap-2 px-3 py-2 text-xs border-b border-slate-300 last:border-b-0 hover:bg-slate-50">
              <ToggleSwitch checked={columnIds.includes(column.id)} onChange={() => toggleColumn(column.id)} />
              <span className="truncate">{column.label}</span>
            </label>
            )}
          </div>

          <div className="grid grid-cols-2 gap-1 border-t border-slate-300 pt-2">
            <Button type="button" onClick={() => onOpenChange(false)} className="h-7 rounded-none bg-slate-600 hover:bg-slate-700 text-white text-xs shadow-none">Descartar</Button>
            <Button type="button" onClick={handleSave} className="h-7 rounded-none bg-green-500 hover:bg-green-600 text-white text-xs shadow-none">Salvar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>);

}