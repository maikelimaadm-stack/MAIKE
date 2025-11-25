import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Calculator, DollarSign } from "lucide-react";
import { toast } from "sonner";

const TIPOS_OPERACAO = ["Gradagem", "Aração", "Plantio", "Pulverização", "Adubação", "Colheita", "Roçagem", "Calagem", "Dessecação", "Subsolagem", "Outro"];

export default function FormularioOperacao({ operacao, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [formData, setFormData] = useState({
    tipo_operacao: operacao?.tipo_operacao || '',
    area_id: operacao?.area_id || '',
    maquina_id: operacao?.maquina_id || '',
    implemento_id: operacao?.implemento_id || '',
    data_inicio: operacao?.data_inicio || new Date().toISOString().split('T')[0],
    data_fim: operacao?.data_fim || '',
    hectares_trabalhados: operacao?.hectares_trabalhados || '',
    horas_trabalhadas: operacao?.horas_trabalhadas || '',
    horimetro_inicio: operacao?.horimetro_inicio || '',
    horimetro_fim: operacao?.horimetro_fim || '',
    combustivel_consumido: operacao?.combustivel_consumido || '',
    valor_combustivel: operacao?.valor_combustivel || '',
    custo_maquina_hora: operacao?.custo_maquina_hora || '',
    custo_maquina_total: operacao?.custo_maquina_total || '',
    custo_mao_obra: operacao?.custo_mao_obra || '',
    produto_aplicado: operacao?.produto_aplicado || '',
    quantidade_produto: operacao?.quantidade_produto || '',
    unidade_produto: operacao?.unidade_produto || '',
    valor_unitario_produto: operacao?.valor_unitario_produto || '',
    custo_produto: operacao?.custo_produto || '',
    dose_por_hectare: operacao?.dose_por_hectare || '',
    operador: operacao?.operador || '',
    safra_id: operacao?.safra_id || '',
    custo_total: operacao?.custo_total || '',
    custo_por_hectare: operacao?.custo_por_hectare || '',
    status: operacao?.status || 'Concluída',
    observacoes: operacao?.observacoes || '',
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas-operacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: maquinas = [] } = useQuery({
    queryKey: ['maquinas-operacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Maquina.list();
      return all.filter(m => m.empresa_id === empresaSelecionadaId && m.status === 'Ativo');
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: safras = [] } = useQuery({
    queryKey: ['safras-operacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Safra.list();
      return all.filter(s => s.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: abastecimentos = [] } = useQuery({
    queryKey: ['abastecimentos-operacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AbastecimentoMaquina.list('-data_abastecimento');
      return all.filter(a => a.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const implementos = maquinas.filter(m => m.tipo === 'Implemento');
  const maquinaSelecionada = maquinas.find(m => m.id === formData.maquina_id);

  // Buscar último valor do combustível pelo tipo de combustível da máquina
  const getValorCombustivel = () => {
    if (!maquinaSelecionada) return 0;
    
    // Buscar abastecimentos da máquina selecionada
    const abastMaquina = abastecimentos.filter(a => a.maquina_id === formData.maquina_id);
    if (abastMaquina.length > 0 && abastMaquina[0].valor_litro) {
      return abastMaquina[0].valor_litro;
    }
    
    // Se não tem abastecimento da máquina, buscar pelo tipo de combustível
    const tipoComb = maquinaSelecionada.tipo_combustivel;
    if (tipoComb) {
      const abastTipo = abastecimentos.find(a => a.tipo_combustivel === tipoComb && a.valor_litro);
      if (abastTipo) return abastTipo.valor_litro;
    }
    
    // Fallback para valor cadastrado na máquina
    return maquinaSelecionada.valor_combustivel_litro || 0;
  };

  // Calcular custos automaticamente
  useEffect(() => {
    if (maquinaSelecionada) {
      const horas = parseFloat(formData.horas_trabalhadas) || 0;
      const consumoMedio = maquinaSelecionada.consumo_medio || 0;
      const valorCombustivel = getValorCombustivel();
      const custoHoraMaquina = maquinaSelecionada.custo_hora || 0;

      // Calcular combustível se não informado
      let combustivelCalc = parseFloat(formData.combustivel_consumido) || 0;
      if (!combustivelCalc && horas && consumoMedio) {
        combustivelCalc = horas * consumoMedio;
      }

      // Valor do combustível
      let valorCombustivelCalc = parseFloat(formData.valor_combustivel) || 0;
      if (!valorCombustivelCalc && combustivelCalc && valorCombustivel) {
        valorCombustivelCalc = combustivelCalc * valorCombustivel;
      }

      // Custo hora máquina
      let custoMaquinaHora = parseFloat(formData.custo_maquina_hora) || custoHoraMaquina;
      let custoMaquinaTotal = horas * custoMaquinaHora;

      // Custo do produto
      const qtdProduto = parseFloat(formData.quantidade_produto) || 0;
      const valorUnitProduto = parseFloat(formData.valor_unitario_produto) || 0;
      const custoProduto = qtdProduto * valorUnitProduto;

      // Custo mão de obra
      const custoMaoObra = parseFloat(formData.custo_mao_obra) || 0;

      // Custo total
      const custoTotal = valorCombustivelCalc + custoMaquinaTotal + custoProduto + custoMaoObra;

      // Custo por hectare
      const hectares = parseFloat(formData.hectares_trabalhados) || 0;
      const custoPorHectare = hectares > 0 ? custoTotal / hectares : 0;

      setFormData(prev => ({
        ...prev,
        combustivel_consumido: combustivelCalc || prev.combustivel_consumido,
        valor_combustivel: valorCombustivelCalc.toFixed(2),
        custo_maquina_hora: custoMaquinaHora.toFixed(2),
        custo_maquina_total: custoMaquinaTotal.toFixed(2),
        custo_produto: custoProduto.toFixed(2),
        custo_total: custoTotal.toFixed(2),
        custo_por_hectare: custoPorHectare.toFixed(2),
      }));
    }
  }, [
    formData.maquina_id,
    formData.horas_trabalhadas,
    formData.hectares_trabalhados,
    formData.quantidade_produto,
    formData.valor_unitario_produto,
    formData.custo_mao_obra,
    maquinaSelecionada,
    abastecimentos
  ]);

  // Calcular horas pelo horímetro
  useEffect(() => {
    const inicio = parseFloat(formData.horimetro_inicio) || 0;
    const fim = parseFloat(formData.horimetro_fim) || 0;
    if (inicio && fim && fim > inicio) {
      setFormData(prev => ({
        ...prev,
        horas_trabalhadas: (fim - inicio).toFixed(1)
      }));
    }
  }, [formData.horimetro_inicio, formData.horimetro_fim]);

  const mutation = useMutation({
    mutationFn: async (data) => {
      const area = areas.find(a => a.id === data.area_id);
      const maquina = maquinas.find(m => m.id === data.maquina_id);
      const implemento = maquinas.find(m => m.id === data.implemento_id);
      const safra = safras.find(s => s.id === data.safra_id);

      const payload = {
        ...data,
        empresa_id: empresaSelecionadaId,
        area_nome: area?.nome || '',
        maquina_nome: maquina?.nome || '',
        implemento_nome: implemento?.nome || '',
        safra_nome: safra ? `${safra.ano_inicio}/${safra.ano_fim}` : '',
        hectares_trabalhados: data.hectares_trabalhados ? parseFloat(data.hectares_trabalhados) : null,
        horas_trabalhadas: data.horas_trabalhadas ? parseFloat(data.horas_trabalhadas) : null,
        horimetro_inicio: data.horimetro_inicio ? parseFloat(data.horimetro_inicio) : null,
        horimetro_fim: data.horimetro_fim ? parseFloat(data.horimetro_fim) : null,
        combustivel_consumido: data.combustivel_consumido ? parseFloat(data.combustivel_consumido) : null,
        valor_combustivel: data.valor_combustivel ? parseFloat(data.valor_combustivel) : null,
        custo_maquina_hora: data.custo_maquina_hora ? parseFloat(data.custo_maquina_hora) : null,
        custo_maquina_total: data.custo_maquina_total ? parseFloat(data.custo_maquina_total) : null,
        custo_mao_obra: data.custo_mao_obra ? parseFloat(data.custo_mao_obra) : null,
        quantidade_produto: data.quantidade_produto ? parseFloat(data.quantidade_produto) : null,
        valor_unitario_produto: data.valor_unitario_produto ? parseFloat(data.valor_unitario_produto) : null,
        custo_produto: data.custo_produto ? parseFloat(data.custo_produto) : null,
        dose_por_hectare: data.dose_por_hectare ? parseFloat(data.dose_por_hectare) : null,
        custo_total: data.custo_total ? parseFloat(data.custo_total) : null,
        custo_por_hectare: data.custo_por_hectare ? parseFloat(data.custo_por_hectare) : null,
      };

      if (operacao?.id) {
        return base44.entities.OperacaoAgricola.update(operacao.id, payload);
      }
      return base44.entities.OperacaoAgricola.create(payload);
    },
    onSuccess: () => {
      toast.success(operacao?.id ? 'Operação atualizada!' : 'Operação registrada!');
      onSave();
    },
    onError: (error) => {
      toast.error('Erro: ' + error.message);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.tipo_operacao || !formData.area_id) {
      toast.error('Preencha tipo e área');
      return;
    }
    mutation.mutate(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Tipo de Operação *</Label>
          <Select value={formData.tipo_operacao} onValueChange={(v) => setFormData({ ...formData, tipo_operacao: v })}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_OPERACAO.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Planejada">Planejada</SelectItem>
              <SelectItem value="Em Andamento">Em Andamento</SelectItem>
              <SelectItem value="Concluída">Concluída</SelectItem>
              <SelectItem value="Cancelada">Cancelada</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Área *</Label>
          <Select value={formData.area_id} onValueChange={(v) => setFormData({ ...formData, area_id: v })}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione a área" />
            </SelectTrigger>
            <SelectContent>
              {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.nome} ({a.tamanho_hectares}ha)</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Safra</Label>
          <Select value={formData.safra_id} onValueChange={(v) => setFormData({ ...formData, safra_id: v })}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {safras.map(s => <SelectItem key={s.id} value={s.id}>{s.ano_inicio}/{s.ano_fim}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Máquina</Label>
          <Select value={formData.maquina_id} onValueChange={(v) => setFormData({ ...formData, maquina_id: v })}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {maquinas.filter(m => m.tipo !== 'Implemento').map(m => (
                <SelectItem key={m.id} value={m.id}>
                  {m.nome} {m.custo_hora ? `(R$ ${m.custo_hora}/h)` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Implemento</Label>
          <Select value={formData.implemento_id} onValueChange={(v) => setFormData({ ...formData, implemento_id: v })}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {implementos.map(i => <SelectItem key={i.id} value={i.id}>{i.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <Label className="text-xs">Data Início *</Label>
          <Input
            type="date"
            value={formData.data_inicio}
            onChange={(e) => setFormData({ ...formData, data_inicio: e.target.value })}
            className="h-9"
            required
          />
        </div>
        <div>
          <Label className="text-xs">Data Fim</Label>
          <Input
            type="date"
            value={formData.data_fim}
            onChange={(e) => setFormData({ ...formData, data_fim: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Hectares</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.hectares_trabalhados}
            onChange={(e) => setFormData({ ...formData, hectares_trabalhados: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Operador</Label>
          <Input
            value={formData.operador}
            onChange={(e) => setFormData({ ...formData, operador: e.target.value })}
            className="h-9"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <Label className="text-xs">Horímetro Início</Label>
          <Input
            type="number"
            value={formData.horimetro_inicio}
            onChange={(e) => setFormData({ ...formData, horimetro_inicio: e.target.value })}
            className="h-9"
            placeholder={maquinaSelecionada?.horimetro_atual ? `Atual: ${maquinaSelecionada.horimetro_atual}` : ''}
          />
        </div>
        <div>
          <Label className="text-xs">Horímetro Fim</Label>
          <Input
            type="number"
            value={formData.horimetro_fim}
            onChange={(e) => setFormData({ ...formData, horimetro_fim: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Horas Trabalhadas</Label>
          <Input
            type="number"
            step="0.1"
            value={formData.horas_trabalhadas}
            onChange={(e) => setFormData({ ...formData, horas_trabalhadas: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Combustível (L)</Label>
          <Input
            type="number"
            step="0.1"
            value={formData.combustivel_consumido}
            onChange={(e) => setFormData({ ...formData, combustivel_consumido: e.target.value })}
            className="h-9"
            placeholder={maquinaSelecionada?.consumo_medio ? `Est: ${(parseFloat(formData.horas_trabalhadas || 0) * maquinaSelecionada.consumo_medio).toFixed(1)}L` : ''}
          />
        </div>
      </div>

      {/* Produtos/Insumos */}
      {(formData.tipo_operacao === 'Pulverização' || formData.tipo_operacao === 'Adubação' || formData.tipo_operacao === 'Calagem' || formData.tipo_operacao === 'Plantio') && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="p-3">
            <h4 className="text-xs font-semibold text-blue-800 mb-3">Produto/Insumo Aplicado</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="md:col-span-2">
                <Label className="text-xs">Produto</Label>
                <Input
                  value={formData.produto_aplicado}
                  onChange={(e) => setFormData({ ...formData, produto_aplicado: e.target.value })}
                  className="h-9 bg-white"
                />
              </div>
              <div>
                <Label className="text-xs">Quantidade</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.quantidade_produto}
                  onChange={(e) => setFormData({ ...formData, quantidade_produto: e.target.value })}
                  className="h-9 bg-white"
                />
              </div>
              <div>
                <Label className="text-xs">Unidade</Label>
                <Input
                  value={formData.unidade_produto}
                  onChange={(e) => setFormData({ ...formData, unidade_produto: e.target.value })}
                  className="h-9 bg-white"
                  placeholder="kg, L, sc"
                />
              </div>
              <div>
                <Label className="text-xs">Valor Unit. (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.valor_unitario_produto}
                  onChange={(e) => setFormData({ ...formData, valor_unitario_produto: e.target.value })}
                  className="h-9 bg-white"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Custos */}
      <Card className="border-emerald-200 bg-emerald-50/50">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-3">
            <Calculator className="w-4 h-4 text-emerald-600" />
            <h4 className="text-xs font-semibold text-emerald-800">Custos da Operação</h4>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Custo Máquina/h (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.custo_maquina_hora}
                onChange={(e) => setFormData({ ...formData, custo_maquina_hora: e.target.value })}
                className="h-9 bg-white"
              />
            </div>
            <div>
              <Label className="text-xs">Custo Máquina Total</Label>
              <div className="h-9 flex items-center px-3 bg-white rounded-md text-sm border">
                R$ {formData.custo_maquina_total || '0.00'}
              </div>
            </div>
            <div>
              <Label className="text-xs">Custo Combustível</Label>
              <div className="h-9 flex items-center px-3 bg-white rounded-md text-sm border">
                R$ {formData.valor_combustivel || '0.00'}
              </div>
            </div>
            <div>
              <Label className="text-xs">Mão de Obra (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.custo_mao_obra}
                onChange={(e) => setFormData({ ...formData, custo_mao_obra: e.target.value })}
                className="h-9 bg-white"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            <div>
              <Label className="text-xs">Custo Produto</Label>
              <div className="h-9 flex items-center px-3 bg-white rounded-md text-sm border">
                R$ {formData.custo_produto || '0.00'}
              </div>
            </div>
            <div></div>
            <div>
              <Label className="text-xs font-semibold text-emerald-700">CUSTO TOTAL</Label>
              <div className="h-9 flex items-center px-3 bg-emerald-100 rounded-md text-sm font-bold text-emerald-800 border border-emerald-300">
                R$ {formData.custo_total || '0.00'}
              </div>
            </div>
            <div>
              <Label className="text-xs font-semibold text-emerald-700">CUSTO/HA</Label>
              <div className="h-9 flex items-center px-3 bg-emerald-100 rounded-md text-sm font-bold text-emerald-800 border border-emerald-300">
                R$ {formData.custo_por_hectare || '0.00'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div>
        <Label className="text-xs">Observações</Label>
        <Textarea
          value={formData.observacoes}
          onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
          rows={2}
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}