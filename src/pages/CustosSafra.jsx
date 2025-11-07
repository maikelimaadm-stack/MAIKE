
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, TrendingUp, DollarSign, Package, Users, Calendar, CheckCircle, Clock, Layers, Truck, Download, Upload, FileSpreadsheet, Loader2, AlertCircle, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import TabelaCustos from "../components/custos/TabelaCustos";
import FormularioCusto from "../components/custos/FormularioCusto";
import LancarEntrega from "../components/custos/LancarEntrega";

const getNextSystemNumber = async () => {
  try {
    const [pesagens, fornecedores, produtos, custos] = await Promise.all([
      base44.entities.Pesagem.list(),
      base44.entities.Fornecedor.list(),
      base44.entities.Produto.list(),
      base44.entities.CustoSafra.list()
    ]);

    const numeros = [
      ...pesagens.map(p => parseInt(p.numero_registro) || 0),
      ...fornecedores.map(f => parseInt(f.numero_cadastro) || 0),
      ...produtos.map(p => parseInt(p.numero_produto) || 0),
      ...custos.map(c => parseInt(c.numero_lancamento) || 0)
    ].filter(n => n > 0 && n < 1000000000);

    const nextNumber = numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
    return nextNumber;
  } catch (error) {
    console.error('Erro ao obter próximo número:', error);
    return 1;
  }
};

