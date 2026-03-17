import React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function getDialogTitle(tipo) {
  if (tipo === "Transferência de Área") return "Editar Transferência de Área";
  if (tipo === "Morte") return "Editar Morte";
  if (tipo === "Nascimento") return "Editar Nascimento";
  if (tipo === "Abate") return "Editar Abate";
  if (tipo === "Mudança de Categoria") return "Editar Mudança de Categoria";
  if (tipo === "Pesagem") return "Editar Pesagem";
  return "Editar Lançamento";
}

export default function MovimentacaoEditDialog({
  open,
  movement,
  formData,
  isSaving,
  onClose,
  onChange,
  onSave,
}) {
  if (!movement || !formData) return null;

  const isPesagem = movement.tipo === "Pesagem";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{getDialogTitle(movement.tipo)}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Data</Label>
            <Input
              type="date"
              className="h-8 text-xs"
              value={formData.data_movimentacao || ""}
              onChange={(e) => onChange("data_movimentacao", e.target.value)}
            />
          </div>

          {!isPesagem && (
            <div className="space-y-1">
              <Label className="text-xs">Quantidade</Label>
              <Input
                type="number"
                min="0"
                className="h-8 text-xs"
                value={formData.quantidade_animais ?? 0}
                onChange={(e) => onChange("quantidade_animais", parseInt(e.target.value || "0", 10))}
              />
            </div>
          )}

          {isPesagem && (
            <div className="space-y-1">
              <Label className="text-xs">Peso médio (kg)</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                className="h-8 text-xs"
                value={formData.peso_medio ?? ""}
                onChange={(e) => onChange("peso_medio", e.target.value === "" ? "" : parseFloat(e.target.value || "0"))}
              />
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Observações</Label>
            <Textarea
              rows={3}
              className="text-xs"
              value={formData.observacoes || ""}
              onChange={(e) => onChange("observacoes", e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose} disabled={isSaving}>
              Cancelar
            </Button>
            <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={onSave} disabled={isSaving}>
              {isSaving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}