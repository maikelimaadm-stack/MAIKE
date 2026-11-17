/**
 * D-PROD-205 — Leitura de cocho e farol do cocho.
 *
 *  - domínio puro: VAZIO → vermelho, ADEQUADO → verde, CHEIO → azul; sem leitura
 *    ou com mais de 2 dias → cinza "Sem leitura recente" (hoje, ontem e anteontem
 *    valem); a última leitura é a do dia mais recente (empate: a registrada
 *    depois); avisos de acesso ruim e estrutura vêm da última leitura, mesmo vencida;
 *  - formulário: escore obrigatório (sem pré-escolha), acesso Bom e estrutura Boa
 *    por padrão, data padrão = hoje da fazenda e não depois dele; envia só os campos
 *    da leitura e grava no cache do mapa;
 *  - porta: o POST leva só os campos que o servidor aceita (o replay offline traz mais);
 *  - detalhe do cocho: botão "Leitura" com `lancar_suplementacao`, seção "Leitura do
 *    cocho" com o farol, os avisos e as últimas leituras, e excluir com confirmação.
 *    D-PROD-220 (desenho v12): cada leitura é uma linha — a data à esquerda, a
 *    observação embaixo dela e "ESCORE · ACESSO · ESTRUTURA" à direita.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { farolDoCocho, leiturasDoPonto, ultimaLeituraDoPonto, avisosDaLeitura, descreverFarol } from '@/domain/suplementacao/leituraCocho';
import { corpoDaLeitura } from '@/apis/leituras-cocho/leituraCochoNativePort';

const EMP = 'emp-1';
const dados = vi.hoisted(() => ({ cache: {}, empresas: [] }));
const servico = vi.hoisted(() => ({ registrar: vi.fn(), excluir: vi.fn() }));
const avisos = vi.hoisted(() => ({ warning: vi.fn(), success: vi.fn(), error: vi.fn(), confirmar: vi.fn() }));

vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: vi.fn(async (chave) => dados.cache[chave] || []),
  refreshMapaCacheEntry: vi.fn(async (chave) => dados.cache[chave] || []),
  updateMapaCachedData: vi.fn(async (chave, _e, fn) => {
    dados.cache[chave] = fn(dados.cache[chave] || []);
    return dados.cache[chave];
  }),
}));
vi.mock('@/services/estoqueMapaService', () => ({ listarTodosProdutos: vi.fn(async () => []) }));
vi.mock('@/services/empresaService', () => ({ listEmpresas: vi.fn(async () => dados.empresas) }));
vi.mock('@/services/leituraCochoService', () => ({
  registrarLeituraCocho: (...a) => servico.registrar(...a),
  excluirLeituraCocho: (...a) => servico.excluir(...a),
}));
vi.mock('@/lib/maikeNotify', () => ({
  notifyWarning: (...a) => avisos.warning(...a),
  notifySuccess: (...a) => avisos.success(...a),
  notifyError: (...a) => avisos.error(...a),
  notifyInfo: vi.fn(),
}));
vi.mock('@/lib/maikeConfirmar', () => ({ confirmarExclusao: (...a) => avisos.confirmar(...a), confirmar: vi.fn(), avisar: vi.fn() }));
vi.mock('@/components/suplementacao/FormularioLancamentoSuplementacao', () => ({ default: () => null }));
vi.mock('@/components/suplementacao/HistoricoSuplementacaoPonto', () => ({ default: () => null }));
vi.mock('@/components/mapa/DetalhesDepositoSuplementacao', () => ({ default: () => null }));

const L = (id, data_leitura, escore, extra = {}) => ({
  id, empresa_id: EMP, ponto_suplementacao_id: 'c1', data_leitura, escore, acesso: 'BOM', estrutura: 'BOA',
  created_date: `${data_leitura}T12:00:00.000Z`, registrado_por_nome: 'JOÃO', ...extra,
});

describe('D-PROD-205 — farol do cocho (puro)', () => {
  const HOJE = '2026-11-12';
  it('as três cores pela última leitura; sem leitura, cinza', () => {
    expect(farolDoCocho({ leituras: [L('a', HOJE, 'VAZIO')], pontoId: 'c1', hoje: HOJE })).toMatchObject({ cor: 'vermelho', rotulo: 'Cocho vazio', idadeDias: 0, vencida: false });
    expect(farolDoCocho({ leituras: [L('a', HOJE, 'ADEQUADO')], pontoId: 'c1', hoje: HOJE })).toMatchObject({ cor: 'verde', rotulo: 'Cocho adequado' });
    expect(farolDoCocho({ leituras: [L('a', HOJE, 'CHEIO')], pontoId: 'c1', hoje: HOJE })).toMatchObject({ cor: 'azul', rotulo: 'Cocho cheio', hex: '#2563eb' });
    expect(farolDoCocho({ leituras: [], pontoId: 'c1', hoje: HOJE })).toMatchObject({ cor: 'cinza', rotulo: 'Sem leitura recente', leitura: null });
    expect(farolDoCocho({ leituras: [L('a', HOJE, 'CHEIO', { ponto_suplementacao_id: 'outro' })], pontoId: 'c1', hoje: HOJE }).cor, 'leitura de outro cocho não conta').toBe('cinza');
  });

  it('vence depois de 2 dias: anteontem ainda vale, 3 dias atrás é cinza; diasValidade ajustável', () => {
    expect(farolDoCocho({ leituras: [L('a', '2026-11-10', 'VAZIO')], pontoId: 'c1', hoje: HOJE })).toMatchObject({ cor: 'vermelho', idadeDias: 2 });
    expect(farolDoCocho({ leituras: [L('a', '2026-11-09', 'VAZIO')], pontoId: 'c1', hoje: HOJE })).toMatchObject({ cor: 'cinza', idadeDias: 3, vencida: true });
    expect(farolDoCocho({ leituras: [L('a', '2026-11-09', 'VAZIO')], pontoId: 'c1', hoje: HOJE, diasValidade: 3 }).cor).toBe('vermelho');
    expect(farolDoCocho({ leituras: [L('a', HOJE, 'VAZIO')], pontoId: 'c1', hoje: null }).cor, 'sem hoje, sem farol').toBe('cinza');
  });

  it('a última é a do dia mais recente; no mesmo dia, a registrada depois', () => {
    const lista = [L('a', '2026-11-11', 'CHEIO'), L('b', HOJE, 'VAZIO', { created_date: '2026-11-12T08:00:00.000Z' }), L('c', HOJE, 'ADEQUADO', { created_date: '2026-11-12T17:00:00.000Z' })];
    expect(ultimaLeituraDoPonto(lista, 'c1').id).toBe('c');
    expect(leiturasDoPonto(lista, 'c1').map((l) => l.id)).toEqual(['c', 'b', 'a']);
  });

  it('avisos de acesso e estrutura vêm da última leitura, mesmo vencida; o texto do marcador junta tudo', () => {
    expect(avisosDaLeitura(L('a', HOJE, 'VAZIO', { acesso: 'RUIM', estrutura: 'QUEBRADA' })).map((a) => a.texto)).toEqual(['Acesso ruim ao cocho', 'Estrutura quebrada']);
    expect(avisosDaLeitura(L('a', HOJE, 'VAZIO', { estrutura: 'REPARO' })).map((a) => a.texto)).toEqual(['Estrutura precisa de reparo']);
    const vencida = farolDoCocho({ leituras: [L('a', '2026-11-01', 'CHEIO', { estrutura: 'REPARO' })], pontoId: 'c1', hoje: HOJE });
    expect(vencida.cor).toBe('cinza');
    expect(vencida.avisos.map((a) => a.tipo)).toEqual(['estrutura']);
    expect(descreverFarol(vencida)).toBe('Leitura: Sem leitura recente · Estrutura precisa de reparo');
  });

  it('a porta envia só os campos da leitura (o replay offline acrescenta created_date, updated_date…)', () => {
    expect(corpoDaLeitura({ empresa_id: EMP, ponto_suplementacao_id: 'c1', data_leitura: HOJE, escore: 'VAZIO', acesso: 'BOM', estrutura: 'BOA', observacoes: null, created_date: 'x', updated_date: 'y', _isOffline: true, cliente_id: 'z' }))
      .toEqual({ empresa_id: EMP, ponto_suplementacao_id: 'c1', data_leitura: HOJE, escore: 'VAZIO', acesso: 'BOM', estrutura: 'BOA', observacoes: null });
  });
});

const PONTO = { id: 'c1', empresa_id: EMP, nome_ponto: 'COCHO c1', categoria_ponto: 'COCHO', status: 'Ativo', area_vinculada_id: 'a1', area_vinculada_ids: ['a1'] };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T15:00:00.000Z'));
  servico.registrar.mockReset();
  servico.excluir.mockReset();
  for (const f of Object.values(avisos)) f.mockReset();
  dados.empresas = [{ id: EMP, nome: 'FAZENDA', fuso_horario: 'America/Sao_Paulo' }];
  dados.cache = { areas: [{ id: 'a1', empresa_id: EMP, nome: 'PASTO 1' }], pontosSuplementacao: [PONTO], eventosSuplementacao: [], leiturasCocho: [] };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('D-PROD-205 — formulário de leitura', () => {
  const montar = async (onSaved = vi.fn()) => {
    const { default: FormularioLeituraCocho } = await import('@/components/suplementacao/FormularioLeituraCocho');
    render(<FormularioLeituraCocho ponto={PONTO} hoje="2026-11-12" onCancel={vi.fn()} onSaved={onSaved} />);
    return onSaved;
  };
  const enviar = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Registrar Leitura' }));
    });
  };

  it('escore obrigatório: sem ele avisa e não envia; acesso Bom e estrutura Boa já marcados', async () => {
    await montar();
    expect(screen.getByLabelText(/Data da Leitura/)).toHaveValue('2026-11-12');
    expect(screen.getByRole('radio', { name: 'Bom' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Boa' })).toHaveAttribute('aria-checked', 'true');
    for (const n of ['Vazio', 'Adequado', 'Cheio']) expect(screen.getByRole('radio', { name: n })).toHaveAttribute('aria-checked', 'false');
    await enviar();
    expect(servico.registrar).not.toHaveBeenCalled();
    expect(avisos.warning).toHaveBeenCalledWith('Atenção', expect.stringMatching(/escore/));
  });

  it('data depois de hoje não envia (o campo tem max = hoje; a tela confere de novo)', async () => {
    await montar();
    fireEvent.click(screen.getByRole('radio', { name: 'Vazio' }));
    const campo = screen.getByLabelText(/Data da Leitura/);
    expect(campo).toHaveAttribute('max', '2026-11-12');
    fireEvent.change(campo, { target: { value: '2026-11-13' } });
    await enviar();
    // A validação nativa do navegador (max) ou a da tela barra o envio.
    await act(async () => {
      fireEvent.submit(screen.getByTestId('form-leitura-cocho'));
    });
    expect(servico.registrar).not.toHaveBeenCalled();
    expect(avisos.warning).toHaveBeenCalledWith('Atenção', expect.stringMatching(/depois de hoje/));
  });

  it('envia a leitura (sem estoque), grava no cache do mapa e avisa', async () => {
    servico.registrar.mockImplementation(async (corpo) => ({ ...corpo, id: 'l-1', registrado_por_nome: 'JOÃO' }));
    const onSaved = await montar();
    fireEvent.click(screen.getByRole('radio', { name: 'Cheio' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Ruim' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Precisa de reparo' }));
    fireEvent.change(screen.getByLabelText(/Observação/), { target: { value: '  cocho rachado  ' } });
    await enviar();
    expect(servico.registrar).toHaveBeenCalledWith({
      empresa_id: EMP, ponto_suplementacao_id: 'c1', data_leitura: '2026-11-12', escore: 'CHEIO', acesso: 'RUIM', estrutura: 'REPARO', observacoes: 'cocho rachado',
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'l-1' })));
    expect(dados.cache.leiturasCocho.map((l) => l.id)).toEqual(['l-1']);
    expect(avisos.success).toHaveBeenCalledWith('Leitura registrada', undefined);
  });

  it('sem conexão (registro offline): avisa que vai ao servidor depois', async () => {
    servico.registrar.mockImplementation(async (corpo) => ({ ...corpo, id: 'offline_LeituraCocho_1', _isOffline: true }));
    await montar();
    fireEvent.click(screen.getByRole('radio', { name: 'Adequado' }));
    await enviar();
    await waitFor(() => expect(avisos.success).toHaveBeenCalledWith('Leitura registrada', expect.stringMatching(/Sem conexão/)));
  });
});

describe('D-PROD-205 — detalhe do cocho', () => {
  const renderizar = async (permissions = {}) => {
    const { default: DetalhesPontoSuplementacao } = await import('@/components/mapa/DetalhesPontoSuplementacao');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <DetalhesPontoSuplementacao ponto={PONTO} permissions={permissions} onClose={() => {}} />
      </QueryClientProvider>,
    );
    await screen.findByText('Informações do cocho');
    await act(async () => {});
  };
  const secao = () => screen.getByRole('region', { name: 'Leitura do cocho' });

  it('botão "Leitura" só com lancar_suplementacao; sem leitura, farol cinza', async () => {
    await renderizar({ lancar_suplementacao: false });
    expect(screen.queryByRole('button', { name: 'Leitura' })).toBeNull();
    expect(within(secao()).getByTestId('farol-cocho')).toHaveAttribute('data-cor', 'cinza');
    expect(within(secao()).getByText('Nenhuma leitura registrada.')).toBeTruthy();
    cleanup();
    await renderizar({});
    expect(screen.getByRole('button', { name: 'Leitura' })).toBeTruthy();
  });

  it('mostra o farol da última leitura, quem leu, os avisos e as últimas leituras; excluir pede confirmação', async () => {
    dados.cache.leiturasCocho = [
      L('l-1', '2026-11-11', 'CHEIO'),
      L('l-2', '2026-11-12', 'VAZIO', { acesso: 'RUIM', estrutura: 'QUEBRADA', observacoes: 'cocho virado' }),
    ];
    await renderizar({});
    await waitFor(() => expect(within(secao()).getByTestId('farol-cocho')).toHaveAttribute('data-cor', 'vermelho'));
    expect(within(secao()).getByText('Cocho vazio')).toBeTruthy();
    expect(within(secao()).getByText(/JOÃO/)).toBeTruthy();
    expect(within(secao()).getAllByTestId('aviso-leitura-cocho').map((a) => a.textContent)).toEqual([
      'Acesso ruim ao cocho (leitura de 12/11/2026)', 'Estrutura quebrada (leitura de 12/11/2026)',
    ]);
    const itens = within(within(secao()).getByRole('list', { name: 'Últimas leituras' })).getAllByRole('listitem');
    expect(itens).toHaveLength(2);
    // A mais recente primeiro: data, escore · acesso · estrutura e a observação.
    expect(within(itens[0]).getByText('12/11/2026')).toBeTruthy();
    expect(within(itens[0]).getByText('VAZIO · RUIM · QUEBRADA')).toBeTruthy();
    expect(within(itens[0]).getByText('cocho virado')).toBeTruthy();
    expect(within(itens[1]).getByText('11/11/2026')).toBeTruthy();
    expect(within(itens[1]).getByText('CHEIO · BOM · BOA')).toBeTruthy();

    avisos.confirmar.mockResolvedValueOnce(false);
    await act(async () => {
      fireEvent.click(within(secao()).getByRole('button', { name: 'Excluir a leitura de 12/11/2026' }));
    });
    expect(servico.excluir).not.toHaveBeenCalled();

    avisos.confirmar.mockResolvedValueOnce(true);
    servico.excluir.mockResolvedValueOnce(undefined);
    await act(async () => {
      fireEvent.click(within(secao()).getByRole('button', { name: 'Excluir a leitura de 12/11/2026' }));
    });
    expect(servico.excluir).toHaveBeenCalledWith('l-2');
    await waitFor(() => expect(within(secao()).getByTestId('farol-cocho')).toHaveAttribute('data-cor', 'azul'));
  });

  it('sem lancar_suplementacao não há "Excluir" nas leituras', async () => {
    dados.cache.leiturasCocho = [L('l-1', '2026-11-12', 'ADEQUADO')];
    await renderizar({ lancar_suplementacao: false });
    await waitFor(() => expect(within(secao()).getByTestId('farol-cocho')).toHaveAttribute('data-cor', 'verde'));
    expect(within(secao()).queryByRole('button', { name: /Excluir/ })).toBeNull();
  });
});
