import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, Building2 } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import FormularioEmpresa from "../components/empresa/FormularioEmpresa";
import TabelaEmpresas from "../components/empresa/TabelaEmpresas";

export default function Empresa() {
  const [showForm, setShowForm] = useState(false);
  const [editingEmpresa, setEditingEmpresa] = useState(null);

  const queryClient = useQueryClient();

  const { data: empresas, isLoading } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => base44.entities.Empresa.list('-created_date'),
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      // Validar se já existe empresa com mesmo nome
      const existente = empresas.find(e => 
        e.nome.toUpperCase().trim() === data.nome.toUpperCase().trim() && 
        (!editingEmpresa || e.id !== editingEmpresa.id)
      );
      
      if (existente) {
        throw new Error('Já existe uma empresa cadastrada com este nome.');
      }
      
      return base44.entities.Empresa.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['empresas'] });
      setShowForm(false);
      setEditingEmpresa(null);
      toast.success('Empresa cadastrada com sucesso!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao salvar empresa. Tente novamente.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      // Validar se já existe empresa com mesmo nome
      const existente = empresas.find(e => 
        e.nome.toUpperCase().trim() === data.nome.toUpperCase().trim() && 
        e.id !== id
      );
      
      if (existente) {
        throw new Error('Já existe uma empresa cadastrada com este nome.');
      }
      
      return base44.entities.Empresa.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['empresas'] });
      setShowForm(false);
      setEditingEmpresa(null);
      toast.success('Empresa atualizada com sucesso!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao atualizar empresa. Tente novamente.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Empresa.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['empresas'] });
      toast.success('Empresa excluída com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao excluir empresa. Tente novamente.');
    }
  });

  const handleSubmit = async (data) => {
    if (editingEmpresa) {
      updateMutation.mutate({ id: editingEmpresa.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (empresa) => {
    setEditingEmpresa(empresa);
    setShowForm(true);
  };

  const handleDelete = (id, skipConfirm = false) => {
    if (skipConfirm || window.confirm('⚠️ ATENÇÃO: Deseja realmente excluir esta empresa? Esta ação não pode ser desfeita.')) {
      return deleteMutation.mutateAsync(id);
    }
    return Promise.reject('Cancelado');
  };

  const handleNew = () => {
    setEditingEmpresa(null);
    setShowForm(true);
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setEditingEmpresa(null);
  };

  const totalEmpresas = empresas.length;
  const pessoasFisicas = empresas.filter(e => e.tipo_pessoa === 'Física').length;
  const pessoasJuridicas = empresas.filter(e => e.tipo_pessoa === 'Jurídica').length;

  return (
    <div className="p-6 space-y-6">
      {/* Cards de Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Total de Empresas</CardTitle>
            <Building2 className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-900">{totalEmpresas}</div>
            <p className="text-xs text-green-600 mt-1">Empresas cadastradas</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-blue-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Pessoas Físicas</CardTitle>
            <Building2 className="h-5 w-5 text-blue-600" />
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

      {/* Botão Nova Empresa */}
      {!showForm && (
        <div className="flex justify-end">
          <Button
            onClick={handleNew}
            className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg"
            size="lg"
          >
            <Plus className="w-5 h-5" />
            Nova Empresa
          </Button>
        </div>
      )}

      {/* Formulário */}
      <AnimatePresence>
        {showForm && (
          <FormularioEmpresa
            onSubmit={handleSubmit}
            onCancel={handleCancelForm}
            initialData={editingEmpresa}
            isEditing={!!editingEmpresa}
          />
        )}
      </AnimatePresence>

      {/* Tabela */}
      <TabelaEmpresas
        empresas={empresas}
        onEdit={handleEdit}
        onDelete={handleDelete}
        isLoading={isLoading}
      />
    </div>
  );
}