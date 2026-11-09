/**
 * D-PROD-156 — catálogos de Patrimônio e Frota montados de verdade (página,
 * motor Base1, service, API, porta e nativeHttpClient reais): Famílias, Tipos,
 * Perfis de Medição e Combustíveis.
 *
 *  - catálogo é do TENANT: nenhuma chamada leva `empresa_id` e a tela funciona
 *    sem empresa selecionada;
 *  - criar manda só os campos do catálogo; editar manda o PATCH mínimo com
 *    `versao` e nunca os campos imutáveis (código, natureza, família, dimensão,
 *    finalidade, unidade);
 *  - inativar/reativar é ação do menu, com confirmação, e exige a ação extra
 *    `inativar` (corpo só `{versao, ativo}`); sem a ação, o item não aparece;
 *  - "Instalar catálogo padrão" só para o administrador, só nas Famílias;
 *  - erros do servidor mostram a mensagem do patrimônio e mantêm o formulário
 *    (com o corpo que o servidor realmente envia);
 *  - cancelar a edição descarta o que foi digitado.
 * Mocks só da borda: `fetch` (backend falso) e a sessão (usuário/permissão
 * efetiva, tenant do JWT).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { API_FAKE, envelope, erroServidor, escolherOpcao, instalarBackendFake } from './fixtures/gestaoBackendFake.js';

const sessao = vi.hoisted(() => ({ permissao: /** @type {any} */ (null), clienteId: 'cli-1' }));

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ clienteId: sessao.clienteId, user: { id: 'u1' } }) }));
vi.mock('@/services/sessionService', async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentUser: vi.fn(async () => ({ login: 'operador', cliente_id: sessao.clienteId })),
  carregarPermissaoEfetiva: vi.fn(async () => sessao.permissao),
}));

const TELAS = ['pat-bens-patrimoniais', 'pat-familias-patrimoniais', 'pat-tipos-patrimoniais', 'pat-perfis-medicao', 'pat-combustiveis'];
/** Mesma permissão em todas as telas do Patrimônio. */
const permissaoCom = (acoes) => ({
  user_email: 'operador',
  modulos_permitidos: ['patrimonio'],
  permissoes_telas: TELAS.map((t) => ({ tela_id: t, visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes })),
});
const ADMIN = { user_email: 'dono', is_admin: true, modulos_permitidos: [], permissoes_telas: [] };

const datas = { created_date: '2026-11-01T10:00:00Z', updated_date: '2026-11-01T10:00:00Z' };
const familia = (id, codigo, nome, natureza, extra = {}) => ({ id, codigo, nome, natureza, descricao: null, ordem: null, vida_util_meses_padrao: null, ativo: true, versao: 1, ...datas, ...extra });
const perfil = (id, codigo, nome, dimensao, finalidade, unidade_canonica, unidades_permitidas, extra = {}) => ({
  id, codigo, nome, dimensao, finalidade, unidade_canonica, unidades_permitidas, descricao: null, ativo: true, versao: 1, ...datas, ...extra,
});
const combustivel = (id, codigo, nome, unidade, extra = {}) => ({ id, codigo, nome, unidade, descricao: null, ativo: true, versao: 1, ...datas, ...extra });

const FAMILIAS_INICIAIS = () => [
  familia('f1', 'BENFEITORIAS', 'Benfeitorias e instalações', 'BENFEITORIA', { vida_util_meses_padrao: 300 }),
  familia('f2', 'MAQUINAS', 'Máquinas', 'MAQUINA', { ordem: 2, vida_util_meses_padrao: 120, versao: 3 }),
  familia('f9', 'ANTIGAS', 'Antigas', 'OUTRO', { ativo: false, versao: 2 }),
];
const PERFIS_INICIAIS = () => [
  perfil('p1', 'AREA', 'Área', 'AREA', 'DIMENSAO', 'm2', ['m2', 'ha']),
  perfil('p2', 'CAPACIDADE_ANIMAL', 'Capacidade animal', 'CABECAS', 'CAPACIDADE', 'cab', ['cab']),
  perfil('p3', 'EXTENSAO', 'Extensão', 'EXTENSAO', 'DIMENSAO', 'm', ['m', 'km'], { versao: 2 }),
];
const COMBUSTIVEIS_INICIAIS = () => [combustivel('c1', 'DIESEL_S10', 'Diesel S10', 'L'), combustivel('c4', 'GNV', 'GNV', 'm3', { versao: 2 })];

