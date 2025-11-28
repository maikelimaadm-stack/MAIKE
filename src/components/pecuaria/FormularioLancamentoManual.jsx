import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Save, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const TIPOS_MOVIMENTACAO = [
  { value: "Entrada", label: "Entrada", cor: "bg-green-100 text-green-800" },
  { value: "Saída", label: "Saída", cor: "bg-red-100 text-red-800" },
];

const MOTIVOS_ENTRADA = [
  "Compra",
  "Nascimento", 
  "Transferência (Recebimento)",
  "Mudança de Categoria",
  "Inventário",
  "Ajuste Positivo",
  "Doação Recebida",
  "Outros"
];

const MOTIVOS_SAIDA = [
  "Venda",
  "Morte",
  "Abate",
  "Transferência (Envio)",
  "Mudança de Categoria",
  "Ajuste Negativo",
  "Doação",
  "Perda/Roubo",
  "Outros"
];

// Categorias serão carregadas das Categorias de Manejo cadastradas

export default function FormularioLancamentoManual({ item, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();
  const [showAddMarca, setShowAddMarca] = useState(false);
  const [novaMarca, setNovaMarca] = useState("");

  const [formData, setFormData] = useState({
    tipo: item?.tipo || "",
    data_movimentacao: item?.data_movimentacao?.split('T')[0] || new Date().toISOString().split('T')[0],
    quantidade_animais: item?.quantidade_animais || 1,
    categoria_animal: item?.categoria_animal || "",
    categoria_nova: item?.categoria_nova || "",
    marca: item?.marca || "",
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
    transferencia_origem: item?.transferencia_origem || "",
    transferencia_destino: item?.transferencia_destino || "",
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

  // Carregar categorias de manejo cadastradas
  const { data: categoriasManejo = [] } = useQuery({
    queryKey: ['categorias-manejo', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CategoriaManejo.list();
      return all.filter(c => c.empresa_id === empresaSelecionadaId && c.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Carregar ícones/configurações para marcas
  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter(i => i.empresa_id === empresaSelecionadaId && i.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Extrair marcas únicas dos ícones
  const marcasDisponiveis = [...new Set(iconesConfig.map(i => i.marca).filter(Boolean))];

  const handleAddMarca = async () => {
    if (!novaMarca.trim()) {
      toast.error('Digite o nome da marca');
      return;
    }
    try {
      await base44.entities.ConfiguracaoIcone.create({
        empresa_id: empresaSelecionadaId,
        tipo_entidade: 'Lote',
        marca: novaMarca.toUpperCase(),
        ativo: true
      });
      queryClient.invalidateQueries({ queryKey: ['configuracao-icones'] });
      setFormData({ ...formData, marca: novaMarca.toUpperCase() });
      setNovaMarca("");
      setShowAddMarca(false);
      toast.success('Marca cadastrada!');
    } catch (error) {
      toast.error('Erro ao cadastrar marca');
    }
  };

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

      const payload = {
        empresa_id: empresaSelecionadaId,
        numero_movimentacao: String(maxNum + 1),
        tipo: data.tipo,
        data_movimentacao: new Date(data.data_movimentacao).toISOString(),
        quantidade_animais: parseInt(data.quantidade_animais) || 1,
        categoria_animal: data.categoria_animal || null,
        marca: data.marca || null,
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

  // Validação simplificada
  const precisaMotivo = formData.tipo === "Entrada" || formData.tipo === "Saída";

  return (
    <Card className="shadow-lg border-slate-200">
      <CardHeader className="bg-slate-50 border-b py-3 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Plus className="w-4 h-4" />
          {item ? 'Editar Movimentação' : 'Novo Lançamento Manual'}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Linha 1: Tipo, Motivo, Data, Quantidade */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="space-y-1">
              <Label className="text-sm font-medium">Tipo *</Label>
              <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v, motivo: "" })}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_MOVIMENTACAO.map(tipo => (
                    <SelectItem key={tipo.value} value={tipo.value} className="text-sm">
                      <span className={`px-2 py-0.5 rounded ${tipo.cor}`}>{tipo.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-sm font-medium">Motivo *</Label>
              <Select value={formData.motivo} onValueChange={(v) => setFormData({ ...formData, motivo: v })}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {formData.tipo === "Entrada" ? (
                    MOTIVOS_ENTRADA.map(m => (<SelectItem key={m} value={m} className="text-sm">{m}</SelectItem>))
                  ) : formData.tipo === "Saída" ? (
                    MOTIVOS_SAIDA.map(m => (<SelectItem key={m} value={m} className="text-sm">{m}</SelectItem>))
                  ) : (
                    <SelectItem value={null} disabled className="text-sm">Selecione o tipo primeiro</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-sm font-medium">Data *</Label>
              <Input
                type="date"
                value={formData.data_movimentacao}
                onChange={(e) => setFormData({ ...formData, data_movimentacao: e.target.value })}
                className="h-9 text-sm"
                required
              />
            </div>

            <div className="space-y-1">
              <Label className="text-sm font-medium">Qtd Animais *</Label>
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
              <Label className="text-sm font-medium">Peso Médio (kg)</Label>
              <Input
                type="number"
                step="0.1"
                value={formData.peso_medio}
                onChange={(e) => setFormData({ ...formData, peso_medio: e.target.value })}
                className="h-9 text-sm"
                placeholder="0"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-sm font-medium">Peso Total</Label>
              <Input
                type="number"
                step="0.1"
                value={formData.peso_total}
                className="h-9 text-sm bg-slate-50"
                readOnly
              />
            </div>
          </div>

          {/* Linha 2: Categoria, Marca, Sexo, Área */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="space-y-1">
              <Label className="text-sm font-medium">Categoria</Label>
              <Select value={formData.categoria_animal} onValueChange={(v) => setFormData({ ...formData, categoria_animal: v })}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {categoriasManejo.length > 0 ? (
                    categoriasManejo.map(cat => (
                      <SelectItem key={cat.id} value={cat.nome} className="text-sm">
                        {cat.sigla} - {cat.nome}
                      </SelectItem>
                    ))
                  ) : (
                    <>
                      <SelectItem value="Bezerro(a)" className="text-sm">Bezerro(a)</SelectItem>
                      <SelectItem value="Novilho(a)" className="text-sm">Novilho(a)</SelectItem>
                      <SelectItem value="Garrote" className="text-sm">Garrote</SelectItem>
                      <SelectItem value="Boi" className="text-sm">Boi</SelectItem>
                      <SelectItem value="Vaca" className="text-sm">Vaca</SelectItem>
                      <SelectItem value="Touro" className="text-sm">Touro</SelectItem>
                      <SelectItem value="Matriz" className="text-sm">Matriz</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-sm font-medium">Marca</Label>
              <div className="flex gap-1">
                <Select value={formData.marca} onValueChange={(v) => setFormData({ ...formData, marca: v })}>
                  <SelectTrigger className="h-9 text-sm flex-1">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sem_marca" className="text-sm">Sem marca</SelectItem>
                    {marcasDisponiveis.map(marca => (
                      <SelectItem key={marca} value={marca} className="text-sm">{marca}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setShowAddMarca(true)}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-sm font-medium">Sexo</Label>
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
              <Label className="text-sm font-medium">Área</Label>
              <Select 
                value={formData.tipo === "Entrada" ? formData.area_destino_id : formData.area_origem_id} 
                onValueChange={(v) => {
                  if (formData.tipo === "Entrada") {
                    setFormData({ ...formData, area_destino_id: v });
                  } else {
                    setFormData({ ...formData, area_origem_id: v });
                  }
                }}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Selecione" />
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

          {/* Campos para Mudança de Categoria */}
          {formData.motivo === "Mudança de Categoria" && (
            <div className="p-2 bg-purple-50 border border-purple-200 rounded-lg">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Categoria Atual</Label>
                  <Select value={formData.categoria_animal} onValueChange={(v) => setFormData({ ...formData, categoria_animal: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="De qual categoria?" />
                    </SelectTrigger>
                    <SelectContent>
                      {categoriasManejo.length > 0 ? (
                        categoriasManejo.map(cat => (
                          <SelectItem key={cat.id} value={cat.nome} className="text-sm">
                            {cat.sigla} - {cat.nome} ({cat.quantidade_cabecas || 0} cab)
                          </SelectItem>
                        ))
                      ) : (
                        <>
                          <SelectItem value="Bezerro(a)" className="text-sm">Bezerro(a)</SelectItem>
                          <SelectItem value="Novilho(a)" className="text-sm">Novilho(a)</SelectItem>
                          <SelectItem value="Garrote" className="text-sm">Garrote</SelectItem>
                          <SelectItem value="Boi" className="text-sm">Boi</SelectItem>
                          <SelectItem value="Vaca" className="text-sm">Vaca</SelectItem>
                          <SelectItem value="Touro" className="text-sm">Touro</SelectItem>
                          <SelectItem value="Matriz" className="text-sm">Matriz</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Nova Categoria</Label>
                  <Select value={formData.categoria_nova} onValueChange={(v) => setFormData({ ...formData, categoria_nova: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Para qual categoria?" />
                    </SelectTrigger>
                    <SelectContent>
                      {categoriasManejo.length > 0 ? (
                        categoriasManejo.map(cat => (
                          <SelectItem key={cat.id} value={cat.nome} className="text-sm">
                            {cat.sigla} - {cat.nome}
                          </SelectItem>
                        ))
                      ) : (
                        <>
                          <SelectItem value="Bezerro(a)" className="text-sm">Bezerro(a)</SelectItem>
                          <SelectItem value="Novilho(a)" className="text-sm">Novilho(a)</SelectItem>
                          <SelectItem value="Garrote" className="text-sm">Garrote</SelectItem>
                          <SelectItem value="Boi" className="text-sm">Boi</SelectItem>
                          <SelectItem value="Vaca" className="text-sm">Vaca</SelectItem>
                          <SelectItem value="Touro" className="text-sm">Touro</SelectItem>
                          <SelectItem value="Matriz" className="text-sm">Matriz</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Campos para Compra/Venda */}
          {(formData.motivo === "Compra" || formData.motivo === "Venda") && (
            <div className={`p-2 ${formData.tipo === "Entrada" ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"} border rounded-lg`}>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <div className="space-y-1">
                  <Label className="text-sm font-medium">{formData.tipo === "Entrada" ? "Fornecedor" : "Comprador"}</Label>
                  <Input 
                    value={formData.tipo === "Entrada" ? formData.fornecedor_origem : formData.destino_venda} 
                    onChange={(e) => {
                      if (formData.tipo === "Entrada") {
                        setFormData({ ...formData, fornecedor_origem: e.target.value });
                      } else {
                        setFormData({ ...formData, destino_venda: e.target.value });
                      }
                    }} 
                    className="h-9 text-sm" 
                    placeholder="Nome" 
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Vlr Unit. (R$)</Label>
                  <Input type="number" step="0.01" value={formData.valor_unitario} onChange={(e) => setFormData({ ...formData, valor_unitario: e.target.value })} className="h-9 text-sm" placeholder="0,00" />
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Vlr Total</Label>
                  <Input type="number" value={formData.valor_total} className="h-9 text-sm bg-slate-50" readOnly />
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Nota Fiscal</Label>
                  <Input value={formData.nota_fiscal} onChange={(e) => setFormData({ ...formData, nota_fiscal: e.target.value })} className="h-9 text-sm" placeholder="Nº" />
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-medium">GTA</Label>
                  <Input value={formData.gta} onChange={(e) => setFormData({ ...formData, gta: e.target.value })} className="h-9 text-sm" placeholder="Nº" />
                </div>
              </div>
            </div>
          )}

          {/* Campos para Transferência */}
          {(formData.motivo === "Transferência (Envio)" || formData.motivo === "Transferência (Recebimento)") && (
            <div className="p-2 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Origem (Fazenda/Local)</Label>
                  <Input 
                    value={formData.transferencia_origem} 
                    onChange={(e) => setFormData({ ...formData, transferencia_origem: e.target.value })} 
                    className="h-9 text-sm" 
                    placeholder="De onde veio/saiu" 
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Destino (Fazenda/Local)</Label>
                  <Input 
                    value={formData.transferencia_destino} 
                    onChange={(e) => setFormData({ ...formData, transferencia_destino: e.target.value })} 
                    className="h-9 text-sm" 
                    placeholder="Para onde foi/veio" 
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Nota Fiscal</Label>
                  <Input value={formData.nota_fiscal} onChange={(e) => setFormData({ ...formData, nota_fiscal: e.target.value })} className="h-9 text-sm" placeholder="Nº" />
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-medium">GTA</Label>
                  <Input value={formData.gta} onChange={(e) => setFormData({ ...formData, gta: e.target.value })} className="h-9 text-sm" placeholder="Nº" />
                </div>
              </div>
            </div>
          )}

          {/* Campos para Morte */}
          {formData.motivo === "Morte" && (
            <div className="p-2 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="space-y-1">
                <Label className="text-sm font-medium">Causa da Morte</Label>
                <Input 
                  value={formData.causa_morte} 
                  onChange={(e) => setFormData({ ...formData, causa_morte: e.target.value })} 
                  className="h-9 text-sm" 
                  placeholder="Descreva a causa da morte" 
                />
              </div>
            </div>
          )}

          {/* Campos para Abate */}
          {formData.motivo === "Abate" && (
            <div className="p-2 bg-orange-50 border border-orange-200 rounded-lg">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Frigorífico</Label>
                  <Input value={formData.destino_abate} onChange={(e) => setFormData({ ...formData, destino_abate: e.target.value })} className="h-9 text-sm" placeholder="Nome" />
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Vlr/@ (R$)</Label>
                  <Input type="number" step="0.01" value={formData.valor_unitario} onChange={(e) => setFormData({ ...formData, valor_unitario: e.target.value })} className="h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Vlr Total</Label>
                  <Input type="number" value={formData.valor_total} className="h-9 text-sm bg-slate-50" readOnly />
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-medium">GTA</Label>
                  <Input value={formData.gta} onChange={(e) => setFormData({ ...formData, gta: e.target.value })} className="h-9 text-sm" placeholder="Nº" />
                </div>
              </div>
            </div>
          )}

          {/* Observações */}
          <div className="space-y-1">
            <Label className="text-sm font-medium">Observações</Label>
            <Input value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} className="h-9 text-sm" placeholder="Observações adicionais..." />
          </div>

          {/* Botões */}
          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
              <X className="w-3.5 h-3.5 mr-1" />
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={createMutation.isPending}>
              <Save className="w-3.5 h-3.5 mr-1" />
              {createMutation.isPending ? 'Salvando...' : (item ? 'Atualizar' : 'Salvar')}
            </Button>
          </div>
        </form>

        {/* Dialog para adicionar marca */}
        <Dialog open={showAddMarca} onOpenChange={setShowAddMarca}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm">Nova Marca</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Nome da Marca</Label>
                <Input value={novaMarca} onChange={(e) => setNovaMarca(e.target.value.toUpperCase())} className="h-8 text-xs uppercase" placeholder="Ex: NELORE, ANGUS..." />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowAddMarca(false)} className="h-7 text-xs">Cancelar</Button>
                <Button type="button" size="sm" onClick={handleAddMarca} className="h-7 text-xs">Salvar</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}