import React, { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import useSetorAreas from "@/hooks/useSetorAreas";
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
          <form onSubmit={handleSubmit} className="space-y-0.5">
            <FL label="Motivo da Entrada" dataField="motivo_entrada">
              <Select value={formData.motivo_entrada || SELECT_EMPTY} onValueChange={(value) => handleChange("motivo_entrada", value === SELECT_EMPTY ? "" : value)}>
                <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                  {MOTIVOS_ENTRADA.map((m) => <SelectItem key={m} value={m} className="text-xs">{m.toUpperCase()}</SelectItem>)}
                </SelectContent>
              </Select>
            </FL>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1 pt-0.5 border-t">
              <FL label="Nome do Lote" required error={errors.nome} dataField="nome">
                <Input value={formData.nome || ""} onChange={(e) => handleChange("nome", e.target.value)} placeholder="NOME DO LOTE" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} />
              </FL>
              <FL label="Qtd. Cabeças" required error={errors.quantidade_cabecas} dataField="quantidade_cabecas">
                <Input type="number" value={formData.quantidade_cabecas || ""} onChange={(e) => handleChange("quantidade_cabecas", e.target.value)} placeholder="0" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
              </FL>
              <FL label="Data de Entrada" required error={errors.data_entrada} dataField="data_entrada">
                <Input type="date" value={formData.data_entrada || ""} onChange={(e) => handleChange("data_entrada", e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
              </FL>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
              <FL label="Categoria de Manejo" required error={errors.categoria_manejo_id} dataField="categoria_manejo_id">
                <Select value={formData.categoria_manejo_id || SELECT_EMPTY} onValueChange={(value) => handleChange("categoria_manejo_id", value === SELECT_EMPTY ? "" : value)}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                    {categoriasManejo.map((item) => <SelectItem key={item.id} value={item.id} className="text-xs">{(item.nome || "").toUpperCase()} {item.categoria_oficial ? `(${item.categoria_oficial})` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FL>
              <FL label="Sexo" required error={errors.sexo} dataField="sexo">
                <Select value={formData.sexo || SELECT_EMPTY} onValueChange={(value) => handleChange("sexo", value === SELECT_EMPTY ? "" : value)}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                    <SelectItem value="Macho" className="text-xs">MACHO</SelectItem>
                    <SelectItem value="Fêmea" className="text-xs">FÊMEA</SelectItem>
                    <SelectItem value="Misto" className="text-xs">MISTO</SelectItem>
                  </SelectContent>
                </Select>
              </FL>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <FL label="Raça Predominante" required error={errors.raca_predominante} dataField="raca_predominante">
                <Input value={formData.raca_predominante || ""} onChange={(e) => handleChange("raca_predominante", e.target.value)} placeholder="RAÇA" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} />
              </FL>
              <FL label="Peso Médio (kg)" required error={errors.peso_medio_kg} dataField="peso_medio_kg">
                <Input type="number" step="0.1" value={formData.peso_medio_kg || ""} onChange={(e) => handleChange("peso_medio_kg", e.target.value)} placeholder="0.0" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
              </FL>
              <FL label="Idade Média (meses)" required error={errors.idade_media_meses} dataField="idade_media_meses">
                <Input type="number" value={formData.idade_media_meses || ""} onChange={(e) => handleChange("idade_media_meses", e.target.value)} placeholder="0" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
              </FL>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <FL label="Setor" required error={errors.setor_id} dataField="setor_id">
                <Select value={formData.setor_id || SELECT_EMPTY} onValueChange={(value) => {const novoSetor = value === SELECT_EMPTY ? "" : value;setFormData((prev) => ({ ...prev, setor_id: novoSetor, area_entrada_id: "" }));setErrors((prev) => ({ ...prev, setor_id: false, area_entrada_id: false }));}}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                    {setores.map((item) => <SelectItem key={item.id} value={item.id} className="text-xs">{(item.nome || "").toUpperCase()}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FL>
              <FL label="Área de Entrada" required error={errors.area_entrada_id} dataField="area_entrada_id">
                <Select value={formData.area_entrada_id || SELECT_EMPTY} onValueChange={(value) => handleChange("area_entrada_id", value === SELECT_EMPTY ? "" : value)} disabled={!formData.setor_id}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder={formData.setor_id ? "SELECIONE" : "SELECIONE O SETOR"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                    {areasDoSetor.map((item) => <SelectItem key={item.id} value={item.id} className="text-xs">{(item.nome || "").toUpperCase()}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FL>
              <FL label="Sistema Produtivo" required error={errors.sistema_produtivo} dataField="sistema_produtivo">
                <Select value={formData.sistema_produtivo || SELECT_EMPTY} onValueChange={(value) => handleChange("sistema_produtivo", value === SELECT_EMPTY ? "" : value)}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                    {SISTEMAS.map((item) => <SelectItem key={item} value={item} className="text-xs">{item.toUpperCase()}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FL>
            </div>

            {formData.motivo_entrada === "Compra" &&
            <div className="border rounded-lg p-1 space-y-0.5 bg-slate-50/50">
                <span className="font-semibold text-xs text-slate-700">Dados da Compra</span>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                  <FL label="Fornecedor" required error={errors.fornecedor_id} dataField="fornecedor_id">
                    <Select value={formData.fornecedor_id || SELECT_EMPTY} onValueChange={(value) => handleChange("fornecedor_id", value === SELECT_EMPTY ? "" : value)}>
                      <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                        {fornecedores.map((item) => <SelectItem key={item.id} value={item.id} className="text-xs">{(item.nome || "").toUpperCase()}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FL>
                  <FL label="Cidade Origem" required error={errors.cidade_origem} dataField="cidade_origem">
                    <Input value={formData.cidade_origem || ""} onChange={(e) => handleChange("cidade_origem", e.target.value)} placeholder="CIDADE" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} />
                  </FL>
                  <FL label="Estado Origem" required error={errors.estado_origem} dataField="estado_origem">
                    <Input value={formData.estado_origem || ""} onChange={(e) => handleChange("estado_origem", e.target.value)} placeholder="UF" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} maxLength={2} />
                  </FL>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                  <FL label="Nota Fiscal" required error={errors.nota_fiscal} dataField="nota_fiscal">
                    <Input value={formData.nota_fiscal || ""} onChange={(e) => handleChange("nota_fiscal", e.target.value)} placeholder="Nº DA NF" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} />
                  </FL>
                  <FL label="Chave NF-e" required error={errors.chave_nfe} dataField="chave_nfe">
                    <Input value={formData.chave_nfe || ""} onChange={(e) => handleChange("chave_nfe", e.target.value)} placeholder="44 DÍGITOS" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} />
                  </FL>
                  <FL label="Nº GTA" required error={errors.numero_gta} dataField="numero_gta">
                    <Input value={formData.numero_gta || ""} onChange={(e) => handleChange("numero_gta", e.target.value)} placeholder="GTA" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} />
                  </FL>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                  <FL label="Valor Total (R$)" required error={errors.valor_total_compra} dataField="valor_total_compra">
                    <Input type="number" step="0.01" value={formData.valor_total_compra || ""} onChange={(e) => handleChange("valor_total_compra", e.target.value)} placeholder="0.00" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
                  </FL>
                  <FL label="Valor p/ Cabeça (R$)" required error={errors.valor_por_cabeca} dataField="valor_por_cabeca">
                    <Input type="number" step="0.01" value={formData.valor_por_cabeca || ""} readOnly placeholder="Calculado" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-slate-50" />
                  </FL>
                  <FL label="Valor Frete (R$)" required error={errors.valor_frete} dataField="valor_frete">
                    <Input type="number" step="0.01" value={formData.valor_frete || ""} onChange={(e) => handleChange("valor_frete", e.target.value)} placeholder="0.00" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
                  </FL>
                </div>
              </div>
            }

            {formData.motivo_entrada === "Ajuste" &&
            <FL label="Motivo do Ajuste" required error={errors.motivo_ajuste} dataField="motivo_ajuste">
                <Textarea value={formData.motivo_ajuste || ""} onChange={(e) => handleChange("motivo_ajuste", e.target.value)} placeholder="DESCREVA O MOTIVO DO AJUSTE" className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} rows={2} />
              </FL>
            }

            {formData.motivo_entrada === "Outros" &&
            <FL label="Motivo" required error={errors.motivo_outros} dataField="motivo_outros">
                <Textarea value={formData.motivo_outros || ""} onChange={(e) => handleChange("motivo_outros", e.target.value)} placeholder="DESCREVA O MOTIVO" className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} rows={2} />
              </FL>
            }

            {formData.motivo_entrada === "Inventário" &&
            <div className="border rounded-lg p-2 bg-slate-50 text-xs text-slate-600">
                Registro de inventário para contagem e conferência do rebanho.
              </div>
            }

            <FL label="Observações">
              <Textarea value={formData.observacoes || ""} onChange={(e) => handleChange("observacoes", e.target.value)} placeholder="OBSERVAÇÕES GERAIS..." className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} rows={2} />
            </FL>

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
    </motion.div>);

}