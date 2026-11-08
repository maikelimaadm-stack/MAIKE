/**
 * D-PROD-154 — Central Única de Lançamentos montada de verdade (página, motor
 * Base1, service, API, porta e nativeHttpClient reais). Mocks só da borda:
 * `fetch` (backend FALSO do contrato, tests/smoke/fixtures/lancamentosFakeCore.js)
 * e a sessão (usuário/permissão efetiva, tenant do JWT).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { API_FAKE, instalarBackendFake } from './fixtures/gestaoBackendFake.js';
import { criarEstadoLancamentos, rotearLancamentos, semearDocumento } from './fixtures/lancamentosFakeCore.js';

const sessao = vi.hoisted(() => ({ permissao: /** @type {any} */ (null), clienteId: 'cli-1' }));

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ clienteId: sessao.clienteId, user: { id: 'u1' } }) }));
vi.mock('@/services/sessionService', async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentUser: vi.fn(async () => ({ login: 'operador', cliente_id: sessao.clienteId })),
  carregarPermissaoEfetiva: vi.fn(async () => sessao.permissao),
}));

const TODAS = { novo: true, salvar: true, editar: true, confirmar: true, liquidar: true, estornar_liquidacao: true, cancelar: true };
const permissaoCom = (acoes) => ({
  user_email: 'operador',
  modulos_permitidos: ['gestao-rural'],
  permissoes_telas: [
    { tela_id: 'ges-lancamentos-financeiros', visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes },
  ],
});

const corpoBase = (extra = {}) => ({
  empresa_id: 'emp-1',
  direcao: 'PAGAR',
  conteudo: 'SEM_PRODUTOS',
  condicao: 'AVISTA',
  parceiro_id: 'pa1',
  data_emissao: '2026-11-08',
  valor_bruto: '1000.00',
  rateio_modo: 'VALOR',
  rateios: [{ natureza_id: 'nd1', valor: '1000.00' }],
  parcelas: [{ vencimento: '2026-11-08', valor: '1000.00' }],
  ...extra,
});

let estado;
let backend;

const empresaSelecionada = (id) => {
  window.localStorage.setItem('empresa_selecionada_id', id);
  window.localStorage.setItem('empresa_selecionada_cliente_id', sessao.clienteId);
};

const montar = async () => {
  const { default: LancamentosFinanceiros } = await import('@/pages/LancamentosFinanceiros');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <LancamentosFinanceiros />
    </QueryClientProvider>,
  );
};

