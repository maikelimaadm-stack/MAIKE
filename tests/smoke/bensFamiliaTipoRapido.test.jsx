/**
 * D-PROD-161 (MAIKE-PATRIMONIO-SIMPLIFICA-01, §5.2) — "+ Nova família" e
 * "+ Novo tipo" DENTRO do formulário do Bem (cadastro rápido, D-PROD-95),
 * com a tela real (página, motor Base1, formulário, services, API, porta e
 * nativeHttpClient). Mocks só da borda: `fetch` (backend falso) e a sessão.
 *
 *  - quem cadastra OU edita bem (Bens novo|salvar|editar) vê o "+" no seletor;
 *    só visualizar (formulário só leitura) não vê; `criarCatalogo` falso → sem "+";
 *  - "+ Nova família": Nome (vem da busca) + Natureza; POST sem `codigo`
 *    (P-05, o servidor gera) e a família criada fica escolhida no bem (a
 *    natureza dela decide as abas);
 *  - "+ Novo tipo": só com família escolhida; POST `{familia_id, nome}` e o
 *    tipo criado fica escolhido;
 *  - nome repetido (409 PATRIMONIO_NOME_DUPLICADO): "Já existe…" + "Usar a
 *    existente" escolhe o homônimo ATIVO sem um 2º POST; homônimo inativo →
 *    aviso, nada escolhido;
 *  - na EDIÇÃO de um bem a Natureza da família nova vem travada na do bem
 *    (achado D6), só leitura.
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
  id: 'b1', numero: '7', codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA', familia: { id: 'f2', nome: 'Máquinas' },
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
let familias;
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
  familias = [
    { id: 'f1', codigo: 'BENFEITORIAS', nome: 'Benfeitorias', natureza: 'BENFEITORIA', ativo: true },
    { id: 'f2', codigo: 'MAQUINAS', nome: 'Máquinas', natureza: 'MAQUINA', ativo: true },
    { id: 'f7', codigo: 'GALPOES', nome: 'Galpões', natureza: 'BENFEITORIA', ativo: false },
  ];
  tipos = [{ id: 't2', codigo: 'TRATOR_PNEUS', nome: 'Trator de pneus', familia_id: 'f2', ativo: true }];
  const mesmoNome = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  backend = instalarBackendFake(async ({ method, path, query, body }) => {
    if (method === 'GET' && path === '/bens-patrimoniais') return { status: 200, body: envelope([RESUMO_TRATOR]) };
    if (method === 'GET' && path === '/empresas') return { status: 200, body: [{ id: 'emp-1', numero_empresa: 1, nome: 'Fazenda Boa Vista', fuso_horario: 'America/Sao_Paulo' }] };
    if (method === 'GET' && path === '/bens-patrimoniais/b1') return { status: 200, body: detalheTrator() };
    if (method === 'GET' && path === '/bens-patrimoniais-opcoes/familias') {
      const q = query.get('q')?.toLowerCase() ?? '';
      return opcoes(familias.filter((f) => f.ativo && (!q || f.nome.toLowerCase().includes(q))));
    }
    if (method === 'GET' && path === '/bens-patrimoniais-opcoes/tipos') {
      const q = query.get('q')?.toLowerCase() ?? '';
      return opcoes(tipos.filter((t) => t.ativo && t.familia_id === query.get('familia_id') && (!q || t.nome.toLowerCase().includes(q))));
    }
    if (method === 'GET' && path.startsWith('/bens-patrimoniais-opcoes/')) return opcoes([]);
    if (method === 'POST' && path === '/patrimonio-familias') {
      if (familias.some((f) => mesmoNome(f.nome, body.nome))) return erroServidor(409, 'PATRIMONIO_NOME_DUPLICADO', { field: 'nome', reason: 'nome_repetido' });
      sequencia += 1;
      const nova = { id: `fn${sequencia}`, codigo: `GERADO_${sequencia}`, nome: body.nome, natureza: body.natureza, descricao: null, ordem: null, vida_util_meses_padrao: null, ativo: true, versao: 1 };
      familias.push(nova);
      return { status: 201, body: nova };
    }
    if (method === 'POST' && path === '/patrimonio-tipos') {
      if (tipos.some((t) => t.familia_id === body.familia_id && mesmoNome(t.nome, body.nome))) return erroServidor(409, 'PATRIMONIO_NOME_DUPLICADO', { field: 'nome', reason: 'nome_repetido' });
      sequencia += 1;
      const novo = { id: `tn${sequencia}`, codigo: `GERADO_${sequencia}`, nome: body.nome, familia_id: body.familia_id, ativo: true, versao: 1 };
      tipos.push(novo);
      return { status: 201, body: novo };
    }
    if (method === 'POST' && path === '/bens-patrimoniais') {
      const familia = familias.find((f) => f.id === body.familia_id);
      return {
        status: 201,
        body: { ...detalheTrator(), id: 'b9', numero: '8', versao: 1, nome: body.nome, natureza: familia.natureza, familia: { ...familia }, tipo: { ...tipos.find((t) => t.id === body.tipo_id) }, medidor: null },
      };
    }
    if (method === 'PATCH' && path === '/bens-patrimoniais/b1') {
      const familia = familias.find((f) => f.id === body.familia_id) ?? detalheTrator().familia;
      const tipo = tipos.find((t) => t.id === body.tipo_id) ?? detalheTrator().tipo;
      return { status: 200, body: { ...detalheTrator(), versao: 5, familia, tipo } };
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
/** Abre o seletor, digita a busca e clica no "+". */
const pedirNovo = async (form, testId, busca, rotulo) => {
  fireEvent.click(within(form).getByTestId(testId));
  const painel = await within(form).findByTestId(`${testId}-painel`);
  if (busca) fireEvent.change(within(painel).getByRole('searchbox'), { target: { value: busca } });
  fireEvent.click(within(painel).getByRole('button', { name: rotulo }));
  return screen.findByRole('dialog', { name: rotulo.replace(/^\+ /, '') });
};
/** O ✓ do cadastro rápido (folha do celular no jsdom). */
const salvarRapido = (folha) => fireEvent.click(within(folha).getByRole('button', { name: 'Salvar' }));

