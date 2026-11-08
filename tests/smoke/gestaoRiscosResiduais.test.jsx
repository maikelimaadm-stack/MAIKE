/**
 * D-PROD-146 — riscos residuais fechados no frontend:
 *
 *  - R4: o ✓ Salvar do cabeçalho do CELULAR (desenhado pelo Layout, fora da tela)
 *    segue a regra do servidor (editar OU salvar) quando a tela declara
 *    `permissaoExplicita`; sem a declaração, a leitura do texto continua valendo;
 *  - R5: o grupo Gestão Rural e as três telas têm ícone próprio no celular;
 *  - Ativo Sim/Não: no celular o card mostra "Ativo" entre os 3 campos padrão;
 *  - R3: a mensagem do teto de centros ativos é clara.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { Package } from 'lucide-react';

const sessao = vi.hoisted(() => ({ usuario: null, permissoes: [] }));

vi.mock('@/apis/_core/nativeHttpClient.js', () => ({ nativeRequest: vi.fn(async () => []) }));
vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: () => Promise.resolve([]),
  refreshMapaCacheEntry: () => Promise.resolve([]),
  updateMapaCachedData: () => Promise.resolve([]),
  warmMapaCache: () => Promise.resolve(),
  esquecerCacheDoTenant: () => Promise.resolve(),
  CACHE_KEYS: [],
}));
vi.mock('@/apis/session', async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentUser: vi.fn(async () => sessao.usuario),
  listPermissoes: vi.fn(async () => sessao.permissoes),
}));

import { usePublishMobileShell } from '@/lib/mobileShellContext';
import { ICONE_MODULO, ICONE_TELA } from '@/components/navigation/MobileModulesView';
import { PARCEIROS_CAMPOS_CARD } from '@/components/gestao/TabelaParceiros';
import { CENTROS_CAMPOS_CARD } from '@/components/gestao/TabelaCentros';
import { NATUREZAS_CAMPOS_CARD } from '@/components/gestao/TabelaNaturezas';
import { mensagemErroGestao } from '@/lib/gestaoErros';

const operador = { id: 'u-op', login: 'vaqueiro', email: 'vaqueiro', nome: 'Vaqueiro', administrador_fazenda: false, cliente_id: 'fazenda-1' };
const soEditar = {
  id: 'p1', user_email: 'vaqueiro', is_admin: false, modulos_permitidos: ['gestao-rural'], mobile_menu_ids: [],
  permissoes_telas: [{ modulo_id: 'gestao-rural', tela_id: 'ges-parceiros', visualizar: true, novo: false, salvar: false, editar: true, excluir: false, importar: false, exportar: false }],
};

/** Tela falsa que publica um registro em edição, como o chrome Base1 faz. */
function RegistroEmEdicao({ explicita }) {
  usePublishMobileShell({ editing: true, title: 'JOÃO', formId: 'form-teste', saving: false, permissaoExplicita: explicita });
  return <form id="form-teste" data-testid="form" onSubmit={(e) => e.preventDefault()} />;
}

const renderTela = async (explicita) => {
  const { default: Layout } = await import('@/Layout');
  const { AuthProvider } = await import('@/lib/AuthContext');
  const { BootSplashProvider } = await import('@/lib/bootSplashContext');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    render(
      <MemoryRouter initialEntries={['/parceiros']}>
        <QueryClientProvider client={client}>
          <AuthProvider>
            <BootSplashProvider>
              <Routes>
                <Route path="*" element={<Layout currentPageName="Parceiros"><RegistroEmEdicao explicita={explicita} /></Layout>} />
              </Routes>
            </BootSplashProvider>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
};

const salvarDoCabecalho = () => document.querySelector('.mk-mhdr__round--salvar');

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('empresa_selecionada_id', 'empresa-smoke');
  sessao.usuario = operador;
  sessao.permissoes = [soEditar];
});

describe('R4 — ✓ Salvar do cabeçalho do celular', () => {
  it('com permissaoExplicita: quem só tem "editar" salva (o servidor aceita editar|salvar)', async () => {
    await renderTela(true);
    const botao = await vi.waitFor(() => {
      const b = salvarDoCabecalho();
      if (!b) throw new Error('sem ✓');
      return b;
    });
    expect(botao.hasAttribute('data-permissao-explicita')).toBe(true);
    await act(async () => { fireEvent.click(botao); });
    expect(screen.queryAllByText(/Ação bloqueada/i)).toHaveLength(0);
  });

  it('sem a declaração, a leitura do texto do Layout continua barrando (outras telas não mudam)', async () => {
    await renderTela(false);
    const botao = await vi.waitFor(() => {
      const b = salvarDoCabecalho();
      if (!b) throw new Error('sem ✓');
      return b;
    });
    expect(botao.hasAttribute('data-permissao-explicita')).toBe(false);
    await act(async () => { fireEvent.click(botao); });
    expect((await screen.findAllByText(/Ação bloqueada/i)).length).toBeGreaterThan(0);
  });
});

describe('R5 e Ativo nos cards', () => {
  it('grupo Gestão Rural tem ícone próprio no celular', () => {
    expect(ICONE_MODULO['gestao-rural']).toBeTruthy();
    expect(ICONE_MODULO['gestao-rural']).not.toBe(Package);
  });

  it('no celular o card mostra Ativo entre os 3 campos padrão', () => {
    const noTopo = new Set(['numero', 'nome']);
    expect(PARCEIROS_CAMPOS_CARD.filter((k) => !noTopo.has(k)).slice(0, 3)).toContain('ativo');
    expect(CENTROS_CAMPOS_CARD.filter((k) => !noTopo.has(k)).slice(0, 3)).toEqual(['pai', 'descricao', 'ativo']);
    // D-PROD-152: Naturezas — Tipo, Pai e Ativo.
    expect(NATUREZAS_CAMPOS_CARD.filter((k) => !noTopo.has(k)).slice(0, 3)).toEqual(['tipo', 'pai', 'ativo']);
  });

  it('as quatro telas de Gestão Rural têm ícone próprio no celular (P2: Naturezas Financeiras)', () => {
    for (const url of ['Parceiros', 'CentrosCusto', 'CentrosResultado', 'NaturezasFinanceiras']) {
      expect(ICONE_TELA[url], url).toBeTruthy();
      expect(ICONE_TELA[url]).not.toBe(Package);
    }
    expect(new Set(['CentrosCusto', 'CentrosResultado', 'NaturezasFinanceiras'].map((u) => ICONE_TELA[u])).size).toBe(3);
  });

  it('R3: mensagem do teto de centros ativos', () => {
    const erro = { cause: { code: 'CENTRO_LIMITE_ATIVOS', details: { limite: 1000, ativos: 1000 } } };
    expect(mensagemErroGestao(erro, 'x')).toMatch(/1000 centros ativos/);
  });
});
