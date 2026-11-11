/**
 * D-PROD-163 (MAIKE-PATRIMONIO-SIMPLIFICA-02) — "⋯ › Gerenciar tipos" no
 * cadastro de Bens (o cadastro de família saiu, e o "Instalar catálogo padrão"
 * também: o servidor garante o catálogo sozinho). Tela real; mocks só da borda.
 *
 *  - o "⋯" tem "Gerenciar tipos" para quem vê Bens; não há mais "Gerenciar
 *    famílias e tipos" nem "Instalar catálogo padrão" (nem para o administrador);
 *  - a lista vem de `/patrimonio-tipos` (sem `empresa_id`), com o Tipo de bem
 *    e a contagem de bens de cada tipo; o filtro "Tipo de bem" vai na query
 *    `natureza`, a busca em `q`;
 *  - "Renomear" na linha: PATCH `{versao, nome}`; Escape (no campo, sem fechar
 *    o diálogo) e Cancelar descartam; renomear relê a lista de Bens e o bem
 *    aberto (a grade e o campo Tipo mostram o nome novo);
 *  - "Excluir" pede confirmação e manda `DELETE /patrimonio-tipos/:id?versao=N`;
 *    409 `PATRIMONIO_TIPO_EM_USO` mostra "Este tipo está em uso por N bem(ns).
 *    Troque o tipo desses bens antes de excluir."; 409 de versão relê a lista;
 *  - "+ Novo tipo" cria `{natureza, nome}`;
 *  - permissões: Renomear/Excluir = Bens editar|salvar; Novo = novo|salvar|editar;
 *    Reativar (tipo antigo inativo) = `inativar`; só ver = só a lista;
 *  - celular (achado do E2E real a 390 px): a folha das escolhas (filtro "Tipo
 *    de bem" e o "Tipo de bem" do "+ Novo tipo") nasce DENTRO do diálogo, com
 *    toque; Escape fecha só a folha (padrão da D-PROD-161).
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

const permissaoCom = (acoes, extra = {}) => ({
  user_email: 'operador',
  modulos_permitidos: ['patrimonio'],
  ...extra,
  permissoes_telas: [{ tela_id: 'pat-bens-patrimoniais', visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes }],
});

const TIPOS = () => [
  { id: 't1', codigo: 'CURRAL', nome: 'Curral', natureza: 'BENFEITORIA', familia_id: 'f1', familia: { id: 'f1', nome: 'Benfeitorias', natureza: 'BENFEITORIA' }, ativo: true, versao: 1, bens_em_uso: 0 },
  { id: 't2', codigo: 'TRATOR_PNEUS', nome: 'Trator de pneus', natureza: 'MAQUINA', familia_id: 'f2', familia: { id: 'f2', nome: 'Máquinas', natureza: 'MAQUINA' }, ativo: true, versao: 4, bens_em_uso: 2 },
  { id: 't9', codigo: 'GALPAO_VELHO', nome: 'Galpão velho', natureza: 'BENFEITORIA', familia_id: 'f1', familia: { id: 'f1', nome: 'Benfeitorias', natureza: 'BENFEITORIA' }, ativo: false, versao: 3, bens_em_uso: 0 },
];
const RESUMO_TRATOR = {
  id: 'b1', numero: '7', codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA',
  tipo: { id: 't2', nome: 'Trator de pneus' }, propriedade: 'PROPRIO', medidor_tipo: 'HORIMETRO', ativo: true, versao: 4,
};
/** O nome ATUAL do tipo t2 (o servidor real devolve o nome gravado do tipo no resumo e no detalhe). */
const tipoDoTrator = () => {
  const t = tipos.find((x) => x.id === 't2');
  return { id: 't2', codigo: 'TRATOR_PNEUS', nome: t?.nome ?? 'Trator de pneus', ativo: true };
};
const detalheTrator = () => ({
  ...RESUMO_TRATOR,
  empresa_id: 'emp-1',
  familia: { id: 'f2', codigo: 'MAQUINAS', nome: 'Máquinas', natureza: 'MAQUINA', ativo: true },
  tipo: tipoDoTrator(),
  proprietario: null, responsavel: null, centro_custo: null, area: null,
  localizacao_descricao: null, marca: 'Valtra', modelo: 'A950', ano_fabricacao: 2020, ano_modelo: 2021, numero_serie: 'SN-1', chassi: null, placa: null, placa_uf: null, renavam: null,
  potencia_cv: '95.0000', material: null, ano_conclusao: null, compatibilidade: null, especificacoes: null, observacoes: null,
  medidor: { tipo: 'HORIMETRO', unidade: 'h', leitura_inicial: '1250.0000', leitura_atual: '1300.0000', data_leitura: '2026-11-01', origem: 'AJUSTE_CADASTRO' },
  tanques: [],
  aquisicao: { data_aquisicao: null, data_disponibilidade: null, valor_aquisicao: null, custo_incorporacao: null, fornecedor: null, documento_referencia: null, garantia_ate: null },
  depreciacao: { depreciavel: false, metodo: null, vida_util_meses: null, residual_modo: null, valor_residual: null, residual_percentual: null, data_inicio_depreciacao: null, previa: null },
  consumo: null,
});

