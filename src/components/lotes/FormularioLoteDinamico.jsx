import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { z } from "zod";
import ConfigurableForm from "@/components/dynamic/ConfigurableForm";
import LegacyRecordToolbar from "./LegacyRecordToolbar.jsx";
import useLoteLayoutSchema from "@/hooks/useLoteLayoutSchema";
import campoEngine from "@/core/engine/campoEngine";

const buildZodSchema = (fields) => {
  const shape = {};
  fields.forEach((field) => {
    let validator = z.any();
    if (field.type === "number") validator = z.preprocess((value) => value === "" ? undefined : Number(value), z.number({ invalid_type_error: "Valor numérico inválido" }));
    if (field.type === "text" || field.type === "textarea" || field.type === "select" || field.type === "date") validator = z.string().optional();
    if (field.required) validator = validator.refine((value) => value !== undefined && value !== null && String(value).trim() !== "", "Campo obrigatório");
    shape[field.name] = validator.optional();
  });
  return z.object(shape);
};

export default function FormularioLoteDinamico({ onSubmit, onCancel, initialData, isEditing }) {
  const { schema, version } = useLoteLayoutSchema("form");
  const fields = useMemo(() => schema.flatMap((section) => section.fields), [schema]);
  const [errors, setErrors] = useState({});

  const defaultValues = useMemo(() => {
    const values = {};
    fields.forEach((field) => {
      values[field.name] = campoEngine.formatar(field, campoEngine.getValor(field, initialData || {}));
    });
    return values;
  }, [fields, initialData]);

  const { handleSubmit, watch, setValue } = useForm({ defaultValues });
  const formValues = watch();

  const onFieldChange = (fieldOrName, value) => {
    const fieldName = typeof fieldOrName === "string" ? fieldOrName : fieldOrName.name;
    const field = fields.find((item) => item.name === fieldName);
    const normalized = field?.uppercase && typeof value === "string" ? value.toUpperCase() : value;
    setValue(fieldName, normalized, { shouldDirty: true });
    setErrors((prev) => ({ ...prev, [fieldName]: null }));
  };

  const submitDynamic = (values) => {
    const zodResult = buildZodSchema(fields).safeParse(values);
    const nextErrors = {};

    if (!zodResult.success) {
      zodResult.error.issues.forEach((issue) => {
        nextErrors[issue.path[0]] = issue.message;
      });
    }

    fields.forEach((field) => {
      const error = campoEngine.validar(field, values[field.name]);
      if (error) nextErrors[field.name] = error;
    });

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      toast.error("PREENCHA OS CAMPOS OBRIGATÓRIOS.");
      return;
    }

    const dataToSave = fields.reduce((registro, field) => {
      return campoEngine.setValor(field, registro, values[field.name]);
    }, { ...(initialData || {}), campos_personalizados: initialData?.campos_personalizados || {} });

    onSubmit({
      ...dataToSave,
      layout_version: version,
      nome: dataToSave.nome?.toUpperCase?.() || dataToSave.nome || "",
      quantidade_entrada: dataToSave.quantidade_entrada ?? dataToSave.quantidade_cabecas,
      peso_entrada_kg: dataToSave.peso_entrada_kg ?? dataToSave.peso_medio_kg,
      categoria_entrada: dataToSave.categoria_entrada ?? dataToSave.categoria,
      origem: dataToSave.motivo_entrada?.toUpperCase?.() || dataToSave.origem || "",
    });
  };

  return (
    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
      <form onSubmit={handleSubmit(submitDynamic)} className="bg-white border border-slate-300 min-h-[calc(100dvh-150px)]">
        <LegacyRecordToolbar
          title={`${initialData?.numero_lote ? `${initialData.numero_lote} - ` : ""}${formValues.nome || (isEditing ? "Editar lote dinâmico" : "Novo lote dinâmico")}`}
          statusLabel="Formulário dinâmico"
          onCancel={onCancel}
        />
        <div className="px-4 md:px-8 py-3 max-w-[960px]">
          <ConfigurableForm
            config={{ sections: schema }}
            formData={formValues}
            onChange={onFieldChange}
            context={{ errors }}
          />
        </div>
        <div className="flex justify-end gap-1 p-2 bg-slate-50 border-t border-slate-200">
          <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs px-3">Cancelar</Button>
          <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white">{isEditing ? "Atualizar" : "Salvar"}</Button>
        </div>
      </form>
    </motion.div>
  );
}