import React from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import FormularioCompraFinanceiro from "../financeiro/FormularioCompraFinanceiro.jsx";

export default function IntegrarFinanceiroDialog({ open, onOpenChange, onSave, fornecedores, dadosFinanceiro }) {
  const handleSubmitFinanceiro = async (data) => {
    await onSave(data);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[1100px] max-h-[92vh] p-0 gap-0 overflow-x-visible overflow-y-visible"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Título acessível oculto - o FormularioCompraFinanceiro já tem seu próprio header visual */}
        <DialogTitle className="sr-only">Novo Lançamento Financeiro</DialogTitle>
        <DialogDescription className="sr-only">Preencha os dados financeiros para integrar com a movimentação de estoque</DialogDescription>
        <div className="max-h-[88vh] overflow-y-auto overflow-x-hidden">
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