let backend;
/** @type {any[]} */
let tipos;
/** Resposta de erro injetada na PRÓXIMA gravação. */
let proxima;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem('empresa_selecionada_id', 'emp-1');
  window.localStorage.setItem('empresa_selecionada_cliente_id', 'cli-1');
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  sessao.permissao = permissaoCom({ novo: true, editar: true, inativar: true });
  proxima = null;
  tipos = TIPOS();
  backend = instalarBackendFake(async ({ method, path, query, body }) => {
    if (proxima && method !== 'GET') {
      const r = proxima;
      proxima = null;
      return r;
    }
    if (method === 'GET' && path === '/bens-patrimoniais') return { status: 200, body: envelope([{ ...RESUMO_TRATOR, tipo: { id: 't2', nome: tipoDoTrator().nome } }]) };
    if (method === 'GET' && path === '/bens-patrimoniais/b1') return { status: 200, body: detalheTrator() };
    if (method === 'GET' && path === '/empresas') return { status: 200, body: [{ id: 'emp-1', numero_empresa: 1, nome: 'Fazenda Boa Vista', fuso_horario: 'America/Sao_Paulo' }] };
    if (method === 'GET' && path.startsWith('/bens-patrimoniais-opcoes/')) return { status: 200, body: { itens: [], has_more: false, next_cursor: null } };
    if (method === 'GET' && path === '/patrimonio-tipos') {
      const q = query.get('q')?.toLowerCase() ?? '';
      const itens = tipos.filter((t) => (!query.get('natureza') || t.natureza === query.get('natureza')) && (!q || t.nome.toLowerCase().includes(q)));
      return { status: 200, body: envelope(itens) };
    }
    if (method === 'POST' && path === '/patrimonio-tipos') {
      const novo = { id: 'tn1', codigo: 'GERADO', familia_id: `fp-${body.natureza}`, ativo: true, versao: 1, bens_em_uso: 0, ...body };
      tipos.push(novo);
      return { status: 201, body: novo };
    }
    if (method === 'PATCH' && path.startsWith('/patrimonio-tipos/')) {
      const i = tipos.findIndex((x) => x.id === path.split('/')[2]);
      tipos[i] = { ...tipos[i], ...body, versao: tipos[i].versao + 1 };
      return { status: 200, body: tipos[i] };
    }
    if (method === 'DELETE' && path.startsWith('/patrimonio-tipos/')) {
      const id = path.split('/')[2];
      const t = tipos.find((x) => x.id === id);
      if (t.bens_em_uso > 0) return erroServidor(409, 'PATRIMONIO_TIPO_EM_USO', { details: { field: 'id', reason: 'tipo_em_uso', bens: t.bens_em_uso } });
      tipos = tipos.filter((x) => x.id !== id);
      return { status: 204 };
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
const listagens = () => backend.chamadas.filter((c) => c.method === 'GET' && c.path === '/patrimonio-tipos');
const abrirMenu = async () => {
  await screen.findByTestId('bem-nome-b1');
  fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }));
  await screen.findByText('Imprimir');
};
const abrirGerenciar = async () => {
  await abrirMenu();
  fireEvent.click(screen.getByText('Gerenciar tipos'));
  const dialogo = await screen.findByTestId('gerenciar-tipos');
  await within(dialogo).findByTestId('gerenciar-lista-tipos');
  return dialogo;
};

