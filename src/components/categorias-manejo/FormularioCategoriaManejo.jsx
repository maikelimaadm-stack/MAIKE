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
    return `${baseClass} ${
      invalidFields.includes(field)
        ? "border-red-500 bg-red-50 focus-visible:ring-red-500"
        : ""
    }`.trim();
  };

  const isEmpty = (value) => {
    return value === undefined || value === null || value === "";
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const requiredFields = [
      "nome",
      "sigla",
      "especie",
      "sexo",
      "raca",
      "categoria_oficial",
      "idade_minima_meses",
      "idade_maxima_meses",
      "ganho_peso_anual_kg",
      ...MESES.map((m) => m.field),
    ];

    const missingFields = requiredFields.filter((field) =>
      isEmpty(formData[field])
    );

    if (missingFields.length > 0) {
      setInvalidFields(missingFields);
      toast.error("Preencha todos os campos obrigatórios.");
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
        <form onSubmit={handleSubmit} className="space-y-2">

          {/* LINHA 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">

            <div>
              <Label className="text-xs">Nome da Categoria *</Label>
              <Input
                value={formData.nome}
                onChange={(e) => handleChange("nome", e.target.value)}
                className={getFieldClassName("nome", "h-8 text-xs")}
              />
            </div>

            <div>
              <Label className="text-xs">Sigla *</Label>
              <Input
                value={formData.sigla}
                onChange={(e) => handleChange("sigla", e.target.value)}
                className={getFieldClassName("sigla", "h-8 text-xs")}
              />
            </div>

            <div>
              <Label className="text-xs">Espécie *</Label>
              <Select
                value={formData.especie || ""}
                onValueChange={(value) => handleChange("especie", value)}
              >
                <SelectTrigger className={getFieldClassName("especie", "h-8 text-xs")}>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Selecione</SelectItem>
                  <SelectItem value="Bovinos">Bovinos</SelectItem>
                  <SelectItem value="Ovinos">Ovinos</SelectItem>
                  <SelectItem value="Suínos">Suínos</SelectItem>
                </SelectContent>
              </Select>
            </div>

          </div>

          {/* LINHA 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">

            <div>
              <Label className="text-xs">Sexo *</Label>
              <Select
                value={formData.sexo || ""}
                onValueChange={(value) => handleChange("sexo", value)}
              >
                <SelectTrigger className={getFieldClassName("sexo", "h-8 text-xs")}>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Selecione</SelectItem>
                  <SelectItem value="Macho">Macho</SelectItem>
                  <SelectItem value="Fêmea">Fêmea</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Raça *</Label>
              <Input
                value={formData.raca}
                onChange={(e) => handleChange("raca", e.target.value)}
                className={getFieldClassName("raca", "h-8 text-xs")}
              />
            </div>

            <div>
              <Label className="text-xs">Categoria Oficial *</Label>
              <Select
                value={formData.categoria_oficial || ""}
                onValueChange={(value) =>
                  handleChange("categoria_oficial", value)
                }
              >
                <SelectTrigger className={getFieldClassName("categoria_oficial", "h-8 text-xs")}>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Selecione</SelectItem>
                  {categoriasOficiaisDisponiveis.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

          </div>

          {/* LINHA 3 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">

            <div>
              <Label className="text-xs">Idade Mínima (meses) *</Label>
              <Input
                type="number"
                value={formData.idade_minima_meses}
                onChange={(e) =>
                  handleChange("idade_minima_meses", e.target.value)
                }
                className={getFieldClassName("idade_minima_meses", "h-8 text-xs")}
              />
            </div>

            <div>
              <Label className="text-xs">Idade Máxima (meses) *</Label>
              <Input
                type="number"
                value={formData.idade_maxima_meses}
                onChange={(e) =>
                  handleChange("idade_maxima_meses", e.target.value)
                }
                className={getFieldClassName("idade_maxima_meses", "h-8 text-xs")}
              />
            </div>

            <div>
              <Label className="text-xs">Ganho de Peso Anual (kg) *</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.ganho_peso_anual_kg}
                onChange={(e) =>
                  handleChange("ganho_peso_anual_kg", e.target.value)
                }
                className={getFieldClassName("ganho_peso_anual_kg", "h-8 text-xs")}
              />
            </div>

          </div>

          {/* GMD */}
          <div className="border rounded-lg p-3">
            <span className="text-sm font-semibold">
              GMD Mensal *
            </span>

            <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 mt-2">
              {MESES.map((mes) => (
                <div key={mes.field}>
                  <Label className="text-xs">{mes.label} *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData[mes.field]}
                    onChange={(e) =>
                      handleChange(mes.field, e.target.value)
                    }
                    className={getFieldClassName(mes.field, "h-8 text-xs")}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* BOTÕES */}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
            <Button type="submit" className="bg-emerald-600">
              {isEditing ? "Atualizar" : "Salvar"}
            </Button>
          </div>

        </form>
      </CardContent>
    </Card>
  );
}
