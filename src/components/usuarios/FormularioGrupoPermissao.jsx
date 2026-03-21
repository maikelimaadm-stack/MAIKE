import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Shield, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_MOBILE_SHORTCUT_IDS, DEFAULT_PAGE_ACTIONS, MOBILE_SHORTCUT_OPTIONS, PAGE_ACTION_OPTIONS, groupPagesByCategory } from "@/lib/navigationConfig";

const getInitialData = (initialData) => ({
  nome: initialData?.nome || "",
  codigo: initialData?.codigo || "",
  descricao: initialData?.descricao || "",
  ativo: initialData?.ativo ?? true,
  is_admin: initialData?.is_admin || false,
  permissoes: initialData?.permissoes || {},
  mobile: initialData?.mobile || { atalhos: DEFAULT_MOBILE_SHORTCUT_IDS }
});

export default function FormularioGrupoPermissao({ initialData, onSubmit, onCancel }) {
  const [formData, setFormData] = useState(getInitialData(initialData));
  const pagesByCategory = useMemo(() => groupPagesByCategory(), []);

  const updateField = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const toggleAction = (pageId, action) => {
    setFormData((prev) => {
      const currentPage = { ...DEFAULT_PAGE_ACTIONS, ...(prev.permissoes?.[pageId] || {}) };
      const nextValue = !currentPage[action];
      const nextPage = { ...currentPage, [action]: nextValue };

      if (action !== "visualizar" && nextValue) nextPage.visualizar = true;
      if (action === "visualizar" && !nextValue) {
        nextPage.criar = false;
        nextPage.editar = false;
        nextPage.excluir = false;
        nextPage.importar = false;
        nextPage.exportar = false;
      }

      return {
        ...prev,
        permissoes: {
          ...prev.permissoes,
          [pageId]: nextPage
        }
      };
    });
  };

  const toggleMobileShortcut = (pageId) => {
    const atalhos = formData.mobile?.atalhos || [];
    if (atalhos.includes(pageId)) {
      updateField("mobile", { atalhos: atalhos.filter((item) => item !== pageId) });
      return;
    }
    if (atalhos.length >= 4) {
      toast.error("Selecione no máximo 4 atalhos para o mobile.");
      return;
    }
    updateField("mobile", { atalhos: [...atalhos, pageId] });
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!formData.nome.trim()) {
      toast.error("Informe o nome do grupo.");
      return;
    }

    if (!formData.codigo.trim()) {
      toast.error("Informe o código do grupo.");
      return;
    }

    onSubmit({
      ...formData,
      nome: formData.nome.trim().toUpperCase(),
      codigo: formData.codigo.trim().toUpperCase()
    });
  };

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300 bg-white">
        <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
          <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            {initialData?.id ? "EDITAR GRUPO DE PERMISSÃO" : "NOVO GRUPO DE PERMISSÃO"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs uppercase">NOME *</Label>
                <Input value={formData.nome} onChange={(e) => updateField("nome", e.target.value.toUpperCase())} className="h-8 text-xs uppercase" placeholder="EX: GERENTE" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs uppercase">CÓDIGO *</Label>
                <Input value={formData.codigo} onChange={(e) => updateField("codigo", e.target.value.toUpperCase())} className="h-8 text-xs uppercase" placeholder="EX: GERENTE" />
              </div>
              <div className="space-y-1 rounded-lg border bg-slate-50 p-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={formData.is_admin} onCheckedChange={(checked) => updateField("is_admin", !!checked)} />
                  <span className="text-xs uppercase font-medium">ACESSO TOTAL (ADMIN)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer mt-2">
                  <Checkbox checked={formData.ativo} onCheckedChange={(checked) => updateField("ativo", !!checked)} />
                  <span className="text-xs uppercase font-medium">GRUPO ATIVO</span>
                </label>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs uppercase">DESCRIÇÃO</Label>
              <Textarea value={formData.descricao} onChange={(e) => updateField("descricao", e.target.value.toUpperCase())} className="min-h-[90px] text-xs uppercase" placeholder="DESCREVA O TIPO DE ACESSO DESTE GRUPO" />
            </div>

            {!formData.is_admin && (
              <div className="space-y-4">
                <div className="rounded-lg border bg-slate-50 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs uppercase font-semibold">PERMISSÕES POR TELA E AÇÃO</Label>
                    <Badge variant="outline" className="text-[10px]">ERP STYLE</Badge>
                  </div>

                  <div className="space-y-4">
                    {Object.entries(pagesByCategory).map(([category, pages]) => (
                      <div key={category} className="rounded-lg border bg-white overflow-hidden">
                        <div className="px-3 py-2 border-b bg-slate-100">
                          <p className="text-xs font-semibold text-slate-700 uppercase">{category}</p>
                        </div>
                        <div className="overflow-auto">
                          <table className="w-full min-w-[760px]">
                            <thead>
                              <tr className="border-b bg-slate-50">
                                <th className="text-left text-xs font-semibold px-3 py-2 uppercase">Tela</th>
                                {PAGE_ACTION_OPTIONS.map((action) => (
                                  <th key={action.id} className="text-center text-xs font-semibold px-2 py-2 uppercase">{action.title}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {pages.map((page) => {
                                const pagePermissions = { ...DEFAULT_PAGE_ACTIONS, ...(formData.permissoes?.[page.id] || {}) };

                                return (
                                  <tr key={page.id} className="border-b last:border-b-0 hover:bg-slate-50">
                                    <td className="px-3 py-2 text-xs uppercase">{page.title}</td>
                                    {PAGE_ACTION_OPTIONS.map((action) => (
                                      <td key={action.id} className="px-2 py-2 text-center">
                                        <div className="flex justify-center">
                                          <Checkbox checked={pagePermissions[action.id]} onCheckedChange={() => toggleAction(page.id, action.id)} />
                                        </div>
                                      </td>
                                    ))}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border bg-slate-50 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs uppercase font-semibold flex items-center gap-2">
                      <Smartphone className="w-3.5 h-3.5" />
                      ATALHOS DO MOBILE
                    </Label>
                    <Badge variant="outline" className="text-[10px]">{(formData.mobile?.atalhos || []).length}/4</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                    {MOBILE_SHORTCUT_OPTIONS.map((page) => (
                      <label key={page.id} className="flex items-center gap-2 p-2 rounded bg-white border cursor-pointer hover:bg-emerald-50 transition-colors">
                        <Checkbox checked={(formData.mobile?.atalhos || []).includes(page.id)} onCheckedChange={() => toggleMobileShortcut(page.id)} />
                        <span className="text-xs uppercase flex-1">{page.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
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