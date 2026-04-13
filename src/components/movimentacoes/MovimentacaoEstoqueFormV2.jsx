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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MoreVertical } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import AutocompleteGenerico from "../financeiro/AutocompleteGenerico.jsx";
import { toValue, prepararLocaisParaSalvar } from "./utils/movimentacaoUtils";

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
  if (num === null || num === undefined || isNaN(num)) return '';
  return Number(num).toLocaleString('pt-BR', { minimumFractionDigits: decimais, maximumFractionDigits: decimais });
};

const parseNumeroBR = (str) => {
  if (!str && str !== 0) return 0;
  if (typeof str === 'number') return str;
  return parseFloat(String(str).replace(/\./g, '').replace(',', '.')) || 0;
};

const calcularSaldoProdutoLocal = (lotes, produtoId, localId) => {
  return lotes
    .filter(l => l.produto_id === produtoId && l.local_estoque_id === localId && l.quantidade_disponivel > 0)
    .reduce((sum, l) => sum + (l.quantidade_disponivel || 0), 0);
};

// ========== CONSTANTES - OPERAÇÕES COMPLETAS ==========
const OPERACOES_POR_TIPO = {
  ENTRADA: [
    { value: 'compra', label: 'Compra', exigeFornecedor: true, exigeDocumento: true },
    { value: 'devolucao_cliente', label: 'Devolução de Cliente', exigeFornecedor: false, exigeDocumento: true, exigeDestino: true },
    { value: 'devolucao_fornecedor', label: 'Devolução de Fornecedor', exigeFornecedor: true, exigeDocumento: true },
    { value: 'bonificacao', label: 'Bonificação', exigeFornecedor: true, exigeDocumento: false },
    { value: 'transferencia_recebida', label: 'Transferência Recebida', exigeFornecedor: false },
    { value: 'producao_entrada', label: 'Produção Interna', exigeFornecedor: false },
    { value: 'ajuste_positivo', label: 'Ajuste Positivo', exigeFornecedor: false, exigeMotivo: true },
    { value: 'outros_entrada', label: 'Outros', exigeFornecedor: false }
  ],
  SAIDA: [
    { value: 'venda', label: 'Venda', exigeDestino: true, precoEditavel: true, exigeDocumento: false },
    { value: 'devolucao_fornecedor', label: 'Devolução ao Fornecedor', exigeFornecedor: true, exigeDocumento: true, precoEditavel: false },
    { value: 'consumo_interno', label: 'Consumo Interno', exigeVinculo: true, precoEditavel: false, exigeMotivo: true },
    { value: 'suplementacao', label: 'Suplementação', exigeVinculo: true, precoEditavel: false, exigeCentroCusto: true },
    { value: 'aplicacao_area', label: 'Aplicação em Área', exigeVinculo: true, precoEditavel: false, exigeCentroCusto: true },
    { value: 'manutencao', label: 'Manutenção', exigeVinculo: true, precoEditavel: false, exigeCentroCusto: true },
    { value: 'perda_quebra', label: 'Perda/Quebra', exigeVinculo: false, precoEditavel: false, exigeMotivo: true },
    { value: 'transferencia_enviada', label: 'Transferência Enviada', exigeFornecedor: false, precoEditavel: false },
    { value: 'ajuste_negativo', label: 'Ajuste Negativo', exigeFornecedor: false, precoEditavel: false, exigeMotivo: true },
    { value: 'outros_saida', label: 'Outros', exigeVinculo: false, precoEditavel: false, exigeMotivo: false }
  ],
  TRANSFERENCIA: [
    { value: 'entre_locais', label: 'Entre Locais', exigeLocalOrigem: true, exigeLocalDestino: true },
    { value: 'entre_empresas', label: 'Entre Empresas', exigeLocalOrigem: true, exigeLocalDestino: true },
    { value: 'outros_transferencia', label: 'Outros', exigeLocalOrigem: true, exigeLocalDestino: true }
  ],
  AJUSTE: [
    { value: 'ajuste_positivo', label: 'Ajuste Positivo (Entrada)', exigeMotivo: true },
    { value: 'ajuste_negativo', label: 'Ajuste Negativo (Saída)', exigeMotivo: true },
    { value: 'inventario', label: 'Inventário', exigeMotivo: true },
    { value: 'correcao', label: 'Correção de Estoque', exigeMotivo: true },
    { value: 'outros_ajuste', label: 'Outros Ajustes', exigeMotivo: true }
  ]
};

const TIPOS_VINCULO = [
  { value: 'lote', label: 'Lote (Pecuária)' },
  { value: 'area', label: 'Área / Pasto' },
  { value: 'maquina', label: 'Máquina / Veículo' },
  { value: 'funcionario', label: 'Funcionário' },
  { value: 'outro', label: 'Outro' }
];

const TIPOS_DOCUMENTO = [
  { value: 'nfe', label: 'NF-e' },
  { value: 'nota_fiscal', label: 'Nota Fiscal' },
  { value: 'recibo', label: 'Recibo' },
  { value: 'outros', label: 'Outros' }
];

const MOTIVOS_PERDA = [
  { value: 'vencimento', label: 'Vencimento/Validade' },
  { value: 'avaria', label: 'Avaria/Dano' },
  { value: 'roubo_furto', label: 'Roubo/Furto' },
  { value: 'quebra_transporte', label: 'Quebra no Transporte' },
  { value: 'outros', label: 'Outros' }
];

const FL = ({ label, required, children }) => (
  <div>
    <label className="text-[12px] text-slate-500 pl-1 leading-none">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors">
      {children}
    </div>
  </div>
);

