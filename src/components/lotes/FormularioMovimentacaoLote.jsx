import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { X, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

export default function FormularioMovimentacaoLote({ lotesOriginais, areaOrigem, onSubmit, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [loading, setLoading] = useState(false);
  const [etapa, setEtapa] = useState('verificacao'); // 'verificacao', 'fechamento_consumo', 'movimentacao'
  const [eventosAbertos, setEventosAbertos] = useState([]);
  const [progresso, setProgresso] = useState({ show: false, atual: 0, total: 0, mensagem: '' });

  const [formData, setFormData] = useState(() => {
    const areaDestino = window.areaDestinoArrastada;
    
    // Agrupar lotes por categoria e pré-preencher movimentações
    const categoriasPorLote = lotesOriginais.reduce((acc, lote) => {
      const cat = lote.categoria?.toUpperCase() || 'SEM CATEGORIA';
      if (!acc[cat]) {
        acc[cat] = {
          categoria: cat,
          quantidade_total: 0,
          peso_medio: lote.peso_medio_kg || 0,
          lotes: []
        };
      }
      acc[cat].quantidade_total += lote.quantidade_cabecas || 0;
      acc[cat].lotes.push(lote);
      return acc;
    }, {});
    
    const movimentacoesPre = Object.values(categoriasPorLote).map(cat => ({
      categoria: cat.categoria,
      quantidade: cat.quantidade_total,
      peso_medio: cat.peso_medio,
      quantidade_maxima: cat.quantidade_total
    }));
    
    return {
      data_movimentacao: new Date().toISOString().split('T')[0],
      mover_todos: 'sim',
      area_saida_id: areaOrigem?.id || '',
      area_entrada_id: areaDestino || '',
      movimentacoes: movimentacoesPre,
      unir_lotes: {},
      sobras_cocho: {}
    };
  });

  // Verificar eventos abertos ao carregar
  React.useEffect(() => {
    const verificarEventosAbertos = async () => {
      if (!areaOrigem?.id) return;
      
      try {
        const todosPontos = await base44.entities.PontoSuplementacao.list();
        const pontosArea = todosPontos.filter(p => 
          p.empresa_id === empresaSelecionadaId && 
          p.area_vinculada_id === areaOrigem.id &&
          p.status === 'Ativo'
        );

        const todosEventos = await base44.entities.SuplementacaoEvento.list();
        const abertos = [];

        for (const ponto of pontosArea) {
          const eventoAberto = todosEventos.find(e => 
            e.ponto_suplementacao_id === ponto.id && 
            (e.dias_periodo === null || e.dias_periodo === undefined)
          );
          
          if (eventoAberto) {
            abertos.push({
              ...eventoAberto,
              ponto_nome: ponto.nome_ponto,
              ponto_id: ponto.id
            });
          }
        }

        setEventosAbertos(abertos);
        
        if (abertos.length > 0) {
          setEtapa('fechamento_consumo');
          // Inicializar sobras como 0
          const sobrasIniciais = {};
          abertos.forEach(ev => {
            sobrasIniciais[ev.id] = '0';
          });
          setFormData(prev => ({ ...prev, sobras_cocho: sobrasIniciais }));
        } else {
          setEtapa('movimentacao');
        }
      } catch (error) {
        console.error('Erro ao verificar eventos:', error);
        setEtapa('movimentacao');
      }
    };

    verificarEventosAbertos();
  }, [areaOrigem?.id, empresaSelecionadaId]);

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter(i => i.empresa_id === empresaSelecionadaId && i.ativo !== false);
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

  const { data: todosLotes = [] } = useQuery({
    queryKey: ['lotes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter(l => l.empresa_id === empresaSelecionadaId && l.status === 'Ativo');
    },
    enabled: !!empresaSelecionadaId,
  });

  // Agrupar lotes por categoria
  const categoriasPorLote = lotesOriginais.reduce((acc, lote) => {
    const cat = lote.categoria?.toUpperCase() || 'SEM CATEGORIA';
    if (!acc[cat]) {
      acc[cat] = {
        categoria: cat,
        quantidade_total: 0,
        peso_medio: lote.peso_medio_kg || 0,
        lotes: []
      };
    }
    acc[cat].quantidade_total += lote.quantidade_cabecas || 0;
    acc[cat].lotes.push(lote);
    return acc;
  }, {});

  const categorias = Object.values(categoriasPorLote);

  // Verificar se há lotes com mesma categoria na área de destino
  const categoriasComLotesExistentes = React.useMemo(() => {
    if (!formData.area_entrada_id) return {};
    
    const lotesNaArea = todosLotes.filter(l => l.area_atual_id === formData.area_entrada_id);
    const resultado = {};
    
    categorias.forEach(cat => {
      const loteExistente = lotesNaArea.find(l => l.categoria?.toUpperCase() === cat.categoria);
      if (loteExistente) {
        resultado[cat.categoria] = {
          lote: loteExistente
        };
      }
    });
    
    return resultado;
  }, [formData.area_entrada_id, todosLotes, categorias]);

  const adicionarMovimentacao = () => {
    const primeiraCategoria = categorias[0];
    setFormData(prev => ({
      ...prev,
      movimentacoes: [...prev.movimentacoes, {
        categoria: primeiraCategoria.categoria,
        quantidade: "",
        peso_medio: primeiraCategoria.peso_medio,
        quantidade_maxima: primeiraCategoria.quantidade_total
      }]
    }));
  };

  const categoriasDisponiveis = categorias.map(c => c.categoria);

  const handleMovimentacaoChange = (index, field, value) => {
    const novasMovimentacoes = [...formData.movimentacoes];
    novasMovimentacoes[index] = {
      ...novasMovimentacoes[index],
      [field]: field === 'quantidade' || field === 'peso_medio' ? (value === '' ? '' : parseFloat(value) || 0) : value
    };
    setFormData({ ...formData, movimentacoes: novasMovimentacoes });
  };

  const handleRemoveMovimentacao = (index) => {
    const novasMovimentacoes = formData.movimentacoes.filter((_, i) => i !== index);
    setFormData({ ...formData, movimentacoes: novasMovimentacoes });
  };

  const handleFecharEventos = async () => {
    setLoading(true);
    try {
      const totalPassos = eventosAbertos.reduce((sum, ev) => {
        const todosLotesSupl = [];
        return sum + 1 + todosLotesSupl.length;
      }, 0);
      let passoAtual = 0;

      setProgresso({ show: true, atual: 0, total: eventosAbertos.length * 2, mensagem: 'Iniciando fechamento...' });

      for (let i = 0; i < eventosAbertos.length; i++) {
        const evento = eventosAbertos[i];
        setProgresso({ show: true, atual: i * 2 + 1, total: eventosAbertos.length * 2, mensagem: `Fechando evento ${i+1}/${eventosAbertos.length}...` });
        
        const sobra = parseFloat(formData.sobras_cocho[evento.id] || 0);
        const diasPeriodo = Math.max(1, Math.ceil((new Date(formData.data_movimentacao) - new Date(evento.data_lancamento)) / (1000 * 60 * 60 * 24)));
        const quantidadeConsumida = evento.quantidade_total_kg - sobra;
        const consumoDiario = quantidadeConsumida / diasPeriodo;

        await base44.entities.SuplementacaoEvento.update(evento.id, {
          sobra_kg: sobra,
          dias_periodo: diasPeriodo,
          consumo_diario_grupo_kg: consumoDiario
        });

        setProgresso({ show: true, atual: i * 2 + 2, total: eventosAbertos.length * 2, mensagem: `Atualizando lotes ${i+1}/${eventosAbertos.length}...` });
        
        const todosLotesSupl = await base44.entities.SuplementacaoLote.list();
        const lotesDoEvento = todosLotesSupl.filter(l => l.suplementacao_evento_id === evento.id);

        for (const loteSupl of lotesDoEvento) {
          const consumoUnitario = evento.peso_total_consumo > 0 
            ? quantidadeConsumida / (diasPeriodo * evento.peso_total_consumo)
            : 0;
          const consumoPorCabecaDia = consumoUnitario * (loteSupl.fator_consumo || 1.0);
          const consumoTotalPeriodo = consumoPorCabecaDia * loteSupl.cabecas_na_area * diasPeriodo;

          await base44.entities.SuplementacaoLote.update(loteSupl.id, {
            dias_periodo: diasPeriodo,
            consumo_unitario_dia: consumoUnitario,
            consumo_por_cabeca_dia_kg: consumoPorCabecaDia,
            consumo_total_lote_periodo_kg: consumoTotalPeriodo
          });
        }
      }

      setProgresso({ show: true, atual: eventosAbertos.length * 2, total: eventosAbertos.length * 2, mensagem: 'Concluído!' });
      
      setTimeout(() => {
        setProgresso({ show: false, atual: 0, total: 0, mensagem: '' });
        setEtapa('movimentacao');
      }, 500);
      
    } catch (error) {
      console.error('Erro ao fechar eventos:', error);
      setProgresso({ show: false, atual: 0, total: 0, mensagem: '' });
      alert('Erro ao fechar períodos de consumo');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.area_saida_id) {
      alert('Selecione a área de saída');
      return;
    }

    if (!formData.area_entrada_id) {
      alert('Selecione a área de entrada');
      return;
    }

    if (formData.mover_todos === 'nao') {
      if (formData.movimentacoes.length === 0) {
        alert('Adicione pelo menos uma movimentação');
        return;
      }
      
      const temQuantidadeInvalida = formData.movimentacoes.some(m => !m.quantidade || m.quantidade <= 0);
      if (temQuantidadeInvalida) {
        alert('Todas as movimentações devem ter quantidade maior que zero');
        return;
      }
    }

    console.log('Enviando movimentação:', formData);
    setLoading(true);
    try {
      await onSubmit(formData);
    } finally {
      setLoading(false);
    }
  };

  if (etapa === 'verificacao') {
    return (
      <Card className="shadow-sm">
        <CardHeader className="bg-slate-50 border-b py-3">
          <CardTitle className="text-sm font-semibold">Verificando Suplementação...</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900 mx-auto"></div>
            <p className="text-xs text-slate-600 mt-4">Verificando eventos de suplementação abertos...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (etapa === 'fechamento_consumo') {
    return (
      <Card className="shadow-sm">
        <CardHeader className="bg-amber-50 border-b py-3 border-amber-200">
          <CardTitle className="text-sm font-semibold text-amber-900">⚠️ Fechamento de Consumo Necessário</CardTitle>
        </CardHeader>
        <CardContent className="p-4 max-h-[calc(100vh-200px)] overflow-y-auto">
          <div className="space-y-4">
            {progresso.show && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-blue-900">{progresso.mensagem}</span>
                  <span className="text-xs text-blue-700">{progresso.atual}/{progresso.total}</span>
                </div>
                <div className="w-full bg-blue-200 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(progresso.atual / progresso.total) * 100}%` }}
                  ></div>
                </div>
              </div>
            )}
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-3">
              <p className="text-xs text-amber-900 mb-2">
                <strong>Atenção:</strong> Existem {eventosAbertos.length} evento(s) de suplementação em aberto na área de origem.
              </p>
              <p className="text-xs text-amber-800">
                Para mover o gado, é necessário fechar esses períodos informando quanto sobrou no cocho.
              </p>
            </div>

            <div className="space-y-3">
              {eventosAbertos.map(evento => {
                const diasPeriodo = Math.max(1, Math.ceil((new Date(formData.data_movimentacao) - new Date(evento.data_lancamento)) / (1000 * 60 * 60 * 24)));
                return (
                  <div key={evento.id} className="border border-slate-200 rounded-lg p-3 bg-white">
                    <div className="mb-3">
                      <div className="text-xs font-semibold text-slate-900">{evento.ponto_nome}</div>
                      <div className="text-[10px] text-slate-600 mt-1 space-y-0.5">
                        <div>Lançamento: {new Date(evento.data_lancamento).toLocaleDateString()}</div>
                        <div>Produto: {evento.produto}</div>
                        <div>Quantidade fornecida: {evento.quantidade_total_kg.toFixed(1)} kg</div>
                        <div className="font-semibold text-blue-700">Período: {diasPeriodo} dia(s)</div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-semibold text-slate-700">
                        Sobra no cocho (kg) *
                      </Label>
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        max={evento.quantidade_total_kg}
                        value={formData.sobras_cocho[evento.id] || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          sobras_cocho: {
                            ...formData.sobras_cocho,
                            [evento.id]: e.target.value
                          }
                        })}
                        className="h-9 text-xs"
                        placeholder="0.0"
                        required
                      />
                      <p className="text-[10px] text-slate-500">
                        Informe 0 se não sobrou nada no cocho
                      </p>
                    </div>

                    <div className="mt-2 pt-2 border-t border-slate-200">
                      <div className="text-[10px] text-slate-700">
                        <strong>Consumo calculado:</strong>{' '}
                        {(evento.quantidade_total_kg - parseFloat(formData.sobras_cocho[evento.id] || 0)).toFixed(1)} kg
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs" disabled={loading || progresso.show}>
                Cancelar
              </Button>
              <Button 
                type="button" 
                onClick={handleFecharEventos}
                size="sm" 
                className="h-8 text-xs bg-amber-600 hover:bg-amber-700" 
                disabled={loading || progresso.show}
              >
                {loading || progresso.show ? 'Fechando...' : 'Fechar Consumos e Continuar'}
              </Button>
            </div>
          </div>
        </CardContent>

        <Dialog open={progresso.show} onOpenChange={() => {}}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm">Processando...</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <p className="text-xs text-slate-600">{progresso.mensagem}</p>
              <Progress value={(progresso.atual / progresso.total) * 100} className="w-full h-1.5" />
            </div>
          </DialogContent>
        </Dialog>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">Movimentação de Lotes</CardTitle>
      </CardHeader>
      <CardContent className="p-4 max-h-[calc(100vh-200px)] overflow-y-auto">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Data da Movimentação *</Label>
              <Input
                type="date"
                value={formData.data_movimentacao}
                onChange={(e) => setFormData({ ...formData, data_movimentacao: e.target.value })}
                className="h-8 text-xs"
                required
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Movimentar todo o lote? *</Label>
              <RadioGroup
                value={formData.mover_todos}
                onValueChange={(v) => setFormData({ ...formData, mover_todos: v })}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="sim" id="sim" />
                  <Label htmlFor="sim" className="text-xs cursor-pointer">Sim</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="nao" id="nao" />
                  <Label htmlFor="nao" className="text-xs cursor-pointer">Não</Label>
                </div>
              </RadioGroup>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Área e módulo de saída *</Label>
              <Select
                value={formData.area_saida_id}
                onValueChange={(v) => setFormData({ ...formData, area_saida_id: v })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione a área de saída" />
                </SelectTrigger>
                <SelectContent>
                  {areas.map(area => (
                    <SelectItem key={area.id} value={area.id} className="text-xs">
                      {area.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Área e módulo de entrada *</Label>
              <Select
                value={formData.area_entrada_id}
                onValueChange={(v) => setFormData({ ...formData, area_entrada_id: v })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione a área de entrada" />
                </SelectTrigger>
                <SelectContent>
                  {areas
                    .filter(a => a.id !== formData.area_saida_id)
                    .map(area => (
                      <SelectItem key={area.id} value={area.id} className="text-xs">
                        {area.nome}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {formData.mover_todos === 'nao' && (
            <div className="space-y-2 max-h-[45vh] overflow-y-auto">
              {formData.movimentacoes.map((mov, index) => {
                const infoCategoria = categoriasPorLote[mov.categoria];
                const configIcone = iconesConfig.find(ic => 
                  ic.tipo_entidade === 'Lote' && 
                  ic.categoria?.toUpperCase() === mov.categoria?.toUpperCase()
                );
                const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

                return (
                  <div key={index} className="border border-slate-200 rounded-lg p-3 bg-white">
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-xs font-semibold">Categoria</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveMovimentacao(index)}
                        className="h-6 w-6 text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>

                    <Select
                      value={mov.categoria}
                      onValueChange={(v) => {
                        const cat = categoriasPorLote[v];
                        handleMovimentacaoChange(index, 'categoria', v);
                        handleMovimentacaoChange(index, 'quantidade_maxima', cat.quantidade_total);
                        handleMovimentacaoChange(index, 'peso_medio', cat.peso_medio);
                      }}
                    >
                      <SelectTrigger className="h-10 text-xs mb-3">
                        <SelectValue>
                          {infoCategoria?.quantidade_total || 0} cb - {mov.categoria}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {categoriasDisponiveis.map(cat => {
                          const info = categoriasPorLote[cat];
                          return (
                            <SelectItem key={cat} value={cat} className="text-xs">
                              {info.quantidade_total} cb - {cat}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>

                    <div className="space-y-2">
                      <div>
                        <Label className="text-xs text-slate-600">Quantidade *</Label>
                        <Input
                          type="number"
                          value={mov.quantidade}
                          onChange={(e) => {
                            const valor = e.target.value;
                            if (valor === '' || parseFloat(valor) <= mov.quantidade_maxima) {
                              handleMovimentacaoChange(index, 'quantidade', valor);
                            }
                          }}
                          max={mov.quantidade_maxima}
                          className="h-10 text-xs"
                          placeholder="0"
                          required
                        />
                        <span className="text-[10px] text-slate-500">Máximo: {mov.quantidade_maxima} cabeças</span>
                      </div>

                      <div>
                        <Label className="text-xs text-slate-600">Peso Médio (kg)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={mov.peso_medio}
                          onChange={(e) => handleMovimentacaoChange(index, 'peso_medio', e.target.value)}
                          className="h-10 text-xs"
                          placeholder="0"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}

              <Button
                type="button"
                onClick={adicionarMovimentacao}
                variant="outline"
                className="w-full h-10 text-xs border-dashed border-2 border-slate-300 hover:border-slate-400"
              >
                <Plus className="w-4 h-4 mr-2" />
                Adicionar Categoria
              </Button>
            </div>
          )}

          {Object.keys(categoriasComLotesExistentes).length > 0 && (
            <div className="border border-amber-300 rounded p-3 bg-amber-50">
              <div className="text-xs font-semibold text-amber-800 mb-3 flex items-center gap-2">
                <span className="text-lg">⚠️</span>
                Existem lotes com mesma categoria na área de destino
              </div>
              <div className="space-y-3">
                {Object.entries(categoriasComLotesExistentes).map(([categoria, info]) => (
                  <div key={categoria} className="bg-white border rounded p-3">
                    <div className="text-xs font-semibold text-slate-700 mb-2">{categoria}</div>
                    <div className="text-[10px] text-slate-600 mb-2">
                      • {info.lote.nome} ({info.lote.quantidade_cabecas} cabeças)
                    </div>
                    <div className="mt-2">
                      <Label className="text-xs mb-2 block">Deseja unir ao lote existente?</Label>
                      <RadioGroup
                        value={formData.unir_lotes[categoria] || 'nao'}
                        onValueChange={(v) => setFormData({ 
                          ...formData, 
                          unir_lotes: { ...formData.unir_lotes, [categoria]: v }
                        })}
                        className="flex gap-4"
                      >
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="sim" id={`unir-sim-${categoria}`} />
                          <Label htmlFor={`unir-sim-${categoria}`} className="text-xs cursor-pointer">Sim, unir</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="nao" id={`unir-nao-${categoria}`} />
                          <Label htmlFor={`unir-nao-${categoria}`} className="text-xs cursor-pointer">Não, criar novo</Label>
                        </div>
                      </RadioGroup>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs" disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={loading}>
              {loading ? 'Movimentando...' : 'Confirmar Movimentação'}
            </Button>
          </div>
        </form>
      </CardContent>

      <Dialog open={progresso.show} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Processando...</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-slate-600">{progresso.mensagem}</p>
            <Progress value={(progresso.atual / progresso.total) * 100} className="w-full h-1.5" />
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}