
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, ArrowRightLeft, TrendingUp, TrendingDown, Package, Download, AlertTriangle, FileUp, FileText } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { format } from "date-fns";

import FormularioMovimentacao from "../components/movimentacoes/FormularioMovimentacao";
import TabelaMovimentacoes from "../components/movimentacoes/TabelaMovimentacoes";
import ImportarNFeMovimentacao from "../components/movimentacoes/ImportarNFeMovimentacao";

const getNextSystemNumber = async () => {
  try {
    const [pesagens, fornecedores, produtos, movimentacoes] = await Promise.all([
      base44.entities.Pesagem.list(),
      base44.entities.Fornecedor.list(),
      base44.entities.Produto.list(),
      base44.entities.MovimentacaoEstoque.list()
    ]);

    const numeros = [
      ...pesagens.map(p => parseInt(p.numero_registro) || 0),
      ...fornecedores.map(f => parseInt(f.numero_cadastro) || 0),
      ...produtos.map(p => parseInt(p.numero_produto) || 0),
      ...movimentacoes.map(m => parseInt(m.numero_movimentacao) || 0)
    ].filter(n => n > 0 && n < 1000000000);

    return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
  } catch (error) {
    console.error('Erro:', error);
    return 1;
  }
};

const calcularCustoMedio = (estoqueAtual, custoMedioAtual, quantidadeEntrada, custoEntrada) => {
  if (estoqueAtual === 0 || !custoMedioAtual) return custoEntrada;
  
  const valorTotalAtual = estoqueAtual * custoMedioAtual;
  const valorTotalEntrada = quantidadeEntrada * custoEntrada;
  const novoEstoque = estoqueAtual + quantidadeEntrada;
  
  return (valorTotalAtual + valorTotalEntrada) / novoEstoque;
};

