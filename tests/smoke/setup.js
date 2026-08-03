import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, vi } from 'vitest';

/**
 * Guardas globais do smoke:
 *  - nenhuma chamada de rede real;
 *  - nenhum `console.error` inesperado;
 *  - nenhuma unhandled rejection.
 */

const erros = [];
const rejeicoes = [];

const onRejection = (event) => {
  rejeicoes.push(event.reason ?? event);
  event.preventDefault?.();
};

beforeEach(() => {
  erros.length = 0;
  rejeicoes.length = 0;

  vi.spyOn(console, 'error').mockImplementation((...args) => {
    erros.push(args.map(String).join(' '));
  });

  // Rede bloqueada: qualquer chamada real é falha do teste.
  const bloquear = (api) => {
    throw new Error(`Rede bloqueada no smoke (${api}): nenhuma chamada externa é permitida.`);
  };
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Rede bloqueada no smoke: fetch'))));
  vi.stubGlobal(
    'XMLHttpRequest',
    class {
      open() {
        bloquear('XMLHttpRequest');
      }
      send() {
        bloquear('XMLHttpRequest');
      }
      setRequestHeader() {}
      addEventListener() {}
    }
  );

  // Geolocalização nunca é consultada de verdade. As propriedades são definidas
  // sobre o Navigator real do jsdom — substituir o objeto quebra os brand checks.
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  Object.defineProperty(window.navigator, 'geolocation', {
    value: {
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn(() => 0),
      clearWatch: vi.fn(),
    },
    configurable: true,
  });

  window.addEventListener('unhandledrejection', onRejection);
});

afterEach(() => {
  window.removeEventListener('unhandledrejection', onRejection);

  const inesperados = erros.filter((linha) => !/\[smoke-esperado\]/.test(linha));
  expect(inesperados, `console.error inesperado:\n${inesperados.join('\n')}`).toEqual([]);
  expect(rejeicoes, `unhandled rejection:\n${rejeicoes.map(String).join('\n')}`).toEqual([]);
});
