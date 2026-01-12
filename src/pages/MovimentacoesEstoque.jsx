import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, ArrowRightLeft, TrendingUp, TrendingDown, Package, Download, AlertTriangle, FileUp, FileText } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";

import MovimentacaoEstoqueFormV2 from "../components/movimentacoes/MovimentacaoEstoqueFormV2";
import TabelaMovimentacoes from "../components/movimentacoes/TabelaMovimentacoes";
import ImportarNFeMovimentacao from "../components/movimentacoes/ImportarNFeMovimentacao";
import { toValue, prepararLocaisParaSalvar, getLabelOperacao, getLocalEstoque } from "../components/movimentacoes/utils/movimentacaoUtils";


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

const parseNumero = (str) => {
  if (!str && str !== 0) return 0;
  if (typeof str === 'number') return str;
  return parseFloat(String(str).replace(/\./g, '').replace(',', '.')) || 0;
};

const parseMoedaBR = (str) => {
  if (!str && str !== 0) return 0;
  if (typeof str === 'number') return str;
  const cleaned = String(str)
    .replace(/\s/g, '')
    .replace(/R\$/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
};

// Criar lote de estoque (para entradas)
const criarLoteEstoque = async (empresaId, produto, dadosComuns, fornecedor) => {
const destinoId = (dadosComuns.local_estoque_destino || '').trim();
const destinoNome = (dadosComuns.local_destino || '').trim();
const loteData = {
  empresa_id: empresaId,
  produto_id: produto.produto_id,
  produto_nome: produto.produto_nome,
  local_estoque_id: destinoId,
  local_estoque_nome: destinoNome,
  numero_documento: dadosComuns.numero_documento || null,
  serie_documento: dadosComuns.serie_documento || null,
  data_documento: dadosComuns.data_documento || null,
  fornecedor_id: dadosComuns.fornecedor_id || null,
  fornecedor_nome: fornecedor?.nome || null,
  custo_unitario: produto.valor_unitario || 0,
  quantidade_entrada: produto.quantidade,
  quantidade_disponivel: produto.quantidade,
  status: 'Disponivel'
};

return await base44.entities.EstoqueLoteNota.create(loteData);
};

// Baixar estoque do lote (para saídas)
const baixarLoteEstoque = async (loteOrigemId, quantidade) => {
  if (!loteOrigemId) return;
  
  const lote = await base44.entities.EstoqueLoteNota.filter({ id: loteOrigemId });
  if (lote && lote.length > 0) {
    const loteAtual = lote[0];
    const novoSaldo = Math.max(0, (loteAtual.quantidade_disponivel || 0) - quantidade);
    await base44.entities.EstoqueLoteNota.update(loteOrigemId, {
      quantidade_disponivel: novoSaldo,
      status: novoSaldo <= 0 ? 'Esgotado' : 'Disponivel'
    });
  }
};

// Baixar estoque de múltiplos lotes (FIFO)
const baixarLotesFIFO = async (rateioLotes) => {
  if (!rateioLotes || rateioLotes.length === 0) return;
  
  for (const rateio of rateioLotes) {
    if (rateio.lote_id && rateio.quantidade_consumida > 0) {
      await baixarLoteEstoque(rateio.lote_id, rateio.quantidade_consumida);
    }
  }
};

export default function MovimentacoesEstoque() {
  const [showForm, setShowForm] = useState(false);
  const [editingMovimentacao, setEditingMovimentacao] = useState(null);
  const [showImportXML, setShowImportXML] = useState(false);
  const [dadosImportadosXML, setDadosImportadosXML] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ current: 0, total: 0 });

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

    const quantidade = typeof produto.quantidade === 'number' ? produto.quantidade : parseNumero(produto.quantidade);
    const valorTotal = typeof produto.valor_total === 'number' ? produto.valor_total : parseMoedaBR(produto.valor_total);
    const desconto = typeof produto.desconto === 'number' ? produto.desconto : parseMoedaBR(produto.desconto || 0);
    const valorLiquido = valorTotal;
    const valorUnitario = typeof produto.valor_unitario === 'number' ? produto.valor_unitario : (quantidade > 0 ? valorLiquido / quantidade : 0);

    const estoqueAtual = produtoData.estoque_atual || 0;
    const custoMedioAtual = produtoData.preco_custo || 0;
    let novoEstoque = estoqueAtual;
    let novoCustoMedio = custoMedioAtual;

    if (dadosComuns.tipo_movimentacao === 'Entrada') {
      novoEstoque = estoqueAtual + quantidade;
      if (dadosComuns.tipo_detalhado?.toUpperCase().includes('COMPRA') && valorUnitario) {
        novoCustoMedio = calcularCustoMedio(estoqueAtual, custoMedioAtual, quantidade, valorUnitario);
      }
    } else if (dadosComuns.tipo_movimentacao === 'Saída' || dadosComuns.tipo_movimentacao === 'Transferência') {
      novoEstoque = estoqueAtual - quantidade;
    } else if (dadosComuns.tipo_movimentacao === 'Ajuste') {
      if (dadosComuns.tipo_detalhado?.toUpperCase().includes('POSITIVO')) {
        novoEstoque = estoqueAtual + quantidade;
      } else {
        novoEstoque = estoqueAtual - quantidade;
      }
    }

    const proximoNumero = await getNextSystemNumber();

    const tipoVinc = produto.vinculo_tipo;
    const vincId = produto.vinculo_id;
    const vincNome = produto.vinculo_nome;

    const locais = prepararLocaisParaSalvar({ ...dadosComuns, tipo_movimentacao: dadosComuns.tipo_movimentacao, tipo_detalhado: dadosComuns.tipo_detalhado });

    const movimentacao = {
       empresa_id: empresaSelecionadaId,
      numero_movimentacao: String(proximoNumero),
      tipo_movimentacao: dadosComuns.tipo_movimentacao,
      tipo_detalhado: dadosComuns.tipo_detalhado,
      data_movimentacao: dadosComuns.data_movimentacao ? new Date(dadosComuns.data_movimentacao).toISOString() : new Date().toISOString(),
      produto_id: produto.produto_id,
      produto_nome: produto.produto_nome,
      produto_codigo: produtoData.codigo_interno,
      produto_categoria: produtoData.categoria,
      quantidade: quantidade,
      unidade_medida: produto.unidade || produtoData.unidade_medida,
      valor_unitario: valorUnitario,
      valor_total: valorLiquido,
      ...locais,
      tipo_documento: dadosComuns.tipo_documento || undefined,
      numero_documento: dadosComuns.numero_documento || undefined,
      serie_documento: dadosComuns.serie_documento || undefined,
      chave_documento: dadosComuns.chave_documento || undefined,
      data_documento: dadosComuns.data_documento || undefined,
      cfop: dadosComuns.cfop || undefined,
      natureza_operacao: dadosComuns.natureza_operacao || undefined,
      fornecedor_id: dadosComuns.fornecedor_id || undefined,
      fornecedor_nome: dadosComuns.fornecedor_id ? fornecedores.find(f => f.id === dadosComuns.fornecedor_id)?.nome : undefined,
      cliente_nome: dadosComuns.cliente_nome || undefined,
      centro_custo_id: dadosComuns.centro_custo_id || undefined,
      centro_custo_nome: dadosComuns.centro_custo_id ? centros.find(c => c.id === dadosComuns.centro_custo_id)?.nome : undefined,
      motivo_movimentacao: dadosComuns.motivo_movimentacao,
      observacoes: dadosComuns.observacoes || undefined,
      // vínculo por item
      tipo_vinculo: tipoVinc || dadosComuns.tipo_vinculo,
      lote_vinculado_id: tipoVinc === 'lote' ? vincId : undefined,
      lote_vinculado_nome: tipoVinc === 'lote' ? vincNome : undefined,
      area_vinculada_id: tipoVinc === 'area' ? vincId : undefined,
      area_vinculada_nome: tipoVinc === 'area' ? vincNome : undefined,
      maquina_vinculada_id: tipoVinc === 'maquina' ? vincId : undefined,
      maquina_vinculada_nome: tipoVinc === 'maquina' ? vincNome : undefined,
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

    // Criar lote de estoque para entradas
    if (dadosComuns.tipo_movimentacao === 'Entrada') {
      const fornecedor = fornecedores.find(f => f.id === dadosComuns.fornecedor_id);
      await criarLoteEstoque(empresaSelecionadaId, {
        ...produto,
        quantidade,
        valor_unitario: valorUnitario
      }, { ...dadosComuns, ...locais }, fornecedor);
    }

    // Baixar lote de estoque para saídas
    if (dadosComuns.tipo_movimentacao === 'Saída') {
      if (produto.modo_custo_saida === 'fifo' && produto.rateio_lotes) {
        // FIFO - baixar de múltiplos lotes
        await baixarLotesFIFO(produto.rateio_lotes);
      } else if (produto.lote_origem_id) {
        // Por lote manual
        await baixarLoteEstoque(produto.lote_origem_id, quantidade);
      }
    }
  };

  const handleSubmit = async (formData) => {
    const produtosLista = formData.produtos_selecionados || formData.produtos || [];
    
    if (produtosLista.length === 0) {
      toast.error('Adicione pelo menos um produto!');
      return;
    }

    setIsSaving(true);
    setSaveProgress({ current: 0, total: produtosLista.length });

    try {
      const { produtos_selecionados, produtos: produtosForm, ...dadosComuns } = formData;

      // Se está editando, atualizar a movimentação existente
      if (editingMovimentacao?.id) {
        const produto = produtosLista[0];
        const produtoData = produtos.find(p => p.id === produto.produto_id);
        
        if (!produtoData) {
          throw new Error('Produto não encontrado');
        }

        const quantidade = parseNumero(produto.quantidade);
        const valorTotal = parseNumero(produto.valor_total);
        const desconto = parseNumero(produto.desconto_item || 0);
        const valorLiquido = valorTotal - desconto;
        const valorUnitario = quantidade > 0 ? (valorLiquido / quantidade) : 0;

        // Reverter estoque antigo
        const movAnterior = editingMovimentacao;
        let estoqueAtual = produtoData.estoque_atual || 0;
        
        if (movAnterior.tipo_movimentacao === 'Entrada') {
          estoqueAtual -= movAnterior.quantidade;
        } else if (movAnterior.tipo_movimentacao === 'Saída') {
          estoqueAtual += movAnterior.quantidade;
        }

        // Aplicar novo estoque
        let novoEstoque = estoqueAtual;
        if (dadosComuns.tipo_movimentacao === 'Entrada') {
          novoEstoque = estoqueAtual + quantidade;
        } else if (dadosComuns.tipo_movimentacao === 'Saída') {
          novoEstoque = estoqueAtual - quantidade;
        } else if (dadosComuns.tipo_movimentacao === 'Ajuste') {
          if (dadosComuns.tipo_detalhado?.toUpperCase().includes('POSITIVO')) {
            novoEstoque = estoqueAtual + quantidade;
          } else {
            novoEstoque = estoqueAtual - quantidade;
          }
        }

        const centro = centros.find(c => c.id === dadosComuns.centro_custo_id);
        const fornecedor = fornecedores.find(f => f.id === dadosComuns.fornecedor_id);

        const tipoVinc = produto.vinculo_tipo;
        const vincId = produto.vinculo_id;
        const vincNome = produto.vinculo_nome;

        // Usar campos de local que já vêm preparados do formulário
        const locaisEdit = prepararLocaisParaSalvar({ ...dadosComuns, tipo_movimentacao: dadosComuns.tipo_movimentacao, tipo_detalhado: dadosComuns.tipo_detalhado });

        await base44.entities.MovimentacaoEstoque.update(editingMovimentacao.id, {
          tipo_movimentacao: dadosComuns.tipo_movimentacao,
          tipo_detalhado: dadosComuns.tipo_detalhado,
          produto_id: produto.produto_id,
          produto_nome: produto.produto_nome,
          produto_codigo: produtoData.codigo_interno,
          quantidade: quantidade,
          unidade_medida: produto.unidade || produtoData.unidade_medida,
          valor_unitario: valorUnitario,
          valor_total: valorLiquido,
          ...locaisEdit,
          tipo_documento: dadosComuns.tipo_documento || undefined,
          numero_documento: dadosComuns.numero_documento || undefined,
          serie_documento: dadosComuns.serie_documento || undefined,
          chave_documento: dadosComuns.chave_documento || undefined,
          data_documento: dadosComuns.data_documento || undefined,
          cfop: dadosComuns.cfop || undefined,
          natureza_operacao: dadosComuns.natureza_operacao || undefined,
          fornecedor_id: dadosComuns.fornecedor_id || undefined,
          fornecedor_nome: fornecedor?.nome,
          cliente_nome: dadosComuns.cliente_nome || undefined,
          centro_custo_id: dadosComuns.centro_custo_id || undefined,
          centro_custo_nome: centro?.nome,
          motivo_movimentacao: dadosComuns.motivo_movimentacao || undefined,
          observacoes: dadosComuns.observacoes || undefined,
          // vínculo por item
          tipo_vinculo: tipoVinc || dadosComuns.tipo_vinculo,
          lote_vinculado_id: tipoVinc === 'lote' ? vincId : undefined,
          lote_vinculado_nome: tipoVinc === 'lote' ? vincNome : undefined,
          area_vinculada_id: tipoVinc === 'area' ? vincId : undefined,
          area_vinculada_nome: tipoVinc === 'area' ? vincNome : undefined,
          maquina_vinculada_id: tipoVinc === 'maquina' ? vincId : undefined,
          maquina_vinculada_nome: tipoVinc === 'maquina' ? vincNome : undefined,
          saldo_antes: estoqueAtual,
          saldo_depois: novoEstoque,
        });

        await base44.entities.Produto.update(produtoData.id, {
          estoque_atual: novoEstoque
        });

        queryClient.invalidateQueries({ queryKey: ['movimentacoes'] });
        queryClient.invalidateQueries({ queryKey: ['produtos'] });
        
        setTimeout(() => {
          setIsSaving(false);
          setShowForm(false);
          setEditingMovimentacao(null);
          toast.success('✅ Movimentação atualizada!');
        }, 500);
        return;
      }

      // Criar novas movimentações
      let saved = 0;
      for (const produto of produtosLista) {
        await processarMovimentacaoProduto(produto, dadosComuns);
        saved++;
        setSaveProgress({ current: saved, total: produtosLista.length });
      }

      queryClient.invalidateQueries({ queryKey: ['movimentacoes'] });
      queryClient.invalidateQueries({ queryKey: ['produtos'] });
      
      setTimeout(() => {
        setIsSaving(false);
        setShowForm(false);
        setEditingMovimentacao(null);
        setDadosImportadosXML(null);
        toast.success(`✅ ${produtosLista.length} movimentação(ões) registrada(s)!`);
      }, 500);
    } catch (error) {
      console.error('Erro:', error);
      setIsSaving(false);
      toast.error(error.message || 'Erro ao processar movimentação');
    }
  };

  const handleEdit = (movimentacao) => {
    // Transformar registro para initialData compatível com o formulário
    const prodSel = [{
      produto_id: movimentacao.produto_id,
      produto_nome: movimentacao.produto_nome,
      quantidade: movimentacao.quantidade,
      unidade: movimentacao.unidade_medida,
      valor_unitario: movimentacao.valor_unitario,
      valor_total: movimentacao.valor_total,
      vinculo_tipo: movimentacao.tipo_vinculo || undefined,
      vinculo_id: movimentacao.lote_vinculado_id || movimentacao.area_vinculada_id || movimentacao.maquina_vinculada_id || undefined,
      vinculo_nome: movimentacao.lote_vinculado_nome || movimentacao.area_vinculada_nome || movimentacao.maquina_vinculada_nome || undefined,
    }];

    const initialData = {
      id: movimentacao.id,
      tipo_movimentacao: movimentacao.tipo_movimentacao,
      tipo_detalhado: movimentacao.tipo_detalhado,
      data_movimentacao: movimentacao.data_movimentacao,
      local_estoque_origem: movimentacao.local_estoque_origem || movimentacao.local_origem || "",
      local_estoque_destino: movimentacao.local_estoque_destino || movimentacao.local_destino || "",
      local_origem: movimentacao.local_origem || "",
      local_destino: movimentacao.local_destino || "",
      tipo_documento: movimentacao.tipo_documento,
      numero_documento: movimentacao.numero_documento,
      serie_documento: movimentacao.serie_documento,
      chave_documento: movimentacao.chave_documento,
      data_documento: movimentacao.data_documento,
      cfop: movimentacao.cfop,
      natureza_operacao: movimentacao.natureza_operacao,
      fornecedor_id: movimentacao.fornecedor_id,
      fornecedor_nome: movimentacao.fornecedor_nome,
      cliente_nome: movimentacao.cliente_nome,
      centro_custo_id: movimentacao.centro_custo_id,
      centro_custo_nome: movimentacao.centro_custo_nome,
      motivo_movimentacao: movimentacao.motivo_movimentacao,
      observacoes: movimentacao.observacoes,
      produtos_selecionados: prodSel,
    };

    setEditingMovimentacao(initialData);
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
    const headers = ['Nº', 'Data/Hora', 'Tipo', 'Tipo Detalhado', 'Produto', 'Qtd', 'Local Estoque', 'Origem', 'Destino', 'Documento', 'Motivo'];
    csvRows.push(headers.join(';'));

    movimentacoes.forEach(m => {
      const row = [
        m.numero_movimentacao,
        format(new Date(m.data_movimentacao), 'dd/MM/yyyy HH:mm'),
        m.tipo_movimentacao,
        getLabelOperacao(m.tipo_detalhado), // Usar label amigável
        m.produto_nome,
        m.quantidade,
        getLocalEstoque(m), // Local principal conforme regra
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

  const handleImportacaoXML = (dadosImportacao) => {
    setDadosImportadosXML(dadosImportacao);
    setShowImportXML(false);
    setShowForm(true);
    toast.success('Dados carregados no formulário!');
  };

  const saveProgressPercentage = saveProgress.total > 0 
    ? Math.round((saveProgress.current / saveProgress.total) * 100) 
    : 0;

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
              <Button onClick={() => setShowImportXML(true)} variant="outline" size="sm" className="h-8 text-xs">
                Importação NF-e
              </Button>
              <Button onClick={handleExport} variant="outline" size="sm" className="h-8 text-xs">
                Exportar
              </Button>
              <Button onClick={() => { setEditingMovimentacao(null); setDadosImportadosXML(null); setShowForm(true); }} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                Nova Movimentação
              </Button>
            </div>
          </div>
        </>
      )}

      <AnimatePresence>
        {showForm && (
          <MovimentacaoEstoqueFormV2
            onSubmit={handleSubmit}
            onCancel={() => { setShowForm(false); setEditingMovimentacao(null); setDadosImportadosXML(null); }}
            initialData={dadosImportadosXML || editingMovimentacao}
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
      />

      <Dialog open={isSaving} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
              Salvando Movimentações
            </DialogTitle>
            <DialogDescription>
              Aguarde enquanto processamos as movimentações de estoque...
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Progresso</span>
                <span className="font-semibold text-slate-900">
                  {saveProgress.current} de {saveProgress.total}
                </span>
              </div>
              <Progress value={saveProgressPercentage} className="h-3" />
              <p className="text-center text-sm font-medium text-emerald-600">
                {saveProgressPercentage}%
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}