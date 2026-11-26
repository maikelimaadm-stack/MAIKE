/**
 * D-PROD-318 — Etapa 4 da sincronização: a tela nunca "pisca".
 *
 * Enquanto um registro espera a confirmação do servidor, toda tela mostra o mesmo estado; a troca pela cópia do
 * servidor acontece sem o registro sumir e voltar, sem aparecer duas vezes e sem o saldo pular.
 *
 * TN-01 lançamento confirmado: aparece com o id real até a lista do servidor trazê-lo; depois, uma vez só
 * TN-02 tentou sem resposta (a baixa já foi): sem internet aparece "aguardando"; com internet não aparece em dobro;
 *       a baixa aparece no histórico do depósito com o id real, nos dois casos
 * TN-03 histórico do depósito: casa pelo id (nem buraco, nem em dobro) depois da confirmação
 * TN-04 saldo: o que tentou só desconta se a cópia dos lotes é de ANTES da 1ª tentativa; hora desconhecida, como antes
 * TN-05 a hora da cópia vem da leitura dos lotes (memória e, depois de reabrir o app, a gravada junto da cópia)
 * TN-06 o saldo não pula: lotes lidos → lançamento sem internet → sobe (resposta perdida) → lotes relidos
 * TN-07 o cancelamento confirmado há pouco continua escondendo o original até a lista ser relida
 * TN-08 recusado ("precisa de atenção") continua na lista do cocho e não vale no saldo nem no histórico
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const API = 'https://backend.exemplo.invalido';
const EMP = 'emp-1';

const respostaJson = (status, corpo) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)),
});

let online = true;

const loteInicial = () => ({ id: 'nf1', empresa_id: EMP, produto_id: 'prod-1', local_estoque_id: 'galpao', status: 'Disponivel', quantidade_disponivel: 100, data_documento: '2026-01-01' });

/** Servidor falso: deduplica os comandos pelo operation_id, como o de verdade. */
const servidor = () => {
  const s = {
    chamadas: /** @type {Array<{metodo: string, caminho: string, corpo: any}>} */ ([]),
    eventos: [{ id: 'ev-1', empresa_id: EMP, ponto_suplementacao_id: 'c1', data_lancamento: '2026-11-10', quantidade_total_kg: 100, sobra_kg: 0, dias_periodo: null }],
    lotes: [loteInicial()],
    baixas: new Map(),
    lancamentos: new Map(),
    falharLancamento: /** @type {null | 'rede' | string} */ (null),
  };
  s.fetch = vi.fn(async (url, init = {}) => {
    const metodo = init.method || 'GET';
    const caminho = String(url).replace(`${API}/api/native`, '').split('?')[0];
    const corpo = init.body ? JSON.parse(init.body) : undefined;
    s.chamadas.push({ metodo, caminho, corpo });
    if (metodo === 'POST' && caminho === '/movimentacoes-estoque/comandos/saida-suplementacao') {
      if (!s.baixas.has(corpo.operation_id)) {
        s.baixas.set(corpo.operation_id, { id: `mov-${s.baixas.size + 1}`, valor_unitario: 2.5, empresa_id: EMP, quantidade: corpo.quantidade, local_estoque_origem: corpo.local_origem_id, tipo_movimentacao: 'Saída' });
        s.lotes = s.lotes.map((l) => (l.local_estoque_id === corpo.local_origem_id ? { ...l, quantidade_disponivel: l.quantidade_disponivel - corpo.quantidade } : l));
      }
      return respostaJson(201, { committed: true, movimentacao: s.baixas.get(corpo.operation_id), avisos: [] });
    }
    if (metodo === 'POST' && caminho === '/suplementacao-eventos/comandos/lancamento-com-lotes') {
      if (s.falharLancamento === 'rede') {
        s.falharLancamento = null;
        throw new TypeError('Failed to fetch');
      }
      if (s.falharLancamento) return respostaJson(409, { code: s.falharLancamento, message: 'o cocho mudou' });
      if (!s.lancamentos.has(corpo.operation_id)) {
        const ev = { ...corpo.evento, id: `ev-${s.eventos.length + 1}`, dias_periodo: null };
        s.eventos.push(ev);
        s.lancamentos.set(corpo.operation_id, ev);
      }
      return respostaJson(201, { committed: true, evento: s.lancamentos.get(corpo.operation_id) });
    }
    if (metodo === 'GET' && caminho === '/suplementacao-eventos') return respostaJson(200, s.eventos);
    if (metodo === 'GET' && caminho === '/estoque-lotes-nota') return respostaJson(200, s.lotes);
    if (metodo === 'GET') return respostaJson(200, []);
    return respostaJson(200, { committed: true });
  });
  return s;
};

