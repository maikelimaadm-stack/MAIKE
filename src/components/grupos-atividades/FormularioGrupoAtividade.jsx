import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const FL = ({ label, required, error, children, dataField }) => (
  <div data-field={dataField}>
    <label className="text-[12px] text-slate-500 pl-1 leading-none">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div className={`rounded-md border ${error ? 'border-red-500 bg-red-50' : 'border-slate-300'} focus-within:border-emerald-500 transition-colors`}>
      {children}
    </div>
  </div>
);

const REQUIRED_FIELDS = ["nome_grupo"];
const UPPERCASE_FIELDS = ["nome_grupo", "descricao", "observacoes"];
const SELECT_EMPTY = "__VAZIO__";

export default function FormularioGrupoAtividade({ initialData, isEditing, onSubmit, onCancel }) {
  const [errors, setErrors] = useState({});
  const [formData, setFormData] = useState({
    nome_grupo: "",
    ativo: true,
    descricao: "",
    observacoes: "",
  });

  useEffect(() => {
    setFormData({
      nome_grupo: initialData?.nome_grupo || "",
      ativo: initialData?.ativo ?? true,
      descricao: initialData?.descricao || "",
      observacoes: initialData?.observacoes || "",
    });
    setErrors({});
  }, [initialData]);

  const getFieldClassName = (field, baseClass) => {
    return `${baseClass} ${errors[field] ? "border-red-500 bg-red-50 focus-visible:ring-red-500" : ""}`.trim();
  };

  const handleChange = (field, value) => {
    const normalizedValue = UPPERCASE_FIELDS.includes(field) && typeof value === "string" ? value.toUpperCase() : value;
    setErrors((prev) => ({ ...prev, [field]: false }));
    setFormData((prev) => ({ ...prev, [field]: normalizedValue }));
  };

  const validateForm = () => {
    const nextErrors = {};

    REQUIRED_FIELDS.forEach((field) => {
      if (!String(formData?.[field] || "").trim()) {
        nextErrors[field] = true;
      }
    });

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length === 0) return true;

    toast.error("PREENCHA OS CAMPOS OBRIGATÓRIOS.");
    const firstField = Object.keys(nextErrors)[0];
    const element = document.querySelector(`[data-field="${firstField}"]`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    element?.focus?.();
    return false;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    onSubmit({
      ...formData,
      nome_grupo: String(formData.nome_grupo || "").toUpperCase(),
      descricao: String(formData.descricao || "").toUpperCase(),
      observacoes: String(formData.observacoes || "").toUpperCase(),
    });
  };

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
          <CardTitle className="text-sm font-semibold text-slate-900">
            {isEditing ? "Editar Grupo de Atividades" : "Novo Grupo de Atividades"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-1">
          <form onSubmit={handleSubmit} className="space-y-0.5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
              <FL label="Nome do Grupo" required error={errors.nome_grupo} dataField="nome_grupo">
                <Input value={formData.nome_grupo || ""} onChange={(e) => handleChange("nome_grupo", e.target.value)} placeholder="NOME DO GRUPO" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} />
              </FL>
              <FL label="Ativo" dataField="ativo">
                <Select value={String(formData.ativo ?? true)} onValueChange={(value) => handleChange("ativo", value === "true")}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                    <SelectItem value="true" className="text-xs">SIM</SelectItem>
                    <SelectItem value="false" className="text-xs">NÃO</SelectItem>
                  </SelectContent>
                </Select>
              </FL>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1 pt-0.5 border-t">
              <FL label="Descrição" dataField="descricao">
                <Textarea value={formData.descricao || ""} onChange={(e) => handleChange("descricao", e.target.value)} placeholder="DESCRIÇÃO DO GRUPO" className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} rows={2} />
              </FL>
              <FL label="Observações" dataField="observacoes">
                <Textarea value={formData.observacoes || ""} onChange={(e) => handleChange("observacoes", e.target.value)} placeholder="OBSERVAÇÕES GERAIS..." className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} rows={2} />
              </FL>
            </div>
            <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs">Cancelar</Button>
              <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white">{isEditing ? "Atualizar" : "Salvar"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}