/**
 * D-PROD-162 — permissões antigas do Patrimônio ficam INERTES.
 *
 * As telas `pat-familias-patrimoniais`, `pat-tipos-patrimoniais`,
 * `pat-perfis-medicao` e `pat-combustiveis` saíram, e a ação
 * `configurar_conversao` de `pat-abastecimentos` também. As linhas gravadas em
 * `Permissao.permissoes_telas` (e um id antigo em `mobile_menu_ids`) continuam
 * no JSON — nada é migrado nem concedido — mas:
 *  - nenhuma função de ação as lê (famílias e tipos seguem a tela de Bens);
 *  - o menu do shell real não mostra nada por elas;
 *  - a sessão (hooks do Patrimônio) não quebra nem expõe `configurarConversao`;
 *  - o gerenciador de permissões não as desenha, preserva as linhas ao salvar e
 *    não conta o id antigo no limite de 4 botões do celular.
 * D-PROD-200 — a tela `op-apontamentos-atividade` (Apontamentos de Atividade,
 * D-PROD-190) deu lugar a `op-atividades` (Lançamento de Atividades): as linhas
 * antigas ficam inertes do mesmo jeito (nada é migrado nem concedido; quem não
 * é administrador precisa de nova concessão).
 * Mocks só da borda: `fetch` (backend falso) e a sessão (`@/apis/session`).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { API_FAKE, instalarBackendFake } from './fixtures/gestaoBackendFake.js';

const sessao = vi.hoisted(() => ({ usuario: null, permissoes: [] }));
const avisos = vi.hoisted(() => ({ erros: [] }));

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
vi.mock('sonner', async (importOriginal) => {
  const original = /** @type {any} */ (await importOriginal());
  return {
    ...original,
    toast: Object.assign((...args) => original.toast(...args), original.toast, {
      error: (/** @type {string} */ msg) => {
        avisos.erros.push(msg);
      },
    }),
  };
});

import { DEFAULT_MENU, getMenuModules } from '@/lib/menuConfig';
import { EXTRA_ACTION_KEYS_BY_PAGE, canAccessPage, extraActionKeysOf, getPagePermission } from '@/lib/permissions';
import { MODULO_PATRIMONIO, TELAS_PATRIMONIO, acoesDaTelaAbastecimento, acoesDaTelaPatrimonio, acoesDeCatalogoNoBem } from '@/lib/patrimonioPermissions';
import { MODULO_ATIVIDADES, TELA_ATIVIDADES, acoesDaTelaAtividades } from '@/lib/lancamentoAtividadesPermissions';

/** D-PROD-200 — a tela antiga do apontamento de atividade (D-PROD-190), no mesmo grupo de menu da nova. */
const TELA_APONTAMENTOS_ANTIGA = 'op-apontamentos-atividade';
const SEM_ACOES_ATIVIDADES = {
  ver: false, criar: false, editar: false, cancelar: false, reabrir: false, lancarApontamento: false, editarApontamento: false, cancelarApontamento: false,
};

/** As quatro telas que saíram: [id, título]. */
const ANTIGAS = [
  ['pat-familias-patrimoniais', 'Famílias Patrimoniais'],
  ['pat-tipos-patrimoniais', 'Tipos Patrimoniais'],
  ['pat-perfis-medicao', 'Perfis de Medição'],
  ['pat-combustiveis', 'Combustíveis'],
];

const operador = { id: 'u-op', login: 'vaqueiro', email: 'vaqueiro', nome: 'Vaqueiro', administrador_fazenda: false, cliente_id: 'fazenda-1' };

const tela = (modulo_id, tela_id, acoes = {}) => ({
  modulo_id, tela_id, visualizar: false, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes,
});
/** Linha antiga com TUDO ligado (como um administrador teria deixado antes da D-PROD-162). */
const linhaAntigaTudo = (tela_id) =>
  tela(MODULO_PATRIMONIO, tela_id, { visualizar: true, novo: true, salvar: true, editar: true, excluir: true, importar: true, exportar: true, inativar: true });
const LINHAS_ANTIGAS = ANTIGAS.map(([id]) => linhaAntigaTudo(id));
/** Abastecimentos com o fator kg/L ligado (ação que saiu). */
const ABASTECIMENTO_COM_FATOR = tela(MODULO_PATRIMONIO, 'pat-abastecimentos', { visualizar: true, configurar_conversao: true });
/** D-PROD-200 — linha antiga do Apontamento de Atividade com TUDO ligado (inclusive chaves com o nome das extras novas). */
const APONTAMENTO_ANTIGO_TUDO = tela(MODULO_ATIVIDADES, TELA_APONTAMENTOS_ANTIGA, {
  visualizar: true, novo: true, salvar: true, editar: true, excluir: true, importar: true, exportar: true,
  reabrir: true, lancar_apontamento: true, editar_apontamento: true, cancelar_apontamento: true,
});
const registro = (modulos, telas, extra = {}) => ({
  id: 'p1', user_email: 'vaqueiro', is_admin: false, modulos_permitidos: modulos, permissoes_telas: telas, mobile_menu_ids: [], ...extra,
});

