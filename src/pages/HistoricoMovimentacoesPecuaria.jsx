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
  ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Download, Plus, Upload, FileSpreadsheet, AlertTriangle, Copy
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
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
import SaldoCategorias from "@/components/pecuaria/SaldoCategorias";

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
  { id: 'numero', label: 'Nº', default: true, sortable: true },
  { id: 'data', label: 'Data', default: true, sortable: true },
  { id: 'tipo', label: 'Tipo', default: true, sortable: true },
  { id: 'motivo', label: 'Motivo', default: true, sortable: true },
  { id: 'quantidade', label: 'Quantidade', default: true, sortable: true },
  { id: 'categoria', label: 'Categoria', default: true, sortable: true },
  { id: 'categoria_nova', label: 'Cat. Nova', default: false, sortable: true },
  { id: 'marca', label: 'Marca', default: true, sortable: true },
  { id: 'sexo', label: 'Sexo', default: false, sortable: true },
  { id: 'peso_medio', label: 'Peso Médio', default: false, sortable: true },
  { id: 'peso_total', label: 'Peso Total', default: false, sortable: true },
  { id: 'area', label: 'Área', default: true, sortable: true },
  { id: 'valor_unitario', label: 'Vlr. Unit.', default: false, sortable: true },
  { id: 'valor_total', label: 'Vlr. Total', default: false, sortable: true },
  { id: 'fornecedor', label: 'Fornec./Comprador', default: false, sortable: true },
  { id: 'nota_fiscal', label: 'Nota Fiscal', default: false, sortable: true },
  { id: 'gta', label: 'GTA', default: false, sortable: true },
  { id: 'causa_morte', label: 'Causa Morte', default: false, sortable: true },
  { id: 'destino_abate', label: 'Frigorífico', default: false, sortable: true },
  { id: 'transferencia_origem', label: 'Transf. Origem', default: false, sortable: true },
  { id: 'transferencia_destino', label: 'Transf. Destino', default: false, sortable: true },
  { id: 'observacoes', label: 'Observações', default: false, sortable: true },
  { id: 'responsavel', label: 'Responsável', default: false, sortable: true },
];

const ITEMS_PER_PAGE = 50;

