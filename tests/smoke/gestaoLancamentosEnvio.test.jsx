/**
 * D-PROD-155 — Central Única de Lançamentos: o `operation_id` pendente só repete
 * o MESMO envio sem resposta (revisão adversarial, rodada 2: DINHEIRO-2,
 * FRONTEND-2, FRONTEND-4) e o estoque alterado avisa o Mapa e as telas de
 * estoque como as telas antigas fazem (lacuna do crítico).
 *
 * Tela montada de verdade (página, motor Base1, service, API, porta e
 * nativeHttpClient reais). Mocks só da borda: `fetch` (backend FALSO do
 * contrato, tests/smoke/fixtures/lancamentosFakeCore.js), a sessão e, no ENV-3,
 * o refresh do cache do Mapa (IndexedDB não existe no jsdom).
 *
 * As perguntas do envio pendente usam `confirmar` (@/lib/maikeConfirmar), que
 * sem o host do App cai no `window.confirm`: o teste responde por ele.
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
// Só o refresh do cache do Mapa é observado (o resto do módulo é o real).
vi.mock('@/services/mapaCacheService', async (importOriginal) => ({
  ...(await importOriginal()),
  refreshMapaCacheEntry: vi.fn(async () => []),
}));

const ESCOPO = 'cli-1:operador';
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
/** Compra com mercadoria (entrada no estoque ao confirmar): 100 kg × 2,00. */
const corpoCompra = () =>
  corpoBase({
    conteudo: 'COM_PRODUTOS',
    valor_bruto: undefined,
    data_operacional: '2026-11-08',
    efeito_fisico_confirmado: true,
    itens: [{ tipo_item: 'MERCADORIA', produto_id: 'pr2', local_estoque_id: 'lo1', unidade: 'KG', quantidade: '100', valor_unitario: '2' }],
    rateios: [{ natureza_id: 'nd1', valor: '200.00' }],
    parcelas: [{ vencimento: '2026-11-08', valor: '200.00' }],
  });

let estado;
let backend;
/** @type {import('vitest').Mock} */
let perguntar;

