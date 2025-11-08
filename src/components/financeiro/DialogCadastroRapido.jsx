import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

const UNIDADES_MEDIDA = ['UN', 'KG', 'G', 'MG', 'L', 'ML', 'M', 'M2', 'M3', 'CM', 'MM', 'CX', 'PC', 'SC', 'FD', 'TON', 'KIT', 'JG', 'PAR', 'DZ'];

export default function DialogCadastroRapido({ tipo, open, onClose, onSuccess, tipoFinanceiro }) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({});
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias_dialog'],
    queryFn: () => base44.entities.Categoria.list(),
    initialData: [],
    enabled: tipo === 'produto',
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      let newItem;
      
      if (tipo === 'centro_custo') {
        const all = await base44.entities.CentroCusto.list();
        const maxNum = all.reduce((max, c) => Math.max(max, parseInt(c.numero_centro) || 0), 0);
        newItem = await base44.entities.CentroCusto.create({
          empresa_id: empresaSelecionadaId,
          numero_centro: String(maxNum + 1),
          nome: formData.nome?.toUpperCase(),
          tipo: formData.tipo || 'Setor',
          codigo: formData.codigo?.toUpperCase(),
          descricao: formData.descricao?.toUpperCase(),
          ativo: true
        });
      } else if (tipo === 'plano_contas') {
        newItem = await base44.entities.PlanoContas.create({
          empresa_id: empresaSelecionadaId,
          codigo: formData.codigo?.toUpperCase(),
          descricao: formData.descricao?.toUpperCase(),
          tipo: tipoFinanceiro,
          nivel: parseInt(formData.nivel) || 1,
          aceita_lancamento: true,
          ativo: true
        });
      } else if (tipo === 'grupo_financeiro') {
        const all = await base44.entities.GrupoFinanceiro.list();
        const maxNum = all.reduce((max, g) => Math.max(max, parseInt(g.numero_grupo) || 0), 0);
        newItem = await base44.entities.GrupoFinanceiro.create({
          empresa_id: empresaSelecionadaId,
          numero_grupo: String(maxNum + 1),
          descricao: formData.descricao?.toUpperCase(),
          tipo: tipoFinanceiro,
          ativo: true
        });
      } else if (tipo === 'forma_pagamento') {
        const all = await base44.entities.FormaPagamento.list();
        const maxNum = all.reduce((max, f) => Math.max(max, parseInt(f.numero_forma) || 0), 0);
        newItem = await base44.entities.FormaPagamento.create({
          empresa_id: empresaSelecionadaId,
          numero_forma: String(maxNum + 1),
          descricao: formData.descricao?.toUpperCase(),
          tipo: formData.tipo_pagamento || 'Pix',
          prazo_padrao_dias: parseInt(formData.prazo) || 0,
          ativo: true
        });
      } else if (tipo === 'produto') {
        const all = await base44.entities.Produto.list();
        const maxNum = all.reduce((max, p) => Math.max(max, parseInt(p.numero_produto) || 0), 0);
        newItem = await base44.entities.Produto.create({
          empresa_id: empresaSelecionadaId,
          numero_produto: String(maxNum + 1),
          nome_produto: formData.nome?.toUpperCase(),
          codigo_interno: formData.codigo?.toUpperCase(),
          unidade_medida: formData.unidade || 'UN',
          categoria: formData.categoria?.toUpperCase(),
          descricao: formData.descricao?.toUpperCase(),
          preco_custo: 0,
          estoque_atual: 0
        });
      }

      toast.success('Cadastrado com sucesso!');
      onSuccess(newItem.id);
      setFormData({});
    } catch (error) {
      toast.error('Erro ao cadastrar: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const getTitulo = () => {
    switch (tipo) {
      case 'centro_custo': return 'Novo Centro de Custo';
      case 'plano_contas': return 'Nova Conta';
      case 'grupo_financeiro': return 'Novo Grupo Financeiro';
      case 'forma_pagamento': return 'Nova Forma de Pagamento';
      case 'produto': return 'Novo Produto';
      default: return 'Novo Cadastro';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{getTitulo()}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {tipo === 'centro_custo' && (
            <>
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input value={formData.nome || ''} onChange={(e) => setFormData({ ...formData, nome: e.target.value })} required className="uppercase" style={{ textTransform: 'uppercase' }} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tipo *</Label>
                  <Select value={formData.tipo || 'Setor'} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Setor">Setor</SelectItem>
                      <SelectItem value="Departamento">Departamento</SelectItem>
                      <SelectItem value="Filial">Filial</SelectItem>
                      <SelectItem value="Projeto">Projeto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Código</Label>
                  <Input value={formData.codigo || ''} onChange={(e) => setFormData({ ...formData, codigo: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
                </div>
              </div>
            </>
          )}

          {tipo === 'plano_contas' && (
            <>
              <div className="space-y-2">
                <Label>Código *</Label>
                <Input value={formData.codigo || ''} onChange={(e) => setFormData({ ...formData, codigo: e.target.value })} placeholder="1.1.1" required className="uppercase" style={{ textTransform: 'uppercase' }} />
              </div>
              <div className="space-y-2">
                <Label>Descrição *</Label>
                <Input value={formData.descricao || ''} onChange={(e) => setFormData({ ...formData, descricao: e.target.value })} required className="uppercase" style={{ textTransform: 'uppercase' }} />
              </div>
              <div className="space-y-2">
                <Label>Nível *</Label>
                <Input type="number" min="1" max="5" value={formData.nivel || 1} onChange={(e) => setFormData({ ...formData, nivel: e.target.value })} required />
              </div>
            </>
          )}

          {tipo === 'grupo_financeiro' && (
            <div className="space-y-2">
              <Label>Descrição *</Label>
              <Input value={formData.descricao || ''} onChange={(e) => setFormData({ ...formData, descricao: e.target.value })} required className="uppercase" style={{ textTransform: 'uppercase' }} />
            </div>
          )}

          {tipo === 'forma_pagamento' && (
            <>
              <div className="space-y-2">
                <Label>Descrição *</Label>
                <Input value={formData.descricao || ''} onChange={(e) => setFormData({ ...formData, descricao: e.target.value })} required className="uppercase" style={{ textTransform: 'uppercase' }} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tipo *</Label>
                  <Select value={formData.tipo_pagamento || 'Pix'} onValueChange={(v) => setFormData({ ...formData, tipo_pagamento: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Dinheiro">Dinheiro</SelectItem>
                      <SelectItem value="Pix">Pix</SelectItem>
                      <SelectItem value="Boleto">Boleto</SelectItem>
                      <SelectItem value="Cartão Crédito">Cartão Crédito</SelectItem>
                      <SelectItem value="Cartão Débito">Cartão Débito</SelectItem>
                      <SelectItem value="Transferência">Transferência</SelectItem>
                      <SelectItem value="Cheque">Cheque</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Prazo (dias)</Label>
                  <Input type="number" value={formData.prazo || 0} onChange={(e) => setFormData({ ...formData, prazo: e.target.value })} />
                </div>
              </div>
            </>
          )}

          {tipo === 'produto' && (
            <>
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input value={formData.nome || ''} onChange={(e) => setFormData({ ...formData, nome: e.target.value })} required className="uppercase" style={{ textTransform: 'uppercase' }} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Código</Label>
                  <Input value={formData.codigo || ''} onChange={(e) => setFormData({ ...formData, codigo: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
                </div>
                <div className="space-y-2">
                  <Label>Unidade *</Label>
                  <Select value={formData.unidade || 'UN'} onValueChange={(v) => setFormData({ ...formData, unidade: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNIDADES_MEDIDA.map(un => <SelectItem key={un} value={un}>{un}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={formData.categoria || ''} onValueChange={(v) => setFormData({ ...formData, categoria: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {categorias.map(c => <SelectItem key={c.id} value={c.nome}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" className="bg-green-600" disabled={loading}>
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando...</> : <><Save className="w-4 h-4 mr-2" />Salvar</>}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}