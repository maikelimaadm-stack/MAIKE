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
  AlertTriangle, CheckCircle2, Plus, Settings, GripVertical, Edit2, MoreVertical, Layers
} from "lucide-react";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const formatarData = (dataString) => {
  if (!dataString) return '--/--/----';
  try {
    // Evitar problema de fuso horário: usar apenas a parte da data
    const dataStr = dataString.split('T')[0];
    const [ano, mes, dia] = dataStr.split('-');
    if (!ano || !mes || !dia) return '--/--/----';
    return `${dia}/${mes}/${ano}`;
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
  const [filtroTipoManejo, setFiltroTipoManejo] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");
  const [filtroDataInicio, setFiltroDataInicio] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");
  const [filtroPesoMin, setFiltroPesoMin] = useState("");
  const [filtroPesoMax, setFiltroPesoMax] = useState("");
  const [filtroMarca, setFiltroMarca] = useState("");
  const [filtroObservacao, setFiltroObservacao] = useState("");
  const [filtroDataEspecifica, setFiltroDataEspecifica] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [selectedItems, setSelectedItems] = useState([]);
  
  // Import states
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importData, setImportData] = useState([]);
  const [importErrors, setImportErrors] = useState([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [tipoManejoImport, setTipoManejoImport] = useState('Manejo');
  const [motivoSaidaImport, setMotivoSaidaImport] = useState('');
  const [destinoVendaImport, setDestinoVendaImport] = useState('');
  
  // Estado para vinculação de lotes
  const [showVincularLotes, setShowVincularLotes] = useState(false);
  const [lotesParaVincular, setLotesParaVincular] = useState([]);
  const [vincularLotesSelecionados, setVincularLotesSelecionados] = useState({});

  // Estado para edição em lote
  const [showEditarLote, setShowEditarLote] = useState(false);
  const [edicaoLote, setEdicaoLote] = useState({ data_pesagem: "", sexo: "", raca: "", era: "", marca: "", apartacao: "", lote: "" });
  
  // Fetch apartações e lotes
  const { data: apartacoesData = [] } = useQuery({
    queryKey: ['apartacoes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Apartacao.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: lotesData = [] } = useQuery({
    queryKey: ['lotes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LoteApartacao.list();
      return all.filter(l => l.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Lotes filtrados pela apartação selecionada na edição
  const lotesEdicaoFiltrados = useMemo(() => {
    if (!edicaoLote.apartacao) return [];
    return lotesData.filter(l => l.apartacao_id === edicaoLote.apartacao);
  }, [lotesData, edicaoLote.apartacao]);

  // Configuração de colunas
  const COLUNAS_DISPONIVEIS = [
    { id: 'selecao', label: 'Seleção', default: true, fixo: true },
    { id: 'acoes', label: 'Ações', default: true, fixo: true },
    { id: 'data_pesagem', label: 'Data', default: true },
    { id: 'tipo_manejo', label: 'Tipo', default: true },
    { id: 'motivo_saida', label: 'Tipo de Saída', default: true },
    { id: 'numero_animal', label: 'Animal', default: true },
    { id: 'sexo', label: 'Sexo', default: true },
    { id: 'raca', label: 'Raça', default: true },
    { id: 'era', label: 'Era', default: true },
    { id: 'peso', label: 'Peso', default: true },
    { id: 'nome_lote', label: 'Lote', default: true },
    { id: 'nome_apartacao', label: 'Apartação', default: true },
    { id: 'valor_pago_cabeca', label: 'Valor Compra', default: false },
    { id: 'origem_animal', label: 'Origem', default: false },
    { id: 'comprador', label: 'Comprador', default: false },
    { id: 'destino_venda', label: 'Destino', default: false },
    { id: 'valor_venda_total', label: 'Valor Venda', default: false },
    { id: 'valor_arroba', label: 'Valor @', default: false },
    { id: 'quantidade_arrobas', label: 'Qtd @', default: false },
    { id: 'frigorifico', label: 'Frigorífico', default: false },
    { id: 'embarque_nome', label: 'Embarque', default: false },
    { id: 'documento_tipo', label: 'Doc', default: false },
    { id: 'documento_numero', label: 'Nº Doc', default: false },
    { id: 'motorista_nome', label: 'Motorista', default: false },
    { id: 'placa_carreta', label: 'Placa', default: false },
    { id: 'doc_qtd', label: 'Qtd Doc (Dia)', default: false },
    { id: 'dias', label: 'Dias', default: false },
    { id: 'ganho', label: 'Ganho', default: false },
    { id: 'gmd', label: 'GMD', default: true },
    { id: 'marca', label: 'Marca', default: false },
    { id: 'observacao', label: 'Observação', default: false },
  ];

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem('colunas_ordem_pesagens_individuais');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.map(c => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.map(c => c.id);
  });

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_visiveis_pesagens_individuais');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });

  const toggleColuna = (colunaId) => {
    const novasColunas = colunasVisiveis.includes(colunaId)
      ? colunasVisiveis.filter(id => id !== colunaId)
      : [...colunasVisiveis, colunaId];
    setColunasVisiveis(novasColunas);
    localStorage.setItem('colunas_visiveis_pesagens_individuais', JSON.stringify(novasColunas));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setColunasOrdem(items);
    localStorage.setItem('colunas_ordem_pesagens_individuais', JSON.stringify(items));
  };

  const colunasOrdenadas = colunasOrdem
    .map(id => COLUNAS_DISPONIVEIS.find(c => c.id === id))
    .filter(c => c && colunasVisiveis.includes(c.id));

  // Fetch pesagens
  const { data: pesagens = [], isLoading, refetch } = useQuery({
    queryKey: ['pesagens-individuais', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PesagemIndividual.list('-data_pesagem');
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Valores únicos para filtros e autocomplete
  const lotesUnicos = [...new Set(pesagens.map(p => p.nome_lote).filter(Boolean))].sort();
  const apartacoesUnicas = [...new Set(pesagens.map(p => p.nome_apartacao).filter(Boolean))].sort();
  const marcasExistentes = [...new Set(pesagens.map(p => p.marca).filter(Boolean))].sort();
  const racasExistentes = [...new Set(pesagens.map(p => p.raca).filter(Boolean))].sort();
  const erasExistentes = [...new Set(pesagens.map(p => p.era).filter(Boolean))].sort();
  
  // Datas únicas por apartação selecionada
  const datasUnicasApartacao = useMemo(() => {
    let pesagensFiltro = pesagens;
    if (filtroApartacao) {
      pesagensFiltro = pesagens.filter(p => p.nome_apartacao === filtroApartacao);
    }
    return [...new Set(pesagensFiltro.map(p => p.data_pesagem).filter(Boolean))].sort().reverse();
  }, [pesagens, filtroApartacao]);

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
      if (filtroDataEspecifica && p.data_pesagem !== filtroDataEspecifica) return false;
      if (filtroSexo && p.sexo !== filtroSexo) return false;
      if (filtroTipoManejo && p.tipo_manejo !== filtroTipoManejo) return false;
      const statusCalc = p.status_animal || (p.tipo_manejo === 'Saída' ? 'Inativo' : 'Ativo');
      if (filtroStatus && statusCalc !== filtroStatus) return false;
      if (filtroDataInicio && p.data_pesagem < filtroDataInicio) return false;
      if (filtroDataFim && p.data_pesagem > filtroDataFim) return false;
      if (filtroPesoMin && parseFloat(p.peso) < parseFloat(filtroPesoMin)) return false;
      if (filtroPesoMax && parseFloat(p.peso) > parseFloat(filtroPesoMax)) return false;
      // Filtro de marca: "sem_marca" mostra os sem marca, ou filtra por marca específica
      if (filtroMarca) {
        if (filtroMarca === "sem_marca") {
          if (p.marca && p.marca.trim() !== '') return false;
        } else {
          if (p.marca !== filtroMarca) return false;
        }
      }
      // Filtro de observação: "sem_observacao" mostra os sem obs, "com_observacao" mostra os com obs
      if (filtroObservacao) {
        if (filtroObservacao === "sem_observacao") {
          if (p.observacao && p.observacao.trim() !== '') return false;
        } else if (filtroObservacao === "com_observacao") {
          if (!p.observacao || p.observacao.trim() === '') return false;
        }
      }
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
  }, [pesagens, searchTerm, filtroLote, filtroApartacao, filtroDataEspecifica, filtroSexo, filtroDataInicio, filtroDataFim, filtroMarca, filtroObservacao, sortConfig]);

  // Contagem por documento (para coluna Doc Qtd)
  const docCounts = useMemo(() => {
    const map = {};
    pesagensFiltradas.forEach(p => {
      if (p.documento_embarque_id) {
        map[p.documento_embarque_id] = (map[p.documento_embarque_id] || 0) + 1;
      }
    });
    return map;
  }, [pesagensFiltradas]);

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
          id_sistema: headers.findIndex(h => normalizar(h) === 'id'),
          id_externo: headers.findIndex(h => normalizar(h) === 'idexterno'),
          data: headers.findIndex(h => normalizar(h) === 'data'),
          numero_animal: headers.findIndex(h => normalizar(h) === 'numeroanimal' || normalizar(h) === 'animal'),
          sexo: headers.findIndex(h => normalizar(h) === 'sexo'),
          raca: headers.findIndex(h => normalizar(h) === 'raca' || normalizar(h) === 'raça'),
          era: headers.findIndex(h => normalizar(h) === 'era'),
          marca: headers.findIndex(h => normalizar(h) === 'marca'),
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
            id_externo: colMap.id_externo >= 0 ? valores[colMap.id_externo] : null,
            data_pesagem: colMap.data >= 0 ? parseDataBR(valores[colMap.data]) : null,
            numero_animal: colMap.numero_animal >= 0 ? valores[colMap.numero_animal] : null,
            sexo: colMap.sexo >= 0 ? valores[colMap.sexo]?.toUpperCase() : null,
            raca: colMap.raca >= 0 ? valores[colMap.raca] : null,
            era: colMap.era >= 0 ? valores[colMap.era] : null,
            marca: colMap.marca >= 0 ? valores[colMap.marca] : null,
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

          // Se for SN, limpar campos de ganho/GMD
          const isSN = registro.numero_animal?.toUpperCase() === 'SN';
          if (isSN) {
            registro.data_anterior = null;
            registro.peso_anterior = null;
            registro.dias = null;
            registro.ganho = null;
            registro.gmd = null;
          }

          dados.push(registro);
        }

        // Verificar se há lotes/apartações no arquivo que existem no sistema
        const lotesNoArquivo = [...new Set(dados.filter(d => d.nome_lote && d.nome_apartacao).map(d => `${d.nome_lote}|${d.nome_apartacao}`))];
        const lotesEncontrados = [];
        
        for (const loteKey of lotesNoArquivo) {
          const [nomeLote, nomeApartacao] = loteKey.split('|');
          
          // Buscar apartação pelo nome
          const apartacao = apartacoesData.find(a => a.nome_apartacao?.toUpperCase() === nomeApartacao?.toUpperCase());
          if (apartacao) {
            // Buscar lote pelo nome dentro da apartação
            const lote = lotesData.find(l => 
              l.apartacao_id === apartacao.id && 
              l.nome_lote?.toUpperCase() === nomeLote?.toUpperCase()
            );
            if (lote) {
              lotesEncontrados.push({
                nome_lote: nomeLote,
                nome_apartacao: nomeApartacao,
                lote_id: lote.id,
                apartacao_id: apartacao.id,
                quantidade: dados.filter(d => d.nome_lote === nomeLote && d.nome_apartacao === nomeApartacao).length
              });
            }
          }
        }

        setImportData(dados);
        setImportErrors(erros);
        
        if (lotesEncontrados.length > 0) {
          setLotesParaVincular(lotesEncontrados);
          // Inicializar todos como selecionados para vincular
          const selecionados = {};
          lotesEncontrados.forEach(l => {
            selecionados[`${l.nome_lote}|${l.nome_apartacao}`] = true;
          });
          setVincularLotesSelecionados(selecionados);
          setShowVincularLotes(true);
        } else {
          setShowImportDialog(true);
        }
      } catch (error) {
        toast.error('Erro ao processar arquivo: ' + error.message);
      }
    };
    reader.readAsText(file, 'UTF-8');
    event.target.value = '';
  };

  const confirmarVinculacaoLotes = () => {
    // Verificar se algum lote foi recusado
    const lotesRecusados = lotesParaVincular.filter(l => !vincularLotesSelecionados[`${l.nome_lote}|${l.nome_apartacao}`]);
    
    if (lotesRecusados.length > 0) {
      // Remover registros dos lotes recusados do importData
      const lotesRecusadosKeys = lotesRecusados.map(l => `${l.nome_lote}|${l.nome_apartacao}`);
      const dadosFiltrados = importData.filter(d => {
        const key = `${d.nome_lote}|${d.nome_apartacao}`;
        return !lotesRecusadosKeys.includes(key);
      });
      
      const removidos = importData.length - dadosFiltrados.length;
      toast.info(`${removidos} registros removidos por não vincular aos lotes existentes`);
      setImportData(dadosFiltrados);
    }
    
    // Vincular lote_id e apartacao_id aos registros aceitos
    const lotesAceitos = lotesParaVincular.filter(l => vincularLotesSelecionados[`${l.nome_lote}|${l.nome_apartacao}`]);
    const dadosAtualizados = importData.map(item => {
      const loteEncontrado = lotesAceitos.find(l => 
        l.nome_lote?.toUpperCase() === item.nome_lote?.toUpperCase() && 
        l.nome_apartacao?.toUpperCase() === item.nome_apartacao?.toUpperCase()
      );
      if (loteEncontrado) {
        return {
          ...item,
          lote_id: loteEncontrado.lote_id,
          apartacao_id: loteEncontrado.apartacao_id
        };
      }
      return item;
    });
    
    setImportData(dadosAtualizados);
    setShowVincularLotes(false);
    setShowImportDialog(true);
  };

  // Estado para texto de progresso detalhado
  const [importProgressText, setImportProgressText] = useState("");

  const confirmarImportacao = async () => {
    if (importData.length === 0) {
      toast.error('Nenhum dado válido para importar');
      return;
    }

    setIsImporting(true);
    setImportProgress(0);
    setImportProgressText("Iniciando importação...");

    try {
      const batchSize = 50;
      let importados = 0;

      for (let i = 0; i < importData.length; i += batchSize) {
        const batch = importData.slice(i, i + batchSize).map(item => ({
          ...item,
          empresa_id: empresaSelecionadaId,
          tipo_manejo: tipoManejoImport,
          motivo_saida: tipoManejoImport === 'Saída' ? motivoSaidaImport : null,
          status_animal: tipoManejoImport === 'Saída' ? 'Inativo' : 'Ativo',
          destino_venda: (tipoManejoImport === 'Saída' && motivoSaidaImport === 'Venda') ? destinoVendaImport : null,
        }));

        setImportProgressText(`Importando registros ${i + 1} a ${Math.min(i + batchSize, importData.length)} de ${importData.length}...`);
        await base44.entities.PesagemIndividual.bulkCreate(batch);
        importados += batch.length;
        setImportProgress(Math.round((importados / importData.length) * 100));
      }

      setImportProgressText("Finalizando...");
      toast.success(`${importados} pesagens importadas com sucesso!`);
      setShowImportDialog(false);
      setImportData([]);
      setImportErrors([]);
      setLotesParaVincular([]);
      setVincularLotesSelecionados({});
      setTipoManejoImport('Manejo');
      setMotivoSaidaImport('');
      setDestinoVendaImport('');
      queryClient.invalidateQueries({ queryKey: ['pesagens-individuais'] });
    } catch (error) {
      toast.error('Erro ao importar: ' + error.message);
    } finally {
      setIsImporting(false);
      setImportProgressText("");
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

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      await base44.entities.PesagemIndividual.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pesagens-individuais'] });
    },
  });

  const handleEditarLote = () => {
    if (selectedItems.length === 0) {
      toast.error('Selecione ao menos um registro!');
      return;
    }
    setShowEditarLote(true);
  };

  const [progressoEdicao, setProgressoEdicao] = useState({ show: false, current: 0, total: 0, texto: "" });

  const confirmarEdicaoLote = async () => {
    const dadosParaAtualizar = {};
    if (edicaoLote.data_pesagem) dadosParaAtualizar.data_pesagem = edicaoLote.data_pesagem;
    if (edicaoLote.sexo) dadosParaAtualizar.sexo = edicaoLote.sexo;
    if (edicaoLote.raca) dadosParaAtualizar.raca = edicaoLote.raca;
    if (edicaoLote.era) dadosParaAtualizar.era = edicaoLote.era;
    if (edicaoLote.marca) dadosParaAtualizar.marca = edicaoLote.marca;
    
    // Apartação e Lote
    if (edicaoLote.apartacao) {
      const apt = apartacoesData.find(a => a.id === edicaoLote.apartacao);
      dadosParaAtualizar.apartacao_id = edicaoLote.apartacao;
      dadosParaAtualizar.nome_apartacao = apt?.nome_apartacao || "";
    }
    if (edicaoLote.lote) {
      const lote = lotesData.find(l => l.id === edicaoLote.lote);
      dadosParaAtualizar.lote_id = edicaoLote.lote;
      dadosParaAtualizar.nome_lote = lote?.nome_lote || "";
    }

    if (Object.keys(dadosParaAtualizar).length === 0) {
      toast.error('Preencha ao menos um campo!');
      return;
    }

    setProgressoEdicao({ show: true, current: 0, total: selectedItems.length, texto: "Iniciando atualização..." });
    
    try {
      const batchSize = 10;
      let atualizados = 0;

      for (let i = 0; i < selectedItems.length; i += batchSize) {
        const batch = selectedItems.slice(i, i + batchSize);
        setProgressoEdicao({
          show: true,
          current: i,
          total: selectedItems.length,
          texto: `Atualizando registros ${i + 1} a ${Math.min(i + batchSize, selectedItems.length)} de ${selectedItems.length}...`
        });

        await Promise.all(batch.map(id => updateMutation.mutateAsync({ id, data: dadosParaAtualizar })));
        atualizados += batch.length;
        
        setProgressoEdicao(prev => ({ ...prev, current: atualizados }));
      }

      toast.success(`✓ ${selectedItems.length} registro(s) atualizado(s)!`);
      setShowEditarLote(false);
      setEdicaoLote({ data_pesagem: "", sexo: "", raca: "", era: "", marca: "", apartacao: "", lote: "" });
      setSelectedItems([]);
    } catch (error) {
      toast.error('Erro na atualização: ' + error.message);
    } finally {
      setProgressoEdicao({ show: false, current: 0, total: 0, texto: "" });
    }
  };

  const handleExcluirPesagem = async (id) => {
    if (confirm('Excluir este registro?')) {
      await base44.entities.PesagemIndividual.delete(id);
      toast.success('Excluído!');
      queryClient.invalidateQueries({ queryKey: ['pesagens-individuais'] });
    }
  };

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
    setFiltroPesoMin("");
    setFiltroPesoMax("");
    setFiltroMarca("");
    setFiltroObservacao("");
    setFiltroDataEspecifica("");
    setFiltroTipoManejo("");
    setFiltroStatus("");
    setCurrentPage(1);
  };

  const baixarModelo = () => {
    const headers = ['ID', 'ID_Externo', 'Data', 'NumeroAnimal', 'Sexo', 'Raça', 'Era', 'Marca', 'Peso', 'Lote', 'Apartação', 'Observação', 'DataAnterior', 'PesoAnterior', 'Dias', 'Ganho', 'GMD'];
    const exemplo1 = ['', '22207', '01/12/2025', '4368', 'M', 'Nelore', '2A', 'ABC', '206', 'MEIO', 'ROTINA', '', '15/11/2025', '180', '16', '26', '1.625'];
    const exemplo2 = ['', '22206', '01/12/2025', '4369', 'M', 'Nelore', '3A', 'XYZ', '287', 'BOIADA', 'ROTINA', '', '15/11/2025', '260', '16', '27', '1.687'];
    const exemplo3 = ['', '22205', '01/12/2025', '4370', 'F', 'Nelore', '1A', '', '212', 'MEIO', 'ROTINA', '', '', '', '', '', ''];
    
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
    const headers = ['ID', 'ID_Externo', 'Data', 'NumeroAnimal', 'Sexo', 'Raça', 'Era', 'Marca', 'Peso', 'Lote', 'Apartação', 'Observação', 'DataAnterior', 'PesoAnterior', 'Dias', 'Ganho', 'GMD'];
    const rows = pesagensFiltradas.map(p => [
      p.id || '',
      p.id_externo || '',
      formatarData(p.data_pesagem),
      p.numero_animal || '',
      p.sexo || '',
      p.raca || '',
      p.era || '',
      p.marca || '',
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
    if (selectedItems.length === pesagensFiltradas.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(pesagensFiltradas.map(p => p.id));
    }
  };

  const SortIcon = ({ column }) => {
    if (sortConfig.key !== column) {
      return <span className="text-[10px] leading-none text-slate-400">↕</span>;
    }
  return sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
};

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-3 py-2 shadow-sm border-b border-slate-200">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Pesagens Individuais</h1>
          <p className="text-xs text-slate-600">Importação e gestão de pesagens individuais</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => setShowConfigColunas(true)} className="h-8 w-8">
            <Settings className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="h-8 text-xs">
            Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={exportarCSV} className="h-8 text-xs">
            Exportar
          </Button>
          <Button variant="outline" size="sm" onClick={baixarModelo} className="h-8 text-xs">
            Modelo
          </Button>
          <label>
            <Button variant="outline" size="sm" className="h-8 text-xs cursor-pointer" asChild>
              <span>Importar</span>
            </Button>
            <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
          </label>
          <Link to={createPageUrl("LancamentoPesagensIndividuais")}>
            <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
              Lançar Pesagens
            </Button>
          </Link>
        </div>
      </div>





      {/* Filtros */}
      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-10 gap-2">
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
            <Select value={filtroApartacao} onValueChange={(v) => { setFiltroApartacao(v); setFiltroDataEspecifica(""); }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Apartação" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todas</SelectItem>
                {apartacoesUnicas.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroDataEspecifica} onValueChange={setFiltroDataEspecifica}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Data Apar." /></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todas Datas</SelectItem>
                {datasUnicasApartacao.map(d => <SelectItem key={d} value={d}>{formatarData(d)}</SelectItem>)}
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
            <Select value={filtroTipoManejo} onValueChange={setFiltroTipoManejo}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todos</SelectItem>
                <SelectItem value="Cadastro">Cadastro</SelectItem>
                <SelectItem value="Manejo">Manejo</SelectItem>
                <SelectItem value="Entrada">Entrada</SelectItem>
                <SelectItem value="Saída">Saída</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todos</SelectItem>
                <SelectItem value="Ativo">Ativo</SelectItem>
                <SelectItem value="Inativo">Inativo</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroMarca} onValueChange={setFiltroMarca}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Marca" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todas Marcas</SelectItem>
                <SelectItem value="sem_marca">Sem Marca</SelectItem>
                {marcasExistentes.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroObservacao} onValueChange={setFiltroObservacao}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Observação" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todas</SelectItem>
                <SelectItem value="com_observacao">Com Observação</SelectItem>
                <SelectItem value="sem_observacao">Sem Observação</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" value={filtroDataInicio} onChange={(e) => setFiltroDataInicio(e.target.value)} className="h-8 text-xs" placeholder="Data início" />
            <Input type="date" value={filtroDataFim} onChange={(e) => setFiltroDataFim(e.target.value)} className="h-8 text-xs" placeholder="Data fim" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-2">
            <div className="space-y-1">
              <Label className="text-xs">Peso Mín. (kg)</Label>
              <Input 
                type="number" 
                value={filtroPesoMin}
                onChange={(e) => setFiltroPesoMin(e.target.value)}
                placeholder="Ex: 200"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Peso Máx. (kg)</Label>
              <Input 
                type="number" 
                value={filtroPesoMax}
                onChange={(e) => setFiltroPesoMax(e.target.value)}
                placeholder="Ex: 500"
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div className="flex justify-between items-center mt-2">
            <div className="text-xs text-slate-500">
              {pesagensFiltradas.length} de {pesagens.length} registros
            </div>
            <div className="flex gap-2">
              {selectedItems.length > 0 && (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                        <Layers className="w-3 h-3" />
                        Ações ({selectedItems.length})
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleEditarLote} className="text-xs">
                        Editar Campos em Lote
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleDeleteSelected} className="text-xs text-red-600">
                        Excluir Selecionados
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
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
              <TableHeader>
                <TableRow className="bg-white border-b">
                  {colunasOrdenadas.map((coluna) => {
                    if (coluna.id === 'selecao') {
                      return (
                        <TableHead key="selecao" className="text-xs py-2 px-2">
                          <Checkbox 
                            checked={selectedItems.length === pesagensFiltradas.length && pesagensFiltradas.length > 0}
                            onCheckedChange={toggleSelectAll}
                          />
                        </TableHead>
                      );
                    }
                    if (coluna.id === 'acoes') {
                      return <TableHead key="acoes" className="text-xs py-2 px-2"></TableHead>;
                    }
                    const isRight = ['peso', 'dias', 'ganho', 'gmd'].includes(coluna.id);
                    return (
                      <TableHead 
                        key={coluna.id}
                        className={`text-xs py-2 px-3 cursor-pointer hover:bg-gray-50 ${isRight ? 'text-right' : ''}`}
                        onClick={() => handleSort(coluna.id)}
                      >
                        <div className={`flex items-center gap-1 ${isRight ? 'justify-end' : ''}`}>
                          {coluna.label} <SortIcon column={coluna.id} />
                        </div>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={20} className="text-center py-8 text-xs text-slate-400">Carregando...</TableCell>
                  </TableRow>
                ) : pesagensPaginadas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={20} className="text-center py-8 text-xs text-slate-400">
                      <FileSpreadsheet className="w-12 h-12 mx-auto mb-2 opacity-30" />
                      Nenhuma pesagem encontrada
                    </TableCell>
                  </TableRow>
                ) : (
                  pesagensPaginadas.map((p) => (
                    <TableRow key={p.id} className="hover:bg-gray-50 border-b">
                      {colunasOrdenadas.map((coluna) => {
                        if (coluna.id === 'selecao') {
                          return (
                            <TableCell key="selecao" className="text-xs py-2 px-2">
                              <Checkbox 
                                checked={selectedItems.includes(p.id)}
                                onCheckedChange={(checked) => {
                                  setSelectedItems(prev => checked ? [...prev, p.id] : prev.filter(id => id !== p.id));
                                }}
                              />
                            </TableCell>
                          );
                        }
                        if (coluna.id === 'acoes') {
                          return (
                            <TableCell key="acoes" className="text-xs py-2 px-2 text-center">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6">
                                    <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                 <DropdownMenuItem asChild className="text-xs">
                                   <Link to={createPageUrl(`LancamentoPesagensIndividuais?editar=${p.id}`)}>
                                     Editar
                                   </Link>
                                 </DropdownMenuItem>
                                 <DropdownMenuItem onClick={() => {
                                   setSelectedItems([p.id]);
                                   setShowEditarLote(true);
                                 }} className="text-xs">
                                   Alterar Lote
                                 </DropdownMenuItem>
                                 <DropdownMenuItem onClick={() => handleExcluirPesagem(p.id)} className="text-xs text-red-600">
                                   Excluir
                                 </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          );
                        }
                        if (coluna.id === 'data_pesagem') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3">{formatarData(p.data_pesagem)}</TableCell>;
                        }
                        if (coluna.id === 'tipo_manejo') {
                          return (
                            <TableCell key={coluna.id} className="text-xs py-2 px-3">
                              <Badge 
                                variant="outline" 
                                className={`text-[10px] ${
                                  p.tipo_manejo === 'Cadastro' ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 
                                  p.tipo_manejo === 'Saída' ? 'bg-red-50 text-red-700 border-red-300' :
                                  'bg-blue-50 text-blue-700 border-blue-300'
                                }`}
                              >
                                {p.tipo_manejo || 'Manejo'}
                              </Badge>
                            </TableCell>
                          );
                        }
                        if (coluna.id === 'motivo_saida') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3">{p.motivo_saida || '-'}</TableCell>;
                        }
                        if (coluna.id === 'numero_animal') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3 font-semibold">{p.numero_animal}</TableCell>;
                        }
                        if (coluna.id === 'sexo') {
                          return (
                            <TableCell key={coluna.id} className="text-xs py-2 px-3">
                              {p.sexo === 'M' ? 'Macho' : p.sexo === 'F' ? 'Fêmea' : '-'}
                            </TableCell>
                          );
                        }
                        if (coluna.id === 'valor_pago_cabeca') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3 text-right font-mono">{p.valor_pago_cabeca ? `R$ ${p.valor_pago_cabeca.toFixed(2)}` : '-'}</TableCell>;
                        }
                        if (coluna.id === 'origem_animal') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3">{p.origem_animal || '-'}</TableCell>;
                        }
                        if (coluna.id === 'comprador') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3">{p.comprador || '-'}</TableCell>;
                        }
                        if (coluna.id === 'destino_venda') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3">{p.destino_venda || '-'}</TableCell>;
                        }
                        if (coluna.id === 'valor_venda_total') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3 text-right font-mono">{p.valor_venda_total ? `R$ ${p.valor_venda_total.toFixed(2)}` : '-'}</TableCell>;
                        }
                        if (coluna.id === 'valor_arroba') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3 text-right font-mono">{p.valor_arroba ? `R$ ${p.valor_arroba.toFixed(2)}` : '-'}</TableCell>;
                        }
                        if (coluna.id === 'quantidade_arrobas') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3 text-right font-mono">{p.quantidade_arrobas ? `${p.quantidade_arrobas.toFixed(2)} @` : '-'}</TableCell>;
                        }
                        if (coluna.id === 'frigorifico') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3">{p.frigorifico || '-'}</TableCell>;
                        }
                        if (coluna.id === 'embarque_nome') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3">{p.embarque_nome || '-'}</TableCell>;
                        }
                        if (coluna.id === 'documento_tipo') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3">{p.documento_tipo || '-'}</TableCell>;
                        }
                        if (coluna.id === 'documento_numero') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3">{p.documento_numero || '-'}</TableCell>;
                        }
                        if (coluna.id === 'motorista_nome') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3">{p.motorista_nome || '-'}</TableCell>;
                        }
                        if (coluna.id === 'placa_carreta') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3 uppercase">{p.placa_carreta || '-'}</TableCell>;
                        }
                        if (coluna.id === 'doc_qtd') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3 text-center">{p.documento_embarque_id ? (docCounts[p.documento_embarque_id] || 0) : '-'}</TableCell>;
                        }
                        if (coluna.id === 'raca') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3">{p.raca || '-'}</TableCell>;
                        }
                        if (coluna.id === 'era') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3">{p.era || '-'}</TableCell>;
                        }
                        if (coluna.id === 'peso') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3 text-right font-mono font-semibold">{p.peso?.toLocaleString('pt-BR')} kg</TableCell>;
                        }
                        if (coluna.id === 'nome_lote') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3">{p.nome_lote || '-'}</TableCell>;
                        }
                        if (coluna.id === 'nome_apartacao') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3">{p.nome_apartacao || '-'}</TableCell>;
                        }
                        if (coluna.id === 'dias') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3 text-right font-mono">{p.dias || '-'}</TableCell>;
                        }
                        if (coluna.id === 'ganho') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3 text-right font-mono">{p.ganho ? `${p.ganho.toLocaleString('pt-BR')} kg` : '-'}</TableCell>;
                        }
                        if (coluna.id === 'gmd') {
                          return (
                            <TableCell key={coluna.id} className={`text-xs py-2 px-3 text-right font-mono ${p.gmd && p.gmd > 0 ? 'text-emerald-600' : p.gmd && p.gmd < 0 ? 'text-red-600' : ''}`}>
                              {p.gmd ? p.gmd.toFixed(3) : '-'}
                            </TableCell>
                          );
                        }
                        if (coluna.id === 'marca') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3">{p.marca || '-'}</TableCell>;
                        }
                        if (coluna.id === 'observacao') {
                          return <TableCell key={coluna.id} className="text-xs py-2 px-3">{p.observacao || '-'}</TableCell>;
                        }
                        return <TableCell key={coluna.id} className="text-xs py-2 px-3">-</TableCell>;
                      })}
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

      {/* Dialog de Edição em Lote */}
      <Dialog open={showEditarLote} onOpenChange={setShowEditarLote}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              Editar {selectedItems.length} Registro(s) em Lote
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-3">
            <div className="bg-blue-50 border border-blue-200 rounded p-2">
              <p className="text-xs text-blue-800">
                💡 Apenas campos preenchidos serão atualizados.
              </p>
            </div>

            {progressoEdicao.show && (
              <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
                <div className="flex justify-between text-xs text-emerald-800 mb-1">
                  <span className="font-medium">{progressoEdicao.texto}</span>
                  <span className="font-bold">{Math.round((progressoEdicao.current / progressoEdicao.total) * 100)}%</span>
                </div>
                <div className="w-full bg-emerald-200 rounded-full h-2">
                  <div className="bg-emerald-600 h-2 rounded-full transition-all" style={{ width: `${(progressoEdicao.current / progressoEdicao.total) * 100}%` }} />
                </div>
                <div className="text-[10px] text-emerald-600 mt-1 text-center">
                  {progressoEdicao.current} de {progressoEdicao.total} concluídos
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-xs">Data</Label>
                <Input 
                  type="date"
                  value={edicaoLote.data_pesagem} 
                  onChange={(e) => setEdicaoLote({ ...edicaoLote, data_pesagem: e.target.value })} 
                  className="h-8 text-xs" 
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Sexo</Label>
                <Select value={edicaoLote.sexo} onValueChange={(v) => setEdicaoLote({ ...edicaoLote, sexo: v })}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Não alterar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null} className="text-xs">Não alterar</SelectItem>
                    <SelectItem value="M" className="text-xs">M - Macho</SelectItem>
                    <SelectItem value="F" className="text-xs">F - Fêmea</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Raça</Label>
                <Input 
                  value={edicaoLote.raca} 
                  onChange={(e) => setEdicaoLote({ ...edicaoLote, raca: e.target.value })} 
                  placeholder="Não alterar" 
                  className="h-8 text-xs" 
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Era</Label>
                <Input 
                  value={edicaoLote.era} 
                  onChange={(e) => setEdicaoLote({ ...edicaoLote, era: e.target.value })} 
                  placeholder="Não alterar" 
                  className="h-8 text-xs" 
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Marca</Label>
                <Input 
                  value={edicaoLote.marca} 
                  onChange={(e) => setEdicaoLote({ ...edicaoLote, marca: e.target.value })} 
                  placeholder="Não alterar" 
                  className="h-8 text-xs" 
                />
              </div>

              <div className="border-t pt-2 mt-2">
                <p className="text-xs font-semibold text-slate-600 mb-2">Apartação e Lote</p>
                
                <div className="space-y-1">
                  <Label className="text-xs">Apartação</Label>
                  <Select value={edicaoLote.apartacao} onValueChange={(v) => setEdicaoLote({ ...edicaoLote, apartacao: v, lote: "" })}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Não alterar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null} className="text-xs">Não alterar</SelectItem>
                      {apartacoesData.map(a => (
                        <SelectItem key={a.id} value={a.id} className="text-xs">{a.nome_apartacao}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1 mt-2">
                  <Label className="text-xs">Lote</Label>
                  <Select 
                    value={edicaoLote.lote} 
                    onValueChange={(v) => setEdicaoLote({ ...edicaoLote, lote: v })}
                    disabled={!edicaoLote.apartacao}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder={edicaoLote.apartacao ? "Selecione o lote" : "Selecione apartação primeiro"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null} className="text-xs">Não alterar</SelectItem>
                      {lotesEdicaoFiltrados.map(l => (
                        <SelectItem key={l.id} value={l.id} className="text-xs">{l.nome_lote} ({l.peso_minimo}-{l.peso_maximo}kg)</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setShowEditarLote(false)} size="sm" className="h-7 text-xs" disabled={progressoEdicao.show}>
                Cancelar
              </Button>
              <Button onClick={confirmarEdicaoLote} size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={progressoEdicao.show}>
                {progressoEdicao.show ? 'Atualizando...' : `Atualizar ${selectedItems.length}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog de Configuração de Colunas */}
      <Dialog open={showConfigColunas} onOpenChange={setShowConfigColunas}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">Configurar Colunas</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-3 flex-1 overflow-auto">
            <div className="space-y-1">
              <p className="text-xs text-slate-600 font-semibold">Visibilidade</p>
              <div className="grid grid-cols-2 gap-2">
                {COLUNAS_DISPONIVEIS.filter(c => !c.fixo).map((coluna) => (
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
                        if (!coluna || coluna.fixo) return null;
                        
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

      {/* Dialog de Vinculação de Lotes */}
      <Dialog open={showVincularLotes} onOpenChange={setShowVincularLotes}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="w-5 h-5" />
              Lotes Encontrados no Sistema
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded p-3">
              <p className="text-xs text-amber-800">
                ⚠️ Foram encontrados lotes no arquivo que já existem no sistema. 
                Selecione quais deseja vincular. <strong>Registros de lotes não selecionados serão removidos da importação.</strong>
              </p>
            </div>
            
            <div className="max-h-64 overflow-auto border rounded">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-bold py-1 border border-black w-10">Vincular</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Lote</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Apartação</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd. Registros</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lotesParaVincular.map((lote) => {
                    const key = `${lote.nome_lote}|${lote.nome_apartacao}`;
                    return (
                      <TableRow key={key} className="hover:bg-gray-50">
                        <TableCell className="text-xs py-1 border border-gray-300">
                          <Checkbox 
                            checked={vincularLotesSelecionados[key] || false}
                            onCheckedChange={(checked) => {
                              setVincularLotesSelecionados(prev => ({
                                ...prev,
                                [key]: checked
                              }));
                            }}
                          />
                        </TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300 font-semibold">{lote.nome_lote}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300">{lote.nome_apartacao}</TableCell>
                        <TableCell className="text-xs py-1 border border-gray-300 text-right">{lote.quantidade}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            
            <div className="text-xs text-slate-600">
              {Object.values(vincularLotesSelecionados).filter(v => v).length} de {lotesParaVincular.length} lotes selecionados para vincular
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button 
              variant="outline" 
              onClick={() => {
                setShowVincularLotes(false);
                setImportData([]);
                setLotesParaVincular([]);
                toast.info('Importação cancelada');
              }}
            >
              Cancelar Importação
            </Button>
            <Button onClick={confirmarVinculacaoLotes} className="bg-emerald-600 hover:bg-emerald-700">
              Continuar com Importação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            {/* Seleção de Tipo de Manejo */}
            <Card className="border-emerald-200 bg-emerald-50">
              <CardContent className="p-3 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Tipo de Movimentação *</Label>
                    <Select value={tipoManejoImport} onValueChange={(v) => { setTipoManejoImport(v); setMotivoSaidaImport(''); setDestinoVendaImport(''); }}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Cadastro">Cadastro (Novo Animal)</SelectItem>
                        <SelectItem value="Manejo">Manejo (Pesagem)</SelectItem>
                        <SelectItem value="Saída">Saída (Venda/Morte/Doação)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {tipoManejoImport === 'Saída' && (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs font-semibold">Motivo da Saída *</Label>
                        <Select value={motivoSaidaImport} onValueChange={setMotivoSaidaImport}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Venda">Venda</SelectItem>
                            <SelectItem value="Morte">Morte</SelectItem>
                            <SelectItem value="Doação">Doação</SelectItem>
                            <SelectItem value="Abate">Abate</SelectItem>
                            <SelectItem value="Transferência">Transferência</SelectItem>
                            <SelectItem value="Outros">Outros</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {motivoSaidaImport === 'Venda' && (
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold">Destino da Venda</Label>
                          <Input
                            value={destinoVendaImport}
                            onChange={(e) => setDestinoVendaImport(e.target.value)}
                            placeholder="Ex: Fazenda XYZ"
                            className="h-8 text-xs"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="bg-white border border-emerald-300 rounded p-2">
                  <p className="text-xs text-emerald-800">
                    ℹ️ <strong>{tipoManejoImport}:</strong> {
                      tipoManejoImport === 'Cadastro' 
                        ? 'Novos animais serão marcados como ATIVOS (não calcula ganho de peso)' 
                        : tipoManejoImport === 'Saída'
                        ? 'Animais serão marcados como INATIVOS automaticamente'
                        : 'Pesagem periódica com cálculo de ganho de peso'
                    }
                  </p>
                </div>
              </CardContent>
            </Card>

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
              <div className="space-y-2 bg-blue-50 border border-blue-200 rounded p-3">
                <div className="flex justify-between text-xs text-slate-700">
                  <span className="font-medium">{importProgressText || 'Importando...'}</span>
                  <span className="font-bold text-blue-700">{importProgress}%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3">
                  <div className="bg-emerald-600 h-3 rounded-full transition-all" style={{ width: `${importProgress}%` }} />
                </div>
                <div className="text-[10px] text-slate-500 text-center">
                  Aguarde, não feche esta janela...
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => {
              setShowImportDialog(false);
              setTipoManejoImport('Manejo');
              setMotivoSaidaImport('');
              setDestinoVendaImport('');
            }} disabled={isImporting}>
              Cancelar
            </Button>
            <Button 
              onClick={confirmarImportacao} 
              disabled={isImporting || importData.length === 0 || (tipoManejoImport === 'Saída' && !motivoSaidaImport)} 
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {isImporting ? 'Importando...' : `Importar ${importData.length} Registros`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}