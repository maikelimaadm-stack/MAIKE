import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Search, Eye, FileText, Package, DollarSign } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import CartoesResumo from "../components/shared/CartoesResumo";

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function LivrosFiscais() {
  const [filtros, setFiltros] = useState({
    tipo_livro: "todos",
    tipo_documento: "todos",
    data_inicio: "",
    data_fim: "",
    fornecedor: "",
    searchTerm: ""
  });
  const [detalhesAberto, setDetalhesAberto] = useState(null);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: livros = [], isLoading } = useQuery({
    queryKey: ['livros_fiscais', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LivroFiscal.list('-data_emissao');
      return all.filter(l => l.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const livrosFiltrados = livros.filter(livro => {
    if (filtros.tipo_livro !== "todos" && livro.tipo_livro !== filtros.tipo_livro) return false;
    if (filtros.tipo_documento !== "todos" && livro.tipo_documento !== filtros.tipo_documento) return false;
    if (filtros.data_inicio && livro.data_emissao < filtros.data_inicio) return false;
    if (filtros.data_fim && livro.data_emissao > filtros.data_fim) return false;
    if (filtros.fornecedor && !livro.fornecedor_nome?.toLowerCase().includes(filtros.fornecedor.toLowerCase())) return false;
    if (filtros.searchTerm && !livro.numero_documento?.toLowerCase().includes(filtros.searchTerm.toLowerCase()) && !livro.chave_acesso?.toLowerCase().includes(filtros.searchTerm.toLowerCase())) return false;
    return true;
  });

  const estatisticas = useMemo(() => {
    const totalEntradas = livrosFiltrados.filter(l => l.tipo_livro === 'Entrada').length;
    const totalSaidas = livrosFiltrados.filter(l => l.tipo_livro === 'Saída').length;
    const valorTotal = livrosFiltrados.reduce((sum, l) => sum + (l.valor_total_nota || 0), 0);
    return { totalEntradas, totalSaidas, valorTotal };
  }, [livrosFiltrados]);

  const cartoes = [
    { id: 'total', label: 'Total de Registros', valor: livrosFiltrados.length, sublabel: 'Livros', icon: BookOpen, cor: 'blue', tipo: 'numero' },
    { id: 'entradas', label: 'Entradas', valor: estatisticas.totalEntradas, sublabel: 'NF-e recebidas', icon: FileText, cor: 'emerald', tipo: 'numero' },
    { id: 'saidas', label: 'Saídas', valor: estatisticas.totalSaidas, sublabel: 'NF-e emitidas', icon: FileText, cor: 'orange', tipo: 'numero' },
    { id: 'valor', label: 'Valor Total', valor: estatisticas.valorTotal, sublabel: 'Soma notas', icon: DollarSign, cor: 'violet', tipo: 'moeda' },
  ];

  return (
    <div className="p-4 md:p-6 space-y-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Livros Fiscais</h1>
          <p className="text-xs text-slate-600">Registros de entrada e saída</p>
        </div>
      </div>

      <CartoesResumo cartoes={cartoes} />

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Tipo Livro</Label>
              <Select value={filtros.tipo_livro} onValueChange={(v) => setFiltros({ ...filtros, tipo_livro: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                  <SelectItem value="Entrada" className="text-xs">Entrada</SelectItem>
                  <SelectItem value="Saída" className="text-xs">Saída</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tipo Doc</Label>
              <Select value={filtros.tipo_documento} onValueChange={(v) => setFiltros({ ...filtros, tipo_documento: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                  <SelectItem value="NF-e" className="text-xs">NF-e</SelectItem>
                  <SelectItem value="NFC-e" className="text-xs">NFC-e</SelectItem>
                  <SelectItem value="CT-e" className="text-xs">CT-e</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Data Início</Label>
              <Input type="date" value={filtros.data_inicio} onChange={(e) => setFiltros({ ...filtros, data_inicio: e.target.value })} className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Data Fim</Label>
              <Input type="date" value={filtros.data_fim} onChange={(e) => setFiltros({ ...filtros, data_fim: e.target.value })} className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Fornecedor</Label>
              <Input value={filtros.fornecedor} onChange={(e) => setFiltros({ ...filtros, fornecedor: e.target.value })} placeholder="Nome" className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-slate-400" />
                <Input value={filtros.searchTerm} onChange={(e) => setFiltros({ ...filtros, searchTerm: e.target.value })} placeholder="Doc/Chave" className="pl-8 h-8 text-xs" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <BookOpen className="w-4 h-4" />
            Registros ({livrosFiltrados.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead>Nº</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Doc</TableHead>
                  <TableHead>Nº Doc</TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-xs">Carregando...</TableCell>
                  </TableRow>
                ) : livrosFiltrados.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-slate-400 text-xs">Nenhum registro</TableCell>
                  </TableRow>
                ) : (
                  livrosFiltrados.map((livro) => (
                    <TableRow key={livro.id} className="text-xs">
                      <TableCell className="font-bold">{livro.numero_registro}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs py-0 ${livro.tipo_livro === 'Entrada' ? 'bg-emerald-100 text-emerald-800' : 'bg-orange-100 text-orange-800'}`}>
                          {livro.tipo_livro}
                        </Badge>
                      </TableCell>
                      <TableCell>{livro.tipo_documento}</TableCell>
                      <TableCell className="font-mono">{livro.numero_documento}</TableCell>
                      <TableCell>{new Date(livro.data_emissao).toLocaleDateString('pt-BR')}</TableCell>
                      <TableCell>{livro.fornecedor_nome || '-'}</TableCell>
                      <TableCell className="text-right font-mono">{formatarMoeda(livro.valor_total_nota)}</TableCell>
                      <TableCell>
                        <div className="flex justify-center">
                          <Button variant="ghost" size="icon" onClick={() => setDetalhesAberto(livro)} className="h-7 w-7">
                            <Eye className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!detalhesAberto} onOpenChange={(open) => !open && setDetalhesAberto(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">Detalhes - Registro #{detalhesAberto?.numero_registro}</DialogTitle>
          </DialogHeader>
          {detalhesAberto && (
            <div className="space-y-3">
              <Card className="shadow-sm">
                <CardHeader className="pb-2"><CardTitle className="text-xs">Informações Gerais</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-2 text-xs">
                  <div><strong>Nº:</strong> {detalhesAberto.numero_registro}</div>
                  <div><strong>Tipo:</strong> {detalhesAberto.tipo_livro}</div>
                  <div><strong>Documento:</strong> {detalhesAberto.tipo_documento}</div>
                  <div><strong>Nº Doc:</strong> {detalhesAberto.numero_documento}</div>
                  <div><strong>Série:</strong> {detalhesAberto.serie_documento || '-'}</div>
                  <div><strong>Emissão:</strong> {new Date(detalhesAberto.data_emissao).toLocaleDateString('pt-BR')}</div>
                  <div className="col-span-2"><strong>Chave:</strong> <span className="font-mono text-[10px]">{detalhesAberto.chave_acesso}</span></div>
                </CardContent>
              </Card>

              {detalhesAberto.fornecedor_nome && (
                <Card className="shadow-sm">
                  <CardHeader className="pb-2"><CardTitle className="text-xs">Fornecedor</CardTitle></CardHeader>
                  <CardContent className="grid grid-cols-2 gap-2 text-xs">
                    <div><strong>Nome:</strong> {detalhesAberto.fornecedor_nome}</div>
                    <div><strong>CNPJ/CPF:</strong> {detalhesAberto.fornecedor_cnpj_cpf || '-'}</div>
                  </CardContent>
                </Card>
              )}

              <Card className="shadow-sm">
                <CardHeader className="pb-2"><CardTitle className="text-xs">Valores</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-2 text-xs">
                  <div><strong>Produtos:</strong> {formatarMoeda(detalhesAberto.valor_produtos)}</div>
                  <div><strong>Total:</strong> <span className="text-emerald-700 font-bold">{formatarMoeda(detalhesAberto.valor_total_nota)}</span></div>
                </CardContent>
              </Card>

              {detalhesAberto.itens?.length > 0 && (
                <Card className="shadow-sm">
                  <CardHeader className="pb-2"><CardTitle className="text-xs">Produtos ({detalhesAberto.itens.length})</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="text-xs">
                          <TableHead>Produto</TableHead>
                          <TableHead className="text-right">Qtd</TableHead>
                          <TableHead className="text-right">Vlr Unit</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detalhesAberto.itens.map((item, idx) => (
                          <TableRow key={idx} className="text-xs">
                            <TableCell className="font-semibold">{item.produto_nome}</TableCell>
                            <TableCell className="text-right font-mono">{item.quantidade} {item.unidade}</TableCell>
                            <TableCell className="text-right font-mono">{formatarMoeda(item.valor_unitario)}</TableCell>
                            <TableCell className="text-right font-mono font-bold">{formatarMoeda(item.valor_total)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}