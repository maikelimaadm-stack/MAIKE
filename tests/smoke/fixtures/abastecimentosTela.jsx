/**
 * Peças comuns dos testes da tela Abastecimentos (D-PROD-159): monta a PÁGINA
 * real (motor Base1, service, API, porta e nativeHttpClient reais) sobre o
 * backend falso `abastecimentosFakeCore`, e os gestos do formulário.
 * Os `vi.mock` (sessão, Mapa) ficam em cada arquivo de teste.
 */
import React from 'react';
import { expect } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { API_FAKE, instalarBackendFake } from './gestaoBackendFake.js';
import { criarEstadoAbastecimentos, rotearAbastecimentos } from './abastecimentosFakeCore.js';

export const TELA = 'pat-abastecimentos';

/** Permissão efetiva com a linha da tela (visualizar + o que vier). */
export const permissaoCom = (acoes = {}) => ({
  user_email: 'operador',
  modulos_permitidos: ['patrimonio'],
  permissoes_telas: [{ tela_id: TELA, visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes }],
});

/** Prepara storage, token e o backend falso. Devolve `{ estado, backend }`. */
export const prepararAmbiente = async (vi) => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem('empresa_selecionada_id', 'emp-1');
  window.localStorage.setItem('empresa_selecionada_cliente_id', 'cli-1');
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  const estado = criarEstadoAbastecimentos();
  const ambiente = { estado, backend: /** @type {any} */ (null), falhar: /** @type {any} */ (null) };
  ambiente.backend = instalarBackendFake(async (req) => {
    if (ambiente.falhar) {
      const r = ambiente.falhar(req);
      if (r) return r;
    }
    return rotearAbastecimentos(estado, req);
  });
  return ambiente;
};

export const montar = async () => {
  const { default: Pagina } = await import('@/pages/Abastecimentos.jsx');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <Pagina />
    </QueryClientProvider>,
  );
  return queryClient;
};

/** Abre um `SeletorPaginadoGestao` e escolhe a opção cujo nome casa com `nome`. */
export const escolherNoSeletor = async (raiz, testId, nome) => {
  // O seletor dependente (produto, local) só habilita depois que a escolha
  // anterior assenta; clicar antes não abre o painel e a opção nunca aparece.
  await waitFor(() => expect(within(raiz).getByTestId(testId)).not.toBeDisabled());
  fireEvent.click(within(raiz).getByTestId(testId));
  fireEvent.click(await within(raiz).findByRole('option', { name: nome }));
  await waitFor(() => expect(within(raiz).queryByTestId(`${testId}-painel`)).toBeNull());
};

export const abrirNovo = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Novo abastecimento' }));
  return screen.findByTestId('abastecimento-form');
};

/** Digita num campo de texto (`CampoNumero`) e sai dele. */
export const digitar = (form, testId, valor) => {
  const campo = within(form).getByTestId(testId);
  fireEvent.change(campo, { target: { value: valor } });
  fireEvent.blur(campo);
};

/** Trator TP-02: um tanque (auto), diesel (auto), produto com fator, um local (auto). */
export const preencherTrator = async (form, { litros = '80', leitura = '1.550,5', tanqueCheio = true } = {}) => {
  await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
  await within(form).findByText('Capacidade nominal: 180,0000 L');
  await waitFor(() => expect(within(within(form).getByTestId('abastecimento-combustivel')).getByRole('radio', { name: 'Diesel S10' }).getAttribute('aria-checked')).toBe('true'));
  await escolherNoSeletor(form, 'abastecimento-produto', /Diesel S10 granel/);
  await within(form).findByText(/Fator: 0,840000 kg\/L \(versão 1\)/);
  await waitFor(() => expect(within(form).getByRole('combobox', { name: 'Local de estoque' }).textContent).toMatch(/Tanque diesel sede/));
  digitar(form, 'abastecimento-litros', litros);
  if (leitura !== null) digitar(form, 'abastecimento-leitura', leitura);
  if (tanqueCheio) fireEvent.click(within(form).getByTestId('abastecimento-tanque-cheio'));
};

export const pedirPrevia = async (form) => {
  await act(async () => {
    fireEvent.click(within(form).getByTestId('abastecimento-previa'));
  });
  return screen.findByTestId('dialogo-previa-abastecimento');
};

/** Chamadas por método + caminho. */
export const chamadasDe = (backend, method, path) => backend.chamadas.filter((c) => c.method === method && c.path === path);