describe('Bens — "⋯ › Gerenciar tipos" (D-PROD-163)', () => {
  it('quem só vê Bens tem "Gerenciar tipos"; não há mais família nem "Instalar catálogo padrão" (nem para o administrador)', async () => {
    sessao.permissao = permissaoCom({}, { is_admin: true });
    await montar();
    await abrirMenu();
    expect(screen.getByText('Gerenciar tipos')).toBeTruthy();
    expect(screen.queryByText(/Gerenciar famílias/)).toBeNull();
    expect(screen.queryByText('Instalar catálogo padrão')).toBeNull();
    fireEvent.click(screen.getByText('Gerenciar tipos'));
    const dialogo = await screen.findByTestId('gerenciar-tipos');
    await within(dialogo).findByTestId('gerenciar-lista-tipos');
    expect(within(dialogo).queryByRole('tab')).toBeNull();
    expect(within(dialogo).queryByText(/Família/)).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(backend.chamadas.some((c) => c.path === '/patrimonio-catalogo-padrao' || c.path.startsWith('/patrimonio-familias'))).toBe(false);
  });

  it('lista os tipos (ativos e inativos) sem empresa, com Tipo de bem e bens em uso; filtro de Tipo de bem e busca vão na query', async () => {
    await montar();
    const dialogo = await abrirGerenciar();
    expect(within(dialogo).getByTestId('gerenciar-tipos-t2')).toHaveTextContent(/Trator de pneus.*Máquina · 2 bens/);
    expect(within(dialogo).getByTestId('gerenciar-tipos-t1-dados')).toHaveTextContent('Benfeitoria · Nenhum bem');
    expect(within(dialogo).getByTestId('gerenciar-tipos-t9-dados')).toHaveTextContent('Benfeitoria · Nenhum bem · Inativo');
    expect(listagens()[0].query).toEqual({ limit: '50' });

    await escolherOpcao(within(dialogo).getByRole('combobox', { name: 'Filtrar por tipo de bem' }), 'Máquina');
    await waitFor(() => expect(listagens().at(-1).query).toMatchObject({ natureza: 'MAQUINA' }));
    await waitFor(() => expect(within(dialogo).queryByTestId('gerenciar-tipos-t1')).toBeNull());
    expect(within(dialogo).getByTestId('gerenciar-tipos-t2')).toBeTruthy();
    fireEvent.change(within(dialogo).getByRole('searchbox', { name: 'Buscar tipos' }), { target: { value: 'trat' } });
    await waitFor(() => expect(listagens().at(-1).query).toMatchObject({ q: 'trat', natureza: 'MAQUINA' }));
    expect(backend.chamadas.every((c) => !c.path.startsWith('/patrimonio-tipos') || c.query.empresa_id === undefined)).toBe(true);
  });

  it('"Renomear" na linha manda o PATCH {versao, nome}; Cancelar descarta sem enviar', async () => {
    await montar();
    const dialogo = await abrirGerenciar();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Renomear Curral' }));
    let campo = within(dialogo).getByRole('textbox', { name: 'Novo nome do tipo Curral' });
    fireEvent.change(campo, { target: { value: 'Curral de manejo' } });
    fireEvent.click(within(within(dialogo).getByTestId('gerenciar-tipos-t1')).getByRole('button', { name: 'Cancelar' }));
    expect(within(dialogo).queryByRole('textbox', { name: 'Novo nome do tipo Curral' })).toBeNull();
    expect(mutacoes()).toEqual([]);

    fireEvent.click(within(dialogo).getByRole('button', { name: 'Renomear Curral' }));
    campo = within(dialogo).getByRole('textbox', { name: 'Novo nome do tipo Curral' });
    fireEvent.change(campo, { target: { value: '  Curral de manejo ' } });
    fireEvent.click(within(within(dialogo).getByTestId('gerenciar-tipos-t1')).getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Tipo renomeado');
    expect(mutacoes()).toEqual([expect.objectContaining({ method: 'PATCH', path: '/patrimonio-tipos/t1', body: { versao: 1, nome: 'Curral de manejo' } })]);
    await waitFor(() => expect(within(dialogo).getByTestId('gerenciar-tipos-t1')).toHaveTextContent('Curral de manejo'));
  });

  it('Escape no campo "Renomear" cancela só a renomeação: o diálogo continua aberto e nada é enviado', async () => {
    await montar();
    const dialogo = await abrirGerenciar();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Renomear Curral' }));
    const campo = within(dialogo).getByRole('textbox', { name: 'Novo nome do tipo Curral' });
    fireEvent.change(campo, { target: { value: 'Curral X' } });
    await act(async () => {
      fireEvent.keyDown(campo, { key: 'Escape' });
    });
    expect(screen.getByTestId('gerenciar-tipos')).toBeTruthy();
    expect(within(screen.getByTestId('gerenciar-tipos')).queryByRole('textbox', { name: 'Novo nome do tipo Curral' })).toBeNull();
    expect(within(screen.getByTestId('gerenciar-tipos')).getByTestId('gerenciar-tipos-t1')).toHaveTextContent('Curral');
    expect(mutacoes()).toEqual([]);
    // Sem renomeação aberta, o Escape volta a fechar o diálogo.
    await act(async () => {
      fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByTestId('gerenciar-tipos')).toBeNull());
  });

  it('renomear o tipo de um bem relê a lista de Bens: a grade mostra o nome novo depois de fechar o diálogo', async () => {
    await montar();
    expect(await screen.findByTestId('bem-nome-b1')).toBeTruthy();
    expect(within(screen.getByTestId('bem-nome-b1').closest('tr')).getByText('Trator de pneus')).toBeTruthy();
    const leiturasAntes = backend.chamadas.filter((c) => c.method === 'GET' && c.path === '/bens-patrimoniais').length;
    const dialogo = await abrirGerenciar();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Renomear Trator de pneus' }));
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Novo nome do tipo Trator de pneus' }), { target: { value: 'Trator agricola' } });
    fireEvent.click(within(within(dialogo).getByTestId('gerenciar-tipos-t2')).getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Tipo renomeado');
    await waitFor(() => expect(backend.chamadas.filter((c) => c.method === 'GET' && c.path === '/bens-patrimoniais').length).toBeGreaterThan(leiturasAntes));
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(within(screen.getByTestId('bem-nome-b1').closest('tr')).getByText('Trator agricola')).toBeTruthy());
    expect(within(screen.getByTestId('bem-nome-b1').closest('tr')).queryByText('Trator de pneus')).toBeNull();
  });

  it('bem aberto (consulta): renomear o tipo dele relê o detalhe e o campo Tipo mostra o nome novo', async () => {
    await montar();
    fireEvent.doubleClick(await screen.findByTestId('bem-nome-b1'));
    const form = await screen.findByTestId('b1-form');
    await waitFor(() => expect(within(form).getByTestId('bem-seletor-tipo')).toHaveTextContent('Trator de pneus'));
    const leiturasAntes = backend.chamadas.filter((c) => c.method === 'GET' && c.path === '/bens-patrimoniais/b1').length;
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }));
    fireEvent.click(await screen.findByText('Gerenciar tipos'));
    const dialogo = await screen.findByTestId('gerenciar-tipos');
    await within(dialogo).findByTestId('gerenciar-lista-tipos');
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Renomear Trator de pneus' }));
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Novo nome do tipo Trator de pneus' }), { target: { value: 'Trator agricola' } });
    fireEvent.click(within(within(dialogo).getByTestId('gerenciar-tipos-t2')).getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Tipo renomeado');
    await waitFor(() => expect(backend.chamadas.filter((c) => c.method === 'GET' && c.path === '/bens-patrimoniais/b1').length).toBeGreaterThan(leiturasAntes));
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(within(screen.getByTestId('b1-form')).getByTestId('bem-seletor-tipo')).toHaveTextContent('Trator agricola'));
  });

  it('"Excluir" pede confirmação e manda DELETE com a versao; o tipo sai da lista', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await montar();
    const dialogo = await abrirGerenciar();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Excluir Curral' }));
    await screen.findByText('Tipo excluído');
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toMatch(/Excluir o tipo "Curral"/);
    expect(mutacoes()).toEqual([expect.objectContaining({ method: 'DELETE', path: '/patrimonio-tipos/t1', query: { versao: '1' }, body: null })]);
    await waitFor(() => expect(within(dialogo).queryByTestId('gerenciar-tipos-t1')).toBeNull());
  });

  it('tipo em uso: 409 PATRIMONIO_TIPO_EM_USO mostra "Este tipo está em uso por 2 bem(ns)…" na linha e nada sai da lista', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await montar();
    const dialogo = await abrirGerenciar();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Excluir Trator de pneus' }));
    const aviso = await within(dialogo).findByTestId('gerenciar-tipo-em-uso-t2');
    expect(aviso).toHaveTextContent('Este tipo está em uso por 2 bem(ns). Troque o tipo desses bens antes de excluir.');
    expect(mutacoes()).toEqual([expect.objectContaining({ method: 'DELETE', path: '/patrimonio-tipos/t2', query: { versao: '4' } })]);
    expect(within(dialogo).getByTestId('gerenciar-tipos-t2')).toBeTruthy();
  });

  it('cancelar a confirmação não exclui; 409 de versão relê a lista', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await montar();
    const dialogo = await abrirGerenciar();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Excluir Curral' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(mutacoes()).toEqual([]);

    confirmSpy.mockReturnValue(true);
    const antes = listagens().length;
    proxima = erroServidor(409, 'PATRIMONIO_VERSAO_CONFLITO', { details: { versao_atual: 2, versao_informada: 1 } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Excluir Curral' }));
    expect(await screen.findByText(/A lista foi recarregada com a versão atual/)).toBeTruthy();
    await waitFor(() => expect(listagens().length).toBeGreaterThan(antes));
  });

  it('"+ Novo tipo" no diálogo: Tipo de bem (vem do filtro) + Nome; POST {natureza, nome}', async () => {
    await montar();
    const dialogo = await abrirGerenciar();
    await escolherOpcao(within(dialogo).getByRole('combobox', { name: 'Filtrar por tipo de bem' }), 'Veículo');
    fireEvent.click(within(dialogo).getByTestId('gerenciar-novo'));
    const form = within(dialogo).getByTestId('gerenciar-form');
    expect(within(form).getByRole('combobox', { name: 'Tipo de bem' })).toHaveTextContent('Veículo');
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'Caminhonete' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Criar tipo' }));
    await screen.findByText('Tipo criado');
    expect(mutacoes()).toEqual([expect.objectContaining({ method: 'POST', path: '/patrimonio-tipos', body: { natureza: 'VEICULO', nome: 'Caminhonete' } })]);
    await waitFor(() => expect(within(dialogo).queryByTestId('gerenciar-form')).toBeNull());
  });

  it('tipo antigo inativo: "Reativar" (ação inativar) manda {versao, ativo:true}', async () => {
    await montar();
    const dialogo = await abrirGerenciar();
    expect(within(dialogo).queryByRole('button', { name: 'Reativar Curral' })).toBeNull();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Reativar Galpão velho' }));
    await screen.findByText('Tipo reativado');
    expect(mutacoes()).toEqual([expect.objectContaining({ method: 'PATCH', path: '/patrimonio-tipos/t9', body: { versao: 3, ativo: true } })]);
  });
});

