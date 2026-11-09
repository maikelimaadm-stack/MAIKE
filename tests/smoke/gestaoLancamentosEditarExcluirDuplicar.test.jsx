/**
 * D-PROD-157 (Gestão P3-03) — EDITAR (corrigir confirmado), EXCLUIR (lógico) e
 * DUPLICAR na Central Única de Lançamentos, montada de verdade (página, motor
 * Base1, service, API, porta e nativeHttpClient reais). Mocks só da borda:
 * `fetch` (backend FALSO do contrato SPEC §3–§6,
 * tests/smoke/fixtures/lancamentosFakeCore.js), a sessão e o cache do Mapa
 * (IndexedDB não existe no jsdom).
 *
 *  DUP-* duplicar: detalhe completo do servidor → formulário NOVO, nada gravado
 *        até salvar, faixa, campos limpos, POR_ITEM preservado, troca de
 *        empresa no meio, moeda, referência recusada no campo, celular.
 *  EDT-* editar confirmado: elegibilidade ANTES, bloqueio legível,
 *        efeito_fisico_permitido=false, diálogo de motivo, 409 do comando,
 *        incerto/504, substituição → documento novo.
 *  EXC-* excluir confirmado: elegível, bloqueado, motivo + confirmação
 *        obrigatórios, nada no primeiro clique, distinto de Cancelar/Descartar.
 *  FIL-* filtro de situação do registro + selos; DET-* histórico de revisões;
 *  MOB-* 390 px sem rolagem horizontal; ERR-* e SVC-* mensagens e service.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { API_FAKE, escolherOpcao, instalarBackendFake } from './fixtures/gestaoBackendFake.js';
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
const permissaoCom = (acoes) => ({
  user_email: 'operador',
  modulos_permitidos: ['gestao-rural'],
  permissoes_telas: [
    { tela_id: 'ges-lancamentos-financeiros', visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes },
  ],
});

/** A pagar, sem produtos, à vista: 1.000,00 em NUTRIÇÃO (nd1). */
const corpoServico = (extra = {}) => ({
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

/**
 * Compra POR_ITEM parcelada (3×): 100 SACO de SAL MINERAL 80 × 50,00 (5.000,00:
 * 3.000 NUTRIÇÃO + 2.000 SANIDADE/CRIA) + frete 300,00 (ENERGIA); nº NF-77.
 */
const compraPorItem = (extra = {}) => ({
  empresa_id: 'emp-1',
  direcao: 'PAGAR',
  conteudo: 'COM_PRODUTOS',
  condicao: 'PARCELADO',
  parceiro_id: 'pa1',
  data_emissao: '2026-11-08',
  data_operacional: '2026-11-08',
  efeito_fisico_confirmado: true,
  documento_referencia: 'NF-77',
  descricao: 'COMPRA DE SAL',
  metodo_preferido: 'PIX',
  itens: [
    {
      tipo_item: 'MERCADORIA', produto_id: 'pr1', local_estoque_id: 'lo1', unidade: 'SACO', quantidade: '100', valor_unitario: '50',
      rateios: [{ natureza_id: 'nd1', valor: '3000.00' }, { natureza_id: 'nd2', centro_custo_id: 'cc1', valor: '2000.00' }],
    },
    { tipo_item: 'SERVICO', unidade: 'UN', descricao: 'FRETE', quantidade: '1', valor_unitario: '300', rateios: [{ natureza_id: 'nd3', valor: '300.00' }] },
  ],
  rateio_escopo: 'POR_ITEM',
  rateio_modo: 'VALOR',
  rateios: [],
  parcelas: [
    { vencimento: '2026-12-08', valor: '1766.66' },
    { vencimento: '2027-01-08', valor: '1766.67' },
    { vencimento: '2027-02-08', valor: '1766.67' },
  ],
  ...extra,
});

/** Compra GERAL à vista: 100 kg de MILHO MOÍDO × 6,00 (600,00), 1 linha NUTRIÇÃO (100% automático). */
const compraSimples = (extra = {}) => ({
  empresa_id: 'emp-1',
  direcao: 'PAGAR',
  conteudo: 'COM_PRODUTOS',
  condicao: 'AVISTA',
  parceiro_id: 'pa1',
  data_emissao: '2026-11-08',
  data_operacional: '2026-11-08',
  efeito_fisico_confirmado: true,
  itens: [{ tipo_item: 'MERCADORIA', produto_id: 'pr2', local_estoque_id: 'lo2', unidade: 'KG', quantidade: '100', valor_unitario: '6' }],
  rateio_escopo: 'GERAL',
  rateio_modo: 'VALOR',
  rateios: [{ natureza_id: 'nd1', valor: '600.00' }],
  parcelas: [{ vencimento: '2026-11-08', valor: '600.00' }],
  ...extra,
});

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
  return queryClient;
};

const chamadas = (method, re) => backend.chamadas.filter((c) => c.method === method && (typeof re === 'string' ? c.path === re : re.test(c.path)));
const escritas = () => backend.chamadas.filter((c) => c.method !== 'GET');
const clicar = async (el) => {
  await act(async () => {
    fireEvent.click(el);
  });
};
const digitar = (testId, valor, escopo = screen) => fireEvent.change(escopo.getByTestId(testId), { target: { value: valor } });
const abrir = async (id) => {
  fireEvent.doubleClick(await screen.findByTestId(`lancamento-numero-${id}`));
  await waitFor(() => expect(screen.queryByTestId('carregando-lancamento')).toBeNull());
};
const selecionarLinha = async (id) => {
  const celula = await screen.findByTestId(`lancamento-numero-${id}`);
  await clicar(within(celula.closest('tr')).getByLabelText('Selecionar linha'));
};
const barra = (nome) => screen.getByRole('button', { name: nome });
/** Celular (cards): marca o card do parceiro e abre pelo modo "Registro". */
const abrirPeloCard = async (parceiro) => {
  await clicar(await screen.findByLabelText(`Selecionar ${parceiro}`));
  await clicar(barra('Registro'));
  await waitFor(() => expect(screen.queryByTestId('carregando-lancamento')).toBeNull());
};
const naturezaDaLinha = (k, j) => screen.getByTestId(`seletor-natureza-item-${k}-${j}`).getAttribute('aria-label');
const toasts = () => [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent);
/** Comando direto no backend falso (como outra pessoa/aba faria). */
const comando = async (method, path, body = null) => {
  const r = await rotearLancamentos(estado, { method, path, query: new URLSearchParams(), body });
  expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
  return r.body;
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
/** Celular de verdade para o motor Base1: cards no lugar da tabela (max-width 639/767). */
const emCelular = (largura = 390) => {
  window.innerWidth = largura;
  window.matchMedia = vi.fn().mockImplementation((q) => {
    const max = /max-width:\s*(\d+)px/.exec(q);
    const min = /min-width:\s*(\d+)px/.exec(q);
    return {
      matches: (!max || largura <= Number(max[1])) && (!min || largura >= Number(min[1])),
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
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
  sessao.permissao = permissaoCom(TODAS);
  window.localStorage.setItem('empresa_selecionada_id', 'emp-1');
  window.localStorage.setItem('empresa_selecionada_cliente_id', sessao.clienteId);
  estado = criarEstadoLancamentos();
  backend = instalarBackendFake(async (req) => {
    if (req.method === 'GET' && req.query.get('empresa_id') && req.query.get('empresa_id') !== 'emp-1') {
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
  window.matchMedia = matchMediaOriginal;
  window.innerWidth = 1024;
});

// ─── DUPLICAR ────────────────────────────────────────────────────────────

describe('DUP — Duplicar abre um formulário NOVO a partir do detalhe completo do servidor', () => {
  it('DUP-1 desktop: compra POR_ITEM confirmada → faixa, campos de identidade limpos, POR_ITEM nas chaves novas; nada gravado até Salvar; POST com duplicado_de_id', async () => {
    const origem = semearDocumento(estado, compraPorItem(), { confirmar: true });
    const antes = JSON.stringify(origem);
    await montar();
    await selecionarLinha(origem.id);
    const getsAntes = chamadas('GET', `/operacoes-financeiras/${origem.id}`).length;
    await clicar(barra('Duplicar'));

    const faixa = await screen.findByTestId('faixa-copia');
    expect(faixa).toHaveTextContent(`Cópia do lançamento nº ${origem.numero} — novo rascunho`);
    // Sempre o DETALHE do servidor da empresa atual (nunca o resumo da lista).
    const lidos = chamadas('GET', `/operacoes-financeiras/${origem.id}`);
    expect(lidos.length).toBe(getsAntes + 1);
    expect(lidos.at(-1).query).toEqual({ empresa_id: 'emp-1' });
    expect(escritas(), 'clicar em Duplicar não grava nada').toEqual([]);

    // Conteúdo copiado; identidade e estado não.
    expect(screen.getByRole('radio', { name: 'Parcelado' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Por item' })).toBeChecked();
    expect(naturezaDaLinha(0, 0)).toMatch(/NUTRIÇÃO/);
    expect(naturezaDaLinha(0, 1)).toMatch(/SANIDADE/);
    expect(naturezaDaLinha(1, 0)).toMatch(/ENERGIA/);
    expect(screen.getByTestId('declaracao-efeito-fisico')).not.toBeChecked();
    expect(screen.getByPlaceholderText('NOTA, RECIBO…')).toHaveValue('');
    expect(screen.getByLabelText(/Histórico \(descrição\)/)).toHaveValue('COMPRA DE SAL');
    expect(screen.queryByTestId('consulta-lancamento')).toBeNull();

    // Salvar sem a declaração: o formulário pede (sem envio).
    await clicar(barra('Salvar'));
    expect(escritas()).toEqual([]);
    await clicar(screen.getByTestId('declaracao-efeito-fisico'));
    await clicar(barra('Salvar'));
    await waitFor(() => expect(chamadas('POST', '/operacoes-financeiras')).toHaveLength(1));
    const corpo = chamadas('POST', '/operacoes-financeiras')[0].body;
    expect(corpo).toMatchObject({
      empresa_id: 'emp-1',
      duplicado_de_id: origem.id,
      direcao: 'PAGAR',
      conteudo: 'COM_PRODUTOS',
      condicao: 'PARCELADO',
      parceiro_id: 'pa1',
      descricao: 'COMPRA DE SAL',
      metodo_preferido: 'PIX',
      data_operacional: '2026-11-08',
      efeito_fisico_confirmado: true,
      rateio_escopo: 'POR_ITEM',
      rateio_modo: 'VALOR',
      rateios: [],
      parcelas: compraPorItem().parcelas,
    });
    expect(corpo.operation_id).toMatch(/^lanc-/);
    for (const proibido of ['documento_referencia', 'id', 'numero', 'versao', 'status', 'titulos', 'historico', 'eventos', 'confirmado_em']) expect(corpo).not.toHaveProperty(proibido);
    expect(corpo.itens).toEqual([
      { tipo_item: 'MERCADORIA', unidade: 'SACO', quantidade: '100', valor_unitario: '50', produto_id: 'pr1', local_estoque_id: 'lo1', rateios: [{ natureza_id: 'nd1', valor: '3000.00' }, { natureza_id: 'nd2', centro_custo_id: 'cc1', valor: '2000.00' }] },
      { tipo_item: 'SERVICO', unidade: 'UN', quantidade: '1', valor_unitario: '300', descricao: 'FRETE', rateios: [{ natureza_id: 'nd3', valor: '300.00' }] },
    ]);
    // Novo documento independente; a origem não mudou; proveniência só na auditoria.
    const novo = estado.documentos.find((d) => d.id !== origem.id);
    expect(novo).toMatchObject({ status: 'RASCUNHO', documento_referencia: null });
    expect(novo.numero).not.toBe(origem.numero);
    expect(novo.titulos.every((t) => t.status === 'PREVISTO')).toBe(true);
    expect(JSON.stringify(estado.documentos.find((d) => d.id === origem.id))).toBe(antes);
    expect(estado.auditoria.at(-1)).toMatchObject({ acao: 'operacao_financeira.criar', operacao_id: novo.id, duplicado_de_id: origem.id });
    await waitFor(() => expect(toasts().join(' | ')).toMatch(/Cópia salva como rascunho novo/));
  });

  it('DUP-2 do detalhe: rascunho e cancelado também duplicam (sem clonar status/efeitos); "Novo" depois começa em branco', async () => {
    const cancelado = semearDocumento(estado, corpoServico({ documento_referencia: 'REC-9', descricao: 'LUZ OUTUBRO' }), { confirmar: true });
    await comando('POST', `/operacoes-financeiras/${cancelado.id}/cancelar`, { empresa_id: 'emp-1', operation_id: 'op-cancelar-1', motivo: 'Teste' });
    await montar();
    await abrir(cancelado.id);
    expect(await screen.findByTestId('status-lancamento')).toHaveTextContent('Cancelado');
    await clicar(barra('Duplicar'));
    expect(await screen.findByTestId('faixa-copia')).toHaveTextContent(`Cópia do lançamento nº ${cancelado.numero} — novo rascunho`);
    expect(screen.getByLabelText(/Histórico \(descrição\)/)).toHaveValue('LUZ OUTUBRO');
    expect(screen.getByTestId('valor-bruto')).toHaveValue('1.000,00');
    expect(escritas().filter((c) => c.path === '/operacoes-financeiras')).toEqual([]);
    // ✕ volta à consulta da origem (nada criado); "Novo" é formulário em branco, sem a cópia.
    await clicar(barra('Cancelar'));
    expect(await screen.findByTestId('consulta-lancamento')).toBeTruthy();
    await clicar(barra('Novo'));
    await screen.findByTestId('b1-form');
    expect(screen.queryByTestId('faixa-copia')).toBeNull();
    expect(screen.getByTestId('valor-bruto')).toHaveValue('');
    expect(escritas().filter((c) => c.method === 'POST' && c.path === '/operacoes-financeiras')).toEqual([]);
  });

  it('DUP-2b rascunho também duplica; duplo clique em Duplicar = 1 leitura e 1 formulário; salvar cria 1 rascunho novo', async () => {
    const rascunho = semearDocumento(estado, corpoServico({ descricao: 'ORIGEM RASCUNHO' }));
    await montar();
    await selecionarLinha(rascunho.id);
    const botao = barra('Duplicar');
    await act(async () => {
      fireEvent.click(botao);
      fireEvent.click(botao);
    });
    await screen.findByTestId('faixa-copia');
    expect(chamadas('GET', `/operacoes-financeiras/${rascunho.id}`)).toHaveLength(1);
    expect(screen.getAllByTestId('faixa-copia')).toHaveLength(1);
    await clicar(barra('Salvar'));
    await waitFor(() => expect(estado.documentos).toHaveLength(2));
    expect(chamadas('POST', '/operacoes-financeiras')).toHaveLength(1);
    expect(estado.documentos.find((d) => d.id !== rascunho.id)).toMatchObject({ status: 'RASCUNHO', descricao: 'ORIGEM RASCUNHO' });
  });

  it('DUP-3 sem a permissão "novo/salvar" não há Duplicar (ver basta para consultar)', async () => {
    sessao.permissao = permissaoCom({ editar: true, confirmar: true, cancelar: true });
    const doc = semearDocumento(estado, corpoServico(), { confirmar: true });
    await montar();
    await selecionarLinha(doc.id);
    expect(screen.queryByRole('button', { name: 'Duplicar' })).toBeNull();
  });

  it('DUP-4 troca de empresa com a leitura no ar: a resposta antiga é descartada (nenhuma cópia stale da empresa anterior)', async () => {
    const doc = semearDocumento(estado, corpoServico(), { confirmar: true });
    let soltar;
    await montar();
    await selecionarLinha(doc.id);
    estado.segurarDetalhe = new Promise((r) => {
      soltar = r;
    });
    await clicar(barra('Duplicar'));
    await waitFor(() => expect(chamadas('GET', `/operacoes-financeiras/${doc.id}`)).toHaveLength(1));
    const { persistirEmpresaSelecionada } = await import('@/hooks/useEmpresaSelecionadaId');
    act(() => persistirEmpresaSelecionada('emp-2', 'cli-1'));
    await waitFor(() => expect(chamadas('GET', '/operacoes-financeiras').some((c) => c.query.empresa_id === 'emp-2')).toBe(true));
    await act(async () => {
      soltar();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.queryByTestId('faixa-copia')).toBeNull();
    expect(screen.queryByTestId('b1-form')).toBeNull();
    expect(escritas()).toEqual([]);
  });

  it('DUP-4b leitura do detalhe sem resposta: aviso de leitura (nunca "pode ter sido gravado"), nenhum formulário, nada gravado', async () => {
    const doc = semearDocumento(estado, corpoServico(), { confirmar: true });
    await montar();
    await selecionarLinha(doc.id);
    estado.falhas.detalhe = { umaVez: true };
    await clicar(barra('Duplicar'));
    await waitFor(() => expect(toasts().join(' | ')).toMatch(/Não foi possível ler o lançamento de origem\. Nada foi gravado\. Verifique a conexão/));
    expect(toasts().join(' | ')).not.toMatch(/pode ter sido gravado|Resultado incerto/);
    expect(screen.queryByTestId('faixa-copia')).toBeNull();
    expect(escritas()).toEqual([]);
    // Elegibilidade sem resposta: idem (Editar não abre nada).
    estado.falhas.elegibilidade = { umaVez: true };
    await clicar(barra('Editar'));
    await waitFor(() => expect(toasts().join(' | ')).toMatch(/Não foi possível verificar o lançamento agora\. Nada foi alterado\. Verifique a conexão/));
    expect(screen.queryByTestId('faixa-correcao')).toBeNull();
    expect(screen.queryByTestId('dialogo-bloqueio')).toBeNull();
  });

  it('DUP-5 moeda do perfil diferente da origem: a cópia não converte valores (recusa, nada aberto)', async () => {
    const doc = semearDocumento(estado, corpoServico(), { confirmar: true });
    estado.perfil = { ...estado.perfil, pais: 'PY', moeda: 'PYG', moeda_casas: 0, locale: 'es-PY', metodos_permitidos: ['DINHEIRO', 'TRANSFERENCIA', 'CARTAO', 'OUTRO'] };
    await montar();
    await selecionarLinha(doc.id);
    await clicar(barra('Duplicar'));
    await waitFor(() => expect(toasts().join(' | ')).toMatch(/a cópia não converte valores/));
    expect(screen.queryByTestId('faixa-copia')).toBeNull();
    expect(escritas()).toEqual([]);
  });

  it('DUP-6 referência que ficou inativa: o servidor recusa ao salvar e o campo do parceiro mostra o motivo (nada gravado)', async () => {
    const doc = semearDocumento(estado, corpoServico(), { confirmar: true });
    estado.falhas.criar = {
      umaVez: true,
      resposta: { status: 422, body: { code: 'OPERACAO_REFERENCIA_INVALIDA', message: 'x', request_id: 'r', field: 'parceiro_id', reason: 'parceiro_inativo', details: { field: 'parceiro_id', reason: 'parceiro_inativo' } } },
    };
    await montar();
    await selecionarLinha(doc.id);
    await clicar(barra('Duplicar'));
    await screen.findByTestId('faixa-copia');
    await clicar(barra('Salvar'));
    const form = screen.getByTestId('b1-form');
    expect(await within(form).findByText(/O parceiro escolhido está inativo/)).toBeTruthy();
    expect(estado.documentos).toHaveLength(1);
    expect(screen.getByTestId('faixa-copia')).toBeTruthy();
  });

  it('DUP-6b produto da origem que saiu da empresa: a recusa aponta o seletor de produto do item (pela chave do item)', async () => {
    const doc = semearDocumento(estado, compraSimples(), { confirmar: true });
    estado.falhas.criar = {
      umaVez: true,
      resposta: {
        status: 422,
        body: { code: 'OPERACAO_REFERENCIA_INVALIDA', message: 'x', request_id: 'r', field: 'produto_id', reason: 'produto_nao_encontrado', details: { field: 'produto_id', reason: 'produto_nao_encontrado', colecao: 'itens', indice: 0 } },
      },
    };
    await montar();
    await selecionarLinha(doc.id);
    await clicar(barra('Duplicar'));
    await screen.findByTestId('faixa-copia');
    await clicar(screen.getByTestId('declaracao-efeito-fisico'));
    await clicar(barra('Salvar'));
    const form = screen.getByTestId('b1-form');
    const msg = await within(form).findByText(/O produto escolhido não existe mais nesta empresa/);
    expect(msg.textContent).not.toMatch(/Nada foi gravado/);
    expect(estado.documentos).toHaveLength(1);
  });

  it('DUP-7 celular (390 px, cards): duplicar pelo card; a faixa não força largura; nada gravado até o ✓', async () => {
    emCelular(390);
    const doc = semearDocumento(estado, compraPorItem(), { confirmar: true });
    await montar();
    await clicar(await screen.findByLabelText('Selecionar AGROPECUÁRIA BOA VISTA'));
    await clicar(barra('Duplicar'));
    const faixa = await screen.findByTestId('faixa-copia');
    expect(faixa).toHaveTextContent(`Cópia do lançamento nº ${doc.numero} — novo rascunho`);
    semRolagemHorizontal(faixa);
    expect(escritas()).toEqual([]);
    expect(naturezaDaLinha(1, 0)).toMatch(/ENERGIA/);
    await clicar(screen.getByTestId('declaracao-efeito-fisico'));
    await act(async () => {
      fireEvent.submit(screen.getByTestId('b1-form'));
    });
    await waitFor(() => expect(chamadas('POST', '/operacoes-financeiras')).toHaveLength(1));
    expect(chamadas('POST', '/operacoes-financeiras')[0].body.duplicado_de_id).toBe(doc.id);
  });
});

// ─── EDITAR CONFIRMADO ───────────────────────────────────────────────────

describe('EDT — Editar confirmado: elegibilidade antes, mesmo formulário, motivo e /retificar', () => {
  it('EDT-1 permitido (só informativo): elegibilidade ANTES do formulário; faixa; motivo obrigatório; /retificar com a versao do detalhe; NO_LUGAR mantém o estoque', async () => {
    const doc = semearDocumento(estado, compraPorItem(), { confirmar: true });
    const movimento = doc.itens[0].movimentacao_estoque_id;
    await montar();
    await abrir(doc.id);
    expect(await screen.findByTestId('consulta-lancamento')).toBeTruthy();
    expect(chamadas('GET', /\/elegibilidade$/)).toHaveLength(0);
    await clicar(barra('Editar'));
    const faixa = await screen.findByTestId('faixa-correcao');
    expect(faixa).toHaveTextContent(`Correção de lançamento confirmado — nº ${doc.numero}`);
    expect(screen.queryByTestId('faixa-correcao-sem-estoque')).toBeNull();
    const ordem = backend.chamadas.map((c) => `${c.method} ${c.path}`);
    expect(ordem.indexOf(`GET /operacoes-financeiras/${doc.id}/elegibilidade`)).toBeGreaterThan(-1);
    expect(escritas()).toEqual([]);
    // O MESMO formulário completo, com o rateio por item e as parcelas.
    expect(screen.getByRole('radio', { name: 'Por item' })).toBeChecked();
    expect(naturezaDaLinha(0, 1)).toMatch(/SANIDADE/);
    expect(screen.getByPlaceholderText('NOTA, RECIBO…')).toHaveValue('NF-77');
    expect(screen.queryByTestId('botao-confirmar-lancamento')).toBeNull();
    expect(screen.queryByTestId('botao-descartar-rascunho')).toBeNull();

    // Sem mudança nenhuma não há o que corrigir (nada abre, nada sai).
    await clicar(screen.getByTestId('botao-salvar-correcao'));
    expect(screen.queryByTestId('dialogo-retificacao')).toBeNull();
    await waitFor(() => expect(toasts().join(' | ')).toMatch(/Nenhum campo do lançamento foi alterado/));
    fireEvent.change(screen.getByLabelText(/Histórico \(descrição\)/), { target: { value: 'COMPRA DE SAL MINERAL' } });
    expect(screen.getByTestId('previsao-correcao')).toHaveTextContent(/não muda o estoque/);
    await clicar(screen.getByTestId('botao-salvar-correcao'));
    const dialogo = await screen.findByTestId('dialogo-retificacao');
    expect(within(dialogo).getByTestId('dialogo-retificacao-estoque')).toHaveTextContent(/O estoque não muda/);
    expect(within(dialogo).getByTestId('dialogo-retificacao-efeitos')).toHaveTextContent(/parcelas .* recriadas/);
    const enviar = within(dialogo).getByTestId('dialogo-retificacao-enviar');
    expect(enviar).toBeDisabled();
    expect(escritas()).toEqual([]);
    fireEvent.change(within(dialogo).getByTestId('dialogo-retificacao-motivo'), { target: { value: 'Descrição incompleta' } });
    await clicar(enviar);
    await waitFor(() => expect(screen.queryByTestId('dialogo-retificacao')).toBeNull());

    const envios = chamadas('POST', `/operacoes-financeiras/${doc.id}/retificar`);
    expect(envios).toHaveLength(1);
    expect(envios[0].body).toMatchObject({ empresa_id: 'emp-1', versao: 2, motivo: 'Descrição incompleta', descricao: 'COMPRA DE SAL MINERAL', documento_referencia: 'NF-77', rateio_escopo: 'POR_ITEM', efeito_fisico_confirmado: true });
    expect(envios[0].body.operation_id).toMatch(/^lanc-/);
    expect(await screen.findByTestId('status-lancamento')).toHaveTextContent('Confirmado');
    const evento = await screen.findByTestId('evento-revisao-0');
    expect(evento).toHaveTextContent(/Correção no lugar/);
    expect(evento).toHaveTextContent(/versão 2 → 3/);
    expect(evento).toHaveTextContent(/Descrição incompleta/);
    expect(estado.documentos.find((d) => d.id === doc.id).itens[0].movimentacao_estoque_id).toBe(movimento);
    expect(mapa.refresh).not.toHaveBeenCalled();
    await waitFor(() => expect(toasts().join(' | ')).toMatch(/corrigido \(versão 3\); o estoque não mudou/));
  });

  it('EDT-2 bloqueado por baixa (inclusive estornada): diálogo com o motivo legível, sem formulário e sem envio', async () => {
    const doc = semearDocumento(estado, corpoServico(), { confirmar: true });
    const liq = await comando('POST', `/titulos-financeiros/${doc.titulos[0].id}/liquidacoes`, { empresa_id: 'emp-1', operation_id: 'op-liq-1', valor: '100.00', data: '2026-11-08', metodo: 'PIX' });
    await comando('POST', `/liquidacoes-financeiras/${liq.titulos[0].liquidacoes[0].id}/estorno`, { empresa_id: 'emp-1', operation_id: 'op-est-1', motivo: 'Errado' });
    await montar();
    await abrir(doc.id);
    await clicar(barra('Editar'));
    const dialogo = await screen.findByTestId('dialogo-bloqueio');
    expect(dialogo).toHaveTextContent('Correção bloqueada');
    expect(within(dialogo).getByTestId('dialogo-bloqueio-motivos')).toHaveTextContent(/A parcela nº 1 tem pagamento\/recebimento registrado \(já estornada/);
    expect(dialogo).toHaveTextContent(/use Duplicar/);
    expect(screen.queryByTestId('faixa-correcao')).toBeNull();
    expect(chamadas('POST', /\/retificar$/)).toHaveLength(0);
    await clicar(within(dialogo).getByTestId('dialogo-bloqueio-fechar'));
    expect(screen.getByTestId('consulta-lancamento')).toBeTruthy();
  });

  it('EDT-3 sem a permissão "confirmar": o motivo é "sem permissão" (não mascarado); sem "editar" o botão nem aparece', async () => {
    sessao.permissao = permissaoCom({ ...TODAS, confirmar: false });
    estado.permissoes.confirmar = false;
    const doc = semearDocumento(estado, corpoServico(), { confirmar: true });
    await montar();
    await abrir(doc.id);
    await clicar(barra('Editar'));
    const dialogo = await screen.findByTestId('dialogo-bloqueio');
    expect(dialogo).toHaveTextContent(/Você não tem a permissão “Confirmar”/);
    expect(dialogo).not.toHaveTextContent(/parcela/);
    cleanup();
    sessao.permissao = permissaoCom({ ...TODAS, editar: false, salvar: false });
    await montar();
    await abrir(doc.id);
    await screen.findByTestId('consulta-lancamento');
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
  });

  it('EDT-4 efeito_fisico_permitido=false: a faixa avisa o que não pode mudar (com o motivo); mudar a quantidade não envia; só informativo vai', async () => {
    const doc = semearDocumento(estado, compraSimples(), { confirmar: true });
    estado.dependencias[doc.id] = [{ codigo: 'lote_consumido', mensagem: 'lote consumido', entidade: 'MovimentacaoEstoque', numero: '45', item_ordem: 1 }];
    await montar();
    await abrir(doc.id);
    await clicar(barra('Editar'));
    const aviso = await screen.findByTestId('faixa-correcao-sem-estoque');
    expect(aviso).toHaveTextContent(/o estoque não pode mudar: produtos, quantidades, locais, unidades, data de recebimento\/entrega e custos/);
    expect(aviso).toHaveTextContent(/A mercadoria do item 1 já foi usada no estoque \(movimento nº 45\)/);
    digitar('item-0-quantidade', '120');
    expect(await screen.findByTestId('correcao-bloqueio-fisico')).toHaveTextContent(/item 1: quantidade/);
    await clicar(screen.getByTestId('botao-salvar-correcao'));
    expect(screen.queryByTestId('dialogo-retificacao')).toBeNull();
    expect(escritas()).toEqual([]);
    digitar('item-0-quantidade', '100');
    expect(screen.queryByTestId('correcao-bloqueio-fisico')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Histórico \(descrição\)/), { target: { value: 'MILHO DA SAFRA' } });
    await clicar(screen.getByTestId('botao-salvar-correcao'));
    const dialogo = await screen.findByTestId('dialogo-retificacao');
    expect(within(dialogo).getByTestId('dialogo-retificacao-estoque')).toHaveTextContent(/O estoque não muda/);
    fireEvent.change(within(dialogo).getByTestId('dialogo-retificacao-motivo'), { target: { value: 'Histórico' } });
    await clicar(within(dialogo).getByTestId('dialogo-retificacao-enviar'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-retificacao')).toBeNull());
    expect(estado.eventos.map((e) => e.modo)).toEqual(['NO_LUGAR']);
  });

  it('EDT-5 substituição: a quantidade muda → diálogo avisa estorno + nova entrada; a tela passa a mostrar o documento NOVO (mesmo nº) e avisa o estoque', async () => {
    const doc = semearDocumento(estado, compraSimples(), { confirmar: true });
    const eventos = [];
    window.addEventListener('atualizar-mapa', (e) => eventos.push(e));
    await montar();
    await abrir(doc.id);
    await clicar(barra('Editar'));
    await screen.findByTestId('faixa-correcao');
    digitar('item-0-quantidade', '120');
    expect(screen.getByTestId('previsao-correcao')).toHaveTextContent(/muda o estoque \(item 1: quantidade; item 1: custo/);
    await clicar(screen.getByTestId('botao-salvar-correcao'));
    const dialogo = await screen.findByTestId('dialogo-retificacao');
    expect(within(dialogo).getByTestId('dialogo-retificacao-estoque')).toHaveTextContent(/O estoque muda: a entrada anterior é estornada e uma nova entrada é registrada/);
    fireEvent.change(within(dialogo).getByTestId('dialogo-retificacao-motivo'), { target: { value: 'Chegaram 120 kg' } });
    await clicar(within(dialogo).getByTestId('dialogo-retificacao-enviar'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-retificacao')).toBeNull());

    const novo = estado.documentos.find((d) => d.id !== doc.id);
    const antigo = estado.documentos.find((d) => d.id === doc.id);
    expect(antigo).toMatchObject({ status: 'CANCELADO', numero: `${novo.numero}/r2`, retificado_em: expect.any(String) });
    expect(novo).toMatchObject({ status: 'CONFIRMADO', versao: 3, valor_total: '720.00' });
    // A tela mostra o documento NOVO (operacao_atual_id), com o MESMO número.
    const substitui = await screen.findByTestId('aviso-substitui');
    expect(substitui).toHaveTextContent(`substitui a versão anterior (nº ${novo.numero}/r2)`);
    expect(screen.getByTestId('consulta-total')).toHaveTextContent(/720,00/);
    expect(mapa.refresh).toHaveBeenCalledWith('estoqueLotes', 'emp-1', { force: true });
    expect(eventos.length).toBeGreaterThan(0);
    // Link para a versão anterior e de volta.
    await clicar(screen.getByTestId('link-versao-anterior'));
    const substituido = await screen.findByTestId('aviso-substituido');
    expect(screen.getByTestId('status-lancamento')).toHaveTextContent('Substituído');
    expect(substituido).toHaveTextContent(`o lançamento atual é o nº ${novo.numero}`);
    await clicar(screen.getByTestId('link-lancamento-atual'));
    expect(await screen.findByTestId('aviso-substitui')).toBeTruthy();
  });

  it('EDT-6 elegibilidade mudou depois do clique (baixa registrada em outra aba): 409 OPERACAO_RETIFICACAO_BLOQUEADA com os motivos no diálogo; nada mudou', async () => {
    const doc = semearDocumento(estado, corpoServico(), { confirmar: true });
    await montar();
    await abrir(doc.id);
    await clicar(barra('Editar'));
    await screen.findByTestId('faixa-correcao');
    await comando('POST', `/titulos-financeiros/${doc.titulos[0].id}/liquidacoes`, { empresa_id: 'emp-1', operation_id: 'op-liq-2', valor: '10.00', data: '2026-11-08', metodo: 'PIX' });
    fireEvent.change(screen.getByLabelText(/Histórico \(descrição\)/), { target: { value: 'ENERGIA DE OUTUBRO' } });
    await clicar(screen.getByTestId('botao-salvar-correcao'));
    const dialogo = await screen.findByTestId('dialogo-retificacao');
    fireEvent.change(within(dialogo).getByTestId('dialogo-retificacao-motivo'), { target: { value: 'Ajuste' } });
    await clicar(within(dialogo).getByTestId('dialogo-retificacao-enviar'));
    const erro = await within(dialogo).findByTestId('erro-envio');
    expect(erro).toHaveTextContent(/A correção foi recusada pelo servidor:/);
    expect(erro).toHaveTextContent(/A parcela nº 1 tem pagamento\/recebimento registrado/);
    expect(erro).toHaveTextContent(/Nada foi alterado/);
    expect(estado.eventos).toEqual([]);
    expect(estado.documentos.find((d) => d.id === doc.id).versao).toBe(2);
  });

  it('EDT-7 504 depois do COMMIT: "resultado incerto"; repetir reusa o MESMO operation_id (replay, uma correção só)', async () => {
    const doc = semearDocumento(estado, corpoServico(), { confirmar: true });
    estado.falhas.retificar = { gravarAntes: true, umaVez: true, resposta: { status: 504, body: 'An error occurred with your deployment. FUNCTION_INVOCATION_TIMEOUT' } };
    await montar();
    await abrir(doc.id);
    await clicar(barra('Editar'));
    await screen.findByTestId('faixa-correcao');
    fireEvent.change(screen.getByLabelText(/Histórico \(descrição\)/), { target: { value: 'NOVA DESCRIÇÃO' } });
    await clicar(screen.getByTestId('botao-salvar-correcao'));
    const dialogo = await screen.findByTestId('dialogo-retificacao');
    fireEvent.change(within(dialogo).getByTestId('dialogo-retificacao-motivo'), { target: { value: 'Texto' } });
    await clicar(within(dialogo).getByTestId('dialogo-retificacao-enviar'));
    const incerto = await within(dialogo).findByTestId('resultado-incerto');
    expect(incerto).not.toHaveTextContent(/Nada foi gravado/);
    expect(toasts().join(' | ')).not.toMatch(/corrigido/);
    await clicar(within(dialogo).getByRole('button', { name: 'Repetir o mesmo envio' }));
    await waitFor(() => expect(screen.queryByTestId('dialogo-retificacao')).toBeNull());
    const envios = chamadas('POST', /\/retificar$/);
    expect(envios).toHaveLength(2);
    expect(envios[1].body.operation_id).toBe(envios[0].body.operation_id);
    expect(estado.eventos).toHaveLength(1);
    await waitFor(() => expect(toasts().join(' | ')).toMatch(/envio repetido: nada foi duplicado/));
  });

  it('EDT-8 504 + "Consultar lançamento": a correção aparece (versão nova) e a tela mostra o estado real', async () => {
    const doc = semearDocumento(estado, corpoServico(), { confirmar: true });
    estado.falhas.retificar = { gravarAntes: true, umaVez: true, resposta: { status: 504, body: 'FUNCTION_INVOCATION_TIMEOUT' } };
    await montar();
    await abrir(doc.id);
    await clicar(barra('Editar'));
    await screen.findByTestId('faixa-correcao');
    fireEvent.change(screen.getByLabelText(/Histórico \(descrição\)/), { target: { value: 'CONSULTADA' } });
    await clicar(screen.getByTestId('botao-salvar-correcao'));
    const dialogo = await screen.findByTestId('dialogo-retificacao');
    fireEvent.change(within(dialogo).getByTestId('dialogo-retificacao-motivo'), { target: { value: 'Texto' } });
    await clicar(within(dialogo).getByTestId('dialogo-retificacao-enviar'));
    await clicar(await within(dialogo).findByTestId('botao-consultar-resultado'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-retificacao')).toBeNull());
    expect(await screen.findByTestId('evento-revisao-0')).toHaveTextContent(/Correção no lugar/);
    expect(screen.queryByTestId('faixa-correcao')).toBeNull();
    expect(chamadas('POST', /\/retificar$/)).toHaveLength(1);
  });
});

// ─── EXCLUIR CONFIRMADO ──────────────────────────────────────────────────

describe('EXC — Excluir confirmado: elegibilidade, efeitos, motivo e confirmação explícita', () => {
  it('EXC-1 elegível (compra com mercadoria): nada no 1º clique; motivo + confirmação obrigatórios; /excluir; aparece Excluído e sai da lista operacional', async () => {
    const doc = semearDocumento(estado, compraSimples(), { confirmar: true });
    const eventos = [];
    window.addEventListener('atualizar-mapa', (e) => eventos.push(e));
    await montar();
    await abrir(doc.id);
    // Três ações distintas: Excluir ≠ Cancelar ≠ Descartar rascunho.
    expect(screen.getByTestId('botao-cancelar-lancamento')).toHaveTextContent('Cancelar lançamento');
    expect(screen.queryByTestId('botao-descartar-rascunho')).toBeNull();
    await clicar(screen.getByTestId('botao-excluir-lancamento'));
    const dialogo = await screen.findByTestId('dialogo-exclusao');
    expect(chamadas('GET', `/operacoes-financeiras/${doc.id}/elegibilidade`)).toHaveLength(1);
    expect(escritas(), 'o primeiro clique não chama o endpoint').toEqual([]);
    expect(within(dialogo).getByTestId('dialogo-exclusao-efeitos')).toHaveTextContent(/A parcela é cancelada/);
    expect(within(dialogo).getByTestId('dialogo-exclusao-efeitos')).toHaveTextContent(/A entrada da mercadoria no estoque é estornada/);
    expect(dialogo).toHaveTextContent(/Não é Cancelar/);
    const enviar = within(dialogo).getByTestId('dialogo-exclusao-enviar');
    expect(enviar).toBeDisabled();
    fireEvent.change(within(dialogo).getByTestId('dialogo-exclusao-motivo'), { target: { value: 'Lançado em dobro' } });
    expect(enviar, 'falta a confirmação explícita').toBeDisabled();
    await clicar(within(dialogo).getByTestId('dialogo-exclusao-ciente'));
    expect(enviar).toBeEnabled();
    await clicar(enviar);
    await waitFor(() => expect(screen.queryByTestId('dialogo-exclusao')).toBeNull());

    const envios = chamadas('POST', `/operacoes-financeiras/${doc.id}/excluir`);
    expect(envios).toHaveLength(1);
    expect(envios[0].body).toEqual({ empresa_id: 'emp-1', operation_id: expect.stringMatching(/^lanc-/), versao: 2, motivo: 'Lançado em dobro' });
    expect(await screen.findByTestId('status-lancamento')).toHaveTextContent('Excluído');
    expect(screen.getByTestId('aviso-excluido')).toHaveTextContent(/Motivo: Lançado em dobro/);
    expect(screen.getByTestId('aviso-excluido')).toHaveTextContent(/dono/);
    expect(screen.queryByTestId('botao-cancelar-lancamento')).toBeNull();
    expect(screen.queryByTestId('botao-excluir-lancamento')).toBeNull();
    const salvo = estado.documentos.find((d) => d.id === doc.id);
    expect(salvo).toMatchObject({ status: 'CANCELADO', excluido_em: expect.any(String), motivo_cancelamento: 'Excluído: Lançado em dobro' });
    expect(salvo.titulos.every((t) => t.status === 'CANCELADO')).toBe(true);
    expect(salvo.itens[0].movimentacao_estoque_id).toBeTruthy();
    expect(salvo.itens[0].movimentacao_estorno_id).toBeTruthy();
    expect(mapa.refresh).toHaveBeenCalledWith('estoqueLotes', 'emp-1', { force: true });
    expect(eventos.length).toBeGreaterThan(0);
    // Fora da lista operacional (padrão); está em "Excluídos".
    await clicar(barra('Tabela'));
    await waitFor(() => expect(screen.queryByTestId(`lancamento-numero-${doc.id}`)).toBeNull());
    await escolherOpcao(screen.getByRole('combobox', { name: 'Filtrar por situação do registro' }), 'Excluídos');
    expect(await screen.findByTestId(`lancamento-situacao-${doc.id}`)).toHaveTextContent('Excluído');
  });

  it('EXC-2 bloqueado (baixa ativa): motivos legíveis, nenhum envio, nada muda', async () => {
    const doc = semearDocumento(estado, corpoServico(), { confirmar: true });
    await comando('POST', `/titulos-financeiros/${doc.titulos[0].id}/liquidacoes`, { empresa_id: 'emp-1', operation_id: 'op-liq-3', valor: '1000.00', data: '2026-11-08', metodo: 'PIX' });
    await montar();
    await abrir(doc.id);
    await clicar(screen.getByTestId('botao-excluir-lancamento'));
    const dialogo = await screen.findByTestId('dialogo-bloqueio');
    expect(dialogo).toHaveTextContent('Exclusão bloqueada');
    expect(dialogo).toHaveTextContent(/A parcela nº 1 tem pagamento\/recebimento registrado/);
    expect(chamadas('POST', /\/excluir$/)).toHaveLength(0);
    expect(estado.documentos[0].status).toBe('CONFIRMADO');
  });

  it('EXC-3 bloqueado por dependência física (compra consumida): o elo que impede aparece', async () => {
    const doc = semearDocumento(estado, compraSimples(), { confirmar: true });
    estado.dependencias[doc.id] = [{ codigo: 'lote_consumido', mensagem: 'x', entidade: 'OperacaoFinanceira', numero: '311', item_ordem: 1 }];
    await montar();
    await abrir(doc.id);
    await clicar(screen.getByTestId('botao-excluir-lancamento'));
    expect(await screen.findByTestId('dialogo-bloqueio')).toHaveTextContent(/A mercadoria do item 1 já foi usada no estoque \(lançamento nº 311\)/);
    expect(chamadas('POST', /\/excluir$/)).toHaveLength(0);
  });

  it('EXC-4 pela barra da lista (linha confirmada); rascunho selecionado não oferece Excluir (continua o Descartar no formulário)', async () => {
    const rascunho = semearDocumento(estado, corpoServico({ descricao: 'RASCUNHO' }));
    const confirmado = semearDocumento(estado, corpoServico(), { confirmar: true });
    await montar();
    await selecionarLinha(rascunho.id);
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
    await selecionarLinha(rascunho.id);
    await selecionarLinha(confirmado.id);
    await clicar(barra('Excluir'));
    const dialogo = await screen.findByTestId('dialogo-exclusao');
    expect(within(dialogo).getByTestId('dialogo-exclusao-efeitos')).toHaveTextContent(/Sem mercadoria: o estoque não muda/);
    expect(escritas()).toEqual([]);
    fireEvent.change(within(dialogo).getByTestId('dialogo-exclusao-motivo'), { target: { value: 'Duplicado' } });
    await clicar(within(dialogo).getByTestId('dialogo-exclusao-ciente'));
    await clicar(within(dialogo).getByTestId('dialogo-exclusao-enviar'));
    expect(await screen.findByTestId('aviso-excluido')).toHaveTextContent(/Duplicado/);
    expect(mapa.refresh).not.toHaveBeenCalled();
  });

  it('EXC-5 sem resposta depois de gravar: "resultado incerto"; Consultar mostra o Excluído (pendência resolvida)', async () => {
    const doc = semearDocumento(estado, corpoServico(), { confirmar: true });
    estado.falhas.excluir = { gravarAntes: true, umaVez: true };
    await montar();
    await abrir(doc.id);
    await clicar(screen.getByTestId('botao-excluir-lancamento'));
    const dialogo = await screen.findByTestId('dialogo-exclusao');
    fireEvent.change(within(dialogo).getByTestId('dialogo-exclusao-motivo'), { target: { value: 'Errado' } });
    await clicar(within(dialogo).getByTestId('dialogo-exclusao-ciente'));
    await clicar(within(dialogo).getByTestId('dialogo-exclusao-enviar'));
    await clicar(await within(dialogo).findByTestId('botao-consultar-resultado'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-exclusao')).toBeNull());
    expect(await screen.findByTestId('status-lancamento')).toHaveTextContent('Excluído');
    const { lerPendenciaLancamento } = await import('@/services/operacaoFinanceiraService');
    expect(lerPendenciaLancamento('cli-1:operador', 'excluir', 'emp-1', doc.id)).toBeNull();
  });

  it('EXC-6 sem a permissão "excluir" não há Excluir; com "excluir" e sem "cancelar" o servidor explica sem_permissao', async () => {
    sessao.permissao = permissaoCom({ ...TODAS, excluir: false });
    const doc = semearDocumento(estado, corpoServico(), { confirmar: true });
    await montar();
    await abrir(doc.id);
    await screen.findByTestId('consulta-lancamento');
    expect(screen.queryByTestId('botao-excluir-lancamento')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
    cleanup();
    sessao.permissao = permissaoCom({ ...TODAS, cancelar: false });
    estado.permissoes.cancelar = false;
    await montar();
    await abrir(doc.id);
    await clicar(await screen.findByTestId('botao-excluir-lancamento'));
    expect(await screen.findByTestId('dialogo-bloqueio')).toHaveTextContent(/Você não tem a permissão “Cancelar”/);
  });
});

// ─── LISTA, SELOS E HISTÓRICO ────────────────────────────────────────────

describe('FIL/DET — filtro de situação do registro, selos e histórico de revisões', () => {
  /** A: confirmado; B: excluído; C: corrigido por substituição (C antigo + C novo). */
  const cenario = async () => {
    const a = semearDocumento(estado, corpoServico({ descricao: 'A' }), { confirmar: true });
    const b = semearDocumento(estado, corpoServico({ descricao: 'B' }), { confirmar: true });
    await comando('POST', `/operacoes-financeiras/${b.id}/excluir`, { empresa_id: 'emp-1', operation_id: 'op-exc-b', versao: 2, motivo: 'Engano' });
    const c = semearDocumento(estado, compraSimples(), { confirmar: true });
    const r = await comando('POST', `/operacoes-financeiras/${c.id}/retificar`, {
      ...compraSimples(),
      itens: [{ ...compraSimples().itens[0], quantidade: '120' }],
      rateios: [{ natureza_id: 'nd1', valor: '720.00' }],
      parcelas: [{ vencimento: '2026-11-08', valor: '720.00' }],
      versao: 2,
      motivo: 'Quantidade',
      operation_id: 'op-ret-c',
    });
    return { a, b, cAntigo: c, cNovoId: r.retificacao.operacao_atual_id };
  };

  it('FIL-1 padrão Operacionais (sem excluídos nem versões substituídas); Excluídos; Todos — com selos próprios', async () => {
    const { a, b, cAntigo, cNovoId } = await cenario();
    await montar();
    expect(await screen.findByTestId(`lancamento-numero-${a.id}`)).toBeTruthy();
    expect(screen.getByTestId(`lancamento-numero-${cNovoId}`)).toBeTruthy();
    expect(screen.queryByTestId(`lancamento-numero-${b.id}`)).toBeNull();
    expect(screen.queryByTestId(`lancamento-numero-${cAntigo.id}`)).toBeNull();
    expect(chamadas('GET', '/operacoes-financeiras').every((c) => !('situacao' in c.query))).toBe(true);

    await escolherOpcao(screen.getByRole('combobox', { name: 'Filtrar por situação do registro' }), 'Excluídos');
    expect(await screen.findByTestId(`lancamento-situacao-${b.id}`)).toHaveTextContent('Excluído');
    await waitFor(() => expect(screen.queryByTestId(`lancamento-numero-${a.id}`)).toBeNull());
    expect(chamadas('GET', '/operacoes-financeiras').at(-1).query.situacao).toBe('EXCLUIDOS');

    await escolherOpcao(screen.getByRole('combobox', { name: 'Filtrar por situação do registro' }), 'Todos');
    expect(await screen.findByTestId(`lancamento-situacao-${cAntigo.id}`)).toHaveTextContent('Substituído');
    expect(screen.getByTestId(`lancamento-situacao-${b.id}`)).toHaveTextContent('Excluído');
    expect(screen.getByTestId(`lancamento-situacao-${a.id}`)).toHaveTextContent('Confirmado');
    expect(screen.getByTestId(`lancamento-numero-${cAntigo.id}`)).toHaveTextContent(`${estado.documentos.find((d) => d.id === cNovoId).numero}/r2`);
    expect(chamadas('GET', '/operacoes-financeiras').at(-1).query.situacao).toBe('TODOS');
  });

  it('DET-1 consulta: "Histórico de revisões e exclusão" com motivo, autor, versões e links para a versão anterior e a corrigida', async () => {
    const { b, cAntigo, cNovoId } = await cenario();
    await montar();
    await abrir(cNovoId);
    const bloco = await screen.findByTestId('historico-revisoes');
    expect(bloco).toHaveTextContent(/Correção com substituição \(estoque refeito\) · versão 2 → 3/);
    expect(bloco).toHaveTextContent(/dono/);
    expect(bloco).toHaveTextContent(/Motivo: Quantidade/);
    await clicar(within(bloco).getByTestId('evento-revisao-0-anterior'));
    expect(await screen.findByTestId('aviso-substituido')).toBeTruthy();
    const blocoAntigo = screen.getByTestId('historico-revisoes');
    expect(within(blocoAntigo).queryByTestId('evento-revisao-0-anterior')).toBeNull();
    await clicar(within(blocoAntigo).getByTestId('evento-revisao-0-corrigida'));
    expect(await screen.findByTestId('aviso-substitui')).toBeTruthy();
    expect(chamadas('GET', `/operacoes-financeiras/${cAntigo.id}`).length).toBeGreaterThan(0);
    // Excluído: o evento EXCLUSAO no histórico.
    cleanup();
    await montar();
    await escolherOpcao(screen.getByRole('combobox', { name: 'Filtrar por situação do registro' }), 'Excluídos');
    await abrir(b.id);
    expect(await screen.findByTestId('historico-revisoes')).toHaveTextContent(/Exclusão · versão 2 → 3/);
    expect(screen.getByTestId('aviso-excluido')).toHaveTextContent(/Motivo: Engano/);
  });
});

// ─── CELULAR ─────────────────────────────────────────────────────────────

describe('MOB — 390 px e 412 px sem rolagem horizontal', () => {
  it.each([390, 412])('MOB-1 %i px: faixa da correção, diálogos de correção, exclusão e bloqueio e o histórico quebram linha', async (largura) => {
    emCelular(largura);
    semearDocumento(estado, compraSimples(), { confirmar: true });
    const bloqueado = semearDocumento(estado, corpoServico({ parceiro_id: 'pa3' }), { confirmar: true });
    await comando('POST', `/titulos-financeiros/${bloqueado.titulos[0].id}/liquidacoes`, { empresa_id: 'emp-1', operation_id: `op-liq-${largura}`, valor: '1.00', data: '2026-11-08', metodo: 'PIX' });
    await montar();
    await abrirPeloCard('AGROPECUÁRIA BOA VISTA');
    await clicar(screen.getByTestId('botao-excluir-lancamento'));
    semRolagemHorizontal(await screen.findByTestId('dialogo-exclusao'));
    await clicar(within(screen.getByTestId('dialogo-exclusao')).getByRole('button', { name: 'Voltar' }));
    await clicar(barra('Editar'));
    semRolagemHorizontal(await screen.findByTestId('faixa-correcao'));
    digitar('item-0-quantidade', '120');
    await act(async () => {
      fireEvent.submit(screen.getByTestId('b1-form'));
    });
    semRolagemHorizontal(await screen.findByTestId('dialogo-retificacao'));
    fireEvent.change(within(screen.getByTestId('dialogo-retificacao')).getByTestId('dialogo-retificacao-motivo'), { target: { value: 'Peso' } });
    await clicar(within(screen.getByTestId('dialogo-retificacao')).getByTestId('dialogo-retificacao-enviar'));
    semRolagemHorizontal(await screen.findByTestId('historico-revisoes'));
    semRolagemHorizontal(screen.getByTestId('aviso-substitui'));
    cleanup();
    await montar();
    await abrirPeloCard('VETERINÁRIA SÃO JOSÉ');
    await clicar(screen.getByTestId('botao-excluir-lancamento'));
    semRolagemHorizontal(await screen.findByTestId('dialogo-bloqueio'));
  });
});

describe('DSK — desktop 1280 e 1440 px', () => {
  it.each([1280, 1440])('DSK-1 %i px: tabela; a barra mostra Editar, Duplicar e Excluir para o confirmado selecionado; Excluir e Cancelar lado a lado na consulta (quebram linha)', async (largura) => {
    emCelular(largura);
    const doc = semearDocumento(estado, corpoServico(), { confirmar: true });
    await montar();
    await selecionarLinha(doc.id);
    for (const nome of ['Editar', 'Duplicar', 'Excluir']) expect(barra(nome)).toBeEnabled();
    await abrir(doc.id);
    const excluir = screen.getByTestId('botao-excluir-lancamento');
    const grupo = excluir.parentElement;
    expect(grupo).toContainElement(screen.getByTestId('botao-cancelar-lancamento'));
    expect(grupo.className).toMatch(/(^|\s)flex-wrap(\s|$)/);
    expect(grupo.className).toMatch(/(^|\s)min-w-0(\s|$)/);
  });
});

// ─── MENSAGENS E SERVICE ─────────────────────────────────────────────────

describe('ERR/SVC — mensagens dos códigos novos, contrato da API e pendência', () => {
  it('ERR-1 códigos e motivos novos têm mensagem própria (sem texto do servidor quando o código é conhecido)', async () => {
    const { mensagemErroGestao, mensagemDoMotivo, motivosDoErro } = await import('@/lib/gestaoErros');
    const e = (code, extra = {}) => ({ cause: { code, message: 'texto cru do servidor', ...extra } });
    const motivos = [
      { codigo: 'tem_liquidacao', mensagem: 'cru', entidade: 'LiquidacaoFinanceira', numero_parcela: 2, id: 'liq-9', estornada: false },
      { codigo: 'venda_com_movimento_posterior', mensagem: 'cru', entidade: 'MovimentacaoEstoque', numero: '88', item_ordem: 1 },
    ];
    const ret = mensagemErroGestao(e('OPERACAO_RETIFICACAO_BLOQUEADA', { details: { motivos } }), 'x');
    expect(ret).toMatch(/^A correção foi recusada pelo servidor: A parcela nº 2 tem pagamento/);
    expect(ret).toMatch(/movimento de estoque posterior a esta venda no mesmo produto e local \(movimento nº 88\) \(mercadoria do item 1\)/);
    expect(ret).toMatch(/Nada foi alterado\.$/);
    expect(ret).not.toMatch(/cru/);
    expect(mensagemErroGestao(e('OPERACAO_EXCLUSAO_BLOQUEADA', { details: { motivos: [{ codigo: 'documento_historico', mensagem: 'cru' }] } }), 'x')).toMatch(/^A exclusão foi recusada.*histórico.*Duplicar/);
    expect(mensagemErroGestao(e('OPERACAO_EXCLUSAO_BLOQUEADA'), 'x')).toMatch(/há vínculo que impede/);
    expect(mensagemErroGestao(e('OPERACAO_RETIFICACAO_BLOQUEADA', { reason: 'moeda_mudou' }), 'x')).toMatch(/moeda do perfil financeiro .* não converte valores/);
    expect(mensagemErroGestao(e('OPERACAO_REFERENCIA_INVALIDA', { field: 'duplicado_de_id', reason: 'duplicado_de_nao_encontrado' }), 'x')).toMatch(/origem desta cópia não existe nesta empresa/);
    expect(mensagemErroGestao(e('OPERACAO_VERSAO_CONFLITO'), 'x')).toMatch(/^O lançamento foi alterado em outro lugar/);
    expect(mensagemErroGestao(e('OPERACAO_STATUS_INVALIDO'), 'x')).toMatch(/excluído, corrigido/);
    expect(mensagemDoMotivo({ codigo: 'sem_permissao', mensagem: 'cru', exige: ['cancelar'] })).toMatch(/Você não tem a permissão “Cancelar” exigida/);
    expect(mensagemDoMotivo({ codigo: 'sem_permissao', mensagem: 'cru', exige: ['editar', 'confirmar'] })).toMatch(/Você não tem as permissões “Editar” e “Confirmar” exigidas/);
    expect(mensagemDoMotivo({ codigo: 'tem_liquidacao', mensagem: 'cru', numero_parcela: 3, estornada: true })).toMatch(/A parcela nº 3 .*\(já estornada/);
    expect(mensagemDoMotivo({ codigo: 'documento_historico', mensagem: 'cru', entidade: 'OperacaoFinanceira', id: 'op9', numero: '12' })).toMatch(/A versão atual é o lançamento nº 12\. Para lançar de novo, use Duplicar/);
    expect(mensagemDoMotivo({ codigo: 'lote_alterado', mensagem: 'cru', item_ordem: 2 })).toMatch(/O lote da mercadoria do item 2 foi alterado/);
    expect(mensagemDoMotivo({ codigo: 'lote_consumido', mensagem: 'cru', item_ordem: 1, entidade: 'MovimentacaoEstoque', numero: '7' })).toMatch(/item 1 já foi usada no estoque \(movimento nº 7\)/);
    // Código ainda desconhecido pela tela: a mensagem legível do contrato (SPEC §3).
    expect(mensagemDoMotivo({ codigo: 'novo_vinculo', mensagem: 'Há um vínculo novo com o lote 3.' })).toBe('Há um vínculo novo com o lote 3.');
    expect(mensagemDoMotivo({ codigo: 'novo_vinculo' })).toBe('Há um vínculo que impede esta ação.');
    expect(motivosDoErro({ cause: { code: 'X', motivos: [{ codigo: 'a' }, 'lixo', { sem: 1 }] } })).toEqual([{ codigo: 'a' }]);
  });

  it('SVC-1 elegibilidade fecha por padrão: resposta fora do contrato nunca libera editar/excluir nem promete estoque', async () => {
    estado = criarEstadoLancamentos();
    const respostas = [
      { id: 'op1', versao: 2, status: 'CONFIRMADO', editar: { permitido: true, modo: 'OUTRO' }, excluir: { permitido: 'sim', modo: 'LOGICA' }, duplicar: {} },
      { id: 'op1', versao: 2, status: 'CONFIRMADO', editar: { permitido: true, modo: 'RETIFICACAO' }, excluir: { permitido: true, modo: 'LOGICA', motivos: [{ codigo: 'x' }, 1] }, duplicar: { permitido: true } },
    ];
    let k = 0;
    backend = instalarBackendFake(async () => ({ status: 200, body: respostas[k++] }));
    const { obterElegibilidade } = await import('@/services/operacaoFinanceiraService');
    const a = await obterElegibilidade('emp-1', 'op1');
    expect(a.editar).toEqual({ permitido: false, modo: null, efeito_fisico_permitido: false, motivos: [] });
    expect(a.excluir.permitido).toBe(false);
    expect(a.duplicar.permitido).toBe(false);
    const b = await obterElegibilidade('emp-1', 'op1');
    expect(b.editar).toEqual({ permitido: true, modo: 'RETIFICACAO', efeito_fisico_permitido: false, motivos: [] });
    expect(b.excluir).toEqual({ permitido: true, modo: 'LOGICA', motivos: [{ codigo: 'x' }] });
    expect(chamadas('GET', '/operacoes-financeiras/op1/elegibilidade')[0].query).toEqual({ empresa_id: 'emp-1' });
  });

  it('SVC-2 retificar/excluir sem resposta repetem o MESMO operation_id; Consultar resolve pela versão nova, pela substituição ou pelo excluido_em', async () => {
    const svc = await import('@/services/operacaoFinanceiraService');
    const doc = semearDocumento(estado, corpoServico(), { confirmar: true });
    const storage = new Map();
    const st = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
    const docCorpo = { ...corpoServico({ descricao: 'NOVA' }) };
    delete docCorpo.empresa_id;
    estado.falhas.retificar = { umaVez: true };
    await expect(svc.retificarLancamento('emp-1', doc.id, { versao: 2, doc: docCorpo, motivo: 'm', escopo: 'e', storage: st })).rejects.toBeTruthy();
    const r = await svc.retificarLancamento('emp-1', doc.id, { versao: 2, doc: docCorpo, motivo: 'm', escopo: 'e', storage: st });
    const envios = chamadas('POST', /\/retificar$/);
    expect(envios).toHaveLength(2);
    expect(envios[1].body.operation_id).toBe(envios[0].body.operation_id);
    expect(r.retificacao).toEqual({ modo: 'NO_LUGAR', operacao_anterior_id: doc.id, operacao_atual_id: doc.id });
    expect(storage.size).toBe(0);
    // Resolução pela releitura.
    const pend = (acao, conteudo) => storage.set(`maike_lancamento_pendente:e:${acao}:emp-1:${doc.id}`, JSON.stringify({ operation_id: 'lanc-x', conteudo: JSON.stringify(conteudo) }));
    pend('retificar', { versao: 2, motivo: 'm' });
    expect(svc.resolverPendenciaConsultada({ escopo: 'e', acao: 'retificar', empresaId: 'emp-1', alvo: doc.id, detalhe: { versao: 2 }, storage: st })).toBe(false);
    expect(svc.resolverPendenciaConsultada({ escopo: 'e', acao: 'retificar', empresaId: 'emp-1', alvo: doc.id, detalhe: { versao: 3 }, storage: st })).toBe(true);
    pend('retificar', { versao: 2, motivo: 'm' });
    expect(svc.resolverPendenciaConsultada({ escopo: 'e', acao: 'retificar', empresaId: 'emp-1', alvo: doc.id, detalhe: { versao: 3, retificado_em: '2026-11-08T12:00:00.000Z', substituido_por: { id: 'op9', numero: '9' } }, storage: st })).toBe(true);
    pend('excluir', { versao: 3, motivo: 'm' });
    expect(svc.resolverPendenciaConsultada({ escopo: 'e', acao: 'excluir', empresaId: 'emp-1', alvo: doc.id, detalhe: { status: 'CANCELADO', excluido_em: null }, storage: st })).toBe(false);
    expect(svc.resolverPendenciaConsultada({ escopo: 'e', acao: 'excluir', empresaId: 'emp-1', alvo: doc.id, detalhe: { status: 'CANCELADO', excluido_em: '2026-11-08T12:00:00.000Z' }, storage: st })).toBe(true);
    // Excluir: corpo fechado, mesmo id na repetição.
    estado.falhas.excluir = { umaVez: true };
    await expect(svc.excluirLancamento('emp-1', doc.id, { versao: 3, motivo: 'Engano', escopo: 'e', storage: st })).rejects.toBeTruthy();
    await svc.excluirLancamento('emp-1', doc.id, { versao: 3, motivo: 'Engano', escopo: 'e', storage: st });
    const exc = chamadas('POST', /\/excluir$/);
    expect(exc.map((c) => Object.keys(c.body).sort())).toEqual([
      ['empresa_id', 'motivo', 'operation_id', 'versao'],
      ['empresa_id', 'motivo', 'operation_id', 'versao'],
    ]);
    expect(exc[1].body.operation_id).toBe(exc[0].body.operation_id);
    // Motivo vazio nem sai da tela (a API recusa antes da rede).
    await expect(svc.excluirLancamento('emp-1', doc.id, { versao: 4, motivo: '  ', escopo: 'e', storage: st })).rejects.toBeTruthy();
    expect(chamadas('POST', /\/excluir$/)).toHaveLength(2);
  });
});

// ─── REV — achados da revisão adversarial (RED → GREEN) ──────────────────
describe('REV — revisão: peso por saco gravado, motivos por direção, CAS da exclusão, cópia órfã e contrato do falso', () => {
  const escolher = async (testId, rotulo) => {
    await clicar(screen.getByTestId(testId));
    const painel = await screen.findByTestId(`${testId}-painel`);
    await clicar(await within(painel).findByRole('option', { name: rotulo }));
  };
  /** Venda com mercadoria: 10 kg de MILHO MOÍDO × 9,00 para o FRIGORÍFICO CENTRAL. */
  const vendaSimples = (extra = {}) => ({
    ...compraSimples(),
    direcao: 'RECEBER',
    parceiro_id: 'pa2',
    itens: [{ tipo_item: 'MERCADORIA', produto_id: 'pr2', local_estoque_id: 'lo2', unidade: 'KG', quantidade: '10', valor_unitario: '9' }],
    rateios: [{ natureza_id: 'nr1', valor: '90.00' }],
    parcelas: [{ vencimento: '2026-11-08', valor: '90.00' }],
    ...extra,
  });

  it('REV-1 (TELA-01) o cadastro mudou o peso por saco depois da compra: escolher de novo o MESMO produto e corrigir só a descrição prevê e grava NO_LUGAR com o peso GRAVADO; o diálogo diz que é previsão', async () => {
    const doc = semearDocumento(estado, compraPorItem(), { confirmar: true });
    // Recebida quando o saco pesava 30 kg; o cadastro (falso) hoje diz 25 kg.
    Object.assign(doc.itens[0], { fator_kg: '30.0000', quantidade_estoque: '3000.0000' });
    await montar();
    await abrir(doc.id);
    await clicar(barra('Editar'));
    await screen.findByTestId('faixa-correcao');
    // O seletor traz o peso ATUAL (25 kg); a linha já recebida continua com o peso gravado (30 kg), como no servidor.
    await escolher('seletor-produto-0', /SAL MINERAL 80/);
    await escolherOpcao(screen.getByRole('combobox', { name: 'Unidade do item 1' }), 'SACO');
    fireEvent.change(screen.getByLabelText(/Histórico \(descrição\)/), { target: { value: 'COMPRA DE SAL MINERAL' } });
    expect(screen.getByTestId('previsao-correcao')).toHaveTextContent(/não muda o estoque/);
    await clicar(screen.getByTestId('botao-salvar-correcao'));
    const dialogo = await screen.findByTestId('dialogo-retificacao');
    const efeito = within(dialogo).getByTestId('dialogo-retificacao-estoque');
    expect(efeito).toHaveTextContent(/O estoque não muda/);
    expect(efeito).toHaveTextContent(/previsão da tela.*quem decide é o servidor/);
    fireEvent.change(within(dialogo).getByTestId('dialogo-retificacao-motivo'), { target: { value: 'Descrição' } });
    await clicar(within(dialogo).getByTestId('dialogo-retificacao-enviar'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-retificacao')).toBeNull());
    expect(estado.eventos.map((e) => e.modo)).toEqual(['NO_LUGAR']);
    expect(estado.documentos.find((d) => d.id === doc.id).itens[0]).toMatchObject({ fator_kg: '30.0000', quantidade_estoque: '3000.0000' });
    await waitFor(() => expect(toasts().join(' | ')).toMatch(/o estoque não mudou/));
  });

  it('REV-2 (TELA-02) motivo físico de VENDA tem texto de venda (nunca "entrada desta compra"); lote consumido por outro lançamento depois da venda diz isso', async () => {
    const { mensagemDoMotivo } = await import('@/lib/gestaoErros');
    const loteDaVenda = { codigo: 'lote_alterado', mensagem: 'um lote da linha 1 não pode receber a devolução (situação Estornado)', item_ordem: 1, lote_id: 'l9' };
    expect(mensagemDoMotivo(loteDaVenda, { direcao: 'RECEBER' })).not.toMatch(/compra/);
    expect(mensagemDoMotivo(loteDaVenda, { direcao: 'RECEBER' })).toMatch(/venda do item 1.*saída/);
    expect(mensagemDoMotivo(loteDaVenda, { direcao: 'PAGAR' })).toMatch(/entrada desta compra/);
    const outroLancamento = { codigo: 'venda_com_movimento_posterior', mensagem: 'cru', item_ordem: 1, entidade: 'OperacaoFinanceira', numero: '7', lote_id: 'l9' };
    expect(mensagemDoMotivo(outroLancamento)).toMatch(/lançamento nº 7 usou.*depois desta venda/);
    expect(mensagemDoMotivo(outroLancamento)).not.toMatch(/Há movimento de estoque posterior/);
    // Na tela: o diálogo de bloqueio e a faixa da correção conhecem a direção do documento.
    const venda = semearDocumento(estado, vendaSimples(), { confirmar: true });
    estado.dependencias[venda.id] = [loteDaVenda];
    await montar();
    await abrir(venda.id);
    await clicar(screen.getByTestId('botao-excluir-lancamento'));
    const bloqueio = await screen.findByTestId('dialogo-bloqueio');
    expect(bloqueio).toHaveTextContent(/venda do item 1/);
    expect(bloqueio).not.toHaveTextContent(/compra/);
    await clicar(within(bloqueio).getByTestId('dialogo-bloqueio-fechar'));
    await clicar(barra('Editar'));
    const aviso = await screen.findByTestId('faixa-correcao-sem-estoque');
    expect(aviso).toHaveTextContent(/venda do item 1/);
    expect(aviso).not.toHaveTextContent(/compra/);
  });

  it('REV-3 (TELA-03) a versão mudou entre a leitura do detalhe e a da elegibilidade: Excluir não abre o diálogo (o conteúdo mostrado não é o que seria excluído); nada é enviado', async () => {
    const doc = semearDocumento(estado, corpoServico({ descricao: 'LUZ' }), { confirmar: true });
    await montar();
    await abrir(doc.id);
    let armado = true;
    let detalheServido;
    const servido = new Promise((r) => { detalheServido = r; });
    backend = instalarBackendFake(async (req) => {
      if (armado && req.method === 'GET' && req.path === `/operacoes-financeiras/${doc.id}`) {
        const r = await rotearLancamentos(estado, req);
        detalheServido();
        return r;
      }
      if (armado && req.method === 'GET' && req.path === `/operacoes-financeiras/${doc.id}/elegibilidade`) {
        armado = false;
        await servido;
        // Outra aba corrige NO LUGAR entre as duas leituras (versão 2 → 3).
        await comando('POST', `/operacoes-financeiras/${doc.id}/retificar`, { ...corpoServico({ descricao: 'LUZ CORRIGIDA' }), versao: 2, operation_id: 'op-outra-aba', motivo: 'Outra aba' });
      }
      const r = await rotearLancamentos(estado, req);
      if (r && r.rede) throw new TypeError('Failed to fetch');
      return r;
    });
    await clicar(screen.getByTestId('botao-excluir-lancamento'));
    await waitFor(() => expect(toasts().join(' | ')).toMatch(/mudou enquanto era verificado/));
    expect(screen.queryByTestId('dialogo-exclusao')).toBeNull();
    expect(chamadas('POST', /\/excluir$/)).toHaveLength(0);
    expect(estado.documentos.find((d) => d.id === doc.id)).toMatchObject({ status: 'CONFIRMADO', versao: 3, excluido_em: null });
  });

  it('REV-4 (TELA-04) a origem da cópia foi descartada em outra aba: a recusa explica e o próximo Salvar grava a cópia SEM o vínculo de origem (nada digitado se perde)', async () => {
    const rascunho = semearDocumento(estado, corpoServico({ descricao: 'ORIGEM QUE SERÁ DESCARTADA' }));
    await montar();
    await selecionarLinha(rascunho.id);
    await clicar(barra('Duplicar'));
    await screen.findByTestId('faixa-copia');
    fireEvent.change(screen.getByLabelText(/Histórico \(descrição\)/), { target: { value: 'CÓPIA EDITADA' } });
    // Outra aba descarta a origem (DELETE físico do rascunho).
    estado.documentos = estado.documentos.filter((d) => d.id !== rascunho.id);
    await clicar(barra('Salvar'));
    await waitFor(() => expect(chamadas('POST', '/operacoes-financeiras')).toHaveLength(1));
    await waitFor(() => expect(toasts().join(' | ')).toMatch(/origem desta cópia não existe mais.*salve de novo/i));
    expect(toasts().join(' | ')).not.toMatch(/duplique de novo/);
    expect(estado.documentos).toHaveLength(0);
    expect(screen.getByLabelText(/Histórico \(descrição\)/)).toHaveValue('CÓPIA EDITADA');
    await clicar(barra('Salvar'));
    await waitFor(() => expect(estado.documentos).toHaveLength(1));
    const posts = chamadas('POST', '/operacoes-financeiras');
    expect(posts).toHaveLength(2);
    expect(posts[1].body).not.toHaveProperty('duplicado_de_id');
    expect(posts[1].body.operation_id).not.toBe(posts[0].body.operation_id);
    expect(estado.documentos[0]).toMatchObject({ status: 'RASCUNHO', descricao: 'CÓPIA EDITADA' });
  });

  it('REV-5 (TELA-05) o falso segue o servidor: sem produtos, trocar a direção é SUBSTITUIÇÃO (id novo, antigo /r<v>) e a tela passa ao documento novo; detalhe traz duplicado_de_id e os números dos eventos', async () => {
    const doc = semearDocumento(estado, corpoServico(), { confirmar: true });
    await montar();
    await abrir(doc.id);
    await clicar(barra('Editar'));
    await screen.findByTestId('faixa-correcao');
    // Sem o host de avisos do App, `confirmar` cai no `window.confirm`: o teste responde "Trocar".
    const pergunta = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await clicar(within(screen.getByTestId('escolha-direcao')).getByRole('radio', { name: 'A receber' }));
    expect(pergunta).toHaveBeenCalledTimes(1);
    await escolher('seletor-parceiro', /FRIGORÍFICO CENTRAL/);
    await escolher('seletor-natureza-0', /VENDA DE GADO/);
    await clicar(screen.getByTestId('botao-salvar-correcao'));
    const dialogo = await screen.findByTestId('dialogo-retificacao');
    expect(within(dialogo).getByTestId('dialogo-retificacao-estoque')).toHaveTextContent(/O estoque não muda/);
    expect(within(dialogo).getByTestId('dialogo-retificacao-efeitos')).toHaveTextContent(/versão nova.*MESMO número/);
    fireEvent.change(within(dialogo).getByTestId('dialogo-retificacao-motivo'), { target: { value: 'Era recebimento' } });
    await clicar(within(dialogo).getByTestId('dialogo-retificacao-enviar'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-retificacao')).toBeNull());
    expect(estado.eventos.map((e) => e.modo)).toEqual(['SUBSTITUICAO']);
    const novo = estado.documentos.find((d) => d.id !== doc.id);
    expect(estado.documentos.find((d) => d.id === doc.id)).toMatchObject({ status: 'CANCELADO', numero: `${novo.numero}/r2` });
    expect(novo).toMatchObject({ status: 'CONFIRMADO', direcao: 'RECEBER', versao: 3 });
    expect(await screen.findByTestId('aviso-substitui')).toHaveTextContent(`nº ${novo.numero}/r2`);
    const det = await comando('GET', `/operacoes-financeiras/${novo.id}`);
    expect(det.eventos[0]).toMatchObject({ operacao_id: doc.id, operacao_numero: `${novo.numero}/r2`, operacao_nova_id: novo.id, operacao_nova_numero: novo.numero });
    expect(det.duplicado_de_id).toBeNull();
    const copia = await comando('POST', '/operacoes-financeiras', { ...corpoServico({ descricao: 'CÓPIA' }), operation_id: 'op-copia-1', duplicado_de_id: novo.id });
    expect((await comando('GET', `/operacoes-financeiras/${copia.id}`)).duplicado_de_id).toBe(novo.id);
  });
});
