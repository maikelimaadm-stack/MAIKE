import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";
import TarefaDetalhesDialog from "@/components/tarefas/TarefaDetalhesDialog";
import { MoreVertical, ArrowUpDown, ArrowUp, ArrowDown, Filter, X } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

const PRIORIDADE_CORES = {
  Baixa: "bg-blue-300 text-black hover:bg-blue-300",
  Média: "bg-yellow-300 text-black hover:bg-yellow-300",
  Alta: "bg-red-400 text-black hover:bg-red-400",
  Concluida: "bg-slate-300 text-black hover:bg-slate-300"
};

const STATUS_CORES = {
  Pendente: "bg-yellow-300 text-black hover:bg-yellow-300",
  "Em Andamento": "bg-blue-300 text-black hover:bg-blue-300",
  Concluída: "bg-emerald-300 text-black hover:bg-emerald-300",
  Cancelada: "bg-slate-300 text-black hover:bg-slate-300"
};

const COLUNAS_DISPONIVEIS = [
  { id: "selecao", label: "Seleção", default: true, fixo: true, width: 44 },
  { id: "acoes", label: "Ações", default: true, fixo: true, width: 44 },
  { id: "titulo", label: "Tarefa", default: true, sortable: true, align: "left", width: 220 },
  { id: "descricao", label: "Descrição", default: true, sortable: false, align: "left", width: 240 },
  { id: "prioridade", label: "Prioridade", default: true, sortable: true, align: "left", width: 120 },
  { id: "status", label: "Status", default: true, sortable: true, align: "left", width: 130 },
  { id: "grupo_atividade_nome", label: "Grupo", default: true, sortable: true, align: "left", width: 170 },
  { id: "tipo", label: "Tipo Base", default: true, sortable: true, align: "left", width: 160 },
  { id: "tipo_tarefa_nome", label: "Tipo de Tarefa", default: true, sortable: true, align: "left", width: 180 },
  { id: "setor_nome", label: "Fazenda", default: true, sortable: true, align: "left", width: 160 },
  { id: "area_nome", label: "Área", default: true, sortable: true, align: "left", width: 160 },
  { id: "solicitante", label: "Solicitante", default: true, sortable: true, align: "left", width: 160 },
  { id: "responsavel", label: "Responsável", default: true, sortable: true, align: "left", width: 160 },
  { id: "data_pedido", label: "Data Pedido", default: true, sortable: true, align: "left", width: 120 },
  { id: "data_prevista", label: "Prazo", default: true, sortable: true, align: "left", width: 120 },
  { id: "data_conclusao", label: "Conclusão", default: true, sortable: true, align: "left", width: 120 },
  { id: "observacoes", label: "Observações", default: true, sortable: false, align: "left", width: 220 },
  { id: "observacoes_conclusao", label: "Obs. Conclusão", default: true, sortable: false, align: "left", width: 220 }
];

const DEFAULT_VISIBLE_COLUMNS = COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
const COLUMN_WIDTHS_KEY = "colunas_largura_gestao_tarefas";
const MIN_COLUMN_WIDTH = 80;

