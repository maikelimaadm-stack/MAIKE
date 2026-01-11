import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

// ========== CONFIGURAÇÕES DE OPERAÇÕES ==========
const OPERACOES_ENTRADA = [
  { value: 'compra', label: 'Compra', exigeFornecedor: true, exigeDocumento: true },
  { value: 'compra_vista', label: 'Compra à Vista', exigeFornecedor: true, exigeDocumento: true },
  { value: 'devolucao_cliente', label: 'Devolução de Cliente', exigeFornecedor: false, exigeDocumento: false },
  { value: 'bonificacao', label: 'Bonificação', exigeFornecedor: true, exigeDocumento: false },
  { value: 'doacao_recebida', label: 'Doação Recebida', exigeFornecedor: false, exigeDocumento: false },
  { value: 'producao_entrada', label: 'Produção / Entrada Interna', exigeFornecedor: false, exigeDocumento: false },
  { value: 'transferencia_recebida', label: 'Transferência Recebida', exigeFornecedor: false, exigeDocumento: false },
  { value: 'ajuste_positivo', label: 'Ajuste Positivo', exigeFornecedor: false, exigeDocumento: false },
  { value: 'outros_entrada', label: 'Outros', exigeFornecedor: false, exigeDocumento: false }
];

const OPERACOES_SAIDA = [
  { value: 'venda', label: 'Venda', exigeCliente: true, exigeDocumento: true },
  { value: 'venda_vista', label: 'Venda à Vista', exigeCliente: true, exigeDocumento: true },
  { value: 'consumo_interno', label: 'Consumo Interno', exigeVinculo: true },
  { value: 'suplementacao', label: 'Suplementação', exigeVinculo: true },
  { value: 'aplicacao_area', label: 'Aplicação em Área', exigeVinculo: true },
  { value: 'manutencao', label: 'Manutenção de Máquina', exigeVinculo: true },
  { value: 'doacao', label: 'Doação' },
  { value: 'perda', label: 'Perda', exigeMotivo: true },
  { value: 'quebra', label: 'Quebra', exigeMotivo: true },
  { value: 'transferencia_enviada', label: 'Transferência Enviada' },
  { value: 'ajuste_negativo', label: 'Ajuste Negativo' },
  { value: 'outros_saida', label: 'Outros' }
];

const OPERACOES_TRANSFERENCIA = [
  { value: 'entre_locais', label: 'Entre Locais (Estoques)' },
  { value: 'outros_transferencia', label: 'Outros' }
];

const OPERACOES_AJUSTE = [
  { value: 'ajuste_positivo', label: 'Ajuste Positivo' },
  { value: 'ajuste_negativo', label: 'Ajuste Negativo' },
  { value: 'inventario', label: 'Inventário' },
  { value: 'correcao', label: 'Correção' }
];

const MOTIVOS_PERDA = ['Vencimento', 'Quebra', 'Roubo', 'Contaminação', 'Erro operacional', 'Deterioração', 'Sinistro', 'Outro'];

const TIPOS_DOCUMENTO = [
  { value: 'nfe', label: 'NF-e' },
  { value: 'nfce', label: 'NFC-e' },
  { value: 'nota_fiscal', label: 'Nota Fiscal' },
  { value: 'recibo', label: 'Recibo' },
  { value: 'outros', label: 'Outros' }
];

const TIPOS_VINCULO = [
  { value: 'lote', label: 'Lote (Pecuária)' },
  { value: 'area', label: 'Área / Pasto' },
  { value: 'maquina', label: 'Máquina / Veículo' },
  { value: 'funcionario', label: 'Funcionário' }
];

