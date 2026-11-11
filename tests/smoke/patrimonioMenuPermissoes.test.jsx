/**
 * D-PROD-157 / D-PROD-162 — grupo "Patrimônio e Frota" no menu, no celular e no
 * gerenciador de permissões.
 *
 *  - SSOT: menu, páginas e manifesto de escopo têm exatamente as DUAS telas
 *    `pat-*` (Bens Patrimoniais e Abastecimentos; D-PROD-162 tirou Famílias,
 *    Tipos, Perfis de Medição e Combustíveis); os domínios legados de máquinas,
 *    abastecimento e ativos fixos (e as entidades Base44 deles) continuam
 *    proibidos e intactos;
 *  - ícones próprios no celular para o grupo e para as duas telas;
 *  - regra de botões = a do servidor (`GUARDAS.patrimonio*`): novo|salvar,
 *    editar|salvar e a ação extra `inativar` (sem atalho); padrão negado;
 *    famílias e tipos (dentro de Bens) seguem as ações da tela de Bens;
 *  - paridade lida no código do servidor (autorizacaoTela.js e guardasRotas.js);
 *  - shell real: o grupo aparece só para quem tem alguma das telas; dentro do
 *    Layout, a tela de bens declara `permissaoExplicita` (o "Adicionar tanque"
 *    de quem só edita não é barrado pela leitura do texto do botão);
 *  - tela Permissões: Bens com as 7 ações + "INATIVAR/REATIVAR" e Abastecimentos
 *    com "CANCELAR/ESTORNAR ABASTECIMENTO" (o fator kg/L saiu), todas desligadas;
 *  - Abastecimentos dentro do shell: "Confirmar abastecimento" segue a regra do
 *    servidor (novo|salvar), não a leitura do texto ("confirmar" = salvar).
 * Mocks só da borda: `fetch` (backend falso) e a sessão (`@/apis/session`).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { existsSync, readFileSync } from 'node:fs';
import * as lucide from 'lucide-react';
import { API_FAKE, envelope, instalarBackendFake } from './fixtures/gestaoBackendFake.js';

const sessao = vi.hoisted(() => ({ usuario: null, permissoes: [] }));

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

import { DEFAULT_MENU, getMenuModules } from '@/lib/menuConfig';
import { PAGES } from '@/pages.config';
import { ACTION_KEYS, ACTION_LABELS, canAccessPage, createRestrictedPagePermission, detectPermissionAction, EXTRA_ACTION_KEYS_BY_PAGE } from '@/lib/permissions';
import {
  ACOES_EXTRAS_ABASTECIMENTO,
  ACOES_EXTRAS_PATRIMONIO,
  MODULO_PATRIMONIO,
  TELAS_PATRIMONIO,
  acoesDaTelaAbastecimento,
  acoesDaTelaPatrimonio,
  acoesDeCatalogoNoBem,
} from '@/lib/patrimonioPermissions';
import { criarEstadoAbastecimentos, rotearAbastecimentos } from './fixtures/abastecimentosFakeCore.js';
import { preencherTrator } from './fixtures/abastecimentosTela.jsx';
import { ICONE_MODULO, ICONE_TELA } from '@/components/navigation/MobileModulesView';

/** As duas telas na ordem do menu: [id, título, página]. */
const TELAS = [
  ['pat-bens-patrimoniais', 'Bens Patrimoniais', 'BensPatrimoniais'],
  ['pat-abastecimentos', 'Abastecimentos', 'Abastecimentos'],
];
/** D-PROD-162: as quatro telas que saíram (página, menu, rota, escopo e Vercel). */
const TELAS_REMOVIDAS = [
  ['pat-familias-patrimoniais', 'Famílias Patrimoniais', 'FamiliasPatrimoniais'],
  ['pat-tipos-patrimoniais', 'Tipos Patrimoniais', 'TiposPatrimoniais'],
  ['pat-perfis-medicao', 'Perfis de Medição', 'PerfisMedicao'],
  ['pat-combustiveis', 'Combustíveis', 'Combustiveis'],
];
const PAGINAS = TELAS.map(([, , pagina]) => pagina);
const TITULOS = TELAS.map(([, titulo]) => titulo);
/** A tela de CADASTRO (extra `inativar`); Abastecimentos tem a extra própria. */
const CADASTROS = TELAS.filter(([id]) => id !== 'pat-abastecimentos');
const TELA_ABASTECIMENTO = 'pat-abastecimentos';
/** Nomes proibidos pelo escopo para a tela nova (D-PROD-159). */
const NOMES_PROIBIDOS_ABASTECIMENTO = ['LancamentosAbastecimento', 'FichaControleCombustivel', 'ConfiguracaoFatoresConsumo', 'AbastecimentoMaquina'];

/**
 * `forbiddenDomains` e `forbiddenBase44Entities` como estavam ANTES da D-PROD-157
 * (origin/main f2b81e1b). A fase só ganha páginas nativas: nada sai das listas.
 */
const DOMINIOS_PROIBIDOS_ANTES = [
  'Financeiro', 'LancamentoFinanceiro', 'PlanoContas', 'GruposFinanceiros', 'ContasFinanceiras', 'CaixaBancos', 'LivroCaixa', 'FluxoCaixa',
  'FormasPagamento', 'LivrosFiscais', 'Folha', 'FichaOperador', 'FichasPersonalizadas', 'VisualizarFicha', 'CadastroMaquinas',
  'LancamentosAbastecimento', 'FichaControleCombustivel', 'AtivosFixos', 'OperacoesAgricolas', 'GerenciarSafras', 'CustosSafra',
  'ControleAreas', 'CotacoesPecuaria', 'LotesAnimaisCotacao', 'MotivosCompra', 'SimulacaoResultados', 'Fornecedores', 'EditorVisualSistema',
  'Backup', 'RemoverDuplicados', 'PopularCidades', 'GerenciarCidades', 'Dashboard', 'Home', 'Relatorios', 'RelatoriosEstoque', 'Pesagens',
  'PesagensIndividuais', 'LancamentoPesagensIndividuais', 'LancamentoPesagensMobile', 'ConfiguracaoPesagens', 'MovimentacoesEstoque',
  'LancamentoProdutosEstoque', 'ConfiguracaoFatoresConsumo', 'DashboardSuplementacao', 'ControlePecuaria', 'AreasPastagem',
  'MovimentacoesLote', 'HistoricoMovimentacoesPecuaria', 'ManejosTecnicosRebanho', 'AplicacoesMedicamentos', 'MapaPecuaria',
  'MapaMovimentacao', 'CadastroGado', 'CadastroAreasReferencia', 'DiagnosticoDepositoCocho', 'GrupoAtividadeForm', 'TipoTarefaForm',
  'LancamentosTarefas', 'LancamentoTarefaForm', 'TiposDocumento',
];
/** Legado de máquinas, frota, abastecimento e ativos fixos (só requisito funcional; nunca copiado). */
const DOMINIOS_FROTA_LEGADOS = ['CadastroMaquinas', 'LancamentosAbastecimento', 'FichaControleCombustivel', 'AtivosFixos'];
const ENTIDADES_FROTA_LEGADAS = ['Maquina', 'Implemento', 'AbastecimentoMaquina', 'ManutencaoMaquina', 'TipoAtivo'];