const chamadas = (method, re) => backend.chamadas.filter((c) => c.method === method && (typeof re === 'string' ? c.path === re : re.test(c.path)));
const clicar = async (el) => {
  await act(async () => {
    fireEvent.click(el);
  });
};
const digitar = (testId, valor, escopo = screen) => fireEvent.change(escopo.getByTestId(testId), { target: { value: valor } });
const radio = (nome, escopo = screen) => clicar(escopo.getByRole('radio', { name: nome }));
const escolher = async (testId, rotulo) => {
  await clicar(screen.getByTestId(testId));
  const painel = await screen.findByTestId(`${testId}-painel`);
  const opcao = await within(painel).findByRole('option', { name: rotulo });
  await clicar(opcao);
};
const novo = async () => {
  await clicar(await screen.findByRole('button', { name: 'Novo' }));
  await screen.findByTestId('b1-form');
};
const salvar = () => clicar(screen.getByRole('button', { name: 'Salvar' }));
const abrir = async (id) => {
  fireEvent.doubleClick(await screen.findByTestId(`lancamento-numero-${id}`));
  await waitFor(() => expect(screen.queryByTestId('carregando-lancamento')).toBeNull());
};
const bodyUnico = (method, re) => {
  const lista = chamadas(method, re);
  expect(lista).toHaveLength(1);
  return lista[0].body;
};

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-08T15:00:00.000Z'));
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  window.localStorage.clear();
  window.sessionStorage.clear();
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  sessao.permissao = permissaoCom(TODAS);
  empresaSelecionada('emp-1');
  estado = criarEstadoLancamentos();
  backend = instalarBackendFake(async (req) => {
    if (req.path.startsWith('/operacoes-financeiras') && req.query.get('empresa_id') && req.query.get('empresa_id') !== 'emp-1' && req.method === 'GET') {
      return { status: 200, body: req.path === '/operacoes-financeiras' ? { items: [], next_cursor: null, has_more: false, total: 0, limit: 50 } : { itens: [], has_more: false, next_cursor: null } };
    }
    const r = await rotearLancamentos(estado, req);
    if (r && r.rede) throw new TypeError('Failed to fetch');
    return r;
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('LANC-1 — lista, filtros, perfil e fuso', () => {
  it('lista mostra nº, situação, parceiro e total formatado no locale do perfil; filtros vão ao servidor', async () => {
    const doc = semearDocumento(estado, corpoBase(), { confirmar: true });
    await montar();
    const celula = await screen.findByTestId(`lancamento-numero-${doc.id}`);
    const linha = within(celula.closest('tr'));
    expect(linha.getByText('AGROPECUÁRIA BOA VISTA')).toBeTruthy();
    expect(linha.getByText('Confirmado')).toBeTruthy();
    expect(linha.getAllByText(/R\$\s1\.000,00/).length).toBeGreaterThan(0);
    const { escolherOpcao } = await import('./fixtures/gestaoBackendFake.js');
    await escolherOpcao(screen.getByRole('combobox', { name: 'Filtrar por direção' }), 'A receber');
    await waitFor(() => expect(chamadas('GET', '/operacoes-financeiras').some((c) => c.query.direcao === 'RECEBER')).toBe(true));
    await escolherOpcao(screen.getByRole('combobox', { name: 'Filtrar por situação' }), 'Rascunhos');
    await waitFor(() => expect(chamadas('GET', '/operacoes-financeiras').some((c) => c.query.status === 'RASCUNHO' && c.query.direcao === 'RECEBER')).toBe(true));
    expect(chamadas('GET', '/operacoes-financeiras').every((c) => c.query.empresa_id === 'emp-1' && Number(c.query.limit) <= 100)).toBe(true);
  });

  it('onboarding: sem perfil, o administrador vê os padrões EXPLICADOS e "Confirmar perfil" grava BR/BRL/pt-BR', async () => {
    estado.perfil = null;
    sessao.permissao = { user_email: 'operador', is_admin: true };
    await montar();
    const painel = await screen.findByTestId('perfil-financeiro-painel');
    expect(painel).toHaveTextContent(/Brasil, Real \(BRL\) e português do Brasil/);
    expect(screen.queryByRole('button', { name: 'Novo' })).toBeNull();
    await clicar(within(painel).getByTestId('botao-confirmar-perfil'));
    await waitFor(() => expect(chamadas('PUT', '/perfis-financeiros-empresa')).toHaveLength(1));
    expect(chamadas('PUT', '/perfis-financeiros-empresa')[0].body).toEqual({ empresa_id: 'emp-1', pais: 'BR', moeda: 'BRL', locale: 'pt-BR' });
    expect(await screen.findByRole('button', { name: 'Novo' })).toBeTruthy();
    expect(screen.queryByTestId('perfil-financeiro-painel')).toBeNull();
  });

  it('onboarding: quem não é administrador vê o aviso e não grava perfil', async () => {
    estado.perfil = null;
    await montar();
    expect(await screen.findByTestId('perfil-financeiro-aviso')).toHaveTextContent(/administrador/);
    expect(screen.queryByTestId('botao-confirmar-perfil')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Novo' })).toBeNull();
  });

  it('sem fuso da empresa: aviso apontando a configuração da Empresa', async () => {
    estado.fuso = null;
    await montar();
    expect(await screen.findByTestId('gestao-sem-fuso')).toHaveTextContent(/Administração › Empresa/);
  });

  it('troca de empresa fecha o registro e relê a lista com a empresa nova', async () => {
    const doc = semearDocumento(estado, corpoBase(), { confirmar: true });
    await montar();
    await abrir(doc.id);
    expect(await screen.findByTestId('consulta-lancamento')).toBeTruthy();
    const { persistirEmpresaSelecionada } = await import('@/hooks/useEmpresaSelecionadaId');
    act(() => persistirEmpresaSelecionada('emp-2', 'cli-1'));
    await waitFor(() => expect(screen.queryByTestId('consulta-lancamento')).toBeNull());
    await waitFor(() => expect(chamadas('GET', '/operacoes-financeiras').some((c) => c.query.empresa_id === 'emp-2')).toBe(true));
  });
});

describe('LANC-2 — as quatro combinações geram o DOC canônico (string, sem float)', () => {
  it('A PAGAR · sem produtos · à vista: valor localizado vira "1234.56"; rateio 100% automático; parcela na emissão', async () => {
    await montar();
    await novo();
    await escolher('seletor-parceiro', /AGROPECUÁRIA BOA VISTA/);
    digitar('valor-bruto', '1.234,56');
    await escolher('seletor-natureza-0', /INSUMOS \/ NUTRIÇÃO/);
    expect(screen.getByTestId('rateio-diferenca')).toHaveTextContent(/100% do total automático/);
    expect(screen.getByTestId('total-lancamento')).toHaveTextContent(/R\$\s1\.234,56/);
    await salvar();
    await waitFor(() => expect(chamadas('POST', '/operacoes-financeiras')).toHaveLength(1));
    const corpo = bodyUnico('POST', '/operacoes-financeiras');
    expect(corpo).toEqual({
      empresa_id: 'emp-1',
      operation_id: expect.stringMatching(/^lanc-[A-Za-z0-9_.:-]{8,}$/),
      direcao: 'PAGAR',
      conteudo: 'SEM_PRODUTOS',
      condicao: 'AVISTA',
      parceiro_id: 'pa1',
      data_emissao: '2026-11-08',
      valor_bruto: '1234.56',
      rateio_modo: 'VALOR',
      rateios: [{ natureza_id: 'nd1', valor: '1234.56' }],
      parcelas: [{ vencimento: '2026-11-08', valor: '1234.56' }],
    });
    // Rascunho salvo: volta em leitura, com o nº reservado e o botão de confirmar.
    expect(await screen.findByTestId('botao-confirmar-lancamento')).toBeTruthy();
  });

  it('A RECEBER · sem produtos · a prazo: parceiro só cliente, natureza de RECEITA, 1 vencimento escolhido', async () => {
    await montar();
    await novo();
    await radio('A receber');
    await clicar(screen.getByTestId('seletor-parceiro'));
    const painel = await screen.findByTestId('seletor-parceiro-painel');
    await within(painel).findByRole('option', { name: /FRIGORÍFICO CENTRAL/ });
    expect(within(painel).queryByRole('option', { name: /AGROPECUÁRIA/ })).toBeNull();
    await clicar(within(painel).getByRole('option', { name: /FRIGORÍFICO CENTRAL/ }));
    await radio('A prazo');
    fireEvent.change(screen.getByTestId('prazo-vencimento'), { target: { value: '2026-12-15' } });
    digitar('valor-bruto', '5000');
    await escolher('seletor-natureza-0', /VENDA DE GADO/);
    await salvar();
    await waitFor(() => expect(chamadas('POST', '/operacoes-financeiras')).toHaveLength(1));
    expect(chamadas('GET', /-opcoes\/parceiros$/).some((c) => c.query.direcao === 'RECEBER')).toBe(true);
    const naturezas = chamadas('GET', /-opcoes\/naturezas$/);
    expect(naturezas.length).toBeGreaterThan(0);
    expect(naturezas.every((c) => c.query.tipo === 'RECEITA' && c.query.empresa_id === 'emp-1')).toBe(true);
    expect(bodyUnico('POST', '/operacoes-financeiras')).toMatchObject({
      direcao: 'RECEBER',
      condicao: 'PRAZO',
      parceiro_id: 'pa2',
      valor_bruto: '5000.00',
      rateios: [{ natureza_id: 'nr2', valor: '5000.00' }],
      parcelas: [{ vencimento: '2026-12-15', valor: '5000.00' }],
    });
  });

  it('A PAGAR · com produtos (compra em SACO) · parcelado: kg convertido, declaração física e gerador com resto na ÚLTIMA', async () => {
    await montar();
    await novo();
    await escolher('seletor-parceiro', /AGROPECUÁRIA BOA VISTA/);
    await radio('Com produtos');
    const item = within(screen.getByTestId('item-0'));
    await escolher('seletor-produto-0', /SAL MINERAL 80/);
    await escolher('seletor-local-0', /DEPÓSITO SEDE/);
    const { escolherOpcao } = await import('./fixtures/gestaoBackendFake.js');
    await escolherOpcao(item.getByRole('combobox', { name: 'Unidade do item 1' }), 'SACO');
    digitar('item-0-quantidade', '4');
    digitar('item-0-valor-unitario', '250');
    expect(screen.getByTestId('item-0-subtotal')).toHaveTextContent(/R\$\s1\.000,00/);
    expect(screen.getByTestId('item-0-kg')).toHaveTextContent(/100 kg/);
    fireEvent.change(screen.getByTestId('data-operacional'), { target: { value: '2026-11-07' } });
    await clicar(screen.getByTestId('declaracao-efeito-fisico'));
    await escolher('seletor-natureza-0', /INSUMOS \/ NUTRIÇÃO/);
    await radio('Parcelado');
    const gerador = within(screen.getByTestId('gerador-parcelas'));
    fireEvent.change(gerador.getByLabelText(/Nº de parcelas/), { target: { value: '3' } });
    await clicar(gerador.getByRole('button', { name: 'Gerar parcelas' }));
    expect(screen.getByTestId('parcela-2-valor')).toHaveValue('333,34');
    expect(screen.getByTestId('parcela-0-valor')).toHaveValue('333,33');
    expect(screen.getByTestId('parcelas-diferenca')).toHaveAttribute('data-estado', 'fechado');
    await salvar();
    await waitFor(() => expect(chamadas('POST', '/operacoes-financeiras')).toHaveLength(1));
    expect(bodyUnico('POST', '/operacoes-financeiras')).toMatchObject({
      conteudo: 'COM_PRODUTOS',
      condicao: 'PARCELADO',
      data_operacional: '2026-11-07',
      efeito_fisico_confirmado: true,
      itens: [{ tipo_item: 'MERCADORIA', produto_id: 'pr1', local_estoque_id: 'lo1', unidade: 'SACO', quantidade: '4', valor_unitario: '250' }],
      parcelas: [
        { vencimento: '2026-12-08', valor: '333.33' },
        { vencimento: '2027-01-07', valor: '333.33' },
        { vencimento: '2027-02-06', valor: '333.34' },
      ],
    });
    expect(bodyUnico('POST', '/operacoes-financeiras')).not.toHaveProperty('valor_bruto');
  });

  it('A RECEBER · com produtos (venda): saldo da EMPRESA por local, serviço sem estoque, total com desconto', async () => {
    await montar();
    await novo();
    await radio('A receber');
    await escolher('seletor-parceiro', /FRIGORÍFICO CENTRAL/);
    await radio('Com produtos');
    await escolher('seletor-produto-0', /MILHO MOÍDO/);
    const saldos = await screen.findByTestId('saldos-item-0');
    await waitFor(() => expect(saldos).toHaveTextContent(/GALPÃO RETIRO: 1\.200 kg/));
    await clicar(within(saldos).getByRole('button', { name: /GALPÃO RETIRO/ }));
    digitar('item-0-quantidade', '1.300');
    digitar('item-0-valor-unitario', '1,5');
    expect(screen.getByTestId('item-0-kg')).toHaveTextContent(/acima do saldo deste local/);
    digitar('item-0-quantidade', '100');
    await clicar(screen.getByRole('button', { name: /Serviço/ }));
    const servico = within(screen.getByTestId('item-1'));
    fireEvent.change(servico.getByLabelText(/Descrição do serviço/), { target: { value: 'Frete' } });
    digitar('item-1-quantidade', '1');
    digitar('item-1-valor-unitario', '30');
    digitar('valor-desconto', '10');
    expect(screen.getByTestId('total-lancamento')).toHaveTextContent(/R\$\s170,00/);
    fireEvent.change(screen.getByTestId('data-operacional'), { target: { value: '2026-11-08' } });
    await clicar(screen.getByTestId('declaracao-efeito-fisico'));
    await escolher('seletor-natureza-0', /VENDA DE INSUMOS/);
    await salvar();
    await waitFor(() => expect(chamadas('POST', '/operacoes-financeiras')).toHaveLength(1));
    const saldosLidos = chamadas('GET', /-opcoes\/saldos$/);
    expect(saldosLidos.length).toBeGreaterThan(0);
    expect(saldosLidos.every((c) => c.query.empresa_id === 'emp-1' && c.query.produto_id === 'pr2')).toBe(true);
    expect(bodyUnico('POST', '/operacoes-financeiras')).toMatchObject({
      direcao: 'RECEBER',
      valor_desconto: '10.00',
      itens: [
        { tipo_item: 'MERCADORIA', produto_id: 'pr2', local_estoque_id: 'lo2', unidade: 'KG', quantidade: '100', valor_unitario: '1.5' },
        { tipo_item: 'SERVICO', unidade: 'UN', descricao: 'Frete', quantidade: '1', valor_unitario: '30' },
      ],
      rateios: [{ natureza_id: 'nr1', valor: '170.00' }],
      parcelas: [{ vencimento: '2026-11-08', valor: '170.00' }],
    });
  });

  it('trocar para "sem produtos" com itens pede confirmação e nunca perde itens em silêncio', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await montar();
    await novo();
    await radio('Com produtos');
    expect(screen.getByTestId('item-0')).toBeTruthy();
    await radio('Sem produtos');
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('item-0')).toBeTruthy();
    confirmar.mockReturnValue(true);
    await radio('Sem produtos');
    await waitFor(() => expect(screen.queryByTestId('item-0')).toBeNull());
  });
});

describe('LANC-2b — seletor paginado e rascunho com resposta perdida', () => {
  it('seletor paginado: busca no servidor com espera, "Carregar mais" segue o cursor, falha parcial + "Tentar novamente" no MESMO cursor', async () => {
    estado.parceirosExtras = Array.from({ length: 120 }, (_, i) => ({ id: `px${i}`, numero: 1000 + i, nome: `FORNECEDOR ${String(i).padStart(3, '0')}`, papeis: ['fornecedor'] }));
    await montar();
    await novo();
    await clicar(screen.getByTestId('seletor-parceiro'));
    const painel = await screen.findByTestId('seletor-parceiro-painel');
    await within(painel).findByRole('option', { name: /AGROPECUÁRIA BOA VISTA/ });
    expect(within(painel).getAllByRole('option')).toHaveLength(50);
    estado.falhas['opcoes:parceiros'] = { umaVez: true, soComCursor: true, resposta: { status: 500, body: { code: 'INTERNAL_ERROR', message: 'x', request_id: 'r' } } };
    await clicar(within(painel).getByRole('button', { name: 'Carregar mais' }));
    expect(await within(painel).findByRole('alert')).toHaveTextContent(/Lista incompleta/);
    expect(within(painel).getAllByRole('option')).toHaveLength(50);
    await clicar(within(painel).getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(within(painel).getAllByRole('option')).toHaveLength(100));
    const cursores = chamadas('GET', /-opcoes\/parceiros$/).map((c) => c.query.cursor ?? null);
    expect(cursores.filter((c) => c === '50')).toHaveLength(2);
    fireEvent.change(within(painel).getByRole('searchbox'), { target: { value: 'fornecedor 119' } });
    await waitFor(() => expect(chamadas('GET', /-opcoes\/parceiros$/).some((c) => c.query.q === 'fornecedor 119')).toBe(true), { timeout: 2000 });
    await clicar(await within(painel).findByRole('option', { name: /FORNECEDOR 119/ }));
    expect(screen.getByTestId('seletor-parceiro')).toHaveTextContent('FORNECEDOR 119');
  });

  it('POST do rascunho sem resposta: aviso de resultado incerto e o reenvio usa o MESMO operation_id (um rascunho só)', async () => {
    estado.falhas.criar = { gravarAntes: true, umaVez: true };
    await montar();
    await novo();
    await escolher('seletor-parceiro', /AGROPECUÁRIA BOA VISTA/);
    digitar('valor-bruto', '75');
    await escolher('seletor-natureza-0', /ENERGIA/);
    await salvar();
    expect(await screen.findByText(/pode ter sido gravado/)).toBeTruthy();
    await salvar();
    await waitFor(() => expect(chamadas('POST', '/operacoes-financeiras')).toHaveLength(2));
    const [a, b] = chamadas('POST', '/operacoes-financeiras');
    expect(b.body.operation_id).toBe(a.body.operation_id);
    expect(estado.documentos).toHaveLength(1);
    expect(await screen.findByTestId('botao-confirmar-lancamento')).toBeTruthy();
  });

  it('POST repetido depois do descarte do rascunho: 409 IDEMPOTENCY_EFEITO_EXCLUIDO é definitivo — a pendência sai e o envio seguinte usa chave NOVA', async () => {
    const { enviarComPendencia, lerPendenciaLancamento } = await import('@/services/operacaoFinanceiraService');
    const dados = new Map();
    const storage = /** @type {any} */ ({ getItem: (k) => dados.get(k) ?? null, setItem: (k, v) => dados.set(k, String(v)), removeItem: (k) => dados.delete(k) });
    const base = { escopo: 't', acao: 'criar', empresaId: 'e1', alvo: 'novo', conteudo: { valor: '75.00' }, storage };
    const chaves = [];
    const falhar = (erro) => async (k) => {
      chaves.push(k);
      throw erro;
    };
    await expect(enviarComPendencia({ ...base, enviar: falhar(new Error('sem resposta')) })).rejects.toThrow('sem resposta');
    expect(lerPendenciaLancamento('t', 'criar', 'e1', 'novo', storage)?.operation_id).toBe(chaves[0]);
    const excluido = Object.assign(new Error('excluído'), { cause: { code: 'IDEMPOTENCY_EFEITO_EXCLUIDO' } });
    await expect(enviarComPendencia({ ...base, enviar: falhar(excluido) })).rejects.toBe(excluido);
    expect(chaves[1]).toBe(chaves[0]);
    expect(lerPendenciaLancamento('t', 'criar', 'e1', 'novo', storage)).toBeNull();
    const r = await enviarComPendencia({ ...base, enviar: async (k) => { chaves.push(k); return { id: 'doc-novo' }; } });
    expect(r).toEqual({ id: 'doc-novo' });
    expect(chaves[2]).not.toBe(chaves[0]);
  });
});

describe('LANC-3 — rateio ao centavo e percentual', () => {
  it('VALOR: diferença de R$ 0,01 aparece em tempo real e bloqueia; PERCENTUAL mostra o que falta para 100%', async () => {
    await montar();
    await novo();
    await escolher('seletor-parceiro', /AGROPECUÁRIA BOA VISTA/);
    digitar('valor-bruto', '1.000,00');
    await escolher('seletor-natureza-0', /NUTRIÇÃO/);
    await clicar(screen.getByRole('button', { name: /Linha de rateio/ }));
    await escolher('seletor-natureza-1', /SANIDADE/);
    digitar('rateio-0-valor', '600,00');
    digitar('rateio-1-valor', '399,99');
    expect(screen.getByTestId('rateio-diferenca')).toHaveTextContent(/Falta R\$\s0,01/);
    expect(screen.getByTestId('rateio-diferenca')).toHaveAttribute('data-estado', 'falta');
    await salvar();
    expect(chamadas('POST', '/operacoes-financeiras')).toHaveLength(0);
    digitar('rateio-1-valor', '400,01');
    expect(screen.getByTestId('rateio-diferenca')).toHaveTextContent(/Sobra R\$\s0,01/);
    digitar('rateio-1-valor', '400,00');
    expect(screen.getByTestId('rateio-diferenca')).toHaveAttribute('data-estado', 'fechado');
    await radio('Por percentual');
    digitar('rateio-0-percentual', '60');
    digitar('rateio-1-percentual', '30');
    expect(screen.getByTestId('rateio-diferenca')).toHaveTextContent(/Falta 10% para 100%/);
    digitar('rateio-1-percentual', '40');
    expect(screen.getByTestId('rateio-1-valor-calculado')).toHaveTextContent(/R\$\s400,00/);
    await salvar();
    await waitFor(() => expect(chamadas('POST', '/operacoes-financeiras')).toHaveLength(1));
    expect(bodyUnico('POST', '/operacoes-financeiras')).toMatchObject({
      rateio_modo: 'PERCENTUAL',
      rateios: [
        { natureza_id: 'nd1', percentual: '60' },
        { natureza_id: 'nd2', percentual: '40' },
      ],
    });
    expect(bodyUnico('POST', '/operacoes-financeiras').rateios[0]).not.toHaveProperty('valor');
  });
});

describe('LANC-4 — prévia, confirmação, duplo clique e retentativa', () => {
  it('rascunho salvo sem alteração: Confirmar NÃO regrava (sem PUT), mostra a prévia e confirma com operation_id + versao', async () => {
    const doc = semearDocumento(estado, corpoBase());
    await montar();
    await abrir(doc.id);
    await clicar(await screen.findByTestId('botao-confirmar-lancamento'));
    const dialogo = await screen.findByTestId('dialogo-confirmacao');
    expect(dialogo).toHaveAttribute('data-permissao-explicita');
    expect(within(dialogo).getByTestId('previa-resumo')).toHaveTextContent(
      /Isto criará 1 parcela, movimentará 0 itens no estoque e registrará R\$\s1\.000,00 em títulos a pagar/,
    );
    expect(chamadas('PUT', /^\/operacoes-financeiras\//)).toHaveLength(0);
    await clicar(within(dialogo).getByTestId('botao-confirmar-definitivo'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-confirmacao')).toBeNull());
    const corpo = bodyUnico('POST', /\/confirmar$/);
    expect(corpo).toEqual({ empresa_id: 'emp-1', operation_id: expect.stringMatching(/^lanc-/), versao: 1 });
    expect(await screen.findByTestId('status-lancamento')).toHaveTextContent('Confirmado');
    expect(screen.getByTestId('titulo-1-status')).toHaveTextContent('Aberto');
  });

  it('com bloqueios na prévia o botão fica desabilitado e a mensagem aparece', async () => {
    const doc = semearDocumento(estado, corpoBase());
    // Formato REAL do backend (prova ponta a ponta): field/reason no topo e em details.
    const det = { field: 'quantidade', colecao: 'itens', indice: 0, item_ordem: 1, produto_id: 'pr2', local_estoque_id: 'lo2' };
    estado.bloqueiosPrevia = [
      { code: 'ESTOQUE_SALDO_INSUFICIENTE', field: 'quantidade', reason: 'saldo_lote_insuficiente', details: { ...det, reason: 'saldo_lote_insuficiente', disponivel: '20.0000', solicitado: '50.0000' } },
      { code: 'ESTOQUE_SALDO_INSUFICIENTE', field: 'quantidade', reason: 'estoque_atual_insuficiente', details: { ...det, reason: 'estoque_atual_insuficiente', estoque_atual: '20.0000', solicitado: '50.0000' } },
    ];
    await montar();
    await abrir(doc.id);
    await clicar(await screen.findByTestId('botao-confirmar-lancamento'));
    const dialogo = await screen.findByTestId('dialogo-confirmacao');
    const bloqueios = within(dialogo).getByTestId('previa-bloqueios');
    expect(bloqueios).toHaveTextContent(/disponível 20 kg, pedido 50 kg/);
    expect(bloqueios).toHaveTextContent(/atual 20 kg, pedido 50 kg/);
    // O rascunho ESTÁ salvo: a prévia não pode dizer que "nada foi gravado".
    expect(bloqueios).not.toHaveTextContent(/Nada foi gravado/);
    expect(within(dialogo).getByTestId('botao-confirmar-definitivo')).toBeDisabled();
  });

  it('duplo clique em Confirmar = 1 envio', async () => {
    const doc = semearDocumento(estado, corpoBase());
    let soltar;
    estado.segurarConfirmar = new Promise((r) => { soltar = r; });
    await montar();
    await abrir(doc.id);
    await clicar(await screen.findByTestId('botao-confirmar-lancamento'));
    const botao = within(await screen.findByTestId('dialogo-confirmacao')).getByTestId('botao-confirmar-definitivo');
    await act(async () => {
      fireEvent.click(botao);
      fireEvent.click(botao);
      fireEvent.click(botao);
    });
    await waitFor(() => expect(chamadas('POST', /\/confirmar$/)).toHaveLength(1));
    expect(botao).toBeDisabled();
    await act(async () => soltar());
    await waitFor(() => expect(screen.queryByTestId('dialogo-confirmacao')).toBeNull());
    expect(chamadas('POST', /\/confirmar$/)).toHaveLength(1);
  });

  it('sem resposta depois de gravar: "resultado incerto" (nunca sucesso) e a retentativa reaproveita o MESMO operation_id (replay)', async () => {
    const doc = semearDocumento(estado, corpoBase());
    estado.falhas.confirmar = { gravarAntes: true, umaVez: true };
    await montar();
    await abrir(doc.id);
    await clicar(await screen.findByTestId('botao-confirmar-lancamento'));
    const dialogo = await screen.findByTestId('dialogo-confirmacao');
    await clicar(within(dialogo).getByTestId('botao-confirmar-definitivo'));
    expect(await within(dialogo).findByTestId('resultado-incerto')).toHaveTextContent(/Resultado incerto/);
    expect(screen.queryByText('Lançamento confirmado')).toBeNull();
    await clicar(within(dialogo).getByRole('button', { name: 'Repetir o mesmo envio' }));
    await waitFor(() => expect(screen.queryByTestId('dialogo-confirmacao')).toBeNull());
    const envios = chamadas('POST', /\/confirmar$/);
    expect(envios).toHaveLength(2);
    expect(envios[1].body.operation_id).toBe(envios[0].body.operation_id);
    expect(estado.documentos[0].historico.filter((h) => h.acao === 'operacao_financeira.confirmar')).toHaveLength(1);
    expect(await screen.findByText(/envio repetido: nada foi duplicado/)).toBeTruthy();
  });

  it('"Consultar lançamento" no resultado incerto relê o documento e mostra o estado real', async () => {
    const doc = semearDocumento(estado, corpoBase());
    estado.falhas.confirmar = { gravarAntes: true, umaVez: true };
    await montar();
    await abrir(doc.id);
    await clicar(await screen.findByTestId('botao-confirmar-lancamento'));
    const dialogo = await screen.findByTestId('dialogo-confirmacao');
    await clicar(within(dialogo).getByTestId('botao-confirmar-definitivo'));
    await clicar(await within(dialogo).findByTestId('botao-consultar-resultado'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-confirmacao')).toBeNull());
    expect(await screen.findByTestId('status-lancamento')).toHaveTextContent('Confirmado');
  });

  it('rascunho novo e Confirmar direto: POST do rascunho, prévia e confirmação (sem PUT)', async () => {
    await montar();
    await novo();
    await escolher('seletor-parceiro', /AGROPECUÁRIA BOA VISTA/);
    digitar('valor-bruto', '80');
    await escolher('seletor-natureza-0', /ENERGIA/);
    await clicar(screen.getByTestId('botao-confirmar-lancamento'));
    const dialogo = await screen.findByTestId('dialogo-confirmacao');
    expect(chamadas('POST', '/operacoes-financeiras')).toHaveLength(1);
    expect(chamadas('POST', /\/previa$/)).toHaveLength(1);
    expect(chamadas('PUT', /^\/operacoes-financeiras\//)).toHaveLength(0);
    await clicar(within(dialogo).getByTestId('botao-confirmar-definitivo'));
    expect(await screen.findByTestId('status-lancamento')).toHaveTextContent('Confirmado');
  });

  it('rascunho editado e Confirmar: PUT com versao ANTES da prévia (só porque mudou)', async () => {
    const doc = semearDocumento(estado, corpoBase());
    await montar();
    await abrir(doc.id);
    await clicar(screen.getByRole('button', { name: 'Editar' }));
    digitar('valor-bruto', '1.100,00');
    await clicar(screen.getByTestId('botao-confirmar-lancamento'));
    const dialogo = await screen.findByTestId('dialogo-confirmacao');
    expect(bodyUnico('PUT', `/operacoes-financeiras/${doc.id}`)).toMatchObject({ versao: 1, valor_bruto: '1100.00', parcelas: [{ valor: '1100.00' }] });
    const ordem = backend.chamadas.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path.split('/').pop()}`);
    expect(ordem).toEqual([`PUT ${doc.id}`, 'POST previa']);
    await clicar(within(dialogo).getByTestId('botao-confirmar-definitivo'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-confirmacao')).toBeNull());
    expect(bodyUnico('POST', /\/confirmar$/).versao).toBe(2);
  });
});

describe('LANC-5 — baixas, estorno e cancelamento', () => {
  const confirmado = () => semearDocumento(estado, corpoBase(), { confirmar: true });

  it('registrar pagamento parcial: valor ≤ saldo, data de hoje no fuso, forma do perfil; aviso sem conciliação', async () => {
    const doc = confirmado();
    await montar();
    await abrir(doc.id);
    expect(screen.getByTestId('aviso-sem-conciliacao')).toBeTruthy();
    await clicar(screen.getByTestId('botao-liquidar-1'));
    const dialogo = await screen.findByTestId('dialogo-liquidacao');
    expect(dialogo).toHaveAttribute('data-permissao-explicita');
    expect(within(dialogo).getByTestId('aviso-liquidacao-gerencial')).toHaveTextContent(/não há conciliação bancária/);
    expect(within(dialogo).getByTestId('liquidacao-valor')).toHaveValue('1.000,00');
    expect(within(dialogo).getByTestId('liquidacao-data')).toHaveValue('2026-11-08');
    fireEvent.change(within(dialogo).getByTestId('liquidacao-valor'), { target: { value: '1.000,01' } });
    expect(within(dialogo).getByText(/Maior que o saldo/)).toBeTruthy();
    expect(within(dialogo).getByTestId('botao-registrar-liquidacao')).toBeDisabled();
    fireEvent.change(within(dialogo).getByTestId('liquidacao-valor'), { target: { value: '400' } });
    await radio('Pix', within(dialogo));
    await clicar(within(dialogo).getByTestId('botao-registrar-liquidacao'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-liquidacao')).toBeNull());
    expect(bodyUnico('POST', /\/titulos-financeiros\/.+\/liquidacoes$/)).toEqual({
      empresa_id: 'emp-1',
      operation_id: expect.stringMatching(/^lanc-/),
      valor: '400.00',
      data: '2026-11-08',
      metodo: 'PIX',
    });
    expect(await screen.findByTestId('titulo-1-status')).toHaveTextContent('Parcial');
    expect(screen.getByTestId('titulo-1-saldo')).toHaveTextContent(/R\$\s600,00/);
  });

  it('liquidação sem resposta: a retentativa reaproveita o operation_id e não registra duas vezes', async () => {
    const doc = confirmado();
    estado.falhas.liquidar = { gravarAntes: true, umaVez: true };
    await montar();
    await abrir(doc.id);
    await clicar(screen.getByTestId('botao-liquidar-1'));
    const dialogo = await screen.findByTestId('dialogo-liquidacao');
    await clicar(within(dialogo).getByTestId('botao-registrar-liquidacao'));
    expect(await within(dialogo).findByTestId('resultado-incerto')).toBeTruthy();
    await clicar(within(dialogo).getByRole('button', { name: 'Repetir o mesmo envio' }));
    await waitFor(() => expect(screen.queryByTestId('dialogo-liquidacao')).toBeNull());
    const envios = chamadas('POST', /\/liquidacoes$/);
    expect(envios).toHaveLength(2);
    expect(envios[1].body.operation_id).toBe(envios[0].body.operation_id);
    expect(estado.documentos[0].titulos[0].liquidacoes).toHaveLength(1);
    expect(await screen.findByTestId('titulo-1-status')).toHaveTextContent('Quitado');
  });

  it('estornar baixa exige motivo; a baixa fica marcada como estornada e o saldo volta', async () => {
    const doc = confirmado();
    await montar();
    await abrir(doc.id);
    await clicar(screen.getByTestId('botao-liquidar-1'));
    await clicar(within(await screen.findByTestId('dialogo-liquidacao')).getByTestId('botao-registrar-liquidacao'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-liquidacao')).toBeNull());
    const liq = estado.documentos[0].titulos[0].liquidacoes[0];
    await clicar(await screen.findByTestId(`botao-estornar-${liq.id}`));
    const dialogo = await screen.findByTestId('dialogo-estorno');
    expect(within(dialogo).getByTestId('dialogo-estorno-enviar')).toBeDisabled();
    fireEvent.change(within(dialogo).getByTestId('dialogo-estorno-motivo'), { target: { value: 'Pagamento lançado em duplicidade' } });
    await clicar(within(dialogo).getByTestId('dialogo-estorno-enviar'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-estorno')).toBeNull());
    expect(bodyUnico('POST', /\/estorno$/)).toEqual({ empresa_id: 'emp-1', operation_id: expect.stringMatching(/^lanc-/), motivo: 'Pagamento lançado em duplicidade' });
    expect(await screen.findByTestId(`liquidacao-${liq.id}-estornada`)).toBeTruthy();
    expect(screen.getByTestId('titulo-1-status')).toHaveTextContent('Aberto');
  });

  it('linha ESTORNO do servidor (contrato real): aparece como estorno, sem "Estornar baixa" e sem contar como baixa ativa', async () => {
    // Achado da prova ponta a ponta com o backend REAL: o detalhe traz o
    // estorno como linha própria (`tipo: 'ESTORNO'`, `estornada: false`). A
    // tela a mostrava como uma baixa nova, com botão "Estornar baixa" (que
    // levaria a 404) e o cancelamento acusando "baixas registradas".
    const doc = confirmado();
    await montar();
    await abrir(doc.id);
    await clicar(screen.getByTestId('botao-liquidar-1'));
    await clicar(within(await screen.findByTestId('dialogo-liquidacao')).getByTestId('botao-registrar-liquidacao'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-liquidacao')).toBeNull());
    const liq = estado.documentos[0].titulos[0].liquidacoes[0];
    await clicar(await screen.findByTestId(`botao-estornar-${liq.id}`));
    const dialogo = await screen.findByTestId('dialogo-estorno');
    fireEvent.change(within(dialogo).getByTestId('dialogo-estorno-motivo'), { target: { value: 'Baixa no título errado' } });
    await clicar(within(dialogo).getByTestId('dialogo-estorno-enviar'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-estorno')).toBeNull());
    const linhaEstorno = estado.documentos[0].titulos[0].liquidacoes.find((l) => l.tipo === 'ESTORNO');
    expect(linhaEstorno).toBeTruthy();
    const linha = await screen.findByTestId(`liquidacao-${linhaEstorno.id}`);
    expect(linha).toHaveTextContent(/Estorno/);
    expect(linha).toHaveTextContent('Baixa no título errado');
    expect(screen.queryByTestId(`botao-estornar-${linhaEstorno.id}`)).toBeNull();
    expect(screen.getByTestId('botao-cancelar-lancamento')).not.toHaveAttribute('title');
    expect(screen.getByTestId('titulo-1-status')).toHaveTextContent('Aberto');
  });

  it('cancelar com baixa ativa: OPERACAO_COM_LIQUIDACOES aparece no diálogo (nada muda)', async () => {
    const doc = confirmado();
    await montar();
    await abrir(doc.id);
    await clicar(screen.getByTestId('botao-liquidar-1'));
    fireEvent.change(within(await screen.findByTestId('dialogo-liquidacao')).getByTestId('liquidacao-valor'), { target: { value: '10' } });
    await clicar(within(screen.getByTestId('dialogo-liquidacao')).getByTestId('botao-registrar-liquidacao'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-liquidacao')).toBeNull());
    await clicar(screen.getByTestId('botao-cancelar-lancamento'));
    const dialogo = await screen.findByTestId('dialogo-cancelamento');
    fireEvent.change(within(dialogo).getByTestId('dialogo-cancelamento-motivo'), { target: { value: 'Erro de digitação' } });
    await clicar(within(dialogo).getByTestId('dialogo-cancelamento-enviar'));
    expect(await within(dialogo).findByTestId('erro-envio')).toHaveTextContent(/Estorne as baixas antes de cancelar/);
    expect(estado.documentos[0].status).toBe('CONFIRMADO');
  });

  it('cancelar com mercadoria já consumida: ESTOQUE_JA_CONSUMIDO com a linha e as quantidades', async () => {
    const doc = confirmado();
    estado.falhas.cancelar = {
      resposta: { status: 409, body: { code: 'ESTOQUE_JA_CONSUMIDO', message: 'x', request_id: 'r', details: { item_ordem: 1, lote_id: 'l1', entrada: '50.0000', disponivel: '20.0000' } } },
    };
    await montar();
    await abrir(doc.id);
    await clicar(screen.getByTestId('botao-cancelar-lancamento'));
    const dialogo = await screen.findByTestId('dialogo-cancelamento');
    fireEvent.change(within(dialogo).getByTestId('dialogo-cancelamento-motivo'), { target: { value: 'Devolução' } });
    await clicar(within(dialogo).getByTestId('dialogo-cancelamento-enviar'));
    expect(await within(dialogo).findByTestId('erro-envio')).toHaveTextContent(/linha 1 dos itens.*já foi usada no estoque \(entrada 50 kg, disponível 20 kg\)/);
  });

  it('cancelar sem baixas: títulos cancelados e motivo registrado', async () => {
    const doc = confirmado();
    await montar();
    await abrir(doc.id);
    await clicar(screen.getByTestId('botao-cancelar-lancamento'));
    const dialogo = await screen.findByTestId('dialogo-cancelamento');
    fireEvent.change(within(dialogo).getByTestId('dialogo-cancelamento-motivo'), { target: { value: 'Compra desfeita' } });
    await clicar(within(dialogo).getByTestId('dialogo-cancelamento-enviar'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-cancelamento')).toBeNull());
    expect(bodyUnico('POST', /\/cancelar$/)).toEqual({ empresa_id: 'emp-1', operation_id: expect.stringMatching(/^lanc-/), motivo: 'Compra desfeita' });
    expect(await screen.findByTestId('status-lancamento')).toHaveTextContent('Cancelado');
    expect(screen.getByTestId('aviso-cancelado')).toHaveTextContent(/Compra desfeita/);
    expect(screen.getByTestId('titulo-1-status')).toHaveTextContent('Cancelado');
  });

  it('descartar rascunho: DELETE com empresa e versao; o registro fecha', async () => {
    const doc = semearDocumento(estado, corpoBase());
    await montar();
    await abrir(doc.id);
    await clicar(screen.getByTestId('botao-descartar-rascunho'));
    const dialogo = await screen.findByTestId('dialogo-descarte');
    await clicar(within(dialogo).getByTestId('dialogo-descarte-enviar'));
    await waitFor(() => expect(screen.queryByTestId('b1-form')).toBeNull());
    const del = chamadas('DELETE', `/operacoes-financeiras/${doc.id}`);
    expect(del).toHaveLength(1);
    expect(del[0].query).toEqual({ empresa_id: 'emp-1', versao: '1' });
    // Prova real: o detalhe do rascunho apagado era relido (GET → 404) logo
    // depois do DELETE. Nada pode pedir de novo um documento que não existe.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const posDelete = backend.chamadas.slice(backend.chamadas.indexOf(del[0]) + 1);
    expect(posDelete.filter((c) => c.method === 'GET' && c.path === `/operacoes-financeiras/${doc.id}`)).toHaveLength(0);
  });
});

describe('LANC-6 — botões seguem a ação exata da permissão', () => {
  it('só visualizar: lê o rascunho e a consulta, sem Novo/Editar/Confirmar/Descartar/baixas', async () => {
    sessao.permissao = permissaoCom({});
    const rascunho = semearDocumento(estado, corpoBase());
    await montar();
    await abrir(rascunho.id);
    expect(screen.queryByRole('button', { name: 'Novo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByTestId('botao-confirmar-lancamento')).toBeNull();
    expect(screen.queryByTestId('botao-descartar-rascunho')).toBeNull();
  });

  it('visualizar + liquidar: só "Registrar pagamento" no confirmado (sem cancelar/estornar)', async () => {
    sessao.permissao = permissaoCom({ liquidar: true });
    const doc = semearDocumento(estado, corpoBase(), { confirmar: true });
    await montar();
    await abrir(doc.id);
    expect(await screen.findByTestId('botao-liquidar-1')).toBeTruthy();
    expect(screen.queryByTestId('botao-cancelar-lancamento')).toBeNull();
  });

  it('visualizar + cancelar + estornar: cancelar aparece, registrar baixa não', async () => {
    sessao.permissao = permissaoCom({ cancelar: true, estornar_liquidacao: true });
    const doc = semearDocumento(estado, corpoBase(), { confirmar: true });
    await montar();
    await abrir(doc.id);
    expect(await screen.findByTestId('botao-cancelar-lancamento')).toBeTruthy();
    expect(screen.queryByTestId('botao-liquidar-1')).toBeNull();
  });

  it('confirmado nunca abre em edição (Editar some mesmo com permissão)', async () => {
    const doc = semearDocumento(estado, corpoBase(), { confirmar: true });
    await montar();
    await abrir(doc.id);
    expect(await screen.findByTestId('consulta-lancamento')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
  });

  it('erros novos têm mensagem própria (sem texto do servidor) e NOT_FOUND fecha o registro', async () => {
    const { mensagemErroGestao, ehNaoEncontradoGestao } = await import('@/lib/gestaoErros');
    const e = (code, extra = {}) => ({ cause: { code, ...extra } });
    expect(mensagemErroGestao(e('OPERACAO_RATEIO_INVALIDO', { reason: 'soma_diferente', details: { esperado: '100.00', informado: '99.99', diferenca: '0.01' } }), 'x', { locale: 'pt-BR', moeda: 'BRL', casas: 2 })).toMatch(
      /esperado R\$\s100,00, informado R\$\s99,99 \(diferença R\$\s0,01\)/,
    );
    expect(mensagemErroGestao(e('FINANCEIRO_DATA_FUTURA', { details: { data: '2026-11-09', hoje: '2026-11-08', fuso: 'America/Sao_Paulo' } }), 'x')).toMatch(/09\/11\/2026 é futura.*08\/11\/2026/);
    expect(mensagemErroGestao(e('IDEMPOTENCY_CONFLICT'), 'x')).not.toMatch(/áreas/);
    expect(mensagemErroGestao(e('IDEMPOTENCY_EFEITO_EXCLUIDO'), 'x')).toMatch(/já foi descartado.*Salve de novo/);
    expect(mensagemErroGestao(e('CONCURRENCY_CONFLICT'), 'x', { comandoIdempotente: true })).toMatch(/não será duplicado/);
    // Fora de comando idempotente (cadastros da P1/P2) não promete reenvio sem duplicar.
    expect(mensagemErroGestao(e('CONCURRENCY_CONFLICT'), 'x')).toMatch(/Recarregue e tente novamente/);
    expect(mensagemErroGestao(e('OPERACAO_REFERENCIA_INVALIDA', { field: 'parceiro_id', reason: 'parceiro_sem_papel' }), 'x')).toMatch(/papel exigido/);
    expect(mensagemErroGestao(e('LIQUIDACAO_EXCEDE_SALDO', { details: { saldo: '10.00', valor: '11.00' } }), 'x', { locale: 'pt-BR', moeda: 'BRL', casas: 2 })).toMatch(/R\$\s11,00.*R\$\s10,00/);
    expect(mensagemErroGestao(e('PERFIL_FINANCEIRO_MOEDA_EM_USO', { reason: 'estoque_legado_brl' }), 'x')).toMatch(/BRL/);
    expect(mensagemErroGestao(e('REQUEST_VALIDATION_FAILED', { field: 'valor', reason: 'casas_decimais_excedidas' }), 'x')).toMatch(/casas decimais/);
    for (const code of ['OPERACAO_FINANCEIRA_NOT_FOUND', 'TITULO_FINANCEIRO_NOT_FOUND', 'LIQUIDACAO_FINANCEIRA_NOT_FOUND']) expect(ehNaoEncontradoGestao(e(code))).toBe(true);
  });
});