describe('Gerenciar tipos — permissões (espelho das guardas do servidor)', () => {
  it('só novo: "+ Novo tipo" sem Renomear, Excluir nem Reativar', async () => {
    sessao.permissao = permissaoCom({ novo: true });
    await montar();
    const dialogo = await abrirGerenciar();
    expect(within(dialogo).getByTestId('gerenciar-novo')).toBeTruthy();
    expect(within(dialogo).queryByRole('button', { name: /^(Renomear|Excluir|Reativar) / })).toBeNull();
  });

  it('editar sem inativar: Renomear e Excluir, sem Reativar', async () => {
    sessao.permissao = permissaoCom({ editar: true });
    await montar();
    const dialogo = await abrirGerenciar();
    expect(within(dialogo).getByRole('button', { name: 'Renomear Curral' })).toBeTruthy();
    expect(within(dialogo).getByRole('button', { name: 'Excluir Curral' })).toBeTruthy();
    expect(within(dialogo).queryByRole('button', { name: /^Reativar / })).toBeNull();
  });

  it('só visualizar: só a lista, sem "+ Novo tipo" nem ações', async () => {
    sessao.permissao = permissaoCom({});
    await montar();
    const dialogo = await abrirGerenciar();
    expect(within(dialogo).queryByTestId('gerenciar-novo')).toBeNull();
    expect(within(dialogo).queryByRole('button', { name: /^(Renomear|Excluir|Reativar) / })).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(mutacoes()).toEqual([]);
  });
});

