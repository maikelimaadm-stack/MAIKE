/**
 * D-PROD-178, seção 6 — `FormularioPonto`: o campo `capacidade_cocho_kg` passa
 * a se chamar LIMITE OPERACIONAL (máximo recomendado pelo proprietário, que pode
 * ser menor que a capacidade física). Mesmo campo e mesmo payload; só mudam
 * rótulo, texto de ajuda e mensagens de validação.
 *
 *  D-PROD-370 (cadastro simples, pedido do proprietário): os rótulos passam a "Limite do cocho/depósito (kg)", sem
 *  texto de ajuda embaixo do campo e sem o aviso do mínimo ≥ limite.
 *  FP-1. cocho: "Limite do cocho (kg)", sem ajuda e sem os campos de alerta; validação "Informe o limite do cocho em kg.";
 *  FP-2. depósito: "Limite do depósito (kg)" e "Estoque mínimo (kg)"; validações; o payload grava os MESMOS
 *        campos (`capacidade_cocho_kg`, `estoque_minimo_kg`);
 *  FP-3. depósito: mínimo ≥ limite não mostra aviso e salva como antes;
 *  FP-4. a tabela do Cadastro do Mapa chama o mesmo campo pelo nome novo.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const svc = vi.hoisted(() => ({
  criarPonto: vi.fn(),
  atualizarPonto: vi.fn(),
  criarPontoSuplementacao: vi.fn(),
  atualizarPontoSuplementacao: vi.fn(),
  criarLocal: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/services/mapaService', () => ({
  listarIconesPorTipoEntidade: vi.fn(async () => []),
  listarTodosPontos: vi.fn(async () => []),
  listarPontosAtivos: vi.fn(async () => []),
  listarTodosPontosSuplementacao: vi.fn(async () => []),
  listarTodosBebedouros: vi.fn(async () => []),
  listarSetoresAtivos: vi.fn(async () => [{ id: 's1', nome: 'SETOR 1', empresa_id: 'emp-1' }]),
  listarAreasAtivas: vi.fn(async () => [{ id: 'a1', nome: 'PASTO 1', setor_id: 's1', empresa_id: 'emp-1' }]),
  criarPonto: (...a) => svc.criarPonto(...a),
  atualizarPonto: (...a) => svc.atualizarPonto(...a),
  criarPontoSuplementacao: (...a) => svc.criarPontoSuplementacao(...a),
  atualizarPontoSuplementacao: (...a) => svc.atualizarPontoSuplementacao(...a),
}));
vi.mock('@/services/estoqueMapaService', () => ({
  listarTodosProdutos: vi.fn(async () => []),
  listarTodosLocais: vi.fn(async () => []),
  criarLocal: (...a) => svc.criarLocal(...a),
  atualizarLocal: vi.fn(),
  buscarLotesNotaPorCriterio: vi.fn(async () => []),
  atualizarLoteNota: vi.fn(),
  listarMovimentacoesRecentes: vi.fn(async () => []),
  atualizarMovimentacao: vi.fn(),
}));
vi.mock('@/services/bebedouroDataService', () => ({ atualizarBebedouro: vi.fn(), criarBebedouro: vi.fn() }));
vi.mock('@/components/mapa/CapturaGPSPonto', () => ({ default: () => null }));
vi.mock('@/components/mapa/SelecaoAreasMapa', () => ({ default: () => null }));
vi.mock('@/components/mapa/SelecaoDepositoMapa', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (...a) => svc.toastError(...a) } }));

const { default: FormularioPonto } = await import('@/components/mapa/FormularioPonto');

const AJUDA_LIMITE = 'Máximo recomendado que você define (pode ser menor que a capacidade física, por exemplo no período chuvoso). Usado para mostrar a ocupação e o excesso.';
const AJUDA_MINIMO = 'Abaixo deste saldo o mapa avisa para repor.';
const COORDENADAS = { lat: -15.6, lng: -56.1 };

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  svc.toastError.mockReset();
  svc.criarPonto.mockReset().mockImplementation(async (d) => ({ id: 'ref-novo', ...d }));
  svc.atualizarPonto.mockReset().mockImplementation(async (id, d) => ({ id, ...d }));
  svc.criarPontoSuplementacao.mockReset().mockImplementation(async (d) => ({ id: 'supl-novo', ...d }));
  svc.atualizarPontoSuplementacao.mockReset();
  svc.criarLocal.mockReset().mockImplementation(async (d) => ({ id: 'loc-novo', ...d }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const montar = async (item) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <FormularioPonto coordenadas={COORDENADAS} item={item} onSave={() => {}} onCancel={() => {}} />
    </QueryClientProvider>,
  );
  await act(async () => {});
};
/** Campo pelo rótulo (o rótulo inclui o " *" de obrigatório). */
const campo = (rotulo) => /** @type {HTMLInputElement} */ (screen.getByLabelText(new RegExp(`^${rotulo.replace(/[()]/g, '\\$&')}`)));
const ajudaDe = (input) => document.getElementById(input.getAttribute('aria-describedby') || '')?.textContent;
const enviar = async () => {
  await act(async () => {
    fireEvent.submit(screen.getByTestId('b1-form-ponto'));
  });
};

