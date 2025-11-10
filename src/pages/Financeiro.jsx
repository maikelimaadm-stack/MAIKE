
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

export default function Financeiro() {
  const [tipoAba, setTipoAba] = useState("pagar");
  const [showForm, setShowForm] = useState(false);
  const [dadosXML, setDadosXML] = useState(null);
  const [showBaixa, setShowBaixa] = useState(false);
  const [itemBaixa, setItemBaixa] = useState(null);
  const [showImportarXML, setShowImportarXML] = useState(false);
  const [showProgressoSalvamento, setShowProgressoSalvamento] = useState(false);
  const [progressoSalvamento, setProgressoSalvamento] = useState({ etapa: '', current: 0, total: 0 });

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

  const { data: produtos = [] } = useQuery({ // This `produtos` query is still useful for general product display/selection
    queryKey: ['produtos_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list('nome_produto');
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: planos = [] } = useQuery({
    queryKey: ['planos_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PlanoContas.list('codigo');
      return all.filter(p => p.empresa_id === empresaSelecionadaId && p.ativo !== false && p.tipo === 'Despesa');
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: grupos = [] } = useQuery({
    queryKey: ['grupos_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.GrupoFinanceiro.list();
      return all.filter(g => g.empresa_id === empresaSelecionadaId && g.ativo !== false && g.tipo === 'Despesa');
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: formasPagamento = [] } = useQuery({
    queryKey: ['formas_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.FormaPagamento.list();
      return all.filter(f => f.empresa_id === empresaSelecionadaId && f.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      setShowProgressoSalvamento(true);
      setProgressoSalvamento({ etapa: '🚀 Iniciando...', current: 10, total: 100 });

      await new Promise(resolve => setTimeout(resolve, 300));
      
      // BUSCAR PRODUTOS DENTRO DA MUTATION para garantir dados mais atualizados no estoque
      const todosProdutos = await base44.entities.Produto.list();
      const produtosEmpresa = todosProdutos.filter(p => p.empresa_id === empresaSelecionadaId);

      if (data.parcelas && data.parcelas.length > 0) {
        setProgressoSalvamento({ etapa: '💰 Criando parcelas...', current: 30, total: 100 });
        const lancamentosCriados = [];

        for (let i = 0; i < data.parcelas.length; i++) {
          const parcela = data.parcelas[i];
          const numero = await getNextNumber(empresaSelecionadaId);

          const subtotalProdutos = data.produtos_selecionados?.reduce((sum, p) =>
            sum + (p.quantidade * p.valor_unitario - (p.desconto_item || 0)), 0
          ) || 0;

          const valorOriginal = data.lancar_produtos
            ? subtotalProdutos + (data.frete || 0) + (data.outras_despesas || 0)
            : data.valor_original;

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
            valor_produtos: data.valor_produtos,
            valor_frete: data.frete || 0,
            valor_seguro: data.valor_seguro || 0,
            valor_outras_despesas: data.outras_despesas || 0,
            valor_desconto_total: 0,
            valor_ipi: data.valor_ipi || 0,
            valor_icms: data.valor_icms || 0,
            valor_pis: data.valor_pis || 0,
            valor_cofins: data.valor_cofins || 0,
            base_calculo_icms: data.base_calculo_icms || 0,
            valor_total: parcela.valor,
            valor_saldo: parcela.valor,
            valor_juros: 0,
            valor_multa: 0,
            valor_desconto: 0,
            valor_pago: 0,
            status: 'Pendente',
            observacoes: `${data.observacoes || ''} - PARCELA ${i + 1}/${data.parcelas.length}`.trim(),
            observacoes_nfe: data.observacoes_nfe,
            numero_parcela: i + 1,
            total_parcelas: data.parcelas.length,
            lancar_produtos: data.lancar_produtos,
            dar_entrada_estoque: data.dar_entrada_estoque,
            local_estoque: data.local_estoque,
            produtos_lancamento: data.produtos_selecionados,
            anexos: data.anexos
          });

          // LANÇAR NO ESTOQUE SE MARCADO - SÓ NA PRIMEIRA PARCELA
          if (data.dar_entrada_estoque && data.produtos_selecionados && data.produtos_selecionados.length > 0 && i === 0) {
            setProgressoSalvamento({ etapa: '📦 Atualizando estoque...', current: 60, total: 100 });

            const user = await base44.auth.me();

            for (const prodLanc of data.produtos_selecionados) {
              const produto = produtosEmpresa.find(p => p.id === prodLanc.produto_id); // Using produtosEmpresa
              if (produto) {
                // Atualizar estoque do produto
                const novoEstoque = (produto.estoque_atual || 0) + prodLanc.quantidade;
                await base44.entities.Produto.update(produto.id, {
                  estoque_atual: novoEstoque
                });

                // Criar movimentação de estoque COM TODOS OS CAMPOS
                const allMov = await base44.entities.MovimentacaoEstoque.list();
                const maxNumMov = allMov.reduce((max, m) => Math.max(max, parseInt(m.numero_movimentacao) || 0), 0);

                await base44.entities.MovimentacaoEstoque.create({
                  empresa_id: empresaSelecionadaId,
                  numero_movimentacao: String(maxNumMov + 1),
                  tipo_movimentacao: 'Entrada',
                  tipo_documento: data.tipo_documento || 'NF-e',
                  fornecedor_id: data.fornecedor_id,
                  fornecedor_nome: data.fornecedor_nome,
                  safra_id: data.safra_id,
                  safra_nome: data.safra_nome,
                  centro_custo_id: data.centro_custo_id,
                  centro_custo_nome: data.centro_custo_nome,
                  produto_id: produto.id,
                  produto_nome: produto.nome_produto,
                  quantidade: prodLanc.quantidade,
                  unidade_medida: prodLanc.unidade,
                  valor_unitario: prodLanc.valor_unitario,
                  valor_total: prodLanc.quantidade * prodLanc.valor_unitario,
                  local_origem: `📋 FINANCEIRO: ${data.fornecedor_nome}`,
                  local_destino: data.local_estoque,
                  data_movimentacao: data.data_emissao,
                  numero_documento: data.numero_documento,
                  observacoes: `🔗 ORIGEM: LANÇAMENTO FINANCEIRO #${String(numero)} | ${data.tipo_documento || 'NF-e'} ${data.numero_documento || ''} | Entrada automática via controle financeiro`.trim(),
                  responsavel: user.email
                });
              }
            }
          }

          lancamentosCriados.push(lanc);
          setProgressoSalvamento({ etapa: `💰 Parcela ${i + 1}/${data.parcelas.length}`, current: 30 + (i + 1) * (40 / data.parcelas.length), total: 100 });
        }

        setProgressoSalvamento({ etapa: '✅ Concluído!', current: 100, total: 100 });
        await new Promise(resolve => setTimeout(resolve, 500));
        toast.success(`✅ ${data.parcelas.length} lançamentos criados${data.dar_entrada_estoque ? ' e estoque atualizado' : ''}!`);
        return lancamentosCriados[0];
      } else {
        setProgressoSalvamento({ etapa: '💾 Salvando...', current: 50, total: 100 });
        const numero = await getNextNumber(empresaSelecionadaId);

        let valorTotal;
        if (data.lancar_produtos) {
          const subtotalProdutos = data.produtos_selecionados?.reduce((sum, p) =>
            sum + (p.quantidade * p.valor_unitario - (p.desconto_item || 0)), 0
          ) || 0;
          valorTotal = subtotalProdutos + (data.frete || 0) + (data.outras_despesas || 0);
        } else {
          valorTotal = data.valor_original + data.valor_juros + data.valor_multa - data.valor_desconto;
        }

        const lanc = await base44.entities.LancamentoFinanceiro.create({
          ...data,
          empresa_id: empresaSelecionadaId,
          numero_lancamento: String(numero),
          valor_original: data.lancar_produtos ? valorTotal : data.valor_original,
          valor_produtos: data.valor_produtos,
          valor_frete: data.frete || 0,
          valor_seguro: data.valor_seguro || 0,
          valor_outras_despesas: data.outras_despesas || 0,
          valor_desconto_total: 0,
          valor_ipi: data.valor_ipi || 0,
          valor_icms: data.valor_icms || 0,
          valor_pis: data.valor_pis || 0,
          valor_cofins: data.valor_cofins || 0,
          base_calculo_icms: data.base_calculo_icms || 0,
          valor_total: valorTotal,
          valor_pago: data.conta_paga ? data.valor_pago_total : 0,
          valor_saldo: data.conta_paga ? (valorTotal - data.valor_pago_total) : valorTotal,
          valor_juros: data.lancar_produtos ? 0 : data.valor_juros,
          valor_multa: data.lancar_produtos ? 0 : data.valor_multa,
          valor_desconto: data.lancar_produtos ? 0 : data.valor_desconto,
          status: data.conta_paga ? 'Pago' : 'Pendente',
          observacoes_nfe: data.observacoes_nfe
        });

        // LANÇAR NO ESTOQUE SE MARCADO
        if (data.dar_entrada_estoque && data.produtos_selecionados && data.produtos_selecionados.length > 0) {
          setProgressoSalvamento({ etapa: '📦 Atualizando estoque...', current: 70, total: 100 });

          const user = await base44.auth.me();

          for (const prodLanc of data.produtos_selecionados) {
            const produto = produtosEmpresa.find(p => p.id === prodLanc.produto_id); // Using produtosEmpresa
            if (produto) {
              // Atualizar estoque do produto
              const novoEstoque = (produto.estoque_atual || 0) + prodLanc.quantidade;
              await base44.entities.Produto.update(produto.id, {
                estoque_atual: novoEstoque
              });

              // Criar movimentação de estoque COM TODOS OS CAMPOS
              const allMov = await base44.entities.MovimentacaoEstoque.list();
              const maxNumMov = allMov.reduce((max, m) => Math.max(max, parseInt(m.numero_movimentacao) || 0), 0);

              await base44.entities.MovimentacaoEstoque.create({
                empresa_id: empresaSelecionadaId,
                numero_movimentacao: String(maxNumMov + 1),
                tipo_movimentacao: 'Entrada',
                tipo_documento: data.tipo_documento || 'NF-e',
                fornecedor_id: data.fornecedor_id,
                fornecedor_nome: data.fornecedor_nome,
                safra_id: data.safra_id,
                safra_nome: data.safra_nome,
                centro_custo_id: data.centro_custo_id,
                centro_custo_nome: data.centro_custo_nome,
                produto_id: produto.id,
                produto_nome: produto.nome_produto,
                quantidade: prodLanc.quantidade,
                unidade_medida: prodLanc.unidade,
                valor_unitario: prodLanc.valor_unitario,
                valor_total: prodLanc.quantidade * prodLanc.valor_unitario,
                local_origem: `📋 FINANCEIRO: ${data.fornecedor_nome}`,
                local_destino: data.local_estoque,
                data_movimentacao: data.data_emissao,
                numero_documento: data.numero_documento,
                observacoes: `🔗 ORIGEM: LANÇAMENTO FINANCEIRO #${numero} | ${data.tipo_documento || 'NF-e'} ${data.numero_documento || ''} | Entrada automática via controle financeiro`.trim(),
                responsavel: user.email
              });
            }
          }
        }

        if (data.conta_paga) {
          setProgressoSalvamento({ etapa: '✅ Registrando baixa...', current: 85, total: 100 });
          const allBaixas = await base44.entities.BaixaFinanceira.list();
          const maxNumBaixa = allBaixas.reduce((max, b) => Math.max(max, parseInt(b.numero_baixa) || 0), 0);

          const user = await base44.auth.me();

          await base44.entities.BaixaFinanceira.create({
            empresa_id: empresaSelecionadaId,
            numero_baixa: String(maxNumBaixa + 1),
            lancamento_id: lanc.id,
            data_baixa: data.data_pagamento,
            valor_baixa: data.valor_pago_total,
            valor_juros: 0,
            valor_multa: 0,
            valor_desconto: 0,
            forma_pagamento_id: data.forma_pagamento_paga_id,
            forma_pagamento_nome: data.forma_pagamento_paga_nome,
            observacoes: 'BAIXA AUTOMÁTICA NO CADASTRO',
            usuario_responsavel: user.email
          });
        }

        setProgressoSalvamento({ etapa: '✅ Concluído!', current: 100, total: 100 });
        await new Promise(resolve => setTimeout(resolve, 500));
        return lanc;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      queryClient.invalidateQueries({ queryKey: ['produtos_financeiro'] });
      setShowForm(false);
      setDadosXML(null);
      setShowProgressoSalvamento(false);
      toast.success('✅ Lançamento salvo com sucesso!');
    },
    onError: (error) => {
      setShowProgressoSalvamento(false);
      toast.error('❌ Erro ao salvar: ' + error.message);
    }
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

  const handleSubmit = async (data) => {
    await createMutation.mutateAsync(data);
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

  const handleImportarXMLSuccess = (dados) => {
    // AGORA: Apenas preencher o formulário com os dados importados
    setDadosXML(dados);
    setShowImportarXML(false);
    setShowForm(true);
    toast.success('✅ Dados importados! Complete e salve o lançamento.');
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

  const progressPercentage = progressoSalvamento.total > 0 ? Math.round((progressoSalvamento.current / progressoSalvamento.total) * 100) : 0;

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
          planos={planos}
          grupos={grupos}
          formasPagamento={formasPagamento}
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

      <Dialog open={showProgressoSalvamento} onOpenChange={() => { }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              Salvando Lançamento
            </DialogTitle>
            <DialogDescription className="text-xs">
              {progressoSalvamento.etapa}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Progress value={progressPercentage} className="h-2" />
              <p className="text-center text-sm font-semibold text-emerald-600">{progressPercentage}%</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
              onEdit={() => { }}
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
              onEdit={() => { }}
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
