import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import ConfigurableForm from "@/components/dynamic/ConfigurableForm";

import { applyPesagemFieldChange, getInitialPesagemFormData } from "@/services/pesagemService";
import { setRecordValue } from "@/services/dynamicRecordService";
import { getLabelFieldByEntity } from "@/config/dynamicFieldSources";

export default function FormularioPesagem({ onSubmit, onCancel, initialData = null, isEditing = false, formConfig }) {
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

  const { data: dynamicOptions = {} } = useQuery({
    queryKey: ["dynamic-field-options-pesagem", formConfig?.id, empresaSelecionadaId],
    queryFn: async () => {
      const customFields = (formConfig?.sections || []).flatMap((section) => section.fields || []).filter((field) => field.source === "customizado" && field.rules?.comportamento === "selecao" && field.rules?.origem?.entidade);
      const entries = await Promise.all(customFields.map(async (field) => {
        const entityName = field.rules.origem.entidade;
        const labelField = field.rules.origem.coluna || getLabelFieldByEntity(entityName);
        const all = await base44.entities[entityName].list(labelField);
        const filtered = all.filter((item) => !item.empresa_id || item.empresa_id === empresaSelecionadaId);
        return [field.name, filtered.map((item) => ({ value: item[labelField] || item.id, label: item[labelField] || item.nome || item.nome_produto || item.id }))];
      }));
      return Object.fromEntries(entries);
    },
    enabled: !!empresaSelecionadaId && !!formConfig?.sections,
  });

  const handleChange = (field, value) => {
    const fieldConfig = typeof field === "string" ? { name: field } : field;
    setFormData((currentData) => {
      const updatedData = fieldConfig.source === "customizado"
        ? setRecordValue(currentData, fieldConfig, value)
        : applyPesagemFieldChange(currentData, fieldConfig.name, value);

      const withCalculated = { ...updatedData };
      (formConfig?.sections || []).flatMap((section) => section.fields || []).forEach((configuredField) => {
        if (configuredField.source !== "customizado" || configuredField.rules?.comportamento !== "soma") return;
        const campos = configuredField.rules?.soma?.campos || [];
        const values = campos.map((campo) => Number(withCalculated[campo] ?? withCalculated.campos_personalizados?.[campo] ?? 0)).filter((number) => !Number.isNaN(number));
        const total = values.reduce((sum, number) => sum + number, 0);
        withCalculated.campos_personalizados = {
          ...(withCalculated.campos_personalizados || {}),
          [configuredField.name]: configuredField.rules?.soma?.tipo === "avg" && values.length ? total / values.length : total,
        };
      });

      return withCalculated;
    });
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
              config={formConfig}
              formData={formData}
              onChange={handleChange}
              context={{ fornecedores, produtos, dynamicOptions }}
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