let motorDoTeste = null;
const carregar = async (usuario = `usr_${Math.random().toString(36).slice(2, 8)}`) => {
  (await import('@/lib/auth/nativeTokenStorage')).setNativeToken('jwt.sintetico', { lembrar: true });
  (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_1');
  const motor = await import('@/lib/offline/sincronizacao/motorDeSincronizacao');
  motorDoTeste = motor;
  motor.definirSessaoDaFila({ cliente_id: 'cli_1', usuario_id: usuario });
  const sup = await import('@/services/suplementacaoService');
  const cocho = await import('@/services/lancamentoCochoAguardandoService');
  const estoque = await import('@/services/estoqueAguardandoEnvioService');
  const historico = await import('@/services/historicoAguardandoEnvioService');
  const cancelamento = await import('@/services/suplementacaoCancelamentoService');
  return { motor, sup, cocho, estoque, historico, cancelamento };
};

const saidaCorpo = () => ({
  empresa_id: EMP, produto_id: 'prod-1', local_origem_id: 'galpao', local_origem_nome: 'GALPÃO', quantidade: 80,
  area_id: 'a1', area_nome: 'PASTO 1', deposito_id: 'dep-1', ponto_suplementacao_id: 'c1', data_movimentacao: '2026-11-12',
  observacoes: 'Saída automática para o cocho COCHO 1',
});
const evento = () => ({ empresa_id: EMP, ponto_suplementacao_id: 'c1', ponto_nome: 'COCHO 1', data_lancamento: '2026-11-12', quantidade_total_kg: 80, sobra_kg: 0 });

/** Lança sem internet (fica no aparelho). */
const lancarSemInternet = async (sup, operationId, { comSaida = true } = {}) => {
  online = false;
  const r = await sup.registrarLancamentoDoCocho(
    { saida: comSaida ? saidaCorpo() : null, evento: evento(), lotes: [], eventoAnterior: null, fechamento: null },
    { operationId }
  );
  expect(r.aguardandoEnvio).toBe(true);
  return r;
};

const saldo = (lotes) => lotes.filter((l) => l.local_estoque_id === 'galpao').reduce((t, l) => t + l.quantidade_disponivel, 0);
const umInstante = () => new Promise((r) => setTimeout(r, 5));

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API);
  window.sessionStorage.clear();
  window.localStorage.clear();
  online = true;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
});

afterEach(() => {
  motorDoTeste?.definirSessaoDaFila(null);
  motorDoTeste = null;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('D-PROD-318 — lista do cocho', () => {
  it('TN-01 confirmado: aparece com o id real até a lista do servidor trazê-lo; depois, uma vez só', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { sup, cocho, motor } = await carregar();
    await lancarSemInternet(sup, 'op-tn01-0001', { comSaida: false });
    online = true;
    expect((await motor.sincronizar()).aguardando).toBe(0);

    // A lista do servidor na tela ainda é a de antes (só ev-1): o confirmado não some.
    const antes = await cocho.comLancamentosAguardandoEnvio([{ ...srv.eventos[0] }], EMP, 'c1');
    expect(antes.map((e) => e.id)).toEqual(['ev-2', 'ev-1']);
    expect(antes[0]).toMatchObject({ _confirmadoAgora: true, data_lancamento: '2026-11-12' });
    expect(antes.some((e) => String(e.id).startsWith('aguardando:'))).toBe(false);

    // Relida: o servidor traz ev-2 — aparece uma vez só, a do servidor.
    const depois = await cocho.comLancamentosAguardandoEnvio(srv.eventos.map((e) => ({ ...e })), EMP, 'c1');
    expect(depois.map((e) => e.id).sort()).toEqual(['ev-1', 'ev-2']);
    expect(depois.find((e) => e.id === 'ev-2')._confirmadoAgora).toBeUndefined();
  });

  it('TN-02 tentou sem resposta: sem internet "aguardando"; com internet nada em dobro; a baixa com o id real', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { sup, cocho, motor, historico } = await carregar();
    await lancarSemInternet(sup, 'op-tn02-0001');
    online = true;
    srv.falharLancamento = 'rede';
    expect((await motor.sincronizar()).aguardando).toBe(1); // a baixa foi; o lançamento ficou

    const comInternet = await cocho.comLancamentosAguardandoEnvio([{ ...srv.eventos[0] }], EMP, 'c1');
    expect(comInternet.map((e) => e.id)).toEqual(['ev-1']);
    online = false;
    const semInternet = await cocho.comLancamentosAguardandoEnvio([{ ...srv.eventos[0] }], EMP, 'c1');
    expect(semInternet.map((e) => e.id)).toEqual(['aguardando:op-tn02-0001', 'ev-1']);

    // A baixa já está no servidor: o histórico a mostra com o id real (com e sem internet).
    for (const estado of [false, true]) {
      online = estado;
      const movs = await historico.movimentacoesAguardandoEnvio(EMP);
      expect(movs).toHaveLength(1);
      expect(movs[0]).toMatchObject({ id: 'mov-1', origem_sistema: 'suplementacao', _baixaFeita: true });
    }
  });

  it('TN-08 recusado ("precisa de atenção"): continua na lista do cocho; não vale no saldo nem no histórico', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { sup, cocho, motor, estoque, historico } = await carregar();
    await lancarSemInternet(sup, 'op-tn08-0001', { comSaida: false });
    online = true;
    srv.falharLancamento = 'PONTO_SUPLEMENTACAO_OUTRO_LANCAMENTO';
    expect((await motor.sincronizar()).atencao).toBe(1);
    const lista = await cocho.comLancamentosAguardandoEnvio([{ ...srv.eventos[0] }], EMP, 'c1');
    expect(lista.map((e) => e.id)).toEqual(['aguardando:op-tn08-0001', 'ev-1']);
    expect(saldo(await estoque.comEstoqueAguardandoEnvio([loteInicial()], { copiaDe: 0 }))).toBe(100);
    expect(await historico.movimentacoesAguardandoEnvio(EMP)).toEqual([]);
  });
});

