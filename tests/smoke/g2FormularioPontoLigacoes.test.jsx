/**
 * Frente G2 — `FormularioPonto` com a regra única de ligação.
 *
 *  F1  ponto novo: o que foi digitado NÃO é apagado quando os cochos terminam de carregar;
 *  F2  salvar um BEBEDOURO não inativa o cocho/depósito que só tem o mesmo nome/sigla;
 *  F3  editar um COCHO não puxa setor/pastos de um bebedouro homônimo (bebedouro só por id);
 *  F4  criar o cocho de um ponto não manda `numero_ponto` (o servidor numera);
 *  F5  trocar o tipo de um DEPÓSITO com histórico é bloqueado antes de gravar qualquer coisa;
 *  F6  trocar o tipo de um BEBEDOURO inativa o bebedouro ligado pelo id;
 *  F7  depósito novo: o local vai junto no POST do depósito (o servidor cria os
 *      dois na mesma transação), sem POST de local antes.
 *  F8  sem a lista de pontos (falhou/carregando) o formulário de cocho/depósito
 *      não se preenche pela regra só por nome e nada é gravado;
 *  F9  produção: o ponto nº 1 "TESTE" não puxa nem grava no depósito que está no
 *      lugar do ponto nº 4 "TESTE".
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
  listarTodosPontosSuplementacao: vi.fn(),
  listarTodosBebedouros: vi.fn(),
  listarPontosAtivos: vi.fn(),
  listarIconesPorTipoEntidade: vi.fn(),
  verificarRemocaoSuplementacao: vi.fn(),
  removerPontoSuplementacao: vi.fn(),
  desfazerCriacaoDePonto: vi.fn(),
  atualizarBebedouro: vi.fn(),
  criarBebedouro: vi.fn(),
  criarLocal: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/services/mapaService', () => ({
  listarIconesPorTipoEntidade: (...a) => svc.listarIconesPorTipoEntidade(...a),
  listarTodosPontos: vi.fn(async () => []),
  listarPontosAtivos: (...a) => svc.listarPontosAtivos(...a),
  listarTodosPontosSuplementacao: (...a) => svc.listarTodosPontosSuplementacao(...a),
  listarTodosBebedouros: (...a) => svc.listarTodosBebedouros(...a),
  listarSetoresAtivos: vi.fn(async () => [{ id: 's1', nome: 'SETOR 1', empresa_id: 'emp-1' }, { id: 's2', nome: 'SETOR 2', empresa_id: 'emp-1' }]),
  listarAreasAtivas: vi.fn(async () => [
    { id: 'a1', nome: 'PASTO 1', setor_id: 's1', empresa_id: 'emp-1' },
    { id: 'a2', nome: 'PASTO 2', setor_id: 's2', empresa_id: 'emp-1' },
  ]),
  criarPonto: (...a) => svc.criarPonto(...a),
  atualizarPonto: (...a) => svc.atualizarPonto(...a),
  criarPontoSuplementacao: (...a) => svc.criarPontoSuplementacao(...a),
  atualizarPontoSuplementacao: (...a) => svc.atualizarPontoSuplementacao(...a),
  verificarRemocaoSuplementacao: (...a) => svc.verificarRemocaoSuplementacao(...a),
  removerPontoSuplementacao: (...a) => svc.removerPontoSuplementacao(...a),
  desfazerCriacaoDePonto: (...a) => svc.desfazerCriacaoDePonto(...a),
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
vi.mock('@/services/bebedouroDataService', () => ({
  atualizarBebedouro: (...a) => svc.atualizarBebedouro(...a),
  criarBebedouro: (...a) => svc.criarBebedouro(...a),
}));
vi.mock('@/components/mapa/CapturaGPSPonto', () => ({ default: () => null }));
vi.mock('@/components/mapa/SelecaoAreasMapa', () => ({ default: () => null }));
vi.mock('@/components/mapa/SelecaoDepositoMapa', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (...a) => svc.toastError(...a) } }));

const { default: FormularioPonto } = await import('@/components/mapa/FormularioPonto');
const { ApiError, API_ERROR_CODES } = await import('@/apis/_core/ApiError');

const AQUI = { lat: -15.6, lng: -56.1 };

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  for (const fn of Object.values(svc)) fn.mockReset();
  svc.listarIconesPorTipoEntidade.mockResolvedValue([{ id: 'ic-porteira', categoria: 'PORTEIRA', tipo_entidade: 'Ponto', ativo: true }]);
  svc.listarTodosPontosSuplementacao.mockResolvedValue([]);
  svc.listarTodosBebedouros.mockResolvedValue([]);
  svc.listarPontosAtivos.mockResolvedValue([]);
  svc.criarPonto.mockImplementation(async (d) => ({ id: 'ref-novo', ...d }));
  svc.atualizarPonto.mockImplementation(async (id, d) => ({ id, ...d }));
  svc.criarPontoSuplementacao.mockImplementation(async (d) => ({ id: 'supl-novo', ...d }));
  svc.atualizarPontoSuplementacao.mockImplementation(async (id, d) => ({ id, ...d }));
  svc.desfazerCriacaoDePonto.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const montar = async (item) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onSave = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <FormularioPonto coordenadas={AQUI} item={item} onSave={onSave} onCancel={() => {}} />
    </QueryClientProvider>,
  );
  await act(async () => {});
  return onSave;
};
const campo = (rotulo) => /** @type {HTMLInputElement} */ (screen.getByLabelText(new RegExp(`^${rotulo.replace(/[()]/g, '\\$&')}`)));
const enviar = async () => {
  await act(async () => {
    fireEvent.submit(screen.getByTestId('b1-form-ponto'));
  });
};
const trocarTipoPara = async (rotulo) => {
  await act(async () => fireEvent.click(screen.getByRole('combobox', { name: /Tipo do ponto/ })));
  await act(async () => fireEvent.click(screen.getByRole('option', { name: rotulo })));
};

