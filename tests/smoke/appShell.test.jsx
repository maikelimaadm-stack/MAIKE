/**
 * App Shell — navegação sobre o mapa (P1.2-R2).
 *
 * O bloqueador era de runtime, não de dado: `MapaGeral` retornava
 * `fixed inset-0 z-50`, o que tira a página do fluxo do `Layout` e a empilha
 * acima do cabeçalho, do menu e da navegação móvel. O usuário abria o sistema,
 * via só o mapa e não tinha como voltar.
 *
 * JSDOM não calcula layout, então cobertura por classe sozinha não prova nada
 * sobre pixels. A combinação usada aqui é: contrato estrutural (a raiz da
 * página não pode ser overlay global) + comportamento real (clicar abre o
 * Sheet, clicar em item navega, o mapa desmonta).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import React from 'react';

vi.mock('@/api/base44Client', async () => {
  const { createBase44Stub } = await import('./base44Stub.js');
  return { base44: createBase44Stub() };
});
vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: () => Promise.resolve([]),
  refreshMapaCacheEntry: () => Promise.resolve([]),
  updateMapaCachedData: () => Promise.resolve([]),
  warmMapaCache: () => Promise.resolve(),
  CACHE_KEYS: [],
}));

const fonte = (rel) => readFileSync(rel, 'utf8');
/** Sem comentários: o texto explicativo cita as formas proibidas de propósito. */
const codigoDe = (rel) =>
  fonte(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const MAPA_GERAL = 'src/pages/MapaGeral.jsx';
const LAYOUT = 'src/Layout.jsx';

/** Raiz do JSX retornado pela página — a primeira linha depois do `return (`. */
const raizDaPagina = (rel) => {
  const codigo = codigoDe(rel);
  const idx = codigo.lastIndexOf('\n  return (');
  expect(idx).toBeGreaterThan(-1);
  return codigo.slice(idx, idx + 400);
};

// ── Sonda de rota: prova mudança de pathname sem depender de texto de página ──
let rotaAtual = null;
const SondaDeRota = () => {
  rotaAtual = useLocation().pathname;
  return null;
};

const PaginaFalsa = ({ nome }) => <div data-testid={`pagina-${nome}`}>{nome}</div>;

/** Clique real no DOM. Sem `user-event`: não é dependência do projeto. */
const clicar = async (elemento) => {
  await act(async () => {
    fireEvent.click(elemento);
  });
};

const renderShell = async (rotaInicial = '/mapageral') => {
  const { default: Layout } = await import('@/Layout');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  let utils;
  await act(async () => {
    utils = render(
    <MemoryRouter initialEntries={[rotaInicial]}>
      <QueryClientProvider client={client}>
        <SondaDeRota />
        <Routes>
          <Route
            path="*"
            element={
              <Layout currentPageName="MapaGeral">
                <Routes>
                  <Route path="/mapageral" element={<PaginaFalsa nome="mapa" />} />
                  <Route path="/mapacadastro" element={<PaginaFalsa nome="cadastro" />} />
                  <Route path="/cadastrolotes" element={<PaginaFalsa nome="lotes" />} />
                  <Route path="*" element={<PaginaFalsa nome="outra" />} />
                </Routes>
              </Layout>
            }
          />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
    );
  });
  return utils;
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('empresa_selecionada_id', 'empresa-smoke');
  rotaAtual = null;
});
afterEach(() => vi.unstubAllEnvs());