describe('D-PROD-318 — histórico do depósito', () => {
  it('TN-03 depois da confirmação: casa pelo id — nem buraco, nem em dobro', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { sup, motor, historico } = await carregar();
    await lancarSemInternet(sup, 'op-tn03-0001');
    const [aguardando] = await historico.comMovimentacoesDoAparelho([], EMP);
    expect(aguardando).toMatchObject({ id: 'aguardando:op-tn03-0001:baixa', _aguardandoEnvio: true });

    online = true;
    await motor.sincronizar();
    // A lista do servidor na tela é a de antes: a baixa continua, agora com o id real.
    const antes = await historico.comMovimentacoesDoAparelho([], EMP);
    expect(antes.map((m) => m.id)).toEqual(['mov-1']);
    expect(antes[0]._confirmadoAgora).toBe(true);
    // Relida: a do servidor, uma vez só.
    const daLista = { id: 'mov-1', empresa_id: EMP, quantidade: 80 };
    const depois = await historico.comMovimentacoesDoAparelho([daLista], EMP);
    expect(depois).toEqual([daLista]);
  });
});

describe('D-PROD-318 — saldo pela hora da cópia', () => {
  it('TN-04 o que tentou só desconta se a cópia é de antes da 1ª tentativa; sem hora, como antes', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { sup, motor, estoque } = await carregar();
    const antesDeTudo = Date.now() - 1000;
    await lancarSemInternet(sup, 'op-tn04-0001');
    // Nunca tentou: desconta sempre.
    expect(saldo(await estoque.comEstoqueAguardandoEnvio([loteInicial()], { copiaDe: null }))).toBe(20);

    online = true;
    srv.falharLancamento = 'rede';
    await motor.sincronizar();
    await umInstante();
    const depoisDaTentativa = Date.now();
    // Cópia de antes da tentativa (não pode ter a baixa): desconta — o saldo não volta a 100.
    expect(saldo(await estoque.comEstoqueAguardandoEnvio([loteInicial()], { copiaDe: antesDeTudo }))).toBe(20);
    // Cópia de depois (pode ter a baixa): não desconta de novo.
    expect(saldo(await estoque.comEstoqueAguardandoEnvio([{ ...loteInicial(), quantidade_disponivel: 20 }], { copiaDe: depoisDaTentativa }))).toBe(20);
    // Hora desconhecida: como antes (só o que nunca tentou).
    expect(saldo(await estoque.comEstoqueAguardandoEnvio([loteInicial()], { copiaDe: null }))).toBe(100);
    // A data também vale em texto (ISO).
    expect(saldo(await estoque.comEstoqueAguardandoEnvio([loteInicial()], { copiaDe: new Date(antesDeTudo).toISOString() }))).toBe(20);

    // Confirmado (dentro da janela): a mesma regra. (`tentarDeNovo` pula a espera depois da falha; a hora da 1ª
    // tentativa fica.)
    await motor.tentarDeNovo('op-tn04-0001');
    await motor.sincronizar();
    expect((await motor.resumoDaFila()).aguardando).toBe(0);
    expect(saldo(await estoque.comEstoqueAguardandoEnvio([loteInicial()], { copiaDe: antesDeTudo }))).toBe(20);
    expect(saldo(await estoque.comEstoqueAguardandoEnvio([{ ...loteInicial(), quantidade_disponivel: 20 }], { copiaDe: Date.now() + 1 }))).toBe(20);
  });

  it('TN-05 a hora da cópia vem da leitura dos lotes; depois de reabrir o app, da gravada junto da cópia', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { estoque } = await carregar('usr_tn05');
    expect(await estoque.horaDaCopiaDosLotes()).toBeNull();
    const { nativeRequest } = await import('@/apis/_core/nativeHttpClient.js');
    const antes = Date.now();
    await nativeRequest('/estoque-lotes-nota', { autenticado: true }, { operation: 'teste', resource: 'EstoqueLoteNota' });
    const hora = await estoque.horaDaCopiaDosLotes();
    expect(hora).toBeGreaterThanOrEqual(antes);
    expect(hora).toBeLessThanOrEqual(Date.now());

    // "Reabrir o app": memória vazia; vale a hora gravada junto da cópia.
    await umInstante();
    vi.resetModules();
    const reaberto = await carregar('usr_tn05');
    await vi.waitFor(async () => expect(await reaberto.estoque.horaDaCopiaDosLotes()).toBe(hora));

    // Sem internet, a cópia servida traz a mesma hora.
    online = false;
    const { nativeRequest: deNovo } = await import('@/apis/_core/nativeHttpClient.js');
    await deNovo('/estoque-lotes-nota', { autenticado: true }, { operation: 'teste', resource: 'EstoqueLoteNota' });
    expect(await reaberto.estoque.horaDaCopiaDosLotes()).toBe(hora);
  });

  it('TN-06 o saldo não pula: lotes lidos → lançamento sem internet → sobe sem resposta → lotes relidos', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { sup, motor, estoque } = await carregar('usr_tn06');
    const { nativeRequest } = await import('@/apis/_core/nativeHttpClient.js');
    const lerLotes = () => nativeRequest('/estoque-lotes-nota', { autenticado: true }, { operation: 'teste', resource: 'EstoqueLoteNota' });
    const visto = [];

    const copia1 = await lerLotes();
    visto.push(saldo(await estoque.comEstoqueAguardandoEnvio(copia1)));
    await umInstante();
    await lancarSemInternet(sup, 'op-tn06-0001');
    visto.push(saldo(await estoque.comEstoqueAguardandoEnvio(copia1)));
    online = true;
    srv.falharLancamento = 'rede';
    await umInstante();
    await motor.sincronizar(); // a baixa foi ao servidor; o lançamento ficou (tentado)
    // A tela ainda tem a cópia de antes (de antes da tentativa): continua 20, não volta a 100.
    visto.push(saldo(await estoque.comEstoqueAguardandoEnvio(copia1)));
    await umInstante();
    const copia2 = await lerLotes(); // o servidor já tem a baixa: 20
    visto.push(saldo(await estoque.comEstoqueAguardandoEnvio(copia2)));
    await motor.tentarDeNovo('op-tn06-0001');
    await motor.sincronizar(); // confirmado
    expect((await motor.resumoDaFila()).aguardando).toBe(0);
    visto.push(saldo(await estoque.comEstoqueAguardandoEnvio(copia2)));
    await umInstante();
    visto.push(saldo(await estoque.comEstoqueAguardandoEnvio(await lerLotes())));
    expect(visto).toEqual([100, 20, 20, 20, 20, 20]);
  });
});

describe('D-PROD-318 — cancelamento', () => {
  it('TN-07 o cancelamento confirmado há pouco continua escondendo o original até a lista ser relida', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { motor, cocho, cancelamento } = await carregar();
    online = false;
    await cancelamento.cancelarLancamentoCochoSemInternet({ evento: { ...srv.eventos[0] }, motivo: 'errado', operationId: 'op-tn07-0001' });
    expect((await cocho.comLancamentosAguardandoEnvio([{ ...srv.eventos[0] }], EMP, 'c1')).map((e) => e.id)).toEqual([]);
    online = true;
    await motor.sincronizar();
    expect((await motor.resumoDaFila()).aguardando).toBe(0);
    // A lista do servidor na tela ainda traz ev-1 (é de antes): não volta a aparecer.
    expect((await cocho.comLancamentosAguardandoEnvio([{ ...srv.eventos[0] }], EMP, 'c1')).map((e) => e.id)).toEqual([]);
  });
});