const operador = { id: 'u-op', login: 'vaqueiro', email: 'vaqueiro', nome: 'Vaqueiro', administrador_fazenda: false, cliente_id: 'fazenda-1' };
const admin = { ...operador, id: 'u-adm', login: 'dono', email: 'dono', administrador_fazenda: true };

const tela = (modulo_id, tela_id, acoes = {}) => ({
  modulo_id, tela_id, visualizar: false, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes,
});
const registro = (modulos, telas) => ({ id: 'p1', user_email: 'vaqueiro', is_admin: false, modulos_permitidos: modulos, permissoes_telas: telas, mobile_menu_ids: [] });
const comAcoes = (telaId, acoes) => registro([MODULO_PATRIMONIO], [tela(MODULO_PATRIMONIO, telaId, { visualizar: true, ...acoes })]);

/** Trator gravado (detalhe A13) usado no teste do shell. */
const RESUMO_TRATOR = {
  id: 'b1', numero: '7', codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA', familia: { id: 'f2', nome: 'Máquinas' },
  tipo: { id: 't2', nome: 'Trator de pneus' }, propriedade: 'PROPRIO', medidor_tipo: 'HORIMETRO', ativo: true, versao: 4,
};
const DETALHE_TRATOR = {
  ...RESUMO_TRATOR,
  empresa_id: 'emp-1',
  familia: { id: 'f2', codigo: 'MAQUINAS', nome: 'Máquinas', natureza: 'MAQUINA', ativo: true },
  tipo: { id: 't2', codigo: 'TRATOR_PNEUS', nome: 'Trator de pneus', ativo: true },
  proprietario: null, responsavel: null, centro_custo: null, area: null,
  localizacao_descricao: null, marca: null, modelo: null, ano_fabricacao: null, ano_modelo: null, numero_serie: null, chassi: null,
  placa: null, placa_uf: null, renavam: null, potencia_cv: null, material: null, ano_conclusao: null, compatibilidade: null,
  especificacoes: null, observacoes: null,
  medidor: { tipo: 'HORIMETRO', unidade: 'h', leitura_inicial: '1250.0000', leitura_atual: '1300.0000', data_leitura: '2026-11-01', origem: 'AJUSTE_CADASTRO' },
  // D-PROD-162: tanque com os Produtos aceitos (sem medições, sem combustíveis).
  tanques: [
    {
      id: 'tq1', identificador: 'Principal', capacidade_litros: '180.0000', observacao: null, ativo: true,
      produtos: [{ produto_id: 'p1', nome: 'Diesel S10 (L)', codigo_interno: 'DS10', unidade_principal_estoque: 'L', produto_ativo: true }],
    },
  ],
  aquisicao: { data_aquisicao: null, data_disponibilidade: null, valor_aquisicao: null, custo_incorporacao: null, fornecedor: null, documento_referencia: null, garantia_ate: null },
  depreciacao: { depreciavel: false, metodo: null, vida_util_meses: null, residual_modo: null, valor_residual: null, residual_percentual: null, data_inicio_depreciacao: null, previa: null },
  consumo: null,
};
/** Opções de `GET /bens-patrimoniais-opcoes/produtos` (ativos, da fazenda, L ou KG). */
const PRODUTOS_ACEITAVEIS = [
  { id: 'p1', nome: 'Diesel S10 (L)', codigo_interno: 'DS10', unidade_principal_estoque: 'L' },
  { id: 'p2', nome: 'Arla 32', codigo_interno: 'ARLA', unidade_principal_estoque: 'L' },
];

let backend;

/**
 * Shell real (Layout). Sem `pagina`, só o menu; com ela, a página dentro do Layout.
 * @param {{ rota?: string, pagina?: string }} [opcoes]
 */
