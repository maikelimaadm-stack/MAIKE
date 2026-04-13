import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Save, X } from "lucide-react";
import { toast } from "sonner";

const FieldLabel = ({ label, required }) => (
  <label className="text-[12px] text-slate-500 pl-1 leading-none">
    {label}{required && <span className="text-red-500 ml-0.5">*</span>}
  </label>
);

const FieldWrapper = ({ error, children }) => (
  <div className={`rounded-md border ${error ? 'border-red-500 bg-red-50' : 'border-slate-300'} focus-within:border-emerald-500 transition-colors`}>
    {children}
  </div>
);

const REQUIRED_FIELDS = ["nome", "tipo", "ordem"];

export default function FormularioGrupoFinanceiro({ onSubmit, onCancel, initialData, gruposExistentes = [] }) {
  const [formData, setFormData] = useState({
    nome: "",
    tipo: "Despesa",
    grupo_pai_id: "",
    descricao: "",
    ativo: true,
    ordem: 0,
    permite_lancamento_direto: false,
    classificacao_custo: "",
  });
  const [touched, setTouched] = useState({});

  useEffect(() => {
    if (initialData) {
      setFormData({
        nome: initialData.nome || "",
        tipo: initialData.tipo || "Despesa",
        grupo_pai_id: initialData.grupo_pai_id || "",
        descricao: initialData.descricao || "",
        ativo: initialData.ativo !== false,
        ordem: initialData.ordem ?? 0,
        permite_lancamento_direto: initialData.permite_lancamento_direto || false,
        classificacao_custo: initialData.classificacao_custo || "",
      });
    }
  }, [initialData]);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setTouched(prev => ({ ...prev, [field]: true }));
  };

  const hasError = (field) => {
    if (!touched[field] && !touched._submitted) return false;
    if (REQUIRED_FIELDS.includes(field)) {
      const val = formData[field];
      if (val === "" || val === null || val === undefined) return true;
      if (field === "ordem" && (isNaN(val) || val === "")) return true;
    }
    return false;
  };

  // Grupos pai filtrados pelo mesmo tipo, excluindo ele mesmo e seus filhos
  const gruposPaiDisponiveis = gruposExistentes.filter(g => {
    if (g.tipo !== formData.tipo) return false;
    if (initialData && g.id === initialData.id) return false;
    if (initialData && g.grupo_pai_id === initialData.id) return false;
    return true;
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setTouched(prev => ({ ...prev, _submitted: true }));

    for (const field of REQUIRED_FIELDS) {
      if (hasError(field) || formData[field] === "" || formData[field] === null || formData[field] === undefined) {
        setTouched({ _submitted: true });
        toast.error("Preencha todos os campos obrigatórios!");
        return;
      }
    }

    const grupoPai = gruposExistentes.find(g => g.id === formData.grupo_pai_id);

    onSubmit({
      ...formData,
      ordem: Number(formData.ordem) || 0,
      grupo_pai_nome: grupoPai?.nome || "",
      classificacao_custo: formData.classificacao_custo || undefined,
    });
  };

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300 bg-white">
        <CardHeader className="bg-white border-b border-slate-200 py-2 px-3">
          <CardTitle className="text-sm font-semibold text-slate-900">
            {initialData?.id ? "Editar Grupo" : "Novo Grupo de Receita/Despesa"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <form onSubmit={handleSubmit} className="space-y-2">
            {/* Linha 1: Nome, Tipo, Ordem */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div className="space-y-1">
                <FieldLabel label="Nome" required />
                <FieldWrapper error={hasError("nome")}>
                  <Input
                    value={formData.nome}
                    onChange={(e) => handleChange("nome", e.target.value)}
                    placeholder="NOME DO GRUPO"
                    className="h-8 text-xs uppercase border-0 shadow-none focus-visible:ring-0"
                    style={{ textTransform: "uppercase" }}
                  />
                </FieldWrapper>
              </div>

              <div className="space-y-1">
                <FieldLabel label="Tipo" required />
                <FieldWrapper error={hasError("tipo")}>
                  <Select value={formData.tipo} onValueChange={(v) => { handleChange("tipo", v); handleChange("grupo_pai_id", ""); }}>
                    <SelectTrigger className="h-8 text-xs border-0 shadow-none focus:ring-0">
                      <SelectValue placeholder="SELECIONE" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Despesa" className="text-xs">DESPESA</SelectItem>
                      <SelectItem value="Receita" className="text-xs">RECEITA</SelectItem>
                    </SelectContent>
                  </Select>
                </FieldWrapper>
              </div>

              <div className="space-y-1">
                <FieldLabel label="Ordem" required />
                <FieldWrapper error={hasError("ordem")}>
                  <Input
                    type="number"
                    value={formData.ordem}
                    onChange={(e) => handleChange("ordem", e.target.value)}
                    placeholder="0"
                    className="h-8 text-xs border-0 shadow-none focus-visible:ring-0"
                    min={0}
                  />
                </FieldWrapper>
              </div>
            </div>

            {/* Linha 2: Grupo Pai, Classificação Custo */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="space-y-1">
                <FieldLabel label="Grupo Pai" />
                <FieldWrapper>
                  <Select value={formData.grupo_pai_id || "_none"} onValueChange={(v) => handleChange("grupo_pai_id", v === "_none" ? "" : v)}>
                    <SelectTrigger className="h-8 text-xs border-0 shadow-none focus:ring-0">
                      <SelectValue placeholder="NENHUM (RAIZ)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none" className="text-xs">NENHUM (RAIZ)</SelectItem>
                      {gruposPaiDisponiveis.map(g => (
                        <SelectItem key={g.id} value={g.id} className="text-xs uppercase">{g.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldWrapper>
              </div>

              <div className="space-y-1">
                <FieldLabel label="Classificação de Custo" />
                <FieldWrapper>
                  <Select value={formData.classificacao_custo || "_none"} onValueChange={(v) => handleChange("classificacao_custo", v === "_none" ? "" : v)}>
                    <SelectTrigger className="h-8 text-xs border-0 shadow-none focus:ring-0">
                      <SelectValue placeholder="NÃO DEFINIDA" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none" className="text-xs">NÃO DEFINIDA</SelectItem>
                      <SelectItem value="Direto" className="text-xs">DIRETO</SelectItem>
                      <SelectItem value="Indireto" className="text-xs">INDIRETO</SelectItem>
                      <SelectItem value="NaoAplicavel" className="text-xs">NÃO APLICÁVEL</SelectItem>
                    </SelectContent>
                  </Select>
                </FieldWrapper>
              </div>
            </div>

            {/* Linha 3: Descrição */}
            <div className="space-y-1">
              <FieldLabel label="Descrição" />
              <FieldWrapper>
                <Textarea
                  value={formData.descricao}
                  onChange={(e) => handleChange("descricao", e.target.value)}
                  placeholder="DESCRIÇÃO OPCIONAL DO GRUPO..."
                  className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 min-h-[60px]"
                  style={{ textTransform: "uppercase" }}
                  rows={2}
                />
              </FieldWrapper>
            </div>

            {/* Linha 4: Checkboxes */}
            <div className="flex flex-wrap gap-6 py-2 px-1">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ativo"
                  checked={formData.ativo}
                  onCheckedChange={(v) => handleChange("ativo", v)}
                />
                <label htmlFor="ativo" className="text-xs text-slate-700 cursor-pointer">Ativo</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="permite_lancamento_direto"
                  checked={formData.permite_lancamento_direto}
                  onCheckedChange={(v) => handleChange("permite_lancamento_direto", v)}
                />
                <label htmlFor="permite_lancamento_direto" className="text-xs text-slate-700 cursor-pointer">Permite Lançamento Direto</label>
              </div>
            </div>

            {/* Ações */}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
                <X className="w-3.5 h-3.5 mr-1" /> Cancelar
              </Button>
              <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                <Save className="w-3.5 h-3.5 mr-1" /> {initialData?.id ? "Atualizar" : "Salvar"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}