import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Folder, Home, Search } from 'lucide-react';
import { Root, Trigger, Content, Portal } from '@radix-ui/react-popover';
import { createPageUrl } from '@/utils';
import { ICONE_MODULO } from './MobileModulesView';

/**
 * Menu horizontal permanente. As telas dos módulos abrem somente no clique.
 * @param {{ items: Array<{id: string, title: string, url?: string, submenu?: Array<{id: string, title: string, url?: string}>}>, currentPath: string, onNavigate: (e: React.MouseEvent, path: string) => void, onSearch: () => void, children?: React.ReactNode }} props
 */
export default function DesktopNavigation({ items, currentPath, onNavigate, onSearch, children }) {
  const [aberto, setAberto] = React.useState(/** @type {string | null} */ (null));
  const icons = /** @type {Record<string, React.ComponentType<any>>} */ (ICONE_MODULO);
  const navegar = (e, url) => { onNavigate(e, createPageUrl(url)); setAberto(null); };
  return <div className="mk-desktop-menu hidden lg:block">
    <div className="mk-desktop-menu-main">
      <Link to={createPageUrl('MapaGeral')} onClick={e => navegar(e, 'MapaGeral')} className="mk-desktop-menu-brand" aria-label="Início MAK Gestão">
        <img src="/brand/mak-gestao-simbolo.png" alt="" /><strong>MAK Gestão</strong>
      </Link>
      <button type="button" className="mk-desktop-menu-search" onClick={onSearch} aria-label="Pesquisar telas" title="Pesquisar telas (Ctrl K)"><Search size={18} aria-hidden /></button>
      <div className="mk-desktop-menu-account">{children}</div>
    </div>
    <nav className="mk-desktop-menu-links" aria-label="Módulos">
      <Link to={createPageUrl('MapaGeral')} onClick={e => navegar(e, 'MapaGeral')} aria-current={currentPath === createPageUrl('MapaGeral') ? 'page' : undefined}><Home size={18} aria-hidden />Início</Link>
      {items.map(item => {
        const Icon = icons[item.id] || Folder;
        const pages = item.submenu?.length ? item.submenu.filter(p => p.url) : item.url ? [{id:item.id,title:item.title,url:item.url}] : [];
        const active = pages.some(p => currentPath === createPageUrl(p.url));
        return <Root key={item.id} open={aberto === item.id} onOpenChange={open => setAberto(open ? item.id : null)}>
          <Trigger asChild><button type="button" data-active={active} aria-label={item.title}><Icon size={18} aria-hidden /><span>{item.title}</span><ChevronDown size={13} aria-hidden /></button></Trigger>
          <Portal><Content className="mk-desktop-menu-options" align="start" sideOffset={5} collisionPadding={8} aria-label={item.title}>
            {pages.map(page => <Link key={page.id} to={createPageUrl(page.url)} onClick={e => navegar(e, page.url)} aria-current={currentPath === createPageUrl(page.url) ? 'page' : undefined}>{page.title}</Link>)}
          </Content></Portal>
        </Root>;
      })}
    </nav>
  </div>;
}
