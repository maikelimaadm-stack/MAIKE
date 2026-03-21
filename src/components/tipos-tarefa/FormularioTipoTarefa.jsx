import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

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
        <CardHeader className="bg-slate-50 border-b py-3 px-4">
          <CardTitle className="text-sm font-semibold text-slate-700">
            {isEditing ? "Editar Tipo de Tarefa" : "Cadastrar Novo Tipo de Tarefa"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-1">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
              <div className="space-y-1">
                <Label className="text-xs">Tipo de Tarefa *</Label>
                <Input data-field="nome_tipo" value={formData.nome_tipo || ""} onChange={(e) => handleChange("nome_tipo", e.target.value)} placeholder="NOME DO TIPO" className={getFieldClassName("nome_tipo", "h-8 text-xs uppercase")} style={{ textTransform: "uppercase" }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Grupo *</Label>
                <div data-field="grupo_atividade_id">
                  <Select value={formData.grupo_atividade_id || SELECT_EMPTY} onValueChange={(value) => handleChange("grupo_atividade_id", value === SELECT_EMPTY ? "" : value)}>
                    <SelectTrigger className={getFieldClassName("grupo_atividade_id", "h-8 text-xs")}><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                      {grupos.map((grupo) => <SelectItem key={grupo.id} value={grupo.id} className="text-xs">{String(grupo.nome_grupo || "").toUpperCase()}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1 pt-1 border-t">
              <div className="space-y-1">
                <Label className="text-xs">Ativo</Label>
                <Select value={String(formData.ativo ?? true)} onValueChange={(value) => handleChange("ativo", value === "true")}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true" className="text-xs">SIM</SelectItem>
                    <SelectItem value="false" className="text-xs">NÃO</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1 pt-1 border-t">
              <Label className="text-xs">Descrição</Label>
              <Textarea value={formData.descricao || ""} onChange={(e) => handleChange("descricao", e.target.value)} placeholder="DESCRIÇÃO DO TIPO" className="text-xs uppercase min-h-[96px]" style={{ textTransform: "uppercase" }} rows={3} />
            </div>

            <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">Cancelar</Button>
              <Button type="submit" size="sm" className="bg-lime-500 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-8 hover:bg-emerald-700">{isEditing ? "Atualizar" : "Salvar"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}