/** Tipo como o servidor devolve (`comoTipoPublico`): família e perfis resolvidos. */
const tipoPublico = (t) => {
  const f = estado.familias.find((x) => x.id === t.familia_id);
  return {
    ...t,
    familia: f ? { id: f.id, codigo: f.codigo, nome: f.nome, natureza: f.natureza, ativo: f.ativo } : null,
    perfis: (t.perfis ?? []).map((p, ordem) => {
      const pf = estado['perfis-medicao'].find((x) => x.id === p.perfil_id);
      return {
        perfil_id: p.perfil_id,
        principal: p.principal === true,
        ordem,
        perfil: pf ? { id: pf.id, codigo: pf.codigo, nome: pf.nome, dimensao: pf.dimensao, unidade_canonica: pf.unidade_canonica, ativo: pf.ativo } : null,
      };
    }),
  };
};
const TIPOS_INICIAIS = () => [
  { id: 't1', familia_id: 'f1', codigo: 'CURRAL', nome: 'Curral', descricao: null, vida_util_meses_sugerida: null, perfis: [{ perfil_id: 'p1', principal: true }, { perfil_id: 'p2' }], ativo: true, versao: 2, ...datas },
  { id: 't2', familia_id: 'f2', codigo: 'TRATOR_PNEUS', nome: 'Trator de pneus', descricao: null, vida_util_meses_sugerida: 120, perfis: [], ativo: true, versao: 1, ...datas },
];

/** @type {Record<string, any[]>} */
let estado;
let backend;
/** Resposta de erro injetada na PRÓXIMA gravação. */
let proxima;
let seq;

const RECURSO_DO_CAMINHO = { 'patrimonio-familias': 'familias', 'patrimonio-tipos': 'tipos', 'patrimonio-perfis-medicao': 'perfis-medicao', 'patrimonio-combustiveis': 'combustiveis' };
const publico = (recurso, r) => (recurso === 'tipos' ? tipoPublico(r) : r);
const opcoes = (itens) => ({ status: 200, body: { itens, has_more: false, next_cursor: null } });

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  window.localStorage.clear();
  window.sessionStorage.clear();
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  sessao.permissao = permissaoCom({ novo: true, editar: true, inativar: true });
  estado = { familias: FAMILIAS_INICIAIS(), tipos: TIPOS_INICIAIS(), 'perfis-medicao': PERFIS_INICIAIS(), combustiveis: COMBUSTIVEIS_INICIAIS() };
  proxima = null;
  seq = 0;
  backend = instalarBackendFake(async ({ method, path, query, body }) => {
    if (proxima && method !== 'GET') {
      const r = proxima;
      proxima = null;
      return r;
    }
    const [, raiz, id] = path.split('/');
    const recurso = RECURSO_DO_CAMINHO[raiz];
    if (recurso && method === 'GET' && !id) {
      const q = (query.get('q') || '').toLowerCase();
      const itens = estado[recurso]
        .filter((r) => query.get('ativo') == null || String(r.ativo) === query.get('ativo'))
        .filter((r) => !query.get('natureza') || r.natureza === query.get('natureza'))
        .filter((r) => !query.get('familia_id') || r.familia_id === query.get('familia_id'))
        .filter((r) => !q || r.nome.toLowerCase().includes(q) || r.codigo.toLowerCase().includes(q));
      return { status: 200, body: envelope(itens.map((r) => publico(recurso, r))) };
    }
    if (recurso && method === 'GET' && id) {
      const r = estado[recurso].find((x) => x.id === id);
      return r ? { status: 200, body: publico(recurso, r) } : undefined;
    }
    if (recurso && method === 'POST') {
      seq += 1;
      const extra = recurso === 'perfis-medicao' ? { unidade_canonica: body.unidades_permitidas[0] } : {};
      const criado = { id: `novo-${seq}`, descricao: null, ...extra, ...body, ativo: true, versao: 1, ...datas };
      estado[recurso].push(criado);
      return { status: 201, body: publico(recurso, criado) };
    }
    if (recurso && method === 'PATCH' && id) {
      const i = estado[recurso].findIndex((x) => x.id === id);
      const { versao, ...mudanca } = body;
      estado[recurso][i] = { ...estado[recurso][i], ...mudanca, versao: versao + 1 };
      return { status: 200, body: publico(recurso, estado[recurso][i]) };
    }
    if (method === 'GET' && path === '/bens-patrimoniais-opcoes/familias') {
      return opcoes(estado.familias.filter((f) => f.ativo).map(({ id: fid, codigo, nome, natureza }) => ({ id: fid, codigo, nome, natureza })));
    }
    if (method === 'GET' && path === '/bens-patrimoniais-opcoes/perfis-medicao') {
      return opcoes(estado['perfis-medicao'].filter((p) => p.ativo).map(({ id: pid, codigo, nome, dimensao, finalidade, unidade_canonica, unidades_permitidas }) => ({ id: pid, codigo, nome, dimensao, finalidade, unidade_canonica, unidades_permitidas })));
    }
    if (method === 'POST' && path === '/patrimonio-catalogo-padrao') {
      return {
        status: 200,
        body: {
          criados: { familias: 4, tipos: 13, perfis: 5, combustiveis: 4 },
          existentes: { familias: 0, tipos: 0, perfis: 1, combustiveis: 1 },
          conflitos: [{ recurso: 'familias', codigo: 'MAQUINAS', motivo: 'natureza_divergente' }, { recurso: 'tipos', codigo: 'TRATOR_PNEUS', motivo: 'dependencia_em_conflito' }],
        },
      };
    }
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const montar = async (pagina) => {
  const { default: Pagina } = await import(`@/pages/${pagina}.jsx`);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <Pagina />
    </QueryClientProvider>,
  );
};

const mutacoes = () => backend.chamadas.filter((c) => c.method !== 'GET');
const listagens = (caminho) => backend.chamadas.filter((c) => c.method === 'GET' && c.path === caminho);
const salvar = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
const editar = () => fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
const abrir = async (prefixo, id) => {
  fireEvent.doubleClick(await screen.findByTestId(`${prefixo}-nome-${id}`));
  return screen.findByTestId('b1-form');
};
const novo = async (prefixo, idDaLista) => {
  await screen.findByTestId(`${prefixo}-nome-${idDaLista}`);
  fireEvent.click(screen.getByRole('button', { name: 'Novo' }));
  return screen.findByTestId('b1-form');
};
const abrirMaisOpcoes = () => fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }));
/** Espera o popover do B1Select anterior fechar (jsdom). */
const semOpcoesAbertas = () => waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));

