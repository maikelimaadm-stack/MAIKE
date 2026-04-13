import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
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

const REQUIRED_FIELDS = ["nome", "categoria"];

const CATEGORIAS = [
  { value: "Planejado", label: "PLANEJADO" },
  { value: "Emergencial", label: "EMERGENCIAL" },
  { value: "ReposicaoEstoque", label: "REPOSIÇÃO DE ESTOQUE" },
  { value: "Manutencao", label: "MANUTENÇÃO" },
  { value: "Investimento", label: "INVESTIMENTO" },
  { value: "Operacional", label: "OPERACIONAL" },
  { value: "Outros", label: "OUTROS" },
];

export default function FormularioMotivoCompra({ onSubmit, onCancel, initialData, motivosExistentes = [] }) {
  const [errors, setErrors] = useState({});
  const [formData, setFormData] = useState({
    nome: "",
    categoria: "Operacional",
    descricao: "",
    ativo: true,
    requer_aprovacao: false,
  });

  useEffect(() => {
    if (initialData) {
      setFormData({
        nome: initialData.nome || "",
        categoria: initialData.categoria || "Operacional",
        descricao: initialData.descricao || "",
        ativo: initialData.ativo !== false,
        requer_aprovacao: initialData.requer_aprovacao || false,
      });
    }
  }, [initialData]);

  const handleChange = (field, value) => {
    setErrors(prev => ({ ...prev, [field]: false }));
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const validateForm = () => {
    const nextErrors = {};
    REQUIRED_FIELDS.forEach(field => {
      const val = formData[field];
      if (!val || (typeof val === "string" && val.trim() === "")) nextErrors[field] = true;
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) return true;
    toast.error("PREENCHA OS CAMPOS OBRIGATÓRIOS.");
    const firstField = Object.keys(nextErrors)[0];
    document.querySelector(`[data-field="${firstField}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    return false;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    let ordem = initialData?.ordem ?? 0;
    if (!initialData?.id) {
      const maxOrdem = motivosExistentes.reduce((max, m) => Math.max(max, m.ordem ?? 0), 0);
      ordem = maxOrdem + 1;
    }

    onSubmit({
      nome: formData.nome.toUpperCase(),
      categoria: formData.categoria,
      descricao: formData.descricao?.toUpperCase() || "",
      ativo: formData.ativo,
      requer_aprovacao: formData.requer_aprovacao,
      ordem,
    });
  };

  const isEditing = !!initialData?.id;

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
          <CardTitle className="text-sm font-semibold text-slate-700">
            {isEditing ? "Editar Motivo de Compra" : "Novo Motivo de Compra"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-1">
          <form onSubmit={handleSubmit} className="space-y-0.5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
              <FL label="Nome" required error={errors.nome} dataField="nome">
                <Input value={formData.nome} onChange={(e) => handleChange("nome", e.target.value)} placeholder="NOME DO MOTIVO" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} />
              </FL>
              <FL label="Categoria" required error={errors.categoria} dataField="categoria">
                <Select value={formData.categoria} onValueChange={(v) => handleChange("categoria", v)}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS.map(c => <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FL>
            </div>

            <FL label="Descrição" dataField="descricao">
              <Textarea value={formData.descricao} onChange={(e) => handleChange("descricao", e.target.value)} placeholder="DESCRIÇÃO OPCIONAL..." className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} rows={2} />
            </FL>

            <div className="flex flex-wrap gap-6 py-1 px-1">
              <div className="flex items-center gap-2">
                <Checkbox id="mc_ativo" checked={formData.ativo} onCheckedChange={(v) => handleChange("ativo", v)} />
                <label htmlFor="mc_ativo" className="text-xs text-slate-700 cursor-pointer">Ativo</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="mc_aprovacao" checked={formData.requer_aprovacao} onCheckedChange={(v) => handleChange("requer_aprovacao", v)} />
                <label htmlFor="mc_aprovacao" className="text-xs text-slate-700 cursor-pointer">Requer Aprovação</label>
              </div>
            </div>

            <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs px-3">Cancelar</Button>
              <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white">{isEditing ? "Atualizar" : "Salvar"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}