/**
 * D-PROD-295 — motor de sincronização genérico.
 *
 * Fila em memória (a mesma porta do IndexedDB), relógio e rede controlados.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  configurarMotorDeSincronizacao,
  registrarTipoDeEnvio,
  definirSessaoDaFila,
  enviarOuGuardar,
  sincronizar,
  resumoDaFila,
  referenciaAoResultado,
  tentarDeNovo,
  descartarDaFila,
  temRegistrosNaoEnviados,
  registrosAguardandoDoTipo,
  tiposDeEnvioRegistrados,
  FORMATO_DA_FILA,
} from '@/lib/offline/sincronizacao/motorDeSincronizacao';
import { criarFilaEmMemoria } from '@/lib/offline/sincronizacao/filaDeEnvio';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

const semRede = () => new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, { operation: 't', resource: 'T' });
const recusa = (code) => new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, { operation: 't', resource: 'T', cause: { code } });

let relogio;
let temRede;
let fila;

const montar = () => {
  relogio = Date.parse('2026-11-24T12:00:00Z');
  temRede = true;
  fila = criarFilaEmMemoria();
  configurarMotorDeSincronizacao({ porta: fila, agora: () => relogio, online: () => temRede });
  definirSessaoDaFila({ cliente_id: 'cli_1', usuario_id: 'usr_1' });
};

/** Tipo de teste: grava num "servidor" em memória, deduplicando pelo código. */
const servidorFalso = () => {
  const gravados = new Map();
  const enviar = vi.fn(async (payload, { operationId }) => {
    if (!gravados.has(operationId)) gravados.set(operationId, { id: `srv_${gravados.size + 1}`, ...payload });
    return { registro: gravados.get(operationId) };
  });
  return { gravados, enviar };
};

beforeEach(montar);

describe('D-PROD-295 — contrato do tipo', () => {
  it('MS-01 cada tipo declara nome "modulo.acao", versão e offline sim/não', () => {
    const enviar = async () => ({});
    expect(() => registrarTipoDeEnvio({ tipo: 'semponto', versao: 1, offline: true, enviar })).toThrow();
    expect(() => registrarTipoDeEnvio({ tipo: 'a.b', versao: 0, offline: true, enviar })).toThrow();
    expect(() => registrarTipoDeEnvio(/** @type {any} */ ({ tipo: 'a.b', versao: 1, enviar }))).toThrow(/offline/);
    registrarTipoDeEnvio({ tipo: 'app.futura', versao: 1, offline: false, enviar });
    registrarTipoDeEnvio({ tipo: 'cocho.leitura', versao: 2, offline: true, enviar });
    expect(tiposDeEnvioRegistrados()).toEqual([
      { tipo: 'app.futura', versao: 1, offline: false },
      { tipo: 'cocho.leitura', versao: 2, offline: true },
    ]);
  });
});

describe('D-PROD-295 — com e sem internet', () => {
  it('MS-02 com internet vai direto, sem passar pela fila', async () => {
    const s = servidorFalso();
    registrarTipoDeEnvio({ tipo: 'cocho.leitura', versao: 1, offline: true, enviar: s.enviar });
    const r = await enviarOuGuardar('cocho.leitura', { escore: 2 });
    expect(r.estado).toBe('enviado');
    expect(await fila.listar()).toEqual([]);
  });

  it('MS-03 sem internet guarda; ao voltar, envia com o MESMO código', async () => {
    const s = servidorFalso();
    registrarTipoDeEnvio({ tipo: 'cocho.leitura', versao: 1, offline: true, enviar: s.enviar, rotulo: (p) => `Leitura ${p.escore}` });
    temRede = false;
    const r = await enviarOuGuardar('cocho.leitura', { escore: 2 }, { empresaId: 'emp_1' });
    expect(r.estado).toBe('aguardando');
    expect(s.enviar).not.toHaveBeenCalled();
    const resumo = await resumoDaFila();
    expect(resumo.aguardando).toBe(1);
    expect(resumo.itens[0].rotulo).toBe('Leitura 2');
    const [item] = await fila.listar();
    expect(item.formato).toBe(FORMATO_DA_FILA);
    expect(item.cliente_id).toBe('cli_1');

    temRede = true;
    await sincronizar();
    expect(s.enviar).toHaveBeenCalledTimes(1);
    expect(s.enviar.mock.calls[0][1]).toEqual({ operationId: r.operationId, empresaId: 'emp_1' });
    expect((await resumoDaFila()).aguardando).toBe(0);
  });

  it('MS-04 rede cai no meio do envio: guarda com o mesmo código, e o reenvio não duplica', async () => {
    const s = servidorFalso();
    let primeira = true;
    registrarTipoDeEnvio({
      tipo: 'cocho.leitura', versao: 1, offline: true,
      enviar: async (p, ctx) => {
        const r = await s.enviar(p, ctx); // o servidor GRAVOU...
        if (primeira) { primeira = false; throw semRede(); } // ...mas a resposta se perdeu
        return r;
      },
    });
    const r = await enviarOuGuardar('cocho.leitura', { escore: 1 });
    expect(r.estado).toBe('aguardando');
    await sincronizar();
    expect(s.gravados.size).toBe(1);
    expect((await resumoDaFila()).aguardando).toBe(0);
  });

  it('MS-05 tipo com offline: false recusa sem internet e não guarda', async () => {
    registrarTipoDeEnvio({ tipo: 'app.futura', versao: 1, offline: false, enviar: async () => ({}) });
    temRede = false;
    await expect(enviarOuGuardar('app.futura', {})).rejects.toMatchObject({ code: API_ERROR_CODES.PROVIDER_UNAVAILABLE });
    expect(await fila.listar()).toEqual([]);
  });

  it('MS-06 com internet e o servidor recusando, o erro volta na hora (não vai para a fila)', async () => {
    registrarTipoDeEnvio({ tipo: 'deposito.transferencia', versao: 1, offline: true, enviar: async () => { throw recusa('SALDO_INSUFICIENTE'); } });
    await expect(enviarOuGuardar('deposito.transferencia', {})).rejects.toBeInstanceOf(ApiError);
    expect(await fila.listar()).toEqual([]);
  });
});

