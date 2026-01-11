import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import AutocompleteGenerico from "../financeiro/AutocompleteGenerico.jsx";

// ========== FORMATAÇÃO PT-BR ==========
const formatBR = (value) => {
  if (value === null || value === undefined || value === '') return '';
  const num = typeof value === 'string' ? parseFloat(String(value).replace(/\./g, '').replace(',', '.')) : value;
  if (isNaN(num)) return '';
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const parseBR = (str) => {
  if (!str && str !== 0) return 0;
  if (typeof str === 'number') return str;
  const cleaned = String(str).replace(/\./g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
};

// ========== OPERAÇÕES ==========
const OPERACOES_ENTRADA = [
  { value: 'compra', label: 'Compra', exigeFornecedor: true, exigeDocumento: true },
  { value: 'devolucao_cliente', label: 'Devolução de Cliente' },
  { value: 'doacao_recebida', label: 'Doação Recebida' },
  { value: 'bonificacao', label: 'Bonificação', exigeFornecedor: true },
  { value: 'producao', label: 'Produção' },
  { value: 'importacao', label: 'Importação', exigeFornecedor: true, exigeDocumento: true },
  { value: 'transferencia_recebida', label: 'Transferência Recebida' },
  { value: 'acerto_estoque', label: 'Acerto de Estoque' },
  { value: 'outros', label: 'Outros' }
];

const OPERACOES_SAIDA = [
  { value: 'venda', label: 'Venda', exigeCliente: true, exigeDocumento: true, precoEditavel: true },
  { value: 'devolucao_fornecedor', label: 'Devolução ao Fornecedor' },
  { value: 'doacao', label: 'Doação' },
  { value: 'perda', label: 'Perda', exigeMotivo: true },
  { value: 'quebra', label: 'Quebra', exigeMotivo: true },
  { value: 'consumo_interno', label: 'Consumo Interno', precoTravado: true },
  { value: 'producao', label: 'Produção' },
  { value: 'transferencia_enviada', label: 'Transferência Enviada' },
  { value: 'acerto_estoque', label: 'Acerto de Estoque' },
  { value: 'suplementacao', label: 'Suplementação', precoTravado: true },
  { value: 'aplicacao_area', label: 'Aplicação em Área', precoTravado: true },
  { value: 'manutencao_maquina', label: 'Manutenção de Máquina', precoTravado: true },
  { value: 'outros', label: 'Outros' }
];

const OPERACOES_AJUSTE = [
  { value: 'ajuste_positivo', label: 'Ajuste Positivo' },
  { value: 'ajuste_negativo', label: 'Ajuste Negativo' },
  { value: 'inventario', label: 'Inventário' },
  { value: 'correcao', label: 'Correção' },
  { value: 'outros', label: 'Outros' }
];

const TIPOS_DOCUMENTO = [
  { value: 'nota_fiscal', label: 'Nota Fiscal' },
  { value: 'nfe', label: 'NF-e' },
  { value: 'nfce', label: 'NFC-e' },
  { value: 'recibo', label: 'Recibo' },
  { value: 'outros', label: 'Outros' }
];

const MOTIVOS_PERDA = ['Vencimento', 'Quebra física', 'Roubo', 'Contaminação', 'Erro operacional', 'Deterioração', 'Sinistro', 'Outro'];

export default function MovimentacaoEstoqueFormV2({ 
  onSubmit, 
  onCancel, 
  initialData = null, 
  produtos = [], 
  fornecedores = [] 
}) {
  const empresaId = localStorage.getItem('empresa_selecionada_id');

  // ========== CABEÇALHO ==========
  const [tipo, setTipo] = useState(
    initialData?.tipo_movimentacao === 'Saída' ? 'SAIDA' : 
    initialData?.tipo_movimentacao === 'Ajuste' ? 'AJUSTE' : 'ENTRADA'
  );
  const [operacao, setOperacao] = useState(initialData?.tipo_detalhado || '');
  const [dataMovimentacao, setDataMovimentacao] = useState(
    initialData?.data_movimentacao?.split('T')[0] || new Date().toISOString().slice(0, 10)
  );
  
  const [localEstoqueOrigemId, setLocalEstoqueOrigemId] = useState(initialData?.local_estoque_origem_id || '');
  const [localEstoqueDestinoId, setLocalEstoqueDestinoId] = useState(initialData?.local_estoque_destino_id || '');
  const [centroCustoId, setCentroCustoId] = useState(initialData?.centro_custo_id || '');
  
  // Documento
  const [tipoDocumento, setTipoDocumento] = useState(initialData?.tipo_documento || '');
  const [numeroDocumento, setNumeroDocumento] = useState(initialData?.numero_documento || '');
  const [serieDocumento, setSerieDocumento] = useState(initialData?.serie_documento || '');
  const [dataDocumento, setDataDocumento] = useState(initialData?.data_documento || '');
  const [chaveDocumento, setChaveDocumento] = useState(initialData?.chave_documento || '');
  const [cfop, setCfop] = useState(initialData?.cfop || '');
  const [naturezaOperacao, setNaturezaOperacao] = useState(initialData?.natureza_operacao || '');
  
  // Parceiros
  const [fornecedorId, setFornecedorId] = useState(initialData?.fornecedor_id || '');
  const [clienteId, setClienteId] = useState(initialData?.cliente_id || '');
  
  // Motivo/Obs
  const [motivoMovimentacao, setMotivoMovimentacao] = useState(initialData?.motivo_movimentacao || '');
  const [observacoes, setObservacoes] = useState(initialData?.observacoes || '');

  // ========== ITENS ==========
  const [itens, setItens] = useState([]);
  const [currentItem, setCurrentItem] = useState({
    produto_id: '',
    produto_nome: '',
    produto_codigo: '',
    unidade: '',
    quantidade: '',
    preco_unitario: '',
    desconto: '',
    total: '',
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
    if (tipo === 'AJUSTE') return OPERACOES_AJUSTE;
    return [];
  }, [tipo]);

  const operacaoSelecionada = useMemo(() => {
    return operacoesDisponiveis.find(op => op.value === operacao);
  }, [operacoesDisponiveis, operacao]);

  // Flags de exibição
  const exibeFornecedor = tipo === 'ENTRADA' && operacaoSelecionada?.exigeFornecedor;
  const exibeCliente = tipo === 'SAIDA' && operacaoSelecionada?.exigeCliente;
  const exibeDocumento = (tipo === 'ENTRADA' || tipo === 'SAIDA') && operacaoSelecionada?.exigeDocumento;
  const exibeMotivo = (tipo === 'SAIDA' && operacaoSelecionada?.exigeMotivo) || tipo === 'AJUSTE';
  const precoTravado = tipo === 'SAIDA' && operacaoSelecionada?.precoTravado;

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
      } else if (mov.tipo_movimentacao === 'Saída' && origemId) {
        if (!estoques[mov.produto_id][origemId]) estoques[mov.produto_id][origemId] = 0;
        estoques[mov.produto_id][origemId] -= qtd;
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
    if (tipo === 'SAIDA') return localEstoqueOrigemId;
    if (tipo === 'AJUSTE') return operacao?.includes('positivo') ? localEstoqueDestinoId : localEstoqueOrigemId;
    return '';
  }, [tipo, operacao, localEstoqueOrigemId, localEstoqueDestinoId]);

  const saldoProdutoNoLocal = useMemo(() => {
    if (!currentItem.produto_id || !localOrigemAtual) return null;
    return estoquePorLocal[currentItem.produto_id]?.[localOrigemAtual] || 0;
  }, [currentItem.produto_id, localOrigemAtual, estoquePorLocal]);

  // Produtos filtrados (Saída/Ajuste negativo: só com saldo > 0)
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

  // Totais
  const totaisGerais = useMemo(() => {
    return itens.reduce((acc, item) => ({
      totalBruto: acc.totalBruto + (item.total || 0),
      totalDescontos: acc.totalDescontos + (item.desconto || 0),
      totalLiquido: acc.totalLiquido + (item.liquido || 0)
    }), { totalBruto: 0, totalDescontos: 0, totalLiquido: 0 });
  }, [itens]);

  // ========== HANDLERS ==========
  const handleTipoChange = (novoTipo) => {
    setTipo(novoTipo);
    setOperacao('');
    setFornecedorId('');
    setClienteId('');
    setMotivoMovimentacao('');
    setTipoDocumento('');
    setNumeroDocumento('');
    setSerieDocumento('');
    setDataDocumento('');
    setChaveDocumento('');
    setCfop('');
    setNaturezaOperacao('');
    if (novoTipo === 'ENTRADA') setLocalEstoqueOrigemId('');
    else if (novoTipo === 'SAIDA') setLocalEstoqueDestinoId('');
  };

  const handleOperacaoChange = (novaOperacao) => {
    setOperacao(novaOperacao);
  };

  const resetCurrentItem = () => {
    setCurrentItem({
      produto_id: '',
      produto_nome: '',
      produto_codigo: '',
      unidade: '',
      quantidade: '',
      preco_unitario: '',
      desconto: '',
      total: '',
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
      if (precoTravado) {
        precoInicial = prod.preco_custo || 0;
      } else {
        precoInicial = prod.preco_venda || prod.preco_custo || 0;
      }
    } else if (tipo === 'AJUSTE') {
      precoInicial = 0;
    }

    setCurrentItem(prev => ({
      ...prev,
      produto_id: produtoId,
      produto_nome: prod.nome_produto,
      produto_codigo: prod.codigo_interno || prod.codigo_barras || '',
      unidade: prod.unidade_medida || 'UN',
      preco_unitario: formatBR(precoInicial),
      quantidade: '',
      desconto: '',
      total: '',
      liquido: ''
    }));
  };

  const recalcular = (qtdStr, precoStr, descStr) => {
    const qtd = parseBR(qtdStr) || 0;
    const preco = parseBR(precoStr) || 0;
    const desc = parseBR(descStr) || 0;
    const total = qtd * preco;
    const liquido = Math.max(0, total - desc);
    return { total, liquido };
  };

  const handleQuantidadeChange = (e) => {
    const val = e.target.value;
    setCurrentItem(prev => {
      const { total, liquido } = recalcular(val, prev.preco_unitario, prev.desconto);
      return { ...prev, quantidade: val, total: formatBR(total), liquido: formatBR(liquido) };
    });
  };

  const handleQuantidadeBlur = () => {
    setCurrentItem(prev => ({ ...prev, quantidade: formatBR(parseBR(prev.quantidade)) }));
  };

  const handlePrecoChange = (e) => {
    const val = e.target.value;
    setCurrentItem(prev => {
      const { total, liquido } = recalcular(prev.quantidade, val, prev.desconto);
      return { ...prev, preco_unitario: val, total: formatBR(total), liquido: formatBR(liquido) };
    });
  };

  const handlePrecoBlur = () => {
    setCurrentItem(prev => ({ ...prev, preco_unitario: formatBR(parseBR(prev.preco_unitario)) }));
  };

  const handleDescontoChange = (e) => {
    const val = e.target.value;
    setCurrentItem(prev => {
      const { total, liquido } = recalcular(prev.quantidade, prev.preco_unitario, val);
      return { ...prev, desconto: val, liquido: formatBR(liquido) };
    });
  };

  const handleDescontoBlur = () => {
    setCurrentItem(prev => ({ ...prev, desconto: formatBR(parseBR(prev.desconto)) }));
  };

  const handleAdicionarItem = () => {
    if (!currentItem.produto_id) {
      toast.error('Selecione um produto');
      return;
    }

    const qtd = parseBR(currentItem.quantidade);
    if (qtd <= 0) {
      toast.error('Informe uma quantidade válida');
      return;
    }

    const precisaValidarSaldo = tipo === 'SAIDA' || (tipo === 'AJUSTE' && !operacao?.includes('positivo'));
    if (precisaValidarSaldo && saldoProdutoNoLocal !== null && qtd > saldoProdutoNoLocal) {
      toast.error(`Quantidade maior que o saldo disponível (${formatBR(saldoProdutoNoLocal)})`);
      return;
    }

    const { total, liquido } = recalcular(currentItem.quantidade, currentItem.preco_unitario, currentItem.desconto);

    const novoItem = {
      produto_id: currentItem.produto_id,
      produto_nome: currentItem.produto_nome,
      produto_codigo: currentItem.produto_codigo,
      unidade: currentItem.unidade,
      quantidade: qtd,
      preco_unitario: parseBR(currentItem.preco_unitario),
      desconto: parseBR(currentItem.desconto),
      total: total,
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
      quantidade: formatBR(item.quantidade),
      preco_unitario: formatBR(item.preco_unitario),
      desconto: formatBR(item.desconto),
      total: formatBR(item.total),
      liquido: formatBR(item.liquido),
      observacao_item: item.observacao_item || ''
    });
    setEditingIndex(index);
  };

  const handleRemoverItem = (index) => {
    setItens(prev => prev.filter((_, idx) => idx !== index));
    if (editingIndex === index) resetCurrentItem();
  };

  // ========== SUBMIT ==========
  const handleSubmit = (e) => {
    e.preventDefault();

    if (!operacao) { toast.error('Selecione a operação'); return; }
    if (!centroCustoId) { toast.error('Selecione o Centro de Custo'); return; }
    if (itens.length === 0) { toast.error('Adicione pelo menos um item'); return; }

    if (tipo === 'ENTRADA' && !localEstoqueDestinoId) { toast.error('Selecione o Local de Entrada'); return; }
    if (tipo === 'SAIDA' && !localEstoqueOrigemId) { toast.error('Selecione o Local de Saída'); return; }
    if (tipo === 'AJUSTE' && !localEstoqueOrigemId && !localEstoqueDestinoId) { toast.error('Selecione o Local do Ajuste'); return; }
    if (tipo === 'AJUSTE' && !motivoMovimentacao) { toast.error('Informe o motivo do ajuste'); return; }
    if (exibeFornecedor && !fornecedorId) { toast.error('Selecione o Fornecedor'); return; }
    if (exibeCliente && !clienteId) { toast.error('Selecione o Cliente'); return; }
    if (exibeMotivo && tipo === 'SAIDA' && !motivoMovimentacao) { toast.error('Informe o motivo'); return; }

    const fornecedor = fornecedores.find(f => f.id === fornecedorId);
    const cliente = fornecedores.find(f => f.id === clienteId);
    const localOrigem = locais.find(l => l.id === localEstoqueOrigemId);
    const localDestino = locais.find(l => l.id === localEstoqueDestinoId);
    const centro = centrosCusto.find(c => c.id === centroCustoId);

    let tipoMovimentacao = 'Entrada';
    if (tipo === 'SAIDA') tipoMovimentacao = 'Saída';
    if (tipo === 'AJUSTE') tipoMovimentacao = 'Ajuste';

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
    <form onSubmit={handleSubmit} className="space-y-2">
      
      {/* CABEÇALHO */}
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="py-2 px-3 bg-slate-50 border-b border-slate-200">
          <CardTitle className="text-sm font-semibold text-slate-900">
            {initialData?.id ? 'Editar Movimentação' : 'Nova Movimentação de Estoque'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 space-y-2">
          
          {/* Linha 1 */}
          <div className="grid grid-cols-6 gap-2">
            <div className="col-span-1">
              <Label className="text-xs">Tipo *</Label>
              <Select value={tipo} onValueChange={handleTipoChange}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ENTRADA" className="text-xs">ENTRADA</SelectItem>
                  <SelectItem value="SAIDA" className="text-xs">SAÍDA</SelectItem>
                  <SelectItem value="AJUSTE" className="text-xs">AJUSTE</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Operação *</Label>
              <Select value={operacao} onValueChange={handleOperacaoChange}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {operacoesDisponiveis.map(op => (
                    <SelectItem key={op.value} value={op.value} className="text-xs">{op.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-1">
              <Label className="text-xs">Data *</Label>
              <Input type="date" value={dataMovimentacao} onChange={(e) => setDataMovimentacao(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Centro de Custo *</Label>
              <AutocompleteGenerico
                items={centrosCusto}
                value={centroCustoId}
                onChange={setCentroCustoId}
                placeholder="Buscar centro de custo..."
                displayField="nome"
                searchFields={["nome", "codigo"]}
              />
            </div>
          </div>

          {/* Linha 2: Locais */}
          <div className="grid grid-cols-6 gap-2">
            {(tipo === 'SAIDA' || (tipo === 'AJUSTE' && !operacao?.includes('positivo'))) && (
              <div className="col-span-2">
                <Label className="text-xs">{tipo === 'AJUSTE' ? 'Local do Ajuste *' : 'Local de Saída *'}</Label>
                <Select value={localEstoqueOrigemId} onValueChange={(v) => { setLocalEstoqueOrigemId(v); setItens([]); resetCurrentItem(); }}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {locais.map(l => (<SelectItem key={l.id} value={l.id} className="text-xs">{l.nome}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {(tipo === 'ENTRADA' || (tipo === 'AJUSTE' && operacao?.includes('positivo'))) && (
              <div className="col-span-2">
                <Label className="text-xs">{tipo === 'AJUSTE' ? 'Local do Ajuste *' : 'Local de Entrada *'}</Label>
                <Select value={localEstoqueDestinoId} onValueChange={(v) => { setLocalEstoqueDestinoId(v); setItens([]); resetCurrentItem(); }}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {locais.map(l => (<SelectItem key={l.id} value={l.id} className="text-xs">{l.nome}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {exibeFornecedor && (
              <div className="col-span-2">
                <Label className="text-xs">Fornecedor *</Label>
                <AutocompleteGenerico
                  items={fornecedores}
                  value={fornecedorId}
                  onChange={setFornecedorId}
                  placeholder="Buscar por nome, CPF ou CNPJ..."
                  displayField="nome"
                  searchFields={["nome", "cpf", "cnpj", "razao_social"]}
                  renderSubtext={(item) => item.cpf || item.cnpj || ''}
                />
              </div>
            )}
            {exibeCliente && (
              <div className="col-span-2">
                <Label className="text-xs">Cliente *</Label>
                <AutocompleteGenerico
                  items={clientes}
                  value={clienteId}
                  onChange={setClienteId}
                  placeholder="Buscar por nome, CPF ou CNPJ..."
                  displayField="nome"
                  searchFields={["nome", "cpf", "cnpj", "razao_social"]}
                  renderSubtext={(item) => item.cpf || item.cnpj || ''}
                />
              </div>
            )}
          </div>

          {/* Documento (apenas Entrada+Compra/Importação ou Saída+Venda) */}
          {exibeDocumento && (
            <div className="border rounded p-2 bg-slate-50 space-y-2">
              <Label className="text-xs font-semibold">Documento / NF-e</Label>
              <div className="grid grid-cols-6 gap-2">
                <div className="col-span-1">
                  <Label className="text-xs">Tipo</Label>
                  <Select value={tipoDocumento} onValueChange={setTipoDocumento}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {TIPOS_DOCUMENTO.map(t => (<SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-1">
                  <Label className="text-xs">Número</Label>
                  <Input value={numeroDocumento} onChange={(e) => setNumeroDocumento(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="col-span-1">
                  <Label className="text-xs">Série</Label>
                  <Input value={serieDocumento} onChange={(e) => setSerieDocumento(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="col-span-1">
                  <Label className="text-xs">Data Doc.</Label>
                  <Input type="date" value={dataDocumento} onChange={(e) => setDataDocumento(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="col-span-1">
                  <Label className="text-xs">CFOP</Label>
                  <Input value={cfop} onChange={(e) => setCfop(e.target.value)} className="h-8 text-xs" maxLength={4} />
                </div>
                <div className="col-span-1">
                  <Label className="text-xs">Natureza Op.</Label>
                  <Input value={naturezaOperacao} onChange={(e) => setNaturezaOperacao(e.target.value)} className="h-8 text-xs" />
                </div>
              </div>
              {tipoDocumento === 'nfe' && (
                <div>
                  <Label className="text-xs">Chave NF-e (44 dígitos)</Label>
                  <Input value={chaveDocumento} onChange={(e) => setChaveDocumento(e.target.value)} className="h-8 text-xs" maxLength={44} />
                </div>
              )}
            </div>
          )}

          {/* Motivo (Perda/Quebra ou Ajuste) */}
          {exibeMotivo && (
            <div className="border rounded p-2 bg-amber-50 border-amber-200">
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

          {/* Observações */}
          <div>
            <Label className="text-xs">Observações</Label>
            <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} className="text-xs min-h-[36px]" rows={1} />
          </div>
        </CardContent>
      </Card>

      {/* LANÇAR PRODUTO */}
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="py-2 px-3 bg-slate-50 border-b border-slate-200">
          <CardTitle className="text-sm font-semibold text-slate-900">Lançar Produto</CardTitle>
        </CardHeader>
        <CardContent className="p-3 space-y-2">
          
          {/* Aviso */}
          {tipo === 'SAIDA' && !localEstoqueOrigemId && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              Selecione o Local de Saída para ver os produtos disponíveis.
            </p>
          )}

          {/* Linha 1: Produto, Qtd, UN */}
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-6">
              <Label className="text-xs">Produto *</Label>
              <AutocompleteGenerico
                items={produtosFiltrados}
                value={currentItem.produto_id}
                onChange={handleProdutoChange}
                placeholder="Buscar por nome, código interno ou código de barras..."
                displayField="nome_produto"
                searchFields={["nome_produto", "codigo_interno", "codigo_barras"]}
                renderSubtext={(item) => `Cód: ${item.codigo_interno || item.codigo_barras || '-'} | UN: ${item.unidade_medida || 'UN'}${item.saldo_local !== undefined ? ` | Saldo: ${formatBR(item.saldo_local)}` : ''}`}
              />
              {/* Saldo */}
              {(tipo === 'SAIDA' || (tipo === 'AJUSTE' && !operacao?.includes('positivo'))) && currentItem.produto_id && saldoProdutoNoLocal !== null && (
                <p className="text-xs text-slate-600 mt-1">Saldo disponível: {formatBR(saldoProdutoNoLocal)} {currentItem.unidade}</p>
              )}
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Código</Label>
              <Input value={currentItem.produto_codigo} readOnly className="h-8 text-xs bg-slate-100" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Quantidade *</Label>
              <Input value={currentItem.quantidade} onChange={handleQuantidadeChange} onBlur={handleQuantidadeBlur} className="h-8 text-xs text-right" placeholder="0,00" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">UN</Label>
              <Input value={currentItem.unidade} readOnly className="h-8 text-xs bg-slate-100" />
            </div>
          </div>

          {/* Linha 2: Preço, Total, Desconto, Líquido */}
          <div className="grid grid-cols-4 gap-2">
            <div>
              <Label className="text-xs">Preço Unitário</Label>
              <Input 
                value={currentItem.preco_unitario} 
                onChange={handlePrecoChange} 
                onBlur={handlePrecoBlur}
                className="h-8 text-xs text-right" 
                placeholder="0,00"
                readOnly={precoTravado}
              />
            </div>
            <div>
              <Label className="text-xs">Total</Label>
              <Input value={currentItem.total} readOnly className="h-8 text-xs text-right bg-slate-100" />
            </div>
            <div>
              <Label className="text-xs">Desconto</Label>
              <Input value={currentItem.desconto} onChange={handleDescontoChange} onBlur={handleDescontoBlur} className="h-8 text-xs text-right" placeholder="0,00" />
            </div>
            <div>
              <Label className="text-xs">Líquido</Label>
              <Input value={currentItem.liquido} readOnly className="h-8 text-xs text-right bg-slate-100 font-semibold" />
            </div>
          </div>

          {/* Linha 3: Observação */}
          <div>
            <Label className="text-xs">Observação do Item</Label>
            <Input value={currentItem.observacao_item} onChange={(e) => setCurrentItem(prev => ({ ...prev, observacao_item: e.target.value }))} className="h-8 text-xs" />
          </div>

          {/* Erro saldo */}
          {(tipo === 'SAIDA' || (tipo === 'AJUSTE' && !operacao?.includes('positivo'))) && 
           currentItem.produto_id && 
           parseBR(currentItem.quantidade) > (saldoProdutoNoLocal || 0) && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
              Quantidade maior que o saldo disponível ({formatBR(saldoProdutoNoLocal || 0)} {currentItem.unidade})
            </p>
          )}

          {/* Botões */}
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

      {/* TABELA DE ITENS (mesmo estilo da TabelaMovimentacoes) */}
      {itens.length > 0 && (
        <Card className="shadow-sm border-slate-300">
          <CardHeader className="bg-white border-b border-slate-200 py-2 px-3">
            <CardTitle className="text-sm font-semibold text-slate-900">Itens Lançados ({itens.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 border-b">
                    <TableHead className="text-xs font-bold py-1 border-r border-slate-200">Produto</TableHead>
                    <TableHead className="text-xs font-bold py-1 border-r border-slate-200">Código</TableHead>
                    <TableHead className="text-xs font-bold py-1 border-r border-slate-200">UN</TableHead>
                    <TableHead className="text-xs font-bold py-1 border-r border-slate-200 text-right">Qtd</TableHead>
                    <TableHead className="text-xs font-bold py-1 border-r border-slate-200 text-right">Preço Unit.</TableHead>
                    <TableHead className="text-xs font-bold py-1 border-r border-slate-200 text-right">Total</TableHead>
                    <TableHead className="text-xs font-bold py-1 border-r border-slate-200 text-right">Desconto</TableHead>
                    <TableHead className="text-xs font-bold py-1 border-r border-slate-200 text-right">Líquido</TableHead>
                    <TableHead className="text-xs font-bold py-1 border-r border-slate-200 w-28">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itens.map((item, idx) => (
                    <TableRow key={idx} className="hover:bg-slate-50 transition-colors border-b">
                      <TableCell className="text-xs py-1 border-r border-slate-200 font-semibold">{item.produto_nome}</TableCell>
                      <TableCell className="text-xs py-1 border-r border-slate-200 font-mono">{item.produto_codigo || '-'}</TableCell>
                      <TableCell className="text-xs py-1 border-r border-slate-200">{item.unidade}</TableCell>
                      <TableCell className="text-xs py-1 border-r border-slate-200 text-right font-mono font-semibold text-emerald-700">{formatBR(item.quantidade)}</TableCell>
                      <TableCell className="text-xs py-1 border-r border-slate-200 text-right font-mono">{formatBR(item.preco_unitario)}</TableCell>
                      <TableCell className="text-xs py-1 border-r border-slate-200 text-right font-mono">{formatBR(item.total)}</TableCell>
                      <TableCell className="text-xs py-1 border-r border-slate-200 text-right font-mono">{formatBR(item.desconto)}</TableCell>
                      <TableCell className="text-xs py-1 border-r border-slate-200 text-right font-mono font-semibold text-emerald-700">{formatBR(item.liquido)}</TableCell>
                      <TableCell className="text-xs py-1 border-r border-slate-200">
                        <div className="flex gap-1">
                          <Button type="button" variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => handleEditarItem(idx)}>Editar</Button>
                          <Button type="button" variant="ghost" size="sm" className="h-6 text-xs px-2 text-red-600" onClick={() => handleRemoverItem(idx)}>Remover</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Totais */}
            <div className="bg-slate-100 p-2 border-t border-slate-200 flex justify-end gap-6 text-xs">
              <span>Total: <span className="font-mono font-semibold">{formatBR(totaisGerais.totalBruto)}</span></span>
              <span>Descontos: <span className="font-mono font-semibold text-red-600">-{formatBR(totaisGerais.totalDescontos)}</span></span>
              <span>Líquido: <span className="font-mono font-bold text-emerald-700">{formatBR(totaisGerais.totalLiquido)}</span></span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* BOTÕES PRINCIPAIS */}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">Cancelar</Button>
        <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">{initialData?.id ? 'Atualizar' : 'Salvar'}</Button>
      </div>
    </form>
  );
}