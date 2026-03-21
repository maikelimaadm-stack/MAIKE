import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

const TIPOS_SETOR = ["Próprio", "Arrendado", "Parceria", "Terceiros"];
const ESTADOS_BR = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const SELECT_EMPTY = "__VAZIO__";
const UPPERCASE_FIELDS = ["nome", "sigla", "responsavel", "endereco", "cidade", "observacoes"];
const REQUIRED_FIELDS = ["nome", "sigla", "endereco", "cidade", "estado"];

export default function FormularioSetor({ initialData, isEditing, onSubmit, onCancel }) {
  const [formData, setFormData] = useState(initialData);
  const [invalidFields, setInvalidFields] = useState([]);

  const handleChange = (field, value) => {
    const nextValue = UPPERCASE_FIELDS.includes(field) && typeof value === "string"
      ? value.toUpperCase()
      : value;
    setFormData((prev) => ({ ...prev, [field]: nextValue }));
    setInvalidFields((prev) => prev.filter((item) => item !== field));
  };

  const isEmptyValue = (value) => {
    if (typeof value === "string") return value.trim() === "";
    return value === undefined || value === null || value === "";
  };

  const getFieldClassName = (field, baseClass = "") => {
    return `${baseClass} ${invalidFields.includes(field) ? "border-red-500 bg-red-50 focus-visible:ring-red-500" : ""}`.trim();
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
          {isEditing ? "Editar Setor / Fazenda" : "Novo Setor / Fazenda"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-1">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
            <div className="space-y-1 lg:col-span-2">
              <Label className="text-xs">Nome do Setor/Fazenda *</Label>
              <Input
                data-field="nome"
                value={formData.nome}
                onChange={(e) => handleChange("nome", e.target.value)}
                placeholder="NOME DO SETOR / FAZENDA"
                className={getFieldClassName("nome", "h-8 text-xs uppercase")}
                style={{ textTransform: "uppercase" }}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Sigla *</Label>
              <Input
                data-field="sigla"
                value={formData.sigla}
                onChange={(e) => handleChange("sigla", e.target.value)}
                placeholder="SIGLA"
                className={getFieldClassName("sigla", "h-8 text-xs uppercase")}
                style={{ textTransform: "uppercase" }}
                maxLength={10}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
            <div className="space-y-1">
              <Label className="text-xs">Tipo *</Label>
              <Select value={formData.tipo} onValueChange={(value) => handleChange("tipo", value)}>
                <SelectTrigger className={getFieldClassName("tipo", "h-8 text-xs")}>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_SETOR.map((tipo) => (
                    <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Responsável</Label>
              <Input
                value={formData.responsavel}
                onChange={(e) => handleChange("responsavel", e.target.value)}
                placeholder="RESPONSÁVEL"
                className="h-8 text-xs uppercase"
                style={{ textTransform: "uppercase" }}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Telefone</Label>
              <Input
                value={formData.telefone}
                onChange={(e) => handleChange("telefone", e.target.value)}
                placeholder="(00) 00000-0000"
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
            <div className="space-y-1">
              <Label className="text-xs">Área Total (ha)</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.area_total}
                onChange={(e) => handleChange("area_total", e.target.value)}
                placeholder="0,00"
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Capacidade (animais)</Label>
              <Input
                type="number"
                value={formData.capacidade_animais}
                onChange={(e) => handleChange("capacidade_animais", e.target.value)}
                placeholder="0"
                className="h-8 text-xs"
              />
            </div>

            <div className="flex items-center gap-3 pt-6">
              <Switch checked={formData.ativo} onCheckedChange={(value) => handleChange("ativo", value)} />
              <Label className="text-xs">Setor Ativo</Label>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
            <div className="space-y-1 lg:col-span-2">
              <Label className="text-xs">Endereço *</Label>
              <Input
                data-field="endereco"
                value={formData.endereco}
                onChange={(e) => handleChange("endereco", e.target.value)}
                placeholder="ENDEREÇO COMPLETO"
                className={getFieldClassName("endereco", "h-8 text-xs uppercase")}
                style={{ textTransform: "uppercase" }}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Cidade *</Label>
              <Input
                data-field="cidade"
                value={formData.cidade}
                onChange={(e) => handleChange("cidade", e.target.value)}
                placeholder="CIDADE"
                className={getFieldClassName("cidade", "h-8 text-xs uppercase")}
                style={{ textTransform: "uppercase" }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
            <div className="space-y-1">
              <Label className="text-xs">Estado *</Label>
              <div data-field="estado">
                <Select value={formData.estado || SELECT_EMPTY} onValueChange={(value) => handleChange("estado", value === SELECT_EMPTY ? "" : value)}>
                  <SelectTrigger className={getFieldClassName("estado", "h-8 text-xs")}>
                    <SelectValue placeholder="SELECIONE" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                    {ESTADOS_BR.map((uf) => (
                      <SelectItem key={uf} value={uf} className="text-xs">{uf}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-1 pt-1">
            <Label className="text-xs">Observações</Label>
            <Textarea
              value={formData.observacoes}
              onChange={(e) => handleChange("observacoes", e.target.value)}
              placeholder="OBSERVAÇÕES GERAIS..."
              className="text-xs uppercase"
              style={{ textTransform: "uppercase" }}
              rows={2}
            />
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