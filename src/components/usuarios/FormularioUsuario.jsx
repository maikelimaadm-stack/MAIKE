import React, { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Shield, Users, Lock } from "lucide-react";
import { toast } from "sonner";

const MODULOS_SISTEMA = [
  { id: "dashboard", title: "Dashboard", icon: "Home" },
  { id: "pesagens", title: "Pesagens", icon: "Scale" },
  { id: "custos", title: "Custos de Safra", icon: "TrendingUp" },
  { id: "movimentacoes", title: "Movimentações Estoque", icon: "ArrowRightLeft" },
  { id: "financeiro", title: "Financeiro (Todos)", icon: "DollarSign" },
  { id: "fiscal", title: "Fiscal (Todos)", icon: "BookOpen" },
  { id: "cadastros", title: "Cadastros (Todos)", icon: "FolderOpen" },
  { id: "relatorios", title: "Relatórios (Todos)", icon: "FileText" },
  { id: "usuarios", title: "Usuários", icon: "Shield" },
];

export default function FormularioUsuario({ onSubmit, onCancel, initialData, usuarios }) {
  const [formData, setFormData] = useState(initialData || {
    user_email: "",
    modulos_permitidos: [],
    is_admin: false
  });

  const handleChange = (field, value) => {
    setFormData({ ...formData, [field]: value });
  };

  const handleToggleModulo = (moduloId) => {
    const modulos = formData.modulos_permitidos || [];
    if (modulos.includes(moduloId)) {
      handleChange('modulos_permitidos', modulos.filter(m => m !== moduloId));
    } else {
      handleChange('modulos_permitidos', [...modulos, moduloId]);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.user_email?.trim()) {
      toast.error('Selecione um usuário!');
      return;
    }

    if (!formData.is_admin && formData.modulos_permitidos.length === 0) {
      toast.error('Selecione pelo menos um módulo ou marque como Admin!');
      return;
    }

    onSubmit(formData);
  };

  const usuariosDisponiveis = usuarios.filter(u => u.email && u.full_name);

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className="shadow-sm border-slate-300 bg-white">
        <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
          <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            {initialData?.user_email ? 'Editar Permissões' : 'Configurar Permissões de Usuário'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Usuário *</Label>
              <Select 
                value={formData.user_email} 
                onValueChange={(v) => handleChange('user_email', v)}
                disabled={!!initialData?.user_email}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione um usuário" />
                </SelectTrigger>
                <SelectContent>
                  {usuariosDisponiveis.map((user) => (
                    <SelectItem key={user.email} value={user.email} className="text-xs">
                      {user.full_name} ({user.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="border rounded-lg p-3 bg-slate-50">
              <div className="flex items-center justify-between mb-3">
                <Label className="text-xs font-semibold flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5" />
                  Nível de Acesso
                </Label>
              </div>
              
              <label className="flex items-center gap-2 p-2 rounded bg-white border cursor-pointer hover:bg-violet-50 transition-colors">
                <Checkbox
                  checked={formData.is_admin}
                  onCheckedChange={(checked) => handleChange('is_admin', checked)}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-violet-100 text-violet-800 border-violet-300 text-xs">
                      Administrador
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-600 mt-1">Acesso total a todos os módulos do sistema</p>
                </div>
              </label>
            </div>

            {!formData.is_admin && (
              <div className="border rounded-lg p-3 bg-slate-50">
                <Label className="text-xs font-semibold mb-3 block flex items-center gap-2">
                  <Users className="w-3.5 h-3.5" />
                  Módulos Permitidos *
                </Label>
                <div className="space-y-2">
                  {MODULOS_SISTEMA.map((modulo) => (
                    <label 
                      key={modulo.id}
                      className="flex items-center gap-2 p-2 rounded bg-white border cursor-pointer hover:bg-emerald-50 transition-colors"
                    >
                      <Checkbox
                        checked={formData.modulos_permitidos?.includes(modulo.id)}
                        onCheckedChange={() => handleToggleModulo(modulo.id)}
                      />
                      <span className="text-xs flex-1">{modulo.title}</span>
                      {formData.modulos_permitidos?.includes(modulo.id) && (
                        <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300">
                          Permitido
                        </Badge>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-800">
                💡 <strong>Importante:</strong> Módulos não selecionados ficarão ocultos no menu e inacessíveis para este usuário.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button type="submit" size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800">
                Salvar Permissões
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}