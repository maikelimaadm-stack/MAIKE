import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ordenarPorNomeNumerico } from "@/hooks/useSetorAreas";
import { toast } from "sonner";
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";

const VALOR_TODOS = "__TODOS__";
const CORES_DISPONIVEIS = [
  { nome: "Branco", cor: "#f8f9fa" },
  { nome: "Cinza claro", cor: "#d8dee2" },
  { nome: "Preto", cor: "#2c303e" },
  { nome: "Azul escuro", cor: "#0d67ad" },
  { nome: "Azul celeste", cor: "#61aad9" },
  { nome: "Amarelo", cor: "#efcb19" },
  { nome: "Verde claro", cor: "#92ca25" },
  { nome: "Laranja", cor: "#f5a01b" },
  { nome: "Roxo", cor: "#966fe1" },
];
const TIPOS_USO = ["Pastagem", "Agricultura", "Reserva", "APP", "Infraestrutura"];
const APROVEITAMENTO = ["Alta", "Média", "Baixa"];
const TIPOS_CULTURAS = [
  "Brachiaria", "Mombaça", "Tanzânia", "Tifton", "Piatã", "Marandu", "Panicum", "Elefante",
  "Milho", "Soja", "Sorgo", "Arroz", "Trigo", "Cevada", "Cana-de-açúcar", "Algodão",
  "Feijão", "Girassol", "Aveia", "Café", "Eucalipto", "Floresta", "Outros",
];
const COLUNAS_DISPONIVEIS = [
  { id: "selecao", label: "Seleção", default: true, fixo: true },
  { id: "acoes", label: "Ações", default: true, fixo: true },
  { id: "codigo", label: "Código", default: true, sortable: true, align: "left" },
  { id: "sigla", label: "Sigla", default: true, sortable: true, align: "left" },
  { id: "nome", label: "Nome", default: true, sortable: true, align: "left" },
  { id: "uso", label: "Uso", default: true, sortable: true, align: "left" },
  { id: "cultura", label: "Cultura", default: true, sortable: true, align: "left" },
  { id: "tamanho", label: "Tamanho (ha)", default: true, sortable: true, align: "right" },
  { id: "capacidade", label: "Capacidade", default: true, sortable: true, align: "right" },
  { id: "ocupacao", label: "Ocupação", default: true, sortable: true, align: "left" },
  { id: "status", label: "Status", default: true, sortable: true, align: "left" },
];

