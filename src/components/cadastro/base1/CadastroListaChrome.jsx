import React from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Columns3,
  FilterX,
  Table2,
  FileText,
} from "lucide-react";
import CadastroSearchPill from "./CadastroSearchPill";

/**
 * Chrome de listagem estilo Modelo Base1 (toolbar + faixa + shell + rodapé).
 * Lógica de dados fica nos filhos; aqui só composição visual e ações.
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
  filterRailHint = null,
}) {
  const oneSelected = selectedCount === 1;
  const anySelected = selectedCount > 0;

  return (
    <div className="cadastro-b1" data-testid="cadastro-lista-chrome">
      <div className="mg-toolbar mg-card no-print">
        {onNew ? (
          <button type="button" className="tb-btn tb-btn-green" onClick={onNew}>
            <Plus aria-hidden />
            {createLabel}
          </button>
        ) : null}
        {onEdit ? (
          <button
            type="button"
            className="tb-btn tb-btn-gray"
            disabled={!oneSelected}
            onClick={onEdit}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Editar
          </button>
        ) : null}
        {onDelete ? (
          <button
            type="button"
            className="tb-btn tb-btn-red"
            disabled={!anySelected}
            onClick={onDelete}
          >
            <Trash2 aria-hidden />
            Excluir
            {selectedCount > 1 ? ` (${selectedCount})` : ""}
          </button>
        ) : null}

        <div className="mg-toolbar__right">
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
            <div className="view-seg" role="group" aria-label="Modo de visualização">
              <button
                type="button"
                aria-label="Registro"
                aria-pressed={viewMode === "record"}
                disabled={!recordModeAvailable}
                onClick={() => onViewModeChange("record")}
              >
                <FileText aria-hidden />
              </button>
              <button
                type="button"
                aria-label="Tabela"
                aria-pressed={viewMode === "table"}
                onClick={() => onViewModeChange("table")}
              >
                <Table2 aria-hidden />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mg-pills-rail mg-card no-print">
        {onConfigureColumns ? (
          <button
            type="button"
            className="tb-btn tb-btn-icon"
            aria-label="Configurar colunas da tabela"
            title="Configurar colunas"
            onClick={onConfigureColumns}
          >
            <Columns3 aria-hidden />
          </button>
        ) : null}
        <span className="mg-pills-rail__hint">
          {filterRailHint ?? "Filtros por coluna na grade (ícone de funil no cabeçalho)."}
        </span>
        {onClearFilters ? (
          <button
            type="button"
            className={`tb-btn tb-btn-icon ml-auto ${filtersActive ? "is-active" : ""}`}
            aria-label="Limpar todos os filtros"
            title="Limpar todos os filtros"
            disabled={!filtersActive}
            onClick={onClearFilters}
          >
            <FilterX aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="mg-shell mg-shell--table min-h-0 flex-1">
        <div className="mg-shell__body">{children}</div>
        <div className="mg-summary no-print">
          <div className="mg-summary__counts">
            <span className="mg-summary__item">Selecionados: {selectedCount}</span>
            <span className="mg-summary__item">Listados: {listados}</span>
            <span className="mg-summary__item">Filtrados: {filtrados}</span>
            <span className="mg-summary__item">Totais: {totais}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