describe('FormularioPonto — ligações (G2)', () => {
  it('F1 — ponto novo: o nome digitado sobrevive ao fim do carregamento dos cochos', async () => {
    /** @type {(v: any[]) => void} */
    let liberar = () => {};
    svc.listarTodosPontosSuplementacao.mockImplementation(() => new Promise((r) => { liberar = r; }));
    await montar(null);
    fireEvent.change(campo('Nome do ponto'), { target: { value: 'PORTEIRA NORTE' } });
    await act(async () => { liberar([]); });
    await act(async () => {});
    expect(campo('Nome do ponto').value).toBe('PORTEIRA NORTE');
  });

  it('F2 — salvar um BEBEDOURO não inativa o cocho homônimo (nem o de mesma sigla)', async () => {
    svc.listarTodosPontosSuplementacao.mockResolvedValue([
      { id: 'c1', empresa_id: 'emp-1', status: 'Ativo', nome_ponto: 'AGUADA', sigla: 'AG', categoria_ponto: 'COCHO' },
    ]);
    svc.listarTodosBebedouros.mockResolvedValue([
      { id: 'b1', empresa_id: 'emp-1', ponto_referencia_id: 'p1', nome: 'AGUADA', capacidade_litros: 1000, ativo: true },
    ]);
    const onSave = await montar({ id: 'p1', empresa_id: 'emp-1', nome: 'AGUADA', sigla: 'AG', tipo: 'BEBEDOURO', setor_id: 's1', area_vinculada_ids: ['a1'], area_vinculada_id: 'a1' });
    await waitFor(() => expect(campo('Capacidade de água (litros)').value).toBe('1000'));
    await enviar();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(svc.atualizarBebedouro).toHaveBeenCalledWith('b1', expect.objectContaining({ ponto_referencia_id: 'p1', ativo: true }));
    expect(svc.atualizarPontoSuplementacao).not.toHaveBeenCalled();
    expect(svc.removerPontoSuplementacao).not.toHaveBeenCalled();
  });

  it('F3 — editar um COCHO não puxa setor/pastos de um bebedouro só homônimo', async () => {
    svc.listarTodosPontosSuplementacao.mockResolvedValue([
      { id: 'c1', empresa_id: 'emp-1', status: 'Ativo', nome_ponto: 'COCHO 1', categoria_ponto: 'COCHO', setor_id: 's1', area_vinculada_ids: ['a1'], area_vinculada_id: 'a1', deposito_origem_id: 'd1', capacidade_cocho_kg: 100, metragem_cocho_m: 5, cobertura_cocho: 'Coberto' },
    ]);
    svc.listarTodosBebedouros.mockResolvedValue([
      { id: 'b9', empresa_id: 'emp-1', nome: 'COCHO 1', setor_id: 's2', pasto_id: 'a2', area_vinculada_ids: ['a2'], ativo: true },
    ]);
    const onSave = await montar({ id: 'p1', empresa_id: 'emp-1', nome: 'COCHO 1', tipo: 'COCHO' });
    await waitFor(() => expect(campo('Limite do cocho (kg)').value).toBe('100'));
    await enviar();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, corpo] = svc.atualizarPontoSuplementacao.mock.calls.find(([id]) => id === 'c1');
    expect(corpo).toMatchObject({ setor_id: 's1', area_vinculada_ids: ['a1'] });
  });

  it('F4 — o cocho criado a partir do ponto vai sem numero_ponto', async () => {
    const onSave = await montar({ id: 'p1', empresa_id: 'emp-1', nome: 'COCHO NOVO', tipo: 'COCHO', setor_id: 's1', area_vinculada_ids: ['a1'], area_vinculada_id: 'a1', deposito_origem_id: 'd1', capacidade_cocho_kg: '50', metragem_cocho_m: '3', cobertura_cocho: 'Coberto' });
    await waitFor(() => expect(campo('Limite do cocho (kg)').value).toBe('50'));
    await enviar();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(svc.criarPontoSuplementacao).toHaveBeenCalledTimes(1);
    expect(svc.criarPontoSuplementacao.mock.calls[0][0]).not.toHaveProperty('numero_ponto');
  });

  it('F5 — DEPÓSITO com histórico não troca de tipo: nada é gravado e o motivo aparece', async () => {
    svc.listarTodosPontosSuplementacao.mockResolvedValue([
      { id: 'd1', empresa_id: 'emp-1', status: 'Ativo', nome_ponto: 'DEP 1', categoria_ponto: 'DEPOSITO', local_estoque_id: 'loc1', setor_id: 's1', capacidade_cocho_kg: 100, estoque_minimo_kg: 10 },
    ]);
    svc.verificarRemocaoSuplementacao.mockRejectedValue(new ApiError(API_ERROR_CODES.MAPA_DELETE_BLOCKED));
    await montar({ id: 'p1', empresa_id: 'emp-1', nome: 'DEP 1', tipo: 'DEPÓSITO', setor_id: 's1' });
    await waitFor(() => expect(campo('Limite do depósito (kg)').value).toBe('100'));
    await trocarTipoPara('PORTEIRA');
    await enviar();
    await waitFor(() => expect(svc.toastError).toHaveBeenCalled());
    expect(svc.toastError.mock.calls.flat().join(' ')).toMatch(/Não é possível trocar o tipo/);
    expect(svc.atualizarPonto).not.toHaveBeenCalled();
    expect(svc.removerPontoSuplementacao).not.toHaveBeenCalled();
    expect(svc.atualizarPontoSuplementacao).not.toHaveBeenCalled();
  });

  it('F6 — BEBEDOURO que vira outro tipo inativa o bebedouro ligado', async () => {
    svc.listarTodosBebedouros.mockResolvedValue([
      { id: 'b1', empresa_id: 'emp-1', ponto_referencia_id: 'p1', nome: 'BEB', capacidade_litros: 1000, ativo: true },
    ]);
    const onSave = await montar({ id: 'p1', empresa_id: 'emp-1', nome: 'BEB', tipo: 'BEBEDOURO', setor_id: 's1', area_vinculada_ids: ['a1'] });
    await waitFor(() => expect(campo('Capacidade de água (litros)').value).toBe('1000'));
    await trocarTipoPara('PORTEIRA');
    await enviar();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(svc.atualizarBebedouro).toHaveBeenCalledWith('b1', { ativo: false, status: 'Inativo' });
  });

  it('F7 — depósito novo leva o local no mesmo POST (sem local órfão se o depósito falhar)', async () => {
    const onSave = await montar({ id: 'p1', empresa_id: 'emp-1', nome: 'DEP NOVO', tipo: 'DEPÓSITO', setor_id: 's1', capacidade_cocho_kg: '100', estoque_minimo_kg: '10' });
    await waitFor(() => expect(campo('Limite do depósito (kg)').value).toBe('100'));
    await enviar();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(svc.criarLocal).not.toHaveBeenCalled();
    expect(svc.criarPontoSuplementacao).toHaveBeenCalledTimes(1);
    expect(svc.criarPontoSuplementacao.mock.calls[0][0]).toMatchObject({
      categoria_ponto: 'DEPOSITO',
      local_estoque_id: null,
      local_estoque: { nome: 'DEP NOVO', descricao: 'DEPÓSITO DE SUPLEMENTAÇÃO - DEP NOVO' },
    });
  });

  const DEP_NO_LUGAR_4 = { id: 'd1', empresa_id: 'emp-1', status: 'Ativo', nome_ponto: 'TESTE', categoria_ponto: 'DEPOSITO', local_estoque_id: 'loc1', setor_id: 's1', capacidade_cocho_kg: 100, estoque_minimo_kg: 10, coordenadas: { lat: -14.50677727330729, lng: -60.20940129969895 } };
  const PONTO_1 = { id: 'p1', empresa_id: 'emp-1', nome: 'TESTE', tipo: 'DEPÓSITO', ativo: true, coordenadas: { lat: -14.50675131924793, lng: -60.20948193454403 } };
  const PONTO_4 = { id: 'p4', empresa_id: 'emp-1', nome: 'TESTE', tipo: 'Depósito', ativo: true, coordenadas: DEP_NO_LUGAR_4.coordenadas };

  it('F8 — lista de pontos falhou: o depósito do outro ponto não preenche o formulário e nada é gravado', async () => {
    svc.listarTodosPontosSuplementacao.mockResolvedValue([DEP_NO_LUGAR_4]);
    svc.listarPontosAtivos.mockRejectedValue(new Error('rede'));
    await montar(PONTO_1);
    await waitFor(() => expect(svc.listarTodosPontosSuplementacao).toHaveBeenCalled());
    await waitFor(() => expect(svc.listarPontosAtivos).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(campo('Nome do ponto').value).toBe('');
    expect(screen.queryByDisplayValue('100')).toBeNull();
    await enviar();
    await act(async () => {});
    expect(svc.atualizarPontoSuplementacao).not.toHaveBeenCalled();
    expect(svc.atualizarPonto).not.toHaveBeenCalled();
  });

  it('F9 — produção: o ponto nº 1 não puxa nem grava no depósito do ponto nº 4', async () => {
    svc.listarTodosPontosSuplementacao.mockResolvedValue([DEP_NO_LUGAR_4]);
    svc.listarPontosAtivos.mockResolvedValue([PONTO_1, PONTO_4]);
    await montar(PONTO_1);
    await waitFor(() => expect(campo('Nome do ponto').value).toBe('TESTE'));
    expect(campo('Limite do depósito (kg)').value).toBe('');
    await enviar();
    await act(async () => {});
    expect(svc.atualizarPontoSuplementacao.mock.calls.some(([id]) => id === 'd1')).toBe(false);
  });
});
