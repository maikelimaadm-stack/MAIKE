import React, { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

const SISTEMAS = ["Cria", "Recria", "Engorda", "Ciclo Completo"];
const MOTIVOS_ENTRADA = ["Compra", "Ajuste", "Inventário", "Outros"];
const UPPERCASE_FIELDS = [
  "nome",
  "raca_predominante",
  "cidade_origem",
  "estado_origem",
  "nota_fiscal",
  "chave_nfe",
  "numero_gta",
  "motivo_ajuste",
  "motivo_outros",
  "observacoes",
];

export default function FormularioLote({ onSubmit, onCancel, initialData, isEditing }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const [errors, setErrors] = useState({});
  const [formData, setFormData] = useState(initialData || {
    nome: "",
    quantidade_cabecas: "",
    categoria: "",
    categoria_manejo_id: "",
    sexo: "",
    peso_medio_kg: "",
    idade_media_meses: "",
    area_entrada_id: "",
    raca_predominante: "",
    sistema_produtivo: "",
    data_entrada: new Date().toISOString().split("T")[0],
    motivo_entrada: "",
    fornecedor_id: "",
    fornecedor_nome: "",
    nota_fiscal: "",
    chave_nfe: "",
    numero_gta: "",
    cidade_origem: "",
    estado_origem: "",
    valor_total_compra: "",
    valor_por_cabeca: "",
    valor_frete: "",
    motivo_ajuste: "",
    motivo_outros: "",
    observacoes: "",
  });

  const { data: areas = [] } = useQuery({
    queryKey: ["areas", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter((a) => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: categoriasManejo = [] } = useQuery({
    queryKey: ["categorias-manejo", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CategoriaManejo.list();
      return all.filter((c) => c.empresa_id === empresaSelecionadaId && c.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ["fornecedores", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list();
      return all.filter((f) => f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const getFieldClassName = (field, baseClass) => {
    return `${baseClass} ${errors[field] ? "border-red-500 ring-1 ring-red-500" : ""}`.trim();
  };

  const handleChange = (field, value) => {
    const normalizedValue = UPPERCASE_FIELDS.includes(field) && typeof value === "string" ? value.toUpperCase() : value;
    const newData = { ...formData, [field]: normalizedValue };

    if (field === "categoria_manejo_id") {
      const categoria = categoriasManejo.find((item) => item.id === value);
      if (categoria) {
        newData.categoria = categoria.categoria_oficial || "";
        if (categoria.sexo) newData.sexo = categoria.sexo;
        if (categoria.raca) newData.raca_predominante = String(categoria.raca).toUpperCase();
      }
    }

    if (field === "fornecedor_id") {
      const fornecedor = fornecedores.find((item) => item.id === value);
      if (fornecedor) {
        newData.fornecedor_nome = fornecedor.nome || "";
        if (fornecedor.cidade) newData.cidade_origem = String(fornecedor.cidade).toUpperCase();
        if (fornecedor.estado) newData.estado_origem = String(fornecedor.estado).toUpperCase();
      }
    }

    if (field === "quantidade_cabecas" || field === "valor_total_compra") {
      const quantidade = parseFloat(field === "quantidade_cabecas" ? value : newData.quantidade_cabecas) || 0;
      const valorTotal = parseFloat(field === "valor_total_compra" ? value : newData.valor_total_compra) || 0;
      if (quantidade > 0 && valorTotal > 0) {
        newData.valor_por_cabeca = (valorTotal / quantidade).toFixed(2);
      }
    }

    setErrors((prev) => ({ ...prev, [field]: false }));
    setFormData(newData);
  };

  const validateForm = () => {
    const nextErrors = {};
    const missing = [];

    if (!formData.motivo_entrada) {
      nextErrors.motivo_entrada = true;
      missing.push("Motivo da Entrada");
    }
    if (!formData.nome?.trim()) {
      nextErrors.nome = true;
      missing.push("Nome do Lote");
    }
    if (!formData.quantidade_cabecas) {
      nextErrors.quantidade_cabecas = true;
      missing.push("Quantidade de Cabeças");
    }
    if (!formData.data_entrada) {
      nextErrors.data_entrada = true;
      missing.push("Data de Entrada");
    }
    if (formData.motivo_entrada === "Ajuste" && !formData.motivo_ajuste?.trim()) {
      nextErrors.motivo_ajuste = true;
      missing.push("Motivo do Ajuste");
    }
    if (formData.motivo_entrada === "Outros" && !formData.motivo_outros?.trim()) {
      nextErrors.motivo_outros = true;
      missing.push("Motivo");
    }

    setErrors(nextErrors);

    if (!missing.length) return true;

    toast.error(`Preencha os campos obrigatórios: ${missing.join(", ")}.`);
    const firstField = Object.keys(nextErrors)[0];
    const element = document.querySelector(`[data-field="${firstField}"]`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    element?.focus?.();
    return false;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    const area = areas.find((item) => item.id === formData.area_entrada_id);
    const categoriaManejo = categoriasManejo.find((item) => item.id === formData.categoria_manejo_id);
    const quantidade = parseInt(formData.quantidade_cabecas) || 0;
    const peso = parseFloat(formData.peso_medio_kg) || 0;

    const dataToSave = {
      ...formData,
      nome: formData.nome.toUpperCase(),
      area_entrada_nome: area?.nome || "",
      area_atual_id: formData.area_entrada_id,
      area_atual_nome: area?.nome || "",
      categoria_manejo_nome: categoriaManejo?.nome || "",
      origem: formData.motivo_entrada?.toUpperCase() || "",
      observacoes: formData.observacoes?.toUpperCase() || "",
      quantidade_cabecas: quantidade,
      peso_medio_kg: peso,
      idade_media_meses: parseInt(formData.idade_media_meses) || 0,
      valor_total_compra: parseFloat(formData.valor_total_compra) || 0,
      valor_por_cabeca: parseFloat(formData.valor_por_cabeca) || 0,
      valor_frete: parseFloat(formData.valor_frete) || 0,
      ...(!isEditing ? {
        quantidade_entrada: quantidade,
        peso_entrada_kg: peso,
        categoria_entrada: formData.categoria || "",
        categoria_manejo_entrada_id: formData.categoria_manejo_id || "",
        categoria_manejo_entrada_nome: categoriaManejo?.nome || "",
      } : {}),
    };

    onSubmit(dataToSave);
  };

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="bg-slate-50 border-b py-3 px-4">
          <CardTitle className="text-sm font-semibold text-slate-700">
            {isEditing ? "Editar Lote" : "Cadastrar Novo Lote"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-1">
            <div className="space-y-1">
              <Label className="text-xs">Motivo da Entrada *</Label>
              <div
                data-field="motivo_entrada"
                tabIndex={-1}
                className={`grid grid-cols-2 lg:grid-cols-4 gap-1 ${errors.motivo_entrada ? "rounded border border-red-500 p-1" : ""}`}
              >
                {MOTIVOS_ENTRADA.map((motivo) => (
                  <Button
                    key={motivo}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleChange("motivo_entrada", motivo)}
                    className={`h-8 text-xs justify-start ${formData.motivo_entrada === motivo ? "border-emerald-600 text-emerald-700 bg-emerald-50 hover:bg-emerald-50" : ""}`}
                  >
                    {motivo}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1 pt-1 border-t">
              <div className="space-y-1">
                <Label className="text-xs">Nome do Lote *</Label>
                <Input
                  data-field="nome"
                  value={formData.nome || ""}
                  onChange={(e) => handleChange("nome", e.target.value)}
                  placeholder="NOME DO LOTE"
                  className={getFieldClassName("nome", "h-8 text-xs uppercase")}
                  style={{ textTransform: "uppercase" }}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Quantidade de Cabeças *</Label>
                <Input
                  data-field="quantidade_cabecas"
                  type="number"
                  value={formData.quantidade_cabecas || ""}
                  onChange={(e) => handleChange("quantidade_cabecas", e.target.value)}
                  placeholder="0"
                  className={getFieldClassName("quantidade_cabecas", "h-8 text-xs")}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Data de Entrada *</Label>
                <Input
                  data-field="data_entrada"
                  type="date"
                  value={formData.data_entrada || ""}
                  onChange={(e) => handleChange("data_entrada", e.target.value)}
                  className={getFieldClassName("data_entrada", "h-8 text-xs")}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <div className="space-y-1">
                <Label className="text-xs">Categoria de Manejo</Label>
                <Select value={formData.categoria_manejo_id || ""} onValueChange={(value) => handleChange("categoria_manejo_id", value)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoriasManejo.map((item) => (
                      <SelectItem key={item.id} value={item.id} className="text-xs">
                        {item.nome} {item.categoria_oficial ? `(${item.categoria_oficial})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Categoria</Label>
                <Input value={formData.categoria || ""} readOnly className="h-8 text-xs bg-slate-50 uppercase" style={{ textTransform: "uppercase" }} />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Sexo</Label>
                <Select value={formData.sexo || ""} onValueChange={(value) => handleChange("sexo", value)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Macho" className="text-xs">Macho</SelectItem>
                    <SelectItem value="Fêmea" className="text-xs">Fêmea</SelectItem>
                    <SelectItem value="Misto" className="text-xs">Misto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <div className="space-y-1">
                <Label className="text-xs">Raça Predominante</Label>
                <Input
                  value={formData.raca_predominante || ""}
                  onChange={(e) => handleChange("raca_predominante", e.target.value)}
                  placeholder="RAÇA"
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: "uppercase" }}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Peso Médio (kg)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={formData.peso_medio_kg || ""}
                  onChange={(e) => handleChange("peso_medio_kg", e.target.value)}
                  placeholder="0.0"
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Idade Média (meses)</Label>
                <Input
                  type="number"
                  value={formData.idade_media_meses || ""}
                  onChange={(e) => handleChange("idade_media_meses", e.target.value)}
                  placeholder="0"
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <div className="space-y-1">
                <Label className="text-xs">Área de Entrada</Label>
                <Select value={formData.area_entrada_id || ""} onValueChange={(value) => handleChange("area_entrada_id", value)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {areas.map((item) => (
                      <SelectItem key={item.id} value={item.id} className="text-xs">
                        {item.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Sistema Produtivo</Label>
                <Select value={formData.sistema_produtivo || ""} onValueChange={(value) => handleChange("sistema_produtivo", value)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {SISTEMAS.map((item) => (
                      <SelectItem key={item} value={item} className="text-xs">
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formData.motivo_entrada === "Compra" && (
              <div className="border rounded-lg p-3 space-y-1 bg-slate-50/50">
                <span className="font-semibold text-sm text-slate-700">Dados da Compra</span>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                  <div className="space-y-1">
                    <Label className="text-xs">Fornecedor</Label>
                    <Select value={formData.fornecedor_id || ""} onValueChange={(value) => handleChange("fornecedor_id", value)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {fornecedores.map((item) => (
                          <SelectItem key={item.id} value={item.id} className="text-xs">
                            {item.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Cidade Origem</Label>
                    <Input value={formData.cidade_origem || ""} onChange={(e) => handleChange("cidade_origem", e.target.value)} placeholder="CIDADE" className="h-8 text-xs uppercase" style={{ textTransform: "uppercase" }} />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Estado Origem</Label>
                    <Input value={formData.estado_origem || ""} onChange={(e) => handleChange("estado_origem", e.target.value)} placeholder="UF" className="h-8 text-xs uppercase" style={{ textTransform: "uppercase" }} maxLength={2} />
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                  <div className="space-y-1">
                    <Label className="text-xs">Nota Fiscal</Label>
                    <Input value={formData.nota_fiscal || ""} onChange={(e) => handleChange("nota_fiscal", e.target.value)} placeholder="NÚMERO DA NF" className="h-8 text-xs uppercase" style={{ textTransform: "uppercase" }} />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Chave NF-e</Label>
                    <Input value={formData.chave_nfe || ""} onChange={(e) => handleChange("chave_nfe", e.target.value)} placeholder="44 DÍGITOS" className="h-8 text-xs uppercase" style={{ textTransform: "uppercase" }} />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Nº GTA</Label>
                    <Input value={formData.numero_gta || ""} onChange={(e) => handleChange("numero_gta", e.target.value)} placeholder="GTA" className="h-8 text-xs uppercase" style={{ textTransform: "uppercase" }} />
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                  <div className="space-y-1">
                    <Label className="text-xs">Valor Total (R$)</Label>
                    <Input type="number" step="0.01" value={formData.valor_total_compra || ""} onChange={(e) => handleChange("valor_total_compra", e.target.value)} placeholder="0.00" className="h-8 text-xs" />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Valor por Cabeça (R$)</Label>
                    <Input type="number" step="0.01" value={formData.valor_por_cabeca || ""} readOnly placeholder="Calculado" className="h-8 text-xs bg-slate-50" />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Valor Frete (R$)</Label>
                    <Input type="number" step="0.01" value={formData.valor_frete || ""} onChange={(e) => handleChange("valor_frete", e.target.value)} placeholder="0.00" className="h-8 text-xs" />
                  </div>
                </div>
              </div>
            )}

            {formData.motivo_entrada === "Ajuste" && (
              <div className="space-y-1 pt-1 border-t">
                <Label className="text-xs">Motivo do Ajuste *</Label>
                <Textarea
                  data-field="motivo_ajuste"
                  value={formData.motivo_ajuste || ""}
                  onChange={(e) => handleChange("motivo_ajuste", e.target.value)}
                  placeholder="DESCREVA O MOTIVO DO AJUSTE"
                  className={getFieldClassName("motivo_ajuste", "text-xs uppercase")}
                  style={{ textTransform: "uppercase" }}
                  rows={2}
                />
              </div>
            )}

            {formData.motivo_entrada === "Outros" && (
              <div className="space-y-1 pt-1 border-t">
                <Label className="text-xs">Motivo *</Label>
                <Textarea
                  data-field="motivo_outros"
                  value={formData.motivo_outros || ""}
                  onChange={(e) => handleChange("motivo_outros", e.target.value)}
                  placeholder="DESCREVA O MOTIVO"
                  className={getFieldClassName("motivo_outros", "text-xs uppercase")}
                  style={{ textTransform: "uppercase" }}
                  rows={2}
                />
              </div>
            )}

            {formData.motivo_entrada === "Inventário" && (
              <div className="border rounded-lg p-3 bg-slate-50 text-xs text-slate-600">
                Registro de inventário para contagem e conferência do rebanho.
              </div>
            )}

            <div className="space-y-1 pt-1">
              <Label className="text-xs">Observações</Label>
              <Textarea
                value={formData.observacoes || ""}
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
    </motion.div>
  );
}