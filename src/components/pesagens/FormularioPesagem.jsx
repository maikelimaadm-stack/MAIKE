import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import ConfigurableForm from "@/components/dynamic/ConfigurableForm";
import { PESAGEM_FORM_CONFIG } from "@/config/pesagensConfig";
import { applyPesagemFieldChange, getInitialPesagemFormData } from "@/services/pesagemService";

export default function FormularioPesagem({ onSubmit, onCancel, initialData = null, isEditing = false }) {
  const [formData, setFormData] = useState(() => getInitialPesagemFormData(initialData));
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");

  const { data: fornecedores = [] } = useQuery({
    queryKey: ["fornecedores_pesagem", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list("nome");
      return all.filter((fornecedor) => fornecedor.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos_pesagem", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list("nome_produto");
      return all.filter((produto) => produto.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const handleChange = (field, value) => {
    setFormData((currentData) => applyPesagemFieldChange(currentData, field, value));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit(formData);
  };

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300 bg-white">
        <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
          <CardTitle className="text-sm font-semibold text-slate-900">
            {isEditing ? "Editar Pesagem" : "Nova Pesagem"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <ConfigurableForm
              config={PESAGEM_FORM_CONFIG}
              formData={formData}
              onChange={handleChange}
              context={{ fornecedores, produtos }}
            />

            <div className="flex justify-end gap-2 pt-2 border-t">
              {onCancel && (
                <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
                  Cancelar
                </Button>
              )}
              <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                {isEditing ? "Atualizar" : "Salvar"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}