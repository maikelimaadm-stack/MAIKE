
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, Building2, UserCircle } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import FormularioEmpresa from "../components/empresa/FormularioEmpresa";
import TabelaEmpresas from "../components/empresa/TabelaEmpresas";
import CartoesResumo from "../components/shared/CartoesResumo";

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

  const cartoes = [
    { id: 'total', label: 'Total de Empresas', valor: totalEmpresas, sublabel: 'Cadastradas', icon: Building2, cor: 'blue', tipo: 'numero' },
    { id: 'fisica', label: 'Pessoas Físicas', valor: pessoasFisicas, sublabel: 'CPF', icon: UserCircle, cor: 'emerald', tipo: 'numero' },
    { id: 'juridica', label: 'Pessoas Jurídicas', valor: pessoasJuridicas, sublabel: 'CNPJ', icon: Building2, cor: 'violet', tipo: 'numero' },
  ];

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

          <CartoesResumo cartoes={cartoes} />

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