describe('D-PROD-295 — ordem e ligação entre registros', () => {
  it('MS-07 mesmo recurso sai na ordem; recusa no 1º segura o 2º; recurso diferente segue', async () => {
    const enviados = [];
    registrarTipoDeEnvio({
      tipo: 'cocho.lancamento', versao: 1, offline: true,
      recursos: (p) => [`cocho:${p.cocho}`],
      enviar: async (p) => {
        if (p.recusar) throw recusa('LANCAMENTO_DESATUALIZADO');
        enviados.push(p.n);
        return { ok: true };
      },
    });
    temRede = false;
    await enviarOuGuardar('cocho.lancamento', { cocho: 'A', n: 1, recusar: true });
    relogio += 1000;
    await enviarOuGuardar('cocho.lancamento', { cocho: 'A', n: 2 });
    relogio += 1000;
    await enviarOuGuardar('cocho.lancamento', { cocho: 'B', n: 3 });
    temRede = true;
    const resumo = await sincronizar();
    expect(enviados).toEqual([3]);
    expect(resumo.atencao).toBe(1);
    expect(resumo.aguardando).toBe(1);
    expect(resumo.itens.find((i) => i.estado === 'atencao')?.ultimo_erro?.codigo).toBe('LANCAMENTO_DESATUALIZADO');
  });

  it('MS-08 com internet, mas com item do mesmo recurso esperando: o novo entra na fila atrás dele', async () => {
    const s = servidorFalso();
    registrarTipoDeEnvio({ tipo: 'cocho.lancamento', versao: 1, offline: true, recursos: (p) => [`cocho:${p.cocho}`], enviar: s.enviar });
    temRede = false;
    await enviarOuGuardar('cocho.lancamento', { cocho: 'A', n: 1 });
    temRede = true;
    const r = await enviarOuGuardar('cocho.lancamento', { cocho: 'A', n: 2 });
    expect(r.estado).toBe('aguardando');
    expect(s.enviar).not.toHaveBeenCalled();
  });

  it('MS-09 o 2º registro cita o id que o servidor deu ao 1º (feitos sem internet)', async () => {
    const s = servidorFalso();
    registrarTipoDeEnvio({ tipo: 'cocho.lancamento', versao: 1, offline: true, enviar: s.enviar });
    temRede = false;
    const primeiro = await enviarOuGuardar('cocho.lancamento', { n: 1 });
    relogio += 1000;
    await enviarOuGuardar('cocho.lancamento', { n: 2, anterior_id: referenciaAoResultado(primeiro.operationId, 'registro.id') });
    temRede = true;
    await sincronizar();
    expect(s.enviar.mock.calls[1][0]).toEqual({ n: 2, anterior_id: 'srv_1' });
  });

  it('MS-10 descartar o 1º manda quem dependia dele para "precisa de atenção"', async () => {
    const s = servidorFalso();
    registrarTipoDeEnvio({ tipo: 'cocho.lancamento', versao: 1, offline: true, enviar: s.enviar });
    temRede = false;
    const primeiro = await enviarOuGuardar('cocho.lancamento', { n: 1 });
    relogio += 1000;
    await enviarOuGuardar('cocho.lancamento', { n: 2, anterior_id: referenciaAoResultado(primeiro.operationId, 'registro.id') });
    expect(await descartarDaFila(primeiro.operationId)).toBe(true);
    temRede = true;
    const resumo = await sincronizar();
    expect(s.enviar).not.toHaveBeenCalled();
    expect(resumo.itens[0]).toMatchObject({ estado: 'atencao', ultimo_erro: { codigo: 'REFERENCIA_DESCARTADA' } });
  });
});