describe('Catálogos — listas do tenant (sem empresa)', () => {
  it('famílias: lista ativas sem empresa_id mesmo sem empresa selecionada; filtros de natureza e situação e busca vão ao servidor', async () => {
    await montar('FamiliasPatrimoniais');
    expect(await screen.findByTestId('familia-nome-f1')).toHaveTextContent('Benfeitorias e instalações');
    expect(screen.queryByTestId('familia-nome-f9')).toBeNull();
    expect(screen.queryByTestId('patrimonio-sem-empresa')).toBeNull();
    const primeira = listagens('/patrimonio-familias')[0];
    expect(primeira.query).toEqual({ ativo: 'true', limit: expect.any(String) });
    expect(within(screen.getByTestId('familia-nome-f2').closest('tr')).getByText('Máquina')).toBeTruthy();
    expect(within(screen.getByTestId('familia-nome-f2').closest('tr')).getByText('120 meses')).toBeTruthy();

    await escolherOpcao(screen.getByRole('combobox', { name: 'Filtrar por natureza' }), 'Máquina');
    await waitFor(() => expect(screen.queryByTestId('familia-nome-f1')).toBeNull());
    expect(listagens('/patrimonio-familias').some((c) => c.query.natureza === 'MAQUINA' && c.query.ativo === 'true')).toBe(true);
    await semOpcoesAbertas();
    await escolherOpcao(screen.getByRole('combobox', { name: 'Filtrar por natureza' }), 'Todas as naturezas');
    await semOpcoesAbertas();
    await escolherOpcao(screen.getByRole('combobox', { name: 'Filtrar por situação' }), 'Inativos');
    expect(await screen.findByTestId('familia-nome-f9')).toBeTruthy();
    expect(listagens('/patrimonio-familias').some((c) => c.query.ativo === 'false')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir pesquisa' }));
    const busca = await screen.findByLabelText('Buscar famílias patrimoniais…');
    fireEvent.change(busca, { target: { value: 'antig' } });
    fireEvent.keyDown(busca, { key: 'Enter' });
    await waitFor(() => expect(listagens('/patrimonio-familias').some((c) => c.query.q === 'antig')).toBe(true), { timeout: 2000 });
    expect(backend.chamadas.every((c) => c.query.empresa_id === undefined)).toBe(true);
  });

  it('tipos: a lista mostra a família e os perfis sugeridos com o principal', async () => {
    window.localStorage.setItem('empresa_selecionada_id', 'emp-1');
    window.localStorage.setItem('empresa_selecionada_cliente_id', 'cli-1');
    await montar('TiposPatrimoniais');
    const linha = (await screen.findByTestId('tipo-nome-t1')).closest('tr');
    expect(within(linha).getByText('Benfeitorias e instalações')).toBeTruthy();
    expect(within(linha).getByText('Área (principal), Capacidade animal')).toBeTruthy();
    // Catálogo do tenant: a empresa selecionada não vai na consulta.
    expect(listagens('/patrimonio-tipos').every((c) => c.query.empresa_id === undefined)).toBe(true);
  });
});

describe('Famílias — criar e editar', () => {
  it('cria com código normalizado, natureza escolhida e vida útil; depois fica aberta só leitura', async () => {
    await montar('FamiliasPatrimoniais');
    const form = await novo('familia', 'f1');
    fireEvent.change(within(form).getByLabelText(/^Código/), { target: { value: 'tratores pesados' } });
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: ' Tratores ' } });
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Natureza' }), 'Máquina');
    fireEvent.change(within(form).getByLabelText(/^Vida útil padrão/), { target: { value: '96' } });
    salvar();
    await screen.findByText('Família patrimonial criada');
    expect(mutacoes()).toEqual([
      expect.objectContaining({ method: 'POST', path: '/patrimonio-familias', body: { codigo: 'TRATORES_PESADOS', nome: 'Tratores', natureza: 'MAQUINA', vida_util_meses_padrao: 96 } }),
    ]);
    const aberto = screen.getByTestId('b1-form');
    await waitFor(() => expect(within(aberto).getByLabelText(/^Código/).value).toBe('TRATORES_PESADOS'));
    expect(within(aberto).getByLabelText(/^Nome/).readOnly).toBe(true);
  });

  it('validação local: sem natureza e com código inválido nada é enviado', async () => {
    await montar('FamiliasPatrimoniais');
    const form = await novo('familia', 'f1');
    fireEvent.change(within(form).getByLabelText(/^Código/), { target: { value: 'x' } });
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'Tratores' } });
    fireEvent.change(within(form).getByLabelText(/^Vida útil padrão/), { target: { value: '0' } });
    salvar();
    expect(await screen.findByText('Revise os campos destacados.')).toBeTruthy();
    expect(within(form).getByText('Use de 2 a 32 letras maiúsculas, números ou _')).toBeTruthy();
    expect(within(form).getByText('Escolha a natureza')).toBeTruthy();
    expect(within(form).getByText('Meses: número inteiro de 1 a 1200')).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(mutacoes()).toEqual([]);
  });

  it('edição: código e natureza só leitura; PATCH só com o que mudou + versao; sem mudança nada é enviado', async () => {
    await montar('FamiliasPatrimoniais');
    await abrir('familia', 'f2');
    editar();
    const form = screen.getByTestId('b1-form');
    expect(within(form).getByLabelText(/^Código/).readOnly).toBe(true);
    expect(within(form).queryByRole('combobox', { name: 'Natureza' })).toBeNull();
    expect(within(form).getByLabelText('Natureza').value).toBe('Máquina');
    salvar();
    await screen.findByText('Nada foi alterado.');
    expect(mutacoes()).toEqual([]);

    editar();
    fireEvent.change(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/), { target: { value: 'Máquinas agrícolas' } });
    fireEvent.change(within(screen.getByTestId('b1-form')).getByLabelText(/^Ordem/), { target: { value: '' } });
    salvar();
    await screen.findByText('Família patrimonial atualizada');
    expect(mutacoes()).toEqual([
      expect.objectContaining({ method: 'PATCH', path: '/patrimonio-familias/f2', body: { versao: 3, nome: 'Máquinas agrícolas', ordem: null } }),
    ]);
  });

  it('cancelar a edição descarta o digitado: volta ao gravado e o próximo PATCH não leva o descartado', async () => {
    await montar('FamiliasPatrimoniais');
    await abrir('familia', 'f2');
    editar();
    fireEvent.change(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/), { target: { value: 'NOME DESCARTADO' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/).value).toBe('Máquinas'));
    expect(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/).readOnly).toBe(true);
    editar();
    fireEvent.change(within(screen.getByTestId('b1-form')).getByLabelText(/^Vida útil padrão/), { target: { value: '96' } });
    salvar();
    await screen.findByText('Família patrimonial atualizada');
    expect(mutacoes()).toEqual([
      expect.objectContaining({ method: 'PATCH', path: '/patrimonio-familias/f2', body: { versao: 3, vida_util_meses_padrao: 96 } }),
    ]);
  });

  it('409 de nome duplicado na criação e de versão na edição: mensagem e formulário mantido com o que foi digitado', async () => {
    await montar('FamiliasPatrimoniais');
    const form = await novo('familia', 'f1');
    fireEvent.change(within(form).getByLabelText(/^Código/), { target: { value: 'MAQ2' } });
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'Máquinas' } });
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Natureza' }), 'Máquina');
    proxima = erroServidor(409, 'PATRIMONIO_NOME_DUPLICADO', { details: { field: 'nome' } });
    salvar();
    expect(await screen.findByText(/Já existe um cadastro com este nome/)).toBeTruthy();
    expect(screen.queryByText('Família patrimonial criada')).toBeNull();
    expect(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/).value).toBe('Máquinas');
    expect(within(screen.getByTestId('b1-form')).getByLabelText(/^Código/).value).toBe('MAQ2');

    cleanup();
    await montar('FamiliasPatrimoniais');
    await abrir('familia', 'f2');
    editar();
    fireEvent.change(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/), { target: { value: 'Outra' } });
    proxima = erroServidor(409, 'PATRIMONIO_VERSAO_CONFLITO', { details: { versao_atual: 4, versao_informada: 3 } });
    salvar();
    expect(await screen.findByText(/alterado por outra pessoa enquanto você editava/)).toBeTruthy();
    expect(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/).value).toBe('Outra');
    expect(screen.queryByText('Família patrimonial atualizada')).toBeNull();
  });
});

