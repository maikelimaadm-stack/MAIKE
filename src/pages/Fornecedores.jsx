
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, Users, Building2, UserCircle, FileText, Package } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from 'date-fns'; // Added for date formatting in filenames

import FormularioFornecedor from "../components/fornecedores/FormularioFornecedor";
import TabelaFornecedores from "../components/fornecedores/TabelaFornecedores";
import FichaFornecedor from "../components/fornecedores/FichaFornecedor";

export default function Fornecedores() {
  const [showForm, setShowForm] = useState(false);
  const [editingFornecedor, setEditingFornecedor] = useState(null);
  const [fichaFornecedor, setFichaFornecedor] = useState(null);

  const queryClient = useQueryClient();

  const { data: fornecedores, isLoading } = useQuery({
    queryKey: ['fornecedores'],
    queryFn: () => base44.entities.Fornecedor.list('-created_date'),
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Fornecedor.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fornecedores'] });
      setShowForm(false);
      setEditingFornecedor(null);
      toast.success('Fornecedor cadastrado com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao salvar fornecedor. Tente novamente.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Fornecedor.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fornecedores'] });
      setShowForm(false);
      setEditingFornecedor(null);
      toast.success('Fornecedor atualizado com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao atualizar fornecedor. Tente novamente.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Fornecedor.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fornecedores'] });
      toast.success('Fornecedor excluído com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao excluir fornecedor. Tente novamente.');
    }
  });

  const handleSubmit = (data) => {
    if (editingFornecedor) {
      updateMutation.mutate({ id: editingFornecedor.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (fornecedor) => {
    setEditingFornecedor(fornecedor);
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('Tem certeza que deseja excluir este fornecedor/cliente?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleDuplicate = (fornecedor) => {
    const { id, created_date, updated_date, created_by, ...dadosSemId } = fornecedor;
    setEditingFornecedor(dadosSemId);
    setShowForm(true);
    toast.info('Registro duplicado. Edite e salve.');
  };

  const handlePrint = (fornecedor) => {
    setFichaFornecedor(fornecedor);
  };

  const handleNew = () => {
    setEditingFornecedor(null);
    setShowForm(true);
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setEditingFornecedor(null);
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(fornecedores, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fornecedores_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.json`;
    link.click();
    toast.success('Dados exportados com sucesso!');
  };

  const handleImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        for (const fornecedor of data) {
          const { id, created_date, updated_date, created_by, ...dadosLimpos } = fornecedor;
          // Ensure that base44.entities.Fornecedor.create can handle data without 'id', 'created_date', etc.
          // And that it doesn't try to create existing records. For simplicity, this example creates all.
          await base44.entities.Fornecedor.create(dadosLimpos);
        }
        queryClient.invalidateQueries({ queryKey: ['fornecedores'] });
        toast.success(`${data.length} fornecedores importados com sucesso!`);
      } catch (error) {
        console.error("Error importing data:", error);
        toast.error('Erro ao importar dados. Verifique o arquivo e o formato JSON.');
      }
    };
    reader.readAsText(file);
  };

  const downloadTemplate = () => {
    const template = [{
      tipo_pessoa: "Física",
      nome: "Exemplo Fornecedor",
      cpf: "000.000.000-00",
      cnpj: "", // Added for completeness, though template example is Physical Person
      telefone: "(00) 00000-0000",
      email: "exemplo@email.com",
      endereco: "Rua Exemplo, 123",
      cidade: "Vila Bela",
      estado: "MT",
      cep: "00000-000",
      observacoes: "Este é um fornecedor de exemplo."
    }];
    const dataStr = JSON.stringify(template, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'modelo_fornecedores.json';
    link.click();
  };

  const totalFornecedores = fornecedores.length;
  const pessoasFisicas = fornecedores.filter(f => f.tipo_pessoa === 'Física').length;
  const pessoasJuridicas = fornecedores.filter(f => f.tipo_pessoa === 'Jurídica').length;

  return (
    <div className="p-6 space-y-6">
      {/* Cards de Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Total de Cadastros</CardTitle>
            <Users className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-900">{totalFornecedores}</div>
            <p className="text-xs text-green-600 mt-1">Fornecedores e clientes</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-blue-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Pessoas Físicas</CardTitle>
            <UserCircle className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-900">{pessoasFisicas}</div>
            <p className="text-xs text-blue-600 mt-1">CPF cadastrados</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-purple-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Pessoas Jurídicas</CardTitle>
            <Building2 className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-900">{pessoasJuridicas}</div>
            <p className="text-xs text-purple-600 mt-1">CNPJ cadastrados</p>
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
              Exportar
            </Button>
            <div>
              <input
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
                id="import-fornecedores"
              />
              <Button
                onClick={() => document.getElementById('import-fornecedores').click()}
                variant="outline"
                className="gap-2"
              >
                <Package className="w-4 h-4" />
                Importar
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
            Novo Fornecedor/Cliente
          </Button>
        </div>
      )}

      {/* Formulário */}
      <AnimatePresence>
        {showForm && (
          <FormularioFornecedor
            onSubmit={handleSubmit}
            onCancel={handleCancelForm}
            initialData={editingFornecedor}
            isEditing={!!editingFornecedor}
          />
        )}
      </AnimatePresence>

      {/* Tabela */}
      <TabelaFornecedores
        fornecedores={fornecedores}
        onEdit={handleEdit}
        onDelete={handleDelete}
        // Removed onDuplicate as per outline
        onPrint={handlePrint}
        isLoading={isLoading}
      />

      {/* Modal de Ficha */}
      <FichaFornecedor
        fornecedor={fichaFornecedor}
        open={!!fichaFornecedor}
        onClose={() => setFichaFornecedor(null)}
      />
    </div>
  );
}
