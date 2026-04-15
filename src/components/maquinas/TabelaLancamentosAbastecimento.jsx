import React, { useMemo, useRef, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MoreVertical, ArrowUpDown, ArrowUp, ArrowDown, Settings2 } from "lucide-react";
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";

const LS_VISIBLE = "colunas_visiveis_abastecimentos";
const LS_ORDER = "colunas_ordem_abastecimentos";

const formatDate = (d) => {
  if (!d) return "-";
  const [y, m, day] = d.split("T")[0].split("-");
  return `${day}/${m}/${y}`;
};

const fmt2 = (v) => (v != null && v !== "" ? Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-");

const COLUNAS_DISPONIVEIS = [
  { id: "selecao", label: "Sel.", default: true, fixo: true, width: 28 },
  { id: "acoes", label: "", default: true, fixo: true, width: 28 },
  { id: "data_abastecimento", label: "Data", default: true, width: 90 },
  { id: "maquina_nome", label: "Ativo", default: true, width: 180 },
  { id: "maquina_identificador", label: "ID Ativo", default: false, width: 100 },
  { id: "maquina_categoria", label: "Categoria Ativo", default: false, width: 130 },
  { id: "maquina_tipo_medicao", label: "Tipo Medição", default: true, width: 120 },
  { id: "grupo_atividade_nome", label: "Grupo Atividade", default: true, width: 150 },
  { id: "tipo_servico", label: "Tipo Serviço", default: true, width: 140 },
  { id: "responsavel", label: "Responsável", default: true, width: 130 },
  { id: "local_estoque_nome", label: "Local Estoque", default: false, width: 140 },
  { id: "produto_nome", label: "Produto", default: true, width: 160 },
  { id: "quantidade_litros", label: "Litros", default: true, width: 80, align: "right" },
  { id: "medicao", label: "Medição", default: true, width: 90, align: "right" },
  { id: "medicao_anterior", label: "Med. Anterior", default: true, width: 100, align: "right" },
  { id: "uso_realizado", label: "Uso (H/KM)", default: true, width: 90, align: "right" },
  { id: "consumo_calculado", label: "Consumo", default: true, width: 90, align: "right" },
  { id: "observacoes", label: "Observações", default: false, width: 200 },
];

const DEFAULT_VISIBLE = COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
const DEFAULT_ORDER = COLUNAS_DISPONIVEIS.map((c) => c.id);

const loadLS = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};

