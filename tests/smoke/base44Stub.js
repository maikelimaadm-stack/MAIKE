import { vi } from 'vitest';

/**
 * Stub do cliente Base44 para o smoke.
 *
 * Nenhuma chamada sai da máquina: todas as entidades respondem lista vazia.
 */
const listaVazia = () => Promise.resolve([]);

export const createEntityStub = () => ({
  list: listaVazia,
  filter: listaVazia,
  get: () => Promise.resolve(null),
  create: (data) => Promise.resolve({ id: 'stub', ...data }),
  update: (id, data) => Promise.resolve({ id, ...data }),
  delete: () => Promise.resolve(),
  bulkCreate: () => Promise.resolve([]),
});

export const createBase44Stub = () => ({
  entities: new Proxy({}, { get: () => createEntityStub() }),
  auth: {
    me: () => Promise.resolve({ email: 'smoke@local', full_name: 'Smoke', role: 'admin' }),
    logout: vi.fn(),
    login: vi.fn(),
  },
  integrations: { Core: { UploadFile: vi.fn(() => Promise.resolve({ file_url: 'stub://arquivo' })) } },
  functions: { invoke: vi.fn(() => Promise.resolve({})) },
});