describe('FormularioPonto — limite (D-PROD-178; D-PROD-370: sem textos de ajuda nem aviso)', () => {
  it('FP-1 — cocho: "Limite do cocho (kg)", sem texto de ajuda, sem os campos de alerta; validação com o nome novo', async () => {
    await montar({ id: 'p1', nome: 'COCHO 1', tipo: 'COCHO', setor_id: 's1', area_vinculada_ids: ['a1'], area_vinculada_id: 'a1', deposito_origem_id: 'dep1' });
    await waitFor(() => expect(screen.getByText('Dados do Cocho')).toBeTruthy());
    const limite = campo('Limite do cocho (kg)');
    expect(limite.type).toBe('number');
    expect(limite.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByText(AJUDA_LIMITE)).toBeNull();
    expect(screen.queryByText(/Capacidade do cocho/)).toBeNull();
    expect(screen.queryByLabelText(/Dias de alerta para reposição/)).toBeNull();
    expect(screen.queryByLabelText(/Alerta sem lançamento/)).toBeNull();

    await enviar();
    expect(svc.toastError).toHaveBeenCalledWith('Informe o limite do cocho em kg.');
    expect(svc.toastError.mock.calls.flat().join(' ')).not.toMatch(/capacidade/i);
  });

  it('FP-2 — depósito: rótulos, validações e o MESMO payload', async () => {
    await montar({ id: 'p2', nome: 'DEPÓSITO 1', tipo: 'DEPÓSITO', setor_id: 's1' });
    await waitFor(() => expect(screen.getByText('Depósito de Suplementação')).toBeTruthy());
    const limite = campo('Limite do depósito (kg)');
    const minimo = campo('Estoque mínimo (kg)');
    expect(screen.queryByText(AJUDA_LIMITE)).toBeNull();
    expect(screen.queryByText(AJUDA_MINIMO)).toBeNull();
    expect(screen.queryByText(/Capacidade do depósito/)).toBeNull();

    await enviar();
    expect(svc.toastError).toHaveBeenLastCalledWith('Informe o limite do depósito em kg.');

    await act(async () => {
      fireEvent.change(limite, { target: { value: '250' } });
    });
    await enviar();
    expect(svc.toastError).toHaveBeenLastCalledWith('Informe o estoque mínimo do depósito em kg.');

    await act(async () => {
      fireEvent.change(minimo, { target: { value: '100' } });
    });
    await enviar();
    await waitFor(() => expect(svc.criarPontoSuplementacao).toHaveBeenCalledTimes(1));
    expect(svc.criarPontoSuplementacao).toHaveBeenCalledWith(expect.objectContaining({
      categoria_ponto: 'DEPOSITO',
      capacidade_cocho_kg: 250,
      estoque_minimo_kg: 100,
    }));
    expect(Object.keys(svc.criarPontoSuplementacao.mock.calls[0][0]).some((chave) => /limite_operacional/.test(chave))).toBe(false);
  });

  it('FP-3 — depósito: estoque mínimo ≥ limite não mostra aviso (D-PROD-370) e salva como antes', async () => {
    await montar({ id: 'p3', nome: 'DEPÓSITO 2', tipo: 'DEPÓSITO', setor_id: 's1' });
    await waitFor(() => expect(screen.getByText('Depósito de Suplementação')).toBeTruthy());
    const limite = campo('Limite do depósito (kg)');
    const minimo = campo('Estoque mínimo (kg)');
    await act(async () => {
      fireEvent.change(limite, { target: { value: '80' } });
      fireEvent.change(minimo, { target: { value: '80' } });
    });
    expect(screen.queryByText(/estoque mínimo está igual ou acima do limite/)).toBeNull();
    await enviar();
    await waitFor(() => expect(svc.criarPontoSuplementacao).toHaveBeenCalledTimes(1));
    expect(svc.criarPontoSuplementacao).toHaveBeenCalledWith(expect.objectContaining({ capacidade_cocho_kg: 80, estoque_minimo_kg: 80 }));
  });

  it('FP-4 — Cadastro do Mapa: a coluna do campo diz limite operacional (kg) e capacidade (L) dos bebedouros', async () => {
    const { COLUNAS_PONTOS } = await import('@/components/mapa/cadastro/colunasCadastroMapa');
    const coluna = COLUNAS_PONTOS.find((item) => item.id === 'capacidade');
    expect(coluna?.label).toBe('Limite op. (kg) / Capac. (L)');
    expect(COLUNAS_PONTOS.some((item) => item.label === 'Capacidade (kg)')).toBe(false);
  });
});


