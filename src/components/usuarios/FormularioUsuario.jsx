import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Shield, Users } from "lucide-react";
import { toast } from "sonner";
import { getAccessSummary } from "@/lib/permissions";

export default function FormularioUsuario({ onSubmit, onCancel, initialData, usuarios, grupos }) {
  const [formData, setFormData] = useState({
    user_email: initialData?.user_email || initialData?.email || "",
    grupo_permissao_id: initialData?.grupo_permissao_id || "",
    grupo_permissao_nome: initialData?.grupo_permissao_nome || ""
  });

  const usuariosDisponiveis = useMemo(() => usuarios.filter((u) => u.email && u.full_name), [usuarios]);
  const gruposAtivos = useMemo(() => grupos.filter((g) => g.ativo !== false), [grupos]);
  const grupoSelecionado = grupos.find((grupo) => grupo.id === formData.grupo_permissao_id) || null;
  const resumo = getAccessSummary(grupoSelecionado);

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.user_email) {
      toast.error("Selecione o usuário.");
      return;
    }

    if (!grupoSelecionado) {
      toast.error("Selecione um grupo de permissão.");
      return;
    }

    onSubmit({
      ...formData,
      grupo_permissao_nome: grupoSelecionado.nome
    });
  };

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300 bg-white">
        <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
          <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            {initialData?.user_email ? "EDITAR VÍNCULO DE USUÁRIO" : "VINCULAR USUÁRIO AO GRUPO"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs uppercase">USUÁRIO *</Label>
                <Select value={formData.user_email} onValueChange={(value) => setFormData((prev) => ({ ...prev, user_email: value }))} disabled={!!initialData?.user_email}>
                  <SelectTrigger className="h-8 text-xs uppercase">
                    <SelectValue placeholder="SELECIONE O USUÁRIO" />
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

              <div className="space-y-1">
                <Label className="text-xs uppercase">GRUPO DE PERMISSÃO *</Label>
                <Select value={formData.grupo_permissao_id} onValueChange={(value) => setFormData((prev) => ({ ...prev, grupo_permissao_id: value }))}>
                  <SelectTrigger className="h-8 text-xs uppercase">
                    <SelectValue placeholder="SELECIONE O GRUPO" />
                  </SelectTrigger>
                  <SelectContent>
                    {gruposAtivos.map((grupo) => (
                      <SelectItem key={grupo.id} value={grupo.id} className="text-xs uppercase">
                        {grupo.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {grupoSelecionado && (
              <div className="rounded-lg border bg-slate-50 p-3 space-y-2">
                <Label className="text-xs uppercase font-semibold flex items-center gap-2">
                  <Users className="w-3.5 h-3.5" />
                  RESUMO DO GRUPO
                </Label>
                <div className="flex flex-wrap gap-2">
                  <Badge className="text-xs bg-emerald-100 text-emerald-800 border-emerald-300 uppercase">{resumo.role}</Badge>
                  <Badge variant="outline" className="text-xs uppercase">{resumo.details}</Badge>
                </div>
                {grupoSelecionado.descricao && <p className="text-xs text-slate-600 uppercase">{grupoSelecionado.descricao}</p>}
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