describe('Tipos — criar e editar', () => {
  it('tipo de benfeitoria com perfis sugeridos (principal + outro); opções de catálogo sem empresa', async () => {
    await montar('TiposPatrimoniais');
    const form = await novo('tipo', 't1');
    fireEvent.click(within(form).getByTestId('tipo-seletor-familia'));
    expect(within(form).queryByRole('option', { name: /Antigas/ })).toBeNull();
    fireEvent.click(await within(form).findByRole('option', { name: /Benfeitorias e instalações/ }));
    expect(within(form).getByLabelText('Natureza').value).toBe('Benfeitoria');
    fireEvent.change(within(form).getByLabelText(/^Código/), { target: { value: 'galpao' } });
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'Galpão' } });
    fireEvent.click(within(form).getByTestId('tipo-seletor-perfil'));
    fireEvent.click(await within(form).findByRole('option', { name: /Área/ }));
    fireEvent.click(within(form).getByTestId('tipo-seletor-perfil'));
    fireEvent.click(await within(form).findByRole('option', { name: /Extensão/ }));
    expect(within(form).getByRole('button', { name: 'Perfil principal: Área' }).getAttribute('aria-pressed')).toBe('true');
    salvar();
    await screen.findByText('Tipo patrimonial criado');
    expect(mutacoes()).toEqual([
      expect.objectContaining({ method: 'POST', path: '/patrimonio-tipos', body: { familia_id: 'f1', codigo: 'GALPAO', nome: 'Galpão', perfis: [{ perfil_id: 'p1', principal: true }, { perfil_id: 'p3' }] } }),
    ]);
    const opcoesLidas = backend.chamadas.filter((c) => c.path.startsWith('/bens-patrimoniais-opcoes/'));
    expect(opcoesLidas.length).toBeGreaterThan(0);
    expect(opcoesLidas.every((c) => c.query.empresa_id === undefined)).toBe(true);
  });

  it('família de máquinas: sem seção de perfis e o POST sai sem perfis', async () => {
    await montar('TiposPatrimoniais');
    const form = await novo('tipo', 't1');
    fireEvent.click(within(form).getByTestId('tipo-seletor-familia'));
    fireEvent.click(await within(form).findByRole('option', { name: /^Máquinas/ }));
    expect(within(form).queryByTestId('tipo-perfis-sugeridos')).toBeNull();
    expect(within(form).queryByTestId('tipo-seletor-perfil')).toBeNull();
    fireEvent.change(within(form).getByLabelText(/^Código/), { target: { value: 'TRATOR_ESTEIRAS' } });
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'Trator de esteiras' } });
    fireEvent.change(within(form).getByLabelText(/^Vida útil sugerida/), { target: { value: '180' } });
    salvar();
    await screen.findByText('Tipo patrimonial criado');
    expect(mutacoes()[0].body).toEqual({ familia_id: 'f2', codigo: 'TRATOR_ESTEIRAS', nome: 'Trator de esteiras', vida_util_meses_sugerida: 180 });
  });

  it('edição troca a principal (PATCH só perfis + versao); TIPO_PERFIS_INVALIDOS mostra o motivo e mantém o formulário', async () => {
    await montar('TiposPatrimoniais');
    await abrir('tipo', 't1');
    editar();
    const form = screen.getByTestId('b1-form');
    expect(within(form).getByLabelText('Família').readOnly).toBe(true);
    expect(within(form).getByLabelText(/^Código/).readOnly).toBe(true);
    fireEvent.click(within(form).getByRole('button', { name: 'Perfil principal: Capacidade animal' }));
    proxima = erroServidor(422, 'TIPO_PERFIS_INVALIDOS', { details: { field: 'perfis', reason: 'principal_duplicado' } });
    salvar();
    expect(await screen.findByText(/Só um perfil pode ser o principal/)).toBeTruthy();
    expect(within(screen.getByTestId('b1-form')).getByRole('button', { name: 'Perfil principal: Capacidade animal' }).getAttribute('aria-pressed')).toBe('true');
    salvar();
    await screen.findByText('Tipo patrimonial atualizado');
    const patches = mutacoes().filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(2);
    expect(patches[1]).toEqual(expect.objectContaining({ path: '/patrimonio-tipos/t1', body: { versao: 2, perfis: [{ perfil_id: 'p1' }, { perfil_id: 'p2', principal: true }] } }));
  });
});