it('oferece Cocho e Depósito sem ícones cadastrados e abre os respectivos campos', async () => {
  await montar();
  const seletor = screen.getAllByRole('combobox')[0];
  fireEvent.click(seletor);
  fireEvent.click(await screen.findByRole('option', { name: /^COCHO$/i }));
  expect(screen.getByText('Dados do Cocho')).toBeTruthy();
  fireEvent.click(seletor);
  fireEvent.click(await screen.findByRole('option', { name: /^DEPÓSITO$/i }));
  expect(screen.getByText('Depósito de Suplementação')).toBeTruthy();
  expect(screen.queryByText('Dados do Cocho')).toBeNull();
});

describe('D-PROD-370 — cadastro de ponto simples (sem instruções, sem avisos, sem Observações)', () => {
  const textosQueSairam = [
    /Observações/,
    /Área detectada/,
    /Selecione uma ou mais/,
    /Cadastre primeiro um ponto do tipo depósito/,
    /um local de estoque será criado/,
    /Local de estoque atual/,
    /Gestão de Bebedouros/,
    /Avisa quando o saldo estimado/,
    /Dias de alerta para reposição/,
    /Alerta sem lançamento/,
    /Máximo recomendado que você define/,
    /Abaixo deste saldo o mapa avisa/,
  ];
  const semNadaDisso = () => {
    const texto = screen.getByTestId('b1-form-ponto').textContent;
    for (const t of textosQueSairam) expect(texto, String(t)).not.toMatch(t);
    // nenhum parágrafo de ajuda e nenhuma caixa colorida de aviso no formulário
    expect(screen.getByTestId('b1-form-ponto').querySelector('p.text-slate-500, .bg-amber-50, .bg-blue-50, .bg-emerald-50')).toBeNull();
  };

  it('PS-1: "Tipo do ponto" no lugar de "Ponto de referência"; cocho, depósito e bebedouro sem textos de instrução, avisos nem Observações', async () => {
    await montar();
    expect(screen.getByRole('combobox', { name: /Tipo do ponto/ })).toBeInTheDocument();
    expect(screen.queryByText(/^Ponto de referência/)).toBeNull();
    const seletor = screen.getAllByRole('combobox')[0];
    for (const tipo of [/^COCHO$/i, /^DEPÓSITO$/i]) {
      fireEvent.click(seletor);
      fireEvent.click(await screen.findByRole('option', { name: tipo }));
      semNadaDisso();
    }
  });

  it('PS-2: cocho sem depósito cadastrado diz isso no próprio campo (sem caixa de aviso) e o salvar explica', async () => {
    await montar({ id: 'p9', nome: 'COCHO 9', tipo: 'COCHO', setor_id: 's1', area_vinculada_ids: ['a1'], area_vinculada_id: 'a1' });
    await waitFor(() => expect(screen.getByText('Dados do Cocho')).toBeTruthy());
    expect(screen.getByText('Depósito de onde sai o produto *')).toBeInTheDocument();
    expect(screen.getByText('Pastos do cocho *')).toBeInTheDocument();
    semNadaDisso();
    await enviar();
    expect(svc.toastError).toHaveBeenCalledWith('Selecione o depósito vinculado ao cocho.');
  });
});
