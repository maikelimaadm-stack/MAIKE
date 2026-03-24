import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { getPermissionDisplayName, getUserDisplayName } from "@/lib/userDisplayName";

import FormularioUsuario from "../components/usuarios/FormularioUsuario";
import TabelaUsuarios from "../components/usuarios/TabelaUsuarios";

export default function Usuarios() {
  const [showForm, setShowForm] = useState(false);
  const [editingUsuario, setEditingUsuario] = useState(null);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const { data: usuarios = [], isLoading } = useQuery({
    queryKey: ["usuarios"],
    queryFn: async () => {
      try {
        return await base44.entities.User.list("-created_date");
      } catch {
        return [];
      }
    },
    initialData: [],
  });

  const { data: permissoes = [] } = useQuery({
    queryKey: ["permissoes"],
    queryFn: () => base44.entities.Permissao.list(),
    initialData: [],
  });

  const updatePermissaoMutation = useMutation({
    mutationFn: async (data) => {
      const existente = permissoes.find((item) => item.user_email === data.user_email);
      const usuario = usuarios.find((item) => item.email === data.user_email);
      const userNome = (data.user_nome || getPermissionDisplayName(existente, usuario) || getUserDisplayName(usuario)).trim();
      const nomeAtualUsuario = getUserDisplayName(usuario);

      if (usuario?.id && userNome && userNome !== nomeAtualUsuario) {
        await base44.entities.User.update(usuario.id, { nome: userNome });
      }

      const payload = {
        user_email: data.user_email,
        user_nome: userNome,
        modulos_permitidos: data.modulos_permitidos || [],
        permissoes_telas: data.permissoes_telas || [],
        mobile_menu_ids: data.mobile_menu_ids || [],
        is_admin: !!data.is_admin,
        mapa_geral_permissoes: data.mapa_geral_permissoes || {},
      };

      if (existente) {
        return base44.entities.Permissao.update(existente.id, payload);
      }

      return base44.entities.Permissao.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permissoes"] });
      queryClient.invalidateQueries({ queryKey: ["usuarios"] });
      setShowForm(false);
      setEditingUsuario(null);
      toast.success("Permissões atualizadas!");
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao salvar permissões.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (userEmail) => {
      const permissao = permissoes.find((item) => item.user_email === userEmail);
      if (permissao) {
        await base44.entities.Permissao.delete(permissao.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permissoes"] });
      toast.success("Permissões removidas!");
    },
    onError: () => {
      toast.error("Erro ao remover permissões.");
    },
  });

  const handleSubmit = async (data) => {
    await updatePermissaoMutation.mutateAsync(data);
  };

  const handleEdit = (usuario) => {
    const permissao = permissoes.find((item) => item.user_email === usuario.email);
    setEditingUsuario({
      ...usuario,
      user_email: usuario.email,
      user_nome: getPermissionDisplayName(permissao, usuario) || getUserDisplayName(usuario),
      modulos_permitidos: permissao?.modulos_permitidos || [],
      permissoes_telas: permissao?.permissoes_telas || [],
      mobile_menu_ids: permissao?.mobile_menu_ids || [],
      is_admin: permissao?.is_admin || false,
      mapa_geral_permissoes: permissao?.mapa_geral_permissoes || {},
    });
    setShowForm(true);
  };

  const handleDelete = async (userEmail) => {
    if (currentUser?.email === userEmail) {
      toast.error("Você não pode remover suas próprias permissões.");
      return;
    }

    if (window.confirm("REMOVER TODAS AS PERMISSÕES DESTE USUÁRIO?")) {
      await deleteMutation.mutateAsync(userEmail);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-2">
      {!showForm && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <div>
              <h1 className="text-lg font-bold text-slate-900">Usuários e Permissões</h1>
              <p className="text-xs text-slate-600">Configurar módulos, telas, ações e menu mobile por usuário</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => { setEditingUsuario(null); setShowForm(true); }} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
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
                <h4 className="font-semibold text-sm text-blue-900 mb-1">Como funciona agora</h4>
                <ul className="text-xs text-blue-800 space-y-1 list-disc pl-4">
                  <li>Você libera primeiro os módulos do menu.</li>
                  <li>Depois escolhe tela por tela o que o usuário pode visualizar e fazer.</li>
                  <li>Também dá para escolher quais telas aparecem no menu inferior do mobile.</li>
                  <li>Se o usuário não tiver permissão de ação, o sistema bloqueia e mostra um aviso.</li>
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