describe('SHELL — a página do mapa vive dentro do shell', () => {
  it('SHELL1 — a raiz de MapaGeral não é overlay global', () => {
    const raiz = raizDaPagina(MAPA_GERAL);
    expect(raiz).not.toMatch(/fixed\s+inset-0/);
    expect(raiz).not.toMatch(/\bz-50\b/);
  });

  it('SHELL2 — a raiz respeita a altura do contêiner do Layout', () => {
    const raiz = raizDaPagina(MAPA_GERAL);
    expect(raiz).toMatch(/\brelative\b/);
    expect(raiz).toMatch(/\bh-full\b/);
    expect(raiz).toMatch(/\bmin-h-0\b/);
  });

  it('SHELL2b — nenhum position:fixed na raiz; dialogs seguem usando portal', () => {
    const codigo = codigoDe(MAPA_GERAL);
    // Sheets e Dialogs continuam com `fixed z-50` — são portais, não a raiz.
    expect(codigo).toMatch(/DialogContent|SheetContent/);
    expect(raizDaPagina(MAPA_GERAL)).not.toContain('fixed');
  });

  it('SHELL3 — o Layout monta header, main e navegação móvel', async () => {
    await renderShell();
    await waitFor(() => expect(screen.getByRole('main')).toBeInTheDocument());
    expect(document.querySelector('header')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: /navegação inferior/i })).toBeInTheDocument();
  });

  it('SHELL4 — com menu visível, os módulos do desktop estão acessíveis', async () => {
    localStorage.setItem('menu_oculto', 'false');
    await renderShell();
    const menuDesktop = await screen.findByRole('navigation', { name: /módulos/i });
    expect(menuDesktop.className).not.toMatch(/md:h-0/);
  });

  it('SHELL5 — com menu oculto, o botão de reabrir continua acessível', async () => {
    localStorage.setItem('menu_oculto', 'true');
    await renderShell();
    expect(await screen.findByRole('button', { name: /mostrar menu principal/i })).toBeInTheDocument();
  });

  it('SHELL5b — valor inválido em menu_oculto cai no default seguro', async () => {
    localStorage.setItem('menu_oculto', 'talvez');
    await renderShell();
    // Default seguro = menu visível, com o botão de ocultar disponível.
    expect(await screen.findByRole('button', { name: /ocultar menu principal/i })).toBeInTheDocument();
  });
});

