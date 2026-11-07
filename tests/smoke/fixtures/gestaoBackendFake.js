/**
 * Backend falso das telas de Gestão Rural (D-PROD-145) — só a borda de rede.
 *
 * Substitui `fetch` e responde como o Fastify real (envelope keyset, `{ itens }`,
 * corpo de erro `{ code, message, request_id, field?, reason?, details? }`).
 * Toda chamada fica registrada em `chamadas` para as asserções.
 */
import { vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

export const API_FAKE = 'https://backend.gestao.invalido';

/** @param {number} status @param {unknown} corpo */
export const resposta = (status, corpo) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)),
});

export const envelope = (items) => ({ items, next_cursor: null, has_more: false, total: items.length, limit: 100 });

/** Corpo de erro como o errorHandler do servidor monta. */
export const erroServidor = (status, code, extra = {}) => ({ status, body: { code, message: 'texto do servidor', request_id: 'req_1', ...extra } });

/**
 * @param {(req: { method: string, path: string, query: URLSearchParams, body: any }) => ({ status: number, body?: unknown } | undefined)} rotear
 */
export const instalarBackendFake = (rotear) => {
  /** @type {Array<{ method: string, path: string, query: Record<string, string>, body: any }>} */
  const chamadas = [];
  const fetchFake = vi.fn(async (url, init = {}) => {
    const u = new URL(String(url));
    const path = u.pathname.replace(/^\/api\/native(?=\/)/, '');
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : null;
    chamadas.push({ method, path, query: Object.fromEntries(u.searchParams.entries()), body });
    const r = rotear({ method, path, query: u.searchParams, body });
    if (!r) return resposta(404, { code: 'NOT_FOUND', message: 'rota falsa ausente', request_id: 'x' });
    return resposta(r.status, r.body);
  });
  vi.stubGlobal('fetch', fetchFake);
  return { chamadas, fetchFake };
};

/** Abre um `B1Select` (combobox) e escolhe a opção pelo rótulo. */
export const escolherOpcao = async (combobox, rotulo) => {
  await act(async () => fireEvent.click(combobox));
  const opcao = await screen.findByRole('option', { name: rotulo });
  await act(async () => fireEvent.click(opcao));
};

/** Rótulos das opções de um `B1Select` (abre, lê e fecha). */
export const rotulosDasOpcoes = async (combobox) => {
  await act(async () => fireEvent.click(combobox));
  const nomes = (await screen.findAllByRole('option')).map((o) => o.textContent.trim());
  await act(async () => fireEvent.click(combobox));
  return nomes;
};
