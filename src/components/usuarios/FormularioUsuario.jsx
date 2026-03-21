import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Shield, Users, Lock, LayoutGrid, Smartphone, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { ACTION_OPTIONS, DEFAULT_MOBILE_MENU_ITEMS, MOBILE_SHORTCUT_OPTIONS, MODULE_OPTIONS, PAGE_OPTIONS } from "@/lib/navigationConfig";

export default function FormularioUsuario({ onSubmit, onCancel, initialData, usuarios }) {
  const [formData, setFormData] = useState({
    user_email: initialData?.user_email || "",
    modulos_permitidos: initialData?.modulos_permitidos || [],
    paginas_permitidas: initialData?.paginas_permitidas || [],
    acoes_permitidas: initialData?.acoes_permitidas?.length ? initialData.acoes_permitidas : ACTION_OPTIONS.map((item) => item.id),
    mobile_menu_items: initialData?.mobile_menu_items?.length ? initialData.mobile_menu_items : DEFAULT_MOBILE_MENU_ITEMS,
    is_admin: initialData?.is_admin || false
  });

  const usuariosDisponiveis = usuarios.filter((u) => u.email && u.full_name);

  const paginasAgrupadas = useMemo(() => {
    return PAGE_OPTIONS.reduce((acc, page) => {
      if (!acc[page.categoria]) acc[page.categoria] = [];
      acc[page.categoria].push(page);
      return acc;
    }, {});
  }, []);

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleToggleInArray = (field, value) => {
    const current = formData[field] || [];
    if (current.includes(value)) {
      handleChange(field, current.filter((item) => item !== value));
      return;
    }
    handleChange(field, [...current, value]);
  };

  const handleToggleMobile = (value) => {
    const current = formData.mobile_menu_items || [];
    if (current.includes(value)) {
      handleChange("mobile_menu_items", current.filter((item) => item !== value));
      return;
    }
    if (current.length >= 4) {
      toast.error("Selecione no máximo 4 botões para o mobile.");
      return;
    }
    handleChange("mobile_menu_items", [...current, value]);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.user_email?.trim()) {
      toast.error("Selecione um usuário!");
      return;
    }

    if (!formData.is_admin && formData.modulos_permitidos.length === 0 && formData.paginas_permitidas.length === 0) {
      toast.error("Selecione pelo menos um módulo ou uma tela.");
      return;
    }

    onSubmit(formData);
  };

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300 bg-white">
        <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
          <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            {initialData?.user_email ? "Editar Permissões" : "Configurar Permissões de Usuário"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs uppercase">Usuário *</Label>
              <Select value={formData.user_email} onValueChange={(v) => handleChange("user_email", v)} disabled={!!initialData?.user_email}>
                <SelectTrigger className="h-8 text-xs uppercase">
                  <SelectValue placeholder="Selecione um usuário" />
                </SelectTrigger>
                <SelectContent>
                  {usuariosDisponiveis.map((user) => (
                    <SelectItem key={user.email} value={user.email} className="text-xs uppercase">
                      {user.full_name} ({user.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="border rounded-lg p-3 bg-slate-50">
              <Label className="text-xs font-semibold flex items-center gap-2 uppercase mb-3">
                <Lock className="w-3.5 h-3.5" />
                Nível de Acesso
              </Label>
              <label className="flex items-center gap-2 p-2 rounded bg-white border cursor-pointer hover:bg-violet-50 transition-colors">
                <Checkbox checked={formData.is_admin} onCheckedChange={(checked) => handleChange("is_admin", checked)} />
                <div className="flex-1">
                  <Badge className="bg-violet-100 text-violet-800 border-violet-300 text-xs">Administrador</Badge>
                  <p className="text-xs text-slate-600 mt-1">Acesso total a módulos, telas, ações e menu mobile</p>
                </div>
              </label>
            </div>

            {!formData.is_admin && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="border rounded-lg p-3 bg-slate-50 space-y-3">
                  <Label className="text-xs font-semibold flex items-center gap-2 uppercase">
                    <Users className="w-3.5 h-3.5" />
                    Módulos Permitidos
                  </Label>
                  <div className="space-y-2 max-h-80 overflow-auto pr-1">
                    {MODULE_OPTIONS.map((modulo) => (
                      <label key={modulo.id} className="flex items-center gap-2 p-2 rounded bg-white border cursor-pointer hover:bg-emerald-50 transition-colors">
                        <Checkbox checked={formData.modulos_permitidos.includes(modulo.id)} onCheckedChange={() => handleToggleInArray("modulos_permitidos", modulo.id)} />
                        <span className="text-xs flex-1 uppercase">{modulo.title}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="border rounded-lg p-3 bg-slate-50 space-y-3">
                  <Label className="text-xs font-semibold flex items-center gap-2 uppercase">
                    <KeyRound className="w-3.5 h-3.5" />
                    Ações Permitidas
                  </Label>
                  <div className="space-y-2">
                    {ACTION_OPTIONS.map((acao) => (
                      <label key={acao.id} className="flex items-center gap-2 p-2 rounded bg-white border cursor-pointer hover:bg-emerald-50 transition-colors">
                        <Checkbox checked={formData.acoes_permitidas.includes(acao.id)} onCheckedChange={() => handleToggleInArray("acoes_permitidas", acao.id)} />
                        <span className="text-xs flex-1 uppercase">{acao.title}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="border rounded-lg p-3 bg-slate-50 space-y-3 xl:col-span-2">
                  <Label className="text-xs font-semibold flex items-center gap-2 uppercase">
                    <LayoutGrid className="w-3.5 h-3.5" />
                    Telas Permitidas
                  </Label>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 max-h-[28rem] overflow-auto pr-1">
                    {Object.entries(paginasAgrupadas).map(([categoria, paginas]) => (
                      <div key={categoria} className="rounded-lg border bg-white p-3 space-y-2">
                        <p className="text-xs font-semibold text-slate-700 uppercase">{categoria}</p>
                        <div className="space-y-2">
                          {paginas.map((pagina) => (
                            <label key={pagina.url} className="flex items-center gap-2 cursor-pointer">
                              <Checkbox checked={formData.paginas_permitidas.includes(pagina.url)} onCheckedChange={() => handleToggleInArray("paginas_permitidas", pagina.url)} />
                              <span className="text-xs uppercase">{pagina.title}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border rounded-lg p-3 bg-slate-50 space-y-3 xl:col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs font-semibold flex items-center gap-2 uppercase">
                      <Smartphone className="w-3.5 h-3.5" />
                      Botões do Menu Mobile
                    </Label>
                    <Badge variant="outline" className="text-[10px]">{formData.mobile_menu_items.length}/4</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                    {MOBILE_SHORTCUT_OPTIONS.map((pagina) => (
                      <label key={pagina.url} className="flex items-center gap-2 p-2 rounded bg-white border cursor-pointer hover:bg-emerald-50 transition-colors">
                        <Checkbox checked={formData.mobile_menu_items.includes(pagina.url)} onCheckedChange={() => handleToggleMobile(pagina.url)} />
                        <span className="text-xs flex-1 uppercase">{pagina.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-800">
                <strong>Importante:</strong> Agora você pode liberar por módulo, por tela individual e definir quais atalhos aparecem no menu inferior do mobile.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                Salvar Permissões
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}