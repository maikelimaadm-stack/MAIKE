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

const SELECT_EMPTY = "__VAZIO__";
const REQUIRED_FIELDS = ["nome", "tipo"];

export default function FormularioCentroCusto({ onSubmit, onCancel, initialData, centrosExistentes = [] }) {
  const [errors, setErrors] = useState({});
  const [formData, setFormData] = useState({
    nome: "",
    tipo: "Analitico",
    centro_custo_pai_id: "",
    descricao: "",
    ativo: true,
    permite_lancamento_direto: true,
  });

  useEffect(() => {
    if (initialData) {
      setFormData({
        nome: initialData.nome || "",
        tipo: initialData.tipo || "Analitico",
        centro_custo_pai_id: initialData.centro_custo_pai_id || "",
        descricao: initialData.descricao || "",
        ativo: initialData.ativo !== false,
        permite_lancamento_direto: initialData.permite_lancamento_direto !== false,
      });
    }
  }, [initialData]);

  const handleChange = (field, value) => {
    const newData = { ...formData, [field]: value };
    if (field === "tipo" && value === "Sintetico") {
      newData.permite_lancamento_direto = false;
    }
    setErrors(prev => ({ ...prev, [field]: false }));
    setFormData(newData);
  };

  const centrosPaiDisponiveis = centrosExistentes.filter(c => {
    if (initialData && c.id === initialData.id) return false;
    if (initialData && c.centro_custo_pai_id === initialData.id) return false;
    return true;
  });

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
    const element = document.querySelector(`[data-field="${firstField}"]`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    return false;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    const siblings = centrosExistentes.filter(c => {
      if (formData.centro_custo_pai_id) return c.centro_custo_pai_id === formData.centro_custo_pai_id;
      return !c.centro_custo_pai_id;
    });
    let ordem = initialData?.ordem ?? 0;
    if (!initialData?.id) {
      const maxOrdem = siblings.reduce((max, c) => Math.max(max, c.ordem ?? 0), 0);
      ordem = maxOrdem + 1;
    }

    const centroPai = centrosExistentes.find(c => c.id === formData.centro_custo_pai_id);

    onSubmit({
      nome: formData.nome.toUpperCase(),
      tipo: formData.tipo,
      centro_custo_pai_id: formData.centro_custo_pai_id || undefined,
      centro_custo_pai_nome: centroPai?.nome || "",
      descricao: formData.descricao?.toUpperCase() || "",
      ativo: formData.ativo,
      ordem,
      permite_lancamento_direto: formData.permite_lancamento_direto,
    });
  };

  const isEditing = !!initialData?.id;

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
          <CardTitle className="text-sm font-semibold text-slate-700">
            {isEditing ? "Editar Centro de Custo" : "Novo Centro de Custo"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-1">
          <form onSubmit={handleSubmit} className="space-y-0.5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
              <FL label="Nome" required error={errors.nome} dataField="nome">
                <Input
                  value={formData.nome}
                  onChange={(e) => handleChange("nome", e.target.value)}
                  placeholder="NOME DO CENTRO DE CUSTO"
                  className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent"
                  style={{ textTransform: "uppercase" }}
                />
              </FL>
              <FL label="Tipo" required error={errors.tipo} dataField="tipo">
                <Select value={formData.tipo} onValueChange={(v) => handleChange("tipo", v)}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Analitico" className="text-xs">ANALÍTICO (ACEITA LANÇAMENTOS)</SelectItem>
                    <SelectItem value="Sintetico" className="text-xs">SINTÉTICO (AGRUPADOR)</SelectItem>
                  </SelectContent>
                </Select>
              </FL>
            </div>

            <FL label="Centro de Custo Pai" dataField="centro_custo_pai_id">
              <Select value={formData.centro_custo_pai_id || SELECT_EMPTY} onValueChange={(v) => handleChange("centro_custo_pai_id", v === SELECT_EMPTY ? "" : v)}>
                <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="NENHUM (RAIZ)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={SELECT_EMPTY} className="text-xs">NENHUM (RAIZ)</SelectItem>
                  {centrosPaiDisponiveis.map(c => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">{(c.nome || "").toUpperCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FL>

            <FL label="Descrição" dataField="descricao">
              <Textarea
                value={formData.descricao}
                onChange={(e) => handleChange("descricao", e.target.value)}
                placeholder="DESCRIÇÃO OPCIONAL..."
                className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent"
                style={{ textTransform: "uppercase" }}
                rows={2}
              />
            </FL>

            <div className="flex flex-wrap gap-6 py-1 px-1">
              <div className="flex items-center gap-2">
                <Checkbox id="cc_ativo" checked={formData.ativo} onCheckedChange={(v) => handleChange("ativo", v)} />
                <label htmlFor="cc_ativo" className="text-xs text-slate-700 cursor-pointer">Ativo</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="cc_permite_lancamento"
                  checked={formData.permite_lancamento_direto}
                  onCheckedChange={(v) => handleChange("permite_lancamento_direto", v)}
                  disabled={formData.tipo === "Sintetico"}
                />
                <label htmlFor="cc_permite_lancamento" className={`text-xs cursor-pointer ${formData.tipo === "Sintetico" ? "text-slate-400" : "text-slate-700"}`}>
                  Permite Lançamento Direto
                </label>
              </div>
            </div>

            <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs px-3">
                Cancelar
              </Button>
              <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white">
                {isEditing ? "Atualizar" : "Salvar"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}