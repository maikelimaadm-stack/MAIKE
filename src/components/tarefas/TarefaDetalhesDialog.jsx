import React from "react";
import { LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import DetalhesTarefaMapa from "@/components/mapa/DetalhesTarefaMapa";

/** Detalhes da tarefa na abertura padrão (D-PROD-118): o título é a tarefa, só ✕. */
export default function TarefaDetalhesDialog({ open, onOpenChange, tarefa, onSaved }) {
  return (
    <LancLoteDialogo open={open} onOpenChange={onOpenChange} titulo="Detalhes da tarefa" largo somenteLeitura>
      {tarefa ? (
        <DetalhesTarefaMapa
          tarefa={tarefa}
          onClose={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      ) : null}
    </LancLoteDialogo>
  );
}