describe('MOBILE — o menu completo é alcançável', () => {
  it('MOBILE1 — existe chamada executável que abre o Sheet', () => {
    expect(codigoDe(LAYOUT)).toMatch(/setMobileMenuOpen\(true\)/);
  });

  it('MOBILE3 — o gatilho tem accessible name', async () => {
    await renderShell();
    const botao = await screen.findByRole('button', { name: /abrir menu principal/i });
    expect(botao).toBeInTheDocument();
  });

  it('MOBILE2 — clicar no gatilho abre o Sheet', async () => {
    await renderShell();

    const botao = await screen.findByRole('button', { name: /abrir menu principal/i });
    expect(screen.queryByRole('dialog')).toBeNull();

    await clicar(botao);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('MOBILE3b — o gatilho reflete o estado aberto', async () => {
    await renderShell();
    const botao = await screen.findByRole('button', { name: /abrir menu principal/i });

    expect(botao).toHaveAttribute('aria-expanded', 'false');
    await clicar(botao);
    await screen.findByRole('dialog');
    expect(botao).toHaveAttribute('aria-expanded', 'true');
  });

  it('MOBILE4/MOBILE5 — clicar em MapaCadastro navega e fecha o Sheet', async () => {
    await renderShell();

    await clicar(await screen.findByRole('button', { name: /abrir menu principal/i }));
    const painel = await screen.findByRole('dialog');

    await clicar(within(painel).getByRole('link', { name: /cadastro do mapa|mapa cadastro|cadastro/i }));

    await waitFor(() => expect(rotaAtual).toBe('/mapacadastro'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('MOBILE6 — a navegação inferior leva a outro módulo', async () => {
    await renderShell();

    const navInferior = await screen.findByRole('navigation', { name: /navegação inferior/i });
    const links = within(navInferior).getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);

    await clicar(links[links.length - 1]);
    await waitFor(() => expect(rotaAtual).not.toBe('/mapageral'));
  });

  it('MOBILE7 — a navegação inferior não é coberta pela página', () => {
    const layout = codigoDe(LAYOUT);
    // A nav inferior é fixa; a página não pode competir com ela por empilhamento.
    expect(layout).toMatch(/fixed bottom-0[^"]*md:hidden/);
    expect(raizDaPagina(MAPA_GERAL)).not.toMatch(/\bz-\d+\b/);
  });
});

describe('NAV — sair do mapa e voltar', () => {
  it('NAV1 — o cabeçalho continua clicável com o mapa montado', async () => {
    await renderShell();
    const botao = await screen.findByRole('button', { name: /abrir menu principal/i });
    // Se algo cobrisse o shell, o clique não chegaria ao gatilho.
    await clicar(botao);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('NAV2/NAV3 — a página do mapa desmonta ao navegar e volta a montar', async () => {
    await renderShell();
    expect(await screen.findByTestId('pagina-mapa')).toBeInTheDocument();

    await clicar(await screen.findByRole('button', { name: /abrir menu principal/i }));
    const painel = await screen.findByRole('dialog');
    await clicar(within(painel).getByRole('link', { name: /cadastro do mapa|mapa cadastro|cadastro/i }));

    await waitFor(() => expect(screen.queryByTestId('pagina-mapa')).toBeNull());
    expect(await screen.findByTestId('pagina-cadastro')).toBeInTheDocument();

    await clicar(await screen.findByRole('button', { name: /abrir menu principal/i }));
    const painel2 = await screen.findByRole('dialog');
    await clicar(within(painel2).getByRole('link', { name: /mapa geral/i }));
    await waitFor(() => expect(rotaAtual).toBe('/mapageral'));
    expect(await screen.findByTestId('pagina-mapa')).toBeInTheDocument();
  });

  it('NAV4 — o padrão de rota não mudou', async () => {
    const { createPageUrl } = await import('@/utils');
    expect(createPageUrl('MapaGeral')).toBe('/mapageral');
    expect(createPageUrl('MapaCadastro')).toBe('/mapacadastro');
    expect(createPageUrl('CadastroLotes')).toBe('/cadastrolotes');
  });
});

/**
 * ENV — o contrato de deploy é documentação executável.
 *
 * O sintoma que originou a P1.2-R1 foi de configuração de plataforma, não de
 * código. Estes testes impedem que o `.env.example` volte a ficar incompleto ou
 * a sugerir que uma variável configurada em um serviço vale para os outros.
 */
describe('ENV — contrato de variáveis e topologia de deploy', () => {
  const envExample = () => fonte('.env.example');
  /**
   * Texto corrido: o arquivo quebra frases em várias linhas de comentário, e a
   * asserção fala sobre o que está escrito, não sobre onde a linha terminou.
   */
  const prosaDoEnvExample = () =>
    envExample().replace(/^\s*#\s?/gm, '').replace(/\s+/g, ' ');

  it('ENV1 — as três variáveis consumidas estão documentadas', () => {
    const texto = envExample();
    for (const nome of ['VITE_GOOGLE_MAPS_API_KEY', 'VITE_BASE44_APP_ID', 'VITE_BASE44_BACKEND_URL']) {
      expect(texto).toMatch(new RegExp(`^${nome}=`, 'm'));
    }
  });

  it('ENV1b — toda VITE_ lida pelo código está no .env.example', () => {
    const lidas = [...codigoDe('src/config/runtimeConfig.js').matchAll(/import\.meta\.env\.(VITE_\w+)/g)]
      .map((m) => m[1]);
    expect(lidas.length).toBeGreaterThan(0);
    const documentadas = new Set([...envExample().matchAll(/^(VITE_\w+)=/gm)].map((m) => m[1]));
    expect(lidas.filter((nome) => !documentadas.has(nome))).toEqual([]);
  });

  it('ENV2 — nenhuma variável traz valor real', () => {
    const atribuicoes = [...envExample().matchAll(/^(VITE_\w+)=(.*)$/gm)];
    expect(atribuicoes.length).toBeGreaterThan(0);
    for (const [, nome, valor] of atribuicoes) {
      expect(`${nome}=${valor.trim()}`).toBe(`${nome}=`);
    }
    expect(envExample()).not.toMatch(/AIza/);
  });

  it('ENV3 — nenhum segredo de backend é prefixado com VITE_', () => {
    const texto = envExample();
    expect(texto).not.toMatch(/^VITE_\w*(DATABASE|SECRET|PASSWORD|PRIVATE)\w*=/mi);
    expect(texto).not.toMatch(/^DATABASE_URL=/m);
    // E o aviso de que o prefixo publica precisa estar escrito.
    expect(texto).toMatch(/DATABASE_URL/);
    expect(texto).toMatch(/p[úu]blic/i);
  });

  it('ENV4 — Vercel Preview e Production são tratados como ambientes separados', () => {
    const texto = envExample();
    expect(texto).toMatch(/Vercel Preview/);
    expect(texto).toMatch(/Vercel Production/);
    expect(prosaDoEnvExample()).toMatch(/independentes|separad/i);
  });

  it('ENV5 — Railway frontend e backend são tratados como serviços separados', () => {
    const texto = envExample();
    expect(texto).toMatch(/Railway \(frontend\)/);
    expect(texto).toMatch(/Railway \(backend\)/);
    expect(prosaDoEnvExample()).toMatch(/N[ÃA]O entra no bundle do frontend/i);
  });

  it('ENV6 — o .env.example explica que VITE_ é lida no build', () => {
    expect(prosaDoEnvExample()).toMatch(/vari[áa]vel de \*\*build\*\*|lido no momento do `npm run build`/i);
  });

  it('nenhum .env com valor está versionado', async () => {
    const { execSync } = await import('node:child_process');
    const versionados = execSync('git ls-files', { encoding: 'utf8' })
      .split('\n')
      .filter((f) => /(^|\/)\.env($|\.)/.test(f));
    expect(versionados).toEqual(['.env.example']);
  });
});
