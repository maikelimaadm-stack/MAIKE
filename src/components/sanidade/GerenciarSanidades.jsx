import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Edit2, Settings } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function GerenciarSanidades({ open, onOpenChange, empresaId, numeroAnimal, apartacaoSelecionada, lotesApartacaoAtual, pesagensDia }) {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [tab, setTab] = useState(numeroAnimal ? 'aplicar' : 'sanidades'); // 'aplicar', 'sanidades' ou 'medicamentos'

  // Estados de configuração
  const [nomeSanidade, setNomeSanidade] = useState("");
  const [editingConfigId, setEditingConfigId] = useState(null);
  const [configuracaoSelecionada, setConfiguracaoSelecionada] = useState("");

  // Estados de item
  const [medicamento, setMedicamento] = useState("");
  const [finalidade, setFinalidade] = useState("");
  const [quantidadePadrao, setQuantidadePadrao] = useState("");
  const [unidadeMedida, setUnidadeMedida] = useState("ml");
  const [custoUnitario, setCustoUnitario] = useState("");
  const [editingItemId, setEditingItemId] = useState(null);

  // Buscar configurações
  const { data: configuracoes = [] } = useQuery({
    queryKey: ['configuracoes-sanidade', empresaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoSanidade.list();
      return all.filter(c => c.empresa_id === empresaId && c.ativo);
    },
    enabled: !!empresaId && open,
  });

  // Buscar itens da configuração selecionada
  const { data: itens = [] } = useQuery({
    queryKey: ['itens-sanidade', configuracaoSelecionada],
    queryFn: async () => {
      const all = await base44.entities.ItemSanidade.list();
      return all.filter(i => i.configuracao_sanidade_id === configuracaoSelecionada);
    },
    enabled: !!configuracaoSelecionada && open,
  });
  
  // Buscar todos os itens
  const { data: itensParaAplicar = [] } = useQuery({
    queryKey: ['itens-sanidade-todos'],
    queryFn: async () => {
      const all = await base44.entities.ItemSanidade.list();
      return all;
    },
    enabled: open,
  });

  const configAtual = useMemo(() => {
    return configuracoes.find(c => c.id === configuracaoSelecionada);
  }, [configuracoes, configuracaoSelecionada]);

  // Buscar sanidades aplicadas
  const { data: sanidadesAplicadas = [] } = useQuery({
    queryKey: ['sanidades-aplicadas', empresaId],
    queryFn: async () => {
      const all = await base44.entities.SanidadeAnimal.list();
      return all.filter(s => s.empresa_id === empresaId);
    },
    enabled: !!empresaId && open,
  });

  // Mutations
  const deleteConfigMutation = useMutation({
    mutationFn: async (id) => {
      // Verificar se está em uso
      const emUso = sanidadesAplicadas.some(s => s.configuracao_sanidade_id === id);
      if (emUso) {
        throw new Error("Esta sanidade já foi aplicada em animais e não pode ser excluída!");
      }
      return base44.entities.ConfiguracaoSanidade.update(id, { ativo: false });
    },
    onSuccess: () => {
      toast.success("Sanidade removida!");
      queryClient.invalidateQueries({ queryKey: ['configuracoes-sanidade'] });
      setConfiguracaoSelecionada("");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (itemId) => {
      // Buscar o item para verificar qual configuração
      const item = itens.find(i => i.id === itemId);
      if (!item) return;
      
      // Verificar se a configuração está em uso
      const emUso = sanidadesAplicadas.some(s => s.configuracao_sanidade_id === item.configuracao_sanidade_id);
      if (emUso) {
        throw new Error("Não é possível excluir medicamentos de sanidades já aplicadas!");
      }
      
      return base44.entities.ItemSanidade.delete(itemId);
    },
    onSuccess: () => {
      toast.success("Item excluído!");
      queryClient.invalidateQueries({ queryKey: ['itens-sanidade'] });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
  


  const handleSalvarConfiguracao = async () => {
    if (!nomeSanidade.trim()) {
      toast.error("Nome obrigatório!");
      return;
    }

    setIsSaving(true);
    try {
      if (editingConfigId) {
        await base44.entities.ConfiguracaoSanidade.update(editingConfigId, {
          nome_sanidade: nomeSanidade.trim()
        });
        toast.success("Sanidade atualizada!");
      } else {
        const created = await base44.entities.ConfiguracaoSanidade.create({
          empresa_id: empresaId,
          nome_sanidade: nomeSanidade.trim(),
          ativo: true,
        });
        setConfiguracaoSelecionada(created.id);
        toast.success("Sanidade criada!");
      }
      queryClient.invalidateQueries({ queryKey: ['configuracoes-sanidade'] });
      setNomeSanidade("");
      setEditingConfigId(null);
    } catch (error) {
      toast.error("Erro: " + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSalvarItem = async () => {
    if (!configuracaoSelecionada) {
      toast.error("Selecione uma sanidade primeiro!");
      return;
    }
    if (!medicamento.trim()) {
      toast.error("Medicamento obrigatório!");
      return;
    }

    setIsSaving(true);
    const data = {
      empresa_id: empresaId,
      configuracao_sanidade_id: configuracaoSelecionada,
      nome_sanidade: configAtual?.nome_sanidade || "",
      medicamento: medicamento.trim(),
      finalidade: finalidade.trim() || null,
      quantidade_padrao: quantidadePadrao ? parseFloat(quantidadePadrao) : null,
      unidade_medida: unidadeMedida,
      custo_unitario: custoUnitario ? parseFloat(custoUnitario) : null,
    };

    try {
      if (editingItemId) {
        await base44.entities.ItemSanidade.update(editingItemId, data);
        toast.success("Item atualizado!");
      } else {
        await base44.entities.ItemSanidade.create(data);
        toast.success("Item adicionado!");
      }
      queryClient.invalidateQueries({ queryKey: ['itens-sanidade'] });
      setMedicamento("");
      setFinalidade("");
      setQuantidadePadrao("");
      setCustoUnitario("");
      setEditingItemId(null);
    } catch (error) {
      toast.error("Erro: " + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-700">
            <Settings className="w-5 h-5" />
            Gerenciar Sanidades
          </DialogTitle>
        </DialogHeader>

        {/* Abas */}
        <Tabs value={tab} onValueChange={setTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="aplicar" className="text-xs">Aplicar Sanidade</TabsTrigger>
            <TabsTrigger value="sanidades" className="text-xs">Cadastro de Sanidades</TabsTrigger>
            <TabsTrigger value="medicamentos" className="text-xs">Cadastro de Medicamentos</TabsTrigger>
          </TabsList>

          {/* ABA: APLICAR SANIDADE */}
          <TabsContent value="aplicar" className="flex-1 overflow-auto space-y-4 mt-4">
            <div className="bg-white border border-slate-200 rounded p-3">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Sanidades Disponíveis - Aplicar nos Animais Lançados</h3>

              <div className="bg-blue-50 border border-blue-200 rounded p-2 mb-3">
                <p className="text-xs text-blue-800">
                  ℹ️ Selecione uma sanidade abaixo para aplicar nos <strong>{pesagensDia?.filter(p => p.apartacao_id === apartacaoSelecionada).length || 0} animais</strong> pesados nesta apartação hoje.
                </p>
              </div>

              {configuracoes.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-400">
                  Nenhuma sanidade cadastrada. Vá para a aba "Cadastro de Sanidades" para criar.
                </div>
              ) : (
                <div className="space-y-3">
                  {configuracoes.map(c => {
                    const itens = itensParaAplicar.filter(i => i.configuracao_sanidade_id === c.id);
                    const custoTotal = itens.reduce((s, i) => s + ((i.quantidade_padrao || 0) * (i.custo_unitario || 0)), 0);

                    return (
                      <Card key={c.id} className="border-emerald-200 bg-white">
                        <CardContent className="p-3">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex-1">
                              <h4 className="font-semibold text-emerald-800">{c.nome_sanidade}</h4>
                              <div className="text-xs font-bold text-emerald-700 mt-1">
                                Custo por animal: R$ {custoTotal.toFixed(2)}
                              </div>
                            </div>
                            <Button 
                              onClick={async () => {
                                if (!apartacaoSelecionada) {
                                  toast.error("Selecione uma apartação primeiro!");
                                  return;
                                }

                                const animaisParaAplicar = pesagensDia
                                  ?.filter(p => p.apartacao_id === apartacaoSelecionada)
                                  .map(p => p.numero_animal) || [];

                                if (animaisParaAplicar.length === 0) {
                                  toast.error("Nenhum animal pesado nesta apartação hoje!");
                                  return;
                                }

                                if (itens.length === 0) {
                                  toast.error("Esta sanidade não possui medicamentos cadastrados!");
                                  return;
                                }

                                if (!confirm(`Aplicar "${c.nome_sanidade}" em ${animaisParaAplicar.length} animal(is)?`)) return;

                                setIsSaving(true);
                                try {
                                  const registros = [];
                                  for (const numAnimal of animaisParaAplicar) {
                                    for (const item of itens) {
                                      const qtd = item.quantidade_padrao || 0;
                                      const custo = item.custo_unitario || 0;
                                      registros.push({
                                        empresa_id: empresaId,
                                        configuracao_sanidade_id: c.id,
                                        nome_sanidade: c.nome_sanidade,
                                        numero_animal: numAnimal,
                                        data_aplicacao: dataAplicacao,
                                        medicamento: item.medicamento,
                                        finalidade: item.finalidade || null,
                                        quantidade: qtd,
                                        unidade_medida: item.unidade_medida,
                                        custo_unitario: custo > 0 ? custo : null,
                                        custo_total: (qtd * custo) > 0 ? qtd * custo : null,
                                        observacao: null,
                                      });
                                    }
                                  }

                                  await base44.entities.SanidadeAnimal.bulkCreate(registros);

                                  const custoTotalGeral = registros.reduce((s, r) => s + (r.custo_total || 0), 0);
                                  const custoPorAnimal = custoTotalGeral / animaisParaAplicar.length;

                                  toast.success(`✓ "${c.nome_sanidade}" aplicada em ${animaisParaAplicar.length} animais! Total: R$ ${custoTotalGeral.toFixed(2)} (R$ ${custoPorAnimal.toFixed(2)}/animal)`);
                                  queryClient.invalidateQueries({ queryKey: ['sanidade'] });
                                  onOpenChange(false);
                                } catch (error) {
                                  toast.error("Erro: " + error.message);
                                } finally {
                                  setIsSaving(false);
                                }
                              }}
                              disabled={isSaving || itens.length === 0}
                              size="sm" 
                              className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Aplicar
                            </Button>
                          </div>
                          {itens.length > 0 && (
                            <div className="space-y-1 mt-2">
                              {itens.map((item, idx) => (
                                <div key={idx} className="text-xs text-slate-600 bg-slate-50 rounded px-2 py-1">
                                  • {item.medicamento} {item.finalidade && `(${item.finalidade})`} - {item.quantidade_padrao} {item.unidade_medida}
                                  {item.custo_unitario > 0 && ` - R$ ${((item.quantidade_padrao || 0) * (item.custo_unitario || 0)).toFixed(2)}`}
                                </div>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
              </div>
          </TabsContent>

          {/* ABA: SANIDADES */}
          <TabsContent value="sanidades" className="flex-1 overflow-auto space-y-4 mt-4">
            <Card>
              <CardContent className="p-4">
                {/* Criar/Editar Configuração */}
                <div className="bg-emerald-50 border border-emerald-200 rounded p-3 mb-4">
                  <h3 className="text-xs font-semibold text-emerald-800 mb-3">
                    {editingConfigId ? 'Editar Sanidade' : 'Nova Sanidade'}
                  </h3>
                  <div className="flex gap-2 items-end">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Nome da Sanidade *</Label>
                      <Input
                        value={nomeSanidade}
                        onChange={(e) => setNomeSanidade(e.target.value)}
                        className="h-8 text-xs"
                        placeholder="Ex: Vermifugação Completa"
                      />
                    </div>
                    <Button 
                      onClick={handleSalvarConfiguracao} 
                      disabled={isSaving}
                      size="sm" 
                      className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {isSaving ? 'Salvando...' : (editingConfigId ? 'Atualizar' : 'Criar')}
                    </Button>
                    {editingConfigId && (
                      <Button 
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingConfigId(null);
                          setNomeSanidade("");
                        }}
                        className="h-8 text-xs"
                      >
                        Cancelar
                      </Button>
                    )}
                  </div>
                </div>

                {/* Lista de Configurações */}
                <div>
                  <h3 className="text-xs font-semibold text-slate-700 mb-2">Sanidades Cadastradas</h3>
                  {configuracoes.length === 0 ? (
                    <div className="text-center py-8 text-xs text-slate-400">
                      Nenhuma sanidade cadastrada
                    </div>
                  ) : (
                    <div className="border rounded overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs font-bold py-1 border border-black">Nome da Sanidade</TableHead>
                            <TableHead className="text-xs font-bold py-1 border border-black text-center">Medicamentos</TableHead>
                            <TableHead className="text-xs font-bold py-1 border border-black w-24">Ações</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {configuracoes.map((config) => {
                            const qtdMedicamentos = itens.filter(i => i.configuracao_sanidade_id === config.id).length;
                            return (
                              <TableRow 
                                key={config.id} 
                                className="hover:bg-gray-50"
                              >
                                <TableCell className="text-xs py-2 border border-gray-300 font-medium">
                                  {config.nome_sanidade}
                                </TableCell>
                                <TableCell className="text-xs py-2 border border-gray-300 text-center">
                                  <Badge variant="outline" className="text-[10px]">
                                    {qtdMedicamentos}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs py-2 border border-gray-300">
                                  <div className="flex gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingConfigId(config.id);
                                        setNomeSanidade(config.nome_sanidade);
                                      }}
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 text-red-500"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm('Remover esta sanidade?')) {
                                          deleteConfigMutation.mutate(config.id);
                                        }
                                      }}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ABA: MEDICAMENTOS */}
          <TabsContent value="medicamentos" className="flex-1 overflow-auto space-y-4 mt-4">
            <Card>
              <CardContent className="p-4">
                {/* Selecionar Sanidade */}
                <div className="mb-4">
                  <Label className="text-xs font-semibold mb-2 block">Selecione a Sanidade *</Label>
                  <Select value={configuracaoSelecionada} onValueChange={setConfiguracaoSelecionada}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Escolha uma sanidade para gerenciar medicamentos" />
                    </SelectTrigger>
                    <SelectContent>
                      {configuracoes.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.nome_sanidade}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Gerenciar Medicamentos */}
                {configuracaoSelecionada && (
                  <div>
              <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-3">
                <h3 className="text-xs font-semibold text-blue-800 mb-3">
                  Medicamentos - {configAtual?.nome_sanidade}
                </h3>
                
                <div className="grid grid-cols-6 gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Medicamento *</Label>
                    <Input
                      value={medicamento}
                      onChange={(e) => setMedicamento(e.target.value)}
                      className="h-8 text-xs"
                      placeholder="Ex: Ivermectina"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Finalidade</Label>
                    <Input
                      value={finalidade}
                      onChange={(e) => setFinalidade(e.target.value)}
                      className="h-8 text-xs"
                      placeholder="Ex: Vermífugo"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Qtd. Padrão</Label>
                    <Input
                      type="number"
                      value={quantidadePadrao}
                      onChange={(e) => setQuantidadePadrao(e.target.value)}
                      className="h-8 text-xs"
                      placeholder="10"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Un.</Label>
                    <Input
                      value={unidadeMedida}
                      onChange={(e) => setUnidadeMedida(e.target.value)}
                      className="h-8 text-xs"
                      placeholder="ml"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Custo Un. (R$)</Label>
                    <Input
                      type="number"
                      value={custoUnitario}
                      onChange={(e) => setCustoUnitario(e.target.value)}
                      className="h-8 text-xs"
                      placeholder="0.00"
                    />
                  </div>
                  <div className="flex gap-1">
                    {editingItemId && (
                      <Button 
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingItemId(null);
                          setMedicamento("");
                          setFinalidade("");
                          setQuantidadePadrao("");
                          setCustoUnitario("");
                        }}
                        className="h-8 text-xs"
                      >
                        Cancelar
                      </Button>
                    )}
                    <Button 
                      onClick={handleSalvarItem} 
                      disabled={isSaving}
                      size="sm" 
                      className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {isSaving ? 'Salvando...' : (editingItemId ? 'Atualizar' : 'Adicionar')}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Lista de Itens */}
              {itens.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-400">
                  Nenhum medicamento cadastrado nesta sanidade
                </div>
              ) : (
                <div className="border rounded overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs font-bold py-1 border border-black">Medicamento</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black">Finalidade</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd. Padrão</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black text-right">Custo Un.</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black text-right">Custo Total</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black w-20">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {itens.map((item) => {
                        const custoTotal = (item.quantidade_padrao || 0) * (item.custo_unitario || 0);
                        return (
                          <TableRow key={item.id} className="hover:bg-gray-50">
                            <TableCell className="text-xs py-1 border border-gray-300 font-medium">{item.medicamento}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{item.finalidade || '-'}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300 text-right">
                              {item.quantidade_padrao} {item.unidade_medida}
                            </TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">
                              {item.custo_unitario ? `R$ ${item.custo_unitario.toFixed(2)}` : '-'}
                            </TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold text-emerald-700">
                              {custoTotal > 0 ? `R$ ${custoTotal.toFixed(2)}` : '-'}
                            </TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => {
                                    setEditingItemId(item.id);
                                    setMedicamento(item.medicamento);
                                    setFinalidade(item.finalidade || "");
                                    setQuantidadePadrao(String(item.quantidade_padrao || ""));
                                    setUnidadeMedida(item.unidade_medida);
                                    setCustoUnitario(String(item.custo_unitario || ""));
                                  }}
                                >
                                  <Edit2 className="w-3 h-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-red-500"
                                  onClick={() => {
                                    if (confirm('Excluir este medicamento?')) {
                                      deleteItemMutation.mutate(item.id);
                                    }
                                  }}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

                    {/* Total da Sanidade */}
                    {itens.length > 0 && (
                      <div className="mt-2 p-2 bg-slate-100 rounded text-xs">
                        <div className="flex justify-between">
                          <span className="font-semibold">Total de Medicamentos:</span>
                          <span>{itens.length}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-semibold">Custo Total por Cabeça:</span>
                          <span className="font-mono text-emerald-700">
                            R$ {itens.reduce((s, i) => s + ((i.quantidade_padrao || 0) * (i.custo_unitario || 0)), 0).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} size="sm" className="h-8 text-xs">
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}