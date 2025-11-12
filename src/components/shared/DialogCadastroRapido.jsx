import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

export default function DialogCadastroRapido({ tipo, open, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    nome: "",
    sigla: "",
    descricao: "",
    ativo: true,
  });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (data) => {
      switch (tipo) {
        case 'local_estoque': {
          const all = await base44.entities.LocalEstoque.list();
          const maxNum = all.reduce((max, l) => Math.max(max, parseInt(l.numero_local) || 0), 0);
          return base44.entities.LocalEstoque.create({
            numero_local: String(maxNum + 1),
            nome: data.nome.toUpperCase(),
            descricao: data.descricao?.toUpperCase()
          });
        }
        case 'centro_custo': {
          const all = await base44.entities.CentroCusto.list();
          const maxNum = all.reduce((max, c) => Math.max(max, parseInt(c.numero_centro) || 0), 0);
          return base44.entities.CentroCusto.create({
            empresa_id: empresaSelecionadaId,
            numero_centro: String(maxNum + 1),
            nome: data.nome.toUpperCase(),
            descricao: data.descricao?.toUpperCase(),
            ativo: true
          });
        }
        case 'produto': {
          const all = await base44.entities.Produto.list();
          const maxNum = all.reduce((max, p) => Math.max(max, parseInt(p.numero_produto) || 0), 0);
          return base44.entities.Produto.create({
            empresa_id: empresaSelecionadaId,
            numero_produto: String(maxNum + 1),
            nome_produto: data.nome.toUpperCase(),
            unidade_medida: 'UN',
            estoque_atual: 0
          });
        }
        default:
          throw new Error('Tipo não suportado');
      }
    },
    onSuccess: (newItem) => {
      queryClient.invalidateQueries();
      toast.success('✅ Cadastrado com sucesso!');
      setFormData({ nome: "", sigla: "", descricao: "", ativo: true });
      onSuccess(newItem.id);
    },
    onError: (error) => {
      toast.error('❌ Erro: ' + error.message);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.nome) {
      toast.error('❌ Nome obrigatório!');
      return;
    }
    createMutation.mutate(formData);
  };

  const getTitulo = () => {
    switch (tipo) {
      case 'local_estoque': return 'Cadastrar Local de Estoque';
      case 'centro_custo': return 'Cadastrar Centro de Custo';
      case 'produto': return 'Cadastrar Produto';
      default: return 'Cadastro Rápido';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{getTitulo()}</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Nome *</Label>
            <Input 
              value={formData.nome} 
              onChange={(e) => setFormData({...formData, nome: e.target.value})} 
              placeholder="NOME" 
              className="h-9 text-xs uppercase"
              style={{ textTransform: 'uppercase' }}
              autoFocus
            />
          </div>

          {tipo !== 'produto' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Descrição</Label>
              <Textarea 
                value={formData.descricao} 
                onChange={(e) => setFormData({...formData, descricao: e.target.value})} 
                placeholder="DESCRIÇÃO..." 
                className="text-xs uppercase min-h-20"
                style={{ textTransform: 'uppercase' }}
                rows={3}
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="outline" onClick={onClose} size="sm" className="h-8 text-xs" type="button">
              Cancelar
            </Button>
            <Button 
              type="submit"
              size="sm" 
              className="bg-emerald-600 hover:bg-emerald-700 h-8 gap-1 text-xs" 
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <><Loader2 className="w-3 h-3 animate-spin" />Salvando...</>
              ) : (
                <><Save className="w-3 h-3" />Salvar</>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}