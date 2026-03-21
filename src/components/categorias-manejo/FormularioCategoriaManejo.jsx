import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

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
  { label: "Dez", field: "gmd_dezembro" },
];

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
  ...MESES.map((mes) => mes.field),
];
const UPPERCASE_FIELDS = ["nome", "sigla", "raca"];

export default function FormularioCategoriaManejo({
  initialData,
  isEditing,
  onSubmit,
  onCancel,
  categoriasOficiaisDisponiveis,
}) {
  const [invalidFields, setInvalidFields] = useState([]);
  const [formData, setFormData] = useState(initialData);

  const handleChange = (field, value) => {
    const nextValue = UPPERCASE_FIELDS.includes(field) && typeof value === "string"
      ? value.toUpperCase()
      : value;

    setFormData((prev) => ({ ...prev, [field]: nextValue }));
    setInvalidFields((prev) => prev.filter((item) => item !== field));
  };

  const getFieldClassName = (field, baseClass = "") => {
    return `${baseClass} ${invalidFields.includes(field) ? "border-red-500 bg-red-50 focus-visible:ring-red-500" : ""}`.trim();
  };

  const isEmptyValue = (value) => {
    if (typeof value === "string") return value.trim() === "";
    return value === undefined || value === null || value === "";
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const missingFields = REQUIRED_FIELDS.filter((field) => isEmptyValue(formData?.[field]));

    if (missingFields.length > 0) {
      setInvalidFields(missingFields);
      toast.error("PREENCHA OS CAMPOS OBRIGATÓRIOS.");
      return;
    }

    onSubmit(formData);
  };

  return (
    <Card className="shadow-sm border-slate-300 bg-white">
      <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
        <CardTitle className="text-sm font-semibold text-slate-900">
          {isEditing ? "Editar Categoria de Manejo" : "Nova Categoria de Manejo"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Nome da Categoria *</Label>
              <Input
                value={formData.nome || ""}
                onChange={(e) => handleChange("nome", e.target.value)}
                placeholder="NOME DA CATEGORIA"
                className={getFieldClassName("nome", "h-8 text-xs uppercase")}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Sigla *</Label>
              <Input
                value={formData.sigla || ""}
                onChange={(e) => handleChange("sigla", e.target.value)}
                placeholder="SIGLA"
                className={getFieldClassName("sigla", "h-8 text-xs uppercase")}
                maxLength={10}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Espécie *</Label>
              <Select value={formData.especie || "Bovinos"} onValueChange={(value) => handleChange("especie", value)}>
                <SelectTrigger className={getFieldClassName("especie", "h-8 text-xs")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Bovinos" className="text-xs">Bovinos</SelectItem>
                  <SelectItem value="Ovinos" className="text-xs">Ovinos</SelectItem>
                  <SelectItem value="Suínos" className="text-xs">Suínos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Sexo *</Label>
              <Select value={formData.sexo || "__VAZIO__"} onValueChange={(value) => handleChange("sexo", value === "__VAZIO__" ? "" : value)}>
                <SelectTrigger className={getFieldClassName("sexo", "h-8 text-xs")}>
                  <SelectValue placeholder="SELECIONE" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__VAZIO__" className="text-xs">SELECIONE</SelectItem>
                  <SelectItem value="Macho" className="text-xs">Macho</SelectItem>
                  <SelectItem value="Fêmea" className="text-xs">Fêmea</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Raça *</Label>
              <Input
                value={formData.raca || ""}
                onChange={(e) => handleChange("raca", e.target.value)}
                placeholder="RAÇA"
                className={getFieldClassName("raca", "h-8 text-xs uppercase")}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Categoria Oficial *</Label>
              <Select value={formData.categoria_oficial || "__VAZIO__"} onValueChange={(value) => handleChange("categoria_oficial", value === "__VAZIO__" ? "" : value)}>
                <SelectTrigger className={getFieldClassName("categoria_oficial", "h-8 text-xs")}>
                  <SelectValue placeholder="SELECIONE" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__VAZIO__" className="text-xs">SELECIONE</SelectItem>
                  {categoriasOficiaisDisponiveis.map((cat) => (
                    <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Idade Mínima (meses) *</Label>
              <Input
                type="number"
                value={formData.idade_minima_meses}
                onChange={(e) => handleChange("idade_minima_meses", e.target.value)}
                placeholder="0"
                className={getFieldClassName("idade_minima_meses", "h-8 text-xs")}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Idade Máxima (meses) *</Label>
              <Input
                type="number"
                value={formData.idade_maxima_meses}
                onChange={(e) => handleChange("idade_maxima_meses", e.target.value)}
                placeholder="0"
                className={getFieldClassName("idade_maxima_meses", "h-8 text-xs")}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Ganho de Peso Anual (kg) *</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.ganho_peso_anual_kg}
                onChange={(e) => handleChange("ganho_peso_anual_kg", e.target.value)}
                placeholder="0,00"
                className={getFieldClassName("ganho_peso_anual_kg", "h-8 text-xs")}
              />
            </div>
          </div>

          <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-3 space-y-1">
            <div>
              <span className="font-semibold text-sm text-slate-700">Previsão de Ganho de Peso Mensal (GMD)</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-1">
              {MESES.map((mes) => (
                <div key={mes.field} className="space-y-1">
                  <Label className="text-xs">{mes.label} *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData[mes.field]}
                    onChange={(e) => handleChange(mes.field, e.target.value)}
                    placeholder="0,00"
                    className={getFieldClassName(mes.field, "h-8 text-xs")}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col-reverse lg:flex-row justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
              {isEditing ? "Atualizar" : "Salvar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}