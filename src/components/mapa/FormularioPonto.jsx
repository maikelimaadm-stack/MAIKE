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
  const [areaDetectada, setAreaDetectada] = React.useState(null);
  
  const [formData, setFormData] = useState({
    nome: "",
    tipo: "",
    observacoes: "",
    // Campos específicos para cocho
    produto_padrao: "",
    capacidade_cocho_kg: "",
    area_vinculada_id: ""
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter(i => i.empresa_id === empresaSelecionadaId && (i.tipo_entidade === 'Ponto' || i.tipo_entidade === 'Cocho') && i.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Detectar automaticamente em qual área o ponto está sendo colocado
  React.useEffect(() => {
    if (!coordenadas || !areas.length) return;

    for (const area of areas) {
      const coords = area.coordenadas?.coords || [];
      if (coords.length < 3) continue;

      const polygon = coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      
      // Verificar se o ponto está dentro do polígono usando ray casting
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lat, yi = polygon[i].lng;
        const xj = polygon[j].lat, yj = polygon[j].lng;
        
        const intersect = ((yi > coordenadas.lng) !== (yj > coordenadas.lng))
            && (coordenadas.lat < (xj - xi) * (coordenadas.lng - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      
      if (inside) {
        setAreaDetectada(area);
        setFormData(prev => ({ ...prev, area_vinculada_id: area.id }));
        break;
      }
    }
  }, [coordenadas, areas]);

  const createPontoMutation = useMutation({
    mutationFn: async (data) => {
      // Se for cocho, criar APENAS ponto de suplementação
      if (data.tipo?.toUpperCase().includes('COCHO') && data.area_vinculada_id) {
        const allPontosSuplementacao = await base44.entities.PontoSuplementacao.list();
        const pontosEmpresa = allPontosSuplementacao.filter(p => p.empresa_id === empresaSelecionadaId);
        const ultimoNumero = pontosEmpresa.length > 0
          ? Math.max(...pontosEmpresa.map(p => parseInt(p.numero_ponto?.replace(/\D/g, '')) || 0))
          : 0;
        const novoNumero = String(ultimoNumero + 1).padStart(4, '0');

        const areaVinculada = areas.find(a => a.id === data.area_vinculada_id);

        return await base44.entities.PontoSuplementacao.create({
          empresa_id: empresaSelecionadaId,
          numero_ponto: `COCHO-${novoNumero}`,
          nome_ponto: data.nome,
          tipo: data.tipo,
          produto_padrao: data.produto_padrao || null,
          capacidade_cocho_kg: data.capacidade_cocho_kg ? parseFloat(data.capacidade_cocho_kg) : null,
          area_vinculada_id: data.area_vinculada_id,
          area_vinculada_nome: areaVinculada?.nome || '',
          coordenadas: coordenadas,
          status: 'Ativo',
          frequencia_esperada_dias: 7,
          alerta_sem_lancamento_dias: 10
        });
      }
      
      // Se não for cocho, criar ponto de referência normal
      const allPontos = await base44.entities.PontoReferencia.list();
      const maxNum = allPontos.reduce((max, p) => Math.max(max, parseInt(p.numero_ponto) || 0), 0);
      
      const configIcone = iconesConfig.find(ic => ic.categoria === data.tipo);
      
      return await base44.entities.PontoReferencia.create({
        nome: data.nome,
        tipo: data.tipo,
        observacoes: data.observacoes,
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
    if (formData.tipo?.toUpperCase().includes('COCHO') && !formData.area_vinculada_id) {
      toast.error('Para cocho é necessário selecionar uma área!');
      return;
    }
    createPontoMutation.mutate({
      nome: formData.nome.toUpperCase(),
      tipo: formData.tipo,
      observacoes: formData.observacoes?.toUpperCase(),
      produto_padrao: formData.produto_padrao,
      capacidade_cocho_kg: formData.capacidade_cocho_kg,
      area_vinculada_id: formData.area_vinculada_id
    });
  };

  const tiposDisponiveis = [...new Set(iconesConfig.map(ic => ic.categoria))];

  return (
    <form onSubmit={handleSubmit} className="space-y-3 mt-4">
      <div className="space-y-2">
        <Label className="text-xs font-semibold text-slate-700">Nome do Ponto *</Label>
        <Input
          value={formData.nome}
          onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
          placeholder="COCHO 01, AGUADA 02..."
          className="h-9 text-xs uppercase"
          required
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-semibold text-slate-700">Tipo *</Label>
        {tiposDisponiveis.length > 0 ? (
          <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Selecione o tipo" />
            </SelectTrigger>
            <SelectContent>
              {tiposDisponiveis.map(tipo => (
                <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded-lg">
            Configure ícones de pontos em Configurações → Parâmetros
          </div>
        )}
        <div className="pt-1">
          <Input
            value={formData.tipo}
            onChange={(e) => setFormData({ ...formData, tipo: e.target.value })}
            placeholder="OU DIGITE UM NOVO TIPO"
            className="h-9 text-xs uppercase"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-semibold text-slate-700">Observações</Label>
        <Textarea
          value={formData.observacoes}
          onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
          placeholder="OBSERVAÇÕES..."
          className="text-xs uppercase"
          rows={3}
        />
      </div>

      {formData.tipo?.toUpperCase().includes('COCHO') && (
        <div className="space-y-3 border-t pt-3">
          <div className="text-xs font-semibold text-purple-700 mb-2">📦 Dados de Suplementação</div>
          
          {areaDetectada && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 mb-2">
              <div className="text-xs font-semibold text-emerald-800">✓ Área detectada: {areaDetectada.nome}</div>
            </div>
          )}
          
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-slate-700">Área Vinculada *</Label>
            <Select value={formData.area_vinculada_id} onValueChange={(v) => setFormData({ ...formData, area_vinculada_id: v })}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Selecione a área" />
              </SelectTrigger>
              <SelectContent>
                {areas.map(area => (
                  <SelectItem key={area.id} value={area.id} className="text-xs">{area.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold text-slate-700">Produto Padrão</Label>
            <Input
              value={formData.produto_padrao}
              onChange={(e) => setFormData({ ...formData, produto_padrao: e.target.value })}
              placeholder="SAL MINERAL..."
              className="h-9 text-xs uppercase"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold text-slate-700">Capacidade do Cocho (kg)</Label>
            <Input
              type="number"
              step="0.01"
              value={formData.capacidade_cocho_kg}
              onChange={(e) => setFormData({ ...formData, capacidade_cocho_kg: e.target.value })}
              className="h-9 text-xs"
            />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-3 border-t mt-4">
        <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-9 text-xs gap-1.5">
          <X className="w-3.5 h-3.5" />
          Cancelar
        </Button>
        <Button type="submit" size="sm" className="h-9 text-xs bg-slate-700 hover:bg-slate-800 gap-1.5">
          <Save className="w-3.5 h-3.5" />
          Salvar Ponto
        </Button>
      </div>
    </form>
  );
}