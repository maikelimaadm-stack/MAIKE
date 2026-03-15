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
import { Plus, Trash2, Syringe } from "lucide-react";
import { toast } from "sonner";
import { formatDateBR, formatDecimal, safeDivide } from "@/components/utils/pecuariaUtils";

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return 'R$ 0,00';
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function AplicacoesMedicamentos() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  // Estados
  const [loteSelecionado, setLoteSelecionado] = useState("");
  const [produtoSelecionado, setProdutoSelecionado] = useState("");
  const [quantidadeAplicada, setQuantidadeAplicada] = useState("");
  const [dataAplicacao, setDataAplicacao] = useState(new Date().toISOString().split('T')[0]);
  const [observacoes, setObservacoes] = useState("");

  // Fetch dados
  const { data: lotes = [] } = useQuery({
    queryKey: ['lotes-animais-cotacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LoteAnimaisCotacao.list();
      return all.filter(l => l.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos-cotacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ProdutoCotacao.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: aplicacoes = [] } = useQuery({
    queryKey: ['aplicacoes-medicamentos', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AplicacaoMedicamento.list('-data_aplicacao');
      return all.filter(a => a.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (data) => await base44.entities.AplicacaoMedicamento.create(data),
    onSuccess: () => {
      toast.success("Aplicação registrada!");
      queryClient.invalidateQueries({ queryKey: ['aplicacoes-medicamentos'] });
      limparFormulario();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => await base44.entities.AplicacaoMedicamento.delete(id),
    onSuccess: () => {
      toast.success("Aplicação excluída!");
      queryClient.invalidateQueries({ queryKey: ['aplicacoes-medicamentos'] });
    },
  });

  const handleAplicar = () => {
    if (!loteSelecionado || !produtoSelecionado || !quantidadeAplicada) {
      toast.error("Preencha todos os campos obrigatórios!");
      return;
    }

    const lote = lotes.find(l => l.id === loteSelecionado);
    const produto = produtos.find(p => p.id === produtoSelecionado);

    if (!lote || !produto) {
      toast.error("Lote ou produto inválido!");
      return;
    }

    const qtdAplicada = parseFloat(quantidadeAplicada);
    const custoPorAnimal = qtdAplicada * produto.valor_unitario;
    const custoTotal = custoPorAnimal * lote.quantidade_animais;

    const data = {
      empresa_id: empresaSelecionadaId,
      lote_id: lote.id,
      lote_nome: lote.nome_lote,
      produto_id: produto.id,
      produto_nome: produto.nome_produto,
      categoria_produto: produto.categoria,
      quantidade_aplicada: qtdAplicada,
      unidade_medida: produto.unidade_medida,
      valor_unitario: produto.valor_unitario,
      custo_por_animal: custoPorAnimal,
      quantidade_animais: lote.quantidade_animais,
      custo_total: custoTotal,
      data_aplicacao: dataAplicacao,
      observacoes: observacoes.trim() || null,
    };

    createMutation.mutate(data);
  };

  const limparFormulario = () => {
    setProdutoSelecionado("");
    setQuantidadeAplicada("");
    setObservacoes("");
  };

  // Aplicações do lote selecionado
  const aplicacoesLote = useMemo(() => {
    if (!loteSelecionado) return [];
    return aplicacoes.filter(a => a.lote_id === loteSelecionado);
  }, [aplicacoes, loteSelecionado]);

  const custoTotalLote = aplicacoesLote.reduce((s, a) => s + (a.custo_total || 0), 0);
  const loteAtual = lotes.find(l => l.id === loteSelecionado);
  const custoPorAnimalTotal = safeDivide(custoTotalLote, loteAtual?.quantidade_animais);

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="bg-white rounded px-3 py-2 shadow-sm border-b border-slate-200">
        <h1 className="text-lg font-bold text-slate-900">Aplicação de Medicamentos</h1>
        <p className="text-xs text-slate-600">Vincule produtos da cotação aos lotes de animais</p>
      </div>

      {/* Seleção de Lote */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Selecione o Lote <span className="text-red-500">*</span></Label>
              <Select value={loteSelecionado} onValueChange={setLoteSelecionado}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Escolha um lote" /></SelectTrigger>
                <SelectContent>
                  {lotes.map(l => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.nome_lote} ({l.quantidade_animais} animais - {formatDecimal(l.peso_medio_atual || 0, 0, true)}kg)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {loteAtual && (
              <div className="flex items-end">
                <div className="text-xs">
                  <div className="font-semibold text-blue-800">Lote: {loteAtual.nome_lote}</div>
                  <div className="text-blue-600">{loteAtual.quantidade_animais} animais • {formatDecimal(loteAtual.peso_medio_atual || 0)}kg • GMD: {formatDecimal(loteAtual.gmd_esperado || 0, 3)}</div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Formulário de Aplicação */}
      {loteSelecionado && (
        <Card className="border-emerald-200">
          <CardHeader className="py-2 px-3 bg-emerald-50">
            <CardTitle className="text-sm text-emerald-800 flex items-center gap-2">
              <Syringe className="w-4 h-4" />
              Adicionar Produto
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="space-y-3">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Produto <span className="text-red-500">*</span></Label>
                  <Select value={produtoSelecionado} onValueChange={setProdutoSelecionado}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {produtos.map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.nome_produto} - R$ {formatDecimal(p.valor_unitario || 0)}/{p.unidade_medida}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Quantidade por Animal <span className="text-red-500">*</span></Label>
                  <Input type="number" step="0.01" value={quantidadeAplicada} onChange={(e) => setQuantidadeAplicada(e.target.value)} className="h-8 text-xs" placeholder="Ex: 10" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Data Aplicação</Label>
                  <Input type="date" value={dataAplicacao} onChange={(e) => setDataAplicacao(e.target.value)} className="h-8 text-xs" />
                </div>
              </div>

              {produtoSelecionado && quantidadeAplicada && loteAtual && (
                <div className="bg-emerald-50 border border-emerald-200 rounded p-2">
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-emerald-600">Custo por Animal:</span>
                      <div className="font-bold text-emerald-800">
                        {formatarMoeda(parseFloat(quantidadeAplicada) * produtos.find(p => p.id === produtoSelecionado)?.valor_unitario || 0)}
                      </div>
                    </div>
                    <div>
                      <span className="text-emerald-600">Custo Total:</span>
                      <div className="font-bold text-emerald-800">
                        {formatarMoeda((parseFloat(quantidadeAplicada) * produtos.find(p => p.id === produtoSelecionado)?.valor_unitario || 0) * loteAtual.quantidade_animais)}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs">Observações</Label>
                <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} className="h-12 text-xs" placeholder="Observações..." />
              </div>

              <div className="flex justify-end">
                <Button onClick={handleAplicar} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Registrar Aplicação
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resumo do Lote */}
      {loteSelecionado && aplicacoesLote.length > 0 && (
        <Card className="border-emerald-200">
          <CardHeader className="py-2 px-3 bg-emerald-50">
            <div className="flex justify-between items-center">
              <CardTitle className="text-sm text-emerald-800">Medicamentos Aplicados - {loteAtual?.nome_lote}</CardTitle>
              <div className="text-right">
                <div className="text-xs text-emerald-600">Custo Total</div>
                <div className="text-xl font-bold text-emerald-800">{formatarMoeda(custoTotalLote)}</div>
                <div className="text-[10px] text-emerald-600">{formatarMoeda(custoPorAnimalTotal)}/animal</div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-white">
                    <TableHead className="text-xs font-bold py-1 border border-black">Data</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Produto</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Categoria</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd/Animal</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Custo/Animal</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Custo Total</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black w-16">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aplicacoesLote.map(a => (
                    <TableRow key={a.id} className="hover:bg-gray-50">
                      <TableCell className="text-xs py-1 border border-gray-300">{formatDateBR(a.data_aplicacao)}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 font-semibold">{a.produto_nome}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">
                        <Badge variant="outline" className="text-[10px]">{a.categoria_produto}</Badge>
                      </TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right">{formatDecimal(a.quantidade_aplicada, 2)} {a.unidade_medida}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarMoeda(a.custo_por_animal)}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold text-emerald-700">{formatarMoeda(a.custo_total)}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => {
                          if (confirm('Excluir esta aplicação?')) deleteMutation.mutate(a.id);
                        }}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}