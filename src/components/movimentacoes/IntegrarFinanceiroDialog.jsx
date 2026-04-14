import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import FormularioCompraFinanceiro from "../financeiro/FormularioCompraFinanceiro.jsx";

export default function IntegrarFinanceiroDialog({ open, onOpenChange, onSave, fornecedores, dadosFinanceiro }) {
  const handleSubmitFinanceiro = async (data) => {
    onSave(data);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[1100px] max-h-[92vh] p-2"
        style={{ overflow: 'visible' }}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}}
      >
        <DialogHeader className="pb-1">
          <DialogTitle className="text-sm font-semibold text-slate-900">Integrar com Financeiro</DialogTitle>
          <DialogDescription className="sr-only">Preencha os dados financeiros para integrar com a movimentação de estoque</DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(92vh-60px)] overflow-y-auto overflow-x-visible">
          <FormularioCompraFinanceiro
            onSubmit={handleSubmitFinanceiro}
            onCancel={() => onOpenChange(false)}
            initialData={dadosFinanceiro}
            fornecedores={fornecedores}
            tipoLancamento="Pagar"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}