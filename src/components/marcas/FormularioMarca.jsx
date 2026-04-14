import React, { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

const INPUT_CLS = "h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent";

const FL = ({ label, required, error, children }) => (
  <div>
    <label className="text-[12px] text-slate-500 pl-1 leading-none">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div className={`rounded-md border ${error ? 'border-red-500 bg-red-50' : 'border-slate-300'} focus-within:border-emerald-500 transition-colors`}>
      {children}
    </div>
  </div>
);

export default function FormularioMarca({ onSubmit, onCancel, initialData }) {
  const isEditing = !!initialData?.id;
  const [form, setForm] = useState(() => ({
    nome: initialData?.nome || "",
    descricao: initialData?.descricao || "",
    ativo: initialData?.ativo !== false,
  }));
  const [invalidFields, setInvalidFields] = useState([]);

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setInvalidFields(prev => prev.filter(f => f !== field));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.nome?.trim()) { setInvalidFields(['nome']); toast.error('Nome é obrigatório!'); return; }
    onSubmit({ nome: form.nome.toUpperCase(), descricao: form.descricao?.toUpperCase() || undefined, ativo: form.ativo });
  };

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
          <CardTitle className="text-sm font-semibold text-slate-700">{isEditing ? 'Editar Marca' : 'Nova Marca'}</CardTitle>
        </CardHeader>
        <CardContent className="p-1">
          <form onSubmit={handleSubmit} className="space-y-0.5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
              <FL label="Nome" required error={invalidFields.includes('nome')}>
                <Input value={form.nome} onChange={(e) => handleChange('nome', e.target.value)} placeholder="NOME DA MARCA" className={`${INPUT_CLS} uppercase`} style={{ textTransform: 'uppercase' }} />
              </FL>
              <FL label="Descrição">
                <Input value={form.descricao} onChange={(e) => handleChange('descricao', e.target.value)} placeholder="DESCRIÇÃO" className={`${INPUT_CLS} uppercase`} style={{ textTransform: 'uppercase' }} />
              </FL>
            </div>
            <div className="flex flex-wrap gap-6 py-1 px-1">
              <div className="flex items-center gap-2">
                <Checkbox id="marca_ativo" checked={form.ativo} onCheckedChange={(v) => handleChange("ativo", v)} />
                <label htmlFor="marca_ativo" className="text-xs text-slate-700 cursor-pointer">Ativo</label>
              </div>
            </div>
            <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs px-3">Cancelar</Button>
              <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white">{isEditing ? 'Atualizar' : 'Salvar'}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}