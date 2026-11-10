/**
 * Peças comuns dos testes da tela Abastecimentos (D-PROD-159; fluxo por
 * PRODUTO da UX-02, D-PROD-160; Produtos aceitos do tanque e quantidade na
 * unidade do Produto da D-PROD-161): monta a PÁGINA real (motor Base1,
 * service, API, porta e nativeHttpClient reais) sobre o backend falso
 * `abastecimentosFakeCore`, e os gestos do formulário.
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

/** O radio do Produto `nome` (escolha por botões) está marcado. */
export const esperarProdutoMarcado = async (form, nome) => {
  await waitFor(() => expect(within(within(form).getByTestId('abastecimento-produto')).getByRole('radio', { name: nome }).getAttribute('aria-checked')).toBe('true'));
};

/** Escolhe o Produto `nome` nos botões (2..6 opções completas). */
export const escolherProduto = async (form, nome) => {
  const grupo = await within(form).findByTestId('abastecimento-produto');
  fireEvent.click(within(grupo).getByRole('radio', { name: nome }));
  await esperarProdutoMarcado(form, nome);
};

/** "Completou o tanque?" Sim/Não. */
export const responderTanqueCheio = (form, sim) => {
  fireEvent.click(within(within(form).getByTestId('abastecimento-tanque-cheio')).getByRole('radio', { name: sim ? 'Sim' : 'Não' }));
};

/**
 * Trator TP-02: máquina → o ÚNICO Produto aceito pelo tanque ("Diesel S10
 * granel", em L) já vem marcado (resposta completa) → local único automático →
 * quantidade (na unidade do Produto), horímetro e "Completou o tanque?".
 * Nenhuma etapa de combustível nem de fator.
 */
export const preencherTrator = async (form, { quantidade = '80', leitura = '1.550,5', tanqueCheio = true } = {}) => {
  await escolherNoSeletor(form, 'abastecimento-bem', /Trator TP-02/);
  await esperarProdutoMarcado(form, 'Diesel S10 granel');
  await waitFor(() => expect(within(form).getByTestId('abastecimento-local-auto')).toHaveTextContent('Sai do estoque: Tanque diesel sede'));
  digitar(form, 'abastecimento-quantidade', quantidade);
  if (leitura !== null) digitar(form, 'abastecimento-leitura', leitura);
  if (tanqueCheio) responderTanqueCheio(form, true);
};

/** Abre "Detalhes do estoque" da revisão (recolhido por padrão). */
export const abrirDetalhesDoEstoque = (dialogo) => {
  const botao = within(dialogo).getByTestId('previa-detalhes-estoque');
  if (botao.getAttribute('aria-expanded') !== 'true') fireEvent.click(botao);
  return within(dialogo).getByTestId('previa-detalhes-conteudo');
};

export const pedirPrevia = async (form) => {
  await act(async () => {
    fireEvent.click(within(form).getByTestId('abastecimento-previa'));
  });
  return screen.findByTestId('dialogo-previa-abastecimento');
};

/** Chamadas por método + caminho. */
export const chamadasDe = (backend, method, path) => backend.chamadas.filter((c) => c.method === method && c.path === path);
