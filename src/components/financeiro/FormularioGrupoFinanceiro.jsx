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

export default function FormularioGrupoFinanceiro({ onSubmit, onCancel, initialData, gruposExistentes = [] }) {
  const [errors, setErrors] = useState({});
  const [formData, setFormData] = useState({
    nome: "",
    tipo: "Despesa",
    grupo_pai_id: "",
    descricao: "",
    ativo: true,
    permite_lancamento_direto: false,
    classificacao_custo: "",
  });

  useEffect(() => {
    if (initialData) {
      setFormData({
        nome: initialData.nome || "",
        tipo: initialData.tipo || "Despesa",
        grupo_pai_id: initialData.grupo_pai_id || "",
        descricao: initialData.descricao || "",
        ativo: initialData.ativo !== false,
        permite_lancamento_direto: initialData.permite_lancamento_direto || false,
        classificacao_custo: initialData.classificacao_custo || "",
      });
    }
  }, [initialData]);

  const handleChange = (field, value) => {
    const newData = { ...formData, [field]: value };
    if (field === "tipo") newData.grupo_pai_id = "";
    setErrors(prev => ({ ...prev, [field]: false }));
    setFormData(newData);
  };

  // Grupos pai filtrados pelo mesmo tipo, excluindo ele mesmo e seus filhos
  const gruposPaiDisponiveis = gruposExistentes.filter(g => {
    if (g.tipo !== formData.tipo) return false;
    if (initialData && g.id === initialData.id) return false;
    if (initialData && g.grupo_pai_id === initialData.id) return false;
    return true;
  });

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

    // Auto-calcular ordem: próximo número entre irmãos
    const siblings = gruposExistentes.filter(g => {
      if (g.tipo !== formData.tipo) return false;
      if (formData.grupo_pai_id) return g.grupo_pai_id === formData.grupo_pai_id;
      return !g.grupo_pai_id;
    });
    // Se editando, manter a ordem atual; se novo, colocar no final
    let ordem = initialData?.ordem ?? 0;
    if (!initialData?.id) {
      const maxOrdem = siblings.reduce((max, g) => Math.max(max, g.ordem ?? 0), 0);
      ordem = maxOrdem + 1;
    }

    const grupoPai = gruposExistentes.find(g => g.id === formData.grupo_pai_id);

    onSubmit({
      nome: formData.nome.toUpperCase(),
      tipo: formData.tipo,
      grupo_pai_id: formData.grupo_pai_id || undefined,
      grupo_pai_nome: grupoPai?.nome || "",
      descricao: formData.descricao?.toUpperCase() || "",
      ativo: formData.ativo,
      ordem,
      permite_lancamento_direto: formData.permite_lancamento_direto,
      classificacao_custo: formData.classificacao_custo || undefined,
    });
  };

  const isEditing = !!initialData?.id;

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
          <CardTitle className="text-sm font-semibold text-slate-700">
            {isEditing ? "Editar Grupo" : "Novo Grupo de Receita/Despesa"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-1">
          <form onSubmit={handleSubmit} className="space-y-0.5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
              <FL label="Nome" required error={errors.nome} dataField="nome">
                <Input
                  value={formData.nome}
                  onChange={(e) => handleChange("nome", e.target.value)}
                  placeholder="NOME DO GRUPO"
                  className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent"
                  style={{ textTransform: "uppercase" }}
                />
              </FL>
              <FL label="Tipo" required error={errors.tipo} dataField="tipo">
                <Select value={formData.tipo} onValueChange={(v) => handleChange("tipo", v)}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Despesa" className="text-xs">DESPESA</SelectItem>
                    <SelectItem value="Receita" className="text-xs">RECEITA</SelectItem>
                  </SelectContent>
                </Select>
              </FL>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
              <FL label="Grupo Pai" dataField="grupo_pai_id">
                <Select value={formData.grupo_pai_id || SELECT_EMPTY} onValueChange={(v) => handleChange("grupo_pai_id", v === SELECT_EMPTY ? "" : v)}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="NENHUM (RAIZ)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_EMPTY} className="text-xs">NENHUM (RAIZ)</SelectItem>
                    {gruposPaiDisponiveis.map(g => (
                      <SelectItem key={g.id} value={g.id} className="text-xs">{(g.nome || "").toUpperCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FL>
              <FL label="Classificação de Custo" dataField="classificacao_custo">
                <Select value={formData.classificacao_custo || SELECT_EMPTY} onValueChange={(v) => handleChange("classificacao_custo", v === SELECT_EMPTY ? "" : v)}>
                  <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="NÃO DEFINIDA" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_EMPTY} className="text-xs">NÃO DEFINIDA</SelectItem>
                    <SelectItem value="Direto" className="text-xs">DIRETO</SelectItem>
                    <SelectItem value="Indireto" className="text-xs">INDIRETO</SelectItem>
                    <SelectItem value="NaoAplicavel" className="text-xs">NÃO APLICÁVEL</SelectItem>
                  </SelectContent>
                </Select>
              </FL>
            </div>

            <FL label="Descrição" dataField="descricao">
              <Textarea
                value={formData.descricao}
                onChange={(e) => handleChange("descricao", e.target.value)}
                placeholder="DESCRIÇÃO OPCIONAL DO GRUPO..."
                className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent"
                style={{ textTransform: "uppercase" }}
                rows={2}
              />
            </FL>

            <div className="flex flex-wrap gap-6 py-1 px-1">
              <div className="flex items-center gap-2">
                <Checkbox id="ativo" checked={formData.ativo} onCheckedChange={(v) => handleChange("ativo", v)} />
                <label htmlFor="ativo" className="text-xs text-slate-700 cursor-pointer">Ativo</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="permite_lancamento_direto" checked={formData.permite_lancamento_direto} onCheckedChange={(v) => handleChange("permite_lancamento_direto", v)} />
                <label htmlFor="permite_lancamento_direto" className="text-xs text-slate-700 cursor-pointer">Permite Lançamento Direto</label>
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