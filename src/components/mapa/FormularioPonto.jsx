import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Save, X } from "lucide-react";
import { toast } from "sonner";

export default function FormularioPonto({ coordenadas, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  
  const [formData, setFormData] = useState({
    nome: "",
    tipo: "",
    observacoes: ""
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter(i => i.empresa_id === empresaSelecionadaId && i.tipo_entidade === 'Ponto' && i.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const createPontoMutation = useMutation({
    mutationFn: async (data) => {
      const allPontos = await base44.entities.PontoReferencia.list();
      const maxNum = allPontos.reduce((max, p) => Math.max(max, parseInt(p.numero_ponto) || 0), 0);
      
      const configIcone = iconesConfig.find(ic => ic.categoria === data.tipo);
      
      return base44.entities.PontoReferencia.create({
        ...data,
        empresa_id: empresaSelecionadaId,
        numero_ponto: String(maxNum + 1),
        ativo: true,
        cor: configIcone?.cor_padrao || '#0066ff',
        coordenadas: coordenadas
      });
    },
    onSuccess: () => {
      toast.success('✅ Ponto cadastrado!');
      onSave();
    },
    onError: () => {
      toast.error('❌ Erro ao cadastrar ponto');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.nome || !formData.tipo) {
      toast.error('Preencha nome e tipo!');
      return;
    }
    createPontoMutation.mutate({
      nome: formData.nome.toUpperCase(),
      tipo: formData.tipo,
      observacoes: formData.observacoes?.toUpperCase()
    });
  };

  const tiposDisponiveis = [...new Set(iconesConfig.map(ic => ic.categoria))];

  return (
    <form onSubmit={handleSubmit} className="space-y-4 mt-4">
      <div className="space-y-1">
        <Label className="text-xs">Nome do Ponto *</Label>
        <Input
          value={formData.nome}
          onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
          placeholder="COCHO 01, AGUADA 02..."
          className="h-8 text-xs uppercase"
          required
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Tipo *</Label>
        {tiposDisponiveis.length > 0 ? (
          <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Selecione o tipo" />
            </SelectTrigger>
            <SelectContent>
              {tiposDisponiveis.map(tipo => (
                <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
            Configure ícones de pontos em Configurações → Parâmetros
          </div>
        )}
        <Input
          value={formData.tipo}
          onChange={(e) => setFormData({ ...formData, tipo: e.target.value })}
          placeholder="OU DIGITE UM NOVO TIPO"
          className="h-8 text-xs uppercase mt-1"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Observações</Label>
        <Textarea
          value={formData.observacoes}
          onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
          placeholder="OBSERVAÇÕES..."
          className="text-xs uppercase"
          rows={2}
        />
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
          <X className="w-3 h-3 mr-1" />
          Cancelar
        </Button>
        <Button type="submit" size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700">
          <Save className="w-3 h-3 mr-1" />
          Salvar Ponto
        </Button>
      </div>
    </form>
  );
}