import React, { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import FormularioContaAcesso, { FORMULARIO_CONTA_ACESSO_ID } from "@/components/usuarios/FormularioContaAcesso";
import TabelaContasAcesso, {
  CONTAS_ACESSO_COLUNAS,
  getContaAcessoFieldValue,
} from "@/components/usuarios/TabelaContasAcesso";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { getCurrentUser } from "@/services/sessionService";
import {
  listarContasAcessoPagina,
  criarContaAcesso,
  atualizarContaAcesso,
  validarPatchContaAcesso,
  contaPublica,
  contaPublicaAposAtualizar,
  ehContaPropria,
  ehTrocaDaPropriaSenha,
  resultadoIncerto,
  descartarCredenciais,
} from "@/services/usuarioAdminService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { useAuth } from "@/lib/AuthContext";

const STORAGE_KEY = "colunas_contas_acesso_v1";

export default function Usuarios() {
  const queryClient = useQueryClient();
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const { clienteId, user, logout } = useAuth();
  const sessaoKey = clienteId || user?.id || "anon";

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser", sessaoKey],
    queryFn: () => getCurrentUser(),
  });

  // SCALE-01: página keyset do servidor (busca `q` no backend), em vez de
  // baixar o tenant inteiro e filtrar no navegador.
  const fetchPage = useCallback(
    ({ limit, cursor, q }) => listarContasAcessoPagina({ limit, cursor, q: q || undefined }),
    [],
  );

  const controller = useCadastroBase1Controller({
    storageKey: STORAGE_KEY,
    columnIds: CONTAS_ACESSO_COLUNAS.map((c) => c.id),
    queryKey: ["contasAcesso", sessaoKey, "page"],
    fetchPage,
    searchPlaceholder: "Buscar contas…",
    duplicateLabelField: "login",
    exportFileName: "contas-acesso.csv",
    exportColumns: CONTAS_ACESSO_COLUNAS,
    getExportFieldValue: getContaAcessoFieldValue,
    getRecordTitle: (/** @type {any} */ item) =>
      item?.id ? item.nome || item.login || item.email || "Conta" : "Nova conta",
    getRecordCode: (/** @type {any} */ item) => item?.login || item?.email || undefined,
    getSearchHaystack: (/** @type {any} */ conta) =>
      [conta.login, conta.email, conta.nome, conta.full_name].filter(Boolean).join(" "),
    mapSearchSuggestion: (/** @type {any} */ conta) => ({
      id: String(conta.id || conta.login || conta.email),
      label: conta.nome || conta.login || conta.email || "Conta",
      secondary: conta.login || conta.email || undefined,
    }),
    matchRowId: (/** @type {any} */ conta, id) =>
      String(conta.id || conta.login || conta.email) === String(id),
    getRowId: (/** @type {any} */ conta) => String(conta.id || conta.login || conta.email),
    findRowById: (/** @type {any} */ rows, id) =>
      rows.find((c) => String(c.id || c.login || c.email) === String(id)),
    onSubmitRecord: (data) => submitRef.current(data),
    onRequestDeleteMutation: () => {},
  });

  const createMutation = useMutation({
    gcTime: 0,
    /** @param {object} data */
    mutationFn: (data) => criarContaAcesso(data),
    onSuccess: (criada) => {
      queryClient.invalidateQueries({ queryKey: ["contasAcesso", sessaoKey] });
      queryClient.invalidateQueries({ queryKey: ["usuarios", sessaoKey] });
      controller.recordHelpers.recordBeforeNewRef.current = null;
      if (criada?.id) {
        controller.recordHelpers.setEditingItem(contaPublica(criada));
        controller.recordHelpers.setIsEditing(false);
        controller.recordHelpers.setShowForm(true);
        controller.recordHelpers.chrome.setViewMode("record");
        controller.recordHelpers.chrome.onSelectionChange([String(criada.id)]);
      } else {
        controller.recordHelpers.closeForm();
      }
      toast.success("Conta criada!");
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Não foi possível salvar a conta."));
    },
    // A senha inicial digitada não fica retida nas variables da mutação.
    onSettled: (_r, _e, data) => descartarCredenciais(data),
  });

  const updateMutation = useMutation({
    // Sem retenção: a mutação sai do MutationCache assim que termina.
    gcTime: 0,
    /** @param {{ id: string, dados: object, propriaSenha: boolean }} vars */
    mutationFn: ({ id, dados }) => {
      validarPatchContaAcesso({ ...(currentUser || {}), id: user?.id }, /** @type {any} */ (controller.editingItem), dados);
      return atualizarContaAcesso(id, dados);
    },
    onSuccess: (atualizada, { id, dados, propriaSenha }) => {
      // S04-P1-R1: a ficha guarda só campos públicos (allowlist); senha atual
      // e nova nunca ficam em estado de tela, cache ou export.
      const base = controller.editingItem?.id === id ? controller.editingItem : {};
      if (propriaSenha) {
        // O servidor já encerrou TODAS as sessões desta conta, inclusive a
        // deste pedido (época +1). A tela não pode continuar autenticada:
        // sai pelo fluxo central (token, cache e empresa limpos) e o aviso
        // fica no Toaster da raiz, que sobrevive à troca para o login.
        controller.setEditingItem(contaPublica(base));
        controller.setIsEditing(false);
        toast.success("Senha alterada. Entre novamente com a nova senha.");
        logout();
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["contasAcesso", sessaoKey] });
      queryClient.invalidateQueries({ queryKey: ["usuarios", sessaoKey] });
      controller.setEditingItem(contaPublicaAposAtualizar(base, id, dados, atualizada));
      controller.setIsEditing(false);
      toast.success("Conta atualizada!");
    },
    onError: (error, { propriaSenha }) => {
      if (propriaSenha && resultadoIncerto(error)) {
        // Sem resposta não há como saber se a senha mudou: nada de sucesso
        // nem de logout automático. Se mudou, o servidor recusará a sessão.
        toast.error(
          "Não foi possível confirmar a troca de senha. Se a mudança tiver sido aplicada, você precisará entrar novamente com a nova senha.",
        );
        return;
      }
      toast.error(getApiErrorMessage(error, "Não foi possível salvar a conta."));
    },
    // Sucesso ou erro: o payload com senha não fica guardado nas variables.
    onSettled: (_r, _e, vars) => descartarCredenciais(vars?.dados),
  });

  submitRef.current = (dados) => {
    if (controller.editingItem?.id) {
      const id = controller.editingItem.id;
      // Decidido no envio, pelo ID autenticado: resposta lenta ou currentUser
      // atrasado não mudam se esta troca é da própria conta.
      updateMutation.mutate({ id, dados, propriaSenha: ehTrocaDaPropriaSenha(user?.id, id, dados) });
    } else {
      createMutation.mutate(dados);
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  const listErrorMessage = getApiErrorMessage(
    controller.listaQueryError,
    "Não foi possível carregar as contas nativas. Verifique se você está autenticado no MAK Gestão.",
  );

  const screenController = { ...controller, saving };

  return (
    <CadastroBase1Screen
      workspaceTitle="Usuários"
      createLabel="Novo"
      searchPlaceholder="Buscar contas…"
      formId={FORMULARIO_CONTA_ACESSO_ID}
      columnsForCardsToolbar={CONTAS_ACESSO_COLUNAS}
      controller={screenController}
      listErrorMessage={listErrorMessage}
      showDelete={false}
      deleteDialog={{
        title: "Exclusão indisponível",
        descriptionOne: "Contas nativas não podem ser excluídas — use desativar.",
        descriptionMany: () => "Contas nativas não podem ser excluídas.",
      }}
      recordForm={
        <FormularioContaAcesso
          key={`${controller.editingItem?.id ?? "conta-nova"}-${controller.formEpoch}`}
          variant="embedded"
          toolbarActions
          readOnly={!controller.isEditing}
          isSubmitting={saving}
          initialData={controller.editingItem}
          ehPropriaConta={ehContaPropria(user?.id, controller.editingItem?.id)}
          onSubmit={controller.handleSubmit}
          onCancel={controller.cancelForm}
        />
      }
      listSlot={
        <TabelaContasAcesso
          chromeLayout
          contas={controller.visibleRows}
          currentUser={currentUser}
          onEdit={controller.handleEdit}
          isLoading={controller.isLoading}
          showConfigColunas={controller.showConfigColunas}
          setShowConfigColunas={controller.setShowConfigColunas}
          searchQuery={controller.chrome.appliedSearch}
          resetFiltersKey={controller.chrome.resetFiltersKey}
          selectedIds={controller.chrome.selectedIds}
          onSelectionChange={controller.chrome.onSelectionChange}
          onFiltersActiveChange={controller.chrome.setFiltersActive}
          viewMode={controller.chrome.viewMode === "cards" ? "cards" : "table"}
          displayLimit={controller.chromeFooter?.displayLimit}
          onListMetrics={controller.chromeFooter?.onListMetrics}
          cardFields={controller.cardsPrefs.cardFields}
          cardsPerRow={controller.cardsPrefs.cardsPerRow}
          configureColumnsAnchorRef={controller.configureColumnsAnchorRef}
          matchesSearch={controller.matchesSearch}
        />
      }
    />
  );
}
