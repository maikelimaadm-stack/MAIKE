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
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";
import { useCadastroPageListBindings } from "@/hooks/useCadastroPageListBindings";
import TabelaContasAcesso, { CONTAS_ACESSO_COLUNAS } from "@/components/usuarios/TabelaContasAcesso";
import TabelaUsuarios, { USUARIOS_LIST_COLUNAS } from "@/components/usuarios/TabelaUsuarios";
import { toast } from "sonner";
import { getPermissionDisplayName, getUserDisplayName } from "@/lib/userDisplayName";

import FormularioUsuario from "../components/usuarios/FormularioUsuario";
import FormularioContaAcesso from "../components/usuarios/FormularioContaAcesso";
import {
  listarContasAcesso,
  criarContaAcesso,
  atualizarContaAcesso,
  validarPatchContaAcesso,
} from "@/services/usuarioAdminService";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";

export default function Usuarios() {
  const [showForm, setShowForm] = useState(false);
  const [editingUsuario, setEditingUsuario] = useState(null);
  const [showContaForm, setShowContaForm] = useState(false);
  const [editingConta, setEditingConta] = useState(null);
  const chromeContas = useCadastroListaChromeState();
  const chromePerm = useCadastroListaChromeState();
  const listBindingsContas = useCadastroPageListBindings({
    storageKey: "colunas_contas_acesso_v1",
    columns: CONTAS_ACESSO_COLUNAS,
    chrome: chromeContas,
  });
  const listBindingsPerm = useCadastroPageListBindings({
    storageKey: "colunas_usuarios_v1",
    columns: USUARIOS_LIST_COLUNAS,
    chrome: chromePerm,
  });
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => getCurrentUser(),
  });

  const { data: usuarios = [], isLoading } = useQuery({
    queryKey: ["usuarios"],
    queryFn: async () => {
      try {
        return await listarUsuarios();
      } catch {
        // Sem permissão para listar usuários a tela ainda funciona com as
        // permissões já gravadas — comportamento preservado da P0.
        return [];
      }
    },
    initialData: [],
  });

  const { data: permissoes = [] } = useQuery({
    queryKey: ["permissoes"],
    queryFn: () => listarPermissoes(),
    initialData: [],
  });

  const {
    data: contasAcesso = [],
    isLoading: contasLoading,
    isError: contasErro,
  } = useQuery({
    queryKey: ["contasAcesso"],
    queryFn: () => listarContasAcesso(),
    initialData: [],
  });

  const updatePermissaoMutation = useMutation({
    mutationFn: (data) => {
      // O nome de exibição continua sendo resolvido aqui: é regra de
      // apresentação. A montagem do payload e a propagação para `User.nome`
      // saíram para o service.
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
      queryClient.invalidateQueries({ queryKey: ["permissoes"] });
      queryClient.invalidateQueries({ queryKey: ["usuarios"] });
      setShowForm(false);
      setEditingUsuario(null);
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
      queryClient.invalidateQueries({ queryKey: ["permissoes"] });
      if (removida) toast.success("Permissões removidas!");
    },
    onError: (error) => {
      // Bloqueio por código, nunca por texto.
      if (hasApiErrorCode(error, API_ERROR_CODES.PERMISSAO_SELF_DELETE_BLOCKED)) {
        toast.error(getApiErrorMessage(error));
        return;
      }
      toast.error(getApiErrorMessage(error, "Não foi possível remover as permissões."));
    },
  });

  const handleSubmit = async (data) => {
    await updatePermissaoMutation.mutateAsync(data);
  };

  const closePermForm = () => {
    setShowForm(false);
    setEditingUsuario(null);
    chromePerm.exitRecordView();
  };

  const closeContaForm = () => {
    setShowContaForm(false);
    setEditingConta(null);
    chromeContas.exitRecordView();
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

  const openContaForm = (conta) => {
    setEditingConta(conta ?? null);
    setShowContaForm(true);
    chromeContas.setViewMode("record");
    if (conta) {
      const id = conta.id || conta.login || conta.email;
      if (id) chromeContas.onSelectionChange([id]);
    }
  };

  const contaMutation = useMutation({
    /** @param {{ id?: string, dados: Record<string, unknown> }} variables */
    mutationFn: async (variables) => {
      const { id, dados } = variables;
      if (id) {
        validarPatchContaAcesso(currentUser, editingConta, dados);
        return atualizarContaAcesso(id, dados);
      }
      return criarContaAcesso(dados);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["contasAcesso"] });
      queryClient.invalidateQueries({ queryKey: ["usuarios"] });
      setShowContaForm(false);
      setEditingConta(null);
      toast.success(variables.id ? "Conta atualizada!" : "Conta criada!");
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Não foi possível salvar a conta."));
    },
  });

  const handleContaSubmit = async (dados) => {
    await contaMutation.mutateAsync({ id: editingConta?.id, dados });
  };

  const handleDelete = async (userEmail) => {
    // A autoexclusão é bloqueada no service; aqui só evitamos abrir a confirmação.
    if (currentUser?.email === userEmail) {
      toast.error("Você não pode remover suas próprias permissões.");
      return;
    }

    if (window.confirm("REMOVER TODAS AS PERMISSÕES DESTE USUÁRIO?")) {
      try {
        await deleteMutation.mutateAsync(userEmail);
      } catch {
        // A mensagem já foi exibida por `onError`.
      }
    }
  };

  const contasFiltradas = useMemo(() => {
    const q = chromeContas.appliedSearch.trim().toLowerCase();
    if (!q) return contasAcesso.length;
    return contasAcesso.filter((conta) => {
      const login = (conta.login || conta.email || "").toLowerCase();
      const nome = (conta.nome || conta.full_name || "").toLowerCase();
      return login.includes(q) || nome.includes(q);
    }).length;
  }, [contasAcesso, chromeContas.appliedSearch]);

  const permFiltrados = useMemo(() => {
    const q = chromePerm.appliedSearch.trim().toLowerCase();
    if (!q) return usuarios.length;
    return usuarios.filter((usuario) => {
      const hay = [usuario.full_name, usuario.email, getUserDisplayName(usuario)].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    }).length;
  }, [usuarios, chromePerm.appliedSearch]);

  const handleEditContaSelected = () => {
    const id = chromeContas.selectedIds[0];
    const conta = contasAcesso.find((c) => (c.id || c.login || c.email) === id);
    if (conta) openContaForm(conta);
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

  const onViewModeContas = useCallback(
    (mode) => {
      chromeContas.handleViewModeChange(mode, {
        onOpenRecord: () => handleEditContaSelected(),
        onExitRecord: closeContaForm,
      });
    },
    [chromeContas, handleEditContaSelected, closeContaForm],
  );

  const onViewModePerm = useCallback(
    (mode) => {
      chromePerm.handleViewModeChange(mode, {
        onOpenRecord: () => handleEditPermSelected(),
        onExitRecord: closePermForm,
      });
    },
    [chromePerm, handleEditPermSelected, closePermForm],
  );

  const recordNavContas = useMemo(() => {
    const q = chromeContas.appliedSearch.trim().toLowerCase();
    if (!q) return contasAcesso;
    return contasAcesso.filter((conta) => {
      const login = (conta.login || conta.email || "").toLowerCase();
      const nome = (conta.nome || conta.full_name || "").toLowerCase();
      return login.includes(q) || nome.includes(q);
    });
  }, [contasAcesso, chromeContas.appliedSearch]);

  const recordNavPerm = useMemo(() => {
    const q = chromePerm.appliedSearch.trim().toLowerCase();
    if (!q) return usuarios;
    return usuarios.filter((usuario) => {
      const hay = [usuario.full_name, usuario.email, getUserDisplayName(usuario)].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [usuarios, chromePerm.appliedSearch]);

  const contaRecordIndex = editingConta?.id
    ? Math.max(
        0,
        recordNavContas.findIndex(
          (c) => (c.id || c.login || c.email) === (editingConta.id || editingConta.login || editingConta.email),
        ),
      )
    : 0;

  const permRecordIndex = editingUsuario?.id
    ? Math.max(0, recordNavPerm.findIndex((u) => u.id === editingUsuario.id || u.email === editingUsuario.email))
    : 0;

  const goContaRecord = (index) => {
    const row = recordNavContas[index];
    if (row) openContaForm(row);
  };

  const goPermRecord = (index) => {
    const row = recordNavPerm[index];
    if (row) handleEdit(row);
  };

  const contaDetailTitle = editingConta?.id
    ? editingConta.nome || editingConta.login || editingConta.email || "Conta MAIKE"
    : "Nova conta MAIKE";

  const permDetailTitle = editingUsuario?.user_nome || editingUsuario?.full_name || getUserDisplayName(editingUsuario) || "Permissões";

  return (
    <CadastroWorkspace
      mode="list"
      title="Usuários e permissões"
      subtitle="Contas de entrada nativas e permissões de menu por usuário."
      toolbar={null}
    >
      {!showForm && !showContaForm ? (
        <div className="cadastro-b1 mg-card p-3 mb-2 border-blue-200/80 bg-blue-50/90">
          <div className="flex gap-3">
            <div className="text-blue-600 mt-0.5">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-sm text-blue-900 mb-1">Como funciona agora</h4>
              <ul className="text-xs text-blue-800 space-y-1 list-disc pl-4">
                <li>Novos usuários começam com tudo bloqueado por padrão.</li>
                <li>Você libera primeiro os módulos do menu.</li>
                <li>Depois escolhe tela por tela o que o usuário pode visualizar e fazer.</li>
                <li>Também dá para escolher quais telas aparecem no menu inferior do mobile.</li>
                <li>Se o usuário não tiver permissão de ação, o sistema bloqueia e mostra um aviso.</li>
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        {contasErro ? (
          <div className="cadastro-b1 mg-card p-3 text-xs text-amber-800 bg-amber-50 border-amber-200">
            Não foi possível carregar as contas nativas. Verifique se você está autenticado no backend MAIKE.
          </div>
        ) : (
          <CadastroListaChrome
            recordMode={showContaForm}
            secondaryToolsLocked={showContaForm}
            recordHeader={
              showContaForm ? (
                <CadastroRecordHeader
                  title={contaDetailTitle}
                  code={editingConta?.login || editingConta?.email || undefined}
                  index={contaRecordIndex}
                  total={recordNavContas.length}
                  onGo={editingConta?.id ? goContaRecord : undefined}
                  navDisabled={!editingConta?.id}
                />
              ) : null
            }
            recordBody={
              showContaForm ? (
                <FormularioContaAcesso
                  onSubmit={handleContaSubmit}
                  onCancel={closeContaForm}
                  initialData={editingConta}
                />
              ) : null
            }
            selectedCount={chromeContas.selectedIds.length}
            {...listBindingsContas.listFooter.chromeFooter}
            createLabel="Nova conta"
            onNew={() => openContaForm(null)}
            onEdit={handleEditContaSelected}
            onDelete={null}
            onPrint={() => window.print()}
            cardsModeAvailable
            cardsToolbar={listBindingsContas.cardsToolbar}
            searchValue={chromeContas.searchInput}
            onSearchChange={chromeContas.setSearchInput}
            onSearchApply={chromeContas.applySearch}
            searchActive={chromeContas.searchActive}
            searchPlaceholder="Buscar contas…"
            onConfigureColumns={() => {}}
            onClearFilters={chromeContas.clearFilters}
            filtersActive={chromeContas.filtersActive}
            viewMode={showContaForm ? "record" : chromeContas.viewMode}
            onViewModeChange={onViewModeContas}
            filterRailHint="Login e senha do backend nativo MAIKE."
          >
            {!showContaForm ? (
              <TabelaContasAcesso
                chromeLayout
                contas={contasAcesso}
                currentUser={currentUser}
                searchQuery={chromeContas.appliedSearch}
                selectedIds={chromeContas.selectedIds}
                onSelectionChange={chromeContas.onSelectionChange}
                onEdit={(conta) => openContaForm(conta)}
                isLoading={contasLoading}
                viewMode={chromeContas.viewMode === "cards" ? "cards" : "table"}
                displayLimit={listBindingsContas.listFooter.gradePaging.displayLimit}
                onListMetrics={listBindingsContas.listFooter.gradePaging.onListMetrics}
                cardFields={listBindingsContas.cardsPrefs.cardFields}
                cardsPerRow={listBindingsContas.cardsPrefs.cardsPerRow}
              />
            ) : null}
          </CadastroListaChrome>
        )}

        <CadastroListaChrome
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
          onConfigureColumns={() => {}}
          onClearFilters={chromePerm.clearFilters}
          filtersActive={chromePerm.filtersActive}
          viewMode={showForm ? "record" : chromePerm.viewMode}
          onViewModeChange={onViewModePerm}
          filterRailHint="Permissões de menu e telas por usuário Base44."
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
      </div>
    </CadastroWorkspace>
  );
}