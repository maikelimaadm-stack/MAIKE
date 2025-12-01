import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Upload, Search, Trash2, FileSpreadsheet, Download, 
  ChevronUp, ChevronDown, RefreshCw, Filter, X, Scale,
  AlertTriangle, CheckCircle2
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const formatarData = (dataString) => {
  if (!dataString) return '--/--/----';
  try {
    const date = new Date(dataString);
    if (isNaN(date.getTime())) return '--/--/----';
    return format(date, "dd/MM/yyyy", { locale: ptBR });
  } catch { return '--/--/----'; }
};

const parseDataBR = (dataStr) => {
  if (!dataStr) return null;
  // Tenta formato DD/MM/YYYY
  const partes = dataStr.split('/');
  if (partes.length === 3) {
    const [dia, mes, ano] = partes;
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }
  // Tenta formato ISO
  if (dataStr.includes('-')) {
    return dataStr.split('T')[0];
  }
  return null;
};

export default function PesagensIndividuais() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  // Estados
  const [searchTerm, setSearchTerm] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: 'data_pesagem', direction: 'desc' });
  const [filtroLote, setFiltroLote] = useState("");
  const [filtroApartacao, setFiltroApartacao] = useState("");
  const [filtroSexo, setFiltroSexo] = useState("");
  const [filtroDataInicio, setFiltroDataInicio] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [selectedItems, setSelectedItems] = useState([]);
  
  // Import states
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importData, setImportData] = useState([]);
  const [importErrors, setImportErrors] = useState([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);

  // Fetch pesagens
  const { data: pesagens = [], isLoading, refetch } = useQuery({
    queryKey: ['pesagens-individuais', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PesagemIndividual.list('-data_pesagem');
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Valores únicos para filtros
  const lotesUnicos = [...new Set(pesagens.map(p => p.nome_lote).filter(Boolean))].sort();
  const apartacoesUnicas = [...new Set(pesagens.map(p => p.nome_apartacao).filter(Boolean))].sort();

  // Filtrar e ordenar
  const pesagensFiltradas = useMemo(() => {
    let filtered = pesagens.filter(p => {
      if (searchTerm) {
        const termo = searchTerm.toLowerCase();
        if (!p.numero_animal?.toLowerCase().includes(termo) &&
            !p.nome_lote?.toLowerCase().includes(termo) &&
            !p.raca?.toLowerCase().includes(termo)) {
          return false;
        }
      }
      if (filtroLote && p.nome_lote !== filtroLote) return false;
      if (filtroApartacao && p.nome_apartacao !== filtroApartacao) return false;
      if (filtroSexo && p.sexo !== filtroSexo) return false;
      if (filtroDataInicio && p.data_pesagem < filtroDataInicio) return false;
      if (filtroDataFim && p.data_pesagem > filtroDataFim) return false;
      return true;
    });

    // Ordenar
    filtered.sort((a, b) => {
      let aVal = a[sortConfig.key];
      let bVal = b[sortConfig.key];
      
      if (sortConfig.key === 'data_pesagem' || sortConfig.key === 'data_anterior') {
        aVal = aVal ? new Date(aVal) : new Date(0);
        bVal = bVal ? new Date(bVal) : new Date(0);
      } else if (['peso', 'peso_anterior', 'dias', 'ganho', 'gmd'].includes(sortConfig.key)) {
        aVal = parseFloat(aVal) || 0;
        bVal = parseFloat(bVal) || 0;
      } else {
        aVal = String(aVal || '').toLowerCase();
        bVal = String(bVal || '').toLowerCase();
      }

      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [pesagens, searchTerm, filtroLote, filtroApartacao, filtroSexo, filtroDataInicio, filtroDataFim, sortConfig]);

  // Paginação
  const totalPages = Math.ceil(pesagensFiltradas.length / itemsPerPage);
  const pesagensPaginadas = pesagensFiltradas.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Estatísticas
  const stats = useMemo(() => {
    const total = pesagensFiltradas.length;
    const pesoMedio = total > 0 ? pesagensFiltradas.reduce((s, p) => s + (p.peso || 0), 0) / total : 0;
    const gmdMedio = pesagensFiltradas.filter(p => p.gmd).length > 0 
      ? pesagensFiltradas.filter(p => p.gmd).reduce((s, p) => s + p.gmd, 0) / pesagensFiltradas.filter(p => p.gmd).length 
      : 0;
    return { total, pesoMedio, gmdMedio };
  }, [pesagensFiltradas]);

  // Handlers
  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
          toast.error('Arquivo vazio ou sem dados');
          return;
        }

        // Detectar delimitador (tab ou ;)
        const delimitador = lines[0].includes('\t') ? '\t' : ';';
        const headers = lines[0].split(delimitador).map(h => h.trim().toLowerCase());
        
        // Mapear colunas (normaliza removendo espaços, acentos e underscores)
        const normalizar = (str) => str.toLowerCase().replace(/[_\s]/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        
        const colMap = {
          id: headers.findIndex(h => normalizar(h) === 'id' || normalizar(h) === 'idexterno' || normalizar(h) === 'id_externo'),
          data: headers.findIndex(h => normalizar(h) === 'data'),
          numero_animal: headers.findIndex(h => normalizar(h) === 'numeroanimal' || normalizar(h) === 'animal'),
          sexo: headers.findIndex(h => normalizar(h) === 'sexo'),
          raca: headers.findIndex(h => normalizar(h) === 'raca' || normalizar(h) === 'raça'),
          peso: headers.findIndex(h => normalizar(h) === 'peso'),
          nome_lote: headers.findIndex(h => normalizar(h) === 'lote' || normalizar(h) === 'nomelote'),
          nome_apartacao: headers.findIndex(h => normalizar(h) === 'apartacao' || normalizar(h) === 'nomeapartacao'),
          observacao: headers.findIndex(h => normalizar(h) === 'observacao' || normalizar(h) === 'obs'),
          data_anterior: headers.findIndex(h => normalizar(h) === 'dataanterior'),
          peso_anterior: headers.findIndex(h => normalizar(h) === 'pesoanterior'),
          dias: headers.findIndex(h => normalizar(h) === 'dias'),
          ganho: headers.findIndex(h => normalizar(h) === 'ganho'),
          gmd: headers.findIndex(h => normalizar(h) === 'gmd'),
        };

        const dados = [];
        const erros = [];

        for (let i = 1; i < lines.length; i++) {
          const valores = lines[i].split(delimitador).map(v => v.trim());
          
          const registro = {
            id_externo: colMap.id >= 0 ? valores[colMap.id] : null,
            data_pesagem: colMap.data >= 0 ? parseDataBR(valores[colMap.data]) : null,
            numero_animal: colMap.numero_animal >= 0 ? valores[colMap.numero_animal] : null,
            sexo: colMap.sexo >= 0 ? valores[colMap.sexo]?.toUpperCase() : null,
            raca: colMap.raca >= 0 ? valores[colMap.raca] : null,
            peso: colMap.peso >= 0 ? parseFloat(valores[colMap.peso]?.replace(',', '.')) || null : null,
            nome_lote: colMap.nome_lote >= 0 ? valores[colMap.nome_lote] : null,
            nome_apartacao: colMap.nome_apartacao >= 0 ? valores[colMap.nome_apartacao] : null,
            observacao: colMap.observacao >= 0 ? valores[colMap.observacao] : null,
            data_anterior: colMap.data_anterior >= 0 ? parseDataBR(valores[colMap.data_anterior]) : null,
            peso_anterior: colMap.peso_anterior >= 0 ? parseFloat(valores[colMap.peso_anterior]?.replace(',', '.')) || null : null,
            dias: colMap.dias >= 0 ? parseInt(valores[colMap.dias]) || null : null,
            ganho: colMap.ganho >= 0 ? parseFloat(valores[colMap.ganho]?.replace(',', '.')) || null : null,
            gmd: colMap.gmd >= 0 ? parseFloat(valores[colMap.gmd]?.replace(',', '.')) || null : null,
          };

          // Validar campos obrigatórios
          if (!registro.numero_animal) {
            erros.push({ linha: i + 1, erro: 'Número do animal não informado' });
            continue;
          }
          if (!registro.peso) {
            erros.push({ linha: i + 1, erro: `Animal ${registro.numero_animal}: Peso não informado` });
            continue;
          }
          if (!registro.data_pesagem) {
            erros.push({ linha: i + 1, erro: `Animal ${registro.numero_animal}: Data inválida` });
            continue;
          }

          dados.push(registro);
        }

        setImportData(dados);
        setImportErrors(erros);
        setShowImportDialog(true);
      } catch (error) {
        toast.error('Erro ao processar arquivo: ' + error.message);
      }
    };
    reader.readAsText(file, 'UTF-8');
    event.target.value = '';
  };

  const confirmarImportacao = async () => {
    if (importData.length === 0) {
      toast.error('Nenhum dado válido para importar');
      return;
    }

    setIsImporting(true);
    setImportProgress(0);

    try {
      const batchSize = 50;
      let importados = 0;

      for (let i = 0; i < importData.length; i += batchSize) {
        const batch = importData.slice(i, i + batchSize).map(item => ({
          ...item,
          empresa_id: empresaSelecionadaId,
        }));

        await base44.entities.PesagemIndividual.bulkCreate(batch);
        importados += batch.length;
        setImportProgress(Math.round((importados / importData.length) * 100));
      }

      toast.success(`${importados} pesagens importadas com sucesso!`);
      setShowImportDialog(false);
      setImportData([]);
      setImportErrors([]);
      queryClient.invalidateQueries({ queryKey: ['pesagens-individuais'] });
    } catch (error) {
      toast.error('Erro ao importar: ' + error.message);
    } finally {
      setIsImporting(false);
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (ids) => {
      for (const id of ids) {
        await base44.entities.PesagemIndividual.delete(id);
      }
    },
    onSuccess: () => {
      toast.success('Registros excluídos!');
      setSelectedItems([]);
      queryClient.invalidateQueries({ queryKey: ['pesagens-individuais'] });
    },
    onError: () => toast.error('Erro ao excluir'),
  });

  const handleDeleteSelected = () => {
    if (selectedItems.length === 0) return;
    if (confirm(`Excluir ${selectedItems.length} registro(s)?`)) {
      deleteMutation.mutate(selectedItems);
    }
  };

  const limparFiltros = () => {
    setSearchTerm("");
    setFiltroLote("");
    setFiltroApartacao("");
    setFiltroSexo("");
    setFiltroDataInicio("");
    setFiltroDataFim("");
    setCurrentPage(1);
  };

  const baixarModelo = () => {
    const headers = ['ID_Externo', 'Data', 'Numero Animal', 'Sexo', 'Raça', 'Peso', 'Lote', 'Apartação', 'Observação', 'DataAnterior', 'PesoAnterior', 'Dias', 'Ganho', 'GMD'];
    const exemplo1 = ['22207', '01/12/2025', '4368', 'M', 'Nelore', '206', 'MEIO', 'ROTINA', '', '15/11/2025', '180', '16', '26', '1.625'];
    const exemplo2 = ['22206', '01/12/2025', '4369', 'M', 'Nelore', '287', 'BOIADA', 'ROTINA', '', '15/11/2025', '260', '16', '27', '1.687'];
    const exemplo3 = ['22205', '01/12/2025', '4370', 'F', 'Nelore', '212', 'MEIO', 'ROTINA', '', '', '', '', '', ''];
    
    const csv = [headers.join(';'), exemplo1.join(';'), exemplo2.join(';'), exemplo3.join(';')].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo_pesagens_individuais.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Modelo baixado!');
  };

  const exportarCSV = () => {
    const headers = ['ID_Externo', 'Data', 'NumeroAnimal', 'Sexo', 'Raça', 'Peso', 'Lote', 'Apartação', 'Observação', 'DataAnterior', 'PesoAnterior', 'Dias', 'Ganho', 'GMD'];
    const rows = pesagensFiltradas.map(p => [
      p.id_externo || '',
      formatarData(p.data_pesagem),
      p.numero_animal || '',
      p.sexo || '',
      p.raca || '',
      p.peso || '',
      p.nome_lote || '',
      p.nome_apartacao || '',
      p.observacao || '',
      formatarData(p.data_anterior),
      p.peso_anterior || '',
      p.dias || '',
      p.ganho || '',
      p.gmd || '',
    ]);

    const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pesagens_individuais_${format(new Date(), 'yyyyMMdd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSelectAll = () => {
    if (selectedItems.length === pesagensPaginadas.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(pesagensPaginadas.map(p => p.id));
    }
  };

  const SortIcon = ({ column }) => {
    if (sortConfig.key !== column) return null;
    return sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Scale className="w-5 h-5" />
            Pesagens Individuais
          </h1>
          <p className="text-xs text-slate-600">Importação e gestão de pesagens individuais</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="h-8 text-xs gap-1">
            <RefreshCw className="w-3.5 h-3.5" />
            Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={exportarCSV} className="h-8 text-xs gap-1">
            <Download className="w-3.5 h-3.5" />
            Exportar
          </Button>
          <Button variant="outline" size="sm" onClick={baixarModelo} className="h-8 text-xs gap-1">
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Modelo CSV
          </Button>
          <label>
            <Button size="sm" className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 cursor-pointer" asChild>
              <span>
                <Upload className="w-3.5 h-3.5" />
                Importar CSV/TXT
              </span>
            </Button>
            <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="bg-slate-50">
          <CardContent className="p-3">
            <div className="text-xs text-slate-500">Total Registros</div>
            <div className="text-xl font-bold text-slate-900">{stats.total.toLocaleString('pt-BR')}</div>
          </CardContent>
        </Card>
        <Card className="bg-blue-50">
          <CardContent className="p-3">
            <div className="text-xs text-blue-600">Peso Médio</div>
            <div className="text-xl font-bold text-blue-900">{stats.pesoMedio.toFixed(1)} kg</div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50">
          <CardContent className="p-3">
            <div className="text-xs text-emerald-600">GMD Médio</div>
            <div className="text-xl font-bold text-emerald-900">{stats.gmdMedio.toFixed(3)} kg/dia</div>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
            <div className="md:col-span-2 relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Buscar animal, lote..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-8 text-xs pl-8"
              />
            </div>
            <Select value={filtroLote} onValueChange={setFiltroLote}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Lote" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todos Lotes</SelectItem>
                {lotesUnicos.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroApartacao} onValueChange={setFiltroApartacao}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Apartação" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todas</SelectItem>
                {apartacoesUnicas.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroSexo} onValueChange={setFiltroSexo}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sexo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todos</SelectItem>
                <SelectItem value="M">Macho</SelectItem>
                <SelectItem value="F">Fêmea</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" value={filtroDataInicio} onChange={(e) => setFiltroDataInicio(e.target.value)} className="h-8 text-xs" placeholder="Data início" />
            <Input type="date" value={filtroDataFim} onChange={(e) => setFiltroDataFim(e.target.value)} className="h-8 text-xs" placeholder="Data fim" />
          </div>
          <div className="flex justify-between items-center mt-2">
            <div className="text-xs text-slate-500">
              {pesagensFiltradas.length} de {pesagens.length} registros
            </div>
            <div className="flex gap-2">
              {selectedItems.length > 0 && (
                <Button variant="destructive" size="sm" onClick={handleDeleteSelected} className="h-7 text-xs gap-1">
                  <Trash2 className="w-3 h-3" />
                  Excluir ({selectedItems.length})
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={limparFiltros} className="h-7 text-xs">
                Limpar Filtros
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[500px]">
            <Table>
              <TableHeader className="sticky top-0 bg-white z-10">
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox 
                      checked={selectedItems.length === pesagensPaginadas.length && pesagensPaginadas.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead className="text-xs cursor-pointer" onClick={() => handleSort('data_pesagem')}>
                    <div className="flex items-center gap-1">Data <SortIcon column="data_pesagem" /></div>
                  </TableHead>
                  <TableHead className="text-xs cursor-pointer" onClick={() => handleSort('numero_animal')}>
                    <div className="flex items-center gap-1">Animal <SortIcon column="numero_animal" /></div>
                  </TableHead>
                  <TableHead className="text-xs">Sexo</TableHead>
                  <TableHead className="text-xs">Raça</TableHead>
                  <TableHead className="text-xs cursor-pointer text-right" onClick={() => handleSort('peso')}>
                    <div className="flex items-center justify-end gap-1">Peso <SortIcon column="peso" /></div>
                  </TableHead>
                  <TableHead className="text-xs cursor-pointer" onClick={() => handleSort('nome_lote')}>
                    <div className="flex items-center gap-1">Lote <SortIcon column="nome_lote" /></div>
                  </TableHead>
                  <TableHead className="text-xs">Apartação</TableHead>
                  <TableHead className="text-xs text-right">Dias</TableHead>
                  <TableHead className="text-xs cursor-pointer text-right" onClick={() => handleSort('ganho')}>
                    <div className="flex items-center justify-end gap-1">Ganho <SortIcon column="ganho" /></div>
                  </TableHead>
                  <TableHead className="text-xs cursor-pointer text-right" onClick={() => handleSort('gmd')}>
                    <div className="flex items-center justify-end gap-1">GMD <SortIcon column="gmd" /></div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-slate-500">Carregando...</TableCell>
                  </TableRow>
                ) : pesagensPaginadas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-slate-500">
                      <FileSpreadsheet className="w-12 h-12 mx-auto mb-2 opacity-30" />
                      Nenhuma pesagem encontrada
                    </TableCell>
                  </TableRow>
                ) : (
                  pesagensPaginadas.map((p) => (
                    <TableRow key={p.id} className="hover:bg-slate-50">
                      <TableCell>
                        <Checkbox 
                          checked={selectedItems.includes(p.id)}
                          onCheckedChange={(checked) => {
                            setSelectedItems(prev => checked ? [...prev, p.id] : prev.filter(id => id !== p.id));
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-xs">{formatarData(p.data_pesagem)}</TableCell>
                      <TableCell className="text-xs font-medium">{p.numero_animal}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant={p.sexo === 'M' ? 'default' : 'secondary'} className="text-[10px]">
                          {p.sexo === 'M' ? 'Macho' : p.sexo === 'F' ? 'Fêmea' : '-'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{p.raca || '-'}</TableCell>
                      <TableCell className="text-xs text-right font-mono font-semibold">{p.peso?.toLocaleString('pt-BR')} kg</TableCell>
                      <TableCell className="text-xs">{p.nome_lote || '-'}</TableCell>
                      <TableCell className="text-xs">{p.nome_apartacao || '-'}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{p.dias || '-'}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{p.ganho ? `${p.ganho.toLocaleString('pt-BR')} kg` : '-'}</TableCell>
                      <TableCell className={`text-xs text-right font-mono ${p.gmd && p.gmd > 0 ? 'text-emerald-600' : p.gmd && p.gmd < 0 ? 'text-red-600' : ''}`}>
                        {p.gmd ? p.gmd.toFixed(3) : '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Paginação */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-3 border-t">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Itens por página:</span>
                <Select value={String(itemsPerPage)} onValueChange={(v) => { setItemsPerPage(Number(v)); setCurrentPage(1); }}>
                  <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[25, 50, 100, 200].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="h-7 text-xs">
                  Anterior
                </Button>
                <span className="text-xs text-slate-600">Página {currentPage} de {totalPages}</span>
                <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="h-7 text-xs">
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog de Importação */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5" />
              Importar Pesagens Individuais
            </DialogTitle>
          </DialogHeader>
          
          <div className="flex-1 overflow-auto space-y-4">
            {/* Resumo */}
            <div className="grid grid-cols-2 gap-3">
              <Card className="bg-emerald-50">
                <CardContent className="p-3 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <div>
                    <div className="text-xs text-emerald-600">Registros Válidos</div>
                    <div className="text-lg font-bold text-emerald-800">{importData.length}</div>
                  </div>
                </CardContent>
              </Card>
              {importErrors.length > 0 && (
                <Card className="bg-red-50">
                  <CardContent className="p-3 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-600" />
                    <div>
                      <div className="text-xs text-red-600">Erros</div>
                      <div className="text-lg font-bold text-red-800">{importErrors.length}</div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Erros */}
            {importErrors.length > 0 && (
              <Card className="border-red-200">
                <CardHeader className="py-2 px-3 bg-red-50">
                  <CardTitle className="text-sm text-red-700">Erros na Importação</CardTitle>
                </CardHeader>
                <CardContent className="p-2 max-h-32 overflow-auto">
                  {importErrors.slice(0, 10).map((err, idx) => (
                    <div key={idx} className="text-xs text-red-600 py-1">
                      Linha {err.linha}: {err.erro}
                    </div>
                  ))}
                  {importErrors.length > 10 && (
                    <div className="text-xs text-red-500 font-semibold">... e mais {importErrors.length - 10} erros</div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Preview */}
            {importData.length > 0 && (
              <div>
                <Label className="text-sm font-semibold mb-2 block">Preview (primeiros 20 registros)</Label>
                <div className="overflow-auto max-h-64 border rounded">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Data</TableHead>
                        <TableHead className="text-xs">Animal</TableHead>
                        <TableHead className="text-xs">Sexo</TableHead>
                        <TableHead className="text-xs">Raça</TableHead>
                        <TableHead className="text-xs text-right">Peso</TableHead>
                        <TableHead className="text-xs">Lote</TableHead>
                        <TableHead className="text-xs">Apartação</TableHead>
                        <TableHead className="text-xs text-right">GMD</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importData.slice(0, 20).map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-xs">{formatarData(item.data_pesagem)}</TableCell>
                          <TableCell className="text-xs font-medium">{item.numero_animal}</TableCell>
                          <TableCell className="text-xs">{item.sexo}</TableCell>
                          <TableCell className="text-xs">{item.raca}</TableCell>
                          <TableCell className="text-xs text-right">{item.peso} kg</TableCell>
                          <TableCell className="text-xs">{item.nome_lote}</TableCell>
                          <TableCell className="text-xs">{item.nome_apartacao}</TableCell>
                          <TableCell className="text-xs text-right">{item.gmd?.toFixed(3) || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* Progress */}
            {isImporting && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-600">
                  <span>Importando...</span>
                  <span>{importProgress}%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div className="bg-emerald-600 h-2 rounded-full transition-all" style={{ width: `${importProgress}%` }} />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowImportDialog(false)} disabled={isImporting}>
              Cancelar
            </Button>
            <Button onClick={confirmarImportacao} disabled={isImporting || importData.length === 0} className="bg-emerald-600 hover:bg-emerald-700">
              {isImporting ? 'Importando...' : `Importar ${importData.length} Registros`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}