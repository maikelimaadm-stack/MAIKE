import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MapPin } from "lucide-react";
import { toast } from "sonner";

export default function GerenciadorPontosReferencia() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    categoria: "",
    descricao: "",
    icone_url: "",
    sub_icone_url: "",
    cor_padrao: "#10b981"
  });

  const { data: pontos = [] } = useQuery({
    queryKey: ['configuracao-pontos-referencia'],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((item) => item.tipo_entidade === 'Ponto' && item.ativo !== false);
    }
  });

  const saveMutation = useMutation({
    mutationFn: (payload) => {
      if (editing) {
        return base44.entities.ConfiguracaoIcone.update(editing.id, payload);
      }
      return base44.entities.ConfiguracaoIcone.create({ ...payload, tipo_entidade: 'Ponto', ativo: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['configuracao-pontos-referencia'] });
      queryClient.invalidateQueries({ queryKey: ['configuracao-icones'] });
      queryClient.invalidateQueries({ queryKey: ['configuracao-icones-global'] });
      setOpen(false);
      setEditing(null);
      setForm({ categoria: "", descricao: "", icone_url: "", sub_icone_url: "", cor_padrao: "#10b981" });
      toast.success('Ponto de referência salvo!');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ConfiguracaoIcone.update(id, { ativo: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['configuracao-pontos-referencia'] });
      queryClient.invalidateQueries({ queryKey: ['configuracao-icones'] });
      queryClient.invalidateQueries({ queryKey: ['configuracao-icones-global'] });
      toast.success('Ponto de referência removido!');
    }
  });

  const uploadIcon = async (file, field) => {
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setForm((prev) => ({ ...prev, [field]: file_url }));
      toast.success('Ícone carregado!');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="bg-slate-50 border-b py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-700">
            <MapPin className="w-4 h-4" />
            Pontos de Referência
          </CardTitle>
          <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => setOpen(true)}>
            Novo Ponto
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-2">
        {pontos.length === 0 ? (
          <div className="text-xs text-slate-500">Nenhum ponto de referência cadastrado nos parâmetros.</div>
        ) : (
          pontos.map((item) => (
            <div key={item.id} className="border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-3 hover:bg-slate-50">
              <div className="flex items-center gap-3 min-w-0">
                {item.icone_url ? <img src={item.icone_url} alt={item.categoria} className="w-8 h-8 object-contain" /> : <div className="w-8 h-8 rounded" style={{ backgroundColor: item.cor_padrao || '#10b981' }} />}
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-800">{item.categoria}</div>
                  <div className="text-[10px] text-slate-500 truncate">{item.descricao || 'Sem descrição'}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => {
                  setEditing(item);
                  setForm({
                    categoria: item.categoria || "",
                    descricao: item.descricao || "",
                    icone_url: item.icone_url || "",
                    sub_icone_url: item.sub_icone_url || "",
                    cor_padrao: item.cor_padrao || "#10b981"
                  });
                  setOpen(true);
                }}>
                  Editar
                </Button>
                <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={() => deleteMutation.mutate(item.id)}>
                  Excluir
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">{editing ? 'Editar' : 'Cadastrar'} Ponto de Referência</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (!form.categoria.trim()) return;
            saveMutation.mutate({
              categoria: form.categoria.toUpperCase(),
              descricao: form.descricao,
              icone_url: form.icone_url,
              sub_icone_url: form.sub_icone_url,
              cor_padrao: form.cor_padrao
            });
          }} className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Nome do ponto</Label>
                <Input className="h-8 text-xs" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} placeholder="COCHO, BEBEDOURO, CURRAL..." />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cor padrão</Label>
                <Input type="color" className="h-8" value={form.cor_padrao} onChange={(e) => setForm({ ...form, cor_padrao: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Ícone principal</Label>
                <Input type="file" className="h-8 text-xs" accept="image/*" disabled={uploading} onChange={(e) => uploadIcon(e.target.files?.[0], 'icone_url')} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Sub ícone</Label>
                <Input type="file" className="h-8 text-xs" accept="image/*" disabled={uploading} onChange={(e) => uploadIcon(e.target.files?.[0], 'sub_icone_url')} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Descrição</Label>
              <Textarea className="text-xs" rows={3} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={saveMutation.isPending || uploading}>
                {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}