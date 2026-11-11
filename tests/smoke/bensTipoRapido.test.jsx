/**
 * D-PROD-163 (MAIKE-PATRIMONIO-SIMPLIFICA-02) — "Tipo de bem" + "Tipo" no
 * formulário do Bem, com "+ Novo tipo" (cadastro rápido, D-PROD-95), com a tela
 * real (página, motor Base1, formulário, services, API, porta e
 * nativeHttpClient). Mocks só da borda: `fetch` (backend falso) e a sessão.
 *
 *  - sem Família na tela: o formulário tem "Tipo de bem" (a lista FIXA de
 *    natureza) e "Tipo" (os tipos ATIVOS do Tipo de bem, `?natureza=`);
 *  - o Tipo fica bloqueado até escolher o Tipo de bem; trocar o Tipo de bem
 *    limpa o tipo e pede os tipos da nova natureza;
 *  - "+ Novo tipo": Tipo de bem travado (o do bem) + Nome; POST
 *    `{natureza, nome}` em `/patrimonio-tipos` (sem `familia_id`, sem código) e
 *    o tipo criado fica escolhido; o POST do bem vai com `natureza` + `tipo_id`,
 *    sem `familia_id`;
 *  - nome repetido (409 PATRIMONIO_NOME_DUPLICADO): "Usar o existente" escolhe o
 *    homônimo ATIVO do mesmo Tipo de bem sem um 2º POST; inativo → aviso;
 *  - edição: o Tipo de bem fica travado; o "+ Novo tipo" cria no do bem;
 *  - só visualizar: sem "+"; sem `criarCatalogo`: o painel abre sem "+".
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

const permissaoCom = (acoes) => ({
  user_email: 'operador',
  modulos_permitidos: ['patrimonio'],
  permissoes_telas: [{ tela_id: 'pat-bens-patrimoniais', visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes }],
});

const opcoes = (itens) => ({ status: 200, body: { itens, has_more: false, next_cursor: null } });

const RESUMO_TRATOR = {
  id: 'b1', numero: '7', codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA',
  tipo: { id: 't2', nome: 'Trator de pneus' }, propriedade: 'PROPRIO', medidor_tipo: 'HORIMETRO', ativo: true, versao: 4,
};
const detalheTrator = () => ({
  ...RESUMO_TRATOR,
  empresa_id: 'emp-1',
  familia: { id: 'f2', codigo: 'MAQUINAS', nome: 'Máquinas', natureza: 'MAQUINA', ativo: true },
  tipo: { id: 't2', codigo: 'TRATOR_PNEUS', nome: 'Trator de pneus', ativo: true },
  proprietario: null, responsavel: null, centro_custo: null, area: null, localizacao_descricao: null, marca: null, modelo: null,
  ano_fabricacao: null, ano_modelo: null, numero_serie: null, chassi: null, placa: null, placa_uf: null, renavam: null, potencia_cv: null,
  material: null, ano_conclusao: null, compatibilidade: null, especificacoes: null, observacoes: null,
  medidor: { tipo: 'HORIMETRO', unidade: 'h', leitura_inicial: '1250.0000', leitura_atual: '1300.0000', data_leitura: '2026-11-01', origem: 'AJUSTE_CADASTRO' },
  tanques: [],
  aquisicao: { data_aquisicao: null, data_disponibilidade: null, valor_aquisicao: null, custo_incorporacao: null, fornecedor: null, documento_referencia: null, garantia_ate: null },
  depreciacao: { depreciavel: false, metodo: null, vida_util_meses: null, residual_modo: null, valor_residual: null, residual_percentual: null, data_inicio_depreciacao: null, previa: null },
});

let backend;
/** @type {any[]} */
let tipos;
let sequencia;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem('empresa_selecionada_id', 'emp-1');
  window.localStorage.setItem('empresa_selecionada_cliente_id', 'cli-1');
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  sessao.permissao = permissaoCom({ novo: true, editar: true });
  sequencia = 0;
  tipos = [
    { id: 't1', codigo: 'CURRAL', nome: 'Curral', natureza: 'BENFEITORIA', ativo: true },
    { id: 't2', codigo: 'TRATOR_PNEUS', nome: 'Trator de pneus', natureza: 'MAQUINA', ativo: true },
    // Tipo de família antiga criada à mão (TESTE): continua sob a natureza dela.
    { id: 't8', codigo: 'TESTE_TIPO', nome: 'Tipo do teste', natureza: 'MAQUINA', ativo: true },
    { id: 't9', codigo: 'GALPAO_VELHO', nome: 'Galpão velho', natureza: 'BENFEITORIA', ativo: false },
  ];
  const mesmoNome = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  backend = instalarBackendFake(async ({ method, path, query, body }) => {
    if (method === 'GET' && path === '/bens-patrimoniais') return { status: 200, body: envelope([RESUMO_TRATOR]) };
    if (method === 'GET' && path === '/empresas') return { status: 200, body: [{ id: 'emp-1', numero_empresa: 1, nome: 'Fazenda Boa Vista', fuso_horario: 'America/Sao_Paulo' }] };
    if (method === 'GET' && path === '/bens-patrimoniais/b1') return { status: 200, body: detalheTrator() };
    if (method === 'GET' && path === '/bens-patrimoniais-opcoes/tipos') {
      const q = query.get('q')?.toLowerCase() ?? '';
      return opcoes(tipos.filter((t) => t.ativo && t.natureza === query.get('natureza') && (!q || t.nome.toLowerCase().includes(q))));
    }
    if (method === 'GET' && path.startsWith('/bens-patrimoniais-opcoes/')) return opcoes([]);
    if (method === 'POST' && path === '/patrimonio-tipos') {
      if (tipos.some((t) => t.natureza === body.natureza && mesmoNome(t.nome, body.nome))) return erroServidor(409, 'PATRIMONIO_NOME_DUPLICADO', { field: 'nome', reason: 'nome_repetido' });
      sequencia += 1;
      const novo = { id: `tn${sequencia}`, codigo: `GERADO_${sequencia}`, nome: body.nome, natureza: body.natureza, familia_id: `fp-${body.natureza}`, ativo: true, versao: 1, bens_em_uso: 0 };
      tipos.push(novo);
      return { status: 201, body: novo };
    }
    if (method === 'POST' && path === '/bens-patrimoniais') {
      const tipo = tipos.find((t) => t.id === body.tipo_id);
      return { status: 201, body: { ...detalheTrator(), id: 'b9', numero: '8', versao: 1, nome: body.nome, natureza: body.natureza, tipo: { ...tipo }, medidor: null } };
    }
    if (method === 'PATCH' && path === '/bens-patrimoniais/b1') {
      const tipo = tipos.find((t) => t.id === body.tipo_id) ?? detalheTrator().tipo;
      return { status: 200, body: { ...detalheTrator(), versao: 5, tipo } };
    }
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const montar = async () => {
  const { default: Pagina } = await import('@/pages/BensPatrimoniais');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <Pagina />
    </QueryClientProvider>,
  );
};

const mutacoes = () => backend.chamadas.filter((c) => c.method !== 'GET');
const opcoesDeTipos = () => backend.chamadas.filter((c) => c.method === 'GET' && c.path === '/bens-patrimoniais-opcoes/tipos');
const abas = () => screen.getAllByRole('tab').map((t) => t.textContent.trim());
const novoBem = async () => {
  await screen.findByTestId('bem-nome-b1');
  fireEvent.click(screen.getByRole('button', { name: 'Novo' }));
  return screen.findByTestId('b1-form');
};
const abrirTrator = async () => {
  fireEvent.doubleClick(await screen.findByTestId('bem-nome-b1'));
  return screen.findByTestId('b1-form');
};
const tipoDeBem = (form) => within(form).getByRole('combobox', { name: 'Tipo de bem' });
/** Abre o seletor de tipo, digita a busca e clica no "+ Novo tipo". */
const pedirNovoTipo = async (form, busca) => {
  fireEvent.click(within(form).getByTestId('bem-seletor-tipo'));
  const painel = await within(form).findByTestId('bem-seletor-tipo-painel');
  if (busca) fireEvent.change(within(painel).getByRole('searchbox'), { target: { value: busca } });
  fireEvent.click(within(painel).getByRole('button', { name: '+ Novo tipo' }));
  return screen.findByRole('dialog', { name: 'Novo tipo' });
};
/** O ✓ do cadastro rápido (folha do celular no jsdom). */
const salvarRapido = (folha) => fireEvent.click(within(folha).getByRole('button', { name: 'Salvar' }));

describe('Bens — "Tipo de bem" + "Tipo" sem Família (D-PROD-163)', () => {
  it('o formulário não tem Família: "Tipo de bem" é a lista fixa e o Tipo fica bloqueado até escolher', async () => {
    await montar();
    const form = await novoBem();
    expect(within(form).queryByTestId('bem-seletor-familia')).toBeNull();
    expect(within(form).queryByText(/Família/)).toBeNull();
    expect(within(form).queryByLabelText(/^Natureza/)).toBeNull();
    expect(within(form).getByTestId('bem-escolha-tipo-de-bem')).toHaveTextContent('Escolha o tipo de bem');
    fireEvent.click(tipoDeBem(form));
    const nomes = (await screen.findAllByRole('option')).map((o) => o.textContent.trim());
    expect(nomes).toEqual(['— Escolha o tipo de bem —', 'Benfeitoria', 'Máquina', 'Veículo', 'Implemento', 'Equipamento', 'Outro']);
    fireEvent.click(tipoDeBem(form));
    // Tipo bloqueado antes do Tipo de bem: o painel não abre nem há "+".
    fireEvent.click(within(form).getByTestId('bem-seletor-tipo'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(within(form).queryByTestId('bem-seletor-tipo-painel')).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Novo tipo' })).toBeNull();
    expect(opcoesDeTipos()).toEqual([]);
  });

  it('tipos filtrados pelo Tipo de bem (inclusive de família antiga); trocar o Tipo de bem limpa o tipo e troca as abas', async () => {
    await montar();
    const form = await novoBem();
    await escolherOpcao(tipoDeBem(form), 'Máquina');
    expect(within(form).queryByTestId('bem-escolha-tipo-de-bem')).toBeNull();
    expect(abas()).toEqual(['Identificação', 'Operação', 'Aquisição e depreciação']);
    fireEvent.click(within(form).getByTestId('bem-seletor-tipo'));
    const painel = await within(form).findByTestId('bem-seletor-tipo-painel');
    expect(await within(painel).findByRole('option', { name: /^Trator de pneus/ })).toBeTruthy();
    expect(within(painel).getByRole('option', { name: /^Tipo do teste/ })).toBeTruthy();
    expect(within(painel).queryByRole('option', { name: /^Curral/ })).toBeNull();
    expect(opcoesDeTipos().at(-1).query).toMatchObject({ natureza: 'MAQUINA' });
    expect(opcoesDeTipos().at(-1).query.familia_id).toBeUndefined();
    fireEvent.click(within(painel).getByRole('option', { name: /^Trator de pneus/ }));
    await waitFor(() => expect(within(form).getByTestId('bem-seletor-tipo')).toHaveTextContent('Trator de pneus'));

    await escolherOpcao(tipoDeBem(form), 'Benfeitoria');
    expect(within(form).getByTestId('bem-seletor-tipo')).toHaveTextContent('— Escolha o tipo —');
    expect(abas()).toEqual(['Identificação', 'Aquisição e depreciação']);
    fireEvent.click(within(form).getByTestId('bem-seletor-tipo'));
    expect(await within(form).findByRole('option', { name: /^Curral/ })).toBeTruthy();
    expect(opcoesDeTipos().at(-1).query).toMatchObject({ natureza: 'BENFEITORIA' });
  });

  it('"+ Novo tipo": Tipo de bem travado e Nome; POST {natureza, nome}; o tipo fica escolhido e o POST do bem vai sem familia_id', async () => {
    await montar();
    const form = await novoBem();
    await escolherOpcao(tipoDeBem(form), 'Equipamento');
    const folha = await pedirNovoTipo(form, '  Pivô 8 torres ');
    expect(within(folha).getByLabelText(/^Nome/).value).toBe('Pivô 8 torres');
    const travado = within(folha).getByLabelText(/^Tipo de bem/);
    expect(travado.value).toBe('Equipamento');
    expect(travado.readOnly).toBe(true);
    expect(within(folha).queryByLabelText(/^Família/)).toBeNull();
    expect(within(folha).queryByLabelText(/^Código/)).toBeNull();
    salvarRapido(folha);
    await screen.findByText('Tipo criado');
    expect(mutacoes()).toEqual([expect.objectContaining({ method: 'POST', path: '/patrimonio-tipos', body: { natureza: 'EQUIPAMENTO', nome: 'Pivô 8 torres' } })]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Novo tipo' })).toBeNull());
    await waitFor(() => expect(within(form).getByTestId('bem-seletor-tipo')).toHaveTextContent('Pivô 8 torres'));

    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'Pivô da várzea' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Operação' }));
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Medidor' }), 'Sem medidor');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Bem patrimonial criado');
    expect(mutacoes()[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        path: '/bens-patrimoniais',
        body: { empresa_id: 'emp-1', natureza: 'EQUIPAMENTO', nome: 'Pivô da várzea', tipo_id: 'tn1', propriedade: 'PROPRIO', medidor: { tipo: 'SEM_MEDIDOR' } },
      }),
    );
  });

  it('nome repetido no Tipo de bem: "Usar o existente" escolhe o tipo ativo homônimo, sem um 2º POST', async () => {
    await montar();
    const form = await novoBem();
    await escolherOpcao(tipoDeBem(form), 'Máquina');
    const folha = await pedirNovoTipo(form, 'trator de pneus');
    salvarRapido(folha);
    const aviso = await within(folha).findByTestId('bem-catalogo-duplicado');
    expect(aviso).toHaveTextContent('Já existe um tipo com este nome neste Tipo de bem. Nada foi gravado.');
    fireEvent.click(within(aviso).getByRole('button', { name: 'Usar o existente' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Novo tipo' })).toBeNull());
    expect(within(form).getByTestId('bem-seletor-tipo')).toHaveTextContent('Trator de pneus');
    expect(mutacoes().filter((c) => c.path === '/patrimonio-tipos')).toHaveLength(1);
    const procura = opcoesDeTipos().filter((c) => c.query.q === 'trator de pneus');
    expect(procura.at(-1).query).toMatchObject({ natureza: 'MAQUINA' });
  });

  it('homônimo INATIVO: "Usar o existente" avisa e não escolhe nada', async () => {
    await montar();
    const form = await novoBem();
    await escolherOpcao(tipoDeBem(form), 'Benfeitoria');
    const folha = await pedirNovoTipo(form, 'Galpão velho');
    salvarRapido(folha);
    fireEvent.click(within(await within(folha).findByTestId('bem-catalogo-duplicado')).getByRole('button', { name: 'Usar o existente' }));
    expect(await screen.findByText(/O tipo com este nome está inativo/)).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Novo tipo' })).toBeTruthy();
    expect(within(form).getByTestId('bem-seletor-tipo')).toHaveTextContent('— Escolha o tipo —');
  });

  it('EDIÇÃO: o Tipo de bem fica travado; o "+ Novo tipo" cria no Tipo de bem do bem e o PATCH leva só tipo_id', async () => {
    await montar();
    await abrirTrator();
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const form = screen.getByTestId('b1-form');
    expect(tipoDeBem(form)).toBeDisabled();
    expect(tipoDeBem(form)).toHaveTextContent('Máquina');
    const folha = await pedirNovoTipo(form, 'Tratores médios');
    expect(within(folha).getByLabelText(/^Tipo de bem/).value).toBe('Máquina');
    salvarRapido(folha);
    await screen.findByText('Tipo criado');
    expect(mutacoes()[0].body).toEqual({ natureza: 'MAQUINA', nome: 'Tratores médios' });
    await waitFor(() => expect(within(form).getByTestId('bem-seletor-tipo')).toHaveTextContent('Tratores médios'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Bem patrimonial atualizado');
    expect(mutacoes()[1]).toEqual(expect.objectContaining({ method: 'PATCH', path: '/bens-patrimoniais/b1', body: { empresa_id: 'emp-1', versao: 4, tipo_id: 'tn1' } }));
  });

  it('só visualizar: o formulário é só leitura e não há "+" (o seletor nem abre)', async () => {
    sessao.permissao = permissaoCom({});
    await montar();
    const form = await abrirTrator();
    expect(tipoDeBem(form)).toBeDisabled();
    fireEvent.click(within(form).getByTestId('bem-seletor-tipo'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(within(form).queryByTestId('bem-seletor-tipo-painel')).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Novo tipo' })).toBeNull();
  });
});

describe('FormularioBem — sem `criarCatalogo` não há "+"', () => {
  it('formulário editável mas sem a ação de criar catálogo: o painel de tipos abre sem "+ Novo tipo"', async () => {
    const { default: FormularioBem } = await import('@/components/patrimonio/FormularioBem');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <FormularioBem empresaId="emp-1" onSubmit={() => {}} acoesCatalogo={{ criarCatalogo: false, produtosDoTanque: false }} />
      </QueryClientProvider>,
    );
    await escolherOpcao(screen.getByRole('combobox', { name: 'Tipo de bem' }), 'Máquina');
    fireEvent.click(screen.getByTestId('bem-seletor-tipo'));
    await screen.findByRole('option', { name: /^Trator de pneus/ });
    expect(screen.queryByRole('button', { name: '+ Novo tipo' })).toBeNull();
  });
});
