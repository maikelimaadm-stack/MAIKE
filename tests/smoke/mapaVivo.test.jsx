/**
 * D-PROD-305 — o Mapa Geral fica vivo ao trocar de menu: voltar não recria o mapa.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

const montagens = { mapa: 0 };
vi.mock('@/pages.config', () => {
  const MapaFalso = ({ ativo }) => {
    React.useEffect(() => {
      montagens.mapa += 1;
    }, []);
    return <div data-testid="mapa">{ativo ? 'mapa-ativo' : 'mapa-inerte'}</div>;
  };
  const LotesFalso = () => <div data-testid="lotes">lotes</div>;
  return { pagesConfig: { mainPage: 'MapaGeral', Pages: { MapaGeral: MapaFalso, CadastroLotes: LotesFalso } } };
});

let navegar;
const Captura = () => {
  navegar = useNavigate();
  return null;
};

describe('D-PROD-305 — Mapa Geral vivo entre menus', () => {
  it('MV-01 mapa → lotes → mapa: monta uma vez só; fora do mapa fica escondido e inerte', async () => {
    const { default: AppRouteContent } = await import('@/components/navigation/AppRouteContent');
    const { pagesConfig } = await import('@/pages.config');
    const { createPageUrl } = await import('@/utils');
    render(
      <MemoryRouter initialEntries={[createPageUrl('MapaGeral')]}>
        <Captura />
        <Routes>
          <Route element={<AppRouteContent />}>
            {Object.entries(pagesConfig.Pages).map(([nome, Page]) => (
              <Route key={nome} path={createPageUrl(nome)} element={<Page />} />
            ))}
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('mapa')).toHaveTextContent('mapa-ativo');
    expect(montagens.mapa).toBe(1);

    act(() => navegar(createPageUrl('CadastroLotes')));
    expect(screen.getByTestId('lotes')).toBeInTheDocument();
    expect(screen.getByTestId('mapa')).toHaveTextContent('mapa-inerte');
    expect(screen.getByTestId('mapa').parentElement).toHaveStyle({ display: 'none' });

    act(() => navegar(createPageUrl('MapaGeral')));
    expect(screen.queryByTestId('lotes')).toBeNull();
    expect(screen.getAllByTestId('mapa')).toHaveLength(1); // não duplica com o Outlet
    expect(screen.getByTestId('mapa')).toHaveTextContent('mapa-ativo');
    expect(montagens.mapa).toBe(1); // não recriou
  });

  it('MV-02 abrir o app direto em outro menu não monta o mapa até a pessoa ir até ele', async () => {
    montagens.mapa = 0;
    const { default: AppRouteContent } = await import('@/components/navigation/AppRouteContent');
    const { pagesConfig } = await import('@/pages.config');
    const { createPageUrl } = await import('@/utils');
    render(
      <MemoryRouter initialEntries={[createPageUrl('CadastroLotes')]}>
        <Routes>
          <Route element={<AppRouteContent />}>
            {Object.entries(pagesConfig.Pages).map(([nome, Page]) => (
              <Route key={nome} path={createPageUrl(nome)} element={<Page />} />
            ))}
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('lotes')).toBeInTheDocument();
    expect(screen.queryByTestId('mapa')).toBeNull();
    expect(montagens.mapa).toBe(0);
  });
});