describe('Gerenciar tipos — celular (folha das escolhas dentro do diálogo)', () => {
  /** @type {any} */
  let matchMediaOriginal;
  beforeEach(() => {
    matchMediaOriginal = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((q) => ({
      matches: /max-width:\s*639px/.test(q),
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
  });
  afterEach(() => {
    window.matchMedia = matchMediaOriginal;
  });
  /** Toque real: pointerdown, pointerup e click em tarefas separadas. @param {Element} el */
  const tocar = async (el) => {
    await act(async () => {
      fireEvent.pointerDown(el);
    });
    await act(async () => {
      fireEvent.pointerUp(el);
    });
    await act(async () => {
      fireEvent.click(el);
    });
  };
  /** A camada (Radix) mais próxima com `pointer-events` explícito não pode desligar o toque. @param {Element|null} el */
  const peHerdado = (el) => {
    for (let n = /** @type {any} */ (el); n; n = n.parentElement) {
      if (n.style?.pointerEvents) return n.style.pointerEvents;
    }
    return '';
  };

  /** No celular a lista é de cartões (sem a célula `bem-nome-*`): espera o bem e abre "⋯ › Gerenciar tipos". */
  const abrirGerenciarNoCelular = async () => {
    await screen.findAllByText(/Trator TP-02/i);
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }));
    fireEvent.click(await screen.findByText('Gerenciar tipos'));
    const dialogo = await screen.findByTestId('gerenciar-tipos');
    await within(dialogo).findByTestId('gerenciar-lista-tipos');
    return dialogo;
  };

  it('o filtro "Tipo de bem" abre a folha DENTRO do diálogo, com toque; tocar na opção filtra; Escape fecha só a folha', async () => {
    await montar();
    const dialogo = await abrirGerenciarNoCelular();
    await tocar(within(dialogo).getByRole('combobox', { name: 'Filtrar por tipo de bem' }));
    const opcao = await screen.findByRole('option', { name: 'Máquina', hidden: true });
    const folha = opcao.closest('.mk-sheet-root');
    expect(folha).toBeTruthy();
    expect(dialogo.contains(folha)).toBe(true);
    expect(opcao.closest('[aria-hidden="true"]')).toBeNull();
    expect(peHerdado(opcao)).not.toBe('none');
    await tocar(opcao);
    await waitFor(() => expect(listagens().at(-1).query).toMatchObject({ natureza: 'MAQUINA' }));
    await waitFor(() => expect(within(dialogo).queryByTestId('gerenciar-tipos-t1')).toBeNull());

    await tocar(within(dialogo).getByRole('combobox', { name: 'Filtrar por tipo de bem' }));
    await screen.findByRole('option', { name: 'Veículo', hidden: true });
    await act(async () => {
      fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Veículo', hidden: true })).toBeNull());
    expect(dialogo.isConnected).toBe(true);
    expect(screen.getByTestId('gerenciar-tipos')).toBeTruthy();
  });

  it('"+ Novo tipo": o "Tipo de bem" do formulário também abre a folha dentro do diálogo', async () => {
    await montar();
    const dialogo = await abrirGerenciarNoCelular();
    fireEvent.click(within(dialogo).getByTestId('gerenciar-novo'));
    const form = within(dialogo).getByTestId('gerenciar-form');
    await tocar(within(form).getByRole('combobox', { name: 'Tipo de bem' }));
    const opcao = await screen.findByRole('option', { name: 'Equipamento', hidden: true });
    expect(dialogo.contains(opcao.closest('.mk-sheet-root'))).toBe(true);
    expect(peHerdado(opcao)).not.toBe('none');
    await tocar(opcao);
    await waitFor(() => expect(within(form).getByRole('combobox', { name: 'Tipo de bem' })).toHaveTextContent('Equipamento'));
  });
});
