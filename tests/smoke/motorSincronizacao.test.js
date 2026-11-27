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
  alterarNaFila,
  dependentesNaFila,
  registroNaFila,
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
  it('MS-02 com internet vai direto: nada fica esperando (só o resultado guardado, para referência)', async () => {
    const s = servidorFalso();
    registrarTipoDeEnvio({ tipo: 'cocho.leitura', versao: 1, offline: true, enviar: s.enviar });
    const r = await enviarOuGuardar('cocho.leitura', { escore: 2 });
    expect(r.estado).toBe('enviado');
    expect(s.enviar).toHaveBeenCalledTimes(1);
    expect((await resumoDaFila()).itens).toEqual([]);
    expect((await fila.listar()).map((i) => i.estado)).toEqual(['enviado']);
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
    expect(s.enviar.mock.calls[0][1]).toMatchObject({ operationId: r.operationId, empresaId: 'emp_1' });
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

  it('MS-10 D-PROD-311: só o último da sequência sai — o 1º não é descartado enquanto o 2º depende dele', async () => {
    const s = servidorFalso();
    registrarTipoDeEnvio({ tipo: 'cocho.lancamento', versao: 1, offline: true, enviar: s.enviar, recursos: (p) => [`cocho:${p.cocho}`] });
    registrarTipoDeEnvio({ tipo: 'cocho.leitura', versao: 1, offline: true, independente: true, enviar: s.enviar, recursos: (p) => [`cocho:${p.cocho}`] });
    temRede = false;
    const primeiro = await enviarOuGuardar('cocho.lancamento', { n: 1, cocho: 'c1' });
    relogio += 1000;
    const segundo = await enviarOuGuardar('cocho.lancamento', { n: 2, cocho: 'c1', anterior_id: referenciaAoResultado(primeiro.operationId, 'registro.id') });
    relogio += 1000;
    const leitura = await enviarOuGuardar('cocho.leitura', { cocho: 'c1' });
    // O 1º tem dependente (o 2º): não sai.
    expect((await dependentesNaFila(primeiro.operationId)).map((d) => d.id)).toEqual([segundo.operationId]);
    expect(await descartarDaFila(primeiro.operationId)).toBe(false);
    // A leitura é independente: não prende o 2º nem é presa por ele.
    expect(await dependentesNaFila(segundo.operationId)).toEqual([]);
    // Exclui o mais recente e depois o anterior.
    expect(await descartarDaFila(segundo.operationId)).toBe(true);
    expect(await descartarDaFila(primeiro.operationId)).toBe(true);
    temRede = true;
    await sincronizar();
    expect(s.enviar).toHaveBeenCalledTimes(1); // só a leitura
    expect((await resumoDaFila()).itens).toEqual([]);
    void leitura;
  });

  it('MS-10b no mesmo recurso, o posterior (sem citar) também prende: estoque da transferência usado depois', async () => {
    const s = servidorFalso();
    registrarTipoDeEnvio({ tipo: 'deposito.transferencia', versao: 1, offline: true, enviar: s.enviar, recursos: (p) => [`estoque:${p.de}`, `estoque:${p.para}`] });
    registrarTipoDeEnvio({ tipo: 'cocho.lancamento', versao: 1, offline: true, enviar: s.enviar, recursos: (p) => [`cocho:${p.cocho}`, `estoque:${p.estoque}`] });
    temRede = false;
    const transf = await enviarOuGuardar('deposito.transferencia', { de: 'galpao', para: 'dep1' });
    relogio += 1000;
    const lanc = await enviarOuGuardar('cocho.lancamento', { cocho: 'c1', estoque: 'dep1' });
    expect(await descartarDaFila(transf.operationId)).toBe(false);
    expect(await descartarDaFila(lanc.operationId)).toBe(true);
    expect(await descartarDaFila(transf.operationId)).toBe(true);
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

describe('D-PROD-295 — operação ainda em processamento no servidor', () => {
  it('MS-17 IDEMPOTENCY_IN_PROGRESS não é recusa: espera e tenta de novo com o mesmo código', async () => {
    let emProcessamento = true;
    const enviar = vi.fn(async () => {
      if (emProcessamento) throw recusa('IDEMPOTENCY_IN_PROGRESS');
      return { ok: true };
    });
    registrarTipoDeEnvio({ tipo: 'cocho.lancamento', versao: 1, offline: true, enviar });
    temRede = false;
    const r = await enviarOuGuardar('cocho.lancamento', {});
    temRede = true;
    let resumo = await sincronizar();
    expect(resumo).toMatchObject({ aguardando: 1, atencao: 0 });
    emProcessamento = false;
    relogio += 10_000;
    resumo = await sincronizar();
    expect(resumo).toMatchObject({ aguardando: 0, atencao: 0 });
    expect(enviar.mock.calls.every((c) => c[1].operationId === r.operationId)).toBe(true);
  });
});

describe('D-PROD-295 — dono da fila', () => {
  // D-PROD-350: o dono é a conta da fazenda, não a pessoa (como no AgriWebb). Antes o registro de outra pessoa da
  // mesma conta esperava ela voltar a entrar, e podia nunca subir.
  it('MS-15 registro de outra pessoa da mesma conta sobe com esta sessão; de outra conta, nunca', async () => {
    const s = servidorFalso();
    registrarTipoDeEnvio({ tipo: 'cocho.leitura', versao: 1, offline: true, enviar: s.enviar });
    temRede = false;
    await enviarOuGuardar('cocho.leitura', { de: 'usr_1' });
    // Outra conta (outro cliente): nunca vê nem envia.
    definirSessaoDaFila({ cliente_id: 'cli_2', usuario_id: 'usr_9' });
    temRede = true;
    let resumo = await sincronizar();
    expect(s.enviar).not.toHaveBeenCalled();
    expect(resumo.aguardando).toBe(0);
    // Outra pessoa da mesma conta: o registro aparece e sobe.
    definirSessaoDaFila({ cliente_id: 'cli_1', usuario_id: 'usr_2' });
    resumo = await sincronizar();
    expect(s.enviar).toHaveBeenCalledTimes(1);
    expect(resumo.aguardando).toBe(0);
    const [item] = await fila.listar();
    expect(item.usuario_id).toBe('usr_1'); // quem lançou continua gravado
  });

  it('MS-16 sem sessão (saiu da conta) nada é guardado nem enviado', async () => {
    registrarTipoDeEnvio({ tipo: 'cocho.leitura', versao: 1, offline: true, enviar: async () => ({}) });
    definirSessaoDaFila(null);
    temRede = false;
    await expect(enviarOuGuardar('cocho.leitura', {})).rejects.toMatchObject({ code: API_ERROR_CODES.PROVIDER_UNAVAILABLE });
    expect(await fila.listar()).toEqual([]);
  });
});

describe('D-PROD-295 — revisão (Codex)', () => {
  it('MS-18 trocou de conta no meio da passada: para antes do próximo envio', async () => {
    const enviar = vi.fn(async () => {
      // durante o 1º envio, a pessoa sai e outra conta entra
      definirSessaoDaFila({ cliente_id: 'cli_2', usuario_id: 'usr_9' });
      return {};
    });
    registrarTipoDeEnvio({ tipo: 'cocho.leitura', versao: 1, offline: true, enviar });
    temRede = false;
    await enviarOuGuardar('cocho.leitura', { n: 1 });
    relogio += 1000;
    await enviarOuGuardar('cocho.leitura', { n: 2 });
    temRede = true;
    await sincronizar();
    expect(enviar).toHaveBeenCalledTimes(1);
    definirSessaoDaFila({ cliente_id: 'cli_1', usuario_id: 'usr_1' });
    expect((await resumoDaFila()).aguardando).toBe(1);
  });

  it('MS-19 o 1º foi direto (com internet) e o 2º cita o resultado dele: a referência funciona', async () => {
    const s = servidorFalso();
    registrarTipoDeEnvio({ tipo: 'cocho.lancamento', versao: 1, offline: true, enviar: s.enviar });
    const primeiro = await enviarOuGuardar('cocho.lancamento', { n: 1 });
    expect(primeiro.estado).toBe('enviado');
    temRede = false;
    await enviarOuGuardar('cocho.lancamento', { n: 2, anterior_id: referenciaAoResultado(primeiro.operationId, 'registro.id') });
    temRede = true;
    const resumo = await sincronizar();
    expect(resumo.atencao).toBe(0);
    expect(s.enviar.mock.calls[1][0]).toEqual({ n: 2, anterior_id: 'srv_1' });
  });

  it('MS-20 dois registros no mesmo milissegundo saem na ordem em que foram feitos', async () => {
    const ordem = [];
    registrarTipoDeEnvio({
      tipo: 'cocho.lancamento', versao: 1, offline: true, recursos: () => ['cocho:A'],
      enviar: async (p) => { ordem.push(p.n); return {}; },
    });
    temRede = false;
    for (let n = 1; n <= 8; n += 1) await enviarOuGuardar('cocho.lancamento', { n }); // relógio parado
    temRede = true;
    await sincronizar();
    expect(ordem).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('MS-21 versão antiga sem migração declarada fica intocada (não é enviada como a nova)', async () => {
    const enviarV1 = vi.fn(async () => ({}));
    registrarTipoDeEnvio({ tipo: 'cocho.leitura', versao: 1, offline: true, enviar: enviarV1 });
    temRede = false;
    await enviarOuGuardar('cocho.leitura', { escore: 2 });
    // o app atualizou: agora o tipo é versão 2, sem migrar()
    const enviarV2 = vi.fn(async () => ({}));
    registrarTipoDeEnvio({ tipo: 'cocho.leitura', versao: 2, offline: true, enviar: enviarV2 });
    temRede = true;
    expect((await sincronizar()).aguardando).toBe(1);
    expect(enviarV2).not.toHaveBeenCalled();
    // com migração declarada, sai convertido
    registrarTipoDeEnvio({ tipo: 'cocho.leitura', versao: 2, offline: true, enviar: enviarV2, migrar: (p) => ({ ...p, v: 2 }) });
    await sincronizar();
    expect(enviarV2).toHaveBeenCalledWith({ escore: 2, v: 2 }, expect.any(Object));
  });
});

describe('D-PROD-296 — recusa de negócio x erro passageiro do servidor', () => {
  it('MS-22 código do servidor fora do catálogo do app (OPERATION_FAILED + código) é recusa: vai para atenção na hora', async () => {
    registrarTipoDeEnvio({
      tipo: 'cocho.lancamento', versao: 1, offline: true,
      enviar: async () => { throw new ApiError(API_ERROR_CODES.OPERATION_FAILED, { operation: 't', resource: 'T', cause: { code: 'LANCAMENTO_DESATUALIZADO' } }); },
    });
    temRede = false;
    await enviarOuGuardar('cocho.lancamento', {});
    temRede = true;
    const resumo = await sincronizar();
    expect(resumo).toMatchObject({ aguardando: 0, atencao: 1 });
    expect(resumo.itens[0].ultimo_erro.codigo).toBe('LANCAMENTO_DESATUALIZADO');
  });

  it('MS-23 erro interno, trava concorrente ou 5xx sem código: espera e tenta de novo', async () => {
    let n = 0;
    const erros = [
      new ApiError(API_ERROR_CODES.OPERATION_FAILED, { operation: 't', resource: 'T', cause: { code: 'INTERNAL_ERROR' } }),
      new ApiError(API_ERROR_CODES.OPERATION_FAILED, { operation: 't', resource: 'T', cause: { code: 'CONCURRENCY_CONFLICT' } }),
      new ApiError(API_ERROR_CODES.OPERATION_FAILED, { operation: 't', resource: 'T' }),
    ];
    registrarTipoDeEnvio({ tipo: 'cocho.leitura', versao: 1, offline: true, enviar: async () => { if (n < erros.length) throw erros[n++]; return {}; } });
    temRede = false;
    await enviarOuGuardar('cocho.leitura', {});
    temRede = true;
    for (let i = 0; i < erros.length; i += 1) {
      expect((await sincronizar()).atencao).toBe(0);
      relogio += 700_000;
    }
    expect((await sincronizar()).aguardando).toBe(0);
  });
});

describe('D-PROD-296 — progresso e reajuste (revisão)', () => {
  it('MS-24 o progresso que o tipo registra fica no item e aparece na lista', async () => {
    registrarTipoDeEnvio({
      tipo: 'cocho.lancamento', versao: 1, offline: true,
      enviar: async (_p, { registrarProgresso }) => {
        await registrarProgresso({ passo1: true });
        throw recusa('X_RECUSADO');
      },
    });
    temRede = false;
    await enviarOuGuardar('cocho.lancamento', {});
    temRede = true;
    const resumo = await sincronizar();
    expect(resumo.itens[0]).toMatchObject({ estado: 'atencao', progresso: { passo1: true } });
  });

  it('MS-25 "Tentar de novo" chama o reajuste do tipo e envia o payload corrigido com o MESMO código', async () => {
    const enviados = [];
    let recusar = true;
    registrarTipoDeEnvio({
      tipo: 'cocho.lancamento', versao: 1, offline: true,
      enviar: async (p, { operationId }) => { enviados.push({ p, operationId }); if (recusar) throw recusa('LANCAMENTO_DESATUALIZADO'); return {}; },
      reajustar: async (p, { ultimoErro }) => ({ ...p, anterior: ultimoErro.codigo === 'LANCAMENTO_DESATUALIZADO' ? 'novo' : p.anterior }),
    });
    temRede = false;
    const r = await enviarOuGuardar('cocho.lancamento', { anterior: 'velho' });
    temRede = true;
    await sincronizar();
    recusar = false;
    await tentarDeNovo(r.operationId);
    await sincronizar();
    expect(enviados.map((e) => e.p.anterior)).toEqual(['velho', 'novo']);
    expect(enviados.every((e) => e.operationId === r.operationId)).toBe(true);
  });
});

describe('D-PROD-298 — corrigir na fila', () => {
  it('MS-26 alterar troca o payload na MESMA posição e com o mesmo código; quem cita continua citando; D-PROD-311: só o último se edita', async () => {
    const ordem = [];
    registrarTipoDeEnvio({ tipo: 'cocho.lancamento', versao: 1, offline: true, recursos: () => ['cocho:A'], enviar: async (p, { operationId }) => { ordem.push([p.n, operationId]); return { registro: { id: `srv-${p.n}` } }; } });
    temRede = false;
    const a = await enviarOuGuardar('cocho.lancamento', { n: 1 });
    relogio += 1000;
    const b = await enviarOuGuardar('cocho.lancamento', { n: 2, anterior: referenciaAoResultado(a.operationId, 'registro.id') });
    expect(await dependentesNaFila(a.operationId)).toEqual([{ id: b.operationId, rotulo: 'cocho.lancamento' }]);
    // D-PROD-311: o 1º não se edita enquanto o 2º (feito em cima dele) existe; o último, sim.
    expect(await alterarNaFila(a.operationId, { n: 10 })).toBe(false);
    expect(await alterarNaFila(b.operationId, { n: 20, anterior: referenciaAoResultado(a.operationId, 'registro.id') })).toBe(true);
    temRede = true;
    await sincronizar();
    expect(ordem).toEqual([[1, a.operationId], [20, b.operationId]]);
  });

  it('MS-27 não altera o que já tentou subir, nem o recusado com passo já confirmado; altera o recusado sem passo', async () => {
    let modo = 'rede';
    registrarTipoDeEnvio({
      tipo: 'cocho.lancamento', versao: 1, offline: true,
      enviar: async (_p, { registrarProgresso }) => {
        if (modo === 'rede') throw semRede();
        if (modo === 'passo') { await registrarProgresso({ saida_feita: { quantidade: 1 } }); throw recusa('X'); }
        throw recusa('Y');
      },
    });
    temRede = false;
    const r = await enviarOuGuardar('cocho.lancamento', { n: 1 });
    temRede = true;
    await sincronizar(); // tentou, sem rede → confirmando
    expect((await registroNaFila(r.operationId)).podeAlterar).toBe(false);
    expect(await alterarNaFila(r.operationId, { n: 2 })).toBe(false);

    const outro = await (async () => { temRede = false; const x = await enviarOuGuardar('cocho.lancamento', { n: 3 }, { operationId: 'op-sem-passo-1' }); temRede = true; return x; })();
    modo = 'recusa';
    relogio += 700_000;
    await sincronizar();
    expect((await registroNaFila(outro.operationId)).estado).toBe('atencao');
    expect(await alterarNaFila(outro.operationId, { n: 4 })).toBe(true);
  });
});

describe('D-PROD-298 — revisão (Codex): edição durante a passada', () => {
  it('MS-28 editar um item enquanto a passada espera o anterior: sai a versão editada, não a cópia antiga', async () => {
    const enviados = [];
    /** @type {(v?: unknown) => void} */
    let liberar = () => {};
    const segurar = new Promise((r) => { liberar = r; });
    registrarTipoDeEnvio({
      tipo: 'cocho.lancamento', versao: 1, offline: true,
      enviar: async (p) => { if (p.n === 1) await segurar; enviados.push(p.n); return {}; },
    });
    temRede = false;
    await enviarOuGuardar('cocho.lancamento', { n: 1 });
    relogio += 1000;
    const b = await enviarOuGuardar('cocho.lancamento', { n: 2 });
    temRede = true;
    const passada = sincronizar();
    await new Promise((r) => setTimeout(r, 20)); // a passada está esperando o 1º
    expect(await alterarNaFila(b.operationId, { n: 22 })).toBe(true);
    liberar();
    await passada;
    await sincronizar();
    expect(enviados).toEqual([1, 22]);
  });
});

