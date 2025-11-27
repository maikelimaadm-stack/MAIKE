import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Save, X, ArrowRight, Plus } from "lucide-react";
import { toast } from "sonner";

const TIPOS_MOVIMENTACAO = [
  { value: "Entrada", label: "Entrada (Compra)", cor: "bg-green-100 text-green-800" },
  { value: "Saída", label: "Saída (Venda)", cor: "bg-red-100 text-red-800" },
  { value: "Transferência de Área", label: "Transferência entre Áreas", cor: "bg-blue-100 text-blue-800" },
  { value: "Nascimento", label: "Nascimento", cor: "bg-emerald-100 text-emerald-800" },
  { value: "Morte", label: "Morte", cor: "bg-gray-100 text-gray-800" },
  { value: "Abate", label: "Abate", cor: "bg-orange-100 text-orange-800" },
  { value: "Mudança de Categoria", label: "Mudança de Categoria", cor: "bg-purple-100 text-purple-800" },
  { value: "Pesagem", label: "Pesagem", cor: "bg-cyan-100 text-cyan-800" },
];

const CATEGORIAS_ANIMAL = [
  "Bezerro(a)",
  "Novilho(a)",
  "Garrote",
  "Boi",
  "Vaca",
  "Touro",
  "Matriz"
];

const CAUSAS_MORTE = [
  "Doença",
  "Acidente",
  "Ataque de predador",
  "Parto complicado",
  "Desconhecida",
  "Outro"
];

