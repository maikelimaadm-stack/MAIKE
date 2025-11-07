
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, Package, TrendingDown, AlertTriangle, Download, Upload, FileSpreadsheet, Loader2 } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

import FormularioProduto from "../components/produtos/FormularioProduto";
import TabelaProdutos from "../components/produtos/TabelaProdutos";
import FichaProduto from "../components/produtos/FichaProduto";

export default function Produtos() {
  const [showForm, setShowForm] = useState(false);
  const [editingProduto, setEditingProduto] = useState(null);
  const [fichaProduto, setFichaProduto] = useState(null);
  const [showImportProgress, setShowImportProgress] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, errors: 0 });

  const queryClient = useQueryClient();

  const { data: produtos, isLoading } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list('-created_date'),
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Produto.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['produtos'] });
      setShowForm(false);
      setEditingProduto(null);
      toast.success('Produto cadastrado com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao salvar produto. Tente novamente.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Produto.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['produtos'] });
      setShowForm(false);
      setEditingProduto(null);
      toast.success('Produto atualizado com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao atualizar produto. Tente novamente.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Produto.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['produtos'] });
      toast.success('Produto excluído com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao excluir produto. Tente novamente.');
    }
  });

  const handleSubmit = (data) => {
    // Gerar número único se for novo produto
    if (!editingProduto) {
      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      data.numero_produto = `PRO-${timestamp}-${random}`;
    }
    
    if (editingProduto) {
      updateMutation.mutate({ id: editingProduto.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (produto) => {
    setEditingProduto(produto);
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('Tem certeza que deseja excluir este produto?')) {
      deleteMutation.mutate(id);
    }
  };

  const handlePrint = (produto) => {
    setFichaProduto(produto);
  };

  const handleNew = () => {
    setEditingProduto(null);
    setShowForm(true);
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setEditingProduto(null);
  };

  const handleExport = () => {
    const csvRows = [];
    const headers = ['Nome', 'Código Interno', 'Código Barras', 'Categoria', 'Descrição', 'Unidade', 'Preço Custo', 'Preço Venda', 'Estoque Atual', 'Estoque Mínimo', 'Observações'];
    csvRows.push(headers.join(';'));

    produtos.forEach(p => {
      const row = [
        p.nome_produto,
        p.codigo_interno || '',
        p.codigo_barras || '',
        p.categoria || '',
        p.descricao || '',
        p.unidade_medida,
        p.preco_custo || 0,
        p.preco_venda || 0,
        p.estoque_atual || 0,
        p.estoque_minimo || 0,
        p.observacoes || ''
      ];
      csvRows.push(row.join(';'));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `produtos_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.csv`;
    link.click();
    toast.success('Dados exportados com sucesso!');
  };

  const handleImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        const lines = text.split('\n');
        const validRecords = [];
        let errorCount = 0;

        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const values = lines[i].split(';');
          if (values.length < 1) {
            errorCount++;
            continue;
          }

          try {
            const produto = {
              nome_produto: values[0].trim(),
              codigo_interno: values[1]?.trim() || undefined,
              codigo_barras: values[2]?.trim() || undefined,
              categoria: values[3]?.trim() || undefined,
              descricao: values[4]?.trim() || undefined,
              unidade_medida: values[5]?.trim() || 'UN',
              preco_custo: parseFloat(values[6]) || 0,
              preco_venda: parseFloat(values[7]) || 0,
              estoque_atual: parseFloat(values[8]) || 0,
              estoque_minimo: parseFloat(values[9]) || 0,
              observacoes: values[10]?.trim() || undefined
            };

            if (!produto.nome_produto) {
              throw new Error("Dados inválidos");
            }

            validRecords.push(produto);
          } catch (err) {
            console.error(`Erro na linha ${i + 1}:`, err);
            errorCount++;
          }
        }

        if (validRecords.length === 0) {
          toast.error('Nenhum registro válido encontrado no arquivo!');
          return;
        }

        setShowImportProgress(true);
        setImportProgress({ current: 0, total: validRecords.length, errors: errorCount });

        const batchSize = 10;
        let imported = 0;

        for (let i = 0; i < validRecords.length; i += batchSize) {
          const batch = validRecords.slice(i, i + batchSize);
          
          try {
            await base44.entities.Produto.bulkCreate(batch);
            imported += batch.length;
          } catch (error) {
            console.error('Erro no lote:', error);
            for (const record of batch) {
              try {
                await base44.entities.Produto.create(record);
                imported++;
              } catch (e) {
                errorCount++;
              }
            }
          }
          
          setImportProgress({ current: imported, total: validRecords.length, errors: errorCount });
        }

        await queryClient.invalidateQueries({ queryKey: ['produtos'] });
        
        setTimeout(() => {
          setShowImportProgress(false);
          if (errorCount > 0) {
            toast.success(`${imported} registros importados! ${errorCount} com erro.`);
          } else {
            toast.success(`${imported} registros importados com sucesso!`);
          }
        }, 1000);

      } catch (error) {
        console.error('Erro ao importar:', error);
        setShowImportProgress(false);
        toast.error('Erro ao importar dados. Verifique o arquivo.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const downloadTemplate = () => {
    const csvRows = [];
    const headers = ['Nome', 'Código Interno', 'Código Barras', 'Categoria', 'Descrição', 'Unidade', 'Preço Custo', 'Preço Venda', 'Estoque Atual', 'Estoque Mínimo', 'Observações'];
    csvRows.push(headers.join(';'));
    
    const example = ['Exemplo Produto', '001', '7891234567890', 'Categoria Exemplo', 'Descrição do produto', 'UN', '10.50', '15.00', '100', '10', 'Observações do produto'];
    csvRows.push(example.join(';'));

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'modelo_produtos.csv';
    link.click();
  };

  const totalProdutos = produtos.length;
  const valorTotalEstoque = produtos.reduce((sum, p) => sum + ((p.preco_custo || 0) * (p.estoque_atual || 0)), 0);
  const produtosEstoqueBaixo = produtos.filter(p => (p.estoque_atual || 0) <= (p.estoque_minimo || 0)).length;

  const formatarNumero = (numero) => {
    if (!numero && numero !== 0) return "0,00";
    return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  };

  const progressPercentage = importProgress.total > 0 
    ? Math.round((importProgress.current / importProgress.total) * 100) 
    : 0;

  return (
    <div className="p-6 space-y-6">
      {/* Cards de Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Total de Produtos</CardTitle>
            <Package className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-900">{totalProdutos}</div>
            <p className="text-xs text-green-600 mt-1">Produtos cadastrados</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-blue-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Valor em Estoque</CardTitle>
            <TrendingDown className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-900">R$ {formatarNumero(valorTotalEstoque)}</div>
            <p className="text-xs text-blue-600 mt-1">Valor total (custo)</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-orange-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Estoque Baixo</CardTitle>
            <AlertTriangle className="h-5 w-5 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-900">{produtosEstoqueBaixo}</div>
            <p className="text-xs text-orange-600 mt-1">Produtos abaixo do mínimo</p>
          </CardContent>
        </Card>
      </div>

      {/* Botões */}
      {!showForm && (
        <div className="flex justify-between items-center">
          <div className="flex gap-3">
            <Button
              onClick={handleExport}
              variant="outline"
              className="gap-2"
            >
              <Download className="w-4 h-4" />
              Exportar CSV
            </Button>
            <div>
              <input
                type="file"
                accept=".csv"
                onChange={handleImport}
                className="hidden"
                id="import-produtos"
              />
              <Button
                onClick={() => document.getElementById('import-produtos').click()}
                variant="outline"
                className="gap-2"
                disabled={showImportProgress}
              >
                <Upload className="w-4 h-4" />
                Importar CSV
              </Button>
            </div>
            <Button
              onClick={downloadTemplate}
              variant="outline"
              className="gap-2"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Baixar Modelo
            </Button>
          </div>
          <Button
            onClick={handleNew}
            className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg"
            size="lg"
          >
            <Plus className="w-5 h-5" />
            Novo Produto
          </Button>
        </div>
      )}

      {/* Formulário */}
      <AnimatePresence>
        {showForm && (
          <FormularioProduto
            onSubmit={handleSubmit}
            onCancel={handleCancelForm}
            initialData={editingProduto}
            isEditing={!!editingProduto}
          />
        )}
      </AnimatePresence>

      {/* Tabela */}
      <TabelaProdutos
        produtos={produtos}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onPrint={handlePrint}
        isLoading={isLoading}
      />

      {/* Modal de Ficha */}
      <FichaProduto
        produto={fichaProduto}
        open={!!fichaProduto}
        onClose={() => setFichaProduto(null)}
      />

      {/* Modal de Progresso de Importação */}
      <Dialog open={showImportProgress} onOpenChange={setShowImportProgress}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-green-600" />
              Importando Produtos
            </DialogTitle>
            <DialogDescription>
              Aguarde enquanto importamos os registros...
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Progresso</span>
                <span className="font-semibold text-slate-900">
                  {importProgress.current} de {importProgress.total}
                </span>
              </div>
              <Progress value={progressPercentage} className="h-3" />
              <p className="text-center text-sm font-medium text-green-600">
                {progressPercentage}%
              </p>
            </div>
            
            {importProgress.errors > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                <p className="text-sm text-orange-800">
                  ⚠️ {importProgress.errors} registro(s) com erro
                </p>
              </div>
            )}
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-700">
                💡 Dica: Registros são importados em lotes para maior velocidade
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
