import React, { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery } from "@tanstack/react-query";
import useSetorAreas from "@/hooks/useSetorAreas";
import loteRepository from "@/core/repositories/loteRepository";
import AutocompleteGenerico from "@/components/financeiro/AutocompleteGenerico";
import { toast } from "sonner";
import LegacyRecordToolbar from "./LegacyRecordToolbar.jsx";
import LegacyTabs from "./LegacyTabs.jsx";

const FL = ({ label, required, error, children, dataField, wide = false }) =>
  <div data-field={dataField} className={`grid grid-cols-[190px_minmax(0,1fr)] items-center gap-1 ${wide ? "md:col-span-2" : ""}`}>
    <label className="text-[12px] text-slate-600 text-right leading-none">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div className={`${wide ? 'min-h-6' : 'h-6'} border ${error ? 'border-red-500 bg-red-50' : 'border-slate-300 bg-white'} focus-within:border-green-500 transition-colors [&_input]:h-[22px] [&_button]:h-[22px] [&_textarea]:min-h-[48px] [&_textarea]:rounded-none [&_textarea]:border-0 [&_textarea]:shadow-none [&_textarea]:focus-visible:ring-0`}>
      {children}
    </div>
  </div>;


const SISTEMAS = ["Cria", "Recria", "Engorda", "Ciclo Completo"];
const MOTIVOS_ENTRADA = ["Compra", "Ajuste", "Inventário", "Outros"];
const SELECT_EMPTY = "__VAZIO__";
const UPPERCASE_FIELDS = [
"nome",
"identificador_nome",
"identificador_sigla",
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

const CORES_DISPONIVEIS = [
{ nome: "Branco", cor: "#f8f9fa" },
{ nome: "Cinza claro", cor: "#d8dee2" },
{ nome: "Preto", cor: "#2c303e" },
{ nome: "Azul escuro", cor: "#0d67ad" },
{ nome: "Azul celeste", cor: "#61aad9" },
{ nome: "Amarelo", cor: "#efcb19" },
{ nome: "Verde claro", cor: "#92ca25" },
{ nome: "Laranja", cor: "#f5a01b" },
{ nome: "Roxo", cor: "#966fe1" }];


const parseSistemasProdutivos = (valor) => {
  if (Array.isArray(valor)) return valor;
  if (!valor) return [];
  return String(valor).
  split(",").
  map((item) => item.trim()).
  filter(Boolean);
};


export default function FormularioLote({ onSubmit, onCancel, onSettingsClick, initialData, isEditing }) {
  const isDuplicating = !!initialData?._isDuplicate;
  const shouldPersistEntrySnapshot = !isEditing || isDuplicating;
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const [errors, setErrors] = useState({});
  const [activeTab, setActiveTab] = useState("geral");
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
    sistema_produtivo: parseSistemasProdutivos(initialData.sistema_produtivo),
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
    sistema_produtivo: [],
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
    observacoes: "",
    identificador_nome: "",
    identificador_sigla: "",
    identificador_cor: ""
  });

  const { setores, areas, getAreasBySetor } = useSetorAreas(empresaSelecionadaId);

  const { data: categoriasManejo = [] } = useQuery({
    queryKey: ["categorias-manejo", empresaSelecionadaId],
    queryFn: () => loteRepository.listCategoriasManejo(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ["fornecedores", empresaSelecionadaId],
    queryFn: () => loteRepository.listFornecedores(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId
  });

  React.useEffect(() => {
    const areaSelecionada = areas.find((item) => item.id === formData.area_entrada_id);
    if (areaSelecionada && formData.setor_id !== areaSelecionada.setor_id) {
      setFormData((prev) => ({ ...prev, setor_id: areaSelecionada.setor_id || "" }));
    }
  }, [areas, formData.area_entrada_id, formData.setor_id]);

  const areasDoSetor = React.useMemo(() => {
    const lista = formData.setor_id ? getAreasBySetor(formData.setor_id) : [];
    return [...lista].sort((a, b) => String(a?.nome || "").localeCompare(String(b?.nome || ""), "pt-BR", { sensitivity: "base" }));
  }, [formData.setor_id, getAreasBySetor]);

  const getFieldClassName = (field, baseClass) => {
    return `${baseClass} ${errors[field] ? "border-red-500 bg-red-50 focus-visible:ring-red-500" : ""}`.trim();
  };

  const isEmptyValue = (value) => {
    if (Array.isArray(value)) return value.length === 0;
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
  const toggleSistemaProdutivo = (sistema) => {
    const atuais = parseSistemasProdutivos(formData.sistema_produtivo);
    const proximos = atuais.includes(sistema) ?
    atuais.filter((item) => item !== sistema) :
    [...atuais, sistema];
    handleChange("sistema_produtivo", proximos);
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
      sistema_produtivo: parseSistemasProdutivos(formData.sistema_produtivo).join(", "),
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
      quantidade_entrada: quantidade,
      identificador_nome: formData.identificador_nome?.toUpperCase() || "",
      identificador_sigla: formData.identificador_sigla?.toUpperCase() || "",
      identificador_cor: formData.identificador_cor || "",
      peso_medio_kg: peso,
      peso_entrada_kg: peso,
      idade_media_meses: parseInt(formData.idade_media_meses) || 0,
      valor_total_compra: parseFloat(formData.valor_total_compra) || 0,
      valor_por_cabeca: parseFloat(formData.valor_por_cabeca) || 0,
      valor_frete: parseFloat(formData.valor_frete) || 0,
      categoria_entrada: formData.categoria || "",
      categoria_manejo_entrada_id: formData.categoria_manejo_id || "",
      categoria_manejo_entrada_nome: categoriaManejo?.nome || ""
    };

    if (!shouldPersistEntrySnapshot) {
      dataToSave.quantidade_entrada = initialData?.quantidade_entrada ?? dataToSave.quantidade_entrada;
      dataToSave.peso_entrada_kg = initialData?.peso_entrada_kg ?? dataToSave.peso_entrada_kg;
      dataToSave.categoria_entrada = initialData?.categoria_entrada ?? dataToSave.categoria_entrada;
      dataToSave.categoria_manejo_entrada_id = initialData?.categoria_manejo_entrada_id ?? dataToSave.categoria_manejo_entrada_id;
      dataToSave.categoria_manejo_entrada_nome = initialData?.categoria_manejo_entrada_nome ?? dataToSave.categoria_manejo_entrada_nome;
    }


    onSubmit(dataToSave);
  };

  const tabs = [
    { id: "geral", label: "Geral" },
    { id: "compra", label: "Compra" },
    { id: "identificacao", label: "Identificação" },
    { id: "observacoes", label: "Observações" },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
      <form onSubmit={handleSubmit} className="bg-white border border-slate-300 min-h-[calc(100dvh-150px)]">
        <LegacyRecordToolbar
          title={`${formData.numero_lote ? `${formData.numero_lote} - ` : ""}${formData.nome || (isDuplicating ? "Duplicar lote" : isEditing ? "Editar lote" : "Novo lote")}`}
          statusLabel={isDuplicating ? "Duplicando registro" : isEditing ? "Editando registro" : "Inserindo registro"}
          onCancel={onCancel}
          onSettingsClick={onSettingsClick}
        />

        <div className="px-4 md:px-8 py-3 space-y-1 max-w-[760px]">
          <FL label="Descrição" required error={errors.nome} dataField="nome">
            <Input value={formData.nome || ""} onChange={(e) => handleChange("nome", e.target.value)} placeholder="NOME DO LOTE" className="h-[22px] text-xs uppercase border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" style={{ textTransform: "uppercase" }} />
          </FL>
          <FL label="Ativo">
            <div className="h-[22px] flex items-center px-1">
              <span className="w-8 h-4 rounded-full bg-green-500 relative inline-block"><span className="absolute right-0.5 top-0.5 w-3 h-3 rounded-full bg-white" /></span>
            </div>
          </FL>
          <FL label="Data de Alteração">
            <div className="grid grid-cols-2 gap-1">
              <Input value={new Date().toLocaleDateString("pt-BR")} readOnly className="h-[22px] text-xs text-center border-0 rounded-none shadow-none focus-visible:ring-0 bg-slate-50 px-1" />
              <Input value={new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} readOnly className="h-[22px] text-xs text-center border-0 rounded-none shadow-none focus-visible:ring-0 bg-slate-50 px-1" />
            </div>
          </FL>
          <FL label="Código">
            <Input value={formData.numero_lote || ""} readOnly className="h-[22px] text-xs text-right border-0 rounded-none shadow-none focus-visible:ring-0 bg-slate-50 px-1" />
          </FL>
        </div>

        <LegacyTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
        <div className="border-b border-slate-300 min-h-[360px] px-4 md:px-8 py-3">
          <div className="max-w-[780px] space-y-1">
            {activeTab === "geral" && (
              <div className="space-y-1">
                <FL label="Data de Entrada" required error={errors.data_entrada} dataField="data_entrada">
                  <Input type="date" value={formData.data_entrada || ""} onChange={(e) => handleChange("data_entrada", e.target.value)} className="h-[22px] text-xs border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" />
                </FL>
                <FL label="Setor" required error={errors.setor_id} dataField="setor_id">
                  <Select value={formData.setor_id || SELECT_EMPTY} onValueChange={(value) => { const novoSetor = value === SELECT_EMPTY ? "" : value; setFormData((prev) => ({ ...prev, setor_id: novoSetor, area_entrada_id: "" })); setErrors((prev) => ({ ...prev, setor_id: false, area_entrada_id: false })); }}>
                    <SelectTrigger className="h-[22px] text-xs border-0 rounded-none shadow-none focus:ring-0 bg-transparent px-1"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                      {setores.map((item) => <SelectItem key={item.id} value={item.id} className="text-xs">{(item.nome || "").toUpperCase()}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FL>
                <FL label="Área de Entrada" required error={errors.area_entrada_id} dataField="area_entrada_id">
                  <AutocompleteGenerico items={areasDoSetor} value={formData.area_entrada_id} onChange={(value) => handleChange("area_entrada_id", value)} placeholder={formData.setor_id ? "BUSCAR ÁREA..." : "SELECIONE O SETOR PRIMEIRO"} displayField="nome" searchFields={["nome", "numero_area"]} className="w-full" inputClassName="border-0 shadow-none focus-visible:ring-0 bg-transparent h-[22px] text-xs px-1" />
                </FL>
                <FL label="Motivo da Entrada" dataField="motivo_entrada">
                  <Select value={formData.motivo_entrada || SELECT_EMPTY} onValueChange={(value) => handleChange("motivo_entrada", value === SELECT_EMPTY ? "" : value)}>
                    <SelectTrigger className="h-[22px] text-xs border-0 rounded-none shadow-none focus:ring-0 bg-transparent px-1"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                      {MOTIVOS_ENTRADA.map((m) => <SelectItem key={m} value={m} className="text-xs">{m.toUpperCase()}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FL>
                <FL label="Qtd. Cabeças" required error={errors.quantidade_cabecas} dataField="quantidade_cabecas">
                  <Input type="number" value={formData.quantidade_cabecas || ""} onChange={(e) => handleChange("quantidade_cabecas", e.target.value)} placeholder="0" className="h-[22px] text-xs border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" />
                </FL>
                <FL label="Categoria de Manejo" required error={errors.categoria_manejo_id} dataField="categoria_manejo_id">
                  <Select value={formData.categoria_manejo_id || SELECT_EMPTY} onValueChange={(value) => handleChange("categoria_manejo_id", value === SELECT_EMPTY ? "" : value)}>
                    <SelectTrigger className="h-[22px] text-xs border-0 rounded-none shadow-none focus:ring-0 bg-transparent px-1"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                      {categoriasManejo.map((item) => <SelectItem key={item.id} value={item.id} className="text-xs">{(item.nome || "").toUpperCase()} {item.categoria_oficial ? `(${item.categoria_oficial})` : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FL>
                <FL label="Sexo" required error={errors.sexo} dataField="sexo">
                  <Select value={formData.sexo || SELECT_EMPTY} onValueChange={(value) => handleChange("sexo", value === SELECT_EMPTY ? "" : value)}>
                    <SelectTrigger className="h-[22px] text-xs border-0 rounded-none shadow-none focus:ring-0 bg-transparent px-1"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                      <SelectItem value="Macho" className="text-xs">MACHO</SelectItem>
                      <SelectItem value="Fêmea" className="text-xs">FÊMEA</SelectItem>
                      <SelectItem value="Misto" className="text-xs">MISTO</SelectItem>
                    </SelectContent>
                  </Select>
                </FL>
                <FL label="Raça Predominante" required error={errors.raca_predominante} dataField="raca_predominante">
                  <Input value={formData.raca_predominante || ""} onChange={(e) => handleChange("raca_predominante", e.target.value)} placeholder="RAÇA" className="h-[22px] text-xs uppercase border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" style={{ textTransform: "uppercase" }} />
                </FL>
                <FL label="Peso Médio (kg)" required error={errors.peso_medio_kg} dataField="peso_medio_kg">
                  <Input type="number" step="0.1" value={formData.peso_medio_kg || ""} onChange={(e) => handleChange("peso_medio_kg", e.target.value)} placeholder="0.0" className="h-[22px] text-xs border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" />
                </FL>
                <FL label="Idade Média (meses)" required error={errors.idade_media_meses} dataField="idade_media_meses">
                  <Input type="number" value={formData.idade_media_meses || ""} onChange={(e) => handleChange("idade_media_meses", e.target.value)} placeholder="0" className="h-[22px] text-xs border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" />
                </FL>
                <FL label="Sistema Produtivo" required error={errors.sistema_produtivo} dataField="sistema_produtivo" wide>
                  <div className="px-2 py-1 space-y-1 bg-transparent">
                    <div className="text-xs text-slate-600">{parseSistemasProdutivos(formData.sistema_produtivo).length > 0 ? parseSistemasProdutivos(formData.sistema_produtivo).join(", ") : "SELECIONE UM OU MAIS TIPOS"}</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                      {SISTEMAS.map((item) => {
                        const checked = parseSistemasProdutivos(formData.sistema_produtivo).includes(item);
                        return <label key={item} className="flex items-center gap-1 text-xs text-slate-700 uppercase cursor-pointer"><Checkbox checked={checked} onCheckedChange={() => toggleSistemaProdutivo(item)} className="h-3.5 w-3.5" /><span>{item}</span></label>;
                      })}
                    </div>
                  </div>
                </FL>
              </div>
            )}

            {activeTab === "compra" && (
              <div className="space-y-1">
                {formData.motivo_entrada !== "Compra" && <div className="ml-[191px] text-[11px] text-slate-500 pb-1">Selecione o motivo de entrada como COMPRA para exigir estes dados.</div>}
                <FL label="Fornecedor" required={formData.motivo_entrada === "Compra"} error={errors.fornecedor_id} dataField="fornecedor_id">
                  <Select value={formData.fornecedor_id || SELECT_EMPTY} onValueChange={(value) => handleChange("fornecedor_id", value === SELECT_EMPTY ? "" : value)}>
                    <SelectTrigger className="h-[22px] text-xs border-0 rounded-none shadow-none focus:ring-0 bg-transparent px-1"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                      {fornecedores.map((item) => <SelectItem key={item.id} value={item.id} className="text-xs">{(item.nome || "").toUpperCase()}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FL>
                <FL label="Cidade Origem" required={formData.motivo_entrada === "Compra"} error={errors.cidade_origem} dataField="cidade_origem"><Input value={formData.cidade_origem || ""} onChange={(e) => handleChange("cidade_origem", e.target.value)} placeholder="CIDADE" className="h-[22px] text-xs uppercase border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" style={{ textTransform: "uppercase" }} /></FL>
                <FL label="Estado Origem" required={formData.motivo_entrada === "Compra"} error={errors.estado_origem} dataField="estado_origem"><Input value={formData.estado_origem || ""} onChange={(e) => handleChange("estado_origem", e.target.value)} placeholder="UF" className="h-[22px] text-xs uppercase border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" style={{ textTransform: "uppercase" }} maxLength={2} /></FL>
                <FL label="Nota Fiscal" required={formData.motivo_entrada === "Compra"} error={errors.nota_fiscal} dataField="nota_fiscal"><Input value={formData.nota_fiscal || ""} onChange={(e) => handleChange("nota_fiscal", e.target.value)} placeholder="Nº DA NF" className="h-[22px] text-xs uppercase border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" style={{ textTransform: "uppercase" }} /></FL>
                <FL label="Chave NF-e" required={formData.motivo_entrada === "Compra"} error={errors.chave_nfe} dataField="chave_nfe"><Input value={formData.chave_nfe || ""} onChange={(e) => handleChange("chave_nfe", e.target.value)} placeholder="44 DÍGITOS" className="h-[22px] text-xs uppercase border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" style={{ textTransform: "uppercase" }} /></FL>
                <FL label="Nº GTA" required={formData.motivo_entrada === "Compra"} error={errors.numero_gta} dataField="numero_gta"><Input value={formData.numero_gta || ""} onChange={(e) => handleChange("numero_gta", e.target.value)} placeholder="GTA" className="h-[22px] text-xs uppercase border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" style={{ textTransform: "uppercase" }} /></FL>
                <FL label="Valor Total (R$)" required={formData.motivo_entrada === "Compra"} error={errors.valor_total_compra} dataField="valor_total_compra"><Input type="number" step="0.01" value={formData.valor_total_compra || ""} onChange={(e) => handleChange("valor_total_compra", e.target.value)} placeholder="0.00" className="h-[22px] text-xs border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" /></FL>
                <FL label="Valor p/ Cabeça (R$)" required={formData.motivo_entrada === "Compra"} error={errors.valor_por_cabeca} dataField="valor_por_cabeca"><Input type="number" step="0.01" value={formData.valor_por_cabeca || ""} readOnly placeholder="Calculado" className="h-[22px] text-xs border-0 rounded-none shadow-none focus-visible:ring-0 bg-slate-50 px-1" /></FL>
                <FL label="Valor Frete (R$)" required={formData.motivo_entrada === "Compra"} error={errors.valor_frete} dataField="valor_frete"><Input type="number" step="0.01" value={formData.valor_frete || ""} onChange={(e) => handleChange("valor_frete", e.target.value)} placeholder="0.00" className="h-[22px] text-xs border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" /></FL>
              </div>
            )}

            {activeTab === "identificacao" && (
              <div className="space-y-1">
                <FL label="Identificador (Nome)"><Input value={formData.identificador_nome || ""} onChange={(e) => handleChange("identificador_nome", e.target.value)} placeholder="EX: CONFINAMENTO" className="h-[22px] text-xs uppercase border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" style={{ textTransform: "uppercase" }} /></FL>
                <FL label="Identificador (Sigla)"><Input value={formData.identificador_sigla || ""} onChange={(e) => handleChange("identificador_sigla", e.target.value.slice(0, 2))} placeholder="EX: CF" className="h-[22px] text-xs uppercase border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" style={{ textTransform: "uppercase" }} maxLength={2} /></FL>
                <FL label="Identificador (Cor)">
                  <Select value={formData.identificador_cor || SELECT_EMPTY} onValueChange={(value) => handleChange("identificador_cor", value === SELECT_EMPTY ? "" : value)}>
                    <SelectTrigger className="h-[22px] text-xs border-0 rounded-none shadow-none focus:ring-0 bg-transparent px-1"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SELECT_EMPTY} className="text-xs">SELECIONE</SelectItem>
                      {CORES_DISPONIVEIS.map((c) => <SelectItem key={c.cor} value={c.cor} className="text-xs"><div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full border border-slate-300" style={{ backgroundColor: c.cor }} />{c.nome.toUpperCase()}</div></SelectItem>)}
                    </SelectContent>
                  </Select>
                </FL>
              </div>
            )}

            {activeTab === "observacoes" && (
              <div className="space-y-1">
                {formData.motivo_entrada === "Ajuste" && <FL label="Motivo do Ajuste" required error={errors.motivo_ajuste} dataField="motivo_ajuste" wide><Textarea value={formData.motivo_ajuste || ""} onChange={(e) => handleChange("motivo_ajuste", e.target.value)} placeholder="DESCREVA O MOTIVO DO AJUSTE" className="text-xs uppercase bg-transparent px-1" style={{ textTransform: "uppercase" }} rows={2} /></FL>}
                {formData.motivo_entrada === "Outros" && <FL label="Motivo" required error={errors.motivo_outros} dataField="motivo_outros" wide><Textarea value={formData.motivo_outros || ""} onChange={(e) => handleChange("motivo_outros", e.target.value)} placeholder="DESCREVA O MOTIVO" className="text-xs uppercase bg-transparent px-1" style={{ textTransform: "uppercase" }} rows={2} /></FL>}
                {formData.motivo_entrada === "Inventário" && <div className="ml-[191px] border border-slate-300 p-2 bg-slate-50 text-xs text-slate-600">Registro de inventário para contagem e conferência do rebanho.</div>}
                <FL label="Observações" wide><Textarea value={formData.observacoes || ""} onChange={(e) => handleChange("observacoes", e.target.value)} placeholder="OBSERVAÇÕES GERAIS..." className="text-xs uppercase bg-transparent px-1" style={{ textTransform: "uppercase" }} rows={2} /></FL>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-1 p-2 bg-slate-50 border-t border-slate-200">
          <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs px-3">Cancelar</Button>
          <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white">{isDuplicating ? "Salvar" : isEditing ? "Atualizar" : "Salvar"}</Button>
        </div>
      </form>
    </motion.div>
  );
}