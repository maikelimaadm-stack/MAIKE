import React, { useState } from "react";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import CadastroFormField, { CADASTRO_INPUT_CLS } from "@/components/cadastro/base1/CadastroFormField";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";

const FL = ({ label, required, error, children }) => (
  <CadastroFormField label={label} required={required} error={error}>
    {children}
  </CadastroFormField>
);
const INPUT_CLS = CADASTRO_INPUT_CLS;

export default function FormularioMarca({ onSubmit, onCancel, initialData, variant = "card" }) {
  const isEditing = !!initialData?.id;
  const embedded = variant === "embedded";
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
      <CadastroFormShell
        embedded={embedded}
        title={isEditing ? "Editar Marca" : "Nova Marca"}
      >
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
          <CadastroFormActions
            onCancel={onCancel}
            submitLabel={isEditing ? "Atualizar" : "Salvar"}
          />
        </form>
      </CadastroFormShell>
    </motion.div>
  );
}
