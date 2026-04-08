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

const REQUIRED_FIELDS = ["nome_tipo", "grupo_atividade_id"];
const UPPERCASE_FIELDS = ["nome_tipo", "descricao"];
const SELECT_EMPTY = "__VAZIO__";

export default function FormularioTipoTarefa({ initialData, grupos, isEditing, onSubmit, onCancel }) {
  const [errors, setErrors] = useState({});
  const [formData, setFormData] = useState({
    nome_tipo: "",
    grupo_atividade_id: "",
    grupo_atividade_nome: "",
    ativo: true,
    descricao: "",
    exige_area: false,
    pode_ter_produto: false,
    pode_ter_maquina: false,
    pode_ter_implemento: false,
  });

  useEffect(() => {
    setFormData({
      nome_tipo: initialData?.nome_tipo || "",
      grupo_atividade_id: initialData?.grupo_atividade_id || "",
      grupo_atividade_nome: initialData?.grupo_atividade_nome || "",
      ativo: initialData?.ativo ?? true,
      descricao: initialData?.descricao || "",
      exige_area: initialData?.exige_area ?? false,
      pode_ter_produto: initialData?.pode_ter_produto ?? false,
      pode_ter_maquina: initialData?.pode_ter_maquina ?? false,
      pode_ter_implemento: initialData?.pode_ter_implemento ?? false,
    });
    setErrors({});
  }, [initialData]);

  const getFieldClassName = (field, baseClass) => `${baseClass} ${errors[field] ? "border-red-500 bg-red-50 focus-visible:ring-red-500" : ""}`.trim();

  const handleChange = (field, value) => {
    const normalizedValue = UPPERCASE_FIELDS.includes(field) && typeof value === "string" ? value.toUpperCase() : value;
    setErrors((prev) => ({ ...prev, [field]: false }));
    setFormData((prev) => ({ ...prev, [field]: normalizedValue }));
  };

  const validateForm = () => {
    const nextErrors = {};
    REQUIRED_FIELDS.forEach((field) => {
      if (!String(formData?.[field] || "").trim()) nextErrors[field] = true;
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) return true;
    toast.error("PREENCHA OS CAMPOS OBRIGATÓRIOS.");
    return false;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    const grupo = grupos.find((item) => item.id === formData.grupo_atividade_id);
    onSubmit({
      ...formData,
      nome_tipo: String(formData.nome_tipo || "").toUpperCase(),
      descricao: String(formData.descricao || "").toUpperCase(),
      grupo_atividade_nome: grupo?.nome_grupo || formData.grupo_atividade_nome || "",
    });
  };

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
          <CardTitle className="text-sm font-semibold text-slate-900">
            {isEditing ? "Editar Tipo de Tarefa" : "Novo Tipo de Tarefa"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-1">
          <form onSubmit={handleSubmit} className="space-y-0.5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
              <FL label="Tipo de Tarefa" required error={errors.nome_tipo} dataField="nome_tipo">
                <Input value={formData.nome_tipo || ""} onChange={(e) => handleChange("nome_tipo", e.target.value)} placeholder="NOME DO TIPO" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} />
              </FL>
              <FL label="Grupo" required error={errors.grupo_atividade_id} dataField="grupo_atividade_id">
                <Select value={formData.grupo_atividade_id || SELECT_EMPTY} onValueChange={(value) => handleChange("grupo_atividade_id", value === SELECT_EMPTY ? "" : value)}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                    {grupos.map((grupo) => <SelectItem key={grupo.id} value={grupo.id} className="text-xs">{String(grupo.nome_grupo || "").toUpperCase()}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FL>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1 pt-0.5 border-t">
              <FL label="Ativo">
                <Select value={String(formData.ativo ?? true)} onValueChange={(value) => handleChange("ativo", value === "true")}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true" className="text-xs">SIM</SelectItem>
                    <SelectItem value="false" className="text-xs">NÃO</SelectItem>
                  </SelectContent>
                </Select>
              </FL>
            </div>
            <FL label="Descrição">
              <Textarea value={formData.descricao || ""} onChange={(e) => handleChange("descricao", e.target.value)} placeholder="DESCRIÇÃO DO TIPO" className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} rows={2} />
            </FL>
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