export default function FormularioLancamentoManual({ item, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    tipo: item?.tipo || "",
    data_movimentacao: item?.data_movimentacao?.split('T')[0] || new Date().toISOString().split('T')[0],
    lote_id: item?.lote_id || "",
    lote: item?.lote || "",
    quantidade_animais: item?.quantidade_animais || 1,
    categoria_animal: item?.categoria_animal || "",
    sexo: item?.sexo || "",
    peso_medio: item?.peso_medio || "",
    peso_total: item?.peso_total || "",
    valor_unitario: item?.valor_unitario || "",
    valor_total: item?.valor_total || "",
    area_origem_id: item?.area_origem_id || "",
    area_destino_id: item?.area_destino_id || "",
    fornecedor_origem: item?.fornecedor_origem || "",
    destino_venda: item?.destino_venda || "",
    nota_fiscal: item?.nota_fiscal || "",
    gta: item?.gta || "",
    motivo: item?.motivo || "",
    causa_morte: item?.causa_morte || "",
    destino_abate: item?.destino_abate || "",
    observacoes: item?.observacoes || ""
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas-pastagem', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: lotes = [] } = useQuery({
    queryKey: ['lotes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter(l => l.empresa_id === empresaSelecionadaId && l.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ['fornecedores', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list();
      return all.filter(f => f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Calcular peso total automaticamente
  useEffect(() => {
    if (formData.peso_medio && formData.quantidade_animais) {
      const pesoTotal = parseFloat(formData.peso_medio) * parseInt(formData.quantidade_animais);
      setFormData(prev => ({ ...prev, peso_total: pesoTotal.toFixed(2) }));
    }
  }, [formData.peso_medio, formData.quantidade_animais]);

  // Calcular valor total automaticamente
  useEffect(() => {
    if (formData.valor_unitario && formData.quantidade_animais) {
      const valorTotal = parseFloat(formData.valor_unitario) * parseInt(formData.quantidade_animais);
      setFormData(prev => ({ ...prev, valor_total: valorTotal.toFixed(2) }));
    }
  }, [formData.valor_unitario, formData.quantidade_animais]);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      // Gerar número de movimentação
      const allMovs = await base44.entities.MovimentacaoPecuaria.list();
      const maxNum = allMovs.reduce((max, m) => Math.max(max, parseInt(m.numero_movimentacao) || 0), 0);

      const areaOrigem = areas.find(a => a.id === data.area_origem_id);
      const areaDestino = areas.find(a => a.id === data.area_destino_id);
      const loteSelected = lotes.find(l => l.id === data.lote_id);

      const payload = {
        empresa_id: empresaSelecionadaId,
        numero_movimentacao: String(maxNum + 1),
        tipo: data.tipo,
        data_movimentacao: new Date(data.data_movimentacao).toISOString(),
        lote_id: data.lote_id || null,
        lote: loteSelected?.nome || data.lote || null,
        quantidade_animais: parseInt(data.quantidade_animais) || 1,
        categoria_animal: data.categoria_animal || null,
        sexo: data.sexo || null,
        peso_medio: parseFloat(data.peso_medio) || null,
        peso_total: parseFloat(data.peso_total) || null,
        valor_unitario: parseFloat(data.valor_unitario) || null,
        valor_total: parseFloat(data.valor_total) || null,
        area_origem_id: data.area_origem_id || null,
        area_origem_nome: areaOrigem?.nome || null,
        area_destino_id: data.area_destino_id || null,
        area_destino_nome: areaDestino?.nome || null,
        fornecedor_origem: data.fornecedor_origem || null,
        destino_venda: data.destino_venda || null,
        nota_fiscal: data.nota_fiscal || null,
        gta: data.gta || null,
        motivo: data.motivo || null,
        causa_morte: data.causa_morte || null,
        destino_abate: data.destino_abate || null,
        observacoes: data.observacoes || null,
      };

      if (item) {
        return base44.entities.MovimentacaoPecuaria.update(item.id, payload);
      }
      return base44.entities.MovimentacaoPecuaria.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-pecuaria'] });
      toast.success(item ? 'Movimentação atualizada!' : 'Movimentação registrada!');
      onSave();
    },
    onError: () => {
      toast.error('Erro ao salvar movimentação');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!formData.tipo) {
      toast.error('Selecione o tipo de movimentação');
      return;
    }
    if (!formData.quantidade_animais || formData.quantidade_animais < 1) {
      toast.error('Informe a quantidade de animais');
      return;
    }

    createMutation.mutate(formData);
  };

  const handleLoteChange = (loteId) => {
    const lote = lotes.find(l => l.id === loteId);
    setFormData(prev => ({
      ...prev,
      lote_id: loteId,
      lote: lote?.nome || "",
      area_origem_id: lote?.area_atual_id || prev.area_origem_id,
      categoria_animal: lote?.categoria || prev.categoria_animal,
    }));
  };

  // Campos específicos por tipo
  const mostrarCamposEntrada = formData.tipo === "Entrada";
  const mostrarCamposSaida = formData.tipo === "Saída";
  const mostrarCamposTransferencia = formData.tipo === "Transferência de Área";
  const mostrarCamposMorte = formData.tipo === "Morte";
  const mostrarCamposAbate = formData.tipo === "Abate";
  const mostrarCamposNascimento = formData.tipo === "Nascimento";
  const mostrarCamposPesagem = formData.tipo === "Pesagem";
  const mostrarCamposMudancaCategoria = formData.tipo === "Mudança de Categoria";

  return (
    <Card className="shadow-lg border-slate-200">
      <CardHeader className="bg-slate-50 border-b py-3 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Plus className="w-4 h-4" />
          {item ? 'Editar Movimentação' : 'Novo Lançamento Manual'}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Tipo e Data */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Tipo de Movimentação *</Label>
              <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_MOVIMENTACAO.map(tipo => (
                    <SelectItem key={tipo.value} value={tipo.value} className="text-sm">
                      <span className={`px-2 py-0.5 rounded text-xs ${tipo.cor}`}>{tipo.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Data *</Label>
              <Input
                type="date"
                value={formData.data_movimentacao}
                onChange={(e) => setFormData({ ...formData, data_movimentacao: e.target.value })}
                className="h-9 text-sm"
                required
              />
            </div>
          </div>

          {/* Lote e Quantidade */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Lote</Label>
              <Select value={formData.lote_id} onValueChange={handleLoteChange}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Selecione ou deixe em branco" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sem_lote" className="text-sm">Sem lote específico</SelectItem>
                  {lotes.map(lote => (
                    <SelectItem key={lote.id} value={lote.id} className="text-sm">
                      {lote.nome} ({lote.quantidade_cabecas || 0} cab)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Quantidade de Animais *</Label>
              <Input
                type="number"
                min="1"
                value={formData.quantidade_animais}
                onChange={(e) => setFormData({ ...formData, quantidade_animais: e.target.value })}
                className="h-9 text-sm"
                required
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Categoria do Animal</Label>
              <Select value={formData.categoria_animal} onValueChange={(v) => setFormData({ ...formData, categoria_animal: v })}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIAS_ANIMAL.map(cat => (
                    <SelectItem key={cat} value={cat} className="text-sm">{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Sexo */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Sexo</Label>
              <Select value={formData.sexo} onValueChange={(v) => setFormData({ ...formData, sexo: v })}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Macho" className="text-sm">Macho</SelectItem>
                  <SelectItem value="Fêmea" className="text-sm">Fêmea</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Peso Médio (kg)</Label>
              <Input
                type="number"
                step="0.1"
                value={formData.peso_medio}
                onChange={(e) => setFormData({ ...formData, peso_medio: e.target.value })}
                className="h-9 text-sm"
                placeholder="0,00"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Peso Total (kg)</Label>
              <Input
                type="number"
                step="0.1"
                value={formData.peso_total}
                onChange={(e) => setFormData({ ...formData, peso_total: e.target.value })}
                className="h-9 text-sm bg-slate-50"
                placeholder="Calculado automaticamente"
                readOnly
              />
            </div>
          </div>

          {/* Campos para Entrada/Compra */}
          {mostrarCamposEntrada && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg space-y-3">
              <h4 className="text-xs font-semibold text-green-800">Dados da Entrada/Compra</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Fornecedor/Origem</Label>
                  <Select value={formData.fornecedor_origem} onValueChange={(v) => setFormData({ ...formData, fornecedor_origem: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Selecione ou digite" />
                    </SelectTrigger>
                    <SelectContent>
                      {fornecedores.map(f => (
                        <SelectItem key={f.id} value={f.nome} className="text-sm">{f.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Área de Destino</Label>
                  <Select value={formData.area_destino_id} onValueChange={(v) => setFormData({ ...formData, area_destino_id: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Para qual área?" />
                    </SelectTrigger>
                    <SelectContent>
                      {areas.map(area => (
                        <SelectItem key={area.id} value={area.id} className="text-sm">
                          {area.sigla ? `${area.sigla} - ` : ''}{area.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Valor Unitário (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.valor_unitario}
                    onChange={(e) => setFormData({ ...formData, valor_unitario: e.target.value })}
                    className="h-9 text-sm"
                    placeholder="0,00"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Valor Total (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.valor_total}
                    className="h-9 text-sm bg-slate-50"
                    readOnly
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nota Fiscal</Label>
                  <Input
                    value={formData.nota_fiscal}
                    onChange={(e) => setFormData({ ...formData, nota_fiscal: e.target.value })}
                    className="h-9 text-sm"
                    placeholder="Nº da NF"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">GTA</Label>
                  <Input
                    value={formData.gta}
                    onChange={(e) => setFormData({ ...formData, gta: e.target.value })}
                    className="h-9 text-sm"
                    placeholder="Nº da GTA"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Campos para Saída/Venda */}
          {mostrarCamposSaida && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-3">
              <h4 className="text-xs font-semibold text-red-800">Dados da Saída/Venda</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Área de Origem</Label>
                  <Select value={formData.area_origem_id} onValueChange={(v) => setFormData({ ...formData, area_origem_id: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="De qual área?" />
                    </SelectTrigger>
                    <SelectContent>
                      {areas.map(area => (
                        <SelectItem key={area.id} value={area.id} className="text-sm">
                          {area.sigla ? `${area.sigla} - ` : ''}{area.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Destino/Comprador</Label>
                  <Input
                    value={formData.destino_venda}
                    onChange={(e) => setFormData({ ...formData, destino_venda: e.target.value })}
                    className="h-9 text-sm"
                    placeholder="Nome do comprador"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Valor Unitário (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.valor_unitario}
                    onChange={(e) => setFormData({ ...formData, valor_unitario: e.target.value })}
                    className="h-9 text-sm"
                    placeholder="0,00"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Valor Total (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.valor_total}
                    className="h-9 text-sm bg-slate-50"
                    readOnly
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nota Fiscal</Label>
                  <Input
                    value={formData.nota_fiscal}
                    onChange={(e) => setFormData({ ...formData, nota_fiscal: e.target.value })}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">GTA</Label>
                  <Input
                    value={formData.gta}
                    onChange={(e) => setFormData({ ...formData, gta: e.target.value })}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Campos para Transferência */}
          {mostrarCamposTransferencia && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
              <h4 className="text-xs font-semibold text-blue-800">Transferência entre Áreas</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div className="space-y-1">
                  <Label className="text-xs">Área de Origem</Label>
                  <Select value={formData.area_origem_id} onValueChange={(v) => setFormData({ ...formData, area_origem_id: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="De onde?" />
                    </SelectTrigger>
                    <SelectContent>
                      {areas.map(area => (
                        <SelectItem key={area.id} value={area.id} className="text-sm">
                          {area.sigla ? `${area.sigla} - ` : ''}{area.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-center">
                  <ArrowRight className="w-6 h-6 text-blue-500" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Área de Destino</Label>
                  <Select value={formData.area_destino_id} onValueChange={(v) => setFormData({ ...formData, area_destino_id: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Para onde?" />
                    </SelectTrigger>
                    <SelectContent>
                      {areas.map(area => (
                        <SelectItem key={area.id} value={area.id} className="text-sm">
                          {area.sigla ? `${area.sigla} - ` : ''}{area.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Campos para Morte */}
          {mostrarCamposMorte && (
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
              <h4 className="text-xs font-semibold text-gray-800">Dados da Morte</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Área</Label>
                  <Select value={formData.area_origem_id} onValueChange={(v) => setFormData({ ...formData, area_origem_id: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Onde ocorreu?" />
                    </SelectTrigger>
                    <SelectContent>
                      {areas.map(area => (
                        <SelectItem key={area.id} value={area.id} className="text-sm">
                          {area.sigla ? `${area.sigla} - ` : ''}{area.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Causa da Morte</Label>
                  <Select value={formData.causa_morte} onValueChange={(v) => setFormData({ ...formData, causa_morte: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {CAUSAS_MORTE.map(causa => (
                        <SelectItem key={causa} value={causa} className="text-sm">{causa}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Campos para Abate */}
          {mostrarCamposAbate && (
            <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg space-y-3">
              <h4 className="text-xs font-semibold text-orange-800">Dados do Abate</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Área de Origem</Label>
                  <Select value={formData.area_origem_id} onValueChange={(v) => setFormData({ ...formData, area_origem_id: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="De qual área?" />
                    </SelectTrigger>
                    <SelectContent>
                      {areas.map(area => (
                        <SelectItem key={area.id} value={area.id} className="text-sm">
                          {area.sigla ? `${area.sigla} - ` : ''}{area.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Destino (Frigorífico)</Label>
                  <Input
                    value={formData.destino_abate}
                    onChange={(e) => setFormData({ ...formData, destino_abate: e.target.value })}
                    className="h-9 text-sm"
                    placeholder="Nome do frigorífico"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Valor Unitário (R$/@)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.valor_unitario}
                    onChange={(e) => setFormData({ ...formData, valor_unitario: e.target.value })}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Valor Total (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.valor_total}
                    className="h-9 text-sm bg-slate-50"
                    readOnly
                  />
                </div>
              </div>
            </div>
          )}

          {/* Campos para Nascimento */}
          {mostrarCamposNascimento && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg space-y-3">
              <h4 className="text-xs font-semibold text-emerald-800">Dados do Nascimento</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Área</Label>
                  <Select value={formData.area_destino_id} onValueChange={(v) => setFormData({ ...formData, area_destino_id: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Onde nasceu?" />
                    </SelectTrigger>
                    <SelectContent>
                      {areas.map(area => (
                        <SelectItem key={area.id} value={area.id} className="text-sm">
                          {area.sigla ? `${area.sigla} - ` : ''}{area.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Campos para Pesagem */}
          {mostrarCamposPesagem && (
            <div className="p-3 bg-cyan-50 border border-cyan-200 rounded-lg space-y-3">
              <h4 className="text-xs font-semibold text-cyan-800">Dados da Pesagem</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Área</Label>
                  <Select value={formData.area_origem_id} onValueChange={(v) => setFormData({ ...formData, area_origem_id: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Onde foi pesado?" />
                    </SelectTrigger>
                    <SelectContent>
                      {areas.map(area => (
                        <SelectItem key={area.id} value={area.id} className="text-sm">
                          {area.sigla ? `${area.sigla} - ` : ''}{area.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Motivo e Observações */}
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Motivo/Justificativa</Label>
              <Input
                value={formData.motivo}
                onChange={(e) => setFormData({ ...formData, motivo: e.target.value })}
                className="h-9 text-sm"
                placeholder="Motivo da movimentação"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Observações</Label>
              <Textarea
                value={formData.observacoes}
                onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                className="text-sm"
                rows={3}
                placeholder="Observações adicionais..."
              />
            </div>
          </div>

          {/* Botões */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onCancel} className="h-9 text-sm">
              <X className="w-4 h-4 mr-1" />
              Cancelar
            </Button>
            <Button 
              type="submit" 
              className="h-9 text-sm bg-emerald-600 hover:bg-emerald-700"
              disabled={createMutation.isPending}
            >
              <Save className="w-4 h-4 mr-1" />
              {createMutation.isPending ? 'Salvando...' : (item ? 'Atualizar' : 'Salvar')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}