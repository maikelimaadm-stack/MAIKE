import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FileText, Search, Filter, Download, Eye } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function LivrosFiscais() {
  const [tipoLivro, setTipoLivro] = useState("Entrada");
  const [tipoDocumento, setTipoDocumento] = useState([]);
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [registroDetalhes, setRegistroDetalhes] = useState(null);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: registros = [], isLoading } = useQuery({
    queryKey: ['livros_fiscais', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LivroFiscal.list('-data_emissao');
      return all.filter(r => r.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const registrosFiltrados = registros.filter(r => {
    if (r.tipo_livro !== tipoLivro) return false;
    if (tipoDocumento.length > 0 && !tipoDocumento.includes(r.tipo_documento)) return false;
    
    if (dataInicio) {
      const dataEmissao = new Date(r.data_emissao);
      const dataIni = new Date(dataInicio);
      if (dataEmissao < dataIni) return false;
    }
    
    if (dataFim) {
      const dataEmissao = new Date(r.data_emissao);
      const dataF = new Date(dataFim);
      if (dataEmissao > dataF) return false;
    }
    
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        r.numero_documento?.toLowerCase().includes(search) ||
        r.fornecedor_nome?.toLowerCase().includes(search) ||
        r.cliente_nome?.toLowerCase().includes(search) ||
        r.chave_acesso?.includes(search)
      );
    }
    
    return true;
  });

  const toggleTipoDocumento = (tipo) => {
    setTipoDocumento(prev =>
      prev.includes(tipo) ? prev.filter(t => t !== tipo) : [...prev, tipo]
    );
  };

  const totais = {
    total: registrosFiltrados.reduce((s, r) => s + (r.valor_total_nota || 0), 0),
    icms: registrosFiltrados.reduce((s, r) => s + (r.valor_icms || 0), 0),
    ipi: registrosFiltrados.reduce((s, r) => s + (r.valor_ipi || 0), 0),
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg">
            <FileText className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-blue-900">Livros Fiscais</h1>
            <p className="text-blue-700">Registros fiscais e contábeis</p>
          </div>
        </div>
      </div>

      {/* Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-600">Total Registros</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{registrosFiltrados.length}</div>
          </CardContent>
        </Card>

        <Card className="shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-600">Valor Total</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-700">{formatarMoeda(totais.total)}</div>
          </CardContent>
        </Card>

        <Card className="shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-600">ICMS</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-700">{formatarMoeda(totais.icms)}</div>
          </CardContent>
        </Card>

        <Card className="shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-600">IPI</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-700">{formatarMoeda(totais.ipi)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card className="shadow-lg">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
          <CardTitle className="flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Tipo de Livro</Label>
              <Select value={tipoLivro} onValueChange={setTipoLivro}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Entrada">Livro de Entrada</SelectItem>
                  <SelectItem value="Saída">Livro de Saída</SelectItem>
                  <SelectItem value="Apuração ICMS">Apuração ICMS</SelectItem>
                  <SelectItem value="Apuração IPI">Apuração IPI</SelectItem>
                  <SelectItem value="Inventário">Inventário</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Data Início</Label>
              <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Data Fim</Label>
              <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Buscar</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input placeholder="Documento, fornecedor..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">Tipo Doc. {tipoDocumento.length > 0 && `(${tipoDocumento.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Tipo de Documento</h4>
                  {['NF-e', 'NFC-e', 'CT-e', 'Recibo', 'Cupom Fiscal', 'Nota Manual'].map(t => (
                    <div key={t} className="flex items-center space-x-2">
                      <Checkbox checked={tipoDocumento.includes(t)} onCheckedChange={() => toggleTipoDocumento(t)} />
                      <label className="text-sm cursor-pointer">{t}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Button variant="outline" onClick={() => { setTipoDocumento([]); setDataInicio(''); setDataFim(''); setSearchTerm(''); }}>
              Limpar Filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card className="shadow-xl">
        <CardHeader className="bg-gradient-to-r from-slate-50 to-blue-50">
          <CardTitle className="flex items-center gap-3">
            <FileText className="w-5 h-5" />
            {tipoLivro} - {registrosFiltrados.length} registro(s)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>Nº</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Tipo Doc.</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>{tipoLivro === 'Entrada' ? 'Fornecedor' : 'Cliente'}</TableHead>
                <TableHead>CFOP</TableHead>
                <TableHead className="text-right">Valor Total</TableHead>
                <TableHead className="text-right">ICMS</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {registrosFiltrados.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-12 text-slate-400">
                    Nenhum registro encontrado
                  </TableCell>
                </TableRow>
              ) : (
                registrosFiltrados.map((reg) => (
                  <TableRow key={reg.id} className="hover:bg-slate-50">
                    <TableCell className="font-bold">{reg.numero_registro}</TableCell>
                    <TableCell className="text-xs">{new Date(reg.data_emissao).toLocaleDateString('pt-BR')}</TableCell>
                    <TableCell><Badge variant="outline">{reg.tipo_documento}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{reg.numero_documento}</TableCell>
                    <TableCell className="text-xs">{reg.fornecedor_nome || reg.cliente_nome || '-'}</TableCell>
                    <TableCell className="font-mono text-xs">{reg.cfop || '-'}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{formatarMoeda(reg.valor_total_nota)}</TableCell>
                    <TableCell className="text-right font-mono text-blue-700">{formatarMoeda(reg.valor_icms || 0)}</TableCell>
                    <TableCell>
                      <Badge className={reg.status === 'Ativo' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                        {reg.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setRegistroDetalhes(reg)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog Detalhes */}
      <Dialog open={!!registroDetalhes} onOpenChange={(open) => !open && setRegistroDetalhes(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes do Registro Fiscal</DialogTitle>
          </DialogHeader>
          {registroDetalhes && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Informações do Documento</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <div><strong>Nº Registro:</strong> {registroDetalhes.numero_registro}</div>
                  <div><strong>Tipo Livro:</strong> {registroDetalhes.tipo_livro}</div>
                  <div><strong>Tipo Doc.:</strong> {registroDetalhes.tipo_documento}</div>
                  <div><strong>Nº Doc.:</strong> {registroDetalhes.numero_documento}</div>
                  <div><strong>Série:</strong> {registroDetalhes.serie_documento || '-'}</div>
                  <div><strong>Data Emissão:</strong> {new Date(registroDetalhes.data_emissao).toLocaleDateString('pt-BR')}</div>
                  {registroDetalhes.chave_acesso && (
                    <div className="col-span-2"><strong>Chave:</strong> <span className="font-mono text-xs">{registroDetalhes.chave_acesso}</span></div>
                  )}
                  <div><strong>CFOP:</strong> {registroDetalhes.cfop}</div>
                  <div><strong>Natureza:</strong> {registroDetalhes.natureza_operacao || '-'}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Valores</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <div><strong>Valor Produtos:</strong> {formatarMoeda(registroDetalhes.valor_produtos || 0)}</div>
                  <div><strong>Frete:</strong> {formatarMoeda(registroDetalhes.valor_frete || 0)}</div>
                  <div><strong>Desconto:</strong> {formatarMoeda(registroDetalhes.valor_desconto || 0)}</div>
                  <div><strong>Outras Despesas:</strong> {formatarMoeda(registroDetalhes.valor_outras_despesas || 0)}</div>
                  <div className="col-span-2 text-lg"><strong>Total NF-e:</strong> <span className="text-green-700 font-bold">{formatarMoeda(registroDetalhes.valor_total_nota)}</span></div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Impostos</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <div><strong>Base ICMS:</strong> {formatarMoeda(registroDetalhes.base_calculo_icms || 0)}</div>
                  <div><strong>Valor ICMS:</strong> {formatarMoeda(registroDetalhes.valor_icms || 0)}</div>
                  <div><strong>Base ICMS ST:</strong> {formatarMoeda(registroDetalhes.base_calculo_icms_st || 0)}</div>
                  <div><strong>Valor ICMS ST:</strong> {formatarMoeda(registroDetalhes.valor_icms_st || 0)}</div>
                  <div><strong>IPI:</strong> {formatarMoeda(registroDetalhes.valor_ipi || 0)}</div>
                  <div><strong>PIS:</strong> {formatarMoeda(registroDetalhes.valor_pis || 0)}</div>
                  <div><strong>COFINS:</strong> {formatarMoeda(registroDetalhes.valor_cofins || 0)}</div>
                </CardContent>
              </Card>

              {registroDetalhes.itens && registroDetalhes.itens.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Itens ({registroDetalhes.itens.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Produto</TableHead>
                          <TableHead>NCM</TableHead>
                          <TableHead className="text-right">Qtd</TableHead>
                          <TableHead className="text-right">Vlr Unit.</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {registroDetalhes.itens.map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="text-xs">{item.produto_nome}</TableCell>
                            <TableCell className="font-mono text-xs">{item.ncm}</TableCell>
                            <TableCell className="text-right text-xs">{item.quantidade}</TableCell>
                            <TableCell className="text-right text-xs">{formatarMoeda(item.valor_unitario)}</TableCell>
                            <TableCell className="text-right font-semibold">{formatarMoeda(item.valor_total)}</TableCell>
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