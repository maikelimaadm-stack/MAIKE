import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { GripVertical } from "lucide-react";

export default function ConfiguracaoColunasMapaDialog({
  open,
  onOpenChange,
  colunasDisponiveis,
  colunasVisiveis,
  colunasOrdem,
  toggleColuna,
  handleDragEnd,
  droppableId,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">Configurar Colunas</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 flex-1 overflow-auto">
          <div className="space-y-1">
            <p className="text-xs text-slate-600 font-semibold">Visibilidade</p>
            <div className="grid grid-cols-2 gap-2">
              {colunasDisponiveis.filter((c) => !c.fixo).map((coluna) => (
                <label key={coluna.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                  <input
                    type="checkbox"
                    checked={colunasVisiveis.includes(coluna.id)}
                    onChange={() => toggleColuna(coluna.id)}
                    className="rounded"
                  />
                  <span>{coluna.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="border-t pt-3">
            <p className="text-xs text-slate-600 font-semibold mb-2">Ordem (arraste para reordenar)</p>
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId={droppableId}>
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-1">
                    {colunasOrdem.map((colunaId, index) => {
                      const coluna = colunasDisponiveis.find((c) => c.id === colunaId);
                      if (!coluna || coluna.fixo) return null;

                      return (
                        <Draggable key={colunaId} draggableId={colunaId} index={index}>
                          {(dragProvided, snapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              className={`flex items-center gap-2 p-2 border rounded text-xs ${
                                snapshot.isDragging ? "bg-emerald-50 border-emerald-300" : "bg-white"
                              } ${!colunasVisiveis.includes(colunaId) ? "opacity-50" : ""}`}
                            >
                              <GripVertical className="w-4 h-4 text-slate-400" />
                              <span className="flex-1">{coluna.label}</span>
                              {colunasVisiveis.includes(colunaId) && (
                                <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300">
                                  Visível
                                </Badge>
                              )}
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} size="sm" className="h-7 text-xs">
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}