describe('D-PROD-295 — nada some', () => {
  it('MS-11 sem rede na passada: continua na fila e espera antes de tentar de novo', async () => {
    let falhar = true;
    registrarTipoDeEnvio({ tipo: 'cocho.leitura', versao: 1, offline: true, enviar: async () => { if (falhar) throw semRede(); return {}; } });
    temRede = false;
    await enviarOuGuardar('cocho.leitura', {});
    temRede = true;
    let resumo = await sincronizar();
    expect(resumo.aguardando).toBe(1);
    expect(resumo.itens[0].esperando).toBe(true);
    falhar = false;
    resumo = await sincronizar(); // ainda dentro da espera: nem tenta
    expect(resumo.aguardando).toBe(1);
    relogio += 10_000;
    resumo = await sincronizar();
    expect(resumo.aguardando).toBe(0);
  });

  it('MS-12 "tentar de novo" devolve o item recusado para a fila', async () => {
    let recusar = true;
    registrarTipoDeEnvio({ tipo: 'deposito.transferencia', versao: 1, offline: true, enviar: async () => { if (recusar) throw recusa('SALDO_INSUFICIENTE'); return {}; } });
    temRede = false;
    const r = await enviarOuGuardar('deposito.transferencia', {});
    temRede = true;
    expect((await sincronizar()).atencao).toBe(1);
    recusar = false;
    expect(await tentarDeNovo(r.operationId)).toBe(true);
    expect((await sincronizar()).atencao).toBe(0);
    expect(await temRegistrosNaoEnviados()).toBe(false);
  });

  it('MS-13 sessão recusada (401): nada muda, espera entrar de novo', async () => {
    registrarTipoDeEnvio({
      tipo: 'cocho.leitura', versao: 1, offline: true,
      enviar: async () => { throw new ApiError(API_ERROR_CODES.TENANT_CONTEXT_REQUIRED, { operation: 't', resource: 'T' }); },
    });
    temRede = false;
    await enviarOuGuardar('cocho.leitura', {});
    temRede = true;
    const resumo = await sincronizar();
    expect(resumo).toMatchObject({ aguardando: 1, atencao: 0 });
    expect(resumo.itens[0].tentativas).toBe(0);
  });

  it('MS-14 tipo que este app ainda não carregou fica intocado (não é enviado nem apagado)', async () => {
    registrarTipoDeEnvio({ tipo: 'cocho.leitura', versao: 1, offline: true, enviar: async () => ({}) });
    temRede = false;
    await enviarOuGuardar('cocho.leitura', {});
    configurarMotorDeSincronizacao({ porta: fila, agora: () => relogio, online: () => true });
    definirSessaoDaFila({ cliente_id: 'cli_1', usuario_id: 'usr_1' });
    expect((await sincronizar()).aguardando).toBe(1);
    expect(await fila.listar()).toHaveLength(1);
  });
});

describe('D-PROD-295 — dono da fila', () => {
  it('MS-15 registro de outra fazenda ou de outro usuário nunca vai com esta sessão', async () => {
    const s = servidorFalso();
    registrarTipoDeEnvio({ tipo: 'cocho.leitura', versao: 1, offline: true, enviar: s.enviar });
    temRede = false;
    await enviarOuGuardar('cocho.leitura', { de: 'usr_1' });
    definirSessaoDaFila({ cliente_id: 'cli_1', usuario_id: 'usr_2' });
    temRede = true;
    const resumo = await sincronizar();
    expect(s.enviar).not.toHaveBeenCalled();
    expect(resumo.aguardando).toBe(0); // não aparece para o usuário 2
    definirSessaoDaFila({ cliente_id: 'cli_1', usuario_id: 'usr_1' });
    expect((await registrosAguardandoDoTipo('cocho.leitura'))[0].payload).toEqual({ de: 'usr_1' });
    await sincronizar();
    expect(s.enviar).toHaveBeenCalledTimes(1);
  });

  it('MS-16 sem sessão (saiu da conta) nada é guardado nem enviado', async () => {
    registrarTipoDeEnvio({ tipo: 'cocho.leitura', versao: 1, offline: true, enviar: async () => ({}) });
    definirSessaoDaFila(null);
    temRede = false;
    await expect(enviarOuGuardar('cocho.leitura', {})).rejects.toMatchObject({ code: API_ERROR_CODES.PROVIDER_UNAVAILABLE });
    expect(await fila.listar()).toEqual([]);
  });
});
