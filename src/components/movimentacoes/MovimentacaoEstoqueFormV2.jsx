import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { 
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { 
  ArrowDownCircle, ArrowUpCircle, Plus, Trash2, MoreVertical, Pencil, 
  Package, Save, X, FileText, AlertTriangle 
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import AutocompleteGenerico from "../financeiro/AutocompleteGenerico.jsx";
import DialogCadastroRapido from "../financeiro/DialogCadastroRapido.jsx";
import SeletorLoteNota from "./SeletorLoteNota.jsx";

import {
  formatarMoedaBR,
  parseMoedaBR,
  formatarNumero,
  parseNumeroBR,
  calcularTotaisItem,
  distribuirSaidaPorLotes,
  calcularSaldoProdutoLocal,
  OPERACOES_POR_TIPO,
  TIPOS_VINCULO,
  TIPOS_DOCUMENTO
} from "./utils/movimentacaoUtils.js";

export default function MovimentacaoEstoqueFormV2({ 
  onSubmit, 
  onCancel, 
  initialData = null, 
  produtos = [], 
  fornecedores = [] 
}) {
  const empresaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  // ========== ESTADO DO CABEÇALHO ==========
  const [tipo, setTipo] = useState(initialData?.tipo_movimentacao === 'Saída' ? 'SAIDA' : 'ENTRADA');
  const [operacao, setOperacao] = useState(initialData?.tipo_detalhado || '');
  const [dataMovimentacao, setDataMovimentacao] = useState(
    initialData?.data_movimentacao?.split('T')[0] || new Date().toISOString().slice(0, 10)
  );
  const [localEstoqueId, setLocalEstoqueId] = useState(
    initialData?.local_estoque_destino_id || initialData?.local_estoque_origem_id || ''
  );
  
  // Documento
  const [tipoDocumento, setTipoDocumento] = useState(initialData?.tipo_documento || '');
  const [numeroDocumento, setNumeroDocumento] = useState(initialData?.numero_documento || '');
  const [serieDocumento, setSerieDocumento] = useState(initialData?.serie_documento || '');
  const [dataDocumento, setDataDocumento] = useState(initialData?.data_documento || '');
  const [chaveDocumento, setChaveDocumento] = useState(initialData?.chave_documento || '');
  
  // Parceiro
  const [fornecedorId, setFornecedorId] = useState(initialData?.fornecedor_id || '');
  const [destinoTexto, setDestinoTexto] = useState(initialData?.cliente_nome || initialData?.destino_responsavel || '');
  const [tipoVinculo, setTipoVinculo] = useState(initialData?.tipo_vinculo || '');
  const [vinculoId, setVinculoId] = useState(
    initialData?.lote_vinculado_id || initialData?.area_vinculada_id || 
    initialData?.maquina_vinculada_id || initialData?.centro_custo_id || ''
  );
  
  const [observacoes, setObservacoes] = useState(initialData?.observacoes || '');

  // ========== ESTADO DOS ITENS ==========
  const [itens, setItens] = useState([]);
  const [modoEntrada, setModoEntrada] = useState('por_nota'); // 'por_nota' | 'rapida'
  const [modoCustoSaida, setModoCustoSaida] = useState('por_lote'); // 'por_lote' | 'fifo'
  
  // Item atual (formulário)
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
    lote_origem_id: '',
    lote_origem_info: null,
    observacao_item: ''
  });
  const [editingIndex, setEditingIndex] = useState(null);
  const [showSeletorLote, setShowSeletorLote] = useState(false);

  // Dialogs
  const [showDialogLocal, setShowDialogLocal] = useState(false);
  const [showDialogFornecedor, setShowDialogFornecedor] = useState(false);

  // ========== QUERIES ==========
  const { data: locais = [] } = useQuery({
    queryKey: ['locais_estoque'],
    queryFn: () => base44.entities.LocalEstoque.list(),
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

  const { data: centrosCusto = [] } = useQuery({
    queryKey: ['centros_custo', empresaId],
    queryFn: async () => {
      const all = await base44.entities.CentroCusto.list();
      return all.filter(c => c.empresa_id === empresaId && c.ativo !== false);
    },
    enabled: !!empresaId
  });

  const { data: lotesNota = [] } = useQuery({
    queryKey: ['lotes_nota', empresaId],
    queryFn: async () => {
      const all = await base44.entities.EstoqueLoteNota.list();
      return all.filter(l => l.empresa_id === empresaId && l.status === 'Disponivel');
    },
    enabled: !!empresaId
  });

  // ========== COMPUTED ==========
  const operacoesDisponiveis = useMemo(() => {
    return OPERACOES_POR_TIPO[tipo] || [];
  }, [tipo]);

  const operacaoSelecionada = useMemo(() => {
    return operacoesDisponiveis.find(op => op.value === operacao);
  }, [operacoesDisponiveis, operacao]);

  const exigeVinculo = operacaoSelecionada?.exigeVinculo || false;
  const precoEditavel = tipo === 'ENTRADA' || (operacaoSelecionada?.precoEditavel ?? false);

  // Saldo do produto no local (para saída)
  const saldoProdutoNoLocal = useMemo(() => {
    if (tipo !== 'SAIDA' || !currentItem.produto_id || !localEstoqueId) return null;
    return calcularSaldoProdutoLocal(lotesNota, currentItem.produto_id, localEstoqueId);
  }, [tipo, currentItem.produto_id, localEstoqueId, lotesNota]);

  // Lotes disponíveis do produto no local
  const lotesDisponiveis = useMemo(() => {
    if (!currentItem.produto_id || !localEstoqueId) return [];
    return lotesNota
      .filter(l => l.produto_id === currentItem.produto_id && l.local_estoque_id === localEstoqueId && l.quantidade_disponivel > 0)
      .sort((a, b) => new Date(a.data_documento || a.created_date || 0) - new Date(b.data_documento || b.created_date || 0));
  }, [currentItem.produto_id, localEstoqueId, lotesNota]);

  // Totais dos itens
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
      lote_origem_id: '',
      lote_origem_info: null,
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
      if (precoEditavel) {
        precoInicial = prod.preco_venda || prod.preco_custo || 0;
      } else {
        // Custo virá do lote selecionado
        const primeiroLote = lotesDisponiveis.find(l => l.produto_id === produtoId);
        precoInicial = primeiroLote?.custo_unitario || prod.preco_custo || 0;
      }
    }

    setCurrentItem(prev => ({
      ...prev,
      produto_id: produtoId,
      produto_nome: prod.nome_produto,
      produto_codigo: prod.codigo_interno || prod.codigo_barras || '',
      unidade: prod.unidade_medida || 'UN',
      preco_unitario: formatarMoedaBR(precoInicial),
      lote_origem_id: '',
      lote_origem_info: null
    }));
  };

  const handleQuantidadeChange = (valor) => {
    const qtd = parseNumeroBR(valor);
    const preco = parseMoedaBR(currentItem.preco_unitario);
    const desc = parseMoedaBR(currentItem.desconto);
    const total = qtd * preco;
    const liquido = Math.max(0, total - desc);

    setCurrentItem(prev => ({
      ...prev,
      quantidade: valor,
      total: formatarMoedaBR(total),
      liquido: formatarMoedaBR(liquido)
    }));
  };

  const handlePrecoChange = (valor) => {
    const preco = parseMoedaBR(valor);
    const qtd = parseNumeroBR(currentItem.quantidade);
    const desc = parseMoedaBR(currentItem.desconto);
    const total = qtd * preco;
    const liquido = Math.max(0, total - desc);

    setCurrentItem(prev => ({
      ...prev,
      preco_unitario: formatarMoedaBR(preco),
      total: formatarMoedaBR(total),
      liquido: formatarMoedaBR(liquido)
    }));
  };

  const handleDescontoChange = (valor) => {
    const desc = parseMoedaBR(valor);
    const total = parseMoedaBR(currentItem.total);
    const liquido = Math.max(0, total - desc);

    setCurrentItem(prev => ({
      ...prev,
      desconto: formatarMoedaBR(desc),
      liquido: formatarMoedaBR(liquido)
    }));
  };

  const handleSelecionarLote = (lote) => {
    const preco = lote.custo_unitario || 0;
    const qtd = parseNumeroBR(currentItem.quantidade);
    const desc = parseMoedaBR(currentItem.desconto);
    const total = qtd * preco;
    const liquido = Math.max(0, total - desc);

    setCurrentItem(prev => ({
      ...prev,
      lote_origem_id: lote.id,
      lote_origem_info: lote,
      preco_unitario: formatarMoedaBR(preco),
      total: formatarMoedaBR(total),
      liquido: formatarMoedaBR(liquido)
    }));
    setShowSeletorLote(false);
  };

  const handleAdicionarItem = () => {
    // Validações
    if (!currentItem.produto_id) {
      toast.error('Selecione um produto');
      return;
    }

    const qtd = parseNumeroBR(currentItem.quantidade);
    if (qtd <= 0) {
      toast.error('Informe uma quantidade válida');
      return;
    }

    // Validar saldo para saída
    if (tipo === 'SAIDA') {
      if (modoCustoSaida === 'por_lote' && !currentItem.lote_origem_id) {
        toast.error('Selecione o lote/nota de origem');
        return;
      }

      if (currentItem.lote_origem_id) {
        const lote = lotesNota.find(l => l.id === currentItem.lote_origem_id);
        if (lote && qtd > lote.quantidade_disponivel) {
          toast.error(`Quantidade maior que o saldo do lote (${formatarNumero(lote.quantidade_disponivel)})`);
          return;
        }
      } else if (saldoProdutoNoLocal !== null && qtd > saldoProdutoNoLocal) {
        toast.error(`Quantidade maior que o saldo disponível (${formatarNumero(saldoProdutoNoLocal)})`);
        return;
      }
    }

    const novoItem = {
      produto_id: currentItem.produto_id,
      produto_nome: currentItem.produto_nome,
      produto_codigo: currentItem.produto_codigo,
      unidade: currentItem.unidade,
      quantidade: qtd,
      preco_unitario: parseMoedaBR(currentItem.preco_unitario),
      total: parseMoedaBR(currentItem.total),
      desconto: parseMoedaBR(currentItem.desconto),
      liquido: parseMoedaBR(currentItem.liquido),
      lote_origem_id: currentItem.lote_origem_id || null,
      lote_origem_info: currentItem.lote_origem_info,
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
      quantidade: formatarNumero(item.quantidade),
      preco_unitario: formatarMoedaBR(item.preco_unitario),
      total: formatarMoedaBR(item.total),
      desconto: formatarMoedaBR(item.desconto),
      liquido: formatarMoedaBR(item.liquido),
      lote_origem_id: item.lote_origem_id || '',
      lote_origem_info: item.lote_origem_info,
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

    // Validações gerais
    if (!operacao) {
      toast.error('Selecione a operação');
      return;
    }

    if (!localEstoqueId) {
      toast.error('Selecione o local de estoque');
      return;
    }

    if (itens.length === 0) {
      toast.error('Adicione pelo menos um item');
      return;
    }

    // Validações específicas por tipo
    if (tipo === 'ENTRADA') {
      const opConfig = operacoesDisponiveis.find(op => op.value === operacao);
      if (opConfig?.exigeFornecedor && !fornecedorId) {
        toast.error('Selecione o fornecedor');
        return;
      }
    }

    if (tipo === 'SAIDA') {
      if (operacaoSelecionada?.exigeDestino && !destinoTexto.trim()) {
        toast.error('Informe o destino/responsável');
        return;
      }

      if (exigeVinculo && !tipoVinculo) {
        toast.error('Selecione o tipo de vínculo');
        return;
      }

      if (exigeVinculo && tipoVinculo !== 'outro' && !vinculoId) {
        toast.error('Selecione o vínculo');
        return;
      }
    }

    // Preparar dados
    const fornecedor = fornecedores.find(f => f.id === fornecedorId);
    const local = locais.find(l => l.id === localEstoqueId);

    const dadosMovimentacao = {
      empresa_id: empresaId,
      tipo_movimentacao: tipo === 'ENTRADA' ? 'Entrada' : 'Saída',
      tipo_detalhado: operacao,
      data_movimentacao: new Date(dataMovimentacao).toISOString(),
      local_estoque_origem_id: tipo === 'SAIDA' ? localEstoqueId : undefined,
      local_estoque_origem_nome: tipo === 'SAIDA' ? local?.nome : undefined,
      local_estoque_destino_id: tipo === 'ENTRADA' ? localEstoqueId : undefined,
      local_estoque_destino_nome: tipo === 'ENTRADA' ? local?.nome : undefined,
      tipo_documento: tipoDocumento || undefined,
      numero_documento: numeroDocumento || undefined,
      serie_documento: serieDocumento || undefined,
      data_documento: dataDocumento || undefined,
      chave_documento: chaveDocumento || undefined,
      fornecedor_id: tipo === 'ENTRADA' ? fornecedorId : undefined,
      fornecedor_nome: tipo === 'ENTRADA' ? fornecedor?.nome : undefined,
      destino_responsavel: tipo === 'SAIDA' ? destinoTexto : undefined,
      cliente_nome: tipo === 'SAIDA' && operacao === 'venda' ? destinoTexto : undefined,
      tipo_vinculo: tipo === 'SAIDA' && exigeVinculo ? tipoVinculo : undefined,
      vinculo_id: tipo === 'SAIDA' && exigeVinculo ? vinculoId : undefined,
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
        lote_origem_id: item.lote_origem_id,
        custo_unitario_origem: item.lote_origem_info?.custo_unitario,
        observacao_item: item.observacao_item
      }))
    };

    onSubmit(dadosMovimentacao);
  };

  // ========== RENDER ==========
  return (
    <>
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <form onSubmit={handleSubmit} className="space-y-3">
          
          {/* ========== CARD 1: CABEÇALHO ========== */}
          <Card className="shadow-sm border-slate-300">
            <CardHeader className="py-2 px-3 bg-slate-100 border-b">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                {tipo === 'ENTRADA' ? (
                  <ArrowDownCircle className="w-4 h-4 text-emerald-600" />
                ) : (
                  <ArrowUpCircle className="w-4 h-4 text-red-600" />
                )}
                {initialData?.id ? 'Editar Movimentação' : 'Nova Movimentação de Estoque'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 space-y-3">
              
              {/* Linha 1: Tipo, Operação, Data, Local */}
              <div className="grid grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Tipo *</Label>
                  <Select value={tipo} onValueChange={handleTipoChange}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ENTRADA" className="text-xs">
                        <span className="flex items-center gap-2">
                          <ArrowDownCircle className="w-3.5 h-3.5 text-emerald-600" />
                          ENTRADA
                        </span>
                      </SelectItem>
                      <SelectItem value="SAIDA" className="text-xs">
                        <span className="flex items-center gap-2">
                          <ArrowUpCircle className="w-3.5 h-3.5 text-red-600" />
                          SAÍDA
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-medium">Operação *</Label>
                  <Select value={operacao} onValueChange={setOperacao}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {operacoesDisponiveis.map(op => (
                        <SelectItem key={op.value} value={op.value} className="text-xs">
                          {op.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-medium">Data *</Label>
                  <Input 
                    type="date" 
                    value={dataMovimentacao} 
                    onChange={(e) => setDataMovimentacao(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-medium">
                    {tipo === 'ENTRADA' ? 'Local de Entrada (Destino) *' : 'Local de Saída (Origem) *'}
                  </Label>
                  <div className="flex gap-1">
                    <AutocompleteGenerico
                      items={locais}
                      value={localEstoqueId}
                      onChange={setLocalEstoqueId}
                      placeholder="Selecione"
                      displayField="nome"
                      searchFields={["nome"]}
                      className="flex-1"
                    />
                    <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => setShowDialogLocal(true)}>
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Linha 2: Documento */}
              <div className="grid grid-cols-5 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Tipo Doc.</Label>
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
                  <Label className="text-xs">Nº Documento</Label>
                  <Input 
                    value={numeroDocumento} 
                    onChange={(e) => setNumeroDocumento(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="000000"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Série</Label>
                  <Input 
                    value={serieDocumento} 
                    onChange={(e) => setSerieDocumento(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="001"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Data Doc.</Label>
                  <Input 
                    type="date"
                    value={dataDocumento} 
                    onChange={(e) => setDataDocumento(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Chave NF-e</Label>
                  <Input 
                    value={chaveDocumento} 
                    onChange={(e) => setChaveDocumento(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="44 dígitos"
                    maxLength={44}
                  />
                </div>
              </div>

              {/* Linha 3: Parceiro */}
              <div className="grid grid-cols-3 gap-2">
                {tipo === 'ENTRADA' ? (
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">
                      Fornecedor {operacaoSelecionada?.exigeFornecedor ? '*' : ''}
                    </Label>
                    <div className="flex gap-1">
                      <AutocompleteGenerico
                        items={fornecedores}
                        value={fornecedorId}
                        onChange={setFornecedorId}
                        placeholder="Selecione"
                        displayField="nome"
                        searchFields={["nome", "cnpj", "cpf"]}
                        className="flex-1"
                      />
                      <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setShowDialogFornecedor(true)}>
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">
                        Destino/Responsável {operacaoSelecionada?.exigeDestino ? '*' : ''}
                      </Label>
                      <Input 
                        value={destinoTexto} 
                        onChange={(e) => setDestinoTexto(e.target.value)}
                        className="h-8 text-xs"
                        placeholder="Cliente, setor, responsável..."
                      />
                    </div>

                    {exigeVinculo && (
                      <>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium">Tipo Vínculo *</Label>
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
                          <Label className="text-xs font-medium">Vínculo *</Label>
                          {tipoVinculo === 'outro' ? (
                            <Input 
                              value={vinculoId} 
                              onChange={(e) => setVinculoId(e.target.value)}
                              className="h-8 text-xs"
                              placeholder="Descreva..."
                            />
                          ) : tipoVinculo === 'lote' ? (
                            <Select value={vinculoId} onValueChange={setVinculoId}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Selecione" />
                              </SelectTrigger>
                              <SelectContent>
                                {lotes.map(l => (
                                  <SelectItem key={l.id} value={l.id} className="text-xs">
                                    {l.identificacao || l.nome} ({l.quantidade_animais || 0} cab)
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : tipoVinculo === 'area' ? (
                            <Select value={vinculoId} onValueChange={setVinculoId}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Selecione" />
                              </SelectTrigger>
                              <SelectContent>
                                {areas.map(a => (
                                  <SelectItem key={a.id} value={a.id} className="text-xs">
                                    {a.nome} {a.tamanho_hectares ? `(${a.tamanho_hectares} ha)` : ''}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : tipoVinculo === 'maquina' ? (
                            <Select value={vinculoId} onValueChange={setVinculoId}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Selecione" />
                              </SelectTrigger>
                              <SelectContent>
                                {maquinas.map(m => (
                                  <SelectItem key={m.id} value={m.id} className="text-xs">
                                    {m.nome || m.identificacao} {m.placa ? `(${m.placa})` : ''}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : tipoVinculo === 'centro_custo' ? (
                            <Select value={vinculoId} onValueChange={setVinculoId}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Selecione" />
                              </SelectTrigger>
                              <SelectContent>
                                {centrosCusto.map(c => (
                                  <SelectItem key={c.id} value={c.id} className="text-xs">{c.nome}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input className="h-8 text-xs" disabled placeholder="Selecione o tipo" />
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}

                <div className="space-y-1 col-span-full">
                  <Label className="text-xs">Observações</Label>
                  <Textarea 
                    value={observacoes} 
                    onChange={(e) => setObservacoes(e.target.value)}
                    className="text-xs min-h-[40px]"
                    rows={1}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ========== CARD 2: ITENS ========== */}
          <Card className="shadow-sm border-slate-300">
            <CardHeader className="py-2 px-3 bg-slate-100 border-b">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Package className="w-4 h-4" />
                Itens / Produtos
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 space-y-3">
              
              {/* Modo de custo */}
              {tipo === 'SAIDA' && (
                <div className="bg-amber-50 border border-amber-200 rounded p-2">
                  <Label className="text-xs font-medium mb-1 block">Origem do Custo</Label>
                  <RadioGroup value={modoCustoSaida} onValueChange={setModoCustoSaida} className="flex gap-4">
                    <div className="flex items-center gap-1">
                      <RadioGroupItem value="por_lote" id="por_lote" />
                      <label htmlFor="por_lote" className="text-xs">Por Nota/Lote (obrigatório)</label>
                    </div>
                    <div className="flex items-center gap-1">
                      <RadioGroupItem value="fifo" id="fifo" disabled />
                      <label htmlFor="fifo" className="text-xs text-slate-400">Automático (FIFO) - em desenvolvimento</label>
                    </div>
                  </RadioGroup>
                </div>
              )}

              {/* Formulário do Item */}
              <div className="bg-slate-50 border rounded p-3 space-y-2">
                {/* Linha 1: Produto, Quantidade, UN, Saldo */}
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-6 space-y-1">
                    <Label className="text-xs">Produto *</Label>
                    <AutocompleteGenerico
                      items={produtos}
                      value={currentItem.produto_id}
                      onChange={handleProdutoChange}
                      placeholder="Selecione o produto"
                      displayField="nome_produto"
                      searchFields={["nome_produto", "codigo_interno", "codigo_barras"]}
                    />
                  </div>

                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Quantidade *</Label>
                    <Input 
                      value={currentItem.quantidade}
                      onChange={(e) => handleQuantidadeChange(e.target.value)}
                      className="h-8 text-xs"
                      placeholder="0,00"
                    />
                  </div>

                  <div className="col-span-1 space-y-1">
                    <Label className="text-xs">UN</Label>
                    <Input 
                      value={currentItem.unidade}
                      readOnly
                      className="h-8 text-xs bg-slate-100"
                    />
                  </div>

                  {tipo === 'SAIDA' && currentItem.produto_id && (
                    <div className="col-span-3 space-y-1">
                      <Label className="text-xs">Saldo no Local</Label>
                      <div className="h-8 flex items-center">
                        <Badge variant={saldoProdutoNoLocal > 0 ? "default" : "destructive"} className="text-xs">
                          {formatarNumero(saldoProdutoNoLocal || 0)} {currentItem.unidade}
                        </Badge>
                      </div>
                    </div>
                  )}
                </div>

                {/* Seletor de Lote (para saída por lote) */}
                {tipo === 'SAIDA' && modoCustoSaida === 'por_lote' && currentItem.produto_id && localEstoqueId && (
                  <div className="bg-white border rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs font-medium">Lote/Nota de Origem *</Label>
                      {currentItem.lote_origem_info && (
                        <Badge variant="outline" className="text-xs">
                          {currentItem.lote_origem_info.numero_documento || 'S/N'} - 
                          Saldo: {formatarNumero(currentItem.lote_origem_info.quantidade_disponivel)} - 
                          Custo: {formatarMoedaBR(currentItem.lote_origem_info.custo_unitario)}
                        </Badge>
                      )}
                    </div>
                    
                    {lotesDisponiveis.length === 0 ? (
                      <div className="text-xs text-red-600 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Nenhum lote disponível para este produto neste local
                      </div>
                    ) : (
                      <div className="max-h-32 overflow-auto border rounded">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-[10px] py-1">Sel.</TableHead>
                              <TableHead className="text-[10px] py-1">Documento</TableHead>
                              <TableHead className="text-[10px] py-1">Data</TableHead>
                              <TableHead className="text-[10px] py-1">Fornecedor</TableHead>
                              <TableHead className="text-[10px] py-1 text-right">Saldo</TableHead>
                              <TableHead className="text-[10px] py-1 text-right">Custo</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {lotesDisponiveis.map(lote => (
                              <TableRow 
                                key={lote.id} 
                                className={`cursor-pointer hover:bg-emerald-50 ${currentItem.lote_origem_id === lote.id ? 'bg-emerald-100' : ''}`}
                                onClick={() => handleSelecionarLote(lote)}
                              >
                                <TableCell className="py-1 px-2">
                                  <input 
                                    type="radio" 
                                    checked={currentItem.lote_origem_id === lote.id}
                                    onChange={() => handleSelecionarLote(lote)}
                                  />
                                </TableCell>
                                <TableCell className="text-xs py-1">{lote.numero_documento || 'S/N'}/{lote.serie_documento || ''}</TableCell>
                                <TableCell className="text-xs py-1">{lote.data_documento ? new Date(lote.data_documento).toLocaleDateString('pt-BR') : '-'}</TableCell>
                                <TableCell className="text-xs py-1">{lote.fornecedor_nome || '-'}</TableCell>
                                <TableCell className="text-xs py-1 text-right font-mono">{formatarNumero(lote.quantidade_disponivel)}</TableCell>
                                <TableCell className="text-xs py-1 text-right font-mono">{formatarMoedaBR(lote.custo_unitario)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                )}

                {/* Linha 2: Valores */}
                <div className="grid grid-cols-4 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Preço Unitário (R$)</Label>
                    <Input 
                      value={currentItem.preco_unitario}
                      onChange={(e) => handlePrecoChange(e.target.value)}
                      className="h-8 text-xs text-right font-mono"
                      placeholder="R$ 0,00"
                      readOnly={!precoEditavel}
                      title={!precoEditavel ? 'Custo definido pelo lote' : undefined}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Total (R$)</Label>
                    <Input 
                      value={currentItem.total}
                      readOnly
                      className="h-8 text-xs text-right font-mono bg-slate-100"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Desconto (R$)</Label>
                    <Input 
                      value={currentItem.desconto}
                      onChange={(e) => handleDescontoChange(e.target.value)}
                      className="h-8 text-xs text-right font-mono"
                      placeholder="R$ 0,00"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Líquido (R$)</Label>
                    <Input 
                      value={currentItem.liquido}
                      readOnly
                      className="h-8 text-xs text-right font-mono bg-emerald-50 font-semibold"
                    />
                  </div>
                </div>

                {/* Linha 3: Observação */}
                <div className="space-y-1">
                  <Label className="text-xs">Observação do Item</Label>
                  <Input 
                    value={currentItem.observacao_item}
                    onChange={(e) => setCurrentItem(prev => ({ ...prev, observacao_item: e.target.value }))}
                    className="h-8 text-xs"
                    placeholder="Observação opcional..."
                  />
                </div>

                {/* Botões do item */}
                <div className="flex gap-2 pt-1">
                  <Button 
                    type="button" 
                    size="sm" 
                    className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                    onClick={handleAdicionarItem}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    {editingIndex !== null ? 'Atualizar Item' : 'Adicionar Item'}
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    className="h-8 text-xs"
                    onClick={resetCurrentItem}
                  >
                    {editingIndex !== null ? 'Cancelar Edição' : 'Limpar'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ========== CARD 3: TABELA DE ITENS ========== */}
          {itens.length > 0 && (
            <Card className="shadow-sm border-slate-300">
              <CardHeader className="py-2 px-3 bg-slate-100 border-b">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Itens Lançados ({itens.length})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs font-bold py-1 border border-black w-16">Ações</TableHead>
                      <TableHead className="text-xs font-bold py-1 border border-black">Produto</TableHead>
                      <TableHead className="text-xs font-bold py-1 border border-black">Código</TableHead>
                      <TableHead className="text-xs font-bold py-1 border border-black">UN</TableHead>
                      <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd</TableHead>
                      <TableHead className="text-xs font-bold py-1 border border-black text-right">Preço Unit.</TableHead>
                      <TableHead className="text-xs font-bold py-1 border border-black text-right">Total</TableHead>
                      <TableHead className="text-xs font-bold py-1 border border-black text-right">Desc.</TableHead>
                      <TableHead className="text-xs font-bold py-1 border border-black text-right">Líquido</TableHead>
                      {tipo === 'SAIDA' && modoCustoSaida === 'por_lote' && (
                        <TableHead className="text-xs font-bold py-1 border border-black">Nota/Lote</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itens.map((item, idx) => (
                      <TableRow key={idx} className="hover:bg-gray-50">
                        <TableCell className="text-xs py-1 px-2 border border-gray-300">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
                                <MoreVertical className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem className="text-xs" onClick={() => handleEditarItem(idx)}>
                                <Pencil className="w-3 h-3 mr-1" /> Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-xs text-red-600" onClick={() => handleRemoverItem(idx)}>
                                <Trash2 className="w-3 h-3 mr-1" /> Remover
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300">{item.produto_nome}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300">{item.produto_codigo || '-'}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300">{item.unidade}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarNumero(item.quantidade)}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarMoedaBR(item.preco_unitario)}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarMoedaBR(item.total)}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarMoedaBR(item.desconto)}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold">{formatarMoedaBR(item.liquido)}</TableCell>
                        {tipo === 'SAIDA' && modoCustoSaida === 'por_lote' && (
                          <TableCell className="text-xs py-1 border border-gray-300">
                            {item.lote_origem_info?.numero_documento || '-'}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {/* Rodapé com totais */}
                <div className="bg-slate-100 p-3 border-t flex justify-end gap-6">
                  <div className="text-xs">
                    <span className="text-slate-600">Total Bruto:</span>
                    <span className="ml-2 font-mono font-semibold">{formatarMoedaBR(totaisGerais.totalBruto)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-slate-600">Descontos:</span>
                    <span className="ml-2 font-mono font-semibold text-red-600">-{formatarMoedaBR(totaisGerais.totalDescontos)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-slate-600 font-semibold">Total Líquido:</span>
                    <span className="ml-2 font-mono font-bold text-emerald-700">{formatarMoedaBR(totaisGerais.totalLiquido)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ========== BOTÕES DE AÇÃO ========== */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
              <X className="w-3.5 h-3.5 mr-1" /> Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
              <Save className="w-3.5 h-3.5 mr-1" /> {initialData?.id ? 'Atualizar' : 'Salvar Movimentação'}
            </Button>
          </div>
        </form>
      </motion.div>

      {/* Dialogs */}
      <DialogCadastroRapido 
        tipo="local_estoque" 
        open={showDialogLocal} 
        onClose={() => setShowDialogLocal(false)} 
        onSuccess={(id) => { 
          queryClient.invalidateQueries({ queryKey: ['locais_estoque'] }); 
          setLocalEstoqueId(id); 
          setShowDialogLocal(false); 
        }} 
      />
      <DialogCadastroRapido 
        tipo="fornecedor" 
        open={showDialogFornecedor} 
        onClose={() => setShowDialogFornecedor(false)} 
        onSuccess={(id) => { 
          queryClient.invalidateQueries({ queryKey: ['fornecedores'] }); 
          setFornecedorId(id); 
          setShowDialogFornecedor(false); 
        }} 
      />
    </>
  );
}