import React, { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function FormularioFinanceiro({ onSubmit, onCancel, initialData, fornecedores, produtos, safras }) {
  const isEditing = !!initialData?.id;

  const handleSubmit = (e) => {
    e.preventDefault();
    toast.info("Formulário em construção — campos serão adicionados.");
  };

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
          <CardTitle className="text-sm font-semibold text-slate-700">
            {isEditing ? 'Editar Lançamento' : 'Novo Lançamento Financeiro'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-1" style={{ maxHeight: 'calc(100vh - 150px)', overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: "thin", scrollbarColor: "#cbd5e1 transparent" }}>
          <form onSubmit={handleSubmit} className="space-y-0.5">

            {/* === CAMPOS SERÃO ADICIONADOS AQUI === */}
            <div className="py-12 text-center text-slate-400 text-xs">
              Formulário será reconstruído — adicione os campos desejados.
            </div>

            <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs px-3">
                Cancelar
              </Button>
              <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white">
                {isEditing ? 'Atualizar' : 'Salvar'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}