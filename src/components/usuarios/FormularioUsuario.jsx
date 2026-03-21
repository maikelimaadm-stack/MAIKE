import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Shield, Lock } from "lucide-react";
import { toast } from "sonner";
import ConfiguracaoPermissoesTelas from "@/components/usuarios/ConfiguracaoPermissoesTelas";
import { DEFAULT_MENU, getMenuModules } from "@/lib/menuConfig";
import { DEFAULT_MAPA_GERAL_PERMISSIONS } from "@/lib/mapaGeralPermissions";

const MENU_MODULES = getMenuModules(DEFAULT_MENU);

const createInitialFormData = (initialData) => ({
  user_email: initialData?.user_email || initialData?.email || "",
  modulos_permitidos: initialData?.modulos_permitidos || [],
  permissoes_telas: initialData?.permissoes_telas || [],
  mobile_menu_ids: initialData?.mobile_menu_ids || [],
  is_admin: initialData?.is_admin || false,
  mapa_geral_permissoes: {
    ...DEFAULT_MAPA_GERAL_PERMISSIONS,
    ...(initialData?.mapa_geral_permissoes || {}),
  },
});

export default function FormularioUsuario({ onSubmit, onCancel, initialData, usuarios }) {
  const [formData, setFormData] = useState(createInitialFormData(initialData));

  const usuariosDisponiveis = useMemo(
    () => usuarios.filter((user) => user.email && user.full_name),
    [usuarios]
  );

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.user_email?.trim()) {
      toast.error("Selecione um usuário.");
      return;
    }

    if (!formData.is_admin && formData.modulos_permitidos.length === 0) {
      toast.error("Selecione pelo menos um módulo.");
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
            {initialData?.user_email ? "EDITAR PERMISSÕES" : "CONFIGURAR PERMISSÕES DE USUÁRIO"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs uppercase">USUÁRIO *</Label>
              <Select
                value={formData.user_email}
                onValueChange={(value) => handleChange("user_email", value)}
                disabled={!!initialData?.user_email}
              >
                <SelectTrigger className="h-8 text-xs uppercase">
                  <SelectValue placeholder="SELECIONE UM USUÁRIO" />
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
                NÍVEL DE ACESSO
              </Label>

              <label className="flex items-center gap-2 p-2 rounded bg-white border cursor-pointer hover:bg-violet-50 transition-colors">
                <Checkbox checked={formData.is_admin} onCheckedChange={(checked) => handleChange("is_admin", checked)} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-violet-100 text-violet-800 border-violet-300 text-xs uppercase">
                      ADMINISTRADOR
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-600 mt-1 uppercase">ACESSO TOTAL A MÓDULOS, TELAS, AÇÕES E MENU MOBILE</p>
                </div>
              </label>
            </div>

            {!formData.is_admin && (
              <ConfiguracaoPermissoesTelas formData={formData} onChange={handleChange} modules={MENU_MODULES} />
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-800 uppercase">
                IMPORTANTE: AQUI VOCÊ DEFINE MÓDULOS, TELAS, AÇÕES PERMITIDAS E OS BOTÕES DO MENU MOBILE DE CADA USUÁRIO.
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