import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Plus, Search, Edit, Trash2, Upload, Loader2, X, Download, CheckCircle, AlertCircle, MoreVertical, Settings, ArrowUpDown, ArrowUp, ArrowDown, GripVertical, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

const COLUNAS_DISPONIVEIS = [
  { id: 'codigo', label: 'Código IBGE', default: true, sortable: true },
  { id: 'nome', label: 'Cidade', default: true, sortable: true },
  { id: 'estado', label: 'UF', default: true, sortable: true },
];

const ITEMS_PER_PAGE = 50;

export default function GerenciarCidades() {
  const [showForm, setShowForm] = useState(false);
  const [editingCidade, setEditingCidade] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState("");
  const [showImportar, setShowImportar] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [progresso, setProgresso] = useState({ total: 0, processado: 0, erros: 0 });
  const [errosImportacao, setErrosImportacao] = useState([]);
  const [concluido, setConcluido] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_cidades');
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
    const saved = localStorage.getItem('colunas_ordem_cidades');
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
  const [selectedItems, setSelectedItems] = useState([]);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });

  const [formData, setFormData] = useState({
    nome: "",
    estado: "",
    codigo_ibge: ""
  });

  const queryClient = useQueryClient();

  const { data: cidades = [], isLoading } = useQuery({
    queryKey: ['cidades_gerenciar'],
    queryFn: () => base44.entities.Cidade.list('nome'),
    initialData: [],
  });

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId)
        ? prev.filter(id => id !== colunaId)
        : [...prev, colunaId];
      
      localStorage.setItem('colunas_cidades', JSON.stringify(novasColunas));
      
      return novasColunas;
    });
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    
    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    setColunasOrdem(items);
    localStorage.setItem('colunas_ordem_cidades', JSON.stringify(items));
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

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const existente = cidades.find(c => c.codigo_ibge === data.codigo_ibge);
      if (existente) {
        throw new Error('Código IBGE já cadastrado!');
      }
      return base44.entities.Cidade.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cidades_gerenciar'] });
      queryClient.invalidateQueries({ queryKey: ['cidades'] });
      setShowForm(false);
      setFormData({ nome: "", estado: "", codigo_ibge: "" });
      toast.success('Cidade cadastrada!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao cadastrar');
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const existente = cidades.find(c => c.codigo_ibge === data.codigo_ibge && c.id !== id);
      if (existente) {
        throw new Error('Código IBGE já cadastrado em outra cidade!');
      }
      return base44.entities.Cidade.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cidades_gerenciar'] });
      queryClient.invalidateQueries({ queryKey: ['cidades'] });
      setShowForm(false);
      setEditingCidade(null);
      setFormData({ nome: "", estado: "", codigo_ibge: "" });
      toast.success('Cidade atualizada!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao atualizar');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Cidade.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cidades_gerenciar'] });
      queryClient.invalidateQueries({ queryKey: ['cidades'] });
      toast.success('Cidade excluída!');
    },
    onError: () => {
      toast.error('Erro ao excluir');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.nome || !formData.estado || !formData.codigo_ibge) {
      toast.error('Preencha todos os campos obrigatórios!');
      return;
    }

    if (formData.codigo_ibge.length !== 7) {
      toast.error('Código IBGE deve ter 7 dígitos!');
      return;
    }

    const dataToSubmit = {
      nome: formData.nome.toUpperCase(),
      estado: formData.estado,
      codigo_ibge: formData.codigo_ibge
    };

    if (editingCidade) {
      updateMutation.mutate({ id: editingCidade.id, data: dataToSubmit });
    } else {
      createMutation.mutate(dataToSubmit);
    }
  };

  const handleEdit = (cidade) => {
    setEditingCidade(cidade);
    setFormData({
      nome: cidade.nome,
      estado: cidade.estado,
      codigo_ibge: cidade.codigo_ibge
    });
    setShowForm(true);
  };

  const handleDelete = async (id, skipConfirm = false) => {
    if (skipConfirm || window.confirm('Deseja realmente excluir esta cidade?')) {
      try {
        await deleteMutation.mutateAsync(id);
      } catch (error) {
        console.error('Erro:', error);
      }
    }
  };

  const handleNovo = () => {
    setEditingCidade(null);
    setFormData({ nome: "", estado: "", codigo_ibge: "" });
    setShowForm(true);
  };

  const handleCancelar = () => {
    setShowForm(false);
    setEditingCidade(null);
    setFormData({ nome: "", estado: "", codigo_ibge: "" });
  };

  const handleImportarExcel = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setProcessando(true);
    setConcluido(false);
    setErrosImportacao([]);
    setShowImportar(true);

    try {
      const text = await file.text();
      const linhas = text.split('\n').map(l => l.trim()).filter(l => l);
      
      if (linhas.length === 0) {
        throw new Error('Arquivo vazio!');
      }

      const cabecalho = linhas[0].split(/[;,\t]/);
      const dados = linhas.slice(1);

      const idxNome = cabecalho.findIndex(h => /nome|cidade/i.test(h));
      const idxEstado = cabecalho.findIndex(h => /estado|uf/i.test(h));
      const idxCodigo = cabecalho.findIndex(h => /codigo|ibge/i.test(h));

      if (idxNome === -1 || idxEstado === -1 || idxCodigo === -1) {
        throw new Error('Planilha deve ter as colunas: Nome, Estado, Codigo_IBGE');
      }

      setProgresso({ total: dados.length, processado: 0, erros: 0 });

      const cidadesExistentes = await base44.entities.Cidade.list();
      const codigosExistentes = new Set(cidadesExistentes.map(c => c.codigo_ibge));

      let totalImportadas = 0;
      const erros = [];

      for (let i = 0; i < dados.length; i++) {
        const linha = dados[i];
        const colunas = linha.split(/[;,\t]/);

        const nome = colunas[idxNome]?.trim().toUpperCase();
        const estado = colunas[idxEstado]?.trim().toUpperCase();
        const codigo_ibge = colunas[idxCodigo]?.trim();

        if (!nome || !estado || !codigo_ibge) {
          erros.push({ linha: i + 2, erro: 'Dados incompletos', dados: { nome, estado, codigo_ibge } });
          setProgresso(prev => ({ ...prev, processado: i + 1, erros: prev.erros + 1 }));
          continue;
        }

        if (codigo_ibge.length !== 7) {
          erros.push({ linha: i + 2, erro: 'Código IBGE deve ter 7 dígitos', dados: { nome, estado, codigo_ibge } });
          setProgresso(prev => ({ ...prev, processado: i + 1, erros: prev.erros + 1 }));
          continue;
        }

        if (codigosExistentes.has(codigo_ibge)) {
          setProgresso(prev => ({ ...prev, processado: i + 1 }));
          continue;
        }

        try {
          await base44.entities.Cidade.create({ nome, estado, codigo_ibge });
          codigosExistentes.add(codigo_ibge);
          totalImportadas++;
          setProgresso(prev => ({ ...prev, processado: i + 1 }));
          await new Promise(resolve => setTimeout(resolve, 30));
        } catch (error) {
          erros.push({ linha: i + 2, erro: error.message || 'Erro ao cadastrar', dados: { nome, estado, codigo_ibge } });
          setProgresso(prev => ({ ...prev, processado: i + 1, erros: prev.erros + 1 }));
        }
      }

      queryClient.invalidateQueries({ queryKey: ['cidades_gerenciar'] });
      queryClient.invalidateQueries({ queryKey: ['cidades'] });
      setErrosImportacao(erros);
      setConcluido(true);

      if (erros.length > 0) {
        toast.success(`✅ ${totalImportadas} cidades importadas! (${erros.length} erros)`);
      } else {
        toast.success(`✅ ${totalImportadas} cidades importadas com sucesso!`);
      }
    } catch (error) {
      console.error('Erro:', error);
      toast.error('Erro ao processar arquivo: ' + error.message);
      setProcessando(false);
      setShowImportar(false);
    } finally {
      setProcessando(false);
      e.target.value = '';
    }
  };

  const baixarModelo = () => {
    const csv = 'Nome;Estado;Codigo_IBGE\nCUIABÁ;MT;5103403\nVÁRZEA GRANDE;MT;5108402\nRONDONÓPOLIS;MT;5107602';
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'modelo_cidades.csv';
    link.click();
    toast.success('Modelo baixado!');
  };

  const baixarRelatorioErros = () => {
    if (errosImportacao.length === 0) return;
    
    const linhas = ['Linha;Erro;Nome;Estado;Codigo_IBGE'];
    errosImportacao.forEach(e => {
      linhas.push(`${e.linha};${e.erro};${e.dados.nome || ''};${e.dados.estado || ''};${e.dados.codigo_ibge || ''}`);
    });
    
    const csv = linhas.join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `erros_importacao_cidades_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    toast.success('Relatório de erros baixado!');
  };

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId)
        ? prev.filter(id => id !== colunaId)
        : [...prev, colunaId];
      
      localStorage.setItem('colunas_cidades', JSON.stringify(novasColunas));
      
      return novasColunas;
    });
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    
    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    setColunasOrdem(items);
    localStorage.setItem('colunas_ordem_cidades', JSON.stringify(items));
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

  const cidadesFiltradas = cidades.filter(c => {
    const matchNome = !searchTerm || c.nome?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchEstado = !estadoFiltro || c.estado === estadoFiltro;
    return matchNome && matchEstado;
  });

  const sortedCidades = [...cidadesFiltradas].sort((a, b) => {
    if (!sortField) return 0;

    let aValue, bValue;

    switch (sortField) {
      case 'codigo':
        aValue = a.codigo_ibge;
        bValue = b.codigo_ibge;
        break;
      case 'nome':
        aValue = a.nome;
        bValue = b.nome;
        break;
      case 'estado':
        aValue = a.estado;
        bValue = b.estado;
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

  const totalPages = Math.ceil(sortedCidades.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedCidades = sortedCidades.slice(startIndex, endIndex);

  const toggleSelectAll = () => {
    if (selectedItems.length === paginatedCidades.length && paginatedCidades.length > 0) {
      setSelectedItems([]);
    } else {
      setSelectedItems(paginatedCidades.map(c => c.id));
    }
  };

  const toggleSelectItem = (id) => {
    setSelectedItems(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBulkDelete = async () => {
    if (window.confirm(`⚠️ ATENÇÃO: Você está prestes a excluir ${selectedItems.length} cidade(s) selecionada(s). Esta ação não pode ser desfeita. Deseja continuar?`)) {
      setIsDeletingBulk(true);
      setDeleteProgress({ current: 0, total: selectedItems.length });
      
      let deleted = 0;
      for (const id of selectedItems) {
        try {
          await handleDelete(id, true);
          deleted++;
          setDeleteProgress({ current: deleted, total: selectedItems.length });
        } catch (error) {
          console.error('Erro ao excluir:', error);
        }
      }
      
      setTimeout(() => {
        setIsDeletingBulk(false);
        setSelectedItems([]);
      }, 500);
    }
  };

  const deleteProgressPercentage = deleteProgress.total > 0 
    ? Math.round((deleteProgress.current / deleteProgress.total) * 100) 
    : 0;

  const renderCell = (coluna, cidade) => {
    switch (coluna.id) {
      case 'codigo':
        return <TableCell className="text-xs font-mono text-slate-600 border-r border-slate-200">{cidade.codigo_ibge}</TableCell>;
      case 'nome':
        return <TableCell className="text-xs font-medium border-r border-slate-200">{cidade.nome}</TableCell>;
      case 'estado':
        return (
          <TableCell className="border-r border-slate-200">
            <Badge variant="outline" className="text-xs bg-slate-100 text-slate-700">{cidade.estado}</Badge>
          </TableCell>
        );
      default:
        return <TableCell className="text-xs border-r border-slate-200">-</TableCell>;
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-2">
      {!showForm && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Gerenciar Cidades</h1>
              <p className="text-xs text-slate-600">Cadastro de cidades brasileiras com código IBGE</p>
            </div>
            <div className="flex gap-2">
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleImportarExcel}
                style={{ display: 'none' }}
                id="upload-cidades"
              />
              <Button 
                onClick={() => document.getElementById('upload-cidades').click()} 
                variant="outline" 
                size="sm" 
                className="h-8 gap-1 text-xs"
              >
                <Upload className="w-3.5 h-3.5" />
                Importar
              </Button>
              <Button onClick={baixarModelo} variant="outline" size="sm" className="h-8 gap-1 text-xs">
                <Download className="w-3.5 h-3.5" />
                Modelo
              </Button>
              <Button onClick={handleNovo} size="sm" className="h-8 gap-1 text-xs bg-slate-700 hover:bg-slate-800">
                <Plus className="w-3.5 h-3.5" />
                Nova Cidade
              </Button>
            </div>
          </div>
        </>
      )}

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card className="shadow-sm border-slate-300 bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
                <CardTitle className="text-sm font-semibold text-slate-900">
                  {editingCidade ? 'Editar Cidade' : 'Nova Cidade'}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Estado *</Label>
                      <Select value={formData.estado} onValueChange={(v) => setFormData({ ...formData, estado: v })}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="UF" />
                        </SelectTrigger>
                        <SelectContent>
                          {['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'].map(uf => (
                            <SelectItem key={uf} value={uf} className="text-xs">{uf}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Nome da Cidade *</Label>
                      <Input 
                        value={formData.nome} 
                        onChange={(e) => setFormData({ ...formData, nome: e.target.value })} 
                        placeholder="NOME DA CIDADE" 
                        className="h-8 text-xs uppercase" 
                        style={{ textTransform: 'uppercase' }}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Código IBGE *</Label>
                      <Input 
                        value={formData.codigo_ibge} 
                        onChange={(e) => setFormData({ ...formData, codigo_ibge: e.target.value.replace(/\D/g, '') })} 
                        placeholder="0000000" 
                        className="h-8 text-xs"
                        maxLength={7}
                        required
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <Button type="button" variant="outline" onClick={handleCancelar} size="sm" className="h-8 text-xs">
                      Cancelar
                    </Button>
                    <Button type="submit" size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800">
                      {editingCidade ? 'Atualizar' : 'Cadastrar'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {!showForm && (
        <Card className="shadow-sm border-slate-300">
          <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-sm font-semibold text-slate-900">
                Cidades ({cidades.length})
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
                
                <Select value={estadoFiltro} onValueChange={setEstadoFiltro}>
                  <SelectTrigger className="h-8 w-20 text-xs">
                    <SelectValue placeholder="UF" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null} className="text-xs">Todos</SelectItem>
                    {['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'].map(uf => (
                      <SelectItem key={uf} value={uf} className="text-xs">{uf}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
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
                        checked={selectedItems.length === paginatedCidades.length && paginatedCidades.length > 0}
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
                    ) : paginatedCidades.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={50} className="text-center py-12 text-slate-400 text-xs">Nenhuma cidade</TableCell>
                      </TableRow>
                    ) : (
                      paginatedCidades.map((cidade) => (
                        <motion.tr 
                          key={cidade.id}
                          initial={{ opacity: 0 }} 
                          animate={{ opacity: 1 }} 
                          exit={{ opacity: 0 }} 
                          className="hover:bg-slate-50 transition-colors border-b"
                        >
                          <TableCell className="border-r border-slate-200">
                            <Checkbox
                              checked={selectedItems.includes(cidade.id)}
                              onCheckedChange={() => toggleSelectItem(cidade.id)}
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
                                <DropdownMenuItem onClick={() => handleEdit(cidade)} className="text-xs">
                                  Editar
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => handleDelete(cidade.id)} className="text-xs text-red-600">
                                  Excluir
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                          {colunasOrdenadas.map(coluna => (
                            <React.Fragment key={coluna.id}>
                              {renderCell(coluna, cidade)}
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
                  Mostrando {startIndex + 1} a {Math.min(endIndex, sortedCidades.length)} de {sortedCidades.length} registros
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
        </Card>
      )}

      <Dialog open={showConfigColunas} onOpenChange={setShowConfigColunas}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">Configurar Colunas</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-3 flex-1 overflow-auto">
            <div className="space-y-1">
              <p className="text-xs text-slate-600 font-semibold">Visibilidade</p>
              <div className="grid grid-cols-2 gap-2">
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

      <Dialog open={isDeletingBulk} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-red-600" />
              Excluindo Registros
            </DialogTitle>
            <DialogDescription>
              Aguarde enquanto excluímos os registros selecionados...
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Progresso</span>
                <span className="font-semibold text-slate-900">
                  {deleteProgress.current} de {deleteProgress.total}
                </span>
              </div>
              <Progress value={deleteProgressPercentage} className="h-3" />
              <p className="text-center text-sm font-medium text-red-600">
                {deleteProgressPercentage}%
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showImportar} onOpenChange={(open) => !processando && setShowImportar(open)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Upload className="w-4 h-4 text-emerald-600" />
              Importar Cidades do Excel
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs">
              <p className="font-semibold text-blue-900 mb-2">ℹ️ Como importar</p>
              <p className="text-blue-800 mb-2">
                1. Baixe o modelo de planilha<br/>
                2. Preencha com: <strong>Nome</strong>, <strong>Estado</strong> e <strong>Codigo_IBGE</strong><br/>
                3. Faça upload do arquivo (CSV, XLS ou XLSX)
              </p>
              <p className="text-blue-800 text-[10px]">
                ✅ Códigos IBGE duplicados serão ignorados automaticamente
              </p>
            </div>

            {processando && (
              <div className="bg-slate-50 border border-slate-200 rounded p-3">
                <div className="flex items-center gap-3 mb-2">
                  <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
                  <span className="font-semibold text-sm">Importando...</span>
                </div>
                <div className="text-xs text-slate-600 mb-2">
                  {progresso.processado} de {progresso.total} processadas
                  {progresso.erros > 0 && <span className="text-red-600"> • {progresso.erros} erros</span>}
                </div>
                <Progress value={progresso.total > 0 ? (progresso.processado / progresso.total) * 100 : 0} className="h-2" />
              </div>
            )}

            {concluido && (
              <div className={`border rounded p-3 ${errosImportacao.length > 0 ? 'bg-orange-50 border-orange-200' : 'bg-emerald-50 border-emerald-200'}`}>
                <div className="flex items-center gap-3">
                  {errosImportacao.length > 0 ? (
                    <AlertCircle className="w-5 h-5 text-orange-600" />
                  ) : (
                    <CheckCircle className="w-5 h-5 text-emerald-600" />
                  )}
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{errosImportacao.length > 0 ? 'Importação concluída com erros' : 'Importação concluída!'}</p>
                    <p className="text-xs">
                      {progresso.total - progresso.erros} cidades importadas
                      {errosImportacao.length > 0 && ` • ${errosImportacao.length} erros`}
                    </p>
                  </div>
                  {errosImportacao.length > 0 && (
                    <Button onClick={baixarRelatorioErros} variant="outline" size="sm" className="h-7 text-xs">
                      <Download className="w-3 h-3 mr-1" />
                      Baixar Erros
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setShowImportar(false)} size="sm" className="h-8 text-xs" disabled={processando}>
                Fechar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}