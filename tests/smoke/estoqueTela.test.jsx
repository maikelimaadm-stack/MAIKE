/**
 * D-PROD-255 — tela Estoque (Saldo + Movimentos) montada de verdade: página, motor Base1 (CadastroBase1Screen →
 * lista → grade), service, API, porta e nativeHttpClient reais sobre o backend falso `estoqueConsultaFake`.
 * Mocks só da borda: sessão e permissão.
 *
 *  - abas: Saldo, Movimentos e Entradas (D-PROD-257); nenhuma aba de Inventário;
 *  - Saldo: produto × depósito, quantidade na unidade do produto, custo e valor em R$; query EXATA;
 *  - clicar numa linha do Saldo abre os Movimentos filtrados por produto e depósito;
 *  - clicar num movimento abre UMA janela só (680px; tela cheia no celular), somente leitura;
 *  - sem `visualizar` da tela sup-estoque: nada é lido; o item de menu só existe com a permissão.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { API_FAKE, escolherOpcao, instalarBackendFake } from './fixtures/gestaoBackendFake.js';
import { rotearEstoque } from './fixtures/estoqueConsultaFake.js';
import { DEFAULT_MENU, flattenMenuPages } from '@/lib/menuConfig';
import { canAccessPage } from '@/lib/permissions';

const sessao = vi.hoisted(() => ({ permissao: /** @type {any} */ (null), clienteId: 'cli-1' }));

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ clienteId: sessao.clienteId, user: { id: 'u1' } }) }));
vi.mock('@/services/sessionService', async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentUser: vi.fn(async () => ({ login: 'operador', cliente_id: sessao.clienteId })),
  carregarPermissaoEfetiva: vi.fn(() => Promise.resolve(sessao.permissao)),
}));

const permissaoCom = (visualizar = true) => ({
  user_email: 'operador',
  modulos_permitidos: ['suporte-mapa'],
  permissoes_telas: [{ modulo_id: 'suporte-mapa', tela_id: 'sup-estoque', visualizar, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false }],
});

/** @type {{ chamadas: any[] }} */
let backend;
const matchMediaOriginal = window.matchMedia;

