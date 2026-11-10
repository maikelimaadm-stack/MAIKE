/**
 * D-PROD-156 (P3-02) — rateio gerencial POR ITEM na mesma tela de Lançamentos,
 * montada de verdade (página, motor Base1, service, API, porta e
 * nativeHttpClient reais). Mocks só da borda: `fetch` (backend FALSO do
 * contrato, tests/smoke/fixtures/lancamentosFakeCore.js) e a sessão. As
 * perguntas usam `confirmar` (@/lib/maikeConfirmar), que sem o host do App cai
 * no `window.confirm`: o teste responde por ele.
 *
 *  RIT-1 escopo: seletor só com produtos; rascunho antigo (sem rateio_escopo) abre Geral.
 *  RIT-2 GERAL → POR_ITEM (diálogo: proporcional ou em branco) e POR_ITEM → GERAL
 *        (confirmação; descarta só depois de confirmar; o geral volta intacto).
 *  RIT-3 "Aplicar a todos", linha única = 100% do líquido, diferença por item e
 *        total, Confirmar bloqueado apontando item/linha, corpo POR_ITEM.
 *  RIT-4 reordenar e remover item: as linhas vão junto (chave, nunca índice).
 *  RIT-5 recusa do servidor com indice + subindice aparece no campo exato.
 *  RIT-6 consulta e prévia: classificação por item e resumo consolidado; confirmar
 *        gera 1 título por parcela e 1 movimento por item físico.
 *  RIT-7 celular (390 px): sem rolagem horizontal.
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
// Confirmar/cancelar com mercadoria avisa o cache do Mapa (IndexedDB não existe no jsdom).
vi.mock('@/services/mapaCacheService', async (importOriginal) => ({
  ...(await importOriginal()),
  refreshMapaCacheEntry: vi.fn(async () => []),
}));

const TODAS = { novo: true, salvar: true, editar: true, confirmar: true, liquidar: true, estornar_liquidacao: true, cancelar: true };
const permissaoCom = (acoes) => ({
  user_email: 'operador',
  modulos_permitidos: ['gestao-rural'],
  permissoes_telas: [
    { tela_id: 'ges-lancamentos-financeiros', visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes },
  ],
});

/** Compra: milho 100 kg × 6,00 (600,00) + frete 1 × 400,00, à vista, rateio GERAL 700 NUTRIÇÃO + 300 SANIDADE/RECRIA. */
const corpoGeral = (extra = {}) => ({
  empresa_id: 'emp-1',
  direcao: 'PAGAR',
  conteudo: 'COM_PRODUTOS',
  condicao: 'AVISTA',
  parceiro_id: 'pa1',
  data_emissao: '2026-11-08',
  data_operacional: '2026-11-08',
  efeito_fisico_confirmado: true,
  itens: [
    { tipo_item: 'MERCADORIA', produto_id: 'pr2', local_estoque_id: 'lo1', unidade: 'KG', quantidade: '100', valor_unitario: '6' },
    { tipo_item: 'SERVICO', unidade: 'UN', descricao: 'FRETE', quantidade: '1', valor_unitario: '400' },
  ],
  rateio_modo: 'VALOR',
  rateios: [
    { natureza_id: 'nd1', valor: '700.00' },
    { natureza_id: 'nd2', centro_custo_id: 'cc2', valor: '300.00' },
  ],
  parcelas: [{ vencimento: '2026-11-08', valor: '1000.00' }],
  ...extra,
});

/** A mesma compra POR_ITEM: milho 100% NUTRIÇÃO; frete 250 SANIDADE/CRIA + 150 ENERGIA. */
const corpoPorItem = (extra = {}) =>
  corpoGeral({
    rateio_escopo: 'POR_ITEM',
    rateios: [],
    itens: [
      { ...corpoGeral().itens[0], rateios: [{ natureza_id: 'nd1', valor: '600.00' }] },
      { ...corpoGeral().itens[1], rateios: [{ natureza_id: 'nd2', centro_custo_id: 'cc1', valor: '250.00' }, { natureza_id: 'nd3', valor: '150.00' }] },
    ],
    ...extra,
  });

/** POR_ITEM com desconto 100 (líquidos 540 + 360): milho NUTRIÇÃO; frete 200 SANIDADE/CRIA + 160 NUTRIÇÃO. */
const corpoPorItemComDesconto = () =>
  corpoGeral({
    valor_desconto: '100.00',
    rateio_escopo: 'POR_ITEM',
    rateios: [],
    itens: [
      { ...corpoGeral().itens[0], rateios: [{ natureza_id: 'nd1', valor: '540.00' }] },
      { ...corpoGeral().itens[1], rateios: [{ natureza_id: 'nd2', centro_custo_id: 'cc1', valor: '200.00' }, { natureza_id: 'nd1', valor: '160.00' }] },
    ],
    parcelas: [{ vencimento: '2026-11-08', valor: '900.00' }],
  });

let estado;
let backend;
/** Pós-processa as respostas do backend falso (ex.: servidor da P3-01 sem `rateio_escopo`). */
let ajustarResposta = (/** @type {any} */ _req, /** @type {any} */ r) => r;

