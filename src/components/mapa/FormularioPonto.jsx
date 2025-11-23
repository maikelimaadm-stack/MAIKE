import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Save, X, Navigation } from "lucide-react";
import { toast } from "sonner";
import CapturaGPSPonto from "./CapturaGPSPonto";

function ProdutoSuplementacaoSelect({ value, onChange }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  
  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos-suplementacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter(p => 
        p.empresa_id === empresaSelecionadaId && 
        p.categoria?.toUpperCase() === 'SUPLEMENTAÇÃO'
      );
    },
    enabled: !!empresaSelecionadaId,
  });

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 text-xs">
        <SelectValue placeholder="Selecione o produto" />
      </SelectTrigger>
      <SelectContent>
        {produtos.map(produto => (
          <SelectItem key={produto.id} value={produto.nome_produto} className="text-xs">
            {produto.nome_produto}
          </SelectItem>
        ))}
        <SelectItem value="OUTRO" className="text-xs italic">
          Outro (digite manualmente)
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

export default function FormularioPonto({ coordenadas, onSave, onCancel, usarGPS = false }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [areaDetectada, setAreaDetectada] = React.useState(null);
  const [mostrarCapturaGPS, setMostrarCapturaGPS] = useState(usarGPS);
  const [coordenadasGPS, setCoordenadasGPS] = useState(coordenadas);
  
  const [formData, setFormData] = useState({
    nome: "",
    sigla: "",
    tipo: "",
    observacoes: "",
    // Campos específicos para cocho
    produto_padrao: "",
    capacidade_cocho_kg: "",
    area_vinculada_id: "",
    consumo_ideal_por_cabeca_kg: "",
    limite_minimo_consumo: "",
    limite_maximo_consumo: "",
    frequencia_esperada_dias: "7",
    alerta_sem_lancamento_dias: "10"
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

  const handleCapturaGPS = (localizacao) => {
    setCoordenadasGPS(localizacao);
    setMostrarCapturaGPS(false);
    toast.success('Localização GPS capturada!');
  };

  // Detectar automaticamente em qual área o ponto está sendo colocado
  React.useEffect(() => {
    const coords = coordenadasGPS || coordenadas;
    if (!coords || !areas.length) return;

    for (const area of areas) {
      const coords = area.coordenadas?.coords || [];
      if (coords.length < 3) continue;

      const polygon = coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      
      // Verificar se o ponto está dentro do polígono usando ray casting
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lat, yi = polygon[i].lng;
        const xj = polygon[j].lat, yj = polygon[j].lng;
        
        const intersect = ((yi > coords.lng) !== (yj > coords.lng))
            && (coords.lat < (xj - xi) * (coords.lng - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      
      if (inside) {
        setAreaDetectada(area);
        setFormData(prev => ({ ...prev, area_vinculada_id: area.id }));
        break;
      }
    }
  }, [coordenadasGPS, coordenadas, areas]);

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
          sigla: data.sigla,
          tipo: data.tipo,
          produto_padrao: data.produto_padrao || null,
          capacidade_cocho_kg: data.capacidade_cocho_kg ? parseFloat(data.capacidade_cocho_kg) : null,
          area_vinculada_id: data.area_vinculada_id,
          area_vinculada_nome: areaVinculada?.nome || '',
          coordenadas: coordenadasGPS || coordenadas,
          status: 'Ativo',
          consumo_ideal_por_cabeca_kg: data.consumo_ideal_por_cabeca_kg ? parseFloat(data.consumo_ideal_por_cabeca_kg) : null,
          limite_minimo_consumo: data.limite_minimo_consumo ? parseFloat(data.limite_minimo_consumo) : null,
          limite_maximo_consumo: data.limite_maximo_consumo ? parseFloat(data.limite_maximo_consumo) : null,
          frequencia_esperada_dias: data.frequencia_esperada_dias ? parseInt(data.frequencia_esperada_dias) : 7,
          alerta_sem_lancamento_dias: data.alerta_sem_lancamento_dias ? parseInt(data.alerta_sem_lancamento_dias) : 10
        });
      }
      
      // Se não for cocho, criar ponto de referência normal
      const allPontos = await base44.entities.PontoReferencia.list();
      const maxNum = allPontos.reduce((max, p) => Math.max(max, parseInt(p.numero_ponto) || 0), 0);
      
      const configIcone = iconesConfig.find(ic => ic.categoria === data.tipo);
      
      return await base44.entities.PontoReferencia.create({
        nome: data.nome,
        sigla: data.sigla,
        tipo: data.tipo,
        observacoes: data.observacoes,
        empresa_id: empresaSelecionadaId,
        numero_ponto: String(maxNum + 1),
        ativo: true,
        cor: configIcone?.cor_padrao || '#0066ff',
        coordenadas: coordenadasGPS || coordenadas
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
      sigla: formData.sigla.toUpperCase(),
      tipo: formData.tipo,
      observacoes: formData.observacoes?.toUpperCase(),
      produto_padrao: formData.produto_padrao,
      capacidade_cocho_kg: formData.capacidade_cocho_kg,
      area_vinculada_id: formData.area_vinculada_id,
      consumo_ideal_por_cabeca_kg: formData.consumo_ideal_por_cabeca_kg,
      limite_minimo_consumo: formData.limite_minimo_consumo,
      limite_maximo_consumo: formData.limite_maximo_consumo,
      frequencia_esperada_dias: formData.frequencia_esperada_dias,
      alerta_sem_lancamento_dias: formData.alerta_sem_lancamento_dias
    });
  };

  const tiposDisponiveis = [...new Set(iconesConfig.map(ic => ic.categoria))];

  if (mostrarCapturaGPS) {
    return (
      <CapturaGPSPonto
        onCapturar={handleCapturaGPS}
        onCancelar={() => {
          setMostrarCapturaGPS(false);
          if (usarGPS) onCancel();
        }}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 mt-4">
      <div className="grid grid-cols-2 gap-3">
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
          <Label className="text-xs font-semibold text-slate-700">Sigla</Label>
          <Input
            value={formData.sigla}
            onChange={(e) => setFormData({ ...formData, sigla: e.target.value })}
            placeholder="CO1, AG01..."
            className="h-9 text-xs uppercase"
            maxLength={10}
          />
        </div>
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
            <ProdutoSuplementacaoSelect 
              value={formData.produto_padrao}
              onChange={(v) => setFormData({ ...formData, produto_padrao: v })}
            />
            {formData.produto_padrao === 'OUTRO' && (
              <Input
                value={formData.produto_padrao}
                onChange={(e) => setFormData({ ...formData, produto_padrao: e.target.value })}
                placeholder="DIGITE O PRODUTO..."
                className="h-9 text-xs uppercase mt-2"
              />
            )}
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

          <div className="border-t pt-3 mt-3">
            <div className="text-xs font-semibold text-purple-700 mb-3">📊 Parâmetros de Consumo</div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-700">Consumo Ideal (kg/cab/dia)</Label>
                <Input
                  type="number"
                  step="0.001"
                  value={formData.consumo_ideal_por_cabeca_kg}
                  onChange={(e) => setFormData({ ...formData, consumo_ideal_por_cabeca_kg: e.target.value })}
                  className="h-9 text-xs"
                  placeholder="0.150"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-700">Limite Mínimo (kg)</Label>
                <Input
                  type="number"
                  step="0.001"
                  value={formData.limite_minimo_consumo}
                  onChange={(e) => setFormData({ ...formData, limite_minimo_consumo: e.target.value })}
                  className="h-9 text-xs"
                  placeholder="0.100"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-700">Limite Máximo (kg)</Label>
                <Input
                  type="number"
                  step="0.001"
                  value={formData.limite_maximo_consumo}
                  onChange={(e) => setFormData({ ...formData, limite_maximo_consumo: e.target.value })}
                  className="h-9 text-xs"
                  placeholder="0.200"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-700">Frequência Esperada (dias)</Label>
                <Input
                  type="number"
                  value={formData.frequencia_esperada_dias}
                  onChange={(e) => setFormData({ ...formData, frequencia_esperada_dias: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-700">Alerta sem Lançamento (dias)</Label>
                <Input
                  type="number"
                  value={formData.alerta_sem_lancamento_dias}
                  onChange={(e) => setFormData({ ...formData, alerta_sem_lancamento_dias: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>
            </div>
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