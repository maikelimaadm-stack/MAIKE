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
import useSetorAreas from "@/hooks/useSetorAreas";
import { toast } from "sonner";

const SISTEMAS = ["Cria", "Recria", "Engorda", "Ciclo Completo"];
const MOTIVOS_ENTRADA = ["Compra", "Ajuste", "Inventário", "Outros"];
const SELECT_EMPTY = "__VAZIO__";
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
"observacoes"];

const REQUIRED_FIELDS = [
"nome",
"quantidade_cabecas",
"data_entrada",
"categoria_manejo_id",
"categoria",
"sexo",
"raca_predominante",
"peso_medio_kg",
"idade_media_meses",
"setor_id",
"area_entrada_id",
"sistema_produtivo"];


export default function FormularioLote({ onSubmit, onCancel, initialData, isEditing }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const [errors, setErrors] = useState({});
// Função rápida para garantir que a data de edição vá para o formato AAAA-MM-DD
  const carregarDataEntrada = (data) => {
    if (!data) return new Date().toLocaleDateString("sv-SE");
    if (data.includes("/")) {
      const [dia, mes, ano] = data.split("/");
      return `${ano}-${mes}-${dia}`;
    }
    return data.split("T")[0]; // Remove horas se vier do banco como DateTime
  };

  const [formData, setFormData] = useState(initialData ? {
    ...initialData,
    data_entrada: carregarDataEntrada(initialData.data_entrada)
  } : {
    nome: "",
    quantidade_cabecas: "",
    categoria: "",
    categoria_manejo_id: "",
    sexo: "",
    peso_medio_kg: "",
    idade_media_meses: "",
    setor_id: "",
    area_entrada_id: "",
    raca_predominante: "",
    sistema_produtivo: "",
    data_entrada: new Date().toLocaleDateString("sv-SE"),
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
    observacoes: ""
  });

  const { setores, areas, getAreasBySetor } = useSetorAreas(empresaSelecionadaId);

  const { data: categoriasManejo = [] } = useQuery({
    queryKey: ["categorias-manejo", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CategoriaManejo.list();
      return all.filter((c) => c.empresa_id === empresaSelecionadaId && c.ativo !== false);
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ["fornecedores", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list();
      return all.filter((f) => f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId
  });

  React.useEffect(() => {
    const areaSelecionada = areas.find((item) => item.id === formData.area_entrada_id);
    if (areaSelecionada && formData.setor_id !== areaSelecionada.setor_id) {
      setFormData((prev) => ({ ...prev, setor_id: areaSelecionada.setor_id || "" }));
    }
  }, [areas, formData.area_entrada_id, formData.setor_id]);

  const areasDoSetor = formData.setor_id ? getAreasBySetor(formData.setor_id) : [];

  const getFieldClassName = (field, baseClass) => {
    return `${baseClass} ${errors[field] ? "border-red-500 bg-red-50 focus-visible:ring-red-500" : ""}`.trim();
  };

  const isEmptyValue = (value) => {
    if (typeof value === "string") return value.trim() === "";
    return value === undefined || value === null || value === "";
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

    REQUIRED_FIELDS.forEach((field) => {
      if (isEmptyValue(formData?.[field])) {
        nextErrors[field] = true;
      }
    });

    if (formData.motivo_entrada === "Compra") {
      [
      "fornecedor_id",
      "cidade_origem",
      "estado_origem",
      "nota_fiscal",
      "chave_nfe",
      "numero_gta",
      "valor_total_compra",
      "valor_por_cabeca",
      "valor_frete"].
      forEach((field) => {
        if (isEmptyValue(formData?.[field])) {
          nextErrors[field] = true;
        }
      });
    }

    if (formData.motivo_entrada === "Ajuste" && isEmptyValue(formData?.motivo_ajuste)) {
      nextErrors.motivo_ajuste = true;
    }

    if (formData.motivo_entrada === "Outros" && isEmptyValue(formData?.motivo_outros)) {
      nextErrors.motivo_outros = true;
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length === 0) return true;

    toast.error("PREENCHA OS CAMPOS OBRIGATÓRIOS.");
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
  // Alteração aqui: adicionamos o T12:00:00
  data_entrada: formData.data_entrada ? `${formData.data_entrada}T12:00:00` : null, 
  
  nome: formData.nome.toUpperCase(),
  setor_nome: area?.setor_nome || "",
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
    categoria_manejo_entrada_nome: categoriaManejo?.nome || ""
  } : {})
};

    onSubmit(dataToSave);
  };

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
          <CardTitle className="text-sm font-semibold text-slate-700">
            {isEditing ? "Editar Lote" : "Cadastrar Novo Lote"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-1">
          <form onSubmit={handleSubmit} className="space-y-1">
            <div className="space-y-1">
              <Label className="text-xs">Motivo da Entrada</Label>
              <div data-field="motivo_entrada">
                <Select value={formData.motivo_entrada || SELECT_EMPTY} onValueChange={(value) => handleChange("motivo_entrada", value === SELECT_EMPTY ? "" : value)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="SELECIONE" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                    {MOTIVOS_ENTRADA.map((motivo) =>
                    <SelectItem key={motivo} value={motivo} className="text-xs">{motivo.toUpperCase()}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1 pt-1 border-t">
              <div className="space-y-1">
                <Label className="text-xs">Nome do Lote *</Label>
                <Input
                  data-field="nome"
                  value={formData.nome || ""}
                  onChange={(e) => handleChange("nome", e.target.value)}
                  placeholder="NOME DO LOTE" className="flex w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm h-7 text-xs uppercase"

                  style={{ textTransform: "uppercase" }} />
                
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Quantidade de Cabeças *</Label>
                <Input
                  data-field="quantidade_cabecas"
                  type="number"
                  value={formData.quantidade_cabecas || ""}
                  onChange={(e) => handleChange("quantidade_cabecas", e.target.value)}
                  placeholder="0" className="flex w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm h-7 text-xs" />
                
                
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Data de Entrada *</Label>
                <Input
                  data-field="data_entrada"
                  type="date"
                  value={formData.data_entrada || ""}
                  onChange={(e) => handleChange("data_entrada", e.target.value)} className="flex w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm h-7 text-xs" />
                
                
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <div className="space-y-1">
                <Label className="text-xs">Categoria de Manejo *</Label>
                <div data-field="categoria_manejo_id">
                  <Select value={formData.categoria_manejo_id || SELECT_EMPTY} onValueChange={(value) => handleChange("categoria_manejo_id", value === SELECT_EMPTY ? "" : value)}>
                    <SelectTrigger className="flex w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 h-7 text-xs">
                      <SelectValue placeholder="SELECIONE" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                      {categoriasManejo.map((item) =>
                      <SelectItem key={item.id} value={item.id} className="text-xs">
                          {(item.nome || "").toUpperCase()} {item.categoria_oficial ? `(${item.categoria_oficial})` : ""}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              


              

              <div className="space-y-1">
                <Label className="text-xs">Sexo *</Label>
                <div data-field="sexo">
                  <Select value={formData.sexo || SELECT_EMPTY} onValueChange={(value) => handleChange("sexo", value === SELECT_EMPTY ? "" : value)}>
                    <SelectTrigger className="flex w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 h-7 text-xs">
                      <SelectValue placeholder="SELECIONE" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                      <SelectItem value="Macho" className="text-xs">MACHO</SelectItem>
                      <SelectItem value="Fêmea" className="text-xs">FÊMEA</SelectItem>
                      <SelectItem value="Misto" className="text-xs">MISTO</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <div className="space-y-1">
                <Label className="text-xs">Raça Predominante *</Label>
                <Input
                  data-field="raca_predominante"
                  value={formData.raca_predominante || ""}
                  onChange={(e) => handleChange("raca_predominante", e.target.value)}
                  placeholder="RAÇA" className="flex w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm h-7 text-xs uppercase"

                  style={{ textTransform: "uppercase" }} />
                
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Peso Médio (kg) *</Label>
                <Input
                  data-field="peso_medio_kg"
                  type="number"
                  step="0.1"
                  value={formData.peso_medio_kg || ""}
                  onChange={(e) => handleChange("peso_medio_kg", e.target.value)}
                  placeholder="0.0" className="flex w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm h-7 text-xs" />
                
                
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Idade Média (meses) *</Label>
                <Input
                  data-field="idade_media_meses"
                  type="number"
                  value={formData.idade_media_meses || ""}
                  onChange={(e) => handleChange("idade_media_meses", e.target.value)}
                  placeholder="0" className="flex w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm h-7 text-xs" />
                
                
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <div className="space-y-1">
                <Label className="text-xs">Setor *</Label>
                <div data-field="setor_id">
                  <Select value={formData.setor_id || SELECT_EMPTY} onValueChange={(value) => {const novoSetor = value === SELECT_EMPTY ? "" : value;setFormData((prev) => ({ ...prev, setor_id: novoSetor, area_entrada_id: "" }));setErrors((prev) => ({ ...prev, setor_id: false, area_entrada_id: false }));}}>
                    <SelectTrigger className="flex w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 h-7 text-xs">
                      <SelectValue placeholder="SELECIONE" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                      {setores.map((item) =>
                      <SelectItem key={item.id} value={item.id} className="text-xs">
                          {(item.nome || "").toUpperCase()}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Área de Entrada *</Label>
                <div data-field="area_entrada_id">
                  <Select value={formData.area_entrada_id || SELECT_EMPTY} onValueChange={(value) => handleChange("area_entrada_id", value === SELECT_EMPTY ? "" : value)} disabled={!formData.setor_id}>
                    <SelectTrigger className="flex w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 h-7 text-xs">
                      <SelectValue placeholder={formData.setor_id ? "SELECIONE" : "SELECIONE O SETOR PRIMEIRO"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                      {areasDoSetor.map((item) =>
                      <SelectItem key={item.id} value={item.id} className="text-xs">
                          {(item.nome || "").toUpperCase()}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Sistema Produtivo *</Label>
                <div data-field="sistema_produtivo">
                  <Select value={formData.sistema_produtivo || SELECT_EMPTY} onValueChange={(value) => handleChange("sistema_produtivo", value === SELECT_EMPTY ? "" : value)}>
                    <SelectTrigger className="flex w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 h-7 text-xs">
                      <SelectValue placeholder="SELECIONE" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                      {SISTEMAS.map((item) =>
                      <SelectItem key={item} value={item} className="text-xs">
                          {item.toUpperCase()}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {formData.motivo_entrada === "Compra" &&
            <div className="border rounded-lg p-1 space-y-1 bg-slate-50/50">
                <span className="font-semibold text-sm text-slate-700">Dados da Compra</span>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                  <div className="space-y-1">
                    <Label className="text-xs">Fornecedor *</Label>
                    <div data-field="fornecedor_id">
                      <Select value={formData.fornecedor_id || SELECT_EMPTY} onValueChange={(value) => handleChange("fornecedor_id", value === SELECT_EMPTY ? "" : value)}>
                        <SelectTrigger className="flex w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 h-7 text-xs">
                          <SelectValue placeholder="SELECIONE" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                          {fornecedores.map((item) =>
                        <SelectItem key={item.id} value={item.id} className="text-xs">
                              {(item.nome || "").toUpperCase()}
                            </SelectItem>
                        )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Cidade Origem *</Label>
                    <Input data-field="cidade_origem" value={formData.cidade_origem || ""} onChange={(e) => handleChange("cidade_origem", e.target.value)} placeholder="CIDADE" className={getFieldClassName("cidade_origem", "h-8 text-xs uppercase")} style={{ textTransform: "uppercase" }} />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Estado Origem *</Label>
                    <Input data-field="estado_origem" value={formData.estado_origem || ""} onChange={(e) => handleChange("estado_origem", e.target.value)} placeholder="UF" className={getFieldClassName("estado_origem", "h-8 text-xs uppercase")} style={{ textTransform: "uppercase" }} maxLength={2} />
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                  <div className="space-y-1">
                    <Label className="text-xs">Nota Fiscal *</Label>
                    <Input data-field="nota_fiscal" value={formData.nota_fiscal || ""} onChange={(e) => handleChange("nota_fiscal", e.target.value)} placeholder="NÚMERO DA NF" className={getFieldClassName("nota_fiscal", "h-8 text-xs uppercase")} style={{ textTransform: "uppercase" }} />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Chave NF-e *</Label>
                    <Input data-field="chave_nfe" value={formData.chave_nfe || ""} onChange={(e) => handleChange("chave_nfe", e.target.value)} placeholder="44 DÍGITOS" className={getFieldClassName("chave_nfe", "h-8 text-xs uppercase")} style={{ textTransform: "uppercase" }} />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Nº GTA *</Label>
                    <Input data-field="numero_gta" value={formData.numero_gta || ""} onChange={(e) => handleChange("numero_gta", e.target.value)} placeholder="GTA" className={getFieldClassName("numero_gta", "h-8 text-xs uppercase")} style={{ textTransform: "uppercase" }} />
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                  <div className="space-y-1">
                    <Label className="text-xs">Valor Total (R$) *</Label>
                    <Input data-field="valor_total_compra" type="number" step="0.01" value={formData.valor_total_compra || ""} onChange={(e) => handleChange("valor_total_compra", e.target.value)} placeholder="0.00" className={getFieldClassName("valor_total_compra", "h-8 text-xs")} />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Valor por Cabeça (R$) *</Label>
                    <Input data-field="valor_por_cabeca" type="number" step="0.01" value={formData.valor_por_cabeca || ""} readOnly placeholder="Calculado" className={getFieldClassName("valor_por_cabeca", "h-8 text-xs bg-slate-50")} />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Valor Frete (R$) *</Label>
                    <Input data-field="valor_frete" type="number" step="0.01" value={formData.valor_frete || ""} onChange={(e) => handleChange("valor_frete", e.target.value)} placeholder="0.00" className={getFieldClassName("valor_frete", "h-8 text-xs")} />
                  </div>
                </div>
              </div>
            }

            {formData.motivo_entrada === "Ajuste" &&
            <div className="space-y-1 pt-1 border-t">
                <Label className="text-xs">Motivo do Ajuste *</Label>
                <Textarea
                data-field="motivo_ajuste"
                value={formData.motivo_ajuste || ""}
                onChange={(e) => handleChange("motivo_ajuste", e.target.value)}
                placeholder="DESCREVA O MOTIVO DO AJUSTE"
                className={getFieldClassName("motivo_ajuste", "text-xs uppercase")}
                style={{ textTransform: "uppercase" }}
                rows={2} />
              
              </div>
            }

            {formData.motivo_entrada === "Outros" &&
            <div className="space-y-1 pt-1 border-t">
                <Label className="text-xs">Motivo *</Label>
                <Textarea
                data-field="motivo_outros"
                value={formData.motivo_outros || ""}
                onChange={(e) => handleChange("motivo_outros", e.target.value)}
                placeholder="DESCREVA O MOTIVO"
                className={getFieldClassName("motivo_outros", "text-xs uppercase")}
                style={{ textTransform: "uppercase" }}
                rows={2} />
              
              </div>
            }

            {formData.motivo_entrada === "Inventário" &&
            <div className="border rounded-lg p-3 bg-slate-50 text-xs text-slate-600">
                Registro de inventário para contagem e conferência do rebanho.
              </div>
            }

            <div className="space-y-1 pt-1">
              <Label className="text-xs">Observações</Label>
              <Textarea
                value={formData.observacoes || ""}
                onChange={(e) => handleChange("observacoes", e.target.value)}
                placeholder="OBSERVAÇÕES GERAIS..."
                className="text-xs uppercase"
                style={{ textTransform: "uppercase" }}
                rows={2} />
              
            </div>

            <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground rounded-md px-3 h-7 text-xs">
                Cancelar
              </Button>
              <Button type="submit" size="sm" className="bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-7 hover:bg-emerald-500">
                {isEditing ? "Atualizar" : "Salvar"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>);

}