export default function MovimentacoesEstoque() {
  const [showForm, setShowForm] = useState(false);
  const [editingMovimentacao, setEditingMovimentacao] = useState(null);
  const [showImportXML, setShowImportXML] = useState(false);

  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: movimentacoes, isLoading } = useQuery({
    queryKey: ['movimentacoes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list('-created_date');
      return all.filter(m => m.empresa_id === empresaSelecionadaId && m.status !== 'Cancelada');
    },
    initialData: [],
    enabled: !!empresaSelecionadaId,
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
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

  const { data: centros = [] } = useQuery({
    queryKey: ['centros', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CentroCusto.list();
      return all.filter(c => c.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  useEffect(() => {
    const numerarMovimentacoes = async () => {
      const movSemNumero = movimentacoes.filter(m => !m.numero_movimentacao || m.numero_movimentacao === '');
      
      if (movSemNumero.length > 0) {
        for (const mov of movSemNumero) {
          try {
            const proximoNumero = await getNextSystemNumber();
            await base44.entities.MovimentacaoEstoque.update(mov.id, {
              numero_movimentacao: String(proximoNumero)
            });
          } catch (error) {
            console.error(`Erro:`, error);
          }
        }
        queryClient.invalidateQueries({ queryKey: ['movimentacoes'] });
      }
    };

    if (!isLoading && movimentacoes.length > 0) {
      numerarMovimentacoes();
    }
  }, [movimentacoes, isLoading, queryClient]);

  const processarMovimentacaoProduto = async (produto, dadosComuns) => {
    const produtoData = produtos.find(p => p.id === produto.produto_id);
    if (!produtoData) throw new Error(`Produto ${produto.produto_nome} não encontrado`);

    const estoqueAtual = produtoData.estoque_atual || 0;
    const custoMedioAtual = produtoData.preco_custo || 0;
    let novoEstoque = estoqueAtual;
    let novoCustoMedio = custoMedioAtual;

    if (dadosComuns.tipo_movimentacao === 'Entrada') {
      novoEstoque = estoqueAtual + produto.quantidade;
      if (dadosComuns.tipo_detalhado?.includes('COMPRA') && produto.valor_unitario) {
        novoCustoMedio = calcularCustoMedio(estoqueAtual, custoMedioAtual, produto.quantidade, produto.valor_unitario);
      }
    } else if (dadosComuns.tipo_movimentacao === 'Saída' || dadosComuns.tipo_movimentacao === 'Transferência') {
      novoEstoque = estoqueAtual - produto.quantidade;
    } else if (dadosComuns.tipo_movimentacao === 'Ajuste') {
      if (dadosComuns.tipo_detalhado?.includes('POSITIVO')) {
        novoEstoque = estoqueAtual + produto.quantidade;
      } else {
        novoEstoque = estoqueAtual - produto.quantidade;
      }
    }

    const proximoNumero = await getNextSystemNumber();

    const movimentacao = {
      empresa_id: empresaSelecionadaId,
      numero_movimentacao: String(proximoNumero),
      ...dadosComuns,
      produto_id: produto.produto_id,
      produto_nome: produto.produto_nome,
      produto_codigo: produto.produto_codigo,
      quantidade: produto.quantidade,
      unidade_medida: produto.unidade_medida,
      valor_unitario: produto.valor_unitario || undefined,
      valor_total: produto.valor_total || undefined,
      saldo_antes: estoqueAtual,
      saldo_depois: novoEstoque,
      custo_medio_antes: custoMedioAtual,
      custo_medio_depois: novoCustoMedio,
      usuario_responsavel: user?.email || 'Sistema',
      status: 'Ativa'
    };

    await base44.entities.MovimentacaoEstoque.create(movimentacao);
    await base44.entities.Produto.update(produtoData.id, {
      estoque_atual: novoEstoque,
      preco_custo: novoCustoMedio
    });
  };

  const handleSubmit = async (formData) => {
    try {
      const { produtos: produtosLista, ...dadosComuns } = formData;

      for (const produto of produtosLista) {
        await processarMovimentacaoProduto(produto, dadosComuns);
      }

      queryClient.invalidateQueries({ queryKey: ['movimentacoes'] });
      queryClient.invalidateQueries({ queryKey: ['produtos'] });
      setShowForm(false);
      setEditingMovimentacao(null);
      toast.success(`✅ ${produtosLista.length} movimentação(ões) registrada(s)!`);
    } catch (error) {
      console.error('Erro:', error);
      toast.error(error.message || 'Erro ao processar movimentação');
    }
  };

  const handleEdit = (movimentacao) => {
    setEditingMovimentacao(movimentacao);
    setShowForm(true);
  };

  const handleCancel = async (id) => {
    if (window.confirm('⚠️ Cancelar movimentação e reverter estoque?')) {
      try {
        const mov = movimentacoes.find(m => m.id === id);
        const produto = produtos.find(p => p.id === mov.produto_id);
        
        let novoEstoque = produto.estoque_atual || 0;
        if (mov.tipo_movimentacao === 'Entrada') novoEstoque -= mov.quantidade;
        else if (mov.tipo_movimentacao === 'Saída') novoEstoque += mov.quantidade;

        await base44.entities.MovimentacaoEstoque.update(id, {
          status: 'Cancelada',
          cancelado_por: user?.email || 'Sistema',
          data_cancelamento: new Date().toISOString(),
          motivo_cancelamento: 'CANCELAMENTO'
        });

        await base44.entities.Produto.update(produto.id, { estoque_atual: novoEstoque });
        
        queryClient.invalidateQueries({ queryKey: ['movimentacoes'] });
        queryClient.invalidateQueries({ queryKey: ['produtos'] });
        toast.success('Cancelada!');
      } catch (error) {
        toast.error('Erro');
      }
    }
  };

  const handleExport = () => {
    const csvRows = [];
    const headers = ['Nº', 'Data/Hora', 'Tipo', 'Tipo Detalhado', 'Produto', 'Qtd', 'Origem', 'Destino', 'Documento', 'Motivo'];
    csvRows.push(headers.join(';'));

    movimentacoes.forEach(m => {
      const row = [
        m.numero_movimentacao,
        format(new Date(m.data_movimentacao), 'dd/MM/yyyy HH:mm'),
        m.tipo_movimentacao,
        m.tipo_detalhado,
        m.produto_nome,
        m.quantidade,
        m.local_estoque_origem || '',
        m.local_estoque_destino || '',
        m.numero_documento || '',
        m.motivo_movimentacao || ''
      ];
      csvRows.push(row.join(';'));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `movimentacoes_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.csv`;
    link.click();
    toast.success('Exportado!');
  };

  const handleImportacaoXML = async (dadosImportacao) => {
    try {
      const { produtos: produtosLista, ...dadosComuns } = dadosImportacao;

      for (const produto of produtosLista) {
        const produtoData = produtos.find(p => p.id === produto.produto_id);
        if (!produtoData) continue;

        const estoqueAtual = produtoData.estoque_atual || 0;
        const custoMedioAtual = produtoData.preco_custo || 0;
        
        const quantidade = typeof produto.quantidade === 'string' ? parseFloat(produto.quantidade.replace(',', '.')) : produto.quantidade;
        const valorTotal = typeof produto.valor_total === 'string' ? parseFloat(produto.valor_total.replace(',', '.')) : produto.valor_total;
        const desconto = typeof produto.desconto_item === 'string' ? parseFloat(produto.desconto_item.replace(',', '.')) : (produto.desconto_item || 0);
        
        const valorLiquido = valorTotal - desconto;
        const valorUnitario = quantidade > 0 ? (valorLiquido / quantidade) : 0;

        const novoEstoque = estoqueAtual + quantidade;
        const novoCustoMedio = calcularCustoMedio(estoqueAtual, custoMedioAtual, quantidade, valorUnitario);

        const proximoNumero = await getNextSystemNumber();

        await base44.entities.MovimentacaoEstoque.create({
          empresa_id: empresaSelecionadaId,
          numero_movimentacao: String(proximoNumero),
          tipo_movimentacao: 'Entrada',
          tipo_detalhado: dadosComuns.tipo_detalhado || 'Compra',
          data_movimentacao: new Date().toISOString(),
          produto_id: produto.produto_id,
          produto_nome: produto.produto_nome,
          produto_codigo: produtoData.codigo_interno,
          quantidade: quantidade,
          unidade_medida: produto.unidade || produtoData.unidade_medida,
          local_estoque_destino: dadosComuns.local_estoque,
          valor_unitario: valorUnitario,
          valor_total: valorLiquido,
          tipo_documento: dadosComuns.tipo_documento,
          numero_documento: dadosComuns.numero_documento,
          serie_documento: dadosComuns.serie_documento,
          chave_documento: dadosComuns.chave_documento,
          data_documento: dadosComuns.data_documento,
          cfop: dadosComuns.cfop,
          natureza_operacao: dadosComuns.natureza_operacao,
          fornecedor_id: dadosComuns.fornecedor_id,
          fornecedor_nome: dadosComuns.fornecedor_nome,
          motivo_movimentacao: dadosComuns.motivo_movimentacao || `IMPORTAÇÃO XML NF-E ${dadosComuns.numero_documento}`,
          observacoes: dadosComuns.observacoes,
          saldo_antes: estoqueAtual,
          saldo_depois: novoEstoque,
          custo_medio_antes: custoMedioAtual,
          custo_medio_depois: novoCustoMedio,
          usuario_responsavel: user?.email || 'Sistema',
          status: 'Ativa'
        });

        await base44.entities.Produto.update(produtoData.id, {
          estoque_atual: novoEstoque,
          preco_custo: novoCustoMedio
        });
      }

      queryClient.invalidateQueries({ queryKey: ['movimentacoes'] });
      queryClient.invalidateQueries({ queryKey: ['produtos'] });
      toast.success(`✅ ${produtosLista.length} produto(s) importado(s)!`);
    } catch (error) {
      console.error('Erro:', error);
      toast.error(error.message || 'Erro ao importar');
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-2">
      {!showForm && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Movimentação de Estoque</h1>
              <p className="text-xs text-slate-600">Entradas, saídas e ajustes</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setShowImportXML(true)} variant="outline" size="sm" className="h-8 gap-1 text-xs">
                <FileText className="w-3.5 h-3.5" />
                Importação NF-e (xml)
              </Button>
              <Button onClick={handleExport} variant="outline" size="sm" className="h-8 gap-1 text-xs">
                <Download className="w-3.5 h-3.5" />
                Exportar
              </Button>
              <Button onClick={() => { setEditingMovimentacao(null); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-slate-700 hover:bg-slate-800">
                <Plus className="w-3.5 h-3.5" />
                Nova Movimentação
              </Button>
            </div>
          </div>
        </>
      )}

      <AnimatePresence>
        {showForm && (
          <FormularioMovimentacao
            onSubmit={handleSubmit}
            onCancel={() => { setShowForm(false); setEditingMovimentacao(null); }}
            initialData={editingMovimentacao}
            isEditing={!!editingMovimentacao}
            produtos={produtos}
            fornecedores={fornecedores}
          />
        )}
      </AnimatePresence>

      {!showForm && <TabelaMovimentacoes movimentacoes={movimentacoes} onEdit={handleEdit} onCancel={handleCancel} isLoading={isLoading} />}

      <ImportarNFeMovimentacao
        open={showImportXML}
        onClose={() => setShowImportXML(false)}
        onSuccess={handleImportacaoXML}
        produtos={produtos}
        fornecedores={fornecedores}
        centros={centros} // Added to ensure it's available if needed by the component internally
      />
    </div>
  );
}
