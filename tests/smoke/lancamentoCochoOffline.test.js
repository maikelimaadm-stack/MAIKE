/**
 * D-PROD-296 — lançamento de suplementação no cocho sem internet.
 *
 * Cadeia real `suplementacaoService.registrarLancamentoDoCocho → motor → fila
 * (IndexedDB em memória) → comandos → nativeHttpClient`, com `fetch`
 * substituído por um servidor falso (roteado por método + caminho).
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

/** Servidor falso: deduplica os comandos pelo operation_id, como o de verdade. */
const servidor = () => {
  const s = {
    chamadas: /** @type {Array<{metodo: string, caminho: string, corpo: any}>} */ ([]),
    eventos: [{ id: 'ev-1', empresa_id: EMP, ponto_suplementacao_id: 'c1', data_lancamento: '2026-11-10', quantidade_total_kg: 100, sobra_kg: 0, total_cabecas_afetadas: 50, dias_periodo: null }],
    baixas: new Map(),
    lancamentos: new Map(),
    falharLancamento: /** @type {null | 'rede' | string} */ (null),
    /** D-PROD-300: avisos que a baixa devolve (lote vencido). */
    avisosDaBaixa: /** @type {any[]} */ ([]),
    /** D-PROD-307: quantas vezes o fechamento do período anterior devolve erro interno. */
    falharFechamento: 0,
  };
  s.fetch = vi.fn(async (url, init = {}) => {
    const metodo = init.method || 'GET';
    const caminho = String(url).replace(`${API}/api/native`, '').split('?')[0];
    const corpo = init.body ? JSON.parse(init.body) : undefined;
    s.chamadas.push({ metodo, caminho, corpo });
    if (metodo === 'POST' && caminho === '/movimentacoes-estoque/comandos/saida-suplementacao') {
      if (!s.baixas.has(corpo.operation_id)) s.baixas.set(corpo.operation_id, { id: `mov-${s.baixas.size + 1}`, valor_unitario: 2.5 });
      return respostaJson(201, { committed: true, movimentacao: s.baixas.get(corpo.operation_id), avisos: s.avisosDaBaixa });
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
    if (metodo === 'PATCH' && caminho.startsWith('/suplementacao-eventos/')) {
      if (s.falharFechamento) {
        s.falharFechamento -= 1;
        return respostaJson(500, { code: 'INTERNAL_ERROR', message: 'erro interno' });
      }
      const id = caminho.split('/').pop();
      const ev = s.eventos.find((e) => e.id === id);
      Object.assign(ev, corpo);
      return respostaJson(200, ev);
    }
    if (metodo === 'GET' && caminho === '/suplementacao-eventos') return respostaJson(200, s.eventos);
    if (metodo === 'GET') return respostaJson(200, []);
    return respostaJson(200, {});
  });
  return s;
};

/** Motor do teste em curso: no fim, sai da sessão (um envio agendado que dispare depois não sobe nada). */
let motorDoTeste = null;
const carregar = async () => {
  (await import('@/lib/auth/nativeTokenStorage')).setNativeToken('jwt.sintetico', { lembrar: true });
  (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_1');
  const motor = await import('@/lib/offline/sincronizacao/motorDeSincronizacao');
  motorDoTeste = motor;
  motor.definirSessaoDaFila({ cliente_id: 'cli_1', usuario_id: `usr_${Math.random().toString(36).slice(2, 8)}` });
  const sup = await import('@/services/suplementacaoService');
  const estoque = await import('@/services/estoqueAguardandoEnvioService');
  const aguardando = await import('@/services/lancamentoCochoAguardandoService');
  return { motor, sup: { ...sup, ...aguardando }, estoque };
};

const saidaCorpo = () => ({
  empresa_id: EMP, produto_id: 'prod-1', local_origem_id: 'galpao', local_origem_nome: 'GALPÃO', quantidade: 80,
  area_id: 'a1', area_nome: 'PASTO 1', deposito_id: 'dep-1', ponto_suplementacao_id: 'c1', data_movimentacao: '2026-11-12',
  observacoes: 'Saída automática para o cocho COCHO 1\n[RATEIO_FIFO] NF1: 80.000 kg',
});
const evento = (extra = {}) => ({ empresa_id: EMP, ponto_suplementacao_id: 'c1', ponto_nome: 'COCHO 1', data_lancamento: '2026-11-12', quantidade_total_kg: 80, sobra_kg: 0, ...extra });
const fechamento = () => ({ diasPeriodo: 2, sobraInicial: 0, sobraFinal: 5, sobraInformada: true, compartilhado: false });

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API);
  window.sessionStorage.clear();
  window.localStorage.clear();
  online = true;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
});

