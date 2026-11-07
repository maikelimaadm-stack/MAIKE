import React from "react";
import { createPortal } from "react-dom";

/**
 * Tooltip escuro da barra lateral recolhida: aparece à direita do ícone ao
 * passar o mouse (ou focar), no estilo do protótipo "Alternar barra lateral".
 *
 * Renderiza num portal porque o trilho de ícones vive dentro de um container
 * com rolagem — ali um tooltip absoluto seria cortado.
 *
 * `ativo` desliga o tooltip sem mudar o layout (usado no menu expandido, onde
 * o rótulo já está visível).
 *
 * @param {{ label: string, atalhos?: string[], ativo?: boolean, children: React.ReactNode }} props
 */
export default function SidebarTooltip({ label, atalhos = [], ativo = true, children }) {
  const ancoraRef = React.useRef(/** @type {HTMLSpanElement | null} */ (null));
  const [posicao, setPosicao] = React.useState(/** @type {{ top: number, left: number } | null} */ (null));

  const abrir = () => {
    // O <span> de `contents` não tem caixa própria: medimos o botão/link interno.
    const alvo = ancoraRef.current?.firstElementChild || ancoraRef.current;
    const caixa = alvo?.getBoundingClientRect();
    if (!caixa || !caixa.width) return;
    setPosicao({ top: caixa.top + caixa.height / 2, left: caixa.right + 10 });
  };
  const fechar = () => setPosicao(null);

  if (!ativo) return <>{children}</>;

  return (
    <>
      <span
        ref={ancoraRef}
        className="contents"
        onMouseEnter={abrir}
        onMouseLeave={fechar}
        onFocus={abrir}
        onBlur={fechar}
      >
        {children}
      </span>
      {posicao
        ? createPortal(
            <div
              role="tooltip"
              style={{ top: posicao.top, left: posicao.left }}
              className="pointer-events-none fixed z-[80] flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-lg bg-[#292a2d] px-2.5 py-1.5 text-[12px] font-medium text-white shadow-[0_8px_24px_rgba(15,23,42,0.18)]"
            >
              <span>{label}</span>
              {atalhos.length ? (
                <span className="flex items-center gap-1">
                  {atalhos.map((tecla) => (
                    <kbd
                      key={tecla}
                      className="rounded-[4px] bg-white/15 px-1.5 py-[1px] text-[10px] font-semibold text-white/90"
                    >
                      {tecla}
                    </kbd>
                  ))}
                </span>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
