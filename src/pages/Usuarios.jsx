import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import FormularioUsuario from "../components/usuarios/FormularioUsuario";
import TabelaUsuarios from "../components/usuarios/TabelaUsuarios";
import FormularioGrupoPermissao from "../components/usuarios/FormularioGrupoPermissao";
import TabelaGruposPermissao from "../components/usuarios/TabelaGruposPermissao";

export default function Usuarios() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("usuarios");
  const [showUserForm, setShowUserForm] = useState(false);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState(null);
  const [editingGroup, setEditingGroup] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const { data: usuarios = [], isLoading: usersLoading } = useQuery({
    queryKey: ["usuarios"],
    queryFn: async () => base44.entities.User.list("-created_date"),
    initialData: []
  });

  const { data: assignments = [] } = useQuery({
    queryKey: ["user-group-assignments"],
    queryFn: () => base44.entities.Permissao.list(),
    initialData: []
  });

  const { data: grupos = [], isLoading: groupsLoading } = useQuery({
    queryKey: ["permission-groups"],
    queryFn: () => base44.entities.GrupoPermissao.list("-updated_date"),
    initialData: []
  });

  const saveAssignmentMutation = useMutation({
    mutationFn: async (payload) => {
      const existing = assignments.find((item) => item.user_email === payload.user_email);
      if (existing) {
        return base44.entities.Permissao.update(existing.id, payload);
      }
      return base44.entities.Permissao.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-group-assignments"] });
      setShowUserForm(false);
      setEditingAssignment(null);
      toast.success("Vínculo salvo com sucesso!");
    }
  });

  const deleteAssignmentMutation = useMutation({
    mutationFn: async (userEmail) => {
      const existing = assignments.find((item) => item.user_email === userEmail);
      if (existing) {
        await base44.entities.Permissao.delete(existing.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-group-assignments"] });
      toast.success("Vínculo removido!");
    }
  });

  const saveGroupMutation = useMutation({
    mutationFn: async (payload) => {
      const existing = grupos.find((item) => item.codigo?.toUpperCase() === payload.codigo?.toUpperCase() && item.id !== editingGroup?.id);
      if (existing) {
        throw new Error("Já existe um grupo com este código.");
      }

      if (editingGroup?.id) {
        return base44.entities.GrupoPermissao.update(editingGroup.id, payload);
      }
      return base44.entities.GrupoPermissao.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permission-groups"] });
      queryClient.invalidateQueries({ queryKey: ["user-group-assignments"] });
      setShowGroupForm(false);
      setEditingGroup(null);
      toast.success("Grupo salvo com sucesso!");
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao salvar grupo.");
    }
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (grupo) => {
      const linkedUsers = assignments.filter((item) => item.grupo_permissao_id === grupo.id);
      if (linkedUsers.length > 0) {
        throw new Error("Este grupo possui usuários vinculados.");
      }
      await base44.entities.GrupoPermissao.delete(grupo.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permission-groups"] });
      toast.success("Grupo excluído!");
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao excluir grupo.");
    }
  });

  const handleEditAssignment = (usuario) => {
    const assignment = assignments.find((item) => item.user_email === usuario.email);
    setEditingAssignment({
      ...usuario,
      user_email: usuario.email,
      grupo_permissao_id: assignment?.grupo_permissao_id || "",
      grupo_permissao_nome: assignment?.grupo_permissao_nome || ""
    });
    setShowUserForm(true);
    setActiveTab("usuarios");
  };

  const handleSaveAssignment = async (payload) => {
    await saveAssignmentMutation.mutateAsync(payload);
  };

  const handleDeleteAssignment = async (userEmail) => {
    if (currentUser?.email === userEmail) {
      toast.error("Você não pode remover o seu próprio vínculo.");
      return;
    }
    await deleteAssignmentMutation.mutateAsync(userEmail);
  };

  const handleEditGroup = (grupo) => {
    setEditingGroup(grupo);
    setShowGroupForm(true);
    setActiveTab("grupos");
  };

  const handleSaveGroup = async (payload) => {
    await saveGroupMutation.mutateAsync(payload);
  };

  const handleDeleteGroup = async (grupo) => {
    await deleteGroupMutation.mutateAsync(grupo);
  };

  const closeForms = () => {
    setShowUserForm(false);
    setShowGroupForm(false);
    setEditingAssignment(null);
    setEditingGroup(null);
  };

  return (
    <div className="p-4 md:p-6 space-y-1">
      {!showUserForm && !showGroupForm && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-3 py-2 shadow-sm border-b border-slate-200">
            <div>
              <h1 className="text-lg font-bold text-slate-900">Usuários e Permissões</h1>
              <p className="text-xs text-slate-600">Controle completo por grupo, tela, ação e atalhos do mobile</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {activeTab === "usuarios" ? (
                <Button onClick={() => { setEditingAssignment(null); setShowUserForm(true); }} size="sm" className="h-8 text-xs bg-lime-500 text-primary-foreground shadow hover:bg-emerald-700">
                  Vincular Usuário
                </Button>
              ) : (
                <Button onClick={() => { setEditingGroup(null); setShowGroupForm(true); }} size="sm" className="h-8 text-xs bg-lime-500 text-primary-foreground shadow hover:bg-emerald-700">
                  Novo Grupo
                </Button>
              )}
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex-1">
              <h4 className="font-semibold text-sm text-blue-900 mb-1">Como funciona o sistema</h4>
              <ul className="text-xs text-blue-800 space-y-1 list-disc pl-4">
                <li>Você cria grupos de permissão com acesso por tela e por ação</li>
                <li>Depois vincula cada usuário a um grupo para herdar automaticamente as regras</li>
                <li>O menu desktop, o menu mobile, o acesso às rotas e os atalhos respeitam o grupo configurado</li>
              </ul>
            </div>
          </div>
        </>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3">
        {!showUserForm && !showGroupForm && (
          <TabsList className="grid w-full max-w-[360px] grid-cols-2 h-8">
            <TabsTrigger value="usuarios" className="text-xs">Usuários</TabsTrigger>
            <TabsTrigger value="grupos" className="text-xs">Grupos</TabsTrigger>
          </TabsList>
        )}

        <TabsContent value="usuarios" className="space-y-3 mt-0">
          <AnimatePresence>
            {showUserForm ? (
              <FormularioUsuario
                key="form-usuario"
                initialData={editingAssignment}
                usuarios={usuarios}
                grupos={grupos}
                onSubmit={handleSaveAssignment}
                onCancel={closeForms}
              />
            ) : (
              <TabelaUsuarios
                key="table-usuarios"
                usuarios={usuarios}
                assignments={assignments}
                grupos={grupos}
                currentUser={currentUser}
                onEdit={handleEditAssignment}
                onDelete={handleDeleteAssignment}
                isLoading={usersLoading}
              />
            )}
          </AnimatePresence>
        </TabsContent>

        <TabsContent value="grupos" className="space-y-3 mt-0">
          <AnimatePresence>
            {showGroupForm ? (
              <FormularioGrupoPermissao
                key="form-grupo"
                initialData={editingGroup}
                onSubmit={handleSaveGroup}
                onCancel={closeForms}
              />
            ) : (
              <TabelaGruposPermissao
                key="table-grupos"
                grupos={grupos}
                assignments={assignments}
                onEdit={handleEditGroup}
                onDelete={handleDeleteGroup}
                isLoading={groupsLoading}
              />
            )}
          </AnimatePresence>
        </TabsContent>
      </Tabs>
    </div>
  );
}