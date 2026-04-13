import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Download, Plus, Settings } from "lucide-react";
import ConfirmDialog from "@/components/common/ConfirmDialog";

import FormularioCompraFinanceiro from "../components/financeiro/FormularioCompraFinanceiro.jsx";
import TabelaFinanceiro from "../components/financeiro/TabelaFinanceiro.jsx";
import BaixaFinanceira from "../components/financeiro/BaixaFinanceira.jsx";
import ImportarNFeFinanceiro from "../components/financeiro/ImportarNFeFinanceiro.jsx";

const getNextNumber = async (empresaId) => {
  const all = await base44.entities.LancamentoFinanceiro.list();
  const filtered = all.filter(l => l && l.empresa_id === empresaId);
  return filtered.reduce((max, l) => Math.max(max, parseInt(l.numero_lancamento) || 0), 0) + 1;
};

export default function LancamentoFinanceiro() {
  const [abaAtiva, setAbaAtiva] = useState("pagar"); // Changed initial state from "pesquisar" to "pagar"
  const [tipoLancamento, setTipoLancamento] = useState("Pagar"); // New state to hold "Pagar" or "Receber" string
  const [showForm, setShowForm] = useState(false); // New state to control FormularioCompraFinanceiro visibility
  const [editingLancamento, setEditingLancamento] = useState(null);
  const [baixaLancamento, setBaixaLancamento] = useState(null);
  const [dadosBaixaLote, setDadosBaixaLote] = useState(null); // New state for batch baixa
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [showXmlImport, setShowXmlImport] = useState(false); // Renamed from showImportXML
  const [dadosXML, setDadosXML] = useState(null);
  const [showSaveProgress, setShowSaveProgress] = useState(false); // Renamed from showProgressoSalvamento
  const [progressoSalvamento, setProgressoSalvamento] = useState({ etapa: '', current: 0, total: 100 });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: lancamentos = [], isLoading: loadingLancamentos } = useQuery({
    queryKey: ['lancamentos_financeiros', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LancamentoFinanceiro.list('-data_emissao');
      return all.filter(l => l && l.empresa_id === empresaSelecionadaId).map(l => ({
        ...l,
        valor_pago: l.valor_pago ?? 0,
        valor_total: l.valor_total ?? 0
      }));
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ['fornecedores_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list('nome');
      return all.filter(f => f && f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list('nome_produto');
      return all.filter(p => p && p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      setShowSaveProgress(true);
      setProgressoSalvamento({ etapa: 'Salvando...', current: 30, total: 100 });

      const lanc = await base44.entities.LancamentoFinanceiro.create(data);

      setProgressoSalvamento({ etapa: 'Concluído!', current: 100, total: 100 });
      await new Promise(resolve => setTimeout(resolve, 500));
      return lanc;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      queryClient.invalidateQueries({ queryKey: ['produtos_financeiro'] });
      setShowForm(false); // Hide the form after success
      setEditingLancamento(null);
      setDadosXML(null);
      setShowSaveProgress(false); // Hide progress dialog
      toast.success('Lançamento salvo com sucesso!');
    },
    onError: (error) => {
      setShowSaveProgress(false); // Updated state name
      toast.error('Erro ao salvar: ' + (error.message || 'Erro desconhecido'));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const baixas = await base44.entities.BaixaFinanceira.list();
      const baixaAssociada = baixas.find(b => b && b.lancamento_id === id);
      
      if (baixaAssociada) {
        throw new Error('Não é possível excluir lançamento com baixa associada. Cancele a baixa primeiro.');
      }
      
      return base44.entities.LancamentoFinanceiro.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      toast.success('Lançamento excluído!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao excluir');
    }
  });

  const cancelarBaixaMutation = useMutation({
    mutationFn: async (lancamentoId) => {
      const baixas = await base44.entities.BaixaFinanceira.list();
      const baixasDoLancamento = baixas.filter(b => b && b.lancamento_id === lancamentoId);
      
      for (const baixa of baixasDoLancamento) {
        await base44.entities.BaixaFinanceira.delete(baixa.id);
      }
      
      const lancamentosList = await base44.entities.LancamentoFinanceiro.list(); // Re-fetch to find specific lancamento
      const lancamento = lancamentosList.find(l => l && l.id === lancamentoId);
      
      if (lancamento) {
        await base44.entities.LancamentoFinanceiro.update(lancamentoId, {
          status: 'Pendente',
          valor_pago: 0
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      toast.success('Baixa cancelada!');
    },
    onError: (error) => {
      toast.error('Erro ao cancelar baixa: ' + (error.message || 'Erro desconhecido'));
    }
  });

  const handleSubmit = async (data) => {
    if (editingLancamento) {
      await base44.entities.LancamentoFinanceiro.update(editingLancamento.id, data);
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      setEditingLancamento(null);
      setShowForm(false);
      toast.success('Lançamento atualizado!');
    } else {
      // Se tem mais de 1 parcela, cria um registro separado para cada parcela
      const parcelas = data.parcelas || [];
      if (parcelas.length > 1) {
        setShowSaveProgress(true);
        setProgressoSalvamento({ etapa: 'Criando parcelas...', current: 0, total: 100 });
        const totalParcelas = parcelas.length;
        for (let i = 0; i < totalParcelas; i++) {
          const parcela = parcelas[i];
          const obsParcela = parcela.observacao_parcela ? parcela.observacao_parcela.toUpperCase() : '';
          const obsGeral = data.observacao || '';
          const obsCompleta = [obsGeral, obsParcela].filter(Boolean).join(' | ');
          const dadosParcela = {
            ...data,
            valor_total: parcela.valor,
            valor_pago: 0,
            data_vencimento: parcela.data_vencimento,
            descricao: `${data.descricao} - PARCELA ${parcela.numero}/${totalParcelas}`,
            observacao: obsCompleta || undefined,
            parcelado: true,
            quantidade_parcelas: totalParcelas,
            parcelas: [{ ...parcela, numero: 1 }], // Cada registro guarda só sua parcela
          };
          await base44.entities.LancamentoFinanceiro.create(dadosParcela);
          setProgressoSalvamento({ etapa: `Parcela ${i + 1} de ${totalParcelas}...`, current: Math.round(((i + 1) / totalParcelas) * 100), total: 100 });
        }
        await new Promise(resolve => setTimeout(resolve, 300));
        queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
        queryClient.invalidateQueries({ queryKey: ['produtos_financeiro'] });
        setShowForm(false);
        setEditingLancamento(null);
        setDadosXML(null);
        setShowSaveProgress(false);
        toast.success(`${totalParcelas} parcelas lançadas com sucesso!`);
      } else {
        // Parcela única — manter observação da parcela se existir
        if (parcelas.length === 1 && parcelas[0].observacao_parcela) {
          const obsParcela = parcelas[0].observacao_parcela.toUpperCase();
          const obsGeral = data.observacao || '';
          data.observacao = [obsGeral, obsParcela].filter(Boolean).join(' | ');
        }
        createMutation.mutate(data);
      }
    }
  };

  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const handleDelete = (id) => {
    setDeleteConfirmId(id);
  };

  const handleEdit = (lanc) => { // New handler for TabelaFinanceiro onEdit
    setEditingLancamento(lanc);
    setShowForm(true); // Show form for editing
  };

  const handleBaixa = async (lancamento, dadosLote = null) => {
    if (dadosLote?.baixa_automatica_lote) {
      // Baixa automática em lote - executar direto
      try {
        const user = await base44.auth.me();
        const allBaixas = await base44.entities.BaixaFinanceira.list();
        const maxNumBaixa = allBaixas.reduce((max, b) => Math.max(max, parseInt(b?.numero_baixa) || 0), 0);
        
        const saldoDisponivel = (lancamento.valor_total || 0) - (lancamento.valor_pago || 0);
        
        await base44.entities.BaixaFinanceira.create({
          empresa_id: empresaSelecionadaId,
          numero_baixa: String(maxNumBaixa + 1),
          lancamento_id: lancamento.id,
          data_baixa: dadosLote.data_baixa,
          valor_baixa: saldoDisponivel,
          valor_juros: 0,
          valor_multa: 0,
          valor_desconto: 0,
          forma_pagamento_id: dadosLote.forma_pagamento_id,
          forma_pagamento_nome: dadosLote.forma_pagamento_nome, // Corrected: should be nome, not id again
          observacoes: (dadosLote.observacoes || 'BAIXA EM LOTE').toUpperCase(),
          usuario_responsavel: user.email
        });

        await base44.entities.LancamentoFinanceiro.update(lancamento.id, {
          valor_pago: lancamento.valor_total,
          status: 'Pago'
        });
        queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
        toast.success('Baixa em lote aplicada com sucesso!');
      } catch (error) {
        console.error('Erro ao dar baixa em lote:', error);
        toast.error('Erro ao aplicar baixa em lote: ' + (error.message || 'Erro desconhecido'));
        throw error;
      }
    } else {
      // Baixa normal - abrir dialog
      setBaixaLancamento(lancamento);
      setDadosBaixaLote(dadosLote);
    }
  };

  const [cancelarBaixaConfirmId, setCancelarBaixaConfirmId] = useState(null);

  const handleCancelarBaixa = (lancamento) => {
    setCancelarBaixaConfirmId(lancamento.id);
  };

  const handleImportarXMLSuccess = (dadosImportados) => {
    setDadosXML(dadosImportados);
    setShowXmlImport(false); // Hide XML import dialog
    setShowForm(true); // Show form pre-filled with XML data
  };

  const handleNewLancamento = () => { // Replaced handleNovoCadastro
    setEditingLancamento(null);
    setDadosXML(null);
    setShowForm(true); // Show form for new entry
  };

  const handleCancelForm = () => { // Replaced handleCancelarCadastro
    setEditingLancamento(null);
    setDadosXML(null);
    setShowForm(false); // Hide the form
  };

  const handleUpdateLote = async (ids, dadosAtualizados) => {
    for (const id of ids) {
      try {
        await base44.entities.LancamentoFinanceiro.update(id, dadosAtualizados);
      } catch (error) {
        console.error('Erro ao atualizar:', error);
      }
    }
    queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
  };

  const lancamentosPagar = useMemo(() => lancamentos.filter(l => l && l.tipo === 'Pagar'), [lancamentos]);
  const lancamentosReceber = useMemo(() => lancamentos.filter(l => l && l.tipo === 'Receber'), [lancamentos]);

  return (
    <div className="p-1 md:p-1 space-y-1">
      {!showForm && ( // Conditional rendering for the main list view
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-1 py-1 shadow-sm border-b border-slate-200">
            <div>
              <h1 className="font-bold text-slate-800">Lançamentos Financeiros</h1>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="icon" onClick={() => setShowConfigColunas(true)} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-7 w-7">
                <Settings className="w-4 h-4" />
              </Button>
              <Button onClick={() => setShowXmlImport(true)} variant="outline" size="sm" className="h-7 text-xs">
                Importar XML
              </Button>
              <Button onClick={handleNewLancamento} size="sm" className="bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 shadow h-7 hover:bg-emerald-600">
                Adicionar
              </Button>
            </div>
          </div>

          <Tabs value={abaAtiva} onValueChange={(v) => { setAbaAtiva(v); setTipoLancamento(v === "pagar" ? "Pagar" : "Receber"); }}>
            <TabsList className="grid w-full max-w-md grid-cols-2 h-8 bg-slate-100">
              <TabsTrigger value="pagar" className="text-xs">Contas a Pagar ({lancamentosPagar.length})</TabsTrigger>
              <TabsTrigger value="receber" className="text-xs">Contas a Receber ({lancamentosReceber.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="pagar" className="mt-0">
              <TabelaFinanceiro
                lancamentos={lancamentosPagar}
                tipo="Pagar"
                onEdit={handleEdit}
                onDelete={handleDelete}
                onBaixa={handleBaixa}
                onCancelarBaixa={handleCancelarBaixa}
                isLoading={false}
                fornecedores={fornecedores}
                onUpdateLote={handleUpdateLote}
                showConfigColunas={abaAtiva === 'pagar' ? showConfigColunas : false}
                setShowConfigColunas={setShowConfigColunas}
              />
            </TabsContent>

            <TabsContent value="receber" className="mt-0">
              <TabelaFinanceiro
                lancamentos={lancamentosReceber}
                tipo="Receber"
                onEdit={handleEdit}
                onDelete={handleDelete}
                onBaixa={handleBaixa}
                onCancelarBaixa={handleCancelarBaixa}
                isLoading={false}
                fornecedores={fornecedores}
                onUpdateLote={handleUpdateLote}
                showConfigColunas={abaAtiva === 'receber' ? showConfigColunas : false}
                setShowConfigColunas={setShowConfigColunas}
              />
            </TabsContent>
          </Tabs>
        </>
      )}

      {showForm && (
        <FormularioCompraFinanceiro
          onSubmit={handleSubmit}
          onCancel={handleCancelForm}
          initialData={editingLancamento || dadosXML}
          fornecedores={fornecedores}
          tipoLancamento={editingLancamento?.tipo || dadosXML?.tipo || tipoLancamento}
        />
      )}

      {baixaLancamento && (
        <BaixaFinanceira
          lancamento={baixaLancamento}
          dadosLote={dadosBaixaLote}
          onClose={() => { setBaixaLancamento(null); setDadosBaixaLote(null); }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
            setBaixaLancamento(null);
            setDadosBaixaLote(null);
          }}
        />
      )}

      <ImportarNFeFinanceiro
        open={showXmlImport} // Updated state name
        onClose={() => setShowXmlImport(false)} // Updated state name
        onSuccess={handleImportarXMLSuccess}
        fornecedores={fornecedores}
        produtos={produtos}
      />

      <ConfirmDialog
        open={!!deleteConfirmId}
        onOpenChange={() => setDeleteConfirmId(null)}
        title="Confirmar exclusão"
        description="Tem certeza que deseja excluir este lançamento? Esta ação não pode ser desfeita."
        onConfirm={() => {
          deleteMutation.mutate(deleteConfirmId);
          setDeleteConfirmId(null);
        }}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
      />

      <ConfirmDialog
        open={!!cancelarBaixaConfirmId}
        onOpenChange={() => setCancelarBaixaConfirmId(null)}
        title="Cancelar baixa"
        description="Deseja cancelar a baixa deste lançamento? O valor pago será zerado."
        onConfirm={() => {
          cancelarBaixaMutation.mutate(cancelarBaixaConfirmId);
          setCancelarBaixaConfirmId(null);
        }}
        confirmText="Cancelar Baixa"
        cancelText="Voltar"
        variant="warning"
      />

      <Dialog open={showSaveProgress} onOpenChange={() => {}}>
 {/* Updated state name */}
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Salvando...</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-slate-600">{progressoSalvamento.etapa}</p>
            <Progress value={progressoSalvamento.current} className="w-full h-1.5" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}