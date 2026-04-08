import React, { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const MESES = [
{ label: "Jan", field: "gmd_janeiro" },
{ label: "Fev", field: "gmd_fevereiro" },
{ label: "Mar", field: "gmd_marco" },
{ label: "Abr", field: "gmd_abril" },
{ label: "Mai", field: "gmd_maio" },
{ label: "Jun", field: "gmd_junho" },
{ label: "Jul", field: "gmd_julho" },
{ label: "Ago", field: "gmd_agosto" },
{ label: "Set", field: "gmd_setembro" },
{ label: "Out", field: "gmd_outubro" },
{ label: "Nov", field: "gmd_novembro" },
{ label: "Dez", field: "gmd_dezembro" }];


const REQUIRED_FIELDS = [
"nome",
"sigla",
"especie",
"sexo",
"raca",
"categoria_oficial",
"idade_minima_meses",
"idade_maxima_meses",
"ganho_peso_anual_kg",
...MESES.map((mes) => mes.field)];


const UPPERCASE_FIELDS = ["nome", "sigla", "raca"];

export default function FormularioCategoriaManejo({
  initialData,
  isEditing,
  onSubmit,
  onCancel,
  categoriasOficiaisDisponiveis
}) {
  const [invalidFields, setInvalidFields] = useState([]);
  const [formData, setFormData] = useState(initialData);

  const handleChange = (field, value) => {
    const nextValue =
    UPPERCASE_FIELDS.includes(field) && typeof value === "string" ?
    value.toUpperCase() :
    value;

    setFormData((prev) => ({ ...prev, [field]: nextValue }));
    setInvalidFields((prev) => prev.filter((item) => item !== field));
  };

  const getFieldClassName = (field, baseClass = "") => {
    return `${baseClass} ${
    invalidFields.includes(field) ?
    "border-red-500 bg-red-50 focus-visible:ring-red-500" :
    ""}`.
    trim();
  };

  const isEmptyValue = (value) => {
    if (typeof value === "string") return value.trim() === "";
    return value === undefined || value === null || value === "";
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const missingFields = REQUIRED_FIELDS.filter((field) =>
    isEmptyValue(formData?.[field])
    );

    if (missingFields.length > 0) {
      setInvalidFields(missingFields);
      toast.error("PREENCHA OS CAMPOS OBRIGATÓRIOS.");
      return;
    }

    onSubmit(formData);
  };

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
    <Card className="shadow-sm border-slate-300">
      <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
        <CardTitle className="text-sm font-semibold text-slate-900">
          {isEditing ? "Editar Categoria de Manejo" : "Nova Categoria de Manejo"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-1">
        <form onSubmit={handleSubmit} className="space-y-0.5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
            <FL label="Nome da Categoria" required error={invalidFields.includes('nome')}>
              <Input value={formData.nome || ""} onChange={(e) => handleChange("nome", e.target.value)} placeholder="NOME DA CATEGORIA" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" />
            </FL>
            <FL label="Sigla" required error={invalidFields.includes('sigla')}>
              <Input value={formData.sigla || ""} onChange={(e) => handleChange("sigla", e.target.value)} placeholder="SIGLA" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" maxLength={10} />
            </FL>
            <FL label="Espécie" required error={invalidFields.includes('especie')}>
              <Select value={formData.especie || "Bovinos"} onValueChange={(value) => handleChange("especie", value)}>
                <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Bovinos" className="text-xs">Bovinos</SelectItem>
                  <SelectItem value="Ovinos" className="text-xs">Ovinos</SelectItem>
                  <SelectItem value="Suínos" className="text-xs">Suínos</SelectItem>
                </SelectContent>
              </Select>
            </FL>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
            <FL label="Sexo" required error={invalidFields.includes('sexo')}>
              <Select value={formData.sexo || "__VAZIO__"} onValueChange={(value) => handleChange("sexo", value === "__VAZIO__" ? "" : value)}>
                <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__VAZIO__" className="text-xs">SELECIONE</SelectItem>
                  <SelectItem value="Macho" className="text-xs">Macho</SelectItem>
                  <SelectItem value="Fêmea" className="text-xs">Fêmea</SelectItem>
                </SelectContent>
              </Select>
            </FL>
            <FL label="Raça" required error={invalidFields.includes('raca')}>
              <Input value={formData.raca || ""} onChange={(e) => handleChange("raca", e.target.value)} placeholder="RAÇA" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" />
            </FL>
            <FL label="Categoria Oficial" required error={invalidFields.includes('categoria_oficial')}>
              <Select value={formData.categoria_oficial || "__VAZIO__"} onValueChange={(value) => handleChange("categoria_oficial", value === "__VAZIO__" ? "" : value)}>
                <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__VAZIO__" className="text-xs">SELECIONE</SelectItem>
                  {categoriasOficiaisDisponiveis.map((cat) => <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>)}
                </SelectContent>
              </Select>
            </FL>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
            <FL label="Idade Mínima (meses)" required error={invalidFields.includes('idade_minima_meses')}>
              <Input type="number" value={formData.idade_minima_meses} onChange={(e) => handleChange("idade_minima_meses", e.target.value)} placeholder="0" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
            </FL>
            <FL label="Idade Máxima (meses)" required error={invalidFields.includes('idade_maxima_meses')}>
              <Input type="number" value={formData.idade_maxima_meses} onChange={(e) => handleChange("idade_maxima_meses", e.target.value)} placeholder="0" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
            </FL>
            <FL label="Ganho de Peso Anual (kg)" required error={invalidFields.includes('ganho_peso_anual_kg')}>
              <Input type="number" step="0.01" value={formData.ganho_peso_anual_kg} onChange={(e) => handleChange("ganho_peso_anual_kg", e.target.value)} placeholder="0,00" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
            </FL>
          </div>
          <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-1 space-y-0.5">
            <span className="font-semibold text-xs text-slate-700">Previsão de GMD Mensal</span>
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-1">
              {MESES.map((mes) =>
              <FL key={mes.field} label={mes.label} required error={invalidFields.includes(mes.field)}>
                <Input type="number" step="0.01" value={formData[mes.field]} onChange={(e) => handleChange(mes.field, e.target.value)} placeholder="0,00" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
              </FL>
              )}
            </div>
          </div>
          <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs">Cancelar</Button>
            <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white">{isEditing ? "Atualizar" : "Salvar"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
    </motion.div>);

}