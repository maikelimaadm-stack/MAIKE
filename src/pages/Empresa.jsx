import React, { useCallback, useMemo, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import FormularioEmpresa, { FORMULARIO_EMPRESA_ID } from "@/components/empresa/FormularioEmpresa";
import TabelaEmpresas, { EMPRESAS_COLUNAS, getEmpresaFieldValue } from "@/components/empresa/TabelaEmpresas";
import { useCadastroBase1FullListController } from "@/hooks/useCadastroBase1FullListController";
import * as empresaService from "@/services/empresaService";
import { getApiErrorMessage, hasApiErrorCode, API_ERROR_CODES } from "@/apis/_core/ApiError";
import {
  notifyError,
  notifyExclusoesEmpilhadas,
  notifySuccess,
  notifyWarning,
} from "@/lib/maikeNotify";

const STORAGE_KEY = "colunas_empresas_v2";

const toastPersistenciaEmpresa = (registro, mensagemOk) => {
  if (registro?._isOffline || String(registro?.id || "").startsWith("offline_")) {
    toast.message("Pendente de sincronização — será enviada quando a conexão voltar.");
    return;
  }
  notifySuccess("Sucesso", mensagemOk);
};

export default function Empresa() {
  const queryClient = useQueryClient();
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const deleteRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));

  const fetchAll = useCallback(() => empresaService.listEmpresas(), []);

  const mesclarEmpresaNaLista = useCallback(
    (criada) => {
      if (!criada?.id || criada._isOffline) return;
      queryClient.setQueryData(["empresas"], (prev) => {
        const base = Array.isArray(prev) ? prev : [];
        const idx = base.findIndex((e) => e.id === criada.id);
        if (idx >= 0) {
          const next = base.slice();
          next[idx] = { ...base[idx], ...criada };
          return next;
        }
        return [...base, criada];
      });
    },
    [queryClient],
  );

  const controller = useCadastroBase1FullListController({
    storageKey: STORAGE_KEY,
    columnIds: EMPRESAS_COLUNAS.map((c) => c.id),
    queryKey: ["empresas"],
    fetchAll,
    duplicateLabelField: "nome",
    exportFileName: "empresas.csv",
    exportColumns: EMPRESAS_COLUNAS,
    getExportFieldValue: getEmpresaFieldValue,
    getRecordTitle: (/** @type {any} */ item) =>
      item?.id ? item.nome || item.apelido || "Empresa" : "Nova empresa",
    getRecordCode: (/** @type {any} */ item) => {
      const n = item?.numero_empresa;
      return n != null && Number(n) > 0 ? String(n) : undefined;
    },
    getSearchHaystack: (/** @type {any} */ e) =>
      [
        e.numero_empresa,
        e.nome,
        e.apelido,
        e.cidade,
        e.cpf,
        e.cnpj,
        e.email,
        e.telefone,
      ]
        .filter((v) => v != null && v !== "")
        .join(" "),
    mapSearchSuggestion: (/** @type {any} */ e) => ({
      id: String(e.id),
      label: e.apelido || e.nome || "Empresa",
      secondary:
        e.numero_empresa != null && Number(e.numero_empresa) > 0
          ? `Nº ${e.numero_empresa}`
          : e.nome || undefined,
    }),
    matchRowId: (/** @type {any} */ e, id) => String(e.id) === String(id),
    getRowId: (/** @type {any} */ e) => String(e.id),
    findRowById: (/** @type {any} */ rows, id) => rows.find((e) => String(e.id) === String(id)),
    onSubmitRecord: (data) => submitRef.current(data),
    onRequestDeleteMutation: (ids) => deleteRef.current(ids),
  });

  const createMutation = useMutation({
    /** @param {object} data */
    mutationFn: (data) => empresaService.createEmpresa(data),
    onSuccess: (criada) => {
      if (!criada?._isOffline && (!criada?.id || !(Number(criada.numero_empresa) > 0))) {
        notifyError("Atenção", "Resposta incompleta ao salvar. Recarregue a lista.");
        return;
      }
      mesclarEmpresaNaLista(criada);
      void queryClient.invalidateQueries({ queryKey: ["empresas"] }).finally(() => {
        mesclarEmpresaNaLista(criada);
      });
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
      toastPersistenciaEmpresa(criada, "Empresa cadastrada!");
    },
    onError: (error) => {
      if (hasApiErrorCode(error, API_ERROR_CODES.EMPRESA_NAME_CONFLICT)) {
        notifyWarning(
          "Atenção",
          getApiErrorMessage(error, "Já existe uma empresa com este nome neste tenant."),
        );
        return;
      }
      notifyWarning("Atenção", getApiErrorMessage(error, "Não foi possível cadastrar a empresa."));
    },
  });

  const updateMutation = useMutation({
    /** @param {{ id: string, data: object }} vars */
    mutationFn: ({ id, data }) => empresaService.updateEmpresa(id, data),
    /** @param {object} atualizada @param {{ id: string, data: object }} vars */
    onSuccess: (atualizada, { id, data }) => {
      mesclarEmpresaNaLista(atualizada);
      void queryClient.invalidateQueries({ queryKey: ["empresas"] }).finally(() => {
        mesclarEmpresaNaLista(atualizada);
      });
      const merged = {
        ...(controller.editingItem?.id === id ? controller.editingItem : {}),
        id,
        ...data,
        ...(atualizada && typeof atualizada === "object" ? atualizada : {}),
      };
      controller.setEditingItem(merged);
      controller.setIsEditing(false);
      if (atualizada?.id) controller.chrome.onSelectionChange([String(atualizada.id)]);
      toastPersistenciaEmpresa(atualizada, "Empresa atualizada!");
    },
    onError: (error) => {
      if (hasApiErrorCode(error, API_ERROR_CODES.EMPRESA_NAME_CONFLICT)) {
        notifyWarning(
          "Atenção",
          getApiErrorMessage(error, "Já existe uma empresa com este nome neste tenant."),
        );
        return;
      }
      notifyWarning("Atenção", getApiErrorMessage(error, "Não foi possível atualizar a empresa."));
    },
  });

  const deleteMutation = useMutation({
    /** @param {string[]} ids */
    mutationFn: (ids) => empresaService.excluirEmpresas(ids),
    /** @param {{ excluidos: string[], bloqueados: { id: string, erro: unknown }[] }} result */
    onSuccess: ({ excluidos, bloqueados }) => {
      queryClient.invalidateQueries({ queryKey: ["empresas"] });
      const blockedIds = new Set(bloqueados.map((b) => String(b.id)));
      const remainingSelection = (controller.chrome.selectedIds || []).filter((id) =>
        blockedIds.has(String(id)),
      );
      controller.chrome.setSelectedIds(remainingSelection);
      if (
        controller.showForm &&
        controller.editingItem?.id &&
        excluidos.some((id) => String(id) === String(controller.editingItem.id))
      ) {
        controller.recordHelpers.closeForm();
      }
      if (excluidos.length) {
        notifyExclusoesEmpilhadas(excluidos.length, { singular: "Empresa excluída" });
      }
      if (bloqueados.length) {
        notifyError(
          "Atenção",
          bloqueados.length === 1
            ? getApiErrorMessage(
                bloqueados[0].erro,
                "Esta empresa não pôde ser excluída — pode haver registros vinculados.",
              )
            : `${bloqueados.length} empresas não puderam ser excluídas.`,
        );
      }
    },
    onError: (err) => {
      controller.setDeleteState({ open: false, ids: [] });
      notifyError("Atenção", getApiErrorMessage(err, "Não foi possível excluir."));
    },
  });

  submitRef.current = (data) => {
    const editing = /** @type {any} */ (controller.editingItem);
    if (editing?.id) {
      updateMutation.mutate({ id: editing.id, data });
      return;
    }
    createMutation.mutate(data);
  };
  deleteRef.current = (ids) => deleteMutation.mutate(ids);

  const saving = createMutation.isPending || updateMutation.isPending;

  const listErrorMessage = useMemo(
    () =>
      getApiErrorMessage(
        controller.listaQueryError,
        "Não foi possível carregar as empresas. Verifique sua conexão e tente novamente.",
      ),
    [controller.listaQueryError],
  );

  const editingRecord = /** @type {any} */ (controller.editingItem);
  const recordCode =
    editingRecord?.numero_empresa != null && Number(editingRecord.numero_empresa) > 0
      ? String(editingRecord.numero_empresa)
      : undefined;

  const screenController = { ...controller, saving };

  return (
    <CadastroBase1Screen
      workspaceTitle="Empresas"
      searchPlaceholder="Buscar empresas…"
      formId={FORMULARIO_EMPRESA_ID}
      columnsForCardsToolbar={EMPRESAS_COLUNAS}
      controller={screenController}
      listErrorMessage={listErrorMessage}
      recordCode={recordCode}
      deleteDialog={{
        title: "Confirmar exclusão",
        descriptionOne: "Deseja excluir esta empresa? A ação pode falhar se houver registros vinculados.",
        descriptionMany: (n) => `Deseja excluir ${n} empresas selecionadas?`,
      }}
      recordForm={
        <FormularioEmpresa
          key={`${controller.editingItem?.id ?? "empresa-nova"}-${controller.formEpoch}`}
          variant="embedded"
          toolbarActions
          readOnly={!controller.isEditing}
          isSubmitting={saving}
          initialData={controller.editingItem}
          isEditing={!!editingRecord?.id}
          onSubmit={controller.handleSubmit}
          onCancel={controller.cancelForm}
        />
      }
      listSlot={
        <TabelaEmpresas
          empresas={controller.visibleRows}
          onEdit={controller.handleEdit}
          isLoading={controller.isLoading}
          showConfigColunas={controller.showConfigColunas}
          setShowConfigColunas={controller.setShowConfigColunas}
          searchQuery={controller.chrome.appliedSearch}
          resetFiltersKey={controller.chrome.resetFiltersKey}
          onSelectionChange={controller.chrome.onSelectionChange}
          onFiltersActiveChange={controller.chrome.setFiltersActive}
          viewMode={controller.chrome.viewMode === "cards" ? "cards" : "table"}
          cardFields={controller.cardsPrefs.cardFields}
          cardsPerRow={controller.cardsPrefs.cardsPerRow}
          configureColumnsAnchorRef={controller.configureColumnsAnchorRef}
          matchesSearch={controller.matchesSearch}
        />
      }
    />
  );
}
