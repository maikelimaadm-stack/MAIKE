/**
 * Hermeticidade do smoke (P1.3-R1).
 *
 * A CI da P1.3 ficou verde com `[Base44 SDK Error]`, `Network Error` e
 * `AggregateError` no stderr. A causa era **temporal**: o bloqueio de rede vivia
 * em `beforeEach`, e os módulos de teste são avaliados antes disso. Um `import`
 * de topo que puxasse o provider inicializava o SDK real e tentava rede antes de
 * qualquer guarda existir.
 *
 * Este arquivo **não** declara mock local de propósito: ele importa o provider
 * real no topo e prova que a defesa global de `setup.js` já cobre a avaliação.
 * Se alguém remover o `vi.mock` do setup, este é o primeiro teste a acusar.
 */

import { describe, it, expect, vi } from 'vitest';
import { getRegisteredEntityNames, empresaProvider } from '@/apis/_providers/base44Provider';

describe('H — o smoke é hermético desde a avaliação dos módulos', () => {
  it('H1/H2 — o provider real carrega com o stub, sem inicializar o SDK', () => {
    // Se o SDK real tivesse sido instanciado, o import de topo já teria
    // disparado rede antes deste corpo rodar.
    expect(getRegisteredEntityNames().length).toBe(36);
  });

  it('H3/H4 — operação do provider não toca fetch nem XMLHttpRequest', async () => {
    const chamadasFetch = vi.fn();
    const aberturas = vi.fn();
    vi.stubGlobal('fetch', chamadasFetch);
    vi.stubGlobal(
      'XMLHttpRequest',
      class {
        open(...args) { aberturas(...args); }
        send() {}
        setRequestHeader() {}
        addEventListener() {}
      }
    );

    const registros = await empresaProvider.list('-created_date');

    expect(Array.isArray(registros)).toBe(true);
    expect(chamadasFetch).not.toHaveBeenCalled();
    expect(aberturas).not.toHaveBeenCalled();
  });

  it('H5/H6/H7 — nenhuma mensagem de SDK ou de rede é emitida', async () => {
    const linhas = [];
    const espioes = ['log', 'info', 'warn', 'error', 'debug'].map((nivel) =>
      vi.spyOn(console, nivel).mockImplementation((...args) => linhas.push(args.map(String).join(' ')))
    );

    await empresaProvider.list();
    await empresaProvider.create({ nome: 'X' }).catch(() => {});

    const ruido = linhas.filter((linha) =>
      /Base44 SDK Error|Network Error|AggregateError|ECONNREFUSED|ENOTFOUND/.test(linha)
    );
    expect(ruido).toEqual([]);
    espioes.forEach((e) => e.mockRestore());
  });

  it('H8 — o setup instala o stub antes da avaliação dos módulos', async () => {
    const { readFileSync } = await import('node:fs');
    const setup = readFileSync('tests/smoke/setup.js', 'utf8');
    const idxMock = setup.indexOf("vi.mock('@/api/base44Client'");
    const idxBeforeEach = setup.indexOf('beforeEach(');

    expect(idxMock).toBeGreaterThan(-1);
    // O mock precisa estar no escopo do módulo, não dentro de um hook.
    expect(idxMock).toBeLessThan(idxBeforeEach);
  });
});