export default function TabelaAreasGeo({ areas, onEdit, onEditDetalhes, onDelete, showConfigColunas, setShowConfigColunas }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroUso, setFiltroUso] = useState(VALOR_TODOS);
  const [filtroCultura, setFiltroCultura] = useState(VALOR_TODOS);
  const [filtroStatus, setFiltroStatus] = useState(VALOR_TODOS);
  const [filtroSetor, setFiltroSetor] = useState(VALOR_TODOS);
  const [sortConfig, setSortConfig] = useState({ key: "nome", direction: "asc" });
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [selecionados, setSelecionados] = useState([]);
  const [batchType, setBatchType] = useState(null);
  const [batchValue, setBatchValue] = useState("");
  const [startNumber, setStartNumber] = useState("");
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const { data: setores = [] } = useQuery({
    queryKey: ["setores-areas-geo", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Setor.list();
      return ordenarPorNomeNumerico(all.filter((item) => item.empresa_id === empresaSelecionadaId && item.ativo !== false));
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });
  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem("colunas_ordem_areas_geo");
    if (saved) {
      try { return JSON.parse(saved); } catch { return COLUNAS_DISPONIVEIS.map((c) => c.id); }
    }
    return COLUNAS_DISPONIVEIS.map((c) => c.id);
  });
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem("colunas_visiveis_areas_geo");
    if (saved) {
      try { return JSON.parse(saved); } catch { return COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id); }
    }
    return COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filtroUso, filtroCultura, filtroStatus, filtroSetor, itemsPerPage]);

  const toggleColuna = (colunaId) => {
    const novas = colunasVisiveis.includes(colunaId)
      ? colunasVisiveis.filter((id) => id !== colunaId)
      : [...colunasVisiveis, colunaId];
    setColunasVisiveis(novas);
    localStorage.setItem("colunas_visiveis_areas_geo", JSON.stringify(novas));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);
    setColunasOrdem(items);
    localStorage.setItem("colunas_ordem_areas_geo", JSON.stringify(items));
  };

  const colunasOrdenadas = useMemo(() => colunasOrdem.map((id) => COLUNAS_DISPONIVEIS.find((c) => c.id === id)).filter((c) => c && colunasVisiveis.includes(c.id)), [colunasOrdem, colunasVisiveis]);

  const areasFiltradas = useMemo(() => areas.filter((area) => {
    const termo = searchTerm.toLowerCase();
    const matchSearch = !termo || area.nome?.toLowerCase().includes(termo) || area.setor_nome?.toLowerCase().includes(termo) || area.tipo_pastagem?.toLowerCase().includes(termo) || area.tipo_cultura?.toLowerCase().includes(termo) || area.numero_area?.toLowerCase().includes(termo) || area.sigla?.toLowerCase().includes(termo);
    const matchSetor = filtroSetor === VALOR_TODOS || area.setor_id === filtroSetor;
    const matchUso = filtroUso === VALOR_TODOS || area.tipo_cultura === filtroUso;
    const matchCultura = filtroCultura === VALOR_TODOS || area.tipo_pastagem === filtroCultura;
    const matchStatus = filtroStatus === VALOR_TODOS || area.status_ocupacao === filtroStatus;
    return matchSearch && matchSetor && matchUso && matchCultura && matchStatus;
  }), [areas, searchTerm, filtroSetor, filtroUso, filtroCultura, filtroStatus]);

  const areasOrdenadas = useMemo(() => {
    const sorted = [...areasFiltradas];
    sorted.sort((a, b) => {
      let aValue;
      let bValue;
      switch (sortConfig.key) {
        case "tamanho":
          aValue = Number(a.tamanho_hectares || 0);
          bValue = Number(b.tamanho_hectares || 0);
          break;
        case "capacidade":
          aValue = Number(a.capacidade_maxima || 0);
          bValue = Number(b.capacidade_maxima || 0);
          break;
        case "ocupacao":
          aValue = Number(a.quantidade_atual || 0);
          bValue = Number(b.quantidade_atual || 0);
          break;
        case "codigo":
          aValue = String(a.numero_area || "").toLowerCase();
          bValue = String(b.numero_area || "").toLowerCase();
          break;
        case "sigla":
          aValue = String(a.sigla || "").toLowerCase();
          bValue = String(b.sigla || "").toLowerCase();
          break;
        case "uso":
          aValue = String(a.tipo_cultura || "").toLowerCase();
          bValue = String(b.tipo_cultura || "").toLowerCase();
          break;
        case "cultura":
          aValue = String(a.tipo_pastagem || "").toLowerCase();
          bValue = String(b.tipo_pastagem || "").toLowerCase();
          break;
        case "status":
          aValue = String(a.status_ocupacao || "").toLowerCase();
          bValue = String(b.status_ocupacao || "").toLowerCase();
          break;
        case "nome":
        default:
          aValue = String(a.nome || "").toLowerCase();
          bValue = String(b.nome || "").toLowerCase();
      }
      if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [areasFiltradas, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(areasOrdenadas.length / itemsPerPage));
  const areasPaginadas = areasOrdenadas.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSort = (key) => setSortConfig((prev) => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }));
  const getSortLabel = (key) => (sortConfig.key !== key ? "" : sortConfig.direction === "asc" ? "↑" : "↓");
  const handleSelecionarTodos = () => setSelecionados(selecionados.length === areasFiltradas.length && areasFiltradas.length > 0 ? [] : areasFiltradas.map((a) => a.id));
  const handleToggleSelecao = (id) => setSelecionados((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
  const limparFiltros = () => { setSearchTerm(""); setFiltroSetor(VALOR_TODOS); setFiltroUso(VALOR_TODOS); setFiltroCultura(VALOR_TODOS); setFiltroStatus(VALOR_TODOS); };

  const aplicarLote = async () => {
    if (selecionados.length === 0) { toast.error("Selecione ao menos uma área!"); return; }
    try {
      if (batchType === "aproveitamento") {
        await Promise.all(selecionados.map((id) => base44.entities.AreaPastagem.update(id, { aproveitamento_classificacao: batchValue })));
      } else if (batchType === "setor") {
        const setorSelecionado = setores.find((setor) => setor.id === batchValue);
        if (!setorSelecionado) { toast.error("Selecione um setor válido"); return; }
        await Promise.all(selecionados.map((id) => base44.entities.AreaPastagem.update(id, { setor_id: setorSelecionado.id, setor_nome: setorSelecionado.nome })));
      } else if (batchType === "cultura") {
        await Promise.all(selecionados.map((id) => base44.entities.AreaPastagem.update(id, { tipo_pastagem: batchValue })));
      } else if (batchType === "uso") {
        await Promise.all(selecionados.map((id) => base44.entities.AreaPastagem.update(id, { tipo_cultura: batchValue })));
      } else if (batchType === "cor") {
        await Promise.all(selecionados.map((id) => {
          const area = areas.find((a) => a.id === id);
          const coords = area?.coordenadas?.coords || [];
          return base44.entities.AreaPastagem.update(id, { cor: batchValue, coordenadas: { coords, cor: batchValue } });
        }));
      } else if (batchType === "renumerar") {
        const start = parseInt(startNumber || "1", 10);
        if (Number.isNaN(start)) { toast.error("Informe um número inicial válido"); return; }
        const selecionadas = areas.filter((a) => selecionados.includes(a.id)).sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
        await Promise.all(selecionadas.map((a, idx) => base44.entities.AreaPastagem.update(a.id, { numero_area: String(start + idx) })));
      }
      toast.success("Atualizado com sucesso");
      setBatchType(null); setBatchValue(""); setStartNumber(""); setSelecionados([]);
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "areas" });
    } catch {
      toast.error("Falha ao aplicar alterações");
    }
  };

  const handleExcluirEmMassa = () => {
    if (selecionados.length === 0) { toast.error("Selecione ao menos uma área!"); return; }
    selecionados.forEach((id) => {
      const area = areas.find((a) => a.id === id);
      if (area) onDelete(area);
    });
    setSelecionados([]);
  };

  const renderCell = (area, colunaId) => {
    if (colunaId === "codigo") return area.numero_area || "-";
    if (colunaId === "sigla") return area.sigla || "-";
    if (colunaId === "nome") return area.nome || "-";
    if (colunaId === "uso") return area.tipo_cultura || "-";
    if (colunaId === "cultura") return area.tipo_pastagem || "-";
    if (colunaId === "tamanho") return area.tamanho_hectares?.toFixed(2) || "-";
    if (colunaId === "capacidade") return area.capacidade_maxima || "-";
    if (colunaId === "ocupacao") return `${area.quantidade_atual || 0} / ${area.capacidade_maxima || 0}`;
    if (colunaId === "status") return area.status_ocupacao || "Disponível";
    return "-";
  };

  return (
    <>
      <div className="space-y-4">
        <Card>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              <div className="md:col-span-2 space-y-1">
                <Label className="text-xs">Buscar</Label>
                <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar áreas..." className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Setor</Label>
                <Select value={filtroSetor} onValueChange={setFiltroSetor}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VALOR_TODOS} className="text-xs">Todos</SelectItem>
                    {setores.map((setor) => <SelectItem key={setor.id} value={setor.id} className="text-xs">{setor.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Uso</Label>
                <Select value={filtroUso} onValueChange={setFiltroUso}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VALOR_TODOS} className="text-xs">Todos</SelectItem>
                    {TIPOS_USO.map((item) => <SelectItem key={item} value={item} className="text-xs">{item}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cultura</Label>
                <Select value={filtroCultura} onValueChange={setFiltroCultura}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VALOR_TODOS} className="text-xs">Todos</SelectItem>
                    {TIPOS_CULTURAS.map((item) => <SelectItem key={item} value={item} className="text-xs">{item}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VALOR_TODOS} className="text-xs">Todos</SelectItem>
                    {['Disponível','Médio','Alto','Sobrepastoreado'].map((item) => <SelectItem key={item} value={item} className="text-xs">{item}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-between items-center mt-2 gap-2 flex-wrap">
              <div className="text-xs text-slate-500">{areasFiltradas.length} de {areas.length} registros</div>
              <div className="flex gap-2 flex-wrap">
                {selecionados.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 text-xs">Ações ({selecionados.length})</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => { setBatchType('setor'); setBatchValue(''); }} className="text-xs">Definir Setor</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setBatchType('aproveitamento'); setBatchValue('Alta'); }} className="text-xs">Definir Aproveitamento</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setBatchType('cultura'); setBatchValue('Brachiaria'); }} className="text-xs">Definir Tipo de Cultura</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setBatchType('uso'); setBatchValue('Pastagem'); }} className="text-xs">Definir Tipo de Uso</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setBatchType('cor'); setBatchValue(CORES_DISPONIVEIS[4].cor); }} className="text-xs">Definir Cor</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setBatchType('renumerar'); setStartNumber('1'); }} className="text-xs">Reatribuir Códigos</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleExcluirEmMassa} className="text-xs text-red-600">Excluir Selecionados</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <Button variant="outline" size="sm" onClick={limparFiltros} className="h-7 text-xs">Limpar Filtros</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-white border-b">
                    {colunasOrdenadas.map((coluna) => {
                      if (coluna.id === 'selecao') return <TableHead key="selecao" className="text-xs font-bold py-1 px-2 border border-black w-10"><Checkbox checked={selecionados.length === areasFiltradas.length && areasFiltradas.length > 0} onCheckedChange={handleSelecionarTodos} /></TableHead>;
                      if (coluna.id === 'acoes') return <TableHead key="acoes" className="text-xs font-bold py-1 px-2 border border-black w-10"></TableHead>;
                      const isRight = coluna.align === 'right';
                      return <TableHead key={coluna.id} className={`text-xs font-bold py-1 px-3 border border-black ${coluna.sortable ? 'cursor-pointer hover:bg-gray-50' : ''} ${isRight ? 'text-right' : ''}`} onClick={() => coluna.sortable && handleSort(coluna.id)}><div className={`${isRight ? 'text-right' : ''}`}>{coluna.label} {coluna.sortable ? getSortLabel(coluna.id) : ''}</div></TableHead>;
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {areasPaginadas.length === 0 ? (
                    <TableRow><TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">Nenhuma área encontrada</TableCell></TableRow>
                  ) : areasPaginadas.map((area) => (
                    <TableRow key={area.id} className="hover:bg-gray-50 border-b">
                      {colunasOrdenadas.map((coluna) => {
                        if (coluna.id === 'selecao') return <TableCell key={`${area.id}-selecao`} className="text-xs py-1 px-2 border border-gray-300"><Checkbox checked={selecionados.includes(area.id)} onCheckedChange={() => handleToggleSelecao(area.id)} /></TableCell>;
                        if (coluna.id === 'acoes') return <TableCell key={`${area.id}-acoes`} className="text-xs py-1 px-2 border border-gray-300 text-center"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onClick={() => onEdit(area)} className="text-xs">Editar Área</DropdownMenuItem><DropdownMenuItem onClick={() => onEditDetalhes && onEditDetalhes(area)} className="text-xs">Editar Detalhes</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => onDelete(area)} className="text-xs text-red-600">Excluir</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>;
                        return <TableCell key={`${area.id}-${coluna.id}`} className={`text-xs py-1 px-3 border border-gray-300 ${coluna.align === 'right' ? 'text-right font-mono' : ''}`}>{renderCell(area, coluna.id)}</TableCell>;
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {totalPages > 1 && <div className="flex items-center justify-between p-3 border-t"><div className="flex items-center gap-2"><span className="text-xs text-slate-500">Itens por página:</span><Select value={String(itemsPerPage)} onValueChange={(v) => { setItemsPerPage(Number(v)); setCurrentPage(1); }}><SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger><SelectContent>{[25,50,100,200].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent></Select></div><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={currentPage===1} onClick={() => setCurrentPage((p) => p-1)} className="h-7 text-xs">Anterior</Button><span className="text-xs text-slate-600">Página {currentPage} de {totalPages}</span><Button variant="outline" size="sm" disabled={currentPage===totalPages} onClick={() => setCurrentPage((p) => p+1)} className="h-7 text-xs">Próxima</Button></div></div>}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!batchType} onOpenChange={() => { setBatchType(null); setBatchValue(''); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">{batchType === 'setor' ? 'Definir Setor' : batchType === 'aproveitamento' ? 'Definir Aproveitamento' : batchType === 'cultura' ? 'Definir Tipo de Cultura' : batchType === 'uso' ? 'Definir Tipo de Uso' : batchType === 'cor' ? 'Definir Cor no Mapa' : 'Reatribuir Códigos'}</DialogTitle>
          </DialogHeader>
          {batchType === 'setor' && <div className="space-y-2"><Label className="text-xs">Setor</Label><Select value={batchValue} onValueChange={setBatchValue}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{setores.map((setor) => <SelectItem key={setor.id} value={setor.id} className="text-xs">{setor.nome}</SelectItem>)}</SelectContent></Select><div className="flex justify-end gap-2 pt-2"><Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBatchType(null)}>Cancelar</Button><Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={aplicarLote} disabled={!batchValue}>Aplicar</Button></div></div>}
          {batchType === 'aproveitamento' && <div className="space-y-2"><Label className="text-xs">Aproveitamento</Label><Select value={batchValue} onValueChange={setBatchValue}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{APROVEITAMENTO.map((v) => <SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>)}</SelectContent></Select><div className="flex justify-end gap-2 pt-2"><Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBatchType(null)}>Cancelar</Button><Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={aplicarLote}>Aplicar</Button></div></div>}
          {batchType === 'cultura' && <div className="space-y-2"><Label className="text-xs">Tipo de Cultura</Label><Select value={batchValue} onValueChange={setBatchValue}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{TIPOS_CULTURAS.map((v) => <SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>)}</SelectContent></Select><div className="flex justify-end gap-2 pt-2"><Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBatchType(null)}>Cancelar</Button><Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={aplicarLote}>Aplicar</Button></div></div>}
          {batchType === 'uso' && <div className="space-y-2"><Label className="text-xs">Tipo de Uso</Label><Select value={batchValue} onValueChange={setBatchValue}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{TIPOS_USO.map((v) => <SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>)}</SelectContent></Select><div className="flex justify-end gap-2 pt-2"><Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBatchType(null)}>Cancelar</Button><Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={aplicarLote}>Aplicar</Button></div></div>}
          {batchType === 'cor' && <div className="space-y-3"><Label className="text-xs">Cor</Label><div className="grid grid-cols-5 gap-2">{CORES_DISPONIVEIS.map((c) => <button key={c.cor} onClick={() => setBatchValue(c.cor)} className={`h-8 rounded border ${batchValue===c.cor?'ring-2 ring-emerald-600':''}`} style={{ backgroundColor: c.cor }} title={c.nome} />)}</div><div className="flex justify-end gap-2 pt-2"><Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBatchType(null)}>Cancelar</Button><Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={aplicarLote} disabled={!batchValue}>Aplicar</Button></div></div>}
          {batchType === 'renumerar' && <div className="space-y-2"><Label className="text-xs">Iniciar numeração a partir de</Label><Input value={startNumber} onChange={(e) => setStartNumber(e.target.value.replace(/[^0-9]/g,''))} className="h-8 text-xs" placeholder="1" /><p className="text-[11px] text-slate-500">As áreas selecionadas serão ordenadas por Nome (A→Z) e receberão códigos sequenciais.</p><div className="flex justify-end gap-2 pt-2"><Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBatchType(null)}>Cancelar</Button><Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={aplicarLote} disabled={!startNumber}>Aplicar</Button></div></div>}
        </DialogContent>
      </Dialog>

      <ConfiguracaoColunasMapaDialog open={showConfigColunas} onOpenChange={setShowConfigColunas} colunasDisponiveis={COLUNAS_DISPONIVEIS} colunasVisiveis={colunasVisiveis} colunasOrdem={colunasOrdem} toggleColuna={toggleColuna} handleDragEnd={handleDragEnd} droppableId="colunas-areas-geo" />
    </>
  );
}