export default function MovimentacaoEstoqueFormV2({ 
  onSubmit, 
  onCancel, 
  initialData = null, 
  produtos = [], 
  fornecedores = [] 
}) {
  const empresaId = localStorage.getItem('empresa_selecionada_id');

  // ========== ESTADO DO CABEÇALHO ==========
  const [tipo, setTipo] = useState(
    initialData?.tipo_movimentacao === 'Saída' ? 'SAIDA' : 
    initialData?.tipo_movimentacao === 'Transferência' ? 'TRANSFERENCIA' :
    initialData?.tipo_movimentacao === 'Ajuste' ? 'AJUSTE' : 'ENTRADA'
  );
  const [operacao, setOperacao] = useState(initialData?.tipo_detalhado || '');
  const [dataMovimentacao, setDataMovimentacao] = useState(
    initialData?.data_movimentacao?.split('T')[0] || new Date().toISOString().slice(0, 10)
  );
  
  const [localEstoqueOrigemId, setLocalEstoqueOrigemId] = useState(initialData?.local_estoque_origem_id || '');
  const [localEstoqueDestinoId, setLocalEstoqueDestinoId] = useState(initialData?.local_estoque_destino_id || '');
  const [centroCustoId, setCentroCustoId] = useState(initialData?.centro_custo_id || '');
  
  const [tipoDocumento, setTipoDocumento] = useState(initialData?.tipo_documento || '');
  const [numeroDocumento, setNumeroDocumento] = useState(initialData?.numero_documento || '');
  const [serieDocumento, setSerieDocumento] = useState(initialData?.serie_documento || '');
  const [dataDocumento, setDataDocumento] = useState(initialData?.data_documento || '');
  const [chaveDocumento, setChaveDocumento] = useState(initialData?.chave_documento || '');
  const [cfop, setCfop] = useState(initialData?.cfop || '');
  const [naturezaOperacao, setNaturezaOperacao] = useState(initialData?.natureza_operacao || '');
  
  const [fornecedorId, setFornecedorId] = useState(initialData?.fornecedor_id || '');
  const [clienteId, setClienteId] = useState(initialData?.cliente_id || '');
  
  const [tipoVinculo, setTipoVinculo] = useState(initialData?.tipo_vinculo || '');
  const [vinculoId, setVinculoId] = useState(
    initialData?.lote_vinculado_id || initialData?.area_vinculada_id || 
    initialData?.maquina_vinculada_id || ''
  );
  
  const [motivoMovimentacao, setMotivoMovimentacao] = useState(initialData?.motivo_movimentacao || '');
  const [observacoes, setObservacoes] = useState(initialData?.observacoes || '');

  // ========== ESTADO DOS ITENS ==========
  const [itens, setItens] = useState([]);
  
  const [currentItem, setCurrentItem] = useState({
    produto_id: '',
    produto_nome: '',
    produto_codigo: '',
    unidade: '',
    quantidade: '',
    preco_unitario: '',
    total: '',
    desconto: '',
    liquido: '',
    observacao_item: ''
  });
  const [editingIndex, setEditingIndex] = useState(null);

  // ========== QUERIES ==========
  const { data: locais = [] } = useQuery({
    queryKey: ['locais_estoque'],
    queryFn: () => base44.entities.LocalEstoque.list(),
  });

  const { data: centrosCusto = [] } = useQuery({
    queryKey: ['centros_custo', empresaId],
    queryFn: async () => {
      const all = await base44.entities.CentroCusto.list();
      return all.filter(c => c.empresa_id === empresaId && c.ativo !== false);
    },
    enabled: !!empresaId
  });

  const { data: lotes = [] } = useQuery({
    queryKey: ['lotes_pecuaria', empresaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter(l => l.empresa_id === empresaId && l.status === 'Ativo');
    },
    enabled: !!empresaId
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas_pastagem', empresaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaId);
    },
    enabled: !!empresaId
  });

  const { data: maquinas = [] } = useQuery({
    queryKey: ['maquinas', empresaId],
    queryFn: async () => {
      const all = await base44.entities.Maquina.list();
      return all.filter(m => m.empresa_id === empresaId && m.status === 'Ativo');
    },
    enabled: !!empresaId
  });

  const { data: movimentacoesEstoque = [] } = useQuery({
    queryKey: ['movimentacoes_calc', empresaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list();
      return all.filter(m => m.empresa_id === empresaId && m.status === 'Ativa');
    },
    enabled: !!empresaId
  });

  const clientes = useMemo(() => {
    return fornecedores.filter(f => f.tipos?.includes('Cliente') || !f.tipos || f.tipos.length === 0);
  }, [fornecedores]);

  // ========== COMPUTED ==========
  const operacoesDisponiveis = useMemo(() => {
    if (tipo === 'ENTRADA') return OPERACOES_ENTRADA;
    if (tipo === 'SAIDA') return OPERACOES_SAIDA;
    if (tipo === 'TRANSFERENCIA') return OPERACOES_TRANSFERENCIA;
    if (tipo === 'AJUSTE') return OPERACOES_AJUSTE;
    return [];
  }, [tipo]);

  const operacaoSelecionada = useMemo(() => {
    return operacoesDisponiveis.find(op => op.value === operacao);
  }, [operacoesDisponiveis, operacao]);

  const exibeFornecedor = tipo === 'ENTRADA' && operacaoSelecionada?.exigeFornecedor;
  const exibeDocumento = (tipo === 'ENTRADA' || tipo === 'SAIDA') && operacaoSelecionada?.exigeDocumento;
  const exibeCliente = tipo === 'SAIDA' && operacaoSelecionada?.exigeCliente;
  const exibeVinculo = tipo === 'SAIDA' && operacaoSelecionada?.exigeVinculo;
  const exibeMotivo = (tipo === 'SAIDA' && operacaoSelecionada?.exigeMotivo) || tipo === 'AJUSTE';

  // Estoque por local
  const estoquePorLocal = useMemo(() => {
    const estoques = {};
    produtos.forEach(p => { estoques[p.id] = {}; });

    movimentacoesEstoque.forEach(mov => {
      if (!mov.produto_id) return;
      if (!estoques[mov.produto_id]) estoques[mov.produto_id] = {};

      const origemId = mov.local_estoque_origem_id;
      const destinoId = mov.local_estoque_destino_id;
      const qtd = mov.quantidade || 0;

      if (mov.tipo_movimentacao === 'Entrada' && destinoId) {
        if (!estoques[mov.produto_id][destinoId]) estoques[mov.produto_id][destinoId] = 0;
        estoques[mov.produto_id][destinoId] += qtd;
      } else if ((mov.tipo_movimentacao === 'Saída' || mov.tipo_movimentacao === 'Transferência') && origemId) {
        if (!estoques[mov.produto_id][origemId]) estoques[mov.produto_id][origemId] = 0;
        estoques[mov.produto_id][origemId] -= qtd;
      }
      if (mov.tipo_movimentacao === 'Transferência' && destinoId) {
        if (!estoques[mov.produto_id][destinoId]) estoques[mov.produto_id][destinoId] = 0;
        estoques[mov.produto_id][destinoId] += qtd;
      }
      if (mov.tipo_movimentacao === 'Ajuste') {
        const localId = destinoId || origemId;
        if (localId) {
          if (!estoques[mov.produto_id][localId]) estoques[mov.produto_id][localId] = 0;
          if (mov.tipo_detalhado?.toLowerCase().includes('positivo') || mov.tipo_detalhado?.toLowerCase().includes('inventário')) {
            estoques[mov.produto_id][localId] += qtd;
          } else {
            estoques[mov.produto_id][localId] -= qtd;
          }
        }
      }
    });

    return estoques;
  }, [produtos, movimentacoesEstoque]);

  const localOrigemAtual = useMemo(() => {
    if (tipo === 'ENTRADA') return localEstoqueDestinoId;
    if (tipo === 'SAIDA' || tipo === 'TRANSFERENCIA') return localEstoqueOrigemId;
    if (tipo === 'AJUSTE') {
      return operacao?.includes('positivo') ? localEstoqueDestinoId : localEstoqueOrigemId;
    }
    return '';
  }, [tipo, operacao, localEstoqueOrigemId, localEstoqueDestinoId]);

  const saldoProdutoNoLocal = useMemo(() => {
    if (!currentItem.produto_id || !localOrigemAtual) return null;
    return estoquePorLocal[currentItem.produto_id]?.[localOrigemAtual] || 0;
  }, [currentItem.produto_id, localOrigemAtual, estoquePorLocal]);

  const produtosFiltrados = useMemo(() => {
    if (tipo === 'ENTRADA' || (tipo === 'AJUSTE' && operacao?.includes('positivo'))) {
      return produtos;
    }
    if (!localOrigemAtual) return [];
    return produtos.filter(p => {
      const saldo = estoquePorLocal[p.id]?.[localOrigemAtual] || 0;
      return saldo > 0;
    }).map(p => ({
      ...p,
      saldo_local: estoquePorLocal[p.id]?.[localOrigemAtual] || 0
    }));
  }, [tipo, operacao, localOrigemAtual, produtos, estoquePorLocal]);

  const totaisGerais = useMemo(() => {
    return itens.reduce((acc, item) => ({
      totalBruto: acc.totalBruto + (parseFloat(item.total) || 0),
      totalDescontos: acc.totalDescontos + (parseFloat(item.desconto) || 0),
      totalLiquido: acc.totalLiquido + (parseFloat(item.liquido) || 0)
    }), { totalBruto: 0, totalDescontos: 0, totalLiquido: 0 });
  }, [itens]);

  // ========== HANDLERS ==========
  const handleTipoChange = (novoTipo) => {
    setTipo(novoTipo);
    setOperacao('');
    setItens([]);
    resetCurrentItem();
    setFornecedorId('');
    setClienteId('');
    setTipoVinculo('');
    setVinculoId('');
    setMotivoMovimentacao('');
    setTipoDocumento('');
    setNumeroDocumento('');
    setSerieDocumento('');
    setDataDocumento('');
    setChaveDocumento('');
    setCfop('');
    setNaturezaOperacao('');
    if (novoTipo === 'ENTRADA') {
      setLocalEstoqueOrigemId('');
    } else if (novoTipo === 'SAIDA') {
      setLocalEstoqueDestinoId('');
    }
  };

  const handleOperacaoChange = (novaOperacao) => {
    setOperacao(novaOperacao);
    setItens([]);
    resetCurrentItem();
  };

  const resetCurrentItem = () => {
    setCurrentItem({
      produto_id: '',
      produto_nome: '',
      produto_codigo: '',
      unidade: '',
      quantidade: '',
      preco_unitario: '',
      total: '',
      desconto: '',
      liquido: '',
      observacao_item: ''
    });
    setEditingIndex(null);
  };

  const handleProdutoChange = (produtoId) => {
    const prod = produtos.find(p => p.id === produtoId);
    if (!prod) {
      resetCurrentItem();
      return;
    }

    let precoInicial = 0;
    if (tipo === 'ENTRADA') {
      precoInicial = prod.preco_custo || 0;
    } else if (tipo === 'SAIDA') {
      precoInicial = prod.preco_venda || prod.preco_custo || 0;
    } else if (tipo === 'TRANSFERENCIA') {
      precoInicial = prod.preco_custo || 0;
    }

    setCurrentItem(prev => ({
      ...prev,
      produto_id: produtoId,
      produto_nome: prod.nome_produto,
      produto_codigo: prod.codigo_interno || prod.codigo_barras || '',
      unidade: prod.unidade_medida || 'UN',
      preco_unitario: precoInicial || '',
      quantidade: '',
      total: '',
      desconto: '',
      liquido: ''
    }));
  };

  const recalcularTotais = (quantidade, precoUnitario, desconto) => {
    const qtd = parseFloat(quantidade) || 0;
    const preco = parseFloat(precoUnitario) || 0;
    const desc = parseFloat(desconto) || 0;
    const total = qtd * preco;
    const liquido = Math.max(0, total - desc);
    return { total, liquido };
  };

  const handleQuantidadeChange = (valor) => {
    const { total, liquido } = recalcularTotais(valor, currentItem.preco_unitario, currentItem.desconto);
    setCurrentItem(prev => ({
      ...prev,
      quantidade: valor,
      total: total || '',
      liquido: liquido || ''
    }));
  };

  const handlePrecoChange = (valor) => {
    const { total, liquido } = recalcularTotais(currentItem.quantidade, valor, currentItem.desconto);
    setCurrentItem(prev => ({
      ...prev,
      preco_unitario: valor,
      total: total || '',
      liquido: liquido || ''
    }));
  };

  const handleDescontoChange = (valor) => {
    const { total, liquido } = recalcularTotais(currentItem.quantidade, currentItem.preco_unitario, valor);
    setCurrentItem(prev => ({
      ...prev,
      desconto: valor,
      liquido: liquido || ''
    }));
  };

  const handleAdicionarItem = () => {
    if (!currentItem.produto_id) {
      toast.error('Selecione um produto');
      return;
    }

    const qtd = parseFloat(currentItem.quantidade) || 0;
    if (qtd <= 0) {
      toast.error('Informe uma quantidade válida');
      return;
    }

    const precisaValidarSaldo = tipo === 'SAIDA' || tipo === 'TRANSFERENCIA' || (tipo === 'AJUSTE' && operacao?.includes('negativo'));
    if (precisaValidarSaldo && saldoProdutoNoLocal !== null && qtd > saldoProdutoNoLocal) {
      toast.error(`Quantidade maior que o saldo disponível (${saldoProdutoNoLocal.toFixed(2)})`);
      return;
    }

    const { total, liquido } = recalcularTotais(currentItem.quantidade, currentItem.preco_unitario, currentItem.desconto);

    const novoItem = {
      produto_id: currentItem.produto_id,
      produto_nome: currentItem.produto_nome,
      produto_codigo: currentItem.produto_codigo,
      unidade: currentItem.unidade,
      quantidade: qtd,
      preco_unitario: parseFloat(currentItem.preco_unitario) || 0,
      total: total,
      desconto: parseFloat(currentItem.desconto) || 0,
      liquido: liquido,
      observacao_item: currentItem.observacao_item
    };

    if (editingIndex !== null) {
      setItens(prev => prev.map((item, idx) => idx === editingIndex ? novoItem : item));
      toast.success('Item atualizado');
    } else {
      setItens(prev => [...prev, novoItem]);
      toast.success('Item adicionado');
    }

    resetCurrentItem();
  };

  const handleEditarItem = (index) => {
    const item = itens[index];
    setCurrentItem({
      produto_id: item.produto_id,
      produto_nome: item.produto_nome,
      produto_codigo: item.produto_codigo,
      unidade: item.unidade,
      quantidade: item.quantidade,
      preco_unitario: item.preco_unitario,
      total: item.total,
      desconto: item.desconto,
      liquido: item.liquido,
      observacao_item: item.observacao_item || ''
    });
    setEditingIndex(index);
  };

  const handleRemoverItem = (index) => {
    setItens(prev => prev.filter((_, idx) => idx !== index));
    if (editingIndex === index) {
      resetCurrentItem();
    }
  };

  // ========== SUBMIT ==========
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!operacao) {
      toast.error('Selecione a operação');
      return;
    }
    if (!centroCustoId) {
      toast.error('Selecione o Centro de Custo');
      return;
    }
    if (itens.length === 0) {
      toast.error('Adicione pelo menos um item');
      return;
    }

    if (tipo === 'ENTRADA' && !localEstoqueDestinoId) {
      toast.error('Selecione o Local de Entrada');
      return;
    }
    if (tipo === 'SAIDA' && !localEstoqueOrigemId) {
      toast.error('Selecione o Local de Saída');
      return;
    }
    if (tipo === 'TRANSFERENCIA') {
      if (!localEstoqueOrigemId || !localEstoqueDestinoId) {
        toast.error('Selecione Origem e Destino');
        return;
      }
      if (localEstoqueOrigemId === localEstoqueDestinoId) {
        toast.error('Origem e destino devem ser diferentes');
        return;
      }
    }
    if (tipo === 'AJUSTE' && !motivoMovimentacao) {
      toast.error('Informe o motivo do ajuste');
      return;
    }
    if (exibeFornecedor && !fornecedorId) {
      toast.error('Selecione o Fornecedor');
      return;
    }
    if (exibeCliente && !clienteId) {
      toast.error('Selecione o Cliente');
      return;
    }
    if (exibeVinculo && (!tipoVinculo || !vinculoId)) {
      toast.error('Selecione o vínculo');
      return;
    }
    if (exibeMotivo && !motivoMovimentacao && tipo === 'SAIDA') {
      toast.error('Informe o motivo');
      return;
    }

    const fornecedor = fornecedores.find(f => f.id === fornecedorId);
    const cliente = fornecedores.find(f => f.id === clienteId);
    const localOrigem = locais.find(l => l.id === localEstoqueOrigemId);
    const localDestino = locais.find(l => l.id === localEstoqueDestinoId);
    const centro = centrosCusto.find(c => c.id === centroCustoId);

    let tipoMovimentacao = 'Entrada';
    if (tipo === 'SAIDA') tipoMovimentacao = 'Saída';
    if (tipo === 'TRANSFERENCIA') tipoMovimentacao = 'Transferência';
    if (tipo === 'AJUSTE') tipoMovimentacao = 'Ajuste';

    let vinculoData = {};
    if (exibeVinculo && tipoVinculo && vinculoId) {
      vinculoData.tipo_vinculo = tipoVinculo;
      if (tipoVinculo === 'lote') {
        const lote = lotes.find(l => l.id === vinculoId);
        vinculoData.lote_vinculado_id = vinculoId;
        vinculoData.lote_vinculado_nome = lote?.identificacao || lote?.nome;
      } else if (tipoVinculo === 'area') {
        const area = areas.find(a => a.id === vinculoId);
        vinculoData.area_vinculada_id = vinculoId;
        vinculoData.area_vinculada_nome = area?.nome;
      } else if (tipoVinculo === 'maquina') {
        const maq = maquinas.find(m => m.id === vinculoId);
        vinculoData.maquina_vinculada_id = vinculoId;
        vinculoData.maquina_vinculada_nome = maq?.nome || maq?.identificacao;
      }
    }

    const dadosMovimentacao = {
      empresa_id: empresaId,
      tipo_movimentacao: tipoMovimentacao,
      tipo_detalhado: operacao,
      data_movimentacao: new Date(dataMovimentacao).toISOString(),
      local_estoque_origem_id: localEstoqueOrigemId || undefined,
      local_estoque_origem_nome: localOrigem?.nome || undefined,
      local_estoque_destino_id: localEstoqueDestinoId || undefined,
      local_estoque_destino_nome: localDestino?.nome || undefined,
      centro_custo_id: centroCustoId,
      centro_custo_nome: centro?.nome,
      tipo_documento: tipoDocumento || undefined,
      numero_documento: numeroDocumento || undefined,
      serie_documento: serieDocumento || undefined,
      data_documento: dataDocumento || undefined,
      chave_documento: chaveDocumento || undefined,
      cfop: cfop || undefined,
      natureza_operacao: naturezaOperacao || undefined,
      fornecedor_id: fornecedorId || undefined,
      fornecedor_nome: fornecedor?.nome || undefined,
      cliente_id: clienteId || undefined,
      cliente_nome: cliente?.nome || undefined,
      motivo_movimentacao: motivoMovimentacao || undefined,
      observacoes: observacoes || undefined,
      status: 'Ativa',
      ...vinculoData,
      produtos: itens.map(item => ({
        produto_id: item.produto_id,
        produto_nome: item.produto_nome,
        produto_codigo: item.produto_codigo,
        unidade_medida: item.unidade,
        quantidade: item.quantidade,
        valor_unitario: item.preco_unitario,
        valor_total: item.liquido,
        desconto: item.desconto,
        observacao_item: item.observacao_item
      }))
    };

    onSubmit(dadosMovimentacao);
  };

  // ========== RENDER ==========
  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      
      {/* BLOCO 1 - CABEÇALHO */}
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="py-2 px-3 bg-slate-100 border-b">
          <CardTitle className="text-sm font-semibold">
            {initialData?.id ? 'Editar Movimentação' : 'Nova Movimentação de Estoque'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 space-y-2">
          
          {/* Linha 1: Tipo, Operação, Data */}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Tipo *</Label>
              <Select value={tipo} onValueChange={handleTipoChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ENTRADA" className="text-xs">ENTRADA</SelectItem>
                  <SelectItem value="SAIDA" className="text-xs">SAÍDA</SelectItem>
                  <SelectItem value="TRANSFERENCIA" className="text-xs">TRANSFERÊNCIA</SelectItem>
                  <SelectItem value="AJUSTE" className="text-xs">AJUSTE</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Operação *</Label>
              <Select value={operacao} onValueChange={handleOperacaoChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {operacoesDisponiveis.map(op => (
                    <SelectItem key={op.value} value={op.value} className="text-xs">{op.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Data *</Label>
              <Input 
                type="date" 
                value={dataMovimentacao} 
                onChange={(e) => setDataMovimentacao(e.target.value)}
                className="h-8 text-xs w-[150px]"
              />
            </div>
          </div>

          {/* Linha 2: Centro de Custo, Local(is) */}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Centro de Custo *</Label>
              <Select value={centroCustoId} onValueChange={setCentroCustoId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {centrosCusto.map(c => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Local Origem */}
            {(tipo === 'SAIDA' || tipo === 'TRANSFERENCIA' || (tipo === 'AJUSTE' && !operacao?.includes('positivo'))) && (
              <div className="space-y-1">
                <Label className="text-xs">
                  {tipo === 'TRANSFERENCIA' ? 'Local Origem *' : tipo === 'AJUSTE' ? 'Local Ajuste *' : 'Local Saída *'}
                </Label>
                <Select value={localEstoqueOrigemId} onValueChange={(v) => { setLocalEstoqueOrigemId(v); setItens([]); resetCurrentItem(); }}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {locais.map(l => (
                      <SelectItem key={l.id} value={l.id} className="text-xs">{l.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Local Destino */}
            {(tipo === 'ENTRADA' || tipo === 'TRANSFERENCIA' || (tipo === 'AJUSTE' && operacao?.includes('positivo'))) && (
              <div className="space-y-1">
                <Label className="text-xs">
                  {tipo === 'TRANSFERENCIA' ? 'Local Destino *' : tipo === 'AJUSTE' ? 'Local Ajuste *' : 'Local Entrada *'}
                </Label>
                <Select value={localEstoqueDestinoId} onValueChange={(v) => { setLocalEstoqueDestinoId(v); if (tipo === 'ENTRADA') { setItens([]); resetCurrentItem(); } }}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {locais.map(l => (
                      <SelectItem key={l.id} value={l.id} className="text-xs">{l.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Fornecedor */}
            {exibeFornecedor && (
              <div className="space-y-1">
                <Label className="text-xs">Fornecedor *</Label>
                <Select value={fornecedorId} onValueChange={setFornecedorId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {fornecedores.map(f => (
                      <SelectItem key={f.id} value={f.id} className="text-xs">{f.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Cliente */}
            {exibeCliente && (
              <div className="space-y-1">
                <Label className="text-xs">Cliente *</Label>
                <Select value={clienteId} onValueChange={setClienteId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {clientes.map(c => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">{c.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* BLOCO DOCUMENTO */}
          {exibeDocumento && (
            <div className="bg-slate-50 border rounded p-2 space-y-2">
              <Label className="text-xs font-semibold">Dados do Documento</Label>
              <div className="grid grid-cols-6 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Tipo</Label>
                  <Select value={tipoDocumento} onValueChange={setTipoDocumento}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPOS_DOCUMENTO.map(t => (
                        <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Número</Label>
                  <Input value={numeroDocumento} onChange={(e) => setNumeroDocumento(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Série</Label>
                  <Input value={serieDocumento} onChange={(e) => setSerieDocumento(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Data</Label>
                  <Input type="date" value={dataDocumento} onChange={(e) => setDataDocumento(e.target.value)} className="h-8 text-xs w-[130px]" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">CFOP</Label>
                  <Input value={cfop} onChange={(e) => setCfop(e.target.value)} className="h-8 text-xs" maxLength={4} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Natureza</Label>
                  <Input value={naturezaOperacao} onChange={(e) => setNaturezaOperacao(e.target.value)} className="h-8 text-xs" />
                </div>
              </div>
              {tipoDocumento === 'nfe' && (
                <div className="space-y-1">
                  <Label className="text-xs">Chave NF-e</Label>
                  <Input value={chaveDocumento} onChange={(e) => setChaveDocumento(e.target.value)} className="h-8 text-xs" maxLength={44} />
                </div>
              )}
            </div>
          )}

          {/* VÍNCULO */}
          {exibeVinculo && (
            <div className="bg-blue-50 border border-blue-200 rounded p-2">
              <Label className="text-xs font-semibold">Vínculo da Saída</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div className="space-y-1">
                  <Label className="text-xs">Tipo *</Label>
                  <Select value={tipoVinculo} onValueChange={(v) => { setTipoVinculo(v); setVinculoId(''); }}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPOS_VINCULO.map(t => (
                        <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Vínculo *</Label>
                  {tipoVinculo === 'lote' ? (
                    <Select value={vinculoId} onValueChange={setVinculoId}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {lotes.map(l => (<SelectItem key={l.id} value={l.id} className="text-xs">{l.identificacao || l.nome}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  ) : tipoVinculo === 'area' ? (
                    <Select value={vinculoId} onValueChange={setVinculoId}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {areas.map(a => (<SelectItem key={a.id} value={a.id} className="text-xs">{a.nome}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  ) : tipoVinculo === 'maquina' ? (
                    <Select value={vinculoId} onValueChange={setVinculoId}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {maquinas.map(m => (<SelectItem key={m.id} value={m.id} className="text-xs">{m.nome || m.identificacao}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  ) : tipoVinculo === 'funcionario' ? (
                    <Select value={vinculoId} onValueChange={setVinculoId}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {fornecedores.filter(f => f.tipos?.includes('Funcionario')).map(f => (<SelectItem key={f.id} value={f.id} className="text-xs">{f.nome}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input className="h-8 text-xs" disabled placeholder="Selecione o tipo" />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* MOTIVO */}
          {exibeMotivo && (
            <div className="bg-amber-50 border border-amber-200 rounded p-2">
              <Label className="text-xs font-semibold">{tipo === 'AJUSTE' ? 'Motivo do Ajuste *' : 'Motivo *'}</Label>
              {tipo === 'SAIDA' && (operacao === 'perda' || operacao === 'quebra') ? (
                <Select value={motivoMovimentacao} onValueChange={setMotivoMovimentacao}>
                  <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {MOTIVOS_PERDA.map(m => (<SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={motivoMovimentacao} onChange={(e) => setMotivoMovimentacao(e.target.value)} className="h-8 text-xs mt-1" placeholder="Descreva o motivo" />
              )}
            </div>
          )}

          {/* OBSERVAÇÕES */}
          <div className="space-y-1">
            <Label className="text-xs">Observações</Label>
            <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} className="text-xs min-h-[40px]" rows={1} />
          </div>
        </CardContent>
      </Card>

      {/* BLOCO LANÇAR PRODUTO */}
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="py-2 px-3 bg-slate-100 border-b">
          <CardTitle className="text-sm font-semibold">Lançar Produto</CardTitle>
        </CardHeader>
        <CardContent className="p-3 space-y-2">
          
          {/* Aviso local */}
          {((tipo === 'SAIDA' || tipo === 'TRANSFERENCIA') && !localEstoqueOrigemId) && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              Selecione o Local de {tipo === 'TRANSFERENCIA' ? 'Origem' : 'Saída'} para ver os produtos disponíveis.
            </p>
          )}

          {/* Linha 1: Produto, Quantidade, Unidade */}
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-6 space-y-1">
              <Label className="text-xs">Produto *</Label>
              <Select value={currentItem.produto_id} onValueChange={handleProdutoChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione o produto" />
                </SelectTrigger>
                <SelectContent>
                  {produtosFiltrados.map(p => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.nome_produto} {p.codigo_interno ? `(${p.codigo_interno})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Saldo */}
              {(tipo === 'SAIDA' || tipo === 'TRANSFERENCIA') && currentItem.produto_id && saldoProdutoNoLocal !== null && (
                <p className="text-xs text-slate-600">Saldo disponível: {saldoProdutoNoLocal.toFixed(2)} {currentItem.unidade}</p>
              )}
            </div>
            <div className="col-span-3 space-y-1">
              <Label className="text-xs">Quantidade *</Label>
              <Input 
                type="number" 
                step="0.01"
                value={currentItem.quantidade} 
                onChange={(e) => handleQuantidadeChange(e.target.value)} 
                className="h-8 text-xs" 
              />
            </div>
            <div className="col-span-3 space-y-1">
              <Label className="text-xs">Unidade</Label>
              <Input value={currentItem.unidade} readOnly className="h-8 text-xs bg-slate-100" />
            </div>
          </div>

          {/* Linha 2: Preço, Total, Desconto, Líquido */}
          <div className="grid grid-cols-4 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Preço Unitário</Label>
              <Input 
                type="number" 
                step="0.01"
                value={currentItem.preco_unitario} 
                onChange={(e) => handlePrecoChange(e.target.value)} 
                className="h-8 text-xs" 
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Total</Label>
              <Input value={currentItem.total} readOnly className="h-8 text-xs bg-slate-100" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Desconto</Label>
              <Input 
                type="number" 
                step="0.01"
                value={currentItem.desconto} 
                onChange={(e) => handleDescontoChange(e.target.value)} 
                className="h-8 text-xs" 
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Líquido</Label>
              <Input value={currentItem.liquido} readOnly className="h-8 text-xs bg-slate-100 font-semibold" />
            </div>
          </div>

          {/* Linha 3: Observação do item */}
          <div className="space-y-1">
            <Label className="text-xs">Observação do Item</Label>
            <Input 
              value={currentItem.observacao_item} 
              onChange={(e) => setCurrentItem(prev => ({ ...prev, observacao_item: e.target.value }))} 
              className="h-8 text-xs" 
            />
          </div>

          {/* Erro de saldo */}
          {(tipo === 'SAIDA' || tipo === 'TRANSFERENCIA' || (tipo === 'AJUSTE' && operacao?.includes('negativo'))) && 
           currentItem.produto_id && 
           (parseFloat(currentItem.quantidade) || 0) > (saldoProdutoNoLocal || 0) && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
              Quantidade maior que o saldo disponível ({(saldoProdutoNoLocal || 0).toFixed(2)} {currentItem.unidade})
            </p>
          )}

          {/* Botões do item */}
          <div className="flex gap-2">
            <Button type="button" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={handleAdicionarItem}>
              {editingIndex !== null ? 'Atualizar Item' : 'Adicionar Item'}
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={resetCurrentItem}>
              Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* TABELA DE ITENS */}
      {itens.length > 0 && (
        <Card className="shadow-sm border-slate-300">
          <CardHeader className="py-2 px-3 bg-slate-100 border-b">
            <CardTitle className="text-sm font-semibold">Itens ({itens.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-bold py-1 border border-black">Produto</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Código</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">UN</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Preço</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Total</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Desc.</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Líquido</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black w-24">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itens.map((item, idx) => (
                  <TableRow key={idx} className="hover:bg-gray-50">
                    <TableCell className="text-xs py-1 border border-gray-300">{item.produto_nome}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">{item.produto_codigo || '-'}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">{item.unidade}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300 text-right">{item.quantidade}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300 text-right">{item.preco_unitario}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300 text-right">{item.total}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300 text-right">{item.desconto}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300 text-right font-semibold">{item.liquido}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">
                      <div className="flex gap-1">
                        <Button type="button" variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => handleEditarItem(idx)}>Editar</Button>
                        <Button type="button" variant="ghost" size="sm" className="h-6 text-xs px-2 text-red-600" onClick={() => handleRemoverItem(idx)}>Remover</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Totais */}
            <div className="bg-slate-100 p-2 border-t flex justify-end gap-4 text-xs">
              <span>Total: {totaisGerais.totalBruto.toFixed(2)}</span>
              <span>Descontos: {totaisGerais.totalDescontos.toFixed(2)}</span>
              <span className="font-semibold">Líquido: {totaisGerais.totalLiquido.toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* BOTÕES PRINCIPAIS */}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
          Cancelar
        </Button>
        <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
          {initialData?.id ? 'Atualizar' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}