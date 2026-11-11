import React from "react";
import { cn } from "@/lib/utils";
import { useCelular } from "@/components/common/MobileSheet";
import { NavegacaoDoRegistro, temNavegacao, useNavegacaoDoRegistro } from "./registroNavBase1";

const SYSTEM_PANEL_IDS = new Set([
  "geral",
  "compra",
  "identificacao",
  "observacoes",
  "campos_personalizados",
  "principal",
]);

function CustomTabMarker() {
  return (
    <span
      className="pointer-events-none absolute bottom-0 right-0 z-10 w-0 h-0 border-l-[7px] border-l-transparent border-b-[7px] border-b-emerald-500"
      aria-hidden
    />
  );
}

/** Abaixo do desktop não há abas: cada painel vira uma seção empilhada (D-PROD-163). */
function useEmpilhado() {
  const consulta = "(max-width: 1023px)";
  const ler = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? Boolean(window.matchMedia(consulta).matches)
      : false;
  const [empilhado, setEmpilhado] = React.useState(ler);
  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia(consulta);
    const aplicar = () => setEmpilhado(Boolean(mq.matches));
    aplicar();
    mq.addEventListener?.("change", aplicar);
    return () => mq.removeEventListener?.("change", aplicar);
  }, []);
  return empilhado;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(Boolean(mq.matches));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

/**
 * Abas de painéis Base1 (paridade PanelTabs / Novo Equipamento — CONTROLE-DE-ESTOQUE).
 *
 * @param {object} props
 * @param {{ id: string; label: string; disabled?: boolean }[]} props.tabs
 * @param {string} props.value aba ativa (controlada)
 * @param {(id: string) => void} props.onChange
 * @param {(panelId: string) => import('react').ReactNode} props.renderPanel
 * @param {string} [props.preferenceKey] (sem uso desde a D-PROD-163: o design tem só abas — sem lista lateral)
 * @param {boolean} [props.animate] fade ao trocar aba
 * @param {string|number} [props.animationKey] muda ao trocar registro — a troca de registro não anima
 * @param {string} [props.className]
 */
