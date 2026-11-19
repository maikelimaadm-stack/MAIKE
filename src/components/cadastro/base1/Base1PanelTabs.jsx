import React from "react";
import { ArrowLeftToLine, ArrowRightFromLine, Search } from "lucide-react";
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

/** Abaixo do desktop não há abas: cada painel vira uma seção empilhada (D-PROD-164). */
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
 * @param {string} [props.preferenceKey] (sem uso desde a D-PROD-164: o design tem só abas — sem lista lateral)
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
  // Envio recusado pela validação: a guia com o 1º campo inválido abre (guias laterais, PR #339) —
  // senão o campo a corrigir fica escondido atrás da guia atual. Armado no `submit` do formulário.
  const aposEnvio = React.useRef(false);

  const celular = useCelular();
  // ‹ › do registro: na linha das abas (desktop) ou numa linha acima das seções (tablet); no celular fica no rodapé.
  const navInfo = useNavegacaoDoRegistro(!celular && tabs.length > 1);
  const tabRefs = React.useRef({});

  const validIds = React.useMemo(() => tabs.filter((t) => !t.disabled).map((t) => t.id), [tabs]);
  const current =
    validIds.includes(value) ? value : validIds[0] ?? tabs[0]?.id ?? "";

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
    if (aposEnvio.current && Object.keys(proximo).length) {
      aposEnvio.current = false;
      if (!proximo[current] && !empilhado) {
        const alvo = tabs.find((t) => proximo[t.id] && !t.disabled);
        if (alvo) onChange(alvo.id);
      }
    }
  });

  // O painel só esmaece quando a aba muda dentro do mesmo registro — nunca ao abrir um registro,
  // criar ou trocar de registro (como no design, D-PROD-165: `abaAnim` só no clique da aba).
  const [anterior, setAnterior] = React.useState({ aba: current, chave: animationKey });
  const [animarAba, setAnimarAba] = React.useState(false);
  if (anterior.aba !== current || anterior.chave !== animationKey) {
    setAnterior({ aba: current, chave: animationKey });
    setAnimarAba(anterior.chave === animationKey);
  }

  React.useEffect(() => {
    const form = raizRef.current?.closest("form");
    if (!form) return undefined;
    const armar = () => {
      aposEnvio.current = true;
    };
    form.addEventListener("submit", armar, true);
    return () => form.removeEventListener("submit", armar, true);
  }, [empilhado, tabs.length]);

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
    if (!scroll || tabs.length < 1) return undefined;
    const cls = empilhado ? "b1-form--secoes" : "b1-form--abas-fora";
    scroll.classList.add(cls);
    return () => scroll.classList.remove(cls);
  }, [empilhado, tabs.length]);

  const sidebar = true;
  const [buscaGuia, setBuscaGuia] = React.useState("");
  const [sidebarRecolhida, setSidebarRecolhida] = React.useState(false);

  const normalizarTexto = (txt) =>
    String(txt ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const termoGuia = normalizarTexto(buscaGuia.trim());
  const tabsVisiveis = React.useMemo(
    () => (termoGuia ? tabs.filter((t) => normalizarTexto(t.label).includes(termoGuia)) : tabs),
    [tabs, termoGuia],
  );

  const focusTab = (id) => {
    tabRefs.current[id]?.focus?.();
  };

  // Navegação por teclado entre as guias VISÍVEIS (a busca pode esconder algumas).
  const guiasNavegaveis = () => tabsVisiveis.filter((t) => !t.disabled);

  const ativarEFocar = (target) => {
    if (!target) return;
    onChange(target.id);
    focusTab(target.id);
  };

  const moveFocus = (tabId, delta) => {
    const enabled = guiasNavegaveis();
    if (!enabled.length) return;
    const idx = enabled.findIndex((t) => t.id === tabId);
    const base = idx >= 0 ? idx : 0;
    const next = (base + delta + enabled.length) % enabled.length;
    ativarEFocar(enabled[next]);
  };

  // Guias verticais: ↓/↑ seguem a orientação; →/← continuam funcionando (mesmo sentido).
  const onTabKeyDown = (e, tabId) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      moveFocus(tabId, 1);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      moveFocus(tabId, -1);
    } else if (e.key === "Home") {
      e.preventDefault();
      ativarEFocar(guiasNavegaveis()[0]);
    } else if (e.key === "End") {
      e.preventDefault();
      const enabled = guiasNavegaveis();
      ativarEFocar(enabled[enabled.length - 1]);
    }
  };

  const renderBotaoAba = (tab) => {
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
        <span>{tab.label}</span>
        {pendentes[tab.id] ? <span className="b1-aba-dot" title="Campos pendentes" aria-hidden="true" /> : null}
      </button>
    );
  };

  const tabButtons = tabsVisiveis.map(renderBotaoAba);

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
        className={cn(!active && "hidden", "b1-aba-cartao", motionClass)}
      >
        <div className="b1-aba-cartao__cab">
          <h3 className="b1-aba-cartao__titulo">{tab.label}</h3>
          {active && temNavegacao(navInfo) ? (
            <div className="b1-panel-tabs-rail">
              <NavegacaoDoRegistro info={navInfo} />
            </div>
          ) : null}
        </div>
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
    <div
      ref={raizRef}
      className={cn(
        "b1-panel-tabs-root b1-abas-fora b1-panel-tabs-root--sidebar",
        sidebarRecolhida && "is-sidebar-collapsed",
        className,
      )}
    >
      <aside className="b1-panel-sidebar" aria-label="Guias do formulário">
        <div className="b1-panel-sidebar__topo">
          {!sidebarRecolhida ? (
            <label className="b1-panel-sidebar__busca">
              <Search className="b1-panel-sidebar__busca-ico" aria-hidden="true" />
              <input
                type="search"
                value={buscaGuia}
                onChange={(e) => setBuscaGuia(e.target.value)}
                placeholder="Buscar guia"
                aria-label="Buscar guia"
              />
            </label>
          ) : null}
          <button
            type="button"
            className="b1-panel-sidebar__toggle"
            onClick={() => setSidebarRecolhida((v) => !v)}
            title={sidebarRecolhida ? "Expandir guias" : "Recolher guias"}
            aria-label={sidebarRecolhida ? "Expandir guias" : "Recolher guias"}
          >
            {sidebarRecolhida ? <ArrowRightFromLine className="w-4 h-4" /> : <ArrowLeftToLine className="w-4 h-4" />}
          </button>
        </div>
        {!sidebarRecolhida ? (
          <div className="b1-panel-list" role="tablist" aria-orientation="vertical">
            {tabButtons.length ? tabButtons : <span className="b1-panel-list__vazio">Nenhuma guia</span>}
          </div>
        ) : null}
      </aside>
      <div className="b1-panel-main">
        {panelsBody}
      </div>
    </div>
  );
}
