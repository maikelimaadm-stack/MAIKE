import React, { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import FormularioContaAcesso, { FORMULARIO_CONTA_ACESSO_ID } from "@/components/usuarios/FormularioContaAcesso";
import TabelaContasAcesso, {
  CONTAS_ACESSO_COLUNAS,
  getContaAcessoFieldValue,
} from "@/components/usuarios/TabelaContasAcesso";
import { useCadastroBase1FullListController } from "@/hooks/useCadastroBase1FullListController";
import { getCurrentUser } from "@/services/sessionService";
import {
  listarContasAcesso,
  criarContaAcesso,
  atualizarContaAcesso,
  validarPatchContaAcesso,
} from "@/services/usuarioAdminService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { useAuth } from "@/lib/AuthContext";

const STORAGE_KEY = "colunas_contas_acesso_v1";

export default function Usuarios() {
  const queryClient = useQueryClient();
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const { clienteId, user } = useAuth();
  const sessaoKey = clienteId || user?.id || "anon";

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser", sessaoKey],
    queryFn: () => getCurrentUser(),
  });

  const fetchAll = useCallback(() => listarContasAcesso(), []);

  const controller = useCadastroBase1FullListController({
    storageKey: STORAGE_KEY,
    columnIds: CONTAS_ACESSO_COLUNAS.map((c) => c.id),
    queryKey: ["contasAcesso", sessaoKey],
    fetchAll,
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
    /** @param {object} data */
    mutationFn: (data) => criarContaAcesso(data),
    onSuccess: (criada) => {
      queryClient.invalidateQueries({ queryKey: ["contasAcesso", sessaoKey] });
      queryClient.invalidateQueries({ queryKey: ["usuarios", sessaoKey] });
      controller.recordHelpers.recordBeforeNewRef.current = null;
      if (criada?.id) {
        controller.recordHelpers.setEditingItem(criada);
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
  });

  const updateMutation = useMutation({
    /** @param {{ id: string, dados: object }} vars */
    mutationFn: ({ id, dados }) => {
      validarPatchContaAcesso(currentUser, /** @type {any} */ (controller.editingItem), dados);
      return atualizarContaAcesso(id, dados);
    },
    onSuccess: (atualizada, { id, dados }) => {
      queryClient.invalidateQueries({ queryKey: ["contasAcesso", sessaoKey] });
      queryClient.invalidateQueries({ queryKey: ["usuarios", sessaoKey] });
      const merged = {
        ...(controller.editingItem?.id === id ? controller.editingItem : {}),
        id,
        ...dados,
        ...(atualizada && typeof atualizada === "object" ? atualizada : {}),
      };
      controller.setEditingItem(merged);
      controller.setIsEditing(false);
      toast.success("Conta atualizada!");
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Não foi possível salvar a conta."));
    },
  });

  submitRef.current = (dados) => {
    if (controller.editingItem?.id) {
      updateMutation.mutate({ id: controller.editingItem.id, dados });
    } else {
      createMutation.mutate(dados);
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  const listErrorMessage = getApiErrorMessage(
    controller.listaQueryError,
    "Não foi possível carregar as contas nativas. Verifique se você está autenticado no backend MAIKE.",
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
