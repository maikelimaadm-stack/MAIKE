import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function FormularioLancamentoSuplementacao({ ponto, onSubmit, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [progresso, setProgresso] = useState({ show: false, atual: 0, total: 0, mensagem: '' });
  
  const [formData, setFormData] = useState({
    data_lancamento: new Date().toISOString().split('T')[0],
    produto: ponto?.produto_padrao || "",
    quantidade_total_kg: "",
    sobra_kg: "0",
    observacoes: ""
  });

  const { data: lotes = [], isLoading: loadingLotes } = useQuery({
    queryKey: ['lotes-area', ponto?.area_vinculada_id],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter(l => 
        l.empresa_id === empresaSelecionadaId && 
        l.area_atual_id === ponto?.area_vinculada_id &&
        l.status === 'Ativo'
      );
    },
    enabled: !!empresaSelecionadaId && !!ponto?.area_vinculada_id,
  });

  const { data: fatores = [] } = useQuery({
    queryKey: ['fatores-consumo', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.FatorConsumoCategoria.list();
      return all.filter(f => f.empresa_id === empresaSelecionadaId && f.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: ultimoEvento } = useQuery({
    queryKey: ['ultimo-evento-ponto', ponto?.id],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoEvento.list();
      const eventosPonto = all
        .filter(e => e.ponto_suplementacao_id === ponto?.id)
        .sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento));
      return eventosPonto[0] || null;
    },
    enabled: !!ponto?.id,
  });

  const { data: produtosSuplementacao = [] } = useQuery({
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

  const totalCabecas = lotes.reduce((sum, lote) => sum + (lote.quantidade_cabecas || 0), 0);

  const diasPeriodo = ultimoEvento 
    ? Math.max(1, Math.ceil((new Date(formData.data_lancamento) - new Date(ultimoEvento.data_lancamento)) / (1000 * 60 * 60 * 24)))
    : null;

  const pesoTotalConsumo = lotes.reduce((sum, lote) => {
    const categoriaLote = lote.categoria?.toUpperCase().trim();
    const fator = fatores.find(f => f.categoria?.toUpperCase().trim() === categoriaLote)?.fator || 1.0;
    return sum + (lote.quantidade_cabecas * fator);
  }, 0);

  const handleSalvar = async () => {
    // Validações
    if (!formData.produto) {
      toast.error("Selecione um produto");
      return;
    }

    if (!formData.quantidade_total_kg || parseFloat(formData.quantidade_total_kg) <= 0) {
      toast.error("Informe a quantidade fornecida");
      return;
    }
    
    if (totalCabecas === 0) {
      toast.error("Não há lotes ativos na área");
      return;
    }

    try {
      const totalPassos = ultimoEvento ? 2 + lotes.length : 1 + lotes.length;
      let passoAtual = 0;

      setProgresso({ show: true, atual: 0, total: totalPassos, mensagem: 'Iniciando registro...' });

      // PASSO 1: Se existe evento anterior, fechar o período dele
      if (ultimoEvento && diasPeriodo > 0) {
        setProgresso({ show: true, atual: ++passoAtual, total: totalPassos, mensagem: 'Fechando período anterior...' });
        
        const quantidadeConsumidaAnterior = ultimoEvento.quantidade_total_kg - (ultimoEvento.sobra_kg || 0);
        const consumoDiarioAnterior = quantidadeConsumidaAnterior / diasPeriodo;
        const consumoUnitarioAnterior = ultimoEvento.peso_total_consumo > 0 
          ? quantidadeConsumidaAnterior / (diasPeriodo * ultimoEvento.peso_total_consumo)
          : 0;

        await base44.entities.SuplementacaoEvento.update(ultimoEvento.id, {
          dias_periodo: diasPeriodo,
          consumo_diario_grupo_kg: consumoDiarioAnterior
        });

        const todosLotes = await base44.entities.SuplementacaoLote.list();
        const lotesDoEventoAnterior = todosLotes.filter(l => l.suplementacao_evento_id === ultimoEvento.id);

        for (const loteAnterior of lotesDoEventoAnterior) {
          const fatorLote = loteAnterior.fator_consumo || 1.0;
          const consumoPorCabecaDia = consumoUnitarioAnterior * fatorLote;
          const consumoTotalPeriodo = consumoPorCabecaDia * loteAnterior.cabecas_na_area * diasPeriodo;

          await base44.entities.SuplementacaoLote.update(loteAnterior.id, {
            dias_periodo: diasPeriodo,
            consumo_unitario_dia: consumoUnitarioAnterior,
            consumo_por_cabeca_dia_kg: consumoPorCabecaDia,
            consumo_total_lote_periodo_kg: consumoTotalPeriodo
          });
        }
      }

      // PASSO 2: Criar novo evento
      setProgresso({ show: true, atual: ++passoAtual, total: totalPassos, mensagem: 'Criando novo evento...' });
      
      const novoEvento = await base44.entities.SuplementacaoEvento.create({
        empresa_id: empresaSelecionadaId,
        ponto_suplementacao_id: ponto.id,
        ponto_nome: ponto.nome_ponto,
        area_id: ponto.area_vinculada_id,
        area_nome: ponto.area_vinculada_nome,
        data_lancamento: formData.data_lancamento,
        produto: formData.produto,
        quantidade_total_kg: parseFloat(formData.quantidade_total_kg),
        sobra_kg: parseFloat(formData.sobra_kg || 0),
        dias_periodo: null,
        consumo_diario_grupo_kg: null,
        total_cabecas_afetadas: totalCabecas,
        peso_total_consumo: pesoTotalConsumo,
        observacoes: formData.observacoes
      });

      // PASSO 3: Criar registros de lotes
      for (let i = 0; i < lotes.length; i++) {
        const lote = lotes[i];
        setProgresso({ show: true, atual: ++passoAtual, total: totalPassos, mensagem: `Registrando lote ${i+1}/${lotes.length}...` });
        
        const categoriaLote = lote.categoria?.toUpperCase().trim();
        const fator = fatores.find(f => f.categoria?.toUpperCase().trim() === categoriaLote)?.fator || 1.0;
        const pesoConsumoLote = lote.quantidade_cabecas * fator;

        await base44.entities.SuplementacaoLote.create({
          empresa_id: empresaSelecionadaId,
          suplementacao_evento_id: novoEvento.id,
          lote_id: lote.id,
          lote_nome: lote.nome,
          categoria: lote.categoria,
          fator_consumo: fator,
          data_lancamento: formData.data_lancamento,
          produto: formData.produto,
          cabecas_na_area: lote.quantidade_cabecas,
          peso_consumo_lote: pesoConsumoLote,
          dias_periodo: null,
          consumo_unitario_dia: null,
          consumo_por_cabeca_dia_kg: null,
          consumo_total_lote_periodo_kg: null
        });
      }

      setProgresso({ show: true, atual: totalPassos, total: totalPassos, mensagem: 'Concluído!' });
      toast.success("✅ Suplementação registrada!");
      
      setTimeout(() => {
        setProgresso({ show: false, atual: 0, total: 0, mensagem: '' });
        onCancel();
      }, 500);
      
    } catch (error) {
      console.error('Erro ao registrar:', error);
      setProgresso({ show: false, atual: 0, total: 0, mensagem: '' });
      toast.error("❌ Erro: " + error.message);
    }
  };

  const botaoHabilitado = totalCabecas > 0 && formData.produto && formData.quantidade_total_kg;

  return (
    <>
    <Card>
      <CardHeader className="bg-slate-50 border-b py-3">
        <CardTitle className="text-sm font-semibold text-slate-900">
          Lançar Suplementação - {ponto?.nome_ponto}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 max-h-[calc(100vh-200px)] overflow-y-auto">
        <div className="space-y-3">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-slate-600">Área:</span>
                <span className="font-semibold text-slate-900 ml-2">{ponto?.area_vinculada_nome}</span>
              </div>
              <div>
                <span className="text-slate-600">Tipo:</span>
                <span className="font-semibold text-slate-900 ml-2">{ponto?.tipo}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600">Lotes na área:</span>
              {loadingLotes ? (
                <Badge variant="outline" className="text-xs">Carregando...</Badge>
              ) : (
                <Badge className="bg-slate-100 text-slate-700 text-xs">
                  {lotes.length} lote(s) - {totalCabecas} cabeças
                </Badge>
              )}
            </div>
            {ultimoEvento && diasPeriodo && (
              <div className="pt-2 border-t border-slate-200">
                <div className="text-xs text-blue-700">
                  ⏱️ Último lançamento: {new Date(ultimoEvento.data_lancamento).toLocaleDateString()}
                  <span className="font-bold ml-2">→ Período: {diasPeriodo} dia(s)</span>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Data do Lançamento *</Label>
              <Input
                type="date"
                value={formData.data_lancamento}
                onChange={(e) => setFormData({ ...formData, data_lancamento: e.target.value })}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Produto *</Label>
              <Select 
                value={formData.produto} 
                onValueChange={(v) => setFormData({ ...formData, produto: v })}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Selecione o produto" />
                </SelectTrigger>
                <SelectContent>
                  {produtosSuplementacao.map(produto => (
                    <SelectItem key={produto.id} value={produto.nome_produto} className="text-xs">
                      {produto.nome_produto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Quantidade Total Fornecida (kg) *</Label>
              <Input
                type="number"
                step="0.1"
                value={formData.quantidade_total_kg}
                onChange={(e) => setFormData({ ...formData, quantidade_total_kg: e.target.value })}
                className="h-9 text-xs"
                placeholder="0"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Sobra no Cocho (kg)</Label>
              <Input
                type="number"
                step="0.1"
                value={formData.sobra_kg}
                onChange={(e) => setFormData({ ...formData, sobra_kg: e.target.value })}
                className="h-9 text-xs"
                placeholder="0"
              />
            </div>
          </div>

          {formData.quantidade_total_kg && totalCabecas > 0 && ultimoEvento && diasPeriodo && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-3">
              <div className="text-xs font-semibold text-amber-900 mb-2">⚠️ Fechamento do Período Anterior:</div>
              <div className="text-xs text-amber-800 mb-2">
                O lançamento de <strong>{new Date(ultimoEvento.data_lancamento).toLocaleDateString()}</strong> será fechado com <strong>{diasPeriodo} dia(s)</strong> de duração.
              </div>
            </div>
          )}

          {!ultimoEvento && formData.quantidade_total_kg && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-blue-900 mb-2">ℹ️ Primeiro Lançamento</div>
              <div className="text-xs text-blue-700">
                Este é o primeiro lançamento neste ponto.
              </div>
            </div>
          )}

          {formData.quantidade_total_kg && totalCabecas > 0 && lotes.length > 0 && (
            <div className="bg-slate-50 border border-slate-300 rounded-lg p-3">
              <div className="text-xs font-semibold text-slate-900 mb-3">📊 Consumo por Lote</div>
              <div className="space-y-2">
                {lotes.map(lote => {
                  const categoriaLote = lote.categoria?.toUpperCase().trim();
                  const fator = fatores.find(f => f.categoria?.toUpperCase().trim() === categoriaLote)?.fator || 1.0;
                  const pesoConsumoLote = lote.quantidade_cabecas * fator;
                  const percentualConsumo = pesoTotalConsumo > 0 ? (pesoConsumoLote / pesoTotalConsumo * 100) : 0;
                  
                  let consumoPorCabecaDia = null;
                  let consumoTotalLote = null;
                  
                  if (ultimoEvento && diasPeriodo > 0) {
                    const quantidadeConsumida = parseFloat(formData.quantidade_total_kg) - parseFloat(formData.sobra_kg || 0);
                    const consumoUnitario = pesoTotalConsumo > 0 ? quantidadeConsumida / (diasPeriodo * pesoTotalConsumo) : 0;
                    consumoPorCabecaDia = consumoUnitario * fator;
                    consumoTotalLote = consumoPorCabecaDia * lote.quantidade_cabecas * diasPeriodo;
                  }

                  return (
                    <div key={lote.id} className="bg-white border border-slate-200 rounded-md p-2">
                      <div className="flex items-center justify-between mb-1">
                        <div className="font-semibold text-xs text-slate-900">{lote.nome}</div>
                        <Badge variant="outline" className="text-[10px]">{lote.categoria}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[10px]">
                        <div>
                          <div className="text-slate-500">Cabeças</div>
                          <div className="font-bold text-slate-900">{lote.quantidade_cabecas}</div>
                        </div>
                        <div>
                          <div className="text-slate-500">Fator</div>
                          <div className="font-bold text-slate-900">{fator.toFixed(2)}</div>
                        </div>
                        <div>
                          <div className="text-slate-500">% Consumo</div>
                          <div className="font-bold text-emerald-700">{percentualConsumo.toFixed(1)}%</div>
                        </div>
                      </div>
                      {consumoPorCabecaDia !== null && (
                        <div className="mt-2 pt-2 border-t border-slate-200">
                          <div className="grid grid-cols-2 gap-2 text-[10px]">
                            <div>
                              <div className="text-slate-500">kg/cab/dia</div>
                              <div className="font-bold text-blue-700">{consumoPorCabecaDia.toFixed(3)}</div>
                            </div>
                            <div>
                              <div className="text-slate-500">Total período</div>
                              <div className="font-bold text-blue-700">{consumoTotalLote.toFixed(1)} kg</div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 pt-2 border-t border-slate-300">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">Peso Total de Consumo:</span>
                  <span className="font-bold text-slate-900">{pesoTotalConsumo.toFixed(2)} UA</span>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Observações</Label>
            <Textarea
              value={formData.observacoes}
              onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
              className="text-xs"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
              Cancelar
            </Button>
            <Button 
              type="button"
              onClick={handleSalvar}
              size="sm" 
              className="h-8 text-xs bg-slate-700 hover:bg-slate-800"
              disabled={!botaoHabilitado || progresso.show}
            >
              {progresso.show ? 'Registrando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <Dialog open={progresso.show} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Salvando...</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-xs text-slate-600">{progresso.mensagem}</p>
          <Progress value={(progresso.atual / progresso.total) * 100} className="w-full h-1.5" />
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}