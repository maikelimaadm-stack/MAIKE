import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input"; import { Label } from "@/components/ui/label"; import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"; import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"; import { base44 } from "@/api/base44Client"; import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Pencil, Trash2, Search, Map, ArrowUpDown, ArrowUp, ArrowDown, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

const CORES_DISPONIVEIS = [
  { nome: "Branco", cor: "#f8f9fa" },
  { nome: "Cinza claro", cor: "#d8dee2" },
  { nome: "Preto", cor: "#2c303e" },
  { nome: "Azul escuro", cor: "#0d67ad" },
  { nome: "Azul celeste", cor: "#61aad9" },
  { nome: "Amarelo", cor: "#efcb19" },
  { nome: "Verde claro", cor: "#92ca25" },
  { nome: "Laranja", cor: "#f5a01b" },
  { nome: "Roxo", cor: "#966fe1" }
];

const TIPOS_CULTURA_FIXAS = ["Pastagem", "Agricultura", "Reserva", "APP", "Infraestrutura"]; 
const APROVEITAMENTO = ["Alta", "Média", "Baixa"]; 

export default function TabelaAreasGeo({ areas, onEdit, onEditDetalhes, onDelete }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState("nome");
  const [sortDirection, setSortDirection] = useState("asc");
  const [selecionados, setSelecionados] = useState([]);
  const [batchType, setBatchType] = useState(null); // 'aproveitamento' | 'cultura' | 'cor' | 'renumerar'
  const [batchValue, setBatchValue] = useState("");
  const [startNumber, setStartNumber] = useState("");
  const queryClient = useQueryClient();

  const filteredAreas = areas.filter(area =>
    area.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    area.tipo_pastagem?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    area.numero_area?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const areasSorted = [...filteredAreas].sort((a, b) => {
    let aValue = a[sortField] || '';
    let bValue = b[sortField] || '';
    if (typeof aValue === 'string') aValue = aValue.toLowerCase();
    if (typeof bValue === 'string') bValue = bValue.toLowerCase();
    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

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

  const handleSelecionarTodos = () => {
    if (selecionados.length === areasSorted.length && areasSorted.length > 0) {
      setSelecionados([]);
    } else {
      setSelecionados(areasSorted.map(a => a.id));
    }
  };

  const handleToggleSelecao = (id) => {
    setSelecionados(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const aplicarLote = async () => {
    if (selecionados.length === 0) { toast.error('Selecione ao menos uma área!'); return; }
    try {
      if (batchType === 'aproveitamento') {
        await Promise.all(selecionados.map(id => base44.entities.AreaPastagem.update(id, { aproveitamento_classificacao: batchValue })));
      } else if (batchType === 'cultura') {
        await Promise.all(selecionados.map(id => base44.entities.AreaPastagem.update(id, { tipo_cultura: batchValue })));
      } else if (batchType === 'cor') {
        await Promise.all(selecionados.map(id => {
          const area = areas.find(a => a.id === id);
          const coords = area?.coordenadas?.coords || [];
          return base44.entities.AreaPastagem.update(id, { cor: batchValue, coordenadas: { coords, cor: batchValue } });
        }));
      } else if (batchType === 'renumerar') {
        const start = parseInt(startNumber || '1');
        const selecionadas = areas.filter(a => selecionados.includes(a.id)).sort((a,b)=> (a.nome||'').localeCompare(b.nome||''));
        await Promise.all(selecionadas.map((a, idx) => base44.entities.AreaPastagem.update(a.id, { numero_area: String(start + idx) })));
      }
      toast.success('Atualizado com sucesso');
      setBatchType(null); setBatchValue(""); setStartNumber(""); setSelecionados([]);
      queryClient.invalidateQueries({ queryKey: ['areas'] });
    } catch {
      toast.error('Falha ao aplicar alterações');
    }
  };

  const handleExcluirEmMassa = async () => {
    if (selecionados.length === 0) {
      toast.error('Selecione ao menos uma área!');
      return;
    }
    if (window.confirm(`Excluir ${selecionados.length} área(s)?`)) {
      for (const id of selecionados) {
        const area = areas.find(a => a.id === id);
        if (area) onDelete(area);
      }
      setSelecionados([]);
    }
  };

  return (
    <Card className="shadow-sm border-slate-300">
      <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Map className="w-4 h-4 text-slate-600" />
            Áreas Cadastradas ({areasSorted.length})
          </CardTitle>
          <div className="flex gap-2 items-center">
            {selecionados.length > 0 && (
              <div className="flex items-center gap-2 bg-slate-100 border border-slate-300 rounded px-2 py-1">
                <span className="text-xs font-semibold text-slate-800">
                  {selecionados.length} selecionado(s)
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
                    <DropdownMenuItem onClick={() => { setBatchType('aproveitamento'); setBatchValue('Alta'); }} className="text-xs">
                      Definir Aproveitamento
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setBatchType('cultura'); setBatchValue('Pastagem'); }} className="text-xs">
                      Definir Tipo de Cultura
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setBatchType('cor'); setBatchValue(CORES_DISPONIVEIS[4].cor); }} className="text-xs">
                      Definir Cor
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setBatchType('renumerar'); setStartNumber('1'); }} className="text-xs">
                      Reatribuir Códigos
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleExcluirEmMassa} className="text-xs text-red-600">
                      <Trash2 className="w-3.5 h-3.5 mr-2" />
                      Excluir
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setSelecionados([])} className="text-xs">
                      <X className="w-3.5 h-3.5 mr-2" />
                      Limpar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
            
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar áreas..."
                className="pl-9 h-8 w-48 text-xs"
              />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b">
                <TableHead className="w-8 text-xs border-r border-slate-200">
                  <Checkbox 
                    checked={selecionados.length === areasSorted.length && areasSorted.length > 0}
                    onCheckedChange={handleSelecionarTodos}
                  />
                </TableHead>
                <TableHead className="text-xs text-center w-8 border-r border-slate-200"></TableHead>
                <TableHead className="text-xs border-r border-slate-200">Código</TableHead>
                <TableHead className="text-xs border-r border-slate-200 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('sigla')}>
                  <div className="flex items-center">Sigla {getSortIcon('sigla')}</div>
                </TableHead>
                <TableHead className="text-xs border-r border-slate-200 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('nome')}>
                  <div className="flex items-center">Nome {getSortIcon('nome')}</div>
                </TableHead>
                <TableHead className="text-xs border-r border-slate-200">Tipo</TableHead>
                <TableHead className="text-xs border-r border-slate-200 text-right">Tamanho (ha)</TableHead>
                <TableHead className="text-xs border-r border-slate-200 text-right">Capacidade</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Ocupação</TableHead>
                <TableHead className="text-xs border-r border-slate-200">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence>
                {areasSorted.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12 text-slate-400 text-xs">
                      Nenhuma área encontrada
                    </TableCell>
                  </TableRow>
                ) : (
                  areasSorted.map((area) => (
                    <motion.tr 
                      key={area.id}
                      initial={{ opacity: 0 }} 
                      animate={{ opacity: 1 }} 
                      exit={{ opacity: 0 }} 
                      className="hover:bg-slate-50 transition-colors border-b"
                    >
                      <TableCell className="border-r border-slate-200">
                        <Checkbox
                          checked={selecionados.includes(area.id)}
                          onCheckedChange={() => handleToggleSelecao(area.id)}
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
                            <DropdownMenuItem onClick={() => onEdit(area)} className="text-xs">
                              <Map className="w-3.5 h-3.5 mr-2" />
                              Editar Área (Mapa)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onEditDetalhes && onEditDetalhes(area)} className="text-xs">
                              <Pencil className="w-3.5 h-3.5 mr-2" />
                              Editar Detalhes
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onDelete(area)} className="text-xs text-red-600">
                              <Trash2 className="w-3.5 h-3.5 mr-2" />
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                      <TableCell className="text-xs font-mono border-r border-slate-200">{area.numero_area || '-'}</TableCell>
                      <TableCell className="text-xs font-semibold border-r border-slate-200 text-emerald-700">{area.sigla || '-'}</TableCell>
                      <TableCell className="text-xs font-medium border-r border-slate-200">{area.nome}</TableCell>
                      <TableCell className="text-xs border-r border-slate-200">{area.tipo_pastagem || '-'}</TableCell>
                      <TableCell className="text-xs text-right font-mono border-r border-slate-200">{area.tamanho_hectares?.toFixed(2) || '-'}</TableCell>
                      <TableCell className="text-xs text-right font-mono border-r border-slate-200">{area.capacidade_maxima || '-'}</TableCell>
                      <TableCell className="text-xs border-r border-slate-200">
                        <Badge variant="outline" className="text-[10px]">
                          {area.quantidade_atual || 0} / {area.capacidade_maxima || 0}
                        </Badge>
                      </TableCell>
                      <TableCell className="border-r border-slate-200">
                        <Badge className="text-[10px] bg-slate-100 text-slate-700">
                          {area.status_ocupacao || 'Disponível'}
                        </Badge>
                      </TableCell>
                    </motion.tr>
                  ))
                )}
              </AnimatePresence>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    {/* Dialogs de Ações em Lote */}
    <Dialog open={!!batchType} onOpenChange={() => { setBatchType(null); setBatchValue(""); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {batchType === 'aproveitamento' && 'Definir Aproveitamento'}
            {batchType === 'cultura' && 'Definir Tipo de Cultura'}
            {batchType === 'cor' && 'Definir Cor no Mapa'}
            {batchType === 'renumerar' && 'Reatribuir Códigos (numero_area)'}
          </DialogTitle>
        </DialogHeader>
        {batchType === 'aproveitamento' && (
          <div className="space-y-2">
            <Label className="text-xs">Aproveitamento</Label>
            <Select value={batchValue} onValueChange={setBatchValue}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {APROVEITAMENTO.map(v => (<SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>))}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>setBatchType(null)}>Cancelar</Button>
              <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={aplicarLote}>Aplicar</Button>
            </div>
          </div>
        )}
        {batchType === 'cultura' && (
          <div className="space-y-2">
            <Label className="text-xs">Tipo de Cultura</Label>
            <Select value={batchValue} onValueChange={setBatchValue}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {TIPOS_CULTURA_FIXAS.map(v => (<SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>))}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>setBatchType(null)}>Cancelar</Button>
              <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={aplicarLote}>Aplicar</Button>
            </div>
          </div>
        )}
        {batchType === 'cor' && (
          <div className="space-y-3">
            <Label className="text-xs">Cor</Label>
            <div className="grid grid-cols-5 gap-2">
              {CORES_DISPONIVEIS.map(c => (
                <button key={c.cor} onClick={() => setBatchValue(c.cor)} className={`h-8 rounded border ${batchValue===c.cor?'ring-2 ring-emerald-600':''}`} style={{ backgroundColor: c.cor }} title={c.nome} />
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>setBatchType(null)}>Cancelar</Button>
              <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={aplicarLote} disabled={!batchValue}>Aplicar</Button>
            </div>
          </div>
        )}
        {batchType === 'renumerar' && (
          <div className="space-y-2">
            <Label className="text-xs">Iniciar numeração a partir de</Label>
            <Input value={startNumber} onChange={(e)=>setStartNumber(e.target.value.replace(/[^0-9]/g,''))} className="h-8 text-xs" placeholder="1" />
            <p className="text-[11px] text-slate-500">As áreas selecionadas serão ordenadas por Nome (A→Z) e receberão códigos sequenciais.</p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>setBatchType(null)}>Cancelar</Button>
              <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={aplicarLote} disabled={!startNumber}>Aplicar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}