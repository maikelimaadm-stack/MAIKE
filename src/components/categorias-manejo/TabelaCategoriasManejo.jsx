import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Edit, Trash2, Search, Settings, ArrowUpDown, ArrowUp, ArrowDown, GripVertical, Eye, Download, MoreVertical } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { toast } from "sonner";

const COLUNAS_DISPONIVEIS = [
  { id: 'nome', label: 'Nome', default: true },
  { id: 'sigla', label: 'Sigla', default: true },
  { id: 'sexo', label: 'Sexo', default: true },
  { id: 'raca', label: 'Raça', default: true },
  { id: 'idade', label: 'Faixa Idade', default: true },
  { id: 'especie', label: 'Espécie', default: false },
  { id: 'categoria_oficial', label: 'Categoria Oficial', default: true },
  { id: 'ganho_anual', label: 'Ganho Anual (kg)', default: false },
  { id: 'gmd_jan', label: 'GMD Jan', default: false },
  { id: 'gmd_fev', label: 'GMD Fev', default: false },
  { id: 'gmd_mar', label: 'GMD Mar', default: false },
  { id: 'gmd_abr', label: 'GMD Abr', default: false },
  { id: 'gmd_mai', label: 'GMD Mai', default: false },
  { id: 'gmd_jun', label: 'GMD Jun', default: false },
  { id: 'gmd_jul', label: 'GMD Jul', default: false },
  { id: 'gmd_ago', label: 'GMD Ago', default: false },
  { id: 'gmd_set', label: 'GMD Set', default: false },
  { id: 'gmd_out', label: 'GMD Out', default: false },
  { id: 'gmd_nov', label: 'GMD Nov', default: false },
  { id: 'gmd_dez', label: 'GMD Dez', default: false },
];