const renderShell = async ({ rota = '/mapageral', pagina } = {}) => {
  const { default: Layout } = await import('@/Layout');
  const { AuthProvider } = await import('@/lib/AuthContext');
  const { BootSplashProvider } = await import('@/lib/bootSplashContext');
  const Pagina = pagina ? (await import(`@/pages/${pagina}.jsx`)).default : null;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[rota]}>
        <QueryClientProvider client={client}>
          <AuthProvider>
            <BootSplashProvider>
              <Routes>
                <Route
                  path="*"
                  element={<Layout currentPageName={pagina ?? 'MapaGeral'}>{Pagina ? <Pagina /> : <div data-testid="pagina" />}</Layout>}
                />
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
  backend = instalarBackendFake(({ method, path, query, body }) => {
    if (method === 'GET' && path === '/bens-patrimoniais') return { status: 200, body: envelope([RESUMO_TRATOR]) };
    if (method === 'GET' && path === '/bens-patrimoniais/b1') return { status: 200, body: DETALHE_TRATOR };
    if (method === 'GET' && path === '/bens-patrimoniais-opcoes/produtos') return { status: 200, body: { itens: PRODUTOS_ACEITAVEIS, has_more: false, next_cursor: null } };
    if (method === 'GET' && path.startsWith('/bens-patrimoniais-opcoes/')) return { status: 200, body: { itens: [], has_more: false, next_cursor: null } };
    if (method === 'PATCH' && path === '/bens-patrimoniais/b1') return { status: 200, body: { ...DETALHE_TRATOR, versao: body.versao + 1 } };
    if (method === 'GET') return { status: 200, body: [] };
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('PAT-M1 — SSOT de menu, páginas, escopo e ícones', () => {
  it('grupo patrimonio "Patrimônio e Frota" com exatamente as duas telas pat-* (Bens e Abastecimentos)', () => {
    const grupo = DEFAULT_MENU.find((m) => m.id === MODULO_PATRIMONIO);
    expect(grupo.title).toBe('Patrimônio e Frota');
    expect(grupo.submenu).toEqual(TELAS.map(([id, title, url]) => ({ id, title, url })));
    expect(TELAS_PATRIMONIO).toEqual({ BENS: 'pat-bens-patrimoniais', ABASTECIMENTOS: 'pat-abastecimentos' });
    for (const p of PAGINAS) expect(typeof PAGES[p], p).toBe('function');
    // D-PROD-162: as quatro telas antigas não são página, nem item de menu, nem arquivo.
    const idsDoMenu = DEFAULT_MENU.flatMap((m) => m.submenu.map((t) => t.id));
    for (const [id, , pagina] of TELAS_REMOVIDAS) {
      expect(PAGES[pagina], pagina).toBeUndefined();
      expect(idsDoMenu, id).not.toContain(id);
      expect(existsSync(`src/pages/${pagina}.jsx`), pagina).toBe(false);
    }
    // Ícone do grupo no menu é um nome real do lucide (o mesmo componente do celular).
    expect(lucide[grupo.icon]).toBeTruthy();
    expect(ICONE_MODULO[MODULO_PATRIMONIO]).toBe(lucide[grupo.icon]);
    // Nenhuma outra seção do menu leva as telas de patrimônio.
    const fora = DEFAULT_MENU.filter((m) => m.id !== MODULO_PATRIMONIO).flatMap((m) => m.submenu.map((t) => t.id));
    expect(fora.some((id) => id.startsWith('pat-'))).toBe(false);
  });

  it('ícones próprios no celular: grupo e as duas telas, distintos entre si e diferentes de Package', () => {
    expect(ICONE_MODULO[MODULO_PATRIMONIO]).toBeTruthy();
    expect(ICONE_MODULO[MODULO_PATRIMONIO]).not.toBe(lucide.Package);
    const outrosModulos = Object.entries(ICONE_MODULO).filter(([id]) => id !== MODULO_PATRIMONIO).map(([, icone]) => icone);
    expect(outrosModulos).not.toContain(ICONE_MODULO[MODULO_PATRIMONIO]);
    for (const url of PAGINAS) {
      expect(ICONE_TELA[url], url).toBeTruthy();
      expect(ICONE_TELA[url], url).not.toBe(lucide.Package);
      expect(ICONE_TELA[url], url).not.toBe(lucide.Folder);
    }
    expect(new Set(PAGINAS.map((u) => ICONE_TELA[u])).size).toBe(2);
    // As telas removidas não têm ícone (nada sobra no celular).
    for (const [, , pagina] of TELAS_REMOVIDAS) expect(ICONE_TELA[pagina], pagina).toBeUndefined();
    // Abastecimentos: gotas (≠ a gota dos Bebedouros).
    expect(ICONE_TELA.Abastecimentos).toBe(lucide.Droplets);
    expect(ICONE_TELA.Abastecimentos).not.toBe(ICONE_TELA.Bebedouros);
  });

  it('manifesto: as duas páginas permitidas, as quatro antigas fora; forbiddenDomains e entidades Base44 proibidas continuam intactos', () => {
    const scope = JSON.parse(readFileSync('config/mapa-manejo-scope.json', 'utf8'));
    expect(scope.allowedPages).toEqual(expect.arrayContaining(PAGINAS));
    for (const [, , pagina] of TELAS_REMOVIDAS) expect(scope.allowedPages, pagina).not.toContain(pagina);
    expect(new Set(scope.allowedPages)).toEqual(new Set(Object.keys(PAGES)));
    // Nada saiu da lista de domínios proibidos; o legado de frota segue proibido.
    expect(scope.forbiddenDomains).toEqual(expect.arrayContaining(DOMINIOS_PROIBIDOS_ANTES));
    expect(new Set(scope.forbiddenDomains).size).toBe(scope.forbiddenDomains.length);
    for (const d of DOMINIOS_FROTA_LEGADOS) expect(scope.forbiddenDomains).toContain(d);
    for (const p of PAGINAS) expect(scope.forbiddenDomains).not.toContain(p);
    for (const e of ENTIDADES_FROTA_LEGADAS) {
      expect(scope.forbiddenBase44Entities).toContain(e);
      expect(scope.allowedBase44Entities).not.toContain(e);
    }
    // Mesma leitura do gate: nenhum domínio proibido aparece (palavra inteira) no menu novo.
    const grupo = DEFAULT_MENU.find((m) => m.id === MODULO_PATRIMONIO);
    const textos = [grupo.id, grupo.title, grupo.icon, ...grupo.submenu.flatMap((t) => [t.id, t.title, t.url])];
    for (const d of scope.forbiddenDomains) {
      const palavra = new RegExp(`\\b${d}\\b`);
      expect(textos.filter((t) => palavra.test(t)), d).toEqual([]);
    }
    // D-PROD-159: a tela nova não reusa nenhum nome legado (página, schema ou entidade).
    for (const nome of NOMES_PROIBIDOS_ABASTECIMENTO) {
      expect(Object.keys(PAGES)).not.toContain(nome);
      expect(scope.allowedPages).not.toContain(nome);
      expect(scope.allowedBase44Entities).not.toContain(nome);
    }
    expect(scope.forbiddenDomains).toEqual(expect.arrayContaining(['LancamentosAbastecimento', 'FichaControleCombustivel', 'ConfiguracaoFatoresConsumo']));
    expect(scope.forbiddenBase44Entities).toContain('AbastecimentoMaquina');
  });
});

describe('PAT-M2 — regra de ações igual à do servidor; padrão negado', () => {
  it('visualizar só vê; novo|salvar cria; editar|salvar edita; inativar só pela ação extra', () => {
    const T = TELAS_PATRIMONIO.BENS;
    expect(acoesDaTelaPatrimonio(comAcoes(T, {}), T)).toEqual({ ver: true, criar: false, editar: false, inativar: false });
    expect(acoesDaTelaPatrimonio(comAcoes(T, { novo: true }), T)).toEqual({ ver: true, criar: true, editar: false, inativar: false });
    expect(acoesDaTelaPatrimonio(comAcoes(T, { editar: true }), T)).toEqual({ ver: true, criar: false, editar: true, inativar: false });
    expect(acoesDaTelaPatrimonio(comAcoes(T, { salvar: true }), T)).toEqual({ ver: true, criar: true, editar: true, inativar: false });
    expect(acoesDaTelaPatrimonio(comAcoes(T, { inativar: true }), T)).toEqual({ ver: true, criar: false, editar: false, inativar: true });
    // Sem atalho: excluir, editar e salvar não dão inativar (o servidor não tem DELETE).
    expect(acoesDaTelaPatrimonio(comAcoes(T, { excluir: true, editar: true, salvar: true }), T).inativar).toBe(false);
  });

  it('cada tela com as SUAS ações: liberar Bens não libera Abastecimentos (e vice-versa)', () => {
    const perm = comAcoes(TELAS_PATRIMONIO.BENS, { novo: true, editar: true, inativar: true, cancelar: true, configurar_conversao: true });
    expect(acoesDaTelaAbastecimento(perm)).toEqual({ ver: false, criar: false, cancelar: false });
    const soAbastecimento = comAcoes(TELA_ABASTECIMENTO, { novo: true, editar: true, salvar: true, inativar: true, cancelar: true });
    expect(acoesDaTelaPatrimonio(soAbastecimento, TELAS_PATRIMONIO.BENS)).toEqual({ ver: false, criar: false, editar: false, inativar: false });
    expect(acoesDeCatalogoNoBem(soAbastecimento)).toEqual({ criarCatalogo: false, editarCatalogo: false, inativarCatalogo: false, produtosDoTanque: false });
  });

  it('Abastecimentos: ver = visualizar; criar = novo|salvar; cancelar só pela extra; o fator kg/L saiu; padrão negado', () => {
    const T = TELA_ABASTECIMENTO;
    const nada = { ver: false, criar: false, cancelar: false };
    expect(acoesDaTelaAbastecimento(null)).toEqual(nada);
    expect(acoesDaTelaAbastecimento(registro([MODULO_PATRIMONIO], []))).toEqual(nada);
    expect(acoesDaTelaAbastecimento(registro([], [tela(MODULO_PATRIMONIO, T, { visualizar: true, novo: true })]))).toEqual(nada);
    expect(acoesDaTelaAbastecimento(comAcoes(T, {}))).toEqual({ ver: true, criar: false, cancelar: false });
    expect(acoesDaTelaAbastecimento(comAcoes(T, { novo: true }))).toEqual({ ver: true, criar: true, cancelar: false });
    expect(acoesDaTelaAbastecimento(comAcoes(T, { salvar: true }))).toEqual({ ver: true, criar: true, cancelar: false });
    // Sem atalho: editar/excluir/salvar não cancelam.
    expect(acoesDaTelaAbastecimento(comAcoes(T, { editar: true, excluir: true, salvar: true }))).toMatchObject({ cancelar: false });
    expect(acoesDaTelaAbastecimento(comAcoes(T, { cancelar: true }))).toEqual({ ver: true, criar: false, cancelar: true });
    // `configurar_conversao` gravado numa linha antiga não dá nada (D-PROD-162).
    expect(acoesDaTelaAbastecimento(comAcoes(T, { configurar_conversao: true }))).toEqual({ ver: true, criar: false, cancelar: false });
    expect(acoesDaTelaAbastecimento({ user_email: 'x', is_admin: true })).toEqual({ ver: true, criar: true, cancelar: true });
  });

  it('famílias e tipos dentro de Bens: criar = novo|salvar|editar; editar = editar|salvar; inativar = extra; Produtos do tanque = novo|salvar|editar', () => {
    const T = TELAS_PATRIMONIO.BENS;
    const nada = { criarCatalogo: false, editarCatalogo: false, inativarCatalogo: false, produtosDoTanque: false };
    expect(acoesDeCatalogoNoBem(null)).toEqual(nada);
    expect(acoesDeCatalogoNoBem(registro([MODULO_PATRIMONIO], []))).toEqual(nada);
    expect(acoesDeCatalogoNoBem(comAcoes(T, {}))).toEqual(nada);
    expect(acoesDeCatalogoNoBem(comAcoes(T, { novo: true }))).toEqual({ criarCatalogo: true, editarCatalogo: false, inativarCatalogo: false, produtosDoTanque: true });
    expect(acoesDeCatalogoNoBem(comAcoes(T, { editar: true }))).toEqual({ criarCatalogo: true, editarCatalogo: true, inativarCatalogo: false, produtosDoTanque: true });
    expect(acoesDeCatalogoNoBem(comAcoes(T, { salvar: true }))).toEqual({ criarCatalogo: true, editarCatalogo: true, inativarCatalogo: false, produtosDoTanque: true });
    expect(acoesDeCatalogoNoBem(comAcoes(T, { inativar: true }))).toEqual({ criarCatalogo: false, editarCatalogo: false, inativarCatalogo: true, produtosDoTanque: false });
    // Ação ligada sem visualizar → nada (fail-closed, como `telaPermite`).
    expect(acoesDeCatalogoNoBem(registro([MODULO_PATRIMONIO], [tela(MODULO_PATRIMONIO, T, { novo: true, editar: true, inativar: true })]))).toEqual(nada);
    expect(acoesDeCatalogoNoBem({ user_email: 'x', is_admin: true })).toEqual({ criarCatalogo: true, editarCatalogo: true, inativarCatalogo: true, produtosDoTanque: true });
  });

  it('sem registro / sem módulo / sem linha → nada; ação ligada sem visualizar → nada; is_admin → tudo', () => {
    const T = TELAS_PATRIMONIO.BENS;
    const nada = { ver: false, criar: false, editar: false, inativar: false };
    expect(acoesDaTelaPatrimonio(null, T)).toEqual(nada);
    expect(acoesDaTelaPatrimonio(registro([], [tela(MODULO_PATRIMONIO, T, { visualizar: true, inativar: true })]), T)).toEqual(nada);
    expect(acoesDaTelaPatrimonio(registro([MODULO_PATRIMONIO], []), T)).toEqual(nada);
    expect(acoesDaTelaPatrimonio(registro([MODULO_PATRIMONIO], [tela(MODULO_PATRIMONIO, T, { novo: true, inativar: true })]), T)).toEqual(nada);
    expect(acoesDaTelaPatrimonio({ user_email: 'x', is_admin: true }, T)).toEqual({ ver: true, criar: true, editar: true, inativar: true });
  });

  it('permissão restrita criada pelo gerenciador vem toda desligada: "inativar" em Bens, "cancelar" em Abastecimentos', () => {
    const mod = getMenuModules(DEFAULT_MENU).find((m) => m.id === MODULO_PATRIMONIO);
    expect(mod.pages.map((p) => p.id)).toEqual(TELAS.map(([id]) => id));
    for (const page of mod.pages) {
      const p = createRestrictedPagePermission(mod.id, mod.title, page);
      const extras = page.id === TELA_ABASTECIMENTO ? ['cancelar'] : ['inativar'];
      expect(p.modulo_id).toBe(MODULO_PATRIMONIO);
      expect([...ACTION_KEYS, ...extras].every((a) => p[a] === false), page.id).toBe(true);
      expect(canAccessPage(registro([MODULO_PATRIMONIO], [p]), page.id, MODULO_PATRIMONIO)).toBe(false);
      expect(EXTRA_ACTION_KEYS_BY_PAGE[page.id]).toEqual(extras);
      expect('configurar_conversao' in p, page.id).toBe(false);
    }
    // D-PROD-162: o fator kg/L saiu; as telas antigas não têm mais ações extras.
    expect(ACTION_LABELS.configurar_conversao).toBeUndefined();
    expect(Object.keys(EXTRA_ACTION_KEYS_BY_PAGE).filter((id) => id.startsWith('pat-')).sort()).toEqual(['pat-abastecimentos', 'pat-bens-patrimoniais']);
    // As telas de outros módulos não ganham a chave.
    const parceiros = getMenuModules(DEFAULT_MENU).find((m) => m.id === 'gestao-rural').pages.find((p) => p.id === 'ges-parceiros');
    expect('inativar' in createRestrictedPagePermission('gestao-rural', 'Gestão Rural', parceiros)).toBe(false);
    expect(ACTION_LABELS.inativar).toBe('inativar ou reativar registros');
  });

  it('texto dos botões: inativar/reativar e a instalação do catálogo não são lidos como ação; "Adicionar tanque" seria "novo"', () => {
    for (const rotulo of ['Inativar bem patrimonial', 'Reativar família patrimonial', 'Instalar catálogo padrão', 'Simular depreciação', 'Inativar o tanque Principal']) {
      expect(detectPermissionAction(rotulo), rotulo).toBeNull();
    }
    // Por isso as telas de patrimônio declaram permissão explícita (ver o teste do shell).
    expect(detectPermissionAction('Adicionar tanque')).toBe('novo');
    // "Confirmar abastecimento" seria lido como `salvar` (quem só tem `novo` seria barrado).
    expect(detectPermissionAction('Confirmar abastecimento')).toBe('salvar');
  });
});

describe('PAT-M2b — paridade lida no código do servidor', () => {
  const autorizacao = readFileSync('backend/src/shared/auth/autorizacaoTela.js', 'utf8');
  const guardas = readFileSync('backend/src/shared/auth/guardasRotas.js', 'utf8');

  /** Trecho do código a partir de `inicio` até o fechamento `fim` (inclusive). */
  const trecho = (fonte, inicio, fim) => {
    const i = fonte.indexOf(inicio);
    expect(i, `${inicio} ausente`).toBeGreaterThan(-1);
    return fonte.slice(i, fonte.indexOf(fim, i) + fim.length);
  };

  it('TELAS.PATRIMONIO_* do servidor = ids do menu = TELAS_PATRIMONIO do navegador (mesmo módulo)', () => {
    const doServidor = Object.fromEntries(
      [...autorizacao.matchAll(/PATRIMONIO_([A-Z_]+):\s*(?:Object\.freeze\()?\{\s*modulo:\s*'([a-z-]+)',\s*tela:\s*'([a-z-]+)'\s*\}/g)].map((m) => [m[1], { modulo: m[2], tela: m[3] }]),
    );
    expect(Object.keys(doServidor).sort()).toEqual(Object.keys(TELAS_PATRIMONIO).sort());
    for (const [chave, telaId] of Object.entries(TELAS_PATRIMONIO)) {
      expect(doServidor[chave], chave).toEqual({ modulo: MODULO_PATRIMONIO, tela: telaId });
    }
  });

  it('ACOES_PATRIMONIO_EXTRAS do servidor = ações extras da tela de Bens no navegador', () => {
    const lista = autorizacao.match(/ACOES_PATRIMONIO_EXTRAS\s*=\s*Object\.freeze\(\[([^\]]*)\]/);
    expect(lista, 'ACOES_PATRIMONIO_EXTRAS ausente em autorizacaoTela.js').toBeTruthy();
    const extrasServidor = [...lista[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(extrasServidor).toEqual([...ACOES_EXTRAS_PATRIMONIO]);
    for (const [id] of CADASTROS) expect([...EXTRA_ACTION_KEYS_BY_PAGE[id]], id).toEqual(extrasServidor);
  });

  it('ACOES_ABASTECIMENTO_EXTRAS do servidor = ACOES_EXTRAS_ABASTECIMENTO = extras de pat-abastecimentos', () => {
    const lista = autorizacao.match(/ACOES_ABASTECIMENTO_EXTRAS\s*=\s*Object\.freeze\(\[([^\]]*)\]/);
    expect(lista, 'ACOES_ABASTECIMENTO_EXTRAS ausente em autorizacaoTela.js').toBeTruthy();
    const extrasServidor = [...lista[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(extrasServidor).toEqual(['cancelar']);
    expect([...ACOES_EXTRAS_ABASTECIMENTO]).toEqual(extrasServidor);
    expect([...EXTRA_ACTION_KEYS_BY_PAGE[TELA_ABASTECIMENTO]]).toEqual(extrasServidor);
  });

  it('GUARDAS.patrimonioAbastecimentos: ver/criar/cancelar batem com acoesDaTelaAbastecimento (sem configurarConversao)', () => {
    const bloco = trecho(guardas, 'patrimonioAbastecimentos: {', '},');
    expect(bloco).toMatch(/ver:\s*porTela\(T\.PATRIMONIO_ABASTECIMENTOS,\s*'visualizar'\)/);
    const linhaCriar = bloco.match(/criar:\s*porQualquer\(([^\n]*)\),/);
    expect(linhaCriar, 'criar ausente em patrimonioAbastecimentos').toBeTruthy();
    const criar = [...linhaCriar[1].matchAll(/\[T\.PATRIMONIO_ABASTECIMENTOS,\s*'([a-z_]+)'\]/g)].map((m) => m[1]);
    expect(criar.sort()).toEqual(['novo', 'salvar']);
    expect(bloco).toMatch(/cancelar:\s*porTela\(T\.PATRIMONIO_ABASTECIMENTOS,\s*'cancelar'\)/);
    expect(bloco).not.toMatch(/configurarConversao|configurar_conversao/);
    expect(guardas).not.toMatch(/configurar_conversao/);
    for (const acao of [...ACTION_KEYS.filter((a) => a !== 'visualizar'), 'cancelar', 'configurar_conversao', 'inativar']) {
      const a = acoesDaTelaAbastecimento(comAcoes(TELA_ABASTECIMENTO, { [acao]: true }));
      expect(Object.keys(a).sort(), acao).toEqual(['cancelar', 'criar', 'ver']);
      expect(a.criar, `${acao}:criar`).toBe(criar.includes(acao));
      expect(a.cancelar, `${acao}:cancelar`).toBe(acao === 'cancelar');
    }
  });

  it('GUARDAS.patrimonio*: ver/criar/editar/inativar do servidor batem com acoesDaTelaPatrimonio, ação por ação', () => {
    // Bens usa a fábrica `patrimonio(T.PATRIMONIO_BENS)`; o catálogo padrão é só do administrador.
    expect(guardas).toMatch(/patrimonioBens:\s*\{\s*\.\.\.patrimonio\(T\.PATRIMONIO_BENS\)/);
    expect(guardas).toMatch(/patrimonioCatalogoPadrao:\s*adminOuIsAdmin\(\)/);
    // D-PROD-162: sem guarda de perfis nem de combustíveis; nenhuma guarda pede as telas antigas.
    expect(guardas).not.toMatch(/patrimonioPerfisMedicao|patrimonioCombustiveis/);
    expect(guardas).not.toMatch(/PATRIMONIO_(FAMILIAS|TIPOS|PERFIS_MEDICAO|COMBUSTIVEIS)\b/);

    const fabrica = trecho(guardas, 'const patrimonio = (alvo) => ({', '});');
    const ver = [...fabrica.matchAll(/ver:\s*porTela\(alvo,\s*'([a-z_]+)'\)/g)].map((m) => m[1]);
    const linhaCriar = fabrica.match(/criar:\s*porQualquer\(([^\n]*)\),/);
    expect(linhaCriar, 'criar ausente na fábrica patrimonio').toBeTruthy();
    const criar = [...linhaCriar[1].matchAll(/\[alvo,\s*'([a-z_]+)'\]/g)].map((m) => m[1]);
    expect(fabrica).toMatch(/editar:\s*edicaoPatrimonio\(alvo\)/);

    const edicao = trecho(guardas, 'const edicaoPatrimonio = (alvo) =>', '});');
    const exigeEdicao = [...edicao.matchAll(/telaPermite\(aut,\s*alvo,\s*'([a-z_]+)'\)/g)].map((m) => m[1]);
    const inativarServidor = exigeEdicao.filter((a) => !ACTION_KEYS.includes(a));
    const editar = exigeEdicao.filter((a) => ACTION_KEYS.includes(a));
    expect(ver).toEqual(['visualizar']);
    expect(criar.sort()).toEqual(['novo', 'salvar']);
    expect(editar.sort()).toEqual(['editar', 'salvar']);
    expect(inativarServidor).toEqual([...ACOES_EXTRAS_PATRIMONIO]);
    // `ativo` sozinho (só com empresa_id/versao) exige inativar; o resto exige editar|salvar.
    expect(edicao).toMatch(/CHAVES_DE_ESCOPO_PATRIMONIO/);
    expect(guardas).toMatch(/CHAVES_DE_ESCOPO_PATRIMONIO\s*=\s*Object\.freeze\(\['empresa_id',\s*'versao'\]\)/);

    // O navegador decide igual, ação por ação, em cada tela de cadastro.
    for (const [telaId] of CADASTROS) {
      for (const acao of [...ACTION_KEYS.filter((a) => a !== 'visualizar'), 'inativar']) {
        const a = acoesDaTelaPatrimonio(comAcoes(telaId, { [acao]: true }), telaId);
        expect(a.criar, `${telaId}:${acao}:criar`).toBe(criar.includes(acao));
        expect(a.editar, `${telaId}:${acao}:editar`).toBe(editar.includes(acao));
        expect(a.inativar, `${telaId}:${acao}:inativar`).toBe(inativarServidor.includes(acao));
      }
    }
  });

  it('famílias, tipos e Produtos do tanque (D-PROD-162): guardas do servidor sobre Bens = acoesDeCatalogoNoBem, ação por ação', () => {
    const linhaBens = guardas.match(/const BENS_CRIAR_OU_EDITAR\s*=\s*\[(.*)\];/);
    expect(linhaBens, 'BENS_CRIAR_OU_EDITAR ausente em guardasRotas.js').toBeTruthy();
    const criarOuEditar = [...linhaBens[1].matchAll(/\[T\.PATRIMONIO_BENS,\s*'([a-z_]+)'\]/g)].map((m) => m[1]);
    expect(criarOuEditar.sort()).toEqual(['editar', 'novo', 'salvar']);

    const bens = trecho(guardas, 'patrimonioBens: {', '},');
    expect(bens).toMatch(/opcoesCatalogo:\s*porTela\(T\.PATRIMONIO_BENS,\s*'visualizar'\)/);
    expect(bens).toMatch(/opcoesProdutos:\s*porQualquer\(\.\.\.BENS_CRIAR_OU_EDITAR\)/);
    for (const guarda of ['patrimonioFamilias', 'patrimonioTipos']) {
      const linha = guardas.match(new RegExp(`${guarda}:\\s*\\{([^\\n]*)\\},`));
      expect(linha, guarda).toBeTruthy();
      expect(linha[1], guarda).toMatch(/ver:\s*porTela\(T\.PATRIMONIO_BENS,\s*'visualizar'\)/);
      expect(linha[1], guarda).toMatch(/criar:\s*porQualquer\(\.\.\.BENS_CRIAR_OU_EDITAR\)/);
      expect(linha[1], guarda).toMatch(/editar:\s*edicaoPatrimonio\(T\.PATRIMONIO_BENS\)/);
    }

    const edicao = trecho(guardas, 'const edicaoPatrimonio = (alvo) =>', '});');
    const exigeEdicao = [...edicao.matchAll(/telaPermite\(aut,\s*alvo,\s*'([a-z_]+)'\)/g)].map((m) => m[1]);
    const editar = exigeEdicao.filter((a) => ACTION_KEYS.includes(a));
    const inativar = exigeEdicao.filter((a) => !ACTION_KEYS.includes(a));
    for (const acao of [...ACTION_KEYS.filter((a) => a !== 'visualizar'), 'inativar', 'cancelar']) {
      const a = acoesDeCatalogoNoBem(comAcoes(TELAS_PATRIMONIO.BENS, { [acao]: true }));
      expect(a.criarCatalogo, `${acao}:criarCatalogo`).toBe(criarOuEditar.includes(acao));
      expect(a.produtosDoTanque, `${acao}:produtosDoTanque`).toBe(criarOuEditar.includes(acao));
      expect(a.editarCatalogo, `${acao}:editarCatalogo`).toBe(editar.includes(acao));
      expect(a.inativarCatalogo, `${acao}:inativarCatalogo`).toBe(inativar.includes(acao));
    }
  });
});

describe('PAT-M3 — menu do shell real', () => {
  it('quem tem só Bens Patrimoniais vê o grupo só com ela', async () => {
    sessao.permissoes = [
      registro(['mapa', MODULO_PATRIMONIO], [tela('mapa', 'pec-mapa-geral', { visualizar: true }), tela(MODULO_PATRIMONIO, 'pat-bens-patrimoniais', { visualizar: true })]),
    ];
    await renderShell();
    expect((await screen.findAllByText('Patrimônio e Frota')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bens Patrimoniais').length).toBeGreaterThan(0);
    for (const t of TITULOS.slice(1)) expect(screen.queryByText(t), t).toBeNull();
  });

  it('quem tem só Abastecimentos vê o grupo só com ela', async () => {
    sessao.permissoes = [
      registro(['mapa', MODULO_PATRIMONIO], [tela('mapa', 'pec-mapa-geral', { visualizar: true }), tela(MODULO_PATRIMONIO, TELA_ABASTECIMENTO, { visualizar: true })]),
    ];
    await renderShell();
    expect((await screen.findAllByText('Patrimônio e Frota')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Abastecimentos').length).toBeGreaterThan(0);
    for (const t of TITULOS.filter((x) => x !== 'Abastecimentos')) expect(screen.queryByText(t), t).toBeNull();
  });

  it('quem não tem nenhuma das telas não vê o grupo (padrão negado, mesmo com o módulo)', async () => {
    sessao.permissoes = [registro(['mapa', MODULO_PATRIMONIO], [tela('mapa', 'pec-mapa-geral', { visualizar: true })])];
    await renderShell();
    await screen.findByTestId('pagina');
    expect(screen.queryByText('Patrimônio e Frota')).toBeNull();
    for (const t of TITULOS) expect(screen.queryByText(t), t).toBeNull();
  });

  it('linha da tela sem o módulo concedido também não mostra o grupo', async () => {
    sessao.permissoes = [registro(['mapa'], [tela('mapa', 'pec-mapa-geral', { visualizar: true }), tela(MODULO_PATRIMONIO, 'pat-bens-patrimoniais', { visualizar: true })])];
    await renderShell();
    await screen.findByTestId('pagina');
    expect(screen.queryByText('Patrimônio e Frota')).toBeNull();
  });

  it('administrador da fazenda vê o grupo e as duas telas (nenhuma das quatro antigas)', async () => {
    sessao.usuario = admin;
    await renderShell();
    expect((await screen.findAllByText('Patrimônio e Frota')).length).toBeGreaterThan(0);
    for (const t of TITULOS) expect(screen.getAllByText(t).length, t).toBeGreaterThan(0);
    for (const [, t] of TELAS_REMOVIDAS) expect(screen.queryByText(t), t).toBeNull();
  });
});

describe('PAT-M3b — Bens dentro do shell: permissão explícita', () => {
  it('quem só edita adiciona um tanque (o Layout não lê "Adicionar" como "novo") e grava pelo ✓ do cabeçalho, com os Produtos aceitos', async () => {
    sessao.permissoes = [registro([MODULO_PATRIMONIO], [tela(MODULO_PATRIMONIO, 'pat-bens-patrimoniais', { visualizar: true, editar: true })])];
    await renderShell({ rota: '/benspatrimoniais', pagina: 'BensPatrimoniais' });
    const celula = await screen.findByTestId('bem-nome-b1', {}, { timeout: 3000 });
    expect(celula.closest('[data-permissao-explicita]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Novo' })).toBeNull();
    fireEvent.doubleClick(celula);
    await waitFor(() => expect(screen.getByTestId('b1-form')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0]);
    const form = screen.getByTestId('b1-form');
    fireEvent.click(within(form).getByRole('tab', { name: 'Operação' }));
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Adicionar tanque' }));
    });
    expect(screen.queryAllByText(/Ação bloqueada/i)).toHaveLength(0);
    const tanque = within(form).getByTestId('bem-tanque-1');
    fireEvent.change(within(tanque).getByLabelText(/^Identificador/), { target: { value: 'Reserva' } });
    fireEvent.change(within(tanque).getByLabelText('Capacidade (L)'), { target: { value: '60' } });
    // P-01: o tanque novo pode ficar sem Produto aceito (o abastecimento é que recusa).
    const botao = await vi.waitFor(() => {
      const b = document.querySelector('.mk-mhdr__round--salvar');
      if (!b) throw new Error('sem ✓');
      return b;
    });
    expect(botao.hasAttribute('data-permissao-explicita')).toBe(true);
    await act(async () => {
      fireEvent.click(botao);
    });
    expect(screen.queryAllByText(/Ação bloqueada/i)).toHaveLength(0);
    await waitFor(() => expect(backend.chamadas.some((c) => c.method === 'PATCH')).toBe(true));
    expect(backend.chamadas.find((c) => c.method === 'PATCH')).toMatchObject({
      path: '/bens-patrimoniais/b1',
      body: {
        empresa_id: 'emp-1',
        versao: 4,
        tanques: [
          { id: 'tq1', identificador: 'Principal', capacidade_litros: '180', produto_ids: ['p1'], ativo: true },
          { identificador: 'Reserva', capacidade_litros: '60', produto_ids: [] },
        ],
      },
    });
    // D-PROD-162: nada de medições nem de combustíveis no corpo.
    const patch = backend.chamadas.find((c) => c.method === 'PATCH');
    expect('medicoes' in patch.body).toBe(false);
    expect(patch.body.tanques.some((t) => 'combustivel_ids' in t)).toBe(false);
  });
});

describe('PAT-M3c — Abastecimentos dentro do shell: permissão explícita', () => {
  it('quem só tem visualizar+novo confirma o abastecimento ("Confirmar" não exige salvar); diálogos com data-permissao-explicita', async () => {
    sessao.permissoes = [registro([MODULO_PATRIMONIO], [tela(MODULO_PATRIMONIO, TELA_ABASTECIMENTO, { visualizar: true, novo: true })])];
    const estado = criarEstadoAbastecimentos();
    backend = instalarBackendFake(async (req) => {
      if (req.path === '/empresas' || req.path.startsWith('/patrimonio-')) return rotearAbastecimentos(estado, req);
      if (req.method === 'GET') return { status: 200, body: [] };
      return undefined;
    });
    await renderShell({ rota: '/abastecimentos', pagina: 'Abastecimentos' });
    const novo = await screen.findByRole('button', { name: 'Novo abastecimento' }, { timeout: 3000 });
    expect(novo.closest('[data-permissao-explicita]')).toBeTruthy();
    await act(async () => fireEvent.click(novo));
    const form = await screen.findByTestId('abastecimento-form');
    await preencherTrator(form);
    await act(async () => fireEvent.click(within(form).getByTestId('abastecimento-previa')));
    const dialogo = await screen.findByTestId('dialogo-previa-abastecimento');
    expect(dialogo.hasAttribute('data-permissao-explicita')).toBe(true);
    await act(async () => fireEvent.click(within(dialogo).getByTestId('abastecimento-confirmar')));
    expect(screen.queryAllByText(/Ação bloqueada/i)).toHaveLength(0);
    await waitFor(() => expect(backend.chamadas.some((c) => c.method === 'POST' && c.path === '/patrimonio-abastecimentos')).toBe(true));
    expect(await screen.findByTestId('abastecimento-consulta')).toBeTruthy();
  });
});

describe('PAT-M4 — tela Permissões lista as duas telas com as ações e a extra de cada uma', () => {
  it('módulo Patrimônio e Frota aparece no gerenciador com as telas e todas as ações desligadas', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const { default: FormularioUsuario } = await import('@/components/usuarios/FormularioUsuario');
    render(<FormularioUsuario onSubmit={() => {}} onCancel={() => {}} initialData={null} usuarios={[]} />);
    const rotuloModulo = screen.getByText('Patrimônio e Frota', { selector: 'span' });
    const caixaModulo = within(rotuloModulo.closest('label')).getByRole('checkbox');
    expect(caixaModulo.getAttribute('aria-checked')).toBe('false');
    await act(async () => {
      caixaModulo.click();
    });
    // Só as duas telas no cartão do módulo; nenhuma das quatro antigas.
    const cartaoModulo = screen.getByText('Patrimônio e Frota', { selector: 'label.text-xs' }).closest('.rounded-lg');
    expect(within(cartaoModulo).getByText('2 TELAS')).toBeTruthy();
    for (const [, t] of TELAS_REMOVIDAS) expect(screen.queryByText(t, { selector: 'p.font-semibold' }), t).toBeNull();
    for (const t of CADASTROS.map(([, titulo]) => titulo)) {
      const cartao = screen.getByText(t, { selector: 'p.font-semibold' }).closest('.rounded-lg');
      const caixas = within(cartao).getAllByRole('checkbox');
      // visualizar + 6 ações + a extra "inativar" (inativar e reativar), todas desligadas.
      expect(caixas, t).toHaveLength(8);
      expect(caixas.every((c) => c.getAttribute('aria-checked') === 'false'), t).toBe(true);
      expect(within(cartao).getByText('NOVO')).toBeTruthy();
      expect(within(cartao).getByText('EDITAR')).toBeTruthy();
      expect(within(cartao).getByText('INATIVAR/REATIVAR')).toBeTruthy();
      expect(within(cartao).getByText('Ações do cadastro')).toBeTruthy();
      expect(within(cartao).queryByText('Ações do lançamento')).toBeNull();
      expect(within(cartao).queryByText('CONFIRMAR LANÇAMENTO')).toBeNull();
      expect(within(cartao).queryByText('CANCELAR/ESTORNAR ABASTECIMENTO')).toBeNull();
    }
    // Abastecimentos: visualizar + 6 ações + cancelar/estornar, todas desligadas (o fator kg/L saiu).
    const cartao = screen.getByText('Abastecimentos', { selector: 'p.font-semibold' }).closest('.rounded-lg');
    const caixas = within(cartao).getAllByRole('checkbox');
    expect(caixas).toHaveLength(8);
    expect(caixas.every((c) => c.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(within(cartao).getByText('CANCELAR/ESTORNAR ABASTECIMENTO')).toBeTruthy();
    expect(within(cartao).queryByText('CONFIGURAR FATOR KG/L')).toBeNull();
    expect(screen.queryByText('CONFIGURAR FATOR KG/L')).toBeNull();
    expect(within(cartao).getByText('Ações do abastecimento')).toBeTruthy();
    expect(within(cartao).queryByText('CANCELAR LANÇAMENTO')).toBeNull();
    expect(within(cartao).queryByText('INATIVAR/REATIVAR')).toBeNull();
    expect(within(cartao).queryByText('Ações do cadastro')).toBeNull();
  });
});
