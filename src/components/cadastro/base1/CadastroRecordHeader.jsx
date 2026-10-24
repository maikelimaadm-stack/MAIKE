import React from "react";
import { Bookmark, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { IconBtn } from "./Base1Ui";

/**
 * Cabeçalho de registro Modelo Base1 (código • título + navegação entre registros).
 *
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.code]
 * @param {number} [props.index] 0-based
 * @param {number} [props.total]
 * @param {(index: number) => void} [props.onGo]
 * @param {boolean} [props.navDisabled] bloqueia nav durante edição/lançamento
 */
export default function CadastroRecordHeader({
  title,
  code,
  index = 0,
  total = 0,
  onGo,
  navDisabled = false,
}) {
  const showNav = total > 1 && onGo;
  const atStart = index <= 0;
  const atEnd = index >= total - 1;

  return (
    <div className="mg-toolbar mg-card flex-wrap no-print">
      <Bookmark className="h-4 w-4 text-[var(--mg-icon)] shrink-0" aria-hidden />
      <span className="text-[13px] font-semibold text-slate-800 min-w-0 truncate">
        {code ? (
          <>
            {code} <span className="text-slate-400">•</span>{" "}
          </>
        ) : null}
        {title}
      </span>
      {showNav ? (
        <span className="ml-auto flex items-center gap-1 shrink-0">
          <IconBtn
            size="sm"
            aria-label="Primeiro registro"
            disabled={navDisabled || atStart}
            onClick={() => onGo(0)}
          >
            <ChevronsLeft className="h-4 w-4" />
          </IconBtn>
          <IconBtn
            size="sm"
            aria-label="Registro anterior"
            disabled={navDisabled || atStart}
            onClick={() => onGo(index - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </IconBtn>
          <span className="px-1 text-[12px] text-slate-600 tabular-nums">
            {index + 1}/{total}
          </span>
          <IconBtn
            size="sm"
            aria-label="Próximo registro"
            disabled={navDisabled || atEnd}
            onClick={() => onGo(index + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </IconBtn>
          <IconBtn
            size="sm"
            aria-label="Último registro"
            disabled={navDisabled || atEnd}
            onClick={() => onGo(total - 1)}
          >
            <ChevronsRight className="h-4 w-4" />
          </IconBtn>
        </span>
      ) : null}
    </div>
  );
}