const celular = (ligado) => {
  window.matchMedia = /** @type {any} */ ((q) => ({ matches: ligado && /max-width:\s*639px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
};

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem('empresa_selecionada_id', 'emp-1');
  window.localStorage.setItem('empresa_selecionada_cliente_id', 'cli-1');
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  sessao.permissao = permissaoCom(true);
  backend = instalarBackendFake(rotearEstoque);
  celular(false);
});

afterEach(() => {
  cleanup();
  window.matchMedia = matchMediaOriginal;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const montar = async () => {
  const { default: Pagina } = await import('@/pages/Estoque.jsx');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Toaster />
        <Pagina />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};
const chamadasDe = (caminho) => backend.chamadas.filter((c) => c.method === 'GET' && c.path === caminho);
const esperar = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe('D-PROD-255 — abas e Saldo', () => {
  it('as abas Saldo, Movimentos e Entradas (sem Inventário) e o Saldo lista produto × depósito com unidade, custo e valor', async () => {
    await montar();
    const abas = await screen.findByTestId('estoque-abas');
    expect(within(abas).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Saldo', 'Movimentos', 'Entradas']);
    expect(screen.queryByRole('tab', { name: /Inventário/ })).toBeNull();
    expect(within(abas).getByTestId('estoque-aba-saldo').getAttribute('aria-selected')).toBe('true');

    expect(await screen.findByText('Diesel S10')).toBeTruthy();
    expect(screen.getByText('Ureia')).toBeTruthy();
    expect(screen.getByText('4.850 L')).toBeTruthy();
    expect(screen.getByText('2.400 kg')).toBeTruthy();
    expect(screen.getByText('R$ 28.712,00')).toBeTruthy();
    expect(screen.getByText('R$ 5,92')).toBeTruthy();
    // a consulta vai com a fazenda e o padrão "só com saldo" (nenhum parâmetro extra)
    expect(chamadasDe('/estoque/saldo')[0].query).toEqual({ empresa_id: 'emp-1', limit: expect.any(String) });
    // somente consulta: nada de Novo, Editar ou Excluir
    expect(screen.queryByRole('button', { name: /^Novo/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Excluir|Duplicar/ })).toBeNull();
  });

  it('o filtro de depósito da faixa manda local_estoque_id ao servidor', async () => {
    await montar();
    await screen.findByText('Diesel S10');
    await escolherOpcao(await screen.findByRole('combobox', { name: 'Filtrar por depósito' }), 'Tanque diesel sede');
    await waitFor(() => expect(chamadasDe('/estoque/saldo').some((c) => c.query.local_estoque_id === 'l-tanque')).toBe(true));
    await waitFor(() => expect(screen.queryByText('Ureia')).toBeNull());
    expect(screen.getByText('Diesel S10')).toBeTruthy();
  });
});

describe('D-PROD-255 — do Saldo para os Movimentos', () => {
  it('clicar numa linha do Saldo abre os Movimentos do produto e do depósito', async () => {
    await montar();
    const linha = (await screen.findByText('Ureia')).closest('tr');
    fireEvent.doubleClick(/** @type {HTMLElement} */ (linha));
    await waitFor(() => expect(screen.getByTestId('estoque-aba-movimentos').getAttribute('aria-selected')).toBe('true'));
    await waitFor(() => expect(chamadasDe('/estoque/movimentos').length).toBeGreaterThan(0));
    const q = chamadasDe('/estoque/movimentos')[0].query;
    expect(q).toMatchObject({ empresa_id: 'emp-1', produto_id: 'p-ureia', local_estoque_id: 'l-galpao' });
    expect(await screen.findByText('Transferência (saída)')).toBeTruthy();
    expect(screen.queryByText('Abastecimento')).toBeNull();
    // datas em DD/MM/AAAA
    expect(screen.getByText('10/11/2026')).toBeTruthy();
  });

  it('o ⚡ da linha ("Ver movimentos") faz o mesmo, sem precisar do duplo clique', async () => {
    await montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Ações do saldo de Diesel S10 em Tanque diesel sede' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Ver movimentos' }));
    await waitFor(() => expect(chamadasDe('/estoque/movimentos').length).toBeGreaterThan(0));
    expect(chamadasDe('/estoque/movimentos')[0].query).toMatchObject({ produto_id: 'p-diesel', local_estoque_id: 'l-tanque' });
    expect(await screen.findByText('Abastecimento')).toBeTruthy();
  });

  it('voltar para a aba Saldo e abrir Movimentos pela aba mostra tudo, sem o filtro da linha', async () => {
    await montar();
    fireEvent.doubleClick((await screen.findByText('Ureia')).closest('tr'));
    await screen.findByText('Transferência (saída)');
    fireEvent.click(screen.getByTestId('estoque-aba-saldo'));
    await screen.findByText('Diesel S10');
    backend.chamadas.length = 0;
    fireEvent.click(screen.getByTestId('estoque-aba-movimentos'));
    await waitFor(() => expect(chamadasDe('/estoque/movimentos').length).toBeGreaterThan(0));
    expect(chamadasDe('/estoque/movimentos')[0].query.produto_id).toBeUndefined();
  });

  it('trocar de fazenda descarta o produto e o depósito abertos no Saldo', async () => {
    const { persistirEmpresaSelecionada } = await import('@/hooks/useEmpresaSelecionadaId');
    await montar();
    fireEvent.doubleClick((await screen.findByText('Ureia')).closest('tr'));
    await waitFor(() => expect(chamadasDe('/estoque/movimentos')[0].query).toMatchObject({ empresa_id: 'emp-1', produto_id: 'p-ureia', local_estoque_id: 'l-galpao' }));
    backend.chamadas.length = 0;
    await act(async () => { persistirEmpresaSelecionada('emp-2', 'cli-1'); });
    await waitFor(() => expect(chamadasDe('/estoque/saldo').some((c) => c.query.empresa_id === 'emp-2')).toBe(true));
    expect(screen.getByTestId('estoque-aba-saldo').getAttribute('aria-selected')).toBe('true');
    expect(chamadasDe('/estoque/movimentos').some((c) => c.query.empresa_id === 'emp-2' && c.query.produto_id)).toBe(false);
  });
});

describe('D-PROD-255 — Movimentos e a janela do movimento', () => {
  const abrirMovimentos = async () => {
    await montar();
    fireEvent.click(await screen.findByTestId('estoque-aba-movimentos'));
    await screen.findByText('Estorno da compra');
  };

  it('o kardex mostra tipo, quantidade com sinal, saldo e situação; o par original ↔ estorno é visível', async () => {
    await abrirMovimentos();
    expect(screen.getByText('Estorno da compra')).toBeTruthy();
    expect(screen.getByText('Estornada')).toBeTruthy();
    expect(screen.getByText('− 180 L')).toBeTruthy();
    expect(screen.getByText('+ 5.000 L')).toBeTruthy();
    expect(chamadasDe('/estoque/movimentos')[0].query).toEqual({ empresa_id: 'emp-1', limit: expect.any(String) });
  });

  it('clicar num movimento abre UMA janela somente leitura (sem rodapé de gravar), com saldo, camadas e o link do documento', async () => {
    await abrirMovimentos();
    fireEvent.doubleClick(screen.getByText('105').closest('tr'));
    const janela = await screen.findByTestId('janela-movimento-estoque');
    expect(within(janela).getByText('Movimento nº 105')).toBeTruthy();
    await within(janela).findByTestId('movimento-camada-0');
    expect(within(janela).getByTestId('movimento-saldo-antes').textContent).toBe('5.030 L');
    expect(within(janela).getByTestId('movimento-saldo-depois').textContent).toBe('4.850 L');
    expect(within(janela).getByTestId('movimento-quantidade').textContent).toBe('− 180 L');
    expect(within(janela).getByTestId('movimento-data').textContent).toBe('12/11/2026');
    expect(within(janela).getByTestId('movimento-valor')).toHaveTextContent('R$ 1.065,60');
    expect(within(janela).getByTestId('movimento-camada-1')).toHaveTextContent('150 L × R$ 5,9433');
    const link = within(janela).getByRole('link', { name: 'Abastecimento nº 12' });
    expect(link.getAttribute('href')).toBe('/abastecimentos');
    expect(chamadasDe('/estoque/movimentos/m5')[0].query).toEqual({ empresa_id: 'emp-1' });
    // desktop: janela de 680px (classe padrão), sem tela cheia; só um diálogo aberto
    expect(janela.querySelector('.b1-janela')?.className).not.toContain('b1-janela--tela-cheia');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(janela).queryByRole('button', { name: /Salvar|Gravar|Excluir|Editar/ })).toBeNull();
    fireEvent.click(within(janela).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByTestId('janela-movimento-estoque')).toBeNull());
  });

  it('o estorno mostra o movimento original no detalhe', async () => {
    await abrirMovimentos();
    fireEvent.doubleClick(screen.getByText('103').closest('tr'));
    const janela = await screen.findByTestId('janela-movimento-estoque');
    expect((await within(janela).findByTestId('movimento-pai')).textContent).toContain('Nº 102 — Compra (500 kg)');
  });

  it('no celular a janela ocupa a tela (b1-janela--tela-cheia)', async () => {
    celular(true);
    await montar();
    // no celular a lista nasce em cartões; as abas continuam
    fireEvent.click(await screen.findByTestId('estoque-aba-movimentos'));
    const cartao = (await screen.findAllByText('Diesel S10'))[0];
    fireEvent.doubleClick(cartao.closest('[data-testid="b1-card"]') ?? cartao);
    const janela = await screen.findByTestId('janela-movimento-estoque');
    expect(janela.querySelector('.b1-janela')?.className).toContain('b1-janela--tela-cheia');
  });
});

