/**
 * D-PROD-308 — Etapa 1: nada se perde, nada duplica.
 *
 *  A. Id do aparelho (fila antiga: cocho/ponto e lote)
 *     IA-01 criado sem internet já nasce com o id definitivo (UUID); ao enviar, o id vai junto
 *     IA-02 com internet, a criação que não chega a uma resposta vai para a fila com o MESMO id
 *     IA-03 com internet, a recusa do servidor volta para a tela e nada fica na fila
 *     IA-04 editar sem internet o que ainda está na fila entra na própria criação (um envio só)
 *     IA-05 excluir sem internet o que ainda está na fila: sai da fila, nada vai ao servidor
 *  B. Motor: gravado antes de sair
 *     EN-01 com internet, o item já está no aparelho enquanto o pedido está no ar (sem aparecer
 *           como "aguardando"); depois fica "enviado"
 *     EN-02 app fechado com o pedido no ar: a reserva vence e a passada termina com o MESMO código
 *     EN-03 a passada não manda junto o item que a tela está enviando
 *     EN-04 o passo feito (a baixa) fica gravado no aparelho durante o envio
 *     EN-05 recusa do servidor: o item sai da fila e a tela decide
 *  C. Ordem entre as filas
 *     OR-01 a leitura de um cocho criado sem internet espera a criação; numa sincronização só,
 *           o cocho sobe e depois a leitura, com o id do cocho
 *  D. Entre abas
 *     AB-01 com `navigator.locks`, a sincronização roda dentro da trava "maike-sincronia"
 *     AB-02 a trava falhou: sincroniza assim mesmo (o trabalho roda uma vez só)
 *  Revisão independente: IA-06..11 (o que vem depois de uma criação que caiu), EN-07..09
 *  (ordem e reserva do envio direto).
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/apis/_core/nativeHttpClient.js', () => ({ nativeRequest: vi.fn(async () => []) }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Porta em memória com o mesmo contrato do armazenamento IndexedDB. */
const memoria = () => {
  const cache = new Map();
  const fila = new Map();
  let proximo = 1;
  return {
    cache,
    fila,
    lerCache: async (k) => [...(cache.get(k) || [])],
    gravarCache: async (k, r) => {
      cache.set(k, r.items);
    },
    listarFila: async () => [...fila.values()].map((i) => structuredClone(i)),
    adicionarNaFila: async (i) => {
      const id = proximo++;
      fila.set(id, { ...structuredClone(i), id });
      return id;
    },
    atualizarNaFila: async (id, c) => {
      const a = fila.get(id);
      if (a) fila.set(id, { ...a, ...structuredClone(c), id });
    },
    removerDaFila: async (id) => {
      fila.delete(id);
    },
    removerCache: async (k) => {
      cache.delete(k);
    },
  };
};

const online = (v) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });

let storage;
let rt;
let erros;

