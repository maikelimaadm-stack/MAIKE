import React, { useMemo, useRef, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Columns3,
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
import { B1Popover, IconBtn, MenuList, PillBtn, ViewSwitch } from "./Base1Ui";

const PAGE_SIZES = [50, 100, 200, 500];

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
  attachDisabledReason = null,
  onAttach,
}) {
  const oneSelected = selectedCount === 1;
  const anySelected = selectedCount > 0;
  const [showChips, setShowChips] = useState(true);
  const stripRef = useRef(null);

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
    ],
    [onExportCsv, onPrint, onConfigureColumns],
  );

  const onMenu = (k) => {
    if (k === "export") onExportCsv?.();
    if (k === "print") (onPrint ?? (() => window.print()))();
    if (k === "cfg") onConfigureColumns?.();
  };

  const scrollStrip = (dx) => stripRef.current?.scrollBy({ left: dx, behavior: "smooth" });

  const attachTitle =
    attachDisabledReason ?? (oneSelected ? "Anexos" : "Selecione um registro");
  const showAttachControl = Boolean(onAttach ?? attachDisabledReason);

  return (
    <div className="cadastro-b1" data-testid="cadastro-lista-chrome">
      <div className="mg-toolbar mg-card no-print">
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

        <div className="mg-toolbar__right">
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
          {onSearchChange ? (
            <CadastroSearchPill
              value={searchValue}
              onChange={onSearchChange}
              onApply={onSearchApply}
              active={searchActive}
              placeholder={searchPlaceholder}
            />
          ) : null}
          {onViewModeChange ? (
            <ViewSwitch
              value={viewMode}
              recordDisabled={!recordModeAvailable}
              cardsDisabled={!cardsModeAvailable}
              onChange={onViewModeChange}
            />
          ) : null}
          <B1Popover
            className="w-64 p-1.5"
            trigger={
              <IconBtn aria-label="Mais opções" title="Mais opções">
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </IconBtn>
            }
          >
            <MenuList items={menuItems} onPick={onMenu} />
          </B1Popover>
        </div>
      </div>

      <div
        className={`mg-rail mg-card no-print mg-pills-rail ${showChips ? "is-expanded" : "is-collapsed"}`}
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
                {filterRailHint ?? "Filtros por coluna na grade (menu ⋮ no cabeçalho)."}
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
              className={filtersActive ? "text-red-600" : undefined}
              onClick={onClearFilters}
            >
              <FilterX className="h-4 w-4" />
            </IconBtn>
          ) : null}
          <span className="mx-1 h-5 w-px bg-[var(--mg-divider)]" aria-hidden />
          {onConfigureColumns ? (
            <IconBtn
              size="sm"
              aria-label="Configurar colunas da tabela"
              title="Configurar colunas da tabela"
              onClick={onConfigureColumns}
            >
              <Columns3 className="h-4 w-4" />
            </IconBtn>
          ) : null}
        </div>
      </div>

      <div className="mg-shell mg-shell--table mg-shell--fill min-h-0 flex-1">
        <div className="mg-shell__body">{children}</div>
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
                <select
                  aria-label="Quantidade de registros por carregamento"
                  className="mg-pill-select"
                  value={pageSize}
                  onChange={(e) => onPageSizeChange(Number(e.target.value))}
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
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
      </div>
    </div>
  );
}