describe('D-PROD-255 — permissão', () => {
  it('sem visualizar da tela sup-estoque: aviso e nada é lido', async () => {
    sessao.permissao = permissaoCom(false);
    await montar();
    expect(await screen.findByTestId('estoque-sem-permissao')).toHaveTextContent('Você não tem permissão para consultar o estoque.');
    await esperar();
    expect(backend.chamadas.filter((c) => c.path.startsWith('/estoque'))).toEqual([]);
    expect(screen.queryByTestId('estoque-abas')).toBeNull();
  });

  it('sem a linha da tela (negado por padrão), mesmo com o módulo: nada é lido', async () => {
    sessao.permissao = { user_email: 'operador', modulos_permitidos: ['suporte-mapa'], permissoes_telas: [{ modulo_id: 'suporte-mapa', tela_id: 'sup-locais', visualizar: true }] };
    await montar();
    expect(await screen.findByTestId('estoque-sem-permissao')).toBeTruthy();
    await esperar();
    expect(backend.chamadas.filter((c) => c.path.startsWith('/estoque'))).toEqual([]);
  });

  it('o item de menu "Estoque" está em Suporte do Mapa e só é permitido com a linha sup-estoque visualizar', () => {
    const pagina = flattenMenuPages(DEFAULT_MENU).find((p) => p.id === 'sup-estoque');
    expect(pagina).toMatchObject({ title: 'Estoque', url: 'Estoque', moduleId: 'suporte-mapa' });
    expect(canAccessPage(permissaoCom(true), 'sup-estoque', 'suporte-mapa')).toBe(true);
    expect(canAccessPage(permissaoCom(false), 'sup-estoque', 'suporte-mapa')).toBe(false);
    expect(canAccessPage({ modulos_permitidos: ['suporte-mapa'], permissoes_telas: [{ tela_id: 'sup-locais', visualizar: true }] }, 'sup-estoque', 'suporte-mapa')).toBe(false);
    expect(canAccessPage({ modulos_permitidos: ['manejo'], permissoes_telas: [{ tela_id: 'sup-estoque', visualizar: true }] }, 'sup-estoque', 'suporte-mapa')).toBe(false);
  });
});