export default function Base1PanelTabs({
  tabs = [],
  value,
  onChange,
  renderPanel,
  preferenceKey,
  animate = true,
  animationKey,
  className,
}) {
  const reducedMotion = usePrefersReducedMotion();
  const empilhado = useEmpilhado();
  const raizRef = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  const [pendentes, setPendentes] = React.useState(/** @type {Record<string, boolean>} */ ({}));

  // Ponto vermelho na aba que tem campo inválido — lido do DOM, vale para qualquer formulário.
  React.useLayoutEffect(() => {
    const raiz = raizRef.current;
    if (!raiz) return;
    /** @type {Record<string, boolean>} */
    const proximo = {};
    raiz.querySelectorAll("[data-b1-painel]").forEach((el) => {
      const id = el.getAttribute("data-b1-painel");
      if (id && el.querySelector(".mg-field.is-invalid")) proximo[id] = true;
    });
    setPendentes((atual) => {
      const a = Object.keys(atual).sort().join("|");
      const b = Object.keys(proximo).sort().join("|");
      return a === b ? atual : proximo;
    });
  });
  const celular = useCelular();
  // ‹ › do registro: na linha das abas (desktop) ou numa linha acima das seções (tablet); no celular fica no rodapé.
  const navInfo = useNavegacaoDoRegistro(!celular && tabs.length > 1);
  const tabRefs = React.useRef({});

  const validIds = React.useMemo(() => tabs.filter((t) => !t.disabled).map((t) => t.id), [tabs]);
  const current =
    validIds.includes(value) ? value : validIds[0] ?? tabs[0]?.id ?? "";

  // O painel só esmaece quando a aba muda dentro do mesmo registro — nunca ao abrir um registro,
  // criar ou trocar de registro (como no design, D-PROD-164: `abaAnim` só no clique da aba).
  const [anterior, setAnterior] = React.useState({ aba: current, chave: animationKey });
  const [animarAba, setAnimarAba] = React.useState(false);
  if (anterior.aba !== current || anterior.chave !== animationKey) {
    setAnterior({ aba: current, chave: animationKey });
    setAnimarAba(anterior.chave === animationKey);
  }

  React.useEffect(() => {
    if (!current) return;
    if (value === current) return;
    if (!validIds.includes(value)) onChange(current);
  }, [value, current, validIds, onChange]);

  React.useEffect(() => {
    const el = tabRefs.current[current];
    if (!el?.scrollIntoView) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  }, [current, reducedMotion]);

  // O contêiner de rolagem do formulário recebe o modo do design: abas fora do cartão ou seções empilhadas.
  React.useLayoutEffect(() => {
    const scroll = raizRef.current?.closest(".mg-form-scroll");
    if (!scroll || tabs.length < 2) return undefined;
    const cls = empilhado ? "b1-form--secoes" : "b1-form--abas-fora";
    scroll.classList.add(cls);
    return () => scroll.classList.remove(cls);
  }, [empilhado, tabs.length]);

  const sidebar = false;

  const focusTab = (id) => {
    tabRefs.current[id]?.focus?.();
  };

  const moveFocus = (tabId, delta) => {
    const enabled = tabs.filter((t) => !t.disabled);
    if (!enabled.length) return;
    const idx = enabled.findIndex((t) => t.id === tabId);
    const base = idx >= 0 ? idx : 0;
    const next = (base + delta + enabled.length) % enabled.length;
    const target = enabled[next];
    if (target) {
      onChange(target.id);
      focusTab(target.id);
    }
  };

  const onTabKeyDown = (e, tabId) => {
    const horizontal = !sidebar;
    if (e.key === "ArrowLeft" && horizontal) {
      e.preventDefault();
      moveFocus(tabId, -1);
    } else if (e.key === "ArrowRight" && horizontal) {
      e.preventDefault();
      moveFocus(tabId, 1);
    } else if (e.key === "ArrowUp" && sidebar) {
      e.preventDefault();
      moveFocus(tabId, -1);
    } else if (e.key === "ArrowDown" && sidebar) {
      e.preventDefault();
      moveFocus(tabId, 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      const first = tabs.find((t) => !t.disabled);
      if (first) {
        onChange(first.id);
        focusTab(first.id);
      }
    } else if (e.key === "End") {
      e.preventDefault();
      const enabled = tabs.filter((t) => !t.disabled);
      const last = enabled[enabled.length - 1];
      if (last) {
        onChange(last.id);
        focusTab(last.id);
      }
    }
  };

  const tabButtons = tabs.map((tab) => {
    const active = current === tab.id;
    const tabId = `b1-panel-tab-${tab.id}`;
    const panelId = `b1-panel-${tab.id}`;
    const isCustom = !SYSTEM_PANEL_IDS.has(tab.id);
    return (
      <button
        key={tab.id}
        ref={(node) => {
          tabRefs.current[tab.id] = node;
        }}
        id={tabId}
        type="button"
        role="tab"
        aria-selected={active}
        aria-controls={panelId}
        tabIndex={active ? 0 : -1}
        disabled={tab.disabled}
        onClick={() => onChange(tab.id)}
        onKeyDown={(e) => onTabKeyDown(e, tab.id)}
        className={cn(
          sidebar ? "b1-panel-list__tab" : "b1-panel-tab",
          active && "is-active",
          sidebar ? "" : "relative",
        )}
      >
        {!sidebar && isCustom ? <CustomTabMarker /> : null}
        {tab.label}
        {pendentes[tab.id] ? <span className="b1-aba-dot" title="Campos pendentes" aria-hidden="true" /> : null}
      </button>
    );
  });

  const shouldAnimate = animate && !reducedMotion;
  const panelsBody = tabs.map((tab) => {
    const active = current === tab.id;
    const panelId = `b1-panel-${tab.id}`;
    const tabId = `b1-panel-tab-${tab.id}`;
    const motionClass = active && shouldAnimate && animarAba ? "b1-panel-motion--animate" : "";
    return (
      <div
        key={tab.id}
        id={panelId}
        role="tabpanel"
        aria-labelledby={tabId}
        hidden={!active}
        data-b1-painel={tab.id}
        className={cn(!active && "hidden", !sidebar && "b1-aba-cartao", motionClass)}
      >
        {!sidebar ? (
          <div className="b1-aba-cartao__cab">
            <h3 className="b1-aba-cartao__titulo">{tab.label}</h3>
          </div>
        ) : null}
        {renderPanel(tab.id)}
      </div>
    );
  });

  if (tabs.length === 0) return null;

  if (tabs.length === 1) {
    return <div className={cn("b1-panel-tabs-single", className)}>{panelsBody}</div>;
  }

  if (empilhado) {
    return (
      <>
      {temNavegacao(navInfo) ? (
        <div className="b1-reg-navlinha">
          <NavegacaoDoRegistro info={navInfo} />
        </div>
      ) : null}
      <div ref={raizRef} className={cn("b1-secoes", className)}>
        {tabs
          .filter((tab) => !tab.disabled)
          .map((tab) => (
            <section
              key={tab.id}
              className="b1-secao"
              id={`b1-secao-${tab.id}`}
              aria-labelledby={`b1-secao-${tab.id}-t`}
              data-b1-painel={tab.id}
            >
              <div className="b1-secao__cartao">
                <div className="b1-secao__cab">
                  <h3 className="b1-secao__titulo" id={`b1-secao-${tab.id}-t`}>
                    {tab.label}
                  </h3>
                </div>
                {renderPanel(tab.id)}
              </div>
            </section>
          ))}
      </div>
      </>
    );
  }

  return (
    <div ref={raizRef} className={cn("b1-panel-tabs-root b1-abas-fora", className)}>
      <div className="b1-panel-tabs-rail">
        <div className="b1-panel-tabs-strip" role="tablist" aria-orientation="horizontal">
          {tabButtons}
        </div>
        <NavegacaoDoRegistro info={navInfo} />
      </div>
      {panelsBody}
    </div>
  );
}
