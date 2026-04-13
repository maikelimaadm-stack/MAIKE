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
const REQUIRED_FIELDS = ["nome", "tipo", "categoria"];

const CATEGORIAS = [
  { value: "Dinheiro", label: "DINHEIRO" },
  { value: "PIX", label: "PIX" },
  { value: "Boleto", label: "BOLETO" },
  { value: "CartaoCredito", label: "CARTÃO DE CRÉDITO" },
  { value: "CartaoDebito", label: "CARTÃO DE DÉBITO" },
  { value: "Transferencia", label: "TRANSFERÊNCIA" },
  { value: "Cheque", label: "CHEQUE" },
  { value: "Deposito", label: "DEPÓSITO" },
  { value: "Outros", label: "OUTROS" },
];

export default function FormularioFormaPagamento({ onSubmit, onCancel, initialData, formasExistentes = [] }) {
  const [errors, setErrors] = useState({});
  const [formData, setFormData] = useState({
    nome: "",
    tipo: "Ambos",
    categoria: "Dinheiro",
    permite_parcelamento: false,
    prazo_compensacao_dias: "",
    taxa_percentual: "",
    taxa_fixa: "",
    ativo: true,
    descricao: "",
  });

  useEffect(() => {
    if (initialData) {
      setFormData({
        nome: initialData.nome || initialData.descricao || "",
        tipo: initialData.tipo || "Ambos",
        categoria: initialData.categoria || "Dinheiro",
        permite_parcelamento: initialData.permite_parcelamento || false,
        prazo_compensacao_dias: initialData.prazo_compensacao_dias ?? initialData.prazo_padrao_dias ?? "",
        taxa_percentual: initialData.taxa_percentual ?? "",
        taxa_fixa: initialData.taxa_fixa ?? "",
        ativo: initialData.ativo !== false,
        descricao: initialData.descricao || "",
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
    const element = document.querySelector(`[data-field="${firstField}"]`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    return false;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    let ordem = initialData?.ordem ?? 0;
    if (!initialData?.id) {
      const maxOrdem = formasExistentes.reduce((max, f) => Math.max(max, f.ordem ?? 0), 0);
      ordem = maxOrdem + 1;
    }

    onSubmit({
      nome: formData.nome.toUpperCase(),
      tipo: formData.tipo,
      categoria: formData.categoria,
      permite_parcelamento: formData.permite_parcelamento,
      prazo_compensacao_dias: parseInt(formData.prazo_compensacao_dias) || 0,
      taxa_percentual: parseFloat(formData.taxa_percentual) || 0,
      taxa_fixa: parseFloat(formData.taxa_fixa) || 0,
      ativo: formData.ativo,
      descricao: formData.descricao?.toUpperCase() || "",
      ordem,
    });
  };

  const isEditing = !!initialData?.id;

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
          <CardTitle className="text-sm font-semibold text-slate-700">
            {isEditing ? "Editar Forma de Pagamento" : "Nova Forma de Pagamento"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-1">
          <form onSubmit={handleSubmit} className="space-y-0.5">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <FL label="Nome" required error={errors.nome} dataField="nome">
                <Input
                  value={formData.nome}
                  onChange={(e) => handleChange("nome", e.target.value)}
                  placeholder="NOME DA FORMA DE PAGAMENTO"
                  className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent"
                  style={{ textTransform: "uppercase" }}
                />
              </FL>
              <FL label="Tipo (Aplicação)" required error={errors.tipo} dataField="tipo">
                <Select value={formData.tipo} onValueChange={(v) => handleChange("tipo", v)}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Entrada" className="text-xs">ENTRADA (RECEBIMENTO)</SelectItem>
                    <SelectItem value="Saida" className="text-xs">SAÍDA (PAGAMENTO)</SelectItem>
                    <SelectItem value="Ambos" className="text-xs">AMBOS</SelectItem>
                  </SelectContent>
                </Select>
              </FL>
              <FL label="Categoria" required error={errors.categoria} dataField="categoria">
                <Select value={formData.categoria} onValueChange={(v) => handleChange("categoria", v)}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS.map(c => (
                      <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FL>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <FL label="Prazo Compensação (dias)" dataField="prazo_compensacao_dias">
                <Input
                  type="number"
                  min="0"
                  value={formData.prazo_compensacao_dias}
                  onChange={(e) => handleChange("prazo_compensacao_dias", e.target.value)}
                  placeholder="0"
                  className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent"
                />
              </FL>
              <FL label="Taxa Percentual (%)" dataField="taxa_percentual">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.taxa_percentual}
                  onChange={(e) => handleChange("taxa_percentual", e.target.value)}
                  placeholder="0.00"
                  className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent"
                />
              </FL>
              <FL label="Taxa Fixa (R$)" dataField="taxa_fixa">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.taxa_fixa}
                  onChange={(e) => handleChange("taxa_fixa", e.target.value)}
                  placeholder="0.00"
                  className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent"
                />
              </FL>
            </div>

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
                <Checkbox id="fp_ativo" checked={formData.ativo} onCheckedChange={(v) => handleChange("ativo", v)} />
                <label htmlFor="fp_ativo" className="text-xs text-slate-700 cursor-pointer">Ativa</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="fp_parcelamento" checked={formData.permite_parcelamento} onCheckedChange={(v) => handleChange("permite_parcelamento", v)} />
                <label htmlFor="fp_parcelamento" className="text-xs text-slate-700 cursor-pointer">Permite Parcelamento</label>
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