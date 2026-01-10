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
import { 
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { 
  ArrowDownCircle, ArrowUpCircle, RefreshCw, Plus, Trash2, MoreVertical, Pencil, 
  Package, Save, X, FileText, AlertTriangle, User, Truck, MapPin, Settings
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import AutocompleteGenerico from "../financeiro/AutocompleteGenerico.jsx";
import DialogCadastroRapido from "../financeiro/DialogCadastroRapido.jsx";

// ========== FUNÇÕES UTILITÁRIAS ==========
const formatarMoedaBR = (valor) => {
  if (valor === null || valor === undefined || isNaN(valor)) return "R$ 0,00";
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const parseMoedaBR = (str) => {
  if (!str && str !== 0) return 0;
  if (typeof str === 'number') return str;
  const cleaned = String(str).replace(/\s/g, '').replace(/R\$/g, '').replace(/\./g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
};

const formatarNumero = (num, decimais = 2) => {
  if (num === null || num === undefined || isNaN(num)) return '0,00';
  return Number(num).toLocaleString('pt-BR', { minimumFractionDigits: decimais, maximumFractionDigits: decimais });
};

const parseNumeroBR = (str) => {
  if (!str && str !== 0) return 0;
  if (typeof str === 'number') return str;
  return parseFloat(String(str).replace(/\./g, '').replace(',', '.')) || 0;
};

// ========== CONFIGURAÇÕES DE OPERAÇÕES ==========
const OPERACOES_ENTRADA = [
  { value: 'compra', label: 'Compra', exigeFornecedor: true, exigeDocumento: true },
  { value: 'compra_vista', label: 'Compra à Vista', exigeFornecedor: true, exigeDocumento: true },
  { value: 'compra_prazo', label: 'Compra a Prazo', exigeFornecedor: true, exigeDocumento: true },
  { value: 'devolucao_cliente', label: 'Devolução de Cliente', exigeFornecedor: false, exigeDocumento: false },
  { value: 'bonificacao', label: 'Bonificação', exigeFornecedor: true, exigeDocumento: false },
  { value: 'doacao_recebida', label: 'Doação Recebida', exigeFornecedor: false, exigeDocumento: false },
  { value: 'producao_entrada', label: 'Produção / Entrada Interna', exigeFornecedor: false, exigeDocumento: false },
  { value: 'transferencia_recebida', label: 'Transferência Recebida', exigeFornecedor: false, exigeDocumento: false },
  { value: 'ajuste_positivo', label: 'Ajuste Positivo', exigeFornecedor: false, exigeDocumento: false },
  { value: 'outros_entrada', label: 'Outros', exigeFornecedor: false, exigeDocumento: false }
];

const OPERACOES_SAIDA = [
  { value: 'venda', label: 'Venda', exigeCliente: true, precoEditavel: true, exigeDocumento: false },
  { value: 'venda_vista', label: 'Venda à Vista', exigeCliente: true, precoEditavel: true, exigeDocumento: false },
  { value: 'venda_prazo', label: 'Venda a Prazo', exigeCliente: true, precoEditavel: true, exigeDocumento: false },
  { value: 'consumo_interno', label: 'Consumo Interno', exigeVinculo: true, precoEditavel: true, usaCusto: true },
  { value: 'suplementacao', label: 'Suplementação', exigeVinculo: true, precoEditavel: true, usaCusto: true },
  { value: 'aplicacao_area', label: 'Aplicação em Área', exigeVinculo: true, precoEditavel: true, usaCusto: true },
  { value: 'manutencao', label: 'Manutenção de Máquina', exigeVinculo: true, precoEditavel: true, usaCusto: true },
  { value: 'doacao', label: 'Doação', exigeVinculo: false, precoEditavel: true, usaCusto: true },
  { value: 'perda', label: 'Perda', exigeMotivo: true, precoEditavel: true, usaCusto: true },
  { value: 'quebra', label: 'Quebra', exigeMotivo: true, precoEditavel: true, usaCusto: true },
  { value: 'transferencia_enviada', label: 'Transferência Enviada', exigeVinculo: false, precoEditavel: true, usaCusto: true },
  { value: 'ajuste_negativo', label: 'Ajuste Negativo', exigeVinculo: false, precoEditavel: true, usaCusto: true },
  { value: 'outros_saida', label: 'Outros', exigeVinculo: false, precoEditavel: true }
];

const OPERACOES_AJUSTE = [
  { value: 'ajuste_positivo', label: 'Ajuste Positivo', tipoAjuste: 'positivo' },
  { value: 'ajuste_negativo', label: 'Ajuste Negativo', tipoAjuste: 'negativo' },
  { value: 'inventario', label: 'Inventário', tipoAjuste: 'inventario' },
  { value: 'correcao', label: 'Correção', tipoAjuste: 'correcao' }
];

const MOTIVOS_PERDA = [
  'Vencimento',
  'Quebra',
  'Roubo',
  'Contaminação',
  'Erro operacional',
  'Deterioração',
  'Sinistro',
  'Outro'
];

const TIPOS_DOCUMENTO = [
  { value: 'nfe', label: 'NF-e' },
  { value: 'nfce', label: 'NFC-e' },
  { value: 'nota_fiscal', label: 'Nota Fiscal' },
  { value: 'recibo', label: 'Recibo' },
  { value: 'outros', label: 'Outros' }
];

const TIPOS_VINCULO = [
  { value: 'lote', label: 'Lote (Pecuária)', icon: Package },
  { value: 'area', label: 'Área / Pasto', icon: MapPin },
  { value: 'maquina', label: 'Máquina / Veículo', icon: Truck },
  { value: 'centro_custo', label: 'Centro de Custo', icon: Settings }
];

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
  const [tipo, setTipo] = useState(
    initialData?.tipo_movimentacao === 'Saída' ? 'SAIDA' : 
    initialData?.tipo_movimentacao === 'Ajuste' ? 'AJUSTE' : 'ENTRADA'
  );
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
  const [cfop, setCfop] = useState(initialData?.cfop || '');
  const [naturezaOperacao, setNaturezaOperacao] = useState(initialData?.natureza_operacao || '');
  
  // Parceiro
  const [fornecedorId, setFornecedorId] = useState(initialData?.fornecedor_id || '');
  const [clienteNome, setClienteNome] = useState(initialData?.cliente_nome || '');
  
  // Vínculo
  const [tipoVinculo, setTipoVinculo] = useState(initialData?.tipo_vinculo || '');
  const [vinculoId, setVinculoId] = useState(
    initialData?.lote_vinculado_id || initialData?.area_vinculada_id || 
    initialData?.maquina_vinculada_id || initialData?.centro_custo_id || ''
  );
  
  // Motivo (para perda/quebra/ajuste)
  const [motivoMovimentacao, setMotivoMovimentacao] = useState(initialData?.motivo_movimentacao || '');
  const [observacoes, setObservacoes] = useState(initialData?.observacoes || '');

  // ========== ESTADO DOS ITENS ==========
  const [itens, setItens] = useState([]);
  
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

  const { data: movimentacoesEstoque = [] } = useQuery({
    queryKey: ['movimentacoes_calc', empresaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list();
      return all.filter(m => m.empresa_id === empresaId && m.status === 'Ativa');
    },
    enabled: !!empresaId
  });

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

  // Flags de exibição de campos
  const exibeFornecedor = tipo === 'ENTRADA' && operacaoSelecionada?.exigeFornecedor;
  const exibeDocumento = tipo === 'ENTRADA' && operacaoSelecionada?.exigeDocumento;
  const exibeCliente = tipo === 'SAIDA' && operacaoSelecionada?.exigeCliente;
  const exibeVinculo = tipo === 'SAIDA' && operacaoSelecionada?.exigeVinculo;
  const exibeMotivo = (tipo === 'SAIDA' && operacaoSelecionada?.exigeMotivo) || tipo === 'AJUSTE';
  const usaCusto = operacaoSelecionada?.usaCusto || false;

  // Calcular estoque por local
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
      } else if (mov.tipo_movimentacao === 'Ajuste') {
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

  // Saldo do produto no local
  const saldoProdutoNoLocal = useMemo(() => {
    if (!currentItem.produto_id || !localEstoqueId) return null;
    return estoquePorLocal[currentItem.produto_id]?.[localEstoqueId] || 0;
  }, [currentItem.produto_id, localEstoqueId, estoquePorLocal]);

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
    // Limpar campos incompatíveis
    setFornecedorId('');
    setClienteNome('');
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
  };

  const handleOperacaoChange = (novaOperacao) => {
    setOperacao(novaOperacao);
    // Reset campos dependentes
    if (tipo === 'ENTRADA') {
      const op = OPERACOES_ENTRADA.find(o => o.value === novaOperacao);
      if (!op?.exigeFornecedor) setFornecedorId('');
      if (!op?.exigeDocumento) {
        setTipoDocumento('');
        setNumeroDocumento('');
        setSerieDocumento('');
        setDataDocumento('');
        setChaveDocumento('');
        setCfop('');
        setNaturezaOperacao('');
      }
    }
    if (tipo === 'SAIDA') {
      const op = OPERACOES_SAIDA.find(o => o.value === novaOperacao);
      if (!op?.exigeCliente) setClienteNome('');
      if (!op?.exigeVinculo) {
        setTipoVinculo('');
        setVinculoId('');
      }
      if (!op?.exigeMotivo) setMotivoMovimentacao('');
    }
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
      if (operacaoSelecionada?.usaCusto) {
        // Para operações de custo, usar o custo médio do produto
        precoInicial = prod.preco_custo || 0;
      } else {
        // Para vendas, usar preço de venda
        precoInicial = prod.preco_venda || prod.preco_custo || 0;
      }
    } else if (tipo === 'AJUSTE') {
      precoInicial = 0; // Ajuste pode ter valor zero
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

  const recalcularTotais = (quantidade, precoUnitario, desconto) => {
    const qtd = parseNumeroBR(quantidade) || 0;
    const preco = parseMoedaBR(precoUnitario) || 0;
    const desc = parseMoedaBR(desconto) || 0;
    const total = qtd * preco;
    const liquido = Math.max(0, total - desc);
    return { total, liquido };
  };

  const handleQuantidadeChange = (valor) => {
    const { total, liquido } = recalcularTotais(valor, currentItem.preco_unitario, currentItem.desconto);
    setCurrentItem(prev => ({
      ...prev,
      quantidade: valor,
      total: formatarMoedaBR(total),
      liquido: formatarMoedaBR(liquido)
    }));
  };

  const handlePrecoChange = (valor) => {
    const { total, liquido } = recalcularTotais(currentItem.quantidade, valor, currentItem.desconto);
    setCurrentItem(prev => ({
      ...prev,
      preco_unitario: valor,
      total: formatarMoedaBR(total),
      liquido: formatarMoedaBR(liquido)
    }));
  };

  const handleDescontoChange = (valor) => {
    const { total, liquido } = recalcularTotais(currentItem.quantidade, currentItem.preco_unitario, valor);
    setCurrentItem(prev => ({
      ...prev,
      desconto: valor,
      liquido: formatarMoedaBR(liquido)
    }));
  };

  const handleSelecionarLote = (lote) => {
    const preco = lote.custo_unitario || 0;
    const { total, liquido } = recalcularTotais(currentItem.quantidade, formatarMoedaBR(preco), currentItem.desconto);

    setCurrentItem(prev => ({
      ...prev,
      lote_origem_id: lote.id,
      lote_origem_info: lote,
      preco_unitario: formatarMoedaBR(preco),
      total: formatarMoedaBR(total),
      liquido: formatarMoedaBR(liquido)
    }));
  };

  const handleAdicionarItem = () => {
    // Validações
    if (!currentItem.produto_id) {
      toast.error('❌ Selecione um produto');
      return;
    }

    const qtd = parseNumeroBR(currentItem.quantidade);
    if (qtd <= 0) {
      toast.error('❌ Informe uma quantidade válida');
      return;
    }

    // Validar saldo para saída
    if (tipo === 'SAIDA' || (tipo === 'AJUSTE' && operacao?.includes('negativo'))) {
      if (saldoProdutoNoLocal !== null && qtd > saldoProdutoNoLocal) {
        toast.error(`❌ Quantidade maior que o saldo disponível (${formatarNumero(saldoProdutoNoLocal)})`);
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
      toast.success('✅ Item atualizado');
    } else {
      setItens(prev => [...prev, novoItem]);
      toast.success('✅ Item adicionado');
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
      toast.error('❌ Selecione a operação');
      return;
    }

    if (!localEstoqueId) {
      toast.error('❌ Selecione o local de estoque');
      return;
    }

    if (itens.length === 0) {
      toast.error('❌ Adicione pelo menos um item');
      return;
    }

    // Validações específicas por tipo
    if (tipo === 'ENTRADA' && exibeFornecedor && !fornecedorId) {
      toast.error('❌ Selecione o fornecedor (obrigatório para esta operação)');
      return;
    }

    if (tipo === 'ENTRADA' && exibeDocumento && !numeroDocumento) {
      toast.error('❌ Informe o número do documento (obrigatório para compra)');
      return;
    }

    if (tipo === 'SAIDA') {
      if (exibeCliente && !clienteNome.trim()) {
        toast.error('❌ Informe o cliente/destinatário');
        return;
      }

      if (exibeVinculo && !tipoVinculo) {
        toast.error('❌ Selecione o tipo de vínculo (obrigatório para esta operação)');
        return;
      }

      if (exibeVinculo && !vinculoId) {
        toast.error('❌ Selecione o vínculo');
        return;
      }

      if (exibeMotivo && !motivoMovimentacao) {
        toast.error('❌ Informe o motivo (obrigatório para perda/quebra)');
        return;
      }
    }

    if (tipo === 'AJUSTE' && !motivoMovimentacao) {
      toast.error('❌ Informe o motivo do ajuste (obrigatório)');
      return;
    }

    // Preparar dados
    const fornecedor = fornecedores.find(f => f.id === fornecedorId);
    const local = locais.find(l => l.id === localEstoqueId);

    // Determinar tipo de movimentação para o banco
    let tipoMovimentacao = 'Entrada';
    if (tipo === 'SAIDA') tipoMovimentacao = 'Saída';
    if (tipo === 'AJUSTE') tipoMovimentacao = 'Ajuste';

    // Determinar local origem/destino
    let localOrigemId, localOrigemNome, localDestinoId, localDestinoNome;
    if (tipo === 'ENTRADA' || (tipo === 'AJUSTE' && operacao?.includes('positivo'))) {
      localDestinoId = localEstoqueId;
      localDestinoNome = local?.nome;
    } else {
      localOrigemId = localEstoqueId;
      localOrigemNome = local?.nome;
    }

    // Dados do vínculo
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
      } else if (tipoVinculo === 'centro_custo') {
        const cc = centrosCusto.find(c => c.id === vinculoId);
        vinculoData.centro_custo_id = vinculoId;
        vinculoData.centro_custo_nome = cc?.nome;
      }
    }

    const dadosMovimentacao = {
      empresa_id: empresaId,
      tipo_movimentacao: tipoMovimentacao,
      tipo_detalhado: operacao,
      data_movimentacao: new Date(dataMovimentacao).toISOString(),
      local_estoque_origem_id: localOrigemId,
      local_estoque_origem_nome: localOrigemNome,
      local_estoque_destino_id: localDestinoId,
      local_estoque_destino_nome: localDestinoNome,
      tipo_documento: tipoDocumento || undefined,
      numero_documento: numeroDocumento || undefined,
      serie_documento: serieDocumento || undefined,
      data_documento: dataDocumento || undefined,
      chave_documento: chaveDocumento || undefined,
      cfop: cfop || undefined,
      natureza_operacao: naturezaOperacao || undefined,
      fornecedor_id: fornecedorId || undefined,
      fornecedor_nome: fornecedor?.nome || undefined,
      cliente_nome: clienteNome || undefined,
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
                {tipo === 'ENTRADA' && <ArrowDownCircle className="w-4 h-4 text-emerald-600" />}
                {tipo === 'SAIDA' && <ArrowUpCircle className="w-4 h-4 text-red-600" />}
                {tipo === 'AJUSTE' && <RefreshCw className="w-4 h-4 text-blue-600" />}
                {initialData?.id ? 'Editar Movimentação' : 'Nova Movimentação de Estoque'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 space-y-3">
              
              {/* Linha 1: Tipo, Operação, Data, Local */}
              <div className="grid grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Tipo *</Label>
                  <Select value={tipo} onValueChange={handleTipoChange}>
                    <SelectTrigger className="h-8 text-xs">
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
                      <SelectItem value="AJUSTE" className="text-xs">
                        <span className="flex items-center gap-2">
                          <RefreshCw className="w-3.5 h-3.5 text-blue-600" />
                          AJUSTE
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-medium">
                    {tipo === 'ENTRADA' ? 'Operação de Entrada *' : 
                     tipo === 'SAIDA' ? 'Operação de Saída *' : 
                     'Tipo de Ajuste *'}
                  </Label>
                  <Select value={operacao} onValueChange={handleOperacaoChange}>
                    <SelectTrigger className="h-8 text-xs">
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
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-medium">
                    {tipo === 'ENTRADA' ? 'Local de Entrada *' : 
                     tipo === 'SAIDA' ? 'Local de Saída *' : 
                     'Local do Ajuste *'}
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
                    <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setShowDialogLocal(true)}>
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Linha 2: Documento (condicional) */}
              {exibeDocumento && (
                <div className="bg-slate-50 border rounded p-2 space-y-2">
                  <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5" /> Dados do Documento
                  </Label>
                  <div className="grid grid-cols-6 gap-2">
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
                      <Label className="text-xs">Nº Documento *</Label>
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
                      <Label className="text-xs">CFOP</Label>
                      <Input 
                        value={cfop} 
                        onChange={(e) => setCfop(e.target.value)}
                        className="h-8 text-xs"
                        placeholder="0000"
                        maxLength={4}
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Natureza Op.</Label>
                      <Input 
                        value={naturezaOperacao} 
                        onChange={(e) => setNaturezaOperacao(e.target.value)}
                        className="h-8 text-xs"
                        placeholder="Compra p/ comercialização"
                      />
                    </div>
                  </div>

                  {tipoDocumento === 'nfe' && (
                    <div className="space-y-1">
                      <Label className="text-xs">Chave NF-e (44 dígitos)</Label>
                      <Input 
                        value={chaveDocumento} 
                        onChange={(e) => setChaveDocumento(e.target.value)}
                        className="h-8 text-xs"
                        placeholder="00000000000000000000000000000000000000000000"
                        maxLength={44}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Linha 3: Fornecedor (condicional) */}
              {exibeFornecedor && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium flex items-center gap-1">
                      <User className="w-3.5 h-3.5" /> Fornecedor *
                    </Label>
                    <div className="flex gap-1">
                      <AutocompleteGenerico
                        items={fornecedores}
                        value={fornecedorId}
                        onChange={setFornecedorId}
                        placeholder="Selecione o fornecedor"
                        displayField="nome"
                        searchFields={["nome", "cnpj", "cpf"]}
                        className="flex-1"
                      />
                      <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setShowDialogFornecedor(true)}>
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Linha 4: Cliente (condicional) */}
              {exibeCliente && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium flex items-center gap-1">
                      <User className="w-3.5 h-3.5" /> Cliente / Destinatário *
                    </Label>
                    <Input 
                      value={clienteNome} 
                      onChange={(e) => setClienteNome(e.target.value)}
                      className="h-8 text-xs"
                      placeholder="Nome do cliente ou destinatário"
                    />
                  </div>
                </div>
              )}

              {/* Linha 5: Vínculo (condicional) */}
              {exibeVinculo && (
                <div className="bg-blue-50 border border-blue-200 rounded p-2 space-y-2">
                  <Label className="text-xs font-semibold text-blue-700">Vínculo da Saída (Obrigatório)</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Tipo de Vínculo *</Label>
                      <Select value={tipoVinculo} onValueChange={(v) => { setTipoVinculo(v); setVinculoId(''); }}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {TIPOS_VINCULO.map(t => (
                            <SelectItem key={t.value} value={t.value} className="text-xs">
                              <span className="flex items-center gap-2">
                                <t.icon className="w-3.5 h-3.5" />
                                {t.label}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Vínculo *</Label>
                      {tipoVinculo === 'lote' ? (
                        <Select value={vinculoId} onValueChange={setVinculoId}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Selecione o lote" />
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
                            <SelectValue placeholder="Selecione a área" />
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
                            <SelectValue placeholder="Selecione a máquina" />
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
                            <SelectValue placeholder="Selecione o centro de custo" />
                          </SelectTrigger>
                          <SelectContent>
                            {centrosCusto.map(c => (
                              <SelectItem key={c.id} value={c.id} className="text-xs">{c.nome}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input className="h-8 text-xs" disabled placeholder="Selecione o tipo primeiro" />
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Linha 6: Motivo (condicional) */}
              {exibeMotivo && (
                <div className="bg-amber-50 border border-amber-200 rounded p-2 space-y-2">
                  <Label className="text-xs font-semibold text-amber-700">
                    {tipo === 'AJUSTE' ? 'Motivo do Ajuste *' : 'Motivo da Perda/Quebra *'}
                  </Label>
                  {tipo === 'SAIDA' && (operacao === 'perda' || operacao === 'quebra') ? (
                    <Select value={motivoMovimentacao} onValueChange={setMotivoMovimentacao}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Selecione o motivo" />
                      </SelectTrigger>
                      <SelectContent>
                        {MOTIVOS_PERDA.map(m => (
                          <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input 
                      value={motivoMovimentacao} 
                      onChange={(e) => setMotivoMovimentacao(e.target.value)}
                      className="h-8 text-xs"
                      placeholder="Descreva o motivo do ajuste..."
                    />
                  )}
                </div>
              )}

              {/* Linha 7: Observações */}
              <div className="space-y-1">
                <Label className="text-xs">Observações Gerais</Label>
                <Textarea 
                  value={observacoes} 
                  onChange={(e) => setObservacoes(e.target.value)}
                  className="text-xs min-h-[40px]"
                  rows={1}
                  placeholder="Observações opcionais..."
                />
              </div>
            </CardContent>
          </Card>

          {/* ========== CARD 2: FORMULÁRIO DO ITEM ========== */}
          <Card className="shadow-sm border-slate-300">
            <CardHeader className="py-2 px-3 bg-slate-100 border-b">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Package className="w-4 h-4" />
                Lançar Produto
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 space-y-3">
              
              {/* Linha 1: Produto */}
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
                  <Label className="text-xs">Código</Label>
                  <Input 
                    value={currentItem.produto_codigo}
                    readOnly
                    className="h-8 text-xs bg-slate-100"
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

                {(tipo === 'SAIDA' || tipo === 'AJUSTE') && currentItem.produto_id && (
                  <div className="col-span-3 space-y-1">
                    <Label className="text-xs">Saldo no Local</Label>
                    <div className="h-8 flex items-center">
                      <Badge 
                        variant={saldoProdutoNoLocal > 0 ? "default" : "destructive"} 
                        className="text-xs"
                      >
                        {formatarNumero(saldoProdutoNoLocal || 0)} {currentItem.unidade}
                      </Badge>
                    </div>
                  </div>
                )}
              </div>

              {/* Seletor de Lote/Nota (para saída com custo) */}
              {tipo === 'SAIDA' && usaCusto && currentItem.produto_id && localEstoqueId && lotesDisponiveis.length > 0 && (
                <div className="bg-slate-50 border rounded p-2">
                  <Label className="text-xs font-medium mb-1 block">Selecionar Lote/Nota de Origem (opcional - define o custo)</Label>
                  {currentItem.lote_origem_info && (
                    <Badge variant="outline" className="text-xs mb-2">
                      Selecionado: {currentItem.lote_origem_info.numero_documento || 'S/N'} - 
                      Custo: {formatarMoedaBR(currentItem.lote_origem_info.custo_unitario)}
                    </Badge>
                  )}
                  <div className="max-h-28 overflow-auto border rounded bg-white">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-[10px] py-1 border border-black">Sel.</TableHead>
                          <TableHead className="text-[10px] py-1 border border-black">Documento</TableHead>
                          <TableHead className="text-[10px] py-1 border border-black">Data</TableHead>
                          <TableHead className="text-[10px] py-1 border border-black text-right">Saldo</TableHead>
                          <TableHead className="text-[10px] py-1 border border-black text-right">Custo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lotesDisponiveis.map(lote => (
                          <TableRow 
                            key={lote.id} 
                            className={`cursor-pointer hover:bg-emerald-50 ${currentItem.lote_origem_id === lote.id ? 'bg-emerald-100' : ''}`}
                            onClick={() => handleSelecionarLote(lote)}
                          >
                            <TableCell className="py-1 px-2 border border-gray-300">
                              <input 
                                type="radio" 
                                checked={currentItem.lote_origem_id === lote.id}
                                onChange={() => handleSelecionarLote(lote)}
                              />
                            </TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{lote.numero_documento || 'S/N'}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{lote.data_documento ? new Date(lote.data_documento).toLocaleDateString('pt-BR') : '-'}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarNumero(lote.quantidade_disponivel)}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarMoedaBR(lote.custo_unitario)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Linha 2: Quantidade e Valores */}
              <div className="grid grid-cols-5 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Quantidade *</Label>
                  <Input 
                    value={currentItem.quantidade}
                    onChange={(e) => handleQuantidadeChange(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="0,00"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Preço Unitário (R$)</Label>
                  <Input 
                    value={currentItem.preco_unitario}
                    onChange={(e) => handlePrecoChange(e.target.value)}
                    className="h-8 text-xs text-right font-mono"
                    placeholder="R$ 0,00"
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
                  <Label className="text-xs font-medium">Valor Líquido (R$)</Label>
                  <Input 
                    value={currentItem.liquido}
                    readOnly
                    className="h-8 text-xs text-right font-mono bg-emerald-50 font-semibold"
                  />
                </div>
              </div>

              {/* Linha 3: Observação do Item */}
              <div className="space-y-1">
                <Label className="text-xs">Observação do Item</Label>
                <Input 
                  value={currentItem.observacao_item}
                  onChange={(e) => setCurrentItem(prev => ({ ...prev, observacao_item: e.target.value }))}
                  className="h-8 text-xs"
                  placeholder="Observação opcional do item..."
                />
              </div>

              {/* Validação de saldo */}
              {(tipo === 'SAIDA' || (tipo === 'AJUSTE' && operacao?.includes('negativo'))) && 
               currentItem.produto_id && 
               parseNumeroBR(currentItem.quantidade) > (saldoProdutoNoLocal || 0) && (
                <div className="bg-red-50 border border-red-200 rounded p-2 flex items-center gap-2 text-red-700">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-xs font-medium">
                    ❌ Quantidade maior que o saldo disponível ({formatarNumero(saldoProdutoNoLocal || 0)} {currentItem.unidade})
                  </span>
                </div>
              )}

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