export default function TabelaLancamentosTarefas({
  tarefas,
  grupos,
  onDelete,
  normalizeTaskPriority,
  showConfigColunas,
  setShowConfigColunas
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("__TODOS__");
  const [filtroPrioridade, setFiltroPrioridade] = useState("__TODOS__");
  const [filtroGrupo, setFiltroGrupo] = useState("__TODOS__");
  const [filtroTipoTarefa, setFiltroTipoTarefa] = useState("__TODOS__");
  const [filtroArea, setFiltroArea] = useState("__TODOS__");
  const [filtroSetor, setFiltroSetor] = useState("__TODOS__");
  const [filtroTitulo, setFiltroTitulo] = useState("");
  const [filtroDescricao, setFiltroDescricao] = useState("");
  const [filtroResponsavel, setFiltroResponsavel] = useState("");
  const [filtroSolicitante, setFiltroSolicitante] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "titulo", direction: "asc" });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [selectedItems, setSelectedItems] = useState([]);
  const [detalheTarefa, setDetalheTarefa] = useState(null);
  const [columnWidths, setColumnWidths] = useState(() => {
    const defaults = Object.fromEntries(COLUNAS_DISPONIVEIS.map((coluna) => [coluna.id, coluna.width || 160]));
    const saved = localStorage.getItem(COLUMN_WIDTHS_KEY);
    if (!saved) return defaults;
    try {
      return { ...defaults, ...JSON.parse(saved) };
    } catch {
      return defaults;
    }
  });

  const resizeRef = useRef(null);
  const lastTapRef = useRef({ id: null, time: 0 });

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem("colunas_ordem_gestao_tarefas");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.map((c) => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.map((c) => c.id);
  });

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem("colunas_visiveis_gestao_tarefas");
    if (saved) {
      try {
        return Array.from(new Set([...JSON.parse(saved), ...DEFAULT_VISIBLE_COLUMNS]));
      } catch {
        return DEFAULT_VISIBLE_COLUMNS;
      }
    }
    return DEFAULT_VISIBLE_COLUMNS;
  });

  useEffect(() => {
    localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    const handleMouseMove = (event) => {
      if (!resizeRef.current) return;
      const { columnId, startX, startWidth } = resizeRef.current;
      const nextWidth = Math.max(MIN_COLUMN_WIDTH, startWidth + (event.clientX - startX));
      setColumnWidths((prev) => ({ ...prev, [columnId]: nextWidth }));
    };

    const handleMouseUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  useEffect(() => {
    setSelectedItems((prev) => prev.filter((id) => tarefas.some((item) => item.id === id)));
  }, [tarefas]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filtroStatus, filtroPrioridade, filtroGrupo, filtroTipoTarefa, filtroArea, filtroSetor, filtroTitulo, filtroDescricao, filtroResponsavel, filtroSolicitante, itemsPerPage]);

  const toggleColuna = (colunaId) => {
    const novas = colunasVisiveis.includes(colunaId)
      ? colunasVisiveis.filter((id) => id !== colunaId)
      : [...colunasVisiveis, colunaId];
    setColunasVisiveis(novas);
    localStorage.setItem("colunas_visiveis_gestao_tarefas", JSON.stringify(novas));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);
    setColunasOrdem(items);
    localStorage.setItem("colunas_ordem_gestao_tarefas", JSON.stringify(items));
  };

  const colunasOrdenadas = useMemo(() => {
    return colunasOrdem
      .map((id) => COLUNAS_DISPONIVEIS.find((coluna) => coluna.id === id))
      .filter((coluna) => coluna && colunasVisiveis.includes(coluna.id));
  }, [colunasOrdem, colunasVisiveis]);

  const setores = useMemo(() => [...new Set(tarefas.map((item) => item.setor_nome).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" })), [tarefas]);
  const tiposTarefa = useMemo(() => [...new Set(tarefas.map((item) => item.tipo_tarefa_nome || item.tipo).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" })), [tarefas]);
  const areas = useMemo(() => [...new Set(tarefas.map((item) => item.area_nome).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" })), [tarefas]);

  const abrirDetalhe = (tarefa) => setDetalheTarefa(tarefa);

  const handleRowTouch = (tarefa, event) => {
    const now = Date.now();
    if (lastTapRef.current.id === tarefa.id && now - lastTapRef.current.time < 300) {
      event.preventDefault();
      abrirDetalhe(tarefa);
    }
    lastTapRef.current = { id: tarefa.id, time: now };
  };

  const tarefasFiltradas = useMemo(() => {
    return tarefas.filter((tarefa) => {
      const termo = searchTerm.toLowerCase();
      const prioridade = normalizeTaskPriority(tarefa.prioridade);
      const matchSearch = !termo || [
        tarefa.titulo,
        tarefa.descricao,
        tarefa.tipo,
        tarefa.tipo_tarefa_nome,
        tarefa.grupo_atividade_nome,
        tarefa.area_nome,
        tarefa.responsavel,
        tarefa.solicitante,
        tarefa.setor_nome,
        tarefa.observacoes,
        tarefa.observacoes_conclusao
      ].some((value) => String(value || "").toLowerCase().includes(termo));

      const matchStatus = filtroStatus === "__TODOS__" || tarefa.status === filtroStatus;
      const matchPrioridade = filtroPrioridade === "__TODOS__" || prioridade === filtroPrioridade;
      const matchGrupo = filtroGrupo === "__TODOS__" || tarefa.grupo_atividade_nome === filtroGrupo;
      const matchTipoTarefa = filtroTipoTarefa === "__TODOS__" || (tarefa.tipo_tarefa_nome || tarefa.tipo) === filtroTipoTarefa;
      const matchArea = filtroArea === "__TODOS__" || tarefa.area_nome === filtroArea;
      const matchSetor = filtroSetor === "__TODOS__" || tarefa.setor_nome === filtroSetor;
      const matchTitulo = !filtroTitulo || String(tarefa.titulo || "").toLowerCase().includes(filtroTitulo.toLowerCase());
      const matchDescricao = !filtroDescricao || String(tarefa.descricao || "").toLowerCase().includes(filtroDescricao.toLowerCase());
      const matchResponsavel = !filtroResponsavel || String(tarefa.responsavel || "").toLowerCase().includes(filtroResponsavel.toLowerCase());
      const matchSolicitante = !filtroSolicitante || String(tarefa.solicitante || "").toLowerCase().includes(filtroSolicitante.toLowerCase());

      return matchSearch && matchStatus && matchPrioridade && matchGrupo && matchTipoTarefa && matchArea && matchSetor && matchTitulo && matchDescricao && matchResponsavel && matchSolicitante;
    });
  }, [tarefas, searchTerm, filtroStatus, filtroPrioridade, filtroGrupo, filtroTipoTarefa, filtroArea, filtroSetor, filtroTitulo, filtroDescricao, filtroResponsavel, filtroSolicitante, normalizeTaskPriority]);

  const tarefasOrdenadas = useMemo(() => {
    const sorted = [...tarefasFiltradas];
    sorted.sort((a, b) => {
      const resolve = (item) => {
        if (sortConfig.key === "prioridade") return String(normalizeTaskPriority(item.prioridade) || "").toLowerCase();
        if (sortConfig.key === "tipo_tarefa_nome") return String(item.tipo_tarefa_nome || item.tipo || "").toLowerCase();
        return String(item[sortConfig.key] || "").toLowerCase();
      };
      const aVal = resolve(a);
      const bVal = resolve(b);
      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [tarefasFiltradas, sortConfig, normalizeTaskPriority]);

  const totalPages = Math.max(1, Math.ceil(tarefasOrdenadas.length / itemsPerPage));
  const tarefasPaginadas = tarefasOrdenadas.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSort = (key) => {
    setSortConfig((prev) => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }));
  };

  const iniciarResize = (event, colunaId) => {
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      columnId: colunaId,
      startX: event.clientX,
      startWidth: columnWidths[colunaId] || 160
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const SortIcon = ({ column }) => {
    if (sortConfig.key !== column) return <ArrowUpDown className="w-3 h-3 ml-1 text-slate-300" />;
    return sortConfig.direction === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 text-slate-300" />
      : <ArrowDown className="w-3 h-3 ml-1 text-emerald-600" />;
  };

  const toggleSelectAll = () => {
    if (selectedItems.length === tarefasFiltradas.length && tarefasFiltradas.length > 0) {
      setSelectedItems([]);
      return;
    }
    setSelectedItems(tarefasFiltradas.map((item) => item.id));
  };

  const formatarData = (data) => {
    if (!data) return "-";
    const d = new Date(data + "T00:00:00");
    return d.toLocaleDateString("pt-BR");
  };

  const limparFiltros = () => {
    setSearchTerm("");
    setFiltroStatus("__TODOS__");
    setFiltroPrioridade("__TODOS__");
    setFiltroGrupo("__TODOS__");
    setFiltroTipoTarefa("__TODOS__");
    setFiltroArea("__TODOS__");
    setFiltroSetor("__TODOS__");
    setFiltroTitulo("");
    setFiltroDescricao("");
    setFiltroResponsavel("");
    setFiltroSolicitante("");
  };

  const renderCell = (tarefa, colunaId) => {
    const prioridade = normalizeTaskPriority(tarefa.prioridade);
    const prioridadeClassName = tarefa.status === "Concluída" ? PRIORIDADE_CORES.Concluida : PRIORIDADE_CORES[prioridade] || PRIORIDADE_CORES.Baixa;

    if (colunaId === "titulo") return tarefa.titulo || "-";
    if (colunaId === "descricao") return tarefa.descricao || "-";
    if (colunaId === "prioridade") return <div className="flex items-center gap-2"><Badge className={`text-[10px] ${prioridadeClassName}`}>{prioridade || "-"}</Badge></div>;
    if (colunaId === "status") return <Badge className={`text-[10px] ${STATUS_CORES[tarefa.status] || STATUS_CORES.Pendente}`}>{tarefa.status || "-"}</Badge>;
    if (colunaId === "grupo_atividade_nome") return tarefa.grupo_atividade_nome || "-";
    if (colunaId === "tipo") return tarefa.tipo || "-";
    if (colunaId === "tipo_tarefa_nome") return tarefa.tipo_tarefa_nome || tarefa.tipo || "-";
    if (colunaId === "setor_nome") return tarefa.setor_nome || "-";
    if (colunaId === "area_nome") return tarefa.area_nome || "-";
    if (colunaId === "responsavel") return tarefa.responsavel || "-";
    if (colunaId === "data_pedido") return formatarData(tarefa.data_pedido);
    if (colunaId === "data_prevista") return formatarData(tarefa.data_prevista);
    if (colunaId === "data_conclusao") return formatarData(tarefa.data_conclusao);
    if (colunaId === "solicitante") return tarefa.solicitante || "-";
    if (colunaId === "observacoes") return tarefa.observacoes || "-";
    if (colunaId === "observacoes_conclusao") return tarefa.observacoes_conclusao || "-";
    return "-";
  };

  const hasActiveFilter = (colunaId) => {
    return (colunaId === "titulo" && filtroTitulo) ||
      (colunaId === "descricao" && filtroDescricao) ||
      (colunaId === "prioridade" && filtroPrioridade !== "__TODOS__") ||
      (colunaId === "status" && filtroStatus !== "__TODOS__") ||
      (colunaId === "grupo_atividade_nome" && filtroGrupo !== "__TODOS__") ||
      ((colunaId === "tipo_tarefa_nome" || colunaId === "tipo") && filtroTipoTarefa !== "__TODOS__") ||
      (colunaId === "setor_nome" && filtroSetor !== "__TODOS__") ||
      (colunaId === "area_nome" && filtroArea !== "__TODOS__") ||
      (colunaId === "responsavel" && filtroResponsavel) ||
      (colunaId === "solicitante" && filtroSolicitante);
  };

  const clearColumnFilter = (colunaId) => {
    if (colunaId === "titulo") setFiltroTitulo("");
    if (colunaId === "descricao") setFiltroDescricao("");
    if (colunaId === "prioridade") setFiltroPrioridade("__TODOS__");
    if (colunaId === "status") setFiltroStatus("__TODOS__");
    if (colunaId === "grupo_atividade_nome") setFiltroGrupo("__TODOS__");
    if (colunaId === "tipo_tarefa_nome" || colunaId === "tipo") setFiltroTipoTarefa("__TODOS__");
    if (colunaId === "setor_nome") setFiltroSetor("__TODOS__");
    if (colunaId === "area_nome") setFiltroArea("__TODOS__");
    if (colunaId === "responsavel") setFiltroResponsavel("");
    if (colunaId === "solicitante") setFiltroSolicitante("");
  };

  const renderFilterControl = (colunaId) => {
    const buttonClass = `h-3 w-3 min-w-3 p-0 ${hasActiveFilter(colunaId) ? "text-emerald-600" : "text-slate-300 hover:text-slate-400"}`;

    if (colunaId === "titulo") {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className={buttonClass}><Filter className="w-2 h-2" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 p-2">
            <Input value={filtroTitulo} onChange={(e) => setFiltroTitulo(e.target.value)} placeholder="Filtrar tarefa" className="h-6 text-[10px]" />
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    if (colunaId === "descricao") {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className={buttonClass}><Filter className="w-2 h-2" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 p-2">
            <Input value={filtroDescricao} onChange={(e) => setFiltroDescricao(e.target.value)} placeholder="Filtrar descrição" className="h-6 text-[10px]" />
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    if (colunaId === "prioridade") {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className={buttonClass}><Filter className="w-2 h-2" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 p-2">
            <Select value={filtroPrioridade} onValueChange={setFiltroPrioridade}>
              <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__TODOS__">Todos</SelectItem>
                <SelectItem value="Baixa">Baixa</SelectItem>
                <SelectItem value="Média">Média</SelectItem>
                <SelectItem value="Alta">Alta</SelectItem>
              </SelectContent>
            </Select>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    if (colunaId === "status") {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className={buttonClass}><Filter className="w-2 h-2" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 p-2">
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__TODOS__">Todos</SelectItem>
                <SelectItem value="Pendente">Pendente</SelectItem>
                <SelectItem value="Em Andamento">Em Andamento</SelectItem>
                <SelectItem value="Concluída">Concluída</SelectItem>
                <SelectItem value="Cancelada">Cancelada</SelectItem>
              </SelectContent>
            </Select>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    if (colunaId === "grupo_atividade_nome") {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className={buttonClass}><Filter className="w-2 h-2" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 p-2">
            <Select value={filtroGrupo} onValueChange={setFiltroGrupo}>
              <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__TODOS__">Todos</SelectItem>
                {grupos.map((grupo) => <SelectItem key={grupo} value={grupo}>{grupo}</SelectItem>)}
              </SelectContent>
            </Select>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    if (colunaId === "tipo_tarefa_nome" || colunaId === "tipo") {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className={buttonClass}><Filter className="w-2 h-2" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 p-2">
            <Select value={filtroTipoTarefa} onValueChange={setFiltroTipoTarefa}>
              <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__TODOS__">Todos</SelectItem>
                {tiposTarefa.map((tipo) => <SelectItem key={tipo} value={tipo}>{tipo}</SelectItem>)}
              </SelectContent>
            </Select>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    if (colunaId === "setor_nome") {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className={buttonClass}><Filter className="w-2 h-2" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 p-2">
            <Select value={filtroSetor} onValueChange={setFiltroSetor}>
              <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__TODOS__">Todos</SelectItem>
                {setores.map((setor) => <SelectItem key={setor} value={setor}>{setor}</SelectItem>)}
              </SelectContent>
            </Select>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    if (colunaId === "area_nome") {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className={buttonClass}><Filter className="w-2 h-2" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 p-2">
            <Select value={filtroArea} onValueChange={setFiltroArea}>
              <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__TODOS__">Todos</SelectItem>
                {areas.map((area) => <SelectItem key={area} value={area}>{area}</SelectItem>)}
              </SelectContent>
            </Select>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    if (colunaId === "responsavel") {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className={buttonClass}><Filter className="w-2 h-2" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 p-2">
            <Input value={filtroResponsavel} onChange={(e) => setFiltroResponsavel(e.target.value)} placeholder="Filtrar responsável" className="h-6 text-[10px]" />
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    if (colunaId === "solicitante") {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className={buttonClass}><Filter className="w-2 h-2" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 p-2">
            <Input value={filtroSolicitante} onChange={(e) => setFiltroSolicitante(e.target.value)} placeholder="Filtrar solicitante" className="h-6 text-[10px]" />
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    return null;
  };

  return (
    <div className="space-y-1">
      <Card>
        <CardContent className="p-0">
          <div className="relative w-full overflow-auto max-h-[calc(100vh-220px)]">
            <Table className="w-full min-w-[900px] border-separate border-spacing-0 table-fixed">
              <TableHeader className="bg-white">
                <TableRow className="sticky top-0 z-30 bg-white">
                  {colunasOrdenadas.map((coluna) => {
                    const width = columnWidths[coluna.id] || coluna.width || 160;

                    if (coluna.id === "selecao") {
                      return (
                        <TableHead
                          key="selecao"
                          style={{ width, minWidth: width, maxWidth: width }}
                          className="sticky top-0 left-0 z-40 h-7 p-0 bg-white text-muted-foreground font-medium text-center align-middle px-0 border-r border-b border-gray-200"
                        >
                          <Checkbox checked={selectedItems.length === tarefasFiltradas.length && tarefasFiltradas.length > 0} onCheckedChange={toggleSelectAll} className="peer shrink-0 shadow disabled:opacity-50 h-4 w-4 rounded-full border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                        </TableHead>
                      );
                    }

                    if (coluna.id === "acoes") {
                      return (
                        <TableHead
                          key="acoes"
                          style={{ width, minWidth: width, maxWidth: width }}
                          className="sticky top-0 left-0 z-40 h-7 p-0 bg-white text-muted-foreground font-medium text-center align-middle px-0 border-r border-b border-gray-200"
                        />
                      );
                    }

                    const filterControl = renderFilterControl(coluna.id);

                    return (
                      <TableHead
                        key={coluna.id}
                        style={{ width, minWidth: width, maxWidth: width }}
                        className="sticky top-0 h-7 relative align-middle text-gray-900 px-2 pr-7 text-xs font-medium text-center border-r border-b border-gray-200 bg-white whitespace-nowrap"
                        onClick={() => coluna.sortable && handleSort(coluna.id)}
                      >
                        <div className="inline-flex items-center justify-center gap-1 h-full w-full whitespace-nowrap overflow-hidden text-ellipsis">
                          {coluna.label}
                          {coluna.sortable && <SortIcon column={coluna.id} />}
                        </div>

                        {filterControl && (
                          <div className="absolute right-2 top-1/2 -translate-y-1/2 z-20 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            {filterControl}
                            {hasActiveFilter(coluna.id) && (
                              <Button variant="ghost" size="icon" className="h-3 w-3 min-w-3 p-0 text-slate-400 hover:text-slate-600" onClick={() => clearColumnFilter(coluna.id)}>
                                <X className="w-2 h-2" />
                              </Button>
                            )}
                          </div>
                        )}

                        <div
                          className="absolute top-0 right-0 h-full w-2 cursor-col-resize"
                          onMouseDown={(event) => iniciarResize(event, coluna.id)}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>

              <TableBody>
                {tarefasPaginadas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">
                      Nenhuma tarefa encontrada
                    </TableCell>
                  </TableRow>
                ) : (
                  tarefasPaginadas.map((tarefa) => (
                    <TableRow
                      key={tarefa.id}
                      className="data-[state=selected]:bg-muted transition-colors border-b hover:bg-gray-100"
                      onDoubleClick={() => abrirDetalhe(tarefa)}
                      onTouchEnd={(event) => handleRowTouch(tarefa, event)}
                    >
                      {colunasOrdenadas.map((coluna) => {
                        const width = columnWidths[coluna.id] || coluna.width || 160;

                        if (coluna.id === "selecao") {
                          return (
                            <TableCell
                              key={`${tarefa.id}-selecao`}
                              style={{ width, minWidth: width, maxWidth: width }}
                              className="p-0 bg-white text-muted-foreground font-medium text-center sticky left-0 z-10 align-middle px-0 h-7 border-r border-b border-gray-300"
                              onClick={(event) => event.stopPropagation()}
                              onTouchEnd={(event) => event.stopPropagation()}
                            >
                              <Checkbox checked={selectedItems.includes(tarefa.id)} onCheckedChange={(checked) => setSelectedItems((prev) => checked ? [...prev, tarefa.id] : prev.filter((id) => id !== tarefa.id))} className="peer shrink-0 shadow disabled:opacity-50 h-4 w-4 rounded-full border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                            </TableCell>
                          );
                        }

                        if (coluna.id === "acoes") {
                          return (
                            <TableCell
                              key={`${tarefa.id}-acoes`}
                              style={{ width, minWidth: width, maxWidth: width }}
                              className="p-0 bg-white text-muted-foreground font-medium text-center sticky left-0 z-10 align-middle px-0 h-7 border-r border-b border-gray-300"
                              onClick={(event) => event.stopPropagation()}
                              onTouchEnd={(event) => event.stopPropagation()}
                            >
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6">
                                    <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                  <DropdownMenuItem asChild className="text-xs">
                                    <Link to={createPageUrl(`LancamentoTarefaForm?id=${tarefa.id}`)}>Editar</Link>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => onDelete(tarefa.id)} className="text-xs text-red-600">
                                    Excluir
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          );
                        }

                        return (
                          <TableCell
                            key={`${tarefa.id}-${coluna.id}`}
                            style={{ width, minWidth: width, maxWidth: width }}
                            className="px-2 h-7 text-gray-700 text-xs align-middle border-r border-b border-gray-300 whitespace-nowrap overflow-hidden text-ellipsis"
                          >
                            {renderCell(tarefa, coluna.id)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between p-1 border-t">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Itens por página:</span>
              <Select value={String(itemsPerPage)} onValueChange={(v) => { setItemsPerPage(Number(v)); setCurrentPage(1); }}>
                <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[25, 50, 100, 200].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)} className="h-7 text-xs">Anterior</Button>
              <span className="text-xs text-slate-600">Página {currentPage} de {totalPages}</span>
              <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)} className="h-7 text-xs">Próxima</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <ConfiguracaoColunasMapaDialog
        open={showConfigColunas}
        onOpenChange={setShowConfigColunas}
        colunasDisponiveis={COLUNAS_DISPONIVEIS}
        colunasVisiveis={colunasVisiveis}
        colunasOrdem={colunasOrdem}
        toggleColuna={toggleColuna}
        handleDragEnd={handleDragEnd}
        droppableId="colunas-gestao-tarefas"
      />

      <TarefaDetalhesDialog
        open={!!detalheTarefa}
        onOpenChange={(open) => !open && setDetalheTarefa(null)}
        tarefa={detalheTarefa}
        onSaved={(updated) => setDetalheTarefa(updated)}
      />
    </div>
  );
}