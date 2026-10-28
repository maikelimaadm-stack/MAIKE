import React, { useCallback, useMemo, useState } from "react";
import {
  getCurrentUser,
  listarUsuarios,
  listarPermissoes,
  permissaoDoUsuario,
  salvarPermissao,
  removerPermissao,
} from "@/services/sessionService";
import { getApiErrorMessage, hasApiErrorCode, API_ERROR_CODES } from "@/apis/_core/ApiError";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import CadastroRecordHeader from "@/components/cadastro/base1/CadastroRecordHeader";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";
import { useCadastroPageListBindings } from "@/hooks/useCadastroPageListBindings";
import TabelaUsuarios, { USUARIOS_LIST_COLUNAS } from "@/components/usuarios/TabelaUsuarios";
import FormularioUsuario from "@/components/usuarios/FormularioUsuario";
import { toast } from "sonner";
import { getPermissionDisplayName, getUserDisplayName } from "@/lib/userDisplayName";
import { useAuth } from "@/lib/AuthContext";
import { isUsuariosListagemRestrita } from "@/lib/usuariosListQuery";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";

export default function Permissoes() {
  const [showForm, setShowForm] = useState(false);
  const [editingUsuario, setEditingUsuario] = useState(null);
  const chromePerm = useCadastroListaChromeState();
  const listBindingsPerm = useCadastroPageListBindings({
    storageKey: "colunas_usuarios_v1",
    columns: USUARIOS_LIST_COLUNAS,
    chrome: chromePerm,
  });
  const queryClient = useQueryClient();
  const { clienteId, user } = useAuth();
  const sessaoKey = clienteId || user?.id || "anon";

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser", sessaoKey],
    queryFn: () => getCurrentUser(),
  });

  const {
    data: usuarios = [],
    isLoading,
    isError: usuariosErro,
    error: usuariosQueryError,
    isFetching: usuariosFetching,
    refetch: refetchUsuarios,
  } = useQuery({
    queryKey: ["usuarios", sessaoKey],
    queryFn: async () => {
      try {
        return await listarUsuarios();
      } catch (error) {
        if (isUsuariosListagemRestrita(error)) {
          return [];
        }
        throw error;
      }
    },
  });

  const { data: permissoes = [] } = useQuery({
    queryKey: ["permissoes", sessaoKey],
    queryFn: () => listarPermissoes(),
  });

  const updatePermissaoMutation = useMutation({
    /** @param {Record<string, unknown>} data */
    mutationFn: (data) => {
      const existente = permissaoDoUsuario(permissoes, data.user_email);
      const usuario = usuarios.find((item) => item.email === data.user_email);
      const userNome = (data.user_nome || getPermissionDisplayName(existente, usuario) || getUserDisplayName(usuario)).trim();

      return salvarPermissao({
        dados: data,
        permissoes,
        usuarios,
        userNome,
        nomeAtualUsuario: getUserDisplayName(usuario),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permissoes", sessaoKey] });
      queryClient.invalidateQueries({ queryKey: ["usuarios", sessaoKey] });
      setShowForm(false);
      setEditingUsuario(null);
      chromePerm.exitRecordView();
      toast.success("Permissões atualizadas!");
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Não foi possível salvar as permissões."));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (userEmail) =>
      removerPermissao({ userEmail, permissoes, emailDoUsuarioAtual: currentUser?.email }),
    onSuccess: ({ removida }) => {
      queryClient.invalidateQueries({ queryKey: ["permissoes", sessaoKey] });
      if (removida) toast.success("Permissões removidas!");
    },
    onError: (error) => {
      if (hasApiErrorCode(error, API_ERROR_CODES.PERMISSAO_SELF_DELETE_BLOCKED)) {
        toast.error(getApiErrorMessage(error));
        return;
      }
      toast.error(getApiErrorMessage(error, "Não foi possível remover as permissões."));
    },
  });

  /** @param {Record<string, unknown>} data */
  const handleSubmit = (data) => {
    updatePermissaoMutation.mutate(data);
  };

  const closePermForm = () => {
    setShowForm(false);
    setEditingUsuario(null);
    chromePerm.exitRecordView();
  };

  const handleEdit = (usuario) => {
    const permissao = permissaoDoUsuario(permissoes, usuario.email);
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
    chromePerm.setViewMode("record");
    const sel = usuario.id || usuario.email;
    if (sel) chromePerm.onSelectionChange([sel]);
  };

  const handleDelete = async (userEmail) => {
    if (currentUser?.email === userEmail) {
      toast.error("Você não pode remover suas próprias permissões.");
      return;
    }

    if (window.confirm("REMOVER TODAS AS PERMISSÕES DESTE USUÁRIO?")) {
      try {
        await deleteMutation.mutateAsync(userEmail);
      } catch {
        // mensagem em onError
      }
    }
  };

  const handleEditPermSelected = () => {
    const usuario = usuarios.find((u) => u.id === chromePerm.selectedIds[0] || u.email === chromePerm.selectedIds[0]);
    if (usuario) handleEdit(usuario);
  };

  const handleDeletePermSelected = () => {
    const id = chromePerm.selectedIds[0];
    const usuario = usuarios.find((u) => u.id === id || u.email === id);
    if (usuario?.email) handleDelete(usuario.email);
  };

  const onViewModePerm = useCallback(
    (mode) => {
      chromePerm.handleViewModeChange(mode, {
        onOpenRecord: () => handleEditPermSelected(),
        onExitRecord: closePermForm,
      });
    },
    [chromePerm, handleEditPermSelected, closePermForm],
  );

  const recordNavPerm = useMemo(() => {
    const q = chromePerm.appliedSearch.trim().toLowerCase();
    if (!q) return usuarios;
    return usuarios.filter((usuario) => {
      const hay = [usuario.full_name, usuario.email, getUserDisplayName(usuario)].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [usuarios, chromePerm.appliedSearch]);

  const permRecordIndex = editingUsuario?.id
    ? Math.max(0, recordNavPerm.findIndex((u) => u.id === editingUsuario.id || u.email === editingUsuario.email))
    : 0;

  const goPermRecord = (index) => {
    const row = recordNavPerm[index];
    if (row) handleEdit(row);
  };

  const permDetailTitle =
    editingUsuario?.user_nome || editingUsuario?.full_name || getUserDisplayName(editingUsuario) || "Permissões";

  const listErrorMessage =
    usuariosErro && !usuariosFetching
      ? getApiErrorMessage(
          usuariosQueryError,
          "Não foi possível carregar a lista de usuários. Tente novamente em instantes.",
        )
      : null;

  return (
    <CadastroWorkspace mode="list" title="Permissões" {...BASE1_LISTA_INTEGRADA_VISUAL.workspace}>
      {!showForm ? (
        <div className="cadastro-b1 mg-card p-3 mb-2 border-blue-200/80 bg-blue-50/90">
          <div className="flex gap-3">
            <div className="text-blue-600 mt-0.5">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-sm text-blue-900 mb-1">Como funciona</h4>
              <ul className="text-xs text-blue-800 space-y-1 list-disc pl-4">
                <li>Novos usuários começam com tudo bloqueado por padrão.</li>
                <li>Libere primeiro os módulos do menu; depois tela por tela.</li>
                <li>Escolha até 4 telas no menu inferior do mobile.</li>
                <li>Contas de login nativo ficam em Administração › Usuários (sem vínculo automático login↔email).</li>
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {listErrorMessage ? (
        <div className="cadastro-b1 mg-card p-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 mb-2 flex flex-wrap items-center gap-2">
          <span>{listErrorMessage}</span>
          <button type="button" className="tb-btn tb-btn-gray" onClick={() => refetchUsuarios()}>
            Tentar novamente
          </button>
        </div>
      ) : null}

      <CadastroListaChrome
        {...BASE1_LISTA_INTEGRADA_VISUAL.chrome}
        recordMode={showForm}
        secondaryToolsLocked={showForm}
        recordHeader={
          showForm ? (
            <CadastroRecordHeader
              title={permDetailTitle}
              code={editingUsuario?.email || undefined}
              index={permRecordIndex}
              total={recordNavPerm.length}
              onGo={editingUsuario?.id || editingUsuario?.email ? goPermRecord : undefined}
              navDisabled={!(editingUsuario?.id || editingUsuario?.email)}
            />
          ) : null
        }
        recordBody={
          showForm ? (
            <FormularioUsuario
              onSubmit={handleSubmit}
              onCancel={closePermForm}
              initialData={editingUsuario}
              usuarios={usuarios}
            />
          ) : null
        }
        selectedCount={chromePerm.selectedIds.length}
        {...listBindingsPerm.listFooter.chromeFooter}
        createLabel="Permissões"
        onPrint={() => window.print()}
        cardsModeAvailable
        cardsToolbar={listBindingsPerm.cardsToolbar}
        onNew={() => {
          setEditingUsuario(null);
          setShowForm(true);
          chromePerm.setViewMode("record");
        }}
        onEdit={handleEditPermSelected}
        onDelete={handleDeletePermSelected}
        searchValue={chromePerm.searchInput}
        onSearchChange={chromePerm.setSearchInput}
        onSearchApply={chromePerm.applySearch}
        searchActive={chromePerm.searchActive}
        searchPlaceholder="Buscar usuários…"
        onClearFilters={chromePerm.clearFilters}
        filtersActive={chromePerm.filtersActive}
        viewMode={showForm ? "record" : chromePerm.viewMode}
        onViewModeChange={onViewModePerm}
        filterRailHint="Permissões de menu e telas (perfil Base44 / email)."
      >
        {!showForm ? (
          <TabelaUsuarios
            chromeLayout
            usuarios={usuarios}
            permissoes={permissoes}
            currentUser={currentUser}
            searchQuery={chromePerm.appliedSearch}
            selectedIds={chromePerm.selectedIds}
            onSelectionChange={chromePerm.onSelectionChange}
            onEdit={handleEdit}
            onDelete={handleDelete}
            isLoading={isLoading}
            viewMode={chromePerm.viewMode === "cards" ? "cards" : "table"}
            displayLimit={listBindingsPerm.listFooter.gradePaging.displayLimit}
            onListMetrics={listBindingsPerm.listFooter.gradePaging.onListMetrics}
            cardFields={listBindingsPerm.cardsPrefs.cardFields}
            cardsPerRow={listBindingsPerm.cardsPrefs.cardsPerRow}
          />
        ) : null}
      </CadastroListaChrome>
    </CadastroWorkspace>
  );
}