afterEach(() => {
  // D-PROD-308: um envio agendado por este teste não pode disparar no seguinte (com o servidor
  // falso do seguinte) e subir o que sobrou deste.
  motorDoTeste?.definirSessaoDaFila(null);
  motorDoTeste = null;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('D-PROD-296 — lançamento do cocho pelo motor', () => {
  it('LCO-01 sem internet: fica no aparelho, aparece como o último do cocho, o anterior aparece fechado e o saldo já desconta a baixa', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { sup, estoque } = await carregar();
    online = false;
    const r = await sup.registrarLancamentoDoCocho(
      { saida: saidaCorpo(), evento: evento(), lotes: [{ lote_id: 'l1' }], eventoAnterior: srv.eventos[0], fechamento: fechamento() },
      { operationId: 'op-lanc-0001', rotulo: 'Lançamento · COCHO 1' }
    );
    expect(r.aguardandoEnvio).toBe(true);
    expect(srv.fetch).not.toHaveBeenCalled();

    const lista = await sup.comLancamentosAguardandoEnvio([{ ...srv.eventos[0] }], EMP, 'c1');
    expect(lista[0]).toMatchObject({ id: 'aguardando:op-lanc-0001', _aguardandoEnvio: true, data_lancamento: '2026-11-12' });
    expect(lista[1]).toMatchObject({ id: 'ev-1', dias_periodo: 2, _fechamentoAguardando: true });

    const lotes = await estoque.comEstoqueAguardandoEnvio([
      { id: 'nf1', empresa_id: EMP, produto_id: 'prod-1', local_estoque_id: 'galpao', status: 'Disponivel', quantidade_disponivel: 100, data_documento: '2026-01-01' },
    ]);
    expect(lotes[0].quantidade_disponivel).toBe(20);

    // D-PROD-301: a baixa aparece no histórico do depósito, com "aguardando envio".
    const { movimentacoesAguardandoEnvio } = await import('@/services/historicoAguardandoEnvioService');
    const [baixa] = await movimentacoesAguardandoEnvio(EMP);
    expect(baixa).toMatchObject({ id: 'aguardando:op-lanc-0001:baixa', tipo_detalhado: 'suplementacao', quantidade: 80, local_estoque_origem: 'galpao', _aguardandoEnvio: true });
  });

  it('LCO-02 ao voltar a internet: baixa, lançamento e fechamento, na ordem e com o MESMO código', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { sup, motor } = await carregar();
    online = false;
    await sup.registrarLancamentoDoCocho(
      { saida: saidaCorpo(), evento: evento(), lotes: [{ lote_id: 'l1' }], eventoAnterior: srv.eventos[0], fechamento: fechamento() },
      { operationId: 'op-lanc-0002' }
    );
    online = true;
    const resumo = await motor.sincronizar();
    expect(resumo).toMatchObject({ aguardando: 0, atencao: 0 });

    const escritas = srv.chamadas.filter((c) => c.metodo !== 'GET');
    expect(escritas[0]).toMatchObject({ caminho: '/movimentacoes-estoque/comandos/saida-suplementacao', corpo: { operation_id: 'op-lanc-0002', quantidade: 80 } });
    expect(escritas[1]).toMatchObject({ caminho: '/suplementacao-eventos/comandos/lancamento-com-lotes', corpo: { operation_id: 'op-lanc-0002', evento_anterior_id: 'ev-1' } });
    expect(escritas[1].corpo.evento).toMatchObject({ movimentacao_estoque_id: 'mov-1', custo_unitario_kg: 2.5 });
    expect(escritas.find((c) => c.metodo === 'PATCH' && c.caminho === '/suplementacao-eventos/ev-1').corpo).toMatchObject({ fechado_por_tipo: 'lancamento', fechado_por_evento_id: 'ev-2' });
  });

  it('LCO-03 dois lançamentos no mesmo cocho sem internet: o 2º cita o 1º e sai depois dele, com o id que o servidor deu', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { sup, motor } = await carregar();
    online = false;
    const primeiro = await sup.registrarLancamentoDoCocho(
      { saida: null, evento: evento(), lotes: [], eventoAnterior: srv.eventos[0], fechamento: fechamento() },
      { operationId: 'op-lanc-0003' }
    );
    const [ultimo] = await sup.comLancamentosAguardandoEnvio([{ ...srv.eventos[0] }], EMP, 'c1');
    expect(ultimo.id).toBe(primeiro.evento.id);
    await sup.registrarLancamentoDoCocho(
      { saida: null, evento: evento({ data_lancamento: '2026-11-14' }), lotes: [], eventoAnterior: ultimo, fechamento: fechamento() },
      { operationId: 'op-lanc-0004' }
    );
    online = true;
    await motor.sincronizar();
    const lancamentos = srv.chamadas.filter((c) => c.caminho === '/suplementacao-eventos/comandos/lancamento-com-lotes');
    expect(lancamentos.map((c) => c.corpo.operation_id)).toEqual(['op-lanc-0003', 'op-lanc-0004']);
    expect(lancamentos[1].corpo.evento_anterior_id).toBe('ev-2');
    expect(srv.chamadas.some((c) => c.metodo === 'PATCH' && c.caminho === '/suplementacao-eventos/ev-2')).toBe(true);
  });

  it('LCO-04 a rede cai depois da baixa: continua na fila; o reenvio repete a MESMA baixa (o servidor devolve a mesma) e conclui', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { sup, motor } = await carregar();
    online = false;
    await sup.registrarLancamentoDoCocho(
      { saida: saidaCorpo(), evento: evento(), lotes: [], eventoAnterior: null, fechamento: null },
      { operationId: 'op-lanc-0005' }
    );
    online = true;
    srv.falharLancamento = 'rede';
    expect((await motor.sincronizar()).aguardando).toBe(1);
    expect(srv.baixas.size).toBe(1);
    const fila = await motor.resumoDaFila();
    // ainda dentro da espera: avança o relógio do item
    expect(fila.itens[0].confirmando).toBe(true);
  });

  it('LCO-05 o servidor recusa o lançamento depois da baixa: "precisa de atenção" com o que fazer', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { sup, motor } = await carregar();
    online = false;
    await sup.registrarLancamentoDoCocho(
      { saida: saidaCorpo(), evento: evento(), lotes: [], eventoAnterior: srv.eventos[0], fechamento: null },
      { operationId: 'op-lanc-0006' }
    );
    online = true;
    srv.falharLancamento = 'LANCAMENTO_DESATUALIZADO';
    const resumo = await motor.sincronizar();
    expect(resumo.atencao).toBe(1);
    expect(resumo.itens[0].ultimo_erro.codigo).toBe('LANCAMENTO_DESATUALIZADO');
    expect(resumo.itens[0].ultimo_erro.mensagem).toMatch(/baixa no estoque já foi feita/);
  });

  it('LCO-06 o cocho mudou (outra pessoa lançou): "Tentar de novo" liga ao lançamento atual e conclui SEM baixar de novo', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { sup, motor } = await carregar();
    online = false;
    const { evento: _e } = await sup.registrarLancamentoDoCocho(
      { saida: saidaCorpo(), evento: evento({ data_lancamento: '2026-11-14' }), lotes: [], eventoAnterior: srv.eventos[0], fechamento: { ...fechamento(), dataFim: '2026-11-14' } },
      { operationId: 'op-lanc-0007' }
    );
    // Outra pessoa lançou no mesmo cocho (ev-2, dia 12) e o servidor passa a recusar o anterior antigo.
    srv.eventos.push({ id: 'ev-2', empresa_id: EMP, ponto_suplementacao_id: 'c1', data_lancamento: '2026-11-12', quantidade_total_kg: 60, sobra_kg: 3, dias_periodo: null, createdAt: '2026-11-12T10:00:00Z' });
    srv.falharLancamento = 'LANCAMENTO_DESATUALIZADO';
    online = true;
    let resumo = await motor.sincronizar();
    expect(resumo.atencao).toBe(1);
    expect(resumo.itens[0].progresso.saida_feita.quantidade).toBe(80);
    expect(srv.baixas.size).toBe(1);

    srv.falharLancamento = null;
    expect(await motor.tentarDeNovo('op-lanc-0007')).toBe(true);
    resumo = await motor.sincronizar();
    expect(resumo).toMatchObject({ aguardando: 0, atencao: 0 });
    expect(srv.baixas.size).toBe(1); // a mesma baixa, não uma segunda
    const lancado = srv.chamadas.filter((c) => c.caminho === '/suplementacao-eventos/comandos/lancamento-com-lotes').pop();
    expect(lancado.corpo.evento_anterior_id).toBe('ev-2');
    const patch = srv.chamadas.find((c) => c.metodo === 'PATCH' && c.caminho === '/suplementacao-eventos/ev-2');
    expect(patch.corpo).toMatchObject({ fechado_por_tipo: 'lancamento', dias_periodo: 2 });
  });

  it('LCO-07 o que já tentou subir não é descontado de novo no saldo do aparelho (o servidor já pode ter)', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { sup, motor, estoque } = await carregar();
    online = false;
    await sup.registrarLancamentoDoCocho(
      { saida: saidaCorpo(), evento: evento(), lotes: [], eventoAnterior: null, fechamento: null },
      { operationId: 'op-lanc-0008' }
    );
    online = true;
    srv.falharLancamento = 'LANCAMENTO_DESATUALIZADO';
    await motor.sincronizar(); // baixa gravada no servidor, lançamento recusado
    // O servidor já mostra 20 kg (100 - 80): o aparelho NÃO tira os 80 de novo.
    const lotes = await estoque.comEstoqueAguardandoEnvio([
      { id: 'nf1', empresa_id: EMP, produto_id: 'prod-1', local_estoque_id: 'galpao', status: 'Disponivel', quantidade_disponivel: 20, data_documento: '2026-01-01' },
    ]);
    expect(lotes[0].quantidade_disponivel).toBe(20);
  });

  it('LCO-08 D-PROD-298: editar o lançamento que não subiu troca na fila (mesmo código); o saldo do formulário não desconta ele mesmo; excluir tira do aparelho', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { sup, motor, estoque } = await carregar();
    online = false;
    const r = await sup.registrarLancamentoDoCocho(
      { saida: saidaCorpo(), evento: evento(), lotes: [], eventoAnterior: srv.eventos[0], fechamento: fechamento() },
      { operationId: 'op-lanc-0009' }
    );
    const edicao = await sup.lancamentoAguardandoParaEditar(r.evento);
    expect(edicao.payload.saida.quantidade).toBe(80);
    const lote = [{ id: 'nf1', empresa_id: EMP, produto_id: 'prod-1', local_estoque_id: 'galpao', status: 'Disponivel', quantidade_disponivel: 100, data_documento: '2026-01-01' }];
    expect((await estoque.comEstoqueAguardandoEnvio(lote))[0].quantidade_disponivel).toBe(20);
    expect((await estoque.comEstoqueAguardandoEnvio(lote, { ignorar: 'op-lanc-0009' }))[0].quantidade_disponivel).toBe(100);

    await sup.alterarLancamentoDoCocho('op-lanc-0009', { saida: { ...saidaCorpo(), quantidade: 50 }, evento: evento({ quantidade_total_kg: 50 }), lotes: [], eventoAnterior: srv.eventos[0], fechamento: fechamento() });
    expect((await estoque.comEstoqueAguardandoEnvio(lote))[0].quantidade_disponivel).toBe(50);
    expect((await motor.resumoDaFila()).aguardando).toBe(1);

    await sup.excluirLancamentoAguardando(r.evento);
    expect((await motor.resumoDaFila()).aguardando).toBe(0);
    expect(srv.fetch).not.toHaveBeenCalled();
  });

  it('LCO-09 D-PROD-298: o que já tentou subir não abre para edição nem se exclui', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { sup } = await carregar();
    srv.falharLancamento = 'rede';
    const r = await sup.registrarLancamentoDoCocho(
      { saida: saidaCorpo(), evento: evento(), lotes: [], eventoAnterior: null, fechamento: null },
      { operationId: 'op-lanc-0010' }
    );
    expect(r.aguardandoEnvio).toBe(true);
    await expect(sup.lancamentoAguardandoParaEditar(r.evento)).rejects.toThrow(/baixa deste lançamento já foi feita|sendo enviado/);
    await expect(sup.excluirLancamentoAguardando(r.evento)).rejects.toThrow(/sendo enviado/);
  });

  it('LCO-11 D-PROD-298: excluir SEM internet o lançamento que já está no servidor: some, o anterior reabre, o estoque volta; sobe depois com o mesmo código', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { sup, motor, estoque } = await carregar();
    const canc = await import('@/services/suplementacaoCancelamentoService');
    const mapa = await import('@/services/mapaCacheService');
    const lancado = { id: 'ev-9', empresa_id: EMP, ponto_suplementacao_id: 'c1', ponto_nome: 'COCHO 1', data_lancamento: '2026-11-12', movimentacao_estoque_id: 'mov-9', dias_periodo: null };
    const anterior = { ...srv.eventos[0], dias_periodo: 2, fechado_por_evento_id: 'ev-9' };
    await mapa.updateMapaCachedData('movimentacaoEstoque', EMP, [{ id: 'mov-9', empresa_id: EMP, produto_id: 'prod-1', local_estoque_origem: 'galpao', quantidade: 80 }]);
    online = false;
    const r = await canc.cancelarLancamentoCochoSemInternet({ evento: lancado, motivo: 'Lançado errado', operationId: 'op-canc-0001' });
    expect(r.estado).toBe('aguardando');

    const lista = await sup.comLancamentosAguardandoEnvio([lancado, anterior], EMP, 'c1');
    expect(lista.map((e) => e.id)).toEqual(['ev-1']);
    expect(lista[0]).toMatchObject({ dias_periodo: null, _reabertoAguardando: true });
    const lotes = await estoque.comEstoqueAguardandoEnvio([{ id: 'nf1', empresa_id: EMP, produto_id: 'prod-1', local_estoque_id: 'galpao', status: 'Disponivel', quantidade_disponivel: 20, data_documento: '2026-01-01' }]);
    expect(lotes.filter((l) => l.local_estoque_id === 'galpao').reduce((t, l) => t + l.quantidade_disponivel, 0)).toBe(100);

    online = true;
    await motor.sincronizar();
    const envio = srv.chamadas.find((c) => c.caminho === '/suplementacao-eventos/ev-9/cancelamento');
    expect(envio.corpo).toMatchObject({ empresa_id: EMP, operation_id: 'op-canc-0001', motivo: 'Lançado errado' });
    expect((await motor.resumoDaFila()).aguardando).toBe(0);
  });

  it('LCO-12 revisão: o anterior de um lançamento em edição é o que ele já cita (nunca o próprio dependente)', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { sup } = await carregar();
    online = false;
    const primeiro = await sup.registrarLancamentoDoCocho(
      { saida: null, evento: evento(), lotes: [], eventoAnterior: srv.eventos[0], fechamento: fechamento() },
      { operationId: 'op-lanc-0012' }
    );
    const [ultimo] = await sup.comLancamentosAguardandoEnvio([{ ...srv.eventos[0] }], EMP, 'c1');
    await sup.registrarLancamentoDoCocho(
      { saida: null, evento: evento({ data_lancamento: '2026-11-14' }), lotes: [], eventoAnterior: ultimo, fechamento: fechamento() },
      { operationId: 'op-lanc-0013' }
    );
    // D-PROD-311: o 1º não se edita enquanto o 2º (feito em cima dele) está na fila.
    await expect(sup.lancamentoAguardandoParaEditar(primeiro.evento)).rejects.toThrow(/Só o último lançamento deste cocho/);
    const edicao2 = await sup.lancamentoAguardandoParaEditar({ _operationId: 'op-lanc-0013' });
    expect(sup.idDoAnteriorCitado(edicao2.payload.evento_anterior_id)).toBe('aguardando:op-lanc-0012');
  });

  it('LCO-13 revisão: excluir da fila o cancelamento feito sem internet devolve o lançamento à tela (nada fica gravado no cache)', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { motor } = await carregar();
    const canc = await import('@/services/suplementacaoCancelamentoService');
    const mapa = await import('@/services/mapaCacheService');
    const lancado = { id: 'ev-20', empresa_id: EMP, ponto_suplementacao_id: 'c1', data_lancamento: '2026-11-12', dias_periodo: null };
    const anterior = { ...srv.eventos[0], dias_periodo: 2, fechado_por_evento_id: 'ev-20' };
    await mapa.updateMapaCachedData('eventosSuplementacao', EMP, [lancado, anterior]);
    online = false;
    const r = await canc.cancelarLancamentoCochoSemInternet({ evento: lancado, motivo: 'x', operationId: 'op-canc-0020' });
    let visto = await mapa.getMapaCachedData('eventosSuplementacao', EMP);
    expect(visto.map((e) => e.id)).toEqual(['ev-1']);
    expect(await motor.descartarDaFila(r.operationId)).toBe(true);
    visto = await mapa.getMapaCachedData('eventosSuplementacao', EMP);
    expect(visto.map((e) => e.id).sort()).toEqual(['ev-1', 'ev-20']);
    expect(visto.find((e) => e.id === 'ev-1').dias_periodo).toBe(2);
  });

  it('LCO-14 com internet e produto com lote (D-PROD-300): a escolha dos lotes vai na baixa e o aviso de vencido volta no resultado', async () => {
    const srv = servidor();
    srv.avisosDaBaixa = [{ tipo: 'lote_vencido', lote: 'VELHO', validade: '2026-11-01' }];
    vi.stubGlobal('fetch', srv.fetch);
    const { sup } = await carregar();
    const lotes = [{ estoque_lote_nota_id: 'cA', quantidade: '80' }];
    const r = await sup.registrarLancamentoDoCocho(
      { saida: { ...saidaCorpo(), lotes }, evento: evento(), lotes: [{ lote_id: 'l1' }], eventoAnterior: null, fechamento: null },
      { operationId: 'op-lanc-0014' }
    );
    expect(r.aguardandoEnvio).toBe(false);
    expect(r.avisos).toEqual(srv.avisosDaBaixa);
    // A baixa DESTE registro: um registro que outro caso deixou guardado sem internet
    // (o motor dele continua vivo depois do `resetModules`) pode subir por este servidor.
    const baixa = srv.chamadas.find(
      (c) => c.caminho === '/movimentacoes-estoque/comandos/saida-suplementacao' && c.corpo?.operation_id === 'op-lanc-0014'
    );
    expect(baixa?.corpo).toMatchObject({ operation_id: 'op-lanc-0014', lotes });
  });

  it('LCO-15 D-PROD-307: erro passageiro do servidor no FECHAMENTO do anterior não dá o lançamento como enviado — fica na fila e fecha depois', async () => {
    const srv = servidor();
    srv.falharFechamento = 1;
    vi.stubGlobal('fetch', srv.fetch);
    const { sup, motor } = await carregar();
    const r = await sup.registrarLancamentoDoCocho(
      { saida: saidaCorpo(), evento: evento(), lotes: [{ lote_id: 'l1' }], eventoAnterior: srv.eventos[0], fechamento: fechamento() },
      { operationId: 'op-lanc-0015' }
    );
    // Com internet: baixa e lançamento gravados; o fechamento falhou de passagem → na fila (não perdido).
    expect(r.aguardandoEnvio).toBe(true);
    expect(srv.eventos[0].dias_periodo).toBeNull();
    expect((await motor.resumoDaFila()).aguardando).toBe(1);

    // A próxima passada termina: sem baixar nem lançar de novo, fecha o período anterior.
    await motor.tentarDeNovo?.('op-lanc-0015');
    await motor.sincronizar();
    expect(srv.baixas.size).toBe(1);
    expect(srv.lancamentos.size).toBe(1);
    expect(srv.eventos[0]).toMatchObject({ fechado_por_evento_id: 'ev-2' });
    expect((await motor.resumoDaFila()).aguardando).toBe(0);
  });
});

