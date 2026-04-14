import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import FormularioCompraFinanceiro from "../financeiro/FormularioCompraFinanceiro.jsx";

export default function IntegrarFinanceiroDialog({ open, onOpenChange, onSave, fornecedores, dadosFinanceiro }) {
  const handleSubmitFinanceiro = async (data) => {
    // Não salva direto no banco — apenas devolve os dados para o formulário de estoque
    onSave(data);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1100px] max-h-[92vh] overflow-y-auto p-2">
        <DialogHeader className="pb-1">
          <DialogTitle className="text-sm font-semibold text-slate-900">Integrar com Financeiro</DialogTitle>
        </DialogHeader>
        <FormularioCompraFinanceiro
          onSubmit={handleSubmitFinanceiro}
          onCancel={() => onOpenChange(false)}
          initialData={dadosFinanceiro}
          fornecedores={fornecedores}
          tipoLancamento="Pagar"
        />
      </DialogContent>
    </Dialog>
  );
}