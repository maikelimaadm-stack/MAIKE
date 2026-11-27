/**
 * D-PROD-350 — celular de mais de uma pessoa (como o AgriWebb).
 *
 *  SP-01 sair com pendências: com internet, tenta enviar antes e conta de novo; se tudo subiu, não pergunta
 *  SP-02 sem internet: não espera; conta o que ficou
 *  SP-03 o aviso diz a quantidade e que sobe quando alguém desta fazenda entrar (não "só esta mesma conta")
 * O dono da fila é a conta, não a pessoa: tests/smoke/motorSincronizacao.test.js (MS-15).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let fila = { aguardando: 0, atencao: 0 };
const enviarAgora = vi.fn(async () => {
  fila = { aguardando: 0, atencao: fila.atencao };
});
vi.mock('@/services/sincronizacaoService', () => ({
  lerFilaDeEnvio: async () => ({ ...fila, itens: [] }),
  enviarAgora: (...a) => enviarAgora(...a),
}));

const online = (v) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });

beforeEach(() => {
  enviarAgora.mockClear();
  online(true);
});
afterEach(() => online(true));

describe('D-PROD-350 — sair com registros não enviados', () => {
  it('SP-01 com internet: envia antes e conta de novo', async () => {
    const { pendentesAoSair } = await import('@/services/sairComPendencias');
    fila = { aguardando: 3, atencao: 0 };
    expect(await pendentesAoSair()).toBe(0);
    expect(enviarAgora).toHaveBeenCalledTimes(1);
    fila = { aguardando: 2, atencao: 1 };
    expect(await pendentesAoSair()).toBe(1); // o que precisa de atenção não sobe sozinho
    fila = { aguardando: 0, atencao: 0 };
    enviarAgora.mockClear();
    expect(await pendentesAoSair()).toBe(0);
    expect(enviarAgora).not.toHaveBeenCalled();
  });

  it('SP-01b o envio que não responde não prende o sair', async () => {
    const { pendentesAoSair } = await import('@/services/sairComPendencias');
    fila = { aguardando: 2, atencao: 0 };
    enviarAgora.mockImplementationOnce(() => new Promise(() => {}));
    expect(await pendentesAoSair({ esperaMs: 20 })).toBe(2);
  });

  it('SP-02 sem internet: não espera o envio', async () => {
    const { pendentesAoSair } = await import('@/services/sairComPendencias');
    online(false);
    fila = { aguardando: 4, atencao: 0 };
    expect(await pendentesAoSair()).toBe(4);
    expect(enviarAgora).not.toHaveBeenCalled();
  });

  it('SP-03 o aviso diz a quantidade e quem pode enviar', async () => {
    const { avisoDeSairComPendencias } = await import('@/services/sairComPendencias');
    expect(avisoDeSairComPendencias(1)).toMatch(/^1 registro feito neste celular ainda não chegou ao sistema\. Ele fica guardado aqui e sobe quando alguém desta fazenda entrar com internet\./);
    expect(avisoDeSairComPendencias(3)).toMatch(/^3 registros feitos neste celular ainda não chegaram ao sistema\. Eles ficam guardados aqui e sobem/);
  });
});