describe('Perfis de medição e combustíveis', () => {
  it('perfil: dimensão + unidades por escolha múltipla (padrão travada); a unidade padrão não vai no corpo', async () => {
    await montar('PerfisMedicao');
    const form = await novo('perfil', 'p1');
    expect(within(form).getByTestId('perfil-escolha-dimensao')).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/^Código/), { target: { value: 'volume_util' } });
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'Volume útil' } });
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Dimensão' }), 'Volume');
    await semOpcoesAbertas();
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Finalidade' }), 'Capacidade (o que o bem comporta)');
    const grupo = within(form).getByRole('group', { name: 'Unidades permitidas' });
    const litros = within(grupo).getByRole('checkbox', { name: /litros/ });
    expect(litros.getAttribute('aria-checked')).toBe('true');
    expect(litros.disabled).toBe(true);
    fireEvent.click(within(grupo).getByRole('checkbox', { name: /m³/ }));
    salvar();
    await screen.findByText('Perfil de medição criado');
    expect(mutacoes()[0].body).toEqual({ codigo: 'VOLUME_UTIL', nome: 'Volume útil', dimensao: 'VOLUME', finalidade: 'CAPACIDADE', unidades_permitidas: ['L', 'm3'] });
  });

  it('perfil: tirar unidade em uso → 409 com a unidade na mensagem; dimensão e finalidade só leitura', async () => {
    await montar('PerfisMedicao');
    await abrir('perfil', 'p1');
    editar();
    const form = screen.getByTestId('b1-form');
    expect(within(form).getByLabelText('Dimensão').readOnly).toBe(true);
    expect(within(form).getByLabelText('Finalidade').readOnly).toBe(true);
    fireEvent.click(within(within(form).getByRole('group', { name: 'Unidades permitidas' })).getByRole('checkbox', { name: /hectares/ }));
    // Corpo real do servidor: field/reason no topo e a LISTA das unidades em uso em details.unidades.
    proxima = erroServidor(409, 'PERFIL_UNIDADE_EM_USO', { field: 'unidades_permitidas', reason: 'unidade_em_uso', details: { unidades: ['ha'] } });
    salvar();
    expect(await screen.findByText(/retirar uma unidade \(hectares \(ha\)\) já usada em medições de bens/)).toBeTruthy();
    expect(mutacoes()[0].body).toEqual({ versao: 1, unidades_permitidas: ['m2'] });
    expect(screen.getByTestId('b1-form')).toBeTruthy();
  });

  it('combustível: litros por padrão; GNV em m³; na edição a unidade fica só leitura', async () => {
    await montar('Combustiveis');
    let form = await novo('combustivel', 'c1');
    expect(within(form).getByRole('combobox', { name: 'Unidade' })).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/^Código/), { target: { value: 'gasolina' } });
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'Gasolina' } });
    salvar();
    await screen.findByText('Combustível criado');
    expect(mutacoes()[0].body).toEqual({ codigo: 'GASOLINA', nome: 'Gasolina', unidade: 'L' });

    cleanup();
    await montar('Combustiveis');
    form = await novo('combustivel', 'c1');
    fireEvent.change(within(form).getByLabelText(/^Código/), { target: { value: 'biometano' } });
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'Biometano' } });
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Unidade' }), 'Metros cúbicos (m³)');
    salvar();
    await screen.findByText('Combustível criado');
    expect(mutacoes().at(-1).body).toEqual({ codigo: 'BIOMETANO', nome: 'Biometano', unidade: 'm3' });

    cleanup();
    await montar('Combustiveis');
    await abrir('combustivel', 'c4');
    editar();
    form = screen.getByTestId('b1-form');
    expect(within(form).queryByRole('combobox', { name: 'Unidade' })).toBeNull();
    expect(within(form).getByLabelText('Unidade').value).toBe('Metros cúbicos (m³)');
    fireEvent.change(within(form).getByLabelText(/^Descrição/), { target: { value: 'Gás natural veicular' } });
    salvar();
    await screen.findByText('Combustível atualizado');
    expect(mutacoes().at(-1)).toEqual(expect.objectContaining({ method: 'PATCH', path: '/patrimonio-combustiveis/c4', body: { versao: 2, descricao: 'Gás natural veicular' } }));
  });
});

