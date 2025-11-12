import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, Building2, UserCircle } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
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
      toast.success('Empresa cadastrada!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro.');
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
      toast.success('Empresa atualizada!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Empresa.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['empresas'] });
      toast.success('Empresa excluída!');
    },
    onError: () => {
      toast.error('Erro.');
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
    if (skipConfirm || window.confirm('⚠️ Excluir empresa?')) {
      return deleteMutation.mutateAsync(id);
    }
    return Promise.reject('Cancelado');
  };

  const totalEmpresas = empresas.length;
  const pessoasFisicas = empresas.filter(e => e.tipo_pessoa === 'Física').length;
  const pessoasJuridicas = empresas.filter(e => e.tipo_pessoa === 'Jurídica').length;

  return (
    <div className="p-4 md:p-6 space-y-2">
      {!showForm && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Empresas</h1>
              <p className="text-xs text-slate-600">Gerenciar empresas</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 mb-2">
            <Card className="shadow-sm border-l-4 border-l-blue-500">
              <CardContent className="p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-medium text-slate-600 mb-0.5 truncate leading-tight">Total de Empresas</p>
                    <p className="text-lg font-bold text-blue-700 truncate leading-tight">{totalEmpresas}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5 truncate leading-tight">Cadastradas</p>
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-3.5 h-3.5 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="shadow-sm border-l-4 border-l-emerald-500">
              <CardContent className="p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-medium text-slate-600 mb-0.5 truncate leading-tight">Pessoas Físicas</p>
                    <p className="text-lg font-bold text-emerald-700 truncate leading-tight">{pessoasFisicas}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5 truncate leading-tight">CPF</p>
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                    <UserCircle className="w-3.5 h-3.5 text-emerald-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-l-4 border-l-violet-500">
              <CardContent className="p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-medium text-slate-600 mb-0.5 truncate leading-tight">Pessoas Jurídicas</p>
                    <p className="text-lg font-bold text-violet-700 truncate leading-tight">{pessoasJuridicas}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5 truncate leading-tight">CNPJ</p>
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-3.5 h-3.5 text-violet-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => { setEditingEmpresa(null); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-3.5 h-3.5" />
              Nova Empresa
            </Button>
          </div>
        </>
      )}

      <AnimatePresence>
        {showForm && (
          <FormularioEmpresa
            onSubmit={handleSubmit}
            onCancel={() => { setShowForm(false); setEditingEmpresa(null); }}
            initialData={editingEmpresa}
            isEditing={!!editingEmpresa}
          />
        )}
      </AnimatePresence>

      {!showForm && (
        <TabelaEmpresas
          empresas={empresas}
          onEdit={handleEdit}
          onDelete={handleDelete}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}