export default function TabelaLancamentosAbastecimento({ abastecimentos = [], selecionados = [], onSelecionadosChange, onEdit, onDelete, showConfigColunas, setShowConfigColunas }) {
  const tableRef = useRef(null);

  const [colunasVisiveis, setColunasVisiveis] = useState(() => loadLS(LS_VISIBLE, DEFAULT_VISIBLE));
  const [colunasOrdem, setColunasOrdem] = useState(() => loadLS(LS_ORDER, DEFAULT_ORDER));

  // Filtros
  const [filtroAtivo, setFiltroAtivo] = useState("");
  const [filtroResponsavel, setFiltroResponsavel] = useState("");
  const [filtroProduto, setFiltroProduto] = useState("");

  // Ordenação
  const [sortCol, setSortCol] = useState("data_abastecimento");
  const [sortDir, setSortDir] = useState("desc");

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  const colunasOrdenadas = useMemo(() =>
    colunasOrdem
      .map((id) => COLUNAS_DISPONIVEIS.find((c) => c.id === id))
      .filter((c) => c && colunasVisiveis.includes(c.id)),
    [colunasOrdem, colunasVisiveis]
  );

  const toggleColuna = useCallback((id) => {
    setColunasVisiveis((prev) => {
      const next = prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id];
      localStorage.setItem(LS_VISIBLE, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleDragEnd = useCallback((result) => {
    if (!result.destination) return;
    setColunasOrdem((prev) => {
      const next = [...prev];
      const [removed] = next.splice(result.source.index, 1);
      next.splice(result.destination.index, 0, removed);
      localStorage.setItem(LS_ORDER, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  };

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <ArrowUpDown className="w-3 h-3 opacity-40 ml-1" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  const dados = useMemo(() => {
    let list = [...abastecimentos];
    if (filtroAtivo) list = list.filter((i) => (i.maquina_nome || "").toLowerCase().includes(filtroAtivo.toLowerCase()));
    if (filtroResponsavel) list = list.filter((i) => (i.responsavel || "").toLowerCase().includes(filtroResponsavel.toLowerCase()));
    if (filtroProduto) list = list.filter((i) => (i.produto_nome || "").toLowerCase().includes(filtroProduto.toLowerCase()));

    list.sort((a, b) => {
      let va = a[sortCol] ?? "";
      let vb = b[sortCol] ?? "";
      if (sortCol === "data_abastecimento") { va = va || ""; vb = vb || ""; }
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [abastecimentos, filtroAtivo, filtroResponsavel, filtroProduto, sortCol, sortDir]);

  const toggleSelectAll = () => {
    if (selecionados.length === dados.length && dados.length > 0) onSelecionadosChange([]);
    else onSelecionadosChange(dados.map((m) => m.id));
  };

  const SORTABLE = ["data_abastecimento", "maquina_nome", "maquina_categoria", "maquina_tipo_medicao", "maquina_identificador", "responsavel", "produto_nome", "quantidade_litros", "medicao", "consumo_calculado"];

  const renderCell = (item, colunaId) => {
    if (colunaId === "data_abastecimento") return formatDate(item.data_abastecimento);
    if (colunaId === "quantidade_litros") return fmt2(item.quantidade_litros);
    if (colunaId === "medicao") return fmt2(item.medicao);
    if (colunaId === "medicao_anterior") return item.medicao_anterior != null ? fmt2(item.medicao_anterior) : "-";
    if (colunaId === "uso_realizado") return item.uso_realizado != null ? fmt2(item.uso_realizado) : "-";
    if (colunaId === "consumo_calculado") {
      if (item.consumo_calculado == null) return <span className="text-amber-500 text-xs">Não conf.</span>;
      return <span className="font-semibold text-emerald-700">{fmt2(item.consumo_calculado)}</span>;
    }
    return item[colunaId] || "-";
  };

  return (
    <div className="space-y-1 overflow-hidden">
      {/* Filtros */}
      <Card className="border-slate-200">
        <CardContent className="p-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
            <Input value={filtroAtivo} onChange={(e) => setFiltroAtivo(e.target.value)} placeholder="Filtrar ativo..." className="h-7 text-xs" />
            <Input value={filtroResponsavel} onChange={(e) => setFiltroResponsavel(e.target.value)} placeholder="Filtrar responsável..." className="h-7 text-xs" />
            <Input value={filtroProduto} onChange={(e) => setFiltroProduto(e.target.value)} placeholder="Filtrar produto..." className="h-7 text-xs" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">{dados.length} de {abastecimentos.length} registros</span>
              {(filtroAtivo || filtroResponsavel || filtroProduto) && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setFiltroAtivo(""); setFiltroResponsavel(""); setFiltroProduto(""); }}>Limpar</Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardContent className="p-0 overflow-hidden">
          <div className="relative overflow-hidden">
            <div className="relative w-full overflow-auto max-h-[calc(100dvh-260px)] md:max-h-[calc(100dvh-180px)]" style={{ overscrollBehavior: "none", WebkitOverflowScrolling: "touch" }}>
              <Table ref={tableRef} className={`w-full ${isMobile ? "min-w-[1100px]" : "min-w-[1300px]"} border-separate border-spacing-0 table-fixed`}>
                <TableHeader className="bg-white">
                  <TableRow className="sticky top-0 z-40 bg-white">
                    {colunasOrdenadas.map((coluna) => {
                      if (coluna.id === "selecao") return (
                        <TableHead key="selecao" style={{ width: coluna.width }} className="sticky top-0 z-40 h-7 p-0 bg-white text-center border-r border-b border-gray-200">
                          <div className="flex items-center justify-center w-full h-full">
                            <Checkbox checked={selecionados.length === dados.length && dados.length > 0} onCheckedChange={toggleSelectAll} className="h-4 w-4 rounded-full border-2 border-gray-400" />
                          </div>
                        </TableHead>
                      );
                      if (coluna.id === "acoes") return <TableHead key="acoes" style={{ width: coluna.width }} className="sticky top-0 z-40 h-7 p-0 bg-white border-r border-b border-gray-200" />;
                      const sortable = SORTABLE.includes(coluna.id);
                      return (
                        <TableHead
                          key={coluna.id}
                          style={{ width: coluna.width }}
                          className={`sticky top-0 z-40 text-gray-900 px-2 text-xs font-bold text-center border-r border-b border-gray-200 bg-white whitespace-nowrap h-7 ${sortable ? "cursor-pointer hover:bg-gray-50" : ""} ${coluna.align === "right" ? "text-right" : ""}`}
                          onClick={sortable ? () => handleSort(coluna.id) : undefined}
                        >
                          <div className={`flex items-center ${coluna.align === "right" ? "justify-end" : "justify-start"} gap-0.5`}>
                            {coluna.label}
                            {sortable && <SortIcon col={coluna.id} />}
                          </div>
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dados.length === 0 ? (
                    <TableRow><TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">Nenhum lançamento encontrado</TableCell></TableRow>
                  ) : dados.map((item) => (
                    <TableRow key={item.id} className="transition-colors border-b hover:bg-gray-50">
                      {colunasOrdenadas.map((coluna) => {
                        if (coluna.id === "selecao") return (
                          <TableCell key={`${item.id}-selecao`} className="p-0 text-center px-0 h-7 border-r border-b border-gray-200">
                            <div className="flex items-center justify-center w-full h-full">
                              <Checkbox checked={selecionados.includes(item.id)} onCheckedChange={(checked) => onSelecionadosChange(checked ? [...selecionados, item.id] : selecionados.filter((id) => id !== item.id))} className="h-4 w-4 rounded-full border-2 border-gray-400" />
                            </div>
                          </TableCell>
                        );
                        if (coluna.id === "acoes") return (
                          <TableCell key={`${item.id}-acoes`} className="p-0 text-center px-0 h-7 border-r border-b border-gray-200">
                            <div className="flex items-center justify-center w-full h-full">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-3.5 h-3.5 text-slate-600" /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                  <DropdownMenuLabel className="text-xs">Ações</DropdownMenuLabel>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => onEdit(item)} className="text-xs">Editar</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => onDelete(item)} className="text-xs text-red-600">Excluir</DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        );
                        return (
                          <TableCell key={`${item.id}-${coluna.id}`} className={`px-2 py-1 text-gray-700 text-xs align-middle border-r border-b border-gray-200 whitespace-nowrap ${coluna.align === "right" ? "text-right font-mono" : ""}`}>
                            {renderCell(item, coluna.id)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
        droppableId="colunas-abastecimentos"
      />
    </div>
  );
}