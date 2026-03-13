import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import CapturaGPSPonto from "./CapturaGPSPonto";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

function ProdutoSuplementacaoSelect({ value, onChange }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos-suplementacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter((p) =>
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
        {produtos.map((produto) => (
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

export default function FormularioPonto({ coordenadas, onSave, onCancel, usarGPS = false, item = null }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [areaDetectada, setAreaDetectada] = React.useState(null);
  const [mostrarCapturaGPS, setMostrarCapturaGPS] = useState(usarGPS);
  const [coordenadasGPS, setCoordenadasGPS] = useState(coordenadas || item?.coordenadas || null);
  const [progresso, setProgresso] = useState({ show: false, atual: 0, total: 0, mensagem: '' });

  const [formData, setFormData] = useState({
    nome: item?.nome || "",
    sigla: item?.sigla || "",
    tipo: item?.tipo || "",
    configuracao_icone_id: item?.configuracao_icone_id || "",
    observacoes: item?.observacoes || "",
    produto_padrao: item?.produto_padrao || "",
    capacidade_cocho_kg: item?.capacidade_cocho_kg || "",
    area_vinculada_id: item?.area_vinculada_id || "",
    consumo_ideal_por_cabeca_kg: item?.consumo_ideal_por_cabeca_kg || "",
    limite_minimo_consumo: item?.limite_minimo_consumo || "",
    limite_maximo_consumo: item?.limite_maximo_consumo || "",
    frequencia_esperada_dias: item?.frequencia_esperada_dias || "7",
    alerta_sem_lancamento_dias: item?.alerta_sem_lancamento_dias || "10"
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((i) => i.tipo_entidade === 'Ponto' && i.ativo !== false);
    },
    enabled: true,
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter((a) => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const handleCapturaGPS = (localizacao) => {
    setCoordenadasGPS(localizacao);
    setMostrarCapturaGPS(false);
    toast.success('Localização GPS capturada!');
  };

  React.useEffect(() => {
    const pontoCoords = coordenadasGPS || coordenadas;
    if (!pontoCoords || !areas.length) return;

    for (const area of areas) {
      const areaCoords = area.coordenadas?.coords || [];
      if (areaCoords.length < 3) continue;

      const polygon = areaCoords.map((c) => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lat, yi = polygon[i].lng;
        const xj = polygon[j].lat, yj = polygon[j].lng;
        const intersect = ((yi > pontoCoords.lng) !== (yj > pontoCoords.lng))
          && (pontoCoords.lat < (xj - xi) * (pontoCoords.lng - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      if (inside) {
        setAreaDetectada(area);
        setFormData((prev) => ({ ...prev, area_vinculada_id: prev.area_vinculada_id || area.id }));
        break;
      }
    }
  }, [coordenadasGPS, coordenadas, areas]);

  const createPontoMutation = useMutation({
    mutationFn: async (data) => {
      setProgresso({ show: true, atual: 1, total: 2, mensagem: item ? 'Atualizando ponto de referência...' : 'Criando ponto de referência...' });

      const allPontos = await base44.entities.PontoReferencia.list();
      const maxNum = allPontos.reduce((max, p) => Math.max(max, parseInt(p.numero_ponto) || 0), 0);
      const configIcone = iconesConfig.find((ic) => ic.id === data.configuracao_icone_id) || iconesConfig.find((ic) => ic.categoria === data.tipo);

      const payloadPonto = {
        nome: data.nome,
        sigla: data.sigla,
        tipo: data.tipo,
        configuracao_icone_id: data.configuracao_icone_id || null,
        icone_url: configIcone?.icone_url || null,
        sub_icone_url: configIcone?.sub_icone_url || null,
        observacoes: data.observacoes,
        empresa_id: empresaSelecionadaId,
        numero_ponto: item?.numero_ponto || String(maxNum + 1),
        ativo: true,
        cor: configIcone?.cor_padrao || '#0066ff',
        coordenadas: coordenadasGPS || coordenadas
      };

      const pontoReferencia = item
        ? await base44.entities.PontoReferencia.update(item.id, payloadPonto)
        : await base44.entities.PontoReferencia.create(payloadPonto);

      const ehCocho = data.area_vinculada_id && data.tipo?.toUpperCase().includes('COCHO');
      if (ehCocho) {
        setProgresso({ show: true, atual: 2, total: 2, mensagem: item ? 'Atualizando ponto de suplementação...' : 'Criando ponto de suplementação...' });
        const allPontosSuplementacao = await base44.entities.PontoSuplementacao.list();
        const pontosEmpresa = allPontosSuplementacao.filter((p) => p.empresa_id === empresaSelecionadaId);
        const ultimoNumero = pontosEmpresa.length > 0
          ? Math.max(...pontosEmpresa.map((p) => parseInt(p.numero_ponto?.replace(/\D/g, '')) || 0))
          : 0;
        const novoNumero = String(ultimoNumero + 1).padStart(4, '0');
        const areaVinculada = areas.find((a) => a.id === data.area_vinculada_id);
        const pontoSuplementacaoExistente = item
          ? pontosEmpresa.find((p) => p.nome_ponto === item.nome && p.status === 'Ativo')
          : null;

        const payloadSuplementacao = {
          empresa_id: empresaSelecionadaId,
          numero_ponto: pontoSuplementacaoExistente?.numero_ponto || `COCHO-${novoNumero}`,
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
        };

        if (pontoSuplementacaoExistente) {
          await base44.entities.PontoSuplementacao.update(pontoSuplementacaoExistente.id, payloadSuplementacao);
        } else {
          await base44.entities.PontoSuplementacao.create(payloadSuplementacao);
        }
      }

      setProgresso({ show: true, atual: 2, total: 2, mensagem: 'Concluído!' });
      await new Promise((resolve) => setTimeout(resolve, 300));
      return pontoReferencia;
    },
    onSuccess: () => {
      setProgresso({ show: false, atual: 0, total: 0, mensagem: '' });
      toast.success(item ? '✅ Ponto atualizado!' : '✅ Ponto cadastrado!');
      onSave();
    },
    onError: () => {
      setProgresso({ show: false, atual: 0, total: 0, mensagem: '' });
      toast.error(item ? '❌ Erro ao atualizar ponto' : '❌ Erro ao cadastrar ponto');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.nome || !formData.tipo) {
      toast.error('Preencha nome e tipo!');
      return;
    }
    if (!coordenadasGPS && !coordenadas) {
      toast.error('Coordenadas não informadas!');
      return;
    }
    const ehCocho = formData.tipo?.toUpperCase().includes('COCHO');
    if (ehCocho && !formData.area_vinculada_id) {
      toast.error('Para cocho é necessário selecionar uma área!');
      return;
    }

    createPontoMutation.mutate({
      nome: formData.nome.toUpperCase(),
      sigla: formData.sigla.toUpperCase(),
      tipo: formData.tipo,
      configuracao_icone_id: formData.configuracao_icone_id,
      observacoes: formData.observacoes?.toUpperCase(),
      produto_padrao: ehCocho ? formData.produto_padrao : null,
      capacidade_cocho_kg: ehCocho ? formData.capacidade_cocho_kg : null,
      area_vinculada_id: ehCocho ? formData.area_vinculada_id : null,
      consumo_ideal_por_cabeca_kg: ehCocho ? formData.consumo_ideal_por_cabeca_kg : null,
      limite_minimo_consumo: ehCocho ? formData.limite_minimo_consumo : null,
      limite_maximo_consumo: ehCocho ? formData.limite_maximo_consumo : null,
      frequencia_esperada_dias: ehCocho ? formData.frequencia_esperada_dias : null,
      alerta_sem_lancamento_dias: ehCocho ? formData.alerta_sem_lancamento_dias : null
    });
  };

  const pontosReferenciaCadastrados = iconesConfig;
  const tiposDisponiveis = [...new Set(iconesConfig.map((ic) => ic.categoria))];

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
    <>
      <form onSubmit={handleSubmit} className="space-y-3 mt-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-slate-700">Nome do Ponto *</Label>
            <Input value={formData.nome} onChange={(e) => setFormData({ ...formData, nome: e.target.value })} placeholder="COCHO 01, AGUADA..." className="h-9 text-xs uppercase" required />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-slate-700">Sigla</Label>
            <Input value={formData.sigla} onChange={(e) => setFormData({ ...formData, sigla: e.target.value })} placeholder="CO1, AG01..." className="h-9 text-xs uppercase" maxLength={10} />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold text-slate-700">Ponto de Referência *</Label>
          {pontosReferenciaCadastrados.length > 0 ? (
            <Select value={formData.configuracao_icone_id} onValueChange={(value) => {
              const configuracao = pontosReferenciaCadastrados.find((itemConfig) => itemConfig.id === value);
              setFormData({ ...formData, configuracao_icone_id: value, tipo: configuracao?.categoria || formData.tipo });
            }}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Selecione o ponto de referência" />
              </SelectTrigger>
              <SelectContent>
                {pontosReferenciaCadastrados.map((itemConfig) => (
                  <SelectItem key={itemConfig.id} value={itemConfig.id} className="text-xs">{itemConfig.categoria}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded-lg">
              Cadastre o tipo no Gerenciamento de Ícones em Configurações → Parâmetros
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold text-slate-700">Observações</Label>
          <Textarea value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} placeholder="OBSERVAÇÕES..." className="text-xs uppercase" rows={3} />
        </div>

        {formData.tipo?.toUpperCase().includes('COCHO') && (
          <div className="space-y-3 border-t pt-3">
            <div className="text-xs font-semibold text-purple-700 mb-2">Dados de Suplementação</div>
            {areaDetectada && <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 mb-2"><div className="text-xs font-semibold text-emerald-800">Área detectada: {areaDetectada.nome}</div></div>}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-slate-700">Área Vinculada *</Label>
              <Select value={formData.area_vinculada_id} onValueChange={(v) => setFormData({ ...formData, area_vinculada_id: v })}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecione a área" /></SelectTrigger>
                <SelectContent>
                  {areas.map((area) => <SelectItem key={area.id} value={area.id} className="text-xs">{area.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-slate-700">Produto Padrão</Label>
              <ProdutoSuplementacaoSelect value={formData.produto_padrao} onChange={(v) => setFormData({ ...formData, produto_padrao: v })} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-slate-700">Capacidade do Cocho (kg)</Label>
              <Input type="number" step="0.01" value={formData.capacidade_cocho_kg} onChange={(e) => setFormData({ ...formData, capacidade_cocho_kg: e.target.value })} className="h-9 text-xs" />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t mt-4">
          <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs" disabled={progresso.show}>Cancelar</Button>
          <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={progresso.show}>{progresso.show ? 'Salvando...' : item ? 'Salvar Alterações' : 'Salvar Ponto'}</Button>
        </div>
      </form>

      <Dialog open={progresso.show} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Salvando...</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-slate-600">{progresso.mensagem}</p>
            <Progress value={(progresso.atual / progresso.total) * 100} className="w-full h-1.5" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}