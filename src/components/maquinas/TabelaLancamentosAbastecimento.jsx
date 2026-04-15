import React, { useMemo, useRef, useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";
import { MoreVertical } from "lucide-react";

const COLUNAS_DISPONIVEIS = [
  { id: "selecao", label: "Seleção", default: true, fixo: true, width: 25 },
  { id: "acoes", label: "Ações", default: true, fixo: true, width: 25 },
  { id: "data_abastecimento", label: "Data", default: true, width: 100 },
  { id: "maquina_nome", label: "Ativo", default: true, width: 220 },
  { id: "produto_nome", label: "Produto", default: true, width: 180 },
  { id: "quantidade_litros", label: "Quantidade", default: true, width: 120, align: "right" },
  { id: "responsavel", label: "Responsável", default: true, width: 160 },
  { id: "medicao", label: "Medição", default: true, width: 120, align: "right" },
];

const DEFAULT_VISIBLE_COLUMNS = COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);

export default function TabelaLancamentosAbastecimento({ abastecimentos = [], selecionados = [], onSelecionadosChange, onEdit, onDelete, showConfigColunas, setShowConfigColunas }) {
  const tableRef = useRef(null);
  const [colunasOrdem] = useState(COLUNAS_DISPONIVEIS.map((c) => c.id));
  const [colunasVisiveis] = useState(DEFAULT_VISIBLE_COLUMNS);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  const colunasOrdenadas = useMemo(() => colunasOrdem.map((id) => COLUNAS_DISPONIVEIS.find((c) => c.id === id)).filter((c) => c && colunasVisiveis.includes(c.id)), [colunasOrdem, colunasVisiveis]);

  const toggleSelectAll = () => {
    if (selecionados.length === abastecimentos.length && abastecimentos.length > 0) return onSelecionadosChange([]);
    onSelecionadosChange(abastecimentos.map((m) => m.id));
  };

  const renderCell = (item, colunaId) => {
    if (colunaId === "data_abastecimento") return item.data_abastecimento || "-";
    if (colunaId === "quantidade_litros") return item.quantidade_litros || "-";
    if (colunaId === "medicao") return item.medicao || "-";
    return item[colunaId] || "-";
  };

  return (
    <div className="space-y-1 overflow-hidden">
      <div className="flex justify-between items-center px-1 gap-2 flex-wrap">
        <div className="text-xs text-slate-500">{abastecimentos.length} registros</div>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0 overflow-hidden">
          <div className="relative overflow-hidden">
            <div className="relative w-full overflow-auto max-h-[calc(100dvh-240px)] md:max-h-[calc(100dvh-150px)]" style={{ overscrollBehavior: 'none', WebkitOverflowScrolling: 'touch' }}>
              <Table ref={tableRef} className={`w-full ${isMobile ? "min-w-[980px]" : "min-w-[1200px]"} border-separate border-spacing-0 table-fixed`}>
                <TableHeader className="bg-white">
                  <TableRow className="sticky top-0 z-40 bg-white">
                    {colunasOrdenadas.map((coluna) => {
                      if (coluna.id === "selecao") return <TableHead key="selecao" style={{ width: 25 }} className="sticky top-0 z-40 h-7 p-0 bg-white text-center px-0 border-r border-b border-gray-200"><div className="flex items-center justify-center w-full h-full"><Checkbox checked={selecionados.length === abastecimentos.length && abastecimentos.length > 0} onCheckedChange={toggleSelectAll} className="h-4 w-4 rounded-full border-2 border-gray-400" /></div></TableHead>;
                      if (coluna.id === "acoes") return <TableHead key="acoes" style={{ width: 25 }} className="sticky top-0 z-40 h-7 p-0 bg-white border-r border-b border-gray-200" />;
                      return <TableHead key={coluna.id} style={{ width: coluna.width }} className="sticky top-0 z-40 text-gray-900 px-2 text-xs font-medium text-center border-r border-b border-gray-200 bg-white whitespace-nowrap h-7">{coluna.label}</TableHead>;
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {abastecimentos.length === 0 ? <TableRow><TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">Nenhum lançamento encontrado</TableCell></TableRow> : abastecimentos.map((item) => <TableRow key={item.id} className="transition-colors border-b hover:bg-gray-100">{colunasOrdenadas.map((coluna) => { if (coluna.id === "selecao") return <TableCell key={`${item.id}-selecao`} className="p-0 text-center px-0 h-7 border-r border-b border-gray-300"><div className="flex items-center justify-center w-full h-full"><Checkbox checked={selecionados.includes(item.id)} onCheckedChange={(checked) => onSelecionadosChange(checked ? [...selecionados, item.id] : selecionados.filter((id) => id !== item.id))} className="h-4 w-4 rounded-full border-2 border-gray-400" /></div></TableCell>; if (coluna.id === "acoes") return <TableCell key={`${item.id}-acoes`} className="p-0 text-center px-0 h-7 border-r border-b border-gray-300"><div className="flex items-center justify-center w-full h-full"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-3.5 h-3.5 text-slate-600" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuLabel className="text-xs">Ações</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem onClick={() => onEdit(item)} className="text-xs">Editar</DropdownMenuItem><DropdownMenuItem onClick={() => onDelete(item)} className="text-xs text-red-600">Excluir</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></TableCell>; return <TableCell key={`${item.id}-${coluna.id}`} className={`px-2 py-1 text-gray-700 text-xs align-middle border-r border-b border-gray-300 whitespace-normal break-words ${coluna.align === 'right' ? 'text-right font-mono' : ''}`}>{renderCell(item, coluna.id)}</TableCell>; })}</TableRow>)}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      <ConfiguracaoColunasMapaDialog open={showConfigColunas} onOpenChange={setShowConfigColunas} colunasDisponiveis={COLUNAS_DISPONIVEIS} colunasVisiveis={colunasVisiveis} colunasOrdem={colunasOrdem} toggleColuna={() => {}} handleDragEnd={() => {}} droppableId="colunas-abastecimentos" />
    </div>
  );
}