const montar = async () => {
  const { default: LancamentosFinanceiros } = await import('@/pages/LancamentosFinanceiros');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <LancamentosFinanceiros />
    </QueryClientProvider>,
  );
  return queryClient;
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
const salvar = () => clicar(screen.getByRole('button', { name: 'Salvar' }));
const abrir = async (id) => {
  fireEvent.doubleClick(await screen.findByTestId(`lancamento-numero-${id}`));
  await waitFor(() => expect(screen.queryByTestId('carregando-lancamento')).toBeNull());
};
const editar = async () => {
  await clicar(await screen.findByRole('button', { name: 'Editar' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar' })).toBeTruthy());
};
const ultimoPut = (id) => {
  const lista = chamadas('PUT', `/operacoes-financeiras/${id}`);
  expect(lista.length).toBeGreaterThan(0);
  return lista[lista.length - 1].body;
};
/** Natureza escolhida numa linha do rateio por item (rótulo do seletor). */
const naturezaDaLinha = (k, j) => screen.getByTestId(`seletor-natureza-item-${k}-${j}`).getAttribute('aria-label');

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
  window.localStorage.setItem('empresa_selecionada_id', 'emp-1');
  window.localStorage.setItem('empresa_selecionada_cliente_id', sessao.clienteId);
  estado = criarEstadoLancamentos();
  ajustarResposta = (_req, r) => r;
  backend = instalarBackendFake(async (req) => {
    const r = await rotearLancamentos(estado, req);
    if (r && r.rede) throw new TypeError('Failed to fetch');
    return ajustarResposta(req, r);
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.innerWidth = 1024;
});

describe('RIT-1 — seletor de escopo', () => {
  it('só aparece com produtos (sem produtos o rateio é sempre geral)', async () => {
    const semProdutos = semearDocumento(estado, {
      empresa_id: 'emp-1', direcao: 'PAGAR', conteudo: 'SEM_PRODUTOS', condicao: 'AVISTA', parceiro_id: 'pa1', data_emissao: '2026-11-08',
      valor_bruto: '50.00', rateio_modo: 'VALOR', rateios: [{ natureza_id: 'nd1', valor: '50.00' }], parcelas: [{ vencimento: '2026-11-08', valor: '50.00' }],
    });
    await montar();
    await abrir(semProdutos.id);
    expect(await screen.findByTestId('rateio-0')).toBeTruthy();
    expect(screen.queryByTestId('escolha-escopo-rateio')).toBeNull();
    await editar();
    await radio('Com produtos');
    const escopo = screen.getByTestId('escolha-escopo-rateio');
    expect(within(escopo).getByRole('radio', { name: 'Geral' })).toHaveAttribute('aria-checked', 'true');
  });

  it('rascunho antigo (servidor da P3-01, sem rateio_escopo) abre como Geral', async () => {
    const antigo = semearDocumento(estado, corpoGeral());
    // Servidor da P3-01: o detalhe não tem `rateio_escopo`, nem `itens[].rateios`, nem o consolidado.
    ajustarResposta = (req, r) => {
      if (req.method === 'GET' && req.path === `/operacoes-financeiras/${antigo.id}` && r?.body) {
        const { rateio_escopo: _e, rateio_consolidado: _c, ...resto } = r.body;
        return { ...r, body: { ...resto, itens: resto.itens.map(({ rateios: _r, ...i }) => i) } };
      }
      return r;
    };
    await montar();
    await abrir(antigo.id);
    const escopo = await screen.findByTestId('escolha-escopo-rateio');
    expect(within(escopo).getByRole('radio', { name: 'Geral' })).toHaveAttribute('aria-checked', 'true');
    expect(within(escopo).getByRole('radio', { name: 'Por item' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('rateio-0')).toBeTruthy();
    expect(screen.queryByTestId('rateio-item-0')).toBeNull();
  });
});

describe('RIT-2 — troca de escopo nos dois sentidos, com os diálogos', () => {
  it('GERAL → POR_ITEM proporcional; POR_ITEM → GERAL pede confirmação, descarta só depois e o geral volta intacto', async () => {
    const perguntar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const doc = semearDocumento(estado, corpoGeral());
    await montar();
    await abrir(doc.id);
    await editar();
    await radio('Por item');
    const dialogo = await screen.findByTestId('dialogo-escopo-por-item');
    expect(dialogo).toHaveTextContent(/rateio geral continua guardado/i);
    await clicar(within(dialogo).getByTestId('escopo-por-item-proporcional'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-escopo-por-item')).toBeNull());

    // Mesmas proporções do geral (700/300) sobre o líquido de cada item (600 e 400).
    expect(naturezaDaLinha(0, 0)).toMatch(/NUTRIÇÃO/);
    expect(naturezaDaLinha(0, 1)).toMatch(/SANIDADE/);
    expect(screen.getByTestId('rateio-item-0-linha-0-valor')).toHaveValue('420,00');
    expect(screen.getByTestId('rateio-item-0-linha-1-valor')).toHaveValue('180,00');
    expect(screen.getByTestId('rateio-item-1-linha-0-valor')).toHaveValue('280,00');
    expect(screen.getByTestId('rateio-item-1-linha-1-valor')).toHaveValue('120,00');
    expect(screen.getByTestId('rateio-item-0-cabecalho')).toHaveTextContent(/Item 1 · MILHO MOÍDO/);
    expect(screen.getByTestId('rateio-item-0-liquido')).toHaveTextContent(/R\$\s600,00/);
    expect(screen.getByTestId('rateio-item-1-diferenca-curta')).toHaveAttribute('data-estado', 'fechado');
    expect(screen.getByTestId('rateio-itens-diferenca-total')).toHaveAttribute('data-estado', 'fechado');
    expect(screen.queryByTestId('rateio-0')).toBeNull();

    // Voltar com dados por item: pergunta; "não" mantém tudo.
    await radio('Geral');
    expect(perguntar).toHaveBeenCalledTimes(1);
    expect(perguntar.mock.calls[0][0]).toMatch(/classificações por item serão descartadas/);
    expect(screen.getByTestId('rateio-item-0')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Por item' })).toHaveAttribute('aria-checked', 'true');

    // "Sim": descarta e o geral volta EXATAMENTE como estava.
    perguntar.mockReturnValue(true);
    await radio('Geral');
    await waitFor(() => expect(screen.queryByTestId('rateio-item-0')).toBeNull());
    expect(screen.getByTestId('rateio-0-valor')).toHaveValue('700,00');
    expect(screen.getByTestId('rateio-1-valor')).toHaveValue('300,00');

    // De novo para POR_ITEM, agora em branco: Confirmar fica bloqueado apontando item e linha.
    await radio('Por item');
    await clicar(within(await screen.findByTestId('dialogo-escopo-por-item')).getByTestId('escopo-por-item-branco'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-escopo-por-item')).toBeNull());
    expect(naturezaDaLinha(0, 0)).not.toMatch(/:/);
    expect(screen.getByTestId('botao-confirmar-lancamento')).toBeDisabled();
    expect(screen.getByTestId('confirmar-bloqueado-rateio-item')).toHaveTextContent(/Item 1, linha 1 do rateio: Escolha a natureza/);

    // Sem nada preenchido por item, voltar ao geral não pergunta.
    await radio('Geral');
    expect(perguntar).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByTestId('rateio-item-0')).toBeNull());
    expect(screen.getByTestId('botao-confirmar-lancamento')).not.toBeDisabled();
  });

  it('trocar para "sem produtos" no POR_ITEM avisa que as classificações por item saem e volta ao rateio geral', async () => {
    const perguntar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const doc = semearDocumento(estado, corpoPorItem());
    await montar();
    await abrir(doc.id);
    await editar();
    expect(screen.getByTestId('rateio-item-0')).toBeTruthy();
    await radio('Sem produtos');
    expect(perguntar.mock.calls[0][0]).toMatch(/classificações por item serão descartadas/);
    await waitFor(() => expect(screen.queryByTestId('rateio-item-0')).toBeNull());
    expect(screen.queryByTestId('escolha-escopo-rateio')).toBeNull();
    expect(screen.getByTestId('rateio-0')).toBeTruthy();
  });

  it('proporcional indisponível quando o geral não fecha: o diálogo explica e só oferece "começar em branco"', async () => {
    const doc = semearDocumento(estado, corpoGeral());
    await montar();
    await abrir(doc.id);
    await editar();
    digitar('rateio-1-valor', '200,00'); // geral: 700 + 200 ≠ 1.000
    await radio('Por item');
    const dialogo = await screen.findByTestId('dialogo-escopo-por-item');
    expect(within(dialogo).getByTestId('escopo-por-item-proporcional')).toBeDisabled();
    expect(within(dialogo).getByTestId('escopo-por-item-motivo')).toHaveTextContent(/rateio geral não fecha/);
    await clicar(within(dialogo).getByTestId('escopo-por-item-cancelar'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-escopo-por-item')).toBeNull());
    expect(screen.getByRole('radio', { name: 'Geral' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('rateio-1-valor')).toHaveValue('200,00');
  });
});

describe('RIT-3 — aplicar a todos, diferença por item e total, corpo POR_ITEM', () => {
  it('"Aplicar classificação a todos": 1 linha de 100% do líquido por item; diferença ao centavo bloqueia Confirmar; o PUT leva itens[].rateios e [] no topo', async () => {
    const perguntar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const doc = semearDocumento(estado, corpoGeral());
    await montar();
    await abrir(doc.id);
    await editar();
    await radio('Por item');
    await clicar(within(await screen.findByTestId('dialogo-escopo-por-item')).getByTestId('escopo-por-item-branco'));
    await clicar(screen.getByTestId('abrir-aplicar-todos'));
    expect(screen.getByTestId('aplicar-classificacao-todos')).toBeDisabled();
    await escolher('seletor-natureza-todos', /SANIDADE/);
    await escolher('seletor-centro-custo-todos', /RECRIA/);
    await clicar(screen.getByTestId('aplicar-classificacao-todos'));
    expect(perguntar).not.toHaveBeenCalled(); // nada por item ainda: não há o que perder

    for (const [k, liquido] of [[0, /R\$\s600,00 \(100% do líquido\)/], [1, /R\$\s400,00 \(100% do líquido\)/]]) {
      expect(naturezaDaLinha(k, 0)).toMatch(/SANIDADE/);
      expect(screen.getByTestId(`seletor-centro-custo-item-${k}-0`).getAttribute('aria-label')).toMatch(/RECRIA/);
      expect(screen.getByTestId(`rateio-item-${k}-linha-0-valor-auto`)).toHaveTextContent(liquido);
    }
    expect(screen.getByTestId('botao-confirmar-lancamento')).not.toBeDisabled();
    expect(screen.queryByTestId('confirmar-bloqueado-rateio-item')).toBeNull();

    // Dividir o frete: a linha automática vira valor visível; 300 + 99,99 = falta 0,01.
    await clicar(screen.getByTestId('rateio-item-1-adicionar'));
    expect(screen.getByTestId('rateio-item-1-linha-0-valor')).toHaveValue('400,00');
    digitar('rateio-item-1-linha-0-valor', '300,00');
    await escolher('seletor-natureza-item-1-1', /NUTRIÇÃO/);
    digitar('rateio-item-1-linha-1-valor', '99,99');
    expect(screen.getByTestId('rateio-item-1-diferenca')).toHaveTextContent(/Falta R\$\s0,01 para fechar o líquido do item/);
    expect(screen.getByTestId('rateio-item-1-diferenca-curta')).toHaveTextContent(/diferença R\$\s0,01/);
    expect(screen.getByTestId('rateio-itens-diferenca-total')).toHaveTextContent(/falta R\$\s0,01/);
    expect(screen.getByTestId('rateio-item-0-diferenca-curta')).toHaveAttribute('data-estado', 'fechado');
    expect(screen.getByTestId('botao-confirmar-lancamento')).toBeDisabled();
    expect(screen.getByTestId('confirmar-bloqueado-rateio-item')).toHaveTextContent(/Item 2, rateio: A soma das linhas precisa ser igual ao líquido do item/);
    await salvar();
    expect(chamadas('PUT', `/operacoes-financeiras/${doc.id}`)).toHaveLength(0);

    digitar('rateio-item-1-linha-1-valor', '100,00');
    expect(screen.getByTestId('rateio-item-1-diferenca')).toHaveAttribute('data-estado', 'fechado');
    expect(screen.getByTestId('rateio-itens-diferenca-total')).toHaveAttribute('data-estado', 'fechado');
    expect(screen.getByTestId('botao-confirmar-lancamento')).not.toBeDisabled();
    await salvar();
    await waitFor(() => expect(chamadas('PUT', `/operacoes-financeiras/${doc.id}`)).toHaveLength(1));
    const corpo = ultimoPut(doc.id);
    expect(corpo).toMatchObject({ rateio_escopo: 'POR_ITEM', rateio_modo: 'VALOR', rateios: [] });
    expect(corpo.itens.map((i) => i.rateios)).toEqual([
      [{ natureza_id: 'nd2', centro_custo_id: 'cc2', valor: '600.00' }],
      [{ natureza_id: 'nd2', centro_custo_id: 'cc2', valor: '300.00' }, { natureza_id: 'nd1', valor: '100.00' }],
    ]);
    // Gravado: volta em leitura, ainda POR_ITEM.
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Por item' })).toHaveAttribute('aria-checked', 'true'));
    expect(estado.documentos[0].rateio_escopo).toBe('POR_ITEM');
  });

  it('aplicar a todos sobre classificações existentes pede confirmação (nunca substitui em silêncio)', async () => {
    const perguntar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const doc = semearDocumento(estado, corpoPorItem());
    await montar();
    await abrir(doc.id);
    await editar();
    await clicar(screen.getByTestId('abrir-aplicar-todos'));
    await escolher('seletor-natureza-todos', /ENERGIA/);
    await clicar(screen.getByTestId('aplicar-classificacao-todos'));
    expect(perguntar).toHaveBeenCalledTimes(1);
    expect(perguntar.mock.calls[0][0]).toMatch(/serão substituídas/);
    expect(naturezaDaLinha(1, 0)).toMatch(/SANIDADE/);
    perguntar.mockReturnValue(true);
    await clicar(screen.getByTestId('aplicar-classificacao-todos'));
    expect(naturezaDaLinha(1, 0)).toMatch(/ENERGIA/);
    expect(screen.queryByTestId('rateio-item-1-linha-1')).toBeNull();
  });
});

describe('RIT-4 — reordenar e remover item levam as linhas junto', () => {
  it('subir o frete leva as 2 linhas dele; remover a mercadoria remove a linha dela; o PUT segue a ordem nova', async () => {
    const doc = semearDocumento(estado, corpoPorItem());
    await montar();
    await abrir(doc.id);
    await editar();
    expect(screen.getByTestId('rateio-item-0-cabecalho')).toHaveTextContent(/MILHO MOÍDO/);
    expect(screen.getByTestId('rateio-item-1-cabecalho')).toHaveTextContent(/FRETE/);
    await clicar(screen.getByRole('button', { name: 'Mover item 2 para cima' }));
    expect(screen.getByTestId('rateio-item-0-cabecalho')).toHaveTextContent(/Item 1 · FRETE/);
    expect(naturezaDaLinha(0, 0)).toMatch(/SANIDADE/);
    expect(screen.getByTestId('seletor-centro-custo-item-0-0').getAttribute('aria-label')).toMatch(/CRIA/);
    expect(screen.getByTestId('rateio-item-0-linha-1-valor')).toHaveValue('150,00');
    expect(screen.getByTestId('rateio-item-1-cabecalho')).toHaveTextContent(/Item 2 · MILHO MOÍDO/);
    expect(naturezaDaLinha(1, 0)).toMatch(/NUTRIÇÃO/);
    await salvar();
    await waitFor(() => expect(chamadas('PUT', `/operacoes-financeiras/${doc.id}`)).toHaveLength(1));
    const corpo = ultimoPut(doc.id);
    expect(corpo.itens.map((i) => [i.tipo_item, i.rateios])).toEqual([
      ['SERVICO', [{ natureza_id: 'nd2', centro_custo_id: 'cc1', valor: '250.00' }, { natureza_id: 'nd3', valor: '150.00' }]],
      ['MERCADORIA', [{ natureza_id: 'nd1', valor: '600.00' }]],
    ]);

    await editar();
    await clicar(screen.getByRole('button', { name: 'Remover item 2' }));
    expect(screen.queryByTestId('rateio-item-1')).toBeNull();
    expect(screen.getByTestId('rateio-item-0-cabecalho')).toHaveTextContent(/FRETE/);
    await salvar();
    await waitFor(() => expect(chamadas('PUT', `/operacoes-financeiras/${doc.id}`)).toHaveLength(2));
    const depois = ultimoPut(doc.id);
    expect(depois.itens).toHaveLength(1);
    expect(depois.itens[0].rateios.map((l) => l.natureza_id)).toEqual(['nd2', 'nd3']);
    expect(depois).not.toHaveProperty('data_operacional'); // sem mercadoria
    expect(estado.documentos[0].itens).toHaveLength(1);
    expect(estado.documentos[0].rateio_consolidado.map((l) => l.natureza_id)).toEqual(['nd2', 'nd3']);
  });
});

describe('RIT-5 — recusa do servidor aponta o campo exato (indice + subindice)', () => {
  it('natureza inativa no item 2, linha 2: a mensagem aparece NO seletor dessa linha (o bloco recolhido abre) e some ao editar', async () => {
    const doc = semearDocumento(estado, corpoPorItem());
    estado.falhas.editar = {
      umaVez: true,
      resposta: {
        status: 422,
        body: {
          code: 'OPERACAO_REFERENCIA_INVALIDA',
          message: 'texto do servidor (falso)',
          request_id: 'req_fake',
          field: 'natureza_id',
          reason: 'natureza_inativa',
          details: { field: 'natureza_id', reason: 'natureza_inativa', colecao: 'itens', indice: 1, subcolecao: 'rateios', subindice: 1, item_ordem: 2 },
        },
      },
    };
    await montar();
    await abrir(doc.id);
    await editar();
    await clicar(screen.getByTestId('rateio-item-1-cabecalho')); // recolhe o item 2
    expect(screen.queryByTestId('rateio-item-1-linha-1')).toBeNull();
    await salvar();
    await waitFor(() => expect(chamadas('PUT', `/operacoes-financeiras/${doc.id}`)).toHaveLength(1));
    const linha = await screen.findByTestId('rateio-item-1-linha-1');
    expect(within(linha).getByText(/natureza escolhida está inativa.*\(item 2, linha 2 do rateio\)/)).toBeTruthy();
    expect(within(screen.getByTestId('rateio-item-1-linha-0')).queryByText(/inativa/)).toBeNull();
    expect(within(screen.getByTestId('rateio-item-0')).queryByText(/inativa/)).toBeNull();
    expect(screen.queryByText(/texto do servidor/)).toBeNull();
    // Editou a linha: a recusa antiga sai do campo.
    digitar('rateio-item-1-linha-1-valor', '149,00');
    await waitFor(() => expect(within(screen.getByTestId('rateio-item-1-linha-1')).queryByText(/inativa/)).toBeNull());
  });

  it('soma_diferente do item 1 (sem subíndice) aparece no bloco do item', async () => {
    const doc = semearDocumento(estado, corpoPorItem());
    estado.falhas.editar = {
      umaVez: true,
      resposta: {
        status: 422,
        body: {
          code: 'OPERACAO_RATEIO_INVALIDO',
          message: 'texto do servidor (falso)',
          request_id: 'req_fake',
          field: 'rateios',
          reason: 'soma_diferente',
          details: { field: 'rateios', reason: 'soma_diferente', modo: 'VALOR', colecao: 'itens', indice: 0, subcolecao: 'rateios', item_ordem: 1, esperado: '600.00', informado: '599.99', diferenca: '0.01', valor_liquido: '600.00' },
        },
      },
    };
    await montar();
    await abrir(doc.id);
    await editar();
    await salvar();
    const erro = await screen.findByTestId('rateio-item-0-erro');
    expect(erro).toHaveTextContent(/O rateio do item 1 não fecha com o líquido do item: esperado R\$\s600,00, informado R\$\s599,99 \(diferença R\$\s0,01\)/);
    expect(screen.queryByTestId('rateio-item-1-erro')).toBeNull();
  });
});

describe('RIT-6 — prévia, confirmação e consulta com o resumo consolidado', () => {
  it('prévia mostra a classificação de cada item e o consolidado; confirmar gera 1 título e 1 movimento só para a mercadoria', async () => {
    const doc = semearDocumento(estado, corpoPorItemComDesconto());
    await montar();
    await abrir(doc.id);
    await clicar(await screen.findByTestId('botao-confirmar-lancamento'));
    const dialogo = await screen.findByTestId('dialogo-confirmacao');
    expect(within(dialogo).getByTestId('previa-resumo')).toHaveTextContent(/1 parcela, movimentará 1 item no estoque e registrará R\$\s900,00/);
    const frete = within(dialogo).getByTestId('previa-rateio-item-2-classificacao');
    expect(within(frete).getByTestId('previa-rateio-item-2-classificacao-linha-1')).toHaveTextContent(/SANIDADE.*CRIA.*R\$\s200,00 · 55,56%/);
    expect(within(frete).getByTestId('previa-rateio-item-2-classificacao-linha-2')).toHaveTextContent(/NUTRIÇÃO.*R\$\s160,00 · 44,44%/);
    const consolidado = within(dialogo).getByTestId('previa-rateio-consolidado');
    expect(within(consolidado).getByTestId('previa-rateio-consolidado-linha-1')).toHaveTextContent(/NUTRIÇÃO.*R\$\s700,00 · 77,78%/);
    expect(within(consolidado).getByTestId('previa-rateio-consolidado-linha-2')).toHaveTextContent(/SANIDADE.*CRIA.*R\$\s200,00 · 22,22%/);
    expect(within(consolidado).queryByTestId('previa-rateio-consolidado-linha-3')).toBeNull();
    expect(within(consolidado).getByTestId('previa-rateio-consolidado-conferencia')).toHaveTextContent(/confere com o total do documento \(R\$\s900,00\)/);

    await clicar(within(dialogo).getByTestId('botao-confirmar-definitivo'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-confirmacao')).toBeNull());
    expect(await screen.findByTestId('status-lancamento')).toHaveTextContent('Confirmado');
    expect(screen.getByTestId('titulo-1')).toBeTruthy();
    expect(screen.queryByTestId('titulo-2')).toBeNull();
    expect(estado.documentos[0].titulos).toHaveLength(1);
    expect(estado.documentos[0].itens.filter((i) => i.movimentacao_estoque_id)).toHaveLength(1);
    expect(within(screen.getByTestId('consulta-item-1')).getByText(/Entrada registrada/)).toBeTruthy();
  });

  it('consulta do confirmado POR_ITEM: classificação por item (% do líquido) e consolidado (% do total) sem duplicar', async () => {
    const porItem = semearDocumento(estado, corpoPorItemComDesconto(), { confirmar: true });
    await montar();
    await abrir(porItem.id);
    await screen.findByTestId('consulta-lancamento');
    expect(screen.getByTestId('consulta-item-1-classificacao-linha-1')).toHaveTextContent(/NUTRIÇÃO.*R\$\s540,00 · 100%/);
    expect(screen.getByTestId('consulta-item-2-classificacao-linha-1')).toHaveTextContent(/SANIDADE.*CRIA.*R\$\s200,00 · 55,56%/);
    const consolidado = screen.getByTestId('consulta-rateio-consolidado');
    expect(within(consolidado).getByTestId('consulta-rateio-consolidado-linha-1')).toHaveTextContent(/NUTRIÇÃO.*R\$\s700,00 · 77,78%/);
    expect(within(consolidado).getByTestId('consulta-rateio-consolidado-linha-2')).toHaveTextContent(/SANIDADE.*R\$\s200,00 · 22,22%/);
    expect(within(consolidado).queryByTestId('consulta-rateio-consolidado-linha-3')).toBeNull();
    expect(screen.getByTestId('consulta-rateio-consolidado-conferencia')).toHaveTextContent(/R\$\s900,00/);
    expect(screen.queryByTestId('consulta-rateio-1')).toBeNull();
    expect(screen.getByText('Rateio por item — resumo consolidado')).toBeTruthy();
  });

  it('consulta do confirmado GERAL mantém as linhas de sempre (sem consolidado nem classificação por item)', async () => {
    const geral = semearDocumento(estado, corpoGeral(), { confirmar: true });
    await montar();
    await abrir(geral.id);
    await screen.findByTestId('consulta-lancamento');
    expect(screen.getByTestId('consulta-rateio-1')).toHaveTextContent(/NUTRIÇÃO/);
    expect(screen.getByTestId('consulta-rateio-2')).toHaveTextContent(/SANIDADE/);
    expect(screen.queryByTestId('consulta-rateio-consolidado')).toBeNull();
    expect(screen.queryByTestId('consulta-item-1-classificacao')).toBeNull();
  });
});

describe('RIT-7 — celular (390 px)', () => {
  const PROIBIDAS = /(^|\s)(whitespace-nowrap|overflow-x-auto|w-screen)(\s|$)|min-w-\[|(^|\s)w-\[\d{3,}px\]/;
  const semRolagemHorizontal = (raiz) => {
    for (const el of [raiz, ...raiz.querySelectorAll('*')]) {
      const cls = String(el.getAttribute('class') ?? '');
      expect(cls, cls).not.toMatch(PROIBIDAS);
    }
    expect(raiz.querySelector('table')).toBeNull();
  };

  const em390 = () => {
    window.innerWidth = 390;
    window.dispatchEvent(new Event('resize'));
  };

  it('formulário: blocos por item, cabeçalho e linhas quebram linha (sem tabela larga nem largura mínima fixa)', async () => {
    em390();
    const rascunho = semearDocumento(estado, corpoPorItem());
    await montar();
    await abrir(rascunho.id);
    await editar();
    await clicar(screen.getByTestId('abrir-aplicar-todos'));
    for (const id of ['rateio-item-0', 'rateio-item-1', 'aplicar-todos-painel']) semRolagemHorizontal(screen.getByTestId(id));
    const cabecalho = screen.getByTestId('rateio-item-1-cabecalho');
    expect(cabecalho.className).toMatch(/(^|\s)flex-wrap(\s|$)/);
    expect(cabecalho.className).toMatch(/(^|\s)min-w-0(\s|$)/);
    // Linhas: cada campo ocupa a linha inteira no celular (col-span-12; md: divide).
    for (const campo of screen.getByTestId('rateio-item-1-linha-0').querySelectorAll('.grid > div')) expect(campo.className).toMatch(/(^|\s)col-span-12(\s|$)/);
  });

  it('prévia: classificação por item e consolidado empilhados, sem rolagem horizontal', async () => {
    em390();
    const rascunho = semearDocumento(estado, corpoPorItemComDesconto());
    await montar();
    await abrir(rascunho.id);
    await clicar(await screen.findByTestId('botao-confirmar-lancamento'));
    const dialogo = await screen.findByTestId('dialogo-confirmacao');
    semRolagemHorizontal(within(dialogo).getByTestId('previa-rateio'));
    expect(within(dialogo).getByTestId('previa-rateio-item-2-classificacao-linha-1').className).toMatch(/(^|\s)grid-cols-2(\s|$)/);
  });

  it('consulta: classificação por item e consolidado em 2 colunas, células que encolhem', async () => {
    em390();
    const confirmado = semearDocumento(estado, corpoPorItemComDesconto(), { confirmar: true });
    await montar();
    await abrir(confirmado.id);
    await screen.findByTestId('consulta-lancamento');
    semRolagemHorizontal(screen.getByTestId('consulta-rateio-consolidado'));
    semRolagemHorizontal(screen.getByTestId('consulta-item-2-classificacao'));
    const linhas = [...screen.getByTestId('consulta-rateio-consolidado').querySelectorAll('[data-testid]')].filter((el) => /^consulta-rateio-consolidado-linha-\d+$/.test(el.getAttribute('data-testid')));
    expect(linhas).toHaveLength(2);
    for (const linha of linhas) {
      expect(linha.className).toMatch(/(^|\s)grid-cols-2(\s|$)/);
      for (const celula of linha.children) expect(celula.className).toMatch(/(^|\s)min-w-0(\s|$)/);
    }
  });
});

// ─── RIT-8 — revisão da P3-02 (achados da tela, RED → GREEN) ──────────────

/** Só serviços (sem mercadoria): dois itens de 50,00 e o geral 99,99 NUTRIÇÃO + 0,01 SANIDADE. */
const corpoGeralCentavo = () =>
  corpoGeral({
    data_operacional: undefined,
    efeito_fisico_confirmado: undefined,
    itens: [
      { tipo_item: 'SERVICO', unidade: 'UN', descricao: 'FRETE', quantidade: '1', valor_unitario: '50' },
      { tipo_item: 'SERVICO', unidade: 'UN', descricao: 'MAO DE OBRA', quantidade: '1', valor_unitario: '50' },
    ],
    rateios: [
      { natureza_id: 'nd1', valor: '99.99' },
      { natureza_id: 'nd2', valor: '0.01' },
    ],
    parcelas: [{ vencimento: '2026-11-08', valor: '100.00' }],
  });

describe('RIT-8 — revisão da P3-02: o rateio por item nunca perde nada em silêncio', () => {
  it('DIN-1: "usar a classificação geral" não tira uma natureza do documento: se uma linha do geral ficaria com zero num item, o proporcional é recusado com o motivo', async () => {
    const doc = semearDocumento(estado, corpoGeralCentavo());
    await montar();
    await abrir(doc.id);
    await editar();
    await radio('Por item');
    const dialogo = await screen.findByTestId('dialogo-escopo-por-item');
    // Sozinho, cada item dava 50,00 / 0,00: SANIDADE (0,01) sumia do documento sem aviso.
    expect(within(dialogo).getByTestId('escopo-por-item-proporcional')).toBeDisabled();
    expect(within(dialogo).getByTestId('escopo-por-item-motivo')).toHaveTextContent(/linha 2 do rateio geral \([^)]*SANIDADE\) ficaria com valor zero no item 1/);
    await clicar(within(dialogo).getByTestId('escopo-por-item-cancelar'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-escopo-por-item')).toBeNull());
    expect(screen.getByTestId('rateio-1-valor')).toHaveValue('0,01');
  });

  it('T1: depois de SALVAR por item o geral não existe mais no servidor: o diálogo avisa e a volta para "Geral" diz que ele começa em branco (nunca promete o que sumiu)', async () => {
    const perguntar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const doc = semearDocumento(estado, corpoGeral());
    await montar();
    await abrir(doc.id);
    await editar();
    await radio('Por item');
    const dialogo = await screen.findByTestId('dialogo-escopo-por-item');
    expect(dialogo).toHaveTextContent(/rateio geral continua guardado enquanto o rascunho não for salvo/i);
    expect(dialogo).toHaveTextContent(/ao salvar por item, o rateio geral deixa de existir/i);
    await clicar(within(dialogo).getByTestId('escopo-por-item-proporcional'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-escopo-por-item')).toBeNull());
    await salvar();
    await waitFor(() => expect(chamadas('PUT', `/operacoes-financeiras/${doc.id}`)).toHaveLength(1));
    await editar();
    await radio('Geral');
    expect(perguntar).toHaveBeenCalledTimes(1);
    expect(perguntar.mock.calls[0][0]).toMatch(/classificações por item serão descartadas/);
    expect(perguntar.mock.calls[0][0]).toMatch(/rateio geral começa em branco/);
    expect(perguntar.mock.calls[0][0]).not.toMatch(/volta como estava/);
    await waitFor(() => expect(screen.queryByTestId('rateio-item-0')).toBeNull());
    expect(screen.queryByTestId('rateio-1')).toBeNull();
  });

  it('T2: a recusa do servidor vale para o formulário ENVIADO: mover um item com o PUT no ar não leva o erro para o item errado', async () => {
    const doc = semearDocumento(estado, corpoPorItem());
    estado.falhas.editar = {
      umaVez: true,
      resposta: {
        status: 422,
        body: {
          code: 'OPERACAO_REFERENCIA_INVALIDA',
          message: 'texto do servidor (falso)',
          request_id: 'req_fake',
          field: 'natureza_id',
          reason: 'natureza_inativa',
          details: { field: 'natureza_id', reason: 'natureza_inativa', colecao: 'itens', indice: 1, subcolecao: 'rateios', subindice: 1, item_ordem: 2 },
        },
      },
    };
    let soltar = () => {};
    const segura = new Promise((r) => {
      soltar = r;
    });
    ajustarResposta = async (req, r) => {
      if (req.method === 'PUT') await segura;
      return r;
    };
    await montar();
    await abrir(doc.id);
    await editar();
    await salvar(); // enviado: item 2 = FRETE, linha 2 = ENERGIA
    await clicar(screen.getByRole('button', { name: 'Mover item 2 para cima' }));
    expect(screen.getByTestId('rateio-item-0-cabecalho')).toHaveTextContent(/FRETE/);
    await act(async () => {
      soltar();
    });
    await waitFor(() => expect(chamadas('PUT', `/operacoes-financeiras/${doc.id}`)).toHaveLength(1));
    const linha = await screen.findByTestId('rateio-item-0-linha-1');
    await waitFor(() => expect(within(linha).getByText(/natureza escolhida está inativa.*\(item 1, linha 2 do rateio\)/)).toBeTruthy());
    expect(naturezaDaLinha(0, 1)).toMatch(/ENERGIA/);
    expect(within(screen.getByTestId('rateio-item-1')).queryByText(/inativa/)).toBeNull();
  });

  it('T3: trocar o modo dentro do "Por item" não muda o modo do geral guardado: voltar para "Geral" traz 700,00/300,00 em valor', async () => {
    const doc = semearDocumento(estado, corpoGeral());
    await montar();
    await abrir(doc.id);
    await editar();
    await radio('Por item');
    await clicar(within(await screen.findByTestId('dialogo-escopo-por-item')).getByTestId('escopo-por-item-branco'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-escopo-por-item')).toBeNull());
    await radio('Por percentual');
    await radio('Geral');
    await waitFor(() => expect(screen.queryByTestId('rateio-item-0')).toBeNull());
    expect(screen.getByRole('radio', { name: 'Por valor' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('rateio-0-valor')).toHaveValue('700,00');
    expect(screen.getByTestId('rateio-1-valor')).toHaveValue('300,00');
  });

  it('T4: "Sem produtos" sempre volta ao rateio geral, mesmo sem itens; voltar para "Com produtos" começa em Geral', async () => {
    const doc = semearDocumento(estado, corpoPorItem());
    await montar();
    await abrir(doc.id);
    await editar();
    await clicar(screen.getByRole('button', { name: 'Remover item 2' }));
    await clicar(screen.getByRole('button', { name: 'Remover item 1' }));
    await radio('Sem produtos');
    await radio('Com produtos');
    const escopo = screen.getByTestId('escolha-escopo-rateio');
    expect(within(escopo).getByRole('radio', { name: 'Geral' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByTestId('dialogo-escopo-por-item')).toBeNull();
    expect(screen.queryByTestId('rateio-item-0')).toBeNull();
    expect(screen.getByTestId('rateio-0')).toBeTruthy();
  });

  it('T5: trocar a direção limpa a escolha de "aplicar a todos" (natureza de despesa não vai para uma venda)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const doc = semearDocumento(estado, corpoPorItem());
    await montar();
    await abrir(doc.id);
    await editar();
    await clicar(screen.getByTestId('abrir-aplicar-todos'));
    await escolher('seletor-natureza-todos', /NUTRIÇÃO/);
    expect(screen.getByTestId('aplicar-classificacao-todos')).not.toBeDisabled();
    await radio('A receber');
    await waitFor(() => expect(naturezaDaLinha(0, 0)).not.toMatch(/NUTRI/));
    expect(screen.getByTestId('seletor-natureza-todos').getAttribute('aria-label')).not.toMatch(/NUTRI/);
    expect(screen.getByTestId('aplicar-classificacao-todos')).toBeDisabled();
  });

  it('T6: "Adicionar linha" depois de remover até sobrar uma: a linha 1 fica com o líquido que estava à vista (não com um valor antigo)', async () => {
    const doc = semearDocumento(estado, corpoGeral());
    await montar();
    await abrir(doc.id);
    await editar();
    await radio('Por item');
    await clicar(within(await screen.findByTestId('dialogo-escopo-por-item')).getByTestId('escopo-por-item-proporcional'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-escopo-por-item')).toBeNull());
    expect(screen.getByTestId('rateio-item-0-linha-0-valor')).toHaveValue('420,00');
    await clicar(screen.getByRole('button', { name: 'Remover linha 2 do item 1' }));
    expect(screen.getByTestId('rateio-item-0-linha-0-valor-auto')).toHaveTextContent(/R\$\s600,00 \(100% do líquido\)/);
    await clicar(screen.getByTestId('rateio-item-0-adicionar'));
    expect(screen.getByTestId('rateio-item-0-linha-0-valor')).toHaveValue('600,00');
    expect(screen.getByTestId('rateio-item-0-linha-1-valor')).toHaveValue('');
  });

  it('T7: bloco recolhido não aponta aria-controls para um corpo que não está no DOM', async () => {
    const doc = semearDocumento(estado, corpoPorItem());
    await montar();
    await abrir(doc.id);
    await editar();
    const cabecalho = screen.getByTestId('rateio-item-0-cabecalho');
    const alvo = () => cabecalho.getAttribute('aria-controls');
    expect(document.getElementById(String(alvo()))).toBeTruthy();
    await clicar(cabecalho);
    expect(cabecalho).toHaveAttribute('aria-expanded', 'false');
    expect(alvo() === null || document.getElementById(alvo()) !== null).toBe(true);
  });
});