const renderShell = async () => {
  const { default: Layout } = await import('@/Layout');
  const { AuthProvider } = await import('@/lib/AuthContext');
  const { BootSplashProvider } = await import('@/lib/bootSplashContext');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  await act(async () => {
    render(
      <MemoryRouter initialEntries={['/mapageral']}>
        <QueryClientProvider client={client}>
          <AuthProvider>
            <BootSplashProvider>
              <Routes>
                <Route path="*" element={<Layout currentPageName="MapaGeral"><div data-testid="pagina" /></Layout>} />
              </Routes>
            </BootSplashProvider>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
};

beforeEach(async () => {
  cleanup();
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('empresa_selecionada_id', 'emp-1');
  localStorage.setItem('empresa_selecionada_cliente_id', 'fazenda-1');
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  sessao.usuario = operador;
  sessao.permissoes = [];
  avisos.erros = [];
  instalarBackendFake(({ method }) => (method === 'GET' ? { status: 200, body: [] } : undefined));
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('INERTE-1 — regras de ação ignoram as linhas antigas', () => {
  it('só as quatro telas antigas (tudo ligado) → nada em Bens, nada no catálogo dentro de Bens, nada em Abastecimentos', () => {
    const perm = registro([MODULO_PATRIMONIO], LINHAS_ANTIGAS);
    expect(acoesDaTelaPatrimonio(perm, TELAS_PATRIMONIO.BENS)).toEqual({ ver: false, criar: false, editar: false, inativar: false });
    expect(acoesDeCatalogoNoBem(perm)).toEqual({ criarCatalogo: false, editarCatalogo: false, excluirCatalogo: false, inativarCatalogo: false, produtosDoTanque: false });
    expect(acoesDaTelaAbastecimento(perm)).toEqual({ ver: false, criar: false, cancelar: false });
    // Os dados continuam lá (nada é apagado nem migrado): só não valem para nada.
    for (const [id] of ANTIGAS) {
      expect(getPagePermission(perm, id), id).toEqual(linhaAntigaTudo(id));
      expect(extraActionKeysOf(id), id).toEqual([]);
      expect(Object.prototype.hasOwnProperty.call(EXTRA_ACTION_KEYS_BY_PAGE, id), id).toBe(false);
    }
  });

  it('`configurar_conversao: true` numa linha antiga de Abastecimentos não dá nada além de ver', () => {
    const perm = registro([MODULO_PATRIMONIO], [ABASTECIMENTO_COM_FATOR]);
    expect(acoesDaTelaAbastecimento(perm)).toEqual({ ver: true, criar: false, cancelar: false });
    expect(EXTRA_ACTION_KEYS_BY_PAGE['pat-abastecimentos']).toEqual(['cancelar']);
  });

  it('linhas antigas ao lado de Bens: valem só as ações da linha de Bens', () => {
    const perm = registro([MODULO_PATRIMONIO], [...LINHAS_ANTIGAS, tela(MODULO_PATRIMONIO, TELAS_PATRIMONIO.BENS, { visualizar: true, novo: true })]);
    expect(acoesDaTelaPatrimonio(perm, TELAS_PATRIMONIO.BENS)).toEqual({ ver: true, criar: true, editar: false, inativar: false });
    expect(acoesDeCatalogoNoBem(perm)).toEqual({ criarCatalogo: true, editarCatalogo: false, excluirCatalogo: false, inativarCatalogo: false, produtosDoTanque: true });
  });

  it('nenhum id antigo está no menu: canAccessPage do menu nunca os consulta', () => {
    const ids = getMenuModules(DEFAULT_MENU).flatMap((m) => m.pages.map((p) => p.id));
    for (const [id] of ANTIGAS) expect(ids, id).not.toContain(id);
    // A avaliação genérica ainda acha a linha pelo `tela_id` (o dado não é apagado), mas
    // nenhum item de menu, rota ou guarda pede esse id: o "acesso" não leva a lugar nenhum.
    expect(canAccessPage(registro([MODULO_PATRIMONIO], LINHAS_ANTIGAS), 'pat-combustiveis', MODULO_PATRIMONIO)).toBe(true);
  });

  it('D-PROD-200: a linha antiga `op-apontamentos-atividade` (tudo ligado) não dá nada no Lançamento de Atividades', () => {
    expect(TELA_ATIVIDADES).toBe('op-atividades');
    const perm = registro([MODULO_ATIVIDADES], [APONTAMENTO_ANTIGO_TUDO]);
    expect(acoesDaTelaAtividades(perm)).toEqual(SEM_ACOES_ATIVIDADES);
    // O dado continua lá, sem migração nem concessão; o id antigo não tem ações extras nem item de menu.
    expect(getPagePermission(perm, TELA_APONTAMENTOS_ANTIGA)).toEqual(APONTAMENTO_ANTIGO_TUDO);
    expect(extraActionKeysOf(TELA_APONTAMENTOS_ANTIGA)).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(EXTRA_ACTION_KEYS_BY_PAGE, TELA_APONTAMENTOS_ANTIGA)).toBe(false);
    const ids = getMenuModules(DEFAULT_MENU).flatMap((m) => m.pages.map((p) => p.id));
    expect(ids).not.toContain(TELA_APONTAMENTOS_ANTIGA);
    expect(ids).toContain(TELA_ATIVIDADES);
    // Ao lado da linha nova (só visualizar), valem só as ações da linha nova.
    const comNova = registro([MODULO_ATIVIDADES], [APONTAMENTO_ANTIGO_TUDO, tela(MODULO_ATIVIDADES, TELA_ATIVIDADES, { visualizar: true })]);
    expect(acoesDaTelaAtividades(comNova)).toEqual({ ...SEM_ACOES_ATIVIDADES, ver: true });
  });
});

describe('INERTE-2 — menu do shell real', () => {
  it('só as linhas antigas (com o módulo): o grupo Patrimônio e Frota não aparece e nada das telas antigas', async () => {
    sessao.permissoes = [registro(['mapa', MODULO_PATRIMONIO], [tela('mapa', 'pec-mapa-geral', { visualizar: true }), ...LINHAS_ANTIGAS], {
      mobile_menu_ids: ['pat-combustiveis', 'pat-familias-patrimoniais'],
    })];
    await renderShell();
    await screen.findByTestId('pagina');
    expect(screen.queryByText('Patrimônio e Frota')).toBeNull();
    for (const [, titulo] of ANTIGAS) expect(screen.queryByText(titulo), titulo).toBeNull();
  });

  it('linhas antigas + Bens: o grupo aparece só com Bens Patrimoniais', async () => {
    sessao.permissoes = [
      registro(['mapa', MODULO_PATRIMONIO], [
        tela('mapa', 'pec-mapa-geral', { visualizar: true }),
        ...LINHAS_ANTIGAS,
        ABASTECIMENTO_COM_FATOR,
        tela(MODULO_PATRIMONIO, TELAS_PATRIMONIO.BENS, { visualizar: true }),
      ]),
    ];
    await renderShell();
    expect((await screen.findAllByText('Patrimônio e Frota')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bens Patrimoniais').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Abastecimentos').length).toBeGreaterThan(0);
    for (const [, titulo] of ANTIGAS) expect(screen.queryByText(titulo), titulo).toBeNull();
  });

  it('D-PROD-200: só a linha antiga do Apontamento de Atividade (com o módulo): nem a tela antiga nem o Lançamento de Atividades aparecem', async () => {
    sessao.permissoes = [
      registro(['mapa', MODULO_ATIVIDADES], [tela('mapa', 'pec-mapa-geral', { visualizar: true }), APONTAMENTO_ANTIGO_TUDO], {
        mobile_menu_ids: [TELA_APONTAMENTOS_ANTIGA],
      }),
    ];
    await renderShell();
    await screen.findByTestId('pagina');
    expect(screen.queryByText('Apontamentos de Atividade')).toBeNull();
    expect(screen.queryByText('Lançamento de Atividades')).toBeNull();
    expect(screen.queryByText('Suporte do Mapa')).toBeNull();
  });

  it('D-PROD-200: linha antiga + a nova: o grupo aparece só com Lançamento de Atividades', async () => {
    sessao.permissoes = [
      registro(['mapa', MODULO_ATIVIDADES], [
        tela('mapa', 'pec-mapa-geral', { visualizar: true }),
        APONTAMENTO_ANTIGO_TUDO,
        tela(MODULO_ATIVIDADES, TELA_ATIVIDADES, { visualizar: true }),
      ]),
    ];
    await renderShell();
    expect((await screen.findAllByText('Suporte do Mapa')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lançamento de Atividades').length).toBeGreaterThan(0);
    expect(screen.queryByText('Apontamentos de Atividade')).toBeNull();
    expect(screen.queryByText('Tipos de Atividade')).toBeNull();
  });
});

describe('INERTE-3 — sessão: hooks do Patrimônio com linhas antigas', () => {
  it('useAcoesTelaPatrimonio(Bens) e useAcoesTelaAbastecimento não quebram nem expõem o fator', async () => {
    sessao.permissoes = [registro([MODULO_PATRIMONIO], [...LINHAS_ANTIGAS, ABASTECIMENTO_COM_FATOR])];
    const { useAcoesTelaAbastecimento, useAcoesTelaPatrimonio } = await import('@/hooks/usePatrimonioSessao');
    function Sonda() {
      const bens = useAcoesTelaPatrimonio(TELAS_PATRIMONIO.BENS);
      const abastecimento = useAcoesTelaAbastecimento();
      if (bens.carregando || abastecimento.carregando) return <p data-testid="carregando">…</p>;
      return (
        <>
          <pre data-testid="bens">{JSON.stringify(bens)}</pre>
          <pre data-testid="abastecimento">{JSON.stringify(abastecimento)}</pre>
        </>
      );
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    await act(async () => {
      render(
        <QueryClientProvider client={client}>
          <Sonda />
        </QueryClientProvider>,
      );
    });
    const bens = JSON.parse((await screen.findByTestId('bens')).textContent);
    const abastecimento = JSON.parse(screen.getByTestId('abastecimento').textContent);
    expect(bens).toEqual({
      ver: false, criar: false, editar: false, inativar: false,
      criarCatalogo: false, editarCatalogo: false, excluirCatalogo: false, inativarCatalogo: false, produtosDoTanque: false,
      carregando: false, administrador: false, login: 'vaqueiro',
    });
    expect(abastecimento).toEqual({ ver: true, criar: false, cancelar: false, carregando: false, administrador: false, login: 'vaqueiro' });
  });

  it('D-PROD-200: useAcoesTelaAtividades com só a linha antiga do apontamento → nada (sem concessão automática)', async () => {
    sessao.permissoes = [registro([MODULO_ATIVIDADES], [APONTAMENTO_ANTIGO_TUDO])];
    const { useAcoesTelaAtividades } = await import('@/hooks/useLancamentoAtividadesSessao');
    function Sonda() {
      const acoes = useAcoesTelaAtividades();
      if (acoes.carregando) return <p data-testid="carregando">…</p>;
      return <pre data-testid="atividades">{JSON.stringify(acoes)}</pre>;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    await act(async () => {
      render(
        <QueryClientProvider client={client}>
          <Sonda />
        </QueryClientProvider>,
      );
    });
    // D-PROD-275: o hook também diz se a troca do capim da área (conclusão da reforma) é permitida — o editar do Cadastro
    // do Mapa; a linha antiga não concede nada.
    expect(JSON.parse((await screen.findByTestId('atividades')).textContent)).toEqual({ ...SEM_ACOES_ATIVIDADES, trocarCapimDaArea: false, carregando: false, login: 'vaqueiro' });
  });
});

describe('INERTE-4 — gerenciador de permissões', () => {
  /** O gerenciador com estado próprio (como o FormularioUsuario), registrando cada onChange. */
  const montarGerenciador = async (inicial) => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const { default: ConfiguracaoPermissoesTelas } = await import('@/components/usuarios/ConfiguracaoPermissoesTelas');
    const modules = getMenuModules(DEFAULT_MENU);
    const estado = { atual: inicial };
    function Gerenciador() {
      const [form, setForm] = React.useState(inicial);
      const onChange = (campo, valor) =>
        setForm((prev) => {
          const proximo = { ...prev, [campo]: valor };
          estado.atual = proximo;
          return proximo;
        });
      return <ConfiguracaoPermissoesTelas formData={form} onChange={onChange} modules={modules} />;
    }
    render(<Gerenciador />);
    return estado;
  };

  it('não desenha as telas antigas nem o fator; ao mexer em Bens, preserva as linhas antigas iguais', async () => {
    const bens = tela(MODULO_PATRIMONIO, TELAS_PATRIMONIO.BENS, { visualizar: true, inativar: false });
    const estado = await montarGerenciador({
      modulos_permitidos: [MODULO_PATRIMONIO],
      permissoes_telas: [...LINHAS_ANTIGAS, ABASTECIMENTO_COM_FATOR, bens],
      mobile_menu_ids: [],
      mapa_geral_permissoes: {},
    });
    const cartaoModulo = screen.getByText('Patrimônio e Frota', { selector: 'label.text-xs' }).closest('.rounded-lg');
    expect(within(cartaoModulo).getByText('2 TELAS')).toBeTruthy();
    for (const [, titulo] of ANTIGAS) expect(screen.queryByText(titulo), titulo).toBeNull();
    expect(screen.queryByText('CONFIGURAR FATOR KG/L')).toBeNull();

    const cartaoBens = screen.getByText('Bens Patrimoniais', { selector: 'p.font-semibold' }).closest('.rounded-lg');
    const novo = within(cartaoBens).getByText('NOVO').closest('label').querySelector('[role="checkbox"]');
    await act(async () => {
      novo.click();
    });
    const linhas = estado.atual.permissoes_telas;
    for (const linha of LINHAS_ANTIGAS) expect(linhas, linha.tela_id).toContainEqual(linha);
    expect(linhas).toContainEqual(ABASTECIMENTO_COM_FATOR);
    expect(linhas.find((l) => l.tela_id === TELAS_PATRIMONIO.BENS)).toEqual({ ...bens, novo: true });
    expect(linhas).toHaveLength(LINHAS_ANTIGAS.length + 2);
  });

  it('D-PROD-200: não desenha Apontamentos de Atividade; ao ligar uma extra do Lançamento, preserva a linha antiga igual', async () => {
    const nova = tela(MODULO_ATIVIDADES, TELA_ATIVIDADES, { visualizar: true, reabrir: false, lancar_apontamento: false, editar_apontamento: false, cancelar_apontamento: false });
    const estado = await montarGerenciador({
      modulos_permitidos: [MODULO_ATIVIDADES],
      permissoes_telas: [APONTAMENTO_ANTIGO_TUDO, nova],
      mobile_menu_ids: [],
      mapa_geral_permissoes: {},
    });
    const grupo = DEFAULT_MENU.find((m) => m.id === MODULO_ATIVIDADES);
    const cartaoModulo = screen.getByText(grupo.title, { selector: 'label.text-xs' }).closest('.rounded-lg');
    // Só as telas do menu (a antiga não conta).
    expect(within(cartaoModulo).getByText(`${grupo.submenu.length} TELAS`)).toBeTruthy();
    expect(screen.queryByText('Apontamentos de Atividade')).toBeNull();
    const cartao = screen.getByText('Lançamento de Atividades', { selector: 'p.font-semibold' }).closest('.rounded-lg');
    const lancar = within(cartao).getByText('LANÇAR APONTAMENTO').closest('label').querySelector('[role="checkbox"]');
    await act(async () => {
      lancar.click();
    });
    const linhas = estado.atual.permissoes_telas;
    expect(linhas).toContainEqual(APONTAMENTO_ANTIGO_TUDO);
    expect(linhas.find((l) => l.tela_id === TELA_ATIVIDADES)).toEqual({ ...nova, lancar_apontamento: true });
    expect(linhas).toHaveLength(2);
  });

  it('um id antigo em mobile_menu_ids não conta no limite de 4 botões (e fica guardado, sem efeito)', async () => {
    // Três botões visíveis já escolhidos + um id antigo; a 4ª tela visível ainda cabe.
    const visiveis = [['mapa', 'pec-mapa-geral'], ['mapa', 'pec-mapa-cadastro'], ['manejo', 'pec-lotes']];
    const extra = { modulo: 'manejo', id: 'pec-setores', title: 'Setores' };
    const linhas = [...visiveis, [extra.modulo, extra.id]].map(([modulo, id]) => tela(modulo, id, { visualizar: true }));
    const modulosUsados = ['mapa', 'manejo'];
    const estado = await montarGerenciador({
      modulos_permitidos: modulosUsados,
      permissoes_telas: [...linhas, ...LINHAS_ANTIGAS],
      mobile_menu_ids: ['pat-combustiveis', ...visiveis.map(([, id]) => id)],
      mapa_geral_permissoes: {},
    });
    const blocoMobile = screen.getByText(/Botões do menu mobile/i).closest('.rounded-lg');
    // A tela antiga não aparece entre os botões; as três visíveis aparecem marcadas.
    expect(within(blocoMobile).queryByText('Combustíveis')).toBeNull();
    const caixa = within(blocoMobile).getByText(extra.title).closest('label').querySelector('[role="checkbox"]');
    expect(caixa.getAttribute('aria-checked')).toBe('false');
    await act(async () => {
      caixa.click();
    });
    expect(avisos.erros).toEqual([]);
    expect(estado.atual.mobile_menu_ids).toEqual(['pat-combustiveis', ...visiveis.map(([, id]) => id), extra.id]);
  });
});
