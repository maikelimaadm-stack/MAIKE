import React, { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, GripVertical, Search } from "lucide-react";

const actionButtonClass = "h-8 w-9 rounded-none border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 shadow-none disabled:opacity-40";

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

  const commitLayout = (nextVisible, nextUsedOrder = usedColumns.map((coluna) => coluna.id)) => {
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
    const nextUsedOrder = [...usedColumns.map((coluna) => coluna.id), ...selectedAvailableIds];
    commitLayout(Array.from(new Set([...colunasVisiveis, ...selectedAvailableIds])), nextUsedOrder);
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

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const ids = usedColumns.map((coluna) => coluna.id);
    const [moved] = ids.splice(result.source.index, 1);
    ids.splice(result.destination.index, 0, moved);
    commitLayout(ids, ids);
  };

  const renderColumnButton = (coluna, selected, onClick, subtitle) => (
    <button
      key={coluna.id}
      type="button"
      onClick={onClick}
      className={`w-full rounded-sm border px-2 py-1.5 text-left transition-colors ${selected ? "bg-emerald-50 border-emerald-300 text-emerald-900" : "bg-gray-50 border-slate-200 text-slate-900 hover:bg-gray-100"}`}
    >
      <div className="text-xs font-semibold truncate">{coluna.label}</div>
      <div className="text-[10px] text-slate-500 truncate">{subtitle}</div>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[78vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="text-sm">Configurar colunas da tabela</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[1fr_52px_1.2fr] flex-1 min-h-0 bg-white">
          <aside className="border-r border-slate-300 p-3 overflow-hidden flex flex-col">
            <div className="text-sm font-semibold text-slate-800 mb-2">Colunas disponíveis</div>
            <div className="relative mb-3">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Procurar coluna" className="h-8 text-xs pr-8" />
              <Search className="w-3.5 h-3.5 text-slate-500 absolute right-2 top-2" />
            </div>
            <div className="flex-1 overflow-auto space-y-1 pr-1">
              {filteredAvailable.length === 0 ? <div className="text-xs text-slate-400 py-6 text-center">Nenhuma coluna disponível.</div> : filteredAvailable.map((coluna) => renderColumnButton(coluna, selectedAvailableIds.includes(coluna.id), (event) => selectAvailable(coluna.id, event), "Disponível"))}
            </div>
          </aside>

          <section className="border-r border-slate-300 bg-slate-50 flex flex-col items-center justify-center gap-0">
            <Button type="button" variant="outline" size="icon" disabled={usedColumns.length === 0} onClick={removeAll} className={actionButtonClass} title="Remover todas"><ChevronsLeft className="w-4 h-4" /></Button>
            <Button type="button" variant="outline" size="icon" disabled={selectedUsedIds.length === 0} onClick={removeSelected} className={actionButtonClass} title="Remover selecionadas"><ChevronLeft className="w-4 h-4" /></Button>
            <Button type="button" variant="outline" size="icon" disabled={selectedAvailableIds.length === 0} onClick={addSelected} className={actionButtonClass} title="Adicionar selecionadas"><ChevronRight className="w-4 h-4" /></Button>
            <Button type="button" variant="outline" size="icon" disabled={availableColumns.length === 0} onClick={addAll} className={actionButtonClass} title="Adicionar todas"><ChevronsRight className="w-4 h-4" /></Button>
          </section>

          <main className="p-3 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm font-semibold text-slate-800">Colunas em uso</div>
                <div className="text-[11px] text-slate-500">Arraste para definir a posição na tabela.</div>
              </div>
              <div className="text-xs text-slate-500">{usedColumns.length} em uso</div>
            </div>
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="colunas-lotes-em-uso">
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef} className="flex-1 overflow-auto space-y-1 pr-1 rounded-sm border border-slate-200 bg-slate-50 p-2">
                    {usedColumns.length === 0 && <div className="text-xs text-slate-400 py-6 text-center">Envie colunas para cá para aparecerem na tabela.</div>}
                    {usedColumns.map((coluna, index) => (
                      <Draggable key={coluna.id} draggableId={coluna.id} index={index}>
                        {(dragProvided, snapshot) => (
                          <div ref={dragProvided.innerRef} {...dragProvided.draggableProps} {...dragProvided.dragHandleProps}>
                            <div className={`flex items-center gap-2 rounded-sm border px-2 py-1.5 ${snapshot.isDragging ? "bg-emerald-50 border-emerald-300" : selectedUsedIds.includes(coluna.id) ? "bg-emerald-50 border-emerald-300" : "bg-white border-slate-200 hover:bg-gray-50"}`} onClick={(event) => selectUsed(coluna.id, event)}>
                              <GripVertical className="w-4 h-4 text-slate-400" />
                              <span className="flex h-5 w-6 items-center justify-center rounded bg-slate-100 text-[10px] text-slate-600">{index + 1}</span>
                              <span className="flex-1 truncate text-xs font-semibold text-slate-800">{coluna.label}</span>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </main>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t bg-slate-50">
          <Button variant="outline" onClick={() => onOpenChange(false)} size="sm" className="h-8 text-xs">
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}