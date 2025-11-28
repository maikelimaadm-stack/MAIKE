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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

// Categorias serão carregadas das Categorias de Manejo cadastradas

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
  const [showAddMarca, setShowAddMarca] = useState(false);
  const [novaMarca, setNovaMarca] = useState("");

  const [formData, setFormData] = useState({
    tipo: item?.tipo || "",
    data_movimentacao: item?.data_movimentacao?.split('T')[0] || new Date().toISOString().split('T')[0],
    lote_id: item?.lote_id || "",
    lote: item?.lote || "",
    quantidade_animais: item?.quantidade_animais || 1,
    categoria_animal: item?.categoria_animal || "",
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
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Linha 1: Tipo, Data, Quantidade, Sexo */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Tipo *</Label>
              <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_MOVIMENTACAO.map(tipo => (
                    <SelectItem key={tipo.value} value={tipo.value} className="text-xs">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${tipo.cor}`}>{tipo.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Data *</Label>
              <Input
                type="date"
                value={formData.data_movimentacao}
                onChange={(e) => setFormData({ ...formData, data_movimentacao: e.target.value })}
                className="h-8 text-xs"
                required
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Qtd Animais *</Label>
              <Input
                type="number"
                min="1"
                value={formData.quantidade_animais}
                onChange={(e) => setFormData({ ...formData, quantidade_animais: e.target.value })}
                className="h-8 text-xs"
                required
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Peso Médio</Label>
              <Input
                type="number"
                step="0.1"
                value={formData.peso_medio}
                onChange={(e) => setFormData({ ...formData, peso_medio: e.target.value })}
                className="h-8 text-xs"
                placeholder="kg"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Peso Total</Label>
              <Input
                type="number"
                step="0.1"
                value={formData.peso_total}
                className="h-8 text-xs bg-slate-50"
                readOnly
              />
            </div>
          </div>

          {/* Linha 2: Lote, Categoria, Marca, Sexo */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <div className="space-y-1 col-span-2 md:col-span-1">
              <Label className="text-xs">Lote</Label>
              <Select value={formData.lote_id} onValueChange={handleLoteChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sem_lote" className="text-xs">Sem lote</SelectItem>
                  {lotes.map(lote => (
                    <SelectItem key={lote.id} value={lote.id} className="text-xs">
                      {lote.nome} ({lote.quantidade_cabecas || 0})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Categoria</Label>
              <Select value={formData.categoria_animal} onValueChange={(v) => setFormData({ ...formData, categoria_animal: v })}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {categoriasManejo.length > 0 ? (
                    categoriasManejo.map(cat => (
                      <SelectItem key={cat.id} value={cat.nome} className="text-xs">
                        {cat.sigla} - {cat.nome}
                      </SelectItem>
                    ))
                  ) : (
                    <>
                      <SelectItem value="Bezerro(a)" className="text-xs">Bezerro(a)</SelectItem>
                      <SelectItem value="Novilho(a)" className="text-xs">Novilho(a)</SelectItem>
                      <SelectItem value="Garrote" className="text-xs">Garrote</SelectItem>
                      <SelectItem value="Boi" className="text-xs">Boi</SelectItem>
                      <SelectItem value="Vaca" className="text-xs">Vaca</SelectItem>
                      <SelectItem value="Touro" className="text-xs">Touro</SelectItem>
                      <SelectItem value="Matriz" className="text-xs">Matriz</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Marca</Label>
              <div className="flex gap-1">
                <Select value={formData.marca} onValueChange={(v) => setFormData({ ...formData, marca: v })}>
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sem_marca" className="text-xs">Sem marca</SelectItem>
                    {marcasDisponiveis.map(marca => (
                      <SelectItem key={marca} value={marca} className="text-xs">{marca}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setShowAddMarca(true)}>
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Sexo</Label>
              <Select value={formData.sexo} onValueChange={(v) => setFormData({ ...formData, sexo: v })}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Sel." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Macho" className="text-xs">Macho</SelectItem>
                  <SelectItem value="Fêmea" className="text-xs">Fêmea</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Campos para Entrada/Compra */}
          {mostrarCamposEntrada && (
            <div className="p-2 bg-green-50 border border-green-200 rounded-lg space-y-2">
              <h4 className="text-xs font-semibold text-green-800">Dados da Entrada/Compra</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Fornecedor</Label>
                  <Select value={formData.fornecedor_origem} onValueChange={(v) => setFormData({ ...formData, fornecedor_origem: v })}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {fornecedores.map(f => (
                        <SelectItem key={f.id} value={f.nome} className="text-xs">{f.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Área Destino</Label>
                  <Select value={formData.area_destino_id} onValueChange={(v) => setFormData({ ...formData, area_destino_id: v })}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Área" />
                    </SelectTrigger>
                    <SelectContent>
                      {areas.map(area => (
                        <SelectItem key={area.id} value={area.id} className="text-xs">
                          {area.sigla ? `${area.sigla} - ` : ''}{area.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Vlr Unit. (R$)</Label>
                  <Input type="number" step="0.01" value={formData.valor_unitario} onChange={(e) => setFormData({ ...formData, valor_unitario: e.target.value })} className="h-8 text-xs" placeholder="0,00" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Vlr Total</Label>
                  <Input type="number" value={formData.valor_total} className="h-8 text-xs bg-slate-50" readOnly />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">NF</Label>
                  <Input value={formData.nota_fiscal} onChange={(e) => setFormData({ ...formData, nota_fiscal: e.target.value })} className="h-8 text-xs" placeholder="Nº" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">GTA</Label>
                  <Input value={formData.gta} onChange={(e) => setFormData({ ...formData, gta: e.target.value })} className="h-8 text-xs" placeholder="Nº" />
                </div>
              </div>
            </div>
          )}

          {/* Campos para Saída/Venda */}
          {mostrarCamposSaida && (
            <div className="p-2 bg-red-50 border border-red-200 rounded-lg space-y-2">
              <h4 className="text-xs font-semibold text-red-800">Dados da Saída/Venda</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Área Origem</Label>
                  <Select value={formData.area_origem_id} onValueChange={(v) => setFormData({ ...formData, area_origem_id: v })}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Área" />
                    </SelectTrigger>
                    <SelectContent>
                      {areas.map(area => (
                        <SelectItem key={area.id} value={area.id} className="text-xs">{area.sigla ? `${area.sigla} - ` : ''}{area.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Comprador</Label>
                  <Input value={formData.destino_venda} onChange={(e) => setFormData({ ...formData, destino_venda: e.target.value })} className="h-8 text-xs" placeholder="Nome" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Vlr Unit.</Label>
                  <Input type="number" step="0.01" value={formData.valor_unitario} onChange={(e) => setFormData({ ...formData, valor_unitario: e.target.value })} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Vlr Total</Label>
                  <Input type="number" value={formData.valor_total} className="h-8 text-xs bg-slate-50" readOnly />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">NF</Label>
                  <Input value={formData.nota_fiscal} onChange={(e) => setFormData({ ...formData, nota_fiscal: e.target.value })} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">GTA</Label>
                  <Input value={formData.gta} onChange={(e) => setFormData({ ...formData, gta: e.target.value })} className="h-8 text-xs" />
                </div>
              </div>
            </div>
          )}

          {/* Campos para Transferência */}
          {mostrarCamposTransferencia && (
            <div className="p-2 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
              <h4 className="text-xs font-semibold text-blue-800">Transferência entre Áreas</h4>
              <div className="grid grid-cols-3 gap-2 items-end">
                <div className="space-y-1">
                  <Label className="text-xs">Origem</Label>
                  <Select value={formData.area_origem_id} onValueChange={(v) => setFormData({ ...formData, area_origem_id: v })}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="De onde?" />
                    </SelectTrigger>
                    <SelectContent>
                      {areas.map(area => (
                        <SelectItem key={area.id} value={area.id} className="text-xs">{area.sigla ? `${area.sigla} - ` : ''}{area.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-center">
                  <ArrowRight className="w-5 h-5 text-blue-500" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Destino</Label>
                  <Select value={formData.area_destino_id} onValueChange={(v) => setFormData({ ...formData, area_destino_id: v })}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Para onde?" />
                    </SelectTrigger>
                    <SelectContent>
                      {areas.map(area => (
                        <SelectItem key={area.id} value={area.id} className="text-xs">{area.sigla ? `${area.sigla} - ` : ''}{area.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Campos para Morte */}
          {mostrarCamposMorte && (
            <div className="p-2 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
              <h4 className="text-xs font-semibold text-gray-800">Dados da Morte</h4>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Área</Label>
                  <Select value={formData.area_origem_id} onValueChange={(v) => setFormData({ ...formData, area_origem_id: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Onde?" /></SelectTrigger>
                    <SelectContent>
                      {areas.map(area => (<SelectItem key={area.id} value={area.id} className="text-xs">{area.sigla ? `${area.sigla} - ` : ''}{area.nome}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Causa</Label>
                  <Select value={formData.causa_morte} onValueChange={(v) => setFormData({ ...formData, causa_morte: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Causa" /></SelectTrigger>
                    <SelectContent>
                      {CAUSAS_MORTE.map(causa => (<SelectItem key={causa} value={causa} className="text-xs">{causa}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Campos para Abate */}
          {mostrarCamposAbate && (
            <div className="p-2 bg-orange-50 border border-orange-200 rounded-lg space-y-2">
              <h4 className="text-xs font-semibold text-orange-800">Dados do Abate</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Área</Label>
                  <Select value={formData.area_origem_id} onValueChange={(v) => setFormData({ ...formData, area_origem_id: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Área" /></SelectTrigger>
                    <SelectContent>
                      {areas.map(area => (<SelectItem key={area.id} value={area.id} className="text-xs">{area.sigla ? `${area.sigla} - ` : ''}{area.nome}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Frigorífico</Label>
                  <Input value={formData.destino_abate} onChange={(e) => setFormData({ ...formData, destino_abate: e.target.value })} className="h-8 text-xs" placeholder="Nome" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Vlr/@</Label>
                  <Input type="number" step="0.01" value={formData.valor_unitario} onChange={(e) => setFormData({ ...formData, valor_unitario: e.target.value })} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Total</Label>
                  <Input type="number" value={formData.valor_total} className="h-8 text-xs bg-slate-50" readOnly />
                </div>
              </div>
            </div>
          )}

          {/* Campos para Nascimento */}
          {mostrarCamposNascimento && (
            <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg space-y-2">
              <h4 className="text-xs font-semibold text-emerald-800">Nascimento</h4>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Área</Label>
                  <Select value={formData.area_destino_id} onValueChange={(v) => setFormData({ ...formData, area_destino_id: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Onde?" /></SelectTrigger>
                    <SelectContent>
                      {areas.map(area => (<SelectItem key={area.id} value={area.id} className="text-xs">{area.sigla ? `${area.sigla} - ` : ''}{area.nome}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Campos para Pesagem */}
          {mostrarCamposPesagem && (
            <div className="p-2 bg-cyan-50 border border-cyan-200 rounded-lg space-y-2">
              <h4 className="text-xs font-semibold text-cyan-800">Pesagem</h4>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Área</Label>
                  <Select value={formData.area_origem_id} onValueChange={(v) => setFormData({ ...formData, area_origem_id: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Onde?" /></SelectTrigger>
                    <SelectContent>
                      {areas.map(area => (<SelectItem key={area.id} value={area.id} className="text-xs">{area.sigla ? `${area.sigla} - ` : ''}{area.nome}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Observações */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Motivo</Label>
              <Input value={formData.motivo} onChange={(e) => setFormData({ ...formData, motivo: e.target.value })} className="h-8 text-xs" placeholder="Motivo/Justificativa" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Observações</Label>
              <Input value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} className="h-8 text-xs" placeholder="Obs..." />
            </div>
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