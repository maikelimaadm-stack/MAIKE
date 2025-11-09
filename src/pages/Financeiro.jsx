
import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { DollarSign, Plus, TrendingUp, TrendingDown, AlertCircle, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import FormularioFinanceiro from "../components/financeiro/FormularioFinanceiro.jsx";
import TabelaFinanceiro from "../components/financeiro/TabelaFinanceiro.jsx";
import BaixaFinanceira from "../components/financeiro/BaixaFinanceira.jsx";
import ImportarNFeFinanceiro from "../components/financeiro/ImportarNFeFinanceiro.jsx";

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
  const [editingItem, setEditingItem] = useState(null);
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
          
          const lanc = await base44.entities.LancamentoFinanceiro.create({
            empresa_id: empresaSelecionadaId,
            numero_lancamento: String(numero),
            tipo: data.tipo,
            tipo_documento: data.tipo_documento,
            fornecedor_id: data.fornecedor_id,
            fornecedor_nome: data.fornecedor_nome,
            cliente_nome: data.cliente_nome,
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
            data_emissao: data.data_emissao,
            data_vencimento: parcela.data,
            valor_original: parcela.valor,
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
            produtos_lancamento: data.produtos_lancamento
          });
          
          lancamentosCriados.push(lanc);
        }
        
        toast.success(`✅ ${data.parcelas.length} lançamentos criados!`);
        return lancamentosCriados[0];
      } else {
        const numero = await getNextNumber(empresaSelecionadaId);
        const valorTotal = (data.valor_original || 0) + (data.valor_juros || 0) + (data.valor_multa || 0) - (data.valor_desconto || 0);
        
        return base44.entities.LancamentoFinanceiro.create({
          ...data,
          empresa_id: empresaSelecionadaId,
          numero_lancamento: String(numero),
          valor_total: valorTotal,
          valor_pago: 0,
          valor_saldo: valorTotal,
          status: 'Pendente'
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      setShowForm(false);
      setEditingItem(null);
      toast.success('✅ Lançamento salvo!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => {
      const valorTotal = (data.valor_original || 0) + (data.valor_juros || 0) + (data.valor_multa || 0) - (data.valor_desconto || 0);
      return base44.entities.LancamentoFinanceiro.update(id, { ...data, valor_total: valorTotal });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      setShowForm(false);
      setEditingItem(null);
      toast.success('✅ Atualizado!');
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
        throw new Error('Nenhuma baixa encontrada para este lançamento!');
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
    if (editingItem?.id) {
      updateMutation.mutate({ id: editingItem.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setShowForm(true);
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
    try {
      setShowImportarXML(false);
      setShowProgressoImportacao(true);
      setProgressoImportacao({ etapa: '🚀 Iniciando importação...', current: 0, total: 100 });
      
      await new Promise(resolve => setTimeout(resolve, 300)); // Small delay for UX
      
      const movIds = [];
      
      if (dados.gerarEstoque && dados.itens?.length > 0) {
        setProgressoImportacao({ etapa: '📦 Lançando produtos no estoque...', current: 0, total: dados.itens.length });
        
        for (let i = 0; i < dados.itens.length; i++) {
          const item = dados.itens[i];
          const num = await getNextNumeroMovimentacao(empresaSelecionadaId);
          const prod = produtos.find(p => p.id === item.produto_id);
          
          if (!prod) {
            console.warn(`Produto com ID ${item.produto_id} não encontrado.`);
            continue;
          }

          const mov = await base44.entities.MovimentacaoEstoque.create({
            empresa_id: empresaSelecionadaId,
            numero_movimentacao: String(num),
            tipo_movimentacao: 'Entrada',
            tipo_detalhado: 'COMPRA',
            data_movimentacao: new Date().toISOString(),
            produto_id: prod.id,
            produto_nome: prod.nome_produto?.toUpperCase(),
            produto_codigo: prod.codigo_interno?.toUpperCase(),
            quantidade: item.quantidade,
            unidade_medida: item.unidade?.toUpperCase(),
            local_estoque_destino: dados.dadosComplementares.local_estoque?.toUpperCase(),
            valor_unitario: item.valor_unitario,
            valor_total: item.quantidade * item.valor_unitario,
            custo_medio_antes: prod?.preco_custo || 0,
            custo_medio_depois: (prod?.estoque_atual > 0) 
              ? ((prod.preco_custo * prod.estoque_atual) + (item.valor_unitario * item.quantidade)) / (prod.estoque_atual + item.quantidade)
              : item.valor_unitario,
            saldo_antes: prod?.estoque_atual || 0,
            saldo_depois: (prod?.estoque_atual || 0) + item.quantidade,
            tipo_documento: 'Nota Fiscal',
            numero_documento: dados.dadosNFe.numero,
            chave_documento: dados.dadosNFe.chave,
            data_documento: dados.dadosNFe.data_emissao,
            fornecedor_id: dados.fornecedor_id,
            fornecedor_nome: fornecedores.find(f => f.id === dados.fornecedor_id)?.nome?.toUpperCase(),
            centro_custo_id: dados.dadosComplementares?.centro_custo_id,
            motivo_movimentacao: `COMPRA NF-E ${dados.dadosNFe.numero}`,
            observacoes: (dados.dadosComplementares?.observacoes || '').toUpperCase(),
            usuario_responsavel: (await base44.auth.me()).email,
            status: 'Ativa'
          });
          
          movIds.push(mov.id);
          
          await base44.entities.Produto.update(prod.id, {
            estoque_atual: (prod?.estoque_atual || 0) + item.quantidade,
            preco_custo: mov.custo_medio_depois
          });
          
          setProgressoImportacao({ etapa: '📦 Lançando produtos no estoque...', current: i + 1, total: dados.itens.length });
          await new Promise(resolve => setTimeout(resolve, 50)); // Small delay for progress bar update
        }
        
        toast.success(`✅ ${dados.itens.length} produto(s) no estoque!`);
      }

      if (dados.gerarLivroFiscal && dados.itens?.length > 0) {
        setProgressoImportacao({ etapa: '📚 Criando registro fiscal...', current: 0, total: 1 });
        
        const num = await getNextNumeroLivro(empresaSelecionadaId);
        const forn = fornecedores.find(f => f.id === dados.fornecedor_id);
        
        await base44.entities.LivroFiscal.create({
          empresa_id: empresaSelecionadaId,
          numero_registro: String(num),
          tipo_livro: 'Entrada',
          tipo_documento: 'NF-e',
          numero_documento: dados.dadosNFe.numero,
          serie_documento: dados.dadosNFe.serie,
          chave_acesso: dados.dadosNFe.chave,
          data_emissao: dados.dadosNFe.data_emissao,
          data_entrada_saida: new Date().toISOString().split('T')[0],
          fornecedor_id: dados.fornecedor_id,
          fornecedor_nome: forn?.nome?.toUpperCase(),
          fornecedor_cnpj_cpf: forn?.cnpj || forn?.cpf,
          cfop: dados.dadosNFe.cfop || '5102',
          natureza_operacao: (dados.dadosNFe.natureza_operacao || 'COMPRA').toUpperCase(),
          valor_produtos: dados.itens.reduce((s, i) => s + (i.quantidade * i.valor_unitario), 0),
          valor_total_nota: dados.dadosNFe.valor_total,
          itens: dados.itens.map(i => ({
            produto_id: i.produto_id,
            produto_nome: i.produto_nome?.toUpperCase(),
            codigo_produto: i.codigo?.toUpperCase(),
            ncm: i.ncm,
            cfop: i.cfop,
            quantidade: i.quantidade,
            unidade: i.unidade?.toUpperCase(),
            valor_unitario: i.valor_unitario,
            valor_total: i.quantidade * i.valor_unitario
          })),
          movimentacao_estoque_ids: movIds,
          status: 'Ativo'
        });
        
        setProgressoImportacao({ etapa: '📚 Registro fiscal criado!', current: 1, total: 1 });
        toast.success('✅ Registro fiscal criado!');
      }

      if (dados.gerarFinanceiro) {
        const totalFinanceiro = dados.parcelar && dados.parcelas?.length > 0 ? dados.parcelas.length : 1;
        setProgressoImportacao({ etapa: '💰 Criando lançamentos financeiros...', current: 0, total: totalFinanceiro });
        
        const forn = fornecedores.find(f => f.id === dados.fornecedor_id);
        const plano = planos.find(p => p.id === dados.dadosComplementares?.plano_contas_id);
        const grupo = grupos.find(g => g.id === dados.dadosComplementares?.grupo_id);
        
        const produtosLancamento = dados.itens.map(i => ({
          produto_id: i.produto_id,
          produto_nome: i.produto_nome,
          codigo: i.codigo,
          quantidade: i.quantidade,
          unidade: i.unidade,
          valor_unitario: i.valor_unitario
        }));

        if (dados.parcelar && dados.parcelas?.length > 0) {
          for (let i = 0; i < dados.parcelas.length; i++) {
            const parcela = dados.parcelas[i];
            const numero = await getNextNumber(empresaSelecionadaId);
            
            await base44.entities.LancamentoFinanceiro.create({
              empresa_id: empresaSelecionadaId,
              numero_lancamento: String(numero),
              tipo: 'Pagar',
              tipo_documento: 'NF-e',
              fornecedor_id: dados.fornecedor_id,
              fornecedor_nome: forn?.nome?.toUpperCase(),
              numero_documento: dados.dadosNFe.numero,
              chave_nfe: dados.dadosNFe.chave,
              data_emissao: dados.dadosNFe.data_emissao,
              data_vencimento: parcela.data,
              valor_original: parcela.valor,
              valor_total: parcela.valor,
              valor_saldo: parcela.valor,
              valor_juros: 0,
              valor_multa: 0,
              valor_desconto: 0,
              valor_pago: 0,
              status: 'Pendente',
              plano_contas_id: dados.dadosComplementares?.plano_contas_id || undefined,
              plano_contas_nome: plano ? `${plano.codigo} - ${plano.descricao}` : undefined,
              grupo_id: dados.dadosComplementares?.grupo_id || undefined,
              grupo_nome: grupo?.descricao,
              centro_custo_id: dados.dadosComplementares?.centro_custo_id || undefined,
              observacoes: `IMPORTAÇÃO NF-E ${dados.dadosNFe.numero} - PARCELA ${i + 1}/${dados.parcelas.length}${dados.dadosComplementares?.observacoes ? ' - ' + dados.dadosComplementares.observacoes.toUpperCase() : ''}`,
              numero_parcela: i + 1,
              total_parcelas: dados.parcelas.length,
              produtos_lancamento: produtosLancamento,
              gerado_xml: true
            });
            
            setProgressoImportacao({ etapa: '💰 Criando lançamentos...', current: i + 1, total: dados.parcelas.length });
            await new Promise(resolve => setTimeout(resolve, 80)); // Small delay for progress bar update
          }
          
          toast.success(`✅ ${dados.parcelas.length} lançamentos financeiros criados!`);
        } else {
          const numero = await getNextNumber(empresaSelecionadaId);
          
          await base44.entities.LancamentoFinanceiro.create({
            empresa_id: empresaSelecionadaId,
            numero_lancamento: String(numero),
            tipo: 'Pagar',
            tipo_documento: 'NF-e',
            fornecedor_id: dados.fornecedor_id,
            fornecedor_nome: forn?.nome?.toUpperCase(),
            numero_documento: dados.dadosNFe.numero,
            chave_nfe: dados.dadosNFe.chave,
            data_emissao: dados.dadosNFe.data_emissao,
            data_vencimento: dados.dataVencimento,
            valor_original: dados.dadosNFe.valor_total,
            valor_total: dados.dadosNFe.valor_total,
            valor_saldo: dados.dadosNFe.valor_total,
            valor_juros: 0,
            valor_multa: 0,
            valor_desconto: 0,
            valor_pago: 0,
            status: 'Pendente',
            plano_contas_id: dados.dadosComplementares?.plano_contas_id || undefined,
            plano_contas_nome: plano ? `${plano.codigo} - ${plano.descricao}` : undefined,
            grupo_id: dados.dadosComplementares?.grupo_id || undefined,
            grupo_nome: grupo?.descricao,
            centro_custo_id: dados.dadosComplementares?.centro_custo_id || undefined,
            observacoes: (dados.dadosComplementares?.observacoes || `IMPORTAÇÃO NF-E ${dados.dadosNFe.numero}`).toUpperCase(),
            produtos_lancamento: produtosLancamento,
            gerado_xml: true
          });
          
          setProgressoImportacao({ etapa: '💰 Lançamento criado!', current: 1, total: 1 });
          toast.success('✅ Lançamento financeiro criado!');
        }
      }
      
      setProgressoImportacao({ etapa: '✅ Concluído!', current: 100, total: 100 });
      await new Promise(resolve => setTimeout(resolve, 800)); // Small delay before closing dialog
      
      setShowProgressoImportacao(false);
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      queryClient.invalidateQueries({ queryKey: ['produtos_financeiro'] });
      toast.success('🎉 Importação concluída!');
      
    } catch (error) {
      console.error('❌ Erro:', error);
      setShowProgressoImportacao(false);
      toast.error('Erro: ' + (error.message || 'Erro desconhecido'));
    }
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
      qtdVencidos: vencidos.length
    };
  }, [lancamentos, lancamentosPagar, lancamentosReceber]);

  const formatarMoeda = (valor) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const progressPercentage = progressoImportacao.total > 0 ? Math.round((progressoImportacao.current / progressoImportacao.total) * 100) : 0;

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* HEADER COMPACTO */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">Controle Financeiro</h1>
          <p className="text-xs md:text-sm text-slate-600">Gerenciar contas a pagar e receber</p>
        </div>
      </div>

      {/* CARTÕES RESUMO - COMPACTOS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="shadow-sm border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-xs font-medium text-slate-600 mb-1">Contas a Pagar</p>
                <p className="text-2xl font-bold text-red-700">{formatarMoeda(estatisticas.totalPagar)}</p>
                <p className="text-xs text-slate-500 mt-1">{lancamentosPagar.filter(l => l.status !== 'Pago' && l.status !== 'Cancelado').length} título(s)</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
                <TrendingDown className="w-5 h-5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-l-4 border-l-emerald-500">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-xs font-medium text-slate-600 mb-1">Contas a Receber</p>
                <p className="text-2xl font-bold text-emerald-700">{formatarMoeda(estatisticas.totalReceber)}</p>
                <p className="text-xs text-slate-500 mt-1">{lancamentosReceber.filter(l => l.status !== 'Pago' && l.status !== 'Cancelado').length} título(s)</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-emerald-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-l-4 border-l-amber-500">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-xs font-medium text-slate-600 mb-1">Títulos Vencidos</p>
                <p className="text-2xl font-bold text-amber-700">{formatarMoeda(estatisticas.totalVencidos)}</p>
                <p className="text-xs text-slate-500 mt-1">⚠️ {estatisticas.qtdVencidos} título(s)</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {!showForm && !showBaixa && (
        <div className="flex gap-2">
          <Button onClick={() => setShowImportarXML(true)} variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
            <FileText className="w-3.5 h-3.5" />
            Importar NF-e
          </Button>
          <Button onClick={() => { setEditingItem(null); setShowForm(true); }} size="sm" className="h-9 gap-1.5 text-xs bg-slate-900 hover:bg-slate-800">
            <Plus className="w-3.5 h-3.5" />
            Novo Lançamento
          </Button>
        </div>
      )}

      {showForm && (
        <FormularioFinanceiro
          onSubmit={handleSubmit}
          onCancel={() => { setShowForm(false); setEditingItem(null); }}
          initialData={editingItem}
          fornecedores={fornecedores}
          produtos={produtos}
          safras={safras}
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

      <Dialog open={showProgressoImportacao} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
              Importando NF-e
            </DialogTitle>
            <DialogDescription className="text-xs">
              {progressoImportacao.etapa}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-3">
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-600">Progresso</span>
                <span className="font-semibold text-slate-900">{progressoImportacao.current} de {progressoImportacao.total}</span>
              </div>
              <Progress value={progressPercentage} className="h-2" />
              <p className="text-center text-sm font-semibold text-blue-600">{progressPercentage}%</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {!showForm && !showBaixa && (
        <Tabs value={tipoAba} onValueChange={setTipoAba}>
          <TabsList className="grid w-full max-w-md grid-cols-2 h-9">
            <TabsTrigger value="pagar" className="gap-1.5 text-xs h-8">
              <TrendingDown className="w-3.5 h-3.5" />
              A Pagar ({lancamentosPagar.length})
            </TabsTrigger>
            <TabsTrigger value="receber" className="gap-1.5 text-xs h-8">
              <TrendingUp className="w-3.5 h-3.5" />
              A Receber ({lancamentosReceber.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pagar" className="mt-3">
            <TabelaFinanceiro
              lancamentos={lancamentosPagar}
              tipo="Pagar"
              onEdit={handleEdit}
              onDelete={handleDelete}
              onBaixa={handleBaixa}
              onCancelarBaixa={handleCancelarBaixa}
              isLoading={isLoading}
              fornecedores={fornecedores}
              produtos={produtos}
            />
          </TabsContent>

          <TabsContent value="receber" className="mt-3">
            <TabelaFinanceiro
              lancamentos={lancamentosReceber}
              tipo="Receber"
              onEdit={handleEdit}
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
