import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

export default function MovimentacaoEstoqueFormV2({ onSubmit, onCancel, initialData = null, produtos = [], fornecedores = [] }) {
  return (
    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
          <CardTitle className="text-sm font-semibold text-slate-900">
            {initialData?.id ? 'Editar Movimentação' : 'Nova Movimentação de Estoque'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="text-center py-12 text-slate-500">
            <p className="text-sm font-medium mb-2">Formulário em construção</p>
            <p className="text-xs text-slate-400">O novo formulário de movimentação de estoque será implementado aqui.</p>
          </div>
          <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs">Cancelar</Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}