/** [página, prefixo do testid, id ativo, versão, rótulo no menu, caminho, aviso de inativado] */
const CASOS_SITUACAO = [
  ['FamiliasPatrimoniais', 'familia', 'f2', 3, 'família patrimonial', '/patrimonio-familias', 'Família patrimonial inativada'],
  ['TiposPatrimoniais', 'tipo', 't1', 2, 'tipo patrimonial', '/patrimonio-tipos', 'Tipo patrimonial inativado'],
  ['PerfisMedicao', 'perfil', 'p3', 2, 'perfil de medição', '/patrimonio-perfis-medicao', 'Perfil de medição inativado'],
  ['Combustiveis', 'combustivel', 'c4', 2, 'combustível', '/patrimonio-combustiveis', 'Combustível inativado'],
];

describe('Inativar e reativar — exige a ação extra "inativar"', () => {
  it.each(CASOS_SITUACAO)('%s: inativa pelo menu com confirmação ({versao, ativo:false}) e o registro aberto passa a oferecer reativar', async (pagina, prefixo, id, versao, rotulo, caminho, inativado) => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await montar(pagina);
    await abrir(prefixo, id);
    abrirMaisOpcoes();
    fireEvent.click(await screen.findByText(`Inativar ${rotulo}`));
    await screen.findByText(inativado);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mutacoes()).toEqual([expect.objectContaining({ method: 'PATCH', path: `${caminho}/${id}`, body: { versao, ativo: false } })]);
    abrirMaisOpcoes();
    expect(await screen.findByText(`Reativar ${rotulo}`)).toBeTruthy();
    expect(screen.queryByText(`Inativar ${rotulo}`)).toBeNull();
  });

  it.each(CASOS_SITUACAO)('%s: sem a ação inativar não há o item (nem no registro aberto, nem na linha selecionada)', async (pagina, prefixo, id, _versao, rotulo) => {
    sessao.permissao = permissaoCom({ novo: true, editar: true, salvar: true, excluir: true });
    await montar(pagina);
    fireEvent.click(await screen.findByTestId(`${prefixo}-nome-${id}`));
    abrirMaisOpcoes();
    await screen.findByText('Imprimir');
    expect(screen.queryByText(`Inativar ${rotulo}`)).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    cleanup();
    await montar(pagina);
    await abrir(prefixo, id);
    abrirMaisOpcoes();
    await screen.findByText('Imprimir');
    expect(screen.queryByText(`Inativar ${rotulo}`)).toBeNull();
    expect(screen.queryByText(`Reativar ${rotulo}`)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Excluir/ })).toBeNull();
  });

  it('cancelar a confirmação não grava; linha selecionada na lista também pode ser inativada', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await montar('FamiliasPatrimoniais');
    fireEvent.click(await screen.findByTestId('familia-nome-f1'));
    abrirMaisOpcoes();
    fireEvent.click(await screen.findByText('Inativar família patrimonial'));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(mutacoes()).toEqual([]);
    confirmSpy.mockReturnValue(true);
    abrirMaisOpcoes();
    fireEvent.click(await screen.findByText('Inativar família patrimonial'));
    await screen.findByText('Família patrimonial inativada');
    expect(mutacoes()).toEqual([expect.objectContaining({ method: 'PATCH', path: '/patrimonio-familias/f1', body: { versao: 1, ativo: false } })]);
  });

  it('reativa uma família inativa pelo filtro "Inativos" ({versao, ativo:true})', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await montar('FamiliasPatrimoniais');
    await screen.findByTestId('familia-nome-f1');
    await escolherOpcao(screen.getByRole('combobox', { name: 'Filtrar por situação' }), 'Inativos');
    await abrir('familia', 'f9');
    abrirMaisOpcoes();
    fireEvent.click(await screen.findByText('Reativar família patrimonial'));
    await screen.findByText('Família patrimonial reativada');
    expect(mutacoes()).toEqual([expect.objectContaining({ method: 'PATCH', path: '/patrimonio-familias/f9', body: { versao: 2, ativo: true } })]);
  });

  it('servidor nega (403 ACAO_NAO_PERMITIDA): mensagem de permissão e o registro continua ativo', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await montar('Combustiveis');
    await abrir('combustivel', 'c1');
    proxima = erroServidor(403, 'ACAO_NAO_PERMITIDA', { details: { tela: 'pat-combustiveis', exige: ['pat-combustiveis:inativar'] } });
    abrirMaisOpcoes();
    fireEvent.click(await screen.findByText('Inativar combustível'));
    expect(await screen.findByText(/Você não tem permissão para esta ação nesta tela/)).toBeTruthy();
    expect(screen.queryByText('Combustível inativado')).toBeNull();
    abrirMaisOpcoes();
    expect(await screen.findByText('Inativar combustível')).toBeTruthy();
  });
});

