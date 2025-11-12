import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, Plus, UserCog } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import FormularioUsuario from "@/components/usuarios/FormularioUsuario";
import TabelaUsuarios from "@/components/usuarios/TabelaUsuarios";
import CartoesResumo from "@/components/shared/CartoesResumo";

export default function Usuarios() {
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);

  const queryClient = useQueryClient();

  const { data: usuarios = [], isLoading } = useQuery({
    queryKey: ['usuarios'],
    queryFn: () => base44.entities.User.list(),
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      // Verificar se CPF já existe
      const cpfExiste = usuarios.some(u => u.cpf === data.cpf);
      if (cpfExiste) {
        throw new Error('CPF já cadastrado!');
      }

      // Verificar se email já existe
      const emailExiste = usuarios.some(u => u.email === data.email);
      if (emailExiste) {
        throw new Error('E-mail já cadastrado!');
      }

      return base44.entities.User.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      setShowForm(false);
      setEditingUser(null);
      toast.success('✅ Usuário cadastrado com sucesso!');
    },
    onError: (error) => {
      toast.error(`❌ ${error.message}`);
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      // Verificar se CPF já existe (exceto o próprio usuário)
      const cpfExiste = usuarios.some(u => u.cpf === data.cpf && u.id !== id);
      if (cpfExiste) {
        throw new Error('CPF já cadastrado!');
      }

      // Verificar se email já existe (exceto o próprio usuário)
      const emailExiste = usuarios.some(u => u.email === data.email && u.id !== id);
      if (emailExiste) {
        throw new Error('E-mail já cadastrado!');
      }

      return base44.entities.User.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      setShowForm(false);
      setEditingUser(null);
      toast.success('✅ Usuário atualizado com sucesso!');
    },
    onError: (error) => {
      toast.error(`❌ ${error.message}`);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.User.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      toast.success('✅ Usuário excluído com sucesso!');
    },
    onError: () => {
      toast.error('❌ Erro ao excluir usuário');
    }
  });

  const handleSubmit = async (data) => {
    if (editingUser) {
      await updateMutation.mutateAsync({ id: editingUser.id, data });
    } else {
      await createMutation.mutateAsync(data);
    }
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm('⚠️ Deseja realmente excluir este usuário?')) {
      await deleteMutation.mutateAsync(id);
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingUser(null);
  };

  const usuariosAtivos = usuarios.filter(u => u.ativo !== false);
  const usuariosInativos = usuarios.filter(u => u.ativo === false);
  const administradores = usuarios.filter(u => u.role === 'admin');

  const cartoes = [
    {
      id: 1,
      label: "Total de Usuários",
      valor: usuarios.length,
      tipo: 'numero',
      icon: Users,
      cor: "blue"
    },
    {
      id: 2,
      label: "Usuários Ativos",
      valor: usuariosAtivos.length,
      tipo: 'numero',
      icon: UserCog,
      cor: "green"
    },
    {
      id: 3,
      label: "Usuários Inativos",
      valor: usuariosInativos.length,
      tipo: 'numero',
      icon: Users,
      cor: "orange"
    },
    {
      id: 4,
      label: "Administradores",
      valor: administradores.length,
      tipo: 'numero',
      icon: UserCog,
      cor: "purple"
    }
  ];

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
            <Users className="w-8 h-8 text-blue-600" />
            Gerenciar Usuários
          </h1>
          <p className="text-slate-600 mt-1">Controle de usuários e permissões do sistema</p>
        </div>

        <AnimatePresence mode="wait">
          {!showForm && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <Button
                onClick={() => setShowForm(true)}
                className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 gap-2 shadow-lg"
              >
                <Plus className="w-5 h-5" />
                Novo Usuário
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <CartoesResumo cartoes={cartoes} />

      <AnimatePresence mode="wait">
        {showForm ? (
          <FormularioUsuario
            key="form"
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            initialData={editingUser}
          />
        ) : (
          <TabelaUsuarios
            key="table"
            usuarios={usuarios}
            onEdit={handleEdit}
            onDelete={handleDelete}
            isLoading={isLoading}
          />
        )}
      </AnimatePresence>
    </div>
  );
}