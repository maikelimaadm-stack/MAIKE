import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Shield, Smartphone, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ACTION_OPTIONS, MOBILE_SHORTCUT_OPTIONS, createEmptyPermissionsMap } from "@/lib/navigationConfig";
import MatrizPermissoesGrupo from "@/components/usuarios/MatrizPermissoesGrupo";

const slugify = (value) => (value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/(^-|-$)/g, "");

export default function FormularioGrupoPermissao({ initialData, grupos, onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    nome: initialData?.nome || "",
    codigo: initialData?.codigo || "",
    descricao: initialData?.descricao || "",
    is_admin: initialData?.is_admin || false,
    permissoes: { ...createEmptyPermissionsMap(), ...(initialData?.permissoes || {}) },
    mobile_atalhos: initialData?.mobile_atalhos?.length ? initialData.mobile_atalhos : []
  });

  const editing = !!initialData?.id;

  const duplicateCode = useMemo(() => {
    return grupos.some((grupo) => grupo.codigo === formData.codigo && grupo.id !== initialData?.id);
  }, [grupos, formData.codigo, initialData]);

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleNameChange = (value) => {
    setFormData((prev) => ({
      ...prev,
      nome: value,
      codigo: editing ? prev.codigo : slugify(value)
    }));
  };

  const handleToggleAction = (pageId, actionId) => {
    setFormData((prev) => ({
      ...prev,
      permissoes: {
        ...prev.permissoes,
        [pageId]: {
          ...prev.permissoes[pageId],
          [actionId]: !prev.permissoes[pageId]?.[actionId]
        }
      }
    }));
  };

  const handleTogglePage = (pageId, checked) => {
    const updated = ACTION_OPTIONS.reduce((acc, action) => {
      acc[action.id] = checked;
      return acc;
    }, {});

    setFormData((prev) => ({
      ...prev,
      permissoes: {
        ...prev.permissoes,
        [pageId]: updated
      }
    }));
  };

  const handleToggleMobile = (pageId) => {
    const current = formData.mobile_atalhos || [];
    if (current.includes(pageId)) {
      handleChange("mobile_atalhos", current.filter((item) => item !== pageId));
      return;
    }
    if (current.length >= 4) {
      toast.error("Selecione no máximo 4 atalhos para o mobile.");
      return;
    }
    handleChange("mobile_atalhos", [...current, pageId]);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.nome.trim()) {
      toast.error("Informe o nome do grupo.");
      return;
    }

    if (!formData.codigo.trim()) {
      toast.error("Informe o código do grupo.");
      return;
    }

    if (duplicateCode) {
      toast.error("Já existe um grupo com este código.");
      return;
    }

    onSubmit({
      ...formData,
      nome: formData.nome.trim(),
      codigo: slugify(formData.codigo),
      descricao: formData.descricao?.trim() || ""
    });
  };

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300 bg-white">
        <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
          <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            {editing ? "Editar Grupo de Permissão" : "Novo Grupo de Permissão"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs uppercase">Nome do Grupo *</Label>
                <Input value={formData.nome} onChange={(e) => handleNameChange(e.target.value)} className="h-8 text-xs uppercase" placeholder="EX: GERENTE" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs uppercase">Código do Grupo *</Label>
                <Input value={formData.codigo} onChange={(e) => handleChange("codigo", slugify(e.target.value))} className="h-8 text-xs uppercase" placeholder="EX: gerente" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs uppercase">Descrição</Label>
                <Textarea value={formData.descricao} onChange={(e) => handleChange("descricao", e.target.value)} className="min-h-[90px] text-xs uppercase" placeholder="DESCREVA O TIPO DE ACESSO DESTE GRUPO" />
              </div>
            </div>

            <div className="border rounded-lg p-3 bg-slate-50">
              <label className="flex items-center gap-2 p-2 rounded bg-white border cursor-pointer hover:bg-violet-50 transition-colors">
                <Checkbox checked={formData.is_admin} onCheckedChange={(checked) => handleChange("is_admin", checked)} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-violet-100 text-violet-800 border-violet-300 text-xs">Administrador</Badge>
                  </div>
                  <p className="text-xs text-slate-600 mt-1">Se ativo, este grupo ignora todas as restrições e possui acesso total.</p>
                </div>
              </label>
            </div>

            {!formData.is_admin && (
              <>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase flex items-center gap-2">
                    <Users className="w-3.5 h-3.5" />
                    Permissões por Tela e Ação
                  </Label>
                  <MatrizPermissoesGrupo
                    permissoes={formData.permissoes}
                    onToggleAction={handleToggleAction}
                    onTogglePage={handleTogglePage}
                  />
                </div>

                <div className="rounded-xl border bg-slate-50 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold uppercase flex items-center gap-2">
                      <Smartphone className="w-3.5 h-3.5" />
                      Atalhos do Mobile
                    </Label>
                    <Badge variant="outline" className="text-[10px]">{formData.mobile_atalhos.length}/4</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                    {MOBILE_SHORTCUT_OPTIONS.map((page) => (
                      <label key={page.id} className="flex items-center gap-2 p-2 rounded bg-white border cursor-pointer hover:bg-emerald-50 transition-colors">
                        <Checkbox checked={formData.mobile_atalhos.includes(page.id)} onCheckedChange={() => handleToggleMobile(page.id)} />
                        <span className="text-xs flex-1 uppercase">{page.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">Cancelar</Button>
              <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">Salvar Grupo</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}