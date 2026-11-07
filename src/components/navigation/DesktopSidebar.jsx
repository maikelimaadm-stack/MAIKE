import React from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ChevronDown, Folder, Home, Pin, PinOff, Search } from "lucide-react";
import { createPageUrl } from "@/utils";
import { ICONE_MODULO } from "@/components/navigation/MobileModulesView";

const ICONE_DO_MODULO = /** @type {Record<string, React.ComponentType<any>>} */ (ICONE_MODULO);
/** @typedef {{ id: string, title: string, url?: string }} PaginaMenu */
/** @typedef {{ id: string, title: string, url?: string, submenu?: PaginaMenu[] }} ItemMenu */
/**
 * Hover na marca do cabeçalho mostra o menu sem reservar espaço.
 * Fixar transforma o menu em coluna; sem fixar não existe trilho de ícones.
 * @param {{items: ItemMenu[], currentPath: string, onNavigate: (event: React.MouseEvent, path: string) => void, collapsed: boolean, onToggle: () => void, onSearch: () => void, triggerHost?: HTMLElement | null}} props
 */
export default function DesktopSidebar({ items, currentPath, onNavigate, collapsed, onToggle, onSearch, triggerHost }) {
  const telas = (item) => item.submenu?.length ? item.submenu.filter(p => Boolean(p.url)) : item.url ? [{ id: item.id, title: item.title, url: item.url }] : [];
  const ativo = (page) => currentPath === createPageUrl(page.url);
  const moduloAtual = items.find(item => telas(item).some(ativo))?.id || null;
  const [abertoId, setAbertoId] = React.useState(moduloAtual);
  const [espiando, setEspiando] = React.useState(false);
  const [topo, setTopo] = React.useState(52);
  const timer = React.useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const expandido = !collapsed || espiando;
  const cancelarFechamento = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  React.useEffect(() => cancelarFechamento, []);
  React.useEffect(() => setAbertoId(moduloAtual), [moduloAtual]);
  React.useEffect(() => { if (!collapsed) setEspiando(false); }, [collapsed]);
  const abrir = (event) => {
    cancelarFechamento();
    const el = event.currentTarget;
    const header = el.closest('header');
    if (header) setTopo(header.getBoundingClientRect().bottom);
    if (collapsed) setEspiando(true);
  };
  const fecharDepois = () => {
    cancelarFechamento();
    if (collapsed) timer.current = setTimeout(() => setEspiando(false), 200);
  };
  const alternar = () => { cancelarFechamento(); setEspiando(!collapsed); onToggle(); };
  const marca = (cabecalho) => <button type="button" className="mk-sidebar-brand relative grid h-[38px] w-[38px] shrink-0 place-items-center rounded-lg text-[#64748b]"
    aria-label={cabecalho ? 'Menu principal' : collapsed ? 'Fixar menu' : 'Desafixar menu'}
    title={collapsed ? 'Fixar menu' : 'Desafixar menu'} aria-controls="app-shell-sidebar" aria-expanded={expandido} aria-pressed={!collapsed}
    onMouseEnter={abrir} onFocus={abrir} onClick={alternar}>
    <img src="/brand/mak-gestao-simbolo.png" alt="MAK Gestão" className="mk-sidebar-brand-logo h-8 w-8 object-contain" />
    <span className="mk-sidebar-brand-pin absolute inset-0 grid place-items-center" aria-hidden>{collapsed ? <Pin size={19} /> : <PinOff size={19} />}</span>
  </button>;
  React.useEffect(() => {
    const header = triggerHost?.closest('header');
    if (!header) return;
    const sync = () => setTopo(Math.round(header.getBoundingClientRect().bottom));
    sync();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(sync);
    observer.observe(header);
    return () => observer.disconnect();
  }, [triggerHost]);
  const controle = <div className="mk-sidebar-header hidden lg:flex">
    <div className="mk-sidebar-trigger" onMouseEnter={abrir} onMouseLeave={fecharDepois} onBlurCapture={fecharDepois}>{marca(true)}</div>
    <div className="mk-sidebar-wordmark"><strong>MAK Gestão</strong><span>Plataforma de gestão rural</span></div>
    <button type="button" className="mk-sidebar-search" onClick={onSearch} aria-label="Pesquisar telas" title="Pesquisar telas (Ctrl K)"><Search size={18} aria-hidden /></button>
  </div>;
  return <>
    {triggerHost ? createPortal(controle, triggerHost) : triggerHost === undefined ? controle : null}
    <div className={`mk-desktop-sidebar-frame relative hidden shrink-0 lg:block ${collapsed ? 'w-0' : 'w-[240px]'}`}>
      <nav id="app-shell-sidebar" aria-label="Módulos" aria-hidden={!expandido}
        data-collapsed={!expandido ? 'true' : 'false'} data-pinned={!collapsed ? 'true' : 'false'} data-peeking={collapsed && espiando ? 'true' : 'false'}
        style={expandido ? { top: topo } : undefined}
        className={`mk-desktop-sidebar relative flex h-full w-[240px] flex-col ${expandido ? '' : 'invisible pointer-events-none'}`}
        onMouseEnter={() => cancelarFechamento()} onMouseLeave={fecharDepois}
        onFocusCapture={cancelarFechamento} onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) fecharDepois(); }}
        onKeyDown={(e) => { if (e.key === 'Escape' && collapsed) setEspiando(false); }}>
        <div className="px-3 py-2"><Link to={createPageUrl('MapaGeral')} onClick={e => onNavigate(e, createPageUrl('MapaGeral'))} aria-current={currentPath === createPageUrl('MapaGeral') ? 'page' : undefined} className="flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13px]"><Home size={20} /><span>Início</span></Link></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5">
          <div className="px-3 pb-2 pt-2 text-[11px] font-semibold text-[#64748b]">Módulos</div>
          {items.map(item => {
            const Icon = ICONE_DO_MODULO[item.id] || Folder;
            const aberto = abertoId === item.id;
            return <section key={item.id}>
              <button type="button" aria-expanded={aberto} onClick={() => setAbertoId(aberto ? null : item.id)} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left">
                <Icon size={20} /><span className="min-w-0 flex-1 truncate text-[13px]">{item.title}</span><ChevronDown size={15} className={aberto ? 'rotate-180' : ''} />
              </button>
              {aberto && <div className="mk-sidebar-children flex flex-col gap-0.5 py-1">{telas(item).map(page => <Link key={page.id} to={createPageUrl(page.url)} onClick={e => onNavigate(e, createPageUrl(page.url))} aria-current={ativo(page) ? 'page' : undefined} className="flex h-9 items-center rounded-lg pl-[42px] pr-3 text-[13px]"><span className="truncate">{page.title}</span></Link>)}</div>}
            </section>;
          })}
        </div>
      </nav>
    </div>
  </>;
}
