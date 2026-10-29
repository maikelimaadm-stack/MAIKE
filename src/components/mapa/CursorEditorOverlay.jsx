import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { COR_DESENHO, COR_VERTICE_FILL, EDITOR_VISUAL } from "@/lib/maplibre/estiloAreas.js";

/**
 * Cursor do editor por cima do canvas (D-PROD-66): cruzinha laranja, anel do ímã
 * e rumo do Shift — desenho da referência `camada-desenho.tsx`. Só apresenta:
 * `pointer-events: none`, sem estado React; o editor chama `atualizar()` no
 * mousemove e os atributos são escritos direto no SVG (sem re-render).
 *
 * @typedef {{ x: number, y: number }} Px
 * @typedef {{ cur: Px | null, ima?: { tipo: string } | null, cruz?: boolean, rumo?: number | null }} EstadoCursor
 */
const CursorEditorOverlay = forwardRef(function CursorEditorOverlay(_props, ref) {
  const cruzRef = useRef(/** @type {SVGGElement | null} */ (null));
  const imaRef = useRef(/** @type {SVGGElement | null} */ (null));
  const imaCruzRef = useRef(/** @type {SVGGElement | null} */ (null));
  const imaFecharRef = useRef(/** @type {SVGCircleElement | null} */ (null));
  const rumoRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const { braco, largura } = EDITOR_VISUAL.cruz;
  const ima = EDITOR_VISUAL.ima;

  useImperativeHandle(ref, () => {
    const mostrar = (el, sim) => {
      if (el) el.style.display = sim ? "" : "none";
    };
    const mover = (el, p) => {
      if (el && p) el.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
    };
    const api = {
      /** @param {EstadoCursor} e */
      atualizar(e) {
        const cur = e.cur;
        mostrar(cruzRef.current, !!(cur && e.cruz && !e.ima));
        mover(cruzRef.current, cur);
        mostrar(imaRef.current, !!(cur && e.ima));
        if (cur && e.ima) {
          mover(imaRef.current, cur);
          imaRef.current?.setAttribute("data-tipo", e.ima.tipo);
          mostrar(imaFecharRef.current, e.ima.tipo === "fechar");
          mostrar(imaCruzRef.current, e.ima.tipo !== "fechar");
        }
        const r = rumoRef.current;
        if (r) {
          const tem = !!(cur && e.rumo != null);
          r.style.display = tem ? "" : "none";
          if (tem) {
            r.textContent = `${e.rumo}°`;
            r.style.transform = `translate(${cur.x.toFixed(1)}px, ${(cur.y - 14).toFixed(1)}px) translate(-50%, -100%)`;
          }
        }
      },
      limpar() {
        api.atualizar({ cur: null });
      },
    };
    return api;
  }, []);

  const cruz = (
    <>
      <line x1={-braco} y1={0} x2={braco} y2={0} />
      <line x1={0} y1={-braco} x2={0} y2={braco} />
    </>
  );

  return (
    <div data-testid="editor-overlay" aria-hidden="true" className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      <svg className="absolute inset-0 h-full w-full">
        <g ref={cruzRef} data-testid="editor-cruzinha" style={{ display: "none" }} stroke={COR_DESENHO} strokeWidth={largura} strokeLinecap="round">
          {cruz}
        </g>
        <g ref={imaRef} data-testid="editor-ima" style={{ display: "none" }}>
          <circle r={ima.anel} fill="none" stroke={COR_DESENHO} strokeWidth={ima.anelBorda} strokeOpacity={ima.anelOpacidade} />
          <circle ref={imaFecharRef} r={ima.fecharRaio} fill={COR_VERTICE_FILL} stroke={COR_DESENHO} strokeWidth={ima.fecharBorda} />
          <g ref={imaCruzRef} stroke={COR_DESENHO} strokeWidth={largura} strokeLinecap="round">
            {cruz}
          </g>
        </g>
      </svg>
      <div
        ref={rumoRef}
        data-testid="editor-rumo"
        style={{ display: "none", left: 0, top: 0 }}
        className="absolute rounded bg-slate-900/80 px-1.5 py-px text-[10px] tabular-nums text-sky-100"
      />
    </div>
  );
});

export default CursorEditorOverlay;
