import React from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePortalComprasSkin } from "./portalComprasSkinContext";
import { CheckRow, PillBtn, RadioRow } from "./Base1Ui";

const PER_ROW = [
  { n: 1, hint: "Até 5 campos por linha no card" },
  { n: 2, hint: "Até 2 campos por linha no card" },
  { n: 3, hint: "1 campo por linha no card" },
  { n: 4, hint: "1 campo por linha no card" },
];

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onFechar descarta rascunho
 * @param {import('react').ReactNode} props.children
 * @param {import('react').ReactNode} [props.footer]
 * @param {string} props.titulo
 * @param {string} [props.testId]
 * @param {import('react').CSSProperties} [props.shellStyle]
 */
function CardsB1DialogShell({ open, onFechar, titulo, children, footer, testId, shellStyle }) {
  const portalSkin = usePortalComprasSkin();
  if (!open) return null;

  return createPortal(
    <div className={cn("b1ref", portalSkin && "b1-portal-compras")}>
      <div className="mdl" data-testid={testId}>
        <div
          className="mdlc"
          style={{ width: 440, maxWidth: "92%", height: "auto", maxHeight: "86%", ...shellStyle }}
          role="dialog"
          aria-modal="true"
          aria-label={titulo}
        >
          <div className="mdl-h">
            <span className="mdl-t">{titulo}</span>
            <span style={{ flexGrow: 1 }} />
            <button type="button" className="rm" aria-label="Fechar" title="Fechar" onClick={onFechar}>
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

const dialogFooter = (onRestore, onOk) => (
  <>
    <PillBtn tone="gray" onClick={onRestore}>
      Restaurar
    </PillBtn>
    <span style={{ flexGrow: 1 }} />
    <button type="button" className="tb-btn tb-btn-icon" aria-label="Pronto" title="Pronto" onClick={onOk}>
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
  const semeado = React.useRef(false);

  React.useEffect(() => {
    if (!open) {
      semeado.current = false;
      return;
    }
    if (semeado.current) return;
    semeado.current = true;
    setDraft(value);
  }, [open, value]);

  const restaurarEAplicar = () => {
    onRestaurar();
    onFechar();
  };

  const salvar = () => {
    onAplicar(draft);
    onFechar();
  };

  return (
    <CardsB1DialogShell
      open={open}
      onFechar={onFechar}
      titulo="Layout dos cards"
      testId="b1-cards-layout-dialog"
      footer={dialogFooter(restaurarEAplicar, salvar)}
    >
      <div role="radiogroup" aria-label="Cards por linha" className="min-h-0 overflow-auto">
        {PER_ROW.map((o) => (
          <RadioRow
            key={o.n}
            checked={draft === o.n}
            onClick={() => setDraft(/** @type {1|2|3|4} */ (o.n))}
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
  const semeado = React.useRef(false);

  React.useEffect(() => {
    if (!open) {
      semeado.current = false;
      return;
    }
    if (semeado.current) return;
    semeado.current = true;
    setDraft(value);
  }, [open, value]);

  const restaurarEAplicar = () => {
    onRestaurar();
    onFechar();
  };

  const salvar = () => {
    onAplicar(draft);
    onFechar();
  };

  return (
    <CardsB1DialogShell
      open={open}
      onFechar={onFechar}
      titulo="Campos dos cards"
      testId="b1-cards-fields-dialog"
      shellStyle={{ height: 480 }}
      footer={dialogFooter(restaurarEAplicar, salvar)}
    >
      <div className="min-h-0 flex-1 overflow-auto">
        {[...columns]
          .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))
          .map((c) => (
            <CheckRow
              key={c.id}
              label={c.label}
              checked={draft.includes(c.id)}
              onChange={(on) =>
                setDraft((d) => (on ? [...d, c.id] : d.filter((k) => k !== c.id)))
              }
            />
          ))}
      </div>
    </CardsB1DialogShell>
  );
}
