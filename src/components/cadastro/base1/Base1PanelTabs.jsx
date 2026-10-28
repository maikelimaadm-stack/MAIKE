import React from "react";
import { LayoutGrid, PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";

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

function readPanelStyle(preferenceKey) {
  if (!preferenceKey) return "tabs";
  try {
    const raw = localStorage.getItem(preferenceKey);
    if (raw === "sidebar" || raw === "tabs") return raw;
  } catch {
    /* storage indisponível */
  }
  return "tabs";
}

function writePanelStyle(preferenceKey, style) {
  if (!preferenceKey) return;
  try {
    localStorage.setItem(preferenceKey, style);
  } catch {
    /* ignore */
  }
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
 * @param {string} [props.preferenceKey] persiste só tabs|sidebar
 * @param {boolean} [props.animate] fade ao trocar aba
 * @param {string|number} [props.animationKey] muda ao trocar registro — suprime animação na 1ª pintura
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
  const [panelStyle, setPanelStyle] = React.useState(() => readPanelStyle(preferenceKey));
  const tabRefs = React.useRef({});
  const prevAnimationKey = React.useRef(animationKey);
  const skipNextAnimation = React.useRef(false);

  React.useEffect(() => {
    if (prevAnimationKey.current !== animationKey) {
      prevAnimationKey.current = animationKey;
      skipNextAnimation.current = true;
    }
  }, [animationKey]);

  const validIds = React.useMemo(() => tabs.filter((t) => !t.disabled).map((t) => t.id), [tabs]);
  const current =
    validIds.includes(value) ? value : validIds[0] ?? tabs[0]?.id ?? "";

  React.useEffect(() => {
    if (!current) return;
    if (value === current) return;
    if (!validIds.includes(value)) onChange(current);
  }, [value, current, validIds, onChange]);

  React.useEffect(() => {
    const el = tabRefs.current[current];
    if (!el?.scrollIntoView) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  }, [current, panelStyle, reducedMotion]);

  const toggleStyle = () => {
    const next = panelStyle === "sidebar" ? "tabs" : "sidebar";
    setPanelStyle(next);
    writePanelStyle(preferenceKey, next);
  };

  const sidebar = panelStyle === "sidebar";
  const toggleLabel = sidebar
    ? "Mostrar painéis em abas horizontais"
    : "Mostrar painéis em lista lateral";

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

  const toggleBtn = (
    <button
      type="button"
      className={cn("b1-panel-nav-btn b1-panel-style-toggle", sidebar && "is-active")}
      onClick={toggleStyle}
      title={toggleLabel}
      aria-label={toggleLabel}
      aria-pressed={sidebar}
    >
      {sidebar ? <LayoutGrid strokeWidth={2.1} aria-hidden /> : <PanelLeft strokeWidth={2.1} aria-hidden />}
    </button>
  );

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
      </button>
    );
  });

  const shouldAnimate = animate && !reducedMotion;
  const panelsBody = tabs.map((tab) => {
    const active = current === tab.id;
    const panelId = `b1-panel-${tab.id}`;
    const tabId = `b1-panel-tab-${tab.id}`;
    let motionClass = "";
    if (active && shouldAnimate) {
      if (skipNextAnimation.current) {
        skipNextAnimation.current = false;
      } else {
        motionClass = "b1-panel-motion--animate";
      }
    }
    return (
      <div
        key={tab.id}
        id={panelId}
        role="tabpanel"
        aria-labelledby={tabId}
        hidden={!active}
        className={cn(!active && "hidden", motionClass)}
      >
        {renderPanel(tab.id)}
      </div>
    );
  });

  if (tabs.length === 0) return null;

  if (tabs.length === 1) {
    return <div className={cn("b1-panel-tabs-single", className)}>{panelsBody}</div>;
  }

  if (sidebar) {
    return (
      <div className={cn("b1-panel-sidebar-layout", className)}>
        <aside className="b1-panel-sidebar-layout__tabs">
          <div className="b1-panel-list" role="tablist" aria-orientation="vertical">
            <div className="b1-panel-list__leading">{toggleBtn}</div>
            {tabButtons}
          </div>
        </aside>
        <div className="b1-panel-sidebar-layout__content">{panelsBody}</div>
      </div>
    );
  }

  return (
    <div className={cn("b1-panel-tabs-root", className)}>
      <div className="b1-panel-tabs-rail">
        <div className="b1-panel-tabs-rail__leading">{toggleBtn}</div>
        <div className="b1-panel-tabs-strip" role="tablist" aria-orientation="horizontal">
          {tabButtons}
        </div>
      </div>
      {panelsBody}
    </div>
  );
}