const tipoColors = {
  'Entrada': 'bg-green-100 text-green-800 border-green-300',
  'Saída': 'bg-red-100 text-red-800 border-red-300',
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
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importErrors, setImportErrors] = useState([]);
  const [showImportErrors, setShowImportErrors] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, isImporting: false });

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
      // Mostrar APENAS movimentações manuais (sem lote_id E sem lote nome)
      return all.filter(m => 
        m.empresa_id === empresaSelecionadaId && 
        !m.lote_id &&
        !m.lote
      );
    },
    enabled: !!empresaSelecionadaId,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      // Buscar o registro para verificar se é mudança de categoria
      const registro = movimentacoes.find(m => m.id === id);
      
      await base44.entities.MovimentacaoPecuaria.update(id, data);
      
      // Se tem vínculo de mudança de categoria, atualizar também o registro vinculado
      if (registro?.vinculo_mudanca_categoria && data.quantidade_animais !== undefined) {
        const registroVinculado = movimentacoes.find(
          m => m.vinculo_mudanca_categoria === registro.vinculo_mudanca_categoria && m.id !== id
        );
        
        if (registroVinculado) {
          await base44.entities.MovimentacaoPecuaria.update(registroVinculado.id, {
            quantidade_animais: data.quantidade_animais,
            peso_medio: data.peso_medio,
            peso_total: data.peso_total,
          });
        }
        return { updatedCount: 2 };
      }
      
      return { updatedCount: 1 };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-pecuaria'] });
      toast.success(result?.updatedCount === 2 ? 'Mudança de categoria atualizada (saída + entrada)' : 'Movimentação atualizada');
      setShowEdit(false);
      setEditando(null);
    },
    onError: () => {
      toast.error('Erro ao atualizar movimentação');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      // Buscar o registro para verificar se é mudança de categoria
      const registro = movimentacoes.find(m => m.id === id);
      
      if (registro?.vinculo_mudanca_categoria) {
        // Se tem vínculo, excluir também o registro vinculado
        const registroVinculado = movimentacoes.find(
          m => m.vinculo_mudanca_categoria === registro.vinculo_mudanca_categoria && m.id !== id
        );
        
        await base44.entities.MovimentacaoPecuaria.delete(id);
        
        if (registroVinculado) {
          await base44.entities.MovimentacaoPecuaria.delete(registroVinculado.id);
        }
        return { deletedCount: registroVinculado ? 2 : 1 };
      }
      
      return await base44.entities.MovimentacaoPecuaria.delete(id);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-pecuaria'] });
      toast.success(result?.deletedCount === 2 ? 'Mudança de categoria excluída (saída + entrada)' : 'Movimentação excluída');
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
      case 'numero':
        aValue = parseInt(a.numero_movimentacao) || 0;
        bValue = parseInt(b.numero_movimentacao) || 0;
        break;
      case 'data':
        aValue = new Date(a.data_movimentacao).getTime();
        bValue = new Date(b.data_movimentacao).getTime();
        break;
      case 'tipo':
        aValue = a.tipo || '';
        bValue = b.tipo || '';
        break;
      case 'motivo':
        aValue = a.motivo || '';
        bValue = b.motivo || '';
        break;
      case 'quantidade':
        aValue = a.quantidade_animais || 0;
        bValue = b.quantidade_animais || 0;
        break;
      case 'categoria':
        aValue = a.categoria_animal || '';
        bValue = b.categoria_animal || '';
        break;
      case 'categoria_nova':
        aValue = a.categoria_nova || '';
        bValue = b.categoria_nova || '';
        break;
      case 'marca':
        aValue = a.marca || '';
        bValue = b.marca || '';
        break;
      case 'sexo':
        aValue = a.sexo || '';
        bValue = b.sexo || '';
        break;
      case 'peso_medio':
        aValue = a.peso_medio || 0;
        bValue = b.peso_medio || 0;
        break;
      case 'peso_total':
        aValue = a.peso_total || 0;
        bValue = b.peso_total || 0;
        break;
      case 'area':
        aValue = (a.tipo === 'Entrada' ? a.area_destino_nome : a.area_origem_nome) || '';
        bValue = (b.tipo === 'Entrada' ? b.area_destino_nome : b.area_origem_nome) || '';
        break;
      case 'valor_unitario':
        aValue = a.valor_unitario || 0;
        bValue = b.valor_unitario || 0;
        break;
      case 'valor_total':
        aValue = a.valor_total || 0;
        bValue = b.valor_total || 0;
        break;
      case 'fornecedor':
        aValue = a.fornecedor_origem || a.destino_venda || '';
        bValue = b.fornecedor_origem || b.destino_venda || '';
        break;
      case 'nota_fiscal':
        aValue = a.nota_fiscal || '';
        bValue = b.nota_fiscal || '';
        break;
      case 'gta':
        aValue = a.gta || '';
        bValue = b.gta || '';
        break;
      case 'causa_morte':
        aValue = a.causa_morte || '';
        bValue = b.causa_morte || '';
        break;
      case 'destino_abate':
        aValue = a.destino_abate || '';
        bValue = b.destino_abate || '';
        break;
      case 'transferencia_origem':
        aValue = a.transferencia_origem || '';
        bValue = b.transferencia_origem || '';
        break;
      case 'transferencia_destino':
        aValue = a.transferencia_destino || '';
        bValue = b.transferencia_destino || '';
        break;
      case 'observacoes':
        aValue = a.observacoes || '';
        bValue = b.observacoes || '';
        break;
      case 'responsavel':
        aValue = a.created_by || '';
        bValue = b.created_by || '';
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
    const headers = ['Data', 'Tipo', 'Motivo', 'Quantidade', 'Categoria', 'Marca', 'Sexo', 'Peso Médio', 'Peso Total', 'Área', 'Fornecedor/Comprador', 'Valor Unitário', 'Valor Total', 'NF', 'GTA', 'Causa Morte', 'Transferência Origem', 'Transferência Destino', 'Observações'];
    csvRows.push(headers.join(';'));

    movimentacoes.forEach(m => {
      const areaExibir = m.tipo === 'Entrada' ? m.area_destino_nome : m.area_origem_nome;
      const row = [
        formatarDataSimples(m.data_movimentacao),
        m.tipo || '',
        m.motivo || '',
        m.quantidade_animais || '',
        m.categoria_animal || '',
        m.marca || '',
        m.sexo || '',
        m.peso_medio || '',
        m.peso_total || '',
        areaExibir || '',
        m.fornecedor_origem || m.destino_venda || '',
        m.valor_unitario || '',
        m.valor_total || '',
        m.nota_fiscal || '',
        m.gta || '',
        m.causa_morte || '',
        m.transferencia_origem || '',
        m.transferencia_destino || '',
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
    toast.success('Exportado com sucesso!');
  };

  const handleDownloadTemplate = () => {
    const headers = ['Data', 'Tipo', 'Motivo', 'Quantidade', 'Categoria', 'Marca', 'Sexo', 'Peso Médio', 'Setor', 'Área', 'Fornecedor/Comprador', 'Valor Unitário', 'Valor Total', 'NF', 'GTA', 'Causa Morte', 'Transferência Origem', 'Transferência Destino', 'Observações'];
    const exemplo = ['01/01/2025', 'Entrada', 'Compra', '50', 'Bezerro(a)', 'NELORE', 'Macho', '180', 'Fazenda Santa Maria', 'Pasto 1', 'Fazenda XYZ', '1500', '75000', '12345', '67890', '', '', '', 'Lote de bezerros'];
    
    const csvRows = [headers.join(';'), exemplo.join(';')];
    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'modelo_importacao_movimentacoes_pecuaria.csv';
    link.click();
    toast.success('Modelo baixado!');
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result;
      const lines = text.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        toast.error('Arquivo vazio ou sem dados');
        return;
      }

      const headers = lines[0].split(';').map(h => h.trim().toLowerCase());
      const dataLines = lines.slice(1);
      
      const errors = [];
      const validRecords = [];

      for (let i = 0; i < dataLines.length; i++) {
        const values = dataLines[i].split(';').map(v => v.trim().replace(/^"|"$/g, ''));
        const lineNum = i + 2;

        try {
          const tipo = values[headers.indexOf('tipo')] || '';
          const motivo = values[headers.indexOf('motivo')] || '';
          const quantidade = parseInt(values[headers.indexOf('quantidade')]) || 0;
          const dataStr = values[headers.indexOf('data')] || '';

          if (!tipo) {
            errors.push({ linha: lineNum, erro: 'Tipo é obrigatório', dados: dataLines[i] });
            continue;
          }
          if (!['Entrada', 'Saída'].includes(tipo)) {
            errors.push({ linha: lineNum, erro: 'Tipo deve ser "Entrada" ou "Saída"', dados: dataLines[i] });
            continue;
          }
          if (quantidade <= 0) {
            errors.push({ linha: lineNum, erro: 'Quantidade deve ser maior que zero', dados: dataLines[i] });
            continue;
          }

          let dataMovimentacaoStr;
          if (dataStr) {
            const parts = dataStr.split('/');
            if (parts.length === 3) {
              // Formato dd/mm/yyyy - converter para yyyy-mm-dd com horário meio-dia para evitar problemas de fuso
              const dia = parts[0].padStart(2, '0');
              const mes = parts[1].padStart(2, '0');
              const ano = parts[2];
              dataMovimentacaoStr = `${ano}-${mes}-${dia}T12:00:00`;
            } else {
              // Tentar interpretar outros formatos
              const parsed = new Date(dataStr);
              if (!isNaN(parsed.getTime())) {
                dataMovimentacaoStr = parsed.toISOString();
              } else {
                errors.push({ linha: lineNum, erro: 'Data inválida', dados: dataLines[i] });
                continue;
              }
            }
          } else {
            dataMovimentacaoStr = new Date().toISOString();
          }

          // Validar se a data é válida
          const dataValidacao = new Date(dataMovimentacaoStr);
          if (isNaN(dataValidacao.getTime())) {
            errors.push({ linha: lineNum, erro: 'Data inválida', dados: dataLines[i] });
            continue;
          }

          const record = {
            tipo,
            motivo,
            data_movimentacao: dataMovimentacaoStr,
            quantidade_animais: quantidade,
            categoria_animal: values[headers.indexOf('categoria')] || null,
            marca: values[headers.indexOf('marca')] || null,
            sexo: values[headers.indexOf('sexo')] || null,
            peso_medio: parseFloat(values[headers.indexOf('peso médio')]) || null,
            fornecedor_origem: tipo === 'Entrada' ? (values[headers.indexOf('fornecedor/comprador')] || null) : null,
            destino_venda: tipo === 'Saída' ? (values[headers.indexOf('fornecedor/comprador')] || null) : null,
            valor_unitario: parseFloat(values[headers.indexOf('valor unitário')]) || null,
            valor_total: parseFloat(values[headers.indexOf('valor total')]) || null,
            nota_fiscal: values[headers.indexOf('nf')] || null,
            gta: values[headers.indexOf('gta')] || null,
            causa_morte: values[headers.indexOf('causa morte')] || null,
            transferencia_origem: values[headers.indexOf('transferência origem')] || null,
            transferencia_destino: values[headers.indexOf('transferência destino')] || null,
            observacoes: values[headers.indexOf('observações')] || null,
          };

          // Buscar setor pelo nome
          const setorNome = values[headers.indexOf('setor')] || '';
          if (setorNome) {
            const setor = setores.find(s => 
              s.nome?.trim().toLowerCase() === setorNome.trim().toLowerCase() || 
              s.sigla?.trim().toLowerCase() === setorNome.trim().toLowerCase()
            );
            if (setor) {
              record.setor_id = setor.id;
              record.setor_nome = setor.nome;
            } else {
              // Se não encontrar o setor, guardar apenas o nome para referência
              record.setor_nome = setorNome;
            }
          }

          // Buscar área
          const areaNome = values[headers.indexOf('área')] || '';
          if (areaNome) {
            const area = areas.find(a => 
              a.nome?.toLowerCase() === areaNome.toLowerCase() || 
              a.sigla?.toLowerCase() === areaNome.toLowerCase()
            );
            if (area) {
              if (tipo === 'Entrada') {
                record.area_destino_id = area.id;
                record.area_destino_nome = area.nome;
              } else {
                record.area_origem_id = area.id;
                record.area_origem_nome = area.nome;
              }
            }
          }

          validRecords.push(record);
        } catch (err) {
          errors.push({ linha: lineNum, erro: 'Erro ao processar linha', dados: dataLines[i] });
        }
      }

      if (errors.length > 0) {
        setImportErrors(errors);
        setShowImportErrors(true);
      }

      if (validRecords.length > 0) {
        setImportProgress({ current: 0, total: validRecords.length, isImporting: true });
        
        const allMovs = await base44.entities.MovimentacaoPecuaria.list();
        let maxNum = allMovs.reduce((max, m) => Math.max(max, parseInt(m.numero_movimentacao) || 0), 0);

        for (let i = 0; i < validRecords.length; i++) {
          try {
            maxNum++;
            await base44.entities.MovimentacaoPecuaria.create({
              ...validRecords[i],
              empresa_id: empresaSelecionadaId,
              numero_movimentacao: String(maxNum),
            });
            setImportProgress(prev => ({ ...prev, current: i + 1 }));
          } catch (err) {
            console.error('Erro ao importar:', err);
          }
        }

        setImportProgress({ current: 0, total: 0, isImporting: false });
        queryClient.invalidateQueries({ queryKey: ['movimentacoes-pecuaria'] });
        toast.success(`${validRecords.length} registro(s) importado(s) com sucesso!`);
      }

      setShowImportDialog(false);
      e.target.value = '';
    };

    reader.readAsText(file, 'UTF-8');
  };

  const handleExportErrors = () => {
    const csvRows = ['Linha;Erro;Dados'];
    importErrors.forEach(err => {
      csvRows.push(`${err.linha};"${err.erro}";"${err.dados}"`);
    });
    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `erros_importacao_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.csv`;
    link.click();
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

  const { data: setores = [] } = useQuery({
    queryKey: ['setores', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Setor.list();
      return all.filter(s => s.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const renderCell = (coluna, mov) => {
    switch (coluna.id) {
      case 'numero':
        return <TableCell className="text-xs font-mono font-bold text-slate-700 border-r border-slate-200">{mov.numero_movimentacao || '-'}</TableCell>;
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
      case 'motivo':
        return <TableCell className="text-xs font-medium border-r border-slate-200">{mov.motivo || '-'}</TableCell>;
      case 'quantidade':
        return <TableCell className="text-right font-mono font-semibold text-emerald-700 text-xs border-r border-slate-200">{mov.quantidade_animais} cab</TableCell>;
      case 'categoria':
        return <TableCell className="text-xs border-r border-slate-200">{mov.categoria_animal || '-'}</TableCell>;
      case 'categoria_nova':
        return <TableCell className="text-xs border-r border-slate-200">{mov.categoria_nova || '-'}</TableCell>;
      case 'marca':
        return <TableCell className="text-xs font-semibold text-blue-700 border-r border-slate-200">{mov.marca || '-'}</TableCell>;
      case 'sexo':
        return <TableCell className="text-xs border-r border-slate-200">{mov.sexo || '-'}</TableCell>;
      case 'peso_medio':
        return <TableCell className="text-right font-mono text-xs border-r border-slate-200">{mov.peso_medio ? `${formatarNumero(mov.peso_medio)} kg` : '-'}</TableCell>;
      case 'peso_total':
        return <TableCell className="text-right font-mono text-xs border-r border-slate-200">{mov.peso_total ? `${formatarNumero(mov.peso_total)} kg` : '-'}</TableCell>;
      case 'area':
        const areaExibir = mov.tipo === 'Entrada' ? mov.area_destino_nome : mov.area_origem_nome;
        return <TableCell className="text-xs border-r border-slate-200">{areaExibir || '-'}</TableCell>;
      case 'valor_unitario':
        return <TableCell className="text-right font-mono text-xs border-r border-slate-200">{mov.valor_unitario ? `R$ ${mov.valor_unitario.toFixed(2)}` : '-'}</TableCell>;
      case 'valor_total':
        return <TableCell className="text-right font-mono font-semibold text-emerald-700 text-xs border-r border-slate-200">{mov.valor_total ? `R$ ${mov.valor_total.toFixed(2)}` : '-'}</TableCell>;
      case 'fornecedor':
        return <TableCell className="text-xs border-r border-slate-200">{mov.fornecedor_origem || mov.destino_venda || '-'}</TableCell>;
      case 'nota_fiscal':
        return <TableCell className="text-xs font-mono border-r border-slate-200">{mov.nota_fiscal || '-'}</TableCell>;
      case 'gta':
        return <TableCell className="text-xs font-mono border-r border-slate-200">{mov.gta || '-'}</TableCell>;
      case 'causa_morte':
        return <TableCell className="text-xs border-r border-slate-200">{mov.causa_morte || '-'}</TableCell>;
      case 'destino_abate':
        return <TableCell className="text-xs border-r border-slate-200">{mov.destino_abate || '-'}</TableCell>;
      case 'transferencia_origem':
        return <TableCell className="text-xs border-r border-slate-200">{mov.transferencia_origem || '-'}</TableCell>;
      case 'transferencia_destino':
        return <TableCell className="text-xs border-r border-slate-200">{mov.transferencia_destino || '-'}</TableCell>;
      case 'observacoes':
        return <TableCell className="text-xs border-r border-slate-200 max-w-[200px] truncate" title={mov.observacoes}>{mov.observacoes || '-'}</TableCell>;
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
            <Button onClick={handleDownloadTemplate} variant="outline" size="sm" className="h-8 gap-1 text-xs">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Modelo
            </Button>
            <Button onClick={() => setShowImportDialog(true)} variant="outline" size="sm" className="h-8 gap-1 text-xs">
              <Upload className="w-3.5 h-3.5" />
              Importar
            </Button>
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

        {!showNovoLancamento && <SaldoCategorias movimentacoes={movimentacoes} categoriasManejo={[]} />}

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
                              <DropdownMenuItem 
                                onClick={() => { 
                                  // Duplicar: copia os dados sem o id para abrir no formulário como novo
                                  const { id, numero_movimentacao, created_date, updated_date, created_by, ...dadosDuplicados } = mov;
                                  setItemEditandoManual({ ...dadosDuplicados, data_movimentacao: new Date().toISOString(), _isDuplicate: true }); 
                                  setShowNovoLancamento(true); 
                                }} 
                                className="text-xs"
                              >
                                <Copy className="w-3 h-3 mr-1" />
                                Duplicar
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

      {/* Dialog de Importação */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Importar Movimentações</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-xs text-slate-600 mb-3">
                Selecione um arquivo CSV com os dados das movimentações. Use o botão "Modelo" para baixar um arquivo de exemplo.
              </p>
              <input
                type="file"
                accept=".csv"
                onChange={handleImportFile}
                className="w-full text-xs"
              />
            </div>
            <div className="text-xs text-slate-500">
              <strong>Colunas obrigatórias:</strong> Tipo, Quantidade
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setShowImportDialog(false)} variant="outline" size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog de Erros de Importação */}
      <Dialog open={showImportErrors} onOpenChange={setShowImportErrors}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Erros na Importação ({importErrors.length})
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Linha</TableHead>
                  <TableHead className="text-xs">Erro</TableHead>
                  <TableHead className="text-xs">Dados</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {importErrors.map((err, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="text-xs font-mono">{err.linha}</TableCell>
                    <TableCell className="text-xs text-red-600">{err.erro}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate" title={err.dados}>{err.dados}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button onClick={handleExportErrors} variant="outline" size="sm" className="h-8 text-xs gap-1">
              <Download className="w-3.5 h-3.5" />
              Baixar Erros
            </Button>
            <Button onClick={() => setShowImportErrors(false)} size="sm" className="h-8 text-xs">
              Fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog de Progresso de Importação */}
      <Dialog open={importProgress.isImporting} onOpenChange={() => {}}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Importando Movimentações...</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Progresso</span>
                <span className="font-semibold text-slate-900">
                  {importProgress.current} de {importProgress.total}
                </span>
              </div>
              <Progress value={(importProgress.current / importProgress.total) * 100} className="h-3" />
              <p className="text-center text-sm font-medium text-emerald-600">
                {Math.round((importProgress.current / importProgress.total) * 100)}%
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}