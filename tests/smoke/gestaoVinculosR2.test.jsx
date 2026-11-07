/**
 * D-PROD-146 — R2/B3: o `PUT` dos vínculos SUBSTITUI o conjunto. Estes testes
 * provam que nenhum `PUT` indevido sai (carga pendente, erro de leitura, erro
 * das opções, troca de centro/empresa, clique duplo) e que o `PUT` válido leva
 * empresa, centro e ids corretos. Componente real, services/API/porta e
 * nativeHttpClient reais; só o `fetch` é falso (com respostas atrasáveis).
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { API_FAKE, erroServidor, instalarBackendFake } from './fixtures/gestaoBackendFake.js';

/** Resposta que só chega quando o teste mandar. */
const adiada = () => {
  /** @type {(v: any) => void} */
  let liberar = () => {};
  const promessa = new Promise((r) => {
    liberar = r;
  });
  return { promessa, liberar };
};

const CR = {
  r1: { id: 'r1', numero: 1, nome: 'BEZERROS', ativo: true },
  r2: { id: 'r2', numero: 2, nome: 'NOVILHAS', ativo: true },
  r3: { id: 'r3', numero: 3, nome: 'RECRIA', ativo: true },
};

let backend;
/** @type {Record<string, string[]>} vínculos por empresa:centro */
let banco;
/** @type {Record<string, ReturnType<typeof adiada> | null>} */
let segurar;
let falharLeitura;
let falharOpcoes;