const fieldInputClass = "h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent uppercase";
const fieldSelectTriggerClass = "h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent uppercase";
const fieldTextareaClass = "text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent uppercase min-h-[50px]";

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
    initialData?.tipo_movimentacao === 'Transferência' ? 'TRANSFERENCIA' :
    initialData?.tipo_movimentacao === 'Ajuste' ? 'AJUSTE' : 'ENTRADA'
  );
  const [operacao, setOperacao] = useState(initialData?.tipo_detalhado ? toValue(initialData.tipo_detalhado) : '');
  const [dataMovimentacao, setDataMovimentacao] = useState(
    initialData?.data_movimentacao?.split('T')[0] || new Date().toISOString().slice(0, 10)
  );
  const [localEstoqueOrigemId, setLocalEstoqueOrigemId] = useState(
    initialData?.local_estoque_origem || ''
  );
  const [localEstoqueOrigemNome, setLocalEstoqueOrigemNome] = useState(
    initialData?.local_origem || ''
  );
  const [localEstoqueDestinoId, setLocalEstoqueDestinoId] = useState(
    initialData?.local_estoque_destino || ''
  );
  const [localEstoqueDestinoNome, setLocalEstoqueDestinoNome] = useState(
    initialData?.local_destino || ''
  );
  
  // Documento/NF-e
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
  const [destinoTexto, setDestinoTexto] = useState(initialData?.cliente_nome || initialData?.destino_responsavel || '');
  
  // Vínculo (para saídas específicas)
  const [tipoVinculo, setTipoVinculo] = useState(initialData?.tipo_vinculo || '');
  const [vinculoId, setVinculoId] = useState(
    initialData?.lote_vinculado_id || initialData?.area_vinculada_id || 
    initialData?.maquina_vinculada_id || ''
  );
  
  // Centro de Custo (sempre visível)
  const [centroCustoId, setCentroCustoId] = useState(initialData?.centro_custo_id || '');
  
  // Motivo/Justificativa
  const [motivoMovimentacao, setMotivoMovimentacao] = useState(initialData?.motivo_movimentacao || '');
  const [motivoPerda, setMotivoPerda] = useState(initialData?.motivo_perda || '');
  
  const [observacoes, setObservacoes] = useState(initialData?.observacoes || '');

  // ========== ESTADO DOS ITENS ==========
  const [itens, setItens] = useState([]);
  const [modoCustoSaida, setModoCustoSaida] = useState('por_lote');
  
  // Item atual (formulário) - valores como strings para digitação
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
    rateio_lotes: [],
    observacao_item: ''
  });
  const [editingIndex, setEditingIndex] = useState(null);
  const [itensCarregados, setItensCarregados] = useState(false);

  // Dialog de confirmação ao trocar tipo
  const [showConfirmTipoChange, setShowConfirmTipoChange] = useState(false);
  const [pendingTipo, setPendingTipo] = useState(null);

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

  // ========== EFEITO: Carregar itens na edição após produtos carregarem ==========
  useEffect(() => {
    if (!initialData?.id || itensCarregados) return;
    if (!produtos || produtos.length === 0) return;

    const initialMovementProducts = initialData.produtos;

    if (initialMovementProducts && Array.isArray(initialMovementProducts) && initialMovementProducts.length > 0) {
      const loadedItems = initialMovementProducts.map(p => {
        const prod = produtos.find(prod => prod.id === p.produto_id);
        return {
          produto_id: p.produto_id,
          produto_nome: p.produto_nome || prod?.nome_produto || '',
          produto_codigo: p.produto_codigo || prod?.codigo_interno || prod?.codigo_barras || '',
          unidade: p.unidade_medida || prod?.unidade_medida || 'UN',
          quantidade: p.quantidade || 0,
          preco_unitario: p.valor_unitario || 0,
          total: (p.quantidade || 0) * (p.valor_unitario || 0),
          desconto: p.desconto || 0,
          liquido: p.valor_total || ((p.quantidade || 0) * (p.valor_unitario || 0) - (p.desconto || 0)),
          lote_origem_id: p.lote_origem_id || '',
          lote_origem_info: p.lote_origem_info || null,
          modo_custo_saida: p.modo_custo_saida || null,
          rateio_lotes: p.rateio_lotes || null,
          observacao_item: p.observacao_item || ''
        };
      });

      setItens(loadedItems);
      
      if (loadedItems.length > 0) {
        const firstItem = loadedItems[0];
        setCurrentItem({
          produto_id: firstItem.produto_id,
          produto_nome: firstItem.produto_nome,
          produto_codigo: firstItem.produto_codigo,
          unidade: firstItem.unidade,
          quantidade: formatarNumero(firstItem.quantidade),
          preco_unitario: formatarMoedaBR(firstItem.preco_unitario),
          total: formatarMoedaBR(firstItem.total),
          desconto: formatarMoedaBR(firstItem.desconto),
          liquido: formatarMoedaBR(firstItem.liquido),
          lote_origem_id: firstItem.lote_origem_id,
          lote_origem_info: firstItem.lote_origem_info,
          rateio_lotes: firstItem.rateio_lotes,
          observacao_item: firstItem.observacao_item
        });
        setEditingIndex(0);
      }

      setItensCarregados(true);
    } else if (initialData.produto_id && produtos.length > 0) {
      const prod = produtos.find(p => p.id === initialData.produto_id);
      if (prod) {
        const itemInicial = {
          produto_id: initialData.produto_id,
          produto_nome: prod.nome_produto,
          produto_codigo: prod.codigo_interno || prod.codigo_barras || '',
          unidade: initialData.unidade_medida || prod.unidade_medida || 'UN',
          quantidade: initialData.quantidade || 0,
          preco_unitario: initialData.valor_unitario || 0,
          total: (initialData.quantidade || 0) * (initialData.valor_unitario || 0),
          desconto: 0,
          liquido: initialData.valor_total || (initialData.quantidade || 0) * (initialData.valor_unitario || 0),
          lote_origem_id: '',
          lote_origem_info: null,
          modo_custo_saida: null,
          rateio_lotes: null,
          observacao_item: ''
        };
        setItens([itemInicial]);
        setCurrentItem({
          produto_id: itemInicial.produto_id,
          produto_nome: itemInicial.produto_nome,
          produto_codigo: itemInicial.produto_codigo,
          unidade: itemInicial.unidade,
          quantidade: formatarNumero(itemInicial.quantidade),
          preco_unitario: formatarMoedaBR(itemInicial.preco_unitario),
          total: formatarMoedaBR(itemInicial.total),
          desconto: formatarMoedaBR(itemInicial.desconto),
          liquido: formatarMoedaBR(itemInicial.liquido),
          lote_origem_id: itemInicial.lote_origem_id,
          lote_origem_info: itemInicial.lote_origem_info,
          rateio_lotes: itemInicial.rateio_lotes,
          observacao_item: itemInicial.observacao_item
        });
        setEditingIndex(0);
        setItensCarregados(true);
      }
    }
  }, [initialData, produtos, itensCarregados]);

  // Clientes = fornecedores com tipo Cliente
  const clientes = useMemo(() => {
    return fornecedores.filter(f => f.tipos?.includes('Cliente') || f.tipos?.includes('Fornecedor'));
  }, [fornecedores]);

  // Produtos disponíveis para saída/transferência (apenas os que tem saldo no local origem)
  const produtosDisponiveisOrigem = useMemo(() => {
    if (tipo !== 'SAIDA' && tipo !== 'TRANSFERENCIA') return produtos;
    if (!localEstoqueOrigemId) return [];
    
    const saldosPorProduto = {};
    lotesNota
      .filter(l => l.local_estoque_id === localEstoqueOrigemId && l.quantidade_disponivel > 0 && l.status === 'Disponivel')
      .forEach(l => {
        if (!saldosPorProduto[l.produto_id]) {
          saldosPorProduto[l.produto_id] = 0;
        }
        saldosPorProduto[l.produto_id] += l.quantidade_disponivel || 0;
      });
    
    return produtos.filter(p => (saldosPorProduto[p.id] || 0) > 0);
  }, [tipo, localEstoqueOrigemId, lotesNota, produtos]);

  // ========== COMPUTED ==========
  const operacoesDisponiveis = useMemo(() => {
    return OPERACOES_POR_TIPO[tipo] || [];
  }, [tipo]);

  const operacaoSelecionada = useMemo(() => {
    return operacoesDisponiveis.find(op => op.value === operacao);
  }, [operacoesDisponiveis, operacao]);

  // Quando mostrar documento/NF-e
  const mostrarDocumento = useMemo(() => {
    return operacaoSelecionada?.exigeDocumento || false;
  }, [operacaoSelecionada]);

  // Quando mostrar motivo
  const exigeMotivo = useMemo(() => {
    return operacaoSelecionada?.exigeMotivo || false;
  }, [operacaoSelecionada]);

  // Quando mostrar motivo de perda (específico)
  const exigeMotivoPerda = useMemo(() => {
    return operacao === 'perda_quebra';
  }, [operacao]);

  const exigeVinculo = operacaoSelecionada?.exigeVinculo || false;
  const exigeFornecedor = operacaoSelecionada?.exigeFornecedor || false;
  const exigeDestino = operacaoSelecionada?.exigeDestino || false;
  
  const precoEditavel = useMemo(() => {
    if (tipo === 'ENTRADA' || tipo === 'AJUSTE') return true;
    return operacaoSelecionada?.precoEditavel ?? false;
  }, [tipo, operacaoSelecionada]);

  // Saldo do produto no local origem
  const saldoProdutoNoLocal = useMemo(() => {
    const precisaValidarSaldo = tipo === 'SAIDA' || tipo === 'TRANSFERENCIA' || 
      (tipo === 'AJUSTE' && operacao === 'ajuste_negativo');
    
    if (!precisaValidarSaldo || !currentItem.produto_id || !localEstoqueOrigemId) return null;
    return calcularSaldoProdutoLocal(lotesNota, currentItem.produto_id, localEstoqueOrigemId);
  }, [tipo, operacao, currentItem.produto_id, localEstoqueOrigemId, lotesNota]);

  // Lotes disponíveis do produto no local origem
  const lotesDisponiveis = useMemo(() => {
    if (!currentItem.produto_id || !localEstoqueOrigemId) return [];
    return lotesNota
      .filter(l => l.produto_id === currentItem.produto_id && l.local_estoque_id === localEstoqueOrigemId && l.quantidade_disponivel > 0)
      .sort((a, b) => new Date(a.data_documento || a.created_date || 0) - new Date(b.data_documento || b.created_date || 0));
  }, [currentItem.produto_id, localEstoqueOrigemId, lotesNota]);

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
    if (itens.length > 0 && novoTipo !== tipo) {
      setPendingTipo(novoTipo);
      setShowConfirmTipoChange(true);
    } else {
      aplicarTrocaTipo(novoTipo);
    }
  };

  const aplicarTrocaTipo = (novoTipo) => {
    setTipo(novoTipo);
    setOperacao('');
    // NÃO zerar currentItem nem itens aqui
  };

  const confirmarTrocaTipo = () => {
    setItens([]);
    resetCurrentItem();
    aplicarTrocaTipo(pendingTipo);
    setShowConfirmTipoChange(false);
    setPendingTipo(null);
  };

  const cancelarTrocaTipo = () => {
    setShowConfirmTipoChange(false);
    setPendingTipo(null);
  };

  const handleLocalOrigemChange = (novoLocalId) => {
    const localAnterior = localEstoqueOrigemId;
    setLocalEstoqueOrigemId(novoLocalId);
    const l = locais.find(x => x.id === novoLocalId);
    setLocalEstoqueOrigemNome(l?.nome || '');
    
    // Se mudou o local e tem produto selecionado, validar
    if ((tipo === 'SAIDA' || tipo === 'TRANSFERENCIA') && currentItem.produto_id && novoLocalId && novoLocalId !== localAnterior) {
      const saldoNoNovoLocal = calcularSaldoProdutoLocal(lotesNota, currentItem.produto_id, novoLocalId);
      
      if (saldoNoNovoLocal <= 0) {
        setCurrentItem(prev => ({
          ...prev,
          produto_id: '',
          produto_nome: '',
          produto_codigo: '',
          unidade: '',
          preco_unitario: '',
          total: '',
          liquido: '',
          lote_origem_id: '',
          lote_origem_info: null,
          rateio_lotes: []
        }));
        toast.warning('Produto não disponível neste local. Selecione outro produto.');
      } else if (currentItem.lote_origem_id) {
        const loteAtual = lotesNota.find(l => l.id === currentItem.lote_origem_id);
        if (loteAtual && loteAtual.local_estoque_id !== novoLocalId) {
          setCurrentItem(prev => ({
            ...prev,
            lote_origem_id: '',
            lote_origem_info: null,
            rateio_lotes: [],
            preco_unitario: '',
            total: '',
            liquido: ''
          }));
          toast.info('Lote anterior não pertence a este local. Selecione um novo lote.');
        }
      }
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
      rateio_lotes: [],
      observacao_item: ''
    });
    setEditingIndex(null);
  };

  // Função para calcular rateio FIFO
  const calcularRateioFIFO = (produtoId, quantidadeSolicitada) => {
    if (!produtoId || !localEstoqueOrigemId || quantidadeSolicitada <= 0) {
      return { sucesso: false, erro: 'Dados inválidos', rateio: [], custoMedioPonderado: 0 };
    }

    const lotesOrdenados = lotesNota
      .filter(l => l.produto_id === produtoId && l.local_estoque_id === localEstoqueOrigemId && l.quantidade_disponivel > 0)
      .sort((a, b) => {
        const dataA = new Date(a.data_documento || a.created_date || 0);
        const dataB = new Date(b.data_documento || b.created_date || 0);
        return dataA - dataB;
      });

    const saldoTotal = lotesOrdenados.reduce((sum, l) => sum + (l.quantidade_disponivel || 0), 0);
    
    if (quantidadeSolicitada > saldoTotal) {
      return { 
        sucesso: false, 
        erro: `Quantidade (${formatarNumero(quantidadeSolicitada)}) maior que saldo disponível (${formatarNumero(saldoTotal)})`, 
        rateio: [], 
        custoMedioPonderado: 0 
      };
    }

    const rateio = [];
    let qtdRestante = quantidadeSolicitada;
    let custoTotal = 0;

    for (const lote of lotesOrdenados) {
      if (qtdRestante <= 0) break;

      const consumo = Math.min(qtdRestante, lote.quantidade_disponivel);
      const custoLote = lote.custo_unitario || 0;

      rateio.push({
        lote_id: lote.id,
        numero_documento: lote.numero_documento || 'S/N',
        serie_documento: lote.serie_documento || '',
        data_documento: lote.data_documento,
        fornecedor_nome: lote.fornecedor_nome,
        quantidade_consumida: consumo,
        custo_unitario: custoLote,
        valor_total: consumo * custoLote
      });

      custoTotal += consumo * custoLote;
      qtdRestante -= consumo;
    }

    const custoMedioPonderado = quantidadeSolicitada > 0 ? custoTotal / quantidadeSolicitada : 0;

    return { sucesso: true, erro: null, rateio, custoMedioPonderado, custoTotal };
  };

  const handleProdutoChange = (produtoId) => {
    console.log('handleProdutoChange chamado com:', produtoId);
    console.log('Produtos disponíveis:', produtos.length);
    
    const prod = produtos.find(p => p.id === produtoId);
    console.log('Produto encontrado:', prod);
    
    if (!prod) {
      resetCurrentItem();
      return;
    }

    let precoInicial = 0;
    if (tipo === 'ENTRADA' || tipo === 'AJUSTE') {
      precoInicial = prod.preco_custo || 0;
    } else if (tipo === 'SAIDA') {
      if (operacao === 'venda') {
        precoInicial = prod.preco_venda || prod.preco_custo || 0;
      } else {
        precoInicial = prod.preco_custo || 0;
      }
    } else if (tipo === 'TRANSFERENCIA') {
      precoInicial = prod.preco_custo || 0;
    }

    console.log('Atualizando currentItem com:', {
      produto_id: produtoId,
      produto_nome: prod.nome_produto,
      produto_codigo: prod.codigo_interno || prod.codigo_barras || '',
      unidade: prod.unidade_medida || 'UN',
      preco_unitario: formatarMoedaBR(precoInicial),
    });

    setCurrentItem(prev => ({
      ...prev,
      produto_id: produtoId,
      produto_nome: prod.nome_produto,
      produto_codigo: prod.codigo_interno || prod.codigo_barras || '',
      unidade: prod.unidade_medida || 'UN',
      preco_unitario: formatarMoedaBR(precoInicial),
      lote_origem_id: '',
      lote_origem_info: null,
      rateio_lotes: []
    }));
  };

  const recalcularTotais = (qtdStr, precoStr, descontoStr) => {
    const qtd = parseNumeroBR(qtdStr);
    const preco = parseMoedaBR(precoStr);
    const desc = parseMoedaBR(descontoStr);
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

  const handleQuantidadeBlur = () => {
    const qtd = parseNumeroBR(currentItem.quantidade);
    if (qtd > 0) {
      setCurrentItem(prev => ({ ...prev, quantidade: formatarNumero(qtd) }));
    }

    // Se FIFO, recalcular rateio automaticamente
    const precisaFIFO = (tipo === 'SAIDA' || tipo === 'TRANSFERENCIA' || (tipo === 'AJUSTE' && operacao === 'ajuste_negativo'));
    if (modoCustoSaida === 'fifo' && precisaFIFO) {
      recalcularFIFO(qtd);
    }
  };

  const recalcularFIFO = (quantidade) => {
    if (!currentItem.produto_id || quantidade <= 0) return;

    const resultado = calcularRateioFIFO(currentItem.produto_id, quantidade);
    
    if (resultado.sucesso) {
      const desc = parseMoedaBR(currentItem.desconto);
      const total = quantidade * resultado.custoMedioPonderado;
      const liquido = Math.max(0, total - desc);

      setCurrentItem(prev => ({
        ...prev,
        preco_unitario: formatarMoedaBR(resultado.custoMedioPonderado),
        total: formatarMoedaBR(total),
        liquido: formatarMoedaBR(liquido),
        rateio_lotes: resultado.rateio,
        lote_origem_id: '',
        lote_origem_info: null
      }));
    } else {
      setCurrentItem(prev => ({
        ...prev,
        rateio_lotes: [],
        preco_unitario: formatarMoedaBR(0),
        total: formatarMoedaBR(0),
        liquido: formatarMoedaBR(0)
      }));
      if (resultado.erro) {
        toast.error(resultado.erro);
      }
    }
  };

  const handlePrecoChange = (valor) => {
    setCurrentItem(prev => ({ ...prev, preco_unitario: valor }));
  };

  const handlePrecoBlur = () => {
    const preco = parseMoedaBR(currentItem.preco_unitario);
    const { total, liquido } = recalcularTotais(currentItem.quantidade, preco, currentItem.desconto);
    setCurrentItem(prev => ({
      ...prev,
      preco_unitario: formatarMoedaBR(preco),
      total: formatarMoedaBR(total),
      liquido: formatarMoedaBR(liquido)
    }));
  };

  const handleDescontoChange = (valor) => {
    setCurrentItem(prev => ({ ...prev, desconto: valor }));
  };

  const handleDescontoBlur = () => {
    const desc = parseMoedaBR(currentItem.desconto);
    const { total, liquido } = recalcularTotais(currentItem.quantidade, currentItem.preco_unitario, desc);
    setCurrentItem(prev => ({
      ...prev,
      desconto: formatarMoedaBR(desc),
      total: formatarMoedaBR(total),
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
  };

  const handleAdicionarItem = () => {
    if (!currentItem.produto_id) {
      toast.error('Selecione um produto');
      return;
    }

    const qtd = parseNumeroBR(currentItem.quantidade);
    if (qtd <= 0) {
      toast.error('Informe uma quantidade válida');
      return;
    }

    const precisaSaida = tipo === 'SAIDA' || tipo === 'TRANSFERENCIA' || (tipo === 'AJUSTE' && operacao === 'ajuste_negativo');

    // Validar saldo
    if (precisaSaida) {
      if (modoCustoSaida === 'por_lote') {
        if (!currentItem.lote_origem_id) {
          toast.error('Selecione o lote/nota de origem');
          return;
        }
        const lote = lotesNota.find(l => l.id === currentItem.lote_origem_id);
        if (lote && qtd > lote.quantidade_disponivel) {
          toast.error(`Quantidade maior que o saldo do lote (${formatarNumero(lote.quantidade_disponivel)})`);
          return;
        }
      } else if (modoCustoSaida === 'fifo') {
        if (!currentItem.rateio_lotes || currentItem.rateio_lotes.length === 0) {
          const resultado = calcularRateioFIFO(currentItem.produto_id, qtd);
          if (!resultado.sucesso) {
            toast.error(resultado.erro || 'Saldo insuficiente para FIFO');
            return;
          }
          currentItem.rateio_lotes = resultado.rateio;
          currentItem.preco_unitario = formatarMoedaBR(resultado.custoMedioPonderado);
        }
        
        const qtdRateada = currentItem.rateio_lotes.reduce((sum, r) => sum + r.quantidade_consumida, 0);
        if (Math.abs(qtdRateada - qtd) > 0.001) {
          toast.error('Erro no cálculo FIFO. Ajuste a quantidade.');
          return;
        }
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
      lote_origem_id: modoCustoSaida === 'por_lote' ? (currentItem.lote_origem_id || null) : null,
      lote_origem_info: modoCustoSaida === 'por_lote' ? currentItem.lote_origem_info : null,
      modo_custo_saida: precisaSaida ? modoCustoSaida : null,
      rateio_lotes: modoCustoSaida === 'fifo' ? currentItem.rateio_lotes : null,
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
    
    if (item.modo_custo_saida && item.modo_custo_saida !== modoCustoSaida) {
      setModoCustoSaida(item.modo_custo_saida);
    }
    
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
      rateio_lotes: item.rateio_lotes || [],
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

    if (itens.length === 0) {
      toast.error('Adicione pelo menos um item');
      return;
    }

    // Validações por tipo
    if (tipo === 'ENTRADA') {
      if (!localEstoqueDestinoId) {
        toast.error('Selecione o local de destino');
        return;
      }
      if (exigeFornecedor && !fornecedorId) {
        toast.error('Selecione o fornecedor');
        return;
      }
      if (exigeDestino && !destinoTexto.trim()) {
        toast.error('Informe o cliente/destino');
        return;
      }
    }

    if (tipo === 'SAIDA') {
      if (!localEstoqueOrigemId) {
        toast.error('Selecione o local de origem');
        return;
      }
      if (exigeFornecedor && !fornecedorId) {
        toast.error('Selecione o fornecedor');
        return;
      }
      if (exigeDestino && !destinoTexto.trim() && !clienteId) {
        toast.error('Informe o cliente/destino');
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

    if (tipo === 'TRANSFERENCIA') {
      if (!localEstoqueOrigemId || !localEstoqueDestinoId) {
        toast.error('Selecione o local de origem e destino');
        return;
      }
      if (localEstoqueOrigemId === localEstoqueDestinoId) {
        toast.error('Local de origem e destino não podem ser iguais');
        return;
      }
    }

    if (tipo === 'AJUSTE') {
      if (operacao === 'ajuste_positivo' && !localEstoqueDestinoId) {
        toast.error('Selecione o local de ajuste');
        return;
      }
      if (operacao === 'ajuste_negativo' && !localEstoqueOrigemId) {
        toast.error('Selecione o local de ajuste');
        return;
      }
    }

    if (exigeMotivo && !motivoMovimentacao.trim()) {
      toast.error('Informe o motivo/justificativa');
      return;
    }

    if (exigeMotivoPerda && !motivoPerda) {
      toast.error('Selecione o motivo da perda');
      return;
    }

    // Preparar dados
    const fornecedor = fornecedores.find(f => f.id === fornecedorId);
    const cliente = clientes.find(c => c.id === clienteId);
    const localOrigem = locais.find(l => l.id === localEstoqueOrigemId);
    const localDestino = locais.find(l => l.id === localEstoqueDestinoId);
    const centro = centrosCusto.find(c => c.id === centroCustoId);

    const tipoMovimentacaoFinal = 
      tipo === 'ENTRADA' ? 'Entrada' : 
      tipo === 'SAIDA' ? 'Saída' : 
      tipo === 'TRANSFERENCIA' ? 'Transferência' : 'Ajuste';

    // Preparar locais usando função utilitária
    const locaisPreparados = prepararLocaisParaSalvar({
      tipo_movimentacao: tipoMovimentacaoFinal,
      tipo_detalhado: operacao,
      origemId: localEstoqueOrigemId,
      origemNome: localEstoqueOrigemNome,
      destinoId: localEstoqueDestinoId,
      destinoNome: localEstoqueDestinoNome,
      locais,
    });

    const dadosMovimentacao = {
      empresa_id: empresaId,
      tipo_movimentacao: tipoMovimentacaoFinal,
      tipo_detalhado: operacao,
      data_movimentacao: new Date(dataMovimentacao).toISOString(),
      
      // Locais (APENAS CAMPOS DO SCHEMA)
      ...locaisPreparados,
      
      // Documento
      tipo_documento: mostrarDocumento ? tipoDocumento : undefined,
      numero_documento: mostrarDocumento ? numeroDocumento : undefined,
      serie_documento: mostrarDocumento ? serieDocumento : undefined,
      data_documento: mostrarDocumento ? dataDocumento : undefined,
      chave_documento: mostrarDocumento ? chaveDocumento : undefined,
      cfop: mostrarDocumento ? cfop : undefined,
      natureza_operacao: mostrarDocumento ? naturezaOperacao : undefined,
      
      // Parceiros
      fornecedor_id: exigeFornecedor ? fornecedorId : undefined,
      fornecedor_nome: exigeFornecedor ? fornecedor?.nome : undefined,
      cliente_id: (tipo === 'SAIDA' && clienteId) ? clienteId : undefined,
      cliente_nome: (tipo === 'SAIDA' && (cliente?.nome || destinoTexto)) ? (cliente?.nome || destinoTexto) : undefined,
      destino_responsavel: (tipo === 'ENTRADA' && exigeDestino) ? destinoTexto : (tipo === 'SAIDA' ? destinoTexto : undefined),
      
      // Vínculo
      tipo_vinculo: (tipo === 'SAIDA' && exigeVinculo) ? tipoVinculo : undefined,
      vinculo_id: (tipo === 'SAIDA' && exigeVinculo) ? vinculoId : undefined,
      
      // Centro de Custo
      centro_custo_id: centroCustoId || undefined,
      centro_custo_nome: centro?.nome || undefined,
      
      // Motivos
      motivo_movimentacao: exigeMotivo ? motivoMovimentacao : undefined,
      motivo_perda: exigeMotivoPerda ? motivoPerda : undefined,
      
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
        modo_custo_saida: item.modo_custo_saida || null,
        lote_origem_id: item.lote_origem_id || null,
        custo_unitario_origem: item.lote_origem_info?.custo_unitario || null,
        rateio_lotes: item.rateio_lotes || null,
        observacao_item: item.observacao_item
      }))
    };

    onSubmit(dadosMovimentacao);
  };

  // Labels dinâmicos
  const labelLocalPrincipal = useMemo(() => {
    if (tipo === 'ENTRADA') return 'Local de Destino *';
    if (tipo === 'SAIDA') return 'Local de Origem *';
    if (tipo === 'TRANSFERENCIA') return 'Local de Origem *';
    if (tipo === 'AJUSTE') {
      return operacao === 'ajuste_positivo' ? 'Local de Entrada *' : 'Local de Saída *';
    }
    return 'Local *';
  }, [tipo, operacao]);

  // Determinar qual local usar como principal no grid (para compatibilidade)
  const localPrincipalId = useMemo(() => {
    if (tipo === 'ENTRADA') return localEstoqueDestinoId;
    if (tipo === 'SAIDA') return localEstoqueOrigemId;
    if (tipo === 'TRANSFERENCIA') return localEstoqueOrigemId;
    if (tipo === 'AJUSTE') {
      return operacao === 'ajuste_positivo' ? localEstoqueDestinoId : localEstoqueOrigemId;
    }
    return '';
  }, [tipo, operacao, localEstoqueOrigemId, localEstoqueDestinoId]);

  const handleLocalPrincipalChange = (novoLocalId) => {
    if (tipo === 'ENTRADA' || (tipo === 'AJUSTE' && operacao === 'ajuste_positivo')) {
      setLocalEstoqueDestinoId(novoLocalId);
      const l = locais.find(x => x.id === novoLocalId);
      setLocalEstoqueDestinoNome(l?.nome || '');
    } else {
      handleLocalOrigemChange(novoLocalId);
    }
  };

  const handleLocalDestinoChange = (novoLocalId) => {
    setLocalEstoqueDestinoId(novoLocalId);
    const l = locais.find(x => x.id === novoLocalId);
    setLocalEstoqueDestinoNome(l?.nome || '');
  };

  // Debug: log currentItem quando mudar
  useEffect(() => {
    console.log('currentItem atualizado:', currentItem);
  }, [currentItem]);

  // ========== RENDER ==========
  return (
    <>
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <form onSubmit={handleSubmit} className="space-y-2">
          
          {/* ========== CARD 1: CABEÇALHO ========== */}
          <Card className="shadow-sm border-slate-300">
            <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
              <CardTitle className="text-sm font-semibold text-slate-900">
                {initialData?.id ? 'Editar Movimentação' : 'Nova Movimentação de Estoque'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-1 space-y-1">
              
              {/* Linha 1: Tipo, Operação, Data, Local Principal */}
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-2 space-y-1">
                  <FL label="Tipo" required>
                    <Select value={tipo} onValueChange={handleTipoChange}>
                      <SelectTrigger className={fieldSelectTriggerClass}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ENTRADA" className="text-xs uppercase">ENTRADA</SelectItem>
                        <SelectItem value="SAIDA" className="text-xs uppercase">SAÍDA</SelectItem>
                        <SelectItem value="TRANSFERENCIA" className="text-xs uppercase">TRANSFERÊNCIA</SelectItem>
                        <SelectItem value="AJUSTE" className="text-xs uppercase">AJUSTE</SelectItem>
                      </SelectContent>
                    </Select>
                  </FL>
                </div>

                <div className="col-span-3 space-y-1">
                  <FL label="Operação" required>
                    <Select value={operacao} onValueChange={setOperacao}>
                      <SelectTrigger className={fieldSelectTriggerClass}>
                        <SelectValue placeholder="SELECIONE" />
                      </SelectTrigger>
                      <SelectContent>
                        {operacoesDisponiveis.map(op => (
                          <SelectItem key={op.value} value={op.value} className="text-xs uppercase">
                            {op.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FL>
                </div>

                <div className="col-span-2 space-y-1">
                  <FL label="Data" required>
                    <Input 
                      type="date" 
                      value={dataMovimentacao} 
                      onChange={(e) => setDataMovimentacao(e.target.value)}
                      className={fieldInputClass.replace('uppercase', '')}
                    />
                  </FL>
                </div>

                <div className="col-span-5 space-y-1">
                  <FL label={labelLocalPrincipal.replace(' *', '')} required>
                    <div className="px-0.5 py-0.5">
                      <AutocompleteGenerico
                        items={locais}
                        value={localPrincipalId}
                        onChange={handleLocalPrincipalChange}
                        placeholder="SELECIONE"
                        displayField="nome"
                        searchFields={["nome"]}
                        className="h-7"
                      />
                    </div>
                  </FL>
                </div>
              </div>

              {/* Linha 2: Local Destino (para TRANSFERÊNCIA) */}
              {tipo === 'TRANSFERENCIA' && (
                <div className="grid grid-cols-12 gap-2 pt-1 border-t">
                  <div className="col-span-6 space-y-1">
                    <FL label="Local de Destino" required>
                      <div className="px-0.5 py-0.5">
                        <AutocompleteGenerico
                          items={locais}
                          value={localEstoqueDestinoId}
                          onChange={handleLocalDestinoChange}
                          placeholder="SELECIONE O DESTINO"
                          displayField="nome"
                          searchFields={["nome"]}
                          className="h-7"
                        />
                      </div>
                    </FL>
                  </div>
                  <div className="col-span-6 space-y-1">
                    <FL label="Centro de Custo">
                      <div className="px-0.5 py-0.5">
                        <AutocompleteGenerico
                          items={centrosCusto}
                          value={centroCustoId}
                          onChange={setCentroCustoId}
                          placeholder="SELECIONE"
                          displayField="nome"
                          searchFields={["nome", "codigo"]}
                          className="h-7"
                        />
                      </div>
                    </FL>
                  </div>
                </div>
              )}

              {/* Linha 3: Documento/NF-e (quando exigido) */}
              {mostrarDocumento && (
                <div className="grid grid-cols-12 gap-2 pt-1 border-t">
                  <div className="col-span-2 space-y-1">
                    <FL label="Tipo Doc." required>
                      <Select value={tipoDocumento} onValueChange={setTipoDocumento}>
                        <SelectTrigger className={fieldSelectTriggerClass}>
                          <SelectValue placeholder="SELECIONE" />
                        </SelectTrigger>
                        <SelectContent>
                          {TIPOS_DOCUMENTO.map(t => (
                            <SelectItem key={t.value} value={t.value} className="text-xs uppercase">{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FL>
                  </div>

                  <div className="col-span-2 space-y-1">
                    <FL label="Nº Documento" required>
                      <Input 
                        value={numeroDocumento} 
                        onChange={(e) => setNumeroDocumento(e.target.value.toUpperCase())}
                        className={fieldInputClass}
                        placeholder="000000"
                      />
                    </FL>
                  </div>

                  <div className="col-span-1 space-y-1">
                    <FL label="Série">
                      <Input 
                        value={serieDocumento} 
                        onChange={(e) => setSerieDocumento(e.target.value.toUpperCase())}
                        className={fieldInputClass}
                        placeholder="001"
                      />
                    </FL>
                  </div>

                  <div className="col-span-2 space-y-1">
                    <FL label="Data Doc.">
                      <Input 
                        type="date"
                        value={dataDocumento} 
                        onChange={(e) => setDataDocumento(e.target.value)}
                        className={fieldInputClass.replace('uppercase', '')}
                      />
                    </FL>
                  </div>

                  <div className="col-span-2 space-y-1">
                    <FL label="CFOP">
                      <Input 
                        value={cfop} 
                        onChange={(e) => setCfop(e.target.value.toUpperCase())}
                        className={fieldInputClass}
                        placeholder="5102"
                      />
                    </FL>
                  </div>

                  <div className="col-span-3 space-y-1">
                    <FL label="Natureza Operação">
                      <Input 
                        value={naturezaOperacao} 
                        onChange={(e) => setNaturezaOperacao(e.target.value.toUpperCase())}
                        className={fieldInputClass}
                        placeholder="VENDA DE MERCADORIA"
                      />
                    </FL>
                  </div>

                  <div className="col-span-12 space-y-1">
                    <FL label="Chave NF-e">
                      <Input 
                        value={chaveDocumento} 
                        onChange={(e) => setChaveDocumento(e.target.value.toUpperCase())}
                        className={fieldInputClass}
                        placeholder="44 DÍGITOS"
                        maxLength={44}
                      />
                    </FL>
                  </div>
                </div>
              )}

              {/* Linha 4: Parceiros e Centro de Custo */}
              {tipo !== 'TRANSFERENCIA' && (
                <div className="grid grid-cols-12 gap-2 pt-1 border-t">
                  {/* Fornecedor */}
                  {exigeFornecedor && (
                    <div className="col-span-4 space-y-1">
                      <FL label="Fornecedor" required>
                        <div className="px-0.5 py-0.5">
                          <AutocompleteGenerico
                            items={fornecedores}
                            value={fornecedorId}
                            onChange={setFornecedorId}
                            placeholder="PESQUISAR..."
                            displayField="nome"
                            searchFields={["nome", "cnpj", "cpf"]}
                            className="h-7"
                          />
                        </div>
                      </FL>
                    </div>
                  )}

                  {/* Cliente */}
                  {(tipo === 'SAIDA' && operacao === 'venda') && (
                    <div className="col-span-4 space-y-1">
                      <FL label="Cliente" required>
                        <div className="px-0.5 py-0.5">
                          <AutocompleteGenerico
                            items={clientes}
                            value={clienteId}
                            onChange={(id) => {
                              setClienteId(id);
                              const cl = clientes.find(c => c.id === id);
                              if (cl) setDestinoTexto(cl.nome);
                            }}
                            placeholder="PESQUISAR..."
                            displayField="nome"
                            searchFields={["nome", "cnpj", "cpf"]}
                            className="h-7"
                          />
                        </div>
                      </FL>
                    </div>
                  )}

                  {/* Destino/Responsável (texto livre) */}
                  {exigeDestino && operacao !== 'venda' && (
                    <div className="col-span-3 space-y-1">
                      <FL label="Destino/Responsável" required>
                        <Input 
                          value={destinoTexto} 
                          onChange={(e) => setDestinoTexto(e.target.value.toUpperCase())}
                          className={fieldInputClass}
                          placeholder="NOME DO DESTINO..."
                        />
                      </FL>
                    </div>
                  )}

                  {/* Vínculo (SAIDA com operações específicas) */}
                  {exigeVinculo && (
                    <>
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Tipo Vínculo *</Label>
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

                      <div className="col-span-3 space-y-1">
                        <Label className="text-xs">Vínculo *</Label>
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
                        ) : tipoVinculo === 'funcionario' ? (
                          <Input 
                            value={vinculoId} 
                            onChange={(e) => setVinculoId(e.target.value)}
                            className="h-8 text-xs"
                            placeholder="Nome do funcionário..."
                          />
                        ) : (
                          <Input className="h-8 text-xs" disabled placeholder="Selecione o tipo" />
                        )}
                      </div>
                    </>
                  )}

                  {/* Centro de Custo (SEMPRE VISÍVEL exceto TRANSFERENCIA) */}
                  <div className="col-span-4 space-y-1">
                    <FL label="Centro de Custo" required={operacaoSelecionada?.exigeCentroCusto}>
                      <div className="px-0.5 py-0.5">
                        <AutocompleteGenerico
                          items={centrosCusto}
                          value={centroCustoId}
                          onChange={setCentroCustoId}
                          placeholder="SELECIONE"
                          displayField="nome"
                          searchFields={["nome", "codigo"]}
                          className="h-7"
                        />
                      </div>
                    </FL>
                  </div>
                </div>
              )}

              {/* Linha 5: Motivo Perda (específico para perda_quebra) */}
              {exigeMotivoPerda && (
                <div className="grid grid-cols-12 gap-2 pt-1 border-t">
                  <div className="col-span-4 space-y-1">
                    <Label className="text-xs">Motivo da Perda *</Label>
                    <Select value={motivoPerda} onValueChange={setMotivoPerda}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {MOTIVOS_PERDA.map(m => (
                          <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-8 space-y-1">
                    <Label className="text-xs">Detalhamento da Perda</Label>
                    <Input 
                      value={motivoMovimentacao} 
                      onChange={(e) => setMotivoMovimentacao(e.target.value)}
                      className="h-8 text-xs"
                      placeholder="Detalhes adicionais sobre a perda..."
                    />
                  </div>
                </div>
              )}

              {/* Linha 6: Motivo Geral (quando exigido e não for perda) */}
              {exigeMotivo && !exigeMotivoPerda && (
                <div className="grid grid-cols-12 gap-2 pt-1 border-t">
                  <div className="col-span-12 space-y-1">
                    <Label className="text-xs">Motivo/Justificativa *</Label>
                    <Textarea 
                      value={motivoMovimentacao} 
                      onChange={(e) => setMotivoMovimentacao(e.target.value)}
                      className="text-xs min-h-[50px]"
                      placeholder="Informe o motivo da movimentação..."
                      rows={2}
                    />
                  </div>
                </div>
              )}

              {/* Observações */}
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-12 space-y-1">
                  <FL label="Observações">
                    <Textarea 
                      value={observacoes} 
                      onChange={(e) => setObservacoes(e.target.value.toUpperCase())}
                      className={fieldTextareaClass.replace('min-h-[50px]', 'min-h-[40px]')}
                      rows={1}
                    />
                  </FL>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ========== CARD 2: ITENS ========== */}
          <Card className="shadow-sm border-slate-300">
            <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
              <CardTitle className="text-sm font-semibold text-slate-900">Itens / Produtos</CardTitle>
            </CardHeader>
            <CardContent className="p-1 space-y-1">
              
              {/* Aviso: selecionar local antes de produtos (SAÍDA/TRANSFERÊNCIA) */}
              {(tipo === 'SAIDA' || tipo === 'TRANSFERENCIA') && !localEstoqueOrigemId && (
                <div className="bg-yellow-50 border border-yellow-300 rounded p-2 text-xs text-yellow-800">
                  Selecione o <strong>Local de Origem</strong> para liberar a lista de produtos.
                </div>
              )}

              {/* Modo de custo (Saída/Transferência/Ajuste Negativo) */}
              {((tipo === 'SAIDA' && localEstoqueOrigemId) || 
                (tipo === 'TRANSFERENCIA' && localEstoqueOrigemId) || 
                (tipo === 'AJUSTE' && operacao === 'ajuste_negativo' && localEstoqueOrigemId)) && (
                <div className="bg-amber-50 border border-amber-200 rounded p-2">
                  <Label className="text-xs font-medium mb-1 block">Origem do Custo</Label>
                  <RadioGroup value={modoCustoSaida} onValueChange={setModoCustoSaida} className="flex gap-4">
                    <div className="flex items-center gap-1">
                      <RadioGroupItem value="por_lote" id="por_lote" />
                      <label htmlFor="por_lote" className="text-xs">Por Nota/Lote (manual)</label>
                    </div>
                    <div className="flex items-center gap-1">
                      <RadioGroupItem value="fifo" id="fifo" />
                      <label htmlFor="fifo" className="text-xs">Automático (FIFO)</label>
                    </div>
                  </RadioGroup>
                </div>
              )}

              {/* Formulário do Item */}
              <div className="bg-slate-50 border rounded p-2 space-y-2">
                {/* Linha 1: Produto, Quantidade, UN, Saldo */}
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-5 space-y-1">
                    <Label className="text-xs">Produto *</Label>
                    <AutocompleteGenerico
                      items={(tipo === 'SAIDA' || tipo === 'TRANSFERENCIA') ? produtosDisponiveisOrigem : produtos}
                      value={currentItem.produto_id}
                      onChange={handleProdutoChange}
                      placeholder={(tipo === 'SAIDA' || tipo === 'TRANSFERENCIA') && !localEstoqueOrigemId ? "Selecione o local primeiro" : "Pesquisar..."}
                      displayField="nome_produto"
                      searchFields={["nome_produto", "codigo_interno", "codigo_barras"]}
                      className="h-8"
                      disabled={(tipo === 'SAIDA' || tipo === 'TRANSFERENCIA') && !localEstoqueOrigemId}
                    />
                  </div>

                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Quantidade *</Label>
                    <Input 
                      value={currentItem.quantidade}
                      onChange={(e) => handleQuantidadeChange(e.target.value)}
                      onBlur={handleQuantidadeBlur}
                      className="h-8 text-xs text-right"
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

                  {saldoProdutoNoLocal !== null && currentItem.produto_id && (
                    <div className="col-span-4 space-y-1">
                      <Label className="text-xs">Saldo no Local</Label>
                      <div className="h-8 flex items-center">
                        <Badge variant={saldoProdutoNoLocal > 0 ? "default" : "destructive"} className="text-xs">
                          {formatarNumero(saldoProdutoNoLocal || 0)} {currentItem.unidade}
                        </Badge>
                      </div>
                    </div>
                  )}
                </div>

                {/* Seletor de Lote - MODO POR LOTE (manual) */}
                {((tipo === 'SAIDA' || tipo === 'TRANSFERENCIA' || (tipo === 'AJUSTE' && operacao === 'ajuste_negativo')) && 
                  modoCustoSaida === 'por_lote' && currentItem.produto_id && localEstoqueOrigemId) && (
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
                      <div className="text-xs text-red-600">
                        Nenhum lote disponível para este produto neste local
                      </div>
                    ) : (
                      <div className="max-h-28 overflow-auto border rounded">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs font-bold py-1 border-r border-slate-200 w-10">Sel.</TableHead>
                              <TableHead className="text-xs font-bold py-1 border-r border-slate-200 w-10">Documento</TableHead>
                             <TableHead className="text-xs font-bold py-1 border-r border-slate-200 w-10">Data</TableHead>
                              <TableHead className="text-xs font-bold py-1 border-r border-slate-200 w-10">Fornecedor</TableHead>
                              <TableHead className="text-xs font-bold py-1 border-r border-slate-200 w-10">Saldo</TableHead>
                              <TableHead className="text-xs font-bold py-1 border-r border-slate-200 w-10">Custo</TableHead>                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {lotesDisponiveis.map(lote => (
                              <TableRow 
                                key={lote.id} 
                                className={`cursor-pointer hover:bg-gray-50 ${currentItem.lote_origem_id === lote.id ? 'bg-emerald-100' : ''}`}
                                onClick={() => handleSelecionarLote(lote)}
                              >
                                <TableCell className="py-1 px-2 border border-gray-300">
                                  <input 
                                    type="radio" 
                                    checked={currentItem.lote_origem_id === lote.id}
                                    onChange={() => handleSelecionarLote(lote)}
                                  />
                                </TableCell>
                                <TableCell className="text-xs py-1 border border-gray-300">{lote.numero_documento || 'S/N'}/{lote.serie_documento || ''}</TableCell>
                                <TableCell className="text-xs py-1 border border-gray-300">{lote.data_documento ? new Date(lote.data_documento).toLocaleDateString('pt-BR') : '-'}</TableCell>
                                <TableCell className="text-xs py-1 border border-gray-300">{lote.fornecedor_nome || '-'}</TableCell>
                                <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarNumero(lote.quantidade_disponivel)}</TableCell>
                                <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarMoedaBR(lote.custo_unitario)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                )}

                {/* Exibição do Rateio FIFO (automático) */}
                {((tipo === 'SAIDA' || tipo === 'TRANSFERENCIA' || (tipo === 'AJUSTE' && operacao === 'ajuste_negativo')) && 
                  modoCustoSaida === 'fifo' && currentItem.produto_id && localEstoqueOrigemId) && (
                  <div className="bg-blue-50 border border-blue-200 rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs font-medium">Rateio FIFO (automático)</Label>
                      {currentItem.rateio_lotes && currentItem.rateio_lotes.length > 0 && (
                        <Badge variant="default" className="text-xs bg-blue-600">
                          {currentItem.rateio_lotes.length} lote(s) - Custo médio: {formatarMoedaBR(parseMoedaBR(currentItem.preco_unitario))}
                        </Badge>
                      )}
                    </div>
                    
                    {saldoProdutoNoLocal === 0 ? (
                      <div className="text-xs text-red-600">
                        Nenhum lote disponível para este produto neste local
                      </div>
                    ) : currentItem.rateio_lotes && currentItem.rateio_lotes.length > 0 ? (
                      <div className="max-h-28 overflow-auto border rounded bg-white">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs font-bold py-1 border border-black">Documento</TableHead>
                              <TableHead className="text-xs font-bold py-1 border border-black">Data</TableHead>
                              <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd Consumida</TableHead>
                              <TableHead className="text-xs font-bold py-1 border border-black text-right">Custo Unit.</TableHead>
                              <TableHead className="text-xs font-bold py-1 border border-black text-right">Valor</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {currentItem.rateio_lotes.map((rateio, idx) => (
                              <TableRow key={idx} className="hover:bg-gray-50">
                                <TableCell className="text-xs py-1 border border-gray-300">{rateio.numero_documento}/{rateio.serie_documento || ''}</TableCell>
                                <TableCell className="text-xs py-1 border border-gray-300">{rateio.data_documento ? new Date(rateio.data_documento).toLocaleDateString('pt-BR') : '-'}</TableCell>
                                <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarNumero(rateio.quantidade_consumida)}</TableCell>
                                <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarMoedaBR(rateio.custo_unitario)}</TableCell>
                                <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarMoedaBR(rateio.valor_total)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500">
                        Informe a quantidade para calcular o rateio automaticamente
                      </div>
                    )}
                  </div>
                )}

                {/* Linha 2: Valores */}
                <div className="grid grid-cols-5 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Preço Unit. (R$)</Label>
                    <Input 
                      value={currentItem.preco_unitario}
                      onChange={(e) => handlePrecoChange(e.target.value)}
                      onBlur={handlePrecoBlur}
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
                      onBlur={handleDescontoBlur}
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

                  <div className="space-y-1">
                    <Label className="text-xs">Obs. Item</Label>
                    <Input 
                      value={currentItem.observacao_item}
                      onChange={(e) => setCurrentItem(prev => ({ ...prev, observacao_item: e.target.value }))}
                      className="h-8 text-xs"
                      placeholder="Opcional"
                    />
                  </div>
                </div>

                {/* Botões do item */}
                <div className="flex gap-2 pt-1">
                  <Button 
                    type="button" 
                    size="sm" 
                    className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                    onClick={handleAdicionarItem}
                  >
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
          <Card className="shadow-sm border-slate-300">
            <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
              <CardTitle className="text-sm font-semibold text-slate-900">
                Itens Lançados ({itens.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-bold py-1 border border-black w-12">Ações</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Produto</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Código</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">UN</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Preço Unit.</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Total</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Desc.</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Líquido</TableHead>
                    {(tipo === 'SAIDA' || tipo === 'TRANSFERENCIA' || (tipo === 'AJUSTE' && operacao === 'ajuste_negativo')) && (
                      <TableHead className="text-xs font-bold py-1 border border-black">Origem</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itens.length === 0 ? (
                    <TableRow>
                      <TableCell
                        className="text-xs py-2 text-center text-slate-500"
                        colSpan={(tipo === 'SAIDA' || tipo === 'TRANSFERENCIA' || (tipo === 'AJUSTE' && operacao === 'ajuste_negativo')) ? 10 : 9}
                      >
                        Nenhum item adicionado ainda.
                      </TableCell>
                    </TableRow>
                  ) : (
                    itens.map((item, idx) => (
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
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-xs text-red-600" onClick={() => handleRemoverItem(idx)}>
                                Remover
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
                        {(tipo === 'SAIDA' || tipo === 'TRANSFERENCIA' || (tipo === 'AJUSTE' && operacao === 'ajuste_negativo')) && (
                          <TableCell className="text-xs py-1 border border-gray-300">
                            {item.modo_custo_saida === 'fifo' ? (
                              <span className="text-blue-600">
                                FIFO: {item.rateio_lotes?.map(r => `${r.numero_documento} (${formatarNumero(r.quantidade_consumida)})`).join(' + ') || '-'}
                              </span>
                            ) : (
                              item.lote_origem_info?.numero_documento || '-'
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              {/* Rodapé com totais */}
              <div className="bg-slate-100 p-2 border-t flex justify-end gap-6">
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

          {/* ========== BOTÕES DE AÇÃO ========== */}
          <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs">
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white">
              {initialData?.id ? 'Atualizar' : 'Salvar Movimentação'}
            </Button>
          </div>
        </form>
      </motion.div>

      {/* Dialog de confirmação ao trocar tipo */}
      <AlertDialog open={showConfirmTipoChange} onOpenChange={setShowConfirmTipoChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">Confirmar troca de tipo</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              Você tem {itens.length} item(ns) lançado(s). Ao trocar o tipo de movimentação, todos os itens serão removidos. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-xs" onClick={cancelarTrocaTipo}>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={confirmarTrocaTipo}>
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}