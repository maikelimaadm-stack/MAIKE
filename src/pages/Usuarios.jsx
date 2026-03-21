import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { Shield, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import FormularioGrupoPermissao from "@/components/usuarios/FormularioGrupoPermissao";
import TabelaGruposPermissao from "@/components/usuarios/TabelaGruposPermissao";
import FormularioUsuario from "@/components/usuarios/FormularioUsuario";
import TabelaUsuarios from "@/components/usuarios/TabelaUsuarios";

export default function Usuarios() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("grupos");
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [deleteRoleState, setDeleteRoleState] = useState({ open: false, role: null });

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const { data: usuarios = [], isLoading: usersLoading } = useQuery({
    queryKey: ["usuarios"],
    queryFn: async () => {
      try {
        return await base44.entities.User.list("-created_date");
      } catch {
        return [];
      }
    },
    initialData: []
  });

  const { data: grupos = [], isLoading: groupsLoading } = useQuery({
    queryKey: ["grupos-permissao"],
    queryFn: async () => {
      const all = await base44.entities.GrupoPermissao.list("nome");
      return all.filter((grupo) => grupo.ativo !== false);
    },
    initialData: []
  });

  const createRoleMutation = useMutation({
    mutationFn: (payload) => base44.entities.GrupoPermissao.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grupos-permissao"] });
      setShowRoleForm(false);
      setEditingRole(null);
      toast.success("Grupo criado com sucesso!");
    }
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ id, payload }) => base44.entities.GrupoPermissao.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grupos-permissao"] });
      setShowRoleForm(false);
      setEditingRole(null);
      toast.success("Grupo atualizado com sucesso!");
    }
  });

  const deleteRoleMutation = useMutation({
    mutationFn: (id) => base44.entities.GrupoPermissao.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grupos-permissao"] });
      setDeleteRoleState({ open: false, role: null });
      toast.success("Grupo removido com sucesso!");
    }
  });

  const updateUserGroupMutation = useMutation({
    mutationFn: ({ userId, grupoCodigo }) => base44.entities.User.update(userId, { grupo_permissao_codigo: grupoCodigo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["usuarios"] });
      setShowUserForm(false);
      setEditingUser(null);
      toast.success("Usuário vinculado ao grupo com sucesso!");
    }
  });

  const removeUserGroupMutation = useMutation({
    mutationFn: (userId) => base44.entities.User.update(userId, { grupo_permissao_codigo: "" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["usuarios"] });
      toast.success("Grupo removido do usuário!");
    }
  });

  const handleSubmitRole = (payload) => {
    if (editingRole?.id) {
      updateRoleMutation.mutate({ id: editingRole.id, payload });
      return;
    }
    createRoleMutation.mutate(payload);
  };

  const handleDeleteRole = (role) => {
    const linkedUsers = usuarios.filter((user) => user.grupo_permissao_codigo === role.codigo).length;
    if (linkedUsers > 0) {
      toast.error("Este grupo está vinculado a usuários e não pode ser excluído agora.");
      return;
    }
    setDeleteRoleState({ open: true, role });
  };

  const handleSubmitUser = (data) => {
    updateUserGroupMutation.mutate({ userId: data.user_id, grupoCodigo: data.grupo_permissao_codigo });
  };

  const handleRemoveUserGroup = (user) => {
    if (currentUser?.email === user.email) {
      toast.error("Você não pode remover o seu próprio grupo por aqui.");
      return;
    }
    removeUserGroupMutation.mutate(user.id);
  };

  return (
    <div className="p-4 md:p-6 space-y-1">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-3 py-2 shadow-sm border-b border-slate-200">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Usuários e Permissões</h1>
          <p className="text-xs text-slate-600">Controle completo por grupos, telas, ações e menu mobile</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {activeTab === "grupos" && !showRoleForm && (
            <Button onClick={() => { setEditingRole(null); setShowRoleForm(true); }} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
              Novo Grupo
            </Button>
          )}
          {activeTab === "usuarios" && !showUserForm && (
            <Button onClick={() => { setEditingUser(null); setShowUserForm(true); }} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
              Vincular Usuário
            </Button>
          )}
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <ul className="text-xs text-blue-800 space-y-1 list-disc pl-4">
          <li>Crie grupos com permissões detalhadas por tela e por ação.</li>
          <li>Vincule cada usuário a um grupo para herdar automaticamente seus acessos.</li>
          <li>Defina quais telas aparecem no menu inferior do mobile, com limite de até 4 atalhos.</li>
          <li>Admins Base44 continuam com acesso total automaticamente.</li>
        </ul>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="grupos" className="text-xs gap-2"><Shield className="w-3.5 h-3.5" />Grupos</TabsTrigger>
          <TabsTrigger value="usuarios" className="text-xs gap-2"><Users className="w-3.5 h-3.5" />Usuários</TabsTrigger>
        </TabsList>

        <TabsContent value="grupos" className="space-y-4">
          <AnimatePresence>
            {showRoleForm && (
              <FormularioGrupoPermissao
                initialData={editingRole}
                grupos={grupos}
                onSubmit={handleSubmitRole}
                onCancel={() => { setShowRoleForm(false); setEditingRole(null); }}
              />
            )}
          </AnimatePresence>

          {!showRoleForm && (
            <TabelaGruposPermissao
              grupos={grupos}
              usuarios={usuarios}
              onEdit={(role) => { setEditingRole(role); setShowRoleForm(true); }}
              onDelete={handleDeleteRole}
              isLoading={groupsLoading}
            />
          )}
        </TabsContent>

        <TabsContent value="usuarios" className="space-y-4">
          <AnimatePresence>
            {showUserForm && (
              <FormularioUsuario
                initialData={editingUser}
                usuarios={usuarios}
                grupos={grupos}
                onSubmit={handleSubmitUser}
                onCancel={() => { setShowUserForm(false); setEditingUser(null); }}
              />
            )}
          </AnimatePresence>

          {!showUserForm && (
            <TabelaUsuarios
              usuarios={usuarios}
              grupos={grupos}
              currentUser={currentUser}
              onEdit={(user) => { setEditingUser(user); setShowUserForm(true); }}
              onRemoveGroup={handleRemoveUserGroup}
              isLoading={usersLoading}
            />
          )}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={deleteRoleState.open}
        onOpenChange={(open) => !open && setDeleteRoleState({ open: false, role: null })}
        title="Confirmar exclusão"
        description={deleteRoleState.role ? `Deseja realmente excluir o grupo ${deleteRoleState.role.nome}?` : "Deseja realmente excluir este grupo?"}
        onConfirm={() => deleteRoleState.role && deleteRoleMutation.mutate(deleteRoleState.role.id)}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
      />
    </div>
  );
}