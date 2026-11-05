import React from "react";

/**
 * Texto numa linha só; se não couber, corre devagar de um lado ao outro para
 * dar para ler tudo (D-PROD-124).
 * @param {{ children: React.ReactNode, className?: string }} props
 */
export function TextoCorrido({ children, className = "" }) {
  const caixa = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  const texto = React.useRef(/** @type {HTMLSpanElement | null} */ (null));
  const [distancia, setDistancia] = React.useState(0);

  React.useLayoutEffect(() => {
    const medir = () => {
      const c = caixa.current;
      const t = texto.current;
      if (!c || !t) return;
      const sobra = Math.ceil(t.scrollWidth - c.clientWidth);
      setDistancia(sobra > 1 ? sobra : 0);
    };
    medir();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(medir);
    if (caixa.current) ro.observe(caixa.current);
    return () => ro.disconnect();
  }, [children]);

  const estilo = distancia
    ? /** @type {React.CSSProperties} */ ({ ["--mk-dist"]: `-${distancia}px`, ["--mk-tempo"]: `${Math.max(4, distancia / 18 + 3)}s` })
    : undefined;

  return (
    <div ref={caixa} className={`mk-dl__linha ${className}`}>
      <span ref={texto} className={distancia ? "mk-dl__correr is-correndo" : "mk-dl__correr"} style={estilo}>
        {children}
      </span>
    </div>
  );
}

/**
 * Campo do Detalhes do Lote/Área: rótulo cinza e valor escuro, no mesmo
 * tamanho do "Categoria de Manejo" (D-PROD-124).
 * @param {{ rotulo: string, children: React.ReactNode }} props
 */
export default function CampoDl({ rotulo, children }) {
  return (
    <div className="mk-dl__info">
      <TextoCorrido className="mk-dl__rotulo">{rotulo}</TextoCorrido>
      <TextoCorrido className="mk-dl__valor">{children}</TextoCorrido>
    </div>
  );
}
