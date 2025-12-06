import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, Edit2, FileSpreadsheet, Search, X, DollarSign } from "lucide-react";
import { toast } from "sonner";

const formatarData = (dataString) => {
  if (!dataString) return '--/--/----';
  try {
    const dataStr = dataString.split('T')[0];
    const [ano, mes, dia] = dataStr.split('-');
    return `${dia}/${mes}/${ano}`;
  } catch { return '--/--/----'; }
};

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return 'R$ 0,00';
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function CotacoesPecuaria() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  // Estados do formulário
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [nomeProduto, setNomeProduto] = useState("");
  const [categoria, setCategoria] = useState("");
  const [funcaoTecnica, setFuncaoTecnica] = useState("");
  const [beneficios, setBeneficios] = useState("");
  const [empresaFornecedora, setEmpresaFornecedora] = useState("");
  const [nomeVendedor, setNomeVendedor] = useState("");
  const [telefoneVendedor, setTelefoneVendedor] = useState("");
  const [valorUnitario, setValorUnitario] = useState("");
  const [quantidadeComprada, setQuantidadeComprada] = useState("");
  const [unidadeMedida, setUnidadeMedida] = useState("UN");
  const [dataCotacao, setDataCotacao] = useState(new Date().toISOString().split('T')[0]);
  const [observacoes, setObservacoes] = useState("");

  // Estados de filtro
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [filtroDataInicio, setFiltroDataInicio] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");

  // Fetch produtos
  const { data: produtos = [], isLoading } = useQuery({
    queryKey: ['produtos-cotacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ProdutoCotacao.list('-data_cotacao');
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (data) => await base44.entities.ProdutoCotacao.create(data),
    onSuccess: () => {
      toast.success("Produto adicionado!");
      queryClient.invalidateQueries({ queryKey: ['produtos-cotacao'] });
      limparFormulario();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => await base44.entities.ProdutoCotacao.update(id, data),
    onSuccess: () => {
      toast.success("Produto atualizado!");
      queryClient.invalidateQueries({ queryKey: ['produtos-cotacao'] });
      limparFormulario();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => await base44.entities.ProdutoCotacao.delete(id),
    onSuccess: () => {
      toast.success("Produto excluído!");
      queryClient.invalidateQueries({ queryKey: ['produtos-cotacao'] });
    },
  });

  const handleSalvar = () => {
    if (!nomeProduto.trim() || !categoria || !empresaFornecedora.trim() || !valorUnitario || !quantidadeComprada) {
      toast.error("Preencha todos os campos obrigatórios!");
      return;
    }

    const valorTotal = parseFloat(valorUnitario) * parseFloat(quantidadeComprada);

    const data = {
      empresa_id: empresaSelecionadaId,
      nome_produto: nomeProduto.trim(),
      categoria,
      funcao_tecnica: funcaoTecnica.trim() || null,
      beneficios: beneficios.trim() || null,
      empresa_fornecedora: empresaFornecedora.trim(),
      nome_vendedor: nomeVendedor.trim() || null,
      telefone_vendedor: telefoneVendedor.trim() || null,
      valor_unitario: parseFloat(valorUnitario),
      quantidade_comprada: parseFloat(quantidadeComprada),
      unidade_medida: unidadeMedida,
      valor_total: valorTotal,
      data_cotacao: dataCotacao,
      observacoes: observacoes.trim() || null,
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const limparFormulario = () => {
    setEditingId(null);
    setNomeProduto("");
    setCategoria("");
    setFuncaoTecnica("");
    setBeneficios("");
    setEmpresaFornecedora("");
    setNomeVendedor("");
    setTelefoneVendedor("");
    setValorUnitario("");
    setQuantidadeComprada("");
    setUnidadeMedida("UN");
    setDataCotacao(new Date().toISOString().split('T')[0]);
    setObservacoes("");
    setShowForm(false);
  };

  const handleEditar = (produto) => {
    setEditingId(produto.id);
    setNomeProduto(produto.nome_produto);
    setCategoria(produto.categoria);
    setFuncaoTecnica(produto.funcao_tecnica || "");
    setBeneficios(produto.beneficios || "");
    setEmpresaFornecedora(produto.empresa_fornecedora);
    setNomeVendedor(produto.nome_vendedor || "");
    setTelefoneVendedor(produto.telefone_vendedor || "");
    setValorUnitario(String(produto.valor_unitario));
    setQuantidadeComprada(String(produto.quantidade_comprada));
    setUnidadeMedida(produto.unidade_medida || "UN");
    setDataCotacao(produto.data_cotacao);
    setObservacoes(produto.observacoes || "");
    setShowForm(true);
  };

  // Filtrar produtos
  const produtosFiltrados = useMemo(() => {
    let filtered = produtos;

    if (searchTerm) {
      const termo = searchTerm.toLowerCase();
      filtered = filtered.filter(p => 
        p.nome_produto?.toLowerCase().includes(termo) ||
        p.empresa_fornecedora?.toLowerCase().includes(termo) ||
        p.nome_vendedor?.toLowerCase().includes(termo)
      );
    }

    if (filtroCategoria) {
      filtered = filtered.filter(p => p.categoria === filtroCategoria);
    }

    if (filtroEmpresa) {
      filtered = filtered.filter(p => p.empresa_fornecedora === filtroEmpresa);
    }

    if (filtroDataInicio) {
      filtered = filtered.filter(p => p.data_cotacao >= filtroDataInicio);
    }

    if (filtroDataFim) {
      filtered = filtered.filter(p => p.data_cotacao <= filtroDataFim);
    }

    return filtered;
  }, [produtos, searchTerm, filtroCategoria, filtroEmpresa, filtroDataInicio, filtroDataFim]);

  // Valores únicos
  const empresasUnicas = [...new Set(produtos.map(p => p.empresa_fornecedora).filter(Boolean))].sort();
  const custoTotal = produtosFiltrados.reduce((s, p) => s + (p.valor_total || 0), 0);

  const exportarCSV = () => {
    const headers = ['Data', 'Produto', 'Categoria', 'Função', 'Benefícios', 'Fornecedor', 'Vendedor', 'Telefone', 'Valor Un.', 'Qtd', 'Un.', 'Total'];
    const rows = produtosFiltrados.map(p => [
      formatarData(p.data_cotacao),
      p.nome_produto,
      p.categoria,
      p.funcao_tecnica || '',
      p.beneficios || '',
      p.empresa_fornecedora,
      p.nome_vendedor || '',
      p.telefone_vendedor || '',
      p.valor_unitario,
      p.quantidade_comprada,
      p.unidade_medida,
      p.valor_total
    ]);

    const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cotacoes_pecuaria_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exportado!");
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center bg-white rounded px-3 py-2 shadow-sm border-b border-slate-200">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Cotações de Produtos Pecuários</h1>
          <p className="text-xs text-slate-600">Registre cotações de medicamentos, suplementos e insumos</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportarCSV} className="h-8 text-xs">
            <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />
            Exportar
          </Button>
          <Button size="sm" onClick={() => setShowForm(true)} className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-3.5 h-3.5 mr-1" />
            Nova Cotação
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="md:col-span-2 relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Buscar produto, fornecedor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-8 text-xs pl-8"
              />
            </div>
            <Select value={filtroCategoria} onValueChange={setFiltroCategoria}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todas</SelectItem>
                <SelectItem value="Vermífugo">Vermífugo</SelectItem>
                <SelectItem value="Vacina">Vacina</SelectItem>
                <SelectItem value="Pour-on">Pour-on</SelectItem>
                <SelectItem value="Mineral">Mineral</SelectItem>
                <SelectItem value="Suplemento">Suplemento</SelectItem>
                <SelectItem value="Antibiótico">Antibiótico</SelectItem>
                <SelectItem value="Outros">Outros</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroEmpresa} onValueChange={setFiltroEmpresa}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Fornecedor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todos</SelectItem>
                {empresasUnicas.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={filtroDataInicio} onChange={(e) => setFiltroDataInicio(e.target.value)} className="h-8 text-xs" placeholder="Data início" />
            <Input type="date" value={filtroDataFim} onChange={(e) => setFiltroDataFim(e.target.value)} className="h-8 text-xs" placeholder="Data fim" />
          </div>
          <div className="flex justify-between items-center mt-2">
            <div className="text-xs text-slate-500">
              {produtosFiltrados.length} de {produtos.length} produtos
            </div>
            <Button variant="outline" size="sm" onClick={() => { setSearchTerm(""); setFiltroCategoria(""); setFiltroEmpresa(""); setFiltroDataInicio(""); setFiltroDataFim(""); }} className="h-7 text-xs">
              Limpar Filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Resumo */}
      <Card className="bg-emerald-50 border-emerald-200">
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-emerald-700" />
              <span className="text-sm font-semibold text-emerald-800">Custo Total da Cotação:</span>
            </div>
            <span className="text-2xl font-bold text-emerald-700">
              {formatarMoeda(custoTotal)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-white">
                  <TableHead className="text-xs font-bold py-1 border border-black">Data</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Produto</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Categoria</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Função</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Fornecedor</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Vendedor</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Telefone</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Valor Un.</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Total</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black w-20">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={11} className="text-center py-4 text-xs">Carregando...</TableCell></TableRow>
                ) : produtosFiltrados.length === 0 ? (
                  <TableRow><TableCell colSpan={11} className="text-center py-8 text-xs text-slate-400">Nenhuma cotação registrada</TableCell></TableRow>
                ) : (
                  produtosFiltrados.map(p => (
                    <TableRow key={p.id} className="hover:bg-gray-50">
                      <TableCell className="text-xs py-1 border border-gray-300">{formatarData(p.data_cotacao)}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 font-semibold">{p.nome_produto}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">
                        <Badge variant="outline" className="text-[10px]">{p.categoria}</Badge>
                      </TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{p.funcao_tecnica || '-'}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{p.empresa_fornecedora}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{p.nome_vendedor || '-'}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{p.telefone_vendedor || '-'}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarMoeda(p.valor_unitario)}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right">{p.quantidade_comprada.toLocaleString('pt-BR')} {p.unidade_medida}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold text-emerald-700">{formatarMoeda(p.valor_total)}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleEditar(p)}>
                            <Edit2 className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => {
                            if (confirm('Excluir este produto?')) deleteMutation.mutate(p.id);
                          }}>
                            <Trash2 className="w-3 h-3" />
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

      {/* Dialog Formulário */}
      <Dialog open={showForm} onOpenChange={(open) => { setShowForm(open); if (!open) limparFormulario(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Produto' : 'Nova Cotação de Produto'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Nome do Produto <span className="text-red-500">*</span></Label>
                <Input value={nomeProduto} onChange={(e) => setNomeProduto(e.target.value)} className="h-8 text-xs" placeholder="Ex: Ivermectina 1%" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Categoria <span className="text-red-500">*</span></Label>
                <Select value={categoria} onValueChange={setCategoria}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Vermífugo">Vermífugo</SelectItem>
                    <SelectItem value="Vacina">Vacina</SelectItem>
                    <SelectItem value="Pour-on">Pour-on</SelectItem>
                    <SelectItem value="Mineral">Mineral</SelectItem>
                    <SelectItem value="Suplemento">Suplemento</SelectItem>
                    <SelectItem value="Antibiótico">Antibiótico</SelectItem>
                    <SelectItem value="Outros">Outros</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Para que serve (Função Técnica)</Label>
                <Input value={funcaoTecnica} onChange={(e) => setFuncaoTecnica(e.target.value)} className="h-8 text-xs" placeholder="Ex: Controle de vermes" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Benefícios Diretos</Label>
                <Textarea value={beneficios} onChange={(e) => setBeneficios(e.target.value)} className="h-16 text-xs" placeholder="Ex: Melhora absorção de nutrientes..." />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Empresa Fornecedora <span className="text-red-500">*</span></Label>
                <Input value={empresaFornecedora} onChange={(e) => setEmpresaFornecedora(e.target.value)} className="h-8 text-xs" placeholder="Ex: Agropecuária XYZ" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nome do Vendedor</Label>
                <Input value={nomeVendedor} onChange={(e) => setNomeVendedor(e.target.value)} className="h-8 text-xs" placeholder="Ex: João Silva" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Telefone/WhatsApp</Label>
                <Input value={telefoneVendedor} onChange={(e) => setTelefoneVendedor(e.target.value)} className="h-8 text-xs" placeholder="(65) 99999-9999" />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Valor Unitário (R$) <span className="text-red-500">*</span></Label>
                <Input type="number" value={valorUnitario} onChange={(e) => setValorUnitario(e.target.value)} className="h-8 text-xs" placeholder="0.00" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Quantidade <span className="text-red-500">*</span></Label>
                <Input type="number" value={quantidadeComprada} onChange={(e) => setQuantidadeComprada(e.target.value)} className="h-8 text-xs" placeholder="0" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Unidade</Label>
                <Select value={unidadeMedida} onValueChange={setUnidadeMedida}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UN">UN</SelectItem>
                    <SelectItem value="KG">KG</SelectItem>
                    <SelectItem value="LT">LT</SelectItem>
                    <SelectItem value="ML">ML</SelectItem>
                    <SelectItem value="SC">SC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Data Cotação <span className="text-red-500">*</span></Label>
                <Input type="date" value={dataCotacao} onChange={(e) => setDataCotacao(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Valor Total</Label>
                <div className="h-8 flex items-center text-sm font-bold text-emerald-700 px-2 bg-emerald-50 rounded border border-emerald-200">
                  {formatarMoeda((parseFloat(valorUnitario) || 0) * (parseFloat(quantidadeComprada) || 0))}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Observações</Label>
              <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} className="h-16 text-xs" placeholder="Observações sobre a cotação..." />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <Button variant="outline" onClick={() => limparFormulario()} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button onClick={handleSalvar} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                <Plus className="w-3.5 h-3.5 mr-1" />
                {editingId ? 'Atualizar' : 'Salvar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}