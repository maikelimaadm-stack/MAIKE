/**
 * D-PROD-305 — o lote no diálogo "Salvar correção" do lançamento confirmado (retificação por substituição), com a
 * Central Única de Lançamentos montada de verdade (página, motor Base1, service, API, porta e nativeHttpClient reais).
 * Mocks só da borda: `fetch` (backend FALSO de tests/smoke/fixtures/lancamentosFakeCore.js mais a leitura dos lotes
 * disponíveis), a sessão e o cache do Mapa.
 *
 *  RL-1 compra de produto com lote, quantidade corrigida: o diálogo mostra "Lote do fabricante" e "Validade" já com os
 *       do lote de entrada da versão anterior; sem o lote, "Salvar correção" fica desabilitado; o corpo leva
 *       `lotes_por_item`.
 *  RL-2 o lote anterior não está na leitura: os campos ficam em branco e bloqueiam até preencher.
 *  RL-3 venda: o campo "Lote" conta o que a versão anterior baixou (o estorno devolve); vencido pede confirmação;
 *       escolher o lote manda `lotes`.
 *  RL-4 produto sem lote: nada aparece e o corpo é o de sempre (sem `lotes_por_item`).
 *  RL-5 correção sem mudança no estoque: nenhum lote lido, nada aparece.
 *  RL-6 390 px: o diálogo com os lotes não força rolagem horizontal.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { API_FAKE, instalarBackendFake } from './fixtures/gestaoBackendFake.js';
import { criarEstadoLancamentos, rotearLancamentos, semearDocumento } from './fixtures/lancamentosFakeCore.js';

const sessao = vi.hoisted(() => ({ permissao: /** @type {any} */ (null), clienteId: 'cli-1' }));
const mapa = vi.hoisted(() => ({ refresh: /** @type {any} */ (null) }));

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ clienteId: sessao.clienteId, user: { id: 'u1' } }) }));
vi.mock('@/services/sessionService', async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentUser: vi.fn(async () => ({ login: 'operador', cliente_id: sessao.clienteId })),
  carregarPermissaoEfetiva: vi.fn(async () => sessao.permissao),
}));
vi.mock('@/services/mapaCacheService', async (importOriginal) => ({
  ...(await importOriginal()),
  refreshMapaCacheEntry: (...args) => mapa.refresh(...args),
}));

const TODAS = { novo: true, salvar: true, editar: true, excluir: true, confirmar: true, liquidar: true, estornar_liquidacao: true, cancelar: true };
const PERMISSAO = {
  user_email: 'operador',
  modulos_permitidos: ['gestao-rural'],
  permissoes_telas: [{ tela_id: 'ges-lancamentos-financeiros', visualizar: true, importar: false, exportar: false, ...TODAS }],
};

/** Compra GERAL à vista: 100 kg de MILHO MOÍDO × 6,00 (600,00) no GALPÃO RETIRO. */
const compraSimples = (extra = {}) => ({
  empresa_id: 'emp-1', direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', condicao: 'AVISTA', parceiro_id: 'pa1', data_emissao: '2026-11-08', data_operacional: '2026-11-08',
  efeito_fisico_confirmado: true,
  itens: [{ tipo_item: 'MERCADORIA', produto_id: 'pr2', local_estoque_id: 'lo2', unidade: 'KG', quantidade: '100', valor_unitario: '6' }],
  rateio_escopo: 'GERAL', rateio_modo: 'VALOR', rateios: [{ natureza_id: 'nd1', valor: '600.00' }], parcelas: [{ vencimento: '2026-11-08', valor: '600.00' }],
  ...extra,
});
/** Venda: 10 kg de MILHO MOÍDO × 9,00 para o FRIGORÍFICO CENTRAL. */
const vendaSimples = () => ({
  ...compraSimples(),
  direcao: 'RECEBER', parceiro_id: 'pa2',
  itens: [{ tipo_item: 'MERCADORIA', produto_id: 'pr2', local_estoque_id: 'lo2', unidade: 'KG', quantidade: '10', valor_unitario: '9' }],
  rateios: [{ natureza_id: 'nr1', valor: '90.00' }], parcelas: [{ vencimento: '2026-11-08', valor: '90.00' }],
});

/** O que `GET /estoque/lotes-disponiveis` devolve (por teste). */
let leituraLotes;
let estado;
let backend;

