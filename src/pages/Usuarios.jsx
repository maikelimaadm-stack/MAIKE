import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, Users } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import FormularioUsuario from "../components/usuarios/FormularioUsuario";
import TabelaUsuarios from "../components/usuarios/TabelaUsuarios";

export default function Usuarios() {
  const [showForm, setShowForm] = useState(false);
  const [editingUsuario, setEditingUsuario] = useState(null);

  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: usuarios, isLoading } = useQuery({
    queryKey: ['usuarios'],
    queryFn: async () => {
      try {
        return await base44.entities.User.list('-created_date');
      } catch (error) {
        return [];
      }
    },
    initialData: [],
  });

  const { data: permissoes = [] } = useQuery({
    queryKey: ['permissoes'],
    queryFn: () => base44.entities.Permissao.list(),
    initialData: [],
  });

  const updatePermissaoMutation = useMutation({
    mutationFn: async ({ user_email, modulos, is_admin }) => {
      const existente = permissoes.find(p => p.user_email === user_email);
      
      if (existente) {
        return base44.entities.Permissao.update(existente.id, {
          modulos_permitidos: modulos,
          is_admin: is_admin
        });
      } else {
        return base44.entities.Permissao.create({
          user_email: user_email,
          modulos_permitidos: modulos,
          is_admin: is_admin
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissoes'] });
      setShowForm(false);
      setEditingUsuario(null);
      toast.success('Permissões atualizadas!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao salvar permissões.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      // Não pode excluir usuários pela entidade User (gerenciado pelo Base44)
      // Apenas remove as permissões
      const permissao = permissoes.find(p => p.user_email === id);
      if (permissao) {
        await base44.entities.Permissao.delete(permissao.id);
      }
      toast.info('Permissões removidas. Usuário ainda existe no sistema.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissoes'] });
    },
    onError: () => {
      toast.error('Erro ao remover permissões.');
    }
  });

  const handleSubmit = async (data) => {
    try {
      await updatePermissaoMutation.mutateAsync({
        user_email: data.user_email,
        modulos: data.modulos_permitidos,
        is_admin: data.is_admin
      });
    } catch (error) {
      console.error('Erro:', error);
    }
  };

  const handleEdit = (usuario) => {
    const permissao = permissoes.find(p => p.user_email === usuario.email);
    setEditingUsuario({
      ...usuario,
      modulos_permitidos: permissao?.modulos_permitidos || [],
      is_admin: permissao?.is_admin || false
    });
    setShowForm(true);
  };

  const handleDelete = async (userEmail) => {
    if (currentUser?.email === userEmail) {
      toast.error('Você não pode remover suas próprias permissões!');
      return;
    }
    if (window.confirm('⚠️ Remover permissões deste usuário?')) {
      await deleteMutation.mutateAsync(userEmail);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-2">
      {!showForm && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Usuários e Permissões</h1>
              <p className="text-xs text-slate-600">Gerenciar acessos ao sistema</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => { setEditingUsuario(null); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-slate-700 hover:bg-slate-800">
                <Plus className="w-3.5 h-3.5" />
                Configurar Permissões
              </Button>
            </div>
          </div>
        </>
      )}

      <AnimatePresence>
        {showForm && (
          <FormularioUsuario
            onSubmit={handleSubmit}
            onCancel={() => { setShowForm(false); setEditingUsuario(null); }}
            initialData={editingUsuario}
            usuarios={usuarios}
          />
        )}
      </AnimatePresence>

      {!showForm && (
        <TabelaUsuarios
          usuarios={usuarios}
          permissoes={permissoes}
          currentUser={currentUser}
          onEdit={handleEdit}
          onDelete={handleDelete}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}