describe('Bens — "+ Nova família" e "+ Novo tipo" (D-PROD-161)', () => {
  it('bem novo: cria a família (Nome da busca + Natureza, sem código) e o tipo; os dois ficam escolhidos e o POST do bem os usa', async () => {
    await montar();
    const form = await novoBem();
    const folha = await pedirNovo(form, 'bem-seletor-familia', '  Pivô central ', '+ Nova família');
    expect(within(folha).getByLabelText(/^Nome/).value).toBe('Pivô central');
    expect(within(folha).queryByLabelText(/^Código/)).toBeNull();
    await escolherOpcao(within(folha).getByRole('combobox', { name: 'Natureza' }), 'Equipamento');
    salvarRapido(folha);
    await screen.findByText('Família patrimonial criada');
    expect(mutacoes()).toEqual([expect.objectContaining({ method: 'POST', path: '/patrimonio-familias', body: { nome: 'Pivô central', natureza: 'EQUIPAMENTO' } })]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nova família' })).toBeNull());
    expect(within(form).getByTestId('bem-seletor-familia')).toHaveTextContent('Pivô central');
    expect(within(form).getByLabelText(/^Natureza/).value).toBe('Equipamento');
    expect(abas()).toEqual(['Identificação', 'Operação', 'Aquisição e depreciação']);

    const folhaTipo = await pedirNovo(form, 'bem-seletor-tipo', 'Pivô 8 torres', '+ Novo tipo');
    expect(within(folhaTipo).getByLabelText(/^Família/).value).toBe('Pivô central');
    expect(within(folhaTipo).getByLabelText(/^Família/).readOnly).toBe(true);
    salvarRapido(folhaTipo);
    await screen.findByText('Tipo patrimonial criado');
    expect(mutacoes()[1]).toEqual(expect.objectContaining({ method: 'POST', path: '/patrimonio-tipos', body: { familia_id: 'fn1', nome: 'Pivô 8 torres' } }));
    await waitFor(() => expect(within(form).getByTestId('bem-seletor-tipo')).toHaveTextContent('Pivô 8 torres'));

    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'Pivô da várzea' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Operação' }));
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Medidor' }), 'Sem medidor');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Bem patrimonial criado');
    expect(mutacoes()[2]).toEqual(
      expect.objectContaining({
        method: 'POST',
        path: '/bens-patrimoniais',
        body: { empresa_id: 'emp-1', nome: 'Pivô da várzea', familia_id: 'fn1', tipo_id: 'tn2', propriedade: 'PROPRIO', medidor: { tipo: 'SEM_MEDIDOR' } },
      }),
    );
  });

  it('"+ Novo tipo" só aparece com a família escolhida (o seletor de tipo fica bloqueado antes)', async () => {
    await montar();
    const form = await novoBem();
    fireEvent.click(within(form).getByTestId('bem-seletor-tipo'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(within(form).queryByTestId('bem-seletor-tipo-painel')).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Novo tipo' })).toBeNull();
    fireEvent.click(within(form).getByTestId('bem-seletor-familia'));
    fireEvent.click(await within(form).findByRole('option', { name: /^Máquinas/ }));
    fireEvent.click(within(form).getByTestId('bem-seletor-tipo'));
    const painel = await within(form).findByTestId('bem-seletor-tipo-painel');
    expect(within(painel).getByRole('button', { name: '+ Novo tipo' })).toBeTruthy();
  });

  it('nome repetido: "Já existe…" e "Usar a existente" escolhe a família ativa homônima, sem um 2º POST', async () => {
    await montar();
    const form = await novoBem();
    const folha = await pedirNovo(form, 'bem-seletor-familia', 'MÁQUINAS', '+ Nova família');
    await escolherOpcao(within(folha).getByRole('combobox', { name: 'Natureza' }), 'Máquina');
    salvarRapido(folha);
    const aviso = await within(folha).findByTestId('bem-catalogo-duplicado');
    expect(aviso).toHaveTextContent('Já existe uma família com este nome. Nada foi gravado.');
    fireEvent.click(within(aviso).getByRole('button', { name: 'Usar a existente' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nova família' })).toBeNull());
    expect(within(form).getByTestId('bem-seletor-familia')).toHaveTextContent('Máquinas');
    expect(mutacoes().filter((c) => c.path === '/patrimonio-familias')).toHaveLength(1);
    const procura = backend.chamadas.filter((c) => c.path === '/bens-patrimoniais-opcoes/familias' && c.query.q === 'MÁQUINAS');
    expect(procura).toHaveLength(1);
  });

  it('homônimo INATIVO: "Usar a existente" avisa e não escolhe nada', async () => {
    await montar();
    const form = await novoBem();
    const folha = await pedirNovo(form, 'bem-seletor-familia', 'Galpões', '+ Nova família');
    await escolherOpcao(within(folha).getByRole('combobox', { name: 'Natureza' }), 'Benfeitoria');
    salvarRapido(folha);
    fireEvent.click(within(await within(folha).findByTestId('bem-catalogo-duplicado')).getByRole('button', { name: 'Usar a existente' }));
    expect(await screen.findByText(/A família com este nome está inativa/)).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Nova família' })).toBeTruthy();
    expect(within(form).getByTestId('bem-seletor-familia')).toHaveTextContent('— Escolha a família —');
  });

  it('tipo com nome repetido na família: "Usar a existente" escolhe o tipo da família do bem', async () => {
    await montar();
    const form = await novoBem();
    fireEvent.click(within(form).getByTestId('bem-seletor-familia'));
    fireEvent.click(await within(form).findByRole('option', { name: /^Máquinas/ }));
    const folha = await pedirNovo(form, 'bem-seletor-tipo', 'trator de pneus', '+ Novo tipo');
    salvarRapido(folha);
    fireEvent.click(within(await within(folha).findByTestId('bem-catalogo-duplicado')).getByRole('button', { name: 'Usar a existente' }));
    await waitFor(() => expect(within(form).getByTestId('bem-seletor-tipo')).toHaveTextContent('Trator de pneus'));
    const procura = backend.chamadas.filter((c) => c.path === '/bens-patrimoniais-opcoes/tipos' && c.query.q === 'trator de pneus');
    expect(procura.at(-1).query.familia_id).toBe('f2');
  });

  it('EDIÇÃO (achado D6): a família nova nasce com a natureza do bem, travada e só leitura', async () => {
    await montar();
    await abrirTrator();
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const form = screen.getByTestId('b1-form');
    const folha = await pedirNovo(form, 'bem-seletor-familia', 'Tratores médios', '+ Nova família');
    expect(within(folha).queryByRole('combobox', { name: 'Natureza' })).toBeNull();
    const natureza = within(folha).getByLabelText(/^Natureza/);
    expect(natureza.value).toBe('Máquina');
    expect(natureza.readOnly).toBe(true);
    salvarRapido(folha);
    await screen.findByText('Família patrimonial criada');
    expect(mutacoes()[0].body).toEqual({ nome: 'Tratores médios', natureza: 'MAQUINA' });
    await waitFor(() => expect(within(form).getByTestId('bem-seletor-familia')).toHaveTextContent('Tratores médios'));
    // Trocar a família limpa o tipo: o "+ Novo tipo" cria na família nova.
    expect(within(form).getByTestId('bem-seletor-tipo')).toHaveTextContent('— Escolha o tipo —');
  });

  it('só visualizar: o formulário é só leitura e não há "+" (o seletor nem abre)', async () => {
    sessao.permissao = permissaoCom({});
    await montar();
    const form = await abrirTrator();
    fireEvent.click(within(form).getByTestId('bem-seletor-familia'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(within(form).queryByTestId('bem-seletor-familia-painel')).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Nova família' })).toBeNull();
  });
});

describe('FormularioBem — sem `criarCatalogo` não há "+"', () => {
  it('formulário editável mas sem a ação de criar catálogo: o painel abre sem "+ Nova família"', async () => {
    const { default: FormularioBem } = await import('@/components/patrimonio/FormularioBem');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <FormularioBem empresaId="emp-1" onSubmit={() => {}} acoesCatalogo={{ criarCatalogo: false, produtosDoTanque: false }} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId('bem-seletor-familia'));
    await screen.findByRole('option', { name: /^Máquinas/ });
    expect(screen.queryByRole('button', { name: '+ Nova família' })).toBeNull();
  });
});
