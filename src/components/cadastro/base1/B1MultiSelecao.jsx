import React from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown } from "lucide-react";

/**
 * Campo de marcar vários do motor Base1 (D-PROD-161): no lugar das pílulas, o
 * campo mostra o que está marcado e abre a mesma janela de marcar dos filtros
 * do mapa (`mk-map-multi-popup`), ancorada ao campo inteiro e alinhada à
 * direita, em todos os tamanhos de tela.
 *
 * @param {{
 *   rotulo: string,
 *   opcoes: string[],
 *   valor: string[],
 *   onChange: (proximos: string[]) => void,
 *   disabled?: boolean,
 *   placeholder?: string,
 *   id?: string,
 *   'aria-invalid'?: boolean,
 *   'aria-describedby'?: string,
 * }} props
 */
export default function B1MultiSelecao({
  rotulo,
  opcoes,
  valor,
  onChange,
  disabled = false,
  placeholder = "",
  id = undefined,
  "aria-invalid": ariaInvalid = undefined,
  "aria-describedby": ariaDescribedBy = undefined,
}) {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  const campo = React.useCallback(() => wrapperRef.current?.closest(".mg-field") ?? wrapperRef.current, []);
  const ancoraRef = React.useMemo(
    () => ({ current: { getBoundingClientRect: () => (campo() ?? document.body).getBoundingClientRect() } }),
    [campo],
  );
  const marcados = opcoes.filter((o) => valor.includes(o));

  const alternar = (opcao) => {
    // Mantém a ordem da lista de opções, não a ordem dos cliques.
    const proximos = valor.includes(opcao) ? valor.filter((v) => v !== opcao) : [...valor, opcao];
    onChange(opcoes.filter((o) => proximos.includes(o)));
  };

  return (
    <Popover.Root open={open} onOpenChange={(o) => setOpen(disabled ? false : o)}>
      <Popover.Anchor virtualRef={/** @type {any} */ (ancoraRef)} />
      <div
        ref={wrapperRef}
        className="relative mk-sel-campo w-full"
        onClick={() => {
          if (!disabled) setOpen((o) => !o);
        }}
      >
        <input
          id={id}
          readOnly
          value={marcados.join(", ")}
          placeholder={placeholder}
          disabled={disabled}
          role="combobox"
          aria-label={id ? undefined : rotulo}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
            }
          }}
          className="flex w-full bg-transparent pr-8 h-8 text-xs rounded-none cursor-pointer outline-none uppercase"
          style={{ textTransform: "uppercase" }}
        />
        <ChevronDown className="mk-ac-chev" aria-hidden />
      </div>
      <Popover.Portal>
        <Popover.Content
          align="end"
          side="bottom"
          sideOffset={5}
          collisionPadding={8}
          aria-label={rotulo}
          className="mk-map-multi-popup b1-multi-pop"
          onInteractOutside={(e) => {
            // Clique no próprio campo: quem abre e fecha é o campo.
            const el = campo();
            if (el && e.target instanceof Node && el.contains(e.target)) e.preventDefault();
          }}
          onCloseAutoFocus={(e) => {
            const alvo = wrapperRef.current?.querySelector("input");
            if (alvo) {
              e.preventDefault();
              alvo.focus();
            }
          }}
        >
          <div className="mk-map-multi-title">{rotulo}</div>
          <div className="mk-map-multi-options">
            {opcoes.map((o) => (
              <label key={o}>
                <input type="checkbox" checked={valor.includes(o)} onChange={() => alternar(o)} />
                <span>{o}</span>
              </label>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
