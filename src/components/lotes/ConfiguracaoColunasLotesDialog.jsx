import React, { useMemo, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsLeft, ChevronsRight, Search, X } from "lucide-react";

const iconButtonClass = "rounded-none border-0 bg-white hover:bg-slate-50 text-slate-700 shadow-none h-7 w-7";
const moveButtonClass = "h-7 w-8 rounded-none border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 shadow-none disabled:opacity-40";

export default function ConfiguracaoColunasLotesDialog({
  open,
  onOpenChange,
  colunasDisponiveis = [],
  colunasVisiveis = [],
  colunasOrdem = [],
  onChange,
}) {
  const [selectedAvailableIds, setSelectedAvailableIds] = useState([]);
  const [selectedUsedIds, setSelectedUsedIds] = useState([]);
  const [search, setSearch] = useState("");

  const orderedColumns = useMemo(() => {
    const byId = new Map(colunasDisponiveis.filter((c) => !c.fixo).map((coluna) => [coluna.id, coluna]));
    const orderedIds = [...colunasOrdem, ...colunasDisponiveis.map((coluna) => coluna.id)].filter((id, index, arr) => byId.has(id) && arr.indexOf(id) === index);
    return orderedIds.map((id) => byId.get(id)).filter(Boolean);
  }, [colunasDisponiveis, colunasOrdem]);

  const usedColumns = orderedColumns.filter((coluna) => colunasVisiveis.includes(coluna.id));
  const availableColumns = orderedColumns.filter((coluna) => !colunasVisiveis.includes(coluna.id));
  const filteredAvailable = availableColumns.filter((coluna) => String(coluna.label || "").toLowerCase().includes(search.toLowerCase()));

  const commitLayout = (nextVisible, nextUsedOrder) => {
    const remainingIds = orderedColumns.map((coluna) => coluna.id).filter((id) => !nextUsedOrder.includes(id));
    onChange?.({ visiveis: nextVisible, ordem: [...nextUsedOrder, ...remainingIds] });
  };

  const selectAvailable = (colunaId, event) => {
    setSelectedAvailableIds((prev) => event.ctrlKey || event.metaKey || event.shiftKey ? prev.includes(colunaId) ? prev.filter((id) => id !== colunaId) : [...prev, colunaId] : [colunaId]);
    setSelectedUsedIds([]);
  };

  const selectUsed = (colunaId, event) => {
    setSelectedUsedIds((prev) => event.ctrlKey || event.metaKey || event.shiftKey ? prev.includes(colunaId) ? prev.filter((id) => id !== colunaId) : [...prev, colunaId] : [colunaId]);
    setSelectedAvailableIds([]);
  };

  const addSelected = () => {
    if (!selectedAvailableIds.length) return;
    const nextVisible = Array.from(new Set([...colunasVisiveis, ...selectedAvailableIds]));
    const nextUsedOrder = [...usedColumns.map((coluna) => coluna.id), ...selectedAvailableIds];
    commitLayout(nextVisible, nextUsedOrder);
    setSelectedAvailableIds([]);
  };

  const addAll = () => {
    const allIds = orderedColumns.map((coluna) => coluna.id);
    commitLayout(allIds, allIds);
    setSelectedAvailableIds([]);
  };

  const removeSelected = () => {
    if (!selectedUsedIds.length) return;
    const nextVisible = colunasVisiveis.filter((id) => !selectedUsedIds.includes(id));
    const nextUsedOrder = usedColumns.map((coluna) => coluna.id).filter((id) => !selectedUsedIds.includes(id));
    commitLayout(nextVisible, nextUsedOrder);
    setSelectedUsedIds([]);
  };

  const removeAll = () => {
    commitLayout([], []);
    setSelectedUsedIds([]);
  };

  const moveSelected = (direction) => {
    if (selectedUsedIds.length !== 1) return;
    const currentOrder = usedColumns.map((coluna) => coluna.id);
    const index = currentOrder.indexOf(selectedUsedIds[0]);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= currentOrder.length) return;
    [currentOrder[index], currentOrder[nextIndex]] = [currentOrder[nextIndex], currentOrder[index]];
    commitLayout(currentOrder, currentOrder);
  };

  const renderColumnButton = (coluna, selected, onClick, subtitle, index) => (
    <button
      key={coluna.id}
      type="button"
      onClick={onClick}
      className={`relative flex w-full items-center gap-2 border-b border-slate-200 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-slate-50 ${selected ? "bg-emerald-50 text-emerald-800" : "bg-white text-slate-700"}`}
    >
      {index !== undefined && <span className="flex h-5 w-6 shrink-0 items-center justify-center rounded-sm bg-slate-100 text-[10px] text-slate-600">{index + 1}</span>}
      <span className="min-w-0 flex-1 truncate">{coluna.label}</span>
      <span className="shrink-0 text-[10px] text-slate-400">{subtitle}</span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-background fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-1rem)] max-h-[90vh] translate-x-[-50%] translate-y-[-50%] gap-0 overflow-hidden border border-slate-200 shadow-lg sm:w-full rounded-none sm:rounded-none sm:p-1 max-w-[860px]">
        <div className="bg-white border border-slate-200 overflow-hidden">
          <div className="h-8 flex items-center gap-2 border-b border-slate-200 px-2">
            <span className="px-1.5 py-0.5 rounded-sm bg-slate-500 text-white text-[11px] font-bold">COLUNAS</span>
            <span className="text-xs font-semibold text-slate-700 truncate">Configuração das colunas do cadastro de lotes</span>
          </div>

          <div className="grid grid-cols-[1fr_52px_1.15fr_40px] h-[430px] min-h-0">
            <aside className="border-r border-slate-200 overflow-hidden flex flex-col">
              <div className="h-8 px-3 border-b border-slate-200 flex items-center text-xs font-semibold text-slate-700">Colunas disponíveis</div>
              <div className="relative p-2 border-b border-slate-200">
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Procurar coluna" className="h-7 text-xs pr-8 rounded-none shadow-none focus-visible:ring-0" />
                <Search className="w-3.5 h-3.5 text-slate-500 absolute right-4 top-3.5" />
              </div>
              <div className="flex-1 overflow-auto">
                {filteredAvailable.length === 0 ? <div className="text-xs text-slate-400 py-6 text-center">Nenhuma coluna disponível.</div> : filteredAvailable.map((coluna) => renderColumnButton(coluna, selectedAvailableIds.includes(coluna.id), (event) => selectAvailable(coluna.id, event), "Disponível"))}
              </div>
            </aside>

            <section className="border-r border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-0">
              <Button type="button" variant="outline" size="icon" disabled={usedColumns.length === 0} onClick={removeAll} className={moveButtonClass} title="Remover todas"><ChevronsLeft className="w-3.5 h-3.5" /></Button>
              <Button type="button" variant="outline" size="icon" disabled={selectedUsedIds.length === 0} onClick={removeSelected} className={moveButtonClass} title="Remover selecionadas"><ChevronLeft className="w-3.5 h-3.5" /></Button>
              <Button type="button" variant="outline" size="icon" disabled={selectedAvailableIds.length === 0} onClick={addSelected} className={moveButtonClass} title="Adicionar selecionadas"><ChevronRight className="w-3.5 h-3.5" /></Button>
              <Button type="button" variant="outline" size="icon" disabled={availableColumns.length === 0} onClick={addAll} className={moveButtonClass} title="Adicionar todas"><ChevronsRight className="w-3.5 h-3.5" /></Button>
            </section>

            <main className="border-r border-slate-200 overflow-hidden flex flex-col">
              <div className="h-8 px-3 border-b border-slate-200 flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>Colunas em uso</span>
                <span className="font-normal text-slate-400">{usedColumns.length} colunas</span>
              </div>
              <div className="flex-1 overflow-auto">
                {usedColumns.length === 0 ? <div className="text-xs text-slate-400 py-6 text-center">Envie colunas para cá para aparecerem na tabela.</div> : usedColumns.map((coluna, index) => renderColumnButton(coluna, selectedUsedIds.includes(coluna.id), (event) => selectUsed(coluna.id, event), "Em uso", index))}
              </div>
            </main>

            <section className="bg-slate-50 flex flex-col items-center justify-center gap-0">
              <Button type="button" variant="outline" size="icon" disabled={selectedUsedIds.length !== 1} onClick={() => moveSelected(-1)} className={moveButtonClass} title="Subir coluna"><ChevronUp className="w-3.5 h-3.5" /></Button>
              <Button type="button" variant="outline" size="icon" disabled={selectedUsedIds.length !== 1} onClick={() => moveSelected(1)} className={moveButtonClass} title="Descer coluna"><ChevronDown className="w-3.5 h-3.5" /></Button>
            </section>
          </div>
        </div>

        <div className="flex justify-end bg-white pt-1">
          <div className="flex divide-x divide-slate-200 border border-slate-200">
            <Button type="button" onClick={() => onOpenChange(false)} title="Salvar" className={iconButtonClass}>
              <Check className="w-4 h-4" />
            </Button>
            <Button type="button" onClick={() => onOpenChange(false)} title="Fechar" className={iconButtonClass}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}