export default function CustosSafra() {
  const [showSafraDialog, setShowSafraDialog] = useState(false);
  const [safraAtiva, setSafraAtiva] = useState(null);
  const [showCustoForm, setShowCustoForm] = useState(false);
  const [editingCusto, setEditingCusto] = useState(null);
  const [custoParaEntrega, setCustoParaEntrega] = useState(null);
  const [showImportProgress, setShowImportProgress] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, errors: 0 });
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [importErrors, setImportErrors] = useState([]);
  const [validRecordsToImport, setValidRecordsToImport] = useState([]);

  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: safras = [] } = useQuery({
    queryKey: ['safras', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Safra.list('-created_date');
      return all.filter(s => s.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  React.useEffect(() => {
    if (!safraAtiva && safras.length > 0) {
      const safraEmAndamento = safras.find(s => s.status === 'Em Andamento') || safras[0];
      setSafraAtiva(safraEmAndamento);
    }
  }, [safras, safraAtiva]);

  const { data: custos = [] } = useQuery({
    queryKey: ['custos_safra', safraAtiva?.id],
    queryFn: async () => {
      if (!safraAtiva) return [];
      const all = await base44.entities.CustoSafra.list('-created_date');
      return all.filter(c => c.safra_id === safraAtiva.id);
    },
    enabled: !!safraAtiva,
  });

  React.useEffect(() => {
    const numerarCustosExistentes = async () => {
      if (!empresaSelecionadaId || !safraAtiva) return;
      const custosSemNumero = custos.filter(c => !c.numero_lancamento || c.numero_lancamento === '');
      
      if (custosSemNumero.length > 0) {
        for (const custo of custosSemNumero) {
          try {
            const proximoNumero = await getNextSystemNumber();
            await base44.entities.CustoSafra.update(custo.id, { numero_lancamento: String(proximoNumero) });
          } catch (error) {
            console.error(`Erro ao numerar custo ${custo.id}:`, error);
          }
        }
        queryClient.invalidateQueries({ queryKey: ['custos_safra'] });
      }
    };

    if (custos && custos.length > 0) {
      numerarCustosExistentes();
    }
  }, [custos, queryClient, empresaSelecionadaId, safraAtiva]);

  const { data: fornecedores = [] } = useQuery({
    queryKey: ['fornecedores', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list();
      return all.filter(f => f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const createCustoMutation = useMutation({
    mutationFn: (data) => base44.entities.CustoSafra.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custos_safra'] });
      setShowCustoForm(false);
      setEditingCusto(null);
      toast.success('Custo lançado com sucesso!');
    },
  });

  const updateCustoMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.CustoSafra.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custos_safra'] });
      setShowCustoForm(false);
      setEditingCusto(null);
      toast.success('Custo atualizado com sucesso!');
    },
  });

  const deleteCustoMutation = useMutation({
    mutationFn: (id) => base44.entities.CustoSafra.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custos_safra'] });
      toast.success('Custo excluído com sucesso!');
    },
  });

  const handleCustoSubmit = async (formData) => {
    const fornecedor = fornecedores.find(f => f.id === formData.fornecedor_id);
    const produto = produtos.find(p => p.id === formData.produto_id);
    const quantidade = parseFloat(formData.quantidade);
    const valorUnitario = parseFloat(formData.valor_unitario);

    const data = {
      empresa_id: empresaSelecionadaId,
      safra_id: safraAtiva.id,
      fornecedor_id: formData.fornecedor_id,
      fornecedor_nome: fornecedor?.nome,
      produto_id: formData.produto_id,
      produto_nome: produto?.nome_produto,
      quantidade: quantidade,
      unidade_medida: produto?.unidade_medida,
      valor_unitario: valorUnitario,
      valor_total: quantidade * valorUnitario,
      prazo_entrega: formData.prazo_entrega || undefined,
      data_entrega: formData.data_entrega || undefined,
      status_entrega: formData.status_entrega,
      forma_pagamento: formData.forma_pagamento,
      observacoes: formData.observacoes,
      quantidade_entregue: 0,
    };

    if (!editingCusto) {
      const proximoNumero = await getNextSystemNumber();
      data.numero_lancamento = String(proximoNumero);
    }

    if (editingCusto) {
      updateCustoMutation.mutate({ id: editingCusto.id, data });
    } else {
      createCustoMutation.mutate(data);
    }
  };

  const handleDeleteCusto = async (id, skipConfirm = false) => {
    if (skipConfirm || window.confirm('Deseja excluir este lançamento?')) {
      deleteCustoMutation.mutate(id);
    }
  };

  const handlePrintCusto = (custo) => {
    console.log('Imprimir custo:', custo);
  };

  const handleLancarEntrega = (custo) => {
    setCustoParaEntrega(custo);
  };

  const handleExport = () => {
    if (!safraAtiva) {
      toast.error('Selecione uma safra primeiro!');
      return;
    }

    const csvRows = [];
    const headers = ['Fornecedor', 'Produto', 'Quantidade', 'Valor Unitário', 'Valor Total', 'Prazo Entrega', 'Data Entrega', 'Status', 'Forma Pagamento', 'Observações'];
    csvRows.push(headers.join(';'));

    custos.forEach(c => {
      const row = [
        c.fornecedor_nome || '',
        c.produto_nome || '',
        c.quantidade || 0,
        c.valor_unitario || 0,
        c.valor_total || 0,
        c.prazo_entrega || '',
        c.data_entrega || '',
        c.status_entrega || 'Pendente',
        c.forma_pagamento || '',
        c.observacoes || ''
      ];
      csvRows.push(row.map(item => typeof item === 'string' && item.includes(';') ? `"${item}"` : item).join(';'));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `custos_safra_${safraAtiva.ano_inicio}-${safraAtiva.ano_fim}_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.csv`;
    link.click();
    toast.success('Dados exportados com sucesso!');
  };

  const downloadTemplate = () => {
    const csvRows = [];
    const headers = ['Fornecedor', 'Produto', 'Quantidade', 'Valor Unitário', 'Prazo Entrega', 'Status', 'Forma Pagamento', 'Observações'];
    csvRows.push(headers.join(';'));
    
    const example = ['FORNECEDOR EXEMPLO', 'PRODUTO EXEMPLO', '100', '50.00', '2025-12-31', 'Pendente', 'À VISTA', 'OBSERVAÇÕES EXEMPLO'];
    csvRows.push(example.join(';'));

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'modelo_custos_safra.csv';
    link.click();
  };

  const downloadErrosImportacao = () => {
    const csvRows = [];
    const headers = ['Linha', 'Erro', 'Fornecedor', 'Produto', 'Quantidade', 'Valor Unitário', 'Prazo Entrega', 'Status', 'Forma Pagamento', 'Observações'];
    csvRows.push(headers.join(';'));

    importErrors.forEach(erro => {
      const row = [erro.linha, erro.erro, ...erro.dados.split(';')];
      csvRows.push(row.join(';'));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `erros_importacao_custos_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.csv`;
    link.click();
  };

  const executarImportacao = async (validRecords) => {
    setShowImportProgress(true);
    setImportProgress({ current: 0, total: validRecords.length, errors: 0 });

    let imported = 0;
    let actualErrors = 0;

    for (const record of validRecords) {
      try {
        await base44.entities.CustoSafra.create(record);
        imported++;
        setImportProgress(prev => ({ ...prev, current: prev.current + 1 }));
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        actualErrors++;
        setImportProgress(prev => ({ ...prev, errors: prev.errors + 1 }));
      }
    }

    await queryClient.invalidateQueries({ queryKey: ['custos_safra'] });
    
    setImportProgress({ current: validRecords.length, total: validRecords.length, errors: actualErrors });

    setTimeout(() => {
      setShowImportProgress(false);
      toast.success(actualErrors > 0 ? `${imported} importados! ${actualErrors} com erro.` : `${imported} importados com sucesso!`);
    }, 1000);
  };

  const handleImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!safraAtiva) {
      toast.error('Selecione uma safra primeiro!');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        const lines = text.split('\n').filter(line => line.trim());
        
        if (lines.length <= 1) {
          toast.error('O arquivo está vazio!');
          return;
        }

        let proximoNumero = await getNextSystemNumber();
        const validRecords = [];
        const errors = [];

        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(';');
          
          if (values.length < 4) {
            errors.push({ linha: i + 1, erro: 'Número insuficiente de colunas', dados: lines[i] });
            continue;
          }

          try {
            const fornecedorNome = values[0]?.trim()?.toUpperCase();
            const produtoNome = values[1]?.trim()?.toUpperCase();
            const quantidade = parseFloat(values[2]?.replace(',', '.'));
            const valorUnitario = parseFloat(values[3]?.replace(',', '.'));

            if (!fornecedorNome || !produtoNome || isNaN(quantidade) || isNaN(valorUnitario)) {
              throw new Error("Fornecedor, Produto, Quantidade e Valor são obrigatórios");
            }

            const fornecedor = fornecedores.find(f => f.nome?.toUpperCase() === fornecedorNome);
            const produto = produtos.find(p => p.nome_produto?.toUpperCase() === produtoNome);

            if (!fornecedor) throw new Error(`Fornecedor "${fornecedorNome}" não encontrado`);
            if (!produto) throw new Error(`Produto "${produtoNome}" não encontrado`);

            validRecords.push({
              empresa_id: empresaSelecionadaId,
              safra_id: safraAtiva.id,
              numero_lancamento: String(proximoNumero),
              fornecedor_id: fornecedor.id,
              fornecedor_nome: fornecedor.nome,
              produto_id: produto.id,
              produto_nome: produto.nome_produto,
              quantidade,
              unidade_medida: produto.unidade_medida,
              valor_unitario: valorUnitario,
              valor_total: quantidade * valorUnitario,
              prazo_entrega: values[4]?.trim() || undefined,
              status_entrega: values[5]?.trim() || 'Pendente',
              forma_pagamento: values[6]?.trim()?.toUpperCase() || undefined,
              observacoes: values[7]?.trim()?.toUpperCase() || undefined,
              quantidade_entregue: 0
            });
            proximoNumero++;
          } catch (err) {
            errors.push({ linha: i + 1, erro: err.message || 'Erro desconhecido', dados: lines[i] });
          }
        }

        if (errors.length > 0) {
          setImportErrors(errors);
          setValidRecordsToImport(validRecords);
          setShowErrorDialog(true);
          return;
        }

        if (validRecords.length === 0) {
          toast.error('Nenhum registro válido encontrado!');
          return;
        }

        await executarImportacao(validRecords);
      } catch (error) {
        toast.error('Erro ao importar. Verifique o arquivo.');
      }
    };
    reader.readAsText(file, 'UTF-8');
    event.target.value = '';
  };

  const formatarNumero = (numero) => {
    if (!numero && numero !== 0) return "0,00";
    return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  };

  const custosPorFornecedor = custos.reduce((acc, custo) => {
    if (!acc[custo.fornecedor_id]) {
      acc[custo.fornecedor_id] = { fornecedor_id: custo.fornecedor_id, fornecedor_nome: custo.fornecedor_nome, custos: [], total: 0 };
    }
    acc[custo.fornecedor_id].custos.push(custo);
    acc[custo.fornecedor_id].total += custo.valor_total || 0;
    return acc;
  }, {});

  const totalGeralSafra = Object.values(custosPorFornecedor).reduce((sum, f) => sum + f.total, 0);
  const progressPercentage = importProgress.total > 0 ? Math.round((importProgress.current / importProgress.total) * 100) : 0;

  if (!safraAtiva && safras.length === 0) {
    return (
      <div className="p-6">
        <Card className="shadow-xl border-slate-200">
          <CardContent className="p-12 text-center">
            <Layers className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-700 mb-2">Nenhuma Safra Cadastrada</h2>
            <p className="text-slate-500 mb-6">Você precisa cadastrar uma safra antes de lançar custos.</p>
            <Button onClick={() => setShowSafraDialog(true)} className="bg-green-600 hover:bg-green-700">
              <Plus className="w-4 h-4 mr-2" />
              Cadastrar Safra
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50 md:col-span-1">
          <CardHeader className="pb-3">
            <h3 className="text-sm font-medium text-green-700 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Safra Ativa
            </h3>
          </CardHeader>
          <CardContent>
            <Select value={safraAtiva?.id || ''} onValueChange={(value) => {
              setSafraAtiva(safras.find(s => s.id === value));
              setShowCustoForm(false);
              setEditingCusto(null);
            }}>
              <SelectTrigger className="border-green-300 focus:border-green-500">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {safras.map((safra) => (
                  <SelectItem key={safra.id} value={safra.id}>{safra.ano_inicio}/{safra.ano_fim}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => setShowSafraDialog(true)} className="w-full mt-2 text-xs">
              <Plus className="w-3 h-3 mr-1" />
              Nova Safra
            </Button>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Total da Safra</CardTitle>
            <DollarSign className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-900">R$ {formatarNumero(totalGeralSafra)}</div>
            <p className="text-xs text-green-600 mt-1">Valor total investido</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-blue-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Fornecedores</CardTitle>
            <Users className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-900">{Object.keys(custosPorFornecedor).length}</div>
            <p className="text-xs text-blue-600 mt-1">Fornecedores ativos</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-purple-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Lançamentos</CardTitle>
            <Package className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-900">{custos.length}</div>
            <p className="text-xs text-purple-600 mt-1">Custos registrados</p>
          </CardContent>
        </Card>
      </div>

      {!showCustoForm && safraAtiva && (
        <div className="flex justify-between items-center">
          <div className="flex gap-3">
            <Button onClick={handleExport} variant="outline" className="gap-2">
              <Download className="w-4 h-4" />
              Exportar CSV
            </Button>
            <div>
              <input type="file" accept=".csv" onChange={handleImport} className="hidden" id="import-custos" />
              <Button onClick={() => document.getElementById('import-custos').click()} variant="outline" className="gap-2" disabled={showImportProgress}>
                <Upload className="w-4 h-4" />
                Importar CSV
              </Button>
            </div>
            <Button onClick={downloadTemplate} variant="outline" className="gap-2">
              <FileSpreadsheet className="w-4 h-4" />
              Baixar Modelo
            </Button>
          </div>
          <Button onClick={() => { setEditingCusto(null); setShowCustoForm(true); }} className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg" size="lg">
            <Plus className="w-5 h-5" />
            Novo Lançamento
          </Button>
        </div>
      )}

      <AnimatePresence>
        {showCustoForm && safraAtiva && (
          <FormularioCusto
            onSubmit={handleCustoSubmit}
            onCancel={() => { setShowCustoForm(false); setEditingCusto(null); }}
            initialData={editingCusto}
            isEditing={!!editingCusto}
            fornecedores={fornecedores}
            produtos={produtos}
          />
        )}
      </AnimatePresence>

      {safraAtiva && (
        <TabelaCustos
          custos={custos}
          fornecedores={fornecedores}
          onEdit={(custo) => { setEditingCusto(custo); setShowCustoForm(true); }}
          onDelete={handleDeleteCusto}
          onPrint={handlePrintCusto}
          onLancarEntrega={handleLancarEntrega}
          isLoading={false}
        />
      )}

      <LancarEntrega custo={custoParaEntrega} open={!!custoParaEntrega} onClose={() => setCustoParaEntrega(null)} onSuccess={() => { queryClient.invalidateQueries({ queryKey: ['custos_safra'] }); setCustoParaEntrega(null); }} />

      <Dialog open={showSafraDialog} onOpenChange={setShowSafraDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-green-600" />
              Gerenciar Safras
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {safras.map((safra) => (
              <Card key={safra.id} className="border-slate-200">
                <CardContent className="p-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-bold text-slate-900">{safra.ano_inicio}/{safra.ano_fim}</p>
                      <p className="text-sm text-slate-600">{safra.descricao}</p>
                    </div>
                    <Button size="sm" variant={safraAtiva?.id === safra.id ? "default" : "outline"} onClick={() => { setSafraAtiva(safra); setShowSafraDialog(false); }}>
                      {safraAtiva?.id === safra.id ? 'Ativa' : 'Selecionar'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-700">
              <AlertCircle className="w-6 h-6" />
              Erros Encontrados na Importação
            </DialogTitle>
            <DialogDescription>
              {importErrors.length} erro(s) encontrado(s). {validRecordsToImport.length > 0 && `${validRecordsToImport.length} registro(s) válido(s).`}
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-auto border rounded-lg">
            <Table>
              <TableHeader className="sticky top-0 bg-white z-10">
                <TableRow>
                  <TableHead className="w-20">Linha</TableHead>
                  <TableHead>Erro</TableHead>
                  <TableHead>Dados</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {importErrors.map((erro, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-bold text-orange-700">{erro.linha}</TableCell>
                    <TableCell className="text-red-600">{erro.erro}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">{erro.dados}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 pt-4 border-t">
            <div className="flex justify-between items-center gap-3">
              <Button variant="outline" onClick={downloadErrosImportacao} className="gap-2 border-orange-300 text-orange-700">
                <Download className="w-4 h-4" />
                Baixar Erros
              </Button>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => { setShowErrorDialog(false); setImportErrors([]); setValidRecordsToImport([]); }} className="gap-2">
                  <X className="w-4 h-4" />
                  Cancelar
                </Button>
                {validRecordsToImport.length > 0 && (
                  <Button onClick={() => { setShowErrorDialog(false); executarImportacao(validRecordsToImport); }} className="bg-orange-600 hover:bg-orange-700 gap-2">
                    <Upload className="w-4 h-4" />
                    Importar {validRecordsToImport.length}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showImportProgress} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-green-600" />
              Importando Custos
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progresso</span>
                <span className="font-semibold">{importProgress.current} de {importProgress.total}</span>
              </div>
              <Progress value={progressPercentage} className="h-3" />
              <p className="text-center text-sm font-medium text-green-600">{progressPercentage}%</p>
            </div>
            {importProgress.errors > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                <p className="text-sm text-orange-800">⚠️ {importProgress.errors} com erro</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
