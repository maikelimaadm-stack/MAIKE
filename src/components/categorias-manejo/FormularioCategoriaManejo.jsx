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
    setFormData((prev) => ({ ...prev, [field]: value }));
    setInvalidFields((prev) => prev.filter((item) => item !== field));
  };

  const getFieldClassName = (field, baseClass = "") => {
    return `${baseClass} ${invalidFields.includes(field) ? "border-red-500 bg-red-50 focus-visible:ring-red-500" : ""}`.trim();
  };

  const handleSubmit = (e) => {
    e.preventDefault();

const missingFields = [];

if (!formData.nome?.trim()) missingFields.push("nome");
if (!formData.sigla?.trim()) missingFields.push("sigla");
if (!formData.especie?.trim()) missingFields.push("especie");
if (!formData.sexo?.trim()) missingFields.push("sexo");
if (!formData.raca?.trim()) missingFields.push("raca");
if (!formData.categoria_oficial?.trim()) missingFields.push("categoria_oficial");

if (!formData.idade_minima_meses) missingFields.push("idade_minima_meses");
if (!formData.idade_maxima_meses) missingFields.push("idade_maxima_meses");
if (!formData.ganho_peso_anual_kg) missingFields.push("ganho_peso_anual_kg");

// GMD meses
if (!formData.gmd_janeiro) missingFields.push("gmd_janeiro");
if (!formData.gmd_fevereiro) missingFields.push("gmd_fevereiro");
if (!formData.gmd_marco) missingFields.push("gmd_marco");
if (!formData.gmd_abril) missingFields.push("gmd_abril");
if (!formData.gmd_maio) missingFields.push("gmd_maio");
if (!formData.gmd_junho) missingFields.push("gmd_junho");
if (!formData.gmd_julho) missingFields.push("gmd_julho");
if (!formData.gmd_agosto) missingFields.push("gmd_agosto");
if (!formData.gmd_setembro) missingFields.push("gmd_setembro");
if (!formData.gmd_outubro) missingFields.push("gmd_outubro");
if (!formData.gmd_novembro) missingFields.push("gmd_novembro");
if (!formData.gmd_dezembro) missingFields.push("gmd_dezembro");

    if (missingFields.length > 0) {
      setInvalidFields(missingFields);
      toast.error("Preencha os campos obrigatórios.");
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
        <form onSubmit={handleSubmit} className="space-y-1">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
            <div className="space-y-1">
              <Label className="text-xs">Nome da Categoria *</Label>
              <Input
                value={formData.nome}
                onChange={(e) => handleChange("nome", e.target.value)}
                placeholder="NOME DA CATEGORIA"
                className={getFieldClassName("nome", "h-8 text-xs uppercase")}
                style={{ textTransform: "uppercase" }}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Sigla *</Label>
              <Input
                value={formData.sigla}
                onChange={(e) => handleChange("sigla", e.target.value)}
                placeholder="SIGLA"
                className={getFieldClassName("sigla", "h-8 text-xs uppercase")}
                style={{ textTransform: "uppercase" }}
                maxLength={10}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Espécie</Label>
              <Select value={formData.especie || "Bovinos"} onValueChange={(value) => handleChange("especie", value)}>
                <SelectTrigger className="h-8 text-xs">
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
            <div className="space-y-1">
              <Label className="text-xs">Sexo</Label>
              <Select value={formData.sexo || "__VAZIO__"} onValueChange={(value) => handleChange("sexo", value === "__VAZIO__" ? "" : value)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__VAZIO__" className="text-xs">Selecione</SelectItem>
                  <SelectItem value="Macho" className="text-xs">Macho</SelectItem>
                  <SelectItem value="Fêmea" className="text-xs">Fêmea</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Raça</Label>
              <Input
                value={formData.raca}
                onChange={(e) => handleChange("raca", e.target.value)}
                placeholder="RAÇA"
                className="h-8 text-xs uppercase"
                style={{ textTransform: "uppercase" }}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Categoria Oficial</Label>
              <Select value={formData.categoria_oficial || "__VAZIO__"} onValueChange={(value) => handleChange("categoria_oficial", value === "__VAZIO__" ? "" : value)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__VAZIO__" className="text-xs">Selecione</SelectItem>
                  {categoriasOficiaisDisponiveis.map((cat) => (
                    <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
            <div className="space-y-1">
              <Label className="text-xs">Idade Mínima (meses)</Label>
              <Input
                type="number"
                value={formData.idade_minima_meses}
                onChange={(e) => handleChange("idade_minima_meses", e.target.value)}
                placeholder="0"
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Idade Máxima (meses)</Label>
              <Input
                type="number"
                value={formData.idade_maxima_meses}
                onChange={(e) => handleChange("idade_maxima_meses", e.target.value)}
                placeholder="0"
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Ganho de Peso Anual (kg)</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.ganho_peso_anual_kg}
                onChange={(e) => handleChange("ganho_peso_anual_kg", e.target.value)}
                placeholder="0,00"
                className="h-8 text-xs"
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
                  <Label className="text-xs">{mes.label}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData[mes.field]}
                    onChange={(e) => handleChange(mes.field, e.target.value)}
                    placeholder="0,00"
                    className="h-8 text-xs"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
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