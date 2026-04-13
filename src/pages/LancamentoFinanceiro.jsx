import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Download, Plus } from "lucide-react";
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

  const { data: safras = [] } = useQuery({ // New query
    queryKey: ['safras_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Safra.list('nome_safra');
      return all.filter(s => s && s.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: centrosCusto = [] } = useQuery({ // New query
    queryKey: ['centros_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CentroCusto.list('nome');
      return all.filter(c => c && c.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: planosContas = [] } = useQuery({ // New query
    queryKey: ['planos_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PlanoContas.list('descricao');
      return all.filter(p => p && p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: gruposFinanceiros = [] } = useQuery({ // New query
    queryKey: ['grupos_financeiros', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.GrupoFinanceiro.list('nome');
      return all.filter(g => g && g.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      setShowSaveProgress(true); // Updated state name
      setProgressoSalvamento({ etapa: 'Iniciando...', current: 10, total: 100 });

      await new Promise(resolve => setTimeout(resolve, 300));
      
      const user = await base44.auth.me();

      const origem_importacao = data.origem_importacao || (data.chave_nfe ? 'XML' : 'MANUAL');

      if (data.parcelas && data.parcelas.length > 0) {
        setProgressoSalvamento({ etapa: 'Criando parcelas...', current: 30, total: 100 });
        const lancamentosCriados = [];

        for (let i = 0; i < data.parcelas.length; i++) {
          const parcela = data.parcelas[i];
          const numero = await getNextNumber(empresaSelecionadaId);

          const subtotalProdutos = data.produtos_selecionados?.reduce((sum, p) => {
            const totalItem = parseFloat(p.valor_total) || 0;
            const descontoItem = parseFloat(p.desconto_item) || 0;
            return sum + (totalItem - descontoItem);
          }, 0) || 0;
          const valorOriginal = subtotalProdutos + (data.frete || 0) + (data.outras_despesas || 0);

          const valorParcela = parcela.valor || 0;

          const lanc = await base44.entities.LancamentoFinanceiro.create({
            empresa_id: empresaSelecionadaId,
            numero_lancamento: String(numero),
            tipo: data.tipo,
            tipo_documento: data.tipo_documento,
            fornecedor_id: data.fornecedor_id,
            fornecedor_nome: data.fornecedor_nome,
            safra_id: data.safra_id,
            safra_nome: data.safra_nome,
            centro_custo_id: data.centro_custo_id,
            centro_custo_nome: data.centro_custo_nome,
            plano_contas_id: data.plano_contas_id,
            plano_contas_nome: data.plano_contas_nome,
            grupo_id: data.grupo_id,
            grupo_nome: data.grupo_nome,
            forma_pagamento_id: data.forma_pagamento_id,
            forma_pagamento_nome: data.forma_pagamento_nome,
            numero_documento: data.numero_documento,
            chave_nfe: data.chave_nfe,
            serie_documento: data.serie_documento,
            numero_boleto: data.numero_boleto,
            banco_boleto: data.banco_boleto,
            cfop: data.cfop,
            data_emissao: data.data_emissao,
            data_vencimento: parcela.data,
            valor_original: valorOriginal,
            valor_produtos: data.valor_produtos || 0,
            valor_frete: data.frete || 0,
            valor_seguro: data.valor_seguro || 0,
            valor_outras_despesas: data.outras_despesas || 0,
            valor_desconto_total: data.valor_desconto_total || 0,
            valor_ipi: data.valor_ipi || 0,
            valor_icms: data.valor_icms || 0,
            valor_pis: data.valor_pis || 0,
            valor_cofins: data.valor_cofins || 0,
            base_calculo_icms: data.base_calculo_icms || 0,
            valor_total: valorParcela,
            valor_juros: 0,
            valor_multa: 0,
            valor_desconto: 0,
            valor_pago: 0,
            status: 'Pendente',
            observacoes: `${data.observacoes || ''} - PARCELA ${i + 1}/${data.parcelas.length}`.trim(),
            observacoes_nfe: data.observacoes_nfe,
            numero_parcela: i + 1,
            total_parcelas: data.parcelas.length,
            produtos_lancamento: data.produtos_selecionados,
            anexos: data.anexos,
            origem_importacao: origem_importacao,
            usuario_lancamento: user.email
          });


          lancamentosCriados.push(lanc);
          setProgressoSalvamento({ etapa: `Parcela ${i + 1}/${data.parcelas.length}`, current: 30 + (i + 1) * (40 / data.parcelas.length), total: 100 });
        }

        setProgressoSalvamento({ etapa: 'Concluído!', current: 100, total: 100 });
        await new Promise(resolve => setTimeout(resolve, 500));
        toast.success(`${data.parcelas.length} lançamentos criados!`);
        return lancamentosCriados[0];
      } else {
        setProgressoSalvamento({ etapa: 'Salvando...', current: 50, total: 100 });
        const numero = await getNextNumber(empresaSelecionadaId);

        const subtotalProdutos = data.produtos_selecionados?.reduce((sum, p) => {
          const totalItem = parseFloat(p.valor_total) || 0;
          const descontoItem = parseFloat(p.desconto_item) || 0;
          return sum + (totalItem - descontoItem);
        }, 0) || 0;
        const valorTotal = subtotalProdutos + (data.frete || 0) + (data.outras_despesas || 0);

        const lanc = await base44.entities.LancamentoFinanceiro.create({
          ...data,
          empresa_id: empresaSelecionadaId,
          numero_lancamento: String(numero),
          valor_original: valorTotal,
          valor_produtos: data.valor_produtos || 0,
          valor_frete: data.frete || 0,
          valor_seguro: data.valor_seguro || 0,
          valor_outras_despesas: data.outras_despesas || 0,
          valor_desconto_total: data.valor_desconto_total || 0,
          valor_ipi: data.valor_ipi || 0,
          valor_icms: data.valor_icms || 0,
          valor_pis: data.valor_pis || 0,
          valor_cofins: data.valor_cofins || 0,
          base_calculo_icms: data.base_calculo_icms || 0,
          valor_total: valorTotal,
          valor_pago: data.conta_paga ? (data.valor_pago_total || 0) : 0,
          valor_juros: 0,
          valor_multa: 0,
          valor_desconto: 0,
          status: data.conta_paga ? 'Pago' : 'Pendente',
          observacoes_nfe: data.observacoes_nfe,
          origem_importacao: origem_importacao,
          usuario_lancamento: user.email
        });


        if (data.conta_paga) {
          setProgressoSalvamento({ etapa: 'Registrando baixa...', current: 85, total: 100 });
          const allBaixas = await base44.entities.BaixaFinanceira.list();
          const maxNumBaixa = allBaixas.reduce((max, b) => Math.max(max, parseInt(b?.numero_baixa) || 0), 0);

          await base44.entities.BaixaFinanceira.create({
            empresa_id: empresaSelecionadaId,
            numero_baixa: String(maxNumBaixa + 1),
            lancamento_id: lanc.id,
            data_baixa: data.data_pagamento,
            valor_baixa: data.valor_pago_total || 0,
            valor_juros: 0,
            valor_multa: 0,
            valor_desconto: 0,
            forma_pagamento_id: data.forma_pagamento_paga_id,
            forma_pagamento_nome: data.forma_pagamento_paga_nome,
            observacoes: 'BAIXA AUTOMÁTICA NO CADASTRO',
            usuario_responsavel: user.email
          });
        }

        setProgressoSalvamento({ etapa: 'Concluído!', current: 100, total: 100 });
        await new Promise(resolve => setTimeout(resolve, 500));
        return lanc;
      }
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
      setShowForm(false); // Hide the form after update
      toast.success('Lançamento atualizado!');
    } else {
      createMutation.mutate(data);
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
    <div className="p-6 space-y-4">
      {!showForm && ( // Conditional rendering for the main list view
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Lançamento Financeiro</h1>
              <p className="text-xs text-slate-600">Contas a pagar e receber</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setShowXmlImport(true)} variant="outline" size="sm" className="h-8 text-xs">
                Importar XML
              </Button>
              <Button onClick={handleNewLancamento} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                Novo Lançamento
              </Button>
            </div>
          </div>

          <Tabs value={abaAtiva} onValueChange={(v) => { setAbaAtiva(v); setTipoLancamento(v === "pagar" ? "Pagar" : "Receber"); }}>
            <TabsList className="grid w-full max-w-md grid-cols-2 h-8 bg-slate-100">
              <TabsTrigger value="pagar" className="text-xs">Contas a Pagar ({lancamentosPagar.length})</TabsTrigger>
              <TabsTrigger value="receber" className="text-xs">Contas a Receber ({lancamentosReceber.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="pagar" className="mt-4">
              <TabelaFinanceiro
                lancamentos={lancamentosPagar}
                tipo="Pagar"
                onEdit={handleEdit}
                onDelete={handleDelete}
                onBaixa={handleBaixa}
                onCancelarBaixa={handleCancelarBaixa}
                isLoading={false}
                fornecedores={fornecedores}
                produtos={produtos}
                safras={safras} // New prop
                centrosCusto={centrosCusto} // New prop
                planosContas={planosContas} // New prop
                gruposFinanceiros={gruposFinanceiros} // New prop
                onUpdateLote={handleUpdateLote} // New prop
              />
            </TabsContent>

            <TabsContent value="receber" className="mt-4">
              <TabelaFinanceiro
                lancamentos={lancamentosReceber}
                tipo="Receber"
                onEdit={handleEdit}
                onDelete={handleDelete}
                onBaixa={handleBaixa}
                onCancelarBaixa={handleCancelarBaixa}
                isLoading={false}
                fornecedores={fornecedores}
                produtos={produtos}
                safras={safras} // New prop
                centrosCusto={centrosCusto} // New prop
                planosContas={planosContas} // New prop
                gruposFinanceiros={gruposFinanceiros} // New prop
                onUpdateLote={handleUpdateLote} // New prop
              />
            </TabsContent>
          </Tabs>
        </>
      )}

      {showForm && ( // Conditional rendering for the form
        <FormularioCompraFinanceiro
          onSubmit={handleSubmit}
          onCancel={handleCancelForm}
          initialData={editingLancamento || dadosXML}
          fornecedores={fornecedores}
          produtos={produtos}
          safras={safras} // New prop
          centrosCusto={centrosCusto} // New prop
          planosContas={planosContas} // New prop
          gruposFinanceiros={gruposFinanceiros} // New prop
          tipoLancamento={editingLancamento?.tipo || dadosXML?.tipo || tipoLancamento} // Pass type for new entries or derived from existing
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