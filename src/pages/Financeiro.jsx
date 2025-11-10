import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { DollarSign, Plus, TrendingUp, TrendingDown, AlertCircle, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import FormularioCompraFinanceiro from "../components/financeiro/FormularioCompraFinanceiro.jsx";
import TabelaFinanceiro from "../components/financeiro/TabelaFinanceiro.jsx";
import BaixaFinanceira from "../components/financeiro/BaixaFinanceira.jsx";
import ImportarNFeFinanceiro from "../components/financeiro/ImportarNFeFinanceiro.jsx";
import CartoesResumo from "../components/shared/CartoesResumo.jsx";

const getNextNumber = async (empresaId) => {
  const all = await base44.entities.LancamentoFinanceiro.list();
  const filtered = all.filter(l => l.empresa_id === empresaId);
  const maxNum = filtered.reduce((max, l) => Math.max(max, parseInt(l.numero_lancamento) || 0), 0);
  return maxNum + 1;
};

const getNextNumeroMovimentacao = async (empresaId) => {
  const all = await base44.entities.MovimentacaoEstoque.list();
  const filtered = all.filter(m => m.empresa_id === empresaId);
  const maxNum = filtered.reduce((max, m) => Math.max(max, parseInt(m.numero_movimentacao) || 0), 0);
  return maxNum + 1;
};

const getNextNumeroLivro = async (empresaId) => {
  const all = await base44.entities.LivroFiscal.list();
  const filtered = all.filter(l => l.empresa_id === empresaId);
  const maxNum = filtered.reduce((max, l) => Math.max(max, parseInt(l.numero_registro) || 0), 0);
  return maxNum + 1;
};

export default function Financeiro() {
  const [tipoAba, setTipoAba] = useState("pagar");
  const [showForm, setShowForm] = useState(false);
  const [dadosXML, setDadosXML] = useState(null);
  const [showBaixa, setShowBaixa] = useState(false);
  const [itemBaixa, setItemBaixa] = useState(null);
  const [showImportarXML, setShowImportarXML] = useState(false);
  const [showProgressoImportacao, setShowProgressoImportacao] = useState(false);
  const [progressoImportacao, setProgressoImportacao] = useState({ etapa: '', current: 0, total: 0 });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: lancamentos = [], isLoading } = useQuery({
    queryKey: ['lancamentos_financeiros', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LancamentoFinanceiro.list('-data_emissao');
      return all.filter(l => l.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ['fornecedores_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list('nome');
      return all.filter(f => f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list('nome_produto');
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: safras = [] } = useQuery({
    queryKey: ['safras_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Safra.list();
      return all.filter(s => s.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: planos = [] } = useQuery({
    queryKey: ['planos_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PlanoContas.list('codigo');
      return all.filter(p => p.empresa_id === empresaSelecionadaId && p.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: grupos = [] } = useQuery({
    queryKey: ['grupos_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.GrupoFinanceiro.list();
      return all.filter(g => g.empresa_id === empresaSelecionadaId && g.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      if (data.parcelas && data.parcelas.length > 0) {
        const lancamentosCriados = [];
        
        for (let i = 0; i < data.parcelas.length; i++) {
          const parcela = data.parcelas[i];
          const numero = await getNextNumber(empresaSelecionadaId);
          
          const subtotalProdutos = data.produtos_selecionados.reduce((sum, p) => 
            sum + (p.quantidade * p.valor_unitario - p.desconto_item), 0
          );
          
          const valorOriginal = subtotalProdutos + data.frete + data.outras_despesas - data.desconto_total;
          
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
            data_emissao: data.data_emissao,
            data_vencimento: parcela.data,
            valor_original: valorOriginal,
            valor_total: parcela.valor,
            valor_saldo: parcela.valor,
            valor_juros: 0,
            valor_multa: 0,
            valor_desconto: 0,
            valor_pago: 0,
            status: 'Pendente',
            observacoes: `${data.observacoes || ''} - PARCELA ${i + 1}/${data.parcelas.length}`.trim(),
            numero_parcela: i + 1,
            total_parcelas: data.parcelas.length,
            produtos_lancamento: data.produtos_selecionados
          });
          
          lancamentosCriados.push(lanc);
        }
        
        toast.success(`✅ ${data.parcelas.length} lançamentos criados!`);
        return lancamentosCriados[0];
      } else {
        const numero = await getNextNumber(empresaSelecionadaId);
        const subtotalProdutos = data.produtos_selecionados.reduce((sum, p) => 
          sum + (p.quantidade * p.valor_unitario - p.desconto_item), 0
        );
        const valorTotal = subtotalProdutos + data.frete + data.outras_despesas - data.desconto_total;
        
        return base44.entities.LancamentoFinanceiro.create({
          ...data,
          empresa_id: empresaSelecionadaId,
          numero_lancamento: String(numero),
          valor_original: valorTotal,
          valor_total: valorTotal,
          valor_pago: 0,
          valor_saldo: valorTotal,
          valor_juros: 0,
          valor_multa: 0,
          valor_desconto: 0,
          status: 'Pendente'
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      setShowForm(false);
      setDadosXML(null);
      toast.success('✅ Lançamento salvo!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const baixas = await base44.entities.BaixaFinanceira.list();
      const temBaixas = baixas.some(b => b.lancamento_id === id);
      if (temBaixas) {
        throw new Error('❌ Possui baixas! Cancele-as primeiro.');
      }
      return base44.entities.LancamentoFinanceiro.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      toast.success('✅ Excluído!');
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });

  const cancelarBaixaMutation = useMutation({
    mutationFn: async (lancamento) => {
      const allBaixas = await base44.entities.BaixaFinanceira.list();
      const baixasDoLancamento = allBaixas.filter(b => b.lancamento_id === lancamento.id);
      
      if (baixasDoLancamento.length === 0) {
        throw new Error('Nenhuma baixa encontrada!');
      }

      for (const baixa of baixasDoLancamento) {
        await base44.entities.BaixaFinanceira.delete(baixa.id);
      }

      await base44.entities.LancamentoFinanceiro.update(lancamento.id, {
        valor_pago: 0,
        valor_saldo: lancamento.valor_total,
        status: 'Pendente'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      toast.success('✅ Baixa(s) cancelada(s)!');
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });

  const handleSubmit = (data) => {
    createMutation.mutate(data);
  };

  const handleDelete = (id) => {
    if (window.confirm('⚠️ EXCLUIR LANÇAMENTO?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleBaixa = (item) => {
    setItemBaixa(item);
    setShowBaixa(true);
  };

  const handleCancelarBaixa = (lancamento) => {
    if (window.confirm('⚠️ CANCELAR BAIXAS?')) {
      cancelarBaixaMutation.mutate(lancamento);
    }
  };

  const handleImportarXMLSuccess = async (dados) => {
    setShowImportarXML(false);
    
    // Converter dados XML para o formato do formulário
    const dadosFormulario = {
      tipo: "Pagar",
      tipo_documento: "NF-e",
      fornecedor_id: dados.fornecedor_id,
      data_emissao: dados.dadosNFe.data_emissao,
      data_vencimento: dados.dataVencimento,
      numero_documento: dados.dadosNFe.numero,
      serie_documento: dados.dadosNFe.serie,
      chave_nfe: dados.dadosNFe.chave,
      produtos_selecionados: dados.itens.map(item => ({
        produto_id: item.produto_id,
        produto_nome: item.produto_nome,
        quantidade: String(item.quantidade).replace('.', ','),
        valor_unitario: String(item.valor_unitario).replace('.', ','),
        desconto_item: String(item.desconto_item || 0).replace('.', ','),
        unidade: item.unidade
      })),
      frete: String(dados.dadosComplementares?.frete || 0).replace('.', ','),
      desconto_total: String(dados.dadosComplementares?.desconto_total || 0).replace('.', ','),
      outras_despesas: String(dados.dadosComplementares?.outras_despesas || 0).replace('.', ','),
      observacoes: dados.dadosComplementares?.observacoes || '',
      centro_custo_id: dados.dadosComplementares?.centro_custo_id || '',
      plano_contas_id: dados.dadosComplementares?.plano_contas_id || '',
      grupo_id: dados.dadosComplementares?.grupo_id || '',
      parcelar: dados.parcelar || false,
      parcelas: dados.parcelas || []
    };
    
    setDadosXML(dadosFormulario);
    setShowForm(true);
    toast.success('✅ Dados importados! Complete o lançamento.');
  };

  const lancamentosPagar = lancamentos.filter(l => l.tipo === 'Pagar');
  const lancamentosReceber = lancamentos.filter(l => l.tipo === 'Receber');

  const estatisticas = useMemo(() => {
    const contasPagar = lancamentosPagar.filter(l => l.status !== 'Pago' && l.status !== 'Cancelado');
    const contasReceber = lancamentosReceber.filter(l => l.status !== 'Pago' && l.status !== 'Cancelado');
    const vencidos = lancamentos.filter(l => new Date(l.data_vencimento) < new Date() && l.status === 'Pendente');
    
    return {
      totalPagar: contasPagar.reduce((sum, l) => sum + (l.valor_saldo || 0), 0),
      totalReceber: contasReceber.reduce((sum, l) => sum + (l.valor_saldo || 0), 0),
      totalVencidos: vencidos.reduce((sum, l) => sum + (l.valor_saldo || 0), 0),
      qtdVencidos: vencidos.length,
      qtdPagar: contasPagar.length,
      qtdReceber: contasReceber.length
    };
  }, [lancamentos, lancamentosPagar, lancamentosReceber]);

  const cartoes = [
    {
      id: 'pagar',
      label: 'Contas a Pagar',
      valor: estatisticas.totalPagar,
      sublabel: `${estatisticas.qtdPagar} título(s)`,
      icon: TrendingDown,
      cor: 'red',
      tipo: 'moeda'
    },
    {
      id: 'receber',
      label: 'Contas a Receber',
      valor: estatisticas.totalReceber,
      sublabel: `${estatisticas.qtdReceber} título(s)`,
      icon: TrendingUp,
      cor: 'emerald',
      tipo: 'moeda'
    },
    {
      id: 'vencidos',
      label: 'Títulos Vencidos',
      valor: estatisticas.totalVencidos,
      sublabel: `⚠️ ${estatisticas.qtdVencidos} título(s)`,
      icon: AlertCircle,
      cor: 'amber',
      tipo: 'moeda'
    }
  ];

  return (
    <div className="p-4 md:p-6 space-y-2">
      {!showForm && !showBaixa && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Controle Financeiro</h1>
              <p className="text-xs text-slate-600">Contas a pagar e receber</p>
            </div>
          </div>

          <CartoesResumo cartoes={cartoes} />

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setShowImportarXML(true)} variant="outline" size="sm" className="h-8 gap-1 text-xs">
              <FileText className="w-3.5 h-3.5" />
              Importação NF-e (xml)
            </Button>
            <Button onClick={() => { setDadosXML(null); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 ml-auto">
              <Plus className="w-3.5 h-3.5" />
              Novo
            </Button>
          </div>
        </>
      )}

      {showForm && (
        <FormularioCompraFinanceiro
          onSubmit={handleSubmit}
          onCancel={() => { setShowForm(false); setDadosXML(null); }}
          initialData={dadosXML}
          fornecedores={fornecedores}
          produtos={produtos}
        />
      )}

      {showBaixa && (
        <BaixaFinanceira
          lancamento={itemBaixa}
          onClose={() => { setShowBaixa(false); setItemBaixa(null); }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
            setShowBaixa(false);
            setItemBaixa(null);
          }}
        />
      )}

      <ImportarNFeFinanceiro
        open={showImportarXML}
        onClose={() => setShowImportarXML(false)}
        onSuccess={handleImportarXMLSuccess}
        fornecedores={fornecedores}
        produtos={produtos}
      />

      {!showForm && !showBaixa && (
        <Tabs value={tipoAba} onValueChange={setTipoAba}>
          <TabsList className="grid w-full max-w-md grid-cols-2 h-8">
            <TabsTrigger value="pagar" className="gap-1 text-xs h-7">
              <TrendingDown className="w-3.5 h-3.5" />
              A Pagar ({lancamentosPagar.length})
            </TabsTrigger>
            <TabsTrigger value="receber" className="gap-1 text-xs h-7">
              <TrendingUp className="w-3.5 h-3.5" />
              A Receber ({lancamentosReceber.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pagar" className="mt-2">
            <TabelaFinanceiro
              lancamentos={lancamentosPagar}
              tipo="Pagar"
              onEdit={() => {}}
              onDelete={handleDelete}
              onBaixa={handleBaixa}
              onCancelarBaixa={handleCancelarBaixa}
              isLoading={isLoading}
              fornecedores={fornecedores}
              produtos={produtos}
            />
          </TabsContent>

          <TabsContent value="receber" className="mt-2">
            <TabelaFinanceiro
              lancamentos={lancamentosReceber}
              tipo="Receber"
              onEdit={() => {}}
              onDelete={handleDelete}
              onBaixa={handleBaixa}
              onCancelarBaixa={handleCancelarBaixa}
              isLoading={isLoading}
              fornecedores={fornecedores}
              produtos={produtos}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}