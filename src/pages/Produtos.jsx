
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, Package, TrendingDown, AlertTriangle, FileText } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import * as XLSX from 'xlsx';

import FormularioProduto from "../components/produtos/FormularioProduto";
import TabelaProdutos from "../components/produtos/TabelaProdutos";
import FichaProduto from "../components/produtos/FichaProduto";

export default function Produtos() {
  const [showForm, setShowForm] = useState(false);
  const [editingProduto, setEditingProduto] = useState(null);
  const [fichaProduto, setFichaProduto] = useState(null);

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

  const handleDuplicate = (produto) => {
    const { id, created_date, updated_date, created_by, ...dadosSemId } = produto;
    setEditingProduto(dadosSemId);
    setShowForm(true);
    toast.info('Registro duplicado. Edite e salve.');
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
    const dadosExcel = produtos.map(p => ({
      'Nome': p.nome_produto,
      'Código Interno': p.codigo_interno || '',
      'Código Barras': p.codigo_barras || '',
      'Categoria': p.categoria || '',
      'Descrição': p.descricao || '',
      'Unidade': p.unidade_medida,
      'Preço Custo': p.preco_custo || 0,
      'Preço Venda': p.preco_venda || 0,
      'Estoque Atual': p.estoque_atual || 0,
      'Estoque Mínimo': p.estoque_minimo || 0,
      'Observações': p.observacoes || ''
    }));

    const ws = XLSX.utils.json_to_sheet(dadosExcel);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Produtos');
    XLSX.writeFile(wb, `produtos_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.xlsx`);
    toast.success('Dados exportados com sucesso!');
  };

  const handleImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        for (const row of jsonData) {
          const produto = {
            nome_produto: row['Nome'],
            codigo_interno: row['Código Interno']?.toString() || undefined, // Ensure string or undefined
            codigo_barras: row['Código Barras']?.toString() || undefined, // Ensure string or undefined
            categoria: row['Categoria'] || undefined,
            descricao: row['Descrição'] || undefined,
            unidade_medida: row['Unidade'] || 'UN',
            preco_custo: parseFloat(row['Preço Custo']) || 0,
            preco_venda: parseFloat(row['Preço Venda']) || 0,
            estoque_atual: parseFloat(row['Estoque Atual']) || 0,
            estoque_minimo: parseFloat(row['Estoque Mínimo']) || 0,
            observacoes: row['Observações'] || undefined
          };
          await base44.entities.Produto.create(produto);
        }
        queryClient.invalidateQueries({ queryKey: ['produtos'] });
        toast.success(`${jsonData.length} produtos importados com sucesso!`);
      } catch (error) {
        console.error("Erro ao importar:", error);
        toast.error('Erro ao importar dados. Verifique o arquivo e o formato.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const downloadTemplate = () => {
    const template = [{
      'Nome': 'Exemplo Produto',
      'Código Interno': '001',
      'Código Barras': '7891234567890',
      'Categoria': 'Categoria Exemplo',
      'Descrição': 'Descrição do produto',
      'Unidade': 'UN',
      'Preço Custo': 10.50,
      'Preço Venda': 15.00,
      'Estoque Atual': 100,
      'Estoque Mínimo': 10,
      'Observações': 'Observações do produto'
    }];

    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Modelo');
    XLSX.writeFile(wb, 'modelo_produtos.xlsx');
  };

  const totalProdutos = produtos.length;
  const valorTotalEstoque = produtos.reduce((sum, p) => sum + ((p.preco_custo || 0) * (p.estoque_atual || 0)), 0);
  const produtosEstoqueBaixo = produtos.filter(p => (p.estoque_atual || 0) <= (p.estoque_minimo || 0)).length;

  const formatarNumero = (numero) => {
    if (!numero && numero !== 0) return "0,00";
    return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  };

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
            <p className="text-xs text-blue-600 mt-1">Valor total (preço de custo)</p>
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
              <FileText className="w-4 h-4" />
              Exportar Excel
            </Button>
            <div>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleImport}
                className="hidden"
                id="import-produtos"
              />
              <Button
                onClick={() => document.getElementById('import-produtos').click()}
                variant="outline"
                className="gap-2"
              >
                <Package className="w-4 h-4" />
                Importar Excel
              </Button>
            </div>
            <Button
              onClick={downloadTemplate}
              variant="outline"
              className="gap-2"
            >
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
        onDuplicate={handleDuplicate}
        onPrint={handlePrint}
        isLoading={isLoading}
      />

      {/* Modal de Ficha */}
      <FichaProduto
        produto={fichaProduto}
        open={!!fichaProduto}
        onClose={() => setFichaProduto(null)}
      />
    </div>
  );
}
