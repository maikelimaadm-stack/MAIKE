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

export default function FormularioContaFinanceira({ onSubmit, onCancel, initialData, contasExistentes = [] }) {
  const [errors, setErrors] = useState({});
  const [formData, setFormData] = useState({
    nome: "",
    tipo: "Banco",
    banco: "",
    agencia: "",
    conta: "",
    saldo_inicial: "",
    moeda: "BRL",
    ativo: true,
    permite_negativo: false,
    descricao: "",
  });

  useEffect(() => {
    if (initialData) {
      setFormData({
        nome: initialData.nome || "",
        tipo: initialData.tipo || "Banco",
        banco: initialData.banco || "",
        agencia: initialData.agencia || "",
        conta: initialData.conta || "",
        saldo_inicial: initialData.saldo_inicial ?? "",
        moeda: initialData.moeda || "BRL",
        ativo: initialData.ativo !== false,
        permite_negativo: initialData.permite_negativo || false,
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
      const maxOrdem = contasExistentes.reduce((max, c) => Math.max(max, c.ordem ?? 0), 0);
      ordem = maxOrdem + 1;
    }

    onSubmit({
      nome: formData.nome.toUpperCase(),
      tipo: formData.tipo,
      banco: formData.banco?.toUpperCase() || "",
      agencia: formData.agencia?.toUpperCase() || "",
      conta: formData.conta?.toUpperCase() || "",
      saldo_inicial: parseFloat(formData.saldo_inicial) || 0,
      saldo_atual: initialData?.saldo_atual ?? (parseFloat(formData.saldo_inicial) || 0),
      moeda: formData.moeda || "BRL",
      ativo: formData.ativo,
      permite_negativo: formData.permite_negativo,
      descricao: formData.descricao?.toUpperCase() || "",
      ordem,
    });
  };

  const isEditing = !!initialData?.id;
  const isBanco = formData.tipo === "Banco";

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
          <CardTitle className="text-sm font-semibold text-slate-700">
            {isEditing ? "Editar Conta Financeira" : "Nova Conta Financeira"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-1">
          <form onSubmit={handleSubmit} className="space-y-0.5">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <FL label="Nome" required error={errors.nome} dataField="nome">
                <Input
                  value={formData.nome}
                  onChange={(e) => handleChange("nome", e.target.value)}
                  placeholder="NOME DA CONTA"
                  className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent"
                  style={{ textTransform: "uppercase" }}
                />
              </FL>
              <FL label="Tipo" required error={errors.tipo} dataField="tipo">
                <Select value={formData.tipo} onValueChange={(v) => handleChange("tipo", v)}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Banco" className="text-xs">BANCO</SelectItem>
                    <SelectItem value="Caixa" className="text-xs">CAIXA</SelectItem>
                    <SelectItem value="CarteiraDigital" className="text-xs">CARTEIRA DIGITAL</SelectItem>
                  </SelectContent>
                </Select>
              </FL>
              <FL label="Moeda" dataField="moeda">
                <Select value={formData.moeda || "BRL"} onValueChange={(v) => handleChange("moeda", v)}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BRL" className="text-xs">BRL (REAL)</SelectItem>
                    <SelectItem value="USD" className="text-xs">USD (DÓLAR)</SelectItem>
                  </SelectContent>
                </Select>
              </FL>
            </div>

            {isBanco && (
              <div className="border rounded-lg p-1 space-y-0.5 bg-slate-50/50">
                <span className="font-semibold text-xs text-slate-700">Dados Bancários</span>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                  <FL label="Banco" dataField="banco">
                    <Input
                      value={formData.banco}
                      onChange={(e) => handleChange("banco", e.target.value)}
                      placeholder="NOME DO BANCO"
                      className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent"
                      style={{ textTransform: "uppercase" }}
                    />
                  </FL>
                  <FL label="Agência" dataField="agencia">
                    <Input
                      value={formData.agencia}
                      onChange={(e) => handleChange("agencia", e.target.value)}
                      placeholder="AGÊNCIA"
                      className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent"
                      style={{ textTransform: "uppercase" }}
                    />
                  </FL>
                  <FL label="Conta" dataField="conta">
                    <Input
                      value={formData.conta}
                      onChange={(e) => handleChange("conta", e.target.value)}
                      placeholder="NÚMERO DA CONTA"
                      className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent"
                      style={{ textTransform: "uppercase" }}
                    />
                  </FL>
                </div>
              </div>
            )}

            <FL label="Saldo Inicial (R$)" dataField="saldo_inicial">
              <Input
                type="number"
                step="0.01"
                value={formData.saldo_inicial}
                onChange={(e) => handleChange("saldo_inicial", e.target.value)}
                placeholder="0.00"
                className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent"
              />
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
                <Checkbox id="cf_ativo" checked={formData.ativo} onCheckedChange={(v) => handleChange("ativo", v)} />
                <label htmlFor="cf_ativo" className="text-xs text-slate-700 cursor-pointer">Ativa</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="cf_negativo" checked={formData.permite_negativo} onCheckedChange={(v) => handleChange("permite_negativo", v)} />
                <label htmlFor="cf_negativo" className="text-xs text-slate-700 cursor-pointer">Permite Saldo Negativo</label>
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