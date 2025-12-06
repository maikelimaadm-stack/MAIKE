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
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, Edit2, Users, TrendingUp } from "lucide-react";
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

const formatarNumero = (valor, decimals = 2) => {
  if (!valor && valor !== 0) return '0,00';
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

export default function LotesAnimaisCotacao() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  // Estados do formulário
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [nomeLote, setNomeLote] = useState("");
  const [dataRegistro, setDataRegistro] = useState(new Date().toISOString().split('T')[0]);
  const [quantidadeAnimais, setQuantidadeAnimais] = useState("");
  const [pesoMedioAtual, setPesoMedioAtual] = useState("");
  const [categoriaAnimal, setCategoriaAnimal] = useState("");
  const [tipoPasto, setTipoPasto] = useState("Médio");
  const [salMineral, setSalMineral] = useState(true);
  const [dataAplicacao, setDataAplicacao] = useState("");
  const [gmdEsperado, setGmdEsperado] = useState("");
  const [precoArroba, setPrecoArroba] = useState("");
  const [observacoes, setObservacoes] = useState("");

  // Fetch lotes
  const { data: lotes = [], isLoading } = useQuery({
    queryKey: ['lotes-animais-cotacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LoteAnimaisCotacao.list('-data_registro');
      return all.filter(l => l.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (data) => await base44.entities.LoteAnimaisCotacao.create(data),
    onSuccess: () => {
      toast.success("Lote registrado!");
      queryClient.invalidateQueries({ queryKey: ['lotes-animais-cotacao'] });
      limparFormulario();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => await base44.entities.LoteAnimaisCotacao.update(id, data),
    onSuccess: () => {
      toast.success("Lote atualizado!");
      queryClient.invalidateQueries({ queryKey: ['lotes-animais-cotacao'] });
      limparFormulario();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => await base44.entities.LoteAnimaisCotacao.delete(id),
    onSuccess: () => {
      toast.success("Lote excluído!");
      queryClient.invalidateQueries({ queryKey: ['lotes-animais-cotacao'] });
    },
  });

  const handleSalvar = () => {
    if (!nomeLote.trim() || !quantidadeAnimais || !pesoMedioAtual || !categoriaAnimal || !gmdEsperado) {
      toast.error("Preencha todos os campos obrigatórios!");
      return;
    }

    const data = {
      empresa_id: empresaSelecionadaId,
      nome_lote: nomeLote.trim(),
      data_registro: dataRegistro,
      quantidade_animais: parseInt(quantidadeAnimais),
      peso_medio_atual: parseFloat(pesoMedioAtual),
      categoria_animal: categoriaAnimal,
      tipo_pasto: tipoPasto,
      sal_mineral: salMineral,
      data_aplicacao_medicamentos: dataAplicacao || null,
      gmd_esperado: parseFloat(gmdEsperado),
      preco_arroba_atual: precoArroba ? parseFloat(precoArroba) : null,
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
    setNomeLote("");
    setDataRegistro(new Date().toISOString().split('T')[0]);
    setQuantidadeAnimais("");
    setPesoMedioAtual("");
    setCategoriaAnimal("");
    setTipoPasto("Médio");
    setSalMineral(true);
    setDataAplicacao("");
    setGmdEsperado("");
    setPrecoArroba("");
    setObservacoes("");
    setShowForm(false);
  };

  const handleEditar = (lote) => {
    setEditingId(lote.id);
    setNomeLote(lote.nome_lote);
    setDataRegistro(lote.data_registro);
    setQuantidadeAnimais(String(lote.quantidade_animais));
    setPesoMedioAtual(String(lote.peso_medio_atual));
    setCategoriaAnimal(lote.categoria_animal);
    setTipoPasto(lote.tipo_pasto || "Médio");
    setSalMineral(lote.sal_mineral ?? true);
    setDataAplicacao(lote.data_aplicacao_medicamentos || "");
    setGmdEsperado(String(lote.gmd_esperado));
    setPrecoArroba(lote.preco_arroba_atual ? String(lote.preco_arroba_atual) : "");
    setObservacoes(lote.observacoes || "");
    setShowForm(true);
  };

  // Estatísticas
  const stats = useMemo(() => {
    const totalAnimais = lotes.reduce((s, l) => s + (l.quantidade_animais || 0), 0);
    const pesoMedioGeral = lotes.length > 0 
      ? lotes.reduce((s, l) => s + (l.peso_medio_atual || 0), 0) / lotes.length 
      : 0;
    const gmdMedio = lotes.length > 0 
      ? lotes.reduce((s, l) => s + (l.gmd_esperado || 0), 0) / lotes.length 
      : 0;
    return { totalAnimais, pesoMedioGeral, gmdMedio };
  }, [lotes]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center bg-white rounded px-3 py-2 shadow-sm border-b border-slate-200">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Registro de Lotes de Animais</h1>
          <p className="text-xs text-slate-600">Cadastre lotes para simulação de resultados</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)} className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
          <Plus className="w-3.5 h-3.5 mr-1" />
          Novo Lote
        </Button>
      </div>

      {/* Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-3 flex items-center gap-3">
            <Users className="w-8 h-8 text-blue-600" />
            <div>
              <div className="text-xs text-blue-600">Total de Animais</div>
              <div className="text-2xl font-bold text-blue-800">{formatarNumero(stats.totalAnimais, 0)}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50 border-emerald-200">
          <CardContent className="p-3 flex items-center gap-3">
            <TrendingUp className="w-8 h-8 text-emerald-600" />
            <div>
              <div className="text-xs text-emerald-600">Peso Médio Geral</div>
              <div className="text-2xl font-bold text-emerald-800">{formatarNumero(stats.pesoMedioGeral, 2)} kg</div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-3 flex items-center gap-3">
            <TrendingUp className="w-8 h-8 text-amber-600" />
            <div>
              <div className="text-xs text-amber-600">GMD Médio Esperado</div>
              <div className="text-2xl font-bold text-amber-800">{formatarNumero(stats.gmdMedio, 3)} kg/dia</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-white">
                  <TableHead className="text-xs font-bold py-1 border border-black">Data</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Lote</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Categoria</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd Animais</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Peso Médio</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Pasto</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-center">Sal</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">GMD</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Preço @</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black w-20">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-4 text-xs">Carregando...</TableCell></TableRow>
                ) : lotes.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-8 text-xs text-slate-400">Nenhum lote registrado</TableCell></TableRow>
                ) : (
                  lotes.map(l => (
                    <TableRow key={l.id} className="hover:bg-gray-50">
                      <TableCell className="text-xs py-1 border border-gray-300">{formatarData(l.data_registro)}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 font-semibold">{l.nome_lote}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">
                        <Badge variant="outline" className="text-[10px]">{l.categoria_animal}</Badge>
                      </TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-semibold">{formatarNumero(l.quantidade_animais, 0)}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarNumero(l.peso_medio_atual, 2)} kg</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">
                        <Badge variant="outline" className={`text-[10px] ${
                          l.tipo_pasto === 'Bom' ? 'bg-emerald-50 text-emerald-700' :
                          l.tipo_pasto === 'Fraco' ? 'bg-red-50 text-red-700' :
                          'bg-amber-50 text-amber-700'
                        }`}>{l.tipo_pasto}</Badge>
                      </TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-center">
                        {l.sal_mineral ? '✓' : '-'}
                      </TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold text-emerald-700">{formatarNumero(l.gmd_esperado, 3)} kg/dia</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">
                        {l.preco_arroba_atual ? formatarMoeda(l.preco_arroba_atual) : '-'}
                      </TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleEditar(l)}>
                            <Edit2 className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => {
                            if (confirm(`Excluir o lote "${l.nome_lote}"?`)) deleteMutation.mutate(l.id);
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

      {/* Formulário Inline */}
      {showForm && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-sm text-emerald-800">{editingId ? 'Editar Lote' : 'Novo Lote de Animais'}</CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="space-y-3">
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Nome do Lote <span className="text-red-500">*</span></Label>
                  <Input value={nomeLote} onChange={(e) => setNomeLote(e.target.value)} className="h-8 text-xs" placeholder="Ex: Lote A" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Data Registro <span className="text-red-500">*</span></Label>
                  <Input type="date" value={dataRegistro} onChange={(e) => setDataRegistro(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Qtd. Animais <span className="text-red-500">*</span></Label>
                  <Input type="number" value={quantidadeAnimais} onChange={(e) => setQuantidadeAnimais(e.target.value)} className="h-8 text-xs" placeholder="Ex: 100" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Peso Médio Atual (kg) <span className="text-red-500">*</span></Label>
                  <Input type="number" value={pesoMedioAtual} onChange={(e) => setPesoMedioAtual(e.target.value)} className="h-8 text-xs" placeholder="Ex: 280" />
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Categoria <span className="text-red-500">*</span></Label>
                  <Select value={categoriaAnimal} onValueChange={setCategoriaAnimal}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Bezerro">Bezerro</SelectItem>
                      <SelectItem value="Recria">Recria</SelectItem>
                      <SelectItem value="Engorda">Engorda</SelectItem>
                      <SelectItem value="Boi Gordo">Boi Gordo</SelectItem>
                      <SelectItem value="Reprodutor">Reprodutor</SelectItem>
                      <SelectItem value="Outros">Outros</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tipo de Pasto</Label>
                  <Select value={tipoPasto} onValueChange={setTipoPasto}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Bom">Bom</SelectItem>
                      <SelectItem value="Médio">Médio</SelectItem>
                      <SelectItem value="Fraco">Fraco</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Data Aplicação Medicamentos</Label>
                  <Input type="date" value={dataAplicacao} onChange={(e) => setDataAplicacao(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-2">
                    <Checkbox checked={salMineral} onCheckedChange={setSalMineral} />
                    Usa Sal Mineral
                  </Label>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">GMD Esperado (kg/dia) <span className="text-red-500">*</span></Label>
                  <Input type="number" step="0.001" value={gmdEsperado} onChange={(e) => setGmdEsperado(e.target.value)} className="h-8 text-xs" placeholder="Ex: 0.800" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Preço da Arroba Atual (R$)</Label>
                  <Input type="number" value={precoArroba} onChange={(e) => setPrecoArroba(e.target.value)} className="h-8 text-xs" placeholder="Ex: 280.00" />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Observações</Label>
                <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} className="h-16 text-xs" placeholder="Observações..." />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={limparFormulario} size="sm" className="h-8 text-xs">
                  Cancelar
                </Button>
                <Button onClick={handleSalvar} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  {editingId ? 'Atualizar' : 'Salvar'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}