const montar = async () => {
  const { default: LancamentosFinanceiros } = await import('@/pages/LancamentosFinanceiros');
  // Mesmos padrões da aplicação (src/lib/query-client.js).
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
const abrir = async (id) => {
  fireEvent.doubleClick(await screen.findByTestId(`lancamento-numero-${id}`));
  await waitFor(() => expect(screen.queryByTestId('carregando-lancamento')).toBeNull());
};
const toasts = () => [...document.querySelectorAll('[data-sonner-toast]')].map((n) => n.textContent);
const pendencia = async (acao, alvo) => {
  const { lerPendenciaLancamento } = await import('@/services/operacaoFinanceiraService');
  return lerPendenciaLancamento(ESCOPO, acao, 'emp-1', alvo);
};

/** Abre "Registrar pagamento" da parcela 1, informa valor e forma e envia. */
const pagar = async (valor, forma = 'Pix') => {
  await clicar(await screen.findByTestId('botao-liquidar-1'));
  const dialogo = await screen.findByTestId('dialogo-liquidacao');
  fireEvent.change(within(dialogo).getByTestId('liquidacao-valor'), { target: { value: valor } });
  await clicar(within(dialogo).getByRole('radio', { name: forma }));
  await clicar(within(dialogo).getByTestId('botao-registrar-liquidacao'));
  return dialogo;
};
const baixasAtivas = () => estado.documentos[0].titulos[0].liquidacoes.filter((l) => l.tipo === 'LIQUIDACAO' && !l.estornada);

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
  // Sem resposta definida, uma pergunta inesperada falha o teste.
  perguntar = vi.spyOn(window, 'confirm').mockImplementation((texto) => {
    throw new Error(`pergunta inesperada: ${texto}`);
  });
  estado = criarEstadoLancamentos();
  backend = instalarBackendFake(async (req) => {
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

describe('ENV-1 — a pendência só repete o MESMO envio sem resposta (DINHEIRO-2, FRONTEND-2)', () => {
  it('liquidar: 500 sem resposta (gravado) → Consultar mostra a baixa e resolve a pendência → o 2º pagamento igual é NOVO', async () => {
    const doc = semearDocumento(estado, corpoBase(), { confirmar: true }); // parcela única de 1.000,00
    estado.falhas.liquidar = { gravarAntes: true, umaVez: true };
    await montar();
    await abrir(doc.id);
    const dialogo = await pagar('500');
    expect(await within(dialogo).findByTestId('resultado-incerto')).toBeTruthy();
    expect(await pendencia('liquidar', `${doc.id}-t1`)).not.toBeNull();
    await clicar(within(dialogo).getByTestId('botao-consultar-resultado'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-liquidacao')).toBeNull());
    expect(await screen.findByTestId('titulo-1-saldo')).toHaveTextContent(/R\$\s500,00/);
    // Consultar mostrou a baixa: aquele envio está resolvido.
    expect(await pendencia('liquidar', `${doc.id}-t1`)).toBeNull();

    // Segundo Pix de 500 no mesmo dia: o diálogo já sugere o saldo (500,00), hoje e a mesma forma.
    await pagar('500,00');
    await waitFor(() => expect(screen.queryByTestId('dialogo-liquidacao')).toBeNull());
    const envios = chamadas('POST', /\/liquidacoes$/);
    expect(envios).toHaveLength(2);
    expect(envios[1].body.operation_id).not.toBe(envios[0].body.operation_id);
    expect(baixasAtivas()).toHaveLength(2);
    expect(estado.documentos[0].titulos[0].status).toBe('QUITADO');
    expect(await screen.findByTestId('titulo-1-status')).toHaveTextContent('Quitado');
    expect(perguntar).not.toHaveBeenCalled();
    expect(toasts().join(' ')).not.toMatch(/envio repetido/);
  });

  it('liquidar sem Consultar: um diálogo NOVO com o mesmo conteúdo pergunta; "Enviar como novo" grava a 2ª baixa com chave nova', async () => {
    const doc = semearDocumento(estado, corpoBase(), { confirmar: true });
    estado.falhas.liquidar = { gravarAntes: true, umaVez: true };
    await montar();
    await abrir(doc.id);
    const primeiro = await pagar('500');
    expect(await within(primeiro).findByTestId('resultado-incerto')).toBeTruthy();
    await clicar(within(primeiro).getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(screen.queryByTestId('dialogo-liquidacao')).toBeNull());

    perguntar.mockImplementation(() => true); // "Enviar como novo"
    await pagar('500');
    await waitFor(() => expect(screen.queryByTestId('dialogo-liquidacao')).toBeNull());
    expect(perguntar).toHaveBeenCalledTimes(1);
    expect(perguntar.mock.calls[0][0]).toMatch(/IGUAL a este/);
    const envios = chamadas('POST', /\/liquidacoes$/);
    expect(envios).toHaveLength(2);
    expect(envios[1].body.operation_id).not.toBe(envios[0].body.operation_id);
    expect(baixasAtivas()).toHaveLength(2);
    expect(estado.documentos[0].titulos[0].status).toBe('QUITADO');
  });

  it('liquidar sem Consultar: "Manter" não envia nada; só o "Repetir o mesmo envio" explícito reaproveita a chave (replay, nada duplicado)', async () => {
    const doc = semearDocumento(estado, corpoBase(), { confirmar: true });
    estado.falhas.liquidar = { gravarAntes: true, umaVez: true };
    await montar();
    await abrir(doc.id);
    const primeiro = await pagar('500');
    expect(await within(primeiro).findByTestId('resultado-incerto')).toBeTruthy();
    await clicar(within(primeiro).getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(screen.queryByTestId('dialogo-liquidacao')).toBeNull());

    perguntar.mockImplementation(() => false); // "Manter" (ou fechar a pergunta)
    const segundo = await pagar('500');
    expect(perguntar).toHaveBeenCalledTimes(1);
    expect(await within(segundo).findByTestId('resultado-incerto')).toBeTruthy();
    expect(within(segundo).getByTestId('botao-consultar-resultado')).toBeTruthy();
    expect(chamadas('POST', /\/liquidacoes$/)).toHaveLength(1);
    await clicar(within(segundo).getByRole('button', { name: 'Repetir o mesmo envio' }));
    await waitFor(() => expect(screen.queryByTestId('dialogo-liquidacao')).toBeNull());
    expect(perguntar).toHaveBeenCalledTimes(1);
    const envios = chamadas('POST', /\/liquidacoes$/);
    expect(envios).toHaveLength(2);
    expect(envios[1].body.operation_id).toBe(envios[0].body.operation_id);
    expect(baixasAtivas()).toHaveLength(1);
    expect(await screen.findByText(/envio repetido: nada foi duplicado/)).toBeTruthy();
  });

  it('liquidar: Consultar que NÃO mostra a baixa mantém a pendência (pode estar em processamento) e o envio igual seguinte pergunta', async () => {
    const doc = semearDocumento(estado, corpoBase(), { confirmar: true });
    estado.falhas.liquidar = { umaVez: true }; // sem resposta e NADA gravado
    await montar();
    await abrir(doc.id);
    const dialogo = await pagar('500');
    expect(await within(dialogo).findByTestId('resultado-incerto')).toBeTruthy();
    await clicar(within(dialogo).getByTestId('botao-consultar-resultado'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-liquidacao')).toBeNull());
    expect(await screen.findByTestId('titulo-1-saldo')).toHaveTextContent(/R\$\s1\.000,00/);
    expect(await pendencia('liquidar', `${doc.id}-t1`)).not.toBeNull();

    perguntar.mockImplementation(() => false); // "Manter"
    const segundo = await pagar('500');
    expect(perguntar).toHaveBeenCalledTimes(1);
    expect(await within(segundo).findByTestId('resultado-incerto')).toBeTruthy();
    await clicar(within(segundo).getByRole('button', { name: 'Repetir o mesmo envio' }));
    await waitFor(() => expect(screen.queryByTestId('dialogo-liquidacao')).toBeNull());
    const envios = chamadas('POST', /\/liquidacoes$/);
    expect(envios).toHaveLength(2);
    expect(envios[1].body.operation_id).toBe(envios[0].body.operation_id);
    expect(baixasAtivas()).toHaveLength(1);
    expect(await pendencia('liquidar', `${doc.id}-t1`)).toBeNull();
  });

  it('liquidar: resposta NÃO definitiva (IDEMPOTENCY_IN_PROGRESS) mantém a pendência e o clique seguinte NO MESMO diálogo repete o envio sem perguntar', async () => {
    const doc = semearDocumento(estado, corpoBase(), { confirmar: true });
    estado.falhas.liquidar = { umaVez: true, resposta: { status: 409, body: { code: 'IDEMPOTENCY_IN_PROGRESS', message: 'x', request_id: 'r' } } };
    await montar();
    await abrir(doc.id);
    const dialogo = await pagar('500');
    expect(await within(dialogo).findByTestId('erro-envio')).toBeTruthy();
    expect(await pendencia('liquidar', `${doc.id}-t1`)).not.toBeNull();
    await clicar(within(dialogo).getByTestId('botao-registrar-liquidacao'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-liquidacao')).toBeNull());
    const envios = chamadas('POST', /\/liquidacoes$/);
    expect(envios).toHaveLength(2);
    expect(envios[1].body.operation_id).toBe(envios[0].body.operation_id);
    expect(baixasAtivas()).toHaveLength(1);
    expect(perguntar).not.toHaveBeenCalled();
  });

  it('criar: rascunho sem resposta (gravado) → tela remontada → formulário NOVO igual pergunta; "Enviar como novo" cria o 2º rascunho', async () => {
    estado.falhas.criar = { gravarAntes: true, umaVez: true };
    const escolher = async (testId, rotulo) => {
      await clicar(screen.getByTestId(testId));
      const painel = await screen.findByTestId(`${testId}-painel`);
      await clicar(await within(painel).findByRole('option', { name: rotulo }));
    };
    const lancarIgual = async () => {
      await clicar(await screen.findByRole('button', { name: 'Novo' }));
      await screen.findByTestId('b1-form');
      await escolher('seletor-parceiro', /AGROPECUÁRIA BOA VISTA/);
      fireEvent.change(screen.getByTestId('valor-bruto'), { target: { value: '150,00' } });
      await escolher('seletor-natureza-0', /INSUMOS \/ NUTRIÇÃO/);
      await clicar(screen.getByRole('button', { name: 'Salvar' }));
    };
    await montar();
    await lancarIgual();
    expect(await screen.findByText(/pode ter sido gravado/)).toBeTruthy();
    expect(estado.documentos).toHaveLength(1);
    // Sai da tela e volta (a pendência fica no localStorage, como no navegador).
    cleanup();
    await montar();
    await screen.findByTestId(`lancamento-numero-${estado.documentos[0].id}`);

    perguntar.mockImplementation(() => true); // "Enviar como novo": é a 2ª diária do mesmo prestador
    await lancarIgual();
    await waitFor(() => expect(estado.documentos).toHaveLength(2));
    expect(perguntar).toHaveBeenCalledTimes(1);
    const envios = chamadas('POST', '/operacoes-financeiras');
    expect(envios).toHaveLength(2);
    expect(envios[1].body.operation_id).not.toBe(envios[0].body.operation_id);
    expect(await screen.findByText(/Rascunho salvo/)).toBeTruthy();
  });

  it('criar: tela remontada → formulário NOVO igual → "Manter" não envia; salvar de novo NESTE formulário repete o envio (replay, um só)', async () => {
    estado.falhas.criar = { gravarAntes: true, umaVez: true };
    const escolher = async (testId, rotulo) => {
      await clicar(screen.getByTestId(testId));
      const painel = await screen.findByTestId(`${testId}-painel`);
      await clicar(await within(painel).findByRole('option', { name: rotulo }));
    };
    const lancarIgual = async () => {
      await clicar(await screen.findByRole('button', { name: 'Novo' }));
      await screen.findByTestId('b1-form');
      await escolher('seletor-parceiro', /AGROPECUÁRIA BOA VISTA/);
      fireEvent.change(screen.getByTestId('valor-bruto'), { target: { value: '150,00' } });
      await escolher('seletor-natureza-0', /INSUMOS \/ NUTRIÇÃO/);
      await clicar(screen.getByRole('button', { name: 'Salvar' }));
    };
    await montar();
    await lancarIgual();
    expect(await screen.findByText(/pode ter sido gravado/)).toBeTruthy();
    cleanup();
    await montar();
    await screen.findByTestId(`lancamento-numero-${estado.documentos[0].id}`);

    perguntar.mockImplementation(() => false); // "Manter"
    await lancarIgual();
    expect(await screen.findByText(/Nada foi enviado agora/)).toBeTruthy();
    expect(chamadas('POST', '/operacoes-financeiras')).toHaveLength(1);
    await clicar(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(chamadas('POST', '/operacoes-financeiras')).toHaveLength(2));
    const [a, b] = chamadas('POST', '/operacoes-financeiras');
    expect(b.body.operation_id).toBe(a.body.operation_id);
    expect(estado.documentos).toHaveLength(1);
    expect(perguntar).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('botao-confirmar-lancamento')).toBeTruthy();
  });

  it('estornar: Consultar que mostra a baixa estornada resolve a pendência do estorno', async () => {
    const doc = semearDocumento(estado, corpoBase(), { confirmar: true });
    await montar();
    await abrir(doc.id);
    await pagar('1.000,00');
    await waitFor(() => expect(screen.queryByTestId('dialogo-liquidacao')).toBeNull());
    const liq = estado.documentos[0].titulos[0].liquidacoes[0];
    estado.falhas.estornar = { gravarAntes: true, umaVez: true };
    await clicar(await screen.findByTestId(`botao-estornar-${liq.id}`));
    const dialogo = await screen.findByTestId('dialogo-estorno');
    fireEvent.change(within(dialogo).getByTestId('dialogo-estorno-motivo'), { target: { value: 'Lançado em duplicidade' } });
    await clicar(within(dialogo).getByTestId('dialogo-estorno-enviar'));
    expect(await within(dialogo).findByTestId('resultado-incerto')).toBeTruthy();
    expect(await pendencia('estornar', liq.id)).not.toBeNull();
    await clicar(within(dialogo).getByTestId('botao-consultar-resultado'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-estorno')).toBeNull());
    expect(await screen.findByTestId(`liquidacao-${liq.id}-estornada`)).toBeTruthy();
    expect(await pendencia('estornar', liq.id)).toBeNull();
  });

  it('enviarComPendencia: só `retentativa` reaproveita em silêncio em criar/liquidar; confirmar/cancelar/estornar repetem (o alvo só aceita o efeito uma vez)', async () => {
    const { enviarComPendencia, lerPendenciaLancamento } = await import('@/services/operacaoFinanceiraService');
    const dados = new Map();
    const storage = /** @type {any} */ ({ getItem: (k) => dados.get(k) ?? null, setItem: (k, v) => dados.set(k, String(v)), removeItem: (k) => dados.delete(k) });
    const semResposta = async () => {
      throw Object.assign(new Error('sem resposta'), { code: 'PROVIDER_UNAVAILABLE' });
    };
    const chaves = [];
    const ok = async (k) => {
      chaves.push(k);
      return { ok: true };
    };
    const pendente = async (acao, alvo) => {
      const base = { escopo: 't', acao, empresaId: 'e1', alvo, conteudo: { valor: '500.00' }, storage };
      await expect(enviarComPendencia({ ...base, enviar: semResposta })).rejects.toThrow('sem resposta');
      return { base, chave: lerPendenciaLancamento('t', acao, 'e1', alvo, storage)?.operation_id };
    };
    // (1) retentativa explícita: mesma chave, sem pergunta.
    for (const acao of ['criar', 'liquidar', 'confirmar', 'cancelar', 'estornar']) {
      const { base, chave } = await pendente(acao, `alvo-${acao}-1`);
      const pergunta = vi.fn(() => true);
      await enviarComPendencia({ ...base, retentativa: true, enviar: ok, confirmarNovoEnvio: pergunta, confirmarDescarte: pergunta });
      expect(chaves.at(-1)).toBe(chave);
      expect(pergunta).not.toHaveBeenCalled();
    }
    // (2) envio NOVO de conteúdo igual em criar/liquidar: pergunta; "Enviar como novo" = chave nova;
    //     "Manter" = nada sai (CODIGO_ENVIO_PENDENTE) e só a retentativa explícita repete a chave.
    const { CODIGO_ENVIO_PENDENTE } = await import('@/services/operacaoFinanceiraService');
    for (const acao of ['criar', 'liquidar']) {
      const novo = await pendente(acao, `alvo-${acao}-2`);
      const sim = vi.fn(() => true);
      await enviarComPendencia({ ...novo.base, enviar: ok, confirmarNovoEnvio: sim });
      expect(sim).toHaveBeenCalledTimes(1);
      expect(chaves.at(-1)).not.toBe(novo.chave);
      const manter = await pendente(acao, `alvo-${acao}-3`);
      const nao = vi.fn(() => false);
      const antes = chaves.length;
      await expect(enviarComPendencia({ ...manter.base, enviar: ok, confirmarNovoEnvio: nao })).rejects.toMatchObject({ code: CODIGO_ENVIO_PENDENTE });
      expect(nao).toHaveBeenCalledTimes(1);
      expect(chaves).toHaveLength(antes);
      expect(lerPendenciaLancamento('t', acao, 'e1', `alvo-${acao}-3`, storage)?.operation_id).toBe(manter.chave);
      await enviarComPendencia({ ...manter.base, retentativa: true, enviar: ok, confirmarNovoEnvio: nao });
      expect(chaves.at(-1)).toBe(manter.chave);
      expect(nao).toHaveBeenCalledTimes(1);
    }
    // (3) confirmar/cancelar/estornar com conteúdo igual: é o MESMO pedido (o alvo não recebe o efeito duas vezes).
    for (const acao of ['confirmar', 'cancelar', 'estornar']) {
      const { base, chave } = await pendente(acao, `alvo-${acao}-4`);
      const pergunta = vi.fn(() => true);
      await enviarComPendencia({ ...base, enviar: ok, confirmarNovoEnvio: pergunta });
      expect(pergunta).not.toHaveBeenCalled();
      expect(chaves.at(-1)).toBe(chave);
    }
  });
});

describe('ENV-2 — "Manter" no aviso de envio pendente (FRONTEND-4)', () => {
  it('liquidação incerta → valor mudado → "Manter": o diálogo continua em resultado incerto com "Consultar" (sem "Nada foi gravado")', async () => {
    const doc = semearDocumento(estado, corpoBase(), { confirmar: true });
    estado.falhas.liquidar = { gravarAntes: true, umaVez: true };
    await montar();
    await abrir(doc.id);
    const dialogo = await pagar('100');
    expect(await within(dialogo).findByTestId('resultado-incerto')).toBeTruthy();
    perguntar.mockImplementation(() => false); // "Manter"
    fireEvent.change(within(dialogo).getByTestId('liquidacao-valor'), { target: { value: '50' } });
    await clicar(within(dialogo).getByTestId('botao-registrar-liquidacao'));
    expect(perguntar).toHaveBeenCalledTimes(1);
    expect(perguntar.mock.calls[0][0]).toMatch(/Descartar e enviar/);
    expect(within(dialogo).queryByTestId('erro-envio')).toBeNull();
    expect(dialogo.textContent).not.toMatch(/Nada foi gravado/);
    expect(within(dialogo).getByTestId('resultado-incerto')).toBeTruthy();
    expect(chamadas('POST', /\/liquidacoes$/)).toHaveLength(1);
    await clicar(within(dialogo).getByTestId('botao-consultar-resultado'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-liquidacao')).toBeNull());
    expect(await screen.findByTestId('titulo-1-saldo')).toHaveTextContent(/R\$\s900,00/);
  });
});

describe('ENV-3 — estoque alterado: mesmo aviso das telas antigas de estoque (cache do Mapa)', () => {
  const avisosDoMapa = () => {
    const eventos = [];
    const ouvir = (e) => eventos.push(e.detail ?? null);
    window.addEventListener('atualizar-mapa', ouvir);
    return { eventos, parar: () => window.removeEventListener('atualizar-mapa', ouvir) };
  };

  it('confirmar compra com mercadoria: refresh FORÇADO de estoqueLotes e movimentacaoEstoque, cache do Mapa invalidado e "atualizar-mapa"', async () => {
    const doc = semearDocumento(estado, corpoCompra());
    const queryClient = await montar();
    // Consultas que o Mapa e as telas de estoque deixaram em memória (staleTime de 5 min no Mapa).
    queryClient.setQueryData(['mapa-cache', 'estoqueLotes', 'emp-1', 'default'], [{ id: 'lote-velho' }]);
    queryClient.setQueryData(['saldo-deposito', 'dep-1'], { saldo: 1 });
    const mapa = avisosDoMapa();
    const { refreshMapaCacheEntry } = await import('@/services/mapaCacheService');
    await abrir(doc.id);
    await clicar(await screen.findByTestId('botao-confirmar-lancamento'));
    const dialogo = await screen.findByTestId('dialogo-confirmacao');
    expect(refreshMapaCacheEntry).not.toHaveBeenCalled();
    await clicar(within(dialogo).getByTestId('botao-confirmar-definitivo'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-confirmacao')).toBeNull());
    await waitFor(() => expect(refreshMapaCacheEntry).toHaveBeenCalledWith('estoqueLotes', 'emp-1', { force: true }));
    expect(refreshMapaCacheEntry).toHaveBeenCalledWith('movimentacaoEstoque', 'emp-1', { force: true });
    expect(queryClient.getQueryState(['mapa-cache', 'estoqueLotes', 'emp-1', 'default'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['saldo-deposito', 'dep-1'])?.isInvalidated).toBe(true);
    expect(mapa.eventos).toHaveLength(1);
    mapa.parar();
  });

  it('cancelar compra com mercadoria (devolve a entrada do estoque): mesmo aviso forçado ao Mapa e às telas de estoque', async () => {
    const compra = semearDocumento(estado, corpoCompra(), { confirmar: true });
    await montar();
    const mapa = avisosDoMapa();
    const { refreshMapaCacheEntry } = await import('@/services/mapaCacheService');
    await abrir(compra.id);
    await clicar(await screen.findByTestId('botao-cancelar-lancamento'));
    const dialogo = await screen.findByTestId('dialogo-cancelamento');
    fireEvent.change(within(dialogo).getByTestId('dialogo-cancelamento-motivo'), { target: { value: 'Compra desfeita' } });
    await clicar(within(dialogo).getByTestId('dialogo-cancelamento-enviar'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-cancelamento')).toBeNull());
    await waitFor(() => expect(refreshMapaCacheEntry).toHaveBeenCalledWith('estoqueLotes', 'emp-1', { force: true }));
    expect(refreshMapaCacheEntry).toHaveBeenCalledWith('movimentacaoEstoque', 'emp-1', { force: true });
    expect(mapa.eventos).toHaveLength(1);
    mapa.parar();
  });

  it('sem mercadoria (só financeiro): confirmar e registrar baixa NÃO mexem no cache do estoque', async () => {
    const servico = semearDocumento(estado, corpoBase());
    await montar();
    const mapa = avisosDoMapa();
    const { refreshMapaCacheEntry } = await import('@/services/mapaCacheService');
    await abrir(servico.id);
    await clicar(await screen.findByTestId('botao-confirmar-lancamento'));
    await clicar(within(await screen.findByTestId('dialogo-confirmacao')).getByTestId('botao-confirmar-definitivo'));
    await waitFor(() => expect(screen.queryByTestId('dialogo-confirmacao')).toBeNull());
    await pagar('10');
    await waitFor(() => expect(screen.queryByTestId('dialogo-liquidacao')).toBeNull());
    expect(await screen.findByTestId('titulo-1-status')).toHaveTextContent('Parcial');
    expect(refreshMapaCacheEntry).not.toHaveBeenCalled();
    expect(mapa.eventos).toHaveLength(0);
    mapa.parar();
  });
});