const puts = () => backend.chamadas.filter((c) => c.method === 'PUT');

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  window.localStorage.clear();
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  banco = { 'emp-1:c1': ['r1'], 'emp-1:c2': ['r2', 'r3'], 'emp-2:c1': ['r3'] };
  segurar = { leitura: null, put: null };
  falharLeitura = false;
  falharOpcoes = false;
  backend = instalarBackendFake(async ({ method, path, query, body }) => {
    const m = path.match(/^\/centros-custo\/([^/]+)\/centros-resultado$/);
    if (m && method === 'GET') {
      if (segurar.leitura) await segurar.leitura.promessa;
      if (falharLeitura) return erroServidor(500, 'INTERNAL_ERROR');
      return { status: 200, body: { itens: (banco[`${query.get('empresa_id')}:${m[1]}`] ?? []).map((id) => CR[id]) } };
    }
    if (m && method === 'PUT') {
      if (segurar.put) await segurar.put.promessa;
      banco[`${body.empresa_id}:${m[1]}`] = [...body.centro_resultado_ids];
      return { status: 200, body: { alterado: true, itens: body.centro_resultado_ids.map((id) => CR[id]) } };
    }
    if (method === 'GET' && path === '/centros-custo-opcoes/centros-resultado') {
      if (falharOpcoes) return erroServidor(500, 'INTERNAL_ERROR');
      return { status: 200, body: { itens: Object.values(CR) } };
    }
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Monta como a tela monta: `key` empresa+centro. Devolve o trocador de registro. */
const montar = async (inicial = { empresaId: 'emp-1', centroCustoId: 'c1' }) => {
  const { VinculosCentroCusto } = await import('@/components/gestao/VinculosCentros');
  /** @type {(v: { empresaId: string, centroCustoId: string }) => void} */
  let trocar = () => {};
  function Registro() {
    const [r, setR] = useState(inicial);
    trocar = setR;
    return <VinculosCentroCusto key={`${r.empresaId}:${r.centroCustoId}`} empresaId={r.empresaId} centroCustoId={r.centroCustoId} podeEditar />;
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <Registro />
    </QueryClientProvider>,
  );
  return { trocar: (v) => act(() => trocar(v)) };
};

const secao = () => screen.getByTestId('vinculos-centro-custo');
const botao = (nome) => within(secao()).getByRole('button', { name: nome });
const marcados = () => within(secao()).queryAllByRole('checkbox').filter((c) => c.getAttribute('aria-checked') === 'true').map((c) => c.textContent);
const esperarOpcoes = () => waitFor(() => expect(within(secao()).queryAllByRole('checkbox').length).toBe(3));
/** Salvar só habilita com o conjunto real e as opções lidas (nada sendo relido). */
const clicarSalvarQuandoPronto = async (nome = 'Salvar vínculos') => {
  await waitFor(() => expect(botao(nome).disabled).toBe(false));
  fireEvent.click(botao(nome));
};

describe('B3 — vínculo N:N: nenhum PUT indevido', () => {
  it('leitura atrasada: "Alterar vínculos" bloqueado até o conjunto real chegar; depois a seleção é a foto do banco', async () => {
    segurar.leitura = adiada();
    await montar();
    const alterar = await waitFor(() => botao('Alterar vínculos'));
    expect(alterar.disabled).toBe(true);
    fireEvent.click(alterar);
    expect(within(secao()).queryByRole('button', { name: 'Salvar vínculos' })).toBeNull();
    await act(async () => segurar.leitura.liberar());
    await waitFor(() => expect(botao('Alterar vínculos').disabled).toBe(false));
    fireEvent.click(botao('Alterar vínculos'));
    await esperarOpcoes();
    expect(marcados()).toEqual(['1 · BEZERROS']);
    await clicarSalvarQuandoPronto();
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toMatchObject({ path: '/centros-custo/c1/centros-resultado', body: { empresa_id: 'emp-1', centro_resultado_ids: ['r1'] } });
  });

  it('erro 500 na leitura: aviso + "Tentar novamente"; edição bloqueada; nenhum PUT', async () => {
    falharLeitura = true;
    await montar();
    await waitFor(() => expect(within(secao()).getByRole('button', { name: 'Tentar novamente' })).toBeTruthy());
    expect(botao('Alterar vínculos').disabled).toBe(true);
    fireEvent.click(botao('Alterar vínculos'));
    expect(within(secao()).queryByRole('button', { name: 'Salvar vínculos' })).toBeNull();
    falharLeitura = false;
    fireEvent.click(within(secao()).getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(botao('Alterar vínculos').disabled).toBe(false));
    expect(puts()).toHaveLength(0);
  });

  it('erro nas opções: salvar fica bloqueado (lista incompleta); nenhum PUT', async () => {
    falharOpcoes = true;
    await montar();
    await waitFor(() => expect(botao('Alterar vínculos').disabled).toBe(false));
    fireEvent.click(botao('Alterar vínculos'));
    await waitFor(() => expect(within(secao()).getAllByRole('alert').length).toBeGreaterThan(0));
    expect(botao('Salvar vínculos').disabled).toBe(true);
    fireEvent.click(botao('Salvar vínculos'));
    expect(puts()).toHaveLength(0);
  });

  it('esvaziar exige confirmação explícita; só então sai o PUT com lista vazia', async () => {
    await montar();
    await waitFor(() => expect(botao('Alterar vínculos').disabled).toBe(false));
    fireEvent.click(botao('Alterar vínculos'));
    await esperarOpcoes();
    fireEvent.click(within(secao()).getByRole('checkbox', { name: /BEZERROS/ }));
    await clicarSalvarQuandoPronto();
    expect(await screen.findByTestId('vinculos-confirmar-vazio')).toBeTruthy();
    expect(puts()).toHaveLength(0);
    fireEvent.click(botao('Confirmar remoção'));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual({ empresa_id: 'emp-1', centro_resultado_ids: [] });
  });

  it('cancelar restaura sem gravar; reabrir parte de novo da foto do banco', async () => {
    await montar();
    await waitFor(() => expect(botao('Alterar vínculos').disabled).toBe(false));
    fireEvent.click(botao('Alterar vínculos'));
    await esperarOpcoes();
    fireEvent.click(within(secao()).getByRole('checkbox', { name: /NOVILHAS/ }));
    fireEvent.click(botao('Cancelar'));
    fireEvent.click(botao('Alterar vínculos'));
    await esperarOpcoes();
    expect(marcados()).toEqual(['1 · BEZERROS']);
    expect(puts()).toHaveLength(0);
  });

  it('trocar de centro durante a edição zera a edição; o PUT seguinte usa o centro e os ids do novo registro', async () => {
    const { trocar } = await montar();
    await waitFor(() => expect(botao('Alterar vínculos').disabled).toBe(false));
    fireEvent.click(botao('Alterar vínculos'));
    await esperarOpcoes();
    fireEvent.click(within(secao()).getByRole('checkbox', { name: /NOVILHAS/ }));
    await trocar({ empresaId: 'emp-1', centroCustoId: 'c2' });
    expect(within(secao()).queryByRole('button', { name: 'Salvar vínculos' })).toBeNull();
    await waitFor(() => expect(botao('Alterar vínculos').disabled).toBe(false));
    fireEvent.click(botao('Alterar vínculos'));
    await esperarOpcoes();
    expect(marcados().sort()).toEqual(['2 · NOVILHAS', '3 · RECRIA']);
    await clicarSalvarQuandoPronto();
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toMatchObject({ path: '/centros-custo/c2/centros-resultado', body: { empresa_id: 'emp-1', centro_resultado_ids: ['r2', 'r3'] } });
    expect(banco['emp-1:c1']).toEqual(['r1']);
  });

  it('trocar de empresa zera a edição e relê na empresa nova; nenhum PUT', async () => {
    const { trocar } = await montar();
    await waitFor(() => expect(botao('Alterar vínculos').disabled).toBe(false));
    fireEvent.click(botao('Alterar vínculos'));
    await esperarOpcoes();
    await trocar({ empresaId: 'emp-2', centroCustoId: 'c1' });
    await waitFor(() => expect(within(secao()).getByText(/RECRIA/)).toBeTruthy());
    expect(within(secao()).queryByRole('button', { name: 'Salvar vínculos' })).toBeNull();
    expect(backend.chamadas.some((c) => c.method === 'GET' && c.query.empresa_id === 'emp-2')).toBe(true);
    expect(puts()).toHaveLength(0);
  });

  it('clique duplo: um único PUT; botão travado enquanto salva; resposta atrasada não vaza para outro registro', async () => {
    const { trocar } = await montar();
    await waitFor(() => expect(botao('Alterar vínculos').disabled).toBe(false));
    fireEvent.click(botao('Alterar vínculos'));
    await esperarOpcoes();
    fireEvent.click(within(secao()).getByRole('checkbox', { name: /NOVILHAS/ }));
    segurar.put = adiada();
    await waitFor(() => expect(botao('Salvar vínculos').disabled).toBe(false));
    const salvarBtn = botao('Salvar vínculos');
    fireEvent.click(salvarBtn); // clique duplo no MESMO botão
    fireEvent.click(salvarBtn);
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(within(secao()).getByRole('button', { name: 'Salvando…' }).disabled).toBe(true);
    // Troca para c2 com o PUT de c1 ainda pendente; a resposta de c1 chega depois.
    await trocar({ empresaId: 'emp-1', centroCustoId: 'c2' });
    await act(async () => segurar.put.liberar());
    await waitFor(() => expect(within(secao()).getByText(/RECRIA/)).toBeTruthy());
    expect(within(secao()).queryByRole('button', { name: /Salvar/ })).toBeNull();
    expect(puts()).toHaveLength(1);
    expect(puts()[0]).toMatchObject({ path: '/centros-custo/c1/centros-resultado', body: { empresa_id: 'emp-1', centro_resultado_ids: ['r1', 'r2'] } });
    expect(banco['emp-1:c2']).toEqual(['r2', 'r3']);
  });
});
