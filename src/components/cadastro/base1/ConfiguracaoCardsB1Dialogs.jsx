import React from "react";
import { createPortal } from "react-dom";
import { Check, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePortalComprasSkin } from "./portalComprasSkinContext";
import { CheckRow, RadioRow } from "./Base1Ui";

const PER_ROW = [
  { n: 1, hint: "Até 5 campos por linha no card" },
  { n: 2, hint: "Até 2 campos por linha no card" },
  { n: 3, hint: "1 campo por linha no card" },
  { n: 4, hint: "1 campo por linha no card" },
];
const MAX_CARD_FIELDS = 10;

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onFechar descarta rascunho
 * @param {import('react').ReactNode} props.children
 * @param {import('react').ReactNode} [props.footer]
 * @param {string} props.titulo
 * @param {string} [props.testId]
 * @param {() => void} [props.onRestaurarRascunho]
 */
function CardsB1DialogShell({ open, onFechar, titulo, children, footer, testId, onRestaurarRascunho }) {
  const portalSkin = usePortalComprasSkin();
  if (!open) return null;

  return createPortal(
    <div className={cn("b1ref cadastro-b1", portalSkin && "b1-portal-compras")}>
      <div className="mdl" data-testid={testId}>
        <div className="mdlc" role="dialog" aria-modal="true" aria-label={titulo}>
          <div className="mdl-h">
            <span className="mdl-t">{titulo}</span>
            <span style={{ flexGrow: 1 }} />
            {onRestaurarRascunho ? (
              <button
                type="button"
                className="tb-btn tb-btn-icon tb-btn-sm"
                aria-label="Restaurar padrão"
                title="Restaurar padrão"
                onClick={onRestaurarRascunho}
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="button"
              className="tb-btn tb-btn-icon tb-btn-sm"
              aria-label="Fechar"
              title="Fechar"
              onClick={onFechar}
            >
              <X size={14} />
            </button>
          </div>
          <div className="mdl-b">{children}</div>
          {footer ? <div className="mdl-f">{footer}</div> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const dialogFooter = (onOk) => (
  <>
    <span style={{ flexGrow: 1 }} />
    <button
      type="button"
      className="tb-btn tb-btn-icon tb-btn-green"
      aria-label="Pronto"
      title="Pronto"
      onClick={onOk}
    >
      <Check className="h-4 w-4" />
    </button>
  </>
);

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onFechar
 * @param {1|2|3|4} props.value
 * @param {(n: 1|2|3|4) => void} props.onAplicar
 * @param {() => void} props.onRestaurar
 */
export function ConfiguracaoLayoutCardsB1Dialog({ open, onFechar, value, onAplicar, onRestaurar }) {
  const [draft, setDraft] = React.useState(value);
  const [aplicarPadrao, setAplicarPadrao] = React.useState(false);
  const semeado = React.useRef(false);

  React.useEffect(() => {
    if (!open) {
      semeado.current = false;
      return;
    }
    if (semeado.current) return;
    semeado.current = true;
    setDraft(value);
    setAplicarPadrao(false);
  }, [open, value]);

  const restaurarRascunho = () => {
    setAplicarPadrao(true);
    setDraft(4);
  };

  const salvar = () => {
    if (aplicarPadrao) {
      onRestaurar();
      onFechar();
      return;
    }
    onAplicar(draft);
    onFechar();
  };

  return (
    <CardsB1DialogShell
      open={open}
      onFechar={onFechar}
      titulo="Layout dos cards"
      testId="b1-cards-layout-dialog"
      onRestaurarRascunho={restaurarRascunho}
      footer={dialogFooter(salvar)}
    >
      <div role="radiogroup" aria-label="Cards por linha" className="min-h-0 overflow-auto">
        {PER_ROW.map((o) => (
          <RadioRow
            key={o.n}
            checked={draft === o.n}
            onClick={() => {
              setAplicarPadrao(false);
              setDraft(/** @type {1|2|3|4} */ (o.n));
            }}
            title={`${o.n} card${o.n > 1 ? "s" : ""} por linha`}
            hint={o.hint}
          />
        ))}
      </div>
    </CardsB1DialogShell>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onFechar
 * @param {Array<{ id: string; label: string }>} props.columns
 * @param {string[]} props.value
 * @param {(ids: string[]) => void} props.onAplicar
 * @param {() => void} props.onRestaurar
 */
export function ConfiguracaoCamposCardsB1Dialog({
  open,
  onFechar,
  columns,
  value,
  onAplicar,
  onRestaurar,
}) {
  const [draft, setDraft] = React.useState(value);
  const [aplicarPadrao, setAplicarPadrao] = React.useState(false);
  const semeado = React.useRef(false);
  const padraoIds = React.useMemo(
    () => columns.slice(0, MAX_CARD_FIELDS).map((c) => c.id),
    [columns],
  );

  React.useEffect(() => {
    if (!open) {
      semeado.current = false;
      return;
    }
    if (semeado.current) return;
    semeado.current = true;
    setDraft(value.slice(0, MAX_CARD_FIELDS));
    setAplicarPadrao(false);
  }, [open, value]);

  const restaurarRascunho = () => {
    setAplicarPadrao(true);
    setDraft(padraoIds);
  };

  const salvar = () => {
    if (aplicarPadrao) {
      onRestaurar();
      onFechar();
      return;
    }
    onAplicar(draft);
    onFechar();
  };

  return (
    <CardsB1DialogShell
      open={open}
      onFechar={onFechar}
      titulo="Campos dos cards"
      testId="b1-cards-fields-dialog"
      onRestaurarRascunho={restaurarRascunho}
      footer={dialogFooter(salvar)}
    >
      <div className="mb-3 text-xs text-[var(--mg-text-2)]">
        {draft.length} de {Math.min(columns.length, MAX_CARD_FIELDS)} campos
        {draft.length >= MAX_CARD_FIELDS ? " · máximo atingido" : ""}
      </div>
      <div className="min-h-0 flex-1 overflow-auto pr-1">
        {[...columns]
          .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))
          .map((c) => {
            const checked = draft.includes(c.id);
            const disabled = !checked && draft.length >= MAX_CARD_FIELDS;
            return (
              <CheckRow
                key={c.id}
                label={c.label}
                checked={checked}
                disabled={disabled}
                hint={disabled ? `Máximo ${MAX_CARD_FIELDS}` : undefined}
                onChange={(on) => {
                  setAplicarPadrao(false);
                  setDraft((d) => {
                    if (on && d.length >= MAX_CARD_FIELDS) return d;
                    return on ? [...d, c.id] : d.filter((k) => k !== c.id);
                  });
                }}
              />
            );
          })}
      </div>
    </CardsB1DialogShell>
  );
}
