import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import FormularioEmpresa from "../components/empresa/FormularioEmpresa";
import TabelaEmpresas from "../components/empresa/TabelaEmpresas";
import * as empresaService from "@/services/empresaService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";

export default function Empresa() {
  const [showForm, setShowForm] = useState(false);
  const [editingEmpresa, setEditingEmpresa] = useState(null);

  const queryClient = useQueryClient();

  const { data: empresas, isLoading } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => empresaService.listEmpresas(),
    initialData: [],
  });

  const createMutation = useMutation({
    // A validação de nome duplicado vive no service (D-PROD-18).
    mutationFn: (data) => empresaService.createEmpresa(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['empresas'] });
      setShowForm(false);
      setEditingEmpresa(null);
      toast.success('Empresa cadastrada!');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Erro.'));
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => empresaService.updateEmpresa(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['empresas'] });
      setShowForm(false);
      setEditingEmpresa(null);
      toast.success('Empresa atualizada!');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Erro.'));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => empresaService.deleteEmpresa(id),
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

  const handleDelete = (id) => {
    return deleteMutation.mutateAsync(id);
  };

  return (
    <div className="p-4 md:p-6 space-y-2">
      {!showForm && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Empresas</h1>
              <p className="text-xs text-slate-600">Gerenciar empresas</p>
            </div>
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