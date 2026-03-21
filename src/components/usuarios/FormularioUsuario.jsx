import React, { useState } from "react";
import { motion } from "framer-motion";
import { UserCog } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function FormularioUsuario({ initialData, usuarios, grupos, onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    user_id: initialData?.id || "",
    user_email: initialData?.email || "",
    grupo_permissao_codigo: initialData?.grupo_permissao_codigo || ""
  });

  const usuariosDisponiveis = usuarios.filter((user) => user.email && user.full_name);
  const grupoSelecionado = grupos.find((grupo) => grupo.codigo === formData.grupo_permissao_codigo);

  const handleUserChange = (userId) => {
    const user = usuarios.find((item) => item.id === userId);
    setFormData((prev) => ({
      ...prev,
      user_id: user?.id || "",
      user_email: user?.email || "",
      grupo_permissao_codigo: user?.grupo_permissao_codigo || prev.grupo_permissao_codigo
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.user_id) {
      toast.error("Selecione um usuário.");
      return;
    }

    if (!formData.grupo_permissao_codigo) {
      toast.error("Selecione um grupo de permissão.");
      return;
    }

    onSubmit(formData);
  };

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300 bg-white">
        <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
          <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <UserCog className="w-4 h-4" />
            {initialData?.id ? "Editar Vínculo do Usuário" : "Vincular Usuário ao Grupo"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs uppercase">Usuário *</Label>
              <Select value={formData.user_id} onValueChange={handleUserChange} disabled={!!initialData?.id}>
                <SelectTrigger className="h-8 text-xs uppercase">
                  <SelectValue placeholder="Selecione um usuário" />
                </SelectTrigger>
                <SelectContent>
                  {usuariosDisponiveis.map((user) => (
                    <SelectItem key={user.id} value={user.id} className="text-xs uppercase">
                      {user.full_name} ({user.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs uppercase">Grupo de Permissão *</Label>
              <Select value={formData.grupo_permissao_codigo} onValueChange={(value) => setFormData((prev) => ({ ...prev, grupo_permissao_codigo: value }))}>
                <SelectTrigger className="h-8 text-xs uppercase">
                  <SelectValue placeholder="Selecione um grupo" />
                </SelectTrigger>
                <SelectContent>
                  {grupos.map((grupo) => (
                    <SelectItem key={grupo.id} value={grupo.codigo} className="text-xs uppercase">
                      {grupo.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {grupoSelecionado && (
              <div className="rounded-lg border bg-slate-50 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs uppercase">{grupoSelecionado.nome}</Badge>
                  {grupoSelecionado.is_admin && <Badge className="bg-violet-100 text-violet-800 border-violet-300 text-xs">Admin</Badge>}
                </div>
                <p className="text-xs text-slate-600">{grupoSelecionado.descricao || "Grupo configurado com permissões herdadas por tela, ações e atalhos do mobile."}</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">Cancelar</Button>
              <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">Salvar Vínculo</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}