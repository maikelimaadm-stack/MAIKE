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

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex gap-3">
              <div className="text-blue-600 mt-0.5">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-sm text-blue-900 mb-1">ℹ️ Como convidar novos usuários</h4>
                <ul className="text-xs text-blue-800 space-y-1 list-disc pl-4">
                  <li><strong>Novos usuários</strong> devem ser convidados via <strong>Base44 Dashboard</strong> (não é feito aqui no sistema)</li>
                  <li>Após o usuário aceitar o convite e fazer login, ele aparecerá na lista abaixo</li>
                  <li>Aqui você configura as <strong>permissões</strong> de cada usuário (quais módulos ele pode acessar)</li>
                  <li>Usuários sem permissões configuradas terão acesso total ao sistema</li>
                </ul>
              </div>
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