describe('D-PROD-310 — a unidade de conversão no lançamento do cocho sem internet', () => {
  it('LCO-16 o corpo da baixa (montado pela tela) leva a unidade e a quantidade digitada; a fila guarda e sobe IGUAL (campos aditivos), a visão do aparelho desconta em kg', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { sup, motor, estoque } = await carregar();
    const { montarCorpoDaSaidaSuplementacao } = await import('@/services/suplementacaoEstoqueService');
    const lotesNota = [{ id: 'nf1', empresa_id: EMP, produto_id: 'prod-1', local_estoque_id: 'galpao', status: 'Disponivel', quantidade_disponivel: 100, data_documento: '2026-01-01' }];
    const corpo = montarCorpoDaSaidaSuplementacao({
      empresaId: EMP, produto: { id: 'prod-1' }, quantidade: 75, localOrigemId: 'galpao', localOrigemNome: 'GALPÃO', lotesNota,
      dataMovimentacao: '2026-11-12', unidadeLancamento: 'SACO', quantidadeLancamento: '3',
    });
    expect(corpo).toMatchObject({ quantidade: 75, unidade_lancamento: 'SACO', quantidade_lancamento: '3' });
    // Sem unidade: o corpo de sempre (nenhuma chave nova).
    const semUnidade = montarCorpoDaSaidaSuplementacao({ empresaId: EMP, produto: { id: 'prod-1' }, quantidade: 75, localOrigemId: 'galpao', lotesNota });
    expect(semUnidade).not.toHaveProperty('unidade_lancamento');
    expect(semUnidade).not.toHaveProperty('quantidade_lancamento');

    online = false;
    await sup.registrarLancamentoDoCocho(
      { saida: { ...corpo, ponto_suplementacao_id: 'c1' }, evento: evento({ quantidade_total_kg: 75, unidade_lancamento: 'SACO', quantidade_lancamento: 3 }), lotes: [], eventoAnterior: srv.eventos[0], fechamento: fechamento() },
      { operationId: 'op-lanc-ucl1' }
    );
    const registro = await motor.registroNaFila('op-lanc-ucl1');
    expect(registro.payload.saida).toMatchObject({ quantidade: 75, unidade_lancamento: 'SACO', quantidade_lancamento: '3' });
    const vistos = await estoque.comEstoqueAguardandoEnvio(lotesNota);
    expect(vistos[0].quantidade_disponivel).toBe(25);

    online = true;
    await motor.sincronizar();
    const baixa = srv.chamadas.find((c) => c.caminho === '/movimentacoes-estoque/comandos/saida-suplementacao');
    expect(baixa.corpo).toMatchObject({ operation_id: 'op-lanc-ucl1', quantidade: 75, unidade_lancamento: 'SACO', quantidade_lancamento: '3' });
  });
});

