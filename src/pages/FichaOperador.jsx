import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tractor, MapPin, Clock, Fuel, User, Check, RotateCcw } from "lucide-react";
import { toast } from "sonner";

const TIPOS_OPERACAO = ["Gradagem", "Aração", "Plantio", "Pulverização", "Adubação", "Colheita", "Roçagem", "Calagem", "Dessecação", "Subsolagem", "Outro"];

export default function FichaOperador() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();
  const [enviado, setEnviado] = useState(false);

  const [formData, setFormData] = useState({
    operador: '',
    data_inicio: new Date().toISOString().split('T')[0],
    tipo_operacao: '',
    area_id: '',
    maquina_id: '',
    implemento_id: '',
    horimetro_inicio: '',
    horimetro_fim: '',
    hectares_trabalhados: '',
    combustivel_consumido: '',
    produto_aplicado: '',
    quantidade_produto: '',
    unidade_produto: '',
    observacoes: '',
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas-ficha', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: maquinas = [] } = useQuery({
    queryKey: ['maquinas-ficha', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Maquina.list();
      return all.filter(m => m.empresa_id === empresaSelecionadaId && m.status === 'Ativo');
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: abastecimentos = [] } = useQuery({
    queryKey: ['abastecimentos-ficha', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AbastecimentoMaquina.list('-data_abastecimento');
      return all.filter(a => a.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const implementos = maquinas.filter(m => m.tipo === 'Implemento');
  const maquinasOperacao = maquinas.filter(m => m.tipo !== 'Implemento');
  const maquinaSelecionada = maquinas.find(m => m.id === formData.maquina_id);

  // Buscar valor do combustível
  const getValorCombustivel = () => {
    if (!maquinaSelecionada) return 0;
    const abastMaquina = abastecimentos.filter(a => a.maquina_id === formData.maquina_id);
    if (abastMaquina.length > 0 && abastMaquina[0].valor_litro) {
      return abastMaquina[0].valor_litro;
    }
    const tipoComb = maquinaSelecionada.tipo_combustivel;
    if (tipoComb) {
      const abastTipo = abastecimentos.find(a => a.tipo_combustivel === tipoComb && a.valor_litro);
      if (abastTipo) return abastTipo.valor_litro;
    }
    return maquinaSelecionada.valor_combustivel_litro || 0;
  };

  const mutation = useMutation({
    mutationFn: async (data) => {
      const area = areas.find(a => a.id === data.area_id);
      const maquina = maquinas.find(m => m.id === data.maquina_id);
      const implemento = maquinas.find(m => m.id === data.implemento_id);

      // Calcular horas e custos
      const horasInicio = parseFloat(data.horimetro_inicio) || 0;
      const horasFim = parseFloat(data.horimetro_fim) || 0;
      const horasTrabalhadas = horasFim > horasInicio ? horasFim - horasInicio : 0;

      const consumoMedio = maquina?.consumo_medio || 0;
      const valorCombLitro = getValorCombustivel();
      const custoHoraMaquina = maquina?.custo_hora || 0;

      let combustivel = parseFloat(data.combustivel_consumido) || 0;
      if (!combustivel && horasTrabalhadas && consumoMedio) {
        combustivel = horasTrabalhadas * consumoMedio;
      }

      const valorCombustivel = combustivel * valorCombLitro;
      const custoMaquinaTotal = horasTrabalhadas * custoHoraMaquina;
      const custoTotal = valorCombustivel + custoMaquinaTotal;
      const hectares = parseFloat(data.hectares_trabalhados) || 0;
      const custoPorHectare = hectares > 0 ? custoTotal / hectares : 0;

      const payload = {
        empresa_id: empresaSelecionadaId,
        area_id: data.area_id,
        area_nome: area?.nome || '',
        maquina_id: data.maquina_id,
        maquina_nome: maquina?.nome || '',
        implemento_id: data.implemento_id || null,
        implemento_nome: implemento?.nome || '',
        tipo_operacao: data.tipo_operacao,
        data_inicio: data.data_inicio,
        operador: data.operador,
        horimetro_inicio: horasInicio || null,
        horimetro_fim: horasFim || null,
        horas_trabalhadas: horasTrabalhadas || null,
        hectares_trabalhados: hectares || null,
        combustivel_consumido: combustivel || null,
        valor_combustivel: valorCombustivel || null,
        custo_maquina_hora: custoHoraMaquina || null,
        custo_maquina_total: custoMaquinaTotal || null,
        custo_total: custoTotal || null,
        custo_por_hectare: custoPorHectare || null,
        produto_aplicado: data.produto_aplicado || null,
        quantidade_produto: data.quantidade_produto ? parseFloat(data.quantidade_produto) : null,
        unidade_produto: data.unidade_produto || null,
        observacoes: data.observacoes || null,
        status: 'Concluída',
      };

      // Atualizar horímetro da máquina
      if (maquina && horasFim > (maquina.horimetro_atual || 0)) {
        await base44.entities.Maquina.update(maquina.id, {
          horimetro_atual: horasFim
        });
      }

      return base44.entities.OperacaoAgricola.create(payload);
    },
    onSuccess: () => {
      setEnviado(true);
      queryClient.invalidateQueries({ queryKey: ['operacoes'] });
      toast.success('Ficha enviada com sucesso!');
    },
    onError: (error) => {
      toast.error('Erro ao enviar: ' + error.message);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.operador || !formData.tipo_operacao || !formData.area_id || !formData.maquina_id) {
      toast.error('Preencha todos os campos obrigatórios');
      return;
    }
    mutation.mutate(formData);
  };

  const handleNova = () => {
    setFormData({
      operador: formData.operador, // Manter operador
      data_inicio: new Date().toISOString().split('T')[0],
      tipo_operacao: '',
      area_id: '',
      maquina_id: '',
      implemento_id: '',
      horimetro_inicio: '',
      horimetro_fim: '',
      hectares_trabalhados: '',
      combustivel_consumido: '',
      produto_aplicado: '',
      quantidade_produto: '',
      unidade_produto: '',
      observacoes: '',
    });
    setEnviado(false);
  };

  if (enviado) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-8 pb-6">
            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-10 h-10 text-slate-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Ficha Enviada!</h2>
            <p className="text-slate-600 mb-6">A operação foi registrada com sucesso.</p>
            <Button onClick={handleNova} className="w-full gap-2 bg-slate-700 hover:bg-slate-800">
              <RotateCcw className="w-4 h-4" />
              Nova Ficha
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4">
      <div className="max-w-lg mx-auto">
        <Card className="shadow-lg">
          <CardHeader className="bg-slate-700 text-white rounded-t-lg">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Tractor className="w-5 h-5" />
              Ficha de Operação
            </CardTitle>
            <p className="text-slate-100 text-sm">Preencha os dados da operação realizada</p>
          </CardHeader>

          <CardContent className="p-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              
              {/* Operador e Data */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2 mb-3">
                  <User className="w-4 h-4 text-slate-600" />
                  <span className="text-sm font-semibold text-slate-900">Identificação</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-medium">Operador *</Label>
                    <Input
                      value={formData.operador}
                      onChange={(e) => setFormData({ ...formData, operador: e.target.value })}
                      placeholder="Seu nome"
                      className="h-10 text-base"
                      required
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Data *</Label>
                    <Input
                      type="date"
                      value={formData.data_inicio}
                      onChange={(e) => setFormData({ ...formData, data_inicio: e.target.value })}
                      className="h-10 text-base"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Operação */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2 mb-3">
                  <Tractor className="w-4 h-4 text-slate-600" />
                  <span className="text-sm font-semibold text-slate-900">Operação</span>
                </div>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs font-medium">Tipo de Operação *</Label>
                    <Select value={formData.tipo_operacao} onValueChange={(v) => setFormData({ ...formData, tipo_operacao: v })}>
                      <SelectTrigger className="h-10 text-base">
                        <SelectValue placeholder="Selecione o tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        {TIPOS_OPERACAO.map(t => <SelectItem key={t} value={t} className="text-base">{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Área *</Label>
                    <Select value={formData.area_id} onValueChange={(v) => setFormData({ ...formData, area_id: v })}>
                      <SelectTrigger className="h-10 text-base">
                        <SelectValue placeholder="Selecione a área" />
                      </SelectTrigger>
                      <SelectContent>
                        {areas.map(a => <SelectItem key={a.id} value={a.id} className="text-base">{a.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Máquina */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2 mb-3">
                  <Tractor className="w-4 h-4 text-slate-600" />
                  <span className="text-sm font-semibold text-slate-900">Máquina / Equipamento</span>
                </div>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs font-medium">Máquina *</Label>
                    <Select value={formData.maquina_id} onValueChange={(v) => setFormData({ ...formData, maquina_id: v })}>
                      <SelectTrigger className="h-10 text-base">
                        <SelectValue placeholder="Selecione a máquina" />
                      </SelectTrigger>
                      <SelectContent>
                        {maquinasOperacao.map(m => (
                          <SelectItem key={m.id} value={m.id} className="text-base">
                            {m.nome} {m.horimetro_atual ? `(${m.horimetro_atual}h)` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Implemento</Label>
                    <Select value={formData.implemento_id} onValueChange={(v) => setFormData({ ...formData, implemento_id: v })}>
                      <SelectTrigger className="h-10 text-base">
                        <SelectValue placeholder="Selecione (opcional)" />
                      </SelectTrigger>
                      <SelectContent>
                        {implementos.map(i => <SelectItem key={i.id} value={i.id} className="text-base">{i.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Horímetro */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-4 h-4 text-slate-600" />
                  <span className="text-sm font-semibold text-slate-900">Horímetro</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-medium">Início</Label>
                    <Input
                      type="number"
                      value={formData.horimetro_inicio}
                      onChange={(e) => setFormData({ ...formData, horimetro_inicio: e.target.value })}
                      placeholder={maquinaSelecionada?.horimetro_atual ? `Atual: ${maquinaSelecionada.horimetro_atual}` : 'Horas'}
                      className="h-10 text-base"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Final</Label>
                    <Input
                      type="number"
                      value={formData.horimetro_fim}
                      onChange={(e) => setFormData({ ...formData, horimetro_fim: e.target.value })}
                      placeholder="Horas"
                      className="h-10 text-base"
                    />
                  </div>
                </div>
                {formData.horimetro_inicio && formData.horimetro_fim && (
                  <div className="mt-2 text-center text-sm font-semibold text-slate-700">
                    Total: {(parseFloat(formData.horimetro_fim) - parseFloat(formData.horimetro_inicio)).toFixed(1)} horas
                  </div>
                )}
              </div>

              {/* Área e Combustível */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2 mb-3">
                  <MapPin className="w-4 h-4 text-slate-600" />
                  <span className="text-sm font-semibold text-slate-900">Produção</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-medium">Hectares</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={formData.hectares_trabalhados}
                      onChange={(e) => setFormData({ ...formData, hectares_trabalhados: e.target.value })}
                      placeholder="ha"
                      className="h-10 text-base"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Combustível (L)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={formData.combustivel_consumido}
                      onChange={(e) => setFormData({ ...formData, combustivel_consumido: e.target.value })}
                      placeholder="Litros"
                      className="h-10 text-base"
                    />
                  </div>
                </div>
              </div>

              {/* Produto Aplicado */}
              {(formData.tipo_operacao === 'Pulverização' || formData.tipo_operacao === 'Adubação' || formData.tipo_operacao === 'Calagem' || formData.tipo_operacao === 'Plantio') && (
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="flex items-center gap-2 mb-3">
                    <Fuel className="w-4 h-4 text-slate-600" />
                    <span className="text-sm font-semibold text-slate-900">Produto Aplicado</span>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs font-medium">Produto</Label>
                      <Input
                        value={formData.produto_aplicado}
                        onChange={(e) => setFormData({ ...formData, produto_aplicado: e.target.value })}
                        placeholder="Nome do produto"
                        className="h-10 text-base"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-medium">Quantidade</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={formData.quantidade_produto}
                          onChange={(e) => setFormData({ ...formData, quantidade_produto: e.target.value })}
                          placeholder="Qtd"
                          className="h-10 text-base"
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-medium">Unidade</Label>
                        <Input
                          value={formData.unidade_produto}
                          onChange={(e) => setFormData({ ...formData, unidade_produto: e.target.value })}
                          placeholder="kg, L, sc"
                          className="h-10 text-base"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Observações */}
              <div>
                <Label className="text-xs font-medium">Observações</Label>
                <Textarea
                  value={formData.observacoes}
                  onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                  placeholder="Alguma observação importante?"
                  rows={2}
                  className="text-base"
                />
              </div>

              {/* Botão Enviar */}
              <Button 
                type="submit" 
                disabled={mutation.isPending}
                className="w-full h-12 text-base font-semibold bg-slate-700 hover:bg-slate-800"
              >
                {mutation.isPending ? 'Enviando...' : 'Enviar Ficha'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}