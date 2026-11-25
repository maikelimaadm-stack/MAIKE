/**
 * D-PROD-311 — só o último da sequência; revisão geral (lote, nutrição, depósito).
 *
 * NU-01 número: "12.5" é 12,5 (não 125); "12.00" é 12; "1.234,56" é 1234,56
 * ES-01 saldo sem internet: o destino recebe só o que saiu da origem (não inventa estoque)
 * CA-01 cancelamento recusado ("precisa de atenção") não esconde o original da tela
 * TR-01 excluir sem internet a transferência com registro posterior aguardando no mesmo estoque: não sai
 * TR-02 excluir sem internet a transferência com movimento posterior no histórico do aparelho: não sai
 * NL-01 nutrição feita sem internet desta fazenda aparece como pendência (bloqueia excluir movimentação do lote)
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/apis/_core/nativeHttpClient.js', () => ({ nativeRequest: vi.fn(async () => []) }));

describe('D-PROD-311 — número', () => {
  it('NU-01 ponto decimal de máquina e vírgula brasileira', async () => {
    const { parseNumber } = await import('@/components/utils/pecuariaUtils');
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('12.00')).toBe(12);
    expect(parseNumber('50.00')).toBe(50);
    expect(parseNumber('2.0')).toBe(2);
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber(' 7 ')).toBe(7);
    expect(parseNumber('')).toBe(0);
    expect(parseNumber(null)).toBe(0);
    expect(parseNumber('abc')).toBe(0);
    expect(parseNumber(3.5)).toBe(3.5);
  });
});

describe('D-PROD-311 — saldo sem internet', () => {
  it('ES-01 o destino recebe só o que saiu da origem', async () => {
    const { aplicarMovimentosAosLotes } = await import('@/services/estoqueAguardandoEnvioService');
    const lotes = [
      { id: 'l1', empresa_id: 'e', produto_id: 'p', local_estoque_id: 'DEP', status: 'Disponivel', quantidade_disponivel: 20, data_documento: '2026-11-01' },
    ];
    // Desfazer uma transferência de 50 (o depósito já usou 30): volta só 20.
    const r = aplicarMovimentosAosLotes(lotes, [
      { operationId: 'op', empresa_id: 'e', produto_id: 'p', local_origem_id: 'DEP', local_destino_id: 'GALPAO', quantidade: 50 },
    ]);
    const total = (local) => r.filter((l) => l.local_estoque_id === local).reduce((t, l) => t + Number(l.quantidade_disponivel), 0);
    expect(total('DEP')).toBe(0);
    expect(total('GALPAO')).toBe(20);
    expect(total('DEP') + total('GALPAO')).toBe(20); // nada inventado
  });
});

describe('D-PROD-311 — fila do aparelho', () => {
  let motor;
  let fila;
  beforeEach(async () => {
    vi.resetModules();
    motor = await import('@/lib/offline/sincronizacao/motorDeSincronizacao');
    const { criarFilaEmMemoria } = await import('@/lib/offline/sincronizacao/filaDeEnvio');
    fila = criarFilaEmMemoria();
    motor.configurarMotorDeSincronizacao({ porta: fila, agora: () => Date.parse('2026-11-25T12:00:00Z'), online: () => false });
    motor.definirSessaoDaFila({ cliente_id: 'cli', usuario_id: 'u' });
  });

  it('CA-01 cancelamento recusado não esconde o original', async () => {
    const tipos = await import('@/lib/offline/sincronizacao/tiposDeEnvio');
    motor.registrarTipoDeEnvio({ tipo: tipos.TIPO_CANCELAMENTO_TRANSFERENCIA, versao: 1, offline: true, enviar: async () => ({}) });
    const r = await motor.enviarOuGuardar(tipos.TIPO_CANCELAMENTO_TRANSFERENCIA, { movimentacao_id: 'mov-1' }, { operationId: 'op-c' });
    const { comTransferenciasCanceladasAguardando } = await import('@/services/cancelamentosAguardandoService');
    const movs = [{ id: 'mov-1', status: 'Ativa' }];
    expect((await comTransferenciasCanceladasAguardando(movs))[0].status).toBe('Estornada');
    const item = await fila.ler(r.operationId);
    await fila.gravar({ ...item, estado: 'atencao' });
    expect((await comTransferenciasCanceladasAguardando(movs))[0].status).toBe('Ativa');
  });

  it('TR-01 transferência com registro posterior aguardando no mesmo estoque não sai sem internet', async () => {
    const tipos = await import('@/lib/offline/sincronizacao/tiposDeEnvio');
    motor.registrarTipoDeEnvio({ tipo: 'cocho.lancamento', versao: 1, offline: true, recursos: (p) => [`estoque:${p.deposito}`], rotulo: () => 'Lançamento no cocho', enviar: async () => ({}) });
    await motor.enviarOuGuardar('cocho.lancamento', { deposito: 'DEP' });
    const servico = await import('@/services/suplementacaoEstoqueService');
    await expect(
      servico.cancelarTransferenciaSemInternet({
        movimento: { id: 'mov-1', produto_id: 'p', local_estoque_origem: 'GALPAO', local_estoque_destino: 'DEP', data_movimentacao: '2026-11-20' },
        empresaId: 'e',
        motivo: 'x',
        operationId: 'op-canc',
      })
    ).rejects.toThrow(/Lançamento no cocho/);
    expect(await fila.ler('op-canc')).toBeUndefined();
    void tipos;
  });

  it('TR-02 transferência com movimento posterior no histórico do aparelho não sai sem internet', async () => {
    const mapa = await import('@/services/mapaCacheService');
    await mapa.updateMapaCachedData('movimentacaoEstoque', 'e', [
      { id: 'mov-1', produto_id: 'p', local_estoque_origem: 'GALPAO', local_estoque_destino: 'DEP', data_movimentacao: '2026-11-20', created_date: '2026-11-20T10:00:00Z', status: 'Ativa' },
      { id: 'mov-2', produto_id: 'p', local_estoque_origem: 'DEP', data_movimentacao: '2026-11-21', created_date: '2026-11-21T10:00:00Z', status: 'Ativa' },
    ]);
    const servico = await import('@/services/suplementacaoEstoqueService');
    await expect(
      servico.cancelarTransferenciaSemInternet({
        movimento: { id: 'mov-1', produto_id: 'p', local_estoque_origem: 'GALPAO', local_estoque_destino: 'DEP', data_movimentacao: '2026-11-20', created_date: '2026-11-20T10:00:00Z' },
        empresaId: 'e',
        motivo: 'x',
        operationId: 'op-canc-2',
      })
    ).rejects.toThrow(/Exclua primeiro a mais recente/);
  });

  it('NL-01 nutrição sem internet desta fazenda é pendência (a de outra fazenda, não)', async () => {
    const tipos = await import('@/lib/offline/sincronizacao/tiposDeEnvio');
    motor.registrarTipoDeEnvio({ tipo: tipos.TIPO_LANCAMENTO_COCHO, versao: 1, offline: true, enviar: async () => ({}) });
    await motor.enviarOuGuardar(tipos.TIPO_LANCAMENTO_COCHO, { evento: { empresa_id: 'e1' } });
    const { nutricaoAguardandoEnvio } = await import('@/services/sincronizacaoService');
    expect(await nutricaoAguardandoEnvio('e1')).toHaveLength(1);
    expect(await nutricaoAguardandoEnvio('e2')).toHaveLength(0);
  });
});
