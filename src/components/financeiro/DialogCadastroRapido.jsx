import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

export default function DialogCadastroRapido({ tipo, open, onClose, onSuccess, tipoFinanceiro }) {
  const [dados, setDados] = useState({});
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (data) => {
      if (tipo === 'centro_custo') {
        const all = await base44.entities.CentroCusto.list();
        const maxNum = all.reduce((max, c) => Math.max(max, parseInt(c.numero_centro) || 0), 0);
        return base44.entities.CentroCusto.create({
          ...data,
          empresa_id: empresaSelecionadaId,
          numero_centro: String(maxNum + 1),
          ativo: true
        });
      } else if (tipo === 'plano_contas') {
        const all = await base44.entities.PlanoContas.list();
        const maxNum = all.reduce((max, p) => Math.max(max, parseInt(p.numero_plano) || 0), 0);
        return base44.entities.PlanoContas.create({
          ...data,
          empresa_id: empresaSelecionadaId,
          numero_plano: String(maxNum + 1),
          tipo: tipoFinanceiro || 'Despesa',
          ativo: true
        });
      } else if (tipo === 'grupo_financeiro') {
        const all = await base44.entities.GrupoFinanceiro.list();
        const maxNum = all.reduce((max, g) => Math.max(max, parseInt(g.numero_grupo) || 0), 0);
        return base44.entities.GrupoFinanceiro.create({
          ...data,
          empresa_id: empresaSelecionadaId,
          numero_grupo: String(maxNum + 1),
          tipo: tipoFinanceiro || 'Despesa',
          ativo: true
        });
      } else if (tipo === 'local_estoque') {
        return base44.entities.LocalEstoque.create({
          nome: data.nome.toUpperCase(),
          descricao: data.descricao?.toUpperCase()
        });
      } else if (tipo === 'safra') {
        const all = await base44.entities.Safra.list();
        const maxNum = all.reduce((max, s) => Math.max(max, parseInt(s.numero_safra) || 0), 0);
        return base44.entities.Safra.create({
          ...data,
          empresa_id: empresaSelecionadaId,
          numero_safra: String(maxNum + 1)
        });
      }
    },
    onSuccess: (newItem) => {
      toast.success('✅ Cadastrado com sucesso!');
      setDados({});
      onSuccess(newItem.id);
    },
    onError: (error) => {
      toast.error('❌ Erro ao cadastrar: ' + error.message);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (tipo === 'centro_custo' && !dados.nome) {
      toast.error('❌ Nome obrigatório!');
      return;
    }
    
    if (tipo === 'plano_contas' && (!dados.codigo || !dados.descricao)) {
      toast.error('❌ Código e descrição obrigatórios!');
      return;
    }
    
    if (tipo === 'grupo_financeiro' && !dados.descricao) {
      toast.error('❌ Descrição obrigatória!');
      return;
    }
    
    if (tipo === 'local_estoque' && !dados.nome) {
      toast.error('❌ Nome obrigatório!');
      return;
    }
    
    if (tipo === 'safra' && (!dados.ano_inicio || !dados.ano_fim)) {
      toast.error('❌ Anos obrigatórios!');
      return;
    }

    createMutation.mutate({
      ...dados,
      nome: dados.nome?.toUpperCase(),
      descricao: dados.descricao?.toUpperCase(),
      codigo: dados.codigo?.toUpperCase()
    });
  };

  const getTitulo = () => {
    const titulos = {
      'centro_custo': 'Novo Centro de Custo',
      'plano_contas': 'Novo Plano de Contas',
      'grupo_financeiro': 'Novo Grupo Financeiro',
      'local_estoque': 'Novo Local de Estoque',
      'safra': 'Nova Safra'
    };
    return titulos[tipo] || 'Novo Cadastro';
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{getTitulo()}</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-3">
          {tipo === 'centro_custo' && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Nome *</Label>
                <Input 
                  value={dados.nome || ''} 
                  onChange={(e) => setDados({ ...dados, nome: e.target.value })} 
                  placeholder="NOME DO CENTRO DE CUSTO"
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Descrição</Label>
                <Input 
                  value={dados.descricao || ''} 
                  onChange={(e) => setDados({ ...dados, descricao: e.target.value })} 
                  placeholder="DESCRIÇÃO"
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
            </>
          )}

          {tipo === 'plano_contas' && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Código *</Label>
                <Input 
                  value={dados.codigo || ''} 
                  onChange={(e) => setDados({ ...dados, codigo: e.target.value })} 
                  placeholder="1.1.01"
                  className="h-8 text-xs"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Descrição *</Label>
                <Input 
                  value={dados.descricao || ''} 
                  onChange={(e) => setDados({ ...dados, descricao: e.target.value })} 
                  placeholder="DESCRIÇÃO"
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Tipo *</Label>
                <Select value={dados.tipo || tipoFinanceiro || 'Despesa'} onValueChange={(v) => setDados({ ...dados, tipo: v })} disabled>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Despesa" className="text-xs">Despesa</SelectItem>
                    <SelectItem value="Receita" className="text-xs">Receita</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {tipo === 'grupo_financeiro' && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Descrição *</Label>
                <Input 
                  value={dados.descricao || ''} 
                  onChange={(e) => setDados({ ...dados, descricao: e.target.value })} 
                  placeholder="DESCRIÇÃO"
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Tipo *</Label>
                <Select value={dados.tipo || tipoFinanceiro || 'Despesa'} onValueChange={(v) => setDados({ ...dados, tipo: v })} disabled>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Despesa" className="text-xs">Despesa</SelectItem>
                    <SelectItem value="Receita" className="text-xs">Receita</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {tipo === 'local_estoque' && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Nome *</Label>
                <Input 
                  value={dados.nome || ''} 
                  onChange={(e) => setDados({ ...dados, nome: e.target.value })} 
                  placeholder="NOME DO LOCAL"
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Descrição</Label>
                <Input 
                  value={dados.descricao || ''} 
                  onChange={(e) => setDados({ ...dados, descricao: e.target.value })} 
                  placeholder="DESCRIÇÃO"
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
            </>
          )}

          {tipo === 'safra' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Ano Início *</Label>
                  <Input 
                    type="number"
                    value={dados.ano_inicio || ''} 
                    onChange={(e) => setDados({ ...dados, ano_inicio: e.target.value })} 
                    placeholder="2024"
                    className="h-8 text-xs"
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Ano Fim *</Label>
                  <Input 
                    type="number"
                    value={dados.ano_fim || ''} 
                    onChange={(e) => setDados({ ...dados, ano_fim: e.target.value })} 
                    placeholder="2025"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Descrição</Label>
                <Input 
                  value={dados.descricao || ''} 
                  onChange={(e) => setDados({ ...dados, descricao: e.target.value })} 
                  placeholder="DESCRIÇÃO DA SAFRA"
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button type="button" variant="outline" onClick={onClose} className="h-8 text-xs">
              Cancelar
            </Button>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 h-8 gap-1 text-xs" disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="w-3 h-3" />
                  Salvar
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}