const montar = async () => {
  const { default: LancamentosFinanceiros } = await import('@/pages/LancamentosFinanceiros');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <LancamentosFinanceiros />
    </QueryClientProvider>,
  );
};
const chamadas = (method, re) => backend.chamadas.filter((c) => c.method === method && re.test(c.path));
const clicar = async (el) => act(async () => { fireEvent.click(el); });
const digitar = async (el, valor) => act(async () => { fireEvent.change(el, { target: { value: valor } }); });
const abrir = async (id) => {
  fireEvent.doubleClick(await screen.findByTestId(`lancamento-numero-${id}`));
  await waitFor(() => expect(screen.queryByTestId('carregando-lancamento')).toBeNull());
};
/** Abre a correção do confirmado, troca a quantidade do item 1 e abre o diálogo "Salvar correção". */
const corrigirQuantidade = async (doc, quantidade) => {
  await montar();
  await abrir(doc.id);
  await clicar(screen.getByRole('button', { name: 'Editar' }));
  await screen.findByTestId('faixa-correcao');
  await digitar(screen.getByTestId('item-0-quantidade'), quantidade);
  await clicar(screen.getByTestId('botao-salvar-correcao'));
  const dialogo = await screen.findByTestId('dialogo-retificacao');
  await digitar(within(dialogo).getByTestId('dialogo-retificacao-motivo'), 'Quantidade conferida');
  return dialogo;
};
const PROIBIDAS = /(^|\s)(whitespace-nowrap|overflow-x-auto|w-screen)(\s|$)|min-w-\[|(^|\s)w-\[\d{3,}px\]/;
const semRolagemHorizontal = (raiz) => {
  for (const el of [raiz, ...raiz.querySelectorAll('*')]) {
    const cls = String(el.getAttribute('class') ?? '');
    expect(cls, cls).not.toMatch(PROIBIDAS);
  }
  expect(raiz.querySelector('table')).toBeNull();
};
let matchMediaOriginal;
const emCelular = (largura) => {
  window.innerWidth = largura;
  window.matchMedia = vi.fn().mockImplementation((q) => {
    const max = /max-width:\s*(\d+)px/.exec(q);
    const min = /min-width:\s*(\d+)px/.exec(q);
    return {
      matches: (!max || largura <= Number(max[1])) && (!min || largura >= Number(min[1])),
      media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    };
  });
};

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-08T15:00:00.000Z'));
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  window.localStorage.clear();
  window.sessionStorage.clear();
  matchMediaOriginal = window.matchMedia;
  mapa.refresh = vi.fn(async () => []);
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  sessao.permissao = PERMISSAO;
  window.localStorage.setItem('empresa_selecionada_id', 'emp-1');
  window.localStorage.setItem('empresa_selecionada_cliente_id', sessao.clienteId);
  estado = criarEstadoLancamentos();
  leituraLotes = () => ({ unidade: 'KG', controla_lote: false, controla_validade: false, hoje: '2026-11-08', dias_aviso: 30, lotes: [] });
  backend = instalarBackendFake(async (req) => {
    if (req.method === 'GET' && req.path === '/estoque/lotes-disponiveis') {
      return { status: 200, body: { produto_id: req.query.get('produto_id'), local_estoque_id: req.query.get('local_estoque_id'), ...leituraLotes(req) } };
    }
    const r = await rotearLancamentos(estado, req);
    if (r && r.rede) throw new TypeError('Failed to fetch');
    return r;
  });
});
afterEach(() => {
  cleanup();
  window.matchMedia = matchMediaOriginal;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const comLote = (lotes, extra = {}) => () => ({ unidade: 'KG', controla_lote: true, controla_validade: true, hoje: '2026-11-08', dias_aviso: 30, lotes, ...extra });

describe('D-PROD-305 — lote na correção do lançamento confirmado', () => {
  it('RL-1 compra com lote: pré-preenchido com o lote anterior; sem o lote bloqueia; o corpo leva lotes_por_item', async () => {
    const doc = semearDocumento(estado, compraSimples(), { confirmar: true });
    leituraLotes = comLote([{ id: `lote-${doc.id}-1`, lote_fabricante: 'NF-77', data_validade: '2027-12-31', quantidade_disponivel: '100.0000', vencido: false, vence_em_dias: 418 }]);
    const dialogo = await corrigirQuantidade(doc, '120');
    const bloco = await within(dialogo).findByTestId('confirmacao-lote-1');
    expect(within(dialogo).getByTestId('confirmacao-lotes')).toHaveTextContent('Lote da compra');
    expect(bloco).toHaveTextContent(/Item 1 · MILHO MOÍDO · 120 em GALPÃO RETIRO/);
    expect(within(dialogo).getByTestId('confirmacao-lotes-aviso')).toHaveTextContent('vêm da versão anterior');
    const lote = within(dialogo).getByTestId('confirmacao-lote-1-lote');
    expect(lote).toHaveValue('NF-77');
    expect(within(dialogo).getByTestId('confirmacao-lote-1-validade')).toHaveValue('2027-12-31');
    const salvar = within(dialogo).getByTestId('dialogo-retificacao-enviar');
    expect(salvar).not.toBeDisabled();
    // Sem o lote: bloqueia com a mesma regra da confirmação.
    await digitar(lote, '');
    expect(salvar).toBeDisabled();
    expect(within(dialogo).getByTestId('confirmacao-lotes-pendencia')).toHaveTextContent('Item 1: informe o lote do fabricante.');
    await digitar(lote, ' NF-78 ');
    expect(salvar).not.toBeDisabled();
    await clicar(salvar);
    await waitFor(() => expect(screen.queryByTestId('dialogo-retificacao')).toBeNull());
    const envios = chamadas('POST', /\/retificar$/);
    expect(envios).toHaveLength(1);
    expect(envios[0].body.lotes_por_item).toEqual([{ item_ordem: 1, lote_fabricante: 'NF-78', data_validade: '2027-12-31' }]);
    expect(envios[0].body.itens[0].quantidade).toBe('120');
  });

  it('RL-2 o lote anterior não veio na leitura: os campos ficam em branco e bloqueiam até preencher', async () => {
    const doc = semearDocumento(estado, compraSimples(), { confirmar: true });
    leituraLotes = comLote([]);
    const dialogo = await corrigirQuantidade(doc, '120');
    const lote = await within(dialogo).findByTestId('confirmacao-lote-1-lote');
    expect(lote).toHaveValue('');
    expect(within(dialogo).queryByTestId('confirmacao-lotes-aviso')).toBeNull();
    const salvar = within(dialogo).getByTestId('dialogo-retificacao-enviar');
    expect(salvar).toBeDisabled();
    await digitar(lote, 'L-9');
    expect(salvar).toBeDisabled();
    expect(within(dialogo).getByTestId('confirmacao-lotes-pendencia')).toHaveTextContent('Item 1: informe a validade.');
    await digitar(within(dialogo).getByTestId('confirmacao-lote-1-validade'), '2028-03-01');
    expect(salvar).not.toBeDisabled();
    expect(chamadas('POST', /\/retificar$/)).toHaveLength(0);
  });

  it('RL-3 venda: o saldo conta o que a versão anterior baixou; vencido pede confirmação; escolher manda lotes', async () => {
    const doc = semearDocumento(estado, vendaSimples(), { confirmar: true });
    // A venda anterior baixou 10 kg do A; o A ficou com 2. O estorno devolve os 10 antes da saída nova.
    doc.itens[0].consumos = [{ estoque_lote_nota_id: 'cA', quantidade: '10.0000', custo_unitario: '4.0000' }];
    leituraLotes = comLote([
      { id: 'cV', lote_fabricante: 'VELHO', data_validade: '2026-10-01', quantidade_disponivel: '5.0000', vencido: true, vence_em_dias: -38 },
      { id: 'cA', lote_fabricante: 'A', data_validade: '2027-12-31', quantidade_disponivel: '2.0000', vencido: false, vence_em_dias: 418 },
    ]);
    const dialogo = await corrigirQuantidade(doc, '12');
    expect(within(dialogo).getByTestId('confirmacao-lotes')).toHaveTextContent('Lote da venda');
    const campo = await within(dialogo).findByTestId('confirmacao-lote-1');
    // FEFO: VELHO 5 + A 7 (só cabe porque o A volta a ter 12): sem "saldo insuficiente", mas o vencido pede confirmação.
    expect((await within(campo).findByTestId('confirmacao-lote-1-sugestao')).textContent).toMatch(/VELHO.*5.*A.*7/);
    const salvar = within(dialogo).getByTestId('dialogo-retificacao-enviar');
    await waitFor(() => expect(salvar).toBeDisabled());
    expect(within(dialogo).getByTestId('confirmacao-lotes-pendencia')).toHaveTextContent('Confirme o uso do lote vencido');
    await clicar(within(campo).getByTestId('confirmacao-lote-1-alternar'));
    await digitar(within(campo).getByTestId('confirmacao-lote-1-qtd-cV'), '');
    await digitar(within(campo).getByTestId('confirmacao-lote-1-qtd-cA'), '12');
    await waitFor(() => expect(salvar).not.toBeDisabled());
    await clicar(salvar);
    await waitFor(() => expect(screen.queryByTestId('dialogo-retificacao')).toBeNull());
    const envios = chamadas('POST', /\/retificar$/);
    expect(envios).toHaveLength(1);
    expect(envios[0].body.lotes_por_item).toEqual([{ item_ordem: 1, lotes: [{ estoque_lote_nota_id: 'cA', quantidade: '12' }] }]);
  });

  it('RL-4 produto sem lote: nada aparece; o corpo é o de sempre (sem lotes_por_item)', async () => {
    const doc = semearDocumento(estado, compraSimples(), { confirmar: true });
    const dialogo = await corrigirQuantidade(doc, '120');
    await waitFor(() => expect(chamadas('GET', /\/estoque\/lotes-disponiveis$/).length).toBeGreaterThan(0));
    const salvar = within(dialogo).getByTestId('dialogo-retificacao-enviar');
    await waitFor(() => expect(salvar).not.toBeDisabled());
    expect(within(dialogo).queryByTestId('confirmacao-lotes')).toBeNull();
    await clicar(salvar);
    await waitFor(() => expect(screen.queryByTestId('dialogo-retificacao')).toBeNull());
    const envios = chamadas('POST', /\/retificar$/);
    expect(envios).toHaveLength(1);
    expect('lotes_por_item' in envios[0].body).toBe(false);
  });

  it('RL-5 correção sem mudança no estoque (só a descrição): nenhum lote lido, nada aparece', async () => {
    const doc = semearDocumento(estado, compraSimples(), { confirmar: true });
    leituraLotes = comLote([{ id: `lote-${doc.id}-1`, lote_fabricante: 'NF-77', data_validade: '2027-12-31', quantidade_disponivel: '100.0000', vencido: false, vence_em_dias: 418 }]);
    await montar();
    await abrir(doc.id);
    await clicar(screen.getByRole('button', { name: 'Editar' }));
    await screen.findByTestId('faixa-correcao');
    fireEvent.change(screen.getByLabelText(/Histórico \(descrição\)/), { target: { value: 'COMPRA DE MILHO' } });
    await clicar(screen.getByTestId('botao-salvar-correcao'));
    const dialogo = await screen.findByTestId('dialogo-retificacao');
    expect(within(dialogo).getByTestId('dialogo-retificacao-estoque')).toHaveTextContent(/O estoque não muda/);
    expect(within(dialogo).queryByTestId('confirmacao-lotes')).toBeNull();
    expect(chamadas('GET', /\/estoque\/lotes-disponiveis$/)).toHaveLength(0);
    await digitar(within(dialogo).getByTestId('dialogo-retificacao-motivo'), 'Descrição');
    await clicar(within(dialogo).getByTestId('dialogo-retificacao-enviar'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-retificacao')).toBeNull());
    expect('lotes_por_item' in chamadas('POST', /\/retificar$/)[0].body).toBe(false);
  });

  it('RL-6 390 px: o diálogo com os lotes (compra e venda com a escolha manual) não força rolagem horizontal', async () => {
    emCelular(390);
    const doc = semearDocumento(estado, compraSimples(), { confirmar: true });
    leituraLotes = comLote([{ id: `lote-${doc.id}-1`, lote_fabricante: 'NF-77', data_validade: '2027-12-31', quantidade_disponivel: '100.0000', vencido: false, vence_em_dias: 418 }]);
    await montar();
    await clicar(await screen.findByLabelText('Selecionar AGROPECUÁRIA BOA VISTA'));
    await clicar(screen.getByRole('button', { name: 'Registro' }));
    await waitFor(() => expect(screen.queryByTestId('carregando-lancamento')).toBeNull());
    await clicar(screen.getByRole('button', { name: 'Editar' }));
    await screen.findByTestId('faixa-correcao');
    await digitar(screen.getByTestId('item-0-quantidade'), '120');
    await act(async () => { fireEvent.submit(screen.getByTestId('b1-form')); });
    const dialogo = await screen.findByTestId('dialogo-retificacao');
    await within(dialogo).findByTestId('confirmacao-lote-1');
    semRolagemHorizontal(dialogo);
    expect(within(dialogo).getByTestId('confirmacao-lote-1').querySelector('.grid-cols-1')).not.toBeNull();
  });
});
