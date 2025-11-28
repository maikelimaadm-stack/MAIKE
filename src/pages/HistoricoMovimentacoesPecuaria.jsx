import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  ArrowRightLeft, X, Edit2, Trash2, Search, Calendar,
  TrendingUp, FileText, Filter, Settings, MoreVertical, GripVertical,
  ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Download, Plus
} from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import FormularioLancamentoManual from "@/components/pecuaria/FormularioLancamentoManual";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  const numericValue = typeof numero === 'string' ? parseFloat(numero.replace('.', '').replace(',', '.')) : numero;
  if (isNaN(numericValue)) return "0,00";
  return numericValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatarData = (dataString) => {
  if (!dataString) return '-';
  try {
    const date = new Date(dataString);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '-';
  }
};

const formatarDataSimples = (dataString) => {
  if (!dataString) return '-';
  try {
    const date = new Date(dataString);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('pt-BR');
  } catch {
    return '-';
  }
};

const COLUNAS_DISPONIVEIS = [
  { id: 'data', label: 'Data', default: true, sortable: true },
  { id: 'tipo', label: 'Tipo', default: true, sortable: true },
  { id: 'empresa', label: 'Fazenda', default: false, sortable: false },
  { id: 'lote', label: 'Lote', default: true, sortable: true },
  { id: 'quantidade', label: 'Quantidade', default: true, sortable: true },
  { id: 'categoria', label: 'Categoria', default: true, sortable: false },
  { id: 'marca', label: 'Marca', default: true, sortable: false },
  { id: 'peso_medio', label: 'Peso Médio (kg)', default: false, sortable: false },
  { id: 'area_origem', label: 'Área Origem', default: true, sortable: false },
  { id: 'codigo_area_origem', label: 'Código Área Origem', default: false, sortable: false },
  { id: 'area_destino', label: 'Área Destino', default: true, sortable: false },
  { id: 'codigo_area_destino', label: 'Código Área Destino', default: false, sortable: false },
  { id: 'categoria_origem', label: 'Categoria Origem', default: false, sortable: false },
  { id: 'categoria_destino', label: 'Categoria Destino', default: false, sortable: false },
  { id: 'sexo', label: 'Sexo', default: false, sortable: false },
  { id: 'causa_morte', label: 'Causa Morte', default: false, sortable: false },
  { id: 'destino_abate', label: 'Destino Abate', default: false, sortable: false },
  { id: 'peso_vivo', label: 'Peso Vivo (kg)', default: false, sortable: false },
  { id: 'peso_carcaca', label: 'Peso Carcaça (kg)', default: false, sortable: false },
  { id: 'observacoes', label: 'Observações', default: false, sortable: false },
  { id: 'responsavel', label: 'Responsável', default: false, sortable: false },
];

const ITEMS_PER_PAGE = 50;

const tipoColors = {
  'Entrada': 'bg-green-100 text-green-800 border-green-300',
  'Saída': 'bg-red-100 text-red-800 border-red-300',
  'Transferência de Área': 'bg-blue-100 text-blue-800 border-blue-300',
  'Venda': 'bg-red-100 text-red-800 border-red-300',
  'Compra': 'bg-green-100 text-green-800 border-green-300',
  'Morte': 'bg-gray-100 text-gray-800 border-gray-300',
  'Nascimento': 'bg-emerald-100 text-emerald-800 border-emerald-300',
  'Abate': 'bg-orange-100 text-orange-800 border-orange-300',
  'Mudança de Categoria': 'bg-purple-100 text-purple-800 border-purple-300',
  'Pesagem': 'bg-cyan-100 text-cyan-800 border-cyan-300',
};

