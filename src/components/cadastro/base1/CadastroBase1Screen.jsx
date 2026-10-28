import React from "react";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import CadastroRecordHeader from "@/components/cadastro/base1/CadastroRecordHeader";
import { Base1CardsToolbar } from "@/components/cadastro/base1/Base1Cards";
import { PillBtn } from "@/components/cadastro/base1/Base1Ui";
import { Check, X } from "lucide-react";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";

/**
 * Composição compartilhada Motor Base1 — workspace + chrome + registro.
 * Lista (grade) e formulário vêm por slot do adapter de domínio.
 *
 * @param {{
 *   workspaceTitle: string,
 *   searchPlaceholder: string,
 *   createLabel?: string,
 *   attachDisabledReason?: string,
 *   formId?: string,
 *   columnsForCardsToolbar: object[],
 *   controller: import('@/hooks/useCadastroBase1Controller').CadastroBase1ControllerSurface,
 *   listErrorMessage?: string,
 *   recordForm: React.ReactNode,
 *   listSlot: React.ReactNode,
 *   deleteDialog: { title: string, descriptionOne: string, descriptionMany: (n: number) => string },
 *   recordCode?: string,
 * }} props
 */
export default function CadastroBase1Screen({
  workspaceTitle,
  searchPlaceholder,
  createLabel = "Novo",
  attachDisabledReason = "Anexos disponíveis quando o cadastro tiver auditoria nativa.",
  formId,
  columnsForCardsToolbar,
  controller: c,
  listErrorMessage,
  recordForm,
  listSlot,
  deleteDialog,
  recordCode,
}) {
  return (
    <>
      <CadastroWorkspace mode="list" title={workspaceTitle} {...BASE1_LISTA_INTEGRADA_VISUAL.workspace}>
        {c.listaErro && !c.listaFetching && listErrorMessage ? (
          <div className="cadastro-b1 mg-card p-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 mb-2 flex flex-wrap items-center gap-2">
            <span>{listErrorMessage}</span>
            <button type="button" className="tb-btn tb-btn-gray" onClick={() => c.recarregarLista()}>
              Tentar novamente
            </button>
          </div>
        ) : null}
        <CadastroListaChrome
          {...BASE1_LISTA_INTEGRADA_VISUAL.chrome}
          recordMode={c.showForm}
          recordEditing={c.isEditing}
          secondaryToolsLocked={c.showForm && c.isEditing}
          recordToolbar={
            c.showForm && c.isEditing && formId ? (
              <>
                <PillBtn type="submit" form={formId} disabled={c.saving}>
                  <Check className="h-4 w-4" aria-hidden />
                  {c.saving ? "Salvando…" : "Salvar"}
                </PillBtn>
                <PillBtn type="button" tone="gray" onClick={c.cancelForm} disabled={c.saving}>
                  <X className="h-4 w-4" aria-hidden />
                  Cancelar
                </PillBtn>
              </>
            ) : null
          }
          recordHeader={
            c.showForm ? (
              <CadastroRecordHeader
                title={c.detailTitle}
                code={recordCode}
                index={c.recordIndex}
                total={c.recordNavRows.length}
                onGo={
                  c.editingItem && typeof c.editingItem === "object" && "id" in c.editingItem && c.editingItem.id
                    ? c.goRecord
                    : undefined
                }
                navDisabled={c.showForm && c.isEditing}
              />
            ) : null
          }
          recordBody={c.showForm ? recordForm : null}
          attachDisabledReason={attachDisabledReason}
          selectedCount={c.chrome.selectedIds.length}
          {...c.chromeFooter}
          createLabel={createLabel}
          onNew={c.openNew}
          onEdit={c.handleEditSelected}
          onDuplicate={c.handleDuplicateSelected}
          onDelete={c.handleDeleteSelected}
          onExportCsv={c.exportCsv}
          onPrint={() => window.print()}
          cardsModeAvailable
          cardsToolbar={
            <Base1CardsToolbar columns={columnsForCardsToolbar} cardsPrefs={c.cardsPrefs} />
          }
          searchValue={c.chrome.searchInput}
          onSearchChange={c.handleSearchInputChange}
          onSearchApply={c.handleSearchApply}
          searchCommittedValue={c.chrome.appliedSearch}
          searchActive={c.chrome.searchActive || Boolean(c.searchPickId)}
          searchPlaceholder={searchPlaceholder}
          searchSuggestions={c.searchSuggestions}
          onSearchSuggestionPick={c.handleSearchSuggestionPick}
          configureColumnsAnchorRef={c.configureColumnsAnchorRef}
          onConfigureColumns={() => c.setShowConfigColunas(true)}
          onClearFilters={c.handleClearFilters}
          filtersActive={c.chrome.filtersActive || c.chrome.searchActive || Boolean(c.searchPickId)}
          viewMode={c.showForm ? "record" : c.chrome.viewMode}
          onViewModeChange={c.onViewModeChange}
        >
          {!c.showForm ? listSlot : null}
        </CadastroListaChrome>
      </CadastroWorkspace>

      <ConfirmDialog
        open={c.deleteState.open}
        onOpenChange={(open) => c.setDeleteState((prev) => ({ ...prev, open }))}
        title={deleteDialog.title}
        description={
          c.deleteState.ids.length > 1
            ? deleteDialog.descriptionMany(c.deleteState.ids.length)
            : deleteDialog.descriptionOne
        }
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={c.handleConfirmDelete}
      />
    </>
  );
}
