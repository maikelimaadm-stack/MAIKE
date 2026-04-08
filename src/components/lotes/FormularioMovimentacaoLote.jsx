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
import useSetorAreas from "@/hooks/useSetorAreas";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { calcularDiasPeriodo, fecharPeriodoSupplementacao } from "../utils/consumoUtils";
import { getTodayLocalDate } from "../utils/pecuariaUtils";

const FL = ({ label, required, children }) => (
  <div>
    <label className="text-[12px] text-slate-500 pl-1 leading-none">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors">
      {children}
    </div>
  </div>
);

export default function FormularioMovimentacaoLote({ lotesOriginais, areaOrigem, areaDestinoPreSelecionada, onSubmit, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [loading, setLoading] = useState(false);
  const [etapa, setEtapa] = useState('verificacao'); // 'verificacao', 'fechamento_consumo', 'movimentacao'
  const [eventosAbertos, setEventosAbertos] = useState([]);
  const [progresso, setProgresso] = useState({ show: false, atual: 0, total: 0, mensagem: '' });
  const { setores, areas, getAreasBySetor } = useSetorAreas(empresaSelecionadaId);

  const [formData, setFormData] = useState(() => {
    const areaDestino = areaDestinoPreSelecionada;

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

    const movimentacoesPre = Object.values(categoriasPorLote).map((cat) => ({
      categoria: cat.categoria,
      quantidade: cat.quantidade_total,
      peso_medio: cat.peso_medio,
      quantidade_maxima: cat.quantidade_total
    }));

    // Área de saída: priorizar areaOrigem, depois pegar do primeiro lote
    const areaSaidaId = areaOrigem?.id || lotesOriginais[0]?.area_atual_id || '';

    return {
      data_movimentacao: getTodayLocalDate(),
      mover_todos: 'sim',
      setor_saida_id: areaOrigem?.setor_id || '',
      area_saida_id: areaSaidaId,
      setor_entrada_id: '',
      area_entrada_id: areaDestino || '',
      movimentacoes: movimentacoesPre,
      sobras_cocho: {}
    };
  });

  React.useEffect(() => {
    if (!areaDestinoPreSelecionada) return;
    const areaDestino = areas.find((item) => item.id === areaDestinoPreSelecionada);
    setFormData((prev) => ({ ...prev, area_entrada_id: areaDestinoPreSelecionada, setor_entrada_id: areaDestino?.setor_id || prev.setor_entrada_id }));
  }, [areaDestinoPreSelecionada, areas]);

  React.useEffect(() => {
    const areaSaida = areas.find((item) => item.id === formData.area_saida_id);
    const areaEntrada = areas.find((item) => item.id === formData.area_entrada_id);
    setFormData((prev) => ({
      ...prev,
      setor_saida_id: areaSaida?.setor_id || prev.setor_saida_id,
      setor_entrada_id: areaEntrada?.setor_id || prev.setor_entrada_id,
    }));
  }, [areas, formData.area_saida_id, formData.area_entrada_id]);

  const areasSaida = formData.setor_saida_id ? getAreasBySetor(formData.setor_saida_id) : [];
  const areasEntrada = formData.setor_entrada_id ? getAreasBySetor(formData.setor_entrada_id).filter((item) => item.id !== formData.area_saida_id) : [];

  // Área de saída resolvida
  const areaSaidaResolvida = formData.area_saida_id || areaOrigem?.id || lotesOriginais[0]?.area_atual_id || '';

  // Verificar eventos abertos ao carregar
  React.useEffect(() => {
    const verificarEventosAbertos = async () => {
      if (!areaSaidaResolvida) return;

      try {
        const [todosPontos, todosEventos] = await Promise.all([
          base44.entities.PontoSuplementacao.list(),
          base44.entities.SuplementacaoEvento.list(),
        ]);

        const pontosById = todosPontos.reduce((acc, ponto) => {
          acc[ponto.id] = ponto;
          return acc;
        }, {});

        const abertos = todosEventos
          .filter((evento) => evento.empresa_id === empresaSelecionadaId)
          .filter((evento) => evento.dias_periodo === null || evento.dias_periodo === undefined)
          .filter((evento) => evento.area_id === areaSaidaResolvida || (Array.isArray(evento.area_ids) && evento.area_ids.includes(areaSaidaResolvida)))
          .map((evento) => ({
            ...evento,
            ponto_nome: pontosById[evento.ponto_suplementacao_id]?.nome_ponto || evento.ponto_nome || 'Cocho',
            ponto_id: evento.ponto_suplementacao_id,
          }));

        setEventosAbertos(abertos);

        if (abertos.length > 0) {
          setEtapa('fechamento_consumo');
          const sobrasIniciais = {};
          abertos.forEach((ev) => {
            sobrasIniciais[ev.id] = '0';
          });
          setFormData((prev) => ({ ...prev, sobras_cocho: sobrasIniciais }));
        } else {
          setEtapa('movimentacao');
        }
      } catch (error) {
        console.error('Erro ao verificar eventos:', error);
        setEtapa('movimentacao');
      }
    };

    verificarEventosAbertos();
  }, [areaSaidaResolvida, empresaSelecionadaId]);

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((i) => i.empresa_id === empresaSelecionadaId && i.ativo !== false);
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: todosLotes = [] } = useQuery({
    queryKey: ['lotes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter((l) => l.empresa_id === empresaSelecionadaId && l.status === 'Ativo');
    },
    enabled: !!empresaSelecionadaId
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



  const adicionarMovimentacao = () => {
    const primeiraCategoria = categorias[0];
    setFormData((prev) => ({
      ...prev,
      movimentacoes: [...prev.movimentacoes, {
        categoria: primeiraCategoria.categoria,
        quantidade: "",
        peso_medio: primeiraCategoria.peso_medio,
        quantidade_maxima: primeiraCategoria.quantidade_total
      }]
    }));
  };

  const categoriasDisponiveis = categorias.map((c) => c.categoria);
  const totaisSolicitadosPorCategoria = formData.movimentacoes.reduce((acc, item) => {
    const categoria = item.categoria;
    acc[categoria] = (acc[categoria] || 0) + (parseFloat(item.quantidade) || 0);
    return acc;
  }, {});

  const handleMovimentacaoChange = (index, field, value) => {
    const novasMovimentacoes = [...formData.movimentacoes];
    novasMovimentacoes[index] = {
      ...novasMovimentacoes[index],
      [field]: field === 'quantidade' || field === 'peso_medio' ? value === '' ? '' : parseFloat(value) || 0 : value
    };
    setFormData({ ...formData, movimentacoes: novasMovimentacoes });
  };

  const handleRemoveMovimentacao = (index) => {
    const novasMovimentacoes = formData.movimentacoes.filter((_, i) => i !== index);
    setFormData({ ...formData, movimentacoes: novasMovimentacoes });
  };

  const handleFecharEventos = async () => {
    if (loading) return;
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
        setProgresso({ show: true, atual: i * 2 + 1, total: eventosAbertos.length * 2, mensagem: `Fechando evento ${i + 1}/${eventosAbertos.length}...` });

        const sobra = parseFloat(formData.sobras_cocho[evento.id] || 0);
        const diasPeriodo = calcularDiasPeriodo(evento.data_lancamento, formData.data_movimentacao);
        const saldoFisicoMaximo = (evento.quantidade_total_kg || 0) + (evento.sobra_kg || 0);
        if (sobra < 0 || sobra > saldoFisicoMaximo) {
          throw new Error(`A sobra informada para ${evento.ponto_nome} está fora do limite físico do período.`);
        }

        setProgresso({ show: true, atual: i * 2 + 2, total: eventosAbertos.length * 2, mensagem: `Atualizando lotes ${i + 1}/${eventosAbertos.length}...` });

        await fecharPeriodoSupplementacao({
          evento,
          diasPeriodo,
          sobraInicial: evento.sobra_kg || 0,
          sobraFinal: sobra,
        });
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
    if (loading) return;

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

      const temQuantidadeInvalida = formData.movimentacoes.some((m) => !m.quantidade || m.quantidade <= 0);
      if (temQuantidadeInvalida) {
        alert('Todas as movimentações devem ter quantidade maior que zero');
        return;
      }

      const categoriasExcedidas = Object.entries(totaisSolicitadosPorCategoria).filter(([categoria, total]) => total > (categoriasPorLote[categoria]?.quantidade_total || 0));
      if (categoriasExcedidas.length > 0) {
        alert('A soma movimentada por categoria excede o total disponível em um ou mais grupos.');
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
      </Card>);

  }

  if (etapa === 'fechamento_consumo') {
    return (
      <Card className="shadow-sm">
        <CardHeader className="bg-amber-50 border-b py-3 border-amber-200">
          <CardTitle className="text-sm font-semibold text-amber-900">⚠️ Fechamento de Consumo Necessário</CardTitle>
        </CardHeader>
        <CardContent className="p-4 max-h-[calc(100vh-200px)] overflow-y-auto">
          <div className="space-y-4">
            {progresso.show &&
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-blue-900">{progresso.mensagem}</span>
                  <span className="text-xs text-blue-700">{progresso.atual}/{progresso.total}</span>
                </div>
                <div className="w-full bg-blue-200 rounded-full h-2">
                  <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progresso.atual / progresso.total * 100}%` }}>
                </div>
                </div>
              </div>
            }
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-3">
              <p className="text-xs text-amber-900 mb-2">
                <strong>Atenção:</strong> Existem {eventosAbertos.length} evento(s) de suplementação em aberto na área de origem.
              </p>
              <p className="text-xs text-amber-800">
                Para mover o gado, é necessário fechar esses períodos informando quanto sobrou no cocho.
              </p>
            </div>

            <div className="space-y-3">
              {eventosAbertos.map((evento) => {
                const diasPeriodo = calcularDiasPeriodo(evento.data_lancamento, formData.data_movimentacao);
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
                        required />

                      <p className="text-[10px] text-slate-500">
                        Informe 0 se não sobrou nada no cocho
                      </p>
                    </div>

                    <div className="mt-2 pt-2 border-t border-slate-200">
                      <div className="text-[10px] text-slate-700">
                        <strong>Consumo calculado:</strong>{' '}
                        {(evento.quantidade_total_kg - parseFloat(formData.sobras_cocho[evento.id] || 0) + parseFloat(evento.sobra_kg || 0)).toFixed(1)} kg
                      </div>
                    </div>
                  </div>);

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
                disabled={loading || progresso.show}>

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
              <Progress value={progresso.atual / progresso.total * 100} className="w-full h-1.5" />
            </div>
          </DialogContent>
        </Dialog>
      </Card>);

  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold">Movimentação de Lotes</CardTitle>
      </CardHeader>
      <CardContent className="p-2 max-h-[calc(100vh-200px)] overflow-y-auto">
        <form onSubmit={handleSubmit} className="space-y-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
            <FL label="Data da Movimentação" required>
              <Input type="date" value={formData.data_movimentacao} onChange={(e) => setFormData({ ...formData, data_movimentacao: e.target.value })} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" required />
            </FL>
            <div className="space-y-1">
              <label className="text-[12px] text-slate-500 pl-1 leading-none">Movimentar todo o lote? <span className="text-red-500">*</span></label>
              <RadioGroup value={formData.mover_todos} onValueChange={(v) => setFormData({ ...formData, mover_todos: v })} className="flex gap-4">
                <div className="flex items-center space-x-2"><RadioGroupItem value="sim" id="sim" /><Label htmlFor="sim" className="text-xs cursor-pointer">Sim</Label></div>
                <div className="flex items-center space-x-2"><RadioGroupItem value="nao" id="nao" /><Label htmlFor="nao" className="text-xs cursor-pointer">Não</Label></div>
              </RadioGroup>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
            <FL label="Setor de saída" required>
              <Select value={formData.setor_saida_id || '__none__'} onValueChange={(v) => setFormData({ ...formData, setor_saida_id: v === '__none__' ? '' : v, area_saida_id: '' })}>
                <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
                  <SelectValue placeholder="Selecione o setor de saída" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs">Selecione</SelectItem>
                  {setores.map((setor) =>
                  <SelectItem key={setor.id} value={setor.id} className="text-xs">{setor.nome}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </FL>
            <FL label="Área e módulo de saída" required>
              <Select
                value={formData.area_saida_id || '__none__'}
                onValueChange={(v) => setFormData({ ...formData, area_saida_id: v === '__none__' ? '' : v })}
                disabled={!formData.setor_saida_id}>

                <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
                  <SelectValue placeholder={formData.setor_saida_id ? 'Selecione a área de saída' : 'Selecione o setor primeiro'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs">Selecione</SelectItem>
                  {areasSaida.map((area) =>
                  <SelectItem key={area.id} value={area.id} className="text-xs">
                      {area.numero_area ? `${area.numero_area} - ${area.nome}` : area.nome}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </FL>
            <FL label="Setor de entrada" required>
              <Select value={formData.setor_entrada_id || '__none__'} onValueChange={(v) => setFormData({ ...formData, setor_entrada_id: v === '__none__' ? '' : v, area_entrada_id: '' })}>
                <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
                  <SelectValue placeholder="Selecione o setor de entrada" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs">Selecione</SelectItem>
                  {setores.map((setor) =>
                  <SelectItem key={setor.id} value={setor.id} className="text-xs">{setor.nome}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </FL>
            <FL label="Área e módulo de entrada" required>
              <Select
                value={formData.area_entrada_id || '__none__'}
                onValueChange={(v) => setFormData({ ...formData, area_entrada_id: v === '__none__' ? '' : v })}
                disabled={!formData.setor_entrada_id}>

                <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
                  <SelectValue placeholder={formData.setor_entrada_id ? 'Selecione a área de entrada' : 'Selecione o setor primeiro'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs">Selecione</SelectItem>
                  {areasEntrada.map((area) =>
                  <SelectItem key={area.id} value={area.id} className="text-xs">
                        {area.numero_area ? `${area.numero_area} - ${area.nome}` : area.nome}
                      </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </FL>
          </div>

          {formData.mover_todos === 'nao' &&
          <div className="space-y-2 max-h-[42vh] overflow-y-auto">
              {Object.entries(totaisSolicitadosPorCategoria).some(([categoria, total]) => total > (categoriasPorLote[categoria]?.quantidade_total || 0)) && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  A soma solicitada por categoria ultrapassa o total disponível em pelo menos um grupo.
                </div>
              )}
              {formData.movimentacoes.map((mov, index) => {
              const infoCategoria = categoriasPorLote[mov.categoria];
              const configIcone = iconesConfig.find((ic) =>
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
                      className="h-6 w-6 text-red-500 hover:text-red-700 hover:bg-red-50">

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
                    }}>

                      <SelectTrigger className="h-10 text-xs mb-3">
                        <SelectValue>
                          {infoCategoria?.quantidade_total || 0} cb - {mov.categoria}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {categoriasDisponiveis.map((cat) => {
                        const info = categoriasPorLote[cat];
                        return (
                          <SelectItem key={cat} value={cat} className="text-xs">
                              {info.quantidade_total} cb - {cat}
                            </SelectItem>);

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
                        className="h-8 text-xs"
                        placeholder="0"
                        required />

                        <span className="text-[10px] text-slate-500">Máximo: {mov.quantidade_maxima} cabeças</span>
                      </div>

                      










                    </div>
                  </div>);

            })}

              <Button
              type="button"
              onClick={adicionarMovimentacao}
              variant="outline"
              className="w-full h-8 text-xs border-dashed border-2 border-slate-300 hover:border-slate-400">
                Adicionar Categoria
              </Button>
            </div>
          }



          <div className="flex justify-end gap-1 pt-1 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs" disabled={loading}>Cancelar</Button>
            <Button type="submit" size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" disabled={loading}>{loading ? 'Movimentando...' : 'Confirmar Movimentação'}</Button>
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
            <Progress value={progresso.atual / progresso.total * 100} className="w-full h-1.5" />
          </div>
        </DialogContent>
      </Dialog>
    </Card>);

}