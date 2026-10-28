import React, { useMemo, useRef, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  FilterX,
  Copy,
  Paperclip,
  Columns3,
  LayoutGrid,
  ListChecks,
  ChevronsDown,
  ListPlus,
  ListX,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import CadastroSearchPill from "./CadastroSearchPill";
import {
  B1Popover,
  FluidSlot,
  IconBtn,
  IconeRaio,
  MenuList,
  MgSelect,
  PillBtn,
  ViewSwitch,
} from "./Base1Ui";
import { CADASTRO_B1_PAGE_SIZES } from "./cadastroBase1List";
import { PortalComprasSkinProvider } from "./portalComprasSkinContext";
import { cn } from "@/lib/utils";

/**
 * Chrome de listagem estilo Modelo Base1 (frota/equipamentos — CONTROLE-DE-ESTOQUE).
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.children
 * @param {number} [props.selectedCount]
 * @param {number} [props.listados]
 * @param {number} [props.filtrados]
 * @param {number} [props.totais]
 * @param {() => void} [props.onNew]
 * @param {() => void} [props.onEdit]
 * @param {() => void} [props.onDelete]
 * @param {() => void} [props.onDuplicate]
 * @param {string} [props.createLabel]
 * @param {string} [props.searchValue]
 * @param {(v: string) => void} [props.onSearchChange]
 * @param {() => void} [props.onSearchApply]
 * @param {string} [props.searchCommittedValue] valor já aplicado (Cancelar restaura)
 * @param {boolean} [props.searchActive]
 * @param {string} [props.searchPlaceholder]
 * @param {{ id: string; label: string; secondary?: string }[]} [props.searchSuggestions]
 * @param {(item: { id: string; label: string; secondary?: string }) => void} [props.onSearchSuggestionPick]
 * @param {() => void} [props.onConfigureColumns]
 * @param {() => void} [props.onClearFilters]
 * @param {boolean} [props.filtersActive]
 * @param {'record'|'table'|'cards'} [props.viewMode]
 * @param {(m: 'record'|'table'|'cards') => void} [props.onViewModeChange]
 * @param {boolean} [props.recordModeAvailable]
 * @param {boolean} [props.cardsModeAvailable]
 * @param {string} [props.filterRailHint]
 * @param {import('react').ReactNode} [props.filterChips]
 * @param {import('react').ReactNode} [props.extraToolbar]
 * @param {() => void} [props.onExportCsv]
 * @param {() => void} [props.onPrint]
 * @param {number} [props.pageSize]
 * @param {(n: number) => void} [props.onPageSizeChange]
 * @param {boolean} [props.hasMore]
 * @param {boolean} [props.loadingMore]
 * @param {() => void} [props.onLoadMore]
 * @param {string} [props.attachDisabledReason]
 * @param {() => void} [props.onAttach]
 * @param {boolean} [props.recordMode] modo registro (sem faixa de filtros / grade — corpo embutido)
 * @param {boolean} [props.recordEditing] em `recordMode`, true = `recordToolbar` (Salvar/Cancelar); false = toolbar de lista (leitura)
 * @param {import('react').ReactNode} [props.recordToolbar] barra de ações do registro (substitui Novo/Editar/…)
 * @param {import('react').ReactNode} [props.recordHeader] cabeçalho bookmark + navegação
 * @param {import('react').ReactNode} [props.recordBody] conteúdo rolável do registro
 * @param {boolean} [props.secondaryToolsLocked] oculta busca/alternador/menu (edição ou subfluxo ativo)
 * @param {import('react').ReactNode} [props.cardsToolbar] botões layout/campos dos cards (modo cards)
 * @param {import('react').RefObject<HTMLButtonElement | null>} [props.configureColumnsAnchorRef] âncora do popover de colunas (modo tabela)
 * @param {boolean} [props.showFilterRail] faixa `mg-pills-rail` (chips); false no piloto Marcas (limpar filtros só no menu ⋮)
 * @param {boolean} [props.joinTableToolbar] toolbar + grade no mesmo `mg-shell` (Portal de Compras / itpan)
 * @param {boolean} [props.portalComprasSkin] régua visual portal compras (toolbar 25px, fpop/mdl marcados)
 */
export default function CadastroListaChrome({
  children,
  selectedCount = 0,
  listados = 0,
  filtrados = 0,
  totais = 0,
  onNew,
  onEdit,
  onDelete,
  onDuplicate,
  createLabel = "Novo",
  searchValue = "",
  onSearchChange,
  onSearchApply,
  searchCommittedValue = "",
  searchActive = false,
  searchPlaceholder,
  searchSuggestions = [],
  onSearchSuggestionPick,
  onConfigureColumns,
  onClearFilters,
  filtersActive = false,
  viewMode = "table",
  onViewModeChange,
  recordModeAvailable = true,
  cardsModeAvailable = false,
  filterRailHint = null,
  filterChips = null,
  extraToolbar = null,
  onExportCsv,
  onPrint,
  pageSize = 100,
  onPageSizeChange,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  attachDisabledReason = "Anexos disponíveis quando o cadastro tiver auditoria nativa.",
  onAttach,
  recordMode = false,
  recordEditing = true,
  recordToolbar = null,
  recordHeader = null,
  recordBody = null,
  secondaryToolsLocked = false,
  cardsToolbar = null,
  configureColumnsAnchorRef = null,
  showFilterRail = true,
  joinTableToolbar = false,
  portalComprasSkin = false,
}) {
  const oneSelected = selectedCount === 1;
  const anySelected = selectedCount > 0;
  const [showChips, setShowChips] = useState(true);
  const [cardsPanel, setCardsPanel] = useState(null);
  const [maisOpcoesOpen, setMaisOpcoesOpen] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(() => {
    if (joinTableToolbar) return false;
    return Boolean(searchValue);
  });
  const stripRef = useRef(null);
  const railEnabled = showFilterRail && !recordMode;
  const skinAtivo = portalComprasSkin && joinTableToolbar;

  const pageSizeOptions = useMemo(
    () => CADASTRO_B1_PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) })),
    [],
  );

  const cardsToolsInMenu = Boolean(cardsToolbar);
  const attachTitle =
    attachDisabledReason ?? (oneSelected ? "Anexos" : "Selecione um registro");
  const showAttachControl = Boolean(onAttach);

  const menuItems = useMemo(
    () => [
      {
        key: "attach-info",
        label: "Anexos",
        icon: <Paperclip className="h-4 w-4" />,
        disabled: true,
        title: attachTitle,
        hidden: showAttachControl || !attachDisabledReason,
      },
      {
        key: "export",
        label: "Exportar (CSV)",
        disabled: !onExportCsv,
      },
      { key: "print", label: "Imprimir", disabled: !onPrint },
      {
        key: "cfg",
        label: "Configurar colunas",
        icon: <Columns3 className="h-4 w-4" />,
        disabled: !onConfigureColumns || viewMode !== "table",
      },
      {
        key: "cards-layout",
        label: "Layout dos cards",
        icon: <LayoutGrid className="h-4 w-4" />,
        disabled: !cardsToolsInMenu || viewMode !== "cards",
      },
      {
        key: "card-fields",
        label: "Campos dos cards",
        icon: <ListChecks className="h-4 w-4" />,
        disabled: !cardsToolsInMenu || viewMode !== "cards",
      },
    ].filter((item) => !item.hidden),
    [
      showAttachControl,
      attachDisabledReason,
      attachTitle,
      onExportCsv,
      onPrint,
      onConfigureColumns,
      cardsToolsInMenu,
      viewMode,
    ],
  );

  const onMenu = (k) => {
    if (k === "export") onExportCsv?.();
    if (k === "print") (onPrint ?? (() => window.print()))();
    if (k === "cfg") {
      setMaisOpcoesOpen(false);
      onConfigureColumns?.();
    }
    if (k === "cards-layout") {
      setCardsPanel("layout");
    }
    if (k === "card-fields") {
      setCardsPanel("fields");
    }
  };

  const cardsToolbarHosted =
    cardsToolbar && viewMode === "cards" && React.isValidElement(cardsToolbar)
      ? React.cloneElement(cardsToolbar, {
          layoutOpen: cardsPanel === "layout",
          onLayoutOpenChange: (o) => setCardsPanel(o ? "layout" : null),
          fieldsOpen: cardsPanel === "fields",
          onFieldsOpenChange: (o) => setCardsPanel(o ? "fields" : null),
        })
      : null;

  const scrollStrip = (dx) => stripRef.current?.scrollBy({ left: dx, behavior: "smooth" });

  const recordViewing = recordMode && !recordEditing;
  const showListPrimaryToolbar = !recordMode || recordViewing;

  const maisOpcoesPopover = !secondaryToolsLocked ? (
    <div className="relative mg-toolbar__more">
      {onConfigureColumns ? (
        <span
          ref={configureColumnsAnchorRef}
          data-testid="b1-col-config-trigger"
          className="pointer-events-none absolute bottom-0 right-0 h-px w-px overflow-hidden"
          aria-hidden="true"
        />
      ) : null}
      <B1Popover
        open={maisOpcoesOpen}
        onOpenChange={setMaisOpcoesOpen}
        className={cn(
          "flex w-64 min-w-[12rem] flex-col p-1.5",
          skinAtivo && "b1-portal-compras",
        )}
        trigger={
          <IconBtn aria-label="Mais opções" title="Mais opções">
            <IconeRaio className="h-4 w-4" />
          </IconBtn>
        }
      >
        <MenuList
          items={menuItems}
          onPick={(k) => {
            setMaisOpcoesOpen(false);
            onMenu(k);
          }}
        />
      </B1Popover>
    </div>
  ) : null;

  const joinedShell = joinTableToolbar;

  const listBodyClass = recordMode
    ? "mg-form-scroll min-h-0 flex-1 overflow-auto p-3"
    : viewMode === "cards"
      ? "mg-shell__scroll min-h-0 flex-1 p-2.5"
      : "mg-shell__body min-h-0 flex-1";

  const recordHeaderNode =
    recordMode && recordHeader && React.isValidElement(recordHeader)
      ? React.cloneElement(recordHeader, { joinShell: joinedShell })
      : recordHeader;

  const shellBody = recordMode ? (
    <>
      {recordHeaderNode}
      <div className={listBodyClass}>{recordBody}</div>
    </>
  ) : (
    <div className={listBodyClass}>{children}</div>
  );

  const toolbarRow = (
    <div
      data-testid="b1-toolbar"
      className={cn(
        joinedShell
          ? "mg-toolbar mg-toolbar--join mg-toolbar--responsive no-print"
          : "mg-toolbar mg-card flex-wrap no-print",
        searchExpanded && "is-search-expanded",
      )}
    >
      <div className="mg-toolbar__row mg-toolbar__row--actions">
        <FluidSlot open={showListPrimaryToolbar} className="mg-fluid-slot--primary">
          <div className="mg-fluid-slot__cluster">
            {onNew ? (
              <PillBtn type="button" onClick={onNew} tabIndex={showListPrimaryToolbar ? undefined : -1}>
                <Plus className="h-4 w-4" aria-hidden />
                {createLabel}
              </PillBtn>
            ) : null}
            {extraToolbar}
            {onEdit || onDuplicate || onDelete ? (
              <FluidSlot open={anySelected} className="mg-fluid-slot--cluster">
                <div className="mg-fluid-slot__cluster">
                  {onEdit ? (
                    <PillBtn
                      type="button"
                      tone="gray"
                      onClick={onEdit}
                      disabled={!oneSelected}
                      tabIndex={showListPrimaryToolbar && oneSelected ? undefined : -1}
                      className={cn("mg-toolbar__action--wide", !oneSelected && "mg-fluid-slot__ghost")}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      Editar
                    </PillBtn>
                  ) : null}
                  {onDuplicate ? (
                    <PillBtn
                      type="button"
                      tone="gray"
                      onClick={onDuplicate}
                      disabled={!oneSelected}
                      tabIndex={showListPrimaryToolbar && oneSelected ? undefined : -1}
                      className={cn("mg-toolbar__action--wide", !oneSelected && "mg-fluid-slot__ghost")}
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden />
                      Duplicar
                    </PillBtn>
                  ) : null}
                  {onDelete ? (
                    <PillBtn
                      type="button"
                      tone="red"
                      onClick={onDelete}
                      tabIndex={showListPrimaryToolbar && anySelected ? undefined : -1}
                      className="mg-toolbar__action--wide"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                      Excluir
                      {selectedCount > 1 ? ` (${selectedCount})` : ""}
                    </PillBtn>
                  ) : null}
                </div>
              </FluidSlot>
            ) : null}
          </div>
        </FluidSlot>
        <FluidSlot open={Boolean(recordMode && recordEditing && recordToolbar)}>
          <div className="mg-fluid-slot__cluster">{recordToolbar}</div>
        </FluidSlot>
      </div>
      {!secondaryToolsLocked && joinedShell ? (
        <div className="mg-toolbar__btns ml-auto flex items-center justify-end">
          {onClearFilters ? (
            <FluidSlot open={filtersActive}>
              <IconBtn
                aria-label="Limpar filtros"
                title="Limpar filtros"
                className="is-filter-active"
                onClick={onClearFilters}
                tabIndex={filtersActive ? undefined : -1}
                data-testid="b1-clear-filters"
              >
                <FilterX className="h-4 w-4" aria-hidden />
              </IconBtn>
            </FluidSlot>
          ) : null}
          {onSearchChange ? (
            <div
              className="mg-toolbar__row mg-toolbar__row--search"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setSearchExpanded(false);
                }
              }}
            >
              {searchExpanded ? (
                <CadastroSearchPill
                  value={searchValue}
                  onChange={onSearchChange}
                  onApply={onSearchApply}
                  committedValue={searchCommittedValue}
                  active={searchActive}
                  placeholder={searchPlaceholder}
                  autoFocus
                  suggestions={searchSuggestions}
                  onPickSuggestion={onSearchSuggestionPick}
                />
              ) : (
                <IconBtn
                  aria-label="Abrir pesquisa"
                  title="Pesquisar"
                  onClick={() => setSearchExpanded(true)}
                >
                  <Search className="h-4 w-4" aria-hidden />
                </IconBtn>
              )}
            </div>
          ) : null}
          {showAttachControl ? (
            <IconBtn
              aria-label="Anexos"
              title={attachTitle}
              disabled={!oneSelected || !onAttach}
              onClick={() => onAttach?.()}
              data-testid="b1-attach"
            >
              <Paperclip className="h-4 w-4" aria-hidden />
            </IconBtn>
          ) : null}
          {onViewModeChange ? (
            <div className="mg-toolbar__row mg-toolbar__row--views">
              <ViewSwitch
                value={viewMode}
                recordDisabled={!recordModeAvailable}
                cardsDisabled={!cardsModeAvailable}
                onChange={onViewModeChange}
              />
            </div>
          ) : null}
          {maisOpcoesPopover}
        </div>
      ) : (
        <div className="mg-toolbar__btns ml-auto flex items-center flex-wrap">
          {!secondaryToolsLocked && onClearFilters ? (
            <FluidSlot open={filtersActive}>
              <IconBtn
                aria-label="Limpar filtros"
                title="Limpar filtros"
                className="is-filter-active"
                onClick={onClearFilters}
                tabIndex={filtersActive ? undefined : -1}
                data-testid="b1-clear-filters"
              >
                <FilterX className="h-4 w-4" aria-hidden />
              </IconBtn>
            </FluidSlot>
          ) : null}
          {showAttachControl ? (
            <IconBtn
              aria-label="Anexos"
              title={attachTitle}
              disabled={!oneSelected || !onAttach}
              onClick={() => onAttach?.()}
              data-testid="b1-attach"
            >
              <Paperclip className="h-4 w-4" aria-hidden />
            </IconBtn>
          ) : null}
          {!secondaryToolsLocked && onSearchChange ? (
            <CadastroSearchPill
              value={searchValue}
              onChange={onSearchChange}
              onApply={onSearchApply}
              committedValue={searchCommittedValue}
              active={searchActive}
              placeholder={searchPlaceholder}
              suggestions={searchSuggestions}
              onPickSuggestion={onSearchSuggestionPick}
            />
          ) : null}
          {!secondaryToolsLocked && onViewModeChange ? (
            <ViewSwitch
              value={viewMode}
              recordDisabled={!recordModeAvailable}
              cardsDisabled={!cardsModeAvailable}
              onChange={onViewModeChange}
            />
          ) : null}
          {maisOpcoesPopover}
        </div>
      )}
    </div>
  );

  const pillsRail = railEnabled ? (
    <div
      className={`mg-rail no-print mg-pills-rail ${joinedShell ? "mg-rail--join" : "mg-card"} ${showChips ? "is-expanded" : "is-collapsed"}`}
    >
      <IconBtn
        size="sm"
        aria-expanded={showChips}
        aria-label={showChips ? "Recolher faixa de filtros" : "Mostrar faixa de filtros"}
        title={showChips ? "Recolher faixa de filtros" : "Mostrar faixa de filtros"}
        active={showChips}
        onClick={() => setShowChips((v) => !v)}
      >
        {showChips ? <ListX className="h-4 w-4" /> : <ListPlus className="h-4 w-4" />}
      </IconBtn>
      <div className="mg-pills-rail__content" aria-hidden={!showChips}>
        <IconBtn size="sm" aria-label="Rolar filtros para a esquerda" onClick={() => scrollStrip(-240)}>
          <ChevronLeft className="h-4 w-4" />
        </IconBtn>
        <div
          ref={stripRef}
          className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none]"
        >
          {filterChips}
          {!filterChips ? (
            <span className="mg-pills-rail__hint">
              {filterRailHint ??
                (cardsModeAvailable
                  ? "Filtros no menu ⋮ da grade; modo cards no alternador à direita."
                  : "Filtros por coluna na grade (menu ⋮ no cabeçalho).")}
            </span>
          ) : null}
        </div>
        <IconBtn size="sm" aria-label="Rolar filtros para a direita" onClick={() => scrollStrip(240)}>
          <ChevronRight className="h-4 w-4" />
        </IconBtn>
        {onClearFilters ? (
          <IconBtn
            size="sm"
            aria-label="Limpar todos os filtros"
            title="Limpar todos os filtros"
            disabled={!filtersActive}
            className={filtersActive ? "is-filter-active" : undefined}
            onClick={onClearFilters}
          >
            <FilterX className="h-4 w-4" />
          </IconBtn>
        ) : null}
        <span className="mx-1 h-5 w-px bg-[var(--mg-divider)]" aria-hidden />
      </div>
    </div>
  ) : null;

  const listSummary = (
    <div className="mg-summary no-print">
      <div className="mg-summary__counts">
        <span className="mg-summary__item">Selecionados: {selectedCount}</span>
        <span className="mg-summary__item">Listados: {listados}</span>
        <span className="mg-summary__item">Filtrados: {filtrados}</span>
        <span className="mg-summary__item">Totais: {totais}</span>
      </div>
      {onPageSizeChange || onLoadMore ? (
        <span className="mg-summary__footer-actions">
          {onPageSizeChange ? (
            <MgSelect
              ariaLabel="Quantidade de registros por carregamento"
              className="mg-pill-select"
              wrapClassName="mg-pill-select-wrap"
              contentClassName="mg-pill-select-panel min-w-[var(--radix-popover-trigger-width)]"
              popoverSide="top"
              value={String(pageSize)}
              options={pageSizeOptions}
              onChange={(v) => onPageSizeChange(Number(v))}
            />
          ) : null}
          {onLoadMore ? (
            <IconBtn
              aria-label="Carregar mais registros"
              title="Carregar mais registros"
              disabled={!hasMore || loadingMore}
              onClick={onLoadMore}
            >
              <ChevronsDown aria-hidden />
            </IconBtn>
          ) : null}
        </span>
      ) : null}
    </div>
  );

  return (
    <PortalComprasSkinProvider active={skinAtivo}>
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col gap-2",
        skinAtivo && "cadastro-b1--portal-compras",
      )}
      data-testid="b1-list"
      data-cadastro-chrome
    >
      {!joinedShell ? toolbarRow : null}
      {!joinedShell ? pillsRail : null}

      <div className="flex min-h-0 flex-1 gap-2">
        <div
          className={cn(
            "mg-shell mg-shell--fill min-h-0 min-w-0 flex-1",
            joinedShell && "mg-shell--join-table",
          )}
        >
          {joinedShell ? toolbarRow : null}
          {joinedShell ? pillsRail : null}
          {shellBody}
          {listSummary}
        </div>
      </div>

      {cardsToolbarHosted ? (
        <div className="sr-only" aria-hidden="true">{cardsToolbarHosted}</div>
      ) : null}
    </div>
    </PortalComprasSkinProvider>
  );
}
