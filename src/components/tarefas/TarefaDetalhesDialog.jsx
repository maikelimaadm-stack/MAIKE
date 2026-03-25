import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import DetalhesTarefaMapa from "@/components/mapa/DetalhesTarefaMapa";

export default function TarefaDetalhesDialog({ open, onOpenChange, tarefa, onSaved }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[95vw] md:max-w-2xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Detalhes da tarefa</DialogTitle>
        </DialogHeader>
        {tarefa ? (
          <DetalhesTarefaMapa
            tarefa={tarefa}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}