describe('Catálogos — permissões da tela', () => {
  it('sem visualizar: aviso e nenhuma listagem; sem Novo', async () => {
    sessao.permissao = { user_email: 'operador', modulos_permitidos: ['patrimonio'], permissoes_telas: [] };
    await montar('TiposPatrimoniais');
    expect(await screen.findByTestId('patrimonio-sem-permissao')).toHaveTextContent(/Tipos Patrimoniais/);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(listagens('/patrimonio-tipos')).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Novo' })).toBeNull();
  });

  it('só visualizar: lista e abre somente leitura, sem Novo/Editar/Duplicar', async () => {
    sessao.permissao = permissaoCom({});
    await montar('PerfisMedicao');
    const form = await abrir('perfil', 'p1');
    expect(within(form).getByLabelText(/^Nome/).readOnly).toBe(true);
    for (const nome of ['Novo', 'Editar', 'Duplicar']) expect(screen.queryByRole('button', { name: nome }), nome).toBeNull();
  });

  it('salvar sozinho libera Novo e Editar (novo|salvar, editar|salvar)', async () => {
    sessao.permissao = permissaoCom({ salvar: true });
    await montar('Combustiveis');
    await abrir('combustivel', 'c1');
    expect(screen.getByRole('button', { name: 'Novo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy();
  });

  it('cada tela com as suas ações: Famílias liberada não libera Combustíveis', async () => {
    sessao.permissao = {
      user_email: 'operador',
      modulos_permitidos: ['patrimonio'],
      permissoes_telas: [{ tela_id: 'pat-familias-patrimoniais', visualizar: true, novo: true, salvar: true, editar: true, excluir: false, importar: false, exportar: false, inativar: true }],
    };
    await montar('Combustiveis');
    expect(await screen.findByTestId('patrimonio-sem-permissao')).toBeTruthy();
    expect(listagens('/patrimonio-combustiveis')).toEqual([]);
  });
});

describe('Catálogo padrão — só o administrador, só nas Famílias', () => {
  it('administrador instala (POST {}) e vê o resumo com criados, existentes e conflitos', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    sessao.permissao = ADMIN;
    await montar('FamiliasPatrimoniais');
    await screen.findByTestId('familia-nome-f1');
    abrirMaisOpcoes();
    fireEvent.click(await screen.findByText('Instalar catálogo padrão'));
    const resumo = await screen.findByTestId('patrimonio-catalogo-padrao-resumo');
    expect(resumo.textContent).toMatch(/Criados: 4 famílias, 13 tipos, 5 perfis de medição, 4 combustíveis\./);
    expect(resumo.textContent).toMatch(/Já existiam: 0 famílias, 0 tipos, 1 perfil de medição, 1 combustível\./);
    expect(resumo.textContent).toMatch(/família MAQUINAS: já existe com outra natureza/);
    expect(resumo.textContent).toMatch(/tipo TRATOR_PNEUS: depende de um item em conflito/);
    expect(mutacoes()).toEqual([expect.objectContaining({ method: 'POST', path: '/patrimonio-catalogo-padrao', body: {} })]);
    // A lista é relida depois da instalação.
    await waitFor(() => expect(listagens('/patrimonio-familias').length).toBeGreaterThan(1));
    fireEvent.click(within(resumo).getByRole('button', { name: 'Fechar resumo' }));
    expect(screen.queryByTestId('patrimonio-catalogo-padrao-resumo')).toBeNull();
  });

  it('quem tem todas as ações da tela mas não é administrador não vê a instalação', async () => {
    sessao.permissao = permissaoCom({ novo: true, salvar: true, editar: true, excluir: true, inativar: true });
    await montar('FamiliasPatrimoniais');
    await screen.findByTestId('familia-nome-f1');
    abrirMaisOpcoes();
    await screen.findByText('Imprimir');
    expect(screen.queryByText('Instalar catálogo padrão')).toBeNull();
  });

  it('nas outras telas de catálogo nem o administrador vê a instalação', async () => {
    sessao.permissao = ADMIN;
    await montar('TiposPatrimoniais');
    await screen.findByTestId('tipo-nome-t1');
    abrirMaisOpcoes();
    await screen.findByText('Imprimir');
    expect(screen.queryByText('Instalar catálogo padrão')).toBeNull();
  });

  it('cancelar a confirmação não instala; recusa real do servidor (403 ACAO_NAO_PERMITIDA, exige administrador) mostra a mensagem', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    sessao.permissao = ADMIN;
    await montar('FamiliasPatrimoniais');
    await screen.findByTestId('familia-nome-f1');
    abrirMaisOpcoes();
    fireEvent.click(await screen.findByText('Instalar catálogo padrão'));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(mutacoes()).toEqual([]);
    confirmSpy.mockReturnValue(true);
    // Mesma negação de `adminOuIsAdmin()` (ex.: administrador rebaixado em outra sessão).
    proxima = erroServidor(403, 'ACAO_NAO_PERMITIDA', { details: { exige: ['administrador_ou_is_admin'] } });
    abrirMaisOpcoes();
    fireEvent.click(await screen.findByText('Instalar catálogo padrão'));
    expect(await screen.findByText('Só o administrador da fazenda pode fazer isso.')).toBeTruthy();
    expect(screen.queryByTestId('patrimonio-catalogo-padrao-resumo')).toBeNull();
  });
});