beforeEach(async () => {
  vi.resetModules();
  storage = memoria();
  rt = await import('@/lib/offline/offlineEntityRuntime');
  (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_A');
  rt.resetOfflineEntityRuntime();
  erros = await import('@/apis/_core/ApiError');
  online(true);
});

afterEach(() => {
  online(true);
});

/** "Servidor" do cocho: grava pelo id que chega (repetir devolve o mesmo). */
const servidorDePontos = () => {
  const gravados = new Map();
  const ops = {
    list: vi.fn(async () => [...gravados.values()]),
    create: vi.fn(async (d) => {
      const id = d.id ?? `srv_${gravados.size + 1}`;
      if (!gravados.has(id)) gravados.set(id, { ...d, id });
      return gravados.get(id);
    }),
    update: vi.fn(async (id, d) => ({ ...gravados.get(id), ...d, id })),
    delete: vi.fn(async (id) => {
      gravados.delete(id);
    }),
  };
  return { gravados, ops };
};

const portaDoPonto = (ops) =>
  rt.createOfflineEntityAdapter({ entityName: 'PontoSuplementacao', operations: ops, storage, tenantScoped: true, idDoAparelho: true });

describe('D-PROD-308 A — id do aparelho na fila antiga', () => {
  it('IA-01 sem internet nasce com o id definitivo; ao enviar, o id vai junto', async () => {
    const { ops, gravados } = servidorDePontos();
    const porta = portaDoPonto(ops);
    online(false);
    const criado = await porta.create({ empresa_id: 'emp-1', nome_ponto: 'COCHO DO CAMPO' });
    expect(criado.id).toMatch(UUID);
    expect(criado._isOffline).toBe(true);
    const [item] = [...storage.fila.values()];
    expect(item).toMatchObject({ operation: 'create', record_id: criado.id });
    online(true);
    await rt.syncOfflineEntityQueue();
    expect(ops.create).toHaveBeenCalledWith(expect.objectContaining({ id: criado.id, nome_ponto: 'COCHO DO CAMPO' }));
    expect([...gravados.keys()]).toEqual([criado.id]);
    expect(storage.fila.size).toBe(0);
    const lista = await porta.list();
    expect(lista.map((p) => p.id)).toEqual([criado.id]);
  });

  it('IA-02 com internet, sem resposta: vai para a fila com o MESMO id; reenviar não duplica', async () => {
    const { ops, gravados } = servidorDePontos();
    const original = ops.create.getMockImplementation();
    // O servidor grava, mas a resposta se perde (rede caiu na volta).
    ops.create.mockImplementationOnce(async (d) => {
      await original(d);
      throw new erros.ApiError(erros.API_ERROR_CODES.PROVIDER_UNAVAILABLE, { operation: 'x', resource: 'y' });
    });
    const porta = portaDoPonto(ops);
    const r = await porta.create({ empresa_id: 'emp-1', nome_ponto: 'COCHO' });
    expect(r.id).toMatch(UUID);
    expect(r._isOffline).toBe(true);
    const [item] = [...storage.fila.values()];
    expect(item.record_id).toBe(r.id);
    await rt.syncOfflineEntityQueue();
    expect(ops.create).toHaveBeenCalledTimes(2);
    expect(ops.create.mock.calls.map((c) => c[0].id)).toEqual([r.id, r.id]);
    expect(gravados.size).toBe(1);
    expect(storage.fila.size).toBe(0);
  });

  it('IA-03 com internet, recusa do servidor: volta para a tela, nada na fila', async () => {
    const { ops } = servidorDePontos();
    ops.create.mockRejectedValueOnce(
      new erros.ApiError(erros.API_ERROR_CODES.OPERATION_FAILED, { operation: 'x', resource: 'y', cause: { code: 'REQUEST_VALIDATION_FAILED' } })
    );
    const porta = portaDoPonto(ops);
    await expect(porta.create({ empresa_id: 'emp-1', nome_ponto: '' })).rejects.toBeTruthy();
    expect(storage.fila.size).toBe(0);
  });

  it('IA-04 editar sem internet o que ainda está na fila: entra na criação (um envio só)', async () => {
    const { ops } = servidorDePontos();
    const porta = portaDoPonto(ops);
    online(false);
    const criado = await porta.create({ empresa_id: 'emp-1', nome_ponto: 'A' });
    await porta.update(criado.id, { empresa_id: 'emp-1', nome_ponto: 'B' });
    expect([...storage.fila.values()].map((i) => i.operation)).toEqual(['create']);
    online(true);
    await rt.syncOfflineEntityQueue();
    expect(ops.create).toHaveBeenCalledWith(expect.objectContaining({ id: criado.id, nome_ponto: 'B' }));
    expect(ops.update).not.toHaveBeenCalled();
  });

  it('IA-05 excluir sem internet o que ainda está na fila: sai da fila, nada vai ao servidor', async () => {
    const { ops } = servidorDePontos();
    const porta = portaDoPonto(ops);
    online(false);
    const criado = await porta.create({ empresa_id: 'emp-1', nome_ponto: 'A' });
    await porta.delete(criado.id);
    expect(storage.fila.size).toBe(0);
    online(true);
    await rt.syncOfflineEntityQueue();
    expect(ops.create).not.toHaveBeenCalled();
    expect(ops.delete).not.toHaveBeenCalled();
  });
});

describe('D-PROD-308 A2 — revisão: o que vem depois da criação que caiu', () => {
  const semRede = () => new erros.ApiError(erros.API_ERROR_CODES.PROVIDER_UNAVAILABLE, { operation: 'x', resource: 'y' });

  // D-PROD-342: antes a edição entrava na criação que caiu. Mas a criação pode ter chegado (só a resposta se perdeu), e
  // o servidor devolve o que já tem para o mesmo id: a edição somada a ela se perdia. Agora vai como item próprio,
  // depois da criação, e o resultado é o registro editado, uma vez só.
  it('IA-06 criação caiu (com internet) e a pessoa edita logo: a edição vai depois da criação e não se perde', async () => {
    const { ops, gravados } = servidorDePontos();
    const original = ops.create.getMockImplementation();
    ops.create.mockImplementationOnce(async (d) => {
      await original(d); // gravou, a resposta se perdeu
      throw semRede();
    });
    ops.update.mockImplementation(async (id, d) => {
      gravados.set(id, { ...gravados.get(id), ...d, id });
      return gravados.get(id);
    });
    const porta = portaDoPonto(ops);
    const criado = await porta.create({ empresa_id: 'emp-1', nome_ponto: 'A' });
    await porta.update(criado.id, { empresa_id: 'emp-1', nome_ponto: 'B' });
    await rt.syncOfflineEntityQueue();
    expect(gravados.size).toBe(1);
    expect(gravados.get(criado.id).nome_ponto).toBe('B');
    expect(storage.fila.size).toBe(0);
  });

  it('IA-07 criação caiu e a pessoa exclui: a exclusão vai DEPOIS da criação (o servidor pode já ter o registro)', async () => {
    const { ops, gravados } = servidorDePontos();
    const original = ops.create.getMockImplementation();
    ops.create.mockImplementationOnce(async (d) => {
      await original(d); // gravou, a resposta se perdeu
      throw semRede();
    });
    const porta = portaDoPonto(ops);
    const criado = await porta.create({ empresa_id: 'emp-1', nome_ponto: 'A' });
    await porta.delete(criado.id);
    expect(ops.delete).not.toHaveBeenCalled();
    expect([...storage.fila.values()].map((i) => i.operation)).toEqual(['create', 'delete']);
    await rt.syncOfflineEntityQueue();
    expect(ops.delete).toHaveBeenCalledWith(criado.id);
    expect(gravados.size).toBe(0);
    expect(storage.fila.size).toBe(0);
  });

  it('IA-08 o servidor diz que o registro foi criado e depois excluído: a criação e o que vinha atrás saem da fila e do aparelho', async () => {
    const { ops } = servidorDePontos();
    ops.create.mockRejectedValue(
      new erros.ApiError(erros.API_ERROR_CODES.OPERATION_FAILED, { operation: 'x', resource: 'y', cause: { code: 'ID_DO_APARELHO_EXCLUIDO' } })
    );
    const porta = portaDoPonto(ops);
    online(false);
    const criado = await porta.create({ empresa_id: 'emp-1', nome_ponto: 'A' });
    online(true);
    const r = await rt.syncOfflineEntityQueue();
    expect(r.success).toBe(true);
    expect(storage.fila.size).toBe(0);
    online(false);
    expect((await porta.list()).map((p) => p.id)).not.toContain(criado.id);
  });

  it('IA-09 erro do servidor que se repete no mesmo item: na 5ª vez fica retido com o motivo e não trava mais a fila', async () => {
    const { ops } = servidorDePontos();
    ops.create.mockRejectedValue(new erros.ApiError(erros.API_ERROR_CODES.OPERATION_FAILED, { operation: 'x', resource: 'y' }));
    const porta = portaDoPonto(ops);
    online(false);
    await porta.create({ empresa_id: 'emp-1', nome_ponto: 'A' });
    online(true);
    for (let i = 0; i < 4; i += 1) expect((await rt.syncOfflineEntityQueue()).success).toBe(false);
    const r = await rt.syncOfflineEntityQueue();
    expect(r).toMatchObject({ success: true, recusados: 1 });
    expect(await rt.listarRecusadosDaFilaDeEntidades()).toHaveLength(1);
    expect((await rt.idsComCriacaoPendenteNaFilaDeEntidades()).size).toBe(0);
  });

  it('IA-10 com internet, erro do servidor (não de rede) na criação volta para a tela, nada na fila', async () => {
    const { ops } = servidorDePontos();
    ops.create.mockRejectedValueOnce(new erros.ApiError(erros.API_ERROR_CODES.OPERATION_FAILED, { operation: 'x', resource: 'y' }));
    const porta = portaDoPonto(ops);
    await expect(porta.create({ empresa_id: 'emp-1', nome_ponto: 'A' })).rejects.toBeTruthy();
    expect(storage.fila.size).toBe(0);
  });

  it('IA-11 sem conta definida, a criação que caiu volta para a tela (a fila não teria dono)', async () => {
    (await import('@/lib/offline/offlineTenant')).setOfflineTenant(null);
    const { ops } = servidorDePontos();
    ops.create.mockRejectedValueOnce(semRede());
    const porta = portaDoPonto(ops);
    await expect(porta.create({ empresa_id: 'emp-1', nome_ponto: 'A' })).rejects.toBeTruthy();
    expect(storage.fila.size).toBe(0);
  });
});

describe('D-PROD-308 B — motor: gravado antes de sair', () => {
  let motor;
  let fila;
  let relogio;
  let temRede;
  beforeEach(async () => {
    motor = await import('@/lib/offline/sincronizacao/motorDeSincronizacao');
    const { criarFilaEmMemoria } = await import('@/lib/offline/sincronizacao/filaDeEnvio');
    fila = criarFilaEmMemoria();
    relogio = Date.parse('2026-11-25T12:00:00Z');
    temRede = true;
    motor.configurarMotorDeSincronizacao({ porta: fila, agora: () => relogio, online: () => temRede });
    motor.definirSessaoDaFila({ cliente_id: 'cli_A', usuario_id: 'usr_1' });
  });
  afterEach(() => motor.definirSessaoDaFila(null));

  it('EN-01 com o pedido no ar, o item já está no aparelho (sem aparecer como aguardando); depois, enviado', async () => {
    let soltar;
    const noAr = [];
    motor.registrarTipoDeEnvio({
      tipo: 'cocho.leitura',
      versao: 1,
      offline: true,
      enviar: async (_p, { operationId }) => {
        noAr.push((await fila.ler(operationId))?.estado);
        await new Promise((r) => (soltar = r));
        return { id: 'srv-1' };
      },
    });
    const envio = motor.enviarOuGuardar('cocho.leitura', { ponto_suplementacao_id: 'c1', escore: 2 }, { operationId: 'op-1' });
    await vi.waitFor(() => expect(noAr).toEqual(['pendente']));
    expect((await motor.resumoDaFila()).aguardando).toBe(0);
    expect(await motor.registrosAguardandoDoTipo('cocho.leitura')).toEqual([]);
    soltar();
    expect(await envio).toMatchObject({ estado: 'enviado', operationId: 'op-1' });
    expect(await fila.ler('op-1')).toMatchObject({ estado: 'enviado', resultado: { id: 'srv-1' } });
    expect((await fila.ler('op-1')).direto_ate).toBeUndefined();
  });

  it('EN-02 app fechado com o pedido no ar: a reserva vence e a passada termina com o MESMO código', async () => {
    const recebidos = [];
    let primeira = true;
    motor.registrarTipoDeEnvio({
      tipo: 'cocho.leitura',
      versao: 1,
      offline: true,
      enviar: async (_p, { operationId }) => {
        recebidos.push(operationId);
        if (primeira) {
          primeira = false;
          return new Promise(() => {}); // o app "fechou": a resposta nunca chega
        }
        return { id: 'srv-1' };
      },
    });
    void motor.enviarOuGuardar('cocho.leitura', { escore: 1 }, { operationId: 'op-fechou' });
    await vi.waitFor(() => expect(recebidos).toEqual(['op-fechou']));
    // Antes de a reserva vencer, a passada não manda junto.
    await motor.sincronizar();
    expect(recebidos).toEqual(['op-fechou']);
    relogio += 3 * 60 * 1000;
    await motor.sincronizar();
    expect(recebidos).toEqual(['op-fechou', 'op-fechou']);
    expect(await fila.ler('op-fechou')).toMatchObject({ estado: 'enviado' });
  });

  it('EN-04 o passo feito fica gravado no aparelho durante o envio', async () => {
    let soltar;
    motor.registrarTipoDeEnvio({
      tipo: 'cocho.lancamento',
      versao: 1,
      offline: true,
      enviar: async (_p, { registrarProgresso }) => {
        await registrarProgresso({ saida_feita: { id: 'mov-1', quantidade: 80 } });
        await new Promise((r) => (soltar = r));
        return { id: 'ev-1' };
      },
    });
    const envio = motor.enviarOuGuardar('cocho.lancamento', { quantidade: 80 }, { operationId: 'op-l' });
    await vi.waitFor(async () => expect((await fila.ler('op-l'))?.progresso).toEqual({ saida_feita: { id: 'mov-1', quantidade: 80 } }));
    soltar();
    await envio;
  });

  it('EN-05 recusa do servidor: o item sai da fila e a tela decide', async () => {
    motor.registrarTipoDeEnvio({
      tipo: 'cocho.leitura',
      versao: 1,
      offline: true,
      enviar: async () => {
        throw new erros.ApiError(erros.API_ERROR_CODES.OPERATION_FAILED, { operation: 'x', resource: 'y', cause: { code: 'PONTO_NOT_FOUND' } });
      },
    });
    await expect(motor.enviarOuGuardar('cocho.leitura', { escore: 1 }, { operationId: 'op-r' })).rejects.toBeTruthy();
    expect(await fila.ler('op-r')).toBeUndefined();
  });

  it('EN-07 o segundo no mesmo cocho, pedido com o primeiro no ar, sai logo depois (não espera 1 minuto)', async () => {
    let soltar;
    const enviados = [];
    motor.registrarTipoDeEnvio({
      tipo: 'cocho.lancamento',
      versao: 1,
      offline: true,
      recursos: (p) => [`cocho:${p.cocho}`],
      enviar: async (p, { operationId }) => {
        enviados.push(operationId);
        if (operationId === 'op-a') await new Promise((r) => (soltar = r));
        return { id: `srv-${operationId}` };
      },
    });
    const a = motor.enviarOuGuardar('cocho.lancamento', { cocho: 'c1' }, { operationId: 'op-a' });
    await vi.waitFor(() => expect(enviados).toEqual(['op-a']));
    expect(await motor.enviarOuGuardar('cocho.lancamento', { cocho: 'c1' }, { operationId: 'op-b' })).toMatchObject({ estado: 'aguardando' });
    soltar();
    await a;
    await vi.waitFor(async () => expect((await fila.ler('op-b'))?.estado).toBe('enviado'), { timeout: 4000 });
    expect(enviados).toEqual(['op-a', 'op-b']);
  });

  it('EN-08 reserva fora do limite (o relógio do aparelho voltou) não esconde nem segura o item', async () => {
    motor.registrarTipoDeEnvio({ tipo: 'cocho.leitura', versao: 1, offline: true, enviar: async () => ({ id: 'srv' }) });
    temRede = false;
    await motor.enviarOuGuardar('cocho.leitura', { escore: 1 }, { operationId: 'op-relogio' });
    const item = await fila.ler('op-relogio');
    await fila.gravar({ ...item, direto_ate: relogio + 10 * 3600 * 1000, reserva_de: 1 });
    expect((await motor.resumoDaFila()).aguardando).toBe(1);
    temRede = true;
    await motor.sincronizar();
    expect(await fila.ler('op-relogio')).toMatchObject({ estado: 'enviado' });
    expect((await fila.ler('op-relogio')).direto_ate).toBeUndefined();
  });

  it('EN-09 a passada assumiu o item (reserva vencida) e terminou: a resposta atrasada do envio direto não desfaz', async () => {
    let falharDepois;
    let vez = 0;
    motor.registrarTipoDeEnvio({
      tipo: 'cocho.leitura',
      versao: 1,
      offline: true,
      enviar: async () => {
        vez += 1;
        if (vez === 1) {
          await new Promise((r) => (falharDepois = r));
          throw new erros.ApiError(erros.API_ERROR_CODES.OPERATION_FAILED, { operation: 'x', resource: 'y', cause: { code: 'QUALQUER_RECUSA' } });
        }
        return { id: 'srv' };
      },
    });
    const direto = motor.enviarOuGuardar('cocho.leitura', { escore: 1 }, { operationId: 'op-tarde' });
    await vi.waitFor(() => expect(vez).toBe(1));
    relogio += 3 * 60 * 1000;
    await motor.sincronizar();
    expect(await fila.ler('op-tarde')).toMatchObject({ estado: 'enviado' });
    falharDepois();
    await expect(direto).rejects.toBeTruthy();
    expect(await fila.ler('op-tarde')).toMatchObject({ estado: 'enviado' });
  });

  it('EN-06 falha de rede no envio direto: fica aguardando (sem reserva) e a passada envia', async () => {
    let vez = 0;
    motor.registrarTipoDeEnvio({
      tipo: 'cocho.leitura',
      versao: 1,
      offline: true,
      enviar: async () => {
        vez += 1;
        if (vez === 1) throw new erros.ApiError(erros.API_ERROR_CODES.PROVIDER_UNAVAILABLE, { operation: 'x', resource: 'y' });
        return { id: 'srv' };
      },
    });
    expect(await motor.enviarOuGuardar('cocho.leitura', { escore: 1 }, { operationId: 'op-n' })).toMatchObject({ estado: 'aguardando' });
    const item = await fila.ler('op-n');
    expect(item).toMatchObject({ estado: 'pendente', tentado: true });
    expect(item.direto_ate).toBeUndefined();
    expect((await motor.resumoDaFila()).aguardando).toBe(1);
    await motor.sincronizar();
    expect(await fila.ler('op-n')).toMatchObject({ estado: 'enviado' });
  });
});

describe('D-PROD-308 C — ordem entre as filas', () => {
  it('OR-01 a leitura de um cocho criado sem internet espera a criação; numa sincronização só, sobem os dois, na ordem', async () => {
    const motor = await import('@/lib/offline/sincronizacao/motorDeSincronizacao');
    const { criarFilaEmMemoria } = await import('@/lib/offline/sincronizacao/filaDeEnvio');
    const fila = criarFilaEmMemoria();
    motor.configurarMotorDeSincronizacao({ porta: fila, agora: () => Date.parse('2026-11-25T12:00:00Z'), online: () => navigator.onLine !== false });
    motor.definirSessaoDaFila({ cliente_id: 'cli_A', usuario_id: 'usr_1' });
    // gatilhos liga a espera da fila antiga (carregado depois da configuração do motor)
    const gatilhos = await import('@/lib/offline/sincronizacao/gatilhosDeSincronizacao');

    const ordem = [];
    const { ops } = servidorDePontos();
    const criar = ops.create.getMockImplementation();
    ops.create.mockImplementation(async (d) => {
      ordem.push(`ponto:${d.id}`);
      return criar(d);
    });
    const porta = portaDoPonto(ops);
    motor.registrarTipoDeEnvio({
      tipo: 'cocho.leitura',
      versao: 1,
      offline: true,
      enviar: async (p) => {
        ordem.push(`leitura:${p.ponto_suplementacao_id}`);
        return { id: 'lei-1' };
      },
    });

    online(false);
    const cocho = await porta.create({ empresa_id: 'emp-1', nome_ponto: 'COCHO NOVO' });
    await motor.enviarOuGuardar('cocho.leitura', { ponto_suplementacao_id: cocho.id, escore: 2 }, { operationId: 'op-leitura' });
    online(true);

    // Envio direto de outra leitura no mesmo cocho, com internet, enquanto o cocho está na fila: espera.
    expect(await motor.enviarOuGuardar('cocho.leitura', { ponto_suplementacao_id: cocho.id, escore: 3 }, { operationId: 'op-leitura-2' })).toMatchObject({
      estado: 'aguardando',
    });

    await gatilhos.sincronizarTudo();
    expect(ordem).toEqual([`ponto:${cocho.id}`, `leitura:${cocho.id}`, `leitura:${cocho.id}`]);
    expect((await fila.ler('op-leitura')).estado).toBe('enviado');
    expect((await fila.ler('op-leitura-2')).estado).toBe('enviado');
    motor.definirSessaoDaFila(null);
  });
});

describe('D-PROD-308 D — entre abas', () => {
  it('AB-02 a trava do navegador falhou: sincroniza assim mesmo; erro do trabalho sobe como sempre', async () => {
    Object.defineProperty(window.navigator, 'locks', {
      configurable: true,
      value: { request: vi.fn(async () => { throw new Error('SecurityError'); }) },
    });
    try {
      const { naVezDaSincronia } = await import('@/lib/offline/sincronizacao/vezDaSincronia');
      expect(await naVezDaSincronia(async () => 7)).toBe(7);
    } finally {
      delete /** @type {any} */ (window.navigator).locks;
    }
    Object.defineProperty(window.navigator, 'locks', {
      configurable: true,
      value: { request: vi.fn(async (_n, _o, fn) => fn()) },
    });
    try {
      const { naVezDaSincronia } = await import('@/lib/offline/sincronizacao/vezDaSincronia');
      let vezes = 0;
      await expect(naVezDaSincronia(async () => { vezes += 1; throw new Error('do trabalho'); })).rejects.toThrow('do trabalho');
      expect(vezes).toBe(1);
    } finally {
      delete /** @type {any} */ (window.navigator).locks;
    }
  });

  it('AB-01 com navigator.locks, a sincronização roda dentro da trava "maike-sincronia"', async () => {
    const pedidos = [];
    Object.defineProperty(window.navigator, 'locks', {
      configurable: true,
      value: {
        request: vi.fn(async (nome, opcoes, fn) => {
          pedidos.push([nome, opcoes.mode]);
          return fn();
        }),
      },
    });
    try {
      const { naVezDaSincronia } = await import('@/lib/offline/sincronizacao/vezDaSincronia');
      expect(await naVezDaSincronia(async () => 42)).toBe(42);
      expect(pedidos).toEqual([['maike-sincronia', 'exclusive']]);
    } finally {
      delete /** @type {any} */ (window.navigator).locks;
    }
  });
});