export default function HistoricoMovimentacoesPecuaria() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();
  
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [editando, setEditando] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deletarId, setDeletarId] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [showNovoLancamento, setShowNovoLancamento] = useState(false);
  const [itemEditandoManual, setItemEditandoManual] = useState(null);

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_movimentacoes_pecuaria');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem('colunas_ordem_movimentacoes_pecuaria');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.map(c => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.map(c => c.id);
  });

  const [sortField, setSortField] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');

  const { data: movimentacoes = [], isLoading } = useQuery({
    queryKey: ['movimentacoes-pecuaria', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoPecuaria.list('-created_date');
      return all.filter(m => m.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      return await base44.entities.MovimentacaoPecuaria.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-pecuaria'] });
      toast.success('Movimentação atualizada');
      setShowEdit(false);
      setEditando(null);
    },
    onError: () => {
      toast.error('Erro ao atualizar movimentação');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      return await base44.entities.MovimentacaoPecuaria.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-pecuaria'] });
      toast.success('Movimentação excluída');
      setShowDelete(false);
      setDeletarId(null);
    },
    onError: () => {
      toast.error('Erro ao excluir movimentação');
    }
  });

  const handleBulkDelete = async () => {
    if (window.confirm(`⚠️ ATENÇÃO: Você está prestes a excluir ${selectedItems.length} movimentação(ões). Esta ação não pode ser desfeita. Deseja continuar?`)) {
      for (const id of selectedItems) {
        try {
          await base44.entities.MovimentacaoPecuaria.delete(id);
        } catch (error) {
          console.error('Erro ao excluir:', error);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-pecuaria'] });
      toast.success('Movimentações excluídas');
      setSelectedItems([]);
    }
  };

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId)
        ? prev.filter(id => id !== colunaId)
        : [...prev, colunaId];
      
      localStorage.setItem('colunas_movimentacoes_pecuaria', JSON.stringify(novasColunas));
      return novasColunas;
    });
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    
    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    setColunasOrdem(items);
    localStorage.setItem('colunas_ordem_movimentacoes_pecuaria', JSON.stringify(items));
  };

  const colunasOrdenadas = colunasOrdem
    .map(id => COLUNAS_DISPONIVEIS.find(c => c.id === id))
    .filter(c => c && colunasVisiveis.includes(c.id));

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 ml-1" />
      : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  const filteredMovimentacoes = movimentacoes.filter(mov => {
    const searchLower = searchTerm.toLowerCase();
    return (
      mov.tipo?.toLowerCase().includes(searchLower) ||
      mov.lote?.toLowerCase().includes(searchLower) ||
      mov.area_origem_nome?.toLowerCase().includes(searchLower) ||
      mov.area_destino_nome?.toLowerCase().includes(searchLower) ||
      mov.observacoes?.toLowerCase().includes(searchLower)
    );
  });

  const sortedMovimentacoes = [...filteredMovimentacoes].sort((a, b) => {
    if (!sortField) return 0;

    let aValue, bValue;

    switch (sortField) {
      case 'data':
        aValue = new Date(a.data_movimentacao).getTime();
        bValue = new Date(b.data_movimentacao).getTime();
        break;
      case 'tipo':
        aValue = a.tipo;
        bValue = b.tipo;
        break;
      case 'lote':
        aValue = a.lote;
        bValue = b.lote;
        break;
      case 'quantidade':
        aValue = a.quantidade_animais;
        bValue = b.quantidade_animais;
        break;
      default:
        return 0;
    }

    if (typeof aValue === 'string') {
      aValue = aValue.toLowerCase();
      bValue = bValue.toLowerCase();
    }

    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(sortedMovimentacoes.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedMovimentacoes = sortedMovimentacoes.slice(startIndex, endIndex);

  const toggleSelectAll = () => {
    if (selectedItems.length === paginatedMovimentacoes.length && paginatedMovimentacoes.length > 0) {
      setSelectedItems([]);
    } else {
      setSelectedItems(paginatedMovimentacoes.map(m => m.id));
    }
  };

  const toggleSelectItem = (id) => {
    setSelectedItems(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleEdit = (mov) => {
    setEditando({ ...mov });
    setShowEdit(true);
  };

  const handleDelete = (id) => {
    setDeletarId(id);
    setShowDelete(true);
  };

  const handleSaveEdit = () => {
    if (!editando) return;
    updateMutation.mutate({
      id: editando.id,
      data: {
        data_movimentacao: editando.data_movimentacao,
        quantidade_animais: editando.quantidade_animais,
        peso_medio: editando.peso_medio,
        observacoes: editando.observacoes
      }
    });
  };

  const confirmDelete = () => {
    if (deletarId) {
      deleteMutation.mutate(deletarId);
    }
  };

  const handleExport = () => {
    const csvRows = [];
    const headers = ['Data/Hora', 'Tipo', 'Lote', 'Quantidade', 'Peso Médio', 'Área Origem', 'Área Destino', 'Observações'];
    csvRows.push(headers.join(';'));

    movimentacoes.forEach(m => {
      const row = [
        formatarData(m.data_movimentacao),
        m.tipo,
        m.lote,
        m.quantidade_animais,
        m.peso_medio || '',
        m.area_origem_nome || '',
        m.area_destino_nome || '',
        m.observacoes || ''
      ];
      csvRows.push(row.join(';'));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `movimentacoes_pecuaria_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.csv`;
    link.click();
    toast.success('Exportado!');
  };

  const extrairDadosObservacoes = (obs) => {
    if (!obs) return {};

    const dados = {};

    // Categoria
    const catMatch = obs.match(/Categoria[:\s]+([^.]+)/i);
    if (catMatch) dados.categoria = catMatch[1].trim();

    // De X para Y (mudança de categoria)
    const mudancaMatch = obs.match(/De\s+([^p]+)\s+para\s+([^.]+)/i);
    if (mudancaMatch) {
      dados.categoria_origem = mudancaMatch[1].trim();
      dados.categoria_destino = mudancaMatch[2].trim();
    }

    // Categoria mãe
    const catMaeMatch = obs.match(/Categoria mãe[:\s]+([^.]+)/i);
    if (catMaeMatch) dados.categoria_mae = catMaeMatch[1].trim();

    // Categoria filhote
    const catFilhoteMatch = obs.match(/Categoria filhote[:\s]+([^.]+)/i);
    if (catFilhoteMatch) dados.categoria_filhote = catFilhoteMatch[1].trim();

    // Sexo
    const sexoMatch = obs.match(/Sexo[:\s]+([^.]+)/i);
    if (sexoMatch) dados.sexo = sexoMatch[1].trim();

    // Causa
    const causaMatch = obs.match(/Causa[:\s]+([^.]+)/i);
    if (causaMatch) dados.causa = causaMatch[1].trim();

    // Destino
    const destinoMatch = obs.match(/Destino[:\s]+([^.]+)/i);
    if (destinoMatch) dados.destino = destinoMatch[1].trim();

    // Peso vivo
    const pesoVivoMatch = obs.match(/Peso vivo[:\s]+([0-9.,]+)/i);
    if (pesoVivoMatch) dados.peso_vivo = pesoVivoMatch[1].trim();

    // Peso carcaça
    const pesoCarcacaMatch = obs.match(/Peso carcaça[:\s]+([0-9.,]+)/i);
    if (pesoCarcacaMatch) dados.peso_carcaca = pesoCarcacaMatch[1].trim();

    // Peso anterior
    const pesoAnteriorMatch = obs.match(/Peso anterior[:\s]+([0-9.,]+)/i);
    if (pesoAnteriorMatch) dados.peso_anterior = pesoAnteriorMatch[1].trim();

    // Ganho
    const ganhoMatch = obs.match(/Ganho[:\s]+([0-9.,+-]+)/i);
    if (ganhoMatch) dados.ganho = ganhoMatch[1].trim();

    return dados;
  };

  const { data: empresas = [] } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => base44.entities.Empresa.list(),
    initialData: [],
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas-pastagem'],
    queryFn: () => base44.entities.AreaPastagem.list(),
    initialData: [],
  });

  const renderCell = (coluna, mov) => {
    const dadosObs = extrairDadosObservacoes(mov.observacoes);
    
    switch (coluna.id) {
      case 'data':
        return <TableCell className="text-xs border-r border-slate-200">{formatarDataSimples(mov.data_movimentacao)}</TableCell>;
      case 'tipo':
        return (
          <TableCell className="border-r border-slate-200">
            <Badge variant="outline" className={`${tipoColors[mov.tipo] || 'bg-slate-100 text-slate-800'} text-xs`}>
              {mov.tipo}
            </Badge>
          </TableCell>
        );
      case 'empresa':
        const empresa = empresas.find(e => e.id === mov.empresa_id);
        return <TableCell className="text-xs font-semibold border-r border-slate-200">{empresa?.apelido || empresa?.nome || '-'}</TableCell>;
      case 'lote':
        return <TableCell className="text-xs font-semibold border-r border-slate-200">{mov.lote || '-'}</TableCell>;
      case 'quantidade':
        return <TableCell className="text-right font-mono font-semibold text-emerald-700 text-xs border-r border-slate-200">{mov.quantidade_animais} cab</TableCell>;
      case 'categoria':
        return <TableCell className="text-xs border-r border-slate-200">{mov.categoria_animal || '-'}</TableCell>;
      case 'marca':
        return <TableCell className="text-xs font-semibold text-blue-700 border-r border-slate-200">{mov.marca || '-'}</TableCell>;
      case 'peso_medio':
        return <TableCell className="text-right font-mono text-xs border-r border-slate-200">{mov.peso_medio ? formatarNumero(mov.peso_medio) : '-'}</TableCell>;
      case 'area_origem':
        return <TableCell className="text-xs max-w-[120px] truncate border-r border-slate-200">{mov.area_origem_nome || '-'}</TableCell>;
      case 'codigo_area_origem':
        const areaOrigem = areas.find(a => a.id === mov.area_origem_id);
        return <TableCell className="text-xs font-mono border-r border-slate-200">{areaOrigem?.codigo || '-'}</TableCell>;
      case 'area_destino':
        return <TableCell className="text-xs max-w-[120px] truncate border-r border-slate-200">{mov.area_destino_nome || '-'}</TableCell>;
      case 'codigo_area_destino':
        const areaDestino = areas.find(a => a.id === mov.area_destino_id);
        return <TableCell className="text-xs font-mono border-r border-slate-200">{areaDestino?.codigo || '-'}</TableCell>;
      case 'categoria_origem':
        return <TableCell className="text-xs border-r border-slate-200">{dadosObs.categoria_origem || dadosObs.categoria || '-'}</TableCell>;
      case 'categoria_destino':
        return <TableCell className="text-xs border-r border-slate-200">{dadosObs.categoria_destino || '-'}</TableCell>;
      case 'sexo':
        return <TableCell className="text-xs border-r border-slate-200">{dadosObs.sexo || '-'}</TableCell>;
      case 'causa_morte':
        return <TableCell className="text-xs border-r border-slate-200">{dadosObs.causa || '-'}</TableCell>;
      case 'destino_abate':
        return <TableCell className="text-xs border-r border-slate-200">{dadosObs.destino || '-'}</TableCell>;
      case 'peso_vivo':
        return <TableCell className="text-right font-mono text-xs border-r border-slate-200">{dadosObs.peso_vivo || '-'}</TableCell>;
      case 'peso_carcaca':
        return <TableCell className="text-right font-mono text-xs border-r border-slate-200">{dadosObs.peso_carcaca || '-'}</TableCell>;
      case 'observacoes':
        const dadosCompletos = extrairDadosObservacoes(mov.observacoes);
        return (
          <TableCell className="text-xs border-r border-slate-200">
            <div className="space-y-1 max-w-[300px]">
              {mov.tipo === 'Nascimento' && (
                <div className="space-y-0.5 bg-green-50 border border-green-200 rounded p-2">
                  {dadosCompletos.categoria_mae && <div><span className="font-semibold">Mãe:</span> {dadosCompletos.categoria_mae}</div>}
                  {dadosCompletos.sexo && <div><span className="font-semibold">Sexo:</span> {dadosCompletos.sexo}</div>}
                  {dadosCompletos.categoria_filhote && <div><span className="font-semibold">Categoria:</span> {dadosCompletos.categoria_filhote}</div>}
                  {mov.area_destino_nome && <div><span className="font-semibold">Área:</span> {mov.area_destino_nome}</div>}
                </div>
              )}
              {mov.tipo === 'Morte' && (
                <div className="space-y-0.5 bg-red-50 border border-red-200 rounded p-2">
                  {dadosCompletos.categoria && <div><span className="font-semibold">Categoria:</span> {dadosCompletos.categoria}</div>}
                  {dadosCompletos.sexo && <div><span className="font-semibold">Sexo:</span> {dadosCompletos.sexo}</div>}
                  {dadosCompletos.causa && <div><span className="font-semibold">Causa:</span> {dadosCompletos.causa}</div>}
                  {mov.area_origem_nome && <div><span className="font-semibold">Área:</span> {mov.area_origem_nome}</div>}
                </div>
              )}
              {mov.tipo === 'Abate' && (
                <div className="space-y-0.5 bg-orange-50 border border-orange-200 rounded p-2">
                  {dadosCompletos.categoria && <div><span className="font-semibold">Categoria:</span> {dadosCompletos.categoria}</div>}
                  {dadosCompletos.sexo && <div><span className="font-semibold">Sexo:</span> {dadosCompletos.sexo}</div>}
                  {dadosCompletos.peso_vivo && <div><span className="font-semibold">Peso vivo:</span> {dadosCompletos.peso_vivo}kg</div>}
                  {dadosCompletos.peso_carcaca && <div><span className="font-semibold">Carcaça:</span> {dadosCompletos.peso_carcaca}kg</div>}
                  {dadosCompletos.destino && <div><span className="font-semibold">Destino:</span> {dadosCompletos.destino}</div>}
                  {mov.area_origem_nome && <div><span className="font-semibold">Área:</span> {mov.area_origem_nome}</div>}
                </div>
              )}
              {mov.tipo === 'Mudança de Categoria' && dadosCompletos.categoria_origem && dadosCompletos.categoria_destino && (
                <div className="space-y-0.5 bg-purple-50 border border-purple-200 rounded p-2">
                  <div><span className="font-semibold">{dadosCompletos.categoria_origem}</span> → <span className="font-bold">{dadosCompletos.categoria_destino}</span></div>
                  {dadosCompletos.sexo && <div><span className="font-semibold">Sexo:</span> {dadosCompletos.sexo}</div>}
                  {mov.area_origem_nome && <div><span className="font-semibold">Área:</span> {mov.area_origem_nome}</div>}
                </div>
              )}
              {mov.tipo === 'Pesagem' && (
                <div className="space-y-0.5 bg-emerald-50 border border-emerald-200 rounded p-2">
                  {dadosCompletos.categoria && <div><span className="font-semibold">Categoria:</span> {dadosCompletos.categoria}</div>}
                  {dadosCompletos.sexo && <div><span className="font-semibold">Sexo:</span> {dadosCompletos.sexo}</div>}
                  {dadosCompletos.peso_anterior && <div><span className="font-semibold">Anterior:</span> {dadosCompletos.peso_anterior}kg</div>}
                  {dadosCompletos.ganho && <div><span className="font-semibold">Ganho:</span> {dadosCompletos.ganho}kg</div>}
                  {mov.area_origem_nome && <div><span className="font-semibold">Área:</span> {mov.area_origem_nome}</div>}
                </div>
              )}
              {mov.observacoes && !['Nascimento', 'Morte', 'Abate', 'Mudança de Categoria', 'Pesagem'].includes(mov.tipo) && (
                <div className="text-slate-600 truncate" title={mov.observacoes}>{mov.observacoes}</div>
              )}
            </div>
          </TableCell>
        );
      case 'responsavel':
        return <TableCell className="text-xs border-r border-slate-200">{mov.created_by || '-'}</TableCell>;
      default:
        return <TableCell className="text-xs border-r border-slate-200">-</TableCell>;
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-2">
      {!showNovoLancamento && (
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Histórico de Movimentações</h1>
            <p className="text-xs text-slate-600">Gerencie todo o histórico de movimentações pecuárias</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleExport} variant="outline" size="sm" className="h-8 gap-1 text-xs">
              <Download className="w-3.5 h-3.5" />
              Exportar
            </Button>
            <Button 
              onClick={() => { setItemEditandoManual(null); setShowNovoLancamento(true); }} 
              size="sm" 
              className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700"
            >
              <Plus className="w-3.5 h-3.5" />
              Novo Lançamento
            </Button>
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {showNovoLancamento && (
          <FormularioLancamentoManual
            item={itemEditandoManual}
            onSave={() => {
              setShowNovoLancamento(false);
              setItemEditandoManual(null);
              queryClient.invalidateQueries({ queryKey: ['movimentacoes-pecuaria'] });
            }}
            onCancel={() => {
              setShowNovoLancamento(false);
              setItemEditandoManual(null);
            }}
          />
        )}
      </AnimatePresence>

      {!showNovoLancamento && <Card className="shadow-sm border-slate-300">
        <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-sm font-semibold text-slate-900">
              Movimentações ({movimentacoes.length})
            </CardTitle>
            <div className="flex gap-2 items-center">
              {selectedItems.length > 0 && (
                <div className="flex items-center gap-2 bg-slate-100 border border-slate-300 rounded px-2 py-1">
                  <span className="text-xs font-semibold text-slate-800">
                    {selectedItems.length} selecionado(s)
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 px-1.5">
                        <MoreVertical className="w-4 h-4 text-slate-700" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleBulkDelete} className="text-xs text-red-600">
                        Excluir Todos
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setSelectedItems([])} className="text-xs">
                        Limpar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
              
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 h-8 w-48 text-xs" />
              </div>
              <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => setShowConfigColunas(true)}>
                <Settings className="w-3.5 h-3.5" />
                Colunas
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 border-b">
                  <TableHead className="w-8 text-xs border-r border-slate-200">
                    <Checkbox
                      checked={selectedItems.length === paginatedMovimentacoes.length && paginatedMovimentacoes.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead className="text-xs text-center w-8 border-r border-slate-200"></TableHead>
                  {colunasOrdenadas.map((coluna) => {
                    return (
                      <TableHead 
                        key={coluna.id}
                        className={`text-xs border-r border-slate-200 ${coluna.sortable ? 'cursor-pointer hover:bg-slate-100' : ''}`}
                        onClick={() => coluna.sortable && handleSort(coluna.id)}
                      >
                        <div className="flex items-center">
                          {coluna.label}
                          {coluna.sortable && getSortIcon(coluna.id)}
                        </div>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                <AnimatePresence>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={50} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell>
                    </TableRow>
                  ) : paginatedMovimentacoes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={50} className="text-center py-12 text-slate-400 text-xs">Nenhuma movimentação</TableCell>
                    </TableRow>
                  ) : (
                    paginatedMovimentacoes.map((mov) => (
                      <motion.tr 
                        key={mov.id}
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }} 
                        exit={{ opacity: 0 }} 
                        className="hover:bg-slate-50 transition-colors border-b"
                      >
                        <TableCell className="border-r border-slate-200">
                          <Checkbox
                            checked={selectedItems.includes(mov.id)}
                            onCheckedChange={() => toggleSelectItem(mov.id)}
                          />
                        </TableCell>
                        <TableCell className="text-center border-r border-slate-200">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
                                <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem 
                                onClick={() => { 
                                  setItemEditandoManual(mov); 
                                  setShowNovoLancamento(true); 
                                }} 
                                className="text-xs"
                              >
                                Editar Completo
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleEdit(mov)} className="text-xs">
                                Editar Rápido
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleDelete(mov.id)} className="text-xs text-red-600">
                                Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        {colunasOrdenadas.map(coluna => (
                          <React.Fragment key={coluna.id}>
                            {renderCell(coluna, mov)}
                          </React.Fragment>
                        ))}
                      </motion.tr>
                    ))
                  )}
                </AnimatePresence>
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
              <div className="text-xs text-slate-600">
                Mostrando {startIndex + 1} a {Math.min(endIndex, sortedMovimentacoes.length)} de {sortedMovimentacoes.length} registros
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="h-7 text-xs"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Anterior
                </Button>
                <span className="text-xs text-slate-600">
                  Página {currentPage} de {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="h-7 text-xs"
                >
                  Próxima
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>}

      <Dialog open={showConfigColunas} onOpenChange={setShowConfigColunas}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">Configurar Colunas</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-3 flex-1 overflow-auto">
            <div className="space-y-1">
              <p className="text-xs text-slate-600 font-semibold">Visibilidade</p>
              <div className="grid grid-cols-3 gap-2">
                {COLUNAS_DISPONIVEIS.map((coluna) => (
                  <label key={coluna.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                    <input
                      type="checkbox"
                      checked={colunasVisiveis.includes(coluna.id)}
                      onChange={() => toggleColuna(coluna.id)}
                      className="rounded"
                    />
                    <span>{coluna.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs text-slate-600 font-semibold mb-2">Ordem (arraste para reordenar)</p>
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="colunas">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-1">
                      {colunasOrdem.map((colunaId, index) => {
                        const coluna = COLUNAS_DISPONIVEIS.find(c => c.id === colunaId);
                        if (!coluna) return null;
                        
                        return (
                          <Draggable key={colunaId} draggableId={colunaId} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={`flex items-center gap-2 p-2 border rounded text-xs ${
                                  snapshot.isDragging ? 'bg-emerald-50 border-emerald-300' : 'bg-white'
                                } ${!colunasVisiveis.includes(colunaId) ? 'opacity-50' : ''}`}
                              >
                                <GripVertical className="w-4 h-4 text-slate-400" />
                                <span className="flex-1">{coluna.label}</span>
                                {colunasVisiveis.includes(colunaId) && (
                                  <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300">Visível</Badge>
                                )}
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="outline" onClick={() => setShowConfigColunas(false)} size="sm" className="h-7 text-xs">Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar Movimentação</DialogTitle>
          </DialogHeader>
          {editando && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Data</Label>
                  <Input
                    type="date"
                    value={editando.data_movimentacao?.split('T')[0] || ''}
                    onChange={(e) => setEditando({ ...editando, data_movimentacao: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Quantidade de Animais</Label>
                  <Input
                    type="number"
                    value={editando.quantidade_animais || ''}
                    onChange={(e) => setEditando({ ...editando, quantidade_animais: parseInt(e.target.value) || 0 })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              {editando.peso_medio !== undefined && (
                <div className="space-y-1">
                  <Label className="text-xs">Peso Médio (kg)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={editando.peso_medio || ''}
                    onChange={(e) => setEditando({ ...editando, peso_medio: parseFloat(e.target.value) || null })}
                    className="h-8 text-xs"
                  />
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs">Observações</Label>
                <Textarea
                  value={editando.observacoes || ''}
                  onChange={(e) => setEditando({ ...editando, observacoes: e.target.value })}
                  className="text-xs"
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button onClick={() => setShowEdit(false)} variant="outline" size="sm" className="h-8 text-xs">
                  Cancelar
                </Button>
                <Button onClick={handleSaveEdit} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                  Salvar Alterações
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar Exclusão</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Tem certeza que deseja excluir esta movimentação? Esta ação não pode ser desfeita.
            </p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setShowDelete(false)} variant="outline" size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button onClick={confirmDelete} size="sm" className="h-8 text-xs bg-red-600 hover:bg-red-700">
                Excluir
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}