export default function TabelaCategoriasManejo({ categorias, onEdit, onDelete, iconesConfig }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState("nome");
  const [sortDirection, setSortDirection] = useState("asc");
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [selecionados, setSelecionados] = useState([]);

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem('colunas_ordem_categorias_manejo');
    return saved ? JSON.parse(saved) : COLUNAS_DISPONIVEIS.map(c => c.id);
  });

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_visiveis_categorias_manejo');
    return saved ? JSON.parse(saved) : COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });

  const toggleColuna = (colunaId) => {
    const novas = colunasVisiveis.includes(colunaId)
      ? colunasVisiveis.filter(id => id !== colunaId)
      : [...colunasVisiveis, colunaId];
    setColunasVisiveis(novas);
    localStorage.setItem('colunas_visiveis_categorias_manejo', JSON.stringify(novas));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);
    setColunasOrdem(items);
    localStorage.setItem('colunas_ordem_categorias_manejo', JSON.stringify(items));
  };

  const colunasOrdenadas = colunasOrdem
    .map(id => COLUNAS_DISPONIVEIS.find(c => c.id === id))
    .filter(c => c && colunasVisiveis.includes(c.id));

  const handleSort = (field) => {
    setSortField(field);
    setSortDirection(sortField === field && sortDirection === 'asc' ? 'desc' : 'asc');
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  const categoriasFiltradas = categorias.filter(c =>
    c.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.sigla?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.categoria_oficial?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const categoriasOrdenadas = [...categoriasFiltradas].sort((a, b) => {
    const aVal = a[sortField] || '';
    const bVal = b[sortField] || '';
    return sortDirection === 'asc' 
      ? String(aVal).localeCompare(String(bVal))
      : String(bVal).localeCompare(String(aVal));
  });

  const renderCell = (coluna, cat) => {
    const icone = iconesConfig.find(ic => ic.categoria === cat.categoria_oficial);
    
    switch (coluna.id) {
      case 'nome':
        return (
          <TableCell className="font-semibold text-xs border-r">
            <div className="flex items-center gap-2">
              {icone?.icone_url && <img src={icone.icone_url} className="w-5 h-5 object-contain" />}
              {cat.nome}
            </div>
          </TableCell>
        );
      case 'sigla':
        return <TableCell className="text-xs font-mono border-r">{cat.sigla || '-'}</TableCell>;
      case 'sexo':
        return (
          <TableCell className="text-xs border-r">
            {cat.sexo ? (
              <Badge className={`text-xs ${cat.sexo === 'Macho' ? 'bg-blue-100 text-blue-800' : 'bg-pink-100 text-pink-800'}`}>
                {cat.sexo}
              </Badge>
            ) : '-'}
          </TableCell>
        );
      case 'raca':
        return <TableCell className="text-xs font-medium border-r">{cat.raca || '-'}</TableCell>;
      case 'idade':
        return (
          <TableCell className="text-xs border-r">
            {cat.idade_minima_meses || cat.idade_maxima_meses ? (
              <span className="text-slate-600">
                {cat.idade_minima_meses || 0} - {cat.idade_maxima_meses || '∞'} meses
              </span>
            ) : '-'}
          </TableCell>
        );
      case 'especie':
        return <TableCell className="text-xs border-r"><Badge className="text-xs">{cat.especie}</Badge></TableCell>;
      case 'categoria_oficial':
        return <TableCell className="text-xs text-slate-600 border-r">{cat.categoria_oficial || '-'}</TableCell>;
      case 'ganho_anual':
        return <TableCell className="text-xs text-right border-r">{cat.ganho_peso_anual_kg ? `${cat.ganho_peso_anual_kg} kg` : '-'}</TableCell>;
      case 'gmd_jan':
        return <TableCell className="text-xs text-right border-r">{cat.gmd_janeiro || '-'}</TableCell>;
      case 'gmd_fev':
        return <TableCell className="text-xs text-right border-r">{cat.gmd_fevereiro || '-'}</TableCell>;
      case 'gmd_mar':
        return <TableCell className="text-xs text-right border-r">{cat.gmd_marco || '-'}</TableCell>;
      case 'gmd_abr':
        return <TableCell className="text-xs text-right border-r">{cat.gmd_abril || '-'}</TableCell>;
      case 'gmd_mai':
        return <TableCell className="text-xs text-right border-r">{cat.gmd_maio || '-'}</TableCell>;
      case 'gmd_jun':
        return <TableCell className="text-xs text-right border-r">{cat.gmd_junho || '-'}</TableCell>;
      case 'gmd_jul':
        return <TableCell className="text-xs text-right border-r">{cat.gmd_julho || '-'}</TableCell>;
      case 'gmd_ago':
        return <TableCell className="text-xs text-right border-r">{cat.gmd_agosto || '-'}</TableCell>;
      case 'gmd_set':
        return <TableCell className="text-xs text-right border-r">{cat.gmd_setembro || '-'}</TableCell>;
      case 'gmd_out':
        return <TableCell className="text-xs text-right border-r">{cat.gmd_outubro || '-'}</TableCell>;
      case 'gmd_nov':
        return <TableCell className="text-xs text-right border-r">{cat.gmd_novembro || '-'}</TableCell>;
      case 'gmd_dez':
        return <TableCell className="text-xs text-right border-r">{cat.gmd_dezembro || '-'}</TableCell>;
      default:
        return <TableCell className="text-xs border-r">-</TableCell>;
    }
  };

  const handleExcluirSelecionados = () => {
    if (selecionados.length === 0) {
      toast.error('Selecione ao menos uma categoria!');
      return;
    }
    if (window.confirm(`Excluir ${selecionados.length} categoria(s)?`)) {
      selecionados.forEach(id => onDelete(id));
      setSelecionados([]);
    }
  };

  return (
    <>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="bg-white border-b py-2 px-4">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-sm font-semibold">
              Categorias ({categorias.length})
            </CardTitle>
            <div className="flex gap-2 items-center">
              {selecionados.length > 0 && (
                <div className="flex items-center gap-2 bg-slate-100 border rounded px-2 py-1">
                  <span className="text-xs font-semibold">{selecionados.length} selecionado(s)</span>
                  <Button variant="ghost" size="sm" onClick={handleExcluirSelecionados} className="h-6 px-1.5 text-red-600">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 h-8 w-48 text-xs" />
              </div>
              <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => setShowConfigColunas(true)}>
                <Settings className="w-3.5 h-3.5" />Colunas
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 border-b">
                  <TableHead className="w-8 text-xs border-r">
                    <Checkbox 
                      checked={selecionados.length === categoriasOrdenadas.length && categoriasOrdenadas.length > 0}
                      onCheckedChange={() => {
                        setSelecionados(selecionados.length === categoriasOrdenadas.length ? [] : categoriasOrdenadas.map(c => c.id));
                      }}
                    />
                  </TableHead>
                  <TableHead className="text-xs w-8 border-r"></TableHead>
                  {colunasOrdenadas.map(coluna => (
                    <TableHead 
                      key={coluna.id}
                      className="text-xs border-r cursor-pointer hover:bg-slate-100"
                      onClick={() => handleSort(coluna.id)}
                    >
                      <div className="flex items-center">{coluna.label}{getSortIcon(coluna.id)}</div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <AnimatePresence>
                  {categoriasOrdenadas.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={50} className="text-center py-12 text-slate-400 text-xs">Nenhuma categoria</TableCell>
                    </TableRow>
                  ) : (
                    categoriasOrdenadas.map(cat => (
                      <motion.tr key={cat.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="hover:bg-slate-50 border-b">
                        <TableCell className="border-r">
                          <Checkbox checked={selecionados.includes(cat.id)} onCheckedChange={() => {
                            setSelecionados(prev => prev.includes(cat.id) ? prev.filter(i => i !== cat.id) : [...prev, cat.id]);
                          }} />
                        </TableCell>
                        <TableCell className="border-r">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
                                <MoreVertical className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem onClick={() => onEdit(cat)} className="text-xs">
                                <Edit className="w-3.5 h-3.5 mr-2" />Editar
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => onDelete(cat.id)} className="text-xs text-red-600">
                                <Trash2 className="w-3.5 h-3.5 mr-2" />Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        {colunasOrdenadas.map(coluna => (
                          <React.Fragment key={coluna.id}>{renderCell(coluna, cat)}</React.Fragment>
                        ))}
                      </motion.tr>
                    ))
                  )}
                </AnimatePresence>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showConfigColunas} onOpenChange={setShowConfigColunas}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">Configurar Colunas</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 flex-1 overflow-auto">
            <div className="space-y-1">
              <p className="text-xs text-slate-600 font-semibold">Visibilidade</p>
              <div className="grid grid-cols-2 gap-2">
                {COLUNAS_DISPONIVEIS.map(col => (
                  <label key={col.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                    <input type="checkbox" checked={colunasVisiveis.includes(col.id)} onChange={() => toggleColuna(col.id)} className="rounded" />
                    <span>{col.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="border-t pt-3">
              <p className="text-xs text-slate-600 font-semibold mb-2">Ordem</p>
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="colunas">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-1">
                      {colunasOrdem.map((colunaId, idx) => {
                        const col = COLUNAS_DISPONIVEIS.find(c => c.id === colunaId);
                        if (!col) return null;
                        return (
                          <Draggable key={colunaId} draggableId={colunaId} index={idx}>
                            {(provided, snapshot) => (
                              <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}
                                className={`flex items-center gap-2 p-2 border rounded text-xs ${snapshot.isDragging ? 'bg-emerald-50' : 'bg-white'} ${!colunasVisiveis.includes(colunaId) ? 'opacity-50' : ''}`}>
                                <GripVertical className="w-4 h-4 text-slate-400" />
                                <span className="flex-1">{col.label}</span>
                                {colunasVisiveis.includes(colunaId) && <Badge variant="outline" className="text-[10px]">Visível</Badge>}
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
        </DialogContent>
      </Dialog>
    </>
  );
}