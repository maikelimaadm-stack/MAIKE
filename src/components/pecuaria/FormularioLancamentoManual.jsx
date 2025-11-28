import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Save, X, Plus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import ComboboxComNovo from "./ComboboxComNovo";

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

export default function FormularioLancamentoManual({ item, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

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

  const { data: categoriasManejo = [] } = useQuery({
    queryKey: ['categorias-manejo', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CategoriaManejo.list();
      return all.filter(c => c.empresa_id === empresaSelecionadaId && c.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });



  // Carregar todas as movimentações para extrair dados únicos
  const { data: movimentacoes = [] } = useQuery({
    queryKey: ['movimentacoes-pecuaria-dados', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoPecuaria.list();
      return all.filter(m => m.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Extrair dados únicos das movimentações existentes
  const marcasExistentes = [...new Set(movimentacoes.map(m => m.marca).filter(Boolean))].sort();
  const fornecedoresExistentes = [...new Set(movimentacoes.map(m => m.fornecedor_origem).filter(Boolean))].sort();
  const compradoresExistentes = [...new Set(movimentacoes.map(m => m.destino_venda).filter(Boolean))].sort();
  const causasMorteExistentes = [...new Set(movimentacoes.map(m => m.causa_morte).filter(Boolean))].sort();
  const origensTransfExistentes = [...new Set(movimentacoes.map(m => m.transferencia_origem).filter(Boolean))].sort();
  const destinosTransfExistentes = [...new Set(movimentacoes.map(m => m.transferencia_destino).filter(Boolean))].sort();

  // Extrair categorias já lançadas nas movimentações
  const categoriasLancadas = useMemo(() => {
    const cats = [...new Set(movimentacoes.map(m => m.categoria_animal).filter(Boolean))];
    return cats.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [movimentacoes]);

  // Calcular saldo por categoria (entradas - saídas)
  const saldoPorCategoria = useMemo(() => {
    const saldos = {};
    
    movimentacoes.forEach(mov => {
      const categoria = mov.categoria_animal;
      if (!categoria) return;
      
      if (!saldos[categoria]) {
        saldos[categoria] = 0;
      }
      
      const qtd = mov.quantidade_animais || 0;
      
      if (mov.tipo === "Entrada") {
        saldos[categoria] += qtd;
      } else if (mov.tipo === "Saída") {
        saldos[categoria] -= qtd;
      }
      
      // Mudança de categoria
      if (mov.motivo === "Mudança de Categoria" && mov.categoria_nova && mov.tipo === "Entrada") {
        saldos[categoria] -= qtd;
        if (!saldos[mov.categoria_nova]) saldos[mov.categoria_nova] = 0;
        saldos[mov.categoria_nova] += qtd;
      }
    });
    
    return saldos;
  }, [movimentacoes]);

  // Calcular saldo por marca (entradas - saídas)
  const saldoPorMarca = useMemo(() => {
    const saldos = {};
    
    movimentacoes.forEach(mov => {
      const marca = mov.marca;
      if (!marca) return;
      
      if (!saldos[marca]) {
        saldos[marca] = 0;
      }
      
      const qtd = mov.quantidade_animais || 0;
      
      if (mov.tipo === "Entrada") {
        saldos[marca] += qtd;
      } else if (mov.tipo === "Saída") {
        saldos[marca] -= qtd;
      }
    });
    
    return saldos;
  }, [movimentacoes]);

  // Marcas com saldo > 0 para saída
  const marcasComSaldo = useMemo(() => {
    return Object.entries(saldoPorMarca)
      .filter(([_, saldo]) => saldo > 0)
      .map(([marca]) => marca)
      .sort();
  }, [saldoPorMarca]);

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
        categoria_nova: data.categoria_nova || null,
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
        transferencia_origem: data.transferencia_origem || null,
        transferencia_destino: data.transferencia_destino || null,
        observacoes: data.observacoes || null,
      };

      if (item) {
        return base44.entities.MovimentacaoPecuaria.update(item.id, payload);
      }
      return base44.entities.MovimentacaoPecuaria.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-pecuaria'] });
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-pecuaria-dados'] });
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
              {formData.tipo === "Saída" ? (
                // Na saída, mostrar apenas categorias que têm saldo > 0
                <Select value={formData.categoria_animal} onValueChange={(v) => {
                  const catEncontrada = categoriasManejo.find(c => c.nome === v);
                  setFormData({ ...formData, categoria_animal: v, sexo: catEncontrada?.sexo || formData.sexo });
                }}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoriasLancadas.length > 0 ? (
                      categoriasLancadas.map(cat => {
                        const saldo = saldoPorCategoria[cat] || 0;
                        return (
                          <SelectItem key={cat} value={cat} className="text-sm" disabled={saldo <= 0}>
                            <div className="flex items-center justify-between w-full gap-2">
                              <span>{cat}</span>
                              <Badge variant={saldo > 0 ? "default" : "destructive"} className="text-[10px] px-1.5 py-0">
                                {saldo} cab
                              </Badge>
                            </div>
                          </SelectItem>
                        );
                      })
                    ) : (
                      <SelectItem value={null} disabled className="text-sm text-slate-500">
                        Nenhuma categoria com saldo
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              ) : (
                // Na entrada, usar Select com categorias de manejo cadastradas
                <Select value={formData.categoria_animal} onValueChange={(v) => {
                  const catEncontrada = categoriasManejo.find(c => c.nome === v);
                  setFormData({ ...formData, categoria_animal: v, sexo: catEncontrada?.sexo || formData.sexo });
                }}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoriasManejo.length > 0 ? (
                      categoriasManejo.map(cat => (
                        <SelectItem key={cat.id} value={cat.nome} className="text-sm">
                          {cat.nome} {cat.sexo ? `(${cat.sexo})` : ''}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value={null} disabled className="text-sm text-slate-500">
                        Cadastre categorias primeiro
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              )}
              {formData.tipo === "Saída" && formData.categoria_animal && (
                <div className="flex items-center gap-1 text-xs mt-1">
                  <span className="text-slate-500">Saldo disponível:</span>
                  <span className={`font-semibold ${(saldoPorCategoria[formData.categoria_animal] || 0) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {saldoPorCategoria[formData.categoria_animal] || 0} cab
                  </span>
                  {formData.quantidade_animais > (saldoPorCategoria[formData.categoria_animal] || 0) && (
                    <span className="text-red-600 flex items-center gap-0.5">
                      <AlertTriangle className="w-3 h-3" />
                      Excede saldo!
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-sm font-medium">Marca</Label>
              {formData.tipo === "Saída" ? (
                // Na saída, mostrar apenas marcas que têm saldo > 0
                <Select value={formData.marca} onValueChange={(v) => setFormData({ ...formData, marca: v })}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {marcasExistentes.length > 0 ? (
                      marcasExistentes.map(marca => {
                        const saldo = saldoPorMarca[marca] || 0;
                        return (
                          <SelectItem key={marca} value={marca} className="text-sm" disabled={saldo <= 0}>
                            <div className="flex items-center justify-between w-full gap-2">
                              <span>{marca}</span>
                              <Badge variant={saldo > 0 ? "default" : "destructive"} className="text-[10px] px-1.5 py-0">
                                {saldo} cab
                              </Badge>
                            </div>
                          </SelectItem>
                        );
                      })
                    ) : (
                      <SelectItem value={null} disabled className="text-sm text-slate-500">
                        Nenhuma marca com saldo
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              ) : (
                // Na entrada, usar ComboboxComNovo
                <ComboboxComNovo
                  value={formData.marca}
                  onChange={(v) => setFormData({ ...formData, marca: v })}
                  options={marcasExistentes}
                  placeholder="Selecione ou digite..."
                />
              )}
              {formData.tipo === "Saída" && formData.marca && (
                <div className="flex items-center gap-1 text-xs mt-1">
                  <span className="text-slate-500">Saldo disponível:</span>
                  <span className={`font-semibold ${(saldoPorMarca[formData.marca] || 0) > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                    {saldoPorMarca[formData.marca] || 0} cab
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-1">
                <Label className="text-sm font-medium">Sexo</Label>
                <Input
                  value={formData.sexo || ""}
                  readOnly
                  disabled
                  className="h-9 text-sm bg-slate-100 cursor-not-allowed"
                  placeholder="Definido pela categoria"
                />
                <p className="text-[10px] text-slate-500">Preenchido automaticamente pela categoria</p>
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
                  <Label className="text-sm font-medium">Categoria Atual (De)</Label>
                  <Select value={formData.categoria_animal} onValueChange={(v) => setFormData({ ...formData, categoria_animal: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="De qual categoria?" />
                    </SelectTrigger>
                    <SelectContent>
                      {categoriasLancadas.map(cat => {
                        const saldo = saldoPorCategoria[cat] || 0;
                        return (
                          <SelectItem key={cat} value={cat} className="text-sm" disabled={saldo <= 0}>
                            <div className="flex items-center justify-between w-full gap-2">
                              <span>{cat}</span>
                              <Badge variant={saldo > 0 ? "default" : "destructive"} className="text-[10px] px-1.5 py-0">
                                {saldo} cab
                              </Badge>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {formData.categoria_animal && (
                    <div className="text-xs text-slate-500">
                      Saldo: <span className="font-semibold">{saldoPorCategoria[formData.categoria_animal] || 0} cab</span>
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Nova Categoria (Para)</Label>
                  <Select value={formData.categoria_nova} onValueChange={(v) => setFormData({ ...formData, categoria_nova: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Para qual categoria?" />
                    </SelectTrigger>
                    <SelectContent>
                      {categoriasManejo.map(cat => (
                        <SelectItem key={cat.id} value={cat.nome} className="text-sm">
                          {cat.nome} {cat.sexo ? `(${cat.sexo})` : ''}
                        </SelectItem>
                      ))}
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
                  <ComboboxComNovo
                    value={formData.tipo === "Entrada" ? formData.fornecedor_origem : formData.destino_venda}
                    onChange={(v) => {
                      if (formData.tipo === "Entrada") {
                        setFormData({ ...formData, fornecedor_origem: v });
                      } else {
                        setFormData({ ...formData, destino_venda: v });
                      }
                    }}
                    options={formData.tipo === "Entrada" ? fornecedoresExistentes : compradoresExistentes}
                    placeholder="Selecione ou digite..."
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

          {/* Campos para Abate */}
          {formData.motivo === "Abate" && (
            <div className="p-2 bg-orange-50 border border-orange-200 rounded-lg">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Comprador/Frigorífico</Label>
                  <ComboboxComNovo
                    value={formData.destino_venda}
                    onChange={(v) => setFormData({ ...formData, destino_venda: v })}
                    options={compradoresExistentes}
                    placeholder="Selecione ou digite..."
                  />
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
                  <ComboboxComNovo
                    value={formData.transferencia_origem}
                    onChange={(v) => setFormData({ ...formData, transferencia_origem: v })}
                    options={origensTransfExistentes}
                    placeholder="De onde veio/saiu"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Destino (Fazenda/Local)</Label>
                  <ComboboxComNovo
                    value={formData.transferencia_destino}
                    onChange={(v) => setFormData({ ...formData, transferencia_destino: v })}
                    options={destinosTransfExistentes}
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
                <ComboboxComNovo
                  value={formData.causa_morte}
                  onChange={(v) => setFormData({ ...formData, causa_morte: v })}
                  options={causasMorteExistentes}
                  placeholder="Selecione ou digite a causa..."
                />
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
      </CardContent>
    </Card>
  );
}