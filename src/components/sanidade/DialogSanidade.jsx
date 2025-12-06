import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Syringe, Settings, Edit2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function DialogSanidade({ 
  open, 
  onOpenChange, 
  numeroAnimal, 
  empresaId, 
  apartacaoSelecionada,
  lotesApartacaoAtual,
  pesagensDia 
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('aplicar');
  const [isSaving, setIsSaving] = useState(false);

  // ===== ABA APLICAR =====
  const [dataAplicacao, setDataAplicacao] = useState(new Date().toISOString().split('T')[0]);
  const [configuracaoSelecionada, setConfiguracaoSelecionada] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [observacao, setObservacao] = useState("");
  const [aplicarEm, setAplicarEm] = useState("animal_atual"); // animal_atual, apartacao, lote_especifico

  // ===== ABA CONFIGURAÇÕES =====
  const [nomeConfiguracao, setNomeConfiguracao] = useState("");
  const [medicamento, setMedicamento] = useState("");
  const [finalidade, setFinalidade] = useState("");
  const [quantidadePadrao, setQuantidadePadrao] = useState("");
  const [unidadeMedida, setUnidadeMedida] = useState("ml");
  const [custoUnitario, setCustoUnitario] = useState("");
  const [editingConfigId, setEditingConfigId] = useState(null);

  // Buscar configurações de sanidade
  const { data: configuracoes = [] } = useQuery({
    queryKey: ['configuracoes-sanidade', empresaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoSanidade.list();
      return all.filter(c => c.empresa_id === empresaId && c.ativo);
    },
    enabled: !!empresaId && open,
  });

  // Buscar registros de sanidade do animal
  const { data: registros = [] } = useQuery({
    queryKey: ['sanidade', numeroAnimal, empresaId],
    queryFn: async () => {
      const all = await base44.entities.SanidadeAnimal.list('-data_aplicacao');
      return all.filter(s => s.numero_animal === numeroAnimal && s.empresa_id === empresaId);
    },
    enabled: !!numeroAnimal && !!empresaId && open,
  });

  const configSelecionada = useMemo(() => {
    return configuracoes.find(c => c.id === configuracaoSelecionada);
  }, [configuracoes, configuracaoSelecionada]);

  // Auto-preencher quando selecionar configuração
  React.useEffect(() => {
    if (configSelecionada) {
      setQuantidade(String(configSelecionada.quantidade_padrao || ""));
      setUnidadeMedida(configSelecionada.unidade_medida || "ml");
    }
  }, [configSelecionada]);

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.SanidadeAnimal.delete(id),
    onSuccess: () => {
      toast.success("Registro excluído!");
      queryClient.invalidateQueries({ queryKey: ['sanidade'] });
    },
  });

  const deleteConfigMutation = useMutation({
    mutationFn: (id) => base44.entities.ConfiguracaoSanidade.update(id, { ativo: false }),
    onSuccess: () => {
      toast.success("Configuração removida!");
      queryClient.invalidateQueries({ queryKey: ['configuracoes-sanidade'] });
    },
  });

  const handleSalvarConfiguracao = async () => {
    if (!nomeConfiguracao.trim()) {
      toast.error("Nome obrigatório!");
      return;
    }
    if (!medicamento.trim()) {
      toast.error("Medicamento obrigatório!");
      return;
    }

    setIsSaving(true);
    const data = {
      empresa_id: empresaId,
      nome_configuracao: nomeConfiguracao.trim(),
      medicamento: medicamento.trim(),
      finalidade: finalidade.trim() || null,
      quantidade_padrao: quantidadePadrao ? parseFloat(quantidadePadrao) : null,
      unidade_medida: unidadeMedida,
      custo_unitario: custoUnitario ? parseFloat(custoUnitario) : null,
      ativo: true,
    };

    try {
      if (editingConfigId) {
        await base44.entities.ConfiguracaoSanidade.update(editingConfigId, data);
        toast.success("Configuração atualizada!");
      } else {
        await base44.entities.ConfiguracaoSanidade.create(data);
        toast.success("Configuração criada!");
      }
      queryClient.invalidateQueries({ queryKey: ['configuracoes-sanidade'] });
      setNomeConfiguracao("");
      setMedicamento("");
      setFinalidade("");
      setQuantidadePadrao("");
      setCustoUnitario("");
      setEditingConfigId(null);
    } catch (error) {
      toast.error("Erro: " + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAplicarSanidade = async () => {
    if (!configuracaoSelecionada) {
      toast.error("Selecione uma configuração!");
      return;
    }
    if (!quantidade || parseFloat(quantidade) <= 0) {
      toast.error("Quantidade obrigatória!");
      return;
    }

    setIsSaving(true);
    const qtd = parseFloat(quantidade);
    const custo = configSelecionada?.custo_unitario || 0;
    const custoTotal = qtd * custo;

    try {
      // Determinar quais animais aplicar
      let animaisParaAplicar = [];
      
      if (aplicarEm === 'animal_atual') {
        animaisParaAplicar = [numeroAnimal];
      } else if (aplicarEm === 'apartacao' && apartacaoSelecionada) {
        animaisParaAplicar = pesagensDia
          .filter(p => p.apartacao_id === apartacaoSelecionada)
          .map(p => p.numero_animal);
      } else if (aplicarEm.startsWith('lote_') && pesagensDia) {
        const loteId = aplicarEm.replace('lote_', '');
        animaisParaAplicar = pesagensDia
          .filter(p => p.lote_id === loteId)
          .map(p => p.numero_animal);
      }

      if (animaisParaAplicar.length === 0) {
        toast.error("Nenhum animal selecionado!");
        setIsSaving(false);
        return;
      }

      // Criar registros para cada animal
      const registros = animaisParaAplicar.map(num => ({
        empresa_id: empresaId,
        configuracao_sanidade_id: configuracaoSelecionada,
        nome_configuracao: configSelecionada.nome_configuracao,
        numero_animal: num,
        data_aplicacao: dataAplicacao,
        medicamento: configSelecionada.medicamento,
        finalidade: configSelecionada.finalidade || null,
        quantidade: qtd,
        unidade_medida: configSelecionada.unidade_medida,
        custo_unitario: custo > 0 ? custo : null,
        custo_total: custoTotal > 0 ? custoTotal : null,
        observacao: observacao.trim() || null,
      }));

      await base44.entities.SanidadeAnimal.bulkCreate(registros);
      
      toast.success(`✓ Sanidade aplicada em ${animaisParaAplicar.length} animal(is)!`);
      queryClient.invalidateQueries({ queryKey: ['sanidade'] });

      // Limpar
      setConfiguracaoSelecionada("");
      setQuantidade("");
      setObservacao("");
    } catch (error) {
      toast.error("Erro: " + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const custoTotalCalc = quantidade && configSelecionada?.custo_unitario
    ? (parseFloat(quantidade) * configSelecionada.custo_unitario).toFixed(2) 
    : "0.00";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-700">
            <Syringe className="w-5 h-5" />
            Sanidade {numeroAnimal && `- Animal ${numeroAnimal}`}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="aplicar" className="text-xs">Aplicar Sanidade</TabsTrigger>
            <TabsTrigger value="configuracoes" className="text-xs">Configurações</TabsTrigger>
            <TabsTrigger value="historico" className="text-xs">Histórico</TabsTrigger>
          </TabsList>

          {/* ABA APLICAR */}
          <TabsContent value="aplicar" className="flex-1 overflow-auto space-y-3 mt-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
              <h3 className="text-xs font-semibold text-emerald-800 mb-3">Aplicar Tratamento</h3>
              
              <div className="grid grid-cols-5 gap-3 items-end">
                <div className="space-y-1">
                  <Label className="text-xs">Data Aplicação</Label>
                  <Input
                    type="date"
                    value={dataAplicacao}
                    onChange={(e) => setDataAplicacao(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Configuração de Sanidade *</Label>
                  <Select value={configuracaoSelecionada} onValueChange={setConfiguracaoSelecionada}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {configuracoes.map(c => (
                        <SelectItem key={c.id} value={c.id} className="text-xs">
                          {c.nome_configuracao} - {c.medicamento}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Quantidade *</Label>
                  <Input
                    type="number"
                    value={quantidade}
                    onChange={(e) => setQuantidade(e.target.value)}
                    className="h-8 text-xs"
                    placeholder={configSelecionada?.quantidade_padrao || "10"}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Custo Total</Label>
                  <div className="h-8 flex items-center text-xs font-semibold text-emerald-700">
                    R$ {custoTotalCalc}
                  </div>
                </div>
              </div>

              {configSelecionada && (
                <div className="mt-2 p-2 bg-white rounded border border-emerald-200 text-xs">
                  <div className="grid grid-cols-3 gap-2">
                    <div><span className="text-slate-500">Medicamento:</span> <strong>{configSelecionada.medicamento}</strong></div>
                    <div><span className="text-slate-500">Finalidade:</span> <strong>{configSelecionada.finalidade || '-'}</strong></div>
                    <div><span className="text-slate-500">Unidade:</span> <strong>{configSelecionada.unidade_medida}</strong></div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="space-y-1">
                  <Label className="text-xs">Aplicar em:</Label>
                  <Select value={aplicarEm} onValueChange={setAplicarEm}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="animal_atual">Animal Atual ({numeroAnimal})</SelectItem>
                      {apartacaoSelecionada && (
                        <SelectItem value="apartacao">
                          Toda Apartação ({pesagensDia?.filter(p => p.apartacao_id === apartacaoSelecionada).length || 0} animais)
                        </SelectItem>
                      )}
                      {lotesApartacaoAtual?.map(lote => (
                        <SelectItem key={lote.id} value={`lote_${lote.id}`}>
                          Lote {lote.nome_lote} ({pesagensDia?.filter(p => p.lote_id === lote.id).length || 0} animais)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Observação</Label>
                  <Input
                    value={observacao}
                    onChange={(e) => setObservacao(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="Observações..."
                  />
                </div>
              </div>

              <div className="flex justify-end mt-3">
                <Button 
                  onClick={handleAplicarSanidade} 
                  disabled={isSaving}
                  size="sm" 
                  className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {isSaving ? 'Aplicando...' : 'Aplicar Sanidade'}
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* ABA CONFIGURAÇÕES */}
          <TabsContent value="configuracoes" className="flex-1 overflow-auto space-y-3 mt-3">
            <div className="bg-slate-50 border border-slate-200 rounded p-3">
              <h3 className="text-xs font-semibold text-slate-700 mb-3">
                {editingConfigId ? 'Editar Configuração' : 'Nova Configuração'}
              </h3>
              
              <div className="grid grid-cols-6 gap-2 items-end">
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Nome da Configuração *</Label>
                  <Input
                    value={nomeConfiguracao}
                    onChange={(e) => setNomeConfiguracao(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="Ex: Vermifugação Padrão"
                  />
                </div>
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
              </div>

              <div className="grid grid-cols-6 gap-2 mt-2 items-end">
                <div className="space-y-1">
                  <Label className="text-xs">Custo Unit. (R$)</Label>
                  <Input
                    type="number"
                    value={custoUnitario}
                    onChange={(e) => setCustoUnitario(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="0.00"
                  />
                </div>
                <div className="col-span-3 flex justify-end gap-2">
                  {editingConfigId && (
                    <Button 
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingConfigId(null);
                        setNomeConfiguracao("");
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
                    onClick={handleSalvarConfiguracao} 
                    disabled={isSaving}
                    size="sm" 
                    className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {isSaving ? 'Salvando...' : (editingConfigId ? 'Atualizar' : 'Adicionar')}
                  </Button>
                </div>
              </div>
            </div>

            {/* Lista de Configurações */}
            <div>
              <h3 className="text-xs font-semibold text-slate-700 mb-2">Configurações Cadastradas</h3>
              {configuracoes.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-400">
                  <Settings className="w-12 h-12 mx-auto mb-2 opacity-30" />
                  Nenhuma configuração cadastrada
                </div>
              ) : (
                <div className="border rounded overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs font-bold py-1 border border-black">Nome</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black">Medicamento</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black">Finalidade</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd. Padrão</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black text-right">Custo Un.</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black w-20">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {configuracoes.map((config) => (
                        <TableRow key={config.id} className="hover:bg-gray-50">
                          <TableCell className="text-xs py-1 border border-gray-300 font-medium">{config.nome_configuracao}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300">{config.medicamento}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300">{config.finalidade || '-'}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right">
                            {config.quantidade_padrao} {config.unidade_medida}
                          </TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">
                            {config.custo_unitario ? `R$ ${config.custo_unitario.toFixed(2)}` : '-'}
                          </TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300">
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => {
                                  setEditingConfigId(config.id);
                                  setNomeConfiguracao(config.nome_configuracao);
                                  setMedicamento(config.medicamento);
                                  setFinalidade(config.finalidade || "");
                                  setQuantidadePadrao(String(config.quantidade_padrao || ""));
                                  setUnidadeMedida(config.unidade_medida);
                                  setCustoUnitario(String(config.custo_unitario || ""));
                                }}
                              >
                                <Edit2 className="w-3 h-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-red-500"
                                onClick={() => {
                                  if (confirm('Remover esta configuração?')) {
                                    deleteConfigMutation.mutate(config.id);
                                  }
                                }}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ABA HISTÓRICO */}
          <TabsContent value="historico" className="flex-1 overflow-auto mt-3">
            <h3 className="text-xs font-semibold text-slate-700 mb-2">Histórico de Sanidade - Animal {numeroAnimal}</h3>
            {registros.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">
                <Syringe className="w-12 h-12 mx-auto mb-2 opacity-30" />
                Nenhum registro de sanidade
              </div>
            ) : (
              <>
                <div className="border rounded overflow-auto max-h-96">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs font-bold py-1 border border-black">Data</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black">Configuração</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black">Medicamento</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black">Finalidade</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd.</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black text-right">Custo</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black">Obs.</TableHead>
                        <TableHead className="text-xs font-bold py-1 border border-black w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {registros.map((reg) => (
                        <TableRow key={reg.id} className="hover:bg-gray-50">
                          <TableCell className="text-xs py-1 border border-gray-300">
                            {new Date(reg.data_aplicacao).toLocaleDateString('pt-BR')}
                          </TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300">{reg.nome_configuracao || '-'}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 font-medium">{reg.medicamento}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300">{reg.finalidade || '-'}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right">
                            {reg.quantidade} {reg.unidade_medida}
                          </TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">
                            {reg.custo_total ? `R$ ${reg.custo_total.toFixed(2)}` : '-'}
                          </TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300">{reg.observacao || '-'}</TableCell>
                          <TableCell className="text-xs py-1 border border-gray-300">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-red-500"
                              onClick={() => {
                                if (confirm('Excluir este registro?')) {
                                  deleteMutation.mutate(reg.id);
                                }
                              }}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Totais */}
                <div className="mt-2 p-2 bg-slate-100 rounded text-xs">
                  <div className="flex justify-between">
                    <span className="font-semibold">Total de Registros:</span>
                    <span>{registros.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold">Custo Total Sanidade:</span>
                    <span className="font-mono text-emerald-700">
                      R$ {registros.reduce((s, r) => s + (r.custo_total || 0), 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} size="sm" className="h-8 text-xs">
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}