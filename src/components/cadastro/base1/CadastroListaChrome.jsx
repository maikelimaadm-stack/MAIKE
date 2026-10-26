import React, { useMemo, useRef, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  FilterX,
  Copy,
  Paperclip,
  MoreHorizontal,
  ChevronsDown,
  ListPlus,
  ListX,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import CadastroSearchPill from "./CadastroSearchPill";
import { B1Popover, IconBtn, MenuList, MgSelect, PillBtn, ViewSwitch } from "./Base1Ui";
import { CADASTRO_B1_PAGE_SIZES } from "./cadastroBase1List";

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
 * @param {boolean} [props.searchActive]
 * @param {string} [props.searchPlaceholder]
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
 * @param {import('react').ReactNode} [props.recordToolbar] barra de ações do registro (substitui Novo/Editar/…)
 * @param {import('react').ReactNode} [props.recordHeader] cabeçalho bookmark + navegação
 * @param {import('react').ReactNode} [props.recordBody] conteúdo rolável do registro
 * @param {boolean} [props.secondaryToolsLocked] oculta busca/alternador/menu (edição ou subfluxo ativo)
 * @param {import('react').ReactNode} [props.cardsToolbar] botões layout/campos dos cards (modo cards)
 * @param {import('react').RefObject<HTMLButtonElement | null>} [props.configureColumnsAnchorRef] âncora do popover de colunas (modo tabela)
 * @param {boolean} [props.showFilterRail] faixa `mg-pills-rail` (chips); false = ferramentas na toolbar (piloto Marcas)
 * @param {boolean} [props.joinTableToolbar] toolbar + grade no mesmo `mg-shell` (Portal de Compras / itpan)
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
  searchActive = false,
  searchPlaceholder,
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
  recordToolbar = null,
  recordHeader = null,
  recordBody = null,
  secondaryToolsLocked = false,
  cardsToolbar = null,
  configureColumnsAnchorRef = null,
  showFilterRail = true,
  joinTableToolbar = false,
}) {
  const oneSelected = selectedCount === 1;
  const anySelected = selectedCount > 0;
  const [showChips, setShowChips] = useState(true);
  const [cardsPanel, setCardsPanel] = useState(null);
  const stripRef = useRef(null);
  const railEnabled = showFilterRail && !recordMode;

  const pageSizeOptions = useMemo(
    () => CADASTRO_B1_PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) })),
    [],
  );

  const cardsToolsInMenu = Boolean(cardsToolbar);
  const menuItems = useMemo(
    () => [
      {
        key: "export",
        label: "Exportar (CSV)",
        disabled: !onExportCsv,
      },
      { key: "print", label: "Imprimir", disabled: !onPrint },
      {
        key: "cfg",
        label: "Configurar colunas",
        disabled: !onConfigureColumns,
      },
      {
        key: "cards-layout",
        label: "Configurar layout dos cards",
        disabled: !cardsToolsInMenu || viewMode !== "cards",
      },
      {
        key: "cards-fields",
        label: "Configurar campos dos cards",
        disabled: !cardsToolsInMenu || viewMode !== "cards",
      },
    ],
    [onExportCsv, onPrint, onConfigureColumns, cardsToolsInMenu, viewMode],
  );

  const onMenu = (k) => {
    if (k === "export") onExportCsv?.();
    if (k === "print") (onPrint ?? (() => window.print()))();
    if (k === "cfg") onConfigureColumns?.();
    if (k === "cards-layout") setCardsPanel("layout");
    if (k === "cards-fields") setCardsPanel("fields");
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

  const listSecondaryTools =
    !recordMode && !showFilterRail && onClearFilters ? (
      <div className="mg-toolbar__list-tools flex flex-wrap items-center gap-1.5">
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
      </div>
    ) : null;

  const attachTitle =
    attachDisabledReason ?? (oneSelected ? "Anexos" : "Selecione um registro");
  const showAttachControl = Boolean(onAttach ?? attachDisabledReason);

  const rightTools = (
    <div className="ml-auto flex items-center gap-1.5 flex-wrap">
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
          active={searchActive}
          placeholder={searchPlaceholder}
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
      {!secondaryToolsLocked ? (
        <div className="relative">
          {onConfigureColumns ? (
            <span
              ref={configureColumnsAnchorRef}
              data-testid="b1-col-config-trigger"
              className="pointer-events-none absolute bottom-0 right-0 h-px w-px overflow-hidden"
              aria-hidden="true"
            />
          ) : null}
          <B1Popover
            className="flex w-56 min-w-[12rem] flex-col p-1"
            trigger={
              <IconBtn aria-label="Mais opções" title="Mais opções">
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </IconBtn>
            }
          >
            <MenuList items={menuItems} onPick={onMenu} />
          </B1Popover>
        </div>
      ) : null}
    </div>
  );

  const listBodyClass =
    viewMode === "cards"
      ? "mg-shell__scroll min-h-0 flex-1 p-2.5"
      : "mg-shell__body min-h-0 flex-1";

  const joinedList = joinTableToolbar && !recordMode && viewMode !== "cards";

  const toolbarRow = (
    <div
      className={
        joinedList
          ? "mg-toolbar mg-toolbar--join flex-wrap no-print"
          : "mg-toolbar mg-card flex-wrap no-print"
      }
    >
      {recordMode ? (
        recordToolbar ?? null
      ) : (
        <>
          {onNew ? (
            <PillBtn type="button" onClick={onNew}>
              <Plus className="h-4 w-4" aria-hidden />
              {createLabel}
            </PillBtn>
          ) : null}
          {extraToolbar}
          {onEdit ? (
            <PillBtn type="button" tone="gray" disabled={!oneSelected} onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              Editar
            </PillBtn>
          ) : null}
          {onDuplicate ? (
            <PillBtn type="button" tone="gray" disabled={!oneSelected} onClick={onDuplicate}>
              <Copy className="h-3.5 w-3.5" aria-hidden />
              Duplicar
            </PillBtn>
          ) : null}
          {onDelete ? (
            <PillBtn type="button" tone="red" disabled={!anySelected} onClick={onDelete}>
              <Trash2 className="h-4 w-4" aria-hidden />
              Excluir
              {selectedCount > 1 ? ` (${selectedCount})` : ""}
            </PillBtn>
          ) : null}
          {listSecondaryTools}
        </>
      )}
      {rightTools}
    </div>
  );

  const pillsRail = railEnabled ? (
    <div
      className={`mg-rail no-print mg-pills-rail ${joinedList ? "mg-rail--join" : "mg-card"} ${showChips ? "is-expanded" : "is-collapsed"}`}
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
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="b1-list" data-cadastro-chrome>
      {!joinedList ? toolbarRow : null}

      {recordMode ? (
        <>
          {recordHeader}
          <div className="flex min-h-0 flex-1 gap-2">
            <div className="mg-shell mg-shell--fill min-h-0 min-w-0 flex-1">
              <div className="mg-form-scroll min-h-0 flex-1 overflow-auto p-3">{recordBody}</div>
            </div>
          </div>
        </>
      ) : null}

      {!joinedList ? pillsRail : null}

      {!recordMode ? (
      <div className="flex min-h-0 flex-1 gap-2">
        <div
          className={
            joinedList
              ? "mg-shell mg-shell--fill mg-shell--join-table min-h-0 min-w-0 flex-1"
              : "mg-shell mg-shell--fill min-h-0 min-w-0 flex-1"
          }
        >
          {joinedList ? toolbarRow : null}
          {joinedList ? pillsRail : null}
          <div className={listBodyClass}>{children}</div>
          {listSummary}
        </div>
      </div>
      ) : null}

      {cardsToolbarHosted ? (
        <div className="sr-only" aria-hidden="true">{cardsToolbarHosted}</div>
      ) : null}
    </div>
  );
}
